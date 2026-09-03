// tests/source-scan.test.ts — no control characters anywhere in the source tree.
//
//   npx tsx tests/source-scan.test.ts
//
// The lesson (CLAUDE.md § Proof rules; D:\Project\CLAUDE.md § 4): a regex written through a
// Python heredoc turned its word boundaries into literal 0x08 bytes. It compiled, it ran, it
// matched nothing, and it reported success — four times in one day. grep showed it as correct
// because a terminal renders a backspace as nothing. The only reliable detector is a byte scan,
// so this suite is one, over every text file under src/, db/, scripts/, tests/ and data/schema/.
//
// Allowed: tab (0x09), LF (0x0A), CR (0x0D). Forbidden: 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F.
// A hit is reported as file:line:col with the byte, so the fix is one Edit away.
//
// Sabotage: a temp file in the system temp dir carrying a real 0x08 byte must be flagged at the
// right line and byte, and its clean twin (tabs, CRLF, unicode) must not be — a scanner that
// flags everything is as useless as one that flags nothing. Both files are deleted afterwards.
// The tree scan must also have covered a plausible number of files, this file among them, or a
// wrong directory list would pass vacuously.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["src", "db", "scripts", "tests", path.join("data", "schema")];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "__pycache__", ".venv"]);
const TEXT_EXT = new Set([
  ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".sql", ".md", ".sh", ".py", ".txt",
  ".yml", ".yaml", ".csv", ".tsv", ".html", ".css", ".toml", ".ini", ".env", ".example",
]);
const MIN_FILES = 40;

export type Offender = { file: string; line: number; col: number; byte: number };

export function isForbiddenByte(b: number): boolean {
  return b <= 0x08 || b === 0x0b || b === 0x0c || (b >= 0x0e && b <= 0x1f);
}

export function scanBuffer(buf: Buffer): Omit<Offender, "file">[] {
  const out: Omit<Offender, "file">[] = [];
  let line = 1;
  let col = 1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (isForbiddenByte(b)) out.push({ line, col, byte: b });
    if (b === 0x0a) { line++; col = 1; } else col++;
  }
  return out;
}

export function scanFile(file: string): Offender[] {
  return scanBuffer(fs.readFileSync(file)).map((o) => ({ file, ...o }));
}

function isTextFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  // extension-less shell-ish files (Makefile, .gitignore) are text too
  return ext === "" && !name.startsWith(".") ? false : name === ".gitignore" || name === ".env.example";
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (e.isFile() && isTextFile(e.name)) out.push(p);
  }
}

const hex = (b: number) => "0x" + b.toString(16).padStart(2, "0");
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

let pass = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ---- the tree -------------------------------------------------------------------------------
const files: string[] = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
const offenders: Offender[] = [];
for (const f of files) offenders.push(...scanFile(f));

for (const o of offenders) console.log(`MISS  ${rel(o.file)}:${o.line}:${o.col} control character ${hex(o.byte)}`);
check(`no control characters in ${files.length} text files under ${SCAN_DIRS.join(", ")}`, offenders.length === 0,
  `${offenders.length} byte(s) in ${new Set(offenders.map((o) => o.file)).size} file(s)`);
check(`the scan covered at least ${MIN_FILES} files (not a vacuous pass)`, files.length >= MIN_FILES, `only ${files.length}`);
check("the scan covered this very file", files.some((f) => path.resolve(f) === path.resolve(fileURLToPath(import.meta.url))));

// ---- sabotage: a real backspace byte must be flagged; a clean twin must not ------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "netzspec-source-scan-"));
try {
  const dirty = path.join(tmp, "dirty.mjs");
  // "const re = /" + 0x08 + "d+/;" — what a Python heredoc makes of a JS word boundary
  fs.writeFileSync(dirty, Buffer.concat([
    Buffer.from("// probe file written by tests/source-scan.test.ts\nconst re = /", "utf8"),
    Buffer.from([0x08]),
    Buffer.from("d+/;\n", "utf8"),
  ]));
  const hits = scanFile(dirty);
  check("SABOTAGE a 0x08 byte in a temp file is flagged", hits.length === 1, `got ${hits.length} hit(s)`);
  check("SABOTAGE the hit names the right line, column and byte",
    hits[0]?.line === 2 && hits[0]?.col === 13 && hits[0]?.byte === 0x08,
    hits[0] ? `${hits[0].line}:${hits[0].col} ${hex(hits[0].byte)}` : "no hit");

  const clean = path.join(tmp, "clean.ts");
  fs.writeFileSync(clean, "// tabs\tand CRLF\r\nconst s = \"ü ✓ 24× RJ45\";\r\nconst re = /\\bword\\b/;\n", "utf8");
  check("SABOTAGE-CONTROL a clean twin (tab, CR, LF, unicode, escaped backslash-b) is not flagged", scanFile(clean).length === 0);

  const vt = path.join(tmp, "vt.txt");
  fs.writeFileSync(vt, Buffer.from([0x61, 0x0b, 0x62, 0x0a, 0x63, 0x0c, 0x64]));
  const vtHits = scanFile(vt);
  check("SABOTAGE vertical tab (0x0B) and form feed (0x0C) are flagged too",
    vtHits.length === 2 && vtHits[0]?.byte === 0x0b && vtHits[1]?.byte === 0x0c && vtHits[1]?.line === 2);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
check("the temp files were deleted", !fs.existsSync(tmp));

console.log(`\nsource-scan: ${pass} passed, ${misses.length} missed`);
if (misses.length) process.exit(1);
