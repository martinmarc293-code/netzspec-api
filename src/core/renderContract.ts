// src/core/renderContract.ts — HOW A STORED VALUE BECOMES ONE GERMAN CELL.
//
// Operator ruling, 25 Sep 2026: "yes add the german values and rendering contract", answering the audit in
// docs/reports/cisco-sancha-audit-2026-09-25.md § "AUDIT 2 — THE CONSUMER'S LENS".
//
// WHY THIS FILE EXISTS. The dictionary translates a field's NAME into German for all 607 keys and says nothing
// about its VALUE. Measured before this file: 20,444 of 48,063 live Cisco facts (42.5%) — every enum, list,
// struct and boolean — were in a type whose German rendering a consumer had to invent. Across all vendors,
// 35,561. The stated use is Claude reading a category and emitting a JTL-Shop import CSV, and a consumer
// inventing "front-to-back" into German is a consumer inventing it DIFFERENTLY each time.
//
// THIS IS NOT THE SHOP'S CONCERN LEAKING IN. `CLAUDE.md` keeps out slugs for URLs, SEO titles, indexability and
// prices — none of which this is. A German word for a value is the same job the dictionary already does for the
// key, left half-done; `airflow` has been "Luftstromrichtung" since the dictionary was written, while its values
// stayed English.
//
// THE SHAPE OF THE GUARANTEE. Every enum value is covered EXPLICITLY — by a map entry or by a stated rule — and
// `uncoveredEnumValues()` names any that is not. A hand-kept list of what EXISTS drifts the day something is
// added; this one cannot, because the check is driven from the DICTIONARY's own domains, so a new enum value
// arrives as a named failure rather than as an English slug in a German shop.
//
// AND IT REFUSES RATHER THAN GUESSES. `renderValue` returns a refusal with a reason for anything it cannot
// render — an unshaped struct, an unknown enum value, a malformed payload. A wrong German technical term is
// worse than an honest refusal, because a refusal is visible and a wrong term is not.
import { FIELD_DICTIONARY, DOMAIN_OVERRIDES } from "./fieldSchema.js";

/**
 * THE LIST SEPARATOR, AND WHY IT IS NOT A SEMICOLON. German Excel writes CSV with `;` as the FIELD delimiter, so
 * a semicolon inside a cell is the one character most likely to split a row on import. A comma is the second,
 * for anyone who exports with `,`. The pipe appears in none of the 6,556 live list values.
 */
export const LIST_SEPARATOR = " | ";

/** Booleans. JTL renders a Merkmalwert as text; there is no boolean type to hand it. */
export const BOOLEAN_DE: Readonly<Record<"true" | "false", string>> = { true: "Ja", false: "Nein" };

/**
 * GERMAN NUMBERS TAKE A COMMA, AND NO THOUSANDS SEPARATOR.
 *
 * The decimal comma is not optional — `0.075` read as German is seventy-five. The thousands separator IS omitted
 * on purpose: German writes 1.234,5 and a full stop inside a CSV cell is read as a decimal point by every
 * importer configured for English, which turns 1.234,5 into something between 1 and 1234.5 depending on who is
 * reading. One unambiguous number beats one pretty one.
 */
export function formatNumberDe(n: number): string {
  if (!Number.isFinite(n)) return "";
  const s = Number.isInteger(n) ? String(n) : String(n);
  return s.replace(".", ",");
}

/** A number with its unit, as one cell: "1,5 Gbit/s". A unit-less number renders bare. */
export function formatQuantityDe(n: number, unit?: string | null): string {
  const v = formatNumberDe(n);
  return unit && unit.trim() ? `${v} ${unit.trim()}` : v;
}

/** A range, from the {min,max} payload `nr` stores: "-5 bis 45 °C". */
export function formatRangeDe(min: number, max: number, unit?: string | null): string {
  const u = unit && unit.trim() ? ` ${unit.trim()}` : "";
  return `${formatNumberDe(min)} bis ${formatNumberDe(max)}${u}`;
}

// ---- ENUM VALUES ---------------------------------------------------------------------------------------------
//
// Two coverings, and every enum key must carry exactly one:
//   map   an explicit German string per value. Used wherever the value is a word, and wherever a technical token
//         needs presenting (`sfp-plus` is not what a datasheet prints; "SFP+" is).
//   rule  a stated transformation, for a domain that is mechanical and large. `ip_rating` has 80 values of the
//         form ipNN; eighty map entries would be eighty chances to mistype one.
//
// A TECHNICAL TOKEN IS STILL COVERED. "It reads the same in German" is a decision, and it is written down as one
// — an entry whose German equals the presented token — rather than a silent pass-through, so nobody has to guess
// later whether a value was considered.
//
// A KEY MAY NEED BOTH, AND `form_factor` IS WHY. Domains are PER CATEGORY — `domainFor(category, key)` reads
// `DOMAIN_OVERRIDES` before the dictionary — so `form_factor` is {rack-19, desktop, din-rail, modular-chassis}
// in `switches` and the optic form factors {gbic, x2, xfp, sfp-plus, qsfp28, …} in `transceiver`. The first
// version of this contract read only the dictionary's global domain, reported "0 uncovered", and then refused
// 1,742 live facts as having "no German rendering" — values that are entirely correct under their category's
// own domain. So a cover may carry a map for the words and a rule for the tokens, and the map is tried first.
// A RULE MAY REFUSE, and must. Until 26 Sep the signature was `(v: string) => string`, so every rule was total over
// every value it was ever handed — which made `uncoveredEnumValues()` structurally unable to report a rule-covered
// value however wrong its output, and four UCS form factors rendered as "BLADE-HALF" and friends while the check
// said 0 uncovered. Returning null is how a rule says "not my shape" and hands the value back to the coverage check.
type ValueCover = { map?: Readonly<Record<string, string>>; rule?: (v: string) => string | null; why?: string };

export const ENUM_DE: Readonly<Record<string, ValueCover>> = {
  // --- genuinely English words a German buyer would notice ------------------------------------------------
  airflow: { map: {
    "front-to-back": "Vorne nach hinten", "back-to-front": "Hinten nach vorne", side: "Seitlich",
    reversible: "Umkehrbar", "port-side-intake": "Ansaugung auf der Portseite", "port-side-exhaust": "Abluft auf der Portseite" } },
  cooling: { map: { fanless: "Lüfterlos", "fixed-fans": "Feste Lüfter", "redundant-replaceable": "Redundant, wechselbar" } },
  psu_config: { map: {
    "fixed-internal": "Fest eingebaut", "modular-single": "Modular, ein Netzteil",
    "modular-redundant": "Modular, redundant", external: "Extern" } },
  temp_class: { map: { commercial: "Kommerziell", extended: "Erweitert", industrial: "Industriell" } },
  license_type: { map: {
    perpetual: "Unbefristet", subscription: "Abonnement", term: "Laufzeit", trial: "Testversion", embedded: "Integriert" } },
  delivery_method: { map: { electronic: "Elektronisch", physical: "Physisch" } },
  antenna_type: { map: { internal: "Intern", external: "Extern" } },
  dac_type: { map: { passive: "Passiv", active: "Aktiv" } },
  mic_type: { map: {
    omnidirectional: "Omnidirektional", unidirectional: "Unidirektional", array: "Mikrofon-Array", beamforming: "Beamforming" } },
  // BOTH, because its domain differs by category: the chassis words in `switches` and every optic form factor in
  // `transceiver` (DOMAIN_OVERRIDES). 1,742 live facts hold the optic side.
  // The chassis words, the four UCS server shapes (DOMAIN_OVERRIDES on the three UCS categories), and a rule for the
  // optic cages the transceiver override adds. The UCS four are MAPPED because `presentFormFactor` now refuses them:
  // until 26 Sep they fell through it and rendered as "BLADE-HALF" / "COMPUTE-NODE" / "ROUTER-MODULE".
  form_factor: { map: {
    "rack-19": "19-Zoll-Rack", desktop: "Desktop", "din-rail": "Hutschiene", "modular-chassis": "Modulares Chassis",
    "blade-half": "Blade, halbe Breite", "blade-full": "Blade, volle Breite",
    "compute-node": "Compute-Node", "router-module": "Router-Modul" },
    rule: presentFormFactor, why: "the transceiver override domain carries the optic form factors" },
  // The German networking trade sells these under the English words; translating them would be less clear, not
  // more. Written down as a decision rather than left to a pass-through.
  mgmt_class: { map: { managed: "Managed", "smart-managed": "Smart Managed", unmanaged: "Unmanaged" } },
  deploy_role: { map: {
    smb: "KMU", access: "Access", "core-agg": "Core/Aggregation", datacenter: "Rechenzentrum", industrial: "Industrie",
    indoor: "Innenbereich", outdoor: "Außenbereich", "mesh-extender": "Mesh-Extender", branch: "Filiale", edge: "Edge",
    "industrial-iot": "Industrielles IoT", "sp-access": "SP-Access", "sp-edge": "SP-Edge", "sp-core": "SP-Core",
    desk: "Tischgerät", wireless: "Drahtlos", dect: "DECT", conference: "Konferenz" } },

  // --- technical tokens: the German is the PRESENTED form of the same token ---------------------------------
  media: { map: {
    mmf: "Multimode-Faser (MMF)", smf: "Singlemode-Faser (SMF)", "dac-copper": "DAC-Kupfer",
    "rj45-copper": "RJ45-Kupfer", aoc: "AOC (aktives optisches Kabel)" } },
  connector: { map: {
    "lc-duplex": "LC-Duplex", "lc-simplex": "LC-Simplex", sc: "SC", "mpo-12": "MPO-12", "mpo-16": "MPO-16",
    "mpo-24": "MPO-24", rj45: "RJ45", integrated: "Fest angeschlossen" } },
  antenna_connector: { map: { "rp-tnc": "RP-TNC", "n-type": "N-Type", qma: "QMA", sma: "SMA", mmcx: "MMCX" } },
  layer: { map: { l2: "Layer 2", l2plus: "Layer 2+", l3: "Layer 3" } },
  mode: { map: { duplex: "Duplex", "simplex-bidi": "Simplex BiDi", "duplex-bidi": "Duplex BiDi" } },
  fec: { map: { none: "Keine", "rs-fec": "RS-FEC", "fc-fec": "FC-FEC", "host-dependent": "Host-abhängig" } },
  laser_type: { map: { vcsel: "VCSEL", fp: "FP", dfb: "DFB", eml: "EML" } },
  poe_standard: { map: {
    none: "Kein PoE", "802.3af": "IEEE 802.3af (PoE)", "802.3at": "IEEE 802.3at (PoE+)",
    "802.3bt-t3": "IEEE 802.3bt Typ 3", "802.3bt-t4": "IEEE 802.3bt Typ 4", upoe: "Cisco UPOE", "upoe-plus": "Cisco UPOE+" } },
  drive_interface: { map: {
    sas: "SAS", "sas-3": "SAS-3", sata: "SATA", nvme: "NVMe", pcie: "PCIe", "u.2": "U.2", "u.3": "U.3", "m.2": "M.2" } },
  drive_form_factor: { map: {
    "2.5": "2,5 Zoll", "3.5": "3,5 Zoll", "m.2": "M.2", "e1.s": "E1.S", "e3.s": "E3.S", "u.2": "U.2", "u.3": "U.3" } },
  fiber_type: { map: { om1: "OM1", om2: "OM2", om3: "OM3", om4: "OM4", om5: "OM5", os1: "OS1", os2: "OS2" } },
  wifi_generation: { map: {
    "wi-fi 4": "Wi-Fi 4", "wi-fi 5": "Wi-Fi 5", "wi-fi 6": "Wi-Fi 6", "wi-fi 6e": "Wi-Fi 6E", "wi-fi 7": "Wi-Fi 7" } },
  // Shape-checked like presentFormFactor: NxM or NxM:S and nothing else, so a value this rule was not written
  // for is reported as uncovered instead of being uppercased into nonsense.
  spatial_streams: { rule: (v) => (/^[0-9]+x[0-9]+(:[0-9]+)?$/.test(v) ? v.toUpperCase().replace("X", "×") : null),
    why: "an antenna configuration: 4x4:4 presents as 4×4:4 in any language" },
  vendor: { map: {
    cisco: "Cisco", hpe: "HPE", aruba: "Aruba", juniper: "Juniper", arista: "Arista", "dell-emc": "Dell EMC",
    lenovo: "Lenovo", extreme: "Extreme Networks", fortinet: "Fortinet", nvidia: "NVIDIA", mikrotik: "MikroTik",
    ubiquiti: "Ubiquiti", supermicro: "Supermicro" } },
  form_factor_a: { rule: presentFormFactor, why: "an optic form factor is one token in every language; see presentFormFactor" },
  form_factor_b: { rule: presentFormFactor, why: "the same, for the far side of a breakout" },
  ip_rating: { rule: (v) => (/^ip[0-9x]{2}k?$/.test(v) ? v.toUpperCase() : null),
    why: "80 values of the form ipNN; eighty map entries would be eighty chances to mistype one" },
  regulatory_domain: { map: {
    a: "A", b: "B", c: "C", d: "D", e: "E", f: "F", g: "G", h: "H", i: "I", j: "J", k: "K", l: "L", m: "M",
    n: "N", p: "P", q: "Q", r: "R", s: "S", t: "T", z: "Z", na: "Nordamerika", "nam-lam": "Nordamerika/Lateinamerika",
    row: "Übrige Welt", universal: "Universal" } },
};

/**
 * `sfp-plus` is not what a datasheet prints. SFP+ is.
 *
 * AND IT REFUSES WHAT IT WAS NOT WRITTEN FOR, which it did not until 26 Sep 2026. `form_factor`'s domain is per
 * category: the optic cages in `transceiver`, and in the three UCS categories `blade-half`, `blade-full`,
 * `compute-node`, `router-module`. Those four fell through to this rule and rendered as **"BLADE-HALF"**,
 * "BLADE-FULL", "COMPUTE-NODE", "ROUTER-MODULE" — shouting English in a German shop cell.
 *
 * `uncoveredEnumValues()` could not catch it, and that is the general lesson: **a rule always returns something, so
 * the coverage check is vacuous for every value a rule covers** (measured: 159 values have an explicit map entry,
 * 149 are rule-only). The check reported 0 uncovered while four values were wrong. So a rule now states the shape it
 * accepts and returns null outside it — which turns those four into a gap the check CAN see, and they are mapped
 * below. This is "write the guard against the CONDITION": the rule's job is optic cages, so it says so.
 */
const CAGE = /^(gbic|x2|xenpak|xfp|sfp|sfp-plus|sfp28|sfp56|sfp-dd|dsfp|qsfp-plus|qsfp28|qsfp56|qsfp112|qsfp-dd|cfp|cfp2|cpak|osfp|osfp-xd|sfp112|rj45)$/;
function presentFormFactor(v: string): string | null {
  if (!CAGE.test(v)) return null;
  const base = v.replace(/-plus$/, "+").replace(/-dd$/, "-DD");
  return base.toUpperCase();
}

/** The German for one enum value, or null when the contract does not cover it. */
export function enumValueDe(key: string, value: string): string | null {
  const cover = ENUM_DE[key];
  if (!cover) return null;
  const mapped = cover.map?.[value];
  if (mapped) return mapped;
  return cover.rule ? (cover.rule(value) || null) : null;
}

/**
 * THE CHECK THAT KEEPS THIS HONEST. Driven from the DICTIONARY's domains, never from a list kept here, so an
 * enum value added tomorrow is named rather than shipped as an English slug. Returns every (key, value) the
 * contract does not cover, and every enum key with no covering at all.
 */
/**
 * EVERY value an enum key may hold in ANY category, unioned. A domain is per category — reading only
 * `dict[key].domain` is what made the first version of the coverage check answer 0 while 23 values of
 * `form_factor` were uncovered and 1,742 live facts were refused. The union is the right population for
 * BOTH callers, because ENUM_DE is keyed by KEY and not by category: a value legal in any one category
 * must be covered once. Extracted 26 Sep 2026 so `renderValue` and `uncoveredEnumValues` cannot drift.
 */
export function enumDomainUnion(dict: typeof FIELD_DICTIONARY = FIELD_DICTIONARY): ReadonlyMap<string, ReadonlySet<string>> {
  const hit = UNION_CACHE.get(dict);
  if (hit) return hit;
  const domains = new Map<string, Set<string>>();
  for (const [key, def] of Object.entries(dict)) {
    const d = def as { type?: string; domain?: unknown };
    if (d.type !== "e" || !Array.isArray(d.domain)) continue;
    domains.set(key, new Set((d.domain as string[]).map(String)));
  }
  for (const keys of Object.values(DOMAIN_OVERRIDES)) {
    for (const [key, dom] of Object.entries(keys)) {
      if (!domains.has(key)) continue;                       // an override on a non-enum key is not this check's business
      for (const v of dom) domains.get(key)!.add(String(v));
    }
  }
  UNION_CACHE.set(dict, domains);
  return domains;
}
const UNION_CACHE = new WeakMap<object, Map<string, Set<string>>>();

export function uncoveredEnumValues(dict: typeof FIELD_DICTIONARY = FIELD_DICTIONARY): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const [key, dom] of enumDomainUnion(dict)) {
    if (!ENUM_DE[key]) { out.push({ key, value: "(no covering for this key at all)" }); continue; }
    for (const v of dom) if (!enumValueDe(key, v)) out.push({ key, value: v });
  }
  return out;
}

// ---- STRUCTS -------------------------------------------------------------------------------------------------
//
// THE DECLARED `shape` IS PROSE, AND FOR ONE KEY IT IS ALSO WRONG. `reach_max` declares
// `list{ medium: s, distanz: n(m) }` and stores `{"m":100,"values_m":[100]}` — a consumer parsing the declared
// shape would emit nonsense. So these renderers are written against what the store actually holds, sampled on
// 25 Sep 2026, and `tests/renderContract.test.ts` re-reads live rows so a payload change fails here rather than
// in someone's spreadsheet.
type StructRenderer = (v: unknown, unit?: string | null) => string | null;

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** `[{ port_typ, speed: string[], anzahl }]` -> "24 × RJ45 1G | 4 × SFP+ 10G". */
const renderPorts: StructRenderer = (v) => {
  if (!Array.isArray(v) || v.length === 0) return null;
  const parts: string[] = [];
  for (const g of v as { port_typ?: unknown; speed?: unknown; anzahl?: unknown }[]) {
    const n = num(g?.anzahl);
    const typ = typeof g?.port_typ === "string" ? (enumValueDe("form_factor_a", g.port_typ) ?? String(g.port_typ).toUpperCase()) : null;
    const speeds = Array.isArray(g?.speed) ? (g.speed as unknown[]).filter((s) => typeof s === "string").join("/") : null;
    if (n === null || !typ) return null;
    parts.push(`${formatNumberDe(n)} × ${typ}${speeds ? ` ${speeds}` : ""}`);
  }
  return parts.join(LIST_SEPARATOR);
};

export const STRUCT_DE: Readonly<Record<string, StructRenderer>> = {
  // stored {h,w,d} in mm — the declared shape and the store agree
  dimensions: (v, unit) => {
    const o = v as { h?: unknown; w?: unknown; d?: unknown };
    const h = num(o?.h), w = num(o?.w), d = num(o?.d);
    if (h === null || w === null || d === null) return null;
    const u = unit?.trim() || "mm";
    return `H ${formatNumberDe(h)} × B ${formatNumberDe(w)} × T ${formatNumberDe(d)} ${u}`;
  },
  // stored {m, values_m[]} — NOT the declared `list{ medium, distanz }`
  reach_max: (v, unit) => {
    const o = v as { m?: unknown; values_m?: unknown };
    const m = num(o?.m);
    if (m !== null) return formatQuantityDe(m, unit?.trim() || "m");
    if (Array.isArray(o?.values_m)) {
      const xs = (o.values_m as unknown[]).map(num).filter((x): x is number => x !== null);
      if (xs.length) return xs.map((x) => formatQuantityDe(x, unit?.trim() || "m")).join(LIST_SEPARATOR);
    }
    return null;
  },
  ports: renderPorts,
  uplink_ports: renderPorts,
  // stored {w,h} pixels
  video_quality_max: (v) => renderPixels(v),
  max_resolution: (v) => renderPixels(v),
  display_resolution: (v) => renderPixels(v),
  bidi_wavelengths: (v, unit) => {
    const o = v as { tx?: unknown; rx?: unknown };
    const tx = num(o?.tx), rx = num(o?.rx);
    if (tx === null || rx === null) return null;
    const u = unit?.trim() || "nm";
    return `TX ${formatNumberDe(tx)} ${u} / RX ${formatNumberDe(rx)} ${u}`;
  },
  antenna_gain: (v, unit) => {
    const o = v as { band24?: unknown; band5?: unknown };
    const a = num(o?.band24), b = num(o?.band5);
    const u = unit?.trim() || "dBi";
    const bits = [a !== null ? `2,4 GHz: ${formatNumberDe(a)} ${u}` : null, b !== null ? `5 GHz: ${formatNumberDe(b)} ${u}` : null].filter(Boolean);
    return bits.length ? bits.join(" / ") : null;
  },
  // expansion_io is DELIBERATELY ABSENT. It is typed `struct` and declares NO shape at all, so there is nothing
  // to render against; it holds 0 facts, which is the only reason that has cost nothing so far. `renderValue`
  // refuses it by name, and the refusal is the fix: the first fact written under it fails loudly here instead of
  // reaching a spreadsheet as "[object Object]".
};

const renderPixels: StructRenderer = (v) => {
  const o = v as { w?: unknown; h?: unknown };
  const w = num(o?.w), h = num(o?.h);
  return w === null || h === null ? null : `${formatNumberDe(w)} × ${formatNumberDe(h)}`;
};

// ---- THE ONE CALL A CONSUMER MAKES ----------------------------------------------------------------------------

export type Rendering = { ok: true; text: string } | { ok: false; why: string };

/**
 * One stored value -> one German cell, or a refusal naming why. `value`, `unit` and the key are exactly what
 * `/v1/parts/{vendor}/{sku}` and `/v1/export` return per fact.
 *
 * `type` OVERRIDES THE CODE DICTIONARY ON PURPOSE. The API reads `field_dictionary` — the TABLE — because the FK
 * from `facts` points there, so the table is what a stored fact actually references; this file is code. They are
 * kept equal by `syncDictionaryOn` and a drift between them is exactly the thing neither side should paper over.
 * Passing the row's own type renders the fact against what it references, so a drift becomes a visible wrong
 * rendering or refusal rather than this file quietly deciding the table is wrong.
 */
export function renderValue(key: string, value: unknown, unit?: string | null, type?: string): Rendering {
  const known = (FIELD_DICTIONARY as Record<string, { type?: string } | undefined>)[key];
  if (!known && type === undefined) return { ok: false, why: `"${key}" is not in the dictionary` };
  const def = { type: type ?? known?.type };
  if (value === null || value === undefined) return { ok: false, why: `no value` };
  switch (def.type) {
    case "s":
      return typeof value === "string" ? { ok: true, text: value } : { ok: false, why: `expected a string, got ${typeof value}` };
    case "b":
      return typeof value === "boolean" ? { ok: true, text: BOOLEAN_DE[String(value) as "true" | "false"] } : { ok: false, why: `expected a boolean` };
    case "n": {
      const n = num(value);
      return n === null ? { ok: false, why: `expected a number, got ${JSON.stringify(value)}` } : { ok: true, text: formatQuantityDe(n, unit) };
    }
    case "nr": {
      const o = value as { min?: unknown; max?: unknown };
      const lo = num(o?.min), hi = num(o?.max);
      return lo === null || hi === null ? { ok: false, why: `a range needs {min,max}` } : { ok: true, text: formatRangeDe(lo, hi, unit) };
    }
    case "e": {
      if (typeof value !== "string") return { ok: false, why: `an enum value must be a string` };
      const de = enumValueDe(key, value);
      // NOT a pass-through: a value the contract does not cover is a REFUSAL, so a domain that grew without the
      // contract growing with it is visible instead of shipping the English slug into a German shop.
      if (de) return { ok: true, text: de };
      // THREE STATES, BECAUSE THE REPAIR IS DIFFERENT AND THE OLD MESSAGE NAMED THE WRONG ONE (26 Sep 2026).
      // Until today every uncovered value read "add it to ENUM_DE". The JTL consumer lens then found 99
      // `antenna_connector` facts holding "RP-TNC"/"N-type" against a domain of `rp-tnc`/`n-type` — so the message
      // was telling a reader to add a CASE VARIANT to the German contract, which would have legitimised an
      // out-of-domain value and put two spellings of one connector on a shop page. Measured across all vendors:
      // 596 of 22,431 current enum facts are out of their domain, 422 of them by case alone, and today's
      // normaliser already returns the lowercase slug for the same raw — so they are a residue a re-derivation
      // clears, never a contract gap. A value the contract genuinely does not cover still says ENUM_DE.
      const dom = enumDomainUnion().get(key);
      if (!dom || dom.has(value)) return { ok: false, why: `no German rendering for "${key}" = "${value}" — a CONTRACT GAP: add it to ENUM_DE` };
      const variant = [...dom].find((d) => d.toLowerCase() === value.toLowerCase());
      return variant
        ? { ok: false, why: `"${key}" = "${value}" is an UNNORMALISED variant of the domain value "${variant}" — re-derive the fact (renormalize). Do NOT add it to ENUM_DE.` }
        : { ok: false, why: `"${key}" = "${value}" is not a value of this key's domain at all — a DATA defect (the fact needs re-reading or withdrawing), not a contract gap` };
    }
    case "ls": {
      if (!Array.isArray(value)) return { ok: false, why: `a list value must be an array` };
      const xs = value.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim());
      return xs.length ? { ok: true, text: xs.join(LIST_SEPARATOR) } : { ok: false, why: `the list holds no readable entry` };
    }
    case "struct": {
      const r = STRUCT_DE[key];
      if (!r) return { ok: false, why: `"${key}" is a struct with no renderer${(FIELD_DICTIONARY as Record<string, { shape?: unknown }>)[key]?.shape ? "" : " (and no declared shape)"}` };
      const text = r(value, unit);
      return text ? { ok: true, text } : { ok: false, why: `"${key}" did not match its stored shape: ${JSON.stringify(value).slice(0, 120)}` };
    }
    default:
      return { ok: false, why: `unknown type "${String(def.type)}" for "${key}"` };
  }
}
