// tests/ponStandard.test.ts — the pon_standard derivation (src/core/ponStandard.ts), its refusals, and its witness table.
// Pure: no database. Reviewer ruling 29 Sep 2026, docs/decisions/2026-09-29-pon-cups.md.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ponStandardFromStandards } from "../src/core/ponStandard.js";
import { DERIVED_FILL_PATHS } from "../src/core/derivedFillPaths.js";
import { replayDerived } from "../src/core/derivedReplay.js";
import { decide } from "../src/pipeline/renormalize.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, sabotages = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => { if (ok) pass++; else misses.push(`${name}: ${JSON.stringify(got)}`); };
const value = (t: string) => { const r = ponStandardFromStandards([t]); return r.ok ? r.value : `refused:${r.reason}`; };

// the Catalyst PON sheet's Standards cell, as stored (raw of the ieee_standards fact on CGP-OLT-8T)
const CATALYST_PON = "ITUT G.984.1 ITUT G.984.2 ITUT G.984.3 ITUT G.984.4 ITUT G.988 IEEE 802.1w IEEE 802.1x Authentication IEEE 802.3af";
check("the Catalyst PON Standards cell derives gpon", value(CATALYST_PON) === "gpon", value(CATALYST_PON));
check("G.9807.1 derives xgs-pon, not gpon or xg-pon for sharing a prefix", value("ITU-T G.9807.1") === "xgs-pon", value("ITU-T G.9807.1"));
check("G.987.2 derives xg-pon, not xgs-pon", value("ITU-T G.987.2") === "xg-pon", value("ITU-T G.987.2"));
check("G.989 derives ng-pon2", value("ITU-T G.989.3") === "ng-pon2", value("ITU-T G.989.3"));

sabotages++;
check("SABOTAGE IEEE 802.3ah (the Ethernet OAM an ordinary access switch lists) is NOT read as EPON",
  value("IEEE 802.3ah Ethernet OAM, IEEE 802.1ag CFM") === "refused:no_pon_recommendation", value("IEEE 802.3ah Ethernet OAM"));
sabotages++;
check("SABOTAGE a list naming two PON families (a combo port) is refused, never one of them chosen",
  value("ITU-T G.984 GPON and ITU-T G.9807.1 XGS-PON") === "refused:several_pon_families", value("ITU-T G.984 and G.9807.1"));
sabotages++;
check("SABOTAGE G.988 (OMCI) and G.652 (the fibre) alone are not PON families",
  value("ITUT G.988 OMCI, ITU-T G.652.D fiber") === "refused:no_pon_recommendation", value("ITUT G.988 OMCI"));
sabotages++;
check("SABOTAGE a number that only BEGINS like a family (G.9840) is not one", value("G.9840") === "refused:no_pon_recommendation", value("G.9840"));

// ---- the witness table: every row reproduces with the code, and the registry's sentence carries its counts ----
type Row = { sku: string; raw: string; derived: string | null; name_states: string | null; agree: boolean };
const W = JSON.parse(readFileSync(path.join(ROOT, "data/reference/pon-standard-witnesses.json"), "utf8")) as { rows: Row[] };
const drift = W.rows.filter((r) => { const d = ponStandardFromStandards([r.raw]); return (d.ok ? d.value : null) !== r.derived; });
check("every witness row re-derives the value it records (the table cannot drift from the function)", drift.length === 0,
  drift.map((r) => r.sku));
check("every witness agrees with the family its own name states", W.rows.every((r) => r.agree && r.derived === r.name_states),
  W.rows.filter((r) => !r.agree).map((r) => r.sku));
const reg = DERIVED_FILL_PATHS.pon_standard;
const derived = W.rows.filter((r) => r.derived).length;
check("pon_standard is registered, and its validated sentence states the witness table's own counts",
  !!reg && reg.validated.includes(`derived ${derived} `) && reg.validated.includes(`${W.rows.length} live-part facts`)
    && reg.validated.includes("pon-standard-witnesses.json"), reg?.validated);
// ---- a derived fact is replayed by its DERIVATION, never by the normaliser (29 Sep 2026) ----------------------------
check("replayDerived: the registered derivation reproduces a value from the stored raw", replayDerived("derived:pon_standard", CATALYST_PON) === null);
sabotages++;
check("SABOTAGE replayDerived: a raw the derivation cannot read is refused with its reason",
  replayDerived("derived:pon_standard", "IEEE 802.3af")?.reason === "DERIVATION_REFUSED");
sabotages++;
check("SABOTAGE replayDerived: a derived method with no registered replay is refused loudly, never waved through",
  replayDerived("derived:nothing_registered", CATALYST_PON)?.reason === "DERIVATION_UNREGISTERED");
const row = { id: 1, part_id: 1, sku: "CGP-OLT-8T", field_key: "pon_standard", category: "switches", value: "gpon", unit: null,
  raw: CATALYST_PON, state: "verified", tier: 2, method: "derived:pon_standard", doc_id: "e947e1ba847e8868", locator: "t11:r2:c1",
  extracted_at: null, norm_v: "1.8.0", inherited: false, inherited_from: null };
const kept = decide(row, { versionThreshold: "9.9.9" });
check("renormalize leaves a derived fact exactly as it is, under its own reason (it would otherwise RETRACT it)",
  kept.outcome === "unrecoverable" && kept.reason === "DERIVED_REPLAYED_BY_ITS_DERIVATION", kept);
sabotages++;
const asRead = decide({ ...row, method: "html_table" }, { versionThreshold: "9.9.9" });
check("SABOTAGE the same raw on a READ fact is refused by the normaliser: the derived branch is what protects the value",
  asRead.outcome === "refused", asRead);
check("the suite carries at least 4 sabotage cases", sabotages >= 4, sabotages);

if (misses.length) { console.log(`ponStandard: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`ponStandard: ${pass} passed, 0 missed (${sabotages} sabotage cases, ${W.rows.length} witnesses)`);
