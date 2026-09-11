// tests/securityShapes.test.ts — the security profile asks each KIND and each SHAPE what IT is
// bought on, and asks nothing else anything.
//
// `security` holds firewalls, IPS appliances, email and web gateways, management consoles,
// flow-analytics boxes and identity servers under one profile — and, beside them, 1,068 power
// supplies, fans, rails, blank slot covers, SSDs, DIMMs, blades and cables. Until 8 Sep 2026 the
// profile required `firewall_throughput`, `threat_throughput` and `concurrent_sessions` of all
// 6,689 hardware parts, so an Email Security Appliance carried three permanently unfillable gaps.
// Until 12 Sep 2026 it required the seven-field physical envelope of every one of those components,
// so a blank slot cover was asked its weight, its rack height and its operating humidity.
//
// TWO AXES, AND THE ORDER BETWEEN THEM IS THE POINT. `kind` comes from the SKU (securityKind.ts)
// and wins where the SKU names a shape; `series` decides only for the deliberate `appliance`
// fallback. Series alone cannot work: FPR3K-PSU-BLANK and FPR3105-NGFW-K9 share "4100 Firepower".
//
// BOTH DIRECTIONS ARE ASSERTED FOR EVERY SHAPE — the field is required of the products that have it
// AND not-applicable to the ones that do not. Asserting only the first would pass a profile that
// still required everything of everyone, which is what the first version of this file did.
//
// AND EVERY CASE CARRIES A `kind`, because `kind` is synthetic: a caller that does not fill it
// makes every conditional resolve `na` in silence (see src/core/partKind.ts). The sabotage at the
// foot of the file is that failure, asserted rather than described.
import { requirementFor, completenessV2 } from "../src/core/fieldSchema.js";
import { partKind } from "../src/core/partKind.js";
import { SEC_BOX, SEC_COMPONENT } from "../src/core/securityKind.js";

type Case = { kind: string; series?: string; field: string; want: "req" | "opt" | "na" | "pending"; why: string };

const CASES: Case[] = [
  // === the SKU names the shape: kind decides ===================================================
  { kind: "firewall", series: "Firepower NGFW", field: "firewall_throughput", want: "req", why: "an NGFW is bought on it" },
  { kind: "firewall", series: "Firepower NGFW", field: "concurrent_sessions", want: "req", why: "session table size sizes a firewall" },
  { kind: "firewall", series: "Firepower NGFW", field: "threat_throughput", want: "req", why: "inline inspection" },
  { kind: "ips", series: "FirePOWER 8000 Appliances", field: "ips_throughput", want: "req", why: "an IPS by inspected throughput" },
  { kind: "ips", series: "FirePOWER 8000 Appliances", field: "threat_throughput", want: "req", why: "an IPS inspects in line too" },
  { kind: "email-gateway", series: "Email Security Appliance", field: "recommended_users", want: "req", why: "an ESA is sized by users" },
  { kind: "web-gateway", series: "Secure Web Appliance", field: "recommended_users", want: "req", why: "so is a WSA" },
  { kind: "email-gateway", series: "Email Security Appliance", field: "storage_capacity", want: "req", why: "a mail gateway IS sized by its spool" },
  { kind: "management", series: "Security Manager", field: "storage_capacity", want: "req", why: "a console IS sized by its event store" },
  { kind: "analytics", series: "Secure Network Analytics", field: "storage_capacity", want: "req", why: "a flow collector by its flow store" },

  // === THE SKU BEATS A WRONG SERIES LABEL ======================================================
  // 17 of the 83 hardware rows in the "Email Security Appliance" series are WSA or SMA boxes, and
  // FMC1700-K9 sits in "4100 Firepower". Under the old series-only gate each was asked the other
  // product's question and refused its own.
  { kind: "web-gateway", series: "Email Security Appliance", field: "recommended_users", want: "req", why: "WSA-S390-K9 filed under the ESA series is still sized by users" },
  { kind: "management", series: "4100 Firepower", field: "storage_capacity", want: "req", why: "FMC1700-K9 is a management console whatever its series says" },
  { kind: "management", series: "4100 Firepower", field: "firewall_throughput", want: "na", why: "and it is NOT asked the firewall figure its series would have given it" },
  { kind: "management", series: "Firepower 9300 Series", field: "concurrent_sessions", want: "na", why: "the same, for the other mislabelled management rows" },

  // === THE SERIES FALLBACK, for a box whose SKU names no shape =================================
  // 30 rows reach it: the Threat Grid models, Secure Endpoint Private Cloud, the Secure Workload
  // clusters, and the 1210CE / 1210CP / 1220CX datasheet MODEL rows that hold 61 of the category's
  // facts — including every firewall_throughput and threat_throughput value it has.
  { kind: "appliance", series: "Secure Firewall 1200 Series", field: "firewall_throughput", want: "req", why: "1210CE holds 6.5 Gbit/s and its SKU names no shape" },
  { kind: "appliance", series: "Secure Firewall 1200 Series", field: "threat_throughput", want: "req", why: "the same row, the same table" },
  { kind: "appliance", series: "Security Manager", field: "storage_capacity", want: "req", why: "an unshaped management box keeps its series' question" },
  { kind: "appliance", series: "Email Security Appliance", field: "recommended_users", want: "req", why: "and an unshaped ESA row keeps its own" },
  { kind: "appliance", series: "Secure Malware Analytics", field: "firewall_throughput", want: "na", why: "an unshaped series asks nothing shape-specific — the safe default" },
  { kind: "appliance", series: "Secure Workload", field: "storage_capacity", want: "na", why: "a Gen3 cluster is not in a store-sized shape list" },
  { kind: "appliance", series: "A Series That Does Not Exist Yet", field: "firewall_throughput", want: "na", why: "a new series is not assumed to be a firewall" },
  { kind: "appliance", field: "firewall_throughput", want: "pending", why: "a box with NO series has an open gap, not a closed one: series is required" },

  // === A BLADE IS BOUGHT ON THE FIGURES THE DATASHEET QUOTES PER BLADE =========================
  // "SM-40 … 55 Gbps" — and 3 of the 88 security-module parts already hold those facts.
  { kind: "security-module", series: "ASA", field: "firewall_throughput", want: "req", why: "an SM-40 is quoted its own firewall throughput" },
  { kind: "security-module", series: "ASA", field: "threat_throughput", want: "req", why: "and its own threat throughput" },
  { kind: "security-module", series: "ASA", field: "concurrent_sessions", want: "req", why: "and its own session table (35 million)" },
  { kind: "security-module", series: "ASA", field: "power_max", want: "req", why: "a blade draws power and Cisco prints it" },
  { kind: "security-module", series: "ASA", field: "product_compatibility", want: "req", why: "it is bought for the chassis it fits" },
  { kind: "security-module", series: "ASA", field: "weight", want: "na", why: "but it is NOT a box: no dimensions, weight, humidity or certifications" },
  { kind: "security-module", series: "ASA", field: "ips_throughput", want: "na", why: "the inspected-throughput cup belongs to the dedicated IPS kinds" },
  { kind: "security-module", series: "ASA", field: "ports", want: "na", why: "FPR9K-SM-36 has no front ports while ASA5585-SSP-10 has eight — a cup half the kind cannot have is refused" },
  { kind: "ips-module", series: "5500-X ASA with Firepower", field: "ips_throughput", want: "req", why: "an ASA 5585-X IPS SSP is bought on inspected throughput" },
  { kind: "ips-module", series: "5500-X ASA with Firepower", field: "firewall_throughput", want: "na", why: "an IPS processor is not a firewall" },

  // === THE COMPONENTS, each asked what it is bought on and nothing else ========================
  { kind: "power", series: "4100 Firepower", field: "psu_rated_output", want: "req", why: "a supply is bought on what it delivers" },
  { kind: "power", series: "4100 Firepower", field: "input_voltage", want: "req", why: "and on which mains it takes" },
  { kind: "power", series: "4100 Firepower", field: "airflow", want: "req", why: "the same supply ships with the air going either way" },
  { kind: "power", series: "4100 Firepower", field: "product_compatibility", want: "req", why: "and for the chassis it fits" },
  { kind: "power", series: "4100 Firepower", field: "power_max", want: "na", why: "what a supply DELIVERS is psu_rated_output; power_max is what a box DRAWS (R2)" },
  { kind: "fan", series: "Firepower NGFW", field: "airflow", want: "req", why: "a fan tray is sold by its direction" },
  { kind: "fan", series: "Firepower NGFW", field: "product_compatibility", want: "req", why: "and by what it fits" },
  { kind: "fan", series: "Firepower NGFW", field: "psu_rated_output", want: "na", why: "a fan delivers no watts" },
  { kind: "drive", series: "Defense Center", field: "storage_capacity", want: "req", why: "45 of the category's 45 storage_capacity facts sit on drives" },
  { kind: "drive", series: "Defense Center", field: "product_compatibility", want: "req", why: "and a drive is bought for the appliance it goes in" },
  { kind: "cable", series: "FirePOWER 8000 Appliances", field: "cable_length", want: "req", why: "a cable is bought by its length" },
  { kind: "cable", series: "FirePOWER 8000 Appliances", field: "airflow", want: "na", why: "a cable moves no air" },
  { kind: "module", series: "4100 Firepower", field: "ports", want: "req", why: "a netmod is bought on its ports" },
  { kind: "module", series: "4100 Firepower", field: "power_max", want: "req", why: "and it draws power of its own" },
  { kind: "module", series: "4100 Firepower", field: "product_compatibility", want: "req", why: "and it fits one chassis family" },
  { kind: "module", series: "4100 Firepower", field: "firewall_throughput", want: "na", why: "a netmod is not the firewall it plugs into" },
  { kind: "compute", series: "Identity Services Engine", field: "product_compatibility", want: "req", why: "a DIMM or a RAID card is bought for what it fits — and nothing else is asked of it" },
  { kind: "compute", series: "Identity Services Engine", field: "dimensions", want: "na", why: "Cisco prints no dimensions for a riser" },
  { kind: "accessory", series: "4100 Firepower", field: "product_compatibility", want: "req", why: "a rail kit fits one chassis" },

  // === THE REFUSAL THE WHOLE AXIS EXISTS FOR ===================================================
  // FPR3K-PSU-BLANK is a blank slot cover in the "4100 Firepower" series. Every one of these was
  // `req` for it until 12 Sep 2026.
  { kind: "accessory", series: "4100 Firepower", field: "firewall_throughput", want: "na", why: "a blank slot cover has no firewall throughput" },
  { kind: "accessory", series: "4100 Firepower", field: "threat_throughput", want: "na", why: "nor a threat throughput" },
  { kind: "accessory", series: "4100 Firepower", field: "concurrent_sessions", want: "na", why: "nor a session table" },
  { kind: "accessory", series: "4100 Firepower", field: "weight", want: "na", why: "nor a published weight" },
  { kind: "accessory", series: "4100 Firepower", field: "dimensions", want: "na", why: "nor dimensions" },
  { kind: "accessory", series: "4100 Firepower", field: "temp_operating", want: "na", why: "nor an operating temperature" },
  { kind: "accessory", series: "4100 Firepower", field: "humidity_operating", want: "na", why: "nor an operating humidity" },
  { kind: "accessory", series: "4100 Firepower", field: "certifications", want: "na", why: "nor a certification list" },
  { kind: "accessory", series: "4100 Firepower", field: "power_max", want: "na", why: "nor a power draw" },
  { kind: "accessory", series: "4100 Firepower", field: "form_factor", want: "na", why: "nor a form factor" },

  // === the universal envelope holds for every BOX, including the unshaped series ===============
  { kind: "email-gateway", series: "Email Security Appliance", field: "weight", want: "req", why: "every box has a weight" },
  { kind: "firewall", series: "Secure Client (including AnyConnect)", field: "dimensions", want: "req", why: "universal: the 18 ASA VPN-edition bundles are real boxes in a software series" },
  { kind: "appliance", series: "Umbrella", field: "certifications", want: "req", why: "universal" },
  { kind: "analytics", series: "Secure Network Analytics", field: "power_max", want: "req", why: "universal" },
  { kind: "appliance", series: "A Series That Does Not Exist Yet", field: "weight", want: "req", why: "a new series is still a box" },
  { kind: "identity", series: "Identity Services Engine", field: "temp_operating", want: "req", why: "an SNS server is a box" },
  { kind: "identity", series: "Identity Services Engine", field: "concurrent_sessions", want: "na", why: "ISE's sessions are authenticated ENDPOINTS, a different quantity; max_endpoints keeps it" },

  // === the fields that are DECLARED for their shape and required of none =======================
  { kind: "management", series: "Security Manager", field: "managed_devices_max", want: "opt", why: "no enabled source publishes a label for it — declared, not required" },
  { kind: "management", series: "Firesight Management Center", field: "events_per_second", want: "opt", why: "the only eps label in the inventory is a FIREWALL row" },
  { kind: "analytics", series: "Secure Network Analytics", field: "flows_per_second", want: "opt", why: "zero labels in the inventory" },
  { kind: "identity", series: "Identity Services Engine", field: "max_endpoints", want: "opt", why: "labels exist but are ambiguous" },
  { kind: "appliance", series: "Secure DDoS Protection", field: "ddos_mitigation_throughput", want: "opt", why: "its label is shared with a firewall figure" },
];

export function run(): { passed: number; failed: number; lines: string[] } {
  const lines: string[] = [];
  let passed = 0, failed = 0;
  const check = (name: string, ok: boolean, detail = ""): void => {
    if (ok) passed++; else { failed++; lines.push(`    MISS ${name}${detail ? ": " + detail : ""}`); }
  };
  for (const c of CASES) {
    const values: Record<string, unknown> = { kind: c.kind };
    if (c.series !== undefined) values.series = c.series;
    const got = requirementFor("security", c.field, values);
    check(`${c.kind} / ${c.series ?? "(no series)"} / ${c.field} -> ${c.want}`, got === c.want,
      `got "${got}" (${c.why})`);
  }

  // --- rack_units cascades BOTH WAYS off form_factor ------------------------------------------
  // For a component form_factor is `na`, so requirementFor finds no required gate and rack_units is
  // `na` too rather than `pending` — a closed gap, correctly. For a BOX with no extracted
  // form_factor the gate is required and unanswered, so rack_units stays `pending`: an open gap
  // naming the field that would settle it. `na` on both sides is the failure.
  check("rack_units is PENDING for a box with no form factor yet",
    requirementFor("security", "rack_units", { kind: "firewall", series: "Firepower NGFW" }) === "pending");
  check("rack_units is REQ for a rack-mounted box",
    requirementFor("security", "rack_units", { kind: "firewall", series: "Firepower NGFW", form_factor: "rack-19" }) === "req");
  check("rack_units is NA for a component, not pending",
    requirementFor("security", "rack_units", { kind: "power", series: "4100 Firepower" }) === "na");

  // --- THE SABOTAGE: a missing `kind` must not silently close every question -------------------
  // This is the defect src/core/partKind.ts exists for, asserted on this category's own profile.
  // Same part, once with the kind the caller is supposed to derive and once without.
  const fw = { vendor: "cisco", series: "Firepower NGFW", form_factor: "rack-19" };
  const withKind = completenessV2("security", { ...fw, kind: "firewall" } as never);
  const without = completenessV2("security", fw as never);
  check("a firewall WITH its kind is asked the box envelope and the firewall figures",
    withKind.required_total >= 10, `required_total=${withKind.required_total}`);
  check("SABOTAGE dropping `kind` collapses the denominator — the silent failure, pinned",
    without.required_total < withKind.required_total,
    `with=${withKind.required_total} without=${without.required_total} — if these are equal the gating is gone`);
  check("and the collapse is severe enough to be worth a guard",
    withKind.required_total - without.required_total >= 8,
    `only ${withKind.required_total - without.required_total} slots differ`);

  // --- the control: every BOX kind is asked something, every COMPONENT kind less ----------------
  // A gate can switch a whole category off and look like progress. So: no box kind may be asked
  // nothing, and no component kind may be asked as much as the smallest box.
  const boxTotals = SEC_BOX.map((k) => ({ k, n: completenessV2("security", { kind: k, series: "Firepower NGFW", vendor: "cisco" } as never).required_total }));
  const compTotals = SEC_COMPONENT.map((k) => ({ k, n: completenessV2("security", { kind: k, series: "Firepower NGFW", vendor: "cisco" } as never).required_total }));
  check("every BOX kind is still asked something", boxTotals.every((b) => b.n > 0),
    boxTotals.filter((b) => b.n === 0).map((b) => b.k).join(", "));
  check("every COMPONENT kind is asked FEWER slots than the leanest box",
    Math.max(...compTotals.map((c) => c.n)) < Math.min(...boxTotals.map((b) => b.n)),
    `components ${compTotals.map((c) => `${c.k}:${c.n}`).join(" ")} · boxes ${boxTotals.map((b) => `${b.k}:${b.n}`).join(" ")}`);
  check("and every COMPONENT kind is asked at LEAST what it fits (nothing is asked nothing)",
    compTotals.every((c) => c.n > 0), compTotals.filter((c) => c.n === 0).map((c) => c.k).join(", "));

  // --- and the two real SKUs the axis was written for, end to end -------------------------------
  for (const [sku, field, want] of [
    ["FPR3K-PSU-BLANK", "firewall_throughput", "na"], ["FPR3K-PSU-BLANK", "weight", "na"],
    ["FPR3K-PSU-BLANK", "product_compatibility", "req"],
    ["FPR3105-NGFW-K9", "firewall_throughput", "req"], ["FPR3105-NGFW-K9", "weight", "req"],
  ] as [string, string, string][]) {
    const kind = partKind("security", sku);
    check(`end to end: ${sku} (kind=${kind}) / ${field} -> ${want}`,
      requirementFor("security", field, { kind, series: "4100 Firepower" }) === want);
  }

  const refusals = CASES.filter((c) => c.want === "na").length;
  lines.unshift(`    security shapes: ${passed} passed, ${failed} missed (${refusals} refusal cases of ${CASES.length})`);
  return { passed, failed, lines };
}

const r = run();
console.log(r.lines.join("\n"));
if (r.failed) process.exit(1);
