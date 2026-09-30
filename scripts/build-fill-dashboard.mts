// scripts/build-fill-dashboard.mts — the FILL DASHBOARD at https://api.netzspec.com/fill/<vendor>/ (reviewer spec + addendum,
// 30 Sep 2026; the owner: "I must notice if filling is wrong or slow").
//
//   npx tsx scripts/build-fill-dashboard.mts --vendor cisco --out <dir> [--fill /var/lib/netzspec-api/fill] [--record]
//
// Writes <out>/index.html (the brand page), <out>/<category>/index.html (product line -> family -> series, top blockers),
// <out>/<category>/parts/<slug>.html (every required cup of one part: its state, its source, and for a missing one WHY and
// which document would fill it), and the same numbers as JSON beside each page (fill.json). Server-rendered, no script.
//
// PUBLIC, SO NO VALUES. Like the arrangement site, these pages carry structure, counts, states and document links -- never a
// fact value and never a key. A part page links the key-gated /v1 record for its values.
//
// --record (the nightly passes it) appends tonight's snapshot to <fill>/history.jsonl, which is what the 30-night trend and
// the finish estimate read; a hand run never writes history, so the trend holds one point per night.
// The arithmetic (the five-segment bar, the roll-up, dashboard_sums, the status light) is src/core/fillDashboard.ts.
import fs from "node:fs";
import path from "node:path";
import { query, closePool } from "../src/store/db.js";
import { heldRowSql } from "../src/core/heldEvidence.js";
import { jtlReadiness } from "../src/api/queries/jtlExport.js";
import { rollUp, sumsOk, statusLight, etaDays, filledPct, partSeg, SEG_KEYS, type Node, type PartRow, type NightFacts, type Seg } from "../src/core/fillDashboard.js";

const arg = (k: string, d?: string): string | undefined => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const VENDOR = arg("--vendor", "cisco")!, OUT = arg("--out"), FILL = arg("--fill", "/var/lib/netzspec-api/fill")!;
const RECORD = process.argv.includes("--record");
if (!OUT) { console.error("usage: --vendor V --out DIR [--fill DIR] [--record]"); process.exit(2); }
const readJson = (f: string): any => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "none";
const today = new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------------------------------- the parts
type Row = PartRow & { id: string; slug: string; name_de: string; missing: string[]; required_fields: string[];
  pending_gates: { cup: string; gate: string[] }[] };
const rows = (await query<any>(`
  SELECT p.id::text, p.sku, p.slug, c2.slug AS category, coalesce(c2.name_de, c2.name_en, c2.slug) AS name_de,
         coalesce(p.product_line, '') AS product_line, coalesce(p.product_family, '') AS product_family,
         coalesce(p.product_series, p.series, '') AS series,
         c.required_total, c.required_present, coalesce(c.pending, 0) AS pending, c.missing, c.required_fields, c.pending_gates,
         EXISTS (SELECT 1 FROM doc_parts dp WHERE dp.part_id = p.id AND ${heldRowSql("dp")}) AS held
    FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN completeness c ON c.part_id = p.id
    JOIN categories c2 ON c2.id = p.category_id
   WHERE v.slug = $1 AND p.retired_at IS NULL AND NOT c.no_profile`, [VENDOR])).rows;
const inh = new Map((await query<{ part_id: string; n: string }>(`
  SELECT f.part_id::text, count(DISTINCT f.field_key)::text AS n FROM facts f JOIN completeness c ON c.part_id = f.part_id
    JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated')
     AND (f.inherited OR f.method LIKE 'derived:%') AND c.required_fields ? f.field_key GROUP BY 1`, [VENDOR])).rows.map((r) => [r.part_id, Number(r.n)]));

// readiness per SKU (the jtl-readiness export's own function): shop-ready, and every part's blockers
const reasons = new Map<string, string[]>();
const skus = rows.map((r) => r.sku);
for (let i = 0; i < skus.length; i += 2000) {
  const r = await jtlReadiness({ vendor: VENDOR, skus: skus.slice(i, i + 2000) });
  for (const x of r.skus ?? []) reasons.set(x.sku, x.ready ? [] : [...new Set(x.reasons)]);
}
const parts: Row[] = rows.map((r: any) => ({ ...r, required_total: Number(r.required_total), required_present: Number(r.required_present),
  pending: Number(r.pending), inherited_present: inh.get(r.id) ?? 0, ready: (reasons.get(r.sku) ?? ["?"]).length === 0,
  missing: r.missing ?? [], required_fields: r.required_fields ?? [], pending_gates: r.pending_gates ?? [] }));
const tree = rollUp(parts, VENDOR);
const sumsBad = sumsOk(tree);
if (sumsBad) { console.error(`dashboard_sums FAILED: ${sumsBad}`); process.exit(1); }
const catName = new Map(parts.map((p) => [p.category, p.name_de]));

// ------------------------------------------------------------------------------------------------ history and the night
const histFile = path.join(FILL, "history.jsonl");
const history: any[] = fs.existsSync(histFile) ? fs.readFileSync(histFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const snapshot = { night: today, at: new Date().toISOString(), brand: { pct: filledPct(tree.seg), ready: tree.ready, parts: tree.parts },
  categories: Object.fromEntries(Object.entries(tree.children!).map(([k, n]) => [k, { pct: filledPct(n.seg), ready: n.ready, parts: n.parts }])) };
const hist = [...history.filter((h) => h.night !== today), snapshot].slice(-30);
if (RECORD) fs.writeFileSync(histFile, [...history.filter((h) => h.night !== today), snapshot].map((h) => JSON.stringify(h)).join("\n") + "\n");

const nightDirs = fs.existsSync(path.join(FILL, "nights")) ? fs.readdirSync(path.join(FILL, "nights")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
const lastNight = nightDirs[nightDirs.length - 1] ?? null;
const ND = lastNight ? path.join(FILL, "nights", lastNight) : null;
const acq = ND ? readJson(path.join(ND, "acquire.json")) : null, docs = ND ? readJson(path.join(ND, "docs.json")) : null;
const fams: Record<string, any> | null = ND ? readJson(path.join(ND, "families.json")) : null;
const reportFile = lastNight ? path.join(FILL, "reports", `fill-${lastNight}.md`) : null;
const reportHead = reportFile && fs.existsSync(reportFile) ? fs.readFileSync(reportFile, "utf8").split("\n")[0] : "";
const stopFile = path.join(FILL, "STOP");
const stopped = fs.existsSync(stopFile) ? fs.readFileSync(stopFile, "utf8").trim() : (/STOPPED at (.*)$/.exec(reportHead)?.[1] ?? null);
const todayPlan = readJson(path.join(FILL, "today.json"));
const boardText = fs.existsSync(path.join(FILL, "board-last.txt")) ? fs.readFileSync(path.join(FILL, "board-last.txt"), "utf8") : "";
const failing = (/^\s*failing: (.*)$/m.exec(boardText)?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "vendor_coverage");
const nightStart = lastNight ? `${lastNight}T00:30:00Z` : today;

// ------------------------------------------------------------------------------------------------ quality, per UTC day
const q = (await query<any>(`
  SELECT to_char(f.created_at, 'YYYY-MM-DD') AS day,
         count(*) FILTER (WHERE f.method NOT LIKE 'retracted:%' AND f.state IN ('verified','corroborated','unverified','conflict')) AS written,
         count(*) FILTER (WHERE f.method LIKE 'retracted:%') AS retracted,
         count(*) FILTER (WHERE f.method NOT LIKE 'retracted:%' AND NOT f.inherited AND f.method NOT LIKE 'derived:%'
                          AND f.state IN ('verified','corroborated','unverified','conflict')) AS reads,
         count(*) FILTER (WHERE f.method LIKE 'derived:%') AS derived,
         count(*) FILTER (WHERE f.inherited AND f.method NOT LIKE 'retracted:%') AS inherited
    FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND f.created_at > now() - interval '30 days' GROUP BY 1`, [VENDOR])).rows;
const cq = (await query<any>(`
  SELECT d AS day, sum(o)::int AS opened, sum(r)::int AS resolved FROM (
    SELECT to_char(cf.logged_at, 'YYYY-MM-DD') AS d, 1 AS o, 0 AS r FROM conflicts cf JOIN parts p ON p.id = cf.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND cf.logged_at > now() - interval '30 days'
    UNION ALL
    SELECT to_char(cf.resolved_at, 'YYYY-MM-DD'), 0, 1 FROM conflicts cf JOIN parts p ON p.id = cf.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = $1 AND cf.resolved_at > now() - interval '30 days') x GROUP BY 1`, [VENDOR])).rows;
const gq = (await query<any>(`
  SELECT to_char(r.started_at, 'YYYY-MM-DD') AS day, min((r.gate->>'precision')::numeric) AS precision,
         sum(coalesce((r.stats->>'facts_rejected')::int, (r.stats->>'rejected')::int, 0)) AS refused
    FROM runs r WHERE r.status = 'succeeded' AND r.started_at > now() - interval '30 days'
     AND EXISTS (SELECT 1 FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
                  WHERE f.run_id = r.id AND v.slug = $1) GROUP BY 1`, [VENDOR])).rows;
const days = [...new Set([...q.map((r) => r.day), ...cq.map((r) => r.day), ...gq.map((r) => r.day)])].sort().slice(-30);
const qual = days.map((d) => {
  const a = q.find((r) => r.day === d) ?? {}, b = cq.find((r) => r.day === d) ?? {}, g = gq.find((r) => r.day === d) ?? {};
  const w = Number(a.written ?? 0);
  return { day: d, written: w, retracted: Number(a.retracted ?? 0), opened: Number(b.opened ?? 0), resolved: Number(b.resolved ?? 0),
    refused: g.refused === undefined ? null : Number(g.refused), precision: g.precision === undefined || g.precision === null ? null : Number(g.precision),
    reads_pct: w ? Math.round((100 * Number(a.reads ?? 0)) / w) : null, derived_pct: w ? Math.round((100 * Number(a.derived ?? 0)) / w) : null,
    inherited_pct: w ? Math.round((100 * Number(a.inherited ?? 0)) / w) : null };
});
const wrong: string[] = [];
const l2 = qual.slice(-3);
if (l2.length === 3) {
  if (l2[2].retracted > l2[1].retracted && l2[1].retracted > l2[0].retracted) wrong.push(`retractions rose two nights running (${l2[2].retracted})`);
  if (l2[2].opened > l2[2].resolved && l2[1].opened > l2[1].resolved) wrong.push(`conflicts opened outpaced resolved two nights (${l2[2].opened} vs ${l2[2].resolved})`);
  if ((l2[2].precision ?? 1) < 0.98 && (l2[1].precision ?? 1) < 0.98) wrong.push(`gate precision under 98% two nights (${l2[2].precision})`);
}

// ------------------------------------------------------------------------------------------------ the light
const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
const flat = (a: any, b: any) => a && b && a.brand.ready === b.brand.ready && a.brand.pct === b.brand.pct;
let noProgress = 0;
for (let i = hist.length - 1; i > 0 && flat(hist[i], hist[i - 1]); i--) noProgress++;
const stalled = Object.keys(snapshot.categories).filter((c) => {
  const s = hist.slice(-4).map((h) => h.categories?.[c]?.pct);
  return s.length === 4 && s.every((x) => x === s[0]) && (s[0] ?? 100) < 100;
});
const stagedDays = (() => {
  // the longest a family has stayed staged for golden rows across consecutive nights
  let best = 0;
  const staged = nightDirs.slice(-10).map((d) => readJson(path.join(FILL, "nights", d, "families.json")) ?? {});
  for (const fam of Object.keys(staged[staged.length - 1] ?? {})) {
    let n = 0;
    for (let i = staged.length - 1; i >= 0 && (staged[i][fam]?.why ?? "").startsWith("golden rows owed"); i--) n++;
    best = Math.max(best, n);
  }
  return best;
})();
const committed = Number((await query<{ n: string }>(`SELECT count(*)::text AS n FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
  WHERE v.slug = $1 AND f.created_at >= $2::timestamptz AND f.method NOT LIKE 'retracted:%'`, [VENDOR, nightStart])).rows[0].n);
const retracted = Number((await query<{ n: string }>(`SELECT count(*)::text AS n FROM runs WHERE kind LIKE '%retract%' AND status = 'succeeded' AND started_at >= $1::timestamptz`, [nightStart])).rows[0].n) > 0;
const predicted = Number(todayPlan?.predicted_unlock ?? NaN), actual = prev ? tree.ready - prev.brand.ready : NaN;
const facts: NightFacts = {
  ran_last_night: !!lastNight && lastNight >= new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10),
  stopped, ready_now: tree.ready, ready_before: prev?.brand.ready ?? null, retraction_recorded: retracted, board_other_failing: failing,
  committed_facts: committed, no_progress_nights: noProgress, stalled_categories: stalled, staged_waiting_days: stagedDays,
  soft_block_pct: acq?.night?.fetched ? (100 * (acq.night.akamai_total ?? 0)) / acq.night.fetched : null,
  quality_wrong_way: wrong, prediction_miss_pct: predicted > 0 && Number.isFinite(actual) ? (100 * Math.abs(predicted - actual)) / predicted : null,
  first_night_pending: !lastNight,
};
const light = statusLight(facts);

// ------------------------------------------------------------------------------------------------ html
const CSS = `body{font:15px/1.45 system-ui,Segoe UI,sans-serif;margin:0;background:#f7f7f5;color:#1d1d1b}main{max-width:1180px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:4px 0 8px}h2{font-size:17px;margin:22px 0 8px}table{border-collapse:collapse;width:100%;background:#fff}
td,th{padding:5px 8px;border-bottom:1px solid #e3e3df;text-align:left;vertical-align:middle;font-size:14px}th{background:#efefeb;font-weight:600}
.light{padding:12px 14px;border-radius:8px;font-size:17px;margin:8px 0 12px;color:#fff}.GREEN{background:#1f7a3a}.AMBER{background:#b86e00}.RED{background:#b3261e}
.bar{display:flex;height:14px;min-width:240px;border-radius:3px;overflow:hidden;background:#ddd}.bar span{display:block;height:100%}
.s0{background:#1f7a3a}.s1{background:#6fb47f}.s2{background:#e0b341}.s3{background:#e8833a}.s4{background:#b9b9b4}
.thin{height:5px;background:#e3e3df;margin-top:3px;border-radius:2px}.thin i{display:block;height:100%;background:#2b59c3;border-radius:2px}
.muted{color:#6b6b66;font-size:13px}.legend span{display:inline-block;width:11px;height:11px;margin:0 4px 0 12px;vertical-align:-1px}
details{background:#fff;border-bottom:1px solid #e3e3df;padding:4px 8px}summary{cursor:pointer}code{font-size:12px}a{color:#1f4fb3}`;
const bar = (s: Seg) => {
  const t = SEG_KEYS.reduce((n, k) => n + s[k], 0) || 1;
  return `<div class="bar" title="${SEG_KEYS.map((k) => `${k} ${s[k]}`).join(" · ")}">${SEG_KEYS.map((k, i) => s[k] ? `<span class="s${i}" style="width:${(100 * s[k]) / t}%"></span>` : "").join("")}</div>`;
};
const thin = (n: Node) => `<div class="thin" title="shop-ready ${n.ready} of ${n.parts}"><i style="width:${n.parts ? (100 * n.ready) / n.parts : 0}%"></i></div>`;
const spark = (vals: number[]) => {
  if (vals.length < 2) return `<span class="muted">${vals.length ? "1 night so far" : "no nights yet"}</span>`;
  const max = Math.max(...vals), min = Math.min(...vals), W = 120, H = 24;
  const pts = vals.map((v, i) => `${((i * W) / (vals.length - 1)).toFixed(1)},${(H - ((v - min) / ((max - min) || 1)) * H).toFixed(1)}`).join(" ");
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polyline fill="none" stroke="#2b59c3" stroke-width="1.6" points="${pts}"/></svg>`;
};
const LEGEND = `<p class="legend muted">${["filled (read from a sheet)", "filled (inherited / derived)", "waiting on a gate", "not read yet (sheet held)", "no sheet held"]
  .map((l, i) => `<span class="s${i}"></span>${l}`).join("")}</p>`;
// one stylesheet for the whole site (41k part pages each carrying it came to 208 MB): `root` is the page's path back to it
const page = (title: string, body: string, root = "") => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><link rel="stylesheet" href="${root}style.css"></head><body><main>${body}
<p class="muted">Built ${esc(new Date().toISOString())} from the store (no fact values on public pages). JSON beside every page: fill.json.</p></main></body></html>`;

// the brand page
const catRows = Object.entries(tree.children!).sort((a, b) => b[1].parts - a[1].parts).map(([slug, n]) => {
  const series = hist.map((h) => h.categories?.[slug]?.pct).filter((x) => x !== undefined) as number[];
  const eta = etaDays(series);
  const gain = series.length >= 2 ? ((series[series.length - 1] - series[0]) / (series.length - 1)).toFixed(2) : "–";
  return `<tr><td><a href="${slug}/index.html">${esc(catName.get(slug))}</a></td><td>${bar(n.seg)}${thin(n)}</td><td>${filledPct(n.seg)}%</td>
  <td>${n.ready} / ${n.parts}</td><td>${spark(series)}</td><td>${gain}</td><td>${eta === null ? (series.length >= 2 ? "keine Bewegung" : "–") : `~${eta} Nächte`}</td></tr>`;
}).join("");
const req = tree.seg.filled_read + tree.seg.filled_inherited + tree.seg.not_parsed + tree.seg.not_held;
const pendingSlots = tree.seg.not_parsed + tree.seg.not_held;
const partition = (await query<{ reason: string; n: string }>(`SELECT CASE WHEN c.part_id IS NULL THEN 'no completeness row'
    WHEN c.no_profile THEN coalesce(c.no_profile_reason, 'no profile (no reason)') ELSE 'scored' END AS reason, count(*)::text AS n
  FROM parts p JOIN vendors v ON v.id = p.vendor_id LEFT JOIN completeness c ON c.part_id = p.id WHERE v.slug = $1 AND p.retired_at IS NULL GROUP BY 1 ORDER BY 2 DESC`, [VENDOR])).rows;
const happened = [
  lastNight ? `Nacht ${lastNight}: ${acq ? `${acq.night?.fetched ?? 0} Seiten geladen, ${acq.browser?.cache_hits ?? 0} aus dem Cache` : "keine Abruf-Zusammenfassung"}` : "Noch keine Nacht gelaufen.",
  docs ? `${docs.finished ?? 0} Dokumente gelesen (${docs.html ?? 0} HTML, ${docs.pdf ?? 0} PDF)` : "",
  lastNight ? `${committed} Fakten geschrieben` : "",
  prev ? `${Math.max(0, tree.ready - prev.brand.ready)} Teile wurden shop-ready (${tree.ready - prev.brand.ready >= 0 ? "+" : ""}${tree.ready - prev.brand.ready})` : "",
  stopped ? `Gestoppt: ${stopped}` : (reportHead ? reportHead.replace(/^# /, "") : ""),
].filter(Boolean).slice(0, 5);
const famRows = fams ? Object.entries(fams).sort((a, b) => b[1].docs - a[1].docs).slice(0, 12).map(([k, f]) =>
  `<tr><td><code>${esc(k.replace(/^https:\/\/www\.cisco\.com\/c\//, ""))}</code></td><td>${f.docs}</td><td>${f.status}</td><td>${esc(f.why)}</td></tr>`).join("") : "";
const brandBody = `<h1>${esc(VENDOR === "cisco" ? "Cisco" : VENDOR)}: ${filledPct(tree.seg)}% befüllt · ${pendingSlots.toLocaleString("de-DE")} Pflichtfelder offen · ${tree.ready.toLocaleString("de-DE")} von ${tree.parts.toLocaleString("de-DE")} Teilen shop-ready</h1>
<div class="light ${light.color}">${light.color === "GREEN" ? "GRÜN" : light.color === "AMBER" ? "GELB" : "ROT"} — ${esc(light.reason)}</div>
<p class="muted">${partition.map((p) => `${esc(p.reason)} ${Number(p.n).toLocaleString("de-DE")}`).join(" · ")}</p>
<h2>Was letzte Nacht passiert ist</h2><ul>${happened.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
<h2>Woran heute gearbeitet wird</h2>${todayPlan ? `<p>${esc(todayPlan.rule)} — Blocker: ${esc(todayPlan.blocker)} — erwartet: ${esc(todayPlan.predicted_unlock)} Teile shop-ready${Number.isFinite(actual) && prev ? ` · nach der Nacht: ${actual}` : ""} <span class="muted">(${esc(todayPlan.date)})</span></p>` : `<p class="muted">Kein Eintrag (today.json fehlt).</p>`}
<h2>Kategorien</h2>${LEGEND}<table><tr><th>Kategorie</th><th>Pflichtfelder · shop-ready</th><th>befüllt</th><th>shop-ready</th><th>30 Nächte</th><th>Ø/Nacht</th><th>fertig in</th></tr>${catRows}</table>
<h2>Qualität (neue Werte pro Tag)</h2><table><tr><th>Tag</th><th>geschrieben</th><th>zurückgezogen</th><th>Konflikte neu / gelöst</th><th>vom Normalisierer abgelehnt</th><th>Gate-Präzision</th><th>gelesen / abgeleitet / geerbt %</th></tr>
${qual.slice(-10).reverse().map((d) => `<tr><td>${d.day}</td><td>${d.written}</td><td>${d.retracted}</td><td>${d.opened} / ${d.resolved}</td><td>${d.refused ?? "n/a"}</td><td>${d.precision ?? "–"}</td><td>${d.reads_pct ?? "–"} / ${d.derived_pct ?? "–"} / ${d.inherited_pct ?? "–"}</td></tr>`).join("")}</table>
${wrong.length ? `<p><b>Falsche Richtung:</b> ${esc(wrong.join("; "))}</p>` : ""}
<h2>Details (für CC und den Reviewer)</h2>
<p class="muted">Nacht ${esc(lastNight ?? "–")}: ${acq ? `outcomes ${esc(JSON.stringify(acq.outcomes))}, not the document ${esc(JSON.stringify(acq.night?.not_document ?? {}))}, stop ${esc(acq.stop_reason ?? "none")}` : "no acquire summary"}.
Report: ${reportFile ? `<code>${esc(reportFile)}</code>` : "–"}. Board failing beyond the ruled set: ${esc(failing.join(", ") || "none")}.</p>
${famRows ? `<table><tr><th>family (document directory)</th><th>docs</th><th>status</th><th>why</th></tr>${famRows}</table>` : ""}
<p class="muted">Required slots ${req.toLocaleString("de-DE")} + ${tree.seg.pending_gate.toLocaleString("de-DE")} waiting on a gate. dashboard_sums: ok.</p>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "style.css"), CSS);
fs.writeFileSync(path.join(OUT, "index.html"), page(`Cisco Befüllung`, brandBody));
const jsonNode = (n: Node, depth: number): any => ({ name: n.name, parts: n.parts, ready: n.ready, filled_pct: filledPct(n.seg), seg: n.seg,
  ...(depth > 0 && n.children && Object.keys(n.children).length ? { children: Object.fromEntries(Object.entries(n.children).map(([k, c]) => [k, jsonNode(c, depth - 1)])) } : {}) });
fs.writeFileSync(path.join(OUT, "fill.json"), JSON.stringify({ vendor: VENDOR, built_at: new Date().toISOString(), light, facts, brand: jsonNode(tree, 1),
  history: hist, quality: qual, last_night: { date: lastNight, acquire: acq, docs, families: fams }, today: todayPlan }, null, 1));

// category pages and part pages
const partsByCat = new Map<string, Row[]>();
for (const p of parts) (partsByCat.get(p.category) ?? partsByCat.set(p.category, []).get(p.category)!).push(p);
const facts2 = (await query<any>(`
  SELECT f.part_id::text, f.field_key, f.inherited, f.method, f.state::text, sd.url FROM facts f LEFT JOIN source_docs sd ON sd.doc_id = f.doc_id
    JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND f.superseded_by IS NULL AND f.state IN ('verified', 'corroborated')`, [VENDOR])).rows;
const factBy = new Map<string, any>(facts2.map((f: any) => [`${f.part_id}|${f.field_key}`, f]));
const heldDoc = new Map((await query<{ part_id: string; url: string }>(`
  SELECT DISTINCT ON (dp.part_id) dp.part_id::text, sd.url FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id
    JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id
   WHERE v.slug = $1 AND ${heldRowSql("dp")} ORDER BY dp.part_id, sd.url`, [VENDOR])).rows.map((r) => [r.part_id, r.url]));
let partPages = 0;
for (const [slug, n] of Object.entries(tree.children!)) {
  const dir = path.join(OUT, slug);
  fs.mkdirSync(path.join(dir, "parts"), { recursive: true });
  const blockers = new Map<string, number>();
  for (const p of partsByCat.get(slug) ?? []) for (const r of reasons.get(p.sku) ?? []) blockers.set(r, (blockers.get(r) ?? 0) + 1);
  const top = [...blockers].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const nodeHtml = (m: Node, depth: number, label: string): string => {
    const head = `<summary>${esc(label)} ${esc(m.name)} — ${filledPct(m.seg)}% · shop-ready ${m.ready}/${m.parts}${bar(m.seg)}</summary>`;
    if (depth === 3) {
      const ps = (partsByCat.get(slug) ?? []).filter((p) => (p.series || "(none)") === m.name).slice(0, 200);
      return `<details>${head}<p>${ps.map((p) => `<a href="parts/${slugify(p.slug || p.sku)}.html">${esc(p.sku)}</a>`).join(" · ")}${ps.length === 200 ? " …" : ""}</p></details>`;
    }
    return `<details>${head}${Object.values(m.children ?? {}).sort((a, b) => b.parts - a.parts).map((c) => nodeHtml(c, depth + 1, ["Produktlinie", "Familie", "Serie"][depth])).join("")}</details>`;
  };
  const body = `<p><a href="../index.html">← Cisco</a></p><h1>${esc(catName.get(slug))}: ${filledPct(n.seg)}% befüllt · ${n.ready} von ${n.parts} shop-ready</h1>${LEGEND}${bar(n.seg)}${thin(n)}
<h2>Top 5 Blocker (Teile, die daran hängen)</h2><ol>${top.map(([r, c]) => `<li>${esc(r.replace(/^attribute:/, ""))} — ${c}</li>`).join("")}</ol>
<h2>Produktlinie → Familie → Serie</h2>${Object.values(n.children ?? {}).sort((a, b) => b.parts - a.parts).map((c) => nodeHtml(c, 1, "Produktlinie")).join("")}`;
  fs.writeFileSync(path.join(dir, "index.html"), page(`${catName.get(slug)} — Befüllung`, body, "../"));
  fs.writeFileSync(path.join(dir, "fill.json"), JSON.stringify({ category: slug, name_de: catName.get(slug), node: jsonNode(n, 3), top_blockers: top }, null, 1));
  for (const p of partsByCat.get(slug) ?? []) {
    const cups = p.required_fields.map((k) => {
      const f = factBy.get(`${p.id}|${k}`);
      if (f) return `<tr><td>${esc(k)}</td><td>${f.inherited ? "geerbt" : String(f.method).startsWith("derived:") ? "abgeleitet" : "gelesen"}</td><td>${f.url ? `<a href="${esc(f.url)}">Quelle</a>` : esc(f.method)}</td></tr>`;
      const doc = heldDoc.get(p.id);
      return `<tr><td>${esc(k)}</td><td>fehlt</td><td>${doc ? `Blatt vorhanden, nicht gelesen: <a href="${esc(doc)}">Dokument</a>` : "kein Datenblatt vorhanden"}</td></tr>`;
    }).join("");
    const gates = p.pending_gates.map((g) => `<tr><td>${esc(g.cup)}</td><td>wartet</td><td>Gate unbeantwortet: ${esc(g.gate.join(", "))}</td></tr>`).join("");
    const s = partSeg(p);
    const body2 = `<p><a href="../index.html">← ${esc(catName.get(slug))}</a></p><h1>${esc(p.sku)}</h1>
<p>${esc([p.product_line, p.product_family, p.series].filter(Boolean).join(" → "))} · ${p.ready ? "shop-ready" : `nicht shop-ready: ${esc((reasons.get(p.sku) ?? []).join(", "))}`}</p>${bar(s)}
<table><tr><th>Pflichtfeld</th><th>Zustand</th><th>Quelle / warum</th></tr>${cups}${gates}</table>
<p class="muted">Werte: <code>/v1/parts/${esc(VENDOR)}/${esc(p.sku)}</code> (mit API-Schlüssel).</p>`;
    fs.writeFileSync(path.join(dir, "parts", `${slugify(p.slug || p.sku)}.html`), page(p.sku, body2, "../../"));
    partPages++;
  }
}
console.log(`fill dashboard: ${tree.parts} parts, ${Object.keys(tree.children!).length} categories, ${partPages} part pages; light ${light.color} (${light.reason}); dashboard_sums ok${RECORD ? "; history recorded" : ""}`);
await closePool();
