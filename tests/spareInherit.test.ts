// tests/spareInherit.test.ts — the spare ruling's pure rules (reviewer, 7 Oct 2026), proven on REAL catalogue names.
//
//   npx tsx tests/spareInherit.test.ts
//
// Every refusal case below is a pair read from the routers catalogue on 7 Oct (scripts/inherit-spare.mts plan), and every control
// is a real pair whose names differ only by abbreviation -- the 103 of 106 gaining pairs that must still pair.
import { COPYABLE_DERIVED, exactSparePair, inheritanceRefusal, LIFECYCLE_KEY, SPARE_NOT_INHERITED, spareGate, spareKeyRefusal, spareNameRefusal, spareSeriesMismatches, type GateReceiver } from "../src/core/spareInherit.js";
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";

let passed = 0; const misses: string[] = []; let sabotages = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`  MISS ${name}${detail ? " — " + detail : ""}`); };
const refuses = (s: string, b: string, word: string) => (spareNameRefusal(s, b) ?? "").startsWith(word);

// ---- the three real refusals, each FOR ITS STATED REASON
sabotages++; check("NC55-24H12F-SB=: the base is a 'line card bundle' and the spare is not -> kit/bundle",
  refuses("NCS 5500 24X100G and 12X40G Scale Spare", "NCS 5500 Series 24 ports of 100G and 18 ports of 40G scale base line card bundle", "kit/bundle"));
sabotages++; check("NCS-55A1-48Q6-SYS=: the spare names licences ('min 7 lic + SL') -> licence",
  refuses("NCS-55A1 48x25+6x100G Base HW FCM min 7 lic + SL, spare", "Bifrost Flexible Consumption Model 48X25G + 6x100G Chassis", "licence"));
sabotages++; check("N520-20G4Z-D=: Industrial vs Commercial temperature -> configuration",
  refuses("Cisco NCS 520 - 20xGE + 4x10GE, Industrial Temp", "Cisco NCS 520 - 20xGE + 4x10GE, Commercial Temp, DC power", "configuration"));
sabotages++; check("NC-55-MOD-A=: the spare is a 'Smart Lic' line card and the base is not -> licence",
  refuses("NC55-MOD-A-S Line Card Flexible Consumption (Smart Lic)", "NC-55-MOD-A Flexible Consumption Model NCS 5500 Modular Base Line Card (requires minimum of 1 MPA)", "licence"));
sabotages++; check("ASR-9001-PLENUM=: the base kit includes a fan, the spare is only the baffle -> kit/bundle",
  refuses("ASR 9001 Plenum Air Baffle Spare", "ASR 9001 Plenum Kit includes V2 fan", "kit/bundle"));
sabotages++; check("AC against DC power -> configuration", refuses("1000W AC PS for ISR4450", "1000W DC PS for ISR4450", "configuration"));

// ---- real controls that must pair: abbreviations, a kit on BOTH sides, one side naming AC where the other is silent
const pairs: [string, string][] = [
  ["ASR 9000 48-port 10GE & 1GE dual rate SE LC", "ASR 9000 48-port dual-rate 10G/1G service edge–optimized line card"],
  ["Cisco Catalyst 8500L Rack mount kit - 19\" 1R", "Cisco Catalyst 8500L Edge accessory kit - 19 inches"],
  ["Cisco C8500, Accessory Kit - 19\" Rack Mount, Spare", "Cisco Catalyst 8500 Edge accessory kit - 19 inches"],
  ["Cisco NCS 520 - 20xGE + 4x10GE, Commercial Temp", "Cisco NCS 520 - 20xGE + 4x10GE, Commercial Temp, AC power"],
  ["Cisco NCS 520 - 20xGE + 4x10GE, Industrial Temp", "Cisco NCS 520 - 20xGE + 4x10GE, Industrial, Temp, DC power"],
  ["500W AC Power Supply for Cisco ISR 4430,Spare", "AC Power Supply with POE for Cisco ISR 4430"],
  ["4GB Compact Flash (Spare) for Cisco 1900, 2900, 3900 ISR (only as spare)", "4GB Compact Flash for Cisco 1900, 2900, 3900 ISR"],
  ["NCS 5700 400G CFP2 DCO & 400G QSFP-DD MPA spare", "NCS 5700 1X400G CFP2 DCO + 1X400G QSFP-DD MPA"],
  // an upgrade PATH is not a licence in the box (the 7 Oct dry run refused these three; the phrase is now read for what it says)
  ["Cisco ASR 1001-X System, Crypto, 6 built-in GE, Dual P/S, Spare", "Cisco ASR 1001-X Router Chassis (ESP integrated; upgradable from 2.5-Gbps to 20-Gbps via software activated license)"],
  ["Cisco ASR 1002-X System, Crypto, 6 built-in GE, dual power supply, spare", "Cisco ASR 1002-X Router Chassis * (ESP integrated; upgradable from 5-Gbps to 36-Gbps via software activated license)"],
  ["Cisco ASR 1002-HX System, 4x10GE+4x1GE built-in, Dual P/S, optional crypto, spare", "Cisco ASR 1002-HX Router Chassis (ESP integrated; up to 100 Gbps through software-activated port licenses)"],
  ["8x100GE SE LC licensed for Packet Transport Optimized (TR)", "Cisco ASR 9000 8-port 100GE “LAN-only” Service Edge Optimized Line Card licensed for Packet Transport"],
];
for (const [s, b] of pairs) check(`CONTROL pairs: "${s.slice(0, 40)}"`, spareNameRefusal(s, b) === null, spareNameRefusal(s, b) ?? "");
check("CONTROL a missing name is not read as a difference", spareNameRefusal(null, "Cisco ASR 9001") === null && spareNameRefusal("ASR 9001 Chassis", "") === null);

// ---- pairing: exact base + ONE "=", never by any looser string
check("CONTROL A9K-MOD80-SE= pairs with A9K-MOD80-SE", exactSparePair("A9K-MOD80-SE=", "A9K-MOD80-SE"));
sabotages++; check("SABOTAGE ++= does not pair by string with the single-+ base", !exactSparePair("ASR1000-MIP100++=", "ASR1000-MIP100+"));
sabotages++; check("SABOTAGE == does not pair", !exactSparePair("X==", "X=") && !exactSparePair("=", ""));
sabotages++; check("SABOTAGE a different base does not pair", !exactSparePair("PWR-4430-POE-AC=", "PWR-4430-AC"));

// ---- keys: what the ruling excludes, and that every excluded key is a REAL dictionary key (a list checked against the schema)
for (const k of ["bundle_contents", "pack_quantity", "shipping_weight", "license_type", "license_for"]) { sabotages++; check(`SABOTAGE ${k} is not inherited`, spareKeyRefusal(k) !== null); }
sabotages++; check("SABOTAGE a lifecycle key (eol_date) is not inherited", spareKeyRefusal("eol_date") !== null && spareKeyRefusal("end_of_sale") !== null);
for (const k of ["weight", "dimensions", "ports", "router_throughput", "certifications", "dram", "psu_options"]) check(`CONTROL ${k} is inherited`, spareKeyRefusal(k) === null);
const dict = new Set(Object.keys(FIELD_DICTIONARY));
const strays = [...SPARE_NOT_INHERITED].filter((k) => !dict.has(k) && k !== "shipping_dimensions");
check("every excluded key is a dictionary key (shipping_dimensions is the one named for the day it is added)", strays.length === 0, strays.join(", "));
const lifeKeys = [...dict].filter((k) => LIFECYCLE_KEY.test(k));
check("no dictionary key is a lifecycle date today (the pattern guards a future one)", lifeKeys.length === 0, lifeKeys.join(", "));
check("COPYABLE_DERIVED is exactly the three registered weight derivations",
  [...COPYABLE_DERIVED].sort().join(",") === "derived:family-row,derived:max-bound,derived:model-row");

// ---- ruling (A): the store's gates, asked about the PARTNER when the receiver is refused (both branches, with real SKUs)
const R = (sku: string, family: string | null, series: string | null, name: string | null = null): GateReceiver =>
  ({ sku, name, product_class: "hardware", category_slug: "routers", family, product_series: series, vendor_slug: "cisco" });
const pwrSpare = R("PWR-CC1-650WAC=", "PWR-CC1-650WAC", null), pwrBase = R("PWR-CC1-650WAC", "PWR-CC1-650WAC", null);
const viaBase = { docId: null, docTitle: null, inheritedFrom: "PWR-CC1-650WAC" };
// the 7 Oct dry run: all 80 PWR- facts were refused for the base too -- a component shape refuses on the SKU, whichever side
const pw = spareGate(pwrSpare, pwrBase, viaBase);
check("FAILS FOR THE PARTNER TOO: PWR-CC1-650WAC= stays refused, answered by the partner, rule prefixed partner:",
  pw.refusal !== null && pw.answeredBy === "partner" && pw.refusal.rule === "partner:component:PWR-" && pw.receiverRefusal?.rule === "component:PWR-", JSON.stringify(pw));
check("NO PARTNER: the receiver's own refusal stands, unprefixed", spareGate(pwrSpare, null, viaBase).refusal?.rule === "component:PWR-");
// PASSES FOR THE PARTNER: a spare row whose model and series were never written (refused family:unknown) and its base whose model
// IS the inherited_from -- no such pair holds a refused fact in routers today, so this is the branch's constructed case
const c8Spare = R("C8200-1N-4T=", null, null), c8Base = R("C8200-1N-4T", "C8200-1N-4T", "Catalyst 8200 Series Edge Platforms");
const viaC8 = { docId: null, docTitle: null, inheritedFrom: "C8200-1N-4T" };
const c8 = spareGate(c8Spare, c8Base, viaC8);
check("CONTROL the receiver alone is refused (family unknown) -- the premise of the next case", inheritanceRefusal(c8Spare, viaC8) !== null, JSON.stringify(inheritanceRefusal(c8Spare, viaC8)));
check("PASSES FOR THE PARTNER: admitted on the base's answer, the receiver's refusal kept for the record",
  c8.refusal === null && c8.answeredBy === "partner" && c8.receiverRefusal !== null, JSON.stringify(c8));
check("CONTROL a receiver the gate admits never asks the partner", spareGate(c8Base, c8Spare, viaC8).answeredBy === "receiver" && spareGate(c8Base, c8Spare, viaC8).refusal === null);
sabotages++; check("SABOTAGE a partner that is a DIFFERENT part (PWR-CC1-650WAC answering for C8200-1N-4T=) does not admit",
  spareGate(c8Spare, pwrBase, viaC8).refusal !== null);

// ---- series parity (reviewer R2, 7 Oct 2026), the real pair that turned router_throughput_series red, both ways
sabotages++; check("SABOTAGE the spare drifted: C8500-12X= 'ASR 1000' vs its base's 'Catalyst 8500L' is a mismatch",
  spareSeriesMismatches([{ spare: "C8500-12X=", spareSeries: "ASR 1000", base: "C8500-12X", baseSeries: "Catalyst 8500L" }]).length === 1);
sabotages++; check("SABOTAGE the base drifted (or holds none): a series on one side only is a mismatch",
  spareSeriesMismatches([{ spare: "C8500-12X=", spareSeries: "Catalyst 8500L", base: "C8500-12X", baseSeries: null }]).length === 1);
check("CONTROL equal series, and no series on either side, pass",
  spareSeriesMismatches([{ spare: "C8500-12X=", spareSeries: "Catalyst 8500L", base: "C8500-12X", baseSeries: "Catalyst 8500L" }, { spare: "X=", spareSeries: null, base: "X", baseSeries: null }]).length === 0);

if (misses.length) { console.log(`spare inherit: ${passed} passed, ${misses.length} missed`); for (const m of misses) console.log(m); process.exit(1); }
console.log(`spare inherit: ${passed} passed, 0 missed (${sabotages} sabotage cases)`);
