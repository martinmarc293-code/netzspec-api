// tests/stackableFromBandwidth.test.ts — ruling (B), 30 Sep 2026: the sub-series row, the bandwidth header, the value, and the
// replay. The cells are the Catalyst 9200 sheet's real ones (t0, the transposed comparison table), plus the shapes that must
// NOT be read: a qualified group, a per-model cell, a range, an "up to", and headers that only mention stacking.
import { groupPrefix, readWitnessCell, stackableFromBandwidth, STACK_HEADER } from "../src/core/stackableFromBandwidth.js";
import { replayDerived } from "../src/core/derivedReplay.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else misses.push(`${name}\n      got  ${g}\n      want ${w}`);
};
const cell = (label: string, scope: string | null, value: string) => {
  const r = readWitnessCell(label, scope, value);
  return r === null ? null : r.ok ? `${r.prefix}=${r.stackable}` : `refused`;
};

// the real cells, as the extractor files them (label = row header, scope = column header)
check("C9200L: 80 Gbps -> stackable", cell("Fixed uplink Models (C9200L SKUs)", "Stacking Bandwidth Support", "80 Gbps"), "C9200L=true");
check("C9200: 160 Gbps -> stackable", cell("Modular uplink models (C9200 SKUs)", "Stacking Bandwidth Support", "160 Gbps"), "C9200=true");
check("C9200CX: 'No' -> not stackable (the header carries a no-break space)", cell("Compact Models (C9200CX\u00a0SKUs)", "Stacking Bandwidth Support", "No"), "C9200CX=false");
check("the other way round (label = the bandwidth header) reads the same", cell("Stacking bandwidth", "Fixed uplink Models (C9200L SKUs)", "80 Gbps"), "C9200L=true");
check("'N/A' is an explicit no", cell("Fixed uplink Models (C9200L SKUs)", "Stacking Bandwidth Support", "N/A"), "C9200L=false");
// refusals: the shape matched, the statement cannot be read
check("REFUSED: a qualified group names no prefix (C9200 Enhanced VN SKUs)", cell("Modular uplink models (C9200 Enhanced VN SKUs)", "Stacking Bandwidth Support", "160 Gbps"), "refused");
check("REFUSED: 'up to' is a capability", cell("Fixed uplink Models (C9200L SKUs)", "Stacking Bandwidth Support", "Up to 80 Gbps"), "refused");
check("REFUSED: two values are a range, not a statement", cell("Fixed uplink Models (C9200L SKUs)", "Stacking Bandwidth Support", "80 or 160 Gbps"), "refused");
check("REFUSED: 0 Gbps is not 'above zero' and not an explicit no", cell("Fixed uplink Models (C9200L SKUs)", "Stacking Bandwidth Support", "0 Gbps"), "refused");
// not this shape at all: left alone
check("NOT THIS SHAPE: a per-model cell (MS210, no group header)", cell("Stacking Bandwidth", null, "80 Gbps"), null);
check("NOT THIS SHAPE: another column of the same row", cell("Fixed uplink Models (C9200L SKUs)", "FRU Fans", "No"), null);
check("NOT THIS SHAPE: a header that only mentions stacking", cell("Fixed uplink Models (C9200L SKUs)", "Forwarding rate with Stacking", "80 Gbps"), null);
check("NOT THIS SHAPE: a group header in words ('48-port models')", cell("48-port models", "Stacking Bandwidth Support", "80 Gbps"), null);
// the pieces
check("STACK_HEADER: 'Max Stacking Bandwidth'", STACK_HEADER.test("Max Stacking Bandwidth"), true);
check("STACK_HEADER: 'Stacking' alone is not a bandwidth", STACK_HEADER.test("Stacking"), false);
check("groupPrefix: a prefix needs a digit ('(ISR SKUs)' names a line, not a SKU prefix)", groupPrefix("Routers (ISR SKUs)"), null);
check("stackableFromBandwidth reads the LAST segment of a raw", stackableFromBandwidth("Stacking Bandwidth Support | Fixed uplink Models (C9200L SKUs) | 80 Gbps"), true);
// the replay the census and the completeness report use
check("REPLAY: the stored raw replays", replayDerived("derived:stackable-from-bandwidth", "Stacking Bandwidth Support | Compact Models (C9200CX SKUs) | No"), null);
check("REPLAY SABOTAGE: a raw the derivation cannot read is refused, not waved through",
  replayDerived("derived:stackable-from-bandwidth", "Stacking Bandwidth Support | Fixed uplink Models (C9200L SKUs) | Up to 80 Gbps")?.reason, "DERIVATION_REFUSED");

const TOTAL = 19;
if (misses.length || pass !== TOTAL) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${pass}/${TOTAL} stackable-from-bandwidth cases passed${pass + misses.length !== TOTAL ? ` (ran ${pass + misses.length}, expected ${TOTAL})` : ""}.`);
  process.exit(1);
}
console.log(`${pass}/${TOTAL} stackable-from-bandwidth cases passed`);
