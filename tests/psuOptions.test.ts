// tests/psuOptions.test.ts — the strict reading of a stored psu_options value (retiring the key, Batch C 29 Sep 2026).
//
//   npx tsx tests/psuOptions.test.ts
import { classifyPsuOptions } from "../src/core/psuOptions.js";

let passed = 0; const misses: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) === JSON.stringify(want)) passed++; else misses.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
const act = (v: unknown) => { const d = classifyPsuOptions(v); return d.action === "convert" ? `${d.config}${d.count ? " x" + d.count : ""}` : "retract"; };

// the configurations the corpus actually states (measured 29 Sep: 43 of 417 Cisco facts)
eq("Fixed Internal", act(["Fixed Internal"]), "fixed-internal");
eq("Internal power supply", act(["Internal power supply"]), "fixed-internal");
eq("Built-in", act(["Built-in"]), "fixed-internal");
eq("External AC power supply", act(["External AC power supply"]), "external");
eq("an optional RPS beside a fixed supply is neutral", act(["Fixed Internal", "External RPS* (optional)"]), "fixed-internal");
eq("2 (1+1 redundancy)", act(["2 (1+1 redundancy)"]), "modular-redundant x2");
// the refusals, each the shape of a real stored value
eq("SABOTAGE a PSU SKU list is not a configuration", act(["1100W AC", "PWR-C1-1100WAC-P"]), "retract");
eq("SABOTAGE an input spec is not a configuration", act(["12V/1A", "48-57V DC/0.35A"]), "retract");
eq("SABOTAGE an optional RPS alone says nothing about the unit's own supply", act(["External RPS (optional)"]), "retract");
eq("SABOTAGE a configuration beside prose is refused whole", act(["650W AC Power Supply", "Redundant"]), "retract");
eq("SABOTAGE two configurations that disagree are refused", act(["Fixed Internal", "External"]), "retract");
eq("SABOTAGE a weight poured into the cup", act(["1.16 kg"]), "retract");

console.log(`    psu options: ${passed} passed, ${misses.length} missed (6 refusals)`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
