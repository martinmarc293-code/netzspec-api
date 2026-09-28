// src/core/merakiKind.ts — what KIND of thing a `meraki` part is.
//
// THE DEFECT. `meraki` asked all 283 of its Cisco hardware parts the same nine required fields
// (`count(DISTINCT required_total) = 1`): dimensions, weight, form_factor, power_max,
// temp_operating, humidity_operating, certifications, ports and poe_standard. An MT11 temperature
// probe was asked a port count and a PoE standard; an MV camera a PoE standard; an MGKIT-1
// mounting kit all nine.
//
// THE AXIS IS THE SKU LETTER, AND IT IS CLEAN AND TOTAL. Meraki, unlike Cisco, uses a
// two-character product-line code as the first token of every PID, and it is not shared between
// lines the way `WS` is shared between a Catalyst switch and its power supply. Measured over the
// 283 hardware parts, with the field keys each population actually holds — the letter does not
// merely partition the SKUs, it partitions the QUESTIONS:
//
//   MS  109  switch          dimensions 58 · switching_capacity 58 · copper_ethernet_ports 48
//                            poe_budget 37 · sfp_plus_ports 33 · stacking_bandwidth 33 · stack_ports 31
//   MV   52  camera          field_of_view 11 · storage_capacity 10 · video_quality_max 9
//                            image_sensor 9 · focal_length 7 · lens_aperture 7 · ir_illumination 7
//   MG   38  gateway         dimensions 8 · weight 8 · temp_operating 8 — the envelope and nothing else
//   MR/CW 36 access-point    wifi_generation 3 · radio_count 2 · max_data_rate 2 · antenna_type 2
//   MX/Z  26 appliance       firewall_throughput 8 · max_data_rate 5 · ipsec_tunnels 4
//                            lan_interfaces 2 · wan_interfaces 2
//   MT   16  sensor          battery_count 6 · battery_life 6 · external_power 6 — NO ports at all
//   MGKIT 1  accessory
//   MCS   5  (default)       MCS1..MCS6, name = SKU, zero facts, zero documents
//
// Not one key crosses a line boundary except the physical envelope, which every Meraki box has.
// That is what a clean axis looks like, and it is why this file is 40 lines and switchKind is 250.
//
// THE DEFAULT IS `unknown`, WHICH ASKS THE ENVELOPE AND NOTHING ELSE. MCS1-MCS6 are five rows whose
// name is their own SKU and which carry no fact and no document; nobody in three sessions has
// worked out what they are. A Meraki row that is classed hardware has a body, so it is asked the
// five envelope questions — and it is asked no ports, no PoE, no throughput, no lens. A new Meraki
// product line lands here the same way: asked less, never more.
//
// THE TWO REFUSALS THAT MATTER, and both are pinned in tests/merakiKind.test.ts:
//   MGKIT-1 IS NOT AN MG. The accessory rule runs FIRST for exactly this reason — `^MG` would
//        otherwise read a mounting kit as a cellular gateway and ask it for cellular bands.
//   MS130-8 IS NOT A POWER ADAPTER, whatever its name says. Its `name` in the catalogue is "30 W
//        power adapter" and MS130-12X's is "300 W power adapter" — two of the three wrong names
//        the census found (MS130R-8P's reads as a licence). They hold 14, 18 and 13 facts, every
//        one of them a SWITCH fact (switching_capacity, copper_ethernet_ports, poe_budget). A
//        classifier driven off the name would have filed three MS switches as power supplies and
//        closed their real questions; the SKU is right and the name is the defect. It is a name
//        correction in the report's proposals, not a kind.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: move the MS rows to `switches`, the MR rows to
// `wireless` or the MX rows to `security`. switchKind would ask every MS 38 required fields drawn
// from a Cisco-datasheet vocabulary, while the Meraki source publishes a different set
// (copper_ethernet_ports, sfp_plus_ports, stack_ports, power_load_idle_max); and `security`'s shape
// lists gate on `series`, in none of which "Meraki" appears, so an MX moved there would be asked
// the universals only — LESS than it is asked here. It is an operator question in the report.

export type MerakiKind =
  | "unknown"       // the deliberate fallback: the physical envelope, nothing else
  | "switch"        // MS
  | "access-point"  // MR, CW
  | "security-camera"        // MV
  | "environment-sensor"        // MT
  | "cellular-gateway"       // MG — cellular
  | "accessory";    // mounting kits, cords, brackets

/** Every kind that is a Meraki BOX: it is racked or mounted, powered, and has an envelope. */
export const MK_BOX: readonly MerakiKind[] =
  ["unknown", "switch", "access-point", "security-camera", "environment-sensor", "cellular-gateway"];

/** Kinds that carry Ethernet PORTS. An MT sensor has none — 0 of 16 hold a port key. */
export const MK_PORTED: readonly MerakiKind[] = ["switch", "access-point", "cellular-gateway"];

/**
 * Kinds that draw mains or PoE power and for which a wattage is stated. An MT sensor is
 * BATTERY-powered — all 16 hold `battery_count`, `battery_life` and `external_power` and none
 * holds a power figure — so it is asked a battery life instead of a power draw.
 */
export const MK_POWERED: readonly MerakiKind[] =
  ["unknown", "switch", "access-point", "security-camera", "cellular-gateway"];

// Ordered; the FIRST rule that matches wins. accessory FIRST — see the MGKIT-1 refusal above.
const RULES: { kind: MerakiKind; re: RegExp }[] = [
  // Mounting kits, brackets and cords. MGKIT-1 is the only member today (1 of 283); the other
  // tokens are Meraki's house spelling for the same things in its price list, and each is refused
  // by the product-line rules below only because it is tested here first.
  // 12 Sep 2026: the power/cable/fan/PSU tokens were added after tests/partKind.test.ts probed this
  // axis with `CAB-9K16A-AUS`, a power cord, and got `unknown` — which is the fallback, and the
  // fallback asks the physical envelope. A cord has none. Meraki's own accessory line is spelled
  // MA-PWR-30WAC / MA-CBL-40G-3M / MA-MNT-MR-H, and no product-line SKU in the corpus carries any
  // of these tokens (checked against all 283), so the rule costs nothing and closes the hole.
  { kind: "accessory", re: /^MGKIT|^MA-|(?:^|-)(?:KIT|MNT|BRKT|RPS|ANT|CAB|CBL|PWR|CORD|SFP|PSU|FAN)(?:-|=|\d|$)/ },
  { kind: "switch", re: /^MS\d/ },
  { kind: "security-camera", re: /^MV\d/ },
  { kind: "cellular-gateway", re: /^MG\d/ },
  // CW is the Catalyst Wireless naming Meraki access points moved to (CW9162I, CW9166D1, CW9166I).
  { kind: "access-point", re: /^MR\d|^CW\d/ },
  // THE MX AND Z RULE IS GONE (reviewer's ruling, 28 Sep 2026). It used to read
  // `{ kind: "appliance", re: /^MX\d|^Z\d/ }` with the note "Z is the teleworker gateway (Z3, Z4) — an MX
  // appliance in a small box, and it holds the same keys". Both halves of that were true and neither is a
  // reason to keep the parts here: an MX is a FIREWALL, so the 18 shipping models moved to `security` where
  // firewalls are asked ips_throughput, tls_throughput and vpn_peers; and a Z is a teleworker GATEWAY, so the
  // four (Z4, Z4-HW, Z4C, Z4C-HW — no Z3 exists in this catalogue) moved to `routers` as kind `router`.
  //
  // WITH THE RULE GONE, `appliance` HAS NO PRODUCER HERE and the kind empties, which is the point: it is the
  // last (category, kind) pair that `kind_profile_parity` had to compare between meraki and security, and the
  // pair disappearing is what resolves it without reversing security's series-gated "ask less" default. The
  // kind stays in the union and in MK_PORTED, as `appliance` did in securityKind after D2 — a kind that can
  // be REFERRED to is not the same as a kind something produces, and deleting it would rewrite the artefacts.
  //
  // Anything MX-shaped still filed here now resolves `unknown`, deliberately: the four that would (MX16,
  // MX18, MX26, MX650) hold no fact, no document and no real model between them, and `unknown` is where a row
  // nobody can identify belongs.
  { kind: "environment-sensor", re: /^MT\d/ },
];

export function merakiKind(sku: string): MerakiKind {
  const s = String(sku ?? "").trim().toUpperCase();
  if (s === "") return "unknown";
  for (const r of RULES) if (r.re.test(s)) return r.kind;
  return "unknown";
}
