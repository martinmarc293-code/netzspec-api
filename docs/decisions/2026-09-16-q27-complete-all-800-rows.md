# Q-27 complete: all 800 reverse-label rows read and judged (16 Sep 2026)

The last six categories, and then the whole queue in one table.

> **587 accept · 211 refuse · 2 arguable**, over 800 rows. Every row was read; none was inferred from a sample.

## hyperconverged-systems — 14 accept, 17 refuse

The worst accept rate in the queue, and every refusal is a **capacity or a voltage**:

```
HX-SD480G63X-EP   "480GB 2.5in Enterprise Performance … SSD"   -> HyperFlex … (C220/C240/C480/B200/B480)   9 rows
HX-ML-256G8RW     "256GB LRDIMM 8Rx4 3200 (16Gb)"              -> …                                        on 256 via 2xx
HX-MP-256GS-A0    "Intel Optane Persistent Memory, 256GB"      -> …
RP208-30-2P-U-2   (a rack PDU — 208 is its voltage)            -> …
```

The series name `HyperFlex compute-only nodes (C220 / C240 / C480 / B200 / B480)` lists five platform numbers, so it
matches five bands of three-digit numbers at once — which is most of the capacities a server component can have.

Accepted: C220/C240 intrusion switches, CMAs and rail kits (9), C480 M4/M5 bezels and cable-management arms (4), and
the HyperFlex Express boot drive (1).

## security — 21 accept, 6 refuse

The **best** number performance in the queue: 21 of 21 exact-token proposals are right, every one an ASA part naming
its own model (`ASA 5512-X, 5515-X, 5525-X brackets`, `ASA 5545-X/5555-X AC power supply`, `ASA 5505 SSC Blank Slot
Cover`). All six refusals are **words**:

```
CCS-CABLE-MGMT=   "Content Sec Cable Management Arm for the x70 models"
                  -> Security Management Appliance (SMA)          on the word "Management"        3 rows
LC-RAILS=         "Cisco StealthWatch Sliding Rail WITHOUT Cable Management Arm"
                  -> Management Console                           on the word "Management"
PRIME-ACC-REG     "Cisco Prime Access Registrar 7.X - Physical"
                  -> Prime Security Manager (PRSM) appliances     on the word "Prime"
71XX-PA-SM-BLANK  "Cisco 7160 Port Adapter and Service Module blank face plate"
                  -> FirePOWER 7000 / 8000 (legacy)               on 7160 via 7xxx
```

`LC-RAILS=` is the one to remember: the part's name says it is the rail kit **without** a cable management arm, and
it is placed by the word *Management* taken out of that negation. And `PRIME-ACC-REG` is a real trap — Cisco Prime
Access Registrar and Cisco Prime Security Manager are different products that share a brand word.

## interfaces-modules — 5 accept, 6 refuse

```
accept   CAB-PPWR-PS1-1=   "…1 ESwitch PS to 1 ESwitch 16/36 port NM"  -> NM / NME Network Modules   3 rows
         CAB-NM-ANALOGMOD= "8 RJ11 cables for 2600/3600 analog modem NM"
         CABLE-24T1E1      "Cable for 24-port T1/E1/J1 CE-ATM SPA"     -> SPA Shared Port Adapters

refuse   10000-SIP-600, UBR10-2XDS-SIP (+ spares)  -> Cisco 12000 / XR 12000 SIP and line cards    4 rows
         CAB-SS-530AFC, CAB-SS-530FC               -> Pluggable Interface Modules (LTE / 5G / serial)
```

The four `SIP` rows are the **one-series-line** cause from the CSP finding, confirmed: the line
*Router and switch line cards (legacy)* holds exactly one real series, so `SIP` — which stands for **SPA Interface
Processor** and is shared across the 10000, 12000 and uBR10012 platforms — has no sibling to disagree with. A
`10000-SIP-600` is a Cisco 10000 processor and a `UBR10-2XDS-SIP` is a uBR10012 card; neither is a 12000.

The two `serial` rows are arguable and refused on balance: RS-530 smart-serial cables are legacy WIC accessories and
`serial` is a **variant qualifier** inside `Pluggable Interface Modules (LTE / 5G / serial)`, a modern series.

## unified-communications — 0 accept, 5 refuse

The only category where nothing is accepted, and all five are one mistake:

```
MEM-243-1X128D   "128MB DRAM Memory for IAD2430 series"   -> VG200 / VG202 / VG204 / VG224   on 243 via 2xx
```

The `243` of the SKU `MEM-243-…` is Cisco's shorthand for the **IAD2430**, and `2[0-9]{2}` claims it for the VG200
voice gateways. An Integrated Access Device is not a Voice Gateway.

## video — 3 accept

`RFGW-RFSW-COVER` "RFGW-10 RF Switch Card Cover" → **RFGW-10** by full name (2). `4003219.00` *"Node 2:1 bdr,
5-42MHz HG Multiplexing UPG Kit"* → **GS7000 node modules and housings** on the word *node* — accepted but flagged,
since `node` is as generic a word as `point` was in wireless; here it happens to be right.

## optical-networking — 0 accept, 1 refuse, 2 arguable

`CO-40TDL40-X2110=` *"40G module for NSN, variant X2110 (NeoPhotonics)"* → NCS 2000 on `2110`. **Refused**: `X2110`
is a customer-variant code, the third of its kind tonight after `X1001` and `X1010`.

`ONS-MPO-16LC-2=` and `ONS-MPO24-2MPO12=` are MPO fibre cables reaching `ONS 15454 MSTP` on the SKU prefix `ONS`.
**Left arguable rather than forced into a verdict**: this is the family-prefix question that came out opposite ways
in servers (`CSP`, refused) and hyperconverged (`HCIX`, accepted), and the deciding fact — whether `ONS` distinguishes
siblings or merely names the optical family — is a question for whoever owns the mapping, not one to settle from the
string.

---

# The whole queue

| category | rows | accept | refuse | arguable |
| --- | ---: | ---: | ---: | ---: |
| servers-unified-computing | 264 | 156 | 108 | |
| hyperconverged-infrastructure | 109 | 104 | 5 | |
| collaboration-endpoints | 100 | 75 | 25 | |
| switches | 98 | 84 | 14 | |
| wireless | 65 | 57 | 8 | |
| routers | 46 | 32 | 14 | |
| storage-networking | 38 | 36 | 2 | |
| hyperconverged-systems | 31 | 14 | 17 | |
| security | 27 | 21 | 6 | |
| interfaces-modules | 11 | 5 | 6 | |
| unified-communications | 5 | 0 | 5 | |
| video | 3 | 3 | 0 | |
| optical-networking | 3 | 0 | 1 | 2 |
| transceiver, meraki | 0 | | | |
| **total** | **800** | **587** | **211** | **2** |

## The 211 refusals by cause

| cause | rows | fixable by |
| --- | ---: | --- |
| a **component model number** (HGST SN200/SN260, NVIDIA H200, AMD MI210, Intel CPUs, antenna ANTM1916, NVIDIA PG414-200) | ~57 | the model-letter fence, mostly |
| a **capacity** (480GB, 256GB, 250GB, 240GB, 120G) | ~30 | nothing prepared — see below |
| a **family prefix** on a line whose siblings cannot disagree (`CSP`, `SIP`) | 42 | a new rule: a token that is also the line's name cannot place a row |
| a **standards number** (IEC 60320, BS 1363, NBR, GB, SEV, CEI, IRSM, IS, SAE J1939/J1962, IEEE 802.3af/802.11n) | ~25 | a named-body guard: 16 provable, the rest need a looser test |
| a **generic or qualifier word** (`point`, `Management`, `Prime`, `Package`, `Mini`, `X-Series`, `chassis`, `serial`) | ~22 | a rule about which words of a series name are its identity |
| a **speed, voltage, frequency or gauge** (200G, 200-240V, 863-928 MHz, 16/14 AWG) | ~15 | extending `NOT_PLATFORM_AFTER`, and a range rule |
| a **customer-variant code** (`X1001`, `X1010`, `X2110`) | 5 | already recorded as variants in the optical mapping |
| the **model letter discarded** (B230→C2xx, C250→B250, C260→B260) | ~8 | the model-letter fence |
| an **alias meaning another family** (`N5K` → NCS 5000) | 2 | keying `LABEL_ALIASES` by series rather than by number |
| **other** (a CR2032 battery, an LSI 2208R chip, a C19/C20 cord, a 1990s Catalyst 1900, bundles) | ~5 | — |

**Not one refusal is a row that is genuinely ambiguous about which product it belongs to.** Every single one is a
rule reading a number or a word that means something else. That is the headline of the whole review: the queue's
precision is a property of the matching rules, and the 73% accept rate is what those rules currently deliver.

## The capacity cause has nothing prepared, and it is the second largest

~30 refusals are a storage capacity taken as a platform number, and neither prepared sheet touches them:

```
HX-SD480G63X-EP   "480GB … SSD"   -> HyperFlex … (C220 / C240 / C480 / B200 / B480)
HX-ML-256G8RW     "256GB LRDIMM"  -> the same series, on 256
UCSV-HDD250G1F111= "250GB … HDD"  -> UCS C200 / C210 / C250 / C260
HCIX-M2-240G      (240GB M.2)     -> HCI C240 nodes
SSD-120G          "120G SSD"      -> Meraki MS120
```

`NOT_PLATFORM_AFTER` already fences `MB` and `GB`, and that is exactly why these survive: the SKUs spell it `480G6`,
`256G8`, `250G1`, `240G`, `120G`, `480GM`, `256GS`, `200GV` and `200GF` — a `G` followed by something that is not
`B`.

I was about to record "`G` followed by a digit is a capacity" as the fix. **Tested against both populations it has
to separate, it is only a third of an answer**, and the other candidate is actively unsafe:

| pattern | capacity SKUs caught (of 12) | real platforms wrongly caught (of 6) |
| --- | ---: | ---: |
| `G` followed by a **digit** (`480G6`, `256G8`, `250G1`) | 4 | **0** |
| `G` at a **token edge** (`240G`, `120G`, `960G`) | 4 | **2** — `WS-C2960G-24TC-L`, `WS-C3560G-48PS` |
| `G` followed by a **letter** (`480GM`, `256GS`, `200GV`, `200GF`) | 4 | untested |

So `G`+digit is safe and partial; `G`+edge cannot be used, because the Catalyst **2960G** and **3560G** are real
platforms with exactly that shape; and `G`+letter covers the remaining third but was not tested against a platform
list and must not be adopted on the strength of this table. A complete capacity rule needs the measurement this
table only starts — which is the point of putting the table here rather than the sentence I first wrote.

### That measurement was then run, and it closes the question: there is no `G` rule

Over **1,911 distinct SKUs on every page** carrying `<3–5 digits>G`. Two things came out of it, one of which
retracts part of what is above.

**First, and not in doubt, because these rows were read rather than counted:** a trailing `G` on a Cisco SKU is
*Gigabit Ethernet* at least as often as it is *gigabytes*, and the digits in front of it are then the platform.

```
CP-7942G, CP-7945G, CP-7962G, CP-7965G, CP-7975G-CH1   "Cisco UC Phone 7942 …"        — IP phones
WS-C3750G-24TS-S     "24 Ethernet 10/100/1000 ports, 4 SFP-based Gigabit Ethernet"    — a Catalyst 3750G
C819G-S-K9           "Cisco 819 Router with SPRINT EVDO RevA"
CISCO886GW-GN-E-K9, IR829GW-LTE-VZ-AK9                                                — 886 and IR829 routers
```

The Catalyst 2960G and 3560G in the table above are not two awkward exceptions; they are a large family. **No
character-level rule on what follows `G` can separate these from `480G6` or `256GS`.**

**Second: my own scale measurement cannot be quoted for precision, and saying so is the point.** It labelled the two
populations from each row's NAME and then scored rules on the SKU — independent signals, which is why it looked
sound. Reading a spread sample of each population showed the labels are too noisy to carry a percentage:

- Hundreds of rows have no name beyond `"Cisco <SKU>"`, so genuine capacities (`HX-MP-512GS-A0=`, `UCS-MR256G8RE3=`,
  `UCS-SD960GM2NK9-D`) were labelled *platform* for want of a description.
- My capacity test allowed `G` at a word boundary, so `"Cisco IP Phone 7902G, Global"` was labelled *capacity*.
- And a **third population** was never separated at all: **speeds**. `CPAK-100G-CWDM4`, `QSFP-100G-B20U4-I`,
  `NC-55-36X100GA-SE`, `1X100GBE++=` and `UCSC-P-MCD100GF-D` are 100-gigabit optics, line cards and NICs — neither a
  capacity nor a platform.

So the honest state of the capacity cause is: **the `G` suffix is three-way ambiguous — capacity, speed, and a
Gigabit-Ethernet model suffix — and the fix does not live in a regex over the SKU.** It belongs wherever the
pipeline already knows that `GB` is a unit, which is the dictionary, not `NOT_PLATFORM_AFTER`. The ~30 refusals stand
as refusals; what changes is that no cheap rule closes them, and a sheet claiming otherwise would have sent the next
person to write one.

---

# What the three landed rules did to this queue (16 Sep 2026)

Operator: *"just do the recommended thing"*. All three prepared sheets were applied, each measured over all 39,998
page rows with the real function on both sides, each with **zero rows falling out of a series**, each proved by
sabotage.

| | withdrawn | created | queue | standing checks |
| --- | ---: | ---: | ---: | ---: |
| *(as reviewed)* | | | 800 | 915 |
| the **model-letter fence** | 69 | 11 | 742 | 925 |
| a number-keyed **alias** belongs to one brand | 2 | 0 | 740 | 929 |
| a **standards number** is not a platform | 16 | 0 | 724 | 939 |

**Every one of the 87 withdrawals was a row this review had already judged**, and 83 of them were **refusals** — so
the rules now refuse automatically what a person had to read and reject. The four that were accepts are the named
supercap-cable cost, asserted by their own checks.

## The verdicts, closed

| | reviewed | now |
| --- | ---: | ---: |
| accept | 587 | **593** |
| refuse | 211 | **129** |
| arguable | 2 | 2 |
| **total** | **800** | **724** |

`129 = 211 − 65 − 2 − 16 + 1`. **Eighty-three of the 211 refusals no longer need a human at all.**

## What the remaining 129 are, and why no rule takes them

| cause | rows | why it is still here |
| --- | ---: | --- |
| a **family prefix** on a line whose siblings cannot disagree (`CSP`, `SIP`) | 42 | needs a rule about the LINE, not the string — and the HCIX case proves the same syntax is right elsewhere |
| a **capacity** (480GB, 256GB, 250GB, 240GB, 120G) | ~30 | no `G` rule exists: `CP-7942G` and `WS-C3750G` are real platforms with the same shape |
| a **generic or qualifier word** (`point`, `Management`, `Prime`, `Mini`, `Package`) | ~22 | `Codec`, `Panorama`, `Touch`, `ceiling` and `Webex` are words too, and all five are correct |
| a **component model number** the letter fence cannot reach | ~15 | `HX-ML-256G8RW` has a hyphen before its digits, so there is no letter to disagree with |
| a **speed, voltage, frequency, gauge**, and the rest | ~20 | `863-928 MHz` carries its unit on the other end of the range; `CR2032`, `2208R`, `16/14` carry none |

The shape of what is left is different from what was removed. The 83 rules could take were all cases where a NAMED
thing — a model letter, a brand, a standards body — disagreed with the claim. The 129 that remain are cases where
nothing in the string disagrees with anything, and only knowing what the product *is* settles them. That is the
honest boundary between what a rule can do here and what a person has to.

---

# Closing the rule campaign: 211 refusals -> 106, and why it stops here (16 Sep 2026)

Five rules landed. **None of them moved a single published row**, each was measured over all 39,998 page rows with the
real function on both sides, and each is proved by reverting it and counting which cases go red.

| | withdrawn | created | queue | refusals |
| --- | ---: | ---: | ---: | ---: |
| *(as reviewed)* | | | 800 | 211 |
| model-letter fence | 69 | 11 | 742 | 147 |
| a number-keyed alias belongs to one brand | 2 | 0 | 740 | 145 |
| a standards number is not a platform | 16 | 0 | 724 | 129 |
| category nouns and brand words into `STOP` | 16 | 0 | 708 | 113 |
| the low end of a unit-bearing range | 7 | 3 | 704 | **106** |

**Half the refusals are gone**, and every removal was a row this review had already read and rejected.

## Two rules were measured and NOT applied, which is the other half of the result

- **The one-series line** (42 rows) — the sibling guard is vacuous where a line has one series, but the fix unplaces
  `ISE-SNS-ACCYKIT`, correctly filed in the only series its line has. Recorded in its own sheet; the real cause is that
  the mapping lacks `CSP 2100`, `Cisco 10000` and `uBR10012`, which is a **scope question for the operator**.
- **`mini` as a stop-word** — withdraws one bad proposal and creates a worse one, by removing the *correct* claimant
  from a row two series rightly hold as ambiguous.

## And the customer-variant codes have no safe rule either — 5 rows, measured

`CO-10TDL50-X1001=`, `CO-40TDL40-X1010=`, `CO-40TDL40-X2110=` and two more reach NCS 2000 on a **customer-variant
code**, which the optical mapping already records as such. There is no lexical rule for it:

```
X<3-4 digits> anywhere in a SKU            876 SKUs   — WS-X5153, HCIX-FS-X9516, PP1-72X100G …
-X<4 digits> at the END of a SKU            56 SKUs   — and most are REAL placements:
      DS-X9112 / DS-X9124 / DS-X9148   -> MDS 9500 / 9200 switching modules
      DS-X9704                          -> MDS 9700 directors
      WS-X4992 / WS-X4994               -> Catalyst 4900 fan trays
      WS-X5153 / WS-X5154               -> Catalyst 5000 ATM LANE modules
      UCSX-FS-X9516, HCIX-FS-X9516      -> X-Fabric modules
```

Even the narrowest shape that covers all five variants would unplace twenty real modules. Five rows stay as recorded
refusals.

## What is left, and why no rule takes it

| cause | rows | the reason |
| --- | ---: | --- |
| family prefix on a line whose siblings cannot disagree | 42 | measured; the fix is a **mapping scope decision**, not code |
| a capacity read as a platform | ~30 | measured; `CP-7942G` and `WS-C3750G` are real platforms of the same shape, so no `G` rule exists — it belongs in the dictionary, which already knows `GB` is a unit |
| a component model number the letter fence cannot reach | ~15 | `HX-ML-256G8RW` has a hyphen before its digits, so there is no letter to disagree with |
| a customer-variant code | 5 | measured above |
| the rest — a CR2032 battery, an LSI 2208R chip, a wire gauge, bundles, remaining qualifier words | ~14 | each is a single row whose only tell is knowing what the product is |

**The 105 rules could take were every case where a NAMED thing disagreed** — a model letter, a brand, a standards
body, a category noun, a unit. The 106 that remain are cases where nothing in the string disagrees with anything.
That is the boundary, and it is where the campaign stops rather than starts guessing.
