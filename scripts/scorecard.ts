// scripts/scorecard.ts — the reviewer's PERFORMANCE CHECK (standing order, 30 Sep 2026): the SCORECARD at the end of every
// report, computed here and never typed by hand; the AUTOMATIC FLAGS are printed first when any fires.
//
//   npx tsx scripts/scorecard.ts [--record]                  compute; --record appends it to data/reports/scorecard.jsonl
//   npx tsx scripts/scorecard.ts --verdict "<one line>"      the reviewer's verdict, set on the last recorded entry
//   npx tsx scripts/scorecard.ts --dump-ready                (run ON THE BOX by the laptop run) ready, filled %, top-5 sole blockers
//
// WHERE EACH NUMBER COMES FROM, so none of them is a sentence:
//   ready / filled / top-5      the store, computed fresh ON THE BOX (--dump-ready over ssh): jtlReadiness over every live Cisco
//                               hardware SKU (the export's own function), blockers held by exactly one reason, and FILLED = the
//                               board's fill-state share (src/core/fillState.ts, the verifier's own module; compared with the last
//                               recorded build). Required slots present (completeness sums) is printed beside it as a DIFFERENT
//                               measure -- until 2 Oct 2026 it was printed as "filled" (scorecards before then: `filled_pct`).
//   today's rule                data/reports/today.json {date, rule, blocker_key, predicted_unlock, predicted_at_ready}
//   rework                      git log since the previous scorecard: reverts; and fix-ups = commits whose subject says
//                               fix/correct/wrong and that touch a file an EARLIER commit of the same window touched
//   asks / commands / context   this session's transcript (the newest .jsonl of the project): the messages sent to the reviewer
//                               through the browser (their question marks), tool calls since the previous scorecard, and the last
//                               call's input + cache tokens against a 1,000,000-token window
//   night                       the dashboard's own light, https://api.netzspec.com/fill/cisco/fill.json
// NOT COMPUTABLE, AND SAID SO: whether a question was "already ruled in state.md" (that is a reading, not a count) and whether a
// gate/test failure was caused by my own change. The script prints them as `n/a` and never folds them into a pass.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const LOG = path.join(ROOT, "data", "reports", "scorecard.jsonl");
const TODAY = path.join(ROOT, "data", "reports", "today.json");
const CONTEXT_WINDOW = 1_000_000;
const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const readJson = (f: string): any => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const history: any[] = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

// ------------------------------------------------------------------------------------------------ --dump-ready (on the box)
if (argv.includes("--dump-ready")) {
  const { query, closePool } = await import("../src/store/db.js");
  const { jtlReadiness } = await import("../src/api/queries/jtlExport.js");
  // THE SCOPE (reviewer, 5 Oct 2026: "make the scorecard read the scope from state.md and compute top-5 and ready within it, so
  // the flags judge router work against router blockers"). --scope <category>: ready, scanned and the sole blockers are counted
  // over that category; the catalogue's ready is still counted and printed beside it, never instead of it.
  const scope = argv.includes("--scope") ? argv[argv.indexOf("--scope") + 1] ?? null : null;
  const rows = (await query<{ sku: string; cat: string }>(`SELECT p.sku, c.slug AS cat FROM parts p JOIN vendors v ON v.id = p.vendor_id
    JOIN categories c ON c.id = p.category_id WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware'`)).rows;
  const skus = rows.map((r) => r.sku);
  const catOf = new Map(rows.map((r) => [r.sku, r.cat]));
  if (scope && !rows.some((r) => r.cat === scope)) { console.error(`--scope ${scope}: no live hardware part in that category -- refusing a scope that scores nothing`); process.exit(2); }
  // SPARES COUNTED APART (reviewer, 7 Oct 2026, with the spare ruling): "Report it as 'ready 440 = N bases + M spares' from now
  // on. Otherwise the doubling inflates the router total without a single new product being filled." A spare is Cisco's
  // trailing '=' (the same convention build-spare-of.mts pairs on).
  let ready = 0, readyAll = 0, scanned = 0, readySpares = 0;
  const sole = new Map<string, number>();
  for (let i = 0; i < skus.length; i += 2000) {
    const r = await jtlReadiness({ vendor: "cisco", skus: skus.slice(i, i + 2000) });
    for (const s of r.skus ?? []) {
      if (s.ready) readyAll++;
      if (scope && catOf.get(s.sku) !== scope) continue;
      scanned++;
      if (s.ready) { ready++; if (s.sku.endsWith("=")) readySpares++; continue; }
      const rs = [...new Set(s.reasons)];
      if (rs.length === 1) sole.set(rs[0], (sole.get(rs[0]) ?? 0) + 1);
    }
  }
  // REQUIRED SLOTS PRESENT (completeness sums): a SLOT measure, printed under its own name. Until 2 Oct 2026 it was printed as
  // "filled" beside a board whose "filled" is the fill-state share -- two numbers, one word, two computations.
  const f = (await query<{ present: string; total: string }>(`SELECT sum(c.required_present)::text AS present, sum(c.required_total)::text AS total
    FROM completeness c JOIN parts p ON p.id = c.part_id JOIN vendors v ON v.id = p.vendor_id WHERE v.slug = 'cisco' AND NOT c.no_profile`)).rows[0];
  // FILLED: the fill-state share, computed by the board's own module (src/core/fillState.ts: its SQL, its classifier, its share)
  // and compared with the last recorded build -- the board is green only when the live histogram IS that record, so a
  // difference here is a write since the build and is printed, never smoothed over.
  const fsm = await import("../src/core/fillState.js");
  const hist = fsm.fillHistogram((await query<{ method: string; inherited: boolean; doc_type: string | null; n: string }>(fsm.FILL_STATE_SQL)).rows);
  const share = fsm.filledShare(hist.states, hist.total);
  let record: { at: string; git_sha: string; same_as_live: boolean } | null = null, record_error: string | null = null;
  try {
    const last = fsm.readFillStateHistory(path.join(ROOT, fsm.FILL_STATE_HISTORY)).pop();
    record = last ? { at: last.at, git_sha: last.git_sha, same_as_live: fsm.sameHistogram(last.states, hist.states) } : null;
  } catch (e) { record_error = e instanceof Error ? e.message : String(e); }
  console.log(JSON.stringify({ ready, ready_spares: readySpares, ready_bases: ready - readySpares, scanned, scope, ready_catalogue: readyAll, scanned_catalogue: skus.length,
    required_present_pct: Math.round((1000 * Number(f.present)) / Number(f.total)) / 10,
    fill: { pct: share.pct, filled: share.filled, spec_total: share.spec_total, total: hist.total,
      filled_inherited: hist.states.filled_inherited ?? 0, derived_operational: hist.states.derived_operational ?? 0,
      outside_seven: Object.keys(hist.states).filter((k) => !(fsm.FILL_STATES as readonly string[]).includes(k)), record, record_error },
    top5: [...sole].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => ({ blocker: k, parts: n })) }));
  await closePool();
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------ --verdict
if (arg("--verdict") !== undefined) {
  if (!history.length) { console.error("no recorded scorecard to attach a verdict to"); process.exit(2); }
  history[history.length - 1].verdict = arg("--verdict");
  fs.writeFileSync(LOG, history.map((h) => JSON.stringify(h)).join("\n") + "\n");
  console.log(`verdict set on the scorecard of ${history[history.length - 1].at}`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------ the scorecard
const prev = history[history.length - 1] ?? null;
const now = new Date();
// readiness: fresh, on the box, through the deployed script
// the scope is READ from state.md ("- SCOPE: category=<slug>"), the file the reviewer and the operator read, so the scorecard can
// never judge a scope nobody wrote down; no line = the whole catalogue, as before
const STATE = path.join(ROOT, "docs", "reviewer", "2026-09-28", "state.md");
const scopeLine = fs.existsSync(STATE) ? /^- SCOPE: category=([a-z0-9-]+)/m.exec(fs.readFileSync(STATE, "utf8")) : null;
const SCOPE = scopeLine ? scopeLine[1] : null;
const box = execFileSync("ssh", ["-o", "ConnectTimeout=20", "-i", path.join(os.homedir(), ".ssh", "dubaifix_hetzner"), "root@77.42.72.81",
  `cd /root/netzspec-api && npx tsx scripts/scorecard.ts --dump-ready${SCOPE ? ` --scope ${SCOPE}` : ""}`], { encoding: "utf8", timeout: 900_000 });
const R = JSON.parse(box.trim().split("\n").filter((l) => l.startsWith("{")).pop()!);
const today = readJson(TODAY);

// THIS session's transcript, named explicitly (--transcript, or NETZSPEC_SESSION_TRANSCRIPT). The first version took the project
// directory's NEWEST .jsonl and read another session running in D:\Project: 0 questions, the wrong context, a 6-hour window.
// Without a transcript, asks / commands / context are printed as not computed -- never borrowed from another session.
const tfile = arg("--transcript") ?? process.env.NETZSPEC_SESSION_TRANSCRIPT ?? null;
if (tfile && !fs.existsSync(tfile)) { console.error(`no transcript at ${tfile}`); process.exit(2); }
const entries = tfile ? fs.readFileSync(tfile, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const sends: { at: string; text: string }[] = [];
const toolIds = new Map<string, string>();
let lastUsage: any = null;
for (const e of entries) {
  const m = e.message;
  if (e.type !== "assistant" || !m) continue;
  if (m.usage) lastUsage = m.usage;
  for (const c of Array.isArray(m.content) ? m.content : []) {
    if (c?.type !== "tool_use") continue;
    toolIds.set(c.id, e.timestamp);
    const js = String(c.input?.text ?? "");
    if (/javascript_tool$/.test(c.name) && js.includes("insertText")) {
      const msg = /const msg = `([\s\S]*?)`;/.exec(js)?.[1];
      if (msg) sends.push({ at: e.timestamp, text: msg });
    }
  }
}
const uniqSends = [...new Map(sends.map((s) => [s.text, s])).values()];
// the window: since the previous scorecard; the first one counts since the report before the latest one sent
const since = prev?.at ?? uniqSends[uniqSends.length - 2]?.at ?? new Date(now.getTime() - 6 * 3600e3).toISOString();
const commands = [...toolIds.values()].filter((t) => t > since).length;
const asked = uniqSends.filter((s) => s.at > since);
const questions = asked.reduce((n, s) => n + (s.text.match(/\?(\s|$)/g) ?? []).length, 0);
const ctx = lastUsage ? (lastUsage.input_tokens ?? 0) + (lastUsage.cache_read_input_tokens ?? 0) + (lastUsage.cache_creation_input_tokens ?? 0) : null;
const ctxPct = ctx === null ? null : Math.round((100 * ctx) / CONTEXT_WINDOW);

// git: reverts and fix-ups in the window
const log = execFileSync("git", ["log", `--since=${since}`, "--reverse", "--name-only", "--format=@@%H|%s"], { cwd: ROOT, encoding: "utf8" });
const commits: { sha: string; subject: string; files: string[] }[] = [];
for (const block of log.split("@@").filter(Boolean)) {
  const [head, ...files] = block.trim().split("\n");
  const [sha, subject] = [head.slice(0, head.indexOf("|")), head.slice(head.indexOf("|") + 1)];
  commits.push({ sha, subject, files: files.filter(Boolean) });
}
const seen = new Set<string>();
const CODE = /^(src|scripts|scraper|tests|ops)\//;
let fixups = 0, reverts = 0;
const fixupList: string[] = [];
for (const c of commits) {
  if (/^Revert\b/i.test(c.subject)) reverts++;
  // CODE only: a state.md or report commit that mentions a fix is bookkeeping, not rework (the first run counted one)
  else if (/\b(fix|fixes|fixed|correct|corrected|wrong)\b/i.test(c.subject) && c.files.some((f) => CODE.test(f) && seen.has(f))) { fixups++; fixupList.push(c.sha.slice(0, 7)); }
  c.files.filter((f) => CODE.test(f)).forEach((f) => seen.add(f));
}

// the night, from the dashboard's own light
let light: any = null;
try { light = JSON.parse(execFileSync("curl", ["-s", "--max-time", "20", "https://api.netzspec.com/fill/cisco/fill.json"], { encoding: "utf8" })).light; } catch { /* reported as unknown */ }

// outcome and focus
// a delta only within ONE scope: the first scoped card after a catalogue one (574 -> 199) is a new baseline, not a loss
const sameScope = !!prev && (prev.scope ?? null) === (R.scope ?? null);
const readyDelta = prev && sameScope ? R.ready - prev.ready : null;
// FILLED is the fill-state share since 2 Oct 2026; an older scorecard has no `filled_share_pct`, so the first one under this
// measure has no delta rather than a fake jump from the slot measure (9.6 -> 16.0 would read as +6.4 % of work never done).
const fillPct: number | null = R.fill?.pct ?? null;
const pd = (a: number | null, b: unknown) => a !== null && typeof b === "number" ? Math.round((a - b) * 10) / 10 : null;
const filledDelta = pd(fillPct, prev?.filled_share_pct);
// REQUIRED SLOTS PRESENT: the same computation older scorecards recorded under the name `filled_pct`, so it compares with them
const requiredDelta = pd(R.required_present_pct ?? null, prev?.required_present_pct ?? prev?.filled_pct);
/** one decimal always: "16.0", never "16" beside a "9.6" */
const p1 = (v: unknown) => typeof v === "number" ? v.toFixed(1) : "n/a";
const sign = (d: number | null, first: string) => d === null ? first : `${d >= 0 ? "+" : ""}${d}%`;
const rec = R.fill?.record;
const recNote = R.fill?.record_error ? `the fill-state history is UNREADABLE (${R.fill.record_error}) -- could not compare`
  : !rec ? "no build has recorded the histogram yet"
  : rec.same_as_live ? `= the last recorded build (${String(rec.git_sha).slice(0, 7)}, ${String(rec.at).slice(0, 16)})`
  : `NOT the last recorded build (${String(rec.git_sha).slice(0, 7)}, ${String(rec.at).slice(0, 16)}): a write since that build -- the board's fill_state_partition is red until a build records it`;
const predicted = Number(today?.predicted_unlock ?? NaN);
const actual = Number.isFinite(Number(today?.predicted_at_ready)) ? R.ready - Number(today.predicted_at_ready) : null;
const rank = R.top5.findIndex((b: any) => b.blocker === today?.blocker_key);
const offList = rank < 0;
const streak = readyDelta === 0 ? (prev?.streak ?? 0) + 1 : 0;      // a first scorecard has no delta: never counted as +0

// the flags (standing order, item 3)
const flags: string[] = [];
const prevStalledish = prev && prev.ready_delta === 0 && !(Number(prev.actual) > 0);
if (readyDelta === 0 && !(Number(actual) > 0) && prevStalledish) flags.push("STALLED: 2 reports in a row with ready +0 and no unlocking rule shipped");
// reviewer, 30 Sep 2026: "ordered correctness work is not drift" -- today.json focus "ordered-correctness" is never DRIFT
const ordered = String(today?.focus ?? "").startsWith("ordered");   // "ordered-correctness" or "ordered": the reviewer's order
if (!ordered && (rank < 0 || rank > 2)) flags.push(`DRIFT: today's work (${today?.blocker_key ?? "no today.json"}) is not a top-3 blocker by ready-gain`);
if (fixups >= 2) flags.push(`SLOPPY: ${fixups} fix-ups of my own commits in this batch (${fixupList.join(", ")})`);
const miss = (p: number, a: number | null) => p > 0 && a !== null && Math.abs(p - a) / p > 0.3;
if (miss(predicted, actual) && prev && miss(Number(prev.predicted), prev.actual)) flags.push("OFF-TARGET: prediction vs actual off by > 30% twice in a row");
if ((ctxPct ?? 0) > 60 || (commands > 150 && readyDelta === 0)) flags.push(`WASTEFUL: context ${ctxPct ?? "?"}%, ${commands} commands, ready ${readyDelta === null ? "?" : `+${readyDelta}`}`);
if (light?.color === "RED") flags.push(`RED-NIGHT: ${light.reason}`);
// FINAL FILL ORDER (30 Sep 2026), LIMITS: the owner's Max plan only. The headless lane pauses at 55 % weekly usage; ALL work stops
// at 70 % (commit, state.md, report, wait for the reset). The % is the app's usage card ("Weekly · all models"), which this
// script cannot read -- it is handed in with --weekly-pct, and a scorecard without it says so rather than leaving the line out.
const weeklyArg = arg("--weekly-pct");
const weekly = weeklyArg !== undefined && Number.isFinite(Number(weeklyArg)) ? Number(weeklyArg) : null;
// --limits-lifted "<who, when>": the operator lifted the stops (2 Oct 2026: "the limit usage is no more with you right now till
// further notice"). The flag still prints, so the usage stays visible, but it says the stop is lifted and by whom.
const lifted = arg("--limits-lifted");
// reviewer, 2 Oct 2026, on the lifted limit: the plan still stops EVERY session at 100 % until the reset -- "flag at 90 % so it
// doesn't cut off mid-run".
if (weekly !== null && lifted && weekly >= 90) flags.push(`LIMIT-90: weekly usage ${weekly}% -- the plan stops every session at 100% until the reset: finish the running step, start no long run, report`);
else if (weekly !== null && weekly >= 70) flags.push(lifted ? `LIMIT-70 LIFTED (${lifted}): weekly usage ${weekly}%` : `LIMIT-70: weekly usage ${weekly}% -- ALL work stops: commit, state.md, report, wait for the reset`);
else if (weekly !== null && weekly >= 55) flags.push(lifted ? `LIMIT-55 LIFTED (${lifted}): weekly usage ${weekly}%` : `LIMIT-55: weekly usage ${weekly}% -- the headless lane is paused`);

const hhmm = (ms: number) => `${String(Math.floor(ms / 3600e3)).padStart(2, "0")}:${String(Math.floor((ms % 3600e3) / 60e3)).padStart(2, "0")}`;
const card = {
  at: now.toISOString(), since, scope: R.scope ?? null, ready: R.ready, ready_bases: R.ready_bases ?? null, ready_spares: R.ready_spares ?? null, ready_delta: readyDelta, ready_catalogue: R.ready_catalogue ?? null,
  filled_share_pct: fillPct, filled_share_delta: filledDelta, filled_facts: R.fill?.filled ?? null, spec_facts: R.fill?.spec_total ?? null,
  fill_record: rec ? { git_sha: rec.git_sha, at: rec.at, same_as_live: rec.same_as_live } : null,
  required_present_pct: R.required_present_pct ?? null, required_present_delta: requiredDelta,
  predicted: Number.isFinite(predicted) ? predicted : null, actual, rule: today?.rule ?? null, blocker_key: today?.blocker_key ?? null,
  blocker_rank: rank >= 0 ? rank + 1 : null, top5: R.top5, off_list: offList, fixups, fixup_commits: fixupList, reverts,
  questions, questions_already_ruled: null, commands, context_tokens: ctx, context_pct: ctxPct, weekly_pct: weekly, limits_lifted: lifted ?? null, streak, flags,
  light: light ? `${light.color}: ${light.reason}` : "unknown", verdict: null,
};
const lines = [
  ...(flags.length ? ["FLAGS: " + flags.join(" | "), ""] : []),
  `outcome   ready ${readyDelta === null ? (prev && !sameScope ? "(first card in this scope)" : "(first scorecard)") : `${readyDelta >= 0 ? "+" : ""}${readyDelta}`} (${R.ready}${R.ready_spares === undefined ? "" : ` = ${R.ready_bases} bases + ${R.ready_spares} spares`} of ${R.scanned}${R.scope ? ` in scope ${R.scope}; catalogue ${R.ready_catalogue} of ${R.scanned_catalogue}` : ""}) · filled ${sign(filledDelta, "(first under the fill-state share)")} (${p1(fillPct)}%) · today's rule unlocked: predicted ${Number.isFinite(predicted) ? predicted : "n/a"} / actual ${actual ?? "n/a"}`,
  `fill      filled ${p1(fillPct)}% = ${R.fill?.filled?.toLocaleString("en") ?? "?"} of ${R.fill?.spec_total?.toLocaleString("en") ?? "?"} spec facts (the board's fill-state share, src/core/fillState.ts), ${recNote} · filled_inherited ${R.fill?.filled_inherited?.toLocaleString("en") ?? "?"} beside it, derived_operational ${R.fill?.derived_operational?.toLocaleString("en") ?? "?"} apart${R.fill?.outside_seven?.length ? ` · OUTSIDE the seven states: ${R.fill.outside_seven.join(", ")}` : ""} · a DIFFERENT measure: required slots present ${p1(R.required_present_pct)}% (completeness sums, ${sign(requiredDelta, "first")})`,
  `focus     ${ordered ? `${today.focus}: reviewer-ordered work` : offList ? `off the top-5 by ready-gain (${today?.blocker_key ?? "no today.json"})` : `blocker #${rank + 1} of the top-5 (${today.blocker_key})`} · off-list work: ${offList ? `yes (${today?.rule ?? "?"})` : "no"} · top-5: ${R.top5.map((b: any) => `${b.blocker} ${b.parts}`).join(", ")}`,
  `rework    commits fixing my own earlier commits: ${fixups}${fixupList.length ? ` (${fixupList.join(", ")})` : ""} · reverts: ${reverts} · commits in window: ${commits.length}`,
  `asks      ${tfile ? `questions to reviewer: ${questions}` : "questions to reviewer: not computed (no transcript given)"} · of which already ruled in state.md: n/a (a reading, not a count)`,
  `cost      ${tfile ? `context used: ${ctxPct ?? "?"}% (${ctx?.toLocaleString("en") ?? "?"} of ${CONTEXT_WINDOW.toLocaleString("en")} tokens) · commands run: ${commands}` : "context / commands: not computed (no transcript given)"} · time since last report: ${hhmm(now.getTime() - new Date(since).getTime())}`,
  `limits    weekly usage (all models): ${weekly === null ? "NOT GIVEN (--weekly-pct)" : `${weekly}%`} · headless lane pauses at 55%, all work stops at 70%${lifted ? ` · LIFTED by the operator (${lifted})` : ""}`,
  `streak    consecutive reports with ready +0: ${streak} · night: ${card.light}`,
];
console.log(lines.join("\n"));
if (argv.includes("--record")) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify(card) + "\n"); console.log(`(recorded: ${path.relative(ROOT, LOG)})`); }
