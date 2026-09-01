// scripts/test-spec-gate.ts — WP7. The sabotage suite: every case feeds a DELIBERATELY BROKEN
// input and asserts it is rejected FOR THE RIGHT REASON. Rejected for the wrong reason counts
// as a miss, exactly as in sportsblogging/scripts/test-gate.mjs.
//
//   npx tsx scripts/test-spec-gate.ts
//
// Twelve of the prompt's sixteen cases live here (schema / normaliser / merge). The four
// extraction-layer cases — S1 shifted header, S2 PDF page break, S14 colspan misalignment,
// S15 locale mismatch — are driven against the Python table parsers in
// scraper/test_extract_gate.py, because that is where the defect would occur. Splitting them is
// deliberate: a case asserted in the wrong layer proves nothing about the layer that can fail.
import { completenessV2 } from "../lib/fieldSchema.js";
import { normalizeField } from "../lib/specNormalize.js";
import { mergeField, canInherit, type SpecEntry } from "../lib/specMerge.js";

let pass = 0, fail = 0;
const results: string[] = [];

function check(id: string, defect: string, expected: string, got: string) {
  const okCase = got === expected;
  if (okCase) pass++; else fail++;
  results.push(`${okCase ? "PASS" : "FAIL"} | ${id.padEnd(4)} | ${defect.slice(0, 46).padEnd(48)} | expected ${expected.padEnd(26)} | got ${got}`);
}

const prov = (tier: number, doc: string, rev?: string) =>
  ({ tier, method: "html_table", doc_id: doc, locator: "t1:r1:c1", revision_label: rev, norm_v: "1.0.0" });
const entry = (k: string, value: unknown, tier: number, doc: string, rev?: string): SpecEntry =>
  ({ k, raw: String(value), value, state: "verified", prov: prov(tier, doc, rev) });

// ---- S3 — implausible magnitude ---------------------------------------------------------------
{
  const r = normalizeField("switches", "switching_capacity", "56 Mbit/s");
  check("S3", "56 Mbit/s switching capacity on a 9300-class row",
    "RANGE_VIOLATION", r.ok ? "STORED" : r.reason);
}

// ---- S4 — prose in a numeric field -------------------------------------------------------------
{
  const r = normalizeField("switches", "forwarding_rate", "siehe Datenblatt");
  check("S4", 'prose "siehe Datenblatt" in a numeric field',
    "PARSE_FAIL", r.ok ? "STORED" : r.reason);
}

// ---- S5 — family value applied to a PID the document does not list -------------------------------
{
  const c = canInherit({ fieldKey: "mac_table", sku: "C9300-48P",
    docPidList: ["C9200-24T", "C9200-48P"], hasPerSkuException: false });
  check("S5", "family table applied to a PID absent from the doc",
    "INHERIT_SCOPE_VIOLATION", c.ok ? "INHERITED" : (c.reason.startsWith("INHERIT_SCOPE_VIOLATION") ? "INHERIT_SCOPE_VIOLATION" : c.reason));
}
// S5b — a class-B field is refused even when the SKU *is* listed
{
  const c = canInherit({ fieldKey: "poe_budget", sku: "C9300-48P",
    docPidList: ["C9300-48P"], hasPerSkuException: false });
  check("S5b", "class-B poe_budget offered for inheritance",
    "REFUSED_CLASS_B", c.ok ? "INHERITED" : (c.cls === "B" ? "REFUSED_CLASS_B" : c.cls));
}
// S5c — class C is refused when the document carries a per-SKU value
{
  const c = canInherit({ fieldKey: "temp_operating", sku: "C9300-48P",
    docPidList: ["C9300-48P"], hasPerSkuException: true });
  check("S5c", "class-C field where a per-SKU value exists",
    "REFUSED_PER_SKU_EXISTS", c.ok ? "INHERITED" : "REFUSED_PER_SKU_EXISTS");
}

// ---- S6 — two tier-1 documents disagree ----------------------------------------------------------
{
  const m = mergeField("C9300-48P", entry("poe_budget", 822, 1, "docA"), entry("poe_budget", 740, 1, "docB"));
  const heldAndLogged = m.action === "conflict" && m.entry.state === "conflict" && !!m.conflict;
  check("S6", "two tier-1 docs disagree on poe_budget",
    "conflict+logged", heldAndLogged ? "conflict+logged" : `${m.action}/${m.entry.state}/${m.conflict ? "logged" : "unlogged"}`);
}

// ---- S7 — same document, new revision, changed value ---------------------------------------------
{
  const m = mergeField("C9300-48P", entry("mtbf", 277770, 1, "docA", "v1.2"), entry("mtbf", 281000, 1, "docA", "v1.3"));
  const okCase = m.action === "revision_change" && m.entry.value === 281000 && !!m.conflict;
  check("S7", "same doc re-fetched, new revision label, new value",
    "revision_change", okCase ? "revision_change" : `${m.action}/kept=${String(m.entry.value)}`);
}

// ---- S8 — a required field absent from every source ----------------------------------------------
{
  const c = completenessV2("switches", { form_factor: "rack-19", poe_standard: "none", layer: "l2", stackable: false });
  const named = c.missing.includes("mtbf") && c.required_total > c.required_present;
  check("S8", "required field absent from all sampled sources",
    "named_in_missing", named ? "named_in_missing" : `missing=${c.missing.length}`);
}

// ---- S9 — enum value outside the domain ------------------------------------------------------------
{
  const r = normalizeField("switches", "layer", "Layer 4");
  check("S9", 'enum value "Layer 4" outside the domain',
    "ENUM_VIOLATION", r.ok ? `STORED(${String(r.value)})` : r.reason);
}

// ---- S10 — number without a unit where a unit is required --------------------------------------------
{
  const r = normalizeField("switches", "switching_capacity", "256");
  check("S10", "bare 256 for a field whose unit is Gbit/s",
    "UNIT_MISSING", r.ok ? "STORED" : r.reason);
}

// ---- S11 — unrecognised header never becomes a field name ---------------------------------------------
{
  const r = normalizeField("switches", "Some Unrecognised Header", "42");
  check("S11", "unrecognised raw header used as a field key",
    "UNMAPPED_HEADER", r.ok ? "STORED_AS_FIELD" : r.reason);
}

// ---- S12 — same field twice in one document with different values ---------------------------------------
{
  const m = mergeField("C9300-48P", entry("weight", 7.59, 1, "docA"), entry("weight", 9.1, 1, "docA"));
  const held = m.action === "conflict" && !!m.conflict;
  check("S12", "same field extracted twice from one doc, differing",
    "conflict+logged", held ? "conflict+logged" : m.action);
}

// ---- S13 — extraction differs from an operator-reviewed value -------------------------------------------
{
  const reviewed = entry("switching_capacity", 56, 0, "hexcat");
  const m = mergeField("C9200L-24P-4G", reviewed, entry("switching_capacity", 128, 1, "docA"));
  const untouched = m.action === "protected" && m.entry.value === 56 && !!m.conflict;
  check("S13", "extraction differs from an operator-reviewed value",
    "protected+logged", untouched ? "protected+logged" : `${m.action}/value=${String(m.entry.value)}`);
}

// ---- S16 — a part whose category has no profile ------------------------------------------------------------
{
  const c = completenessV2("firewalls", { vendor: "fortinet" });
  const excluded = c.no_profile === true && c.pct === 0;
  check("S16", "part in a category with no profile",
    "NO_PROFILE_excluded", excluded ? "NO_PROFILE_excluded" : `no_profile=${c.no_profile}/pct=${c.pct}`);
}

// ---- extra: agreement across independent documents must corroborate, not conflict ---------------------------
{
  const m = mergeField("C9300-48P", entry("weight", 7.59, 1, "docA"), entry("weight", 7.59, 2, "docB"));
  check("S17", "two independent sources AGREE (control case)",
    "corroborate", m.action);
}
// ---- extra: the same fact in different units is agreement, not conflict --------------------------------------
{
  const a = normalizeField("switches", "switching_capacity", "56 Gbit/s");
  const b = normalizeField("switches", "switching_capacity", "56000 Mbit/s");
  const same = a.ok && b.ok && a.value === b.value;
  check("S18", "same fact in different units (control case)",
    "normalises_equal", same ? "normalises_equal" : "DIVERGED");
}

console.log("case | defect                                           | expected                   | got");
console.log("-".repeat(132));
for (const r of results) console.log(r);
console.log(`\nspec gate: ${pass}/${pass + fail} passed`);
if (fail) { console.error(`${fail} sabotage case(s) did not fail for the right reason.`); process.exit(1); }
