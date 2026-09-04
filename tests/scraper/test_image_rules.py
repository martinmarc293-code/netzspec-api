"""tests/scraper/test_image_rules.py — proof for the image lane's refusals (scraper/images.py).

    python3.11 tests/scraper/test_image_rules.py
    python3.11 scripts/run_py_tests.py image_rules

Two halves are proved here.

URLs: the same corpus tests/imageCandidate.test.ts holds the TypeScript half to
(tests/fixtures/image-urls.json), so neither language can quietly stop agreeing with the shared
rules file. The TypeScript suite additionally runs THIS module and compares, URL by URL.

Bytes: what the lane does with what it downloaded. Most of these cases are sabotage, because the
happy path is the half that never goes wrong — a 403 page saved as C9200L-48P.jpg, an SVG icon,
a 64 px swatch and a PDF datasheet all arrive at this function claiming to be product photos, and
every one of them is a picture that would render on a part page as if it were real. The two
rules that are deliberately NOT refusals are asserted too: an image below 800 px and an image on
a coloured background are STORED, carrying their merchant issue, because a recorded gap is
fixable and a hidden one is not.

Nothing here fetches, and nothing here touches a database.
"""
from __future__ import annotations
import io, json, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))
import images as IM  # noqa: E402

PASS = 0
SABOTAGE = 0
MISSES: list[str] = []


def check(name: str, cond: bool, detail: object = None) -> None:
    global PASS
    if cond:
        PASS += 1
        print(f"PASS  {name}")
    else:
        MISSES.append(name)
        print(f"MISS  {name}" + ("" if detail is None else f" -> {detail!r}"))


# ---------------------------------------------------------------------------------------------
# the rules file
# ---------------------------------------------------------------------------------------------
R = IM.rules()
check("the rules file loads with every key the lane reads",
      all(k in R for k in ("placeholder_url_substrings", "url_key_strip_segments", "max_parts_per_url_key",
                           "max_parts_per_sha256", "min_long_side_px", "merchant_min_long_side_px",
                           "max_attempts", "lease_minutes")), sorted(R))
check("the refusal floor is well below the merchant recommendation",
      R["min_long_side_px"] < R["merchant_min_long_side_px"], (R["min_long_side_px"], R["merchant_min_long_side_px"]))

SABOTAGE += 1
_saved_file, _saved_cache = IM.RULES_FILE, IM._RULES
IM.RULES_FILE, IM._RULES = ROOT / "data" / "schema" / "does-not-exist.json", None
try:
    IM.rules()
    check("SABOTAGE a missing rules file is refused rather than defaulted", False, "no exception")
except SystemExit as e:
    check("SABOTAGE a missing rules file is refused, naming the path", "does-not-exist.json" in str(e), str(e))
finally:
    IM.RULES_FILE, IM._RULES = _saved_file, _saved_cache

SABOTAGE += 1
import tempfile  # noqa: E402
_tmp = Path(tempfile.mkdtemp(prefix="nz-imgrules-")) / "image-rules.json"
_full = json.load(open(_saved_file, encoding="utf-8"))
del _full["min_long_side_px"]
_tmp.write_text(json.dumps(_full), encoding="utf-8")
IM.RULES_FILE, IM._RULES = _tmp, None
try:
    IM.rules()
    check("SABOTAGE a rules file missing a key is refused", False, "no exception")
except SystemExit as e:
    check("SABOTAGE a rules file missing a key is refused, NAMING the key", "min_long_side_px" in str(e), str(e))
finally:
    IM.RULES_FILE, IM._RULES = _saved_file, _saved_cache
check("the real rules file is back in place after the sabotage cases", IM.rules()["min_long_side_px"] > 0)

# ---------------------------------------------------------------------------------------------
# URLs: the shared corpus
# ---------------------------------------------------------------------------------------------
corpus = json.load(open(ROOT / "tests" / "fixtures" / "image-urls.json", encoding="utf-8"))["cases"]
check("the shared corpus is loaded and non-trivial", len(corpus) >= 15, len(corpus))
for c in corpus:
    got = IM.url_key(c["url"])
    check(f"key: {c['note'][:60]}", got == c["key"], {"url": c["url"], "got": got, "want": c["key"]})
for c in corpus:
    got = IM.placeholder_reason(c["url"])
    check(f"refusal: {c['note'][:56]}", got == c["placeholder"], {"url": c["url"], "got": got, "want": c["placeholder"]})

check("a CDN's ?width/&height are read as hints",
      IM.size_hint("https://x.test/a.png?width=316&height=135") == (316, 135))
check("a URL with no size query has no hint", IM.size_hint("https://x.test/a.png") == (None, None))

# ---------------------------------------------------------------------------------------------
# bytes: sniff() and content_reason()
# ---------------------------------------------------------------------------------------------
from PIL import Image  # noqa: E402


def png(w: int, h: int, colour=(255, 255, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), colour).save(buf, "PNG")
    return buf.getvalue()


OUT = Path(tempfile.mkdtemp(prefix="nz-imgout-"))

SABOTAGE += 1
html403 = b"<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body>Access denied</body></html>"
check("SABOTAGE a 403 page is not an image, whatever the URL called it", IM.sniff(html403) is None)
check("SABOTAGE and make_variants refuses it with a NAMED reason, not a crash",
      (IM.content_reason(IM.make_variants(html403, OUT, "cisco", "sha403")) or "").startswith("unsupported-format:unknown"),
      IM.content_reason(IM.make_variants(html403, OUT, "cisco", "sha403")))

SABOTAGE += 1
svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>'
check("SABOTAGE an SVG icon is refused as unsupported-format:svg",
      IM.content_reason(IM.make_variants(svg, OUT, "cisco", "shasvg")) == "unsupported-format:svg",
      IM.content_reason(IM.make_variants(svg, OUT, "cisco", "shasvg")))

SABOTAGE += 1
pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n"
check("SABOTAGE a datasheet PDF served as the product image is refused as unsupported-format:pdf",
      IM.content_reason(IM.make_variants(pdf, OUT, "cisco", "shapdf")) == "unsupported-format:pdf",
      IM.content_reason(IM.make_variants(pdf, OUT, "cisco", "shapdf")))

SABOTAGE += 1
tiny = IM.make_variants(png(64, 64), OUT, "cisco", "shatiny")
check("SABOTAGE a 64 px swatch is refused as tiny-image, with its measured size in the reason",
      IM.content_reason(tiny) == "tiny-image:64x64", IM.content_reason(tiny))

SABOTAGE += 1
edge = IM.make_variants(png(R["min_long_side_px"] - 1, 120), OUT, "cisco", "shaedge")
check("SABOTAGE one pixel under the floor is still refused (the boundary, not a round number)",
      (IM.content_reason(edge) or "").startswith("tiny-image:"), IM.content_reason(edge))

ok_small = IM.make_variants(png(R["min_long_side_px"], 200), OUT, "cisco", "shasmall")
check("a picture ON the floor is ACCEPTED and carries below-800px as an issue, not a refusal",
      IM.content_reason(ok_small) is None and "below-800px" in ok_small["issues"] and ok_small["merchant_ready"] is False,
      {"reason": IM.content_reason(ok_small), "issues": ok_small["issues"]})

big = IM.make_variants(png(1400, 700), OUT, "cisco", "shabig")
check("a real 1400x700 photo on white is accepted and merchant-ready",
      IM.content_reason(big) is None and big["merchant_ready"] is True and big["issues"] == [], big.get("issues"))
check("it produces the three WebP squares Google Merchant wants, plus the untouched original",
      sorted(v["variant"] for v in big["variants"]) == ["original", "webp-1200", "webp-400", "webp-800"],
      [v["variant"] for v in big["variants"]])
check("the squares are square, WebP, and never upscaled past the original's longest side",
      all(v["width"] == v["height"] and v["format"] == "webp" for v in big["variants"] if v["variant"] != "original")
      and max(v["width"] for v in big["variants"] if v["variant"] != "original") <= 1400,
      [(v["variant"], v["width"], v["height"]) for v in big["variants"]])

coloured = IM.make_variants(png(1000, 1000, (12, 40, 90)), OUT, "cisco", "shacolour")
check("a coloured background is an ISSUE, never a refusal: a recorded gap is fixable, a hidden one is not",
      IM.content_reason(coloured) is None and "not-white-background" in coloured["issues"], coloured["issues"])

# ---------------------------------------------------------------------------------------------
# the SQL the lane leases with must actually say what the rules say
# ---------------------------------------------------------------------------------------------
# Not a substitute for the database suite; it catches the one edit that silently removes the
# whole point of the lane — leasing candidates for parts that already have a picture.
sql = IM.LEASE_SQL
# ---------------------------------------------------------------------------------------------
# the two refusals the first real dry run bought (4 Sep 2026)
# ---------------------------------------------------------------------------------------------
check("sku_tokens reads the part-number-shaped pieces of a filename",
      {"MR45"} <= IM.sku_tokens("https://documentation.meraki.com/@api/deki/files/12500/MR45.png?revision=2"),
      IM.sku_tokens("https://documentation.meraki.com/@api/deki/files/12500/MR45.png?revision=2"))
check("sku_tokens rejoins adjacent pieces, because a PID is as often MS120-24P as MR45",
      "MS120-24P" in IM.sku_tokens("https://x.test/i/MS120-24P-front.jpg"),
      sorted(IM.sku_tokens("https://x.test/i/MS120-24P-front.jpg")))
check("sku_tokens ignores two-character noise", all(len(t) >= 3 for t in IM.sku_tokens("https://x.test/i/a-b-MR45.png")))

_known = {"cisco": {"MR45", "MR46", "MS120-24P"}}
SABOTAGE += 1
check("SABOTAGE meraki's MR45.png as the MR46 page's primary image is refused, NAMING the other part",
      IM.other_sku_reason({"image_url": "https://documentation.meraki.com/@api/deki/files/12500/MR45.png?revision=2",
                           "sku": "MR46", "vendor_slug": "cisco"}, _known) == "names-another-sku:MR45",
      IM.other_sku_reason({"image_url": "https://documentation.meraki.com/@api/deki/files/12500/MR45.png?revision=2",
                           "sku": "MR46", "vendor_slug": "cisco"}, _known))
check("a filename that names THIS part is not refused",
      IM.other_sku_reason({"image_url": "https://x.test/i/MR45.png", "sku": "MR45", "vendor_slug": "cisco"}, _known) is None)
check("a photo of two products, one of them ours, is not refused",
      IM.other_sku_reason({"image_url": "https://x.test/i/MR45-and-MR55.png", "sku": "MR45", "vendor_slug": "cisco"}, _known) is None)
check("a filename that names nothing in the catalogue is not refused: only a POSITIVE identification refuses",
      IM.other_sku_reason({"image_url": "https://x.test/i/ap-front-photo.png", "sku": "MR46", "vendor_slug": "cisco"}, _known) is None)
check("the SKU comparison ignores the punctuation a PID carries (C9200L-24P-4G= is the same part)",
      IM.other_sku_reason({"image_url": "https://x.test/i/MS120-24P.jpg", "sku": "MS120-24P=", "vendor_slug": "cisco"}, _known) is None)

check("the lease refuses parts that already have a downloaded image",
      "NOT EXISTS" in sql and "images i" in sql and "i.storage_path IS NOT NULL" in sql)
check("the lease prefers vendor sources over distributors (source tier, ascending)",
      "ORDER BY s.tier" in sql or "ORDER BY o.tier" in sql)
check("the lease takes ONE candidate per part, not one row per URL", "PARTITION BY c.part_id" in sql and "rn = 1" in sql)
check("the lease promotes only what the PAGE called primary — the antenna-diagram rule of 4 Sep 2026",
      "c.role = 'primary'" in sql)
check("across different files a real width hint beats no hint (COALESCE to 0, not to MAXINT)",
      "COALESCE(c.width_hint, 0) DESC" in sql and "2147483647" not in sql)
check("the lease reclaims a stale lease rather than stranding it", "leased_at" in sql and "make_interval" in sql)
check("a failed candidate is retried while it has attempts left, a rejected one never is",
      "'failed'" in sql and "attempts <" in sql and "'rejected'" not in sql)

import shutil  # noqa: E402
shutil.rmtree(OUT, ignore_errors=True)
shutil.rmtree(_tmp.parent, ignore_errors=True)

print(f"\n{PASS} passed, {len(MISSES)} missed ({SABOTAGE} sabotage cases)")
if MISSES:
    for m in MISSES:
        print(f"  MISS {m}")
    sys.exit(1)
