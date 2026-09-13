// tests/gateR1.test.ts — R1: NEVER GATE A CUP ON A FACT NOBODY IS REQUIRED TO ANSWER.
//
//   npx tsx tests/gateR1.test.ts
//
// R1 has been written in three reports and quoted back to a reviewer as one of the rules this
// schema is built on. Nothing enforced it. "If you can state a rule in a sentence, it needs its own
// check and its own error message" — and a guarantee that merely falls out of other rules is not a
// rule, because change any one of them and it disappears in silence.
//
// WHAT GOES WRONG WITHOUT IT. `requirementFor` is three-way and deliberately so
// (tests/pendingRequirement.test.ts): a gate that is present and does not match, OR a gate that is
// only `opt`, resolves to `na`. That decision is right — if nobody is obliged to answer the gate,
// its absence is not evidence of anything, and calling it `pending` would open gaps at scale. The
// consequence, which nothing checked, is that A COND WHOSE GATE IS OPTIONAL IS A CUP THAT CLOSES
// ITSELF. Measured on 12 Sep 2026 in the switches profile:
//
//   airflow      cond(kind in [fan,power,fex] OR deploy_role in [tor,agg,core])
//                -> NOT APPLICABLE to all 4,931 parts of kind `switch`, a cup with 187 label
//                   occurrences and 225 stored facts. `deploy_role` has 2 facts and no label maps
//                   to it, so the branch could never fire.
//   ip_rating    cond(form_factor = din-rail OR deploy_role = industrial)   -> same gate
//   module_slots cond(form_factor = modular-chassis OR uplink_modular)      -> `uplink_modular` is
//                   a boolean with ZERO facts and no label anywhere in the 23,651-label inventory
//
// The round-6 reviewer found the last two by scanning the ledger's
// `pending_until_gate_answered`. That scan CANNOT see the first one, which is the worst of the
// three: `airflow` had already resolved to `na`, so it had left the pending list entirely. A scan
// over the SYMPTOM sees only the cups still deciding; this scan is over the CONDITION, which is the
// house rule about writing the guard against the condition rather than the culprit that bit you.
//
// THE THREE EXEMPTIONS, each a real answerability argument rather than a convenience:
//
//   elseOpt         an unmet cond resolves to `opt`, not `na`. Nothing closes, so an optional gate
//                   is harmless — this is the shape the three fixes above adopted.
//   `kind`          derived for every part by partKind() and never absent. Not a cup at all.
//   COLUMN_BACKED   `vendor`, `series` — a column on `parts`, answered by construction. Measured
//                   12 Sep 2026: 0 of 42,450 live Cisco hardware rows have `series` NULL, so the
//                   11 security `appliance` cups and wireless `wlc.router_throughput` gated on it
//                   are answerable today. Asserted below so "fragile" cannot quietly become "dead".
import fs from "node:fs";
import path from "node:path";
import { PROFILES, COLUMN_BACKED, requirementFor, gateFields } from "../src/core/fieldSchema.js";
// kind-layer infra (13 Sep 2026): R1 per role and §8 gateR1 over the committed ledgers (bottom of this file).
import { kindQuestionSet, LEDGER_KINDS } from "../src/core/cupLedger.js";
import { ROLE_DOMAINS, roleAxisOf } from "../src/core/deployRole.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: unknown, detail = "") => {
  if (ok === true) pass++;
  else misses.push(`${name}${detail ? `\n     ${detail}` : ""}`);
};

type Req = { kind: string; when?: unknown; elseOpt?: boolean };

/**
 * Every field name a condition tests, at any depth, through the SHIPPED extractor — `gateFields`
 * takes the Condition (`r.when`), not the Requirement. Reusing it rather than re-walking the tree
 * is the point: a scan with its own copy of the walk would disagree with the resolver the day the
 * condition grammar gains a node, and disagree silently.
 */
const gatesOf = (r: Req): string[] => (r.when === undefined ? [] : gateFields(r.when as never));

/**
 * THE RULE, as one function, so the sabotage cases below exercise the code that runs.
 *
 * Returns the gate fields that violate R1 for a cup in a given profile: a gate that is neither
 * required nor pending-able in that profile, on a cond that has no `elseOpt` to catch the unmet
 * case. `kind` and the column-backed fields are answerable by construction and are not cups.
 */
export function r1Violations(profile: Record<string, Req>, key: string): string[] {
  const r = profile[key];
  if (!r || r.kind !== "cond" || r.elseOpt === true) return [];
  return gatesOf(r).filter((g) => {
    if (g === "kind" || COLUMN_BACKED.has(g)) return false;
    const gr = profile[g];
    // Absent from the profile is `na` for that key — a gate on something the category never asks.
    if (!gr) return true;
    return gr.kind === "opt" || gr.kind === "na";
  });
}

const cats = Object.keys(PROFILES).sort();
check(`the profiles were read (${cats.length} categories)`, cats.length >= 17, `${cats.length} found`);

const violations: string[] = [];
let conds = 0, gated = 0, exemptElseOpt = 0, exemptKind = 0, exemptColumn = 0;
for (const cat of cats) {
  const profile = PROFILES[cat] as unknown as Record<string, Req>;
  for (const key of Object.keys(profile)) {
    const r = profile[key];
    if (!r || r.kind !== "cond") continue;
    conds++;
    const gs = gatesOf(r);
    if (gs.length) gated++;
    if (r.elseOpt === true) { exemptElseOpt++; continue; }
    for (const g of gs) {
      if (g === "kind") exemptKind++;
      else if (COLUMN_BACKED.has(g)) exemptColumn++;
    }
    for (const bad of r1Violations(profile, key)) violations.push(`${cat}.${key} <- ${bad} (${profile[bad]?.kind ?? "absent"})`);
  }
}
check(`R1: no cup is gated on a fact nobody is required to answer (${conds} conds across ${cats.length} profiles, ${gated} with a gate)`,
  violations.length === 0,
  violations.length
    ? `VIOLATIONS:\n     ${violations.join("\n     ")}\n     Fix by gating on a required cup, promoting the gate to required with a fill path, or\n     adding { elseOpt: true } so the unmet case is optional instead of permanently na.`
    : "");

// ---- the three fixes of 12 Sep, pinned BY OUTCOME ---------------------------------------------
// Pinned by what the cup RESOLVES TO for a switch that has answered nothing, not by the shape of
// the condition: both the old and the new conditions read fine in isolation, and only the resolved
// requirement tells them apart. That is the same reason mapperTrace pins a label's winning cup.
const sw = { vendor: "cisco", series: "Catalyst 9300", kind: "switch" } as Record<string, unknown>;
for (const [key, want] of [["airflow", "opt"], ["ip_rating", "pending"], ["module_slots", "pending"]] as const) {
  const got = requirementFor("switches", key, sw as never);
  check(`switches.${key} for a switch that has answered nothing is "${want}", never "na"`,
    got === want || (want === "pending" && got !== "na"),
    `got ${JSON.stringify(got)} — "na" here is the silent closure R1 exists to prevent`);
}
check("switches.airflow is still REQUIRED of the kinds that are sold by it",
  ["fan", "power", "fex"].every((k) => requirementFor("switches", "airflow", { ...sw, kind: k } as never) === "req"),
  ["fan", "power", "fex"].map((k) => `${k}=${requirementFor("switches", "airflow", { ...sw, kind: k } as never)}`).join(" "));
check("switches.module_slots is still REQUIRED of a modular chassis",
  requirementFor("switches", "module_slots", { ...sw, form_factor: "modular-chassis" } as never) === "req",
  String(requirementFor("switches", "module_slots", { ...sw, form_factor: "modular-chassis" } as never)));
check("switches.ip_rating is still REQUIRED of a din-rail switch",
  requirementFor("switches", "ip_rating", { ...sw, form_factor: "din-rail" } as never) === "req",
  String(requirementFor("switches", "ip_rating", { ...sw, form_factor: "din-rail" } as never)));

// ---- the column-backed exemption must stay TRUE, not merely declared -------------------------
// A gate on `series` is answerable only while `series` is actually answered. The live measurement
// (0 of 42,450 Cisco hardware rows with series NULL) is not available to this suite, so what is
// asserted here is the thing that would make it unanswerable: `series` must remain column-backed.
// If it is ever removed from COLUMN_BACKED, every cup gated on it becomes an R1 violation and the
// scan above starts failing, which is the intended coupling.
check("`series` is column-backed, which is what makes the appliance and wlc gates answerable",
  COLUMN_BACKED.has("series"));
check("`vendor` is column-backed", COLUMN_BACKED.has("vendor"));
check("`kind` is NOT in COLUMN_BACKED and is exempted separately as a derived value",
  !COLUMN_BACKED.has("kind"));

// ---- SABOTAGE: the scan must refuse each shape, for the right reason --------------------------
// Same r1Violations() the repo scan calls, over hand-built profiles, so a case is deterministic
// and leaves nothing on disk.
const P = (o: Record<string, Req>) => o;
const opt: Req = { kind: "opt" };
const req: Req = { kind: "req" };
const na: Req = { kind: "na" };

check("CONTROL a cond gated on a REQUIRED cup passes",
  r1Violations(P({ rack_units: { kind: "cond", when: { field: "form_factor", eq: "rack-19" } }, form_factor: req }), "rack_units").length === 0);
// kind-layer infra (13 Sep 2026): these sabotage cases used `deploy_role` as THE optional gate. Since 0e22f85 `deploy_role`
// is column-backed (derived per part by src/core/deployRole.ts), so r1Violations exempts it and the three cases stopped
// failing — two sabotages that could no longer fail, measured red on 0e22f85 ("gate R1: 19 passed, 2 missed"). The shape
// is unchanged; the gate is now `uplink_modular`, the header's third real instance (an optional boolean, 0 facts, not
// column-backed). The exemption of `deploy_role` itself is pinned as a CONTROL below.
check("SABOTAGE a cond gated on an OPTIONAL cup is refused, naming the gate",
  r1Violations(P({ ip_rating: { kind: "cond", when: { field: "uplink_modular", eq: true } }, uplink_modular: opt }), "ip_rating").join() === "uplink_modular");
check("SABOTAGE a cond gated on a cup the profile marks `na` is refused",
  r1Violations(P({ x: { kind: "cond", when: { field: "g", eq: 1 } }, g: na }), "x").join() === "g");
check("SABOTAGE a cond gated on a cup the profile does not mention at all is refused",
  r1Violations(P({ x: { kind: "cond", when: { field: "ghost", eq: 1 } } }), "x").join() === "ghost");
check("SABOTAGE the AIRFLOW shape — one good branch beside an optional one — is still refused",
  r1Violations(P({
    airflow: { kind: "cond", when: { any: [{ field: "kind", inList: ["fan"] }, { field: "uplink_modular", eq: true }] } },
    uplink_modular: opt,
  }), "airflow").join() === "uplink_modular",
  "an `any` with one answerable branch still closes for every part the answerable branch misses");
check("elseOpt rescues exactly that shape, because the unmet case is `opt` and nothing closes",
  r1Violations(P({
    airflow: { kind: "cond", when: { field: "uplink_modular", eq: true }, elseOpt: true },
    uplink_modular: opt,
  }), "airflow").length === 0);
check("CONTROL a gate on the column-backed, derived `deploy_role` passes (kind-layer, 13 Sep 2026: a role delta is a gate on it)",
  COLUMN_BACKED.has("deploy_role") && r1Violations(P({ x: { kind: "cond", when: { field: "deploy_role", inList: ["smb"] } }, deploy_role: opt }), "x").length === 0);
check("CONTROL a gate on `kind` passes — derived for every part, never absent",
  r1Violations(P({ x: { kind: "cond", when: { field: "kind", inList: ["switch"] } } }), "x").length === 0);
check("CONTROL a gate on the column-backed `series` passes",
  r1Violations(P({ x: { kind: "cond", when: { field: "series", inList: ["Catalyst 9300"] } } }), "x").length === 0);
check("CONTROL a non-cond requirement has no gates to judge",
  r1Violations(P({ x: opt, y: req }), "x").length === 0 && r1Violations(P({ x: opt, y: req }), "y").length === 0);
check("SABOTAGE a nested all/any gate is walked to the bottom",
  r1Violations(P({
    x: { kind: "cond", when: { all: [{ field: "kind", inList: ["switch"] }, { any: [{ field: "deep", eq: true }] }] } },
    deep: opt,
  }), "x").join() === "deep");

// ==== R1 PER ROLE, and §8 gateR1 OVER THE COMMITTED LEDGERS (kind-layer infra, 13 Sep 2026) ========================
//
// The scan above judges a PROFILE cond. The same rule stated on what a part is actually ASKED: a cup listed as pending
// must wait on a gate that the SAME kind — or, since layer 3, the same deploy_role — asks as required, pending or
// column-backed. Otherwise the slot is counted and can only ever close in silence. It is checked twice, because the two
// fail differently:
//   the live question sets   kindQuestionSet(category, kind, role) for every kind and every role of its axis — a role
//                            delta can demote a gate the core still asks;
//   the committed ledgers    data/ledger/*.json, the kind core AND every `roles` block — the artifact every coverage
//                            number is taken over, which can disagree with the profile (hand edit, stale build).
// Measured by the parent on 13 Sep 2026 before layer 3 landed: 0 of 80 pending cups in the committed ledgers.
type Cup = { key: string; gate?: string[] };
type AskedSet = { required: Cup[]; pending_until_gate_answered: Cup[]; column_backed?: string[] };
/** THE ARTIFACT RULE, one function for the repo scan and the sabotage cases below. */
export function ledgerR1(label: string, b: AskedSet): string[] {
  const answerable = new Set([...b.required.map((c) => c.key), ...b.pending_until_gate_answered.map((c) => c.key), ...(b.column_backed ?? [])]);
  const out: string[] = [];
  for (const p of b.pending_until_gate_answered) for (const g of p.gate ?? []) {
    if (!answerable.has(g)) out.push(`${label}.${p.key} is pending on ${g}, which ${label} does not ask as required, pending or column-backed`);
  }
  return out;
}
let r1Sets = 0, r1Pending = 0;
const r1Live: string[] = [];
for (const [cat, kinds] of Object.entries(LEDGER_KINDS)) for (const kind of kinds) {
  const axis = roleAxisOf(cat, kind);
  for (const role of [null, ...(axis ? ROLE_DOMAINS[axis] : [])]) {
    const q = kindQuestionSet(cat, kind, role);
    r1Sets++; r1Pending += q.pending.length;
    r1Live.push(...ledgerR1(`${cat}.${kind}${role ? `[${role}]` : ""}`, { required: q.required.map((key) => ({ key })), pending_until_gate_answered: q.pending, column_backed: q.column_backed }));
  }
}
check(`R1 per role on the live profiles: no pending cup waits on a gate its kind/role does not ask (${r1Pending} pending cups over ${r1Sets} question sets)`,
  r1Live.length === 0, r1Live.join("\n     "));
check("the per-role scan looked at role question sets, not only kind cores", r1Sets > Object.values(LEDGER_KINDS).reduce((a, k) => a + k.length, 0),
  `${r1Sets} sets for ${Object.values(LEDGER_KINDS).reduce((a, k) => a + k.length, 0)} kinds`);

const LEDGER_DIR = path.resolve("data/ledger");
const ledgerFiles = fs.existsSync(LEDGER_DIR) ? fs.readdirSync(LEDGER_DIR).filter((f) => f.endsWith(".json")).sort() : [];
check("the committed ledgers were read", ledgerFiles.length > 0, `no data/ledger/*.json under ${LEDGER_DIR}`);
let ledgerBlocks = 0, ledgerRoleBlocks = 0, ledgerPending = 0;
const r1Ledger: string[] = [];
for (const f of ledgerFiles) {
  const led = JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, f), "utf8")) as { kinds: Record<string, AskedSet & { roles?: Record<string, AskedSet> }> };
  for (const [kind, lk] of Object.entries(led.kinds)) {
    ledgerBlocks++; ledgerPending += lk.pending_until_gate_answered.length;
    r1Ledger.push(...ledgerR1(`${f}:${kind}`, lk));
    for (const [role, rb] of Object.entries(lk.roles ?? {})) {
      ledgerBlocks++; ledgerRoleBlocks++; ledgerPending += rb.pending_until_gate_answered.length;
      r1Ledger.push(...ledgerR1(`${f}:${kind}[${role}]`, rb));
    }
  }
}
check(`gateR1 over the committed ledgers: 0 pending cups gated outside required ∪ pending ∪ column_backed of the same kind/role (${ledgerPending} pending cups in ${ledgerBlocks} blocks, ${ledgerRoleBlocks} of them role blocks)`,
  r1Ledger.length === 0, r1Ledger.join("\n     "));

// SABOTAGE, on asked sets nobody committed, through the same ledgerR1.
{
  const kindBlock: AskedSet = { required: [{ key: "form_factor" }, { key: "weight" }], pending_until_gate_answered: [{ key: "rack_units", gate: ["form_factor"] }], column_backed: ["series"] };
  check("CONTROL a pending cup gated on a required cup of the same kind passes", ledgerR1("k", kindBlock).length === 0);
  check("CONTROL a pending cup gated on a column-backed key passes",
    ledgerR1("k", { required: [], pending_until_gate_answered: [{ key: "x", gate: ["series"] }], column_backed: ["series"] }).length === 0);
  check("CONTROL a pending cup gated on another PENDING cup passes",
    ledgerR1("k", { required: [], pending_until_gate_answered: [{ key: "poe_ports", gate: ["poe_standard"] }, { key: "poe_standard", gate: [] }] }).length === 0);
  const demoted: AskedSet = { ...kindBlock, required: [{ key: "weight" }] };
  check("SABOTAGE a ROLE block whose role demoted the gate (form_factor) while rack_units still waits on it is refused, naming the role and the gate",
    ledgerR1("switch[smb]", demoted).some((m) => m.includes("switch[smb].rack_units") && m.includes("form_factor")), ledgerR1("switch[smb]", demoted).join("; "));
  check("SABOTAGE a KIND block gated on a cup it does not ask is refused, naming the gate",
    ledgerR1("switch", { required: [], pending_until_gate_answered: [{ key: "ip_rating", gate: ["uplink_modular"] }] }).some((m) => m.includes("uplink_modular")));
  check("SABOTAGE a gate that is column-backed in the CORE but absent from the role block is refused (column_backed is per block)",
    ledgerR1("switch[smb]", { required: [], pending_until_gate_answered: [{ key: "x", gate: ["series"] }], column_backed: [] }).length === 1);
}

console.log(`    gate R1: ${pass} passed, ${misses.length} missed (${conds} conds, ${gated} gated; exempt: ${exemptElseOpt} elseOpt, ${exemptKind} kind, ${exemptColumn} column-backed)`);
console.log(`    R1 per role: ${r1Live.length} of ${r1Pending} pending cups over ${r1Sets} live question sets · gateR1 (ledgers): ${r1Ledger.length} of ${ledgerPending} pending cups over ${ledgerBlocks} blocks (${ledgerRoleBlocks} role blocks) in ${ledgerFiles.length} ledgers`);
if (misses.length) {
  for (const m of misses) console.log(`  MISS ${m}`);
  process.exit(1);
}
