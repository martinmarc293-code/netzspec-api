# Six categories have no datasheet at all, and that is why the derive would take them to zero (16 Sep 2026)

**Read-only. No store write, no run.** This answers the one question
[the step-5 record](2026-09-16-step5-rebuild-is-blocked-at-its-first-step.md) said to settle *before* the derive rather
than after:

> `conferencing → 0%` and `video 5.4% → 1.1%` deserve a look before the run rather than after: a category whose every
> link becomes a mention has no spec sheet anyone can point at, which is an acquisition finding, not a scoring one.

It is an acquisition finding, and it is bigger than conferencing.

## Conferencing: 7,003 bulletin links and 5 datasheet links

```
conferencing        3,705 linked parts (7,052 live)
   vendor_eol_bulletin       60 docs    7,003 links
   vendor_datasheet_html      2 docs        5 links
```

The two datasheets are *"Cisco Meeting Server, Web App, Meeting Management Datasheet"* and *"Cisco AI PODs for
Collaboration Datasheet"*. Five links between them, against seven thousand from end-of-life notices. The predicted drop
to 0% is not the derive losing anything — it is the derive **declining to count a bulletin as a specification**, which
is the whole point of it.

## And five more categories are in the same state or worse

Per category, share of document links that come from a spec-bearing document (`vendor_datasheet_html`,
`vendor_datasheet_pdf`, `vendor_tool`):

```
   power-supplies                 117 parts    0 spec docs      117 vendor_page links, one per part
   power-cables                   185 parts    0 spec docs      185 vendor_page links, one per part
   contact-center               2,189 parts    0 spec docs    3,060 EoL links, 58 bulletins, NOTHING else
   customer-collaboration         468 parts    0 spec docs      857 EoL links, 13 bulletins, NOTHING else
   data-center-analytics          161 parts    0 spec docs      180 EoL links + 2 vendor_qa docs (13 links)
   conferencing                 3,705 parts    2 spec docs    7,003 EoL links, 5 datasheet links      0.1%
```

**6,825 live parts across six categories with no datasheet a specification could be read from.** Three are
bulletin-only, two carry exactly one `vendor_page` per part and nothing else, one has two datasheets.

## The full gradient, because a list of the worst six is not a finding without it

| category | live parts | spec docs | spec links | EoL links | spec share |
| --- | ---: | ---: | ---: | ---: | ---: |
| power-supplies | 117 | 0 | 0 | 0 | 0% |
| contact-center | 2,189 | 0 | 0 | 3,060 | 0% |
| customer-collaboration | 468 | 0 | 0 | 857 | 0% |
| data-center-analytics | 161 | 0 | 0 | 180 | 0% |
| power-cables | 185 | 0 | 0 | 0 | 0% |
| conferencing | 3,705 | 2 | 5 | 7,003 | 0.1% |
| cloud-systems-management | 5,319 | 26 | 99 | 8,125 | 1.2% |
| unified-communications | 5,154 | 20 | 150 | 7,544 | 1.9% |
| security | 12,660 | 31 | 426 | 18,330 | 2.2% |
| wireless | 5,796 | 67 | 349 | 6,620 | 4.8% |
| video | 2,548 | 16 | 193 | 2,737 | 6.6% |
| servers-unified-computing | 10,433 | 94 | 1,181 | 15,177 | 7.2% |
| software | 971 | 3 | 94 | 818 | 7.3% |
| hyperconverged-systems | 1,398 | 11 | 180 | 1,368 | 11.6% |
| collaboration-endpoints | 2,774 | 39 | 711 | 3,024 | 18.9% |
| interfaces-modules | 1,699 | 119 | 846 | 1,315 | 27.7% |
| switches | 9,880 | 389 | 5,637 | 11,302 | 29.9% |
| optical-networking | 1,725 | 81 | 797 | 1,466 | 34.1% |
| routers | 7,490 | 290 | 4,233 | 7,414 | 34.5% |
| storage-networking | 1,436 | 54 | 886 | 1,431 | 38.2% |
| ios-nx-os-software | 223 | 27 | 327 | 268 | 54.2% |
| hyperconverged-infrastructure | 651 | 41 | 388 | 300 | 56.0% |
| transceiver | 3,940 | 377 | 5,463 | 1,910 | 59.3% |
| data-center-networking | 33 | 8 | 52 | 0 | 91.2% |
| meraki | 62 | 27 | 71 | 0 | 100% |

`meraki` and `data-center-networking` are the control at the top: they prove the measurement can return a high number,
so the zeros at the bottom are about those categories and not about the query.

## What this changes

**It reframes the derive.** The step-5 record presents the drop as a cost to weigh — *"the progress surface would fall
by a third and start meaning something"*. For these six it is not a fall at all: there was never a specification to
count, and today's number is made entirely of bulletins listing SKUs. Running the derive does not lose them coverage;
it stops reporting coverage they never had.

**And it is the third time this shape has been recorded.** `CLAUDE.md` already carries *"a PART MENTION IS NOT A FACT,
and confusing them inverts where you send the work"* (a bulletin binds many parts and carries no specifications) and
*"A CATEGORY CAN BE STRUCTURALLY PERFECT AND STILL YIELD NOTHING, AND THE DOCUMENT LIST SAYS SO IN ONE QUERY"*, written
about `security` — which reads 2.2% today, so it has barely moved since. What is new is that the query has now been run
for **every** category at once instead of the one someone happened to be working on, and it names six.

**The work it implies is acquisition, not schema.** No profile change, cup change or rule change reaches a category
whose vendor pages have never been fetched. For `power-supplies` and `power-cables` in particular, every part has
exactly one `vendor_page` and nothing else, which is a lane that discovered the products and never fetched a
specification for any of them.

## What I have not done

No derive, no acquisition queueing, no store write of any kind. Queueing work into a lane on the strength of this is
exactly the thing this repo's own rule refuses — *"do not write into another owner's queue at all — send the
instruction and the file, and let the code that knows the scope decide"* — and whether these six categories are even
in scope for datasheet acquisition is a question about what the catalogue covers.
