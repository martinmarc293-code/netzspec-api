// scripts/link-printed-pids.mts — link a part to a cached Cisco spec page that PRINTS its PID (reviewer ruling (C), 7 Oct 2026).
//
//     npx tsx scripts/link-printed-pids.mts [--category routers] [--commit]
//
// WHY: doc_parts is written only from the extractor's attributed PID list (apply-extract linkDocParts(d.doc_id, d.parts)), so a
// PID printed elsewhere on a page is never linked and no reader ever looks for it. The 7 Oct census
// (docs/reviewer/2026-09-28/eol-sample-2026-10-07.md): of 3,084 routers hardware parts with no spec document linked, 719 are printed
// on a cached Cisco spec page -- 265 of the 300 that had no document at all.
//
// THE RULING (verbatim): "(C): yes, class A, with three conditions. Token boundaries: an exact match only, so C8200-1N-4T must not
// link from C8200-1N-4T= or C8200-1N-4T-xx, and the reverse. Sample before the reader reads: after derive-link-provenance, send me
// 20 random new spec_for_kind links and 10 mention links with the line each token sits on." The third (the 736 missing cache files)
// is answered: they were Juniper/HPE/Aruba pages; Cisco holds 0 missing of 2,455.
//
// POPULATION: live Cisco hardware parts of the category with NO spec document linked today; pages = Cisco spec documents
// (datasheet html, vendor_page, vendor_tool, vendor_guide) whose cached html is readable. A cached PDF has no text here: counted
// as could-not-check. The link is written with link_basis / doc_relevance NULL -- derive-link-provenance decides them next, from
// the page (explicit when the SKU is on it; spec_for_kind only when the page prints >= 3 of the part's kind cups).
//
// GATE: every planned link re-found by the SECOND implementation (printedAt, explicit lookarounds) on the same text; recall = the
// lookaround search over the same pages and parts must find no link the token plan missed. Both must be exact.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPool, closePool, withRun, withTx, linkDocParts } from "../src/store/index.js";
import { cachedText, CACHE_DIR } from "../src/pipeline/apply-acquired.js";
import { planFile as planFileAt } from "../src/core/planFile.js";
import { pageTokens, pidKey, printedAt } from "../src/core/printedPid.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const commit = process.argv.includes("--commit");
const CATEGORY = arg("--category") ?? "routers";
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
const SPEC = ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_page", "vendor_tool", "vendor_guide"];

type Link = { doc_id: string; doc_type: string; part_id: number; sku: string; at: string };
const db = getPool();
async function plan() {
  const parts = (await db.query<{ id: number; sku: string }>(`
    SELECT p.id, p.sku FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
     WHERE v.slug = 'cisco' AND c.slug = $1 AND p.retired_at IS NULL AND p.product_class = 'hardware'
       AND NOT EXISTS (SELECT 1 FROM doc_parts dp JOIN source_docs sd ON sd.doc_id = dp.doc_id WHERE dp.part_id = p.id AND sd.doc_type::text = ANY($2::text[]))`,
    [CATEGORY, SPEC])).rows;
  const byKey = new Map<string, { id: number; sku: string }[]>();
  let keyless = 0;
  for (const p of parts) { const k = pidKey(p.sku); if (!k) { keyless++; continue; } if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(p); }
  const docs = (await db.query<{ doc_id: string; t: string; cache_path: string }>(`
    SELECT sd.doc_id, sd.doc_type::text t, sd.cache_path FROM source_docs sd JOIN vendors v ON v.id = sd.vendor_id
     WHERE v.slug = 'cisco' AND sd.doc_type::text = ANY($1::text[]) AND sd.cache_path IS NOT NULL ORDER BY sd.doc_id`, [SPEC])).rows;
  const links: Link[] = [];
  let read = 0, pdf = 0, missing = 0, gateHits = 0, tokPairs = 0, gateMiss: string[] = [], recallExtra: string[] = [];
  for (const d of docs) {
    if (!d.cache_path.endsWith(".html")) { pdf++; continue; }
    const text = cachedText(d.cache_path, CACHE);
    if (text === null) { missing++; continue; }
    read++;
    const toks = pageTokens(text);
    for (const [k, ps] of byKey) {
      const tok = toks.has(k);
      // the second implementation, asked on EVERY (page, key): agreement both ways is the gate (precision and recall)
      const at = text.includes(k) ? printedAt(text, k) : -1;
      if (tok && at < 0) gateMiss.push(`${d.doc_id} ${k}: token found, lookaround not`);
      if (!tok && at >= 0) recallExtra.push(`${d.doc_id} ${k}: lookaround found, token not`);
      if (!tok) continue;
      tokPairs++;
      if (at >= 0) gateHits++;
      for (const p of ps) links.push({ doc_id: d.doc_id, doc_type: d.t, part_id: p.id, sku: p.sku, at: at >= 0 ? text.slice(Math.max(0, at - 90), at + k.length + 90) : "" });
    }
  }
  return { parts: parts.length, keyless, docs: docs.length, read, pdf, missing, links, gateHits, tokPairs, gateMiss, recallExtra };
}

const P = await plan();
const tokenLinks = P.links.length;
const precision = P.tokPairs ? P.gateHits / P.tokPairs : 1;
const gate = { method: "every token link re-found on the same page by printedAt (explicit lookarounds); recall = the lookaround search over every (page, part) finds nothing the token plan missed",
  sampled: tokenLinks, checked: tokenLinks, unreadable: P.missing, precision: Number(precision.toFixed(4)),
  recall: P.recallExtra.length ? Number((P.tokPairs / (P.tokPairs + P.recallExtra.length)).toFixed(4)) : 1,
  passed: P.gateMiss.length === 0 && P.recallExtra.length === 0 && P.missing === 0, misses: [...P.gateMiss, ...P.recallExtra].slice(0, 12) };

const planPath = planFileAt(ROOT, "link-printed-pids");
fs.mkdirSync(path.dirname(planPath), { recursive: true });
fs.writeFileSync(planPath, ["doc_id\tdoc_type\tpart_id\tsku\tline", ...P.links.map((l) => `${l.doc_id}\t${l.doc_type}\t${l.part_id}\t${l.sku}\t${JSON.stringify(l.at)}`)].join("\n") + "\n");
const planSha = createHash("sha256").update(fs.readFileSync(planPath)).digest("hex");
const partsLinked = new Set(P.links.map((l) => l.part_id)).size;
const byType: Record<string, number> = {}; for (const l of P.links) byType[l.doc_type] = (byType[l.doc_type] ?? 0) + 1;
const spares = new Set(P.links.filter((l) => l.sku.endsWith("=")).map((l) => l.part_id)).size;
console.log(`link-printed-pids (${CATEGORY}): ${P.parts} parts with no spec document (${P.keyless} with no matchable key); ${P.docs} Cisco spec docs, html read ${P.read}, ` +
  `pdf not read ${P.pdf} (could not check), cache missing ${P.missing}; ${tokenLinks} links to write on ${partsLinked} parts (${partsLinked - spares} bases + ${spares} spares) by doc type ${JSON.stringify(byType)}`);
console.log(`gate ${JSON.stringify(gate)} -> ${path.relative(ROOT, planPath)} (sha256 ${planSha.slice(0, 12)})`);
if (!gate.passed) { console.error("GATE FAILED, nothing written"); await closePool(); process.exit(2); }
if (!commit) { console.log("DRY RUN: nothing written. Re-run with --commit."); await closePool(); process.exit(0); }
if (!tokenLinks) { console.log("nothing to do"); await closePool(); process.exit(0); }

let gitSha: string | undefined = process.env.GIT_SHA;
if (!gitSha) try { gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { gitSha = undefined; }
const out = await withRun("link-printed-pids", {
  category: CATEGORY, planned: tokenLinks, parts: partsLinked, plan: path.relative(ROOT, planPath), plan_sha256: planSha,
  approved: "reviewer ruling 7 Oct 2026 (C): 'yes, class A, with three conditions. Token boundaries: an exact match only, so C8200-1N-4T must not link from " +
    "C8200-1N-4T= or C8200-1N-4T-xx, and the reverse. Sample before the reader reads: after derive-link-provenance, send me 20 random new spec_for_kind links " +
    "and 10 mention links with the line each token sits on.' (the 736 missing cache files: other vendors' pages; Cisco 0 of 2,455)",
}, async (runId) => withTx(async (client) => {
  const byDoc = new Map<string, number[]>();
  for (const l of P.links) { if (!byDoc.has(l.doc_id)) byDoc.set(l.doc_id, []); byDoc.get(l.doc_id)!.push(l.part_id); }
  let inserted = 0;
  for (const [d, ids] of byDoc) inserted += await linkDocParts(d, ids, client);
  // every planned link is NEW by construction (the part had no spec document): an insert count short of the plan means the store
  // and the plan disagree -- roll back
  if (inserted !== tokenLinks) throw new Error(`link-printed-pids: planned ${tokenLinks} links, inserted ${inserted}`);
  void runId;
  return { stats: { links_inserted: inserted, parts: partsLinked, docs: byDoc.size, pdf_not_read: P.pdf }, gate };
}), { gitSha });
const again = await plan();
console.log(`COMMITTED run ${out.runId}: ${JSON.stringify(out.stats)}; re-plan after the write finds ${again.links.length}`);
if (again.links.length) { console.error("the write did not take"); process.exitCode = 1; }
await closePool();
