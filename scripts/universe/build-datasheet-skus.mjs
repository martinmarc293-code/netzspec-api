// scripts/universe/build-datasheet-skus.mjs
//
//   node scripts/universe/build-datasheet-skus.mjs [--out <file>] [--limit N]
//
// Rebuild the datasheet -> SKU ground-truth map across the WHOLE cached corpus.
//
// WHY
// The deep-spec extractor works by matching a datasheet's table rows against the list of
// SKUs that datasheet is known to cover -- the keystone that stops it needing a PID regex
// per category. But that map (data/universe/datasheet-skus.json) only ever covered 3,169
// documents, while the cache holds 9,428 HTML documents and climbing. 6,259 cached
// documents, including 2,691 datasheet-like collateral pages, had never been mined for SKUs
// or specs at all. That, not Cisco's publishing, is why spec coverage sat at 7.3%.
//
// HOW, without repeating the regex mistake
// scraper/adapters/cisco_datasheets.py matches PIDs with a hand-written HW_PID regex that
// only understands Catalyst, Nexus, ISR and ASR shapes. Broadening it by hand is exactly
// what the keystone note forbids: Cisco PIDs are wildly heterogeneous and mixed in with
// licence and accessory SKUs, so every widening either misses real hardware or swallows junk.
//
// So this does the inverse and needs no PID pattern at all. We already KNOW 89,090 part
// numbers. Tokenise each document into candidate identifier-shaped strings and look each one
// up in that set. A hit is exact by construction -- no shape is ever guessed -- and it is
// fast: one hash lookup per token rather than 89,090 searches per document.
//
// Cisco writes the same part several ways (trailing "=" for spares, "++" for a term variant,
// "/K9" suffixes), so lookups are tried against a small set of normalised forms.
//
// Output: datasheet_url -> [sku], plus a report of what the corpus now reaches.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MongoClient } from "mongodb";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, "scraper", "cache");
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 ? process.argv[outArg + 1]
  : path.join(ROOT, "data", "universe", "datasheet-skus-full.json");

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

// Identifier-shaped tokens. Deliberately permissive: this only produces CANDIDATES, and the
// known-SKU set is what decides. It must stay permissive for a specific reason -- Cisco
// Meraki ships real devices called Z4, MV2 and MR4, and a minimum-length rule once deleted
// six of them. Anything not in the set is simply dropped, so breadth costs nothing.
const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9./+-]{1,39}=?/g;

// The forms Cisco writes the same part in.
function variants(tok) {
  const t = tok.toUpperCase().replace(/[.,;:)\]]+$/, "");
  const out = new Set([t]);
  if (t.endsWith("=")) out.add(t.slice(0, -1)); else out.add(t + "=");
  if (t.endsWith("++")) out.add(t.slice(0, -2));
  const rf = t.replace(/^C1-/, "");
  if (rf !== t) out.add(rf);
  return out;
}

const stripTags = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ");

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const parts = client.db(env.MONGODB_DB || "netzspec").collection("parts");
  const known = new Map();          // UPPER form -> canonical sku
  const specced = new Set();
  for await (const p of parts.find({}, { projection: { sku: 1, specs_v2: 1 } })) {
    if (!p.sku) continue;
    known.set(String(p.sku).toUpperCase(), p.sku);
    if (Array.isArray(p.specs_v2) && p.specs_v2.length) specced.add(p.sku);
  }
  await client.close();
  console.log(`known SKUs: ${known.size} (${specced.size} already specced)`);

  // Every cached HTML document, not the 3,169 the old map covered.
  const urls = new Set();
  for (const line of fs.readFileSync(path.join(ROOT, "scraper", "ledger.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.url && !r.binary) urls.add(r.url); } catch { /* partial */ }
  }
  const list = [...urls].slice(0, limit === Infinity ? undefined : limit);
  console.log(`cached documents to scan: ${list.length}`);

  const map = {};
  const stat = { scanned: 0, withSkus: 0, pairs: 0, docsNew: 0 };
  const old = fs.existsSync(path.join(ROOT, "data/universe/datasheet-skus.json"))
    ? new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/datasheet-skus.json"), "utf8"))))
    : new Set();
  const reachedSkus = new Set();

  for (const url of list) {
    const f = path.join(CACHE, sha1(url) + ".html");
    if (!fs.existsSync(f)) continue;
    stat.scanned++;
    let text;
    try { text = stripTags(fs.readFileSync(f, "utf8")); } catch { continue; }

    const hits = new Set();
    for (const m of text.matchAll(TOKEN_RE)) {
      const tok = m[0];
      // cheap pre-filter: a Cisco PID has at least one digit or is short and all-caps
      if (!/\d/.test(tok) && tok.length > 6) continue;
      for (const v of variants(tok)) {
        const sku = known.get(v);
        if (sku) { hits.add(sku); break; }
      }
    }
    if (hits.size) {
      map[url] = [...hits];
      stat.withSkus++;
      stat.pairs += hits.size;
      if (!old.has(url)) stat.docsNew++;
      for (const s of hits) reachedSkus.add(s);
    }
    if (stat.scanned % 1000 === 0) {
      console.log(`  ${stat.scanned}/${list.length}  docs-with-skus=${stat.withSkus}  skus-reached=${reachedSkus.size}`);
    }
  }

  const unspeccedReached = [...reachedSkus].filter((s) => !specced.has(s)).length;
  fs.writeFileSync(OUT, JSON.stringify(map, null, 0));

  console.log(`\nscanned ${stat.scanned} documents`);
  console.log(`documents carrying at least one known SKU: ${stat.withSkus} (${stat.docsNew} of them NEW to the map)`);
  console.log(`document->SKU pairs: ${stat.pairs}`);
  console.log(`distinct SKUs reachable from a document: ${reachedSkus.size} of ${known.size}`);
  console.log(`  of which NOT yet specced: ${unspeccedReached}`);
  console.log(`\nwrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
