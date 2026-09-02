// scripts/universe/harvest-images.mjs
//
//   node scripts/universe/harvest-images.mjs [--limit N]
//
// Collect product-image CANDIDATES from the cached Cisco datasheets.
//
// WHY THE OBVIOUS APPROACHES FAIL
// A previous attempt scored images by alt text and picked the wrong image about a third of
// the time — "Feedback_OceanBlue.png" (a UI widget) and "Related image, diagram or
// screenshot" (an architecture diagram). Tightening the alt rules dropped coverage to 18%.
// Cisco's alt text is simply not consistent: the Catalyst 9200 sheet describes its images,
// the 9300 sheet labels every one of them "Related image, diagram or screenshot".
//
// What IS consistent is the FIGURE CAPTION, which sits in the markup immediately after the
// <img>, and says what the picture is in Cisco's own words:
//     "Figure 1.  Cisco Catalyst 9300 Series Switches"        <- product photo
//     "Figure 3.  Block Diagram - Left/Right Segmented Node"  <- not a product photo
// So caption is the signal, and alt is at most a tiebreak.
//
// The second thing the captions give us is PER-SKU matching. The ONS transceiver datasheet
// covers 663 SKUs and carries one figure per form factor — Figure 1 SFP, Figure 2 XFP,
// Figure 3 SFP+, Figure 4 CXP, Figure 5 CFP, Figure 6 QSFP+. A single "datasheet image"
// would put an SFP photo on a QSFP+ page. Captions let the matcher pick the right one.
//
// This script only HARVESTS and CLASSIFIES; it downloads nothing and writes no parts.
// Output: data/universe/datasheet-images.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, "scraper", "cache");
const OUT = path.join(ROOT, "data", "universe", "datasheet-images.json");

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

// Images that are page furniture on every cisco.com page, never product photography.
const CHROME_RE = /\/eotToc\/|cisco-logo|cookielaw|2o7\.net|\/analytics|spotlight_copy|search-white|close_11x11|powered_by|facebook|twitter|linkedin|youtube|rss|\/icons?\/|sprite|placeholder|1x1\.|pixel\.|blank\.|feedback/i;

// Marketing carousel tiles: fixed promo sizes under a /images/ path, repeated on the page.
const TILE_RE = /\/images\/[a-z]{2}\d{4,}-[a-z0-9]+-\d{3,4}x\d{2,4}\.(png|jpg|jpeg)/i;

// A caption describing a schematic, not a product. Checked BEFORE the product test, because
// "Figure 4. Cisco Catalyst 9300 deployment topology" contains a product name too.
const DIAGRAM_RE = /\b(block diagram|diagram|topology|topologies|architecture|workflow|work flow|deployment|use case|screenshot|screen shot|dashboard|graph|chart|illustration|schematic|flow chart|flowchart|overview of|reference design|logical view|traffic flow|scenario|example|comparison of|matrix|timeline|lifecycle|migration path|before and after|licensing|ordering process)\b/i;

// A caption describing the physical thing.
const PRODUCT_RE = /\b(switch|switches|router|routers|transceiver|module|modules|appliance|chassis|server|adapter|card|line card|access point|firewall|controller|gateway|node|shelf|power supply|fan tray|antenna|cable|bracket|kit|stack|front panel|rear panel|faceplate|product image|photo)\b/i;

// Form factors a transceiver caption may name, so a per-SKU match is possible later.
const FORM_FACTORS = ["QSFP-DD", "QSFP28", "QSFP+", "QSFP", "SFP28", "SFP+", "SFP", "XFP",
  "X2", "CFP2", "CFP4", "CFP", "CXP", "GBIC", "OSFP", "CPAK", "XENPAK"];

const decode = (s) => s
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

// The trailing partial-tag cut matters: we slice a fixed window out of the HTML, so the last
// tag in it is usually truncated ("<div data-c-") and survives a <[^>]+> strip, landing raw
// markup in the caption. Cut anything from the last unclosed "<" onward first.
const strip = (s) => {
  const open = s.lastIndexOf("<");
  const close = s.lastIndexOf(">");
  const cut = open > close ? s.slice(0, open) : s;
  return decode(cut.replace(/<[^>]+>/g, " "));
};

function resolve(src, base) {
  if (!src) return null;
  if (src.startsWith("//")) return "https:" + src;
  if (/^https?:/i.test(src)) return src;
  try { return new URL(src, base).href; } catch { return null; }
}

// The caption Cisco puts after the image. Look only a short way ahead: further than this and
// we start reading the next section's body text and calling it a caption.
function captionAfter(html, pos) {
  const win = strip(html.slice(pos, pos + 400));
  const fig = win.match(/^\s*Figure\s*\d+\.?\s*(.{3,160}?)(?:\s+(?:Table|Figure)\s*\d|\s*$)/i);
  if (fig) return { text: fig[1].trim(), kind: "figure" };
  // Some sheets caption above the image instead; the caller passes that in separately.
  return null;
}
function captionBefore(html, pos) {
  const win = strip(html.slice(Math.max(0, pos - 300), pos));
  const fig = win.match(/Figure\s*\d+\.?\s*([^]{3,160})$/i);
  if (fig) return { text: fig[1].trim(), kind: "figure-above" };
  return null;
}

function classifyCaption(text) {
  if (!text) return "unknown";
  if (DIAGRAM_RE.test(text)) return "diagram";
  if (PRODUCT_RE.test(text)) return "product";
  return "unknown";
}

function formFactorsIn(text) {
  if (!text) return [];
  const up = text.toUpperCase();
  const hits = [];
  for (const ff of FORM_FACTORS) {
    // longest-first so SFP+ is not swallowed by SFP
    if (up.includes(ff.toUpperCase()) && !hits.some((h) => h.toUpperCase().includes(ff.toUpperCase()))) hits.push(ff);
  }
  return hits;
}

// PIDs named in a caption, so an image can be bound to an exact SKU.
function pidsIn(text) {
  if (!text) return [];
  const out = new Set();
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{1,}(?:-[A-Z0-9]+){1,5})\b/g)) {
    const p = m[1];
    if (p.length < 5 || p.length > 32) continue;
    if (/^(FIGURE|TABLE|CISCO|SERIES|GBPS|MBPS)/.test(p)) continue;
    if (!/\d/.test(p)) continue;
    out.add(p);
  }
  return [...out];
}

function harvest(html, baseUrl) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcM = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
      || tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i);
    if (!srcM) continue;
    const abs = resolve(srcM[1], baseUrl);
    if (!abs) continue;
    if (CHROME_RE.test(abs) || TILE_RE.test(abs)) continue;
    if (!/\.(png|jpe?g|webp|gif)(\?|$)/i.test(abs)) continue;
    if (seen.has(abs)) continue;           // carousel tiles repeat; keep first only
    seen.add(abs);

    const altM = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
    const alt = altM ? decode(altM[1]) : "";
    const cap = captionAfter(html, m.index + tag.length) || captionBefore(html, m.index);
    const caption = cap ? cap.text : "";
    // document-order index from Cisco's rendition naming, when present
    const idxM = abs.match(/_(\d+)\.(png|jpe?g|gif)$/i);

    // Cisco's newer collateral uses descriptive image paths — ds-c9350-replaceable-fan-unit.png,
    // ds-c9610-series-supervisor-engine-3xl.jpg — which name the product as reliably as a
    // caption does. The older AEM renditions (datasheet-c78-734980_3.png) are opaque, so only
    // treat a basename as words when it actually reads as words.
    const isRendition = /\/renditions\//i.test(abs);
    const base = decodeURIComponent(abs.split("/").pop().replace(/\.(png|jpe?g|webp|gif)(\?.*)?$/i, ""));
    const words = base.replace(/[_-]+/g, " ").replace(/\b\d{4,}\b/g, " ").trim();
    const descriptive = !isRendition && (words.match(/\b[a-z]{3,}\b/gi) || []).length >= 2;

    // Signals in priority order: Cisco's own caption, then a descriptive filename, then alt
    // (which is "Related image, diagram or screenshot" on entire datasheets, so it is last).
    let kind = classifyCaption(caption);
    let via = kind !== "unknown" ? "caption" : null;
    if (kind === "unknown" && descriptive) {
      kind = classifyCaption(words);
      if (kind !== "unknown") via = "filename";
    }
    if (kind === "unknown" && alt && !/related image|diagram or screenshot/i.test(alt)) {
      kind = classifyCaption(alt);
      if (kind !== "unknown") via = "alt";
    }
    const text = [caption, descriptive ? words : "", alt].filter(Boolean).join(" | ");
    out.push({
      src: abs,
      idx: idxM ? Number(idxM[1]) : null,
      caption, alt, kind, via,
      words: descriptive ? words : "",
      forms: formFactorsIn(text),
      pids: pidsIn(text),
      rendition: isRendition,
    });
  }
  return out;
}

function main() {
  const limit = process.argv.includes("--limit")
    ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;

  const classes = JSON.parse(fs.readFileSync(path.join(ROOT, "data/universe/datasheet-classes.json"), "utf8"));
  // Only documents that describe hardware carry product photography. White papers, ordering
  // guides and licence sheets contributed most of the junk candidates in the first run
  // (screenshots, "Product ID breakdown", subscription-tier graphics) and no products.
  const WANTED = new Set(["hw_datasheet", "thin", "non_datasheet"]);
  const sheets = classes.sheets
    .filter((s) => s.cached && WANTED.has(s.klass) && s.in_db > 0)
    .slice(0, limit === Infinity ? undefined : limit);

  const result = {};
  const stat = { sheets: 0, withAny: 0, withProduct: 0, cands: 0, product: 0, diagram: 0, unknown: 0, withPid: 0, withForm: 0,
    via: { caption: 0, filename: 0, alt: 0 }, skus_covered: 0 };
  const bySheet = new Map(classes.sheets.map((s) => [s.url, s]));

  for (const s of sheets) {
    const p = path.join(CACHE, sha1(s.url) + ".html");
    if (!fs.existsSync(p)) continue;
    stat.sheets++;
    let html;
    try { html = fs.readFileSync(p, "utf8"); } catch { continue; }
    const cands = harvest(html, s.url);
    if (!cands.length) continue;
    stat.withAny++;
    stat.cands += cands.length;
    for (const c of cands) {
      stat[c.kind]++;
      if (c.via) stat.via[c.via]++;
      if (c.pids.length) stat.withPid++;
      if (c.forms.length) stat.withForm++;
    }
    if (cands.some((c) => c.kind === "product")) {
      stat.withProduct++;
      stat.skus_covered += (bySheet.get(s.url) || {}).in_db || 0;
    }
    result[s.url] = cands;
  }

  fs.writeFileSync(OUT, JSON.stringify({ generated_at: "2026-09-02", stat, sheets: result }, null, 1));
  console.log(JSON.stringify(stat, null, 2));
  console.log(`\nwrote ${OUT}`);
}

main();
