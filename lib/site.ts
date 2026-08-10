import type { Locale } from "./types";

export const SITE = {
  name: "Netzspec",
  domain: "netzspec.com",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://netzspec.com",
  // the money site (used ONLY for editorial buy-links, never in schema)
  hexwaren: "https://www.hexwaren.de",
  operator: "Hexwaren GmbH", // legal Impressum operator
  locales: ["en", "de"] as Locale[],
  defaultLocale: "en" as Locale,
  // Full multi-vendor reference list (breadth = neutral-tool authority).
  // `sells` = Hexwaren carries it → the buy-funnel CTA may appear; others stay pure reference.
  vendors: [
    { slug: "cisco", name: "Cisco", sells: true },
    { slug: "hpe", name: "HPE", sells: true },
    { slug: "aruba", name: "Aruba", sells: true },
    { slug: "juniper", name: "Juniper", sells: true },
    { slug: "arista", name: "Arista", sells: true },
    { slug: "fortinet", name: "Fortinet", sells: true },
    { slug: "extreme", name: "Extreme Networks", sells: true },
    { slug: "ruckus", name: "Ruckus", sells: true },
    { slug: "ubiquiti", name: "Ubiquiti", sells: true },
    { slug: "dell-emc", name: "Dell EMC", sells: true },
    { slug: "huawei", name: "Huawei", sells: false },
    { slug: "nvidia", name: "NVIDIA", sells: false },
    { slug: "mellanox", name: "Mellanox", sells: false },
    { slug: "palo-alto", name: "Palo Alto", sells: false },
    { slug: "h3c", name: "H3C", sells: false },
    { slug: "lenovo", name: "Lenovo", sells: false },
    { slug: "zte", name: "ZTE", sells: false },
    { slug: "supermicro", name: "Supermicro", sells: false },
    { slug: "ruijie", name: "Ruijie", sells: false },
    { slug: "check-point", name: "Check Point", sells: false },
    { slug: "hillstone", name: "Hillstone", sells: false },
    { slug: "alibaba-cloud", name: "Alibaba Cloud", sells: false },
    { slug: "topsec", name: "Topsec", sells: false },
    { slug: "moresec", name: "MoreSec", sells: false },
  ] as { slug: string; name: string; sells: boolean }[],
  // Product-type axis (the itprice pattern). `covered` = we have verified parts today →
  // indexable hub; the rest render as "coverage expanding" (noindex) so the taxonomy is
  // visible without shipping thin pages.
  categories: [
    { slug: "switches", en: "Switches", de: "Switches", covered: true,
      taglineEn: "Managed, stackable & modular", taglineDe: "Managed, stackable & modular",
      blurbEn: "Enterprise access, aggregation and core switches — port specs, list-price context, EOL status and the transceivers that fit each uplink.",
      blurbDe: "Enterprise Access-, Aggregation- und Core-Switches — Port-Specs, Listenpreis-Kontext, EOL-Status und die passenden Transceiver für jeden Uplink." },
    { slug: "transceiver", en: "Transceivers", de: "Transceiver", covered: true,
      taglineEn: "SFP · SFP+ · QSFP optics", taglineDe: "SFP · SFP+ · QSFP Optiken",
      blurbEn: "SFP, SFP+, QSFP and QSFP28 optics — reach, wavelength, connector and verified switch compatibility.",
      blurbDe: "SFP-, SFP+-, QSFP- und QSFP28-Optiken — Reichweite, Wellenlänge, Stecker und geprüfte Switch-Kompatibilität." },
    { slug: "routers", en: "Routers", de: "Router", covered: false,
      taglineEn: "Edge, branch & core", taglineDe: "Edge, Branch & Core",
      blurbEn: "Branch, edge and service-provider routers — throughput, interfaces and lifecycle.",
      blurbDe: "Branch-, Edge- und Service-Provider-Router — Durchsatz, Schnittstellen und Lifecycle." },
    { slug: "firewalls", en: "Firewalls", de: "Firewalls", covered: false,
      taglineEn: "NGFW & security", taglineDe: "NGFW & Security",
      blurbEn: "Next-generation firewalls and security appliances — throughput, sessions and licensing.",
      blurbDe: "Next-Generation-Firewalls und Security-Appliances — Durchsatz, Sessions und Lizenzierung." },
    { slug: "wireless", en: "Wireless", de: "Wireless", covered: false,
      taglineEn: "Access points & controllers", taglineDe: "Access Points & Controller",
      blurbEn: "Wi-Fi 6/6E/7 access points and controllers — radios, throughput and PoE draw.",
      blurbDe: "Wi-Fi 6/6E/7 Access Points und Controller — Funkmodule, Durchsatz und PoE-Bedarf." },
    { slug: "servers", en: "Servers", de: "Server", covered: false,
      taglineEn: "Rack & blade", taglineDe: "Rack & Blade",
      blurbEn: "Rack and blade servers — CPU, memory and drive-bay configuration.",
      blurbDe: "Rack- und Blade-Server — CPU, Speicher und Laufwerksschächte." },
    { slug: "storage", en: "Storage", de: "Storage", covered: false,
      taglineEn: "SAN, NAS & drives", taglineDe: "SAN, NAS & Laufwerke",
      blurbEn: "SAN, NAS and drive modules — capacity, interface and compatibility.",
      blurbDe: "SAN-, NAS- und Laufwerksmodule — Kapazität, Schnittstelle und Kompatibilität." },
    { slug: "accessories", en: "Cables & Accessories", de: "Kabel & Zubehör", covered: false,
      taglineEn: "DACs, power & mounts", taglineDe: "DACs, Strom & Montage",
      blurbEn: "Direct-attach cables, power supplies, fans and mounting accessories.",
      blurbDe: "Direct-Attach-Kabel, Netzteile, Lüfter und Montagezubehör." },
  ] as { slug: string; en: string; de: string; covered: boolean; taglineEn: string; taglineDe: string; blurbEn: string; blurbDe: string }[],
};

/** Category metadata by slug (undefined for unknown slugs). */
export const catBySlug = (slug: string) => SITE.categories.find((c) => c.slug === slug);

export const localePath = (locale: Locale, path = "") => `/${locale}${path.startsWith("/") ? path : path ? "/" + path : ""}`;

/** Absolute canonical + hreflang alternates for a path (path WITHOUT locale prefix, e.g. "/cisco/glc-te"). */
export function alternatesFor(path: string) {
  const clean = path === "/" ? "" : path;
  const languages: Record<string, string> = {};
  for (const l of SITE.locales) languages[l] = `${SITE.url}/${l}${clean}`;
  languages["x-default"] = `${SITE.url}/${SITE.defaultLocale}${clean}`;
  return languages;
}
