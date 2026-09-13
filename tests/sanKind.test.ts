// tests/sanKind.test.ts — what a storage-networking (MDS 9000) part IS, from its SKU (optical-storage, 12 Sep 2026).
//
// As in opticalKind.test.ts: at least as many refusals as positives, and a SABOTAGE case per rule family (the
// family is removed from the table and a case it decides must change answer). The refusals are the part worth
// keeping: a rack-mount BRACKET whose PID ends in CAB, the one real module in the M9 licence family, a fan tray
// in a director's PID family, a power supply named after a fixed switch.
//
// Every SKU comes from the catalogue (storage-networking hardware, read by name 12 Sep 2026). None is invented.
import { sanKind, sanKindWith, sanKindRule, SAN_KIND_RULES, SAN_KINDS, SAN_BOX, SAN_MODULE } from "../src/core/sanKind.js";
import { kindQuestionSet } from "../src/core/cupLedger.js";

let passed = 0, failed = 0;
const lines: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => {
  if (got === want) passed++;
  else { failed++; lines.push(`    MISS ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
};

const CASES: [string, string][] = [
  ["DS-C9148S-12PK9=", "fc-switch"], ["DS-C9396V-96ETK9P", "fc-switch"], ["DS-C9132T-MIK9", "fc-switch"],
  ["DS-C9706=", "director"], ["DS-C9513-3AK9", "director"],
  ["DS-X9448-768K9++=", "linecard"], ["DS-X9304-18K9", "linecard"],
  ["DS-X9530-SF2AK9", "supervisor"], ["DS-X97-SF4-K9", "supervisor"],
  ["DS-X9706-FAB1", "fabric"], ["DS-13SLT-FAB2", "fabric"],
  ["DS-CAC-3000W", "power"], ["DS-CDC97-3KW=", "power"],
  ["DS-C48-FAN", "fan"], ["DS-13SLT-FAN-R", "fan"],
  ["CAB-9K10A-AR", "cable"], ["CAB-C15-CBN=", "cable"],
  ["DS-9148-KIT-HP", "accessory"], ["DS-SC-K9=", "accessory"],
  ["DS-FC-SW-4PK=", "pluggable"],
  ["M92S2K9-5.2.1", "software"], ["M9148S-PL12", "software"],
  ["C97-743576-00", "unknown"],
];
for (const [sku, want] of CASES) eq(`${sku} is ${want}`, sanKind(sku), want);

const REFUSALS: [string, string, string][] = [
  ["DS-6SLOT-CAB=", "accessory", "'MDS 9506 Rack Mount and Cable Mgmt Brackets' — a bracket whose PID ends in CAB"],
  ["DS-9SLOT-CAB=", "accessory", "the 9509 twin of the bracket above"],
  ["DS-CAB-1M=", "cable", "'1m Cable for 10G Copper X2 Transceiver' — a real cable with a DS- prefix"],
  ["M9XT-FC1632", "linecard", "'MDS 32G FC Port Expansion module' — the one real module in the M9 licence family"],
  ["DS-C9706-FAN=", "fan", "a fan tray in the director's PID family — fan before director"],
  ["DS-C9710-FAN", "fan", "same, 9710"],
  ["DS-C9706-RMK=", "accessory", "'MDS 9706 - Rack Mount Kit' — not the director"],
  ["DS-C9718-BSK=", "accessory", "'Chassis Bottom Support Kit' — not the director"],
  ["DS-C9718-FD-MB", "accessory", "'Front Door Kit' — not the director"],
  ["DS-C9718-FDAFLT=", "accessory", "'Front Door Filter Replacement' — not the director"],
  ["DS-C9706-CBTOP=", "accessory", "'Cable Management and top LED kit' — not a cable, not the director"],
  ["DS-C9509-CL=", "accessory", "'Backplane Clock Module' — not the director"],
  ["DS-C48S-300AC", "power", "'MDS 9148S AC Power Supply' — named after a fixed switch, and a supply"],
  ["DS-C9216-PS=", "power", "'FRU Kit for MDS 9216 845W PS Upgrade' — not the 9216 switch"],
  ["DS-9250I-KITCCO", "accessory", "the accessory kit with KIT glued to the vendor code"],
  ["DS-C9124-EXPAND", "accessory", "'DS-C9124-IBM EXPAND OPT' — an option, not the 9124 switch"],
  ["DS-9134G-K9", "fc-switch", "a 9134 switch without the C of DS-C"],
  ["DS-HP-8GFC-K9", "fc-switch", "'8Gbps FC Switch for HP Blade System'"],
  ["DS-C9222I-HK9", "fc-switch", "a 1-slot modular 9222i is a SWITCH (fixed ports), not a director"],
  ["DS-C9216A-K9", "fc-switch", "the 9216 '16-port + 1-slot Modular Switch', not a director"],
  ["DS-X9824960BDC10=", "linecard", "a 40G module bundle whose PID carries optics and fabric counts"],
  ["DS-X97-SF1E-K9=", "supervisor", "Sup-1E, the E after the number"],
  ["DS-X9710H-FAB1=", "fabric", "the HP fabric-1 spare"],
  ["MEM-MDS-FLD512M=", "accessory", "'512-MB CompactFlash for Supervisor' — storage, no ports"],
  ["SSI-M9K9-528", "software", "'MDS SSI Image 5.2(8)'"],
];
for (const [sku, want, why] of REFUSALS) eq(`${sku} stays ${want} (${why})`, sanKind(sku), want);
eq(`refusals (${REFUSALS.length}) are at least as many as positives (${CASES.length})`, REFUSALS.length >= CASES.length, true);

const ALL = [...CASES, ...REFUSALS.map(([s, k]) => [s, k] as [string, string])];
SAN_KIND_RULES.forEach((rule, i) => {
  const witnesses = ALL.filter(([sku]) => sanKindRule(sku) === i);
  eq(`rule #${i} (${rule.kind}) is the deciding rule for at least one case`, witnesses.length > 0, true);
  const without = SAN_KIND_RULES.filter((_, j) => j !== i);
  const changed = witnesses.filter(([sku, want]) => sanKindWith(without, sku) !== want);
  eq(`SABOTAGE rule #${i} (${rule.kind}) disabled -> ${witnesses.length} witness(es) go red`, changed.length > 0, true);
});

eq("a director is a box", (SAN_BOX as readonly string[]).includes("director"), true);
eq("a supervisor is a module, not a box", (SAN_MODULE as readonly string[]).includes("supervisor") && !(SAN_BOX as readonly string[]).includes("supervisor"), true);
eq("the default asks less: `unknown` is in no box or module set", [...SAN_BOX, ...SAN_MODULE].includes("unknown" as never), false);
eq("empty SKU fails safe to unknown", sanKind(""), "unknown");

// --- kind-layer (13 Sep 2026): the renames and the 9509 upgrade bundles -----------------------------------------------
// spec v2 §II.12 / §III.1: `switch` -> `fc-switch`, `other` -> `unknown`. The old names must be GONE from the axis, or the
// one-cup-set-per-kind check keeps comparing an MDS switch with a Catalyst one under the same noun.
eq("kind-layer: no SKU is named `switch` any more (the rename is total)", (SAN_KINDS as readonly string[]).includes("switch"), false);
eq("kind-layer: no SKU is named `other` any more", (SAN_KINDS as readonly string[]).includes("other"), false);
eq("kind-layer: DS-9509-UPGR 'MDS 9509 Upgrade Bundle: 2 sup-2, 2 3000W AC PS' is asked a supervisor's questions", sanKind("DS-9509-UPGR"), "supervisor");
eq("kind-layer: DS-9509-A-UPGR (the sup-2A twin) likewise", sanKind("DS-9509-A-UPGR"), "supervisor");
eq("kind-layer REFUSAL: the 9509 DIRECTOR itself is not an upgrade bundle", sanKind("DS-C9509"), "director");
eq("kind-layer REFUSAL: MDS-9222I-75-PPT (a name that is only the SKU, no document) stays unknown", sanKind("MDS-9222I-75-PPT"), "unknown");
{
  // SABOTAGE: without the UPGR alternative the two bundles fall back to `unknown`.
  const i = SAN_KIND_RULES.findIndex((r) => r.kind === "supervisor");
  const weakened = SAN_KIND_RULES.map((r, j) => (j === i ? { kind: r.kind, re: /-SF\d[A-Z]?(?:-|K9|=|$)/ } : r));
  eq("SABOTAGE the supervisor rule without its UPGR alternative sends DS-9509-UPGR back to unknown", sanKindWith(weakened, "DS-9509-UPGR"), "unknown");
}
// The cup sets (operator bar, 13 Sep 2026: today's cups stay, the spec archetype's are added as PROPOSED required for the
// parent's printed-on-the-page measurement), asserted where they are derived.
const sanSet = (kind: string) => { const q = kindQuestionSet("storage-networking", kind); return [...q.required, ...q.pending.map((p) => `${p.key}?`)].sort().join(","); };
eq("kind-layer: fc-switch = ETH-SWITCHING minus PoE/stacking/MAC/VLAN, + data_rate, + ENV (today's airflow kept)", sanSet("fc-switch"),
   ["airflow", "certifications", "cooling", "data_rate", "dimensions", "form_factor", "forwarding_rate", "humidity_operating", "ieee_standards",
    "jumbo_mtu", "mgmt_class", "packet_buffer", "ports", "power_max", "psu_config", "rack_units", "switching_capacity", "temp_operating", "weight",
    "module_slots?", "psu_redundant?", "uplink_ports?"].sort().join(","));
eq("kind-layer: an fc-switch is asked no PoE, stacking, MAC table or VLAN cup",
   ["poe_standard", "poe_budget", "poe_ports", "stackable", "stacking_bandwidth", "mac_table", "vlan_max"].some((k) => sanSet("fc-switch").split(",").includes(k)), false);
eq("kind-layer: director = CHASSIS + fabric_bandwidth, today's envelope kept", sanSet("director"),
   ["certifications", "dimensions", "fabric_bandwidth", "form_factor", "humidity_operating", "module_slots", "power_max", "psu_config", "rack_units", "temp_operating", "weight"].sort().join(","));
eq("kind-layer: a director is still NOT asked ports", sanSet("director").split(",").includes("ports"), false);
eq("kind-layer: supervisor = SUPERVISOR (+ today's power_max)", sanSet("supervisor"), "dram,flash,forwarding_rate,power_max,product_compatibility,switching_capacity");
eq("kind-layer: unknown asks nothing", sanSet("unknown"), "");
eq("kind-layer: a SAN cable = CABLE + what it fits (every component kind asks product_compatibility)", sanSet("cable"), "cable_length,connector,media,product_compatibility");
for (const k of SAN_KINDS) eq(`kind "${k}" is reached by a catalogue SKU`, ALL.some(([, w]) => w === k), true);

lines.unshift(`    san kind: ${passed} passed, ${failed} missed (${CASES.length} positives, ${REFUSALS.length} refusals, ${SAN_KIND_RULES.length} sabotaged families)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
