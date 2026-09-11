// tests/profileMerge.test.ts — a GENERATED requirement must not survive into a curated category.
//
// THE DEFECT THIS EXISTS FOR, 9 Sep 2026. `servers-unified-computing` was rewritten to gate every
// physical field on `kind`. Twelve fields were named in the curated block; `cpu` was not, because
// nobody was thinking about it. GENERATED_PROFILES declares it a bare `req`, the merge only fills
// keys the curated block does NOT hold — so `cpu` came through untouched and stayed required of
// 8,794 parts, cables, GPUs and rails among them.
//
// Nothing failed. The category looked fixed, the suite was green, and the leak was visible only by
// counting `required_fields` per part AFTER a recompute. That is far too late and far too manual.
//
// THE RULE. A curated category is one this file's authors wrote a profile for. Inside such a
// category, every req/cond must come from the curated block — a generated `req` is either wrong for
// the shapes the curation just defined, or it is right and should be stated there. Either way it
// must not arrive by accident.
//
// Categories with NO curated block are exempt: their profile IS the generated one, and requiring
// them to restate it would be a copy that drifts.
import { PROFILES } from "../src/core/fieldSchema.js";
import { GENERATED_PROFILES } from "../src/core/fieldSchema.generated.js";

/**
 * THE LEAKS THAT ALREADY EXIST, recorded 9 Sep 2026 so this is a RATCHET rather than a pass.
 *
 * The check found six categories carrying the same defect the moment it was written — which is the
 * check working, not noise. Each entry needs a per-category judgement (is the generated `req` right
 * for that product shape, or should the curated block scope it?) and none of them has had one.
 * Recording them keeps the suite honest about the difference between "clean" and "known dirty",
 * and the test fails if a category GAINS a leak or FIXES one without updating this table — so the
 * list can only shrink.
 */
const KNOWN_LEAKS: Record<string, string[]> = {
  video: ["standard"],
  // wireless (12 Sep 2026): `standard` is declared optional by the curated block — the leak is closed.
  "hyperconverged-systems": ["emc_emissions", "emc_immunity"],
  "hyperconverged-infrastructure": ["clock_speed", "cpu_cache", "emc_emissions", "emc_immunity"],
  "collaboration-endpoints": ["supported_protocols", "temp_storage", "ui_languages"],
  meraki: ["mounting", "psu_options", "switching_capacity"],
};

let passed = 0, failed = 0;
const lines: string[] = [];

// A category is "curated" if fieldSchema.ts names it. Read from the source rather than from a list
// here, so adding a curated category cannot forget to add it to this test.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/core/fieldSchema.ts", import.meta.url), "utf8");
const profileBlock = src.slice(src.indexOf("export const PROFILES"));
const curated = new Set<string>();
for (const m of profileBlock.matchAll(/^\s{2}"?([a-z0-9-]+)"?:\s*\{/gm)) curated.add(m[1]);

if (curated.size < 5) {
  failed++;
  lines.push(`    MISS could not find the curated category list (found ${curated.size}) — ` +
             "the parse is broken, not the schema");
} else {
  passed++;
}

for (const [cat, fields] of Object.entries(PROFILES)) {
  if (!curated.has(cat)) continue;
  const gen = GENERATED_PROFILES[cat] ?? {};
  // Which keys the curated block names, read from the source text of THAT block only.
  const start = profileBlock.indexOf(`\n  ${cat.includes("-") ? `"${cat}"` : cat}:`);
  const body = start < 0 ? "" : profileBlock.slice(start, profileBlock.indexOf("\n  },", start));
  const leaked: string[] = [];
  for (const [key, req] of Object.entries(fields)) {
    if (req.kind !== "req" && req.kind !== "cond") continue;
    const genKind = (gen as Record<string, { kind?: string }>)[key]?.kind;
    if (genKind !== "req" && genKind !== "cond") continue;   // generated does not demand it
    // It is only a leak if the CURATED block does not name the key itself.
    if (!new RegExp(`(^|[\\s,{])${key}\\s*:`, "m").test(body)) leaked.push(key);
  }
  const allowed = KNOWN_LEAKS[cat] ?? [];
  const fresh = leaked.filter((k) => !allowed.includes(k));
  const fixed = allowed.filter((k) => !leaked.includes(k));
  if (fresh.length === 0 && fixed.length === 0) passed++;
  else {
    failed++;
    if (fresh.length) {
      lines.push(`    MISS ${cat}: ${fresh.length} NEW generated requirement(s) survived the ` +
                 `curated merge unnamed — ${fresh.join(", ")}`);
      lines.push("         State them in the curated block, or the shapes you wrote do not govern " +
                 "them. This is the `cpu` defect of 9 Sep 2026, which was required of 8,794 cables.");
    }
    if (fixed.length) {
      lines.push(`    MISS ${cat}: ${fixed.join(", ")} no longer leaks — remove it from ` +
                 "KNOWN_LEAKS so the ratchet cannot slip back.");
    }
  }
}

lines.unshift(`    profile merge: ${passed} passed, ${failed} missed ` +
              `(${curated.size} curated categories checked against GENERATED_PROFILES)`);
console.log(lines.join("\n"));
if (failed) process.exit(1);
