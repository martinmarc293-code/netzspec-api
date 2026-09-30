# The 6,466 family refusals of the UCS / HyperFlex dry run, by shape (30 Sep 2026)

Measured with the REAL planExtract + storeRefusal over the 33 dry-run extracts (scripts: /tmp/famref.mts, /tmp/famref2.mts on the
box); the total reproduces the plan's stat exactly. family:unknown 3,248 + family:mismatch 3,218.

| shape | entries | what they are | refusal |
| --- | --- | --- | --- |
| mismatch, the part's series is a generic word | 3,218 | CPUs (UCS-CPU-I4210), adapters (N2XX-AIPCI01=), thermal paste (UCS-CPU-TIM=): series "Processors", "Network and storage adapters" vs doc `ucs-c-series-rack-servers` | correct (components) |
| unknown, the part has a model and no series | 2,638 | SATA kits, cables, drives, PSUs, KVM cables (UCSC-SATA-KIT-M5=, CBL-SC-MR12GM52=, UCSC-PSU1-1200W=) | correct (components) |
| unknown, a one-letter series directory the part's model glues onto (`c220` in `c-series`) | 610 | **the sheets' own servers: 26 SKUs, all 118 of their entries** (UCSC-C220-M5SN, series "UCS C220" vs doc `ucs-c-series-rack-servers`) + ~492 components that carry a server series (R2XX-RAID0 series "UCS C200 / C210 / C250 / C260 (M1/M2)", UCSC-HS-C220M5= and CBL-NVME-C220FF= series "HX220c") | wrong for the 118; right for the ~492 |

So: the servers each sheet describes are refused by the comparator (a letter-series family, a third shape beside the held
round's two), golden rows cannot change that, and a comparator fix ALONE would admit the ~492 component entries whose series is
a server's -- componentShape does not catch R2XX-RAID*, UCSC-HS-*, CBL-* today.
