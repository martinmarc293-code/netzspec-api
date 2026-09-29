// tests/kindProfiles.test.ts — the parity exceptions: a ruling covers what it names, and a LEASE lapses when its signal lands.
//
//   npx tsx tests/kindProfiles.test.ts
import { FIELD_DICTIONARY, requirementFor } from "../src/core/fieldSchema.js";
import { KIND_PARITY_EXCEPTIONS, parityRuled, leaseLapsed, type KindParityException } from "../src/core/kindProfiles.js";
import { KIND_DECLARED_OPTIONAL, LEDGER_KINDS, kindQuestionSet } from "../src/core/cupLedger.js";

let passed = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };

// `asks` is the caller's resolution. The verifier passes the sets it resolved through requirementFor; these cases pass the
// real resolver too, except the sabotage below, whose answers are fixed so it cannot drift with the profiles.
const real = (kind: string) => (cat: string, cup: string): string => {
  const r = requirementFor(cat, cup, { kind } as never);
  return r === "req" || r === "pending" ? r : "no";
};

// Rule 6 (Batch B, 29 Sep 2026): routers.module's power_max is excused, together with switches' PoE ruling.
const mod = parityRuled("module", ["power_max", "poe_standard", "poe_ports"], ["routers", "interfaces-modules", "switches"], real("module"));
check("module: power_max (rule 6) + the PoE cups are all covered", mod.ruled, JSON.stringify(mod.uncovered));
// ...and a ruling never excuses a cup it does not name.
const modMore = parityRuled("module", ["power_max", "ports"], ["routers", "interfaces-modules"], real("module"));
check("SABOTAGE module: a cup no ruling names (ports) is still uncovered", !modMore.ruled && modMore.uncovered.join() === "ports", JSON.stringify(modMore));
// Q2 (29 Sep 2026): data_rate is excused in the two categories the two rulings name, and only there.
check("module: data_rate is covered by the interfaces-modules and routers rulings",
  parityRuled("module", ["data_rate"], ["routers", "interfaces-modules", "switches", "security"], real("module")).ruled);

// THE HOLE Q3 CLOSED (29 Sep 2026): a ruling covers ONLY the categories it names. The routers power_max ruling must not excuse a
// third category that also does not ask power_max -- before the fix it did, for every category, the moment it named the cup.
const hole = parityRuled("module", ["power_max"], ["routers", "interfaces-modules", "wireless"],
  (cat) => (cat === "interfaces-modules" ? "req" : "no"));
check("SABOTAGE Q3: the routers ruling does not excuse wireless (interfaces-modules asks, wireless does not, no ruling names wireless)",
  !hole.ruled && hole.uncovered.join() === "power_max", JSON.stringify(hole));
const closed = parityRuled("module", ["power_max"], ["routers", "interfaces-modules", "wireless"], () => "req");
check("CONTROL Q3: the same ruling covers the cup when every category it does not name agrees", closed.ruled, JSON.stringify(closed));

// The cable/media lease: active while cable_construction is not a dictionary key.
const cable = KIND_PARITY_EXCEPTIONS.find((e) => e.kind === "cable" && e.cups.includes("media"));
check("cable/media exception exists and is a LEASE on cable_construction", cable?.until?.dictionaryKey === "cable_construction");
check("cable/media lease is active today (cable_construction is not a dictionary key yet)",
  !!cable && !leaseLapsed(cable) && !Object.prototype.hasOwnProperty.call(FIELD_DICTIONARY, "cable_construction"));
check("cable: media is covered while the lease holds", parityRuled("cable", ["media"], ["collaboration-endpoints", "switches"], real("cable")).ruled);
// SABOTAGE: the same exception leased on a key that DOES exist has lapsed, and would excuse nothing.
const lapsed: KindParityException = { ...cable!, until: { dictionaryKey: "weight", note: "a key that exists" } };
check("SABOTAGE a lease whose key exists has LAPSED", leaseLapsed(lapsed));
// A DATED lease (the antenna_gain measurement, 29 Sep 2026) lapses the day after its date and holds until then.
const antenna = KIND_PARITY_EXCEPTIONS.find((e) => e.kind === "antenna" && e.cups.includes("antenna_gain"));
check("antenna_gain on routers is a DATED lease", !!antenna?.until?.date && !antenna.until.dictionaryKey);
check("SABOTAGE a dated lease has LAPSED the day after its date", !!antenna && leaseLapsed(antenna, "2026-10-07"));
check("CONTROL a dated lease holds on its date", !!antenna && !leaseLapsed(antenna, "2026-10-06"));

// A lapsed lease left in the table is a hole: the divergence has come back and the entry reads like a rule in force.
for (const e of KIND_PARITY_EXCEPTIONS.filter((x) => x.until))
  check(`no lapsed lease sits in the table (${e.kind}: ${e.cups.join("/")})`, !leaseLapsed(e),
    e.until!.dictionaryKey ? `remove it: ${e.until!.dictionaryKey} exists now` : `its date ${e.until!.date} has passed: measure, then add the cup or rule it`);
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

console.log(`    kind profiles: ${passed} passed, ${misses.length} missed (5 sabotage cases)`);
if (misses.length) { console.log(misses.join("\n")); process.exit(1); }
