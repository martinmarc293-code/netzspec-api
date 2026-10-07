// src/core/shippingClass.ts — FINAL FILL ORDER item 4 (reviewer, 30 Sep 2026): a small component with no measured weight gets a
// Versandgewicht (shipping_weight) from its SHIPPING CLASS, stored as derived:shipping-class with the class table as witness.
// Its Artikelgewicht stays EMPTY until a measured weight exists, and shop_ready accepts the Versandgewicht for these kinds ONLY:
// a device or a chassis still needs a measured weight.
//
// The ONE place is data/reference/shipping-classes.json: (category, kind) -> tier -> kg, every row with its basis -- a measured
// p90 where the store holds measured weights of that kind, otherwise a declared parcel tier that says so. A tier is a parcel
// class, never a claim about the part's weight; it rounds UP (ruling Q25: for shipping the maximum is the safe side).
// The table is read once, lazily, the way shippingAllowance.ts reads its bands, and refuses at load when a row names a tier
// the table does not define or a pair twice -- a class that cannot be resolved never falls back to a guess.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";

/** exclude_family_with_heavier_measured_sibling (reviewer W1, 7 Oct 2026, routers/module): "No class for a module whose family has a
 *  measured sibling above that tier. List those." -- a class row that sets it is refused, per part, by derive-shipping-class. */
export type ShippingClass = { category: string; kind: string; tier: string; kg: number; basis: string; exclude_family_with_heavier_measured_sibling?: boolean };
type Table = { tiers: Record<string, number>; classes: { category: string; kind: string; tier: string; basis: string; exclude_family_with_heavier_measured_sibling?: boolean }[] };

export const SHIPPING_CLASS_FILE = path.join(REPO_ROOT, "data", "reference", "shipping-classes.json");
let TABLE: Table | null = null;
let BY: Map<string, ShippingClass> | null = null;
function load(): { table: Table; by: Map<string, ShippingClass> } {
  if (TABLE && BY) return { table: TABLE, by: BY };
  const t = JSON.parse(fs.readFileSync(SHIPPING_CLASS_FILE, "utf8")) as Table;
  const by = new Map<string, ShippingClass>();
  for (const c of t.classes) {
    const kg = t.tiers[c.tier];
    if (!(typeof kg === "number" && kg > 0)) throw new Error(`shipping-classes.json: ${c.category}/${c.kind} names tier "${c.tier}", which the table does not define`);
    const k = `${c.category}/${c.kind}`;
    if (by.has(k)) throw new Error(`shipping-classes.json: ${k} appears twice`);
    by.set(k, { ...c, kg });
  }
  TABLE = t; BY = by;
  return { table: t, by };
}

/** The shipping class of a (category, kind), or null: a kind the table does not list is not a small component. */
export function shippingClassOf(category: string, kind: string | null | undefined): ShippingClass | null {
  return kind ? load().by.get(`${category}/${kind}`) ?? null : null;
}

/** Every class row, for the writer and the tests. */
export function shippingClasses(): ShippingClass[] {
  return [...load().by.values()];
}

/** The raw a derived:shipping-class fact carries: the class and its tier, so the replay needs nothing but the raw and the table. */
export const shippingClassRaw = (c: ShippingClass): string => `shipping class ${c.category}/${c.kind}: tier ${c.tier} = ${c.kg} kg`;

/** The replay: the kg of the raw's class in the table as it is NOW -- a class the table no longer lists, a class moved to another
 *  tier, or a tier whose kg changed refuses (null), so a changed table shows up as facts to re-derive, never as stale values. */
export function shippingFromClassRaw(raw: string): number | null {
  const m = /^shipping class (\S+)\/(\S+): tier (\w+) = (\d+(?:\.\d+)?) kg$/.exec(raw);
  if (!m) return null;
  const cur = load().by.get(`${m[1]}/${m[2]}`);
  return cur && cur.tier === m[3] && cur.kg === Number(m[4]) ? cur.kg : null;
}
