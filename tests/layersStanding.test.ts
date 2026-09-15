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
import { readLayerRows, pairDisagreements, twinGroups, crossClaims, ruleUse, classifyRules, incomingRows, labelViolations, labelEvidenceDrift, seriesEntryDisagreements, deviceInSharedParts, unplacedArrivals, sharedLabelNotExplicit, DEVICE_KINDS, type LayerRow } from "../src/core/layerChecks.js";
import { labelEvidence } from "../src/core/labelEvidence.js";

export const REVIEWED = ["switches", "routers", "transceiver", "interfaces-modules", "wireless", "servers-unified-computing", "hyperconverged-infrastructure", "hyperconverged-systems", "security", "video", "optical-networking", "storage-networking"];
// spare = base exceptions, each read against the built row
const PAIR_EXCEPTIONS: Record<string, string> = {
  "switches|N5K-C5696Q-C": "the spare row is named '^Invalid SKU' and carries a class non_product plan; its base is the live 'Nexus 5696Q Chassis with license and SW image'",
  "wireless|C9105AXW-KIT": "the base row is named 'Do not use' and carries a class non_product plan; its spare C9105AXW-KIT= is the live 'C9105AX Series Spacer Kit' (layers round 3)",
  // servers + hyperconverged round (layers round 3): Cisco voided one member of each pair — the voided member carries the kind layer's
  // class non_product plan ("self-declared VOID PID"), the other is the live part in its series
  "servers-unified-computing|UCS-C3K-EX40TE": "the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'UCS C3X60 Expander 4x 10TB … 40TB' in UCS S3260",
  "servers-unified-computing|UCS-C3K-SSD10": "the spare is named 'VOID: not used' and carries a class non_product plan; the base is the live 'Cisco UCS C3X60 SSD+HDD Row' in UCS S3260",
  "servers-unified-computing|UCS-S3260-EX32T": "the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'S3260 HDD Expander with 4x 8TB …' in UCS S3260",
  "servers-unified-computing|UCS-S3260-EX48T": "the spare is named 'Void; Not Used' and carries a class non_product plan; the base is the live 'UCS S3260 Disk Expansion Tray with 4x 12TB' in UCS S3260",
  "servers-unified-computing|UCS-S3260-EX64T": "the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'UCS S3260 Rear Expander with 4x16TB …' in UCS S3260",
  "servers-unified-computing|UCS-S3260-EX8T": "the spare is named 'Void; Not Used' and carries a class non_product plan; the base is the live 'UCS S3260 Disk Expansion Tray with 4x 2TB' in UCS S3260",
  "servers-unified-computing|UCSB-EX-M4-1": "the BASE is named 'VOID-TO BE OBSOLETED' and carries a class non_product plan; the spare UCSB-EX-M4-1= is the live 'UCS Scalable M4 Blade Module w/o CPU/DIMM/HDD'",
  "servers-unified-computing|UCSX-440P": "the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'Cisco UCS X-Series Gen4 PCIe node within UCS X210c config' in UCS X440p PCIe node",
  "servers-unified-computing|UCS-MAN-S72A2T0V0": "kind only: the base is named 'MSFT AzureStack HCI Hyb CTO Node C220 M7sn w/Mellanox' (server), the spare only by its SKU, so the kind axis reads its MAN token (bundle); both sit in UCS C220",
  "servers-unified-computing|UCSW-MSX-PCBL": "kind only: the base 'UCS Invicta Scaling System Mellanox Switch Power Cable' reads server from its SKU token, the spare '… Mellanox Jumper Cable' reads cable through its name; both sit in UCS Invicta (Whiptail) — a kind-layer defect listed in the round's record, not changed in a layers round",
  "servers-unified-computing|UCSW-WT-35HDDT": "kind only: the base (name cut to 'UCSW Whiptail Super Micro 3.5') reads server from its SKU token, the spare '… 3.5\" HDD Tray …' reads drive through its name, and a tray is neither; both sit in UCS Invicta (Whiptail) — a kind-layer defect listed in the round's record",
  "optical-networking|15454-M2-DDR": "kind only: the base is named only by its SKU (accessory), the spare '2 service slot MSTP chassis deep door' reads mechanical through its name; both sit in ONS 15454 MSTP",
  "optical-networking|15454-M2-WM": "kind only: the base is named only by its SKU (accessory), the spare 'Wall mount bracket, Cisco NCS2002' reads mechanical through its name; both sit in ONS 15454 MSTP",
  "video|CBR-PS-BLANK":"kind only: the base 'cBR-8 Power Supply Blanks (for empty Power Supply slots)' reads power from its PS token, the spare 'Blanks for the Power Supply Slots' reads accessory; both sit in cBR-8 — a kind-layer defect listed in the video round's record",
  "video|P2-HD-EDR-SA": "kind only: the base is named only by its SKU ('Cisco P2-HD-EDR-SA', kind unknown), the spare 'Cisco Prisma II EDR Host Module with 2:1 Tx' reads plug-in through its name; both sit in Prisma II HD",
  "security|ASA5585-REAR-RACK":"kind only: the base 'ASA 5585 Rear Rack Mount' reads mechanical through its name, the spare 'ASA 5585-X Rear Rack Mounts (1 pair)' stays accessory (the name marker does not read the plural); both sit in ASA 5585-X — a kind-layer defect listed in the security round's record",
  "hyperconverged-systems|HXAF-E-240-M5SX":"the spare is named 'VOID; Not Used' and carries a class non_product plan; the base is the live 'Cisco HyperFlex All Flash Edge 240 Full Capacity M5 system' in HyperFlex Edge",
};

// THE LABEL CHECK, per category (layers round 3, operator: the round-2 floor "more than 100 label-placed rows" failed by construction
// on a category every row of which a SKU rule places). `min`: a floor that proves the check computed evidence where labels place
// rows; `exactly`: the category's measured count, so a mapping change that starts placing rows by label is a visible change.
const LABEL_EXPECT: Record<string, { min?: number; exactly?: number; why: string }> = {
  switches: { min: 100, why: "hundreds of rows are placed by a stored series label" },
  routers: { min: 100, why: "hundreds of rows are placed by a stored series label" },
  transceiver: { exactly: 0, why: "every transceiver row is placed by its SKU's form-factor and speed family; the mapping's labels place nothing (layers round 3)" },
  wireless: { exactly: 30, why: "access points, controllers and their parts are placed by SKU; 30 rows are judged on a stored label (11 kept by a token or name, 19 moved to their line's shared parts — layers round 3)" },
  "interfaces-modules": { exactly: 5, why: "the cards are placed by their SKU families; 5 rows are judged on a stored label — STM1-CN-MM / -SMI kept by the name token PA, and AIC-DBL-PNL, AIC-SGL-PNL and WDM-SFP-2CH-CONV= moved to shared parts; the 30 labels mapped directly to a line's shared parts are not judged (pre-ruling C1, layers round 3)" },
  "servers-unified-computing": { exactly: 1, why: "UCS rows are placed by SKU; one row is judged on a stored label — SAS3 (a datasheet fragment, label 'S-Series Storage'), moved to the S-Series line's shared parts; the rows whose label maps directly to a line's shared parts are not judged (pre-ruling C1). The ten E1x0 service spares and the SRE parts the check had moved are SKU-placed or planned out since the servers round" },
  "hyperconverged-infrastructure": { exactly: 0, why: "HCI rows are placed by SKU; its 97 label-placed rows carry labels mapped directly to the Nutanix line's shared parts (pre-ruling C1, not judged)" },
  "hyperconverged-systems": { exactly: 0, why: "HyperFlex rows are placed by SKU or, for five Cisco+ offers, by name; its 32 label-placed rows carry the label mapped directly to HyperFlex shared parts (pre-ruling C1, not judged)" },
  "storage-networking": { exactly: 2, why: "MDS rows are placed by SKU; 2 are judged on a stored label and moved to the line's shared parts — M9XT-FC1632 / = 'MDS 32G FC Port Expansion module' (label MDS 9100, no platform token); SAN50C-R, held for review as a whole switch, is SKU-placed from the MDS 9250i end-of-sale notice (layers round 3)" },
  "optical-networking": { exactly: 12, why:"optical rows are placed by SKU; 12 are judged on a stored label — CISCO-15454-M6 kept by the SKU token 15454, 11 moved to their line's shared parts (4X100G-LR-S, internal 800- numbers, customer-variant CO- transponders, two MPO cables); the family placeholders 40-SMR1 / 40-SMR2 carry class plans (layers round 3)" },
  video: { exactly: 1, why:"cable-access rows are placed by SKU or by the family their name states; one row is judged on a stored label and moved to its line's shared parts — PWR-CAB-AC-BLK (a power cord, label cBR-8); 4035899, which the check had moved for want of name evidence, is SKU-placed from its end-of-sale notice (layers round 3)" },
  security: { exactly: 16, why:"security appliances are placed by SKU; 16 rows are judged on a stored label — CAB-CONS-USB-C= kept by the name token 1200, ISE-SNS-ACCYKIT by the SKU token SNS, 14 moved to their line's shared parts (UCS spares filed under ISE, desktop and IE power supplies, CSACS-ACCYKIT, PRIME-ACC-REG); 9 rows on labels mapped directly to shared parts are not judged (pre-ruling C1, layers round 3)" },
};
// THE FAMILY LAYER, per category: "in-use" where Cisco names families over series (switches, routers); "none" where Cisco names none
// and every line of 3+ series says why (layers round 3: optics and modules, operator — "—" with a no_family_reason is the expected result).
const FAMILY_EXPECT: Record<string, "in-use" | "none"> = { switches: "in-use", routers: "in-use", transceiver: "none", "interfaces-modules": "none", wireless: "none",
  // servers + hyperconverged round: Cisco names the UCS server families as the lines themselves (C-Series, B-Series, X-Series …) and
  // no family between a line and its models; HyperFlex and Compute Hyperconverged name nodes directly under the product
  "servers-unified-computing": "none", "hyperconverged-infrastructure": "none", "hyperconverged-systems": "none",
  // security round: Cisco names its firewall, ASA, analytics, email / web and management series directly under each security product
  security: "none",
  // video round: the GS7000, Prisma II, Remote PHY, RF Gateway and cBR-8 platforms are the lines; Cisco names nothing between them and their series
  video: "none",
  // optical round: NCS 1000, ONS 15454 / NCS 2000, ONS 15216 / 15200, NCS 4000 and Routed Optical Networking are the lines; no line holds 3+ series
  "optical-networking": "none",
  // storage round: MDS 9000 is the family and the line; directors and fabric switches are kinds
  "storage-networking": "none" };
// ARRIVALS (layers round 3): a not-run move plan out of a reviewed category must land placed in its target's mapping. These four
// plans predate the check (switches + routers rounds) and their targets cannot place them yet; each is listed with the round that
// owns the target's rule. A listed row that now places is a stale exception and fails. (Operator, layers round 3: 11 -> 4 — the
// IC3000 series in routers and CW-SFP-KIT1 in switches were added, the nine TA-* plans were cancelled: those rows are Nexus switches.)
// Layers round 3, wireless round: AIR-BR1310G and CWWLSE-1130-19-K9 now place (wireless series "Aironet 1310 outdoor access point /
// bridge (legacy)" and line "Wireless LAN Solution Engine (legacy)"); their exceptions are retired.
// Servers round: XRV-PCIE-C40Q-03 and XRV-PCIE-IQ10GF now place (servers "Network and storage adapters", ^XRV-PCIE-); retired.
const ARRIVAL_EXCEPTIONS: Record<string, string> = {};
// transceiver (operator, layers round 3): the same-cage cable series holds only cables, and a breakout cable sits in its host cage's
// speed series, never in the DAC series
const TX_DAC_SERIES = "DAC and AOC cables (SFP+ / SFP28 / SFP56 / QSFP / QSFP-DD)";
const cableContract = (rows: LayerRow[]) => ({
  notCableInDac: rows.filter((r) => r.bucket === "layered" && r.series === TX_DAC_SERIES && r.kind !== "cable"),
  breakoutOutsideSpeed: rows.filter((r) => r.bucket === "layered" && r.kind === "breakout-cable" && (r.series === TX_DAC_SERIES || r.product_line !== "Ethernet transceivers")),
});
const labelExpectMiss = (cat: string, labelPlaced: number): string | null => {
  const e = LABEL_EXPECT[cat];
  if (!e) return `no label expectation recorded for ${cat}`;
  if (e.exactly !== undefined && labelPlaced !== e.exactly) return `label-placed ${labelPlaced}, expected exactly ${e.exactly} (${e.why})`;
  if (e.min !== undefined && labelPlaced <= e.min) return `label-placed ${labelPlaced}, expected more than ${e.min} (${e.why})`;
  return null;
};
/** a family found on a layered row (the shared-across marker and "" are not families) */
const familiesInUse = (rows: LayerRow[]) => rows.filter((r) => r.bucket === "layered" && r.product_family && !r.product_family.startsWith("("));

/** series with 0 parts that say nothing about what they wait for */
const deadPlaceholders = (summary: { lines: { line: string; series: { series: string; parts: number; pending_in?: Record<string, number> }[] }[] }) =>
  summary.lines.flatMap((l) => l.series.filter((x) => x.parts === 0 && Object.keys(x.pending_in ?? {}).length === 0).map((x) => `${l.line} / ${x.series}`));
/** rows layered in a series whose every row must carry a move plan */
const moveOutStrays = (rows: LayerRow[], moveOut: ReadonlySet<string>) => rows.filter((r) => r.bucket === "layered" && moveOut.has(r.series));

let passed = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };

const CATS = fs.readdirSync(path.join(REPO_ROOT, "data", "reference", "product-lines")).map((f) => f.replace(/^cisco-|\.json$/g, ""));
const PLANS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "kind-layer-plans-2026-09-13.json"), "utf8"));
type Allowed = { category: string; claimed_by: string; series: string; rule: string; rows: number; status: string; reason: string };
const ALLOW = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "reference", "layers-cross-claims.json"), "utf8")) as { entries: Allowed[] }).entries;
const STATUSES = new Set(["claimant-rule-too-broad", "decided-home", "pending-round"]);

for (const cat of REVIEWED) {
  const rows = readLayerRows(cat);
  // was "rows > 1000", a floor that failed by construction on the small categories reviewed from the servers round on (786 rows in
  // hyperconverged-infrastructure); the page's own parts count is the stronger statement (checked below with the summary)
  check(`${cat}: the built rows are not empty`, rows.length > 0, `${rows.length} rows`);

  const dis = pairDisagreements(rows).filter((d) => !PAIR_EXCEPTIONS[`${cat}|${d.sku}`]);
  check(`spare=base ${cat}: 0 base/spare pairs disagree on series, kind, bucket or plan`, dis.length === 0, dis.slice(0, 8).map((d) => `${d.sku} [${d.fields.join(",")}]`).join("; "));
  for (const k of Object.keys(PAIR_EXCEPTIONS).filter((x) => x.startsWith(`${cat}|`)))
    check(`spare=base ${cat}: the recorded exception ${k.split("|")[1]} still disagrees (a stale exception is a hole)`, pairDisagreements(rows).some((d) => d.sku === k.split("|")[1]));

  const ntc = rows.filter((r) => r.bucket === "not_this_category"), unplaced = rows.filter((r) => r.bucket === "unplaced");
  check(`plan coverage ${cat}: every not-this-category row carries a plan (0 left in the bucket)`, ntc.length === 0, ntc.slice(0, 8).map((r) => r.sku).join(", "));
  check(`plan coverage ${cat}: 0 unplaced rows`, unplaced.length === 0, unplaced.slice(0, 8).map((r) => r.sku).join(", "));

  // a move-out series (its note: "every row carries a move plan") holds no layered row: the rule-shadowing scan skips such a
  // series, so a row landing there without a plan would otherwise pass unseen (after run #1068 the routers ones hold 0)
  {
    const { loadLineFile } = await import("../src/core/productLine.js");
    const moveOut = new Set(loadLineFile("cisco", cat)!.file.lines.flatMap((l) => l.series.filter((s) => /every row carries a move plan/.test(s.note ?? "")).map((s) => s.series)));
    const stray = moveOutStrays(rows, moveOut);
    check(`move-out series ${cat}: 0 layered rows in the ${moveOut.size} series whose every row must carry a move plan`, stray.length === 0, stray.slice(0, 6).map((r) => `${r.sku} ${r.series}`).join("; "));
  }

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
  check(`${cat}: the page's parts count is its row count`, summary.parts === rows.length, `page ${summary.parts}, rows ${rows.length}`);
  const sed = seriesEntryDisagreements(summary, rows);
  check(`series entries ${cat}: every series entry of the JSON agrees with its rows on parts, kinds, roles and family`, sed.length === 0, sed.slice(0, 5).map((d) => `${d.series} [${d.fields.join(",")}] ${d.detail}`).join("; "));
  // a series with 0 parts is a placeholder only while rows are planned into it, and it says so (closing items at aa1143f, item 2)
  const empty = summary.lines.flatMap((l: any) => l.series.filter((x: any) => x.parts === 0).map((x: any) => ({ line: l.line, ...x })));
  const deadEmpty = deadPlaceholders(summary);
  check(`placeholders ${cat}: every series with 0 parts carries "pending N from <category>" (${empty.length} placeholder(s))`, deadEmpty.length === 0, deadEmpty.join("; "));
  const dev = deviceInSharedParts(rows);
  check(`devices ${cat}: 0 whole-device rows (${[...DEVICE_KINDS].join(" / ")}) in any shared parts series`, dev.length === 0, dev.slice(0, 6).map((r) => `${r.sku} (${r.kind}) ${r.series}`).join("; "));
  check(`devices ${cat}: 0 rows pending review, and the page lists exactly the rows in that bucket`, rows.filter((r) => r.bucket === "pending_review").length === (summary.pending_review?.length ?? -1) && (summary.pending_review?.length ?? -1) === 0, `rows ${rows.filter((r) => r.bucket === "pending_review").length}, page ${summary.pending_review?.length}`);
  const withEv = rows.filter((r) => r.label_evidence).length, moved = rows.filter((r) => r.bucket === "layered" && (r.placed_by ?? "").startsWith("label-unsupported")).length;
  check(`label check ${cat}: applied, and the page's counts are the rows' (label-placed ${withEv}, moved ${moved})`,
    summary.label_check?.applied === true && summary.label_check.label_placed === withEv && summary.label_check.moved.length === moved,
    JSON.stringify({ applied: summary.label_check?.applied, label_placed: summary.label_check?.label_placed, moved: summary.label_check?.moved?.length }));
  const lem = labelExpectMiss(cat, withEv);
  check(`label check ${cat}: the label-placed count meets the category's recorded expectation`, lem === null, lem ?? "");
  // every row placed through a label carries the evidence it was judged on (a label placement without evidence is the check not running)
  // — except a label the mapping sends DIRECTLY to its line's shared parts, which claims no series (pre-ruling C1, layers round 3)
  const direct = (r: LayerRow) => /^label /.test(r.placed_by ?? "") && r.series === `${r.product_line} shared parts`;
  const unjudged = rows.filter((r) => r.bucket === "layered" && /^label[ -]/.test(r.placed_by ?? "") && !r.label_evidence && !direct(r));
  check(`label check ${cat}: 0 label-placed rows without recorded evidence`, unjudged.length === 0, unjudged.slice(0, 5).map((r) => r.sku).join(", "));
  const notExplicit = sharedLabelNotExplicit(cat, rows);
  check(`label check ${cat}: every label placed directly in a line's shared parts (${rows.filter((r) => r.bucket === "layered" && direct(r)).length} rows) is listed on that series in the mapping (C1)`, notExplicit.length === 0, notExplicit.slice(0, 5).map((x) => `${x.sku}: ${x.why}`).join("; "));

  // arrivals: every not-run move plan out of this category lands placed in its target's mapping (layers round 3)
  {
    const arr = unplacedArrivals(cat, rows, PLANS);
    const unexcused = arr.filter((a) => !ARRIVAL_EXCEPTIONS[`${cat}|${a.sku}`]);
    check(`arrivals ${cat}: every planned move lands placed in its target mapping (${arr.length - unexcused.length} recorded exception(s))`, unexcused.length === 0, unexcused.slice(0, 6).map((a) => `${a.sku} -> ${a.to}: ${a.why}`).join("; "));
    for (const k of Object.keys(ARRIVAL_EXCEPTIONS).filter((x) => x.startsWith(`${cat}|`)))
      check(`arrivals ${cat}: the recorded exception ${k.split("|")[1]} still fails to place (a stale exception is a hole)`, arr.some((a) => a.sku === k.split("|")[1]));
  }
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
    const expect = FAMILY_EXPECT[cat];
    check(`family layer ${cat}: an expectation is recorded ("in-use" or "none")`, expect === "in-use" || expect === "none", `${expect}`);
    const used = familiesInUse(readLayerRows(cat));
    if (expect === "in-use") check(`family layer ${cat}: at least one family is in use (the column is live)`, used.length > 0);
    if (expect === "none") {
      check(`family layer ${cat}: Cisco names no family here, so no layered row carries one`, used.length === 0, used.slice(0, 5).map((r) => `${r.sku} [${r.product_family}]`).join("; "));
      const silent = loaded.file.lines.filter((l) => l.series.filter((s) => !/shared parts$/.test(s.series)).length >= 3 && !(l.no_family_reason ?? "").trim());
      check(`family layer ${cat}: every line of 3+ series says why it has no family`, silent.length === 0, silent.map((l) => l.line).join("; "));
      check(`family layer ${cat}: the mapping declares no family at all`, loaded.file.lines.every((l) => l.series.every((s) => !s.family)));
    }
  }
  // sabotage: the per-category expectations refuse for their stated reasons
  check("SABOTAGE family expectation: a family on a layered row of a 'none' category is found", familiesInUse([{ sku: "ZZ", bucket: "layered", product_family: "Cisco Optics" } as LayerRow]).length === 1);
  check("SABOTAGE family expectation: the shared-across marker is not a family", familiesInUse([{ sku: "ZZ", bucket: "layered", product_family: "(shared across the line)" } as LayerRow]).length === 0);
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

// transceiver on the built rows (layers round 3): the cable contract, and the operator's witnesses are where the decisions put them
{
  const tx = readLayerRows("transceiver");
  const { notCableInDac, breakoutOutsideSpeed } = cableContract(tx);
  check("transceiver: the DAC and AOC series holds only kind cable", notCableInDac.length === 0, notCableInDac.slice(0, 6).map((r) => `${r.sku} (${r.kind})`).join("; "));
  check("transceiver: every breakout cable sits in an Ethernet speed series", breakoutOutsideSpeed.length === 0, breakoutOutsideSpeed.slice(0, 6).map((r) => `${r.sku} ${r.series}`).join("; "));
  const breakouts = tx.filter((r) => r.bucket === "layered" && r.kind === "breakout-cable").length;
  check(`transceiver: the contract has rows to judge (${breakouts} breakout cables on the page)`, breakouts >= 50, `${breakouts}`);
  const t = new Map(tx.map((r) => [r.sku, r]));
  for (const sku of ["SFP-H25GCU1M", "SFP-25GAOC10M", "SFP-H10GBACU10M"]) check(`transceiver page: glued ${sku} is a cable in the DAC series`, t.get(sku)?.kind === "cable" && t.get(sku)?.series === TX_DAC_SERIES, `got ${t.get(sku)?.kind} / ${t.get(sku)?.series}`);
  for (const [sku, series] of [["QSFP-4SFP25G-CU1M", "100G QSFP28"], ["QSFP-4X10G-AOC1M", "40G QSFP+"], ["QDD-4ZQ100-CU1M", "200G / 400G QSFP-DD, QSFP112 and QSFP56"]])
    check(`transceiver page: breakout ${sku} is in ${series}`, t.get(sku)?.series === series && t.get(sku)?.kind === "breakout-cable", `got ${t.get(sku)?.kind} / ${t.get(sku)?.series}`);
  for (const sku of ["DWDM-GBIC-30.33", "CWDM-GBIC-1530", "15216-GBIC-1510", "WS-G5484"]) check(`transceiver page: ${sku} is in GBIC (legacy)`, t.get(sku)?.series === "GBIC (legacy)", `got ${t.get(sku)?.series}`);
  const gbic = tx.filter((r) => r.bucket === "layered" && /^(DWDM|CWDM|15216)-GBIC-/.test(r.sku)).length;
  check(`transceiver page: the 42 WDM GBICs are layered (operator: a GBIC rule that matches its 42 rows)`, gbic === 42, `${gbic}`);
}

// interfaces-modules on the built rows (layers round 3): the operator's decisions and the pre-rulings are where they put the rows
{
  const im = new Map(readLayerRows("interfaces-modules").map((r) => [r.sku, r]));
  const CARDS = "Interface cards (NIM / SM-X / HWIC / SPA / PVDM / VIC / cellular)";
  const at = (sku: string, series: string, kind?: string) => {
    const r = im.get(sku);
    check(`interfaces-modules page: ${sku} is layered in ${series}${kind ? `, kind ${kind}` : ""}`, r?.bucket === "layered" && r.series === series && (!kind || r.kind === kind), `got ${r?.bucket} / ${r?.series} / ${r?.kind}`);
  };
  at("C-NIM-1X", "NIM (Network Interface Modules)", "interface");
  at("C-SM-NIM-ADPT", "SM-X and SM Service Modules", "mechanical");
  at("C-SM-NIM-ADPT=", "SM-X and SM Service Modules", "mechanical");
  at("UCS-E160S-M3/K9", "SM-X and SM Service Modules", "module");
  at("ISM-SRE-300-K9", "ISM / EM Internal Service Modules", "module");
  at("WP-WIFI6-A", "WP pluggable modules (IoT routers)", "radio");
  at("P-5GS6-GL", "Pluggable Interface Modules (LTE / 5G / serial)", "cellular");
  at("P-1T", "Pluggable Interface Modules (LTE / 5G / serial)", "interface");
  at("ILPM-4=", "EHWIC / HWIC / VWIC / WIC", "power");
  at("GE-DCARD-ESW", "NM / NME Network Modules", "interface");
  at("16OC3/POS-MM", "Cisco 12000 / XR 12000 SIP and line cards", "interface");
  at("8FE-TX-RJ45-B", "Cisco 12000 / XR 12000 SIP and line cards");
  at("WS-X5153", "Router and switch line cards (legacy) shared parts");
  at("SB-PWR-48V-EU", "Small Business Network Accessories (SB-PWR / RPS1000)", "power");
  at("RPS1000", "Small Business Network Accessories (SB-PWR / RPS1000)");
  at("PP1-72X100G-SMF", "Fiber patch panels and MPO / breakout cables (CB- / PP)");
  check(`interfaces-modules page: the card line is renamed (C9) and holds the NIMs`, im.get("NIM-2T")?.product_line === CARDS, `${im.get("NIM-2T")?.product_line}`);
  const planned = (sku: string, plan: string) => check(`interfaces-modules page: ${sku} carries the plan "${plan}"`, im.get(sku)?.bucket === "pending_plan" && im.get(sku)?.plan === plan, `got ${im.get(sku)?.bucket} "${im.get(sku)?.plan}"`);
  planned("ENC-10G-ONT-10=", "move switches");
  planned("DS-X9148-HV", "move storage-networking");
  planned("AIR-RM3000M", "move wireless");
  planned("NAM2420-K9", "move security");
  planned("NCS-FAB-OPT=", "move transceiver");
  planned("PWR-3845-AC-IP=", "move routers");
  planned("FQMAP46CG", "class non_product");
  planned("HN4000e", "class non_product");
  const ntc = readLayerRows("interfaces-modules").filter((r) => r.bucket === "not_this_category").length;
  check(`interfaces-modules page: the 190 not-this-category rows of the round's start are all planned or placed (0 left)`, ntc === 0, `${ntc}`);
  const sw = new Map(readLayerRows("switches").map((r) => [r.sku, r]));
  check(`switches page: NM-BLANK-T1= carries the plan to interfaces-modules (C7)`, sw.get("NM-BLANK-T1=")?.plan === "move interfaces-modules", `${sw.get("NM-BLANK-T1=")?.plan}`);
}

// wireless on the built rows (layers round 3)
{
  const wl = new Map(readLayerRows("wireless").map((r) => [r.sku, r]));
  const at = (sku: string, series: string, kind?: string) => {
    const r = wl.get(sku);
    check(`wireless page: ${sku} is layered in ${series}${kind ? `, kind ${kind}` : ""}`, r?.bucket === "layered" && r.series === series && (!kind || r.kind === kind), `got ${r?.bucket} / ${r?.series} / ${r?.kind}`);
  };
  at("AIR-CT85DC-K9", "8500 (8510 / 8540 / 8580)", "wlc");  // was a controller in AireOS shared parts
  at("AIR-AP1702I-WLC", "WLC + access point bundles");
  at("AIR-1520-FIB-REEL", "Aironet 1520 / 1530", "mechanical");
  at("AIR-1520-FIB-REEL=", "Aironet 1520 / 1530", "mechanical");
  at("AIR-FAN-C220M4=", "5500 (5508 / 5520 / 5540)");  // kept by the name token 5520 once "Wireless" is not a watt
  at("RACK-QCN-SN5=", "CiscoWorks Wireless LAN Solution Engine (WLSE 1130 / Express 1030)");
  const planned = (sku: string, plan: string) => check(`wireless page: ${sku} carries the plan "${plan}"`, wl.get(sku)?.bucket === "pending_plan" && wl.get(sku)?.plan === plan, `got ${wl.get(sku)?.bucket} "${wl.get(sku)?.plan}"`);
  planned("C9120AXI-x", "class non_product");
  planned("AIR-AP1572EAC-UXK9", "class non_product");
  planned("C9105AXI", "class non_product");
  planned("SB-PWR-48V", "move interfaces-modules");
  planned("CS-ROOM70P-WMK=", "move collaboration-endpoints");
  const ntc = [...wl.values()].filter((r) => r.bucket === "not_this_category").length;
  check(`wireless page: 0 not-this-category rows left (the 44 of the round's start are planned)`, ntc === 0, `${ntc}`);
  const regionLeft = [...wl.values()].filter((r) => r.bucket === "layered" && /(^|-)x(-|$)|-xx$/.test(r.sku));
  check(`wireless page: 0 layered regulatory-domain / plug-region placeholders (lowercase -x / -xx SKUs)`, regionLeft.length === 0, regionLeft.slice(0, 6).map((r) => r.sku).join(", "));
  const rt = new Map(readLayerRows("routers").map((r) => [r.sku, r]));
  check(`routers page: the Aironet antennas and the 1530 mount kit carry their plans to wireless`, ["AIR-ANT2524DB-R", "AIR-ACC1530-PMK1"].every((s) => rt.get(s)?.plan === "move wireless"), ["AIR-ANT2524DB-R", "AIR-ACC1530-PMK1"].map((s) => `${s} ${rt.get(s)?.plan}`).join("; "));
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

  const strays = moveOutStrays([row("NIM-2T", { series: "NIM (Network Interface Modules)" }), row("NIM-4T", { series: "NIM (Network Interface Modules)", bucket: "pending_plan" })], new Set(["NIM (Network Interface Modules)"]));
  check("SABOTAGE move-out: a layered row in a move-out series is a stray, a pending-plan row there is not", strays.length === 1 && strays[0].sku === "NIM-2T", JSON.stringify(strays));

  // series entries against their rows: a family that disagrees (the Catalyst 8000 Edge shared parts defect), and a parts count
  const entry = { lines: [{ line: "L", series: [{ series: "L shared parts", family: null, parts: 2, kinds: { mechanical: 2 }, roles: {} }] }] };
  const plantedRows = [row("C-E1S-BLANK", { product_line: "L", series: "L shared parts", kind: "mechanical", product_family: "(shared across the line)", deploy_role: "", role_issue: "" }),
    row("C-HDD-BLANK", { product_line: "L", series: "L shared parts", kind: "mechanical", product_family: "(shared across the line)", deploy_role: "", role_issue: "" })];
  const d1 = seriesEntryDisagreements(entry, plantedRows);
  check("SABOTAGE series entries: an entry whose family is null while its rows say shared-across is reported on family alone", d1.length === 1 && d1[0].fields.join() === "family", JSON.stringify(d1));
  entry.lines[0].series[0].family = "(shared across the line)" as any; entry.lines[0].series[0].parts = 3;
  const d2 = seriesEntryDisagreements(entry, plantedRows);
  check("SABOTAGE series entries: a parts count the rows do not carry is reported on parts alone", d2.length === 1 && d2[0].fields.join() === "parts", JSON.stringify(d2));
  const dp = deadPlaceholders({ lines: [{ line: "Nexus", series: [{ series: "Nexus 9800", parts: 0 }, { series: "CQ211L01", parts: 0, pending_in: { routers: 6 } }, { series: "Nexus 9300", parts: 5 }] }] });
  check("SABOTAGE placeholders: an empty series with nothing pending is reported, one pending rows from routers is not", dp.join() === "Nexus / Nexus 9800", JSON.stringify(dp));
  const dv = deviceInSharedParts([row("CVR328W-K9-CN", { kind: "router", product_line: "Small Business Routers", series: "Small Business Routers shared parts" }), row("PWR-60W-AC", { kind: "power", series: "ISR shared parts" })]);
  check("SABOTAGE devices: a router in shared parts is caught, a power supply there is not", dv.length === 1 && dv[0].sku === "CVR328W-K9-CN", JSON.stringify(dv));
  const dv3 = deviceInSharedParts(["device", "ont", "olt", "ap", "wlc", "backhaul", "sensor"].map((k, i) => row(`ZZ-DEV-${i}`, { kind: k, series: "Cables and accessories shared parts" })));
  check("SABOTAGE devices (round 3): a whole device of kind device / ont / olt / ap / wlc / backhaul / sensor in shared parts is caught", dv3.length === 7 && ["device", "ont", "olt", "ap", "wlc", "backhaul", "sensor"].every((k) => DEVICE_KINDS.has(k)), JSON.stringify(dv3.map((r) => r.kind)));
  check("SABOTAGE devices (wireless round): an antenna or a bundle in shared parts is not a device", deviceInSharedParts([row("ZZ-ANT", { kind: "antenna", series: "X shared parts" }), row("ZZ-BUN", { kind: "bundle", series: "X shared parts" })]).length === 0);
  const dvs = deviceInSharedParts([row("UCSC-C420-M3", { kind: "server", series: "UCS C-Series Rack Servers shared parts" }), row("UCS-FI-6652=", { kind: "fabric-interconnect", series: "UCS Fabric Interconnects shared parts" }),
    row("UCS-S3348-RAIDM5", { kind: "storage-controller", series: "UCS Server Components shared parts" }), row("UCS-M6-MLB", { kind: "bundle", series: "UCS Server Components shared parts" })]);
  const dvsan = deviceInSharedParts([row("ZZ-FC", { kind: "fc-switch", series: "MDS 9000 Multilayer SAN Switches shared parts" }), row("ZZ-DIR", { kind: "director", series: "MDS 9000 Multilayer SAN Switches shared parts" }),
    row("ZZ-LC", { kind: "linecard", series: "MDS 9000 Multilayer SAN Switches shared parts" })]);
  check("SABOTAGE devices (storage round): an fc-switch and a director in shared parts are caught, a line card is not",
    dvsan.map((r) => r.sku).join() === "ZZ-FC,ZZ-DIR" && DEVICE_KINDS.has("fc-switch") && DEVICE_KINDS.has("director"), JSON.stringify(dvsan.map((r) => r.sku)));
  const dvvid = deviceInSharedParts([row("ZZ-NODE", { kind: "node", series: "GS7000 Nodes and Optical Hubs shared parts" }), row("ZZ-SYS", { kind: "system", series: "Prisma II Optical Transport shared parts" }),
    row("ZZ-PLUG", { kind: "plug-in", series: "Prisma II Optical Transport shared parts" }), row("ZZ-TX", { kind: "transmitter", series: "Prisma II Optical Transport shared parts" })]);
  check("SABOTAGE devices (video round): a node and a system in shared parts are caught, a plug-in and a transmitter are not",
    dvvid.map((r) => r.sku).join() === "ZZ-NODE,ZZ-SYS" && DEVICE_KINDS.has("node") && DEVICE_KINDS.has("system"), JSON.stringify(dvvid.map((r) => r.sku)));
  const secBox = ["firewall", "ips", "email-gateway", "web-gateway", "management", "analytics", "identity"];
  const dvsec = deviceInSharedParts([...secBox.map((k, i) => row(`ZZ-SEC-${i}`, { kind: k, series: "ASA and ISA shared parts" })),
    row("ZZ-SEC-MOD", { kind: "security-module", series: "Secure Firewall and Firepower shared parts" }), row("ZZ-SEC-PWR", { kind: "power", series: "ASA and ISA shared parts" })]);
  check("SABOTAGE devices (security round): a firewall / ips / email or web gateway / management / analytics / identity box in shared parts is caught, a security module and a power supply are not",
    dvsec.length === 7 && dvsec.every((r) => secBox.includes(r.kind)), JSON.stringify(dvsec.map((r) => r.kind)));
  check("SABOTAGE devices (servers round): a server and a fabric interconnect in shared parts are caught, a storage controller and a bundle there are not",
    dvs.map((r) => r.sku).join() === "UCSC-C420-M3,UCS-FI-6652=" && DEVICE_KINDS.has("server") && DEVICE_KINDS.has("fabric-interconnect"), JSON.stringify(dvs.map((r) => r.sku)));

  // round 3: the transceiver cable contract, the label expectation and the arrivals check, each refusing for its stated reason
  const cc = cableContract([row("SFP-H25G-CU1M", { kind: "cable", series: TX_DAC_SERIES, product_line: "Direct-attach and active optical cables" }),
    row("QSFP-4SFP25G-CU1M", { kind: "breakout-cable", series: TX_DAC_SERIES, product_line: "Direct-attach and active optical cables" }),
    row("QSFP-4X10G-AOC1M", { kind: "breakout-cable", series: "40G QSFP+", product_line: "Ethernet transceivers" })]);
  check("SABOTAGE cable contract: a breakout in the DAC series is caught by both halves; a cable there and a breakout in 40G QSFP+ are not",
    cc.notCableInDac.map((r) => r.sku).join() === "QSFP-4SFP25G-CU1M" && cc.breakoutOutsideSpeed.map((r) => r.sku).join() === "QSFP-4SFP25G-CU1M", JSON.stringify(cc));
  check("SABOTAGE label expectation: transceiver with 3 label-placed rows is refused against its recorded exactly-0", /expected exactly 0/.test(labelExpectMiss("transceiver", 3) ?? ""));
  check("SABOTAGE label expectation: switches with 40 label-placed rows is refused against its floor", /more than 100/.test(labelExpectMiss("switches", 40) ?? ""));
  check("SABOTAGE label expectation: a category with no recorded expectation is refused", /no label expectation/.test(labelExpectMiss("zz-category", 0) ?? ""));
  const ua = unplacedArrivals("zz", [row("15454-SFP-GE+-LX=", { name: "Cisco 15454-SFP-GE+-LX=", series_label: "" }), row("ZZ-NO-RULE-9", { name: "Cisco ZZ-NO-RULE-9", series_label: "" })],
    [{ sku: "15454-SFP-GE+-LX=", category: "zz", action: "move", to: "optical-networking", run_id: null }, { sku: "ZZ-NO-RULE-9", category: "zz", action: "move", to: "optical-networking", run_id: null },
      { sku: "15454-SFP-GE+-LX=", category: "zz", action: "move", to: "routers", run_id: 1234 }]);
  check("SABOTAGE arrivals: a planned SKU no target rule places is reported; a placed one and a plan that ran are not", ua.length === 1 && ua[0].sku === "ZZ-NO-RULE-9" && /no rule of optical-networking/.test(ua[0].why), JSON.stringify(ua));

  // pre-ruling C1 (layers round 3): a label mapped directly to a line's shared parts is not judged, but only while the mapping lists it
  const c1 = sharedLabelNotExplicit("interfaces-modules", [
    row("ZZ-C1-LISTED", { product_line: "Cables and accessories", series: "Cables and accessories shared parts", placed_by: "label Access Point Modules" }),
    row("ZZ-C1-UNLISTED", { product_line: "Cables and accessories", series: "Cables and accessories shared parts", placed_by: "label Bogus Label" })]);
  check("SABOTAGE C1: a shared-parts label the mapping does not list is reported, a listed one is not", c1.length === 1 && c1[0].sku === "ZZ-C1-UNLISTED" && /not listed/.test(c1[0].why), JSON.stringify(c1));
  const c1v = labelViolations([
    row("ZZ-C1-QUIET", { product_line: "L", series: "L shared parts", placed_by: "label X" }),
    row("ZZ-C1-JUDGED", { product_line: "L", series: "L shared parts", placed_by: "label X", label_evidence: "none: no series token" })]);
  check("SABOTAGE C1: a direct shared-parts label row with no evidence passes; one that recorded evidence is refused for that reason", c1v.length === 1 && c1v[0].sku === "ZZ-C1-JUDGED" && /not judged/.test(c1v[0].why), JSON.stringify(c1v));
  // pre-ruling C10: a generic form-factor noun of the series name is not evidence; a product token of the name still is
  {
    const ctx = { family: null, siblings: [{ series: "Fiber and M12 cables (CB-)", family: null }, { series: "NIM (Network Interface Modules)", family: null }] };
    const fq = labelEvidence({ sku: "FQMAP46CG", name: "Fiber Optic Migration Adapter Panel - 4 MPO Adapters – Type B" }, "Fiber and M12 cables (CB-)", ctx);
    check("SABOTAGE C10: FQMAP46CG is not kept in the CB- series by the word Fiber", fq.kind === "none", JSON.stringify(fq));
    const mpo = labelEvidence({ sku: "ZZ-TRUNK-12", name: "MPO trunk cable, 12 fibre" }, "Fiber patch panels and MPO / breakout cables (CB- / PP)", ctx);
    check("SABOTAGE C10: and the product token MPO still evidences the renamed series (the stop-words took only the generic nouns)", mpo.kind === "name" && mpo.detail === "MPO", JSON.stringify(mpo));
  }

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
  // wireless round: a W that starts "Wireless" is not a watt; "1900W HVAC" still is
  const wlc = { family: null, siblings: ["2500 (2504)", "3500 (3504)", "5500 (5508 / 5520 / 5540)", "8500 (8510 / 8540 / 8580)"].map((s) => ({ series: s, family: null })) };
  e = v("AIR-FAN-C220M4=", "Spare fan - Cisco 5520 Wireless Controller", "5500 (5508 / 5520 / 5540)", wlc);
  check("SABOTAGE label: '5520 Wireless Controller' is the platform 5520, not 5520 W", e.kind === "name" && e.detail === "5520", JSON.stringify(e));
  e = v("ZZ-PSU-5520W", "Power supply 5520 W AC", "5500 (5508 / 5520 / 5540)", wlc);
  check("SABOTAGE label: and '5520 W AC' is still a wattage (the fence kept its reason)", e.kind === "none", JSON.stringify(e));
  e = v("PWR-ADPT-18W", "Power adaptor, 18W, for Catalyst 1000 switches", "Catalyst 1000", { ...cat, family: null });
  check("SABOTAGE label: the whole series name in the name keeps it", e.kind === "name" && e.detail === "Catalyst 1000", JSON.stringify(e));
}

console.log(`    layers standing: ${passed} passed, ${misses.length} missed (${REVIEWED.join(", ")})`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
