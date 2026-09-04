"""tests/scraper/test_partnumber.py — proof for sources.base.is_part_number, the ONE definition of
"is this a part number" that the worker's enqueue, every adapter's discover() and the watchdog
share.

    python3.11 tests/scraper/test_partnumber.py

Every token below was seen in the queue or on a page today (3 Sep 2026). Half are refusals and
each refusal must come back with the STATED reason: "refused" alone would let one rule die and
another catch its cases by accident, which is how a placeholder check once matched nothing for
weeks while the suite stayed green. The accepts are the Cisco shapes a naive rule kills first:
digit-first PIDs (15216-ATT-LC=, 8804-FC0, 8201-32FH, 76-ES+XT-4TG3C), '/' and '=' and '++'
forms, and Ubiquiti's dash-structured names without a digit (USW-Aggregation).

Sabotage: every reason in PART_NUMBER_REASONS must be produced by at least one case (a reason
nothing can trigger is a dead rule); the short-name opt-in must flip Z4 and UX and nothing
longer; and a refusal reason outside the vocabulary is a miss.
"""
from __future__ import annotations
import io, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
from sources.base import is_part_number, PART_NUMBER_REASONS  # noqa: E402

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:74]:76}" + ("" if ok else f" | got {got[:120]}"))


# ---- accepts: real part numbers, as the vendors and the sites write them -------------------------
ACCEPT = [
    "C9200L-24P-4G",            # Cisco base SKU
    "C9200L-24P-4G-E",          # licence variant
    "C9200L-24P-4G-A++",        # TAA variant with '++'
    "C9200L-24P-4G-E=",         # spare with '='
    "SFP-10G-SR=",              # the transceiver, not the connector
    "N9K-C93180YC-FX",
    "15216-ATT-LC-12=",         # digit-first Cisco optical PID
    "15216-ATT-LC=",
    "ISR4331/K9",               # '/' form
    "WS-C3850-48P-L",
    "8804-FC0",                 # 8000-series fabric card
    "8201-32FH",                # 8000-series fixed router: digits-dash-digits-letters, not a range
    "76-ES+XT-4TG3C",           # 7600 ES+ line card, digit-first with '+'
    "ONS-SC-2G-28.7",           # a wavelength in the PID, not a version
    "ONS-SC-4G-55.7=",
    "P2HD1.2G15TXQ37=",
    "M93S2K9-NPE-9.2.2",        # an IOS image: version INSIDE a PID stays a PID
    "PI-APL-IMAGE-2.2",
    "CH37/L/U/SC/15200=",
    "797X-PER-ROOM",
    "DS-X9448-768K9++=",
    "4G-LTE-ANTM-D=",           # a Cisco antenna, not the 4G-LTE standard
    "MACSEC-LIC",               # starts with a protocol name and is not one
    "ENCS5104-K9",              # starts with 'EN' and is not a standard number
    "GLC-TE",
    "CAB-TA-NA=",
    "PWR-C5-125WAC/2",
    "455883-B21",               # HPE
    "J9776A",                   # HPE
    "CRS326-24G-2S+RM",         # MikroTik
    "ECS-Aggregation",          # dash-structured name without a digit (task spec)
    "USW-Aggregation",          # Ubiquiti
    "USW-Flex-XG",              # Ubiquiti
    "UCS-CPU-E52630D=",
    "AIR-AP3802E-IK910",
    # ---- the two digit-only Cisco PID shapes, kept explicitly since 4 Sep 2026 --------------
    # Every one of these is a row in the live parts table. Until today all 1,497 were refused as
    # `quantity`, and because this function is the ONE gate at enqueue they could never be
    # fetched (docs/CISCO_GAPS.md finding 10).
    "10-2834-01",       # NCS 2000 assembly, the audit's example
    "10-2000-01",       # a real assembly whose middle group looks like a year
    "10-2007-01",
    "10-1453-01",
    "10-1750-01",
    "10-1832-03",       # a revision other than -01 in the tail
    "10-1845-01",
    "10-1846-01",
    "10-1022008-01",    # GS7000: a seven-digit middle group
    "10-1022026-01",
    "03-100261-01",     # a leading zero in the head group
    "37-1016-01",       # UCS B-Series assembly
    "1030033",          # Scientific-Atlanta video PIDs: Optical Passive Components
    "1005444",
    "1000897",          # Prisma II
    "1030007",
    "187134",           # six digits
    "207340",
    "562580",           # GS7000 Nodes
    "745415",           # RF Gateway
    "3993131",
    "4007228",
    "4028842",          # Prisma D-PON
    "126291",           # UCS B-Series
    "580503",           # S-Series storage
    "075681",           # a leading zero, six digits
    # ---- three more digit-led shapes, kept 4 Sep 2026 ----------------------------------------
    # Found by the planner reading its OWN refusals: 40 queued lookups were held back by these.
    # Every bound was read off data/reference/cisco-pid-universe.json (69,487 PIDs) and
    # runs/acquired/** (4,526 pages), not guessed. The near-misses are in REFUSE below.
    "886VA",            # Cisco 880-series ISR, VDSL2/ADSL2+ Annex A. Read as "886 volt-amperes"
    "887VA",
    "896VA",
    "897VA",
    "897VAB",           # the letter tail already defeated the quantity rule: still an accept
    "8201=",            # Cisco 8000 Series router, spare order. Refused as no_letter: no [A-Z]
    "8202=",
    "8404=",
    "8608=",
    "15216-2950=",      # ONS 15216 spare: the 5th and last '=' refusal in the universe
    "2000=",            # DECIDED accept: no shape separates it from 8201=, and a "not round"
                        # carve-out would refuse a real 8800= or 9200= spare
    "9800-40",          # Catalyst 9800 wireless controller: a 2-digit tail is not a range
    "9800-80",
    "886VA=",           # the keeps tolerate one spare marker, so these answer as their bare twins
    "9800-40=",
    # ---- the three REAL PIDs the first draft of the '=' strip refused ------------------------
    # All three are listed under "End-of-Sale Product Part Number" in the universe. They are the
    # reason the strip has bounds: it exempts a quantity core carrying a multiplier 'x', and it
    # does not reach standard / connector / protocol at all.
    "1X100GBE=",        # CRS line card; family 40X10GE-WLO=, 4X100GE-LO=, 20X10GBE-WL-XFP=
    "CE-10GSFP-SR=",    # Cisco VCS transceiver; the '=' is all that shields it from `protocol`
    "CE-1GSFP-T=",
    "24x10G=",          # the deliberate consequence: a port count never carries a spare marker
]

# ---- refusals: (token, the reason it must be refused for) ----------------------------------------
REFUSE = [
    ("0.75K", "quantity"),                  # a MAC-table size read as a key
    ("0.6-1.2A", "quantity"),               # a current range
    ("0-30M/50M", "quantity"),              # a distance range with two units
    ("10/100/1000", "quantity"),            # a speed list
    ("24x10G", "quantity"),                 # a port count
    ("40W", "quantity"),
    ("2.5G", "quantity"),
    ("10Gbps", "quantity"),
    ("1-CPU", "quantity"),                  # a count with its noun
    ("2-PSU", "quantity"),
    ("15200", "quantity"),                  # a bare number
    ("13368", "quantity"),                  # five digits: below the numeric-PID band, real catalogue noise
    ("1234567890", "quantity"),             # ten digits: above it
    ("162870776", "quantity"),              # nine digits, a scraped value that IS in the catalogue
    ("100-1453-01", "quantity"),            # three-digit head: not the assembly shape
    ("10-1022008-011", "quantity"),         # three-digit tail: not the assembly shape
    # ---- near-misses of the three keeps added 4 Sep 2026 -------------------------------------
    ("100VA", "quantity"),                  # a UPS rating: outside the 8xx band AND round
    ("850VA", "quantity"),                  # a REAL rating from runs/acquired, INSIDE the 8xx
                                            # band: the band alone would have flipped it, so the
                                            # non-zero-final-digit clause earns its place here
    ("800VA", "quantity"),                  # real rating, 8xx band, round
    ("1500VA", "quantity"),                 # commonest rating in the corpus: four digits
    ("9800", "quantity"),                   # the model alone is a bare number
    ("8201", "quantity"),                   # without the spare '=' it is a four-digit number
    ("9800-4", "quantity"),                 # a 1-digit tail is no Cisco suffix (-40/-80/-L/-CL)
    ("2024-10", "quantity"),                # a year-month, the one other reading of NNNN-NN
    ("1999-12", "quantity"),                # the 19xx half of the same guard
    ("1000-4999", "quantity"),              # a real price-break range: 4-4, not 4-2
    ("1545-1548", "quantity"),              # a real wavelength range, ascending
    # ---- the trailing-'=' hole, closed 4 Sep 2026 --------------------------------------------
    # Every one of these was ACCEPTED while its bare twin was refused: the quantity pattern is
    # anchored \+?$, so an '=' carried the token past every refusal and it survived on "has a
    # letter, has a digit, four characters". Each must now be refused for the SAME reason.
    ("0.75K=", "quantity"),
    ("0-30M/50M=", "quantity"),
    ("40W=", "quantity"),
    ("1-CPU=", "quantity"),
    ("17.9.4a=", "version"),
    ("v2.1=", "version"),
    ("2024-10-31=", "date"),                # ALSO caught the spare keep swallowing a date
    ("1.DDR4-3200=", "footnote"),
    ("2x=", "too_short"),                   # the strip changes whether a rule answers, not which
    ("1.6.1_002=", "no_letter"),
    # the 963 genuine catalogue-noise SKUs the enumeration created as "parts" (docs/CISCO_GAPS.md
    # finding 10): every one of these is a row in the live parts table and none is a product.
    ("1000BASE-LX", "standard"),
    ("100BASE-LX", "standard"),
    ("10GBASE-CX4", "standard"),
    ("141GB", "quantity"),
    ("14.9W", "quantity"),
    ("10A/250V", "quantity"),
    ("12-54VDC", "quantity"),
    ("1440+", "quantity"),
    ("10/25G", "quantity"),
    ("1038.2W", "quantity"),                # a Nexus Dashboard power measurement
    ("1413.9W", "quantity"),
    ("15.3.2T", "version"),                 # IOS releases enumerated as routers
    ("15.0.1M", "version"),
    ("15.2.1T", "version"),
    ("01-MAY-2022", "date"),
    ("2024-10-31", "date"),
    ("10/31/2024", "date"),
    ("1.DDR4-3200", "footnote"),            # a footnote number glued to a token
    ("1.QSFP-40/100-SRBD", "footnote"),
    ("17.9.4a", "version"),
    ("15.2(4)E7", "version"),
    ("v2.1", "version"),
    ("1000BASE-T", "standard"),
    ("10GBASE-SR", "standard"),
    ("10/100/1000BASE-T", "standard"),
    ("2.5GBASE-T", "standard"),
    ("4G-LTE", "standard"),
    ("802.3af", "standard"),
    ("IEEE802.1Q", "standard"),
    ("RJ45", "connector"),
    ("SFP+", "connector"),
    ("QSFP28", "connector"),
    ("QSFP-DD", "connector"),
    ("USB-C", "connector"),
    ("HDMI", "connector"),
    ("IPv4", "protocol"),
    ("PoE+", "protocol"),
    ("SNMPv3", "protocol"),
    ("UL60950-1", "protocol"),
    ("RoHS", "protocol"),
    ("VLAN", "protocol"),
    ("1_000", "no_letter"),
    ("Z4", "too_short"),                    # unless a source opts into short names
    ("UX", "too_short"),
    ("Aggregation", "bare_word"),           # the second half of USW-Aggregation on its own
    ("Ethernet", "bare_word"),
    ("Datasheet", "bare_word"),
    ("Cisco C9200L", "whitespace"),
    ("C9200L-24P-4G, Cisco", "bad_char"),
    ("", "empty"),
    ("   ", "empty"),
]

for i, tok in enumerate(ACCEPT, 1):
    ok, reason = is_part_number(tok)
    check(f"A{i}", f"accept {tok!r}", ok is True and reason is None, f"({ok}, {reason})")

seen_reasons: set[str] = set()
for i, (tok, want) in enumerate(REFUSE, 1):
    ok, reason = is_part_number(tok)
    if reason:
        seen_reasons.add(reason)
    check(f"R{i}", f"refuse {tok!r} as {want}", ok is False and reason == want, f"({ok}, {reason})")

# ---- sabotage: the rule set itself ------------------------------------------------------------------
check("S1", "every reason in the vocabulary is produced by at least one case (no dead rule)",
      set(PART_NUMBER_REASONS) <= seen_reasons, str(sorted(set(PART_NUMBER_REASONS) - seen_reasons)))
check("S2", "every refusal reason is in the vocabulary", seen_reasons <= set(PART_NUMBER_REASONS),
      str(sorted(seen_reasons - set(PART_NUMBER_REASONS))))
check("S3", "an accept never carries a reason; a refusal always does",
      all(is_part_number(t) == (True, None) for t in ACCEPT) and all(is_part_number(t)[1] for t, _ in REFUSE))
check("S4", "short-name opt-in: Z4 and UX accepted, U6+ accepted", is_part_number("Z4", allow_short=True)[0]
      and is_part_number("UX", allow_short=True)[0] and is_part_number("U6+", allow_short=True)[0])
check("S5", "short-name opt-in does not accept a one-character key", is_part_number("Z", allow_short=True) == (False, "too_short"))
check("S6", "short-name opt-in does not turn a four-letter word into a part number",
      is_part_number("Ethernet", allow_short=True) == (False, "bare_word") and is_part_number("Wall", allow_short=True) == (False, "bare_word"))
check("S7", "short-name opt-in changes nothing about quantities, dates or connectors",
      all(is_part_number(t, allow_short=True) == (False, r) for t, r in REFUSE if r in ("quantity", "date", "connector", "protocol", "standard")))
check("S8", "surrounding whitespace is stripped, not refused", is_part_number("  C9200L-24P-4G ") == (True, None))
check("S9", "None is empty", is_part_number(None) == (False, "empty"))
check("S10", "a key that is a variant of an accepted key is accepted too (C9200L-24P-4G-A-RF)",
      is_part_number("C9200L-24P-4G-A-RF") == (True, None))

# ---- sabotage: the two explicit KEEPS added 4 Sep 2026 ----------------------------------------------
# A keep that runs before every refusal is the most dangerous kind of rule: it can only ever let
# MORE through. These pin both of its bounds and prove it did not open a hole in the rules it
# jumps over.
check("S12", "the keeps do not swallow a date, a version or a footnote",
      is_part_number("2024-10-31") == (False, "date") and is_part_number("10/31/2024") == (False, "date")
      and is_part_number("01-MAY-2022") == (False, "date") and is_part_number("17.9.4a") == (False, "version")
      and is_part_number("1.DDR4-3200") == (False, "footnote"))
check("S13", "the numeric keep is bounded to 6-8 digits: 5 and 9+ are still quantities",
      is_part_number("13368") == (False, "quantity") and is_part_number("99999") == (False, "quantity")
      and is_part_number("162870776") == (False, "quantity") and is_part_number("1030033") == (True, None)
      and is_part_number("075681") == (True, None) and is_part_number("33554432") == (True, None))
check("S14", "the numeric keep takes digits only: a decimal, a unit or a slash is still refused",
      is_part_number("4042868.1410") == (False, "quantity") and is_part_number("128GB") == (False, "quantity")
      and is_part_number("10/100/1000") == (False, "quantity") and is_part_number("1030033.5") == (False, "quantity"))
check("S15", "the assembly keep takes exactly NN-NNNN..-NN: a 3-digit head or tail is still a quantity",
      is_part_number("100-1453-01") == (False, "quantity") and is_part_number("10-1022008-011") == (False, "quantity")
      and is_part_number("10-145-01") == (False, "quantity") and is_part_number("0-23") == (False, "quantity")
      and is_part_number("10-2834-01") == (True, None))
check("S16", "a kept numeric PID is accepted with allow_short off AND on (the keep is not a short-name rule)",
      is_part_number("1030033") == (True, None) and is_part_number("1030033", allow_short=True) == (True, None)
      and is_part_number("10-2834-01", allow_short=True) == (True, None))

check("S17", "the spare keep needs BOTH four leading digits and the '='",
      is_part_number("8201=") == (True, None) and is_part_number("15216-2950=") == (True, None)
      and is_part_number("8201") == (False, "quantity") and is_part_number("999=") == (False, "quantity")
      and is_part_number("100-499=") == (False, "quantity") and is_part_number("12=") == (False, "quantity"))
check("S21", "the '=' strip refuses a junk token for the SAME reason its bare twin is refused",
      all(is_part_number(t + "=")[1] == is_part_number(t)[1]
          for t in ("0.75K", "0-30M/50M", "40W", "1-CPU", "17.9.4a", "v2.1", "2024-10-31",
                    "1.DDR4-3200", "2x", "1.6.1_002", "10/100/1000", "0.6-1.2A")))
check("S22", "the strip has BOTH its bounds: a multiplier quantity and the loose prefix rules keep their accept",
      is_part_number("1X100GBE=") == (True, None) and is_part_number("24x10G=") == (True, None)
      and is_part_number("CE-10GSFP-SR=") == (True, None) and is_part_number("CE-1GSFP-T=") == (True, None)
      and is_part_number("1X100GBE") == (False, "quantity") and is_part_number("24x10G") == (False, "quantity"))
check("S23", "a keep runs before every refusal, so the year lookahead is on the spare keep too",
      is_part_number("2024-10-31=") == (False, "date") and is_part_number("1999-12-01=") == (False, "date")
      and is_part_number("15216-2950=") == (True, None) and is_part_number("8201=") == (True, None))
check("S18", "the model-suffix keep is exactly 4-2 and never a year-month or a range",
      is_part_number("9800-40") == (True, None) and is_part_number("9800-80") == (True, None)
      and is_part_number("9800-4") == (False, "quantity") and is_part_number("9800-400") == (False, "quantity")
      and is_part_number("980-40") == (False, "quantity") and is_part_number("2024-10") == (False, "quantity")
      and is_part_number("1999-12") == (False, "quantity") and is_part_number("1000-4999") == (False, "quantity"))
check("S19", "the ISR keep needs BOTH the 8xx band and a non-zero final digit",
      is_part_number("886VA") == (True, None) and is_part_number("897VA") == (True, None)
      and is_part_number("850VA") == (False, "quantity") and is_part_number("800VA") == (False, "quantity")
      and is_part_number("100VA") == (False, "quantity") and is_part_number("1500VA") == (False, "quantity")
      and is_part_number("886V") == (False, "quantity") and is_part_number("886VAC") == (False, "quantity"))
check("S20", "the three new keeps do not swallow a date, a version, a standard or a connector",
      is_part_number("2024-10-31") == (False, "date") and is_part_number("01-MAY-2022") == (False, "date")
      and is_part_number("15.3.2T") == (False, "version") and is_part_number("2.5GBASE-T") == (False, "standard")
      and is_part_number("QSFP-DD") == (False, "connector") and is_part_number("10/100/1000") == (False, "quantity"))

total = len(ACCEPT) + len(REFUSE)
check("S11", f"at least 60 cases, at least half refusals ({len(ACCEPT)} accept / {len(REFUSE)} refuse)",
      total >= 60 and len(REFUSE) * 2 >= total)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
