// Neutral, factual category overviews (industry knowledge — no fabricated specs/prices).
// Purpose: uncovered category hubs read like a real buyer's reference, not an "expanding
// coverage" placeholder. Rendered on the total===0 branch; covered categories already
// carry parts tables. Uncovered hubs stay noindex. Scoped to the core networking
// categories aligned with hexwaren's business; servers/storage/accessories intentionally
// omitted pending a scope decision (see docs/DECISIONS.md).

export type CategorySubtype = { name: string; en: string; de: string };
export type CategoryProfile = {
  intro: { en: string; de: string };
  subtypes: CategorySubtype[];
  vendors: string[]; // vendor slugs strong in this category (link to their hubs)
};

export const CATEGORY_PROFILES: Record<string, CategoryProfile> = {
  routers: {
    intro: {
      en: "Enterprise routers move traffic between networks and out to the WAN and internet. Selection turns on forwarding throughput, interface types (copper, fibre, cellular), routing scale (BGP/OSPF table sizes) and services such as SD-WAN, IPsec VPN and QoS.",
      de: "Enterprise-Router leiten Datenverkehr zwischen Netzen und ins WAN sowie Internet. Ausschlaggebend sind Forwarding-Durchsatz, Schnittstellen (Kupfer, Glasfaser, Mobilfunk), Routing-Skalierung (BGP-/OSPF-Tabellengrößen) sowie Dienste wie SD-WAN, IPsec-VPN und QoS.",
    },
    subtypes: [
      { name: "Branch / edge", en: "Small-site routers with WAN, VPN and often integrated switching or Wi-Fi.", de: "Router für kleine Standorte mit WAN, VPN und oft integriertem Switching oder WLAN." },
      { name: "Aggregation", en: "Regional routers concentrating many branch links.", de: "Regionale Router, die viele Branch-Verbindungen bündeln." },
      { name: "Core / service-provider", en: "High-capacity routers for the network core and carriers.", de: "Hochkapazitäts-Router für Netzwerk-Core und Carrier." },
      { name: "SD-WAN", en: "Software-defined WAN edge with cloud orchestration.", de: "Software-defined-WAN-Edge mit Cloud-Orchestrierung." },
    ],
    vendors: ["cisco", "juniper", "huawei"],
  },
  firewalls: {
    intro: {
      en: "Next-generation firewalls (NGFW) enforce security policy at the network edge and between segments. Key criteria are threat-inspection throughput with IPS and TLS decryption enabled, concurrent sessions, interface density and the management and licensing model.",
      de: "Next-Generation-Firewalls (NGFW) setzen Sicherheitsrichtlinien am Netzwerkrand und zwischen Segmenten durch. Entscheidend sind der Threat-Inspection-Durchsatz mit aktivem IPS und TLS-Entschlüsselung, gleichzeitige Sessions, Schnittstellendichte sowie das Management- und Lizenzmodell.",
    },
    subtypes: [
      { name: "Entry / branch NGFW", en: "Desktop or 1U firewalls for small sites.", de: "Desktop- oder 1U-Firewalls für kleine Standorte." },
      { name: "Campus NGFW", en: "Mid-range appliances for building and campus edge.", de: "Mid-Range-Appliances für Gebäude- und Campus-Edge." },
      { name: "Data-center NGFW", en: "High-throughput appliances for DC and internet edge.", de: "Durchsatzstarke Appliances für RZ- und Internet-Edge." },
      { name: "Virtual / cloud", en: "VM and cloud-native firewall instances.", de: "VM- und Cloud-native-Firewall-Instanzen." },
    ],
    vendors: ["fortinet", "palo-alto", "cisco", "juniper", "check-point"],
  },
  wireless: {
    intro: {
      en: "Enterprise wireless covers access points and controllers for campus and high-density venues. Compare the Wi-Fi generation (6 / 6E / 7), spatial streams, radio count, PoE draw and whether management is cloud, on-prem or controllerless.",
      de: "Enterprise-WLAN umfasst Access Points und Controller für Campus und High-Density-Umgebungen. Zu vergleichen sind WLAN-Generation (6 / 6E / 7), Spatial Streams, Anzahl der Funkmodule, PoE-Bedarf sowie Cloud-, On-Prem- oder Controller-loses Management.",
    },
    subtypes: [
      { name: "Indoor APs", en: "Ceiling and wall access points for offices and classrooms.", de: "Decken- und Wand-Access-Points für Büros und Klassenräume." },
      { name: "Outdoor / industrial", en: "Ruggedised access points for outdoor and harsh sites.", de: "Robuste Access Points für Außen- und raue Umgebungen." },
      { name: "Controllers", en: "On-prem WLAN controllers for large estates.", de: "On-Prem-WLAN-Controller für große Umgebungen." },
      { name: "Cloud-managed", en: "Controllerless, cloud-managed Wi-Fi.", de: "Controller-loses, cloud-verwaltetes WLAN." },
    ],
    vendors: ["aruba", "cisco", "ruckus", "ubiquiti", "extreme"],
  },
};

export function categoryProfile(slug: string): CategoryProfile | null {
  return CATEGORY_PROFILES[slug] ?? null;
}
