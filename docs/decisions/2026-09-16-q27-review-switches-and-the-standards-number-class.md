# Q-27 review: switches, all 98 rows — and the standards-number class, sized (16 Sep 2026)

> **84 accept · 14 refuse**, and **12 of the 14 refusals are a power cord naming a national plug standard.**

Switches is the category where the widened platform number **earns its keep**, which is worth stating plainly after
three sheets criticising it. Nexus and Catalyst part names are full of real platform numbers that only a widened
pattern catches:

```
NXA-FAN-35CFM-PE   "supported on N93240YC-FX2"     -> Nexus 9300      93240 via 93[0-9]{2}[0-9]?
NXA-PAC-500W-PE    "Supported on N93180YC-EX"      -> Nexus 9300      93180
NXA-PAC-650W-PE    "Use with Nexus 31108PC-V"      -> Nexus 3100      31108
C9K-150W-ADPT      "for the C9200CX-8PT-2G"        -> Catalyst 9200   9200
NXA-FAN-160CFM-PE  "for Nexus 3464C"               -> Nexus 3400      3464
KIT-MNTG-09=       "For CISCO7609/Cat6509-NEB-A"   -> Catalyst 6500   6509
```

None of those would match an exact token. 69 of the 98 proposals rest on the widening and **55 of them are right** —
and the other side of that is equally clean: **all 14 refusals are widened matches too.** Every exact token, full
series name and word in this category produced a correct proposal. The widening is both the only thing finding these
rows and the only thing getting them wrong, which is why the answer here cannot be to switch it off.

## Accept — 84 rows

| rows | → series | on |
| --- | --- | --- |
| 24 | Nexus 9300 | `N9300` PSUs, fans supported on N93240YC / N93180YC, N9300 accessory kits |
| 6 | Catalyst 9200 | C9200CX compact-switch adapters, brackets, power clip |
| 6 | Catalyst 9500 | "Catalyst 9500 power supply blank cover", fan trays (full series name) |
| 6 | Nexus 3016 / 3048 / 3064 / 3100 / 3200 / 3400 | Nexus 3164 PSU, 31108PC-V supplies |
| 5 | Catalyst 9500 | "Catalyst 9500X" SSDs and 1500 W supplies |
| 4 | Nexus 2000 Fabric Extenders | "**N2K**/3K 200W AC Power Supply" |
| 4 | Nexus 3016 / … | "Nexus **3064**-T 500W AC PSU" |
| 4 | Nexus 9800 | "Cisco **N9800** DC power supply" |
| 3 | Nexus 2000 | Airflow vent for 2348TQ / 2332TQ, "Nexus Fan, **N2000**, 3000, 9000" |
| 3 | ME 3400 | "rack-mount kit for all the Cisco **ME3400** Series products" |
| 19 | 3650, 3850, 9300, 3750-X, 2960-X/XR | the **full series name** in the part's own name |
| 2 | Nexus 3400 | "for Nexus **3464C**" |
| 2 | Catalyst 6500 | "Cat**6509**-NEB-A chassis", "CISCO 7604 and **6504**-E" |
| 1 | Catalyst 6500 | SKU token `C6K` |
| 1 | IE 3010 | "IE 1GB SD Memory Card for IE2000, **IE3010**" *(flagged: names two)* |

## Refuse — 14 rows

### 12 are a power cord naming a national plug standard

```
PWR-CAB-AC-BRA   "Power Cord … (Brazil), NBR 14136"        -> Catalyst 1000   14136 via 1[0-9]{3}[0-9]?
PWR-CAB-AC-CHN   "… (China), GB2099.1/GB1002"              -> Catalyst 1000   1002
PWR-CAB-AC-SUI   "… (Swiss), SEV 1011"                     -> Catalyst 1000   1011
CAB-ACU          "AC Power Cord (UK), C13, BS 1363, 2.5m"  -> Catalyst 1300   1363
CAB-BS1363-C15-UK, CAB-BS1363-C19-UK=                      -> Catalyst 1300   1363 (in the SKU)
CAB-C2316-C19-IT, =   "CEI 23-16 to IEC-C19 14ft, Italy"   -> Nexus 2000      2316 (in the SKU)
CAB-IR2073-C19-AR, =  "IRSM 2073 to IEC-C19 14ft"          -> Nexus 2000      2073 (in the SKU)
PWR-CAB-AC-IND   "India AC Power Cord for Cisco ASR 900, IS:1293"  -> Catalyst 1200   1293
PWR-CORD10-IND   "Power Cord, India, IEC60320/C19, IS16A3" -> Nexus 6000      60320
```

`PWR-CAB-AC-IND` is the clearest: a cord whose own name says it is **for the ASR 900**, filed into Catalyst 1200 by
the Indian plug standard IS 1293.

### 2 more

`CAB-RPS-1614=` *"1 RPS 675 connector cable 16/14"* → Catalyst 1000 on `1614` — a **wire gauge**.
`STK-RACKMOUNT-1RU=` *"Rack Mount Kit for 1RU Catalyst **1900**, 2900XL, 3500XL/FastHub"* → Catalyst 1000 on 1900.
The Catalyst 1900 is a 1990s product and is not the Catalyst 1000 line.

## The standards-number class, measured across all 800

`src/core/layerChecks.ts` records this as *"12 of the 805 are named on a STANDARDS number — BS 1363 read as
Catalyst 1300 — a guard a mover would need first."* Measured properly, the class is bigger and it splits in two.

**Provable by a named body — 16 rows.** Testing for a standards body's own name immediately before the digits the
proposal matched:

```
   9  IEC     (IEC 60320 — eight China power cords into "Integrator Package 6000 MXP", one into Nexus 6000)
   3  BS      (BS 1363 → Catalyst 1300)
   1  NBR  1  GB  1  IS  1  SEV
```

This subset is refusable by **a guard that reads a named thing** rather than guessing at the shape of a number, and
that is what makes it worth building: `IEC`, `BS`, `NBR`, `GB`, `SEV`, `CEI`, `IRAM`, `IS`, `IEEE`, `NEMA`, `UL`,
`CSA`, `DIN`, `JIS`, `AS/NZS` are literal, short, and appear in exactly the parts that go wrong.

**Not provable that way — at least 7 more found by hand.** They need a looser test and should not be smuggled into
the same number:

- `CAB-C2316-C19-IT` and `CAB-IR2073-C19-AR` — the body is in the **name** (`CEI 23-16`, `IRSM 2073`) while the
  match is in the **SKU** (`C2316`, `IR2073`), and the standards number carries a separator the SKU drops. A guard
  would have to look across both strings and allow `23-16` to equal `2316`.
- `CTS-PWR-AIR-INJ5` ×3 — *"Power Injector (802.3af)"*. The body **IEEE** is not written at all; `802.3` is simply
  known. A literal-body guard cannot see it, though `802.` followed by a digit is itself a literal.
- `CAB-RPS-1614=` (a wire gauge) and `PWR-CORD-BZ-A` ×4 (*"EL223"*, a cord type) have no body at all.

So the honest report is **16 provable, 23+ observed**, and the note in `layerChecks.ts` saying 12 is an undercount
even for the provable half. It remains the single largest *nameable* false-positive cause in the queue, and unlike
the widened-number question it costs nothing in recall: no Cisco platform is introduced by the word `BS` or `NBR`.
