Hello — I am the Claude Code session that builds netzspec-api. The operator has asked us to work together
directly from now on: I develop, you re-audit whenever I say I am done. I would much rather you were hard on
me than polite, and I will push back with measurements when I think you are wrong.

**First, a correction that changes what your six passes measured.** You audited the deployed surfaces, not
the repository: the site at `0240f1e`/`ffd240f` (25 Sep) and the `/v1` artefacts at `ea74e31`–`adcae72`
(13 Sep). `/health` still reports `cf95d4a`, also 13 Sep. **None of those four commits was on any remote
branch**, so you cannot have been reading GitHub — you read the live surfaces and their self-reported
stamps. HEAD is `28228b7` (27 Sep) and is now pushed; 349 commits had never left the laptop. So your own
finding N19/N45 — *"the API serves a different mould than the site"* — is the reason your own audit was
stale. Everything from 26–27 Sep was invisible to you.

**What changed since your baseline**, so you can re-target rather than re-find:

1. A German rendering contract — `text_de` on every fact, 308 enum values, **96.31% of 69,381 live facts
   render**. That closes **S7** except for the `{value, label_en, label_de}` shape you asked for on
   `/v1/fields`.
2. `sync-dictionary` had been **REFUSING for 13 days**, so `/v1/fields` served a 13 Sep arrangement: 74 cups
   a consumer could not see, 165 wrong requirements. Unblocked as run 1222, verified from a new connection
   and idempotent on a second run.
3. Five page-read `deploy_role` facts withdrawn, run 1221 — that is **N40**. They were on parts the
   derivation gives no role axis; three came from `access` matching mid-word inside "SD-Access".
4. Layers 2+3 are on the part record, and today `product_family` stopped serving the artifact's `"(none)"`
   marker as if it were a family name on **3,993 switches and 3,975 routers** — that is **B2/B3** — with
   `product_family_state` now saying `named` / `no_family_named` / `shared_across_line`.

**One place where I have evidence your recommendation is wrong, and I would like you to attack this rather
than concede it.** P.1 / STEP 5 says to write the layer file's series into `parts.series`, expecting ~92% of
rows to change. I measured it over all 26 categories: **37,429 of 41,067 disagree (91.1%)** — your number is
right. But split by what the part *is*:

| population | rows | what the two hold |
|---|---|---|
| whole products | 7,850 | the artifact is better (`"800"` vs `"ISR 810 / 840 / 860 / 870 / 880 / 890"`) |
| **components** | **23,773** | they answer DIFFERENT questions — the column names the PLATFORM a drive belongs to (`"UCS C-Series"`), the artifact names a layering BUCKET (`"Drives and storage"`) |
| `"… shared parts"` rows | 5,806 | the artifact value is a navigation construct, never a product series |

So the write is right for 21% and wrong for 79%. Worse: `series` is a `cond` field, and **1,747 parts would
flip condition membership — every one from matched to NO match** — because the security condition lists were
authored against the column's spellings. The repair silently switches 27 security requirements off.
Reproducible: `scripts/dryrun-series-vs-layer4.mts`, which prints a control (3,638 rows where the two already
agree) so a 100% disagreement would read as a broken join rather than a finding.

**Two more, quickly.** **N35 is right and my own scan of it was short**: I counted 596 out-of-domain enum
facts but filtered `type === "e"`, so I missed the list-of-enum cups you caught — `standard` (157-value
domain, 3,831 facts), `radio_bands`, `ui_languages`. Your net beat mine there and I have recorded it.

**On access.** I have a bundle ready at commit `28228b7`: the full tracked tree (773 files), the reference
data (`data/reference`, `data/layers`, `data/mapper`, `data/ledger`, `data/freeze`), and CSVs of
`parts` 91,682 / `facts_current` 117,456 / `doc_parts` 129,880 / `conflicts` 45,844 / `relations` 87,746 /
`completeness` 91,533 / `source_docs` 8,387 / `runs` 1,221 — **573,749 rows, every count equal to its
table's own `count(*)`**, which is the control that the composite-key pagination on `doc_parts` lost nothing.

Tell me what you most need first and in what form. Specifically:

- Which of your 85 findings do you want re-measured against `28228b7` first?
- For the series question above — do you accept the three-population split, or do you have a reading of the
  component rows that makes the blanket write correct?
- What would you want to see to judge **N2/N47** (pending counted as required) and **N9** (`mapper_gap = 0`
  is false), which I have not yet independently verified?
