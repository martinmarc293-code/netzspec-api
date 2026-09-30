// src/core/shippingAllowance.ts — Versandgewicht from Artikelgewicht, ruling Q23 (reviewer, 30 Sep 2026).
//
// "A ruled allowance, not blank. JTL needs Versandgewicht for shipping. Allowance by weight band = the median packaging delta
// per band from the recorded switch file, stored as derived:shipping-allowance with the file as witness; the band table lives
// in one place and is revisited when real shipping weights exist."
//
// The ONE place is data/reference/shipping-allowance-bands.json (scripts/shipping-allowance-bands.py builds it from the
// recorded Hexwaren Cisco switch Main file and records its sha256). This module only reads it. A weight outside every band, or
// not a positive number, gets NO allowance -- never a guessed one.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";

export type AllowanceBand = { from_kg: number; below_kg: number | null; n: number; allowance_kg: number; q1_kg: number; q3_kg: number };
type Table = { witness: { path: string; sha256: string; rows_used: number }; bands: AllowanceBand[] };

let TABLE: Table | null = null;
export function allowanceTable(): Table {
  if (!TABLE) {
    TABLE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "shipping-allowance-bands.json"), "utf8")) as Table;
    // the table is contiguous from 0 and open at the top, or it is not a table this module can answer from
    const b = TABLE.bands;
    if (!b.length || b[0].from_kg !== 0 || b[b.length - 1].below_kg !== null || b.some((x, i) => i > 0 && x.from_kg !== b[i - 1].below_kg)) {
      throw new Error("data/reference/shipping-allowance-bands.json: bands must run contiguously from 0 kg and end open");
    }
  }
  return TABLE;
}

/** The band a weight (kg) falls in, or null for a weight that is not a positive finite number. */
export function allowanceBand(kg: number): AllowanceBand | null {
  if (typeof kg !== "number" || !Number.isFinite(kg) || kg <= 0) return null;
  return allowanceTable().bands.find((b) => kg >= b.from_kg && (b.below_kg === null || kg < b.below_kg)) ?? null;
}

/** Versandgewicht in kg, to the gram: the weight plus its band's ruled allowance; null when no band answers. */
export function shippingWeightKg(kg: number): number | null {
  const b = allowanceBand(kg);
  return b ? Math.round((kg + b.allowance_kg) * 1000) / 1000 : null;
}

/** The raw a derived:shipping-allowance fact carries: its INPUT, the part's weight in kg, as the derivation read it. */
export const shippingRaw = (kg: number): string => `${kg} kg`;
/** ...and the replay: from that raw back to the derived value (src/core/derivedReplay.ts). */
export function shippingFromRaw(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?) kg$/.exec(raw.trim());
  return m ? shippingWeightKg(Number(m[1])) : null;
}
