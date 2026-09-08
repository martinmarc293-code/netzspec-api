// tests/securityShapes.test.ts — the security profile asks each shape what IT is bought on.
//
// `security` holds firewalls, IPS appliances, email and web gateways, management consoles,
// flow-analytics boxes and identity servers under one profile. Until 8 Sep 2026 that profile
// required `firewall_throughput`, `threat_throughput` and `concurrent_sessions` of all 6,689
// hardware parts, so an Email Security Appliance carried three permanently unfillable gaps.
//
// The requirements are scoped by series now, and BOTH directions are asserted for every shape:
// the field is required of the products that have it AND not-applicable to the ones that do not.
// Asserting only the first would pass a profile that still required everything of everyone.
import { requirementFor } from "../src/core/fieldSchema.js";

type Case = { series: string; field: string; want: "req" | "opt" | "na"; why: string };

const CASES: Case[] = [
  // --- firewalls are asked for firewall figures ---
  { series: "Firepower NGFW", field: "firewall_throughput", want: "req", why: "an NGFW is bought on it" },
  { series: "ASA 5500 Series Next Generation", field: "firewall_throughput", want: "req", why: "so is an ASA" },
  { series: "Firepower NGFW", field: "concurrent_sessions", want: "req", why: "session table size sizes a firewall" },
  { series: "Firepower NGFW", field: "threat_throughput", want: "req", why: "inline inspection" },

  // --- and nothing else is ---
  { series: "Email Security Appliance", field: "firewall_throughput", want: "na", why: "a mail gateway has none" },
  { series: "Secure Web Appliance", field: "firewall_throughput", want: "na", why: "nor does a web proxy" },
  { series: "Security Manager", field: "firewall_throughput", want: "na", why: "nor a management console" },
  { series: "Secure Network Analytics", field: "firewall_throughput", want: "na", why: "nor a flow collector" },
  { series: "Identity Services Engine", field: "firewall_throughput", want: "na", why: "nor an identity server" },
  { series: "Secure Client (including AnyConnect)", field: "firewall_throughput", want: "na", why: "nor endpoint software" },

  // --- each other shape is asked for its own sizing figure ---
  { series: "Email Security Appliance", field: "recommended_users", want: "req", why: "ESA is sized by users" },
  { series: "Secure Web Appliance", field: "recommended_users", want: "req", why: "so is a WSA" },
  { series: "Security Manager", field: "managed_devices_max", want: "opt", why: "no enabled source publishes a label for it — declared, not required" },
  { series: "Firesight Management Center", field: "events_per_second", want: "opt", why: "the only eps label in the inventory is a FIREWALL row — declared, not required" },
  { series: "Secure Network Analytics", field: "flows_per_second", want: "opt", why: "zero labels in the inventory — declared, not required" },
  { series: "Identity Services Engine", field: "max_endpoints", want: "opt", why: "labels exist but are ambiguous — declared, not required" },
  { series: "FirePOWER 8000 Appliances", field: "ips_throughput", want: "req", why: "an IPS by inspected throughput" },
  { series: "Secure DDoS Protection", field: "ddos_mitigation_throughput", want: "opt", why: "its label is shared with a firewall figure — declared, not required" },

  // --- and NOT for another shape's figure ---
  { series: "Firepower NGFW", field: "recommended_users", want: "na", why: "a firewall is not sized by users" },
  { series: "Firepower NGFW", field: "storage_capacity", want: "na", why: "a firewall is not sized by an event store" },
  { series: "Email Security Appliance", field: "storage_capacity", want: "req", why: "a mail gateway IS sized by its spool" },
  { series: "Email Security Appliance", field: "ips_throughput", want: "na", why: "no inline inspection" },
  { series: "Security Manager", field: "storage_capacity", want: "req", why: "a console IS sized by its event store" },

  // --- the universal fields hold for every shape, including the unshaped ones ---
  { series: "Email Security Appliance", field: "weight", want: "req", why: "every box has a weight" },
  { series: "Secure Client (including AnyConnect)", field: "dimensions", want: "req", why: "universal" },
  { series: "Umbrella", field: "certifications", want: "req", why: "universal" },
  { series: "Secure Network Analytics", field: "power_max", want: "req", why: "universal" },

  // --- a series in no shape gets no shape-specific requirement, which is the safe default ---
  { series: "XDR", field: "concurrent_sessions", want: "na", why: "unshaped: asked nothing it may not have" },
  { series: "Fireamp Endpoints", field: "storage_capacity", want: "na", why: "unshaped" },
  { series: "A Series That Does Not Exist Yet", field: "firewall_throughput", want: "na", why: "a new series is not assumed to be a firewall" },
  { series: "A Series That Does Not Exist Yet", field: "weight", want: "req", why: "but it is still a box" },
];

export function run(): { passed: number; failed: number; lines: string[] } {
  const lines: string[] = [];
  let passed = 0, failed = 0;
  for (const c of CASES) {
    const got = requirementFor("security", c.field, { series: c.series });
    if (got === c.want) passed++;
    else { failed++; lines.push(`    MISS ${c.series} / ${c.field} -> "${got}", wanted "${c.want}" (${c.why})`); }
  }

  // A condition on a value the part does not carry must not fire. If `series` were ever dropped
  // from the values passed to requirementFor, every shape rule would silently go not-applicable
  // and the profile would quietly ask for nine universal fields and nothing else.
  const noSeries = requirementFor("security", "firewall_throughput", {});
  const withSeries = requirementFor("security", "firewall_throughput", { series: "Firepower NGFW" });
  if (noSeries === "na" && withSeries === "req") passed++;
  else {
    failed++;
    lines.push(`    MISS series-less part gave "${noSeries}" and Firepower gave "${withSeries}" — ` +
               "one of the two branches is dead");
  }

  const refusals = CASES.filter((c) => c.want === "na").length;
  lines.unshift(`    security shapes: ${passed} passed, ${failed} missed (${refusals} refusal cases)`);
  return { passed, failed, lines };
}

const r = run();
console.log(r.lines.join("\n"));
if (r.failed) process.exit(1);
