// tests/layerFromSku.test.ts — the only fill path `layer` has, and the scope is the whole point.
//
//   npx tsx tests/layerFromSku.test.ts
//
// `layer` was required of 4,931 switches with NO fill path (round-6 B2): 1,054 operator seeds and
// nothing else, on the one cup in the catalogue whose `observed_fill_path` was false, and it gated
// two more cups. It is now optional, and this is the derivation that may fill it.
//
// THE SCOPE IS NOT TIDINESS. Measured against the 1,054 seeds:
//
//     unscoped (any series)          precision 0.913, coverage 20%
//     scoped to the tier families    precision 1.000, coverage 10.1%, 224 new fills
//
// Every one of the 46 unscoped errors was an IE-* or 2960 row, where the trailing letter is not a
// feature set. Halving the coverage to remove them is the right trade, because a wrong `layer`
// decided `ipv4_routes` and `ipv6_routes` as well.
//
// Validated against the live corpus by D:\tmp\layer-validate.mts, which calls THIS function (not a
// copy of it) over all 4,931 switch parts: agrees 276, disagrees 0, and of the 225 seeded IE-*/2960
// rows it gets 0 wrong. The cases below are that measurement's shape, pinned so the scope cannot be
// widened without going red.
import { layerFromSku } from "../src/core/layerFromSku.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: unknown, detail = "") => {
  if (ok === true) pass++;
  else misses.push(`${name}${detail ? `\n     ${detail}` : ""}`);
};
const layerOf = (sku: string, series: string | null) => {
  const d = layerFromSku(sku, series);
  return d.ok ? d.layer : `refused:${d.reason}`;
};

// ---- IN SCOPE: the letter is the feature set ---------------------------------------------------
for (const [sku, series, want] of [
  // LAN Base -> L2. Real SKUs from the seeded population.
  ["WS-C3850-24T-L", "Catalyst 3850", "l2"],
  ["WS-C3650-48FS-L", "3650", "l2"],
  ["WS-C3750X-24T-L", "3750-X", "l2"],
  // IP Base and IP Services -> L3
  ["WS-C3850-24T-S", "Catalyst 3850", "l3"],
  ["WS-C3850-48F-E", "Catalyst 3850", "l3"],
  ["WS-C3650-24TD-E", "Catalyst 3650", "l3"],
  ["WS-C3560X-48PF-S", "3560-X", "l3"],
  // Catalyst 9000: -A is Advantage
  ["C9300-24T-A", "Catalyst 9300", "l3"],
  ["C9200-24P-E", "Catalyst 9200", "l3"],
  ["C9500-48Y4C-A", "Catalyst 9500", "l3"],
  // the spare and upgrade suffixes must not hide the letter
  ["WS-C3850-24T-L=", "Catalyst 3850", "l2"],
  ["WS-C3850-24T-S=", "Catalyst 3850", "l3"],
  ["C9300-24T-A+", "Catalyst 9300", "l3"],
  ["C9300-24T-A++", "Catalyst 9300", "l3"],
  // the series spelled both ways, because the corpus spells it both ways (101 rows "3650", 7 "Catalyst 3650")
  ["WS-C3650-24TS-L", "Catalyst 3650", "l2"],
] as const) check(`${sku} (${series}) -> ${want}`, layerOf(sku, series) === want, `got ${layerOf(sku, series)}`);

// ---- REFUSED because the series does not use the letter that way -------------------------------
// THESE ARE THE 46 MEASURED ERRORS of the unscoped rule. Every one is a real seeded row whose seed
// says l2 while the letter says l3 — so a rule without this scope writes the wrong answer, not a
// missing one.
for (const [sku, series] of [
  ["IE-4000-16T4G-E", "IE4000"],
  ["IE-4000-4GC4GP4G-E", "IE4000"],
  ["IE-4000-4S8P4G-E", "IE4000"],
  ["IE-2000-16TC-G-E", "IE2000"],
  ["IE-2000-8TC-G-E", "IE2000"],
  ["IE-3100-6P2U2C-E", "IE3100"],
  ["IE-3100-18T2C-CC-E", "IE3100"],
  ["IE-3100-3P1U2S-E", "IE3100"],
  ["WS-C2960-24PC-S", "Catalyst 2960"],
  ["WS-C2960-8TC-S", "Catalyst 2960"],
  ["WS-C2960+24PC-S", "2960Plus"],
  ["WS-C2960C-8TC-S", "2960C"],
] as const) {
  const d = layerFromSku(sku, series);
  check(`${sku} (${series}) is REFUSED — the letter is not a feature set on this line`,
    !d.ok && d.reason === "series-letter-is-not-a-tier",
    `got ${JSON.stringify(d)}`);
}

// ---- REFUSED for the other three reasons, each distinct ----------------------------------------
check("a series nobody has scoped is out-of-scope, not a guess",
  layerOf("N9K-C93180YC-FX", "Nexus 9300") === "refused:series-out-of-scope");
check("an in-scope series with no tier letter says so",
  layerOf("WS-C3850-12XS", "Catalyst 3850") === "refused:no-tier-suffix");
check("no series at all is its own reason",
  layerOf("WS-C3850-24T-L", null) === "refused:no-series");
check("an empty series is the same reason", layerOf("WS-C3850-24T-L", "") === "refused:no-series");

// ---- SABOTAGE: the ways this rule could go wrong -----------------------------------------------
// A letter in the MIDDLE of the SKU is not the feature set. `-E` here is part of the model.
check("SABOTAGE a letter mid-SKU is not read as the tier",
  layerOf("WS-C3850-24XS-E-FOO", "Catalyst 3850") === "refused:no-tier-suffix",
  "the suffix must be anchored to the end, after the = and + suffixes only");
// The tier letters are exactly L/S/E/A. A different trailing letter must refuse, not default.
for (const bad of ["WS-C3850-24T-K", "WS-C3850-24T-X", "WS-C3850-24T-P"])
  check(`SABOTAGE ${bad} has a trailing letter that is not a tier`,
    layerOf(bad, "Catalyst 3850") === "refused:no-tier-suffix", `got ${layerOf(bad, "Catalyst 3850")}`);
// The exclusion list must beat the inclusion list, or a series matching both is decided by order.
check("SABOTAGE the exclusion wins over the inclusion for a series in both",
  layerOf("IE-3650-X-E", "Catalyst 2960") === "refused:series-letter-is-not-a-tier",
  "NOT_A_TIER_SERIES is tested first on purpose");
// An IE series must not sneak in through a 3650-looking prefix.
check("SABOTAGE an IE series naming a tier-family number is still refused",
  layerOf("IE-9300-24T-A", "IE9300") === "refused:series-letter-is-not-a-tier");
// And the inclusion must be ANCHORED: a series that merely contains 9300 is not the 9300 family.
check("SABOTAGE a series that only CONTAINS a family number is out of scope",
  layerOf("FOO-24T-A", "Nexus 93009300") === "refused:series-out-of-scope");
// The two directions of the answer must both be reachable — a rule that only ever says l3 would
// pass every L3 case above and be useless.
check("CONTROL both answers are reachable",
  layerOf("WS-C3850-24T-L", "Catalyst 3850") === "l2" && layerOf("WS-C3850-24T-S", "Catalyst 3850") === "l3");
// The `because` string is part of the output because a derived fact needs to say what derived it.
{
  const d = layerFromSku("WS-C3850-24T-L", "Catalyst 3850");
  check("a derivation names the feature set it read", d.ok && d.because === "LAN Base", JSON.stringify(d));
  const e = layerFromSku("C9300-24T-A", "Catalyst 9300");
  check("Advantage is named for the 9000 family", e.ok && e.because === "Advantage", JSON.stringify(e));
}

console.log(`    layer from sku: ${pass} passed, ${misses.length} missed (16 in scope, 12 measured IE/2960 refusals, 4 other refusals, 9 sabotage/control)`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  process.exit(1);
}
