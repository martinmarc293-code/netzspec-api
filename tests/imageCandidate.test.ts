// tests/imageCandidate.test.ts — proof for src/core/imageCandidate.ts and, through it, for the
// half of scraper/images.py that must agree with it.
//
//   npx tsx tests/imageCandidate.test.ts
//
// The corpus is tests/fixtures/image-urls.json: real strings out of runs/acquired/, each with
// the key and the refusal both implementations must produce. It is deliberately not a list of
// clean cases — a suite made only of good input certifies the easy half of the problem
// (D:\Project\CLAUDE.md §2). Half of it is what a distributor actually calls a "product photo":
// the company logo, the category banner, a layout spacer, a cart icon, an inline data: URI.
//
// The drift check is the point of the file. Two languages enforce these rules from ONE file,
// data/schema/image-rules.json; this suite runs `python3.11 scraper/images.py keys …` over the
// same corpus and fails if the two ever disagree — including on URLs whose expectation someone
// wrote loosely. Without it the pipeline could spend months fetching what the other half already
// calls a placeholder, and nothing would say so.
//
// SABOTAGE: a rules file with a key removed must throw NAMING the key, and a rules file that
// does not exist must throw naming the path. A lane that silently fell back to defaults would
// refuse nothing and report success.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { imageRules, imageUrlKey, imageSizeHint, placeholderReason, candidatesFromPage, IMAGE_RULES_FILE } from "../src/core/imageCandidate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`); }
}

type Case = { url: string; key: string | null; placeholder: string | null; note: string };
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "image-urls.json"), "utf8")).cases as Case[];
check("the corpus is not empty and names its sources", corpus.length >= 15 && corpus.every((c) => typeof c.note === "string" && c.note.length > 10));

// ---- the rules file ------------------------------------------------------------------------
{
  const r = imageRules();
  check("the rules file loads with every key the lane reads",
    typeof r.version === "string" && r.placeholder_url_substrings.length > 5 && r.url_key_strip_segments.length > 0
    && r.max_parts_per_url_key > 0 && r.max_parts_per_sha256 > 0 && r.min_long_side_px > 0
    && r.merchant_min_long_side_px >= r.min_long_side_px && r.max_attempts > 0 && r.lease_minutes > 0, r);
  check("min_long_side_px is a REFUSAL floor well below the merchant recommendation, not the same number",
    r.min_long_side_px < r.merchant_min_long_side_px, { min: r.min_long_side_px, merchant: r.merchant_min_long_side_px });
  check("no substring rule is short enough to match half the web", r.placeholder_url_substrings.every((s) => s.length >= 4),
    r.placeholder_url_substrings.filter((s) => s.length < 4));
}

// ---- key and refusal, over the corpus --------------------------------------------------------
for (const c of corpus) {
  const got = imageUrlKey(c.url);
  check(`key: ${c.note.slice(0, 62)}`, got === c.key, { url: c.url, got, want: c.key });
}
for (const c of corpus) {
  const got = placeholderReason(c.url);
  check(`refusal: ${c.note.slice(0, 58)}`, got === c.placeholder, { url: c.url, got, want: c.placeholder });
}

// ---- size hints ------------------------------------------------------------------------------
{
  const h = imageSizeHint("https://documentation.meraki.com/@api/deki/files/466/MS125-24-PoE.png?revision=1&size=bestfit&width=316&height=135");
  check("a CDN's ?width/&height are read as hints", h.width === 316 && h.height === 135, h);
  check("a URL with no size query has no hint", imageSizeHint("https://www.provantage.com/fullsize/1.JPG").width === null);
  check("a nonsense size is not a hint", imageSizeHint("https://x.test/a.jpg?width=abc").width === null);
  check("a one-digit size is not a hint (a resizer never emits ?width=3)", imageSizeHint("https://x.test/a.jpg?width=3").width === null);
}

// ---- one page's image list -> candidate rows ---------------------------------------------------
{
  const rsJpeg = "https://media.router-switch.com/media/catalog/product/cache/HASH/r/o/x.jpg";
  const rsWebp = "https://media.router-switch.com/media/mf_webp/jpg/media/catalog/product/cache/HASH/r/o/x.jpg";
  const s = candidatesFromPage([
    { url: rsJpeg, role: "primary", alt: "main product photo" },
    { url: rsWebp, role: "gallery" },
  ]);
  check("the two renditions router-switch prints for one photo become ONE candidate", s.rows.length === 1, s.rows.map((r) => r.image_url));
  check("the collapsed candidate keeps the first sighting's role and alt", s.rows[0]?.role === "primary" && s.rows[0]?.alt === "main product photo", s.rows[0]);

  const small = "https://documentation.meraki.com/@api/deki/files/466/MS125.png?width=316";
  const big = "https://documentation.meraki.com/@api/deki/files/466/MS125.png?width=1200";
  const s2 = candidatesFromPage([{ url: small, alt: "front panel" }, { url: big }]);
  check("of two renditions of one file the LARGER is the URL to fetch", s2.rows.length === 1 && s2.rows[0].image_url === big, s2.rows);
  check("the larger rendition inherits the alt the smaller one carried", s2.rows[0]?.alt === "front panel", s2.rows[0]);

  const unsized = "https://documentation.meraki.com/@api/deki/files/466/MS125.png";
  const s3 = candidatesFromPage([{ url: small }, { url: unsized }]);
  check("a URL with NO size query beats a resized one: no ?width= means the original", s3.rows[0]?.image_url === unsized, s3.rows);

  const s4 = candidatesFromPage([
    { url: "https://assets.ext.hpe.com/is/image/hpedam/x_complogoimg?$crlogo$" },
    { url: "data:image/gif;base64,R0l" },
    { url: "https://assets.ext.hpe.com/is/image/hpedam/x_block1img?$crimg$" },
  ]);
  check("refusals are LISTED with their reason, not silently dropped", s4.refused.length === 2 && s4.rows.length === 1, s4);
  check("each refusal names which rule refused it", s4.refused.every((r) => r.reason.includes(":") || r.reason === "not-an-http-url"), s4.refused);
  check("an empty image list is an empty result, not a throw", candidatesFromPage([]).rows.length === 0);
  check("a blank url is skipped rather than recorded as a refusal", candidatesFromPage([{ url: "   " }]).rows.length === 0
    && candidatesFromPage([{ url: "   " }]).refused.length === 0);
}

// ---- DRIFT: the Python half must agree, URL for URL --------------------------------------------
{
  // NOT shell:true — a URL's own `&` would be read by cmd.exe as a command separator and the
  // check would fail for a reason that has nothing to do with drift.
  const r = spawnSync("python3.11", ["scraper/images.py", "keys", ...corpus.map((c) => c.url)],
    { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    check("DRIFT scraper/images.py keys runs", false, (r.stderr || r.stdout || "").slice(-400));
  } else {
    type PyRow = { url: string; key: string | null; placeholder: string | null; width_hint: number | null; height_hint: number | null };
    const py = JSON.parse(r.stdout.trim().split("\n").pop() as string) as PyRow[];
    check("DRIFT the Python half answers for every URL in the corpus", py.length === corpus.length, { py: py.length, corpus: corpus.length });
    const disagree: unknown[] = [];
    for (const row of py) {
      const ts = { key: imageUrlKey(row.url), placeholder: placeholderReason(row.url), hint: imageSizeHint(row.url) };
      if (ts.key !== row.key || ts.placeholder !== row.placeholder || ts.hint.width !== row.width_hint || ts.hint.height !== row.height_hint) {
        disagree.push({ url: row.url, ts, py: row });
      }
    }
    check("DRIFT src/core/imageCandidate.ts and scraper/images.py agree on every URL", disagree.length === 0, disagree.slice(0, 4));
  }
}

// ---- SABOTAGE ------------------------------------------------------------------------------------
{
  sabotages++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nz-imgrules-"));
  const broken = path.join(dir, "image-rules.json");
  const full = JSON.parse(fs.readFileSync(IMAGE_RULES_FILE, "utf8")) as Record<string, unknown>;
  delete full.max_parts_per_url_key;
  fs.writeFileSync(broken, JSON.stringify(full), "utf8");
  let msg = "";
  try { imageRules(broken); } catch (e) { msg = (e as Error).message; }
  check("SABOTAGE a rules file missing a key is refused, NAMING the key", msg.includes("max_parts_per_url_key"), msg);

  sabotages++;
  msg = "";
  try { imageRules(path.join(dir, "nope.json")); } catch (e) { msg = (e as Error).message; }
  check("SABOTAGE a rules file that does not exist is refused, naming the path", msg.includes("nope.json") && msg.includes("does not exist"), msg);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // The rule that is easiest to break by accident: someone adds a bare substring that also
  // matches every real product URL. This is the shape of that mistake, caught here.
  sabotages++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nz-imgrules2-"));
  const f = path.join(dir, "image-rules.json");
  const full = JSON.parse(fs.readFileSync(IMAGE_RULES_FILE, "utf8")) as Record<string, unknown>;
  (full.placeholder_url_substrings as string[]).push("product");
  fs.writeFileSync(f, JSON.stringify(full), "utf8");
  const rules = imageRules(f);
  const refusedReal = corpus.filter((c) => c.placeholder === null && placeholderReason(c.url, rules) !== null);
  check("SABOTAGE an over-broad substring refuses real product photos, and the corpus shows it",
    refusedReal.length > 0, refusedReal.map((c) => c.url).slice(0, 3));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
