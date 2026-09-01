// scripts/universe/icecat-import.ts — WP8. Replaces icecat-import.mjs.
//
//   npx tsx scripts/universe/icecat-import.ts --test "TP-Link" TL-SG108   fetch + show STRUCTURE
//   npx tsx scripts/universe/icecat-import.ts --vendor cisco [--limit N] [--commit]
//
// Two defects in the previous version, both of which would have done real damage on the day the
// operator's Full-Icecat authorization lands:
//
//   1. FLATTENING (the D5 finding). It reduced FeaturesGroups[].Features[] to {name, value},
//      discarding the group, the Icecat FEATURE ID — the stable cross-language join key — the
//      measure/unit sign, and the raw value in favour of the presentation string, then
//      de-duplicated on DISPLAY NAME. We would have ingested ~50 fields and thrown away
//      everything that makes them machine-usable and gap-measurable.
//
//   2. It OVERWROTE `i18n.de.attributes` wholesale with the Icecat payload. That array is the
//      operator-reviewed HexCat data — the only tier-0 spec data in the system, and the source
//      the 236 staged pages render from. A tier-3 aggregator silently replacing tier-0 reviewed
//      content is a direct breach of constraint 6.
//
// This version preserves the full structure, writes to specs_v2 at TIER 3 through the same merge
// engine as everything else (so operator-reviewed values are physically unwritable by this path),
// and never touches i18n.de.attributes.
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { normalizeField } from "../../lib/specNormalize.js";
import { mergeField, type SpecEntry } from "../../lib/specMerge.js";

const root = process.cwd();
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const USER = env.ICECAT_USERNAME, KEY = env.ICECAT_APP_KEY;
if (!USER || !KEY) { console.error("missing ICECAT_USERNAME / ICECAT_APP_KEY in .env.local"); process.exit(2); }

const BRAND: Record<string, string> = { cisco: "Cisco", hpe: "HPE", aruba: "HPE", juniper: "Juniper",
  arista: "Arista", "dell-emc": "Dell", netgear: "NETGEAR", "tp-link": "TP-Link" };
const COMMIT = process.argv.includes("--commit");
const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAP_PATH = path.join(root, "data/schema/icecat-feature-map.json");
const featureMap: Record<string, string> = fs.existsSync(MAP_PATH)
  ? JSON.parse(fs.readFileSync(MAP_PATH, "utf8")).features || {} : {};

/** One Icecat feature, with every part of it kept. */
type IcecatFeature = {
  group: string;
  feature_id: string | number | null;   // the stable join key — NEVER the display name
  local_id: string | number | null;
  name: string;
  raw_value: string;                    // Value: the machine value
  presentation: string;                 // PresentationValue: value + unit, localised
  unit: string | null;                  // Measure.Signs — the unit, which the old version dropped
};

async function fetchOne(brand: string, code: string, lang = "de") {
  const url = `https://live.icecat.biz/api/?UserName=${enc(USER!)}&app_key=${enc(KEY!)}` +
    `&lang=${lang}&Brand=${enc(brand)}&ProductCode=${enc(code)}`;
  let j: Record<string, unknown>;
  try {
    const res = await fetch(url);
    j = await res.json() as Record<string, unknown>;
  } catch (e) { return { error: "fetch:" + String(e).slice(0, 60) }; }
  if (j.Code || j.StatusCode) {
    return { error: `${j.Code || j.StatusCode} ${String(j.Error || "")}`.trim() };
  }
  const d = (j.data || j) as Record<string, unknown>;
  const g = (d.GeneralInfo || {}) as Record<string, unknown>;
  const features: IcecatFeature[] = [];
  const seen = new Set<string>();
  for (const grp of (d.FeaturesGroups || []) as Record<string, unknown>[]) {
    const groupName = String(((grp.FeatureGroup as Record<string, unknown>)?.Name as Record<string, unknown>)?.Value
      ?? (grp.Name as Record<string, unknown>)?.Value ?? grp.Name ?? "");
    for (const f of (grp.Features || []) as Record<string, unknown>[]) {
      const feat = (f.Feature || {}) as Record<string, unknown>;
      const id = (feat.ID ?? feat.Id ?? f.LocalID ?? null) as string | number | null;
      const name = String((feat.Name as Record<string, unknown>)?.Value ?? feat.Name ?? "");
      // de-duplicate on the FEATURE ID, not the display name. Two distinct Icecat features can
      // share a localised label; collapsing them on the label silently loses one of them.
      const dedupe = String(id ?? `name:${name}`);
      if (!name || seen.has(dedupe)) continue;
      seen.add(dedupe);
      const measure = (feat.Measure || {}) as Record<string, unknown>;
      const signs = measure.Signs as Record<string, unknown> | undefined;
      features.push({
        group: groupName,
        feature_id: (feat.ID ?? null) as string | number | null,
        local_id: (f.LocalID ?? null) as string | number | null,
        name,
        raw_value: String(f.Value ?? ""),
        presentation: String(f.PresentationValue ?? ""),
        unit: signs ? String((signs as { Value?: unknown }).Value ?? Object.values(signs)[0] ?? "") || null : null,
      });
    }
  }
  return {
    sku: code, icecatId: g.IcecatId, brand: (g.Brand as Record<string, unknown>)?.Value ?? g.Brand,
    title: g.Title, category: ((g.Category as Record<string, unknown>)?.Name as Record<string, unknown>)?.Value,
    gtin: g.GTIN ?? null, features,
  };
}

async function main() {
  // ---- --test: prove the structure survives ---------------------------------------------------
  if (process.argv.includes("--test")) {
    const i = process.argv.indexOf("--test");
    const [brand, code] = [process.argv[i + 1], process.argv[i + 2]];
    const r = await fetchOne(brand, code, "de");
    if ("error" in r) { console.log("ERROR:", r.error); process.exit(1); }
    console.log(`${r.sku} (Icecat ${r.icecatId}) — ${r.title}`);
    console.log(`category: ${r.category} | GTIN: ${r.gtin} | ${r.features.length} features\n`);
    console.log("group                     | feature_id | unit   | name                      | raw -> presentation");
    console.log("-".repeat(124));
    for (const f of r.features.slice(0, 24)) {
      console.log(`${String(f.group).slice(0, 25).padEnd(25)} | ${String(f.feature_id ?? "-").padEnd(10)} | ` +
        `${String(f.unit ?? "-").slice(0, 6).padEnd(6)} | ${f.name.slice(0, 25).padEnd(25)} | ` +
        `${f.raw_value.slice(0, 18)} -> ${f.presentation.slice(0, 26)}`);
    }
    const withId = r.features.filter((f) => f.feature_id != null).length;
    const withUnit = r.features.filter((f) => f.unit).length;
    const groups = new Set(r.features.map((f) => f.group)).size;
    console.log(`\nstructure retained: ${groups} groups | ${withId}/${r.features.length} with a feature_id | ` +
      `${withUnit}/${r.features.length} with a unit | raw and presentation both kept`);
    const mapped = r.features.filter((f) => featureMap[String(f.feature_id)]).length;
    console.log(`feature-ID -> field_key map: ${mapped}/${r.features.length} mapped ` +
      `(${Object.keys(featureMap).length} entries in data/schema/icecat-feature-map.json)`);
    if (mapped === 0) {
      console.log("→ the map is empty until the Icecat reference files can be pulled ([OPERATOR] credentials).");
      console.log("  Unmapped feature-IDs are a NAMED backlog, never guessed into a field_key.");
    }
    process.exit(0);
  }

  // ---- --vendor: enrich ------------------------------------------------------------------------
  const vi = process.argv.indexOf("--vendor");
  const vendor = vi >= 0 ? process.argv[vi + 1] : null;
  const li = process.argv.indexOf("--limit");
  const limit = li >= 0 ? parseInt(process.argv[li + 1], 10) : 200;
  if (!vendor) { console.error('usage: --test <brand> <code>  OR  --vendor <slug> [--limit N] [--commit]'); process.exit(2); }
  const icBrand = BRAND[vendor] || vendor;

  const client = new MongoClient(env.MONGODB_URI as string, { serverSelectionTimeoutMS: 30000, retryReads: true });
  await client.connect();
  const P = client.db(env.MONGODB_DB as string).collection("parts");
  const parts = await P.find({ vendor }, { projection: { sku: 1, category: 1, specs_v2: 1, _id: 0 } })
    .limit(limit).toArray();
  console.log(`Icecat enrich: ${parts.length} ${vendor} parts (brand "${icBrand}")`);

  let ok = 0, forbidden = 0, notfound = 0, wrote = 0, protectedCount = 0, conflicts = 0, unmapped = 0;
  const backlog: Record<string, { name: string; count: number }> = {};

  for (const p of parts) {
    const r = await fetchOne(icBrand, String(p.sku), "de");
    await sleep(250); // polite
    if ("error" in r) {
      if (/403/.test(r.error!)) forbidden++; else if (/404/.test(r.error!)) notfound++;
      continue;
    }
    ok++;
    const existing: SpecEntry[] = (p.specs_v2 as SpecEntry[]) || [];
    const byKey = new Map(existing.map((s) => [s.k, s]));
    const additions: SpecEntry[] = [];
    for (const f of r.features) {
      const key = featureMap[String(f.feature_id)];
      if (!key) {
        unmapped++;
        const id = String(f.feature_id ?? f.name);
        backlog[id] = { name: f.name, count: (backlog[id]?.count || 0) + 1 };
        continue;
      }
      const norm = normalizeField(String(p.category), key, f.presentation || f.raw_value, { locale: "de" });
      if (!norm.ok) continue;
      const incoming: SpecEntry = {
        k: key, raw: f.presentation || f.raw_value, value: norm.value, unit: norm.unit,
        state: "unverified",   // tier 3 alone is never "verified" (Q4)
        prov: { tier: 3, method: "structured_api", doc_id: `icecat:${r.icecatId}`,
          locator: `feature:${f.feature_id}`, extracted_at: new Date().toISOString().slice(0, 10), norm_v: norm.norm_v },
      };
      const m = mergeField(String(p.sku), byKey.get(key), incoming);
      if (m.action === "protected") { protectedCount++; continue; }
      if (m.action === "conflict") { conflicts++; continue; }
      if (m.action === "insert") additions.push(m.entry);
    }
    if (additions.length && COMMIT) {
      await P.updateOne({ sku: p.sku }, { $push: { specs_v2: { $each: additions } } });
      wrote += additions.length;
    } else { wrote += additions.length; }
  }

  if (Object.keys(backlog).length) {
    const bp = path.join(root, "data/schema/icecat-feature-backlog.json");
    fs.writeFileSync(bp, JSON.stringify({ generated_at: new Date().toISOString(), backlog }, null, 2));
    console.log(`unmapped feature-IDs written to ${path.relative(root, bp)} (${Object.keys(backlog).length} distinct)`);
  }
  console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN"} — products fetched ${ok} | fields ${COMMIT ? "written" : "that would be written"} ${wrote}`);
  console.log(`operator-reviewed values protected: ${protectedCount} | conflicts held: ${conflicts} | unmapped features: ${unmapped}`);
  console.log(`403 Full-Icecat-only: ${forbidden} | 404/not-in-catalogue: ${notfound}`);
  if (forbidden > 0) console.log("→ 403 means the brand needs Full Icecat (reseller authorization or upgrade). [OPERATOR]");
  console.log("NOTE: i18n.de.attributes is never touched by this path.");
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
