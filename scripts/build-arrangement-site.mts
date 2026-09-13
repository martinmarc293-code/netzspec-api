// scripts/build-arrangement-site.mts — the PUBLIC ARRANGEMENT SITE: phase 1 ("arranging cups") of one vendor as static
// HTML + JSON, readable by a person and by a model fetching the URL (operator, 13 Sep 2026: "a live url … so claude web can
// see and read the structure of the data and see what is wrong and what is missing").
//
//   npx tsx scripts/build-arrangement-site.mts --vendor cisco --out DIR --report FILE --ledgers DIR
//        [--plans FILE] [--evidence FILE] [--provenance FILE] [--spec FILE] [--decision FILE] [--state preview|committed]
//        [--note TEXT] [--refused]
//
// WHAT IT SHOWS, AND ONLY FROM THE BUILD'S OWN ARTIFACTS. It re-computes nothing about parts: every number comes from the
// cup ledgers (scripts/build-cup-ledger.mts), the completeness report (scripts/build-completeness.mts, the draft when the
// build refused — then the page says so, above everything), the kind-layer plans, the printed-bar evidence and the link
// provenance report. The findings section applies stated rules to those artifacts and prints its denominators; a rule
// that could not be evaluated says "not in this build", never "0".
//
// Server-rendered, no script: a fetcher that does not run JavaScript reads the whole page. Every page links its JSON.
// Nothing here is a fact value or an API key: structure, counts and evidence labels only.
import fs from "node:fs";
import path from "node:path";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";

// ---------------------------------------------------------------------------------------------------------------- args
const argv = process.argv.slice(2);
const opt = (k: string): string | null => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };
const need = (k: string): string => { const v = opt(k); if (!v) throw new Error(`${k} is required`); return v; };
const vendor = need("--vendor"), outDir = need("--out"), reportFile = need("--report"), ledgerDir = need("--ledgers");
const state = opt("--state") ?? "preview";
const note = opt("--note") ?? "";
const refused = argv.includes("--refused");
const readJson = <T,>(f: string | null): T | null => (f && fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null);
const readText = (f: string | null): string | null => (f && fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n") : null);

type Pct = { num?: number; den?: number; pct?: number | null };
type AnyObj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const report: AnyObj = readJson<AnyObj>(reportFile) ?? (() => { throw new Error(`no report at ${reportFile}`); })();
const ledgers = new Map<string, AnyObj>();
for (const f of fs.readdirSync(ledgerDir).filter((f) => f.startsWith(`${vendor}-`) && f.endsWith(".json")).sort()) {
  const l = readJson<AnyObj>(path.join(ledgerDir, f))!;
  ledgers.set(l.category, l);
}
const plans = readJson<AnyObj[]>(opt("--plans")) ?? null;
const evidence = readJson<AnyObj[]>(opt("--evidence")) ?? null;
const provenance = readJson<AnyObj>(opt("--provenance"));
const spec = readText(opt("--spec"));
const decision = readText(opt("--decision"));
const questions = readText(opt("--questions"));

// ------------------------------------------------------------------------------------------------------------- helpers
const esc = (x: unknown): string => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x: unknown): string => (x === null || x === undefined ? "<span class=na>not in this build</span>" : typeof x === "number" ? x.toLocaleString("en-US") : esc(x));
const frac = (p: Pct | undefined | null): string => (!p || p.den === undefined ? "<span class=na>—</span>" : `${n(p.num)}/${n(p.den)} = ${p.pct === null || p.pct === undefined ? "—" : p.pct + "%"}`);
const pctOf = (a: number, b: number): string => (b ? `${Math.round((1000 * a) / b) / 10}%` : "—");
const slug = (s: string) => s.replace(/[^a-z0-9-]+/gi, "-");
const keysOf = (arr: unknown): string[] => (Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? x : (x as AnyObj).key)).filter(Boolean) : []);
const dictLine = (key: string): string => {
  const d = (FIELD_DICTIONARY as AnyObj)[key];
  if (!d) return "<span class=bad>not in the dictionary</span>";
  return esc([d.type, d.unit, d.domain ? `enum(${d.domain.length})` : "", d.band ? `band ${d.band.join("–")}` : ""].filter(Boolean).join(" · "));
};
const generatedAt = new Date().toISOString();
const commit = report.built_on_commit ?? "unknown";
const freezeFile = path.join("data", "freeze", `${vendor}.json`);
const freezeHash = fs.existsSync(freezeFile) ? (JSON.parse(fs.readFileSync(freezeFile, "utf8")) as AnyObj).freeze_hash : null;
const failedChecks: AnyObj[] = (report.cross_checks ?? []).filter((c: AnyObj) => !c.passed);
const categories: AnyObj[] = [...(report.categories ?? [])].sort((a, b) => (b.hardware_parts ?? 0) - (a.hardware_parts ?? 0));

const CSS = `
:root{--bg:#0d1117;--fg:#e6edf3;--mut:#8b949e;--line:#30363d;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--link:#58a6ff;--card:#161b22}
body{background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:0;padding:18px 22px 60px}
a{color:var(--link)}h1{font-size:20px;margin:6px 0}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
h3{font-size:14px;margin:22px 0 6px}table{border-collapse:collapse;margin:6px 0 14px;font-size:12.5px}
th,td{border:1px solid var(--line);padding:3px 7px;text-align:left;vertical-align:top}th{background:var(--card);position:sticky;top:0}
td.r,th.r{text-align:right}.wrap{overflow-x:auto;max-width:100%}.na{color:var(--mut)}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.banner{padding:10px 12px;border-radius:6px;margin:10px 0;font-size:13px}.b-preview{background:#3d2a00;color:#f0c000}.b-refused{background:#3d0d0d;color:#ff8a80}
.b-ok{background:#0f2d17;color:#7ee787}.muted{color:var(--mut)}nav a{margin-right:14px}pre{white-space:pre-wrap;background:var(--card);padding:10px;border-radius:6px;font-size:12px}
details{margin:6px 0}summary{cursor:pointer;color:var(--link)}code{background:var(--card);padding:0 3px;border-radius:3px}
.tag{display:inline-block;padding:0 5px;border-radius:3px;font-size:11px;margin-right:3px}.t-req{background:#1f6feb33;color:#79c0ff}.t-pend{background:#d2992233;color:#e3b341}
.t-opt{background:#30363d;color:#8b949e}.t-na{background:#21262d;color:#6e7681}.t-gap{background:#f8514933;color:#ff7b72}`;

function page(title: string, rel: string, body: string, jsonHref: string | null): string {
  const up = rel === "" ? "" : "../";
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<meta name=robots content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<nav><a href="${up}index.html">${esc(vendor)} arrangement</a><a href="${up}questions.html">open questions for the reviewer</a><a href="${up}findings.html">findings (what is wrong / missing)</a><a href="${up}plans.html">move &amp; class plans</a><a href="${up}provenance.html">link provenance</a><a href="${up}README.txt">README for machines</a>${jsonHref ? `<a href="${esc(jsonHref)}">this page as JSON</a>` : ""}</nav>
${statusBanner()}
${body}
<p class=muted style="margin-top:40px">Generated ${esc(generatedAt)} from commit ${esc(commit)} by scripts/build-arrangement-site.mts. Structure and counts only — no fact values, no keys.</p>
</body></html>`;
}
function statusBanner(): string {
  const parts: string[] = [];
  if (refused || failedChecks.length) {
    parts.push(`<div class="banner b-refused"><b>THE REPORT BUILD ${refused ? "REFUSED" : "FAILED"} ${failedChecks.length} CROSS-CHECK(S)</b> — numbers that depend on them are not final: ` +
      failedChecks.map((c) => `<b>${esc(c.name)}</b>: ${esc(String(c.detail ?? "").slice(0, 220))}`).join(" · ") + "</div>");
  }
  const cls = state === "committed" && !failedChecks.length ? "b-ok" : "b-preview";
  parts.push(`<div class="banner ${cls}"><b>${esc(state.toUpperCase())}</b> · vendor <b>${esc(vendor)}</b> · report built on commit <b>${esc(commit)}</b>` +
    ` at ${esc(report.generated_at ?? "?")} · freeze hash ${esc(freezeHash ?? "none")} · ledgers on ${esc([...new Set([...ledgers.values()].map((l) => l.built_on_commit))].join(", "))}` +
    (note ? `<br>${esc(note)}` : "") + "</div>");
  return parts.join("\n");
}
const write = (rel: string, content: string) => { const f = path.join(outDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };

// --------------------------------------------------------------------------------------------------- plans per category
const planRows = plans ?? [];
const plansOut = (cat: string) => planRows.filter((p) => p.category === cat);
const plansIn = (cat: string) => planRows.filter((p) => p.action === "move" && p.to === cat);

// ------------------------------------------------------------------------------------------------------------ findings
type Finding = { id: string; severity: "bad" | "warn" | "info"; title: string; rule: string; count: number | null; denominator: string; rows: AnyObj[] };
const findings: Finding[] = [];
/** Spec v2 sanity rule 3: the rows a buyer chooses the kind on. */
const PRIMARY: Record<string, string[]> = {
  router: ["router_throughput", "wan_interfaces", "lan_interfaces", "module_slots"], switch: ["ports", "switching_capacity"],
  ap: ["wifi_generation", "radio_count"], "access-point": ["wifi_generation", "radio_count"], server: ["cpu_sockets_max", "memory_max", "drive_bays"],
};
{
  const rows: AnyObj[] = failedChecks.map((c) => ({ check: c.name, detail: String(c.detail ?? "").slice(0, 400) }));
  findings.push({ id: "report-cross-checks", severity: rows.length ? "bad" : "info", title: "Report build cross-checks that failed", rule: "every cross-check of scripts/build-completeness.mts must pass before the report is the committed one",
    count: rows.length, denominator: `${(report.cross_checks ?? []).length} checks`, rows });
}
{
  const rows: AnyObj[] = [];
  let kindsSeen = 0;
  for (const [cat, l] of ledgers) for (const [kind, k] of Object.entries<AnyObj>(l.kinds ?? {})) {
    kindsSeen++;
    const req = keysOf(k.required).length, pend = keysOf(k.pending_until_gate_answered).length;
    if ((k.parts ?? 0) > 0 && req + pend === 0) rows.push({ category: cat, kind, parts: k.parts, required: req, pending: pend });
  }
  findings.push({ id: "kinds-asked-nothing", severity: rows.length ? "bad" : "info", title: "Kinds holding parts that are asked no cup at all", rule: "a hardware kind with parts asks >= 1 required or pending cup",
    count: rows.length, denominator: `${kindsSeen} kinds in ${ledgers.size} ledgers`, rows });
}
{
  const rows: AnyObj[] = [];
  let checked = 0;
  for (const [cat, l] of ledgers) for (const [kind, k] of Object.entries<AnyObj>(l.kinds ?? {})) {
    const prim = PRIMARY[kind];
    if (!prim || !(k.parts > 0)) continue;
    const units: [string, AnyObj][] = [["(kind core)", k], ...Object.entries<AnyObj>(k.roles ?? {})];
    for (const [unit, u] of units) {
      const asked = new Set([...keysOf(u.required), ...keysOf(u.pending_until_gate_answered)]);
      for (const cup of prim) { checked++; if (!asked.has(cup)) rows.push({ category: cat, kind, unit, parts: u.parts, cup, status: keysOf(u.not_applicable_by_kind).includes(cup) ? "not applicable" : "optional" }); }
    }
  }
  findings.push({ id: "primary-rows-not-asked", severity: rows.length ? "bad" : "info", title: "A kind's primary buyer rows that are NOT required (spec v2 sanity rule 3)",
    rule: "router: router_throughput, wan_interfaces, lan_interfaces, module_slots · switch: ports, switching_capacity · ap: wifi_generation, radio_count · server: cpu_sockets_max, memory_max, drive_bays — never demoted without the five-sheet hand read",
    count: rows.length, denominator: `${checked} (unit, primary cup) pairs`, rows });
}
{
  const rows: AnyObj[] = [];
  let units = 0;
  for (const [cat, l] of ledgers) for (const [kind, k] of Object.entries<AnyObj>(l.kinds ?? {})) {
    const u = (k.roles ?? {})["(unresolved)"];
    if (!u || !(k.parts > 0)) continue;
    units++;
    const issue = u.kind_issue_parts ?? u.parts_with_kind_issue ?? null;
    const share = issue === null ? (100 * u.parts) / k.parts : (100 * (u.parts - issue)) / Math.max(1, k.parts - issue);
    if (share > 3 || (issue ?? 0) > 0) rows.push({ category: cat, kind, kind_parts: k.parts, unresolved: u.parts, kind_issue_rows: issue, share_excluding_kind_issue_pct: Math.round(share * 10) / 10, over_3pct: share > 3, display: u.display ?? null });
  }
  findings.push({ id: "unresolved-roles", severity: rows.some((r) => r.over_3pct) ? "bad" : rows.length ? "warn" : "info", title: "Role axis: parts no role rule places (and rows that are not this kind at all)",
    rule: "unresolved minus kind-issue rows <= 3% of the kind (operator ruling); kind-issue rows leave when their move/class plan runs", count: rows.length, denominator: `${units} kinds with a role axis`, rows });
}
{
  const rows: AnyObj[] = [];
  let reqSeen = 0;
  for (const [cat, l] of ledgers) for (const [kind, k] of Object.entries<AnyObj>(l.kinds ?? {})) {
    if (!(k.parts > 0)) continue;
    for (const c of Array.isArray(k.required) ? k.required : []) {
      if (typeof c !== "object") continue;
      reqSeen++;
      if (c.observed_fill_path === false && c.observed_filled === false) rows.push({ category: cat, kind, parts: k.parts, cup: c.key, label_occurrences: c.label_occurrences ?? null, seed_only: c.seed_only ?? null });
    }
  }
  findings.push({ id: "required-without-fill-path", severity: rows.length ? "warn" : "info", title: "Required cups no source has ever filled for this kind (no observed fill path)",
    rule: "a required cup nothing can fill is a permanent gap — it needs a source, a mapper rule or a registered derivation, or it is not required", count: rows.length, denominator: `${reqSeen} (kind, required cup) pairs`, rows });
}
{
  const byCat = new Map<string, { move_out: number; move_in: number; class: number; ran: number }>();
  for (const p of planRows) {
    const a = byCat.get(p.category) ?? { move_out: 0, move_in: 0, class: 0, ran: 0 }; byCat.set(p.category, a);
    if (p.action === "move") { a.move_out++; const b = byCat.get(p.to) ?? { move_out: 0, move_in: 0, class: 0, ran: 0 }; byCat.set(p.to, b); b.move_in++; } else a.class++;
    if (p.run_id !== null) a.ran++;
  }
  const pending = planRows.filter((p) => p.run_id === null).length;
  findings.push({ id: "plans-not-run", severity: plans === null ? "warn" : pending ? "warn" : "info", title: "Category moves and class changes planned but not yet run",
    rule: "rows in the wrong table leave by recorded runs (move-category / exact product-class rules); until then they sit in their kind's (unresolved) role",
    count: plans === null ? null : pending, denominator: plans === null ? "no plans file in this build" : `${planRows.length} plans (${planRows.filter((p) => p.action === "move").length} moves, ${planRows.filter((p) => p.action === "class").length} class changes)`,
    rows: [...byCat].map(([category, a]) => ({ category, ...a })).sort((x, y) => y.move_out + y.class - x.move_out - x.class) });
}
{
  const measured = new Set((evidence ?? []).map((e) => e.category));
  const rows = categories.map((c) => ({ category: c.category, measured: measured.has(c.category), entries: (evidence ?? []).filter((e) => e.category === c.category).length,
    mapper_gap_entries: (evidence ?? []).filter((e) => e.category === c.category && e.state === "mapper-gap").length }));
  findings.push({ id: "printed-bar-not-measured", severity: evidence === null ? "warn" : rows.some((r) => !r.measured) ? "warn" : "info",
    title: "Categories whose required cups are not yet measured against the printed-on-the-page bar",
    rule: "operator step 2: required stays required unless printed < 50% over relevant held parts; printed >= 50 and mapped < 50 = mapper-gap; primary rows need the five-sheet hand read",
    count: evidence === null ? null : rows.filter((r) => !r.measured).length, denominator: `${rows.length} categories`, rows });
}
{
  const s = provenance?.stats;
  const rows = s ? [{ links: s.links, basis: s.basis, relevance: s.relevance, linking_defect_links: s.linking_defect_links, linking_defect_documents: s.linking_defect_documents, held_before: s.held?.before, held_after: s.held?.after, hardware_parts: s.held?.parts }] : [];
  findings.push({ id: "link-provenance", severity: !s ? "warn" : (s.basis?.could_not_check ?? 0) > 0 || (s.linking_defect_links ?? 0) > 0 ? "warn" : "info",
    title: "Link provenance: links that are inferred (linking defects) or could not be checked", rule: "held = >= 1 doc_parts row with doc_relevance spec_for_kind AND link_basis explicit|family; inferred links are defects; unreadable evidence is its own state",
    count: s ? (s.linking_defect_links ?? 0) + (s.basis?.could_not_check ?? 0) : null, denominator: s ? `${s.links} links` : "no provenance report in this build", rows });
}
{
  const rows: AnyObj[] = [];
  for (const c of categories) for (const k of c.kinds ?? []) for (const cup of k.cups ?? []) {
    if ((cup.not_parsed ?? 0) > 0 || (cup.mapper_gap ?? 0) > 0) rows.push({ category: c.category, kind: k.kind, cup: cup.key, requirement: cup.requirement, held_asked: cup.held_asked, filled: cup.filled, not_parsed: cup.not_parsed, mapper_gap: cup.mapper_gap ?? null, not_held: cup.not_held, fill_path: cup.fill_path });
  }
  rows.sort((a, b) => (b.not_parsed + (b.mapper_gap ?? 0)) - (a.not_parsed + (a.mapper_gap ?? 0)));
  findings.push({ id: "work-order-not-parsed", severity: "info", title: "Filling work order: required slots on HELD parts that are empty although a spec sheet is linked (top 60)",
    rule: "not parsed = held part, required cup, no fact; mapper-gap = the page prints it and no mapper rule maps it", count: rows.length, denominator: "all (category, kind, required cup) rows with an empty held slot", rows: rows.slice(0, 60) });
}
{
  const rows = (report.residue ?? []).map((r: AnyObj) => ({ item: r.item, count: r.count ?? null, why_parked: r.why_parked ?? r.count_reason ?? null, trigger: r.trigger ?? null }));
  findings.push({ id: "residue", severity: "info", title: "Parked residue (named, counted, with its trigger)", rule: "nothing is dropped silently: each parked item has a count and the event that brings it back", count: rows.length, denominator: "report.residue", rows });
}

// --------------------------------------------------------------------------------------------------------- render bits
function tableOf(rows: AnyObj[], cols?: string[], limit = 400): string {
  if (!rows.length) return "<p class=muted>none</p>";
  const keys = cols ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => (v === null || v === undefined ? "<span class=na>—</span>" : typeof v === "object" ? `<code>${esc(JSON.stringify(v))}</code>` : typeof v === "number" ? v.toLocaleString("en-US") : esc(v));
  return `<div class=wrap><table><tr>${keys.map((k) => `<th>${esc(k)}</th>`).join("")}</tr>${rows.slice(0, limit).map((r) => `<tr>${keys.map((k) => `<td${typeof r[k] === "number" ? " class=r" : ""}>${cell(r[k])}</td>`).join("")}</tr>`).join("")}</table></div>` +
    (rows.length > limit ? `<p class=muted>${rows.length - limit} more rows in the JSON.</p>` : "");
}
const sevTag = (s: string) => `<span class="tag ${s === "bad" ? "t-gap" : s === "warn" ? "t-pend" : "t-opt"}">${s}</span>`;

// ------------------------------------------------------------------------------------------------------------- index
{
  const b = report.brand ?? {};
  const f = b.filled ?? {};
  const brandRows = [
    ["hardware parts", n(b.hardware_parts)], ["arranged (asked >= 1 cup)", frac(b.arranged)], ["held (spec sheet for the part's kind, explicit|family link)", frac(b.held)],
    ["held by document type only (before relevance)", b.held_by_doc_type_legacy ? frac(b.held_by_doc_type_legacy) : "<span class=na>not in this build</span>"],
    ["filled (over required slots of held parts)", frac(f)], ["required slots on held parts", n(f.required_slots_held)], ["not published (confirmed absent)", n(f.not_published)],
    ["not parsed (sheet linked, no fact)", n(f.not_parsed)], ["mapper gap (sheet prints it, no mapper rule)", n(f.mapper_gap ?? null)], ["not held — parts (acquisition, outside the %)", n(f.not_held_parts)],
    ["not held — slots", n(f.not_held_slots)], ["would refuse (stored values today's normaliser refuses)", n(b.defects?.would_refuse)], ["inherited share of filled", frac(b.inherited_share)],
    ["unresolved kind (parts)", n(b.unresolved_kind?.parts ?? null)],
  ];
  const catRows = categories.map((c) => {
    const l = ledgers.get(c.category);
    const kinds = (c.kinds ?? []).length;
    const po = plansOut(c.category), pi = plansIn(c.category);
    return `<tr><td><a href="categories/${slug(c.category)}.html">${esc(c.category)}</a></td><td class=r>${n(c.hardware_parts)}</td><td class=r>${kinds}</td>` +
      `<td class=r>${n(c.unresolved_kind_parts ?? null)}</td><td>${frac(c.held)}</td><td>${frac(c.filled)}</td><td class=r>${n(c.filled?.not_parsed)}</td>` +
      `<td class=r>${n(c.filled?.mapper_gap ?? null)}</td><td class=r>${n(c.filled?.not_held_parts)}</td><td class=r>${po.filter((p) => p.action === "move").length} / ${pi.length} / ${po.filter((p) => p.action === "class").length}</td>` +
      `<td class=muted>${esc(l?.profile_hash ?? "no ledger")}</td></tr>`;
  }).join("");
  const body = `<h1>${esc(vendor)} — phase 1: arranging cups</h1>
${questions ? `<div class="banner b-refused"><b>OPEN QUESTIONS FOR THE REVIEWER</b> — decisions the parent has not taken, each with its measurement: <a href="questions.html">questions.html</a> (raw: <a href="questions.md">questions.md</a>)</div>` : ""}
<p>This site shows how every ${esc(vendor)} hardware part is ARRANGED before any value is filled: which <b>category</b> table it sits in (layer 1), which <b>kind</b> it is (layer 2, derived from the SKU by code), which <b>role</b> within the kind where the kind is too coarse (layer 3, <code>deploy_role</code>), and which <b>cups</b> — required, pending, optional, not applicable — that combination is asked (layer 4). Then, per cup, the state of every slot: filled, not published, not parsed, mapper gap, not held. Everything wrong or missing that a rule can detect is on the <a href="findings.html">findings</a> page.</p>
<h2>Brand</h2><div class=wrap><table>${brandRows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table></div>
<h2>Findings at a glance</h2>${tableOf(findings.map((x) => ({ severity: x.severity, finding: x.title, count: x.count, over: x.denominator })), ["severity", "finding", "count", "over"])}
<p><a href="findings.html">open every finding with its rows →</a></p>
<h2>Categories</h2><div class=wrap><table><tr><th>category</th><th class=r>hardware parts</th><th class=r>kinds</th><th class=r>unresolved kind</th><th>held</th><th>filled (held slots)</th><th class=r>not parsed</th><th class=r>mapper gap</th><th class=r>not held parts</th><th class=r>plans: moves out / in / class</th><th>profile hash</th></tr>${catRows}</table></div>
<h2>How to read the states</h2>
<div class=wrap><table>
<tr><th>required</th><td>every part of the kind (and role) is asked the cup; an empty slot counts against the filled %</td></tr>
<tr><th>pending</th><td>asked only once a gate field is known (e.g. <code>module_slots</code> once <code>modular</code> is known); counted as a slot until the gate answers</td></tr>
<tr><th>optional</th><td>declared, rendered when present, never counted</td></tr><tr><th>not applicable</th><td>the kind cannot have it (a cable has no CPU)</td></tr>
<tr><th>filled</th><td>a current, non-seed fact under the cup</td></tr><tr><th>not published</th><td>every capable source was checked and does not print it</td></tr>
<tr><th>not parsed</th><td>a spec sheet for the part is linked and no fact is stored — extraction or mapping work</td></tr>
<tr><th>mapper gap</th><td>the linked sheets PRINT the cup and no mapper rule maps the label — a rule to write</td></tr>
<tr><th>not held</th><td>no spec sheet for the part is linked — acquisition work, outside the filled %</td></tr>
<tr><th>would refuse</th><td>a stored value today's normaliser refuses — a defect, neither filled nor empty</td></tr></table></div>
<h2>Decision record and spec</h2><ul>${decision ? `<li><a href="decision.md">decision record (docs/decisions/2026-09-13-kind-layer-cisco.md)</a></li>` : ""}${spec ? `<li><a href="spec-v2.md">kind-layer specification v2 (reviewer)</a></li>` : ""}<li><a href="data/report.json">completeness report JSON</a> · <a href="data/plans.json">plans JSON</a> · <a href="data/cup-evidence.json">printed-bar evidence JSON</a> · <a href="data/provenance.json">link provenance JSON</a> · <a href="arrangement.json">whole arrangement JSON</a></li></ul>`;
  write("index.html", page(`${vendor} arrangement`, "", body, "arrangement.json"));
}

// ---------------------------------------------------------------------------------------------------------- findings
{
  const body = `<h1>Findings — what is wrong or missing</h1><p>Each finding is a stated rule applied to this build's artifacts, with its denominator. "not in this build" means the input was absent, never zero.</p>` +
    findings.map((x) => `<h2 id="${x.id}">${sevTag(x.severity)} ${esc(x.title)}</h2><p class=muted>rule: ${esc(x.rule)}<br>count: ${x.count === null ? "not in this build" : x.count.toLocaleString("en-US")} · over ${esc(x.denominator)}</p>${tableOf(x.rows)}`).join("\n");
  write("findings.html", page(`${vendor} findings`, "", body, "findings.json"));
  write("findings.json", JSON.stringify({ vendor, commit, generated_at: generatedAt, findings }, null, 1));
}

// ------------------------------------------------------------------------------------------------------------- plans
{
  const rows = planRows.map((p) => ({ action: p.action, sku: p.sku, from: p.category, to: p.to, expected_kind_after: p.expected_kind_after ?? null, run_id: p.run_id, reason: p.reason ?? null, planned_by: p.planned_by ?? null }));
  const body = `<h1>Move and class plans</h1><p>${plans === null ? "No plans file in this build." : `${rows.length} plans: ${rows.filter((r) => r.action === "move").length} category moves, ${rows.filter((r) => r.action === "class").length} class changes; run: ${rows.filter((r) => r.run_id !== null).length}.`}</p>${tableOf(rows, undefined, 2000)}`;
  write("plans.html", page(`${vendor} plans`, "", body, "data/plans.json"));
}

// -------------------------------------------------------------------------------------------------------- provenance
{
  const s = provenance?.stats;
  const body = !provenance ? `<h1>Link provenance</h1><p class=warn>No derive-link-provenance report in this build.</p>` :
    `<h1>Link provenance</h1><p>How each document is linked to a part (<code>link_basis</code>: explicit = the SKU or base PID is on the page; family = family-scope records + model token in title/header + >= 3 kind-cup labels; inferred = neither) and whether it is a spec sheet for the part's kind (<code>doc_relevance</code>: spec_for_kind = spec-bearing and prints >= 3 distinct kind cups). Run ${esc(provenance.run_id ?? "(dry run)")}.</p>
<h2>Totals</h2>${tableOf([{ links: s.links, documents: s.documents, ...Object.fromEntries(Object.entries<number>(s.basis ?? {}).map(([k, v]) => [`basis ${k}`, v])), ...Object.fromEntries(Object.entries<number>(s.relevance ?? {}).map(([k, v]) => [`relevance ${k}`, v])) }])}
<h2>Held before / after relevance, per category (live hardware)</h2>${tableOf(provenance.held_by_category ?? [])}
<h2>Linking defects — documents whose links are inferred (top 200)</h2>${tableOf((provenance.linking_defects ?? []).slice(0, 200).map((d: AnyObj) => ({ links: d.links, doc_type: d.doc_type, title: d.title, url: d.url, why: d.evidence })))}`;
  write("provenance.html", page(`${vendor} link provenance`, "", body, "data/provenance.json"));
}

// -------------------------------------------------------------------------------------------------------- categories
const specSection = (cat: string): string | null => {
  if (!spec) return null;
  const lines = spec.split("\n");
  const start = lines.findIndex((l) => /^### II\.\d+/.test(l) && l.includes(` ${cat}`));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^#{2,3} /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join("\n");
};
const arrangement: AnyObj = { vendor, commit, generated_at: generatedAt, state, refused, failed_checks: failedChecks.map((c) => c.name), brand: report.brand, categories: [] };
for (const c of categories) {
  const cat = c.category as string;
  const l = ledgers.get(cat) ?? { kinds: {} };
  const ev = (evidence ?? []).filter((e) => e.category === cat);
  const evFor = (kind: string, role: string | null, cup: string) => ev.find((e) => e.kind === kind && e.role === role && e.cup === cup) ?? (role ? ev.find((e) => e.kind === kind && e.role === null && e.cup === cup) : undefined);
  const kindsJson: AnyObj[] = [];
  const kindRows = (c.kinds ?? []).map((k: AnyObj) => {
    const lk = (l.kinds ?? {})[k.kind] ?? {};
    return `<tr><td><a href="#k-${slug(k.kind)}">${esc(k.kind)}</a></td><td class=r>${n(k.parts)}</td><td>${esc(k.role_axis ?? (lk.role_axis ?? "—"))}</td>` +
      `<td class=r>${keysOf(lk.required).length}</td><td class=r>${keysOf(lk.pending_until_gate_answered).length}</td><td class=r>${keysOf(lk.not_applicable_by_kind).length}</td><td class=r>${keysOf(lk.optional).length}</td>` +
      `<td>${frac(k.held)}</td><td>${frac(k.filled)}</td><td class=r>${n(k.filled?.not_parsed)}</td><td class=r>${n(k.filled?.mapper_gap ?? null)}</td><td class=r>${n(k.filled?.not_held_parts)}</td>` +
      `<td>${k.resolved === false ? "<span class=warn>unresolved</span>" : "resolved"}</td></tr>`;
  }).join("");

  // cup matrix: every cup required or pending for any kind of the category
  const kindNames = (c.kinds ?? []).map((k: AnyObj) => k.kind as string);
  const asked = new Map<string, Map<string, string>>();
  for (const kn of kindNames) {
    const lk = (l.kinds ?? {})[kn] ?? {};
    for (const key of keysOf(lk.required)) (asked.get(key) ?? asked.set(key, new Map()).get(key)!).set(kn, "R");
    for (const key of keysOf(lk.pending_until_gate_answered)) (asked.get(key) ?? asked.set(key, new Map()).get(key)!).set(kn, "P");
  }
  const cupsSorted = [...asked.keys()].sort((a, b) => (asked.get(b)!.size - asked.get(a)!.size) || a.localeCompare(b));
  const matrix = `<div class=wrap><table><tr><th>cup \\ kind</th><th>type · unit</th>${kindNames.map((kn: string) => `<th>${esc(kn)}</th>`).join("")}</tr>` +
    cupsSorted.map((key) => `<tr><td><code>${esc(key)}</code></td><td class=muted>${dictLine(key)}</td>${kindNames.map((kn: string) => {
      const v = asked.get(key)!.get(kn);
      const lk = (l.kinds ?? {})[kn] ?? {};
      const na = keysOf(lk.not_applicable_by_kind).includes(key);
      return `<td>${v === "R" ? "<span class='tag t-req'>req</span>" : v === "P" ? "<span class='tag t-pend'>pend</span>" : na ? "<span class='tag t-na'>n/a</span>" : "<span class='tag t-opt'>opt</span>"}</td>`;
    }).join("")}</tr>`).join("") + "</table></div>";

  const kindSections = (c.kinds ?? []).map((k: AnyObj) => {
    const lk = (l.kinds ?? {})[k.kind] ?? {};
    const req = keysOf(lk.required), pend = (lk.pending_until_gate_answered ?? []) as AnyObj[], na = keysOf(lk.not_applicable_by_kind), op = keysOf(lk.optional);
    const roleBlocks = Object.entries<AnyObj>(lk.roles ?? {}).map(([role, r]) => {
      const rreq = keysOf(r.required);
      const added = rreq.filter((x) => !req.includes(x)), removed = req.filter((x) => !rreq.includes(x));
      const rep = (k.roles ?? {})[role] ?? {};
      return { role, parts: r.parts, kind_issue_rows: r.kind_issue_parts ?? r.parts_with_kind_issue ?? null, display: r.display ?? null, required: rreq.length, added_over_core: added, removed_from_core: removed,
        held: rep.held ? `${rep.held.num}/${rep.held.den} = ${rep.held.pct}%` : null, filled: rep.filled?.pct ?? null, not_parsed: rep.filled?.not_parsed ?? null };
    });
    const cupRows = (k.cups ?? []).map((cup: AnyObj) => {
      const e = evFor(k.kind, null, cup.key);
      return { cup: cup.key, requirement: cup.requirement, gate: (cup.gate ?? []).join(", ") || null, asked: cup.asked, held_asked: cup.held_asked, filled: cup.filled, not_published: cup.not_published,
        not_parsed: cup.not_parsed, mapper_gap: cup.mapper_gap ?? null, not_held: cup.not_held, would_refuse: cup.would_refuse, could_not_replay: cup.could_not_replay, inherited: cup.inherited,
        fill_path: cup.fill_path, printed_pct: e?.printed_pct ?? null, mapped_pct: e?.mapped_pct ?? null, evidence_state: e?.state ?? null };
    });
    const reqDetail = (Array.isArray(lk.required) ? lk.required : []).filter((x: unknown) => typeof x === "object").map((x: AnyObj) => ({
      cup: x.key, type_unit: ((FIELD_DICTIONARY as AnyObj)[x.key] ? [(FIELD_DICTIONARY as AnyObj)[x.key].type, (FIELD_DICTIONARY as AnyObj)[x.key].unit].filter(Boolean).join(" ") : "NOT IN DICTIONARY"),
      label_occurrences: x.label_occurrences ?? null, top_labels: (x.labels ?? []).slice(0, 4).map((y: AnyObj) => `${y.label} (${y.n})`).join(" · "),
      observed_filled: x.observed_filled ?? null, seed_only: x.seed_only ?? null, sources: (x.sources ?? []).filter((s: AnyObj) => s.enabled).map((s: AnyObj) => s.source).join(", ") }));
    kindsJson.push({ kind: k.kind, parts: k.parts, role_axis: k.role_axis ?? lk.role_axis ?? null, required: req, pending: pend.map((p) => ({ key: p.key ?? p, gate: p.gate ?? [] })), not_applicable: na, optional_count: op.length,
      held: k.held, filled: k.filled, document_evidence: lk.document_evidence ?? null, term13: lk.term13 ?? null, roles: roleBlocks, cups: cupRows, required_detail: reqDetail });
    return `<h3 id="k-${slug(k.kind)}">${esc(cat)} · ${esc(k.kind)} — ${n(k.parts)} parts${k.role_axis ? ` · role axis <code>${esc(k.role_axis)}</code>` : ""}</h3>
<p>held ${frac(k.held)} · filled ${frac(k.filled)} · document evidence ${esc(JSON.stringify(lk.document_evidence ?? null))} · granularity ${esc(JSON.stringify(lk.term13 ?? null))}</p>
<p><b>required (${req.length})</b>: ${req.map((x) => `<span class='tag t-req'>${esc(x)}</span>`).join(" ") || "<span class=bad>none</span>"}<br>
<b>pending (${pend.length})</b>: ${pend.map((p) => `<span class='tag t-pend'>${esc(p.key ?? p)}${p.gate?.length ? ` ⟵ ${esc(p.gate.join("+"))}` : ""}</span>`).join(" ") || "none"}<br>
<b>not applicable (${na.length})</b>: ${na.map((x) => `<span class='tag t-na'>${esc(x)}</span>`).join(" ") || "none"}</p>
<details><summary>optional (${op.length}) — declared, never counted</summary><p>${op.map((x) => `<code>${esc(x)}</code>`).join(" ")}</p></details>
${roleBlocks.length ? `<p><b>roles</b></p>${tableOf(roleBlocks)}` : ""}
<details open><summary>required cups: evidence (labels seen on sheets, sources, fill path)</summary>${tableOf(reqDetail)}</details>
<p><b>slot states per cup</b></p>${tableOf(cupRows)}`;
  }).join("\n");

  const po = plansOut(cat), pi = plansIn(cat);
  const section = specSection(cat);
  const body = `<h1>${esc(cat)}</h1>
<p>hardware parts ${n(c.hardware_parts)} · held ${frac(c.held)} · filled ${frac(c.filled)} · not parsed ${n(c.filled?.not_parsed)} · mapper gap ${n(c.filled?.mapper_gap ?? null)} · not held parts ${n(c.filled?.not_held_parts)} · unresolved kind ${n(c.unresolved_kind_parts ?? null)} · profile ${esc(c.profile_hash)} · ledger on ${esc(l.built_on_commit ?? "no ledger")}</p>
<h2>Layer 2 — kinds</h2><div class=wrap><table><tr><th>kind</th><th class=r>parts</th><th>role axis</th><th class=r>required</th><th class=r>pending</th><th class=r>n/a</th><th class=r>optional</th><th>held</th><th>filled</th><th class=r>not parsed</th><th class=r>mapper gap</th><th class=r>not held parts</th><th>kind</th></tr>${kindRows}</table></div>
<h2>Layer 4 — cup matrix (required / pending / optional / n/a per kind core)</h2>${matrix}
<h2>Each kind: question set, roles (layer 3), evidence, slot states</h2>${kindSections}
<h2>Plans touching ${esc(cat)}</h2><p>moves out ${po.filter((p) => p.action === "move").length} · moves in ${pi.length} · class changes ${po.filter((p) => p.action === "class").length}</p>
<details><summary>moves out</summary>${tableOf(po.filter((p) => p.action === "move").map((p) => ({ sku: p.sku, to: p.to, expected_kind_after: p.expected_kind_after, run_id: p.run_id, reason: p.reason })), undefined, 1000)}</details>
<details><summary>moves in</summary>${tableOf(pi.map((p) => ({ sku: p.sku, from: p.category, expected_kind_after: p.expected_kind_after, run_id: p.run_id, reason: p.reason })), undefined, 1000)}</details>
<details><summary>class changes</summary>${tableOf(po.filter((p) => p.action === "class").map((p) => ({ sku: p.sku, to_class: p.to, run_id: p.run_id, reason: p.reason })), undefined, 1000)}</details>
<h2>Printed-on-the-page measurement for ${esc(cat)}</h2>${evidence === null ? "<p class=warn>no evidence file in this build</p>" : ev.length ? tableOf(ev.map((e) => ({ kind: e.kind, role: e.role, cup: e.cup, state: e.state, printed_pct: e.printed_pct, mapped_pct: e.mapped_pct, held: e.held, variants: (e.variants ?? []).slice(0, 4).map((v: AnyObj) => `${v.label} (${v.parts})`).join(" · ") }))) : "<p class=warn>not measured yet — no cup of this category has been checked against the printed-on-the-page bar</p>"}
${section ? `<h2>Spec v2 for ${esc(cat)} (verbatim)</h2><pre>${esc(section)}</pre>` : ""}`;
  write(`categories/${slug(cat)}.html`, page(`${vendor} ${cat}`, "categories/", body, `${slug(cat)}.json`));
  const catJson = { vendor, commit, generated_at: generatedAt, category: cat, hardware_parts: c.hardware_parts, held: c.held, filled: c.filled, unresolved_kind_parts: c.unresolved_kind_parts ?? null,
    kinds: kindsJson, plans_out: po, plans_in: pi, evidence: ev, spec_v2_section: section };
  write(`categories/${slug(cat)}.json`, JSON.stringify(catJson, null, 1));
  arrangement.categories.push({ category: cat, hardware_parts: c.hardware_parts, held: c.held, filled: c.filled, kinds: kindsJson.map((k) => ({ kind: k.kind, parts: k.parts, role_axis: k.role_axis, required: k.required, pending: k.pending, not_applicable: k.not_applicable, optional_count: k.optional_count, roles: k.roles.map((r: AnyObj) => ({ role: r.role, parts: r.parts, required: r.required, added_over_core: r.added_over_core, removed_from_core: r.removed_from_core })) })), url: `categories/${slug(cat)}.html`, json: `categories/${slug(cat)}.json` });
}
arrangement.findings = findings.map((x) => ({ id: x.id, severity: x.severity, title: x.title, count: x.count, denominator: x.denominator }));
write("arrangement.json", JSON.stringify(arrangement, null, 1));

// ------------------------------------------------------------------------------------------------------- raw data + readme
write("data/report.json", JSON.stringify(report));
write("data/plans.json", JSON.stringify(plans ?? null));
write("data/cup-evidence.json", JSON.stringify(evidence ?? null));
write("data/provenance.json", JSON.stringify(provenance ?? null));
for (const [cat, l] of ledgers) write(`data/ledgers/${slug(cat)}.json`, JSON.stringify(l));
if (spec) write("spec-v2.md", spec);
if (questions) { write("questions.md", questions); write("questions.html", page(`${vendor} open questions`, "", `<pre>${esc(questions)}</pre>`, null)); }
if (decision) write("decision.md", decision);
write("README.txt", `netzspec arrangement site — ${vendor}
Generated ${generatedAt} from commit ${commit} (state: ${state}${refused || failedChecks.length ? `; report build failed ${failedChecks.length} cross-check(s): ${failedChecks.map((c) => c.name).join(", ")}` : ""}).

What this is: phase 1 ("arranging cups") of the ${vendor} catalogue — how every hardware part is arranged BEFORE values are filled.
  layer 1 category  (the table a part sits in)
  layer 2 kind      (derived from the SKU by code)
  layer 3 role      (deploy_role, only where a kind is too coarse)
  layer 4 cups      (required / pending / optional / not applicable per kind and role)
and per cup the state of every slot: filled, not published, not parsed, mapper gap, not held, would refuse.

Pages (HTML, no JavaScript needed):
  questions.html / questions.md  OPEN QUESTIONS for the reviewer, each with its measurement (read first)
  index.html                     brand numbers, categories, findings summary
  findings.html                  every rule-detected problem with its rows and denominators
  categories/<category>.html     kinds, cup matrix, each kind's question set, roles, evidence, slot states, plans, spec v2 section
  plans.html                     the planned category moves and class changes (run or not)
  provenance.html                how documents are linked to parts; held before/after relevance; linking defects
  decision.md, spec-v2.md        the decision record and the reviewer's kind-layer specification

Machine-readable:
  arrangement.json               the whole arrangement (categories -> kinds -> question sets -> roles) + findings summary
  findings.json                  findings with rows
  categories/<category>.json     one category in full
  data/report.json               the completeness report as built
  data/ledgers/<category>.json   the cup ledgers as built
  data/plans.json, data/cup-evidence.json, data/provenance.json

Categories: ${categories.map((c) => c.category).join(", ")}
No fact values and no API keys are published here.
`);
console.log(`arrangement site -> ${outDir}: ${categories.length} categories, ${findings.length} findings (${findings.filter((f) => f.severity === "bad").length} bad), report on ${commit}${failedChecks.length ? `, ${failedChecks.length} failed checks` : ""}`);
