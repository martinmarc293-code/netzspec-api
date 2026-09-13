# merge candidates — live parts (retired_at IS NULL)

## conferencing -> collaboration-endpoints
by vendor/class: cisco/license=3658, cisco/hardware=69, cisco/software=13, cisco/non_product=9
hardware rows: 69; kind in conferencing -> kind the same SKU gets in collaboration-endpoints:
- server-component -> server-component: 40
    - CIT3-5108-PKG-HW | UCS 5108 Packaging for chassis with half width blades.
    - CIT3-B200-M4 | UCS B200 M4 w/o CPU, mem, drive bays, HDD, mezz
    - CIT3-B200-M4-CON | UCS B200 M4 w/o CPU, mem, drive bays, HDD, mezz
    - CIT3-B200-M5 | Cisco Meeting Server 2000 M5 Media Blade
- server -> server: 22
    - AIPOD-COLLAB | Cisco AI PODs for Collaboration (Hardware)
    - CMS-M-M8-K9 | Cisco CMS-M-M8-K9
    - CMS-S-M7-K9 | Cisco CMS-S-M7-K9
    - CTI-ATP-TMS-APL-K9 | ATP Demo -TMS Server Appliance Incl TMS and Scheduler-25 lic
- power-supply -> power-supply: 5
    - CIT3-PSU-2500ACDV | 2500W Platinum AC Hot Plug Power Supply - DV
    - CIT3-PSU1-1050W | Cisco UCS 1050W AC Power Supply for Rack Server
    - CIT3-PSU1-1200W | 1200W Titanium power supply for C-Series Servers
    - CIT3-PSU1-770W | 770W AC Hot-Plug Power Supply for 1U C-Series Rack Server
- unknown -> unknown: 1
    - C-CPM | Cisco C-CPM
- accessory -> accessory: 1
    - CIT3-FAN5 | Fan module for UCS 5108
part slug collisions between conferencing and collaboration-endpoints (same vendor): 0

## data-center-networking -> switches
by vendor/class: cisco/hardware=22, cisco/license=8, cisco/software=3
hardware rows: 22; kind in data-center-networking -> kind the same SKU gets in switches:
- switch -> switch: 9
    - HF6100-32D | Cisco Hyperfabric switch, 32x400Gbps QSFP-DD
    - HF6100-32D-D | Cisco 6000 Hyperfabric switch, 32x400Gbps QSFP-DD, configurable hardware only
    - HF6100-32D-S | Cisco 6000 Hyperfabric switch, 32x400Gbps QSFP-DD, fixed hardware only Port exha
    - HF6100-60L4D | Cisco Hyperfabric switch 60x50G SFP28 4x400G QSFP-DD
- mechanical -> mechanical: 5
    - 8K-2RU-KIT-SB | 19" rackmount 4-post kit
    - HF-ACC-RM2-4P19L | 19" rackmount 4-post kit
    - N9K-ACC-KIT-1RU-L | 19" rackmount 4-post kit, long
    - N9K-ACC-KIT-1RU-S | 19" rackmount 4-post kit, short
- power -> power: 5
    - C9K-PWR-1500WAC | Catalyst 9500X 1500W AC Power Supply
    - C9K-PWR-1500WDC | Catalyst 9500X 1500W DC Power Supply
    - PSU1.4KW-ACPE | 1450 Watt AC power supply, port exhaust airflow
    - PSU1.4KW-ACPI | 1450 Watt AC power supply, port intake airflow
- fan -> fan: 3
    - C9500X-FAN-1U-F | Catalyst 9500X back to front cooling fan (maximum 6 per switch)
    - C9500X-FAN-1U-R | Catalyst 9500X front to back cooling fan (maximum 6 per switch)
    - FAN-PI-V4 | Cisco fan tray, port-side intake airflow
part slug collisions between data-center-networking and switches (same vendor): 0

## hyperconverged-systems -> servers-unified-computing
by vendor/class: cisco/hardware=1204, cisco/license=511, cisco/service=25, cisco/software=19, cisco/non_product=12, cisco/unknown=1
hardware rows: 1204; kind in hyperconverged-systems -> kind the same SKU gets in servers-unified-computing:
- cpu -> cpu: 340
    - HX-CPU-3106 | 1.7 GHz 3106/85W 8C/11MB Cache/DDR4 2133MHz
    - HX-CPU-4108 | 1.8 GHz 4108/85W 8C/11MB Cache/DDR4 2400MHz
    - HX-CPU-4110 | 2.1 GHz 4110/85W 8C/11MB Cache/DDR4 2400MHz
    - HX-CPU-4114 | 2.2 GHz 4114/85W 10C/13.75MB Cache/DDR4 2400MHz
- drive -> drive: 227
    - HX-ADGPU-240M6 | C240M6 GPU Air Duct 2USFF/NVMe (for DW/FL only)
    - HX-ADGPU-240M6= | C240M6 GPU Air Duct 2USFF/NVMe (for DW/FL only)
    - HX-B-NVMEXPB-I375= | Cisco 2.5in U.2 375 GB Intel P4800 NVMe Med. Perf
    - HX-DVD-C240M5 | Media Drive (DVD) for C240 M5 Servers (8 HDD version only)
- server -> server: 129
    - C240M5SD | Cisco C240M5SD
    - E10GSFPLR | Cisco E10GSFPLR
    - E10GSFPSR | Cisco E10GSFPSR
    - HX-B200-M5-U | Compute UCS B200 M5 Blade w/o CPU, mem, HDD, mezz (UPG)
- accessory -> accessory: 109
    - CAB-48DC-40A | Cisco CAB-48DC-40A
    - CAB-48DC-40A-AS= | Cisco CAB-48DC-40A-AS=
    - CAB-48DC-40A-INT= | Cisco CAB-48DC-40A-INT=
    - CAB-9K10A-KOR1= | Cisco CAB-9K10A-KOR1=
- unknown -> unknown: 80
    - 2xHDD | Cisco 2xHDD
    - 2xHDD/SSD | Cisco 2xHDD/SSD
    - 4.NVIDIA | Cisco 4.NVIDIA
    - 40GB | Cisco 40GB
- nic -> nic: 75
    - HX-B-VIC-M83-8P | Cisco UCS VIC 1380 mezzanine adapter for blade servers
    - HX-B-VIC-M83-8P= | Cisco UCS VIC 1380 mezzanine adapter for blade servers
    - HX-B-VIC-M84-4P | Cisco UCS VIC 1480 modular LOM for Blade Servers
    - HX-B-VIC-M84-4P= | Cisco UCS VIC 1480 modular LOM for Blade Servers
- memory -> memory: 73
    - HX-B-MLOM-40G-03 | Cisco UCS VIC 1340 modular LOM for blade servers
    - HX-B-MLOM-40G-03= | Cisco UCS VIC 1340 modular LOM for blade servers
    - HX-B-MLOM-40G-04 | Cisco UCS VIC 1440 modular LOM for Blade Servers
    - HX-B-MLOM-40G-04= | Cisco UCS VIC 1440 modular LOM for Blade Servers
- mechanical -> mechanical: 46
    - HX-BZL-EX-M5 | Optional bezel for UCS C480 M5 rack server
    - HX-BZL-EX-M5= | Optional bezel for UCS C480 M5 rack server
    - HX-CMA-4U-M5 | Cable Management Arm for UCS C480 M4
    - HX-CMA-4U-M5= | Cable Management Arm for UCS C480 M4
- gpu -> gpu: 30
    - GPU3 | Cisco GPU3
    - HX-GPU-A10 | TESLA A10, PASSIVE, 150W, 24GB
    - HX-GPU-A100-80 | TESLA A100, PASSIVE, 300W, 80GB
    - HX-GPU-A100-805 | Cisco HX-GPU-A100-805
- psu -> psu: 29
    - HX-PSU-M5BLK= | Cisco HX-PSU-M5BLK=
    - HX-PSU1-1050ELV | Cisco UCS 1050W AC Power Supply for Rack Server Low Line
    - HX-PSU1-1050ELV= | Cisco UCS 1050W AC Power Supply for Rack Server Low Line
    - HX-PSU1-1050W | Cisco UCS 1050W AC Power Supply for Rack Server Platinum
- storage-controller -> storage-controller: 26
    - HX-9400-8E | Cisco 12G 9400-8e 12G SAS HBA for external JBOD attach
    - HX-9400-8E= | Cisco 12G 9400-8e 12G SAS HBA for external JBOD attach
    - HX-B-RAID12G-M6 | Cisco M6 FlexStorage 12G SAS RAID Controller
    - HX-B-RAID12G-M6= | Cisco M6 FlexStorage 12G SAS RAID Controller
- bundle -> bundle: 16
    - HX-SP-NVME-6X1TB | HX NVMe Pak w/1x375GB Optane, 1x1TB NVMe, 6x1TB NVMe
    - HX-SP-NVME-6X8TB | HX NVMe Pak w/1x375GB Optane, 1x1TB NVMe, 6x8TB NVMe
    - HX-STD-01A | HX Standard w/1x480GB SAS, 1x240GB SATA, 6x1.2TB SAS
    - HX-STD-02A | HX Standard w/1x480GB SATA, 1x240GB SATA, 6x1.8TB SAS
- io-module -> io-module: 10
    - HX-RIS-1-240M5 | Riser 1 3PCIe slots (x8, x16, x8); slot 3 req CPU2, For T4
    - HX-RIS-1-240M5= | Riser 1 3PCIe slots (x8, x16, x8); slot 3 req CPU2, For T4
    - HX-RIS-1B-240M5 | Riser 1B 3PCIe slots (x8, x8, x8); all from CPU1, For T4
    - HX-RIS-1B-240M5= | Riser 1B 3PCIe slots (x8, x8, x8); all from CPU1, For T4
- tpm -> tpm: 10
    - HX-TPM-002C | TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M6 servers
    - HX-TPM-002C= | TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M6 servers
    - HX-TPM2-001 | Trusted Platform Module 1.2 for UCS (SPI-based)
    - HX-TPM2-001= | Trusted Platform Module 1.2 for UCS (SPI-based)
- fabric-interconnect -> fabric-interconnect: 4
    - HX-FI-6332 | UCS 6332 1RU Fabric Interconnect/No PSU/32 QSFP+ports/8p Lic
    - HX-FI-6332-BR | UCS 6332 IRU Fabric Interconnect/No PSU/32 QSFP+ports/8p Lic
    - HX-FI-64108 | UCS Fabric Interconnect 64108
    - HX-FI-6454-BR | UCS Fabric Interconnect 6454
part slug collisions between hyperconverged-systems and servers-unified-computing (same vendor): 0

## hyperconverged-infrastructure -> servers-unified-computing
by vendor/class: cisco/hardware=786, cisco/license=207, cisco/non_product=4, cisco/service=4, cisco/unknown=3
hardware rows: 786; kind in hyperconverged-infrastructure -> kind the same SKU gets in servers-unified-computing:
- drive -> drive: 245
    - HCI-ADGPU-240M6 | C240M6 GPU Air Duct 2USFF/NVMe (for DW/FL only)
    - HCI-ADGPU-240M6= | C240M6 GPU Air Duct 2USFF/NVMe (for DW/FL only)
    - HCI-HDL16TT2S74K | Cisco HCI-HDL16TT2S74K
    - HCI-HDL20TT1S74K | Cisco HCI-HDL20TT1S74K
- cpu -> cpu: 168
    - HCI-CPU-A9015 | Cisco HCI-CPU-A9015
    - HCI-CPU-A9115 | Cisco HCI-CPU-A9115
    - HCI-CPU-A9365 | Cisco HCI-CPU-A9365
    - HCI-CPU-A95552 | Cisco HCI-CPU-A95552
- server -> server: 67
    - C220/C240/B200 | Cisco C220/C240/B200
    - HCI-M6-MLB | Cisco Compute Hyperconverged M6 with Nutanix MLB
    - HCI-M7-MLB | Cisco Compute Hyperconverged and Compute-Only M7 with Nutanix MLB
    - HCI-M8-NTNX-MLB | Cisco Compute Hyperconverged and Compute-Only Node C-Series M8 with Nutanix MLB
- nic -> nic: 65
    - HCI-M-V100-04 | Cisco UCS VIC 1477 dual port 40/100G QSFP28 mLOM
    - HCI-M-V100-04= | Cisco UCS VIC 1477 dual port 40/100G QSFP28 mLOM
    - HCI-M-V25-04 | Cisco UCS VIC 1467 quad port 10/25G SFP28 mLOM
    - HCI-M-V25-04= | Cisco UCS VIC 1467 quad port 25G SFP28 mLOM
- accessory -> accessory: 61
    - CAB-48DC-40A-AS | Cisco CAB-48DC-40A-AS
    - CAB-48DC-40A-ASD | Cisco CAB-48DC-40A-ASD
    - CAB-48DC-40A-INT | Cisco CAB-48DC-40A-INT
    - CAB-48DC40A-INT | Cisco CAB-48DC40A-INT
- unknown -> unknown: 58
    - 1.256GB | Cisco 1.256GB
    - 1.DDR4-3200MHz | Cisco 1.DDR4-3200MHz
    - 10/25/50G | Cisco 10/25/50G
    - 10/25G | Cisco 10/25G
- memory -> memory: 42
    - HCI-ML-128G4RW | Cisco HCI-ML-128G4RW
    - HCI-ML-256G8RW1 | Cisco HCI-ML-256G8RW1
    - HCI-MLOM | Cisco HCI-MLOM
    - HCI-MLOM-M6 | Cisco VIC Connectivity
- gpu -> gpu: 29
    - HCI-GPU-A10-M6 | TESLA A10, PASSIVE, 150W, 24GB
    - HCI-GPU-A10-M6= | TESLA A10, PASSIVE, 150W, 24GB
    - HCI-GPU-A100-80-M6 | Cisco HCI-GPU-A100-80-M6
    - HCI-GPU-A100-80M6 | TESLA A100, PASSIVE, 300W, 80GB
- psu -> psu: 18
    - HCI-PSU-6332-ACM6 | UCS 6332/ 6454 Power Supply/100-240VAC
    - HCI-PSU-6332-DCM6 | UCS 6332/ 6454/ 64108 Power Supply/-48VDC
    - HCI-PSU-64108ACM6 | UCS 64108 Power Supply/100-240VAC
    - HCI-PSU-6536-ACM6 | UCS 6536 Power Supply/AC 1100W PSU - Port Side Exhaust
- mechanical -> mechanical: 8
    - HCI-BZL-C220-M6 | C220 M6 Security Bezel
    - HCI-BZL-C220-M6= | C220 M6 Security Bezel
    - HCI-BZL-C240-M6 | C240 M6 Security Bezel
    - HCI-BZL-C240-M6= | C240 M6 Security Bezel
- fabric-interconnect -> fabric-interconnect: 7
    - HCI-FI-64108-M6 | Cisco Compute Hyperconverged Fabric Interconnect 64108
    - HCI-FI-6454-M6 | Cisco Compute Hyperconverged Fabric Interconnect 6454
    - HCI-FI-6536-M6 | Cisco Compute Hyperconverged Fabric Interconnect 6536
    - HCI-FI-MANAGED | Cisco HCI-FI-MANAGED
- storage-controller -> storage-controller: 6
    - HCI-HBAMP1LL32 | Cisco HCI-HBAMP1LL32
    - HCI-SAS-220M6 | Cisco 12G SAS HBA for (16 drives) w/1U Brkt
    - HCI-SAS-240M6 | Cisco 12G SAS HBA for(16 Drives) w/2U Brkt
    - HCI-SAS-240M61 | Cisco HCI-SAS-240M61
- tpm -> tpm: 5
    - HCI-TPM-002C-M6 | TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M6 servers
    - HCI-TPM-002C-M6= | TPM 2.0, TCG, FIPS140-2, CC EAL4+ Certified, for M6 servers
    - HCI-TPM-002D-M6 | TPM 2.0 TCG FIPS140-2 CC+ Cert M6 Intel MSW2022 Compliant
    - HCI-TPM-002D-M6= | TPM 2.0 TCG FIPS140-2 CC+ Cert M6 Intel MSW2022 Compliant
- io-module -> io-module: 4
    - HCIX-I9108-100G | Cisco HCIX-I9108-100G
    - HCIX-I9108-25G | Cisco HCIX-I9108-25G
    - UCSX-I9108-100G | Cisco UCSX-I9108-100G
    - UCSX-I9108-25G | Cisco UCSX-I9108-25G
- chassis -> chassis: 3
    - HCIX-9508-CH | DISTI: Cisco UCS X9508 Chassis
    - HCIX-9508-U | Cisco Compute Hyperconverged X9508 Server Chassis configured
    - HCIXENX-9305-U | Cisco HCI XE9305 3RU Nutanix Chassis (includes fans)
part slug collisions between hyperconverged-infrastructure and servers-unified-computing (same vendor): 0

## categories rows
- switches | Switches | Switches | hw=true | order=1
- servers-unified-computing | Servers & UCS | Server & UCS | hw=true | order=9
- hyperconverged-systems | Hyperconverged | Hyperconverged | hw=true | order=10
- hyperconverged-infrastructure | Hyperconverged infrastructure | Hyperconverged-Infrastruktur | hw=true | order=11
- data-center-networking | Data-center networking | Data-Center-Networking | hw=true | order=12
- collaboration-endpoints | Collaboration endpoints | Collaboration-Endpoints | hw=true | order=15
- conferencing | Conferencing | Conferencing | hw=true | order=16

## category_profiles rows
- collaboration-endpoints: 400
- conferencing: 400
- data-center-networking: 429
- hyperconverged-infrastructure: 188
- hyperconverged-systems: 184
- servers-unified-computing: 408
- switches: 445