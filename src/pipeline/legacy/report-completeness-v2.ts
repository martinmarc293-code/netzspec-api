// scripts/universe/report-completeness-v2.ts — WP2/WP6 reporting + the gap ledger.
//
//   npx tsx scripts/universe/report-completeness-v2.ts
//   npx tsx scripts/universe/report-completeness-v2.ts --vendor cisco --category switches
//   npx tsx scripts/universe/report-completeness-v2.ts --gaps --top 15
//
// completeness_v2 is required_present / required_total where required_total is computed PER PART
// from that part's own values, so a DIN-rail L2 switch is not marked down for lacking rack units
// or IPv4 routes. The gap ledger names every missing required field and how many SKUs it is
// missing on — the thing that did not exist before WP1 and without which "no gaps" is unprovable.
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { completenessV2, PROFILES, FIELD_DICTIONARY } from "../../core/fieldSchema.js";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const VENDOR = arg("--vendor"), CATEGORY = arg("--category");
const GAPS = process.argv.includes("--gaps");
const TOP = parseInt(arg("--top") || "12", 10);

const root = process.cwd();
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

// Which source is expected to close each field. Drives the "expected source" column of the gap
// ledger, so a gap is actionable rather than merely counted.
const EXPECTED_SOURCE: Record<string, string> = {
  ports: "datasheet ordering table (shape A) + a ports struct parser",
  uplink_ports: "datasheet ordering table (shape A) + a ports struct parser",
  mac_table: "datasheet scale table (shape B) via WP5 inheritance",
  ipv4_routes: "datasheet scale table (shape B) via WP5 inheritance",
  ipv6_routes: "datasheet scale table (shape B) via WP5 inheritance",
  packet_buffer: "datasheet scale table (shape B) via WP5 inheritance",
  jumbo_mtu: "datasheet scale table (shape B) via WP5 inheritance",
  flash: "datasheet scale table (shape B) via WP5 inheritance",
  dram: "datasheet general-specifications table",
  vlan_max: "datasheet scale table (shape B)",
  temp_operating: "datasheet environmental-ranges section (shape C)",
  temp_storage: "datasheet environmental-ranges section (shape C)",
  humidity_operating: "datasheet environmental-ranges section (shape C)",
  altitude_max: "datasheet environmental-ranges section (shape C)",
  heat_dissipation: "datasheet power table",
  input_voltage: "datasheet power-supply section",
  certifications: "datasheet regulatory-compliance section",
  ieee_standards: "datasheet standards section (shape B)",
  mgmt_ports: "datasheet ordering/console section",
  psu_redundant: "datasheet power-supply table",
  cooling: "datasheet general specifications",
  series: "derivable from family; no external source needed",
  vendor: "already held on the part record (identity)",
};

async function main() {
  const client = new MongoClient(env.MONGODB_URI as string, {
    serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000, retryReads: true,
  });
  await client.connect();
  const P = client.db(env.MONGODB_DB as string).collection("parts");
  const q: Record<string, unknown> = {};
  if (VENDOR) q.vendor = VENDOR;
  if (CATEGORY) q.category = CATEGORY;

  const buckets: Record<string, number[]> = {};
  const missingCount: Record<string, Record<string, number>> = {};
  const noProfile: Record<string, number> = {};
  let n = 0, atLeast40 = 0, atLeast20 = 0;

  const cursor = P.find(q, { projection: { _id: 0, sku: 1, vendor: 1, category: 1, specs_v2: 1 } }).batchSize(200);
  for await (const p of cursor) {
    n++;
    const cat = String(p.category || "");
    const values: Record<string, unknown> = {};
    for (const s of (p.specs_v2 as { k: string; value: unknown }[]) || []) values[s.k] = s.value;
    const c = completenessV2(cat, values);
    if (c.no_profile) { noProfile[cat] = (noProfile[cat] || 0) + 1; continue; }
    (buckets[cat] ||= []).push(c.required_present);
    if (c.required_present >= 40) atLeast40++;
    if (c.required_present >= 20) atLeast20++;
    const mm = (missingCount[cat] ||= {});
    for (const k of c.missing) mm[k] = (mm[k] || 0) + 1;
  }
  await client.close();

  console.log(`scope: ${VENDOR || "all vendors"} / ${CATEGORY || "all categories"} — ${n} parts\n`);
  for (const [cat, arr] of Object.entries(buckets)) {
    const v = arr.sort((a, b) => a - b);
    const sum = v.reduce((a, b) => a + b, 0);
    const pc = (q: number) => v[Math.min(v.length - 1, Math.floor((v.length - 1) * q))];
    const prof = PROFILES[cat] ? Object.keys(PROFILES[cat]).length : 0;
    console.log(`${cat}: n=${v.length} (profile has ${prof} fields)`);
    console.log(`  required-present  min=${v[0]}  p50=${pc(0.5)}  mean=${(sum / v.length).toFixed(1)}  p90=${pc(0.9)}  max=${v[v.length - 1]}`);
  }
  for (const [cat, cnt] of Object.entries(noProfile)) {
    console.log(`${cat}: ${cnt} parts EXCLUDED — no category profile (never scored 0/0 = 100%)`);
  }
  console.log(`\nparts with >= 40 required fields present: ${atLeast40}`);
  console.log(`parts with >= 20 required fields present: ${atLeast20}`);

  if (GAPS) {
    console.log(`\n=== GAP LEDGER — widest gaps, with the source expected to close each ===`);
    for (const [cat, mm] of Object.entries(missingCount)) {
      console.log(`\n[${cat}]`);
      const rows = Object.entries(mm).sort((a, b) => b[1] - a[1]).slice(0, TOP);
      for (const [k, c] of rows) {
        const t = FIELD_DICTIONARY[k]?.type ?? "?";
        console.log(`  ${k.padEnd(22)} missing on ${String(c).padStart(5)} SKUs  [${t}]  <- ${EXPECTED_SOURCE[k] || "UNASSIGNED SOURCE — needs a decision"}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
