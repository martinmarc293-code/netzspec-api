// src/core/arrangementFreeze.ts — the phase-1 freeze: everything the filling phase measures against, pinned as
// ONE unit (docs/reports/phase1-close-guide-2026-09-13.md §4).
//
// WHY ONE UNIT. A completeness percentage is a ratio over a table: which parts exist in which kind, which cups each
// kind is asked, what each cup accepts, where each label pours, which derivations count as taps, which document
// classes count as held. If any of those moves silently, today's 31% and tomorrow's 33% are measured over two
// different tables and the difference means nothing. So the pieces are hashed together; the freeze hash is printed
// by the completeness report, and tests/arrangementFreeze.test.ts fails when the code no longer reproduces the
// committed data/freeze/<vendor>.json. Changing the arrangement is allowed — as a recorded decision that rebuilds
// the freeze file on the same commit (CLAUDE.md "The arrangement is frozen").
//
// PURE over code and committed files, so the test needs no database. The one input that needs the store — which
// live hardware parts exist, with their names — is captured by the builder as a snapshot file
// (data/freeze/<vendor>-kinds.tsv), and the test re-derives every kind from it with the live classifier.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { profileHash, LEDGER_KINDS } from "./cupLedger.js";
import { FIELD_DICTIONARY, SUPERSEDED_KEYS } from "./fieldSchema.js";
import { SPEC_BEARING } from "./docClass.js";
import { DERIVED_FILL_PATHS } from "./derivedFillPaths.js";
import { partKind } from "./partKind.js";

export const sha = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

/** Stable JSON: object keys sorted at every level, so a hash does not depend on insertion order. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export type KindRow = { category: string; sku: string; name: string; kind: string };

/** The snapshot's line format. Tabs and newlines inside a name are flattened to spaces, deliberately and visibly. */
export const kindLine = (r: KindRow): string =>
  [r.category, r.sku, r.name.replace(/[\t\r\n]+/g, " "), r.kind].join("\t");

export function parseKindSnapshot(text: string): KindRow[] {
  return text.split("\n").filter((l) => l.length > 0).map((l) => {
    const [category, sku, name, kind] = l.split("\t");
    return { category, sku, name, kind };
  });
}

/** The conflict table as frozen in tests/mapperTrace.test.ts: the text of its object literal, whitespace-normalised. */
export function conflictTableText(repoRoot: string): string {
  const src = fs.readFileSync(path.join(repoRoot, "tests", "mapperTrace.test.ts"), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("const KNOWN_CUP_CONFLICTS");
  if (start < 0) throw new Error("freeze: KNOWN_CUP_CONFLICTS not found in tests/mapperTrace.test.ts");
  const end = src.indexOf("\n};", start);
  // Entries only — comments are the table's prose and may be reworded without moving the arrangement.
  return src.slice(start, end).split("\n").map((l) => l.replace(/\/\/.*$/, "").trim()).filter((l) => l.startsWith('"')).sort().join("\n");
}

export type FreezeUnits = {
  vendor: string;
  profiles: Record<string, string>;
  dictionary: { keys: number; sha: string };
  kinds: { parts: number; by_category: Record<string, number>; mapping_sha: string };
  mapper: { alias_file_sha: string; conflicts: number; conflicts_sha: string };
  derived_fill_paths: { keys: string[]; sha: string };
  spec_bearing_classes: { classes: string[]; sha: string };
  denominators: Record<string, { parts: number; required_slots_stored: number }>;
};

/** Every unit, from code + committed files + the kind snapshot rows. */
export function freezeUnits(vendor: string, repoRoot: string, kindRows: KindRow[]): FreezeUnits {
  const cats = Object.keys(LEDGER_KINDS).sort();
  const profiles = Object.fromEntries(cats.map((c) => [c, profileHash(c)]));

  const dict = Object.keys(FIELD_DICTIONARY).sort().map((k) => {
    const d = FIELD_DICTIONARY[k] as { type: string; unit?: string; domain?: unknown; band?: unknown; shape?: string };
    return { key: k, type: d.type, unit: d.unit ?? null, domain: d.domain ?? null, band: d.band ?? null, shape: d.shape ?? null, superseded_by: SUPERSEDED_KEYS[k] ?? null };
  });

  const byCat: Record<string, number> = {};
  for (const r of kindRows) byCat[r.category] = (byCat[r.category] ?? 0) + 1;

  const aliasText = fs.readFileSync(path.join(repoRoot, "data", "schema", "attribute-aliases.en.json"), "utf8").replace(/\r\n/g, "\n");
  const conflicts = conflictTableText(repoRoot);

  const denominators: FreezeUnits["denominators"] = {};
  for (const c of cats) {
    const f = path.join(repoRoot, "data", "ledger", `${vendor}-${c}.json`);
    if (!fs.existsSync(f)) continue;
    const l = JSON.parse(fs.readFileSync(f, "utf8")) as { totals: { parts: number; required_slots_stored: number } };
    denominators[c] = { parts: l.totals.parts, required_slots_stored: l.totals.required_slots_stored };
  }

  const classes = [...SPEC_BEARING].map(String).sort();
  return {
    vendor,
    profiles,
    dictionary: { keys: dict.length, sha: sha(stable(dict)) },
    kinds: { parts: kindRows.length, by_category: byCat, mapping_sha: sha(kindRows.map(kindLine).join("\n")) },
    mapper: { alias_file_sha: sha(aliasText), conflicts: conflicts.split("\n").filter(Boolean).length, conflicts_sha: sha(conflicts) },
    derived_fill_paths: { keys: Object.keys(DERIVED_FILL_PATHS).sort(), sha: sha(stable(DERIVED_FILL_PATHS)) },
    spec_bearing_classes: { classes, sha: sha(classes.join(",")) },
    denominators,
  };
}

export const freezeHash = (u: FreezeUnits): string => sha(stable(u));

/** Re-derive every kind in a snapshot with the live classifier; returns the rows whose kind moved. */
export function kindDrift(rows: KindRow[]): { row: KindRow; now: string }[] {
  const out: { row: KindRow; now: string }[] = [];
  for (const r of rows) {
    const now = partKind(r.category, r.sku, r.name || undefined) ?? "(none)";
    if (now !== r.kind) out.push({ row: r, now });
  }
  return out;
}
