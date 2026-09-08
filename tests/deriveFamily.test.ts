// tests/deriveFamily.test.ts — the model level, and the merges it must REFUSE.
//
// `modelOf` strips the ordering suffix off a SKU so the orderable variants of one physical product
// share a family. The failure that matters is the greedy one: a rule that strips too much merges
// two different products into one model, and downstream that is indistinguishable from a correct
// grouping. So most of the cases below are refusals.
//
// The one that nearly shipped: on a switch a trailing -A/-E/-L/-S is a software or regulatory
// tier, and on an optic it is the REACH — SFP-GE-T is copper, -S short reach, -L long, -Z
// extended. Same letters, opposite meaning. It was caught by reading the merges the rule made
// against the live corpus, not by any count: the counts looked healthy in every arm.
import { modelOf } from "../scripts/derive-family.js";

type Case = { sku: string; cat: string; want: string; why: string };

const CASES: Case[] = [
  // --- the merges it MUST make ---
  { sku: "C9500-12Q-A", cat: "switches", want: "C9500-12Q", why: "Advantage tier is an ordering choice" },
  { sku: "C9500-12Q-E=", cat: "switches", want: "C9500-12Q", why: "Essentials tier AND spare, both stripped" },
  { sku: "WS-F6K-DFC4-A++=", cat: "switches", want: "WS-F6K-DFC4", why: "tier, upgrade and spare together" },
  { sku: "C9130AXI-T", cat: "wireless", want: "C9130AXI", why: "-T is the Taiwan regulatory domain" },
  { sku: "C9300-48P=", cat: "switches", want: "C9300-48P", why: "a spare is the same hardware" },
  { sku: "UCSC-C240-M5SX-RF", cat: "servers-unified-computing", want: "UCSC-C240-M5SX", why: "remanufactured" },
  { sku: "c9300-24t", cat: "switches", want: "C9300-24T", why: "case is normalised, not a difference" },

  // --- the merges it MUST REFUSE ---
  { sku: "SFP-GE-T", cat: "transceiver", want: "SFP-GE-T", why: "REACH code: copper, not a tier" },
  { sku: "SFP-GE-S", cat: "transceiver", want: "SFP-GE-S", why: "short reach is a different optic from -T" },
  { sku: "SFP-GE-L", cat: "transceiver", want: "SFP-GE-L", why: "long reach is a different optic again" },
  { sku: "GLC-TE", cat: "transceiver", want: "GLC-TE", why: "no suffix at all; -TE is part of the name" },
  { sku: "X2-10GB-LR", cat: "interfaces-modules", want: "X2-10GB-LR", why: "optics keep the whole SKU" },
  { sku: "ONS-SC+-10G-C", cat: "optical-networking", want: "ONS-SC+-10G-C", why: "optical, so -C survives" },
  { sku: "NIM-2T", cat: "routers", want: "NIM-2T", why: "the T is glued to the 2: no hyphen, no strip" },
  { sku: "C9300-24T", cat: "switches", want: "C9300-24T", why: "24T is a port count, not a tier" },
  { sku: "C9300-48P", cat: "switches", want: "C9300-48P", why: "48P is a port count, not the P tier" },
  { sku: "AIR-AP1815W-B-K9", cat: "wireless", want: "AIR-AP1815W-B", why: "only the LAST token goes" },

  // --- it must never produce an empty family, which would collect unrelated parts into one group
  { sku: "=", cat: "switches", want: "=", why: "a strip that ate the whole SKU keeps the SKU" },
  { sku: "-A", cat: "switches", want: "-A", why: "likewise: never an empty group key" },
];

export function run(): { passed: number; failed: number; lines: string[] } {
  const lines: string[] = [];
  let passed = 0, failed = 0;
  for (const c of CASES) {
    const got = modelOf(c.sku, c.cat);
    if (got === c.want) passed++;
    else { failed++; lines.push(`    MISS ${c.sku} [${c.cat}] -> "${got}", wanted "${c.want}" (${c.why})`); }
  }

  // The guard is CATEGORY-driven, so prove it both ways: the same string must strip outside
  // optics and survive inside. Asserting only the refusal would pass a rule that never strips.
  const inOptics = modelOf("SFP-GE-T", "transceiver");
  const outside = modelOf("SFP-GE-T", "switches");
  if (inOptics === "SFP-GE-T" && outside === "SFP-GE") passed++;
  else {
    failed++;
    lines.push(`    MISS the tier guard is not category-driven: optics="${inOptics}" ` +
               `switches="${outside}" — one of the two branches is dead`);
  }

  // And a merge must be reachable: if nothing in a realistic tier set collapses, the rule is off.
  const tiers = ["C9500-12Q", "C9500-12Q-A", "C9500-12Q-A=", "C9500-12Q-E", "C9500-12Q-E="];
  const collapsed = new Set(tiers.map((s) => modelOf(s, "switches")));
  if (collapsed.size === 1) passed++;
  else { failed++; lines.push(`    MISS five orderables of C9500-12Q gave ${collapsed.size} models`); }

  lines.unshift(`    derive-family: ${passed} passed, ${failed} missed ` +
                `(${CASES.filter((c) => c.sku.toUpperCase() === c.want).length} refusal cases)`);
  return { passed, failed, lines };
}

const r = run();
console.log(r.lines.join("\n"));
if (r.failed) process.exit(1);
