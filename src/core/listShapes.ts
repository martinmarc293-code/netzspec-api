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
  return null;
}

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
