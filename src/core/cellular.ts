// src/core/cellular.ts — does this part carry a cellular radio?
//
// The gate `cellular_bands` needs. Asking every SMB router for its cellular bands would demand them of 1,288
// parts that mostly have none; asking none of them leaves the cup optional everywhere, which is what it was
// (opt on smb, branch, industrial-iot and sp-core alike) and is why the Z-series move had nothing to verify.
// The signal is in the SKU, and the reviewer ruled it a derived column-backed field so the profile can gate
// on it the way it gates on `modular` and `deploy_role`.
//
// NO `\b` ANYWHERE. Cisco's tokens are not word-shaped — `C1111-8PLTEEA` has no boundary before LTE and
// `C819G-4G-GA-K9` none after 4G — and this repo has already paid for `\b` on product strings twice. Every
// marker below is anchored on what it can and cannot sit next to, explicitly.
//
// THE GROUND TRUTH IS THE 62 PARTS THAT ALREADY HOLD A `cellular_bands` FACT. A rule for a derived gate can
// be scored, and this one is: `tests/cellular.test.ts` requires it to accept all 62 (a miss would leave a
// part with a stored cellular band and a gate saying it has no radio) and to refuse the controls.

/**
 * The markers, each with what it must NOT be adjacent to.
 *
 * `LTE`  matched ANYWHERE in the string, with no anchoring at all, because it has no other meaning in a
 *        Cisco SKU and every real case buries it mid-token: C1111-4PLTEEA, C1117-4PMLTEEAWE, EHWIC-4G-LTE-V.
 *        My first version required it not to be followed by a letter and MISSED SIX of the 62 parts that
 *        hold a cellular_bands fact — anchoring away from `` is right and anchoring for its own sake is not.
 *
 * `4G` / `5G` ARE NOT HERE, and that is the finding. In a Cisco SKU those read GIGABIT far more often than
 *        cellular: CBS220-48T-4G is four 1G uplinks, C9300L-48PF-4G likewise, and SG350X-48PV-K9-BR's own
 *        name says "48-Port 5G PoE" meaning 5 Gigabit. Including the marker claimed 1,177 parts of which
 *        462 were SWITCHES. This repo already records the same trap one letter over — a trailing G is
 *        Gigabit Ethernet as often as gigabytes — and every genuinely cellular part that carries 4G also
 *        carries LTE (GRWIC-4G-LTE-EA, CGM-4G-LTE-MNA-AB), so nothing is lost by refusing it.
 * `CW`   ONLY on a Meraki MX or Z model, where it means Cellular + Wi-Fi. Elsewhere `CW` is Catalyst
 *        Wireless (CW9166I), which has no cellular radio at all — the same two letters, the opposite answer.
 * `C`    likewise: a trailing C on an MX or Z model (MX67C, Z4C) is the cellular variant. Nowhere else.
 */
const MARKERS: readonly { re: RegExp; why: string }[] = [
  // LTE, PER HYPHEN-DELIMITED TOKEN: the token is exactly "LTE", or a DIGIT appears before it inside the
  // same token. That is what separates C1111-4PLTEEA and C1117-4PMLTEEAWE (accepted) from FILTER, FILTERING
  // and DRILLTEMP (refused), and both halves were paid for. Requiring LTE not to be followed by a letter
  // missed SIX of the 62 parts holding a cellular_bands fact; matching it anywhere claimed 1,067 parts of
  // which 374 were URL-FILTERING licences, because "fiLTEr" contains it. Neither number was visible without
  // scoring the rule against the parts that already hold the fact.
  { re: /^LTE$|[0-9][A-Z0-9]*LTE/i, why: "LTE" },
  { re: /^WWAN$|[0-9][A-Z0-9]*WWAN/i, why: "WWAN" },
  { re: /^(?:HSPA|CDMA|UMTS)$/i, why: "legacy cellular standard" },
  { re: /^CELL$|^CELLULAR$/i, why: "the word cellular" },
  // Meraki's own naming, and ONLY Meraki's: MX67C, MX68CW, Z4C, Z4C-HW. Elsewhere CW is Catalyst Wireless
  // (CW9166I), which has no cellular radio at all — the same two letters, the opposite answer.
  { re: /^(?:MX[0-9]{2,3}|Z[0-9])C(?:W)?$/i, why: "Meraki C / CW model" },
];

/** a SKU or a name as the alphanumeric tokens a marker is tested against, never as one string */
const tokens = (s: string): string[] => String(s ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);

export type CellularVerdict = { cellular: boolean; why: string };

/**
 * Whether a SKU names a part with a cellular radio, and which marker said so.
 *
 * The NAME is read too, because a marker can sit there and not in the SKU — but only as a second look: a
 * name is free text and the SKU is the identifier, so a SKU marker is what the reason names when both fire.
 */
export function cellularOf(sku: string, name?: string | null): CellularVerdict {
  const st = tokens(sku);
  for (const m of MARKERS) if (st.some((t) => m.re.test(t))) return { cellular: true, why: `SKU: ${m.why}` };
  const nt = tokens(name ?? "");
  // The name is only consulted for the standards, never for the Meraki model shape — "C" in a sentence is
  // a letter, and a name reading "Cisco MX67C" would otherwise be a second, weaker copy of the SKU rule.
  for (const m of MARKERS.slice(0, 4)) if (nt.some((t) => m.re.test(t))) return { cellular: true, why: `name: ${m.why}` };
  return { cellular: false, why: "no cellular marker in the SKU or the name" };
}

export const isCellular = (sku: string, name?: string | null): boolean => cellularOf(sku, name).cellular;
