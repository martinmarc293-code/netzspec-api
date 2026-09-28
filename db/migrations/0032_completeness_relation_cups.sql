-- 0032 — completeness.relation_cups: the state of each RELATION_BACKED cup a part owes (reviewer ruling 12a, 28 Sep 2026).
-- {"product_compatibility": "filled" | "not_held", "bundle_contents": ...}. Filled = the part has >= 1 sourced relation
-- (doc_id or source_url) of the cup's kinds FROM it; not_held = it has none (an acquisition gap, out of the denominator).
-- NULL = the part owes no relation-backed cup. Written by recompute-completeness; the completeness report counts it per
-- kind so the owner sees how many components still owe their host.
ALTER TABLE completeness ADD COLUMN IF NOT EXISTS relation_cups jsonb;
