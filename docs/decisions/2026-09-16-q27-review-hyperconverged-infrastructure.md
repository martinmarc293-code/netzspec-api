# Q-27 review: hyperconverged-infrastructure, all 109 rows (16 Sep 2026)

109 proposals in **three** evidence groups — the least varied category in the queue, and the most useful one, because
it inverts the finding from [servers-unified-computing](2026-09-16-q27-review-servers-unified-computing.md).

> **104 accept · 5 refuse**, with 6 of the accepts flagged.

## Accept — 102 rows on the family prefix `HCIX`

Every `HCIX-` prefixed part is proposed into **HCIX X-Series (X210c / X215c / X440p / X9508)**: CPUs, DIMMs, GPUs,
NVMe and M.2 drives, mezzanine and mLOM cards, risers, a PSU, a TPM, bridges.

In servers-unified-computing the identical shape — 38 `CSP-` parts into `CSP 5000` — was **refused**, so the
difference matters and it is not a matter of taste. There, `CSP` named the *line* and two rows said in their own
names that they were for CSP 2100, a sibling product the mapping does not hold. Here the prefix is a **real
discriminator**, and Cisco's own catalogue proves it by carrying both spellings of the same component:

```
HCIX-M2-240G    (X-Series)        HCI-M2-240G     (C-series nodes)
HCIX-M2-I480GB  (X-Series)        HCI-M2-480G     (C-series nodes)
```

`HCIX-` means Compute Hyperconverged **X-Series**; `HCI-` means the C-series rack nodes. The target series *is* the
X-Series grouping, and the line holds six real series, so this is not the one-series accident either. These rows do
not belong in `Compute Hyperconverged with Nutanix shared parts`, which spans the C220/C225/C240 nodes an `HCIX-`
part will never fit.

### Six of those accepts are flagged

```
HCIX-F-9416, HCIX-F-9416-D        a 9416 X-Fabric module
HCIX-I9108-100G, HCIX-I9108-25G   9108 intelligent fabric modules
```

The same line holds a series called **HCI fabric interconnects and X-Fabric**, which is where these four look like
they belong; they reach X-Series only because `HCIX` is in the SKU and nothing else matched. And:

```
HCIX-M7-MLB       "Cisco Compute Hyperconverged and Compute-Only Node X-Series M7 with Nutanix"
HCIX-M8-NTNX-MLB  "…X-Series M8 with Nutanix"
```

Major Line Bundles, not parts — the same shape as the four VSPEX rows flagged in servers.

## Accept — 2 rows

`HCIX-RIS-A-440P` and `HCIX-RIS-B-440P` are risers for the **X440p** PCIe node, and the series names X440p. Correct.

## Refuse — 5 rows, and the reason is the sharpest one found tonight

```
HCI-M2-240G       Cisco HCI-M2-240G          -> HCI C240 nodes
HCI-M2-240G-M6    "240GB SATA M.2"           -> HCI C240 nodes
HCIX-M2-240G      Cisco HCIX-M2-240G         -> HCI C240 nodes
UCS-M2-240G       Cisco UCS-M2-240G          -> HCI C240 nodes
UCS-M2-240G=      Cisco UCS-M2-240G=         -> HCI C240 nodes
```

All five are **240 GB M.2 boot drives**. The `240` is a capacity, and `HCI C240 nodes` takes it as its platform
number — the capacity-as-platform cause already recorded in servers (`250GB` → C250, `480GB` → C480).

`HCIX-M2-240G` is the one to look at twice. Its SKU carries `HCIX`, so the X-Series series **did** claim it — and
lost. Asked directly, every sibling's verdict on that SKU is:

```
HCI XE-Series (XE130c / XE9305)                none   names another series of the line: HCI C240 nodes (sku 240)
HCIX X-Series (X210c / X215c / X440p / X9508)  none   names another series of the line: HCI C240 nodes (sku 240)
HCI C220 nodes                                 none   names another series of the line: HCI C240 nodes (sku 240)
HCI C240 nodes                                 sku-token  240
```

The rule states its own reasoning: the X-Series series yields because *another series of the line names it better*.
`strongest` scores an exact 3-digit token at spec 3 and a 2–5 letter acronym at spec 1, so the capacity outranks the
family prefix and the row is proposed into the wrong series **with no ambiguity recorded anywhere** — it reads as a
clean, single-winner match. Had the prefix won, or had the two tied, the row would have been left alone.

**That is a different failure from the ones already written up.** The others are a bad token beating nothing; this is
a bad token beating a good one, on a scale where "how many digits" stands in for "how much this identifies the
product". A capacity always has three digits and a family prefix never has more than five letters, so the ordering
is structurally backwards for this shape.

## What to take from the pair of reviews

The same syntax — a family prefix in the SKU naming a series — is **right** in this category and **wrong** in
servers. No lexical rule separates them; what separates them is whether the prefix distinguishes siblings
(`HCIX-` vs `HCI-` vs `UCS-`) or merely names the line every sibling belongs to (`CSP-`). A rule written from either
category alone would break the other, which is the argument for deciding it from the mapping — does any other series
in this line share the prefix — rather than from the string.
