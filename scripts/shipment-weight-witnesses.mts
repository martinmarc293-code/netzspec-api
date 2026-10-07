// scripts/shipment-weight-witnesses.mts — the witness table for MODULE SHIPMENT WEIGHTS read by DESCRIPTION (reviewer, 7 Oct 2026, W1).
//
//     npx tsx scripts/shipment-weight-witnesses.mts            # (re)write data/reference/shipment-weight-witnesses.json
//     npx tsx scripts/shipment-weight-witnesses.mts --check    # regenerate and compare; exit 1 on any difference
//
// The ruling, verbatim (W1, ~18:35): "Q3 goes first: A900, NCS 4200 and N560 modules whose sheet prints a shipment weight take that
// value. For the rest: routers/module = the smallest tier >= 3.1 kg, with that basis recorded."
//
// THE SHAPE. The ASR 900, NCS 4200 and NCS 560 interface-module sheets print one list, "Module shipment weight ● 8-port gigabit
// ethernet sfp: 2.18 lbs ● ...", keyed by a DESCRIPTION, never by PID. A description reaches a PID only through the SAME sheet's
// ordering table: each PID's own ordering row ("A900-IMA8S ASR 900 8 port SFP Gigabit Ethernet Interface Module") is required on the
// page beside the statement, and the pairing below is read one by one, never matched by words. A statement with no unambiguous
// ordering row is left out and named: A900-IMA8T1Z (no RJ-45 + SFP+ combo line), NCS4200-2H-PK / -2H-PQ (the sheet's line is
// "1-port 100 gigabit ethernet qsfp28" for a 2-port PID). A spare the ordering table prints beside its base is the same module in
// the same package, so it takes the same row (it is still written only where the sheet is linked to it -- the writer asks).
//
// Written by scripts/derive-max-bound-weight.mts --set shipment-row as derived:family-row under the cup shipping_weight (a value the
// sheet states for a described module family, onto the PIDs its ordering table lists under that description).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "../src/store/index.js";
import { cachedText, CACHE_DIR, ws } from "../src/pipeline/apply-acquired.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/reference/shipment-weight-witnesses.json");
const CACHE = process.env.CACHE_DIR ?? CACHE_DIR;
const A900 = "https://www.cisco.com/c/en/us/products/collateral/routers/asr-903-series-aggregation-services-routers/datasheet-c78-738338.html";
const N4200 = "https://www.cisco.com/c/en/us/products/collateral/optical-networking/network-convergence-system-4200-series/datasheet-c78-738105.html";
const N560 = "https://www.cisco.com/c/en/us/products/collateral/routers/network-convergence-system-560-series-routers/datasheet-c78-740295.html";
const LABEL = "Module shipment weight";

/** One description row of a sheet's shipment-weight list, and the PIDs whose OWN ordering row on the same sheet it describes. */
type Source = { url: string; description: string; raw: string; pids: { sku: string; ordering: string }[] };
const S = (url: string, description: string, raw: string, ...pids: [string, string][]): Source =>
  ({ url, description, raw, pids: pids.flatMap(([sku, ordering]) => [{ sku, ordering }, { sku: `${sku}=`, ordering: `${sku}= ${ordering.slice(sku.length + 1)}` }]) });
export const SOURCES: Source[] = [
  S(A900, "8-port gigabit ethernet sfp", "2.18 lbs", ["A900-IMA8S", "a900-ima8s asr 900 8 port sfp gigabit ethernet interface module"]),
  // "10/100/1000" is the copper (RJ-45) gigabit port: the sheet's only 8-port RJ-45 line
  S(A900, "8-port gigabit ethernet rj45", "2.15 lbs", ["A900-IMA8T", "a900-ima8t asr 900 combo 8 port 10/100/1000 interface module"]),
  S(A900, "8-port gigabit ethernet sfp and 1-port 10 gigabit ethernet sfp+", "3.4 lbs", ["A900-IMA8S1Z", "a900-ima8s1z asr 900 combo 8 port sfp ge and 1 port 10ge sfp+ interface module"]),
  S(A900, "2-port 10 gigabit ethernet, sfp+/xfp", "1.8 lbs", ["A900-IMA2Z", "a900-ima2z asr 900 2 port 10ge xfp/sfp+ interface module"]),
  S(A900, "8-port 10 gigabit ethernet sfp/sfp+", "3.8 lbs", ["A900-IMA8Z", "a900-ima8z asr 900 8 port 10ge sfp+ interface module"]),
  S(A900, "2-port 40 gigabit ethernet qsfp", "2.55 lbs", ["A900-IMA2F", "a900-ima2f asr 900 2 port 40ge qsfp interface module"]),
  S(N4200, "8-port gigabit ethernet sfp and 1-port 10 gigabit ethernet sfp+", "3.4 lbs", ["NCS4200-1T8LR-PS", "ncs4200-1t8lr-ps ncs 4200 combo 8 port sfp ge and 1 port 10ge sfp+ im"]),
  S(N4200, "8-port 1/10 gigabit ethernet sfp/sfp+", "3.8 lbs", ["NCS4200-8T-PS", "ncs4200-8t-ps ncs 4200 8-port 10ge sfp+ interface module"]),
  S(N4200, "2-port 40 gigabit ethernet qsfp", "2.55 lbs", ["NCS4200-2Q-P", "ncs4200-2q-p ncs 4200 2-port 40ge qsfp interface module"]),
  S(N560, "8-port 10 ge, sfp+ ethernet only", "1.82 lbs", ["A900-IMA-8Z-L", "a900-ima-8z-l ncs 560 8 port sfp+ 10 ge ethernet only interface module"]),
  S(N560, "8-port 10 gigabit ethernet sfp+", "3.8 lbs", ["A900-IMA-8Z", "a900-ima-8z ncs 560 8 port sfp+ 10 gigabit ethernet interface module"]),
  S(N560, "2-port 40/100 gigabit ethernet qsfp28", "2.55 lbs", ["N560-IMA-2C", "n560-ima-2c ncs 560 2 port qsfp28 100 gigabit ethernet interface module"]),
  S(N560, "2-port 100 gigabit ethernet, qsfp28/ qsfp-dd", "2.14 lbs", ["N560-IMA-2C-DD", "n560-ima-2c-dd ncs 560 2 port qsfp28/ qsfp-dd 100 gigabit ethernet interface module"]),
];

const db = getPool();
const rows: Record<string, unknown>[] = [];
const refused: string[] = [];
for (const s of SOURCES) {
  const d = (await db.query<{ doc_id: string; doc_type: string; cache_path: string }>(`SELECT doc_id, doc_type::text AS doc_type, cache_path FROM source_docs WHERE url = $1`, [s.url])).rows[0];
  if (!d) { refused.push(`${s.url}: not a source document`); continue; }
  const text = cachedText(d.cache_path, CACHE);
  if (text === null) { refused.push(`${d.doc_id}: not readable from the cache`); continue; }
  const statement = `${s.description}: ${s.raw}`;
  if (!text.includes(ws(LABEL)) || !text.includes(ws(statement))) { refused.push(`${d.doc_id}: does not print "${LABEL}" / "${statement}"`); continue; }
  for (const p of s.pids) {
    // the ordering row binds the description to the PID: absent (a spare the sheet does not print), the PID is simply not a row
    if (!text.includes(ws(p.ordering))) { if (!p.sku.endsWith("=")) refused.push(`${d.doc_id}: no ordering row "${p.ordering}"`); continue; }
    rows.push({ sku: p.sku, doc_id: d.doc_id, url: s.url, cache_path: d.cache_path, doc_type: d.doc_type, label: LABEL, key: "shipping_weight",
      locator: `${LABEL}: ${s.description}`, raw: s.raw, statement, ordering: p.ordering });
  }
}
await closePool();
if (refused.length) { console.error(`REFUSED:\n  ${refused.join("\n  ")}`); process.exit(2); }
rows.sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
const body = JSON.stringify({ generated_by: "scripts/shipment-weight-witnesses.mts", ruling: "reviewer W1, 7 Oct 2026 ~18:35 (Q3 first)", rows }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
  if (old !== body) { console.error(`DIFFERS from ${path.relative(ROOT, OUT)}`); process.exit(1); }
  console.log(`same: ${rows.length} rows`); process.exit(0);
}
fs.writeFileSync(OUT, body);
console.log(`${rows.length} shipment-weight rows over ${SOURCES.length} description rows -> ${path.relative(ROOT, OUT)}`);
for (const r of rows) console.log(`  ${String(r.sku).padEnd(20)} ${r.raw}  (${r.locator})`);
