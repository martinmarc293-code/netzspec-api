// src/core/seriesHints.ts — what happens to a live `series` FACT (a column-backed key), per the reviewer's rulings of
// 28 Sep 2026 (docs/decisions/2026-09-28-series-hints-decomposed.md; docs/reviewer/2026-09-28/state.md):
//   5a  a licence/software part naming its platform -> relation license_for (licence -> platform), then retract
//   5b  a chassis whose series column already lists it -> retract (a coarser restatement: duplicate by membership)
//       a module/PSU/accessory naming its host chassis -> relation compatible (part -> chassis), then retract
//   anything else PARKS, counted with its reason and never guessed.

export type SeriesHintRow = {
  value: string; productClass: string | null; kind: string | null; series: string | null; productSeries: string | null;
};
export type SeriesHintVerdict =
  | { bucket: "licence-platform" | "host-chassis"; action: "relate+retract"; relation: { kind: "license_for" | "compatible"; to: string } }
  | { bucket: "chassis-member" | "umbrella"; action: "retract" }
  | { bucket: "park"; action: "park"; why: string };

/** The kinds that ARE a chassis; every other hardware kind is something that goes into or onto one. */
export const CHASSIS_KINDS = new Set(["fc-switch", "director"]);
const MDS = /^(?:cisco\s+)?mds\s*(9[0-9]{3}[a-z]*)$/i;

/** "MDS9300" -> "MDS 9300", "Cisco MDS 9000" -> "MDS 9000"; null when the value is not an MDS platform name. */
export function mdsPlatform(v: string): string | null {
  const m = MDS.exec(v.trim());
  return m ? `MDS ${m[1]}` : null;
}

/** The models a column lists in parentheses: "MDS 9100 fabric switches (9124 / 9132T / 9134)" -> 9124, 9132t, 9134. */
export function listedModels(col: string | null): string[] {
  const m = /\(([^)]*)\)/.exec(col ?? "");
  return m ? m[1].split("/").map((x) => x.trim().toLowerCase()).filter(Boolean) : [];
}

export function classifySeriesHint(r: SeriesHintRow): SeriesHintVerdict {
  const platform = mdsPlatform(r.value);
  if (r.productClass === "license" || r.productClass === "software") {
    return platform
      ? { bucket: "licence-platform", action: "relate+retract", relation: { kind: "license_for", to: platform } }
      : { bucket: "park", action: "park", why: "licence/software fact naming no MDS platform" };
  }
  if (r.productClass !== "hardware") return { bucket: "park", action: "park", why: `product_class ${r.productClass ?? "null"}` };
  if (!r.kind || r.kind === "unknown") return { bucket: "park", action: "park", why: "hardware with no kind: chassis or not is unknown" };
  const model = platform ? platform.slice(4).toLowerCase() : null;
  // 5c: the MDS 9000 umbrella is coarser than a column that already names an MDS series -> retract.
  if (model === "9000" && [r.series, r.productSeries].some((c) => /^mds 9/i.test(c ?? "")))
    return { bucket: "umbrella", action: "retract" };
  // 5c: a non-chassis part naming a router series it plugs into -> relation compatible, verbatim target.
  if (!platform && !CHASSIS_KINDS.has(r.kind) && /series routers$/i.test(r.value.trim()))
    return { bucket: "host-chassis", action: "relate+retract", relation: { kind: "compatible", to: r.value.trim() } };
  if (CHASSIS_KINDS.has(r.kind)) {
    const listed = [...listedModels(r.series), ...listedModels(r.productSeries)];
    return model && listed.includes(model)
      ? { bucket: "chassis-member", action: "retract" }
      : { bucket: "park", action: "park", why: "a chassis its series column does not list" };
  }
  if (platform && model !== "9000")
    return { bucket: "host-chassis", action: "relate+retract", relation: { kind: "compatible", to: platform } };
  return { bucket: "park", action: "park", why: platform ? "names only the MDS 9000 umbrella" : "names no MDS platform" };
}
