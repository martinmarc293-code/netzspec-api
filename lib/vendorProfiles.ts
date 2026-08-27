// Neutral, factual vendor overviews (family-level, public knowledge — NO fabricated specs).
// Purpose: every brand hub reads like a real reference page, not an empty placeholder —
// even before part data lands. Uncovered hubs stay noindex; this is for humans + credibility.
// Keep additions factual and hedged; when unsure about a vendor, add no entry (the hub falls
// back to the plain coverage card).

export type VendorFamily = { name: string; en: string; de: string };
export type VendorProfile = {
  homepage: string;
  intro: { en: string; de: string };
  families: VendorFamily[];
};

export const VENDOR_PROFILES: Record<string, VendorProfile> = {
  cisco: {
    homepage: "https://www.cisco.com",
    intro: {
      en: "Cisco Systems is the market-leading enterprise networking vendor. Its campus, data-center, routing and security portfolios run on IOS XE, NX-OS and related operating systems and underpin enterprise LAN/WAN deployments worldwide.",
      de: "Cisco Systems ist der Marktführer im Enterprise-Networking. Die Campus-, Rechenzentrums-, Routing- und Security-Produktlinien laufen unter IOS XE, NX-OS und verwandten Betriebssystemen und prägen Enterprise-LAN/WAN-Installationen weltweit.",
    },
    families: [
      { name: "Catalyst 9000", en: "Access, aggregation and core campus switches (9200 / 9300 / 9500).", de: "Access-, Aggregations- und Core-Campus-Switches (9200 / 9300 / 9500)." },
      { name: "Nexus", en: "Data-center switches running NX-OS.", de: "Rechenzentrums-Switches unter NX-OS." },
      { name: "Meraki", en: "Cloud-managed switches, access points and security.", de: "Cloud-verwaltete Switches, Access Points und Security." },
      { name: "ISR / ASR", en: "Branch, edge and aggregation routers.", de: "Branch-, Edge- und Aggregations-Router." },
      { name: "Transceivers", en: "SFP / SFP+ / QSFP optics for Catalyst and Nexus uplinks.", de: "SFP- / SFP+- / QSFP-Optiken für Catalyst- und Nexus-Uplinks." },
    ],
  },
  hpe: {
    homepage: "https://www.hpe.com",
    intro: {
      en: "Hewlett Packard Enterprise delivers enterprise networking largely through its Aruba Networking division, alongside the legacy HPE FlexNetwork / FlexFabric campus and data-center switching lines.",
      de: "Hewlett Packard Enterprise bietet Enterprise-Networking überwiegend über die Sparte Aruba Networking, ergänzt um die HPE-FlexNetwork- / FlexFabric-Switching-Familien für Campus und Rechenzentrum.",
    },
    families: [
      { name: "Aruba CX", en: "Modern campus & data-center switches (AOS-CX).", de: "Moderne Campus- & Rechenzentrums-Switches (AOS-CX)." },
      { name: "FlexNetwork / FlexFabric", en: "Comware-based campus and DC switches.", de: "Comware-basierte Campus- und RZ-Switches." },
      { name: "OfficeConnect", en: "Smart-managed switching for smaller sites.", de: "Smart-Managed-Switching für kleinere Standorte." },
      { name: "Transceivers", en: "J-code SFP / SFP+ / QSFP optics.", de: "SFP- / SFP+- / QSFP-Optiken mit J-Kennung." },
    ],
  },
  aruba: {
    homepage: "https://www.arubanetworks.com",
    intro: {
      en: "Aruba, a Hewlett Packard Enterprise company, focuses on secure, cloud-managed campus and edge networking — switching, wireless and network access control.",
      de: "Aruba, ein Unternehmen von Hewlett Packard Enterprise, konzentriert sich auf sicheres, cloud-verwaltetes Campus- und Edge-Networking — Switching, WLAN und Network Access Control.",
    },
    families: [
      { name: "CX Switching", en: "6000 / 8000 / 9000 / 10000 campus & DC switches.", de: "6000 / 8000 / 9000 / 10000 Campus- & RZ-Switches." },
      { name: "Instant On", en: "Cloud/app-managed switching and Wi-Fi for SMB.", de: "Cloud-/App-verwaltetes Switching und WLAN für KMU." },
      { name: "Access Points", en: "Wi-Fi 6 / 6E / 7 indoor and outdoor APs.", de: "Wi-Fi-6- / -6E- / -7-Access-Points für innen und außen." },
      { name: "ClearPass", en: "Network access control and policy.", de: "Network Access Control und Policy." },
      { name: "Transceivers", en: "1G / 10G / 25G SFP optics for CX ports.", de: "1G- / 10G- / 25G-SFP-Optiken für CX-Ports." },
    ],
  },
  juniper: {
    homepage: "https://www.juniper.net",
    intro: {
      en: "Juniper Networks builds high-performance routing, data-center and campus switching, and security on the Junos operating system, with Mist AI driving wired/wireless operations.",
      de: "Juniper Networks entwickelt leistungsstarkes Routing, Rechenzentrums- und Campus-Switching sowie Security auf Basis von Junos — der KI-gestützte Betrieb Mist steuert LAN und WLAN.",
    },
    families: [
      { name: "EX Series", en: "Campus access and aggregation switches.", de: "Campus-Access- und Aggregations-Switches." },
      { name: "QFX Series", en: "Data-center leaf/spine switches.", de: "Rechenzentrums-Leaf-/Spine-Switches." },
      { name: "MX Series", en: "Edge and service-provider routers.", de: "Edge- und Service-Provider-Router." },
      { name: "SRX Series", en: "Next-generation firewalls.", de: "Next-Generation-Firewalls." },
      { name: "Mist", en: "AI-driven wired and wireless operations.", de: "KI-gestützter LAN- und WLAN-Betrieb." },
    ],
  },
  arista: {
    homepage: "https://www.arista.com",
    intro: {
      en: "Arista Networks specialises in high-throughput data-center and AI/cloud Ethernet switching, running the programmable EOS network operating system with CloudVision management.",
      de: "Arista Networks ist spezialisiert auf durchsatzstarke Rechenzentrums- und AI/Cloud-Ethernet-Switches — unter dem programmierbaren Netzwerk-Betriebssystem EOS mit CloudVision-Management.",
    },
    families: [
      { name: "7000 Series", en: "Fixed leaf/ToR data-center switches.", de: "Feste Leaf-/ToR-Rechenzentrums-Switches." },
      { name: "7500 / 7800", en: "Modular spine and AI-fabric switches.", de: "Modulare Spine- und AI-Fabric-Switches." },
      { name: "720 / 750", en: "Cognitive campus switches.", de: "Cognitive-Campus-Switches." },
      { name: "CloudVision", en: "Network-wide management and telemetry.", de: "Netzwerkweites Management und Telemetrie." },
      { name: "Transceivers", en: "10 / 25 / 40 / 100 / 400G optics.", de: "10- / 25- / 40- / 100- / 400G-Optiken." },
    ],
  },
  fortinet: {
    homepage: "https://www.fortinet.com",
    intro: {
      en: "Fortinet is a network-security vendor best known for FortiGate next-generation firewalls, extended by a Security Fabric of switching, wireless and access products.",
      de: "Fortinet ist ein Netzwerk-Security-Anbieter, bekannt vor allem für die FortiGate Next-Generation-Firewalls, ergänzt um die Security Fabric aus Switching-, WLAN- und Access-Produkten.",
    },
    families: [
      { name: "FortiGate", en: "Next-generation firewalls (entry to data-center).", de: "Next-Generation-Firewalls (Einstieg bis Rechenzentrum)." },
      { name: "FortiSwitch", en: "Managed switches integrated with FortiGate.", de: "Managed Switches, integriert mit FortiGate." },
      { name: "FortiAP", en: "Secure wireless access points.", de: "Sichere WLAN-Access-Points." },
      { name: "FortiManager / Analyzer", en: "Central management and logging.", de: "Zentrales Management und Logging." },
    ],
  },
  extreme: {
    homepage: "https://www.extremenetworks.com",
    intro: {
      en: "Extreme Networks provides cloud-driven campus and data-center networking; its switching portfolio incorporates technology from the Brocade, Avaya and Aerohive acquisitions.",
      de: "Extreme Networks bietet cloud-gesteuertes Campus- und Rechenzentrums-Networking; das Switching-Portfolio integriert Technologie aus den Übernahmen von Brocade, Avaya und Aerohive.",
    },
    families: [
      { name: "ExtremeSwitching", en: "Universal campus and data-center switches.", de: "Universelle Campus- und Rechenzentrums-Switches." },
      { name: "ExtremeCloud IQ", en: "Cloud management and analytics.", de: "Cloud-Management und Analytics." },
      { name: "ExtremeWireless", en: "Enterprise Wi-Fi access points.", de: "Enterprise-WLAN-Access-Points." },
    ],
  },
  ruckus: {
    homepage: "https://www.ruckusnetworks.com",
    intro: {
      en: "RUCKUS Networks, part of CommScope, builds campus and enterprise wired/wireless access — ICX switches and high-density Wi-Fi.",
      de: "RUCKUS Networks, Teil von CommScope, entwickelt Campus- und Enterprise-Access für LAN und WLAN — ICX-Switches und High-Density-WLAN.",
    },
    families: [
      { name: "ICX Switching", en: "Stackable campus access and aggregation switches.", de: "Stapelbare Campus-Access- und Aggregations-Switches." },
      { name: "Access Points", en: "High-density Wi-Fi 6 / 6E / 7.", de: "High-Density-WLAN Wi-Fi 6 / 6E / 7." },
      { name: "RUCKUS One / SmartZone", en: "Cloud and on-prem management.", de: "Cloud- und On-Prem-Management." },
    ],
  },
  ubiquiti: {
    homepage: "https://www.ui.com",
    intro: {
      en: "Ubiquiti offers cost-effective, self-managed networking under the UniFi platform — switches, access points, gateways and cameras with a single controller.",
      de: "Ubiquiti bietet kostengünstiges, selbst verwaltetes Networking unter der UniFi-Plattform — Switches, Access Points, Gateways und Kameras mit einem einheitlichen Controller.",
    },
    families: [
      { name: "UniFi Switching", en: "Managed PoE and aggregation switches.", de: "Managed-PoE- und Aggregations-Switches." },
      { name: "UniFi Access Points", en: "Wi-Fi 6 / 7 indoor and outdoor.", de: "Wi-Fi 6 / 7 für innen und außen." },
      { name: "UniFi Gateways", en: "Routing, firewall and Dream Machine.", de: "Routing, Firewall und Dream Machine." },
      { name: "EdgeMax", en: "EdgeRouter and EdgeSwitch line.", de: "EdgeRouter- und EdgeSwitch-Serie." },
    ],
  },
  "dell-emc": {
    homepage: "https://www.dell.com/networking",
    intro: {
      en: "Dell Technologies (Dell EMC) builds open, disaggregated data-center networking — PowerSwitch hardware running SmartFabric OS10, evolved from the Force10 portfolio.",
      de: "Dell Technologies (Dell EMC) baut offenes, disaggregiertes Rechenzentrums-Networking — PowerSwitch-Hardware unter SmartFabric OS10, hervorgegangen aus dem Force10-Portfolio.",
    },
    families: [
      { name: "PowerSwitch S-Series", en: "Top-of-rack / leaf data-center switches.", de: "Top-of-Rack-/Leaf-Rechenzentrums-Switches." },
      { name: "PowerSwitch Z-Series", en: "Spine / core data-center switches.", de: "Spine-/Core-Rechenzentrums-Switches." },
      { name: "SmartFabric OS10", en: "Open, Linux-based network OS.", de: "Offenes, Linux-basiertes Netzwerk-OS." },
      { name: "Transceivers", en: "10 / 25 / 100G optics for PowerSwitch.", de: "10- / 25- / 100G-Optiken für PowerSwitch." },
    ],
  },
  huawei: {
    homepage: "https://e.huawei.com",
    intro: {
      en: "Huawei provides carrier and enterprise networking at scale — CloudEngine data-center switches, S-series campus switches and NetEngine routers.",
      de: "Huawei bietet Carrier- und Enterprise-Networking in großem Maßstab — CloudEngine-Rechenzentrums-Switches, S-Serie-Campus-Switches und NetEngine-Router.",
    },
    families: [
      { name: "CloudEngine", en: "Data-center spine/leaf switches.", de: "Rechenzentrums-Spine-/Leaf-Switches." },
      { name: "S-Series", en: "Campus access and aggregation switches.", de: "Campus-Access- und Aggregations-Switches." },
      { name: "NetEngine", en: "Enterprise and carrier routers.", de: "Enterprise- und Carrier-Router." },
      { name: "Transceivers", en: "SFP / SFP+ / QSFP optics.", de: "SFP- / SFP+- / QSFP-Optiken." },
    ],
  },
  nvidia: {
    homepage: "https://www.nvidia.com/networking",
    intro: {
      en: "NVIDIA Networking (formerly Mellanox) supplies high-speed Ethernet and InfiniBand for AI and HPC — Spectrum Ethernet switches, ConnectX adapters and Quantum InfiniBand.",
      de: "NVIDIA Networking (ehemals Mellanox) liefert Highspeed-Ethernet und InfiniBand für AI und HPC — Spectrum-Ethernet-Switches, ConnectX-Adapter und Quantum-InfiniBand.",
    },
    families: [
      { name: "Spectrum", en: "Ethernet switches for AI/cloud fabrics.", de: "Ethernet-Switches für AI-/Cloud-Fabrics." },
      { name: "Quantum", en: "InfiniBand switches for HPC.", de: "InfiniBand-Switches für HPC." },
      { name: "ConnectX", en: "SmartNIC network adapters.", de: "ConnectX-SmartNIC-Netzwerkadapter." },
      { name: "BlueField", en: "Data processing units (DPUs).", de: "Data Processing Units (DPUs)." },
    ],
  },
  mellanox: {
    homepage: "https://www.nvidia.com/networking",
    intro: {
      en: "Mellanox Technologies, now part of NVIDIA, pioneered high-speed InfiniBand and Ethernet interconnect. Its Spectrum switches and ConnectX adapters continue under NVIDIA Networking.",
      de: "Mellanox Technologies, heute Teil von NVIDIA, war Pionier für Highspeed-InfiniBand und -Ethernet. Die Spectrum-Switches und ConnectX-Adapter werden unter NVIDIA Networking fortgeführt.",
    },
    families: [
      { name: "Spectrum", en: "Ethernet switch silicon and systems.", de: "Ethernet-Switch-Silizium und -Systeme." },
      { name: "ConnectX", en: "High-speed network adapters.", de: "Highspeed-Netzwerkadapter." },
      { name: "InfiniBand", en: "Low-latency HPC interconnect switches.", de: "Latenzarme HPC-Interconnect-Switches." },
      { name: "LinkX", en: "Cables and transceivers.", de: "Kabel und Transceiver." },
    ],
  },
  "palo-alto": {
    homepage: "https://www.paloaltonetworks.com",
    intro: {
      en: "Palo Alto Networks is a cybersecurity vendor whose PA-Series next-generation firewalls and Panorama management anchor enterprise network security.",
      de: "Palo Alto Networks ist ein Cybersecurity-Anbieter; die PA-Serie Next-Generation-Firewalls und das Management Panorama bilden das Rückgrat der Enterprise-Netzwerksicherheit.",
    },
    families: [
      { name: "PA-Series", en: "Next-generation firewall appliances.", de: "Next-Generation-Firewall-Appliances." },
      { name: "Panorama", en: "Central firewall management.", de: "Zentrales Firewall-Management." },
      { name: "Transceivers", en: "Optics for PA-Series data ports.", de: "Optiken für PA-Serie-Datenports." },
    ],
  },
};

export function vendorProfile(slug: string): VendorProfile | null {
  return VENDOR_PROFILES[slug] ?? null;
}
