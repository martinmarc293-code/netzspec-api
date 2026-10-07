// scripts/family-row-weight-witnesses.mts — the witness table for FAMILY-ROW weights (reviewer, 6 Oct 2026 ~22:50, Q1 + Q4).
//
//     npx tsx scripts/family-row-weight-witnesses.mts            # (re)write data/reference/family-row-weight-witnesses.json
//     npx tsx scripts/family-row-weight-witnesses.mts --check    # regenerate and compare; exit 1 on any difference
//
// The rulings, verbatim: "Q1 — yes, as a separate method derived:family-row (not model-row), so a value stated for a family stays
// distinguishable from one stated for the model: the family row writes onto each PID the same sheet lists under that family — never
// by token match alone." "Q4 — yes. Different from Q25: the sheet itself bounds the class to exactly its own MPAs (NC57 sent
// elsewhere), so it names its parts; derived:family-row, PID list from the same sheet."
//
// A SOURCE is a weight a sheet states for a FAMILY ("Cisco C890G-LTE ● 5.7 lb", the one "Weight ● 5.7 lb" of a one-family sheet,
// the 55A2 sheet's "Physical specification of MPA ... Weight – 0.8 lbs"). MEMBERSHIP IS THE SHEET'S OWN GROUPING, never a SKU
// pattern: the PIDs its ordering table prints between the family's group heading and the next heading (`group`); the heading must
// occur EXACTLY ONCE on the page and the group must end, or the source writes nothing. Where the sheet bounds a CLASS instead (55A2),
// the class is the PIDs the sheet prints that `pids` names -- what the sheet sends elsewhere (NC57) is outside it by its own words.
// Every PID must also be linked to the sheet (doc_parts), be live hardware in `routers`, and be of a listed kind.
// A PID with a MODEL row is not a family row: the named model is the more specific statement (C897VAGW-LTE sits in the 89xG group
// and carries its own 6.1 lb), and a model row is never superseded by a family row (the writer keeps a weight of another method).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "../src/store/index.js";
import { docIdFor } from "../src/store/docs.js";
import { cachedText, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/reference/family-row-weight-witnesses.json");
const MODEL_ROWS = path.join(ROOT, "data/reference/model-row-weight-witnesses.json");
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
const DOT = String.fromCharCode(0x25cf), DASH = String.fromCharCode(0x2013);
const ISR8 = "https://www.cisco.com/c/en/us/products/collateral/routers/800-series-routers/";
const ISR819 = "https://www.cisco.com/c/en/us/products/collateral/routers/819-integrated-services-router-isr/";
const ORDER = "Ordering information Product Description ";
type Source = { url: string; doc_type: string; label: string; raw: string; family: string;
  /** the contiguous printed string that states the weight (re-read by the writer too) */
  statement: string;
  /** anchors that must be printed in order around the statement, within `span` characters (one table) */
  printed: string[]; span?: number;
  /** the family's group in the sheet's ordering table: from its heading to the first `to` after it */
  group: { from: string; to: string[] } | null;
  /** a CLASS the sheet bounds (Q4): which of the PIDs the sheet prints belong to it */
  pids?: RegExp;
  kinds?: string[];
  /** the cup (default weight). RV ruling, 7 Oct 2026 (verbatim): "Throughput as derived:family-row applies only when the sheet prints
   *  one Performance table with no model columns. If a sheet has per-model columns, each column is a model row." */
  key?: string };
const LTE20 = `${ISR8}datasheet_c78-732744.html`;
const WEIGHT_LTE20 = `Weight Cisco C880G-4G ${DOT} 5.6 lb (2.54 kg) Cisco C890G-LTE ${DOT} 5.7 lb (2.59 kg)`;
const M2M = `${ISR819}datasheet_c78-732558.html`;
const WEIGHT_M2M = "Weight Cisco C819G-4G 2.3 lb (1.0 kg) Cisco 819HG 3.2 lb (1.5 kg)";
const SOURCES: Source[] = [
  { url: LTE20, doc_type: "vendor_datasheet_html", label: "Weight", raw: "5.7 lb (2.59 kg)", family: "C890G-LTE (Table 9 group 'Cisco 89xG 4G LTE 2.0 Integrated Services Router')",
    statement: WEIGHT_LTE20, printed: [WEIGHT_LTE20],
    group: { from: "Table 9. Cisco 890G and 880G 4G Series LTE 2.0 ISRs ordering information Product Description Cisco 89xG 4G LTE 2.0 Integrated Services Router",
      to: ["Cisco 88xG 4G LTE 2.0 Integrated Services Router"] } },
  { url: LTE20, doc_type: "vendor_datasheet_html", label: "Weight", raw: "5.6 lb (2.54 kg)", family: "C880G-4G (Table 9 group 'Cisco 88xG 4G LTE 2.0 Integrated Services Router')",
    statement: WEIGHT_LTE20, printed: [WEIGHT_LTE20],
    group: { from: "Cisco 88xG 4G LTE 2.0 Integrated Services Router", to: ["Table 10."] } },
  { url: `${ISR8}datasheet_c78-737332.html`, doc_type: "vendor_datasheet_html", label: "Weight", raw: "5.7 lb (2.59 kg)",
    family: "890G Series 4G LTE 2.5 (the sheet's one router group; one sheet-level weight)", statement: `Weight ${DOT} 5.7 lb (2.59 kg)`, printed: [`Weight ${DOT} 5.7 lb (2.59 kg)`],
    group: { from: `${ORDER}Cisco 890G Series 4G LTE 2.5 Integrated Services Router`, to: ["Ordering information"] } },
  { url: M2M, doc_type: "vendor_datasheet_html", label: "Weight", raw: "2.3 lb (1.0 kg)", family: "C819G-4G (group 'Cisco 819G non-hardened 4G LTE Integrated Services Routers')",
    statement: WEIGHT_M2M, printed: [WEIGHT_M2M],
    group: { from: `${ORDER}Cisco 819G non-hardened 4G LTE Integrated Services Routers`, to: ["Cisco 819G hardened 4G LTE Integrated Services Routers"] } },
  { url: M2M, doc_type: "vendor_datasheet_html", label: "Weight", raw: "3.2 lb (1.5 kg)", family: "819HG (group 'Cisco 819G hardened 4G LTE Integrated Services Routers')",
    statement: WEIGHT_M2M, printed: [WEIGHT_M2M],
    group: { from: "Cisco 819G hardened 4G LTE Integrated Services Routers", to: ["Power supplies and mounting brackets"] } },
  { url: `${ISR819}datasheet-C78-734216.html`, doc_type: "vendor_datasheet_html", label: "Weight", raw: "2.3 lb (1.0 kg)",
    family: "C819GW-4G (the sheet's one router group 'Cisco 819G non-hardened 4G LTE Integrated Services Routers')",
    statement: "Weight Cisco C819GW-4G 2.3 lb (1.0 kg)", printed: ["Weight Cisco C819GW-4G 2.3 lb (1.0 kg)"],
    group: { from: `${ORDER}Cisco 819G non-hardened 4G LTE Integrated Services Routers`, to: ["Power supplies and mounting brackets"] } },
  // Q4: the 55A2 sheet's MPA class -- "Physical specification of MPA ... Weight – 0.8 lbs", NC57 sent to the NCS 5700 MPA sheet
  { url: "https://www.cisco.com/c/en/us/products/collateral/routers/network-convergence-system-5500-series/datasheet-c78-741080.html",
    doc_type: "vendor_datasheet_html", label: "Weight", raw: "0.8 lbs", family: "NC55 MPA class of the NCS 55A2 sheet ('Physical specification of MPA')",
    statement: `Weight ${DASH} 0.8 lbs`, span: 600,
    printed: ["Physical specification of MPA", `Weight ${DASH} 0.8 lbs`, "please refer to NCS 5700 Series MPA datasheet"],
    group: null, pids: /^NC55-MPA-/, kinds: ["module"] },
  // RV (ruling 7 Oct 2026): the sheet's ONE Performance table -- printed as "Performance NAT throughput <value>" with no model header
  // between, which is the anchor that proves it has no model columns -- onto every PID the sheet's own ordering table lists. The 13 Sep
  // operator ruling (natThroughput.ts) makes an smb router's NAT row its router_throughput; class B had kept it from ever landing.
  // RV260's "800+ Mbps" is a lower bound the normaliser refuses, so RV260 is not a source here.
  ...([
    ["rv160-vpn-router/datasheet-c78-741410.html", "RV160 / RV160W", "Performance NAT throughput 600 Mbps", "600 Mbps",
      { from: "Ordering information Part number Product description", to: ["Dimensions RV 160 RV 160W"] }],
    ["rv110w-wireless-n-vpn-firewall/data_sheet_c78-660141.html", "RV110W", `Performance ${DOT} NAT throughput: 90 Mbps`, "90 Mbps",
      { from: "Table 5. Ordering information Part number Product name", to: ["Warranty information", "Cisco Capital"] }],
    ["rv215w-wireless-n-vpn-router/data_sheet_c78-712088.html", "RV215W", `Performance ${DOT} NAT throughput: 90 Mbps`, "90 Mbps",
      { from: "Table 5. Ordering information for the Cisco RV215W Part number Product name", to: ["Warranty information"] }],
    ["small-business-rv-series-routers/datasheet-c78-738909.html", "RV130", "Performance NAT throughput 800 Mbps", "800 Mbps",
      { from: "Table 2. Ordering information Part number Product name Countries", to: ["Cisco Capital"] }],
    ["small-business-rv-series-routers/datasheet-c78-736464.html", "RV132W", "Performance NAT throughput 75 Mbps (Ethernet WAN)", "75 Mbps (Ethernet WAN)",
      { from: "Table 2. Ordering information Part number Countries", to: ["Cisco Capital"] }],
    ["small-business-rv-series-routers/datasheet-c78-736465.html", "RV134W", "Performance NAT throughput 750 Mbps (Ethernet WAN)", "750 Mbps (Ethernet WAN)",
      { from: "Table 2. Ordering information Part number Countries", to: ["Cisco Capital"] }],
  ] as [string, string, string, string, { from: string; to: string[] }][]).map(([u, fam, statement, raw, group]): Source => ({
    url: `https://www.cisco.com/c/en/us/products/collateral/routers/${u}`, doc_type: "vendor_datasheet_html", label: "NAT throughput", raw,
    family: `${fam} (the sheet's one Performance table, no model columns)`, statement, printed: [statement], group, key: "router_throughput" })),
];

const cacheFile = (url: string) => `${createHash("sha1").update(url).digest("hex")}.html`;
function inOrderAt(text: string, printed: string[]): { missing: string | null; span: number } {
  let at = 0, start = -1;
  for (const p of printed) {
    const i = text.indexOf(ws(p), at);
    if (i < 0) return { missing: p, span: 0 };
    if (start < 0) start = i;
    at = i + ws(p).length;
  }
  return { missing: null, span: at - start };
}
const count = (text: string, s: string) => { let n = 0; for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + 1)) n++; return n; };
/** the family's group: after its (unique) heading, up to the first `to` heading -- or null with the reason */
function groupOf(text: string, g: { from: string; to: string[] }): { seg: string | null; why: string } {
  const from = ws(g.from), n = count(text, from);
  if (n !== 1) return { seg: null, why: `group heading "${g.from}" is printed ${n} times (need exactly 1)` };
  const start = text.indexOf(from) + from.length;
  let end = -1;
  for (const t of g.to) { const j = text.indexOf(ws(t), start); if (j >= 0 && (end < 0 || j < end)) end = j; }
  if (end < 0) return { seg: null, why: `the group after "${g.from}" never ends (none of ${JSON.stringify(g.to)} follows it)` };
  return { seg: text.slice(start, end), why: "" };
}
// a SKU is printed as a token: no SKU character on either side ("c897vag-lte-ga-k9" is not inside "c897vag-lte-ga-k9=")
const SKU_CHARS = new Set("abcdefghijklmnopqrstuvwxyz0123456789-+=/".split(""));
function printedAsToken(seg: string, sku: string): boolean {
  const s = sku.toLowerCase();
  for (let i = seg.indexOf(s); i >= 0; i = seg.indexOf(s, i + 1)) {
    const before = i === 0 ? " " : seg[i - 1], after = seg[i + s.length] ?? " ";
    if (!SKU_CHARS.has(before) && !SKU_CHARS.has(after)) return true;
  }
  return false;
}

const modelRowSkus = new Set((JSON.parse(fs.readFileSync(MODEL_ROWS, "utf8")) as { rows: { sku: string }[] }).rows.map((r) => r.sku));
const db = getPool();
const rows: Record<string, unknown>[] = [];
const report: string[] = [];
for (const s of SOURCES) {
  const text = cachedText(cacheFile(s.url), CACHE);
  if (text === null) throw new Error(`${s.url} is not readable from the cache -- could not check, nothing written`);
  const found = inOrderAt(text, s.printed);
  if (found.missing) throw new Error(`${s.url}: "${found.missing}" is not printed in order`);
  if (found.span > (s.span ?? 1500)) throw new Error(`${s.url}: the printed strings span ${found.span} characters: not one table`);
  if (!text.includes(ws(s.statement)) || !text.includes(ws(s.raw))) throw new Error(`${s.url}: "${s.statement}" / "${s.raw}" is not printed`);
  const docId = docIdFor(s.url);
  const linked = (await db.query<{ sku: string }>(`
    SELECT p.sku FROM doc_parts dp JOIN parts p ON p.id = dp.part_id JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     WHERE dp.doc_id = $1 AND v.slug = 'cisco' AND p.retired_at IS NULL AND p.product_class = 'hardware' AND c.slug = 'routers'
       AND p.sku_kind = ANY($2::text[]) ORDER BY p.sku`, [docId, s.kinds ?? ["router"]])).rows;
  let members: string[];
  let groupNote: string;
  if (s.group) {
    const g = groupOf(text, s.group);
    if (!g.seg) throw new Error(`${s.url}: ${g.why} -- nothing written`);
    members = linked.filter((p) => printedAsToken(g.seg!, p.sku)).map((p) => p.sku);
    groupNote = `${s.group.from} .. ${s.group.to.join(" | ")}`;
  } else {
    members = linked.filter((p) => s.pids!.test(p.sku) && printedAsToken(text, p.sku)).map((p) => p.sku);
    groupNote = `class ${s.pids!.source}, printed on the sheet`;
  }
  // the named model is more specific than its family -- for the cup the model row states (weight); a throughput is never a model row
  const key = s.key ?? "weight";
  const excluded = key === "weight" ? members.filter((sku) => modelRowSkus.has(sku)) : [];
  const kept = members.filter((sku) => !excluded.includes(sku));
  report.push(`${s.family.slice(0, 60).padEnd(60)} ${s.raw.padEnd(17)} ${linked.length} linked, ${members.length} in the group, ${excluded.length} with a model row (${excluded.join(" ") || "-"}): ${kept.join(" ")}`);
  for (const sku of kept) rows.push({ sku, key, doc_id: docId, url: s.url, cache_path: cacheFile(s.url), doc_type: s.doc_type, label: s.label,
    locator: `${s.family} / ${s.label}`, raw: s.raw, statement: s.statement, method: "derived:family-row", family: s.family, group: groupNote, listed_by: null });
}
await closePool();
const body = JSON.stringify({ ruling: "reviewer 6 Oct 2026 ~22:50, Q1 + Q4: derived:family-row -- a family's stated value onto each PID the same sheet lists under that family",
  sources: SOURCES.map((s) => ({ ...s, pids: s.pids?.source ?? null })), rows }, null, 2) + "\n";
for (const r of report) console.log(r);
console.log(`${rows.length} witness rows over ${new Set(rows.map((r) => r.sku)).size} PIDs`);
if (process.argv.includes("--check")) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
  if (now !== body) { console.error(`--check: ${path.relative(ROOT, OUT)} differs from a fresh read of the cache`); process.exit(1); }
  console.log(`--check: ${path.relative(ROOT, OUT)} reproduces`);
} else {
  fs.writeFileSync(OUT, body);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
