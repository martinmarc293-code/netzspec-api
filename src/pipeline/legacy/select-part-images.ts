// scripts/universe/select-part-images.mjs
//
//   node scripts/universe/select-part-images.mjs [--min-confidence high] [--out <file>]
//
// Decide WHICH harvested image belongs to WHICH part, and at what confidence. Downloads
// nothing and writes nothing to the database — it produces a reviewable assignment list, so
// the picks can be looked at before 89,090 pages start rendering them.
//
// WHY CONFIDENCE MATTERS HERE
// The caption-based harvest was verified against 80 fetched images: roughly three quarters of
// its "product" picks were right, and the failures were not subtle — a UI error banner reading
// "This switch's current stack members differ from the dashboard configuration", and a BWDM2
// block diagram whose caption said "...Passive Optical Modules" and so matched on the word
// "Modules". A statistical gate on colour and line-art was then tried and rejected: it threw
// away 3 real products out of 10 rejections and passed about half the junk.
//
// So the picks are TIERED rather than pooled, and only the top tier is safe to publish without
// a human or a vision model looking:
//
//   exact  — the figure caption names THIS part number. Cannot be about another product.
//   form   — the caption names the part's form factor (SFP+, QSFP28...) and the part is an
//            optic. This is what makes a transceiver datasheet usable at all: the ONS sheet
//            covers 663 SKUs with one figure per form factor, so a single "datasheet image"
//            would put an SFP photo on a QSFP+ page.
//   series — the caption names the part's family/series and nothing more specific matched.
//   doc    — the datasheet's own first product figure, no better signal. LOWEST confidence:
//            this is the tier the verification failures came from.
//
// Only exact/form/series are emitted by default. The doc tier is written out separately so it
// can go to the vision pass rather than to a page.
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { FIELD_DICTIONARY, DOMAIN_OVERRIDES } from "../../core/fieldSchema.js";

const ROOT = process.cwd();
type Tier = "exact" | "form" | "series" | "doc";
type Cand = { src: string; idx: number | null; caption?: string; alt?: string; words?: string;
  kind: string; forms?: string[]; pids?: string[] };

const OUT = (() => { const i = process.argv.indexOf("--out"); return i > 0 ? process.argv[i + 1] : path.join(ROOT, "data/reference/part-images.json"); })();

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);

const norm = (s: unknown) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const FORMS = ["QSFP-DD", "QSFP28", "QSFP+", "QSFP", "SFP28", "SFP+", "SFP", "XFP",
  "X2", "CFP2", "CFP4", "CFP", "CXP", "GBIC", "OSFP", "CPAK", "XENPAK"];

// A caption naming a diagram is never a product photo, whatever else it says.
const DIAGRAM = /\b(block diagram|diagram|topology|architecture|workflow|deployment|screenshot|dashboard|graph|chart|schematic|flow ?chart|reference design|logical view|traffic flow)\b/i;

// Some "SKUs" in the catalogue are not part numbers at all — they are standards, form factors
// and connector names captured out of table cells: RJ45, QSFP28, SFP56, 1000BASE-T. They are
// ordinary technical vocabulary, so they appear inside almost any optics caption, and matching
// on them assigned a Catalyst 9500X photograph to "SFP28".
//
// The test is principled rather than a hand-written denylist: a token that IS one of the
// schema's own enum values — a form factor, a connector, a medium, a standard — is describing
// a KIND of thing, and a part number never is. Those SKUs are excluded from the identity-based
// tiers. They are NOT deleted: a noindex thin page costs nothing and a deleted real part is the
// mistake that took six Meraki devices off the site.
function buildGenericTerms() {
  const terms = new Set();
  const add = (v: unknown) => { const n = String(v).toUpperCase().replace(/[^A-Z0-9]/g, ""); if (n.length >= 2) terms.add(n); };
  for (const key of ["form_factor", "connector", "media", "standard", "fiber_type", "laser_type", "mode", "fec"]) {
    for (const d of (FIELD_DICTIONARY as Record<string, { domain?: string[] }>)[key]?.domain || []) add(d);
  }
  for (const cat of Object.keys(DOMAIN_OVERRIDES)) {
    for (const vals of Object.values(DOMAIN_OVERRIDES[cat])) for (const d of vals) add(d);
  }
  // The written-out standard names Cisco uses in captions, which are not in any enum domain.
  for (const t of ["RJ45", "RJ11", "1000BASET", "1000BASESX", "1000BASELX", "10GBASET",
    "10GBASESR", "10GBASELR", "100BASETX", "40GBASESR4", "100GBASELR4", "POE", "POEPLUS",
    "USB", "SFP", "SFPPLUS", "QSFP", "QSFPPLUS", "QSFP28", "QSFP56", "SFP28", "SFP56",
    "XFP", "X2", "CFP", "CFP2", "GBIC", "DAC", "AOC", "MPO", "MMF", "SMF", "LC", "SC"]) add(t);
  return terms;
}

async function main() {
  const harvest = JSON.parse(fs.readFileSync(path.join(ROOT, "data/reference/datasheet-images.json"), "utf8"));
  const skuMap = JSON.parse(fs.readFileSync(path.join(ROOT, "data/reference/datasheet-skus.json"), "utf8"));

  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const parts = client.db(env.MONGODB_DB || "netzspec").collection("parts");
  const info = new Map<string, { family: string; category: string; type: string }>();
  for await (const p of parts.find({}, { projection: { _id: 0, sku: 1, family: 1, category: 1, type: 1 } })) {
    if (p.sku) info.set(p.sku, { family: p.family || "", category: p.category || "", type: p.type || "" });
  }
  await client.close();
  console.log(`parts: ${info.size}`);

  const GENERIC = buildGenericTerms();
  console.log(`generic technical terms excluded from identity matching: ${GENERIC.size}`);

  const picks = new Map<string, { sku: string; src: string; tier: Tier; caption: string; source_url: string }>();          // sku -> {src, tier, caption, source_url}
  const better: Record<Tier, number> = { exact: 4, form: 3, series: 2, doc: 1 };
  const consider = (sku: string, cand: Cand, tier: Tier, url: string) => {
    const cur = picks.get(sku);
    if (cur && better[cur.tier] >= better[tier]) return;
    picks.set(sku, { sku, src: cand.src, tier, caption: cand.caption || cand.words || cand.alt || "", source_url: url });
  };

  let sheets = 0;
  for (const [url, cands] of Object.entries((harvest.sheets || {}) as Record<string, Cand[]>)) {
    const skus: string[] = skuMap[url];
    if (!skus || !skus.length) continue;
    const usable = cands.filter((c: Cand) => c.kind !== "diagram" && !DIAGRAM.test(c.caption || ""));
    if (!usable.length) continue;
    sheets++;
    // document default: the lowest-indexed product-classified figure
    const docDefault = usable.filter((c: Cand) => c.kind === "product")
      .sort((a: Cand, b: Cand) => (a.idx ?? 99) - (b.idx ?? 99))[0];

    for (const sku of skus) {
      const meta = info.get(sku);
      if (!meta) continue;
      const nsku = norm(sku);
      const isGeneric = GENERIC.has(nsku);

      // exact — the caption names this very part number.
      //
      // Matched only against PIDs the harvester already parsed OUT of the caption, never as a
      // substring of the caption text. The substring version looked equivalent and was not: the
      // catalogue contains table-cell captures like SFP28, RJ45 and 1000BASE-T, which occur as
      // ordinary words in almost any optics caption, so "SFP28" was assigned a photo of a
      // Catalyst 9500X. A generic token can always be found inside a sentence about something
      // else, and calling that "exact" is how the highest-confidence tier becomes the least
      // trustworthy one.
      if (!isGeneric) {
        const exact = usable.find((c: Cand) => (c.pids || []).some((p: string) => norm(p) === nsku));
        if (exact) { consider(sku, exact, "exact", url); continue; }
      }

      // form factor — only meaningful for pluggable optics, where one sheet covers many forms
      if (!isGeneric && (meta.category === "transceiver" || meta.type === "transceiver")) {
        const ff = FORMS.find((f) => norm(sku).includes(norm(f)) && norm(f).length >= 3);
        if (ff) {
          const byForm = usable.find((c: Cand) => (c.forms || []).some((x: string) => norm(x) === norm(ff)));
          if (byForm) { consider(sku, byForm, "form", url); continue; }
        }
      }

      // series — the caption names the part's family
      if (meta.family) {
        const fam = meta.family.replace(/^Cisco\s+/i, "").trim();
        if (fam.length >= 4) {
          const bySeries = usable.find((c: Cand) => (c.caption || "").toLowerCase().includes(fam.toLowerCase()));
          if (bySeries) { consider(sku, bySeries, "series", url); continue; }
        }
      }

      if (docDefault) consider(sku, docDefault, "doc", url);
    }
  }

  const all = [...picks.values()];
  const byTier = all.reduce((m: Record<string, number>, p) => ({ ...m, [p.tier]: (m[p.tier] || 0) + 1 }), {});
  const publishable = all.filter((p) => p.tier !== "doc");
  const needsVision = all.filter((p) => p.tier === "doc");

  fs.writeFileSync(OUT, JSON.stringify({ generated_at: "2026-09-02", byTier, picks: publishable }, null, 1));
  fs.writeFileSync(OUT.replace(/\.json$/, "-needs-vision.json"), JSON.stringify({ picks: needsVision }, null, 1));

  console.log(`sheets contributing: ${sheets}`);
  console.log(`assignments by tier: ${JSON.stringify(byTier)}`);
  console.log(`publishable without a vision pass (exact/form/series): ${publishable.length}`);
  console.log(`deferred to the vision pass (doc-default only): ${needsVision.length}`);
  console.log(`distinct images to download: ${new Set(publishable.map((p) => p.src)).size}`);
  console.log(`\nwrote ${OUT}`);
  for (const p of publishable.slice(0, 6)) {
    console.log(`  [${p.tier}] ${p.sku.padEnd(22)} ${String(p.caption).slice(0, 52)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
