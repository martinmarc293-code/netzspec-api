// scripts/check-layer-site.mts — refuse to publish a layer site whose printed status is not its own JSON's.
//
//   npx tsx scripts/check-layer-site.mts --site DIR [--require-clean] [--committed]
//
// Review of 17 Sep 2026: the index said "17 of 17 categories done" and every page DONE over 1,974 rows waiting on a plan. The standing
// checks (tests/layersStanding.test.ts) prove the committed data/layers JSON against its rows; nothing proved the HTML a reader sees
// against that JSON, and the HTML is what is published. This reads the built site the publish would ship and exits 1, naming every
// disagreement, when:
//   - a category JSON's status disagrees with its own rows (statusDisagreements — done is exactly "every row layered")
//   - a category page's banner is not DONE exactly when done, or not "PENDING <pending>" otherwise, or its layered / all-parts counts differ
//   - the index does not list exactly the categories with a JSON, a row of it differs from that JSON, or its "N of M done" is not the count
//   - with --require-clean: a page was built from uncommitted rule files, or from a commit that is not HEAD
//   - with --committed: a page's rows or summary differ from HEAD's data/layers/<vendor>-<category>.rows.tsv / .json — anything but the
//     build's own provenance (built_at, commit, uncommitted_rule_files), which names the commit it was built at and so cannot match
//     the commit that carries it. Publishing then ships exactly the rows tests/layersStanding.test.ts certified on that commit.
// Read-only: files only, no store.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { REPO_ROOT } from "../src/config.js";
import { statusDisagreements, type LayerRow, type StatusSummary } from "../src/core/layerChecks.js";

const arg = (k: string): string | null => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const site = arg("--site");
if (!site) throw new Error("--site DIR (the directory holding layers/)");
const requireClean = process.argv.includes("--require-clean");
import { PROVENANCE_FIELDS } from "../src/core/provenance.js";
const committed = process.argv.includes("--committed");
const dir = path.join(site, "layers");
// THE LIST LIVES IN ONE PLACE NOW (src/core/provenance.ts), with the three consumers it bit written beside
// it. `build` was missing here and its absence had made this guard REFUSE FOR EVER: scripts/mould-stamp.mts
// writes that object onto every committed artefact AFTER the build that produced it, so no fresh build can
// carry one and the first publish after the stamp shipped refused all 17 categories -- while the summaries
// were byte-identical once the build fields were stripped. A local copy of this list is how a fourth consumer
// gets it wrong, which the reviewer named as the shape of the next instance.

/** a published row as its line in the committed rows.tsv (scripts/build-layers.mts writes the TSV from these same row objects) */
const tsvCell = (row: Record<string, unknown>, col: string): string => {
  const x = row[col];
  const v = col === "plan" ? (x ? `${(x as { action: string }).action} ${(x as { to: string }).to}` : "") : col === "family_carrier" ? (x ? "true" : "") : x;
  return String(v ?? "").replace(/[\t\r\n]+/g, " ");
};
const gitShow = (file: string): string | null => {
  try { return execFileSync("git", ["show", `HEAD:${file}`], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 }).replace(/\r/g, ""); } catch { return null; }
};

type Page = StatusSummary & { category: string; commit: string | null; uncommitted_rule_files: string[] | null; lines: { line: string; series: { series: string; family: string | null }[] }[]; rows: Record<string, unknown>[] };
// a page from before a field existed (the 274feac pages carry no layered / pending) is refused for the missing field, never a crash
const n = (x: unknown) => (typeof x === "number" ? x.toLocaleString("en-US") : "(missing)");
const problems: string[] = [];

const jsonFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
if (jsonFiles.length === 0) problems.push(`${dir}: no category JSON at all — nothing to publish`);
const pages = jsonFiles.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Page);
const head = requireClean ? execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim() : null;

for (const t of pages) {
  const cat = t.category;
  // the JSON against its own rows (the published JSON carries every row; nulls read as blank)
  const rows = t.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]))) as LayerRow[];
  for (const d of statusDisagreements(t, rows)) problems.push(`${cat}.json: ${d}`);
  // the page a reader sees against the JSON
  const htmlFile = path.join(dir, `${cat}.html`);
  if (!fs.existsSync(htmlFile)) { problems.push(`${cat}: no ${cat}.html beside ${cat}.json`); continue; }
  const html = fs.readFileSync(htmlFile, "utf8");
  const saysDone = html.includes("<b>DONE</b>"), pendingWord = html.match(/<b>PENDING ([\d,]+)<\/b>/);
  if (t.done && (!saysDone || pendingWord)) problems.push(`${cat}.html: the JSON is done, the banner ${pendingWord ? `says PENDING ${pendingWord[1]}` : "does not say DONE"}`);
  if (!t.done && saysDone) problems.push(`${cat}.html: the banner says DONE, the JSON is not done (${t.pending} row(s) not layered)`);
  if (!t.done && t.mapping_file && (!pendingWord || pendingWord[1] !== n(t.pending))) problems.push(`${cat}.html: the banner ${pendingWord ? `says PENDING ${pendingWord[1]}` : "carries no PENDING count"}, the JSON pending is ${n(t.pending)}`);
  const layeredCell = html.match(/\(layered — the lines above\)<\/td><td><\/td><td><\/td><td class=r>([\d,]+)<\/td>/), allCell = html.match(/<b>all parts<\/b><\/td><td><\/td><td><\/td><td class=r><b>([\d,]+)<\/b><\/td>/);
  if (!layeredCell || layeredCell[1] !== n(t.layered)) problems.push(`${cat}.html: summary layered ${layeredCell?.[1] ?? "(missing)"}, JSON ${n(t.layered)}`);
  if (!allCell || allCell[1] !== n(t.parts)) problems.push(`${cat}.html: summary all parts ${allCell?.[1] ?? "(missing)"}, JSON ${n(t.parts)}`);
  if (requireClean) {
    if (t.uncommitted_rule_files === null || t.uncommitted_rule_files.length) problems.push(`${cat}.json: built with ${t.uncommitted_rule_files === null ? "git unreadable" : `uncommitted rule files: ${t.uncommitted_rule_files.join(", ")}`} — publish only pages built from a commit`);
    if (t.commit !== head) problems.push(`${cat}.json: built at commit ${t.commit?.slice(0, 10)}, HEAD is ${head?.slice(0, 10)}`);
  }
  if (committed) {
    const vendor = String((t as unknown as { vendor: string }).vendor);
    const tsv = gitShow(`data/layers/${vendor}-${cat}.rows.tsv`), sum = gitShow(`data/layers/${vendor}-${cat}.json`);
    if (tsv === null || sum === null) { problems.push(`${cat}: HEAD carries no data/layers/${vendor}-${cat}.rows.tsv / .json to compare with`); continue; }
    const lines = tsv.split("\n").filter(Boolean), cols = lines[0].split("\t");
    const mine = [cols.join("\t"), ...t.rows.map((r) => cols.map((c) => tsvCell(r, c)).join("\t"))];
    if (mine.length !== lines.length) problems.push(`${cat}: ${mine.length - 1} rows built, ${lines.length - 1} committed — the store moved since data/layers was committed`);
    else {
      const differ = lines.map((l, i) => (l === mine[i] ? null : i)).filter((i): i is number => i !== null);
      if (differ.length) problems.push(`${cat}: ${differ.length} row(s) differ from the committed rows.tsv, e.g. committed "${lines[differ[0]].slice(0, 120)}" built "${mine[differ[0]].slice(0, 120)}"`);
    }
    const strip = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !PROVENANCE_FIELDS.includes(k) && k !== "rows")));
    if (strip(t as unknown as Record<string, unknown>) !== strip(JSON.parse(sum))) problems.push(`${cat}: the summary differs from the committed ${vendor}-${cat}.json beyond ${PROVENANCE_FIELDS.join(" / ")}`);
  }
}

// the index against the pages
const indexFile = path.join(dir, "index.html");
if (!fs.existsSync(indexFile)) problems.push("index.html: missing");
else {
  const idx = fs.readFileSync(indexFile, "utf8");
  const listed = [...idx.matchAll(/<tr><td><a href="([^"]+)\.html">[^<]*<\/a><\/td>((?:<td[^>]*>[^<]*<\/td>)+)<\/tr>/g)].map((m) => ({ cat: m[1], cells: [...m[2].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1]) }));
  const listedCats = listed.map((x) => x.cat).sort(), pageCats = pages.map((t) => t.category).sort();
  if (JSON.stringify(listedCats) !== JSON.stringify(pageCats)) problems.push(`index.html lists [${listedCats.join(", ")}], the site holds [${pageCats.join(", ")}]`);
  // columns: parts, layered, pending move / class change, held for review, not this category, unplaced, product lines, families, series, status
  for (const { cat, cells } of listed) {
    const t = pages.find((p) => p.category === cat);
    if (!t) continue;
    const want = [n(t.parts), n(t.layered), n(t.pending_plans.length), n(t.pending_review.length), n(t.not_this_category.length), t.mapping_file ? n(t.unplaced.length) : "—",
      String(t.lines.length), null, String(t.lines.reduce((a, l) => a + l.series.length, 0)), !t.mapping_file ? "not started" : t.done ? "DONE" : `PENDING ${n(t.pending)}`];
    const names = ["parts", "layered", "pending move / class change", "held for review", "not this category", "unplaced", "product lines", "families", "series", "status"];
    if (cells.length !== want.length) { problems.push(`index.html ${cat}: ${cells.length} cells, expected ${want.length}`); continue; }
    want.forEach((w, i) => { if (w !== null && cells[i] !== w) problems.push(`index.html ${cat}: ${names[i]} "${cells[i]}", the JSON says "${w}"`); });
  }
  const doneCount = pages.filter((t) => t.done).length, headline = idx.match(/<b>(\d+) of (\d+) categories done<\/b>/);
  if (!headline || headline[1] !== String(doneCount) || headline[2] !== String(pages.length)) problems.push(`index.html: headline "${headline?.[0] ?? "(missing)"}", the pages give ${doneCount} of ${pages.length} done`);
}

// counted from the ROWS, not the pages' own fields: a site being refused is exactly one whose fields cannot be trusted
const saysDone = pages.filter((t) => t.done === true).length, notLayered = pages.reduce((a, t) => a + t.rows.filter((r) => r.placement !== "layered").length, 0);
console.log(`layer site ${dir}: ${pages.length} categories, ${saysDone} marked done, ${n(notLayered)} rows not layered (counted from the rows)${requireClean ? `, clean build at ${head?.slice(0, 10)} required` : ""} — ${problems.length} problem(s)`);
if (problems.length) { for (const p of problems) console.log(`  REFUSED ${p}`); process.exit(1); }
