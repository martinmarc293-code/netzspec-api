// scripts/universe/portParse.test.mjs — proof for lib/portParse.ts.
//
//   npx tsx scripts/universe/portParse.test.mjs
//
// Half of these cases assert a REFUSAL. That is the point: the field this parser fills was
// deliberately left unparsed for years on the grounds that "a wrong port map is worse than a
// recorded gap", and the only thing that makes it safe to fill now is that the refusals are
// tested as hard as the successes. A parser that quietly returned 24 x something for
// "24 GigE" would pass a suite made only of the strings it handles.
//
// Every input below is real Cisco description or datasheet text.
import { parsePorts } from "../src/core/portParse.js";

const g = (port_typ, speed, anzahl) => ({ port_typ, speed, anzahl });

const cases = [
  // ---- must PARSE -------------------------------------------------------------------------
  { in: "24 x 10/100/1000 RJ45", want: [g("rj45", ["10/100/1000M"], 24)] },
  { in: "4x10G SFP+", want: [g("sfp-plus", ["10G"], 4)] },
  { in: "48-port GE, Full PoE, 4x10G SFP+",
    want: [g("rj45", ["1G"], 48), g("sfp-plus", ["10G"], 4)] },
  { in: "8-port SFP, Ext PS, 2x1G Combo",
    want: [g("sfp", [], 8), g("combo", ["1G"], 2)] },
  { in: "24 Ethernet 10/100/1000 PoE+ ports, 2 SFP+ uplinks",
    want: [g("rj45", ["10/100/1000M"], 24), g("sfp-plus", [], 2)] },
  { in: "48 x 10GBASE-T", want: [g("rj45", ["10G"], 48)] },
  { in: "32 x QSFP28", want: [g("qsfp28", [], 32)] },
  { in: "6 x QSFP-DD", want: [g("qsfp-dd", [], 6)] },
  // PoE is only defined over twisted pair — the one inference this file allows.
  { in: "24 GigE PoE 370W", want: [g("rj45", ["1G"], 24)] },
  // ruling (c), 29 Sep 2026 — the two misreads that blocked the lan/wan conversion, both real stored values.
  // MX85: two groups with no separator. The connector is the one IN each group's clause, not the first in list order.
  { in: "8 x Dedicated 1 Gigabit Ethernet RJ45 2 x Dedicated 1 Gigabit Ethernet SFP",
    want: [g("rj45", ["1G"], 8), g("sfp", ["1G"], 2)] },
  // C897VAG-LTE: a PoE OPTION on four of the eight ports is not four more ports.
  { in: "8-port 10/100/ 1000-Mbps managed switch With 4-port Power over Ethernet (PoE) option",
    want: [g("rj45", [], 8)] },
  { in: "4-port 10/100-Mbps managed switch With 2-port Power over Ethernet  (PoE) option",
    want: [g("rj45", ["10/100M"], 4)] },
  // CONTROL: a glued multiplier after the first count is a count-and-speed token, never a new group.
  { in: "Catalyst 9300 24-port 1G copper with fixed 4x10G/1G SFP+ uplinks",
    want: [g("rj45", ["1G"], 24), g("sfp-plus", ["10G", "1G"], 4)] },
  { in: "24p mGig UPOE", want: [g("rj45", [], 24)] },

  // ---- WHOLE REAL DESCRIPTIONS, product name and all ---------------------------------------
  // Every case above this line was a tidy port phrase, and the parser passed all of them while
  // reading "Catalyst 2960-X 24 GigE" as 296 ports — because the first number in a real Cisco
  // description is the MODEL, not the port count. A suite made only of clean inputs certifies
  // the easy half of the problem. These are the strings the pipeline actually receives.
  { in: "Catalyst 2960-X 24 GigE PoE 110W, 2xSFP + 2x1GBT, LAN Base",
    want: [g("rj45", ["1G"], 24), g("sfp", [], 2), g("rj45", ["1G"], 2)] },
  { in: "Catalyst 2960-X 48 GigE PoE 740W, 2 x 10G SFP+, LAN Base",
    want: [g("rj45", ["1G"], 48), g("sfp-plus", ["10G"], 2)] },
  { in: "Catalyst 9300 48-port PoE+, Network Advantage",
    want: [g("rj45", [], 48)] },
  { in: "Cisco SG350-10P 10-port Gigabit POE Managed Switch",
    want: [g("rj45", ["1G"], 10)] },
  { in: "Catalyst 3850 24 Port PoE IP Base", want: [g("rj45", [], 24)] },
  // A model number with no port information at all must produce nothing, not a model-shaped count.
  { in: "Catalyst 9200 Network Essentials", refuse: "no port group" },
  { in: "Nexus 93180YC-EX", refuse: "no port group" },

  // ---- FOUND BY READING REAL OUTPUT, not by imagining inputs -------------------------------
  // Each of these produced a confident, precise, wrong answer on the live corpus. The suite was
  // green at the time; none of these shapes had occurred to me.
  // "6 100 GE" — the count and the speed are adjacent numbers and were read the wrong way round.
  { in: "Cisco Nexus 93108TC-FX3 switch with 48 10GBASE-T and 6 100 GE QSFP28 ports",
    want: [g("rj45", ["10G"], 48), g("qsfp28", ["100G"], 6)] },
  { in: "Cisco Nexus 93600CD-GX switch with 28 100 GE QSFP28 and 8 400 GE QSFP-DD",
    want: [g("qsfp28", ["100G"], 28), g("qsfp-dd", ["400G"], 8)] },
  { in: "Nexus 9K Fixed with 96p 1/10G/25G SFP and 12p 40G/100G QSFP28",
    want: [g("sfp", ["10G", "25G"], 96), g("qsfp28", ["40G", "100G"], 12)] },
  { in: "Cisco 8100 2 RU Chassis with 64x100GbE QSFP28",
    want: [g("qsfp28", ["100G"], 64)] },
  // The connector came from a DIFFERENT clause than the count: 24 copper ports were filed as SFP+.
  { in: "Catalyst 9300 24-port 1G copper with fixed 4x10G/1G SFP+ uplinks, data only",
    want: [g("rj45", ["1G"], 24), g("sfp-plus", ["10G", "1G"], 4)] },
  // A model number followed by a connector word is still a model number.
  { in: "ASR 9000 400GE Combo Service Edge Line Card - 5 th Generation", refuse: "implausible" },
  // "8/16 port" is two variants; choosing one would be a coin flip recorded as a fact.
  { in: "NCS 560 Combo 8/16 port GE SFP/C-SFP and 1 port 10GE SFP+", refuse: "ambiguous port-count range" },

  // A digit-G token inside the MODEL NUMBER is not a speed. "C9200L-24P-4G" reported its 24
  // copper ports as 4G until speeds were read only from the text after the count.
  { in: "Cisco C9200L-24P-4G Managed Switch (L3) – 24× Gigabit-RJ45 (PoE+, 30 W) + 4× 1G-SFP",
    want: [g("rj45", ["1G"], 24), g("sfp", ["1G"], 4)] },
  { in: "Cisco C9200-48P Managed Switch (L3) – 48× Gigabit-RJ45 (PoE+, 30 W)",
    want: [g("rj45", ["1G"], 48)] },
  // A transceiver part number ending "-2XDR4" is not two ports. Published 2 ports on an OPTIC
  // until the count was required to start a token.
  //
  // It is now refused one step EARLIER and for a better reason: it is a transceiver, and a
  // transceiver has no port layout at all. The count-anchoring rule that used to catch it still
  // exists and still matters for device strings; this string simply never reaches it. The expected
  // reason is updated rather than relaxed — a refusal for the wrong reason is a miss in this
  // suite, and the whole point is that the reason is the finding.
  { in: "Arista QDD-800G-2XDR4 800G QSFP-DD800 100GBASE-FR-Transceiver", refuse: "no port layout of its own" },

  // ---- the two shapes that were live in the store, wrong in BOTH fields --------------------
  // "100 Gigabit Ethernet" is a SPEED. COUNT_FOLLOWER accepts a speed word after a number because
  // on a DEVICE string "24 GigE" really is 24 ports — but on an optic there is no count at all and
  // the only number present is the speed, so it was read as one. Stored: 100 ports at 1G, on a
  // single-port 100G part. Wrong in both fields at once.
  { in: "Cisco SR4 QSFP transceiver module for 100 Gigabit Ethernet optical links, Multi-Mode Fiber (OM4 MMF), MPO connectors, up to 100 m.",
    refuse: "no port layout of its own" },
  { in: "Fortinet FN-TRAN-QSFPDD-SR8 400 GE QSFP-DD-Transceiver – Multimode-Glasfaser, MPO-16 APC, 100 m",
    refuse: "no port layout of its own" },
  // A breakout cable DOES have four ends, so anzahl 4 reads as defensible - and `ports` is a
  // DEVICE'S layout. A cable has connectors, not ports. Recording it as a 4-port device is a
  // category error that looks right.
  { in: "Extreme 100G-DACP-QSFP4SFP1M 100G Breakout-DAC QSFP28 auf 4x SFP28 passives Direct-Attach-Kupferkabel",
    refuse: "no port layout of its own" },
  // MUTUALLY EXCLUSIVE CONFIGURATIONS. The first count won, the last connector won, and the speeds
  // were merged ACROSS both alternatives - describing a device that exists in neither.
  { in: "Nexus 9K Fixed with up to 32p 40/50G QSFP+ or up to 18p 100G QSFP28",
    refuse: "mutually exclusive port configurations" },

  // ---- must REFUSE ------------------------------------------------------------------------
  // A bare count is what a naive description pattern produces. It is a count, not a layout.
  { in: "24", refuse: "count, not a port layout" },
  { in: "10", refuse: "count, not a port layout" },
  // GigE alone does not state a connector: on Cisco kit it is as likely SFP as RJ45.
  { in: "24 GigE", refuse: "no connector stated" },
  { in: "48 Ethernet ports", refuse: "no connector stated" },
  // The number belongs to something else entirely.
  { in: "6 slot chassis", refuse: "no port group" },   // "slot" is not a port token, so no count is even taken
  { in: "8 x 10GT FEXes with FETs", parseOk: true },   // 10GT IS twisted pair — see note below
  // Nothing here describes ports at all.
  { in: "Mounting Kit For CISCO7609/Cat6509-NEB-A chassis", refuse: "belong to the parent product" },
  { in: "SUP8E and MGIG upgrade for 10 slot chassis bundle (96 ports)", refuse: "belong to the parent product" },
  { in: "DWP dot1x License for Cat2k 48 port", refuse: "licence has no ports" },
  { in: "LAN Base", refuse: "no port group" },
  { in: "", refuse: "empty" },
  // Implausible counts are a sign the number was read from the wrong token.
  { in: "9999 x SFP+", refuse: "implausible" },
  // Partial credit is banned: one unreadable segment rejects the whole string, because a list
  // that silently drops a row is a wrong answer wearing the costume of a complete one.
  { in: "24 x RJ45, 4 x 10G", refuse: "no connector stated" },

  // ---- routers-r5 (12 Sep 2026) — three defects the live corpus showed and no tidy case could.
  // Each was measured by replaying parsePorts over all 3,253 stored ports/uplink_ports facts and
  // reading every row that moved (33 rows; runs/reports/schema-routers-r5-2026-09-12.md).

  // A. `\b` could not see QSFP-DD800, so an 800G cage fell through to the bare-QSFP rule and was
  //    stored as qsfp-plus (40G). All four spellings must reach the same cage.
  //    SABOTAGE: reverting that rule to /\bQSFP-?DD\b/i breaks this ONE case and no other — which
  //    is exactly the size of the measured defect (3 facts, all QSFP-DD800). "QSFP56-DD" below
  //    survives the revert because the QSFP-56 rule catches it, so it is a control, not a proof.
  { in: "64x800G QSFP-DD800", want: [g("qsfp-dd", ["800G"], 64)] },
  { in: "32x400G QSFPDD", want: [g("qsfp-dd", ["400G"], 32)] },
  { in: "8x400GE QSFP56-DD", want: [g("qsfp-dd", ["400G"], 8)] },
  { in: "4 x QSFP-DD", want: [g("qsfp-dd", [], 4)] },
  //    REFUSAL of the wider form: a bare QSFP is NOT a QSFP-DD and must stay qsfp-plus, or the
  //    fix for the 800G cage would relabel every 40G uplink in the catalogue.
  { in: "6 x QSFP+", want: [g("qsfp-plus", [], 6)] },
  { in: "2 ports QSFP", want: [g("qsfp-plus", [], 2)] },

  // B. "&" is a separator. Without it one segment held two port groups: the first count, the LAST
  //    connector, and the speeds merged ACROSS both — a device that exists in no configuration.
  { in: "8x400GE QSFP56-DD&24x100GE QSFP28",
    want: [g("qsfp-dd", ["400G"], 8), g("qsfp28", ["100G"], 24)] },
  { in: "48 x SFP+ & 6 QSFP+ ports",
    want: [g("sfp-plus", [], 48), g("qsfp-plus", [], 6)] },
  //    REFUSAL: an ampersand NOT followed by a digit is part of a name, not a separator, and must
  //    not break a clause apart. "R&D" keeps its one group.
  { in: "24 x 10/100/1000 RJ45 R&D sample", want: [g("rj45", ["10/100/1000M"], 24)] },

  // C. A gigaBYTE is not a speed. "Dual 8GB GE SFP" stored speed 8G on eight 1G SFP ports, while
  //    the same router without the memory in its name stored the correct 1G.
  { in: "ISR 1100 8P Dual 8GB GE SFP Higher Perf Router", want: [g("sfp", ["1G"], 8)] },
  { in: "32p 400/100-Gbps QSFP-DD ports and 2p 1/10 SFP+ ports (32GB memory)",
    want: [g("qsfp-dd", [], 32), g("sfp-plus", [], 2)] },
  //    REFUSALS of the wider form — every one of these B's IS part of a speed token, and a
  //    case-insensitive or letter-blind guard silently deletes it:
  { in: "48 x 10GBASE-T", want: [g("rj45", ["10G"], 48)] },
  { in: "2x1GBT uplinks", want: [g("rj45", ["1G"], 2)] },
  // Gb is a gigaBIT and the 10G must survive. (The cage is sfp-plus: the connector scan is
  // longest-name-first, so SFP+ beats the trailing "Copper" of a direct-attach description.)
  { in: "2port 10Gb SFP+ Copper", want: [g("sfp-plus", ["10G"], 2)] },
  { in: "32x400GbE QSFP56-DD", want: [g("qsfp-dd", ["400G"], 32)] },

  // ---- phase-1 close §5.2 item 4 (13 Sep 2026): separators and truncation --------------------------
  // Every input is a literal stored raw. Each was red against the 1.6.2 parser.
  //
  // D. "FE" counts Fast Ethernet ports. The stored fact kept only the 2 combo uplinks and lost the 24
  //    access ports, because "24FE" had no count reading and the clause was refused.
  { in: "CGS2520 with 24FE Copper & 2 GE combo uplinks",
    want: [g("rj45", ["100M"], 24), g("combo", ["1G"], 2)] },
  //    "12FE/GE SFP" is ONE group of dual-rate SFP ports: both rates, not the first one.
  { in: "IE5000 with 12GE Copper PoE+, 12FE/GE SFP & 4 1G SFP uplinks",
    want: [g("rj45", ["1G"], 12), g("sfp", ["100M", "1G"], 12), g("sfp", ["1G"], 4)] },
  //    REFUSAL twin: FE is a SPEED word, never a connector. "48 FE" names no media and stays refused,
  //    exactly as "24 GigE" alone is.
  { in: "Catalyst 2960-SF 48 FE, 4 x SFP, LAN Base", refuse: "no connector stated" },
  //    REFUSAL twin: the trailing boundary keeps a count of fabric extenders out.
  { in: "N6004 Chassis with 8 FEX modules", refuse: "no port group" },
  //
  // E. A count of CABLES is not a count of ports. Nine UCS 5108 chassis stored 4 SFP ports from this
  //    string (retracted by scripts/bundle-plan-facts.mts; the parser would have re-stored them).
  { in: "UCS SP Select 5108 AC2 Chassis w/2208 IO, 4x SFP cable 3m", refuse: "a count of cables" },
  { in: "UCS SP Select 5108 DC Chassis w/ 2208 IO, 4xSFP cable3m", refuse: "a count of cables" },
  //    German compounds end in "kabel": the Fortinet MPO breakout stored ONE HUNDRED SFP+ ports.
  { in: "Fortinet FG-CABLE-SR10-SFP+ 100 GE MPO-Breakout-Glasfaserkabel zu 10x 10 GE SFP+ – OM3, 1 m",
    refuse: "a count of cables" },
  //    CONTROL: a real port clause beside a cable clause survives — only the cable clause is skipped.
  { in: "Blade chassis with 8 x 10G SFP+ ports, 4x SFP cable 3m", want: [g("sfp-plus", ["10G"], 8)] },
  //
  // F. PoE spent on a clause that names its own connector is not lent to the next clause. Before, the
  //    3650's 4x10G uplinks (SFP+ on the hardware) were filed as copper through the access ports' PoE.
  { in: "Standalone with Optional Stacking 48 10/100/1000 Ethernet PoE+ and 4x10G Uplink ports, with 640WAC power supply",
    refuse: "no connector stated" },
  { in: "IE2000 w/ 16FE Copper (4 PoE+) & 2GE uplinks (Lan Lite Base)", refuse: "no connector stated" },
  //    CONTROLS: a PoE clause with no connector of its own still lends copper, once.
  { in: "Catalyst 2960-SF 48 FE, PoE 740W, 4 x SFP, LAN Base",
    want: [g("rj45", ["100M"], 48), g("sfp", [], 4)] },
  //    ...and the two spellings the restriction exposed now state copper themselves.
  { in: "Cisco C9200CX-8P-2X2G Managed Switch (L3) – 8× Gigabit-RJ45 (PoE+, 30 W) + 2× 10G-SFP+ (Uplink) + 2× 1G-Kupfer",
    want: [g("rj45", ["1G"], 8), g("sfp-plus", ["10G"], 2), g("rj45", ["1G"], 2)] },
  { in: "16 ports 10/100/1000M PoE+ and 8 ports 100/1000/2500M 4PPoE (up to 90W/port)",
    parseOk: true },
];

let pass = 0;
const misses = [];
for (const c of cases) {
  const r = parsePorts(c.in);
  if (c.want) {
    if (!r.ok) { misses.push(`  ${JSON.stringify(c.in)}\n      wanted a parse, got REFUSED: ${r.detail}`); continue; }
    const got = JSON.stringify(r.value), want = JSON.stringify(c.want);
    if (got !== want) { misses.push(`  ${JSON.stringify(c.in)}\n      wanted ${want}\n      got    ${got}`); continue; }
    pass++;
  } else if (c.parseOk) {
    if (r.ok) pass++;
    else misses.push(`  ${JSON.stringify(c.in)}\n      wanted a parse, got REFUSED: ${r.detail}`);
  } else {
    if (r.ok) { misses.push(`  ${JSON.stringify(c.in)}\n      wanted REFUSAL (${c.refuse}), got ${JSON.stringify(r.value)}`); continue; }
    if (!r.detail.toLowerCase().includes(c.refuse.toLowerCase())) {
      misses.push(`  ${JSON.stringify(c.in)}\n      refused for the WRONG reason\n      wanted ~"${c.refuse}"\n      got    "${r.detail}"`);
      continue;
    }
    pass++;
  }
}

const refusals = cases.filter((c) => c.refuse).length;
if (refusals < 9) misses.push(`  suite has only ${refusals} refusal cases (expected >= 9)`);

console.log(`portParse: ${pass}/${cases.length} cases (${refusals} of them refusals)`);
if (misses.length) { console.log("\nMISSES:\n" + misses.join("\n")); process.exit(1); }
console.log("every refusal was for the stated reason");
