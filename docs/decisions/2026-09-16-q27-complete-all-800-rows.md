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
