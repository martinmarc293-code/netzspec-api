// Item 6: every unresolved kind by family, with the kind each family should get. Rules written after reading every row.
// First matching rule wins. `ph` = the name is the store's placeholder "Cisco <sku>" (no description ever acquired).
import { readFileSync, writeFileSync } from "node:fs";
const parts: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/parts.json", "utf8"));
type P = { sku: string; name: string; held: string; series: string; ph: boolean };
type Rule = [string, (p: P) => boolean, string];
const S = (re: RegExp) => (p: P) => re.test(p.sku);
const N = (re: RegExp) => (p: P) => re.test(p.name);
const or = (...f: ((p: P) => boolean)[]) => (p: P) => f.some((g) => g(p));

// A token that is not a Cisco PID: a datasheet cell or fragment enumerated as a part. Only ever applied to placeholder-named rows.
const CELL = (p: P) => p.ph && (/^[0-9]/.test(p.sku) || /\//.test(p.sku) || /=[0-9]/.test(p.sku) || /^(E3\.S|NL-SAS|CAT64|AMD9575F|G4\/5|I\/3G|C13\/C14|L6-20|H200-NVL|NVL-H200|A100|Two-CPU|UTP\/RJ45|RJ45|BS1363|CX6Lx|TOOL-LESS|UPI1|X-FABRIC|S132|P5620|PRO-|NCP-C|A16-\d+A|M84-4P|MP232-R|EL224-C19|PSJD\d|UCSD\d|UCWD\d|VSCC15|SST-PP|FNVMEX4|DCN-FGLB-XF3|MINT-COMPUTE|COMPUTE-AI|COMPUTE-OTHER|UCS-X-AAS|X9508|XE150c|M7\/M8|M5\/M6\/M7\/M8|CRS-DG|DATA-DG|FRA-DG|REDO-DG|40zGBASE-SR4|IMM-MANAGED|ISM-MANAGED|UMM-MANAGED|NTNX-HCI|NTNX-NUS|HCO-EXTSTG-IMM|HCO-HCI-IMM)$/.test(p.sku));

const RULES: Record<string, Rule[]> = {
  "wireless.other": [
    ["FLMESH-HW-ACC-n Fluidmesh hardware accessory (placeholder names)", S(/^FLMESH-HW-ACC-/), "genuinely unknown — needs a description (accessory numbers only)"],
    ["Fluidmesh antennas FM-OMNI/PANEL/SECTOR/SHARK/PUCK", S(/^FM-(OMNI|PANEL|SECTOR|SHARK|PUCK)/), "antenna [J: from SKU words; names are placeholders]"],
    ["Fluidmesh PoE injectors FM-POE", S(/^FM-POE/), "power-injector [J]"],
    ["Fluidmesh RF adapters/attenuator/splitter/surge", S(/^FM-(QMA2SMA|RPSMA2RPSMA|ATT|SPLITTER|SURGE)/), "accessory (RF) [J]"],
    ["Fluidmesh mounts/shields/tube", S(/^FM-(WMOUNT|SHIELD|TUBE)/), "mechanical [J]"],
    ["Fluidmesh radios FM-PONTE-50 / FM1200-VGBE", S(/^(FM-PONTE|FM1200)/), "backhaul"],
    ["AP1800s AC plug / USB power modules", S(/^AIR-MOD-(AC|USB)/), "power"],
    ["AP1800s PoE uplink modules", S(/^AIR-MOD-S?POE/), "module"],
    ["MobileAccessVE in-building DAS units", S(/^AIR-(330|VAP|VCU)/), "no library kind (DAS head-end/remote) — decision"],
    ["TelePresence Room 70 / MX700-800 parts", S(/^(CS-R|CS-ROOM|CTS-MX)/), "WRONG CATEGORY -> collaboration-endpoints (speaker / display / mechanical)"],
    ["ASR 5000/5500 packet-core parts and PAS cabinets", S(/^(ASR5|MIXS-)/), "WRONG CATEGORY -> routers sp-core; PAS DOCUMENTATION/SPARE COMPONENTS are non_product"],
    ["MSE 3350 drives", S(/^(AIR-MSE3350-HD|MSE-HD)/), "drive"],
    ["MSE bundles", S(/^AIR-MSE-B/), "bundle"],
    ["promo / licence / placeholder PIDs", S(/^(PROMOCT|AIR-PROMO|PI-MSE-PRMO|SOFTWAREAAV|PRODUCTEXPANS|COUNTRYPOWER)/), "NOT HARDWARE -> class software (licence promos) / non_product (inserts, placeholders)"],
    ["access points filed as other", S(/^(AP1572|AP18321|PPN-AP1832)/), "ap"],
    ["AP / WLC bundles", S(/^(AP-MIGR|WL55|WL85)/), "bundle"],
    ["EDU Catalyst 9800 controllers", S(/^EDU-CW9800/), "wlc [J: placeholder names]"],
    ["packing kits", S(/FINAL-PKG/), "non_product"],
    ["IEC6400 (URWB) server components", S(/^IWA-/), "nic / accessory (UCS component kinds)"],
    ["Meraki MR mount adapters", S(/^MA-UMNT/), "mechanical"],
    ["BLE beacons / location exciters", S(/^(AIR-BLE|AIR-VBLE|ASCT-EX)/), "no library kind (sensor/beacon) — decision"],
    ["spectrum analyser card", S(/^COGNIO/), "module"],
    ["PoE injector", S(/^CW-INJ/), "power-injector"],
    ["racks / FIPS kit", S(/^(RACK-|WS-SVCWISM2FIPKIT)/), "mechanical"],
    ["other single devices (ON100 agent, NEC DTA, BTIMGE)", S(/^(ON100|AIR-N-3006|BTIMGE)/), "genuinely unknown — needs a description"],
  ],
  "servers-unified-computing.unknown": [
    ["VOID / not-in-use PIDs", N(/^VOID|Void; not used/), "non_product"],
    ["datasheet cell value / fragment enumerated as a part", CELL, "NOT A PART -> retire (non_product)"],
    ["NVMe drives UCS-NVE / UCSX-NVE / UCSXE-NVE", S(/^UCS(X|XE)?-NVE/), "drive (ucsKind has no NVE token)"],
    ["M.2 / E3.S / SSD drives", S(/^(UCSXE-M2-\d|UCSXE-M2\d|UCSSD|UCSXS960|UCSC-E3S|CS-EZ-3TB)/), "drive"],
    ["memory (UCSXE-MR, UCS-MCX, A02-MEMKIT)", S(/^(UCSXE-MRX?|UCS-MCX|A02-MEMKIT)/), "memory"],
    ["GPUs", S(/^(UCSXE-GPU|CAI-GPU|UCSX-NVL2|UCS-DGPU)/), "gpu"],
    ["NICs / VIC / OCP adapters", S(/^(UCSXE-P-|N20-AI|UCSW-WT-IM2P|UCSC-OCP-(100G|1025G)|PLHC-MLOM|UCSC-LPC)/), "nic"],
    ["RAID / HBA controllers", S(/^(UCSXE-M2-HWRD|R200-PL004|R250-PL003|R2X0-ML002|UCSC-PSAS12GHBA|UCSC-9500-8E|UCSB-FBWC)/), "storage-controller"],
    ["power supplies / power modules", S(/^(UCSXE-PSU|R200-DISTIPSU|PLHC-N01-UAC)/), "power"],
    ["TPM", S(/^UCSXE-TPM/), "tpm"],
    ["fans", S(/FAN/), "fan"],
    ["batteries (coin cells, AP1520, Cius)", S(/^(CR\d{4}|AIR-1520-BATT|CIUS-BATTERY)/), "accessory (battery); AIR-1520/CIUS are other product lines"],
    ["cables (SAS/SATA/RAID/GPU/Mellanox/debug/KVM)", or(S(/CBL|CABLE/), S(/^(UCSW-MC\dM|UCSC-SATA-C125|N20-BKVM)/)), "cable"],
    ["mechanical (heatsinks, bezels, rails, brackets, blanks, labels, carriers, sleds, tools)", S(/^(UCSXE-(BEZ|RAIL|RKMT|SHLFMT|WALL|R2T|MNT|PKG)|UCSX-M8[AI]-(HS|FMEZZ)|UCSX-C-M7-HS|UCSC-HPBKT|UCS-M[56]-CPU-CAR|N20-CDIVV|UCSB-SLED|UCSC-MPKIT|UCS-T20-TORX|UCS-M\d-V\d-LBL|UCS-DDR5-BLK)/), "mechanical"],
    ["risers / expanders / interposers / CMC / edge sleds", S(/^(R210-SASX|UCSC-IPSSD|UCSXE-1U-|UCSC-DLOM|UCSXE-ECMC|UCS-SX348-CMC|C16-)/), "accessory / io-module [J: several names are placeholders]"],
    ["fibre patch panels and cassettes (PP-)", S(/^PP-/), "no library kind (patch panel) -> mechanical or cable — decision"],
    ["chassis", S(/^UCSX-9508/), "chassis"],
    ["ISR service modules (ISM-SRE, UCS-E service spares)", S(/^(SVC-E1|ISM-SRE-300-K9)/), "WRONG CATEGORY -> routers module (service module)"],
    ["PCIe node / configured servers", S(/^(UCSX-580P|KIN-UCSM5|TG5500-C220|UCS-EM-B200|UCS-SADV|UCS-VDI-C240|UCSEZ|UCSSPEN|UCSV-EZ|UCS-STM-C2|UCS-MA-C220|UCSC-BASE-C460|UCS-C3260-SA|PLHC-(BM|VDI|VSI))/), "server (configured node) [J]"],
    ["bundles / MLB / multipacks / programme PIDs", S(/^(N20-Z0001|AIPOD|UCS-M6-MULTIPACK|UCS-MAFI|UCS-MAH|N1K-VSG|OPEN-BLOCK|UCSO-STARTER|START-BNDL|HXM4|UCSB-M6-AAS|UCSX-M6-AAS|UCSX-COHESITY|ISM-SRE-300-BUN|UCSB-10-PK|UCSC-10C220|UCSC-EPOD|UCS-ASR5700|UCS-VSAN-MLB|UCS-TEST-MLB|UCS-M6-MULTI)/), "bundle"],
    ["Duo hardware token", S(/^DUO-TOKEN/), "WRONG CATEGORY -> security accessory"],
    ["software / subscription / service / config PIDs", S(/^(DUO-|UCS-BDM|SSTACK|SCALITY|UCS-STOR-|UCS-PM-|NFR-UCS|FL-SRE|FL-UCSE|UCS-VSAN|VEEAM|ICLOUD|COHS-|E3A-UFAB|CAAPL|UCSC-ADCONFIG|UCS-SW-CUST|INSTALL-OS|SM[79]-UCSE|UCSC-OPTOUT|UCS-DISTI|UCSB-DISTI|CEM-DC|CIMC-SUP|PPN-TEST|N01-MMIRROR)/), "NOT HARDWARE -> class software / service / non_product"],
    ["other placeholder-named rows", (p) => p.ph, "genuinely unknown — needs a description"],
  ],
  "video.unknown": [
    ["placeholder-named, series 'Optical Passive Components'", (p) => p.ph && /Optical Passive/.test(p.series), "passive [J: by series only — every name is a placeholder]"],
    ["placeholder-named 10-1022xxx-01, series 'GS7000 Nodes'", (p) => p.ph && /^10-1022/.test(p.sku), "genuinely unknown — needs a description"],
    ["placeholder-named SA part numbers (Prisma II, GS7000 nodes and hub, RFGW, D-PON)",(p) => p.ph, "genuinely unknown — needs a description"],
    ["passives: DWDM/BWDM mux, DTP expansions, filters, couplers, patch enclosures", N(/DTP|DWDM|BWDM|Quad-filter|Coupler|Patch Enclosure|CWDM,1X10/i), "passive"],
    ["optical switches (P2-OPSW, GS7000 Optical Switch)", N(/Opt Sw|OPSW|Optical Switch|Opt Switch/i), "no library kind (optical switch) -> plug-in [J]"],
    ["reverse amplifiers / HEDA", N(/Rev Amp|HEDA/i), "rf-amplifier"],
    ["receivers (EDR Rx OPM, HDRX, HD RXR)", N(/Rx OPM|RCVR|RXR/i), "receiver"],
    ["transmitter modules (EDR Tx, GS7K OS CWDM Tx)", N(/Tx module|CWDM [A-Z] Tx/i), "transmitter [J: GS7K OS modules carry Rx and Tx]"],
    ["plug-in modules and boards (ICIM, host, LCM, status monitor, transponder, QAM/I-O boards)", N(/ICIM|Host Module|Local Cntrl|Local Control|Status Monitor|TRANSPONDER MOD|CONTROL BD|QAM BOARD|I\/O BOARD|QAM Module|I\/O Module|BACKPLANE BOARD|FCM,1X2|Octal Upgrade/i), "plug-in"],
    ["power (node PSU, -48V connector, ONT PSU, powered kit)", N(/Pwr Supply|Pwr Conn|ONT PS|110V Powered/i), "power"],
    ["tools, probes, terminators, jumpers, bulkheads, upgrade kits", N(/Tool|Test Probe|Bulkhead|Terminator|Signal Director|UPG Kit|AUX TERM|AUX REV INJ/i), "accessory / mechanical"],
    ["node housings / unconfigured node platforms", N(/Hsg Assy|Unconfigured/i), "node [J]"],
    ["RF Gateway bundles", N(/Bundle|Upgrde|UpgrdeBun/i), "bundle"],
    ["D-PON ONT", N(/ONT/), "no library kind (ONT, customer-premises) — decision"],
    ["other named", () => true, "genuinely unknown — needs a description"],
  ],
  "hyperconverged-systems.unknown": [
    ["VOID PID", N(/VOID/), "non_product"],
    ["datasheet cell value / fragment", CELL, "NOT A PART -> retire (non_product)"],
    ["HX-16-DC/ST nnC (placeholder names, spec-held)", S(/^HX-16-/), "genuinely unknown — needs a description [J: likely HX licence tiers]"],
    ["HyperFlex edge / node systems", S(/^(HXAF-E-|HXAF225|PLHC-(EDGE|VDI|VSI)|HX-DH-C240)/), "server"],
    ["FI bundle", S(/^HX-DH-FI/), "fabric-interconnect"],
    ["UCS component cables", S(/CBL/), "cable"],
    ["DAC cables XDACBL", S(/^XDACBL/), "cable"],
    ["UCS component risers / kits / interposers / ears", S(/^(UCSC-|UCS-DCPMM|HX-M5-CPU-CAR)/), "accessory / mechanical (UCS component kinds)"],
    ["PDU", S(/^RP208/), "pdu"],
    ["bundles / subscriptions / offers / config / services", S(/^(CPHC|HX-AAS|HX-M6-AAS|HX-EXPRESS|HX-COLLAB|HX-AMD|HXAF-FSS|HX-E-M5S|HX-M4S|E3-A-HXDP|HX-RES|HX-VB-|HX-VSE2VSP|HX-NIC-MODE|HX-SYSTEMDRIVE|AS-DCN)/), "NOT HARDWARE (software/service/config) or bundle"],
    ["other", () => true, "genuinely unknown — needs a description"],
  ],
  "hyperconverged-infrastructure.unknown": [
    ["datasheet cell value / fragment", CELL, "NOT A PART -> retire (non_product)"],
    ["Nutanix AOS / AHV software, OS choices, config", S(/^(HCI-AOS|HCIX-AOS|NTX-|HCI-UCSM-MODE)/), "NOT HARDWARE -> class software / non_product"],
    ["X-Series chassis", S(/^HCIX-9508/), "chassis"],
    ["X-Fabric modules", S(/^HCIX-FS/), "io-module [J]"],
    ["GPU", S(/^HCIX-NVL2/), "gpu"],
    ["PCIe node", S(/^HCIX-X580P/), "server (PCIe node) [J]"],
    ["debug cable", S(/CBL/), "cable"],
    ["riser", S(/^UCSC-R2R3/), "accessory"],
    ["other", () => true, "genuinely unknown — needs a description"],
  ],
  "collaboration-endpoints.unknown": [
    ["IX5000 laptop connectivity kits", S(/^CTS-LAPCONN/), "accessory (cable kit) [J]"],
    ["ATP demo bundles", S(/^CTS-ATP/), "bundle"],
    ["promo / vendor bundles", S(/^(CTS-MXNMTCH|CTS-TPEB|CTS-TPSB|CTS-VNDCNCT|CS-R-USB-UPG)/), "bundle"],
    ["SpeakerTrack interface plates", S(/^CTS-ST-INT-PLATE/), "mechanical"],
    ["headset Bluetooth adapters", S(/^HS-WL-ADPT/), "accessory (headset adapter)"],
    ["Webex Share adapter", S(/^SPK-SHARE/), "accessory [J: a wireless share dongle, not a video-device]"],
    ["SolutionsPlus third-party (Avizia carts, Jabra handsets, SPVAC)", S(/^(AVIZ|SPVAC)/), "third-party: headset/phone or bundle [J: SPVAC-C7416/H5610/UC725 names are placeholders]"],
    ["SpectraLink 8744 handsets", S(/^SLINK/), "phone (wireless) [J]"],
    ["wireless bridge WBP54G", S(/^WBP54G/), "no library kind (client bridge) — decision"],
    ["TTC5-nn (placeholder names)", S(/^TTC5/), "genuinely unknown — needs a description"],
    ["other", () => true, "genuinely unknown — needs a description"],
  ],
  "unified-communications.unknown": [
    ["VCS / Expressway systems", S(/^(CTI-VCS|EXPWY)/), "server (appliance) [J: may be software editions]"],
    ["VCS ATP demo bundles", S(/^CTI-ATP/), "bundle"],
    ["Room Phone subscription", S(/^CP-ROOMPH/), "NOT HARDWARE -> class software (subscription)"],
    ["BE6000 components", S(/^UC-/), "drive / cpu / memory (UCS component kinds)"],
    ["voice expansion module", S(/^EM-HDA/), "voice-module"],
    ["SM-X NIM adapter", S(/^SM-X-NIM/), "module (adapter)"],
    ["Unity Connection SW+HW bundle", S(/^UNITYCN/), "bundle"],
  ],
  "optical-networking.other": [
    ["hardware + support bundles (LLP3/LLP5)", S(/-LLP[35]$/), "bundle (hardware + 3/5-year service)"],
    ["starter kits (-SK)", S(/-SK$/), "bundle"],
    ["CFP2-WDM pluggable bundles", S(/^ONS-CFP2/), "bundle (of transceivers) — or transceiver category"],
    ["internal 800- part numbers / 4X100G-LR-S (placeholder names)", S(/^(800-|4X100G)/), "genuinely unknown — needs a description"],
    ["QWEST expansion class", S(/QWEST/), "non_product"],
  ],
  "storage-networking.other": [
    ["MDS upgrade bundles", S(/UPGR$/), "bundle"],
    ["C97- document number enumerated as a part", S(/^C97-/), "NOT A PART -> non_product (a Cisco collateral id)"],
    ["other", () => true, "genuinely unknown — needs a description"],
  ],
  "transceiver.accessory": [
    ["CWDM mux/demux and OADM plug-ins", S(/CWDM-MUX/), "no transceiver kind fits -> kind `mux` (MUX/PASSIVE archetype) or move to optical-networking — decision"],
  ],
  "meraki.unknown": [["MCSn (placeholder names, no document)", () => true, "genuinely unknown — needs a description"]],
  "conferencing.unknown": [["C-CPM (placeholder name, no document)", () => true, "genuinely unknown — needs a description"]],
};

const result: any = {};
for (const [pop, rules] of Object.entries(RULES)) {
  const [c, k] = pop.split(".");
  const rows = parts.filter((p) => p.category === c && p.kind === k).map((p) => ({ sku: p.sku, name: p.name ?? "", held: p.held, series: p.series ?? "", ph: (p.name ?? "") === "Cisco " + p.sku }));
  const fams: Record<string, any> = {};
  const assigned: any[] = [];
  for (const r of rows) {
    const rule = rules.find(([, f]) => f(r));
    const label = rule ? rule[0] : "UNMATCHED";
    const f = fams[label] ??= { family: label, proposal: rule ? rule[2] : "?", n: 0, spec: 0, eol_only: 0, no_doc: 0, placeholder_names: 0, samples: [] as string[] };
    f.n++; f[r.held]++; if (r.ph) f.placeholder_names++;
    if (f.samples.length < 3) f.samples.push(`${r.sku} — ${r.name.slice(0, 55)}`);
    assigned.push({ ...r, family: label });
  }
  result[pop] = { total: rows.length, families: Object.values(fams).sort((a: any, b: any) => b.n - a.n), rows: assigned };
  console.log(`\n### ${pop} (${rows.length})`);
  for (const f of result[pop].families) console.log(`${f.n}\t${f.spec}/${f.eol_only}/${f.no_doc}\tph=${f.placeholder_names}\t${f.family} => ${f.proposal}\t| ${f.samples.join(" ; ")}`);
}
writeFileSync("D:/tmp/kindlayer-III0/C/raw/item6-unresolved-families.json", JSON.stringify(result, null, 1));
