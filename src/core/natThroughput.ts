// src/core/natThroughput.ts — where a printed "NAT throughput" row may land. OPERATOR RULING, 13 Sep 2026.
//
// THE MEASUREMENT BEHIND IT (kind-layer III.0 item 1, re-read in D:\tmp\kindlayer-impl\2-routers): the Small Business RV
// data sheets print their throughput ONLY as "Performance: NAT throughput" / "NAT throughput" (RV160, RV260, RV340 …),
// never as the aggregate forwarding row the other router sheets print ("IPv4 Forwarding Throughput (1400Bytes)",
// "Aggregate Throughput (Default)", "Forwarding (512B)"). A NAT throughput is a FEATURE throughput: on a sheet that prints
// both, the two are different numbers, and storing NAT under `router_throughput` there would put the lower figure into
// the aggregate cup. So the ruling is scoped three ways, and all three live here so one function answers for every
// pipeline that maps a label WITH the part in hand (apply-extract, apply-acquired):
//
//   1. the document also prints a forwarding / aggregate throughput row (anything mapLabel sends to router_throughput,
//      or "Platform performance") -> THAT row wins; the NAT row is not stored under router_throughput (-> __backlog)
//   2. the part is a `router` in deploy_role `smb` -> NAT throughput IS router_throughput (the raw label is kept in the
//      fact's raw "<label> | <cell>", so provenance still says which row it came from)
//   3. anything else (branch / edge / industrial-iot routers, other categories) -> __backlog, a named gap
//
// NOT A GLOBAL ALIAS, deliberately: an alias rule in data/schema would fire for every router and every category, which
// is exactly the ISR-1100-prints-both case the ruling excludes. The mapper keeps returning null for the label; only a
// caller that knows the part may lift it.
import { partKind } from "./partKind.js";
import { deployRole } from "./deployRole.js";
import { mapLabel } from "./deepSpecMap.js";

/** "NAT throughput", "Performance: NAT throughput", "Maximum NAT throughput", "NAT throughput (Mbps)". Anchored at both
 *  ends: "NAT throughput with IPS" or "IPsec VPN throughput" are other rows. */
export const NAT_THROUGHPUT_LABEL = /^\s*(?:performance\s*:\s*)?(?:max(?:imum)?\.?\s+)?nat\s+throughput(?:\s*\([^)]*\))?\s*$/i;

/** A forwarding / aggregate row the mapper does not map yet but the ruling names. */
const PLATFORM_PERFORMANCE = /^\s*(?:performance\s*:\s*)?platform\s+performance\s*$/i;

/** The label a smb NAT row borrows so the SAME normaliser path reads its value (mapLabel("Throughput", "routers")). */
export const NAT_AS_ROUTER_THROUGHPUT_LABEL = "Throughput";

export function isNatThroughputLabel(label: string): boolean {
  return NAT_THROUGHPUT_LABEL.test(String(label ?? ""));
}

/** The first label on the document that is a forwarding / aggregate throughput row, or null. */
export function forwardingThroughputRow(labels: Iterable<string>, category: string): string | null {
  for (const l of labels) {
    if (isNatThroughputLabel(l)) continue;
    if (PLATFORM_PERFORMANCE.test(l) || mapLabel(l, category) === "router_throughput") return l;
  }
  return null;
}

export type NatDecision =
  | { use: true; key: "router_throughput"; why: "smb" }
  | { use: false; sentinel: "__backlog"; why: "superseded" | "outside-smb"; by?: string };

export function natThroughputDecision(input: { category: string; sku: string; name?: string | null; docLabels: Iterable<string> }): NatDecision {
  const winner = forwardingThroughputRow(input.docLabels, input.category);
  if (winner) return { use: false, sentinel: "__backlog", why: "superseded", by: winner };
  const kind = partKind(input.category, input.sku, input.name ?? undefined);
  if (input.category === "routers" && kind === "router" && deployRole(input.category, kind, input.sku, input.name) === "smb") {
    return { use: true, key: "router_throughput", why: "smb" };
  }
  return { use: false, sentinel: "__backlog", why: "outside-smb" };
}
