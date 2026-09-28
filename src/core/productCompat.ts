// src/core/productCompat.ts — item 8 (reviewer, 28 Sep 2026; docs/decisions/2026-09-28-relations-for-components.md):
// a product_compatibility FACT whose every element names a model becomes `compatible` relations (the cup is now
// relation-backed, ruling 12a); an all-prose one retracts; a mixed one retracts and goes to the parser as a finding.

/** One token that carries a digit, optionally led by "Cisco": "8804", "Cisco 1841", "NCS2002", "ASR-9001". Prose
 *  ("All Flash/All NVMe", "with no PSU", "1RU FI") has spaces inside the name and is not a model. */
export function isModelShaped(element: string): boolean {
  const t = element.trim().replace(/^cisco\s+/i, "");
  if (!t) return false;
  // One token with a digit: "8804", "NCS2002", "ASR-9001".
  if (!/\s/.test(t)) return /[0-9]/.test(t) && /^[A-Za-z0-9][A-Za-z0-9./+-]*$/.test(t);
  // A family word and a number: "NCS 1004", "Catalyst 9300" (read on the 79 stored values, 28 Sep). Never a phrase that
  // merely starts with a word: "All 24" is a port class, so the common lead words are refused.
  const m = /^([A-Za-z]{2,10}) ([0-9][A-Za-z0-9./+-]*)$/.exec(t);
  return !!m && !/^(all|with|for|and|or|per|up|to|no|only|any)$/i.test(m[1]);
}

export type CompatVerdict = { action: "promote"; models: string[] } | { action: "retract"; why: "prose" | "mixed" };

export function classifyCompatFact(value: unknown): CompatVerdict {
  const elements = (Array.isArray(value) ? value : [value]).map((x) => String(x ?? "").trim()).filter(Boolean);
  const models = elements.filter(isModelShaped);
  if (elements.length && models.length === elements.length) return { action: "promote", models: models.map((m) => m.replace(/\s+/g, " ")) };
  return { action: "retract", why: models.length ? "mixed" : "prose" };
}
