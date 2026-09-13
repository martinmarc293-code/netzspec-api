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
 * 26 over the full lists when frozen; 22 after round 7 resolved four (see the note in the table).
 * A frozen list that changes when an unrelated count shifts is not frozen.
 *
 *   THE ORIGINAL 13   with the reviewer's rulings in the round-6 report §5.
 *   4 CASE TWINS      the same rule and the same ruling as a lowercase entry above them; the label
 *                     inventory is case-sensitive and a datasheet capitalises as it likes.
 *   9 NEWLY VISIBLE   recorded, ruling pending — each named in the round-7 response for the reviewer.
 *
 * FIFTEEN, NOT TWENTY-TWO (13 Sep 2026, phase-1 close guide §5.3). The six round-6 rulings that were
 * accepted and never implemented are now in the rules file, and the table is re-counted with the
 * winners they chose: EIGHT entries resolve outright (the six rulings plus two case twins) and ONE
 * appears — `Width|width`, which is the exact mirror of the long-standing `Height|height`: the bare
 * label now reaches dimensions and the provantage section-path rule `(^|> )Width$` -> width still
 * matches it and loses. Every entry now carries `ruling`, which must say `ruled …` or
 * `pending 2026-09-13 …` — asserted below, so an entry with no decision recorded cannot be added.
 */
type KnownConflict = { wins: string; occurrences: number; ruling: string };
/** The round-6 rulings on the original 13 were ACCEPTED in docs/reports/cisco-round6-response-2026-09-12.md
 *  §4, and cisco-round8-response-2026-09-12.md §A names the six that were not implemented. The rulings'
 *  own text is in the reviewer's round-6 report, which is not in this repo — so an entry not among the
 *  six is recorded as "winner stands as ruled", with that provenance, rather than paraphrased. */
const R6_STANDS = "ruled round 6 (accepted, round-6 response §4; not among the six round-8 §A lists as unimplemented): the winner stands";
const KNOWN_CUP_CONFLICTS: Record<string, KnownConflict> = {
  // --- the original 13, after §5.3 -----------------------------------------------------------------
  // RESOLVED 13 Sep 2026 by the §5.3 implementation — gone from this table because the losing rule no
  // longer disagrees about the cup (or no longer exists):
  //   "Frequency range|radio_bands"          rule 223 (`^frequency range$` -> radio_bands, unscoped) DELETED;
  //                                          the wireless/meraki-scoped copy above it is the radio reading
  //   "Width|dimensions"                     ruling Width -> dimensions (`^width( |$)` redirected)
  //   "Power and cooling|psu_config"         ruling -> psu_config (`^power and cooling$` psu_options rule redirected)
  //   "Data rate|data_rate"                  ruling -> data_rate (`^data rate$` removed from the max_data_rate alternation)
  //   "Color|color"                          ruling -> color outside cable/cord kinds; category scope cannot see a
  //                                          kind and NO category's bare "Color" comes from a cable sheet, so
  //                                          `^colou?r$` -> color everywhere (limitation recorded in the rule note)
  //   "Signal output power range|tx_power"   ruling tx_power for transmitters, total_output_power for amplifiers;
  //                                          category fallback: the total_output_power rule is scoped to
  //                                          optical-networking (all 9 occurrences), tx_power wins elsewhere
  //   "Data Rate|data_rate", "Power and Cooling|psu_config"   the case twins of two of the above
  "Compliance|certifications": { wins: "ieee_standards", occurrences: 121,
    ruling: "pending 2026-09-13: ruled round 6 that bare 'Compliance' needs a VALUE-AWARE rule, not a label decision; no such rule exists yet (only the parenthetical (EMC)/(safety)/(regulatory) forms were routed in round 7)" },
  "Compliance|standard": { wins: "ieee_standards", occurrences: 121,
    ruling: "pending 2026-09-13: same ruling as Compliance|certifications — a value-aware rule, not yet written" },
  "Output holdup time|output_holdup_time": { wins: "holdup_time", occurrences: 46, ruling: R6_STANDS },
  "Height|height": { wins: "dimensions", occurrences: 45,
    ruling: "ruled round 6: Height and Width both go to dimensions (round-6 response §4); height/width/depth derived or retired later" },
  "Width|width": { wins: "dimensions", occurrences: 35,
    ruling: "ruled round 6, implemented 13 Sep 2026 (§5.3): the mirror of Height|height — the provantage `(^|> )Width$` -> width rule matches the bare label and loses, as its Height twin does" },
  "Cabling type|standard": { wins: "media", occurrences: 38, ruling: R6_STANDS },
  "Integrated interface|data_rate": { wins: "ports", occurrences: 11, ruling: R6_STANDS },
  "Integrated interfaces|data_rate": { wins: "ports", occurrences: 9, ruling: R6_STANDS },
  // --- case twins still standing: same rule, same ruling ----------------------------------------------
  "Output Holdup Time|output_holdup_time": { wins: "holdup_time", occurrences: 7, ruling: R6_STANDS },
  "Integrated Interface|data_rate": { wins: "ports", occurrences: 1, ruling: R6_STANDS },
  // --- the 9 newly visible, RULED in round 7 (12 Sep 2026) ---------------------------------------------
  // Four are RESOLVED and gone from this table, because a rule now wins the label outright and the
  // losing rule no longer disagrees about the cup:
  //   "Maximum Input at Nominal Input Voltage (W)"  -> power_max       (A3: watts never in the VA cup)
  //   "Nominal Input Current (Arms)"                -> input_current   (A4: input_current_nominal superseded)
  //   "Compliance (EMC)" x2 (certifications|standard wants) -> certifications   (A5)
  // Five STAY, each with the winner the ruling chose, so the conflict is recorded as decided rather than
  // pending — the losing rule still matches and still wants another cup, which is what this table counts.
  // A1–A2: a combined operating/storage row is two measurements in one cell; it parks in __backlog until
  // a split-by-value-position rule exists. Both humidity rules still match it and both lose.
  "Environmental: Operating/storage humidity|humidity_operating": { wins: "__backlog", occurrences: 6,
    ruling: "ruled round 7 (A1): two measurements in one cell park in __backlog until a split-by-value-position rule exists" },
  "Operating/storage humidity|humidity_operating": { wins: "__backlog", occurrences: 3,
    ruling: "ruled round 7 (A2): as A1" },
  // A3: the (VA) form is input_va_max, as it was; the power_max rule matches it and loses, correctly.
  "Maximum Input at Nominal Input Voltage (VA)|power_max": { wins: "input_va_max", occurrences: 4,
    ruling: "ruled round 7 (A3): watts never in the VA cup; the (VA) row stays input_va_max" },
  // A6: psu_rated_output is the winner. psu_output_power is NOT superseded — it holds 10 Cisco facts.
  "Maximum Rated Output (W) 1|psu_output_power": { wins: "psu_rated_output", occurrences: 2,
    ruling: "ruled round 7 (A6): psu_rated_output; psu_output_power kept (10 cisco facts)" },
  // A7: certifications is the winner. safety_standards is NOT superseded — cisco 34 + arista 4 facts.
  "Safety Approvals|safety_standards": { wins: "certifications", occurrences: 1,
    ruling: "ruled round 7 (A7): certifications; safety_standards kept (cisco 34 + arista 4 facts)" },
};
// EVERY ENTRY CARRIES A DECISION OR A DATED PENDING NOTE (§5.3 acceptance). Checked, not commented: an
// entry with an empty or free-form `ruling` is the "frozen but undecided" state the reviewer objected to.
{
  const RULING_SHAPE = /^(ruled round \d|pending 20\d\d-\d\d-\d\d: )/;
  const undecided = Object.entries(KNOWN_CUP_CONFLICTS).filter(([, v]) => !RULING_SHAPE.test(v.ruling)).map(([id]) => id);
  check(`every one of the ${Object.keys(KNOWN_CUP_CONFLICTS).length} known conflicts records a ruling or a dated pending note`,
    undecided.length === 0, undecided.join("; "));
  // SABOTAGE of the shape check itself: a blank ruling and a dateless "pending" must both fail it.
  check("SABOTAGE the ruling check refuses a blank ruling and an undated 'pending'",
    !RULING_SHAPE.test("") && !RULING_SHAPE.test("pending: someone should look") && RULING_SHAPE.test("pending 2026-09-13: x"));
}
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
