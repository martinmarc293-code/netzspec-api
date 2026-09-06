// src/pipeline/apply-acquired.ts — acquired page results -> facts, inside a gated run.
//
//   ingest apply-acquired runs/acquired/provantage/2026-09-03 [more dirs or files] [--commit] [--vendor cisco] [--sample 60]
//
// The worker (scraper/worker.py) leaves one JSON per fetched page under runs/acquired/. Each
// holds RAW label/value strings. This command is where meaning is decided, and only here:
//   label -> field key        src/core/deepSpecMap.ts (alias rules in data/schema)
//   string -> typed value     src/core/specNormalize.ts (refuses rather than guesses)
//   value vs existing value   src/core/specMerge.ts through src/store/facts.ts (tiers, conflicts)
//
// A fact from an aggregator or distributor (tier 3/4) lands as `unverified`; it can corroborate a
// vendor fact or fill a labelled gap, never establish a verified one (docs/ARCHITECTURE.md).
//
// THE GATE. A run that writes facts must carry a passing gate (src/store/runs.ts refuses to close
// it otherwise). For acquired pages the gate has two halves:
//   recall     the source's adapter suite (tests/scraper/test_<source>.py) is run fresh; it asserts
//              exact label/value pairs on the fixtures, so a broken adapter cannot land data;
//   precision  a random sample of the facts written in THIS run is re-read from the cached page:
//              the raw value string and the label must both be present in the page text.
// Both are reported; passed = precision >= 0.98 and the suite is green.
//
// WHEN THE GATE IS COMPUTED, AND WHY IT MATTERS. Until 4 Sep 2026 the gate was computed at the END
// of the body, after every row had been written, and only facts/evidence/conflicts were rolled back
// when the run failed (src/store/runs.ts withRun -> rollbackRun). A gate-failed run therefore left
// its part_source_checks, part_aliases, images, image_candidates, relations and lifecycle rows
// behind: a check saying "we looked and found nothing" and an alias the catalogue now believes,
// both from a run nobody was allowed to trust. The fix is structural rather than a longer rollback
// list — EVERY read and write of a committed run goes through ONE transaction, and the gate is
// computed inside it, before the COMMIT. A failing gate throws, the transaction is rolled back by
// the database itself, and there is nothing left to clean up of ANY kind. `rollbackRun` on the
// failure path then finds nothing and says `rolled_back=0` — which is the point, not a regression;
// the proof that the run really did write is its `stats` (withRun's `partial`), recorded on the
// failed run row.
//
// EXIT CODES. 0 nothing wrong. 1 the command threw — a bad path, a database error, or a COMMITTED
// run whose gate failed (the throw closes the run `failed` and the CLI wrapper exits 1).
// EXIT_GATE_FAILED (2) a DRY RUN whose gate failed: nothing was written and no run was opened, but
// a dry run that reports "precision 0.31" and exits 0 is a green light in a supervisor chain that
// only reads exit codes, which is how an ungated apply gets scheduled.
//
// Two files come out of every run besides the database: the UNMAPPED labels with sample values
// (the input to the alias-proposal loop) and the UNKNOWN SKUs the pages named (the enumeration
// feed: a distributor listing a part number we do not have is how the catalogue grows).
//
// The pieces that decide something — argument parsing, the mapping of one entry's raw pairs, the
// lifecycle shape, the gate — are exported as functions so tests/db/apply-acquired.test.ts can
// sabotage each one directly; main() only threads them together with the database effects.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  getPool, closePool, withTx, withRun, hashFile, getPart, partsBySkuNorm, partsByAliasValue, ensureSourceDoc, docIdFor, linkDocParts,
  applyMerge, upsertAlias, upsertImage, upsertRelation, upsertLifecycle, recordSourceCheck, recordImageCandidate,
  type RelationKind, type AliasKind, type CheckOutcome, type LifecycleInput, type PartRow, type PartCandidate, type AliasCandidate,
  type Queryable,
} from "../store/index.js";
import { candidatesFromPage } from "../core/imageCandidate.js";
import { mapFact } from "../core/deepSpecMap.js";
import { NORM_VERSION } from "../core/specNormalize.js";
import type { SpecEntry } from "../core/specMerge.js";
import { REPO_ROOT } from "../config.js";

export type RawPair = { label: string; value: string; locator?: string };
export type Result = {
  sku?: string; not_listed?: boolean; scope?: string; name?: string;
  facts?: RawPair[];
  aliases?: { kind: string; value: string }[];
  images?: { url: string; role?: string; alt?: string }[];
  relations?: { kind: string; sku: string; note?: string }[];
  lifecycle?: Record<string, string | null> | null;
  price?: Record<string, unknown> | null;
  others?: Result[];
};
export type Acquired = {
  // `vendor` is the queue's own answer to "whose part is this task about" (scraper/worker.py joins
  // it from fetch_queue.part_id). It is NULL for a discovery page, which is why --vendor still exists.
  source: string; task: { id: number; task: string; key: string; part_id: number | null; vendor?: string | null };
  url: string; final_url?: string; fetched_at: string; fetch_id?: number | null; cache_path?: string | null;
  result: Result;
};

export const RELATION_KINDS = new Set<string>(["successor", "predecessor", "compatible", "module_of", "hosts_module", "supports_transceiver", "bundle_contains", "license_for", "accessory_for", "equivalent"]);
export const ALIAS_KINDS = new Set<string>(["gtin", "upc", "ean", "legacy_sku", "variant_sku", "vendor_alias", "distributor_sku"]);
export const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export type ApplyArgs = { paths: string[]; commit: boolean; vendor: string | null; sample: number };

export function parseArgs(argv: string[]): ApplyArgs {
  const out: ApplyArgs = { paths: [], commit: false, vendor: null, sample: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") out.commit = true;
    else if (a === "--vendor") out.vendor = argv[++i];
    else if (a === "--sample") out.sample = Number(argv[++i]);
    else out.paths.push(a);
  }
  return out;
}

export function collect(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
    if (!fs.existsSync(abs)) throw new Error(`no such path: ${p}`);
    if (fs.statSync(abs).isDirectory()) {
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const f = path.join(abs, e.name);
        if (e.isDirectory()) files.push(...collect([f]));
        else if (e.name.endsWith(".json")) files.push(f);
      }
    } else files.push(abs);
  }
  return files.sort();
}

/**
 * The key two spellings of the SAME catalogue row share: case, internal whitespace and Cisco's
 * trailing spare marker `=` folded away, and NOTHING else.
 *
 * `+` is deliberately not folded. It was, until 4 Sep 2026, through a `replace(/[+=\s]/g, "")`
 * copied from promote-unknown-skus (where the fold is only ever used to group a feed, never to
 * decide where a fact lands). A `+` is not a suffix marker: `WS-C4500X-16SFP+` and
 * `WS-C4500X-16SFP` are two catalogue rows for two different line cards, as are `C9200L-24P-4G`
 * and any `…-4G++` an adapter might read off a comparison table. Folding it made `anchorStep`
 * answer "spare" for a page about the OTHER part, which short-circuits the resolver entirely —
 * the page's facts were written onto the queue's anchor without one lookup ever running.
 */
export const spareKey = (s: string) => s.toUpperCase().replace(/\s+/g, "").replace(/=+$/, "");
export const ws = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export const CACHE_DIR = path.join(REPO_ROOT, "scraper", "cache");
export const SCRAPER_TESTS_DIR = path.join(REPO_ROOT, "tests", "scraper");

// =================================================================================================
// PART RESOLUTION — which part is this page about
// =================================================================================================
// Until 4 Sep 2026 the answer was one exact string comparison against parts.sku, and the watchdog's
// NO LANDING alarm measured what that costs: run #40 read 179 meraki entries and matched 0. Every
// step below is a rule someone can state in a sentence, and every one is COUNTED, because a
// resolver that quietly widened would be indistinguishable from a resolver that started guessing.
//
// The order is strongest evidence first, and the FIRST step that produces any candidate decides —
// a later, weaker step never overrules an earlier one. A step that produces more than one
// candidate is `ambiguous`: the entry is refused with the candidates named and nothing lands. The
// tie is never broken. 127 same-vendor pairs in production differ only by case, and picking "the
// first row" would put a page's facts on a coin flip.
//
// What is NOT here, deliberately: a suffix list. `-HW`, `-K9`, `-RF`, `-WS` are real Cisco/Meraki
// variant markers and stripping them centrally would match `MR44` to `MR44-HW` on every page,
// including pages where the two are separately stocked parts. The only variants tried are the ones
// the page's own adapter DECLARED in `result.aliases` for that entry — the adapter read them off
// the page, so they are evidence, not a pattern we invented.

/** The alias kinds that name a PART NUMBER. A barcode is an identity fact too, but a GTIN that
 *  happens to equal some part's SKU is a coincidence, never a reading, so it never resolves one. */
export const SKU_ALIAS_KINDS = new Set<string>(["variant_sku", "legacy_sku", "vendor_alias", "distributor_sku"]);

/** Cisco's spare marker: "C9200L-24P-4G=" and "C9200L-24P-4G" are two catalogue rows for one piece
 *  of hardware, so a page naming either is naming the other's hardware. Flips it, both directions. */
export const spareFlip = (sku: string): string => (sku.endsWith("=") ? sku.slice(0, -1) : `${sku}=`);

export type ResolveStep = "exact" | "case" | "spare" | "alias" | "variant";
export const RESOLVE_STEPS: ResolveStep[] = ["exact", "case", "spare", "alias", "variant"];

export type Resolution =
  | { kind: "matched"; step: ResolveStep; part: PartRow; vendor: string; via: string; aliasKind: AliasKind | null; vendorScoped: boolean }
  | { kind: "ambiguous"; step: ResolveStep; via: string; candidates: string[]; vendorScoped: boolean }
  | { kind: "unknown" };

/** The two database reads the resolver needs, injectable so the pure ordering can be tested without one. */
export type ResolveLookups = {
  bySku: (sku: string, vendor: string | null) => Promise<PartCandidate[]>;
  byAlias: (value: string, vendor: string | null) => Promise<AliasCandidate[]>;
};

export const dbLookups: ResolveLookups = { bySku: partsBySkuNorm, byAlias: partsByAliasValue };

const nameOf = (c: PartCandidate) => `${c.vendor_slug}/${c.sku}`;

/**
 * How the page's SKU relates to the part the QUEUE said this task is about. The anchor is the
 * strongest evidence there is — a row in fetch_queue carrying a part_id — so it short-circuits the
 * lookups; this only labels which step it would have been, so the stats stay honest.
 *
 * Because it short-circuits, a WRONG answer here is not "resolved by a weaker rule", it is
 * "resolved by no rule at all": the page's facts land on the anchor with no lookup. So the three
 * buckets are exactly the three the resolver itself would accept, and `spareKey` folds only what
 * `spareFlip` would flip. Anything else — a `+`, a `-HW`, a digit — is a DIFFERENT part number and
 * returns null, which sends the entry through the real resolver where it can also come back
 * `unknown` or `ambiguous`.
 */
export function anchorStep(anchorSku: string, sku: string): ResolveStep | null {
  if (anchorSku === sku) return "exact";
  if (anchorSku.toUpperCase() === sku.toUpperCase()) return "case";
  if (spareKey(anchorSku) === spareKey(sku)) return "spare";
  return null;
}

/**
 * Resolve one entry's SKU to one part, or refuse. `vendorSlug` null searches the whole catalogue:
 * a SKU exactly one part carries is not a guess, and one two vendors carry comes back ambiguous.
 * Measured 4 Sep 2026 over runs/acquired/provantage/2026-09-04: 113 of 281 unresolved entries are
 * a single catalogue part each, every one under the manufacturer the page names (Extreme's own
 * optics), and none is a cross-vendor collision — a `--vendor cisco` override would have put all
 * 113 on the wrong vendor's part or on none.
 */
export async function resolvePart(
  sku: string,
  declared: { kind: string; value: string }[] | undefined,
  vendorSlug: string | null,
  look: ResolveLookups = dbLookups,
): Promise<Resolution> {
  const scoped = vendorSlug !== null;
  const hit = (step: ResolveStep, c: PartCandidate, via: string, aliasKind: string | null): Resolution =>
    ({ kind: "matched", step, part: c, vendor: c.vendor_slug, via, aliasKind: (aliasKind as AliasKind | null), vendorScoped: scoped });
  const tie = (step: ResolveStep, via: string, cs: PartCandidate[]): Resolution =>
    ({ kind: "ambiguous", step, via, candidates: cs.map(nameOf), vendorScoped: scoped });

  // 1 + 2. the SKU as written, then the same letters in another case.
  const same = await look.bySku(sku, vendorSlug);
  const exact = same.filter((c) => c.sku === sku);
  if (exact.length === 1) return hit("exact", exact[0], sku, null);
  if (exact.length > 1) return tie("exact", sku, exact);          // one SKU, two vendors
  if (same.length === 1) return hit("case", same[0], sku, null);
  if (same.length > 1) return tie("case", sku, same);             // the 127 case-duplicate pairs

  // 3. the spare form. An exactly-cased flip beats a differently-cased one, as above.
  const flip = spareFlip(sku);
  const sp = await look.bySku(flip, vendorSlug);
  const spExact = sp.filter((c) => c.sku === flip);
  const spSet = spExact.length ? spExact : sp;
  if (spSet.length === 1) return hit("spare", spSet[0], flip, null);
  if (spSet.length > 1) return tie("spare", flip, spSet);

  // 4. a part_aliases row already records this string as another name for a part. This is what
  //    makes step 5 pay for itself: the first page teaches the catalogue, every later page reads it.
  const al = await look.byAlias(sku, vendorSlug);
  if (al.length === 1) return hit("alias", al[0], sku, al[0].alias_kind);
  if (al.length > 1) return tie("alias", sku, al);

  // 5. the variants THIS PAGE declared, and nothing else.
  const seen = new Map<number, { part: PartCandidate; via: string; kind: string }>();
  for (const d of declared ?? []) {
    if (!SKU_ALIAS_KINDS.has(d.kind)) continue;
    const value = (d.value || "").trim();
    if (!value || value.toUpperCase() === sku.toUpperCase()) continue;
    for (const c of await look.bySku(value, vendorSlug)) if (!seen.has(c.id)) seen.set(c.id, { part: c, via: value, kind: d.kind });
  }
  const vs = [...seen.values()];
  if (vs.length === 1) return hit("variant", vs[0].part, vs[0].via, vs[0].kind);
  if (vs.length > 1) return tie("variant", sku, vs.map((v) => v.part));

  return { kind: "unknown" };
}

/** The cached page as whitespace-folded lower-case text, or null when there is no such page. */
export function cachedText(cachePath: string | null | undefined, cacheDir: string = CACHE_DIR): string | null {
  if (!cachePath) return null;
  const f = path.join(cacheDir, cachePath);
  if (!fs.existsSync(f)) return null;
  return ws(fs.readFileSync(f, "utf8").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"));
}

export type SourceRow = { id: number; slug: string; tier: number; kind: string };

/** What the gate re-reads: the raw string as written, the label it sat under, the page it came from. */
export type WrittenFact = { raw: string; label: string; cache: string | null | undefined };

export type EntryMapping = {
  /** facts that mapped AND normalised, with the label kept for the provenance audit */
  mapped: { label: string; entry: SpecEntry }[];
  unmapped: { label: string; value: string }[];
  rejected: { key: string; reason: string }[];
  sentinel: number;
};

/**
 * Map one entry's raw pairs. Pure apart from the alias rules mapFact loads: the same pairs give the
 * same split every time. The state a mapped fact lands in is decided HERE from the source's tier —
 * tier <= 2 (a vendor page) is `verified`, anything else `unverified` — and nothing downstream
 * upgrades it.
 */
export function mapEntryFacts(
  facts: RawPair[],
  ctx: { category: string; src: SourceRow; docType: string; docId: string | null; pageUrl: string; sku: string; fetchedDay: string },
): EntryMapping {
  const out: EntryMapping = { mapped: [], unmapped: [], rejected: [], sentinel: 0 };
  for (const f of facts) {
    const m = mapFact({ label: f.label, value: f.value, locator: f.locator || "", shape: "pair", source_url: ctx.pageUrl, sku: ctx.sku }, ctx.category);
    if (m.kind === "ok") {
      out.mapped.push({
        label: f.label,
        entry: {
          k: m.key, raw: f.value, value: m.value, unit: m.unit,
          state: ctx.src.tier <= 2 ? "verified" : "unverified",
          prov: { tier: ctx.src.tier, method: `${ctx.docType}:${ctx.src.slug}`, doc_id: ctx.docId ?? undefined, locator: f.locator || m.locator, extracted_at: ctx.fetchedDay, norm_v: NORM_VERSION },
        },
      });
    } else if (m.kind === "unmapped") out.unmapped.push({ label: m.label, value: f.value });
    else if (m.kind === "rejected") out.rejected.push({ key: m.key, reason: m.reason });
    else out.sentinel++;
  }
  return out;
}

/**
 * The lifecycle row an entry's `lifecycle` block earns, or null when it states no real date. A
 * block of "N/A"s is not a lifecycle: a row with status `active` and every date NULL would read
 * as "checked, still shipping", which nobody established.
 */
export function lifecycleFromEntry(
  lc: Record<string, string | null> | null | undefined,
  ctx: { docId: string | null; pageUrl: string; fetchedDay: string; tier: number },
): LifecycleInput | null {
  if (!lc || !Object.values(lc).some((v) => typeof v === "string" && DATE_RX.test(v))) return null;
  const pick = (k: string) => (typeof lc[k] === "string" && DATE_RX.test(lc[k] as string) ? (lc[k] as string) : null);
  return {
    status: pick("end_of_sale_date") || pick("last_day_of_support") ? "eol_announced" : "active",
    announce_date: pick("announce_date"), end_of_sale_date: pick("end_of_sale_date"), last_ship_date: pick("last_ship_date"),
    end_of_sw_maint: pick("end_of_sw_maint"), end_of_vuln_support: pick("end_of_vuln_support"), last_day_of_support: pick("last_day_of_support"),
    doc_id: ctx.docId, source_url: ctx.pageUrl, verified_at: ctx.fetchedDay, tier: ctx.tier, successor_sku: (lc.successor_sku as string) || null,
  };
}

export type Gate = { precision: number; recall: number; passed: boolean; sampled: number; checked: number; unreadable: number; suites: Record<string, boolean>; misses: string[] };

/** Exit code of a DRY RUN whose gate failed (see EXIT CODES at the top). A committed run's gate
 *  failure throws instead, and the CLI wrapper exits 1. */
export const EXIT_GATE_FAILED = 2;
/** The one wording both paths use, so a log or a run row can be grepped for either. */
export const GATE_REFUSED = "the gate did not pass";

/** Recall half: every touched source's adapter suite, run fresh. A source with no suite is a failed suite. */
/**
 * The Python that runs the adapter suites, resolved rather than assumed.
 *
 * `python3.11` was hardcoded here, and on the operator's laptop that is the only name that works —
 * `python` and `python3` resolve to a Microsoft Store stub. On the Hetzner box the opposite is
 * true: `python3` is 3.12.3 and there is no `python3.11` binary at all. So the colocated apply
 * spawned a program that does not exist, spawnSync returned a non-zero status, and the gate
 * recorded `suites: {juniper: false}` — while `test_juniper.py` passed 85/85 when run by hand on
 * that same box.
 *
 * THAT IS A FALSE NEGATIVE IN THE ONE PLACE IT MUST NEVER HAPPEN. This is the RECALL half of the
 * gate: it decides whether facts may land. "I could not run your suite" and "your suite did not
 * pass" are different facts, only one of them was true, and the gate reported the wrong one — the
 * project's own rule about a monitor that cannot tell its own failure from a fault, one layer down.
 *
 * Candidates are tried by ASKING them, not by guessing from the platform: the first that answers
 * `--version` wins. NETZSPEC_PYTHON overrides everything for the case neither list covers.
 */
export function resolvePython(explicit?: string): string | null {
  const candidates = [explicit, process.env.NETZSPEC_PYTHON, "python3.11", "python3", "python"]
    .filter((c): c is string => !!c && c.trim().length > 0);
  for (const c of candidates) {
    const probe = spawnSync(c, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return c;
  }
  return null;
}

export function runAdapterSuites(slugs: Iterable<string>, opts: { testsDir?: string; python?: string } = {}): Record<string, boolean> {
  const testsDir = opts.testsDir ?? SCRAPER_TESTS_DIR;
  const suiteResults: Record<string, boolean> = {};
  const py = resolvePython(opts.python);
  if (py === null) {
    // REFUSED, not reported as a failing suite. Returning `false` here would say the adapters are
    // broken; throwing says the machine cannot check them. The gate still refuses to write either
    // way — that is not the difference. The difference is what the operator is sent to fix.
    throw new Error(
      "cannot run the adapter suites: no working Python found. Tried " +
      [opts.python, process.env.NETZSPEC_PYTHON, "python3.11", "python3", "python"].filter(Boolean).join(", ") +
      ". Set NETZSPEC_PYTHON to the interpreter that runs tests/scraper/*.py. This is 'could not " +
      "check', NOT 'the suite failed' — reporting it as the latter is how a passing suite was " +
      "recorded as `suites: {juniper: false}` on a box that simply spells Python differently.");
  }
  for (const slug of slugs) {
    const t = path.join(testsDir, `test_${slug.replace(/-/g, "_")}.py`);
    if (!fs.existsSync(t)) { suiteResults[slug] = false; continue; }
    const r = spawnSync(py, [t], { cwd: REPO_ROOT, encoding: "utf8" });
    // `r.error` is the spawn itself failing — the interpreter vanished between the probe and here,
    // or the file is not executable. Distinct from the suite running and reporting misses, and it
    // says so on the way past rather than folding into a bare false.
    if (r.error) {
      console.error(`could not run ${path.basename(t)} with ${py}: ${r.error.message} — recorded as `
        + "NOT PASSING, but this is a machine problem rather than an adapter problem");
    }
    suiteResults[slug] = !r.error && r.status === 0;
  }
  return suiteResults;
}

/**
 * `k` of `items`, uniformly at random, by a partial Fisher-Yates over the INDICES.
 *
 * The obvious one-liner — `[...items].sort(() => 0.5 - Math.random())` — is not a shuffle. A
 * comparator that answers differently every time it is asked breaks the sort's own invariants, and
 * what comes out is a mild permutation of what went in: with V8's TimSort the head of the array
 * stays overwhelmingly in the head. The gate's sample is taken off the FRONT of the result, so the
 * audit was re-reading roughly the first pages of the run and calling it random — a fabricated
 * value on the last page of a 100k-fact apply had almost no chance of being looked at. The same
 * non-shuffle was removed from the extract gate on 4 Sep 2026 and survived here.
 *
 * `rand` is injectable so the sabotage twin can be deterministic: with rand()->~1 a real shuffle
 * takes the LAST item first, while the sort-comparator version (a constant -0.5) is a no-op and
 * takes the first.
 */
export function pickSample<T>(items: T[], k: number, rand: () => number = Math.random): T[] {
  const n = items.length;
  const take = Math.max(0, Math.min(k, n));
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < take; i++) {
    const j = Math.min(n - 1, i + Math.floor(rand() * (n - i)));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx.slice(0, take).map((i) => items[i]);
}

/**
 * Precision half: a random sample of what was written, re-read from the cached page.
 *
 * THIS FUNCTION SAID THE RIGHT THING AND DID IT FOR ONE CASE ONLY. Its own comment used to read
 * "a run that wrote facts and could re-read NONE of them scores 0, not 1 — could not check must
 * never pass as checked", and the loop did `if (text === null) continue;` BEFORE `checked++`. So
 * an unreadable page did not fail the audit: it shrank the DENOMINATOR. The all-missing case was
 * handled (checked === 0 scores 0); mostly-missing passed on whatever happened to survive.
 *
 * AND THE OUTPUT ERASED THE EVIDENCE. The returned field was named `sampled` and carried
 * `checked`. The default sample is 60, so run 142's gate line —
 *
 *     {"precision":1,"recall":1,"passed":true,"sampled":2}   ->  294 facts written
 *
 * — did not mean "we sampled 2". It meant 60 were sampled and 58 of the evidence pages were gone.
 * Three sessions read that line as a small sample. Two readable facts decided that 294 could be
 * written, and which two was down to the shuffle. Found 6 Sep 2026 after a wipe took 93% of one
 * lane's cached pages.
 *
 * So: count what could NOT be checked as its own number and report it, never folded into either
 * side. `apply-enumeration.ts` already had this shape (`cache_unchecked`); this one did not.
 * `sampled` now means the sample size, which is what the word says.
 */
export function auditProvenance(
  written: WrittenFact[], sampleN: number, cacheDir: string = CACHE_DIR, rand: () => number = Math.random,
): { precision: number; sampled: number; checked: number; unreadable: number; misses: string[] } {
  const sample = pickSample(written, sampleN, rand);
  let hits = 0, checked = 0, unreadable = 0;
  const misses: string[] = [];
  for (const s of sample) {
    const text = cachedText(s.cache, cacheDir);
    if (text === null) { unreadable++; continue; }
    checked++;
    const lab = ws(s.label.split(">").pop() || s.label);
    if (text.includes(ws(s.raw)) && text.includes(lab)) hits++; else if (misses.length < 10) misses.push(`${s.label} = ${s.raw}`);
  }
  const precision = checked ? hits / checked : (written.length ? 0 : 1);
  return { precision: Number(precision.toFixed(4)), sampled: sample.length, checked, unreadable, misses };
}

/**
 * How much of the sample must be re-readable before `passed` may be true.
 *
 * A SHARE AND NOT AN ABSOLUTE FLOOR, deliberately. An absolute minimum (say "at least 20 checked")
 * refuses an honest small run: a run that writes 3 facts can only ever sample 3, and verifying all
 * three is complete verification, not weak evidence. A share asks the question that actually
 * matters — "of the facts I chose to verify, how many could I verify?" — and it is what separates
 * the 58-of-60 case from the 3-of-3 one.
 *
 * 0.8 rather than 1.0 because a page legitimately goes missing now and then (a re-fetch replacing
 * a cache entry mid-run), and a gate that refuses on a single absent file would refuse honest work
 * constantly — and this gate refusing is the only reason the store is coherent tonight. Getting it
 * wrong in that direction is not free either.
 */
export const MIN_READABLE_SHARE = 0.8;

export function computeGate(
  written: WrittenFact[], sourcesTouched: Iterable<string>, sampleN: number,
  opts: { testsDir?: string; cacheDir?: string; python?: string } = {},
): Gate {
  const suites = runAdapterSuites(sourcesTouched, opts);
  const recall = Object.values(suites).length && Object.values(suites).every(Boolean) ? 1 : 0;
  const audit = auditProvenance(written, sampleN, opts.cacheDir);
  // A run may only pass if enough of its own evidence still exists to have checked it. Precision
  // alone cannot say that: it is computed over the survivors, so 2 readable facts out of 60 score
  // a perfect 1. The share is the missing question and it is reported either way.
  const readableShare = audit.sampled ? audit.checked / audit.sampled : 1;
  return {
    precision: audit.precision, recall,
    passed: audit.precision >= 0.98 && recall === 1 && readableShare >= MIN_READABLE_SHARE,
    sampled: audit.sampled, checked: audit.checked, unreadable: audit.unreadable,
    suites, misses: audit.misses,
  };
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  if (!a.paths.length) throw new Error("usage: ingest apply-acquired <dir|file>... [--commit] [--vendor V] [--sample N]");
  const files = collect(a.paths);
  if (!files.length) throw new Error("no acquired JSON files found");
  const pool = getPool();
  const sources = new Map((await pool.query<SourceRow>("SELECT id, slug, tier, kind FROM sources")).rows.map((r) => [r.slug, r]));
  const categories = new Map((await pool.query<{ id: number; slug: string }>("SELECT id, slug FROM categories")).rows.map((r) => [r.id, r.slug]));
  const vendors = new Map((await pool.query<{ id: number; slug: string }>("SELECT id, slug FROM vendors")).rows.map((r) => [r.id, r.slug]));

  const stats: Record<string, number> = {
    files: files.length, pages: 0, entries: 0, parts_matched: 0, sku_unknown: 0, ambiguous: 0, family_scoped_skipped: 0,
    matched_exact: 0, matched_case: 0, matched_spare: 0, matched_alias: 0, matched_variant: 0,
    matched_no_vendor_scope: 0, aliases_backfilled: 0, aliases_self_skipped: 0,
    facts_raw: 0, facts_ok: 0, facts_unmapped: 0, facts_rejected: 0, facts_sentinel: 0,
    insert: 0, corroborate: 0, conflict: 0, protected: 0, revision_change: 0, agree_same_doc: 0,
    aliases: 0, images: 0, images_skipped_non_vendor: 0, relations: 0, relations_invalid_kind: 0, lifecycle: 0, prices_seen: 0, checks: 0,
    image_candidates: 0, image_candidates_new: 0, image_candidates_refused: 0,
  };
  const unmapped = new Map<string, { count: number; samples: string[]; categories: Set<string> }>();
  const rejected = new Map<string, number>();
  const imageRefusals = new Map<string, number>();
  const unknownSkus: Record<string, unknown>[] = [];
  // Refused for ambiguity, kept OUT of the unknown-SKU feed on purpose: that feed is the enumeration
  // input to `ingest promote-unknown-skus`, which creates parts. An ambiguous SKU is one the
  // catalogue already holds twice — proposing a third row is the opposite of the right answer.
  const ambiguousSkus: Record<string, unknown>[] = [];
  const written: WrittenFact[] = [];
  const sourcesTouched = new Set<string>();

  // WHOSE RUN IS THIS? `vendor` and `lanes` are recorded because without them the only way to
  // answer that was a substring match on `inputs->>'first'`, and two sessions got it wrong in one
  // evening: the Juniper session read run 114 as theirs and credited it for moving their coverage
  // when it was cisco-datasheets, and the mirror-image mistake was nearly made about run 113.
  // Attribution by guessing at a file path is not attribution. `lanes` is derived from the
  // directory each file sits in, which is where the worker puts it, so it needs nothing passed in.
  const laneOf = (f: string) => path.basename(path.dirname(path.dirname(f)));
  const runInputs = {
    vendor: a.vendor,
    lanes: [...new Set(files.map(laneOf))].sort(),
    files: files.length,
    first: files.slice(0, 5).map((f) => path.relative(REPO_ROOT, f)),
    hashes: files.slice(0, 200).map((f) => hashFile(f)),
    commit: a.commit,
  };

  // Every read AND every write of a committed run goes through this one handle: the transaction's
  // client when committing, the pool when not. Passing it everywhere is what makes the rollback
  // total (see the header) and it is also what keeps a run able to read its own writes — the alias
  // step 4 reaches a name step 5 recorded for an earlier page of the SAME run only because both
  // statements are on the same connection.
  const body = async (runId: number | null, db: Queryable) => {
    // THE APPLY IS ROUND-TRIP BOUND, NOT VOLUME BOUND, and that changes what "slow" means here.
    //
    // Measured 6 Sep 2026 on the shared SSH tunnel every brand goes through: a bare `SELECT 1`
    // round trip is a MEDIAN OF 333 ms (min 319, max 666), and connecting costs 2.4 s. Twenty
    // sequential single-row lookups took 6,942 ms against 412 ms for one batched `= ANY($1)` —
    // seventeen times, and the ratio IS the round-trip count. So an apply issuing N small
    // statements pays N x 333 ms in pure waiting before any work happens, which is why a 478-file
    // run sat for 1,957 s and then died when the tunnel dropped it. All three brands hit the same
    // symptom in the same hour and each read it as their own volume problem.
    //
    // resolvePart calls bySku up to three times per SKU — the name as written, the spare flip, and
    // each declared alias — and the same names recur across entries and across files in a run.
    // Memoising it turns every repeat into zero round trips.
    //
    // SAFE BECAUSE THE PARTS TABLE DOES NOT MOVE UNDER THIS RUN: apply-acquired never inserts a
    // part (the only INSERT INTO parts is the enumeration path in store/parts.ts), so a miss stays
    // a miss and a hit stays a hit for the life of the run. The key is upper-cased because the
    // query matches on `sku_norm = upper($1)`, so two spellings of one SKU share an entry.
    //
    // byAlias IS DELIBERATELY NOT CACHED, and that is the whole reason this is two lines and not
    // one. The header above explains that a run reads its own writes: step 4 reaches an alias that
    // step 5 recorded for an EARLIER PAGE OF THE SAME RUN. Caching it would freeze the catalogue at
    // the moment of the first miss and silently undo the learning that makes step 5 pay for itself.
    const skuCache = new Map<string, PartCandidate[]>();
    const look: ResolveLookups = {
      bySku: async (s, v) => {
        // Separator is a literal " :: ", not a NUL. The first version used a unicode NUL escape and a real
        // 0x00 byte reached the file - caught by tests/source-scan.test.ts, which exists for
        // exactly this and named the line and column. A SKU is upper-case alphanumerics with
        // dashes and plus signs and a vendor slug is lower-case, so " :: " cannot occur inside
        // either and cannot collide two different keys into one.
        const key = `${(s ?? "").toUpperCase()} :: ${v ?? ""}`;
        const hit = skuCache.get(key);
        if (hit) return hit;
        const rows = await partsBySkuNorm(s, v, db);
        skuCache.set(key, rows);
        return rows;
      },
      byAlias: (v, ven) => partsByAliasValue(v, ven, db),
    };
    for (const file of files) {
      let doc: Acquired;
      try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error(`skip ${file}: ${(e as Error).message}`); continue; }
      const src = sources.get(doc.source);
      if (!src) { console.error(`skip ${file}: unknown source ${doc.source}`); continue; }
      sourcesTouched.add(doc.source);
      stats.pages++;
      const res = doc.result || {};
      const anchor = doc.task?.part_id ? await getPart(doc.task.part_id, db) : null;
      // Whose part is this page about, in descending order of how specific the answer is: the part
      // the queue anchored the task to, the vendor the queue recorded for it, the operator's blanket
      // --vendor. All three can be absent — a discovery page is anchored to nothing — and null here
      // means "search the whole catalogue and refuse anything that is not unique", not "give up".
      // The nightshift passes no --vendor at all, which is why every meraki run since #37 matched 0.
      const vendorSlug = (anchor ? vendors.get(anchor.vendor_id) ?? null : null) ?? doc.task?.vendor ?? a.vendor;
      const pageUrl = doc.final_url || doc.url;
      const docType = src.kind === "vendor" ? "vendor_page" : src.kind === "aggregator" ? "aggregator_page" : "distributor_page";
      const fetchedDay = (doc.fetched_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
      const entries: Result[] = [];
      if (res.sku || (res.facts && res.facts.length)) entries.push(res);
      for (const o of res.others || []) entries.push(o);
      if (res.price) stats.prices_seen++;

      let docId: string | null = null;
      for (const entry of entries) {
        stats.entries++;
        if (entry.scope === "family") { stats.family_scoped_skipped++; continue; }
        const sku = entry.sku || (entry === res ? doc.task?.key : undefined);
        if (!sku) continue;

        // ---- which part is this? (see PART RESOLUTION above) ------------------------------------
        const anchored = anchor ? anchorStep(anchor.sku, sku) : null;
        const pick: Resolution = anchored
          ? { kind: "matched", step: anchored, part: anchor!, vendor: vendors.get(anchor!.vendor_id) ?? vendorSlug ?? "", via: anchor!.sku, aliasKind: null, vendorScoped: true }
          : await resolvePart(sku, entry.aliases, vendorSlug, look);
        if (pick.kind === "ambiguous") {
          stats.ambiguous++;
          ambiguousSkus.push({ source: doc.source, vendor: vendorSlug, sku, step: pick.step, via: pick.via, candidates: pick.candidates,
            vendor_scoped: pick.vendorScoped, name: entry.name ?? null, url: pageUrl, facts: (entry.facts || []).length });
          continue;
        }
        if (pick.kind === "unknown") {
          stats.sku_unknown++;
          unknownSkus.push({ source: doc.source, vendor: vendorSlug, sku, name: entry.name ?? null, url: pageUrl, facts: (entry.facts || []).length });
          continue;
        }
        const part = pick.part;
        const partVendor = pick.vendor || vendorSlug;
        stats.parts_matched++;
        stats[`matched_${pick.step}`]++;
        if (!pick.vendorScoped) stats.matched_no_vendor_scope++;
        const category = categories.get(part.category_id) ?? "switches";
        if (a.commit && runId !== null && !docId) {
          docId = await ensureSourceDoc({ url: pageUrl, doc_type: docType, vendor: partVendor ?? undefined, fetched_at: fetchedDay, cache_path: doc.cache_path ?? undefined }, db);
        } else if (!docId) docId = docIdFor(pageUrl);
        if (a.commit && runId !== null) await linkDocParts(docId, [part.id], db);

        const rawFacts = entry.facts || [];
        const m = mapEntryFacts(rawFacts, { category, src, docType, docId, pageUrl, sku, fetchedDay });
        stats.facts_raw += rawFacts.length;
        stats.facts_ok += m.mapped.length;
        stats.facts_unmapped += m.unmapped.length;
        stats.facts_rejected += m.rejected.length;
        stats.facts_sentinel += m.sentinel;
        for (const u of m.unmapped) {
          const row = unmapped.get(u.label) ?? { count: 0, samples: [], categories: new Set<string>() };
          row.count++; if (row.samples.length < 3 && !row.samples.includes(u.value)) row.samples.push(u.value.slice(0, 120)); row.categories.add(category);
          unmapped.set(u.label, row);
        }
        for (const r of m.rejected) rejected.set(`${r.key}:${r.reason}`, (rejected.get(`${r.key}:${r.reason}`) ?? 0) + 1);
        for (const w of m.mapped) written.push({ raw: w.entry.raw, label: w.label, cache: doc.cache_path });
        const mappedKeys = m.mapped.map((w) => w.entry.k);
        const specEntries = m.mapped.map((w) => w.entry);

        // ---- image candidates: EVERY source, distributor included -------------------------
        // The images block below writes an assignment only for a vendor page, which is right —
        // a distributor's word is not evidence that a photo shows this part. But dropping the
        // URL entirely was not: 61,229 hardware parts have no picture while provantage,
        // router-switch and meraki printed one on almost every page the workers fetched, night
        // after night. A candidate row claims nothing; the fetch lane (scraper/images.py
        // --from-db) validates the bytes and rejects with a named reason. Counted outside the
        // commit branch so a DRY RUN reports how many a day's pages would add.
        const cand = candidatesFromPage(entry.images || []);
        stats.image_candidates += cand.rows.length;
        stats.image_candidates_refused += cand.refused.length;
        for (const rf of cand.refused) imageRefusals.set(rf.reason, (imageRefusals.get(rf.reason) ?? 0) + 1);

        if (a.commit && runId !== null) {
          for (const c of cand.rows) {
            const rec = await recordImageCandidate(part.id, { source_id: src.id, page_url: pageUrl, ...c }, runId, db);
            if (rec.inserted) stats.image_candidates_new++;
          }
          // NOT its own transaction any more. A nested withTx would take a SECOND pool connection
          // and block on the row locks the run's own transaction already holds — and its commit
          // would survive a later gate failure, which is the whole defect being closed here.
          for (const e of specEntries) {
            const r = await applyMerge(db, part!.id, e, runId);
            stats[r.action] = (stats[r.action] ?? 0) + 1;
          }
          for (const al of entry.aliases || []) {
            if (!ALIAS_KINDS.has(al.kind)) continue;
            // A declared variant that IS the part we landed on is not an alias of it. Once the
            // variant step resolves `MR44` to the part `MR44-HW`, the page's own "MR44-HW" would
            // otherwise be stored as an alias of MR44-HW for itself.
            if (al.value.trim().toUpperCase() === part.sku.toUpperCase()) { stats.aliases_self_skipped++; continue; }
            await upsertAlias(part.id, { kind: al.kind as AliasKind, value: al.value, tier: src.tier, doc_id: docId, source_url: pageUrl }, runId, db); stats.aliases++;
          }
          // ---- teach the catalogue what this page taught us -----------------------------------
          // The variant step read `MR44-HW` off the page and landed on that part; the name the page
          // itself used, `MR44`, is then a second name for it, recorded with the adapter's own kind
          // and the page as its source. The next run reaches the same part through step 4 (a
          // part_aliases row) instead of re-deriving it, and `ingest promote-unknown-skus` stops
          // seeing a SKU the catalogue already holds under another spelling. Nothing is recorded on
          // the `alias` step: that step matched BECAUSE the row already exists.
          if (pick.step === "variant" && pick.aliasKind && ALIAS_KINDS.has(pick.aliasKind)) {
            await upsertAlias(part.id, { kind: pick.aliasKind, value: sku, tier: src.tier, doc_id: docId, source_url: pageUrl }, runId, db);
            stats.aliases_backfilled++;
          }
          for (const im of entry.images || []) {
            if (src.kind !== "vendor") { stats.images_skipped_non_vendor++; continue; }
            await upsertImage(part.id, { role: im.role || "gallery", source_url: im.url, doc_id: docId, assignment_method: "source-page", confidence: 0.7, license_note: `vendor product photo (${src.slug})`, source_id: src.id }, runId, db); stats.images++;
          }
          for (const rel of entry.relations || []) {
            if (!RELATION_KINDS.has(rel.kind)) { stats.relations_invalid_kind++; continue; }
            await upsertRelation(part.id, { to_sku: rel.sku, kind: rel.kind as RelationKind, tier: src.tier, doc_id: docId, source_url: pageUrl, note: rel.note ?? null }, runId, db); stats.relations++;
          }
          const li = lifecycleFromEntry(entry.lifecycle, { docId, pageUrl, fetchedDay, tier: src.tier });
          if (li) { await upsertLifecycle(part.id, li, runId, db); stats.lifecycle++; }
          const outcome: CheckOutcome = mappedKeys.length ? "facts_found" : entry.not_listed ? "not_listed" : "no_facts";
          await recordSourceCheck(part.id, src.id, { doc_id: docId, fetch_id: doc.fetch_id ?? null, outcome, facts_found: mappedKeys.length, fields_found: [...new Set(mappedKeys)] }, runId, db);
          stats.checks++;
        }
      }
    }

    // ---- the gate -------------------------------------------------------------------------
    const gate = computeGate(written, sourcesTouched, a.sample);
    return { stats, gate, notes: `sources=${[...sourcesTouched].join(",")}` };
  };

  let out: { stats: Record<string, number>; gate: Gate; runId?: number };
  if (a.commit) {
    out = await withRun("apply-acquired", runInputs, (runId) => withTx(async (client) => {
      const r = await body(runId, client);
      // INSIDE the transaction, before the COMMIT. Throwing here is the rollback: the database
      // discards every row this run wrote, of every kind, and withRun closes the run `failed`
      // with this message. closeRun's own gate refusal stays as belt-and-braces behind it.
      if (!r.gate.passed) throw new Error(`${GATE_REFUSED}, so nothing was written: ${JSON.stringify(r.gate)}`);
      return r;
    }), {
      // Called ONLY on the failure path, and the only remaining evidence that the run wrote
      // anything at all once the transaction is gone: without it a rolled-back run and a run over
      // an empty directory leave identical rows.
      partial: () => ({ stats, progress: `${stats.pages} of ${files.length} files, ${stats.parts_matched} parts touched` }),
    });
  } else {
    out = await body(null, pool);
  }

  const day = new Date().toISOString().slice(0, 10);
  const tag = [...sourcesTouched].join("+") || "none";
  const outDir = path.join(REPO_ROOT, "runs", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const unmappedFile = path.join(outDir, `unmapped-${tag}-${day}.json`);
  fs.writeFileSync(unmappedFile, JSON.stringify({ generated_at: new Date().toISOString(), sources: [...sourcesTouched],
    labels: [...unmapped.entries()].map(([label, u]) => ({ label, count: u.count, samples: u.samples, categories: [...u.categories] })).sort((x, y) => y.count - x.count) }, null, 1));
  const unknownFile = path.join(outDir, `unknown-skus-${tag}-${day}.jsonl`);
  fs.writeFileSync(unknownFile, unknownSkus.map((u) => JSON.stringify(u)).join("\n") + (unknownSkus.length ? "\n" : ""));
  // Written even when empty, so "no ambiguity today" is a file saying so rather than a file nobody
  // can tell from a run that never checked.
  const ambiguousFile = path.join(outDir, `ambiguous-skus-${tag}-${day}.jsonl`);
  fs.writeFileSync(ambiguousFile, ambiguousSkus.map((u) => JSON.stringify(u)).join("\n") + (ambiguousSkus.length ? "\n" : ""));

  console.log(`${a.commit ? "COMMITTED run " + out.runId : "DRY RUN"} — ${[...sourcesTouched].join(", ")}`);
  console.table(out.stats);
  console.log("rejected by reason:", Object.fromEntries([...rejected.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)));
  console.log("image URLs refused on sight:", Object.fromEntries([...imageRefusals.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)));
  console.log(`gate: ${JSON.stringify(out.gate)}`);
  console.log(`unmapped labels: ${unmapped.size} -> ${path.relative(REPO_ROOT, unmappedFile)}`);
  console.log(`unknown SKUs: ${unknownSkus.length} -> ${path.relative(REPO_ROOT, unknownFile)}`);
  console.log(`ambiguous SKUs (refused, never picked): ${ambiguousSkus.length} -> ${path.relative(REPO_ROOT, ambiguousFile)}`);
  console.log("resolution: " + RESOLVE_STEPS.map((s) => `${s}=${out.stats[`matched_${s}`] ?? 0}`).join(" ")
    + ` unknown=${out.stats.sku_unknown} ambiguous=${out.stats.ambiguous} (of the matches, ${out.stats.matched_no_vendor_scope} rested on a catalogue-wide unique SKU with no vendor to scope by)`);
  await closePool();
  // Only a dry run can reach this line with a failing gate — a committed one threw above. It used
  // to read `if (a.commit && !passed)`, which was therefore dead code in both directions: the
  // commit case never got here, and the dry case (the one a supervisor runs first to decide
  // whether to commit) reported a broken adapter and exited 0.
  if (!out.gate.passed) {
    console.error(`${GATE_REFUSED} (precision ${out.gate.precision}, recall ${out.gate.recall}); exiting ${EXIT_GATE_FAILED}${a.commit ? "" : " — dry run, nothing was written"}`);
    process.exitCode = EXIT_GATE_FAILED;
  }
}

if (process.argv[1] && /apply-acquired\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
