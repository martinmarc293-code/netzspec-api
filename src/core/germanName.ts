// src/core/germanName.ts — does a stored part name carry German shop catalogue text? (layers review round 2, B.6, 14 Sep 2026)
//
// The tier-0 hexcat seed wrote German shop titles ("Cisco C9500-48X Catalyst-9500-Core-Switch (IOS XE, L3) – 48× 10G-SFP+, 1 HE")
// into parts.name. The operator's decision: the German text is kept in parts.name_de for every such row, parts.name is English —
// taken from the part's twin (X / X=) where that twin holds an English name — and a row with no English name anywhere keeps the
// German name, flagged name_lang = 'de'.
//
// THE DETECTOR is German-only markers with explicit lookarounds (no \b: product strings are not word-shaped). Built against the
// live names and read: a first version at "HE" / "×" / "bis" matched 900 switch rows, and a decimal comma alone read the English
// "MX - Pwr cable United States 4,5m" as German — both are controls below. Precision on a 48-row random sample: 48 of 48.
const L = "(?<![A-Za-zÄÖÜäöüß])", R = "(?![A-Za-zÄÖÜäöüß])";
export const GERMAN_MARKERS: readonly [string, string][] = [
  ["umlaut", "[äöüÄÖÜß]"],
  ["gemanagt", `${L}(?:cloud-)?gemanagte?[rs]?${R}`],
  ["steckplatz", "Steckpl[aä]tz"],
  ["modular-inflected", `${L}[Mm]odulare[rs]?${R}`],
  ["hoeheneinheit", "(?<![A-Za-z0-9])\\d{1,2}\\s?HE(?![A-Za-z])"],
  ["compound-noun", "(?:Data-Center|Campus|Access|Aggregations|Core|Industrie)-Switch(?![A-Za-z])|Switch-Chassis|Rechenzentrum|Netzteil|Stromversorgung|Erweiterungsmodul|Glasfaser|Kupfer|Einschub|Halterung|Montage|Lizenz|Geh[aä]use|Zubeh[oö]r"],
  ["function-word", `${L}(?:mit|und|bis zu|f[uü]r|oder|inkl\\.|ohne|davon|auf|zu|kompakter|durchstimmbar|Weitverkehr|Kurzstrecke|erw\\.|erweiterte)${R}`],
  ["bis-number", `${L}bis\\s\\d`],
  ["noun", `${L}(?:Modul|Kabel|Zoll|Rackmontage|Ersatzeinheit|Kanal|Kan[aä]le|Industrie|Stecker|Buchse)${R}|Zoll-|Industrie-|-Modul${R}|[a-z]kabel${R}|lizenziert|abstimmbar|${L}(?:aktiv|passiv|erweitert|reines|volle)${R}`],
  ["decimal-comma", "(?<![0-9])\\d{4},\\d{1,2}\\s?nm|(?<![0-9])\\d,\\d\\s?G(?![A-Za-z])"],
];
export const GERMAN = new RegExp(GERMAN_MARKERS.map(([, p]) => p).join("|"));
export const ENGLISH_CONTROLS = [
  "Cisco Catalyst 9300 48-port data only, Network Essentials",
  "Nexus 7700 - 18 Slot Chassis Power Cable Management",
  "10G SFP+ Twinax cable assembly, passive",
  "Upgrade to 16GB DRAM/16GB Flash, 200GB mSATA SSD bundle",
  "ASR 9000 20-port 1-Gigabit Ethernet Modular Port Adapter",
  "MX - Pwr cable United States 4,5m",
];
export const GERMAN_CONTROL = "Cisco C9500-48X Catalyst-9500-Core-Switch (IOS XE, L3) – 48× 10G-SFP+, 1 HE";

export function isGermanName(name: string | null | undefined): boolean { return GERMAN.test(String(name ?? "")); }

/** Refuse to run a detector that reads an English control as German or misses its German control. */
export function assertDetector(): void {
  for (const s of ENGLISH_CONTROLS) if (GERMAN.test(s)) throw new Error(`German-name detector reads an English control as German: ${s}`);
  if (!GERMAN.test(GERMAN_CONTROL)) throw new Error("German-name detector misses its German control row");
}

/** An English name a twin can lend: not German, not the bare "Cisco <sku>" placeholder, not the shop template. */
export function lendableEnglishName(sku: string, name: string | null | undefined): boolean {
  const n = String(name ?? "").trim();
  return !!n && n !== `Cisco ${sku}` && n !== sku && !n.startsWith(`Cisco ${sku} `) && !GERMAN.test(n);
}

/** A spare's name lent to its base drops what makes it the spare's (layers re-audit at 2f3d17a, 14 Sep 2026): a leading
 * "<SKU>= – ", and the word "spare" wherever it stands — trailing ("…DFC4 spare", ", Spare", "(spare)") or mid-name, where the
 * surrounding punctuation is kept once ("MDS 9706 Chassis, Spare, No Power Supplies" -> "MDS 9706 Chassis, No Power Supplies",
 * "(Spare. No Fans/PS)" -> "(No Fans/PS)", "2348TQ spare; 48x1/10T" -> "2348TQ; 48x1/10T", "QSFP28 Spare (no PS/Fans)" ->
 * "QSFP28 (no PS/Fans)"). A leading "^" scrape artifact goes with it. Every other word stays: "(no PS/Fans)" is what Cisco says. */
export function stripSpareWording(name: string): string {
  const W = "(?<![A-Za-z])spare(?![A-Za-z])";
  let s = name.trim()
    .replace(/^\^+\s*/, "")
    .replace(/^[A-Z0-9][A-Z0-9/+._-]*=\s*[–—-]\s+/, "")
    .replace(new RegExp(`^${W}[\\s,:;–—-]+`, "i"), "")                // leading "Spare FRU power supply…"
    .replace(new RegExp(`\\(\\s*${W}\\s*\\)`, "gi"), "")          // "(spare)"
    .replace(new RegExp(`\\(\\s*${W}\\s*[.;,]\\s*`, "gi"), "(")     // "(Spare. No Fans/PS)"
    .replace(new RegExp(`\\s*[,;]?\\s*${W}\\s*(?=[,;])`, "gi"), "")  // ", Spare, No …" / " spare; 48x…"
    .replace(new RegExp(`\\s*[,;]?\\s*${W}\\s*(?=\\()`, "gi"), " ")  // ", Spare (supported …)" / ",Spare(No Acc kit…)"
    .replace(new RegExp(`\\s*[,;]?\\s*${W}\\s*$`, "gi"), "");         // trailing "… spare" / ", Spare"
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([,;])/g, "$1").replace(/[\s,;]+$/, "").trim();
  return s;
}

/** A borrowed name may not carry the spare's marks; one that still does after the strip is refused, for a hand check. */
export const SPARE_LEFT = /(?<![A-Za-z])spare(?![A-Za-z])|=/i;
export const SPARE_REMOVED = "spare wording removed";

export type SparePlan = { id: number; sku: string; name: string; name_source: string; stripped: string; source: string };
/** The spare-wording plan over borrowed names (name_source "twin: …"), pure: what changes, and what the strip cannot clear. */
export function planSpareWording(rows: { id: number; sku: string; name: string; name_source: string }[]): { plans: SparePlan[]; refused: SparePlan[] } {
  const plans: SparePlan[] = [], refused: SparePlan[] = [];
  for (const r of rows) {
    if (!r.name_source.startsWith("twin:") || !SPARE_LEFT.test(r.name)) continue;
    const stripped = stripSpareWording(r.name);
    const p = { ...r, stripped, source: r.name_source.includes(SPARE_REMOVED) ? r.name_source : `${r.name_source}, ${SPARE_REMOVED}` };
    (stripped && !SPARE_LEFT.test(stripped) ? plans : refused).push(p);
  }
  return { plans, refused };
}

// THE SPARE'S PACKAGING NOTE (closing items at aa1143f, item 3; operator 14 Sep 2026). "No PS, No Fans" is true of a SPARE (a bare
// unit for service replacement) and of a MODULAR CHASSIS base (Catalyst 6500 / 4500-E, Nexus 7000 / 7700, MDS 97xx ship bare; power
// supplies are ordered separately). It is false of a FIXED unit's base: a 1–2RU fixed switch or FEX ships with its power supplies and
// fans. So a base that borrowed its spare's name drops the note when it is a fixed unit — bracketed or not — and keeps it when it is a
// modular chassis. "For Service Only" is the spare's too.
export const FIXED_UNIT_SKU = /^(?:N9K-C9[23]|N2K-|N3K-|N5K-C5[56])/;
export const MODULAR_CHASSIS_SKU = /^(?:WS-C65|WS-C45|N7K-C70|N77-C77|DS-C97)/;
export const PACKAGING_NOTE = /no\s*(?:ps|p\/s|psu|power\s+suppl|fans?(?![a-z])|fan[- ]?trays?)|ps&fan|psu\/fan|for\s+service\s+only/i;

/** The name without the packaging note, and the phrases removed. */
export function stripPackagingNote(name: string): { name: string; removed: string[] } {
  const removed: string[] = [];
  let s = name.replace(/\s*\(\s*no(?![a-z])[^)]*\)/gi, (m) => { removed.push(m.trim()); return ""; });
  // "fan-tray" before "fan": "no p/s, no fan-tray" once left "switch-tray" (read in the dry run); the clause may not end mid-word
  const clause = /\s*,\s*(?:no\s*(?:ps|p\/s|psu|power\s+suppl(?:y|ies)|fan[- ]?trays?|fans?)|for\s+service\s+only)(?![a-z-])/i;
  for (let m = s.match(clause); m; m = s.match(clause)) { removed.push(m[0].replace(/^\s*,\s*/, "")); s = s.replace(clause, ""); }
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([,;])/g, "$1").replace(/[\s,;]+$/, "").trim();
  return { name: s, removed };
}

export type PackagingPlan = { id: number; sku: string; name: string; name_source: string; stripped: string; removed: string[]; source: string };
/** Over borrowed BASE names carrying a packaging note: fixed units are stripped, modular chassis kept (listed), anything else refused. */
export function planPackagingNotes(rows: { id: number; sku: string; name: string; name_source: string }[]): { plans: PackagingPlan[]; kept_chassis: { sku: string; name: string; reason: string }[]; refused: { sku: string; name: string; why: string }[] } {
  const plans: PackagingPlan[] = [], kept_chassis: { sku: string; name: string; reason: string }[] = [], refused: { sku: string; name: string; why: string }[] = [];
  for (const r of rows) {
    const sku = r.sku.trim().toUpperCase();
    if (!r.name_source.startsWith("twin:") || sku.endsWith("=") || !PACKAGING_NOTE.test(r.name)) continue;
    if (MODULAR_CHASSIS_SKU.test(sku)) { kept_chassis.push({ sku: r.sku, name: r.name, reason: "base ships without power supplies" }); continue; }
    if (!FIXED_UNIT_SKU.test(sku)) { refused.push({ sku: r.sku, name: r.name, why: "neither a known fixed unit nor a modular chassis — hand check" }); continue; }
    const { name: stripped, removed } = stripPackagingNote(r.name);
    if (!removed.length || !stripped || PACKAGING_NOTE.test(stripped) || SPARE_LEFT.test(stripped)) { refused.push({ sku: r.sku, name: r.name, why: `the strip leaves "${stripped}"` }); continue; }
    const base = r.name_source.replace(/, spare wording removed(?::.*)?$/, "");
    plans.push({ ...r, stripped, removed, source: `${base}, ${SPARE_REMOVED}: ${removed.join(" + ")}` });
  }
  return { plans, kept_chassis, refused };
}

export type NameRow = { id: number; sku: string; name: string | null; name_de: string | null; name_lang: string | null };
export type NamePlan =
  | { id: number; sku: string; action: "english_from_twin"; name_de: string; name: string; source: string }
  | { id: number; sku: string; action: "flag_german"; name_de: string };

/** The decision per German row, pure. A row already handled (name_lang set) is skipped, so the run is idempotent. */
export function planGermanNames(rows: NameRow[]): { plans: NamePlan[]; skipped_done: number } {
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  const plans: NamePlan[] = []; let skipped = 0;
  for (const r of rows) {
    if (!isGermanName(r.name)) continue;
    if (r.name_lang) { skipped++; continue; }
    const twin = bySku.get(r.sku.endsWith("=") ? r.sku.slice(0, -1) : `${r.sku}=`);
    const lent = twin && lendableEnglishName(twin.sku, twin.name) ? stripSpareWording(twin.name!) : "";
    if (twin && lent && !SPARE_LEFT.test(lent)) plans.push({ id: r.id, sku: r.sku, action: "english_from_twin", name_de: r.name!, name: lent, source: lent === twin.name!.trim() ? `twin: ${twin.sku}` : `twin: ${twin.sku}, ${SPARE_REMOVED}` });
    else plans.push({ id: r.id, sku: r.sku, action: "flag_german", name_de: r.name! });
  }
  return { plans, skipped_done: skipped };
}
