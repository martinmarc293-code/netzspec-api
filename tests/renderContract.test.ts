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
  enumDomainUnion,
} from "../src/core/renderContract.js";
import { FIELD_DICTIONARY, DOMAIN_OVERRIDES, ENUM_LABELS } from "../src/core/fieldSchema.js";

let pass = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) pass++; else misses.push(`    MISS ${name}${detail ? " — " + detail : ""}`); };
const eq = (name: string, got: unknown, want: unknown) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// ---- COVERAGE: every enum value the schema can produce has a German rendering ---------------------------------
// AN EXACT RATCHET, NOT A ZERO (27 Sep 2026). This asserted `gaps.length === 0` and passed for a fortnight
// because `enumDomainUnion` filtered `type !== "e"`, so every list-of-enum key was invisible: 458 of 766
// domain values had no German and the check said none. Corrected, the honest state is 7 uncovered KEYS
// carrying 458 values. The number is exact and fails in BOTH directions on purpose — cover `radio_bands`
// and this goes red telling you to lower it, which is the only way the figure stays true.
const gaps = uncoveredEnumValues();
const UNCOVERED_KEYS = 7, UNCOVERED_VALUES = 458;
const gapValues = gaps.reduce((n, g) => n + (Number(/— (\d+) domain values/.exec(g.value)?.[1]) || 1), 0);
check(`exactly ${UNCOVERED_KEYS} enum keys have no German rendering, carrying ${UNCOVERED_VALUES} domain values`,
  gaps.length === UNCOVERED_KEYS && gapValues === UNCOVERED_VALUES,
  `${gaps.length} keys / ${gapValues} values: ${gaps.map((g) => g.key).join(", ")}`);
check(`CONTROL the coverage check can SEE list-of-enum keys, which it could not before`,
  gaps.some((g) => g.key === "cellular_bands") && gaps.some((g) => g.key === "standard"),
  gaps.map((g) => g.key).join(", "));

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
  check("SABOTAGE …and the untampered dictionary still reports its own known count, not zero", uncoveredEnumValues().length === UNCOVERED_KEYS);
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
eq("e  a technical token is its PRESENTED form, hyphenated as the dictionary's own German is", text("connector", "lc-duplex"), "LC-Duplex");
// THE UCS SERVER FORM FACTORS, and why they are here. `form_factor`'s domain is per category: optic cages in
// `transceiver`, and blade-half / blade-full / compute-node / router-module in the three UCS categories. Those four
// fell through `presentFormFactor` — a rule written for cages — and rendered as "BLADE-HALF", "COMPUTE-NODE",
// "ROUTER-MODULE": shouting English in a German shop cell, past a coverage check that reported 0 uncovered.
eq("e  a UCS server form factor is GERMAN, not the slug uppercased", text("form_factor", "blade-half"), "Blade, halbe Breite");
eq("e  …and the other three", [text("form_factor", "blade-full"), text("form_factor", "compute-node"), text("form_factor", "router-module")],
  ["Blade, volle Breite", "Compute-Node", "Router-Modul"]);
eq("e  an optic cage still presents as its token", [text("form_factor", "qsfp-dd"), text("form_factor", "sfp-plus")], ["QSFP-DD", "SFP+"]);
// A RULE MUST REFUSE WHAT IT WAS NOT WRITTEN FOR, or the coverage check is vacuous for everything it covers
// (measured: 159 values have a map entry, 149 are rule-only). This is what makes the gap visible at all.
check("a rule REFUSES a value outside its shape, so the coverage check can see the gap",
  enumValueDe("form_factor", "__not_a_cage__") === null && enumValueDe("spatial_streams", "not-a-stream") === null
    && enumValueDe("ip_rating", "nonsense") === null,
  JSON.stringify({ ff: enumValueDe("form_factor", "__not_a_cage__"), ss: enumValueDe("spatial_streams", "not-a-stream"), ip: enumValueDe("ip_rating", "nonsense") }));
check("CONTROL each of those rules still covers its OWN shape",
  enumValueDe("form_factor", "cfp2") === "CFP2" && enumValueDe("spatial_streams", "4x4:4") === "4×4:4"
    && enumValueDe("ip_rating", "ip67") === "IP67" && enumValueDe("ip_rating", "ip69k") === "IP69K");
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
// This asserted `/no German rendering/` until 26 Sep, when the refusal gained three causes. That wording was the
// CONTRACT-GAP sentence, and "sideways" is not one — it is not in airflow's domain at all. Assert the intent (a
// refusal, and the English slug never reaching a German cell) plus the cause, not one sentence.
check("an enum value outside every domain is REFUSED, never passed through as English",
  renderValue("airflow", "sideways").ok === false && !("text" in renderValue("airflow", "sideways"))
  && /not a value of this key's domain at all/.test(refused("airflow", "sideways") ?? ""), String(refused("airflow", "sideways")));
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

// ---- AN UNRENDERABLE ENUM HAS THREE CAUSES AND THREE REPAIRS (26 Sep 2026) ----------------------------------------
// The single old message said "add it to ENUM_DE" for all of them. The JTL consumer lens found 99
// `antenna_connector` facts holding "RP-TNC" against a domain of `rp-tnc`, so the message was sending a reader to
// add a case variant to the German contract — legitimising an out-of-domain value and putting two spellings of one
// connector on a shop page. These cases pin which sentence each cause gets; the domain values come from the real
// dictionary, so a fixture cannot encode a relationship the schema does not have.
{
  const dom = [...(enumDomainUnion().get("antenna_connector") ?? [])];
  check(`CONTROL antenna_connector's domain is lowercase, which is what makes "RP-TNC" a variant (${dom.join(", ")})`,
    dom.includes("rp-tnc") && !dom.includes("RP-TNC"));
  const variant = renderValue("antenna_connector", "RP-TNC", null, "e");
  check(`an UNNORMALISED variant is named as one and sent to renormalize, not to ENUM_DE`,
    !variant.ok && /UNNORMALISED variant of the domain value "rp-tnc"/.test(variant.why ?? "") && /Do NOT add it to ENUM_DE/.test(variant.why ?? ""),
    JSON.stringify(variant));
  const junk = renderValue("antenna_connector", "E: External antennas", null, "e");
  check(`a value nowhere near the domain is called a DATA defect, not a contract gap`,
    !junk.ok && /not a value of this key's domain at all/.test(junk.why ?? "") && !/ENUM_DE/.test(junk.why ?? ""),
    JSON.stringify(junk));
  // A GENUINE contract gap must still say ENUM_DE. Built by proving the key is uncovered rather than assuming:
  // every dictionary domain value is covered today, so the gap case needs a key whose covering is missing, and
  // there is none — so this asserts the branch on a synthetic dictionary instead of pretending to find one live.
  const synthetic = { zz_fake_enum: { key: "zz_fake_enum", de: "X", en: "X", type: "e", domain: ["alpha"], etim: [], icecat: null } } as unknown as typeof FIELD_DICTIONARY;
  const uncovered = uncoveredEnumValues(synthetic);
  check(`CONTROL a key with no covering at all is reported by uncoveredEnumValues, so the gap branch is reachable`,
    uncovered.length === 1 && uncovered[0].key === "zz_fake_enum", JSON.stringify(uncovered));
  check(`CONTROL the live dictionary's uncovered set is the known 7, so the synthetic key above is the one being tested`,
    uncoveredEnumValues().length === UNCOVERED_KEYS, uncoveredEnumValues().map((g) => g.key).join(", "));
}

// ---------------------------------------------------------------------------------------------------
// TWO GERMAN TABLES FOR ONE VALUE, RATCHETED (28 Sep 2026)
//
// `ENUM_DE` here and `ENUM_LABELS` in fieldSchema.ts both spell domain values in German, for different
// consumers, and nothing has ever compared them. Measured the day the connector domains landed: 115 values
// are spelled in both and **32 disagree** — `integrated` is "Fest angeschlossen" in one and "Fest
// konfektioniert" in the other, `fec.none` is "Keine" and "Nicht erforderlich", `mode.duplex` is "Duplex"
// and "Duplex (Zweifaser)". Whether that is a defect is a decision about 32 strings and it is not this
// check's to make: a buyer meeting two spellings of one connector on two surfaces is the same shape as the
// `rp-tnc` drift recorded above, and picking the survivor is the owner's call.
//
// So it is a RATCHET, exactly like `uncoveredEnumValues`'s recorded debt: the number may not GROW, and when
// it falls the number here changes with a line saying which value was settled. A new value spelled in both
// tables two different ways now fails on the commit that adds it, which is the one moment its author knows
// which spelling they meant. Without this, the 21 connector values added today could have drifted the same
// way in silence — two of them did, and only aligning them by hand stopped it reaching the page.
// WHAT IT CANNOT SEE IS ITS OWN NUMBER, and it is large: the comparison only reaches keys present in BOTH
// tables — 17 of ENUM_DE's 31. The other 14 (antenna_connector, license_type, audio_codecs, drive_interface…)
// are spelled here and nowhere else, so no second spelling of them can exist to disagree with, and the
// ratchet says nothing about them rather than counting them clean. The first sabotage I wrote for this check
// put a second spelling into `antenna_connector` and the suite stayed GREEN — not a dead check, a check
// structurally unable to reach that key, which is exactly the thing worth printing beside the number.
{
  const RECORDED_DRIFT = 0;   // 32 until ENUM_DE was derived from the dictionary (28 Sep 2026); a second copy no longer exists to disagree
  let sharedValues = 0;
  const disagree: string[] = [];
  for (const [key, vals] of Object.entries(ENUM_LABELS)) {
    const m = (ENUM_DE[key] as { map?: Record<string, string> } | undefined)?.map;
    if (!m) continue;
    for (const [v, pair] of Object.entries(vals)) {
      if (!(v in m)) continue;
      sharedValues++;
      if (m[v] !== pair.de) disagree.push(`${key}.${v}: "${m[v]}" vs "${pair.de}"`);
    }
  }
  const unseen = Object.keys(ENUM_DE).filter((k) => !(k in ENUM_LABELS));
  check(`the two German tables disagree on exactly the ${RECORDED_DRIFT} values recorded, over ${sharedValues} spelled in both ` +
    `(${unseen.length} ENUM_DE keys are spelled in ONE table only and are NOT compared: ${unseen.slice(0, 4).join(", ")}…)` +
    (disagree.length === RECORDED_DRIFT ? "" : ` — got ${disagree.length}: ${disagree.slice(0, 4).join("; ")}`),
    disagree.length === RECORDED_DRIFT);
  // NOT VACUOUS: if the overlap ever emptied — a rename, a table moved — the count would be 0 and the
  // ratchet would read as clean while comparing nothing. The denominator is asserted too.
  check(`the German-table comparison has values to compare (${sharedValues} spelled in both)`, sharedValues >= 100);
}

console.log(misses.join("\n"));
console.log(`    render contract: ${pass} passed, ${misses.length} missed (${enumKeys.length} enum keys, ${structKeys.length} structs, 6 sabotage/control cases, 5 enum-refusal-cause cases)`);
if (misses.length) process.exit(1);
