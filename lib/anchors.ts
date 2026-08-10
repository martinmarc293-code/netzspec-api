import type { Locale, Part } from "./types";
import { SITE } from "./site";

// Anchor text is a ranking signal. We use KEYWORD-RICH, high-volume German anchors
// for the hexwaren.de buy-links — but VARIED per page (deterministic by SKU) so the
// backlink profile stays natural, not exact-match spam. English pages get a soft
// brand anchor only (English anchors don't help a German site rank German terms).
export function buyAnchor(part: Part, locale: Locale): string {
  const vinfo = SITE.vendors.find((v) => v.slug === part.vendor);
  const brand = vinfo?.name.split(" ")[0] || part.vendor.charAt(0).toUpperCase() + part.vendor.slice(1);

  if (locale === "en") return `genuine & new at Hexwaren`;

  const isSwitch = part.type === "switch";
  const variants = isSwitch
    ? [`Original ${brand} Switch kaufen`, `${brand} Switch original & neu`, `originale ${brand} Netzwerkhardware`, `${brand} Switch fabrikneu kaufen`]
    : [`Original ${brand} Transceiver kaufen`, `${brand} SFP-Modul original kaufen`, `originale ${brand} Optik kaufen`, `${brand} Transceiver fabrikneu`];
  const idx = [...part.sku].reduce((a, c) => a + c.charCodeAt(0), 0) % variants.length;
  return variants[idx];
}
