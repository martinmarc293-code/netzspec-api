// src/core/productLine.ts — layers 2 and 3 of a category as the OPERATOR defines them (14 Sep 2026): the PRODUCT LINE a
// buyer names (switches: Catalyst, Nexus, Industrial Ethernet, …) and the SERIES inside it (Catalyst 9300, Nexus 7000,
// IE 4000). The part-type axis (partKind: switch / power / linecard) stays underneath and still decides the cups.
//
// THE MAPPING IS DATA, one file per category: data/reference/product-lines/<vendor>-<category>.json, hand-read from the
// live series labels, SKUs and names. A part is placed by the FIRST matching rule, in this order over the whole file:
//   1. `not_this_category` SKU patterns — rows that are not products of this category (a licence, an optic in switches);
//      they are placed in an explicit bucket WITH THEIR REASON, never dropped and never given a line;
//   2. series `sku` patterns (the SKU is the most precise evidence; it overrides a wrong series label);
//   3. series `name` patterns (case-insensitive, for rows whose SKU carries no family token);
//   4. series `labels` (the stored parts.series value, compared trimmed and case-insensitive).
// A part no rule places is UNPLACED and returned as null: a category is done only when that count is 0.
// No `\b` anywhere (product tokens are not word-shaped): anchor with ^ and explicit character classes.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";

/** `role` = the deploy_role of every part of this series whose kind carries a role axis (switch / ap / router / phone): ONE
 * table read by this page AND the cup engine (src/core/deployRole.ts consults it before its own rules). */
export type SeriesRule = { series: string; role?: string; sku?: string[]; name?: string[]; labels?: string[]; note?: string;
  /** THE FAMILY LAYER (operator, 14 Sep 2026): layer 3 between the product line and the series, ONLY where Cisco names a family
   * that groups series ("Catalyst 9000", "Nexus 7000 Series" = 7000 + 7700, "ISR G2" = 1900 / 2900 / 3900). Never invented to
   * fill the depth: a series with no Cisco family sits directly under its line. */
  family?: string };
/** `no_family_reason`: required on a line of 3+ series where any series has no family — says why (Cisco names none). */
export type LineRule = { line: string; series: SeriesRule[]; no_family_reason?: string };
export type ExcludeRule = { sku: string; why: string; belongs?: string };
/** `shared_accessories`: SKU patterns of GENERIC accessories (power cords, generic cables, rack kits, blanks, console cables).
 * Reviewer rule, 14 Sep 2026: such a row goes to "<product line> shared parts" unless its SKU names the series — so the
 * series SKU rules run first and win; a row only a label or a name places is filed under its line's shared parts. */
/** `family_layer: "assigned"`: the category's families have been read against Cisco's naming (its review round). Until then a
 * file may carry no families; once assigned, every line of 3+ series with a series outside a family must say why. */
export type LineFile = { vendor: string; category: string; _about?: string; family_layer?: "assigned"; lines: LineRule[]; not_this_category?: ExcludeRule[]; shared_accessories?: string[] };
export type Placement =
  | { line: string; series: string; rule: string; role?: string | null }
  | { line: "(not this category)"; series: string; rule: string; why: string; belongs: string | null };

export const LINE_DIR = path.join(REPO_ROOT, "data", "reference", "product-lines");
export const lineFilePath = (vendor: string, category: string) => path.join(LINE_DIR, `${vendor}-${category}.json`);

type Compiled = {
  exclude: { re: RegExp; why: string; belongs: string | null; src: string }[];
  sku: { re: RegExp; line: string; series: string; src: string }[];
  name: { re: RegExp; line: string; series: string; src: string }[];
  label: Map<string, { line: string; series: string }>;
  accessory: { re: RegExp; src: string }[];
  role: Map<string, string | null>;
};

export const SHARED_PARTS = (line: string) => `${line} shared parts`;

/** Shape and consistency errors of a line file, one line each (the test and the builder refuse on any). */
export function validateLineFile(f: LineFile): string[] {
  const errs: string[] = [];
  const seenSeries = new Map<string, string>();
  const seenLabel = new Map<string, string>();
  if (!f.vendor || !f.category) errs.push("vendor and category are required");
  if (!Array.isArray(f.lines) || f.lines.length === 0) errs.push("lines must be a non-empty array");
  for (const l of f.lines ?? []) {
    if (!l.line) errs.push("a line has no name");
    for (const s of l.series ?? []) {
      if (!s.series) { errs.push(`${l.line}: a series has no name`); continue; }
      const prev = seenSeries.get(s.series);
      if (prev !== undefined) errs.push(`series "${s.series}" is listed twice (lines ${prev} and ${l.line})`);
      seenSeries.set(s.series, l.line);
      if (!s.sku?.length && !s.name?.length && !s.labels?.length) errs.push(`${l.line} / ${s.series}: no sku, name or labels rule — it can place nothing`);
      for (const p of [...(s.sku ?? []), ...(s.name ?? [])]) {
        try { new RegExp(p); } catch (e) { errs.push(`${l.line} / ${s.series}: bad pattern ${p}: ${(e as Error).message}`); }
        if (p.includes("\\b")) errs.push(`${l.line} / ${s.series}: pattern ${p} uses \\b (product tokens are not word-shaped)`);
      }
      for (const lab of s.labels ?? []) {
        const k = lab.trim().toLowerCase();
        const was = seenLabel.get(k);
        if (was !== undefined && was !== s.series) errs.push(`label "${lab}" maps to two series (${was}, ${s.series})`);
        seenLabel.set(k, s.series);
      }
    }
  }
  // THE FAMILY LAYER'S SHAPE: a family groups at least two series of ONE line and restates neither the line nor a series name
  // (a family "Nexus 7000" over a series "Nexus 7000" is the level-restating-the-level mistake; the series takes its platform
  // names instead). A line of 3+ series with any series left outside a family says why.
  const allSeries = new Set((f.lines ?? []).flatMap((l) => (l.series ?? []).map((s) => s.series.trim().toLowerCase())));
  const familyLine = new Map<string, string>();
  for (const l of f.lines ?? []) {
    const members = new Map<string, number>();
    for (const s of l.series ?? []) {
      if (s.family === undefined) continue;
      const fam = s.family.trim();
      if (!fam) { errs.push(`${l.line} / ${s.series}: an empty family`); continue; }
      if (fam.toLowerCase() === l.line.trim().toLowerCase()) errs.push(`${l.line} / ${s.series}: family "${fam}" restates its product line`);
      if (allSeries.has(fam.toLowerCase())) errs.push(`${l.line} / ${s.series}: family "${fam}" restates a series name`);
      const was = familyLine.get(fam);
      if (was !== undefined && was !== l.line) errs.push(`family "${fam}" appears in two lines (${was}, ${l.line})`);
      familyLine.set(fam, l.line);
      members.set(fam, (members.get(fam) ?? 0) + 1);
    }
    for (const [fam, n] of members) if (n < 2) errs.push(`${l.line}: family "${fam}" groups only one series — a family is a grouping`);
    const real = (l.series ?? []).filter((s) => !/shared parts$/.test(s.series));
    if (f.family_layer === "assigned" && real.length >= 3 && real.some((s) => !s.family) && !(l.no_family_reason ?? "").trim())
      errs.push(`${l.line}: ${real.filter((s) => !s.family).length} series have no family and the line records no no_family_reason`);
  }
  for (const x of f.not_this_category ?? []) {
    if (!x.why) errs.push(`not_this_category ${x.sku}: a reason is required`);
    try { new RegExp(x.sku); } catch (e) { errs.push(`not_this_category: bad pattern ${x.sku}: ${(e as Error).message}`); }
  }
  return errs;
}

function compile(f: LineFile): Compiled {
  const c: Compiled = { exclude: [], sku: [], name: [], label: new Map(), accessory: (f.shared_accessories ?? []).map((p) => ({ re: new RegExp(p), src: p })), role: new Map() };
  for (const x of f.not_this_category ?? []) c.exclude.push({ re: new RegExp(x.sku), why: x.why, belongs: x.belongs ?? null, src: x.sku });
  for (const l of f.lines) for (const s of l.series) {
    c.role.set(s.series, s.role ?? null);
    for (const p of s.sku ?? []) c.sku.push({ re: new RegExp(p), line: l.line, series: s.series, src: p });
    for (const p of s.name ?? []) c.name.push({ re: new RegExp(p, "i"), line: l.line, series: s.series, src: p });
    for (const lab of s.labels ?? []) c.label.set(lab.trim().toLowerCase(), { line: l.line, series: s.series });
  }
  return c;
}

const cache = new Map<string, { file: LineFile; compiled: Compiled } | null>();

/** The line file of a category, or null when none is written yet. Throws on an invalid file. */
export function loadLineFile(vendor: string, category: string): { file: LineFile; compiled: Compiled } | null {
  const k = `${vendor}|${category}`;
  if (!cache.has(k)) {
    const p = lineFilePath(vendor, category);
    if (!fs.existsSync(p)) { cache.set(k, null); }
    else {
      const file = JSON.parse(fs.readFileSync(p, "utf8")) as LineFile;
      const errs = validateLineFile(file);
      if (errs.length) throw new Error(`${path.relative(REPO_ROOT, p)} is invalid: ${errs.slice(0, 8).join("; ")}`);
      cache.set(k, { file, compiled: compile(file) });
    }
  }
  return cache.get(k)!;
}

/** Place one part in its product line and series, or null when no rule places it (or no file exists). */
export function placePart(vendor: string, category: string, part: { sku: string; name?: string | null; series?: string | null }, loaded = loadLineFile(vendor, category)): Placement | null {
  if (!loaded) return null;
  const { compiled: c } = loaded;
  const raw = part.sku.toUpperCase().trim().replace(/=+$/, "");
  // Ordering prefixes that do not change the hardware: 2D- (2D-barcode spare), C1- (Cisco ONE), EDU- (education), NAL-
  // (not-for-resale lab). Patterns see the SKU WITHOUT them; the stored SKU is untouched.
  const sku = raw.replace(/^(2D-|C1-|EDU-|NAL-)/, "");
  for (const x of c.exclude) if (x.re.test(sku)) return { line: "(not this category)", series: x.belongs ?? "(elsewhere)", rule: `exclude ${x.src}`, why: x.why, belongs: x.belongs };
  for (const r of c.sku) if (r.re.test(sku)) return { line: r.line, series: r.series, rule: `sku ${r.src}`, role: c.role.get(r.series) ?? null };
  const name = (part.name ?? "").trim();
  let soft: { line: string; series: string; rule: string } | null = null;
  if (name) for (const r of c.name) if (r.re.test(name)) { soft = { line: r.line, series: r.series, rule: `name ${r.src}` }; break; }
  const lab = (part.series ?? "").trim().toLowerCase();
  if (!soft && lab && c.label.has(lab)) { const m = c.label.get(lab)!; soft = { line: m.line, series: m.series, rule: `label ${part.series}` }; }
  if (!soft) return null;
  // a generic accessory the SKU does not tie to a series: its line's shared parts, never a series it merely sits beside
  const acc = c.accessory.find((a) => a.re.test(sku));
  if (acc) return { line: soft.line, series: SHARED_PARTS(soft.line), rule: `accessory ${acc.src} (${soft.rule})`, role: null };
  return { ...soft, role: c.role.get(soft.series) ?? null };
}

/** Layer 3, the Cisco-named family of a placed series, or null (no family above it, shared parts, not this category). */
export function familyOf(loaded: ReturnType<typeof loadLineFile>, series: string | null | undefined): string | null {
  if (!loaded || !series) return null;
  for (const l of loaded.file.lines) for (const s of l.series) if (s.series === series) return s.family?.trim() || null;
  return null;
}

/** How strong the evidence behind a placement is: an exclusion or a SKU rule beats a name, a name beats a stored label. */
export function placementStrength(p: Placement | null): number {
  if (!p) return 0;
  const r = p.rule;
  if (r.startsWith("exclude") || r.startsWith("sku")) return 4;
  if (r.startsWith("name") || /[(]name /.test(r)) return 3;
  return 2; // label, or an accessory placed through its label
}

const PLACEHOLDER_NAME = /^\s*(\^?invalid sku|do not (use|publish))\s*$/i;
/** A name that says something about the part: not empty, not "Cisco <sku>" / "<sku>", not a vendor placeholder. */
export function informativeName(sku: string, name: string | null | undefined): boolean {
  const n = String(name ?? "").trim();
  if (!n || PLACEHOLDER_NAME.test(n)) return false;
  const bare = n.replace(/^cisco\s+/i, "").replace(/=+$/, "").toUpperCase();
  return bare !== sku.toUpperCase().replace(/=+$/, "");
}

/**
 * THE TWIN KEY (re-audit decisions, operator, 15 Sep 2026, N-1): `X`, `X=`, `X-` and `X--` are one piece of hardware — the spare
 * orderable (`=`), the component / auto-expand PID (`-`) and the customized-model PID (`--`) that Cisco's own end-of-sale notices
 * list beside it (CAB-2HDMILK-1.27M-, CCS-HD-250GB-, FAN-ROOM70-2PK-; CS-BARPRO-K9-- "Customized Model"). They are not misprints.
 */
export const twinKey = (sku: string): string => sku.toUpperCase().trim().replace(/[-=]+$/, "");
/** the member order a tie falls back to: the base, then the spare, then the component PID, then the customized model */
export const twinRank = (sku: string): number => { const s = sku.toUpperCase().trim(); return s.endsWith("=") ? 1 : /--$/.test(s) ? 3 : s.endsWith("-") ? 2 : 0; };

/**
 * THE SPARE RULE (layers review, 14 Sep 2026, A.1), widened to the twin rule (N-1, 15 Sep 2026): `X=` is the spare orderable of
 * `X` — the same hardware — and so are `X-` and `X--`; the members sit in one product line and series. Each member is placed on its
 * own evidence first; the group then takes the placement with the stronger evidence (placementStrength), ties going to the member
 * whose name is informative, then to the base, the spare, the component PID, the customized model (twinRank). Rows without a
 * partner are returned as placed. Keyed by the stored SKU.
 */
export function placeWithSpareRule(vendor: string, category: string, rows: readonly { sku: string; name?: string | null; series?: string | null }[], loaded = loadLineFile(vendor, category)): Map<string, Placement | null> {
  const own = new Map(rows.map((r) => [r.sku, placePart(vendor, category, r, loaded)] as const));
  const groups = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) { const k = twinKey(r.sku); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const out = new Map(own);
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const best = [...members].sort((a, b) =>
      (placementStrength(own.get(b.sku) ?? null) - placementStrength(own.get(a.sku) ?? null))
      || (Number(informativeName(b.sku, b.name)) - Number(informativeName(a.sku, a.name)))
      || (twinRank(a.sku) - twinRank(b.sku)))[0];
    const win = own.get(best.sku) ?? null;
    for (const m of members) out.set(m.sku, win);
  }
  return out;
}
