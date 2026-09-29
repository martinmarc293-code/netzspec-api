# Batch F report — 29 Sep 2026 (Q17, the read triples; the overrules on batch-e-report.md)

**Board 29 / 4 / 0 / 0 of 33 (d682467 deployed, artefacts 475b083 built on 60311ed), self-test 24 / 0 / 9.**
Red: four_sets_sum (19 triples, below), conflicts_classified (51 orphans my ruled retractions made — Q20),
export_profiles_roundtrip (Q12, building now), vendor_coverage (ruled). Log: `docs/reviewer/2026-09-28/verifier.txt`.

## Done

- **Overrules applied:** TAA compliant retracted (13); video passive "Mux/Demux 100G" REKEYED to channel_spacing as
  "100 GHz" / "200 GHz" (14, a declared `reshape` move, gate first); R4 needs ≥ 1 table row → **18 of the 116 were
  seed-only and reverted** into Q17_R4_REFUSED (98 stand). `scripts/retract-read-pours.mts` is pushed.
- **Run 1419 rekey:** 30 moved under a recorded PASSING gate (value half 30 / 30): 6 cpu power_max→tdp, 8 AP
  tdp→power_max, 1 drive flash→storage_capacity, 1 SD dram→flash, 14 channel_spacing; 2 refused (Q21).
- **Run 1420 retract-read-pours:** 125 exact rows retracted, 0 held (list `data/reference/q17-read-pours-cisco-2026-09-29.tsv`).
- **Q17_READ:** 61 widenings, each with a witness. **219 kind moves by family rule** — C880 (170 rows read: DIMM kits,
  E7 CPUs, FC / 10G cards, fans, disks, JBOD enclosures, boards were all `server`), C3X60 (drives / controllers / fan were
  `chassis`), C3K (server nodes were `drive`), PCI25 / EM3-AF NVMe, ST-M6-D100GF, the 15454 ML cards, the NCS2K frames,
  the Y-cable drawer. Replay read row by row; a 12 Sep refusal (56HD8 "is the chassis") read the SKU without its name
  and is overturned. `docs/decisions/2026-09-29-q17-read-triples.md`.
- **Veto after F:** 221 → **19 triples / 335 part-cups** = the 18 seed-only (333) + routers drive flash (2).
  The kind moves exposed **no** new veto.

## Rulings needed

**Q19 — the 18 seed-only triples (333 part-cups).** Measured with the real audit (control: 8 of 8 html_table raws found
on their own pages): **12 of 333 seed raws are on their page** (switches fex forwarding_rate, "131 Mpps"), 59 pages
unreadable, **262 not on the page because the seeds are German shop prose** — "Nein", "Aktiv (3 Hot-Swap-Lüftermodule,
front-to-back)", "40 Gbit/s zur Fabric (dual 20 Gbit/s)". No verbatim table read can corroborate a translation. Options:
(a) widen with a `seed` witness CLASS that four_sets_sum counts apart (passes, prints the count, never folded);
(b) a person reads the 17 sheets' tables; (c) they stay vetoed and four_sets_sum stays red.

**Q20 — 51 orphan conflicts my ruled retractions made.** Six IE PSUs (43): each kept `{95,95}` — the pour, retracted —
against a REJECTED `{5,95}` from another source, which is the true value. Two 15216 muxes (8): kept and rejected are the
two single ends of one range read as separate cells (`{-5,-5}` / `{65,65}`), class same-doc-multicolumn. Options:
(a) resolve no-live-value as Q11 ruled for orphans (the true readings stay only in conflict history);
(b) promote the rejected full range on the six PSUs, compose the muxes' two ends into one range, then resolve — a new
write (a run kind, gate on the rejected evidence), which I would build before the export if you want it.

**Q21 — MEMUSB-128FT(=)**, 128 MB USB flash tokens: 0.125 GB is under storage_capacity's 1 GB band floor, so the rekey
refused them and they stay vetoed as drive flash. A band change (dictionary decision, all vendors measured first) or
retract the 2 facts?

## Next

Q12 export in the ruled formats, build order as ruled: shop cups + shop_ready → the four profiles → the check → the
acceptance diff. The German rendering contract already renders every source value the two groups need (probed: Layer 3,
PoE+ (IEEE 802.3at), 19-Zoll-Rackmontage, -5 bis 45 °C, 95,23 Mpps, LC-Duplex, Multimode-Faser (MMF), OM4).
