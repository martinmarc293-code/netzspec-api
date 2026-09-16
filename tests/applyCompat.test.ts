// tests/applyCompat.test.ts — the PURE proof for src/pipeline/apply-compat.ts.
//
//   npx tsx tests/applyCompat.test.ts
//
// CORRECTION (16 Sep 2026, same night). When this file was written I said apply-compat "had NO
// suite at all", and commit 78418f3 carries that claim too. It is wrong. `tests/db/apply-lifecycle.
// test.ts` has covered apply-compat since it was written — **18 cases, 3 of them sabotage**, through
// the real CLI: a dry run writes no relation, a committed run records kind apply-compat with its
// structural gate, the TMG tool becomes a vendor_tool source_doc, unresolved SKUs are reported, and
// `--commit` behind a failing gate exits 1 and writes nothing. I searched for a file NAMED
// apply-compat.test.ts, found none, and concluded there was no coverage — the same defect as
// grepping for a column and missing a guard that lives behind a named helper, one day apart.
// **Coverage is not filed under the name of the thing covered.** Grep for the import, not the file.
//
// What was genuinely missing, and what this file adds, is the PURE half: the exported predicates and
// the gate's own arithmetic, none of which needs a database. The db half stays where it is.
//
// STILL OWED, and named so it cannot be quietly counted as done: the retirement narrowing landed in
// 78418f3 (`partsBySku`/`familySwitches` excluding retired rows) has NO case anywhere —
// apply-lifecycle.test.ts does not mention `retired` once. That case belongs in the db block beside
// the rest, not here, because it needs a retired part to exist.
//
// Written as PAIRS, like tests/specMerge.test.ts: every shape the gate ACCEPTS is twinned with one
// it must still refuse, because an acceptance on its own only proves something got through.
//
//   a wavelength family is skipped, not refused    a real SKU is not a wavelength family
//   "Y" is an end-of-sale FLAG                     a date is not a flag, and vice versa
//   a cisco.com source is on cisco.com             a host merely CONTAINING cisco.com is not
//   a well-formed matrix passes                    a platform with no optic fails on RECALL
//   an empty matrix is UNVERIFIED                  ...and unverified never reports passed: true
//
// The last pair is the one that matters most and is the reason `--sample` gets its own case: a
// mistyped sample size makes the gate check NOTHING, and this file asserts it cannot answer "pass"
// when it has looked at nothing. That is this repo's oldest rule (could not check is not checked)
// applied to the one gate that admits in its own `note` that it is structural only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isPlaceholderSku, isEosFlag, isoDate, onCisco, gateCompat, parseArgs, loadTmg,
  TMG_ORIGIN, FAMILY_OF_QUERY, type TmgRecord,
} from "../src/pipeline/apply-compat.js";

let pass = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) pass++; else misses.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function refuses(name: string, fn: () => unknown, reason: RegExp): void {
  try { fn(); check(`SABOTAGE ${name}`, false, "was NOT refused"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(`SABOTAGE ${name}`, reason.test(m), `refused for the WRONG reason: ${m}`); }
}
/** Deterministic: gateCompat sorts with `0.5 - rnd()`, so a constant 0.5 leaves the order alone. */
const fixed = { random: () => 0.5 };

// =================================================================================================
// wavelength families — skipped and counted, never refused as malformed
// =================================================================================================
check("CWDM-SFP-XXXX is a wavelength family", isPlaceholderSku("CWDM-SFP-XXXX"));
check("DWDM-SFP10G-XX.XX is a wavelength family", isPlaceholderSku("DWDM-SFP10G-XX.XX"));
check("DWDM-X2-XX.XX is a wavelength family", isPlaceholderSku("DWDM-X2-XX.XX"));
check("a real optic is not a wavelength family", !isPlaceholderSku("SFP-10G-SR"));
check("a real wavelength is not a family", !isPlaceholderSku("CWDM-SFP-1470"));
// The lookarounds are load-bearing and `\b` would not do this job — a Catalyst line card carries a
// single X mid-token, and XX glued to alphanumerics is part of a word, not a placeholder.
check("SABOTAGE a single X mid-SKU is not a family (WS-X6748-SFP)", !isPlaceholderSku("WS-X6748-SFP"));
check("SABOTAGE XX preceded by a letter is not a family", !isPlaceholderSku("AXX"));
check("SABOTAGE XX followed by a letter is not a family", !isPlaceholderSku("XXA"));
check("SABOTAGE XX followed by a digit is not a family", !isPlaceholderSku("XX9"));

// =================================================================================================
// end-of-sale: a FLAG earns no lifecycle row, a DATE does
// =================================================================================================
check('"Y" is a flag', isEosFlag("Y"));
check('"no" is a flag, case-free', isEosFlag("no") && isEosFlag("YES") && isEosFlag("n"));
check("a flag survives surrounding whitespace", isEosFlag("  Y  "));
check("SABOTAGE a date is not a flag", !isEosFlag("2026-08-31"));
check("SABOTAGE an empty string is not a flag", !isEosFlag("") && !isEosFlag(null));
check("SABOTAGE prose is not a flag", !isEosFlag("Yes, end of sale"));
check("a date is read out of surrounding prose", isoDate("end of sale 2026-08-31 announced") === "2026-08-31");
check("SABOTAGE a flag carries no date", isoDate("Y") === null && isoDate(null) === null);

// =================================================================================================
// provenance must be on cisco.com — the half of the gate that is about WHERE a claim came from
// =================================================================================================
check("a cisco.com collateral URL is on cisco.com", onCisco("https://www.cisco.com/c/en/us/products/x.html"));
check("the TMG origin itself is on cisco.com", onCisco(TMG_ORIGIN));
check("a bare cisco.com URL is on cisco.com", onCisco("https://cisco.com/x"));
check("SABOTAGE http is not https", !onCisco("http://www.cisco.com/x"));
check("SABOTAGE cisco.com in the PATH of another host is not cisco.com", !onCisco("https://evil.example/www.cisco.com/x"));
check("SABOTAGE a host ENDING in cisco.com is not cisco.com", !onCisco("https://notcisco.com/x"));
check("SABOTAGE a host STARTING with cisco.com is not cisco.com", !onCisco("https://cisco.com.evil.example/x"));

// =================================================================================================
// the gate
// =================================================================================================
const goodPlatform: TmgRecord = {
  type: "platform-compat", family_query: "C9300",
  compatible_optics: [{ sku: "SFP-10G-SR", source_url: TMG_ORIGIN }],
};
const goodOptic: TmgRecord = {
  type: "transceiver", sku: "SFP-10G-SR", datasheet_url: "https://www.cisco.com/c/en/us/products/x.html",
  end_of_sale: "Y", compat: [{ sku: "SFP-10G-SR=", source_url: TMG_ORIGIN }],
};
{
  const g = gateCompat([goodPlatform, goodOptic], 60, fixed);
  check("a well-formed matrix passes", g.passed && g.verdict === "pass" && g.precision === 1 && g.recall === 1,
    JSON.stringify({ p: g.precision, r: g.recall, v: g.verdict }));
  check("the gate declares itself STRUCTURAL and says why in its own note",
    g.structural === true && /not cached/.test(g.note));
}
{
  // could not check must never pass as checked — the repo's oldest rule, at its own gate.
  const g = gateCompat([], 60, fixed);
  check("SABOTAGE an empty matrix is UNVERIFIED, not a pass",
    g.verdict === "unverified" && g.passed === false && g.sampled === 0, JSON.stringify(g.verdict));
  check("SABOTAGE ...and it says so in the first miss", /UNVERIFIED/.test(g.misses[0] ?? ""));
}
{
  const noOptics: TmgRecord = { type: "platform-compat", family_query: "C9300", compatible_optics: [] };
  const g = gateCompat([noOptics, goodOptic], 60, fixed);
  check("SABOTAGE a platform with no optic fails on RECALL, not precision alone",
    !g.passed && g.recall === 0.5, `recall ${g.recall}`);
  check("SABOTAGE ...and the miss names the empty record", g.misses.some((m) => /no compatible optic/.test(m)));
}
{
  const badSku: TmgRecord = { type: "platform-compat", family_query: "C9300", compatible_optics: [{ sku: "Catalyst 9300 Series", source_url: TMG_ORIGIN }] };
  const g = gateCompat([badSku, goodOptic], 60, fixed);
  check("SABOTAGE prose in place of a part number fails the gate", !g.passed);
  check("SABOTAGE ...for the stated reason", g.misses.some((m) => /is not a part number/.test(m)));
  // `sampled` is the SAMPLE SIZE, never the number that passed — a field named for the thing you
  // wish it measured is how `{"precision":1,"sampled":2}` once hid 58 unreadable pages.
  check("sampled reports the SAMPLE SIZE, not the count that passed", g.sampled === 2 && g.precision === 0.5,
    JSON.stringify({ sampled: g.sampled, precision: g.precision }));
}
{
  const offsite: TmgRecord = { type: "transceiver", sku: "SFP-10G-SR", datasheet_url: "https://notcisco.example/x" };
  const g = gateCompat([offsite], 60, fixed);
  check("SABOTAGE a datasheet off cisco.com fails the gate", !g.passed);
  check("SABOTAGE ...for the stated reason", g.misses.some((m) => /is not cisco\.com/.test(m)));
}
{
  const badEos: TmgRecord = { type: "transceiver", sku: "SFP-10G-SR", end_of_sale: "sometime next year" };
  const g = gateCompat([badEos], 60, fixed);
  check("SABOTAGE an end_of_sale that is neither a date nor a flag fails",
    !g.passed && g.misses.some((m) => /neither a date nor a Y\/N flag/.test(m)));
}
{
  const unknown = { type: "something-else", sku: "SFP-10G-SR" } as unknown as TmgRecord;
  const g = gateCompat([unknown], 60, fixed);
  check("SABOTAGE an unknown record type is refused BY NAME, never ignored",
    !g.passed && g.misses.some((m) => /unknown record type/.test(m)));
}
{
  // WHERE THIS GATE STOPS, recorded rather than wished away (16 Sep 2026). `isPartNumber` — shared
  // with apply-lifecycle — is a SHAPE check: at least two characters, no whitespace, no trailing
  // full stop, at least one letter. `TBD` satisfies every clause, so a vocabulary placeholder passes
  // and the gate cannot see it. This case exists so nobody reads the suite above and concludes the
  // gate rejects junk SKUs generally; it rejects junk that is the wrong SHAPE. The first fixture
  // here used "TBD" expecting a refusal, and the suite going red is what found the difference.
  // Tightening `isPartNumber` is a change to a function two pipelines share and is not made here.
  const vocab: TmgRecord = { type: "platform-compat", family_query: "C9300", compatible_optics: [{ sku: "TBD", source_url: TMG_ORIGIN }] };
  const g = gateCompat([vocab], 60, fixed);
  check("KNOWN LIMIT: a vocabulary placeholder (TBD) is the right SHAPE, so the gate passes it",
    g.passed === true, JSON.stringify(g.misses));
}
{
  // The documented asymmetry: a wavelength family is SKIPPED, not counted as malformed, because a
  // relation to one would point at a part that cannot exist.
  const family: TmgRecord = { type: "transceiver", sku: "CWDM-SFP-XXXX", compat: [{ sku: "DWDM-X2-XX.XX" }] };
  const g = gateCompat([family], 60, fixed);
  check("a wavelength family passes the gate rather than being refused as malformed",
    g.passed && g.precision === 1, JSON.stringify(g.misses));
}

// =================================================================================================
// argument parsing — and the chain a mistyped sample size produces
// =================================================================================================
{
  const a = parseArgs(["a.json", "--commit", "--sample", "10", "--vendor", "hpe", "b.json"]);
  check("parseArgs reads flags and keeps every path", a.commit && a.sample === 10 && a.vendor === "hpe"
    && a.paths.join(",") === "a.json,b.json", JSON.stringify(a));
  const d = parseArgs(["a.json"]);
  check("parseArgs defaults: no commit, sample 60, vendor cisco",
    d.commit === false && d.sample === 60 && d.vendor === "cisco", JSON.stringify(d));
}
{
  // `--sample` takes Number(next), so a missing or non-numeric value is NaN, and NaN samples NOTHING.
  // That is safe only because the gate answers "unverified" rather than "pass" on an empty sample —
  // which is exactly the property worth pinning, since the two are one `verdict` apart.
  const nan = parseArgs(["a.json", "--sample", "abc"]);
  check("a non-numeric --sample is NaN, not a silent default", Number.isNaN(nan.sample));
  const g = gateCompat([goodPlatform, goodOptic], nan.sample, fixed);
  check("SABOTAGE a mistyped --sample checks NOTHING and must not report a pass",
    g.sampled === 0 && g.verdict === "unverified" && g.passed === false,
    JSON.stringify({ sampled: g.sampled, verdict: g.verdict, passed: g.passed }));
}

// =================================================================================================
// loadTmg — the refusals, and the blank-vs-null rule a real matrix forced
// =================================================================================================
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "netzspec-compat-"));
try {
  refuses("loadTmg on a file that does not exist", () => loadTmg(path.join(tmp, "nope.json")), /no such file/);

  const notAMatrix = path.join(tmp, "not-a-matrix.json");
  fs.writeFileSync(notAMatrix, JSON.stringify({ source: "x", generated_at: "2026-08-31" }));
  refuses("loadTmg on JSON with no records array", () => loadTmg(notAMatrix), /no "records" array/);

  // The adapter writes Python's `transceiverModelDataSheet or None`, and "  " is truthy in Python:
  // QSFP-400G-VR4 on the 2026-08-31 matrix carried two spaces as its datasheet URL.
  const blanks = path.join(tmp, "blanks.json");
  fs.writeFileSync(blanks, JSON.stringify({
    source: "tmg", generated_at: "2026-08-31",
    records: [
      { type: "transceiver", sku: "QSFP-400G-VR4", datasheet_url: "  ", compat: [{ sku: "SFP-10G-SR", source_url: "   " }] },
      { type: "platform-compat", family_query: "C9300", compatible_optics: [{ sku: "SFP-10G-SR", source_url: "  " }] },
    ],
  }));
  const loaded = loadTmg(blanks);
  const optic = loaded.records[0] as { datasheet_url: string | null; compat: { source_url: string | null }[] };
  const plat = loaded.records[1] as { compatible_optics: { source_url: string | null }[] };
  check("a whitespace-only datasheet URL loads as NULL, not as a URL", optic.datasheet_url === null);
  check("...and so does a whitespace-only source on a transceiver's compat", optic.compat[0].source_url === null);
  check("...and on a platform's optics", plat.compatible_optics[0].source_url === null);
  check("loadTmg carries source and generated_at through", loaded.source === "tmg" && loaded.generated_at === "2026-08-31");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// =================================================================================================
// the family map is a lookup, and a missing key must be undefined rather than a plausible guess
// =================================================================================================
check("FAMILY_OF_QUERY maps a TMG query to the family our parts carry",
  FAMILY_OF_QUERY.C9300 === "Cisco Catalyst 9300" && FAMILY_OF_QUERY.C2960L === "Cisco Catalyst 2960-L");
check("SABOTAGE an unmapped query is undefined, never a constructed name",
  FAMILY_OF_QUERY.C9999 === undefined);

console.log(`${pass}/${pass + misses.length} passed`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${misses.length} apply-compat case(s) wrong.`);
  process.exit(1);
}
console.log("apply-compat holds, and every acceptance has a twin that is still refused");
