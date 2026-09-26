// scripts/build-render-contract.mts — writes data/schema/render-contract.de.json.
//
// WHY AN ARTIFACT AND NOT JUST THE CODE. The stated consumer is Claude reading a category out of this API and
// emitting a JTL-Shop import CSV. `/v1/parts` and `/v1/export` now carry `text_de` per fact, so the common path
// needs nothing from this file — but a consumer that wants to render locally, diff two days' rules, or review
// what a German cell will say BEFORE anything is exported needs the contract as data.
//
// EVERY RULE IS MATERIALISED. `ip_rating` and the form-factor keys are covered by a FUNCTION in the code; a
// consumer cannot execute a function out of a JSON file, so the generator expands each rule over the domain it
// applies to and ships explicit values. That also makes the artifact diffable: a rule change shows up as the
// values it moved, not as a line of code nobody can evaluate.
//
// THE DOMAIN IS THE UNION, global + DOMAIN_OVERRIDES, for the same reason the coverage check reads the union:
// `form_factor` is four chassis words in `switches` and nineteen optic cages in `transceiver`, and a contract
// built from the global domain alone would be missing the values behind 1,742 live facts.
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { FIELD_DICTIONARY, DOMAIN_OVERRIDES } from "../src/core/fieldSchema.js";
import {
  ENUM_DE, STRUCT_DE, LIST_SEPARATOR, BOOLEAN_DE, enumValueDe, uncoveredEnumValues, renderValue,
} from "../src/core/renderContract.js";

const gaps = uncoveredEnumValues();
if (gaps.length) {
  // REFUSE TO WRITE AN INCOMPLETE ARTIFACT. A consumer cannot tell a key the contract has no German for from a
  // key it simply did not reach, so shipping a partial file would put that guess into someone's spreadsheet.
  console.error(`REFUSING: ${gaps.length} enum values have no German rendering:`);
  for (const g of gaps.slice(0, 20)) console.error(`  ${g.key} = ${g.value}`);
  process.exit(1);
}

type Dict = Record<string, { type?: string; domain?: string[]; unit?: string | null; label_de?: string; shape?: string }>;
const dict = FIELD_DICTIONARY as unknown as Dict;

// the union domain per enum key, exactly as uncoveredEnumValues() builds it
const union = new Map<string, Set<string>>();
for (const [k, d] of Object.entries(dict)) if (d.type === "e" && Array.isArray(d.domain)) union.set(k, new Set(d.domain));
const overriddenIn: Record<string, string[]> = {};
for (const [cat, keys] of Object.entries(DOMAIN_OVERRIDES)) {
  for (const [k, dom] of Object.entries(keys)) {
    if (!union.has(k)) continue;
    for (const v of dom) union.get(k)!.add(v);
    (overriddenIn[k] ??= []).push(cat);
  }
}

const enums: Record<string, { label_de: string; values: Record<string, string>; domain_varies_by_category?: string[] }> = {};
for (const [k, dom] of [...union].sort((a, b) => a[0].localeCompare(b[0]))) {
  const values: Record<string, string> = {};
  for (const v of [...dom].sort()) values[v] = enumValueDe(k, v)!;   // non-null: the gap check above passed
  enums[k] = {
    label_de: dict[k].label_de ?? k,
    values,
    ...(overriddenIn[k] ? { domain_varies_by_category: overriddenIn[k].sort() } : {}),
  };
}

// Structs ship an EXAMPLE rather than a description, because the declared `shape` is prose and for `reach_max`
// it is also wrong — it declares `list{ medium, distanz }` and the store holds `{m, values_m[]}`.
const STRUCT_SAMPLES: Record<string, { value: unknown; unit?: string }> = {
  dimensions: { value: { h: 44.5, w: 442, d: 300 }, unit: "mm" },
  reach_max: { value: { m: 10000, values_m: [10000] }, unit: "m" },
  ports: { value: [{ port_typ: "rj45", speed: ["1G"], anzahl: 24 }, { port_typ: "sfp-plus", speed: ["10G"], anzahl: 4 }] },
  uplink_ports: { value: [{ port_typ: "sfp-plus", speed: ["10G"], anzahl: 4 }] },
  video_quality_max: { value: { w: 3840, h: 2160 } },
  max_resolution: { value: { w: 1920, h: 1080 } },
  display_resolution: { value: { w: 1920, h: 1080 } },
  bidi_wavelengths: { value: { tx: 1310, rx: 1490 }, unit: "nm" },
  antenna_gain: { value: { band24: 4, band5: 6 }, unit: "dBi" },
};
const structs: Record<string, { label_de: string; stored_shape_example: unknown; renders_as: string | null; why?: string }> = {};
for (const k of Object.keys(dict).filter((x) => dict[x].type === "struct").sort()) {
  const s = STRUCT_SAMPLES[k];
  if (!STRUCT_DE[k]) {
    structs[k] = { label_de: dict[k].label_de ?? k, stored_shape_example: null, renders_as: null,
      why: `no renderer: this key is typed struct and declares ${dict[k].shape ? "a shape this contract does not implement" : "NO shape at all"}. renderValue refuses it.` };
    continue;
  }
  const r = s ? renderValue(k, s.value, s.unit ?? null) : null;
  structs[k] = { label_de: dict[k].label_de ?? k, stored_shape_example: s?.value ?? null, renders_as: r && r.ok ? r.text : null };
}

// THE COMMIT, AND WHETHER IT IS THE WHOLE TRUTH. Generating from a dirty tree stamps a commit that does not
// contain the rules this file describes — the same shape as an rsync deploy that puts uncommitted code into
// production and leaves nobody able to answer "what is running there". `tree_dirty` names the files, so a
// reader can tell an artifact built from a commit from one built from somebody's working copy.
const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const dirty = execSync("git status --porcelain -- src/core/renderContract.ts src/core/fieldSchema.ts scripts/build-render-contract.mts",
  // NOT `.trim()` before `.split()`: porcelain is `XY<space>PATH`, and an UNSTAGED change is ` M path` with a
  // leading space. Trimming the whole output strips that space from the FIRST line only, so slice(3) then ate the
  // path's first character and this field recorded `rc/core/renderContract.ts` — a provenance record naming a file
  // that does not exist, wrong for the first entry only and only when unstaged, which is why it read as correct.
  { encoding: "utf8" }).split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 3).map((l) => l.slice(3));
const out = {
  $comment: "How one stored fact value becomes one German cell. Generated by scripts/build-render-contract.mts — "
    + "do not edit by hand. The API applies this itself: every fact on /v1/parts and /v1/export carries text_de.",
  /** The commit the tree was AT when this was generated — necessarily the PARENT of the commit that carries
   *  this file, since the artifact has to exist before it can be committed. Read it with the next field. */
  built_from_commit: commit,
  /** Which of the source files this is generated from differed from that commit at generation time. On the
   *  commit that introduces the contract these ARE listed, and that is correct and expected: the rules were
   *  new. A later regeneration that lists files is a warning — the artifact and the named commit disagree. */
  built_from_uncommitted: dirty,
  scalars: {
    list_separator: LIST_SEPARATOR,
    list_separator_why: "German Excel writes CSV with ';' as the FIELD delimiter, so a semicolon inside a cell is the "
      + "character most likely to split a row on import; a comma is the second. The pipe appears in no live list value.",
    boolean: BOOLEAN_DE,
    decimal_separator: ",",
    thousands_separator: "",
    thousands_separator_why: "German writes 1.234,5 and a full stop inside a CSV cell is read as a decimal point by any "
      + "importer configured for English. One unambiguous number beats one pretty one.",
    range: "<min> bis <max> <unit>",
    quantity: "<number> <unit>",
  },
  refusal_policy: "A value this contract does not cover is REFUSED, never passed through in English: the API returns "
    + "text_de: null with text_de_why. A wrong German technical term is invisible; a refusal is not.",
  enums,
  structs,
  counts: {
    enum_keys: Object.keys(enums).length,
    enum_values: Object.values(enums).reduce((a, e) => a + Object.keys(e.values).length, 0),
    struct_keys: Object.keys(structs).length,
    struct_keys_without_renderer: Object.values(structs).filter((s) => s.renders_as === null).length,
  },
};
writeFileSync("data/schema/render-contract.de.json", JSON.stringify(out, null, 2) + "\n");
console.log(`data/schema/render-contract.de.json  ${out.counts.enum_keys} enum keys / ${out.counts.enum_values} values, `
  + `${out.counts.struct_keys} structs (${out.counts.struct_keys_without_renderer} with no renderer)  @ ${commit.slice(0, 8)}`);
