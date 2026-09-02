"""Download non-HTML assets (product images) through the PoliteBrowser.

    python scraper/fetch_assets.py --urls-file <file> --out <dir> [--limit N]

The urls file is one URL per line, or TSV whose LAST tab-separated field is the URL.

Why this exists rather than curl: cisco.com answers curl with 403 (verified again
2026-09-02 on a /c/dam/ image — http=403, 665 bytes of HTML). The browser context's
request API carries a real UA, cookies and TLS fingerprint, so the same URL returns the
file. PoliteBrowser also gives us the throttle, the robots check, the cache and the
ledger for free, so an image sweep is subject to exactly the same discipline as the
datasheet crawl -- which matters when the sweep is tens of thousands of files.

Bytes land in scraper/cache/<sha1>.bin (so a re-run is free) and are ALSO written to
--out under a filename derived from the URL, which is what the site build consumes.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from netzscrape import PoliteBrowser, PoliteBlocked  # noqa: E402

EXT_OK = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def out_name(url: str) -> str:
    """A stable, collision-free local name: the URL's basename prefixed with a short hash.

    Cisco reuses basenames across products (data-sheet-c78-740623_0.png is unique, but
    ds-fan-unit.png is not), so the hash prefix is what guarantees two different images
    never overwrite each other. Keeping the readable basename makes the cache dir
    debuggable by eye -- the SEO-friendly filename is applied later, at publish time.
    """
    base = url.split("?")[0].split("/")[-1] or "image"
    ext = Path(base).suffix.lower()
    if ext not in EXT_OK:
        ext = ".png"
    stem = Path(base).stem[:60]
    return f"{hashlib.sha1(url.encode()).hexdigest()[:10]}-{stem}{ext}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--headless", action="store_true", default=True)
    args = ap.parse_args()

    urls: list[str] = []
    seen = set()
    for line in Path(args.urls_file).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        u = line.split("\t")[-1].strip()
        if not u.startswith("http") or u in seen:
            continue
        seen.add(u)
        urls.append(u)
    if args.limit:
        urls = urls[: args.limit]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    print(f"assets to fetch: {len(urls)} -> {out}")

    br = PoliteBrowser(headless=args.headless)
    ok = failed = skipped = 0
    try:
        for i, u in enumerate(urls, 1):
            dest = out / out_name(u)
            if dest.exists() and dest.stat().st_size > 0:
                skipped += 1
                continue
            try:
                body = br.fetch_binary(u)
            except PoliteBlocked as e:
                print(f"  robots: {e}", file=sys.stderr)
                failed += 1
                continue
            except Exception as e:  # noqa
                print(f"  ! {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
                failed += 1
                continue
            # A 403/404 body is an HTML error page, not an image. Catch it here rather than
            # discovering it as a broken <img> on a live product page.
            if len(body) < 512 or body[:1] == b"<":
                print(f"  ! not an image ({len(body)}B): {u[-70:]}", file=sys.stderr)
                failed += 1
                continue
            dest.write_bytes(body)
            ok += 1
            if i % 50 == 0:
                print(f"  {i}/{len(urls)}  ok={ok} failed={failed} skipped={skipped}")
    finally:
        br.close()

    print(f"done: ok={ok} failed={failed} already-present={skipped}")
    return 0 if ok or skipped else 1


if __name__ == "__main__":
    raise SystemExit(main())
