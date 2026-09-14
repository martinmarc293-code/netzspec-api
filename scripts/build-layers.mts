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
import { lineFilePath, loadLineFile, placePart } from "../src/core/productLine.js";
import { closePool, query } from "../src/store/db.js";

const arg = (k: string): string | null => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const vendor = arg("--vendor") ?? "cisco";
const one = arg("--category");
const all = process.argv.includes("--all");
const dump = process.argv.includes("--dump");
const siteDir = arg("--site");
if (!one && !all) throw new Error("--category <slug> or --all");

type Row = { sku: string; name: string | null; series: string | null; category: string };
const rows = (await query<Row>(`SELECT p.sku, p.name, p.series, c.slug AS category FROM parts p JOIN vendors v ON v.id = p.vendor_id
  JOIN categories c ON c.id = p.category_id WHERE v.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware' ORDER BY p.sku`, [vendor])).rows;
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
type Plan = { sku: string; category: string; action: string; to: string; reason?: string | null };
const planFile = path.join(REPO_ROOT, "data", "reference", "kind-layer-plans-2026-09-13.json");
const planOf = new Map<string, Plan>((fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, "utf8")) as Plan[] : []).map((x) => [`${x.category}|${x.sku.trim().toUpperCase()}`, x]));

type SeriesNode = { series: string; parts: number; kinds: Record<string, number>; samples: string[]; rules: Record<string, number> };
type Tree = {
  vendor: string; category: string; built_at: string; mapping_file: string | null; parts: number;
  lines: { line: string; parts: number; series: SeriesNode[] }[];
  not_this_category: { sku: string; name: string | null; series_label: string | null; why: string; belongs: string | null }[];
  /** rows the committed kind-layer plans move to another category or re-class (not a product / licence): shown, not layered */
  pending_plans: { sku: string; name: string | null; series_label: string | null; action: string; to: string; reason: string | null }[];
  unplaced: { sku: string; name: string | null; series_label: string | null; kind: string }[];
  done: boolean;
};

function build(cat: string): Tree {
  const mine = rows.filter((r) => r.category === cat);
  const loaded = loadLineFile(vendor, cat);
  const lines = new Map<string, Map<string, SeriesNode>>();
  const tree: Tree = { vendor, category: cat, built_at: new Date().toISOString(), mapping_file: loaded ? path.relative(REPO_ROOT, lineFilePath(vendor, cat)).replace(/\\/g, "/") : null,
    parts: mine.length, lines: [], not_this_category: [], pending_plans: [], unplaced: [], done: false };
  // lines appear in the mapping file's order, series too (a reader's order, not a count order)
  if (loaded) for (const l of loaded.file.lines) { const m = new Map<string, SeriesNode>(); for (const s of l.series) m.set(s.series, { series: s.series, parts: 0, kinds: {}, samples: [], rules: {} }); lines.set(l.line, m); }
  for (const r of mine) {
    const kind = partKind(cat, r.sku, r.name ?? undefined) ?? "(none)";
    const plan = planOf.get(`${cat}|${r.sku.trim().toUpperCase()}`);
    if (plan) { tree.pending_plans.push({ sku: r.sku, name: r.name, series_label: r.series, action: plan.action, to: plan.to, reason: plan.reason ?? null }); continue; }
    const p = placePart(vendor, cat, r, loaded);
    if (!p) { tree.unplaced.push({ sku: r.sku, name: r.name, series_label: r.series, kind }); continue; }
    if (p.line === "(not this category)") { tree.not_this_category.push({ sku: r.sku, name: r.name, series_label: r.series, why: (p as { why: string }).why, belongs: (p as { belongs: string | null }).belongs }); continue; }
    const node = lines.get(p.line)!.get(p.series)!;
    node.parts++;
    node.kinds[kind] = (node.kinds[kind] ?? 0) + 1;
    const ruleKind = p.rule.split(" ")[0];
    node.rules[ruleKind] = (node.rules[ruleKind] ?? 0) + 1;
    if (node.samples.length < 6) node.samples.push(`${r.sku} — ${String(r.name ?? "").slice(0, 60)}`);
  }
  for (const [line, m] of lines) {
    const series = [...m.values()];
    tree.lines.push({ line, parts: series.reduce((a, s) => a + s.parts, 0), series });
  }
  tree.done = loaded !== null && tree.unplaced.length === 0;
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
  let body = `<p><a href="index.html">all categories</a></p><h1>${esc(t.vendor)} · ${esc(t.category)} — layer 2 product lines, layer 3 series</h1>${status}
<p class=m>Built ${esc(t.built_at)} from the live store · mapping ${esc(t.mapping_file ?? "none")} · part type (switch / power / linecard…) shown beside each series, unchanged.</p>`;
  body += `<h2>Summary</h2><table><tr><th>layer 2 — product line</th><th>layer 3 — series</th><th>parts</th></tr>` +
    t.lines.map((l) => `<tr><td><b>${esc(l.line)}</b></td><td>${l.series.length} series</td><td class=r>${l.parts.toLocaleString("en-US")}</td></tr>`).join("") +
    `<tr><td class=warn>(not this category)</td><td>listed below with reasons</td><td class=r>${t.not_this_category.length}</td></tr>` +
    `<tr><td class=warn>(pending move / class change)</td><td>planned, listed below</td><td class=r>${t.pending_plans.length}</td></tr>` +
    `<tr><td class=bad>(unplaced)</td><td></td><td class=r>${t.unplaced.length}</td></tr></table>`;
  for (const l of t.lines) {
    body += `<h2>${esc(l.line)} — ${l.parts.toLocaleString("en-US")} parts</h2><table><tr><th>series</th><th>parts</th><th>part types</th><th>examples</th></tr>` +
      l.series.map((s) => `<tr><td><b>${esc(s.series)}</b></td><td class=r>${s.parts}</td><td>${Object.entries(s.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} ${n}`).join(", ")}</td><td class=m>${s.samples.map(esc).join("<br>")}</td></tr>`).join("") + `</table>`;
  }
  if (t.not_this_category.length) body += `<h2 class=warn>Not this category — ${t.not_this_category.length}</h2><table><tr><th>SKU</th><th>name</th><th>why</th><th>belongs</th></tr>` +
    t.not_this_category.map((x) => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${esc(x.why)}</td><td>${esc(x.belongs ?? "")}</td></tr>`).join("") + `</table>`;
  if (t.pending_plans.length) body += `<h2 class=warn>Pending move or class change — ${t.pending_plans.length}</h2><p class=m>Rows the committed plans move to another category or re-class (datasheet cells, licences, parts of another product family). They leave this category when the plans run.</p><table><tr><th>SKU</th><th>name</th><th>plan</th><th>reason</th></tr>` +
    t.pending_plans.map((x) => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${esc(x.action === "move" ? "move to " + x.to : "class -> " + x.to)}</td><td>${esc(x.reason ?? "")}</td></tr>`).join("") + `</table>`;
  if (t.unplaced.length) body += `<h2 class=bad>Unplaced — ${t.unplaced.length}</h2><table><tr><th>SKU</th><th>name</th><th>series label today</th><th>part type</th></tr>` +
    t.unplaced.slice(0, 500).map((x) => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${esc(x.series_label)}</td><td>${esc(x.kind)}</td></tr>`).join("") + `</table>`;
  body += `<p class=m><a href="${esc(t.category)}.json">this page as JSON</a></p>`;
  return pageHtml(`${t.vendor} ${t.category} layers`, body);
}

const targets = all ? categories : [one!];
const trees: Tree[] = [];
fs.mkdirSync(path.join(REPO_ROOT, "data", "layers"), { recursive: true });
for (const cat of targets) {
  const t = build(cat);
  trees.push(t);
  if (t.mapping_file) fs.writeFileSync(path.join(REPO_ROOT, "data", "layers", `${vendor}-${cat}.json`), JSON.stringify(t, null, 1) + "\n");
  console.log(`${cat.padEnd(30)} parts ${String(t.parts).padStart(5)}  lines ${String(t.lines.length).padStart(2)}  series ${String(t.lines.reduce((a, l) => a + l.series.length, 0)).padStart(3)}  not-this-category ${String(t.not_this_category.length).padStart(4)}  planned ${String(t.pending_plans.length).padStart(4)}  unplaced ${String(t.unplaced.length).padStart(5)}  ${!t.mapping_file ? "NOT STARTED" : t.done ? "DONE" : "IN PROGRESS"}`);
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
