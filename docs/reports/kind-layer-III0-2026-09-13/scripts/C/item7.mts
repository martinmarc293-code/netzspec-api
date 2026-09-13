// Items 4, 5 and 7: the spec's named suspicions, counted and read. Every classification written after reading the rows.
import { readFileSync, writeFileSync } from "node:fs";
const parts: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/parts.json", "utf8"));
const pop = (c: string, k?: string) => parts.filter((p) => p.category === c && (k === undefined || p.kind === k));
type Row = { sku: string; name: string; series: string; held: string; own: number; is: string };
const first = (rules: [RegExp, string, "sku" | "name" | "series" | "any"][], p: any, dflt: string) => {
  for (const [re, label, field] of rules) {
    const v = field === "any" ? `${p.sku} ${p.name ?? ""}` : String(p[field] ?? "");
    if (re.test(v)) return label;
  }
  return dflt;
};
const toRow = (p: any, is: string): Row => ({ sku: p.sku, name: p.name ?? "", series: p.series ?? "", held: p.held, own: p.own_facts, is });
const summarise = (rows: Row[]) => {
  const m: Record<string, any> = {};
  for (const r of rows) { const e = m[r.is] ??= { is: r.is, n: 0, spec: 0, eol_only: 0, no_doc: 0, samples: [] as string[] }; e.n++; e[r.held]++; if (e.samples.length < 3) e.samples.push(`${r.sku} — ${r.name.slice(0, 60)}`); }
  return Object.values(m).sort((a: any, b: any) => b.n - a.n);
};
const out: any = {};

// ---- item 4: video.optic
{
  const rows = pop("video", "optic").map((p) => toRow(p, /^RPHY-S10G-/.test(p.sku)
    ? `Remote PHY SFP+ 10G optic (${p.sku.match(/-(\d+K)-/)?.[1]} reach) — pluggable`
    : /^10-1022/.test(p.sku) ? "10-1022xxx-01 part number, placeholder name, no document — cannot tell pluggable from fixed" : "other"));
  out.item4 = { total: rows.length, summary: summarise(rows), rows };
}

// ---- item 5: optical-networking pluggables
{
  const tx = new Map<string, string[]>();
  for (const p of pop("transceiver")) { const b = p.sku.replace(/=$/, ""); (tx.get(b) ?? tx.set(b, []).get(b)!).push(`${p.sku} (${p.kind})`); }
  const rows = [...pop("optical-networking", "pluggable"), ...pop("optical-networking", "pluggable-tunable")].map((p) => {
    const sib = tx.get(p.sku.replace(/=$/, ""));
    let is = /LIC/.test(p.sku) ? "licence PID (not a pluggable) -> class software"
      : /BDL|BUN/.test(p.sku) ? "pluggable bundle -> bundle"
      : /CFP2/.test(p.sku) ? "coherent tunable CFP2/CFP2-DCO pluggable -> transceiver.tunable"
      : /QSP28/.test(p.sku) ? "typo PID of ONS-QSFP28-LR4= (placeholder name) -> duplicate"
      : "fixed-wavelength pluggable (CPAK / CXP / CXP2 / QSFP28) -> transceiver.pluggable";
    return { ...toRow(p, is), kind: p.kind, base_pid_in_transceiver: sib ? sib.join(", ") : null };
  });
  out.item5 = { total: rows.length, summary: summarise(rows), rows,
    also_outside_transceiver: parts.filter((p) => p.category !== "transceiver" && /^(ONS-(SI|SE|C2)|10GBASE-|1000BASE-|WS-G5)/.test(p.sku))
      .map((p) => ({ category: p.category, kind: p.kind, sku: p.sku, name: p.name, held: p.held, base_pid_in_transceiver: tx.get(p.sku.replace(/=$/, "")) ?? null })) };
}

// ---- item 7a: routers.enterprise named series, read row by row
{
  const named = /High-Speed WAN|WAN Automation|Carrier Routing|^ASR 9000$|^8000$|5000 Enterprise Network|Network Convergence System 5500|^RV Series$|^6000$|Network Modules|Port Adapters|Cloud Native|5900 Embedded/;
  const rules: [RegExp, string, "sku" | "name" | "series" | "any"][] = [
    // hardware identified by SKU first — several hardware names carry the word "License" ("Licensed 100G only", "IOS Software License")
    [/^(P100|P200|Q100|Q200|CP-DQPSK|V6-INLN)$/, "placeholder token (Silicon One ASIC names etc.) -> non_product", "sku"],
    [/^C8[1-6]\d\d.*-G2$/, "Cisco 8100-8600 Secure Router (enterprise branch/edge) -> router (series label '8000' is wrong)", "sku"],
    [/^CQ211/, "Silicon One 48x100G switch -> switches category", "sku"],
    [/^ONS-C2-WDM/, "CFP2-DCO WDM pluggable -> transceiver category", "sku"],
    [/^ENCS/, "ENCS 5100/5400 NFV compute -> appliance", "sku"],
    [/^CISCO5921/, "software / licence / planning PID -> class software or non_product", "sku"],
    [/^CISCO59/, "5900 embedded services router card -> router (embedded)", "sku"],
    [/^ASR1001-HX/, "ASR 1001-HX router chassis -> router (series label wrong)", "sku"],
    [/WAAS/, "ISR + SRE WAAS bundle -> router bundle", "sku"],
    [/^CISCO3845-V/, "ISR 3845 voice bundle -> router", "sku"],
    [/^(C18|C19|C28|C29|CISCO18|CISCO28|CISCO38)/, "ISR G1/G2 router bundle (with HWIC/EHWIC) -> router; NOT an interface card", "sku"],
    [/^(RV|CVR|R26)/, "RV / CVR small-business router -> router (role smb)", "sku"],
    [/^UCSC-C220|^UCSX-TPM|^XRV-PCIE/, "UCS server / TPM / NIC component -> servers category", "sku"],
    [/XRV|APLN/, "XRv 9000 appliance (UCS-based) -> appliance", "sku"],
    [/MSC Bundle|MSE Bundle|FP Bundle|MSC400G|FP400G/i, "CRS line-card (MSC/FP) bundle -> linecard / sp-core component", "any"],
    [/Billing PID|Right-to-Use|License|Licence|SW ATO|Subscription|SWSUB|MATE Suite|WAVE Platform|Offer Attribution|SPNA|SIA per|^SPOA|XRd vRouter|Planning PID|material planning|Session scale|Base PID for cnBNG|^S-NC6|^VTMS|^VSLN|^WAE|^SPAUTO|^CP-SW|SW for x86/i, "software / licence / planning PID -> class software or non_product", "any"],
  ];
  const rows = pop("routers", "enterprise").filter((p) => named.test(p.series ?? "")).map((p) => ({ ...toRow(p, first(rules, p, "UNREAD")), seriesLabel: p.series }));
  const bySeries: Record<string, any> = {};
  for (const r of rows) { const s = bySeries[r.seriesLabel] ??= { series: r.seriesLabel, n: 0, is: {} as Record<string, number> }; s.n++; s.is[r.is] = (s.is[r.is] ?? 0) + 1; }
  // SKU-shape control across ALL of routers.enterprise, independent of the series label
  const all = pop("routers", "enterprise");
  const shape = (re: RegExp) => all.filter((p) => re.test(p.sku)).length;
  out.item7_enterprise = { total_enterprise: all.length, rows_in_named_series: rows.length, bySeries: Object.values(bySeries), summary: summarise(rows),
    sku_shape_control_all_enterprise: {
      "HWIC/EHWIC/WIC/VWIC SKU": shape(/^(E?HWIC|V?WIC)-/), "ASR 9000 SKU (ASR-9xxx, A9K-, A99-)": shape(/^(ASR-9|ASR9|A9K-|A99-)/),
      "NCS SKU": shape(/^(NCS|N540|N560|NC5)/), "CRS SKU": shape(/^CRS-/), "Cisco 8000 SP SKU (8xxx-, 88-)": shape(/^(8\d\d\d-|88-)/),
      "C8xxx-G2 Secure Router": shape(/^C8[1-6]\d\d.*-G2$/), "RV/CVR SKU": shape(/^(RV\d|CVR)/), "ENCS SKU": shape(/^ENCS/), "WAE SKU": shape(/WAE/) },
    rows };
}

// ---- item 7b: servers-unified-computing.server rows under a non-UCS series label
{
  const ucs = /^(UCS [CBEX]-Series|S-Series Storage)$/;
  const rules: [RegExp, string, "sku" | "name" | "series" | "any"][] = [
    [/-MLB$/, "UCS MLB bundle -> bundle", "sku"],
    [/^DN3-HW-APL/, "Catalyst Center appliance (UCS-based) -> appliance [decision: category]", "sku"],
    [/^CSP-5[24]00=/, "CSP 5200/5400 appliance chassis spare -> chassis", "sku"],
    [/^CSP-/, "CSP 5000 NFV platform -> server", "sku"],
    [/BAT/, "coin-cell battery -> accessory", "sku"],
    [/^HX-C480-CM/, "C480 M5 CPU module -> accessory / io-module", "sku"],
    [/^(UCSB-B200|UCSC-C220|UCSC-885A|UCSC-C125|UCSXE-1[35]0C)/, "real UCS server/node under a wrong series label -> server (kind right, series wrong)", "sku"],
  ];
  const rows = pop("servers-unified-computing", "server").filter((p) => !ucs.test(p.series ?? "")).map((p) => ({ ...toRow(p, first(rules, p, "UNREAD")), seriesLabel: p.series }));
  out.item7_server = { total_server: pop("servers-unified-computing", "server").length, rows_non_ucs_series: rows.length, summary: summarise(rows), rows };
}

// ---- item 7c: security.firewall rows in the "Secure Client (including AnyConnect)" series
{
  const rows = pop("security", "firewall").filter((p) => /Secure Client|AnyConnect/.test(p.series ?? ""))
    .map((p) => toRow(p, "ASA 5505/5512-5555 VPN edition: firewall appliance bundled with SSL/AnyConnect user licences -> firewall (hardware; series label wrong)"));
  const nameMentions = pop("security", "firewall").filter((p) => /AnyConnect|SSL\d|VPN Edition/i.test(p.name ?? "") && !/Secure Client|AnyConnect/.test(p.series ?? "")).map((p) => toRow(p, "same shape outside that series"));
  out.item7_firewall = { in_series: rows.length, summary: summarise(rows), rows, same_shape_other_series: nameMentions };
}

// ---- item 7d: routers.forwarding, routers.transceiver, collab.server-component, uc.server-component, wireless.appliance, wireless.backhaul, security.appliance
{
  out.item7_forwarding = { rows: pop("routers", "forwarding").map((p) => toRow(p, "ASR 1000 Embedded Services Processor (ESP) = forwarding engine card -> processor/SUPERVISOR-type, not a port-carrying line card")) };
  out.item7_forwarding.summary = summarise(out.item7_forwarding.rows);
  out.item7_rtransceiver = { rows: pop("routers", "transceiver").map((p) => toRow(p, /DCAP|COVER/.test(p.sku) ? "dust cap / cover -> mechanical (NOT a transceiver)" : "SFP installation kit -> mechanical")) };
  out.item7_rtransceiver.summary = summarise(out.item7_rtransceiver.rows);
  out.item7_collab_sc = { rows: pop("collaboration-endpoints", "server-component").map((p) => toRow(p, "IX5000 host CPU (the system's compute unit) -> no UCS component kind fits; video-codec or server [decision]")) };
  out.item7_collab_sc.summary = summarise(out.item7_collab_sc.rows);
  const uc: [RegExp, string, "sku" | "name" | "series" | "any"][] = [
    [/SCSI card/i, "SCSI card -> storage-controller", "name"],
    [/tape drive|SDLT|DAT/i, "tape drive -> drive", "name"],
    [/Motherboard/i, "VG350 motherboard -> no UCS kind (gateway spare) -> accessory", "name"],
    [/^MEM-4460/, "ISR 4460 DRAM -> memory (routers memory, wrong category)", "sku"],
    [/PVDM|VIC2|VWIC/, "voice DSP / voice interface card -> voice-module", "sku"],
    [/E160D-M2BUN/, "UCS-E module bundled with ISR -> bundle", "sku"],
    [/CPU/, "CPU -> cpu", "sku"],
    [/TPM/, "TPM -> tpm", "sku"],
    [/RISER|PCI-1B/, "PCIe riser -> accessory", "sku"],
    [/RAID|MRAID/, "RAID controller / cache -> storage-controller", "sku"],
    [/NIC|PCIE-I|N2XX|ID10GF|MLOM/, "NIC -> nic", "sku"],
    [/MEM|RAM|MR-|DIMM/, "memory -> memory", "sku"],
    [/DISK|HD|HDD|SD960|SD[BC]960|A03-D|M2-240G|SD-|SD Card|MSTOR/,"drive / SD / M.2 storage -> drive", "sku"],
  ];
  const ucRows = pop("unified-communications", "server-component").map((p) => toRow(p, first(uc, p, first(uc.map(([re, l]) => [re, l, "name"]) as any, p, "UNREAD"))));
  out.item7_uc_sc = { total: ucRows.length, summary: summarise(ucRows), rows: ucRows };
  const confRows = pop("conferencing", "server-component").map((p) => toRow(p, first([
    [/B200|5108-PKG/, "Meeting Server blade / chassis packaging -> server / mechanical", "sku"],
    [/FI-M-6324/, "in-chassis fabric interconnect -> fabric-interconnect", "sku"],
    [/UAC1/, "power module -> power", "sku"], [/LSTOR-BK/, "blanking panel -> mechanical", "sku"],
    ...uc,
  ], p, "UNREAD")));
  out.item7_conf_sc = { total: confRows.length, summary: summarise(confRows), rows: confRows };
  const wa = pop("wireless", "appliance").map((p) => toRow(p, first([
    [/^ASR5/, "ASR 5000/5500 mobile packet-core chassis/system -> routers sp-core (wrong category)", "sku"],
    [/^FM1?0+-?GWY|^FM-1?0+-GWY/, "Fluidmesh FM1000/FM10000 gateway -> appliance (URWB gateway)", "sku"],
    [/^(AIR-CMX|AIR-MSE|DN3-LOC)/, "MSE / CMX / DNA Spaces location appliance -> appliance (analytics/location)", "sku"],
  ], p, "UNREAD")));
  out.item7_wireless_appliance = { total: wa.length, summary: summarise(wa), rows: wa };
  const wb = pop("wireless", "backhaul").map((p) => toRow(p, /KIT/.test(p.sku) ? "PONTE radio kit (pair) -> backhaul bundle"
    : /EMB/.test(p.sku) ? "embedded radio board -> backhaul" : "Fluidmesh / URWB radio unit (FM1200/3200/3500/4200/4500/4800) -> backhaul"));
  out.item7_wireless_backhaul = { total: wb.length, placeholder_names: wb.filter((r) => r.name === "Cisco " + r.sku).length, summary: summarise(wb), rows: wb };
  const sa = pop("security", "appliance").map((p) => toRow(p, first([
    [/^(1210|1220)C/, "Secure Firewall 1200 generic PIDs -> firewall", "sku"],
    [/^ASA-VPN/, "ASA VPN bundle -> firewall", "sku"],
    [/^(AMPPC|SEPC)/, "Secure Endpoint private-cloud appliance -> management/analytics appliance [decision]", "sku"],
    [/TETRATION|^TA-CL/, "Secure Workload cluster -> analytics", "any"],
    [/^CSACS|^ISA-FP|^TB-ESS/, "software licence on an appliance (ACS, ISA IDS, Telemetry Broker) -> class software", "sku"],
    [/CHAS/, "Threat Grid chassis -> chassis", "sku"],
    [/BUN/, "Threat Grid appliance + subscription bundle -> bundle", "sku"],
    [/^TG/, "Secure Malware Analytics (Threat Grid) appliance -> no library kind (sandbox) -> APPLIANCE; decision", "sku"],
  ], p, "UNREAD")));
  const bySeries: Record<string, number> = {};
  for (const p of pop("security", "appliance")) bySeries[p.series ?? "(none)"] = (bySeries[p.series ?? "(none)"] ?? 0) + 1;
  out.item7_security_appliance = { total: sa.length, bySeries, summary: summarise(sa), rows: sa };
  // interfaces-modules: CPAK / CFP and any other pluggable-optic rows
  const im = pop("interfaces-modules").filter((p) => /CPAK|CFP/i.test(`${p.sku} ${p.name ?? ""}`));
  const imOptics = pop("interfaces-modules").filter((p) => /^(PHQ4SFP|WDM-SFP)/.test(p.sku)).map((p) => ({ ...toRow(p, /^PHQ4SFP/.test(p.sku) ? "QSFP-to-4xSFP breakout cable (Panduit PID, placeholder name) -> transceiver.breakout-cable" : "2-channel SFP WDM transponder -> no clear home"), kind: p.kind }));
  out.item7_im_cpak = { cpak_cfp_rows: im.length, other_optic_shaped_rows: imOptics };
}
writeFileSync("D:/tmp/kindlayer-III0/C/raw/item4-5-7.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out) as any) {
  console.log(`\n### ${k}`);
  if (v.bySeries) console.log(JSON.stringify(v.bySeries));
  if (v.sku_shape_control_all_enterprise) console.log(JSON.stringify(v.sku_shape_control_all_enterprise));
  for (const s of v.summary ?? []) console.log(`${s.n}\t${s.spec}/${s.eol_only}/${s.no_doc}\t${s.is}`);
  if (k === "item7_im_cpak") console.log(JSON.stringify(v));
  if (k === "item5") { for (const r of v.rows) console.log(`  ${r.kind} ${r.sku} | ${r.is} | sib=${r.base_pid_in_transceiver}`); console.log("also outside:", v.also_outside_transceiver.length); }
  if (k === "item7_firewall") console.log("same shape in other series:", v.same_shape_other_series.length);
}
