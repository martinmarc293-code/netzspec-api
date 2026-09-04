"""scraper/images.py — product photos, self-hosted, in the shapes Google Merchant wants.

    python3.11 scraper/images.py run --from-db --limit 40 [--cdp http://127.0.0.1:9222] [--dry-run] [--no-upload]
    python3.11 scraper/images.py run --from-picks data/reference/part-images.json --tiers exact,form,series [--limit N] [--cdp http://127.0.0.1:9222] [--db]
    python3.11 scraper/images.py process <image-file> [--out-dir runs/images]      one file, prints what it would record
    python3.11 scraper/images.py keys <url>...                                     the url_key / placeholder decision, as JSON

Two modes, and the difference matters. `--from-picks` is the ONE-OFF: an operator-curated file of
URLs, run once on 3 Sep 2026, which linked 2,736 Cisco parts and left 61,229 hardware parts with
no picture at all. `--from-db` is the CONTINUOUS lane: it leases what the nightly workers already
saw (image_candidates, db/migrations/0007), fetches, validates, promotes or refuses with a named
reason, ships the files to the box and closes a `runs` row. Nightshift runs it every cycle.

What it guarantees:
  * Every downloaded body is validated by its magic bytes before anything is kept. A 403 page
    saved as "C9300-48P.webp" is a broken picture that every automated check scores as present.
  * Three outcomes, never two: ok / missing (a real 404) / unverified (blocked, timed out, still
    failing after one retry). Unverified is not failure; a later run retries it.
  * The original is kept untouched. Variants are WebP squares at 1200, 800 and 400 px, PADDED on
    white, never stretched, never upscaled past the original's longest side.
  * Merchant readiness is measured and recorded, not assumed: below-800px, not-white-background
    (corners and edge midpoints sampled), unsupported-format. What we cannot measure (a watermark)
    is not claimed.
  * Files are named by content hash, so the same vendor photo shared by forty SKUs is stored
    once; every SKU row points at it. Descriptive names belong in alt text and the consumer's URL.

Nothing here uploads. The API box syncs IMAGE_DIR (scripts/deploy.sh does the rsync).
"""
from __future__ import annotations
import argparse, hashlib, io, json, os, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
ROOT = Path(__file__).resolve().parent.parent

SIZES = (1200, 800, 400)
MAGIC = {
    b"\x89PNG\r\n\x1a\n": "png",
    b"\xff\xd8\xff": "jpg",
    b"GIF87a": "gif", b"GIF89a": "gif",
    b"RIFF": "webp",           # RIFF....WEBP, checked below
    b"%PDF-": "pdf",
    b"<svg": "svg", b"<?xml": "svg",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sniff(body: bytes) -> str | None:
    for magic, fmt in MAGIC.items():
        if body.startswith(magic):
            if fmt == "webp" and body[8:12] != b"WEBP":
                return None
            return fmt
    if body[:64].lstrip().lower().startswith(b"<svg") or (body[:5] == b"<?xml" and b"<svg" in body[:400]):
        return "svg"
    if body[4:12] in (b"ftypavif", b"ftypavis", b"ftypheic", b"ftypmif1"):
        return "avif"   # recognised so the manifest names it, unsupported for variants
    return None


def load_env() -> dict:
    env: dict[str, str] = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            t = line.strip()
            if t and not t.startswith("#") and "=" in t:
                k, v = t.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k in ("DATABASE_URL", "IMAGE_DIR")})
    return env


# ---------------------------------------------------------------------------------------------
# the refusal rules — ONE file, shared with src/core/imageCandidate.ts
# ---------------------------------------------------------------------------------------------
# Two languages enforce these. Two copies would drift the day one of them changed and nothing
# would notice (D:\Project\CLAUDE.md section 10). tests/scraper/test_image_rules.py runs this
# module's url_key/placeholder_reason and the TypeScript pair over the SAME awkward corpus and
# fails if they ever disagree.

RULES_FILE = ROOT / "data" / "schema" / "image-rules.json"
_RULES: dict | None = None


def rules() -> dict:
    """The rules file, read once. Never falls back to a default: a lane running on silent
    defaults would refuse nothing and nobody would see it."""
    global _RULES
    if _RULES is None:
        if not RULES_FILE.exists():
            raise SystemExit(f"images: {RULES_FILE} does not exist")
        r = json.load(open(RULES_FILE, encoding="utf-8"))
        for k in ("placeholder_url_substrings", "url_key_strip_segments", "max_parts_per_url_key",
                  "max_parts_per_sha256", "min_long_side_px", "merchant_min_long_side_px", "max_attempts", "lease_minutes"):
            if k not in r:
                raise SystemExit(f"images: {RULES_FILE} has no \"{k}\"")
        _RULES = r
    return _RULES


def url_key(url: str) -> str | None:
    """The identity of a picture: lower-cased host + path, query dropped, rendition segments
    removed, adjacent duplicates collapsed. None when it is not an http(s) URL. Mirrors
    imageUrlKey() in src/core/imageCandidate.ts exactly — see tests/scraper/test_image_rules.py."""
    from urllib.parse import unquote
    try:
        u = urlparse(url)
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.hostname:
        return None
    strip = {s.lower() for s in rules()["url_key_strip_segments"]}
    segs = [unquote(s).lower() for s in u.path.split("/") if s]
    if not segs:
        return None
    last = segs[-1]                                     # the filename is never a rendition segment
    kept = [s for s in segs[:-1] if s not in strip]
    collapsed: list[str] = []
    for s in kept:
        if not collapsed or collapsed[-1] != s:
            collapsed.append(s)
    return u.hostname.lower() + "/" + "/".join(collapsed + [last])


def size_hint(url: str) -> tuple[int | None, int | None]:
    """The URL's own opinion of its size (?width=316&height=135), used ONLY to prefer the larger
    of two renditions. Never recorded as the image's dimensions — those are measured."""
    from urllib.parse import parse_qs
    try:
        q = parse_qs(urlparse(url).query)
    except ValueError:
        return (None, None)

    def num(keys: tuple[str, ...]) -> int | None:
        for k in keys:
            v = (q.get(k) or [""])[0]
            if v.isdigit() and 2 <= len(v) <= 5:
                return int(v)
        return None
    return (num(("width", "w", "maxwidth", "sw")), num(("height", "h", "maxheight", "sh")))


def placeholder_reason(url: str) -> str | None:
    """A URL this lane refuses to spend a request on, with the reason, or None."""
    k = url_key(url)
    if k is None:
        return "not-an-http-url"
    for s in rules()["placeholder_url_substrings"]:
        if s.lower() in k:
            return f"placeholder-url:{s}"
    return None


def content_reason(rec: dict) -> str | None:
    """Why the DOWNLOADED bytes are refused, or None. Everything measurable from the file alone
    lives here so tests/scraper/test_image_rules.py can drive it without a browser or a database;
    the counting rule (generic-content) needs the corpus and is decided in the lane.

    Note what is NOT a refusal: 'below-800px' and 'not-white-background' are merchant ISSUES.
    An image that is 600 px stays on record carrying its reason so the gap is visible and fixable
    (src/store/images.ts). Only 'too small to be a photograph at all' refuses."""
    if not rec.get("ok"):
        return rec.get("issue") or "unprocessable"
    if max(rec["width"], rec["height"]) < rules()["min_long_side_px"]:
        return f"tiny-image:{rec['width']}x{rec['height']}"
    return None


# ---------------------------------------------------------------------------------------------
# processing
# ---------------------------------------------------------------------------------------------

def measure_background(img) -> str:
    """'white' | 'transparent' | 'other', from the corners and edge midpoints of the original."""
    w, h = img.size
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    rgba = img.convert("RGBA")
    px = [rgba.getpixel(p) for p in pts]
    if all(p[3] == 0 for p in px):
        return "transparent"
    if all(p[3] > 0 and min(p[:3]) >= 240 for p in px):
        return "white"
    return "other"


def make_variants(body: bytes, out_dir: Path, vendor: str, sha: str) -> dict:
    """Original + WebP squares. Returns the record for the manifest / database."""
    from PIL import Image
    fmt = sniff(body)
    if fmt is None or fmt in ("pdf", "svg"):
        return {"ok": False, "issue": f"unsupported-format:{fmt or 'unknown'}", "head": body[:16].hex()}
    # avif decodes with Pillow >= 11.2 (checked: features.check('avif') is True on this machine)
    orig_dir = out_dir / "originals"
    orig_dir.mkdir(parents=True, exist_ok=True)
    orig = orig_dir / f"{sha}.{fmt}"
    if not orig.exists():
        orig.write_bytes(body)
    img = Image.open(io.BytesIO(body))
    img.load()
    w, h = img.size
    background = measure_background(img)
    issues = []
    if max(w, h) < 800:
        issues.append("below-800px")
    if background == "other":
        issues.append("not-white-background")
    variants = [{"variant": "original", "storage_path": str(orig.relative_to(out_dir)).replace("\\", "/"),
                 "width": w, "height": h, "bytes": len(body), "format": fmt, "sha256": sha, "background": background}]
    rgba = img.convert("RGBA")
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    canvas.alpha_composite(rgba, ((side - w) // 2, (side - h) // 2))
    vdir = out_dir / vendor
    vdir.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        if size > side and size != 400:
            continue  # never upscale past the original, but always give the small thumbnail
        target = canvas if size >= side else canvas.resize((size, size), Image.LANCZOS)
        if size > side:
            target = canvas.resize((size, size), Image.LANCZOS)  # only the 400 case, and only when the original is smaller
        vp = vdir / f"{sha[:20]}-{size}.webp"
        if not vp.exists():
            target.convert("RGB").save(vp, "WEBP", quality=85, method=6)
        vb = vp.read_bytes()
        variants.append({"variant": f"webp-{size}", "storage_path": str(vp.relative_to(out_dir)).replace("\\", "/"),
                         "width": target.size[0], "height": target.size[1], "bytes": len(vb), "format": "webp",
                         "sha256": hashlib.sha256(vb).hexdigest(), "background": "white" if background != "transparent" else "white"})
    return {"ok": True, "width": w, "height": h, "format": fmt, "background": background,
            "merchant_ready": not issues, "issues": issues, "variants": variants}


# ---------------------------------------------------------------------------------------------
# the run
# ---------------------------------------------------------------------------------------------

TIER_TO_ROLE = {"exact": ("primary", "caption-sku", 0.95), "form": ("primary", "caption-formfactor", 0.6),
                "series": ("series", "series", 0.5), "doc": ("series", "product-figure", 0.3)}


def run(args: argparse.Namespace) -> int:
    from worker import Browser
    env = load_env()
    out_dir = Path(env.get("IMAGE_DIR") or (ROOT / "runs" / "images"))
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = out_dir / "manifest.jsonl"
    seen_urls: dict[str, dict] = {}
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
                if r.get("outcome") == "ok":
                    seen_urls[r["src"]] = r
            except Exception:  # noqa
                pass

    picks = json.load(open(args.from_picks, encoding="utf-8"))["picks"]
    tiers = set(args.tiers.split(","))
    picks = [p for p in picks if p.get("tier") in tiers]
    if args.limit:
        picks = picks[: args.limit]
    print(f"{len(picks)} picks in tiers {sorted(tiers)}; {len(seen_urls)} URLs already done")

    db = None
    if args.db:
        import psycopg
        db = psycopg.connect(env["DATABASE_URL"], autocommit=True)
        src_id = db.execute("SELECT id FROM sources WHERE slug = 'cisco-datasheets'").fetchone()[0]

    browser = Browser(mode="cdp" if args.cdp else "profile", cdp_url=args.cdp or "http://127.0.0.1:9222", headless=not args.cdp)
    counts = {"ok": 0, "missing": 0, "unverified": 0, "reused": 0, "db_rows": 0, "no_part": 0}
    by_url: dict[str, dict] = dict(seen_urls)
    try:
        for i, p in enumerate(picks, 1):
            src, sku = p["src"], p["sku"]
            vendor = p.get("vendor") or "cisco"
            rec = by_url.get(src)
            if rec is None:
                outcome, body, status = "unverified", b"", None
                for attempt in (1, 2):
                    try:
                        r = browser.fetch_binary(src, politeness_ms=350, referer=p.get("source_url"))
                        status, body = r["status"], r["body"]
                    except Exception as e:  # noqa
                        status, body = None, b""
                        err = str(e)[:120]
                    if status == 404:
                        outcome = "missing"; break
                    if status == 200 and sniff(body):
                        outcome = "ok"; break
                    time.sleep(2)
                rec = {"src": src, "outcome": outcome, "status": status, "at": now()}
                if outcome == "ok":
                    sha = hashlib.sha256(body).hexdigest()
                    rec.update(sha256=sha, **make_variants(body, out_dir, vendor, sha))
                    if not rec.get("ok"):
                        rec["outcome"] = "unverified"; outcome = "unverified"
                counts[outcome] += 1
                by_url[src] = rec
                with manifest.open("a", encoding="utf-8") as f:
                    f.write(json.dumps({**rec, "sku": sku, "tier": p.get("tier"), "source_url": p.get("source_url"), "caption": p.get("caption")}, ensure_ascii=False) + "\n")
            else:
                counts["reused"] += 1
            if db is not None and rec.get("outcome") == "ok":
                row = db.execute("SELECT p.id FROM parts p JOIN vendors v ON v.id = p.vendor_id WHERE v.slug = %s AND p.sku = %s", (vendor, sku)).fetchone()
                if not row:
                    counts["no_part"] += 1
                else:
                    role, method, conf = TIER_TO_ROLE.get(p.get("tier"), ("gallery", "product-figure", 0.3))
                    orig = next(v for v in rec["variants"] if v["variant"] == "original")
                    img_id = db.execute(
                        """INSERT INTO images (part_id, role, source_url, storage_path, width, height, format, bytes, sha256,
                                               assignment_method, confidence, merchant_ready, merchant_issues, license_note, source_id)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)
                           ON CONFLICT (part_id, role, source_url) DO UPDATE SET storage_path = EXCLUDED.storage_path, width = EXCLUDED.width,
                             height = EXCLUDED.height, format = EXCLUDED.format, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256,
                             merchant_ready = EXCLUDED.merchant_ready, merchant_issues = EXCLUDED.merchant_issues
                           RETURNING id""",
                        (row[0], role, src, orig["storage_path"], rec["width"], rec["height"], rec["format"], orig["bytes"], rec["sha256"],
                         method, conf, rec["merchant_ready"], json.dumps(rec["issues"]), "vendor product photo (Cisco CDN)", src_id)).fetchone()[0]
                    for v in rec["variants"]:
                        db.execute(
                            """INSERT INTO image_variants (image_id, variant, storage_path, width, height, bytes, format, sha256, background)
                               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                               ON CONFLICT (image_id, variant) DO UPDATE SET storage_path = EXCLUDED.storage_path, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256""",
                            (img_id, v["variant"], v["storage_path"], v["width"], v["height"], v["bytes"], v["format"], v["sha256"], v.get("background")))
                    counts["db_rows"] += 1
            if i % 50 == 0:
                print(f"  {i}/{len(picks)} {counts}")
    finally:
        browser.close()
        if db is not None:
            db.close()
    print(f"done: {counts}")
    return 0


# ---------------------------------------------------------------------------------------------
# the continuous lane: candidates from the database
# ---------------------------------------------------------------------------------------------
# `run --from-picks` was a one-off: an operator-curated file of URLs, run once on 3 Sep 2026, and
# it left 61,229 hardware parts with no picture. `run --from-db` is the same machinery driven by
# what the workers already see every night (db/migrations/0007_image_candidates.sql).
#
# Order of business, and why:
#   lease      one candidate per part, ONLY for parts with no downloaded image, vendor sources
#              (tier 1-2) before distributors, larger renditions before smaller. A part that
#              already has a picture is never fetched for again — the cheapest refusal there is.
#   refuse     before spending a request: the substring rules, and the count rule a substring
#              cannot express (one URL claimed by more than max_parts_per_url_key parts is a
#              category banner, not this part's photo).
#   fetch      through the scraper's own Chrome, at the SOURCE's politeness_ms, with the page it
#              came from as the Referer — same manners as the workers.
#   refuse     again, on the bytes: not an image, a format we cannot render, too small to be a
#              photograph, or content already assigned to more parts than a series photo ever is.
#   promote    variants, files, images + image_variants rows, candidate -> done.
# Everything happens inside one `runs` row, and every refusal is stored with its named reason.

SSH_HOST = os.environ.get("NETZSPEC_SSH_HOST", "root@77.42.72.81")
SSH_KEY = os.environ.get("NETZSPEC_SSH_KEY", str(Path.home() / ".ssh" / "dubaifix_hetzner"))
BOX_IMAGE_DIR = os.environ.get("NETZSPEC_BOX_IMAGE_DIR", "/var/lib/netzspec-api/images")


def alnum(s: str) -> str:
    return "".join(ch for ch in s.upper() if ch.isalnum())


def sku_tokens(url: str) -> set[str]:
    """Part-number-shaped strings the FILENAME contains, upper-cased.

    Why this exists: meraki serves MR45.png as the primary image of the MR46 page. The file is a
    real product photo of a real product - just not this one - and nothing about its size, format
    or background says so. The filename does. Tokens are the whole stem, each piece of it, and
    each adjacent pair rejoined with a dash, because a Cisco PID is as often 'MS120-24P' as 'MR45'.
    """
    key = url_key(url)
    if key is None:
        return set()
    stem = key.rsplit("/", 1)[-1]
    if "." in stem:
        stem = stem.rsplit(".", 1)[0]
    parts = [p for p in "".join(ch if (ch.isalnum() or ch == "-") else " " for ch in stem).split() if p]
    pieces: list[str] = []
    for p in parts:
        pieces.append(p)
        pieces.extend(x for x in p.split("-") if x)
    out = {stem.upper()} | {p.upper() for p in pieces}
    for a, b in zip(pieces, pieces[1:]):
        out.add(f"{a}-{b}".upper())
    return {t for t in out if len(t) >= 3}


def git_sha() -> str | None:
    import subprocess
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=20)
        return r.stdout.strip() or None
    except Exception:  # noqa
        return None


# PRIMARY ONLY, and why. The first dry run over the real corpus (4 Sep 2026) leased, for five of
# ten parts, an ANTENNA RADIATION DIAGRAM: meraki's documentation pages carry 5ghz_wireless.png,
# 24ghz_scanning.png and Coverage-Patterns-6Ghz.png next to the product shot, and `all_images`
# records them all. Every one is a real PNG, well over 300 px, on a white background, and would
# have rendered on a part page as if it were the product. No substring list would have caught
# them. What DOES separate them is what the page itself said: the product shot is `primary`, the
# diagrams are `gallery`. So a part's FIRST picture may only come from a primary candidate. A
# gallery image stays on record and is never promoted; a source that marks nothing primary gives
# its parts no picture, which is a visible gap rather than a confident wrong answer.
#
# The ordering was wrong in the same run and for a related reason: "no width hint means the
# original" is true when comparing two renditions of ONE file and false across different files.
# MR36H's real photo (?width=273) lost to a diagram with no query at all. Across files a real
# hint beats no hint.
LEASE_SQL = """
WITH open AS (
  SELECT c.id, c.part_id, c.source_id, c.page_url, c.image_url, c.url_key, c.role, c.alt, c.width_hint,
         s.tier, s.slug AS source_slug, s.politeness_ms,
         row_number() OVER (PARTITION BY c.part_id
                            ORDER BY s.tier, COALESCE(c.width_hint, 0) DESC, c.id) AS rn
    FROM image_candidates c
    JOIN sources s ON s.id = c.source_id
   WHERE (c.status = 'pending' OR (c.status = 'failed' AND c.attempts < %(max_attempts)s))
     AND c.role = 'primary'
     AND (c.leased_at IS NULL OR c.leased_at < now() - make_interval(mins => %(lease_minutes)s))
     AND NOT EXISTS (SELECT 1 FROM images i WHERE i.part_id = c.part_id AND i.storage_path IS NOT NULL)
)
SELECT o.*, p.sku, v.slug AS vendor_slug
  FROM open o
  JOIN parts p ON p.id = o.part_id
  JOIN vendors v ON v.id = p.vendor_id
 WHERE o.rn = 1
 ORDER BY o.tier, COALESCE(o.width_hint, 0) DESC, o.id
 LIMIT %(limit)s
"""


def known_sku_map(db, batch: list[dict]) -> dict[str, set[str]]:
    """Per vendor, which of the batch's filename tokens are REAL part numbers in the catalogue.
    One query for the whole batch, not one per candidate."""
    by_vendor: dict[str, set[str]] = {}
    for c in batch:
        by_vendor.setdefault(c["vendor_slug"], set()).update(sku_tokens(c["image_url"]))
    out: dict[str, set[str]] = {}
    for vendor, toks in by_vendor.items():
        if not toks:
            out[vendor] = set(); continue
        rows = db.execute(
            "SELECT upper(p.sku) AS sku FROM parts p JOIN vendors v ON v.id = p.vendor_id WHERE v.slug = %s AND upper(p.sku) = ANY(%s)",
            (vendor, sorted(toks))).fetchall()
        out[vendor] = {r["sku"] for r in rows}
    return out


def _family_rules() -> tuple[str, tuple[str, ...]]:
    """The two SKU-shape values, from the shared rules file. Raises naming the key rather than
    defaulting: a lane that quietly assumed '-' would keep working here and stop agreeing with
    src/core/imageCandidate.ts, which is the drift this file exists to prevent."""
    r = rules()
    for k in ("sku_family_separator", "sku_equivalent_suffixes"):
        if k not in r:
            raise SystemExit(f"images: {RULES_FILE} has no \"{k}\"")
    return r["sku_family_separator"], tuple(r["sku_equivalent_suffixes"])


def sku_norm(s: str) -> str:
    """Upper-cased, with the suffixes that name the SAME product removed: Cisco's spare '=' and
    Meraki's hardware-only '-HW'. Keeps the dashes, because the dash is the whole rule below."""
    sep, suffixes = _family_rules()
    out = s.strip().upper()
    changed = True
    while changed:
        changed = False
        for suf in suffixes:
            if len(out) > len(suf) and out.endswith(suf.upper()):
                out = out[: -len(suf)]
                changed = True
    return out


def sku_relation(mine: str, named: str) -> str:
    """How the part number a FILENAME carries relates to the part whose page it was on.

    "same"     the same product, punctuation and equivalent suffixes aside (MS120-24P= / MS120-24P).
    "family"   the named token is this part's own family: our SKU extends it across a dash.
               MS210 -> MS210-24P, MS355 -> MS355-24X, C9200L -> C9200L-24P-4G. The family photo
               IS the product shot for every model in the family, so it is accepted.
    "other"    everything else, and it is refused. Three shapes reach here and all three are a
               different product:
                 MR45 vs MR46, MR44 vs MR46   siblings; neither is a prefix of the other.
                 MG41E vs MG41                the named token is LONGER: a descendant, never a
                                              family - MG41E is the external-antenna gateway.
                 MX64 vs MX64W, MX67 vs MX67C, MS250-48 vs MS250-48LP
                                              a letter glued on with no dash. Meraki reserves the
                                              dash for the port/PoE configuration of one chassis
                                              and an appended letter for a different chassis (W
                                              adds radios, C an LTE modem). MS250-48 -> -48LP is
                                              the one case where the two units look alike, and it
                                              is refused anyway: a wrong picture on a part page is
                                              worse than none, and the refusal is on record.
                 C9200 vs C9200L-24P-4G       a shared run of letters with no dash boundary is
                                              another family entirely. This is why the separator
                                              is required and startswith() alone is not enough.
    """
    sep, _ = _family_rules()
    a, b = sku_norm(mine), sku_norm(named)
    if alnum(a) == alnum(b):
        return "same"
    if b and a.startswith(b + sep):
        return "family"
    return "other"


def other_sku_reason(c: dict, known: dict[str, set[str]]) -> str | None:
    """'This filename names a DIFFERENT part we hold' — the refusal for meraki's MR45.png on the
    MR46 page. Silent about a filename that names nothing, names this part, or names only this
    part's own FAMILY: only a positive identification of somebody else's product refuses.

    The family half was bought by run #50 (4 Sep 2026), which refused MS210-24P <- MS210.png,
    MS225-48FP <- MS225.png and MS350-24P <- MS350.png. Each of those files is the family photo
    that Meraki prints on every model's page, and each was refused only because the family slug
    is also a row in `parts`. See sku_relation() for what separates a family from a sibling.

    A file that names a sibling is refused even when it ALSO names the family, and the reason
    names the sibling, not the family: MS355-48X2-MS355-24X2-stacked.png is the MS355 family
    photo and a photo of two specific models that are not the MS355-24X whose page it was on.
    """
    named = sku_tokens(c["image_url"]) & known.get(c["vendor_slug"], set())
    if not named:
        return None
    rel = {n: sku_relation(c["sku"], n) for n in named}
    if any(r == "same" for r in rel.values()):
        return None
    others = sorted(n for n, r in rel.items() if r == "other")
    if others:
        return "names-another-sku:" + others[0]
    return None


def decide(db, cid: int, status: str, reason: str | None, image_id: int | None = None) -> None:
    db.execute("UPDATE image_candidates SET status = %s, reason = %s, image_id = COALESCE(%s, image_id), decided_at = now() WHERE id = %s",
               (status, reason, image_id, cid))


def upload_to_box(out_dir: Path, rel_paths: list[str]) -> dict:
    """Ship the files this run wrote to the API box and CHECK they arrived. Returns a record; a
    failure is reported, never swallowed — an image row whose file is only on the laptop is a 404
    on the live site and every automated check scores it as present."""
    import subprocess, tarfile, tempfile
    rel = sorted(set(rel_paths))
    if not rel:
        return {"attempted": False, "reason": "nothing new to upload"}
    if not Path(SSH_KEY).exists():
        return {"attempted": False, "reason": f"ssh key not found at {SSH_KEY}"}
    tmp = Path(tempfile.mkdtemp(prefix="nz-img-")) / "batch.tar.gz"
    with tarfile.open(tmp, "w:gz") as tf:
        for r in rel:
            f = out_dir / r
            if f.exists():
                tf.add(f, arcname=r)
    remote_tar = "/tmp/netzspec-images-batch.tar.gz"
    # A hung ssh must come back as a FAILED upload record, never as an exception: on 4 Sep 2026
    # the verification call timed out after the files had landed, the exception escaped from the
    # caller's `finally`, and the run row was left `running` for good.
    try:
        scp = subprocess.run(["scp", "-i", SSH_KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", str(tmp), f"{SSH_HOST}:{remote_tar}"],
                             capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        return {"attempted": True, "ok": False, "files": len(rel), "error": "scp timed out after 600 s"}
    if scp.returncode != 0:
        return {"attempted": True, "ok": False, "files": len(rel), "error": (scp.stderr or scp.stdout).strip()[:300]}
    # extract, then COUNT what is actually on the box: "uploaded" must mean the file is there
    cmd = (f"mkdir -p {BOX_IMAGE_DIR} && tar -xzf {remote_tar} -C {BOX_IMAGE_DIR} && rm -f {remote_tar} && "
           f"cd {BOX_IMAGE_DIR} && ls -1 " + " ".join("'" + r + "'" for r in rel) + " 2>/dev/null | wc -l")
    try:
        ex = subprocess.run(["ssh", "-i", SSH_KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", SSH_HOST, cmd],
                            capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        return {"attempted": True, "ok": False, "files": len(rel), "landed": None,
                "error": "extract/verify ssh timed out after 600 s; the files may be on the box, unverified"}
    landed = 0
    for line in ex.stdout.strip().splitlines()[::-1]:
        if line.strip().isdigit():
            landed = int(line.strip()); break
    return {"attempted": True, "ok": ex.returncode == 0 and landed == len(rel), "files": len(rel), "landed": landed,
            "error": (ex.stderr or "").strip()[:300] or None}


def run_from_db(args: argparse.Namespace) -> int:
    import psycopg
    from psycopg.rows import dict_row
    R = rules()
    env = load_env()
    out_dir = Path(env.get("IMAGE_DIR") or (ROOT / "runs" / "images"))
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = out_dir / "manifest.jsonl"
    db = psycopg.connect(env["DATABASE_URL"], autocommit=True, row_factory=dict_row)

    batch = db.execute(LEASE_SQL, {"max_attempts": R["max_attempts"], "lease_minutes": R["lease_minutes"],
                                   "limit": args.limit or 40}).fetchall()
    print(f"leased {len(batch)} candidates (rules {R['version']}, limit {args.limit or 40})")
    if args.dry_run:
        shared = {r["url_key"]: r["n"] for r in db.execute(
            "SELECT url_key, count(DISTINCT part_id) AS n FROM image_candidates WHERE url_key = ANY(%s) GROUP BY 1",
            ([c["url_key"] for c in batch],)).fetchall()}
        known_skus = known_sku_map(db, batch)
        for c in batch:
            pre = placeholder_reason(c["image_url"])
            if not pre and shared.get(c["url_key"], 0) > R["max_parts_per_url_key"]:
                pre = f"shared-across-parts:{shared[c['url_key']]}"
            if not pre:
                pre = other_sku_reason(c, known_skus)
            print(f"  DRY {c['vendor_slug']}:{c['sku']:<28} tier{c['tier']} {c['source_slug']:<14} "
                  f"{'REFUSE ' + pre if pre else 'fetch'} {c['image_url'][:110]}")
        db.close()
        return 0
    if not batch:
        db.close()
        return 0

    ids = [c["id"] for c in batch]
    db.execute("UPDATE image_candidates SET leased_at = now(), attempts = attempts + 1 WHERE id = ANY(%s)", (ids,))
    run_id = db.execute(
        "INSERT INTO runs (kind, inputs, git_sha, notes) VALUES ('images', %s::jsonb, %s, %s) RETURNING id",
        (json.dumps({"mode": "from-db", "limit": args.limit or 40, "leased": len(batch),
                     "rules_version": R["version"], "upload": not args.no_upload}), git_sha(),
         "image lane: candidates -> fetched, validated, WebP variants")).fetchone()["id"]
    print(f"run #{run_id}")

    shared = {r["url_key"]: r["n"] for r in db.execute(
        "SELECT url_key, count(DISTINCT part_id) AS n FROM image_candidates WHERE url_key = ANY(%s) GROUP BY 1",
        ([c["url_key"] for c in batch],)).fetchall()}
    known_skus = known_sku_map(db, batch)

    counts = {"leased": len(batch), "fetched": 0, "promoted": 0, "rejected": 0, "failed": 0, "variants": 0}
    reasons: dict[str, int] = {}
    per_part: list[dict] = []
    new_files: list[str] = []
    browser = None
    status = "failed"
    try:
        for c in batch:
            tag = f"{c['vendor_slug']}:{c['sku']}"
            # ---- refusals that cost no request -------------------------------------------
            reason = placeholder_reason(c["image_url"])
            if not reason and shared.get(c["url_key"], 0) > R["max_parts_per_url_key"]:
                reason = f"shared-across-parts:{shared[c['url_key']]}"
            if not reason:
                reason = other_sku_reason(c, known_skus)
            if reason:
                decide(db, c["id"], "rejected", reason)
                counts["rejected"] += 1; reasons[reason.split(":")[0]] = reasons.get(reason.split(":")[0], 0) + 1
                per_part.append({"sku": tag, "outcome": "rejected", "reason": reason, "url": c["image_url"]})
                print(f"  reject {tag}: {reason}")
                continue
            if browser is None:
                from worker import Browser
                browser = Browser(mode="cdp" if args.cdp else "profile", cdp_url=args.cdp or "http://127.0.0.1:9222", headless=not args.cdp)
            # ---- fetch ---------------------------------------------------------------------
            st, body = None, b""
            for attempt in (1, 2):
                try:
                    r = browser.fetch_binary(c["image_url"], politeness_ms=max(350, c["politeness_ms"] or 350), referer=c["page_url"])
                    st, body = r["status"], r["body"]
                except Exception as e:  # noqa
                    st, body = None, b""
                    print(f"  fetch-error {tag}: {str(e)[:120]}")
                if st == 200 and body:
                    break
                time.sleep(2)
            if st != 200 or not body:
                reason = f"http-{st}" if st else "fetch-error"
                decide(db, c["id"], "failed", reason)
                counts["failed"] += 1; reasons[reason] = reasons.get(reason, 0) + 1
                per_part.append({"sku": tag, "outcome": "failed", "reason": reason, "url": c["image_url"]})
                print(f"  fail   {tag}: {reason}")
                continue
            counts["fetched"] += 1
            sha = hashlib.sha256(body).hexdigest()
            fmt = sniff(body)
            if fmt is None:
                reason = f"not-an-image:{body[:8].hex()}"
                decide(db, c["id"], "rejected", reason)
                counts["rejected"] += 1; reasons["not-an-image"] = reasons.get("not-an-image", 0) + 1
                per_part.append({"sku": tag, "outcome": "rejected", "reason": reason, "url": c["image_url"]})
                print(f"  reject {tag}: {reason}")
                continue
            # the same test as shared-across-parts, on the BYTES: two URLs can serve one placeholder
            nsha = db.execute("SELECT count(DISTINCT part_id) AS n FROM images WHERE sha256 = %s", (sha,)).fetchone()["n"]
            if nsha >= R["max_parts_per_sha256"]:
                reason = f"generic-content:{nsha}"
                decide(db, c["id"], "rejected", reason)
                counts["rejected"] += 1; reasons["generic-content"] = reasons.get("generic-content", 0) + 1
                per_part.append({"sku": tag, "outcome": "rejected", "reason": reason, "url": c["image_url"], "sha256": sha})
                print(f"  reject {tag}: {reason}")
                continue
            rec = make_variants(body, out_dir, c["vendor_slug"] or "unknown", sha)
            reason = content_reason(rec)
            if reason:
                decide(db, c["id"], "rejected", reason)
                counts["rejected"] += 1; reasons[reason.split(":")[0]] = reasons.get(reason.split(":")[0], 0) + 1
                per_part.append({"sku": tag, "outcome": "rejected", "reason": reason, "url": c["image_url"]})
                print(f"  reject {tag}: {reason}")
                continue
            # ---- promote --------------------------------------------------------------------
            # The page's alt is EVIDENCE, not a caption: docs/SCRAPING.md records that some models
            # carry a neighbour's alt text. It becomes alt_en only when it names this SKU; the raw
            # string stays on the candidate row either way.
            # ...and an alt that is only the file's own name is not a caption either: meraki's
            # MR36 page carries alt="mr36-mantle.jpg", which names the SKU and says nothing.
            alt = (c["alt"] or "").strip()
            looks_like_filename = " " not in alt and alt.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"))
            alt_en = alt if alt and not looks_like_filename and alnum(c["sku"]) in alnum(alt) else None
            conf = 0.7 if c["tier"] <= 2 else 0.5
            orig = next(v for v in rec["variants"] if v["variant"] == "original")
            img_id = db.execute(
                """INSERT INTO images (part_id, role, source_url, storage_path, width, height, format, bytes, sha256, alt_en,
                                       assignment_method, confidence, merchant_ready, merchant_issues, license_note, source_id, run_id)
                   VALUES (%s,'primary',%s,%s,%s,%s,%s,%s,%s,%s,'source-page',%s,%s,%s::jsonb,%s,%s,%s)
                   ON CONFLICT (part_id, role, source_url) DO UPDATE SET storage_path = EXCLUDED.storage_path, width = EXCLUDED.width,
                     height = EXCLUDED.height, format = EXCLUDED.format, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256,
                     merchant_ready = EXCLUDED.merchant_ready, merchant_issues = EXCLUDED.merchant_issues,
                     alt_en = COALESCE(images.alt_en, EXCLUDED.alt_en)
                   RETURNING id""",
                (c["part_id"], c["image_url"], orig["storage_path"], rec["width"], rec["height"], rec["format"], orig["bytes"], sha,
                 alt_en, conf, rec["merchant_ready"], json.dumps(rec["issues"]), f"product photo ({c['source_slug']})",
                 c["source_id"], run_id)).fetchone()["id"]
            for v in rec["variants"]:
                db.execute(
                    """INSERT INTO image_variants (image_id, variant, storage_path, width, height, bytes, format, sha256, background)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (image_id, variant) DO UPDATE SET storage_path = EXCLUDED.storage_path, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256""",
                    (img_id, v["variant"], v["storage_path"], v["width"], v["height"], v["bytes"], v["format"], v["sha256"], v.get("background")))
                counts["variants"] += 1
                new_files.append(v["storage_path"])
            decide(db, c["id"], "done", None, img_id)
            # every other candidate for this part is now a request we will not spend
            skipped = db.execute(
                "UPDATE image_candidates SET status = 'rejected', reason = 'part-already-has-image', decided_at = now() "
                "WHERE part_id = %s AND id <> %s AND status IN ('pending','failed')", (c["part_id"], c["id"])).rowcount
            counts["promoted"] += 1
            per_part.append({"sku": tag, "outcome": "promoted", "image_id": img_id, "url": c["image_url"], "sha256": sha,
                             "width": rec["width"], "height": rec["height"], "bytes": orig["bytes"], "format": rec["format"],
                             "background": rec["background"], "merchant_ready": rec["merchant_ready"], "issues": rec["issues"],
                             "variants": [v["variant"] for v in rec["variants"]], "siblings_closed": skipped,
                             "source": c["source_slug"], "alt_en": alt_en})
            with manifest.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"src": c["image_url"], "outcome": "ok", "status": st, "at": now(), "sha256": sha,
                                    "sku": c["sku"], "vendor": c["vendor_slug"], "source": c["source_slug"],
                                    "candidate_id": c["id"], "run_id": run_id, "image_id": img_id,
                                    "width": rec["width"], "height": rec["height"], "issues": rec["issues"],
                                    "variants": rec["variants"]}, ensure_ascii=False) + "\n")
            print(f"  ok     {tag}: {rec['width']}x{rec['height']} {rec['format']} {orig['bytes']}B "
                  f"{'merchant-ready' if rec['merchant_ready'] else ','.join(rec['issues'])} <- {c['source_slug']}")
        status = "succeeded"
    finally:
        if browser is not None:
            browser.close()
        # whatever the upload does, the run row is closed: an exception here once left it `running`
        try:
            upload = {"attempted": False, "reason": "--no-upload"} if args.no_upload else upload_to_box(out_dir, new_files)
        except Exception as e:  # noqa
            upload = {"attempted": True, "ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}
        if upload.get("attempted") and not upload.get("ok", True):
            status = "failed"
        db.execute("UPDATE runs SET status = %s::run_status, finished_at = now(), stats = %s::jsonb WHERE id = %s",
                   (status, json.dumps({**counts, "reasons": reasons, "upload": upload}), run_id))
        db.close()
    print(f"done: {counts}")
    print(f"reasons: {reasons}")
    print(f"upload: {upload}")
    for p in per_part:
        print("  " + json.dumps(p, ensure_ascii=False))
    return 0


def keys_cmd(args: argparse.Namespace) -> int:
    """The url_key / placeholder decision for each URL, as JSON. Exists so the TypeScript half
    can be compared against this one over the same corpus (tests/scraper/test_image_rules.py)."""
    out = []
    for u in args.urls:
        w, h = size_hint(u)
        out.append({"url": u, "key": url_key(u), "placeholder": placeholder_reason(u), "width_hint": w, "height_hint": h})
    print(json.dumps(out, ensure_ascii=False))
    return 0


def process_cmd(args: argparse.Namespace) -> int:
    body = Path(args.file).read_bytes()
    sha = hashlib.sha256(body).hexdigest()
    rec = make_variants(body, Path(args.out_dir), args.vendor, sha)
    print(json.dumps(rec, indent=1))
    return 0 if rec.get("ok") else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="netzspec image pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--from-picks", default="", help="one-off mode: an operator-curated picks file")
    r.add_argument("--from-db", action="store_true", help="continuous mode: lease pending image_candidates for parts with no image")
    r.add_argument("--tiers", default="exact,form,series")
    r.add_argument("--limit", type=int, default=0)
    r.add_argument("--cdp", default="")
    r.add_argument("--db", action="store_true", help="also write images/image_variants rows for parts that exist")
    r.add_argument("--dry-run", action="store_true", help="--from-db: show the batch and its refusals, lease nothing, write nothing")
    r.add_argument("--no-upload", action="store_true", help="--from-db: keep the files local (they will not be on the live site)")
    p = sub.add_parser("process")
    p.add_argument("file")
    p.add_argument("--vendor", default="cisco")
    p.add_argument("--out-dir", default=str(ROOT / "runs" / "images"))
    k = sub.add_parser("keys", help="print the url_key / placeholder decision for each URL as JSON")
    k.add_argument("urls", nargs="+")
    args = ap.parse_args()
    if args.cmd == "run":
        # exactly one source of work: a run with neither reads nothing and reports success
        if bool(args.from_picks) == bool(args.from_db):
            ap.error("run: give exactly one of --from-picks <file> or --from-db")
        if args.from_db:
            return run_from_db(args)
    return {"run": run, "process": process_cmd, "keys": keys_cmd}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
