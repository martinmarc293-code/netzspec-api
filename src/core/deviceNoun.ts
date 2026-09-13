// src/core/deviceNoun.ts — the DEVICE-NOUN detector of the fallback census, kind-aware (13 Sep 2026).
//
// WHAT IT IS FOR. A part in a fallback kind (`unknown` / `other` / `accessory`), or in any kind asked
// nothing, scores itself complete while being asked one cup or none. The own-fact census finds such a
// part when it holds facts; this detector finds the one that holds none, because an undocumented
// product's NAME is the only thing that says it is a whole box. It found the UNITY-PIMG media gateways.
// scripts/build-cup-ledger.mts counts it per kind and over the union of both axes; tests/cupLedger.test.ts
// asserts that union is ZERO apart from a named residue (phase-1 close guide §5.5).
//
// MOVED OUT OF THE LEDGER BUILDER so the test exercises the real function rather than a copy of it: a
// stand-in tests the logic you were thinking about, never the code that runs (D:\Project\CLAUDE.md §17).
//
// TWO THINGS MAKE A NOUN IN A NAME NOT A FINDING, and they are kept as two mechanisms because they fail
// differently:
//
//   1. THE KIND SAYS SO (DEVICE_NOUN_EXEMPT_KINDS). A rack kit, a cable, a mains cord and a stacking cable
//      are NAMED AFTER THEIR HOST as a rule. Once a classifier has put the part in one of those kinds the
//      noun is the host's by construction. The exemption is by KIND, never by category or SKU, and it never
//      covers a fallback kind — `accessory` is exactly where a real controller was hiding (C9800-80-CAP-K9,
//      "Cisco Catalyst 9800-80 Wireless Controller", filed accessory by an antenna-CAP token).
//
//   2. THE NAME SAYS SO (the refusals in `ownPhrase`). The noun is present but belongs to another product:
//      the host in a compatibility clause, or a fixed compound whose head is a component. Each refusal names
//      the rows that earned it and none reads the SKU.
//
// WHAT WAS MEASURED AND REJECTED, because the rejected versions are the ones a future edit will reach for:
//   * A PARENTHETICAL refusal ("SAS Extender (servers requiring 8 HDDs)"). Over all 42,383 live hardware
//     rows it silenced 74 real boxes: "Nexus 7004 Bundle (Chassis,1xSUP2),No Power Supplies" names its
//     device only inside the brackets.
//   * A GENERAL head-noun refusal (device noun, up to three words, then kit / door / tray / filter / cable).
//     It is right about "NCS Fabric Chassis Horizontal Trough" and wrong about "Cisco Nexus 7000 Series
//     9-Slot chassis No Fan Trays" (N7K-C7009=, a chassis), "RFGW-10 Chassis inc Fan Tray Spare" and
//     "NO NAVIGATOR CONTROLLER Room Kit Mini" (a codec). A missed device is the failure this exists to stop,
//     so the compounds below are listed, each from rows, and the rest is a KIND question for the classifiers.
//
// KNOWN LIMIT OF THE HOST CLAUSE, measured 13 Sep 2026: `for` is also a PURPOSE word. It silences nine real
// appliances — "StealthWatch FlowCollector for NetFlow 1K appliance" (LC-FC-NF-1000-K9) — every one already
// in the named `analytics` kind, so none is inside the census today. A fallback row of that shape would be
// missed, and this sentence is the record of it.

/**
 * The vocabulary is unchanged from the builder's original DEVICE_NOUN_IN_NAME (12 Sep 2026): only nouns
 * that name a whole box, because a component noun in a component's name is correct and not a finding.
 * Deliberately narrower than nameMarker's DEVICE_NOUN. `\b` is the wrong tool for product strings.
 */
export const DEVICE_NOUN_IN_NAME =
  /(^|[^a-z])(?:switch|router|firewall|gateway|access point|transmitter|receiver|amplifier|server|appliance|chassis|controller|transceiver)(?:es|s)?([^a-z]|$)/i;

/**
 * KINDS WHOSE NAME PATTERN IS "NAMED AFTER ITS HOST". A device noun in the part's own phrase is the rule of
 * the kind, not a real product swallowed by a fallback. Two live rows per kind are pinned in
 * tests/cupLedger.test.ts (DEVICE_NOUN_EXEMPT_JUSTIFICATION) against partKind and this detector, so a
 * justification that stops being true fails the suite:
 *   mechanical   "Catalyst 9400 Series 10 slot chassis Rack Mount" · "Nexus 7700 - 10 Slot Chassis Front Door Kit"
 *   cable        "... Switch ... Stack Cable" / console and breakout cables named after the box they join
 *   power-cord   "... Power Cord ... for ... Chassis" — a mains cord named after the supply or chassis it feeds
 *   stack-cable  "StackWise ... cable for Catalyst ... switches"
 *
 * NOT HERE, ON PURPOSE: the fallback kinds (`unknown`, `other`, `accessory`, `component`, `non-hardware`) —
 * the census exists to look inside those — and `bundle`, whose name names the devices it contains.
 */
export const DEVICE_NOUN_EXEMPT_KINDS: readonly string[] = ["mechanical", "cable", "power-cord", "stack-cable"];

/**
 * THE HOST CLAUSE. What follows `for` / `for use with` / `compatible with` / `supported on` / `on` names the
 * product this part fits, not the part:
 *   R200-SATACBL-001  "Internal SATA Cable for a base UCS C200 M1 Server"
 *   R210-FAN5=        "Fan Tray for UCS C210 Rack Server"
 *   CWDM-MUX-4=       "4-Wavelength Add/Drop Mux for CWDM-CHASSIS-2="
 *   UCSC-CABLE-GPU    "Interior cable from MB to NVIDIA GPU card on C240 M3 server"
 *
 * A clause at the very START is not a host clause — nothing precedes it to be the part — and neither is one
 * after an ordering placeholder: "Base PID for Cisco 8500 Series Wireless Controller - DC" (AIR-CT85DC-K9) IS
 * the controller, and "TAA PID for Cisco wireless gateway for LoRaWAN" (IXM-LPWA-900-K9+) IS the gateway. Both
 * read the whole name, which is the direction that reports more.
 */
const HOST_CLAUSE = /(^|[\s,;(])(?:for use (?:with|in|on)|compatible with|supported on|for|on)(?=[\s,:./]|$)/i;
const PLACEHOLDER_HEAD = /^(?:[●•*]\s*)?(?:(?:cisco|taa|nal|base|spare)\s+)*(?:pid|sku|part(?:\s+number)?)?$/i;

/**
 * COMPOUNDS WHOSE HEAD IS NOT A BOX. The device word is a modifier, or names something that is not a
 * network box at all. Each alternative is the rows that earned it; `(?=[^a-z]|$)` not `\b`:
 *   controller cable(s)      UCS-240CBLMR8 "C240 M4 (2) RAID controller cables for 8 HD backplane"
 *   intrusion switch         HX-INT-SW02 "C220 and C240 M6 Chassis Intrusion Switch" — a lid sensor
 *   switch processor         MEM-C6K-CPTFL512M "Default switch processor (SP) bootflash on the Supervisor
 *                            Engine 32 PISA baseboard" — the Catalyst 6500 SP, a CPU complex on a card
 *   server(s) requiring      R210-SASXTDR "SAS Extender (servers requiring 8 HDDs) for UCS C210 M1"
 *   optical switch           4027014 "GS7000 Optical Switch", P2-OPSW-18X9-MPO= "Prisma 2 18x9 Optical
 *                            Switch", 4037229 "(P2-HD-OPSW-LA)1550HD Opt Switch,LA" — a fibre path switch
 *                            module in a node or a Prisma II shelf; videoKind pins it `unknown` ("no kind of
 *                            its own") and this is the name-side half of that decision
 *   <device> ... LED / LCD   CRS-FCC-LED "Fabric Card Chassis Fiber Module LED", 15454-M6-LCD "6 service slot
 *                            MSTP chassis LCD Display with backup Memory", N7K-C7018-LEDS= "Nexus 7018
 *                            Chassis LEDs Kit" — an indicator for the box, never the box. Up to three words
 *                            between; measured, it touches no box-kind row that is a box.
 * Listed, not generalised — see the header for the general rule that was measured and rejected.
 */
const COMPONENT_COMPOUNDS =
  /(?:^|[^a-z])(?:controller\s+cables?|(?:chassis\s+)?intrusion\s+switch(?:es)?|switch\s+processors?|servers?\s+requiring|opt(?:ical|\.)?\s+switch(?:es)?|(?:chassis|switch|router|controller|server)(?:\s+[a-z0-9-]+){0,3}\s+(?:leds?|lcd))(?=[^a-z]|$)/gi;

export type NounRefusal = "host-clause" | "component-compound";

/** The part's own phrase: the name minus its host clause and its component compounds. */
export function ownPhrase(name: string): { phrase: string; refusals: NounRefusal[] } {
  const refusals: NounRefusal[] = [];
  let s = String(name ?? "");
  const cut = HOST_CLAUSE.exec(s);
  if (cut && cut.index > 0 && !PLACEHOLDER_HEAD.test(s.slice(0, cut.index).trim())) {
    const head = s.slice(0, cut.index);
    if (!DEVICE_NOUN_IN_NAME.test(head) && DEVICE_NOUN_IN_NAME.test(s)) refusals.push("host-clause");
    s = head;
  }
  const noCompound = s.replace(COMPONENT_COMPOUNDS, " ");
  if (DEVICE_NOUN_IN_NAME.test(s) && !DEVICE_NOUN_IN_NAME.test(noCompound)) refusals.push("component-compound");
  return { phrase: noCompound, refusals };
}

/** True when the part's OWN phrase names a whole box. Kind-blind; see deviceNounFinding. */
export function namesADeviceNoun(name: string): boolean {
  return DEVICE_NOUN_IN_NAME.test(ownPhrase(name).phrase);
}

/** The census predicate: a device noun in the part's own phrase, in a kind that is not exempt. */
export function deviceNounFinding(kind: string, name: string): boolean {
  return !DEVICE_NOUN_EXEMPT_KINDS.includes(kind) && namesADeviceNoun(name);
}

/** The rule as one printable sentence — the builder writes it into every ledger's `_about`. */
export const DEVICE_NOUN_RULE_ABOUT =
  `device_noun counts a part whose OWN phrase names a whole box (${DEVICE_NOUN_IN_NAME.source}), ` +
  `after removing a host clause (for / for use with / compatible with / supported on / on) and the listed ` +
  `component compounds (controller cable, intrusion switch, switch processor, servers requiring, optical switch, ` +
  `<box> ... LED/LCD); a part in an EXEMPT kind [${DEVICE_NOUN_EXEMPT_KINDS.join(", ")}] is counted in ` +
  `device_noun_exempt instead, because those kinds are named after their host by rule (src/core/deviceNoun.ts).`;
