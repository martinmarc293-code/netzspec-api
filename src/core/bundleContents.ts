// src/core/bundleContents.ts — the fill path for `bundle_contents`: what an orderable bundle is made of,
// read from the bundle's own NAME. Round-7 ruling C, 12 Sep 2026.
//
// THE CONDITION IT EXISTS UNDER. The operator approved `bundle_contents` as a required cup of `bundle` ONLY
// with a fill path on the same commit: "a name-mining rule parsing 'N x <PID>' / 'w/ <PID>' into the list,
// validated over the 277 rows with agree/disagree/silent counts". None of the 1,568 cohort rows holds a
// datasheet-class document, so the name is not a shortcut here — it is the only evidence there is.
//
// STRICT, BECAUSE A BILL OF MATERIALS THAT IS WRONG BY ONE LINE IS WORSE THAN NONE. It accepts what the name
// states outright and refuses the row when it cannot account for a COUNTED token:
//   * a device line is `<n>x <device>` from an explicit vocabulary (chassis, fabric interconnect, fabric
//     extender, Nexus, UCS server/blade, HX node, WLC, AP, AP licence, MDS, Invicta, drives in a drive pack);
//   * a counted CONFIGURATION token (2x5675 CPUs, 8x16GB, 2x146GHD, 1xVIC, 1xPalo) is the per-node build of a
//     device already listed and is not a line of the bundle — it is skipped, never counted into the total;
//   * any other counted token ("4x100VIEW") refuses the row: an unread line would make the list incomplete
//     while looking complete;
//   * a count stated as a range ("w/4 to 32 HX nodes") or items the name says are NOT included
//     ("+ Addnl 2xFI reqd") refuse the row;
//   * an uncounted server or chassis in the name is one unit ONLY when the name counts none of that kind —
//     "UCS SP8 C220M4S ENTRY 2x6248,4xC220" is four C220s under a series label, not five.
// Every refusal carries its reason, and the validation reports them as `silent`.

import { nameIsJustTheSku } from "./nameMarker.js";

export type BundleContents =
  | { ok: true; items: string[]; because: string }
  | { ok: false; reason: string };

type Hit = { start: number; end: number; n: number; item: string; cls: "server" | "chassis" | "other" };

const FI_MODEL: Record<string, string> = { "48": "6248", "96": "6296" };

/** Strip the ordering noise that carries no contents: "(Not sold standalone)", a leading "^". */
function clean(name: string): string {
  return name.replace(/\((?:not|only)[^)]*\)/gi, " ").replace(/^\s*\^/, " ").replace(/\s+/g, " ").trim();
}

// Each pattern captures (count?, ...). Counts may be glued ("2FI96", "1CH", "2N5K") or written with x.
// Digit lookbehinds only — no \b on product tokens (this repo's CLAUDE.md, and bundleFamily.ts's own bugs).
const COUNT = String.raw`(?<![0-9.])(\d{1,2})\s*(?:x\s*)?`;
const DEVICE_PATTERNS: { re: RegExp; make: (m: RegExpExecArray) => Omit<Hit, "start" | "end"> | null }[] = [
  // UCS blades and rack servers, counted: 4xB200, 16xC240M4S, 4x(B230, 8x B200M4 blades
  { re: new RegExp(String.raw`(?<![0-9.])(\d{1,2})\s*x\s*\(?\s*(B22|B200|B230|B250|B420|B440|C210|C220|C240|C260|C3260)\s*(M\d)?(SX|S|L)?(?![0-9])`, "gi"),
    make: (m) => ({ n: +m[1], item: [m[2].toUpperCase(), m[3]?.toUpperCase(), ""].filter(Boolean).join(" ") + (m[4] ? m[4].toUpperCase() : ""), cls: "server" }) },
  // HX nodes: "w/4 HX nodes", "4xHX node"
  { re: /(?<![0-9.])(\d{1,2})\s*x?\s*HX\s?nodes?(?![a-z])/gi, make: (m) => ({ n: +m[1], item: "HX node", cls: "server" }) },
  // blade chassis, counted or glued: 1xChassis, 2xCH, 1CH, 1xChas-, 1x5108 Mini Chassis, 1x5108Chassis
  { re: new RegExp(COUNT + String.raw`(5108\s*(?:Mini\s*)?(?:AC2?\s*|DC\s*)?)?(?:CH|Chas|Chass|Chassis)(?![a-z])`, "gi"),
    make: (m) => ({ n: +m[1], item: m[2] ? "5108 chassis" : "chassis", cls: "chassis" }) },
  // fabric interconnects: 2x6248, 2xFI, 2FI96, 2FI-U, 2xFI6248, 2FI48
  // "BNDL2FIx1xChassis" glues the FI count to the next item with an `x`, so an `x` followed by a digit may
  // follow the token; the first version refused it and silently dropped both FIs from nine bundles.
  { re: new RegExp(COUNT + String.raw`(?:FI\s?-?(6248|6296|6324|6332|6454|48|96|U)?|(6248|6296|6324|6332|6454))(?:(?![0-9a-z])|(?=x[0-9]))`, "gi"),
    make: (m) => { const t = m[2] ?? m[3]; const model = t && t.toUpperCase() !== "U" ? (FI_MODEL[t] ?? t) : ""; return { n: +m[1], item: model ? `fabric interconnect ${model}` : "fabric interconnect", cls: "other" }; } },
  // fabric extenders: 2x2232, 2xN2232, 2FEX
  { re: new RegExp(COUNT + String.raw`(?:N?2232|FEX)(?![0-9a-z])`, "gi"), make: (m) => ({ n: +m[1], item: "Nexus 2232 fabric extender", cls: "other" }) },
  // Nexus switches: 2x5548, 2xN5548, 2xN3048, 2x3048, 2xN5K, 2N5K
  { re: new RegExp(COUNT + String.raw`N?(5548|3048|5K)(?![0-9a-z])`, "gi"),
    make: (m) => ({ n: +m[1], item: m[2].toUpperCase() === "5K" ? "Nexus 5000" : `Nexus ${m[2]}`, cls: "other" }) },
  // multipacks: "10-Pk C220 M3", "10PK B200 M6", "10-PkC220 M4"
  { re: /(?<![0-9.])(\d{1,2})\s*-?\s*Pk\s*(B200|C220|C240)\s*(M\d)?/gi,
    make: (m) => ({ n: +m[1], item: [m[2].toUpperCase(), m[3]?.toUpperCase()].filter(Boolean).join(" "), cls: "server" }) },
  // wireless: "10 AP-702i", "5 AP-1602i", "Bundle 2 AP1700I", "10-pack AP3802I"
  { re: /(?<![0-9.])(\d{1,2})\s*(?:-\s*pack\s*)?AP-?(\d{3,4}[a-z]?)(?![0-9])/gi,
    make: (m) => ({ n: +m[1], item: `AP${m[2].toUpperCase()}`, cls: "other" }) },
  // AP licences: "10 AP Lic.", "with 25 licenses"
  { re: /(?<![0-9.])(\d{1,3})\s*(?:AP\s*Lic(?:\.|enses?)?|licenses)(?![a-z])/gi, make: (m) => ({ n: +m[1], item: "AP licence", cls: "other" }) },
  // kind-layer operator ruling (13 Sep 2026): the ASR 5000 card complements, "ASR5000 Bundle, incl 2xSMC/3xPSC2 16GB/
  // 2xRCC/2xSPIOStr3 BNC". A counted card from an explicit vocabulary — SMC (System Management Card), PSC/PSC2 (Packet
  // Services Card) with the memory the name states for it, RCC (Redundancy Crossbar Card), SPIO (Switch Processor I/O)
  // with its Stratum 3 / BITS connector variant. The memory and the variant are part of the orderable card, so they stay
  // in the item; any other counted token still refuses the row (ANY_COUNTED below).
  { re: /(?<![0-9.])(\d{1,2})\s*x\s*(SMC|PSC2?|RCC|SPIO|PPC)(?:\s*(16|32|64)\s*GB)?(?:\s*(Str3))?(?:\s*(3PN|BNC))?(?![A-Za-z0-9])/g,
    make: (m) => ({ n: +m[1], item: [m[2], m[3] ? `${m[3]}GB` : "", m[4] ?? "", m[5] ?? ""].filter(Boolean).join(" "), cls: "other" }) },
];

/**
 * kind-layer operator ruling (13 Sep 2026): a CRS line-card bundle, "Cisco CRS Series 40x10GE MSC Bundle". The name
 * states a CARD (MSC / MSE / FP) and the port complement of the interface module (PLIM) it ships with; nothing else.
 * STRICT: the whole name must be that shape. A bundle that does not count its ports ("Cisco CRS Series 100GE MSC
 * Bundle", "Cisco CRS 100GE FP Bundle") is REFUSED — the SKU's capacity token (MSC-BNDL, FP140) does not say how many
 * ports, and a port count read from a capacity would be a guess.
 */
const CRS_LINECARD_BUNDLE = /^(?:Cisco\s+)?CRS(?:-[13X])?\s+(?:Series\s+)?(?:(\d{1,2})\s*x\s*)?(10|40|100)GE\s+(?:Ethernet\s+)?(MSC|MSE|FP)\s+Bundle$/i;
function crsLineCardBundle(s: string): BundleContents | null {
  if (!/(?<![A-Za-z])CRS(?![A-Za-z])/.test(s) || !/bundle\s*$/i.test(s)) return null;
  const m = CRS_LINECARD_BUNDLE.exec(s);
  if (!m) return { ok: false, reason: "a CRS bundle name outside the '<n>x<rate>GE <card> Bundle' shape" };
  if (!m[1]) return { ok: false, reason: "a CRS line-card bundle whose port count is not stated" };
  return { ok: true, items: [`1x CRS ${m[3].toUpperCase()} line card`, `1x ${+m[1]}x${m[2]}GE interface module`], because: "CRS line-card bundle name" };
}

// Uncounted single devices — one unit each, taken only when nothing counted names the same class.
const UNCOUNTED: { re: RegExp; make: (m: RegExpExecArray) => Omit<Hit, "start" | "end" | "n">; }[] = [
  { re: /(?<![0-9A-Z])(B200|B230|B420|B440|C220|C240|C3260)\s*(M\d)?(SX|S|L)?(?![0-9])/gi,
    make: (m) => ({ item: [m[1].toUpperCase(), m[2]?.toUpperCase()].filter(Boolean).join(" ") + (m[3] ? m[3].toUpperCase() : ""), cls: "server" }) },
  { re: /(?<![0-9])(5108)?\s*(?:Mini\s*)?(?:AC2?\s*|DC\s*)?Chassis(?![a-z])/gi, make: (m) => ({ item: m[1] ? "5108 chassis" : "chassis", cls: "chassis" }) },
  { re: /(?<![A-Z0-9])WLC\s?(\d{4})(?![0-9])/gi, make: (m) => ({ item: `WLC${m[1]}`, cls: "other" }) },
  { re: /MDS\s?(9148|9396)S?(?![0-9])/gi, make: (m) => ({ item: `MDS ${m[1]}S`, cls: "other" }) },
  { re: /Invicta\s?(\d+)T/gi, make: (m) => ({ item: `Invicta ${m[1]}T appliance`, cls: "other" }) },
  { re: /(?<![0-9A-Z-])AP(\d{4}[a-z]?)(-[A-Z])?(?![0-9])/gi, make: (m) => ({ item: `AP${m[1].toUpperCase()}${m[2] ?? ""}`, cls: "other" }) },
];

// A drive pack: counted drives are the CONTENTS only when the name names no server or chassis.
const DRIVE = /(?<![0-9.])(\d{1,2})\s*x\s*(\d+(?:\.\d+)?)\s*(GB|TB)\s*(SAS|SATA|NVMe|Optane|SSD|HDD)(?![a-z])/gi;
const PAK_HDD = /^(\d{1,2})\s*Pak\s*HDD$/i;

// Counted tokens that are a node's BUILD, not a line of the bundle: CPUs, memory, disks, adapters, IOMs.
const CONFIG = /^(?:E5-?\d{4}[a-z]?(?:\s?v\d)?|\d{4}[a-z]?(?:\s?v\d)?|\d+(?:\.\d+)?\s*(?:G|GB|TB|T)(?:B)?\s*(?:mem|DDR\d|RAM|HDD|HD|SAS|SATA|SSD|GHD|HD)?|\d+(?:\.\d+)?G?HD|VIC\d*|Palo|VNIC|[BEIQ]Mez|P81E|PSU|IO|IOM|SERVER\s*EXP|\d+\s*HD)$/i;
const ANY_COUNTED = /(?<![0-9.A-Za-z])(\d{1,2})\s*x\s*\(?\s*([A-Za-z0-9][A-Za-z0-9.-]*(?:\s?v\d)?(?:\s?(?:GB|TB|mem|DDR\d|RAM|HDD|SAS|SATA|SSD))?)/gi;

export function bundleContents(name: string | null | undefined, sku?: string): BundleContents {
  const raw = String(name ?? "");
  if (!raw.trim()) return { ok: false, reason: "no name" };
  // "Cisco UCS-SP-C220M5C-B" is the store's placeholder for a part whose description was never acquired. Read
  // as a name it yields "1x C220 M5" — the SKU a second time, through a path with none of the SKU axis's
  // refusals. The first validation run did exactly that on 55 of the 101 group-14 rows (nameMarker.ts records
  // the same trap costing 102 wireless rows). Group 14 was approved as "asked, no name rule"; this is that rule.
  if (sku !== undefined && nameIsJustTheSku(sku, raw)) return { ok: false, reason: "the name is only the SKU" };
  const s = clean(raw);
  if (/\d+\s*to\s*\d+\s*(?:HX\s?)?nodes?/i.test(s)) return { ok: false, reason: "a count stated as a range" };
  if (/addnl|additional|reqd|required/i.test(s)) return { ok: false, reason: "names items that are required, not included" };

  const crs = crsLineCardBundle(s);
  if (crs) return crs;

  const pak = PAK_HDD.exec(s);
  if (pak) return { ok: true, items: [`${+pak[1]}x HDD`], because: "drive pack" };

  const hits: Hit[] = [];
  const overlaps = (a: number, b: number) => hits.some((h) => a < h.end && b > h.start);
  for (const p of DEVICE_PATTERNS) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(s); m; m = p.re.exec(s)) {
      if (overlaps(m.index, m.index + m[0].length)) continue;
      const made = p.make(m);
      if (made && made.n > 0) hits.push({ start: m.index, end: m.index + m[0].length, ...made });
    }
  }
  const counted = new Set(hits.map((h) => h.cls));
  for (const u of UNCOUNTED) {
    u.re.lastIndex = 0;
    for (let m = u.re.exec(s); m; m = u.re.exec(s)) {
      if (overlaps(m.index, m.index + m[0].length)) continue;
      const made = u.make(m);
      if (made.cls !== "other" && counted.has(made.cls)) continue;
      // "Disk Expansion Pack FOR C240M4" names the machine the pack fits, not one it contains.
      if (made.cls === "server" && /for\s*$/i.test(s.slice(Math.max(0, m.index - 5), m.index))) continue;
      // "UCS C3260 Base Chassis" is ONE device: a chassis word right after a server model is its noun.
      if (made.cls === "chassis" && hits.some((h) => h.cls === "server" && h.end <= m!.index && m!.index - h.end <= 8)) continue;
      if (hits.some((h) => h.item === made.item)) continue;
      hits.push({ start: m.index, end: m.index + m[0].length, n: 1, ...made });
    }
  }
  const hasMachine = hits.some((h) => h.cls === "server" || h.cls === "chassis");
  if (!hasMachine) {
    DRIVE.lastIndex = 0;
    for (let m = DRIVE.exec(s); m; m = DRIVE.exec(s)) {
      if (overlaps(m.index, m.index + m[0].length)) continue;
      hits.push({ start: m.index, end: m.index + m[0].length, n: +m[1], item: `${m[2]}${m[3].toUpperCase()} ${m[4].toUpperCase() === "NVME" ? "NVMe" : m[4].toUpperCase() === "OPTANE" ? "Optane" : m[4].toUpperCase()}`, cls: "other" });
    }
  }

  // Every counted token must be a device line or a recognised build token. Anything else refuses the row.
  ANY_COUNTED.lastIndex = 0;
  for (let m = ANY_COUNTED.exec(s); m; m = ANY_COUNTED.exec(s)) {
    if (hits.some((h) => m!.index < h.end && m!.index + m![0].length > h.start)) continue;
    const tok = m[2].trim();
    if (CONFIG.test(tok)) continue;
    if (!hasMachine && /^\d+(?:\.\d+)?\s*(?:GB|TB)?\s*(?:SAS|SATA|NVMe|SSD|HDD)$/i.test(tok)) {
      return { ok: false, reason: `a drive line with no unit: "${m[0].trim()}"` };
    }
    return { ok: false, reason: `unrecognised counted item "${m[0].trim()}"` };
  }
  if (!hits.length) return { ok: false, reason: "the name states no contents" };
  hits.sort((a, b) => a.start - b.start);
  return { ok: true, items: hits.map((h) => `${h.n}x ${h.item}`), because: "name" };
}
