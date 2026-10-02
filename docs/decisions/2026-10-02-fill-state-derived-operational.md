# 2026-10-02 — a seventh fill state, `derived_operational`; the Meraki camera exception expires

Reviewer rulings of 30 Sep 2026 (~13:30 UTC), folded into (b') by the reviewer's order of 2 Oct.

## (ii) `derived_operational`

"A shipping-class weight is not a spec and not a mined value; filed under mined_non_spec_doc it would make the quality panel look
worse for the wrong reason. Shown apart, excluded from filled %."

- `scripts/mould-verify.mts`: the fill-state classifier is ONE module-level function (`fillState`) used by fill_state_partition's
  run AND its self-test (the self-test used to carry a copy of the rule). `OPERATIONAL_DERIVATIONS = {derived:shipping-class}` is
  tested FIRST, because its witness is a `reference_table` document, which the doc-type branch would otherwise call
  `mined_non_spec_doc` (that is where the 7,235 shipping-class facts of run 1465 had landed: 520 -> 7,755).
- The partition has SEVEN states; the history's vector keeps its order with the new state appended (an older record reads 0 for it).
- The filled share is computed over `total - derived_operational`: an operational value is neither numerator nor denominator, and
  it is printed apart.
- `src/core/mouldContract.ts` slot_states gains `derived_operational`: contract c7b80d502adb8305 -> 19704b71cf482f48, every
  artefact re-stamped (ONE BUILD), arrangementFreeze 39/0.

## The Meraki camera exception expires

"meraki.security-camera: confirmed as a recorded exception, expiring when physical-security is created (the Meraki ruling), not
standing."

- `data/reference/kind-granularity-2026-09-13.json`: the entry carries `expires_with_category: "physical-security"` and the
  reviewer's confirmation in its status.
- `src/core/kindGranularity.ts` `basisFails`: an exception whose `expires_with_category` has a profile is EXPIRED -- the judge
  names it, so term 13 fails the kind instead of the exception standing silently. An expiry written only as a note is a sentence.
- `tests/cupLedger.test.ts`: a CONTROL (the exception holds today: no physical-security profile exists) and a SABOTAGE (with
  physical-security added to the known categories the judge returns EXPIRED). Removing the expiry check turns exactly the
  sabotage red (2,460/1); restored byte-identical.
