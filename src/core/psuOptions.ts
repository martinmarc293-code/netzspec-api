// src/core/psuOptions.ts — what a stored `psu_options` value says, if anything: the conversion half of retiring the key.
//
// Reviewer ruling, Batch C 29 Sep 2026: "psu_options -> retire, superseded by psu_config + psu_count; Cisco converts its 417
// where parseable, retracts the prose". Measured 29 Sep: 276 distinct values over 417 Cisco facts, and almost none of them is
// a configuration -- PSU SKU lists ("1100W AC", "PWR-C1-1100WAC-P"), wattages, efficiencies ("94% (Typ)"), cords, fans,
// a weight ("1.16 kg"), input specs ("12V/1A"). So this is STRICT: a value converts only when EVERY element is an explicit
// configuration phrase and they agree; anything else is prose to retract. Pure, so the whole corpus can be read before a run.
export type PsuConfig = "fixed-internal" | "modular-single" | "modular-redundant" | "external";
export type PsuVerdict =
  | { action: "convert"; config: PsuConfig; count?: number; why: string }
  | { action: "retract"; why: string };

const FIXED = /^(?:fixed[\s-]*internal|internal(?:\s+power\s+supply)?|built[\s-]*in)$/i;
const EXTERNAL = /^external(?:\s+(?:ac\s+)?power\s+(?:supply|adapter))?$/i;
/** An optional external RPS says nothing about the unit's own supply: neutral, never a config on its own. */
const RPS_OPTIONAL = /^external\s+rps\*?\s*\(optional\)$/i;
const REDUNDANT_N = /^([1-9])\s*\(\s*1\s*\+\s*1\s+redundancy\s*\)$/i;
const HOTSWAP_N = /^([1-9])\s+hot-swappable\s+.*power\s+supplies\s+provide\s+1\s*\+\s*1\s+redundancy/i;

export function classifyPsuOptions(value: unknown): PsuVerdict {
  const els = (Array.isArray(value) ? value : [value]).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (!els.length) return { action: "retract", why: "empty" };
  const configs = new Set<PsuConfig>(); let count: number | undefined;
  for (const e of els) {
    if (RPS_OPTIONAL.test(e)) continue;
    if (FIXED.test(e)) { configs.add("fixed-internal"); continue; }
    if (EXTERNAL.test(e)) { configs.add("external"); continue; }
    const r = REDUNDANT_N.exec(e) ?? HOTSWAP_N.exec(e);
    if (r) { configs.add("modular-redundant"); const n = Number(r[1]); if (count !== undefined && count !== n) return { action: "retract", why: `two counts (${count}, ${n})` }; count = n; continue; }
    return { action: "retract", why: `not a configuration: "${e.slice(0, 60)}"` };
  }
  if (configs.size === 0) return { action: "retract", why: "only an optional RPS: says nothing about the unit's own supply" };
  if (configs.size > 1) return { action: "retract", why: `configurations disagree (${[...configs].join(", ")})` };
  const config = [...configs][0];
  return { action: "convert", config, ...(count !== undefined ? { count } : {}), why: els.join(" | ") };
}
