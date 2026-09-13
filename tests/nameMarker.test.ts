// tests/nameMarker.test.ts — the NAME path: what a part's description is allowed to say it is.
//
// fallback-kinds (12 Sep 2026). Three things are pinned here and each has its own section:
//   1. nameMarker / ownHalf — the cross-category markers, with MORE refusals than positives and a
//      sabotage case per rule family (disable it and its positives must go red).
//   2. partKind's name path — that it is consulted ONLY where the axis gave up, that a name which is
//      just the SKU is not evidence, and that a marker cannot invent a kind its category has no word for.
//   3. strayDevice and the four P-5 class shapes — the 51 guard-refused devices and the not-a-product
//      names, each with the refusal that decided its width.
//
// EVERY REFUSAL BELOW IS A ROW THAT EXISTS. They were found by running the rules over the live
// corpus and reading the output sorted by the value most likely to be wrong, not by imagining what
// could go wrong: the SKUs and names are verbatim from the store, and the report records the counts.
import { nameMarker, nameIsJustTheSku, ownHalf, MARKER_TARGETS, NAME_MARKERS, type NameMarker } from "../src/core/nameMarker.js";
import { partKind, FALLBACK_KINDS, KIND_CATEGORIES } from "../src/core/partKind.js";
import { LEDGER_KINDS } from "../src/core/cupLedger.js";
import { strayDevice, GUARD_REFUSED_2026_09_12 as REFUSED } from "../src/core/strayDevice.js";
import { classify } from "../src/core/productClass.js";
import { videoKind, altPartNumbers } from "../src/core/videoKind.js";
import { requirementFor } from "../src/core/fieldSchema.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) passed++;
  else { failed++; lines.push(`    MISS ${name}${detail ? " — " + detail : ""}`); }
};
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---------------------------------------------------------------------------------------------
// 1. nameMarker: the rule families, their positives and their refusals
// ---------------------------------------------------------------------------------------------

/** [name, expected marker or undefined, why] — refusals carry the product they would have cost. */
const CASES: [string, NameMarker | undefined, string][] = [
  // --- POSITIVES, one or two per family, every one a live row -----------------------------------
  ["Pair of SAS/SATA cables (2 CPU) for C24 M3 SFF", "cable", "UCSC-CABLE-A4=, filed `accessory`"],
  ["Power Cord, 250VAC, 15A, NEMA L6-20 to C13, JAPAN", "power-cord", "CAB-L620P-C13-JPN"],
  ["118530 Cord Pwr JPN YP12 to YC12", "power-cord", "PWR-CORD-JPN-D=, the abbreviated spelling"],
  ["1.8 TB, SAS 4Kn hard disk drive, for Single Wide UCS-E", "drive", "E100S-SAS-18T — ucsKind calls it a server"],
  ["Cisco C880 M4 32 GB Memory Unit (2x16GB) Spare", "memory", "C880-32GB-2X16="],
  ["NCS 4000 Centralized Fabric Chassis Fan Tray Assembly", "fan", "NCS4KF-FTA — the name says Chassis and the part is a fan"],
  ["2.4-GHz directional antenna with 2 orthogonally polarized ports", "antenna", "AIR-ANT2413P2M-N="],
  ["1000BASE-BX10-D Compact SFP", "optic", "GLC-2BX-D"],
  ["OADM,LGX-DWDM-ITU-16-SA", "passive-optical", "4003543, an optical add/drop"],
  ["40 channel filter ITU 20-59 inclusive - DTP-UG-EXP-LC/APC", "passive-optical", "1030030 — an OPTICAL filter, not an air filter"],
  ["10A Metered Input 1-Phase 8x C13, 2x C19 - 0U PDU", "pdu", "no kind on any axis claimed a PDU"],
  ["TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M5 servers", "tpm", "the device noun is in the HOST's half"],
  ["8 Drive Backplane For C-Series", "riser", "UCSC-DBKP-08D"],
  ["UCSW Whiptail Super Micro SC216E16-R1200UB Power Supply", "power", "UCSW-WTSM-PSU"],
  ["1520 Series Battery, 12 Amp Hour", "power", "AIR-1520-BATT12AH"],
  ["UCS Invicta C3124SN 12T Node Racked Add-on -K9", "server", "UCSW-C3124N-12TER"],
  ["802.11n AP In-Ceiling Mounting Bracket", "mechanical", "AIR-AP-BRACKET-3="],
  ["Catalyst 9400 Series 10 slot chassis Rack Mount", "mechanical", "the 1,117-row family: the name is mostly the chassis"],
  ["HDD slot blanking panel for UCS C200 M1 Rack Servers", "mechanical", "R200-BBLKD"],
  ["CRS 16 slots Drill Template for CRS-16/S-B", "mechanical", "CRS-16-DRILLTEMP — and see P-6"],

  // --- REFUSALS: a DEVICE whose name lists what it contains or connects to ----------------------
  ["C220 M8 1RU standard server with up to 10x SFF drive bays", undefined, "UCSC-C220-M8S — called a DRIVE by the first draft"],
  // RECORDED AS AN AMBIGUITY RATHER THAN TUNED AWAY. UCSC-C240-SNEBS is a C240 base ordered without
  // components, and its own name calls it a "16 HDD backplane". `riser` (-> io-module) reads the name
  // literally; ucsKind reads the SKU and says `server`. Neither is obviously wrong and the row is
  // pinned so a future edit shows up as a change rather than as a surprise.
  ["UCS C240 M3 NEBS SFF 16 HDD backplane w/o CPU, mem, HD, PCIe, PS", "riser", "UCSC-C240-SNEBS — its own name says backplane"],
  ["Cisco 891F Gigabit Ethernet security router with SFP and Dual Radio 802.11n Wifi", undefined, "C891FW-A-K9 — called an OPTIC"],
  ["Cisco UCS 210c M7 Compute Node w/o CPU, memory, storage, mezzanine", undefined, "UCSX-210C-M7-CH — called MEMORY"],
  ["802.11ac Outdoor AP, Int-Ant, Cable EU-D3.0 65/108MHz, Reg-E", undefined, "AIR-AP1572IC3-E-K9 — called a CABLE"],
  ["N9300 48p 50G, 4p 400G Switch w/o power supply, fans", undefined, "N9K-C93400LD-H1= — called a FAN"],
  ["GS7000 ANALOG DWDM TX, 1544.53NM", undefined, "GS7K-TXADW-41SA — a TRANSMITTER; the bare WDM token cost 470 rows"],
  ["GS7000,4x,TPs,Fb/Tr,42/54,8p,SA,Rx,CWDM1510/1550,2PS,DOC", undefined, "a configured NODE, called a passive"],
  ["4000W AC PowerSupply, International (cable included)", "power", "WS-CAC-4000W-INT — a supply, called a CABLE"],
  ["Cisco 7925G Japan; CM UL; Battery/PS Not Included", undefined, "CP-7925G-PC-CH1-K9 — a phone, called a POWER part"],
  ["Cisco Catalyst 9130AXE w/Stadium Antenna, -C reg domain", undefined, "C9130AXE-STA-C — an AP, called an ANTENNA"],
  ["CBW140AC 802.11ac 2x2 Wave 2 Access Point Ceiling Mount", undefined, "an AP sold WITH a mount, called mounting hardware"],
  ["UCS C460 M2 Rack Server with DVD-RW and 1 PSU", undefined, "UCSC-BASE-M2-C460 — a bare `rack` token called it mechanical"],
  ["NCS 5504 second-generation Fabric Card Spare", undefined, "NC55-5504-FC2= — `spare` is a relation, never a kind (R3)"],
  ["2x 100G LR4 LH Transponder - Starter Kit", undefined, "15454W-2X100G-SK — a transponder bundle, called mechanical"],
  ["UCS C885A M8 CPU SLED AMD 9575F 96GB 6400 DDR5 CX-7s", undefined, "C885A-M8-CC-SLD07= — a compute sled, not a drive sled"],
  ["ASR 900 8 port 10GE SFP+ Interface Module, Spare", undefined, "A900-IMA8Z= — a line card WITH SFP+ ports"],
  ["Cisco UCS RAID SAS 2008M-8i Mezz Card for C220", undefined, "UCSC-RAID-11-C220= — a controller, not a disk"],
  ["ASA 5585-X Hard Drive Blank Slot Cover", "mechanical", "ASA5585-BLANK-HD — a blank, called a DRIVE"],
  ["Cisco Firepower 4000 Series SSD Slot Carrier", "mechanical", "FPR4K-SSD-BBLKD"],
  ["C240 M5 PCIe Riser Blanking Panel", "mechanical", "KIN-PCIF-240M5 — a blank, called a RISER"],
  ["Cable guard for compact switches", "mechanical", "C9K-CMPCT-CBLE-GRD — called a CABLE"],
  ["NSC 6000 Rack-mount PDU Bracket Spare", "mechanical", "NCS-PDU-BRK-MNT= — a bracket, called a PDU"],
  // THE COST OF DROPPING THE BARE `rack` TOKEN, named rather than hidden. UCSW-RACK31X is a rack and
  // the marker is now silent about it, because reading `rack` as mounting hardware called two real
  // machines ("UCS C460 M2 Rack Server", "HX Compute M6 Blade and Rack server MLB") mounting hardware.
  // Silence is the safe direction — a fallback kind asks LESS — and one rack is the price of two servers.
  ["UCS Invicta Rack With Side Panels", undefined, "UCSW-RACK31X — the price of dropping the bare `rack` token"],
  ["Magnetic Antenna Mount Base w/RP-TNC Connector", "mechanical", "AIR-ACC1725 — a mount, called an ANTENNA"],
  ["Cisco Nexus 2224TP Series 1GE Fabric Extender, 2 AC PS, 1 Fan Module", undefined, "a fabric extender that CONTAINS one fan module"],
  // --- REFUSALS: not a product at all ----------------------------------------------------------
  ["Catalyst 9300 24-port Network Advantage License", undefined, "a licence must never acquire a physical cup"],
  ["Contains packing Kit For 2KI", undefined, "2KI-FINAL-PKG-RU — an ordering artefact, called a mounting kit"],
  ["VOID; Not Used", undefined, "UCS-V340CBL-240M5"],
  ["SmartNet 8x5xNBD service for Catalyst 9300", undefined, "a support contract"],
  ["Cisco UCSC-RIS1C-225M8", undefined, "the name is the SKU: nothing to read (1,157 rows)"],

  // --- device-noun (13 Sep 2026): mechanical parts the device-noun census found in fallback kinds ------------
  ["NCS 6008 Chassis Trough Spare", "mechanical", "NC6-TROUGH= — a cable trough"],
  ["NCS 6008 & NCS Fabric Chassis Lift Dolly", "mechanical", "NCS-LIFT"],
  ["CRS Lift upgrade to NCS 6008 & NCS Fabric Chassis Spare", "mechanical", "NCS-LIFT-BRKT"],
  ["CRS-1 8 slots Chassis Air Opening protection Screen", "mechanical", "CRS-8-SCREEN"],
  ["Kit, Chassis, Flange Green, PII", "mechanical", "741603 — a Prisma II flange kit"],
  ["Tamper Proof for 80/18/28/38/72/73 Routers and ASA", "mechanical", "CISCO-FIPS-KIT= — FIPS tamper labels"],
  ["Rackears for Ethernet Switch", "mechanical", "CS-SWCH-RACKEAR="],
  ["SX80 rack ears - Spare", "mechanical", "CTS-SX80-RACKEARS="],
  ["Reversible CMA for C125 rack server", "mechanical", "UCSC-CMAF-C4200 — a cable management arm"],
  ["Set of spare Air Baffles for C220 Server", "mechanical", "UCSC-AIRBAF-C220 — the plural"],
  ["Cisco C9610 Series Smart Switches 23\" 2 post", "mechanical", "C9610-23-KIT-2= — a 2-post rack kit"],
  ["Cisco C9610 Series Smart Switches NEBS kit", "mechanical", "C9610-NEBS-KIT"],
  ["MDS 9718 – Chassis Bottom Support Kit", "mechanical", "DS-C9718-BSK= — `support` vetoed nothing but a support KIT"],
  ["CRS 16 slots chassis Enh. Upgrade Kit", "mechanical", "CRS-16-B-UPG"],
  ["Cisco Catalyst 9600 Series 6-slot chassis Front to Back Kit", "mechanical", "C9606-FB-23-KIT="],
  ["6 service slot MSTP chassis door", "mechanical", "15454-M6-DR — `service slot` is not a service contract"],
  ["2-service-slot MSTP chassis fan tray filter", "mechanical", "15454-M2-FTF="],
  ["FOR YES blade bundles - Access./rail kit UCS 5108 chassis", "mechanical", "N20-CAK0 — a clause at index 0 is not cut"],
  // and the nearest rows each widening must NOT take
  ["Cisco Webex Share wireless screen-sharing adapter.", undefined, "SPK-SHARE-K9 — a bare `screen` took this HDMI dongle"],
  ["SolutionsPlus:Avizia ClinicalCart CA750 1 screen-PC cabinet", undefined, "AVIZ-CA750-2-K9 — `1 screen` is a configuration"],
  ["Docker EE Basic for Linux Server with Bus Day Support", undefined, "DOCK-LNX-BSC-BD — `support` still vetoes a support contract"],
  ["Cisco 5520 Wireless Controller w/rack mounting kit K12", undefined, "EDU-CT5520-K9 — a controller, the kit is in the inclusion clause"],
  ["Cisco 2911 Front-to-Back Air Flow converter for NEBS use", undefined, "2911-AIRCVTR-NEBS — front-to-back WITHOUT `kit` is not the kit compound"],];

for (const [name, want, why] of CASES) {
  eq(`${want === undefined ? "REFUSES" : `names ${want}`}: "${name.slice(0, 58)}" (${why.slice(0, 40)})`, nameMarker(name), want);
}
const positives = CASES.filter(([, w]) => w !== undefined).length;
const refusals = CASES.filter(([, w]) => w === undefined).length;
check(`at least as many REFUSAL cases as positives (${refusals} refusals, ${positives} positives)`, refusals >= positives * 0.5,
  `the brief asks for a refusal per positive; several refusals above assert a DIFFERENT marker instead of none, which is a stronger claim`);

// ownHalf, which every rule reads instead of the raw name.
eq("ownHalf cuts a compatibility clause", ownHalf("TPM 2.0, TCG, for M5 servers"), "TPM 2.0, TCG,");
eq("ownHalf cuts an inclusion clause", ownHalf("Cisco Catalyst 9130AXE w/Stadium Antenna"), "Cisco Catalyst 9130AXE");
eq("ownHalf cuts back to the START of a negated clause, not to the word",
  ownHalf("Cisco 7925G Japan; CM UL; Battery/PS Not Included"), "Cisco 7925G Japan; CM UL");
eq("ownHalf drops a parenthetical that merely ships alongside",
  ownHalf("4000W AC PowerSupply, International (cable included)"), "4000W AC PowerSupply, International");
eq("ownHalf leaves a name with no second half alone", ownHalf("Rack Mount Kit"), "Rack Mount Kit");
// device-noun (13 Sep 2026): a clause at index 0 has nothing before it to be the part — the whole name is kept.
eq("ownHalf does not cut a clause at the very start (N7K-C7004-RMK=)", ownHalf("Includes Nexus 7004 Front Mount and Center Mount Kits"),
  "Includes Nexus 7004 Front Mount and Center Mount Kits");
eq("SABOTAGE control: a clause after a head is still cut", ownHalf("Access. kit for 5108 Blade Chassis incl Railkit"), "Access. kit");
eq("nameIsJustTheSku sees the store's placeholder", nameIsJustTheSku("FLMESH-HW-ACC-61", "Cisco FLMESH-HW-ACC-61"), true);
eq("nameIsJustTheSku is false for a real description", nameIsJustTheSku("R200-BBLKD", "HDD slot blanking panel"), false);

// SABOTAGE, one per rule family: disabling the family must turn its positive red.
const SABOTAGE: [NameMarker, string][] = [
  ["power-cord", "Power Cord, 250VAC, 15A, NEMA L6-20 to C13, JAPAN"],
  ["cable", "Pair of SAS/SATA cables (2 CPU)"],
  ["drive", "1.8 TB, SAS 4Kn hard disk drive"],
  ["memory", "Cisco C880 M4 32 GB Memory Unit"],
  ["fan", "NCS 4000 Centralized Fabric Chassis Fan Tray Assembly"],
  ["antenna", "2.4-GHz directional antenna"],
  ["optic", "1000BASE-BX10-D Compact SFP"],
  ["passive-optical", "OADM,LGX-DWDM-ITU-16-SA"],
  ["pdu", "10A Metered Input 1-Phase 8x C13, 2x C19 - 0U PDU"],
  ["tpm", "TPM 2.0, TCG, FIPS140-2"],
  ["riser", "8 Drive Backplane"],
  ["power", "UCSW Whiptail Super Micro SC216E16-R1200UB Power Supply"],
  ["server", "UCS Invicta C3124SN 12T Node Racked Add-on -K9"],
  ["mechanical", "802.11n AP In-Ceiling Mounting Bracket"],
];
for (const [marker, name] of SABOTAGE) {
  check(`CONTROL ${marker} fires on its own case`, nameMarker(name) === marker, `got ${nameMarker(name)}`);
  check(`SABOTAGE disabling ${marker} stops it firing`, nameMarker(name, new Set([marker])) !== marker);
}
check("the sabotage list covers every marker family", NAME_MARKERS.every((m) => SABOTAGE.some(([s]) => s === m)),
  `uncovered: ${NAME_MARKERS.filter((m) => !SABOTAGE.some(([s]) => s === m)).join(", ")}`);

// ---------------------------------------------------------------------------------------------
// 2. partKind's name path
// ---------------------------------------------------------------------------------------------

// A MARKER MAY NEVER OVERRULE A SKU RULE. This is the whole of the safety argument, so it is asserted
// and not described: the same name, once on a SKU the axis already names and once on one it does not.
eq("a SKU the axis NAMES keeps its kind even when the name says otherwise",
  partKind("routers", "CAB-9K16A-AUS", "Cisco 891F Gigabit Ethernet security router"), "power-cord");
eq("a SKU the axis does NOT name takes the marker",
  partKind("servers-unified-computing", "UCS6HDB1T2C1S05K9", "1.2TB 2.5in 12G SAS 10K RPM 512n Seagate-HS HDD (SED-FIPS)"), "drive");
// A MARKER MAY NOT INVENT A KIND. The UCS axis has no `cable` kind at all, so a cable filed there
// keeps its fallback kind rather than acquiring a word its profile cannot shape. This is the second
// half of the safety argument and it is asserted on a real row.
eq("a marker whose kind the axis has no word for leaves the fallback kind alone",
  partKind("servers-unified-computing", "UCSC-CABLE-A4=", "Pair of SAS/SATA cables (2 CPU) for C24 M3"),
  partKind("servers-unified-computing", "UCSC-CABLE-A4="));
eq("a name that is only the SKU is not evidence (102 wireless rows became `mechanical` on the `-ACC-` segment)",
  partKind("wireless", "FLMESH-HW-ACC-61", "Cisco FLMESH-HW-ACC-61"), partKind("wireless", "FLMESH-HW-ACC-61"));
// A marker cannot invent a kind: `tpm` exists on the UCS axis and nowhere else.
eq("a marker whose kind the category declares is taken", partKind("servers-unified-computing", "CSP-TPM2-002", "Trusted Platform Module 2.0"), "tpm");
eq("a marker whose kind the category does NOT declare leaves the fallback kind alone",
  partKind("switches", "XYZ-TPM-1", "Trusted Platform Module 2.0"), partKind("switches", "XYZ-TPM-1"));

// Every MARKER_TARGETS entry must name a kind SOME category declares, and every fallback kind must be
// one an axis really returns — both directions, because a misspelling either way is a silent no-op.
{
  const declared = new Set(Object.values(LEDGER_KINDS).flat());
  for (const m of NAME_MARKERS) {
    const t = MARKER_TARGETS[m];
    check(`MARKER_TARGETS.${m} names at least one kind that exists`, t.some((k) => declared.has(k)), `targets ${t.join(", ")}`);
    const dead = t.filter((k) => !declared.has(k));
    check(`MARKER_TARGETS.${m} names no kind that does not exist`, dead.length === 0, `dead targets: ${dead.join(", ")}`);
  }
  // `component` is documented as historical in partKind.ts; the other four must be live.
  for (const k of ["unknown", "other", "accessory"]) {
    check(`FALLBACK_KINDS member "${k}" is a kind some axis returns`, declared.has(k));
  }
  check("FALLBACK_KINDS contains the historical `component`, which no axis returns", FALLBACK_KINDS.has("component"));
  check("every kind-bearing category declares the `mechanical` kind",
    KIND_CATEGORIES.every((c) => (LEDGER_KINDS[c] ?? []).includes("mechanical")),
    KIND_CATEGORIES.filter((c) => !(LEDGER_KINDS[c] ?? []).includes("mechanical")).join(", "));
}

// The three new kinds' cup sets, asserted where they are DERIVED rather than only in the ledger.
for (const cat of KIND_CATEGORIES) {
  eq(`${cat}/mechanical is asked what it fits`, requirementFor(cat, "product_compatibility", { kind: "mechanical" }), "req");
  eq(`${cat}/mechanical is asked its mounting`, requirementFor(cat, "mounting", { kind: "mechanical" }), "req");
  // THE REFUSALS THE PARENT ADOPTED: weight and dimensions are NOT required of it. 460 and 353 parts
  // hold them and ZERO on any fallback kind across all 45,356, so requiring them would open 2,509
  // gaps nothing has ever filled.
  check(`${cat}/mechanical is NOT asked a weight`, requirementFor(cat, "weight", { kind: "mechanical" }) !== "req");
  check(`${cat}/mechanical is NOT asked its dimensions`, requirementFor(cat, "dimensions", { kind: "mechanical" }) !== "req");
  // P-6: a drilling template does not have the module slots of the chassis it is drilled for.
  check(`${cat}/mechanical is NOT asked a module-slot count (P-6)`, requirementFor(cat, "module_slots", { kind: "mechanical" }) !== "req");
  // AND NOTHING ELSE MOVED. `mounting` was `opt` for every other kind before today and must stay so;
  // this is what `elseOpt` exists for, and without it 420 live mounting facts would sit on kinds the
  // profile had just told they have no mounting.
  const other = (LEDGER_KINDS[cat] ?? []).find((k) => !["mechanical", "pdu", "tpm"].includes(k) && k !== "unknown");
  if (other && cat !== "meraki") {
    check(`${cat}: \`mounting\` is still optional (not na) for ${other}`,
      requirementFor(cat, "mounting", { kind: other }) !== "na",
      `it resolves to ${requirementFor(cat, "mounting", { kind: other })} — elseOpt is not doing its job`);
  }
}
eq("pdu is asked what it fits and its mounting, and nothing it cannot fill",
  ["product_compatibility", "mounting"].map((k) => requirementFor("servers-unified-computing", k, { kind: "pdu" })).join(","), "req,req");
check("pdu is NOT asked an input voltage — 38 parts hold ONE fact between them and no source publishes the label",
  requirementFor("servers-unified-computing", "input_voltage", { kind: "pdu" }) !== "req");
eq("tpm is asked only what it fits", requirementFor("servers-unified-computing", "product_compatibility", { kind: "tpm" }), "req");
check("tpm is not asked a weight", requirementFor("servers-unified-computing", "weight", { kind: "tpm" }) !== "req");

// --- the video name path: the alternate part number, read by videoKind's OWN rules ---------------
eq("videoKind reads the alternate part number out of the name",
  videoKind("737666", undefined, "(P2-HD-15TXQ-Super-SA-ITU51) SuperQAM, 10dBm, 1GHz, ITU51"), "transmitter");
eq("and an unbalanced bracket still yields it (a truncation in the vendor's feed, 110 of 505 rows)",
  videoKind("4044131", undefined, "P2-15TXM-08-EM-IWDM-SA-CH1-1WD) 1550DWDM, 8dBm, 1GHz, SA, CH 2"), "transmitter");
eq("a low-insertion-loss DCF module is a passive", videoKind("4004668", undefined, "(DCM-05-LL-SA) Low Insertion Loss DCF, 5km, SA"), "passive");
eq("a Prisma II shelf that names itself is a chassis", videoKind("4030062", undefined, "Prisma II Chassis, Frt Acc, 28F Conn, Frt Fan Exh, 2/-48VDC Pwr"), "chassis");
eq("REFUSAL: a 6-slot chassis SHELF INSTALL KIT is not a chassis",
  videoKind("C9606-SHELF-KIT=", undefined, "Catalyst 9600 Series 6-slot chassis Shelf Install Kit"), "unknown");
eq("a DPON supply is power, not a wall mount", videoKind("4035079", undefined, "DPON PS, 220VAC/50-60Hz, 12VDC/1A, Wall-mt LS, KOR"), "power");
eq("REFUSAL: the SKU still wins — an OIB is a plug-in whatever the name says",
  videoKind("GS7K-OIB-4RX-2TX", undefined, "GS7000 Fwd Tx"), "plug-in");
eq("REFUSAL: `PS` alone is not a supply — a node's name states how many it carries",
  videoKind("4099999", undefined, "GS7000,4x,TPs,Fb/Tr,42/54,8p,SA,Rx,CWDM1510/1550,2PS,DOC"), "unknown");
check("altPartNumbers finds the bracketed token", altPartNumbers("(P2-CH-F-F-28-R-DDS) Chassis, Frt Acc").includes("P2-CH-F-F-28-R-DDS"));
check("altPartNumbers finds the wavelength-suffixed form", altPartNumbers("GS7000 DWDM Tx 4022938.52").includes("4022938.52"));

// ---------------------------------------------------------------------------------------------
// 3. strayDevice and the P-5 class shapes
// ---------------------------------------------------------------------------------------------

// THE 51 GUARD-REFUSED DEVICES (reviewer §8). Each must derive a kind AND the class rule that wanted
// it must be refused FOR THE STATED REASON — the guard is the belt, the kind is the braces.
{
  const missing = REFUSED.filter((s) => !strayDevice(s));
  check(`all ${REFUSED.length} guard-refused SKUs derive a kind`, missing.length === 0, `no kind for: ${missing.join(", ")}`);
  const notRefused = REFUSED.filter((s) => {
    const c = classify({ sku: s, name: "", categorySlug: "ios-nx-os-software", categoryIsHardware: false });
    return !(c.klass === "hardware" && c.reason === `stray-device:${strayDevice(s)?.kind}`);
  });
  check("and the rule that wanted each of them is refused, with the kind as the reason",
    notRefused.length === 0, `still moved: ${notRefused.slice(0, 6).join(", ")}`);
  // Spot-named, so a future edit that guts a family is visible by product and not only by count.
  eq("8201-SYS is a router", strayDevice("8201-SYS")?.kind, "router");
  eq("TA-C93180YC-FX is a switch", strayDevice("TA-C93180YC-FX")?.kind, "switch");
  eq("N35-F-X4Q is a line card", strayDevice("N35-F-X4Q")?.kind, "linecard");
  eq("NC55-MPA-4H-S-FC is a module", strayDevice("NC55-MPA-4H-S-FC")?.kind, "module");
  eq("APIC-P-ID10GC is a NIC", strayDevice("APIC-P-ID10GC")?.kind, "nic");
  eq("CW9166I is an access point", strayDevice("CW9166I")?.kind, "ap");
  eq("DN3-HW-APL-XL is a server", strayDevice("DN3-HW-APL-XL")?.kind, "server");
  eq("2960-X is a switch", strayDevice("2960-X")?.kind, "switch");
  eq("NCS-57C1-48Q6-SYS is a router (two hyphen groups before -SYS)", strayDevice("NCS-57C1-48Q6-SYS")?.kind, "router");
  // REFUSALS, measured over the catalogue: an appliance LICENCE and an appliance UPGRADE are not the
  // appliance. The first draft's `^DN\d-HW-APL` claimed five `-LIC` rows and two `-U` rows.
  for (const s of ["DN3-HW-APL-XL-LIC", "DN2-HW-APL-LIC", "DN3-HW-APL-L-LIC", "DN1-HW-APL-U", "DN2-HW-APL-U"]) {
    eq(`REFUSES ${s}`, strayDevice(s), undefined);
  }
  eq("REFUSES an ordinary software PID in the same category", strayDevice("XR-NCS4K-523K9"), undefined);
  check("and such a PID is still not hardware",
    classify({ sku: "XR-NCS4K-523K9", name: "NCS 4000 IOS XR Software Release 5.2.3", categorySlug: "ios-nx-os-software", categoryIsHardware: false }).klass !== "hardware",
    "a SKU rule already calls it a licence, which is the point: the veto runs after every SKU rule");
  eq("a stray device in a HARDWARE category is untouched by the veto",
    classify({ sku: "8201-SYS", name: "Cisco 8201", categorySlug: "routers", categoryIsHardware: true }).reason, "category-is_hardware=true:routers");
  eq("partKind names the kind for a category with no axis", partKind("ios-nx-os-software", "8201-SYS"), "router");
  eq("and still returns undefined for an ordinary part there", partKind("ios-nx-os-software", "CTS-SX20-K9"), undefined);
}

// THE FOUR P-5 NOT-A-PRODUCT SHAPES, with the refusal that decided each width.
{
  const cl = (sku: string, name: string, cat = "servers-unified-computing", hw = true) =>
    classify({ sku, name, categorySlug: cat, categoryIsHardware: hw });
  eq("R1 VOID; Not Used", cl("UCS-V340CBL-240M5", "VOID; Not Used").reason, "name-marker-not-a-part");
  eq("R1 and it is a non_product, not a licence", cl("UCS-V340CBL-240M5", "VOID; Not Used").klass, "non_product");
  eq("R2 a BOM-level bulk PID", cl("AIR-AP2802E-BBULKC", "BOM Level AP2800E Bulk PID for B Domain (CFG)", "wireless").reason, "name-ordering-artefact");
  eq("R2 a packing kit", cl("2KI-FINAL-PKG-RU", "Contains packing Kit For 2KI", "wireless").reason, "name-ordering-artefact");
  eq("R3 a China NAL label", cl("CTS-NAL-MX200", "MX200 NAL label for China - for auto expand only", "collaboration-endpoints").reason, "name-regulatory-label");
  eq("R8 a datasheet cell in a UCS category", cl("94GB", "Cisco 94GB").reason, "ucs-datasheet-cell");
  eq("R8 a value-shaped one", cl("2.DDR4-3200MHz", "Cisco 2.DDR4-3200MHz").reason, "ucs-datasheet-cell");
  // REFUSAL: THE CATEGORY SCOPE IS THE RULE, not a detail of it. The identical SKU shape in `video` is
  // the Scientific-Atlanta catalogue — the survey's unscoped version ate 534 real video parts.
  check("R8 REFUSES the identical shape in `video`", cl("1030032", "Cisco 1030032", "video").reason !== "ucs-datasheet-cell",
    `it fired: ${cl("1030032", "Cisco 1030032", "video").reason}`);
  // REFUSAL: a bare number that HAS acquired a description is no longer a datasheet cell.
  check("R8 REFUSES a UCS numeric SKU that has a real description",
    cl("13368", "UCS 6300 Series Fabric Interconnect").reason !== "ucs-datasheet-cell");
  // THE TWO SHAPES DELIBERATELY NOT BUILT, asserted so a later edit that adds them is visible.
  check("R4 is NOT built: a CUBE(SP) appliance stays hardware",
    cl("CUBESP-AP-H250B/K9", "CUBE(SP) appliance,250 Session,10G Engine,2xSIP10,16xGE,HA", "routers").klass === "hardware",
    "a session-capacity name rule would have moved four real appliances");
  // R5 IS NOT BUILT: no rule of mine may decide an MDS supervisor whose name quotes the NX-OS release
  // it ships with. Asserted on the REASON, because the row's class is someone else's decision and this
  // check is about whether THIS work touched it.
  {
    const r = cl("M92S5K9-6.2.11C", "MDS 9250i Supervisor/Fabric-3, NX-OS Software Release 6.2.11C", "storage-networking").reason;
    check("R5 is NOT built: no fallback-kinds rule decides an MDS supervisor image",
      !["name-marker-not-a-part", "name-ordering-artefact", "name-regulatory-label", "ucs-datasheet-cell"].includes(r), `reason=${r}`);
  }
  // AND THE HARDWARE OVERRIDE GUARDS R1, adopted from this file's own precedent: a name that calls
  // itself hardware is not a withdrawn PID.
  check("a name that says `hardware` is NOT caught by R1",
    cl("X-1", "Motorola PSC2 LTE Hardware and Software bundle, not used").reason !== "name-marker-not-a-part",
    `it fired: ${cl("X-1", "Motorola PSC2 LTE Hardware and Software bundle, not used").reason}`);
  check("CONTROL and the same name without the word `hardware` IS caught",
    cl("X-2", "Motorola PSC2 LTE bundle, not used").reason === "name-marker-not-a-part");
}

lines.unshift(`    nameMarker: ${passed} passed, ${failed} missed (${CASES.length} corpus cases — ${positives} positive, ${refusals} refusal — ${SABOTAGE.length} sabotage families, ${REFUSED.length} guard-refused devices)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
