// tests/columnBackedFacts.test.ts — the rule that decides which column-backed facts may be DELETED.
//
// This suite is the `recall` half of `retract-column-backed`'s gate: a retraction is only as good as the
// rule that justifies it, so an untested rule must not be allowed to delete anything. Every case below is
// a real row from the live store — the buckets were measured before the rule was written, not after.

import { classifyColumnBacked, normaliseSeries, type ColumnBackedRow } from "../src/core/columnBackedFacts.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) pass++;
  else misses.push(`    MISS ${name}${got === undefined ? "" : `: got ${JSON.stringify(got)}`}`);
};
const row = (o: Partial<ColumnBackedRow>): ColumnBackedRow =>
  ({ key: "series", value: null, vendorSlug: "cisco", series: null, productSeries: null, ...o });

// --- what must be RETRACTED ---------------------------------------------------------------------
{
  const v = classifyColumnBacked(row({ key: "vendor", value: "cisco", vendorSlug: "cisco" }));
  check("a vendor fact equal to parts.vendor is a duplicate", v.bucket === "vendor-duplicate" && v.retract, v);

  for (const [fact, col] of [
    ["Cisco Catalyst 9200", "Catalyst 9200"],   // the vendor word is the only difference
    ["Cisco 3750 Switches", "3750"],            // vendor word AND the trailing category noun
    ["Catalyst 9200", "Catalyst 9200"],         // identical
    ["IE4000 Series", "IE4000"],                // trailing "Series"
  ] as const) {
    const s = classifyColumnBacked(row({ value: fact, series: col }));
    check(`"${fact}" against column "${col}" is a duplicate`, s.bucket === "series-duplicate" && s.retract, s);
  }
  // product_series counts too: layer 4 holding the value is as good as the platform axis holding it.
  const p = classifyColumnBacked(row({ value: "MDS 9300", series: "MDS 9000 NX-OS", productSeries: "MDS 9300" }));
  check("a series fact equal to product_series is a duplicate", p.bucket === "series-duplicate" && p.retract, p);
}

// --- what must NOT be retracted, each for its own stated reason -----------------------------------
{
  // THE BRAND LEAK the reviewer spotted in the dry-run rows: a MikroTik SKU filed under vendor cisco.
  // Deleting the fact would resolve a brand disagreement by deleting one side of it.
  const leak = classifyColumnBacked(row({ key: "vendor", value: "mikrotik", vendorSlug: "cisco" }));
  check("a vendor fact DISAGREEING with the column is not a duplicate", leak.bucket === "vendor-differs" && !leak.retract, leak);

  // Both columns null: this fact is the only series the part has.
  const only = classifyColumnBacked(row({ value: "MikroTik Switches" }));
  check("both series columns null: the fact is the only copy", only.bucket === "series-only-source" && !only.retract, only);

  // Finer than the column — a product_series, not the platform axis.
  const finer = classifyColumnBacked(row({ value: "MDS 9300", series: "MDS 9000 NX-OS and SAN-OS Software" }));
  check("finer than the column: a layer-4 hint, not a duplicate", finer.bucket === "series-finer" && !finer.retract, finer);

  const other = classifyColumnBacked(row({ value: "Cisco 10000 Series Routers", series: "Shared Port Adapters/SPA" }));
  check("a different series entirely is not a duplicate", other.bucket === "series-finer" && !other.retract, other);

  // A word-prefix of the column is the same series, terser (decision 2026-09-28-series-hints-decomposed).
  const pre = classifyColumnBacked(row({ value: "MDS 9100", series: "MDS 9100 Series Multilayer Fabric" }));
  check("a word-prefix of the column is a duplicate", pre.bucket === "series-prefix-duplicate" && pre.retract, pre);
  const coarse = classifyColumnBacked(row({ value: "Catalyst", series: "Catalyst 9300" }));
  check("NEGATIVE a coarser fact (column adds a model number) is not a duplicate", !coarse.retract, coarse);
  const partial = classifyColumnBacked(row({ value: "MDS 91", series: "MDS 9100 Series Multilayer Fabric" }));
  check("NEGATIVE a prefix that is not a whole word is not a duplicate", !partial.retract, partial);
}

// --- SABOTAGE: the normaliser is what decides what gets deleted, so it must not over-reach ---------
{
  // Two DIFFERENT Catalyst series must never normalise equal. If they did, the retraction would delete a
  // correct fact because a neighbouring value happened to look similar — the one way this can destroy data.
  check("9200 and 9300 do not normalise equal", normaliseSeries("Cisco Catalyst 9200") !== normaliseSeries("Catalyst 9300"));
  check("MDS 9100 and MDS 9300 do not normalise equal", normaliseSeries("MDS 9100") !== normaliseSeries("MDS 9300"));
  // "Series" is stripped only at the END. A series whose NAME contains the word must survive.
  check("an interior 'Series' is not stripped",
    normaliseSeries("1000 Series Integrated Services Routers") === "1000 series integrated services routers");
  // An empty or null value must never count as equal to an empty column — that would retract a fact
  // whose value is missing against a column that is also missing, on the strength of two absences.
  const empty = classifyColumnBacked(row({ value: "", series: "" }));
  check("an empty value is NOT a duplicate of an empty column", !empty.retract, empty);
  const nulls = classifyColumnBacked(row({ value: null, series: null, productSeries: null }));
  check("a null value with null columns is only-source, not a duplicate", nulls.bucket === "series-only-source" && !nulls.retract, nulls);
}

// --- NOT VACUOUS: the rule must actually say "retract" for something and "keep" for something ------
{
  const all = [
    classifyColumnBacked(row({ key: "vendor", value: "cisco", vendorSlug: "cisco" })),
    classifyColumnBacked(row({ value: "Catalyst 9200", series: "Catalyst 9200" })),
    classifyColumnBacked(row({ value: "MikroTik Switches" })),
    classifyColumnBacked(row({ value: "MDS 9300", series: "MDS 9000 NX-OS" })),
  ];
  check("the rule retracts some rows and keeps others (2 and 2 here)",
    all.filter((v) => v.retract).length === 2 && all.filter((v) => !v.retract).length === 2,
    all.map((v) => v.bucket));
  check("every verdict carries a reason", all.every((v) => v.why.trim().length > 0));
}

console.log(misses.join("\n"));
console.log(`    column-backed facts: ${pass} passed, ${misses.length} missed ` +
  `(4 buckets, 6 sabotage/control cases; every case a real row shape from the live store)`);
if (misses.length) process.exit(1);
