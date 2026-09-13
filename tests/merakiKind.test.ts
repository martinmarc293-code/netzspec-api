// tests/merakiKind.test.ts — what a `meraki` part IS, from its SKU (12 Sep 2026).
//
//   npx tsx tests/merakiKind.test.ts
//
// The axis is the two-character product-line code, which is clean and total — see merakiKind.ts for
// the fact table that proves it partitions the QUESTIONS and not merely the SKUs. Two refusals
// carry the whole file:
//
//   MGKIT-1 IS NOT AN MG. `^MG` would read a mounting kit as a cellular gateway and ask it for
//        cellular bands; the accessory rule runs first for exactly that reason.
//   MS130-8 IS NOT A POWER ADAPTER. Its catalogue `name` is "30 W power adapter" and MS130-12X's is
//        "300 W power adapter" — two of the three wrong names the census found — while their 14 and
//        18 facts are SWITCH facts (switching_capacity, copper_ethernet_ports, poe_budget). A
//        name-driven classifier would have filed three MS switches as power supplies and closed
//        their real questions. The SKU is right; the name is the defect, and it is a name
//        correction in the report, not a kind.
//
// Every SKU below is a real catalogue row. None is invented.
import { merakiKind, MK_BOX, MK_PORTED, MK_POWERED, type MerakiKind } from "../src/core/merakiKind.js";
import { completenessV2, requirementFor, PROFILES } from "../src/core/fieldSchema.js";
import { partKind } from "../src/core/partKind.js";
import { kindQuestionSet } from "../src/core/cupLedger.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

const CASES: [string, MerakiKind][] = [
  // MS — switches (109 of the 283)
  ["MS120-8LP", "switch"], ["MS125-48FP", "switch"], ["MS130-8X", "switch"], ["MS130-48X", "switch"],
  ["MS210-24P", "switch"], ["MS225-48", "switch"], ["MS350-24X", "switch"], ["MS355-24X", "switch"],
  ["MS390-24P-HW", "switch"], ["MS410-16", "switch"], ["MS425-16", "switch"], ["MS450-12", "switch"],
  ["MS130R-8P", "switch"], ["MS130-CMPT", "switch"], ["MS130-CMPTA", "switch"],
  // MR / CW — access points (36)
  ["MR28", "access-point"], ["MR28-HW", "access-point"], ["MR36H-HW", "access-point"],
  ["MR46E-HW", "access-point"], ["MR57-HW", "access-point"], ["CW9162I", "access-point"],
  ["CW9166D1", "access-point"], ["CW9166I-MR", "access-point"],
  // MX / Z — security and SD-WAN appliances (26)
  ["MX67-HW", "appliance"], ["MX68CW-HW-WW", "appliance"], ["MX75-HW", "appliance"],
  ["MX95", "appliance"], ["MX105-HW", "appliance"], ["MX250-HW", "appliance"],
  ["Z3-HW", "appliance"], ["Z4", "appliance"], ["Z4-HW", "appliance"],
  // MV — cameras (52)
  ["MV12N", "camera"], ["MV12WE", "camera"], ["MV13", "camera"], ["MV13-HW", "camera"],
  ["MV32", "camera"], ["MV52X-HW", "camera"], ["MV63X-HW", "camera"], ["MV93X-HW", "camera"],
  // MT — sensors (16)
  ["MT10", "sensor"], ["MT10-HW", "sensor"], ["MT11", "sensor"], ["MT12", "sensor"],
  ["MT14", "sensor"], ["MT20", "sensor"], ["MT30", "sensor"], ["MT40", "sensor"],
  // MG — cellular gateways (38)
  ["MG21", "gateway"], ["MG21-HW-NA", "gateway"], ["MG21E", "gateway"], ["MG21E-HW-WW", "gateway"],
  ["MG41", "gateway"], ["MG51", "gateway"], ["MG52", "gateway"], ["MG52E-HW-WW", "gateway"],
  // accessories
  ["MGKIT-1", "accessory"], ["MA-PWR-30WAC", "accessory"], ["MA-CBL-40G-3M", "accessory"],
  ["MA-MNT-MR-H", "accessory"], ["MA-ANT-25", "accessory"], ["MA-SFP-10GB-SR", "accessory"],
  // the deliberate fallback: five rows whose name is their own SKU and which carry no fact
  ["MCS1", "unknown"], ["MCS2", "unknown"], ["MCS5", "unknown"], ["MCS6", "unknown"],
];
for (const [sku, want] of CASES) eq(`${sku} is ${want}`, merakiKind(sku), want);

// --- REFUSALS -----------------------------------------------------------------------------------
const REFUSALS: [string, MerakiKind, string][] = [
  ["MGKIT-1", "accessory", "a MOUNTING KIT, not an MG cellular gateway — the whole reason accessory runs first"],
  ["MS130-8", "switch", "its NAME says \"30 W power adapter\"; its 14 facts are switch facts"],
  ["MS130-12X", "switch", "likewise, \"300 W power adapter\", 18 switch facts"],
  ["MS130R-8P", "switch", "likewise, its name reads as a licence, 13 switch facts"],
  ["MS130-CMPT", "switch", "\"CMPT\" is COMPACT, a model variant — not a component"],
  ["MX67C-HW-WW", "appliance", "a CELLULAR MX is still an appliance, not a gateway"],
  ["MX68CW-HW-WW", "appliance", "an MX with Wi-Fi is still an appliance, not an access point"],
  ["MT10-HW", "sensor", "the -HW orderable row of a sensor is a sensor (the facts sit on MT10; model_of is a RELATION)"],
  ["MV13-HW", "camera", "the -HW orderable row of a camera"], ["Z4-HW", "appliance", "and of a teleworker gateway"],
  ["MG21-ENT-5Y", "gateway", "a term LICENCE by product_class, so it is scored against no profile; its kind is its line"],
  ["CAB-9K16A-AUS", "accessory", "a power cord must not reach the fallback, which asks the physical envelope"],
  ["MA-PWR-30WAC", "accessory", "nor a power adapter"],
];
for (const [sku, want, why] of REFUSALS) eq(`${sku} stays ${want}${why ? ` (${why})` : ""}`, merakiKind(sku), want);

// --- ORDER --------------------------------------------------------------------------------------
eq("accessory runs before gateway (MGKIT-1 vs ^MG)", merakiKind("MGKIT-1"), "accessory");
eq("and a real MG is untouched by it", merakiKind("MG21"), "gateway");

// --- SABOTAGE: one per rule family, disabled by asking what the weaker rule would give ----------
type Sab = { family: string; sku: string; live: MerakiKind; ifDisabled: MerakiKind };
const SABOTAGE: Sab[] = [
  // Without the accessory rule, MGKIT-1 is taken by ^MG and asked for cellular bands.
  { family: "accessory-before-gateway", sku: "MGKIT-1", live: "accessory", ifDisabled: "gateway" },
  // Without each line rule, the SKU falls to the fallback, which asks the envelope and nothing else.
  { family: "switch", sku: "MS125-48FP", live: "switch", ifDisabled: "unknown" },
  { family: "camera", sku: "MV32", live: "camera", ifDisabled: "unknown" },
  { family: "gateway", sku: "MG41", live: "gateway", ifDisabled: "unknown" },
  { family: "access-point", sku: "CW9166I", live: "access-point", ifDisabled: "unknown" },
  { family: "appliance", sku: "Z4", live: "appliance", ifDisabled: "unknown" },
  { family: "sensor", sku: "MT11", live: "sensor", ifDisabled: "unknown" },
];
for (const s of SABOTAGE) {
  eq(`sabotage ${s.family}: ${s.sku} is ${s.live} today`, merakiKind(s.sku), s.live);
  eq(`sabotage ${s.family}: and ${s.live} is not the fallback ${s.ifDisabled}`, s.live === s.ifDisabled, false);
}

// --- the kind sets say what the profile relies on -----------------------------------------------
eq("an accessory is not a box", (MK_BOX as readonly string[]).includes("accessory"), false);
eq("the fallback IS a box (a Meraki row classed hardware has a body)", (MK_BOX as readonly string[]).includes("unknown"), true);
eq("a sensor has no ports (0 of 16 hold a port key)", (MK_PORTED as readonly string[]).includes("sensor"), false);
eq("a camera has no ports either", (MK_PORTED as readonly string[]).includes("camera"), false);
eq("a sensor is battery-powered, so no power figure", (MK_POWERED as readonly string[]).includes("sensor"), false);
eq("a switch has one", (MK_POWERED as readonly string[]).includes("switch"), true);
eq("empty SKU falls to the fallback", merakiKind(""), "unknown");
for (const sku of ["QQQ", "ZZ-NOSUCH-1"]) eq(`unrecognisable falls to the fallback: ${sku}`, merakiKind(sku), "unknown");

const REACHED = new Set(CASES.map(([, k]) => k));
for (const k of ["unknown", "switch", "access-point", "appliance", "camera", "sensor", "gateway",
                 "accessory"] as MerakiKind[]) {
  eq(`kind "${k}" is reached by a catalogue SKU`, REACHED.has(k), true);
}

// --- THE QUESTIONS EACH KIND IS ACTUALLY ASKED, through the live profile -------------------------
const ask = (sku: string) => completenessV2("meraki", { kind: partKind("meraki", sku), vendor: "cisco" } as never);
{
  const sw = ask("MS125-48FP");
  eq("an MS switch is asked ports, PoE and a switching capacity",
     ["ports", "poe_standard", "switching_capacity"].every((k) => sw.missing.includes(k)), true);
  eq("and a form factor, which is the one kind the chassis enum fits", sw.missing.includes("form_factor"), true);
  eq("a switch that answers poe_standard=none is not asked a budget",
     requirementFor("meraki", "poe_budget", { kind: "switch", poe_standard: "none" }) === "req", false);
  const mt = ask("MT11");
  eq("an MT sensor is asked a battery life", mt.missing.includes("battery_life"), true);
  eq("and NO ports, NO PoE, NO power draw",
     ["ports", "poe_standard", "power_max"].some((k) => mt.missing.includes(k)), false);
  const mv = ask("MV32");
  eq("an MV camera is asked its field of view, image sensor and video quality",
     ["field_of_view", "image_sensor", "video_quality_max"].every((k) => mv.missing.includes(k)), true);
  eq("and no PoE standard — it CONSUMES PoE, it does not supply it", mv.missing.includes("poe_standard"), false);
  eq("and no port count", mv.missing.includes("ports"), false);
  const mx = ask("MX95");
  eq("an MX appliance is asked a firewall throughput", mx.missing.includes("firewall_throughput"), true);
  const mr = ask("MR36H-HW");
  eq("an MR access point is asked its Wi-Fi generation", mr.missing.includes("wifi_generation"), true);
  eq("and not a firewall throughput", mr.missing.includes("firewall_throughput"), false);
  const mg = ask("MG41");
  eq("an MG gateway is asked its cellular bands", mg.missing.includes("cellular_bands"), true);
  const kit = ask("MGKIT-1");
  eq("a mounting kit is asked exactly one thing: what it fits", kit.missing.join(","), "product_compatibility");
  // kind-layer (13 Sep 2026), spec v2 §II.15 and brief rule 4: an unresolved kind asks at most product_compatibility. MCS1-MCS6
  // are placeholder names with no document and no fact (III.0 item 6); like every other axis's `unknown` it asks NOTHING.
  const un = ask("MCS1");
  eq("kind-layer: the fallback `unknown` is asked nothing (<= 1 cup; was the 7-cup envelope)", un.required_total, 0);
  // kind-layer (operator bar): certifications is proposed REQUIRED again of the switch, AP and appliance (ENV / AP library);
  // the camera and the fallback are still not asked it.
  eq("kind-layer: certifications is asked of a switch, not of a camera or the fallback",
     sw.missing.includes("certifications") && ![...mv.missing, ...un.missing].includes("certifications"), true);
  // The control: every NAMED kind must still be asked something.
  for (const sku of ["MS125-48FP", "MR28", "MX95", "MV32", "MT11", "MG41", "MGKIT-1"]) {
    eq(`${sku} (kind=${partKind("meraki", sku)}) is still asked something`, ask(sku).required_total > 0, true);
  }
  // SABOTAGE of the unknown cap: an `unknown` given back the envelope must be seen — a profile copy where dimensions is
  // asked of unknown must fail the <= 1 cup assertion the line above makes.
  {
    const unknownCups = () => { const q = kindQuestionSet("meraki", "unknown"); return q.required.length + q.pending.length; };
    const saved = { dimensions: PROFILES.meraki.dimensions, weight: PROFILES.meraki.weight };
    try {
      PROFILES.meraki.dimensions = { kind: "cond", when: { field: "kind", inList: ["unknown", "switch"] } };
      PROFILES.meraki.weight = { kind: "cond", when: { field: "kind", inList: ["unknown", "switch"] } };
      eq("SABOTAGE an `unknown` given the envelope back is caught by the <= 1 cap", unknownCups() <= 1, false);
    } finally {
      PROFILES.meraki.dimensions = saved.dimensions; PROFILES.meraki.weight = saved.weight;
    }
    eq("…and the restore holds (control)", unknownCups(), 0);
  }
  // kind-layer (operator bar, 13 Sep 2026): each kind = today's cups + its library kind's cups as PROPOSED required, for the
  // parent's printed-on-the-page measurement. `?` = pending on its gate.
  const mkSet = (kind: string, role?: string) => { const q = kindQuestionSet("meraki", kind, role); return [...q.required, ...q.pending.map((p) => `${p.key}?`)].sort().join(","); };
  const L = (...xs: string[]) => [...xs].sort().join(",");
  const MS_CORE = ["certifications", "cooling", "dimensions", "form_factor", "forwarding_rate", "humidity_operating", "ieee_standards",
    "jumbo_mtu", "mac_table", "mgmt_class", "mounting", "packet_buffer", "poe_standard", "ports", "power_max", "psu_config", "psu_options",
    "stackable", "switching_capacity", "temp_operating", "vlan_max", "weight",
    "module_slots?", "poe_budget?", "poe_ports?", "psu_redundant?", "rack_units?", "stacking_bandwidth?", "uplink_ports?"];
  const ENVP = ["altitude_max", "heat_dissipation", "input_voltage", "mtbf", "power_typical", "temp_storage"];
  eq("kind-layer: meraki/switch (no role) = ETH-SWITCHING + ENV + today's mounting / psu_options", mkSet("switch"), L(...MS_CORE));
  eq("kind-layer: meraki/switch/access = + ENV+", mkSet("switch", "access"), L(...MS_CORE, ...ENVP));
  eq("kind-layer: meraki/switch/core-agg = + ENV+, fabric_bandwidth, psu_redundant ungated", mkSet("switch", "core-agg"),
     L(...MS_CORE.filter((k) => k !== "psu_redundant?"), ...ENVP, "fabric_bandwidth", "psu_redundant"));
  eq("kind-layer: meraki/access-point = AP library + today's envelope", mkSet("access-point"),
     L("antenna_type", "certifications", "dimensions", "humidity_operating", "mounting", "poe_standard", "ports", "power_max", "psu_options",
       "radio_bands", "radio_count", "spatial_streams", "temp_operating", "weight", "wifi_generation"));
  eq("kind-layer: an OUTDOOR meraki access point is also asked its IP rating", mkSet("access-point", "outdoor").split(",").includes("ip_rating"), true);
  eq("kind-layer: meraki/appliance = FIREWALL (new_conn_per_sec held optional, as in security) + today's", mkSet("appliance"),
     L("certifications", "concurrent_sessions", "dimensions", "firewall_throughput", "form_factor", "humidity_operating", "ipsec_throughput",
       "mounting", "ports", "power_max", "psu_options", "temp_operating", "threat_throughput", "weight", "rack_units?"));
  eq("kind-layer: meraki/camera = CAMERA + MV deltas + today's", mkSet("camera"),
     L(/* reviewer C.3: camera_zoom optional (0 labels) */ "dimensions", "field_of_view", "humidity_operating", "image_sensor", "max_resolution", "mounting", "power_max",
       "product_compatibility", "psu_options", "storage_capacity", "temp_operating", "video_quality_max", "weight"));
  // sensors / cellular_category / cloud_management are proposed required by II.15 but are free strings: the standing rule in
  // tests/freeStringCups.test.ts keeps them optional until a type decision is recorded.
  eq("kind-layer: meraki/sensor = today's (its library `sensors` cup is a free string, held optional)", mkSet("sensor"),
     L("battery_life", "dimensions", "humidity_operating", "mounting", "psu_options", "temp_operating", "weight"));
  eq("kind-layer: meraki/gateway = CELLULAR's product_compatibility + today's", mkSet("gateway"),
     L("cellular_bands", "dimensions", "humidity_operating", "mounting", "ports", "power_max", "product_compatibility", "psu_options", "temp_operating", "weight"));
  eq("kind-layer: meraki/unknown asks <= 1", kindQuestionSet("meraki", "unknown").required.length + kindQuestionSet("meraki", "unknown").pending.length <= 1, true);
}

lines.unshift(`    meraki kind: ${passed} passed, ${failed} missed ` +
              `(${CASES.length} positives, ${REFUSALS.length} refusals, ${SABOTAGE.length} sabotage families, 2 ordering cases)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
