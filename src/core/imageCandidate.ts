// src/core/imageCandidate.ts — what "the same picture" means, and which URLs are refused on
// sight. Pure: no database, no network. The fetch lane (scraper/images.py) enforces the same
// rules on the BYTES from the same file, data/schema/image-rules.json, so the two halves cannot
// disagree about what a placeholder is.
//
// Why a normalised key at all. A distributor prints one photo under several URLs — a JPEG and
// its WebP transcode, a thumbnail and the full size, the same file with a cache-busting query.
// Recorded raw, each is a separate candidate and the lane spends a request on each. The key
// collapses them; the row keeps the LARGEST URL seen as the one to fetch.
//
// Why substrings and not regexes: `\b` is the wrong tool for URLs (CLAUDE.md), and a substring
// means the same thing in JavaScript and in Python. Everything a substring cannot say — "this
// picture is on three hundred unrelated pages" — is a COUNT, decided where the counts live.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";

export type ImageRules = {
  version: string;
  placeholder_url_substrings: string[];
  url_key_strip_segments: string[];
  sku_family_separator: string;
  sku_equivalent_suffixes: string[];
  max_parts_per_url_key: number;
  max_parts_per_sha256: number;
  min_long_side_px: number;
  merchant_min_long_side_px: number;
  max_attempts: number;
  lease_minutes: number;
};

export const IMAGE_RULES_FILE = path.join(REPO_ROOT, "data", "schema", "image-rules.json");

let cachedRules: ImageRules | null = null;

/** The one rules file, read once. Throws — never falls back to a default — if it is missing or
 *  short of a key: a lane running on silent defaults would refuse nothing and nobody would see it
 *  (three copies of a config parser, D:\Project\CLAUDE.md §10). */
export function imageRules(file: string = IMAGE_RULES_FILE): ImageRules {
  if (cachedRules && file === IMAGE_RULES_FILE) return cachedRules;
  if (!fs.existsSync(file)) throw new Error(`imageRules: ${file} does not exist`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ImageRules>;
  for (const k of ["placeholder_url_substrings", "url_key_strip_segments", "sku_family_separator",
    "sku_equivalent_suffixes", "max_parts_per_url_key",
    "max_parts_per_sha256", "min_long_side_px", "merchant_min_long_side_px", "max_attempts", "lease_minutes"] as const) {
    if (raw[k] === undefined) throw new Error(`imageRules: ${file} has no "${k}"`);
  }
  const rules = raw as ImageRules;
  if (file === IMAGE_RULES_FILE) cachedRules = rules;
  return rules;
}

/**
 * The identity of a picture: lower-cased host + path, query dropped, rendition segments removed,
 * adjacent duplicate segments collapsed. Returns null when the string is not an http(s) URL —
 * a data: URI or a relative src is not something this lane can fetch and must not become a row.
 */
export function imageUrlKey(url: string, rules: ImageRules = imageRules()): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  const strip = new Set(rules.url_key_strip_segments.map((s) => s.toLowerCase()));
  const segs = u.pathname.split("/").filter((s) => s.length > 0).map((s) => decodeURIComponent(s).toLowerCase());
  if (segs.length === 0) return null;
  // the filename is never a rendition segment: /webp/webp.jpg keeps its file
  const last = segs[segs.length - 1];
  const kept = segs.slice(0, -1).filter((s) => !strip.has(s));
  const collapsed: string[] = [];
  for (const s of kept) if (collapsed[collapsed.length - 1] !== s) collapsed.push(s);
  return `${u.hostname.toLowerCase()}/${[...collapsed, last].join("/")}`;
}

/** The URL's own opinion of its size, from the query a CDN resizer reads (?width=316&height=135).
 *  Used ONLY to prefer the larger of two URLs for one key — never recorded as the image's size. */
export function imageSizeHint(url: string): { width: number | null; height: number | null } {
  let u: URL;
  try { u = new URL(url); } catch { return { width: null, height: null }; }
  const num = (keys: string[]): number | null => {
    for (const k of keys) {
      const v = u.searchParams.get(k);
      if (v && /^\d{2,5}$/.test(v)) return Number(v);
    }
    return null;
  };
  return { width: num(["width", "w", "maxwidth", "sw"]), height: num(["height", "h", "maxheight", "sh"]) };
}

/** A URL this lane refuses to spend a request on, with the reason, or null when it is fetchable.
 *  Substring rules only — the counting rules live where the counts are. */
export function placeholderReason(url: string, rules: ImageRules = imageRules()): string | null {
  const key = imageUrlKey(url, rules);
  if (key === null) return "not-an-http-url";
  for (const s of rules.placeholder_url_substrings) {
    if (key.includes(s.toLowerCase())) return `placeholder-url:${s}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Does this filename name somebody else's product? The mirror of scraper/images.py's
// sku_tokens() / sku_relation() / other_sku_reason(); tests/imageCandidate.test.ts runs both over
// tests/fixtures/image-urls.json and fails if they ever disagree.
// ---------------------------------------------------------------------------------------------

const ALNUM = /[\p{L}\p{N}]/u;

/** Upper-cased, non-alphanumerics removed. Mirrors Python's alnum(). */
export function skuAlnum(s: string): string {
  let out = "";
  for (const ch of s.toUpperCase()) if (ALNUM.test(ch)) out += ch;
  return out;
}

/**
 * Part-number-shaped strings the FILENAME contains, upper-cased. Tokens are the whole stem, each
 * dash-separated piece of it, and each adjacent pair rejoined with a dash, because a Cisco PID is
 * as often 'MS120-24P' as 'MR45'. Two characters is noise, never a PID.
 */
export function skuTokens(url: string, rules: ImageRules = imageRules()): Set<string> {
  const key = imageUrlKey(url, rules);
  if (key === null) return new Set();
  let stem = key.split("/").pop() as string;
  if (stem.includes(".")) stem = stem.slice(0, stem.lastIndexOf("."));
  let flat = "";
  for (const ch of stem) flat += ALNUM.test(ch) || ch === "-" ? ch : " ";
  const parts = flat.split(/\s+/u).filter((p) => p.length > 0);
  const pieces: string[] = [];
  for (const p of parts) { pieces.push(p); for (const x of p.split("-")) if (x) pieces.push(x); }
  const out = new Set<string>([stem.toUpperCase()]);
  for (const p of pieces) out.add(p.toUpperCase());
  for (let i = 0; i + 1 < pieces.length; i++) out.add(`${pieces[i]}-${pieces[i + 1]}`.toUpperCase());
  return new Set([...out].filter((t) => t.length >= 3));
}

/** Upper-cased with the suffixes that name the SAME product removed ('=' spare, '-HW' hardware
 *  only). Dashes are kept: the dash IS the rule in skuRelation(). */
export function skuNorm(s: string, rules: ImageRules = imageRules()): string {
  let out = s.trim().toUpperCase();
  for (let changed = true; changed;) {
    changed = false;
    for (const suf of rules.sku_equivalent_suffixes) {
      const u = suf.toUpperCase();
      if (out.length > u.length && out.endsWith(u)) { out = out.slice(0, out.length - u.length); changed = true; }
    }
  }
  return out;
}

/**
 * How the part number a FILENAME carries relates to the part whose page it was on.
 * "same" / "family" are accepted, "other" is refused. See scraper/images.py sku_relation() for
 * the reasoning in full: the dash separates a family from the port and PoE configurations of ONE
 * chassis (MS210 -> MS210-24P, C9200L -> C9200L-24P-4G), while a letter glued on with no dash is
 * a DIFFERENT chassis (MX64 -> MX64W, MX67 -> MX67C, MG41 -> MG41E) and a shared run of letters
 * with no dash boundary is another family (C9200 vs C9200L-24P-4G).
 */
export function skuRelation(mine: string, named: string, rules: ImageRules = imageRules()): "same" | "family" | "other" {
  const a = skuNorm(mine, rules);
  const b = skuNorm(named, rules);
  if (skuAlnum(a) === skuAlnum(b)) return "same";
  if (b.length > 0 && a.startsWith(b + rules.sku_family_separator)) return "family";
  return "other";
}

/**
 * The refusal for meraki's MR45.png on the MR46 page, given the filename tokens already known to
 * be real part numbers for this vendor. Null when the filename names nothing we hold, names this
 * part, or names only this part's own family. A file that names a sibling is refused even when it
 * also names the family, and the reason names the SIBLING.
 */
export function otherSkuReason(sku: string, url: string, knownSkus: Iterable<string>,
  rules: ImageRules = imageRules()): string | null {
  const known = new Set([...knownSkus].map((s) => s.toUpperCase()));
  const named = [...skuTokens(url, rules)].filter((t) => known.has(t));
  if (named.length === 0) return null;
  const rel = named.map((n) => [n, skuRelation(sku, n, rules)] as const);
  if (rel.some(([, r]) => r === "same")) return null;
  const others = rel.filter(([, r]) => r === "other").map(([n]) => n).sort();
  return others.length ? `names-another-sku:${others[0]}` : null;
}

export type CandidateInput = { url: string; role?: string; alt?: string; kind?: string };
export type CandidateRow = {
  image_url: string; url_key: string; role: string | null; alt: string | null; kind: string | null;
  width_hint: number | null; height_hint: number | null;
};
export type CandidateSplit = { rows: CandidateRow[]; refused: { url: string; reason: string }[] };

/**
 * One page's image list -> the rows to record. Collapses duplicates by key, keeping the URL whose
 * own size hint is largest (a CDN thumbnail and its original are one candidate, and we fetch the
 * original), and the first non-empty alt/role seen for that key. Refusals come back listed, never
 * dropped: a page whose every image was refused must be visible as exactly that.
 */
export function candidatesFromPage(images: CandidateInput[], rules: ImageRules = imageRules()): CandidateSplit {
  const byKey = new Map<string, CandidateRow>();
  const refused: { url: string; reason: string }[] = [];
  for (const im of images) {
    const url = (im.url || "").trim();
    if (!url) continue;
    const reason = placeholderReason(url, rules);
    if (reason) { refused.push({ url, reason }); continue; }
    const key = imageUrlKey(url, rules) as string;
    const hint = imageSizeHint(url);
    const prev = byKey.get(key);
    const row: CandidateRow = {
      image_url: url, url_key: key,
      role: im.role?.trim() || null, alt: im.alt?.trim() || null, kind: im.kind?.trim() || null,
      width_hint: hint.width, height_hint: hint.height,
    };
    if (!prev) { byKey.set(key, row); continue; }
    // keep the larger original; a hint-less URL beats a hinted one (no ?width= means full size)
    const prevScore = prev.width_hint === null ? Number.MAX_SAFE_INTEGER : prev.width_hint;
    const nextScore = row.width_hint === null ? Number.MAX_SAFE_INTEGER : row.width_hint;
    if (nextScore > prevScore) { row.role = prev.role ?? row.role; row.alt = prev.alt ?? row.alt; row.kind = prev.kind ?? row.kind; byKey.set(key, row); }
    else { prev.role = prev.role ?? row.role; prev.alt = prev.alt ?? row.alt; prev.kind = prev.kind ?? row.kind; }
  }
  return { rows: [...byKey.values()], refused };
}
