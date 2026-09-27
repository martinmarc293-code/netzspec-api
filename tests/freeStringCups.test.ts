// tests/freeStringCups.test.ts — phase-1 close guide §5.4 (13 Sep 2026): the 18 required cups that were free
// strings, each closed, retyped, split or declared free text BY DECISION.
//
//   npx tsx tests/freeStringCups.test.ts
//
// Three halves, each able to go red:
//   1. THE STANDING RULE. Every profile's required or conditional cup of type `s` with no domain and no shape is
//      a finding, unless its key is in FREE_TEXT_BY_DECISION and the decision file names it. Proven by sabotage:
//      a new free-string `req`, a retyped-back dictionary entry and an emptied allow-list are each named.
//   2. THE DEFINITIONS. The type, unit, domain and shape of all 18 (and the two split-out keys) are pinned, so a
//      regeneration that puts a generated `s` back is caught here and not in a ledger a week later.
//   3. THE NORMALISERS. Positive cases are real stored raws (the 13 Sep 2026 replay of every vendor's current
//      facts); every refusal asserts its REASON and a detail fragment, so a value refused for the wrong reason
//      is a miss. Disable a rule in src/core/specNormalize.ts and the cases that depend on it go red.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIELD_DICTIONARY, PROFILES, COLUMN_BACKED, FREE_TEXT_BY_DECISION, requirementFor,
  type FieldDef, type Requirement,
} from "../src/core/fieldSchema.js";
import { normalizeField } from "../src/core/specNormalize.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
const misses: string[] = [];
let sabotages = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) pass++;
  else misses.push(`${name}${detail === undefined ? "" : " -> " + JSON.stringify(detail).slice(0, 400)}`);
}

// =================================================================================================
// 1. the standing rule
// =================================================================================================
/** Required-or-conditional cups of type `s` with no domain and no shape, not column-backed, not allowed. */
function freeStringViolations(
  profiles: Record<string, Record<string, Requirement>>,
  dict: Record<string, FieldDef>,
  allowed: Readonly<Record<string, string>>,
): string[] {
  const out = new Set<string>();
  for (const [cat, p] of Object.entries(profiles)) {
    for (const [key, r] of Object.entries(p)) {
      if (r.kind !== "req" && r.kind !== "cond") continue;
      // COLUMN-BACKED cups (`series`, `vendor`) are answered by a parts column, counted filled by construction
      // (guide §2.2) — no fact and no normaliser is involved, so a type on them decides nothing.
      if (COLUMN_BACKED.has(key)) continue;
      const d = dict[key];
      if (!d || d.type !== "s" || (d.domain ?? []).length > 0 || d.shape) continue;
      if (key in allowed) continue;
      out.add(`${cat}/${key}`);
    }
  }
  return [...out].sort();
}

const DECISION_FILE = path.join(ROOT, "docs", "decisions", "2026-09-13-free-string-cups.md");
const decision = fs.existsSync(DECISION_FILE) ? fs.readFileSync(DECISION_FILE, "utf8").replace(/\r\n/g, "\n") : "";
{
  const v = freeStringViolations(PROFILES, FIELD_DICTIONARY, FREE_TEXT_BY_DECISION);
  check("no required cup is a free string without a recorded decision", v.length === 0, v);
  check("the decision file exists", decision.length > 0, DECISION_FILE);
  for (const [key, ref] of Object.entries(FREE_TEXT_BY_DECISION)) {
    check(`FREE_TEXT_BY_DECISION.${key} points at the decision file`, ref.startsWith("docs/decisions/2026-09-13-free-string-cups.md#"), ref);
    // The section must exist and must SAY the decision — a heading alone could be a closed cup's.
    const section = decision.split(/\n## /).find((s) => s.startsWith(`${key}\n`) || s.startsWith(`${key} `)) ?? "";
    check(`the decision file has a section for ${key} that records "free text by decision"`, /free text by decision/i.test(section), section.slice(0, 120));
    const dict = FIELD_DICTIONARY[key];
    check(`${key} is still type s with no domain (an allow-list entry for a closed cup is stale)`, dict?.type === "s" && !(dict.domain ?? []).length, dict?.type);
    const asked = Object.values(PROFILES).some((p) => p[key]?.kind === "req" || p[key]?.kind === "cond");
    check(`${key} is still required somewhere (an allow-list entry nothing requires is stale)`, asked);
  }
  // Every one of the 18 has a section, so the record is complete and not only the free-text half of it.
  for (const key of ["cellular_bands", "mounting", "standard", "ip_rating", "audio_codecs", "video_codecs", "ui_languages",
    "lan_interfaces", "wan_interfaces", "max_resolution", "video_quality_max", "camera_zoom", "field_of_view",
    "battery_life", "mic_type", "display", "image_sensor", "cpu"]) {
    check(`the decision file has a section for ${key}`, new RegExp(`\\n## ${key}(\\s|$)`).test(decision));
  }

  // SABOTAGE — each must be named, and only it.
  sabotages++;
  const planted = { ...PROFILES, switches: { ...PROFILES.switches, nz_free_text: { kind: "req" } as Requirement } };
  const plantedDict = { ...FIELD_DICTIONARY, nz_free_text: { key: "nz_free_text", de: "x", en: "x", type: "s" } as FieldDef };
  const s1 = freeStringViolations(planted, plantedDict, FREE_TEXT_BY_DECISION);
  check("SABOTAGE: a new required free-string cup is named", s1.join() === "switches/nz_free_text", s1);
  sabotages++;
  const retyped = { ...FIELD_DICTIONARY, ip_rating: { ...FIELD_DICTIONARY.ip_rating, type: "s", domain: undefined } as FieldDef };
  const s2 = freeStringViolations(PROFILES, retyped, FREE_TEXT_BY_DECISION);
  check("SABOTAGE: ip_rating retyped back to a free string is named where it is required", s2.includes("switches/ip_rating"), s2);
  sabotages++;
  const s3 = freeStringViolations(PROFILES, FIELD_DICTIONARY, { image_sensor: FREE_TEXT_BY_DECISION.image_sensor, display: FREE_TEXT_BY_DECISION.display });
  check("SABOTAGE: dropping cpu from the allow-list names cpu in all three UCS categories",
    s3.join() === "hyperconverged-infrastructure/cpu,hyperconverged-systems/cpu,servers-unified-computing/cpu", s3);
  // CONTROL: column-backed `series` is type s, required everywhere, and must never be named.
  check("CONTROL: the column-backed series cup is not a finding", !s3.some((x) => x.endsWith("/series")) && FIELD_DICTIONARY.series.type === "s");
}

// =================================================================================================
// 2. the definitions
// =================================================================================================
{
  const d = FIELD_DICTIONARY;
  const pin = (key: string, want: Partial<FieldDef>) => {
    const got = d[key];
    const ok = !!got && Object.entries(want).every(([k, v]) => JSON.stringify((got as Record<string, unknown>)[k]) === JSON.stringify(v));
    check(`definition ${key} ${JSON.stringify(want)}`, ok, got && { type: got.type, unit: got.unit, band: got.band, shape: got.shape, domain: got.domain?.length });
  };
  pin("cellular_bands", { type: "ls" }); check("cellular_bands domain holds b1..b88, n78, umts-b8, gsm-1900", ["b1", "b88", "n78", "n257", "umts-b8", "gsm-1900"].every((m) => d.cellular_bands.domain?.includes(m)) && !d.cellular_bands.domain?.includes("b89"));
  pin("mounting", { type: "ls", domain: ["rack-19", "rack-23", "rack-etsi", "desktop", "under-desk", "wall", "ceiling", "pole", "din-rail", "panel"] });
  pin("standard", { type: "ls" }); check("standard domain admits all four families and no medium", ["10gbase-sr", "802.11ac", "dwdm", "oc-3"].every((m) => d.standard.domain?.includes(m)) && !["dac", "aoc", "sr", "cpak"].some((m) => d.standard.domain?.includes(m)));
  pin("ip_rating", { type: "e" }); check("ip_rating domain is the IEC 60529 grid (80 codes, ip69k, no ipxx, no ip7x)", d.ip_rating.domain?.length === 80 && d.ip_rating.domain.includes("ip69k") && d.ip_rating.domain.includes("ipx4") && !d.ip_rating.domain.includes("ipxx") && !d.ip_rating.domain.includes("ip70"));
  // audio_codecs LEFT THIS LIST ON 27 SEP 2026. It was a required cup with no domain, so nothing could
  // refuse anything written into it; measured, the catalogue held 490 values in 13 spellings of SEVEN
  // codecs, which is a closed set and therefore writable. The other three stay open on evidence, not on
  // habit: video_codecs has ZERO stored facts (a domain would be invention), and lan/wan_interfaces hold
  // whole phrases like "4-port 10/100-Mbps managed", which are descriptions rather than enum members.
  for (const k of ["video_codecs", "lan_interfaces", "wan_interfaces"]) pin(k, { type: "ls", domain: undefined });
  pin("audio_codecs", { type: "ls", domain: ["g711", "g722", "g722-2", "g729", "opus", "ilbc", "isac"] });
  pin("ui_languages", { type: "ls" }); check("ui_languages domain is languages, not locales", d.ui_languages.domain?.includes("english") === true && !d.ui_languages.domain.some((l) => /[()]/.test(l)));
  for (const k of ["max_resolution", "video_quality_max", "display_resolution"]) pin(k, { type: "struct", shape: "{ w: n, h: n }" });
  pin("camera_zoom", { type: "n", unit: "x", band: [1, 100] });
  pin("field_of_view", { type: "nr", unit: "deg", band: [1, 360] });
  pin("battery_life", { type: "n", unit: "years", band: [0.1, 30] });
  pin("mic_type", { type: "e", domain: ["omnidirectional", "unidirectional", "array", "beamforming"] });
  pin("display", { type: "s", domain: undefined });
  pin("display_size", { type: "n", unit: "in", band: [1, 120] });
  pin("image_sensor", { type: "s", domain: undefined });
  pin("cpu", { type: "s", domain: undefined });
  // The split, AS AMENDED BY THE PARENT before the sync (decision file, section display): a screen kind keeps the
  // required `display` (free text by decision) and is offered the two split quantities as OPTIONAL — no label can
  // pour one display cell into two cups, and a new cup enters optional until its label share is measured (rule 8).
  for (const cat of ["collaboration-endpoints", "unified-communications", "conferencing"]) {
    for (const kind of ["phone", "touch-panel", "display"]) {
      check(`${cat}/${kind} is asked display (required) with display_size and display_resolution optional`,
        requirementFor(cat, "display_size", { kind }) === "opt" && requirementFor(cat, "display_resolution", { kind }) === "opt"
          && requirementFor(cat, "display", { kind }) === "req",
        [requirementFor(cat, "display_size", { kind }), requirementFor(cat, "display_resolution", { kind }), requirementFor(cat, "display", { kind })]);
    }
  }
  check("a headset is not asked a screen (display is not required of it)", requirementFor("collaboration-endpoints", "display", { kind: "headset" }) !== "req");
}

// =================================================================================================
// 3. the normalisers
// =================================================================================================
// [category, key, raw, expected, locale?] — an expected REFUSAL is [reason, detail fragment]; anything else is the value.
type Case = [string, string, string, unknown, ("de" | "en")?];
const R = (reason: string, fragment: string) => ({ refused: reason, fragment });
const CASES: Case[] = [
  // ---- cellular_bands (65 stored, cisco) -------------------------------------------------------------
  ["routers", "cellular_bands", "LTE band 2 PCS 1900, band 4 AWS (1700/2100), band 5 (850), band 17 (700)", ["b2", "b4", "b5", "b17"]],
  ["routers", "cellular_bands", "LTE: Bands 2, 4, 5, 12, 13, 14, 17, and 66 UMTS: Bands 2, 4, and 5",
    ["b2", "b4", "b5", "b12", "b13", "b14", "b17", "b66", "umts-b2", "umts-b4", "umts-b5"]],
  ["interfaces-modules", "cellular_bands", "LTE band 1, 3, 7, 8, 20 (800(B20), 900(B8), 1800(B3), 2100(B1), 2600(B7) MHz)", ["b1", "b3", "b7", "b8", "b20"]],
  ["routers", "cellular_bands", "LTE bands 1, 3, 7, 8, and 20; UMTS/HSPA+ bands 1 (2100 MHz) and 8 (900 MHz); EDGE/GSM/GPRS 900 MHz and 1900 MHz",
    ["b1", "b3", "b7", "b8", "b20", "umts-b1", "umts-b8", "gsm-900", "gsm-1900"]],
  ["routers", "cellular_bands", "LTE bands 1, 3, 5, 7, 8, 18, 19, 21, 28, and 38–41", ["b1", "b3", "b5", "b7", "b8", "b18", "b19", "b21", "b28", "b38", "b39", "b40", "b41"]],
  // a frequency is not a band, even in the segment: "20 800 (band 20)" must not read 800
  ["routers", "cellular_bands", "LTE bands 1, 3, 7, 8, 20 800 (band 20), 900 (band 8), 1800 (band 3), 2100 (band 1), and 2600 (band 7) MHz", ["b1", "b3", "b7", "b8", "b20"]],
  ["interfaces-modules", "cellular_bands", "850, 900, 1900, and 2100 MHz", R("ENUM_VIOLATION", "no radio technology")],
  ["routers", "cellular_bands", "LTE band 700", R("ENUM_VIOLATION", "outside 3GPP")],                  // sabotage
  ["routers", "cellular_bands", "LTE bands 41-38", R("ENUM_VIOLATION", "reversed range")],               // sabotage
  // ---- mounting (1,049 stored: cisco 934, hpe 61, mikrotik 30, aruba 24) --------------------------------
  ["switches", "mounting", "Desktop, wall-mount or rack mount", ["rack-19", "desktop", "wall"]],
  ["switches", "mounting", "19- and 23-in. rack compatible (19-in. rack and cable guide hardware included)", ["rack-19", "rack-23"]],
  ["routers", "mounting", "Options: Rack Mount Kit: C8130-G2-RM-19= DIN Rail Kit: ACS-1111-DRM= Under Desk Kit: ACS-1100-UDM=", ["rack-19", "under-desk", "din-rail"]],
  // the stored value was "480mm" — the metric-restatement rewrite read a rack width as the mounting
  ["switches", "mounting", "Front and midchassis mountable in a 19 in. (480mm) EIA standard two- or four-post rack", ["rack-19"]],
  ["switches", "mounting", "Mounts in an EIA-standard 19 in. Telco rack or equipment cabinet. Horizontal surface mounting only. 2-post rack kit included.", ["rack-19"]],
  ["wireless", "mounting", "Wallplate", ["wall"]],
  ["routers", "mounting", "19 in., 23 in., ETSI", ["rack-19", "rack-23", "rack-etsi"]],
  ["servers-unified-computing", "mounting", "Cisco ball-bearing rail kit with optional reversible cable management arm", ["rack-19"]],
  ["interfaces-modules", "mounting", "Surface mountable", R("ENUM_VIOLATION", "Surface mountable")],
  ["routers", "mounting", "Default: C84G2-ACCKIT-19", R("ENUM_VIOLATION", "C84G2-ACCKIT-19")],
  ["security", "mounting", "Cisco ASA firewall appliance", R("ENUM_VIOLATION", "firewall")],         // sabotage: not a wall
  ["routers", "mounting", "23-in. rack", ["rack-23"]],                                                 // sabotage: not also rack-19
  ["routers", "mounting", "DIN Rail Kit: ACS-1111-DRM", ["din-rail"]],                                  // sabotage: not a rack rail kit
  ["routers", "mounting", "Under Desk Kit", ["under-desk"]],                                            // sabotage: not a desktop
  ["switches", "mounting", "-", R("placeholder", "placeholder")],
  // ---- standard (3,839 stored, 12 vendors, 6 categories) -------------------------------------------------
  ["transceiver", "standard", "IEEE 802.3ae 10GBASE-SR (S-Class, ohne FCoE)", ["10gbase-sr"], "de"],
  ["transceiver", "standard", "10GBASE-LR/-LW, OC-192/STM-64 SR-1 (Multirate)", ["10gbase-lr", "10gbase-lw", "oc-192"], "de"],
  ["transceiver", "standard", "25/50GBASE-CR1 (Twinax, passiv)", ["25gbase-cr1", "50gbase-cr1"], "de"],
  ["transceiver", "standard", "100G CWDM4", ["100gbase-cwdm4"], "de"],
  ["transceiver", "standard", "100GBASE-CWDM4", ["100gbase-cwdm4"], "de"],
  ["transceiver", "standard", "1000BASE-LHLX", ["1000base-lx/lh"]],
  ["transceiver", "standard", "40GBASE-SR-BiDi (40G BiDi)", ["40gbase-sr-bidi"], "de"],
  ["transceiver", "standard", "ITU-T G.9807.1 / G.988 (XGS-PON)", ["itu-t-g.9807.1", "itu-t-g.988"], "de"],
  ["transceiver", "standard", "400G-Base-LR4", ["400gbase-lr4"], "de"],
  ["wireless", "standard", "802.11ac", ["802.11ac"]],
  ["video", "standard", "iWDM", ["iwdm"]],
  ["interfaces-modules", "standard", "OC-3c/STM-1", ["oc-3"]],
  ["switches", "standard", "10GBase-T/SFP", ["10gbase-t"]],
  ["transceiver", "standard", "DAC Kabel", R("ENUM_VIOLATION", "designation"), "de"],
  ["transceiver", "standard", "SR", R("ENUM_VIOLATION", "designation"), "de"],
  ["transceiver", "standard", "CPAK", R("ENUM_VIOLATION", "designation"), "de"],
  ["transceiver", "standard", "40GBASE QSFP", R("ENUM_VIOLATION", "designation")],
  ["transceiver", "standard", "-40 bis 85 °C", R("ENUM_VIOLATION", "designation"), "de"],
  ["transceiver", "standard", "800GBASE-SR8", R("ENUM_VIOLATION", "800gbase-sr8")],                  // sabotage: unseen, refused BY NAME
  // ---- ip_rating (9 stored, cisco) -------------------------------------------------------------------------
  ["switches", "ip_rating", "IP20", "ip20"],
  ["routers", "ip_rating", "IP 66", "ip66"],
  ["routers", "ip_rating", "● Outdoor, IP67", "ip67"],
  ["routers", "ip_rating", "● IP40 rated ● IP54 rated with additional IP54-KIT (IR1800-IP54-KIT)", R("ENUM_VIOLATION", "more than one IP rating")],
  ["routers", "ip_rating", "IP70", R("ENUM_VIOLATION", "not in domain")],                              // sabotage: no such first digit
  ["routers", "ip_rating", "IPXX", R("ENUM_VIOLATION", "not in domain")],
  // ---- the retyped open lists -------------------------------------------------------------------------------
  // audio_codecs NOW NORMALISES INSTEAD OF PASSING THROUGH, and these two rows are the reason the domain
  // and its alias rules had to land together. Seven spellings in, seven canonical codecs out; the second
  // row carries the spelled-out forms and the "mu-law" wording and still loses nothing. Landing the domain
  // alone made the first row come back as ["ilbc","isac","opus"] — four codecs gone in silence — and the
  // second refuse outright, which is how the two-part change was caught before it shipped.
  ["collaboration-endpoints", "audio_codecs", "● G.711 (A-law and µ-law), G.722, G.722.2, G.729ab, iLBC, iSAC, OPUS",
    ["g711", "g722", "g722-2", "g729", "opus", "ilbc", "isac"]],
  ["collaboration-endpoints", "audio_codecs", "● G.711 a-law and mu-law, G.722, G.729a, Internet Low Bitrate Codec (iLBC), and Internet Speech Audio Codec (iSAC)",
    ["g711", "g722", "g729", "ilbc", "isac"]],
  ["collaboration-endpoints", "video_codecs", "● H.264, H.265, AV1 and H.263 (Presentation channel)", ["H.264", "H.265", "AV1", "H.263 (Presentation channel)"]],
  ["routers", "wan_interfaces", "1 port GE and 1 VADSL (Annex B/J)", ["1 port GE", "1 VADSL (Annex B/J)"]],
  ["routers", "lan_interfaces", "4-port GE managed switch", ["4-port GE managed switch"]],
  ["routers", "lan_interfaces", "n/a", R("placeholder", "placeholder")],
  // ---- ui_languages (340 stored, cisco) ---------------------------------------------------------------------
  ["collaboration-endpoints", "ui_languages", "User interface support for English", ["english"]],
  ["collaboration-endpoints", "ui_languages", "Arabic (Arabic Area) Bulgarian (Bulgaria) Catalan (Spain) Chinese (China) Chinese (Hong Kong)", ["arabic", "bulgarian", "catalan", "chinese"]],
  ["collaboration-endpoints", "ui_languages", "● Croatian ● Czech ● Danish ● Dutch ● English (American) ● English (United Kingdom) ● French (France) ● German",
    ["croatian", "czech", "danish", "dutch", "english", "french", "german"]],
  ["collaboration-endpoints", "ui_languages", "Support for more than 20 languages is built in (depends on Cisco Unified CallManager software version).", R("ENUM_VIOLATION", "Support for more than 20")],
  // ---- resolutions ------------------------------------------------------------------------------------------
  ["collaboration-endpoints", "max_resolution", "1280 x 800", { w: 1280, h: 800 }],
  ["collaboration-endpoints", "max_resolution", "4K", R("STRUCT_UNPARSED", "DCI 4096")],
  ["collaboration-endpoints", "max_resolution", "1080p60, 4K UHD", R("STRUCT_UNPARSED", "several resolutions")],
  ["collaboration-endpoints", "max_resolution", "444 x 305 mm", R("STRUCT_UNPARSED", "no resolution")],   // sabotage: a box, not pixels
  ["meraki", "video_quality_max", "Up to 1080p HD w/ H.264, up to 20fps", { w: 1920, h: 1080 }],
  ["meraki", "video_quality_max", "Up to 4K (8MP) video recording (3840x2160) with H.264, up to 15fps", { w: 3840, h: 2160 }],
  ["meraki", "video_quality_max", "Up to 4.2MP (2058x2058) with H.264, up to 15fps", { w: 2058, h: 2058 }],
  ["video", "video_quality_max", "Broadcast, VOD, and SDV", R("STRUCT_UNPARSED", "no resolution")],
  // ---- numbers and a range ----------------------------------------------------------------------------------
  ["collaboration-endpoints", "camera_zoom", "4x optical zoom (8x with digital*)", 4],
  ["collaboration-endpoints", "camera_zoom", "12x optical zoom", 12],
  ["collaboration-endpoints", "camera_zoom", "4x digital zoom", R("PARSE_FAIL", "no number")],
  ["meraki", "field_of_view", "Horizontal: 28° - 82° Vertical: 21° - 61° Diagonal: 37° - 107°", { min: 28, max: 82 }],
  ["meraki", "field_of_view", "Horizontal: 114° Vertical: 61° Diagonal: 132°", { min: 114, max: 114 }],
  ["meraki", "field_of_view", "96° to 41°", { min: 41, max: 96 }],
  ["collaboration-endpoints", "field_of_view", "37.5° to 103.7° (horizontal) 21.6° to 71.2° (vertical) 42.6° to 111.21° (diagonal)", { min: 37.5, max: 103.7 }],
  ["collaboration-endpoints", "field_of_view", "23.9 to ~89.9º", { min: 23.9, max: 89.9 }],
  ["meraki", "field_of_view", "Vertical: 61° Diagonal: 132°", R("PARSE_FAIL", "no range or number")],
  ["meraki", "field_of_view", "400°", R("RANGE_VIOLATION", "400")],
  ["meraki", "battery_life", "up to 5 Years*", 5],
  ["meraki", "battery_life", "2 Years", 2],
  ["meraki", "battery_life", "45 Years", R("RANGE_VIOLATION", "45")],
  ["collaboration-endpoints", "mic_type", "Uni-directional ECM noise-canceling mic", "unidirectional"],
  ["collaboration-endpoints", "mic_type", "● Two MEMS beamforming microphones ● Microsoft Teams version meets premium microphone requirements for open office", "beamforming"],
  ["collaboration-endpoints", "mic_type", "Omni-directional", "omnidirectional"],
  ["collaboration-endpoints", "mic_type", "Electret condenser/ECM", R("ENUM_VIOLATION", "not in domain")],
  ["collaboration-endpoints", "mic_type", "Bi-directional", R("ENUM_VIOLATION", "not in domain")],     // sabotage: not unidirectional
  // ---- the display split ------------------------------------------------------------------------------------
  ["collaboration-endpoints", "display_size", "480x128-pixel backlit 24-bit color LCD, 3.9-in. (9.9-cm) diagonal", 3.9],
  ["collaboration-endpoints", "display_size", "● 23-inch (0.58m) LCD monitor ● Resolution: 1920 x 1080 (16:9)", 23],
  ["collaboration-endpoints", "display_size", "55-inch/75-inch LCD monitor ● Resolution: 4k UHD (3840x2160 /16:9)", R("PARSE_FAIL", "no number")],
  ["collaboration-endpoints", "display_size", "● 9811: 2.6-inch Grayscale LCD, 256x132 resolution ● 9841: 3.5-inch Grayscale LCD, 384 x160 resolution", R("PARSE_FAIL", "no number")],
  ["collaboration-endpoints", "display_resolution", "Color 3.2-in. QVGA (320 x 240) LCD graphical display", { w: 320, h: 240 }],
  ["collaboration-endpoints", "display_resolution", "● The 800 × 480, 24-bit color, 5-inch WVGA display provides scrollable access to calling features", { w: 800, h: 480 }],
  ["collaboration-endpoints", "display_resolution", "● 6821: White backlit, grayscale, 2.5-in. (6.4-cm) 240 x 120-pixel display. ● 6841 and 6851: White backlit, grayscale, 3.5-in. (9-cm) 396 x", R("STRUCT_UNPARSED", "several screens")],
  ["collaboration-endpoints", "display", "● Capacitive touch LCD ● 10.1-inch diagonal", "● Capacitive touch LCD ● 10.1-inch diagonal"],
  // ---- free text by decision: accepted as captured ---------------------------------------------------------------
  ["meraki", "image_sensor", "1/3” 4MP (2688x1520) progressive CMOS", "1/3” 4MP (2688x1520) progressive CMOS"],
  ["servers-unified-computing", "cpu", "AMD 9575F", "AMD 9575F"],
];
for (const [cat, key, raw, want, locale] of CASES) {
  const r = normalizeField(cat, key, raw, { locale: locale ?? "en" });
  const label = `${cat}/${key} ${JSON.stringify(raw).slice(0, 70)}`;
  if (want && typeof want === "object" && "refused" in (want as object)) {
    const w = want as { refused: string; fragment: string };
    check(`${label} is refused ${w.refused} naming "${w.fragment}"`, !r.ok && r.reason === w.refused && r.detail.includes(w.fragment), r);
  } else {
    check(`${label} -> ${JSON.stringify(want)}`, r.ok && JSON.stringify(r.value) === JSON.stringify(want), r);
  }
}
check("the cases include sabotage refusals", CASES.filter((c) => typeof c[3] === "object" && c[3] !== null && "refused" in (c[3] as object)).length >= 30);

console.log(`freeStringCups: ${pass} passed, ${misses.length} missed (${sabotages} standing-rule sabotages, ${CASES.length} normaliser cases)`);
if (misses.length) { for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
