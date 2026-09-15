// scripts/build-layers.mts — layers 2 (product line) and 3 (series) per category, from the live store and the mapping files
// in data/reference/product-lines/ (src/core/productLine.ts). Read-only against the store.
//
//   npx tsx scripts/build-layers.mts --vendor cisco --category switches --dump      what the category holds today (read first)
//   npx tsx scripts/build-layers.mts --vendor cisco --category switches             place every part, write the tree
//   npx tsx scripts/build-layers.mts --vendor cisco --all --site DIR                every category + the dashboard pages
//
// Writes data/layers/<vendor>-<category>.json: lines -> series -> parts (by part type), the rows placed as NOT THIS CATEGORY
// with their reason, and the UNPLACED rows. A category is DONE when a mapping file exists and unplaced = 0.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { partKind } from "../src/core/partKind.js";
import { deployRoleResult } from "../src/core/deployRole.js";
import { lineFilePath, loadLineFile, placeWithSpareRule, familyOf, SHARED_PARTS, type Placement } from "../src/core/productLine.js";
import { labelEvidence, type LabelEvidence } from "../src/core/labelEvidence.js";

// layer 3 of a line-level shared-parts row (operator, 14 Sep 2026): explicit, never blank — the part fits several families of the
// line or none of them. A family-scoped shared series ("Catalyst 9000 shared parts") carries its family instead.
const SHARED_ACROSS_LINE = "(shared across the line)";
/** page order inside a line: the Cisco families first (alphabetical, series in mapping order within), then series with no family, then shared parts */
const famRank = (f: string | null): number => (f === SHARED_ACROSS_LINE ? 2 : f ? 0 : 1);
import { closePool, query } from "../src/store/db.js";
import { execFileSync } from "node:child_process";

// layers review (14 Sep 2026): every page names the commit its rules came from, and the rule files that were NOT committed when it
// was built — "built from HEAD" is only true when that list is empty (CLAUDE.md: a deploy that syncs a working tree ships
// uncommitted code). Could-not-read git is recorded as such, never as a clean tree.
function buildProvenance(): { commit: string | null; uncommitted_rule_files: string[] | null } {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "scripts", "data/reference"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
    return { commit, uncommitted_rule_files: dirty };
  } catch { return { commit: null, uncommitted_rule_files: null }; }
}
const PROVENANCE = buildProvenance();

const arg = (k: string): string | null => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const vendor = arg("--vendor") ?? "cisco";
const one = arg("--category");
const all = process.argv.includes("--all");
const dump = process.argv.includes("--dump");
const siteDir = arg("--site");
if (!one && !all) throw new Error("--category <slug> or --all");

type Row = { id: number; sku: string; name: string | null; series: string | null; category: string };
const rows = (await query<Row>(`SELECT p.id, p.sku, p.name, p.series, c.slug AS category FROM parts p JOIN vendors v ON v.id = p.vendor_id
  JOIN categories c ON c.id = p.category_id WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware' ORDER BY p.sku`, [vendor])).rows;
// the label check reads compatible relations (a part linked to parts placed by SKU or name in the series evidences that series)
const compatible = (await query<{ a: number; b: number }>(`SELECT from_part_id AS a, to_part_id AS b FROM relations WHERE kind = 'compatible' AND to_part_id IS NOT NULL`)).rows;
await closePool();
const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) => rows.filter((r) => r.category === b).length - rows.filter((r) => r.category === a).length);

if (dump) {
  const cat = one!;
  const mine = rows.filter((r) => r.category === cat);
  const by = new Map<string, Row[]>();
  for (const r of mine) by.set(r.series ?? "(null)", [...(by.get(r.series ?? "(null)") ?? []), r]);
  console.log(`${cat}: ${mine.length} parts, ${by.size} series labels`);
  for (const [s, rs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
    const kinds = new Map<string, number>();
    for (const r of rs) { const k = partKind(cat, r.sku, r.name ?? undefined) ?? "(none)"; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
    console.log(`\n## ${s} — ${rs.length} parts — ${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    const step = Math.max(1, Math.floor(rs.length / 8));
    for (let i = 0; i < rs.length && i < step * 8; i += step) console.log(`   ${rs[i].sku.padEnd(26)} ${String(rs[i].name ?? "").slice(0, 80)}`);
  }
  process.exit(0);
}

// the committed move / class plans (data/reference/kind-layer-plans-2026-09-13.json): planned rows are not layered here
type Plan = { sku: string; category: string; action: string; to: string; reason?: string | null; run_id?: number | string | null };
const planFile = path.join(REPO_ROOT, "data", "reference", "kind-layer-plans-2026-09-13.json");
const allPlans: Plan[] = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, "utf8")) as Plan[] : [];
const planOf = new Map<string, Plan>(allPlans.map((x) => [`${x.category}|${x.sku.trim().toUpperCase()}`, x]));
// closing items at aa1143f, item 1: a DEVICE never sits in shared parts — a device the label evidence does not support is held for review.
// The set is the standing check's own (src/core/layerChecks.ts), so the build and the check cannot disagree on what a device is.
import { DEVICE_KINDS } from "../src/core/layerChecks.js";

/** pending_in (closing items at aa1143f, item 2): rows other categories plan to move INTO this category that this mapping places in the
 *  series, by source category — so a placeholder series (0 parts today) says what it is waiting for, in the JSON and on the page */
type SeriesNode = { series: string; family: string | null; role: string | null; note: string | null; parts: number; kinds: Record<string, number>; roles: Record<string, number>; samples: string[]; rules: Record<string, number>; pending_in: Record<string, number> };
type Tree = {
  vendor: string; category: string; built_at: string; commit: string | null; uncommitted_rule_files: string[] | null; mapping_file: string | null; parts: number;
  lines: { line: string; parts: number; series: SeriesNode[] }[];
  not_this_category: { sku: string; name: string | null; series_label: string | null; why: string; belongs: string | null }[];
  /** rows the committed kind-layer plans move to another category or re-class (not a product / licence): shown, not layered */
  pending_plans: { sku: string; name: string | null; series_label: string | null; action: string; to: string; reason: string | null }[];
  unplaced: { sku: string; name: string | null; series_label: string | null; kind: string }[];
  /** THE LABEL CHECK (re-audit at 2f3d17a, 14 Sep 2026), applied once a category's families are reviewed (family_layer
   *  "assigned"): a row a stored series label placed keeps its series only with a SKU token, a name, a family token or a
   *  compatible link to the series (src/core/labelEvidence.ts); otherwise it goes to its line's shared parts and is listed. */
  label_check: { applied: boolean; label_placed: number; by_kind: Record<string, number>; moved: { sku: string; name: string | null; series_label: string | null; from_series: string; to_series: string; why: string }[] };
  /** device kinds (router, sp-router, switch, fex, chassis, appliance) the label check would have sent to shared parts: held, not placed */
  pending_review: { sku: string; name: string | null; series_label: string | null; kind: string; from_series: string; why: string }[];
  /** rows planned INTO this category that its mapping would not place, by source category */
  inbound_unplaced: Record<string, number>;
  done: boolean;
  /** EVERY row (layers review 14 Sep 2026): what the page summarises, one record per live hardware part, so a mapping can be
   *  certified by row. bucket says which table the row is in; product_line/series are null outside "layered". */
  rows: LayerRow[];
};
type LayerRow = {
  sku: string; name: string | null; series_label: string | null; kind: string;
  bucket: "layered" | "not_this_category" | "pending_plan" | "pending_review" | "unplaced";
  product_line: string | null; product_family: string | null; series: string | null; placed_by: string | null;
  deploy_role: string | null; role_rule: string | null; role_issue: string | null;
  plan: { action: string; to: string; reason: string | null } | null;
  belongs: string | null;
  /** label-placed rows of a label-checked category: "<kind>: <detail>" (sku-token / name / family / compatible / none) */
  label_evidence: string | null;
};

/** Series each part is placed in by a SKU or name rule (not a label, not shared parts), then the series its compatible partners sit in. */
function compatibleSeries(mine: readonly Row[], placed: Map<string, Placement | null>): Map<number, Set<string>> {
  const seriesOfId = new Map<number, string>();
  for (const r of mine) {
    const p = placed.get(r.sku);
    if (p && p.line !== "(not this category)" && !p.rule.startsWith("label") && !p.rule.startsWith("accessory") && !/shared parts$/.test(p.series)) seriesOfId.set(r.id, p.series);
  }
  const out = new Map<number, Set<string>>();
  for (const { a, b } of compatible) for (const [x, y] of [[a, b], [b, a]]) {
    const s = seriesOfId.get(y);
    if (s) { if (!out.has(x)) out.set(x, new Set()); out.get(x)!.add(s); }
  }
  return out;
}

function build(cat: string): Tree {
  const mine = rows.filter((r) => r.category === cat);
  const loaded = loadLineFile(vendor, cat);
  const lines = new Map<string, Map<string, SeriesNode>>();
  const tree: Tree = { vendor, category: cat, built_at: new Date().toISOString(), commit: PROVENANCE.commit, uncommitted_rule_files: PROVENANCE.uncommitted_rule_files, mapping_file: loaded ? path.relative(REPO_ROOT, lineFilePath(vendor, cat)).replace(/\\/g, "/") : null,
    parts: mine.length, lines: [], not_this_category: [], pending_plans: [], unplaced: [], label_check: { applied: false, label_placed: 0, by_kind: {}, moved: [] }, pending_review: [], inbound_unplaced: {}, done: false, rows: [] };
  // lines appear in the mapping file's order, series too (a reader's order, not a count order)
  if (loaded) for (const l of loaded.file.lines) { const m = new Map<string, SeriesNode>(); for (const s of l.series) m.set(s.series, { series: s.series, family: s.series === SHARED_PARTS(l.line) ? SHARED_ACROSS_LINE : s.family?.trim() || null, role: s.role ?? null, note: s.note ?? null, parts: 0, kinds: {}, roles: {}, samples: [], rules: {}, pending_in: {} }); lines.set(l.line, m); }
  // the spare rule (review A.1): X and X= share one placement, the better-evidenced member's
  const placed = placeWithSpareRule(vendor, cat, mine, loaded);
  // the label check, once the category's families are reviewed; planned rows are not layered, so not judged
  const evidence = new Map<string, LabelEvidence>();
  if (loaded?.file.family_layer === "assigned") {
    tree.label_check.applied = true;
    const partners = compatibleSeries(mine, placed);
    for (const r of mine) {
      const p = placed.get(r.sku);
      if (!p || p.line === "(not this category)" || !p.rule.startsWith("label") || planOf.has(`${cat}|${r.sku.trim().toUpperCase()}`)) continue;
      // layers round 3, pre-ruling C1: a stored label the mapping sends DIRECTLY to a shared-parts series claims no series, so
      // there is no placement to test (it used to be "moved" from shared parts to the same shared parts). The standing check
      // asserts the label is listed on that shared-parts series in the file.
      if (p.series === SHARED_PARTS(p.line)) continue;
      const ln = loaded.file.lines.find((l) => l.line === p.line)!;
      evidence.set(r.sku, labelEvidence(r, p.series, { family: familyOf(loaded, p.series), siblings: ln.series.map((s) => ({ series: s.series, family: s.family?.trim() || null })) }, partners.get(r.id)));
    }
    // the spare rule holds here too: X and X= share one placement, so a pair keeps its series when EITHER member is evidenced
    const byBase = new Map<string, string[]>();
    for (const sku of evidence.keys()) { const k = sku.toUpperCase().trim().replace(/=+$/, ""); byBase.set(k, [...(byBase.get(k) ?? []), sku]); }
    for (const members of byBase.values()) {
      const good = members.find((m) => evidence.get(m)!.kind !== "none");
      if (!good) continue;
      for (const m of members) if (evidence.get(m)!.kind === "none") evidence.set(m, { kind: evidence.get(good)!.kind, detail: `twin ${good}: ${evidence.get(good)!.detail}` });
    }
    for (const ev of evidence.values()) tree.label_check.by_kind[ev.kind] = (tree.label_check.by_kind[ev.kind] ?? 0) + 1;
    tree.label_check.label_placed = evidence.size;
  }
  for (const r of mine) {
    const kind = partKind(cat, r.sku, r.name ?? undefined) ?? "(none)";
    const plan = planOf.get(`${cat}|${r.sku.trim().toUpperCase()}`);
    // the role the CUP ENGINE gives this part (deployRoleResult, which reads the series table first) — recorded on every row
    const rr = deployRoleResult(cat, kind, r.sku, r.name);
    const ev = evidence.get(r.sku);
    const base = { sku: r.sku, name: r.name, series_label: r.series, kind, deploy_role: rr.role, role_rule: rr.rule, role_issue: rr.issue, label_evidence: ev ? `${ev.kind}: ${ev.detail}` : null };
    if (plan) {
      tree.pending_plans.push({ sku: r.sku, name: r.name, series_label: r.series, action: plan.action, to: plan.to, reason: plan.reason ?? null });
      tree.rows.push({ ...base, bucket: "pending_plan", product_line: null, product_family: null, series: null, placed_by: null, plan: { action: plan.action, to: plan.to, reason: plan.reason ?? null }, belongs: null });
      continue;
    }
    let p = placed.get(r.sku) ?? null;
    if (p && p.line !== "(not this category)" && ev?.kind === "none" && DEVICE_KINDS.has(kind)) {
      // a device is never a shared part: held for review with the reason, not placed
      tree.pending_review.push({ sku: r.sku, name: r.name, series_label: r.series, kind, from_series: p.series, why: ev.detail });
      tree.rows.push({ ...base, bucket: "pending_review", product_line: null, product_family: null, series: null, placed_by: `label-unsupported device (${p.rule}; was ${p.series}): ${ev.detail}`, plan: null, belongs: null });
      continue;
    }
    if (p && p.line !== "(not this category)" && ev?.kind === "none") {
      // a label with nothing behind it: the line's shared parts, never silently the series
      tree.label_check.moved.push({ sku: r.sku, name: r.name, series_label: r.series, from_series: p.series, to_series: SHARED_PARTS(p.line), why: ev.detail });
      p = { line: p.line, series: SHARED_PARTS(p.line), rule: `label-unsupported (${p.rule}; was ${p.series}): ${ev.detail}`, role: null };
    }
    if (!p) { tree.unplaced.push({ sku: r.sku, name: r.name, series_label: r.series, kind }); tree.rows.push({ ...base, bucket: "unplaced", product_line: null, product_family: null, series: null, placed_by: null, plan: null, belongs: null }); continue; }
    if (p.line === "(not this category)") {
      const why = (p as { why: string }).why, belongs = (p as { belongs: string | null }).belongs;
      tree.not_this_category.push({ sku: r.sku, name: r.name, series_label: r.series, why, belongs });
      tree.rows.push({ ...base, bucket: "not_this_category", product_line: null, product_family: null, series: null, placed_by: p.rule, plan: null, belongs });
      continue;
    }
    tree.rows.push({ ...base, bucket: "layered", product_line: p.line, product_family: p.series === SHARED_PARTS(p.line) ? SHARED_ACROSS_LINE : familyOf(loaded, p.series), series: p.series, placed_by: p.rule, plan: null, belongs: null });
    const lm = lines.get(p.line)!;
    if (!lm.has(p.series)) lm.set(p.series, { series: p.series, family: p.series === SHARED_PARTS(p.line) ? SHARED_ACROSS_LINE : null, role: null, note: null, parts: 0, kinds: {}, roles: {}, samples: [], rules: {}, pending_in: {} }); // "<line> shared parts"
    const node = lm.get(p.series)!;
    node.parts++;
    const role = rr.role;
    if (role !== null) node.roles[role] = (node.roles[role] ?? 0) + 1;
    else if (rr.issue) node.roles["(kind issue)"] = (node.roles["(kind issue)"] ?? 0) + 1;
    node.kinds[kind] = (node.kinds[kind] ?? 0) + 1;
    const ruleKind = p.rule.split(" ")[0];
    node.rules[ruleKind] = (node.rules[ruleKind] ?? 0) + 1;
    if (node.samples.length < 6) node.samples.push(`${r.sku} — ${String(r.name ?? "").slice(0, 60)}`);
  }
  // what other categories plan to move in, placed by THIS mapping: counted on the series it would land in
  if (loaded) {
    const inbound = allPlans.filter((x) => x.action === "move" && x.to === cat && x.category !== cat && (x.run_id ?? null) === null);
    const fromOf = new Map(inbound.map((x) => [`${x.category}|${x.sku.trim().toUpperCase()}`, x.category]));
    const inRows = rows.filter((r) => r.category !== cat && fromOf.has(`${r.category}|${r.sku.trim().toUpperCase()}`));
    const inPlaced = placeWithSpareRule(vendor, cat, inRows, loaded);
    for (const r of inRows) {
      const from = fromOf.get(`${r.category}|${r.sku.trim().toUpperCase()}`)!, q = inPlaced.get(r.sku) ?? null;
      if (!q || q.line === "(not this category)") { tree.inbound_unplaced[from] = (tree.inbound_unplaced[from] ?? 0) + 1; continue; }
      const lm = lines.get(q.line)!;
      if (!lm.has(q.series)) lm.set(q.series, { series: q.series, family: q.series === SHARED_PARTS(q.line) ? SHARED_ACROSS_LINE : null, role: null, note: null, parts: 0, kinds: {}, roles: {}, samples: [], rules: {}, pending_in: {} });
      const node = lm.get(q.series)!;
      node.pending_in[from] = (node.pending_in[from] ?? 0) + 1;
    }
  }
  for (const [line, m] of lines) {
    const series = [...m.values()];
    tree.lines.push({ line, parts: series.reduce((a, s) => a + s.parts, 0), series });
  }
  tree.done = loaded !== null && tree.unplaced.length === 0 && tree.pending_review.length === 0;
  return tree;
}

const esc = (x: unknown) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CSS = `body{background:#0d1117;color:#e6edf3;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:0;padding:18px 22px 60px}a{color:#58a6ff}
h1{font-size:20px}h2{font-size:16px;margin:26px 0 6px;border-bottom:1px solid #30363d}table{border-collapse:collapse;margin:6px 0 14px;font-size:12.5px}
th,td{border:1px solid #30363d;padding:3px 8px;text-align:left;vertical-align:top}th{background:#161b22}td.r{text-align:right}.m{color:#8b949e}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.banner{padding:10px 12px;border-radius:6px;margin:10px 0}.b-ok{background:#0f2d17;color:#7ee787}.b-bad{background:#3d0d0d;color:#ff8a80}`;
const pageHtml = (title: string, body: string) => `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=robots content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;

function categoryPage(t: Tree): string {
  const status = !t.mapping_file ? `<div class="banner b-bad"><b>NOT STARTED</b> — no mapping file yet.</div>`
    : t.done ? `<div class="banner b-ok"><b>DONE</b> — every one of ${t.parts.toLocaleString("en-US")} parts has a product line and a series (${t.not_this_category.length} listed as not belonging to this category).</div>`
      : `<div class="banner b-bad"><b>IN PROGRESS</b> — ${t.unplaced.length} of ${t.parts} parts not placed yet.</div>`;
  let body = `<p><a href="index.html">all categories</a></p><h1>${esc(t.vendor)} · ${esc(t.category)} — layer 2 product lines, layer 3 families (where Cisco names one), layer 4 series</h1>${status}
<p class=m>Built ${esc(t.built_at)} from the live store at commit ${t.commit ? esc(t.commit.slice(0, 10)) : "<span class=bad>unknown (git not readable)</span>"}${t.uncommitted_rule_files === null ? "" : t.uncommitted_rule_files.length ? ` <span class=bad>plus ${t.uncommitted_rule_files.length} uncommitted rule file(s): ${esc(t.uncommitted_rule_files.join(", "))}</span>` : " (rule files clean)"} · mapping ${esc(t.mapping_file ?? "none")} · part type (switch / power / linecard…) shown beside each series, unchanged · <a href="${esc(t.category)}.json">every row as JSON</a> (${t.rows.length.toLocaleString("en-US")} rows).</p>`;
  const roleTotals = (l: Tree["lines"][number]) => { const m: Record<string, number> = {}; for (const s of l.series) for (const [r, n] of Object.entries(s.roles)) m[r] = (m[r] ?? 0) + n; return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${esc(r)} ${n}`).join(", ") || "<span class=m>—</span>"; };
  body += `<h2>Summary</h2><table><tr><th>layer 2 — product line</th><th>layer 3 — families</th><th>layer 4 — series</th><th>parts</th><th>deploy_role totals (parts whose type carries a role)</th></tr>` +
    t.lines.map((l) => `<tr><td><b>${esc(l.line)}</b></td><td>${[...new Set(l.series.map((s) => s.family).filter((x) => x && x !== SHARED_ACROSS_LINE))].map((f) => esc(f!)).join(", ") || "<span class=m>— (Cisco names none)</span>"}</td><td>${l.series.length} series</td><td class=r>${l.parts.toLocaleString("en-US")}</td><td>${roleTotals(l)}</td></tr>`).join("") +
    `<tr><td class=warn>(not this category)</td><td>listed below with reasons</td><td class=r>${t.not_this_category.length}</td></tr>` +
    `<tr><td class=warn>(pending move / class change)</td><td>planned, listed below</td><td class=r>${t.pending_plans.length}</td></tr>` +
    `<tr><td class=bad>(pending review — devices the label does not support)</td><td>listed below</td><td class=r>${t.pending_review.length}</td></tr>` +
    `<tr><td class=bad>(unplaced)</td><td></td><td class=r>${t.unplaced.length}</td></tr></table>`;
  for (const l of t.lines) {
    body += `<h2>${esc(l.line)} — ${l.parts.toLocaleString("en-US")} parts</h2><p class=m>deploy_role totals: ${roleTotals(l)}</p><table><tr><th>family</th><th>series</th><th>deploy_role (series table)</th><th>parts</th><th>part types</th><th>role as the cup engine assigns it</th><th>examples</th></tr>` +
      [...l.series].sort((a, b) => (famRank(a.family) - famRank(b.family)) || (a.family ?? "").localeCompare(b.family ?? "")).map((s) => `<tr><td>${s.family ? esc(s.family) : "<span class=m>—</span>"}</td><td><b>${esc(s.series)}</b>${s.note ? `<br><span class=warn>${esc(s.note)}</span>` : ""}${Object.entries(s.pending_in).map(([from, n]) => `<br><span class=warn>pending ${n} from ${esc(from)}</span>`).join("")}</td><td>${s.role ? esc(s.role) : "<span class=m>none (no role)</span>"}</td><td class=r>${s.parts}</td><td>${Object.entries(s.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} ${n}`).join(", ")}</td><td>${Object.entries(s.roles).map(([r, n]) => `${esc(r)} ${n}`).join(", ") || "<span class=m>—</span>"}</td><td class=m>${s.samples.map(esc).join("<br>")}</td></tr>`).join("") + `</table>`;
  }
  if (t.pending_review.length) body += `<h2 class=bad>Pending review — ${t.pending_review.length} devices</h2><p class=m>A router, switch, FEX, chassis or appliance whose stored label the evidence does not support: a device is never a shared part, so it waits here for a SKU rule or a decision.</p><table><tr><th>SKU</th><th>name</th><th>kind</th><th>label said</th><th>why</th></tr>` +
    t.pending_review.map((x) => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${esc(x.kind)}</td><td>${esc(x.from_series)}</td><td class=m>${esc(x.why)}</td></tr>`).join("") + `</table>`;
  if (Object.keys(t.inbound_unplaced).length) body += `<p class=warn>Planned to move INTO this category but not placed by its mapping yet: ${Object.entries(t.inbound_unplaced).map(([f, n]) => `${n} from ${esc(f)}`).join(", ")}.</p>`;
  if (t.label_check.applied) {
    const kept = t.label_check.label_placed - t.label_check.moved.length;
    body += `<h2 class=warn>Label check — ${t.label_check.label_placed} rows placed only by a stored series label: ${kept} evidenced, ${t.label_check.moved.length} moved to shared parts</h2>
<p class=m>A label is whatever an enumeration typed into the series column. A label-placed row keeps its series only when its SKU carries the series' platform token, its name names the series (or a platform number, alias or distinctive word of it), it carries its family's token, or a compatible relation links it to a part the SKU or name rules placed in that series, and when nothing names another series of the line as specifically. By kind: ${Object.entries(t.label_check.by_kind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} ${n}`).join(", ") || "—"} (pairs X / X= share one verdict).</p>` +
      (t.label_check.moved.length ? `<table><tr><th>SKU</th><th>name</th><th>label said</th><th>now</th><th>why</th></tr>` +
        t.label_check.moved.map((x) => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${esc(x.from_series)}</td><td>${esc(x.to_series)}</td><td class=m>${esc(x.why)}</td></tr>`).join("") + `</table>` : "");
  }
  if (t.not_this_category.length) body += `<h2 class=warn>Not this category — ${t.not_this_category.length}</h2><table><tr><th>SKU</th><th>name</th><th>why</th><th>belongs</th></tr>` +
    t.not_this_category.map((x) => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${esc(x.why)}</td><td>${esc(x.belongs ?? "")}</td></tr>`).join("") + `</table>`;
  if (t.pending_plans.length) body += `<h2 class=warn>Pending move or class change — ${t.pending_plans.length}</h2><p class=m>Rows the committed plans move to another category or re-class (datasheet cells, licences, parts of another product family). They leave this category when the plans run.</p><table><tr><th>SKU</th><th>name</th><th>plan</th><th>reason</th></tr>` +
    t.pending_plans.map((x) => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${esc(x.action === "move" ? "move to " + x.to : "class -> " + x.to)}</td><td>${esc(x.reason ?? "")}</td></tr>`).join("") + `</table>`;
  if (t.unplaced.length) body += `<h2 class=bad>Unplaced — ${t.unplaced.length}</h2><table><tr><th>SKU</th><th>name</th><th>series label today</th><th>part type</th></tr>` +
    t.unplaced.slice(0, 500).map((x) => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${esc(x.series_label)}</td><td>${esc(x.kind)}</td></tr>`).join("") + `</table>`;
  body += `<p class=m><a href="${esc(t.category)}.json">this page as JSON — every row (${t.rows.length.toLocaleString("en-US")}): sku, name, kind, product_line, series, deploy_role, plan</a></p>`;
  return pageHtml(`${t.vendor} ${t.category} layers`, body);
}

const targets = all ? categories : [one!];
const trees: Tree[] = [];
fs.mkdirSync(path.join(REPO_ROOT, "data", "layers"), { recursive: true });
for (const cat of targets) {
  const t = build(cat);
  trees.push(t);
  if (t.mapping_file) {
    // the tree without its rows (the summary a diff can read), and the rows as one TSV line each (sorted by SKU, so a
    // mapping change shows as the rows it moved); the published <category>.json carries both
    const { rows: tRows, ...summary } = t;
    fs.writeFileSync(path.join(REPO_ROOT, "data", "layers", `${vendor}-${cat}.json`), JSON.stringify(summary, null, 1) + "\n");
    const cell = (x: unknown) => String(x ?? "").replace(/[\t\r\n]+/g, " ");
    const head = ["sku", "name", "series_label", "kind", "bucket", "product_line", "product_family", "series", "placed_by", "deploy_role", "role_rule", "role_issue", "plan", "belongs", "label_evidence"];
    const lines = tRows.map((r) => [r.sku, r.name, r.series_label, r.kind, r.bucket, r.product_line, r.product_family, r.series, r.placed_by, r.deploy_role, r.role_rule, r.role_issue,
      r.plan ? `${r.plan.action} ${r.plan.to}` : "", r.belongs, r.label_evidence].map(cell).join("\t"));
    fs.writeFileSync(path.join(REPO_ROOT, "data", "layers", `${vendor}-${cat}.rows.tsv`), [head.join("\t"), ...lines].join("\n") + "\n");
  }
  console.log(`${cat.padEnd(30)} parts ${String(t.parts).padStart(5)}  lines ${String(t.lines.length).padStart(2)}  series ${String(t.lines.reduce((a, l) => a + l.series.length, 0)).padStart(3)}  not-this-category ${String(t.not_this_category.length).padStart(4)}  planned ${String(t.pending_plans.length).padStart(4)}  unplaced ${String(t.unplaced.length).padStart(5)}  ${t.pending_review.length ? `pending-review ${t.pending_review.length}  ` : ""}${t.label_check.applied ? `label-placed ${t.label_check.label_placed} moved ${t.label_check.moved.length} ${JSON.stringify(t.label_check.by_kind)}  ` : ""}${!t.mapping_file ? "NOT STARTED" : t.done ? "DONE" : "IN PROGRESS"}`);
  if (!all && t.unplaced.length) {
    const by = new Map<string, number>();
    for (const u of t.unplaced) by.set(u.series_label ?? "(null)", (by.get(u.series_label ?? "(null)") ?? 0) + 1);
    console.log("unplaced by series label:", [...by].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([s, n]) => `${s} ${n}`).join(" | "));
    for (const u of t.unplaced.slice(0, 30)) console.log(`   ${u.sku.padEnd(26)} [${u.series_label}] ${String(u.name ?? "").slice(0, 70)}`);
  }
}
if (siteDir) {
  const dir = path.join(siteDir, "layers");
  fs.mkdirSync(dir, { recursive: true });
  for (const t of trees) { fs.writeFileSync(path.join(dir, `${t.category}.html`), categoryPage(t)); fs.writeFileSync(path.join(dir, `${t.category}.json`), JSON.stringify(t, null, 1)); }
  if (all) {
    const done = trees.filter((t) => t.done).length;
    const idx = `<h1>${esc(vendor)} — category layers (product line → series)</h1><p>${done} of ${trees.length} categories done. Layer 2 = product line, layer 3 = series; the part type stays underneath.</p>
<table><tr><th>category</th><th>parts</th><th>product lines</th><th>series</th><th>not this category</th><th>unplaced</th><th>status</th></tr>` +
      trees.map((t) => `<tr><td><a href="${esc(t.category)}.html">${esc(t.category)}</a></td><td class=r>${t.parts.toLocaleString("en-US")}</td><td class=r>${t.lines.length}</td><td class=r>${t.lines.reduce((a, l) => a + l.series.length, 0)}</td><td class=r>${t.not_this_category.length}</td><td class=r>${t.mapping_file ? t.unplaced.length : "—"}</td><td class=${!t.mapping_file ? "m" : t.done ? "ok" : "bad"}>${!t.mapping_file ? "not started" : t.done ? "DONE" : "in progress"}</td></tr>`).join("") + `</table>`;
    fs.writeFileSync(path.join(dir, "index.html"), pageHtml(`${vendor} layers`, idx));
  }
  console.log(`site pages -> ${dir}`);
}
