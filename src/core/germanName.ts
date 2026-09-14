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
    if (twin && lendableEnglishName(twin.sku, twin.name)) plans.push({ id: r.id, sku: r.sku, action: "english_from_twin", name_de: r.name!, name: twin.name!.trim(), source: `twin: ${twin.sku}` });
    else plans.push({ id: r.id, sku: r.sku, action: "flag_german", name_de: r.name! });
  }
  return { plans, skipped_done: skipped };
}
