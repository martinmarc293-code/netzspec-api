// tests/cellular.test.ts — the derived gate `cellular_bands` needs, and the two ways it was wrong first.
//
// Every case here is a real live SKU. The rule was SCORED against the 62 parts that already hold a
// `cellular_bands` fact before it was written down, and both of its earlier versions failed that scoring in
// opposite directions — which is the only reason either is visible:
//
//   anchored (LTE not followed by a letter)   MISSED 6 of the 62: C1111-4PLTEEA, C1117-4PMLTEEAWE …
//   unanchored (LTE anywhere)                 claimed 1,067 parts, 374 of them URL-FILTERING licences,
//                                             because "fiLTEr" contains LTE. Also CRS-16-DRILLTEMP.
//   token-scoped (this one)                   62 of 62, 477 claimed catalogue-wide
//
// And `4G` / `5G` are refused outright: in a Cisco SKU they read GIGABIT far more often than cellular.

import { cellularOf, isCellular } from "../src/core/cellular.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) pass++;
  else misses.push(`    MISS ${name}${got === undefined ? "" : `: got ${JSON.stringify(got)}`}`);
};

// --- ACCEPTED: every shape the 62 ground-truth parts take ------------------------------------------
for (const [sku, why] of [
  ["EHWIC-4G-LTE-V", "LTE"],                 // the token is exactly LTE
  ["C1111-4PLTEEA", "LTE"],                  // buried mid-token — the six the anchored version missed
  ["C1117-4PMLTEEAWE", "LTE"],
  ["C1109-2PLTEGB", "LTE"],
  ["IR809G-LTE-LA-K9", "LTE"],
  ["CGM-4G-LTE-MNA-AB", "LTE"],              // carries 4G AND LTE; LTE is what decides it
  ["PCEX-3G-HSPA-G", "legacy cellular standard"],
] as const) {
  const v = cellularOf(sku, null);
  check(`${sku} is cellular (${why})`, v.cellular && v.why === `SKU: ${why}`, v);
}
// THE RULING'S OWN WITNESS: the reviewer named Z4C-HW when they ruled the gate in.
{
  for (const sku of ["Z4C", "Z4C-HW", "MX67C", "MX68CW"]) {
    const v = cellularOf(sku, null);
    check(`${sku} is cellular (the Meraki C / CW model)`, v.cellular && v.why === "SKU: Meraki C / CW model", v);
  }
}

// --- REFUSED, each for the reason it was nearly accepted for ---------------------------------------
for (const [sku, name, whyNot] of [
  ["ASR-9906-FILTER", "Cisco ASR 9906 fan filter", "fiLTEr contains LTE"],
  ["CRS-16-DRILLTEMP", "CRS 16 slots Drill Template", "driLLTEmp contains LTE"],
  ["L-ASA5545-URL=", "Cisco ASA5545 FirePOWER URL Filtering", "the NAME says Filtering"],
  ["CBS220-48T-4G-AU", "Cisco CBS220-48T-4G-AU", "4G here is four GIGABIT uplinks"],
  ["C9300L-48PF-4G", "Cisco C9300L-48PF-4G Managed Switch", "likewise"],
  ["SG350X-48PV-K9-BR", "48-Port 5G PoE Stackable Managed Switch", "its own name says 5G meaning 5 Gigabit"],
  ["CW9166I", "Cisco Catalyst 9166I Access Point", "CW is CATALYST WIRELESS here, not Cellular+Wi-Fi"],
  ["CW9164I-MR", "Cisco Catalyst 9164I Access Point", "likewise, and it is a Meraki-managed AP"],
  ["MX64W", "Cisco MX64W", "W is Wi-Fi; only C and CW are cellular"],
  ["Z4", "Cisco Z4", "the non-cellular teleworker gateway — the C model is the cellular one"],
] as const) {
  const v = cellularOf(sku, name);
  check(`${sku} is NOT cellular (${whyNot})`, !v.cellular, v);
}

// --- the Z pair is the sharpest control: one letter apart, opposite answers ------------------------
check("Z4 and Z4C differ, and only on the C", !isCellular("Z4") && isCellular("Z4C"));
check("MX68W and MX68CW differ, and only on the C", !isCellular("MX68W") && isCellular("MX68CW"));

// --- NOT VACUOUS ----------------------------------------------------------------------------------
check("an empty SKU is not cellular", !isCellular(""));
check("the rule accepts some and refuses others",
  ["EHWIC-4G-LTE-V", "Z4C"].every((s) => isCellular(s)) && ["CW9166I", "Z4"].every((s) => !isCellular(s)));
check("every verdict carries a reason", ["Z4C", "Z4", "ASR-9906-FILTER"].every((s) => cellularOf(s, null).why.trim().length > 0));

console.log(misses.join("\n"));
console.log(`    cellular: ${pass} passed, ${misses.length} missed ` +
  `(11 accepted shapes, 10 refusals, 2 one-letter controls; scored 62/62 against the parts holding a cellular_bands fact)`);
if (misses.length) process.exit(1);
