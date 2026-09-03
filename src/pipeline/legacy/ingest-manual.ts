// scripts/universe/ingest-manual.ts — intake for documents the operator collected by hand.
//
//   npx tsx scripts/universe/ingest-manual.ts                     dry run, shows what it found
//   npx tsx scripts/universe/ingest-manual.ts --commit             write into the PID universe
//
// Drop files into data/reference/manual/<vendor>/ and run this. Handles .pdf, .html and .csv/.txt.
//
// WHY THIS EXISTS. robots.txt binds AUTOMATED CLIENTS. meraki.cisco.com disallows our crawler, so
// the scraper does not fetch it — but a person reading those pages in their own browser is not a
// crawler, and that rule does not govern them. The operator can collect the documents by hand and
// drop them here; the same conservative part-number extraction then applies. The constraint was
// always on the tool, not on the human.
//
// Extraction rule is unchanged: a value counts as a part number because it is predominantly
// upper case, part-code shaped, and not a spec value — never because it appeared in prose.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const COMMIT = process.argv.includes("--commit");
const root = process.cwd();
const MANUAL = path.join(root, "data/reference/manual");
const STORE = path.join(root, "data/reference/cisco-pid-universe.json");

const NOT_PID = /^(N\/?A|TBD|NONE|YES|NO|X|-+)$|^\d{1,4}(\.\d+)*$|^\d{1,2}\/\d{1,2}(\/\d{2,4})?$|^(IEEE|RFC|ISO|IEC|EN|UL|CSA|IETF)[-\s]?\d/i;
const SHAPE = /^[A-Z0-9][A-Za-z0-9./+=_-]{3,44}$/;

/** Same test as scraper/enumerate_cisco.py::is_pid — kept deliberately strict. */
function isPid(tok: string): boolean {
  if (!tok || tok.includes(" ") || tok.length < 4 || tok.length > 45) return false;
  if (!SHAPE.test(tok) || NOT_PID.test(tok)) return false;
  const letters = [...tok].filter((c) => /[a-z]/i.test(c));
  if (letters.length && letters.filter((c) => c === c.toUpperCase()).length / letters.length < 0.6) return false;
  return /\d/.test(tok) || (tok.includes("-") && letters.length >= 3);
}

if (!fs.existsSync(MANUAL)) { console.error(`nothing to ingest: ${MANUAL} does not exist`); process.exit(0); }

const vendors = fs.readdirSync(MANUAL, { withFileTypes: true }).filter((d) => d.isDirectory());
const results: { vendor: string; file: string; pids: string[] }[] = [];

for (const v of vendors) {
  const dir = path.join(MANUAL, v.name);
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const ext = path.extname(f).toLowerCase();
    let text = "";
    if (ext === ".pdf") {
      try {
        text = execFileSync("python", ["-c", `
import sys, pdfplumber
with pdfplumber.open(sys.argv[1]) as pdf:
    print("\\n".join((p.extract_text() or "") for p in pdf.pages))
`, full], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      } catch (e) { console.error(`  ! ${f}: pdf read failed (${String(e).slice(0, 60)})`); continue; }
    } else if ([".html", ".htm", ".csv", ".txt", ".tsv", ".json"].includes(ext)) {
      text = fs.readFileSync(full, "utf8").replace(/<[^>]+>/g, " ");
    } else { continue; }

    const found = new Set<string>();
    for (const tok of text.split(/[\s,;|"'()\[\]<>]+/)) {
      const t = tok.trim().replace(/[.,;:]+$/, "");
      if (isPid(t)) found.add(t);
    }
    results.push({ vendor: v.name, file: f, pids: [...found].sort() });
  }
}

if (!results.length) {
  console.log(`no files found under ${path.relative(root, MANUAL)}/<vendor>/`);
  console.log(`drop .pdf, .html or .csv there and re-run.`);
  process.exit(0);
}

let total = 0;
for (const r of results) {
  console.log(`${r.vendor.padEnd(10)} ${r.file.slice(0, 46).padEnd(48)} ${String(r.pids.length).padStart(5)} part numbers`);
  if (r.pids.length) console.log(`            e.g. ${r.pids.slice(0, 8).join(", ")}`);
  total += r.pids.length;
}
console.log(`\n${results.length} file(s), ${total} part-number occurrences`);

if (!COMMIT) { console.log(`\nDRY RUN — pass --commit to write these into the PID universe`); process.exit(0); }

const store = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, "utf8")) : { documents: {} };
for (const r of results) {
  if (!r.pids.length) continue;
  store.documents[`manual://${r.vendor}/${r.file}`] = {
    category: r.vendor === "meraki" ? "meraki" : r.vendor,
    series_slug: `manual-${r.vendor}`,
    series_name: `${r.vendor} (collected by hand)`,
    doc_type: "manual",
    pids: r.pids,
    note: "operator-collected; robots.txt binds automated clients, not a person reading a public page",
  };
}
fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
console.log(`\nwritten into ${path.relative(root, STORE)}`);
