// src/core/printedCups.ts — is a cup PRINTED on a document? (the operator's cup bar, 13 Sep 2026)
//
// "Printed on the page, counted per part — not mapped by our rules, not label occurrences per document." A cup is printed
// on a document when any of the document's labels (the extractor's row labels and the tables' column headers) is:
//   1. matched by one of the MAPPER'S OWN alias patterns for that cup (data/schema/attribute-aliases.en.json, category
//      scope respected) — the family is seeded from the mapper, so printed can never be narrower than mapped; or
//   2. matched by a SYNONYM in data/schema/label-families.en.json, tested on the label's LAST segment (after the final
//      ": "), so "Services and Slot Density: Integrated power supply" is a power-supply row under a section heading and
//      not a slot row; an `exclude` hit refuses the synonym; or
//   3. mapped to the cup by today's mapper (mapLabel), whatever the synonyms say.
// ONE definition: the recorded run that fills doc_parts.doc_relevance and the printed-share measurement both read it.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { mapLabel } from "./deepSpecMap.js";

type AliasRule = [string, string, string, { only?: string[] }?];
type Family = { seed: RegExp[]; include: RegExp[]; exclude: RegExp[] };

const ALIASES = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "schema", "attribute-aliases.en.json"), "utf8")) as { rules: AliasRule[]; case_insensitive?: boolean };
const SYNONYMS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "schema", "label-families.en.json"), "utf8")) as Record<string, { include: string[]; exclude: string[] } | string>;
const FLAGS = ALIASES.case_insensitive ? "i" : ""; // exactly as deepSpecMap builds its RULES

const familyCache = new Map<string, Family>();
function familyOf(category: string, cup: string): Family {
  const k = `${category} ${cup}`;
  let f = familyCache.get(k);
  if (!f) {
    const syn = SYNONYMS[cup];
    f = {
      seed: ALIASES.rules.filter((r) => r[1] === cup && (!r[3]?.only || r[3].only.includes(category))).map((r) => new RegExp(r[0], FLAGS)),
      include: typeof syn === "object" ? syn.include.map((s) => new RegExp(s, "i")) : [],
      exclude: typeof syn === "object" ? syn.exclude.map((s) => new RegExp(s, "i")) : [],
    };
    familyCache.set(k, f);
  }
  return f;
}

const mapCache = new Map<string, string | null>();
/** today's mapper, sentinel keys (`__not_a_spec`, `__backlog`) reported as null */
export function mappedCup(category: string, label: string): string | null {
  const k = `${category} ${label}`;
  if (!mapCache.has(k)) { const m = mapLabel(label, category); mapCache.set(k, m && !m.startsWith("__") ? m : null); }
  return mapCache.get(k)!;
}

/** The label's last segment: "Physical Specifications: Weight" -> "Weight". */
export function lastSegment(label: string): string {
  const i = label.lastIndexOf(": ");
  return i >= 0 ? label.slice(i + 2) : label;
}

/** Is `cup` printed by this one label, in this category? */
export function labelPrintsCup(category: string, cup: string, label: string): boolean {
  if (mappedCup(category, label) === cup) return true;
  const f = familyOf(category, cup);
  if (f.seed.some((r) => r.test(label))) return true;
  if (f.exclude.some((r) => r.test(label))) return false;
  const seg = lastSegment(label);
  return f.include.some((r) => r.test(seg));
}

/** The distinct cups among `cups` that a document's labels print. */
export function cupsPrinted(category: string, cups: Iterable<string>, labels: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const cup of cups) if (labels.some((l) => labelPrintsCup(category, cup, l))) out.add(cup);
  return out;
}

/** The distinct cups among `cups` that today's mapper maps from a document's labels. */
export function cupsMapped(category: string, cups: Iterable<string>, labels: readonly string[]): Set<string> {
  const want = new Set(cups);
  const out = new Set<string>();
  for (const l of labels) { const m = mappedCup(category, l); if (m && want.has(m)) out.add(m); }
  return out;
}
