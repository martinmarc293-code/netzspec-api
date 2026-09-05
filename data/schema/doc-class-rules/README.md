# Per-brand document-class rules

One file per brand: `<brand>.json`, where `<brand>` is the key in
`scraper/brands/ownership.py`. A brand ships its own URL evidence here and
**never edits `src/core/docClass.ts`**.

That is the whole point. On 5 Sep 2026 Juniper classified 348 of 348 documents
and HPE 1 of 67, and the difference was not the shape of their URLs: a third
session had hand-written `["/hct/model/", "vendor_tool"]` into `KEYWORDS` in
that shared TypeScript file because the Juniper session asked it to. With one
brand that is a favour. With more brands arriving and every lane running
concurrently, it makes each new brand a change to a file two other sessions are
editing. A **new file** in this directory cannot conflict with another brand's.

## Shape

```json
{
  "brand": "juniper",
  "rules": [
    {
      "pattern": "/hct/model/",
      "class": "vendor_tool",
      "reason": "apps.juniper.net/hct/model/<SKU> IS the specification table for one model; it carries no document-type code and no 'datasheet' word, so the path is the whole signal."
    }
  ]
}
```

- `pattern` — a lower-case substring tested against the **normalised** URL
  (lower-cased, `_` folded to `-`). Write `-eol-`, never `_eol_`.
- `class` — a member of the `DocClass` union in `src/core/docClass.ts`.
- `reason` — **required.** A rule without one is dropped and named in
  `brandRuleStatus().error`. A URL rule nobody can justify is a guess with
  better paperwork, and the reason is what the next session needs to decide
  whether it still holds.

The filename is the brand. A file declaring a different `brand` than its own
name is refused rather than guessed at: it is a mistake in one of two places and
picking either silently would hide it.

## Where these rules run

**Last**, after every shared rule has declined. Brand rules *extend* the
baseline and can never overrule it, so the Cisco type codes, the keywords and
the terminal abbreviations behave exactly as before and nothing already measured
can regress when a brand ships a file.

If a brand needs to overrule the baseline for a **specific document**, that is
`data/reference/doc-class-overrides.json` — per URL, one reason per document,
which is the right instrument for "this one document is not what its URL says".

A malformed file is named and skipped, never fatal: one session's typo must not
blank every other brand's rules.

## Checking your rules

```
node -e "import('./src/core/docClass.js').then(m=>console.log(m.brandRuleStatus()))"
```

`{ loaded, brands, error }`. `loaded: 0` with no error means no brand has
shipped rules yet — which is a fact, not a failure. Assert your own rules from
inside your pack's suite (`tests/scraper/test_<brand>.py`), so they are owned by
your brand and need no shared-file ceremony.
