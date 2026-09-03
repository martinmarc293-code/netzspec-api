// scripts/universe/analyze.mjs — universe v0 report (§3). Computes the 10-group completeness
// score per part, the exclusion-pattern audit (service/license SKUs that can't be pages),
// datasheet/spec coverage, and writes data/reference/report_v0.md + completeness back onto
// each record. Read-mostly (only $set completeness_score, idempotent). No live fetching.
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// §3.3 exclusion patterns — service contracts, licences, subscriptions (not hardware, can't be pages)
const EXCLUDE = [
  { re: /^CON-/i, label: "Cisco service contract (CON-*)" },
  { re: /^(L-|LIC-|SL-|SUB-|E-|SWSS)/i, label: "licence/subscription (L-/LIC-/SUB-/E-*/SWSS)" },
  { re: /AAE$|-STU$/i, label: "e-licence (*AAE / *-STU)" },
  { re: /^(H[0-9A-Z]{3,}E|U[0-9A-Z]{3,}E)$/i, label: "HPE care pack (H*E / U*E)" },
  { re: /DNA|MERAKI.?LIC|-LIC-/i, label: "DNA/Meraki licence" },
];
const excludedBy = (sku) => EXCLUDE.find((e) => e.re.test(sku))?.label || null;

// §3.1 completeness — 10 field groups, one point each (0–10)
function completeness(p) {
  const de = p.i18n?.de || {};
  const g = {
    identity: !!(p.sku && p.vendor && p.family && p.category && p.type),
    description: !!(de.name && de.shortDesc),
    specs: (de.attributes || []).length >= 12,
    datasheet_source: !!(p.provenance?.source_url && p.provenance?.verified_at),
    lifecycle: !!(p.lifecycle && /\d{4}-\d{2}-\d{2}/.test(JSON.stringify(p.lifecycle))) || !!(p.lifecycle?.status === "active" && p.lifecycle?.source_url),
    compatibility: (p.compat || []).some((r) => r.relation === "vendor_verified") || !!(p.lifecycle?.successor_sku),
    price_context: false, // decided by the memo; own-shop price is stripped from netzspec
    faq: (de.faq || []).length >= 3,
    family_prose: false, // reviewed content/families/*.de.md — none yet
    second_reference: false, // ≥2 non-owned links — HexCat gives 1
  };
  const score = Object.values(g).filter(Boolean).length;
  return { score, g };
}

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const db = client.db(env.MONGODB_DB || "netzspec");
const parts = await db.collection("parts").find({}, { projection: { _id: 0 } }).toArray();

const byVendor = {}, dist = Array(11).fill(0), excl = {}, groupPass = {};
let hardware = 0, excluded = 0, dsResolved = 0, specs12 = 0, specs0 = 0;
const zeroSpecFamilies = {};
const updates = [];
for (const p of parts) {
  const ex = excludedBy(p.sku);
  if (ex) { excluded++; excl[ex] = (excl[ex] || 0) + 1; }
  else hardware++;
  const { score, g } = completeness(p);
  dist[score]++;
  (byVendor[p.vendor] ||= { n: 0, sum: 0, complete: 0 }); byVendor[p.vendor].n++; byVendor[p.vendor].sum += score; if (score === 10) byVendor[p.vendor].complete++;
  for (const [k, v] of Object.entries(g)) groupPass[k] = (groupPass[k] || 0) + (v ? 1 : 0);
  if (g.datasheet_source) dsResolved++;
  if (g.specs) specs12++;
  if ((p.i18n?.de?.attributes || []).length === 0) { specs0++; zeroSpecFamilies[p.family || "?"] = (zeroSpecFamilies[p.family || "?"] || 0) + 1; }
  updates.push({ sku: p.sku, score });
}

const md = [];
md.push(`# Universe v0 report (§3) — ${new Date().toISOString().slice(0, 10)}`, "");
md.push(`Total records: **${parts.length}** · hardware (page-eligible): **${hardware}** · excluded service/licence: **${excluded}**`, "");
md.push(`## Completeness score distribution (0–10, §3.1)`);
md.push("| score | count |", "|---|---|");
dist.forEach((c, s) => { if (c) md.push(`| ${s} | ${c} |`); });
md.push("", `Field-group pass counts: ${Object.entries(groupPass).map(([k, v]) => `${k} ${v}`).join(" · ")}`, "");
md.push(`## By vendor (avg score · complete 10/10)`);
md.push("| vendor | n | avg | 10/10 |", "|---|---|---|---|");
for (const [v, x] of Object.entries(byVendor).sort((a, b) => b[1].n - a[1].n)) md.push(`| ${v} | ${x.n} | ${(x.sum / x.n).toFixed(1)} | ${x.complete} |`);
md.push("", `## Exclusion audit (§3.3 — these are NOT pages)`);
md.push("| pattern | count |", "|---|---|");
for (const [k, v] of Object.entries(excl).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
md.push("", `## Datasheet / spec coverage`, `- datasheet source resolved (c1): **${dsResolved}** / ${parts.length}`, `- specs ≥12 (c2): **${specs12}** / ${parts.length}`, `- specs = 0: **${specs0}** (top families: ${Object.entries(zeroSpecFamilies).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, n]) => `${f}(${n})`).join(", ")})`);
md.push("", `## What blocks 10/10 everywhere (systematic)`, `lifecycle, compatibility(vendor-verified), family_prose, second_reference, price_context — the data-completion program (WP-L/WP-C/WP-P + WP-S) fills these family-by-family.`);

fs.mkdirSync("data/reference", { recursive: true });
fs.writeFileSync("data/reference/report_v0.md", md.join("\n"));
console.log(md.join("\n").slice(0, 1600));
console.log("\n...wrote data/reference/report_v0.md");

if (COMMIT) {
  for (const u of updates) await db.collection("parts").updateOne({ sku: u.sku }, { $set: { completeness_score: u.score } });
  console.log(`completeness_score written to ${updates.length} records.`);
} else console.log("(dry run — pass --commit to store completeness_score)");
await client.close();
