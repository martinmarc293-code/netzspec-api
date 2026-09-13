// gen.mts — builds the two deliverables from classified.json / summary.json / control.json and rules.mts:
//   D:/tmp/kindlayer-III0/B/deploy-role-series.proposed.json
//   D:/tmp/kindlayer-III0/B/III0-3-series-roles.md
// No DB access. Re-run classify.mts and control.mts first.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { RULES, STRIP, SPEC_AP, SPEC_ROUTER } from "./rules.mts";

const B = "D:/tmp/kindlayer-III0/B";
const rows: any[] = JSON.parse(readFileSync(`${B}/classified.json`, "utf8"));
const summary: any = JSON.parse(readFileSync(`${B}/summary.json`, "utf8"));
const control: any = JSON.parse(readFileSync(`${B}/control.json`, "utf8"));
const controlTxt = readFileSync(`${B}/control.txt`, "utf8").replace(/\r/g, "");
const dumpedAt = statSync(`${B}/parts.json`).mtime.toISOString();

const KIND_LABEL: Record<string, string> = { switch: "switches.switch", ap: "wireless.ap", router: "routers.enterprise (target name `router`)", phone: "collaboration-endpoints.phone" };
const DOMAIN: Record<string, string[]> = {
  switch: ["smb", "access", "core-agg", "datacenter", "industrial"],
  ap: ["indoor", "outdoor", "industrial", "smb", "mesh-extender"],
  router: ["branch", "smb", "edge", "industrial-iot"],
  phone: ["desk", "wireless", "dect", "conference"],
};
const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + "%" : "-");
const esc = (s: string) => String(s).replace(/\|/g, "\\|");
const ruleById = new Map(RULES.map((r) => [r.id, r]));
const placeholder = (n: string) => /^Cisco\s+\S+$/.test(String(n).trim()) || !String(n).trim();

// ---------------- per (kind, series, rule) rows for the data file
type Agg = { kind: string; series: string; rule: string; parts: number; role: string | null; issue: string | null; samples: any[]; spec: string | null };
const aggs = new Map<string, Agg>();
for (const r of rows) {
  const key = `${r.kind}\u0001${r.series}\u0001${r.rule}`;
  let a = aggs.get(key);
  if (!a) { a = { kind: r.kind, series: r.series, rule: r.rule, parts: 0, role: r.role, issue: r.issue, samples: [], spec: r.spec_role }; aggs.set(key, a); }
  a.parts++;
  if (a.samples.length < 3 && !placeholder(r.name)) a.samples.push(`${r.sku} «${r.name.slice(0, 80)}»`);
}
for (const a of aggs.values()) if (a.samples.length === 0) { const r = rows.find((x) => x.kind === a.kind && x.series === a.series && x.rule === a.rule); a.samples.push(`${r.sku} «${r.name.slice(0, 80)}» (placeholder name)`); }
const seriesInfo = new Map<string, any>();
for (const s of summary.series) seriesInfo.set(`${s.kind}\u0001${s.series}`, s);

const dataRows = [...aggs.values()]
  .sort((a, b) => a.kind.localeCompare(b.kind) || (seriesInfo.get(`${b.kind}\u0001${b.series}`).parts - seriesInfo.get(`${a.kind}\u0001${a.series}`).parts) || a.series.localeCompare(b.series) || b.parts - a.parts)
  .map((a) => {
    const si = seriesInfo.get(`${a.kind}\u0001${a.series}`);
    const nRoles = Object.keys(si.roles).length;
    const confidence = a.issue || !a.role ? null : nRoles > 1 ? "rule" : "read";
    const rule = ruleById.get(a.rule);
    return {
      kind: a.kind, series: a.series,
      token_rule: a.rule === "unmatched" ? null : a.rule,
      role: a.role, kind_issue: a.issue, confidence, parts: a.parts,
      spec_v2_proposal: a.kind === "switch" ? (si.spec === "-" ? null : si.spec) : a.spec,
      evidence: a.rule === "unmatched" ? "no rule matches; left null (a role is never guessed)" : rule!.evidence,
      names: a.samples,
    };
  });

const data = {
  $comment: "PROPOSAL for data/reference/deploy-role-series.json — Part III.0 item 3 of kind-layer spec v2. Not written into the repo. Evaluate per part: normalise the SKU, take the kind's rules in order, first match wins; a kind_issue rule means the row is not a member of the kind (role null, reported as a kind issue); no match means role null (unresolved, counted). Series is carried for traceability only: the live series labels are too unreliable to key on (see III0-3-series-roles.md).",
  generated: new Date().toISOString(),
  measured_on: {
    database: "netzspec (read-only session, application_name agent/kindlayer-B)", dumped_at: dumpedAt,
    population: "vendor cisco, parts.retired_at IS NULL, product_class = 'hardware', kind = partKind(category, sku, name) from src/core/partKind.ts",
    kinds: Object.fromEntries(Object.keys(DOMAIN).map((k) => [k, KIND_LABEL[k]])),
  },
  domains: DOMAIN,
  sku_normalisation: { strip_leading_prefixes: STRIP.source, applied_repeatedly: 3, uppercase: true, raw_form: "upper(sku) with trailing '=' removed (used by `sku_raw` patterns)" },
  rules: RULES.map((r, i) => ({
    order: i + 1, kind: r.kind, id: r.id,
    match: { ...(r.re ? { sku_normalised: r.re.source } : {}), ...(r.raw ? { sku_raw: r.raw.source } : {}), ...(r.name ? { name: r.name.source } : {}) },
    role: r.role ?? null, kind_issue: r.issue ?? null,
    parts_matched: rows.filter((x) => x.rule === r.id).length, evidence: r.evidence,
  })),
  rows: dataRows,
  summary: Object.fromEntries(Object.entries(summary.kinds).map(([k, v]: [string, any]) => [k, {
    parts: v.parts, members_of_kind: v.members, roles: v.roles, kind_issues: v.issue_total, kind_issues_by_type: v.issues,
    role_null_unresolved: v.unresolved, null_share_of_members: v.null_share_members, null_share_of_all_rows_if_kind_issues_stay: v.null_share_all,
    series: v.series_count, name_token_control: control[k],
  }])),
};
writeFileSync(`${B}/deploy-role-series.proposed.json`, JSON.stringify(data, null, 1));

// ---------------- markdown
const md: string[] = [];
const K = summary.kinds;
md.push("# III.0 item 3 — series → deploy_role, hand-read (switch, ap, router, phone)");
md.push("");
md.push(`**Measured** ${dumpedAt.slice(0, 16).replace("T", " ")} UTC on \`netzspec\` (read-only session \`agent/kindlayer-B\`). Population: Cisco, \`retired_at IS NULL\`, \`product_class = 'hardware'\`, kind = \`partKind(category, sku, name)\` (live module, called with the name). Spec-doc = at least one linked document whose \`doc_type\` is in \`SPEC_BEARING\`.`);
md.push("");
md.push("**Method.** Every series of the four kinds was listed (all SKUs, collapsed by region suffix and by model token) and read; roles were written as ordered SKU-token rules (`scripts/rules.mts`), applied to every live row, and the output was read again per series and per rule (`classify-report.txt`) until every row either had a role, was identified as not belonging to the kind, or was left null deliberately. Checks: 54 witness SKUs (the traps found while reading) all pass; 4 sabotaged rule lists each fail on the witness they protect (`control.txt`); a name-token control over all role-assigned rows found 6 contradictions, all six false positives of the control itself (\"Spare Chassis\" on a fixed switch, \"Israel\" containing ISR, \"No DECT Radio\").");
md.push("");
md.push("**Confidence.** `read` = the series (its members, kind issues excluded) resolves to a single role and every row was read; `rule` = the series mixes roles and the SKU token rule is load-bearing; `null` = no role (kind issue or deliberately unresolved).");
md.push("");
md.push("**Why the rules key on SKU tokens, not on `series`.** The live `series` label is wrong often enough to invert roles: `routers` series `ASR 9000` holds no ASR 9000 (XRv9000 billing PIDs, UCS parts, datasheet cells); `8000` holds Catalyst 8100–8600 *Secure Routers*, not the SP 8000; `High-Speed WAN Interface Cards` holds 38 router bundles, not cards; `3800 Series ISR` holds CW9177/IW916x access points and `MCS0…MCS31` cells; wireless `Catalyst 9163` is 27 indoor APs + 5 outdoor; `Catalyst Embedded Controller` includes 37 outdoor C9124AX; `Catalyst 9800 Series Wireless Controllers` is 18 APs. A series-keyed table would carry those errors into `deploy_role`. The data file therefore carries series for traceability, and the role comes from the token rule.");
md.push("");
md.push("## 1. Summary per kind");
md.push("");
md.push("| kind | live parts | series | members of the kind | kind issues (not this kind) | role null (unresolved) | null share of members | null share of all rows if the kind issues stay | roles |");
md.push("|---|---|---|---|---|---|---|---|---|");
for (const k of Object.keys(DOMAIN)) {
  const v = K[k];
  md.push(`| ${KIND_LABEL[k]} | ${v.parts} | ${v.series_count} | ${v.members} | ${v.issue_total} (${pct(v.issue_total, v.parts)}) | ${v.unresolved} | ${pct(v.unresolved, v.members)} | ${pct(v.unresolved + v.issue_total, v.parts)} | ${DOMAIN[k].map((r) => `${r} ${v.roles[r] ?? 0}`).join(" · ")} |`);
}
md.push("");
md.push("The acceptance bar (≤ 3 % null per kind) is met on members for all four kinds. It is **not** met on the current rows for switch (8.9 %), router (21.5 %) and phone (16.6 %) unless the kind issues in §6 are moved out of the kind first — they are not unresolved roles, they are rows that are not switches / routers / phones, and III.4 should count them separately rather than let them fail the role bar.");
md.push("");
md.push("Spec-row agreement (row by row against the spec's proposal: A.2 for switch, the prose of II.3/II.4/II.10 for the others):");
md.push("");
md.push("| kind | agree | different role | spec gave a role, row is a kind issue | spec gave a role, left null | spec had no proposal / `?` |");
md.push("|---|---|---|---|---|---|");
for (const k of Object.keys(DOMAIN)) { const s = K[k].spec_rows; md.push(`| ${k} | ${s.agree} | ${s.differ_role} | ${s.kind_issue_spec_gave_role} | ${s.unresolved_spec_gave_role} | ${s.spec_none_or_q} |`); }
md.push("");

// --- the consequential findings (hand-written from the reading; numbers from the run)
const ser = (k: string, s: string) => seriesInfo.get(`${k}\u0001${s}`);
const n = (k: string, s: string) => ser(k, s)?.parts ?? 0;
md.push("## 2. Most consequential disagreements with the spec");
md.push("");
md.push(`1. **switch — the four \"Business\" series are SMB, not industrial.** A.2 proposes \`industrial (heuristic)\` for \`Business 350\` (${n("switch", "Business 350")}), \`Business 250 Smart\` (${n("switch", "Business 250 Smart")}), \`Business 220\` (${n("switch", "Business 220")}) and \`Business 110 Series Unmanaged\` (${n("switch", "Business 110 Series Unmanaged")}) — ${n("switch", "Business 350") + n("switch", "Business 250 Smart") + n("switch", "Business 220") + n("switch", "Business 110 Series Unmanaged")} rows. Every one is a Cisco Business (CBS) switch: \`CBS350-24FP-4G-JP «CBS350 Managed 24-port GE, Full PoE»\`, \`CBS250-8T-E-2G-EU «CBS250 Smart 8-port GE, Ext PS»\`, \`CBS110-16PP «16 10/100/1000 ports (8 support PoE with 64W power budget)»\`. Applied as proposed, 623 SMB switches (plus 5 placeholder rows in the same series) would be asked \`ip_rating\`, DC \`input_voltage\` and \`mounting\`. A.2's role total \`industrial 879\` is therefore ~4× the real industrial population (${K.switch.roles.industrial}).`);
md.push(`2. **switch — \`Catalyst 1200\` / \`Catalyst 1300\` / \`1300X\` are SMB (Linux SB-OS successors of CBS250/350), \`Catalyst 1000\` stays access (IOS).** Evidence: \`C1200-8T-E-2G «Catalyst-1200-Managed-Switch (L2, Linux)»\` vs \`C1000-24P-4X-L «Catalyst-1000-Managed-Switch (L2, IOS)»\`. 54 rows move from the spec's \`access (heuristic)\` to \`smb\`. This is the one judgement in the switch table that is not read off a name token; it is flagged for the operator.`);
md.push(`3. **switch — 441 rows (8.9 %) are not switches at all** (§6): 13 MDS Fibre-Channel switches/directors (A.2: datacenter), 20 Cisco 7600 routers and 21 service modules/line cards inside \`Catalyst 6500\`, 61 Sup+line-card *upgrade options* without a chassis (59 inside \`Catalyst 4500\`, 2 inside \`Catalyst 9400\`), 26 third-party cabling PNs and 5 PSU placeholders inside \`Catalyst 9300\`, 12 PON ONT/OLT (A.2: access), 34 Nexus 7000 door/support/packaging kits, 42 licences, 41 datasheet cells (\`Cisco IPv6\`, \`Cisco 0.75K\`, \`Cisco 97436\`).`);
md.push(`4. **switch — \`4948E\` / \`4900\` are datacenter top-of-rack, not core-agg**; \`N9300\` (A.2: access) is 4 Nexus N9324C/N9348Y2C6D DPU switches → datacenter; \`ME 3400E\` (A.2: industrial) is metro-Ethernet access → access. The 23 \`?\` series / 92 rows (MS120…MS450, Tetration, 4948E, Room Series, CMICR, C9610, 6807XL, IX5000, Network Modules) are all resolved (table §4.1).`);
md.push(`5. **router — the spec's wrong-table moves are mostly wrong about what the rows are.** \`High-Speed WAN Interface Cards\` (38 → \"module\") are 38 *router bundles* (\`C1921-3G-G-K9 «C1921 w/3.5G HWIC»\`) → branch. \`ASR 9000\` (35 → sp-core) contains no ASR 9000: 13 XRv9000 billing PIDs, 14 VTMS/VSLN cells, 4 XRv appliances, 4 UCS/NIC parts. \`8000\` (33 → sp-core) is 16 Catalyst 8100–8375 Secure Routers (branch), 3 C8550/C8570/C8650 (edge), 4 Silicon One switches, 5 licences, 4 cells, 1 unresolved. \`Carrier Routing System\` (11) is 7 CRS line-card bundles + 4 licences — no CRS router. \`WAN Automation Engine\` (17 → appliance) is 17 software/licence PIDs, no appliance. \`NCS 5500\` (2) is a CFP2 optic. Only \`5000 Enterprise Network Compute\` (10 → appliance) is as the spec says.`);
md.push(`6. **router — \`800 ISR\` (${n("router", "800 ISR")}) is the *Industrial* ISR IR809/IR829, not the branch ISR 800** → 36 industrial-iot (spec: branch); \`C819H*\` hardened M2M routers inside \`800\` → 18 industrial-iot. \`Catalyst Wireless Gateway CG113\` (spec: industrial-iot) is a desktop remote-worker/small-branch Wi-Fi 6 + LTE gateway with no rugged variant → branch (flagged). 337 router rows (21.4 %) are not routers (§6), led by 122 licence/software/planning PIDs and 86 datasheet cells.`);
md.push(`7. **ap — two series labels invert role:** \`Catalyst 9163\` (spec: outdoor) is 27 indoor + 5 outdoor; \`Catalyst Embedded Controller\` (spec: indoor) contains 37 outdoor C9124AX-EWC. \`Aironet 1550\` (spec: outdoor) holds 46 industrial (1552H hazardous-location, 1552SA/SD ISA100/WirelessHART, 1552WU) beside 56 outdoor. \`Business 100\` (spec: smb) holds 92 mesh extenders (CBW141ACM/143ACM and their packs). The spec's ap role grouping is right; its series mapping is not usable.`);
md.push(`8. **phone — 8865 is a desk phone, not wireless.** II.10 lists \"8865 Wi-Fi\" under wireless; every 8865 row is a desk video phone (\`CP-8865-K9 «Cisco IP Phone 8865, Charcoal»\`, \`CP-8865NR-K9 «No Radio variant»\`) — Wi-Fi is a network option of a corded desk set. Conversely the spec's desk default misses 61 wireless 7920/7921G/7925G/7926G and 6 conference 7935 rows inside \`7900 - Unified IP Phone\`, 3 WP-9821 inside \`Desk Phone 9800 Series\`, and 30 + 6 conference 8831/8832 inside the 8800 series. 85 phone rows (16.6 %) are accessories/spares/expansion modules/subscriptions.`);
md.push("");

// --- per-kind series tables
md.push("## 3. Mixed series and the rules that split them (measured)");
md.push("");
md.push("A series is *mixed* when its member rows resolve to more than one role. The splitting rule is the SKU token rule named; rows per role are live counts; unresolved rows in these series are 0 unless stated.");
md.push("");
md.push("| kind | series | roles (rows) | kind issues | unresolved | rules that split it |");
md.push("|---|---|---|---|---|---|");
for (const m of summary.mixed) {
  md.push(`| ${m.kind} | ${esc(m.series)} | ${Object.entries(m.roles).map(([r, c]) => `${r} ${c}`).join(" · ")} | ${Object.values(m.issues).reduce((a: number, b: any) => a + b, 0)} | ${m.unresolved} | ${m.rules.map((x: any) => `\`${x.id}\` ${x.n}`).join(", ")} |`);
}
md.push("");
md.push("Splitting rules in words (full patterns in the JSON):");
md.push("");
md.push("- **ap, outdoor vs indoor within Catalyst 91xx:** the model number decides, not the I/E/P antenna suffix — `C9124AX*`, `CW9163E`, `CW9177*`, `MR76/78/86` are outdoor; `C9105/9115/9117/9120/9130/9136`, `CW9162/9164/9166/917x/9179` indoor whatever the suffix (`C9120AXE` = external-antenna *indoor*). Aironet `1540/1560/1570/1552E/EU/I/C/CU` outdoor; `1552H` (hazardous location), `1552SA/SD` (ISA100/WirelessHART), `1552WU` (WirelessHART gateway) industrial. `WAP571E` outdoor inside SMB series.");
md.push("- **ap, smb vs mesh-extender:** `CBW141ACM/142ACM/143ACM` and their `3-`/`5-` packs and `CBW14[12]x-…-MULTI` bulk PIDs are mesh extenders; `CBW140/145/150/240` and `WAP1xx–5xx` are smb. `CBW140MXS` (starter kit = AP + extenders) is a bundle and stays null.");
md.push("- **switch, access vs smb:** `CBS110/220/250/350`, `SF/SG/SX 95–550(X/XG)`, `C1200`, `C1300(X)` smb; `C1000`, `WS-C2960L`, Catalyst 2960/3560/3650/3750/3850/9200/9300/9350 access. **core-agg vs access in 6800:** `C6800IA` (Instant Access) access, `C6807/C68x0-X` core-agg. **4900:** `WS-C4948*/4900M` datacenter, `ME-3800X/ME-4924` core-agg, `ME-3600X` access, `WS-C4928-10GE` null.");
md.push("- **router:** `C819H*` (Hardened) industrial-iot vs `C819G*` branch; `IR8xx/IR1xxx/IR5xx/IR8xxx`, `CGR`, `IXM`, `CG418/CG522`, `CISCO59xx`, `ESR-6300` industrial-iot; `ASR1xxx/ASR1K`, `C85xx/C8650`, `7206VXR`, `76xx` edge; `RV`, `CVR328W` smb; `C8xx/C9xx/C11xx/ISR1100/C18xx–C39xx/ISR4xxx/C8200/C8300/C81x0–C8375` branch. `C8455-G2`/`C8475-G2` (8400 Secure Router) left null: the name does not place it between branch and edge.");
md.push("- **phone:** conference `CP-7935/7936/7937`, `CP-7832`, `CP-8831` (Base/Control Panel), `CP-8832`, `CP-ROOM`; wireless `CP-7920…7926`, `CP-8821`, `CP-840/860(S)`, `WP-9821`; dect `CP-6823/6825`; everything else a desk model (`CP-78xx/79xx/88xx/68xx/69xx/3905`, `DP-98xx`, `SPA3xx/5xx`). Accessory tokens are tested first (`-BEZEL`, `-HS`, `-HS-HOOK`, `8831-DC/DCU/MIC/BASE`, `8832-DC/ETH/POE/USB/MIC`, chargers, `-MK9` subscriptions, `CP-791[456]` expansion modules).");
md.push("");

for (const k of Object.keys(DOMAIN)) {
  md.push(`## 4.${Object.keys(DOMAIN).indexOf(k) + 1} ${KIND_LABEL[k]} — every live series`);
  md.push("");
  const specHead = k === "switch" ? "A.2 proposal" : k === "phone" ? "II.10 (desk default; 8821/8865 wireless; 7832/8832/Room conference; DECT series dect)" : k === "ap" ? "II.4 grouping" : "II.3 grouping / move";
  md.push(`| series | parts (A.2/A.3–A.5) | spec-doc | proposed role(s) | kind issues | null | confidence | ${specHead} | rows disagreeing | evidence (SKU «name») |`);
  md.push("|---|---|---|---|---|---|---|---|---|---|");
  const list = summary.series.filter((s: any) => s.kind === k).sort((a: any, b: any) => b.parts - a.parts);
  for (const s of list) {
    const roles = Object.entries(s.roles).map(([r, c]) => `${r} ${c}`).join(" · ") || "—";
    const issues = Object.entries(s.issues).map(([r, c]) => `${c} ${r}`).join("; ") || "—";
    const nr = Object.keys(s.roles).length;
    const conf = nr === 0 ? "null" : nr > 1 ? "rule" : "read";
    let spec = k === "switch" ? s.spec : k === "ap" ? (SPEC_AP[s.series] ?? "—") : k === "router" ? (SPEC_ROUTER[s.series] ?? "—") : "desk/token";
    spec = spec.replace("KIND:", "move to ");
    const partsCell = k === "switch" && s.spec_parts !== null && s.spec_parts !== s.parts ? `${s.parts} (A.2 ${s.spec_parts})` : `${s.parts}`;
    md.push(`| ${esc(s.series)} | ${partsCell} | ${s.spec_doc} | ${roles} | ${esc(issues)} | ${s.unresolved} | ${conf} | ${esc(spec)} | ${s.disagree_rows} | ${esc(s.samples.slice(0, 3).map((x: any) => `${x.sku} «${x.name.slice(0, 60)}»`).join("; "))} |`);
  }
  md.push("");
  if (k === "switch") {
    md.push("**A.2 `?` rows resolved:** MS120, MS125, MS130, MS130 Desktop, MS130R, MS150, MS210, MS225, MS250, MS350, MS355, MS390 → access (`«cloud-gemanagter … Layer-2/3-Access-Switch»`); MS410, MS425, MS450 → core-agg (`«Layer-3-Aggregations-Switch»`); Tetration Analytics → datacenter (4 × Nexus 93180YC); 4948E → datacenter (top-of-rack Catalyst); Room Series → access 2 (`CS-PANO-SWITCH` = Catalyst 3560-CX / C1000) + smb 1 (`C1200-8FP-2G-OPT`); CMICR → access; C9610 → core-agg 1 + `C14-C15` power-cord cell; 6807XL → core-agg; TelePresence IX5000 → access (2 × Catalyst 2960C, A.2 said 1); Network Modules → core-agg (`WS-C4510RE-S7+96V+` chassis bundle).");
    md.push("");
    md.push("**A.2 `heuristic` rows:** confirmed — 250 Smart, 350 Managed, 350X Stackable Managed, 110 Unmanaged, 220 Smart, 350, 550X, 350X, 550X Stackable Managed, 95 Unmanaged (smb); 1000, Catalyst Micro, Digital Building Series (access); Embedded Services 2020, Embedded Service 3000, Catalyst ESS9300 Embedded (industrial). Corrected — Business 350, Business 250 Smart, Business 220, Business 110 Series Unmanaged (industrial → smb); 1200, 1300, Catalyst 1300, Catalyst 1300X (access → smb); ME 3400E Ethernet Access (industrial → access); PON Series (access → kind issue: ONT/OLT); Configuration Professional for Catalyst (industrial → 2 datasheet cells). **Explicit rows corrected:** 4900 (core-agg → datacenter 15, core-agg 2, access 1, null 1), N9300 (access → datacenter), MDS T/V/S/MS/9700 (datacenter → kind issue FC), Catalyst 6800 + Cat6500 Modules + Cat6800X Modules (core-agg → line cards), C9350 (access → 3 NIMs + 1 cell).");
    md.push("");
    md.push("**Spec table arithmetic:** A.2's heading says 174 series; the table lists 176 rows summing to 4,941 (II.1 says 4,937). Live: 176 series, 4,942 rows — every series count equal to A.2 except TelePresence IX5000 (2, A.2 1). No A.2 series is missing live and no live series is absent from A.2.");
    md.push("");
  }
  if (k === "ap") { md.push("**A.3 vs live:** 32 series, 2,753 rows, every series count identical. Series with no II.4 proposal resolved: 4800 and Aironet 1800 → indoor; Small Business 100/300 → smb; Small Business 500 → smb 21 + outdoor 8 (WAP571E); Catalyst 9800 Series Wireless Controllers → 11 indoor + 7 outdoor APs (no controller in it); Antennas/Accessories → 5 indoor AP bulk PIDs + 1 mount kit; Catalyst Center → indoor; Ultra-Reliable Wireless Backhaul → industrial (IW9165/9167; II.4's `backhaul` kind is the alternative home); Aironet 1800s Active Sensor → kind issue (sensor); 5500 → kind issue (WLC)."); md.push(""); }
  if (k === "router") { md.push("**A.4 vs live:** 47 series, 1,575 rows, every series count identical. Series with no II.3 proposal resolved: 8100 Series Secure / 8200 Series Secure → branch; Catalyst 8500L → edge; 5900 Embedded Services / ESR6300 Embedded / Catalyst IR8100 / IR8300 / Catalyst Cellular Gateways → industrial-iot; Network Modules → branch 5 (router+WAAS bundles) + edge 1 (ASR1001-HX); Port Adapters → branch (`CISCO3845-V/K9`); Terminal Services Gateways / Secure Console → kind issue (terminal servers); 6000, Cloud Native BNG, Catalyst 8000V Edge Software, ASR 920 → licences; 8400 Series Secure → null (1)."); md.push(""); }
  if (k === "phone") { md.push("**A.5 vs live:** 14 series, 513 rows, every series count identical. No series is single-role by label except SPA300/SPA500/IP DECT 6800/Room Phone; the role is on the model token."); md.push(""); }
}

md.push("## 5. Rules, in evaluation order, with live match counts");
md.push("");
md.push("| # | kind | rule | role / kind issue | parts | evidence |");
md.push("|---|---|---|---|---|---|");
RULES.forEach((r, i) => md.push(`| ${i + 1} | ${r.kind} | \`${r.id}\` | ${r.role ?? "issue: " + r.issue} | ${rows.filter((x) => x.rule === r.id).length} | ${esc(r.evidence)} |`));
md.push(`| — | all | (no rule) | null | ${rows.filter((x) => x.rule === "unmatched").length} | ${rows.filter((x) => x.rule === "unmatched").map((x) => `${x.sku} «${x.name.slice(0, 50)}»`).join("; ")} |`);
md.push("");
md.push("## 6. Kind issues found (rows that are not the kind) — for the II.x move lists, not for deploy_role");
md.push("");
for (const k of Object.keys(DOMAIN)) {
  md.push(`**${KIND_LABEL[k]}** — ${K[k].issue_total} rows:`);
  md.push("");
  md.push("| what the rows are | rows | examples |");
  md.push("|---|---|---|");
  for (const [iss, c] of Object.entries(K[k].issues).sort((a: any, b: any) => b[1] - a[1])) {
    const ex = rows.filter((x) => x.kind === k && x.issue === iss);
    const named = ex.filter((x) => !placeholder(x.name));
    const pick = (named.length >= 3 ? named : ex).slice(0, 3).map((x) => `${x.sku} «${x.name.slice(0, 55)}» [${x.series}]`).join("; ");
    md.push(`| ${esc(iss)} | ${c} | ${esc(pick)} |`);
  }
  md.push("");
}
md.push("## 7. Controls");
md.push("");
md.push("```");
md.push(controlTxt.trim());
md.push("```");
md.push("");
md.push("Silent rows are placeholder names (`Cisco <sku>`) or names with no role token; the router `branch` control is weak (303 silent) because many ISR bundle names carry only a model number — the rule there rests on the SKU, which is the evidence.");
md.push("");
md.push("## 8. Open points for the operator (not guessed)");
md.push("");
md.push("- `C8455-G2`, `C8475-G2` (Cisco 8400 Secure Router): branch or edge — left null. `WS-C4928-10GE`: left null.");
md.push("- Catalyst 1200/1300 → smb (54 rows) is a judgement from the OS line (SB-OS/Linux vs IOS); if the operator prefers the product-family name (\"Catalyst\"), they become access.");
md.push("- `service-provider-access` is **not** proposed: the ME rows that are switches number 14 (ME-3400E family 11, ME-3600X 1, ME-3800X 1, ME-4924 1) and the PON rows are ONT/OLT, not switches. Below any useful population.");
md.push("- `CG113` → branch and `CG418-E/CG522-E` → industrial-iot are read from the names (desktop remote-worker gateway vs IP-rated external-antenna cellular gateway); the spec put CG113 in industrial-iot.");
md.push("- Modular chassis (C9404R/C9407R/C9410R/C9606R/C9610R, WS-C45xx/65xx, N7K/N77/N9K-C95xx/98xx) carry their switch role here; II.1 plans a `chassis` kind for them, which would not carry `deploy_role`.");
md.push("- Catalyst 4500/9400 are core-agg per II.1 although Cisco positions both as modular campus *access*; the row-shape argument (slots, supervisors, redundancy) supports II.1 and it is kept.");
writeFileSync(`${B}/III0-3-series-roles.md`, md.join("\n"));
console.log("written", dataRows.length, "data rows,", md.length, "md lines");
