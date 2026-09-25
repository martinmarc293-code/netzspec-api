// tests/renderContract.test.ts — the contract that turns a stored value into one German cell.
//
// Operator, 25 Sep 2026: "yes add the german values and rendering contract". The consumer is Claude, reading a
// category out of this API and emitting a JTL-Shop import CSV, so what this file defends is that a consumer
// never has to INVENT a rendering — and, where the mould genuinely cannot say, that it gets a refusal with a
// reason rather than a plausible guess.
//
// THE TWO THINGS THAT MAKE THIS MORE THAN A SNAPSHOT TEST:
//  1. COVERAGE IS DRIVEN FROM THE DICTIONARY, and from the per-category DOMAIN_OVERRIDES as well as the global
//     domain. The first version of the contract read only the global domain, answered "0 uncovered", and then
//     refused 1,742 live facts. A check that cannot reach the instance you already have is measuring its own net.
//  2. THE SABOTAGE IS A DOMAIN THAT GREW. An enum value added tomorrow must arrive as a named failure, never as
//     an English slug in a German shop — that is the whole reason the enum branch refuses instead of passing the
//     raw value through.
import {
  renderValue, enumValueDe, uncoveredEnumValues, formatNumberDe, formatRangeDe,
  LIST_SEPARATOR, BOOLEAN_DE, ENUM_DE, STRUCT_DE,
} from "../src/core/renderContract.js";
import { FIELD_DICTIONARY, DOMAIN_OVERRIDES } from "../src/core/fieldSchema.js";

let pass = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) pass++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };
const eq = (name: string, got: unknown, want: unknown) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// ---- COVERAGE: every enum value the schema can produce has a German rendering ---------------------------------
const gaps = uncoveredEnumValues();
check(`every enum value in every domain (global AND per-category) has a German rendering`, gaps.length === 0,
  gaps.slice(0, 8).map((g) => `${g.key}=${g.value}`).join(", "));

// The check must actually be able to SEE the override domains — proven by counting what only they carry.
const overrideOnly = Object.values(DOMAIN_OVERRIDES).flatMap((keys) => Object.entries(keys)
  .flatMap(([k, dom]) => dom.filter((v) => !((FIELD_DICTIONARY as Record<string, { domain?: unknown }>)[k]?.domain as string[] | undefined)?.includes(v)).map((v) => `${k}=${v}`)));
check(`the coverage check reaches values that ONLY a category override declares (${overrideOnly.length} of them)`,
  overrideOnly.length > 0 && overrideOnly.every((kv) => enumValueDe(kv.split("=")[0], kv.split("=").slice(1).join("=")) !== null),
  overrideOnly.filter((kv) => !enumValueDe(kv.split("=")[0], kv.split("=").slice(1).join("="))).slice(0, 6).join(", "));

// SABOTAGE: a domain that grew without the contract growing with it must be NAMED, not passed through.
{
  const tampered = JSON.parse(JSON.stringify(FIELD_DICTIONARY)) as typeof FIELD_DICTIONARY;
  (tampered as Record<string, { domain?: string[] }>).airflow.domain!.push("__new_direction__");
  const found = uncoveredEnumValues(tampered);
  check("SABOTAGE a value added to a domain is reported uncovered",
    found.some((g) => g.key === "airflow" && g.value === "__new_direction__"), JSON.stringify(found.slice(0, 4)));
  check("SABOTAGE …and the untampered dictionary still reports none", uncoveredEnumValues().length === 0);
}
// SABOTAGE: an enum key with no covering at all is named as such.
{
  const tampered = JSON.parse(JSON.stringify(FIELD_DICTIONARY)) as Record<string, unknown>;
  tampered.__new_enum__ = { key: "__new_enum__", de: "x", en: "x", type: "e", domain: ["a"], etim: [], icecat: null };
  const found = uncoveredEnumValues(tampered as typeof FIELD_DICTIONARY);
  check("SABOTAGE an enum key the contract does not cover at all is named",
    found.some((g) => g.key === "__new_enum__" && /no covering/.test(g.value)));
}

// ---- GERMAN NUMBERS -------------------------------------------------------------------------------------------
eq("a decimal takes a comma", formatNumberDe(0.075), "0,075");
eq("an integer takes no separator at all", formatNumberDe(1234), "1234");
eq("…and a large decimal takes no thousands separator either", formatNumberDe(1234.5), "1234,5");
check("no thousands separator is deliberate: a dot inside a cell is read as a decimal point by an English importer",
  !formatNumberDe(1234567.5).includes("."));
eq("a range reads 'bis' and carries the unit once", formatRangeDe(-5, 45, "°C"), "-5 bis 45 °C");

// ---- THE LIST SEPARATOR IS NOT A CSV DELIMITER ----------------------------------------------------------------
check("the list separator is neither a semicolon nor a comma (German Excel writes CSV with ';')",
  !LIST_SEPARATOR.includes(";") && !LIST_SEPARATOR.includes(","), JSON.stringify(LIST_SEPARATOR));
eq("booleans are Ja/Nein", [BOOLEAN_DE.true, BOOLEAN_DE.false], ["Ja", "Nein"]);

// ---- ONE RENDERING PER TYPE, AGAINST THE SHAPE THE STORE ACTUALLY HOLDS ----------------------------------------
const text = (k: string, v: unknown, u?: string | null) => { const r = renderValue(k, v, u); return r.ok ? r.text : `REFUSED: ${r.why}`; };
eq("s  a string passes through", text("cpu", "Intel Xeon Gold 6338"), "Intel Xeon Gold 6338");
eq("n  a number takes its unit", text("weight", 1.5, "kg"), "1,5 kg");
eq("nr a range comes from the {min,max} the store holds", text("temp_operating", { min: -5, max: 45 }, "°C"), "-5 bis 45 °C");
eq("b  a boolean is Ja", text("ddm", true), "Ja");
eq("e  an enum is the German word", text("airflow", "front-to-back"), "Vorne nach hinten");
eq("e  a technical token is its PRESENTED form", text("connector", "lc-duplex"), "LC Duplex");
eq("ls a list joins on the stated separator", text("certifications", ["CE", "RoHS"]), `CE${LIST_SEPARATOR}RoHS`);
eq("struct dimensions", text("dimensions", { h: 44.5, w: 442, d: 300 }, "mm"), "H 44,5 × B 442 × T 300 mm");
eq("struct ports", text("ports", [{ speed: ["1G"], anzahl: 24, port_typ: "rj45" }]), "24 × RJ45 1G");
// reach_max's DECLARED shape is `list{ medium, distanz }` and the store holds {m, values_m[]} — this renderer is
// written against the store, and this case is what pins that.
eq("struct reach_max is rendered from the STORED shape, not the declared one", text("reach_max", { m: 100, values_m: [100] }, "m"), "100 m");

// ---- REFUSALS: what the mould cannot say, it must not guess ----------------------------------------------------
const refused = (k: string, v: unknown, u?: string | null) => { const r = renderValue(k, v, u); return r.ok ? null : r.why; };
check("an unshaped struct is REFUSED by name (expansion_io declares no shape at all)",
  /no renderer/.test(refused("expansion_io", { anything: 1 }) ?? ""), String(refused("expansion_io", { anything: 1 })));
check("an enum value outside every domain is REFUSED, never passed through as English",
  /no German rendering/.test(refused("airflow", "sideways") ?? ""), String(refused("airflow", "sideways")));
check("a struct payload that does not match the stored shape is refused",
  /did not match/.test(refused("dimensions", { h: 1 }, "mm") ?? ""));
check("a number that is not a number is refused", refused("weight", "heavy", "kg") !== null);
check("a list key holding a scalar is refused (2,075 legacy rows do exactly this)",
  /must be an array/.test(refused("standard", "IEEE 802.3z / 802.3ab 1000BASE-T") ?? ""));
check("a key that is not in the dictionary is refused", /not in the dictionary/.test(refused("__nope__", "x") ?? ""));

// CONTROL for the refusals: the same predicate must ACCEPT the healthy case, or every refusal above is decoration.
check("CONTROL the same calls render when the payload is right",
  renderValue("expansion_io", {}).ok === false && renderValue("dimensions", { h: 1, w: 2, d: 3 }, "mm").ok === true
    && renderValue("airflow", "reversible").ok === true && renderValue("standard", ["1000base-t"]).ok === true);

// ---- THE CONTRACT DESCRIBES THE WHOLE SCHEMA, NOT A SAMPLE ------------------------------------------------------
const enumKeys = Object.keys(FIELD_DICTIONARY).filter((k) => (FIELD_DICTIONARY as Record<string, { type?: string; domain?: unknown }>)[k].type === "e"
  && Array.isArray((FIELD_DICTIONARY as Record<string, { domain?: unknown }>)[k].domain));
check(`every enum key in the dictionary has a covering (${enumKeys.length} keys)`,
  enumKeys.every((k) => !!ENUM_DE[k]), enumKeys.filter((k) => !ENUM_DE[k]).join(", "));
const structKeys = Object.keys(FIELD_DICTIONARY).filter((k) => (FIELD_DICTIONARY as Record<string, { type?: string }>)[k].type === "struct");
const structNoRenderer = structKeys.filter((k) => !STRUCT_DE[k]);
check(`every struct key has a renderer EXCEPT the ones that declare no shape (${structKeys.length} keys)`,
  structNoRenderer.every((k) => !(FIELD_DICTIONARY as Record<string, { shape?: unknown }>)[k].shape),
  `no renderer and yet a declared shape: ${structNoRenderer.filter((k) => (FIELD_DICTIONARY as Record<string, { shape?: unknown }>)[k].shape).join(", ")}`);
check(`…and the ones with no renderer are named here rather than left to be discovered: ${structNoRenderer.join(", ") || "(none)"}`, true);

console.log(misses.join("\n"));
console.log(`    render contract: ${pass} passed, ${misses.length} missed (${enumKeys.length} enum keys, ${structKeys.length} structs, 6 sabotage/control cases)`);
if (misses.length) process.exit(1);
