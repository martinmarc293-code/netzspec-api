// scripts/miss-diff.ts — judge a block by a MISS-LEVEL diff, never by suite pass/fail (reviewer, 29 Sep 2026).
//
// On 28 Sep a rebuild left the suite-level picture unchanged while layersStanding went from 1 miss to 36 and cupLedger from
// 3 to 6: a suite that was already red stays "FAIL" however many new misses it grows, so a pass/fail diff cannot see a
// regression inside a red suite. This compares the MISS lines themselves. Used by scripts/run-tests.ts (--miss-out,
// --miss-diff) and by scripts/mould-build.sh, which diffs every rebuild against its own pre-build snapshot.

export type SuiteState = { status: "pass" | "fail" | "not_exercised"; misses: string[] };
export type MissSnapshot = { at: string; commit: string | null; suites: Record<string, SuiteState> };

/** The MISS keys a suite printed. The key is the check's NAME, the text before " — ": the detail after it carries counts
 *  that move with the data, and a moved count in an already-known miss is not a new miss. A suite that FAILED without
 *  printing a single MISS line (a crash, a throw) gets one fixed key, so a crash can never read as a suite with no misses. */
export function missesOf(output: string, status: SuiteState["status"]): string[] {
  const keys = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    // suites print "MISS  x", "  MISS x" and "    MISS x" (measured 29 Sep: 29 / 31 / 51 sites); "MISSES:" is a heading
    const m = /^\s*MISS(?![A-Za-z])[\s:]*(.*)$/.exec(line);
    if (m && m[1].trim()) keys.add(m[1].split(" — ")[0].trim());
  }
  if (status === "fail" && keys.size === 0) keys.add("(suite failed without printing a MISS line)");
  return [...keys].sort();
}

export type MissDiff = {
  missed_now_not_in_baseline: string[];     // the regressions: the verdict fails on any
  missed_in_baseline_not_now: string[];     // fixed (or renamed: a renamed check shows here AND above)
  changed_digits_only: string[];            // "was -> now" pairs equal once digits are masked: the same check, a moved count
  exercised_in_baseline_not_now: string[];  // could not run now: nothing it checks was checked, so it fails the verdict
  suites_in_baseline_not_run_now: string[]; // a vanished suite takes its misses with it, which must not read as "fixed"
  suites_not_in_baseline: string[];         // new suites: their misses are all counted as new
  unchanged: number;
  ok: boolean;
};

/** Compare the CURRENT snapshot with a BASELINE. `partial` = this run was filtered to some suites, so a baseline suite it
 *  did not run is reported but cannot fail the verdict. */
export function diffMisses(base: MissSnapshot, cur: MissSnapshot, partial = false): MissDiff {
  const d: MissDiff = { missed_now_not_in_baseline: [], missed_in_baseline_not_now: [], changed_digits_only: [],
    exercised_in_baseline_not_now: [], suites_in_baseline_not_run_now: [], suites_not_in_baseline: [], unchanged: 0, ok: true };
  const mask = (x: string) => x.replace(/\d+/g, "#");
  for (const [s, c] of Object.entries(cur.suites)) {
    const b = base.suites[s];
    if (!b) { d.suites_not_in_baseline.push(s); for (const m of c.misses) d.missed_now_not_in_baseline.push(`${s}: ${m}`); continue; }
    if (c.status === "not_exercised" && b.status !== "not_exercised") d.exercised_in_baseline_not_now.push(s);
    const gone = b.misses.filter((m) => !c.misses.includes(m));
    for (const m of c.misses) {
      if (b.misses.includes(m)) { d.unchanged++; continue; }
      // a line that differs from a VANISHED baseline line only in its digits is that check with a moved count, one for
      // one; a line with no vanished partner is new however alike it looks (1 -> 36 grew 35 lines with no partner)
      const i = gone.findIndex((g) => mask(g) === mask(m));
      if (i >= 0) { d.changed_digits_only.push(`${s}: ${gone[i]} -> ${m}`); gone.splice(i, 1); }
      else d.missed_now_not_in_baseline.push(`${s}: ${m}`);
    }
    for (const m of gone) d.missed_in_baseline_not_now.push(`${s}: ${m}`);
  }
  for (const s of Object.keys(base.suites)) if (!cur.suites[s]) d.suites_in_baseline_not_run_now.push(s);
  d.ok = d.missed_now_not_in_baseline.length === 0 && d.exercised_in_baseline_not_now.length === 0
    && (partial || d.suites_in_baseline_not_run_now.length === 0);
  return d;
}

export function formatDiff(d: MissDiff, label: string): string {
  const list = (xs: string[]) => xs.map((x) => `\n    ${x}`).join("");
  return [
    `MISS DIFF vs ${label}: ${d.ok ? "OK" : "REGRESSED"} — new ${d.missed_now_not_in_baseline.length}, gone ${d.missed_in_baseline_not_now.length}, `
      + `count moved ${d.changed_digits_only.length}, unchanged ${d.unchanged}, newly not exercised ${d.exercised_in_baseline_not_now.length}, `
      + `baseline suites not run ${d.suites_in_baseline_not_run_now.length}, new suites ${d.suites_not_in_baseline.length}`,
    d.missed_now_not_in_baseline.length ? `  MISSED NOW, NOT IN THE BASELINE:${list(d.missed_now_not_in_baseline)}` : "",
    d.exercised_in_baseline_not_now.length ? `  EXERCISED IN THE BASELINE, NOT NOW (checked nothing):${list(d.exercised_in_baseline_not_now)}` : "",
    d.suites_in_baseline_not_run_now.length ? `  BASELINE SUITES NOT RUN NOW:${list(d.suites_in_baseline_not_run_now)}` : "",
    d.changed_digits_only.length ? `  same check, count moved (was -> now):${list(d.changed_digits_only)}` : "",
    d.missed_in_baseline_not_now.length ? `  missed in the baseline, not now:${list(d.missed_in_baseline_not_now)}` : "",
  ].filter(Boolean).join("\n");
}
