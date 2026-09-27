// src/core/provenance.ts — A PROVENANCE STAMP IS NOT CONTENT.
//
// scripts/mould-stamp.mts writes one object onto every committed artefact:
//
//     "build": { "data_commit": …, "code_commit": …, "contract_hash": …, "generated_at": … }
//
// It says WHEN a file was made and FROM WHAT. It says nothing about what the file claims, so anything that
// hashes, diffs or compares an artefact FOR ITS CONTENT must drop it first. Three consumers found that out
// separately on 27 Sep 2026, each one a silent failure of a different shape, and none of them would have led
// anyone to the other two:
//
//   1. scripts/check-layer-site.mts  compared a freshly built page summary with the committed one and ignored
//      only built_at / commit / uncommitted_rule_files. A fresh build can never carry a stamp, so from the
//      moment the stamp shipped this REFUSED EVERY PUBLISH — all 17 categories, with the summaries
//      byte-identical once the build fields were stripped.
//   2. src/core/arrangementFreeze.ts  hashed the RAW TEXT of data/schema/attribute-aliases.en.json, which the
//      stamp writes into. A stamp moved alias_file_sha, which moved the freeze hash, which required a
//      regenerated freeze — which the next stamp moved again. NO FIXED POINT: the suite could be made green
//      only until the next stamp.
//   3. scripts/build-completeness.mts reads committed ledgers for its denominators. It takes named numbers
//      rather than hashing the file, so it was never bitten — which is luck, not design, and exactly why this
//      module exists rather than a third local fix.
//
// The reviewer's instruction, and it is the right generalisation: "three consumers in one evening is the shape
// of a fourth waiting." So the rule lives here, once, and every consumer imports it.

/** The key the stamp writes. One name, in one place, so a rename cannot leave a consumer behind. */
export const PROVENANCE_KEY = "build" as const;

/**
 * The fields that say WHEN and FROM WHAT rather than WHAT — the stamp plus the older per-builder provenance
 * that predates it. A comparison of two artefacts for their CONTENT drops all of these.
 *
 * `uncommitted_rule_files` belongs here for a subtler reason than the rest: it records the dirty files a build
 * ran with, so it is a fact about the BUILD and differs between a laptop build and a box build of the same
 * commit — which is the pair this repo compares most often.
 */
export const PROVENANCE_FIELDS: readonly string[] = [
  PROVENANCE_KEY, "built_at", "commit", "uncommitted_rule_files", "generated_at", "built_on_commit",
];

/**
 * The same object without its provenance. Shallow on purpose: a stamp is written at the TOP LEVEL of an
 * artefact, and stripping recursively would also remove a nested `commit` or `generated_at` that is part of
 * what the file is asserting — a ledger's `kind_layer_plans[].run_id` era, a report's per-category
 * `generated_at`. Removing more than the stamp is the same class of error as removing less.
 */
export function withoutProvenance<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!PROVENANCE_FIELDS.includes(k)) out[k] = v;
  return out as Partial<T>;
}

/**
 * A JSON artefact's CONTENT as a stable string, for hashing or comparing. Parses, drops the provenance, and
 * serialises with sorted keys so a reformat or a key reorder cannot move the result.
 *
 * NOT JSON? Hash what is there. A file this is pointed at and cannot parse is a fact worth failing on
 * elsewhere, but silently hashing nothing — or throwing inside a hash function — is worse than hashing the
 * bytes: the caller gets a value that still changes when the file changes, which is the property it wanted.
 */
export function contentOf(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return stableStringify(parsed);
    return stableStringify(withoutProvenance(parsed as Record<string, unknown>));
  } catch {
    return text;
  }
}

/** Deterministic JSON: object keys sorted at every level, arrays left in order (their order IS content). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
