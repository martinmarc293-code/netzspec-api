# Component-shape round: tokens measured, and the flip list read (30 Sep 2026)

Reviewer order: component shapes first (no RAID card, heat sink or cable inherits a server's weight), flip list read before it
lands, then the comparator round. Measured on the box against every live Cisco part (/tmp/compshape2.mts, /tmp/flips.mts).

## Tokens (added to COMPONENT_SKU_SHAPES)
contains -CPU- -MR- -ML- -GPU- -PCIE- -RIS- -RAIL -BZL- -BBLKD -FBRS- -TPM -MRAID -PSU; prefix UCSC-P- R2XX-RAID CBL- UCSC-HS
UCSX-HS HX-HS UCSB-HS UCS-M2- HX-M2- UCSX-M2- UCS-HD HX-HD HX-SD UCSX-SD UCS-SD N2XX-.
Refused on reading the matches: `-M2-` (matched a UCS B230 M2 BLADE SERVER and 15454-M2 chassis parts: M2 is also a generation),
and a global `-HS-` (52 collaboration endpoints: Cisco HEADSETS, products with their own datasheets) -> scoped to the UCS/HX
heatsink prefixes. The false-positive screen's other "suspects" are components whose names mention their host ("Server
Adapter", "Power Supply for Rack Server", "Heat Sink for UCS C460 M4").

## The flip list: 1,672 current inherited facts on 616 parts, 52 (token <- source family) groups
**1,662 flip RIGHT**: components holding a server's / chassis's values -- emc_emissions, emc_immunity, humidity, altitude,
temp_operating, certifications (CPUs, DIMMs, drives, GPUs, PSUs from HyperFlex / UCS C / UCS X / HCI / NCS / FI sheets),
qos_features on a cable and a PSU, call_control on a phone PSU, supported_protocols on RF-gateway rails.
**10 flip WRONG**: adapters inheriting ieee_standards from THEIR OWN family document `unified-computing-system-adapters`
(UCSC-P- 4, -ML- 4 = UCSX-ML mLOM VICs, -PCIE- 2). Proposal: a per-shape own-family exception -- an adapter-shaped SKU still
takes a family-level fact from `unified-computing-system-adapters`.

## The full list
```
  334 facts /  85 parts  -CPU- <- hyperflex-hx-series  fields: emc_emissions 85, humidity_operating 82, humidity_storage 82, certifications 44
        e.g. HX-CPU-A7302 [hyperconverged-systems] Cisco HX-CPU-A7302 | hx225m6-sff-specsheet-edge.pdf
        e.g. HX-CPU-A7302 [hyperconverged-systems] Cisco HX-CPU-A7302 | hx225m6-sff-specsheet-edge.pdf
  236 facts /  75 parts  -CPU- <- compute-hyperconverged  fields: temp_operating 50, altitude_max 30, altitude_storage 30, certifications 30
        e.g. HCI-CPU-I6515P [hyperconverged-infrastructure] Cisco HCI-CPU-I6515P | hcinx240c-m8-lff-server-specsheet.pdf
        e.g. HCI-CPU-I6515P [hyperconverged-infrastructure] Cisco HCI-CPU-I6515P | hcinx240c-m8-lff-server-specsheet.pdf
  202 facts /  50 parts  -CPU- <- compute-hyperconverged-nutanix  fields: humidity_operating 44, humidity_storage 36, emc_emissions 31, emc_immunity 31
        e.g. HCIX-CPU-I6454S [hyperconverged-infrastructure] Cisco HCIX-CPU-I6454S | hcix210c-m7-all-nvme-node.pdf
        e.g. HCIX-CPU-I6454S [hyperconverged-infrastructure] Cisco HCIX-CPU-I6454S | hcix210c-m7-all-nvme-node.pdf
  140 facts /  70 parts  -CPU- <- ucs-c-series-rack-servers  fields: emc_immunity 70, emc_emissions 70
        e.g. UCS-CPU-A9135 [servers-unified-computing] Cisco UCS-CPU-A9135 | ucs-c225-m8-sff-rack-server-sp.pdf
        e.g. UCS-CPU-A9135 [servers-unified-computing] Cisco UCS-CPU-A9135 | ucs-c225-m8-sff-rack-server-sp.pdf
   96 facts /  48 parts  UCS-HD <- ucs-c-series-rack-servers  fields: emc_immunity 48, emc_emissions 48
        e.g. UCS-HDL22TW1S74K [servers-unified-computing] Cisco UCS-HDL22TW1S74K | ucs-c240-m8-lff-rack-server.pdf
        e.g. UCS-HDL22TW1S74K [servers-unified-computing] Cisco UCS-HDL22TW1S74K | ucs-c240-m8-lff-rack-server.pdf
   92 facts /  31 parts  -CPU- <- hyperconverged-infrastructure  fields: emc_immunity 31, emc_emissions 31, humidity_operating 15, humidity_storage 15
        e.g. HCI-CPU-I6554S [hyperconverged-infrastructure] Cisco HCI-CPU-I6554S | hci-220m7-specsheet.pdf
        e.g. HCI-CPU-I6554S [hyperconverged-infrastructure] Cisco HCI-CPU-I6554S | hci-220m7-specsheet.pdf
   46 facts /  46 parts  -CPU- <- ucs-x-series-modular-system  fields: altitude_storage 46
        e.g. UCSX-CPU-A9115 [servers-unified-computing] Cisco UCSX-CPU-A9115 | ucs-x215c-m8-compute-node.pdf
        e.g. UCSX-CPU-A9015 [servers-unified-computing] Cisco UCSX-CPU-A9015 | ucs-x215c-m8-compute-node.pdf
   42 facts /  21 parts  UCS-SD <- ucs-c-series-rack-servers  fields: emc_immunity 21, emc_emissions 21
        e.g. UCS-SDB960OA1V [servers-unified-computing] Cisco UCS-SDB960OA1V | ucs-c220-m8-sff-rack-server.pdf
        e.g. UCS-SDB960OA1V [servers-unified-computing] Cisco UCS-SDB960OA1V | ucs-c220-m8-sff-rack-server.pdf
   40 facts /  10 parts  HX-SD <- hyperflex-hx-series  fields: humidity_operating 10, humidity_storage 10, emc_emissions 10, certifications 7
        e.g. HX-SD38T2HTNK9 [hyperconverged-systems] Cisco HX-SD38T2HTNK9 | hxaf-220c-m5-specsheet.pdf
        e.g. HX-SD38T2HTNK9 [hyperconverged-systems] Cisco HX-SD38T2HTNK9 | hxaf-220c-m5-specsheet.pdf
   36 facts /   9 parts  -MR- <- hyperflex-hx-series  fields: certifications 9, humidity_operating 9, humidity_storage 9, emc_emissions 9
        e.g. HX-MR-X64G2RW [hyperconverged-systems] 64GB RDIMM DRx4 3200 (16Gb) | hx-e-220m5sx-edge-specsheet.pdf
        e.g. HX-MR-X64G2RW [hyperconverged-systems] 64GB RDIMM DRx4 3200 (16Gb) | hx-e-220m5sx-edge-specsheet.pdf
   31 facts /  17 parts  UCSC-P- <- ucs-c-series-rack-servers  fields: emc_immunity 17, emc_emissions 14
        e.g. UCSC-P-N7S400GF5 [servers-unified-computing] Cisco UCSC-P-N7S400GF5 | ucs-c240-m8-sff-rack-server.pdf
        e.g. UCSC-P-N7S400GF5 [servers-unified-computing] Cisco UCSC-P-N7S400GF5 | ucs-c240-m8-sff-rack-server.pdf
   27 facts /   5 parts  -GPU- <- compute-hyperconverged-nutanix  fields: humidity_operating 5, humidity_storage 5, temp_storage 4, altitude_storage 4
        e.g. HCIX-GPU-L40S [hyperconverged-infrastructure] Cisco HCIX-GPU-L40S | compute-hyperconverged-440p-pcie-node-ds.pdf
        e.g. HCIX-GPU-L40S [hyperconverged-infrastructure] Cisco HCIX-GPU-L40S | compute-hyperconverged-440p-pcie-node-ds.pdf
   26 facts /  26 parts  UCSX-SD <- ucs-x-series-modular-system  fields: altitude_storage 26
        e.g. UCSX-SDB480OA1P [servers-unified-computing] Cisco UCSX-SDB480OA1P | x410cm8-specsheet.pdf
        e.g. UCSX-SD960GM2NK9D [servers-unified-computing] Cisco UCSX-SD960GM2NK9D | x410cm8-specsheet.pdf
   20 facts /   5 parts  -GPU- <- hyperflex-hx-series  fields: humidity_operating 5, humidity_storage 5, emc_emissions 5, certifications 4
        e.g. HX-GPU-P4 [hyperconverged-systems] NVIDIA P4 PCIE 75W 8GB | hx240c-m5-specsheet.pdf
        e.g. HX-GPU-P4 [hyperconverged-systems] NVIDIA P4 PCIE 75W 8GB | hx240c-m5-specsheet.pdf
   18 facts /   9 parts  -GPU- <- ucs-c-series-rack-servers  fields: emc_emissions 9, emc_immunity 9
        e.g. UCSC-GPU-H200-NVL2 [servers-unified-computing] Cisco UCSC-GPU-H200-NVL2 | ucs-c240-m8-sff-rack-server.pdf
        e.g. UCSC-GPU-H200-NVL2 [servers-unified-computing] Cisco UCSC-GPU-H200-NVL2 | ucs-c240-m8-sff-rack-server.pdf
   17 facts /   8 parts  -PSU <- network-convergence-system-1000-series  fields: regions_supported 7, certifications 7, emc_emissions 2, encryption 1
        e.g. NCS1K4-AC-PSU= [optical-networking] Network Convergence System 1004 AC Power Supply Unit | datasheet-c78-740368.html
        e.g. NCS1K4-AC-PSU= [optical-networking] Network Convergence System 1004 AC Power Supply Unit | datasheet-c78-740368.html
   16 facts /   4 parts  -MR- <- compute-hyperconverged-nutanix  fields: emc_emissions 4, emc_immunity 4, humidity_operating 4, humidity_storage 4
        e.g. HCI-MR-X32G1RW [hyperconverged-infrastructure] Cisco HCI-MR-X32G1RW | hciaf240c-m6-spec-sheet.pdf
        e.g. HCI-MR-X32G1RW [hyperconverged-infrastructure] Cisco HCI-MR-X32G1RW | hciaf240c-m6-spec-sheet.pdf
   16 facts /   4 parts  -MR- <- compute-hyperconverged  fields: altitude_max 4, temp_operating 4, altitude_storage 4, certifications 4
        e.g. UCS-MR-X16G1RW [hyperconverged-infrastructure] Cisco UCS-MR-X16G1RW | 5108b200m5m6-compute-specsheet.pdf
        e.g. UCS-MR-X16G1RW [hyperconverged-infrastructure] Cisco UCS-MR-X16G1RW | 5108b200m5m6-compute-specsheet.pdf
   16 facts /   4 parts  -ML- <- hyperflex-hx-series  fields: humidity_operating 4, humidity_storage 4, certifications 4, emc_emissions 4
        e.g. HX-ML-X64G4RT-H [hyperconverged-systems] 64GB DDR4-2933-MHz LRDIMM/4Rx4/1.2v | hx-e-220m5sx-edge-specsheet.pdf
        e.g. HX-ML-X64G4RT-H [hyperconverged-systems] 64GB DDR4-2933-MHz LRDIMM/4Rx4/1.2v | hx-e-220m5sx-edge-specsheet.pdf
   15 facts /  15 parts  -GPU- <- ucs-x-series-modular-system  fields: altitude_storage 15
        e.g. UCSX-GPU-L40S [servers-unified-computing] NVIDIA L40S, PASSIVE, 350W, 48GB | ucs-x580p-pcie-node-ds.html
        e.g. UCSX-GPU-T4-16 [servers-unified-computing] NVIDIA T4 PCIE 75W 16GB | ucs-x440p-pcle-node-ds.html
   12 facts /   4 parts  -GPU- <- compute-hyperconverged  fields: emc_emissions 3, emc_immunity 3, temp_operating 1, temp_storage 1
        e.g. HCIX-GPU-H200-NVL [hyperconverged-infrastructure] Cisco HCIX-GPU-H200-NVL | hcix580p-specsheet.pdf
        e.g. HCIX-GPU-H200-NVL [hyperconverged-infrastructure] Cisco HCIX-GPU-H200-NVL | hcix580p-specsheet.pdf
   12 facts /   3 parts  UCSC-HS <- hyperflex-hx-series  fields: humidity_operating 3, humidity_storage 3, emc_immunity 3, emc_emissions 3
        e.g. UCSC-HSHP-C245M6 [hyperconverged-systems] Cisco UCSC-HSHP-C245M6 | c245-m6-sff-specsheet.pdf
        e.g. UCSC-HSHP-C245M6 [hyperconverged-systems] Cisco UCSC-HSHP-C245M6 | c245-m6-sff-specsheet.pdf
   12 facts /   3 parts  UCS-M2- <- compute-hyperconverged  fields: temp_operating 3, altitude_max 3, altitude_storage 3, certifications 3
        e.g. UCS-M2-240G= [hyperconverged-infrastructure] Cisco UCS-M2-240G= | 5108b200m5m6-compute-specsheet.pdf
        e.g. UCS-M2-240G= [hyperconverged-infrastructure] Cisco UCS-M2-240G= | 5108b200m5m6-compute-specsheet.pdf
   12 facts /   3 parts  -ML- <- compute-hyperconverged-nutanix  fields: emc_emissions 2, emc_immunity 2, humidity_operating 2, humidity_storage 2
        e.g. HCI-ML-128G4RW [hyperconverged-infrastructure] Cisco HCI-ML-128G4RW | hciaf240c-m6-spec-sheet.pdf
        e.g. HCI-ML-128G4RW [hyperconverged-infrastructure] Cisco HCI-ML-128G4RW | hciaf240c-m6-spec-sheet.pdf
   12 facts /   3 parts  CBL- <- hyperflex-hx-series  fields: emc_immunity 3, humidity_operating 3, humidity_storage 3, emc_emissions 3
        e.g. CBL-FNVME-240M6 [hyperconverged-systems] Cisco CBL-FNVME-240M6 | hx240-m6-h-flash-nvme-spec-sheet.pdf
        e.g. CBL-FNVME-240M6 [hyperconverged-systems] Cisco CBL-FNVME-240M6 | hx240-m6-h-flash-nvme-spec-sheet.pdf
   10 facts /   5 parts  -PSU <- ucs-6200-series-fabric-interconnects  fields: emc_emissions 5, emc_immunity 5
        e.g. UCS-PSU-6248-HVDC [servers-unified-computing] UCS 750W 200V-380V DC Hot Plug Power Supply for 6428UP FI | data_sheet_c78-675245.html
        e.g. UCS-PSU-6248-HVDC [servers-unified-computing] UCS 750W 200V-380V DC Hot Plug Power Supply for 6428UP FI | data_sheet_c78-675245.html
   10 facts /   2 parts  UCS-SD <- identity-services-engine  fields: emc_emissions 2, emc_immunity 2, altitude_max 2, temp_storage 2
        e.g. UCS-SD960GM2NK9-D= [servers-unified-computing] 960GB 2.5in Enter Value 6G SATA Micron G2 SSD (SED) | secure-network-server-3800-series-ds.html
        e.g. UCS-SD960GM2NK9-D= [servers-unified-computing] 960GB 2.5in Enter Value 6G SATA Micron G2 SSD (SED) | secure-network-server-3800-series-ds.html
    8 facts /   5 parts  -PSU <- servers-unified-computing  fields: emc_emissions 5, emc_immunity 3
        e.g. UCS-PSU-6332-AC [servers-unified-computing] UCS 6332/6454 power supply/100-240VAC (650 W) | datasheet-c78-741116.html
        e.g. UCS-PSU-64108-AC [servers-unified-computing] UCS 64108 power supply/100-240VAC | datasheet-c78-741116.html
    8 facts /   2 parts  UCSC-P- <- hyperconverged-infrastructure  fields: emc_immunity 2, emc_emissions 2, humidity_operating 2, humidity_storage 2
        e.g. UCSC-P-ID10GC [hyperconverged-infrastructure] Cisco UCSC-P-ID10GC | compute-hyperconverged-hci-c225m8-sff-specsheet.pdf
        e.g. UCSC-P-ID10GC [hyperconverged-infrastructure] Cisco UCSC-P-ID10GC | compute-hyperconverged-hci-c225m8-sff-specsheet.pdf
    8 facts /   4 parts  UCS-M2- <- ucs-c-series-rack-servers  fields: emc_immunity 4, emc_emissions 4
        e.g. UCS-M2-240GB-D [servers-unified-computing] Cisco UCS-M2-240GB-D | c240m7-sff-specsheet.pdf
        e.g. UCS-M2-240GB-D [servers-unified-computing] Cisco UCS-M2-240GB-D | c240m7-sff-specsheet.pdf
    8 facts /   2 parts  HX-HD <- hyperflex-hx-series  fields: emc_immunity 2, emc_emissions 2, humidity_operating 2, humidity_storage 2
        e.g. HX-HD8T7K4KAM [hyperconverged-systems] 8TB 12G SAS 7.2K RPM LFF HDD (4K) | hyperflex-hx240c-m6-lff-spec-sheet.pdf
        e.g. HX-HD8T7K4KAM [hyperconverged-systems] 8TB 12G SAS 7.2K RPM LFF HDD (4K) | hyperflex-hx240c-m6-lff-spec-sheet.pdf
    8 facts /   4 parts  -PSU <- nexus-31128pq-switch  fields: qos_features 4, emc_emissions 2, emc_immunity 2
        e.g. UCSC-PSU-930WDC [switches] N9K 930W DC Power Supply, Forward airflow (port side intake) | datasheet-c78-734585.html
        e.g. UCSC-PSU-930WDC= [switches] N9K 930W DC Power Supply, Forward airflow (port side intake) | datasheet-c78-734585.html
    8 facts /   2 parts  -PSU <- network-convergence-system-2000-series  fields: temp_operating 2, humidity_operating 2, regions_supported 2, temp_storage 2
        e.g. NCS4K-DC-PSU-V1= [optical-networking] NCS 4000 DC Power System Unit - 1750 W - Balanced A and B | data_sheet_c78-729221.html
        e.g. NCS4K-DC-PSU-V1= [optical-networking] NCS 4000 DC Power System Unit - 1750 W - Balanced A and B | data_sheet_c78-729221.html
    7 facts /   2 parts  -MR- <- network-convergence-system-2000-series  fields: regions_supported 2, emc_emissions 1, humidity_operating 1, temp_storage 1
        e.g. NCS2K-MR-MXP-LIC [optical-networking] 10/40/100G MR Muxponder - Licensable for Encryption | datasheet-c78-733739.html
        e.g. NCS2K-MR-MXP-LIC [optical-networking] 10/40/100G MR Muxponder - Licensable for Encryption | datasheet-c78-733739.html
    7 facts /   7 parts  UCSX-M2- <- ucs-x-series-modular-system  fields: altitude_storage 7
        e.g. UCSX-M2-480G-D [servers-unified-computing] Cisco UCSX-M2-480G-D | x410cm8-specsheet.pdf
        e.g. UCSX-M2-960GB-D [servers-unified-computing] Cisco UCSX-M2-960GB-D | x410cm7-specsheet.pdf
    6 facts /   3 parts  -PSU <- network-convergence-system-4000-series  fields: emc_immunity 3, etsi_standards 3
        e.g. NCS4K-DC-PSU-V1 [optical-networking] DC Power System Unit - 1750 W - Balanced Power | datasheet-c78-729222.html
        e.g. NCS4K-DC-PSU-V1 [optical-networking] DC Power System Unit - 1750 W - Balanced Power | datasheet-c78-729222.html
    6 facts /   2 parts  CBL- <- 8000-series-routers  fields: qos_features 2, programming_interfaces 2, segment_routing_features 2
        e.g. CBL-BRKT-V2 [routers] Cable Management Bracket for 8010 Series Router | 8010-series-large-density-fixed-routers-ds.html
        e.g. CBL-BRKT-V2 [routers] Cable Management Bracket for 8010 Series Router | 8010-series-large-density-fixed-routers-ds.html
    6 facts /   2 parts  -PCIE- <- hyperflex-hx-series  fields: emc_emissions 2, emc_immunity 2, humidity_operating 1, humidity_storage 1
        e.g. HX-PCIE-IRJ453 [hyperconverged-systems] Cisco HX-PCIE-IRJ453 | hyperflex-hx220-m6-edge-spec-sheet.pdf
        e.g. HX-PCIE-IRJ453 [hyperconverged-systems] Cisco HX-PCIE-IRJ453 | hyperflex-hx220-m6-edge-spec-sheet.pdf
    5 facts /   1 parts  -PSU <- identity-services-engine  fields: emc_emissions 1, emc_immunity 1, altitude_max 1, temp_storage 1
        e.g. UCSC-PSU1-1200W-D= [servers-unified-computing] 1200W Power Supply Spare for FMC1800, 2800, 4800 | secure-network-server-3800-series-ds.html
        e.g. UCSC-PSU1-1200W-D= [servers-unified-computing] 1200W Power Supply Spare for FMC1800, 2800, 4800 | secure-network-server-3800-series-ds.html
    4 facts /   4 parts  UCSC-P- <- unified-computing-system-adapters  fields: ieee_standards 4
        e.g. UCSC-P-V5D200G [servers-unified-computing] Cisco UCS VIC 15235 Dual port 40/100/200G PCIe for Cisco UCS | ucs-vic-15000-series-ds.html
        e.g. UCSC-P-V5Q50G [servers-unified-computing] Cisco UCS VIC 15425 Quad port 10/25/50G PCIe for Cisco UCS C | ucs-vic-15000-series-ds.html
    4 facts /   4 parts  -ML- <- unified-computing-system-adapters  fields: ieee_standards 4
        e.g. UCSX-ML-V5D200GV2 [servers-unified-computing] Cisco UCS VIC 15230 2x100G mLOM for Cisco UCS X-Series M6 Co | ucs-vic-15000-series-ds.html
        e.g. UCSX-ML-V5Q50G [servers-unified-computing] UCS VIC 15420 4x25G mLOM for Cisco UCS X210c-M6 Compute Node | ucs-vic-15000-series-ds.html
    4 facts /   1 parts  UCS-HD <- hyperflex-hx-series  fields: humidity_operating 1, humidity_storage 1, certifications 1, emc_emissions 1
        e.g. UCS-HD8T7KL4KN [servers-unified-computing] 8 TB 12G SAS 7.2K RPM LFF HDD (4K) | hx240c-m5-specsheet.pdf
        e.g. UCS-HD8T7KL4KN [servers-unified-computing] 8 TB 12G SAS 7.2K RPM LFF HDD (4K) | hx240c-m5-specsheet.pdf
    4 facts /   1 parts  -ML- <- compute-hyperconverged  fields: altitude_max 1, temp_operating 1, altitude_storage 1, certifications 1
        e.g. UCS-ML-128G4RW [servers-unified-computing] Cisco UCS-ML-128G4RW | 5108b200m5m6-compute-specsheet.pdf
        e.g. UCS-ML-128G4RW [servers-unified-computing] Cisco UCS-ML-128G4RW | 5108b200m5m6-compute-specsheet.pdf
    4 facts /   1 parts  -GPU- <- hyperconverged-infrastructure  fields: emc_immunity 1, emc_emissions 1, humidity_operating 1, humidity_storage 1
        e.g. HCI-GPU-L4 [hyperconverged-infrastructure] Cisco HCI-GPU-L4 | compute-hyperconverged-hci-c225m8-sff-specsheet.pdf
        e.g. HCI-GPU-L4 [hyperconverged-infrastructure] Cisco HCI-GPU-L4 | compute-hyperconverged-hci-c225m8-sff-specsheet.pdf
    4 facts /   2 parts  -PSU <- ucs-c-series-rack-servers  fields: emc_emissions 2, emc_immunity 2
        e.g. UCSXE-PSU-2400W [servers-unified-computing] Cisco UCSXE-PSU-2400W | ucs-xe9305-m8-chassis-spec-sheet.pdf
        e.g. UCSXE-PSU-2400W [servers-unified-computing] Cisco UCSXE-PSU-2400W | ucs-xe9305-m8-chassis-spec-sheet.pdf
    4 facts /   1 parts  HX-M2- <- hyperflex-hx-series  fields: humidity_operating 1, humidity_storage 1, certifications 1, emc_emissions 1
        e.g. HX-M2-HWRAID [hyperconverged-systems] Cisco Boot optimized M.2 Raid controller | hx240c-m5-specsheet.pdf
        e.g. HX-M2-HWRAID [hyperconverged-systems] Cisco Boot optimized M.2 Raid controller | hx240c-m5-specsheet.pdf
    4 facts /   1 parts  -RAIL <- rf-gateway-series  fields: supported_protocols 1, temp_storage 1, temp_operating 1, humidity_operating 1
        e.g. RFGW-1-RAIL24= [video] RFGW-1 24 INCH ANGLE BRACKET KIT | product_data_sheet0900aecd8066a0d4.html
        e.g. RFGW-1-RAIL24= [video] RFGW-1 24 INCH ANGLE BRACKET KIT | product_data_sheet0900aecd8066a0d4.html
    3 facts /   1 parts  -PSU <- nexus-9000-series-switches  fields: altitude_max 1, temp_operating 1, temp_storage 1
        e.g. UCSC-PSU-930WDC [switches] N9K 930W DC Power Supply, Forward airflow (port side intake) | datasheet-c78-735989.html
        e.g. UCSC-PSU-930WDC [switches] N9K 930W DC Power Supply, Forward airflow (port side intake) | datasheet-c78-736967.html
    2 facts /   2 parts  -RIS- <- ucs-x-series-modular-system  fields: altitude_storage 2
        e.g. UCSX-RIS-A-440P [servers-unified-computing] Riser A for 1x dual slot GPU per riser, 440P PCIe node ● Ris | ucs-x440p-pcle-node-ds.html
        e.g. UCSX-RIS-B-440P [servers-unified-computing] Riser B for 2x single slot GPUs per riser, 440P PCIe node ●  | ucs-x440p-pcle-node-ds.html
    2 facts /   2 parts  -PCIE- <- unified-computing-system-adapters  fields: ieee_standards 2
        e.g. UCSC-PCIE-C25Q-04 [servers-unified-computing] Cisco UCS VIC 1455 quad port 10/25G SFP28 PCIe for C220 M5/M | datasheet-c78-741130.html
        e.g. UCSC-PCIE-C100-04 [servers-unified-computing] Cisco UCS VIC 1495 dual port 40/100G QSFP28 PCIe for C220 M5 | datasheet-c78-741130.html
    1 facts /   1 parts  -ML- <- ucs-x-series-modular-system  fields: altitude_storage 1
        e.g. UCSX-ML-V5Q50G-D [servers-unified-computing] UCS VIC 15420 4x25G mLOM for Cisco UCS X210c-M7, X410c-M7, a | x210cm7-specsheet.pdf
    1 facts /   1 parts  -PSU <- webex-wireless-phone  fields: call_control 1
        e.g. CP-860-DCHR-PSU= [collaboration-endpoints] Cisco 860 Desktop Charger WW Power Supply | datasheet-c78-744461.html
```
