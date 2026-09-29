// tests/kindProfiles.test.ts — the parity exceptions: a ruling covers what it names, and a LEASE lapses when its signal lands.
//
//   npx tsx tests/kindProfiles.test.ts
import { FIELD_DICTIONARY } from "../src/core/fieldSchema.js";
import { KIND_PARITY_EXCEPTIONS, parityRuled, leaseLapsed, type KindParityException } from "../src/core/kindProfiles.js";
import { KIND_DECLARED_OPTIONAL, LEDGER_KINDS, kindQuestionSet } from "../src/core/cupLedger.js";

let passed = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };

// Rule 6 (Batch B, 29 Sep 2026): routers.module's power_max is excused, together with switches' PoE ruling.
const mod = parityRuled("module", ["power_max", "poe_standard", "poe_ports"], ["routers", "interfaces-modules", "switches"]);
check("module: power_max (rule 6) + the PoE cups are all covered", mod.ruled, JSON.stringify(mod.uncovered));
// ...and a ruling never excuses a cup it does not name.
const modMore = parityRuled("module", ["power_max", "data_rate"], ["routers", "interfaces-modules"]);
check("SABOTAGE module: a cup no ruling names (data_rate) is still uncovered", !modMore.ruled && modMore.uncovered.join() === "data_rate", JSON.stringify(modMore));

// The cable/media lease: active while cable_construction is not a dictionary key.
const cable = KIND_PARITY_EXCEPTIONS.find((e) => e.kind === "cable" && e.cups.includes("media"));
check("cable/media exception exists and is a LEASE on cable_construction", cable?.until?.dictionaryKey === "cable_construction");
check("cable/media lease is active today (cable_construction is not a dictionary key yet)",
  !!cable && !leaseLapsed(cable) && !Object.prototype.hasOwnProperty.call(FIELD_DICTIONARY, "cable_construction"));
check("cable: media is covered while the lease holds", parityRuled("cable", ["media"], ["collaboration-endpoints", "switches"]).ruled);
// SABOTAGE: the same exception leased on a key that DOES exist has lapsed, and would excuse nothing.
const lapsed: KindParityException = { ...cable!, until: { dictionaryKey: "weight", note: "a key that exists" } };
check("SABOTAGE a lease whose key exists has LAPSED", leaseLapsed(lapsed));

// A lapsed lease left in the table is a hole: the divergence has come back and the entry reads like a rule in force.
for (const e of KIND_PARITY_EXCEPTIONS.filter((x) => x.until))
  check(`no lapsed lease sits in the table (${e.kind}: ${e.cups.join("/")})`, !leaseLapsed(e), `remove it: ${e.until!.dictionaryKey} exists now`);
for (const e of KIND_PARITY_EXCEPTIONS)
  check(`${e.kind} (${e.categories.join(",")}): carries a reason and a witness SKU`, e.reason.length > 40 && /^[A-Z0-9][A-Z0-9=+/.-]+$/.test(e.witness), e.witness);

// THE VETO QUEUE'S "REAL VALUE" SIDE (Batch C, 29 Sep 2026): every declared-optional entry is a ledger kind, is never na,
// and carries a witness; and a cup NOT declared keeps the derivation's answer -- the table widens only what it names.
for (const [cat, byKind] of Object.entries(KIND_DECLARED_OPTIONAL)) for (const [kind, list] of Object.entries(byKind)) {
  const q = kindQuestionSet(cat, kind);
  check(`${cat}/${kind} is a kind the ledger lists`, (LEDGER_KINDS[cat] ?? []).includes(kind));
  for (const e of list) check(`${cat}/${kind}: ${e.cup} is declared optional, never na (witness ${e.witness})`,
    q.optional.includes(e.cup) && !q.not_applicable_by_kind.includes(e.cup) && /^[A-Z0-9][A-Z0-9=+/.-]+$/.test(e.witness));
}
check("SABOTAGE/CONTROL an undeclared cup keeps its derived na (UCS memory is never asked `cpu`)",
  kindQuestionSet("servers-unified-computing", "memory").not_applicable_by_kind.includes("cpu"));

console.log(`    kind profiles: ${passed} passed, ${misses.length} missed (2 sabotage cases)`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
