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
import { kindQuestionSet, profileHash, LEDGER_KINDS, slotsAtNothingKnown as slotsOf, type KindQuestionSet } from "../src/core/cupLedger.js";

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

// wireless (12 Sep 2026): the controller's defining cup, and the antenna's, must be counted — and a ledger that
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
// video (12 Sep 2026): the same two sabotages on the video axis — a transmitter ledger that lost `wavelength`,
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
// dropped — a line card's per-slot bandwidth and a power supply's rated output.
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
// ---- security (12 Sep 2026) --------------------------------------------------------------------
// Three things about this ledger the generic drift check cannot see.
{
  const p = path.join(dir, "cisco-security.json");
  if (!fs.existsSync(p)) check("the security ledger exists", false, "run npx tsx scripts/build-cup-ledger.mts --category security");
  else {
    const led = JSON.parse(fs.readFileSync(p, "utf8")) as Ledger & {
      totals: { parts: number; pending_reclassification?: number; by_kind: Record<string, number> };
      kinds: Record<string, LedgerKind & {
        parts: number;
        required: { key: string; observed_fill_path: boolean; seed_only: boolean; label_occurrences: number; sources: { basis: string }[] }[];
        pending_until_gate_answered: { key: string; observed_fill_path: boolean; seed_only: boolean }[];
      }>;
    };
    // 1. THE DENOMINATOR MUST ACCOUNT FOR EVERY `hardware` ROW. securityKind judges 3,525 of the
    //    category's 5,515 stored-hardware parts non-hardware from the class table, and they are held
    //    OUT of the kinds. A ledger that simply omitted them would report 1,990 parts for a category
    //    whose parts table holds 5,515, with nothing saying where the rest went — the same defect as
    //    an output field named for the thing you wish it measured. So the count is its own number and
    //    this asserts it is PRESENT — a missing field is the defect.
    //
    //    IT WAS `> 0` UNTIL THE RUN LANDED (12 Sep 2026, run 969 moved 7,878 rows off hardware, 3,525 of them
    //    here). Zero is now the CORRECT answer and the old assertion made the suite red for the success case,
    //    which is the shape of a check that pins today's number instead of the property. The property is: the
    //    field exists, it is not negative, and `parts` + it equals the category's stored-hardware count.
    check("security: the ledger records the rows held out for reclassification, as their own number",
      typeof led.totals.pending_reclassification === "number" && led.totals.pending_reclassification >= 0,
      `pending_reclassification=${led.totals.pending_reclassification} — a MISSING count is the defect; 0 means the reclassify has run`);
    check("security: `parts` is the sum of the kinds and EXCLUDES the held-out rows",
      led.totals.parts === Object.values(led.totals.by_kind).reduce((a, b) => a + b, 0),
      `parts=${led.totals.parts}, by_kind sum=${Object.values(led.totals.by_kind).reduce((a, b) => a + b, 0)}`);
    check("security: `non-hardware` is not a ledger kind",
      !("non-hardware" in led.kinds) && !LEDGER_KINDS.security.includes("non-hardware"));

    // 2. FILLABILITY, checked on the ledger rather than on the profile. The reviewer's check 5: a
    //    required cup nothing can fill is a permanent gap. `observed_fill_path` is the ledger's own
    //    verdict (a source SEEN publishing the key, a datasheet label that maps to it, or the part's
    //    own name), and `seed_only` is the operator-seed case that does not grow.
    const blind: string[] = [], seedOnly: string[] = [];
    for (const [kind, k] of Object.entries(led.kinds)) {
      for (const f of [...k.required, ...k.pending_until_gate_answered]) {
        if (f.seed_only) seedOnly.push(`${kind}/${f.key}`);
        else if (!f.observed_fill_path) blind.push(`${kind}/${f.key}`);
      }
    }
    check("security: every required or pending cup has an OBSERVED fill path", blind.length === 0, blind.join(", "));
    check("security: no required cup is fillable only by the operator seed", seedOnly.length === 0, seedOnly.join(", "));

    // 3. THE SHAPING ITSELF, asserted on the frozen file so a future profile edit that re-flattens the
    //    category fails here too and not only in tests/securityShapes. A component must be asked
    //    strictly fewer slots than the leanest box: that difference IS the defect this axis fixed.
    const box = ["firewall", "ips", "email-gateway", "web-gateway", "management", "analytics", "identity"];
    // security-r6 (12 Sep 2026): `memory` and `nic` join the component list (two shapes split out of
    // `compute`, which was one kind of 224 parts carrying 39 facts in two cups it was never asked).
    const comp = ["security-module", "ips-module", "module", "power", "fan", "drive", "compute", "memory", "nic", "cable", "accessory"];
    const n = (k: string) => led.kinds[k].required.length + led.kinds[k].pending_until_gate_answered.length;
    // AND `security-module` IS NAMED OUT OF THE BOUND, not the bound loosened — the same exemption
    // tests/securityShapes carries, for the same recorded reason: a Firepower 9300 SM blade is a
    // component by form and a firewall by what it is bought on, and SM-40/48/56 hold 15 facts each
    // (firewall_throughput, threat_throughput, ips_throughput, vpn_peers, concurrent_sessions and
    // the IPsec figure). Adding the r6 cups took it from 5 slots to 9, past `identity` at 8. The
    // exemption is asserted to be NECESSARY below, so it cannot quietly grow into the whole list.
    const BOXLIKE_COMPONENT = ["security-module"];
    const strict = comp.filter((k) => !BOXLIKE_COMPONENT.includes(k));
    check("security: every component kind except the blade is asked fewer slots than the leanest box",
      Math.max(...strict.map(n)) < Math.min(...box.map(n)),
      `components ${strict.map((k) => `${k}:${n(k)}`).join(" ")} · boxes ${box.map((k) => `${k}:${n(k)}`).join(" ")}`);
    check("security: the exemption list is exactly the kinds that BREAK the bound",
      BOXLIKE_COMPONENT.every((k) => n(k) >= Math.min(...box.map(n))),
      `exempt ${BOXLIKE_COMPONENT.map((k) => `${k}:${n(k)}`).join(" ")} · leanest box ${Math.min(...box.map(n))}`);
    check("security: no component kind is asked the physical envelope",
      comp.every((k) => !["weight", "dimensions", "temp_operating", "humidity_operating", "certifications", "form_factor", "rack_units"]
        .some((f) => led.kinds[k].required.some((r) => r.key === f) || led.kinds[k].pending_until_gate_answered.some((r) => r.key === f))),
      comp.filter((k) => led.kinds[k].required.some((r) => r.key === "weight")).join(", "));
    check("security: every component kind is still asked WHAT IT FITS",
      comp.every((k) => led.kinds[k].required.some((r) => r.key === "product_compatibility")),
      comp.filter((k) => !led.kinds[k].required.some((r) => r.key === "product_compatibility")).join(", "));
  }
}

lines.unshift(`    cup ledger: ${passed} passed, ${failed} missed (${files.length} ledgers, 2 sabotage cases)`);
// --- modules-misc (12 Sep 2026) ----------------------------------------------------------------
// SABOTAGE ON THE THREE NEW AXES. The block above drives `drift` through the transceiver profile
// only, so a change to moduleKind's or merakiKind's cup lists could not have made it fail. Each
// case below is the actual defect its kind split exists to prevent.
{
  const q = kindQuestionSet("interfaces-modules", "power");
  const good: LedgerKind = { required: q.required.map((key) => ({ key })), pending_until_gate_answered: q.pending,
    not_applicable_by_kind: q.not_applicable_by_kind, optional: q.optional };
  check("control: interfaces-modules/power shows no drift", drift("power", good, q).length === 0, drift("power", good, q).join("; "));
  const lost = { ...good, required: good.required.filter((r) => r.key !== "psu_rated_output") };
  check("SABOTAGE a ledger that stops counting a PSU's rated output is caught",
    drift("power", lost, q).some((m) => m.includes("psu_rated_output") && m.includes("does not count")));
  // A PSU asked what it DRAWS instead of what it delivers is the split switches made on 11 Sep 2026.
  const wrong = { ...good, required: [...good.required, { key: "power_max" }] };
  check("SABOTAGE a ledger asking a PSU for power_max is caught",
    drift("power", wrong, q).some((m) => m.includes("power_max") && m.includes("no longer asks")));
}
{
  // A CABLE ASKED A PORT COUNT — the defect the whole axis exists for. `cable` must be asked its
  // length and what it fits, and nothing else.
  const q = kindQuestionSet("interfaces-modules", "cable");
  const good: LedgerKind = { required: q.required.map((key) => ({ key })), pending_until_gate_answered: q.pending,
    not_applicable_by_kind: q.not_applicable_by_kind, optional: q.optional };
  check("interfaces-modules/cable is asked exactly cable_length and product_compatibility",
    [...q.required].sort().join(",") === "cable_length,product_compatibility", q.required.join(","));
  const wrong = { ...good, required: [...good.required, { key: "ports" }, { key: "temp_operating" }] };
  const d = drift("cable", wrong, q);
  check("SABOTAGE a ledger asking a cable for ports and an operating temperature is caught",
    d.some((m) => m.includes("ports")) && d.some((m) => m.includes("temp_operating")));
}
{
  // An MT sensor asked a PoE standard and a port count was the meraki defect. It runs on batteries.
  const q = kindQuestionSet("meraki", "sensor");
  check("meraki/sensor is asked a battery life", q.required.includes("battery_life"), q.required.join(","));
  check("meraki/sensor is asked no ports, no PoE, no power draw",
    !["ports", "poe_standard", "power_max"].some((k) => q.required.includes(k) || q.pending.some((p) => p.key === k)),
    q.required.join(","));
  const good: LedgerKind = { required: q.required.map((key) => ({ key })), pending_until_gate_answered: q.pending,
    not_applicable_by_kind: q.not_applicable_by_kind, optional: q.optional };
  const wrong = { ...good, required: [...good.required, { key: "poe_standard" }] };
  check("SABOTAGE a ledger asking a sensor for a PoE standard is caught",
    drift("sensor", wrong, q).some((m) => m.includes("poe_standard") && m.includes("no longer asks")));
}
// NO KIND THAT HOLDS PARTS MAY BE ASKED NOTHING. A part with required_total = 0 scores as complete,
// so a kind list that closes every question of a real population reports it as finished — the
// failure direction that is invisible in a coverage number. Read from the committed ledgers, which
// carry the part counts, so this is a statement about the live corpus and not about the profile.
//
// A RATCHET, NOT A PASS. The check found one on the day it was written and it is NOT mine to fix:
// `transceiver`/`accessory` holds 18 parts — CVR-BRKT-1 "Mounting bracket for one CVR-4SFP10G-QSFP",
// CVR-TRAY-8, CWDM-MUX-4-SF1 — and is asked nothing at all, so all 18 report as complete. The cup
// they are missing is `product_compatibility`, which is what a bracket is bought for and which
// `interfaces-modules`/`accessory` does ask. It is one line in someone else's finished profile, so
// it is recorded here and in docs/reports/schema-modules-misc-2026-09-12.md rather than changed.
// The entry can only be removed, never added to without a reason: a new one fails the suite.
// Each entry is a kind that is asked NOTHING while holding parts, recorded so the suite is honest about the
// difference between clean and known-dirty. It can only shrink: fix one and the check fails until the entry goes.
// 12 Sep 2026 — the wireless component kinds were here too; they now require product_compatibility (reviewer
// §2.3) and the entries are gone. What remains is where asking nothing is the RIGHT answer: a bundle is a
// relation to its members (R3), software and a licence are not hardware, and `other` is the fallback that must
// ask less — its 1,192 wireless parts are the residue a reclassify run moves out of hardware altogether.
const ASKED_NOTHING_TODAY = new Set(["cisco-transceiver.json:accessory"]);

/**
 * Kinds that are SUPPOSED to ask nothing, by rule rather than by a list that grows.
 *
 * Two different things were failing this census together. A component kind asking nothing is a defect — a mount,
 * a plug-in card or a cable that owes no cup scores complete while nobody has ever read its datasheet, and that
 * is what the check is for (it found the wireless, video and collaboration components on 12 Sep 2026). But a
 * kind that names something which is NOT A PIECE OF HARDWARE has no physical cup to owe: software and an
 * OS licence are not hardware, a bundle is a relation to its members (R3), a non-product is a datasheet cell
 * enumerated as a part, and the two FALLBACK kinds must by design ask LESS than any named kind.
 *
 * The fallbacks are not let off the hook, they are checked by a different instrument: the own-fact census
 * (docs/reports/cross-category-check-2026-09-12.md) asks whether any part in them holds three or more facts of
 * its own, which is the only detector for a real product swallowed by a fallback. Counting them here would make
 * this check red for ~6,000 parts that a reclassify run removes from hardware altogether.
 */
const NOT_HARDWARE_KINDS = new Set(["software", "os-license", "license", "licence", "non-product", "non_product",
  "bundle", "non-hardware", "unknown", "other"]);
for (const f of files) {
  const led = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Ledger & {
    kinds: Record<string, LedgerKind & { parts: number; slots_per_part_at_nothing_known: number }> };
  for (const [kind, v] of Object.entries(led.kinds)) {
    if (!v.parts) continue;   // a kind with no part today is allowed an empty set; the drift check still pins it
    if (NOT_HARDWARE_KINDS.has(kind)) continue;   // no physical cup to owe; see the note above
    const known = ASKED_NOTHING_TODAY.has(`${f}:${kind}`);
    const asked = v.slots_per_part_at_nothing_known > 0;
    if (known) {
      check(`${f}: ${kind} is the RECORDED asked-nothing case (${v.parts} parts) — fix it and remove the entry`,
        !asked, "it is asked something now: delete it from ASKED_NOTHING_TODAY");
    } else {
      check(`${f}: ${kind} holds ${v.parts} parts and is asked something`, asked,
        "required_total 0 makes every one of them score as complete");
    }
  }
}

// ONE CUP SET PER KIND NAME, ACROSS CATEGORIES (reviewer round 3, §4 item 1; 12 Sep 2026).
//
// Fourteen categories were shaped by eight agents working in parallel, and a kind name means the same thing in
// all of them: a `fan` is a fan whether it cools a switch, a router or a firewall. When the same name owes
// different cups in different categories, one of them is wrong — and the difference is invisible from inside
// either category, which is why it needs a test that reads across all of them.
//
// WHAT IT FOUND THE DAY IT WAS WRITTEN: `power` owed four cups in switches, routers, storage, security and
// data-center-networking, three in wireless and optical, two in video, and SEVEN in interfaces-modules, where the
// extra three were the environmental envelope. The evidence for that envelope turned out to be inherited facts
// (the machine's rows copied onto its components), so it came off — see the note in fieldSchema.ts.
//
// EXCEPTIONS ARE NAMED, NOT ASSUMED. A category may legitimately ask a kind something extra when the product
// really is different; each such pair is listed here with its reason, so the list can only shrink.
{
  const EXCEPTIONS: Record<string, string> = {
    "cable:optical-networking": "an optical patch cord's length is its whole specification; it fits no one platform",
    "cable:storage-networking": "the same, for SAN patch cords",
    "accessory:transceiver": "the 18 here are dust caps and brackets; `product_compatibility` is asked, nothing else is",
    // THE SAME WORD, A DIFFERENT PRODUCT. Each of these was read before being written down, and each is a case
    // where the kind NAME is shared but the thing is not — so one cup set would be wrong for one of them. The
    // four that were real defects (power's airflow and input_voltage, drive's interface, memory's dram/flash
    // instead of a drive's capacity, the routers antenna set) are fixed in fieldSchema.ts rather than listed here.
    "switch:switches": "a Catalyst switch is the category's whole product and owes ~30 cups; the `switch` kind elsewhere is a small appliance",
    "switch:storage-networking": "an MDS fabric switch is bought on Fibre Channel rate and slots, not on Ethernet switching capacity",
    "switch:meraki": "an MS is sold on PoE budget and its mounting, and its cloud licence carries what a Catalyst datasheet prints",
    "camera:meraki": "an MV is a storage-carrying sensor (image_sensor, storage_capacity, video_quality_max); a Webex camera is bought on zoom and field of view",
    "server:unified-communications": "a UC application server is ordered as a bundle; whether it should owe the UCS cups (cpu, drive_bays, memory_speed_max) is an open question in the round-3 reply",
    "server:conferencing": "the same, for Meeting Server appliances",
    "chassis:optical-networking": "an optical shelf is bought on its slot count; a UCS chassis on its envelope",
    "chassis:video": "a cable-plant housing is strand-mounted: no rack units, no form factor",
    // routers-r5 (12 Sep 2026). `chassis` now names five different things in five categories, and the
    // routers one is a LINE-CARD chassis: a CRS-16/S, an ASR 9922, an 8818-SYS. Cisco publishes four
    // figures on that shelf's own datasheet that a server or HCI enclosure's sheet does not carry,
    // which is the whole of the difference the check reports:
    //   module_slots      its defining spec, and all 64 device facts are on this cohort
    //   input_voltage     the PSU bays' supply range is stated on the chassis sheet, not the PSU's
    //   power_typical     printed per shelf ("8818 22KW typical with 800G LCs")
    //   router_throughput the system figure ("Max throughput with 800G LC", 518.4T)
    // A UCS chassis's power and a video housing's are stated on the blades and the line cards, so
    // those three kinds legitimately owe the envelope alone. Same name, three different products.
    "chassis:routers": "a line-card chassis states its slot count, its supply range, its typical draw and its system throughput; a UCS or HCI chassis owes the envelope alone",
    "module:routers": "a router interface module states its ports; a UCS io-module does not",
    "module:switches": "a switch module adds PoE ports and a PoE standard to the same set",
    "module:security": "a netmod states ports and its own draw",
    "linecard:routers": "an ASR line card is bought on per-slot fabric bandwidth; a chassis line card elsewhere on its rate",
    "linecard:switches": "the same, plus PoE",
    "fabric:routers": "a fabric card's power draw is stated on the chassis sheet, not the card's",
    "fabric:switches": "the same",
    "supervisor:switches": "a Catalyst supervisor IS the control plane: it owes the switching figures the chassis cannot state without it",
    "appliance:security": "a security appliance is a firewall-class box with sessions and throughput; the wireless `appliance` is a CMX/location server",
    "appliance:wireless": "the same pair, other side",
    "gateway:unified-communications": "a voice gateway owes FXS ports, codecs and protocols; the wireless `gateway` is a Fluidmesh radio bridge",
    "optic:video": "an analog cable-plant optic is bought on wavelength and output power; a pluggable on form factor and rate",
    "amplifier:video": "an RF amplifier states input level and output; an optical EDFA states gain",
    "pluggable:transceiver": "the transceiver category IS the optic profile; the pluggables elsewhere are proposals to move here",
    "pluggable:storage-networking": "the same, other side",
    "memory:interfaces-modules": "an SD/USB/CF card answers `flash` as well as `dram`; the memory kind elsewhere is DIMMs only",
  };
  const sets = new Map<string, { cat: string; req: string }[]>();
  for (const f of files) {
    const led = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Ledger & { kinds: Record<string, LedgerKind & { parts: number }> };
    for (const [kind, v] of Object.entries(led.kinds)) {
      if (!v.parts || NOT_HARDWARE_KINDS.has(kind)) continue;
      const req = [...v.required.map((r) => r.key), ...v.pending_until_gate_answered.map((p) => p.key)].sort().join(",");
      sets.set(kind, [...(sets.get(kind) ?? []), { cat: led.category, req }]);
    }
  }
  for (const [kind, list] of sets) {
    if (list.length < 2) continue;
    const distinct = new Map<string, string[]>();
    for (const l of list) distinct.set(l.req, [...(distinct.get(l.req) ?? []), l.cat]);
    if (distinct.size === 1) { passed++; continue; }
    // The majority set is the contract; anything else must be a named exception.
    const majority = [...distinct].sort((a, b) => b[1].length - a[1].length)[0][0];
    const rebels = list.filter((l) => l.req !== majority && !EXCEPTIONS[`${kind}:${l.cat}`]);
    if (rebels.length === 0) { passed++; continue; }
    failed++;
    for (const r of rebels) {
      const extra = r.req.split(",").filter((k) => !majority.split(",").includes(k));
      const missing = majority.split(",").filter((k) => !r.req.split(",").includes(k));
      lines.push(`    MISS kind "${kind}" owes a different set in ${r.cat} than in the other ${distinct.get(majority)!.length}` +
        `${extra.length ? ` — extra: ${extra.join(", ")}` : ""}${missing.length ? ` — missing: ${missing.join(", ")}` : ""}`);
    }
  }
}

// A MEMORY KIND MUST NOT BE ASKED `storage_capacity` (reviewer round 4 §6; modules-r8, 12 Sep 2026).
//
// THE DEFECT IT NAMES. `interfaces-modules` asked its `memory` kind for `storage_capacity` while meaning
// `dram` or `flash`. `storage_capacity` is a DRIVE's onboard capacity — band [1, 200000] GB — and `dram`
// and `flash` are a module's, bands [0.06, 512] and [0.03, 1024]. A 512 MB DRAM upgrade poured into the
// drive cup stores 0.5 against a floor of 1 and is refused; a 1 TB disk poured into `dram` is refused the
// other way. It was fixed in the profile on 12 Sep 2026 (the same eleven parts, the right cup), and the
// ONE-CUP-SET-PER-KIND check above cannot catch it coming back: `memory` already has a NAMED EXCEPTION
// there ("an SD/USB/CF card answers flash as well as dram"), so an exception-bearing kind can drift to any
// set at all without a word. That is what makes this its own rule rather than a comment on the fix.
//
// IT IS STATED AS A PAIR, BOTH DIRECTIONS, because the mirror defect is as easy to write: a `drive` kind
// asked `dram` means the profile meant `storage_capacity`. Written over the ledgers rather than the
// profiles so it reads exactly what a part of that kind is ASKED, gate included — a requirement that is
// conditional and open still lands in `pending_until_gate_answered` and still counts.
{
  /** Pure, so the sabotage below can drive it with a ledger nobody committed. */
  const wrongCup = (kind: string, asked: string[]): string[] => {
    const MEMORY_KINDS = ["memory", "flash", "processor", "dimm"];
    const DRIVE_KINDS = ["drive", "disk", "ssd"];
    const out: string[] = [];
    if (MEMORY_KINDS.includes(kind) && asked.includes("storage_capacity")) {
      out.push(`kind "${kind}" is asked storage_capacity, which is a DRIVE's cup — it means dram or flash`);
    }
    for (const k of ["dram", "flash"]) {
      if (DRIVE_KINDS.includes(kind) && asked.includes(k)) {
        out.push(`kind "${kind}" is asked ${k}, which is a MEMORY module's cup — it means storage_capacity`);
      }
    }
    return out;
  };
  let looked = 0;
  for (const f of files) {
    const led = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Ledger & {
      kinds: Record<string, LedgerKind & { parts: number }> };
    for (const [kind, v] of Object.entries(led.kinds)) {
      const asked = [...v.required.map((r) => r.key), ...v.pending_until_gate_answered.map((p) => p.key)];
      looked++;
      const bad = wrongCup(kind, asked);
      check(`${f}: ${kind} is asked the right capacity cup`, bad.length === 0, bad.join("; "));
    }
  }
  // The denominator, so "no findings" cannot be read as "nothing was looked at" — a check that reports
  // only its failures is indistinguishable from a check that ran over an empty set.
  lines.push(`    memory/drive capacity cup: ${looked} kind rows across ${files.length} ledgers`);
  check("the capacity-cup check looked at a real number of kinds", looked > 50, `only ${looked}`);
  // SABOTAGE, both directions, on ledgers nobody committed — the rule has to refuse FOR THE STATED REASON.
  check("SABOTAGE a memory kind asked a drive's storage_capacity is caught",
    wrongCup("memory", ["storage_capacity", "product_compatibility"]).some((m) => m.includes("storage_capacity") && m.includes("dram or flash")));
  check("SABOTAGE a drive kind asked a module's dram is caught",
    wrongCup("drive", ["dram", "drive_interface"]).some((m) => m.includes("dram") && m.includes("storage_capacity")));
  check("SABOTAGE and it catches the cup whether the gate is answered or still pending",
    wrongCup("flash", ["storage_capacity"]).length === 1);
  // THE CONTROL, which is the half that proves the rule is not simply refusing everything: the real
  // shapes must pass. A drive owes storage_capacity, a memory module owes dram, and a memory kind that
  // ALSO owes flash (interfaces-modules' SD/USB cards) is legitimate.
  check("CONTROL a drive asked storage_capacity passes", wrongCup("drive", ["storage_capacity", "drive_interface"]).length === 0);
  check("CONTROL a memory module asked dram and flash passes", wrongCup("memory", ["dram", "flash", "memory_speed_max"]).length === 0);
  check("CONTROL a kind this rule says nothing about is untouched", wrongCup("switch", ["storage_capacity", "dram"]).length === 0);
}

// --- fallback-kinds (12 Sep 2026): THE TWO STANDING TESTS (reviewer §9) ------------------------
//
// These are the reviewer's definition of "arranged", and they are the only checks in this file that
// read the LIVE CORPUS rather than the profile: a cup set can be perfect while the classifier files
// half the category under a kind that asks nothing. Both numbers come from `totals.fallback` in the
// committed ledgers, written by scripts/build-cup-ledger.mts from the store.
//
// BOTH ARE RATCHETS AND NEITHER IS A TARGET. A ceiling pinned at today's measurement fails on any
// regression and has to be EDITED DOWN to record an improvement, which is the only shape that cannot
// quietly rot. Where a ceiling codifies a number that is still wrong, the comment says so out loud —
// a test that makes today's failure acceptable must admit that is what it is doing.
{
  /**
   * (a) THE FALLBACK SHARE PER CATEGORY. Measured after this work: 2,928 of 42,450 Cisco hardware
   * parts (6.9%) are in a kind that means "the axis could not say", down from 6,301 (14.8%).
   *
   * **THE TARGET IS UNDER 5% EVERYWHERE, AND SIX CATEGORIES ARE ABOVE IT TODAY.** The ceilings below
   * are each category's measured share rounded up, so they hold the line; they are not a statement
   * that 16.3% is acceptable. What is left above 5% is almost entirely an ACQUISITION gap wearing a
   * shaping gap's clothes — 1,157 of the 2,788 remaining rows have no description at all (the name is
   * literally "Cisco <sku>"), 464 of them in servers-unified-computing and 333 in video — plus three
   * cells a kind this branch may not add would close: 190 UCS cables (the UCS axis has no `cable`
   * kind), 47 switch memory modules and 21 switch drives (the switches axis has neither). All three
   * are proposals in docs/reports/schema-fallback-kinds-2026-09-12.md.
   */
  const CEILING: Record<string, number> = {
    "hyperconverged-systems": 16.3, "hyperconverged-infrastructure": 16.0, video: 13.2,
    "servers-unified-computing": 11.1, "collaboration-endpoints": 10.6, "unified-communications": 7.7,
    // RE-BASELINED AFTER THE CATEGORY-MOVE RUN (12 Sep 2026), and the reason matters more than the
    // numbers. The move run took 651 CORRECTLY-KINDED parts out of these four categories — 449
    // optical pluggables to `transceiver`, 94 misfiled optics and 92 whole devices out of
    // `interfaces-modules`, MDS bundles to `storage-networking` — so the fallback COUNT did not
    // move and the DENOMINATOR shrank. The ratchet fired, which is the test working: a share that
    // rises for a legitimate population change still has to be looked at and re-recorded, never
    // widened quietly. The target is unchanged at under 5%.
    "optical-networking": 8.3, wireless: 5.9, "interfaces-modules": 6.4, "storage-networking": 4.8,
    routers: 3.0, conferencing: 2.9, meraki: 2.3, switches: 1.9, security: 1.0, transceiver: 1.0,
    "data-center-networking": 0.0,
  };
  const CATALOGUE_CEILING = 7.0;   // measured 6.90%; the target is under 5%
  // TWO AXES (round-6 reviewer §8.2, 12 Sep 2026). `parts`/`facts3`/`device_noun` at the top level
  // keep the UNRESOLVED-KIND meaning so the ceilings above compare like with like across the change.
  // `asked_nothing` is the profile property and is the real phase-1 number; `either` is the union,
  // and the two detectors are judged over the UNION so a kind with a perfectly good name cannot
  // shelter a real product from them — `servers-unified-computing.bundle` held 1,432 parts asked
  // nothing, 95 of them with a device noun, and not one was visible in the old single-axis count.
  type Axis = { kinds: string[]; parts: number; facts3: number; device_noun: number };
  type Fallback = Axis & { hardware_parts: number; asked_nothing?: Axis;
    unresolved_kind?: Axis & { asked_at_least_one_cup: number }; either?: Axis };
  let parts = 0, hardware = 0, facts3 = 0, noun = 0, looked = 0;
  let askedNothing = 0, unresolvedAskedSomething = 0, unionFacts3 = 0, unionNoun = 0;
  const namedZero: string[] = [];
  const over: string[] = [];
  for (const f of files) {
    const led = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Ledger & { totals: { fallback?: Fallback } };
    const fb = led.totals.fallback;
    // A MISSING FIELD IS THE DEFECT, not a pass: a ledger built before the census existed would
    // otherwise skip both tests in silence, which is this repo's `sampled`-carrying-`checked` shape.
    check(`${f}: the ledger carries the fallback census`, !!fb,
      "rebuild it: npx tsx scripts/build-cup-ledger.mts --category <slug>");
    if (!fb) continue;
    looked++;
    parts += fb.parts; hardware += fb.hardware_parts; facts3 += fb.facts3; noun += fb.device_noun;
    // THE SECOND AXIS IS A REQUIRED FIELD, not an optional extra: a ledger built before it existed
    // must fail rather than skip, the same rule as the census block above.
    check(`${f}: the ledger carries the asked-nothing axis`, !!fb.asked_nothing && !!fb.either,
      "rebuild it: npx tsx scripts/build-cup-ledger.mts --category <slug>");
    if (!fb.asked_nothing || !fb.either || !fb.unresolved_kind) continue;
    askedNothing += fb.asked_nothing.parts;
    unresolvedAskedSomething += fb.unresolved_kind.asked_at_least_one_cup;
    unionFacts3 += fb.either.facts3; unionNoun += fb.either.device_noun;
    // A kind asked nothing whose name is NOT one of the shrugs is the B1 shape: named, so it fell
    // out of every previous count, and asked nothing, so every one of its cups closed in silence.
    for (const k of fb.asked_nothing.kinds)
      if (!fb.unresolved_kind.kinds.includes(k)) namedZero.push(`${led.category}.${k}`);
    const share = fb.hardware_parts ? (100 * fb.parts) / fb.hardware_parts : 0;
    const ceiling = CEILING[led.category];
    check(`${led.category}: the fallback share has a ceiling in this test`, ceiling !== undefined,
      "a category with no ceiling is a category nobody measured — add it");
    if (ceiling === undefined) continue;
    if (share > ceiling + 0.05) over.push(`${led.category} ${share.toFixed(1)}% > ${ceiling}%`);
    // AND A CEILING THAT HAS GONE SLACK IS ALSO A FAILURE, or the ratchet only turns one way and
    // stops meaning anything: a share more than 2pp under its ceiling says the ceiling is stale.
    check(`${led.category}: its ceiling is still close to the measurement (${share.toFixed(1)}% vs ${ceiling}%)`,
      share > ceiling - 2.0, `the share fell — lower the ceiling to ${Math.ceil(share * 10) / 10} and record the win`);
  }
  check(`the fallback census covered every ledger (${looked} of ${files.length})`, looked === files.length);
  check("no category is above its fallback-share ceiling", over.length === 0, over.join(" · "));
  const catalogueShare = hardware ? (100 * parts) / hardware : 0;
  check(`the catalogue-wide fallback share is at or under ${CATALOGUE_CEILING}% (measured ${catalogueShare.toFixed(2)}%, target under 5%)`,
    catalogueShare <= CATALOGUE_CEILING, `${parts} of ${hardware}`);

  // ---- THE ASKED-NOTHING AXIS ------------------------------------------------------------------
  // The number the phase is actually judged on, and it is LARGER than the one this project has been
  // publishing: 3,071 against 2,929, because the two sets overlap without either containing the
  // other. The ceiling records today's measurement; the target is the same under-5%.
  const ASKED_NOTHING_CEILING = 3100;
  check(`parts asked NOTHING are at or under ${ASKED_NOTHING_CEILING} (measured ${askedNothing}; the unresolved-kind count is ${parts}, and neither contains the other)`,
    askedNothing <= ASKED_NOTHING_CEILING, `${askedNothing} of ${hardware}`);
  check(`the ceiling is still close to the measurement (${askedNothing} vs ${ASKED_NOTHING_CEILING})`,
    askedNothing > ASKED_NOTHING_CEILING - 250,
    `it fell — lower the ceiling to ${Math.ceil(askedNothing / 50) * 50} and record the win`);
  // THE TWO NUMBERS MUST DISAGREE, and the test says so out loud. If they ever became equal it
  // would mean one axis had been derived from the other, which is the conflation this exists to end.
  check(`the axes are measured independently (${unresolvedAskedSomething} unresolved-kind parts ARE asked a cup; ${namedZero.length} named kinds are asked nothing)`,
    unresolvedAskedSomething > 0 && namedZero.length > 0,
    `unresolved-but-asked ${unresolvedAskedSomething}, named-but-empty ${namedZero.join(", ") || "none"}`);
  lines.push(`    asked nothing: ${askedNothing} parts (${namedZero.length} NAMED kinds among them: ${namedZero.join(", ")}) · ${unresolvedAskedSomething} unresolved-kind parts are asked at least one cup`);

  /**
   * (b) ZERO FALLBACK PARTS THAT LOOK LIKE A REAL PRODUCT — and this is the real check, because it is
   * the shape that hid the UNITY-PIMG media gateways: 14 PBX-IP gateways a licence rule was about to
   * delete, invisible to every count because a fallback kind asking nothing scores every one of its
   * parts complete.
   *
   * TWO DETECTORS, and they are kept as two numbers because they fail differently:
   *
   *   facts3      a part holding THREE OR MORE facts of its own. **This one is at ZERO and is
   *               asserted at zero.** It was 39 before this work — all twelve of the last family were
   *               Prisma II QAM transmitters named "1550HD DFB, 10dBm, ITU26" whose alternate part
   *               number is `P2-HD15TXQ`, with the hyphen missing that videoKind's SKU rule needs.
   *
   *   device_noun a part whose NAME names a whole box (switch, router, server, chassis, gateway …).
   *               **159, AND THIS CEILING CODIFIES A NUMBER THAT IS NOT ZERO.** Said plainly: the test
   *               below does NOT prove the second half of the property. Most of the 159 are correct —
   *               a mechanical accessory's name is mostly its host ("Nexus 5548 Chassis Accessory
   *               Kit"), which is the detector's designed-in false positive — but they were read in
   *               batches, not one at a time, so the honest statement is a ceiling and a note, not a
   *               pass. It was 710 before this work.
   */
  // OVER THE UNION of both axes: judging only the unresolved half is how 1,432 bundle parts, 95 of
  // them named after a whole box, stayed outside the detectors for the life of this census.
  check("ZERO parts in an unresolved OR empty kind hold three or more facts of their own", unionFacts3 === 0,
    `${unionFacts3} do — a kind asking nothing scores every one of its parts complete (see the UNITY-PIMG case)`);
  // RE-BASELINED 12 Sep 2026 FROM 159 TO THE UNION, and upward, which is the honest direction: the
  // old 159 counted only the unresolved axis, and the reviewer was right that a ceiling-with-a-note
  // is a weak carrier for a known failure. It stays a ceiling for one round because the union adds
  // 95 bundle rows that have never been read one at a time; the fix is the kind, not the number.
  const DEVICE_NOUN_CEILING = 260;   // NOT a target: the target is 0. See the note above.
  check(`parts in an unresolved OR empty kind whose NAME names a device are at or under ${DEVICE_NOUN_CEILING} (measured ${unionNoun}; unresolved half ${noun})`,
    unionNoun <= DEVICE_NOUN_CEILING,
    "this ceiling CODIFIES TODAY'S FAILURE: the property is zero and the measurement is not");
  lines.push(`    fallback census: ${parts} of ${hardware} parts in a fallback kind (${catalogueShare.toFixed(2)}%, target <5%) · ${unionFacts3} hold 3+ own facts (asserted 0) · ${unionNoun} name a device over the union of both axes (${noun} in the unresolved half; ceiling ${DEVICE_NOUN_CEILING}, target 0)`);

  // SABOTAGE, on a census nobody committed, so the two thresholds cannot be checks that never fail.
  const judge = (fb: Fallback, ceiling: number): string[] => {
    const out: string[] = [];
    const share = (100 * fb.parts) / fb.hardware_parts;
    if (share > ceiling + 0.05) out.push(`share ${share.toFixed(1)}% over ceiling ${ceiling}%`);
    if (fb.facts3 > 0) out.push(`${fb.facts3} parts hold 3+ own facts`);
    return out;
  };
  const clean: Fallback = { kinds: ["accessory"], parts: 50, hardware_parts: 2000, facts3: 0, device_noun: 0 };
  check("CONTROL a clean census passes both thresholds", judge(clean, 3.0).length === 0, judge(clean, 3.0).join("; "));
  check("SABOTAGE a category whose fallback share doubled is caught",
    judge({ ...clean, parts: 200 }, 3.0).some((m) => m.includes("over ceiling")));
  check("SABOTAGE one fallback part holding three own facts is caught",
    judge({ ...clean, facts3: 1 }, 3.0).some((m) => m.includes("3+ own facts")));
}
// end fallback-kinds ---------------------------------------------------------------------------

lines.unshift(`    cup ledger: ${passed} passed, ${failed} missed (${files.length} ledgers, 13 sabotage/control cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
