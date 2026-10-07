// tests/printedPid.test.ts — the exact-token boundary of ruling (C), 7 Oct 2026, both implementations.
//
//   npx tsx tests/printedPid.test.ts
import { pageTokens, pidKey, printedAt } from "../src/core/printedPid.js";

let passed = 0; const misses: string[] = []; let sabotages = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`  MISS ${name}${detail ? " — " + detail : ""}`); };
/** Both implementations, which must agree: [token-set answer, lookaround answer]. */
const both = (text: string, sku: string) => { const k = pidKey(sku)!; return [pageTokens(text).has(k), printedAt(text, k) >= 0] as const; };
const is = (text: string, sku: string, want: boolean, name: string) => { const [a, b] = both(text, sku); check(name, a === want && b === want, `tokens ${a}, lookaround ${b}`); };

// ---- the ruling's own cases (lower-cased, as cachedText gives it)
is("ordering: c8200-1n-4t catalyst 8200 edge", "C8200-1N-4T", true, "CONTROL the base printed alone links the base");
sabotages++; is("spare: c8200-1n-4t= (spare)", "C8200-1N-4T", false, "SABOTAGE the base never links from C8200-1N-4T=");
sabotages++; is("c8200-1n-4t-xx bundle", "C8200-1N-4T", false, "SABOTAGE the base never links from C8200-1N-4T-xx");
sabotages++; is("ordering: c8200-1n-4t catalyst", "C8200-1N-4T=", false, "SABOTAGE the reverse: the spare never links from the base");
is("spare: c8200-1n-4t= (spare)", "C8200-1N-4T=", true, "CONTROL the spare printed links the spare");
sabotages++; is("c8200-1n-4t-xx", "C8200-1N-4T=", false, "SABOTAGE the spare never links from C8200-1N-4T-xx");
// ---- punctuation a token sheds or keeps
is("order the c8200-1n-4t.", "C8200-1N-4T", true, "a sentence's full stop is shed");
is("(c8200-1n-4t, c8300-1n1s-6t)", "C8300-1N1S-6T", true, "brackets and commas are not part of a PID");
is("isr4331/k9 ships with", "ISR4331/K9", true, "a slash inside a PID is kept");
sabotages++; is("isr4331/k9 ships with", "ISR4331", false, "SABOTAGE ISR4331 never links from ISR4331/K9");
sabotages++; is("asr1000-mip100++= spare", "ASR1000-MIP100+", false, "SABOTAGE ASR1000-MIP100+ never links from ASR1000-MIP100++=");
sabotages++; is("rv260w-e-k9-g5 router", "RV260W-A-K9-G5", false, "SABOTAGE a region variant never links from another region's PID");
sabotages++; is("ab-c8200-1n-4t", "C8200-1N-4T", false, "SABOTAGE a prefix glued on is a different token");
is("pwr-4450-poe-ac/2= redundant", "PWR-4450-POE-AC/2=", true, "a real spare with slash and = links");
// ---- the key
check("a SKU with a space has no key", pidKey("CAB ACTW") === null);
check("a SKU of punctuation only has no key", pidKey("=") === null);
check("keys are lower-cased", pidKey("NC57-MPA-12L-S") === "nc57-mpa-12l-s");
sabotages++; check("SABOTAGE a SKU ending in '/' (the real catalogue row C8151-CVAP-G2/) has no key: no token can equal it", pidKey("C8151-CVAP-G2/") === null);
check("a SKU ending in '=' keeps its key (a spare)", pidKey("C8151-CVAP-G2=") === "c8151-cvap-g2=");

if (misses.length) { console.log(`printed pid: ${passed} passed, ${misses.length} missed`); for (const m of misses) console.log(m); process.exit(1); }
console.log(`printed pid: ${passed} passed, 0 missed (${sabotages} sabotage cases)`);
