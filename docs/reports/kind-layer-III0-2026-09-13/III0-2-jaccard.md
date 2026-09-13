# Kind layer III.0 item 2 — term-13 label-Jaccard, before and after the role split

Agent `kindlayer-A`, HEAD `ea74e31`, same evidence as item 1 (per-document labels from the pipeline's extractors re-run on the laptop cache, PDF labels from recorded extractor output, `mapLabel(label, category)` at HEAD; held = ledger's spec-bearing doc types; 9796 of 9865 held parts readable). Raw: `raw/item2-jaccard.json` (includes every group with its evidenced key set).

## Formula implemented

```
groups   G = parts of the kind grouped by parts.series; null/empty series -> first token of the name after a leading 'Cisco'
           only groups with >= 1 READABLE HELD part are kept (evidence exists only for held parts)
n_g      = number of readable held parts in group g            (variant 'all-part weights': all parts of the group)
K        = the kind's required-cup keys:
           K_now      = kindQuestionSet(category, kind).required  UNION  .pending keys  (today's profile at HEAD)
           K_proposed = proposed required + pending keys of the archetype (core before the split; core + role adds - role demotions after)
S_g      = { k in K : at least one readable held part of g has a document printing a label that maps to k }   (union)
           variant 'majority': k evidenced on >= 50% of g's readable held parts
           variant 'label strings': the raw label strings (not keys) that map into K_now
J(a,b)   = |S_a ∩ S_b| / |S_a ∪ S_b|;   pairs with S_a = S_b = ∅ are skipped (0/0) and counted
mean     = Σ_{a<b} n_a·n_b·J(S_a,S_b)  /  Σ_{a<b} n_a·n_b          (all unordered pairs of distinct groups)
after    = the same sum POOLED over pairs whose two groups share a role (groups are formed within a role);
           parts with no role (unresolved / '?') are reported as their own bucket and excluded from the pooled mean;
           router rows the spec moves out of the kind are excluded after the split
fails    = mean < 0.5
```

## Summary

| kind | groups (readable) | before: K_now union | before: majority | before: label strings | before: K_proposed | after (pooled within role): K_now union | after: majority | after: label strings | after: K_proposed |
|---|---|---|---|---|---|---|---|---|---|
| switches.switch | 134 | **0.413** | 0.363 | 0.082 | 0.407 | **0.515** | 0.501 | 0.133 | 0.518 |
| switches.switch [sensitivity-business-smb] | 134 | **0.413** | 0.363 | 0.082 | 0.407 | **0.521** | 0.511 | 0.141 | 0.525 |
| wireless.ap | 12 | **0.46** | 0.48 | 0.18 | 0.481 | **0.681** | 0.746 | 0.31 | 0.715 |
| routers.enterprise | 37 | **0.424** | 0.154 | 0.078 | 0.514 | **0.521** | 0.149 | 0.114 | 0.547 |
| collaboration-endpoints.phone | 12 | **0.615** | 0.621 | 0.224 | 0.588 | **0.605** | 0.555 | 0.194 | 0.565 |
| transceiver.pluggable | 48 | **0.509** | 0.306 | 0.221 | 0.634 | — (no role axis proposed) | — | — | — |
| servers-unified-computing.server | 10 | **0.464** | 0.253 | 0.096 | 0.328 | — (no role axis proposed) | — | — | — |
| servers-unified-computing.cpu | 3 | **0.394** | 0.473 | 0.315 | 0.394 | — (no role axis proposed) | — | — | — |
| servers-unified-computing.drive | 3 | **0.657** | 0.591 | 0.611 | 0.657 | — (no role axis proposed) | — | — | — |
| video.transmitter | 1 | **—** | — | — | — | — (no role axis proposed) | — | — | — |

Other variants per kind (before): all-part weights, dropping groups with an empty set — see the detail tables.

## switches.switch

K_now (36): `altitude_max`, `certifications`, `cooling`, `dimensions`, `dram`, `flash`, `form_factor`, `forwarding_rate`, `heat_dissipation`, `humidity_operating`, `ieee_standards`, `input_voltage`, `jumbo_mtu`, `mac_table`, `mgmt_class`, `mtbf`, `packet_buffer`, `poe_standard`, `power_max`, `power_typical`, `psu_config`, `stackable`, `switching_capacity`, `temp_operating`, `temp_storage`, `vlan_max`, `weight`, `ip_rating`, `module_slots`, `poe_budget`, `poe_ports`, `ports`, `psu_redundant`, `rack_units`, `stacking_bandwidth`, `uplink_ports`

K_proposed core (27): `ports`, `uplink_ports`, `switching_capacity`, `forwarding_rate`, `mac_table`, `vlan_max`, `jumbo_mtu`, `packet_buffer`, `mgmt_class`, `psu_config`, `psu_redundant`, `cooling`, `ieee_standards`, `poe_standard`, `poe_budget`, `poe_ports`, `stackable`, `stacking_bandwidth`, `module_slots`, `dimensions`, `weight`, `power_max`, `temp_operating`, `humidity_operating`, `certifications`, `form_factor`, `rack_units`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **0.413** | 134 | 8896 | 15 |
| K_now, union, all-part weights | **0.404** | 134 | 8896 | 15 |
| K_now, union, groups with empty set dropped | **0.435** | 128 | 8128 | 0 |
| K_now, majority | **0.363** | 134 | 8890 | 21 |
| label strings into K_now | **0.082** | 134 | 8896 | 15 |
| K_proposed core, union | **0.407** | 134 | 8890 | 21 |

**After the split (pooled within role):** K_now union **0.515** · majority 0.501 · label strings 0.133 · K_proposed 0.518

| role | parts | readable held | groups (readable) | K_now union | majority | label strings | K_role union | pairs | skipped |
|---|---|---|---|---|---|---|---|---|---|
| smb | 1126 | 109 | 7 | 0.82 | 0.82 | 0.506 | 0.852 | 21 | 0 |
| access | 1425 | 774 | 35 | 0.52 | 0.52 | 0.123 | 0.524 | 594 | 1 |
| core-agg | 446 | 106 | 18 | 0.262 | 0.238 | 0.088 | 0.266 | 153 | 0 |
| datacenter | 973 | 218 | 37 | 0.371 | 0.146 | 0.164 | 0.365 | 666 | 0 |
| industrial | 879 | 299 | 33 | 0.543 | 0.542 | 0.145 | 0.545 | 528 | 0 |
| (unresolved) | 93 | 14 | 4 | 0 | 0 | 0 | 0 | 6 | 0 |

Largest groups (before): Catalyst 9300 n=149/182 |S|=18; Catalyst 9200 n=103/104 |S|=11; Catalyst 3650 n=101/101 |S|=17; Catalyst 3850 n=70/182 |S|=17; Nexus 9000 n=69/219 |S|=17; Business 350 n=39/434 |S|=24; Nexus 3000 n=37/183 |S|=14; Catalyst IE9300 Rugged Series n=29/31 |S|=17; 1300 n=28/28 |S|=14; Catalyst 1000 n=27/27 |S|=15; IE2000 n=25/25 |S|=10; Catalyst 3750-X n=25/25 |S|=15

## switches.switch [sensitivity-business-smb]

K_now (36): `altitude_max`, `certifications`, `cooling`, `dimensions`, `dram`, `flash`, `form_factor`, `forwarding_rate`, `heat_dissipation`, `humidity_operating`, `ieee_standards`, `input_voltage`, `jumbo_mtu`, `mac_table`, `mgmt_class`, `mtbf`, `packet_buffer`, `poe_standard`, `power_max`, `power_typical`, `psu_config`, `stackable`, `switching_capacity`, `temp_operating`, `temp_storage`, `vlan_max`, `weight`, `ip_rating`, `module_slots`, `poe_budget`, `poe_ports`, `ports`, `psu_redundant`, `rack_units`, `stacking_bandwidth`, `uplink_ports`

K_proposed core (27): `ports`, `uplink_ports`, `switching_capacity`, `forwarding_rate`, `mac_table`, `vlan_max`, `jumbo_mtu`, `packet_buffer`, `mgmt_class`, `psu_config`, `psu_redundant`, `cooling`, `ieee_standards`, `poe_standard`, `poe_budget`, `poe_ports`, `stackable`, `stacking_bandwidth`, `module_slots`, `dimensions`, `weight`, `power_max`, `temp_operating`, `humidity_operating`, `certifications`, `form_factor`, `rack_units`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **0.413** | 134 | 8896 | 15 |
| K_now, union, all-part weights | **0.404** | 134 | 8896 | 15 |
| K_now, union, groups with empty set dropped | **0.435** | 128 | 8128 | 0 |
| K_now, majority | **0.363** | 134 | 8890 | 21 |
| label strings into K_now | **0.082** | 134 | 8896 | 15 |
| K_proposed core, union | **0.407** | 134 | 8890 | 21 |

**After the split (pooled within role):** K_now union **0.521** · majority 0.511 · label strings 0.141 · K_proposed 0.525

| role | parts | readable held | groups (readable) | K_now union | majority | label strings | K_role union | pairs | skipped |
|---|---|---|---|---|---|---|---|---|---|
| smb | 1754 | 191 | 11 | 0.739 | 0.848 | 0.353 | 0.788 | 55 | 0 |
| access | 1425 | 774 | 35 | 0.52 | 0.52 | 0.123 | 0.524 | 594 | 1 |
| core-agg | 446 | 106 | 18 | 0.262 | 0.238 | 0.088 | 0.266 | 153 | 0 |
| datacenter | 973 | 218 | 37 | 0.371 | 0.146 | 0.164 | 0.365 | 666 | 0 |
| industrial | 251 | 217 | 29 | 0.562 | 0.554 | 0.201 | 0.555 | 406 | 0 |
| (unresolved) | 93 | 14 | 4 | 0 | 0 | 0 | 0 | 6 | 0 |

Largest groups (before): Catalyst 9300 n=149/182 |S|=18; Catalyst 9200 n=103/104 |S|=11; Catalyst 3650 n=101/101 |S|=17; Catalyst 3850 n=70/182 |S|=17; Nexus 9000 n=69/219 |S|=17; Business 350 n=39/434 |S|=24; Nexus 3000 n=37/183 |S|=14; Catalyst IE9300 Rugged Series n=29/31 |S|=17; 1300 n=28/28 |S|=14; Catalyst 1000 n=27/27 |S|=15; IE2000 n=25/25 |S|=10; Catalyst 3750-X n=25/25 |S|=15

## wireless.ap

K_now (12): `antenna_type`, `ap_max_clients`, `certifications`, `dimensions`, `poe_standard`, `ports`, `power_max`, `radio_bands`, `spatial_streams`, `temp_operating`, `weight`, `wifi_generation`

K_proposed core (13): `wifi_generation`, `radio_bands`, `radio_count`, `spatial_streams`, `antenna_type`, `poe_standard`, `power_max`, `ports`, `dimensions`, `weight`, `temp_operating`, `certifications`, `ip_rating`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **0.46** | 12 | 65 | 1 |
| K_now, union, all-part weights | **0.184** | 12 | 65 | 1 |
| K_now, union, groups with empty set dropped | **0.501** | 10 | 45 | 0 |
| K_now, majority | **0.48** | 12 | 65 | 1 |
| label strings into K_now | **0.18** | 12 | 65 | 1 |
| K_proposed core, union | **0.481** | 12 | 65 | 1 |

**After the split (pooled within role):** K_now union **0.681** · majority 0.746 · label strings 0.31 · K_proposed 0.715

_Caution: roles with no measurable pair (fewer than two groups holding readable evidence) contribute nothing to the pooled mean: `indoor`, `industrial`, `mesh-extender`. The pooled 'after' number describes only the remaining roles._

| role | parts | readable held | groups (readable) | K_now union | majority | label strings | K_role union | pairs | skipped |
|---|---|---|---|---|---|---|---|---|---|
| indoor | 1920 | 1 | 1 | — | — | — | — | 0 | 0 |
| outdoor | 333 | 6 | 2 | 0 | 0 | 0 | 0 | 1 | 0 |
| industrial | 99 | 0 | 0 | — | — | — | — | 0 | 0 |
| smb | 312 | 85 | 5 | 0.683 | 0.748 | 0.31 | 0.716 | 10 | 0 |
| mesh-extender | 42 | 3 | 1 | — | — | — | — | 0 | 0 |
| (unresolved) | 47 | 17 | 3 | 0.44 | 0.44 | 0.33 | 0.44 | 3 | 0 |

Largest groups (before): Small Business 100 n=28/29 |S|=7; Small Business 500 n=24/29 |S|=6; Business 100 n=19/187 |S|=6; Catalyst 9800 Series Wireless Controllers n=11/18 |S|=2; Small Business 300 n=11/11 |S|=6; Catalyst 9163 n=5/32 |S|=2; Business 100 Series Mesh Extenders n=3/42 |S|=6; Business 200 n=3/56 |S|=7; Catalyst Center n=3/3 |S|=2; Ultra-Reliable Wireless Backhaul n=3/3 |S|=0; Aironet 1550 n=1/105 |S|=1; Catalyst Embedded Controller n=1/171 |S|=0

## routers.enterprise

K_now (26): `acl_entries`, `altitude_max`, `certifications`, `dimensions`, `dram`, `flash`, `form_factor`, `humidity_operating`, `input_voltage`, `ipsec_throughput`, `ipsec_tunnels`, `ipv4_routes`, `ipv6_routes`, `lan_interfaces`, `nat_sessions`, `ports`, `power_max`, `power_typical`, `router_throughput`, `temp_operating`, `temp_storage`, `vlan_max`, `wan_interfaces`, `weight`, `module_slots`, `rack_units`

K_proposed core (15): `router_throughput`, `wan_interfaces`, `lan_interfaces`, `module_slots`, `dram`, `flash`, `cellular_bands`, `dimensions`, `weight`, `power_max`, `temp_operating`, `humidity_operating`, `certifications`, `form_factor`, `rack_units`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **0.424** | 37 | 666 | 0 |
| K_now, union, all-part weights | **0.42** | 37 | 666 | 0 |
| K_now, union, groups with empty set dropped | **0.435** | 36 | 630 | 0 |
| K_now, majority | **0.154** | 37 | 665 | 1 |
| label strings into K_now | **0.078** | 37 | 666 | 0 |
| K_proposed core, union | **0.514** | 37 | 666 | 0 |

Before, excluding the moved-out router rows: K_now union 0.424, K_proposed 0.514.

**After the split (pooled within role):** K_now union **0.521** · majority 0.149 · label strings 0.114 · K_proposed 0.547

_Caution: roles with no measurable pair (fewer than two groups holding readable evidence) contribute nothing to the pooled mean: `smb`, `edge`. The pooled 'after' number describes only the remaining roles._

| role | parts | readable held | groups (readable) | K_now union | majority | label strings | K_role union | pairs | skipped |
|---|---|---|---|---|---|---|---|---|---|
| branch | 1052 | 423 | 16 | 0.522 | 0.148 | 0.114 | 0.548 | 120 | 0 |
| smb | 155 | 58 | 1 | — | — | — | — | 0 | 0 |
| edge | 101 | 6 | 1 | — | — | — | — | 0 | 0 |
| industrial-iot | 96 | 28 | 10 | 0.347 | 0.347 | 0.066 | 0.382 | 45 | 0 |
| (unresolved) | 25 | 16 | 6 | 0.047 | 0.047 | 0.003 | 0.056 | 15 | 0 |

Largest groups (before): 800 n=206/323 |S|=11; 2900 ISR n=76/318 |S|=12; RV Series n=58/155 |S|=8; 3800 Series Integrated Services Routers ISR n=31/33 |S|=10; 8100 Series Secure n=29/39 |S|=19; 1000 n=22/101 |S|=11; 1900 ISR n=15/39 |S|=10; 8000 n=14/33 |S|=20; High-Speed WAN Interface Cards n=12/38 |S|=9; 800 ISR n=10/44 |S|=9; 4000 ISR n=9/40 |S|=14; 900 ISR n=8/34 |S|=6

## collaboration-endpoints.phone

K_now (14): `audio_codecs`, `certifications`, `dimensions`, `display`, `humidity_operating`, `poe_standard`, `ports`, `power_max`, `supported_protocols`, `temp_operating`, `temp_storage`, `ui_languages`, `voice_lines`, `weight`

K_proposed core (9): `display`, `voice_lines`, `ports`, `poe_standard`, `audio_codecs`, `supported_protocols`, `dimensions`, `weight`, `wifi_generation`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **0.615** | 12 | 66 | 0 |
| K_now, union, all-part weights | **0.639** | 12 | 66 | 0 |
| K_now, union, groups with empty set dropped | **0.615** | 12 | 66 | 0 |
| K_now, majority | **0.621** | 12 | 66 | 0 |
| label strings into K_now | **0.224** | 12 | 66 | 0 |
| K_proposed core, union | **0.588** | 12 | 66 | 0 |

**After the split (pooled within role):** K_now union **0.605** · majority 0.555 · label strings 0.194 · K_proposed 0.565

| role | parts | readable held | groups (readable) | K_now union | majority | label strings | K_role union | pairs | skipped |
|---|---|---|---|---|---|---|---|---|---|
| desk | 407 | 200 | 9 | 0.61 | 0.558 | 0.193 | 0.568 | 36 | 0 |
| wireless | 33 | 22 | 3 | 0.525 | 0.628 | 0.276 | 0.577 | 3 | 0 |
| dect | 25 | 25 | 2 | 0.6 | 0.6 | 0.333 | 0.6 | 1 | 0 |
| conference | 48 | 32 | 5 | 0.353 | 0.387 | 0.22 | 0.386 | 10 | 0 |
| (unresolved) | 0 | 0 | 0 | — | — | — | — | 0 | 0 |

Largest groups (before): IP Phone 8800 Series n=71/106 |S|=11; Desk Phone 9800 Series n=37/37 |S|=10; 7900 - Unified IP Phone n=36/139 |S|=10; IP Phone 8800 Series with Multiplatform Firmware n=25/46 |S|=2; IP DECT 6800 Series with Multiplatform Firmware n=24/24 |S|=8; 6800 - IP Phone w/Multiplatform Firmware n=21/32 |S|=8; IP Phone 7800 Series with Multiplatform Firmware n=19/19 |S|=2; IP Phone 7800 Series n=16/25 |S|=10; Wireless Phone n=13/14 |S|=8; SPA300 IP Phones n=8/9 |S|=7; SPA500 IP Phones n=8/26 |S|=11; Room Phone n=1/1 |S|=2

## transceiver.pluggable

K_now (15): `connector`, `data_rate`, `ddm`, `form_factor`, `media`, `power_max`, `standard`, `temp_class`, `cable_length`, `fiber_type`, `reach_max`, `rx_sensitivity`, `tx_power`, `wavelength`, `wire_gauge`

K_proposed core (11): `form_factor`, `data_rate`, `connector`, `reach_max`, `wavelength`, `media`, `fiber_type`, `tx_power`, `rx_sensitivity`, `power_max`, `temp_operating`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **0.509** | 48 | 1092 | 36 |
| K_now, union, all-part weights | **0.5** | 48 | 1092 | 36 |
| K_now, union, groups with empty set dropped | **0.546** | 39 | 741 | 0 |
| K_now, majority | **0.306** | 48 | 1073 | 55 |
| label strings into K_now | **0.221** | 48 | 1092 | 36 |
| K_proposed core, union | **0.634** | 48 | 1122 | 6 |

Largest groups (before): Cisco n=249/431 |S|=14; ONS 15454 Series Multiservice Transport Platforms n=214/369 |S|=9; Network Convergence System 2000 Series n=196/207 |S|=10; Transceiver Modules n=136/322 |S|=8; MDS 9500 Series Multilayer Directors n=90/92 |S|=8; Catalyst 6500 n=36/37 |S|=4; 1000 n=34/37 |S|=1; Storage Networking Modules n=33/46 |S|=10; MDS 9000 Series Multilayer n=28/30 |S|=9; Meraki n=24/25 |S|=0; ASR 900 n=20/22 |S|=8; Network Convergence System 4000 Series n=14/15 |S|=9

## servers-unified-computing.server

K_now (15): `altitude_max`, `certifications`, `cpu`, `cpu_sockets_max`, `dimensions`, `drive_bays`, `form_factor`, `humidity_operating`, `memory_max`, `memory_speed_max`, `power_max`, `temp_operating`, `temp_storage`, `weight`, `rack_units`

K_proposed core (14): `form_factor`, `rack_units`, `cpu_sockets_max`, `memory_max`, `dimm_slots`, `drive_bays`, `pcie_slots`, `memory_speed_max`, `power_max`, `dimensions`, `weight`, `temp_operating`, `humidity_operating`, `certifications`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **0.464** | 10 | 45 | 0 |
| K_now, union, all-part weights | **0.498** | 10 | 45 | 0 |
| K_now, union, groups with empty set dropped | **0.464** | 10 | 45 | 0 |
| K_now, majority | **0.253** | 10 | 45 | 0 |
| label strings into K_now | **0.096** | 10 | 45 | 0 |
| K_proposed core, union | **0.328** | 10 | 45 | 0 |

Largest groups (before): UCS C-Series n=60/984 |S|=10; S-Series Storage n=38/74 |S|=7; UCS X-Series n=25/36 |S|=6; Unified Edge n=11/11 |S|=4; Mini Series n=11/13 |S|=5; Cloud Services Platform 5000 n=5/14 |S|=2; 9100 Fabric Interconnects n=5/5 |S|=8; Nexus 9000 n=2/2 |S|=1; UCS E-Series n=1/92 |S|=5; Catalyst Center n=1/2 |S|=7

## servers-unified-computing.cpu

K_now (6): `clock_speed`, `cpu_cache`, `cpu_cores`, `memory_speed_max`, `product_compatibility`, `tdp`

K_proposed core (6): `cpu_cores`, `clock_speed`, `cpu_cache`, `tdp`, `memory_speed_max`, `product_compatibility`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **0.394** | 3 | 3 | 0 |
| K_now, union, all-part weights | **0.2** | 3 | 3 | 0 |
| K_now, union, groups with empty set dropped | **0.833** | 2 | 1 | 0 |
| K_now, majority | **0.473** | 3 | 3 | 0 |
| label strings into K_now | **0.315** | 3 | 3 | 0 |
| K_proposed core, union | **0.394** | 3 | 3 | 0 |

Largest groups (before): UCS C-Series n=102/1341 |S|=6; UCS X-Series n=62/218 |S|=5; UCS B-Series n=43/595 |S|=0

## servers-unified-computing.drive

K_now (3): `drive_interface`, `product_compatibility`, `storage_capacity`

K_proposed core (3): `storage_capacity`, `drive_interface`, `product_compatibility`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **0.657** | 3 | 3 | 0 |
| K_now, union, all-part weights | **0.817** | 3 | 3 | 0 |
| K_now, union, groups with empty set dropped | **0.657** | 3 | 3 | 0 |
| K_now, majority | **0.591** | 3 | 3 | 0 |
| label strings into K_now | **0.611** | 3 | 3 | 0 |
| K_proposed core, union | **0.657** | 3 | 3 | 0 |

Largest groups (before): UCS C-Series n=138/1205 |S|=2; UCS X-Series n=80/217 |S|=1; UCS B-Series n=50/546 |S|=2

## video.transmitter

K_now (2): `tx_power`, `wavelength`

K_proposed core (3): `tx_power`, `wavelength`, `product_compatibility`

| before-split variant | mean | groups | pairs | pairs skipped (both empty) |
|---|---|---|---|---|
| K_now, union, readable-held weights | **—** | 1 | 0 | 0 |
| K_now, union, all-part weights | **—** | 1 | 0 | 0 |
| K_now, union, groups with empty set dropped | **—** | 1 | 0 | 0 |
| K_now, majority | **—** | 1 | 0 | 0 |
| label strings into K_now | **—** | 1 | 0 | 0 |
| K_proposed core, union | **—** | 1 | 0 | 0 |

Largest groups (before): Prisma II Products n=89/497 |S|=2

