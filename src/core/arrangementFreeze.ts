// src/core/arrangementFreeze.ts — the phase-1 freeze: everything the filling phase measures against, pinned as
// ONE unit (docs/reports/phase1-close-guide-2026-09-13.md §4).
//
// WHY ONE UNIT. A completeness percentage is a ratio over a table: which parts exist in which kind, which cups each
// kind is asked, what each cup accepts, where each label pours, which derivations count as taps, which document
// classes count as held. If any of those moves silently, today's 31% and tomorrow's 33% are measured over two
// different tables and the difference means nothing. So the pieces are hashed together; the freeze hash is printed
// by the completeness report, and tests/arrangementFreeze.test.ts fails when the code no longer reproduces the
// committed data/freeze/<vendor>.json. Changing the arrangement is allowed — as a recorded decision that rebuilds
// the freeze file on the same commit (CLAUDE.md "The arrangement is frozen").
//
// PURE over code and committed files, so the test needs no database. The one input that needs the store — which
// live hardware parts exist, with their names — is captured by the builder as a snapshot file
// (data/freeze/<vendor>-kinds.tsv), and the test re-derives every kind from it with the live classifier.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { profileHash, LEDGER_KINDS } from "./cupLedger.js";
import { FIELD_DICTIONARY, SUPERSEDED_KEYS } from "./fieldSchema.js";
import { SPEC_BEARING } from "./docClass.js";
import { DERIVED_FILL_PATHS } from "./derivedFillPaths.js";
import { partKind } from "./partKind.js";
// kind-layer infra (13 Sep 2026): layer 3 joins the freeze — the role rule table and the role of every live part.
import { RULES, STRIP, ROLE_DOMAINS, deployRole, roleAxisOf, type Rule } from "./deployRole.js";

export const sha = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

/** Stable JSON: object keys sorted at every level, so a hash does not depend on insertion order. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * One live hardware part as frozen. `deploy_role` (kind-layer infra, 13 Sep 2026) is the fifth column: the derived role,
 * `""` when the part has none (no role axis for its kind, or no rule places it). It is `undefined` only for a snapshot
 * written before the column existed — a different state from "no role", and reported as such by the test.
 */
export type KindRow = { category: string; sku: string; name: string; kind: string; deploy_role?: string };

const flatName = (name: string): string => name.replace(/[\t\r\n]+/g, " ");

/** The snapshot's line format. Tabs and newlines inside a name are flattened to spaces, deliberately and visibly. */
export const kindLine = (r: KindRow): string =>
  [r.category, r.sku, flatName(r.name), r.kind, r.deploy_role ?? ""].join("\t");

/**
 * The KIND projection of a row — the four columns the kind unit has always hashed. Kept separate so adding the role
 * column moves the role unit and not the kind unit: a mapping hash that changed for a reason unrelated to kinds would
 * send a reader looking for a kind change that never happened.
 */
export const kindLineKindsOnly = (r: KindRow): string => [r.category, r.sku, flatName(r.name), r.kind].join("\t");

export function parseKindSnapshot(text: string): KindRow[] {
  return text.split("\n").filter((l) => l.length > 0).map((l) => {
    const [category, sku, name, kind, deploy_role] = l.split("\t");
    return deploy_role === undefined ? { category, sku, name, kind } : { category, sku, name, kind, deploy_role };
  });
}

/** The role rule table as data: ids, patterns (source + flags), the role or the issue, and the SKU prefix strip. Evidence
 *  prose is excluded — rewording a citation does not move the arrangement. */
export function roleRuleTable(rules: readonly Rule[] = RULES): unknown {
  const pat = (re: RegExp | undefined) => (re ? [re.source, re.flags] : null);
  return {
    strip: pat(STRIP),
    rules: rules.map((r) => ({ id: r.id, kind: r.kind, re: pat(r.re), raw: pat(r.raw), name: pat(r.name), role: r.role ?? null, issue: r.issue ?? null })),
    domains: ROLE_DOMAINS,
  };
}

/** The (category|kind) -> axis table, derived from roleAxisOf over every kind a ledger can name. */
export function roleAxes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of Object.keys(LEDGER_KINDS).sort()) for (const k of LEDGER_KINDS[c]) {
    const axis = roleAxisOf(c, k);
    if (axis) out[`${c}|${k}`] = axis;
  }
  return out;
}

/** The role the live derivation gives a snapshot row, with the row's FROZEN kind — so a role drift is reported apart
 *  from a kind drift. `""` = no role. */
export const liveRoleOf = (r: KindRow): string => deployRole(r.category, r.kind, r.sku, r.name || null) ?? "";

/** Re-derive every role in a snapshot with the live deployRole; returns the rows whose role moved, and whether the
 *  snapshot carries the column at all (a snapshot without it cannot be compared and says so). */
export function roleDrift(rows: KindRow[]): { column: boolean; moved: { row: KindRow; now: string }[] } {
  if (rows.some((r) => r.deploy_role === undefined)) return { column: false, moved: [] };
  const moved: { row: KindRow; now: string }[] = [];
  for (const r of rows) {
    const now = liveRoleOf(r);
    if (now !== r.deploy_role) moved.push({ row: r, now });
  }
  return { column: true, moved };
}

/** The conflict table as frozen in tests/mapperTrace.test.ts: the text of its object literal, whitespace-normalised. */
export function conflictTableText(repoRoot: string): string {
  const src = fs.readFileSync(path.join(repoRoot, "tests", "mapperTrace.test.ts"), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("const KNOWN_CUP_CONFLICTS");
  if (start < 0) throw new Error("freeze: KNOWN_CUP_CONFLICTS not found in tests/mapperTrace.test.ts");
  const end = src.indexOf("\n};", start);
  // Entries only — comments are the table's prose and may be reworded without moving the arrangement.
  return src.slice(start, end).split("\n").map((l) => l.replace(/\/\/.*$/, "").trim()).filter((l) => l.startsWith('"')).sort().join("\n");
}

export type FreezeUnits = {
  vendor: string;
  profiles: Record<string, string>;
  dictionary: { keys: number; sha: string };
  kinds: { parts: number; by_category: Record<string, number>; mapping_sha: string };
  mapper: { alias_file_sha: string; conflicts: number; conflicts_sha: string };
  derived_fill_paths: { keys: string[]; sha: string };
  spec_bearing_classes: { classes: string[]; sha: string };
  denominators: Record<string, { parts: number; required_slots_stored: number }>;
  /** layer 3: the rule table (ids, patterns, roles, issues, domains), the (category|kind) -> axis table, and the role of
   *  every snapshot row — counted per (category|kind|role) and hashed line by line. */
  roles: { rules: number; rules_sha: string; axes: Record<string, string>; axes_sha: string;
    parts_with_axis: number; unresolved: number; by_role: Record<string, number>; mapping_sha: string };
};

/** Every unit, from code + committed files + the kind snapshot rows. */
export function freezeUnits(vendor: string, repoRoot: string, kindRows: KindRow[]): FreezeUnits {
  const cats = Object.keys(LEDGER_KINDS).sort();
  const profiles = Object.fromEntries(cats.map((c) => [c, profileHash(c)]));

  const dict = Object.keys(FIELD_DICTIONARY).sort().map((k) => {
    const d = FIELD_DICTIONARY[k] as { type: string; unit?: string; domain?: unknown; band?: unknown; shape?: string };
    return { key: k, type: d.type, unit: d.unit ?? null, domain: d.domain ?? null, band: d.band ?? null, shape: d.shape ?? null, superseded_by: SUPERSEDED_KEYS[k] ?? null };
  });

  const byCat: Record<string, number> = {};
  for (const r of kindRows) byCat[r.category] = (byCat[r.category] ?? 0) + 1;

  // THE PROVENANCE STAMP IS NOT PART OF THE RULE, and hashing the raw text made this freeze and
  // scripts/mould-stamp.mts invalidate each other for ever: the stamp writes a {data_commit, code_commit,
  // contract_hash, generated_at} object into this file, which moved `alias_file_sha`, which moved the freeze
  // hash, which required a regenerated freeze — which the next stamp then moved again. Measured by diffing
  // two freeze runs across a stamp: `mapper.alias_file_sha` was the ONLY unit that changed, so this is the
  // whole of the loop and not a symptom of it.
  //
  // So the hash covers the CONTENT: the file parsed, its `build` object dropped, re-serialised stably. A
  // reordered or reformatted file now hashes the same, which is a small loss of strictness and the right
  // trade — the alternative is a freeze nobody can reproduce twice running, and a hash that changes when
  // nothing about the arrangement has.
  const aliasRaw = fs.readFileSync(path.join(repoRoot, "data", "schema", "attribute-aliases.en.json"), "utf8").replace(/\r\n/g, "\n");
  const aliasText = (() => {
    try {
      const { build: _stamp, ...content } = JSON.parse(aliasRaw) as Record<string, unknown>;
      return stable(content);
    } catch {
      return aliasRaw;   // not JSON after all: hash what is there rather than silently hashing nothing
    }
  })();
  const conflicts = conflictTableText(repoRoot);

  const denominators: FreezeUnits["denominators"] = {};
  for (const c of cats) {
    const f = path.join(repoRoot, "data", "ledger", `${vendor}-${c}.json`);
    if (!fs.existsSync(f)) continue;
    const l = JSON.parse(fs.readFileSync(f, "utf8")) as { totals: { parts: number; required_slots_stored: number } };
    denominators[c] = { parts: l.totals.parts, required_slots_stored: l.totals.required_slots_stored };
  }

  const classes = [...SPEC_BEARING].map(String).sort();
  const axes = roleAxes();
  const byRole: Record<string, number> = {};
  let withAxis = 0, unresolved = 0;
  for (const r of kindRows) {
    if (!axes[`${r.category}|${r.kind}`]) continue;
    withAxis++;
    const role = r.deploy_role || "(unresolved)";
    if (role === "(unresolved)") unresolved++;
    const key = `${r.category}|${r.kind}|${role}`;
    byRole[key] = (byRole[key] ?? 0) + 1;
  }
  return {
    vendor,
    profiles,
    dictionary: { keys: dict.length, sha: sha(stable(dict)) },
    kinds: { parts: kindRows.length, by_category: byCat, mapping_sha: sha(kindRows.map(kindLineKindsOnly).join("\n")) },
    mapper: { alias_file_sha: sha(aliasText), conflicts: conflicts.split("\n").filter(Boolean).length, conflicts_sha: sha(conflicts) },
    derived_fill_paths: { keys: Object.keys(DERIVED_FILL_PATHS).sort(), sha: sha(stable(DERIVED_FILL_PATHS)) },
    spec_bearing_classes: { classes, sha: sha(classes.join(",")) },
    denominators,
    roles: {
      rules: RULES.length,
      rules_sha: sha(stable(roleRuleTable())),
      axes,
      axes_sha: sha(stable(axes)),
      parts_with_axis: withAxis,
      unresolved,
      by_role: byRole,
      // A row with no column hashes as "?" — distinct from "" (no role), so an old snapshot cannot hash like a new one.
      mapping_sha: sha(kindRows.map((r) => [r.category, r.sku, r.deploy_role ?? "?"].join("\t")).join("\n")),
    },
  };
}

export const freezeHash = (u: FreezeUnits): string => sha(stable(u));

/** Re-derive every kind in a snapshot with the live classifier; returns the rows whose kind moved. */
export function kindDrift(rows: KindRow[]): { row: KindRow; now: string }[] {
  const out: { row: KindRow; now: string }[] = [];
  for (const r of rows) {
    const now = partKind(r.category, r.sku, r.name || undefined) ?? "(none)";
    if (now !== r.kind) out.push({ row: r, now });
  }
  return out;
}
