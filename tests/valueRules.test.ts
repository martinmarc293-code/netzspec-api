// tests/valueRules.test.ts — the value-shaped mapper rules (reviewer rulings (C) and (D), 30 Sep 2026;
// docs/decisions/2026-09-30-value-shaped-rules.md) and the class they may declare for a document-level cell.
//
// Every rule is pinned by a positive case AND by the cells it must leave alone: the same label with another value, the same
// value in another category, a near-miss label, and a cell that has the shape but contradicts itself. The values are the real
// cells of the re-extracted sheets (docs/decisions/2026-09-30-value-shaped-rules.md), not invented ones.
import fs from "node:fs";
import path from "node:path";
import { mapFactAll, VALUE_RULES, type RawFact } from "../src/core/deepSpecMap.js";
import { canInherit, describesPart } from "../src/core/specMerge.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else misses.push(`${name}\n      got  ${g}\n      want ${w}`);
};
const cell = (label: string, value: string, sku?: string, family_scope?: string): RawFact =>
  ({ label, value, shape: "E", locator: "t3:r2:c1", source_url: "https://www.cisco.com/x.html", sku, family_scope });
/** what the cell became: the rule, a refusal, and each fact as key=value (or the label mapping's kind) */
const read = (f: RawFact, cat = "switches") => {
  const r = mapFactAll(f, cat);
  return { rule: r.rule, refused: r.refused ? "refused" : null,
    facts: r.facts.map((m) => m.kind === "ok" ? `${m.key}=${JSON.stringify(m.value)}${m.unit ? " " + m.unit : ""}`
      : m.kind === "sentinel" ? m.sentinel : m.kind === "rejected" ? `rejected:${m.key}` : m.kind) };
};

// ---- (C) the small-business power line ------------------------------------------------------------------------------------------
const INT = ["psu_config=\"fixed-internal\"", "input_voltage={\"min\":100,\"max\":240} V"];
check("(C) the per-model SF350 cell: internal -> fixed-internal + 100-240 V",
  read(cell("Power", "100-240V 50-60 Hz, internal, universal", "SF350-24P")), { rule: "power-line-smb", refused: null, facts: INT });
check("(C) the 350X sheet's document-level cell ('to' ranges, 47 to 63 Hz)",
  read(cell("Power", "100 to 240V 47 to 63 Hz, internal, universal", undefined, "__document__")), { rule: "power-line-smb", refused: null, facts: INT });
check("(C) external: SF352-08P's adapter",
  read(cell("Power", "100-240V 50-60 Hz, external", "SF352-08P")).facts, ["psu_config=\"external\"", INT[1]]);
check("(C) the emitted facts keep the CELL as raw, the cell's locator and sku, and declare class C",
  (() => { const m = mapFactAll(cell("Power", "100-240V 50-60 Hz, internal, universal", "SF350-24P"), "switches").facts[0];
    return m.kind === "ok" ? [m.raw, m.locator, m.sku, m.docClass, m.rule] : m.kind; })(),
  ["100-240V 50-60 Hz, internal, universal", "t3:r2:c1", "SF350-24P", "C", "power-line-smb"]);
check("(C) the comma form the corpus prints 14 times: '100-240 V, 50-60 Hz, Internal'",
  read(cell("Power", "100-240 V, 50-60 Hz, Internal", "C1200-8T-D")).facts, INT);
check("(C) NEAR-MISS: 'Power' as boilerplate keeps its label mapping (__not_a_spec)",
  read(cell("Power", "ENERGY STAR Certified Large Network Equipment")), { rule: null, refused: null, facts: ["__not_a_spec"] });
check("(C) NEAR-MISS: a section heading repeating its label stays a heading",
  read(cell("Power", "Power")), { rule: null, refused: null, facts: ["__section_heading"] });
check("(C) NEAR-MISS: an alternative ('internal or external') is a capability, not a configuration: not read",
  read(cell("Power", "100-240V 50-60 Hz, internal or external")).rule, null);
check("(C) NEAR-MISS: another label with the same value is not this rule's",
  read(cell("Power supply", "100-240V 50-60 Hz, internal, universal")).rule, null);
check("(C) SCOPE: the same cell on a router sheet keeps its label mapping",
  read(cell("Power", "100-240V 50-60 Hz, internal, universal"), "routers").rule, null);

// ---- (D) 'data only' in the ordering table's PID description ---------------------------------------------------------------
const D9300 = "Catalyst 9300 24-port 1G copper with modular uplinks, data only, Network Advantage";
check("(D) the C9300 ordering row: 'data only' -> poe_standard none",
  read(cell("Switches [Product description]", D9300, "C9300-24T-A")), { rule: "poe-data-only", refused: null, facts: ["poe_standard=\"none\""] });
check("(D) 'non-PoE' is the other explicit phrase",
  read(cell("Description", "IE 1000 8-port non-PoE switch", "IE-1000-8T2T-LM")).facts, ["poe_standard=\"none\""]);
check("(D) a PoE fact from the description is per SKU only: it declares no document class",
  (() => { const m = mapFactAll(cell("Switches [Product description]", D9300, "C9300-24T-A"), "switches").facts[0];
    return m.kind === "ok" ? m.docClass ?? null : m.kind; })(), null);
check("(D) REFUSED: a description naming PoE AND 'data only' (a PoE switch with data-only uplinks)",
  read(cell("Product description", "Catalyst 9300 24-port PoE+ with 4 data only uplinks", "X")), { rule: "poe-data-only", refused: "refused", facts: ["__not_a_spec"] });
check("(D) REFUSED: '4PPoE' has a letter before its PoE and still counts as naming PoE",
  read(cell("Description", "Catalyst IE3300 with 4 2.5G Copper (4PPoE Type4), data only uplinks", "X")).refused, "refused");
check("(D) a line card counting its own ports is read (C9400-LC-48TX)",
  read(cell("Product description", "Cisco Catalyst 9400 Series 48-Port 10G multigigabit, data only (RJ-45)", "C9400-LC-48TX")).facts, ["poe_standard=\"none\""]);
check("(D) REFUSED: a power supply's '(data only)' counts no ports (PWR-C45-1000AC, the corpus)",
  read(cell("Product description", "Cisco Catalyst 4500 Series 1000W AC power supply (data only)", "PWR-C45-1000AC")).refused, "refused");
check("(D) REFUSED: 'for all non-PoE 2960-XR switches' names the switches a supply fits (PWR-C2-250WAC=, the corpus)",
  read(cell("Product description", "Spare FRU power supply and fan for all non-PoE 2960-XR switches, provides 250W AC of power", "PWR-C2-250WAC=")).refused, "refused");
check("(D) NEAR-MISS: an SFP model's description says nothing about PoE: not read",
  read(cell("Switches [Product description]", "Catalyst 9300 24-port 1G SFP with modular uplinks, Network Essentials", "C9300-24S-E")).rule, null);
check("(D) NEAR-MISS: C9200L's 'Data' is not 'data only'",
  read(cell("Product description", "Catalyst 9200L 24-port Data 4x1G uplink Switch, Network Advantage", "C9200L-24T-4G-A")).rule, null);
check("(D) NEAR-MISS: 'metadata only' is not 'data only'",
  read(cell("Description", "Stores metadata only", "X")).rule, null);
check("(D) SCOPE: the same row in another category keeps its label mapping",
  read(cell("Switches [Product description]", D9300, "X"), "wireless").rule, null);

// ---- the declared class: lifted for the rule's document-level cell, and only there ---------------------------------------
const PIDS = ["SG350X-24P", "SG350X-48P", "PWR-IE240W-AC-IEC="];
const inh = (a: Partial<Parameters<typeof canInherit>[0]>) => {
  const r = canInherit({ fieldKey: "psu_config", sku: "SG350X-24P", docPidList: PIDS, hasPerSkuException: false, ...a });
  return `${r.ok}:${r.cls}`;
};
check("CLASS: psu_config from the rule's document-level cell inherits as class C", inh({ classOverride: "C" }), "true:C");
check("CLASS SABOTAGE: without the rule's class, psu_config stays class B (never inherited)", inh({}), "false:B");
check("CLASS: input_voltage the same way", inh({ fieldKey: "input_voltage", classOverride: "C" }), "true:C");
check("CLASS: every class C condition still holds -- a per-SKU value in the same document wins",
  inh({ classOverride: "C", hasPerSkuException: true }), "false:C");
check("CLASS: -- and a SKU the document does not list is refused",
  /INHERIT_SCOPE_VIOLATION/.test(canInherit({ fieldKey: "psu_config", sku: "SG350-28P", docPidList: PIDS, hasPerSkuException: false, classOverride: "C" }).reason), true);
check("CLASS: -- and a power supply the sheet lists is not a switch it describes",
  String(canInherit({ fieldKey: "psu_config", sku: "PWR-IE240W-AC-IEC=", docPidList: PIDS, hasPerSkuException: false, classOverride: "C",
    subject: { sku: "PWR-IE240W-AC-IEC=", categorySlug: "switches", partSeries: null } }).rule ?? ""), "component:PWR-");
check("CLASS: the component refusal is describesPart's own", describesPart({ sku: "PWR-IE240W-AC-IEC=", categorySlug: "switches", partSeries: null })?.rule, "component:PWR-");
check("CLASS: only the power rule declares a class", VALUE_RULES.filter((r) => r.docClass).map((r) => r.id), ["power-line-smb"]);

// ---- wiring: both apply-extract passes read through mapFactAll, and pass 2 hands the rule's class to canInherit ------------
{
  const src = fs.readFileSync(path.join(process.cwd(), "src", "pipeline", "apply-extract.ts"), "utf8").split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|import )/.test(l));
  // (A), 6 Oct 2026 (af10632f): both passes now map through ONE helper, mapCapped, which calls mapFactAll once and re-maps a
  // comma-list cell's scalar head -- so the pin is the helper's two callers (pass 1 by the part's category, pass 2 by the
  // document's) plus the helper's own single mapFactAll call. It counted the pre-(A) shape and sat red from af10632f until the
  // 22:15 rebuild's MISS diff named it.
  check("WIRING: two call sites of mapFactAll (pass 1 and pass 2)", [
    src.filter((l) => /mapCapped\(f, part\.category, /.test(l)).length,
    src.filter((l) => /mapCapped\(f, d\.category, /.test(l)).length,
    src.filter((l) => /: mapFactAll\(r, category\);/.test(l)).length], [1, 1, 1]);
  check("WIRING: pass 2 passes the rule's class to canInherit", src.filter((l) => /classOverride: docClass/.test(l)).length, 1);
  check("WIRING: class B is lifted only for a declared class C", src.filter((l) => /INHERIT_CLASS_B\.has\(m\.key\) && docClass !== "C"/.test(l)).length, 1);
}

const TOTAL = 33;
if (misses.length || pass !== TOTAL) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${pass}/${TOTAL} value-rule cases passed${pass + misses.length !== TOTAL ? ` (ran ${pass + misses.length}, expected ${TOTAL})` : ""}.`);
  process.exit(1);
}
console.log(`${pass}/${TOTAL} value-rule cases passed`);
