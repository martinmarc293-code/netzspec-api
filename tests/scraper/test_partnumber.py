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

total = len(ACCEPT) + len(REFUSE)
check("S11", f"at least 60 cases, at least half refusals ({len(ACCEPT)} accept / {len(REFUSE)} refuse)",
      total >= 60 and len(REFUSE) * 2 >= total)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
