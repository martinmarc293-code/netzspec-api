// src/core/derivedFillPaths.ts — the registered derivations: a cup whose tap is a function of data the store
// already holds (a SKU, a name), not a source that publishes it.
//
// ONE DEFINITION, because three consumers read it: the ledger builder (a derivation is an observed fill path),
// the completeness report (`fill_path: "derived"`), and the phase-1 freeze (a new or changed derivation moves
// the arrangement). It lived inside scripts/build-cup-ledger.mts until 13 Sep 2026, where nothing else could
// import it — which is how a second copy starts.
//
// A DERIVATION IS A TAP ONLY WHEN IT IS REGISTERED HERE WITH ITS VALIDATION (CLAUDE.md halting rules). The
// `validated` sentence carries the counts that licensed it; changing the function or its population means
// re-running the validation and changing the sentence, on the same commit as the rebuilt ledgers and freeze.
//
// COVERAGE DECIDES REQUIRED, and that is why `layer` is listed and still OPTIONAL: its derivation is exact
// (precision 1.000 over the 1,054 seeds) but speaks for 10.1% of switches, and a cup required of 4,931 parts on
// a path that reaches 500 is still mostly a gap nobody can close.
export const DERIVED_FILL_PATHS: Readonly<Record<string, { by: string; validated: string }>> = {
  form_factor_a: { by: "src/core/breakoutEnds.ts breakoutEndsFor", validated: "51 of 51 breakout-cable parts; SKU table agrees with the text reading on all 32 that have text" },
  form_factor_b: { by: "src/core/breakoutEnds.ts breakoutEndsFor", validated: "51 of 51 breakout-cable parts; SKU table agrees with the text reading on all 32 that have text" },
  breakout_count: { by: "src/core/breakoutEnds.ts breakoutEndsFor", validated: "51 of 51 breakout-cable parts; SKU table agrees with the text reading on all 32 that have text" },
  // round-7 ruling C (12 Sep 2026): the condition bundle_contents was approved under. Counts from the SKU control
  // (an independent reading of the SKU checked against the name parse), over the plan's 277 rows.
  bundle_contents: { by: "src/core/bundleContents.ts bundleContents (the bundle's own name)", validated: "277 plan rows (groups 4, 5, 6, 13): parsed 250, refused 27 with a reason (20 'required, not included', 4 no contents, 1 range, 1 unrecognised item, 1 drive with no unit); SKU control on the 250: agree 175, DISAGREE 2 (the vendor's name and SKU name different servers), SKU names nothing 73. +8 UCS-SPM-MDS rows: agree 8/8. The 101 'Cisco <sku>' rows are refused by rule (the name is only the SKU)" },
  // kind-layer (13 Sep 2026): layer 3. Hand-read rule table, reproduced exactly by the repo module (9,783 of 9,783 rows,
  // same role and same rule as III.0 item 3), 54 witnesses and 5 sabotaged rule lists in tests/deployRole.test.ts.
  deploy_role: { by: "src/core/deployRole.ts deployRole(category, kind, sku, name)", validated: "III.0 item 3 over 9,783 live switch/ap/router/phone rows: members placed 8,881, kind issues (not the kind) 899, null 3 (C8455-G2, C8475-G2, WS-C4928-10GE); name-token control over role-assigned rows found 6 contradictions, all 6 false positives of the control ('Spare Chassis', 'Israel' containing ISR, 'No DECT Radio')" },
  // kind-layer (13 Sep 2026): the length a fixed-length transceiver cable's SKU states. Validation script and per-row
  // output: D:\tmp\kindlayer-impl\4-servers-transceiver\validate-cable-length.mts / cable-length-validation.tsv.
  cable_length: { by: "src/core/cableLength.ts cableLengthFromSku (transceiver `cable` and `breakout-cable` SKUs)", validated: "Cisco transceiver `cable` 183 rows: derived 158, refused 22 with a reason (20 range/family rows, 2 passive copper over 7 m: SFP-H10GB-CU15M/CU25M), no token 3 (PQSF2PXA*); against the 106 stored cable_length facts 106 agree 0 disagree, against the 122 names stating one length 122 agree 0 disagree. Cisco `breakout-cable` 60: derived 55 (4/4 facts, 36/36 names agree), refused 2, no token 3. Other vendors' cables (item-5 dump): derived 118 of 848, 118 of 118 agree with the name, the rest silent — their names carry the length for description mining" },
  layer: { by: "src/core/layerFromSku.ts", validated: "precision 1.000 over the 1,054 seeds (276 agree, 0 disagree); speaks for 500 of 4,931 switches (10.1%) — which is why the cup is optional" },
};
