"""adapters.juniper_hct - the extractor for Juniper Pathfinder's Hardware Compatibility Tool.

ONE extractor, two callers, same as cisco_specs_deep: `sources/juniper.py` drives it from the
queue, and anything replaying the cache calls `extract_model()` directly. A second copy of these
rules would be a second set of bugs (D:\\Project\\CLAUDE.md section 10).

WHERE THE DATA IS. apps.juniper.net/hct is a Next.js App Router application and its model pages
are SERVER rendered: the entire specification set is already in the HTML when it arrives, pushed
as `self.__next_f.push([1,"<escaped JSON>"])`. Nothing here needs a browser, a wait, or a
rendering settle - the "Loading..." text a reader sees is the client hydrating over data that is
already present. `_flight()` concatenates those pushes and unescapes them back to real JSON text;
scanning the RAW page instead means matching through JS string escaping, which is how a regex
ends up matching nothing and reporting success.

THE SHAPE, measured from XENPAK-1XGE-ZR and CFP-GEN2-100GBASE-LR4 on 5 Sep 2026:

    "component": {"modelNumber": "...", "description": "...", "category": "Transceivers",
                  "categoryKey": 100001, "useCase": "TBD", "isModelEol": "Yes"}
    "attributes": [{"name": "Part Number", "value": "740-011268", "caveatMessage": null}, ...]
    "standardParams": [{"standard": "10GBASE-Z", "parameters": [{"name": "...", "value": "..."}]}]
    "supportedPlatforms": [...]
    "supportedInterfaceModels": [...]

A model number HCT does not know answers HTTP **200** with `"component": {}` and
`"attributes": null`. The status cannot decide found-vs-not-found here and neither can length: a
real page measured 37.7 KB and the not-found page 32.1 KB, close enough that a sparse real model
would sit between them. `is_found()` reads the record.

TWO WAYS THIS FILE CAN LIE, BOTH MEASURED, BOTH GUARDED, BOTH WITH SABOTAGE CASES:

  1. HCT WRITES "NOT PUBLISHED" AS A BARE EM DASH. `Operating Temperature (range)` on
     XENPAK-1XGE-ZR is U+2014 and nothing else; so is `Storage temperature`. Passed through, that
     is a confident fact whose value is a dash, against the standing rule that a parser which
     cannot parse returns a reason and stores nothing. `_usable()` refuses it, along with the
     other placeholders HCT actually uses - "TBD" is the literal value of `useCase` on both models
     inspected.

  2. HCT WRITES MINUS AS AN EN DASH, AND SEPARATES NUMBER FROM UNIT WITH A NO-BREAK SPACE.
     `Receiver input power, each lane (minimum)` is "\u201325.0\u00a0dBm": U+2013 EN DASH, not
     U+002D. A downstream reader that does not know this stores POSITIVE 25 dBm for a receiver
     sensitivity - absurd in physics, comfortably inside any plausible band, and indistinguishable
     from a real figure once written. `_clean()` folds U+2212/U+2013/U+2014 to an ASCII hyphen
     ONLY where the character is acting as a sign or a range separator (adjacent to a digit) and
     folds U+00A0 to a space. The order matters and is the whole rule: the placeholder test runs
     FIRST, because after the fold a bare em dash would look like a bare hyphen and a hyphen is
     not obviously nothing.

WHAT IS NOT DONE HERE. No label is mapped to a field key and no value is parsed into a number.
That is src/core/deepSpecMap.ts and the normaliser, with the alias rules in data/schema - one
vocabulary, one place. This file emits the label HCT printed, the value HCT printed, and a
locator that names the cell it came out of.
"""
from __future__ import annotations

import json
import re

#: `self.__next_f.push([1,"...."])` - the flight payload, as a JS string literal. Group 1 is the
#: literal WITH its quotes so json.loads can do the unescaping; hand-written unescaping of \\u,
#: \\n and \\" is exactly the kind of second parser this project keeps paying for.
PUSH = re.compile(r'self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)')

#: Values HCT prints when it has nothing to publish. Compared after whitespace folding and
#: case-folding, against the WHOLE value: "N/A" is not published, but "10 km (N/A on MX)" is.
#:
#: The dashes are written as ESCAPES, not as themselves. Seven of these characters render as a
#: short horizontal line and three of them are visually identical in most fonts, so a literal set
#: cannot be reviewed - a reader cannot tell U+2013 from U+2012 by looking, and a missing one is
#: a placeholder that gets stored as a fact. This file keeps every non-ASCII codepoint as an
#: escape for that reason and contains no non-ASCII byte at all.
PLACEHOLDERS = frozenset({
    "", "-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212",
    "n/a", "na", "n.a.", "tbd", "tba", "none", "null", "not applicable", "not available",
    "?", "--", "---",
})

#: Dash characters HCT uses where ASCII would use a hyphen-minus. Folded only next to a digit.
DASHES = "\u2010\u2011\u2012\u2013\u2014\u2015\u2212"
_SIGN_DASH = re.compile(f"(?<=[0-9])[{DASHES}]|[{DASHES}](?=[0-9])")

#: Attribute names that are IDENTIFIERS, not specifications. They must never become facts:
#: "Part Number" is Juniper's orderable number for the model (740-011268 for XENPAK-1XGE-ZR) and
#: belongs in `aliases`, and a model number recorded as a fact about itself is noise the gate
#: would have to learn to reject later.
IDENTIFIER_ATTRS = frozenset({"part number", "old part number", "model number", "model"})


def _clean(s: str) -> str:
    """Fold the characters HCT uses that mean something other than they look.

    A dash ADJACENT TO A DIGIT becomes an ASCII hyphen, so "\u201325.0 dBm" is negative and
    "\u201340 C to 85 C" keeps its sign. A dash that is NOT next to a digit is left alone: it is
    prose ("Duplex LC - PC/UPC"), and rewriting prose is how a raw value stops being raw.

    The NO-BREAK SPACE between number and unit ("4.5\u00a0dBm") is folded by the trailing `\\s+`
    collapse, which is Unicode-aware in Python 3 and matches U+00A0 and U+202F. An explicit
    `.replace("\u00a0", " ")` was written here first and then REMOVED on 5 Sep 2026: sabotaging it
    changed no test result, because the collapse was already doing the work. A guard that cannot
    be made to fail is not a guard, and leaving it in invites someone to delete the collapse
    instead. U+FEFF is removed by hand because `\\s` does NOT match it (verified, same session).
    """
    if not s:
        return ""
    s = s.replace("\ufeff", "")
    s = _SIGN_DASH.sub("-", s)
    return re.sub(r"\s+", " ", s).strip()


def _usable(value: str) -> bool:
    """Is this a value, or is it HCT saying it has none?

    Runs BEFORE _clean's dash fold, on the raw string, because a bare em dash folded to a hyphen
    stops looking like a placeholder and starts looking like a value.
    """
    v = re.sub(r"\s+", " ", (value or "")).strip().lower()
    return v not in PLACEHOLDERS


def _flight(html: str) -> str:
    """The page's React flight payload, unescaped, as one string.

    Returns "" rather than raising on a page with no pushes: a page that is not an HCT page is
    "no data", not a crash, and the caller decides what that means.
    """
    out = []
    for m in PUSH.finditer(html or ""):
        try:
            out.append(json.loads(m.group(1)))
        except ValueError:
            # one malformed push does not invalidate the rest; a page is a stream of them
            continue
    return "".join(out)


def _json_after(flight: str, key: str) -> object | None:
    """The JSON value that follows `"key":` in the flight text, decoded with the stdlib.

    The flight payload is a stream of React elements, not one JSON document, so it cannot be
    parsed whole. `json.JSONDecoder.raw_decode` reads exactly one value from an offset and stops,
    which is precisely the tool for this and avoids counting brackets by hand.
    """
    needle = f'"{key}":'
    i = flight.find(needle)
    if i < 0:
        return None
    dec = json.JSONDecoder()
    try:
        val, _ = dec.raw_decode(flight, i + len(needle))
    except ValueError:
        return None
    return val


def is_found(html: str) -> bool:
    """Does this HCT model page describe a model?

    HCT answers 200 for a model number it does not know, with `"component": {}` and
    `"attributes": null`. Both are checked: `component` alone would call a hypothetical page with
    a record and no specifications not-found, and `attributes` alone would trust a page that
    carries an empty attribute list for a real model.
    """
    flight = _flight(html)
    if not flight:
        return False
    comp = _json_after(flight, "component")
    if isinstance(comp, dict) and comp.get("modelNumber"):
        return True
    return False


def extract_model(html: str, url: str = "") -> dict:
    """Everything one HCT model page publishes, as raw label/value pairs plus its identifiers.

    The return is deliberately NOT the pipeline's RESULT shape - that translation belongs to the
    lane (`sources/juniper.py`), so this function stays usable from a cache replay that wants the
    record rather than a queue result.
    """
    flight = _flight(html)
    comp = _json_after(flight, "component")
    comp = comp if isinstance(comp, dict) else {}
    sku = (comp.get("modelNumber") or "").strip()
    if not sku:
        return {"sku": None, "found": False, "facts": [], "aliases": [], "relations": [],
                "lifecycle": None, "name": None, "refused": "hct_has_no_record_for_this_model"}

    facts: list[dict] = []
    aliases: list[dict] = []

    # --- the flat attribute list ------------------------------------------------------------
    for i, a in enumerate(_json_after(flight, "attributes") or []):
        if not isinstance(a, dict):
            continue
        label, value = _clean(a.get("name") or ""), a.get("value")
        if not label or not isinstance(value, str) or not _usable(value):
            continue
        if label.lower() in IDENTIFIER_ATTRS:
            # Juniper's orderable number, e.g. 740-011268. An identifier, never a specification.
            aliases.append({"kind": "vendor_part_number", "value": _clean(value)})
            continue
        facts.append({"label": label, "value": _clean(value), "locator": f"attributes[{i}]"})

    # --- the per-standard parameter tables ---------------------------------------------------
    # `standardParams` is a LIST because one optic can be qualified against more than one
    # standard, and the same parameter name then appears in each with a DIFFERENT value. Both
    # models inspected on 5 Sep 2026 carried exactly one standard, so the single-standard case is
    # the one that has been seen - which is exactly why the multi-standard case is handled
    # explicitly rather than left to whichever entry happened to be last. With one standard the
    # label is bare, because prefixing every label on every optic would make the vocabulary
    # depend on a list length; with more than one the standard is part of the label, because a
    # 40 km reach and a 10 km reach under one label is a value decided by write order.
    groups = [g for g in (_json_after(flight, "standardParams") or []) if isinstance(g, dict)]
    prefix_needed = len(groups) > 1
    for g in groups:
        std = _clean(g.get("standard") or "")
        for i, p in enumerate(g.get("parameters") or []):
            if not isinstance(p, dict):
                continue
            label, value = _clean(p.get("name") or ""), p.get("value")
            if not label or not isinstance(value, str) or not _usable(value):
                continue
            facts.append({
                "label": f"{std} > {label}" if (prefix_needed and std) else label,
                "value": _clean(value),
                "locator": f"standardParams[{std or i}].parameters[{i}]",
            })

    # --- compatibility, as relations rather than facts ---------------------------------------
    # HCT's whole purpose is "which platforms take this optic". A supported platform is a
    # RELATION, not a property of the optic: recording "MX960" as a fact about a transceiver
    # would put a router's name in a specification field.
    relations: list[dict] = []
    plats = _json_after(flight, "supportedPlatforms")
    for entry in _platform_names(plats):
        relations.append(entry)
    for m in (_json_after(flight, "supportedInterfaceModels") or []):
        if isinstance(m, dict) and (m.get("modelNumber") or "").strip():
            relations.append({"kind": "compatible", "sku": m["modelNumber"].strip(),
                              "note": _clean(m.get("category") or "") or None})

    eol = (comp.get("isModelEol") or "").strip().lower()
    lifecycle = {"end_of_life": True} if eol == "yes" else ({"end_of_life": False} if eol == "no" else None)

    desc = _clean(comp.get("description") or "")
    return {
        "sku": sku,
        "found": True,
        "facts": facts,
        "aliases": aliases,
        "relations": relations,
        "lifecycle": lifecycle,
        # HCT's description is evidence, and it is also the only place some models state their
        # reach in prose ("XENPAK Pluggable 10GBASE-ZR Optic Module, 80 Km reach"). It is kept as
        # the name and NOT mined here: mining a sentence for a number is the product_name_mining
        # method, which already exists and has its own rules.
        "name": desc or None,
        "category": _clean(comp.get("category") or "") or None,
        "url": url,
    }


def _platform_names(plats: object) -> list[dict]:
    """`supportedPlatforms` in either shape HCT uses, flattened to compatible-relations.

    On a model page it is a list of `{productName, caveat, isPlatformEol}`; in the category
    listing it is a dict keyed by product line ("Routing", "Switching") whose values are those
    lists. Both are read, because an adapter that understands one shape and silently returns
    nothing for the other is the empty-section failure this project has already paid for.
    """
    out: list[dict] = []
    if isinstance(plats, dict):
        for group, items in plats.items():
            for it in (items or []):
                if isinstance(it, dict) and (it.get("productName") or "").strip():
                    out.append({"kind": "compatible", "sku": it["productName"].strip(),
                                "note": _clean(it.get("caveat") or "") or _clean(str(group))})
    elif isinstance(plats, list):
        for it in plats:
            if isinstance(it, dict) and (it.get("productName") or "").strip():
                out.append({"kind": "compatible", "sku": it["productName"].strip(),
                            "note": _clean(it.get("caveat") or "") or None})
    return out


def extract_listing(html: str, url: str = "") -> list[dict]:
    """Every model summary on an HCT category page.

    The category page carries a full record per model - 488 of them on /hct/category/100001 -
    server-rendered in the same flight payload. It is a genuine fact source in its own right and
    not only a discovery surface, but it publishes FEWER fields than the model page (no transmit
    power, no receiver input power, no operating temperature), so the lane treats it as discovery
    and lets the model pages carry the specifications. Reading it here means the listing's own
    record is available to a replay without a second parser.
    """
    flight = _flight(html)
    out: list[dict] = []
    dec = json.JSONDecoder()
    for m in re.finditer(r'\{"modelNumber":', flight):
        try:
            rec, _ = dec.raw_decode(flight, m.start())
        except ValueError:
            continue
        if not isinstance(rec, dict):
            continue
        sku = (rec.get("modelNumber") or "").strip()
        # a summary record is the one that carries the listing's own columns; the nested
        # `supportedInterfaceModels` entries also start with "modelNumber" and are not models we
        # are listing, so require a field only the summary has
        if not sku or "categoryKey" not in rec:
            continue
        out.append({"sku": sku, "record": rec, "url": url})
    return out
