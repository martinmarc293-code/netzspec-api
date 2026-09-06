// lib/portParse.ts — the dedicated parser for the `ports` / `uplink_ports` struct.
//
// WHY THIS EXISTS, AND WHY IT REFUSES SO MUCH
//
// specNormalize's struct branch used to end at:
//
//     return bad("STRUCT_UNPARSED", `${key}: struct field needs a dedicated parser`);
//
// with the reasoning that a port layout is "NOT reliably decomposable from prose ... and a wrong
// port map is worse than a recorded gap. Reported, never guessed." That judgement is right and
// this file keeps it. What was wrong was the consequence: `ports` is marked REQUIRED for
// switches, so every switch reported a gap that no amount of extraction could ever close, on the
// single most prominent specification a switch has. STRUCT_UNPARSED was also the largest
// normalise rejection in the whole pipeline (1,720). A required field that is unfillable by
// construction is not a recorded gap, it is a permanent one.
//
// So the rule here is not "parse harder". It is: accept ONLY segments where the source states
// both a count and a connector, and REFUSE the whole string otherwise. Partial credit is banned
// — if any segment of a string is unreadable the entire value is rejected, because a port list
// that silently drops its SFP row is a wrong answer that looks like a complete one.
//
// The single inference allowed is physical rather than statistical:
//
//   PoE is only defined over twisted pair (802.3af/at/bt all specify balanced copper cabling),
//   so a segment carrying a PoE token is RJ45 whether or not it says so.
//
// "24 GigE PoE" is therefore 24 x rj45. "24 GigE" alone is refused: on Cisco kit a GigE port is
// as likely to be SFP as RJ45, and choosing one would be exactly the guess this file exists to
// avoid.

export type PortGroup = { port_typ: string; speed: string[]; anzahl: number };

// Connector tokens, longest-first so "SFP+" is not consumed by "SFP" and "QSFP28" not by "QSFP".
const CONNECTORS: [RegExp, string][] = [
  [/\bQSFP-?DD\b/i, "qsfp-dd"],
  [/\bQSFP-?56\b/i, "qsfp-dd"],
  [/\bQSFP-?28\b/i, "qsfp28"],
  [/\bQSFP\+|\bQSFP-?PLUS\b/i, "qsfp-plus"],
  [/\bQSFP\b/i, "qsfp-plus"],
  [/\bSFP-?56\b/i, "sfp56"],
  [/\bSFP-?28\b/i, "sfp28"],
  [/\bSFP\+|\bSFP-?PLUS\b/i, "sfp-plus"],
  [/\bSFP\b/i, "sfp"],
  [/\bCOMBO\b/i, "combo"],
  // Copper is named many ways. Every one of these states twisted pair outright.
  [/\bRJ-?45\b/i, "rj45"],
  [/\b\d+\s*GBASE-?T\b/i, "rj45"],
  [/\b1000BASE-?T\b/i, "rj45"],
  [/\b100BASE-?TX?\b/i, "rj45"],
  [/\b10\/100\/1000\b/, "rj45"],
  [/\b10\/100\b/, "rj45"],
  [/\bmGig\b|\bMultigigabit\b/i, "rj45"],
  [/\b\d+GT\b/i, "rj45"],
  [/\b\d*GBT\b/i, "rj45"],            // Cisco shorthand: 1GBT is 1000BASE-T, i.e. copper
  [/\bcopper\b/i, "rj45"],
];

// PoE implies copper. This is the one inference in the file and it is a cabling standard, not a
// guess about Cisco's habits.
const POE = /\bU?PoE\+?\b|\bPOE\+?\b|\b802\.3(af|at|bt)\b/i;

// Speeds, as written. Kept as source tokens rather than normalised to a number because `speed`
// is a string list and "10/100/1000" is genuinely three speeds on one port.
//
// This started as a table of \b-anchored alternatives and every one of its failures came from
// \b, because the tokens it has to read are not word-shaped:
//
//   "4x10G"        — no boundary between "x" and "1", so \b10 never matched
//   "10GBASE-T"    — no boundary between "G" and "B", so 10G\b never matched
//   "10/100/1000"  — matched the 10/100 rule as well, yielding two contradictory speeds
//
// A digit-anchored scan with an explicit lookbehind reads all three correctly, and the
// slash-forms are handled first and exclusively so the longer one wins outright.
function speedsOf(seg: string): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s)) out.push(s); };
  if (/10\/100\/1000/.test(seg)) add("10/100/1000M");
  else if (/10\/100(?!\/)/.test(seg)) add("10/100M");
  if (/1000BASE-?T/i.test(seg)) add("1G");
  if (/100BASE-?TX?/i.test(seg)) add("100M");
  // "10G", "2.5G", "400G" wherever they sit in a token — but never the G of GHz.
  const re = /(?<![0-9.])(\d+(?:\.\d+)?)\s*G(?![Hh]z)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg))) add(`${m[1]}G`);
  // Only if nothing numeric was found: a bare "GigE"/"GE"/"Gigabit" is 1G by definition.
  if (!out.length && /\bGigabit\b|\bGigE\b|\bGbE\b|\bGE\b/i.test(seg)) add("1G");
  return out;
}

// THE COUNT MUST BE FOLLOWED BY SOMETHING PORT-SHAPED.
//
// The first version of this was `(?:^|[^0-9a-z])(\d{1,3})\s*(?:x|×)?` — take the first number in
// the segment — and on the 21 tidy port phrases in the test suite it was perfect. Run over the
// real corpus it read:
//
//     "Catalyst 2960-X 24 GigE PoE 110W"  ->  296 ports
//
// because the first number in a Cisco description is almost never the port count. It is the
// MODEL: 2960, 9300, 3850. `\d{1,3}` happily took "296" out of "2960" and the rest of the parser
// dutifully produced a confident, precise, completely fictional answer. Nothing in the suite
// could catch it, because no case in the suite had a product name in front of the ports — which
// is what every real description has.
//
// So the count is now anchored on both sides (it must be a WHOLE digit run, so "2960" is never
// read as "296") and must be FOLLOWED by a token that means ports: an "x" multiplier, the word
// port, or a connector/media name. "110W" is skipped because a W is not a port, "2960-X" because
// a model suffix is not a port, and "24 GigE" is taken because GigE is.
// The follower list deliberately does NOT include bare connector names. "NCS 560 Combo 8/16 port
// GE SFP" read 560 as a port count purely because the model happened to be followed by the word
// Combo, and "ASR 9000 400GE Combo Line Card" produced 400 combo ports at 9000G. A connector name
// sitting somewhere after a number is not evidence that the number counts ports; a multiplier,
// the word "port", Cisco's "p" suffix, or an explicit speed IS.
//
// The last alternative — a number followed by another number and a G — is what makes
// "6 100 GE QSFP28" read as six 100G ports rather than one hundred 6G ones.
const COUNT_FOLLOWER =
  "(?:x|×|-?\\s*ports?\\b|p(?![a-z])|\\s*(?:GigE|GbE|GE|Gigabit|Ethernet)\\b|" +
  "\\s*\\d+(?:\\.\\d+)?\\s*G(?![Hh]z)|\\s*\\d+\\s*GBASE-?T|\\s*10/100)";
// A COUNT MUST START A TOKEN. Not merely "not preceded by an alphanumeric" — that still allowed
// the count to be read out of the middle of a hyphenated part number:
//
//   "Cisco C9200L-24P-4G Managed Switch – 24× Gigabit-RJ45"   took the 24 of "-24P-", and then
//                                                             read "4G" as the speed
//   "Arista QDD-800G-2XDR4 ... Transceiver"                   took the 2 of "-2XDR4" and
//                                                             published 2 ports on an OPTIC
//
// On the C9200L the answer happened to be right, which is the worst kind of wrong: the rule was
// broken and the output looked correct. So the digit run must be preceded by whitespace, an
// opening bracket, a dash used as punctuation, or the start of the segment — never by the hyphen
// inside an identifier.
const COUNT = new RegExp(
  `(?<![^\\s(\\[\\u2013\\u2014:,])(\\d{1,4})(?![0-9])\\s*(?=${COUNT_FOLLOWER})`, "i");

// A number that OPENS a clause, followed by a bare connector name, is a count: "2 SFP+ uplinks".
// The same shape mid-sentence is usually a model — "NCS 560 Combo", "ASR 9000 400GE Combo" — so
// this second, more permissive reading is anchored to the start of the segment and tried only
// when the strict one finds nothing.
const COUNT_AT_START = new RegExp(
  "^(\\d{1,4})(?![0-9])\\s*(?=(?:x|×|-?\\s*ports?\\b|p(?![a-z])|" +
  "\\s*(?:RJ-?45|SFP|QSFP|Combo|mGig|Multigigabit|copper|GigE|GbE|GE|Gigabit|Ethernet)))", "i");

/** Split a port string into the segments that each describe one group of ports.
 *
 *  "with" is a separator as much as a comma is. Without it, "Catalyst 9300 24-port 1G copper
 *  with fixed 4x10G/1G SFP+ uplinks" was one segment, so the connector scan found the SFP+ at
 *  the far end and filed 24 COPPER access ports as 24 SFP+ ones — the count from one clause
 *  wearing the connector of another. */
function segments(s: string): string[] {
  return s
    // The "+" separator must have WHITESPACE BEFORE IT. Without that guard the "+" of "PoE+"
    // split "48-port PoE+ 4x10G fixed uplink" into two clauses, and the orphaned second clause —
    // which names no connector — then picked up copper from the string-wide PoE inference and
    // published the 10G SFP+ uplinks as RJ45.
    .split(/\s*(?:,|;|(?<=\s)\+(?=\s*\d)|\band\b|\bwith\b|\bplus\b|\/(?=\s*\d+\s*x))\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

export type PortParse =
  | { ok: true; value: PortGroup[] }
  | { ok: false; detail: string };

export function parsePorts(raw: string): PortParse {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, detail: "empty" };

  // A bare number is the most common thing a naive pattern produces, and the most dangerous:
  // "24" says nothing about what those 24 ports ARE, and this field is a layout, not a count.
  if (/^\d{1,3}$/.test(s)) return { ok: false, detail: `"${s}" is a count, not a port layout` };

  // "NCS 560 Combo 8/16 port GE SFP" describes an 8-port OR a 16-port variant. Which one this
  // SKU is cannot be read from the string, and picking either is a coin flip recorded as a fact.
  if (/\d+\s*\/\s*\d+\s*-?\s*ports?\b/i.test(s)) {
    return { ok: false, detail: `ambiguous port-count range in "${s}"` };
  }

  // THE PORTS DESCRIBED MAY BELONG TO A DIFFERENT PRODUCT.
  //
  // "SUP8E and MGIG upgrade for 10 slot chassis bundle (96 ports)" parsed cleanly as a 96-port
  // switch. It is a supervisor upgrade; the 96 ports belong to the chassis it goes into. Same for
  // a licence that names the chassis it licenses and a spare that names its parent. These are not
  // parse failures — the string really does say 96 ports — so no amount of care inside the parser
  // catches them. What disqualifies them is what KIND of thing the description is.
  if (/\blicen[cs]e|\blicensing\b|\bsubscription\b/i.test(s)) {
    return { ok: false, detail: `a licence has no ports of its own: "${s}"` };
  }
  if (/\bspares?\b/i.test(s) || (/\bupgrade\b/i.test(s) && /\bfor\b/i.test(s)) ||
      /\bfor\b[^,]*\bchassis\b/i.test(s)) {
    return { ok: false, detail: `ports belong to the parent product, not this one: "${s}"` };
  }

  // A TRANSCEIVER, OPTIC OR CABLE HAS NO PORT LAYOUT, and reading one produced the worst data in
  // the store. Same disqualification as the licence and the spare above — what rules it out is
  // what KIND of thing the description is, not a parse failure — and it is the fix for a defect
  // this project has already recorded as fixed once:
  //
  //     QSFP-100G-SR4-S    "...for 100 Gigabit Ethernet optical links, MMF, MPO connectors..."
  //                        -> {anzahl: 100, speed: ["1G"], port_typ: "qsfp-plus"}
  //     FN-TRAN-QSFPDD-SR8 "400 GE QSFP-DD-Transceiver, Multimode..."
  //                        -> {anzahl: 400, speed: ["1G"], port_typ: "qsfp-dd"}
  //
  // COUNT_FOLLOWER accepts a speed word after the number, so on a device string "24 GigE" is 24
  // ports and that is right — but on an OPTIC there is no count at all and the only number present
  // is the speed. The result is wrong in both fields at once: 100 ports AND 1G, on a single-port
  // 100G part. CLAUDE.md records `"6 100 GE"` read as one hundred 6G ports as fixed; it was fixed
  // for the shape that has a leading count and never for the shape that has none.
  //
  // Measured 6 Sep 2026 across the live store: of transceiver-shaped parts carrying a `ports`
  // fact, 94 had an `anzahl` that is a standard Ethernet SPEED (10/25/40/50/100/200/400).
  //
  // Breakout cables are refused too, and deliberately: "QSFP28 to 4x SFP28" does describe four
  // ends, so `anzahl: 4` reads as defensible — but `ports` is a DEVICE'S port layout, and a cable
  // has connectors, not ports. Recording a cable as a 4-port device is a category error that looks
  // right, which is the kind this field can least afford.
  if (/\btransceiver\b|\btransceivermodul|\bSFP-Modul|\boptic(?:al)? module\b|\bDAC\b|\bAOC\b|\bdirect[- ]attach|\bbreakout[- ]?(?:kabel|cable|DAC)|\bpatch ?(?:cord|kabel|cable)\b|\bpluggable\b/i.test(s)) {
    return { ok: false, detail: `a transceiver, optic or cable has no port layout of its own: "${s}"` };
  }

  // MUTUALLY EXCLUSIVE CONFIGURATIONS ARE A CAPABILITY STATEMENT, NOT A PORT LIST.
  //
  //     N9K-C93180LC-EX   "Nexus 9K Fixed with up to 32p 40/50G QSFP+ or up to 18p 100G QSFP28"
  //                       -> {anzahl: 32, speed: ["50G","100G"], port_typ: "qsfp28"}
  //
  // `segments()` splits on comma, "and", "with" and "plus" but not on "or", so both alternatives
  // land in one segment: the FIRST count wins, the connector scan takes the LAST connector, and the
  // speeds are merged ACROSS the two configurations. The stored fact then describes a device that
  // does not exist in either configuration - 32 ports of QSFP28 at 40/50/100G.
  //
  // Which configuration a given SKU ships as cannot be read from the string, so this is the same
  // coin flip the `8/16 port` range check above already refuses, written a different way. Refusing
  // it is a recorded gap; picking one is a fabrication that is indistinguishable downstream from a
  // measurement.
  //
  // A COUNT ON BOTH SIDES IS WHAT MAKES IT AN ALTERNATIVE, and the first version of this rule got
  // that wrong in the expensive direction. "any `or` near a connector" refused 100 live facts that
  // were CORRECT, almost all HPE and Aruba:
  //
  //     "20x 10/100/1000BASE-T + 4x Dual-Personality (RJ45 oder SFP, 1G)"
  //
  // That is a COMBO PORT - one physical port group offering two media - not two configurations of
  // the device. The 20 copper ports are real and the 4 combo ports are real, and refusing the whole
  // string would have destroyed exactly the facts the vendor with the largest `ports` gap does have.
  // Only the corpus replay showed it; the suite was 44/44 with the broad rule.
  //
  // A product-level alternative names a DIFFERENT COUNT on each side ("32p ... or ... 18p"). A combo
  // port names one count and two media. So the test is a count on both sides, not the word "or".
  const alts = s.split(/\s+(?:or|oder)\s+/i);
  if (alts.length > 1) {
    const withCount = alts.filter((a) => COUNT.test(a) || COUNT_AT_START.test(a));
    if (withCount.length > 1) {
      return { ok: false, detail: `mutually exclusive port configurations, and the string does not say which this SKU is: "${s}"` };
    }
  }

  const segs = segments(s);
  if (!segs.length) return { ok: false, detail: "no segments" };

  // PoE is read across the WHOLE string, not per segment. Cisco writes the capability as its own
  // clause — "CBS350 Managed 48-port GE, Full PoE, 4x10G SFP+" — where the PoE clause carries no
  // count of its own and the copper clause names no connector. Scoped per segment, that string
  // was refused outright even though between them the two clauses state the layout exactly.
  // Widening the scope is safe in the direction that matters: a segment that DOES name its
  // connector keeps it, so the SFP+ uplinks above are unaffected and only the segment with no
  // connector of its own can pick up the copper implied by PoE.
  const stringHasPoE = POE.test(s);

  const out: PortGroup[] = [];
  let poeInferredFor: string | null = null;
  for (const seg of segs) {
    // Ignore trailing prose that carries no count at all ("LAN Base", "no PS"). A segment is
    // only REQUIRED to parse if it looks like it is describing ports.
    const cm = COUNT.exec(seg) || COUNT_AT_START.exec(seg);
    const mentionsPorts = /\bports?\b/i.test(seg) || CONNECTORS.some(([re]) => re.test(seg));
    if (!cm && !mentionsPorts) continue;
    if (!cm) return { ok: false, detail: `segment has a port token but no count: "${seg}"` };

    const anzahl = Number(cm[1]);
    if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 576) {
      return { ok: false, detail: `implausible port count ${anzahl} in "${seg}"` };
    }

    // Read connector AND speed from the segment with the count token — and the "x" multiplier
    // that follows it — REMOVED. Two reasons, and the second is the one that bit:
    //   - the count must not also be read as a speed ("24 GigE" is 24 ports of 1G, not 24G);
    //   - "2xSFP" has NO word boundary between the x and the SFP, so every \b-anchored
    //     connector rule silently failed on it and the PoE fallback quietly relabelled a
    //     fibre uplink as copper. Stripping the multiplier restores the boundary.
    const after = seg.slice(cm.index + cm[0].length).replace(/^\s*[x×]\s*/i, " ");
    const rest = seg.slice(0, cm.index) + " " + after;

    let typ: string | null = null;
    for (const [re, t] of CONNECTORS) if (re.test(rest)) { typ = t; break; }
    if (!typ && stringHasPoE) {
      // The PoE inference may be used AT MOST ONCE per string. A description states PoE for its
      // access ports and names its uplinks separately, so exactly one connector-less clause can
      // legitimately claim the implied copper. A second one means the string is ambiguous about
      // which group the PoE belongs to -- and rather than hand the same inference to both, the
      // whole value is refused, in keeping with the no-partial-credit rule above.
      if (poeInferredFor) return { ok: false, detail: `two clauses with no connector; PoE cannot mean both ("${poeInferredFor}" and "${seg}")` };
      poeInferredFor = seg;
      typ = "rj45";
    }
    if (!typ) return { ok: false, detail: `no connector stated in "${seg}"` };

    // SPEED IS READ ONLY FROM THE TEXT AFTER THE COUNT, never from what precedes it.
    //
    // Product names carry the model in front, and Cisco and Aruba model numbers are full of
    // digit-G tokens: "Cisco C9200L-24P-4G Managed Switch – 24× Gigabit-RJ45" reported its 24
    // copper ports as 4G, because the "-4G" of the SKU is a perfectly good digit-then-G match.
    // Every real speed in this corpus follows its count ("24 GigE", "4x10G", "48 10GBASE-T"),
    // so the text before the count has nothing to contribute and plenty to get wrong.
    //
    // The CONNECTOR still uses the whole segment: connector names do not occur inside model
    // numbers, and "Gigabit-RJ45 24 ports" would otherwise lose its connector entirely.
    out.push({ port_typ: typ, speed: speedsOf(after), anzahl });
  }

  if (!out.length) return { ok: false, detail: `no port group found in "${s}"` };

  // Drop a group written twice IDENTICALLY (Cisco repeats "4 x 10G SFP+" across an uplink
  // sentence). Two groups sharing a connector and speed but differing in COUNT are not a
  // contradiction and must both survive: "24 GigE PoE ... 2x1GBT" is 24 access ports plus 2
  // uplinks, both 1G copper. Calling that a conflict rejected the whole string and discarded a
  // layout the source had stated perfectly clearly.
  const merged: PortGroup[] = [];
  for (const g of out) {
    const dup = merged.some((m) => m.port_typ === g.port_typ &&
      m.speed.join("|") === g.speed.join("|") && m.anzahl === g.anzahl);
    if (!dup) merged.push(g);
  }
  return { ok: true, value: merged };
}
