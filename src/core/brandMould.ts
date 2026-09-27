// src/core/brandMould.ts — WHICH BRANDS HAVE A MOULD, and the guard that stops one brand being measured by
// another's (operator, 27 Sep 2026).
//
// THE DEFECT THIS EXISTS TO END. Cup profiles are keyed by CATEGORY, never by vendor. Scoring walks parts by
// category, so an HPE switch in `switches` is asked for exactly the cups that were designed by reading Cisco
// switches. Measured before writing this: 3,476 live hardware parts across 12 other vendors already carry a
// score — hpe 1,142 parts asked for 21,258 required slots, aruba 358 for 11,633, juniper 974 for 7,123 —
// against a mould nobody built for them. Nothing was wrong with any profile; the population reaching it was
// wrong, which is this repo's oldest shape: a rule is read by whatever the caller hands it, not by the
// population you wrote it for.
//
// The operator works ONE BRAND AT A TIME and can only move on when the current brand's mould is complete and
// nothing is interfering. A number that silently mixes twelve other brands into Cisco's denominators makes
// that judgement impossible to make.
//
// WHY THIS IS DERIVED AND NOT A LIST. A hand-kept list of which brands are arranged drifts the day someone
// adds a brand, and it fails silently in both directions. Arrangement leaves evidence on disk — a brand with
// a mould has product-line reference files, which is what the layer build reads — so the answer is computed
// from that evidence. What IS hand-written is the short list of deliberate exceptions, because every entry
// there needs a reason and a newly-arranged brand is admitted automatically rather than being forgotten.

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";

/** Where the layer build reads a brand's product lines from; a brand with no file here has no mould. */
export const LINE_DIR = path.join(REPO_ROOT, "data", "reference", "product-lines");

/**
 * Deliberate exceptions, each with its reason. EMPTY today, and it is meant to stay short: an entry here is
 * a claim that the evidence on disk is wrong about a brand, which should be rare enough to argue for.
 */
export const MOULD_EXCEPTIONS: Readonly<Record<string, { arranged: boolean; reason: string }>> = {};

export type MouldStatus = { vendor: string; arranged: boolean; reason: string; files: number };

/**
 * Which of `vendorSlugs` have a mould, decided by the reference files present.
 *
 * `vendorSlugs` is passed in rather than read here so the rule is pure and testable, and — the reason that
 * matters — so a file can be attributed by LONGEST MATCHING SLUG. Splitting `dell-emc-switches.json` on its
 * first hyphen yields the vendor `dell`, which exists in no catalogue, and the file would then count towards
 * nobody while looking like it counted towards someone. Vendor slugs contain hyphens; filenames are not a
 * safe place to infer a boundary that the slug list already knows.
 */
export function mouldStatuses(vendorSlugs: readonly string[], dir: string = LINE_DIR): MouldStatus[] {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  // longest first, so `dell-emc` is tried before `dell`
  const byLength = [...vendorSlugs].sort((a, b) => b.length - a.length);
  const counts = new Map<string, number>(vendorSlugs.map((v) => [v, 0]));
  for (const f of files) {
    const owner = byLength.find((v) => f === `${v}.json` || f.startsWith(`${v}-`));
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return [...vendorSlugs].map((vendor) => {
    const n = counts.get(vendor) ?? 0;
    const ex = MOULD_EXCEPTIONS[vendor];
    if (ex) return { vendor, arranged: ex.arranged, reason: `exception: ${ex.reason}`, files: n };
    return n > 0
      ? { vendor, arranged: true, reason: `${n} product-line reference file(s)`, files: n }
      : { vendor, arranged: false, reason: "no product-line reference file — this brand has no mould", files: 0 };
  });
}

/** True when this brand has a mould of its own. A brand that does not must never be scored against another's. */
export function isArranged(vendor: string, vendorSlugs: readonly string[], dir: string = LINE_DIR): boolean {
  return mouldStatuses(vendorSlugs, dir).find((s) => s.vendor === vendor)?.arranged ?? false;
}

/**
 * Arranged for ONE CATEGORY, which is the unit that actually matters — the reviewer's correction, and it is
 * right. A vendor-level answer admits a brand wholesale the moment it gets its first line file: the day HPE
 * is arranged for `switches`, `isArranged("hpe")` becomes true and HPE's ROUTERS start being scored against
 * Cisco's router profile, which is the very defect this module was written to end, returning through the
 * front door one brand later.
 *
 * Measured today it changes nothing: cisco has 17 per-category line files and all 15 of its categories with
 * scored parts are covered, so the vendor-level and per-category answers agree on every live row. That makes
 * this LATENT WITH A NAMED TRIGGER rather than a live defect — the trigger being the first partially
 * arranged brand — and it is cheaper to fix now than to meet it during HPE.
 *
 * A bare `<vendor>.json` does not arrange anything: it carries vendor-level shared data, not a category's
 * lines. Only `<vendor>-<category>.json` does.
 */
export function isArrangedFor(vendor: string, category: string, dir: string = LINE_DIR): boolean {
  if (MOULD_EXCEPTIONS[vendor]) return MOULD_EXCEPTIONS[vendor].arranged;
  return fs.existsSync(path.join(dir, `${vendor}-${category}.json`));
}

/**
 * The reason recorded on a part that is NOT scored because its brand has no mould.
 *
 * It is deliberately distinct from every other reason a part goes unscored. "Not scored because this brand
 * has no mould yet" and "not scored because it is a licence" are different facts that need different work —
 * one is a brand to arrange, the other is a part that will never have specifications — and a single
 * `no_profile = true` for both is how 3,476 parts could sit inside Cisco's numbers unnoticed.
 */
export const NO_MOULD_REASON = "brand_not_arranged";
