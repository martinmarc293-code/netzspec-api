// scripts/universe/classify-datasheets.mjs
//
//   node scripts/universe/classify-datasheets.mjs [--limit N]
//
// WHY THIS EXISTS
// The 2026-09-02 LLM pilot sampled 6 datasheets at random and 4 of them were software /
// licensing / ordering documents that contain no hardware facts at all (NCS 5500 perpetual
// licenses, IOS XR Flexible Consumption, Security Cloud Control). The agents correctly
// refused to invent specs, but two thirds of the spend bought nothing. Sampling randomly
// across 3,272 datasheets would repeat that at scale.
//
// So: classify every datasheet ONCE, deterministically, from the cached HTML we already
// hold, and rank the hardware ones by how much they would actually add — SKUs that exist
// in our DB and still have no specs. The LLM then only ever reads documents that can pay.
//
// Output: data/universe/datasheet-classes.json
//   { generated_at, counts, sheets: [ { url, klass, title, cached, skus, in_db,
//                                       missing_specs, current, eol, facts, hw_facts, yield } ] }
//
// `yield` = SKUs in our DB, covered by this datasheet, that carry no specs today. Ranking
// by it puts the highest-payoff documents first; a sheet with yield 0 is never worth reading.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MongoClient } from "mongodb";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, "scraper", "cache");
const OUT = path.join(ROOT, "data", "universe", "datasheet-classes.json");

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const cacheFile = (url) => {
  const h = sha1(url);
  for (const ext of [".html", ".txt", ".bin", ".pdf", ""]) {
    const p = path.join(CACHE, h + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Classification. Ordered: the first rule that matches wins, so the cheap
// unambiguous signals (EoL notice, licence document) are tested before the
// fallback that assumes "hardware datasheet".
// ---------------------------------------------------------------------------
const EOL_RE = /end[- ]of[- ](sale|life|support)|eos[-_ ]?eol|eol[-_ ]?notice|discontinu/i;
const LICENCE_RE = /\b(licens|subscription|smart net|enterprise agreement|flexible consumption|service contract|software support|term[- ]based|entitlement|saas|as[- ]a[- ]service|renewal)\b/i;
const SOFTWARE_RE = /\b(software|ios xr|ios[- ]xe|nx[- ]os|firmware|application|controller software|management software|cloud[- ]delivered)\b/i;
const NONSHEET_RE = /\b(white paper|q&a|faq|frequently asked|at[- ]a[- ]glance|solution overview|ordering guide|migration guide|design guide|deployment guide|case study|brochure|infographic|bulletin|advisory|release note)\b/i;

// URL path fragments Cisco uses for the same document families.
const URL_NONSHEET_RE = /\/(qa|q-and-a|white[-_]paper|wp|aag|at-a-glance|solution-overview|ordering-guide|guide)[-_.]|[-_](wp|qa|aag|og)\.html$/i;
const URL_EOL_RE = /eos[-_]eol|end-of-life|end-of-sale|eol[-_]/i;

// Labels that only ever appear in a real hardware spec table. Used as corroboration:
// a document producing several of these is a hardware datasheet whatever its title says.
const HW_LABEL_RE = /\b(dimension|weight|height|width|depth|rack unit|operating temperature|storage temperature|humidity|mtbf|power consumption|input voltage|heat dissipation|btu|airflow|switching capacity|forwarding rate|throughput|latency|port|interface|dram|flash|memory|wavelength|reach|data rate|connector|fiber|cable type|poe|acoustic|certification|compliance|mean time between)\b/i;

// PID shapes that are licences/services rather than hardware, so a datasheet whose SKUs
// are ALL of this shape has no hardware to describe regardless of its prose.
const LICENCE_PID_RE = /^(CON-|SVS-|SVC-|E2N-|EDU-|LIC-|L-|SW-|SL-|SUB-|SMS-|PSS-|DNA-|ISE-|ESA-|WSA-|FL-|SF-|SL[0-9])|(-LIC|-SUB|-SUBS|-NCE|-RTU|-SIA[0-9]?|-TERM|-1Y|-3Y|-5Y|-7Y|-10Y|-NY)(=)?$/i;

function classify({ title, url, skus, hwFacts, facts }) {
  const t = title || "";
  const licencePids = skus.length ? skus.filter((s) => LICENCE_PID_RE.test(s)).length / skus.length : 0;

  if (EOL_RE.test(t) || URL_EOL_RE.test(url)) return "eol_bulletin";
  if (NONSHEET_RE.test(t) || URL_NONSHEET_RE.test(url)) return "non_datasheet";
  if (LICENCE_RE.test(t)) return "licence";
  // All-licence SKU list with no hardware labels: a licence document that doesn't say so.
  if (licencePids > 0.9 && hwFacts < 5) return "licence";
  if (SOFTWARE_RE.test(t) && hwFacts < 5) return "software";
  // The corroborating signal — real spec tables — outranks a vague title.
  if (hwFacts >= 5) return "hw_datasheet";
  if (facts === 0) return "empty";
  return "thin";
}

// ---------------------------------------------------------------------------
function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]{0,400}?)<\/title>/i);
  if (!m) return "";
  return m[1].replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/\s+/g, " ").trim().replace(/\s*-\s*Cisco\s*$/i, "");
}

async function main() {
  const limit = process.argv.includes("--limit")
    ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;

  const skuMap = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/datasheet-skus.json"), "utf8"));
  const urls = Object.keys(skuMap).slice(0, limit === Infinity ? undefined : limit);
  console.log(`datasheets: ${urls.length}`);

  // fact profile per source_url, streamed out of the big extraction
  const factsByUrl = new Map(); // url -> { facts, hwFacts }
  const extractPath = path.join(ROOT, "data/universe/cisco-specs-deep_2026-09-02.json");
  if (fs.existsSync(extractPath)) {
    const raw = JSON.parse(fs.readFileSync(extractPath, "utf8"));
    for (const r of raw.records || []) {
      const e = factsByUrl.get(r.source_url) || { facts: 0, hwFacts: 0 };
      e.facts++;
      if (HW_LABEL_RE.test(r.label || "")) e.hwFacts++;
      factsByUrl.set(r.source_url, e);
    }
    console.log(`fact profile built for ${factsByUrl.size} urls`);
  } else {
    console.log("! no extraction file — classifying on title/URL/PID signals only");
  }

  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const parts = client.db(env.MONGODB_DB || "netzspec").collection("parts");

  // one pass over the DB rather than 3,272 queries
  const known = new Map(); // sku(upper) -> { specced, eol }
  const cursor = parts.find({}, { projection: { sku: 1, specs_v2: 1, "lifecycle.end_of_sale_date": 1 } });
  for await (const p of cursor) {
    if (!p.sku) continue;
    known.set(String(p.sku).toUpperCase(), {
      specced: Array.isArray(p.specs_v2) && p.specs_v2.length > 0,
      eol: Boolean(p.lifecycle && p.lifecycle.end_of_sale_date),
    });
  }
  console.log(`db parts indexed: ${known.size}`);
  await client.close();

  const sheets = [];
  let noCache = 0;
  for (const url of urls) {
    const skus = (skuMap[url] || []).map((s) => String(s));
    const cf = cacheFile(url);
    let title = "";
    if (cf) {
      try { title = titleOf(fs.readFileSync(cf, "utf8")); } catch { /* binary/pdf */ }
    } else noCache++;

    const prof = factsByUrl.get(url) || { facts: 0, hwFacts: 0 };
    const klass = classify({ title, url, skus, hwFacts: prof.hwFacts, facts: prof.facts });

    let inDb = 0, missing = 0, current = 0, eol = 0;
    for (const s of skus) {
      const rec = known.get(s.toUpperCase());
      if (!rec) continue;
      inDb++;
      if (!rec.specced) missing++;
      if (rec.eol) eol++; else current++;
    }
    sheets.push({
      url, klass, title, cached: Boolean(cf), skus: skus.length,
      in_db: inDb, missing_specs: missing, current, eol,
      facts: prof.facts, hw_facts: prof.hwFacts,
      yield: missing,
    });
  }

  sheets.sort((a, b) => b.yield - a.yield);
  const counts = {};
  const yieldByClass = {};
  for (const s of sheets) {
    counts[s.klass] = (counts[s.klass] || 0) + 1;
    yieldByClass[s.klass] = (yieldByClass[s.klass] || 0) + s.yield;
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: "2026-09-02", counts, yield_by_class: yieldByClass, sheets,
  }, null, 1));

  console.log(`\nuncached: ${noCache}`);
  console.log("\nclass                 sheets    SKUs-needing-specs");
  for (const k of Object.keys(counts).sort((a, b) => yieldByClass[b] - yieldByClass[a])) {
    console.log(`  ${k.padEnd(18)} ${String(counts[k]).padStart(6)} ${String(yieldByClass[k]).padStart(20)}`);
  }
  const hw = sheets.filter((s) => s.klass === "hw_datasheet");
  const cum = [];
  let run = 0;
  const totalHwYield = hw.reduce((n, s) => n + s.yield, 0);
  for (const s of hw) { run += s.yield; cum.push(run); }
  const at = (pct) => cum.findIndex((v) => v >= totalHwYield * pct) + 1;
  console.log(`\nhardware datasheets: ${hw.length}, covering ${totalHwYield} un-specced SKUs`);
  console.log(`  top ${at(0.5)} sheets reach 50% of that yield`);
  console.log(`  top ${at(0.8)} sheets reach 80%`);
  console.log(`  top ${at(0.95)} sheets reach 95%`);
  console.log(`\nwrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
