// src/core/deployRole.ts — layer 3 of the kind model: `deploy_role`, which population of a kind a part belongs to
// (kind-layer spec v2 §I.1, §III.2). A REGISTERED DERIVATION, never a guess: ordered SKU-token rules written from a
// hand-read of every live series of switch / ap / router / phone (III.0 item 3, docs/reports/kind-layer-III0-2026-09-13/
// III0-3-series-roles.md; 9,783 rows, 54 witnesses, 4 sabotaged rule lists). The rules key on SKU tokens and NOT on
// `series`: the live series label is wrong often enough to invert roles (Business 350 is SMB, "ASR 9000" holds no
// ASR 9000, "Catalyst Embedded Controller" holds outdoor APs). A part no rule places gets `null` — never a default.
//
// PARITY WITH III.0 ITEM 3 IS NO LONGER BYTE-FOR-BYTE (operator rulings, 13 Sep 2026). Over item 3's 9,783 rows
// (D:\tmp\kindlayer-III0\B\classified.json) this table now agrees on 9,780 and differs on exactly 3 — the three rows
// item 3 left null and the operator placed: WS-C4928-10GE -> datacenter (sw.dc.catalyst-tor), C8455-G2 and C8475-G2
// -> branch (rt.branch.c8400). The other rulings of that day reach rows OUTSIDE item 3's population (it read
// switches.switch, wireless.ap, routers.enterprise and collaboration-endpoints.phone only), 36 rows in the 3aff73b
// dump: HF6100-* 9 (data-center-networking) -> datacenter; the bare Meraki family rows MS120…MS390 11 -> access and
// MS410/MS425/MS450 3 -> core-agg, now that both Meraki rules are anchored with (-|$) (MS100 refused, MS15 never
// matched); AP1572EAC/EC/IC 3 -> outdoor; SPA302D* 7 (unified-communications) desk -> dect; SLINK-8744-* 3 -> wireless.
//
// Shape of every rule: { id, kind, re (tested against the upper-cased SKU after prefix stripping, or the raw
// SKU when `raw` is set), name (optional, tested against the name), role | issue, evidence }.
// A rule with `issue` says the row is NOT a member of the kind at all (a licence, a line card, an AP filed as
// a router): its role is null and it is reported as a kind issue, never as an unresolved role.
// Order matters: issues first, then roles, first match wins. No rule uses a word-boundary escape.

import { placePart } from "./productLine.js";

export type Rule = {
  id: string;
  kind: "switch" | "ap" | "router" | "sp-router" | "phone";
  re?: RegExp;         // tested against the normalised SKU (upper case, leading bundle prefixes removed)
  raw?: RegExp;        // tested against the upper-cased SKU exactly as stored
  name?: RegExp;       // tested against the part name
  role?: string;
  issue?: string;      // kind issue: what the row actually is
  evidence: string;
};

// Prefixes that wrap a product SKU without changing what it is: Cisco ONE, education, NAL, Russian
// white-label, 2D-barcode, Tetration, channel, VSS, VCE, promotion, SEED IT, Cisco ONE ATO.
export const STRIP = /^(C1-|EDU-|NAL-|PKB-|2D-|TA-|CH-|VS-|VCE-|PROMO-|PULS-|SI-|CONE-|FRC|A1C)/;

export function normalise(sku: string): string {
  let s = sku.toUpperCase().trim();
  for (let i = 0; i < 3; i++) {
    const t = s.replace(STRIP, "");
    if (t === s) break;
    s = t;
  }
  return s;
}

export const RULES: Rule[] = [
  // ============================== SWITCH (switches.switch) ==============================
  // ---- kind issues
  { id: "sw.issue.licence", kind: "switch", raw: /SERVICES1K9|^NDB-|^C1-[A-Z0-9]+-ADD(-M)?$|^C1-FLOW-|^R-ME3400E|^C4500X-(16P-)?IP-ES|^S9500ULPEK9|^C1-N(6001-64P-K9|56128-128PK9|5672-72P-K9|6004-12Q-K9)$/, issue: "licence/software", evidence: "N7K-SERVICES1K9 'Nexus 7000 Network Services', NDB-3.2 'Nexus Data Broker Version 3.2', C4500X-IP-ES 'upgrade license'" },
  { id: "sw.issue.upg-licence", kind: "switch", raw: /-UPG=?$/, name: /licen/i, issue: "licence/software", evidence: "N3K-16T-UPG= '16 Port Upgrade License'" },
  { id: "sw.issue.tracking", kind: "switch", raw: /^N7K-(DP-|DC-AGG|DC-CORE|DCI$|OTHER|CAMPUS)|^C6800-(CAMPUS|OTHER|DATA-CENTER)|^C6-MFG-TEST|^C9500X?-RFID|^IBM-SN-POINTER/, issue: "tracking/option PID (not a product)", evidence: "N7K-DP-CORE 'For Tracking Only', C6-MFG-TEST-SW1 'Test Only-Not for Customer Use', C9500-RFID-NONE" },
  { id: "sw.issue.mechanical", kind: "switch", raw: /-FDK$|-BSK=?$|SHPPKG|-LEDS=?$|-FD-TOP|^N7K-BSK|^WS-C6597|-V-E-CM$|ACCKIT|SHELF-KIST|^NXA-AIRFLOW|^CMICR-CLIP|^STK-RACKMOUNT|^QPP24|^CP24|^CPP24|NEB-UPGRD|^FERRITE|^LPNL-|^C6807-XL-PW|-NEBS-PAK$|^CMICR-BZL/, issue: "mechanical", evidence: "N77-C7702-FDK 'Front Door Kit', N7K-C7009-BSK 'Bottom Support Kit', NXA-AIRFLOW-SLV 'Airflow Extension Sleeve', CP24BLY '24-Port Patch Panel'" },
  { id: "sw.issue.power", kind: "switch", raw: /^WS-UPOE-12VPSPL|^C9K-ADPT|^C9K-80W-ADPT|^PWRADPT-|^PEM-|^N7K-DC-PIU|^N7K-AC-|^C6800-XL-PS-CONV|^[0-9]+WA?C?(-P)?$|^C14-C15$/, issue: "power", evidence: "C9K-80W-ADPT 'AC-DC slim power adapter', PEM-20A-AC+ 'PwrEntryMod', 715WAC placeholder" },
  { id: "sw.issue.cabling", kind: "switch", raw: /^P[A-Z]{1,3}6[A-Z0-9]{3,}|^STP28|^UTP28|^CJS?6X88|^FPUD6|^FPS6X88|^16AWG$/, issue: "cable/cabling accessory (third-party PNs)", evidence: "PUP6AV04BU-G, STP28X1MBU, CJ6X88TGBU — placeholder rows filed under Catalyst 9300" },
  { id: "sw.issue.component", kind: "switch", raw: /^X9[0-9]{3}|^X9[67][0-9]{3}|^N5696-M4C|^N5600-M12Q|^N6K-C6004-M12Q|^N6004X-M20UP|^N55-D|^C6800-(48P|8P|16P|32P)|^C6880-X-16P10G|^C3KX-SM|^CAT-3KX-10G-SM|^RSP720|^BF-S720|^WS-C6K-VTT|^WS-IPSEC-3|^WS-SSC-|^7600-SSC|^WS-6148|^C9350-NIM|^76-ES|^C6800-SVE-BB|^WS-C6K-CL|^WS-IPSEC-SSC600/, issue: "linecard/module/supervisor", evidence: "X9736C-FX (N9500 line card), C6800-48P-TX 'Linecard', RSP720-3C-10GE, C3KX-SM-10G 'Service Module'" },
  { id: "sw.issue.upgrade-bundle", kind: "switch", raw: /^C4500E-|^C4500RE-|^C4500-10R-|^C4510RE-S[0-9]-(DEFAULT|MGIG|UPOE)/, issue: "supervisor/linecard upgrade option (no chassis)", evidence: "C4500E-7R-S8E-MGIG 'SUP8E and MGIG upgrade for 7 slot chassis bundle', C4500E-S7-DEFAULT 'Default WS-X45-SUP7-E with WS-X4748-RJ45V+E Bundle'" },
  { id: "sw.issue.optic", kind: "switch", raw: /^ONS-S[EI]|^WSP-Q40G|^WS-G5483|^XR-10GB|^GLE-GE|^10GBASE-|^1000BASE-|^MGBBX1$/, issue: "transceiver", evidence: "ONS-SI+-10G-SR= 'SFP+ SR - Industrial Temp', WS-G5483= '1000BASE-T GBIC'" },
  { id: "sw.issue.router", kind: "switch", raw: /^76(0[3-9]|13)S?-/, issue: "router (Cisco 7600)", evidence: "7606S-S32-10G-B-P 'Cisco 7606S Chassis, 6-slot, SUP32'" },
  { id: "sw.issue.wireless", kind: "switch", raw: /^AIR-(AP|BR)1[0-9]{3}|^CWWLSE/, issue: "access point / WLSE", evidence: "AIR-AP1242AG 'Aironet 1240AG Series access point', AIR-BR1310G" },
  { id: "sw.issue.compute", kind: "switch", raw: /^IC3000/, issue: "industrial compute", evidence: "IC3000-2C2F-K9++ 'Industrial Compute appliance'" },
  // ^ENC-10G-ONT (layers round 3, 15 Sep 2026, operator: an ONT device filed in interfaces-modules goes to switches Catalyst PON
  // "with the same kind and flag as CGP-ONT"): the six Cisco 10G Routed PON ONT rows, planned in; they carry the flag on arrival.
  { id: "sw.issue.ont", kind: "switch", raw: /^CGP-(ONT|OLT)|^ENC-10G-ONT/, issue: "PON ONT/OLT (PON equipment, not an Ethernet switch)", evidence: "CGP-ONT-4TVCW-x 'Catalyst PON 4-port GPON ONT, 2 POTS RJ11, 1 CATV Coax, 1 Wi-Fi', ENC-10G-ONT-10= 'XGS-PON ONT'" },
  { id: "sw.issue.fc", kind: "switch", raw: /^DS-C9/, issue: "Fibre Channel switch/director (storage-networking)", evidence: "DS-C9148V-24EK9 'MDS 9148V 64G Fibre-Channel-Switch', DS-C9710 'MDS 9710 Multilayer-Director'" },
  { id: "sw.issue.placeholder", kind: "switch", raw: /^(IPV6|SNMPV1|G\.652\/-|LAN-PHY|OTN\/G\.709|VBR-RT|0\.6-1\.2A|0\.75K|0\.375K|0\.875K|10RU|E100|E104|K100|B3220L?|B3240|B3140H|LS6400GX|LS1800FX3?|S6400|ASE2|9300-GX2A\/B|2960-S\/SF|2960-XR?|974[0-9]{2}|CBS110|CBS220|CBS250|CBS350|IE9300|IE3400|IE3100|C9350)$/, issue: "datasheet cell / bare family name (not a PID)", evidence: "'Cisco IPv6', 'Cisco 0.75K', 'Cisco 97436', 'Cisco CBS220', 'Cisco LS1800FX'" },
  // ---- roles
  { id: "sw.smb.cbs-sb", kind: "switch", re: /^CBS(110|220|250|350)-|^S[FGX](95|110|112|200|220|250|300|302|350|352|355|500|550)[A-Z]{0,2}-|^C1[23]00X?-|^C130024MGP/, role: "smb", evidence: "CBS350-16P-E-2G 'CBS350 Managed 16-port GE', SG250-08 '8-Port Gigabit Smart Switch', C1300-48P-4X 'Catalyst-1300-Managed-Switch (L3)', C1200-8T-E-2G '(L2, Linux)'" },
  { id: "sw.access.catalyst", kind: "switch", re: /^(WS-?)?C?(2960|3560|3750|3650|3850)|^C9200|^C9300|^C9350|^C1000|^WS-2960|^CDB-|^CMICR-|^CATALYST-3[68]50|^CS-PANO-SWITCH|^CTS-5K-[A-Z]+-SWITCH|^C6800IA/, role: "access", evidence: "C9300-48H-A 'Catalyst 9300 48-port 1G copper', WS-C2960X-24PS-L, C1000-24P-4X-L '(L2, IOS)', CMICR-4PT 'Catalyst-Micro', C6800IA-48FPD 'Instant Access POE+ Switch', CS-PANO-SWITCH+ 'Room Panorama Cisco Catalyst 3560-CX'" },
  // kind-layer operator rulings (13 Sep 2026): the Meraki MS rules are anchored with (-|$), so the bare family rows the
  // meraki category holds ("Cisco MS120", "Cisco MS425") are placed like their PIDs. MS100 is REFUSED by name: no MS100
  // switch exists (the row is "Cisco MS100", no document) — and MS15 is two digits, which the rule never matched.
  { id: "sw.access.meraki", kind: "switch", re: /^MS(1(?!00(-|$))[0-9]{2}|2[0-9]{2}|3[0-9]{2})R?(-|$)/, role: "access", evidence: "MS120-48-HW 'cloud-gemanagter Layer-2-Access-Switch', MS390-48-HW 'Layer-3-Access-Switch'" },
  { id: "sw.access.metro", kind: "switch", re: /^ME-?3400|^B-3400EG|^ME-3600X/, role: "access", evidence: "ME-3400E-24TS-M 'ME3400E Ethernet Access switches', ME-3600X (Ethernet Access) — metro access; too few rows to justify service-provider-access" },
  { id: "sw.coreagg.meraki", kind: "switch", re: /^MS4[0-9]{2}(-|$)/, role: "core-agg", evidence: "MS410-32-HW 'Layer-3-Aggregations-Switch', MS425-16-HW, MS450-12-HW" },
  { id: "sw.coreagg.catalyst", kind: "switch", re: /^(WS-?)?C?45[0-9]{2}|^WS-?C?4500X|^ME-450[67]E|^WS-?450096V|^C94(04|07|10)R|^C96(06|10)R|^C9500|^C9550|^(WS-)?C65[0-9]{2}|^C6807|^6807-|^C68(16|24|32|40|80)-X|^ME-3800X|^ME-4924/, role: "core-agg", evidence: "C9500-48Y4C, C9407R 'Modularer Campus-Switch-Chassis', WS-C4510R+E chassis, C6880-X 'L3-Aggregations-Switch', C6832-X-LE 'L3-Backbone-Switch', ME-4924-10GE" },
  { id: "sw.dc.catalyst-tor", kind: "switch", re: /^WS-C49(48|00M|28)/, role: "datacenter", evidence: "WS-C4948E 'Catalyst 4948E, 48-Port 10/100/1000+ 4 SFP+' — 4948/4948E/4900M are Cisco's top-of-rack server-access Catalysts; WS-C4928-10GE 'Catalyst 4928, 28x 1GBase-X SFP, 2x 10GBase-X X2' joins by operator ruling 13 Sep 2026 (item 3 left it null)" },
  // kind-layer operator ruling (13 Sep 2026): the Nexus Hyperfabric HF6100 switches (9 rows, filed in data-center-networking).
  { id: "sw.dc.hyperfabric", kind: "switch", re: /^HF6100-/, role: "datacenter", evidence: "HF6100-32D 'Cisco Hyperfabric switch, 32x400Gbps QSFP-DD', HF6100-60L4D-S 'Cisco 6000 Hyperfabric switch, 60x50G SFP56 4x400G QSFP-DD'" },
  { id: "sw.dc.nexus", kind: "switch", re: /^N[2-9]K-|^N77-|^N[3-9][0-9]{3}|^N35-|^N9300-|^ACI-|^9364E|^N9KC|^C9[23][0-9]{3}[A-Z]{1,2}-/, role: "datacenter", evidence: "N9K-C93180YC-FX 'Data-Center-Switch (NX-OS, L3)', N5K-C5672UP, N77-C7706 'modulares Data-Center-Chassis', N9364E-SG2-Q 'N9300 64p 800G switch'" },
  { id: "sw.industrial", kind: "switch", re: /^IE-?[0-9]|^CGS-?2520|^ESS-/, role: "industrial", evidence: "IE-3400H-16T-E 'lüfterloser IP67 Layer-3-Industrie-Switch', CGS-2520-24TC, ESS-3300-CON-E 'mainboard, with cooling plate'" },

  // ============================== AP (wireless.ap) ==============================
  { id: "ap.issue.sensor", kind: "ap", raw: /^AIR-AP1800S/, issue: "network sensor (not an AP)", evidence: "AIR-AP1800S-R-K9 'Cisco Aironet 1800S Series Network Sensor'" },
  { id: "ap.issue.wlc", kind: "ap", raw: /^AIR-5508/, issue: "wireless LAN controller", evidence: "AIR-5508H-HA-K9 'Cisco 5508 Series Wireless Ctlr for HA'" },
  { id: "ap.issue.mechanical", kind: "ap", raw: /_COVER=?$|^AIR-AP1131-STAND|^AIR-AP1140RETROMT/, issue: "mechanical", evidence: "C9105AXWT_COVER= 'C9105 Wall Plate teleworker Cradle Kit', AIR-AP1131-STAND= 'AP 1130 Table Top Stand'" },
  { id: "ap.issue.starter-kit", kind: "ap", raw: /^CBW140MXS/, issue: "bundle of AP + mesh extenders (mixed roles)", evidence: "CBW140MXS-A-NA 'CBW140 Cisco Business Mesh Starter Kit'" },
  { id: "ap.industrial.aironet1552", kind: "ap", re: /^AIR-CAP1552(H|SA|SD|WU)/, role: "industrial", evidence: "AIR-CAP1552H-A-K9 'Outdoor Mesh Access Point, Haz. Loc.', AIR-CAP1552SD-K-K9 'ISA100, WiHART, DC', AIR-CAP1552WU-N-K9 'w/WiHartGateway, DC'" },
  { id: "ap.industrial.iw", kind: "ap", re: /^IW-?6300|^ESW-6300|^IW-?3702|^IW-?916[57]/, role: "industrial", evidence: "IW-6300H-DCW-D-K9 'Industrial Wireless AP 6300, DC Wide range, Hazloc', ESW-6300-CON-R-K9 'Embedded Wireless AP 6300, DC input', IW3702-2E-Q-K9" },
  { id: "ap.outdoor.aironet", kind: "ap", re: /^AIR-CAP1552(E|EU|I|C|CU)|^(AIR-)?AP15[4-7]2/, role: "outdoor", evidence: "AP1572EAC / AP1572EC / AP1572IC (bare family rows, operator ruling 13 Sep 2026),AIR-AP1562I-A-K9 'Low-Profile Outdoor AP', AIR-AP1572EAC-D-K9 '802.11ac Outdoor AP', AIR-AP1542D 'Value Outdoor AP', AIR-CAP1552C-E-K9 'Outdoor Mesh Access Point Cable Modem'" },
  { id: "ap.outdoor.catalyst", kind: "ap", re: /^C9124AX|^CW9163|^CW9177|^MR(76|78|86)(-|$)|^WAP571E/, role: "outdoor", evidence: "C9124AXD-EWC-R 'Wi-Fi 6 Outdoor AP w/EWC', CW9163E-x 'Catalyst 9163E Outdoor Access Point', WAP571E-N-K9 'Dual Radio Outdoor Wireless Access Point', MR76/MR86 (Meraki outdoor)" },
  { id: "ap.mesh.cbw", kind: "ap", re: /^([35]-)?CBW14[123]ACM|^CBW14[12][A-Z]-[A-Z]{2}-?D?MULTI/, role: "mesh-extender", evidence: "CBW141ACM-D-IN 'Mesh Extender Desktop', CBW142ACM-Z-AU 'Mesh Extender Wall Outlet', CBW142S-EU-MULTI 'BOM Level CBW142ACM Bulk PID', 3-CBW141ACM-F-EU 'Wireless Extender-Desktop-3 Packs'" },
  { id: "ap.smb.cbw-wap", kind: "ap", re: /^([35]-)?CBW(140|145|150|240)A|^WAP(121|125|150|361|371|571|581)(-|$)/, role: "smb", evidence: "CBW140AC-B 'CBW140AC 802.11ac 2x2 Wave 2 Access Point', CBW150AX 'Cisco Business 150AX Wi-Fi 6', WAP125 'Dual Band Desktop Access Point', WAP571 'Premium Dual Radio'" },
  { id: "ap.indoor.aironet", kind: "ap", re: /^KAISER-12PACK|^(AIR-?|PPN-)?(AP|OEAP|CAP)?(3802|2802|4800|1852|852I|1832|1830|1815|1810W|1810|1800I|1840|1802|37IBO|27IBO)|^AIR-AP(3800|2800|4800|1850|1815|1840)|^AP(3800|2800|4800|1850|1815|1840)-/, role: "indoor", evidence: "AIR-AP3802I-EK910 '802.11ac W2 AP; Int Ant', AIR-AP1815W 'Aironet 1815w', AIR-OEAP1810 'OfficeExtend AP', PROMO-AP3800-R-K9 'AP3800 Promotion', KAISER-12PACK-BNDL '12 Pack of AP3802I'" },
  { id: "ap.indoor.catalyst", kind: "ap", re: /^C9(105|115|117|120|130|136)|^CW91(62|64|66|7[12468]|79)|^MR(36|44|46|56|57)[A-Z]?(-|$)/, role: "indoor", evidence: "C9120AXI-S 'C9120AX Internal 802.11ax', C9130AXE-STA-I 'w/Stadium Antenna', C9105AXWT 'Teleworker', CW9166I 'Wi-Fi 6E, internal antennas', CW9178I 'Wi-Fi 7', MR46-HW 'Meraki MR46 Wi-Fi 6 Indoor AP'" },

  // ============================== ROUTER (routers.enterprise) ==============================
  { id: "rt.issue.licence", kind: "router", raw: /^S-XR-|^S-NC6-|^S-ASR920-|^SPNA-|^SPOA-|^SPAOA-|^SPAUTO-|^NRS-WAE|^WAE[A-Z]|^QW-E-|^CISCO-MATE|^CP-SW-SBP|^CN-BNG-|^XRD-VR-|^8K-SW-|^ADN-PRM-|^ESS-ADN-|^FL-SRE-|^SRE-WLC|^ISR-CCP-|^VIPTELA-OS-|^OEM-PRI-|^CVO[0-9A-Z]*-CFG|^FW-VA-|^PACK-800|^PPN-|^C1-ISR-(UPG|ADD)|^C1-ASR1K-(ADD|UPG)|^ROUT-P-|^CDASR1000-|^SA1K|^INDUSTRYOPTIO|^PNPOPTION|^SOLUTIONOPTIO|^TG-OS-|^SO-TG-TRK|^C8000V-PF|^CISCO5921-K9|^3G-(CDMA|EVDO)-|^AIR-AP1815-K9-ME-|^FW-(MC)?7[0-9]{3}M?-LTE|^A4_|^E\.67|^L7D6|^R4\.|^C8[23]00-UCPE-PF|^ENCS5400-PF|^SI-ISR4K-IWAN/, issue: "licence/software/planning PID", evidence: "S-XR-BNG-1M 'Billing PID for SBP XRV9K', SPNA-AUTO-WAE 'WAE Advantage', VIPTELA-OS-204 'Viptela OS versions 20.4', ISR-CCP-EXP 'Config Pro Express', FL-SRE-WLC-25 'access point license'" },
  { id: "rt.issue.licence-name", kind: "router", raw: /^CG113-/, name: /DNA On-Prem Lic/, issue: "licence/software/planning PID", evidence: "CG113-4GW6x 'Cisco DNA On-Prem Lic for Remote-worker gateway'" },
  { id: "rt.issue.component", kind: "router", raw: /^MC[0-9]{4}|^MC-3G|^PCEX-3G|^D-LTE|^LTE-SIM|^P-LPWA|^LPWA-GPS|^CGR-BATT|^CGR-N-CONN|^CGR-SLOT-DIVIDER|^DB(25|9)-|^RJ45-D[CT]E|^OBD2-|^AIR-ACC|^IR800-IL-POE|^E100S-CON|^2911-AIRCVTR|FIPS-SHIELD|^XRV-PCIE|^UCSC-|^UCSX-|^IR-BAND$|^IOT-LA-NM|^CGR2010\/NFR/, issue: "module/modem/accessory", evidence: "MC7304-4G-LTE-GA 'Sierra MC7304 Global LTE', PCEX-3G-HSPA '3.5G Modem', D-LTE 'CAT4 LTE Dongle', P-LPWA-800 'LoRaWAN PIM', CGR-BATT-4AH, OBD2-J1939Y1-MF4, FIPS-SHIELD-1900 'FIPS opacity shield'" },
  { id: "rt.issue.linecard", kind: "router", raw: /^100GE-MSC|^10GE-(EMSE|FP|MSC)/, issue: "line card bundle (CRS)", evidence: "10GE-MSC400G-BUN 'Cisco CRS Series 40x10GE MSC Bundle'" },
  { id: "rt.issue.optic", kind: "router", raw: /^ONS-C2/, issue: "transceiver", evidence: "ONS-C2-WDM-DE-1HL '200G, 100G, WDM Digital CFP2 pluggable'" },
  { id: "rt.issue.appliance", kind: "router", raw: /^ENCS5|^C8300-UCPE|^C8200-UCPE|^C83UCPE|^ASR-XRV9000|^XRV9000-APLN|^C1100TGX?-|^C8220TG-/, issue: "appliance (uCPE compute / XRv appliance / terminal server)", evidence: "ENCS5412/K9 'ENCS 5412 (12-core Intel, 16G DRAM)', C8300-UCPE-1N20 '8300-uCPE Edge Series (20-core Intel)', XRV9000-APLN-ROUT 'XRV 9000 Appliance with UCS-C220 M5', C1100TG-1N32A 'Terminal Services Gateway w/ 32 Async'" },
  { id: "rt.issue.switch", kind: "router", raw: /^CQ211L01|^WS-C65/, issue: "switch", evidence: "CQ211L01-48H8FH 'Switch, 48 x 100G DSFP + 8 x QSFP-DD', WS-C6509-E-VPN+-K9WS- (Catalyst 6509 chassis bundle)" },
  { id: "rt.issue.wlc", kind: "router", raw: /^9800-(40|80)$/, issue: "wireless LAN controller", evidence: "9800-40 / 9800-80 placeholders" },
  { id: "rt.issue.ap", kind: "router", raw: /^CW917|^IW916[57]|^IOTOD-IW/, issue: "access point", evidence: "CW9177I 'Cisco Wireless 9177 Outdoor Access Point, Wi-Fi 7', IW9167EH-x 'Industrial Wireless 9167E, 11ax 6E AP'" },
  { id: "rt.issue.placeholder", kind: "router", raw: /^(1FXO|1ISDN|2BRI|ABLT-[DF]|ADSL2|ADSL2\+|ADSL2\+M|ADSL2\/2\+|ATU-32C|ATU-C|EDN312X[IP]|H561SHEA|SDFE-[24]|SOCRATES-4E|V\/ADSL2|VDSL2|1MFT-G703|1V\/2V\/2VE|2BRI-NT\/TE|2FXS-E\/DID|2MFT-T1\/E1|3FXS\/4FXO|4FXO|4FXS\/DID|6FXO|8FXS|G703|H\.323|HD-1V\/2V\/2VE|HDV2|T1\/E1(-DI)?|RS-232|RS-449|V\.35|X\.21|RE-ADSL2|IP20|MCS[0-9]+|CAT[0-9]+|P100|P200|Q100|Q200|DNP3|NA\/(250|50)M|NE\/(250|50)M|CP-DQPSK|V6-INLN|VSLN-PP-[A-Z0-9]+|VTMS-PP-[0-9]+G(-M)?|CISCOUTM[12]100)$/, issue: "datasheet cell / unidentifiable bundle (not a router PID)", evidence: "'Cisco 1FXO', 'Cisco VDSL2', 'Cisco MCS0' … 'Cisco MCS31', 'Cisco CAT18', 'Cisco P100', 'Cisco VSLN-PP-CORE', CISCOUTM1100 'Unified Threat Management 1100 Bundle'" },
  { id: "rt.smb.rv", kind: "router", re: /^RV[0-9]{3}|^CVR328W|^R260P?-/, role: "smb", evidence: "RV340-K9 'Cisco RV340 Dual WAN Gigabit VPN Router', RV160W-A-K9 'Wireless-AC VPN Router', CVR328W-K9 'Wireless-N 3G VPN Router'" },
  { id: "rt.iot.ir-cgr", kind: "router", re: /^IR[0-9]{3,4}|^IXM-|^CGR-?[0-9]{4}|^CG(418|522)-|^CISCO59[0-9]{2}|^ESR-6300|^C819H/, role: "industrial-iot", evidence: "IR829GW-LTE-GA-EK9 '829 Industrial ISR', IR1821-K9 'Catalyst IR1821 Rugged', IR510-OFDM-FCC/K9 'WPAN router', CGR1240/K9, IXM-LPWA-800-K9+ 'wireless gateway for LoRaWAN', CISCO5940RC-K9 'ESR conduction-cooled card', ESR-6300-CON-K9, CG522-E 'Cellular Gateway, 5G Sub6', C819HG-4G-G-K9 'C819 Hardened 4G LTE'" },
  { id: "rt.edge.asr-8500", kind: "router", re: /^ASR1[0-9]{3}|^ASR1K|^CUBESP-AP|^C85[0-9]{2}|^C8650|^7206VXR|^76(0[3-9]|13)S?-/, role: "edge", evidence: "ASR1002X-36G-K9, ASR1001-HX 'Router Chassis (ESP integrated)', C8500-12X4QC 'Catalyst 8500 Series 12-port SFP+', C8650-G2 '8600 Secure Router with 20x10GE, 6x100GE', 7206VXRG2/2+VPNK9, 7609-VPN+-K9" },
  // kind-layer operator ruling (13 Sep 2026): the two C8000-G2 rows item 3 left null ("branch or edge") are branch.
  { id: "rt.branch.c8400", kind: "router", re: /^C84[57]5-G2/, role: "branch", evidence: "C8455-G2 'Cisco 8400 Secure Router with 8x1GE, 2x10GE, 2x25GE', C8475-G2 — operator ruling 13 Sep 2026: branch (item 3 left both unresolved)" },
  { id: "rt.branch.cg113", kind: "router", re: /^CG113-/, role: "branch", evidence: "CG113-4GW6E 'Cisco Catalyst Wireless Gateway, WiFi6, 4G LTE' (remote-worker / small-branch desktop gateway; no rugged or IP-rated variant)" },
  { id: "rt.branch.isr", kind: "router", re: /^C8[0-9]{2}(?![0-9])|^CISCO8[0-9]{2}|^8[0-9]{2}[A-Z]*(-|$)|^IAD888|^C9[0-9]{2}J?(?![0-9])|^C11[0-9]{2}|^ISR1100|^C1[89][0-9]{2}|^CISCO1[89][0-9]{2}|^C2[89][0-9]{2}|^CISCO2[89][0-9]{2}|^2[89][0-9]{2}-|^SPIAD29|^C3[89][0-9]{2}|^CISCO3[89][0-9]{2}|^ISR4[0-9]{3}|^CISCO4[0-9]{3}|^C8200|^C8[23]L?-|^C8300-[12]N|^C81[3-6][0-9]|^C82[0-5][0-9]|^C83[57]5/, role: "branch", evidence: "C897VA-K9 'Cisco 897VA Gigabit Ethernet security router', C1111-8P 'ISR 1100 8 Ports', CISCO2911/K9, ISR4331/K9, C921-4P 'Cisco 900 Series ISR', C8300-1N1S-6T 'Catalyst 8300 Edge platform', C8211-G2 '8200 Secure Router with 6x1GE', C8355-G2 '8300 Secure Router'" },

  // ============================== PHONE (collaboration-endpoints.phone) ==============================
  { id: "ph.issue.component", kind: "phone", raw: /-BEZEL|-HS-HOOK|-HS$|^CP-6900-[LM]HS|^CP-6901-MHS|^DP-9800-HS|^CP-8831-DC|^CP-8831-MIC|^CP-8832-DC|^CP-8832-ETH|^CP-8832-POE|^CP-8832-USB|^CP-8832-MIC|^CP-800-USBCH|^CP-840-PH-MCHR|^CP-860-MCHR|^CP-840S-HANDLE|^WP-9821-BATTDOOR|^CP-8831-BASE|^CP-8831-3PB|^CP-6825=?$/, issue: "phone accessory / spare part", evidence: "CP-8800-B-BEZEL 'Spare Black Bezel', CP-6821-HS 'Spare Narrowband Handset', CP-8832-MIC-WLS 'Wireless Microphone Kit', CP-860-MCHR 'Multi-Charger Base', CP-8831-DCU 'Display Control Unit', CP-6825 'Handset Cradle'" },
  { id: "ph.issue.expansion", kind: "phone", raw: /^CP-791[456]/, issue: "expansion module", evidence: "CP-7914 '14-button key expansion module', CP-7916 'Color Expansion Module'" },
  { id: "ph.issue.subscription", kind: "phone", raw: /-MK9$/, issue: "subscription (licence)", evidence: "CP-8865-3PW-NA-MK9 'MLB Subscription - Phone 8865'" },
  { id: "ph.conference", kind: "phone", re: /^CP-793[5-7]|^CP-7832|^CP-883[12]|^CP-ROOM/, role: "conference", evidence: "CP-7832-K9 'IP Conference Phone 7832', CP-8832-K9 'IP Conference Phone 8832 base', CP-8831-K9 '8831 Base/Control Panel', CP-7935 'IP Conference Station 7935', CP-ROOM-C-K9 'Webex Room Phone'" },
  { id: "ph.wireless", kind: "phone", re: /^CP-792[0-6]|^CP-8821|^CP-8[46]0S?-|^WP-9821|^SLINK-/, role: "wireless", evidence: "CP-8821-K9 'Unified Wireless IP Phone 8821', CP-7925G-A-K9 'Cisco 7925G FCC; Battery', CP-860-K9 'Cisco 860 Worldwide Phone and Battery', WP-9821-K9; SLINK-8744-NA= (Spectralink 8744 Wi-Fi handset, operator ruling 13 Sep 2026)" },
  // kind-layer operator ruling (13 Sep 2026): SPA302D is the Small Business DECT handset ("Mobility Enhanced Cordless
  // Handset", SPA302DKIT "Multi-Line DECT Handset with Base Station"), which ph.desk's ^SPA[35]nn used to take.
  { id: "ph.dect", kind: "phone", re: /^CP-682[35]|^SPA302D/, role: "dect", evidence: "CP-6825-3PC-UK-K9 'IP DECT 6825, Standard Handset, Battery, Cradle', CP-6823-3PC-BUN 'IP DECT 6823 Handset and Single-Cell Basestation', SPA302DKIT-G1 'Multi-Line DECT Handset with Base Station'" },
  { id: "ph.desk", kind: "phone", re: /^CP-79[0-9]{2}|^CP-78[0-9]{2}|^CP-88[0-9]{2}|^CP-69[0-9]{2}|^CP-68[0-9]{2}|^CP-39[0-9]{2}|^DP-98[0-9]{2}|^SPA[35][0-9]{2}/, role: "desk", evidence: "CP-8865-K9 'Cisco IP Phone 8865, Charcoal', CP-7841-K9, DP-9861-K9 'Cisco Desk Phone 9861', CP-6851-3PCC-K9, SPA504G '4 Line IP Phone With Display, PoE'" },
];


// ---- the derivation ----------------------------------------------------------------------------------------------

/** The role domain of every kind that carries a role axis (spec v2 §I.4 ROLE axis). A kind not listed has no roles. */
export const ROLE_DOMAINS: Readonly<Record<Rule["kind"], readonly string[]>> = {
  switch: ["smb", "access", "core-agg", "datacenter", "industrial"],
  ap: ["indoor", "outdoor", "industrial", "smb", "mesh-extender"],
  router: ["branch", "smb", "edge", "industrial-iot"],
  // layers review 14 Sep 2026 (item 6): the service-provider router kind (was `sp-core`) carries its own axis. It has NO
  // SKU rules in RULES: every role comes from the series table in data/reference/product-lines/cisco-routers.json —
  // sp-access ASR 901/903/907/920, NCS 520/540/560, NCS 4200; sp-edge ASR 9000, NCS 5500/5700; sp-core CRS, 8000, NCS 6000.
  "sp-router": ["sp-access", "sp-edge", "sp-core"],
  phone: ["desk", "wireless", "dect", "conference"],
};

/**
 * Which rule table a (category, kind) reads. One noun, one table, across categories (rule 3): a Meraki MS switch is
 * placed by the switch rules, a UC phone by the phone rules, the Nexus rows still in data-center-networking by the
 * switch rules. `enterprise` and `router` both map, so the rename can land without a window where routers lose roles.
 */
const AXIS: Readonly<Record<string, Rule["kind"]>> = {
  "switches|switch": "switch", "data-center-networking|switch": "switch", "meraki|switch": "switch",
  "wireless|ap": "ap", "meraki|access-point": "ap",
  "routers|enterprise": "router", "routers|router": "router", "routers|sp-router": "sp-router",
  "collaboration-endpoints|phone": "phone", "unified-communications|phone": "phone",
};

export function roleAxisOf(category: string, kind: string | null | undefined): Rule["kind"] | null {
  return kind ? AXIS[`${category}|${kind}`] ?? null : null;
}

export type RoleResult = { role: string | null; rule: string | null; issue: string | null };

/** First matching rule of the axis wins; an `issue` rule means the row is not this kind (role null, issue named). */
export function deployRoleRule(axis: Rule["kind"], sku: string, name: string | null | undefined, rules: readonly Rule[] = RULES): RoleResult {
  const S = normalise(sku);
  const R = sku.toUpperCase().trim().replace(/=+$/, "");
  for (const r of rules) {
    if (r.kind !== axis) continue;
    if (!r.raw && !r.re && !r.name) continue;
    if (r.raw && !r.raw.test(R)) continue;
    if (r.re && !r.re.test(S)) continue;
    if (r.name && !r.name.test(name ?? "")) continue;
    return { role: r.issue ? null : r.role ?? null, rule: r.id, issue: r.issue ?? null };
  }
  return { role: null, rule: null, issue: null };
}

/** The product-line file that holds each axis's SERIES -> ROLE table (data/reference/product-lines/cisco-<category>.json). */
const SERIES_TABLE_OF_AXIS: Readonly<Record<Rule["kind"], string>> = { switch: "switches", ap: "wireless", router: "routers", "sp-router": "routers", phone: "collaboration-endpoints" };

/**
 * The derived `deploy_role` of one part, or null (no role axis for its kind, a kind issue, or no rule places it).
 *
 * ONE TABLE (reviewer, switches layers review 14 Sep 2026, item 8): the series -> role table in the product-line file is
 * read FIRST, so the layers page and the cup engine cannot disagree. Order: an ISSUE rule of this module still wins (the
 * row is not this kind: role null, exactly as before); then the role of the series the part's SKU or name places it in;
 * then this module's own rules for a part no series rule places (or a series with no role, such as shared parts).
 */
export function deployRole(category: string, kind: string | null | undefined, sku: string, name?: string | null): string | null {
  return deployRoleResult(category, kind, sku, name).role;
}

export function deployRoleResult(category: string, kind: string | null | undefined, sku: string, name?: string | null): RoleResult {
  const axis = roleAxisOf(category, kind);
  if (!axis) return { role: null, rule: null, issue: null };
  const legacy = deployRoleRule(axis, sku, name);
  if (legacy.issue) return legacy;
  const table = SERIES_TABLE_OF_AXIS[axis];
  const placed = placePart("cisco", table, { sku, name });
  const seriesRole = placed && placed.line !== "(not this category)" && "role" in placed ? placed.role ?? null : null;
  if (placed && seriesRole) {
    if (!ROLE_DOMAINS[axis].includes(seriesRole)) {
      // One file holds the series of two axes (routers: `router` and `sp-router`). A role in NO axis of this table is a
      // mapping-file error and stops the engine. A role of the SIBLING axis is a disagreement between the part's kind and
      // the series its SKU names (an enterprise-kind row in an SP series): it is reported as a kind issue with no role,
      // never silently given a role its kind cannot carry.
      const siblings = (Object.keys(SERIES_TABLE_OF_AXIS) as Rule["kind"][]).filter((a) => SERIES_TABLE_OF_AXIS[a] === table);
      if (!siblings.some((a) => ROLE_DOMAINS[a].includes(seriesRole)))
        throw new Error(`series "${placed.series}" in ${table} carries role "${seriesRole}", outside the ${siblings.join("/")} domain`);
      return { role: null, rule: `series:${placed.series}`, issue: `kind ${kind} in series "${placed.series}", whose role ${seriesRole} belongs to another kind` };
    }
    return { role: seriesRole, rule: `series:${placed.series}`, issue: null };
  }
  return legacy;
}
