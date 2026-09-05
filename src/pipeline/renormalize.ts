// src/pipeline/renormalize.ts — replay the CURRENT normaliser over the stored `raw` of every fact
// that an older normaliser produced.
//
//   ingest renormalize [--commit] [--field K] [--since-version V] [--limit N]
//                      [--max-change-share 0.25] [--allow "reason"] [--batch N] [--examples N]
//
// Why this exists. `facts.raw` is NOT NULL for one reason: a normaliser bug must be replayable
// (docs/DATA_MODEL.md). The normaliser moved 1.3.0 -> 1.4.0 -> 1.5.0 -> 1.5.1 on 4 Sep 2026 (inch
// marks, rack units, counting nouns, layer from a bare number, bullet/newline list splits, a
// leading minus as a sign, descending ranges refused, spaced-slash PID alternatives) and the
// dictionary retyped five fields. Every stored value below the current version was produced by a
// normaliser that no longer exists, and nothing had ever gone back over them: 98,517 value-bearing
// current facts, none of them at 1.5.1.
//
// What it does with each selected fact, and the ONE rule that shapes all of it — a value is never
// overwritten (CLAUDE.md):
//
//   same           the normaliser produces the identical value AND unit. Only `norm_v` is
//                  re-stamped, IN PLACE. See restampNormV for why that is bookkeeping and not a
//                  value write.
//   changed        a different value: the row is SUPERSEDED by a new fact carrying the same
//                  provenance, state, inheritance and evidence, with the new value.
//   refused        the normaliser can no longer read the string (a band it now enforces, a range
//                  it now refuses, a shape the retyped dictionary no longer accepts). The row is
//                  superseded into `gap_unattempted` with the refusal reason in `method`
//                  (`renormalize:RANGE_VIOLATION`) — the schema's own quarantine, via
//                  retractFact. The old row, its value and every fact_evidence row attached to it
//                  stay in history. Nothing is deleted, and each refusal is appended to
//                  runs/reports/renormalize-<date>.jsonl so the list survives the terminal.
//   protected      the row is TIER 0 — an operator reviewed it (hexcat_seed and the operator's own
//                  corrections) — and the replay wanted to change or refuse it. A normaliser is
//                  evidence about a string; an operator is evidence about the part, and the whole
//                  tier ladder says which of those wins. So the row is left EXACTLY as it is,
//                  counted apart, and every one is listed with the value the replay would have
//                  written, because that list is the operator's own review queue. Nothing here is
//                  a silent skip: the count, the reasons and the samples are all in the report and
//                  in the run's stats. (A tier-0 row the replay agrees with is still re-stamped —
//                  norm_v is bookkeeping, not a value; see restampNormV.)
//   unrecoverable  `raw` is empty, so there is nothing to replay. COUNTED, never touched. 7,570
//                  current rows are in this state today and every one is a gap row a retraction
//                  wrote (`retracted:*` methods, value NULL, raw ''): they were never normalised,
//                  so stamping a norm_v on them would be a claim about a normalisation that never
//                  happened. Reported apart from a real lost raw for exactly that reason.
//
// THE GUARD, and it is the point of the command. A normaliser bug would rewrite the corpus in one
// command, so `--commit` refuses when the changed share of the selection exceeds
// `--max-change-share` (default 0.25), and refuses when any single change moves a number by 1000x
// or more — the shape of the two real normaliser bugs this repo has already paid for (the
// German-comma read that put "0.075 kg" in at 75, and `convert()` dropping a "360K" suffix to
// 360). Either refusal is lifted only by `--allow "reason"`, and the reason is recorded in the run
// row and in the gate object, so a corpus-wide rewrite can never happen without a person having
// typed why.
import fs from "node:fs";
import path from "node:path";
import {
  getPool, closePool, withTx, withRun, supersedeFact, retractFact, type Queryable,
} from "../store/index.js";
import type { SpecEntry } from "../core/specMerge.js";
import { FIELD_DICTIONARY } from "../core/fieldSchema.js";
// imported at RUNTIME from the shipping normaliser: this command must replay whatever version is
// installed, never a copy of its rules.
import { normalizeField, NORM_VERSION, type Locale } from "../core/specNormalize.js";
import { REPO_ROOT } from "../config.js";

// ---- arguments -----------------------------------------------------------------------------
export type RenormArgs = {
  commit: boolean;
  field: string | null;
  sinceVersion: string | null;
  limit: number | null;
  maxChangeShare: number;
  allow: string | null;
  batch: number;
  examples: number;
};

export function parseArgs(argv: string[]): RenormArgs {
  const a: RenormArgs = {
    commit: false, field: null, sinceVersion: null, limit: null,
    maxChangeShare: 0.25, allow: null, batch: 5000, examples: 10,
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--commit") a.commit = true;
    else if (t === "--field") a.field = argv[++i] ?? "";
    else if (t === "--since-version") a.sinceVersion = argv[++i] ?? "";
    else if (t === "--limit") a.limit = Number(argv[++i]);
    else if (t === "--max-change-share") a.maxChangeShare = Number(argv[++i]);
    else if (t === "--allow") a.allow = argv[++i] ?? "";
    else if (t === "--batch") a.batch = Number(argv[++i]);
    else if (t === "--examples") a.examples = Number(argv[++i]);
    else throw new Error(`renormalize: unknown argument "${t}"`);
  }
  if (a.field !== null && !FIELD_DICTIONARY[a.field]) {
    throw new Error(`--field "${a.field}" is not in the field dictionary; a typo would select nothing and report a clean run`);
  }
  if (a.sinceVersion !== null && !/^\d+\.\d+\.\d+$/.test(a.sinceVersion)) {
    throw new Error(`--since-version "${a.sinceVersion}" is not a semver triple (e.g. 1.5.0)`);
  }
  if (a.limit !== null && (!Number.isFinite(a.limit) || a.limit < 1)) throw new Error("--limit must be a positive number");
  if (!Number.isFinite(a.maxChangeShare) || a.maxChangeShare < 0 || a.maxChangeShare > 1) {
    throw new Error("--max-change-share must be between 0 and 1");
  }
  if (!Number.isFinite(a.batch) || a.batch < 1) throw new Error("--batch must be a positive number");
  // An empty --allow is the dangerous one: it satisfies a truthiness test and records no reason.
  if (a.allow !== null && a.allow.trim() === "") throw new Error('--allow needs a reason in quotes, e.g. --allow "1.5.1 list split, replay read and approved"');
  // RAISING the ceiling is the same act as lifting it. `--max-change-share 1` disables the guard
  // completely and, unlike `--allow`, left no reason anywhere — the run row recorded a number, not
  // a person's argument. Above half the selection the two are indistinguishable in effect, so they
  // are indistinguishable in what they demand.
  if (a.maxChangeShare > 0.5 && !a.allow) {
    throw new Error(`--max-change-share ${a.maxChangeShare} is above 0.5, which disables the guard rather than tuning it; it needs --allow "reason" as well so the run row records why`);
  }
  return a;
}

// ---- semver --------------------------------------------------------------------------------
/**
 * Is `a` an OLDER normaliser version than `b`? Numeric per component, because string comparison
 * is wrong exactly where it matters: "1.10.0" < "1.5.0" as strings, and this corpus will reach a
 * two-digit minor. A NULL or unparseable stamp is the oldest thing there is — 29,294 current rows
 * carry no norm_v at all and they are precisely the ones most in need of a replay.
 */
export function semverLess(a: string | null | undefined, b: string): boolean {
  if (a == null || a === "") return true;
  const pa = a.split(".").map((x) => Number.parseInt(x, 10));
  const pb = b.split(".").map((x) => Number.parseInt(x, 10));
  if (pa.length !== 3 || pa.some((x) => !Number.isFinite(x))) return true;
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

// ---- does the stored value match the dictionary type? ----------------------------------------
/**
 * A `struct` field whose dictionary `shape` begins `list{` stores an ARRAY of objects, and that is
 * the whole reason this function exists rather than reusing the coarse shape test.
 *
 * `ports` and `uplink_ports` are `type: struct, shape: "list{ port_typ: e(...), speed: ls, anzahl: n }"`.
 * A test that reads only the TYPE calls their 3,632 stored arrays a type disagreement — remerge's
 * census reports exactly that, and its own comment records that acting on it would have retracted
 * them. They are not junk: replaying `raw` through the current normaliser returns the identical
 * array for them (measured, 4 Sep 2026). Reading the SHAPE is what tells a genuine mismatch (a
 * bare string under `ports`) from a correct list, and getting it wrong here would have been this
 * command deleting 3,632 good facts on its first commit.
 */
export function valueMatchesDictType(value: unknown, type: string, shape?: string): boolean {
  if (value === null || value === undefined) return true;   // a gap row carries no value
  const isArray = Array.isArray(value);
  switch (type) {
    case "n": return typeof value === "number";
    case "b": return typeof value === "boolean";
    case "s": case "e": return typeof value === "string";
    case "ls": return isArray;
    case "nr": {
      if (isArray || typeof value !== "object") return false;
      const o = value as Record<string, unknown>;
      return typeof o.min === "number" && typeof o.max === "number";
    }
    case "struct": {
      if (shape && /^\s*list\s*\{/.test(shape)) return isArray && value.every((x) => x !== null && typeof x === "object" && !Array.isArray(x));
      return !isArray && typeof value === "object";
    }
    default: return true;   // an unknown dictionary type is not this command's to police
  }
}

// ---- locale ----------------------------------------------------------------------------------
/**
 * WHICH LOCALE A STORED FACT WAS READ UNDER — and the honest answer is that the database does not
 * record it. There is no locale column on `facts` and none on `source_docs`; the locale is a
 * parameter each writer passes to normalizeField and then forgets. So this reproduces, from
 * `method`, exactly what each writer passed, which is the only choice that keeps a replay a replay:
 *
 *   hexcat_seed          "de"  the operator's German seed (`src/pipeline/remerge.ts` agrees)
 *   everything else      "en"  deepSpecMap passes "en" for html_table/pdf; the description- and
 *                              name-mining applies pass "en"; meraki and router-switch are English
 *                              pages.
 *
 * Choosing differently here would not be a renormalisation, it would be a silent re-reading of
 * 21,724 rows under new rules, and "0,075 kg" read under the wrong locale is 75 kg — in band, so
 * nothing would refuse it (CLAUDE.md, 3 Sep 2026).
 *
 * FOUND, NOT FIXED, and reported by this command: `product_name_mining` raws are German prose
 * ("... 19-Zoll", "24x Gigabit-RJ45") but the apply that wrote them passed "en". If any of their
 * numbers uses a comma decimal they were read wrong on the way in and are still read wrong here.
 * That is a locale decision for the mining pipeline, not a side effect of a normaliser replay:
 * `localeForMethod` is one function, so changing it is a one-line change with its own replay.
 */
export function localeForMethod(method: string): Locale {
  return method === "hexcat_seed" ? "de" : "en";
}

// ---- what changed, and by how much -------------------------------------------------------------
/**
 * JSON with object keys in a stable order. ARRAY order is preserved, because in this schema it
 * carries meaning — a port list states the RJ45 bank before the uplinks.
 *
 * Without this the command superseded every struct-valued fact in the corpus and called it a value
 * change. Postgres returns jsonb with its own key order (shortest key first, then by bytes:
 * `{"speed": …, "anzahl": …, "port_typ": …}`), the normaliser builds `{port_typ, speed, anzahl}`,
 * and `JSON.stringify` compares those two identical values as different text. The suite caught it
 * on the one seeded `ports` row; in production it would have rewritten all 3,632 of them plus every
 * `dimensions` and every range, with a perfect provenance trail and no change of meaning anywhere.
 * The merge layer has already paid for this once — `sameValue` comparing "exact JSON of an unsorted
 * array" is a named cause of run #38's conflicts (CLAUDE.md, 4 Sep 2026).
 */
export function canonicalJson(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (x === null || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map(walk);
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = walk(o[k]);
    return out;
  };
  return JSON.stringify(walk(v ?? null));
}

export function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * How badly a value moved, as a sortable score, so the 10 samples printed per field are the ones
 * worth READING rather than the first ten by id. A green suite over clean inputs is not evidence
 * (CLAUDE.md); sorting by the value most likely to be wrong and looking at it is.
 *
 * For numbers the score is the RATIO, because the two normaliser bugs this repo has actually paid
 * for were both order-of-magnitude flips (1000x from a comma decimal, 1000x from a dropped "K"),
 * and a ratio puts those at the top of the list whatever the field's scale. A range or a struct
 * scores the worst ratio across its components. Anything not numeric scores by how much of the
 * list changed, always below the numeric band so a real magnitude flip is never buried under a
 * re-split list.
 */
export function changeMagnitude(oldV: unknown, newV: unknown): number {
  const ratio = (x: number, y: number): number => {
    if (x === y) return 1;
    const ax = Math.abs(x), ay = Math.abs(y);
    if (ax === 0 || ay === 0) return Math.max(ax, ay) > 0 ? 1e6 : 1;   // 0 -> non-zero is a total change
    return Math.max(ax / ay, ay / ax);
  };
  if (typeof oldV === "number" && typeof newV === "number") return ratio(oldV, newV);
  const num = (v: unknown): Record<string, number> | null => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const out: Record<string, number> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "number") out[k] = x;
    return Object.keys(out).length ? out : null;
  };
  const a = num(oldV), b = num(newV);
  if (a && b) {
    let worst = 1;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a) || !(k in b)) return 1e6;                          // an axis appeared or vanished
      worst = Math.max(worst, ratio(a[k], b[k]));
    }
    return worst;
  }
  if (Array.isArray(oldV) && Array.isArray(newV)) {
    const before = new Set(oldV.map((x) => JSON.stringify(x)));
    const after = new Set(newV.map((x) => JSON.stringify(x)));
    let moved = 0;
    for (const x of before) if (!after.has(x)) moved++;
    for (const x of after) if (!before.has(x)) moved++;
    return 1 + moved / 100;                                            // always below the numeric band
  }
  return sameValue(oldV, newV) ? 1 : 1.5;
}

/** A move this large is the signature of a unit or locale bug, not a rounding fix. */
export const MAGNITUDE_ALARM = 1000;

/**
 * Did a number change SIGN? Counted and reported on its own, never folded into the magnitude score,
 * and the first production dry run is why.
 *
 * QSFP-40G-SR4's storage temperature reads `–40 to 70°C` with an EN DASH, and the pre-1.5.0
 * tokeniser dropped the dash: the stored range is {min: 40, max: 70}, a storage floor of +40°C for
 * an optic. The replay restores {min: -40, max: 70} — a real fix, and the corpus holds ~1,332 of
 * them. Scoring a sign flip as a 1000x move (which it arithmetically is, from +40 to -40) put every
 * one of those into the same alarm as the "0.075 kg stored as 75" class of bug, where a single
 * genuine unit error would have been invisible among a thousand correct sign restorations.
 *
 * So they are separated: MAGNITUDE_1000X stays a refusal that blocks a commit, and sign restorations
 * get their own loud section in the report and their own counter. Both are printed; only one stops
 * the run.
 */
export function isSignFlip(oldV: unknown, newV: unknown): boolean {
  const pairs = (a: unknown, b: unknown): [number, number][] => {
    if (typeof a === "number" && typeof b === "number") return [[a, b]];
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const oa = a as Record<string, unknown>, ob = b as Record<string, unknown>;
      const out: [number, number][] = [];
      for (const k of Object.keys(oa)) if (typeof oa[k] === "number" && typeof ob[k] === "number") out.push([oa[k] as number, ob[k] as number]);
      return out;
    }
    return [];
  };
  return pairs(oldV, newV).some(([x, y]) => x !== y && (x < 0) !== (y < 0));
}

// ---- when the replay knows LESS than the original write did --------------------------------------
/**
 * THE CORRECTION THIS COMMAND'S FIRST DRY RUN BOUGHT, and it would have destroyed data.
 *
 * `raw` is not always enough to replay a fact, because two writers put information in the LABEL and
 * the label is only kept inside `raw` for rows written after apply-extract's `"<label> | <cell>"`
 * rule (112 rows in the whole corpus). Replaying the older rows re-runs the normaliser with strictly
 * less than the writer had, and the result LOOKS like a confident answer:
 *
 *   the UNIT lived in the label.   `dimensions` "1.73 x 17.5 x 16.1" is stored as
 *     {h: 43.942, w: 444.5, d: 408.94} mm — inches, converted, from a label that said so. Replayed
 *     from `raw` alone the normaliser correctly says UNIT_MISSING, and treating that as a quarantine
 *     would have RETRACTED 104 correct Cisco dimension facts on the first commit.
 *   the AXIS ORDER lived in the label.  deepSpecMap calls `reorderDimensions(label, value)` AFTER
 *     the normaliser, so "Dimensions (W x D x H)" is what turns three numbers into h/w/d. Replaying
 *     `raw` alone assigns them in written order, which for Meraki's "165.7 x 160.45 x 34.45mm"
 *     produced h=165.7 against the stored h=34.45 — the same three numbers, permuted. 255 of them.
 *
 * Neither is a value change and neither is a refusal: they are the replay being less informed than
 * the write. The fact is left EXACTLY as it is, counted under its own reason, and reported — a
 * recorded gap, never a guess and never a deletion (CLAUDE.md).
 *
 * The stored `unit` is NOT usable as a `unitHint` to fix the first case, and that is worth stating
 * because it is the obvious repair: the unit on the fact is the CANONICAL unit (mm), not the
 * label's source unit (inches). Feeding "mm" back in reads 1.73 inches as 1.73 mm — a 25.4x error,
 * comfortably inside every plausibility band.
 */
export function replayContextLost(
  row: { unit: string | null; value: unknown },
  n: { ok: true; value: unknown; unit?: string } | { ok: false; reason: string },
): string | null {
  if (!n.ok) {
    // the normaliser found no unit in `raw`, yet the stored fact has one: it came from the label
    if ((n.reason === "UNIT_MISSING" || n.reason === "UNIT_UNKNOWN") && row.unit != null && row.unit !== "") {
      return "UNIT_CAME_FROM_LABEL_NOT_IN_RAW";
    }
    return null;
  }
  return samePermutedNumbers(row.value, n.value) ? "AXIS_ORDER_NOT_IN_RAW" : null;
}

/**
 * Two objects holding the SAME multiset of numbers under a different key assignment.
 *
 * The tolerance is not decoration. A datasheet states one measurement twice — `1.06" x 5.83" x
 * 11.14"  27 x 148 x 283 mm` — and the two restatements round differently (1.06 in is 26.924 mm,
 * the vendor prints 27). The stored fact took one restatement and the replay takes the other, so an
 * exact multiset test calls a permutation a value change and hands 62 axis-permuted Meraki records
 * to the rewrite path. 0.5% is well under the 2% the merge layer already treats as agreement on
 * unit fields, and far under the 7.8% gap that separates the MS425 rows where the vendor's own
 * inch and centimetre figures genuinely disagree and the replay really does choose differently.
 */
export function samePermutedNumbers(a: unknown, b: unknown, tol = 0.005): boolean {
  const nums = (v: unknown): number[] | null => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const e = Object.values(v as Record<string, unknown>);
    return e.length > 1 && e.every((x) => typeof x === "number") ? (e as number[]).slice().sort((x, y) => x - y) : null;
  };
  const x = nums(a), y = nums(b);
  if (!x || !y || x.length !== y.length) return false;
  if (sameValue(a, b)) return false;                       // identical, not permuted
  const close = (p: number, q: number): boolean => {
    if (p === q) return true;
    const scale = Math.max(Math.abs(p), Math.abs(q));
    return scale > 0 && Math.abs(p - q) / scale <= tol;
  };
  // a permutation only when the sorted multisets match AND the key assignment actually moved
  if (!x.every((v, i) => close(v, y[i]))) return false;
  const ka = a as Record<string, number>, kb = b as Record<string, number>;
  return Object.keys(ka).some((k) => typeof kb[k] === "number" && !close(ka[k], kb[k]));
}

// ---- the rows --------------------------------------------------------------------------------
export type FactToCheck = {
  id: number; part_id: number; sku: string; field_key: string; category: string;
  value: unknown; unit: string | null; raw: string; state: string; tier: number; method: string;
  doc_id: string | null; locator: string | null; extracted_at: string | null; norm_v: string | null;
  inherited: boolean; inherited_from: string | null;
};

export type Outcome = "same" | "changed" | "refused" | "unrecoverable" | "protected";

/** An operator reviewed this fact. Tier 0 is the top of the ladder in `0001_init.sql`. */
export const OPERATOR_TIER = 0;

export type Verdict = {
  outcome: Outcome;
  reason?: string;               // refusal reason, or why it is unrecoverable
  newValue?: unknown;
  newUnit?: string;
  magnitude: number;
  selectedBy: "version" | "type" | "both";
};

/**
 * A TIER-0 FACT IS NOT A NORMALISER'S TO REWRITE.
 *
 * Tier 0 means an operator read the part and said what the value is (`0001_init.sql`: "0
 * operator-reviewed"); `hexcat_seed` is 21,724 such rows and the merge layer already leaves 733 of
 * them holding conflicts open rather than resolving against them. Renormalize replays a STRING
 * through a parser, which is the weakest kind of evidence there is, and without this it would
 * outrank the strongest: a rule change that reads "6 zl2-Modul-Steckplätze" differently would
 * supersede the operator's value, and a band tightened by one unit would RETRACT it into
 * `gap_unattempted` — silently, in the same command that legitimately rewrites 100k machine-read
 * facts, where 465 operator rows are a rounding error in the change share.
 *
 * So the verdict is downgraded to `protected` and the row is left alone. The would-be outcome and
 * reason are kept in `reason`, and `newValue` survives, because the point is not to hide the
 * disagreement — it is to put it in front of the person who owns the value instead of acting on it.
 * A `same` or an `unrecoverable` passes through untouched: neither writes a value.
 *
 * READ OVER THE REAL CORPUS (dry, first 20,000 rows, 4 Sep 2026): 14 protected, and every one is a
 * German seed row the current normaliser reads differently — `−8,5 dBm` stored as +8.5 and the
 * replay restoring the minus, `2,475 W (typisch)` stored as 2475 W, `8,928 Mpps` stored as 8928,
 * `12,9 W typisch / 16 W max` stored as the typical figure where the replay takes the maximum.
 * Several of those look like the replay being RIGHT, and that is the honest shape of this rule: the
 * command no longer fixes them, it hands them to the person who typed them
 * (`runs/reports/renormalize-tier0-<date>.jsonl`). The alternative is a parser overruling an
 * operator on 21,724 rows inside a run whose change share never notices — which is exactly what
 * would have happened on the first `--commit`.
 */
export function protectTier0(row: { tier: number }, v: Verdict): Verdict {
  if (row.tier !== OPERATOR_TIER) return v;
  if (v.outcome !== "changed" && v.outcome !== "refused") return v;
  return { ...v, outcome: "protected", reason: `TIER0_WOULD_${v.outcome.toUpperCase()}${v.reason ? `:${v.reason}` : ""}` };
}

/**
 * The decision for one stored fact. PURE — it takes the row and returns what should happen to it,
 * so the sabotage suite can drive every outcome without a database and the gate can re-derive a
 * sample from the row rather than from the plan.
 */
export function decide(row: FactToCheck, opts: { versionThreshold: string }): Verdict {
  const def = FIELD_DICTIONARY[row.field_key];
  const typeOk = def ? valueMatchesDictType(row.value, def.type, def.shape) : true;
  const versionOld = semverLess(row.norm_v, opts.versionThreshold);
  const selectedBy: Verdict["selectedBy"] = versionOld && !typeOk ? "both" : (typeOk ? "version" : "type");

  const raw = String(row.raw ?? "");
  if (raw.trim() === "") {
    // A gap row never carried a value and never went through the normaliser; a row that DID carry
    // a value but lost its raw is a different and much worse thing. Named apart so the second can
    // never hide inside the count of the first.
    return {
      outcome: "unrecoverable", magnitude: 1, selectedBy,
      reason: row.value === null || row.value === undefined ? "GAP_ROW_NEVER_NORMALISED" : "RAW_LOST_VALUE_PRESENT",
    };
  }

  const n = normalizeField(row.category, row.field_key, raw, { locale: localeForMethod(row.method) });

  // BEFORE anything is called a refusal or a change: is this replay simply less informed than the
  // write was? A unit or an axis order that lived in the label is not in `raw`, and acting on that
  // would retract or permute a correct fact. See replayContextLost.
  const lost = replayContextLost(row, n);
  if (lost) return { outcome: "unrecoverable", reason: lost, magnitude: 1, selectedBy };

  if (!n.ok) return protectTier0(row, { outcome: "refused", reason: n.reason, magnitude: Number.POSITIVE_INFINITY, selectedBy });
  if (def && !valueMatchesDictType(n.value, def.type, def.shape)) {
    return protectTier0(row, { outcome: "refused", reason: "SHAPE_STILL_WRONG", magnitude: Number.POSITIVE_INFINITY, selectedBy });
  }
  const unitSame = (n.unit ?? null) === (row.unit ?? null);
  if (sameValue(row.value, n.value) && unitSame) return { outcome: "same", magnitude: 1, selectedBy };
  return protectTier0(row, {
    outcome: "changed", newValue: n.value, newUnit: n.unit,
    magnitude: unitSame ? changeMagnitude(row.value, n.value) : Math.max(changeMagnitude(row.value, n.value), 1e6),
    selectedBy,
  });
}

// ---- the effects -------------------------------------------------------------------------------
/**
 * `same`: stamp the row with the version that produced it, IN PLACE, and justify it.
 *
 * This is an UPDATE on the facts table and the hard rule is "never overwrite a fact", so it needs
 * the same argument restampTiers makes for `tier`. `norm_v` is not an observation about the part:
 * it is a note saying WHICH normaliser produced the value in this row. Here the current normaliser
 * has just produced that exact value and unit from that exact `raw` — the note is simply out of
 * date, and correcting it changes nothing a reader of the fact can see. The value, raw, unit,
 * doc_id, locator, state, tier and evidence are untouched, and the statement says so by naming the
 * only column it sets.
 *
 * The alternative — superseding — would write a second row with an identical value for every one of
 * ~98k facts, double the table, reset every created_at (so "what changed since" would report the
 * entire corpus as changed on 4 Sep) and record nothing that this run's own counters do not.
 */
export async function restampNormV(client: Queryable, ids: number[], version: string): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await client.query(
    "UPDATE facts SET norm_v = $2 WHERE id = ANY($1::bigint[]) AND superseded_by IS NULL", [ids, version]);
  return r.rowCount ?? 0;
}

/** The replacement row for a `changed` fact: a new VALUE, everything else carried across unchanged. */
export function entryFor(row: FactToCheck, v: Verdict): SpecEntry {
  return {
    k: row.field_key, raw: row.raw, value: v.newValue, unit: v.newUnit,
    state: row.state as SpecEntry["state"],
    inherited: row.inherited, inherited_from: row.inherited_from ?? undefined,
    prov: {
      tier: row.tier, method: row.method, norm_v: NORM_VERSION,
      ...(row.doc_id ? { doc_id: row.doc_id } : {}),
      ...(row.locator ? { locator: row.locator } : {}),
      ...(row.extracted_at ? { extracted_at: row.extracted_at } : {}),
    },
  };
}

// ---- selection ---------------------------------------------------------------------------------
const SELECT_COLUMNS = `f.id, f.part_id, p.sku, f.field_key, c.slug AS category, f.value, f.unit, f.raw,
  f.state::text AS state, f.tier, f.method, f.doc_id, f.locator, f.extracted_at::text AS extracted_at,
  f.norm_v, f.inherited, f.inherited_from`;

/**
 * The stamps in the database that are older than the threshold, asked rather than assumed.
 *
 * Semver is compared in TypeScript, never in SQL — Postgres would compare the text and put "1.10.0"
 * before "1.5.0". The distinct list of stamps is tiny (five values today), so the query resolves
 * which of them are old and the row filter is then a plain `= ANY`, which is exact and uses the index.
 */
export async function oldVersions(db: Queryable, threshold: string): Promise<{ old: string[]; hasNull: boolean; all: string[] }> {
  const r = await db.query<{ norm_v: string | null }>(
    "SELECT DISTINCT norm_v FROM facts WHERE superseded_by IS NULL");
  const all = r.rows.map((x) => x.norm_v).filter((x): x is string => x != null);
  return { old: all.filter((v) => semverLess(v, threshold)), hasNull: r.rows.some((x) => x.norm_v == null), all };
}

/**
 * One keyset page of the selection. Keyset rather than OFFSET because the pass rewrites rows as it
 * goes in commit mode, and an OFFSET walk over a table being written to skips rows silently.
 */
export async function selectPage(
  db: Queryable,
  opts: { field: string | null; old: string[]; hasNull: boolean; typeKeys: string[]; typeTypes: string[]; typeShapes: string[]; afterId: number; batch: number },
): Promise<FactToCheck[]> {
  const params: unknown[] = [opts.afterId, opts.old, opts.typeKeys, opts.typeTypes];
  let fieldClause = "";
  if (opts.field) { params.push(opts.field); fieldClause = ` AND f.field_key = $${params.length}`; }
  // Two reasons a row is selected, OR'd: an old version stamp, or a value whose JSON shape cannot
  // be what its dictionary type says. The shape half is expressed in SQL only as far as jsonb_typeof
  // can carry it; `valueMatchesDictType` in decide() is the authority and re-checks every row.
  const sql = `
    SELECT ${SELECT_COLUMNS}
      FROM facts f
      JOIN parts p ON p.id = f.part_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN unnest($3::text[], $4::text[]) AS dict(key, type) ON dict.key = f.field_key
     WHERE f.superseded_by IS NULL
       AND f.id > $1${fieldClause}
       AND (
         (f.norm_v IS NULL AND ${opts.hasNull ? "true" : "false"})
         OR f.norm_v = ANY($2::text[])
         OR (f.value IS NOT NULL AND dict.type IS NOT NULL AND CASE dict.type
               WHEN 'n'  THEN jsonb_typeof(f.value) <> 'number'
               WHEN 'b'  THEN jsonb_typeof(f.value) <> 'boolean'
               WHEN 's'  THEN jsonb_typeof(f.value) <> 'string'
               WHEN 'e'  THEN jsonb_typeof(f.value) <> 'string'
               WHEN 'ls' THEN jsonb_typeof(f.value) <> 'array'
               WHEN 'nr' THEN jsonb_typeof(f.value) <> 'object'
               ELSE false END)
       )
     ORDER BY f.id
     LIMIT ${Number(opts.batch)}`;
  const r = await db.query<FactToCheck>(sql, params);
  return r.rows;
}

// ---- counting ------------------------------------------------------------------------------------
export type FieldCounts = { same: number; changed: number; refused: number; unrecoverable: number; protected: number };
export type Sample = { id: number; sku: string; field: string; magnitude: number; raw: string; from: unknown; to: unknown; reason?: string };

export type RenormReport = {
  selected: number;
  byOutcome: FieldCounts;
  byField: Record<string, FieldCounts>;
  refusalReasons: Record<string, number>;
  unrecoverableReasons: Record<string, number>;
  selectedBy: Record<string, number>;
  samples: Record<Outcome, Sample[]>;
  magnitudeAlarms: Sample[];
  /** numbers whose SIGN was restored — reported loudly, but not a refusal (see isSignFlip) */
  signFlips: Sample[];
  signFlipCount: number;
  /** every tier-0 row the replay wanted to change or refuse, listed for the operator (protectTier0) */
  protectedFacts: Sample[];
  protectedReasons: Record<string, number>;
  /**
   * Rows that reached the effect stage still carrying a tier-0 write. Empty unless protectTier0
   * stopped protecting: the write is refused a second time here and the gate fails on it, so the
   * loss of the protection can never be silent. This is the sabotage twin's landing site.
   */
  tier0Violations: Sample[];
};

export function emptyCounts(): FieldCounts { return { same: 0, changed: 0, refused: 0, unrecoverable: 0, protected: 0 }; }

/**
 * How many rows actually reached a named outcome, counted from the OUTCOME COUNTERS rather than
 * from the loop that walked them. That distinction is the whole recall gate: the caller used to
 * hand the gate `selected` twice, so `classified / selected` was 1 by construction and a row that
 * fell through every branch would have passed a check written to catch exactly that.
 */
export function classifiedCount(c: FieldCounts): number {
  return c.same + c.changed + c.refused + c.unrecoverable + c.protected;
}

/** Keeps the worst `n` samples per outcome by magnitude, without holding the whole corpus. */
export class TopSamples {
  private readonly by = new Map<Outcome, Sample[]>();
  constructor(private readonly n: number) {}
  add(o: Outcome, s: Sample): void {
    const list = this.by.get(o) ?? [];
    list.push(s);
    list.sort((a, b) => b.magnitude - a.magnitude || a.id - b.id);
    if (list.length > this.n) list.length = this.n;
    this.by.set(o, list);
  }
  get(o: Outcome): Sample[] { return this.by.get(o) ?? []; }
  all(): Record<Outcome, Sample[]> {
    return {
      same: this.get("same"), changed: this.get("changed"), refused: this.get("refused"),
      unrecoverable: this.get("unrecoverable"), protected: this.get("protected"),
    };
  }
}

// ---- the gate ---------------------------------------------------------------------------------
export type RenormGate = {
  precision: number; recall: number; passed: boolean;
  selected: number; classified: number; sampled: number;
  change_share: number; max_change_share: number;
  magnitude_alarms: number; allow: string | null;
  tier0_protected: number; tier0_violations: number;
  misses: string[]; verdict: string;
};

/**
 * The two things that must be true before ~100k facts are rewritten, and each has a sabotage case
 * in tests/db/renormalize.test.ts.
 *
 *   recall     every selected row reached a named outcome. A row that fell through would be a
 *              silent skip, and a silent skip is how a fact gets lost (CLAUDE.md). `classified` is
 *              COUNTED FROM THE OUTCOME TALLY, never taken from the caller: the one caller used to
 *              pass `selected` as both numbers, so the ratio was 1 whatever the pass had done and
 *              this check had never been able to fail. Two counters that are incremented in
 *              different places is the only version of it that is worth anything.
 *   precision  a sample of the decisions is re-derived from the ROW and must reach the same
 *              outcome and the same value. A `same` whose values actually differ, or a `changed`
 *              whose new value equals the old, is a bookkeeping error being laundered into a write.
 *
 * plus the two REFUSALS the command exists for, both liftable only by `--allow "reason"`:
 *   CHANGE_SHARE_EXCEEDED   more than `maxShare` of the selection would change value
 *   MAGNITUDE_1000X         some value moves by a factor of 1000 or more
 */
export function gateRenormalize(
  opts: { selected: number; report: RenormReport; recheck: { row: FactToCheck; planned: Verdict; again: Verdict }[]; maxShare: number; allow: string | null; versionThreshold: string },
): RenormGate {
  const misses: string[] = [];
  const classified = classifiedCount(opts.report.byOutcome);
  const recall = opts.selected === 0 ? (classified === 0 ? 1 : 0) : classified / opts.selected;
  if (classified !== opts.selected) {
    misses.push(`RECALL ${classified} of ${opts.selected} selected rows reached an outcome (same ${opts.report.byOutcome.same}, changed ${opts.report.byOutcome.changed}, refused ${opts.report.byOutcome.refused}, unrecoverable ${opts.report.byOutcome.unrecoverable}, protected ${opts.report.byOutcome.protected})`);
  }

  let ok = 0;
  for (const { row, planned, again } of opts.recheck) {
    if (again.outcome !== planned.outcome) {
      misses.push(`NOT_REPRODUCED fact ${row.id} ${row.sku}/${row.field_key}: planned ${planned.outcome}, re-derived ${again.outcome}`);
      continue;
    }
    if (planned.outcome === "changed" && !sameValue(planned.newValue, again.newValue)) {
      misses.push(`VALUE_NOT_REPRODUCED fact ${row.id} ${row.sku}/${row.field_key}`);
      continue;
    }
    if (planned.outcome === "same" && !sameValue(row.value, again.newValue ?? row.value)) {
      misses.push(`SAME_IS_NOT_SAME fact ${row.id} ${row.sku}/${row.field_key}: re-stamping a row whose value moved`);
      continue;
    }
    if (planned.outcome === "changed" && sameValue(row.value, planned.newValue) && (row.unit ?? null) === (planned.newUnit ?? null)) {
      misses.push(`CHANGED_IS_UNCHANGED fact ${row.id} ${row.sku}/${row.field_key}: superseding a row with its own value`);
      continue;
    }
    ok++;
  }
  const precision = opts.recheck.length === 0 ? 1 : ok / opts.recheck.length;

  // `protected` is deliberately outside the denominator: those rows are not rewritten by this
  // command at all, so counting them would dilute the share that measures how much of the corpus a
  // commit would move. They have their own count, their own list and their own gate line.
  const considered = opts.report.byOutcome.same + opts.report.byOutcome.changed + opts.report.byOutcome.refused;
  const share = considered === 0 ? 0 : opts.report.byOutcome.changed / considered;
  if (share > opts.maxShare && !opts.allow) {
    misses.push(`CHANGE_SHARE_EXCEEDED ${(share * 100).toFixed(1)}% of ${considered} replayable rows change value, over the ${(opts.maxShare * 100).toFixed(0)}% ceiling — a normaliser bug rewrites the corpus this way. Read the samples, then re-run with --allow "reason"`);
  }
  const alarms = opts.report.magnitudeAlarms.length;
  if (alarms > 0 && !opts.allow) {
    misses.push(`MAGNITUDE_1000X ${alarms} value(s) move by a factor of ${MAGNITUDE_ALARM} or more — the shape of a unit or locale bug. Read them, then re-run with --allow "reason"`);
  }
  // NOT liftable by --allow: an operator's own value is not a share to be tuned. Non-empty means
  // protectTier0 has stopped protecting, which is a code fault, not a judgement call.
  const violations = opts.report.tier0Violations.length;
  if (violations > 0) {
    misses.push(`TIER0_WRITE_ATTEMPTED ${violations} operator-reviewed fact(s) reached the write path (first: ${opts.report.tier0Violations[0].sku} ${opts.report.tier0Violations[0].field} #${opts.report.tier0Violations[0].id}) — tier 0 is never superseded or retracted by a normaliser replay`);
  }

  const passed = recall === 1 && precision === 1 && misses.length === 0;
  return {
    precision, recall, passed,
    selected: opts.selected, classified, sampled: opts.recheck.length,
    change_share: share, max_change_share: opts.maxShare, magnitude_alarms: alarms, allow: opts.allow,
    tier0_protected: opts.report.byOutcome.protected, tier0_violations: violations,
    misses: misses.slice(0, 40),
    verdict: passed ? "PASS" : `FAIL: ${misses.length} miss(es), recall ${recall.toFixed(4)}, precision ${precision.toFixed(4)}`,
  };
}

// ---- the pass -----------------------------------------------------------------------------------
export type PassResult = { report: RenormReport; effects: Record<string, number>; recheck: { row: FactToCheck; planned: Verdict; again: Verdict }[] };

/**
 * The value line of a sample. A `same` row prints its ONE stored value and never an arrow.
 *
 * `decide` returns no `newValue` for `same` — the value did not move, so there is nothing to put
 * on the right of an arrow — and the sample carries `to: v.newValue ?? null`. Rendering every
 * outcome as `from -> to` therefore printed `56 -> null` for a row that was only being re-stamped,
 * which reads as "this fact is about to be emptied". It cost a reviewer a cycle on a box dry run
 * (5 Sep 2026) before anyone could say the rows were untouched. The outcome decides the shape of
 * the line, so a value-preserving outcome cannot render as a value-destroying one.
 */
export function sampleValueLine(outcome: Outcome, x: { from: unknown; to: unknown }, n = 90): string {
  if (outcome === "same") return `${shorten(x.from, n)}  (unchanged — norm_v re-stamped only)`;
  if (outcome === "unrecoverable") return `${shorten(x.from, n)}  (left untouched)`;
  return `${shorten(x.from, n)}  ->  ${shorten(x.to, n)}`;
}

const shorten = (s: unknown, n = 70): string => { const t = typeof s === "string" ? s : JSON.stringify(s); return t == null ? "null" : (t.length > n ? t.slice(0, n) + "…" : t); };

/**
 * Walk the selection, decide each row, and — when `commit` — perform the effect. A `same` is
 * batched into one UPDATE per page; a `changed` and a `refused` each run in their own transaction,
 * because a supersede is three statements that must not be interleaved (see supersedeFact).
 */
export async function runPass(
  db: Queryable, runId: number,
  opts: { commit: boolean; field: string | null; limit: number | null; batch: number; examples: number; versionThreshold: string; recheckEvery: number },
  onProgress?: (n: number) => void,
): Promise<PassResult> {
  const keys = Object.keys(FIELD_DICTIONARY);
  const typeTypes = keys.map((k) => FIELD_DICTIONARY[k].type);
  const typeShapes = keys.map((k) => FIELD_DICTIONARY[k].shape ?? "");
  const { old, hasNull } = await oldVersions(db, opts.versionThreshold);

  const report: RenormReport = {
    selected: 0, byOutcome: emptyCounts(), byField: {}, refusalReasons: {}, unrecoverableReasons: {},
    selectedBy: {}, samples: { same: [], changed: [], refused: [], unrecoverable: [], protected: [] },
    magnitudeAlarms: [], signFlips: [], signFlipCount: 0,
    protectedFacts: [], protectedReasons: {}, tier0Violations: [],
  };
  const tops = new TopSamples(opts.examples);
  const perFieldTops = new Map<string, TopSamples>();
  const effects: Record<string, number> = { restamped: 0, superseded: 0, retracted: 0 };
  const recheck: { row: FactToCheck; planned: Verdict; again: Verdict }[] = [];
  const refusalLines: string[] = [];
  const protectedLines: string[] = [];

  let afterId = 0;
  let classified = 0;
  for (;;) {
    const remaining = opts.limit === null ? opts.batch : Math.min(opts.batch, opts.limit - report.selected);
    if (remaining <= 0) break;
    const rows = await selectPage(db, { field: opts.field, old, hasNull, typeKeys: keys, typeTypes, typeShapes, afterId, batch: remaining });
    if (rows.length === 0) break;
    afterId = rows[rows.length - 1].id;

    const toRestamp: number[] = [];
    for (const row of rows) {
      report.selected++;
      const v = decide(row, { versionThreshold: opts.versionThreshold });
      classified++;
      report.byOutcome[v.outcome]++;
      report.selectedBy[v.selectedBy] = (report.selectedBy[v.selectedBy] ?? 0) + 1;
      const fc = (report.byField[row.field_key] ??= emptyCounts());
      fc[v.outcome]++;

      const sample: Sample = {
        id: row.id, sku: row.sku, field: row.field_key, magnitude: v.magnitude,
        raw: shorten(row.raw), from: row.value, to: v.newValue ?? null, ...(v.reason ? { reason: v.reason } : {}),
      };
      tops.add(v.outcome, sample);
      (perFieldTops.get(row.field_key) ?? perFieldTops.set(row.field_key, new TopSamples(opts.examples)).get(row.field_key)!).add(v.outcome, sample);

      // the precision sample is taken by STRIDE over the walk, so it is spread across the corpus
      // rather than concentrated in the first page (the extract gate sampled the head of a file
      // and it is a named lesson in CLAUDE.md)
      if (classified % opts.recheckEvery === 0) recheck.push({ row, planned: v, again: decide(row, { versionThreshold: opts.versionThreshold }) });

      if (v.outcome === "protected") {
        report.protectedReasons[`${row.field_key}:${v.reason}`] = (report.protectedReasons[`${row.field_key}:${v.reason}`] ?? 0) + 1;
        if (report.protectedFacts.length < 500) report.protectedFacts.push(sample);
        protectedLines.push(JSON.stringify({
          fact_id: row.id, part_id: row.part_id, sku: row.sku, field: row.field_key, reason: v.reason,
          raw: row.raw, kept_value: row.value, would_be_value: v.newValue ?? null, unit: row.unit,
          tier: row.tier, method: row.method, doc_id: row.doc_id, norm_v: row.norm_v, run_id: runId || null,
        }));
        continue;
      }
      // The second lock on the same door. Only reachable when protectTier0 has been broken, and it
      // is here rather than only in decide() because that is the difference between a protection
      // and a protection that has been proved: the sabotage twin reverts decide's downgrade, this
      // refuses the write anyway, and the gate goes red naming the fact (CLAUDE.md §3).
      if (row.tier === OPERATOR_TIER && (v.outcome === "changed" || v.outcome === "refused")) {
        report.tier0Violations.push(sample);
        continue;
      }
      if (v.outcome === "same") { toRestamp.push(row.id); continue; }
      if (v.outcome === "unrecoverable") {
        report.unrecoverableReasons[v.reason ?? "?"] = (report.unrecoverableReasons[v.reason ?? "?"] ?? 0) + 1;
        continue;
      }
      if (v.outcome === "refused") {
        report.refusalReasons[`${row.field_key}:${v.reason}`] = (report.refusalReasons[`${row.field_key}:${v.reason}`] ?? 0) + 1;
        refusalLines.push(JSON.stringify({
          fact_id: row.id, part_id: row.part_id, sku: row.sku, field: row.field_key, reason: v.reason,
          raw: row.raw, old_value: row.value, unit: row.unit, method: row.method, doc_id: row.doc_id,
          norm_v_before: row.norm_v, norm_v: NORM_VERSION, run_id: runId || null,
        }));
        if (opts.commit) {
          await withTx((c) => retractFact(c, row.id, `renormalize:${v.reason}`, runId));
          effects.retracted++;
        }
        continue;
      }
      // changed
      if (v.magnitude >= MAGNITUDE_ALARM && report.magnitudeAlarms.length < 200) report.magnitudeAlarms.push(sample);
      if (isSignFlip(row.value, v.newValue)) { report.signFlipCount++; if (report.signFlips.length < 200) report.signFlips.push(sample); }
      if (opts.commit) {
        await withTx((c) => supersedeFact(c, row.id, entryFor(row, v), runId));
        effects.superseded++;
      }
    }
    if (opts.commit && toRestamp.length) effects.restamped += await restampNormV(db, toRestamp, NORM_VERSION);
    onProgress?.(report.selected);
    if (rows.length < remaining) break;
  }

  report.samples = tops.all();
  // the per-field top-10 the operator is asked to READ
  (report as RenormReport & { perField?: Record<string, Record<string, Sample[]>> }).perField = Object.fromEntries(
    [...perFieldTops.entries()].map(([k, t]) => [k, { changed: t.get("changed"), refused: t.get("refused"), protected: t.get("protected") }]));
  (report as RenormReport & { refusalLines?: string[] }).refusalLines = refusalLines;
  (report as RenormReport & { protectedLines?: string[] }).protectedLines = protectedLines;
  return { report, effects, recheck };
}

// ---- main -----------------------------------------------------------------------------------------
export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  const threshold = a.sinceVersion ?? NORM_VERSION;
  const pool = getPool();
  const date = new Date().toISOString().slice(0, 10);

  const { old, hasNull, all } = await oldVersions(pool, threshold);
  console.log(`renormalize — current normaliser ${NORM_VERSION}, selecting stamps older than ${threshold}`);
  console.log(`  stamps in the database: ${all.length ? all.join(", ") : "(none)"}${hasNull ? ", plus NULL" : ""}`);
  console.log(`  treated as old: ${old.length ? old.join(", ") : "(none)"}${hasNull ? ", NULL" : ""}`);
  if (a.field) console.log(`  field filter: ${a.field}`);
  if (a.limit) console.log(`  limit: ${a.limit}`);

  // DRY FIRST, ALWAYS. Even a --commit run plans the whole selection read-only and puts it through
  // the gate before a single row is written: the change-share ceiling cannot be judged from a
  // partially applied corpus, and a run that discovered its own refusal half way through would
  // already have rewritten the first half.
  const plan = await runPass(pool, 0, {
    commit: false, field: a.field, limit: a.limit, batch: a.batch, examples: a.examples,
    versionThreshold: threshold, recheckEvery: 37,
  }, (n) => { if (n % 20000 === 0) console.log(`  … ${n} rows planned`); });

  // `classified` is not passed: the gate counts it from the outcome tally, so the two numbers come
  // from different counters and RECALL can actually fail.
  const gate = gateRenormalize({
    selected: plan.report.selected, report: plan.report,
    recheck: plan.recheck, maxShare: a.maxChangeShare, allow: a.allow, versionThreshold: threshold,
  });

  let runId: number | null = null;
  let effects = plan.effects;
  if (a.commit) {
    const inputs = {
      command: "renormalize", field: a.field, since_version: threshold, limit: a.limit,
      norm_v: NORM_VERSION, max_change_share: a.maxChangeShare, allow: a.allow,
    };
    const out = await withRun("apply-renormalize", inputs, async (id) => {
      if (!gate.passed) throw new Error(`gate did not pass (${gate.verdict}): ${JSON.stringify(gate.misses.slice(0, 3))}`);
      const done = await runPass(pool, id, {
        commit: true, field: a.field, limit: a.limit, batch: a.batch, examples: a.examples,
        versionThreshold: threshold, recheckEvery: 37,
      }, (n) => { if (n % 20000 === 0) console.log(`  … ${n} rows written`); });
      effects = done.effects;
      return {
        stats: { ...countsToStats(done.report), ...done.effects },
        gate,
        notes: `renormalize to ${NORM_VERSION}${a.field ? ` field=${a.field}` : ""}; changed share ${(gate.change_share * 100).toFixed(2)}%${a.allow ? `; ALLOWED: ${a.allow}` : ""}`,
      };
    });
    runId = out.runId;
  }

  // ---- report --------------------------------------------------------------------------------
  const r = plan.report;
  console.log(`\n${a.commit ? `COMMITTED run ${runId}` : "DRY RUN — no writes"}   selected: ${r.selected}`);
  console.log(`  same ${r.byOutcome.same}   changed ${r.byOutcome.changed}   refused ${r.byOutcome.refused}   unrecoverable ${r.byOutcome.unrecoverable}   protected(tier 0) ${r.byOutcome.protected}`);
  console.log(`  selected by: ${JSON.stringify(r.selectedBy)}`);
  if (a.commit) console.log(`  EFFECTS: ${JSON.stringify(effects)}`);

  console.log(`\nPER FIELD (changed first)`);
  const fields = Object.entries(r.byField).sort((x, y) => y[1].changed - x[1].changed || y[1].refused - x[1].refused).slice(0, 30);
  for (const [k, c] of fields) {
    console.log(`  ${k.padEnd(26)} same ${String(c.same).padStart(6)}  changed ${String(c.changed).padStart(6)}  refused ${String(c.refused).padStart(5)}  unrecoverable ${String(c.unrecoverable).padStart(5)}  protected ${String(c.protected).padStart(5)}`);
  }

  if (Object.keys(r.refusalReasons).length) {
    console.log(`\nREFUSAL REASONS`);
    for (const [k, v] of Object.entries(r.refusalReasons).sort((x, y) => y[1] - x[1]).slice(0, 20)) console.log(`  ${String(v).padStart(6)}  ${k}`);
  }
  if (Object.keys(r.unrecoverableReasons).length) {
    console.log(`\nUNRECOVERABLE (counted, untouched)`);
    for (const [k, v] of Object.entries(r.unrecoverableReasons).sort((x, y) => y[1] - x[1])) console.log(`  ${String(v).padStart(6)}  ${k}`);
  }
  if (r.byOutcome.protected) {
    console.log(`\nTIER 0 PROTECTED (operator-reviewed, left exactly as they are) — ${r.byOutcome.protected} fact(s).`);
    console.log(`  The replay disagrees with a value a person put there. That is a review item, not a write.`);
    for (const [k, v] of Object.entries(r.protectedReasons).sort((x, y) => y[1] - x[1]).slice(0, 20)) console.log(`  ${String(v).padStart(6)}  ${k}`);
    for (const x of r.protectedFacts.slice(0, 20)) {
      console.log(`   ${x.sku} ${x.field} #${x.id}  KEPT ${shorten(x.from, 40)}  (replay wanted ${shorten(x.to, 40)})   raw ${x.raw}`);
    }
  }

  for (const o of ["changed", "refused", "same", "unrecoverable"] as Outcome[]) {
    const s = r.samples[o];
    if (!s.length) continue;
    console.log(`\nTOP ${s.length} ${o.toUpperCase()} by magnitude of change`);
    for (const x of s) {
      console.log(`  x${x.magnitude === Number.POSITIVE_INFINITY ? "inf" : x.magnitude.toFixed(2)}  ${x.sku} ${x.field} #${x.id}${x.reason ? ` [${x.reason}]` : ""}`);
      console.log(`        raw  ${x.raw}`);
      console.log(`        ${sampleValueLine(o, x)}`);
    }
  }

  if (r.signFlipCount) {
    console.log(`\n~~ ${r.signFlipCount} SIGN RESTORATION(S) — a number changed sign. Expected from the 1.5.0 leading-minus fix ("–40 to 70°C" stored as +40); counted apart from the magnitude alarm so a thousand correct ones cannot hide a real unit bug. Read a few:`);
    for (const x of r.signFlips.slice(0, 10)) console.log(`   ${x.sku} ${x.field} #${x.id}  ${shorten(x.from, 40)} -> ${shorten(x.to, 40)}   raw ${x.raw}`);
  }

  if (r.magnitudeAlarms.length) {
    console.log(`\n!! ${r.magnitudeAlarms.length} CHANGE(S) OF ${MAGNITUDE_ALARM}x OR MORE — read every one before committing; this is what a unit or locale bug looks like`);
    for (const x of r.magnitudeAlarms.slice(0, 20)) console.log(`   ${x.sku} ${x.field} #${x.id}  ${shorten(x.from, 40)} -> ${shorten(x.to, 40)}   raw ${x.raw}`);
  }

  console.log(`\nGATE ${gate.verdict}`);
  console.log(`  precision ${gate.precision.toFixed(4)}  recall ${gate.recall.toFixed(4)} (${gate.classified} of ${gate.selected} classified)  (re-derived ${gate.sampled})`);
  console.log(`  tier 0: ${gate.tier0_protected} protected, ${gate.tier0_violations} write(s) attempted`);
  console.log(`  change share ${(gate.change_share * 100).toFixed(2)}% of ${r.byOutcome.same + r.byOutcome.changed + r.byOutcome.refused} replayable (ceiling ${(a.maxChangeShare * 100).toFixed(0)}%)${a.allow ? `  ALLOWED: ${a.allow}` : ""}`);
  for (const m of gate.misses) console.log(`  MISS ${m}`);

  // ---- files ---------------------------------------------------------------------------------
  const dir = path.join(REPO_ROOT, "runs", "reports");
  fs.mkdirSync(dir, { recursive: true });
  const lines = (plan.report as RenormReport & { refusalLines?: string[] }).refusalLines ?? [];
  if (lines.length) {
    const jsonl = path.join(dir, `renormalize-${date}.jsonl`);
    fs.appendFileSync(jsonl, lines.join("\n") + "\n");
    console.log(`\n${lines.length} refusal(s) appended -> ${path.relative(REPO_ROOT, jsonl)}`);
  }
  // The protected list is the operator's review queue, so it survives the terminal exactly as the
  // refusals do — a count on screen is not a list anyone can work from.
  const protLines = (plan.report as RenormReport & { protectedLines?: string[] }).protectedLines ?? [];
  if (protLines.length) {
    const jsonl = path.join(dir, `renormalize-tier0-${date}.jsonl`);
    fs.appendFileSync(jsonl, protLines.join("\n") + "\n");
    console.log(`${protLines.length} tier-0 protected fact(s) appended -> ${path.relative(REPO_ROOT, jsonl)}`);
  }
  const summary = path.join(dir, `renormalize-${date}${a.commit ? "" : "-dry"}${a.field ? `-${a.field}` : ""}.json`);
  fs.writeFileSync(summary, JSON.stringify({
    generated_at: new Date().toISOString(), commit: a.commit, run_id: runId, norm_v: NORM_VERSION,
    since_version: threshold, field: a.field, limit: a.limit, allow: a.allow,
    stats: countsToStats(r), effects, gate,
    by_field: r.byField, refusal_reasons: r.refusalReasons, unrecoverable_reasons: r.unrecoverableReasons,
    samples: r.samples, per_field: (r as RenormReport & { perField?: unknown }).perField,
    magnitude_alarms: r.magnitudeAlarms, sign_flips: r.signFlips, sign_flip_count: r.signFlipCount,
    tier0_protected: r.protectedFacts, tier0_protected_reasons: r.protectedReasons,
    tier0_violations: r.tier0Violations,
    locale_rule: "method=hexcat_seed -> de, everything else -> en (no locale is recorded on facts or source_docs; this reproduces what each writer passed)",
  }, null, 1));
  console.log(`report -> ${path.relative(REPO_ROOT, summary)}`);

  await closePool();
  if (!gate.passed && a.commit) process.exitCode = 1;
}

function countsToStats(r: RenormReport): Record<string, number> {
  return {
    selected: r.selected, same: r.byOutcome.same, changed: r.byOutcome.changed,
    refused: r.byOutcome.refused, unrecoverable: r.byOutcome.unrecoverable,
    tier0_protected: r.byOutcome.protected, tier0_violations: r.tier0Violations.length,
    magnitude_alarms: r.magnitudeAlarms.length, sign_flips: r.signFlipCount,
  };
}

if (process.argv[1] && /renormalize\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
