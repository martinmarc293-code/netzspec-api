// scripts/universe/extract-descriptions.mjs
//
//   node scripts/universe/extract-descriptions.mjs [--limit N]
//
// Recover a real PRODUCT DESCRIPTION for every part number, from the documents already in
// scraper/cache. No network, no LLM.
//
// WHY THIS IS THE HIGHEST-VALUE PASS
// Every one of the 89,090 parts in the DB has an EMPTY name and an EMPTY description. The
// enumeration captured only the PID column of each ordering table and threw the adjacent
// description cell away; the EoL sweep captured pid + successor and threw away both the
// product description AND the replacement's description. So a catalog page today renders a
// bare SKU — the textbook definition of thin — and no amount of spec work fixes that for
// the 63,664 parts whose only source is an EoL bulletin.
//
// The text was never missing. It is sitting in the cache, in tables that look like:
//
//   EoL bulletin, Table 2:
//     End-of-Sale Product Part Number | Product Description | Migration Product Part Number
//       | Migration Product Description | Additional Information
//   Datasheet ordering table:
//     Product ID (PID) | Description
//
// So: find any table carrying a part-number column and a description column, and read both.
// The replacement columns are worth as much as the description — they turn "successor:
// C9300-48P" into "replaced by the Cisco Catalyst 9300 48-port PoE+ switch", which is what
// makes a dead part's page answer „was ersetzt X".
//
// SAFETY: a description is only kept for a SKU that already exists in our DB. The tables
// contain plenty of PIDs we do not stock and plenty of cells that are not PIDs at all, and
// matching against the DB is a far better filter than any shape heuristic. In particular we
// do NOT filter by PID length — Cisco Meraki ships real devices called Z4, MV2 and MR4, and
// a length rule deleted six of them once already.
//
// Output: data/reference/part-descriptions.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MongoClient } from "mongodb";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, "scraper", "cache");
const OUT = path.join(ROOT, "data", "universe", "part-descriptions.json");

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

// --- header matching -------------------------------------------------------
// Order matters. "End-of-Sale Product Part Number" contains the word "Product", so the
// part-number test has to run first or a PID column gets read as a description column.
const PID_HEAD = /(part\s*(number|no|#)|product\s*id|\bpid\b|\bsku\b|model\s*(number|name)?|ordering\s*(information|code|number)|product\s*number)/i;
const DESC_HEAD = /(description|product\s*name|^name$|^product$|nomenclature)/i;
const REPL_PID_HEAD = /(migration|replacement|recommended\s*replacement).*(part\s*number|product\s*id|pid)/i;
const REPL_DESC_HEAD = /(migration|replacement|recommended\s*replacement).*(description|product\s*name)/i;

// Cells that are present but say nothing.
const EMPTY_CELL = /^(-{1,3}|n\/?a|none|tbd|not applicable|\.|,)?$/i;
const NO_MIGRATION = /there is currently no (migration|replacement) product available/i;

const clean = (s) => s
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&[a-z]+;/gi, " ")
  .replace(/\s+/g, " ").trim();

// A real <table> scan. Regex with a size cap silently drops the long tables, which are
// exactly the ones holding hundreds of PIDs — the first attempt at this missed a 40-row
// affected-products table entirely because of a {0,60000} bound.
function tablesIn(html) {
  const out = [];
  let pos = 0;
  for (;;) {
    const m = /<table[^>]*>/i.exec(html.slice(pos));
    if (!m) break;
    const start = pos + m.index;
    const end = html.indexOf("</table>", start);
    if (end < 0) break;
    out.push(html.slice(start, end + 8));
    pos = end + 8;
  }
  return out;
}
const rowsIn = (t) => [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
const cellsIn = (r) => [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => clean(m[1]));

function columnsOf(headerCells) {
  let pid = -1, desc = -1, rpid = -1, rdesc = -1;
  headerCells.forEach((h, i) => {
    if (REPL_PID_HEAD.test(h)) { if (rpid < 0) rpid = i; return; }
    if (REPL_DESC_HEAD.test(h)) { if (rdesc < 0) rdesc = i; return; }
    if (PID_HEAD.test(h)) { if (pid < 0) pid = i; return; }
    if (DESC_HEAD.test(h)) { if (desc < 0) desc = i; }
  });
  return { pid, desc, rpid, rdesc };
}

function harvestTable(t) {
  const rows = rowsIn(t);
  if (rows.length < 2) return [];
  // The header is not always row 0 — some Cisco tables open with a spanning title row.
  let hdr = -1, cols = null;
  for (let i = 0; i < Math.min(4, rows.length); i++) {
    const c = cellsIn(rows[i]);
    if (c.length < 2) continue;
    const got = columnsOf(c);
    if (got.pid >= 0 && got.desc >= 0) { hdr = i; cols = got; break; }
  }
  if (hdr < 0) return [];
  const out = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const c = cellsIn(rows[i]);
    if (c.length <= Math.max(cols.pid, cols.desc)) continue;
    const pid = c[cols.pid];
    const desc = c[cols.desc];
    if (!pid || EMPTY_CELL.test(pid)) continue;
    if (!desc || EMPTY_CELL.test(desc)) continue;
    if (desc.toUpperCase() === pid.toUpperCase()) continue;   // a repeated PID is not a description
    if (desc.length < 4 || desc.length > 400) continue;
    const rec = { pid, desc };
    if (cols.rpid >= 0 && c[cols.rpid] && !EMPTY_CELL.test(c[cols.rpid]) && !NO_MIGRATION.test(c[cols.rpid])) {
      rec.rpid = c[cols.rpid];
    }
    if (cols.rdesc >= 0 && c[cols.rdesc] && !EMPTY_CELL.test(c[cols.rdesc]) && !NO_MIGRATION.test(c[cols.rdesc])) {
      rec.rdesc = c[cols.rdesc];
    }
    out.push(rec);
  }
  return out;
}

// Prefer the description that tells a reader more, but never a sentence of boilerplate over
// a real product name: cap the preference at a sane length so a footnote cannot win.
function better(a, b) {
  if (!a) return b;
  if (!b) return a;
  const score = (s) => (s.length > 200 ? 200 - (s.length - 200) : s.length);
  return score(b.desc) > score(a.desc) ? b : a;
}

async function main() {
  const limit = process.argv.includes("--limit")
    ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;

  // Every cisco.com document we have ever cached, not just the 3,272 with a SKU map: the
  // description for a part often lives in a bulletin that the datasheet map never linked.
  const urls = new Set();
  for (const line of fs.readFileSync(path.join(ROOT, "scraper", "ledger.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.url && !r.binary) urls.add(r.url);
    } catch { /* partial line */ }
  }
  const list = [...urls].slice(0, limit === Infinity ? undefined : limit);
  console.log(`cached html documents: ${list.length}`);

  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const parts = client.db(env.MONGODB_DB || "netzspec").collection("parts");
  const known = new Map();  // UPPER(sku) -> sku as stored
  for await (const p of parts.find({}, { projection: { sku: 1 } })) {
    if (p.sku) known.set(String(p.sku).toUpperCase(), p.sku);
  }
  await client.close();
  console.log(`db skus: ${known.size}`);

  const found = new Map();   // sku -> {description, source_url, replacement_pid?, replacement_desc?}
  const stat = { docs: 0, docsWithTable: 0, rows: 0, matched: 0, repl: 0, unmatchedPids: 0 };

  for (const url of list) {
    const f = path.join(CACHE, sha1(url) + ".html");
    if (!fs.existsSync(f)) continue;
    stat.docs++;
    let html;
    try { html = fs.readFileSync(f, "utf8"); } catch { continue; }
    if (!/<table/i.test(html)) continue;

    let hit = false;
    for (const t of tablesIn(html)) {
      for (const r of harvestTable(t)) {
        stat.rows++;
        const sku = known.get(r.pid.toUpperCase());
        if (!sku) { stat.unmatchedPids++; continue; }
        hit = true;
        stat.matched++;
        const rec = { sku, desc: r.desc, source_url: url };
        if (r.rpid) {
          rec.replacement_pid = r.rpid;
          if (r.rdesc) rec.replacement_desc = r.rdesc;
          stat.repl++;
        }
        found.set(sku, better(found.get(sku), rec));
      }
    }
    if (hit) stat.docsWithTable++;
    if (stat.docs % 1000 === 0) {
      console.log(`  ${stat.docs}/${list.length} docs · ${found.size} skus described`);
    }
  }

  const obj = {};
  for (const [sku, r] of found) obj[sku] = r;
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: "2026-09-02", stat, descriptions: obj }, null, 1));

  console.log("\n" + JSON.stringify(stat, null, 2));
  console.log(`\nSKUs with a description: ${found.size} of ${known.size} (${(100 * found.size / known.size).toFixed(1)}%)`);
  console.log(`wrote ${OUT}`);

  const sample = [...found.values()].slice(0, 8);
  console.log("\nsample:");
  for (const s of sample) {
    console.log(`  ${s.sku.padEnd(24)} ${s.desc.slice(0, 68)}`);
    if (s.replacement_pid) console.log(`  ${"".padEnd(24)} -> ${s.replacement_pid}: ${(s.replacement_desc || "").slice(0, 55)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
