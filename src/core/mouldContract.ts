// src/core/mouldContract.ts — THE ONE computation of the mould contract and its hash (moved verbatim out of
// scripts/mould-contract.mts, 29 Sep 2026). The script writes it to src/core/mould-contract.json; mould-verify's one_build
// compares the artefacts' stamped hash with it. The contract had drifted since 28 Sep (608 -> 610 dictionary keys, the
// ports role, the Batch C profiles) while one_build reported ONE build, because it only asked whether the artefacts agreed
// with EACH OTHER, never with the mould the code now states.
import crypto from "node:crypto";
import { FIELD_DICTIONARY, PROFILES, COLUMN_BACKED, FREE_TEXT_BY_DECISION } from "./fieldSchema.js";
import { LIST_SHAPES, shapeIsDefinition } from "./listShapes.js";
import { NO_PROFILE_REASONS } from "./noProfileReason.js";

/** A stable stringify: object keys sorted at every depth, so the hash is about CONTENT and never about
 *  the order a JavaScript engine happened to enumerate. Without this the hash changes when nothing has,
 *  which is the fastest way to teach everyone to ignore it. */
export function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, stable(o[k])]));
  }
  return v;
}

export function mouldContract() {
  // ---- the mould, stated ---------------------------------------------------------------------------
  // Each entry answers one question a consumer would otherwise have to guess by reading the code.
  const contract = {
    // WHAT A CUP IS: its type, unit, band, domain and shape. Only the parts that DEFINE it -- labels and
    // translations are presentation and would churn the hash for no gain.
    dictionary: Object.fromEntries(Object.entries(FIELD_DICTIONARY).map(([k, d]) => {
      const e = d as { type?: string; unit?: string | null; band?: unknown; domain?: unknown; shape?: unknown };
      return [k, { type: e.type, unit: e.unit ?? null, band: e.band ?? null,
                   domain: Array.isArray(e.domain) ? [...e.domain].sort() : null, shape: e.shape ?? null }];
    })),

    // WHAT EACH CATEGORY ASKS: the requirement kind per cup. The conditions themselves are part of the
    // meaning, so a `cond` records its gate rather than collapsing to the word "cond".
    profiles: Object.fromEntries(Object.entries(PROFILES).map(([cat, p]) => [
      cat, Object.fromEntries(Object.entries(p as Record<string, unknown>).map(([k, r]) => [k, stable(r)])),
    ])),

    // THE CUPS NOTHING CAN REFUSE, and the reason each one is allowed to be that way. A consumer reading
    // a free-text cup should be able to see that it was a decision and where it is written down.
    free_text_by_decision: FREE_TEXT_BY_DECISION,

    // A LIST CUP DEFINED BY A GRAMMAR RATHER THAN A VOCABULARY, with the proof that the grammar can
    // refuse -- a shape that refuses nothing is not a definition, and the hash should say which is which.
    list_shapes: Object.fromEntries(Object.keys(LIST_SHAPES).map((k) => {
      const s = LIST_SHAPES[k];
      return [k, { accept: s.accept.source, flagged: s.flagged.source, refuse: s.refuse.source,
                   is_definition: shapeIsDefinition(k).ok,
                   fixtures: { accept: s.fixtures.accept.length, refuse: s.fixtures.refuse.length, flagged: s.fixtures.flagged.length } }];
    })),

    // CUPS THAT ARE COLUMNS, not facts. A fact under one of these is a defect by construction, so the
    // list belongs in the contract rather than in three separate readers' heads.
    column_backed: [...COLUMN_BACKED].sort(),

    // WHY A PART MIGHT CARRY NO SCORE AT ALL. Four reasons, and a row with none of them is unexplained.
    no_profile_reasons: [...NO_PROFILE_REASONS].sort(),

    // WHAT COUNTS AS A DOCUMENT THAT CAN FILL A CUP. Measured, not assumed: an End-of-Life bulletin binds
    // many SKUs and carries 4.9 facts/doc against an HTML datasheet's 49.7, so it is not spec-bearing
    // however many parts it names.
    spec_bearing_doc_types: ["vendor_datasheet_html", "vendor_datasheet_pdf", "vendor_tool"],

    // WHAT "FILLED" MEANS. Four conditions, and the states a slot lands in when it misses one. Today only
    // 8,007 of 102,743 live facts satisfy all four, which is why this belongs in the contract and not in
    // a comment.
    slot_states: ["filled", "filled_inherited", "unverified_seed", "mined_from_eol", "mined_non_spec_doc",
                  "method_not_a_read", "no_document", "held_not_parsed", "not_held", "pending", "defect"],
    filled_requires: { own: true, spec_bearing_doc: true, method_read_the_artefact: true, no_open_conflict: true },

    // THE CAPS, because they decide what a stored value IS. Contract-coupled to gate-extract's
    // cellMatches: move one, move both.
    value_caps: { scalar: 160, list: 6000, joined: 6000, historical: [160, 800, 6000] },
  };

  const body = JSON.stringify(stable(contract));
  const contract_hash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
  return { contract, contract_hash };
}
