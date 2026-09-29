// tests/unknownEvidence.test.ts — unknown_zero's evidence split (ruling Q9 (3), 29 Sep 2026): who stays red, who is apart.
//
//   npx tsx tests/unknownEvidence.test.ts
import { hasNoEvidence, splitUnknown, unknownZeroVerdict, type UnknownRow } from "../src/core/unknownEvidence.js";

let pass = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) pass++; else misses.push(`${name}${detail ? " — " + detail : ""}`); };
const row = (sku: string, name: string | null, linked: boolean): UnknownRow => ({ sku, name, category: "video", linked });

// NO EVIDENCE: a SKU-only name (bare, "Cisco <SKU>", punctuation-insensitive, or none) AND no document -- the 230 of 29 Sep
check("a bare-SKU name with no document has no evidence", hasNoEvidence(row("4014289", "4014289", false)));
check("'Cisco <SKU>' with no document has no evidence (the catalogue's placeholder name)", hasNoEvidence(row("4014289", "Cisco 4014289", false)));
check("a NULL name with no document has no evidence", hasNoEvidence(row("4014289", null, false)));
// EVIDENCED: either half is enough -- the ruling keeps these red because someone CAN classify them now
check("NEGATIVE a document-linked SKU-only part is EVIDENCED (its row names the product: 4039503 = P2-15TXM ...)",
  !hasNoEvidence(row("4039503", "Cisco 4039503", true)));
check("NEGATIVE a part whose name says more than its SKU is EVIDENCED", !hasNoEvidence(row("SPVAC-H5610-S-US=", "Jabra Handset 450 for Cisco", false)));
const split = splitUnknown([row("A", "Cisco A", false), row("B", "Cisco B", true), row("C", "a real product name", false)]);
check("the split is a partition: 3 rows -> 1 no-evidence + 2 evidenced, none dropped", split.noEvidence.length === 1 && split.evidenced.length === 2,
  JSON.stringify({ n: split.noEvidence.map((r) => r.sku), e: split.evidenced.map((r) => r.sku) }));
// the verdict: red on ANY evidenced, on a missing ceiling, on growth past the ceiling; green at or under it
check("green: 0 evidenced, no-evidence at its ceiling", unknownZeroVerdict({ evidenced: 0, noEvidence: 230, ceiling: 230, askedNothing: 0 }).pass);
check("NEGATIVE red: one evidenced unknown", !unknownZeroVerdict({ evidenced: 1, noEvidence: 0, ceiling: 230, askedNothing: 0 }).pass);
check("NEGATIVE red: the no-evidence count GREW past the ratchet", !unknownZeroVerdict({ evidenced: 0, noEvidence: 231, ceiling: 230, askedNothing: 0 }).pass);
check("NEGATIVE red: no ceiling recorded (a ratchet nobody recorded is not a ratchet)", !unknownZeroVerdict({ evidenced: 0, noEvidence: 0, ceiling: null, askedNothing: 0 }).pass);
check("NEGATIVE red: a kind asked nothing", !unknownZeroVerdict({ evidenced: 0, noEvidence: 0, ceiling: 0, askedNothing: 1 }).pass);

if (misses.length) { console.log(`unknown evidence: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`unknown evidence: ${pass} passed, 0 missed (5 refusals)`);
