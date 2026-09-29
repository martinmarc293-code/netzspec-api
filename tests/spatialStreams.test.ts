// tests/spatialStreams.test.ts — the spatial_streams enum aliases, real stored raws only (Batch C, 29 Sep 2026).
//
//   npx tsx tests/spatialStreams.test.ts
import { normalizeField } from "../src/core/specNormalize.js";

let passed = 0; const misses: string[] = [];
const got = (raw: string) => { const r = normalizeField("wireless", "spatial_streams", raw, { locale: "en" }); return r.ok ? r.value : "REFUSED"; };
const eq = (name: string, a: unknown, b: unknown) => { if (JSON.stringify(a) === JSON.stringify(b)) passed++; else misses.push(`    MISS ${name}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

// The MIMO sentence names the array AND the stream count (MR46).
eq("MR46: the MIMO sentence is 4x4:4", got("4 x 4 multiple input, multiple output (MIMO) with four spatial streams"), "4x4:4");
eq("the compact forms still fold", got("4X4:3"), "4x4:3");
eq("a bare array stays an array (no stream count invented)", got("2x2 MIMO"), "2x2");
// REFUSALS, each a real stored raw: two radios, two configurations, a count word that disagrees with the array.
eq("SABOTAGE MR44: two radios in one cell", got("2.4GHz: 2 x 2 multiple input, multiple output (MIMO) with two spatial streams 5GHz: 4 x 4 multiple input, multiple output (MIMO) with four spatial streams"), "REFUSED");
eq("SABOTAGE MR56: two radios, truncated", got("8 x 8 multiple input, multiple output (MIMO) with eight spatial streams on 5 GHz 4 x 4 multiple input, multiple output (MIMO) with eight spatial streams on 2.4 "), "REFUSED");
eq("SABOTAGE CW9174E: a capability statement ('or')", got("10 or 8 (2x2+4x4+4x4 or 4x4+4x4)"), "REFUSED");
eq("SABOTAGE MR46E: a sum of two radios", got("8 (4x4 + 4x4)"), "REFUSED");
eq("SABOTAGE a count word that disagrees with the array", got("4 x 4 multiple input, multiple output (MIMO) with two spatial streams"), "REFUSED");

console.log(`    spatial streams: ${passed} passed, ${misses.length} missed (5 refusals)`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
