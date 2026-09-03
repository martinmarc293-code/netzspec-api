// src/pipeline/apply-lifecycle.ts — Cisco end-of-life bulletins -> lifecycle rows + successor
// relations, inside a gated apply-lifecycle run. The Postgres port of
// src/pipeline/legacy/apply-lifecycle.mjs.
//
//   ingest apply-lifecycle <cisco-eol.json> [--commit] [--sample N] [--tag T] [--vendor V]
//
// Input: scraper/run.py cisco-eol-urls output — one record per HARDWARE bulletin: doc_id
// (EOL#####), source_url, verified_at, affected_pids [{pid, successor}], lifecycle {dates}.
// Only PIDs a bulletin itself lists in its affected-products table receive its dates: never a
// family-level guess (the precedent: a family-level EoL date once aged an active 9300).
//
// Matching, exactly the legacy rule: a bulletin PID and a catalogue SKU are the same part when
// their CORES agree — ordering prefixes (WS-C, C1-), spare/relicense suffixes (=, ++, /K9) and a
// trailing hyphenated licence grade (-E/-S/-L/-A) stripped, port letters KEPT. Dates are per
// bulletin (matched by core); the SUCCESSOR is per PID and grade-specific, so a -S switch gets
// its -S successor and never the -E one (normFull keeps the grade). A PID listed with a blank
// successor honours the blank rather than falling back to a sibling's.
//
// What this file guarantees:
//   * a date is never blanked — src/store/lifecycle.ts merges, it does not overwrite — and a
//     value that is not YYYY-MM-DD is dropped and counted, never stored as text;
//   * a successor is written only when it passes the part-number gate (isPartNumber): the
//     migration column also carries prose ("See Product Migration Options section for
//     details."), which once rendered as a link to a part that cannot exist. Prose goes to
//     successor_note, the successor_sku stays NULL and no relation is written;
//   * every matched part gets a `successor` relation at tier 2 with the bulletin as its document;
//   * PIDs the bulletins name that are not in the catalogue are counted and listed.
//
// THE GATE (an apply-* run cannot close as succeeded without one): a random sample of N
// bulletins is re-read from the cached bulletin page (scraper/cache/<sha1(url)>.html).
//   precision  the bulletin id and EVERY date the record carries appear on the page, spelled the
//              way Cisco spells them ("October 31, 2022") — the adapter's own parse, reversed;
//   recall     a milestone row the page dates ("Last Date of Support … October 31, 2027") that
//              the record does NOT carry is a miss: the extractor dropped a date the page states.
// No cached page readable = unverified = not passed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  getPool, closePool, withTx, withRun, hashFile, ensureSourceDoc, docIdFor, upsertLifecycle, upsertRelation,
  type LifecycleInput, type Queryable,
} from "../store/index.js";
import { REPO_ROOT } from "../config.js";

/**
 * The part-number gate for a successor or a matrix target. The legacy isValidPid
 * (src/core/descriptionQuality.mjs) also demanded a DIGIT, which is right for prose but wrong for
 * real Cisco part numbers: the 2026-09-01 bulletins name ECS-WOM-E and ECS-WOM-NFR as successors,
 * and the TMG matrix is full of GLC-T, GLC-TE, GLC-SX-MMD, SFP-GE-S. What separates prose from a
 * part number is whitespace, length, charset and a trailing full stop — not a digit.
 */
export function isPartNumber(s: unknown): boolean {
  const t = String(s ?? "").trim();
  if (t.length < 2 || t.length > 40) return false;
  if (/\s/.test(t)) return false;                          // "See Product Migration Options section for details." dies here
  if (!/^[A-Za-z0-9][A-Za-z0-9./+=-]*$/.test(t)) return false;
  if (/\.$/.test(t)) return false;                         // trailing full stop = end of a sentence
  if (!/[A-Za-z]/.test(t)) return false;                    // a bare number is a quantity, not a PID
  return true;
}

export type AffectedPid = { pid: string; successor?: string | null };
export type Bulletin = {
  vendor?: string; doc_id: string | null; source_url: string; verified_at?: string | null;
  affected_pids: AffectedPid[]; lifecycle: Record<string, string | null | undefined>;
};

export const DATE_COLS = ["announce_date", "end_of_sale_date", "last_ship_date", "end_of_sw_maint", "end_of_vuln_support", "last_day_of_support"] as const;
export type DateCol = typeof DATE_COLS[number];
export const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
export const CACHE_DIR = path.join(REPO_ROOT, "scraper", "cache");

/** milestone label (as the adapter matches it, lower-cased substring) -> our column. Same table as cisco_eol.py. */
export const MILESTONE_LABELS: [string, DateCol][] = [
  ["end-of-life announcement", "announce_date"],
  ["end-of-sale date", "end_of_sale_date"],
  ["last ship date", "last_ship_date"],
  ["end of sw maintenance", "end_of_sw_maint"],
  ["end of vulnerability", "end_of_vuln_support"],
  ["last date of support", "last_day_of_support"],
];

// ---- PID normalisation (the legacy rules, byte for byte) ------------------------------------------
/** Hardware CORE: prefixes, packaging suffixes and the licence grade stripped; port letters kept. */
export function normPid(s: unknown): string | null {
  let p = String(s ?? "").trim().toUpperCase();
  if (!p || p.includes(" ") || p.length < 5) return null;
  p = p.replace(/\/K9(\+\+)?$/, "").replace(/[+=]+$/, "");
  p = p.replace(/^(WS-C|WSC|WS-|WS|C1-)/, "");
  p = p.replace(/^C(?=\d)/, "");
  p = p.replace(/-([ESLA])$/, "");
  if (!p.includes("-") || !/\d{3,4}/.test(p) || p.length < 5) return null;
  return p;
}

/** Grade-PRESERVING key for successor lookup: like normPid but the trailing -E/-S/-L/-A stays. */
export function normFull(s: unknown): string | null {
  let p = String(s ?? "").trim().toUpperCase();
  if (!p || p.includes(" ") || p.length < 5) return null;
  p = p.replace(/\/K9(\+\+)?$/, "").replace(/[+=]+$/, "");
  p = p.replace(/^(WS-C|WSC|WS-|WS|C1-)/, "");
  p = p.replace(/^C(?=\d)/, "");
  return p.includes("-") && /\d{3,4}/.test(p) ? p : null;
}

export const dateCount = (lc: Bulletin["lifecycle"] | undefined) => DATE_COLS.filter((k) => lc?.[k]).length;

export type BulletinIndex = {
  byCore: Map<string, { b: Bulletin; successor: string | null }>;
  succByFull: Map<string, string>;
  presentFull: Set<string>;
  pidRows: number;
};

/** Per-PID index: core -> the best bulletin covering it (most milestones, tie -> latest EoS). */
export function indexBulletins(records: Bulletin[]): BulletinIndex {
  const byCore: BulletinIndex["byCore"] = new Map();
  const succByFull = new Map<string, string>();
  const presentFull = new Set<string>();
  let pidRows = 0;
  for (const b of records) {
    for (const row of b.affected_pids ?? []) {
      const core = normPid(row.pid);
      if (!core) continue;
      pidRows++;
      const cand = { b, successor: row.successor || null };
      const cur = byCore.get(core);
      const better = !cur
        || dateCount(b.lifecycle) > dateCount(cur.b.lifecycle)
        || (dateCount(b.lifecycle) === dateCount(cur.b.lifecycle) && (b.lifecycle?.end_of_sale_date || "") > (cur.b.lifecycle?.end_of_sale_date || ""));
      if (better) byCore.set(core, cand);
      const full = normFull(row.pid);
      if (full) { presentFull.add(full); if (row.successor && !succByFull.has(full)) succByFull.set(full, row.successor); }
    }
  }
  return { byCore, succByFull, presentFull, pidRows };
}

/** exact-grade successor > explicitly blank (the bulletin lists this PID with none) > core-level fallback */
export function resolveSuccessor(sku: string, coreSucc: string | null, idx: BulletinIndex): string | null {
  const full = normFull(sku);
  if (full && idx.succByFull.has(full)) return idx.succByFull.get(full)!;
  if (full && idx.presentFull.has(full)) return null;
  return coreSucc;
}

export type LifecyclePlan = { input: LifecycleInput; successor: string | null; successorProse: string | null; dropped: string[] };

/**
 * The lifecycle row a bulletin earns for one part. Dates that are not YYYY-MM-DD are dropped and
 * named in `dropped`; a successor that is not a part number goes to successor_note only.
 */
export function lifecycleFor(b: Bulletin, successor: string | null, docId: string): LifecyclePlan {
  const dropped: string[] = [];
  const input: LifecycleInput = { status: "eol_announced", bulletin_id: b.doc_id ?? null, doc_id: docId, source_url: b.source_url, verified_at: b.verified_at && DATE_RX.test(b.verified_at) ? b.verified_at : null, tier: 2 };
  for (const c of DATE_COLS) {
    const v = b.lifecycle?.[c];
    if (v == null || v === "") continue;
    if (DATE_RX.test(v)) input[c] = v; else dropped.push(`${c}=${v}`);
  }
  let successorProse: string | null = null;
  if (successor) {
    if (isPartNumber(successor)) { input.successor_sku = successor; input.successor_note = `Nachfolger (Cisco): ${successor}`; }
    else { successorProse = successor; input.successor_note = successor.slice(0, 200); successor = null; }
  }
  return { input, successor, successorProse, dropped };
}

// ---- the gate ---------------------------------------------------------------------------------------
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2022-10-31" -> "October 31, 2022": the adapter's _iso, reversed. */
export function ciscoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function cachedBulletinText(url: string, cacheDir = CACHE_DIR): string | null {
  const f = path.join(cacheDir, `${crypto.createHash("sha1").update(url).digest("hex")}.html`);
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, "utf8").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export type LifecycleGate = {
  precision: number; recall: number; passed: boolean; sampled: number; misses: string[]; verdict: "pass" | "fail" | "unverified";
  bulletins: { sampled: number; checked: number; ok: number; wrong: number; recall_misses: number; unchecked: number };
  [extra: string]: unknown;
};

const DATE_IN_TEXT = new RegExp("(" + MONTHS.join("|") + ")\\s+(\\d{1,2}),\\s*(\\d{4})", "i");

/** One bulletin against its cached page: every recorded date and the id must be there; a dated milestone row the record lacks is a recall miss. */
export function auditBulletin(b: Bulletin, text: string): { ok: boolean; misses: string[]; recallMisses: string[] } {
  const t = text.toLowerCase();
  const misses: string[] = [];
  if (b.doc_id && !t.includes(b.doc_id.toLowerCase())) misses.push(`${b.doc_id}: bulletin id not on the page`);
  for (const c of DATE_COLS) {
    const v = b.lifecycle?.[c];
    if (!v || !DATE_RX.test(v)) continue;
    const spelled = ciscoDate(v);
    const [y, m, d] = v.split("-").map(Number);
    if (!new RegExp(`${MONTHS[m - 1]}\\s+${d},\\s*${y}`, "i").test(text)) misses.push(`${b.doc_id ?? b.source_url}: ${c}=${v} ("${spelled}") not on the page`);
  }
  const recallMisses: string[] = [];
  for (const [label, col] of MILESTONE_LABELS) {
    const at = t.indexOf(label);
    if (at < 0) continue;
    const window = text.slice(at, at + 400);
    const m = DATE_IN_TEXT.exec(window);
    if (m && !b.lifecycle?.[col]) recallMisses.push(`${b.doc_id ?? b.source_url}: page dates "${label}" (${m[0]}) but the record has no ${col}`);
  }
  return { ok: misses.length === 0, misses, recallMisses };
}

export function gateLifecycle(records: Bulletin[], sampleN: number, opts: { cacheDir?: string; random?: () => number } = {}): LifecycleGate {
  const rnd = opts.random ?? Math.random;
  const sample = [...records].sort(() => 0.5 - rnd()).slice(0, Math.max(0, sampleN));
  let checked = 0, ok = 0, wrong = 0, recallBad = 0, unchecked = 0;
  const misses: string[] = [];
  for (const b of sample) {
    const text = cachedBulletinText(b.source_url, opts.cacheDir);
    if (text === null) { unchecked++; continue; }
    checked++;
    const a = auditBulletin(b, text);
    if (a.ok) ok++; else { wrong++; misses.push(...a.misses.map((m) => `WRONG ${m}`)); }
    if (a.recallMisses.length) { recallBad++; misses.push(...a.recallMisses.map((m) => `RECALL_MISS ${m}`)); }
  }
  const precision = checked ? Number((ok / checked).toFixed(4)) : 0;
  const recall = checked ? Number(((checked - recallBad) / checked).toFixed(4)) : 0;
  let verdict: LifecycleGate["verdict"];
  if (sample.length > 0 && checked === 0) { verdict = "unverified"; misses.unshift(`UNVERIFIED: none of the ${sample.length} sampled bulletins has a cached page under ${opts.cacheDir ?? CACHE_DIR}`); }
  else if (sample.length === 0) { verdict = "unverified"; misses.unshift("UNVERIFIED: no bulletin to sample"); }
  else verdict = precision >= 0.98 && recall === 1 ? "pass" : "fail";
  return { precision, recall, passed: verdict === "pass", sampled: checked, misses: misses.slice(0, 40), verdict,
    bulletins: { sampled: sample.length, checked, ok, wrong, recall_misses: recallBad, unchecked } };
}

// ---- main -------------------------------------------------------------------------------------------
export type Args = { file: string | null; commit: boolean; sample: number; tag: string; vendor: string };
export function parseArgs(argv: string[]): Args {
  const out: Args = { file: null, commit: false, sample: 40, tag: "cisco", vendor: "cisco" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") out.commit = true;
    else if (a === "--sample") out.sample = Number(argv[++i]);
    else if (a === "--tag") out.tag = argv[++i] ?? "cisco";
    else if (a === "--vendor") out.vendor = argv[++i] ?? "cisco";
    else out.file = a;
  }
  return out;
}

export function loadBulletins(p: string): Bulletin[] {
  const abs = path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${p}`);
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as { bulletins?: Bulletin[]; records?: Bulletin[] };
  const raw = parsed.bulletins || parsed.records;
  if (!Array.isArray(raw)) throw new Error(`${p}: no "records" array — not a cisco-eol output file`);
  return raw.filter((b) => b && b.source_url && b.lifecycle);
}

export type Match = { partId: number; sku: string; b: Bulletin; plan: LifecyclePlan };

/** Walk every part of the vendor; a part matches when its core is in the bulletin index. */
export async function matchParts(vendor: string, idx: BulletinIndex, db: Queryable): Promise<{ matches: Match[]; scanned: number; matchedCores: Set<string> }> {
  const r = await db.query<{ id: number; sku: string }>("SELECT id, sku FROM parts WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1) ORDER BY id", [vendor]);
  const matches: Match[] = [];
  const matchedCores = new Set<string>();
  for (const p of r.rows) {
    const core = normPid(p.sku);
    if (!core) continue;
    const hit = idx.byCore.get(core);
    if (!hit) continue;
    matchedCores.add(core);
    const successor = resolveSuccessor(p.sku, hit.successor, idx);
    matches.push({ partId: p.id, sku: p.sku, b: hit.b, plan: lifecycleFor(hit.b, successor, docIdFor(hit.b.source_url)) });
  }
  return { matches, scanned: r.rowCount ?? 0, matchedCores };
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  if (!a.file) throw new Error("usage: ingest apply-lifecycle <cisco-eol.json> [--commit] [--sample N] [--tag T] [--vendor V]");
  const records = loadBulletins(a.file);
  const idx = indexBulletins(records);
  const pool = getPool();
  const { matches, scanned, matchedCores } = await matchParts(a.vendor, idx, pool);
  const gate = gateLifecycle(records, a.sample);

  const stats: Record<string, number> = {
    bulletins: records.length, pid_rows: idx.pidRows, distinct_pids: idx.byCore.size, parts_scanned: scanned, matched: matches.length,
    pids_not_in_catalogue: idx.byCore.size - matchedCores.size,
    successors: matches.filter((m) => m.plan.successor).length, successors_prose_rejected: matches.filter((m) => m.plan.successorProse).length,
    dates_dropped_malformed: matches.reduce((n, m) => n + m.plan.dropped.length, 0),
    docs_written: 0, lifecycle_incoming: 0, lifecycle_existing_kept: 0, relations: 0,
  };
  const perBulletin = new Map<string, number>();
  for (const m of matches) perBulletin.set(m.b.doc_id ?? m.b.source_url, (perBulletin.get(m.b.doc_id ?? m.b.source_url) ?? 0) + 1);

  // the enumeration feed: bulletin PIDs with no part of ours
  const missing = [...idx.byCore.entries()].filter(([core]) => !matchedCores.has(core)).map(([core, x]) => ({ core, bulletin: x.b.doc_id, url: x.b.source_url }));
  fs.mkdirSync(path.join(REPO_ROOT, "runs", "reports"), { recursive: true });
  const missingFile = path.join(REPO_ROOT, "runs", "reports", `eol-pids-not-in-catalogue-${a.tag}-${new Date().toISOString().slice(0, 10)}.jsonl`);
  fs.writeFileSync(missingFile, missing.map((m) => JSON.stringify(m)).join("\n") + (missing.length ? "\n" : ""));

  let runId: number | null = null;
  if (a.commit) {
    const abs = path.isAbsolute(a.file) ? a.file : path.join(REPO_ROOT, a.file);
    const out = await withRun("apply-lifecycle", { file: hashFile(abs), commit: true, sample: a.sample, vendor: a.vendor }, async (id) => {
      if (!gate.passed) throw new Error(`gate did not pass (${gate.verdict}): ${JSON.stringify(gate)}`);
      const docsDone = new Set<string>();
      for (const m of matches) {
        if (!docsDone.has(m.b.source_url)) {
          await ensureSourceDoc({ url: m.b.source_url, doc_type: "vendor_eol_bulletin", vendor: a.vendor, title: m.b.doc_id, doc_class: "eol_bulletin",
            fetched_at: m.b.verified_at && DATE_RX.test(m.b.verified_at) ? m.b.verified_at : null, cache_path: `${crypto.createHash("sha1").update(m.b.source_url).digest("hex")}.html` }, pool);
          docsDone.add(m.b.source_url); stats.docs_written++;
        }
        await withTx(async (client) => {
          const r = await upsertLifecycle(m.partId, m.plan.input, id, client);
          if (r.winner === "incoming") stats.lifecycle_incoming++; else stats.lifecycle_existing_kept++;
          if (m.plan.successor) {
            await upsertRelation(m.partId, { to_sku: m.plan.successor, kind: "successor", tier: 2, doc_id: m.plan.input.doc_id, source_url: m.b.source_url, note: `Cisco EoL bulletin ${m.b.doc_id ?? ""}`.trim() }, id, client);
            stats.relations++;
          }
        });
      }
      return { stats, gate, notes: `file=${path.basename(abs)}; bulletins=${records.length}` };
    });
    runId = out.runId;
  }

  console.log(`${a.commit ? "COMMITTED run " + runId : "DRY RUN — no writes"}   ${path.basename(a.file)}`);
  console.table(stats);
  console.log("per-bulletin matched parts (top 10):");
  for (const [d, n] of [...perBulletin.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)) console.log(`  ${d}: ${n}`);
  console.log(`bulletin PIDs not in the catalogue: ${missing.length} -> ${path.relative(REPO_ROOT, missingFile)}`);
  console.log(`gate: ${gate.verdict.toUpperCase()} precision ${(gate.precision * 100).toFixed(1)}% recall ${(gate.recall * 100).toFixed(1)}% (${gate.bulletins.checked} of ${gate.bulletins.sampled} sampled bulletins re-read, ${gate.bulletins.unchecked} without cache)`);
  for (const m of gate.misses.slice(0, 20)) console.log(`  ${m}`);
  await closePool();
  if (!gate.passed) process.exitCode = 1;
}

if (process.argv[1] && /apply-lifecycle\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
