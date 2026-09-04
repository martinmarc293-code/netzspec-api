"""vocab — the ONE reader for the two vocabulary files, shared by every tool that asks
"is this raw label already accounted for?".

    data/schema/attribute-aliases.en.json   label -> field_key   (a MAPPED label)
    data/schema/attribute-ignore.en.json    label -> reason      (an IGNORED label)

Three tools used to answer that question and two of them carried their own copy of the alias
matcher (watchdog.py, label_inventory.py). Three copies of a helper is three copies of the same
bug — D:\\Project\\CLAUDE.md, "Three copies of a helper" — and the copies had already drifted:
only one of them knew about the trailing-unit retry that src/core/deepSpecMap.ts performs, so the
same label was "unmapped" in one report and "mapped" in another.

Why an IGNORE list exists at all. Before it, the watchdog's headline number was
"provantage: 13,241 of 15,489 labels unmapped (85%)", and roughly a third of that was the
distributor's own identity and stock rows — "Manuf Part#", "Manufacturer", "Product Name" —
which no field will ever hold because the part table already owns them. A percentage that counts
rows nobody intends to map cannot tell an improving vocabulary from a stalled one, so the work it
is meant to direct gets directed at nothing. Ignored labels are counted, reported and named; they
are simply not counted as a gap.

The ignore list is DATA, not code, for the same reason the alias rules are: adding one must not
need a deploy, and every entry carries its own reason in the file next to the pattern.

Neither file is allowed to fail silently. A missing or malformed file raises; the caller reports
"could not check", which is a different finding from "nothing to fix" (CLAUDE.md §10).
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
ALIASES_FILE = ROOT / "data" / "schema" / "attribute-aliases.en.json"
IGNORE_FILE = ROOT / "data" / "schema" / "attribute-ignore.en.json"

# src/core/deepSpecMap.ts retries a label with a trailing unit parenthetical removed, so
# "MTBF (hours)" is matched by a rule written for "MTBF". A label counted as unmapped when the
# pipeline does map it sends the vocabulary work at a rule that already exists.
_TRAILING_UNIT = re.compile(r"\s*\(\s*[A-Za-z\u00b5\u00b0%]{1,4}(?:\s*/\s*[A-Za-z]{1,3})?"
                            r"(?:\s+(?:rms|peak|dc|ac))?\s*\)\s*\d*\s*$")

_ALIAS_CACHE: list[tuple[re.Pattern, str]] | None = None
_IGNORE_CACHE: list[tuple[re.Pattern, str]] | None = None
# keyed on the label alone: a corpus of 13,000 facts holds ~700 distinct labels against ~1,200
# rules, and without the memo one run is seven million regex tests.
_MAPPED_MEMO: dict[str, str | None] = {}
_IGNORED_MEMO: dict[str, str | None] = {}


def alias_rules() -> list[tuple[re.Pattern, str]]:
    """The compiled alias rules. Raises if the file cannot be read or does not compile."""
    global _ALIAS_CACHE
    if _ALIAS_CACHE is None:
        doc = json.loads(ALIASES_FILE.read_text(encoding="utf-8"))
        flags = re.I if doc.get("case_insensitive", True) else 0
        _ALIAS_CACHE = [(re.compile(r[0], flags), r[1]) for r in doc["rules"]]
        _MAPPED_MEMO.clear()   # the memo is keyed on the label alone; new rules invalidate it
    return _ALIAS_CACHE


def ignore_rules() -> list[tuple[re.Pattern, str]]:
    """The compiled ignore rules, each with the reason it is ignored. Raises like alias_rules:
    an unreadable ignore file must not quietly turn into "nothing is ignored", which would put
    4,000 identity rows back into the gap count with no sign that anything changed."""
    global _IGNORE_CACHE
    if _IGNORE_CACHE is None:
        doc = json.loads(IGNORE_FILE.read_text(encoding="utf-8"))
        flags = re.I if doc.get("case_insensitive", True) else 0
        _IGNORE_CACHE = [(re.compile(r[0], flags), r[1]) for r in doc["rules"]]
        _IGNORED_MEMO.clear()
    return _IGNORE_CACHE


def maps_to_field(label: str, rules: list[tuple[re.Pattern, str]] | None = None) -> str | None:
    """The field_key the alias rules send this label to, or None. First match wins, exactly as
    the TypeScript mapper does, and the trailing-unit retry is applied the same way."""
    if rules is None:
        rules = alias_rules()
    if label in _MAPPED_MEMO:
        return _MAPPED_MEMO[label]
    hit = None
    for rx, key in rules:
        if rx.search(label):
            hit = key
            break
    if hit is None:
        bare = _TRAILING_UNIT.sub("", label).strip()
        if bare and bare != label:
            for rx, key in rules:
                if rx.search(bare):
                    hit = key
                    break
    _MAPPED_MEMO[label] = hit
    return hit


def ignored_reason(label: str, rules: list[tuple[re.Pattern, str]] | None = None) -> str | None:
    """The reason this label is deliberately not mapped, or None. Checked AFTER the alias rules
    by every caller: a label that some rule already maps is mapped, whatever this file says, and
    an ignore entry that shadows a real rule is a defect the label_state() order makes visible
    rather than hiding."""
    if rules is None:
        rules = ignore_rules()
    if label in _IGNORED_MEMO:
        return _IGNORED_MEMO[label]
    hit = None
    for rx, reason in rules:
        if rx.search(label):
            hit = reason
            break
    _IGNORED_MEMO[label] = hit
    return hit


def label_state(label: str, arules=None, irules=None) -> tuple[str, str | None]:
    """("mapped", field_key) | ("ignored", reason) | ("unmapped", None) for one raw label."""
    key = maps_to_field(label, arules)
    if key:
        return ("mapped", key)
    reason = ignored_reason(label, irules)
    if reason:
        return ("ignored", reason)
    return ("unmapped", None)
