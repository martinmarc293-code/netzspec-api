// tests/oneCupPerQuantity.test.ts — one dictionary key per quantity.
//
// On 11 Sep 2026 a scan for keys sharing a label found nine pairs that were the same quantity under
// two keys (cd_tolerance / chromatic_dispersion_tolerance, indicator_leds / status_leds, ...). Each
// pair splits a question across two cups: a value lands where an alias happens to route it and
// completeness asks the other key. SUPERSEDED_KEYS resolves the nine; this file is what stops the
// tenth. Every check below has a sabotage twin that must fail FOR ITS STATED REASON.
import fs from "node:fs";
import path from "node:path";
import { FIELD_DICTIONARY, PROFILES, SUPERSEDED_KEYS, unsupersededDuplicates } from "../src/core/fieldSchema.js";
import { dictionaryRows } from "../src/store/dictionary.js";

let passed = 0, failed = 0;
const lines: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else { failed++; lines.push(`    MISS ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 300)}`}`); }
}
const dict = FIELD_DICTIONARY as unknown as Record<string, { en?: string; de?: string }>;

// ---- the real dictionary --------------------------------------------------------------------------
const dups = unsupersededDuplicates(dict, SUPERSEDED_KEYS);
check(`no label is shared by two live keys (${Object.keys(dict).length} keys scanned, EN and DE)`, dups.length === 0, dups);

for (const [dup, canon] of Object.entries(SUPERSEDED_KEYS)) {
  check(`${dup}: the superseded key is still DEFINED (a fact or a stale alias naming it must not break the FK)`, !!dict[dup]);
  check(`${dup} -> ${canon}: the canonical key exists`, !!dict[canon]);
  check(`${dup} -> ${canon}: the canonical key is not itself superseded (no chains)`, !(canon in SUPERSEDED_KEYS));
}

const declaring = Object.entries(PROFILES as Record<string, Record<string, unknown>>)
  .flatMap(([cat, p]) => Object.keys(SUPERSEDED_KEYS).filter((k) => k in p).map((k) => `${cat}/${k}`));
check("no profile declares a superseded key after the merge", declaring.length === 0, declaring);

// The canonical key inherits the cup wherever the duplicate held it: transceiver declared only
// cd_tolerance before 11 Sep, and it must now carry chromatic_dispersion_tolerance.
check("transceiver carries chromatic_dispersion_tolerance (the cup with its 21 facts)",
  "chromatic_dispersion_tolerance" in (PROFILES as Record<string, Record<string, unknown>>).transceiver);
check("switches carries status_leds and poe_budget_redundant, not their twins",
  ["status_leds", "poe_budget_redundant"].every((k) => k in (PROFILES as Record<string, Record<string, unknown>>).switches));

for (const f of ["attribute-aliases.en.json", "attribute-aliases.de.json"]) {
  const p = path.join(process.cwd(), "data", "schema", f);
  if (!fs.existsSync(p)) { check(`${f} exists`, false); continue; }
  const rules = (JSON.parse(fs.readFileSync(p, "utf8")).rules ?? []) as [string, string][];
  const bad = rules.filter((r) => r[1] in SUPERSEDED_KEYS).map((r) => `${r[0]} -> ${r[1]}`);
  check(`${f}: no alias rule writes a superseded key (${rules.length} rules)`, bad.length === 0, bad);
}

// ---- sabotage ---------------------------------------------------------------------------------------
// 1. A NEW duplicate, the shape that produced all nine: a second key under an existing label.
const withTwin = { ...dict, cd_tol_2: { en: "Chromatic dispersion tolerance", de: "x" } };
const s1 = unsupersededDuplicates(withTwin, SUPERSEDED_KEYS);
check("SABOTAGE a new key sharing a live key's label is named", s1.length === 1 && s1[0].keys.includes("cd_tol_2") && s1[0].keys.includes("chromatic_dispersion_tolerance"), s1);
// 2. Forgetting one resolution: dropping indicator_leds from the map must bring its pair back.
const { indicator_leds: _drop, ...lessOne } = SUPERSEDED_KEYS;
void _drop;
const s2 = unsupersededDuplicates(dict, lessOne);
check("SABOTAGE removing one entry from SUPERSEDED_KEYS resurfaces exactly that pair", s2.length === 1 && s2[0].keys.sort().join() === "indicator_leds,status_leds", s2);
// 3. The normalisation is what makes the scan catch real pairs: "Polarization Dependent Loss (PDL)"
//    and "polarization dependent loss (pdl)" differ only in case and punctuation.
const s3 = unsupersededDuplicates({ a: { en: "Polarization Dependent Loss (PDL)" }, b: { en: "polarization-dependent loss, PDL" } }, {});
check("SABOTAGE labels differing only in case and punctuation are one group", s3.length === 1, s3);
// 4. Different quantities with different labels are NOT grouped — the scan must not cry wolf.
const s4 = unsupersededDuplicates({ a: { en: "Operating temperature" }, b: { en: "Operating temperature (extended)" } }, {});
check("control: two different labels are not a duplicate", s4.length === 0, s4);

// ---- the pointer the API serves (migration 0015, reviewer §1.3) ----------------------------------------
// /v1/fields lists retired keys, because stored history references them; `superseded_by` is what tells a
// consumer they are not a second cup. It is written by sync-dictionary from dictionaryRows(), so the rows
// are what is checked: every retired key points at a LIVE key (no chains, no dangling), and nothing else
// points anywhere.
{
  const rows = dictionaryRows();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const [old, canon] of Object.entries(SUPERSEDED_KEYS)) {
    check(`dictionary row for retired ${old} says superseded_by ${canon}`, byKey.get(old)?.superseded_by === canon, byKey.get(old)?.superseded_by);
    check(`the target ${canon} is itself live (no chain)`, byKey.get(canon)?.superseded_by === null, byKey.get(canon)?.superseded_by);
  }
  const stray = rows.filter((r) => r.superseded_by !== null && !(r.key in SUPERSEDED_KEYS)).map((r) => r.key);
  check("no live key carries a superseded_by", stray.length === 0, stray);
}

lines.unshift(`    one cup per quantity: ${passed} passed, ${failed} missed (${Object.keys(SUPERSEDED_KEYS).length} superseded keys, 4 sabotage cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
