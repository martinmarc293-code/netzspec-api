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

# ---------------------------------------------------------------------------------------------
# Block detection, by NAMED fingerprint
# ---------------------------------------------------------------------------------------------
# Two kinds of evidence, and they need opposite guards.
#
# STRUCTURAL markers are markup only an interstitial has - a Cloudflare challenge script, a
# Turnstile widget. No page that is not a challenge contains them, so they need no length guard,
# and a length guard would actively hurt: `looks_blocked` refuses to call anything over 40 KB
# blocked, so a challenge page that happens to be large is invisible to it.
#
# WORDY markers are ordinary English. "Access Denied" is the whole body of Akamai's refusal AND a
# row in the feature table of every Cisco security datasheet; "captcha" appears in any document
# about bot protection. They are believed only on a page too small to be a real document. The
# guard here is 4 KB, not the 40 KB `looks_blocked` uses: measured on 5 Sep 2026, Akamai's refusal
# is 546 bytes and a genuine Cisco datasheet containing the words "Access Denied" was 24 KB, so
# the old threshold called the datasheet blocked.
# THREE TIERS, and the tier is decided by ONE question: how much of a real document could contain
# this marker by accident? That governs how much of the page we search and how large a page we will
# believe it on. The old two-tier split got PerimeterX wrong in both directions at once, and the
# Juniper session hit the wall it left (5 Sep 2026): apps.juniper.net served an interactive HUMAN
# Security challenge at HTTP 405, 9,507 bytes, and `challenge_fingerprint` returned None. It said
# "CONFIRM you are human"; every marker here said "VERIFY". The lane recorded a block at all only
# because the word "captcha" happened to appear elsewhere in the markup — luck, not a check.
#
# MARKUP: a vendor's own paths, hostnames and script globals. These are not English and cannot be
# written by accident in prose, so they are believed ANYWHERE in the document at ANY size. That
# claim is now true: the old code scanned 65,536 bytes while its comment said otherwise, so a
# challenge behind a large shell was invisible. The vendor is matched as its DOMAIN
# (`perimeterx.net`), never as its NAME — a security datasheet discussing PerimeterX is not a
# challenge, and Cisco's catalogue is full of documents that name bot-protection vendors.
MARKUP_CHALLENGE = (
    ("cf_challenge_platform", "/cdn-cgi/challenge-platform"),
    ("cf_chl_token", "__cf_chl"),
    ("cf_chl_opt", "cf_chl_"),
    ("cf_chl_id", "cf-chl-"),
    ("cf_turnstile", "cf-turnstile"),
    ("cf_challenges_host", "challenges.cloudflare.com"),
    ("cf_browser_verification", "cf-browser-verification"),
    # PerimeterX / HUMAN Security. Strings supplied by the Juniper session from the live wall.
    # Named to match sources/juniper.py, which labelled this marker first. Two names for
    # one fingerprint means an operator grepping a log for one of them finds half the
    # occurrences, and a brand suite asserting either is right and fails anyway.
    ("px_captcha", "px-captcha"),
    ("px_captcha_path", "/px/captcha"),
    ("px_domain", "perimeterx.net"),
    ("px_cdn", "captcha.px-cdn"),
    ("px_cookie", "_pxhd"),
    ("px_app_id", "window._pxappid"),
)

# PHRASE: challenge prose that a product document would have no reason to contain. Searched in the
# HEAD only, because a real page that quotes one of these late is likelier than one that opens with
# it, and the head is where a challenge puts its own text.
PHRASE_CHALLENGE = (
    ("cf_just_a_moment", "just a moment"),
    ("cf_client_challenge", "client challenge"),
    ("turnstile_verify_human", "verify you are human"),
    # PerimeterX's wording, which is why none of the above matched it.
    ("px_confirm_human", "confirm you are human"),
    ("px_security_check", "complete the security check before continuing"),
    ("turnstile_performing", "performing security verification"),
    ("cf_checking_browser", "checking your browser"),
    ("cf_enable_js_cookies", "enable javascript and cookies"),
)
HEAD_BYTES = 65536

# WORDY markers are ordinary English that a real document genuinely contains. Believed only on a
# page too small to BE a real document.
WORDY_CHALLENGE = (
    ("akamai_access_denied", "access denied"),
    ("akamai_no_permission", "you don't have permission to access"),
    ("px_page_denied", "access to this page has been denied"),
    # MOVED HERE FROM THE PHRASE TIER, 6 Sep 2026. "verifies that you are not a bot" is
    # ordinary English ABOUT bot protection, not a challenge saying so about itself - a
    # security page explaining how a product works contains it legitimately. In PHRASE it
    # was searched with no page-size guard, so a long document DISCUSSING bot protection
    # read as a challenge. Caught by the Juniper lane's own sabotage case (B9) on a merge
    # probe, before it shipped: their suite asserts that exact page is NOT blocked.
    ("px_not_a_bot", "verifies that you are not a bot"),
    ("attention_required", "attention required"),
    ("captcha", "captcha"),
    ("request_unsuccessful", "request unsuccessful"),
    ("are_you_a_human", "are you a human"),
)
WORDY_MAX_BYTES = 4000

#: Kept as an alias: three brand suites and two adapters import this name. The split above is what
#: is actually searched.
STRUCTURAL_CHALLENGE = MARKUP_CHALLENGE + PHRASE_CHALLENGE


def challenge_fingerprint(html: str) -> str | None:
    """The NAME of the block fingerprint on this page, or None.

    Naming it is the point. On 5 Sep 2026 three lanes were being challenged and the watchdog said
    nothing, because a block was inferred from an HTTP status and a challenge served with HTTP 200
    was classified by the adapter as "this part is not listed". An outcome that says
    `blocked:turnstile_verify_human` is a fact somebody can act on; `no_facts` is not.
    """
    if not html:
        return "empty_body"
    # MARKUP is searched over the WHOLE document, which is what "believed at any size" has always
    # claimed and never did: the single 65,536-byte window applied to every tier, so a challenge
    # behind a large shell was invisible to markers that cannot appear by accident.
    whole = html.lower()
    for name, pat in MARKUP_CHALLENGE:
        if pat in whole:
            return name
    head = whole[:HEAD_BYTES]
    for name, pat in PHRASE_CHALLENGE:
        if pat in head:
            return name
    if len(html) <= WORDY_MAX_BYTES:
        for name, pat in WORDY_CHALLENGE:
            if pat in head:
                return name
    return None


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
#   KEEP: digit-led Cisco PIDs           10-2834-01, 1030033, 8201=, 9800-40, 886VA — see below
#   date                                 01-MAY-2022, 2024-10-31, 10/31/2024
#   quantity                             0.75K, 0.6-1.2A, 0-30M/50M, 10/100/1000, 24x10G, 40W, 1-CPU
#   footnote                             1.DDR4-3200, 1.QSFP-40/100-SRBD (a footnote glued to a token)
#   standard                             1000BASE-T, 10GBASE-SR, 4G-LTE, 802.3af, IEEE802.1Q
#   version                              17.9.4a, 15.2(4)E7, v2.1
#   connector                            RJ45, SFP+, QSFP28, QSFP-DD, USB-C, HDMI
#   protocol                             IPv4, VLAN, PoE+, SNMPv3, UL60950, RoHS
#   no_letter                            1_000, 12345_6 — a digit-only token no rule above named (a bare
#                                        number such as 15200 is already a quantity). Cisco DOES write
#                                        digit-only PIDs; the five shapes it uses are kept above.
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

# ---------------------------------------------------------------------------------------------
# Three more digit-led Cisco shapes (4 Sep 2026). Found by the planner reading its OWN refusals:
# 40 queued lookups were being held back by them. Each bound below was read off the corpus
# (data/reference/cisco-pid-universe.json, 69,487 distinct PIDs; runs/acquired/**, 4,526 pages),
# not guessed — "run the thing over the real corpus and READ THE OUTPUT" (D:\\Project\\CLAUDE.md §2).
#
#   NNNN=          a spare order of a digit-only model: 8201=, 8202=, 8404=, 8608= (Cisco 8000
#                  Series routers), 15216-2950= (ONS 15216). Refused as `no_letter`. '=' is
#                  Cisco's spare-order marker and it is a HARD discriminator: of the 16,024
#                  '='-suffixed tokens in the universe exactly these five are refused, and no
#                  quantity, date, version or unit token in either corpus carries one. Dash
#                  groups are allowed because 15216-2950= is one; four leading digits minimum
#                  keeps price-break ranges (100-499, 1-99) out of reach.
#                  DECIDED: "2000=" is ACCEPTED. Nothing in the SHAPE separates it from 8201=,
#                  and a "not a round number" carve-out has no evidence behind it while it would
#                  refuse a real 8800= or 9200= spare (8804-FC0 and C9200L are both catalogue
#                  models). A wrong accept costs one politeness slot and comes back not_listed;
#                  a wrong refusal is forever. Same trade the numeric keep above already priced.
#   NNNN-NN        a 4-digit model with a 2-digit suffix: 9800-40, 9800-80 (Catalyst 9800
#                  wireless controllers). Refused as `quantity`, because digits joined by '-'
#                  read as a range — but a range from 9800 to 40 does not exist: a 2-digit tail
#                  can never exceed a 4-digit head, so this shape is not a range at all. Every
#                  real range in the corpus ascends and none is 4-2 (0-23, 100-499, 1000-4999,
#                  1545-1548, 5060-5080). The ONE other reading is a calendar year-month, so
#                  19xx- and 20xx- heads are excluded and 2024-10 stays a quantity. A 1-digit
#                  tail is NOT admitted: "9800-4" is no Cisco PID (the family is -40/-80/-L/-CL)
#                  and one digit is the shape of a count or an index.
#   NNNVA          Cisco 880/890-series ISRs written bare: 886VA, 887VA, 896VA, 897VA (VA =
#                  VDSL2/ADSL2+ Annex A). Refused as `quantity`, reading "886 volt-amperes".
#                  TWO clauses, and BOTH are needed: the 8xx band, and a non-zero final digit.
#                  Every apparent-power rating in the acquired corpus is a multiple of ten
#                  (240, 480, 550, 700, 750, 850, 900, 1000, 1440, 1500, 1800, 1950, 2000, 2400,
#                  3000 VA) and 850VA is in the 8xx band, so the band alone would have flipped a
#                  real UPS rating. Four digits never reach here, so 1500VA stays a quantity.
# ---------------------------------------------------------------------------------------------
# The year lookahead is on BOTH digit-led keeps for the same reason: without it the spare keep
# swallowed "2024-10-31=" (found by the '='-strip sabotage below — a keep runs before every
# refusal, so it is the one place a date can escape the date rule).
_PN_KEEP_SPARE = re.compile(r"^(?!19[0-9]{2}-)(?!20[0-9]{2}-)[0-9]{4,}(?:-[0-9]+)*=$")    # 8201=
_PN_KEEP_MODEL_SUFFIX = re.compile(r"^(?!19[0-9]{2}-)(?!20[0-9]{2}-)[0-9]{4}-[0-9]{2}$")  # 9800-40
_PN_KEEP_ISR_VA = re.compile(r"^8[0-9][1-9]VA=?$", re.I)               # 886VA, 897VA, 886VA=

# ---------------------------------------------------------------------------------------------
# The space set is written out, NOT inherited from the language (4 Sep 2026). "Trim, then refuse
# an interior space" reads as one rule in two languages and is not: Python's str.strip()/isspace()
# and JavaScript's trim()/\s disagree on three characters, and every disagreement is a token that
# is a part number in one language and junk in the other — the one thing the twin implementations
# exist to prevent.
#   U+FEFF (BOM)   JS strips it, Python does not. Measured at HEAD: "\ufeff40W" was ACCEPTED by
#                  Python (the anchored quantity rule cannot see past the BOM, so the token
#                  survived on "has a letter, has a digit, four characters") and refused as
#                  `quantity` by TypeScript. A BOM leads real scraped cells whenever a page is
#                  served UTF-8-with-signature, so this is not a hypothetical token.
#   U+0085 (NEL)   Python's isspace() says yes, JS's \s says no.
#   U+1C-U+1F      Python's isspace() says yes, JS's \s says no. Deliberately NOT in the set:
#                  they are control characters and `bad_char` is the right answer for them on
#                  both sides, which is what leaving them out produces.
# The same set does both jobs, so "stripped at the edge" and "refused inside" can never drift
# apart either. The pattern text is character-for-character the one in src/pipeline/partNumber.ts.
# A DECLARED CONSTANT NOBODY READS IS NOT A RULE (4 Sep 2026): _PN_TRIM and _PN_WHITESPACE were
# added here, documented here and in the fixture, and pinned by S24-S28 — while is_part_number
# below went on calling str.strip() and str.isspace(). The comment said one thing, the code did
# another, and the only reason it was visible at all is that this suite was already red. Grep for
# every constant you declare and confirm something reads it (D:\Project\CLAUDE.md section 10).
# WHICH CHARACTER PROVES WHICH HALF (5 Sep 2026, measured over U+0000-U+3000 plus
# U+FEFF/U+180E/U+200B in both languages, not assumed): str.strip()/isspace() cover this set
# MINUS U+FEFF PLUS U+001C-U+001F, and JS trim()/\s cover it MINUS U+0085. So the BOM and the
# U+001C cases in tests/fixtures/partnumbers.json are what turns THIS file red when it is
# reverted to str.strip(), and U+0085 (NEL) is the only character that can turn the TypeScript
# twin red - it strips a BOM natively, so the BOM cases prove nothing over there. Five \u0085
# cases were added to the fixture for that. The two halves fail independently now.
_PN_SPACE = r"\t\n\v\f\r\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_PN_TRIM = re.compile(r"^[" + _PN_SPACE + r"]+|[" + _PN_SPACE + r"]+$")
_PN_WHITESPACE = re.compile(r"[" + _PN_SPACE + r"]")

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
    # _PN_TRIM, not str.strip(): the space set is explicit so the TypeScript twin cannot answer
    # differently on a BOM or a NEL (see _PN_SPACE above).
    k = _PN_TRIM.sub("", key or "")
    if not k:
        return False, "empty"
    if _PN_BAD_CHAR.search(k):
        return False, "bad_char"
    if _PN_WHITESPACE.search(k):
        return False, "whitespace"
    # the digit-led Cisco PID shapes, before the rules that would read them as quantities,
    # as ranges or as unit tokens
    if (_PN_KEEP_ASSEMBLY.match(k) or _PN_KEEP_NUMERIC.match(k) or _PN_KEEP_SPARE.match(k)
            or _PN_KEEP_MODEL_SUFFIX.match(k) or _PN_KEEP_ISR_VA.match(k)):
        return True, None
    # ONE trailing '=' is stripped before the four label refusals below (4 Sep 2026). Without it
    # "0.75K=" was ACCEPTED while "0.75K" was refused: the quantity pattern is anchored \+?$, so
    # the '=' carried the token past every refusal and it survived on "has a letter, has a digit,
    # four characters". A junk token does not stop being junk because a scraper glued a suffix to
    # it, and it must be refused for the SAME reason the bare token is.
    #
    # TWO bounds, both read off the corpus rather than assumed, because the first draft of this
    # refused three REAL PIDs (all three are listed under "End-of-Sale Product Part Number"):
    #   * the strip does NOT reach standard / connector / protocol. Those three match by
    #     prefix-plus-tail ('CE', 'EN', 'UL', 'G.'), which is loose, and the '=' is currently all
    #     that shields CE-10GSFP-SR= and CE-1GSFP-T= (real Cisco VCS transceivers, siblings of a
    #     whole CE-* family). Extending the strip there turns a shielded pre-existing looseness
    #     into an active refusal of real parts. The bare CE-10GSFP-SR is still refused as
    #     `protocol` today — that is the underlying defect, recorded, not fixed here.
    #   * a quantity core carrying a multiplier 'x' KEEPS its accept. Cisco's CRS line cards are
    #     named exactly that way and every one has a spare SKU: 1X100GBE=, 40X10GE-WLO=,
    #     4X100GE-LO=, 20X10GBE-WL-XFP=. "24x10G" is a port count and never carries a spare
    #     marker, so here the '=' is the whole discriminator and it points the other way.
    core = k[:-1] if k.endswith("=") else k
    if any(rx.match(core) for rx in _PN_DATE):
        return False, "date"
    if (_PN_QUANTITY.match(core) or _PN_COUNT_WORD.match(core)) and not (core is not k and "x" in core.lower()):
        return False, "quantity"
    if _PN_FOOTNOTE.match(core):
        return False, "footnote"
    # standards before versions: 802.3af is a standard, 17.9.4a a version, and both are digits
    # and dots with a letter tail
    if any(rx.match(k) for rx in _PN_STANDARD):
        return False, "standard"
    if _PN_VERSION.match(core):
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
