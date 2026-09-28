// tests/kindOverrides.test.ts — every ruled per-SKU kind exists in its category (LEDGER_KINDS, the one list of kinds) and
// covers a SKU its axis cannot classify; a stale or undeclared entry fails. Decision: docs/decisions/2026-09-28-unknown-kind-106.md
import { KIND_OVERRIDES, type KindOverride } from "../src/core/kindOverrides.js";
import { LEDGER_KINDS } from "../src/core/cupLedger.js";
import { axisOnlyKind, partKind } from "../src/core/partKind.js";

export function overrideProblems(table: Readonly<Record<string, KindOverride>>): string[] {
  const out: string[] = [];
  for (const [sku, o] of Object.entries(table)) {
    if (!(LEDGER_KINDS[o.category] ?? []).includes(o.kind)) out.push(`${sku}: ${o.category} declares no kind ${o.kind}`);
    const axis = axisOnlyKind(o.category, sku);
    if (axis !== undefined && axis !== "unknown") out.push(`${sku}: stale, the ${o.category} axis already says ${axis}`);
  }
  return out;
}

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => { if (ok) pass++; else misses.push(`${name}: ${JSON.stringify(got)}`); };

const live = overrideProblems(KIND_OVERRIDES);
check(`all ${Object.keys(KIND_OVERRIDES).length} overrides are declared and not stale`, live.length === 0, live.slice(0, 5));
check("partKind applies an override where the axis gives up", partKind("optical-networking", "EWDM-OA=") === "amplifier",
  partKind("optical-networking", "EWDM-OA="));
check("an override never applies in another category", partKind("switches", "EWDM-OA=") !== "amplifier");
check("NEGATIVE an undeclared kind is refused",
  overrideProblems({ "AVIZ-EDU=": { category: "collaboration-endpoints", kind: "ont" } }).some((p) => /declares no kind/.test(p)));
check("NEGATIVE a stale override (the axis already knows) is refused",
  overrideProblems({ "C9300-24T": { category: "switches", kind: "accessory" } }).some((p) => /stale/.test(p)));

if (misses.length) { console.log(`kind overrides: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`kind overrides: ${pass} passed, 0 missed (${Object.keys(KIND_OVERRIDES).length} entries)`);
