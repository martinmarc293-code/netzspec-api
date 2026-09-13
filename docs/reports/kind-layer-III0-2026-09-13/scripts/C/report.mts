// Assemble III0-4-counts.md from the raw JSON written by extract / item1-classify / factmethods / item2 / item3 / item6 / item7.
import { readFileSync, writeFileSync } from "node:fs";
const R = (f: string) => JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/" + f, "utf8"));
const parts: any[] = R("parts.json");
const diff = R("kind-count-diff.json");
const i1 = R("item1-classified.json");
const i1m = R("item1-fact-methods.json");
const i2 = R("item2-dac-aoc.json");
const i3 = R("item3-routers-module.json");
const i6 = R("item6-unresolved-families.json");
const i7 = R("item4-5-7.json");

const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "/").replace(/[\r\n]+/g, " ");
const table = (h: string[], rows: unknown[][]) => `| ${h.join(" | ")} |\n|${h.map(() => "---").join("|")}|\n` + rows.map((r) => `| ${r.map(esc).join(" | ")} |`).join("\n") + "\n";
const split = (o: any) => `${o.spec ?? 0} / ${o.eol_only ?? 0} / ${o.no_doc ?? 0}`;
const L: string[] = [];
const P = (s = "") => L.push(s);

P("# III.0 item 4 — counts for the uncounted `[J]` populations");
P();
P("Measured 13 Sep 2026 against the live store (read-only session `agent/kindlayer-C`, `default_transaction_read_only = on`). Kind = `partKind(category, sku, name)` from the `netzspec-api-cisco` working tree (HEAD `3aff73b`; that tree is being edited by another session, so the classifier is whatever was on disk at 13 Sep 2026 evening). Population: Cisco, `retired_at IS NULL AND product_class = 'hardware'` = **" + parts.length + "** parts (spec: 42,383 on build 88bc982).");
P();
P("Held split everywhere = spec-bearing / EoL-only / no document, with the ledger's definition (spec-bearing = a linked `vendor_datasheet_html|pdf`, `vendor_page` or `vendor_tool`). Every classification below was written after reading the rows; `[J]` marks a call made from a SKU or placeholder name alone. Raw JSON beside this file under `raw/`, scripts under `scripts/`.");
P();
P("## 0. Baseline — kind counts now vs Appendix A.1 (only the rows that changed)");
P();
P(table(["category.kind", "spec (88bc982)", "now", "delta"], diff.diff.map((d: any) => [`${d.category}.${d.kind}`, d.spec, d.now, (d.delta > 0 ? "+" : "") + d.delta])));
P("Every other (category, kind) count in A.1 is unchanged. Category totals moved only in servers-unified-computing (9,594 → 9,579), switches (7,428 → 7,433), wireless (4,011 → 4,010) and collaboration-endpoints (2,840 → 2,835).");
P();

// ------------------------------------------------------------------ item 1
P("## 1. Modular chassis inside `switches.switch`");
P();
P("**Selector.** `switches.switch` rows where any of: an active `form_factor` fact containing `modular`; the name token `chassis`/`chs` (lookaround-anchored); SKU shape `^(C1-|2D-|VS-)?(C94ddR|C96ddR|WS-C45dd|WS-C65dd|N9K-C9[458]dd|N7K-C70dd|N77-C77dd|C68dd|C1-C45dd|N3K-C3408)` (digit lookahead, no `\\b`); or `slot bundle`/`half slots` in the name. **" + i1.rows.length + " rows** matched; every row was read and put in one group.");
P();
P(table(["group", "rows", "spec / EoL / no doc", "form_factor = modular-chassis", "carry module_slots", "verdict"], i1.summary.map((s: any) => [s.group, s.n, `${s.spec} / ${s.eol} / ${s.nodoc}`, s.ff_modular, s.with_module_slots, ({
  "bare chassis PID": "the `chassis` kind population (empty chassis, incl. spares and Cisco ONE C1- twins)",
  "chassis bundle": "chassis + supervisor/linecards/PSU/fabric sold as one PID — `bundle`, not `chassis`",
  "chassis accessory (door/kit/packaging/air dam)": "`mechanical` — doors, filters, support kits, packaging, air dams, converters",
  "fixed/LEM switch + FEX bundle": "`bundle` (switch + N FEX)",
  "fixed switch that says 'chassis'": "stays `switch` (Nexus 5548/5596/5624Q/5648Q/56128P/6001, 6800-X, spare-chassis PIDs)",
  "upgrade kit (sup/linecards for a chassis bundle)": "`bundle`/upgrade kit — NOT a chassis; its module_slots is the target chassis's",
  "Cisco 7600 router chassis bundle": "WRONG CATEGORY — Cisco 7600 routers (7603S/7604/7606S/7609S/7613 + SUP32) filed as Catalyst 6500",
  "fixed switch (PID shape only)": "stays `switch` (4500-X, 6816/6832/6880-X, 4900M)",
  "line card": "`linecard` (C6800-48P / 8P40G, C6880-X-16P10G port card)",
  "expansion module (GEM/LEM)": "`module` (Nexus 5600/5696Q/6004 chassis modules)",
  "fixed-switch bundle": "`bundle` (Nexus 5624Q/5648Q GEM bundles, 3408 bundles, demo/NFR)",
  "LEM-slot chassis (Nexus 5696Q / 6004EF)": "decision: `chassis` (8 LEM slots, no fixed ports) or `switch`",
  "fixed switch (Instant Access, PID shape only)": "stays `switch` (C6800IA)",
  "non-product: tracking PID": "class non_product (\"For Tracking Only\")",
  "licence filed as hardware": "class software (Nexus storage licences)",
  "MDS 9700 director (storage-networking)": "WRONG CATEGORY — `storage-networking.director`",
} as Record<string, string>)[s.group] ?? ""])));
P("**Answer to the spec's question.** Real empty modular chassis inside `switch`: **75** bare chassis PIDs (22 spec-bearing) + **7** Nexus 5696Q/6004EF LEM-slot chassis (decision) = 75–82. Three more are MDS 9700 directors that belong in `storage-networking`. The `form_factor = modular-chassis` fact alone finds only **14** (11 Catalyst 9400/9600 + Nexus 9400/9500/9800, and the 3 MDS directors) — the fact is a poor selector; the name token plus PID shape is what finds the other 64. The name token `Chassis` alone over-selects badly: of " + i1.rows.length + " candidates, 165 are chassis bundles, 65 accessories, 41 fixed switches, 29 upgrade kits, 20 routers.");
P();
P("**module_slots.** 63 of the 75 bare chassis carry `module_slots` (33 `description_mining`, 30 `hexcat_seed`); the 12 without are C1-N7018, C1-N7718, C1-N7K-C7018, C1-N9K-C9504/9508/9516, C9404R=, C9606R=, N9K-C9504=, N9K-C9508=, N9K-C9516=, WS-C6513-E= (all placeholder or bundle-style names). The value counts *all* slots, supervisors included (C9404R = 4 while its name says 2 line-card slots; N9K-C9516 = 18). **72 more `module_slots` facts sit on rows that are not a chassis**, all `description_mining` reading \"N-slot\" out of the name: 23 chassis accessories that have no slots at all (front-door kits, filters, packaging), 29 upgrade kits (carrying the slot count of the chassis they upgrade) and 20 Cisco 7600 router bundles (plausible values, wrong category).");
P();
P(table(["group", "field", "method", "inherited", "facts", "sample raw"], Object.entries(i1m).flatMap(([g, rows]: any) => rows.map((r: any) => [g, r.field_key, r.method, r.inherited, r.n, String(r.sample_raw).slice(0, 50)]))));
P("### 1a. Every bare chassis and LEM-slot chassis row (82)");
P();
const ch = i1.rows.filter((r: any) => r.group === "bare chassis PID" || r.group.startsWith("LEM-slot")).sort((a: any, b: any) => a.group.localeCompare(b.group) || a.sku.localeCompare(b.sku));
P(table(["group", "SKU", "held", "own facts", "series", "name", "form_factor", "module_slots"], ch.map((r: any) => [r.group === "bare chassis PID" ? "bare" : "LEM", r.sku, r.held, r.own, r.series, String(r.name).slice(0, 80), (r.ff ?? []).join(","), r.module_slots ? JSON.stringify(r.module_slots) : ""])));
P("### 1b. The other groups — 3 samples each");
P();
const others: Record<string, any[]> = {};
for (const r of i1.rows) if (!(r.group === "bare chassis PID" || r.group.startsWith("LEM-slot"))) (others[r.group] ??= []).push(r);
P(table(["group", "rows", "samples"], Object.entries(others).sort((a, b) => b[1].length - a[1].length).map(([g, rs]) => [g, rs.length, rs.filter((r: any) => !/=$/.test(r.sku)).slice(0, 3).map((r: any) => `${r.sku} — ${String(r.name).slice(0, 55)}`).join(" ; ")])));
P("### 1c. Found in passing: 16 transceivers inside `switches.switch`");
P();
P(table(["SKU", "held", "name", "base PID already in transceiver"], i7.item5.also_outside_transceiver.filter((r: any) => r.category === "switches").map((r: any) => [r.sku, r.held, r.name, (r.base_pid_in_transceiver ?? []).join(", ") || "-"])));
P("Five of them (ONS-SI+-10G-* =, WS-G5483=) are the `=` spare of a PID already in `transceiver`; three are concatenated table cells (`1000BASE-SX1000BASE-SX`).");
P();

// ------------------------------------------------------------------ item 2
P("## 2. DAC / AOC / Twinax inside `transceiver.pluggable`");
P();
P("**Selector.** `transceiver.pluggable` rows with SKU segment `CU`/`ACU`/`AOC`/`DAC` (lookbehind `(?<![A-Z0-9])`, lookahead digit/`-`/`=`/end) or `CUxx`, or name `twinax`, `active optical`, `AOC`, `direct attach`/`DAC`, `copper cable`, `Direktanschlusskabel`, `MPO cable`. **" + i2.rows.length + " rows**; control: pluggable rows whose name says cable/Kabel but no token = " + i2.control_cable_word_without_token.length + ".");
P();
P(table(["class", "rows", "spec / EoL / no doc", "same-cage", "breakout 1-to-4", "range/family row", "wavelength", "tx_power", "reach_max", "rx_sensitivity"], Object.entries(i2.summary).map(([k, s]: any) => [k, s.n, split(s), s.shapes["same-cage"] ?? 0, s.shapes["breakout (1-to-4)"] ?? 0, s.shapes["range/family row, not an orderable PID"] ?? 0, s.wavelength, s.tx_power, s.reach_max, s.rx_sensitivity])));
const keyCount = (rows: any[]) => { const m: Record<string, number> = {}; for (const r of rows) for (const k of Object.keys(r.facts)) m[k] = (m[k] ?? 0) + 1; return Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", "); };
P(`**Copper vs optical.** Copper DAC/twinax **${i2.summary["copper (DAC/twinax)"].n}** (incl. 11 Meraki MA-CBL direct-attach/stacking cables, 8 breakout DACs, 9 range/family rows); active optical **${i2.summary["active-optical (AOC)"].n}** (7 range/family rows). No copper cable holds any optical fact. AOC: **11** hold \`wavelength\` (all 850 nm: 10× QDD-400-AOC*, QSFP-100G-AOC); none holds \`tx_power\`, \`reach_max\` or \`rx_sensitivity\`. Of the facts this pass extracted, copper rows carry: ${keyCount(i2.rows.filter((r: any) => r.cls.startsWith("copper")))}; AOC rows: ${keyCount(i2.rows.filter((r: any) => r.cls.startsWith("active")))}.`);
P();
P("**Not cables (keep `pluggable`):** SFP-CU-RJ45=, SFP-RFGW1-CU-RJ45= (copper SFP modules), X2-10GB-CX4, XENPAK-10GB-CX4 (CX4 modules). **Passive fibre:** ONS-CCC-100G-5/10/20= (CXP-CFP MPO cables) → `cable`, not DAC. **Breakout DACs** QDD-4ZQ100-CU* (5, incl. the dash-less QDD4ZQ100-CU2M) and QSFP-4S50-CU* (3) → `breakout-cable`, not same-cage `cable`.");
P();
P(table(["class", "shape", "rows", "samples"], (() => { const m: Record<string, any[]> = {}; for (const r of i2.rows) (m[r.cls + " | " + r.shape] ??= []).push(r); return Object.entries(m).map(([k, rs]) => [...k.split(" | "), rs.length, rs.slice(0, 3).map((r: any) => `${r.sku} — ${String(r.name).slice(0, 50)}`).join(" ; ")]); })()));
P("Range/family rows (not orderable PIDs, all spec-held because they are datasheet table headings): " + i2.rows.filter((r: any) => r.shape.startsWith("range")).map((r: any) => "`" + r.sku + "`").join(", ") + ".");
P();

// ------------------------------------------------------------------ item 3
P("## 3. `routers.module` (660) by family");
P();
P("**Selector.** `routers.module`, every row read; family by SKU prefix, function by name. Spec families NIM / HWIC-EHWIC / VWIC / SM / NM / PVDM / SPA-EPA / UCS-E cover **" + ["NIM", "NIM (C-NIM, Catalyst 8000)", "NIM (IR8300 IRM-NIM)", "HWIC / EHWIC", "VWIC", "SM / SM-X", "NM", "NM (C-NM, Catalyst 8200)", "PVDM", "SPA", "EPA (ASR 1000)", "UCS-E"].reduce((a, f) => a + (i3.byFamily.find((x: any) => x[0] === f)?.[1].n ?? 0), 0) + "** of 660; the rest is SP port adapters and interface modules (CRS PLIM, ASR 900/NCS 560 IM, ASR 9000/NCS 5500/5700/8000 MPA — 182) and IoT/cellular pluggables (CGM, IRMH, P-LTE, WP-WIFI6, WIM, GRWIC — 155).");
P();
const famVerdict: Record<string, string> = {
  "NIM": "mixed: interface 24, voice 24, cellular 19, switch 6, DSP 4 — split by function",
  "CRS PLIM / interface module": "SP line-card PLIMs (incl. phantom -PK / -PROXY / multi-pack PIDs) — linecard component of sp-core, not a branch module",
  "ASR 900 / NCS 560 IM": "interface modules (55) + GNSS timing (2) + voice/C37.94 (4)",
  "SPA": "port adapters (52) + DSP / WebEx service SPAs (3)",
  "CGM (CGR 1000)": "cellular 24, WiMAX/WPAN radio 9, compute server module 4",
  "WP-WIFI6 pluggable": "Wi-Fi 6 pluggable radios — RADIO",
  "PVDM": "voice DSP 16, digital modem 6, factory-upgrade PIDs 11, adapters 2",
  "SM / SM-X": "switch 11, interface 9, voice 4, DSP 4, NIM carriers 3, slot divider 1",
  "IRMH (IR8100)": "cellular 20, WPAN 6, battery 1",
  "NCS 5500/5700 MPA": "port adapters",
  "P-LTE / P-5G pluggable (PIM)": "cellular pluggables — CELLULAR",
  "GRWIC (CGR 2010)": "interface 10, cellular 10, switch 2",
  "ASR 9000 MPA": "port adapters",
  "EPA (ASR 1000)": "port adapters",
  "VIC": "voice interface cards",
  "HWIC / EHWIC": "interface 9 (incl. 3 EHWIC VDSL), cellular 2, slot divider 1",
  "NM": "interface 5, voice/DSP carriers 6",
  "NIM (C-NIM, Catalyst 8000)": "interface 6, switch 4",
  "Cisco 8000 MPA": "port adapters",
  "placeholder (truncated PID ending in '-')": "not product rows (EM-HDA-, VIC2-, VWIC-…): retire",
  "WIM (800M)": "cellular 6, serial 2",
  "VWIC": "voice/WAN trunk cards",
  "EM / EVM voice expansion": "voice",
  "ISM": "internal service modules (SRE, VPN) — service",
  "WIC": "legacy WAN/modem cards — interface",
  "ASR 1000 crypto module": "service (crypto)",
  "UCS-E": "compute service modules — service",
  "NME": "service (Russian VPN)",
  "ENCS RAID module": "storage-controller (ENCS)",
  "NIM (IR8300 IRM-NIM)": "interface",
  "5900 ESR RTM": "interface (rear transition module)",
  "IR8300 IRM": "timing module",
  "AIM": "service (voice DSP)",
  "NM (C-NM, Catalyst 8200)": "switch module",
};
P(table(["family", "rows", "spec / EoL / no doc", "what it is (verdict)", "samples"], i3.byFamily.map(([k, v]: any) => [k, v.n, split(v), famVerdict[k] ?? "", v.samples.join(" ; ")])));
P("By function across all 660:");
P();
P(table(["function", "rows", "spec / EoL / no doc"], i3.byFunction.map(([k, v]: any) => [k, v.n, split(v)])));
P("**Interface card vs service module.** Interface (port adapters 126 + interface cards 73 + SP PLIMs 64 + interface modules 55 + voice interfaces 60 + voice/teleprotection 4 + switch modules 24) = **406**; cellular/radio = **157**; DSP/modem/upgrade = **41**; service/compute/crypto/timing = **29**; adapters/mechanical/battery/storage = **10**; NM voice/DSP carriers + CRS fabric OIMs = **8**; placeholders **9** (sum 660). 245 of the 406 \"interface\" rows are ASR 1000/900/9000, NCS, CRS and 8000 port adapters and interface modules, which the II.11 recommendation (\"NIM/HWIC/SM/NM\") never named.");
P();
P("**The same nouns in `interfaces-modules` today** (prefix count, all kinds):");
P();
{
  const im = parts.filter((p) => p.category === "interfaces-modules");
  const fam: [string, RegExp][] = [["NIM", /^(C-)?NIM-/], ["HWIC/EHWIC", /^E?HWIC-/], ["WIC/VWIC/VIC", /^(V?WIC|VIC\d?)-/], ["SM/SM-X", /^(C-)?SM-/], ["NM/NME", /^(NM|NME)-/], ["PVDM", /^PVDM/], ["SPA", /^SPA-/], ["EPA", /^EPA-/], ["GRWIC", /^GRWIC/], ["CGM", /^CGM-/], ["UCS-E", /^UCS-E/], ["A900-IMA / NC5x-MPA / A9K-MPA", /^(A900-IMA|NC5[57]-MPA|A9K-MPA)/], ["PA- (7200/7500 port adapters)", /^PA-/]];
  const rmCount = (re: RegExp) => i3.rows.filter((r: any) => re.test(r.sku)).length;
  P(table(["family", "interfaces-modules rows", "routers.module rows"], fam.map(([f, re]) => [f, im.filter((p) => re.test(p.sku)).length, rmCount(re)])));
}

// ------------------------------------------------------------------ item 4
P("## 4. `video.optic` (89)");
P();
P("**Selector.** `video.optic`, all rows read.");
P();
P(table(["what it is", "rows", "spec / EoL / no doc", "samples"], i7.item4.summary.map((s: any) => [s.is, s.n, split(s), s.samples.join(" ; ")])));
P("**Pluggable vs fixed.** **57 pluggable** Remote PHY SFP+ optics (RPHY-S10G-20K/40K/80K-2x0=; every name is the placeholder \"Cisco <sku>\", but the linked documents are the Smart PHY / Remote PHY RPD datasheets and the \"Remote PHY Shelf 7200 and Remote PHY SFPs\" EoL bulletin, so the class is read from evidence). The trailing 200–390 is a 20-value code, very likely a wavelength channel — to be read from the held doc before `wavelength` is filled `[J]`. **0 fixed-optics modules identified.** **32 are unreadable**: 10-1022xxx-01 part numbers with placeholder names and no document. The same 10-1022xxx-01 family also has 11 rows in `video.unknown`, so one number family is split across two kinds. Verdict: the 57 are transceivers (category `transceiver`, kind `pluggable`, or `tunable` if the code is a DWDM channel); the 32 need a description before any move.");
P();

// ------------------------------------------------------------------ item 5
P("## 5. `optical-networking.pluggable` (6) + `pluggable-tunable` (8)");
P();
P(table(["kind", "SKU", "held", "own facts", "name", "what it is", "base PID already in transceiver"], i7.item5.rows.map((r: any) => [r.kind, r.sku, r.held, r.own, String(r.name).slice(0, 70), r.is, r.base_pid_in_transceiver ?? "-"])));
P("**Verdict.** 11 are pluggable optics that belong in `transceiver` (5 fixed → `pluggable`, 6 coherent CFP2 → `tunable`); 5 of the 11 are the `=` spare of a base PID that is **already** in `transceiver` (ONS-QSFP28-LR4, ONS-CXP2-SR25, ONS-CFP2-WDM, ONS-CFP2-WDM2, ONS-CFP2D-400G-C), so base and spare sit in two categories. ONS-QSP28-LR4= is a typo twin of ONS-QSFP28-LR4= (placeholder name, 1 fact). ONS-CFP2-WDM-LIC is a licence; ONS-CFP2-ACO-BDL a bundle. No ONS-SC / ONS-SE / ONS-XC row remains in `optical-networking` — the ones the spec asked about now sit in `switches.switch` (§1c) and `optical-networking.other` holds 6 more ONS-CFP2 bundles (§6). `routers.enterprise` holds 2 more CFP2-DCO pluggables (ONS-C2-WDM-DE-1HL, =).");
P();

// ------------------------------------------------------------------ item 6
P("## 6. Every unresolved kind by family");
P();
P("Columns: rows · spec / EoL / no doc · rows whose name is only the placeholder \"Cisco <sku>\" · proposed kind (or class, or category).");
P();
const order = ["wireless.other", "servers-unified-computing.unknown", "video.unknown", "hyperconverged-systems.unknown", "hyperconverged-infrastructure.unknown", "collaboration-endpoints.unknown", "unified-communications.unknown", "optical-networking.other", "storage-networking.other", "transceiver.accessory", "meraki.unknown", "conferencing.unknown"];
const specN: Record<string, number> = { "wireless.other": 192, "servers-unified-computing.unknown": 590, "video.unknown": 423, "hyperconverged-systems.unknown": 82, "hyperconverged-infrastructure.unknown": 62, "collaboration-endpoints.unknown": 73, "unified-communications.unknown": 19, "optical-networking.other": 43, "storage-networking.other": 4, "transceiver.accessory": 14, "meraki.unknown": 5, "conferencing.unknown": 1 };
P(table(["kind", "spec rows", "rows now", "not hardware / not a part", "needs a description", "resolvable to a named kind or category"], order.map((k) => {
  const f = i6[k].families;
  const notHw = f.filter((x: any) => /^(NOT HARDWARE|NOT A PART|non_product)/.test(x.proposal) && !/bundle$/.test(x.proposal)).reduce((a: number, x: any) => a + x.n, 0);
  const unk = f.filter((x: any) => /genuinely unknown/.test(x.proposal)).reduce((a: number, x: any) => a + x.n, 0);
  return [k, specN[k], i6[k].total, notHw, unk, i6[k].total - notHw - unk];
})));
for (const k of order) {
  const x = i6[k];
  P(`### ${k} — ${x.total} rows (spec ${specN[k]})`);
  P();
  P(table(["family", "rows", "spec / EoL / no doc", "placeholder names", "proposed", "samples"], x.families.map((f: any) => [f.family, f.n, split(f), f.placeholder_names, f.proposal, f.samples.join(" ; ")])));
  if (x.total <= 60) {
    P("Every row:");
    P();
    P(table(["SKU", "held", "name", "family"], x.rows.map((r: any) => [r.sku, r.held, String(r.name).slice(0, 80), r.family])));
  }
}
P("Notes. (a) `servers-unified-computing.unknown`: **145 of 539 are not parts** — datasheet cells and fragments enumerated as SKUs (`128GB`, `MPI=0.691`, `2.U.3`, `10A/250V`, `42x14TB`); a handful are real model names or third-party part numbers (X9508, XE150c, 2204XP/2208XP, 900-9X7AH-*) that duplicate a real PID elsewhere, none with a description. The 46 NVMe drives (`UCS(X|XE)-NVE*`) are all spec-held and fall to `unknown` only because ucsKind has no `NVE` token. (b) `video.unknown`: 333 of 421 carry placeholder names; 185 of those sit in series \"Optical Passive Components\", so `passive` is available by series alone `[J]`. (c) `transceiver.accessory` is **not** QSA adapters and dust caps as the spec guessed: all 14 are CWDM mux/demux and OADM plug-ins. (d) `wireless.other` holds 25 rows from other product lines (11 TelePresence Room 70 parts, 14 ASR 5000/5500 packet-core parts).");
P();

// ------------------------------------------------------------------ item 7
P("## 7. The spec's other named suspicions");
P();
P("### 7a. `routers.enterprise` — HWIC / WAE / CRS / ASR 9000 / NCS / 8000 / ENCS / RV");
P();
P("**Selector.** `routers.enterprise` rows whose `series` is one of the A.4 labels named in II.3 (plus the other odd labels 6000, Network Modules, Port Adapters, Cloud Native BNG, 5900 ESR), every row read; plus a SKU-shape control over all " + i7.item7_enterprise.total_enterprise + " enterprise rows that ignores the series label.");
P();
P(table(["series label (A.4)", "rows", "what the rows actually are"], i7.item7_enterprise.bySeries.sort((a: any, b: any) => b.n - a.n).map((s: any) => [s.series, s.n, Object.entries(s.is).map(([k, v]) => `${v}× ${k}`).join("; ")])));
P("SKU-shape control across all of `routers.enterprise`: " + Object.entries(i7.item7_enterprise.sku_shape_control_all_enterprise).map(([k, v]) => `${k} = **${v}**`).join(", ") + ".");
P();
P("**Result.** The series labels are wrong, not the kind. \"High-Speed WAN Interface Cards\" (38) are ISR 1841/1921/2801/2811/2911 router bundles that *include* an HWIC — there are **0** HWIC SKUs in `enterprise`. \"WAE\" (17) is WAN Automation Engine *software*, not WAAS appliances. \"Carrier Routing System\" (11) is 7 MSC/FP line-card bundles + 4 planning/licence PIDs — **0** CRS routers. \"ASR 9000\" (35) is 4 XRv 9000 appliances, 25 billing/licence PIDs (XRv9K BNG, VTMS, VSLN, XRd), 4 UCS parts (a C220 M5, a TPM, 2 XRv NICs) and 2 placeholders — **0** ASR 9000 routers. \"8000\" (33) is 20 Cisco 8100–8600 **Secure Routers** (C8xxx-G2, enterprise branch/edge, not SP 8000), 4 Silicon One switches, 5 licences, 4 ASIC-name placeholders — **0** SP 8000 routers. \"NCS 5500\" (2) is a CFP2-DCO pluggable. \"Network Modules\" (6) is 5 ISR WAAS bundles + an ASR 1001-HX. \"5900 ESR\" (16) is 15 embedded router cards + 1 software PID. ENCS (10) holds: NFV compute → `appliance`. RV (155) holds: 152 RV + CVR328W + 2 R260 small-business routers → role `smb`. **Real wrong-table rows in these series: ENCS 10 + XRv appliances 4 → `appliance`; 58 software/licence/planning PIDs → class; 7 CRS line-card bundles; 4 switches; 2 pluggables → `transceiver`; 4 UCS parts; 6 placeholders.** No row moves to `sp-core` or to `module`.");
P();
P(table(["what it is", "rows", "spec / EoL / no doc", "samples"], i7.item7_enterprise.summary.map((s: any) => [s.is, s.n, split(s), s.samples.join(" ; ")])));
P("### 7b. `servers-unified-computing.server` rows with a non-UCS series label");
P();
P(table(["series label", "SKU", "held", "name", "what it is"], i7.item7_server.rows.map((r: any) => [r.seriesLabel, r.sku, r.held, String(r.name).slice(0, 70), r.is])));
P(`**Result.** ${i7.item7_server.rows_non_ucs_series} rows carry a non-UCS series; the spec's \"foreign rows\" (Transceiver Modules 3, Nexus 9000 2, Catalyst Center 2, 6300/9100 FI, C4200 2) are **UCS servers under a wrong series label** (C220 M5 under \"Transceiver Modules\", C885A M8 under \"Nexus 9000\", MLB bundles under \"9100 Fabric Interconnects\", C125 trays under \"C4200\"). No transceiver, Nexus switch or fabric interconnect is in \`server\`. Genuinely not \`server\`: 6 MLB bundles, 2 C480 CPU modules, 2 CSP chassis spares, 2 coin-cell batteries; Catalyst Center appliance ×2 is a category/kind decision.`);
P();
P("### 7c. `security.firewall` — Secure Client / AnyConnect");
P();
P(table(["SKU", "held", "series", "name"], i7.item7_firewall.rows.map((r: any) => [r.sku, r.held, r.series, r.name])));
P(`**Result.** All 18 rows in the \"Secure Client (including AnyConnect)\" series are **ASA 5505 / 5512-X … 5555-X VPN-edition hardware bundles** (appliance + SSL/AnyConnect user licences). They are hardware and \`firewall\` is right; the class-\`software\` move in II.8 would be wrong. ${i7.item7_firewall.same_shape_other_series.length} more rows of the same shape (ASA55xx-SSLnnn / -10K bundles) sit in other firewall series.`);
P();
P("### 7d. `routers.forwarding` (22)");
P();
P(table(["SKU", "held", "name"], i7.item7_forwarding.rows.map((r: any) => [r.sku, r.held, r.name])));
P("**Result.** All 22 are ASR 1000 **Embedded Services Processors** (ESP5 … ESP200-X). An ESP is the forwarding engine, not a port-carrying line card and not a route processor: it has no ports. Folding into `linecard` (III.1) gives it LINECARD cups it can never fill (`ports`); `processor` (SUPERVISOR archetype: `forwarding_rate`, `switching_capacity`, `dram`, `flash`) fits better. Decision.");
P();
P("### 7e. `routers.transceiver` (5)");
P();
P(table(["SKU", "held", "name", "what it is"], i7.item7_rtransceiver.rows.map((r: any) => [r.sku, r.held, r.name, r.is])));
P("**Result.** None is a transceiver: 4 dust caps/covers + 1 SFP installation kit → `mechanical` in `routers`; the move to category `transceiver` would be wrong.");
P();
P("### 7f. `unified-communications.server-component` (114) by component type");
P();
P(table(["component type → kind", "rows", "spec / EoL / no doc", "samples"], i7.item7_uc_sc.summary.map((s: any) => [s.is, s.n, split(s), s.samples.join(" ; ")])));
P("All 114 are EoL-only. They resolve to UCS component kinds (incl. 5 external tape drives and 2 SCSI cards for MCS servers) except 6 ISR 4460 DIMMs (routers `memory`), 4 voice cards (`voice-module`), 2 VG350 motherboards and 1 UCS-E bundle. `conferencing.server-component` (40, not asked but the same shape): " + i7.item7_conf_sc.summary.map((s: any) => `${s.n}× ${s.is}`).join("; ") + ".");
P();
P("### 7g. `collaboration-endpoints.server-component` (4)");
P();
P(table(["SKU", "held", "name"], i7.item7_collab_sc.rows.map((r: any) => [r.sku, r.held, r.name])));
P("**Result.** One product (IX5000 host CPU, 2 regional variants × spare). It is the IX5000's compute unit, not a UCS component — no UCS component kind fits; `video-codec` or a server-type kind. Decision.");
P();
P("### 7h. `interfaces-modules` CPAK / CFP rows");
P();
P("**Selector.** any `interfaces-modules` row with `CPAK` or `CFP` in SKU or name: **" + i7.item7_im_cpak.cpak_cfp_rows + " rows**. The spec's premise does not hold on today's store. The only optic-shaped rows are:");
P();
P(table(["kind", "SKU", "held", "name", "what it is"], i7.item7_im_cpak.other_optic_shaped_rows.map((r: any) => [r.kind, r.sku, r.held, r.name, r.is])));
P("### 7i. `wireless.appliance` (20)");
P();
P(table(["SKU", "held", "name", "what it is"], i7.item7_wireless_appliance.rows.map((r: any) => [r.sku, r.held, String(r.name).slice(0, 80), r.is])));
P("**Result.** Only 7 are MSE/CMX/DNA Spaces appliances (the spec's description); **9 are ASR 5000/5500 packet-core chassis/systems** (wrong category); 4 are Fluidmesh gateways. Counted across the category, **115 ASR 5000/5500 (ASR5K-/ASR55-/MIXS-) rows sit in `wireless`**: module 61, bundle 15, other 14, mechanical 12, appliance 9, power 3, cable 1 — the spec's \"15 ASR5K in bundle\" is 13% of it.");
P();
P("### 7j. `wireless.backhaul` (41)");
P();
P(table(["SKU", "held", "name", "what it is"], i7.item7_wireless_backhaul.rows.map((r: any) => [r.sku, r.held, String(r.name).slice(0, 80), r.is])));
P(`**Result.** All 41 are Fluidmesh/URWB radios (FM1200 Volo, FM3200, FM3500 Endo, FM4200/4500 Fiber/Mobi, FM4800, PONTE kits) — the kind holds. ${i7.item7_wireless_backhaul.placeholder_names} have placeholder names, none has a spec-bearing document (0 / 25 / 16), and the FLMESH-HW-* SKUs are ordering/regional variants of the FMxxxx-HW models (FLMESH-HW-4500-1NA is named \"FM4500FIBER-HW, NAM / LAM Version\"), so one radio appears two to four times.`);
P();
P("### 7k. `security.appliance` (30) by series");
P();
P(table(["series", "rows"], Object.entries(i7.item7_security_appliance.bySeries).sort((a: any, b: any) => b[1] - a[1])));
P(table(["what it is", "rows", "spec / EoL / no doc", "samples"], i7.item7_security_appliance.summary.map((s: any) => [s.is, s.n, split(s), s.samples.join(" ; ")])));
P("**Result.** Dissolvable by series as II.8 proposes, except that 13 are Secure Malware Analytics (Threat Grid) sandbox appliances with no library kind, 6 are software licences (ACS on SNS, ISA IDS, Telemetry Broker) and 3 are 1200-series firewall PIDs.");
P();
writeFileSync("D:/tmp/kindlayer-III0/C/III0-4-counts.md", L.join("\n"));
console.log("lines", L.length, "bytes", L.join("\n").length);
