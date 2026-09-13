// src/core/nameMarker.ts — what the part's NAME says it is, when its SKU said nothing.
//
// fallback-kinds (12 Sep 2026)
//
// WHY THIS FILE EXISTS. `partKind(category, sku)` took a SKU and nothing else, and for the 6,301
// Cisco hardware parts that land in a FALLBACK kind the SKU is very often the only thing that says
// nothing. `videoKind.ts:16` recorded the consequence in its own header the day it was written —
// *"the name often says what the part is … but partKind() is handed the SKU only, so those parts
// fall to `unknown`"* — and the asked-nothing survey measured it: 1,624 of the residue have no
// description at all, the other 4,677 DO, and for the largest families it is the description and
// not the SKU that names the thing:
//
//   ordered SKU  4003543   "OADM,LGX-DWDM-ITU-16-SA"                      an optical passive
//   ordered SKU  3750136   "64607E Opt Tx, 1310nm, 870MHz, 13dBm, 20mW"   a transmitter, tx_power stored
//   UCSC-CABLE-A4=         "Pair of SAS/SATA cables (2 CPU) for C24 M3"    a cable, filed `accessory`
//   UCSC-RIS1C-225M8       "Cisco UCSC-RIS1C-225M8"                        nothing to read — stays put
//
// THE DISCIPLINE IS THE ONE `NAME_LICENSE_RULES` WAS BUILT ON (productClass.ts:1204): a name found
// each candidate family, the family was then READ IN FULL before a rule was written, and every rule
// was measured over all 91,543 live parts rather than over the category that produced it. The
// documented failure mode is specific and it is why the order below is what it is — *"a keyword
// classifier over the descriptions got that exact pair wrong, because an optic's description names
// the platform it plugs into as readily as a line card's does"*.
//
// TWO PROPERTIES MAKE THAT SAFE HERE, AND BOTH ARE STRUCTURAL RATHER THAN PROMISED:
//
//   1. A MARKER IS ONLY EVER CONSULTED WHERE THE AXIS ALREADY GAVE UP. partKind calls this after its
//      category axis has returned a FALLBACK kind (`unknown` / `other` / `component` / `accessory`).
//      A part the SKU already named keeps that name, so no rule here can overrule a verified SKU
//      rule — which is what protects `GS7K-OIB-4RX-2TX` (an interface board, not a transmitter) and
//      every other refusal the category agents wrote down.
//   2. A MARKER CAN ONLY ASK MORE WHERE THE AXIS CAN NAME THE KIND. `MARKER_TARGETS` lists candidate
//      kind NAMES in preference order and partKind takes the first one the category's own axis
//      declares. A marker whose targets a category does not have changes nothing at all.
//
// THE CONTROL IS IN tests/nameMarker.test.ts: over all 91,543 live parts, where the axis DOES name a
// kind, the marker must agree with it or be silent. Disagreement is the measured error rate of these
// rules, not a hypothetical — it found and fixed two rules while they were being written.

/** What a name can say a part is. Deliberately small: every member maps onto kinds that already exist. */
export type NameMarker =
  | "power-cord" | "cable" | "drive" | "memory" | "fan" | "antenna" | "optic" | "passive-optical"
  | "pdu" | "tpm" | "riser" | "power" | "server"
  | "mechanical";

export const NAME_MARKERS: readonly NameMarker[] = [
  "power-cord", "cable", "drive", "memory", "fan", "antenna", "optic", "passive-optical",
  "pdu", "tpm", "riser", "power", "server", "mechanical",
];

/**
 * The kind names each marker maps onto, in preference order; partKind takes the first one the
 * category's axis declares and otherwise leaves the fallback kind alone.
 *
 * WHY A LIST AND NOT ONE NAME. The eleven axes use different words for the same thing — a supply is
 * `power` in switchKind, `psu` in ucsKind and `power-supply` in collabKind — and a kind list that
 * named only one of them would silently reach one category in three. The names are checked against
 * the axes' own exported kind lists by tests/nameMarker.test.ts, in both directions, so a target
 * naming a kind no axis has is reported rather than being a line that can never fire.
 */
export const MARKER_TARGETS: Readonly<Record<NameMarker, readonly string[]>> = {
  // A MAINS CORD IS ITS OWN KIND on the axes that have one, and this pair is the largest single
  // finding of the control run: 461 parts whose SKU says `power-cord` were called `cable` by a rule
  // that read only the word "cable". Both answers are true and only one is the category's own.
  "power-cord": ["power-cord", "cable"],
  cable: ["cable", "power-cord", "stack-cable"],
  drive: ["drive"],
  memory: ["memory", "flash"],
  fan: ["fan"],
  antenna: ["antenna"],
  // A pluggable optic. `transceiver` is the collaboration axis's word for one.
  optic: ["pluggable", "optic", "transceiver"],
  // An OADM, mux/demux, WDM filter, attenuator or splitter: an optical part with no electronics.
  // `mux` is the optical-networking and interfaces-modules word, `passive` the video one.
  "passive-optical": ["mux", "passive"],
  // A rack power distribution unit. No axis claimed one before today; ucsKind names it now, and
  // elsewhere it falls to the supply kinds, which is where its input voltage and outlets belong.
  pdu: ["pdu", "power", "psu", "power-supply"],
  tpm: ["tpm", "security-module"],
  riser: ["io-module", "daughter", "module", "linecard"],
  power: ["power", "psu", "power-supply", "power-injector"],
  server: ["server", "chassis"],
  mechanical: ["mechanical"],
};

/**
 * KINDS NO SKU AXIS RETURNS, only a name.
 *
 * `mechanical` is the survey's P-1: 2,509 parts (measured after reclassify run 973) that are rack
 * kits, brackets, rails, covers, bezels, blanking panels, trays, air filters, fasteners, heat sinks
 * and grounding lugs — real hardware a reseller ships, sitting in `accessory` or `unknown` and asked
 * one cup or none. It is a NAME kind rather than an axis kind on purpose: every axis's `accessory`
 * rule was written, tested and signed off by another agent, and splitting it inside eleven files
 * would rewrite their refusals; splitting it here adds a kind and removes none.
 *
 * `pdu` and `tpm` are P-4: 38 rack power distribution units and 46 Trusted Platform Modules that NO
 * kind on any axis claimed. Both are real hardware with a real name ("Cisco RP208-30-U-2 Single
 * Phase PDU 4x C19, 12x C13", "TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M5 servers"). They
 * are listed for the three UCS-profile categories only, because that is where every one of them is
 * filed; elsewhere MARKER_TARGETS sends a PDU to the category's own supply kind.
 */
export const NAME_ONLY_KINDS: readonly string[] = ["mechanical"];
export const UCS_NAME_ONLY_KINDS: readonly string[] = ["pdu", "tpm"];

/** Case-insensitive whole-word test. `\b` is the wrong tool for product strings — see CLAUDE.md — so
 *  every boundary here is an explicit character class, and it is applied to NAMES, never to SKUs. */
const w = (s: string, ...words: string[]): boolean =>
  words.some((x) => new RegExp(`(^|[^a-z0-9])${x}([^a-z0-9]|$)`, "i").test(s));

/**
 * NAMES THAT MUST NEVER REACH A KIND RULE.
 *
 * partKind is handed every part whose stored class is `hardware`, and 303 of the 6,301 fallback rows
 * are licences, images, services and ordering artefacts that no reclassify run has moved yet (the
 * class table decides those, not this file). Without this veto the generic `kit` / `option` /
 * `replacement` rule at the foot of the table would give a licence a mounting cup, and the whole
 * point of a fallback kind is that it asks LESS. A veto can only ever ask less, so it is the safe
 * half of the classification question to answer here.
 *
 * These are the survey's b4/b5/b6 name shapes used as a VETO rather than as a class rule — the
 * distinction the survey's §5.1 insists on: `\blicense\b` catches 220 parts carrying a physical fact,
 * so it is far too wide to move a row's CLASS and exactly right for declining to add a cup.
 */
// device-noun (13 Sep 2026): `service` IS NOT A SERVICE WHEN A SLOT FOLLOWS IT. The ONS 15454 MSTP shelves are
// sized in "service slots", so "6 service slot MSTP chassis door" (15454-M6-DR) and "2-service-slot MSTP chassis
// fan tray filter" (15454-M2-FTF=) were vetoed as support contracts and kept `accessory` — eight doors and two
// filters the device-noun census flagged for the word "chassis". `(?![- ]slots?)` refuses only that phrase:
// "SmartNet 8x5xNBD service for Catalyst 9300" is still vetoed (tests/nameMarker.test.ts).
//
// AND `support` IS NOT SUPPORT WHEN IT IS A SUPPORT KIT. "MDS 9718 – Chassis Bottom Support Kit" (DS-C9718-BSK=)
// is a rack shelf. `support(?![- ]kits?)` refuses that phrase alone; "Docker EE Basic ... with Bus Day Support"
// stays vetoed.
const NOT_A_PRODUCT_NAME =
  /licen[sc]e|subscription|(^|[^a-z])lic([^a-z]|$)|(^|[^a-z])sw([^a-z]|$)|software|firmware|(^|[^a-z])image([^a-z]|$)|(^|[^a-z])svc([^a-z]|$)|(^|[^a-z])service(?![- ]slots?(?:[^a-z]|$))([^a-z]|$)|support(?![- ]kits?(?:[^a-z]|$))|warranty|smartnet|(^|[^a-z])training([^a-z]|$)|do not publish|obsolete pid|pid not used/i;

/**
 * The MARKER and ORDERING-ARTEFACT shapes the class table gains today (P-5 in the report), vetoed
 * here as well as classed there. A row a reclassify run will move off `hardware` is still `hardware`
 * until that run executes, and partKind is asked about it in the meantime: without this,
 * "Contains packing Kit For 2KI" becomes a mounting kit and is asked what it fits.
 */
const NOT_A_PRODUCT_NAME_2 =
  /^(?:regulatory domain configuration|bom level|base pid|contains packing)|(^|[^a-z])nal (?:certification )?labels?([^a-z]|$)|certification labels? for|(^|[^a-z])asset tab id label([^a-z]|$)|^\s*\^?(?:void|not used)|(^|[^a-z])(?:not in use|not orderable|do not order)([^a-z]|$)/i;

/**
 * THE MECHANICAL VETO. Every component rule below declines a name that says the part is the BRACKET,
 * the BLANK, the COVER, the TRAY, the CARRIER or the MOUNT for the thing it names — because the
 * mechanical rule at the foot of the table is the right answer for all of those and it runs LAST.
 *
 * Found by reading the 3,649 rows the name path moved, sorted by fact count (the standing rule: read
 * the real corpus output, sort by the value most likely to be wrong). Every line here is one:
 *
 *   FPR4K-SSD-BBLKD    "Cisco Firepower 4000 Series SSD Slot Carrier"      called a DRIVE
 *   ASA5585-BLANK-HD   "ASA 5585-X Hard Drive Blank Slot Cover"            called a DRIVE
 *   C9K-CMPCT-CBLE-GRD "Cable guard for compact switches"                  called a CABLE
 *   AIR-ACC15-GLANDS=  "Accessory, Metal Cable Glands, bag of 10 units"    called a CABLE
 *   AIR-ACC1725        "Magnetic Antenna Mount Base w/RP-TNC Connector"    called an ANTENNA
 *   NCS-PDU-BRK-MNT=   "NSC 6000 Rack-mount PDU Bracket Spare"             called a PDU
 *   UCSW-RACK31X       "UCS Invicta Rack With Side Panels"                 called a SERVER
 *   CBR-AC-PWR-TRAY    "Mechanical assembly - AC Power Supplies installed here"  called POWER
 *
 * `sled` and `tray` are deliberately NOT in the drive list: "250GB 6Gb SATA 7.2K RPM 2.5 HDD/hot
 * plug/drive sled mounted" is a real disk that ships in its sled, and a drive TRAY is likewise
 * usually the drive. Each list below is the tokens read off that family, not one shared set.
 */
const MECHANICAL_VETO = ["blank", "blanking", "blnk", "filler", "cover", "cvr", "bezel", "carrier",
  "bracket", "brackets", "brkt", "guard", "gland", "glands", "mount", "mounting", "rack-mount",
  "rackmount", "base", "panel", "pnl", "retainer", "arrestor", "arrester", "mechanical"];

/**
 * A DEVICE'S NAME LISTS WHAT IT CONTAINS AND WHAT PLUGS INTO IT, and that is the single biggest
 * source of error in any classifier built on descriptions. Measured by the control (all 36,149 Cisco
 * hardware parts whose SKU already names a kind, so the right answer is known independently) the
 * first draft of this file disagreed with the SKU 3,329 times — 9.21% — and seven of the ten largest
 * classes were one mistake:
 *
 *   UCSC-C220-M8S   "C220 M8 1RU standard server with up to 10x SFF drive bays"   -> called a DRIVE
 *   N9K-C93400LD-H1 "N9300 48p 50G, 4p 400G Switch w/o power supply, fans"        -> called a FAN
 *   C891FW-A-K9     "Cisco 891F Gigabit Ethernet security router with SFP …"      -> called an OPTIC
 *   UCSX-210C-M7-CH "UCS 210c M7 Compute Node w/o CPU, memory, storage …"         -> called MEMORY
 *   AIR-AP1572IC3-E "802.11ac Outdoor AP, Int-Ant, Cable EU-D3.0 65/108MHz"       -> called a CABLE
 *
 * So a name that names a DEVICE is not a component's name, and the component rules decline it.
 *
 * THE COMPATIBILITY CLAUSE IS CUT FIRST, or the veto eats the true positives instead. A real
 * component's name says what it fits — "TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M5 servers"
 * — and the device noun there belongs to the host, not to the part. Everything from the first
 * `for` / `for use with` / `compatible with` / `supported on` onwards is the host's half of the
 * sentence and is not read.
 *
 * `mechanical`, `server`, `pdu` and `tpm` are NOT vetoed, and each for a stated reason: a rack kit's
 * name is mostly the chassis it holds ("Catalyst 9400 Series 10 slot chassis Rack Mount" — 1,117 of
 * the a2 family read that way), an Invicta appliance IS a machine, and "PDU" and "TPM" are nouns no
 * device name carries in passing.
 */
const DEVICE_NOUN =
  /(^|[^a-z])(?:switch|switches|router|routers|server|servers|node|nodes|blade|blades|chassis|appliance|appliances|controller|firewall|access point|extender|director|transmitter|receiver|transponder|phone|handset|headset|camera|codec|endpoint|bundle|bundles)([^a-z]|$)/i;
/** Uppercase only: "AP" is a product noun, "ap" is three letters inside a dozen ordinary words. */
const AP_NOUN = /(^|[^A-Za-z])AP(?:s)?([^A-Za-z]|$)/;

/**
 * DEVICES THAT STATE THEIR OWN MOUNTING. An access point, a phone, a camera, a speaker, a display
 * and a sensor are sold WITH a mount, and their names say so — "CBW140AC 802.11ac 2x2 Wave 2 Access
 * Point Ceiling Mount", 104 rows. A chassis, a switch, a router or a server is not: for those the
 * same words name a separate product, which is the 1,117-row family this kind exists for ("Catalyst
 * 9400 Series 10 slot chassis Rack Mount"). So the bare MOUNT words are read for one list and not the
 * other, and the FIXING NOUNS (bracket, rail, railkit) are read for both — a device's name never
 * carries those.
 */
const SELF_MOUNTED_DEVICE =
  /(^|[^a-z])(?:access point|phone|camera|speaker|display|sensor|endpoint|headset|touch ?panel)([^a-z]|$)/i;
const MOUNT_WORDS = ["mount", "mounting", "mnt", "wallplate", "wall plate"];
const FIXING_NOUNS = ["bracket", "brackets", "brkt", "rail", "rails", "railkit", "slide", "rackmount",
  "rmk", "stand", "pedestal", "clamp", "strap",
  // device-noun (13 Sep 2026): rack EARS (CS-SWCH-RACKEAR= "Rackears for Ethernet Switch", CTS-SX80-RACKEARS=
  // "SX80 rack ears - Spare") and the cable management ARM (UCSC-CMAF-C4200 "Reversible CMA for C125 rack
  // server", HX-CMAF-M4= "Reversible CMA for C220 & C240 M4 & M5 rack servers"). Fixing hardware, and none
  // of these words occurs in a device's own name.
  "rackear", "rackears", "ears", "cma"];

/**
 * A NAME THAT LISTS THREE KINDS OF COMPONENT IS ENUMERATING A CONFIGURATION, not naming one part.
 * This is the half of the device veto that no noun could catch, and it is where the control's two
 * largest remaining classes were:
 *
 *   "UCS C240 M3 NEBS SFF 16 HDD backplane w/o CPU, mem, HD, PCIe, PS"   drive, memory, pcie, power
 *   "UCS C240M4L w/2xE52620v4, 8x16GB mem, 12x4TB SAS, VIC1227"          memory, drive, nic
 *   "Cisco 2921 w/ 3 GE, 4 EHWIC, 3 DSP, 256MB CF, 512MB DRAM, IPB"      memory, flash, module
 *
 * Neither name contains a device noun; both are a bill of materials. Three classes, not two: a real
 * component's name routinely mentions one neighbour ("RAID SAS card"), and two is common enough
 * ("Pair of SAS/SATA cables (2 CPU)") that a floor of two would eat true positives.
 */
const COMPONENT_CLASSES: RegExp[] = [
  /(^|[^a-z])(?:cpu|cpus|processor|xeon|epyc)([^a-z]|$)/i,
  /(^|[^a-z])(?:dimm|dimms|rdimm|lrdimm|udimm|dram|mem|memory)([^a-z]|$)/i,
  /(^|[^a-z])(?:hdd|ssd|sas|sata|nvme|drives?|disks?)([^a-z]|$)/i,
  /(^|[^a-z])(?:gpu|gpus)([^a-z]|$)/i,
  /(^|[^a-z])(?:psu|psus|(?:ac|dc)\s?ps|power suppl\w+)([^a-z]|$)/i,
  /(^|[^a-z])(?:nic|vic|mlom|ocp)([^a-z]|$)/i,
  /(^|[^a-z])(?:pcie|pci-e|mezz|riser)([^a-z]|$)/i,
  /(^|[^a-z])(?:fan|fans)([^a-z]|$)/i,
  /(^|[^a-z])(?:cf|flash)([^a-z]|$)/i,
  // Module and interface SLOTS, which are a chassis's own vocabulary: "Cisco 2921 w/ 3 GE, 4 EHWIC,
  // 3 DSP, 1 SM, 256MB CF, 512MB DRAM" is a router, and DRAM + CF alone is only two classes.
  /(^|[^a-z])(?:ehwic|nim|hwic|dsp|sfp|qsfp|ge|gbe)([^a-z]|$)/i,
];
const listsAConfiguration = (head: string): boolean =>
  COMPONENT_CLASSES.filter((re) => re.test(head)).length >= 3;

/**
 * THE PART'S OWN HALF OF ITS NAME. Every rule in this file reads this and not the raw name, and it
 * is the single change that took the control's contradiction rate from 9.21% to its final figure.
 *
 * A Cisco name is two sentences joined: what the thing IS, then what it fits, contains, includes or
 * lacks. The second half names OTHER products, and a rule that reads it classifies the neighbours:
 *
 *   "Cisco Catalyst 9130AXE w/Stadium Antenna, -C reg domain"      an AP,       called an ANTENNA
 *   "4000W AC PowerSupply, International (cable included)"         a supply,    called a CABLE
 *   "2.4-GHz directional antenna with 2 orthogonally polarized ports. Comes with two 30-in. cables"
 *                                                                  an antenna,  called a CABLE
 *   "Cisco 7925G Japan; CM UL; Battery/PS Not Included"            a phone,     called a POWER part
 *   "Nexus 9K …,Spare(No Acc kit,PS&fan)"                          a switch,    called a FAN
 *
 * Three cuts, each earned by one of those classes:
 *   1. a COMPATIBILITY clause — `for`, `for use with`, `compatible with`, `supported on`. What
 *      follows is the host. This is also what keeps the true positives: "TPM 2.0, TCG, FIPS140-2,
 *      CC EAL4+ Certified, for M5 servers" keeps its own half and stays a TPM.
 *   2. an INCLUSION clause — ` w/ `, ` with `, `incl`, `includes`, `comes with`. What follows is the
 *      bill of materials.
 *   3. the CLAUSE CONTAINING A NEGATION — `w/o`, `without`, `no`, `not included`, `excludes`, and
 *      also `included`/`attached` (a parenthetical "(cable included)" is about a cable in the box,
 *      not about this part). A name that lists what is ABSENT is a configuration statement, and the
 *      absent thing is exactly what a keyword rule reads.
 *
 * THE THIRD CUT GOES BACK TO THE START OF THE CLAUSE, not to the negation word, and that detail was
 * a measured 44-row regression when it was wrong. Cutting at the word left "Battery/PS" standing in
 * "Cisco 7925G Japan; CM UL; Battery/PS Not Included", and dropping only the negated SEGMENT of
 * "UCS 210c M7 Compute Node w/o CPU, memory, storage" threw away the words "Compute Node" — the
 * identity — and kept "memory, storage", so the veto lost its evidence and the rule fired. Walking
 * back to the previous `,` `;` or `(` keeps the identity or keeps nothing, and keeping nothing is the
 * safe direction: a fallback kind asks less.
 */
export function ownHalf(name: string): string {
  let s = String(name ?? "");
  const cut = /(^|[\s,;(])(?:for use (?:with|in|on)|compatible with|compatible for|supported on|for|with|incl|incl\.|includes|including|comes with|requires|required for)(?=[\s,:./]|$)/i.exec(s);
  // device-noun (13 Sep 2026): A CLAUSE AT THE VERY START HAS NO PART BEFORE IT TO CUT BACK TO. N20-CAK0 is
  // "FOR YES blade bundles - Access./rail kit UCS 5108 chassis": cutting at index 0 left the empty string, so
  // the rail kit was read as saying nothing and stayed `unknown`. Keeping the whole name is what every other
  // path does with an unreadable head.
  if (cut && cut.index > 0) s = s.slice(0, cut.index);
  const wSlash = /(^|[\s,;(])w\/o?/i.exec(s);
  if (wSlash) s = s.slice(0, wSlash.index);
  const neg = /(?:^|[^a-z])(?:w\/o|without|no|not|non|excludes?|excl|included|attached)(?:[^a-z]|$)/i.exec(s);
  if (neg) {
    const back = Math.max(s.lastIndexOf(",", neg.index), s.lastIndexOf(";", neg.index), s.lastIndexOf("(", neg.index));
    s = s.slice(0, back < 0 ? 0 : back);
  }
  return s.trim();
}

const namesADevice = (head: string): boolean =>
  DEVICE_NOUN.test(head) || AP_NOUN.test(head) || listsAConfiguration(head);

/** Markers that a device noun in the part's own half of the name vetoes. See namesADevice. */
const VETOED_BY_DEVICE_NOUN: ReadonlySet<NameMarker> =
  new Set<NameMarker>(["power-cord", "cable", "drive", "memory", "fan", "antenna", "optic", "passive-optical", "riser", "power"]);

/**
 * Ordered; the FIRST rule that matches wins. The order IS the argument — see each note.
 * `despiteDeviceNoun` opts one rule out of the device veto, for a phrase that means the part IS the
 * component even though the name also says what it sits in ("Chassis Fan Tray Assembly").
 */
const RULES: { marker: NameMarker; hit: (n: string) => boolean; despiteDeviceNoun?: boolean }[] = [
  // A MAINS CORD before a data cable, so a category that names both gets the right one.
  // "Pwr Cord", "Cord Pwr", "Pwr cable" are as common in this catalogue as "Power Cord" — 60 rows of
  // the control run were the abbreviation alone.
  { marker: "power-cord", hit: (n) => /(?:power|pwr)\s*(?:cord|cable)|cord\s*pwr|(?:^|[^a-z])(?:ac|dc)\s*(?:power\s*)?cord(?:[^a-z]|$)|(?:^|[^a-z])mains(?:[^a-z]|$)/i.test(n) },
  // CABLE before everything mechanical, because a cable's name is unambiguous and its own kind
  // already exists on every axis. The exclusions are the survey's, read off the corpus: a cable
  // MANAGEMENT kit, a cable HOLDER, a cable TRAY and a cable GUIDE are mechanical parts that happen
  // to name a cable — `CBR-CABLE-UCH8` is a "Universal Cable Holder", and videoKind already records
  // the same refusal for the SKU form.
  {
    marker: "cable",
    hit: (n) => w(n, "cable", "cables", "cbl", "cord", "cords", "jumper", "harness", "pigtail", "loopback")
      && !w(n, "kit", "management", "mgmt", "holder", "tray", "guide", "clip", "duct", "hanger")
      && !w(n, ...MECHANICAL_VETO),
  },
  // DRIVE. `sas`/`sata` name the INTERFACE, so they appear in the name of everything on the far end
  // of it: a cable ("Pair of SAS/SATA cables", which is why cable runs first), a RAID or HBA
  // controller card ("RAID SAS 2008M-8i Mezz Card", 49 rows of the control), a backplane, an
  // expander. Each of those has its own kind and none of them is a disk.
  {
    marker: "drive",
    hit: (n) => w(n, "ssd", "hdd", "drive", "drives", "disk", "nvme", "sata", "sas")
      && !w(n, "raid", "hba", "mezz", "mezzanine", "backplane", "expander", "controller", "riser")
      && !w(n, ...MECHANICAL_VETO),
  },
  { marker: "memory", hit: (n) => w(n, "dimm", "dram", "memory", "udimm", "rdimm", "sodimm") && !w(n, ...MECHANICAL_VETO) },
  // FAN, excluding the air FILTER, the fan TRAY's blank and a fan COVER — mechanical parts named
  // after the fan they sit in front of. videoKind's own note records the mirror case: its accessory
  // rule's TRAY token took the fan tray in the first census, so there the fan rule runs first.
  { marker: "fan", hit: (n) => w(n, "fan", "fans", "blower", "blowers") && !w(n, "filter", "blank", "blnk", "cover", "cvr") },
  // A FAN TRAY IS A FAN, and it has to be claimed here to beat the mechanical `tray` token below —
  // 70 rows ("NCS 4000 Centralized Fabric Chassis Fan Tray Assembly", "NCS 5500 1RU Chassis Fan Tray
  // Port-S Intake"). It needs its own entry because the device-noun veto declines the rule above:
  // the name says "Chassis", which is true and is not what the part is. videoKind records the mirror
  // case for SKUs — its accessory rule's TRAY token took the fan tray in the first census.
  //
  // THE QUANTITY IS THE REFUSAL. "Cisco Nexus 2224TP Series 1GE Fabric Extender, 2 AC PS, 1 Fan
  // Module" is a fabric extender that CONTAINS one fan module, and a counted component is always the
  // host's bill of materials, never the part's own name.
  {
    marker: "fan",
    despiteDeviceNoun: true,
    hit: (n) => /(?:^|[^a-z])(?:fan|blower)\s*(?:tray|module|assembly|assy|unit)(?:[^a-z]|$)/i.test(n)
      && !/(?:^|[^a-z0-9])\d+\s?x?\s?(?:fan|blower)/i.test(n) && !w(n, "filter", "blank", "blnk", "cover", "cvr"),
  },
  { marker: "antenna", hit: (n) => w(n, "antenna", "antennas", "radome") && !w(n, ...MECHANICAL_VETO) },
  // A PLUGGABLE OPTIC. Before passive-optical: "SFP" is specific, and a name carrying both
  // ("CWDM SFP") is a pluggable.
  //
  // A PORT COUNT MEANS IT IS THE HOST, NOT THE OPTIC — the last of the control's classes, 79 rows:
  // "ASR 900 8 port 10GE SFP+ Interface Module" is a line card WITH SFP+ ports, and
  // "NCS 5700 400G CFP2 DCO & 400G QSFP-DD MPA" is a modular port adapter. No pluggable's own name
  // states how many ports it has, so `port` and `interface module` decline the rule outright.
  {
    marker: "optic",
    hit: (n) => w(n, "transceiver", "sfp", "qsfp", "xfp", "gbic", "xenpak", "cfp", "cfp2")
      && !w(n, "port", "ports") && !/interface module|(?:^|[^a-z])MPA(?:[^a-z]|$)/i.test(n),
  },
  // AN OPTICAL PASSIVE, by an explicit passive noun ONLY.
  //
  // THE FIRST DRAFT ALSO READ A BARE `CWDM` / `DWDM` AND THAT WAS WRONG IN BOTH DIRECTIONS, 470 rows
  // of the control: "GS7000 ANALOG DWDM TX, 1544.53NM" is a TRANSMITTER and
  // "GS7000,4x,TPs,Fb/Tr,42/54,8p,SA,Rx,CWDM1510/1550,2PS" is a NODE — in cable plant the WDM grid is
  // stated on everything that touches it, so the token names the technology and never the part. What
  // survives is the nouns: an OADM, a mux/demux, an attenuator, a splitter, a combiner, dispersion
  // compensating fibre, and the `MXDX` token (the survey's c6 missed "LGX-MXDX" and "CAS-MXDX"
  // because the token is not the word "mux" and has no boundary where a word rule looks).
  // AND AN OPTICAL FILTER IS A PASSIVE, NOT AN AIR FILTER. `1030030` "40 channel filter ITU 20—59
  // inclusive - DTP-UG-EXP-LC/APC" was called `mechanical` by the air-filter token at the foot of the
  // table, so `filter` is claimed HERE when the name carries an optical qualifier — a channel, an ITU
  // slot, a wavelength in nm, a WDM grid or an APC/UPC fibre connector — and nowhere else.
  {
    marker: "passive-optical",
    hit: (n) => (w(n, "oadm", "mux", "demux", "attenuator", "splitter", "combiner", "multiplexing", "multiplexer")
      || /MXDX|(?:^|[^a-z])DCF(?:[^a-z]|$)|(?:^|[^a-z])[CDi]?WDM\s*(?:mux|demux|filter|coupler)(?:[^a-z]|$)/i.test(n)
      || (w(n, "filter") && /(?:^|[^a-z])(?:ITU|[CDi]?WDM)(?:[^a-z]|$)|\d+\s?nm(?:[^a-z]|$)|channel|pass ?band|[SLF]C\/[AU]PC/i.test(n)))
      && !w(n, ...MECHANICAL_VETO),
  },
  // A RACK PDU. No kind on any axis claimed one until today: "10A Metered Input 1-Phase 8x C13,
  // 2x C19 - 0U PDU", "Cisco RP208-30-U-2 Single Phase PDU 4x C19, 12x C13".
  { marker: "pdu", hit: (n) => (w(n, "pdu") || /power distribution unit/i.test(n)) && !w(n, ...MECHANICAL_VETO) },
  // A TRUSTED PLATFORM MODULE: "TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M5 servers".
  { marker: "tpm", hit: (n) => w(n, "tpm") || /trusted platform module/i.test(n) },
  // A RISER, mezzanine or backplane — and not the BLANK that fills an empty riser slot:
  // "C240 M5 PCIe Riser Blanking Panel" is a piece of sheet metal, and mechanical claims it below.
  {
    marker: "riser",
    hit: (n) => w(n, "riser", "risers", "mezzanine", "backplane", "midplane")
      && !w(n, "blank", "blanking", "blnk", "filler", "cover", "cvr", "panel", "pnl"),
  },
  // A SUPPLY, a power-entry module, a rectifier, a PoE injector, and the battery / cache-backup /
  // supercapacitor family, which is a power part on every axis that has one. AFTER the mechanical
  // tokens a supply's blank carries? No — before them, because "Power Supply Blank Slot Cover" must
  // be MECHANICAL, so the BLANK/COVER test has to come first for that one string. It does not:
  // `blank` and `cover` are tested in the mechanical rule BELOW this one, so the veto is explicit
  // here instead, and tests/nameMarker.test.ts pins FPR3K-PSU-BLANK to `mechanical`.
  {
    marker: "power",
    // `power\s*suppl`, not `power suppl`: "4000W AC PowerSupply, International" is written without the
    // space and the first draft read straight past it.
    hit: (n) => (/power\s*suppl|(^|[^a-z])psu([^a-z]|$)|(^|[^a-z])pem([^a-z]|$)|rectifier|power injector/i.test(n)
      || w(n, "battery", "batteries", "bbu", "supercap", "capacitor"))
      && !w(n, ...MECHANICAL_VETO) && !w(n, "tray", "rail", "rails"),
  },
  // THE UCS INVICTA / WHIPTAIL FLASH APPLIANCES — real machines ("UCS Invicta C3124SA 24TB
  // Appliance - K9", "UCSW Whiptail Invicta 12TB Intel Based SSN ATO Model K9"), 151 of them, every
  // one filed `accessory` or `unknown` today because the SKU prefix names no UCS machine token.
  // "UCS Invicta Rack With Side Panels" and "UCS Invicta 1U Rack Blanking Panel" carry the family name
  // and are a rack and a blank: the mechanical veto applies here too.
  {
    marker: "server",
    hit: (n) => (w(n, "invicta", "whiptail", "accela") || /(^|[^a-z])ATO Model(?:[^a-z]|$)/i.test(n))
      && !w(n, ...MECHANICAL_VETO) && !w(n, "rack"),
  },
  // MECHANICAL, LAST, and it is the generic catch: everything a reseller ships that is metal or
  // plastic and holds, covers, blanks, fills, carries, cools-by-baffling or fastens something else.
  // The survey's a1-a9 buckets in one rule, in their own order, because the FIRST four tokens are
  // the unambiguous ones and `kit` / `option` / `replacement` (a8, 532 rows) names no noun at all
  // and must be tested only after every other rule has declined.
  {
    marker: "mechanical",
    hit: (n) => w(n, "blank", "blanking", "filler", "blnk")
      // MOUNTING HARDWARE — and every token here names the FIXING, never the place it is fixed to.
      // A bare `rack` / `shelf` / `wall` / `desk` / `table` was in the first draft and it took two
      // real machines with it: "UCS C460 M2 Rack Server with DVD-RW and 1 PSU" and "Cisco Hyperflex
      // HX Compute M6 Blade and Rack server MLB" are servers whose FORM is rack, called mounting
      // hardware by the word "Rack". Nothing is lost by dropping them, because every compound a
      // mounting part actually carries contains one of the surviving tokens: "Rack Mount",
      // "Rack-mount kit", "Wall Mount", "In-Ceiling Mounting Bracket", "Shelf Install Kit",
      // "Railkit", "WALL-MNT". Checked against the 1,117-row a2 family, not reasoned about.
      || w(n, ...FIXING_NOUNS)
      || (w(n, ...MOUNT_WORDS) && !(SELF_MOUNTED_DEVICE.test(n) || AP_NOUN.test(n)))
      // PLURALS, and they were not a detail: "CRS-1 Fabric Chassis Front Doors" reads `doors`, which no
      // singular token matches, so a chassis door set stayed in `accessory` while the census flagged it
      // for having the word "Chassis" in its name.
      || w(n, "cover", "covers", "cvr", "bezel", "bezels", "door", "doors", "lid", "lids", "cap", "caps",
        "dust", "grill", "grille", "grilles", "faceplate", "faceplates", "panel", "panels", "pnl", "shield", "shields")
      || /(?:^|[^a-z])heat ?sink(?:[^a-z]|$)|(?:^|[^a-z])thermal(?:[^a-z]|$)/i.test(n)
      // `sled` is NOT here: a DRIVE sled is mechanical and a "UCS C885A M8 CPU SLED" is a compute
      // module, 80 rows of the control. `tray` is, and its one cost is the fan tray — which the fan
      // rule above claims first, exactly as videoKind records for the SKU form.
      || w(n, "tray", "carrier", "cage", "enclosure", "housing", "crate", "packaging")
      // `baffles`: "Set of spare Air Baffles for C220 Server" (UCSC-AIRBAF-C220) — the plural no singular matched.
      || w(n, "filter", "airflow", "baffle", "baffles", "duct", "vent")
      // device-noun (13 Sep 2026): the handling and cable-routing hardware of the big chassis, each read off a
      // family the census flagged for its host's name. A TROUGH routes cables ("NCS 6008 Chassis Trough Spare",
      // five rows), a LIFT and its DOLLY move a chassis ("NCS 6008 & NCS Fabric Chassis Lift Dolly", "CRS-1
      // Transport Lift", "CRS Lift upgrade to NCS 6008 ..."), a SCREEN guards an air opening ("CRS-1 8 slots
      // Chassis Air Opening protection Screen"), a FLANGE is sheet metal ("Kit, Chassis, Flange Green, PII"),
      // and a TAMPER seal is a FIPS label set ("Tamper Proof for 80/18/28/38/72/73 Routers and ASA").
      // SCREEN ONLY AS A GUARD: a bare `screen` was measured first and took SPK-SHARE-K9 "Cisco Webex Share
      // wireless screen-sharing adapter" (an HDMI dongle) and the Avizia "1 screen-PC cabinet" carts.
      || w(n, "trough", "troughs", "dolly", "lift", "flange", "tamper")
      || /(?:^|[^a-z])(?:protection|inlet|air)\s+screens?(?:[^a-z]|$)/i.test(n)
      // A 2- or 4-POST rack kit states its posts: "Cisco C9610 Series Smart Switches 23\" 2 post"
      // (C9610-23-KIT-2=); its siblings say "10 slot chassis 2 post 23-inch Rack Mount".
      || /(?:^|[^a-z0-9])[24][- ]post(?:[^a-z]|$)/i.test(n)
      // `clip` and `tie` are NOT here: "CLIP Chan 33, Long Range, Unprotected, SC Connector" is an
      // optical CLIP card family, and "tie" is three letters inside a dozen product words.
      || w(n, "handle", "screw", "screws", "nut", "bolt", "washer", "spacer", "shim", "gasket", "latch",
        "fastener", "template", "crowbar", "tool")
      || w(n, "grounding", "ground", "gnd", "lug", "earthing")
      // Guards, glands, retainers, arrestors: the parts named after what they protect. Each is in
      // MECHANICAL_VETO above (so a cable GUARD is not a cable) and has to be claimed here too, or
      // the veto merely silences the row instead of naming it.
      || w(n, "guard", "gland", "glands", "retainer", "arrestor", "arrester")
      // THE GENERIC CLAUSE IS THE ONLY ONE A DEVICE NOUN VETOES, and the split is the point.
      // `kit` / `accessory` / `spare` / `option` / `replacement` names no noun at all (the survey's
      // a8 bucket, 532 rows), so beside a device noun it is the DEVICE's kit:
      //   15454W-2X100G-SK  "2x 100G LR4 LH Transponder - Starter Kit"   is a transponder bundle
      // The specific clauses above are NOT vetoed, because a mounting kit's name is mostly the
      // chassis it holds — "Catalyst 9400 Series 10 slot chassis Rack Mount", 1,117 rows — and
      // vetoing those would empty the family this kind exists for.
      //
      // `spare`, `option` and `replacement` ARE NOT IN IT, and their removal is the largest single
      // correction the control made. They say what an order LINE is, never what the thing is:
      // "NCS 5504 second-generation Fabric Card Spare" is a fabric card, and 224 line cards, 61
      // supervisors and 40 modules were called mounting hardware by the word "Spare" alone. It is
      // the same fact the catalogue states another way — `X=` is the spare orderable of `X`, the
      // SAME hardware — so "spare" is a relation to a part, never a kind of part (R3).
      // THE NAMED CISCO KIT FORMS, which are mechanical whatever else the name says. They are read
      // BEFORE the device veto because a mechanical kit's name is its host — "Nexus 5548 Chassis
      // Accessory Kit", "Catalyst 9400 Series 7 slot chassis Shelf Install Kit", "Firepower 9300
      // Chassis FIPS Kit", "CRS-1 Fabric Chassis Rear Cosmetic Kit", "Line Card Chassis Rear Cable
      // Mgmt", "CRS-1 4 Slot System Fujitsu Chassis Labels". The census found 164 of these sitting in
      // `accessory` and flagged every one for naming a device, which is exactly what they do.
      //
      // The COMPOUND is what makes them safe: bare `kit` stays vetoed, because "2x 100G LR4 LH
      // Transponder - Starter Kit" is a transponder bundle and nothing about it is mechanical.
      // device-noun (13 Sep 2026) adds four compounds, each the kit form of a family whose siblings are already
      // `mechanical`: NEBS ("Cisco C9610 Series Smart Switches NEBS kit"; C3650-NEBS-KIT= "Catalyst 3650 NEBS
      // Kit"), SUPPORT ("MDS 9718 – Chassis Bottom Support Kit"), UPGRADE ("CRS 16 slots chassis Enh. Upgrade
      // Kit"; CRS-16-140G-UPG "CRS Series 16 Slot Upgrade Kit 140G") and FRONT TO BACK ("Catalyst 9600 Series
      // 6-slot chassis Front to Back Kit"). A bare `kit` stays vetoed by the device noun.
      || /(?:^|[^a-z])(?:acc|accessory|accy|acy|install|instal|shelf|fips|cosmetic|rack|rail|hardware|nebs|support|upgrade|front to back)\s*-?\s*kits?(?:[^a-z]|$)|(?:^|[^a-z])(?:cable|cbl)\s*(?:management|mgmt)(?:[^a-z]|$)|(?:^|[^a-z])labels?(?:[^a-z]|$)|(?:^|[^a-z])accessor(?:y|ies)(?:[^a-z]|$)/i.test(n)
      || (w(n, "kit", "acc") && !namesADevice(n)),
  },
];

const NONE: ReadonlySet<NameMarker> = new Set();

/**
 * What the name says the part is, or undefined when it says nothing this file will act on.
 *
 * `disabled` exists for the sabotage cases in tests/nameMarker.test.ts only: switching a rule family
 * off must turn that family's positive cases red, or it is a rule nobody has seen work.
 */
export function nameMarker(name: string, disabled: ReadonlySet<NameMarker> = NONE): NameMarker | undefined {
  const n = String(name ?? "").trim();
  if (n === "") return undefined;
  // The licence / software / service veto reads the WHOLE name: a licence is a licence whichever half
  // of the sentence says so, and this veto can only ever ask less.
  if (NOT_A_PRODUCT_NAME.test(n) || NOT_A_PRODUCT_NAME_2.test(n)) return undefined;
  const head = ownHalf(n);
  if (head === "") return undefined;
  const device = namesADevice(head);
  for (const r of RULES) {
    if (disabled.has(r.marker)) continue;
    if (device && VETOED_BY_DEVICE_NOUN.has(r.marker) && !r.despiteDeviceNoun) continue;
    if (r.hit(head)) return r.marker;
  }
  return undefined;
}

/**
 * True when the name carries nothing but the SKU — "Cisco UCSC-RIS1C-225M8". 1,157 of the 6,301
 * fallback rows are this shape, and for them there is nothing to read: they are reported as their own
 * number rather than folded into a percentage, because an unread row is not a clean row.
 */
export function nameIsJustTheSku(sku: string, name: string): boolean {
  const flat = (x: string) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = flat(name);
  return n === "" || n === flat(`Cisco ${sku}`) || n === flat(sku);
}
