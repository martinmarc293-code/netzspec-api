// tests/layersStanding.test.ts — the layers reviewer's STANDING checks over every category that has passed review, run on the built
// rows (data/layers/cisco-<category>.rows.tsv) and the mapping files. The checks live in src/core/layerChecks.ts.
//
//   spare = base · plan coverage · twins · leakage (cross-claims, against data/reference/layers-cross-claims.json) · rule shadowing ·
//   the page names its commit.
//
//   npx tsx tests/layersStanding.test.ts
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { readLayerRows, pairDisagreements, twinGroups, crossClaims, ruleUse, classifyRules, incomingRows, type LayerRow } from "../src/core/layerChecks.js";

export const REVIEWED = ["switches", "routers"];
// spare = base exceptions, each read against the built row
const PAIR_EXCEPTIONS: Record<string, string> = {
  "switches|N5K-C5696Q-C": "the spare row is named '^Invalid SKU' and carries a class non_product plan; its base is the live 'Nexus 5696Q Chassis with license and SW image'",
};

let passed = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };

const CATS = fs.readdirSync(path.join(REPO_ROOT, "data", "reference", "product-lines")).map((f) => f.replace(/^cisco-|\.json$/g, ""));
const PLANS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "kind-layer-plans-2026-09-13.json"), "utf8"));
type Allowed = { category: string; claimed_by: string; series: string; rule: string; rows: number; status: string; reason: string };
const ALLOW = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "layers-cross-claims.json"), "utf8")) as { entries: Allowed[] }).entries;
const STATUSES = new Set(["claimant-rule-too-broad", "decided-home", "pending-round"]);

for (const cat of REVIEWED) {
  const rows = readLayerRows(cat);
  check(`${cat}: the built rows are not empty`, rows.length > 1000, `${rows.length} rows`);

  const dis = pairDisagreements(rows).filter((d) => !PAIR_EXCEPTIONS[`${cat}|${d.sku}`]);
  check(`spare=base ${cat}: 0 base/spare pairs disagree on series, kind, bucket or plan`, dis.length === 0, dis.slice(0, 8).map((d) => `${d.sku} [${d.fields.join(",")}]`).join("; "));
  for (const k of Object.keys(PAIR_EXCEPTIONS).filter((x) => x.startsWith(`${cat}|`)))
    check(`spare=base ${cat}: the recorded exception ${k.split("|")[1]} still disagrees (a stale exception is a hole)`, pairDisagreements(rows).some((d) => d.sku === k.split("|")[1]));

  const ntc = rows.filter((r) => r.bucket === "not_this_category"), unplaced = rows.filter((r) => r.bucket === "unplaced");
  check(`plan coverage ${cat}: every not-this-category row carries a plan (0 left in the bucket)`, ntc.length === 0, ntc.slice(0, 8).map((r) => r.sku).join(", "));
  check(`plan coverage ${cat}: 0 unplaced rows`, unplaced.length === 0, unplaced.slice(0, 8).map((r) => r.sku).join(", "));

  const twins = twinGroups(rows);
  check(`twins ${cat}: no two rows fold (case, whitespace) to one SKU`, twins.length === 0, twins.slice(0, 5).map((g) => g.join(" / ")).join("; "));

  const claims = crossClaims(cat, rows, CATS);
  const allowed = ALLOW.filter((a) => a.category === cat);
  for (const g of claims) {
    const a = allowed.find((x) => x.claimed_by === g.claimed_by && x.series === g.series && x.rule === g.rule);
    check(`leakage ${cat}: ${g.rows} row(s) also claimed by ${g.claimed_by} / ${g.series} (${g.rule}) are recorded with that exact count`,
      !!a && a.rows === g.rows, a ? `recorded ${a.rows}, measured ${g.rows}` : `not recorded — e.g. ${g.examples.join(", ")}`);
  }
  for (const a of allowed) {
    check(`leakage ${cat}: recorded group ${a.claimed_by} / ${a.series} still exists (a stale entry is a hole)`, claims.some((g) => g.claimed_by === a.claimed_by && g.series === a.series && g.rule === a.rule));
    check(`leakage ${cat}: recorded group ${a.claimed_by} / ${a.series} has a known status and a reason`, STATUSES.has(a.status) && a.reason.length > 40);
  }

  const { dead, redundant, shadowed } = classifyRules(ruleUse(cat, rows, incomingRows(cat, CATS, PLANS)));
  check(`rule shadowing ${cat}: 0 dead SKU rules (a rule that matches no row nor any row planned in)`, dead.length === 0, dead.map((u) => `${u.series} :: ${u.rule}`).join("; "));
  check(`rule shadowing ${cat}: 0 redundant SKU rules (every match decided by another rule of the same series)`, redundant.length === 0, redundant.map((u) => `${u.series} :: ${u.rule}`).join("; "));
  check(`rule shadowing ${cat}: 0 SKU rules losing their matches to another series`, shadowed.length === 0, shadowed.map((u) => `${u.series} :: ${u.rule} ${JSON.stringify(u.lost_to)}`).join("; "));

  const summary = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "layers", `cisco-${cat}.json`), "utf8"));
  check(`provenance ${cat}: the built page names its commit`, typeof summary.commit === "string" && /^[0-9a-f]{40}$/.test(summary.commit), `commit ${summary.commit}`);
  check(`provenance ${cat}: the page lists its uncommitted rule files (an array, possibly empty)`, Array.isArray(summary.uncommitted_rule_files));
}

// A.4 on the built rows: the bundle rule's witnesses are `bundle` on the page, not only in the function.
{
  const sw = new Map(readLayerRows("switches").map((r) => [r.sku, r]));
  const rt = new Map(readLayerRows("routers").map((r) => [r.sku, r]));
  for (const sku of ["N5548UPM-4FEX", "N3K-C3172TQ-10PK", "C4500E-7R-S8E-UPOE", "ACI-C9336-B3-EAL", "N2232PP-4FEX", "N5672UP-4FEX-10G"]) check(`A.4 switches page: ${sku} is bundle`, sw.get(sku)?.kind === "bundle", `got ${sw.get(sku)?.kind}`);
  for (const sku of ["CRS-16-FC140/M-8P", "ASR1000-RP3-32G-2P", "ISR4330U-MEM-MSATA"]) check(`A.4 routers page: ${sku} is bundle`, rt.get(sku)?.kind === "bundle", `got ${rt.get(sku)?.kind}`);
  for (const sku of ["3900-FANASSY", "3900-FANASSY=", "3900-FANASSY-NEBS", "3900-FANASSY-NEBS="]) check(`residual: ${sku} is under ISR 3900`, rt.get(sku)?.series === "ISR 3900", `got ${rt.get(sku)?.series}`);
}

// SABOTAGE: each check sees a planted defect, for the stated reason.
{
  const row = (sku: string, o: Partial<LayerRow> = {}): LayerRow => ({ sku, name: "x", series_label: "", kind: "switch", bucket: "layered", series: "A", plan: "", ...o });
  const pairs = pairDisagreements([row("ZZ-TEST-1"), row("ZZ-TEST-1=", { kind: "mechanical" })]);
  check("SABOTAGE a planted base/spare kind split is reported, naming the field", pairs.length === 1 && pairs[0].fields.join() === "kind", JSON.stringify(pairs));
  const tw = twinGroups([row("C9200L-48P-4G"), row("C9200L-48P- 4G"), row("c9200l-48p-4g=")]);
  check("SABOTAGE a planted whitespace twin is one group of two (the spare is a different part)", tw.length === 1 && tw[0].length === 2, JSON.stringify(tw));
  const planted = crossClaims("switches", [row("MS120-24P", { name: "Cisco MS120-24P" })], CATS);
  check("SABOTAGE a Meraki MS row is seen as claimed by the meraki mapping (the leakage scan is live)", planted.some((g) => g.claimed_by === "meraki"), JSON.stringify(planted));
  const noRow = classifyRules(ruleUse("switches", [], []));
  check("SABOTAGE with no rows every SKU rule is dead (the dead-rule count is live)", noRow.dead.length > 100, `${noRow.dead.length}`);
}

console.log(`    layers standing: ${passed} passed, ${misses.length} missed (${REVIEWED.join(", ")})`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
