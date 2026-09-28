# `unknown_zero`: 3,944 is 468, and 3,476 of it is `vendor_coverage` counted twice

**Status: a measurement for the reviewer. Nothing changed.**

`unknown_zero` reports **3,944 live HARDWARE parts in kind `unknown`, so they are asked nothing and score
perfectly while leaving the denominator**. The defect is real and the number is not the size of the work.
Split by VENDOR:

| vendor | n |
| --- | ---: |
| hpe | 1,142 |
| juniper | 974 |
| **cisco** | **468** |
| aruba | 358 |
| arista | 344 |
| dell-emc | 151 |
| lenovo | 100 |
| extreme, fortinet, nvidia, mikrotik, ubiquiti, supermicro | 407 |

**3,476 are not Cisco**, and that is exactly the population `vendor_coverage` already reports — *"12 vendors
hold 3476 live hardware parts with NO layering, ledger or kinds"*. Same parts, two reds. They are unkinded
because no axis has been written for their vendors, which is what `vendor_coverage` is about; nothing in
`unknown_zero`'s own terms can move them and they will close together in one step.

## The Cisco 468, which is the actual work

| category | n | with a real name |
| --- | ---: | ---: |
| video | 267 | 6 |
| wireless | 69 | 22 |
| optical-networking | 39 | 34 |
| servers-unified-computing | 29 | 9 |
| collaboration-endpoints | 28 | 16 |
| unified-communications | 14 | 14 |
| hyperconverged-systems | 13 | 0 |
| interfaces-modules, hci, storage-networking | 9 | 5 |

**362 of the 468 have no name beyond their own SKU**, so the classifier had nothing to read: `10-1022100-01`,
`4029111`, `750185`. Those are a NAME-lane gap, not a classifier gap, and `name_state` already records the
shape. The 106 that DO carry a name are the ones an axis could classify today, and they are concentrated
where a reader would expect: optical-networking 34 (`15216-CMXDMX-SK`, `15216-FLAMP36.6-SK` — 15216 is the
passive DWDM line), unified-communications 14, wireless 22.

## What follows

Three separate pieces of work wearing one number:

1. **3,476 — write the other vendors' axes.** `vendor_coverage`'s job; `unknown_zero` should say so rather
   than count them, or the two reds will move together and look like two fixes.
2. **362 — fill the names.** A part whose only name is its SKU cannot be classified by any rule that reads
   a name, and no axis change helps.
3. **106 — the real classifier gap**, and small enough to read part by part.

Reporting the overlap rather than the total is the point: "3,944 parts score perfectly" reads as a metric
emergency, and the number that can be acted on this week is 106.
