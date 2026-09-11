// tests/cupLedger.test.ts â€” a committed cup ledger must still describe the profile it was built from.
//
// data/ledger/<vendor>-<category>.json is the frozen denominator of the filling phase (reviewer Â§5, 11 Sep 2026).
// A frozen copy of a changing thing drifts silently in BOTH directions: edit a profile and the ledger goes on
// counting slots the profile no longer asks, or misses ones it now does, and every coverage number computed
// against it is quietly wrong. So each committed ledger is re-derived here from the live profile â€” its hash,
// and every kind's required / pending / not-applicable / optional lists â€” and any difference fails, naming the
// field and the command that regenerates it. Counts (parts, slots) come from the store and are NOT checked here.
import fs from "node:fs";
import path from "node:path";
import { kindQuestionSet, profileHash, LEDGER_KINDS, slotsAtNothingKnown as slotsOf, type KindQuestionSet } from "../src/core/cupLedger.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) passed++;
  else { failed++; lines.push(`    MISS ${name}${detail ? " â€” " + detail : ""}`); }
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
    `ledger ${led.profile_hash}, profile ${profileHash(led.category)} â€” the profile changed; run ${regen}`);
  for (const kind of LEDGER_KINDS[led.category] ?? []) {
    const d = drift(kind, led.kinds[kind], kindQuestionSet(led.category, kind));
    check(`${f}: ${kind} matches the profile`, d.length === 0, `${d.join("; ")} â€” run ${regen}`);
  }
}

// SABOTAGE: a ledger that lost one required field, and one that counts a field the profile never asked, must both
// be caught FOR THAT REASON â€” or the comparison above is a check that has never failed.
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

// wireless (12 Sep 2026): the controller's defining cup, and the antenna's, must be counted â€” and a ledger that
// still asks an ANTENNA for a Wi-Fi generation (the pre-kind profile) must be caught.
{
  const q = kindQuestionSet("wireless", "wlc");
  check("wireless control: a controller is asked AP and client capacity", q.required.includes("wlc_ap_capacity") && q.required.includes("wlc_client_capacity"), q.required.join(","));
  const good: LedgerKind = { required: q.required.map((key) => ({ key })), pending_until_gate_answered: q.pending,
    not_applicable_by_kind: q.not_applicable_by_kind, optional: q.optional };
  const lost = { ...good, required: good.required.filter((r) => r.key !== "wlc_ap_capacity") };
  check("SABOTAGE a wireless ledger missing wlc_ap_capacity is caught", drift("wlc", lost, q).some((m) => m.includes("wlc_ap_capacity") && m.includes("does not count")));
  const qa = kindQuestionSet("wireless", "antenna");
  const ant: LedgerKind = { required: [...qa.required.map((key) => ({ key })), { key: "wifi_generation" }], pending_until_gate_answered: qa.pending,
    not_applicable_by_kind: qa.not_applicable_by_kind, optional: qa.optional };
  check("SABOTAGE a wireless ledger asking an antenna for wifi_generation is caught", drift("antenna", ant, qa).some((m) => m.includes("wifi_generation") && m.includes("no longer asks")));
}
// video (12 Sep 2026): the same two sabotages on the video axis â€” a transmitter ledger that lost `wavelength`,
// and one still counting the conferencing `video_codecs` this category was asked until today.
{
  const q = kindQuestionSet("video", "transmitter");
  check("video: a transmitter is asked wavelength and tx_power", q.required.includes("wavelength") && q.required.includes("tx_power"), q.required.join(", "));
  check("video: an `unknown` part is asked nothing", slotsOf(kindQuestionSet("video", "unknown")) === 0);
  const good: LedgerKind = { required: q.required.map((key) => ({ key })), pending_until_gate_answered: q.pending,
    not_applicable_by_kind: q.not_applicable_by_kind, optional: q.optional };
  const lost = { ...good, required: good.required.filter((r) => r.key !== "wavelength") };
  check("SABOTAGE video: a ledger missing wavelength is caught", drift("transmitter", lost, q).some((m) => m.includes("wavelength") && m.includes("does not count")));
  const extra = { ...good, required: [...good.required, { key: "video_codecs" }] };
  check("SABOTAGE video: a ledger still counting video_codecs is caught", drift("transmitter", extra, q).some((m) => m.includes("video_codecs") && m.includes("no longer asks")));
}
// end video (12 Sep 2026)
// routers (12 Sep 2026): the routers ledger exists, and the two questions its kinds were built on are caught when
// dropped â€” a line card's per-slot bandwidth and a power supply's rated output.
check("routers: a committed ledger exists (data/ledger/cisco-routers.json)", files.includes("cisco-routers.json"));
{
  for (const [kind, key] of [["linecard", "fabric_bandwidth"], ["power", "psu_rated_output"]] as const) {
    const q = kindQuestionSet("routers", kind);
    const good: LedgerKind = { required: q.required.map((k) => ({ key: k })), pending_until_gate_answered: q.pending,
      not_applicable_by_kind: q.not_applicable_by_kind, optional: q.optional };
    check(`routers control: ${kind} asks ${key}`, q.required.includes(key));
    const lost = { ...good, required: good.required.filter((r) => r.key !== key) };
    check(`SABOTAGE a routers ledger whose ${kind} lost ${key} is caught`, drift(kind, lost, q).some((m) => m.includes(key) && m.includes("does not count")));
  }
  // A DIMM must not be asked a router's throughput: the question closes BY KIND, not by an unanswered fact.
  check("routers: memory has router_throughput not-applicable by kind", kindQuestionSet("routers", "memory").not_applicable_by_kind.includes("router_throughput"));
}

lines.unshift(`    cup ledger: ${passed} passed, ${failed} missed (${files.length} ledgers, 4 sabotage cases)`);
// optical-storage (12 Sep 2026): the two new axes. The fallback kind must ask LESS than any named kind (nothing at
// all), a shelf must be asked its slots and an amplifier its gain, and a ledger that dropped the gain is caught.
{
  for (const cat of ["optical-networking", "storage-networking"]) {
    check(`${cat}: has a committed ledger`, files.includes(`cisco-${cat}.json`), "run build-cup-ledger for it");
    const other = kindQuestionSet(cat, "other");
    check(`${cat}: the fallback kind "other" asks nothing`, other.required.length + other.pending.length === 0,
      `asks ${[...other.required, ...other.pending.map((p) => p.key)].join(", ")}`);
    const sw = kindQuestionSet(cat, "software");
    check(`${cat}: "software" asks nothing (the class rules take those parts)`, sw.required.length + sw.pending.length === 0);
  }
  check("optical-networking: a chassis is asked its slots", kindQuestionSet("optical-networking", "chassis").required.includes("module_slots"));
  check("storage-networking: a director is asked its slots and NOT ports", kindQuestionSet("storage-networking", "director").required.includes("module_slots")
    && !kindQuestionSet("storage-networking", "director").required.includes("ports"));
  const amp = kindQuestionSet("optical-networking", "amplifier");
  check("optical-networking: an amplifier is asked its gain", amp.required.includes("gain"));
  const good: LedgerKind = { required: amp.required.map((key) => ({ key })), pending_until_gate_answered: amp.pending,
    not_applicable_by_kind: amp.not_applicable_by_kind, optional: amp.optional };
  const lost = { ...good, required: good.required.filter((r) => r.key !== "gain") };
  check("SABOTAGE an optical ledger missing the amplifier's gain is caught as uncounted",
    drift("amplifier", lost, amp).some((m) => m.includes("gain") && m.includes("does not count")));
}
// end optical-storage

lines.unshift(`    cup ledger: ${passed} passed, ${failed} missed (${files.length} ledgers, 3 sabotage cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
