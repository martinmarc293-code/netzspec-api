// tests/fillDashboard.test.ts — the FILL DASHBOARD's arithmetic (src/core/fillDashboard.ts): dashboard_sums (children sum
// to parents at every level) and the status light's rules (reviewer addendum, 30 Sep 2026).
//
//   npx tsx tests/fillDashboard.test.ts
import { partSeg, rollUp, segTotal, sumsOk, statusLight, etaDays, filledPct, type PartRow, type NightFacts } from "../src/core/fillDashboard.js";

let pass = 0, miss = 0;
const check = (name: string, ok: boolean, got: unknown = "") => { if (ok) pass++; else { miss++; console.log(`MISS | ${name}: got ${JSON.stringify(got)}`); } };

const row = (o: Partial<PartRow>): PartRow => ({ sku: "X", category: "switches", product_line: "Catalyst", product_family: "C9300",
  series: "Catalyst 9300", required_total: 16, required_present: 4, pending: 1, held: true, inherited_present: 1, ready: false, ...o });

// ---- one part: the five segments are the required cups plus the pending ones, and nothing else
const s = partSeg(row({}));
check("a held part: 4 present (1 inherited) of 16 + 1 pending -> 3 / 1 / 1 / 12 / 0", s.filled_read === 3 && s.filled_inherited === 1
  && s.pending_gate === 1 && s.not_parsed === 12 && s.not_held === 0, s);
check("its segments sum to required + pending", segTotal(s) === 17, segTotal(s));
const nh = partSeg(row({ held: false }));
check("a part with no spec-bearing document: its missing cups are not_held, never not_parsed", nh.not_held === 12 && nh.not_parsed === 0, nh);
check("an inherited count above the present count is clamped (a present cup cannot be inherited twice)",
  partSeg(row({ inherited_present: 9 })).filled_inherited === 4, partSeg(row({ inherited_present: 9 })));
check("filled % counts required cups only; pending is not yet required", filledPct(s) === 25, filledPct(s));

// ---- dashboard_sums: every level sums from its children
const rows: PartRow[] = [
  row({ sku: "A", ready: true }), row({ sku: "B", held: false }),
  row({ sku: "C", series: "Catalyst 9300X" }), row({ sku: "D", category: "routers", product_line: "ISR", product_family: "ISR 4000", series: "ISR 4400" }),
  row({ sku: "E", product_line: "", product_family: "", series: "" }),
];
const tree = rollUp(rows, "cisco");
check("dashboard_sums: the brand, every category, line, family and series equal the sum of their children", sumsOk(tree) === null, sumsOk(tree));
check("the brand counts every part once", tree.parts === 5 && tree.ready === 1, [tree.parts, tree.ready]);
check("a part with no layer lands in '(none)', never dropped", !!tree.children!.switches.children!["(none)"], Object.keys(tree.children!.switches.children!));
// SABOTAGE: a node whose segment does not match its children is named, level and segment
tree.children!.switches.seg.not_parsed += 1;
check("SABOTAGE a category bar off by one slot is caught, naming the level and the segment",
  /^cisco: not_parsed \d+, children sum to \d+$/.test(String(sumsOk(tree))), sumsOk(tree));
tree.children!.switches.seg.not_parsed -= 1;
tree.children!.switches.children!.Catalyst.parts += 1;
check("SABOTAGE a product line claiming one part too many is caught at its parent", /^cisco > switches: \d+ parts, children sum to \d+$/.test(String(sumsOk(tree))), sumsOk(tree));

// ---- the light
const base: NightFacts = { ran_last_night: true, stopped: null, ready_now: 160, ready_before: 154, retraction_recorded: false,
  board_other_failing: [], committed_facts: 1200, no_progress_nights: 0, stalled_categories: [], staged_waiting_days: 0,
  soft_block_pct: 0.5, quality_wrong_way: [], prediction_miss_pct: 10, first_night_pending: false };
const L = (o: Partial<NightFacts>) => statusLight({ ...base, ...o });
check("GREEN: committed data, ready rose, no stop", L({}).color === "GREEN", L({}));
check("RED: the night stopped, and the reason says why", L({ stopped: "gate failed on family UCS C-Series" }).color === "RED"
  && L({ stopped: "gate failed on family UCS C-Series" }).reason.includes("UCS C-Series"), L({ stopped: "x" }));
check("RED: ready fell with no recorded retraction", L({ ready_now: 150 }).color === "RED", L({ ready_now: 150 }));
check("...but a recorded retraction explains a fall (not RED on that rule)", L({ ready_now: 150, retraction_recorded: true }).color !== "RED", L({ ready_now: 150, retraction_recorded: true }));
check("RED: no run last night at all", L({ ran_last_night: false }).color === "RED", L({ ran_last_night: false }));
check("RED: a board test beyond the ruled set", L({ board_other_failing: ["one_build"] }).color === "RED", L({ board_other_failing: ["one_build"] }));
check("AMBER: no progress two nights running", L({ no_progress_nights: 2 }).color === "AMBER", L({ no_progress_nights: 2 }));
check("AMBER: staged families waiting more than 3 days", L({ staged_waiting_days: 4 }).color === "AMBER", L({ staged_waiting_days: 4 }));
check("...3 days exactly is not yet AMBER", L({ staged_waiting_days: 3 }).color === "GREEN", L({ staged_waiting_days: 3 }));
check("AMBER: Akamai error pages above 2%", L({ soft_block_pct: 2.5 }).color === "AMBER", L({ soft_block_pct: 2.5 }));
check("AMBER: a prediction missed by more than 30%", L({ prediction_miss_pct: 31 }).color === "AMBER", L({ prediction_miss_pct: 31 }));
check("AMBER: a clean night that committed nothing is not GREEN", L({ committed_facts: 0 }).color === "AMBER", L({ committed_facts: 0 }));
check("before the first night: AMBER saying so, never RED", L({ first_night_pending: true, ran_last_night: false }).color === "AMBER", L({ first_night_pending: true }));

// ---- the finish estimate
check("ETA: 50 -> 60 over 5 nights = 2.5 a night, 40 to go -> 16 nights", etaDays([50, 52, 55, 57, 58, 60]) === 20 || etaDays([50, 52.5, 55, 57.5, 60]) === 16,
  [etaDays([50, 52.5, 55, 57.5, 60])]);
check("ETA: a flat line has no finish date", etaDays([40, 40, 40]) === null, etaDays([40, 40, 40]));

console.log(`fill dashboard: ${pass} passed, ${miss} missed`);
process.exit(miss ? 1 : 0);
