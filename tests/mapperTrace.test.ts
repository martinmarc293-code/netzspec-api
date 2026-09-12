// tests/mapperTrace.test.ts — REACHABILITY: the rules that are right and never fire.
//
//   npx tsx tests/mapperTrace.test.ts
//
// Term 8 of the cup-arrangement check list (reviewer round 4). A label-to-cup rule can be perfectly
// correct and never be consulted, because an earlier rule in the same table matches the same label.
// Nothing in the rules file shows it — both rules read fine — and no per-rule test can either, since
// each rule passes its own case. Two were found by hand on 12 Sep by reading what the mapper RETURNS
// per category: `^wireless ` swallowed "Wireless Standards" (the only label in 23,651 that asks a
// product which standard it speaks) into a __backlog sink, and a `^frequency range$` -> radio_bands
// rule sat 168 rules below `^frequency range` -> input_freq, so it had never fired in 32 occurrences.
//
// This suite reads the COMMITTED traces (data/mapper/<vendor>-<category>.json, built by
// scripts/build-mapper-trace.mts) the way tests/cupLedger.test.ts reads the committed ledgers: the
// artifact the reviewer is served is the artifact the suite checks. The label inventory itself is
// 9.7 MB and not committed, so a test that re-derived the traces could not run here anyway.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { mapLabel, traceLabel, ruleTable } from "../src/core/deepSpecMap.js";
import { SUPERSEDED_KEYS, FIELD_DICTIONARY } from "../src/core/fieldSchema.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: unknown, detail = "") => {
  if (ok === true) pass++;
  else misses.push(`${name}${detail ? `\n     ${detail}` : ""}`);
};

const DIR = path.join(REPO_ROOT, "data", "mapper");
type Hit = { index: number; pattern: string; key: string; scope: string[] | null; in_scope: boolean };
type Trace = {
  category: string; labels: number; mapped: number; contested_total: number;
  contested: { label: string; n: number; key: string | null; winner: Hit | null; losers: Hit[] }[];
  unreachable: { index: number; pattern: string; key: string; reason: string }[];
  sinks: Record<string, { total: number; labels: { label: string; n: number }[] }>;
  rules_pointing_at_a_retired_key: unknown[];
  rules_pointing_at_a_key_not_in_the_dictionary: unknown[];
};
// `.contested.json` is the uncapped sidecar the builder writes beside each trace (round-6 §10.2) — the
// full contested list and nothing else, so it has no `unreachable`. Globbing it in crashed this suite on
// its first run after the sidecars existed, which is the same exclusion the /v1/mapper route needed.
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".contested.json")) : [];
check("the committed traces exist", files.length > 0, `data/mapper holds ${files.length} files`);
const traces: Trace[] = files.map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")));

// ---- 1. THE TRACE MAY NOT DISAGREE WITH THE MAPPER ------------------------------------------
// The whole artifact is worthless if `traceLabel` and `mapLabel` can differ: the audit would then be
// of a second implementation, which is this repo's oldest mistake (an apply gate rebuilt out of
// database columns, a fix proven against a stand-in). Asserted over every contested label in every
// committed trace — the labels where more than one rule matched, i.e. exactly where a divergence
// could hide — rather than over a hand-picked few.
{
  let checked = 0, wrong = 0;
  for (const t of traces) {
    for (const c of t.contested) {
      checked++;
      if (mapLabel(c.label, t.category) !== c.key) {
        wrong++;
        if (wrong <= 3) misses.push(`traceLabel disagrees with mapLabel: ${t.category} ${JSON.stringify(c.label)} — trace says ${c.key}, mapLabel says ${mapLabel(c.label, t.category)}`);
      }
    }
  }
  check(`traceLabel agrees with mapLabel on every contested label (${checked} across ${traces.length} categories)`, wrong === 0);
  // And the denominator is stated, because "0 wrong" over 0 checks is the shape of a vacuous pass.
  check("…and there were contested labels to check", checked > 100, `checked ${checked}`);
}

// ---- 2. NO RULE POINTS AT A KEY THAT IS GONE ------------------------------------------------
// A rule routing to a retired key is unreachable BY CONSTRUCTION and, worse, hides the label from
// the key that survived: the value never reaches the cup completeness is asking about. The
// retirement list and the alias file are edited by different hands, which is why this is a test and
// not a habit (reviewer round 4, §4.3).
{
  const retired = ruleTable().filter((r) => r.key in SUPERSEDED_KEYS).map((r) => `#${r.index} ${r.pattern} -> ${r.key} (now ${SUPERSEDED_KEYS[r.key]})`);
  check(`no alias rule targets a retired key (${Object.keys(SUPERSEDED_KEYS).length} retired)`, retired.length === 0, retired.join("; "));
  const missing = ruleTable().filter((r) => !r.key.startsWith("__") && !FIELD_DICTIONARY[r.key]).map((r) => `#${r.index} ${r.pattern} -> ${r.key}`);
  check("no alias rule targets a key the dictionary does not hold", missing.length === 0, missing.join("; "));
}

// ---- 3. THE TWELVE SHADOWED RULES THAT DISAGREE ABOUT THE CUP -------------------------------
// 123 rules are shadowed in EVERY category, and 111 of those are harmless: a later vocabulary round
// appended its own copy of a rule pointing at the SAME key, so the duplicate is redundant rather
// than wrong (`^processors?$` -> cpu appears four times). The twelve below are the finding — the
// earlier rule wins the label for a DIFFERENT cup, so one of the two rules is wrong about what the
// label means, and which one is a decision rather than a bug.
//
// Frozen as a table with its measured size, the way the cross-category exceptions table is: a new
// entry means a new conflict and must be read, and a disappearing entry means one was resolved.
// Nothing here is asserted to be CORRECT — only to be the known list.
/**
 * KEYED ON `label|wants`, NOT ON THE RULE INDEX -- changed 12 Sep 2026, and the reason is worth the
 * line. It used to be `label|index`, so INSERTING AN ALIAS RULE ANYWHERE ABOVE ONE OF THESE SHIFTED
 * EVERY KEY and the test failed with a list of NEW and RESOLVED conflicts that were neither: the
 * same thirteen rules, renumbered. Eight rules went in above index 142 for round-6 B6 and shifted
 * all thirteen by eight.
 *
 * A frozen table has to be keyed on something that survives an edit elsewhere in the file it
 * describes. `label|wants` is unique across all thirteen (Compliance appears twice and wants two
 * different cups; the two "Integrated interface(s)" spellings are two labels), and it says what the
 * conflict IS rather than where it currently sits. The index is still reported in the failure
 * message, because that is what a reader needs in order to go and look.
 */
/**
 * TWENTY-SIX, NOT THIRTEEN (12 Sep 2026, round-6 reviewer §5 and §8.3). This table was frozen from the
 * top 200 contested labels the main trace carries, and the reviewer's objection was exact: "the
 * 13-conflict freeze makes the other 19 invisible by construction". It proved itself the same day. When
 * contested entries with no winner stopped being counted (they are unmapped, not contested), slots opened
 * in the visible 200, a real 7-occurrence contest crossed the boundary, and this test reported it as NEW —
 * a conflict that had existed all along, surfacing only because a cutoff moved.
 *
 * So the scan reads the UNCAPPED `.contested.json` sidecars, and this table is every conflict there is:
 * 26 over the full lists. A frozen list that changes when an unrelated count shifts is not frozen.
 *
 *   THE ORIGINAL 13   with the reviewer's rulings in the round-6 report §5.
 *   4 CASE TWINS      the same rule and the same ruling as a lowercase entry above them; the label
 *                     inventory is case-sensitive and a datasheet capitalises as it likes.
 *   9 NEWLY VISIBLE   recorded, ruling pending — each named in the round-7 response for the reviewer.
 */
const KNOWN_CUP_CONFLICTS: Record<string, { wins: string; occurrences: number }> = {
  // --- the original 13 ------------------------------------------------------------------------------
  "Compliance|certifications": { wins: "ieee_standards", occurrences: 121 },
  "Compliance|standard": { wins: "ieee_standards", occurrences: 121 },
  "Frequency range|radio_bands": { wins: "input_freq", occurrences: 32 },
  "Output holdup time|output_holdup_time": { wins: "holdup_time", occurrences: 46 },
  "Height|height": { wins: "dimensions", occurrences: 45 },
  "Cabling type|standard": { wins: "media", occurrences: 38 },
  "Width|dimensions": { wins: "width", occurrences: 35 },
  "Integrated interface|data_rate": { wins: "ports", occurrences: 11 },
  "Integrated interfaces|data_rate": { wins: "ports", occurrences: 9 },
  "Power and cooling|psu_config": { wins: "psu_options", occurrences: 18 },
  "Data rate|data_rate": { wins: "max_data_rate", occurrences: 10 },
  "Color|color": { wins: "jacket_color", occurrences: 9 },
  "Signal output power range|tx_power": { wins: "total_output_power", occurrences: 9 },
  // --- 4 case twins: same rule, same ruling -----------------------------------------------------------
  "Output Holdup Time|output_holdup_time": { wins: "holdup_time", occurrences: 7 },
  "Data Rate|data_rate": { wins: "max_data_rate", occurrences: 6 },
  "Power and Cooling|psu_config": { wins: "psu_options", occurrences: 5 },
  "Integrated Interface|data_rate": { wins: "ports", occurrences: 1 },
  // --- 9 newly visible, ruling pending ----------------------------------------------------------------
  // A combined "operating/storage" row wins for storage; the operating rule matches too and loses. The
  // reviewer called this winner correct and the loser fragile (§5).
  "Environmental: Operating/storage humidity|humidity_operating": { wins: "humidity_storage", occurrences: 6 },
  "Operating/storage humidity|humidity_operating": { wins: "humidity_storage", occurrences: 3 },
  // A PSU's maximum input: VA and W both route to input_va_max, so the watts form loses its own cup.
  "Maximum Input at Nominal Input Voltage (VA)|power_max": { wins: "input_va_max", occurrences: 4 },
  "Maximum Input at Nominal Input Voltage (W)|power_max": { wins: "input_va_max", occurrences: 4 },
  "Nominal Input Current (Arms)|input_current": { wins: "input_current_nominal", occurrences: 4 },
  // the Compliance family again, with an (EMC) suffix
  "Compliance (EMC)|certifications": { wins: "ieee_standards", occurrences: 3 },
  "Compliance (EMC)|standard": { wins: "ieee_standards", occurrences: 3 },
  "Maximum Rated Output (W) 1|psu_output_power": { wins: "psu_rated_output", occurrences: 2 },
  "Safety Approvals|safety_standards": { wins: "certifications", occurrences: 1 },
};
{
  // Shadowed in every category, computed from the artifacts rather than restated.
  let everywhere: Set<number> | null = null;
  for (const t of traces) {
    const s = new Set<number>(t.unreachable.filter((u) => u.reason.startsWith("SHADOWED")).map((u) => u.index));
    everywhere = everywhere === null ? s : new Set<number>([...everywhere].filter((i: number) => s.has(i)));
  }
  const shadowed = everywhere ?? new Set<number>();
  const found = new Map<string, { wins: string; occurrences: number; index: number }>();
  // THE FULL LISTS: each trace's uncapped sidecar, not its top 200. See the note on the table above.
  const complete = files.map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f.replace(/\.json$/, ".contested.json")), "utf8")) as Trace);
  check(`every trace has its uncapped contested sidecar (${complete.length} of ${files.length})`, complete.length === files.length);
  for (const t of complete) {
    for (const c of t.contested) {
      for (const l of c.losers) {
        if (!shadowed.has(l.index) || !l.in_scope || c.key === l.key) continue;
        const id = `${c.label}|${l.key}`;   // label + the cup the shadowed rule WANTS; see the note above
        const prev = found.get(id);
        if (!prev || c.n > prev.occurrences) found.set(id, { wins: c.key ?? "(unmapped)", occurrences: c.n, index: l.index });
      }
    }
  }
  const unknown = [...found].filter(([id]) => !KNOWN_CUP_CONFLICTS[id]);
  const resolved = Object.keys(KNOWN_CUP_CONFLICTS).filter((id) => !found.has(id));
  check(`the ${Object.keys(KNOWN_CUP_CONFLICTS).length} shadowed rules that disagree about the cup are exactly the known list (${found.size} found)`,
    unknown.length === 0 && resolved.length === 0,
    `NEW: ${unknown.map(([id, v]) => `${id} loses to ${v.wins} (${v.occurrences} occ, rule #${v.index})`).join("; ")} | RESOLVED: ${resolved.join("; ")}`);
  for (const [id, want] of Object.entries(KNOWN_CUP_CONFLICTS)) {
    const got = found.get(id);
    if (!got) continue;
    check(`${id}: still loses to ${want.wins} (rule #${got.index})`,
      got.wins === want.wins, `now loses to ${got.wins} instead of ${want.wins}`);
  }
}

// ---- 4. SABOTAGE: the two defects of 12 Sep must stay fixed ---------------------------------
// Each is pinned by OUTCOME — which cup the label reaches — because both rules involved were
// individually correct and only the order was wrong. A per-rule assertion would have passed
// throughout the defect's life.
check("SABOTAGE 'Wireless Standards' reaches wifi_generation, not the __backlog sink",
  mapLabel("Wireless Standards", "wireless") === "wifi_generation", String(mapLabel("Wireless Standards", "wireless")));
check("…and the sink still parks the embedded-wireless sub-table it was written for",
  mapLabel("Wireless LAN", "wireless") === "__backlog", String(mapLabel("Wireless LAN", "wireless")));
check("SABOTAGE 'Frequency range' is a radio span on an AP sheet",
  mapLabel("Frequency range", "wireless") === "radio_bands", String(mapLabel("Frequency range", "wireless")));
check("…the AC mains range on a server sheet",
  mapLabel("Frequency range", "servers-unified-computing") === "input_freq", String(mapLabel("Frequency range", "servers-unified-computing")));
check("…and the optical span on a tunable transceiver",
  mapLabel("Frequency range", "transceiver") === "tuning_range", String(mapLabel("Frequency range", "transceiver")));
// The third of 12 Sep: a bare "Power" was a CPU thermal design power on every kind of product.
check("SABOTAGE a bare 'Power' is a TDP only on a server sheet",
  mapLabel("Power", "servers-unified-computing") === "tdp", String(mapLabel("Power", "servers-unified-computing")));
check("…and not on an access point, a switch or a router",
  ["wireless", "switches", "routers", "meraki"].every((c) => mapLabel("Power", c) !== "tdp"));

// ---- 5. THE TRACE ITSELF REPORTS A LOSER, or it proves nothing ------------------------------
// A trace that returned an empty `losers` for everything would pass sections 1 and 3 vacuously.
{
  const t = traceLabel("Frequency range", "servers-unified-computing");
  check("traceLabel names the winner AND the rules that lost", t.winner !== null && t.losers.length > 0,
    `winner=${t.winner?.key} losers=${t.losers.length}`);
  check("…and a loser carries why it lost (its index and whether it was in scope)",
    t.losers.every((l) => typeof l.index === "number" && typeof l.in_scope === "boolean"));
  // Every sink's contents are visible per category — a decision to DROP a label is a decision, and
  // the `^wireless ` defect is what an invisible one costs.
  const sinks = traces.flatMap((x) => Object.keys(x.sinks));
  check("every committed trace lists what its sentinel sinks eat", sinks.includes("__not_a_spec") && sinks.includes("__backlog"));
}

console.log(`    mapper trace: ${pass} passed, ${misses.length} missed `
  + `(${traces.length} committed traces, ${Object.keys(KNOWN_CUP_CONFLICTS).length} known cup conflicts, 7 sabotage cases)`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS  ${m}`);
  process.exit(1);
}
