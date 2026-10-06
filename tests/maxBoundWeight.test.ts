// tests/maxBoundWeight.test.ts — a stated weight MAXIMUM (method derived:max-bound): the replay, the export rendering, and the
// series witness table. Rulings Q25 (30 Sep 2026, cables) and (a) (6 Oct 2026, router series maxima). Pure: no database.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replayDerived } from "../src/core/derivedReplay.js";
import { isMaxBound, MAX_BOUND } from "../src/core/jtlExport.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, sabotages = 0;
const misses: string[] = [];
function check(name: string, ok: boolean, got?: unknown) { if (ok) pass++; else misses.push(`${name}${got === undefined ? "" : ` (got ${JSON.stringify(got)})`}`); }

// the replay: a cable's grams and a router's kilograms both replay; nonsense does not
check("a cable's stated maximum replays (Q25)", replayDerived("derived:max-bound", "250 g") === null);
check("a router series' stated maximum replays (ruling (a))", replayDerived("derived:max-bound", "5.5 lb (2.5 kg)") === null);
sabotages++; check("SABOTAGE a raw no weight band admits is refused", replayDerived("derived:max-bound", "5000 kg")?.reason === "DERIVATION_REFUSED",
  replayDerived("derived:max-bound", "5000 kg"));
sabotages++; check("SABOTAGE a raw with no mass is refused", replayDerived("derived:max-bound", "maximum")?.reason === "DERIVATION_REFUSED");

// derived:model-row (reviewer 6 Oct ~21:40): a named model's stated weight replays, and is never shown as a maximum
check("a model row's stated weight replays", replayDerived("derived:model-row", "2.3 lb (1.0 kg)") === null);
sabotages++; check("SABOTAGE a model row with no mass is refused", replayDerived("derived:model-row", "Weight")?.reason === "DERIVATION_REFUSED");
sabotages++; check("SABOTAGE a model-row weight is plain, never 'max.'", !isMaxBound({ value: 1.0, unit: "kg", method: "derived:model-row" }));

// the export: only the max-bound method reads as a maximum
check("the marker is the registered method", MAX_BOUND === "derived:max-bound");
check("a max-bound weight is a maximum", isMaxBound({ value: 2.5, unit: "kg", method: "derived:max-bound" }));
sabotages++; check("SABOTAGE a read weight is never shown as a maximum", !isMaxBound({ value: 2.5, unit: "kg", method: "extract:cisco-specs-deep" }));
sabotages++; check("SABOTAGE a weight with no method is never shown as a maximum", !isMaxBound({ value: 2.5, unit: "kg" }));

// the series witness table: every row names a datasheet that lists the PID (or its own sheet), states the statement it was
// re-read with, and carries the router weight in a form the replay reads
const W = path.join(ROOT, "data/reference/series-max-weight-witnesses.json");
check("the series witness table exists", existsSync(W));
if (existsSync(W)) {
  const t = JSON.parse(readFileSync(W, "utf8")) as { rows: { sku: string; raw: string; statement: string; series: string; listed_by: string | null; url: string }[] };
  check("the table has rows", t.rows.length > 0, t.rows.length);
  check("every row's raw replays", t.rows.every((r) => replayDerived("derived:max-bound", r.raw) === null));
  check("every row states a MAXIMUM (never a typical or measured weight)", t.rows.every((r) => /maximum/i.test(r.statement)));
  check("every guide row names the datasheet that lists its PID", t.rows.every((r) => !r.url.includes("/td/docs/") || !!r.listed_by));
  check("no LTE/4G build takes a guide table's maximum (the 4G LTE sheets state more)", t.rows.every((r) => !(r.listed_by && /-4G|LTE/.test(r.sku))),
    t.rows.filter((r) => r.listed_by && /-4G|LTE/.test(r.sku)).map((r) => r.sku));
  check("a PID appears at most once per series", new Set(t.rows.map((r) => `${r.sku}|${r.series}`)).size === t.rows.length);
}
// the MODEL-ROW witness table (reviewer ~21:40, extended ~22:50 by Q2 and Q5)
{
  const M = new URL("../data/reference/model-row-weight-witnesses.json", import.meta.url);
  const t = JSON.parse(readFileSync(M, "utf8")) as { rows: { sku: string; raw: string; label: string; requires_url?: string; requires_statement?: string }[] };
  check("model-row: every row's raw replays", t.rows.every((r) => replayDerived("derived:model-row", r.raw) === null));
  check("model-row: a PID has exactly one model row", new Set(t.rows.map((r) => r.sku)).size === t.rows.length);
  // Q2: "with 2x AC power supplies" is plain ONLY because an ordering guide says the platform ships that way -- the licence travels
  const withPsu = t.rows.filter((r) => /with 2x AC power supplies/i.test(r.label));
  check("Q2: the 'with 2x AC power supplies' rows exist (C8300 + C8500)", withPsu.length === 7, withPsu.length);
  check("Q2: every 'with 2x AC power supplies' row carries the ordering-guide statement that licenses a plain weight",
    withPsu.every((r) => !!r.requires_url && /ship with/i.test(r.requires_statement ?? "")), withPsu.filter((r) => !r.requires_url).map((r) => r.sku));
  check("Q2: C8500-20X6C's two-value cell is ruled max-bound, so it is never a plain model row", !t.rows.some((r) => r.sku === "C8500-20X6C"));
  check("Q5: NC57-MPA-12L-S is not named by the sheet's table (only the -FC is), so it is not a row", !t.rows.some((r) => r.sku === "NC57-MPA-12L-S"));
}
check("the suite carries at least 4 sabotage cases", sabotages >= 4, sabotages);

if (misses.length) { console.log(`maxBoundWeight: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`maxBoundWeight: ${pass} passed, 0 missed (${sabotages} sabotage cases)`);
