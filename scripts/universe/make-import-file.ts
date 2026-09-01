// scripts/universe/make-import-file.ts — emit the enumeration in the shape
// netzspec's scripts/universe/apply-enumeration.mjs already expects: { records: [...] }.
//
// One record per DISTINCT part number (not per part x series), carrying its category, series,
// lifecycle and the document it came from, so the importer can create honest stubs.
import fs from "node:fs"; import path from "node:path";
const root = process.cwd();
type Doc = { category?: string; series_name?: string; series_slug?: string; pids?: string[]; error?: string };
const best = new Map<string, { category: string; series: string; url: string; lifecycle: string }>();
function absorb(url: string, d: Doc, lifecycle: string) {
  if (d.error) return;
  for (const pid of d.pids || []) {
    const prev = best.get(pid);
    // prefer a CURRENT datasheet over an EoL bulletin for the categorisation
    if (!prev || (prev.lifecycle === "end-of-life" && lifecycle === "current")) {
      best.set(pid, { category: d.category || "uncategorised",
        series: d.series_name || d.series_slug || "unknown", url, lifecycle });
    }
  }
}
const store = JSON.parse(fs.readFileSync(path.join(root, "data/universe/cisco-pid-universe.json"), "utf8")).documents || {};
for (const [u, d] of Object.entries(store)) absorb(u, d as Doc, "current");
const eolPath = path.join(root, "data/universe/cisco-eol-pids.json");
if (fs.existsSync(eolPath)) {
  const eol = JSON.parse(fs.readFileSync(eolPath, "utf8"));
  for (const [u, d] of Object.entries(eol.bulletins || {})) absorb(u, d as Doc, "end-of-life");
}
const mer = path.join(root, "data/universe/meraki-pids.json");
if (fs.existsSync(mer)) {
  const m = JSON.parse(fs.readFileSync(mer, "utf8"));
  for (const [u, d] of Object.entries(m as Record<string, { pids?: string[] }>)) {
    for (const pid of d.pids || []) if (!best.has(pid))
      best.set(pid, { category: "meraki", series: "Cisco Meraki", url: u, lifecycle: "current" });
  }
}
// map our category to the netzspec `type` vocabulary where one exists; otherwise leave the
// category to speak for itself. apply-enumeration.mjs's catFor() only knows 3 categories, so the
// importer MUST honour record.category or all 86k parts land as "switches".
const TYPE: Record<string, string> = { switches: "switch", routers: "router",
  "interfaces-modules": "transceiver", wireless: "access-point", security: "firewall",
  "servers-unified-computing": "server", "optical-networking": "optical",
  "storage-networking": "storage", meraki: "meraki" };
const records = [...best.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([sku, v]) => ({
  sku, vendor: v.category === "meraki" ? "meraki" : "cisco",
  category: v.category, type: TYPE[v.category] || v.category,
  product_family: v.series, datasheet_url: v.url.startsWith("http") ? v.url : null,
  lifecycle_hint: v.lifecycle,
}));
const out = path.join(root, "data/universe/cisco-enumeration-full.json");
fs.writeFileSync(out, JSON.stringify({ source: "cisco-enumeration", generated_at: new Date().toISOString(), records }, null, 1));
const cats: Record<string, number> = {};
for (const r of records) cats[r.category] = (cats[r.category] || 0) + 1;
console.log(`${records.length} records -> ${path.relative(root, out)} (${(fs.statSync(out).size/1048576).toFixed(1)} MB)`);
console.log(Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join("  "));
