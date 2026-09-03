// src/pipeline/partNumber.ts — "is this token a part number?", the TypeScript twin of
// scraper/sources/base.py is_part_number.
//
// WHY A SECOND COPY EXISTS. The scrapers (Python) refuse junk keys at enqueue time and in the
// watchdog's sweep; the pipeline (TypeScript) has to refuse the SAME junk when an enumeration
// or a distributor page names a "SKU" — "0.75K", "24x10G", "RJ45", "01-MAY-2022" all arrived as
// part numbers once. Two languages, so two copies are unavoidable; what is NOT allowed is for
// them to drift. tests/db/apply-enumeration.test.ts runs BOTH implementations over the one
// shared fixture list tests/fixtures/partnumbers.json (>= 60 cases) and misses on any token
// where the verdict or the REASON differs. A rule changed on one side fails there, not in
// production.
//
// Rules, in the order they are tried (identical to base.py; the reason slugs are its
// PART_NUMBER_REASONS verbatim):
//   empty, bad_char, whitespace          not a token at all
//   date                                 01-MAY-2022, 2024-10-31, 10/31/2024
//   quantity                             0.75K, 0.6-1.2A, 0-30M/50M, 10/100/1000, 24x10G, 40W, 1-CPU
//   footnote                             1.DDR4-3200 (a footnote digit glued to a token)
//   standard                             1000BASE-T, 10GBASE-SR, 4G-LTE, 802.3af, IEEE802.1Q
//   version                              17.9.4a, 15.2(4)E7, v2.1
//   connector                            RJ45, SFP+, QSFP28, QSFP-DD, USB-C, HDMI
//   protocol                             IPv4, VLAN, PoE+, SNMPv3, UL60950, RoHS
//   no_letter                            1_000 — digit-only and no rule above named it
//   too_short                            Z4 — unless the caller opts into short names (Ubiquiti UX)
//   bare_word                            Aggregation, Ethernet — no digit and no dash
// Deliberately KEPT: digit-first Cisco PIDs (15216-ATT-LC=, 8201-32FH, 76-ES+XT-4TG3C), '/' '='
// '++' forms (ISR4331/K9, SFP-10G-SR=, C9200L-24P-4G-A++), dash-structured names without a digit
// (USW-Aggregation).
//
// `\b` is never used: product tokens have no word boundaries where a naive rule expects them
// (CLAUDE.md "Proof rules"); every pattern is anchored with ^ and $ exactly as the Python is.

export const PART_NUMBER_REASONS = [
  "empty", "bad_char", "whitespace", "date", "quantity", "footnote", "version",
  "standard", "connector", "protocol", "no_letter", "too_short", "bare_word",
] as const;
export type PartNumberReason = (typeof PART_NUMBER_REASONS)[number];

export type PartNumberVerdict = { ok: true; reason: null } | { ok: false; reason: PartNumberReason };

// eslint-disable-next-line no-control-regex
const PN_BAD_CHAR = /[\x00-\x1f,;<>"'\\|{}[\]]/;
const PN_DATE = [
  /^[0-9]{1,2}-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*-[0-9]{2,4}$/i,
  /^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*-[0-9]{2,4}$/i,
  /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$/,
  /^[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}$/,
];
// a number with an optional unit; several joined by - / x ~ are a range, a speed list or a port
// count. The unit list is CLOSED on purpose: "8201-32FH" is a Cisco PID and "FH" is not a unit.
const PN_UNIT = "(?:KW|MW|GBE|GBPS|MBPS|KBPS|MPPS|PPS|KHZ|MHZ|GHZ|HZ|VAC|VDC|DBM|BTU|RPM|LBS|"
  + "GB|MB|TB|KB|GE|MA|MS|MM|CM|IN|LB|KG|DB|VA|AC|DC|K|M|G|T|W|V|A)?";
const PN_NUM = "[0-9]+(?:[.,][0-9]+)?";
const PN_QUANTITY = new RegExp("^" + PN_NUM + PN_UNIT + "(?:[-/x~]" + PN_NUM + PN_UNIT + ")*\\+?$", "i");
const PN_COUNT_WORD = /^[0-9]{1,2}-[A-Z]{2,8}$/i;                       // 1-CPU, 2-PSU, 4-Port
const PN_FOOTNOTE = /^[0-9]{1,2}\.(?=[A-Z])/i;
const PN_VERSION = /^V?[0-9]+(?:\.[0-9]+)+(?:\([0-9]+\))?[A-Z]{0,2}[0-9]*$/i;
const PN_STANDARD = [
  // media standards: 1000BASE-T, 10GBASE-SR, 100GBASE-CR4, 10/100/1000BASE-TX, 2.5GBASE-T, 4G-LTE.
  // At most ONE dash group after the unit: "4G-LTE-ANTM-D" is a Cisco antenna PID and stays.
  /^[0-9]+(?:\.[0-9]+)?(?:\/[0-9]+)*(?:GBASE|BASE|GE|G)(?:-[A-Z0-9]{1,6})?$/i,
  /^(?:IEEE)?802(?:\.[0-9]+[A-Z]{0,3})+$/i,
];
const PN_CONNECTOR = new RegExp(
  "^(?:RJ-?[0-9]{2}|USB(?:-?[A-C]|-?[0-9](?:\\.[0-9])?)?|HDMI|VGA|DVI|[QO]?SFP(?:\\+|28|56|-DD)?|XFP|GBIC|CFP[0-9]?|"
  + "MPO|MTP|BNC|DB-?9|RS-?232|RS-?485)$", "i");
const PN_PROTOCOL = new RegExp(
  "^(?:IPV[46]|IEEE|ISO|EN|UL|FCC|CE|ROHS|REACH|WEEE|VLAN|MAC|QOS|U?POE\\+?|VPN|SSH|SNMP|HTTPS?|TCP|UDP|TLS|SSL|NTP|"
  + "DHCP|DNS|LACP|R?STP|MSTP|LLDP|CDP|OSPF|BGP|EIGRP|RIP|IGMP|MLD|H\\.[0-9]+|G\\.[0-9]+|WIFI|WI-FI|BLUETOOTH)"
  + "(?:[./-]?V?[0-9][0-9A-Z./-]*)?$", "i");
const PN_LETTER = /[A-Z]/i;
const PN_DIGIT = /[0-9]/;

/**
 * {ok: true} when `key` may be treated as a part number; {ok: false, reason} otherwise.
 * `allowShort` is the per-source opt-in for two- and three-character names (Ubiquiti "UX");
 * everything else is refused below four characters. Mirrors base.py line for line.
 */
export function isPartNumber(key: string | null | undefined, allowShort = false): PartNumberVerdict {
  const k = String(key ?? "").trim();
  if (!k) return { ok: false, reason: "empty" };
  if (PN_BAD_CHAR.test(k)) return { ok: false, reason: "bad_char" };
  if (/\s/.test(k)) return { ok: false, reason: "whitespace" };
  if (PN_DATE.some((rx) => rx.test(k))) return { ok: false, reason: "date" };
  if (PN_QUANTITY.test(k) || PN_COUNT_WORD.test(k)) return { ok: false, reason: "quantity" };
  if (PN_FOOTNOTE.test(k)) return { ok: false, reason: "footnote" };
  // standards before versions: 802.3af is a standard, 17.9.4a a version, both digits and dots
  if (PN_STANDARD.some((rx) => rx.test(k))) return { ok: false, reason: "standard" };
  if (PN_VERSION.test(k)) return { ok: false, reason: "version" };
  if (PN_CONNECTOR.test(k)) return { ok: false, reason: "connector" };
  if (PN_PROTOCOL.test(k)) return { ok: false, reason: "protocol" };
  if (!PN_LETTER.test(k)) return { ok: false, reason: "no_letter" };
  if (k.length < (allowShort ? 2 : 4)) return { ok: false, reason: "too_short" };
  // a word with no digit and no dash is a word; the short-name opt-in covers two- and
  // three-letter product names and nothing longer
  if (!PN_DIGIT.test(k) && !k.includes("-") && !(allowShort && k.length <= 3)) return { ok: false, reason: "bare_word" };
  return { ok: true, reason: null };
}
