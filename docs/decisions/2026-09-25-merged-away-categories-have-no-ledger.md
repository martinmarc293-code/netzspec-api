# A merged-away category has no cup ledger, and a stale one is why the report would not rebuild

**25 Sep 2026 · cisco lane · decided and applied on this commit**

## What was wrong

`data/ledger/` held **17** files. The store holds live Cisco hardware in **15** categories:

```
servers-unified-computing 8263 · switches 7224 · routers 5109 · wireless 3907 · video 3261
collaboration-endpoints 2938 · transceiver 2109 · security 1982 · hyperconverged-systems 1643
hyperconverged-infrastructure 1216 · optical-networking 1158 · interfaces-modules 1079
storage-networking 661 · unified-communications 426 · meraki 91                      = 41,067
```

`conferencing` and `data-center-networking` hold **none**. They were merged away earlier today — runs 1204 / 1207 /
1212, `conferencing -> collaboration-endpoints` and `data-center-networking -> switches`, recorded in
`tests/layersStanding.test.ts` `MERGE_CANDIDATES` and in `data/reference/layers-cross-claims.json`. Their layer pages
hold no row. `conferencing` still has one live *software* part; `data-center-networking` has no part of any vendor.

Their ledger, census and mapper-trace files stayed behind — and today's rebuild (commit `5059637`) wrote them AGAIN,
each with `totals.parts: 0` and a full set of kinds: `cisco-conferencing.json` describes **30 kinds over no parts**,
`cisco-data-center-networking.json` **18**. That is worse than a stale file, because the file is fresh: it names a
current commit and a current profile hash, and says nothing true. Nothing deleted them, because nothing was
responsible for noticing: `build-cup-ledger.mts` writes whatever category it is handed, and `build-completeness.mts` emits a block only
for a category that has parts. So the report's own cross-check was correct and unfixable from either side —

```
hardware_parts: ledgers with no category block: conferencing, data-center-networking
```

— and `tests/completeness.test.ts` did not fail, it **crashed**, on `cc.ledgers!["conferencing"].kinds[<kind>]` being
`undefined` at line 134: the first category of the committed report is `conferencing`, whose ledger no longer describes
any kind the report knows. A crash before the first assertion is a suite that proves nothing, which is how the two
files survived a fortnight of green-looking runs.

## The decision

**A merged-away category is not an empty compartment of the tray. It is a compartment that was removed.** The parts it
held are in another category and are counted there; a ledger for it would state nothing and could not be checked
against anything. So:

1. `data/ledger/cisco-conferencing.json`, `data/ledger/cisco-data-center-networking.json` and their `data/census/`
   and `data/mapper/` counterparts are **deleted** on this commit.
2. `scripts/build-cup-ledger.mts` **refuses** a category with no live hardware part of the vendor, naming the merge
   record. Rebuilding all of `LEDGER_KINDS` is the obvious thing for the next person to do, so the refusal has to say
   why two of them are not in the arrangement any more instead of quietly writing them back.
3. `LEDGER_KINDS` is **not** touched. Its docstring says what it is — *every kind a category's axis can name,
   including kinds no part holds today* — and `partKind.ts` dispatches on it for any row that arrives in one of those
   categories. Removing the entries would make a mis-filed row throw instead of being classified and moved.
4. The two stale `CEILING` entries in `tests/cupLedger.test.ts` (`conferencing: 2.9`, `data-center-networking: 0.0`)
   are removed with them: a ratchet entry for a category that no longer has a ledger is an allowlist hole.

## What this does not decide

Whether either category ever comes back. If parts are filed there again the refusal stops firing on its own, the
ledger builds, and the report gains a block — nothing here has to be undone. That is the reason the refusal is keyed
on **live parts** and not on a list of merged-away names: a hand-kept list of what no longer exists drifts exactly
like the one this fixes.
