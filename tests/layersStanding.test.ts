// tests/layersStanding.test.ts — the layers reviewer's STANDING checks (round 2, 14 Sep 2026), run over the built rows of the
// categories that have passed review (data/layers/cisco-<category>.rows.tsv, written by scripts/build-layers.mts).
//
//   A.1  the spare inherits the base: X and X= carry the same series, kind, bucket and plan. Exceptions are listed by SKU
//        with the reason, so a new disagreement cannot hide inside a count.
//   A.2  every not-this-category row carries a plan: the built summary holds 0 rows in that bucket.
//   A.4  no row of these categories is a pack or a heterogeneous set kept under a device kind (the bundle rule's witnesses).
//
//   npx tsx tests/layersStanding.test.ts
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";

const REVIEWED = ["switches", "routers"];
// A.1 exceptions, each read against the built row, with the reason the pair legitimately differs.
const PAIR_EXCEPTIONS: Record<string, string> = {
  "switches|N5K-C5696Q-C": "the spare row is named '^Invalid SKU' and carries a class non_product plan; its base is the live 'Nexus 5696Q Chassis with license and SW image'",
};

let passed = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };

type Row = Record<string, string>;
function readRows(cat: string): Row[] {
  const p = path.join(REPO_ROOT, "data", "layers", `cisco-${cat}.rows.tsv`);
  const lines = fs.readFileSync(p, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
}

/** The pair disagreements of one category: base X and spare X= that differ on series, kind, bucket or plan. */
export function pairDisagreements(rows: Row[]): { sku: string; fields: string[] }[] {
  const by = new Map(rows.map((r) => [r.sku.trim().toUpperCase(), r]));
  const out: { sku: string; fields: string[] }[] = [];
  for (const [k, spare] of by) {
    if (!k.endsWith("=")) continue;
    const base = by.get(k.replace(/=+$/, ""));
    if (!base) continue;
    const fields = ["series", "kind", "bucket", "plan"].filter((f) => (base[f] ?? "") !== (spare[f] ?? ""));
    if (fields.length) out.push({ sku: base.sku, fields });
  }
  return out;
}

for (const cat of REVIEWED) {
  const rows = readRows(cat);
  check(`${cat}: the built rows are not empty`, rows.length > 1000, `${rows.length} rows`);
  const dis = pairDisagreements(rows).filter((d) => !PAIR_EXCEPTIONS[`${cat}|${d.sku}`]);
  check(`A.1 ${cat}: 0 base/spare pairs disagree on series, kind, bucket or plan`, dis.length === 0, dis.slice(0, 8).map((d) => `${d.sku} [${d.fields.join(",")}]`).join("; "));
  for (const k of Object.keys(PAIR_EXCEPTIONS).filter((x) => x.startsWith(`${cat}|`))) {
    const sku = k.split("|")[1];
    check(`A.1 ${cat}: the recorded exception ${sku} still exists and still disagrees (a stale exception is a hole)`,
      pairDisagreements(rows).some((d) => d.sku === sku));
  }
  const ntc = rows.filter((r) => r.bucket === "not_this_category");
  check(`A.2 ${cat}: every not-this-category row carries a plan (0 left in the bucket)`, ntc.length === 0, ntc.slice(0, 8).map((r) => r.sku).join(", "));
  const unplaced = rows.filter((r) => r.bucket === "unplaced");
  check(`${cat}: 0 unplaced rows`, unplaced.length === 0, unplaced.slice(0, 8).map((r) => r.sku).join(", "));
}

// A.4 on the built rows: the bundle rule's witnesses are `bundle` on the page, not only in the function.
{
  const sw = new Map(readRows("switches").map((r) => [r.sku, r]));
  const rt = new Map(readRows("routers").map((r) => [r.sku, r]));
  for (const sku of ["N5548UPM-4FEX", "N3K-C3172TQ-10PK", "C4500E-7R-S8E-UPOE", "ACI-C9336-B3-EAL"]) check(`A.4 switches page: ${sku} is bundle`, sw.get(sku)?.kind === "bundle", `got ${sw.get(sku)?.kind}`);
  for (const sku of ["CRS-16-FC140/M-8P", "ASR1000-RP3-32G-2P", "ISR4330U-MEM-MSATA"]) check(`A.4 routers page: ${sku} is bundle`, rt.get(sku)?.kind === "bundle", `got ${rt.get(sku)?.kind}`);
}

// SABOTAGE: the pair check must see a disagreement when one is planted.
{
  const planted: Row[] = [{ sku: "ZZ-TEST-1", series: "A", kind: "switch", bucket: "layered", plan: "" }, { sku: "ZZ-TEST-1=", series: "A", kind: "mechanical", bucket: "layered", plan: "" }];
  const got = pairDisagreements(planted);
  check("SABOTAGE a planted base/spare kind split is reported, naming the field", got.length === 1 && got[0].fields.join() === "kind", JSON.stringify(got));
}

console.log(`    layers standing: ${passed} passed, ${misses.length} missed (${REVIEWED.join(", ")})`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
