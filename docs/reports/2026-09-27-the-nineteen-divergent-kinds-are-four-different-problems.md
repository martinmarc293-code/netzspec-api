# The 19 divergent kinds are **four** different problems, and only one of them is an exception table

**27 Sep 2026.** `kind_profile_parity` is red on 19 hardware kinds asked different cups depending on
their category. The instruction was *"each of the 19 is a deliberate distinction with a witness or a
profile edited in one place — `kindProfiles.ts` is where they get decided, one line each."*

Read in full — every differing cup on both sides, with a witness SKU per category, not the first
difference the verifier prints — **the 19 are not one list with two outcomes.** They are four causes
with four different fixes, and three of them cannot be written as exceptions at all:

| cause | kinds | the fix |
|---|---|---|
| **A. not a kind** | `unknown` | exclude structurally; `unknown_zero` owns that population |
| **B. one kind name, two different devices** | `amplifier`, `sensor`, `gateway`, `camera`, `pluggable` | the KIND CLASSIFIER, not any profile |
| **C. same cups, different requirement level** | `appliance` | one decision about strictness, not seven about content |
| **D. a profile edited in one place** | `antenna`, `bundle`, `cable`, `chassis`, `drive`, `fabric`, `linecard`, `memory`, `module`, `power`, `server`, `supervisor` | edit the profile; an arrangement decision each |

Putting a B or a D into an exceptions table would record *"these two categories deliberately ask
different things"* about a case where the real answer is *"these are two different products"* or
*"one of them is simply missing a cup"*. The table would go green and the defect would be closed as
a decision. That is the thing R4 forbids.

## A. `unknown` is the absence of a kind

    unknown  (10 categories, 468 parts)
      req product_compatibility  ASKED interfaces-modules | NOT the other nine

`unknown` is what the classifier returns when it cannot say. Comparing its cup sets across
categories asks whether two *unclassified* populations are asked the same questions, which is not a
question about a kind. `unknown_zero` already judges this population (3,944 live hardware parts) and
its fix is classification, not parity. **Excluded structurally, with the reason, not as an
exception** — an exclusion nobody can see is where the next real break hides, so the test names it.

## B. One kind name covering two devices — five cases, and the witnesses prove it

This is the finding of the exercise, and every one of the five is provable by reading the witness
SKUs the divergence itself names:

| kind | category A | category B | what the cups say |
|---|---|---|---|
| `amplifier` | optical-networking `15216-EDFA1=` | video `4000770` | A is an **erbium-doped fibre amplifier** (asks `power_max`, `product_compatibility`); B is an **RF amplifier** (asks `tx_power`) |
| `sensor` | meraki `MT10` | wireless `AIR-AP1800S-A-K9` | A is an **environmental sensor** (`battery_life`, `humidity_operating`, `mounting`); B is a **Wi-Fi access point with sensing radios** (`radio_bands`, `spatial_streams`, `wifi_generation`, `ap_max_clients`, `antenna_type`) |
| `gateway` | meraki `MG21` | unified-communications `SPA8000-BR` | A is a **cellular gateway** (`cellular_bands`); B is an **analogue voice gateway** (`fxo_ports`, `fxs_ports`, `audio_codecs`, `supported_protocols`) |
| `camera` | collaboration-endpoints `CD-DSKCAM-C-US` | meraki `MV12` | A is a **conferencing camera** (`camera_zoom`); B is a **surveillance camera** (`image_sensor`, `storage_capacity`, `video_quality_max`) |
| `pluggable` | optical-networking `15454-ML1000-2` | transceiver `15216-GBIC-1510` | A is asked `reach_max`/`wavelength`; B is asked `ddm`/`form_factor`/`media`/`standard`/`temp_class` — a DWDM line-card pluggable against a datacom optic |

`sensor` and `gateway` are the sharpest: `cellular_bands` and `fxo_ports` cannot both belong to one
kind, and neither can `battery_life` and `ap_max_clients`. **A cup difference here is the correct
answer to the wrong question** — the two populations should not share a kind, so no exception on the
profile can be right, and writing one would freeze the misclassification in place.

The right fix is a kind split (`amplifier-optical` / `amplifier-rf`, `sensor-environment` /
`sensor-wireless`, `gateway-cellular` / `gateway-voice`, `camera-conferencing` /
`camera-surveillance`), which is a change to `partKind.ts` and to every artefact keyed on a kind —
an arrangement decision, and it belongs with the reviewer before a line of it is written.

## C. `appliance` is one decision, not seven

    appliance (meraki MX100 | routers ASR-XRV9000-APLN | security ASA-SSC-AIP-5-K9= | wireless AIR-CMX-3375-K9)
      req     concurrent_sessions, firewall_throughput, ipsec_throughput, threat_throughput …  ASKED meraki  | NOT security
      pending concurrent_sessions, firewall_throughput, ipsec_throughput, threat_throughput …  ASKED security | NOT meraki

**The same cups, on both sides.** `security` holds them as `pending`, `meraki` as `req`. Read as a
content divergence it looks like seven disagreements; it is one question — *is a firewall's
throughput required or pending for this brand's appliances* — and the answer is a single line in one
of the two profiles. Nothing here is a distinction between products.

`ports` is the one real content difference (`security` asks it as `pending` where the other three
ask it as `req`), and it falls out with the same decision.

## D. Twelve profiles edited in one place, and each is an arrangement decision

These are the ones the instruction's second half describes, and they are the majority. The tell is
that the cup is asked by *most* categories and missing from one or two, and that the missing side
has no possible reason:

| kind | the cup | asked by | not by | why it is a gap, not a distinction |
|---|---|---|---|---|
| `power` | `input_voltage` | 12 | interfaces-modules | a power supply has an input voltage wherever it is filed |
| `power` | `airflow`, `psu_rated_output` | 11 | interfaces-modules, routers | ditto |
| `drive` | `drive_interface` | 6 | routers, switches | `C9400-SSD-240GB` has an interface |
| `memory` | `memory_speed_max` | 7 | routers, switches | a DIMM has a speed |
| `cable` | `cable_length` | 11 | interfaces-modules, routers | a cable has a length |
| `cable` | `connector` | 10 | collaboration-endpoints, routers, wireless | so does a connector |
| `chassis` | `dimensions`, `form_factor`, `module_slots`, `psu_config`, `weight` | 5 | **routers** | a router chassis has all five; this is one profile missing a block |
| `chassis` | `certifications`, `humidity_operating` | 5 | switches | " |
| `linecard` | `data_rate`, `power_max` | 4 | routers | " |
| `module` | `ports` | 4 | interfaces-modules | " |
| `fabric` | `power_max` | 2 | routers, switches | " |
| `supervisor` | `power_max` | storage-networking | switches | " |
| `server` | `altitude_max`, `cpu` | 3 | collaboration-endpoints, unified-communications | a BE6H-M4-K9= is a server and has a CPU |
| `antenna` | `antenna_connector`, `antenna_gain` | wireless | routers | `3G-ACC-OUT-LA` is an antenna and has both |
| `bundle` | `product_compatibility` | routers, switches | 4 others | " |

Two entries in D are genuinely the other way round and are marked as such, because a cup asked by
exactly ONE category is more likely an addition than the other nine being gaps:

* `memory` / `flash` — asked only by interfaces-modules. Flash is not RAM; this is that category
  adding its own cup, and it may be correct.
* `linecard` / `fabric_bandwidth`, `poe_standard`, `poe_ports` and `module` / `poe_standard` —
  asked only by switches. A PoE standard on a switch line card is real and on an optical line card
  is not, so this looks like a legitimate distinction with a witness (`2D-X6816-10G-2T=`).
* `cable` in `transceiver` — asked `data_rate`, `ddm`, `form_factor`, `power_max`, `standard`,
  `temp_class`. A `cable` filed under `transceiver` is an **active** cable (DAC/AOC), witness
  `MA-CBL-100G-1M`, and it genuinely has a data rate and DDM. **A real exception.**

## What this changes about the ask

`kindProfiles.ts` as an exceptions table is the right mechanism for **case D's three real
distinctions and case B's zero** — which is to say it is a much smaller file than 19 lines, and the
other sixteen divergences are three separate pieces of work:

1. a kind split for five kinds (`partKind.ts`, and every artefact keyed on a kind);
2. one strictness decision for `appliance`;
3. twelve profile edits, each one an arrangement decision with the freeze regenerated on the same
   commit.

Recording all 19 as exceptions would take the test green in one commit and lose all three.
