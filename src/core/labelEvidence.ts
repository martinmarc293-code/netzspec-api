// src/core/labelEvidence.ts — may a stored series LABEL place a part in a series? (layers re-audit at 2f3d17a, 14 Sep 2026)
//
// A label is the weakest placement evidence: whatever an enumeration or a shop seed typed into parts.series. The re-audit found
// MEM-224-1X128D-U "128MB DRAM Memory for VG224" and MEM180X-256D= "…for the Cisco 180X" filed under ISR 800 by a label, CSS
// 11500 cables under Catalyst 3750. The rule: a label-placed row stays in its series only when ONE of these also holds —
//   sku-token   the SKU carries a platform token of the series (3750 in WS-C3750G-24TS, N77 for the Nexus 7700)
//   name        the name names the series, one of its platform numbers, an alias or a distinctive series word
//   family      the SKU or name carries only the FAMILY's token (A900-IMA8D in "ASR 902 / 903 / 907 / 914"): the family holds,
//               the series is not contradicted — reported as its own kind so the count is visible
//   compatible  a `compatible` relation links the part to a part already placed by SKU or name in that series
// and it is NOT contradicted: a token that names a SIBLING series of the line more specifically than anything naming its own
// ("1GB DRAM for Cisco 1941" labelled ISR 2900) is kind "none", detail "names sibling ISR 1900". A "none" row goes to its line's
// shared parts, marked, never silently into a series.
//
// Digit tokens come from the series and family names; "N000" means the Nxxx models (ISR 4000 = 4221 … 4461), "NN00" the NNxx
// models (Catalyst 9300 = 9300 … 93180), "N00" the Nxx models (ISR 800 = 810 … 897). A match's specificity is its count of fixed
// digits, so "3400" (IE 3400) outranks "3000" (IE 3000) on "IE-3400-8P2S". Digits are fenced with lookarounds, never \b, and a
// number that is a wattage, a memory size or a speed ("1100WAC", "512MB", "10/100/1000") is not a platform.

export type LabelEvidenceKind = "sku-token" | "name" | "family" | "compatible" | "none";
export type LabelEvidence = { kind: LabelEvidenceKind; detail: string };

/** Compact spellings a series or family uses that its digits do not show, keyed by a digit token, an exact series or family
 * name, or a series word. `re:` marks a regex. Each alias was read off live SKUs or names. */
export const LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "9000": ["N9K", "C9K"], "9800": ["N9K-C98", "N9K-X98", "N9800"], "7000": ["N7K"], "7700": ["N77"],
  "5000": ["N5K"], "5500": ["N55"], "5600": ["N56"], "3000": ["N3K", "3K/9K"], "2000": ["N2K"], "6000": ["N6K"],
  // Catalyst 6500: supervisors and forwarding cards name no 6500 (VS-S720-10G, DFC3C, MEM-XCEF720-512M, "Catalyst 6000 2500W")
  "6500": ["C65", "C6K", "S720", "SUP720", "SUP2T", "SUP32", "WS-X6", "WS-F6", "DFC3", "DFC4", "CEF720", "MSFC", "CATALYST 6000", "C6X0"],
  "6800": ["C68"], "4500": ["X45", "C45", "WS-X4", "C4K"], "4900": ["C49"],
  "ASR 1000": ["ASR1K", "ASR1-", "M-ASR1"], "ASR 9000": ["A9K", "A99", "ASR-99", "RSP440", "RSP880", "re:(?<![0-9])99[0-9]{2}(?![0-9])"],
  "ASR 900": ["A90", "A92"], "ASR 901": ["A901"], "ASR 920": ["A920"],
  // the Cisco 8000 family: 8101 … 8818 and the 84- / 88- line-card prefixes ("Cisco 8404 MPA")
  "Cisco 8000": ["8K-", "re:^8[48]-"],
  "ISR 800": ["8XX"], CRS: ["CRS"], PON: ["PON", "OLT", "ONT", "CGP"],
  // the LoRaWAN gateway's parts say "LoRa interface" (PLG-PWRJCK "Cisco v2 LoRa interface DC power input jack plug"), the SKUs LORA / IXM
  LoRaWAN: ["LORA", "IXM"],
};

/** THE BRAND A NUMBER-KEYED ALIAS BELONGS TO (16 Sep 2026).
 *
 * Fourteen of the keys above are a BARE NUMBER, and `strongest` looks aliases up by `digitTokens(text)` — so every series
 * whose name contains 5000 was offered `N5K`, whether it was a Nexus or not. `CAB-N5K6A-NA`, a Nexus 5000 power cord,
 * reached `NCS 5000` that way. Measured across the mapping, 45 non-Nexus series could inherit one: `UCS 6500 Fabric
 * Interconnects` was offered `SUP720`, `MSFC` and `WS-X6`; `IPS 4300 / 4500` the Catalyst 4500 line-card spellings;
 * `Desk Phone 9800` and the Catalyst 9800 wireless controllers `N9800`; `ASA 5500` and `TelePresence IX5000` theirs.
 *
 * The tag cannot live on the KEY, because "9000" carries both `N9K` (Nexus) and `C9K` (Catalyst). It lives per alias, and
 * every number-keyed alias must have an entry — `tests/layersStanding.test.ts` refuses the run if one does not, so the two
 * tables cannot drift apart the way a hand-maintained list always does. A non-numeric key ("ASR 9000", "LoRaWAN") already
 * names its own series and needs nothing. */
export const ALIAS_REQUIRES: Readonly<Record<string, string>> = {
  N9K: "nexus", "N9K-C98": "nexus", "N9K-X98": "nexus", N9800: "nexus", N7K: "nexus", N77: "nexus", N5K: "nexus",
  N55: "nexus", N56: "nexus", N3K: "nexus", "3K/9K": "nexus", N2K: "nexus", N6K: "nexus",
  C9K: "catalyst", C65: "catalyst", C6K: "catalyst", S720: "catalyst", SUP720: "catalyst", SUP2T: "catalyst",
  SUP32: "catalyst", "WS-X6": "catalyst", "WS-F6": "catalyst", DFC3: "catalyst", DFC4: "catalyst", CEF720: "catalyst",
  MSFC: "catalyst", "CATALYST 6000": "catalyst", C6X0: "catalyst", C68: "catalyst", X45: "catalyst", C45: "catalyst",
  "WS-X4": "catalyst", C4K: "catalyst", C49: "catalyst",
};
/** The number-keyed aliases, derived rather than listed, so the drift check has something to compare against. */
export const NUMBER_KEYED_ALIASES: readonly string[] =
  Object.entries(LABEL_ALIASES).filter(([k]) => /^[0-9]+$/.test(k)).flatMap(([, v]) => v);

/** Words too common in Cisco series names to evidence one series. */
const STOP = new Set(["catalyst", "nexus", "cisco", "series", "router", "routers", "switch", "switches", "edge", "gateway", "gateways", "wireless",
  "shared", "parts", "industrial", "ethernet", "connected", "grid", "services", "service", "integrated", "aggregation", "carrier", "routing", "system",
  "hardened", "secure", "console", "business", "small", "managed", "smart", "unmanaged", "stackable", "instant", "access", "fabric", "extenders",
  "embedded", "terminal", "cellular", "legacy", "content", "open", "software", "silicon", "platform", "platforms", "modules", "module",
  "network", "networks", "convergence", "power", "redundant", "digital", "building", "micro", "interface", "internal", "voice", "cards",
  "pluggable", "compute", "enterprise", "and", "for", "with", "the",
  // layers round 3, pre-ruling C10 (15 Sep 2026): the generic nouns of a FORM-FACTOR series name are not evidence, a product token
  // is — "Fiber" in "Fiber and M12 cables (CB-)" kept FQMAP46CG "Fiber Optic Migration Adapter Panel", a Panduit panel, in a
  // Cisco cable series. Measured before the change: 0 switches, routers or transceiver rows were kept by any of these words.
  "fiber", "fibre", "cable", "cables", "adapter", "adapters", "patch", "panel", "panels", "breakout"]);

/** Numbers a Cisco string carries that are not platforms: watts ("1100WAC", "1900WHV" — a wattage ends in 0 or 5, where a model
 * with a W suffix does not: C881W, C1941W), memory, frequencies, speeds, lengths, DIMM grades (DDR4-2400, PC4-19200). */
// A STANDARDS NUMBER IS NOT A PLATFORM (16 Sep 2026). Power cords and cabling name the standard they are built to, and those
// numbers are in the same three-to-five digit band as Cisco's platforms: `NBR 14136` (Brazil) reached Catalyst 1000, `BS 1363`
// (UK) Catalyst 1300, `CEI 23-16` (Italy) and `IRSM 2073` (Argentina) Nexus 2000, `IS:1293` (India) Catalyst 1200, `SEV 1011`
// (Swiss) Catalyst 1000, `GB2099.1/GB1002` (China) Catalyst 1000, and `IEC 60320` — the connector standard every appliance cord
// in the world is built to — reached both "Integrator Package 6000 MXP" and Nexus 6000. Sixteen rows of the review queue.
//
// Each body is anchored on its own left edge, so the `IS` of `CHASSIS3000` is not read as the Indian standards body; that
// nested lookbehind is the whole reason this is safe to put in a shared pattern. Bodies are LITERAL and short, which is what
// makes this a guard against a named thing rather than a guess at the shape of a number — and it costs nothing in recall,
// because no Cisco platform is introduced by the word `BS` or `NBR`.
const STANDARDS_BODY = "(?:IEC|BS|NBR|SEV|CEI|IRAM|IRSM|NEMA|CSA|SABS|VDE|JIS|AS/NZS|ANSI|IEEE|UL|IS|GB)";
const NOT_PLATFORM_BEFORE = `(?<![0-9.]|DDR[0-9]-|PC[0-9]-|(?<![A-Za-z])${STANDARDS_BODY}[ :.-]?)`;
// (?!IRELESS) (layers round 3, wireless round): "Spare fan - Cisco 5520 Wireless Controller" read 5520 as a wattage ("5520 W…") and
// moved the fan out of 5500 (5508 / 5520 / 5540); a W that starts the word Wireless is not a watt. The patterns carry the i flag.
const NOT_PLATFORM_AFTER = "(?![0-9])(?!(?<=[05])\\s?W(?!IRELESS))(?!\\s?(?:KW|VA|MB|GB|MHZ|BASE|MBPS|MM(?![A-Z])|V(?![A-Z0-9])))";
/** "10/100/1000" is a speed list, not the Catalyst 1000 or the ISR 1000. */
const SPEEDS = /(?<![0-9])10\/100(?:\/1000)?(?:\/10000)?(?![0-9])|(?<![0-9])100\/1000(?![0-9])/g;

export function digitTokens(text: string): string[] {
  return [...new Set((text.match(/(?<![0-9])[0-9]{3,5}(?![0-9])/g) ?? []))];
}

/** The letters a series name puts immediately before one of its own numbers: "UCS C200" -> C, "MX (MX200 …)" -> MX,
 * "IE 3400" -> null (a space), "Aironet 1550" -> null. Null means the series offers no model letter to match against. */
export function leadLetters(text: string, tok: string): string | null {
  return (new RegExp(`([A-Za-z]+)${tok}`).exec(text) ?? [])[1] ?? null;
}

/** A platform token's pattern and its specificity (fixed digits).
 *
 * THE MODEL LETTER (16 Sep 2026). The three branches below WIDEN a round number into its family on purpose, so that
 * "UCS C200 / C210 / C250 / C260" is named by a part saying C260. The widening keeps only the DIGITS, so `2[0-9]{2}`
 * equally claimed `SN200` (an HGST drive), `H200` (an NVIDIA GPU), `B230` (a B-Series blade on a rack-server page),
 * `D200G` (a 200-gigabit VIC), `EL223` (a Brazilian cord) and `CA300` (an Avizia cart under TelePresence MX).
 *
 * So where the SERIES itself puts letters in front of the number, the haystack's letters must END WITH THEM — or be
 * absent, which is the ordinary "for the 5520 controller" shape and has to keep matching. `lead` is null for every
 * series that writes its number as a separate word, which is most of them, and those are unaffected.
 *
 * Measured by running both versions of the real function over all 39,998 rows on every page: 944 verdicts differ, 864
 * inert because an exclusion, SKU or name rule had already placed the row, **0 rows fall out of a series**, 1 loses
 * only a rival claim and becomes decisive, 69 review proposals are withdrawn and 11 created. Nothing published moves.
 * The known cost is named and accepted: 4 of the 69 withdrawals are wrong — `UCSC-SCCBL240(=)` and `UCSC-SCCBL220(=)`
 * are supercap cables whose 240/220 really is the C240/C220, hidden behind the `L` of `CBL`. They stay in shared parts
 * and `tests/layersStanding.test.ts` asserts that, so the day the rule changes the loss is visible rather than silent.
 * Full record: docs/decisions/2026-09-16-the-model-letter-fence-prepared-not-applied.md */
export function digitPattern(tok: string, lead?: string | null): { re: RegExp; spec: number } {
  let body: string, spec: number;
  if (/^[1-9]000$/.test(tok)) { body = `${tok[0]}[0-9]{3}[0-9]?`; spec = 1; }
  else if (/^[0-9]{2}00$/.test(tok)) { body = `${tok.slice(0, 2)}[0-9]{2}[0-9]?`; spec = 2; }
  else if (/^[1-9]00$/.test(tok)) { body = `${tok[0]}[0-9]{2}`; spec = 1; }
  else { body = tok; spec = tok.length; }
  const fence = lead ? `(?:(?<![A-Za-z])|(?<=${lead}))` : "";
  return { re: new RegExp(`${NOT_PLATFORM_BEFORE}${fence}${body}${NOT_PLATFORM_AFTER}`, "i"), spec };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const aliasRe = (alias: string, isName: boolean): RegExp =>
  alias.startsWith("re:") ? new RegExp(alias.slice(3), "i") : isName ? new RegExp(`(?<![A-Za-z0-9])${esc(alias)}(?![A-Za-z])`, "i") : new RegExp(esc(alias));

type Hit = { spec: number; detail: string; where: "sku" | "name" };

/** The strongest token of `text` (a series or family name) found in the SKU or name, or null. */
function strongest(text: string, sku: string, name: string, words: boolean, excludeWords: ReadonlySet<string>): Hit | null {
  let best: Hit | null = null;
  const take = (h: Hit) => { if (!best || h.spec > best.spec) best = h; };
  // the whole series name, fenced: "IE 3400" is not named by "IE 3400H"
  if (new RegExp(`(?<![A-Za-z0-9])${esc(text)}(?![A-Za-z0-9])`, "i").test(name)) take({ spec: 9, detail: text, where: "name" });
  for (const d of digitTokens(text)) {
    const { re, spec } = digitPattern(d, leadLetters(text, d));
    if (re.test(sku)) take({ spec, detail: d, where: "sku" });
    else if (re.test(name)) take({ spec, detail: d, where: "name" });
  }
  const keys = [text, ...digitTokens(text), ...text.split(/[\s/()]+/)];
  const lower = text.toLowerCase();
  for (const k of keys) for (const a of LABEL_ALIASES[k] ?? []) {
    // a Nexus or Catalyst spelling reached through a BARE NUMBER belongs only to a Nexus or Catalyst series
    const need = ALIAS_REQUIRES[a];
    if (need && !lower.includes(need)) continue;
    if (aliasRe(a, false).test(sku)) take({ spec: 2, detail: a, where: "sku" });
    else if (aliasRe(a, true).test(name)) take({ spec: 2, detail: a, where: "name" });
  }
  if (words) for (const w of text.split(/[\s/()]+/)) {
    if (!/[A-Za-z]/.test(w) || /^[0-9]/.test(w) || STOP.has(w.toLowerCase()) || excludeWords.has(w.toLowerCase())) continue;
    const acronym = /^[A-Z]{2,5}$/.test(w);
    if (!acronym && w.length < 4) continue;
    // THE TWO SIDES OF THE ACRONYM RULE ANCHORED DIFFERENTLY (16 Sep 2026). The SKU side has always required a
    // non-letter on BOTH sides; the name side only forbade a following LOWERCASE letter, so an acronym matched the
    // START of any longer ALL-CAPS word: SA in SATA, NM in NMEA, SD in SDRAM, and MX in MXP on a page carrying both a
    // "TelePresence MX" and a "TelePresence MXP" series. That is how a 500 GB SATA drive came to name the "Aironet 1550
    // hazardous-location (H / SA / SD)" series. The loose form exists so IE can match IE3000 — a DIGIT after the
    // acronym — and `(?![A-Za-z])` keeps that while refusing SATA, so the two sides now anchor alike.
    // Measured by running BOTH versions of this function over all 39,998 rows on every page — not over the rows this
    // rule judges, which is the population I measured twice and got wrong twice (see
    // docs/decisions/2026-09-16-the-acronym-anchor-and-the-population-i-kept-measuring.md). 235 verdicts differ; 229
    // are inert because an exclusion, SKU or name rule had already placed the row; 0 rows fall out of a series; 1
    // (STM1-CN-SMI) merely loses a RIVAL claim and so becomes decisive. The 5 real changes are all withdrawals of bad
    // review proposals: a 500 GB SATA drive claimed by "Aironet 1550 hazardous-location (H / SA / SD / WU)", and four
    // generic RJ45 cables claimed by "TelePresence MX" on MX inside MXCAM-D, on a page that also carries MXP.
    const nameRe = new RegExp(`(?<![A-Za-z])${esc(w)}(?!${acronym ? "[A-Za-z]" : "[a-z]"})`, acronym ? "" : "i");
    if (acronym && new RegExp(`(?<![A-Z])${esc(w)}(?![A-Z])`).test(sku)) take({ spec: 1, detail: w, where: "sku" });
    else if (nameRe.test(name)) take({ spec: 1, detail: w, where: "name" });
  }
  return best;
}

export type LineContext = { family: string | null; siblings: readonly { series: string; family: string | null }[] };

export function labelEvidence(
  row: { sku: string; name: string | null | undefined },
  series: string, ctx: LineContext,
  compatiblePlacedSeries: ReadonlySet<string> = new Set(),
): LabelEvidence {
  const sku = row.sku.toUpperCase().trim().replace(/^(2D-|C1-|EDU-|NAL-)/, "");
  const name = String(row.name ?? "").replace(SPEEDS, " ");
  const shared = /shared parts$/.test(series);
  const siblings = ctx.siblings.filter((s) => s.series !== series && !/shared parts$/.test(s.series));
  // words and acronyms count only when no sibling series carries them (CGR is in CGR 1000 and CGR 2010: family evidence at most)
  const siblingWords = new Set(siblings.flatMap((s) => s.series.toLowerCase().split(/[\s/()]+/)));
  const own = strongest(series, sku, name, true, siblingWords);
  // A SIBLING contradicts the label only with a token of 2+ fixed digits or its full name: a bare "N000" pattern (1xxx) also
  // matches connector and CPU numbers (OBD2-J1939, E5-2667), which name no router at all.
  const rivals: (Hit & { series: string })[] = [];
  if (!shared) for (const s of siblings) {
    // a sibling's tokens that are this series' own name nothing more specific than it
    const h = strongest(s.series, sku, name, false, new Set());
    // (the same token evidencing both — C4K for 4500-E and 4500-X — contradicts neither)
    if (h && h.spec >= 2 && h.detail !== own?.detail && !digitTokens(series).includes(h.detail)) rivals.push({ ...h, series: s.series });
  }
  // a rival as specific as the series' own token means the part names BOTH ("Cable guard for the 3560-C and 2960-C", "Cisco
  // 1941/2901 Fan Blower"): a part shared across series, which is what the line's shared parts hold
  const top = rivals.length ? Math.max(...rivals.map((r) => r.spec)) : 0;
  if (top && (!own || top >= own.spec)) {
    const best = rivals.filter((r) => r.spec === top);
    const also = own && top === own.spec ? `names ${series} and another series of the line equally` : "names another series of the line";
    return { kind: "none", detail: `${also}: ${best.slice(0, 3).map((r) => `${r.series} (${r.where} ${r.detail})`).join(", ")}${best.length > 3 ? ` +${best.length - 3}` : ""}` };
  }
  if (own) return { kind: own.where === "sku" ? "sku-token" : "name", detail: own.detail };
  if (ctx.family) {
    const familyWords = new Set(siblings.filter((s) => s.family !== ctx.family).flatMap((s) => s.series.toLowerCase().split(/[\s/()]+/)));
    const fam = strongest(ctx.family, sku, name, true, familyWords);
    // the acronym shared only with same-family siblings (CGR) is family evidence
    const acr = series.split(/\s+/).find((w) => /^[A-Z]{2,5}$/.test(w) && !familyWords.has(w.toLowerCase()) && new RegExp(`(?<![A-Z])${w}(?![A-Z])`).test(sku));
    if (fam) return { kind: "family", detail: `${ctx.family}: ${fam.where} ${fam.detail}` };
    if (acr) return { kind: "family", detail: `${ctx.family}: sku ${acr}` };
  }
  if (compatiblePlacedSeries.has(series)) return { kind: "compatible", detail: series };
  const toks = digitTokens(series);
  return { kind: "none", detail: `no ${toks.length ? `platform token (${toks.join(", ")})` : "series token"} in the SKU or name, no compatible part placed in the series` };
}
