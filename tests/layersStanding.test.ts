// tests/layersStanding.test.ts — the layers reviewer's STANDING checks over every category that has passed review, run on the built
// rows (data/layers/cisco-<category>.rows.tsv) and the mapping files. The checks live in src/core/layerChecks.ts.
//
//   spare = base · plan coverage · twins · leakage (cross-claims, against data/reference/layers-cross-claims.json) · rule shadowing ·
//   the page names its commit.
//
//   npx tsx tests/layersStanding.test.ts
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { readLayerRows, pairDisagreements, twinGroups, crossClaims, ruleUse, classifyRules, incomingRows, labelViolations, labelEvidenceDrift, movedRowsStillRefused, seriesEntryDisagreements, deviceInSharedParts, unplacedArrivals, sharedLabelNotExplicit, crossCategoryTwins, nonHardwarePlansOnPage, gluedDigitKeeps, sharedPartsNamedBySeries, crossLineNamedBySeries, DEVICE_KINDS, type LayerRow } from "../src/core/layerChecks.js";
import { labelEvidence, digitPattern, ALIAS_REQUIRES, NUMBER_KEYED_ALIASES } from "../src/core/labelEvidence.js";

export const REVIEWED = ["switches", "routers", "transceiver", "interfaces-modules", "wireless", "servers-unified-computing", "hyperconverged-infrastructure", "hyperconverged-systems", "security", "video", "optical-networking", "storage-networking", "unified-communications", "collaboration-endpoints", "meraki"];
// spare = base exceptions, each read against the built row
const PAIR_EXCEPTIONS: Record<string, string> = {
  "switches|N5K-C5696Q-C": "the spare row is named '^Invalid SKU' and carries a class non_product plan; its base is the live 'Nexus 5696Q Chassis with license and SW image'",
  // C9105AXW-KIT's exception went with batch 3a (run #1118, 16 Sep 2026): the "Do not use" base is no longer a hardware row, so the pair no
  // longer disagrees and a kept entry would be the stale exception the check below exists to catch
  // servers + hyperconverged round (layers round 3): Cisco voided one member of each pair — the voided member carries the kind layer's
  // class non_product plan ("self-declared VOID PID"), the other is the live part in its series
  "servers-unified-computing|UCS-C3K-EX40TE": "the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'UCS C3X60 Expander 4x 10TB … 40TB' in UCS S3260",
  "servers-unified-computing|UCS-C3K-SSD10": "the spare is named 'VOID: not used' and carries a class non_product plan; the base is the live 'Cisco UCS C3X60 SSD+HDD Row' in UCS S3260",
  "servers-unified-computing|UCS-S3260-EX32T": "the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'S3260 HDD Expander with 4x 8TB …' in UCS S3260",
  "servers-unified-computing|UCS-S3260-EX48T": "the spare is named 'Void; Not Used' and carries a class non_product plan; the base is the live 'UCS S3260 Disk Expansion Tray with 4x 12TB' in UCS S3260",
  "servers-unified-computing|UCS-S3260-EX64T": "the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'UCS S3260 Rear Expander with 4x16TB …' in UCS S3260",
  "servers-unified-computing|UCS-S3260-EX8T": "the spare is named 'Void; Not Used' and carries a class non_product plan; the base is the live 'UCS S3260 Disk Expansion Tray with 4x 2TB' in UCS S3260",
  "servers-unified-computing|UCSB-EX-M4-1": "the BASE is named 'VOID-TO BE OBSOLETED' and carries a class non_product plan; the spare UCSB-EX-M4-1= is the live 'UCS Scalable M4 Blade Module w/o CPU/DIMM/HDD'",
  "servers-unified-computing|UCSX-440P": "the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'Cisco UCS X-Series Gen4 PCIe node within UCS X210c config' in UCS X440p PCIe node",
  "servers-unified-computing|UCS-MAN-S72A2T0V0": "kind only: the base is named 'MSFT AzureStack HCI Hyb CTO Node C220 M7sn w/Mellanox' (server), the spare only by its SKU, so the kind axis reads its MAN token (bundle); both sit in UCS C220",
  "servers-unified-computing|UCSW-MSX-PCBL": "kind only: the base 'UCS Invicta Scaling System Mellanox Switch Power Cable' reads server from its SKU token, the spare '… Mellanox Jumper Cable' reads cable through its name; both sit in UCS Invicta (Whiptail) — a kind-layer defect listed in the round's record, not changed in a layers round",
  "servers-unified-computing|UCSW-WT-35HDDT": "kind only: the base (name cut to 'UCSW Whiptail Super Micro 3.5') reads server from its SKU token, the spare '… 3.5\" HDD Tray …' reads drive through its name, and a tray is neither; both sit in UCS Invicta (Whiptail) — a kind-layer defect listed in the round's record",
  "optical-networking|15454-M2-DDR": "kind only: the base is named only by its SKU (accessory), the spare '2 service slot MSTP chassis deep door' reads mechanical through its name; both sit in ONS 15454 MSTP",
  "optical-networking|15454-M2-WM": "kind only: the base is named only by its SKU (accessory), the spare 'Wall mount bracket, Cisco NCS2002' reads mechanical through its name; both sit in ONS 15454 MSTP",
  "video|CBR-PS-BLANK":"kind only: the base 'cBR-8 Power Supply Blanks (for empty Power Supply slots)' reads power from its PS token, the spare 'Blanks for the Power Supply Slots' reads accessory; both sit in cBR-8 — a kind-layer defect listed in the video round's record",
  "video|P2-HD-EDR-SA": "kind only: the base is named only by its SKU ('Cisco P2-HD-EDR-SA', kind unknown), the spare 'Cisco Prisma II EDR Host Module with 2:1 Tx' reads plug-in through its name; both sit in Prisma II HD",
  "security|ASA5585-REAR-RACK":"kind only: the base 'ASA 5585 Rear Rack Mount' reads mechanical through its name, the spare 'ASA 5585-X Rear Rack Mounts (1 pair)' stays accessory (the name marker does not read the plural); both sit in ASA 5585-X — a kind-layer defect listed in the security round's record",
  "hyperconverged-systems|HXAF-E-240-M5SX":"the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'Cisco HyperFlex All Flash Edge 240 Full Capacity M5 system' in HyperFlex Edge",
  // re-audit decisions (operator, 15 Sep 2026): the check covers X, X=, X- and X-- (N-1, the twin rule), keyed by the group's base —
  // or its lowest member when no base is a row. N-3 classes the rows whose own catalogue entry says "Not used" / "Do not use"; where a
  // twin of such a row is the live part, the pair disagrees on purpose (the VOID precedent above)
  // the six N-3 twin exceptions (BRKT-SX10-WMK, CTS-SX10CODEC=, CTS-SX20G2-K9+, HS-WL-ADPT-USBA, FP-NMSB-40G, AIR-ANT5175V-N) went with
  // batch 3a (runs #1112 / #1115 / #1118, 16 Sep 2026): each "Not used" member has left its hardware page, so the twins on the page agree
  // again and the entries would now be stale — which is exactly what the check below refuses
  // the moves of 16 Sep brought a base to its spare's page and the two read different kinds — a kind-layer defect, listed for the Q-28
  // rebuild (docs/decisions/2026-09-15-q28-kind-rebuild-list.md), not fixed in a layers round
  "servers-unified-computing|UCS-ACC-6536": "kind only: the base 'UCS 6536 chassis accessory kit' reads mechanical through its name, the spare UCS-ACC-6536= (named only by its SKU) stays accessory; both sit in UCS 6500 Fabric Interconnects since the base arrived from interfaces-modules (run #1158). UCS-ACC-6652 and UCS-ACC-6664 read mechanical the same way and have no spare row to disagree with",
};

// device-in-shared-parts exceptions (collaboration round): a whole product with no series and no document naming one. Re-audit decisions
// (operator, 15 Sep 2026, Q-18): kept as exceptions — no invented series — with the operator's reason
const DEVICE_EXCEPTIONS: Record<string, string> = {
  "collaboration-endpoints|CTS-LAPT-DISP": "Cisco names no series; device kept out of shared-parts semantics by exception (Q-18) — 'TelePresence Laptop Display' (label TelePresence MX Series; only the generic 'HW Collaboration PIDs' end-of-sale notice names it), in TelePresence (legacy) shared parts",
  "collaboration-endpoints|CTS-LAPT-DISP=": "Cisco names no series; device kept out of shared-parts semantics by exception (Q-18) — the spare of CTS-LAPT-DISP 'TelePresence Laptop Display'",
  "collaboration-endpoints|CTS-VX-EDUCATOR-K9": "Cisco names no series; device kept out of shared-parts semantics by exception (Q-18) — 'VX Educator package' (label TelePresence MX Series; the generic 'Collaboration PIDs' end-of-sale notice), in TelePresence (legacy) shared parts",
  // the interfaces-modules -> security move of 16 Sep (run #1159) brought this card to the page its platform sits on, and the kind axis
  // reads it as a device — the security round predicted exactly this ("securityKind: ASA-SSC-AIP-5-K9= reads appliance … after that run it
  // would be a device kind in ASA shared parts"). It is a CARD (the interfaces-modules plan records expected kind `module`), so the row is
  // right and the KIND is wrong: listed for the Q-28 rebuild, kept as an exception until the kind axis is fixed
  "security|ASA-SSC-AIP-5-K9=": "a kind-layer defect, not a device: securityKind reads the ASA 5500 AIP-SSC-5 CARD as `appliance`; it sits in ASA and ISA shared parts with the other ASA 5500 service modules (Q-28)",
};

// Q-26 (operator, "after the runs"): the rows the label check keeps on a digit token whose GLUED SPELLING the page does not attest.
// `gluedDigitKeeps` in src/core/layerChecks.ts carries the measurement that settled the rule B1 proposed (it would have moved 40
// correct rows and no wrong ones, and all three rows it was written for are already placed by SKU rules). These nine are the whole
// list today, each kept because the glued letters are Cisco's own abbreviation of the series name written in a SKU — an abbreviation
// no page rule attests, because no SKU-placed row of that series happens to use it. A NEW entry here is the B1 defect returning.
const GLUED_DIGIT_EXCEPTIONS: Record<string, string> = {
  "switches|NXK-ACC-KIT-2RU": "N9000 is Cisco's SKU spelling of Nexus 9000 — \"Cisco N3000/N9000 Fixed Accessory Kit, 2 RU\"; the Nexus 9000 shared-parts series has no SKU-placed row writing N9000",
  "switches|NXK-ACC-RMK-1RU": "N9300 is a Nexus 9000 model — \"Cisco N9300 fixed accessory kit for 4-post rack\"",
  "switches|NXK-DC-4.4KW-A": "N9800 is a Nexus 9000 model — \"Cisco N9800 DC power supply\"",
  "switches|NXK-HV6.3KW20A-A": "N9800 is a Nexus 9000 model — \"Cisco N9800 6300W 20A AC and HV power supply\"",
  "switches|NXK-HV6.3KW30A-A": "N9800 is a Nexus 9000 model — \"Cisco N9800 6300W 30A AC and HV power supply\"",
  "switches|FAN-MOD-09=": "Cat6509 is Catalyst 6500 — \"Fan Mod CISCO7609 (2 required)/Cat6509-NEB-A\"; the page attests C+6500 (WS-C6597=) but not CAT+6500",
  "switches|PWR-4000-DC": "Cat6509 is Catalyst 6500 — \"4000W DC PS for CISCO7609-S/CISCO7609/13, Cat6509/13\"",
  "switches|PWR-6000-DC": "Cat6506/09/13 are Catalyst 6500 — \"6000W DC PS for CISCO7609/7609-S/13, Cat6506/09/13\"",
  "switches|PWR-6000-DC=": "the spare of PWR-6000-DC, same name",
};

// Q-27 / B2 (operator, "after the runs"): the REVERSE label check — rows a hard SKU catch-all put in a line's shared parts that
// exactly one sibling series would keep on its own evidence. `sharedPartsNamedBySeries` in src/core/layerChecks.ts carries the
// measurement and the reason it reports rather than moves (12 of the 805 are named on a STANDARDS number — BS 1363 read as
// Catalyst 1300 — a guard a mover would need first).
//
// Recorded as an EXACT count per category, not as a floor of zero: 805 rows is a review queue, and a check that must be zero from
// today would be turned off on the first run. Each category's next round drives its number down and the record with it; a number
// that RISES is a new catch-all placing rows nothing judges, which is exactly B2. Both directions fail, so neither drifts silently.
//
// 16 Sep 2026, 805 -> 800: the acronym clause of `labelEvidence` anchored its NAME side as "no lowercase after", so an acronym
// matched the start of any longer ALL-CAPS word. Tightening it to "no letter after" withdrew five proposals, and this check is
// what caught that the change moved anything at all — my own blast measurement had filtered to the rows the rule JUDGES and so
// could not see the shared-parts rows this check reads. Down is the direction a review is supposed to move, and all five are
// withdrawals of a claim nothing should have made: wireless 66 -> 65 (AIR-A03-D500GC3, a 500 GB SATA drive, proposed for
// "Aironet 1550 hazardous-location (H / SA / SD / WU)" on SA inside SATA) and collaboration-endpoints 104 -> 100 (four
// CAB-ETHRJ45 cables proposed for "TelePresence MX" on MX inside MXCAM-D, on a page that also carries a TelePresence MXP).
//
// 16 Sep 2026, 800 -> 742: the MODEL LETTER FENCE (`leadLetters` + `digitPattern`). 69 proposals withdrawn, 11 created, and
// ZERO rows fall out of a series. Only two totals move — servers 264 -> 218 and collaboration 100 -> 88 — but TWO CATEGORIES
// HOLD THE SAME NUMBER WITH DIFFERENT CONTENT: hyperconverged-systems lost its nine 480GB SSDs and the RP208 PDU and gained
// ten C220/C240 rack-server rail kits, CMAs and RAID kits that previously tied between the compute-only-node series and
// HX220c/HX240c. An unchanged count is not an unchanged queue, which is exactly why these are recorded per category and read
// rather than trusted. Full record: docs/decisions/2026-09-16-the-model-letter-fence-prepared-not-applied.md
const REVERSE_EXPECT: Record<string, number> = {
  // routers 46 -> 44 (16 Sep 2026): CAB-N5K6A-NA(=) is a NEXUS 5000 power cord that reached NCS 5000, because LABEL_ALIASES
  // is keyed by a bare number and "5000" offers `N5K` to every series carrying that number. See ALIAS_REQUIRES.
  // collaboration 88 -> 80 and switches 98 -> 90 (16 Sep 2026): a STANDARDS number is not a platform. Eight China power cords
  // reached "Integrator Package 6000 MXP" through IEC 60320, and eight more reached Catalyst 1000 / 1200 / 1300 and Nexus 6000
  // through NBR 14136, GB 2099.1, SEV 1011, BS 1363 and IS:1293. See STANDARDS_BODY in labelEvidence.
  // 724 -> 708 (16 Sep 2026): seven CATEGORY NOUNS and BRAND words added to STOP — point/points, management, prime, package,
  // serial, chassis. wireless 65 -> 59 (six AP brackets on "point", the category noun inside "…outdoor access point / bridge"),
  // security 27 -> 22 (four "Cable Management Arm" rows, one Cisco Prime ACCESS REGISTRAR under Prime SECURITY MANAGER),
  // servers 218 -> 216 (two MLBs on "chassis"), interfaces-modules 11 -> 9 ("serial"), collaboration 80 -> 79 ("package").
  // 708 -> 704 (16 Sep 2026): the low end of a unit-bearing RANGE is a measurement. servers 216 -> 212 (four "1400W AC Power
  // Supply (200 - 240V)" rows out of UCS C200). ROUTERS IS UNCHANGED AT 44 AND ITS CONTENT IS NOT: three 863-928 MHz antennas
  // leave IR 800, and the same three ARRIVE at "Wireless Gateway for LoRaWAN" and "IR 500 WPAN" — removing the false rival let
  // their real series win a claim it had been tied out of. Second time tonight a total held still while the queue changed.
  "servers-unified-computing": 212, "hyperconverged-infrastructure": 109, "collaboration-endpoints": 79, switches: 90,
  wireless: 59, routers: 44, "storage-networking": 38, "hyperconverged-systems": 31, security: 22, "interfaces-modules": 9,
  "unified-communications": 5, video: 3, "optical-networking": 3, transceiver: 0, meraki: 0,
};

// THE CROSS-LINE SCAN (16 Sep 2026). Q-27's reverse check asks only the siblings of a row's OWN line, so a row filed under the
// WRONG line is invisible to it — `N20-BBLKD2=` is a "UCS C250 M2 and M1 HDD blanking panel" in the B-Series line, where the only
// series that could ever claim it was UCS B250. `crossLineNamedBySeries` asks every line of the category and reports a row NO
// series of its own line names while exactly one series of another does, on STRONG evidence only (an exact digit token or the
// full series name): the unrestricted scan returns 541 rows of which 412 rest on a widened round number, which is a list nobody
// runs twice.
//
// Recorded as an exact count for the same reason REVERSE_EXPECT is, and with the same honesty: **all 90 were read**, and roughly
// 55 are real. The good ones are worth the check on their own — eight Catalyst 9124AX mounting brackets and the 9105i and
// C9130AXE brackets sitting in Aironet, four controller power supplies ("770W AC Hot-Plug Power Supply for 5520 Controller")
// sitting under Wireless Antennas, UCS 5108 chassis parts, S3260 I/O expanders, fourteen TPM modules and six Optane memory
// modules filed away from UCS Server Components. The ~35 that are wrong are causes already recorded and already unfixable here:
// a CAPACITY read as a platform (`UCSX-M2-240G` "240GB SATA M.2" -> UCS C240; `SSD-120G` -> Meraki MS120; `CAB-SPWR-150CM`
// -> MS150), the optical customer-variant codes (`X1001`), and a few bundles. A queue that contains known refusals is what Q-27's
// own 704 already is; the number's job is that a NEW mis-file cannot appear in silence.
const CROSSLINE_EXPECT: Record<string, number> = {
  "servers-unified-computing": 52, wireless: 25, switches: 5, "optical-networking": 4,
  "hyperconverged-infrastructure": 3, "collaboration-endpoints": 1,
  routers: 0, transceiver: 0, "interfaces-modules": 0, "hyperconverged-systems": 0, security: 0,
  video: 0, "storage-networking": 0, "unified-communications": 0, meraki: 0,
};

// The four rows the fence is known to LOSE, named so the cost cannot go quiet. `UCSC-SCCBL240` reads as UCS C-series /
// SuperCap CaBLe / 240, and that 240 really is the C240 — but the letter before it is the `L` of `CBL`, so the fence refuses
// a match that was right. They stay in their line's shared parts. This asserts that, so if anyone later rescues them (a
// tuning, an alias, a mapping entry) the check goes red and the exception is re-read rather than silently outliving its
// reason — a list of what a rule deliberately excludes should be a guard, not a comment.
const FENCE_KNOWN_LOSSES = ["UCSC-SCCBL240", "UCSC-SCCBL240=", "UCSC-SCCBL220", "UCSC-SCCBL220="];

// The three rows the RANGE rule moved off IR 800 and onto the series their own names state. A count cannot see this — routers
// reads 44 before and after — so the outcome is asserted by name.
const RANGE_RULE_MOVES: [string, string][] = [
  ["ANT-LPWA-SMA-D", "Wireless Gateway for LoRaWAN"], ["ANT-LPWA-SMA-D=", "Wireless Gateway for LoRaWAN"],
  ["ANT-WPAN-OD-OUT-N", "IR 500 WPAN"],
];

// BOTH OF THE LISTS ABOVE NAME SKUs, AND A NAMED SKU CAN LEAVE THE PAGE. Their per-category loops skip a SKU they cannot find,
// which is exactly the one-sided shape this suite already refuses everywhere else ("a stale exception is a hole" appears on the
// leakage, glued-digit, arrivals, device and twin lists). These sets collect what was actually found so the run can assert,
// once, that every listed SKU was seen — 16 Sep 2026, written after the same defect was found four times in one night.
const fenceSeen = new Set<string>(), rangeSeen = new Set<string>();

// THE LABEL CHECK, per category (layers round 3, operator: the round-2 floor "more than 100 label-placed rows" failed by construction
// on a category every row of which a SKU rule places). `min`: a floor that proves the check computed evidence where labels place
// rows; `exactly`: the category's measured count, so a mapping change that starts placing rows by label is a visible change.
const LABEL_EXPECT: Record<string, { min?: number; exactly?: number; why: string }> = {
  switches: { min: 100, why: "hundreds of rows are placed by a stored series label" },
  routers: { min: 100, why: "hundreds of rows are placed by a stored series label" },
  transceiver: { exactly: 0, why: "every transceiver row is placed by its SKU's form-factor and speed family; the mapping's labels place nothing (layers round 3)" },
  wireless: { exactly: 28, why: "access points, controllers and their parts are placed by SKU; 28 rows are judged on a stored label (11 kept by a token or name, 17 moved to their line's shared parts — layers round 3). Re-audit decisions (15 Sep 2026): 30 -> 28, the MobileAccessVE control unit AIR-VCU-CELLPCS12(=), moved for want of a 5500 token, is SKU-placed in the MobileAccessVE series (Q-12)" },
  "interfaces-modules": { exactly: 5, why: "the cards are placed by their SKU families; 5 rows are judged on a stored label — STM1-CN-MM / -SMI kept by the name token PA, and AIC-DBL-PNL, AIC-SGL-PNL and WDM-SFP-2CH-CONV= moved to shared parts; the 30 labels mapped directly to a line's shared parts are not judged (pre-ruling C1, layers round 3)" },
  "servers-unified-computing": { exactly: 1, why: "UCS rows are placed by SKU; one row is judged on a stored label — SAS3 (a datasheet fragment, label 'S-Series Storage'), moved to the S-Series line's shared parts; the rows whose label maps directly to a line's shared parts are not judged (pre-ruling C1). The ten E1x0 service spares and the SRE parts the check had moved are SKU-placed or planned out since the servers round" },
  "hyperconverged-infrastructure": { exactly: 0, why: "HCI rows are placed by SKU; its 97 label-placed rows carry labels mapped directly to the Nutanix line's shared parts (pre-ruling C1, not judged)" },
  "hyperconverged-systems": { exactly: 0, why: "HyperFlex rows are placed by SKU or, for five Cisco+ offers, by name; its 32 label-placed rows carry the label mapped directly to HyperFlex shared parts (pre-ruling C1, not judged)" },
  "unified-communications": { exactly: 16, why: "UC appliances are placed by SKU; 16 are judged on a stored label — 8 kept (the VCS and CTI-CE bundles by the token VCS), 8 moved to their line's shared parts (the UC- server components of Business Edition, the CUCM admin security tokens) (layers round 3)" },
  "storage-networking": { exactly: 2, why:"MDS rows are placed by SKU; 2 are judged on a stored label and moved to the line's shared parts — M9XT-FC1632 / = 'MDS 32G FC Port Expansion module' (label MDS 9100, no platform token); SAN50C-R, held for review as a whole switch, is SKU-placed from the MDS 9250i end-of-sale notice (layers round 3)" },
  "optical-networking": { exactly: 12, why:"optical rows are placed by SKU; 12 are judged on a stored label — CISCO-15454-M6 kept by the SKU token 15454, 11 moved to their line's shared parts (4X100G-LR-S, internal 800- numbers, customer-variant CO- transponders, two MPO cables); the family placeholders 40-SMR1 / 40-SMR2 carry class plans (layers round 3)" },
  video: { exactly: 1, why:"cable-access rows are placed by SKU or by the family their name states; one row is judged on a stored label and moved to its line's shared parts — PWR-CAB-AC-BLK (a power cord, label cBR-8); 4035899, which the check had moved for want of name evidence, is SKU-placed from its end-of-sale notice (layers round 3)" },
  meraki: { exactly: 0, why: "every Meraki row is placed by its model's SKU rule; the mapping has no labels (layers round 3)" },
  "collaboration-endpoints": { exactly: 46, why:"endpoints and their parts are placed by SKU; 46 rows are judged on a stored label — 19 kept (the CS-MX / ACC-MX200 / SX rows by their SKU tokens, AVIZ-MXCART= 'Avizia MX Cart', PHD-KIT=, PSU-CAM-V=, ACC-PHD1080P= and the Webex Share rows by name), 27 moved to their line's shared parts (the Webex Share power adapters and clips, the SpeakerTrack 60 12 V supply, three Avizia and three Jabra SolutionsPlus rows, ADPT-HDMI-DVID=, WBP54G). The Avizia CA300 / CA750 carts the check had kept on their own model numbers are SKU-placed in TelePresence (legacy) shared parts (layers round 3)" },
  security: { exactly: 14, why:"security appliances are placed by SKU; 14 rows are judged on a stored label — CAB-CONS-USB-C= kept by the name token 1200, ISE-SNS-ACCYKIT by the SKU token SNS, 12 moved to their line's shared parts (UCS spares filed under ISE, desktop power supplies, CSACS-ACCYKIT, PRIME-ACC-REG); 9 rows on labels mapped directly to shared parts are not judged (pre-ruling C1, layers round 3). Re-audit decisions (15 Sep 2026): 16 -> 14, the IE supplies PWR-IE50W-AC / -IEC carry move plans to switches Industrial Ethernet, beside their spares (Q-20)" },
};
// THE FAMILY LAYER, per category: "in-use" where Cisco names families over series (switches, routers); "none" where Cisco names none
// and every line of 3+ series says why (layers round 3: optics and modules, operator — "—" with a no_family_reason is the expected result).
const FAMILY_EXPECT: Record<string, "in-use" | "none"> = { switches: "in-use", routers: "in-use", transceiver: "none", "interfaces-modules": "none", wireless: "none",
  // servers + hyperconverged round: Cisco names the UCS server families as the lines themselves (C-Series, B-Series, X-Series …) and
  // no family between a line and its models; HyperFlex and Compute Hyperconverged name nodes directly under the product
  "servers-unified-computing": "none", "hyperconverged-infrastructure": "none", "hyperconverged-systems": "none",
  // security round: Cisco names its firewall, ASA, analytics, email / web and management series directly under each security product
  security: "none",
  // video round: the GS7000, Prisma II, Remote PHY, RF Gateway and cBR-8 platforms are the lines; Cisco names nothing between them and their series
  video: "none",
  // optical round: NCS 1000, ONS 15454 / NCS 2000, ONS 15216 / 15200, NCS 4000 and Routed Optical Networking are the lines; no line holds 3+ series
  "optical-networking": "none",
  // storage round: MDS 9000 is the family and the line; directors and fabric switches are kinds
  "storage-networking": "none",
  // UC round: the VG gateways, ATAs, Business Edition, Expressway / VCS, Unity and paging products are named under each line directly
  "unified-communications": "none",
  // collaboration round: the Room / Desk / Board Series, Headsets, Cameras, legacy TelePresence and IP Phones name their series directly
  "collaboration-endpoints": "none",
  // meraki round: the MV camera generations Cisco's documents name ('Second Generation MV Cameras', 'Third-generation MV cameras') group
  // the MV series; MX, Z, MG and MT name their models directly
  meraki: "in-use" };
// ARRIVALS (layers round 3): a not-run move plan out of a reviewed category must land placed in its target's mapping. These four
// plans predate the check (switches + routers rounds) and their targets cannot place them yet; each is listed with the round that
// owns the target's rule. A listed row that now places is a stale exception and fails. (Operator, layers round 3: 11 -> 4 — the
// IC3000 series in routers and CW-SFP-KIT1 in switches were added, the nine TA-* plans were cancelled: those rows are Nexus switches.)
// Layers round 3, wireless round: AIR-BR1310G and CWWLSE-1130-19-K9 now place (wireless series "Aironet 1310 outdoor access point /
// bridge (legacy)" and line "Wireless LAN Solution Engine (legacy)"); their exceptions are retired.
// Servers round: XRV-PCIE-C40Q-03 and XRV-PCIE-IQ10GF now place (servers "Network and storage adapters", ^XRV-PCIE-); retired.
const ARRIVAL_EXCEPTIONS: Record<string, string> = {};
// transceiver (operator, layers round 3): the same-cage cable series holds only cables, and a breakout cable sits in its host cage's
// speed series, never in the DAC series
const TX_DAC_SERIES = "DAC and AOC cables (SFP+ / SFP28 / SFP56 / QSFP / QSFP-DD)";
const cableContract = (rows: LayerRow[]) => ({
  notCableInDac: rows.filter((r) => r.bucket === "layered" && r.series === TX_DAC_SERIES && r.kind !== "cable"),
  breakoutOutsideSpeed: rows.filter((r) => r.bucket === "layered" && r.kind === "breakout-cable" && (r.series === TX_DAC_SERIES || r.product_line !== "Ethernet transceivers")),
});
const labelExpectMiss = (cat: string, labelPlaced: number): string | null => {
  const e = LABEL_EXPECT[cat];
  if (!e) return `no label expectation recorded for ${cat}`;
  if (e.exactly !== undefined && labelPlaced !== e.exactly) return `label-placed ${labelPlaced}, expected exactly ${e.exactly} (${e.why})`;
  if (e.min !== undefined && labelPlaced <= e.min) return `label-placed ${labelPlaced}, expected more than ${e.min} (${e.why})`;
  return null;
};
/** a family found on a layered row (the shared-across marker and "" are not families) */
const familiesInUse = (rows: LayerRow[]) => rows.filter((r) => r.bucket === "layered" && r.product_family && !r.product_family.startsWith("("));

/** series with 0 parts that say nothing about what they wait for */
const deadPlaceholders = (summary: { lines: { line: string; series: { series: string; parts: number; pending_in?: Record<string, number> }[] }[] }) =>
  summary.lines.flatMap((l) => l.series.filter((x) => x.parts === 0 && Object.keys(x.pending_in ?? {}).length === 0).map((x) => `${l.line} / ${x.series}`));
/** rows layered in a series whose every row must carry a move plan */
const moveOutStrays = (rows: LayerRow[], moveOut: ReadonlySet<string>) => rows.filter((r) => r.bucket === "layered" && moveOut.has(r.series));

let passed = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };

const CATS = fs.readdirSync(path.join(REPO_ROOT, "data", "reference", "product-lines")).map((f) => f.replace(/^cisco-|\.json$/g, ""));
const PLANS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "kind-layer-plans-2026-09-13.json"), "utf8"));

// A WITNESS WHOSE MOVE PLAN HAS RUN (the 1,021 moves of 16 Sep). It says more than the plan text did: the row has LEFT its old page, it
// IS a row on the target page, and the plan carries the run id that moved it. A witness that only read the plan text would have to be
// deleted every time a plan runs, and deleting witnesses as the work proceeds is how a suite stops watching the thing it was written for.
const PAGE_ROWS = new Map<string, Map<string, LayerRow>>();
const pageRow = (cat: string, sku: string) => {
  if (!PAGE_ROWS.has(cat)) PAGE_ROWS.set(cat, new Map(readLayerRows(cat).map((r) => [r.sku, r])));
  return PAGE_ROWS.get(cat)!.get(sku);
};
const ranMove = (from: string, sku: string, to: string) => check(`${from} page: ${sku} moved to ${to} — off this page, a row there, run id recorded`,
  !pageRow(from, sku) && !!pageRow(to, sku)
  && (PLANS as { sku: string; category: string; action: string; to: string; run_id: unknown }[]).some((p) => p.sku === sku && p.category === from && p.action === "move" && p.to === to && typeof p.run_id === "number"),
  `${from}: ${pageRow(from, sku)?.bucket ?? "(gone)"}, ${to}: ${pageRow(to, sku)?.bucket ?? "(not a row)"}`);
type Allowed = { category: string; claimed_by: string; series: string; rule: string; rows: number; status: string; reason: string };
const ALLOW = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "layers-cross-claims.json"), "utf8")) as { entries: Allowed[] }).entries;
const STATUSES = new Set(["claimant-rule-too-broad", "decided-home", "pending-round"]);
// re-audit decisions (operator, 15 Sep 2026, F-6): a group kept where it is filed while a question is open says which question
// (pending-decision:Q-<n>), so decided-home again means a decision exists; the status goes stale the day the question leaves this set
export const OPEN_QUESTIONS: ReadonlySet<string> = new Set(["Q-14", "Q-17"]);
const statusKnown = (s: string) => STATUSES.has(s) || (/^pending-decision:Q-[0-9]+$/.test(s) && OPEN_QUESTIONS.has(s.slice("pending-decision:".length)));

for (const cat of REVIEWED) {
  const rows = readLayerRows(cat);
  // was "rows > 1000", a floor that failed by construction on the small categories reviewed from the servers round on (786 rows in
  // hyperconverged-infrastructure); the page's own parts count is the stronger statement (checked below with the summary)
  check(`${cat}: the built rows are not empty`, rows.length > 0, `${rows.length} rows`);

  const dis = pairDisagreements(rows).filter((d) => !PAIR_EXCEPTIONS[`${cat}|${d.sku}`]);
  check(`spare=base ${cat}: 0 twin groups (X / X= / X- / X--) disagree on series, kind, bucket or plan`, dis.length === 0, dis.slice(0, 8).map((d) => `${d.sku} <> ${d.member} [${d.fields.join(",")}]`).join("; "));
  for (const k of Object.keys(PAIR_EXCEPTIONS).filter((x) => x.startsWith(`${cat}|`)))
    check(`spare=base ${cat}: the recorded exception ${k.split("|")[1]} still disagrees (a stale exception is a hole)`, pairDisagreements(rows).some((d) => d.sku === k.split("|")[1]));

  const ntc = rows.filter((r) => r.bucket === "not_this_category"), unplaced = rows.filter((r) => r.bucket === "unplaced");
  check(`plan coverage ${cat}: every not-this-category row carries a plan (0 left in the bucket)`, ntc.length === 0, ntc.slice(0, 8).map((r) => r.sku).join(", "));
  check(`plan coverage ${cat}: 0 unplaced rows`, unplaced.length === 0, unplaced.slice(0, 8).map((r) => r.sku).join(", "));

  // a move-out series (its note: "every row carries a move plan") holds no layered row: the rule-shadowing scan skips such a
  // series, so a row landing there without a plan would otherwise pass unseen (after run #1068 the routers ones hold 0)
  {
    const { loadLineFile } = await import("../src/core/productLine.js");
    const moveOut = new Set(loadLineFile("cisco", cat)!.file.lines.flatMap((l) => l.series.filter((s) => /every row carries a move plan/.test(s.note ?? "")).map((s) => s.series)));
    const stray = moveOutStrays(rows, moveOut);
    check(`move-out series ${cat}: 0 layered rows in the ${moveOut.size} series whose every row must carry a move plan`, stray.length === 0, stray.slice(0, 6).map((r) => `${r.sku} ${r.series}`).join("; "));
  }

  const twins = twinGroups(rows);
  check(`twins ${cat}: no two rows fold (case, whitespace) to one SKU`, twins.length === 0, twins.slice(0, 5).map((g) => g.join(" / ")).join("; "));

  const claims = crossClaims(cat, rows, CATS);
  const allowed = ALLOW.filter((a) => a.category === cat);
  for (const g of claims) {
    const a = allowed.find((x) => x.claimed_by === g.claimed_by && x.series === g.series && x.rule === g.rule);
    check(`leakage ${cat}: ${g.rows} row(s) also claimed by ${g.claimed_by} / ${g.series} (${g.rule}) are recorded with that exact count`,
      !!a && a.rows === g.rows, a ? `recorded ${a.rows}, measured ${g.rows}` : `not recorded — e.g. ${g.examples.join(", ")}`);
  }
  for (const a of allowed) {
    check(`leakage ${cat}: recorded group ${a.claimed_by} / ${a.series} still exists (a stale entry is a hole)`, claims.some((g) => g.claimed_by === a.claimed_by && g.series === a.series && g.rule === a.rule));
    check(`leakage ${cat}: recorded group ${a.claimed_by} / ${a.series} has a known status (or a pending decision on an open question) and a reason`, statusKnown(a.status) && a.reason.length > 40, `status ${a.status}`);
  }

  const { dead, redundant, shadowed } = classifyRules(ruleUse(cat, rows, incomingRows(cat, CATS, PLANS)));
  check(`rule shadowing ${cat}: 0 dead SKU rules (a rule that matches no row nor any row planned in)`, dead.length === 0, dead.map((u) => `${u.series} :: ${u.rule}`).join("; "));
  check(`rule shadowing ${cat}: 0 redundant SKU rules (every match decided by another rule of the same series)`, redundant.length === 0, redundant.map((u) => `${u.series} :: ${u.rule}`).join("; "));
  check(`rule shadowing ${cat}: 0 SKU rules losing their matches to another series`, shadowed.length === 0, shadowed.map((u) => `${u.series} :: ${u.rule} ${JSON.stringify(u.lost_to)}`).join("; "));

  // THE LABEL CHECK (re-audit at 2f3d17a): no row sits in a series on a bare label; moved rows sit in shared parts; the evidence
  // recorded at build time is what labelEvidence gives today
  const lv = labelViolations(rows);
  check(`label check ${cat}: 0 rows in a series on a label without evidence, 0 moved rows outside shared parts`, lv.length === 0, lv.slice(0, 6).map((v) => `${v.sku}: ${v.why}`).join("; "));
  const { drift } = labelEvidenceDrift(cat, rows);
  check(`label check ${cat}: the recorded evidence of every kept label row is what labelEvidence gives today`, drift.length === 0, drift.slice(0, 5).map((d) => `${d.sku}: recorded "${d.recorded}", now "${d.now}"`).join("; "));
  const summary = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "layers", `cisco-${cat}.json`), "utf8"));
  check(`${cat}: the page's parts count is its row count`, summary.parts === rows.length, `page ${summary.parts}, rows ${rows.length}`);
  const sed = seriesEntryDisagreements(summary, rows);
  check(`series entries ${cat}: every series entry of the JSON agrees with its rows on parts, kinds, roles and family`, sed.length === 0, sed.slice(0, 5).map((d) => `${d.series} [${d.fields.join(",")}] ${d.detail}`).join("; "));
  // a series with 0 parts is a placeholder only while rows are planned into it, and it says so (closing items at aa1143f, item 2)
  const empty = summary.lines.flatMap((l: any) => l.series.filter((x: any) => x.parts === 0).map((x: any) => ({ line: l.line, ...x })));
  const deadEmpty = deadPlaceholders(summary);
  check(`placeholders ${cat}: every series with 0 parts carries "pending N from <category>" (${empty.length} placeholder(s))`, deadEmpty.length === 0, deadEmpty.join("; "));
  const dev = deviceInSharedParts(rows).filter((r) => !DEVICE_EXCEPTIONS[`${cat}|${r.sku}`]);
  check(`devices ${cat}: 0 whole-device rows (${[...DEVICE_KINDS].join(" / ")}) in any shared parts series`, dev.length === 0, dev.slice(0, 6).map((r) => `${r.sku} (${r.kind}) ${r.series}`).join("; "));
  for (const k of Object.keys(DEVICE_EXCEPTIONS).filter((x) => x.startsWith(`${cat}|`)))
    check(`devices ${cat}: the recorded exception ${k.split("|")[1]} is still a device in shared parts (a stale exception is a hole)`, deviceInSharedParts(rows).some((r) => r.sku === k.split("|")[1]));
  check(`devices ${cat}: 0 rows pending review, and the page lists exactly the rows in that bucket`, rows.filter((r) => r.bucket === "pending_review").length === (summary.pending_review?.length ?? -1) && (summary.pending_review?.length ?? -1) === 0, `rows ${rows.filter((r) => r.bucket === "pending_review").length}, page ${summary.pending_review?.length}`);
  const withEv = rows.filter((r) => r.label_evidence).length, moved = rows.filter((r) => r.bucket === "layered" && (r.placed_by ?? "").startsWith("label-unsupported")).length;
  check(`label check ${cat}: applied, and the page's counts are the rows' (label-placed ${withEv}, moved ${moved})`,
    summary.label_check?.applied === true && summary.label_check.label_placed === withEv && summary.label_check.moved.length === moved,
    JSON.stringify({ applied: summary.label_check?.applied, label_placed: summary.label_check?.label_placed, moved: summary.label_check?.moved?.length }));
  const lem = labelExpectMiss(cat, withEv);
  check(`label check ${cat}: the label-placed count meets the category's recorded expectation`, lem === null, lem ?? "");
  // Q-26: a kept row whose glued digit spelling the page cannot account for. Both directions, or the allowlist becomes a hole.
  const glued = gluedDigitKeeps(rows);
  const gluedNew = glued.filter((g) => !GLUED_DIGIT_EXCEPTIONS[`${cat}|${g.sku}`]);
  check(`label check ${cat}: 0 rows kept on an unattested glued digit spelling (${glued.length - gluedNew.length} recorded exception(s))`,
    gluedNew.length === 0, gluedNew.slice(0, 6).map((g) => `${g.sku}: ${g.why}`).join("; "));
  for (const k of Object.keys(GLUED_DIGIT_EXCEPTIONS).filter((x) => x.startsWith(`${cat}|`)))
    check(`label check ${cat}: the recorded exception ${k.split("|")[1]} is still kept on an unattested spelling (a stale exception is a hole)`,
      glued.some((g) => g.sku === k.split("|")[1]));
  // Q-27 / B2: the reverse label check, as a recorded count — a rise is a new catch-all placing rows nothing judges
  const reverse = sharedPartsNamedBySeries(rows, cat);
  check(`reverse label check ${cat}: ${REVERSE_EXPECT[cat] ?? "?"} shared-parts rows are named by exactly one series (the recorded review queue)`,
    reverse.length === REVERSE_EXPECT[cat],
    `now ${reverse.length}, recorded ${REVERSE_EXPECT[cat]}${reverse.length > (REVERSE_EXPECT[cat] ?? 0) ? ` — new: ${reverse.slice(0, 5).map((x) => `${x.sku} -> ${x.to} (${x.kind} ${x.detail})`).join("; ")}` : ""}`);
  // the cross-line scan: a row NO series of its own line names, that exactly one series of ANOTHER line names on strong evidence
  const cross = crossLineNamedBySeries(rows, cat);
  check(`cross-line check ${cat}: ${CROSSLINE_EXPECT[cat] ?? "?"} shared-parts rows are named only by a series in ANOTHER line (the mis-filed queue)`,
    cross.length === CROSSLINE_EXPECT[cat],
    `now ${cross.length}, recorded ${CROSSLINE_EXPECT[cat]}${cross.length > (CROSSLINE_EXPECT[cat] ?? 0) ? ` — new: ${cross.slice(0, 4).map((x) => `${x.sku} (${x.fromLine}) -> ${x.to} (${x.toLine})`).join("; ")}` : ""}`);

  // A CONTENT CHANGE A COUNT CANNOT SEE. The range rule took three 863-928 MHz antennas OUT of IR 800 and the same three
  // ARRIVED at their real series, so routers reads 44 both before and after and no count check can tell the difference —
  // the second such case tonight. The outcome is therefore asserted directly: each antenna is proposed for the series its
  // own name states, and not for the one a radio band put it in.
  for (const [sku, want] of RANGE_RULE_MOVES) {
    if (!rows.some((r) => r.sku === sku)) continue;
    rangeSeen.add(sku);
    const p = reverse.find((x) => x.sku === sku);
    check(`range rule ${cat}: ${sku} (863-928 MHz) is proposed for "${want}", not for the IR 800 its radio band named`,
      p?.to === want, p ? `proposed for "${p.to}" on ${p.kind} ${p.detail}` : "not proposed at all");
  }
  // the four rows the model-letter fence knowingly loses: still present on this page, and still NOT proposed
  for (const sku of FENCE_KNOWN_LOSSES.filter((s) => rows.some((r) => r.sku === s))) {
    fenceSeen.add(sku);
    const row = rows.find((r) => r.sku === sku)!;
    check(`fence cost ${cat}: ${sku} is still parked in shared parts, unproposed (the model-letter fence refuses its C240/C220 on the L of CBL)`,
      / shared parts$/.test(row.series ?? "") && !reverse.some((x) => x.sku === sku),
      `series "${row.series}", proposed ${reverse.some((x) => x.sku === sku)}`);
  }
  // every row placed through a label carries the evidence it was judged on (a label placement without evidence is the check not running)
  // — except a label the mapping sends DIRECTLY to its line's shared parts, which claims no series (pre-ruling C1, layers round 3)
  const direct = (r: LayerRow) => /^label /.test(r.placed_by ?? "") && r.series === `${r.product_line} shared parts`;
  const unjudged = rows.filter((r) => r.bucket === "layered" && /^label[ -]/.test(r.placed_by ?? "") && !r.label_evidence && !direct(r));
  check(`label check ${cat}: 0 label-placed rows without recorded evidence`, unjudged.length === 0, unjudged.slice(0, 5).map((r) => r.sku).join(", "));
  // …and the other direction: a row the check MOVED must still be refused by the series it was moved out of, or the built page
  // is stale and a rebuild would move it back. `checked` and `seriesGone` are separate numbers because could-not-check is not
  // checked-and-fine.
  const back = movedRowsStillRefused(cat, rows);
  check(`label check ${cat}: 0 of the ${back.checked} moved rows would be kept by today's rule (${back.seriesGone} name a series the mapping no longer holds)`,
    back.wouldReturn.length === 0, back.wouldReturn.slice(0, 5).map((x) => `${x.sku} -> ${x.was} (${x.now})`).join("; "));
  const notExplicit = sharedLabelNotExplicit(cat, rows);
  check(`label check ${cat}: every label placed directly in a line's shared parts (${rows.filter((r) => r.bucket === "layered" && direct(r)).length} rows) is listed on that series in the mapping (C1)`, notExplicit.length === 0, notExplicit.slice(0, 5).map((x) => `${x.sku}: ${x.why}`).join("; "));

  // arrivals: every not-run move plan out of this category lands placed in its target's mapping (layers round 3)
  {
    const arr = unplacedArrivals(cat, rows, PLANS);
    const unexcused = arr.filter((a) => !ARRIVAL_EXCEPTIONS[`${cat}|${a.sku}`]);
    check(`arrivals ${cat}: every planned move lands placed in its target mapping (${arr.length - unexcused.length} recorded exception(s))`, unexcused.length === 0, unexcused.slice(0, 6).map((a) => `${a.sku} -> ${a.to}: ${a.why}`).join("; "));
    for (const k of Object.keys(ARRIVAL_EXCEPTIONS).filter((x) => x.startsWith(`${cat}|`)))
      check(`arrivals ${cat}: the recorded exception ${k.split("|")[1]} still fails to place (a stale exception is a hole)`, arr.some((a) => a.sku === k.split("|")[1]));
  }
  check(`provenance ${cat}: the built page names its commit`, typeof summary.commit === "string" && /^[0-9a-f]{40}$/.test(summary.commit), `commit ${summary.commit}`);
  check(`provenance ${cat}: the page lists its uncommitted rule files (an array, possibly empty)`, Array.isArray(summary.uncommitted_rule_files));
}

// THE CROSS-CATEGORY TWIN CHECK (re-audit decisions, operator, 15 Sep 2026, Q-20): X, X=, X- and X-- live in one category. A twin group
// whose hardware members end in two or more categories once their plans run is refused — except the groups Q-14 and Q-17 leave open,
// named here by twin key (Q-14: generic UCS components across servers / HyperFlex / Compute Hyperconverged; Q-17: the UCS spares
// filed in security). A named group that is no longer split is stale; a question that closes takes its list with it.
const TWIN_SPLITS_PENDING: Record<string, readonly string[]> = {
  "Q-14": ["CAB-48DC-40A-AS", "CAB-48DC-40A-INT", "CAB-9K10A-KOR1", "CAB-BS1363-C19-UK", "CAB-S132-C19-ISRL", "CAB-SABS-C19-IND", "CAB-US515P-C19-US", "CAB-US520-C19-US", "CAB-US620P-C19-US",
    "N20-BBLKD", "PACK-QSFP-SFP", "RACK-BLANK-001", "RACK-CBLMGT-001", "RACK-CBLMGT-011", "RACK-FASTEN-001", "RACK-FASTEN-002", "RACK-JOIN-001", "UCS-220CBLMR8", "UCS-220CBLSR8",
    "UCS-HD8T7KL4KN", "UCS-M10CBL-C240M5", "UCS-ML-128G4RW", "UCS-MR-X32G2RW", "UCS-MR-X64G2RW", "UCS-MSTOR-M2", "UCS-P100CBL-240M5", "UCSC-HS-C220M4", "UCSC-LP-C25-1485",
    "UCSC-LP-C40-1485", "UCSC-MLOM-BLK", "UCSC-PCIF-01F", "UCSC-PSU-BLKP240", "UCSC-R2R3-C220M6", "UCSC-RIS2A-240M6"],
  "Q-17": ["N20-BKVM", "UCS-HD12TB10K12N", "UCS-NVMEG4-M960-D", "UCS-SD16TBKANK9-D", "UCS-SD960GM2NK9-D", "UCSC-PSU1-1050W", "UCSC-PSU1-1200W-D", "UCSC-RAIL-D", "UCSC-RAIL-M6", "UCSC-RAILB-M4", "UCSC-RAILF-M4"],
};
{
  const byCat = new Map(CATS.map((c) => [c, readLayerRows(c)] as const));
  const splits = crossCategoryTwins(byCat);
  const pendingOf = new Map(Object.entries(TWIN_SPLITS_PENDING).flatMap(([q, keys]) => keys.map((k) => [k, q] as const)));
  const unexcused = splits.filter((s) => !pendingOf.has(s.key));
  check(`cross-category twins: 0 twin groups split across categories with no plan joining them (${splits.length - unexcused.length} named pending Q-14 / Q-17)`, unexcused.length === 0,
    unexcused.slice(0, 6).map((s) => `${s.key}: ${s.members.map((m) => `${m.category}:${m.sku}${m.plan ? ` [${m.plan}]` : ""}`).join(" | ")}`).join("; "));
  for (const [k, q] of pendingOf) {
    check(`cross-category twins: the group ${k} named pending ${q} is still split (a stale name is a hole)`, splits.some((s) => s.key === k));
    check(`cross-category twins: ${k} is named pending ${q}, a question still open`, OPEN_QUESTIONS.has(q));
  }
  // sabotage: a planted split is refused, a move plan or a class plan joins it, a base and its component PID count as twins
  const row = (sku: string, plan = ""): LayerRow => ({ sku, name: "x", series_label: "", kind: "cable", bucket: plan ? "pending_plan" : "layered", series: "A", plan });
  const planted = (a: LayerRow[], b: LayerRow[]) => crossCategoryTwins(new Map([["zz-a", a], ["zz-b", b]]));
  check("SABOTAGE cross-category twins: a base in one category and its spare in another is a split", planted([row("ZZ-CORD-1")], [row("ZZ-CORD-1=")]).length === 1);
  check("SABOTAGE cross-category twins: the spare's move plan to the base's category joins them", planted([row("ZZ-CORD-1")], [row("ZZ-CORD-1=", "move zz-a")]).length === 0);
  check("SABOTAGE cross-category twins: a move plan to a THIRD category does not", planted([row("ZZ-CORD-1")], [row("ZZ-CORD-1=", "move zz-c")]).length === 1);
  check("SABOTAGE cross-category twins: a class plan takes the member off the hardware pages", planted([row("ZZ-CORD-1")], [row("ZZ-CORD-1=", "class non_product")]).length === 0);
  check("SABOTAGE cross-category twins: X- and X-- are twins of X (N-1)", planted([row("ZZ-CORD-2")], [row("ZZ-CORD-2-"), row("ZZ-CORD-2--")]).length === 1 && planted([row("ZZ-CORD-2-")], [row("ZZ-CORD-2--")]).length === 1);
}

// …and the stale half of those two SKU lists. Both loops above skip a SKU they cannot find on a page, so without this a listed
// row that left the catalogue would take its check with it and the list would quietly describe the past. This is the shape the
// suite already refuses on every other recorded list; it was missing from the two added on 16 Sep, and adding it is the scan
// that night's fourth instance of the same defect earned.
for (const sku of FENCE_KNOWN_LOSSES)
  check(`fence cost: the recorded known-loss ${sku} is still a row of a reviewed page (a stale entry is a hole)`, fenceSeen.has(sku));
for (const [sku] of RANGE_RULE_MOVES)
  check(`range rule: the recorded move ${sku} is still a row of a reviewed page (a stale entry is a hole)`, rangeSeen.has(sku));

// THE REGULATORY-DOMAIN / PLUG-REGION PLACEHOLDER (re-audit decisions, operator, 15 Sep 2026, Q-10): lower-case x / xx in the region position,
// case-sensitive, plus the 14 upper-case -X rows Cisco's ordering guide and the Embedded Wireless Controller FAQ write as the same stand-in,
// named by SKU. Never a case-insensitive match: -X is a model name elsewhere (ASR1001-X). Q-10 vs Q-23 (operator, same day): Q-23 governs —
// a stand-in that carries its family's facts or document is the family's model row and keeps it, flagged a family carrier; the ones that
// carry nothing are classed. So no layered row is a stand-in unless it is a listed family carrier.
const REGION_X_BY_SKU: ReadonlySet<string> = new Set(["C9115AXE-EWC-X", "C9115AXI-EWC-X", "C9117AXI-EWC-X", "C9120AXE-EWC-X", "C9120AXI-EWC-X", "C9120AXP-EWC-X", "C9124AXD-EWC-X", "C9124AXE-EWC-X", "C9124AXI-EWC-X", "C9130AXE-EWC-X", "C9130AXI-EWC-X", "CW9164I-X", "CW9166D1-X", "CW9166I-X"]);
export const regionPlaceholder = (sku: string): boolean => /-x{1,2}(-|=?$)/.test(sku) || REGION_X_BY_SKU.has(sku.replace(/=+$/, ""));
type Carrier = { sku: string; category: string; decision: string; facts: number; docs: number };
const CARRIERS = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "family-carriers.json"), "utf8")) as { carriers: Carrier[] }).carriers;
const CARRIER_SKUS: ReadonlySet<string> = new Set(CARRIERS.map((c) => c.sku));
{
  for (const cat of [...REVIEWED, "conferencing", "data-center-networking"]) {
    const left = readLayerRows(cat).filter((r) => r.bucket === "layered" && regionPlaceholder(r.sku) && !CARRIER_SKUS.has(r.sku));
    check(`region placeholders ${cat}: 0 layered regulatory-domain / plug-region stand-ins that are not listed family carriers (Q-10, Q-23 governs)`, left.length === 0, left.slice(0, 6).map((r) => r.sku).join(", "));
  }
  // counted whether or not the plan has RUN: the decision was 175 plans, and CP-PWR-CORD-xx= ran in batch 3a (run #1112, 16 Sep 2026), so a
  // count of pending plans alone would shrink with every batch and stop measuring the decision
  const q10 = (PLANS as { sku: string; category: string; action: string; to: string; run_id: unknown; reason?: string }[]).filter((p) => /^regulatory-domain( \/ plug-region)? placeholder/.test(p.reason ?? ""));
  check(`region placeholders: the Q-10 class plans number 175 — the stand-ins that carry nothing (switches 174, collaboration-endpoints 1)`, q10.length === 175 && q10.every((p) => p.action === "class" && p.to === "non_product" && !CARRIER_SKUS.has(p.sku)), `${q10.length}`);
  const q10carriers = CARRIERS.filter((c) => c.decision === "Q-10 vs Q-23");
  check(`region placeholders: 79 stand-ins carry a fact or a document and are listed carriers (wireless 60, switches 17, interfaces-modules 2)`, q10carriers.length === 79 && q10carriers.every((c) => regionPlaceholder(c.sku) && c.facts + c.docs > 0), `${q10carriers.length}`);
  check("SABOTAGE region placeholder: CBS110-8PP-D-xx, AIR-AP1562I-x-K9 and CP-PWR-CORD-xx= are stand-ins", ["CBS110-8PP-D-xx", "AIR-AP1562I-x-K9", "CP-PWR-CORD-xx="].every(regionPlaceholder));
  check("SABOTAGE region placeholder: C9120AXI-EWC-X is a stand-in by name, and its spare spelling too", regionPlaceholder("C9120AXI-EWC-X") && regionPlaceholder("C9120AXI-EWC-X="));
  check("SABOTAGE region placeholder: the model names ASR1001-X, N9K-C92160YC-X and SFP-10G-LR-X are NOT (never case-insensitive)", !["ASR1001-X", "N9K-C92160YC-X", "SFP-10G-LR-X", "C6880-X="].some(regionPlaceholder));
  check("SABOTAGE region placeholder: a channel placeholder DWDM-SFP10G-xx.xx is not this shape (decision 2 classes it)", !regionPlaceholder("DWDM-SFP10G-xx.xx"));
}

// FAMILY CARRIERS (re-audit decisions, operator, 15 Sep 2026): the 102 rows that carry their family's facts or document (Q-23 23, Q-10 vs Q-23
// 79) keep their rows — no class plan, a move only to their family's category — and the page flags each one, and nothing else, `family_carrier`.
// 16 Sep 2026 (implementer, under the operator's 12-hour delegation): + the two glued-x CG113 stand-ins, the Q-23 rule applied to a shape the
// Q-10 pattern cannot see (CG113-4GW6x had been planned a licence from its stored name, a run-together licence cell)
{
  const rowsBySku = new Map<string, LayerRow & { page: string }>();
  for (const c of CATS) for (const r of readLayerRows(c)) rowsBySku.set(r.sku, { ...r, page: c });
  check(`family carriers: the list holds 114 (Q-23 23, Q-10 vs Q-23 79, Q-23 glued-x 2, arrived by move 10), no SKU twice`, CARRIERS.length === 114 && CARRIER_SKUS.size === 114 && CARRIERS.filter((c) => c.decision === "Q-23").length === 23
    && CARRIERS.filter((c) => c.decision === "Q-23 (glued-x stand-in)").map((c) => c.sku).sort().join() === "CG113-4GW6x,CG113-W6x"
    // the 10 IW9165 / IW9167 regulatory stand-ins arrived in wireless with the routers -> wireless move of 16 Sep; each carries the
    // family's fact and data sheet, so Q-23 governs and they keep their rows. The Q-10 census could not have seen them: a planned row is
    // not layered, so the check that finds them only fires once they land
    && CARRIERS.filter((c) => c.decision === "Q-10 vs Q-23 (arrived by move)").length === 10);
  check(`family carriers: CG113-4GW6x is a layered, flagged routers row with no plan (not the licence its stored name reads as)`,
    rowsBySku.get("CG113-4GW6x")?.page === "routers" && rowsBySku.get("CG113-4GW6x")?.bucket === "layered" && rowsBySku.get("CG113-4GW6x")?.family_carrier === "true" && rowsBySku.get("CG113-4GW6x")?.plan === "",
    JSON.stringify(rowsBySku.get("CG113-4GW6x")));
  const bad = CARRIERS.filter((c) => { const r = rowsBySku.get(c.sku); return !r || r.family_carrier !== "true" || r.plan.startsWith("class ") || (r.bucket !== "layered" && !r.plan.startsWith("move ")) || c.facts + c.docs === 0; });
  check(`family carriers: every listed carrier is a row, flagged, carrying a fact or a document, layered or planned to move (never classed)`, bad.length === 0,
    bad.slice(0, 6).map((c) => { const r = rowsBySku.get(c.sku); return `${c.sku}: ${r ? `${r.bucket} "${r.plan}" flag=${r.family_carrier}` : "not a row"}`; }).join("; "));
  const flagged = [...rowsBySku.values()].filter((r) => r.family_carrier === "true" && !CARRIER_SKUS.has(r.sku));
  check(`family carriers: no row outside the list carries the flag`, flagged.length === 0, flagged.slice(0, 6).map((r) => r.sku).join(", "));
  // counted whether or not they have RUN (the 3 SB-PWR in run #1145, the 10 IW in run #1164): a carrier may carry no plan but a MOVE to its family's category — never a
  // class plan — and a count of pending plans alone would read "0 plans on carriers" as a pass once they ran
  const moves = (PLANS as { sku: string; action: string; to: string; run_id: unknown }[]).filter((p) => CARRIER_SKUS.has(p.sku));
  const sbPwr = moves.filter((p) => /^SB-PWR-/.test(p.sku) && p.to === "interfaces-modules");
  const iw = moves.filter((p) => /^IW916[57]/.test(p.sku) && p.to === "wireless");
  check(`family carriers: the only plans on carriers are moves to their family's category — 3 SB-PWR to interfaces-modules, 10 IW9165 / IW9167 to wireless`,
    moves.length === 13 && sbPwr.length === 3 && iw.length === 10 && moves.every((p) => p.action === "move"), JSON.stringify(moves.map((p) => `${p.sku} ${p.action} ${p.to}`)));
}

// MERGE CANDIDATES (layers round 3, operator: "as merge PLANS with the redirect map, not runs"): a category the spec merges away holds no
// layered row — every row carries a plan — and every planned move lands placed in its target's mapping, so the merge, when it runs,
// leaves nothing unplaced on the target page. The redirect map and the class question are in the merge-plans decision record.
export const MERGE_CANDIDATES: Record<string, string> = { conferencing: "collaboration-endpoints", "data-center-networking": "switches" };
// a planned move of a merge candidate that goes somewhere other than the merge target, each with its reason and destination
const MERGE_NON_HARDWARE: Record<string, number> = { conferencing: 3680, "data-center-networking": 11 };
const MERGE_MOVE_EXCEPTIONS: Record<string, string> = {
  "data-center-networking|8K-2RU-KIT-SB": "routers: a Cisco 8000 2RU installation kit reused by the HF6100-64ED; its siblings 8K-2RU-KIT-L / -S / -2P-KIT in switches carry move plans to routers (A.3 rule 1)",
};
for (const [cat, target] of Object.entries(MERGE_CANDIDATES)) {
  const rows = readLayerRows(cat);
  const notPlanned = rows.filter((r) => r.bucket !== "pending_plan");
  check(`merge ${cat} -> ${target}: every one of the ${rows.length} rows carries a plan (none layered, not-this-category or unplaced)`, rows.length > 0 && notPlanned.length === 0, notPlanned.slice(0, 6).map((r) => `${r.sku} ${r.bucket}`).join("; "));
  const arr = unplacedArrivals(cat, rows, PLANS);
  check(`merge ${cat} -> ${target}: every planned move lands placed in its target mapping`, arr.length === 0, arr.slice(0, 6).map((a) => `${a.sku} -> ${a.to}: ${a.why}`).join("; "));
  const moves = (PLANS as { sku: string; category: string; action: string; to: string; run_id: unknown }[]).filter((p) => p.category === cat && p.action === "move" && p.run_id === null);
  const elsewhere = moves.filter((p) => p.to !== target && !(MERGE_MOVE_EXCEPTIONS[`${cat}|${p.sku}`] ?? "").startsWith(`${p.to}:`));
  check(`merge ${cat} -> ${target}: every move goes to the merge target or is a recorded exception naming its destination`, elsewhere.length === 0, elsewhere.slice(0, 6).map((p) => `${p.sku} -> ${p.to}`).join("; "));
  for (const k of Object.keys(MERGE_MOVE_EXCEPTIONS).filter((x) => x.startsWith(`${cat}|`)))
    check(`merge ${cat}: the recorded exception ${k.split("|")[1]} is still a move away from ${target} (a stale exception is a hole)`, moves.some((p) => p.sku === k.split("|")[1] && p.to !== target));
  // re-audit decisions (operator, 15 Sep 2026, Q-24): the merge moves EVERY class. The non-hardware rows are not on the pages, so the
  // count the store held when the plans were written is recorded, and a plan claiming a hardware row as non-hardware is refused
  const nonHw = (PLANS as { sku: string; category: string; action: string; to: string; run_id: unknown; product_class?: string }[]).filter((p) => p.category === cat && p.run_id === null && p.product_class && p.product_class !== "hardware");
  check(`merge ${cat} -> ${target}: the ${MERGE_NON_HARDWARE[cat]} non-hardware rows the store held on 15 Sep 2026 carry move plans to ${target} (Q-24: every class)`, nonHw.length === MERGE_NON_HARDWARE[cat] && nonHw.every((p) => p.action === "move" && p.to === target), `${nonHw.length} plans`);
  const lying = nonHardwarePlansOnPage(cat, rows, PLANS);
  check(`merge ${cat}: no non-hardware plan names a row of the hardware page`, lying.length === 0, lying.slice(0, 6).join(", "));
}
check("SABOTAGE merge: a plan that calls a hardware row non-hardware is refused", nonHardwarePlansOnPage("zz", [{ sku: "ZZ-HW-1", bucket: "pending_plan" } as LayerRow], [{ sku: "ZZ-HW-1", category: "zz", product_class: "license", run_id: null }, { sku: "ZZ-LIC-1", category: "zz", product_class: "license", run_id: null }]).join() === "ZZ-HW-1");

// THE FAMILY LAYER (operator, 14 Sep 2026): layer 3 where Cisco names a family, the explicit shared-across marker for line shared
// parts, "—" (empty) otherwise — and the file says the category's families were assigned.
{
  const { loadLineFile, validateLineFile, SHARED_PARTS } = await import("../src/core/productLine.js");
  for (const cat of REVIEWED) {
    const loaded = loadLineFile("cisco", cat)!;
    check(`family layer ${cat}: the mapping file declares family_layer "assigned"`, loaded.file.family_layer === "assigned");
    const famOf = new Map(loaded.file.lines.flatMap((l) => l.series.map((s) => [s.series, s.family ?? ""] as const)));
    const wrong = readLayerRows(cat).filter((r) => r.bucket === "layered").filter((r) =>
      r.product_family !== (r.series === SHARED_PARTS(r.product_line) ? "(shared across the line)" : famOf.get(r.series) ?? ""));
    check(`family layer ${cat}: every layered row carries its series' family (or the shared-across marker)`, wrong.length === 0, wrong.slice(0, 5).map((r) => `${r.sku} ${r.series} [${r.product_family}]`).join("; "));
    const expect = FAMILY_EXPECT[cat];
    check(`family layer ${cat}: an expectation is recorded ("in-use" or "none")`, expect === "in-use" || expect === "none", `${expect}`);
    const used = familiesInUse(readLayerRows(cat));
    if (expect === "in-use") check(`family layer ${cat}: at least one family is in use (the column is live)`, used.length > 0);
    if (expect === "none") {
      check(`family layer ${cat}: Cisco names no family here, so no layered row carries one`, used.length === 0, used.slice(0, 5).map((r) => `${r.sku} [${r.product_family}]`).join("; "));
      const silent = loaded.file.lines.filter((l) => l.series.filter((s) => !/shared parts$/.test(s.series)).length >= 3 && !(l.no_family_reason ?? "").trim());
      check(`family layer ${cat}: every line of 3+ series says why it has no family`, silent.length === 0, silent.map((l) => l.line).join("; "));
      check(`family layer ${cat}: the mapping declares no family at all`, loaded.file.lines.every((l) => l.series.every((s) => !s.family)));
    }
  }
  // sabotage: the per-category expectations refuse for their stated reasons
  check("SABOTAGE family expectation: a family on a layered row of a 'none' category is found", familiesInUse([{ sku: "ZZ", bucket: "layered", product_family: "Cisco Optics" } as LayerRow]).length === 1);
  check("SABOTAGE family expectation: the shared-across marker is not a family", familiesInUse([{ sku: "ZZ", bucket: "layered", product_family: "(shared across the line)" } as LayerRow]).length === 0);
  const base = (): Parameters<typeof validateLineFile>[0] => ({ vendor: "cisco", category: "zz", family_layer: "assigned", lines: [{ line: "Nexus", series: [
    { series: "Nexus 7004 / 7009", sku: ["^N7K"], family: "Nexus 7000" }, { series: "Nexus 7700", sku: ["^N77"], family: "Nexus 7000" }, { series: "Nexus 6000", sku: ["^N6K"] }] }] });
  const errsOf = (mut: (f: ReturnType<typeof base>) => void) => { const f = base(); mut(f); return validateLineFile(f).join(" | "); };
  check("SABOTAGE family: the valid shape without a reason on the 3-series line is refused for the missing reason", /no no_family_reason/.test(errsOf(() => {})));
  check("SABOTAGE family: with the reason it validates", errsOf((f) => { f.lines[0].no_family_reason = "Cisco names the Nexus 6000 alone"; }) === "");
  check("SABOTAGE family: a family that restates a series name is refused", /restates a series name/.test(errsOf((f) => { f.lines[0].no_family_reason = "x"; f.lines[0].series[0].series = "Nexus 7000"; })));
  check("SABOTAGE family: a family that restates its product line is refused", /restates its product line/.test(errsOf((f) => { f.lines[0].no_family_reason = "x"; f.lines[0].series[0].family = "Nexus"; f.lines[0].series[1].family = "Nexus"; })));
  check("SABOTAGE family: a family of one series is refused (a family is a grouping)", /groups only one series/.test(errsOf((f) => { f.lines[0].no_family_reason = "x"; f.lines[0].series[1].family = undefined; })));
}

// A.4 on the built rows: the bundle rule's witnesses are `bundle` on the page, not only in the function.
{
  const sw = new Map(readLayerRows("switches").map((r) => [r.sku, r]));
  const rt = new Map(readLayerRows("routers").map((r) => [r.sku, r]));
  for (const sku of ["N5548UPM-4FEX", "N3K-C3172TQ-10PK", "C4500E-7R-S8E-UPOE", "ACI-C9336-B3-EAL", "N2232PP-4FEX", "N5672UP-4FEX-10G"]) check(`A.4 switches page: ${sku} is bundle`, sw.get(sku)?.kind === "bundle", `got ${sw.get(sku)?.kind}`);
  for (const sku of ["CRS-16-FC140/M-8P", "ASR1000-RP3-32G-2P", "ISR4330U-MEM-MSATA"]) check(`A.4 routers page: ${sku} is bundle`, rt.get(sku)?.kind === "bundle", `got ${rt.get(sku)?.kind}`);
  for (const sku of ["3900-FANASSY", "3900-FANASSY=", "3900-FANASSY-NEBS", "3900-FANASSY-NEBS="]) check(`residual: ${sku} is under ISR 3900`, rt.get(sku)?.series === "ISR 3900", `got ${rt.get(sku)?.series}`);
}

// transceiver on the built rows (layers round 3): the cable contract, and the operator's witnesses are where the decisions put them
{
  const tx = readLayerRows("transceiver");
  const { notCableInDac, breakoutOutsideSpeed } = cableContract(tx);
  check("transceiver: the DAC and AOC series holds only kind cable", notCableInDac.length === 0, notCableInDac.slice(0, 6).map((r) => `${r.sku} (${r.kind})`).join("; "));
  check("transceiver: every breakout cable sits in an Ethernet speed series", breakoutOutsideSpeed.length === 0, breakoutOutsideSpeed.slice(0, 6).map((r) => `${r.sku} ${r.series}`).join("; "));
  const breakouts = tx.filter((r) => r.bucket === "layered" && r.kind === "breakout-cable").length;
  check(`transceiver: the contract has rows to judge (${breakouts} breakout cables on the page)`, breakouts >= 50, `${breakouts}`);
  const t = new Map(tx.map((r) => [r.sku, r]));
  for (const sku of ["SFP-H25GCU1M", "SFP-25GAOC10M", "SFP-H10GBACU10M"]) check(`transceiver page: glued ${sku} is a cable in the DAC series`, t.get(sku)?.kind === "cable" && t.get(sku)?.series === TX_DAC_SERIES, `got ${t.get(sku)?.kind} / ${t.get(sku)?.series}`);
  for (const [sku, series] of [["QSFP-4SFP25G-CU1M", "100G QSFP28"], ["QSFP-4X10G-AOC1M", "40G QSFP+"], ["QDD-4ZQ100-CU1M", "200G / 400G QSFP-DD, QSFP112 and QSFP56"]])
    check(`transceiver page: breakout ${sku} is in ${series}`, t.get(sku)?.series === series && t.get(sku)?.kind === "breakout-cable", `got ${t.get(sku)?.kind} / ${t.get(sku)?.series}`);
  for (const sku of ["DWDM-GBIC-30.33", "CWDM-GBIC-1530", "15216-GBIC-1510", "WS-G5484"]) check(`transceiver page: ${sku} is in GBIC (legacy)`, t.get(sku)?.series === "GBIC (legacy)", `got ${t.get(sku)?.series}`);
  const gbic = tx.filter((r) => r.bucket === "layered" && /^(DWDM|CWDM|15216)-GBIC-/.test(r.sku)).length;
  check(`transceiver page: the 42 WDM GBICs are layered (operator: a GBIC rule that matches its 42 rows)`, gbic === 42, `${gbic}`);
}

// interfaces-modules on the built rows (layers round 3): the operator's decisions and the pre-rulings are where they put the rows
{
  const im = new Map(readLayerRows("interfaces-modules").map((r) => [r.sku, r]));
  const CARDS = "Interface cards (NIM / SM-X / HWIC / SPA / PVDM / VIC / cellular)";
  const at = (sku: string, series: string, kind?: string) => {
    const r = im.get(sku);
    check(`interfaces-modules page: ${sku} is layered in ${series}${kind ? `, kind ${kind}` : ""}`, r?.bucket === "layered" && r.series === series && (!kind || r.kind === kind), `got ${r?.bucket} / ${r?.series} / ${r?.kind}`);
  };
  at("C-NIM-1X", "NIM (Network Interface Modules)", "interface");
  at("C-SM-NIM-ADPT", "SM-X and SM Service Modules", "mechanical");
  at("C-SM-NIM-ADPT=", "SM-X and SM Service Modules", "mechanical");
  // re-audit decisions (15 Sep 2026, Q-13): the UCS-E modules and the SRE engines were witnesses of pre-ruling C3 here; they now carry
  // move plans to servers-unified-computing (checked below with the planned rows)
  at("ISM-VPN-29", "ISM / EM Internal Service Modules", "module");
  at("WP-WIFI6-A", "WP pluggable modules (IoT routers)", "radio");
  at("P-5GS6-GL", "Pluggable Interface Modules (LTE / 5G / serial)", "cellular");
  at("P-1T", "Pluggable Interface Modules (LTE / 5G / serial)", "interface");
  at("ILPM-4=", "EHWIC / HWIC / VWIC / WIC", "power");
  at("GE-DCARD-ESW", "NM / NME Network Modules", "interface");
  at("16OC3/POS-MM", "Cisco 12000 / XR 12000 SIP and line cards", "interface");
  at("8FE-TX-RJ45-B", "Cisco 12000 / XR 12000 SIP and line cards");
  at("WS-X5153", "Router and switch line cards (legacy) shared parts");
  at("SB-PWR-48V-EU", "Small Business Network Accessories (SB-PWR / RPS1000)", "power");
  at("RPS1000", "Small Business Network Accessories (SB-PWR / RPS1000)");
  at("PP1-72X100G-SMF", "Fiber patch panels and MPO / breakout cables (CB- / PP)");
  check(`interfaces-modules page: the card line is renamed (C9) and holds the NIMs`, im.get("NIM-2T")?.product_line === CARDS, `${im.get("NIM-2T")?.product_line}`);
  const planned = (sku: string, plan: string) => check(`interfaces-modules page: ${sku} carries the plan "${plan}"`, im.get(sku)?.bucket === "pending_plan" && im.get(sku)?.plan === plan, `got ${im.get(sku)?.bucket} "${im.get(sku)?.plan}"`);
  // these move plans RAN on 16 Sep: each row is now on its target page (ranMove asserts both ends and the run id)
  ranMove("interfaces-modules", "ENC-10G-ONT-10=", "switches");
  ranMove("interfaces-modules", "DS-X9148-HV", "storage-networking");
  ranMove("interfaces-modules", "AIR-RM3000M", "wireless");
  ranMove("interfaces-modules", "NAM2420-K9", "security");
  ranMove("interfaces-modules", "NCS-FAB-OPT=", "transceiver");
  ranMove("interfaces-modules", "PWR-3845-AC-IP=", "routers");
  planned("FQMAP46CG", "class non_product");
  planned("HN4000e", "class non_product");
  ranMove("interfaces-modules", "UCS-E160S-M3/K9", "servers-unified-computing");
  ranMove("interfaces-modules", "ISM-SRE-300-K9", "servers-unified-computing");
  ranMove("interfaces-modules", "SM-SRE-900-K9", "servers-unified-computing");
  planned("15454-AD-1B-xx=", "class non_product");
  at("HWIC-AP-AG-x", "EHWIC / HWIC / VWIC / WIC", "radio");   // a family carrier (1 fact) since Q-10 vs Q-23, not a class plan
  check(`interfaces-modules page: HWIC-AP-AG-x is flagged a family carrier`, im.get("HWIC-AP-AG-x")?.family_carrier === "true", `${im.get("HWIC-AP-AG-x")?.family_carrier}`);
  ranMove("interfaces-modules", "CGR-N-CONN-WPAN", "routers");
  const ntc = readLayerRows("interfaces-modules").filter((r) => r.bucket === "not_this_category").length;
  check(`interfaces-modules page: the 190 not-this-category rows of the round's start are all planned or placed (0 left)`, ntc === 0, `${ntc}`);
  const sw = new Map(readLayerRows("switches").map((r) => [r.sku, r]));
  ranMove("switches", "NM-BLANK-T1=", "interfaces-modules");   // C7
}

// wireless on the built rows (layers round 3)
{
  const wl = new Map(readLayerRows("wireless").map((r) => [r.sku, r]));
  const at = (sku: string, series: string, kind?: string) => {
    const r = wl.get(sku);
    check(`wireless page: ${sku} is layered in ${series}${kind ? `, kind ${kind}` : ""}`, r?.bucket === "layered" && r.series === series && (!kind || r.kind === kind), `got ${r?.bucket} / ${r?.series} / ${r?.kind}`);
  };
  at("AIR-CT85DC-K9", "8500 (8510 / 8540 / 8580)", "wlc");  // was a controller in AireOS shared parts
  at("AIR-AP1702I-WLC", "WLC + access point bundles");
  at("AIR-1520-FIB-REEL", "Aironet 1520 / 1530", "mechanical");
  at("AIR-1520-FIB-REEL=", "Aironet 1520 / 1530", "mechanical");
  at("AIR-FAN-C220M4=", "5500 (5508 / 5520 / 5540)");  // kept by the name token 5520 once "Wireless" is not a watt
  at("RACK-QCN-SN5=", "CiscoWorks Wireless LAN Solution Engine (WLSE 1130 / Express 1030)");
  const planned = (sku: string, plan: string) => check(`wireless page: ${sku} carries the plan "${plan}"`, wl.get(sku)?.bucket === "pending_plan" && wl.get(sku)?.plan === plan, `got ${wl.get(sku)?.bucket} "${wl.get(sku)?.plan}"`);
  // re-audit decisions (15 Sep 2026, Q-10 vs Q-23): C9120AXI-x carries its family's facts — a carrier row now, not a class plan
  at("C9120AXI-x", "Catalyst 9120AX", "ap");
  check(`wireless page: C9120AXI-x is flagged a family carrier`, wl.get("C9120AXI-x")?.family_carrier === "true", `${wl.get("C9120AXI-x")?.family_carrier}`);
  at("C9105AXI-EWC-x", "Catalyst 9105AX", "ap");   // a carrier too (2 facts, 2 documents)
  // their class-non_product plans RAN in batch 3a (run #1118, 16 Sep 2026): no longer hardware rows, and the plans carry the run id
  for (const sku of ["AIR-AP1572EAC-UXK9", "C9105AXI"])
    check(`wireless page: ${sku} left the hardware page by its class-non_product plan (run id recorded)`, !wl.get(sku)
      && (PLANS as { sku: string; category: string; action: string; to: string; run_id: unknown }[]).some((p) => p.sku === sku && p.category === "wireless" && p.action === "class" && p.to === "non_product" && typeof p.run_id === "number"),
      `${wl.get(sku)?.bucket ?? "(not a row)"}`);
  ranMove("wireless", "SB-PWR-48V", "interfaces-modules");
  ranMove("wireless", "CS-ROOM70P-WMK=", "collaboration-endpoints");
  const ntc = [...wl.values()].filter((r) => r.bucket === "not_this_category").length;
  check(`wireless page: 0 not-this-category rows left (the 44 of the round's start are planned)`, ntc === 0, `${ntc}`);
  const regionLeft = [...wl.values()].filter((r) => r.bucket === "layered" && /(^|-)x(-|$)|-xx$/.test(r.sku) && r.family_carrier !== "true");
  check(`wireless page: 0 layered regulatory-domain / plug-region placeholders (lowercase -x / -xx SKUs) that are not family carriers`, regionLeft.length === 0, regionLeft.slice(0, 6).map((r) => r.sku).join(", "));
  const rt = new Map(readLayerRows("routers").map((r) => [r.sku, r]));
  for (const s of ["AIR-ANT2524DB-R", "AIR-ACC1530-PMK1"]) ranMove("routers", s, "wireless");   // the Aironet antennas and the 1530 mount kit
}

// THE RE-AUDIT DECISIONS on the built rows (operator, 15 Sep 2026): each decision's witnesses are where it put them
{
  const pageOf = new Map<string, Map<string, LayerRow>>();
  const get = (cat: string, sku: string) => { if (!pageOf.has(cat)) pageOf.set(cat, new Map(readLayerRows(cat).map((r) => [r.sku, r]))); return pageOf.get(cat)!.get(sku); };
  const at = (cat: string, sku: string, series: string, kind?: string, by?: RegExp) => {
    const r = get(cat, sku);
    check(`re-audit ${cat}: ${sku} is layered in ${series}${kind ? `, kind ${kind}` : ""}${by ? `, placed by ${by.source}` : ""}`, r?.bucket === "layered" && r.series === series && (!kind || r.kind === kind) && (!by || by.test(r.placed_by ?? "")), `got ${r?.bucket} / ${r?.series} / ${r?.kind} / ${r?.placed_by}`);
  };
  const planned = (cat: string, sku: string, plan: string) => { const r = get(cat, sku); check(`re-audit ${cat}: ${sku} carries the plan "${plan}"`, r?.bucket === "pending_plan" && r.plan === plan, `got ${r?.bucket} "${r?.plan}"`); };
  // a witness whose class plan HAS RUN: the row left the hardware page and its plan carries the run id (batch 2 / 3a, 16 Sep 2026)
  const ranClass = (cat: string, sku: string, to: string) => check(`re-audit ${cat}: ${sku} left the hardware page by its class-${to} plan (run id recorded)`, !get(cat, sku)
    && (PLANS as { sku: string; category: string; action: string; to: string; run_id: unknown }[]).some((p) => p.sku === sku && p.category === cat && p.action === "class" && p.to === to && typeof p.run_id === "number"),
    `${get(cat, sku)?.bucket ?? "(not a row)"}`);
  // F-1: platform-bound modules, cards, fans and supplies in their series (A.3 rule 1)
  at("security", "ASA-CX40-INC-K8", "ASA 5585-X", undefined, /^sku /);
  at("security", "ASA-IC-6GE-SFP-B=", "ASA 5500-X (5506 / 5508 / 5512 / 5515 / 5516 / 5525 / 5545 / 5555)", undefined, /^sku /);
  at("storage-networking", "DS-6SL0T-FAN=", "MDS 9500 directors (9506 / 9509 / 9513)");
  at("storage-networking", "DS-C24-300AC-IBM=", "MDS 9100 fabric switches (9124 / 9132T / 9134 / 9148 / 9148S / 9148T / 9148V)");
  at("storage-networking", "DS-2SLOT-FAN=", "MDS 9200 multiservice (9216 / 9222i / 9220i / 9250i)");
  at("servers-unified-computing", "N01-UAC1=", "UCS 5108 blade chassis", "power");
  at("servers-unified-computing", "N20-BBFLA", "UCS B420 / B440 / B460 / B480");
  at("servers-unified-computing", "N20-BBFLA-230=", "UCS B230");
  at("servers-unified-computing", "N20-BBLKD-7MM", "UCS B230");
  at("servers-unified-computing", "N20-BBFLB=", "UCS B250");
  // Q-13: the E-Series and the Services Ready Engine in servers
  at("servers-unified-computing", "SVC-E180D-M3", "UCS E-Series", undefined, /^sku \^SVC-E/);
  at("servers-unified-computing", "ISM-SRE-300-BUN-K9", "Services Ready Engine (ISM-SRE / SM-SRE)", "server");
  at("servers-unified-computing", "SM-MEM-VLP-4GB=", "Services Ready Engine (ISM-SRE / SM-SRE)", "memory");
  ranMove("routers", "E-SSD-U2N-4TB=", "servers-unified-computing");
  ranMove("routers", "EM3-HDA-8FXS", "interfaces-modules");
  // Q-11 / Q-12 / Q-6 / Q-2
  ranMove("wireless", "PWR-CH1-750ACR", "routers");
  at("wireless", "AIR-VCU-CELLPCS12=", "MobileAccessVE");
  at("wireless", "AIR-330-MB-2", "MobileAccessVE");
  at("wireless", "AIR-VAPMNTG-V-KIT=", "MobileAccessVE", "mechanical");
  at("routers", "CGR-N-CONN-WIMAX", "CGR 1000 Connected Grid", undefined, /^sku \^CGR-N-CONN-/);
  ranMove("interfaces-modules", "ENC-10G-ONT-14A", "switches");
  // Q-23 / N-2: the carriers of a fact or a document keep their rows; the empty placeholder goes
  at("wireless", "MR46", "Meraki MR indoor");
  at("wireless", "C9800-L", "Catalyst 9800-L");
  at("security", "5545-X", "ASA 5500-X (5506 / 5508 / 5512 / 5515 / 5516 / 5525 / 5545 / 5555)");
  at("transceiver", "SFP-H10GB-CU", "DAC and AOC cables (SFP+ / SFP28 / SFP56 / QSFP / QSFP-DD)", "cable");
  at("transceiver", "X2-10G-DWDM", "10G X2 / XENPAK / XFP (legacy)");
  ranClass("wireless", "C9105AXI", "non_product");
  // N-1: twins share placement; the truncated token with no twin is classed
  at("transceiver", "CPAK-100G-LR4-", "40G / 100G CFP, CFP2, CPAK and CXP");
  at("interfaces-modules", "NM-HDV-", "NM / NME Network Modules");
  at("collaboration-endpoints", "CAB-CAT5E-8M-", "Webex Board Series shared parts");
  at("collaboration-endpoints", "PSU-12VDC-70W-GR-", "Webex Room Series shared parts");
  planned("switches", "C9600-PWR-", "class non_product");
  ranClass("optical-networking", "15216-MD-48-", "non_product");
  // N-3, Q-10, Q-15, Q-19 / Q-20, F-7
  ranClass("security", "FPR4K-NM-4X40G-F=", "non_product");
  at("wireless", "CW9166I-X", "Catalyst CW9162 / CW9164 / CW9166 (Wi-Fi 6E)");   // a family carrier (Q-10 vs Q-23)
  ranMove("wireless", "SB-PWR-48V-xx", "interfaces-modules");                    // a carrier, moved to its family's category (run #1145)
  at("switches", "SF110D-05-xx", "Small Business 110 Unmanaged (SF110/SG110)");  // a carrier: 9 facts and the 110 Series data sheet
  planned("switches", "CBS350-8XT-xx", "class non_product");
  ranClass("collaboration-endpoints", "CP-PWR-CORD-xx=", "non_product");
  planned("hyperconverged-infrastructure", "R2XX-DMYMPWRCORD", "class non_product");
  ranMove("collaboration-endpoints", "CAB-AC2UK=", "routers");
  ranMove("storage-networking", "CAB-9K16A-EU=", "switches");
  ranMove("security", "PWR-IE50W-AC", "switches");
  // F-7's class plan RAN (run #1080, operator's yes, 15 Sep 2026): C-CPM is no longer a hardware row, and its plan carries the run id
  check(`re-audit conferencing: C-CPM left the hardware page by its class-software plan (run id recorded)`, !get("conferencing", "C-CPM")
    && (PLANS as { sku: string; category: string; action: string; to: string; run_id: unknown }[]).some((p) => p.sku === "C-CPM" && p.category === "conferencing" && p.action === "class" && p.to === "software" && typeof p.run_id === "number"));
  // the upper-case -X model names stay hardware rows (Q-10 is never case-insensitive)
  at("routers", "ASR1001-X", "ASR 1000");
  at("transceiver", "SFP-10G-LR-X", "10G SFP+");
  // batch 2 reading (16 Sep 2026, implementer under the operator's 12-hour delegation): the two glued-x CG113 stand-ins sit in their series
  // as carriers, and NDB-FX-SWT-K9 ("NDB license for 1 Cisco Nexus fixed switch") is planned a licence, not a software image
  at("routers", "CG113-4GW6x", "Catalyst Wireless Gateway CG113");
  at("routers", "CG113-W6x", "Catalyst Wireless Gateway CG113");
  // its class-licence plan RAN in batch 2 (run #1107), so it is no longer a hardware row — the C-CPM shape
  check(`re-audit switches: NDB-FX-SWT-K9 left the hardware page by its class-license plan (run id recorded)`, !get("switches", "NDB-FX-SWT-K9")
    && (PLANS as { sku: string; category: string; action: string; to: string; run_id: unknown }[]).some((p) => p.sku === "NDB-FX-SWT-K9" && p.category === "switches" && p.action === "class" && p.to === "license" && typeof p.run_id === "number"));
}

// SABOTAGE: each check sees a planted defect, for the stated reason.
{
  const row = (sku: string, o: Partial<LayerRow> = {}): LayerRow => ({ sku, name: "x", series_label: "", kind: "switch", bucket: "layered", series: "A", plan: "", ...o });
  const pairs = pairDisagreements([row("ZZ-TEST-1"), row("ZZ-TEST-1=", { kind: "mechanical" })]);
  check("SABOTAGE a planted base/spare kind split is reported, naming the field", pairs.length === 1 && pairs[0].fields.join() === "kind", JSON.stringify(pairs));
  // N-1 (re-audit decisions, 15 Sep 2026): the component PID X- and the customized model X-- are twins too, reported under the base
  const tw1 = pairDisagreements([row("ZZ-TEST-2"), row("ZZ-TEST-2-", { series: "B" }), row("ZZ-TEST-2--"), row("ZZ-TEST-2=")]);
  check("SABOTAGE twin rule: an X- in another series is reported under its base, and the agreeing X-- and X= are not", tw1.length === 1 && tw1[0].sku === "ZZ-TEST-2" && tw1[0].member === "ZZ-TEST-2-" && tw1[0].fields.join() === "series", JSON.stringify(tw1));
  const tw2 = pairDisagreements([row("ZZ-TEST-3=", { plan: "class non_product", bucket: "pending_plan", series: "" }), row("ZZ-TEST-3-")]);
  check("SABOTAGE twin rule: with no base row, the spare is the group's reference", tw2.length === 1 && tw2[0].sku === "ZZ-TEST-3=" && tw2[0].member === "ZZ-TEST-3-", JSON.stringify(tw2));
  {
    const { placeWithSpareRule } = await import("../src/core/productLine.js");
    // collaboration-endpoints: CAB-CAT5E-8M (base) and = sit in Board Series shared parts by the label Spark Board, the component PID
    // CAB-CAT5E-8M- in Room Series shared parts by the label Room Series — equal evidence, informative names: the base wins the tie
    const trio = placeWithSpareRule("cisco", "collaboration-endpoints", [
      { sku: "CAB-CAT5E-8M-", name: "Ethernet CAT5E Round Cable - 8 meter - Gray - SPARE (for Room Navigator)", series: "Room Series" },
      { sku: "CAB-CAT5E-8M=", name: "Ethernet CAT5E Round Cable - 8 meter - Gray - SPARE (for Room Navigator)", series: "Spark Board" },
      { sku: "CAB-CAT5E-8M", name: "8 meter round gray Ethernet cable for Cisco Devices", series: "Spark Board" }]);
    check("SABOTAGE twin placement: the three members of CAB-CAT5E-8M share the base's series (Board Series shared parts)", ["CAB-CAT5E-8M-", "CAB-CAT5E-8M=", "CAB-CAT5E-8M"].every((s) => trio.get(s)?.series === "Webex Board Series shared parts"), JSON.stringify([...trio]));
    const lone = placeWithSpareRule("cisco", "collaboration-endpoints", [{ sku: "CAB-CAT5E-8M-", name: "Ethernet CAT5E Round Cable - 8 meter - Gray - SPARE (for Room Navigator)", series: "Room Series" }]);
    check("SABOTAGE twin placement: without its twins the component PID keeps its own placement (the rule is live, not a constant)", lone.get("CAB-CAT5E-8M-")?.series === "Webex Room Series shared parts", JSON.stringify([...lone]));
  }
  const tw = twinGroups([row("C9200L-48P-4G"), row("C9200L-48P- 4G"), row("c9200l-48p-4g=")]);
  check("SABOTAGE a planted whitespace twin is one group of two (the spare is a different part)", tw.length === 1 && tw[0].length === 2, JSON.stringify(tw));
  // (was a planted MS120-24P claimed by the meraki mapping's MS series; the meraki round removed that series — the switches hold Meraki MS)
  const planted = crossClaims("switches", [row("MV63-HW", { name: "Cisco MV63-HW" })], CATS);
  check("SABOTAGE a Meraki MV camera planted in switches is seen as claimed by the meraki mapping (the leakage scan is live)", planted.some((g) => g.claimed_by === "meraki" && g.series === "MV63"), JSON.stringify(planted));
  const noRow = classifyRules(ruleUse("switches", [], []));
  check("SABOTAGE with no rows every SKU rule is dead (the dead-rule count is live)", noRow.dead.length > 100, `${noRow.dead.length}`);

  const strays = moveOutStrays([row("NIM-2T", { series: "NIM (Network Interface Modules)" }), row("NIM-4T", { series: "NIM (Network Interface Modules)", bucket: "pending_plan" })], new Set(["NIM (Network Interface Modules)"]));
  check("SABOTAGE move-out: a layered row in a move-out series is a stray, a pending-plan row there is not", strays.length === 1 && strays[0].sku === "NIM-2T", JSON.stringify(strays));

  // series entries against their rows: a family that disagrees (the Catalyst 8000 Edge shared parts defect), and a parts count
  const entry = { lines: [{ line: "L", series: [{ series: "L shared parts", family: null, parts: 2, kinds: { mechanical: 2 }, roles: {} }] }] };
  const plantedRows = [row("C-E1S-BLANK", { product_line: "L", series: "L shared parts", kind: "mechanical", product_family: "(shared across the line)", deploy_role: "", role_issue: "" }),
    row("C-HDD-BLANK", { product_line: "L", series: "L shared parts", kind: "mechanical", product_family: "(shared across the line)", deploy_role: "", role_issue: "" })];
  const d1 = seriesEntryDisagreements(entry, plantedRows);
  check("SABOTAGE series entries: an entry whose family is null while its rows say shared-across is reported on family alone", d1.length === 1 && d1[0].fields.join() === "family", JSON.stringify(d1));
  entry.lines[0].series[0].family = "(shared across the line)" as any; entry.lines[0].series[0].parts = 3;
  const d2 = seriesEntryDisagreements(entry, plantedRows);
  check("SABOTAGE series entries: a parts count the rows do not carry is reported on parts alone", d2.length === 1 && d2[0].fields.join() === "parts", JSON.stringify(d2));
  const dp = deadPlaceholders({ lines: [{ line: "Nexus", series: [{ series: "Nexus 9800", parts: 0 }, { series: "CQ211L01", parts: 0, pending_in: { routers: 6 } }, { series: "Nexus 9300", parts: 5 }] }] });
  check("SABOTAGE placeholders: an empty series with nothing pending is reported, one pending rows from routers is not", dp.join() === "Nexus / Nexus 9800", JSON.stringify(dp));
  const dv = deviceInSharedParts([row("CVR328W-K9-CN", { kind: "router", product_line: "Small Business Routers", series: "Small Business Routers shared parts" }), row("PWR-60W-AC", { kind: "power", series: "ISR shared parts" })]);
  check("SABOTAGE devices: a router in shared parts is caught, a power supply there is not", dv.length === 1 && dv[0].sku === "CVR328W-K9-CN", JSON.stringify(dv));
  const dv3 = deviceInSharedParts(["device", "ont", "olt", "ap", "wlc", "backhaul", "sensor"].map((k, i) => row(`ZZ-DEV-${i}`, { kind: k, series: "Cables and accessories shared parts" })));
  check("SABOTAGE devices (round 3): a whole device of kind device / ont / olt / ap / wlc / backhaul / sensor in shared parts is caught", dv3.length === 7 && ["device", "ont", "olt", "ap", "wlc", "backhaul", "sensor"].every((k) => DEVICE_KINDS.has(k)), JSON.stringify(dv3.map((r) => r.kind)));
  check("SABOTAGE devices (wireless round): an antenna or a bundle in shared parts is not a device", deviceInSharedParts([row("ZZ-ANT", { kind: "antenna", series: "X shared parts" }), row("ZZ-BUN", { kind: "bundle", series: "X shared parts" })]).length === 0);
  const dvs = deviceInSharedParts([row("UCSC-C420-M3", { kind: "server", series: "UCS C-Series Rack Servers shared parts" }), row("UCS-FI-6652=", { kind: "fabric-interconnect", series: "UCS Fabric Interconnects shared parts" }),
    row("UCS-S3348-RAIDM5", { kind: "storage-controller", series: "UCS Server Components shared parts" }), row("UCS-M6-MLB", { kind: "bundle", series: "UCS Server Components shared parts" })]);
  const dvuc = deviceInSharedParts([row("ZZ-PHONE", { kind: "phone", series: "IP Phones shared parts" }), row("ZZ-GW", { kind: "gateway", series: "Voice Gateways shared parts" }),
    row("ZZ-ATA", { kind: "ata", series: "Analog Telephone Adapters and SPA shared parts" }), row("ZZ-VM", { kind: "voice-module", series: "Voice Gateways shared parts" })]);
  check("SABOTAGE devices (UC round): a phone, a gateway and an ATA in shared parts are caught, a voice module is not",
    dvuc.map((r) => r.sku).join() === "ZZ-PHONE,ZZ-GW,ZZ-ATA" && ["phone", "gateway", "ata"].every((k) => DEVICE_KINDS.has(k)), JSON.stringify(dvuc.map((r) => r.sku)));
  const dvsan = deviceInSharedParts([row("ZZ-FC", { kind: "fc-switch", series: "MDS 9000 Multilayer SAN Switches shared parts" }), row("ZZ-DIR", { kind: "director", series: "MDS 9000 Multilayer SAN Switches shared parts" }),
    row("ZZ-LC", { kind: "linecard", series: "MDS 9000 Multilayer SAN Switches shared parts" })]);
  check("SABOTAGE devices (storage round): an fc-switch and a director in shared parts are caught, a line card is not",
    dvsan.map((r) => r.sku).join() === "ZZ-FC,ZZ-DIR" && DEVICE_KINDS.has("fc-switch") && DEVICE_KINDS.has("director"), JSON.stringify(dvsan.map((r) => r.sku)));
  const dvvid = deviceInSharedParts([row("ZZ-NODE", { kind: "node", series: "GS7000 Nodes and Optical Hubs shared parts" }), row("ZZ-SYS", { kind: "system", series: "Prisma II Optical Transport shared parts" }),
    row("ZZ-PLUG", { kind: "plug-in", series: "Prisma II Optical Transport shared parts" }), row("ZZ-TX", { kind: "transmitter", series: "Prisma II Optical Transport shared parts" })]);
  check("SABOTAGE devices (video round): a node and a system in shared parts are caught, a plug-in and a transmitter are not",
    dvvid.map((r) => r.sku).join() === "ZZ-NODE,ZZ-SYS" && DEVICE_KINDS.has("node") && DEVICE_KINDS.has("system"), JSON.stringify(dvvid.map((r) => r.sku)));
  const secBox = ["firewall", "ips", "email-gateway", "web-gateway", "management", "analytics", "identity"];
  const dvsec = deviceInSharedParts([...secBox.map((k, i) => row(`ZZ-SEC-${i}`, { kind: k, series: "ASA and ISA shared parts" })),
    row("ZZ-SEC-MOD", { kind: "security-module", series: "Secure Firewall and Firepower shared parts" }), row("ZZ-SEC-PWR", { kind: "power", series: "ASA and ISA shared parts" })]);
  check("SABOTAGE devices (security round): a firewall / ips / email or web gateway / management / analytics / identity box in shared parts is caught, a security module and a power supply are not",
    dvsec.length === 7 && dvsec.every((r) => secBox.includes(r.kind)), JSON.stringify(dvsec.map((r) => r.kind)));
  check("SABOTAGE devices (servers round): a server and a fabric interconnect in shared parts are caught, a storage controller and a bundle there are not",
    dvs.map((r) => r.sku).join() === "UCSC-C420-M3,UCS-FI-6652=" && DEVICE_KINDS.has("server") && DEVICE_KINDS.has("fabric-interconnect"), JSON.stringify(dvs.map((r) => r.sku)));
  // collaboration-endpoints round: the whole endpoints and room peripherals Cisco sells as products join; their mounts, cables and supplies do not
  const collabBox = ["video-device", "video-codec", "dect-base", "camera", "microphone", "speaker", "headset", "touch-panel", "display", "expansion-module"];
  const dvcol = deviceInSharedParts([...collabBox.map((k, i) => row(`ZZ-COL-${i}`, { kind: k, series: "TelePresence (legacy) shared parts" })),
    row("ZZ-COL-MECH", { kind: "mechanical", series: "Webex Room Series shared parts" }), row("ZZ-COL-CAB", { kind: "cable", series: "Cameras shared parts" }),
    row("ZZ-COL-PWR", { kind: "power", series: "IP Phones shared parts" }), row("ZZ-COL-ACC", { kind: "accessory", series: "Headsets shared parts" })]);
  check("SABOTAGE devices (collaboration round): a video device / codec, DECT base, camera, microphone, speaker, headset, touch panel, display and key expansion module in shared parts are caught, a mount, a cable, a supply and an accessory are not",
    dvcol.length === 10 && dvcol.every((r) => collabBox.includes(r.kind)), JSON.stringify(dvcol.map((r) => r.kind)));
  // meraki round: merakiKind's device nouns, the access point among them
  const merakiBox = ["access-point", "camera", "appliance", "gateway", "sensor", "switch"];
  const dvmk = deviceInSharedParts([...merakiBox.map((k, i) => row(`ZZ-MK-${i}`, { kind: k, series: "Meraki MV Smart Cameras shared parts" })),
    row("ZZ-MK-ACC", { kind: "accessory", series: "Meraki MG Cellular Gateways shared parts" }), row("ZZ-MK-UNK", { kind: "unknown", series: "Meraki MT Sensors shared parts" })]);
  check("SABOTAGE devices (meraki round): an access point, camera, appliance, gateway, sensor and switch in shared parts are caught, an accessory and an unknown are not",
    dvmk.length === 6 && dvmk.every((r) => merakiBox.includes(r.kind)), JSON.stringify(dvmk.map((r) => r.kind)));

  // round 3: the transceiver cable contract, the label expectation and the arrivals check, each refusing for its stated reason
  const cc = cableContract([row("SFP-H25G-CU1M", { kind: "cable", series: TX_DAC_SERIES, product_line: "Direct-attach and active optical cables" }),
    row("QSFP-4SFP25G-CU1M", { kind: "breakout-cable", series: TX_DAC_SERIES, product_line: "Direct-attach and active optical cables" }),
    row("QSFP-4X10G-AOC1M", { kind: "breakout-cable", series: "40G QSFP+", product_line: "Ethernet transceivers" })]);
  check("SABOTAGE cable contract: a breakout in the DAC series is caught by both halves; a cable there and a breakout in 40G QSFP+ are not",
    cc.notCableInDac.map((r) => r.sku).join() === "QSFP-4SFP25G-CU1M" && cc.breakoutOutsideSpeed.map((r) => r.sku).join() === "QSFP-4SFP25G-CU1M", JSON.stringify(cc));
  check("SABOTAGE label expectation: transceiver with 3 label-placed rows is refused against its recorded exactly-0", /expected exactly 0/.test(labelExpectMiss("transceiver", 3) ?? ""));
  check("SABOTAGE label expectation: switches with 40 label-placed rows is refused against its floor", /more than 100/.test(labelExpectMiss("switches", 40) ?? ""));
  check("SABOTAGE label expectation: a category with no recorded expectation is refused", /no label expectation/.test(labelExpectMiss("zz-category", 0) ?? ""));
  const ua = unplacedArrivals("zz", [row("15454-SFP-GE+-LX=", { name: "Cisco 15454-SFP-GE+-LX=", series_label: "" }), row("ZZ-NO-RULE-9", { name: "Cisco ZZ-NO-RULE-9", series_label: "" })],
    [{ sku: "15454-SFP-GE+-LX=", category: "zz", action: "move", to: "optical-networking", run_id: null }, { sku: "ZZ-NO-RULE-9", category: "zz", action: "move", to: "optical-networking", run_id: null },
      { sku: "15454-SFP-GE+-LX=", category: "zz", action: "move", to: "routers", run_id: 1234 }]);
  check("SABOTAGE arrivals: a planned SKU no target rule places is reported; a placed one and a plan that ran are not", ua.length === 1 && ua[0].sku === "ZZ-NO-RULE-9" && /no rule of optical-networking/.test(ua[0].why), JSON.stringify(ua));

  // pre-ruling C1 (layers round 3): a label mapped directly to a line's shared parts is not judged, but only while the mapping lists it
  const c1 = sharedLabelNotExplicit("interfaces-modules", [
    row("ZZ-C1-LISTED", { product_line: "Cables and accessories", series: "Cables and accessories shared parts", placed_by: "label Access Point Modules" }),
    row("ZZ-C1-UNLISTED", { product_line: "Cables and accessories", series: "Cables and accessories shared parts", placed_by: "label Bogus Label" })]);
  check("SABOTAGE C1: a shared-parts label the mapping does not list is reported, a listed one is not", c1.length === 1 && c1[0].sku === "ZZ-C1-UNLISTED" && /not listed/.test(c1[0].why), JSON.stringify(c1));
  const c1v = labelViolations([
    row("ZZ-C1-QUIET", { product_line: "L", series: "L shared parts", placed_by: "label X" }),
    row("ZZ-C1-JUDGED", { product_line: "L", series: "L shared parts", placed_by: "label X", label_evidence: "none: no series token" })]);
  check("SABOTAGE C1: a direct shared-parts label row with no evidence passes; one that recorded evidence is refused for that reason", c1v.length === 1 && c1v[0].sku === "ZZ-C1-JUDGED" && /not judged/.test(c1v[0].why), JSON.stringify(c1v));
  // pre-ruling C10: a generic form-factor noun of the series name is not evidence; a product token of the name still is
  {
    const ctx = { family: null, siblings: [{ series: "Fiber and M12 cables (CB-)", family: null }, { series: "NIM (Network Interface Modules)", family: null }] };
    const fq = labelEvidence({ sku: "FQMAP46CG", name: "Fiber Optic Migration Adapter Panel - 4 MPO Adapters – Type B" }, "Fiber and M12 cables (CB-)", ctx);
    check("SABOTAGE C10: FQMAP46CG is not kept in the CB- series by the word Fiber", fq.kind === "none", JSON.stringify(fq));
    const mpo = labelEvidence({ sku: "ZZ-TRUNK-12", name: "MPO trunk cable, 12 fibre" }, "Fiber patch panels and MPO / breakout cables (CB- / PP)", ctx);
    check("SABOTAGE C10: and the product token MPO still evidences the renamed series (the stop-words took only the generic nouns)", mpo.kind === "name" && mpo.detail === "MPO", JSON.stringify(mpo));
  }

  // the label check on built rows: a bare label in a series, and a moved row left in its series, are each refused
  const lv = labelViolations([
    row("MEM-224-1X128D-U", { product_line: "ISR", series: "ISR 810", placed_by: "label 800", label_evidence: "none: no platform token" }),
    row("PWR-60W-AC", { product_line: "ISR", series: "ISR 810", placed_by: "label 800" }),
    row("PS-SWITCH-AC-2P", { product_line: "ISR", series: "ISR 810", placed_by: "label-unsupported (label 800; was ISR 810): none", label_evidence: "none: x" }),
    row("MEM8XX-256U512D", { product_line: "ISR", series: "ISR 810", placed_by: "label 800", label_evidence: "name: 880" })]);
  check("SABOTAGE label check: an unsupported label, a label with no evidence and a moved row outside shared parts are 3 violations, the evidenced row none",
    lv.length === 3 && lv.map((v) => v.sku).join() === "MEM-224-1X128D-U,PWR-60W-AC,PS-SWITCH-AC-2P", JSON.stringify(lv));

  // labelEvidence itself, each case for its stated reason
  const isr = { family: null, siblings: ["ISR 1900", "ISR 2900", "ISR 3900", "ISR 4000", "ISR 1100"].map((s) => ({ series: s, family: null })) };
  const cat = { family: "Catalyst 2960", siblings: ["Catalyst 2960-C and 2960-CX", "Catalyst 3560-C and 3560-CX", "Catalyst 1000", "Catalyst 9300"].map((s) => ({ series: s, family: null })) };
  const ie = { family: null, siblings: ["IE 3400", "IE 3400H", "IE 3000"].map((s) => ({ series: s, family: null })) };
  const v = (sku: string, name: string, series: string, ctx: Parameters<typeof labelEvidence>[2], comp: string[] = []) => labelEvidence({ sku, name }, series, ctx, new Set(comp));
  let e = v("MEM-1900-1GB=", "1GB DRAM for Cisco 1941/1941W ISR (only as spare)", "ISR 2900", isr);
  check("SABOTAGE label: 1941 memory labelled ISR 2900 is none, naming ISR 1900", e.kind === "none" && /ISR 1900/.test(e.detail), JSON.stringify(e));
  e = v("MEM-4300-2G=", "2G DRAM (1 DIMM) for Cisco ISR 4330, 4350, Spare", "ISR 4000", isr);
  check("SABOTAGE label: ISR 4330 memory in ISR 4000 is a SKU token (N000 = the Nxxx models)", e.kind === "sku-token" && e.detail === "4000", JSON.stringify(e));
  e = v("MEM-224-1X128D-U", "128MB DRAM Memory for VG224", "ISR 1100", isr);
  check("SABOTAGE label: VG224 memory labelled ISR 1100 is none", e.kind === "none", JSON.stringify(e));
  e = v("PWR-C1-1900WHV-T=", "1900W HVAC/HVDC Titanium-certified power supply spare", "Catalyst 9300", cat);
  check("SABOTAGE label: a 1900W supply is none without naming Catalyst 1000 (a wattage is not a platform)", e.kind === "none" && !/Catalyst 1000/.test(e.detail), JSON.stringify(e));
  e = v("CMP-CBLE-GRD", "Cable Guard For The 3560-C and 2960-C Compact Switches", "Catalyst 2960-C and 2960-CX", cat);
  check("SABOTAGE label: a part naming 2960-C and 3560-C equally is none (shared)", e.kind === "none" && /equally/.test(e.detail), JSON.stringify(e));
  e = v("SD-IE-16GB", "IE 3400H 16GB SD card", "IE 3400H", ie);
  check("SABOTAGE label: 'IE 3400H' in the name keeps IE 3400H (the IE 3400 sibling name is fenced)", e.kind === "name" && e.detail === "IE 3400H", JSON.stringify(e));
  e = v("ZZ-PLAIN-PART", "Cisco ZZ-PLAIN-PART", "ISR 2900", isr, ["ISR 2900"]);
  check("SABOTAGE label: no token but a compatible link into the series keeps it as compatible", e.kind === "compatible", JSON.stringify(e));
  e = v("ZZ-PLAIN-PART", "Cisco ZZ-PLAIN-PART", "ISR 2900", isr, ["ISR 3900"]);
  check("SABOTAGE label: a compatible link into ANOTHER series does not", e.kind === "none", JSON.stringify(e));
  // wireless round: a W that starts "Wireless" is not a watt; "1900W HVAC" still is
  const wlc = { family: null, siblings: ["2500 (2504)", "3500 (3504)", "5500 (5508 / 5520 / 5540)", "8500 (8510 / 8540 / 8580)"].map((s) => ({ series: s, family: null })) };
  e = v("AIR-FAN-C220M4=", "Spare fan - Cisco 5520 Wireless Controller", "5500 (5508 / 5520 / 5540)", wlc);
  check("SABOTAGE label: '5520 Wireless Controller' is the platform 5520, not 5520 W", e.kind === "name" && e.detail === "5520", JSON.stringify(e));
  e = v("ZZ-PSU-5520W", "Power supply 5520 W AC", "5500 (5508 / 5520 / 5540)", wlc);
  check("SABOTAGE label: and '5520 W AC' is still a wattage (the fence kept its reason)", e.kind === "none", JSON.stringify(e));
  e = v("PWR-ADPT-18W", "Power adaptor, 18W, for Catalyst 1000 switches", "Catalyst 1000", { ...cat, family: null });
  check("SABOTAGE label: the whole series name in the name keeps it", e.kind === "name" && e.detail === "Catalyst 1000", JSON.stringify(e));

  // THE ACRONYM ANCHOR (16 Sep 2026). The clause's two sides had anchored differently: the SKU side required a non-letter on both
  // sides, the NAME side only forbade a following LOWERCASE letter — so an acronym matched the START of any longer all-caps word,
  // which is how a 500 GB SATA drive came to name an Aironet hazardous-location series on SA. Both directions are asserted, because
  // the loose form exists for a real case: an acronym followed by a DIGIT (CGR1240) must still keep. Two series shapes are needed —
  // a series carrying a platform NUMBER never reaches this clause, so the fixtures are number-less on purpose.
  const sm = { family: null, siblings: ["SM-X and SM Service Modules", "EHWIC cards", "NIM modules"].map((s) => ({ series: s, family: null })) };
  // The MX fixture names the series that ACTUALLY made the claim. My first version used "TelePresence MXP", whose acronym MXP is
  // not a prefix of MXCAM at all — so it passed under BOTH anchors and proved nothing, which the sabotage run caught: a negative
  // fixture must be negative under the rule it tests. The claim came from the MX sibling, and MX is a prefix of MXCAM.
  const mxp = { family: null, siblings: ["TelePresence MX (MX200 / MX300 / MX700 / MX800)", "TelePresence MXP", "Webex Room Kit"].map((s) => ({ series: s, family: null })) };
  const cgr = { family: null, siblings: ["CGR Connected Grid Routers", "IR Industrial Routers"].map((s) => ({ series: s, family: null })) };
  // the SKU is neutral in every case: the SKU side is tried first and was never the defect
  e = v("ZZ-BLANK-1", "Bundle of 2 pack PA MC STM1 SMI", "SM-X and SM Service Modules", sm);
  check("SABOTAGE label: the acronym SM does not match inside SMI (the name side anchors on both sides)", e.kind === "none", JSON.stringify(e));
  e = v("ZZ-BLANK-2", "Blank filler for the SM slot", "SM-X and SM Service Modules", sm);
  check("SABOTAGE label: and SM as its own word still keeps the series", e.kind === "name" && e.detail === "SM", JSON.stringify(e));
  e = v("ZZ-BLANK-3", "Cable w/ RJ45 0.7 mts, MXCAM-D", "TelePresence MX (MX200 / MX300 / MX700 / MX800)", mxp);
  check("SABOTAGE label: MX does not match inside MXCAM (the four CAB-ETHRJ45 cables, withdrawn 16 Sep 2026)", e.kind === "none", JSON.stringify(e));
  e = v("ZZ-BLANK-4", "Table microphone for MX", "TelePresence MX (MX200 / MX300 / MX700 / MX800)", mxp);
  check("SABOTAGE label: and MX as its own word still keeps the series", e.kind === "name" && e.detail === "MX", JSON.stringify(e));
  e = v("ZZ-BLANK-5", "DIN rail mount for CGR1240", "CGR Connected Grid Routers", cgr);
  check("SABOTAGE label: an acronym followed by a DIGIT still keeps (CGR1240 — the case the loose anchor existed for)", e.kind === "name" && e.detail === "CGR", JSON.stringify(e));
  e = v("ZZ-BLANK-6", "Power supply for CGRXYZ chassis", "CGR Connected Grid Routers", cgr);
  check("SABOTAGE label: but an acronym followed by a LETTER does not (CGRXYZ)", e.kind === "none", JSON.stringify(e));
  e = v("ZZ-BLANK-7", "Small form factor blanking plate", "SM-X and SM Service Modules", sm);
  check("SABOTAGE label: the lowercase follow the OLD anchor already refused is still refused (SM in Small)", e.kind === "none", JSON.stringify(e));

  // THE MODEL-LETTER FENCE (16 Sep 2026). `digitPattern` widens a round number into its family on purpose, and dropped the
  // model letter doing it, so 2[0-9]{2} claimed SN200 (a drive), H200 (a GPU) and B230 (a blade) for a C-series page. Where
  // the SERIES puts letters before its number, the haystack's must end with them — or be absent, which is the ordinary
  // "for the 1550 Series" shape and is asserted here so a future tightening cannot quietly take it.
  const ucs = { family: null, siblings: ["UCS C200 / C210 / C250 / C260 (M1/M2)", "UCS C240", "UCS B250"].map((s) => ({ series: s, family: null })) };
  const air = { family: null, siblings: ["Aironet 1550 hazardous-location (H / SA / SD / WU)", "Aironet 1560"].map((s) => ({ series: s, family: null })) };
  const hx = { family: null, siblings: ["HyperFlex compute-only nodes (C220 / C240 / C480 / B200 / B480)", "HX240c"].map((s) => ({ series: s, family: null })) };
  e = v("ZZ-FENCE-1", "800GB 2.5in U.2 HGST SN200 NVMe High Perf", "UCS C200 / C210 / C250 / C260 (M1/M2)", ucs);
  check("SABOTAGE fence: an HGST SN200 drive does not name UCS C200 (N is not C)", e.kind === "none", JSON.stringify(e));
  e = v("ZZ-FENCE-2", "RAID battery backup for C260", "UCS C200 / C210 / C250 / C260 (M1/M2)", ucs);
  check("SABOTAGE fence: and a real C260 part still keeps the series", e.kind === "name" && e.detail === "260", JSON.stringify(e));
  e = v("ZZ-FENCE-3", "Replacement Thermal Pad for UCS B440/B230", "UCS C200 / C210 / C250 / C260 (M1/M2)", ucs);
  check("SABOTAGE fence: a B230 blade part does not name a C-series page", e.kind === "none", JSON.stringify(e));
  e = v("ZZ-FENCE-4", "Cover and solar shield for the 1550 Series", "Aironet 1550 hazardous-location (H / SA / SD / WU)", air);
  check("SABOTAGE fence: a series whose number stands alone is UNFENCED and still matches a bare number", e.kind === "name" && e.detail === "1550", JSON.stringify(e));
  e = v("ZZ-FENCE-5", "Ball Bearing Rail Kit for C240 M6 rack servers", "HX240c", hx);
  check("SABOTAGE fence: a C240 RACK part does not name the HX240c hyperconverged node", e.kind === "none", JSON.stringify(e));
  e = v("ZZ-FENCE-6", "Ball Bearing Rail Kit for C240 M6 rack servers", "HyperFlex compute-only nodes (C220 / C240 / C480 / B200 / B480)", hx);
  check("SABOTAGE fence: and the compute-only-node series still claims it, so the tie breaks the right way", e.kind === "name" && e.detail === "240", JSON.stringify(e));

  // THE NUMBER-KEYED ALIAS (16 Sep 2026). LABEL_ALIASES is keyed by a bare number, so "5000" offered the NEXUS spelling N5K
  // to every series carrying 5000 — NCS 5000, ASR 5000, CSP 5000, TelePresence IX5000. Each such alias now declares the brand
  // word its series must contain. The DRIFT CHECK first, because a two-table mapping with nothing comparing them is the
  // failure this repo keeps paying for: the run refuses if any number-keyed alias has no entry.
  const missingReq = [...new Set(NUMBER_KEYED_ALIASES)].filter((a) => !ALIAS_REQUIRES[a]);
  check(`alias brands: every one of the ${new Set(NUMBER_KEYED_ALIASES).size} number-keyed aliases declares the brand its series must name`,
    missingReq.length === 0, `no entry for: ${missingReq.join(", ")}`);
  const strayReq = Object.keys(ALIAS_REQUIRES).filter((a) => !NUMBER_KEYED_ALIASES.includes(a));
  check("alias brands: and no entry is stale (a requirement for an alias no number key offers is a hole)",
    strayReq.length === 0, `stale: ${strayReq.join(", ")}`);

  const ncs = { family: null, siblings: ["NCS 5000", "NCS 5500", "ASR 9000"].map((s) => ({ series: s, family: null })) };
  const nex = { family: null, siblings: ["Nexus 5000", "Nexus 9300"].map((s) => ({ series: s, family: null })) };
  e = v("CAB-N5K6A-NA", "Power Cord, 200/240V 6A, North America (2.5 meters)", "NCS 5000", ncs);
  check("SABOTAGE alias: the Nexus spelling N5K does not name NCS 5000 (a number key is not a series)", e.kind === "none", JSON.stringify(e));
  e = v("CAB-N5K6A-NA", "Power Cord, 200/240V 6A, North America (2.5 meters)", "Nexus 5000", nex);
  check("SABOTAGE alias: and it still names Nexus 5000, which is whose spelling it is", e.kind === "sku-token" && e.detail === "N5K", JSON.stringify(e));

  // A STANDARDS NUMBER IS NOT A PLATFORM (16 Sep 2026). A power cord names the standard it is built to, in the same 3-5 digit
  // band as Cisco's platforms. The guard lives in NOT_PLATFORM_BEFORE beside the wattage and DDR rules, so it is shared by
  // every digit pattern — which makes the ANCHORING controls the ones that matter: the `IS` of CHASSIS/ISR/analysis and the
  // `GB` of 512GB must not be read as a standards body. Refusals and controls are asserted together, at the pattern level,
  // because that is where the risk is.
  const std: [string, string, boolean, string][] = [
    ["1300", "AC Power Cord (UK), C13, BS 1363, 2.5m", false, "BS 1363 is the UK plug standard, not Catalyst 1300"],
    ["1000", "Power Cord for AC V2 Power Module (Brazil), NBR 14136", false, "NBR 14136 is Brazil's"],
    ["1000", "Power Cord for AC V2 Power Module (Swiss), SEV 1011", false, "SEV 1011 is Switzerland's"],
    ["6000", "Internal C13-C14 Power Cord for China, IEC60320, 3x18 AWG", false, "IEC 60320 is the connector standard"],
    ["1200", "India AC Power Cord for Cisco ASR 900, IS:1293", false, "IS:1293 is India's — and the cord says ASR 900"],
    ["3000", "CHASSIS3000 spare", true, "CONTROL: the IS of CHASSIS is not the Indian standards body"],
    ["4000", "Cisco ISR 4331 router", true, "CONTROL: nor the IS of ISR"],
    ["9500", "for the analysis 9500 platform", true, "CONTROL: nor the IS of analysis"],
    ["1000", "Catalyst 1000 switch", true, "CONTROL: a real platform still matches"],
    ["6000", "Nexus 6000 fabric", true, "CONTROL: and so does Nexus 6000"],
    // THE LOW END OF A UNIT-BEARING RANGE (16 Sep 2026). A unit fences the number it follows, but in a range the unit is on
    // the FAR end and the near number is bare. Requiring a unit after the second number is what keeps this off real SKUs,
    // where a hyphen is followed by a PORT CODE — and those controls are the point of the block, not decoration.
    ["200", "1400W AC Power Supply (200 - 240V) 2U & 4U C Series Servers", false, "a voltage RANGE is not the UCS C200"],
    ["800", "Outdoor omni-antenna, 863-928 MHz, 6 dBi, type N connector", false, "the LPWAN band 863-928 MHz is not IR 800"],
    ["9500", "supported on C9500-32QC and C9500-48Y4C", true, "CONTROL: -32QC is a port code, not a unit"],
    ["3400", "IE-3400-8P2S industrial switch", true, "CONTROL: -8P2S is a port code"],
    ["2960", "WS-C2960-24TC-L", true, "CONTROL: -24TC is a port code"],
    ["9300", "C9300-48U switch", true, "CONTROL: -48U is a port code"],
  ];
  for (const [tok, hay, want, why] of std)
    check(`SABOTAGE standards: ${why}`, digitPattern(tok).re.test(hay) === want, `${tok} in "${hay}" matched ${digitPattern(tok).re.test(hay)}`);

  // CATEGORY NOUNS AND BRAND WORDS IN STOP (16 Sep 2026). A series name carries words that are not its identity — the
  // category noun inside "…outdoor access POINT / bridge", the furniture in "Cable MANAGEMENT Arm", a brand shared by two
  // products. Seven were added; the control asserts the series is still reachable by its NUMBER, because STOP only ever
  // removes evidence and the risk is removing the only evidence a real part had.
  // THE SIBLINGS COME FROM THE REAL MAPPING, not from a hand-written list, and that is not tidiness — my first version of
  // these fixtures put "Security Management Appliance (SMA)" and "Management Console" in one siblings array, so `management`
  // was a SIBLING WORD and already excluded. The case passed for the wrong reason and stayed green under sabotage. In the
  // real mapping those two live in different LINES (Secure Email and Web; Secure Network Analytics), no sibling carries the
  // word, and STOP is what does the work. A fixture must be negative under the rule it tests.
  const { loadLineFile: loadLF } = await import("../src/core/productLine.js");
  const ctxOf = (cat: string, series: string) => {
    const loaded = loadLF("cisco", cat)!;
    const ln = loaded.file.lines.find((l) => l.series.some((s) => s.series === series))!;
    return { family: null, siblings: ln.series.map((s) => ({ series: s.series, family: s.family?.trim() || null })) };
  };
  const airCtx = ctxOf("wireless", "Aironet 1310 outdoor access point / bridge (legacy)");
  e = v("AIR-AP-BRACKET-8", "Bracket for Cisco Catalyst 9105i access point mounting", "Aironet 1310 outdoor access point / bridge (legacy)", airCtx);
  check("SABOTAGE stopword: 'point' is the category noun, so an AP bracket does not name Aironet 1310", e.kind === "none", JSON.stringify(e));
  e = v("ZZ-1310", "Mounting kit for the Aironet 1310 bridge", "Aironet 1310 outdoor access point / bridge (legacy)", airCtx);
  check("SABOTAGE stopword: CONTROL — the series is still reachable by its platform number", e.kind === "sku-token" && e.detail === "1310", JSON.stringify(e));
  e = v("LC-RAILS=", "Cisco StealthWatch Sliding Rail Without Cable Management Arm", "Management Console", ctxOf("security", "Management Console"));
  check("SABOTAGE stopword: 'Management' taken out of 'WITHOUT Cable Management Arm' does not place a rail kit", e.kind === "none", JSON.stringify(e));
  e = v("CCS-CABLE-MGMT=", "Content Sec Cable Management Arm for the x70 models", "Security Management Appliance (SMA)", ctxOf("security", "Security Management Appliance (SMA)"));
  check("SABOTAGE stopword: nor a Content Security cable-management arm the SMA", e.kind === "none", JSON.stringify(e));
  e = v("PRIME-ACC-REG", "Cisco Prime Access Registrar 7.X - Physical", "Prime Security Manager (PRSM) appliances", ctxOf("security", "Prime Security Manager (PRSM) appliances"));
  check("SABOTAGE stopword: 'Prime' is a brand — Access Registrar is not Security Manager", e.kind === "none", JSON.stringify(e));

  // AND THE WORD DELIBERATELY NOT STOPPED. `mini` would withdraw one bad proposal and CREATE a worse one: this upgrade kit is
  // claimed by BOTH "Room Kit (… Mini …)" on Mini and "Room Navigator and Touch 10" on Navigator, so the reverse scan sees two
  // winners and correctly HOLDS it. Stopping `mini` removes the RIGHT claimant and leaves the incidental one. Both claims are
  // asserted, because the hold only exists while both stand — this is the guard on a decision not to act.
  const upg = "Upgrade Kit for Webex Room USB to Webex Room Kit Mini (upgrade license, Webex Room Navigator)";
  e = v("CS-R-USB-UPG-BUN", upg, "Room Kit (Kit / Mini / Plus / Pro / EQ)", ctxOf("collaboration-endpoints", "Room Kit (Kit / Mini / Plus / Pro / EQ)"));
  check("SABOTAGE stopword: 'mini' is NOT stopped, so the Room Kit Mini upgrade kit is still claimed by Room Kit", e.kind === "name" && e.detail === "Mini", JSON.stringify(e));
  e = v("CS-R-USB-UPG-BUN", upg, "Room Navigator and Touch 10", ctxOf("collaboration-endpoints", "Room Navigator and Touch 10"));
  check("SABOTAGE stopword: and Room Navigator claims it too, which is what HOLDS it in shared parts", e.kind === "name" && e.detail === "Navigator", JSON.stringify(e));
}

console.log(`    layers standing: ${passed} passed, ${misses.length} missed (${REVIEWED.join(", ")})`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
