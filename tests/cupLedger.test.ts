// tests/cupLedger.test.ts — a committed cup ledger must still describe the profile it was built from.
//
// data/ledger/<vendor>-<category>.json is the frozen denominator of the filling phase (reviewer §5, 11 Sep 2026).
// A frozen copy of a changing thing drifts silently in BOTH directions: edit a profile and the ledger goes on
// counting slots the profile no longer asks, or misses ones it now does, and every coverage number computed
// against it is quietly wrong. So each committed ledger is re-derived here from the live profile — its hash,
// and every kind's required / pending / not-applicable / optional lists — and any difference fails, naming the
// field and the command that regenerates it. Counts (parts, slots) come from the store and are NOT checked here.
import fs from "node:fs";
import path from "node:path";
import { kindQuestionSet, profileHash, LEDGER_KINDS, type KindQuestionSet } from "../src/core/cupLedger.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) passed++;
  else { failed++; lines.push(`    MISS ${name}${detail ? " — " + detail : ""}`); }
};

type LedgerKind = { required: { key: string }[]; pending_until_gate_answered: { key: string; gate: string[] }[];
  not_applicable_by_kind: string[]; optional: string[] };
type Ledger = { category: string; profile_hash: string; kinds: Record<string, LedgerKind> };

/** Every way a ledger kind can disagree with the live question set. Pure, so the sabotage case can drive it. */
function drift(kind: string, l: LedgerKind | undefined, q: KindQuestionSet): string[] {
  if (!l) return [`kind "${kind}" is missing from the ledger`];
  const out: string[] = [];
  const cmp = (what: string, a: string[], b: string[]) => {
    const extra = a.filter((x) => !b.includes(x)), missing = b.filter((x) => !a.includes(x));
    if (extra.length) out.push(`${kind}.${what}: ledger has ${extra.join(", ")} which the profile no longer asks`);
    if (missing.length) out.push(`${kind}.${what}: profile asks ${missing.join(", ")} which the ledger does not count`);
  };
  cmp("required", l.required.map((r) => r.key), q.required);
  cmp("pending", l.pending_until_gate_answered.map((r) => r.key), q.pending.map((p) => p.key));
  cmp("not_applicable_by_kind", l.not_applicable_by_kind, q.not_applicable_by_kind);
  cmp("optional", l.optional, q.optional);
  return out;
}

const dir = path.resolve("data/ledger");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
check("at least one committed ledger exists", files.length > 0, "data/ledger is empty");
for (const f of files) {
  const led = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Ledger;
  const regen = `npx tsx scripts/build-cup-ledger.mts --category ${led.category}`;
  check(`${f}: its category has a kind axis`, !!LEDGER_KINDS[led.category], `no LEDGER_KINDS entry for ${led.category}`);
  check(`${f}: built from the live profile (hash)`, led.profile_hash === profileHash(led.category),
    `ledger ${led.profile_hash}, profile ${profileHash(led.category)} — the profile changed; run ${regen}`);
  for (const kind of LEDGER_KINDS[led.category] ?? []) {
    const d = drift(kind, led.kinds[kind], kindQuestionSet(led.category, kind));
    check(`${f}: ${kind} matches the profile`, d.length === 0, `${d.join("; ")} — run ${regen}`);
  }
}

// SABOTAGE: a ledger that lost one required field, and one that counts a field the profile never asked, must both
// be caught FOR THAT REASON — or the comparison above is a check that has never failed.
{
  const q = kindQuestionSet("transceiver", "bidi");
  const good: LedgerKind = { required: q.required.map((key) => ({ key })), pending_until_gate_answered: q.pending,
    not_applicable_by_kind: q.not_applicable_by_kind, optional: q.optional };
  check("control: a faithful ledger kind shows no drift", drift("bidi", good, q).length === 0, drift("bidi", good, q).join("; "));
  const lost = { ...good, required: good.required.filter((r) => r.key !== "rx_wavelength") };
  check("SABOTAGE a ledger missing rx_wavelength is caught as uncounted", drift("bidi", lost, q).some((m) => m.includes("rx_wavelength") && m.includes("does not count")));
  const extra = { ...good, required: [...good.required, { key: "mode" }] };
  check("SABOTAGE a ledger still counting the demoted mode is caught", drift("bidi", extra, q).some((m) => m.includes("mode") && m.includes("no longer asks")));
}

lines.unshift(`    cup ledger: ${passed} passed, ${failed} missed (${files.length} ledgers, 2 sabotage cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
