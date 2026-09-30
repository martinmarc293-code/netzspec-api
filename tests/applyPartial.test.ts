// tests/applyPartial.test.ts — apply-extract --partial (30 Sep 2026): a partial file carries ONLY value-rule cells, or the run is
// refused before anything is planned for writing; the fields it offers are what the plan produced. The gate half (recall scoped
// to the offered fields, the shape-E re-read) is proven on the box against the real cache: docs/decisions/2026-09-30-value-shaped-rules.md.
import { partialScope, parseArgs } from "../src/pipeline/apply-extract.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else misses.push(`${name}\n      got  ${g}\n      want ${w}`);
};
const cell = (label: string, value: string) => ({ label, value, shape: "E", locator: "t0:r1:c1", source_url: "https://x", sku: "SF350-24P" });
// the Plan fields partialScope reads; the rest of a Plan is irrelevant to it
const plan = (cells: ReturnType<typeof cell>[], produced: Record<string, string[]>) =>
  ({ allFacts: cells, produced: new Map(Object.entries(produced).map(([s, ks]) => [s, new Map(ks.map((k) => [k, {}]))])) }) as never;
const throws = (f: () => unknown) => { try { f(); return null; } catch (e) { return String((e as Error).message); } };

const POWER = cell("Power", "100-240V 50-60 Hz, internal, universal");
const POE = cell("Switches [Product description]", "Catalyst 9300 24-port 1G copper with modular uplinks, data only, Network Advantage");
check("value-rule cells only: the offered fields are what the plan produced, sorted",
  partialScope(plan([POWER, POE], { "SF350-24P": ["psu_config", "input_voltage"], "C9300-24T-A": ["poe_standard"] }), "rulings B-D"),
  { reason: "rulings B-D", fields: ["input_voltage", "poe_standard", "psu_config"] });
check("SABOTAGE: one ordinary cell in the file refuses the run, naming it",
  /1 cell\(s\) no value rule reads, e\.g\. "Weight" = "7\.4 kg"/.test(throws(() => partialScope(plan([POWER, cell("Weight", "7.4 kg")], {}), "x")) ?? ""), true);
check("SABOTAGE: a value-rule LABEL with another value is not a value-rule cell (a heading 'Power' = 'Power')",
  (throws(() => partialScope(plan([cell("Power", "Power")], {}), "x")) ?? "").startsWith("--partial: 1 cell(s)"), true);
check("--partial needs a reason", throws(() => parseArgs(["f.json", "--partial", " "])), "--partial needs a reason");
check("--partial is parsed", parseArgs(["f.json", "--partial", "rulings B-D"]).partial, "rulings B-D");
check("without --partial nothing is partial", parseArgs(["f.json"]).partial, null);

const TOTAL = 6;
if (misses.length || pass !== TOTAL) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${pass}/${TOTAL} partial-apply cases passed${pass + misses.length !== TOTAL ? ` (ran ${pass + misses.length}, expected ${TOTAL})` : ""}.`);
  process.exit(1);
}
console.log(`${pass}/${TOTAL} partial-apply cases passed`);
