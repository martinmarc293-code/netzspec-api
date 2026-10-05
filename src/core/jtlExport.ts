// src/core/jtlExport.ts — THE JTL EXPORT CONTRACT (reviewer rulings Q12 + Q18, 29 Sep 2026). Pure: no database, no I/O.
//
// Q12: "the standing order wins: FOUR profiles, 18-column Main, 4-column Attributes (ONE profile across all categories, the
// existing 'Switches' and 'Transceivers & SFP Modul' group and attribute names exact), the check asserts the contract, not a
// 200." Q18: "THE NEW FORMATS WIN (the hexcat files are pre-September): Attributes 4 (Artikelnummer, Attributgruppe,
// Attributname, Attributwert); Condition 3 (Artikelnummer, Attributname, Attributwert); FAQ 3 (Artikelnummer, Attributname
// 'FAQ', Attributwert = Q||A pairs joined by ##); Main 18 incl. URL-Pfad, Titel-Tag (SEO), Meta-Description (SEO) (the export
// is the shop's surface). Groups exactly as in Wawi: 'Switch' (20 attributes), 'Transceivers & SFP Modul' (14)."
//
// WHAT IS TAKEN FROM THE RECORDED FILES, AND ONLY THAT (hexcat output, read 29 Sep 2026): the byte contract (UTF-8 with BOM,
// CRLF, Main ';' and the long files ','), the Wawi attribute names and their sort order, the constant Main columns
// (Hersteller Cisco, Versandklasse standard, Verkaufseinheit Stk, Kategorie Ebene 1, the two Ebene-2 names, Y / Y), and the
// Kat-3 shapes ("Cisco <series> Switches", a transceiver's form factor, "DAC Kabel" / "AOC Kabel"). NOT the values: every
// attribute value comes from a stored fact through the German rendering contract (renderContract.ts), so a value the store
// does not hold is ABSENT from the file, never written from the recorded one.
//
// THE HEXCAT GUARDRAILS THAT BECAME RULES HERE (memory: hexcat-guardrails): R2 no condition / sealing / newness prose in any
// text (condition lives only in the Condition profile); R3 the URL path is one '/' and nothing but [a-z0-9-] on either side;
// R4 Kat-3 is the true part type (AOC is not DAC); R6 a weight is a stored fact or nothing -- never an estimate.
import { renderValue, formatNumberDe, LIST_SEPARATOR } from "./renderContract.js";
import { FIELD_DICTIONARY, COLUMN_BACKED, RELATION_BACKED } from "./fieldSchema.js";
import { shippingClassOf } from "./shippingClass.js";

// ---- THE BYTE CONTRACT ---------------------------------------------------------------------------------------------------
// Written without escapes on purpose: a BOM typed as an escape through an editing tool has arrived in this repo as the raw
// invisible character before (CLAUDE.md section 4), and a CRLF typed the same way is the same risk.
export const BOM = String.fromCharCode(0xfeff);
export const CRLF = String.fromCharCode(13, 10);

export const JTL_PROFILES = ["jtl-main", "jtl-attributes", "jtl-condition", "jtl-faq"] as const;
export type JtlProfile = (typeof JTL_PROFILES)[number];

export const MAIN_HEADER = [
  "Artikelnummer", "Artikelname", "Kurzbeschreibung", "Beschreibung", "URL-Pfad", "Artikelgewicht", "Versandgewicht", "HAN",
  "Hersteller", "Versandklasse", "Verkaufseinheit", "Titel-Tag (SEO)", "Meta-Description (SEO)", "Kategorie Ebene 1",
  "Kategorie Ebene 2", "Kategorie Ebene 3", "Bestandsführung aktiv", "Überverkäufe möglich",
] as const;

export const JTL_FILES: Readonly<Record<JtlProfile, { delimiter: ";" | ","; header: readonly string[]; forceQuote: readonly number[] }>> = {
  "jtl-main": { delimiter: ";", header: MAIN_HEADER, forceQuote: [] },
  "jtl-attributes": { delimiter: ",", header: ["Artikelnummer", "Attributgruppe", "Attributname", "Attributwert"], forceQuote: [] },
  "jtl-condition": { delimiter: ",", header: ["Artikelnummer", "Attributname", "Attributwert"], forceQuote: [] },
  // the FAQ cell is ALWAYS quoted: the recorded importer demands it (memory: hexcat-csv-byte-format-gotchas)
  "jtl-faq": { delimiter: ",", header: ["Artikelnummer", "Attributname", "Attributwert"], forceQuote: [2] },
};

const QUOTE = String.fromCharCode(34);
/** One CSV field: quoted when it holds the delimiter, a quote, CR or LF (quotes doubled), or when the column is forced. */
export function csvField(v: string, delimiter: string, force = false): string {
  const needs = force || v.includes(delimiter) || v.includes(QUOTE) || v.includes(String.fromCharCode(13)) || v.includes(String.fromCharCode(10));
  return needs ? QUOTE + v.split(QUOTE).join(QUOTE + QUOTE) + QUOTE : v;
}
/** A whole file: BOM, the profile's header, one CRLF-terminated line per row. */
export function csvFile(profile: JtlProfile, rows: readonly (readonly string[])[]): string {
  const f = JTL_FILES[profile];
  // the forced quote is a DATA-cell rule (the recorded FAQ header row is unquoted: `Artikelnummer,FAQ`)
  const line = (cells: readonly string[], data: boolean) => cells.map((c, i) => csvField(c, f.delimiter, data && f.forceQuote.includes(i))).join(f.delimiter);
  for (const r of rows) if (r.length !== f.header.length) throw new Error(`${profile}: a row has ${r.length} cells, the header ${f.header.length}`);
  return BOM + [line(f.header, false), ...rows.map((r) => line(r, true))].map((l) => l + CRLF).join("");
}

// ---- THE PART, AS THE EXPORT SEES IT ----------------------------------------------------------------------------------------
/** `raw` is the stored raw: for a router throughput it carries the printed label ("<label> | <cell>"), which is where the
 *  measurement basis lives (ruling (a), 5 Oct 2026). Optional: no other attribute reads it. */
export type Fact = { value: unknown; unit: string | null; raw?: string | null };
export type PartView = {
  sku: string; name: string | null; nameState: string | null; slug: string; category: string; categoryDe: string;
  kind: string | null; series: string | null; subBrand: string | null;
  /** the COLUMN-backed deploy role (deployRole.ts), which no fact carries -- the Switch group's "Anwendung" */
  deployRole: string | null;
  /** current, served facts by key (own or inherited -- the part page's view) */
  facts: ReadonlyMap<string, Fact>;
  /** the mould's REQUIRED cups for this part's (category, kind) -- kindQuestionSet(...).required, handed in by the caller */
  required: ReadonlySet<string>;
};

const text = (p: PartView, key: string): string | null => {
  const f = p.facts.get(key);
  if (!f) return null;
  const type = (FIELD_DICTIONARY as Record<string, { type?: string } | undefined>)[key]?.type;
  const r = renderValue(key, f.value, f.unit, type);
  return r.ok ? r.text : null;
};

// ---- THE TWO WAWI GROUPS ----------------------------------------------------------------------------------------------------
/** A Wawi attribute: its exact name, its sort number, the mould cups it is read from, and how the value is written. */
export type JtlAttribute = { name: string; sort: number; cups: readonly string[]; value: (p: PartView) => string | null };

const portsTotal = (p: PartView): string | null => {
  const v = p.facts.get("ports")?.value;
  if (!Array.isArray(v) || !v.length) return null;
  let n = 0;
  for (const g of v as { anzahl?: unknown }[]) { if (typeof g?.anzahl !== "number") return null; n += g.anzahl; }
  return formatNumberDe(n);
};
const portSpeeds = (p: PartView): string | null => {
  const v = p.facts.get("ports")?.value;
  if (!Array.isArray(v)) return null;
  const s = [...new Set((v as { speed?: unknown }[]).flatMap((g) => (Array.isArray(g?.speed) ? g.speed : []).filter((x): x is string => typeof x === "string")))];
  return s.length ? s.join(LIST_SEPARATOR) : null;
};
const withSuffix = (base: string | null, extra: string | null, join: string) => (base ? (extra ? `${base}${join}${extra}` : base) : null);

/** The recorded 'Switch' group (Wawi), 20 attributes in their sort order. */
export const SWITCH_GROUP: { group: string; attributes: readonly JtlAttribute[] } = {
  group: "Switch",
  attributes: [
    { name: "Switch-Typ", sort: 1, cups: ["mgmt_class"], value: (p) => text(p, "mgmt_class") },
    { name: "Layer", sort: 2, cups: ["layer"], value: (p) => text(p, "layer") },
    { name: "Portanzahl", sort: 3, cups: ["ports"], value: portsTotal },
    { name: "Port-Konfiguration", sort: 4, cups: ["ports"], value: (p) => text(p, "ports") },
    { name: "Port-Geschwindigkeit", sort: 5, cups: ["ports"], value: portSpeeds },
    { name: "Uplink-Ports", sort: 6, cups: ["uplink_ports"], value: (p) => text(p, "uplink_ports") },
    { name: "PoE", sort: 7, cups: ["poe_standard", "poe_budget"], value: (p) => withSuffix(text(p, "poe_standard"), text(p, "poe_budget") && `${text(p, "poe_budget")} Budget`, ", ") },
    { name: "Switching-Kapazität", sort: 8, cups: ["switching_capacity"], value: (p) => text(p, "switching_capacity") },
    { name: "Durchsatz", sort: 9, cups: ["forwarding_rate"], value: (p) => text(p, "forwarding_rate") },
    { name: "Bauform", sort: 10, cups: ["form_factor", "rack_units"], value: (p) => withSuffix(text(p, "form_factor"), text(p, "rack_units"), ", ") },
    { name: "Stromversorgung", sort: 11, cups: ["psu_config", "input_voltage"], value: (p) => withSuffix(text(p, "psu_config"), text(p, "input_voltage"), ", ") },
    { name: "Kühlung", sort: 12, cups: ["cooling"], value: (p) => text(p, "cooling") },
    { name: "Stacking", sort: 13, cups: ["stackable", "stack_max_members"], value: (p) => withSuffix(text(p, "stackable"), text(p, "stack_max_members") && `bis zu ${text(p, "stack_max_members")} Switches`, ", ") },
    { name: "Betriebstemperatur", sort: 14, cups: ["temp_operating"], value: (p) => text(p, "temp_operating") },
    { name: "Anwendung", sort: 15, cups: ["deploy_role"], value: (p) => { if (!p.deployRole) return null; const r = renderValue("deploy_role", p.deployRole); return r.ok ? r.text : null; } },
    { name: "Steckplätze", sort: 16, cups: ["module_slots"], value: (p) => text(p, "module_slots") },
    // relation-backed (the supervisors a chassis takes): no stored fact carries it, so it is never written and never required
    { name: "Unterstützte Supervisor-Engines", sort: 17, cups: [], value: () => null },
    { name: "Redundanz", sort: 18, cups: ["redundancy", "psu_redundant"], value: (p) => text(p, "redundancy") ?? (p.facts.get("psu_redundant")?.value === true ? "Netzteil" : null) },
    { name: "Modultyp", sort: 19, cups: ["module_type"], value: (p) => text(p, "module_type") },
    { name: "Kompatible Serie", sort: 20, cups: ["product_compatibility"], value: (p) => text(p, "product_compatibility") },
  ],
};

/** The recorded 'Transceivers & SFP Modul' group (Wawi), 14 attributes in their sort order. */
export const TRANSCEIVER_GROUP: { group: string; attributes: readonly JtlAttribute[] } = {
  group: "Transceivers & SFP Modul",
  attributes: [
    { name: "Formfaktor", sort: 1, cups: ["form_factor"], value: (p) => text(p, "form_factor") },
    { name: "Geschwindigkeit", sort: 2, cups: ["data_rate"], value: (p) => text(p, "data_rate") },
    { name: "Transceiver Typ", sort: 3, cups: ["transceiver_type"], value: (p) => text(p, "transceiver_type") },
    { name: "Fasertyp", sort: 4, cups: ["media", "fiber_type"], value: (p) => withSuffix(text(p, "media"), text(p, "fiber_type"), ", ") },
    { name: "Faseranzahl", sort: 5, cups: ["fiber_count"], value: (p) => text(p, "fiber_count") },
    { name: "Anschlusstyp", sort: 6, cups: ["connector"], value: (p) => text(p, "connector") },
    { name: "Länge", sort: 7, cups: ["cable_length"], value: (p) => text(p, "cable_length") },
    { name: "Wellenlänge", sort: 8, cups: ["wavelength"], value: (p) => text(p, "wavelength") },
    { name: "Kabeltyp", sort: 9, cups: ["cable_construction"], value: (p) => text(p, "cable_construction") },
    { name: "Reichweite", sort: 10, cups: ["reach_max"], value: (p) => text(p, "reach_max") },
    { name: "Anwendung", sort: 11, cups: ["application"], value: (p) => text(p, "application") },
    { name: "DOM Unterstützung", sort: 12, cups: ["ddm"], value: (p) => text(p, "ddm") },
    { name: "Betriebstemperatur", sort: 13, cups: ["temp_operating"], value: (p) => text(p, "temp_operating") },
    { name: "Standard", sort: 14, cups: ["standard", "ieee_standards"], value: (p) => text(p, "standard") ?? text(p, "ieee_standards") },
  ],
};

// ---- ROUTER THROUGHPUT: THE VALUE WITH ITS BASIS (reviewer ruling (a), 5 Oct 2026) ---------------------------------------------
// Cisco prints a router's throughput on different bases per series -- IPv4 forwarding at 1400 or 512 bytes, IMIX, NAT (RV), the
// default-licence aggregate (ISR 4000) -- and the bases are not comparable: an IMIX figure is a fraction of a 1400-byte one. So
// "System-Durchsatz" is rendered WITH the basis the sheet printed ("1,5 Gbit/s (IPv4, 1400 Byte)"), never as a bare number that
// invites a false comparison. The basis is read off the LABEL apply-extract keeps in the fact's raw ("<label> | <cell>"); a raw
// with no readable basis renders NOTHING -- the attribute is then a gap, which is an answer, where a bare number would be a claim.
// Explicit patterns, no \b (product strings: CLAUDE.md).
export const THROUGHPUT_BASES: readonly (readonly [RegExp, string])[] = [
  [/imix/i, "IPv4, IMIX"],
  [/(?<![0-9])1400\s*bytes?/i, "IPv4, 1400 Byte"],
  [/\(\s*512\s*b(?:ytes?)?\s*\)/i, "512 Byte"],
  [/(?<![a-z])nat\s+throughput/i, "NAT"],
  [/aggregate\s+throughput\s*\(\s*default\s*\)/i, "Aggregat, Standardlizenz"],
];
/** The German basis of a stored router-throughput raw, or null when the raw names none (a bare cell, or an unknown label). */
export function throughputBasisDe(raw: string | null | undefined): string | null {
  const s = String(raw ?? "");
  const cut = s.indexOf(" | ");
  if (cut < 0) return null;
  const label = s.slice(0, cut);
  return THROUGHPUT_BASES.find(([re]) => re.test(label))?.[1] ?? null;
}
const throughputText = (p: PartView): string | null => {
  const v = text(p, "router_throughput");
  const basis = throughputBasisDe(p.facts.get("router_throughput")?.raw);
  return v && basis ? `${v} (${basis})` : null;
};

/** The group a category exports under. Switches and transceivers carry the recorded Wawi groups; every other category is
 *  published from the mould: its German category name, one attribute per REQUIRED cup (German label, rendered value). */
export function groupFor(p: PartView): { group: string; attributes: readonly JtlAttribute[] } {
  if (p.category === "switches") return SWITCH_GROUP;
  if (p.category === "transceiver") return TRANSCEIVER_GROUP;
  const dict = FIELD_DICTIONARY as Record<string, { de?: string } | undefined>;
  // a relation-backed cup is answered by relations and a column-backed one by the parts row -- neither is a fact to render
  const cups = [...p.required].filter((k) => dict[k]?.de && !(k in RELATION_BACKED) && !COLUMN_BACKED.has(k)).sort((a, b) => (dict[a]!.de!).localeCompare(dict[b]!.de!, "de"));
  return { group: p.categoryDe, attributes: cups.map((k, i) => ({ name: dict[k]!.de!, sort: i + 1, cups: [k],
    value: k === "router_throughput" ? throughputText : (q: PartView) => text(q, k) })) };
}

// ---- THE MAIN ROW -----------------------------------------------------------------------------------------------------------
export const KAT1 = "Netzwerk & Infrastruktur";
const KAT2: Readonly<Record<string, string>> = { switches: "Switches", transceiver: "Transceivers & SFP Module" };
/** Kinds of the switches category that are a part FOR a switch, filed as "... Modules" in Kat-3 (recorded: "Cisco Nexus 7000 Modules"). */
const SWITCH_MODULE_KINDS = new Set(["supervisor", "linecard", "module", "fabric", "power", "fan", "flash", "memory", "drive"]);

export function kat3(p: PartView): string | null {
  if (p.category === "transceiver") {
    // R4: the TRUE part type. A cable says which cable it is (AOC is not DAC); an optic is its cage.
    const media = p.facts.get("media")?.value;
    if (p.kind === "cable" || p.kind === "breakout-cable") return media === "aoc" ? "AOC Kabel" : media === "dac-copper" ? "DAC Kabel" : null;
    return text(p, "form_factor");
  }
  if (!p.series) return null;
  const brand = p.subBrand && !p.series.startsWith(p.subBrand) ? `Cisco ${p.subBrand} ${p.series}` : `Cisco ${p.series}`;
  if (p.category === "switches") return `${brand} ${p.kind && SWITCH_MODULE_KINDS.has(p.kind) ? "Modules" : "Switches"}`;
  return brand;
}

/** R3: one '/', nothing but lowercase letters, digits and hyphens on either side. */
export const URL_PATH = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const urlPath = (p: PartView): string => `cisco/${p.slug}`;

/** R2: condition, sealing and newness prose never appears in a shop text; condition is the Condition profile's alone. */
export const BANNED_PHRASES: readonly RegExp[] = [
  /versiegelt/i, /neuware/i, /fabrikneu/i, /originalverpackt/i, /(?:^|[^a-z])ovp(?:[^a-z]|$)/i, /quality-?id/i, /refurbished/i, /gebraucht/i,
];
export const bannedIn = (s: string): string | null => BANNED_PHRASES.find((re) => re.test(s))?.source ?? null;

/** A name that is a name: the store calls it real, and it is not a bullet list pasted from a sheet. */
export function realName(p: PartView): boolean {
  const n = (p.name ?? "").trim();
  return p.nameState === "real" && n.length > 0 && !n.includes(String.fromCharCode(0x25cf));   // U+25CF, the sheets' bullet
}

const kg = (p: PartView, key: string): string | null => {
  const f = p.facts.get(key);
  if (!f || typeof f.value !== "number" || !Number.isFinite(f.value) || f.value <= 0) return null;
  // A transceiver's weight is stored in GRAMS (fieldSchema UNIT_OVERRIDES: "Weight on an optic is grams"), so it is converted
  // here -- refusing every unit but kg meant no transceiver could ever export a weight, however many the store held (latent
  // until 30 Sep 2026: no vendor held one). Any other unit is refused, never guessed.
  const value = f.unit === "g" ? f.value / 1000 : !f.unit || f.unit === "kg" ? f.value : null;
  if (value === null) return null;
  // to the gram, German comma, no padding: a transceiver's 0.075 kg must not round to 0,07 or 0,08
  return formatNumberDe(Math.round(value * 1000) / 1000);
};

export type Resolved = { attr: JtlAttribute; value: string };
export function resolveAttributes(p: PartView): Resolved[] {
  return groupFor(p).attributes.flatMap((a) => { const v = a.value(p); return v ? [{ attr: a, value: v }] : []; });
}

const summary = (rs: readonly Resolved[], n: number) => rs.slice(0, n).map((r) => `${r.attr.name}: ${r.value}`).join(", ");
const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, s.lastIndexOf(" ", max - 1) > 0 ? s.lastIndexOf(" ", max - 1) : max - 1).replace(/[,:;\s]+$/, "") + "…");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function mainRow(p: PartView, rs: readonly Resolved[]): string[] {
  const k3 = kat3(p) ?? "";
  const series = p.series ? ` ${p.series}` : "";
  const title = `Cisco ${p.sku}${series} | Hexwaren`.length <= 60 ? `Cisco ${p.sku}${series} | Hexwaren` : `Cisco ${p.sku} | Hexwaren`;
  const kurz = `<p>${esc(p.name ?? "")}${rs.length ? `. ${esc(summary(rs, 3))}.` : "."}</p>`;
  const lang = rs.length ? `<ul>${rs.map((r) => `<li><strong>${esc(r.attr.name)}:</strong> ${esc(r.value)}</li>`).join("")}</ul>` : "";
  const meta = clip(`Cisco ${p.sku}${p.series ? ` (${p.series})` : ""}: ${summary(rs, 4) || (p.name ?? "")}.`, 155);
  return [p.sku, p.name ?? "", kurz, lang, urlPath(p), kg(p, "weight") ?? "", kg(p, "shipping_weight") ?? "", p.sku, "Cisco", "standard", "Stk",
    title, meta, KAT1, KAT2[p.category] ?? p.categoryDe, k3, "Y", "Y"];
}

/** One question per attribute, in the recorded shop's own voice (Hexwaren_Cisco_Switches_FAQ.csv: "Wie viele Ports hat der …?",
 *  "Lässt sich der … stapeln?", "Unterstützt der … PoE?", "Welche Uplinks hat der …?"). An attribute not listed is asked in one
 *  neutral form that needs no article: German gender varies by attribute, and a wrong article is a visible error. */
const FAQ_QUESTIONS: Readonly<Record<string, (sku: string) => string>> = {
  "Switch-Typ": (s) => `Was für ein Switch ist der ${s}?`,
  "Layer": (s) => `Auf welchem Layer arbeitet der ${s}?`,
  "Uplink-Ports": (s) => `Welche Uplinks hat der ${s}?`,
  "PoE": (s) => `Unterstützt der ${s} PoE?`,
  "Switching-Kapazität": (s) => `Welche Switching-Kapazität hat der ${s}?`,
  "Durchsatz": (s) => `Welchen Durchsatz erreicht der ${s}?`,
  "Bauform": (s) => `Welche Bauform hat der ${s}?`,
  "Stromversorgung": (s) => `Wie wird der ${s} mit Strom versorgt?`,
  "Stacking": (s) => `Lässt sich der ${s} stapeln?`,
  "Betriebstemperatur": (s) => `In welchem Temperaturbereich arbeitet der ${s}?`,
  "Formfaktor": (s) => `Welchen Formfaktor hat der ${s}?`,
  "Geschwindigkeit": (s) => `Welche Geschwindigkeit unterstützt der ${s}?`,
  "Anschlusstyp": (s) => `Welchen Anschluss hat der ${s}?`,
  "Reichweite": (s) => `Welche Reichweite hat der ${s}?`,
  "Wellenlänge": (s) => `Mit welcher Wellenlänge arbeitet der ${s}?`,
  "Gewicht": (s) => `Wie schwer ist der ${s}?`,
  "Abmessungen (H×B×T)": (s) => `Welche Abmessungen hat der ${s}?`,
  "Leistungsaufnahme (max.)": (s) => `Wie hoch ist die maximale Leistungsaufnahme des ${s}?`,
};
/** Folded into the ports question, never asked on their own: three questions about one port list is one answer said thrice. */
const FAQ_FOLDED = new Set(["Portanzahl", "Port-Konfiguration", "Port-Geschwindigkeit"]);

/** FAQ pairs DERIVED FROM FILLED CUPS (ruling, 29 Sep 2026: "FAQ -- generated from filled cups, a derivation, no acquisition"):
 *  the name, the series, then ONE question per resolved attribute in its Wawi order, and the weight when it is served. Every
 *  answer is a served fact through the German rendering contract. A fact is asked about ONCE: the pair that summarised up to
 *  five attributes is gone, because beside the per-attribute pairs it repeated them -- and it already asked the operating
 *  temperature twice, which is padding the 3-pair bar, not a third thing to say. */
export function faqCell(p: PartView, rs: readonly Resolved[]): string {
  const pairs: [string, string][] = [[`Was ist der Cisco ${p.sku}?`, `${p.name}.`]];
  if (p.series) pairs.push([`Zu welcher Serie gehört der ${p.sku}?`, `Der ${p.sku} gehört zur Cisco-Serie ${p.series}.`]);
  const byName = new Map(rs.map((r) => [r.attr.name, r.value]));
  const total = byName.get("Portanzahl"), config = byName.get("Port-Konfiguration");
  if (total || config) pairs.push([`Wie viele Ports hat der ${p.sku}?`,
    total ? `Der ${p.sku} bietet insgesamt ${total} Ports${config ? `: ${config}` : ""}.` : `Port-Konfiguration: ${config}.`]);
  for (const r of rs) {
    if (FAQ_FOLDED.has(r.attr.name)) continue;
    const q = FAQ_QUESTIONS[r.attr.name]?.(p.sku) ?? `Was gibt Cisco für „${r.attr.name}“ beim ${p.sku} an?`;
    pairs.push([q, `${r.attr.name}: ${r.value}.`]);
  }
  const w = kg(p, "weight");
  if (w && !byName.has("Gewicht")) pairs.push([`Wie schwer ist der ${p.sku}?`, `Der ${p.sku} wiegt ${w} kg.`]);
  return pairs.map(([q, a]) => `${q}||${a}`).join("##");
}

// ---- SHOP READY ---------------------------------------------------------------------------------------------------------------
/** The ruled gate (Q12): every group attribute the mould REQUIRES of this part resolves, a real name, a weight, a Kat-3, a
 *  sanitized URL path, no banned phrase, and 3+ FAQ pairs. Returns every reason, never just the first, so a count per reason
 *  says what a category is waiting on. */
export function shopReady(p: PartView): { ready: boolean; reasons: string[]; resolved: Resolved[] } {
  const reasons: string[] = [];
  const rs = resolveAttributes(p);
  const got = new Set(rs.map((r) => r.attr.name));
  for (const a of groupFor(p).attributes) {
    // not asked of this kind: not a gap. A RELATION-backed cup never is either: the mould counts a part with no relation as
    // not_held, out of the denominator (ruling 12a) -- so "Kompatible Serie" is written when a fact states it, never demanded.
    if (!a.cups.some((c) => p.required.has(c) && !(c in RELATION_BACKED))) continue;
    if (!got.has(a.name)) reasons.push(`attribute:${a.name}`);
  }
  // THE ONE-SET RULE, stated rather than implied. The four files carry ONE Artikelnummer set, so a ready part needs at least
  // one row in the Attributes file. This clause was missing and held only by accident: the old FAQ could reach three pairs
  // only through an attribute summary or the temperature, so every ready part happened to have one. When the FAQ became
  // one question per filled cup, 49 parts whose kind requires no group attribute (switch fans and fabric modules,
  // interfaces-modules 'interface') reached three pairs from name, series and weight -- and the served files broke the
  // one-set rule on the first deployed board (30 Sep 2026). A part with nothing to list is not ready, whatever else holds.
  if (!rs.length) reasons.push("attributes:none");
  if (!realName(p)) reasons.push("name");
  // FINAL FILL ORDER item 4 (30 Sep 2026): a SMALL COMPONENT (a kind the shipping-class table lists) may ship on its
  // Versandgewicht alone; its Artikelgewicht stays empty until a measured weight exists. Every other kind -- a device, a chassis
  // -- still needs a measured weight: the class table decides which, never the presence of a shipping weight.
  if (!kg(p, "weight") && !(shippingClassOf(p.category, p.kind) && kg(p, "shipping_weight"))) reasons.push("weight");
  if (!kat3(p)) reasons.push("kat3");
  if (!URL_PATH.test(urlPath(p))) reasons.push("url-path");
  const row = mainRow(p, rs), faq = faqCell(p, rs);
  const banned = [...row, faq, ...rs.map((r) => r.value)].map(bannedIn).find(Boolean);
  if (banned) reasons.push(`banned:${banned}`);
  if (faq.split("##").length < 3) reasons.push("faq<3");
  return { ready: reasons.length === 0, reasons, resolved: rs };
}

/** The four profiles' rows for one READY part. */
export function profileRows(p: PartView, rs: readonly Resolved[]): Record<JtlProfile, string[][]> {
  const g = groupFor(p).group;
  return {
    "jtl-main": [mainRow(p, rs)],
    "jtl-attributes": rs.map((r) => [p.sku, g, r.attr.name, r.value]),
    "jtl-condition": [[p.sku, "condition", "new"]],
    "jtl-faq": [[p.sku, "FAQ", faqCell(p, rs)]],
  };
}

// ---- THE CONTRACT, AS A CONSUMER CHECKS IT ------------------------------------------------------------------------------------
/** RFC 4180 records: quoted fields may hold the delimiter, doubled quotes and line breaks. Lines end CRLF. */
export function parseCsv(textIn: string, delimiter: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", i = 0, quoted = false;
  const t = textIn.charCodeAt(0) === 0xfeff ? textIn.slice(1) : textIn;
  while (i < t.length) {
    const ch = t[i];
    if (quoted) {
      if (ch === QUOTE) { if (t[i + 1] === QUOTE) { cell += QUOTE; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === QUOTE && cell === "") { quoted = true; i++; continue; }
    if (ch === delimiter) { row.push(cell); cell = ""; i++; continue; }
    if (t.startsWith(CRLF, i)) { row.push(cell); out.push(row); row = []; cell = ""; i += 2; continue; }
    cell += ch; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out;
}

/** Every way a served file breaks the recorded contract, named -- never just "invalid". Pure, for the verifier and its tests. */
export function jtlContractProblems(profile: JtlProfile, body: string, contentType: string | null): { problems: string[]; rows: string[][] } {
  const f = JTL_FILES[profile];
  const problems: string[] = [];
  if (!/^text\/csv/i.test(contentType ?? "")) problems.push(`content-type is ${JSON.stringify(contentType)}, not text/csv`);
  if (body.charCodeAt(0) !== 0xfeff) problems.push("no UTF-8 BOM");
  const lf = String.fromCharCode(10), cr = String.fromCharCode(13);
  // a bare LF inside a QUOTED cell is legal CSV; one OUTSIDE quotes is a line ending the importer does not expect
  let bareLf = 0, inQuote = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === QUOTE) inQuote = !inQuote;
    else if (ch === lf && !inQuote && body[i - 1] !== cr) bareLf++;
  }
  const lines = parseCsv(body, f.delimiter);
  if (bareLf) problems.push(`${bareLf} bare LF line ending(s)`);
  if (body.length && !body.endsWith(CRLF)) problems.push("the last line is not CRLF-terminated");
  const header = lines[0] ?? [];
  if (header.join("|") !== f.header.join("|")) problems.push(`header is ${JSON.stringify(header)}, the contract ${JSON.stringify(f.header)}`);
  const rows = lines.slice(1);
  rows.forEach((r, i) => { if (r.length !== f.header.length) problems.push(`row ${i + 1} has ${r.length} cells, the header ${f.header.length}`); });
  for (const r of rows) for (const c of r) { const b = bannedIn(c); if (b) { problems.push(`banned phrase /${b}/ in ${r[0]}`); break; } }
  if (profile === "jtl-main") for (const r of rows) {
    if (r[5] !== "" && !/^[0-9]+(,[0-9]+)?$/.test(r[5] ?? "")) problems.push(`${r[0]}: Artikelgewicht ${JSON.stringify(r[5])} is not a German decimal`);
    if (!URL_PATH.test(r[4] ?? "")) problems.push(`${r[0]}: URL-Pfad ${JSON.stringify(r[4])} breaks R3`);
    if (!r[15]) problems.push(`${r[0]}: no Kategorie Ebene 3`);
  }
  if (profile === "jtl-attributes") for (const r of rows) {
    const g = r[1] === SWITCH_GROUP.group ? SWITCH_GROUP : r[1] === TRANSCEIVER_GROUP.group ? TRANSCEIVER_GROUP : null;
    if (g && !g.attributes.some((a) => a.name === r[2])) problems.push(`${r[0]}: "${r[2]}" is not a Wawi attribute of the group "${r[1]}"`);
    if (!r[3]) problems.push(`${r[0]}: an empty value for "${r[2]}"`);
  }
  if (profile === "jtl-condition") for (const r of rows) if (r[1] !== "condition" || r[2] !== "new") problems.push(`${r[0]}: condition row ${JSON.stringify(r.slice(1))}`);
  if (profile === "jtl-faq") {
    for (const r of rows) {
      if (r[1] !== "FAQ") problems.push(`${r[0]}: Attributname ${JSON.stringify(r[1])}, not "FAQ"`);
      const pairs = (r[2] ?? "").split("##");
      if (pairs.length < 3 || pairs.some((pq) => pq.split("||").length !== 2)) problems.push(`${r[0]}: FAQ is not 3+ Q||A pairs joined by ##`);
    }
    // the value cell is FORCE-quoted: every data line's third field starts with a quote in the raw bytes
    const rawLines = body.slice(1).split(CRLF).slice(1).filter(Boolean);
    const unquoted = rawLines.filter((l) => { const parts = l.split(","); return parts.length >= 3 && !parts.slice(2).join(",").startsWith(QUOTE); });
    if (unquoted.length) problems.push(`${unquoted.length} FAQ line(s) with an unquoted value cell`);
  }
  return { problems, rows };
}
