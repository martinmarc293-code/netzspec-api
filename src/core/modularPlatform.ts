// src/core/modularPlatform.ts — the derived, column-backed `modular` boolean of a router platform (operator ruling 4,
// 13 Sep 2026): does this platform take plug-in modules in slots/bays (NIM, SM-X, EHWIC/HWIC, PIM, SPA/EPA, PA, line
// cards)? `module_slots` is asked (pending) only of modular platforms and is n/a on fixed ones; its printed share is
// measured over modular held parts.
//
// A PLATFORM TABLE, NOT A LABEL READING: deciding "modular" from whether a datasheet prints a slot row would make the
// module_slots share 100% by construction. Each row is a platform family by SKU token, with the evidence it was set on
// (hand-read datasheets, 13 Sep 2026, or the family's defining hardware). Reviewer C.1 pass (13 Sep 2026): the Cisco ONE
// `C1-` prefix, CONE-/SPIAD bundles of the same chassis, bare 800-series model numbers (887VA) and G2 Secure Router SKUs with
// a suffix (C8231-E-G2) were added after reading the 468 null router rows; ISR 1100 stays null on purpose (some
// 'Pluggable' models take a PIM, some do not, and the SKU does not say which reliably). A family not listed returns null — unknown —
// which leaves module_slots pending rather than guessed either way. No `\b`: tokens are anchored with ^ and explicit
// character classes.

export type PlatformRow = { id: string; re: RegExp; modular: boolean; evidence: string };

export const ROUTER_PLATFORMS: readonly PlatformRow[] = [
  // ---- modular -------------------------------------------------------------------------------------------------------
  { id: "isr4000", re: /^(ISR4[2-4][0-9]{2}|C1-ISR4[2-4][0-9]{2}|(C1-)?CISCO4[2-4][0-9]{2})/, modular: true, evidence: "ISR 4000 data sheet (c78-732542): 'NIM slots', 'Enhanced service-module slots', 'Onboard ISC slot'" },
  { id: "cat8200-8300", re: /^C8[23]00L?-/, modular: true, evidence: "Catalyst 8200 / 8300 data sheets: 'Slots' row; 'C8200 1RU w/ 1 NIM slot', 'C8300 2RU (2 SM and 2 NIM slots)'" },
  { id: "secure-router-8200-8300-g2", re: /^C8[23][0-9]{2}(-[A-Z]{1,3})?-G2/, modular: true, evidence: "8200/8300 Series Secure Routers: NIM (and SM on 8300) slots, the G2 successors of the Catalyst 8200/8300" },
  { id: "isr-g2", re: /^(C1-)?(CISCO|C)(19[0-9]{2}|29[0-9]{2}|39[0-9]{2})([^0-9]|$)|^CONE-(19|29|39)[0-9]{2}|^SPIAD(29|39)[0-9]{2}/, modular: true, evidence: "ISR G2 1900/2900/3900: EHWIC slots and service-module slots (1900 data sheet c78-598389 prints module slots)" },
  { id: "isr-g1", re: /^(CISCO|C)(18[0-9]{2}|28[0-9]{2}|38[0-9]{2})([^0-9]|$)/, modular: true, evidence: "ISR G1 1841/2800/3800: HWIC and network-module slots" },
  { id: "asr1000", re: /^(C1-)?ASR100[0-9]|^ASR1K/, modular: true, evidence: "ASR 1000: SPA/EPA bays on 1001-X/1002-X/1001-HX/1002-HX, SIP/RP/ESP slots on 1004/1006/1009/1013" },
  { id: "c7200-7600", re: /^7206|^76(0[3-9]|13)/, modular: true, evidence: "7206VXR port-adapter slots; 7600 line-card chassis" },
  { id: "ir1101-1800", re: /^IR1(101|8[0-9]{2})/, modular: true, evidence: "IR1101 expansion module and PIM; IR1800 pluggable interface modules" },
  { id: "ir8100-8300", re: /^IR8[13]00/, modular: true, evidence: "IR8100 / IR8300 heavy-duty routers take pluggable interface modules" },
  { id: "cgr", re: /^CGR-?[12][0-9]{3}/, modular: true, evidence: "CGR 1000 / 2010 connected grid routers take interface modules (GRWIC / CGM)" },
  // ---- fixed ---------------------------------------------------------------------------------------------------------
  { id: "isr800", re: /^(CISCO|C)8[0-9]{2}([^0-9]|$)|^IAD888|^8[0-9]{2}(VA|EA|W|G|M|H)([^0-9A-Z]|$)/, modular: false, evidence: "880/887 data sheet: per-model WAN Interface / LAN Interfaces table, no module slots" },
  { id: "isr900", re: /^C9[0-9]{2}(-|$)/, modular: false, evidence: "900 Series ISR data sheet (c78-741615): fixed WAN and LAN interfaces, no slots" },
  { id: "rv-cvr", re: /^RV[0-9]{3}|^CVR328|^R260/, modular: false, evidence: "RV / CVR small-business routers: fixed ports" },
  { id: "ir800-500", re: /^IR(8[0-9]{2}|5[0-9]{2})([^0-9]|$)/, modular: false, evidence: "IR807/809/829 and IR510/IR530: fixed industrial routers" },
  { id: "cg-gateways", re: /^CG(113|418|522)/, modular: false, evidence: "Catalyst Cellular / Wireless Gateways: fixed" },
  { id: "esr", re: /^CISCO59[0-9]{2}|^ESR-6300/, modular: false, evidence: "5900 / ESR6300 embedded services router cards: board-level, no module slots" },
];

/** true / false from the platform table, null when no family row places the SKU (asked pending, never guessed). */
export function modularPlatform(sku: string): boolean | null {
  const s = sku.toUpperCase().trim().replace(/=+$/, "");
  for (const row of ROUTER_PLATFORMS) if (row.re.test(s)) return row.modular;
  return null;
}
