// src/core/listShapes.ts — a LIST cup can be defined by a SHAPE as well as by a domain.
//
// WHY A SHAPE AND NOT A DOMAIN, for these four keys specifically. `certifications`, `emc_emissions`,
// `ieee_standards` and `supported_protocols` are required cups with no domain, so nothing could ever
// refuse a wrong value written into them. The obvious fix -- enumerate what is stored -- is wrong
// here and wrong in the direction nobody notices: 37-69% of their stored facts were truncated at 160
// characters (see docs/decisions/2026-09-27-the-160-cap-was-a-scalar-bargain-applied-to-lists.md), and
// truncation removes tokens from the END. A vocabulary built from cut values therefore cannot contain
// any token that only ever appears past character 160, so the domain would be too NARROW and would
// start refusing real facts the moment the re-extraction recovers them.
//
// A shape does not have that failure mode. Truncation changes which tokens survive; it does not change
// the FORM of the ones that do. `EN 55032 Class A` is the same shape whether or not the three entries
// after it were cut off.
//
// THE REGISTRATION IS NOT A DECLARATION. A shape counts as a definition only if it REFUSES something --
// `shapeIsDefinition` below requires a non-empty refuse fixture set and checks every fixture behaves.
// A rule that is total over its input makes its own coverage check unable to fail, which this repo has
// paid for twice (the `presentFormFactor` rule that uppercased four values it was never written for,
// and the guard whose condition began "if the signal is present"). `.*` must fail, mechanically.
//
// NO `\b` ANYWHERE. `EN61000-3-2` has no word boundary between `N` and `6`; `AS/NZS` has none around
// the slash; `802.3ab` has none between the digits and the letters. Every rule anchors on `^`/`$` over
// a whole member, or on an explicit character class.

/** Three populations, not two. A member that is neither accepted nor refused is UNCLASSIFIED and gets
 *  read by a person -- it is never silently dropped into either bucket. And a token that looks like the
 *  TAIL OF A CUT is flagged, never refused: `100` and `IE` are where `100BASE-T…` and `IEEE…` were
 *  severed, so refusing them deletes the evidence of a truncation rather than junk. */
export type MemberVerdict = "accept" | "refuse" | "flagged" | "unclassified";

export type ListShape = {
  readonly note: string;
  /** A member of this shape is a legal value of the cup. */
  readonly accept: RegExp;
  /** The wreckage of the 160-character cap or of the list splitter. Counted and reported, NEVER refused. */
  readonly flagged: RegExp;
  /** Positively junk: prose poured into the cup, a header, a unit phrase. */
  readonly refuse: RegExp;
  /** Fixtures are part of the registration. `refuse` must be non-empty or the shape is not a definition. */
  readonly fixtures: { readonly accept: readonly string[]; readonly refuse: readonly string[]; readonly flagged: readonly string[] };
};

// The issuer table, READ off the corpus rather than recalled: these are the leading tokens of the
// stored members, by frequency, across every vendor [M 2026-09-27, 846 + 196 distinct members].
//   EN 3,577  IEC 1,550  UL 1,408  CISPR 1,019  FCC 838  AS/NZS 1,231  CE 512  CSA 489
//   CAN/CSA 437  GR- 433  ICES 1,045  TCVN 333  VCCI 739  SR- 244  KN 429  CNS 199  CFR 176  ETSI 204
// The close relatives that did not appear are included deliberately and marked: a standards issuer the
// corpus has not met yet is not an illegal value, and this is the direction a shape is allowed to be
// generous in, unlike a domain.
const ISSUER = [
  // measured in the corpus
  "EN", "IEC", "UL", "CISPR", "FCC", "AS/NZS", "NZS", "CSA", "CAN/CSA(?:-C)?", "GR", "ICES", "TCVN",
  "VCCI(?:-V)?", "SR", "KN", "CNS", "CFR", "ETSI", "IEEE", "KS ?C", "ANSI", "TIA", "ISO", "ITU(?:-T)?",
  // not yet met in this corpus; a shape may be generous where a domain may not
  "BSMI", "NOM", "EAC", "RCM", "VDE", "TUV", "NEMA", "GB", "JIS", "SANS", "IS", "UKCA",
].join("|");

/** A standalone conformance MARK carries no number: `CE`, `RoHS`, `UKCA`. Kept separate from the
 *  numbered issuers so that a bare `EN` -- an issuer torn from its number by the splitter -- does NOT
 *  match here and is flagged instead. That distinction is the whole reason this list is explicit. */
const MARK = "CE|RoHS|REACH|WEEE|UKCA|ATEX|IECEx|FCC|Energy ?Star|EPEAT|80 ?PLUS|NEBS(?: Level ?[123])?";

// A numbered standard: issuer, a number, then any of the suffixes the corpus actually writes --
// `-3-2`, ` Part 15`, `:2015`, ` Class A`, ` Second Edition`, ` Annex B`.
const NUMBERED = new RegExp(
  "^(?:" + ISSUER + ")" +
  "[ \\-]?[0-9][0-9A-Za-z.\\-/]*" +
  "(?:[ \\-]?(?:Part|Teil|Pt\\.?) ?[0-9A-Za-z.\\-]+)?" +
  "(?:[ ]?[:\\-][ ]?(?:19|20)[0-9]{2}(?:\\+A[0-9]+)?)?" +
  "(?:[ ,]+(?:Class|Klasse) ?[A-Z12](?:/[A-Z12])?)?" +
  "(?:[ ,]+(?:Second|Third|Fourth|1st|2nd|3rd) ?Edition)?" +
  "(?:[ ,]+Annex ?[A-Z](?:/[A-Z])*)?" +
  "\\.?$", "i");

const STANDALONE_MARK = new RegExp("^(?:" + MARK + ")(?:[ ,]+(?:Class|Klasse) ?[A-Z12])?\\.?$", "i");

/** The tail of a cut, or a member the splitter tore apart. NOT junk -- evidence. An issuer with no
 *  number (`EN`, `AS`, `KN`, `IEC`) is exactly what `AS/NZS CISPR 22` looks like after a bad split, and
 *  a bare numeral or a two-letter stub is where a 160-character cap severed a token. */
const TRUNCATION_SHAPED = new RegExp(
  "^(?:" +
  "[0-9]{1,4}" +                                   // `100`, `802`, `2015`
  "|(?:" + ISSUER + ")" +                          // `EN`, `IEC`, `AS`, `KN` with nothing after them
  "|[A-Z]{1,3}" +                                  // `IE`, `LH`, `DD` -- but see classifyMember: the
  ")\\.?$", "i");                                  // known-vocabulary check runs FIRST, so RPC/FTP survive

/** A bullet that survived the list splitter, anywhere in the member. The splitter is supposed to have
 *  consumed these; 265 members across the four keys still carry one, which is a defect UPSTREAM of this
 *  file. Flagged so the count is visible, never refused, because refusing it hides the splitter bug. */
const CARRIES_BULLET = /[●•▪·‣◦]/;

/** Prose poured into a specification cup. Derived from the members actually stored: section headings
 *  (`Safety:`, `Emissions`), quantities (`0 to 40C`, `100-240 VAC`) and sentence fragments. */
const PROSE = new RegExp(
  "^(?:" +
  "(?:Safety|Emissions?|Immunity|Compliance|Standards?|Certifications?|Regulatory|Approvals?)[: ]*$" +
  "|.*(?:°|deg(?:rees)? ?[CF]|VAC|VDC|Hz\\b|kg|lbs?)\\.?$" +
  "|(?:and|or|the|with|for|per|including|includes|up to|see|refer) .*" +
  ")", "i");

export const LIST_SHAPES: Readonly<Record<string, ListShape>> = {
  certifications: {
    note: "Issuer-prefixed identifier (EN 60950-1, UL 60950-1, AS/NZS CISPR 32 Class A) or a standalone mark (CE, RoHS). Issuer table read off 846 distinct stored members.",
    accept: new RegExp(NUMBERED.source + "|" + STANDALONE_MARK.source, "i"),
    flagged: new RegExp(TRUNCATION_SHAPED.source, "i"),
    refuse: PROSE,
    fixtures: {
      accept: ["EN 60950-1", "EN61000-3-2", "UL 60950-1", "ICES-003 Class A", "TCVN 7189 Class A",
               "AS/NZS CISPR 32 Class A", "IEC 60950-1 Second Edition", "CE", "RoHS", "NEBS Level 3"],
      refuse: ["Safety:", "0 to 40 degrees C", "100-240 VAC", "and the following standards", "Emissions"],
      flagged: ["2", "1997", "EN", "AS", "IE"],
    },
  },
  emc_emissions: {
    note: "The emissions half of the same issuer grammar (EN 55032, CISPR 32 Class A, 47CFR Part 15, VCCI Class A). Same table; a different cup only because the datasheet splits the section.",
    accept: new RegExp(NUMBERED.source + "|" + STANDALONE_MARK.source + "|^47 ?CFR(?: Part ?[0-9]+)?(?: \\(CFR ?47\\))?(?:[ ,]+Class ?[A-Z])?\\.?$", "i"),
    flagged: new RegExp(TRUNCATION_SHAPED.source, "i"),
    refuse: PROSE,
    fixtures: {
      accept: ["EN55032 Class A", "CISPR 32 Class A", "VCCI Class A", "KN32", "47CFR Part 15 (CFR 47) Class A"],
      refuse: ["Emissions", "Voltage fluctuations and flicker", "100-240 VAC"],
      flagged: ["AS", "NZS", "2015", "EN"],
    },
  },
  ieee_standards: {
    note: "802.x with its letter suffix, or a bare IEEE number (1588, 1613). The media names that share the cell (1000BASE-T) are accepted too: they are what the standard is FOR and the corpus writes them as members.",
    accept: /^(?:IEEE ?)?(?:802\.[0-9]{1,2}[a-z]{0,4}(?:-(?:19|20)[0-9]{2})?|[0-9]{3,4}(?:\.[0-9]+)?[a-z]{0,3}|[0-9]{1,4}ase-?[a-z0-9]{1,4}|[0-9]{1,4}base-?[a-z0-9]{1,4})\.?$/i,
    flagged: new RegExp(TRUNCATION_SHAPED.source, "i"),
    refuse: PROSE,
    fixtures: {
      accept: ["IEEE 802.3ab", "802.1AB", "IEEE 802.3at", "1000BASE-T", "100BASE-TX", "IEEE 1588"],
      refuse: ["Spanning tree per port", "full-duplex operation on 10BASE-T", "Safety:"],
      flagged: ["100", "802", "IE"],
    },
  },
  supported_protocols: {
    note: "NOT the same kind of cup as the other three: an OPEN acronym vocabulary (IPv4, NetFlow, ITU Y.1731, RFC 2544) contaminated with sentence fragments (LAYER 278, STATIC 217, OPEN 208). The accept shape is therefore token-shaped rather than issuer-prefixed, and the unclassified list is expected to be the large one -- which is the honest outcome, not a failure of the grammar.",
    accept: /^(?:(?:IEEE ?)?802\.[0-9]{1,2}[a-z]{0,4}|RFC ?[0-9]{1,5}|ITU(?:-T)? ?[A-Z]\.[0-9]{1,4}(?:\.[0-9]+)?|IPv[46]|[A-Z][A-Za-z0-9]{1,9}(?:[ \-/][A-Za-z0-9]{1,9}){0,2})\.?$/,
    flagged: new RegExp(TRUNCATION_SHAPED.source, "i"),
    refuse: PROSE,
    fixtures: {
      accept: ["IPv4", "NetFlow", "IEEE 802.3ah", "ITU Y.1731", "RFC 2544", "SNMPv3"],
      refuse: ["Layer 2 and Layer 3 switching", "0 to 40 degrees C", "including the following"],
      flagged: ["100", "3"],
    },
  },
};

/** Vocabularies a SHORT member may legitimately belong to. Checked BEFORE the truncation rule, because
 *  `RPC` and `FTP` are three-letter PROTOCOLS while `IE` and `LH` are three-letter wreckage, and no rule
 *  about LENGTH can tell them apart. Measured: the 1-3 character members of these four cups hold all
 *  three populations at once -- real protocols, issuers torn from their numbers, and cut tails. */
const SHORT_BUT_REAL = new Set([
  "rpc", "ftp", "tftp", "sftp", "ssh", "ssl", "tls", "sip", "rtp", "udp", "tcp", "ip", "arp", "ntp",
  "dns", "dhcp", "lldp", "cdp", "stp", "rstp", "mstp", "vtp", "lacp", "pim", "igmp", "mld", "bgp",
  "ospf", "isis", "rip", "eigrp", "hsrp", "vrrp", "glbp", "gre", "mpls", "vpls", "qos", "acl", "aaa",
  "poe", "usb", "ipv4", "ipv6", "nat", "pat", "bfd", "ldp", "rsvp", "sctp", "smtp", "http", "snmp",
]);

// ---- extraction, not whole-string matching ---------------------------------------------------
//
// The first version of this file tested `accept` against the WHOLE member and left 531 of 846
// certifications members unclassified. Reading them showed they were not unclassified at all, they
// were un-EXTRACTED: the corpus writes IDENTIFIER PLUS DESCRIPTION in one member --
// `IEEE 802.3ab 1000BASE-T Gigabit Ethernet`, `Open Shortest Path First (OSPF)`,
// `CAN/CSA-C222.2 No. 60950-1`. The reviewer had already ruled on exactly this: the cup stores the
// IDENTIFIER, the prose after it is a description the renderer owns, and the normaliser "takes
// identifier-plus-description as one token and keeps the identifier".
//
// So the accept side extracts rather than matches. That is the difference between a grammar that
// refuses truth and one that reads it -- and it is NOT the same as a wider regex, because an
// extraction still fails when there is no identifier to find.

/** An issuer, optionally qualified by a second issuer (`AS/NZS CISPR 32`, `CAN/CSA-C22.2 No. 60950-1`),
 *  then a number. Anchored at the START of the member; whatever follows is the description. */
const ID_NUMBERED = new RegExp(
  "^(?:" +
  // NUMBER-FIRST, and the only such form this corpus writes: `47CFR Part 15`, `21 CFR 1040`.
  // It earns an explicit clause because widening the issuer rule to admit a leading digit would let
  // any number at the head of a member look like a standard.
  "[0-9]{1,3} ?CFR(?: ?Part)? ?[0-9][0-9A-Za-z.\\-]*" +
  "|(?:" + ISSUER + ")(?:[ /\\-](?:" + ISSUER + "))?" +
  "[ \\-]?(?:No\\.? ?)?[0-9][0-9A-Za-z.\\-/]*" +
  ")", "i");

/** A conformance mark that carries no number at all. Separate from ID_NUMBERED so that a bare `EN`
 *  -- an issuer the splitter tore from its number -- still falls through to the flagged branch. */
const ID_MARK = new RegExp("^(?:" + MARK + "|VCCI(?:-V)?|CCC|KCC)(?:[ ,]*(?:Class|Klasse) ?[A-Z12])?(?![A-Za-z])", "i");

/** `802.3ab`, `IEEE 1588`, `1000BASE-T`. The media name is accepted on purpose: it is what the
 *  standard is FOR and the corpus writes it as a member in its own right. */
// The bare four-digit form (IEEE 1588, 1613) REQUIRES its `IEEE` prefix. Without it `1997` -- a year,
// and in this corpus the tail of a cut `…-1997` -- is indistinguishable from a standard number, and
// the flagged fixture proved it: `1997` was being accepted as an identifier.
const ID_IEEE = /^(?:(?:IEEE ?)?(?:802\.[0-9]{1,2}[a-z]{0,4}|[0-9]{1,4}ase-?[a-z0-9]{1,4}|[0-9]{1,4}base-?[a-z0-9]{1,4})|IEEE ?1[0-9]{3})(?![0-9])/i;

/** A trailing parenthesised acronym is the identifier of a spelled-out name:
 *  `Open Shortest Path First (OSPF)`, `IP Service-Level Agreement (IP SLA)`. Checked before the prose
 *  rule, or every protocol the datasheet spells out would be refused as a sentence. */
const ID_PARENTHETICAL = /\(([A-Z][A-Za-z0-9]{1,9}(?: [A-Z]{2,5})?)\)\s*$/;

/** `RFC 2544`, `ITU-T Y.1731`, `IPv4`, `SNMPv3`, `NetFlow` -- a single token that is already an id. */
// A bare token must be FOUR characters or carry a DIGIT. Anything shorter is the three-population
// problem with no way to tell them apart by shape: `RPC` and `FTP` are protocols, `EN` and `AS` are
// issuers the splitter tore from their numbers, `IE` is the tail of a cut. SHORT_BUT_REAL is checked
// before this rule and is the only thing that may rescue a short token; everything else falls to
// flagged, which is the safe direction because flagged is counted and read, never deleted.
const ID_TOKEN = /^(?:RFC ?[0-9]{1,5}|ITU(?:-T)? ?[A-Z]\.[0-9]{1,4}(?:\.[0-9]+)?|IPv[46]|[A-Z][A-Za-z0-9]{3,}|[A-Z][A-Za-z]*[0-9][A-Za-z0-9]*)(?![A-Za-z :])/;

/** Prose with no identifier in it: three or more words, at least two of them ordinary lower-case
 *  words. Deliberately requires the ABSENCE of an extractable identifier (the caller checks that
 *  first), because "Spanning tree per port" and "Layer 2 and Layer 3 switching" are sentences while
 *  "IEEE 802.3ab 1000BASE-T Gigabit Ethernet" is an identifier wearing one. */
const LOOKS_LIKE_PROSE = /^(?=(?:\S+\s+){2,})(?:.*\b[a-z]{3,}\b.*\b[a-z]{3,}\b)/;

/** The identifier this member carries, or null. Exported because the normaliser will want the same
 *  answer the classifier used -- two implementations of "what is the identifier here" is how the
 *  gate and the adapter drifted over 160 characters. */
/** The words a datasheet uses to OPEN a section, which the extractor must never read as identifiers.
 *  `Emissions` and `Safety` are single capitalised tokens, so every "is this an identifier" rule that
 *  works on shape alone accepts them -- and then the cup's own refuse fixture cannot fire, because the
 *  accept branch answered first. Checked before anything else looks at the string. */
const SECTION_HEADING = new Set([
  "safety", "emissions", "emission", "immunity", "compliance", "standards", "standard",
  "certifications", "certification", "regulatory", "approvals", "approval", "emc", "environmental",
  "general", "notes", "note", "other", "misc", "features", "feature", "protocols", "protocol",
]);

export function extractIdentifier(key: string, member: string): string | null {
  const m = member.trim().replace(/^[●•▪·‣◦]\s*/, "");
  if (!m) return null;
  if (SECTION_HEADING.has(m.toLowerCase().replace(/[:.]+$/, ""))) return null;
  if (SHORT_BUT_REAL.has(m.toLowerCase().replace(/\.$/, ""))) return m;
  const par = ID_PARENTHETICAL.exec(m);
  if (par) return par[1];
  for (const re of key === "ieee_standards" ? [ID_IEEE, ID_NUMBERED] : [ID_NUMBERED, ID_MARK, ID_IEEE, ID_TOKEN]) {
    const hit = re.exec(m);
    if (hit) return hit[0].trim();
  }
  // RULING Q10 (29 Sep 2026), supported_protocols ONLY and only where everything above found nothing, so no member the grammar
  // already reads changes its answer: the rules PROTOCOL_GRAMMAR_Q10 names, each required by a member NORM 1.8.6 recovered.
  if (key === "supported_protocols") {
    const lab = PROTOCOL_LABEL_HEAD.exec(m);
    if (lab) { const id = extractIdentifier(key, m.slice(lab[0].length)); if (id) return id; }
    const named = PROTOCOL_NAMES.exec(m);
    if (named) return named[0];
    const par = PROTOCOL_PARENTHETICAL.exec(m);
    if (par) return par[1];
    // RULING (c), 6 Oct 2026 (GRAMMAR_6OCT): whole members only, and only where everything above found nothing
    if (PROTOCOL_NAMED_6OCT.test(m) || SERIAL_STANDARD_6OCT.test(m)) return m;
    // (A)'s classify pass, 6 Oct 2026 (GRAMMAR_6OCT_B): the members the whole comma cells recovered
    if (PROTOCOL_NAMED_6OCT_B.test(m) || PROTOCOL_ROLE_6OCT_B.test(m) || IGMP_VERSIONS_6OCT_B.test(m) || L3VPN_6OCT_B.test(m)
      || SERIAL_GROUP_6OCT_B.test(m) || MLFR_6OCT_B.test(m)) return m;
    const fnote = FOOTNOTE_6OCT_B.exec(m);
    if (fnote) return extractIdentifier(key, fnote[1]);
    // the re-apply's classify pass (GRAMMAR_6OCT_C): exact whole members only
    if (PROTOCOL_EXACT_6OCT_C.has(m)) return m;
  }
  if (key === "emc_emissions" && EMC_EXACT_6OCT_C.has(m)) return m;
  if (key === "certifications" && CERT_EXACT_6OCT_C.has(m)) return m;
  // a region label in front of a standard: read what follows, behind the same refusal guard as the edition/Class heads below
  if (key === "certifications" && !LIST_SHAPES.certifications.refuse.test(m) && !LOOKS_LIKE_PROSE.test(m)) {
    const region = CERT_REGION_6OCT_C.exec(m);
    if (region) { const id = extractIdentifier(key, m.slice(region[0].length)); if (id) return id; }
  }
  if (key === "certifications" && CERT_IC_CS03_6OCT.test(m)) return m;
  // (A)'s classify pass (GRAMMAR_6OCT_B): an edition note or a Class qualifier the splitter left at the FRONT of the next standard
  // A member the prose rule REFUSES keeps that verdict: a refused member is dropped and salvaged by reshapeList, so reading it
  // here would move a stored value -- measured 6 Oct across every vendor, one aruba member ("Class A EN 55035 ... part 15 subpart
  // B") flipped refuse -> accept until this guard.
  if (key === "certifications" && !LIST_SHAPES.certifications.refuse.test(m) && !LOOKS_LIKE_PROSE.test(m)) {
    const head = CERT_HEAD_6OCT_B.exec(m);
    if (head) return extractIdentifier(key, m.slice(head[0].length));
    const front = CERT_FRONT_6OCT_B.exec(m);
    if (front) return front[0];
  }
  return null;
}

// ---- RULING Q10 (29 Sep 2026): the protocols grammar, extended over the members NORM 1.8.6 recovered --------------------------
// 1.8.6's " ; " split handed back chunks the older normaliser had dropped from the raw cell (the 8800 phones' 802.11a/b/g/n/ac,
// the Nexus 3000 multicast lists): 242 new member occurrences, 48 distinct, 29 of them unclassified. Read in full, six are real
// protocols the grammar could not read -- a three-letter family with a mode (PIM-SM), a column label glued on ("Multicast:
// PIMv2"), a hyphenated acronym in brackets ("(Auto-RP)"), an acronym with a version after its bracket ("(SNMP) v3"). The rest
// is residue and STAYS unclassified: fragments cut mid-word ("Anycast RP Internet Group Manage", "2000 ingress a"), capacity
// statements ("5 active VLANs", "64-way Equal-Cost Multipath"), a management surface ("Web browser"), halves of a phrase the
// splitter cut ("Universal Plug"). One rule per row below, each with the recovered member that required it and its SKU.
/** "Multicast: " -- a capitalised column label glued to the front; the member is read from what follows it. */
const PROTOCOL_LABEL_HEAD = /^(?:Multicast|Routing|Unicast|Security|Management|Layer 2|Layer 3):\s+/;
/** PIM's modes, which ID_TOKEN cannot read (three letters, then a hyphen). Front-anchored: a description may follow. */
const PROTOCOL_NAMES = /^PIM-(?:SM|SSM)(?![A-Za-z0-9])/;
/** A spelled-out name ending in its acronym in brackets, where the acronym carries a hyphen, or a version follows it. */
const PROTOCOL_PARENTHETICAL = /\(([A-Z][A-Za-z0-9]{1,9}(?:-[A-Z][A-Za-z0-9]{0,5})?)\)(?:\s*v[0-9]{1,2})?\s*$/;
export const PROTOCOL_GRAMMAR_Q10: readonly { rule: string; witness: string; sku: string }[] = [
  { rule: "PROTOCOL_LABEL_HEAD", witness: "Multicast: PIMv2", sku: "N3064T-32T-LIC" },
  { rule: "PROTOCOL_LABEL_HEAD", witness: "Multicast: PIM-SM Version 2", sku: "N3K-C3048-BA-L3" },
  { rule: "PROTOCOL_NAMES", witness: "PIM-SM", sku: "N3064T-32T-LIC" },
  { rule: "PROTOCOL_NAMES", witness: "PIM-SSM IGMPv3", sku: "N540-24Q2C2DD-SYS" },
  { rule: "PROTOCOL_PARENTHETICAL", witness: "Automatic Rendezvous Point (Auto-RP)", sku: "N3K-BAS1K9" },
  { rule: "PROTOCOL_PARENTHETICAL", witness: "Simple Network Management Protocol (SNMP) v3", sku: "RV130-K9-AU" },
];

// ---- RULING (c), 6 Oct 2026 (reviewer: "CLASSIFY, DON'T RAISE THE CEILING: ... real identifiers -> extend the grammar,
// junk -> refuse; the ceiling moves only if a residue remains with a named reason") --------------------------------------------
// Run 1495 (the ISR 4000 sheet c78-732542 and its serial NIMs) grew the cisco unclassified ratchet by 98 supported_protocols and
// 4 certifications member-occurrences. Read in full: 54 are real identifiers this grammar could not read -- a WAN protocol and a
// routing method a router sheet names in words, the EIA/TIA serial standards and the ITU-T V-/X-series written without "ITU-T",
// Industry Canada's telecom terminal standard. The other 48 are residue and STAY unclassified, with their causes named:
// "Border Gateway" (16) is the 160-character cap cutting "Border Gateway Protocol (BGP)" -- the Protocols row is comma-delimited,
// so the extractor's list test (two bullets, or two standards prefixes) reads it as a scalar and keeps 160 of ~800 characters;
// "Routing Information Protocol Versions 1" and "2 (RIP and RIPv2)" (16 each) are the splitter's cut through "Versions 1 and 2".
// WHOLE-MEMBER rules, so nothing with a description after it changes answer: a member these accept was UNCLASSIFIED, which
// reshapeList keeps exactly as it keeps an accepted one -- no stored value moves and NORM_VERSION does not change (measured
// before/after over every vendor's stored members: every flip is unclassified -> accept).
/** A WAN protocol and a routing method that router sheets list by name, never by acronym. */
const PROTOCOL_NAMED_6OCT = /^(?:Frame Relay|static routes)$/;
/** EIA/TIA-232, -449, -530, -530A, and the ITU-T V- and X-series as serial NIM sheets write them ("V.35", "X.21"). */
const SERIAL_STANDARD_6OCT = /^(?:(?:EIA|TIA)(?:\/(?:EIA|TIA))?-[0-9]{3}[A-Z]?|[VX]\.[0-9]{1,3})$/;
/** Industry Canada CS-03, with the interface the router sheet declares it for. */
const CERT_IC_CS03_6OCT = /^(?:T1 )?IC CS-03(?::(?:19|20)[0-9]{2})?$/;
export const GRAMMAR_6OCT: readonly { key: string; rule: string; witness: string; sku: string }[] = [
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT", witness: "Frame Relay", sku: "ISR4461/K9" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT", witness: "static routes", sku: "ISR4461/K9" },
  { key: "supported_protocols", rule: "SERIAL_STANDARD_6OCT", witness: "EIA-232", sku: "NIM-2T" },
  { key: "supported_protocols", rule: "SERIAL_STANDARD_6OCT", witness: "EIA-449", sku: "NIM-2T" },
  { key: "supported_protocols", rule: "SERIAL_STANDARD_6OCT", witness: "EIA-530", sku: "NIM-2T" },
  { key: "supported_protocols", rule: "SERIAL_STANDARD_6OCT", witness: "EIA-530A", sku: "NIM-2T" },
  { key: "supported_protocols", rule: "SERIAL_STANDARD_6OCT", witness: "V.35", sku: "NIM-2T" },
  { key: "supported_protocols", rule: "SERIAL_STANDARD_6OCT", witness: "X.21", sku: "NIM-2T" },
  { key: "certifications", rule: "CERT_IC_CS03_6OCT", witness: "T1 IC CS-03:2004", sku: "ISR4461/K9" },
];
/** The 6 Oct residue, left unclassified on purpose (see above); the suite holds it there. */
export const RESIDUE_6OCT: readonly { key: string; member: string; cause: string }[] = [
  { key: "supported_protocols", member: "Border Gateway", cause: "160-character cap on a comma-delimited Protocols cell" },
  { key: "supported_protocols", member: "Routing Information Protocol Versions 1", cause: "splitter cut through 'Versions 1 and 2'" },
  { key: "supported_protocols", member: "2 (RIP and RIPv2)", cause: "splitter cut through 'Versions 1 and 2'" },
];

// ---- (A)'S CLASSIFY PASS, 6 Oct 2026 (reviewer: "build with the sabotage cases -> fix the 7 gate misses -> classify the recovered
// members (no ceiling raise) -> re-apply the router corpus") ----------------------------------------------------------------------
// Keeping comma cells whole (cisco_specs_deep COMMA_LIST_MIN_ITEMS) recovered 55 distinct list members the grammar left
// unclassified over the router corpus (334 protocol + 7 certification occurrences). Read in full: the real router protocol names
// are read here, whole members only, one witness each (a SKU, or the document where the record is document-level). The rest stays
// unclassified with its cause named in RESIDUE_6OCT_B -- splitter halves, QoS mechanism words, SD-WAN feature names, fused runs.
// A member these accept was UNCLASSIFIED, which reshapeList keeps exactly as an accepted one, so no stored value moves.
/** Router protocol and service names that are not acronym-shaped: a routing feature, a Cisco service, IPsec spelled apart. */
const PROTOCOL_NAMED_6OCT_B = /^(?:BGP Router Reflector|Call Home|IP sec|Cisco Discovery Protocol|split DNS|syslog|NAT\/PAT|NAT pools|NAT traversal|static NAT|symmetric NAT|OTV)$/;
/** A protocol in a stated role. */
const PROTOCOL_ROLE_6OCT_B = /^(?:DHCP|DNS) (?:client|server|relay)$/;
/** IGMP with the versions it speaks. */
const IGMP_VERSIONS_6OCT_B = /^IGMP v[123](?:\/v[123])+$/;
/** Layer 3 VPN, spelled out or abbreviated, with the sentence's full stop where the cell ended. */
const L3VPN_6OCT_B = /^(?:Layer 3 VPN|L3 VPN)\.?$/;
/** The serial interface with the standards it supports in brackets ("Serial (RS-232, RS-449, X.21, V.35, and EIA-530)"). */
const SERIAL_GROUP_6OCT_B = /^Serial \((?:(?:RS|EIA|TIA)-[0-9]{3}[A-Z]?|[VX]\.[0-9]{1,3})(?:,? (?:and )?(?:(?:RS|EIA|TIA)-[0-9]{3}[A-Z]?|[VX]\.[0-9]{1,3}))+\)$/;
/** Multilink Frame Relay with its acronym and the Frame Relay Forum agreements it implements. */
const MLFR_6OCT_B = /^Multilink Frame Relay \(MLFR\)(?: \(FR\.[0-9]{1,2}(?: and FR\.[0-9]{1,2})?\))?$/;
/** A footnote marker a datasheet hangs on a name ("OTV [6]"): the member is read without it. */
const FOOTNOTE_6OCT_B = /^(.*\S)\s*\[[0-9]{1,2}\]$/;
/** An edition note or a Class qualifier that belongs to the PREVIOUS standard, left at the front of the next one by the splitter
 *  ("Third Edition EN 62368-1: 2020", "Class A EN/IEC 61000-3-3/3-11 ..."): the standard after it is read; alone, it stays residue. */
const CERT_HEAD_6OCT_B = /^(?:(?:First|Second|Third|Fourth) Edition|Class [AB]|Designed to meet)\s+(?=\S)/;
/** A standard at the FRONT of a member in a form the issuer grammar does not read (front-anchored; a fused run may follow, as with
 *  ID_NUMBERED): the triple-issuer TIA/EIA/IS-968, an ITU-T recommendation written without "ITU-T" ("G.824", the second of "ITU-T
 *  G.823, G.824" after the comma split), and FCC Part 15 whose "47" the run splitter peeled off ("47 CFR Part 15:2016"). */
const CERT_FRONT_6OCT_B = /^(?:TIA\/EIA\/IS-[0-9]{3}[A-Z]?|[GKQ]\.[0-9]{3,4}|CFR Part [0-9]{1,3}(?::(?:19|20)[0-9]{2})?)(?![0-9])/;
// ---- THE RE-APPLY'S CLASSIFY PASS, 6 Oct 2026 evening (GRAMMAR_6OCT_C) -------------------------------------------------------------
// Run 1514 (the router corpus re-applied with whole comma cells) left 132 distinct unclassified members on the facts it wrote and
// put the cisco ratchet over its ceilings (board enum_values_in_domain). The ruling stands: "CLASSIFY, DON'T RAISE THE CEILING".
// Read in full (reviewer 6 Oct ~21:40: clear the board): the real identifiers are accepted as EXACT WHOLE MEMBERS -- a Set, not a
// pattern, so no string the reading did not see can change its answer -- and the residue stays unclassified with its cause
// (RESIDUE_6OCT_C). An unclassified member and an accepted one are kept alike by reshapeList, so no stored value moves.
/** Router protocol and service names as the router sheets print them (spelled-out names, a role, a mode, a scope). */
const PROTOCOL_EXACT_6OCT_C: ReadonlySet<string> = new Set([
  "Link Aggregation Control Protocol (LACP): IEEE 802.3ad", "LACP: IEEE 802.3ad", "Dynamic Host Configuration Protocol (DHCP) server",
  "DNS proxy", "Port mirroring", "Port Mirroring", "IPv6 DHCP", "Layer 2 forwarding", "Dynamic DNS (TZO, DynDNS, 3322.org, No-IP)",
  "Dynamic DNS (DynDNS), TZO, 3322.org)", "Dynamic Domain Name System (TZO, DynDNS, 3322.org, NOIP)", "DNS relay, Dynamic DNS (DynDNS, 3322)",
  "One-to-one NAT", "One-to-One NAT", "IPv6 PIM-SM", "egress IPv4 ACL", "Static IP", "Static IPv4", "Transparent bridge", "eBGP", "iBGP",
  "native VLAN", "bridge domains", "Internet Group Management Protocol (IGMP) Versions 2 and 3",
  "Internet Group Management Protocol (IGMP) Versions 1, 2, and 3", "PIM-ECMP", "mLDP", "WAN MACsec", "IP Security (IPsec) Protocol",
  "IP Security (IPSec) Protocol", "L3 Ingress IPv4 ACL and IPv6 ACL", "IPv6 unicast", "Layer 3 Virtual Private Network", "BGP Route Reflector",
  "IPv6 ACLs", "IPv6 routing", "Raw Socket TCP", "Cisco Discovery Protocol IPv4", "Bidirectional PIM", "Secure Shell (SSHv2) Protocol",
  "Segment Routing", "Model Driven Telemetry", "100 Gigabit Ethernet IEEE 802.3", "40 Gigabit Ethernet IEEE 802.3", "10 Gigabit Ethernet IEEE 802.3",
]);
/** Certifications in forms the issuer grammar does not read: several issuers on one number, a regulation named in words, a carrier's
 *  own requirement, an edition written out. */
const CERT_EXACT_6OCT_C: ReadonlySet<string> = new Set([
  "UL/CSA/IEC/EN 60950-1", "ACA TS001", "FDA: Code of Federal Regulations Laser Safety", "FDA Code of Federal Regulations Laser Safety",
  "BSMI Class A", "CAN/CSA C22.2 No. 60950-1, 2nd edition", "CAN/CSA C22.2 No. 60950-1, 2 nd edition", "CAN/CSA C22.2 No. 60950-1",
  "CAN/CSA C22.2 No. 62368-1", "CSA C22.2 No. 62368-1:1 (Edition. 3.0)", "VZ.TPR.9205: Verizon TEEER", "TUV/GS to EN 60950-1, Second Edition",
  "73/23/EEC Electromagnetic Emissions Certification", "AS/NZ 3548: 1995 (including AMD I + II) Class B", "AS/NZ CISPR 22: Class A",
  "ANSI / UL 60950-1", "ANSI / UL 62368-1", "EN / IEC 62368-1", "FIPS 140-2", "Common Criteria Department of Defense", "DoDIN APL IPv6",
  "CSA-certified to UL/CSA 60950-1, 2 nd Ed.",
]);
/** EMC emission standards in forms the grammar does not read: a national EMC regulation, FCC Part 15B, and VCCI's technical
 *  requirement documents (V-2 / V-3, dated), which the splitter left without the word "VCCI". */
const EMC_EXACT_6OCT_C: ReadonlySet<string> = new Set(["AS/NZ CISPR32", "47 CFR FCC Part 15B", "QCVN 118:2018/BTTTT", "V-2/2015.04", "V-3/2015.04"]);
/** A region label the sheet printed in front of a standard ("USA: UL 60950-1", "Rest of world: IEC 60950-1"): the standard is read. */
const CERT_REGION_6OCT_C = /^(?:USA|Canada|Europe|China|Australia and New Zealand|Rest of world):\s+(?=\S)/;
/** One witness per rule family: the run that wrote the member (all from run 1514's router re-apply). */
export const GRAMMAR_6OCT_C: readonly { key: string; rule: string; members: number; where: string }[] = [
  { key: "supported_protocols", rule: "PROTOCOL_EXACT_6OCT_C", members: PROTOCOL_EXACT_6OCT_C.size, where: "run 1514 (router corpus re-apply)" },
  { key: "certifications", rule: "CERT_EXACT_6OCT_C", members: CERT_EXACT_6OCT_C.size, where: "run 1514 (router corpus re-apply)" },
  { key: "certifications", rule: "CERT_REGION_6OCT_C", members: 6, where: "run 1514: USA:/Canada:/Europe:/China:/Australia and New Zealand:/Rest of world:" },
  { key: "emc_emissions", rule: "EMC_EXACT_6OCT_C", members: EMC_EXACT_6OCT_C.size, where: "run 1514 (router corpus re-apply)" },
];
export const PROTOCOL_EXACT_6OCT_C_LIST = [...PROTOCOL_EXACT_6OCT_C], CERT_EXACT_6OCT_C_LIST = [...CERT_EXACT_6OCT_C], EMC_EXACT_6OCT_C_LIST = [...EMC_EXACT_6OCT_C];
/** What the pass leaves unclassified, with its cause. The ieee_standards line is the one residue that moves a ceiling (+10). */
export const RESIDUE_6OCT_C: readonly { key: string; member: string; cause: string }[] = [
  { key: "ieee_standards", member: "SNMP v1, v2c, and v3", cause: "a protocol a sheet's Standards row lists; an IEEE grammar must not read it (+10 over the ceiling, the only residue that moves one)" },
  { key: "ieee_standards", member: "SNMPv1, v2c, and v3", cause: "as above" },
  { key: "certifications", member: "BSMI Cl", cause: "a cut 'BSMI Class A' (truncated cell)" },
  { key: "certifications", member: "ANSI /", cause: "the splitter's half of 'ANSI / UL 60950-1'" },
  { key: "certifications", member: "Designed to meet:", cause: "a lead-in with its colon; the standards follow as their own members" },
  { key: "certifications", member: "Third Edition EN", cause: "an edition note and a stray issuer" },
  { key: "certifications", member: "CCI Class A", cause: "a cut 'VCCI Class A'" },
  { key: "certifications", member: "Radio:", cause: "a section label" },
  { key: "supported_protocols", member: "Border Gateway", cause: "a cut 'Border Gateway Protocol' (a cell capped before (A))" },
  { key: "supported_protocols", member: "Routing Information Protocol Versions 1", cause: "the splitter's cut through 'Versions 1 and 2'" },
  { key: "supported_protocols", member: "Port management", cause: "a management feature, not a protocol" },
  { key: "supported_protocols", member: "IPv6 statistics", cause: "a counter set, not a protocol" },
  { key: "supported_protocols", member: "Web browser", cause: "a management surface" },
  { key: "supported_protocols", member: "ping", cause: "a diagnostic tool" },
  { key: "supported_protocols", member: "Multilink Fra", cause: "a cut 'Multilink Frame Relay'" },
];
export const GRAMMAR_6OCT_B: readonly { key: string; rule: string; witness: string; where: string }[] = [
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "BGP Router Reflector", where: "C1100TGX-1N24P32A" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "Call Home", where: "ISR4461" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "IP sec", where: "doc c78-669126" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "Cisco Discovery Protocol", where: "doc 0900aecd805e315d" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "split DNS", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "syslog", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "NAT/PAT", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "NAT pools", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "NAT traversal", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "static NAT", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_NAMED_6OCT_B", witness: "symmetric NAT", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_ROLE_6OCT_B", witness: "DHCP relay", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_ROLE_6OCT_B", witness: "DHCP client", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_ROLE_6OCT_B", witness: "DHCP server", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "PROTOCOL_ROLE_6OCT_B", witness: "DNS client", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "IGMP_VERSIONS_6OCT_B", witness: "IGMP v1/v2", where: "doc c78-742893" },
  { key: "supported_protocols", rule: "L3VPN_6OCT_B", witness: "Layer 3 VPN", where: "doc c78-736910" },
  { key: "supported_protocols", rule: "L3VPN_6OCT_B", witness: "Layer 3 VPN.", where: "doc c78-736910" },
  { key: "supported_protocols", rule: "L3VPN_6OCT_B", witness: "L3 VPN.", where: "doc c78-553896" },
  { key: "supported_protocols", rule: "SERIAL_GROUP_6OCT_B", witness: "Serial (RS-232, RS-449, X.21, V.35, and EIA-530)", where: "C1100TGX-1N24P32A" },
  { key: "supported_protocols", rule: "MLFR_6OCT_B", witness: "Multilink Frame Relay (MLFR) (FR.15 and FR.16)", where: "doc c78-598389" },
  { key: "supported_protocols", rule: "FOOTNOTE_6OCT_B", witness: "OTV [6]", where: "ISR4461" },
  { key: "certifications", rule: "CERT_HEAD_6OCT_B", witness: "Third Edition EN 62368-1: 2020", where: "doc ncs-57C3-fixed-chassis-ds" },
  { key: "certifications", rule: "CERT_HEAD_6OCT_B", witness: "Class A EN/IEC 61000-3-3/3-11 EN/IEC 61000-3-2/3-12", where: "doc 8000-series-p100-line-card-ds" },
  { key: "certifications", rule: "CERT_HEAD_6OCT_B", witness: "Designed to meet GR-63-CORE", where: "doc 8700-series-routers-ds" },
  { key: "certifications", rule: "CERT_FRONT_6OCT_B", witness: "TIA/EIA/IS-968 CS-03 ANSI T1.101 IEEE 802.3 RTTE Directive", where: "doc c78-598389" },
  { key: "certifications", rule: "CERT_FRONT_6OCT_B", witness: "G.824 IEEE 802.3 RTTE Directive", where: "C1100TGX-1N24P32A" },
  { key: "certifications", rule: "CERT_FRONT_6OCT_B", witness: "CFR Part 15:2016", where: "doc 8010-series-mdfr-ds" },
];
/** The classify pass's residue, left unclassified on purpose with its cause; the suite holds it there. */
export const RESIDUE_6OCT_B: readonly { key: string; member: string; cause: string }[] = [
  { key: "supported_protocols", member: "Layer 2", cause: "splitter cut through 'Layer 2 and Layer 3 VPN' -- the half that names no VPN" },
  { key: "supported_protocols", member: "shaping", cause: "a QoS mechanism word from a 'QoS: classification, ...' cell, not a protocol" },
  { key: "supported_protocols", member: "zero-trust", cause: "an SD-WAN feature name poured into the protocols cup" },
  { key: "supported_protocols", member: "Routing Protocols", cause: "a section heading the comma split left as a member" },
  { key: "certifications", member: "Third Edition", cause: "an edition note split from the standard it qualifies" },
];

/** Which of the three populations a stored member belongs to. Order matters and is stated: a known
 *  short token is real BEFORE the length rule can call it wreckage; a bullet survivor is evidence
 *  BEFORE a refusal, because refusing it would hide a splitter defect; and an identifier is looked
 *  for BEFORE prose, because most of the prose in this corpus has an identifier at the front of it. */
export function classifyMember(key: string, member: string): MemberVerdict {
  const shape = LIST_SHAPES[key];
  if (!shape) return "unclassified";
  const m = member.trim();
  if (!m) return "refuse";
  if (SHORT_BUT_REAL.has(m.toLowerCase().replace(/\.$/, ""))) return "accept";
  if (CARRIES_BULLET.test(m)) return "flagged";          // the splitter's residue, never junk
  if (extractIdentifier(key, m)) return "accept";
  if (shape.flagged.test(m)) return "flagged";           // the cap's residue, never junk
  if (shape.refuse.test(m) || LOOKS_LIKE_PROSE.test(m)) return "refuse";
  return "unclassified";
}

// ---- SALVAGE: the identifiers inside a refused member (ruling (a'), 29 Sep 2026) --------------------------------------
//
// A REFUSED MEMBER IS A SENTENCE, NOT AN ABSENCE. Read in full, a third of the refused members carry a real identifier in
// the middle of their prose: "25-Gbps IEEE 802.3by and IEEE 802.3cc compliant" (39 parts each), "CB to IEC 60950-1 with
// all country deviations", "DNS: A record (RFC 1706), SRV record (RFC 2782)", "Session Initiation Protocol (SIP) for
// signaling". extractIdentifier looks only at the FRONT of a member -- which is why these were refused -- so a plain drop
// would have deleted 96 IEEE, 480 certification and ~1,500 protocol identifier-occurrences that appear nowhere else in
// their lists: the 160-character cap's mistake made a second time, by the cleanup of the first.
//
// The rule, with the reviewer's conditions: a refused member is REPLACED by the identifiers embedded in it that the key's
// OWN shape accepts -- every candidate goes back through classifyMember and must come out `accept`; nothing enters on the
// candidate pattern alone -- de-duplicated against the list; a refused member with none is dropped. The normaliser keeps
// the raw cell, so every salvaged identifier traces to the sentence it was read from.

/** Candidate identifiers per key, UNANCHORED -- found anywhere in a refused member. A candidate is only a candidate:
 *  salvageMember re-classifies it and keeps it only on `accept`. Lookarounds, never a word boundary (4x10G, 10GBASE-T). */
const EMBEDDED: Readonly<Record<string, readonly RegExp[]>> = {
  ieee_standards: [
    /(?<![A-Za-z0-9.])(?:IEEE ?)?802\.[0-9]{1,2}[a-z]{0,4}(?![A-Za-z0-9])/gi,
    /(?<![A-Za-z0-9])[0-9]{1,4}BASE-?[A-Z0-9]{1,4}(?![A-Za-z0-9])/gi,
    /(?<![A-Za-z0-9])IEEE ?1[0-9]{3}(?![0-9])/gi,
  ],
  certifications: [
    // an issuer and its number, read the way NUMBERED reads them; the re-classification decides what survives
    new RegExp("(?<![A-Za-z0-9/])(?:" + ISSUER + ")[ \\-]?[0-9][0-9A-Za-z.\\-/]*(?:[ ]?[:\\-][ ]?(?:19|20)[0-9]{2})?(?:[ ,]+(?:Class|Klasse) ?[A-Z12](?![A-Za-z]))?", "gi"),
    /(?<![A-Za-z])NEBS(?: Level ?[123])?(?![A-Za-z])/g,
  ],
  supported_protocols: [
    /(?<![A-Za-z0-9])RFC ?[0-9]{1,5}(?![0-9])/g,
    /(?<![A-Za-z0-9])ITU(?:-T)? ?[A-Z]\.[0-9]{1,4}(?:\.[0-9]+)?(?![0-9])/g,
    /(?<![A-Za-z0-9])IPv[46](?![A-Za-z0-9])/g,
  ],
};

/**
 * THE PROTOCOL VOCABULARY IS CLOSED (reviewer condition, 29 Sep 2026). supported_protocols' own shape is loose -- any
 * capitalised token of four characters passes -- so "every token the shape accepts" would salvage SVIs (a switch virtual
 * interface) and VEPA (a port aggregator), which classify accept and are not protocols. Only these tokens are salvaged
 * from prose; each still has to classify accept, and each carries the shortest refused cisco member it was read from on
 * 29 Sep 2026, verbatim, so the entry can be checked against the store.
 */
export const PROTOCOL_VOCABULARY: readonly { token: string; witness: string }[] = [
  { token: "DNS", witness: "DNS: A record (RFC 1706), SRV record (RFC 2782)" },
  { token: "SIP", witness: "Session Initiation Protocol (SIP) for signaling" },
  { token: "DHCP", witness: "DHCP relay agent" },
  { token: "DHCPv6", witness: "IPv6 6rd Stateless address auto-configuration DHCPv6 server for IPv6 clients on a LAN DHCPv6 client for WAN connectivity Internet Control Me" },
  { token: "OSPFv2", witness: "Routing protocols: static, Open Shortest Path First (OSPFv2), OSPFv3, Intermediate S" },
  { token: "OSPFv3", witness: "Routing protocols: static, Open Shortest Path First (OSPFv2), OSPFv3, Intermediate S" },
  { token: "UDP", witness: "User Datagram Protocol (UDP) (used only for Real-Time T" },
  { token: "TCP", witness: "MAC address IPv4 only IPv6 only IPv4/IPv6 dual stack Session Initiation Protocol (SIP) Transmission Control Protocol (TCP) User Datagram Protocol (UDP) Real Tim" },
  { token: "ARP", witness: "Classical IP over ATM; Client and Address Resolution Protocol (ARP) Server (RFCs 1577, 1755, and 1626)" },
  { token: "ICMP", witness: "IPv6 addressing Internet Control Message Protocol (ICMP) Layer 3 routing protocols" },
  { token: "PIM", witness: "IP multicast routing protocols: Protocol Independent Multicast (PIM), including sparse mode and dense mode" },
  { token: "MSDP", witness: "2000 ingress  ; Multicast: PIM-SM Version 2 and SSM Bootstrap Router (BSR), Automatic Rendezvous Point (Auto-RP), and Static RP MSDP and Anycast-RP Internet Group Management Pr" },
  { token: "BGP", witness: "IPv4 routing: Cisco IOS XR Software supports a wide range of IPv4 services and routing protocols, including Border Gateway Protocol (BGP), Intermediate System" },
  { token: "MPLS", witness: "IPv6 routing (Static ; GRE, Ethernet, 802.1q VLAN, Serial over MPLS" },
  { token: "GRE", witness: "IPv6 routing (Static ; GRE, Ethernet, 802.1q VLAN, Serial over MPLS" },
  { token: "IGMPv2", witness: "IPv4 Multicast: The line cards support Internet Group Management Protocol Versions 2 and 3 (IGMPv2 and v3), Protocol Independent Multicast-Source Specific Mul" },
  { token: "IGMPv3", witness: "Forwarding (VRF) Open Shortest Path First (OSPFv2,  ; IPv4 and IPv6 multicast routing PIM-SM, PIM-SSM IGMPv3, MLDv2 mLDP mVPN P2MP-TE" },
  { token: "MLDv2", witness: "Forwarding (VRF) Open Shortest Path First (OSPFv2,  ; IPv4 and IPv6 multicast routing PIM-SM, PIM-SSM IGMPv3, MLDv2 mLDP mVPN P2MP-TE" },
];
const vocabularyPattern = (vocab: readonly { token: string }[]): RegExp =>
  new RegExp("(?<![A-Za-z0-9+\\-])(?:" + vocab.map((v) => v.token).join("|") + ")(?![A-Za-z0-9+\\-])", "g");
const VOCAB_RE = vocabularyPattern(PROTOCOL_VOCABULARY);

/** Two spellings of one identifier are one member: case, whitespace and a leading "IEEE" do not make a second one. */
const sameId = (s: string): string => s.toLowerCase().replace(/^ieee\s*/, "").replace(/\s+/g, "");

/** The identifiers embedded in one member that the key's own shape accepts, in order of appearance, de-duplicated.
 *  `vocabulary` exists for the sabotage case only: a protocol table widened to the shape's loose acronyms must salvage
 *  SVIs, which is exactly what the closed table prevents. */
export function salvageMember(key: string, member: string, vocabulary: readonly { token: string }[] = PROTOCOL_VOCABULARY): string[] {
  const vocab = vocabulary === PROTOCOL_VOCABULARY ? VOCAB_RE : vocabularyPattern(vocabulary);
  const res = [...(EMBEDDED[key] ?? []), ...(key === "supported_protocols" ? [vocab] : [])];
  const found: { at: number; id: string }[] = [];
  for (const re of res) for (const m of member.matchAll(new RegExp(re.source, re.flags))) {
    const id = m[0].trim().replace(/[.,;:]+$/, "");
    if (classifyMember(key, id) === "accept") found.push({ at: m.index ?? 0, id });
  }
  const out: string[] = [];
  for (const { id } of found.sort((a, b) => a.at - b.at)) if (!out.some((x) => sameId(x) === sameId(id))) out.push(id);
  return out;
}

export type Reshaped = { members: string[]; accepted: number; flagged: number; unclassified: number; salvaged: number; dropped: number };

/** A stored list, reshaped by the grammar. Every member the shape does not refuse is KEPT as it is (accepted, flagged and
 *  unclassified alike -- unclassified is the ratchet's business, not this function's); a refused member is replaced by its
 *  salvaged identifiers, minus any the list already holds; a refused member with none is dropped. Counts are per member,
 *  so a run can report accepted / salvaged / dropped before and after (reviewer condition). */
export function reshapeList(key: string, members: readonly string[]): Reshaped {
  const out: Reshaped = { members: [], accepted: 0, flagged: 0, unclassified: 0, salvaged: 0, dropped: 0 };
  const verdicts = members.map((m) => classifyMember(key, m));
  const have = new Set(members.filter((_, i) => verdicts[i] !== "refuse").map(sameId));
  members.forEach((m, i) => {
    const v = verdicts[i];
    if (v !== "refuse") { out.members.push(m); out[v === "accept" ? "accepted" : v === "flagged" ? "flagged" : "unclassified"]++; return; }
    const ids = salvageMember(key, m).filter((id) => !have.has(sameId(id)));
    if (!ids.length) { out.dropped++; return; }
    for (const id of ids) { have.add(sameId(id)); out.members.push(id); out.salvaged++; }
  });
  return out;
}

// ---- 1.8.6: A RUN OF NUMBERED STANDARDS IS A LIST (ruling Q5, 29 Sep 2026) ---------------------------------------------
//
// The certifications replay fused identifier lists into one member: a bullet ITEM keeps its commas (1.8.2, right for prose
// bullets) and "IEC 60950-1, 2 nd Ed. EN 60950-1, 2 nd Ed. UL 60950-1, 2 nd Ed. CAN/CSA-C22.2 No. 60950-1" came out as ONE
// certification. Commas are the wrong cut -- "IEC 60950-1:2005, Second Edition, with all country deviations" is one
// standard and its notes -- so the cut is where an issuer-numbered identifier BEGINS: each standard keeps its edition note.
// Scoped to the keys whose members are issuer-numbered standards; ieee_standards keeps its ruled descriptive members
// ("IEEE 802.3x full duplex on 10BASE-T, 100BASE-TX, and 1000BASE-T ports", 1.8.3).
export const IDENTIFIER_RUN_KEYS: ReadonlySet<string> = new Set(["certifications"]);
// An issuer followed by its number, or by "Part <n>" ("FCC Part 15.247"). No issuer glued to the end of another token
// ("NZS" in "AS/NZS", "CSA" in "CAN/CSA") and no letter before it.
const IDENTIFIER_START = new RegExp("(?<![A-Za-z0-9/])(?:" + ISSUER + ")(?:[ \\-]?(?=[0-9])|\\s+Part\\s+(?=[0-9]))", "gi");

/** Where issuer-numbered identifiers BEGIN in `member`, outside brackets. Two or more is a fused member. */
export function identifierStarts(member: string): number[] {
  const out: number[] = [];
  for (const m of member.matchAll(new RegExp(IDENTIFIER_START.source, IDENTIFIER_START.flags))) {
    const at = m.index ?? 0;
    const depth = [...member.slice(0, at)].reduce((d, ch) => d + (ch === "(" || ch === "[" ? 1 : ch === ")" || ch === "]" ? -1 : 0), 0);
    if (depth <= 0) out.push(at);
  }
  return out;
}

/** A member naming two or more issuer-numbered standards is cut at each one's start; a head that is only a label ("ETSI:",
 *  "USA:") is dropped, a trailing ", and" / ", or" is trimmed. One start or none: the member is returned whole. */
export function splitIdentifierRun(key: string, member: string): string[] {
  if (!IDENTIFIER_RUN_KEYS.has(key)) return [member];
  const at = identifierStarts(member);
  if (at.length < 2) return [member];
  const head = member.slice(0, at[0]).trim();
  const pieces = at.map((start, i) => member.slice(start, at[i + 1] ?? member.length)
    .replace(/[\s,;]*(?:\b(?:and|or)\b)?[\s,;]*$/i, "").trim());
  return [...(head && !/^[^:]{1,40}:$/.test(head) ? [head.replace(/[\s,;]+$/, "")] : []), ...pieces].filter((p) => /[A-Za-z0-9]/.test(p));
}

/** THE `.*` GUARD. A shape is a definition only when it can REFUSE, and only when its own fixtures
 *  behave: every accept fixture accepted, every refuse fixture refused, every flagged fixture flagged.
 *  A shape with an empty refuse set is reported as no definition at all, however well-formed it looks.
 *  Returns the reason when it is not a definition, so the caller can print it instead of a bare false. */
export function shapeIsDefinition(key: string): { ok: true } | { ok: false; why: string } {
  const s = LIST_SHAPES[key];
  if (!s) return { ok: false, why: "no shape registered" };
  if (s.fixtures.refuse.length === 0) return { ok: false, why: "no refuse fixtures: a shape that refuses nothing is not a definition" };
  if (s.accept.test("")) return { ok: false, why: "accept matches the empty string" };
  for (const f of s.fixtures.accept) if (classifyMember(key, f) !== "accept") return { ok: false, why: `accept fixture not accepted: ${JSON.stringify(f)}` };
  for (const f of s.fixtures.refuse) if (classifyMember(key, f) !== "refuse") return { ok: false, why: `refuse fixture not refused: ${JSON.stringify(f)} -> ${classifyMember(key, f)}` };
  for (const f of s.fixtures.flagged) if (classifyMember(key, f) !== "flagged") return { ok: false, why: `flagged fixture not flagged: ${JSON.stringify(f)} -> ${classifyMember(key, f)}` };
  return { ok: true };
}
