// Provisional series -> deploy_role tables (kind-layer III.0, agent/kindlayer-A).
//   switch: Appendix A.2 of SPEC-v2.md, parsed from the file AS WRITTEN (role "?" = unresolved, hand-read pending).
//   ap / router / phone: the spec has no role column in A.3-A.5, so these are transcribed from the Part II prose
//   (II.4, II.3, II.10). confidence: "explicit" = the series is named in the prose; "heuristic" = my reading of a series
//   the prose does not name; "?" = unresolved; "moved-out" = a wrong-table move in the prose (excluded from roles).
import fs from "node:fs";

export type RoleRow = { role: string | null; confidence: string; basis: string };

export function switchTable(): Map<string, RoleRow> {
  const md = fs.readFileSync("D:/tmp/kindlayer-III0/SPEC-v2.md", "utf8").replace(/\r/g, "");
  const start = md.indexOf("## A.2");
  const end = md.indexOf("## A.3");
  const out = new Map<string, RoleRow>();
  for (const line of md.slice(start, end).split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    // | series | parts | proposed role | confidence |
    if (cells.length < 6 || cells[1] === "series" || cells[1].startsWith("---")) continue;
    const [series, , role, conf] = cells.slice(1, 5);
    out.set(series, { role: role === "?" ? null : role, confidence: role === "?" ? "?" : conf, basis: "A.2 as written" });
  }
  return out;
}

const ap: [string, string | null, string][] = [
  ["3800", "indoor", "explicit"], ["2800", "indoor", "explicit"], ["Catalyst 9100", "indoor", "explicit"],
  ["Business 100", "smb", "explicit"], ["Catalyst Embedded Controller", "indoor", "explicit"], // EWC
  ["Aironet 1850", "indoor", "explicit"], ["Aironet 1815", "indoor", "explicit"], ["Aironet 1550", "outdoor", "explicit"],
  ["Aironet 1570", "outdoor", "explicit"], ["Aironet 1830", "indoor", "explicit"], ["4800", "indoor", "heuristic"],
  ["Aironet 1560", "outdoor", "explicit"], ["IW 6300 Catalyst Heavy Duty", "industrial", "explicit"],
  ["Catalyst 9117AX", "indoor", "explicit"], ["Business 200", "smb", "explicit"], ["Aironet 1810w", "indoor", "explicit"],
  ["Aironet 1800", "indoor", "heuristic"], ["Catalyst 9105AX", "indoor", "explicit"],
  ["Business 100 Series Mesh Extenders", "mesh-extender", "explicit"], ["Aironet 1540", "outdoor", "explicit"],
  ["Aironet 1840", "indoor", "explicit"], ["Catalyst 9163", "outdoor", "explicit"], ["IW 3700 Industrial", "industrial", "explicit"],
  ["Small Business 100", "smb", "heuristic"], ["Small Business 500", "smb", "heuristic"], ["Small Business 300", "smb", "heuristic"],
  ["Catalyst 9800 Series Wireless Controllers", null, "?"], ["Aironet 1800s Active Sensor", null, "?"],
  ["Antennas/Accessories", null, "?"], ["Catalyst Center", null, "?"], ["Ultra-Reliable Wireless Backhaul", null, "?"], ["5500", null, "?"],
];

const router: [string, string | null, string][] = [
  ["800", "branch", "explicit"], ["2900 ISR", "branch", "explicit"], ["RV Series", "smb", "explicit"], ["1000", "branch", "heuristic"],
  ["ASR 1000", "edge", "explicit"], ["3900 Series Integrated Services Routers ISR", "branch", "explicit"], ["800 ISR", "branch", "explicit"],
  ["4000 ISR", "branch", "explicit"], ["1900 ISR", "branch", "explicit"], ["8100 Series Secure", "branch", "heuristic"],
  ["High-Speed WAN Interface Cards", "moved-out", "moved-out"], ["ASR 9000", "moved-out", "moved-out"], ["900 ISR", "branch", "explicit"],
  ["8000", "moved-out", "moved-out"], ["3800 Series Integrated Services Routers ISR", "branch", "heuristic"],
  ["WAN Automation Engine (WAE)", "moved-out", "moved-out"], ["5900 Embedded Services", "industrial-iot", "heuristic"],
  ["Catalyst Wireless Gateway CG113", "industrial-iot", "explicit"], ["Carrier Routing System", "moved-out", "moved-out"],
  ["1000 Connected Grid", "industrial-iot", "explicit"], ["Wireless Gateway for LoRaWAN", "industrial-iot", "explicit"],
  ["Catalyst IR1800 Rugged", "industrial-iot", "explicit"], ["2000 Series Connected Grid", "industrial-iot", "explicit"],
  ["5000 Enterprise Network Compute", "moved-out", "moved-out"], ["Catalyst 8200", "branch", "explicit"], ["500 WPAN", "industrial-iot", "explicit"],
  ["4000", "branch", "heuristic"], ["Network Modules", null, "?"], ["Catalyst 8300 Series Edge uCPE", "branch", "heuristic"],
  ["Catalyst 8300", "branch", "explicit"], ["ESR6300 Embedded", "industrial-iot", "heuristic"], ["Catalyst 8200 Edge uCPE", "branch", "heuristic"],
  ["8200 Series Secure", "branch", "heuristic"], ["Catalyst 8500L", null, "?"], ["Catalyst Cellular Gateways", "industrial-iot", "heuristic"],
  ["Catalyst IR8100 Heavy Duty", "industrial-iot", "explicit"], ["6000", null, "?"], ["Terminal Services Gateways", null, "?"],
  ["Secure Console", null, "?"], ["Cloud Native Broadband Network Gateway (BNG)", null, "?"], ["Catalyst IR1100 Rugged", "industrial-iot", "explicit"],
  ["Network Convergence System 5500 Series", "moved-out", "moved-out"], ["Catalyst 8000V Edge Software", null, "?"],
  ["8400 Series Secure", "branch", "heuristic"], ["Port Adapters", null, "?"], ["Catalyst IR8300 Rugged Series Router", "industrial-iot", "explicit"],
  ["ASR 920 Series Aggregation Services Router", null, "?"],
];

const phone: [string, string | null, string][] = [
  ["7900 - Unified IP Phone", "desk", "heuristic"], ["IP Phone 8800 Series", "desk", "heuristic"],
  ["IP Phone 8800 Series with Multiplatform Firmware", "desk", "heuristic"], ["Desk Phone 9800 Series", "desk", "heuristic"],
  ["6800 - IP Phone w/Multiplatform Firmware", "desk", "heuristic"], ["Unified IP Phone 6900 Series", "desk", "heuristic"],
  ["SPA500 IP Phones", "desk", "heuristic"], ["IP Phone 7800 Series", "desk", "heuristic"],
  ["IP DECT 6800 Series with Multiplatform Firmware", "dect", "explicit"], ["IP Phone 7800 Series with Multiplatform Firmware", "desk", "heuristic"],
  ["Wireless Phone", "wireless", "explicit"], ["SPA300 IP Phones", "desk", "heuristic"], ["Unified SIP Phone 3900 Series", "desk", "heuristic"],
  ["Room Phone", "conference", "explicit"],
];

const toMap = (rows: [string, string | null, string][], basis: string) =>
  new Map(rows.map(([s, r, c]) => [s, { role: r, confidence: c, basis } as RoleRow]));
export const AP_TABLE = toMap(ap, "II.4 prose");
export const ROUTER_TABLE = toMap(router, "II.3 prose");
export const PHONE_TABLE = toMap(phone, "II.10 prose");

/** Phone name tokens the II.10 prose names (8821/8865 wireless, 7832/8832/Room Phone conference, DECT). */
export function phoneRole(series: string | null, sku: string, name: string | null): RoleRow {
  const s = `${sku} ${name ?? ""}`;
  if (/(^|[^0-9])88(21|65)([^0-9]|$)/.test(s)) return { role: "wireless", confidence: "name-token", basis: "II.10 token 8821/8865" };
  if (/(^|[^0-9])(7832|8832)([^0-9]|$)/.test(s) || /conference/i.test(name ?? "")) return { role: "conference", confidence: "name-token", basis: "II.10 token 7832/8832" };
  if (/dect/i.test(s)) return { role: "dect", confidence: "name-token", basis: "II.10 token DECT" };
  return PHONE_TABLE.get(series ?? "") ?? { role: null, confidence: "not-in-table", basis: "series not in A.5" };
}

export function roleFor(category: string, kind: string, series: string | null, sku: string, name: string | null, sw: Map<string, RoleRow>): RoleRow | undefined {
  if (category === "switches" && kind === "switch") return sw.get(series ?? "") ?? { role: null, confidence: "not-in-table", basis: "series not in A.2" };
  if (category === "wireless" && kind === "ap") return AP_TABLE.get(series ?? "") ?? { role: null, confidence: "not-in-table", basis: "series not in A.3" };
  if (category === "routers" && kind === "enterprise") return ROUTER_TABLE.get(series ?? "") ?? { role: null, confidence: "not-in-table", basis: "series not in A.4" };
  if (category === "collaboration-endpoints" && kind === "phone") return phoneRole(series, sku, name);
  return undefined;
}
