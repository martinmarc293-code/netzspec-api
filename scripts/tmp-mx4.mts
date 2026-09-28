import { requirementFor, PROFILES, type Requirement } from "../src/core/fieldSchema.js";
// A SYNTHETIC PART CARRYING ONLY kind+role RESOLVES EVERY GATE ON ANYTHING ELSE TO `pending`, so a
// req-vs-req diff reads a pend as a LOSS. Both states are printed, and the comparison is run twice:
// once bare, once with the gates a real teleworker gateway answers.
const states = (cat: string, part: Record<string, unknown>) => {
  const prof = PROFILES[cat] as Record<string, Requirement> | undefined;
  const out = new Map<string, string[]>();
  for (const k of Object.keys(prof ?? {})) {
    const r = String(requirementFor(cat, k, part as never));
    out.set(r, [...(out.get(r) ?? []), k]);
  }
  return out;
};
const line = (label: string, m: Map<string, string[]>) =>
  console.log(`  ${label.padEnd(44)} ${[...m].map(([k, v]) => `${k} ${v.length}`).sort().join("  ")}`);
const diff = (a: Map<string, string[]>, b: Map<string, string[]>) => {
  const ra = a.get("req") ?? [], rb = b.get("req") ?? [];
  const pend = b.get("pending") ?? [];
  const lost = ra.filter((k) => !rb.includes(k));
  console.log(`    GAINS: ${rb.filter((k) => !ra.includes(k)).join(", ") || "none"}`);
  console.log(`    lost to a PEND (a gate the synthetic part cannot answer): ${lost.filter((k) => pend.includes(k)).join(", ") || "none"}`);
  const na = b.get("na") ?? [], opt = b.get("opt") ?? [];
  const outright = lost.filter((k) => !pend.includes(k));
  console.log(`    LOST TO na (cannot have one): ${outright.filter((k) => na.includes(k)).join(", ") || "none"}`);
  console.log(`    LOST TO opt (still askable, no longer demanded): ${outright.filter((k) => opt.includes(k)).join(", ") || "none"}`);
};
const before = states("meraki", { kind: "appliance" });
line("meraki/appliance (today)", before);
console.log("\nMX -> security/firewall");
const mxAfter = states("security", { kind: "firewall" });
line("security/firewall", mxAfter); diff(before, mxAfter);
console.log("\nZ -> routers/router role=smb, gates UNANSWERED");
const zBare = states("routers", { kind: "router", deploy_role: "smb" });
line("routers/router smb (bare)", zBare); diff(before, zBare);
console.log("\nZ -> routers/router role=smb, with the gates a real Z4 answers (form_factor desktop, modular false)");
const zReal = states("routers", { kind: "router", deploy_role: "smb", form_factor: "desktop", modular: false });
line("routers/router smb (gates answered)", zReal); diff(before, zReal);
process.exit(0);
