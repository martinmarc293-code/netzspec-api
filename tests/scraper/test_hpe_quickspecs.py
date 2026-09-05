"""tests/scraper/test_hpe_quickspecs.py — proof for scraper/sources/hpe_quickspecs.py.

Runs against the CACHED fixtures only (scraper/cache/<sha1(url)>.html, keyed by the requested
URL through netzscrape._key). Never fetches. Prints one PASS/MISS line per case and exits
non-zero on any miss.

    python3.11 tests/scraper/test_hpe_quickspecs.py
    python3.11 scripts/run_py_tests.py hpe-quickspecs

Sabotage cases: a "Just a moment..." page must be blocked, the real "404 Error | HPE" fixture
must be not-found, a key on no table must be not_listed, an empty spec table must yield nothing
WITHOUT claiming not_listed, "<b>C</b><b>PU</b>" must read as "CPU" (get_text(" ") fabricates
"C PU"), a rowspan'd section cell must prefix exactly the rows it spans, a localised "#B2B" SKU
must fold into its base entry even when the base row is absent, a history table must produce
no fact, and a spec header without a SKU must land on the family result.
"""
from __future__ import annotations
import io, re, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
import netzscrape  # noqa: E402
from sources import hpe_quickspecs as H  # noqa: E402

DOC_URL = "https://www.hpe.com/psnow/doc/a00073540enw"
DOC_ID = "a00073540enw"
NOT_FOUND_URL = "https://www.hpe.com/psnow/doc/a00094280enw"

CHROME_LEAF = re.compile(r"^(?:price|availability|in stock|stock status|shipping|(?:limited )?warranty|ratings?|reviews?|cart|related|similar|cookies?|wish list|compare|navigation|menu)$", re.I)
CHROME_SECTION = re.compile(r"^(?:reviews?|ratings?|shipping|warranty|cart|related|similar|see also|cookies?)$", re.I)


def is_chrome(label: str) -> bool:
    parts = label.split(" > ")
    return bool(CHROME_LEAF.search(parts[-1].strip()) or (len(parts) > 1 and CHROME_SECTION.search(parts[0].strip())))


npass = nfail = 0


def check(cid: str, what: str, ok: bool, detail: str = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:72]:72}" + (f" | {detail[:140]}" if detail and not ok else ""))


def fixture(url: str) -> str:
    cf = netzscrape.CACHE / f"{netzscrape._key(url)}.html"
    if not cf.exists():
        print(f"MISS | fixture | not cached: {url}"); sys.exit(2)
    return cf.read_text(encoding="utf-8", errors="replace")


# ---- resolve(): the documented URL for every task kind --------------------------------------
check("R1", "datasheet with the absolute doc URL returns it", H.resolve({"task": "datasheet", "key": DOC_URL}) == DOC_URL)
check("R2", "datasheet with the bare document id builds /psnow/doc/<id>", H.resolve({"task": "datasheet", "key": DOC_ID}) == DOC_URL)
check("R3", "datasheet with a /psnow/doc/<id> path is absolutised", H.resolve({"task": "datasheet", "key": "/psnow/doc/" + DOC_ID}) == DOC_URL)
check("R4", "part-page is not a task this source handles -> None", H.resolve({"task": "part-page", "key": "JL658A"}) is None)
check("R5", "search / gpl -> None (listing is the QuickSpecs library, proven in test_hpe_listing.py)",
      all(H.resolve({"task": k, "key": DOC_URL}) is None for k in ("search", "gpl")))
check("R6", "empty key -> None", H.resolve({"task": "datasheet", "key": ""}) is None)
check("R7", "a key that is neither a URL nor a doc id -> None", H.resolve({"task": "datasheet", "key": "JL658A"}) is None)

# ---- extract() on the QuickSpecs fixture -----------------------------------------------------
html = fixture(DOC_URL)
task = {"task": "datasheet", "key": DOC_URL, "url": DOC_URL}
r = H.extract(html, task)
fam = r["facts"]
others = r["others"]
by_sku = {o["sku"]: o for o in others}
all_facts = fam + [f for o in others for f in o["facts"]]
spec_skus = sorted(k for k, o in by_sku.items() if any(not f["label"].endswith("Description") for f in o["facts"]))

check("E1", "sku is the series name from the title, QuickSpecs suffix dropped",
      r["sku"] == "HPE Aruba Networking CX 6300 Switch Series", repr(r["sku"]))
check("E2", "scope is family on the top-level result", r.get("scope") == "family", repr(r.get("scope")))
check("E3", "name is the document title", r["name"] == "HPE Aruba Networking CX 6300 Switch Series QuickSpecs", repr(r["name"]))
check("E4", "not_listed is False for the document's own URL key", r["not_listed"] is False)
check("E5", "not_listed is False for the bare document id as key", H.extract(html, {"task": "datasheet", "key": DOC_ID})["not_listed"] is False)
check("E6", f"at least 200 SKUs in others (got {len(others)})", len(others) >= 200)
check("E7", f"at least 1000 facts in total (got {len(all_facts)})", len(all_facts) >= 1000)
check("E8", f"at least 15 SKUs carry a technical specification table (got {len(spec_skus)})", len(spec_skus) >= 15, str(spec_skus))
check("E9", "JL658A found with its description",
      by_sku.get("JL658A", {}).get("name") == "HPE Aruba Networking CX 6300M 24-port SFP+ and 4-port SFP56 Switch", repr(by_sku.get("JL658A", {}).get("name")))
check("E10", "JL665A found with its description",
      by_sku.get("JL665A", {}).get("name") == "HPE Aruba Networking CX 6300F 48-port 1GbE Class 4 PoE and 4-port SFP56 Switch", repr(by_sku.get("JL665A", {}).get("name")))
check("E11", "S0V64A found with its description",
      by_sku.get("S0V64A", {}).get("name") == "HPE Aruba Networking 50G eSR 300m MMF Transceiver", repr(by_sku.get("S0V64A", {}).get("name")))
check("E12", "no entry is created for a localised '#' suffix", not any("#" in k for k in by_sku), str([k for k in by_sku if "#" in k][:5]))
check("E13", "S0G95A carries #B2B/#B2C/#B2E/#AC3 as variant_sku aliases",
      sorted(a["value"] for a in by_sku.get("S0G95A", {}).get("aliases", [])) == ["S0G95A#AC3", "S0G95A#B2B", "S0G95A#B2C", "S0G95A#B2E"]
      and all(a["kind"] == "variant_sku" for a in by_sku.get("S0G95A", {}).get("aliases", [])),
      str(by_sku.get("S0G95A", {}).get("aliases")))
check("E14", "JL665A carries JL665A#B2B as a variant alias", any(a["value"] == "JL665A#B2B" for a in by_sku.get("JL665A", {}).get("aliases", [])))
check("E15", "the one product photo is primary, absolute, from the hpedam image server",
      len(r["images"]) == 1 and r["images"][0]["role"] == "primary"
      and r["images"][0]["url"] == "https://assets.ext.hpe.com/is/image/hpedam/a00073540enw_block1img?$crimg$", str(r["images"]))
check("E16", "price is None (a QuickSpecs publishes no price)", r["price"] is None)
check("E17", "every entry in others has a sku, a name and at least one fact",
      all(o["sku"] and o["name"] and o["facts"] for o in others), str([o["sku"] for o in others if not (o["sku"] and o["name"] and o["facts"])][:5]))
check("E18", "no family-level fact on this fixture (every spec table names its SKU)", len(fam) == 0, str(fam[:2]))


def val(sku: str, label: str) -> str | None:
    return next((f["value"] for f in by_sku.get(sku, {}).get("facts", []) if f["label"] == label), None)


EXACT = [
    ("JL658A", "BTO Models > HPE Aruba Networking CX 6300M > Description", "HPE Aruba Networking CX 6300M 24-port SFP+ and 4-port SFP56 Switch"),
    ("JL658A", "Description", "24x 1G/10G SFP+ ports 4x 1G/10G/25G SFP ports"),
    ("JL658A", "Physical Characteristics > Weight", "12.78 lbs (5.8 Kg)"),
    ("JL658A", "Performance > System switching capacity", "880 Gbps"),
    ("JL658A", "Electrical Characteristics > Frequency", "50-60 Hz"),
    ("JL658A", "Immunity > ESD", "IEC 61000-4-2"),
    ("JL658A", "CPU", "Quad Core ARM Cortex™ A72 @ 1.8GHz"),
    ("JL659A", "Performance > Model throughput capacity", "654 Mpps"),
    ("JL665A", "6300F TAA > HPE Aruba Networking CX 6300F > Description", "HPE Aruba Networking CX 6300F 48-port 1GbE Class 4 PoE and 4-port SFP56 Switch"),
    ("S0V64A", "Transceivers > SFP56 Transceivers > Description", "HPE Aruba Networking 50G eSR 300m MMF Transceiver"),
    ("845970-B21", "Transceivers > QSA28 Adapter > Description", "HPE QSFP28 to SFP28 Adapter"),
    ("Q9Y78AAS", "Software > Cloud Services / 63XX/38XX Switch Foundation Subscriptions > Description",
     "HPE Aruba Networking Central Switch Class-3 Foundation 1 year Subscription SaaS"),
]
for i, (sku, label, value) in enumerate(EXACT, 1):
    check(f"X{i}", f"exact: [{sku}] {label} = {value}", val(sku, label) == value, repr(val(sku, label)))

# the rowspan'd "Description" label on JL659A is followed by a single-cell continuation row:
# both are facts under the same label, in page order, each with its own locator
jl659_desc = [(f["value"], f["locator"]) for f in by_sku.get("JL659A", {}).get("facts", []) if f["label"] == "Description"]
check("X13", "JL659A Description continuation row is a second fact under the same label",
      len(jl659_desc) == 2 and jl659_desc[1][0] == "Supports PoE Standards IEEE 802.3af, 802.3at and 802.3bt (up to 60W)"
      and jl659_desc[0][1] != jl659_desc[1][1], str(jl659_desc))
# a multi-paragraph value that would exceed 500 chars is emitted per paragraph, nothing cut
r8s89_temp = [f for f in by_sku.get("R8S89A", {}).get("facts", []) if f["label"] == "Environment > Operating temperature"]
check("X14", "R8S89A Operating temperature (668 chars joined) is split per paragraph with :pN locators",
      len(r8s89_temp) >= 4 and r8s89_temp[0]["value"] == "32°F to 113°F (0°C to 45°C) up to 5,000 ft."
      and all(re.fullmatch(r"t\d+:r\d+:p\d+", f["locator"]) for f in r8s89_temp), str([(f["value"][:40], f["locator"]) for f in r8s89_temp]))

check("S1", "every fact has non-empty label, value and locator",
      all(f.get("label") and f.get("value") and f.get("locator") for f in all_facts))
check("S2", "no value longer than 500 characters", all(len(f["value"]) <= 500 for f in all_facts),
      str(max((len(f["value"]) for f in all_facts), default=0)))
check("S3", "locators are tN:rM or tN:rM:pK",
      all(re.fullmatch(r"t\d+:r\d+(?::p\d+)?", f["locator"]) for f in all_facts), str([f["locator"] for f in all_facts if not re.fullmatch(r"t\d+:r\d+(?::p\d+)?", f["locator"])][:3]))
check("S4", "locators unique within each entry",
      all(len({f["locator"] for f in o["facts"]}) == len(o["facts"]) for o in others))
chrome_hits = sorted({f["label"] for f in all_facts if is_chrome(f["label"])})
check("S5", "no chrome label among the facts", not chrome_hits, str(chrome_hits))
check("S6", "no currency amount among fact values", not any(re.search(r"[$€£]\s*\d", f["value"]) for f in all_facts))
odd = sorted({f["label"] for f in all_facts if re.search(r"(?:^| )[A-Za-z] [a-z]{2,}", f["label"])})
check("S7", "no label with a fabricated inline space ('C PU', 'S urge')", not odd, str(odd))
check("S8", "every ordering-table fact ends in '> Description' or is the bare spec 'Description'",
      all(f["label"].endswith("> Description") or f["label"] == "Description" or not f["locator"].startswith(("t0:", "t1:", "t2:", "t3:", "t4:", "t5:", "t6:", "t7:", "t8:")) for f in all_facts))
check("S9", "the Summary of Changes history table contributes no fact (no 'Version' label / date value)",
      not any(re.fullmatch(r"\d{2}-[A-Za-z]{3}-\d{4}", f["value"]) or f["label"].startswith("Version") for f in all_facts))

# ---- discover(): nothing, the QuickSpecs index is handled elsewhere ---------------------------
disc = H.discover(html, task)
check("D1", "discover() returns a list of zero tasks on the document", isinstance(disc, list) and len(disc) == 0, str(disc[:2]))
check("D2", "discover() returns only task kinds resolve() handles (vacuous on an empty list)",
      all(t.get("task") == "datasheet" and str(t.get("url", "")).startswith("https://") for t in disc))

# ---- sabotage ---------------------------------------------------------------------------------
JAM = "<html><head><title>Just a moment...</title></head><body><p>Checking your browser</p></body></html>"
check("B1", "a short 'Just a moment...' page is blocked", H.is_blocked(JAM) is True)
check("B2", "the real document is not blocked", H.is_blocked(html) is False)
nf_html = fixture(NOT_FOUND_URL)
check("N1", "the cached '404 Error | HPE' fixture is not_found", H.is_not_found(nf_html) is True)
check("N2", "the real document is not not_found", H.is_not_found(html) is False)
check("N3", "the challenge page is not not_found", H.is_not_found(JAM) is False)
check("L1", "extract() with key ZZZ-NOT-ON-THIS-PAGE reports not_listed True",
      H.extract(html, {"task": "datasheet", "key": "ZZZ-NOT-ON-THIS-PAGE"})["not_listed"] is True)
check("L2", "extract() with a SKU the ordering tables list is not not_listed",
      H.extract(html, {"task": "datasheet", "key": "JL658A"})["not_listed"] is False)

# The synthetic pages below carry `div.collateral-content` because psnow does: it is the
# container the document body is rendered into, and `extract()` now REFUSES a capture without it
# (a blank psnow shell parses into a tidy nothing, which the queue records as `no_facts`/`done`
# and nobody ever sees again — see the module docstring). A fixture that omits the container is
# not a minimal page, it is a page the site never serves, so the wrapper belongs here.
HEAD = (f'<html><head><title>X QuickSpecs | HPE</title>'
        f'<link rel="canonical" href="https://www.hpe.com/us/en/collaterals/collateral.{DOC_ID}.html">'
        f'</head><body><div class="collateral-content">')
EMPTY = HEAD + '<div class="uct-table"><table><tr><th colspan="3">Some Switch (JL000A)</th></tr></table></div></body></html>'
e = H.extract(EMPTY, task)
check("Z1", "an empty spec table yields zero facts", not e["facts"] and not any(o["facts"] for o in e["others"]),
      str(e["others"][:1]))
check("Z2", "... and does NOT claim not_listed (the page is about the key)", e["not_listed"] is False)

GLUE = HEAD + ('<table><tr><th colspan="3">Some Switch (JL000A)</th></tr>'
               '<tr><td><p><b>C</b><b>PU</b></p></td><td colspan="2"><p>Quad</p><p>Core</p></td></tr></table></body></html>')
g = H.extract(GLUE, task)
gf = g["others"][0]["facts"] if g["others"] else []
check("Z3", "'<b>C</b><b>PU</b>' reads as 'CPU', paragraphs join with a space",
      gf and gf[0]["label"] == "CPU" and gf[0]["value"] == "Quad Core", str(gf))

SPAN = HEAD + ('<table><tr><th colspan="3">Some Switch (JL000A)</th></tr>'
               '<tr><td>Fans</td><td colspan="2">two</td></tr>'
               '<tr><td rowspan="2">Physical</td><td>Height</td><td>1U</td></tr>'
               '<tr><td>Weight</td><td>5 kg</td></tr>'
               '<tr><td>Safety</td><td colspan="2">UL</td></tr></table></body></html>')
sp = H.extract(SPAN, task)
sf = [(f["label"], f["value"]) for f in sp["others"][0]["facts"]] if sp["others"] else []
check("Z4", "a rowspan'd section prefixes exactly the rows it spans, not the row after",
      sf == [("Fans", "two"), ("Physical > Height", "1U"), ("Physical > Weight", "5 kg"), ("Safety", "UL")], str(sf))

VARIANT = HEAD + ('<table><tr><td colspan="2">BTO Models</td></tr><tr><td>Description</td><td>SKU</td></tr>'
                  '<tr><td>Widget Switch</td><td>S5Z46A#B2B</td></tr><tr><td>Widget Switch</td><td>S5Z46A#B2C</td></tr></table></body></html>')
v = H.extract(VARIANT, task)
check("Z5", "a '#B2B' SKU with no base row folds into base 'S5Z46A' with variant aliases, one entry",
      [o["sku"] for o in v["others"]] == ["S5Z46A"]
      and sorted(a["value"] for a in v["others"][0]["aliases"]) == ["S5Z46A#B2B", "S5Z46A#B2C"]
      and v["others"][0]["facts"] == [{"label": "BTO Models > Description", "value": "Widget Switch", "locator": "t0:r2"}],
      str(v["others"]))

HIST = HEAD + ('<table><tr><th>Date</th><th>Version History</th><th>Action</th><th>Description of Change</th></tr>'
               '<tr><td>03-Aug-2026</td><td>Version 46</td><td>Changed</td><td>New SKUs</td></tr></table></body></html>')
h = H.extract(HIST, task)
check("Z6", "a four-column history table produces no fact and no entry", not h["facts"] and not h["others"], str(h["others"][:1]))

FAMILY = HEAD + ('<table><tr><th colspan="3">Series-wide</th></tr>'
                 '<tr><td>Stacking</td><td colspan="2">VSF</td></tr></table></body></html>')
fm = H.extract(FAMILY, task)
check("Z7", "a spec header without a SKU lands on the family result with its heading as prefix",
      fm.get("scope") == "family" and not fm["others"]
      and fm["facts"] == [{"label": "Series-wide > Stacking", "value": "VSF", "locator": "t0:r1"}], str(fm["facts"]))

# ---- the unrendered psnow shell: the silent failure this module exists to refuse --------------
# Two of the ten psnow documents in the cache are captures like this: HTTP 200, ~264 KB, correct
# og:title, not blocked, not a 404 — and no document body. Before 5 Sep 2026 they extracted to
# zero facts and the queue marked them `done`.
SHELL = ('<html><head><title>HPE Aruba Networking CX 6300 Switch Series</title>'
         '<meta property="og:title" content="HPE Aruba Networking CX 6300 Switch Series">'
         '</head><body><header>HPE Home GreenLake Products and Solutions Services Company Support</header>'
         '<main><h1>HPE Aruba Networking CX 6300 Switch Series</h1>'
         '<p>You haven\'t found what you are looking for? Chat with one of our agents.</p></main>'
         '<footer>Privacy Terms of Use Sitemap United States (en)</footer></body></html>')
check("U1", "the shell has no render marker", H.is_rendered(SHELL) is False)
check("U2", "the real cached document does have one", H.is_rendered(html) is True)
try:
    H.extract(SHELL, {"task": "datasheet", "key": DOC_URL})
    check("U3", "SABOTAGE an unrendered psnow capture is REFUSED, not returned as zero facts", False,
          "extract() returned instead of raising")
except H.UnrenderedDocument as exc:
    msg = str(exc)
    check("U3", "SABOTAGE an unrendered psnow capture is REFUSED, not returned as zero facts", True)
    check("U4", "...and the refusal names the document, so the re-fetch is one command",
          DOC_URL in msg and "--force" in msg, msg[:120])
    # worker.classify_exception sends anything whose message says "timeout" down the timeout
    # branch, which reports a slow host instead of a missing document. The wording is load-bearing.
    check("U5", "...and the message never says 'timeout', which would misclassify it as a slow host",
          "timeout" not in msg.lower() and "timed out" not in msg.lower(), msg[:120])
except Exception as exc:  # noqa
    check("U3", "SABOTAGE an unrendered psnow capture is REFUSED, not returned as zero facts", False,
          f"{type(exc).__name__}: {exc}")
check("U6", "SABOTAGE an empty body is unrendered too, never a document with no tables",
      H.is_rendered("") is False)
# The two markers are independent on purpose: a QuickSpecs with no specification table at all
# still has the container, and a rule keyed on tables alone would refuse it for ever.
check("U7", "the container alone is enough to call a page rendered",
      H.is_rendered('<div class="collateral-content"><p>prose only</p></div>') is True)

# ---- block detection: challenge_fingerprint, not looks_blocked --------------------------------
# looks_blocked() believes a wordy marker on ANY page under 40 KB. The real 56 KB "404 Error"
# fixture is inside that window and so is every short HPE error page.
check("B3", "the named fingerprint is reported, not just a boolean",
      H.blocked_reason(JAM) is not None and isinstance(H.blocked_reason(JAM), str), H.blocked_reason(JAM))
check("B4", "SABOTAGE a 400 KB QuickSpecs is not blocked whatever words it contains",
      H.blocked_reason(html) is None, H.blocked_reason(html))
check("B5", "SABOTAGE the real 404 fixture is NOT read as a block — it is an answer",
      H.blocked_reason(nf_html) is None, H.blocked_reason(nf_html))
check("B6", "an empty body is a block (HPE's refusal carries no HTML at all)",
      H.blocked_reason("") == "empty_body", H.blocked_reason(""))

# ---- the lane's declared waits ---------------------------------------------------------------
# worker.Browser reads these off the module. A wait that proves something other than what
# is_rendered() checks is how a lane ends up waiting for the wrong thing.
check("W1", "the module declares WAIT_FOR and SETTLE_MS for the worker to use",
      isinstance(getattr(H, "WAIT_FOR", None), str) and isinstance(getattr(H, "SETTLE_MS", None), int),
      f"{getattr(H, 'WAIT_FOR', None)!r} {getattr(H, 'SETTLE_MS', None)!r}")
check("W2", "WAIT_FOR names the SAME marker is_rendered() checks, so they cannot drift",
      any(m in H.WAIT_FOR for m in H.RENDER_MARKERS), f"{H.WAIT_FOR} vs {H.RENDER_MARKERS}")

print(f"\n{npass} passed, {nfail} failed")
sys.exit(1 if nfail else 0)
