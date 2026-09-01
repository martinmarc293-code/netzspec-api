// scripts/universe/icecat-import.mjs — enrich/ingest parts from the Icecat JSON API (Open + Full).
// Icecat returns ~50 structured, LOCALIZED features per product, so we pull German specs natively
// (lang=de) — the completeness lever. Auth: ICECAT_USERNAME + ICECAT_APP_KEY from .env.local.
// Free (Open) tier covers SMB brands (TP-Link…); Cisco/HPE need Full Icecat (reseller authorization
// or paid) — the SAME code works the moment the account is upgraded.
//
//   node scripts/universe/icecat-import.mjs --test "TP-Link" TL-SG108     # fetch+map+print, no DB
//   node scripts/universe/icecat-import.mjs --vendor cisco [--limit N] [--commit]   # enrich our parts
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const USER = env.ICECAT_USERNAME, KEY = env.ICECAT_APP_KEY;
if (!USER || !KEY) { console.error("missing ICECAT_USERNAME / ICECAT_APP_KEY in .env.local"); process.exit(2); }
// map Icecat brand names to our vendor slugs (Icecat uses its own casing)
const BRAND = { cisco: "Cisco", hpe: "HPE", aruba: "HPE", juniper: "Juniper", arista: "Arista", "dell-emc": "Dell", netgear: "NETGEAR", "tp-link": "TP-Link" };
const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(brand, code, lang = "de") {
  const url = `https://live.icecat.biz/api/?UserName=${enc(USER)}&app_key=${enc(KEY)}&lang=${lang}&Brand=${enc(brand)}&ProductCode=${enc(code)}`;
  let j;
  try { j = await (await fetch(url)).json(); } catch (e) { return { error: "fetch:" + String(e).slice(0, 40) }; }
  if (j.Code || j.StatusCode) return { error: `${j.Code || j.StatusCode} ${j.Error || ""}`.trim() };
  const d = j.data || j; const g = d.GeneralInfo || {};
  const specs = [];
  const seen = new Set();
  for (const grp of d.FeaturesGroups || []) for (const f of grp.Features || []) {
    const name = f.Feature?.Name?.Value, val = f.PresentationValue;
    if (name && val && !seen.has(name)) { seen.add(name); specs.push({ name, value: String(val).slice(0, 120) }); }
  }
  return { sku: code, icecatId: g.IcecatId, brand: g.Brand?.Value || g.Brand, title: g.Title,
           category: g.Category?.Name?.Value, specs };
}

const TEST = process.argv.includes("--test");
const COMMIT = process.argv.includes("--commit");

if (TEST) {
  const i = process.argv.indexOf("--test");
  const [brand, code] = [process.argv[i + 1], process.argv[i + 2]];
  const r = await fetchOne(brand, code, "de");
  if (r.error) console.log("ERROR:", r.error);
  else { console.log(`${r.sku} (Icecat ${r.icecatId}) — ${r.title}\ncategory: ${r.category} | ${r.specs.length} German specs`);
    for (const s of r.specs.slice(0, 16)) console.log(`  ${s.name}: ${s.value}`); }
  process.exit(0);
}

// --vendor mode: iterate our parts, enrich with Icecat specs
const vi = process.argv.indexOf("--vendor");
const vendor = vi >= 0 ? process.argv[vi + 1] : null;
const li = process.argv.indexOf("--limit");
const limit = li >= 0 ? parseInt(process.argv[li + 1], 10) : 200;
if (!vendor) { console.error("usage: --test <brand> <code>  OR  --vendor <slug> [--limit N] [--commit]"); process.exit(2); }
const icBrand = BRAND[vendor] || vendor;

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const P = client.db(env.MONGODB_DB || "netzspec").collection("parts");
const parts = await P.find({ vendor, "i18n.de.attributes.11": { $exists: false } }, { projection: { sku: 1, "i18n.de": 1, _id: 0 } }).limit(limit).toArray();
console.log(`Icecat enrich: ${parts.length} under-specced ${vendor} parts (brand "${icBrand}")`);
let ok = 0, forbidden = 0, notfound = 0;
for (const p of parts) {
  const r = await fetchOne(icBrand, p.sku, "de");
  await sleep(250); // polite
  if (r.error) { if (/403/.test(r.error)) forbidden++; else if (/404/.test(r.error)) notfound++; continue; }
  if (r.specs.length < 8) { notfound++; continue; }
  ok++;
  if (COMMIT) await P.updateOne({ sku: p.sku }, { $set: { "i18n.de.attributes": r.specs, "i18n.en.attributes": r.specs, spec_source: "icecat", icecat_id: r.icecatId } });
  if (ok <= 3) console.log(`  ${p.sku}: ${r.specs.length} specs`);
}
console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN"} — enriched ${ok} | forbidden(Full-only) ${forbidden} | not-found/thin ${notfound}`);
if (forbidden > 0) console.log("→ 403s mean this brand needs Full Icecat (reseller authorization or upgrade).");
await client.close();
