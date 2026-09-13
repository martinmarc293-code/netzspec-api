// tests/natThroughput.test.ts — the operator ruling on a printed "NAT throughput" row (13 Sep 2026).
//
//   npx tsx tests/natThroughput.test.ts
//
// The ruling: NAT throughput is `router_throughput` ONLY for a router in deploy_role `smb`, with the raw label kept in the
// fact's replayable raw; where the same document also prints a forwarding / aggregate throughput row, that row wins and
// NAT is not stored under router_throughput; outside smb it is `__backlog`. Three page shapes, each a real one:
//   RV340     the Small Business sheet prints ONLY "Performance: NAT throughput"            -> router_throughput
//   ISR 1100  prints "NAT throughput" AND "IPv4 Forwarding Throughput (1400Bytes)"          -> the forwarding row wins
//   ISR 4000  prints "NAT throughput" and no forwarding row, and is a branch router          -> __backlog
// Driven through the REAL planExtract (apply-extract, with an in-memory parts lookup in place of Postgres) and the real
// mapEntryFacts (apply-acquired), not through a stand-in — plus a sabotage per branch of the decision.
import { natThroughputDecision, isNatThroughputLabel, forwardingThroughputRow } from "../src/core/natThroughput.js";
import { mapLabel } from "../src/core/deepSpecMap.js";
import { planExtract, sourceKind, type ExtractFile } from "../src/pipeline/apply-extract.js";
import { mapEntryFacts } from "../src/pipeline/apply-acquired.js";
import type { RawFact } from "../src/core/deepSpecMap.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => { if (ok) pass++; else misses.push(`${name}${detail ? " — " + detail : ""}`); };

// ---- the label -------------------------------------------------------------------------------------------------
for (const l of ["NAT throughput", "Performance: NAT throughput", "Maximum NAT throughput", "NAT Throughput (Mbps)"]) check(`"${l}" is a NAT throughput label`, isNatThroughputLabel(l));
for (const l of ["Performance: IPsec VPN throughput", "NAT sessions", "NAT throughput with IPS enabled", "Throughput"]) check(`REFUSAL "${l}" is not`, !isNatThroughputLabel(l));
check("control: the global mapper still returns NOTHING for the NAT label (no alias fires for every router)", mapLabel("Performance: NAT throughput", "routers") === null && mapLabel("NAT throughput", "routers") === null);
check("a forwarding row is recognised by the mapper's own router_throughput rules", forwardingThroughputRow(["NAT throughput", "Aggregate Throughput (Default)"], "routers") === "Aggregate Throughput (Default)");
check("'Platform performance' counts as a forwarding row (named by the ruling, unmapped today)", forwardingThroughputRow(["Platform performance"], "routers") === "Platform performance");

// ---- the decision ----------------------------------------------------------------------------------------------
const dec = (sku: string, labels: string[], category = "routers") => natThroughputDecision({ category, sku, docLabels: labels });
check("RV340-K9 (smb) with only the NAT row -> router_throughput", dec("RV340-K9", ["Performance: NAT throughput", "Ethernet WAN"]).use === true);
{ const d = dec("C1111-8P", ["NAT throughput", "IPv4 Forwarding Throughput (1400Bytes)"]);
  check("C1111-8P (ISR 1100) page printing both -> superseded by the forwarding row", !d.use && d.why === "superseded" && d.by === "IPv4 Forwarding Throughput (1400Bytes)", JSON.stringify(d)); }
{ const d = dec("ISR4331/K9", ["NAT throughput"]);
  check("ISR4331/K9 (ISR 4000, branch) -> __backlog outside smb", !d.use && d.why === "outside-smb", JSON.stringify(d)); }
{ const d = dec("RV260-K9", ["NAT throughput", "Throughput"]);
  check("SABOTAGE of the precedence: an smb page that ALSO prints a forwarding row is superseded, not smb", !d.use && d.why === "superseded", JSON.stringify(d)); }
check("a non-router category is outside smb", dec("ASA5506-K9", ["NAT throughput"], "security").use === false);

// ---- through the real apply-extract plan -----------------------------------------------------------------------
const PARTS = [
  { id: 1, sku: "RV340-K9", sku_norm: "RV340-K9", category: "routers", family: null, product_class: "hardware" },
  { id: 2, sku: "C1111-8P", sku_norm: "C1111-8P", category: "routers", family: null, product_class: "hardware" },
  { id: 3, sku: "ISR4331/K9", sku_norm: "ISR4331/K9", category: "routers", family: null, product_class: "hardware" },
  { id: 4, sku: "RV345-K9", sku_norm: "RV345-K9", category: "routers", family: null, product_class: "hardware" },
];
const fakeDb = { query: async (_sql: string, params: unknown[]) => {
  const wanted = new Set((params[1] as string[]).map((s) => s.toUpperCase()));
  return { rows: PARTS.filter((p) => wanted.has(p.sku_norm)) };
} } as never;
const RV = "https://www.cisco.com/c/en/us/products/collateral/routers/rv340-dual-wan-gigabit-vpn-router/datasheet-c78-739996.html";
const ISR1100 = "https://www.cisco.com/c/en/us/products/collateral/routers/1000-series-integrated-services-routers-isr/datasheet-c78-739512.html";
const ISR4K = "https://www.cisco.com/c/en/us/products/collateral/routers/4000-series-integrated-services-routers-isr/data_sheet-c78-732542.html";
const fact = (url: string, sku: string | undefined, label: string, value: string, locator: string, family_scope?: string): RawFact =>
  ({ source_url: url, label, value, locator, shape: "pair", ...(sku ? { sku } : {}), ...(family_scope ? { family_scope } : {}) }) as RawFact;
const file: ExtractFile = {
  file: "nat-fixture.json", source: "cisco-specs-deep", kind: sourceKind("cisco-specs-deep"), generated_at: "2026-09-13T00:00:00Z",
  docs: [
    { __doc__: true, source_url: RV, pid_list: ["RV340-K9", "RV345-K9"], tables: 2 } as RawFact,
    { __doc__: true, source_url: ISR1100, pid_list: ["C1111-8P"], tables: 3 } as RawFact,
    { __doc__: true, source_url: ISR4K, pid_list: ["ISR4331/K9"], tables: 3 } as RawFact,
  ],
  facts: [
    fact(RV, "RV340-K9", "Performance: NAT throughput", "1 Gbps", "table[1].row[2]"),
    fact(ISR1100, "C1111-8P", "NAT throughput", "600 Mbps", "table[2].row[4]"),
    fact(ISR1100, "C1111-8P", "IPv4 Forwarding Throughput (1400Bytes)", "1.3 Gbps", "table[2].row[5]"),
    fact(ISR4K, "ISR4331/K9", "NAT throughput", "300 Mbps", "table[1].row[7]"),
  ],
};
const plan = await planExtract([file], { vendor: "cisco", db: fakeDb, day: "2026-09-13" });
const entry = (id: number, k: string) => (plan.incoming.get(id) ?? []).filter((e) => e.k === k);
{
  const rv = entry(1, "router_throughput");
  check("apply-extract: RV340-K9 gets router_throughput 1 Gbit/s from its NAT row", rv.length === 1 && rv[0].value === 1 && rv[0].unit === "Gbit/s", JSON.stringify(rv));
  check("apply-extract: the raw keeps the NAT label for provenance", rv[0]?.raw === "Performance: NAT throughput | 1 Gbps", rv[0]?.raw);
  check("apply-extract: the gate still re-reads the CELL (ProducedFact.raw)", plan.produced.get("RV340-K9")?.get("router_throughput")?.raw === "1 Gbps");
  const isr1100 = entry(2, "router_throughput");
  check("apply-extract: C1111-8P gets ONLY the forwarding row (1.3), never the NAT 0.6", isr1100.length === 1 && isr1100[0].value === 1.3, JSON.stringify(isr1100));
  check("apply-extract: ISR4331/K9 gets no router_throughput at all", entry(3, "router_throughput").length === 0);
  check("apply-extract: the two refused NAT rows are named gaps (__backlog), counted by reason",
    plan.backlog.has("NAT throughput") && plan.stats.nat_throughput_smb === 1 && plan.stats.nat_throughput_superseded === 1 && plan.stats.nat_throughput_outside_smb === 1,
    JSON.stringify({ smb: plan.stats.nat_throughput_smb, sup: plan.stats.nat_throughput_superseded, out: plan.stats.nat_throughput_outside_smb, backlog: [...plan.backlog.keys()] }));
}
// A FAMILY-scoped NAT row on the RV sheet reaches both listed smb routers; on the ISR 4000 sheet it reaches nobody.
{
  const fam: ExtractFile = { ...file, facts: [
    fact(RV, undefined, "NAT throughput", "900 Mbps", "table[1].row[3]", "__document__"),
    fact(ISR4K, undefined, "NAT throughput", "300 Mbps", "table[1].row[7]", "__document__"),
  ] };
  const p2 = await planExtract([fam], { vendor: "cisco", db: fakeDb, day: "2026-09-13" });
  // CONTROL: the same family row printed as a plain "Throughput" goes through canInherit exactly as the smb NAT row does,
  // so whatever inheritance class router_throughput carries, the NAT row is treated like the aggregate row — no more.
  const ctl: ExtractFile = { ...file, facts: [fact(RV, undefined, "Throughput", "900 Mbps", "table[1].row[3]", "__document__")] };
  const p3 = await planExtract([ctl], { vendor: "cisco", db: fakeDb, day: "2026-09-13" });
  const inh = (p: typeof p2) => [1, 4].map((id) => (p.incoming.get(id) ?? []).filter((e) => e.k === "router_throughput").map((e) => e.value));
  // router_throughput is inheritance class B (never inherited from a family row), so NEITHER row reaches a part: the
  // ruling changes what the NAT row maps to, never how a family figure is inherited.
  check("apply-extract (family): the smb NAT row is mapped (not a sentinel) and then stopped by class B exactly like the control",
    p2.stats.inherit_class_b === 1 && p3.stats.inherit_class_b === 1 && JSON.stringify(inh(p2)) === JSON.stringify(inh(p3)) && JSON.stringify(inh(p2)) === "[[],[]]",
    `nat class_b ${p2.stats.inherit_class_b} ${JSON.stringify(inh(p2))} / control class_b ${p3.stats.inherit_class_b} ${JSON.stringify(inh(p3))}`);
  check("apply-extract (family): the ISR 4000 sheet's NAT row reaches no part and is a named gap",
    (p2.incoming.get(3) ?? []).every((e) => e.k !== "router_throughput") && p2.stats.nat_throughput_outside_smb === 1 && p2.backlog.has("NAT throughput"));
}

// ---- through the real apply-acquired mapper --------------------------------------------------------------------
{
  const ctx = (sku: string) => ({ category: "routers", src: { id: 1, slug: "cisco-datasheets", tier: 2, kind: "html" }, docType: "vendor_datasheet_html", docId: "d1", pageUrl: RV, sku, fetchedDay: "2026-09-13" });
  const rv = mapEntryFacts([{ label: "Performance: NAT throughput", value: "1 Gbps", locator: "t1" }], ctx("RV340-K9"));
  check("apply-acquired: RV340-K9 NAT row -> router_throughput with the label in raw", rv.mapped.length === 1 && rv.mapped[0].entry.k === "router_throughput" && rv.mapped[0].entry.raw === "Performance: NAT throughput | 1 Gbps");
  check("apply-acquired: the provenance audit is handed the cell, not the labelled raw", rv.mapped[0]?.cell === "1 Gbps");
  const both = mapEntryFacts([{ label: "NAT throughput", value: "600 Mbps", locator: "t1" }, { label: "IPv4 Forwarding Throughput (1400Bytes)", value: "1.3 Gbps", locator: "t2" }], ctx("C1111-8P"));
  check("apply-acquired: ISR 1100 page -> only the forwarding row maps; the NAT row is a sentinel", both.mapped.length === 1 && both.mapped[0].entry.value === 1.3 && both.sentinel === 1, JSON.stringify(both));
  const isr = mapEntryFacts([{ label: "NAT throughput", value: "300 Mbps", locator: "t1" }], ctx("ISR4331/K9"));
  check("apply-acquired: ISR 4000 NAT row -> nothing mapped, one sentinel", isr.mapped.length === 0 && isr.sentinel === 1);
}

console.log(`    nat throughput: ${pass} passed, ${misses.length} missed`);
for (const m of misses) console.log(`    MISS ${m}`);
if (misses.length) process.exit(1);
