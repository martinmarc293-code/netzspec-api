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
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];
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
const KNOWN_CUP_CONFLICTS: Record<string, { wants: string; wins: string; occurrences: number }> = {
  "Compliance|331": { wants: "certifications", wins: "ieee_standards", occurrences: 121 },
  "Compliance|425": { wants: "standard", wins: "ieee_standards", occurrences: 121 },
  "Frequency range|223": { wants: "radio_bands", wins: "input_freq", occurrences: 32 },
  "Output holdup time|622": { wants: "output_holdup_time", wins: "holdup_time", occurrences: 46 },
  "Height|1269": { wants: "height", wins: "dimensions", occurrences: 45 },
  "Cabling type|1168": { wants: "standard", wins: "media", occurrences: 38 },
  "Width|215": { wants: "dimensions", wins: "width", occurrences: 35 },
  "Integrated interface|588": { wants: "data_rate", wins: "ports", occurrences: 11 },
  "Integrated interfaces|588": { wants: "data_rate", wins: "ports", occurrences: 9 },
  "Power and cooling|592": { wants: "psu_config", wins: "psu_options", occurrences: 18 },
  "Data rate|1169": { wants: "data_rate", wins: "max_data_rate", occurrences: 10 },
  "Color|1230": { wants: "color", wins: "jacket_color", occurrences: 9 },
  "Signal output power range|1075": { wants: "tx_power", wins: "total_output_power", occurrences: 9 },
};
{
  // Shadowed in every category, computed from the artifacts rather than restated.
  let everywhere: Set<number> | null = null;
  for (const t of traces) {
    const s = new Set<number>(t.unreachable.filter((u) => u.reason.startsWith("SHADOWED")).map((u) => u.index));
    everywhere = everywhere === null ? s : new Set<number>([...everywhere].filter((i: number) => s.has(i)));
  }
  const shadowed = everywhere ?? new Set<number>();
  const found = new Map<string, { wants: string; wins: string; occurrences: number }>();
  for (const t of traces) {
    for (const c of t.contested) {
      for (const l of c.losers) {
        if (!shadowed.has(l.index) || !l.in_scope || c.key === l.key) continue;
        const id = `${c.label}|${l.index}`;
        const prev = found.get(id);
        if (!prev || c.n > prev.occurrences) found.set(id, { wants: l.key, wins: c.key ?? "(unmapped)", occurrences: c.n });
      }
    }
  }
  const unknown = [...found].filter(([id]) => !KNOWN_CUP_CONFLICTS[id]);
  const resolved = Object.keys(KNOWN_CUP_CONFLICTS).filter((id) => !found.has(id));
  check(`the ${Object.keys(KNOWN_CUP_CONFLICTS).length} shadowed rules that disagree about the cup are exactly the known list (${found.size} found)`,
    unknown.length === 0 && resolved.length === 0,
    `NEW: ${unknown.map(([id, v]) => `${id} wants ${v.wants}, ${v.wins} wins (${v.occurrences})`).join("; ")} | RESOLVED: ${resolved.join("; ")}`);
  for (const [id, want] of Object.entries(KNOWN_CUP_CONFLICTS)) {
    const got = found.get(id);
    if (!got) continue;
    check(`${id}: still wants ${want.wants} and still loses to ${want.wins}`,
      got.wants === want.wants && got.wins === want.wins, `now wants ${got.wants}, loses to ${got.wins}`);
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
