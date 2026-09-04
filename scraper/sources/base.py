"""scraper.sources.base — the small toolkit every source module uses, so eight adapters do not
grow eight slightly different table readers (three copies of a helper is three copies of the
same bug — D:\\Project\\CLAUDE.md §10).

Everything here returns RAW strings with a locator. Normalisation and field mapping live in
TypeScript; a Python adapter that "cleans up" a value is a second normaliser that will drift.
"""
from __future__ import annotations
import re
from bs4 import BeautifulSoup, Tag

CHALLENGE = re.compile(r"Client Challenge|Just a moment|cf-browser-verification|Attention Required|are you a human|captcha|Access Denied|Request unsuccessful", re.I)
WS = re.compile(r"\s+")


def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def clean(s: str | None) -> str:
    return WS.sub(" ", (s or "")).strip()


def looks_blocked(html: str) -> bool:
    """A challenge page is short and names itself. A real product page is neither."""
    return bool(CHALLENGE.search(html[:8000])) and len(html) < 40_000


def table_pairs(table: Tag, locator_prefix: str) -> list[dict]:
    """Two-cell rows of a spec table -> [{label, value, locator}]. A row whose first cell is a
    heading (single cell, or th spanning the row) sets a section that is prefixed to the labels
    that follow, because 'Height' under 'Dimensions' and 'Height' under 'Packaging' are not the
    same fact."""
    out: list[dict] = []
    section = ""
    for ri, tr in enumerate(table.find_all("tr")):
        cells = tr.find_all(["th", "td"])
        texts = [clean(c.get_text(" ", strip=True)) for c in cells]
        if len(cells) == 1 or (len(cells) >= 1 and cells[0].get("colspan") not in (None, "1")):
            if texts and texts[0]:
                section = texts[0][:80]
            continue
        if len(texts) >= 2 and texts[0] and texts[1]:
            label = texts[0]
            if section and section.lower() not in label.lower():
                label = f"{section} > {label}"
            out.append({"label": label, "value": texts[1], "locator": f"{locator_prefix}:r{ri}"})
    return out


def dl_pairs(root: Tag, locator_prefix: str) -> list[dict]:
    out: list[dict] = []
    for i, dt in enumerate(root.find_all("dt")):
        dd = dt.find_next_sibling("dd")
        if dd is None:
            continue
        label, value = clean(dt.get_text(" ", strip=True)), clean(dd.get_text(" ", strip=True))
        if label and value:
            out.append({"label": label, "value": value, "locator": f"{locator_prefix}:dt{i}"})
    return out


def colon_pairs(root: Tag, locator_prefix: str) -> list[dict]:
    """'Label: value' one-liners (list items, paragraphs). Conservative: label must look like a
    label, value must be short — a sentence with a colon in it is not a spec."""
    out: list[dict] = []
    for i, el in enumerate(root.find_all(["li", "p", "div"])):
        if el.find(["li", "p", "table"]):
            continue
        t = clean(el.get_text(" ", strip=True))
        m = re.match(r"^([A-Za-z][A-Za-z0-9 /()+.\-]{2,60}):\s*(.{1,160})$", t)
        if m and not m.group(2).endswith("."):
            out.append({"label": m.group(1), "value": m.group(2), "locator": f"{locator_prefix}:li{i}"})
    return out


def all_images(root: Tag, base: str, min_dim_hint: int = 200) -> list[dict]:
    """Candidate product images: <img> with a src, skipping obvious chrome (icons, logos, flags)."""
    out: list[dict] = []
    for img in root.find_all("img"):
        src = img.get("data-src") or img.get("data-zoom-image") or img.get("src") or ""
        if not src or src.startswith("data:"):
            continue
        low = src.lower()
        if any(x in low for x in ("logo", "icon", "flag", "sprite", "pixel", "badge", "placeholder", "loading")):
            continue
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            src = base.rstrip("/") + src
        out.append({"url": src, "alt": clean(img.get("alt")), "role": "gallery"})
    return out


def sku_in(text: str, sku: str) -> bool:
    """Case-insensitive containment that ignores the characters sites drop ('+', '=')."""
    norm = lambda s: re.sub(r"[+=\s]", "", s.lower())
    return norm(sku) in norm(text)


# ---------------------------------------------------------------------------------------------
# is this a part number? ONE definition (worker enqueue, every adapter's discover(), the
# watchdog's junk sweep). Three copies of this rule set drifted within a day: the watchdog
# refused "0.75K" while the queue still accepted it, and a crawler asked to search "0.75K"
# wastes a politeness slot and tells the host we are a bot.
#
# Every refusal names its reason (a slug from PART_NUMBER_REASONS) so a test can assert that an
# input was refused for the STATED reason — "refused" alone would let a rule die silently.
# Rules, in the order they are tried:
#   empty, bad_char, whitespace          not a token at all
#   KEEP: numeric Cisco PIDs             10-2834-01, 1030033 — see the block below
#   date                                 01-MAY-2022, 2024-10-31, 10/31/2024
#   quantity                             0.75K, 0.6-1.2A, 0-30M/50M, 10/100/1000, 24x10G, 40W, 1-CPU
#   footnote                             1.DDR4-3200, 1.QSFP-40/100-SRBD (a footnote glued to a token)
#   standard                             1000BASE-T, 10GBASE-SR, 4G-LTE, 802.3af, IEEE802.1Q
#   version                              17.9.4a, 15.2(4)E7, v2.1
#   connector                            RJ45, SFP+, QSFP28, QSFP-DD, USB-C, HDMI
#   protocol                             IPv4, VLAN, PoE+, SNMPv3, UL60950, RoHS
#   no_letter                            1_000, 12345_6 — a digit-only token no rule above named (a bare
#                                        number such as 15200 is already a quantity). Cisco DOES write
#                                        digit-only PIDs; the two shapes it uses are kept above.
#   too_short                            Z4 — unless the source opts into short names (Ubiquiti UX, U6+)
#   bare_word                            Aggregation, Ethernet — a word with no digit and no dash
# What is deliberately KEPT: Cisco digit-first PIDs (15216-ATT-LC=, 8804-FC0, 8201-32FH,
# 76-ES+XT-4TG3C), '/' and '=' and '++' forms (ISR4331/K9, SFP-10G-SR=, C9200L-24P-4G-A++),
# and dash-structured names without a digit (Ubiquiti USW-Aggregation, USW-Flex-XG).
# ---------------------------------------------------------------------------------------------

PART_NUMBER_REASONS = ("empty", "bad_char", "whitespace", "date", "quantity", "footnote", "version",
                       "standard", "connector", "protocol", "no_letter", "too_short", "bare_word")

# ---------------------------------------------------------------------------------------------
# Explicit KEEPS, tried before every refusal (4 Sep 2026, docs/CISCO_GAPS.md finding 10).
#
# Cisco writes two digit-only PID shapes, and the refusals below swallowed BOTH — 1,497 real parts
# that `is_part_number` is the one gate for, so they could never be queued for a fetch:
#   * NN-NNNN…-NN   internal assembly numbers: 10-2834-01, 10-1022008-01. 596 parts, 468 of them
#                   NCS 2000 assemblies in optical-networking. Refused as `quantity`, because
#                   digits joined by '-' read as a range.
#   * NNNNNN[NN]    six- to eight-digit Scientific-Atlanta video PIDs: 1030033, 1005444. 1,029
#                   parts — Prisma II, GS7000 nodes, RF Gateway, Optical Passive Components.
#                   Refused as `quantity` (a bare number) or `no_letter`.
# WHAT THIS COSTS, measured rather than hoped: the second shape is a SHAPE, and 18 of the 1,029
# tokens are not PIDs but numbers a scraper read as one — 115200 and 230400 (baud rates on the
# 4000 ISR), 33554432 (2^25, a Catalyst 9600 buffer size), two Nexus Dashboard ids. They will now
# be enqueued and will come back `not_listed`, which costs 18 politeness slots once. Refusing
# 1,011 real PIDs forever costs two whole categories. The bound is deliberate on both sides: five
# digits or fewer stays a quantity (13368, 15200), nine or more stays `no_letter` (162870776), and
# anything with a decimal point, a unit or a slash never reaches here.
# ---------------------------------------------------------------------------------------------
_PN_KEEP_ASSEMBLY = re.compile(r"^[0-9]{2}-[0-9]{4,}-[0-9]{2}$")   # 10-2834-01, 10-1022008-01
_PN_KEEP_NUMERIC = re.compile(r"^[0-9]{6,8}$")                     # 1030033, 1005444, 075681

_PN_BAD_CHAR = re.compile(r"[\x00-\x1f,;<>\"'\\|{}\[\]]")
_PN_DATE = [
    re.compile(r"^[0-9]{1,2}-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*-[0-9]{2,4}$", re.I),
    re.compile(r"^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*-[0-9]{2,4}$", re.I),
    re.compile(r"^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$"),
    re.compile(r"^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}$"),
]
# a number with an optional unit; several of them joined by - / x ~ are a range, a speed list or
# a port count. The unit list is closed on purpose: "8201-32FH" is a Cisco 8000-series PID and
# "FH" is not a unit, so the rule leaves it alone, while "0-30M/50M" is refused.
_PN_UNIT = (r"(?:KW|MW|GBE|GBPS|MBPS|KBPS|MPPS|PPS|KHZ|MHZ|GHZ|HZ|VAC|VDC|DBM|BTU|RPM|LBS|"
            r"GB|MB|TB|KB|GE|MA|MS|MM|CM|IN|LB|KG|DB|VA|AC|DC|K|M|G|T|W|V|A)?")
_PN_NUM = r"[0-9]+(?:[.,][0-9]+)?"
_PN_QUANTITY = re.compile(r"^" + _PN_NUM + _PN_UNIT + r"(?:[-/x~]" + _PN_NUM + _PN_UNIT + r")*\+?$", re.I)
_PN_COUNT_WORD = re.compile(r"^[0-9]{1,2}-[A-Z]{2,8}$", re.I)                 # 1-CPU, 2-PSU, 4-Port
_PN_FOOTNOTE = re.compile(r"^[0-9]{1,2}\.(?=[A-Z])", re.I)
_PN_VERSION = re.compile(r"^V?[0-9]+(?:\.[0-9]+)+(?:\([0-9]+\))?[A-Z]{0,2}[0-9]*$", re.I)
_PN_STANDARD = [
    # media standards: 1000BASE-T, 10GBASE-SR, 100GBASE-CR4, 10/100/1000BASE-TX, 2.5GBASE-T, 4G-LTE.
    # At most ONE dash group after the unit: "4G-LTE-ANTM-D" is a Cisco antenna PID and stays.
    re.compile(r"^[0-9]+(?:\.[0-9]+)?(?:/[0-9]+)*(?:GBASE|BASE|GE|G)(?:-[A-Z0-9]{1,6})?$", re.I),
    re.compile(r"^(?:IEEE)?802(?:\.[0-9]+[A-Z]{0,3})+$", re.I),
]
_PN_CONNECTOR = re.compile(
    r"^(?:RJ-?[0-9]{2}|USB(?:-?[A-C]|-?[0-9](?:\.[0-9])?)?|HDMI|VGA|DVI|[QO]?SFP(?:\+|28|56|-DD)?|XFP|GBIC|CFP[0-9]?|"
    r"MPO|MTP|BNC|DB-?9|RS-?232|RS-?485)$", re.I)
_PN_PROTOCOL = re.compile(
    r"^(?:IPV[46]|IEEE|ISO|EN|UL|FCC|CE|ROHS|REACH|WEEE|VLAN|MAC|QOS|U?POE\+?|VPN|SSH|SNMP|HTTPS?|TCP|UDP|TLS|SSL|NTP|"
    r"DHCP|DNS|LACP|R?STP|MSTP|LLDP|CDP|OSPF|BGP|EIGRP|RIP|IGMP|MLD|H\.[0-9]+|G\.[0-9]+|WIFI|WI-FI|BLUETOOTH)"
    r"(?:[./-]?V?[0-9][0-9A-Z./-]*)?$", re.I)
_PN_LETTER = re.compile(r"[A-Z]", re.I)
_PN_DIGIT = re.compile(r"[0-9]")


def is_part_number(key: str | None, allow_short: bool = False) -> tuple[bool, str | None]:
    """(True, None) when `key` may be queued as a part number; (False, reason) otherwise, with
    reason from PART_NUMBER_REASONS. `allow_short` is the per-source opt-in for two- and
    three-character names (Ubiquiti sells a "UX"); everything else is refused below four."""
    k = (key or "").strip()
    if not k:
        return False, "empty"
    if _PN_BAD_CHAR.search(k):
        return False, "bad_char"
    if any(c.isspace() for c in k):
        return False, "whitespace"
    # the two Cisco digit-only PID shapes, before the rules that would read them as quantities
    if _PN_KEEP_ASSEMBLY.match(k) or _PN_KEEP_NUMERIC.match(k):
        return True, None
    if any(rx.match(k) for rx in _PN_DATE):
        return False, "date"
    if _PN_QUANTITY.match(k) or _PN_COUNT_WORD.match(k):
        return False, "quantity"
    if _PN_FOOTNOTE.match(k):
        return False, "footnote"
    # standards before versions: 802.3af is a standard, 17.9.4a a version, and both are digits
    # and dots with a letter tail
    if any(rx.match(k) for rx in _PN_STANDARD):
        return False, "standard"
    if _PN_VERSION.match(k):
        return False, "version"
    if _PN_CONNECTOR.match(k):
        return False, "connector"
    if _PN_PROTOCOL.match(k):
        return False, "protocol"
    if not _PN_LETTER.search(k):
        return False, "no_letter"
    if len(k) < (2 if allow_short else 4):
        return False, "too_short"
    # a word with no digit and no dash is a word. The short-name opt-in covers the two- and
    # three-letter product names such a source sells (Ubiquiti "UX"); nothing longer.
    if not _PN_DIGIT.search(k) and "-" not in k and not (allow_short and len(k) <= 3):
        return False, "bare_word"
    return True, None
