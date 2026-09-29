// src/core/structExamples.ts — the canonical example each struct shape must be able to read.
//
// A STRUCT CUP IS DEFINED ONLY IF A PARSER STANDS BEHIND ITS SHAPE. Until 28 Sep 2026
// `required_cup_defined` asked a struct for one thing: does a `shape` STRING exist. A shape string is
// documentation, and this repo's oldest named defect is a declared constant nothing reads:
//
//   `antenna_gain` declares `{ band24: n, band5: n }`, is REQUIRED of 216 wireless antennas, and
//   `normalizeField` returns STRUCT_UNPARSED for every value the vendor prints — INCLUDING the exact
//   two-band form its own shape describes, and including a bare "6 dBi". The sheets print it (163
//   labels containing "gain", 555 occurrences) and seven labels map to the cup (125 occurrences), so
//   it is not unpublished and it is not unmapped. It refuses everything it is handed.
//
// That is `.*` in reverse: a rule so permissive it matches nothing. `ports` on switches was the same
// defect and cost "the single largest normalise rejection in the pipeline" before its strict parser was
// written — and measured today, `ports` PARSES (its top stored raw, "CBS350 Managed 48-port GE, Full
// PoE, 4x10G SFP+", normalises), so the parser landed and this check will not report it. That is worth
// stating because it was predicted to go red: the prediction was reasonable and the corpus disagreed.
//
// EVERY EXAMPLE HERE IS A REAL STRING. Five come from the top stored `raw` of that key in the live
// store, counted; `antenna_gain`'s comes from the datasheet label inventory, because the cup holds no
// fact to take one from — which is the whole point of it. A hand-written example that no source ever
// prints would test the parser against a shape nobody publishes, which is the fixture-from-memory
// defect this repo has paid for twice.

/** key -> a real printed value that the cup's parser must accept, with where it came from. */
export const STRUCT_EXAMPLES: Record<string, { raw: string; from: string }> = {
  ports: { raw: "CBS350 Managed 48-port GE, Full PoE, 4x10G SFP+", from: "top stored raw, live store" },
  uplink_ports: { raw: "2 SFP+", from: "top stored raw, live store" },
  // THE FULL STRING, and the first version of this line was TRUNCATED — I copied it out of my own survey
  // output, which prints raws at .slice(0, 52), and the cut form REFUSES while the real one parses. A
  // fixture taken from a display is a fixture from memory; the check caught it on its first run.
  dimensions: { raw: "(H) 4.4 cm x (W) 44.2 cm x (D) 38.5 cm (1.73” x 17.4” x 15.2”)", from: "top stored raw, live store, 14 occurrences" },
  reach_max: { raw: "10 km", from: "top stored raw, live store" },
  video_quality_max: { raw: "Up to 1080p HD w/ H.264, up to 20fps", from: "top stored raw, live store" },
  // THE ONE THE CHECK EXISTS FOR. No stored fact anywhere, so the example is what the vendor PRINTS:
  // the label "Antenna Gain" carries "● 2.4G: 0.6 dBi ● 5G: 0.8 dBi" (14 occurrences) and "Peak Gain"
  // carries "6 dBi" (7). Both must parse for the cup to be fillable; today neither does.
  // 29 Sep 2026: the raw is now the PRINTED form the comment above quotes ("2.4G", not "2.4 GHz"). The paraphrase stood in
  // for it until the parser existed, and a parser proven on the paraphrase refused the vendor's real string.
  antenna_gain: { raw: "● 2.4G: 0.6 dBi ● 5G: 0.8 dBi", from: "datasheet label inventory, 14 occurrences" },
};

/**
 * The struct keys with NO example, named rather than assumed fine.
 *
 * Three of these are required of no (category, kind), so the check has nothing to judge for them; the fourth,
 * `max_resolution`, IS conditional in four categories and is reported as UNTESTED rather than passed —
 * but "not required" and "has a parser" are different facts, and folding the first into a pass would be
 * the `sampled`-carrying-`checked` shape. If one is ever promoted to required it arrives here as a
 * named gap rather than as a silent pass, because the check reports what it could not test.
 */
export const STRUCT_NO_EXAMPLE: readonly string[] = [
  "bidi_wavelengths",     // 0 stored facts; a BiDi pair's wavelengths, printed as "1490/1550 nm" on optics we hold none of
  "expansion_io",         // 0 stored facts
  "max_resolution",       // 0 stored facts, and CONDITIONAL in four categories — so this one IS judged by
                          // required_cup_defined and is reported as untested rather than passed. It needs a real
                          // printed example before its parser can be said to exist either way.
  "display_resolution",   // 0 stored facts
];
