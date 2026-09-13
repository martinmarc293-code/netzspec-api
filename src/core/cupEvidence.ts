// src/core/cupEvidence.ts — the printed-bar measurement per (category, kind, role, cup), and the FOURTH open slot state it
// licenses: MAPPER-GAP (kind layer 6b, operator ruling, 13 Sep 2026).
//
// `not_parsed` said "a spec-bearing document is linked and no fact is stored" and could not say whose problem that is. The
// printed-bar measurement can: when the held datasheets of a kind PRINT a cup (printed_pct) and the mapper does not map
// the label that prints it (mapped_pct far below), the empty slot is a mapper rule not yet written — work in
// deepSpecMap, not in extraction or acquisition. The parent writes data/reference/cup-evidence-<vendor>.json from that
// measurement; the completeness report reads it, and for a HELD part an unfilled required slot whose entry says
// `mapper-gap` counts as mapper_gap instead of not_parsed.
//
// LOOKUP ORDER: the part's own role first, then the kind level (role null). A role entry wins over a kind entry for the
// same cup, whatever its state — the more specific measurement decides.
//
// AN ENTRY THAT MATCHES NOTHING IS NOT HARMLESS. A mapper-gap entry naming a kind that no longer exists (renamed), a role
// outside the kind's domain, or a cup the kind is not asked would move nothing and read as a measurement applied —
// `inertMapperGapEntries` names them and the build refuses.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const CUP_STATES = ["required", "mapper-gap", "optional", "pending"] as const;
export type CupState = (typeof CUP_STATES)[number];
export type CupEvidenceEntry = {
  category: string; kind: string; role: string | null; cup: string; state: CupState;
  printed_pct: number | null; mapped_pct: number | null; held: number | null;
  variants: { label: string; parts: number; axis: string; provenance: string }[];
};

export const cupEvidenceFile = (vendor: string): string => path.join("data", "reference", `cup-evidence-${vendor}.json`);

/** Shape errors, one line each. An empty array is a valid file (no measurement yet), and the report says so. */
export function validateCupEvidence(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["the file is not a JSON array"];
  const errs: string[] = [];
  const seen = new Map<string, string>();
  raw.forEach((e, i) => {
    const at = `entry ${i}`;
    if (!e || typeof e !== "object") { errs.push(`${at}: not an object`); return; }
    const o = e as Record<string, unknown>;
    for (const f of ["category", "kind", "cup"]) if (typeof o[f] !== "string" || !(o[f] as string)) errs.push(`${at}: ${f} must be a non-empty string`);
    if (!(o.role === null || typeof o.role === "string")) errs.push(`${at}: role must be a string or null`);
    if (!CUP_STATES.includes(o.state as CupState)) errs.push(`${at}: state ${JSON.stringify(o.state)} is not one of ${CUP_STATES.join(", ")}`);
    if (o.variants !== undefined && !Array.isArray(o.variants)) errs.push(`${at}: variants must be an array`);
    const key = `${String(o.category)}|${String(o.kind)}|${String(o.role)}|${String(o.cup)}`;
    const prev = seen.get(key);
    if (prev !== undefined && prev !== o.state) errs.push(`${at}: ${key} is listed twice with different states (${prev}, ${String(o.state)})`);
    seen.set(key, String(o.state));
  });
  return errs;
}

export type LoadedCupEvidence = { file: string; sha256: string; entries: CupEvidenceEntry[] };

/** Read and validate. A missing file THROWS: a report that silently found no measurement would print mapper_gap 0
 *  everywhere, which reads exactly like "the mapper has no gaps". Write `[]` to build without one, and it is said. */
export function loadCupEvidence(repoRoot: string, vendor: string): LoadedCupEvidence {
  const rel = cupEvidenceFile(vendor);
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) throw new Error(`REFUSED: ${rel} does not exist — the parent writes it from the printed measurement (write [] to build with no mapper-gap entries, which the report then states)`);
  const text = fs.readFileSync(abs, "utf8");
  const raw = JSON.parse(text) as unknown;
  const errs = validateCupEvidence(raw);
  if (errs.length) throw new Error(`REFUSED: ${rel} is malformed: ${errs.slice(0, 10).join("; ")}${errs.length > 10 ? ` … and ${errs.length - 10} more` : ""}`);
  return { file: rel, sha256: crypto.createHash("sha256").update(text).digest("hex"), entries: raw as CupEvidenceEntry[] };
}

/** (category, kind, role, cup) -> state, role-level first, then kind-level. */
export function cupStateIndex(entries: readonly CupEvidenceEntry[]): (category: string, kind: string, role: string | null, cup: string) => CupState | undefined {
  const m = new Map<string, CupState>();
  for (const e of entries) m.set(`${e.category}|${e.kind}|${e.role ?? ""}|${e.cup}`, e.state);
  return (category, kind, role, cup) =>
    (role ? m.get(`${category}|${kind}|${role}|${cup}`) : undefined) ?? m.get(`${category}|${kind}||${cup}`);
}

/**
 * Mapper-gap entries that would move nothing. `askedOf(category, kind, role)` returns the cups (required ∪ pending) that
 * kind/role is asked, or null when the kind does not exist or the role is outside its domain.
 */
export function inertMapperGapEntries(entries: readonly CupEvidenceEntry[],
  askedOf: (category: string, kind: string, role: string | null) => ReadonlySet<string> | null): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.state !== "mapper-gap") continue;
    const label = `${e.category}.${e.kind}${e.role ? `[${e.role}]` : ""}.${e.cup}`;
    const asked = askedOf(e.category, e.kind, e.role);
    if (asked === null) out.push(`${label}: no such kind${e.role ? " or role" : ""} in the arrangement`);
    else if (!asked.has(e.cup)) out.push(`${label}: the ${e.role ? "role" : "kind"} is not asked this cup (required or pending)`);
  }
  return out;
}
