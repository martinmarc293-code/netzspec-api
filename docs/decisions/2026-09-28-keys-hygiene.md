# `keys_hygiene`: four active keys, two of them unused for weeks, and no column that says who holds one

**Status: a measurement for the reviewer and the operator. NOTHING HAS BEEN REVOKED OR CREATED.**
Key material was never selected — `key_hash` is not read by the query behind this file, because a hash or
even a prefix in a transcript is a credential in a transcript.

## The four active keys, metadata only

| id | name | scopes | created | last used | |
| ---: | --- | --- | --- | --- | --- |
| 1 | `netzspec` | read | 03 Sep | **03 Sep** | unused for 25 days |
| 3 | `netzspec` | read | 03 Sep | **28 Sep** | the one actually in use |
| 6 | `claude-web` | read | 08 Sep | **08 Sep** | unused for 20 days |
| 16 | `reviewer-2026-09-27` | read | 27 Sep | 27 Sep | |

Twelve more rows are revoked, most of them same-day probes (`tmp-probe`, `tmp-revoketest`, `tmp-urlprobe`).

## The two findings, and why neither is mine to act on

**Ids 1 and 3 share the name `netzspec` and only 3 is in use.** That is precisely the hazard this catalogue
has already been bitten by — *"a key rotation had revoked a row nobody held while the exposed key stayed
live"*. A rotation keyed on the NAME cannot tell them apart, and the one it picks is a coin toss; the
last-used dates are the only thing that distinguishes them and nothing enforces that a rotation reads them.

**Id 6 `claude-web` has not been used since the day it was made**, and its two same-named siblings (4 and 5)
were revoked that same day. It has the shape of the one that was meant to be revoked and was not.

Both are revocations of live credentials. Revoking the wrong `netzspec` takes the API down for whatever
holds id 3, and this session has no way to know who that is — which is the third finding:

**`api_keys` has no holder column at all.** Its columns are `id, name, key_hash, scopes, created_at,
last_used_at, revoked_at`. "Who holds this" is carried only by the NAME, which is free text, is duplicated
twice over, and is what a rotation reads. The check's phrase "active with no recorded holder" is not a
missing value — there is nowhere to put one.

## What would close it

1. **A `holder` column** (migration, additive nullable, no backfill — the same shape as `sub_brand`), filled
   deliberately, one row at a time, by whoever knows. A name is not a holder.
2. **A unique index on the active name** — `UNIQUE (name) WHERE revoked_at IS NULL` — so two live keys can
   never share one again. It would refuse today, which is the point: it names the existing collision instead
   of letting the next rotation find it.
3. **Then, and only then, the two revocations**, by the operator, on ids they can attribute.

Order matters: revoking first, while the name is still the only identifier, is the failure mode this is
about.
