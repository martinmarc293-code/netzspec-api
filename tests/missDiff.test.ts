// tests/missDiff.test.ts — the MISS-level diff (scripts/miss-diff.ts) that judges a rebuild block (reviewer, 29 Sep 2026).
// Its reason to exist is the 28 Sep shape: a suite already red grew from 1 miss to 36 and the suite-level picture did not
// move. Pure: no database, no files.
import { missesOf, diffMisses, type MissSnapshot, type SuiteState } from "../scripts/miss-diff.js";

let pass = 0, sabotages = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => { if (ok) pass++; else misses.push(`${name}: ${JSON.stringify(got)}`); };
const snap = (suites: Record<string, SuiteState>): MissSnapshot => ({ at: "t", commit: null, suites });
const S = (status: SuiteState["status"], ...m: string[]): SuiteState => ({ status, misses: m });

// ---- missesOf: every printed shape, the name not the detail, and a crash is never "no misses" ----
const out = ["PASS  a", "MISS  alpha — 12 rows", "  MISS beta", "    MISS gamma: {\"n\":1}", "MISSES:", "  alpha", "MISSED the bus"].join("\n");
check("missesOf reads all three indent shapes, keys on the name before \" — \", ignores MISSES:/MISSED",
  JSON.stringify(missesOf(out, "fail")) === JSON.stringify(["alpha", "beta", "gamma: {\"n\":1}"]), missesOf(out, "fail"));
check("NEGATIVE a failed suite that printed no MISS line still carries one key (a crash is not a clean suite)",
  missesOf("TypeError: x is undefined\n    at y", "fail").length === 1, missesOf("TypeError", "fail"));
check("a passing suite with no MISS line has none", missesOf("PASS  all\n3 passed", "pass").length === 0);

// ---- diffMisses ----
const base = snap({ "tests/a.test.ts": S("fail", "one"), "tests/b.test.ts": S("pass"), "tests/c.test.ts": S("fail", "rows: 12") });
const same = diffMisses(base, snap({ "tests/a.test.ts": S("fail", "one"), "tests/b.test.ts": S("pass"), "tests/c.test.ts": S("fail", "rows: 12") }));
check("positive twin: identical snapshots are OK with every miss unchanged", same.ok && same.unchanged === 2, same);
{
  sabotages++;
  const d = diffMisses(base, snap({ "tests/a.test.ts": S("fail", "one", "two", "three"), "tests/b.test.ts": S("pass"), "tests/c.test.ts": S("fail", "rows: 12") }));
  check("SABOTAGE the 28 Sep shape: a red suite grows misses and stays red -> REGRESSED naming both new lines",
    !d.ok && d.missed_now_not_in_baseline.join("|") === "tests/a.test.ts: two|tests/a.test.ts: three", d);
}
{
  const d = diffMisses(base, snap({ "tests/a.test.ts": S("fail", "one"), "tests/b.test.ts": S("pass"), "tests/c.test.ts": S("fail", "rows: 13") }));
  check("a moved count in the same check is reported as moved, not as a regression",
    d.ok && d.changed_digits_only.length === 1 && d.missed_now_not_in_baseline.length === 0, d);
}
{
  sabotages++;
  const d = diffMisses(snap({ "tests/l.test.ts": S("fail", "part UCSC-OCP-100G") }),
    snap({ "tests/l.test.ts": S("fail", "part UCSC-OCP-100G", "part UCSC-OCP-1025G") }));
  check("SABOTAGE digits alike is not enough: a new line whose look-alike is STILL missed has no vanished partner -> new",
    !d.ok && d.missed_now_not_in_baseline.length === 1 && d.changed_digits_only.length === 0, d);
}
{
  sabotages++;
  const d = diffMisses(base, snap({ "tests/a.test.ts": S("fail", "one"), "tests/b.test.ts": S("not_exercised"), "tests/c.test.ts": S("fail", "rows: 12") }));
  check("SABOTAGE a suite that passed and now cannot run checked nothing -> REGRESSED", !d.ok && d.exercised_in_baseline_not_now[0] === "tests/b.test.ts", d);
}
{
  sabotages++;
  const cur = snap({ "tests/b.test.ts": S("pass"), "tests/c.test.ts": S("fail", "rows: 12") });
  const d = diffMisses(base, cur);
  check("SABOTAGE a vanished suite takes its misses with it -> REGRESSED, not 'fixed'", !d.ok && d.suites_in_baseline_not_run_now[0] === "tests/a.test.ts", d);
  check("... unless the run was filtered (partial): then reported, not failed", diffMisses(base, cur, true).ok);
}
{
  const d = diffMisses(base, snap({ "tests/a.test.ts": S("pass"), "tests/b.test.ts": S("pass"), "tests/c.test.ts": S("fail", "rows: 12") }));
  check("a fixed miss is listed as gone and the verdict is OK", d.ok && d.missed_in_baseline_not_now[0] === "tests/a.test.ts: one", d);
}
{
  sabotages++;
  const d = diffMisses(base, snap({ ...base.suites, "tests/new.test.ts": S("fail", "brand new") }));
  check("SABOTAGE a new suite's misses are all new", !d.ok && d.suites_not_in_baseline[0] === "tests/new.test.ts" && d.missed_now_not_in_baseline.length === 1, d);
  check("... and a new suite with no misses is fine", diffMisses(base, snap({ ...base.suites, "tests/new.test.ts": S("pass") })).ok);
}
check("the suite carries at least 5 sabotage cases", sabotages >= 5, sabotages);

if (misses.length) { console.log(`missDiff: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`missDiff: ${pass} passed, 0 missed (${sabotages} sabotage cases)`);
