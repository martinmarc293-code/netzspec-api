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
import { readLayerRows, pairDisagreements, twinGroups, crossClaims, ruleUse, classifyRules, incomingRows, labelViolations, labelEvidenceDrift, type LayerRow } from "../src/core/layerChecks.js";
import { labelEvidence } from "../src/core/labelEvidence.js";

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

  // THE LABEL CHECK (re-audit at 2f3d17a): no row sits in a series on a bare label; moved rows sit in shared parts; the evidence
  // recorded at build time is what labelEvidence gives today
  const lv = labelViolations(rows);
  check(`label check ${cat}: 0 rows in a series on a label without evidence, 0 moved rows outside shared parts`, lv.length === 0, lv.slice(0, 6).map((v) => `${v.sku}: ${v.why}`).join("; "));
  const { drift } = labelEvidenceDrift(cat, rows);
  check(`label check ${cat}: the recorded evidence of every kept label row is what labelEvidence gives today`, drift.length === 0, drift.slice(0, 5).map((d) => `${d.sku}: recorded "${d.recorded}", now "${d.now}"`).join("; "));
  const summary = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "layers", `cisco-${cat}.json`), "utf8"));
  const withEv = rows.filter((r) => r.label_evidence).length, moved = rows.filter((r) => (r.placed_by ?? "").startsWith("label-unsupported")).length;
  check(`label check ${cat}: applied, and the page's counts are the rows' (label-placed ${withEv}, moved ${moved})`,
    summary.label_check?.applied === true && summary.label_check.label_placed === withEv && summary.label_check.moved.length === moved && withEv > 100,
    JSON.stringify({ applied: summary.label_check?.applied, label_placed: summary.label_check?.label_placed, moved: summary.label_check?.moved?.length }));
  check(`provenance ${cat}: the built page names its commit`, typeof summary.commit === "string" && /^[0-9a-f]{40}$/.test(summary.commit), `commit ${summary.commit}`);
  check(`provenance ${cat}: the page lists its uncommitted rule files (an array, possibly empty)`, Array.isArray(summary.uncommitted_rule_files));
}

// THE FAMILY LAYER (operator, 14 Sep 2026): layer 3 where Cisco names a family, the explicit shared-across marker for line shared
// parts, "—" (empty) otherwise — and the file says the category's families were assigned.
{
  const { loadLineFile, validateLineFile, SHARED_PARTS } = await import("../src/core/productLine.js");
  for (const cat of REVIEWED) {
    const loaded = loadLineFile("cisco", cat)!;
    check(`family layer ${cat}: the mapping file declares family_layer "assigned"`, loaded.file.family_layer === "assigned");
    const famOf = new Map(loaded.file.lines.flatMap((l) => l.series.map((s) => [s.series, s.family ?? ""] as const)));
    const wrong = readLayerRows(cat).filter((r) => r.bucket === "layered").filter((r) =>
      r.product_family !== (r.series === SHARED_PARTS(r.product_line) ? "(shared across the line)" : famOf.get(r.series) ?? ""));
    check(`family layer ${cat}: every layered row carries its series' family (or the shared-across marker)`, wrong.length === 0, wrong.slice(0, 5).map((r) => `${r.sku} ${r.series} [${r.product_family}]`).join("; "));
    check(`family layer ${cat}: at least one family is in use (the column is live)`, readLayerRows(cat).some((r) => r.product_family && !r.product_family.startsWith("(")));
  }
  const base = (): Parameters<typeof validateLineFile>[0] => ({ vendor: "cisco", category: "zz", family_layer: "assigned", lines: [{ line: "Nexus", series: [
    { series: "Nexus 7004 / 7009", sku: ["^N7K"], family: "Nexus 7000" }, { series: "Nexus 7700", sku: ["^N77"], family: "Nexus 7000" }, { series: "Nexus 6000", sku: ["^N6K"] }] }] });
  const errsOf = (mut: (f: ReturnType<typeof base>) => void) => { const f = base(); mut(f); return validateLineFile(f).join(" | "); };
  check("SABOTAGE family: the valid shape without a reason on the 3-series line is refused for the missing reason", /no no_family_reason/.test(errsOf(() => {})));
  check("SABOTAGE family: with the reason it validates", errsOf((f) => { f.lines[0].no_family_reason = "Cisco names the Nexus 6000 alone"; }) === "");
  check("SABOTAGE family: a family that restates a series name is refused", /restates a series name/.test(errsOf((f) => { f.lines[0].no_family_reason = "x"; f.lines[0].series[0].series = "Nexus 7000"; })));
  check("SABOTAGE family: a family that restates its product line is refused", /restates its product line/.test(errsOf((f) => { f.lines[0].no_family_reason = "x"; f.lines[0].series[0].family = "Nexus"; f.lines[0].series[1].family = "Nexus"; })));
  check("SABOTAGE family: a family of one series is refused (a family is a grouping)", /groups only one series/.test(errsOf((f) => { f.lines[0].no_family_reason = "x"; f.lines[0].series[1].family = undefined; })));
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

  // the label check on built rows: a bare label in a series, and a moved row left in its series, are each refused
  const lv = labelViolations([
    row("MEM-224-1X128D-U", { product_line: "ISR", series: "ISR 810", placed_by: "label 800", label_evidence: "none: no platform token" }),
    row("PWR-60W-AC", { product_line: "ISR", series: "ISR 810", placed_by: "label 800" }),
    row("PS-SWITCH-AC-2P", { product_line: "ISR", series: "ISR 810", placed_by: "label-unsupported (label 800; was ISR 810): none", label_evidence: "none: x" }),
    row("MEM8XX-256U512D", { product_line: "ISR", series: "ISR 810", placed_by: "label 800", label_evidence: "name: 880" })]);
  check("SABOTAGE label check: an unsupported label, a label with no evidence and a moved row outside shared parts are 3 violations, the evidenced row none",
    lv.length === 3 && lv.map((v) => v.sku).join() === "MEM-224-1X128D-U,PWR-60W-AC,PS-SWITCH-AC-2P", JSON.stringify(lv));

  // labelEvidence itself, each case for its stated reason
  const isr = { family: null, siblings: ["ISR 1900", "ISR 2900", "ISR 3900", "ISR 4000", "ISR 1100"].map((s) => ({ series: s, family: null })) };
  const cat = { family: "Catalyst 2960", siblings: ["Catalyst 2960-C and 2960-CX", "Catalyst 3560-C and 3560-CX", "Catalyst 1000", "Catalyst 9300"].map((s) => ({ series: s, family: null })) };
  const ie = { family: null, siblings: ["IE 3400", "IE 3400H", "IE 3000"].map((s) => ({ series: s, family: null })) };
  const v = (sku: string, name: string, series: string, ctx: Parameters<typeof labelEvidence>[2], comp: string[] = []) => labelEvidence({ sku, name }, series, ctx, new Set(comp));
  let e = v("MEM-1900-1GB=", "1GB DRAM for Cisco 1941/1941W ISR (only as spare)", "ISR 2900", isr);
  check("SABOTAGE label: 1941 memory labelled ISR 2900 is none, naming ISR 1900", e.kind === "none" && /ISR 1900/.test(e.detail), JSON.stringify(e));
  e = v("MEM-4300-2G=", "2G DRAM (1 DIMM) for Cisco ISR 4330, 4350, Spare", "ISR 4000", isr);
  check("SABOTAGE label: ISR 4330 memory in ISR 4000 is a SKU token (N000 = the Nxxx models)", e.kind === "sku-token" && e.detail === "4000", JSON.stringify(e));
  e = v("MEM-224-1X128D-U", "128MB DRAM Memory for VG224", "ISR 1100", isr);
  check("SABOTAGE label: VG224 memory labelled ISR 1100 is none", e.kind === "none", JSON.stringify(e));
  e = v("PWR-C1-1900WHV-T=", "1900W HVAC/HVDC Titanium-certified power supply spare", "Catalyst 9300", cat);
  check("SABOTAGE label: a 1900W supply is none without naming Catalyst 1000 (a wattage is not a platform)", e.kind === "none" && !/Catalyst 1000/.test(e.detail), JSON.stringify(e));
  e = v("CMP-CBLE-GRD", "Cable Guard For The 3560-C and 2960-C Compact Switches", "Catalyst 2960-C and 2960-CX", cat);
  check("SABOTAGE label: a part naming 2960-C and 3560-C equally is none (shared)", e.kind === "none" && /equally/.test(e.detail), JSON.stringify(e));
  e = v("SD-IE-16GB", "IE 3400H 16GB SD card", "IE 3400H", ie);
  check("SABOTAGE label: 'IE 3400H' in the name keeps IE 3400H (the IE 3400 sibling name is fenced)", e.kind === "name" && e.detail === "IE 3400H", JSON.stringify(e));
  e = v("ZZ-PLAIN-PART", "Cisco ZZ-PLAIN-PART", "ISR 2900", isr, ["ISR 2900"]);
  check("SABOTAGE label: no token but a compatible link into the series keeps it as compatible", e.kind === "compatible", JSON.stringify(e));
  e = v("ZZ-PLAIN-PART", "Cisco ZZ-PLAIN-PART", "ISR 2900", isr, ["ISR 3900"]);
  check("SABOTAGE label: a compatible link into ANOTHER series does not", e.kind === "none", JSON.stringify(e));
  e = v("PWR-ADPT-18W", "Power adaptor, 18W, for Catalyst 1000 switches", "Catalyst 1000", { ...cat, family: null });
  check("SABOTAGE label: the whole series name in the name keeps it", e.kind === "name" && e.detail === "Catalyst 1000", JSON.stringify(e));
}

console.log(`    layers standing: ${passed} passed, ${misses.length} missed (${REVIEWED.join(", ")})`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
