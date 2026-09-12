/**
 * Build the frozen CUP LEDGER for a category: the denominator the filling phase will be measured against.
 *
 *     npx tsx scripts/build-cup-ledger.mts --category switches [--vendor cisco]
 *     -> data/ledger/<vendor>-<category>.json   (commit it; tests/cupLedger.test.ts guards it against drift)
 *
 * Reviewer §5 (11 Sep 2026): "for every category that passes the five checks, emit a frozen ledger". Per kind:
 * the parts, the required fields, the conditional fields with their gate, the optional fields, and the slots —
 * parts × fields resolved at "nothing known yet". Per required or conditional field: which sources can fill it
 * (copied from data/schema/source-fields.json, with the source's CLASS) and the labels that map to it.
 *
 * TWO NUMBERS THE GENERATED FILE CANNOT FAKE, recorded beside each field:
 *   `basis` per source — "seen" when the source was observed publishing the key, "profile-required-only" when
 *       source-fields lists it ONLY because a profile requires it. source-fields admits every required key for
 *       the Cisco datasheet sources by construction, so a field whose every source says "profile-required-only"
 *       has no observed source at all. (That circle hid `mode`: 0 labels, 0 facts, "fillable".)
 *   `label_occurrences` — how often a label in the cisco-datasheets inventory maps to the key under the CURRENT
 *       alias rules (the real mapLabel). Upper bound for a category-scoped rule: the inventory is not per category.
 *
 * Read-only: queries the store, writes one JSON file. No run row, because it writes no database row.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getPool, closePool } from "../src/store/index.js";
import { partKind } from "../src/core/partKind.js";
import { kindQuestionSet, slotsAtNothingKnown, profileHash, LEDGER_KINDS } from "../src/core/cupLedger.js";
import { PROFILES } from "../src/core/fieldSchema.js";
import { NORM_VERSION } from "../src/core/specNormalize.js";
import { mapLabel } from "../src/core/deepSpecMap.js";

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

/**
 * fallback-kinds (12 Sep 2026). A DEVICE NOUN IN THE NAME of a part sitting in a fallback kind: the
 * second half of the own-fact census, and the shape that hid the UNITY-PIMG media gateways — 14 real
 * PBX-IP gateways a licence rule was about to delete, found by asking which rows a class rule calls
 * non-hardware while the name says "gateway". A fact count cannot see them, because an undocumented
 * product holds no facts; its NAME is the only thing that says what it is.
 *
 * Recorded per kind in the ledger, so tests/cupLedger.test.ts can assert it over the live corpus
 * rather than over a profile. Deliberately narrower than nameMarker's own device list: only nouns
 * that name a whole box, because a component noun in a component's name is correct and not a finding.
 */
const DEVICE_NOUN_IN_NAME =
  /(^|[^a-z])(?:switch|router|firewall|gateway|access point|transmitter|receiver|amplifier|server|appliance|chassis|controller|transceiver)(?:es|s)?([^a-z]|$)/i;
/** Kinds that mean "this axis could not say" — mirrors FALLBACK_KINDS in src/core/partKind.ts. */
const FALLBACK_KINDS = new Set(["unknown", "other", "component", "accessory", "non-hardware", "(none)"]);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

// Source slug -> the class of document it reads. "prose" (a part's own name) is description_mining, which no
// source-fields entry names; it is recorded per field from the facts, not from this table.
const SOURCE_CLASS: Record<string, string> = {
  "cisco-datasheets": "datasheet-html", "cisco-datasheet-pdf": "datasheet-pdf", "meraki": "vendor-page",
  "hpe-quickspecs": "vendor-spec-sheet", "arista": "vendor-page", "provantage": "reseller-spec-sheet",
  "router-switch": "reseller-spec-sheet", "itprice": "reseller-spec-sheet", "cdw": "reseller-spec-sheet", "hexcat": "operator",
};

// The four gap states the filling phase must use (reviewer §5, the cells defined on 10 Sep 2026), and the store
// state each one is computed from. Coverage = filled ÷ required slots, reported by kind and by state, never as a mean.
/**
 * WHICH DOCUMENT TYPES CARRY A SPECIFICATION — measured, not assumed, and the first version of this
 * list was wrong in a way that overstated the problem by a third.
 *
 * The obvious predicate is `doc_type LIKE '%datasheet%'`. It misses `vendor_page`, which is
 * MERAKI'S ONLY SOURCE, and it would have had this ledger report Meraki as acquisition-blocked
 * while its pages sit in the cache. The discriminator is not facts per DOCUMENT either, which is
 * the trap the repo already recorded as "a JOIN cardinality is not a yield": an EoL bulletin scores
 * 5.4 facts/doc, about the same as a vendor_page's 4.7, because a bulletin lists twenty SKUs in one
 * table and the count is per document.
 *
 * FACTS PER PART-LINK is the number that separates them, measured over the live store:
 *
 *     vendor_tool            5.9      vendor_guide           0.52
 *     vendor_datasheet_pdf   5.4      vendor_eol_bulletin    0.27
 *     vendor_datasheet_html  5.2
 *     vendor_page            3.6
 *
 * A bulletin binds a part and tells it nothing; a datasheet, a Meraki page or a config tool answers
 * it. `vendor_guide` (76 docs, 2,412 part-links, 0.52) sits with the bulletins and is excluded
 * despite a healthy 16.5 facts/doc — the same cardinality illusion one line up.
 */
const SPEC_BEARING_DOC_TYPES = ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_tool"];

const GAP_STATES = {
  filled: "the part holds a current fact under the key (facts.superseded_by IS NULL, not retracted)",
  "not-parsed": "a spec-bearing document linked to the part (doc_parts) carries a label that maps to the key, and no fact was stored",
  "not-held": "no spec-bearing document is linked to the part at all — an acquisition gap, not a parsing one",
  "not-published": "a gap_confirmed fact: every capable source was checked and none states it",
};

async function main(): Promise<void> {
  const category = arg("--category"), vendor = arg("--vendor") ?? "cisco";
  if (!category || !LEDGER_KINDS[category]) throw new Error(`--category must be one of: ${Object.keys(LEDGER_KINDS).join(", ")}`);
  const pool = getPool();

  // ---- parts per kind ---------------------------------------------------------------------------------
  // MERGED 12 Sep 2026 — two additions to this query landed in the same hour and BOTH are load-bearing:
  // the parent's document evidence (the `not-held` state) and the fallback-kinds agent's own-fact and
  // device-noun census. Dropping either half would leave a green suite asserting half a picture, so the
  // SELECT carries all five derived columns and the per-kind accumulator all five counters.
  //
  // `p.name` IS THE ONE THAT CHANGES BEHAVIOUR: partKind now takes an optional name and consults it only
  // where the category's own axis gave up. A builder that does not pass it measures a system nobody runs
  // — the three name-derived kinds would report zero parts — which is the structural gap the
  // asked-nothing survey identified (`recompute-completeness.ts` selected every column except p.name).
  const parts = (await pool.query<{ id: string; sku: string; name: string | null; rt: number | null;
    own: string; spec_docs: number; any_docs: number }>(`
    SELECT p.id::text, p.sku, p.name, cp.required_total AS rt,
           (SELECT count(*) FROM facts f
             WHERE f.part_id = p.id AND f.superseded_by IS NULL AND f.inherited_from IS NULL
               AND f.method NOT LIKE 'retracted:%')::text AS own,
           (SELECT count(*) FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
             WHERE dp.part_id = p.id AND sd.doc_type = ANY($3::text[]))::int AS spec_docs,
           (SELECT count(*) FROM doc_parts dp WHERE dp.part_id = p.id)::int AS any_docs
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
      LEFT JOIN completeness cp ON cp.part_id = p.id
     WHERE v.slug = $1 AND ct.slug = $2 AND p.retired_at IS NULL AND p.product_class = 'hardware'`,
    [vendor, category, SPEC_BEARING_DOC_TYPES])).rows;
  const byKind = new Map<string, { n: number; stored: number; spec: number; eolOnly: number; noDoc: number;
    facts3: number; noun: number }>();
  for (const p of parts) {
    const k = partKind(category, p.sku, p.name ?? undefined) ?? "(none)";
    const b = byKind.get(k) ?? { n: 0, stored: 0, spec: 0, eolOnly: 0, noDoc: 0, facts3: 0, noun: 0 };
    b.n++; b.stored += p.rt ?? 0;
    // THE OWN-FACT AND DEVICE-NOUN CENSUS (fallback-kinds agent): a part in a fallback kind holding
    // three or more of its own facts is the only detector for a real product swallowed by a fallback,
    // and the device noun is the detector for one that holds none — an undocumented product has no
    // facts, and its NAME is the only thing that says what it is. That is the shape that hid the
    // fourteen UNITY-PIMG media gateways a licence rule was about to delete.
    if (Number(p.own) >= 3) b.facts3++;
    if (DEVICE_NOUN_IN_NAME.test(p.name ?? "")) b.noun++;
    // THE `not-held` STATE, COMPUTED AT LAST — reviewer round 4 §9(2), 12 Sep 2026.
    //
    // GAP_STATES below has defined `not-held` ("no spec-bearing document is linked to the part at
    // all — an acquisition gap, not a parsing one") since the ledger was written, and NOTHING EVER
    // COMPUTED IT. A definition with no reader is the drift this repo keeps paying for, and here it
    // cost the argument rather than the data: 4,463 parts sit in a fallback kind with no datasheet
    // held, and without this split a readiness report says "not ready" and lets a reader conclude
    // "not ready — schema" about parts whose cups are arranged correctly and whose PAGES do not
    // exist in the cache. The reviewer made it the CONDITION for treating those parts as phase 2:
    // "the ledger must say so per family."
    //
    // Three states, per kind, because the kind is the family a reader acts on:
    //   spec_bearing  at least one datasheet-class document is linked — a gap here is parsing or
    //                 extraction, and it is ours to close now
    //   eol_only      documents are linked and NONE is spec-bearing (an end-of-life bulletin names
    //                 a SKU and carries no specification) — acquisition, and tractable: the
    //                 bulletin names the family and the archived collateral usually still exists
    //   no_document   nothing linked at all — acquisition, and the queue has to discover it first
    if (p.spec_docs > 0) b.spec++; else if (p.any_docs > 0) b.eolOnly++; else b.noDoc++;
    byKind.set(k, b);
  }
  // ---- security (12 Sep 2026): the rows the class table has already judged non-hardware ----------------
  // `securityKind` returns "non-hardware" for a SKU productClass.ts calls a licence, software or a service
  // while the parts row still says `hardware` — 3,525 of security's 5,515 as of 11 Sep, because a reclassify
  // run has not moved them yet. They have no question set and belong in no kind, so they are taken OUT of
  // the per-kind map rather than added to LEDGER_KINDS as a pseudo-kind.
  //
  // AND THE COUNT IS WRITTEN DOWN, beside the kinds rather than folded into one of them. A part silently
  // dropped from a denominator is this repo's own `sampled`-carrying-`checked` defect: the ledger would
  // report 1,990 parts for a category whose parts table holds 5,515 `hardware` rows and nothing would say
  // where the other 3,525 went.
  const pendingReclass = byKind.get("non-hardware")?.n ?? 0;
  const pendingReclassStoredSlots = byKind.get("non-hardware")?.stored ?? 0;
  byKind.delete("non-hardware");
  // fallback-kinds (12 Sep 2026): the census totals, computed BEFORE the per-kind loop drops anything,
  // so the share has the category's own hardware count as its denominator and not the survivors'.
  const fallbackCensus = {
    _about: "parts in a kind that means 'the axis could not say'. `facts3` and `device_noun` are the two detectors for a real product swallowed by a fallback: a part holding three or more facts of its own, and a part whose NAME names a whole box. Both are asserted by tests/cupLedger.test.ts.",
    kinds: [...byKind.keys()].filter((k) => FALLBACK_KINDS.has(k)).sort(),
    parts: [...byKind].filter(([k]) => FALLBACK_KINDS.has(k)).reduce((a, [, b]) => a + b.n, 0),
    hardware_parts: parts.length,
    facts3: [...byKind].filter(([k]) => FALLBACK_KINDS.has(k)).reduce((a, [, b]) => a + b.facts3, 0),
    device_noun: [...byKind].filter(([k]) => FALLBACK_KINDS.has(k)).reduce((a, [, b]) => a + b.noun, 0),
  };
  const unknownKinds = [...byKind.keys()].filter((k) => !LEDGER_KINDS[category].includes(k));
  if (unknownKinds.length) throw new Error(`parts carry kinds the ledger does not list: ${unknownKinds.join(", ")} — add them to LEDGER_KINDS`);

  // ---- evidence: sources (copied) and labels (mapped) --------------------------------------------------
  const sf = JSON.parse(fs.readFileSync(path.join(ROOT, "data/schema/source-fields.json"), "utf8"));
  const sourcesFor = (key: string) => Object.entries(sf.sources as Record<string, Record<string, string[]>>)
    .filter(([, cats]) => (cats[category] ?? []).includes(key) || (cats["*"] ?? []).includes(key))
    .map(([slug, cats]) => {
      const added: string[] = sf.evidence?.sources?.[slug]?.any_category?.added_by_profile ?? [];
      const seen = (cats[category] ?? []).includes(key) || ((cats["*"] ?? []).includes(key) && !added.includes(key));
      return { source: slug, class: SOURCE_CLASS[slug] ?? "unknown", basis: seen ? "seen" : "profile-required-only" };
    });
  const inv = JSON.parse(fs.readFileSync(path.join(ROOT, "runs/vocab/cisco-datasheets/labels.json"), "utf8"));
  const labels: { label: string; count: number }[] = Object.values(inv).find(Array.isArray) as never;
  const labelsFor = new Map<string, Map<string, number>>();
  for (const l of labels) {
    const k = mapLabel(l.label, category);
    if (!k || k.startsWith("__")) continue;
    const m = labelsFor.get(k) ?? new Map(); m.set(l.label, (m.get(l.label) ?? 0) + l.count); labelsFor.set(k, m);
  }
  // parts holding each key today, by method — so a field filled ONLY by the operator seed is visible as such
  const byMethod = new Map<string, Record<string, number>>();
  for (const r of (await pool.query<{ k: string; m: string; n: string }>(`
    SELECT f.field_key k, f.method m, count(DISTINCT f.part_id)::text n FROM facts f JOIN parts p ON p.id = f.part_id
      JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = $1 AND ct.slug = $2 AND p.product_class = 'hardware' AND p.retired_at IS NULL
       AND f.superseded_by IS NULL AND f.method NOT LIKE 'retracted:%' GROUP BY 1, 2`, [vendor, category])).rows) {
    byMethod.set(r.k, { ...(byMethod.get(r.k) ?? {}), [r.m]: Number(r.n) });
  }
  const evidence = (key: string) => {
    const lm = labelsFor.get(key) ?? new Map<string, number>();
    const srcs = sourcesFor(key);
    const methods = byMethod.get(key) ?? {};
    const labelOcc = [...lm.values()].reduce((a, b) => a + b, 0);
    const prose = (methods["description_mining"] ?? 0) > 0;
    return {
      key,
      sources: srcs,
      label_occurrences: labelOcc,
      labels: [...lm].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, n]) => ({ label, n })),
      parts_holding_by_method: methods,
      // A fill path a crawler can walk: a source SEEN publishing the key, a datasheet label that maps to it,
      // or the part's own name (description_mining). The operator seed is a source, but not one that grows.
      observed_fill_path: srcs.some((s) => s.basis === "seen") || labelOcc > 0 || prose,
      seed_only: !(srcs.some((s) => s.basis === "seen") || labelOcc > 0 || prose) && (methods["hexcat_seed"] ?? 0) > 0,
    };
  };

  // ---- per kind ----------------------------------------------------------------------------------------
  const kinds: Record<string, unknown> = {};
  let slotsNothing = 0, slotsStored = 0, partsTotal = 0;
  for (const kind of LEDGER_KINDS[category]) {
    const qs = kindQuestionSet(category, kind);
    const b = byKind.get(kind) ?? { n: 0, stored: 0, spec: 0, eolOnly: 0, noDoc: 0, facts3: 0, noun: 0 };
    const per = slotsAtNothingKnown(qs);
    slotsNothing += b.n * per; slotsStored += b.stored; partsTotal += b.n;
    kinds[kind] = {
      parts: b.n,
      // fallback-kinds (12 Sep 2026): the own-fact and device-noun census, per kind.
      parts_with_3plus_own_facts: b.facts3,
      parts_with_a_device_noun_in_name: b.noun,
      slots_per_part_at_nothing_known: per,
      required_slots_at_nothing_known: b.n * per,
      required_slots_stored: b.stored,
      // WHY A REQUIRED CUP OF THIS KIND IS EMPTY — the difference between our problem and the
      // crawler's. `blocked_by` is the verdict a readiness report must print instead of a bare
      // "not ready": `schema-or-parsing` when most of the kind holds a datasheet, `not-held` when
      // most of it does not. The three counts are always emitted so the verdict can be re-derived
      // rather than trusted.
      document_evidence: {
        spec_bearing: b.spec, eol_only: b.eolOnly, no_document: b.noDoc,
        blocked_by: b.n === 0 ? "no parts" : b.spec >= b.n / 2 ? "schema-or-parsing" : "not-held (acquisition)",
      },
      required: qs.required.map(evidence),
      pending_until_gate_answered: qs.pending.map((p) => ({ ...evidence(p.key), gate: p.gate })),
      not_applicable_by_kind: qs.not_applicable_by_kind,
      optional: qs.optional,
      column_backed: qs.column_backed,
    };
  }

  let commit = "unknown";
  try { commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch { /* not a checkout */ }
  const ledger = {
    _about: "GENERATED by scripts/build-cup-ledger.mts — do not edit by hand. The denominator of the filling phase: what every part of each kind is asked. tests/cupLedger.test.ts fails when the profile no longer matches.",
    vendor, category,
    profile_hash: profileHash(category),
    built_on_commit: commit,
    norm_version: NORM_VERSION,
    declared_fields: Object.keys(PROFILES[category]).length,
    gap_states: GAP_STATES,
    totals: {
      parts: partsTotal,
      required_slots_at_nothing_known: slotsNothing,
      required_slots_stored: slotsStored,
      _slots_note: "at_nothing_known = parts × (required + pending) with only the kind known; stored = the live denominator (completeness.required_total), smaller wherever an answered gate has closed a pending question",
      by_kind: Object.fromEntries(LEDGER_KINDS[category].map((k) => [k, (kinds[k] as { parts: number }).parts])),
      // security (12 Sep 2026): rows the kind axis judged non-hardware from the class table while the parts
      // row still says `hardware`. Counted here, not inside a kind — see the note at byKind.delete().
      // `parts` above EXCLUDES them, so parts + pending_reclassification is the category's hardware count.
      pending_reclassification: pendingReclass,
      pending_reclassification_stored_slots: pendingReclassStoredSlots,
      // fallback-kinds (12 Sep 2026)
      fallback: fallbackCensus,
    },
    kinds,
  };
  const out = path.join(ROOT, "data/ledger", `${vendor}-${category}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`wrote ${path.relative(ROOT, out)}: ${partsTotal} parts, ${slotsNothing} slots at nothing-known, ${slotsStored} stored`);
  for (const k of LEDGER_KINDS[category]) {
    type Ev = { key: string; observed_fill_path: boolean; seed_only: boolean };
    const x = kinds[k] as { parts: number; slots_per_part_at_nothing_known: number; required: Ev[]; pending_until_gate_answered: Ev[] };
    const all = [...x.required, ...x.pending_until_gate_answered];
    const seed = all.filter((f) => f.seed_only).map((f) => f.key);
    const blind = all.filter((f) => !f.observed_fill_path && !f.seed_only).map((f) => f.key);
    console.log(`  ${k.padEnd(12)} parts ${String(x.parts).padStart(5)}  asked ${String(x.slots_per_part_at_nothing_known).padStart(2)}` +
      `${seed.length ? `   SEED-ONLY: ${seed.join(", ")}` : ""}${blind.length ? `   NO FILL PATH: ${blind.join(", ")}` : ""}`);
  }
  await closePool();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
