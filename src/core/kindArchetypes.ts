// src/core/kindArchetypes.ts — what a KIND can never hold, and the evidence that allows saying so.
//
// `na` closes a gap PERMANENTLY. That is its value — it stops a crawler hunting for ever for a figure
// that cannot exist — and it is also the whole danger. In September 48 `na` marks written for licences
// landed on the 446 pieces of HARDWARE sharing those categories, telling real endpoints they had no
// weight and no operating temperature: closing the gaps of the only parts that could still have
// filled them. So an archetype is a PROPOSAL, and the data holds a veto over it.
//
// THE VETO: a cup any part of that kind already holds an OWN fact for can never be marked `na`. A fact
// existing is proof of applicability and it outranks any judgement made here.
//
// "OWN" IS LOAD-BEARING AND WAS NOT OBVIOUS. Built from all live facts the veto said `mechanical` — a
// bracket — holds facts for 49 distinct cups, and `accessory` 41. Excluding inherited: 16 and 12, with
// 33 and 29 cups where the part holds a value and NOT ONE of them was read for it. An inherited fact
// proves the FAMILY has the property, never that every member does, so built from all facts the veto
// was measuring inheritance and would have made exactly the kinds that most need closing un-closable.
// (docs/reports/2026-09-27-inheritance-is-most-of-a-component-s-coverage.md)
//
// EVEN THE OWN FACTS CONTAIN WRONG POURS — `mechanical` owns a `cpu`, `fan` owns a `data_rate`,
// `power-cord` owns `module_slots`. The veto therefore refuses `na` on some cups whose only evidence is
// itself a bad extraction, and the archetypes close less than they should. That is the SAFE direction
// and it is deliberate: a cup left open costs a crawler some work, a cup wrongly closed costs a real
// part its only chance of ever being filled.

/** A group of cups that stand or fall together, named so an archetype reads as a sentence about the
 *  physical object rather than as a list of keys somebody assembled. */
export const CUP_GROUPS: Readonly<Record<string, readonly string[]>> = {
  // Things only a device that FORWARDS TRAFFIC has.
  switching: ["switching_capacity", "forwarding_rate", "layer", "vlan_max", "mac_table", "stacking",
              "stacking_bandwidth", "uplink_ports", "poe_budget", "poe_ports", "poe_standard",
              "ipv4_routes", "ipv6_routes", "acl_entries", "qos_features", "spanning_tree"],
  // Things only a device that RUNS SOFTWARE has.
  compute: ["cpu", "cpu_sockets_max", "cpu_cache", "clock_speed", "cores", "threads", "tdp",
            "memory_max", "memory_slots", "dimm_slots", "memory_speed_max", "drive_bays"],
  // Things only a RADIO has.
  radio: ["radio_bands", "radio_count", "antenna_gain", "antenna_connector", "wifi_standard",
          "tx_power", "mimo", "spatial_streams", "channel_width"],
  // Things only an OPTIC has.
  optical: ["wavelength", "reach", "ddm", "msa", "form_factor", "fiber_type", "tuning_range",
            "insertion_loss_max", "modulation_format"],
  // Things only a FIREWALL or security appliance has.
  security: ["firewall_throughput", "vpn_throughput", "ips_throughput", "concurrent_sessions",
             "connections_per_second", "vpn_peers"],
};

export type Archetype = {
  /** One sentence about the physical object, which is what makes the cup list checkable by a reader. */
  readonly what: string;
  /** Cup GROUPS this kind can never hold, each because of what the object IS. */
  readonly cannotHold: readonly string[];
};

/** Deliberately SMALL. Every entry is a physical object whose nature settles the question, and a kind
 *  that is not here simply gets no `na` marks — which is the current state and is safe. Adding a kind
 *  is a decision with a witness, not a tidying exercise. */
export const KIND_ARCHETYPES: Readonly<Record<string, Archetype>> = {
  mechanical: { what: "a bracket, a cover, a rail kit, a blank — a passive piece of metal or plastic with no electrical function",
                cannotHold: ["switching", "compute", "radio", "optical", "security"] },
  "power-cord": { what: "a mains lead: two connectors and a length of copper",
                  cannotHold: ["switching", "compute", "radio", "optical", "security"] },
  fan: { what: "a fan tray: it moves air and reports its own speed",
         cannotHold: ["switching", "compute", "radio", "optical", "security"] },
  power: { what: "a power supply: it converts mains to DC and reports its own electrical behaviour",
           cannotHold: ["switching", "radio", "optical", "security"] },
  cable: { what: "a cable or a DAC: a physical link with a connector at each end",
           cannotHold: ["switching", "compute", "security"] },
  memory: { what: "a DIMM: capacity, rank, voltage and speed",
            cannotHold: ["switching", "radio", "optical", "security"] },
  flash: { what: "a flash module: capacity and interface",
           cannotHold: ["switching", "radio", "optical", "security"] },
  tpm: { what: "a trusted platform module: a security chip with no throughput of its own",
         cannotHold: ["switching", "radio", "optical", "security"] },
  accessory: { what: "an accessory: a mount, a cap, a spare door, a cable guide",
               cannotHold: ["switching", "compute", "radio", "optical", "security"] },
};

/** The cups an archetype PROPOSES to mark `na` for a kind, before the data's veto is applied. Returns
 *  an empty list for any kind with no archetype, which is the safe default and the current state. */
export function proposedNa(kind: string): string[] {
  const a = KIND_ARCHETYPES[kind];
  if (!a) return [];
  const out = new Set<string>();
  for (const g of a.cannotHold) for (const cup of CUP_GROUPS[g] ?? []) out.add(cup);
  return [...out].sort();
}

/** The proposal AFTER the veto. `heldCups` is the set of cups that kind holds an OWN fact for; every
 *  one of them is removed and returned separately, because a vetoed proposal is a FINDING — either the
 *  archetype is wrong about the object, or that fact is a wrong pour worth reading. Silently dropping
 *  it would hide both. */
export function naForKind(kind: string, heldCups: ReadonlySet<string>): { na: string[]; vetoed: string[] } {
  const proposed = proposedNa(kind);
  const na: string[] = [], vetoed: string[] = [];
  for (const cup of proposed) (heldCups.has(cup) ? vetoed : na).push(cup);
  return { na, vetoed };
}
