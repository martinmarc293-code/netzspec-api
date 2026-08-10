import type { Locale } from "./types";

export const SITE = {
  name: "NetSpec",
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
  categories: [
    { slug: "switches", en: "Switches", de: "Switches" },
    { slug: "transceiver", en: "Transceivers", de: "Transceiver" },
  ],
};

export const localePath = (locale: Locale, path = "") => `/${locale}${path.startsWith("/") ? path : path ? "/" + path : ""}`;

/** Absolute canonical + hreflang alternates for a path (path WITHOUT locale prefix, e.g. "/cisco/glc-te"). */
export function alternatesFor(path: string) {
  const clean = path === "/" ? "" : path;
  const languages: Record<string, string> = {};
  for (const l of SITE.locales) languages[l] = `${SITE.url}/${l}${clean}`;
  languages["x-default"] = `${SITE.url}/${SITE.defaultLocale}${clean}`;
  return languages;
}
