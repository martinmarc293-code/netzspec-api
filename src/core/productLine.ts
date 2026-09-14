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
export type SeriesRule = { series: string; role?: string; sku?: string[]; name?: string[]; labels?: string[]; note?: string };
export type LineRule = { line: string; series: SeriesRule[] };
export type ExcludeRule = { sku: string; why: string; belongs?: string };
/** `shared_accessories`: SKU patterns of GENERIC accessories (power cords, generic cables, rack kits, blanks, console cables).
 * Reviewer rule, 14 Sep 2026: such a row goes to "<product line> shared parts" unless its SKU names the series — so the
 * series SKU rules run first and win; a row only a label or a name places is filed under its line's shared parts. */
export type LineFile = { vendor: string; category: string; _about?: string; lines: LineRule[]; not_this_category?: ExcludeRule[]; shared_accessories?: string[] };
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
