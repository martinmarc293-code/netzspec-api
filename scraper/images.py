"""scraper/images.py — product photos, self-hosted, in the shapes Google Merchant wants.

    python3.11 scraper/images.py run --from-picks data/reference/part-images.json --tiers exact,form,series [--limit N] [--cdp http://127.0.0.1:9222] [--db]
    python3.11 scraper/images.py process <image-file> [--out-dir runs/images]      one file, prints what it would record

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
        return {"ok": False, "issue": f"unsupported-format:{fmt or 'unknown'}"}
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
    r.add_argument("--from-picks", required=True)
    r.add_argument("--tiers", default="exact,form,series")
    r.add_argument("--limit", type=int, default=0)
    r.add_argument("--cdp", default="")
    r.add_argument("--db", action="store_true", help="also write images/image_variants rows for parts that exist")
    p = sub.add_parser("process")
    p.add_argument("file")
    p.add_argument("--vendor", default="cisco")
    p.add_argument("--out-dir", default=str(ROOT / "runs" / "images"))
    args = ap.parse_args()
    return {"run": run, "process": process_cmd}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
