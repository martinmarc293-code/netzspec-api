# kind_profile_parity: the full N-way view behind ruling (d), 29 Sep 2026

The board line prints `diffs[0]`, one pair per kind. Resolved over every category through the real
`requirementFor` (report 57ad110, 239 category/kind pairs). `own` = live cisco parts holding a non-inherited
fact for the cup. Spec = spec-bearing / hardware parts.

## Landing as ruled (this batch)
- bundle `product_compatibility` -> wireless 0/81, collaboration-endpoints 0/13 (+ unified-communications,
  conferencing: the collab invariant), servers-unified-computing 8/267. Relation-backed, satisfiable as not_held.
- cable `product_compatibility` -> optical-networking 0/125 (the only category without it).
- supervisor `fabric_bandwidth` -> storage-networking 3/17; `mac_table`, `uplink_ports` -> exception
  "Fibre Channel supervisor - no Ethernet MAC table or uplinks".
- chassis `rack_units` -> ROUTERS (the lacking side; hci already asks, pending on form_factor). routers own 6 (NCS4206-SA).
- module `cellular_bands` gated on `cellular` (column, 0 NULL) in interfaces-modules, wireless, security, switches,
  exactly as routers: cond(cellular = true AND kind module), `cellular` declared so the gate pends.
- pluggable: optical-networking's pluggable is asked transceiver's question set, derived at load (not a copy).
- antenna `antenna_gain` routers: exception with a dated lease (7 days), lapses red unless the measurement lands.

## Needs a ruling (Q1-Q4)

Q1 chassis: SIX cups differ, not one. None of the five below was in the ruling.
| cup | asks | does not ask | own facts |
| --- | --- | --- | --- |
| altitude_max | optical, routers, sucs, hci | video 4/69, switches 13/82 | 0 anywhere |
| power_max | optical, video, sucs, hci | routers 41/161, switches | 0 anywhere |
| product_compatibility | optical, sucs, hci | video, routers, switches | relation-backed |
| temp_operating | optical, video, sucs, hci | routers, switches | switches 11 (C9404R), optical 1 |
| temp_storage | optical, routers, sucs, hci | video, switches | 0 anywhere |
| rack_units | optical, video, switches (+routers now) req | sucs, hci PENDING on form_factor | switches 21, routers 6, sucs 2 |
PROPOSAL: the union in all six (a chassis has all six wherever it is filed); rack_units asked of kind chassis in
sucs/hci without the form_factor gate (a chassis is rack-mounted; the gate is for servers).

Q2 module data_rate: interfaces-modules is 68 of 68 DSP / voice / crypto cards (PVDM 45, NM-HDV 6, SPA-IPSEC 5,
ISM-VPN 4, NME-RVPN 3, SM-EC 3, AIM 1, 3810-VCM3 1): no line rate, so the ruled "add" would be 68 permanent gaps.
Routers would be a 4th cup at nothing known (rule 6; the power_max precedent).
PROPOSAL: two exceptions: interfaces-modules (DSP/voice/crypto modules have no line rate; witness PVDM4-128) and
routers (rule 6, as power_max).

Q3 module power_max, a HOLE IN THE CHECK: `parityRuled` counts a cup as covered when ANY ruling for the kind names
it and ANY of its categories is present. The routers power_max ruling therefore also excuses wireless and
switches, which do not ask it either. Fixing the check (a ruling covers a cup only when every category it does not
name agrees) re-exposes them. switches own 19 (IEM-3300-14T2S=). wireless `module` is not one object: 121 parts
include DIMMs (AIR-MR / DN3-L-MR / CMX-MR 15), SSDs (AIR-SD 6), CPUs (AIR-CPU 2, which hold the 7 power_max facts),
RAID (4), TPM (2), NIC (2), BLE beacons (2) beside 29 radio modules and 10 C9800 network modules.
PROPOSAL: fix the check now; add module power_max to switches; wireless module -> reclassify those SKUs into the
memory / drive / cpu / storage-controller / tpm / nic kinds first, then parity is asked of real modules.

Q4 cable connector: after collab, only WIRELESS lacks it, and your earlier ruling withheld that row. Measured: 141
wireless cables = 82 mains cords (C5/C13/NEMA...) + 59 RF coax (the wireless domain now holds rp-tnc/n-type/qma/sma).
PROPOSAL: split `power-cord` in wireless by SKU (collab already has the kind), then ask connector of `cable`.
