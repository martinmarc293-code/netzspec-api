# Arrangement decisions

One file per decision (or per batch of related decisions), named `YYYY-MM-DD-<topic>.md`. Required after the
phase-1 freeze (13 Sep 2026) for any change to: a required cup, a kind's cup set, a gate, a field's
type/unit/domain/band, or a spec-bearing document class. See `CLAUDE.md` "The arrangement is frozen".

Each record states: what changed; the measurement that forced it, across ALL vendors on live parts
(`/v1/fields` `facts_current_by_vendor`, the census `would_refuse` replay); stored values that now refuse, by
vendor, and whether the sync ran with `--allow-refusing`; the commit that carries the rebuilt ledgers,
censuses, traces, completeness report and freeze file.

Cups that stay free text (type `s`, no domain) on purpose are listed here by decision, because the standing
test allows a free-string required cup only with such a record.
