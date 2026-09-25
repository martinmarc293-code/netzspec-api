// tests/trayHoles.test.ts — THE PARTS THE TRAY HAS NO COMPARTMENT FOR, pinned per category.
//
// The operator's model for this phase (25 Sep 2026): the arrangement is an empty ice tray and the facts are the water,
// so that "which areas are still empty" is answerable at any moment. A part whose KIND asks for nothing breaks that
// model in the one way nothing else catches: it can never read empty OR full. It is not a gap in the tray, it is a part
// standing outside it — and `completeness.required_total = 0` makes it invisible to every percentage, including the
// ones that say the work is going well.
//
// So the count is RECORDED per category, exactly, in both directions. Down is the work (a kind rule, or a class change
// that takes a non-product out of the hardware denominator). UP is a regression: a kind rule that stopped resolving, a
// profile whose conditionals no longer name a kind, or an arrival from another category that nothing asks anything of.
// Either way it is a number someone must move deliberately, which is the whole point of writing it down.
//
// Read from the BUILT PAGES (data/layers/*.rows.tsv), so this measures what was published rather than what the code
// would produce today — the same discipline as the standing checks next door.
//
// THE SPLIT MATTERS MORE THAN THE TOTAL. A row whose name is only "Cisco <SKU>" carries no evidence at all, so no rule
// can honestly resolve it: 361 of the 462 are that, most of them video's legacy Scientific-Atlanta part numbers. The
// 101 that DO carry a real name are the actionable half — bundles, kits and demo PIDs that should leave the hardware
// denominator by class, and real hardware the kind axis cannot read yet (VCS / Expressway appliances, MobileAccessVE
// units, two ONS 15454 Ethernet cards, an EWDM amplifier, the DES / 3DES crypto modules, a VIC 1385, OCP panels).
// Record: docs/decisions/2026-09-25-the-layering-is-complete.md
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { kindQuestionSet, slotsAtNothingKnown } from "../src/core/cupLedger.js";

let pass = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) pass++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };

/** Parts whose kind asks for NOTHING, per category, measured 25 Sep 2026 on the completed layering (41,067 hardware rows). */
const NO_CUPS_EXPECT: Record<string, number> = {
  video: 267, wireless: 69, "optical-networking": 39, "servers-unified-computing": 29, "collaboration-endpoints": 28,
  "unified-communications": 14, "hyperconverged-systems": 13, "hyperconverged-infrastructure": 2, "storage-networking": 1,
};
/** Of those, the ones with no evidence to act on: the name is only the SKU. Recorded so the ACTIONABLE half is visible. */
const BARE_EXPECT = 361, NAMED_EXPECT = 101;

const rowsOf = (cat: string) => {
  const p = path.join(REPO_ROOT, "data", "layers", `cisco-${cat}.rows.tsv`);
  const L = fs.readFileSync(p, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
  const h = L[0].split("\t");
  return L.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [h[i], v])) as Record<string, string>);
};
/** the slots a part opens when nothing is known; -1 when the category has no profile at all (itself a finding) */
const slots = (cat: string, kind: string): number => { try { return slotsAtNothingKnown(kindQuestionSet(cat, kind)); } catch { return -1; } };

const CATS = fs.readdirSync(path.join(REPO_ROOT, "data", "reference", "product-lines")).map((f) => f.replace(/^cisco-|\.json$/g, ""));
let total = 0, bare = 0, named = 0, noProfile = 0;
const byKind = new Map<string, number>();
for (const cat of CATS) {
  let zero = 0;
  for (const r of rowsOf(cat)) {
    if (r.bucket !== "layered") continue;
    const n = slots(cat, r.kind);
    if (n > 0) continue;
    if (n < 0) noProfile++;
    zero++; total++;
    if (!r.name || r.name === `Cisco ${r.sku}`) bare++; else named++;
    byKind.set(`${cat}/${r.kind}`, (byKind.get(`${cat}/${r.kind}`) ?? 0) + 1);
  }
  check(`tray ${cat}: ${NO_CUPS_EXPECT[cat] ?? 0} row(s) whose kind asks for nothing (exact, both ways)`, zero === (NO_CUPS_EXPECT[cat] ?? 0), `now ${zero}, recorded ${NO_CUPS_EXPECT[cat] ?? 0}`);
}
check(`tray: no category is missing a profile entirely (a -1 here is a category the cup engine cannot answer at all)`, noProfile === 0, `${noProfile} rows in a category with no profile`);
check(`tray: ${BARE_EXPECT} of the ${total} carry no evidence — their name is only their SKU, so no rule can honestly resolve them`, bare === BARE_EXPECT, `now ${bare}, recorded ${BARE_EXPECT}`);
check(`tray: ${NAMED_EXPECT} carry a real name and are the actionable half`, named === NAMED_EXPECT, `now ${named}, recorded ${NAMED_EXPECT}`);

// SABOTAGE: the check must fail when a part that HAS cups is counted, and when one that has none is missed — otherwise
// the numbers above could be produced by a predicate that always says zero (or never does).
{
  const probe = (cat: string, kind: string) => slots(cat, kind);
  check(`SABOTAGE tray: a resolved kind is NOT counted — switches/switch asks for cups`, probe("switches", "switch") > 0, `slots ${probe("switches", "switch")}`);
  check(`SABOTAGE tray: an unresolved kind IS counted — switches/unknown asks for nothing`, probe("switches", "unknown") === 0, `slots ${probe("switches", "unknown")}`);
  check(`SABOTAGE tray: a category with no profile answers -1 rather than 0, so it cannot hide inside the count`, probe("zz-not-a-category", "switch") === -1);
}

console.log(`    tray holes: ${pass} passed, ${misses.length} missed — ${total} rows ask nothing (${bare} bare, ${named} named), largest: ${[...byKind].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(", ")}`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
