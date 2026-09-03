// scripts/universe/download-part-images.mjs — self-host the product photos.
//
//   node scripts/universe/download-part-images.mjs [--tier exact] [--limit N] [--commit]
//
// WHY THESE ARE SELF-HOSTED RATHER THAN HOTLINKED
// Cisco's CDN (Akamai) returns 403 to non-browser clients. curl is refused even with a full
// browser header set, a Referer and a session cookie — the block is on the TLS fingerprint, not
// the headers. Node's own fetch is NOT refused, which is the only reason this script can exist.
// A hotlinked <img> would work for a reader's browser today and break the moment Cisco tightens
// referer policy, on every page at once, with nothing reporting it. So the bytes are copied.
//
// The CDN also honours content negotiation: send `Accept: image/webp` and it returns WebP
// directly, so there is no conversion step and no quality loss from re-encoding.
//
// MONITOR DISCIPLINE (CLAUDE.md §6). A fetcher that cannot tell its own rate limiting from a
// missing file is worse than none, because it reports work that was never wrong:
//   - paced at 350ms with a real user-agent and the datasheet as Referer,
//   - ONE retry on 403/429/5xx before drawing any conclusion,
//   - three outcomes, not two: ok / missing (a real 404) / UNVERIFIED (blocked, timed out,
//     or still failing after the retry). Unverified is NOT failure and the file is left alone
//     so a later run retries it.
//
// EVERY FILE IS VALIDATED BY ITS MAGIC BYTES before it is kept. The 403 body is an HTML page
// 612 bytes long; written blindly to disk as "C9300-48P.webp" it would be a broken image on a
// live product page that every automated check would score as present.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "..", "netzspec", "public", "parts");
const MANIFEST = path.join(ROOT, "data/reference/part-images-downloaded.json");

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : dflt; };
const TIERS = String(arg("--tier", "exact")).split(",");
const LIMIT = Number(arg("--limit", "0")) || Infinity;
const COMMIT = process.argv.includes("--commit");
const PACE_MS = 350;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Identify the format from the leading bytes, and refuse anything else.
 *  Returns {ext, w, h} or null. Dimensions are parsed from the header so an icon or a 1x1
 *  spacer can be rejected — a caption can name the right product beside the wrong picture. */
function identify(buf) {
  if (buf.length < 32) return null;
  // PNG: 89 50 4E 47, IHDR width/height at 16..24 big-endian
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // WebP: "RIFF"...."WEBP"
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    const fourcc = buf.slice(12, 16).toString("ascii");
    if (fourcc === "VP8X") return { ext: "webp", w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (fourcc === "VP8 ") return { ext: "webp", w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (fourcc === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { ext: "webp", w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    return { ext: "webp", w: 0, h: 0 };            // unknown WebP flavour: keep, size unknown
  }
  // JPEG: FF D8, walk the segment chain to SOFn for dimensions
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { ext: "jpg", h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { ext: "jpg", w: 0, h: 0 };
  }
  return null;                                      // HTML error page, SVG, anything else
}

const MIN_EDGE = 80;   // below this it is an icon, a bullet or a spacer, not a product photo

async function fetchOnce(src, referer) {
  const res = await fetch(src, {
    headers: {
      "User-Agent": UA,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer || "https://www.cisco.com/",
      "Sec-Fetch-Dest": "image", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Site": "same-origin",
    },
    signal: AbortSignal.timeout(30000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf };
}

const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/reference/part-images.json"), "utf8"));
const picks = doc.picks.filter((p) => TIERS.includes(p.tier)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`picks in tier(s) ${TIERS.join(",")}: ${picks.length}`);
if (COMMIT) fs.mkdirSync(OUT_DIR, { recursive: true });

const out = [];
const stats = { ok: 0, missing: 0, unverified: 0, tooSmall: 0, notAnImage: 0, retried: 0 };
const unverifiedDetail = {};

for (const [n, p] of picks.entries()) {
  let r;
  try { r = await fetchOnce(p.src, p.source_url); }
  catch (e) { r = { status: 0, buf: Buffer.alloc(0), err: String(e.message || e) }; }

  // One retry, and only for the statuses that mean "ask again", never for a 404.
  if (r.status === 0 || r.status === 403 || r.status === 429 || r.status >= 500) {
    stats.retried++;
    await sleep(1500);
    try { r = await fetchOnce(p.src, p.source_url); }
    catch (e) { r = { status: 0, buf: Buffer.alloc(0), err: String(e.message || e) }; }
  }

  if (r.status === 404 || r.status === 410) { stats.missing++; }
  else if (r.status !== 200) {
    stats.unverified++;
    const k = `HTTP ${r.status || "network"}`;
    unverifiedDetail[k] = (unverifiedDetail[k] || 0) + 1;
  } else {
    const id = identify(r.buf);
    if (!id) { stats.notAnImage++; }
    else if (id.w && id.h && (id.w < MIN_EDGE || id.h < MIN_EDGE)) { stats.tooSmall++; }
    else {
      const file = `${p.sku.replace(/[^A-Za-z0-9._-]/g, "_")}.${id.ext}`;
      if (COMMIT) fs.writeFileSync(path.join(OUT_DIR, file), r.buf);
      out.push({ sku: p.sku, file, src: `/parts/${file}`, w: id.w, h: id.h, bytes: r.buf.length,
        tier: p.tier, caption: p.caption, source_url: p.source_url, origin: p.src });
      stats.ok++;
    }
  }

  if ((n + 1) % 25 === 0) console.log(`  ${n + 1}/${picks.length}  ok=${stats.ok} unverified=${stats.unverified} missing=${stats.missing}`);
  await sleep(PACE_MS);
}

console.log(`\nok ${stats.ok} | real 404s ${stats.missing} | UNVERIFIED ${stats.unverified} ` +
  `${JSON.stringify(unverifiedDetail)} | not an image ${stats.notAnImage} | too small ${stats.tooSmall}` +
  ` | retries issued ${stats.retried}`);
console.log("UNVERIFIED is not failure — those were blocked or timed out and a later run should retry them.");

if (COMMIT) {
  fs.writeFileSync(MANIFEST, JSON.stringify({ generated_at: new Date().toISOString().slice(0, 10),
    tiers: TIERS, stats, images: out }, null, 1));
  console.log(`\nwrote ${out.length} files to ${OUT_DIR}`);
  console.log(`manifest: ${MANIFEST}`);
} else {
  console.log("\n(dry run — nothing written; pass --commit to save the files and the manifest)");
}
