// src/core/productClass.ts — which of a vendor's part numbers are hardware at all.
//
// WHY: 27,281 of Cisco's 89,090 part numbers are licences, service contracts and software images
// (docs/ARCHITECTURE.md § What a part is). Scored against a hardware profile every one of them is
// a permanent, unfillable spec gap; classed honestly they get a record, a `not_applicable`
// profile, and drop out of the coverage denominators. This file is the rule table in
// docs/DATA_MODEL.md § Product class, implemented in that order with those tokens, and `reason`
// names the rule that fired so parts.product_class_reason traces back to one line here.
//
// Rules it enforces:
//   * ORDER decides. `CON-` beats the licence rules, any SKU rule beats the category, and the
//     category decides only when no SKU rule fired: a licence sold inside a hardware category is
//     still a licence; a hardware-shaped SKU inside a software category is software.
//   * The Cisco spare suffix "=" is packaging, not a class. It is stripped before matching, so
//     "SFP-10G-SR=" and "L-C9200-24-E-A=" class exactly like their non-spare twins.
//   * SKU matching is case-insensitive. Cisco writes PIDs in upper case; sources do not always.
//   * Nothing is inferred from a category NAME. Only the categories row (`is_hardware`) separates
//     hardware from software, and a part whose category is not known yields `unknown` — never
//     hardware by default, because hardware is the one class that opens a spec gap.
//   * An empty SKU is `unknown` with a reason. A classifier that quietly classed "" would put a
//     hardware profile on a row that has no identity.
//   * A rule is a SKU SHAPE, never a family name. Cisco families mix classes: "Secure Malware
//     Analytics" holds TG5000-CHAS-AC (a chassis) and "Mobility Services Engine" holds
//     AIR-AP-VBLE-ADPTR= (an adapter). docs/CISCO_GAPS.md finding 9.
//
// ROUND 2 (4 Sep 2026). Twenty-one rules were added from runs/vocab/cisco-round2/
// product-class-rules.json, each counted against the live database. FOUR of that file's rules were
// REJECTED after replaying them over the whole corpus rather than over Cisco alone — the counts in
// the file are Cisco-only, and `classify()` is vendor-neutral:
//   * `sku-prefix:A-` (1,077 Cisco licences) also matches 63 ARISTA parts, and A-D800-D800-7M is a
//     QSFP-DD active optical cable carrying 7 facts. A vendor-neutral prefix cannot hold a
//     vendor-specific meaning, so the two subsets the file itself names — `A-FLEX-` (595) and
//     `A-SUB-` (53), both Cisco-only — are adopted instead and the bare `A-` is not.
//   * `sku-suffix:-LIC` (467) is not a licence marker in Cisco optical, where it marks a
//     licence-RESTRICTED CARD: 15454-AR-MXP-LIC "ONS15454 Any-Rate Muxponder", 15454-M-100GC-LIC=
//     "100G OTU-4 line card - Licensed" (5 facts), 15216-MD-ODD-LIC "Mux demux patch panel …
//     License restricted" (1 fact), 15454-SMR1-LIC "SM ROADM 1-PRE-AMP". About 20 real cards
//     holding ~30 facts would lose their hardware class. The infix rule `-LIC-` already covers the
//     unambiguous form. A future `-LIC` rule needs a category exclusion, not a bare suffix.
//     >> ADOPTED IN ROUND 4 (10 Sep 2026) with exactly that exclusion: the veto is the four
//     >> optical-transport family tokens (15216-/15454-/NCS2K-/ONS-), which is the CONDITION this
//     >> note describes rather than a list of the parts that caught it. 770 of 797 -LIC parts are
//     >> licences; the 27 in those families are licence-GATED cards and keep their hardware class.
//     >> Both sabotage cases above still stand and still pass.
//   * `sku-prefix:C1-` (562) is flagged in the file itself as needing an operator decision, and its
//     own example C1-N9K-C9508 is a real Nexus 9508 chassis; the corpus adds C1-C2960X-48LPS-L
//     ("Catalyst 2960-X 48 GigE PoE 370W", 2 facts). Cisco ONE is an ordering form, not a class.
//   * `sku-fails-is_part_number` (624) is not a SKU-shape rule but a dependency on the junk gate,
//     and that gate's own note says 1,497 real Cisco PIDs currently fail it. Wiring the class table
//     to a gate that is itself being fixed (docs/CISCO_GAPS.md finding 10) would move parts between
//     classes as a silent side effect of a scraper change.
//
// Pure: no I/O, no database. tests/productClass.test.ts runs it over real Cisco SKUs, including
// the ones that look like the wrong class, and asserts that every rule in the table fires at
// least once — a rule the suite never exercised is a rule nobody has seen work.

import { ucsKind } from "./ucsKind.js";
// fallback-kinds (12 Sep 2026): the "the name carries nothing but the SKU" test, shared with the kind
// path so one definition decides both. R8 below is a claim about a row with no description at all.
import { nameIsJustTheSku } from "./nameMarker.js";
import { strayDevice } from "./strayDevice.js";
import { bundlePlanClass } from "./bundleFamily.js"; // round-7 ruling C (12 Sep 2026)

/**
 * `non_product` (added 10 Sep 2026, migration 0014) is NOT a kind of product — it is the answer
 * "this part number does not describe a thing anyone ships": Cisco tracer SKUs and solution-ID
 * tags. It differs from `unknown` in exactly one way that matters: both leave the SCORE, only
 * non_product leaves the POPULATION. `unknown` is unfinished work and must keep being counted so
 * it keeps being done; non_product is finished work with a negative answer.
 */
export type ProductClass =
  | "hardware" | "license" | "service" | "software" | "non_product" | "unknown";

export type ClassifyInput = {
  sku: string;
  /** the part's category slug; only echoed into the reason so a wrong class names its input */
  categorySlug?: string | null;
  /** categories.is_hardware for that slug; undefined or null = the category is not known */
  categoryIsHardware?: boolean | null;
  /**
   * The part's name, consulted only by NAME_LICENSE_RULES and only after every SKU rule has
   * declined. Optional: a caller that does not have it loses the name rules and nothing else,
   * which is why adding it did not have to touch the three existing call sites at once.
   */
  name?: string | null;
};

export type Classification = { klass: ProductClass; reason: string };

export type SkuRuleKind = "prefix" | "suffix" | "contains" | "regex" | "exact";

export type SkuRule = {
  kind: SkuRuleKind;
  /**
   * For prefix/suffix/contains: the token, upper case, matched against the spare-suffix-stripped
   * SKU. For `exact`: the whole stripped SKU, so one rule covers a part and its `=` spare and
   * nothing else. For `regex`: a short stable IDENTIFIER, not the pattern — `ruleName()` builds the
   * reason string out of it, so it must stay readable and must never change once rows carry it.
   */
  token: string;
  /** Required for kind "regex" and meaningless otherwise; tested against the same stripped SKU. */
  re?: RegExp;
  /**
   * A SKU this rule must match, for the reachability check. The check builds its own probe for
   * prefix/suffix/contains (token + filler) and CANNOT for a regex — its generated probe would
   * simply never match, and the rule would be reported unreachable for ever. Give a real PID.
   */
  probe?: string;
  klass: ProductClass;
  /**
   * Substrings that VETO this rule. One entry exists (`ISE-SNS-`) and it is measured, not
   * defensive: ISE- is a licence prefix in 281 of 282 cases and ISE-SNS-ACCYKIT is a physical
   * accessory kit for the SNS appliance. Without the veto the table would knowingly misclass a
   * part it can see; with it, the exception is a line of code and a test rather than a footnote.
   */
  except?: string[];
  /** how many parts the rule matched when it was measured, and where that number came from */
  why: string;
};

/** docs/DATA_MODEL.md § Product class — the tokens, in the order the table lists them. */
export const SERVICE_PREFIX = "CON-";
export const LICENSE_PREFIXES = ["L-", "LIC-", "SL-", "SUB-", "E-", "SWSS"] as const;
export const LICENSE_SUFFIXES = ["AAE", "-STU"] as const;
export const LICENSE_INFIXES = ["-LIC-", "DNA", "MERAKI-LIC"] as const;

/**
 * THE table, in the order it is tried. First match wins and names itself in `reason`.
 * Round-1 rules first (the shapes the original table listed), then the round-2 rules in the order
 * of runs/vocab/cisco-round2/product-class-rules.json, so an existing part's reason does not
 * change when a later rule would also have matched it.
 */
export const SKU_RULES: SkuRule[] = [
  { kind: "prefix", token: SERVICE_PREFIX, klass: "service", why: "SmartNet / service contract (455 parts)" },
  // `E-` carries a veto and the rest do not, so it is declared separately rather than mapped.
  // `E-` means E-DELIVERY (E-NCS2K-S12.1K9= "NCS 2K Release 12.1 NE SW, Full, 1 Chassis, E-del")
  // and that reading holds for 80 of its 92 parts. The exception is `E-SSD-`: twelve parts, every
  // one "N TB, SATA SSD drive for UCS-E M6", and each carrying its own storage_capacity fact. They
  // are the drives for the UCS-E server module, and the letter there is the PLATFORM, not delivery.
  // Found 10 Sep 2026 by asking the opposite question to every licence round — which NON-hardware
  // parts carry an own PHYSICAL fact.
  ...LICENSE_PREFIXES.filter((t) => t !== "E-").map((token) => ({ kind: "prefix" as const, token, klass: "license" as const, why: "round-1 licence prefix" })),
  { kind: "prefix", token: "E-", klass: "license", except: ["E-SSD-"],
    why: "round-1 licence prefix, e-delivery; 92 parts. Vetoes E-SSD-, which is the UCS-E module's SATA drive family (12 parts, each with its own storage_capacity)" },
  ...LICENSE_SUFFIXES.map((token) => ({ kind: "suffix" as const, token, klass: "license" as const, why: "round-1 licence suffix" })),
  ...LICENSE_INFIXES.map((token) => ({ kind: "contains" as const, token, klass: "license" as const, why: "round-1 licence infix" })),

  // ---- round 2 (runs/vocab/cisco-round2/product-class-rules.json, counted 4 Sep 2026) ---------
  { kind: "prefix", token: "A-FLEX-", klass: "license", why: "Webex Flex Plan subscription; 595 parts, Cisco only — the safe half of the rejected bare `A-`" },
  { kind: "prefix", token: "A-SUB-", klass: "license", why: "Cisco Commerce subscription line; 53 parts, Cisco only" },
  { kind: "contains", token: "-UWL-", klass: "license", why: "Cisco Unified Workspace Licensing, infix form; 301 parts" },
  { kind: "suffix", token: "-UWL", klass: "license", why: "Cisco Unified Workspace Licensing, suffix form; 177 parts" },
  { kind: "prefix", token: "AC-APX", klass: "license", why: "Secure Client (AnyConnect) Apex term licence; 120 parts. Deliberately not the whole AC- prefix: AC- also starts real AC power accessories" },
  { kind: "prefix", token: "AC-PLS", klass: "license", why: "Secure Client (AnyConnect) Plus term licence; 180 parts" },
  { kind: "prefix", token: "ISE-", klass: "license", except: ["ISE-SNS-"], why: "Identity Services Engine licences and VM entitlements; 282 parts. ISE hardware appliances are SNS-3xxx, and the one ISE- part that is hardware (ISE-SNS-ACCYKIT, the SNS accessory kit) is vetoed by name" },
  { kind: "prefix", token: "C1F", klass: "license", why: "Cisco ONE Foundation/Advanced perpetual software licence (C1F1AIE40001K9); 214 parts" },
  { kind: "contains", token: "-DNX-", klass: "license", why: "Catalyst DNA term-licence bundle; 139 parts. The round-1 table catches DNA but not DNX" },
  { kind: "suffix", token: "-RTU", klass: "license", why: "Right-To-Use licence; 132 parts" },
  { kind: "contains", token: "-RTU-", klass: "license", why: "Right-To-Use licence, infix form (540-ESS-L-RTU-P); 38 parts" },
  { kind: "prefix", token: "E3S-", klass: "license", why: "Cisco security Enterprise Agreement tier-3 subscription; 95 parts" },
  { kind: "prefix", token: "E2SF-", klass: "license", why: "Cisco security Enterprise Agreement tier-2 subscription; 63 parts. Escapes the round-1 `E-` prefix because of the digit" },
  { kind: "suffix", token: "-SUB", klass: "license", why: "subscription suffix; 88 parts" },
  { kind: "prefix", token: "UCSS-", klass: "license", why: "Unified Communications Software Subscription; 74 parts. Not UCSC- / UCSB- / UCSX-, which are the servers" },
  { kind: "contains", token: "-SIA", klass: "license", why: "Software Innovation Access term licence (ADV-ED-100G-SIA3); 21 Cisco parts by the file's count, 212 across the corpus" },
  { kind: "prefix", token: "EVAL-", klass: "license", why: "evaluation / NFR entitlement, not a shippable product; 15 parts" },
  { kind: "contains", token: "SUBSCR", klass: "license", why: "spelled-out subscription (EI-SUBSCRIPTIONS, WAESUBSCRIPTIBDQ8); 3 parts" },
  // ---- round 3 (measured over all 91,543 parts and 13 vendors, 8 Sep 2026, working `security`) --
  // Every hardware part in `security` is hardware by the category fallback alone — no SKU rule
  // fires for any of the 6,689 — so anything the table can catch there is a part that was carrying
  // an appliance profile it can never satisfy. Both rules below match Cisco only today, hit ZERO
  // parts that carry a fact, and are industry acronyms rather than family names.
  { kind: "prefix", token: "MSLA-", klass: "license", why: "Managed Service Licence Agreement; 13 parts, 12 of them currently hardware, 0 facts. Every one is an XDR or Vulnerability Management subscription" },
  { kind: "prefix", token: "SPLA-", klass: "license", why: "Service Provider Licence Agreement; 7 parts, all currently hardware, 0 facts. Stealthwatch Cloud monthly monitoring and an Umbrella DNS entitlement" },
  { kind: "prefix", token: "S-ISE-", klass: "license", why: "ISE endpoint term licence sold through a service provider ('SVP Cisco ISE 1-Yr 100 Endpoint Apex License'); 78 parts, all currently hardware, 0 facts. The existing ISE- rule cannot reach these — the S- puts the token off the front" },
  { kind: "prefix", token: "ASA-CSC", klass: "license", why: "Content Security and Control user licences and renewals for the CSC-SSM ('ASA 5500 Series CSC-SSM-10 100-User License'); 55 parts, all currently hardware, 0 facts. Deliberately NOT the bare CSC token: the module itself is CSC-SSM-10 / CSC-SSM-20 with no ASA- prefix, and it is real hardware" },
  // REJECTED in the same pass, and worth the line: `-SUB-` as an infix looked ideal — 198 matches,
  // 79 of them hardware, 0 facts at risk. Reading the parts killed it. CS-BOARD55S-SUB-K9 is "MLB
  // for Subscription - Board 55": a MAIN LOGIC BOARD sold under a subscription plan, and so are
  // the other nine Room Kit and Board entries. `-SUB-` marks the ordering programme, not the
  // product class — the same reason the file rejected `C1-` (Cisco ONE) above. The `-SUB` SUFFIX
  // rule already in this table is the unambiguous form and stays.
  { kind: "prefix", token: "SW-", klass: "software", why: "Cisco software image / feature-set SKU (SW-CCME-UL-ENH=); 275 parts" },
  { kind: "prefix", token: "SVS-", klass: "service", why: "Cisco Solution Support service line; 28 parts" },
  { kind: "prefix", token: "ASF-", klass: "service", why: "Advanced Services fixed-scope engagement; 20 parts" },

  // ---- round 3 (6 Sep 2026) -------------------------------------------------------------------
  // Found from the OTHER end: 2,878 served INHERITED facts were sitting on licence SKUs wearing
  // product_class 'hardware' - certifications, temp_operating, altitude_max, qos_features, the
  // exact list specMerge's describesPart docstring names as the symptom it was written to stop.
  // describesPart refuses NON_PRODUCT_CLASSES a family-level fact and it never fired, because it
  // tests product_class and product_class was wrong. A correct, tested guard bypassed by its input.
  //
  // These parts have no licence token in their SKU, so nothing above catches them; the evidence is
  // in the NAME ("NCS 5500 L2VPN Lic for NCS-5501-U"). A NAME rule was built, measured and
  // ABANDONED - it is recorded here because the next person will have the same idea:
  //   * "lic" as a substring matches app-LIC-ation, rep-LIC-ation, dup-LIC-ate. 864 extra parts.
  //   * Even tightened to licen / "lic " / "lic-", the name cannot separate "licence FOR a switch"
  //     from "switch sold WITH a licence". C9500-24Q-A= is "Catalyst 9500 24-port 40G, Adv.
  //     License, no PS" - a real Catalyst 9500 - and it is structurally identical to
  //     N55-96P-SSK9 "Nexus 5500 Storage License, 96 Ports", which is a real licence.
  //   * A second signal (no facts of its own) does not save it: C9500-24Q-A= has none either.
  //   * FP8250-BASE-K9 is "FirePOWER 8250 Chassis, No IPS Lic" - a chassis whose name says it has
  //     NO licence. A name rule classes it as one.
  // So the name is evidence for finding these, never the rule that acts on them. The rules below
  // are SKU shapes, each counted across the WHOLE corpus (not Cisco alone - that is how round 2's
  // bare `A-` was caught): all nine are Cisco-only and >= 98 per cent licence-named.
  { kind: "prefix", token: "NC55P-", klass: "license", why: "NCS 5500 per-bandwidth feature licence (NC55P-ADVL3-5501S=, 'NCS 5500 L3VPN Lic for NCS-5501-SE'); 312 parts, 311 licence-named, Cisco only. These alone were 297 of one datasheet's PID list and the largest single block of wrongly inherited facts" },
  { kind: "prefix", token: "IAP-VNF-", klass: "license", why: "Intelligent Automation VNF entitlement; 72 parts, 72 licence-named, Cisco only" },
  { kind: "prefix", token: "NSO-VNFM-", klass: "license", why: "Network Services Orchestrator VNF-manager licence; 57 parts, all licence-named, Cisco only" },
  { kind: "prefix", token: "CUIC-PHY-", klass: "license", why: "Unified Intelligence Centre physical-server licence; 47 parts, all licence-named, Cisco only" },
  { kind: "prefix", token: "IAP-NE-LG-", klass: "license", why: "Intelligent Automation network-element licence, large tier; 36 parts, all licence-named. Deliberately not the shorter IAP-NE-, which did not reach the purity floor" },
  { kind: "prefix", token: "FL-SRST-", klass: "license", why: "Survivable Remote Site Telephony feature licence; 32 parts, all licence-named. Not the bare FL- prefix: FL- as a whole is NOT pure, so only the two measured subsets are adopted" },
  { kind: "prefix", token: "FL-CCME-", klass: "license", why: "Unified Communications Manager Express feature licence; 32 parts, all licence-named" },
  { kind: "prefix", token: "ASA-AC-E-", klass: "license", why: "ASA AnyConnect Essentials term licence; 28 parts, all licence-named. Not ASA-AC-, which also starts real ASA accessories" },
  { kind: "suffix", token: "-SIG", klass: "license", why: "signature-subscription suffix; 28 parts, all licence-named, Cisco only" },

  // ---- round 4 (10 Sep 2026, working `switches`; measured over all 91,543 parts) ---------------
  // Round 3 above concluded that the NAME cannot separate "licence FOR a switch" from "switch sold
  // WITH a licence", and it is right — this round is the SKU-shape answer it recommended. The two
  // parts that comment names as the trap are the test: `C9500-24Q-A=` ("Catalyst 9500 24-port 40G,
  // Adv. License, no PS") is matched by NOTHING here, and `N55-96P-SSK9` ("Nexus 5500 Storage
  // License, 96 Ports") is caught by the SSK9 suffix. Both are pinned in productClass.test.ts.
  //
  // HOW THESE WERE FOUND, because the method is the reusable part. `switches` held 507 parts with
  // product_class 'hardware' whose NAME says licence. Acting on that name would have been a
  // disaster: the 37-strong `N3K-C####-XX-L3` family reads "Nexus 3172PQ, Reversed Airflow (port
  // side intake), AC P/S, Base and LAN Enterprise License Bundle" — a box you rack, with a licence
  // in the carton. So the name was used only to FIND candidate SKU families, and each family was
  // then read in full, including every member whose name does NOT say licence (those turned out to
  // be licences too, abbreviating: "Enhanced layer 2 (includes FabricPath, RISE)").
  //
  // EVERY RULE WAS THEN RE-MEASURED OVER ALL 13 VENDORS, and that is what caught the one that
  // would have done real damage: a `-SW` SUFFIX rule looked perfect on switches (73 hits, every
  // name saying "Software license for C2960L" or "IOS build PID") and in `transceiver` **-SW means
  // SHORT WAVELENGTH** — DS-SFP-FC16G-SW and ONS-QC-16GFC-SW are Fibre Channel optics, the same
  // reach-code trap that -S/-L/-Z sprang on the model derivation on 8 Sep. It was replaced by the
  // name rule `name-software-image`, which cannot be confused by a reach code and catches 75 with
  // ZERO physical-fact parts. Also rejected: `-UPG` (WS-CF-UPG= is a Compact Flash ADAPTER) and
  // `\bnetwork (essentials|advantage)\b` as a name rule (206 hits, ~200 of them real Catalyst 9300
  // switches whose licence TIER is in their name — C9300-48U-A carries 7 physical facts).
  //
  // The refusal test is the same one round 3 used: does the rule catch a part carrying an OWN
  // physical fact? Seven do, and all seven are the SAME known defect rather than a bad rule —
  // description_mining reading the licensed device's spec out of the licence's own name
  // ("Advanced Optical license to activate G.709 and FEC per 400G modular line card" ->
  // switching_capacity 400). Those facts are retracted by scripts/retract-licence-mined.mts.
  { kind: "prefix", token: "LL-", klass: "license", why: "IOS re-licence / right-to-use for used kit ('Catalyst 2960 family 48 GE ports IOS IP Lite sw relicense'); 55 parts, Cisco only, every one licence-named" },
  { kind: "contains", token: "-NW-A", klass: "license", why: "Network Advantage tier licence sold as its own PID (IE3300-NW-A=, C9200-NW-A-24-EDU); 21 parts. The TIER letter alone is not enough — C9300-48U-A is a switch — so the rule needs the NW segment" },
  { kind: "contains", token: "-NW-E", klass: "license", why: "Network Essentials tier licence, same shape; 7 parts" },
  { kind: "suffix", token: "SSK9", klass: "license", why: "Nexus Storage Services licence ('Nexus 5600 Promo Storage Lic, 12-ports 40G'); 134 parts. This is the family round 3 named as the one a name rule could not separate" },
  { kind: "contains", token: "-EL2", klass: "license", why: "Nexus Enhanced Layer 2 licence (FabricPath/RISE); 12 parts not already caught by SSK9" },
  { kind: "suffix", token: "LAN1K9", klass: "license", why: "Nexus LAN Enterprise / Layer 3 licence ('Layer 3 License for Nexus 5500 Platform'); 21 parts" },
  { kind: "suffix", token: "BAS1K9", klass: "license", why: "Nexus LAN Base licence; 16 parts, every one licence-named" },
  { kind: "contains", token: "-FNPV", klass: "license", why: "FCoE NPV feature licence; 5 parts not already caught by SSK9" },
  // ROUND 2 REJECTED THIS RULE and productClass.test.ts holds two sabotage cases for it. Those
  // cases are RIGHT and they are also SCOPED: in Cisco's OPTICAL TRANSPORT families the -LIC
  // suffix does not mean "this is a licence", it means "this card's capacity is licence-GATED".
  // The names say so outright — 15454-SMR2-LIC "SM ROADM 2-PRE-AMP-BST 100GHZ-CBAND-10ch License
  // Restricted", 15454-AR-MXP-LIC "Any-Rate Muxponder - SW License Upgradeable", NCS2K-MR-MXP-LIC
  // "10/40/100G MR Muxponder - Licensable for Encryption", 15216-MD-ODD-LIC "Mux demux patch panel
  // ... License restricted". Every one is a physical card, ROADM or patch panel.
  //
  // The except list is the CONDITION, not a list of the parts that caught me: these four tokens
  // are Cisco's optical-transport platform families (ONS 15216 / ONS 15454 / NCS 2000 / ONS
  // pluggables), and the licence-gated-hardware convention is a property of that product line.
  // Outside them, all 770 remaining -LIC parts are licences — a random 24 read across security,
  // routers, unified-communications and optical were all licences, and the three whose name
  // carries a hardware word are licences SCOPED to hardware ("NV Cluster license applicable per
  // chassis"). The two optical-family parts that ARE licences (S-CFP2-WDM-LIC=, S-NCS4K-100G-LIC=)
  // keep their class because they carry neither token; L-NCS2K-*-LIC= is caught earlier by `L-`.
  { kind: "suffix", token: "-LIC", klass: "license", except: ["15216-", "15454-", "NCS2K-", "ONS-"],
    why: "explicit licence suffix; 797 parts, 770 after the optical-transport veto — security (248), routers (100), contact-center, unified-communications (30) and switches (19). The existing table had the -LIC- INFIX and not the suffix" },
  // The only regex rule, because this shape cannot be written as a prefix, suffix or substring.
  // `C9300-24-E-A-3` is a tier UPGRADE licence: model, PORT COUNT AS BARE DIGITS, from-tier,
  // to-tier, optional term. A real switch never has a bare-digit port token — it is 24T, 48U,
  // 24UX, 48P — which is precisely what keeps C9300-48U-A out.
  // Three families found by re-auditing `switches` AFTER round 4 landed — the residual was 87 of
  // 8,603 and these are its three clean groups. DNXA/DNXE are a near-miss of round 2's `-DNX-`:
  // the token there ends in a hyphen and Catalyst writes the tier letter against it
  // (C9200CX-DNXE-12-5Y). Added as their own rules rather than by widening `-DNX-` to `-DNX`,
  // which would change an existing rule's NAME and so the reason string on rows already carrying
  // it — and would shadow it, which the reachability check would then report for ever.
  { kind: "contains", token: "-DNXA-", klass: "license", why: "Catalyst Advantage software subscription (C9200CX-DNXA-12-5Y); 6 parts, 0 with own facts" },
  { kind: "contains", token: "-DNXE-", klass: "license", why: "Catalyst Essentials software subscription; 6 parts, 0 with own facts" },
  { kind: "contains", token: "VMFEX", klass: "license", why: "Nexus VM-FEX feature licence (N55-VMFEXK9, C1-N55-VMFEXK9); 15 parts, 11 currently hardware, 0 with own facts" },
  // REJECTED in the same pass: `-IPB`. 39 parts and it looks like a paper-licence marker
  // ("IP Base License (Paper) for Cisco 2951-3901"), but IP Base is a FEATURE TIER that appears in
  // real switch PIDs — WS-C4500X-24X-IPB is a Catalyst 4500-X carrying 13 own facts.
  // ---- round 5 (10 Sep 2026) — the eleven FLAT-PROFILE categories -----------------------------
  // Rounds 4/4b were driven by `switches`. Surveying the eleven categories whose profile has no
  // live conditional left 3,170 parts still classed `hardware` with a licence-shaped name, in
  // routers (958), unified-communications (504), wireless (332), optical-networking (254),
  // storage-networking (212) and seven more. Same method as round 4: the NAME finds a candidate
  // family, the family is read IN FULL, and the rule is a SKU shape gated on OWN PHYSICAL FACTS
  // across all 13 vendors.
  //
  // THE NAME-BASED GATE HAD TO BE THROWN AWAY AGAIN. A "does the name mention hardware?" screen
  // flagged S-A9K-40G-AIP-SE ("ASR 9K Smart License L3 VPN for 40x10GE Linecard"),
  // LIF5K-00-CUXICP ("Inline CUPS per ASR5500 Chassis") and ASR5K-00-CS10GYCC ("Write Gy CCR-T to
  // HDD During OCS Failure") as blockers. Every one is a licence whose name DESCRIBES THE DEVICE
  // IT LICENSES — the same thing that made the switches round refuse to act on names. Physical
  // FACTS are the gate; every family below holds zero.
  //
  // And these families name a FEATURE rather than saying "licence" — "Dynamic Radius extensions
  // (CoA and PoD)", "IPSG Inter-Chassis Session Recovery", "CPS ANDSF Enterprise +100
  // Subscribers", "API GW per site". A licence-word screen scores them badly and they are still
  // entitlements, exactly as the SSK9 family was in round 4.
  { kind: "prefix", token: "S-A9K", klass: "license", why: "ASR 9000 Smart Licence (S-A9K-40G-AIP-SE 'ASR 9K Smart License L3 VPN'); 91 parts, 79 currently hardware, 0 own facts of any kind" },
  { kind: "prefix", token: "S-XRV", klass: "license", why: "IOS XRv virtual-router licence; 69 parts, 59 currently hardware, 0 physical facts" },
  { kind: "prefix", token: "A9K-DDOS", klass: "license", why: "ASR 9000 DDoS mitigation licence; 59 parts, 51 currently hardware, 0 physical facts" },
  { kind: "prefix", token: "LIF5K-", klass: "license", why: "StarOS per-session feature licence for the ASR 5500 (LIF5K-00-FY10R-K9 'Home Node-B Gateway 10K Iurh Sessions'); 267 parts, 0 physical facts" },
  // ASR5K-00 AND ASR5K-99 ONLY. The bare `ASR5K-` prefix is REFUSED and the refusal is measured:
  // 175 ASR5K parts fall outside those two blocks and 32 carry physical facts — ASR5K-SMC-K9
  // "System Management Card 4GB", ASR5K-MEM-PSC2= "DIMM Replacement Kit for PSC2 - 32GB",
  // ASR5K-PFU "ASR5000 Power Filter Unit". Those two numeric blocks are the licence numbering.
  { kind: "prefix", token: "ASR5K-00", klass: "license", why: "StarOS licence block 00; part of the 275 ASR5K-00/-99 parts, 0 physical facts. NOT the bare ASR5K- prefix: 32 of the other 175 are real cards" },
  { kind: "prefix", token: "ASR5K-99", klass: "license", why: "StarOS licence block 99; same family, same gate" },
  { kind: "prefix", token: "QMOG-", klass: "license", why: "Quantum policy/API gateway entitlement ('API GW per site'); 44 parts, 42 currently hardware, 0 physical facts" },
  { kind: "prefix", token: "ANDSF-", klass: "license", why: "CPS ANDSF subscriber-tier entitlement ('CPS ANDSF Enterprise +100 Subscribers'); 41 parts, 0 physical facts" },
  { kind: "prefix", token: "MIG-1", klass: "license", why: "migration licence tiers MIG-10X/11X/12X; 60 parts, every one licence-named, 0 physical facts" },
  { kind: "prefix", token: "WAE-ENC", klass: "license", why: "WAN Automation Engine encryption entitlement; part of 81 WAE-ENC/WAE-SUB parts, 0 physical facts" },
  { kind: "prefix", token: "WAE-SUB", probe: "WAE-SUB-10-USR-L=", klass: "license", why: "probe is a row this rule DECIDES (WAE-SUB-10-USR-L=); the token alone is shadowed by an older rule. WAN Automation Engine subscription ('WAE Basic Planning Pkg, 500-999 devices'); same family, same gate" },
  { kind: "prefix", token: "XR-NCS1K", klass: "license", why: "NCS 1000 IOS XR software licence; 57 parts, 0 physical facts" },
  { kind: "prefix", token: "FL-CUBEE", klass: "license", why: "CUBE Enterprise feature licence; 20 parts, all licence-named. Not the bare FL- prefix, which round 3 measured as impure" },
  { kind: "prefix", token: "HX-VSP", klass: "license", why: "HyperFlex-bundled VMware vSphere licence ('Factory Installed - vSphere 6.5 Enterprise Plus'); 76 parts, 0 physical facts. NOT HX-SP, which is REFUSED: HX-SP-NVME-6X8TB and HX-SP-D1P2T-4X '4 Pak HDD' are drive bundles" },
  { kind: "prefix", token: "AIR-WIPS", klass: "license", why: "Adaptive wIPS licence; 16 parts, 0 physical facts" },
  { kind: "prefix", token: "C1-SL-", klass: "license", why: "Cisco ONE software licence for ISR ('AppX Foundation License for Cisco ISR 1100'); 17 parts. Round 2 refused the bare C1- prefix because C1-N9K-C9508 is a real chassis; this is the subset that note said to adopt instead" },
  { kind: "prefix", token: "MC-S-", klass: "license", why: "MATE Collector subscription ('MATE Collector BGP; Subscription'); 26 parts, 0 physical facts" },
  { kind: "prefix", token: "NCS2K-L-R", klass: "license", why: "NCS 2000 software-release RTU ('NCS 2K/MSTP - R10.9 SW, Upgrade SW RTU'); 27 parts. Deliberately NOT `NCS2K-L`, and nothing like `NCS2K-M`, which holds real cards and a 1RU cover" },
  // The six UCS Invicta operating systems, which used to be caught — along with 273 pieces of real
  // hardware — by the `UCSW` token in ucsKind's os-license set. `-OS5.` matches exactly these six
  // in 91,543 parts and nothing else: UCSW-A-OS5.SD-K9= "UCS Invicta Array OS with 32GB SD Card",
  // UCSW-SAR-OS5.X-K9 "Invicta Scaling System Router Operating System 5.x". A marker read off the
  // parts themselves, replacing a token generalised from one example.
  { kind: "contains", token: "-OS5.", klass: "license", why: "UCS Invicta operating system; 6 parts, Cisco only, every one naming an OS. Replaces the UCSW token removed from ucsKind on 10 Sep 2026" },
  { kind: "contains", token: "UWLADD", klass: "license", why: "Unified Workspace Licensing add-on; 44 parts. Escapes the existing -UWL- infix because the token runs on" },
  // REFUSED in this round, each with the product it would have cost:
  //   AIRCT2504-  53 parts, and it PASSED the automated gate — 0 physical facts, 53 of 53
  //               licence-named — because every name contains "AP Lic.". Reading the family in
  //               full killed it: ALL 53 are "Bundle WLC2504 w/ 10 AP Lic. and 5 AP-1602i Z Reg
  //               Domain", a controller shipped with five or ten physical access points. Not one
  //               is a pure licence. This is why a family is read in full and not merely gated.
  //   PROMO-      99 parts. PROMO-AP2800-S-K9 is "AP2800 (Internal Ant only) Promotion with DNA"
  //               — a real access point bundled with a licence, the same shape as the
  //               N3K-C3172-FA-L3 chassis bundles that round 4 refused.
  //   HX-SP       89 parts, five naming drive paks outright.
  //   NCS2K-M     90 parts, 9 with physical facts (NCS2K-MF-COVER= is a 1RU cover).
  //   HX-NV      139 parts, 29 with physical facts — they are NVMe drives.
  // ---- round 7 (11 Sep 2026) — closing the switches residue ------------------------------------
  // After rounds 4-6, `switches` still held 177 hardware parts whose name mentions a licence. 112
  // of those name a BOX — "Nexus 3172PQ, Reversed Airflow, AC P/S, Base and LAN Enterprise License
  // Bundle" — and are correctly hardware. The other 65 were read one by one, grouped into the
  // families below, and each family gated across all 13 vendors on facts NOT mined from a name.
  //
  // THE LARGEST WAS NOT A LICENCE AT ALL. 102 parts ending `-MIB` — CISCO-NTP-MIB,
  // MPLS-L3VPN-STD-MIB, CISCO-LICENSE-MGMT-MIB — are SNMP MIB definitions: a file describing what a
  // device reports, not a thing anyone ships. 95 sat in `switches` and 7 in unified-communications,
  // all classed hardware and asked for a switching capacity.
  { kind: "suffix", token: "-MIB", klass: "non_product", why: "SNMP MIB definition (CISCO-NTP-MIB, MPLS-L3VPN-STD-MIB); 102 parts, all Cisco, all classed hardware, 0 facts of any kind" },
  // "Cisco ONE Nexus 5600 FNPV License (Reference, No License)" — a REFERENCE line in a Cisco ONE
  // configuration that delivers nothing, which is why it is non_product rather than license: its
  // own name says there is no licence. Distinct from round 2's refused bare `C1-` (C1-N9K-C9508 is
  // a real chassis) and from `C1-SL-`, which does deliver a licence.
  { kind: "prefix", token: "C1-R-", klass: "non_product", why: "Cisco ONE reference SKU, '(Reference, No License)'; 43 parts, 0 facts" },
  // NX-OS software images and tier entitlements: NXOS-703I4.1 "Nexus 9500, 9300, 3000 Base NX-OS
  // Software Rel 7.0(3)I4(1)". switchKind already calls these `software` so they were asked nothing,
  // but their CLASS still said hardware — the kind gate hid a class defect rather than fixing it.
  { kind: "prefix", token: "NXOS-", klass: "software", why: "NX-OS software image or tier entitlement; part of 83 NXOS-/NX-OS- parts, 81 of them classed hardware, 0 physical facts" },
  { kind: "prefix", token: "NX-OS-", klass: "software", why: "NX-OS tier entitlement, hyphenated form (NX-OS-ES-XF); same family" },
  // ACI and NX-OS subscription packages: C1E1TN9300XF-5Y "Cisco ACI and NX-OS subscription
  // Essentials package for 10/25/40G+ Cisco N9000 leaf switch, 5-year term". The name mentions a
  // leaf switch because that is what the subscription COVERS.
  { kind: "prefix", token: "C1A1TN", klass: "license", why: "ACI & NX-OS Advantage subscription package; part of 18 C1A1TN/C1E1TN parts, 0 facts" },
  { kind: "prefix", token: "C1E1TN", klass: "license", why: "ACI & NX-OS Essentials subscription package; same family" },
  // ONLY the two tier forms. The bare `ACI-` prefix is REFUSED: ACI-C9336-APIC-B1 is "ACI Bundle
  // with 2 9336 and APIC" and ACI-C9336-BL-EAL "ACI Lab Bun with 1 9336, 2 9396PX Leafs" — real
  // switches in a bundle.
  { kind: "prefix", token: "ACI-ES-", klass: "license", why: "ACI Essentials SW licence per leaf ('ACI Essentials SW license for a 10/25/40G+ Nexus 9K Leaf'); 2 parts. Not bare ACI-, which holds switch bundles" },
  { kind: "prefix", token: "ACI-AD-", klass: "license", why: "ACI Advantage SW licence per leaf; 2 parts" },
  { kind: "regex", token: "n7k-scalable-feature", re: /^N7K-C70\d\d-XL$/, probe: "N7K-C7010-XL",
    klass: "license", why: "Nexus 7000 Scalable Feature License ('Cisco Nexus 7010 Scalable Feature License'); 4 parts. Anchored to the chassis-number form: a bare -XL suffix also ends real supervisors (WS-SUP720-3BXL)" },
  // The CONTAINS siblings of three round-4 SUFFIX rules. Cisco sometimes writes a spare, promo or
  // bundle marker after the licence token — N55-LAN1K9-IN=, N6001-LAN1K9-P, N55-BAS1K9-BUN,
  // N5020-SSK9-LAB — so the suffix form misses them. Placed AFTER the suffix rules, so every part
  // those already catch keeps its existing reason.
  { kind: "contains", token: "LAN1K9", klass: "license", why: "Nexus Layer 3 LAN licence with a trailing spare/promo marker (N55-LAN1K9-IN=); 9 parts, 0 physical facts" },
  { kind: "contains", token: "LAN2K9", klass: "license", why: "Nexus 3000 Layer 3 LAN Enterprise licence, second form (N3K-LAN2K9)" },
  { kind: "contains", token: "BAS1K9", klass: "license", why: "Nexus LAN Base licence in a bundle PID (N55-BAS1K9-BUN)" },
  { kind: "contains", token: "SSK9", klass: "license", why: "Nexus storage-services licence with a trailing marker (N5020-SSK9-LAB); 8 parts, 0 physical facts" },
  { kind: "prefix", token: "E3N-", klass: "license", why: "Rockwell Stratix DNA licence ('Stratix 5400L DNA (up to 12 ports), Essential License'); 15 parts, 0 facts" },
  // WIDENED on 11 Sep 2026: the port token may now carry LETTERS (12S, 24S), so
  // C3750X-12S-S-E "C3750X-12S IP Base to IP Services Paper License" is caught. What keeps real
  // switches out is that an upgrade licence carries TWO tier letters (from, to) where a switch
  // carries one: C9300-24S-A, C3750X-24S-S and C9500-24Q-A all fail the pattern and are pinned.
  { kind: "regex", token: "tier-upgrade", re: /^C\d+\w*-\d+[A-Z]*-[ELS]-[AES](?:-\d+)?$/, probe: "C9300-24-E-A-3",
    klass: "license", why: "Catalyst tier-upgrade / paper licence ('24-port NW and Cisco DNA Essentials to NW and Cisco DNA Advantage Upgrade License', 'C3650 24-port LAN Base to IP Services Paper License'); 59 parts, 0 with a physical fact" },
  // ---- round 8 (11 Sep 2026) — the residue the licence-word net could not see ----------------------
  // Round 7 closed every switches part whose NAME said licence, and the count looked finished: 17
  // left. It was measuring the wrong thing. "Cisco ONE ELA FND Perpetual Nexus 5596", "Nexus 5000
  // Base OS Software Rel 5.0(3)N1(1a)" and "Cisco C1P1TN9300GF-5Y" never use the word, so a net
  // built on it could not catch them. Widened to every switches hardware part with ZERO facts whose
  // name uses agreement/term/software vocabulary and no box vocabulary: 557, not 17. Each family
  // below was then gated across all 13 vendors and read IN FULL — every distinct name shape printed,
  // every member whose name uses box vocabulary printed on its own — before a rule was written.
  //
  // NX-OS software images. 442 parts, every one classed hardware, 0 physical facts: "Nexus 5000 Base
  // OS Software Rel 5.0(3)N1(1a)", "Cisco NX-OS Release 6.2(10) for SUP2 Nexus 7000". switchKind
  // already called them `software` (its UK9 token), so the kind gate asked them nothing — the same
  // class defect round 7 found hidden under NXOS-. The K9 sits directly on the platform token with no
  // hyphen, which is what keeps N5K-C5548UP-FA and N7K-SUP2 (hyphen after the K) out.
  { kind: "regex", token: "nxos-image", re: /^N\d+K[A-Z0-9]*K9-/, probe: "N5KUK9-503N1.1",
    klass: "software", why: "NX-OS software image (N5KUK9-503N1.1 'Nexus 5000 Base OS Software Rel 5.0(3)N1(1a)', N7KS2K9-6210); 442 parts, all classed hardware, 0 physical facts" },
  // IOS software images: an S, a platform + feature-set code, then the RELEASE — 15502T is 15.5(2)T,
  // 12250SE is 12.2(50)SE, 33-1511SG is XE 3.3 / 15.1(1)SG. 627 parts across routers, switches,
  // video and interfaces-modules, 435 of them classed hardware, 0 physical facts, 155 distinct name
  // shapes read and every one an image ("Cisco 1900 IOS UNIVERSAL", "Cisco CAT6000-VS-S2T IOS IP
  // BASE"). The 11 that name a supervisor name the one they RUN on ("Cisco Catalyst 4500 Supervisor
  // Engine 8-E Cisco IOS XE Software Release 3.3.0XO"). The release must end the SKU, which keeps a
  // three-token optic like SFP-10G-SR out.
  { kind: "regex", token: "ios-image", re: /^S[0-9A-Z]{2,10}-(?:\d{2}-)?\d{4,5}[A-Z]{1,3}$/, probe: "S19UK9-15102T",
    klass: "software", why: "IOS / IOS XE software image by release (S19UK9-15102T 'Cisco 1900 IOS UNIVERSAL', S45XUK9-33-1511SG); 627 parts, 435 classed hardware, 0 physical facts" },
  // Cisco ONE licensing: C1 followed directly by a LETTER — C1A2ANEX55481K9 "Cisco ONE Advanced
  // Perpetual Nexus 5548", C1E1ATCAT93002-5Y "C1 Essentials Term C9300 48P 5Y", C1P1TN9300GF-5Y (the
  // Premier sibling of round 7's C1A1TN/C1E1TN, whose names are only the SKU), C1A1VISR2900S-01
  // "Tracker PID v01 Adv Perpetual ISR2900S - no delivery". 679 parts, 180 classed hardware, 0
  // physical facts, 64 name shapes read. Real devices put a DIGIT there: C1000-16T-2G-L (a Catalyst
  // 1000 switch, 13 facts) and C1100TG-1N32A (a terminal gateway, 25 facts) are pinned. Round 2's
  // refusal of bare `C1-` stands — the hyphen form holds real chassis.
  { kind: "regex", token: "cisco-one", re: /^C1[A-Z]/, probe: "C1A2ANEX55481K9",
    klass: "license", why: "Cisco ONE perpetual / term / tracker licence (C1A2ANEX55481K9 'Cisco ONE Advanced Perpetual Nexus 5548'); 679 parts, 0 physical facts; C1 + digit is hardware (C1000, C1100)" },
  // Enterprise Licence / Enterprise Agreement SKUs: "Cisco ONE ELA FND Perpetual Nexus 5596",
  // "ELA 2 UC Applications User", "Cisco UCS Director Capped ELA-Servers 500", "Cisco ONE EA ADV
  // Perpetual Nexus 5596". 97 parts in six categories, 0 physical facts, every member read.
  { kind: "prefix", token: "ELA-", klass: "license", why: "Enterprise Licence Agreement SKU (ELA-CUIC-BASE-K9 'ELA Cisco UCS Director Base Software License')" },
  { kind: "prefix", token: "ELA2-", klass: "license", why: "ELA 2.0 SKU ('Cisco ONE ELA FND Perpetual Nexus 5596', 'ELA 2 Multiparty User'); 53 parts, 0 physical facts" },
  { kind: "prefix", token: "ELAC-", klass: "license", why: "UCS Director capped ELA tier ('Cisco UCS Director Capped ELA-Servers 500'); 15 parts, 0 facts" },
  { kind: "prefix", token: "ELAU-", klass: "license", why: "UCS Director uncapped ELA tier ('Cisco UCS Director UnCapped ELA-Servers 5000'); 7 parts, 0 facts" },
  { kind: "prefix", token: "E2C1-", klass: "license", why: "Cisco ONE Enterprise Agreement 2 SKU ('Cisco ONE EA FND Perpetual Nexus 5596', 'Cisco ONE EA WAN CUBEE Standard Add-On'); 20 parts, 0 facts" },
  { kind: "prefix", token: "D2OPS-", klass: "license", why: "DCN Day-2 Ops subscription ('DCN Day2 Ops Assurance and Insights for Modular, 7Y'); 12 parts, 0 facts" },
  { kind: "prefix", token: "C1-DCL-", klass: "license", why: "Cisco ONE DCNM for LAN licence ('Cisco ONE DCNM for LAN Advanced Edt. for Nexus 5000'); 3 parts, 0 physical facts" },
  { kind: "prefix", token: "C1-DCS-", klass: "license", why: "Cisco ONE DCNM for SAN licence ('Cisco ONE DCNM for SAN Advanced Edt for MDS 9700 embedded'); 7 parts, 0 physical facts" },
  { kind: "prefix", token: "C1-ISE-", klass: "license", why: "Cisco ONE ISE end-point licence ('Cisco ONE ISE PLUS 30 End-Point Lic Term'); 4 parts, 0 facts" },
  // DCNM is SOFTWARE here because 77 of the family's 118 parts were already classed software by the
  // category; the 41 hardware-classed ones ("DCNM SAN Adv Features for MDS 9300 Switch-Based, EMC
  // Spare") join them rather than moving all 118 to a new class.
  { kind: "prefix", token: "DCNM-", klass: "software", why: "Data Center Network Manager licence/software ('DCNM for SAN Advanced Edt. for MDS 9100 embedded'); 118 parts, 77 already software, 0 physical facts" },
  // Nexus promotional SOFTWARE bundles. Every name is a list of licence features — "Inc
  // LAN,ADV,TRS,EL2,DCNM,DCNMSAN,MPLS,SAN,XL - Promotion", "Nexus 6004 SBUN;LAN, DCNM-LAN/SAN, 96p
  // 40G Storage, EL2" — where "96p 40G Storage" is the storage-protocol licence for 96 ports, not 96
  // ports. 52 parts across both forms, 0 physical facts.
  { kind: "contains", token: "-SBUN-", klass: "license", why: "Nexus software-bundle promotion ('Inc LAN,ADV,TRS,EL2,DCNM,DCNMSAN,MPLS,SAN,XL - Promotion'); 38 parts, 0 physical facts" },
  { kind: "contains", token: "-DFA-BUN-", klass: "license", why: "Nexus DFA licence bundle ('Nexus 6001 DFA Bundle-Limited Time Promo; LAN, EL2, DCNM-LAN'); 14 parts, 0 facts" },
  { kind: "regex", token: "nexus-dfa", re: /^N\dK-DFA(?:-P1)?$/, probe: "N7K-DFA-P1",
    klass: "license", why: "Nexus Dynamic Fabric Automation entitlement ('Nexus DFA production support'); 9 parts, 0 facts" },
  // Cisco ONE ISR and Nexus licence tiers under CONE-: "Perpetual License Cisco ONE Advanced 2900 ISR
  // Family", "Cisco ONE smoke test AP PID". NOT bare CONE-: CONE-2921-ATO is "ISR 2921 for Cisco ONE",
  // an assemble-to-order router, and is pinned.
  { kind: "regex", token: "cone-tier", re: /^CONE-[A-Z0-9]+-(?:AP|FND|SEC)-(?:P|\dY)$/, probe: "CONE-2921-AP-P",
    klass: "license", why: "Cisco ONE licence tier (CONE-2921-FND-P 'Perpetual License Cisco ONE Foundation 2900 ISR Family'); 15 parts, 0 facts. Not CONE-2921-ATO, a router" },
  // IOS image upgrade kits on CD / e-delivery: "IP Services image upgrade kit for standard versions of
  // the Cisco 3750", "MetroIPAccess Image Upgrade for 3400 FE Switch". NOT bare CD-: CD-DSKCAM-C-US is
  // a Desk Camera 4K and CD-CBL-USBC-USBC= a USB-C cable, both pinned.
  { kind: "regex", token: "cd-image-kit", re: /^(?:R-)?CD-(?:ME3400-[AB]2[AI]|3750G?-(?:48)?EMI)$/, probe: "CD-3750G-EMI",
    klass: "software", why: "IOS image upgrade kit on CD or e-delivery (CD-3750G-48EMI, R-CD-ME3400-A2I); 9 parts, 0 facts. Not CD-DSKCAM (cameras) or CD-CBL (cables)" },
  { kind: "prefix", token: "ACI-VPOD-", klass: "software", why: "ACI virtual pod software ('ACI vPod virtual pod redundant management cluster software'); 2 parts. Bare ACI- stays refused" },
  { kind: "prefix", token: "N3K-XNC-", klass: "software", why: "Extensible Network Controller bundle ('Nexus 3000, XNC with Monitor Manager Small Bundle'); 2 parts, 0 facts" },
  { kind: "prefix", token: "N3K-ES-", klass: "license", why: "Nexus 3400-S Essentials licence ('Nexus 3432D-S Essential License including Layer-3 LAN Enterprise'); 2 parts, 0 facts" },
  // Factory IOS tier upgrades: "C3750X-48 IP Base to IP Services factory IOS Upgrade". Two tier
  // letters again, the same discriminator as tier-upgrade.
  { kind: "regex", token: "factory-ios-upgrade", re: /-IOS-[BLSE]-[BLSE]$/, probe: "C3750X-48-IOS-S-E",
    klass: "license", why: "factory IOS tier upgrade ('C3750X-48 IP Base to IP Services factory IOS Upgrade'); 4 parts, 0 facts" },
  // IOS XE images whose release is three digits and a letter (310E = 3.10.0E, 316S = 16.3.x S).
  // Deliberately NOT a widening of ios-image: the widened pattern also matched SSD-120G= and
  // SSD-240G, "Cisco pluggable USB3.0 120G SSD storage" — the 120G reads as a release. Anchored to
  // the two platforms that use the form, and the SSDs are pinned.
  { kind: "regex", token: "ios-xe-image", re: /^S(?:45|ISR)[A-Z0-9]*-(?:S\d-)?\d{3}[A-Z]$/, probe: "S45XUK9T-310E",
    klass: "software", why: "IOS XE image, three-digit release (S45EUK9T-S9-310E 'CAT4500E SUP9E Universal Crypto Image', SISR4300UK9-316S); 9 parts, 0 facts. Not SSD-120G, an SSD" },
  // WLAN controller software: "Cisco Unified WLAN Controller SW Release 5.0", "WLAN Controller SW for
  // WiSM". 28 parts, every one in `switches` and every one asked a switch's questions — switchKind's
  // software token needs a hyphen or end after SW, and SWLC6K9-51 has neither.
  { kind: "regex", token: "wlc-software", re: /^SW(?:LC|ISM)/, probe: "SWLC4400K9-50",
    klass: "software", why: "WLAN controller software release (SWLC4400K9-50 'Cisco Unified WLAN Controller SW Release 5.0'); 28 parts, 0 facts" },
  { kind: "contains", token: "FMS1K9", klass: "license", why: "Fabric Manager Server licence ('Cisco FMS package for one Cisco MDS 9500 Series Multilayer Director'); 10 parts, 0 facts" },
  { kind: "regex", token: "c1-nexus-upgrade", re: /^C1-N\dK-UPG/, probe: "C1-N5K-UPG",
    klass: "license", why: "Cisco ONE upgrade entitlement ('Cisco ONE Upgrade for Nexus 5000 - CHOOSE ONLY QTY 1 HERE'); 6 parts, 0 facts" },
  { kind: "prefix", token: "C1-SWATCH-", klass: "license", why: "Cisco ONE StealthWatch licence ('Cisco ONE StealthWatch 50 FPS Lic Term'); 5 parts, 0 facts" },
  { kind: "prefix", token: "C1-CAT-", klass: "license", why: "Cisco ONE for Catalyst entitlement ('Cisco ONE Term Add for Catalyst Switches - CHOOSE QTY 1 HERE'); 2 parts, 0 facts" },
  { kind: "contains", token: "AISK9LC", klass: "license", why: "Advanced IP Services upgrade licence ('Advanced IP Services upgrade for 3750G-48 with IP Base'); 2 parts, 0 facts" },
  { kind: "suffix", token: "-LB-IPB", klass: "license", why: "LAN Base to IP Base upgrade licence ('LAN BASE to IP BASE upgrade license (paper delivery)'); 2 parts. Not bare -IPB: WS-C4500X-24X-IPB is a switch with 13 facts" },
  // SINGLETONS. Each is one product (with its spare) whose own name says it is a licence, software or a
  // service, and whose SKU shares its shape with nothing else in the catalogue — so a family rule would
  // be a rule of one. Named exactly, so none of them can reach a part it was not read against.
  { kind: "exact", token: "N3548-ALGK9", klass: "license", why: "'Nexus 3500 Algo Boost License'" },
  { kind: "exact", token: "N3K-STR1K9", klass: "license", why: "'Telemetry license for Nexus 3000 platform'" },
  { kind: "exact", token: "N5020-P02K9", klass: "license", why: "'Nexus 5020 Storage Protocols Services License Promotion'" },
  { kind: "exact", token: "C4500X-IPB", klass: "license", why: "'Catalyst 4500-X IP BASE software license (paper delivery)'" },
  { kind: "exact", token: "IE-LICENSE-SPARE", klass: "license", why: "'Spare license for software upgrade (L2 to L3 features or MRP protocols)'" },
  { kind: "exact", token: "IE2000-B-E", klass: "license", why: "'IE2000 LAN Base to Enhanced LAN Base Paper NAT License to Enable NAT Capability'" },
  { kind: "exact", token: "SV-VF30-BASE+5K9", klass: "license", why: "'Cisco VFrame 3.0 Director Base + 5 Node License'" },
  { kind: "exact", token: "DCN-SYNCE-XF", klass: "license", why: "'SyncE add-on license'" },
  { kind: "exact", token: "PRIMEINFRAEXPAUY2", klass: "license", why: "'Prime Infra Expansion' (Prime Infrastructure licence)" },
  { kind: "exact", token: "IE-SW-SPARE", klass: "software", why: "'SPARE IOS software for IE2000U, CGS2520, IE3000, IE3010, ESM'" },
  { kind: "exact", token: "CSP-SW", klass: "software", why: "'Data Center NFV Platform Software'" },
  { kind: "exact", token: "IOX-IE4K-CORE", klass: "software", why: "'Cisco IOx Core Software for IE4K family'" },
  { kind: "exact", token: "N7K-NAM-SW-6.0-K9", klass: "software", why: "'Cisco Prime NAM Software version 6.0'" },
  { kind: "exact", token: "NX-OS", klass: "software", why: "'Cisco NX-OS'" },
  { kind: "exact", token: "SF-ASASM-8.5-K8", klass: "software", why: "'ASA Software 8.5 for Catalyst 6500-E ASASM, 2 free VFW'" },
  { kind: "exact", token: "C2K-SW-EXT", klass: "service", why: "'C2K Security and Vulnerability Software Support extension'" },
  // Found by the switches KIND audit, after round 8: parts whose kind was wrong because their CLASS was.
  { kind: "prefix", token: "SC4K-", klass: "software", why: "CatOS supervisor image ('Catalyst 4K Supervisor Flash Image w/ SSH, Release 7.6.9'); 5 parts, 0 facts" },
  // The reviewer's §0.6 query (hardware rows that switchKind calls software) found six Catalyst 4500
  // IOS XE images still classed hardware: their release tails — "331-1511SG", "S8-38E", "31-01XO" —
  // fit neither image pattern above. Every S45*- part in the catalogue was read: 21, all images.
  { kind: "regex", token: "cat4500-xe-image", re: /^S45[A-Z0-9]*-(?:S\d-)?\d/, probe: "S45XU-331-1511SG",
    klass: "software", why: "Catalyst 4500 IOS XE image (S45XU-331-1511SG 'IOS Software XE Release 3.3.1 SG', S45EUK9-S8-38E); 6 more parts, 0 facts" },
  // An ordering option that ships nothing: "ECO friendly green option, no power cable will be
  // shipped". Exact, not a NO- prefix — NO-OS-SELECTION is already non-hardware and would churn.
  { kind: "exact", token: "NO-POWER-CORD", klass: "non_product", why: "'ECO friendly green option, no power cable will be shipped' — an option that ships nothing" },
  // ---- found by the transceiver KIND census, 11 Sep 2026 (reviewer §2), every match read ------------------
  // FirePOWER subscriptions sold through a service provider, filed as hardware OPTICS because the model
  // number is glued onto "SFP": SFP7010-TAC-OPS "SVP Cisco FirePOWER 7010 IPS, Apps and URL Adjustable OPS".
  // 171 parts, all Cisco, all in `transceiver`, all 0 facts, 9 name shapes (TAC/TAM/TAMC x OPS/SMS-1/SMS-1K),
  // every one "SVP ... FirePOWER". A real optic has a hyphen straight after SFP (SFP-10G-SR), so it cannot match.
  { kind: "regex", token: "firepower-svp-subscription", re: /^SFP[78]\d{3}(?:TAMC)?-/, probe: "SFP7010-TAC-OPS",
    klass: "license", why: "FirePOWER IPS/Apps/URL/AMP subscription (SVP); 171 parts in transceiver, 0 facts" },
  // A FORM FACTOR IS NOT A PRODUCT. Nine rows named only "Cisco <form factor>", enumerated from datasheet
  // cells; catalogue-wide these exact tokens occur nowhere else. SFP28 carries 7 facts, all describing an
  // optic that is not this row.
  ...["QSFP-", "QSFP-DD", "QSFP28", "QSFP28-DD", "QSFP56", "QSFP56-DD", "QSFP112", "SFP28", "SFP56"].map((token) => ({
    kind: "exact" as const, token, klass: "non_product" as const, why: "a form-factor name enumerated as a part ('Cisco QSFP28'), not an orderable product" })),
  // FAMILY PLACEHOLDERS WHOSE "x" VARIES THE SPECIFICATION: a DWDM channel (DWDM-XFP-xx.yy "where xx.yy ranges
  // from 30.33 to 60.61"), a CWDM/DWDM wavelength (CWDM-SFP10G-xxxx, DS-CWDM-XXXX= "where XXXX = 1470..."), a
  // cable length (SFP-H10GB-CUxM "length x - 1m to 5m"), an ITU channel (XFP-RF-ITUXX=). The concrete SKUs
  // exist beside them (CWDM-SFP10G-1470, SFP-H10GB-CU1M). 32 parts once the refusals below are applied (reclassify
  // run of 11 Sep 2026: 26 in transceiver, 1 each in switches, routers, storage- and optical-networking, 2 in
  // interfaces-modules — 7300-2OC3POS-xxx, where xxx is the fibre-variant placeholder).
  // REFUSED, and the refusal is the reason this rule is narrow: a TWO-letter `-xx` is Cisco's REGION code on
  // Small Business gear — SG350-28-K9-xx, CBS350-8P-2G-xx, SF110D-08-xx (9 facts) — real switches, 190 of
  // them in `switches`, identical in every region. The first draft (`X{2,}`) would have filed all 190 as
  // non-products. The 9800-CL cloud controllers (SC9800CLAMIK9-xxxx "Catalyst 9800-CL Wireless Controller –
  // AWS") are software, not placeholders, and are vetoed by name.
  { kind: "regex", token: "family-placeholder", re: /-(?:X{2}\.Y{2}|X{3,4}|CUXM)$|-ITUXX$/, probe: "DWDM-XFP-XX.YY",
    except: ["SC9800CL"],
    klass: "non_product", why: "a family placeholder whose x stands for a channel, wavelength or cable length; the concrete SKUs exist beside it" },
  // servers (12 Sep 2026) -------------------------------------------------------------------------------
  // S1-S7 from evidence/security-servers-series-survey.md (g), each family read in full, plus the
  // hyperconverged-only families. Measured on the 11 Sep snapshot, ALL vendors (91,543 parts): every rule
  // below hits only servers-unified-computing / hyperconverged-*, and ZERO rows carrying an own physical
  // fact. The pinned refusals are in tests/productClass.test.ts. FL-UCSE-, FL-SRE-, -SMS/-OPS, C1-\dY-
  // and PCP- are the SECURITY agent's global rules and are deliberately not repeated here.
  { kind: "regex", token: "ucs-manager-image", re: /^N10-MGT\d/, probe: "N10-MGT016", klass: "software",
    why: "S1: 'UCS Manager v4.0' / 'UCS Manager v4.2 and Intersight Managed Mode v4.2'; 19 parts, all servers, 0 facts" },
  { kind: "regex", token: "ucs-firmware-package", re: /^(?:N20|UCSB)-FW\d/, probe: "N20-FW018", klass: "software",
    why: "S2: 'UCS 5108 Blade Chassis FW Package 4.2', 'UCS B200 M4 server node FW'; 19 parts, 0 facts. Anchored: N20-C6508 is the chassis" },
  { kind: "regex", token: "ucs-fi-port-licence", re: /^N10-L\d{3}$|^UCS-6324-40G$|-FI-L-|^(?:UCS|HX|HCI)-L-6[234]\d{2,3}-/, probe: "N10-L003",
    klass: "license", why: "S3: 'UCS 6100 Series Fabric Interconnect/Storage protocol license', '6324 Fabric Interconnect License for 40G Scalability Port', 'FI per port license to connect to B-Series, C-Series or FEX' (HX-L-6400-25G, whose UCS-L-6400-* twins are named only by SKU); 33 parts. Not bare UCS-6324: UCS-SPM-MINI is the 5108 AC2 chassis with FI6324" },
  { kind: "regex", token: "ucs-management-licence", re: /^UCS-MDMGR-|^NFR-CUIC-|^SSTACK-MCP/, probe: "UCS-MDMGR-1S", klass: "license",
    why: "S4: 'UCS Central Per Domain License', 'NOT FOR RESALE Cisco UCS Dir Res Lic', 'Additional Private Cloud Capacity for SSTACK-MCP'; 28 parts. Not bare SSTACK-: SSTACK-LS-OPS is a training service" },
  { kind: "regex", token: "ucs-platform-software", re: /^CIMC-C\d|^UCSW-DDUP-|^UCSX-C-SW-LATEST$/, probe: "CIMC-C220M4-209E", klass: "software",
    why: "S5: 'C-Series Software 2.0(9e) for C220 M4', 'Not Standalone 24T DDUP software', 'Platform SW (Recommended) latest release'; 13 parts. Not UCSW- (UCSW-SD480G0KA4-C is an SSD) and not UCSX-C- (UCSX-C-M6-HS-R is a heat sink)" },
  { kind: "regex", token: "ucs-licence-key", re: /^UCSC-SWRAID\d$|^SWIFTSTACK-LICENSE$|^UCS-SLESTERMS$|^SVC-DATAPRTECT/, probe: "UCSC-SWRAID5", klass: "license",
    why: "S6: 'Software Raid 5 upgrade key', 'Acceptance of Terms, Standalone SLES License', 'Cohesity DataProtect Advanced Service Subscription'; 5 parts" },
  { kind: "contains", token: "CWOM", except: ["C1-"], klass: "license",
    why: "S7: Cisco Workload Optimization Manager ('Advantage - Per VM', AWS marketplace, EA); 8 hardware parts. C1-CWOM-* is vetoed so its rows keep their existing ucs-kind-os-license reason" },
  { kind: "regex", token: "hyperflex-data-platform-licence", re: /^(?:(?:E2N|E3A|E2-N|WPA|XCAT)-(?:ELA-)?)?HXDP|^E2-N-HYPERFLEX$/, probe: "HXDPS001-3YR",
    except: ["-SMS", "-OPS"], klass: "license",
    why: "hyperconverged: HyperFlex Data Platform subscriptions and EA allocations ('HyperFlex Data Platform Datacenter Advantage Subscription', 'Cisco Data Center EA for Hyperflex'); 204 parts, all hyperconverged-systems, 0 facts. The -SMS/-OPS rows (33) are left to the security agent's svp-ops-sms rule. Not contains-HXDP: HX-M5S-HXDP-BR is a 'HX2X0C M5 Hyperflex System'" },
  { kind: "prefix", token: "NT-", klass: "license",
    why: "hyperconverged: Nutanix software licences sold by Cisco — NUS/NCI/NCM/NDB/EUC product codes with PRO/ULT/STR editions (NT-NCI-STR-PR, NT-EUC-ULT-AP); 180 parts, all hyperconverged-infrastructure, 0 facts, no NT- part in any other category or vendor. Names carry no words, so this is the SKU-only rule of the set" },
  { kind: "regex", token: "cisco-plus-hybrid-cloud", re: /^PLHC-?HX|^(?:ONDEMAND|RESERVE)-/, probe: "PLHC-HXMCVSI-OND", klass: "license",
    why: "hyperconverged: 'Cisco+ Hybrid Cloud Ondemand/Reserve for HyperFlex' consumption subscriptions; 50 parts. Not bare PLHC-: PLHC-MLOM-40G-04 is a VIC and PLHC-IOM-2408 an I/O module" },
  { kind: "regex", token: "hyperconverged-sw-subscription", re: /^HCI-NVGR|^(?:HXC?|HX-E)-FSS-|^HX-VSSD?2VSP-/, probe: "HCI-NVGRVAS-4YRM6", klass: "license",
    why: "hyperconverged: 'NVIDIA GRID Software Subscription', 'Full Stack Subscription Bundle - 3YR', 'Upgrade PAC vSphere v7.x'; 35 parts" },
  // end servers (12 Sep 2026) ---------------------------------------------------------------------------
  // --- video (12 Sep 2026) — the residue found by the video kind census; every SKU below read by name ---------
  // RF Gateway licences classed hardware: 16 in `video` ("QAM DS-384 License (Single QAM)", "RFGW-1 OCTAL
  // LICENSE: MUST CONFIGURE WITH RFGW1", "DS-384 PowerKEY License"); catalogue-wide the token starts nothing else.
  { kind: "prefix", token: "SWLIC-", klass: "license", why: "RF Gateway QAM, octal, data and scrambling licences; 16 hardware-classed parts in video, every name says License" },
  { kind: "exact", token: "INODEMGR-STD-NOD", klass: "license", why: "'Intelligent Node Mgr - Standard RTU SW License'; 1 part in video" },
  ...["4021700", "4021701", "4021701C", "4021702"].map((token) => ({ kind: "exact" as const, token, klass: "license" as const,
    why: "RF Gateway 1 licence under a bare Scientific-Atlanta number ('RFGW-1 License Upgrade, PowerKey, 4 QAMs Per Port', 'RFGW-1 License, DVB Scrambling', 'RFGW-1 Data License Option Kit'); 4 parts" })),
  // Management software sold as a PID: 'RF Gateway 1 Remote Management Utility', '... Remote Provisioning Utility'.
  { kind: "regex", token: "rfgw-mgmt-utility", re: /^RFGW-1?0?-R[MP]U$/, probe: "RFGW-10-RPU", klass: "software",
    why: "RF Gateway remote management / provisioning utility; 3 parts in video (RFGW-1-RMU, RFGW-1-RPU, RFGW-10-RPU)" },
  // cBR-8 software images and the IOS option class: 'Cisco CBR8 IOS XE UNIVERSAL' x5, 'IOS OPT CLS'.
  { kind: "prefix", token: "SCBR8-UK9", klass: "software", why: "cBR-8 IOS XE Universal image by release (SCBR8-UK9-1610); 5 parts in video" },
  { kind: "exact", token: "CBR-8-IOS-OPT", klass: "software", why: "'IOS OPT CLS' — the cBR-8 IOS option class of the configurator; 1 part" },
  // NOT ORDERABLE THINGS: configurator container PIDs, the family name, a channel name and a connector name
  // enumerated as parts. REFUSED: CBR-8-CCAP-CHASS (the real chassis) and GS7K-OPT-NODE (a real node) — the
  // rules are EXACT, so neither is touched.
  ...[["CBR-8", "'Container (Top Level) PID for configuring the cBR-8 System'"],
      ["HA-RPHY", "'Container (Top Level) PID for configuring the RPHY HA shelf'"],
      ["GS7000", "'Cisco GS7000' — the family name, not a configured node"],
      ["ITU20", "'Cisco ITU20' — a DWDM channel name enumerated from a datasheet cell"],
      ["E2000/APC", "'Cisco E2000/APC' — a connector type enumerated from a datasheet cell"]].map(([token, why]) => ({
    kind: "exact" as const, token, klass: "non_product" as const, why: `${why}; 1 part in video` })),
  // --- end video (12 Sep 2026) ----------------------------------------------------------------------------------
  // collab (12 Sep 2026) — the collaboration categories' residue. unified-communications held 2,928 "hardware"
  // parts and ~2,150 of them are UCM / Unity Connection / HCS / CUWL entitlements that name a product and never
  // say "licence" (the name rules cannot see them). Each family below was measured over all 12,418 Cisco parts
  // in unified-communications, collaboration-endpoints and conferencing: 0 facts of any kind in every one, and
  // every name read. NOT measured against the other twelve vendors — this group's database scope is its own
  // three categories — so every token is a Cisco product name, never a bare letter prefix (the bare `A-` stays
  // refused: A-D800-D800-7M is an Arista cable).
  { kind: "prefix", token: "HCS-", klass: "license", why: "Hosted Collaboration Solution tier / user / PAK entitlement ('HCS Tier 5 HCM-F for Standard Users'); 183 parts, 178 classed hardware, 0 facts" },
  { kind: "prefix", token: "UNITYCN", klass: "license", except: ["BUNDLE"], why: "Unity Connection port / user / upgrade licence; 145 parts, 0 facts. UNITYCN7-BUNDLE 'Unity Connection 7.x SW plus HW Bundle' ships a server and is vetoed" },
  { kind: "prefix", token: "UPG-UC", klass: "license", why: "UC Manager / Unity Connection version-upgrade licence ('UC Manager Upgrade ENH to STD, v9.x to 10.x, 1 user'); 135 parts, 0 facts. NOT the bare UPG- prefix: an upgrade KIT is hardware" },
  { kind: "prefix", token: "UPG-TP-", klass: "license", why: "TelePresence room licence upgrade ('Upg to UCM 12.x TP Room from 11.x'); 8 parts, 0 facts" },
  { kind: "prefix", token: "USOL-", klass: "license", why: "Unified Communications Solution UIP / user bundle ('Solution UIP - Package B, SE, 3-Year'); 54 parts, 0 facts" },
  { kind: "prefix", token: "CUWL", klass: "license", why: "Cisco Unified Workspace Licensing ('CUWL - Collab 2 Month, 1 User'); 26 parts, 0 facts" },
  { kind: "prefix", token: "A-SPK-", klass: "license", why: "Webex (Spark) subscription ('Cloud device registration', 'Toll Shared 5k Minute Bundle'); 94 parts, 0 facts" },
  { kind: "prefix", token: "A-WRK-", klass: "license", why: "Webex Work committed / overage / usage subscription; 78 parts, 0 facts" },
  { kind: "prefix", token: "A-WORK", klass: "license", why: "Webex Work bundle subscription ('Committed Bundle + Toll Dial In Audio'); 65 parts, 0 facts" },
  { kind: "prefix", token: "A-PRM-", klass: "license", why: "Cisco Collaboration on-premises subscription ('UC Manager 10x - SW Kit for UCM'); 42 parts, 0 facts" },
  { kind: "prefix", token: "A-HST-", klass: "license", why: "Cisco Collaboration hosted subscription; 15 parts, 0 facts" },
  { kind: "prefix", token: "A-TPAAS", klass: "license", why: "TelePresence-as-a-Service subscription for Meeting Server; 4 parts, 0 facts" },
  // `A-CMS` (12 parts, 0 facts, all Meeting Server subscription options) is NOT adopted: tests/productClass pins
  // A-CMS-API in contact-center as the category-fallback example (software), and a licence rule would move it.
  // The 12 are listed as a proposal in the report instead.
  { kind: "prefix", token: "CTES-MRC-", klass: "service", why: "CTES monthly recurring fee per endpoint tier ('1 screen endpoint (0-100)'); 11 parts, 0 facts" },
  // A TLS CIPHER-SUITE NAME IS NOT A PRODUCT: TLS_AES_128_GCM_SHA256 was enumerated as a conferencing part from a
  // Meeting Server table. 8 parts, 0 facts. The underscore is the anchor; no Cisco PID carries one.
  { kind: "regex", token: "tls-cipher-suite", re: /^TLS_[A-Z0-9_]+$/, probe: "TLS_AES_128_GCM_SHA256",
    klass: "non_product", why: "a TLS cipher-suite name enumerated from a Meeting Server table; 8 parts, 0 facts" },
  // "Number of 3951 per room", "Number of 792X per room": an ordering-tool QUESTION enumerated as a part. 14 parts.
  { kind: "suffix", token: "-PER-ROOM", klass: "non_product", why: "an ordering-tool quantity question ('Number of 7906 per room'); 14 parts, 0 facts" },
  // end collab
  // ---- routers (12 Sep 2026) — the class residue of `routers` (reviewer §6.1) ----------------------------------
  // 735 routers hardware parts had licence/software vocabulary in their name and no box vocabulary. The survey
  // (evidence/routers-class-residue.md) measured each family below across all 13 vendors on OWN physical facts;
  // this block adopts them in the switches method: family read in full, every refusal pinned verbatim in
  // tests/productClass.test.ts. Appended LAST so every existing rule keeps precedence and every part an older rule
  // already decides keeps its reason. NOT here, by ownership: SF-, UMB-, FL-SSLVPN/FL-WEBVPN, C1-nY-, PCP-,
  // N1K-ASA1K-, FL-SRE-, FL-UCSE- are the security agent's (the FL- rule below is fenced off them).
  // A RELEASE NUMBER IN THE SKU IS AN IMAGE, NOT A LICENCE (12 Sep 2026). `WAE-7.2-K9` is named "WAE 7.2
  // Software" and this rule was calling it a licence, because the rule fires on the prefix and the
  // release-in-sku rule that would have said `software` sits later in the table. The veto hands those rows to it
  // and leaves every WAE pack, term and perpetual suite here. Found by the merge: release-in-sku had stopped
  // firing anywhere, and a rule that never fires is the tell.
  { kind: "regex", token: "wae", re: /^WAE-(?!\d{3,4}-K9)(?!\d+\.\d)/, probe: "WAE-PS-PLT-PAKL",
    klass: "license", why: "WAN Automation Engine packs, terms and perpetual suites ('WAE Planning Standard Platform PAK Licenses, Perpetual'); 325 parts, 237 routers hardware, 0 physical facts. Fenced off the WAAS appliance shape WAE-nnnn-K9" },
  // XC- is CRS software: the control-plane and line-card IMAGES first, the licences after.
  { kind: "regex", token: "xr-crs-image", re: /^XC-(?:RP|RPK9|LCBASE)[-_]/, probe: "XC-RP-03.25",
    klass: "software", why: "IOS XR image for CRS-1 ('Cisco IOS XR Software for CRS-1 Multi-chassis Systems', 'Line Card Base Software version v3.0'); 17 parts, 0 physical facts" },
  { kind: "regex", token: "xc-licence", re: /^XC-(?!SLOT-)/, probe: "XC-XLAT44-10M",
    klass: "license", why: "CRS line-card and bundle licences ('Line Card License'); 121 parts, 107 hardware, 0 physical facts. Not XC-SLOT-CVR-E, an X-Series slot cover" },
  // MERGE, 12 Sep 2026: the routers agent read every XR- release as an IMAGE (software); the optical agent read the
  // NCS 4000 and NCS 1000 releases as RTU LICENCES, which is what their own names say — "…USB key- RTU License",
  // "…Release 712 RTU". Each is right about its own rows, so the two narrow prefixes (XR-NCS4K, XR-1K, below) keep
  // their rows and this rule keeps the rest. Without the veto it shadowed them and their test cases never fired,
  // which is how the collision surfaced: a rule that never fires is the tell.
  { kind: "regex", token: "xr-image", re: /^XR-(?:NC(?!S4K)\d|A9K|CRX|RP|XR\d)/, probe: "XR-A9K-X64K9-07.6",
    klass: "software", why: "IOS XR images and releases (XR-A9K-X64K9-07.6, XR-NC55-PK9-07.02); 81 parts, 0 physical facts. Not bare XR-: XR-10GB-LR is a 10GBASE-LR X2 optic. The NCS 4000 and NCS 1000 release RTUs are licences (XR-NCS4K, XR-1K)" },
  { kind: "prefix", token: "XR-EA-", klass: "non_product", why: "'Internal attributions PID for CRS'; 2 parts" },
  { kind: "regex", token: "mate-collector", re: /^MC-(?:P|\d+Y)-/, probe: "MC-1Y-NDA-B-ADSM",
    klass: "license", why: "MATE Collector perpetual and N-year bundle ('MATE Collector ... Bndl ... Sub'); 40 parts, 0 physical facts. Not MC-3G-HSPA-U / MC-3G-EVDO-B, 3G modem cards" },
  { kind: "prefix", token: "MATE-", klass: "license", why: "MATE Design / Live suites; 21 parts, 0 physical facts" },
  { kind: "prefix", token: "8KSW", klass: "license", why: "Cisco 8000 software tiers and SIA; 28 parts, 0 physical facts" },
  { kind: "regex", token: "cube-sp-session", re: /^CUBESP-(?!AP-)/, probe: "CUBESP-32KP-RED",
    klass: "license", why: "CUBE(SP) session licences; 14 parts. Not CUBESP-AP-H250B/K9, the CUBE(SP) appliance" },
  { kind: "prefix", token: "FLASR1-", klass: "license", why: "ASR 1000 feature licences; 79 parts, 0 physical facts" },
  { kind: "prefix", token: "FLSASR", klass: "license", why: "ASR 902/903/907/1000 licence PAKs; 62 parts, 0 physical facts" },
  { kind: "prefix", token: "FLSA1", klass: "license", why: "ASR 1001-HX throughput licences, incl. FLSA1C1-; 53 parts, 0 physical facts" },
  // FL- as a whole: round 3 refused it as impure, and the impurity is ONE SHAPE, not one family — a DRAM upgrade
  // written <platform>-<from>U<to>: FL-8XX-512U1GB "512 MB DRAM upgrade ... Cisco 89x" (a physical fact) and, found
  // by this dry run in interfaces-modules, FL-1900-256U512MB "CISCO1905 DRAM Upgrade from 256MB to 512MB". The
  // fence states the shape rather than the two families. The security agent's four sub-families are fenced off
  // too, so this rule and theirs never both claim a part.
  { kind: "regex", token: "feature-licence", re: /^FL-(?!SSLVPN|WEBVPN|SRE-|UCSE-)(?![A-Z0-9]+-\d+U\d+[MG]B)/, probe: "FL-C800-APP",
    klass: "license", why: "IOS feature licences (FL-4330-PERF-K9, FL-GK-IPIP7200, FL-C1900-PA); 130 parts not already decided, 0 physical facts. Not the FL-<platform>-<n>U<n>MB DRAM upgrades" },
  { kind: "prefix", token: "S-A99", klass: "license", why: "ASR 9900/9903 Smart licences; 24 parts, 0 physical facts (S-A9K is an older rule)" },
  // Actility LoRaWAN: SaaS licences, except the support and install lines, which are services.
  { kind: "regex", token: "act-service", re: /^ACT-.*-(?:SUPP|INSTALL)$/, probe: "ACT-TPE-V-SUPP",
    klass: "service", why: "Actility support / installation-training line (ACT-TPE-V-SUPP, ACT-TPE-E-INSTALL)" },
  { kind: "prefix", token: "ACT-", klass: "license", why: "Actility LoRaWAN SaaS; 60 parts, 0 physical facts" },
  { kind: "prefix", token: "SWOA-", klass: "license", why: "'SWOA for 1900ISR Cisco ONE Plus ELA'; 15 parts" },
  { kind: "prefix", token: "WAN-", klass: "license", why: "WAN Automation suites; 12 parts, 0 physical facts" },
  { kind: "regex", token: "cube-sp-pak", re: /^CSP-\d+K?P-/, probe: "CSP-250P-RED",
    klass: "license", why: "CUBE(SP) paper PAK; 11 parts. Not CSP-5444 '2RU NFV Platform' or CSP-CPU-6154, hardware" },
  { kind: "prefix", token: "SASR", klass: "software", why: "ASR IOS XE images ('RP2 Advanced IP Services w/o Crypto'); 20 parts, 0 physical facts" },
  { kind: "regex", token: "ios-xe-image-2", re: /^S(?:ISR\d|C8KAE|A9\d\dR)[A-Z0-9]*-?\d{2,4}[A-Z]{0,2}$/, probe: "SISR4451XUK9-39S",
    klass: "software", why: "IOS XE images the older image rules miss (SISR4451XUK9-39S, SC8KAEPUK9-1710, SA903R1NPEK9318SP); 0 physical facts. SSD-M2SED-600G and SSD-120G do not match" },
  { kind: "regex", token: "ios12-image", re: /^S[0-9A-Z]{2,10}-\d{5}$/, probe: "S805CHP-12321",
    klass: "software", why: "IOS 12.x images with no letter tail (S805CHP-12321, S28NASK9-12401); 6 parts" },
  { kind: "prefix", token: "WAAS-", klass: "license", why: "WAAS licences for SRE; 18 parts, 0 physical facts" },
  { kind: "prefix", token: "MD-", klass: "license", why: "MATE Design; 21 parts, 0 physical facts" },
  { kind: "prefix", token: "ML-", klass: "license", why: "MATE Live; 6 parts" },
  { kind: "prefix", token: "CGR1K-IPSW-", klass: "software", why: "'Connected Grid OS Software Version 4.2'; 5 parts" },
  { kind: "regex", token: "rtu-n", re: /-RTU\d+$/, probe: "ESS-ED-100G-RTU1",
    klass: "license", why: "Right-To-Use licence with a digit (ESS-ED-100G-RTU1); 10 parts — the older -RTU rules miss the digit" },
  { kind: "regex", token: "rtu-per-g", re: /-\d+G-RT$/, probe: "ESS-ADN-AC-100G-RT",
    klass: "license", why: "'Upgrade RTU per 10G'; 5 parts. Not bare ESS-: ESS-9300-10X-E is a board with physical facts" },
  { kind: "prefix", token: "NGA-", klass: "license", why: "Cisco 8000 SIA / RTU; 16 parts" },
  { kind: "prefix", token: "SCUE-", klass: "software", why: "Unity Express 'Release x.y'" },
  { kind: "prefix", token: "SCUSP-", klass: "software", why: "SIP Proxy 'Release x.y'" },
  { kind: "prefix", token: "SUMG-", klass: "software", why: "Unified Messaging Gateway 'Release x.y'" },
  { kind: "prefix", token: "SLASR", klass: "license", why: "ASR IP Base / Metro tiers; 38 parts, 0 physical facts" },
  { kind: "prefix", token: "SDR-", klass: "license", why: "'SD-Routing monitoring cloud license'; 9 parts" },
  { kind: "prefix", token: "LS-", klass: "license", why: "RV router security subscriptions ('Cisco 1-Year RV Router Anyconnect Server 25 Tunnels'); 20 parts" },
  { kind: "prefix", token: "R-XRV", klass: "software", why: "IOS XRv 9000 e-delivery; 4 parts" },
  { kind: "prefix", token: "C1-ISRWAAS", klass: "license", why: "Cisco ONE ISR-WAAS RTU; 6 parts" },
  { kind: "prefix", token: "C1-FL-", klass: "license", why: "Cisco ONE feature licence; 6 parts. Bare C1- stays refused (C1-N9K-C9508)" },
  { kind: "prefix", token: "IOSXE-", klass: "software", why: "'IOS XE Autonomous Mode (default mode)', an ordering option of the image; 2 parts" },
  { kind: "regex", token: "hsec", re: /-HSEC(?:-|$)/, probe: "C8000-HSEC",
    klass: "license", why: "'U.S. Export Restriction Compliance license' (HSEC); 21 parts, 0 physical facts. CISCO2911-HSEC+/K9, a VPN ISM module bundle, does not match (+)" },
  { kind: "prefix", token: "CRS-DDOS-", klass: "license", why: "Arbor DDoS licences for CRS; 6 parts. Not CRS-FP140-C, a forwarding processor with its own facts" },
  { kind: "prefix", token: "OAI-", klass: "non_product", why: "'Offer Attribution (Immediate)' — a tracking line that ships nothing; part of 10" },
  { kind: "prefix", token: "OAD-", klass: "non_product", why: "'Offer Attribution (Daily)'; same family" },
  { kind: "suffix", token: "SPARECD", klass: "software", why: "spare software CD" },
  { kind: "regex", token: "adsl-firmware", re: /^FW\d+\.\d+/, probe: "FW3.0.33",
    klass: "software", why: "ADSL modem firmware release" },
  { kind: "regex", token: "asr-image-kit", re: /^ASR\d+X?IMG/, probe: "ASR1002XIMGWSSH",
    klass: "software", why: "'Image - with SSH'" },
  { kind: "prefix", token: "DVD-", klass: "software", why: "software on DVD" },
  { kind: "regex", token: "quantum-wave", re: /^(?:QUANTUM-WAVE|QW-\d+-SW)/, probe: "QW-10-SW-K9",
    klass: "software", why: "Quantum WAVE software" },
  { kind: "regex", token: "ap-image", re: /^SW\d/, probe: "SW9105AX-EWCEX-K9",
    klass: "software", why: "AP / WLC CAPWAP, EWC and mesh images; 21 parts, 0 physical facts" },
  { kind: "prefix", token: "A9K-MACSEC", klass: "license", why: "ASR 9000 MACsec RTU; 3 parts" },
  { kind: "prefix", token: "A9K-WDM-", klass: "license", why: "ASR 9000 IPoDWDM FEC licence; 4 parts" },
  { kind: "regex", token: "a9k-chassis-upgrade", re: /^A9K\d{4}-UP/, probe: "A9K9901-UP256-456G",
    klass: "license", why: "ASR 9901 upgrade licences; 2 parts. Bare A9K- is refused: A9K-MPA-32X1GE and A9K-MOD400-SE hold physical facts" },
  // Per-line-card feature licences an A9K line-card rule would otherwise file as the CARD: 'L3 VPN license for
  // 36X10GE Linecard Service Edge Optimized', 'Infra. VRF lic. for up to 8 VRF instances per 24-port 10G/1G LC',
  // 'License for Inline CGv6 Transition features on the 36X10G Line Card'. Anchored to the WHOLE tail, so the
  // card itself (A9K-36X10GE-SE, A9K-MOD400-SE) cannot match.
  { kind: "regex", token: "a9k-lc-feature-licence", re: /^A9K-[A-Z0-9]+-(?:AIP-(?:SE|TR)|IVRF|V6-INLN)$/, probe: "A9K-36X10G-AIP-SE",
    klass: "license", why: "ASR 9000 per-line-card feature licence (-AIP-SE/-AIP-TR/-IVRF/-V6-INLN); names all say licence" },
  { kind: "exact", token: "A9K-RSP440L-ALIC", klass: "license", why: "'A9K-RSP440-LTUpgrade License to activate 440Gbps/slot'" },
  { kind: "exact", token: "CPFLICENSEA8UM", klass: "license", why: "'Cisco CPFLICENSEA8UM' — a licence PID named only by its SKU" },
  { kind: "exact", token: "CPFLICENSEA8UK", klass: "license", why: "'Cisco CPFLICENSEA8UK' — same" },
  { kind: "exact", token: "IOX-SOFTWARE", klass: "software", why: "'Cisco IOX-SOFTWARE'" },
  // The residue after the families above: 80 of the 735 flagged parts stay hardware and are read one by one in the
  // report. These eight are the licences and services among them; the rest are real devices (5940 ESR cards, IW
  // industrial APs, SPIAD and C88x bundles, promotion hardware) pinned as refusals in the test.
  { kind: "regex", token: "mate-bundle", re: /^M-[EPS]-B-/, probe: "M-S-B-BV",
    klass: "license", why: "MATE visibility bundle ('MATE Infra Visibility Bndl, Subscription'); 3 parts. Not bare M-: M-ASR1K-* is memory" },
  { kind: "prefix", token: "FLS-ASR", klass: "license", why: "'Upgrade from 2.5 Gbps to 5Gbps License for ASR 1001'; 2 parts" },
  { kind: "regex", token: "cisco-one-sl", re: /^C1-SL\d/, probe: "C1-SL19-DATA-APPK9",
    klass: "license", why: "'Cisco ONE DATA features for 1900 series APP license' — C1-SL- with the platform glued on" },
  { kind: "exact", token: "ASR920-1588", klass: "license", why: "'Cisco ASR 920 IEEE 1588-2008 BC/MC License'" },
  { kind: "exact", token: "CME-UL", klass: "license", why: "'Cisco Communication Manager Express (CME) - 1 User License'" },
  { kind: "exact", token: "IOTFND-IR8100", klass: "license", why: "'IoT FND Subscription License for Managing IR8100 Router'. Exact: its 14 siblings are already software by category" },
  { kind: "exact", token: "IXM-LORAWAN-CPF", klass: "license", why: "'System part number for Common Packet Forwarder license'. Not IXM-: IXM-LPWA-900-K9+ is the gateway" },
  { kind: "exact", token: "CRS-SWM-EXTN", klass: "service", why: "'IOS XR Software Support Extension for CRS for 1 year'" },
  // Four more found by the routerKind reverse control (a component-worded name in the `router` default bucket).
  // Exact, because the DISK-MODE- family also holds four rows in servers-unified-computing, which is not this block's.
  { kind: "exact", token: "NCS-MC-LIC600", klass: "license", why: "'NCS6000 per 60x10GE card IOS-XR multi chassis' capability — its four NCS-MC-LIC siblings are already licences" },
  { kind: "exact", token: "IR510-COMPUTE-1.4", klass: "software", why: "'IR510 Software PID for compute module'" },
  { kind: "exact", token: "DISK-MODE-RAID-5", klass: "non_product", why: "'Configure Hard Drives as RAID 5' — a configuration option that ships nothing" },
  { kind: "exact", token: "DISK-MODE-RAID1JBD", klass: "non_product", why: "'Configure Two Hard Drives in RAID 1 Config and 3rd Non RAID' — a configuration option" },
  { kind: "exact", token: "CRS-8-NO-FC", klass: "non_product", why: "'CRS 8 slots with no fabric card option' — an ordering option that ships nothing" },
  { kind: "exact", token: "ASR1000-SPA", klass: "non_product", why: "'SPA for ASR1000; No Physical Part; For Tracking Only' — its own name says nothing ships" },
  // ---- end routers (12 Sep 2026)---------------------------------------------------------------------------------
  // ---- optical-storage (12 Sep 2026) — the residue in optical-networking and storage-networking ------------------
  // Every rule below was counted catalogue-wide (all 13 vendors, every category) before it was written: every
  // match is Cisco, and between them they hold ONE non-inherited physical fact (SSI-M9K9-521 rack_units 2, mined
  // from "5.2(1)" — listed for retraction). Where a rule also reaches another category the count says so. NOT
  // written here, by ownership: `SF-` (the security group's global software rule — 127 optical-networking hardware
  // rows), `-SMS`/`-OPS`, `C1-<n>Y-`, `PCP-`.
  //
  // MDS NX-OS / SAN-OS images: "MDS 9200 Supervisor/Fabric-2, NX-OS Software Release 5.2(1)" (M92S2K9-5.2.1),
  // "MDS 9124V 64G FC - NXOS NPE System Image version 9.3(1)" (M9124VS8K9-N9.3.1), M9148S6K9NPE8.5.1. The RELEASE
  // (digits, a dot, a digit) after K9 is what makes it an image: 533 parts, all storage-networking, 0 physical facts.
  { kind: "regex", token: "mds-image", re: /^M9\d{1,4}[A-Z]*\d?K9-?(?:N|NPE-?)?\d+\.\d/, probe: "M92S2K9-5.2.1",
    klass: "software", why: "MDS NX-OS / SAN-OS software image by release (M92S2K9-5.2.1 'MDS 9200 Supervisor/Fabric-2, NX-OS Software Release 5.2(1)'); 533 parts, 0 physical facts" },
  { kind: "prefix", token: "SSI-M9K9-", klass: "software", why: "MDS SSI image ('MDS SSI Image 5.2(8)'); 15 parts, 1 mined rack_units read off the release number" },
  // MDS subscriptions: M91XK9-SD-5Y "MDS SA + DCNM Subscription M9100 5Y", M91VXK9-A-1Y-OSM. 63 parts, 0 physical.
  { kind: "regex", token: "mds-subscription", re: /^M9\dV?XK9-/, probe: "M91XK9-SD-5Y",
    klass: "license", why: "MDS SAN Analytics / DCNM subscription (M91XK9-SD-5Y 'MDS SA + DCNM Subscription M9100 5Y'); 63 parts, 0 physical facts" },
  // EVERY OTHER M9 PID IS A LICENCE — feature packages (M9100ENT1K9 "Enterprise Package", M9200FIC1K9 "Mainframe
  // Package", M92DMM184K9 "Data Mobility Manager License", M95IOASSN "I/O Accelerator License", M9500XRC "XRC
  // Acceleration package") and port activations (M9148S-PL12 "12-port On-Demand Activation license", M9250IP20-16G
  // "20-port FC Upgrade License", M9220I-UPGK9). 161 in storage-networking, 12 in interfaces-modules, 3 in
  // security; 0 physical facts. The one M9 hardware module is REFUSED by name: M9XT-FC1632 "MDS 32G FC Port
  // Expansion module". Runs after the image and subscription rules, so those keep their class.
  { kind: "regex", token: "mds-licence", re: /^M9(?!XT-)/, probe: "M9148S-PL12",
    klass: "license", why: "MDS feature package or port-activation licence (M9148S-PL12 'MDS 9148S 12-port On-Demand Activation license'); 176 parts, 0 physical facts. M9XT- (a real expansion module) refused" },
  { kind: "prefix", token: "C1-ENT-M9", klass: "license", why: "Cisco ONE Enterprise Package licence for one MDS switch ('Cisco ONE Enterprise Package License for 1 MDS9700 Switch'); 4 parts, 0 facts" },
  { kind: "prefix", token: "UCS-EP-MDS", klass: "license", why: "MDS port-upgrade licence sold with the UCS bundle ('MDS 9148S 16G FC 12-port upgrade license + 8G SW SFPs'); 6 parts, 0 physical facts" },
  { kind: "regex", token: "mds-analytics-term", re: /^L\d-D-M9\d/, probe: "L1-D-M91S-AXK9",
    klass: "license", why: "SAN Analytics term licence ('SAN Analytics solution license for MDS9100 1 year'); 12 parts (10 storage-, 2 interfaces-modules), 0 facts. The round-1 L- prefix cannot reach them: the digit comes before the hyphen" },
  { kind: "exact", token: "MDS-9222I-FREE-SW", klass: "software", why: "'9222i SMB Free Software Package Promotion'" },
  // ONS 15454 MSTP / NCS 2000 / NCS 1000 / NCS 4000 / NCS 4200 software and right-to-use licences.
  { kind: "prefix", token: "SF15454", klass: "software", why: "MSTP software preloaded on a controller ('MSTP - R10.0.1 Preloaded SW, TCC3, TNC/E, TSC/E - NO WSON'); 67 parts, 0 facts. The hyphenated SF- form is the security group's rule; this one has no hyphen" },
  { kind: "prefix", token: "NCS2K-M-R", klass: "license", why: "NCS 2000 release on media with right-to-use ('NCS 2K/MSTP - R10.0.1 SW, Media (DVD) SW RTU - WSON CP'); 54 more parts, 0 facts. Sibling of the existing NCS2K-L-R; the hyphen after R keeps NCS2K-MR-MXP (a muxponder) out" },
  { kind: "prefix", token: "NCS2K-R-", klass: "license", why: "NCS 2000 network-element software licence ('NCS 2K Rel 12.0 NE SW, SVO Base License, One Chassis, USB'); 9 parts, 0 facts" },
  { kind: "regex", token: "mstp-release", re: /^15454[A-Z]?-R\d/, probe: "15454-R9.8.1SWK9",
    klass: "license", why: "ONS 15454 MSTP release RTU ('15454 ANSI ETSI MSTP Rel. 9.8.1 Pkgs., DVD, RTU License', 15454M-R1070SWK9 'RTU LIC DVD'); 41 parts, 0 facts. The R and a digit straight after the platform token keep every 15454 card out" },
  { kind: "prefix", token: "XR-NCS4K", klass: "license", why: "NCS 4000 IOS XR release RTU ('NCS 4000 IOS XR Software Release 6.1.2 USB key- RTU License'); 21 parts. Sibling of the existing XR-NCS1K" },
  { kind: "prefix", token: "XR-1K", klass: "license", why: "NCS 1000 IOS XR release RTU ('NCS 1002 IOS XR Software Release 712 RTU'); 8 parts, 0 facts" },
  { kind: "prefix", token: "SNCS42", klass: "software", why: "NCS 4200 consolidated IOS XE software package ('Provides a consolidated software package for NCS4200 RSP2'); 30 parts, 0 facts. The ios-image rule needs a hyphen and these have none" },
  { kind: "regex", token: "ncs-smart-licence", re: /^S-(?:NCS1K|NCS4K|N1K)/, probe: "S-NCS1K4-ULIC-100",
    klass: "license", why: "NCS 1000 / 4000 Smart Licence ('NCS 1004 Universal 100G Client Smart License', 'License POTS - CE and MPLS - for NCS 4000 Packet Line Card'); 10 more parts, 0 physical facts" },
  { kind: "prefix", token: "S-OAS-", klass: "software", why: "Optical Network Planner software ('OAS Optical Network Planner Software Version 5.0'); 5 parts, 0 facts" },
  { kind: "prefix", token: "CONC-RTM-", klass: "license", why: "Crosswork Optical Network Controller subscription ('Essential CONC subscription for small device with support'); 6 parts, 0 facts" },
  { kind: "prefix", token: "FASTPAD", klass: "license", why: "FastPAD feature licence ('License for Bisync 2780 support', 'License for SDLC protocol support'); 7 parts, 0 facts" },
  { kind: "regex", token: "legacy-protocol-sw", re: /^(?:ESP|VNS|DNS)-SW-/, probe: "ESP-SW-2.0",
    klass: "software", why: "legacy protocol software ('ESP Version 2.0 Software For ATM and FR SVCs, PNNI', 'DPNSS Protocol Feature'); 3 parts, 0 facts" },
  { kind: "prefix", token: "OAS-COSM-", klass: "license", why: "'Cisco Optical Site Manager - Managed Line Card License'; 1 part, 0 facts" },
  // DATASHEET CELLS ENUMERATED AS PARTS, every one named only "Cisco <token>": SONET/SDH/OTN performance-monitoring
  // counter names (BBE-PM, UAS-SM, MS-SESR, RS-OFS, CV-S, FC-PM, SEFS-S), modulation formats (CP-16QAM, DP-QPSK,
  // PM-8QAM, CP-BPSK), OTU rate names (OTU3, OTU3e, OTU-4) and optical monitoring points (LINE-TX, MON-CPL,
  // SPL-TXL, CPL-RXC, LC-LC). 68 parts, all optical-networking, all Cisco, 0 physical facts; they DO hold a few
  // facts copied from the table they were read out of (OTU-4 10, PM-16QAM 6) — listed for retraction. Anchored at
  // both ends on the counter / format vocabulary, so a real PID carrying one of these tokens cannot match.
  { kind: "regex", token: "pm-counter-name", re: /^(?:MS|RS)-(?:BBER?|ESR?|SESR?|UAS|EB|OFS)$|^(?:BBER?|ESR?|SESR?|SEFS|UAS|EAS|CV|FC)-(?:PM|SM|L|S)$/, probe: "UAS-PM",
    klass: "non_product", why: "a performance-monitoring counter name read out of a datasheet table ('Cisco UAS-PM'); 44 parts, 0 physical facts" },
  { kind: "regex", token: "modulation-name", re: /^(?:CP|DP|PM)-(?:\d+-?QAM|QPSK|BPSK)$/, probe: "DP-16QAM",
    klass: "non_product", why: "a modulation-format name read out of a datasheet table ('Cisco DP-16QAM'); 11 parts, 0 physical facts" },
  { kind: "regex", token: "otu-rate-name", re: /^OTU-?\d[EF]?$/, probe: "OTU4",
    klass: "non_product", why: "an OTN rate name read out of a datasheet table ('Cisco OTU4'); 4 parts, 0 physical facts" },
  { kind: "regex", token: "monitor-point-name", re: /^(?:LINE|MON|SPL|CPL)-(?:TX|RX|LINE|CPL|TXL|TXC|RXL|RXC)$|^LC-LC$/, probe: "LINE-TX",
    klass: "non_product", why: "an optical monitoring-point or connector-pair name read out of a datasheet table ('Cisco MON-LINE', 'Cisco LC-LC'); 9 parts, 0 facts" },
  // end optical-storage
  // ---- security (12 Sep 2026) ----------------------------------------------------------------------------
  // The `security` class residue: Cisco security parts classed hardware by the category fallback alone whose
  // SKU says licence, subscription or software image. Two surveys found them (evidence/security-class-residue.md,
  // 1,218 flagged; evidence/security-servers-series-survey.md rules 1-21); every family below was read in full
  // by name there, and re-counted here over all 91,543 parts and 13 vendors with this worktree's classify().
  // Every rule matches ZERO parts carrying an own physical fact (the round-3 gate). Appended after every
  // earlier rule, so no row an earlier rule decided changes its reason. Counts are "matched / newly decided"
  // across the catalogue; where a rule reaches outside `security` the categories are named.
  //
  // REFUSED, each with the product it would cost (pinned in productClass.test.ts):
  //   bare `S-`        MikroTik optics with own facts (S-4554LC80D, S-RJ01, S-85DLC05D)
  //   -OPS unvetoed    SSTACK-LS-OPS "SwiftStack Operations & Admin Training" — a service
  //   bare `FP-`       FP-PWR-DC-650W (a PSU), FP-NMSB-10G (a module)
  //   bare `ASA-SSP-`  46 ASA 5585-X Security Services Processors (ASA-SSP-60-INC1 "... with 6GE, 4SFP+")
  //   bare `LC-`/`CV-` LC-FC-PWR-AC-1200W (a PSU), CV-CNTR-M8N (a Cyber Vision Center appliance)
  //   bare `ST-`       ST-M5-10G-4FI "Stealthwatch Accelerated 4x10G SFP+ NIC"
  //   bare `C1-`       C1-TETRATION (Secure Workload hardware bundle), C1-N9K-C9508 (round 2)
  //   `-SBE` threat    FPR1010T-SBE "Small Business Edition" — bundle or licence, undecided, left hardware
  //   `ASA-AC-` bare   all 76 measured are licences; kept to the -M-/-PH- sub-prefixes (open question 1)
  //   CSM4-UCS2-*-HW   "CSM UCS bundle to manage 150 devices" — a server bundle; only the -SW rows are licences
  //
  // SVP (service-provider) subscriptions: the model number glued onto an S ("SAM8350-TAM-SMS-1K", "SASA5506-TA-OPS").
  { kind: "regex", token: "svp-model-glued", re: /^S(?:ASA|FPR|AMP?|FTD)\d/, probe: "SAM8350-TAM-SMS-1K",
    klass: "license", why: "SVP subscription with the model glued on ('SVP Cisco AMP8350 IPS, Apps and AMP Fixed SMS-1K'); 378, security only" },
  // Each token after `S-` occurs nowhere else in the catalogue; the bare `S-` is refused above.
  { kind: "regex", token: "svp-security-token", re: /^S-(?:AC|AM|AMPTG|ASA|CES|CLDLK|ESA|FP|FTD|H|L|SMA|ST|SW|TG|TGA|TGSP|UMB|WSA)(?![A-Z])/, probe: "S-CLDLK-APP-O365",
    klass: "license", why: "SVP security subscription ('SVP Cloudlock for Microsoft Office365', S-FP-AMP-1Y-S3); 756 matched, security only" },
  { kind: "prefix", token: "F-S-", klass: "license", why: "SVP FirePOWER service subscription ('SVP ... 3YR Service Subs'); 8, security only" },
  // Fixed SMS-1 / SMS-1K and Adjustable OPS subscriptions. Reaches hyperconverged-systems (HXDPE-SMS-1, HyperFlex
  // Data Platform subscriptions — licences there too) and one servers row. SSTACK- is a training course.
  { kind: "regex", token: "svp-ops-sms", re: /(?:-OPS|SMS-\d+K?)$/, probe: "TG5500-SMS-1", except: ["SSTACK-"],
    klass: "license", why: "Fixed SMS / Adjustable OPS subscription ('Threat Grid 5500 Content Subscription License Fixed SMS-1'); security, hyperconverged-systems 39, servers 1" },
  // Software images: "Cisco FXOS v2.3.2 for FPR9300", "NCS 1K - R6.0.1 SW, NCS1002". Reaches optical-networking
  // (131), routers (2, SF-I4330-5.4-NPE ISRWAAS preload) and interfaces-modules (1). Small Business SF110D/SF3xx
  // switches carry no hyphen after SF and are not matched.
  { kind: "prefix", token: "SF-", klass: "software", why: "Sourcefire / FXOS / ASA / AsyncOS / NCS software image ('Cisco FXOS v2.3.2 for FPR9300'); 502, security 367, optical-networking 131" },
  // Threat Defense licences glued to the model: CSF1240T-TM, FPR2110T-T, ASA5506WT-BASE. The appliances carry
  // TD- AFTER a hyphen (CSF1210CE-TD-K9, FPR1120-NGFW-K9) and cannot match.
  // \d{2,4}, not the survey's \d{3,4}: CSF12CET-TM / CSF12T-T ("CSF 1210CE Threat Defense IPS License") abbreviate
  // the model to two digits. CSF220-TD-K9 still cannot match — nothing after 220 reads "T-".
  { kind: "regex", token: "threat-licence-glued", re: /^(?:FPR|CSF|ASA)\d{2,4}[A-Z]{0,2}T-/, probe: "CSF1240T-TM", except: ["-SBE"],
    klass: "license", why: "Threat Defense IPS / malware licence glued to the model ('CSF 1240 Threat Defense IPS & Malware Defense License'); 208, security only" },
  // TERM SUBSCRIPTIONS ON A FIREWALL / IPS MODEL: model, optional SSP size, one to three feature tokens, a term.
  // "ASA 5585-X SSP-40 NGFW IPS 1Year" (ASA5585-40-IP1Y), "ASA 5512-X AVC,WSE, IPS 5 Year" (ASA5512AWI5Y),
  // "Cisco FirePOWER 8130 Upgrade to add IPS 5YR Subscription" (FP8130-UPG-IPS-5Y), "Cisco FPR1010 Small Business
  // Edition, 3Y Subs" (FPR1010T-SBE-3Y — the TERMED Small Business Edition; the bare -SBE stays undecided). The
  // class-residue survey's bounded-term rule, SCOPED to the five firewall/IPS model prefixes: its unscoped form
  // reaches 214 parts in eight other categories that were only partly read. No appliance PID ends in a term.
  { kind: "regex", token: "firewall-term-subscription", re: /^(?:ASA|FP|AMP|FPR|CSF)\d{4}(?:[A-Z]{0,3}-(?:\d{2}-)?(?:[A-Z]{2,5}-){0,2}[A-Z]{1,5}-?|[A-Z]{2,4})\d{1,2}YR?(?:-PR)?$/,
    probe: "ASA5585-40-IP1Y", klass: "license", why: "ASA CX / NGFW IPS / FirePOWER term subscription ('ASA 5585-X SSP-40 NGFW IPS 1Year'); security only" },
  // The IPS SSP of the midrange ASA 5500-X is a SOFTWARE licence ("ASA 5515-X IPS SSP License"). Scoped to 5512-5555:
  // on the 5585-X the SSP is the physical blade, and its PIDs are ASA5585-SSP-nn, which this cannot reach.
  { kind: "regex", token: "asa-ips-ssp-licence", re: /^ASA55[1-5]\d-IPS-SSP$/, probe: "ASA5515-IPS-SSP",
    klass: "license", why: "'ASA 5515-X IPS SSP License'; security only. ASA5585-SSP-10 (a blade) cannot match" },
  { kind: "regex", token: "asa-security-plus", re: /^ASA55\d\dH?-SEC-(?:PL|NFR)/, probe: "ASA5506-SEC-PL",
    klass: "license", why: "ASA Security Plus licence ('ASA 5506-X Sec Plus License'); security only. ASA5506-SEC-BUN-K9 (the appliance bundle) does not match" },
  { kind: "regex", token: "asa-encryption-licence", re: /^ASA5500-ENCR-K\d$/, probe: "ASA5500-ENCR-K9",
    klass: "license", why: "'ASA 5500 Strong Encryption License (3DES/AES)'; 2" },
  { kind: "regex", token: "fw-cloud-management", re: /^(?:FPR|CSF)\d{3,4}[A-Z]{0,2}-P$/, probe: "FPR2120-P",
    klass: "license", why: "'Cloud Management for FPR 2120'; 26, security only. FPR2110-ASA-K9 and the -K9 appliances do not end -P" },
  { kind: "regex", token: "fpr-standard-asa", re: /^FPR\d{4}-ASA$/, probe: "FPR2100-ASA",
    klass: "license", why: "'Cisco Firepower 2100 Standard ASA License'; 3. FPR2110-ASA-K9 (an appliance) carries -K9 and does not match" },
  { kind: "regex", token: "fpr-platform-licence", re: /^FPR\dK-(?:(?:ASA|FTD)-CAR|ASASC-|(?:TD-)?ENC-K9|ASA-PU-)/, probe: "FPR4K-ASA-PU-K9",
    klass: "license", why: "Firepower platform licence: carrier, security context, encryption, ASA platform upgrade (FPR2K-ASASC-5, FPR4K-ENC-K9); 15" },
  { kind: "exact", token: "FPR9K-TD-BASE", klass: "license", why: "'Threat Defense base licence for the 9300'; the platform rule's one sibling outside its shape" },
  // Carrier and security-context licences on the ASA and FTD families outside the FPR#K- shape above.
  { kind: "regex", token: "carrier-context-licence", re: /-(?:ASA|FTD)-CAR$|-ASASC-\d+$/, probe: "ASA5555-ASASC-10",
    klass: "license", why: "ASA / FTD carrier or security-context licence ('ASA 5555-X 10 Security Contexts'); security only" },
  // OPEN QUESTION (survey 2): a Threat Defense Virtual tier is an image or a performance licence. Software is
  // the conservative answer: either way it is not hardware, and nothing is lost if the operator says licence.
  { kind: "regex", token: "ftdv-tier", re: /^FTDV\d+$/, probe: "FTDV10",
    klass: "software", why: "Threat Defense Virtual performance tier ('Cisco FTDv10'); 6, security only" },
  { kind: "prefix", token: "FWM-", klass: "license", why: "'Cloud Management for FPR1010' / 'Cloud Management and Logging for FTDv10'; 127, security only" },
  { kind: "prefix", token: "CDO-", klass: "license", why: "Cisco Defense Orchestrator / Security Cloud Control device licence ('SCC Firewall Device license'); 38, security only" },
  { kind: "regex", token: "fmc-software", re: /^FMC-(?:\d{3,4}-)?\d+\.\d/, probe: "FMC-6.0.1-K9",
    klass: "software", why: "'Cisco Firepower Management Center Software v6.0.1'; 3. FMC1000-K9 and FMC-M5-CPU-4110 carry no release and do not match" },
  // IOS SSL VPN feature licences — routers' feature, filed in security (a category move is a PROPOSAL, not this).
  { kind: "prefix", token: "FL-SSLVPN", klass: "license", why: "'Cisco SSLVPN Feature Paper PAK - 100 users'; 6, security 5, routers 1" },
  { kind: "prefix", token: "FL-WEBVPN", klass: "license", why: "'Feature License IOS SSL VPN Up To 100 Users (Incremental)'; 6, security 5, routers 1" },
  // AMP / virtual-appliance subscriptions. The one software member is exact and first.
  { kind: "exact", token: "FP-AMP-CLOUD-SW", klass: "software", why: "'Secure Endpoint Private Cloud Virtual Appliance' — the image, not a subscription" },
  { kind: "prefix", token: "FP-VMW-", klass: "license", why: "NGIPS Virtual / AMP virtual subscription (FP-VMW-AMP-1Y); 13, security only" },
  { kind: "prefix", token: "FP-AMP-", klass: "license", why: "AMP for Networks subscription (FP-AMP-1Y-S3); 69, security only. Not bare FP-: FP-PWR-DC-650W is a PSU" },
  // Secure Client (AnyConnect) and ASA VPN licences. The 18 appliance BUNDLES in the same series (ASA5505-SSL10-K8
  // "ASA 5505 VPN Edition w/ 10 SSL Users", ASA5512VPN-PM25K9) carry the model first and match none of these.
  { kind: "prefix", token: "ASA-AC-M-", klass: "license", why: "'AnyConnect Mobile - ASA 5580'; security only" },
  { kind: "prefix", token: "ASA-AC-PH-", klass: "license", why: "'AnyConnect VPN Phone License - ASA 5525-X'; 24, security only" },
  { kind: "prefix", token: "ASA-FPS-", klass: "license", why: "ASA FirePOWER services subscription; 24, security only" },
  { kind: "prefix", token: "ASA-VPNP-", klass: "license", why: "'Premium Shared VPN Participant License - ASA 5580'; 22" },
  { kind: "prefix", token: "ASA-VPNS-", klass: "license", why: "'Premium Shared VPN Server License - 50K users'; 22" },
  { kind: "prefix", token: "ASA5500-SSL-", klass: "license", why: "ASA 5500 SSL VPN user licence; 22" },
  { kind: "prefix", token: "ASA-SSL-", klass: "license", why: "'ASA 5500 SSL VPN 100 to 250 Premium User License Option'; 21" },
  { kind: "prefix", token: "ASA-VPN-FL-", klass: "license", why: "ASA VPN feature licence; 6" },
  { kind: "prefix", token: "ASA-UC-", klass: "license", why: "'ASA 5500 UC Proxy 50 Session License'; 17" },
  { kind: "prefix", token: "ASA-ADV-END", klass: "license", why: "AnyConnect advanced endpoint assessment licence; 2" },
  // The probe is the UNTERMED member on purpose. All 12 termed ones (ASA5555-BOT-1YR) are claimed
  // first by firewall-term-subscription above — same class, different reason — so a termed probe
  // reported this rule "shadowed into never firing" when it is in fact the only rule that can
  // reach ASA5585-BOT-FIL, which carries no term and no year.
  { kind: "regex", token: "asa-botnet-term", re: /^ASA\d{4}-BOT-/, probe: "ASA5585-BOT-FIL",
    klass: "license", why: "ASA Botnet Traffic Filter licence; 13 matched, 1 newly decided (ASA5585-BOT-FIL) — the other 12 carry a term and are taken by firewall-term-subscription" },
  { kind: "prefix", token: "CVPN-", klass: "software", why: "Cisco Secure Desktop / VPN client software ('Cisco Secure Desktop 3.4.x'); 14" },
  // Security Manager licences, ordered before release-dot below, which would otherwise claim them as software.
  { kind: "regex", token: "csm-licence", re: /^CSM(?:ST|PR|P)\d+-|^CSMSTPR-U-|^CSMUCS\d+-|^CSM\d+-\d+-W20/, probe: "CSMPR50-4.8-K9",
    klass: "license", why: "'Cisco Security Manager 4.8 Professional - 50 Device License'; 222. CSM-PSU-650W, CSM-CPU-E5-2640 and CSM4-UCS2-150-HW do not match" },
  { kind: "regex", token: "csm-ucs-software", re: /^CSM4-UCS2-\d+-SW/, probe: "CSM4-UCS2-50-SW-47",
    klass: "license", why: "'CSM 4.7 on Windows 2012 R2 Standard - 50 device license'; the -SW half of the CSM UCS bundles. The -HW / -K9 halves are servers" },
  // Cloud security subscriptions, one prefix per product line; every one security-only unless named.
  ...[
    ["KENNA-", "Vulnerability Management (Kenna)"], ["XDR-", "XDR"], ["SAL-", "Security Analytics and Logging"],
    ["SEC-", "Security Analytics / logging / SVP bundle ('Data Retention 3 Year Extension Pack - GB/day')"],
    ["SELA-", "Secure Cloud Analytics enterprise agreement"], ["SWATCHC-", "Stealthwatch Cloud"], ["ST-CL-", "Stealthwatch Cloud"],
    ["SWATCH-CL-", "Stealthwatch Cloud"], ["AWS-CPPO-", "AWS private offer of a security subscription"], ["LICOA-", "licence allocation"],
    ["MCD-", "Defense Center managed-content subscription"], ["CSAM-", "IntelliShield / attack-surface subscription"],
    ["CPT-SEC-", "Cloud Protection Suite"], ["CLDPRT-", "Cloud Protection Suite"], ["SA-", "Secure Access (SaaS)"],
    ["E3-SEC-", "Security Choice EA 3"], ["E2F-", "Security Choice EA 2.0 ('Cisco Security Choice 2.0 SAL')"], ["TG-CL-", "Threat Grid cloud"],
    ["H-ES", "Hybrid Email Security ('Hyb ESA,AMP,TG-Prem File Anlys 200/Day 3Y')"], ["CES-", "Cloud Email Security"],
  ].map(([token, what]) => ({ kind: "prefix" as const, token, klass: "license" as const, why: `${what} subscription; security only, 0 physical facts` })),
  // UMB- reaches routers: four Umbrella subscriptions (UMB-PROFESSIONAL "Cisco Umbrella Professional.") sit there.
  { kind: "prefix", token: "UMB-", klass: "license", why: "Umbrella subscription ('Umbrella Investigate Console and API - Tier 3'); 35, security 31, routers 4" },
  { kind: "exact", token: "SCA-INS", klass: "license", why: "'Cisco Attack Surface Management License'" },
  { kind: "regex", token: "tg-software", re: /^TG\d{4}-SW-K9$/, probe: "TG5504-SW-K9",
    klass: "software", why: "'Threat Grid Software for M5'; 4. TG5504-K9 'Threat Grid 5504 Model Hardware' does not match" },
  { kind: "prefix", token: "FS-KVM-", klass: "software", why: "virtual FireSIGHT / FMC for KVM (FS-KVM-SW-K9); 3" },
  // Cisco ONE service-contract tracking subscriptions ("Cisco ONE Subscription - Service Contract Tracking 1-Yr
  // for Firepower 9300 SM44"). Reaches one servers row (C1-1Y-UCD-1-K9, already licence). Bare C1- stays refused.
  { kind: "regex", token: "c1-term-tracking", re: /^C1-\dY-/, probe: "C1-1Y-FPR9K-44-TMC",
    klass: "license", why: "Cisco ONE term subscription tracker; 7, security 6, servers 1 (already licence)" },
  { kind: "prefix", token: "C1-LC", klass: "license", why: "Cisco ONE Lancope (Stealthwatch) licence; security only" },
  { kind: "prefix", token: "C1-FPR", klass: "license", why: "Cisco ONE Firepower licence; security only" },
  { kind: "prefix", token: "N1K-ASA1K-", klass: "license", why: "'Nexus 1000V and ASA 1000V Paper CPU License Qty 16'; 12, security only" },
  { kind: "prefix", token: "N1K-VLCPU-", klass: "license", why: "'Nexus 1000V Adv Ed Paper Multi-Hypervisor License Qty 16'; 4, security only (a category defect as well)" },
  // Prime Cable Provisioning licences. Reaches cloud-systems-management (14, classed software by that category's
  // fallback — "Managed Device License", "Base License": licences, so they move software -> license on reclassify)
  // and unified-communications (1).
  { kind: "prefix", token: "PCP-", klass: "license", why: "'Prime Cable Provisioning 5.3 Base License'; 24, security 9, cloud-systems-management 14, unified-communications 1" },
  // Class-residue survey, small families (every shape read there).
  { kind: "prefix", token: "ASA5505-SW-", klass: "license", why: "ASA 5505 user / feature licence; 6" },
  { kind: "regex", token: "asa-media-engine", re: /^ASA55\d\d-ME-/, probe: "ASA5555-ME-1K",
    klass: "license", why: "ASA Intercompany Media Engine licence; 16" },
  { kind: "prefix", token: "ASA1000V-", klass: "license", why: "ASA 1000V cloud firewall licence; 10" },
  // (?:-|$), not just -: the bare tier rows CV-A and CV-E ("Cisco CV-A") are the same licences with no size.
  // CV-S / CV-L in optical-networking (ONS 15454) are neither and cannot match.
  { kind: "regex", token: "cyber-vision-tier", re: /^CV-(?:[EA]|IDS)(?:-|$)/, probe: "CV-E-100",
    klass: "license", why: "'Cyber Vision Essentials License for 100 endpoints'; 24. Bare CV- refused: CV-CNTR-M8N is the Center appliance" },
  // Threat Defense Virtual subscriptions by tier and feature: FTD-V-30S-T (Threat), -TC, -TMC, -URL, -AMP, -BSE-K9
  // (base). 42 rows, every name only the SKU; the feature codes are Cisco's subscription letters, the same ones the
  // threat-licence rule reads on hardware models.
  { kind: "regex", token: "ftdv-subscription", re: /^FTD-V-\d+S-/, probe: "FTD-V-30S-TMC",
    klass: "license", why: "Threat Defense Virtual tier subscription (FTD-V-100S-TMC); 42, security only" },
  // Lancope-era Stealthwatch SERVICES: "StealthWatch Training.", "Installation services recommended for purchase
  // with the FC5K", "Service for Initial Installation" (sic). The appliances in the same LC- family are hardware.
  // WIDENED 12 Sep 2026: the catalogue spells the same service four ways and the first three-token form reached
  // only one of them. LC-INITIAL= ("Service for Initial Installation") is the CORRECTLY spelled twin of LC-INTIAL,
  // LC-SYSTINSTALL is "Stealthwatch System Integration Services" and LC-CHECKTUNE is "Health Check and Tuning".
  // All six are services; none carries a fact. LC-AUTOMATION / LC-PROXY / LC-TOKEN are licences, below.
  { kind: "regex", token: "stealthwatch-service", re: /^LC-(?:TRAINING|INSTALL|INTIAL|INITIAL|SYSTINSTALL|CHECKTUNE)/, probe: "LC-TRAINING",
    klass: "service", why: "Stealthwatch training / installation / health-check service; 6, security only" },
  // ASR 9000 line-card L3VPN licences filed in "Security Manager" ("L3 VPN License for 24X10GE Linecard Service
  // Edge Optimized"). Reaches routers (36, the same licences in their home category). Scoped to A9K- and the
  // -AIP-SE/-TR tail: the bare A9K- prefix holds 15 physical-fact line cards (A9K-MOD400-SE) and cannot match.
  // REMOVED 12 Sep 2026: "a9k-aip-licence" decided ZERO of the 91,543 live parts — every row it matches is
  // already decided, to the same class, by an older rule. Measured over the catalogue, not over its
  // probe: judging the probe alone is what briefly deleted asr-paper-pak, which decides SLFL-ASR1=.
  { kind: "regex", token: "stealthwatch-collection-licence", re: /^LC-(?:FPS|SLIC)/, probe: "LC-FPS-1K-RED",
    klass: "license", why: "'Redundant StealthWatch Collection License, 1K'; 24. Bare LC- refused: LC-FC-PWR-AC-1200W is a PSU" },
  { kind: "prefix", token: "FPR-RVDP-", klass: "license", why: "Firepower RVDP subscription; 6" },
  { kind: "regex", token: "ips-vpn-licence", re: /^(?:FP|AMP)\d{4}-VPN-K9$/, probe: "FP8250-VPN-K9",
    klass: "license", why: "FirePOWER / AMP appliance VPN licence; 26. FP8250-K9 (the appliance) does not match" },
  { kind: "prefix", token: "R-ISE-", klass: "license", why: "ISE virtual-machine / bundle e-delivery licence ('Cisco ISE Virtual Machine Large'); 16" },
  { kind: "regex", token: "term-user-band", re: /-\d{1,2}Y-S\d{1,2}$/, probe: "WSA-WSS-1Y-S1",
    klass: "license", why: "term plus user-band tier (WSA-WSS-1Y-S1, ESA-ESP-3Y-S2); 2,684 matched, 270 newly decided, all security" },
  { kind: "prefix", token: "ASA5500-SW-", klass: "software", why: "ASA 5500 client / desktop software (ASA5500-SW-CSD-K9)" },
  { kind: "prefix", token: "BAC-", klass: "license", why: "'BAC 10,000 subscriber service license' (Broadband Access Center); 3, security only — a category defect as well" },
  { kind: "regex", token: "webex-meetings-server-kit", re: /^(?:R-)?WBXMTSVR/, probe: "WBXMTSVR2-K9",
    klass: "software", why: "'Webex Meetings Server 2.x Software Kit' and its e-delivery twin; 3, security only — a category defect as well" },
  { kind: "prefix", token: "WMSVR", klass: "software", why: "'MTGS SRVR Upgrade - Phys Del - Standard Encryption' (Webex Meetings Server upgrade kit); 2, security only" },
  // Prime Security Manager: the device licences and the eDelivery software. PRSM-HW1-25-K9 "Prime Security
  // Manager - HW C220M3" is the appliance, which is why the bare PRSM prefix is refused.
  { kind: "prefix", token: "PRSM-DEV-", klass: "license", why: "'PRSM - License - Manage 10 Additional Devices'; 3" },
  { kind: "regex", token: "prsm-software", re: /^(?:R-)?PRSMV\d+-SW-/, probe: "PRSMV9-SW-5-PR",
    klass: "software", why: "'Prime Security Manager - SW(eDelivery) - 10 Device Manager'; 4. PRSM-HW1-25-K9 does not match" },
  // Stealthwatch appliance upgrade / conversion licences ("StealthWatch FlowCollector Upgrade from VE to 2010").
  // Anchored to the upgrade tail: LC-FC-PWR-AC-1200W (a PSU) and LC-FS4010 (a flow sensor) cannot match.
  { kind: "regex", token: "stealthwatch-upgrade-licence", re: /^LC-(?:FC|SMC|FS|UDP)-\d{4}-(?:U\d?|NFU|CV)-K9$/, probe: "LC-FC-2010-U-K9",
    klass: "license", why: "'FC 1010 upgrade to FC 2010', 'Conversion to Stealthwatch 1010 from SW VE'; security only" },
  { kind: "regex", token: "cyber-vision-software", re: /^CV-CNTR-[A-Z0-9]+-SW$/, probe: "CV-CNTR-M6N-SW",
    klass: "software", why: "'Cyber Vision Center M6N Software'. CV-CNTR-M8N (the Center appliance) carries no -SW and does not match" },
  { kind: "regex", token: "ise-software-image", re: /^ISESW\d+-/, probe: "ISESW114-3415-M-K9",
    klass: "software", why: "'Cisco Identity Services Engine software version 1.1.4' for an SNS appliance; 2" },
  // Nexus 7000 / 7700 FCoE licences filed in security ("FCoE License for Nexus 7000 32-port 10G SFP+ (F1), Spare").
  { kind: "regex", token: "nexus-fcoe-licence", re: /^N7[7K]-FCOE/, probe: "N7K-FCOEF132XP",
    klass: "license", why: "'FCoE License for Nexus 7700 48-port 10G SFP+ (F2E)'; 2, security only — a category defect as well" },
  // Singletons whose own name says licence or software and whose shape has no family (class-residue §C).
  ...[
    // (ASA5506H-SEC-PL stood here and was removed 12 Sep 2026: asa-security-plus above already
    //  reaches it through its `H?`, so the singleton was a rule that could never fire.)
    ["ASA-SW-UPGRADE", "license"], ["FPR2K-EXCLUDE-SUBS", "license"],
    // (ISA-FTD6.6-K9 stood here and became the isa-ftd-image regex below, which also reaches ISA-FTD7.0-K9.)
    ["FPR-SEC-TERM", "license"], ["IPS-SW-7.1", "software"],
    ["SCPS-BASE-K9", "software"], ["SCMS-BASE-K9", "software"], ["SECURE-WORKLOAD-V", "software"],
    // (P-CDV-CIS-6.2-NFR stood here and was removed 12 Sep 2026: the cdv-nfr rule below reaches both
    //  it and CDV-CIS-7.0-NFR, so the singleton could never fire.)
    ["CTS-SATELLITE", "license"], ["ESS-2020-L-B", "license"], ["SS-EX-K9-1", "license"],
    ["ASA5585-NETW4UP3", "license"], ["R-SS-EX-K9-1", "license"], ["C1-TAAS-ENDPT-K9", "license"],
  ].map(([token, klass]) => ({ kind: "exact" as const, token, klass: klass as ProductClass, why: "a singleton whose own name says it is a licence or software (security class residue §C)" })),
  // LAST, because they reach furthest outside security (every hit read; see the report): a release number in the
  // SKU, and the -SW-K9 image suffix. Unified-communications, routers, interfaces-modules, wireless, switches and
  // conferencing rows they reach are all software ("CUCM Software Version 9.0", "Cisco NAM 5.1 for Appliances").
  { kind: "regex", token: "release-in-sku", re: /-\d+\.\d+(?:\.\d+)*(?:-[A-Z]+)?-K\d$/, probe: "ASA-9.12-K9",
    klass: "software", why: "software release in the SKU ('ESA Async OS v14.0'); 727 matched, security 407, unified-communications 23, routers 14" },
  { kind: "suffix", token: "-SW-K9", klass: "software", why: "'Threat Grid Software for M5', 'AMPPC-SW-K9', 'ER 12.0 Server Software'; 105 matched" },
  // ---- security round 2 (12 Sep 2026): the FOREIGN PAPER LICENCES filed in "Security Manager" -----------
  // Appended at the very END of the table so no row an earlier rule decided changes its reason.
  //
  // The survey (evidence/security-servers-series-survey.md §d) counted "about 141" hardware-classed rows in
  // the "Security Manager" series that are other products' paper licences — ASR 1000 feature PAKs, CRS-X
  // scale licences, MDS packages, WAAS appliance licences, UC enterprise agreements. They are the wrong
  // CATEGORY as well as the wrong class (a category move is a PROPOSAL, not this), and they were the whole
  // reason the `appliance` kind held 91 "Security Manager" rows: each was being asked a box's dimensions,
  // weight, power draw and certifications, plus `storage_capacity`, because its series is in SEC_MGMT.
  //
  // Every family below was listed IN FULL by shape before being written (57 shapes for the ASR PAKs, 13 for
  // FL-), and every rule matches ZERO parts carrying an own physical fact. Counts are catalogue-wide.
  //
  // THESE REACH OTHER CATEGORIES BY DESIGN AND THE COUNTS ARE IN THE REPORT: the same paper PAK sits in
  // `routers`, `unified-communications` and `interfaces-modules` under the same PID spellings, so no SKU
  // pattern can separate them — and in those categories it is the same licence, classed hardware for the
  // same reason. docs/reports/schema-security-2026-09-12.md names the per-category counts so the routers and
  // UC owners can check the rows this decides for them.
  //
  // ASR 1000 / ASR 900 technology and feature PAKs: FL/SL + SASR/ASR + model + feature. "Paper PAK",
  // "Feature Lic", "RTU", "Sessions", "Upgrade" — 180 parts, 57 shapes, every one read.
  // `^FLSA1-` is the fourth spelling of the same thing ("Upgrade from 10Gbps to 36Gbps Paper PAK for ASR
  // 1002-X", "ASR 1000 per 1GE port MACsec license") — 51 parts, 44 of them in routers, all licences.
  { kind: "regex", token: "asr-paper-pak", re: /^(?:FL|SL)(?:SASR|ASR)\d{0,4}[A-Z0-9]*-|^SLFL-ASR|^FLSA1-/, probe: "SLFL-ASR1=",
    klass: "license", why: "probe is a row this rule DECIDES (SLFL-ASR1=); the token alone is shadowed by an older rule. ASR 1000 / 900 technology or feature Paper PAK ('Lawful Intercept Paper PAK for ASR1000 Series'); 231 matched, security 47, routers 151, unified-communications 33" },
  // ISR / 800-series feature licences under FL-, kept to the sub-families whose every member was read: the
  // bare FL- prefix is NOT taken (FL-SRST-, FL-CCME-, FL-SSLVPN, FL-WEBVPN are already separate rules above).
  // REMOVED 12 Sep 2026: "fl-feature-licence" decided ZERO of the 91,543 live parts — every row it matches is
  // already decided, to the same class, by an older rule. Measured over the catalogue, not over its
  // probe: judging the probe alone is what briefly deleted asr-paper-pak, which decides SLFL-ASR1=.
  // CRS / CRS-X scale and NAT licences. LCBASE is EXCLUDED: "Cisco IOS-XR Line Card Base Software" is a
  // software image, not a licence, and XC-RP-PX-05.01 is one too — both keep the fallback rather than being
  // given the wrong non-hardware class.
  // REMOVED 12 Sep 2026: "crs-scale-licence" decided ZERO of the 91,543 live parts — every row it matches is
  // already decided, to the same class, by an older rule. Measured over the catalogue, not over its
  // probe: judging the probe alone is what briefly deleted asr-paper-pak, which decides SLFL-ASR1=.
  // MDS Data Mobility Manager and Storage Media Encryption packages. Anchored to the three feature tokens:
  // the bare M9#### prefix holds NX-OS system IMAGES (M92S7K9-9.3.2A) and real switches.
  // REMOVED 12 Sep 2026: "mds-feature-package" decided ZERO of the 91,543 live parts — every row it matches is
  // already decided, to the same class, by an older rule. Measured over the catalogue, not over its
  // probe: judging the probe alone is what briefly deleted asr-paper-pak, which decides SLFL-ASR1=.
  // REMOVED 12 Sep 2026: "waas-appliance-licence" decided ZERO of the 91,543 live parts — every row it matches is
  // already decided, to the same class, by an older rule. Measured over the catalogue, not over its
  // probe: judging the probe alone is what briefly deleted asr-paper-pak, which decides SLFL-ASR1=.
  // ASR 920 port and feature licences. Anchored to the feature tokens because ASR920-PWR-BLANK is a power
  // supply blank cover — a real accessory — and the bare prefix would take it.
  { kind: "regex", token: "asr920-licence", re: /^ASR920-(?:IPSEC|GNSS|\d{1,2}G-\d)/, probe: "ASR920-IPSEC",
    klass: "license", why: "ASR 920 port / IPSec / GNSS licence; 13 matched, security 3, routers 10. ASR920-PWR-BLANK cannot match" },
  // Enterprise-agreement "Top Level" rows for UC products, filed in security.
  { kind: "regex", token: "ea-top-level", re: /^(?:R-)?(?:JABBER-ADDON|EA-WBX|HCSLE-)/, probe: "EA-WBX-CNF-K9",
    klass: "license", why: "'Enterprise Agreement WebEx Conferencing Suite - Top Level', 'HCS for Large Enterprise EA Top Level'; 6 matched, security 5, unified-communications 1" },
  // REMOVED 12 Sep 2026: "CUWL-STD-K9" decided ZERO of the 91,543 live parts — every row it matches is
  // already decided, to the same class, by an older rule. Measured over the catalogue, not over its
  // probe: judging the probe alone is what briefly deleted asr-paper-pak, which decides SLFL-ASR1=.
  // Prime Network Registrar ordering PIDs: "Physical Delivery PID (DCT Ordering Use Only)". The e-delivery
  // twins in cloud-systems-management are already software.
  { kind: "regex", token: "prime-registrar-pid", re: /^(?:R-)?(?:PRIME-NWK-REG|NETREG-)/, probe: "PRIME-NWK-REG",
    klass: "license", why: "'Cisco Prime Network Registrar PID (DCT Ordering Use Only)'; 6 matched, security 4, cloud-systems-management 2 (already software)" },
  // The e-delivery halves of four security software bundles whose physical halves are exact rules above
  // (SCPS-BASE-K9, SCMS-BASE-K9, WMSVR, MP-WMS-MIG-K9=).
  { kind: "regex", token: "r-security-edelivery", re: /^R-(?:SCPS|SCMS|WMSVR|MP-WMS)/, probe: "R-SCPS-BASE-K9",
    klass: "software", why: "e-delivery twin of a Smart Connected Spaces / Webex Meetings Server bundle; 5, security only" },
  { kind: "prefix", token: "MP-WMS-", klass: "software", why: "'MP to MTGS SRVR- Phys Deliv -Standard Encrypt' (Webex Meetings Server migration kit); 1, security only" },
  // Cisco Digital Video NFR licences, physical and electronic delivery. Replaces the P-CDV-CIS-6.2-NFR
  // singleton, which this shadows.
  { kind: "regex", token: "cdv-nfr", re: /^(?:P-)?CDV-CIS-/, probe: "CDV-CIS-7.0-NFR",
    klass: "license", why: "'Physical Delivery - Cisco DV-CIS Not For Resale Lic - 1 Yr T'; 2, security only" },
  { kind: "prefix", token: "CDAVLT-", klass: "license", why: "'Vault upgrade, additional hours SD'; 1, security only" },
  { kind: "prefix", token: "PRM-WAAS-", klass: "license", why: "'WAAS Coupon: Microsoft-Licensed Windows Media Live Streaming'; 1, security only" },
  { kind: "prefix", token: "CSP-TPEX-", klass: "license", why: "'CUBE(SP) TP Session Paper PAK for ASR1000 Series, redundant'; 1, security only" },
  { kind: "prefix", token: "CTIR-", klass: "service", why: "'Cisco Talos Incident Response Retainer-Small, Attach with NGFW' — a retainer, so service; 1, security only" },
  // Stealthwatch software FEATURES and the activation token, as against the SERVICES the widened
  // stealthwatch-service rule above takes.
  { kind: "regex", token: "stealthwatch-feature", re: /^LC-(?:AUTOMATION|PROXY|TOKEN)/, probe: "LC-AUTOMATION",
    klass: "license", why: "'Host Group Automation', 'Proxy Flow Adapter Integration', 'StealthWatch Activation Token'; 3, security only" },
  { kind: "exact", token: "CV-LICENSE", klass: "license", why: "'Cyber Vision subscription license *' — the tier rule needs a size and this row has none" },
  // Secure Workload (Tetration) software subscriptions. The HARDWARE bundles in the same family are refused:
  // C1-TETRATION and C1-TETRATION-M say "includes the hardware", and TA-CL-8U/39U-M6-K9 are Gen3 clusters.
  { kind: "regex", token: "workload-subscription", re: /^C1-TAAS?-|^C1-TA-(?:BASE|ENF|ENDPT|CWP)|^CSW-ONPRM/, probe: "C1-TA-ENDPT-K9",
    klass: "license", why: "Secure Workload / Tetration software subscription ('TA Base Software License 1K servers'); 12 matched, security 7, data-center-analytics 5 (stored software: they move software -> license on reclassify)" },
  // The virtual Threat Defense tiers spelled with a lower-case c ("Cisco FTDc10"). Same product family as
  // FTDV#, so the same class; the SKU is upper-cased before matching, hence FTD[VC].
  { kind: "regex", token: "ftdc-tier", re: /^FTDC\d+$/, probe: "FTDC10",
    klass: "software", why: "'Cisco FTDc10' — the c-spelled virtual Threat Defense tier beside FTDv10; 6, security only" },
  { kind: "exact", token: "FP9K-OPT-OUT", klass: "non_product", why: "'Opt out of SVP FirePOWER 9K selection' — an ordering option that ships nothing" },
  { kind: "prefix", token: "AC-NAMFIPS-", klass: "license", why: "'3eTI FIPS Drivers for AnyConnect Network Access Manager' and its seat-count row; 2, security only" },
  // The ISA 3000's Threat Defense image, both releases. Replaces the ISA-FTD6.6-K9 singleton, whose twin
  // ISA-FTD7.0-K9 carries no name of its own ("Cisco ISA-FTD7.0-K9") and was left as hardware by it.
  { kind: "regex", token: "isa-ftd-image", re: /^ISA-FTD\d/, probe: "ISA-FTD6.6-K9",
    klass: "software", why: "'Cisco FTD unified software v6.6 for ISA3000'; 2, security only. ISA-3000-2C2F-K9 (the appliance) does not match" },

  // ===== modules-misc (12 Sep 2026) =============================================================
  // The class residue of `interfaces-modules` (1,364 hardware rows), `meraki` (283) and
  // `data-center-networking` (33). EVERY rule below was gated across the whole catalogue — 91,682
  // parts, 13 vendors — and refused unless it touched ZERO parts carrying an own PHYSICAL fact;
  // the matches were then read in full. Counts are from that gate, not from my own category.
  //
  // CHECKED AGAINST THE OTHER AGENTS' ANNOUNCED RULES FIRST. Five of my rows are already reached,
  // so no rule is written for them: SF-ASA-CSC-6.0-K9 by security's `SF-`; FL-29-SNA, FL-39-SNA,
  // FL-29/39/39E-HSEC-K9, FL-C1921-WAASX and FL-GK-* (11 rows) by routers' `^FL-(?!8XX-)`;
  // WAAS-ENT/TRN/VIDEO-SM-* (6) by routers' `WAAS-`; and UCS-FI-*-SW may be reached by the servers
  // agent's UCS rules. Three COLLISIONS with those rules are in the report's proposals, because
  // each would misclass a real part: `-SMS` would take 7300-1OC48POS-SMS (a 7304 OC-48 POS LINE
  // CARD — SM-S is single-mode short reach); `^FL-` would take FL-1900-256U512MB (a CISCO1905 DRAM
  // upgrade carrying its own `dram` fact); `WAAS-` would take WAAS-VB-NAM-5.1 (NAM SOFTWARE, so the
  // class is right but the kind of non-hardware is wrong).
  //
  // --- license ---------------------------------------------------------------------------------
  { kind: "regex", token: "c4500e-feature-license", re: /^C4500E-(?:IPB|IP-ES|LB|LB-ES)(?:-S)?$/, probe: "C4500E-IPB-S",
    klass: "license", why: "Catalyst 4500E feature licence ('IP BASE software license', 'LAN BASE to Enterprise Services upgrade license (paper delivery)'); 6 parts, all Cisco, all interfaces-modules, 0 own facts. Two of them carry an INHERITED ipv6_routes 128000 — a retraction proposal in the report" },
  { kind: "prefix", token: "ASA5500-SC-", klass: "license", why: "ASA 5500 security-CONTEXT licence ('ASA 5500 100 Security Contexts License'); 15 parts, 0 facts. Not the bare ASA5500- prefix: ASA5505/5510/5520/5540-* are appliance bundles with real facts" },
  { kind: "prefix", token: "ASA-SC-", klass: "license", why: "the upgrade form of the same ('ASA 5500 50 to 100 Security Context License Upgrade'); 2 parts, 0 facts. Distinct from the existing ASA-CSC rule, which is the content-security user licence" },
  { kind: "prefix", token: "ASA5500-GTP", klass: "license", why: "ASA GTP inspection licence; 2 parts, 0 facts, name is the SKU" },
  { kind: "prefix", token: "SNAM-", klass: "license", why: "NAM voice-monitoring licence ('Voice Monitoring SW License, 100 RTP Streams'); 4 parts, 0 facts" },
  { kind: "prefix", token: "SLFL-", klass: "license", why: "ISR feature Paper PAK ('Technology and Feature Paper PAKs for Cisco 2900'); 3 parts (2 interfaces-modules, 1 security), 0 facts. `SL-` is already a licence prefix and does not reach these — there is no hyphen" },
  { kind: "prefix", token: "FR-SVC-WVPN-", klass: "license", why: "'Cisco Catalyst 6500 and Cisco 7600 WebVPN 5000 user license'; 2 parts, 0 own facts" },
  // NARROWED DELIBERATELY. The natural pattern (/^M9\d{2,3}[A-Z0-9]*K9$/) reaches 80 MDS licence
  // rows, 74 of them in `storage-networking` — another agent's category. Every one of the 80 was
  // read and every name says "License" or "Package", so the wide rule would be CORRECT; it is
  // still not mine to write. This covers the 13 rows in my category plus the two `storage-networking`
  // siblings of L5-D-M97S-AXK9 (its 1-year twin), which the same rule cannot avoid and which are
  // the same product. The other 65 are listed in the report for the optical-storage agent.
  // REMOVED 12 Sep 2026: "mds-feature-license" decided ZERO of the 91,543 live parts. Its three target
  // rows exist and are all reached first by mds-licence / mds-analytics-term, to the same class.
  { kind: "prefix", token: "SWLIC-", klass: "license", why: "a licence that must be ordered with a named carrier card ('1 DS license: Must configure with SPA-UBR10-DS-HD only'); 17 parts — 1 interfaces-modules, 16 the RFGW QAM licences in `video` — 0 facts, every name reads 'LICENSE: MUST CONFIGURE WITH …'" },
  { kind: "regex", token: "ace30-upgrade-entitlement", re: /^ACE30-(?:MOD-UPG\d|UPG-\d+)/, probe: "ACE30-MOD-UPG1",
    klass: "license", why: "ACE30 throughput/feature upgrade entitlement ('Upgrade 4G 1GComp 1KSSL 5VC to 4G 4GComp 30KSSL 250VC', 'ACE10 or ACE20 to ACE30 Upgrade for 8 Gbps Throughput'); 6 parts, 0 facts. NOT ACE30-MOD-*-K9 or ACE30-BASE-*, which are the real modules" },
  { kind: "regex", token: "meraki-term-license", re: /^MG\d+E?-ENT-\d+Y$/, probe: "MG21-ENT-5Y",
    klass: "license", why: "Meraki MG Enterprise term licence (MG21/MG41/MG51/MG52 x 1/3/5/7/10 years); 20 parts, all meraki, 0 facts. Anchored on the YEAR TAIL: MG21-HW-NA and MG21E are the gateways and do not match" },
  { kind: "regex", token: "hyperfabric-subscription", re: /^HF\d+-[A-Z0-9]+-SVC(?:-[DS])?$/, probe: "HF6100-32D-SVC",
    klass: "license", why: "Nexus Hyperfabric subscription ('subscription only', 'subscription linked bundle'); 8 parts, all data-center-networking, 0 facts. The -D and -S rows WITHOUT -SVC are 'configurable/fixed hardware only' and are the refusals" },
  { kind: "regex", token: "ucs-fi-mandatory-sw-license", re: /^UCSX?-FI-\d+-SW$/, probe: "UCS-FI-6652-SW",
    klass: "license", why: "'Auto included mandatory perpetual software license' sold with a UCS fabric interconnect; 3 parts (2 interfaces-modules, 1 servers-unified-computing), 0 own physical facts. May overlap the servers agent's UCS rules — same class either way, and first match wins" },
  // --- software --------------------------------------------------------------------------------
  { kind: "regex", token: "nam-software-image", re: /^(?:NAM-APPL-SW|NME-NAM-SW|SM-NAM-SW|SC-SVC-NAM|N1K-C1\d+-?NAM)/, probe: "NAM-APPL-SW-5.1",
    klass: "software", why: "Network Analysis Module software image ('Cisco NAM 5.1 for Appliances w/Recovery CD', 'NAM Virtual Service Blade Software 4.2 for C1010'); 27 parts, all Cisco, 0 facts, all 27 read. The NAM HARDWARE is NAM2420-K9 / WS-SVC-NAM3-6G-K9 / NME-NAM-120S and carries no -SW- token" },
  { kind: "regex", token: "sc6k-service-module-software", re: /^(?:R-)?SC6K-/, probe: "SC6K-A41-ACE",
    klass: "software", why: "Catalyst 6000 service-module software release ('ACE A4(1) Software Release', 'Catalyst 6000 NAM software release', 'EDelivery of 5.1 SW for ACE30 Module'); 8 parts, 0 facts" },
  { kind: "regex", token: "wvpn-module-software", re: /^SC-SVC-WVPN-\d/, probe: "SC-SVC-WVPN-11-K9",
    klass: "software", why: "'WebVPN Services Module Software 1.1'; 2 parts, 0 own physical facts. Distinct from security's FL-WEBVPN rule, which is the user entitlement" },
  { kind: "regex", token: "hyperfabric-nos-image", re: /^HF\d+-[A-Z0-9]+-NOS$/, probe: "HF6100-32D-NOS",
    klass: "software", why: "'Cisco Nexus Hyperfabric switch HF6100-32D software image'; 3 parts, 0 facts. switchKind calls them `switch`, so until now they were asked a switching capacity" },
  // --- non_product -----------------------------------------------------------------------------
  { kind: "regex", token: "ztd-cvo-config-option", re: /^(?:\d{4}-ZTD-CFG|CVO\d+-CFG)$/, probe: "2900-ZTD-CFG",
    klass: "non_product", why: "an ordering CONFIG option that ships nothing ('Zero-touch deployment default config for 29xx ISR', 'CVO Config for Cisco1900 ISR'); 5 parts (3 interfaces-modules, 2 routers), 0 facts" },
  { kind: "regex", token: "promo-bundle-not-orderable", re: /^CB-B\dG\d-|-CBW-BG\d$/, probe: "CB-B3G1-SG250-08HP",
    klass: "non_product", why: "a buy-N-get-one promotion, not a product ('Discount restricted SKU. Buy 3 SG250-08HP, Get 1 Free', 'Buy 1 SG220 Switch, Get 1 Free Access Point.'); 2 parts, 0 facts" },
  { kind: "exact", token: "AIR-RM3000L1-UXK9", klass: "non_product", why: "its entire name is 'DO NOT USE'; 1 part, 0 facts" },
  { kind: "regex", token: "army-booking-code", re: /^PA-A3-OC3(?:MM|SMI)-U$/, probe: "PA-A3-OC3MM-U",
    klass: "non_product", why: "'Product # to book US Army ATM Deluxe Order' — a booking code, not a port adapter; 2 parts, 0 facts. The real adapters are PA-A3-OC3MM / PA-A3-OC3SMI without the -U" },
  { kind: "regex", token: "literal-placeholder-in-sku", re: /X{3}[MF]$|^EDGE8-XXU$/, probe: "53-BB96-ALXXXM",
    klass: "non_product", why: "the SKU contains a literal placeholder for the length, so it cannot be ordered (53-BB96-ALxxxM, JE8E808GE8-NBxxxF, EDGE8-xxU); 9 parts, all interfaces-modules, 0 facts. REFUSED a wider /XXX[A-Z]$|-XXU$/: it reached 99 parts including ONS-SC-Z3-xxxx= and ONS-XC-10G-xxxx=, which carry OWN PHYSICAL facts — the existing `family-placeholder` rule handles the -xxx/-xxxx tail and this one only adds the glued-unit form" },
  // A DATASHEET CELL IS NOT A PRODUCT — the `QSFP28` lesson, at scale. 57 rows whose `name` is
  // "Cisco " + the SKU verbatim, each a value read out of a specification table: a standard
  // (G.652, TIA-568, OC-3/STM-1, 1000BASE-BX10-D), a fibre grade (OM4/OM5), a modulation (PAM4), a
  // FEC scheme (RS-FEC, CL91), a bit-error rate (1E-12), a connector (MPO-24), a reach code
  // (IR-1, SM-SR), a coherent mode (400G-400ZR-OFEC-16QAM), a software release (S3_8.10.10) or a
  // bare LENGTH (0.5M … 29.0M — 13 of these, and the 2.3M and 3.5M in servers are cable lengths).
  // ALL 57 WERE READ, one by one, across all 13 vendors: 0 carry a fact, 0 carry a document, and
  // every alternative is anchored to the WHOLE SKU, which is what keeps a real product out —
  // `SFP-10G-SR` is not `SR-1`, `CAB-...-MMF10M` is not `10M`, `OC48E/POS-LR-FC-B` is not `OC48`.
  { kind: "regex", token: "datasheet-cell-not-a-product",
    re: /^(?:\d+-F|1E-\d+|\d+(?:\.\d+)?M|G\.\d+|TIA-\d+|PAM\d|MPO-?\d+|OM\d(?:\/(?:OM)?\d)?|CL\d+|(?:RS|FC)-FEC|(?:IR|LR|SR)-\d|SM-(?:IR|SR)|OC-?\d+C?(?:\/STM-?\d+C?)?|\d+G-(?:\d+ZR|FOIC\d)-[A-Z0-9-]+|FOIC\d-OFEC-DP-DQPSK|\d+BASE-BX\d*-[DU]|3DES\/AES|S3_[\d.]+)$/,
    probe: "OC-3/STM-1", klass: "non_product",
    why: "a value enumerated out of a datasheet table as a part; 57 parts (46 currently hardware, 11 already unknown), 0 facts, 0 documents, every one read. 5 of them serve INHERITED facts today — OC-3, OC-12, OC-3/STM-1 and OC-12/STM-4 carry 3 each — which the report lists as a retraction" },
  // --- service ---------------------------------------------------------------------------------
  { kind: "regex", token: "isr-customization-service", re: /^C\d{4}ISR-CICS-S[A-Z]$/, probe: "C2900ISR-CICS-SL",
    klass: "service", why: "'Cisco Integrated Customization Services-2900 ISR (Silver)' — an engagement, not a product; 3 parts (2 interfaces-modules, 1 routers), 0 facts" },
  // ===== end modules-misc =======================================================================

  // collab-class (12 Sep 2026) — THE FALLBACK RESIDUE OF THE THREE COLLABORATION CATEGORIES.
  //
  // WHAT WAS MEASURED. After the block above and reclassify run 969, `unified-communications` still
  // held 2,193 parts classed hardware, and collabKind called 1,456 of them `unknown` — the kind that
  // asks nothing, so the wrong class was hidden rather than harmless. The reverse NAME control over
  // that bucket found 852 whose name says non-hardware outright (CM9.X-K9-LAB "SW CM 9.X Lab Only,
  // 20 CUWL PRO, 5 TP Room"), 496 whose name says nothing at all (R-CUCM-USR-LSC "Top Level UCL
  // SKU"), 82 named as software MEDIA KITS, and — the whole point of running the control — exactly
  // ONE family of real hardware: the 14 UNITY-PIMG / UNITY-TIMG PBX-IP media gateways, which are
  // vetoed here and given kind `gateway` in collabKind instead.
  //
  // METHOD, and it is the file's existing one. A name found each candidate family; the family was
  // then read IN FULL, every member, before a rule was written; and every rule below was re-measured
  // over ALL 91,543 live parts and ALL 13 vendors, not over the three categories that produced it.
  // THE GATE IS AN OWN PHYSICAL FACT: across the whole block, 1,917 rows are decided and NOT ONE
  // carries an own fact of any kind, physical or otherwise. Where a shape's members outside these
  // three categories are already non-hardware the shape is adopted whole (the rule only refines a
  // reason); where ONE such member is still classed `hardware` the shape is narrowed, because a
  // class decision in another category's lane is not this agent's to make — those are listed as
  // proposals in docs/reports/schema-collab-class-2026-09-12.md instead.
  //
  // REFUSED, each with the product it would have cost (all pinned in productClass.test.ts):
  //   `A-`        the bare prefix stays refused, as round 2 decided: 63 Arista parts start A-, and
  //               45 of them carry an own physical fact (A-D800-D800-7M, an AOC cable). EVERY Arista
  //               member has the form `A-<one letter><three digits>-`, so requiring TWO letters
  //               after the hyphen excludes the lot structurally rather than by a veto list.
  //   `R-`        441 parts in ten categories. 19 wireless and 2 switches rows classed hardware are
  //               Policy Suite / Prime NAM / ME3400 IOS images — someone else's defect, and they are
  //               SOFTWARE, not licences, so even the class would be wrong. Only the 84 rows whose
  //               second token names a UC application are taken (`uc-app-edelivery`).
  //   `C1-ASR1`   C1-ASR1001-HX/K9 is "ONE - ASR1001-HX, 4x10GE+4x1GE, 2x P/S" — a real ASR 1000
  //               chassis on the Cisco ONE order form. Only `C1-ASR1-CUBEE` is a session licence.
  //   `C1-FL`     C1-FLOW-IE4K ("ONE Netflow IE4000") carries 14 facts. The rule needs the hyphen.
  //   `CM\d`      CM8-UM08-04-E7G-ULL is an interfaces-modules part. Every one of the 95 CallManager
  //               version SKUs carries `-K9` or `-UCS-`; that one carries neither.
  //   `PC-1`      PC-1OC192-SON-XFP is a JUNIPER SONET PIC. Only the exact Prime SKUs are taken.
  //   `CTX-`      167 servers-unified-computing parts are CITRIX licences the servers agent owns.
  //               Only `CTX-...SERVICE`, the TelePresence Exchange fee, is taken.
  //   `VMW-`      346 servers parts. Only the four UC Virtualization forms are taken.
  //   `BE\d`      BE7K-NIC-M6 is "Cisco-Intel X710T4LG 4x10 GbE RJ45 PCIe NIC", 1 own physical fact.
  //               Only BE6K-/BE3K- and the BE6000 starter forms are taken.
  //   `/`         a slash looked like a "two serial numbers in one cell" marker; 1,314 parts contain
  //               one and 136 carry an own physical fact (routers, 736). Two exact rules instead.
  //   `^\d+\.\d`  499 parts, 107 with own facts, 389 of them in `video`. Exact rules instead.
  //   `ISR-CCP-`  four routers rows are the same Config Pro software and would be correctly moved —
  //               but that is the routers owner's call, so only the one UC row is taken by name.
  //   `MP[E\d]`   MP232-R is a servers part; the rule names the three MeetingPlace forms instead.
  //
  // Webex / cloud collaboration subscription. `A-` plus TWO letters: 1,214 parts, EVERY ONE Cisco,
  // ZERO facts of any kind, and no Arista member can reach it (see the refusal above).
  { kind: "regex", token: "webex-collab-subscription", re: /^A-[A-Z]{2}/, probe: "A-EPF-APP-T1",
    klass: "license", why: "Webex / Collaboration cloud subscription (A-EPF-APP-T1 'Webex Events App (formerly Socio) 0-250', A-CJP-CNPN 'Webex Contact Center Premium Named Agent', A-SS-NBR 'NBR Storage 1 GB'); 1,214 parts, 0 facts, Cisco only. 226 rows are decided here and 1,033 already carry a more specific reason (A-FLEX-, A-SPK-, A-WRK-, A-SUB-...), which is why this rule sits after them" },
  { kind: "prefix", token: "EA-", klass: "license", why: "Collaboration Enterprise Agreement suite, user and migration line ('ELA Multiparty User - Tier B', 'Total Knowledge Worker Count for CMS Add On Suite'); 141 parts, Cisco only, 0 facts. 23 of the 129 it decides are in contact-center, where they were `software` by the category fallback — the class is a refinement, not a move" },
  { kind: "exact", token: "GM-ELA-6Y-EPT", klass: "license", why: "'GM ELA, 6 year term - Collab End Point SW (upgr incl)'" },
  { kind: "prefix", token: "COL-WBX-", klass: "license", why: "WebEx Advantage programme line ('Advantage 3 year term - WebEx - 1K Units'); 3 parts, 0 facts" },
  { kind: "prefix", token: "WBX-", klass: "license", why: "WebEx named-user meeting subscription ('WebEx Named User Meetings Sub - 1 Year'); 14 parts, 0 facts" },
  { kind: "prefix", token: "WEBEX-", klass: "license", why: "WebEx port entitlement for CUWL ('WebEx External Ports for CUWL Add-on'); 7 parts, 0 facts" },

  // UC application entitlements: a user, session, port, node or device count, a PAK, an upgrade.
  // `MIG-` widens round 5's `MIG-1`, and `UPG-` widens this file's `UPG-UC` / `UPG-TP-`: both were
  // written narrow and BOTH ARE CLEAN AT FULL WIDTH when measured — 140 MIG- and 208 UPG- parts,
  // every one Cisco, every one in unified-communications, 0 facts anywhere. The earlier note "NOT
  // the bare UPG- prefix: an upgrade KIT is hardware" describes a part that does not exist in the
  // catalogue; what it was protecting is `UPGRADE-KIT`, which has no hyphen after UPG and is pinned.
  { kind: "prefix", token: "MIG-", klass: "license", why: "UC Manager / Unity / Presence migration licence ('Mig from UCM 9.x Bas to Enh User Lic'); 140 parts, all unified-communications, 0 facts. Widens round 5's MIG-1, which reached only the MIG-10X/11X/12X tiers" },
  { kind: "prefix", token: "UPG-", klass: "license", why: "UC application upgrade licence ('Upgrade to UC Manager Enhanced - Above 10K Users', 'BE6000 CUWL Professional - SW Upgrade'); 208 parts, all unified-communications, 0 facts. Widens UPG-UC / UPG-TP-; UPGRADE-KIT has no hyphen there and is pinned as a refusal" },
  { kind: "prefix", token: "UP-UCM", klass: "license", why: "UC Manager tier upgrade ('Upg to UCM 10.x Enh Plus from 9.x'); 9 parts, 0 facts" },
  { kind: "regex", token: "uwl-version-migration", re: /^[MU]-UC[MN]-UWL/, probe: "M-UCM-UWLP-8TO10",
    klass: "license", why: "Workspace-licensing version migration and upgrade ('UCM UWLP Migration - 8x to 10x - Order correct license qty'); 24 parts, 0 facts" },
  { kind: "prefix", token: "UWL", klass: "license", why: "Unified Workspace Licensing user line ('CUWL Professional 10.x Users - Service Use Only'); 44 parts, 0 facts. The existing -UWL- / -UWL / UWLADD rules are infix and suffix forms and cannot reach these" },
  { kind: "prefix", token: "RTMU-", klass: "license", why: "Right To Major Upgrades for CUWL ('Right To Major Upgrades for CUWL - Collab 1 Month, 1 User'); 12 parts, 0 facts" },
  { kind: "prefix", token: "CUAC", klass: "license", why: "Unified Attendant Console licence ('Unified Attendant Console Advanced 11.x Server HA'); 59 parts, 0 facts" },
  { kind: "regex", token: "attendant-console-legacy", re: /^CU[BDE]\d?X?-(?:MIG-AC|ATT-CON)/, probe: "CUD-ATT-CON",
    klass: "license", why: "the pre-CUAC attendant-console editions ('Unified Enterprise Attendant Console', 'Unified Att Console Bus Edition 9.x Migration Offer'); 10 parts, 0 facts" },
  { kind: "prefix", token: "UCXN", klass: "license", why: "Unity Connection user, SpeechConnect-port and upgrade licence ('Unity Connection 11.x SpeechConnect Ports'); 133 parts, 0 facts" },
  { kind: "prefix", token: "UNCN", klass: "license", why: "Unity Connection, second SKU spelling ('Unity Connection, 16 ports, 100 users - All user Features'); 36 parts, 0 facts" },
  // The `-PIMG` / `-TIMG` veto IS THE ONE REAL HARDWARE FAMILY IN THE WHOLE RESIDUE: 14 PBX-IP and
  // T1 media gateways ("PBX-IP Media Gateway for Mitel SX200 and SX2000 PBXs"). BUNDLE repeats the
  // veto the UNITYCN rule above already carries, because that rule declines UNITYCN7-BUNDLE and this
  // wider one would otherwise pick it straight back up — a veto undone by a later rule is no veto.
  { kind: "prefix", token: "UNITY", klass: "license", except: ["-PIMG", "-TIMG", "BUNDLE"],
    why: "Unity / Unity Connection add-on and CUWL user licence ('Unity 5.0 UWL Add-On PAK', 'Additional Unity 7.x Users for CUWL'); 223 parts, 0 facts. Vetoes UNITY-PIMG / UNITY-TIMG (14 real PBX-IP and T1 media gateways, kind `gateway` in collabKind) and UNITYCN7-BUNDLE, which ships a server" },
  { kind: "prefix", token: "SPEECHVIEW", klass: "license", why: "SpeechView transcription licence for Unity Connection; 5 parts, 0 facts" },
  { kind: "prefix", token: "SPCHVIEW", klass: "license", why: "SpeechView, second SKU spelling; 2 parts, 0 facts" },
  { kind: "prefix", token: "CUP", klass: "license", why: "Unified Presence server, node and user licence ('Unified Presence Server License', 'Unified Presence User License Add-On Licences'); 69 parts, 0 facts" },
  { kind: "prefix", token: "PXY-", klass: "license", why: "Unified Presence SIP Proxy Mode licence; 10 parts, 0 facts" },
  { kind: "prefix", token: "PAS-", klass: "license", why: "Presence Application Services per-seat UIP ('EPAS Software UIP per seat, 1500 + for I Year'); 12 parts, 0 facts" },
  // TOKEN-ANCHORED, AND THE FIRST DRAFT WAS NOT — this is the defect the class-against-kind control
  // caught. A bare `BE6K-` prefix looked clean by every automated test: 115 parts, Cisco only, ZERO
  // facts of any kind, and every member of the fallback residue licence-named. It also ate
  // `BE6K-M6-K9` "Business Edition 6000 (M6) Appliance", `BE6K-M7-K9`, the four `BE6K-ST-BDL` /
  // `BE6K-STBDL-PLS` servers and thirteen server components — `BE6K-PSU-M6-1200` is "1200W Titanium
  // power supply for C-Series Servers". None of them holds a fact, so the own-physical-fact gate
  // could not refuse them; what found them was asking which rows this block calls non-hardware
  // while collabKind gives them a PHYSICAL kind. The residue was read in full and the rest of the
  // family was not, which is the whole reason the brief says to read the FAMILY.
  //
  // `START` is in and `ST-` / `STBDL` are out, and that distinction is the family's own: "BE6000
  // User License Starter Bundle with 35 UWL Pro Licenses" is a licence pack, "Business Edition
  // 6000M Svr (M3), Export Restricted SW" is a server. The 22 `BE6K-UWL-*` rows are not listed here
  // because round 2's `-UWL-` infix already catches them.
  { kind: "regex", token: "be6000-entitlement", re: /^BE6K-(?:\dX-|ADV|BAS|ENH|ESS|PAK|PUB|START|UC-|UCL|UPG|UXL|VCSC|VIRT|VM-|TP-RM)/, probe: "BE6K-UCL-ENHP",
    klass: "license", why: "Business Edition 6000 User Connect Licence, starter pack and PAK ('Business Edition 6000 - Enhanced Plus User Connect License'); 40 of the family's 115 parts, 0 facts. The other 75 are the appliance, its server components, its software images and the -UWL- rows another rule holds — a bare BE6K- prefix took all of them" },
  // The Business Edition software images, which the kind gate was hiding: collabKind already calls
  // them `software` (its `^BE\d[A-Z]-SW-` rule) so they were asked nothing, while their CLASS still
  // said hardware. Round 7 found the identical shape under NXOS-.
  { kind: "regex", token: "business-edition-image", re: /^BE\d[A-Z]?-SW-/, probe: "BE6K-SW-12.5",
    klass: "software", why: "Business Edition software image ('Business Edition 6000 v12.5 export restricted software', 'Media (no lic) for Cisco Collaboration 10.x 11.x'); 36 parts across BE6K / BE6S / BE7K, all classed hardware, 0 facts" },
  { kind: "prefix", token: "BE3K", klass: "license", why: "Unified CMBE 3000 User Connect Licence; 5 parts, 0 facts" },
  { kind: "regex", token: "be6000-starter", re: /^BE-1\dX-|^BE6000-|^BE6\/7K-/, probe: "BE-10X-UCL-STR",
    klass: "license", why: "BE6000 starter / add-on / embedded-virtualisation licence ('BE6000 v12 UWL Standard Starter licenses (35-pack)'); 11 parts, 0 facts. Deliberately not the bare BE\\d prefix — BE7K-NIC-M6 is a 4x10GbE NIC with an own physical fact" },
  { kind: "prefix", token: "CPW-UC", klass: "license", why: "Partner Workspace UC user licence ('Partner Workspace UC 6.1 for 150 users'); 3 parts, 0 facts" },
  { kind: "prefix", token: "SRST", klass: "license", why: "Survivable Remote Site Telephony endpoint licence ('SRST - 1 SRST Endpoint License (E-Delivery Smart)'); 3 parts, 0 facts. The existing FL-SRST- rule is a different SKU form" },
  { kind: "regex", token: "cme-user-license", re: /^CME(?:14|-EA)/, probe: "CME14-UL",
    klass: "license", why: "Communications Manager Express seat licence ('CME Phone / Seat License for EA'); 2 parts, 0 facts. NAMED 'Phone' AND IS NOT ONE — one of the six phone-named licences the name control found" },
  { kind: "prefix", token: "CUSP10-", klass: "license", why: "Unified SIP Proxy calls-per-second licence; 1 part, 0 facts" },
  { kind: "prefix", token: "TP-SMP", klass: "license", why: "TelePresence Shared Multiparty licence; 2 parts, 0 facts" },
  { kind: "prefix", token: "KEY-CER", klass: "license", why: "Emergency Responder licence key by phone tier (KEY-CER1.X-10K=); 5 parts, 0 facts" },
  { kind: "prefix", token: "UIP-CER-", klass: "license", why: "User Investment Protection for the Emergency Responder server; 3 parts, 0 facts" },
  { kind: "prefix", token: "VMW-UC-", klass: "license", why: "UC Virtualization Foundation entitlement; 1 part, 0 facts. NOT the bare VMW- prefix: 346 VMW- parts are the VMware licences in servers-unified-computing" },
  { kind: "regex", token: "uc-virt-embedded-license", re: /^VMW-VS(?:-HYP|5-HYP|6-)/, probe: "VMW-VS6-HYP-K9",
    klass: "license", why: "embedded Cisco UC / TelePresence virtualisation licence ('Embedded License, Cisco UC Virt. Hypervisor 6.x (2-socket)'); 8 parts, 0 facts. Anchored to the three UC forms — VMW-VS5-STD / -ENT / -EP and VMW-VSP / VMW-VSS are the servers agent's vSphere licences" },
  { kind: "prefix", token: "VXME-", klass: "license", why: "Virtual Experience Media Engine client licence ('VXME for SUSE Linux for EA'); 8 parts, 0 facts" },
  { kind: "prefix", token: "VPGW", klass: "license", why: "Virtualized PGW config tier and migration for HCS ('Virtualized PGW for HCS - Large Config'); 12 parts, 0 facts" },
  { kind: "prefix", token: "CUMC-", klass: "license", why: "Unified Mobile Communicator client licence; 10 parts, 0 facts" },
  { kind: "prefix", token: "CUCILYNC", klass: "license", why: "UC Integration for Microsoft Lync client licence; 5 parts, 0 facts" },
  { kind: "regex", token: "jabber-mobile-client", re: /^VOIP-(?:IPH|ADR)|^IPC-JAB/, probe: "VOIP-IPH-CPW",
    klass: "license", why: "Jabber / Cisco Mobile client licence and migration ('Mobile for iPhone', 'Migration from Cisco IP Comm to Cisco Jabber for Mac 8.6'); 17 parts, 0 facts" },
  { kind: "regex", token: "informacast-license", re: /^SP-INF(?:ORMA?|M)C?ST/, probe: "SP-INFORMACST-1K",
    klass: "license", why: "SolutionsPlus InformaCast end-point licence ('InformaCast - 1000 End Point Licenses'); 12 parts across both SKU spellings, 0 facts" },
  { kind: "regex", token: "cuc-smart-license-key", re: /^CUC-(?:PLM|SL)-/, probe: "CUC-SL-EXRTKY-K9",
    klass: "license", why: "Unity Connection PLM encryption / smart-licensing authorisation key; 3 parts, 0 facts. CUC- without the M is a separate SKU family from CUCM-" },
  { kind: "regex", token: "ucm-node-license", re: /^UCM-[LMS]-UCS-(?:UPG-)?NODE$/, probe: "UCM-S-UCS-NODE",
    klass: "license", why: "CUCM virtual-machine node licence by size ('CUCM CUCM-UCS-7500 Node'); 6 parts, 0 facts" },
  { kind: "regex", token: "be6000-voicemail-ucl", re: /^UCN-\d+X-VM-UCL$/, probe: "UCN-10X-VM-UCL",
    klass: "license", why: "BE6000 Unity Connection basic voicemail UCL ('BE6000 Unity Connection 11x Basic Voicemail License'); 4 parts, 0 facts" },
  { kind: "prefix", token: "SPCTRXMW", klass: "license", why: "Citrix SolutionsPlus Voice Office user licence; 4 parts, 0 facts" },
  { kind: "prefix", token: "V-CLOUD", klass: "license", why: "Vyopta vAnalytics Cloud subscription (SolutionsPlus); 2 parts, 0 facts" },
  { kind: "prefix", token: "ESNA-", klass: "license", why: "Esna TMS booking SolutionsPlus licence; 1 part, 0 facts" },
  { kind: "prefix", token: "SP-ARC-XPS", klass: "license", why: "ARC Express PC attendant console (SolutionsPlus); 1 part, 0 facts. NOT the bare SP- prefix, which holds the Atlas IP speakers and clocks and the Jabra handsets" },
  { kind: "regex", token: "meetingplace-addon", re: /^MP-(?:60|70|MIG)|^MP[67]-ADD-PAK|^MPE-/, probe: "MPE-20-UWLA-PAK",
    klass: "license", why: "MeetingPlace / MeetingPlace Express CUWL add-on PAK; 14 parts, 0 facts. Not the bare MP prefix: MP232-R is a servers part and MP-WMS-MIG-K9= a security one" },
  { kind: "regex", token: "uc-per-device-addon", re: /^ANLG-DEV-|^PUBLIC-IP-DEV-/, probe: "ANLG-DEV-BE",
    klass: "license", why: "non-application device add-on for UWL ('Public Space non-app phone add-on for UWL BE'); 9 parts, 0 facts" },
  { kind: "prefix", token: "UCM-HOSP", klass: "license", why: "UC Manager Hospitality licensing and its DLU / room counts; 4 parts, 0 facts" },
  { kind: "regex", token: "uc-alacarte-migration", re: /^PRO-MIG-USR|^PMP-MIG-USER|^ADD-JAB-TO-ENH|^AOL-FEDERATION/, probe: "PRO-MIG-USR",
    klass: "license", why: "CUWL-to-a-la-carte migration and feature add-on ('Add Jabber Device to Enhanced License in UC Manager 8.x'); 4 parts, 0 facts" },
  { kind: "regex", token: "uc-db-upgrade-royalty", re: /^DBUPGRADE|^DB-UPG/, probe: "DB-UPG",
    klass: "license", why: "'Royalty option for IBM database upgrade'; 2 parts, 0 facts" },
  { kind: "regex", token: "vcs-migration", re: /^VCS-(?:MIG|C-GWBDL)/, probe: "VCS-MIG-EXP",
    klass: "license", why: "VCS-to-Expressway / UCM migration licence and the BE6000 VCS-C gateway bundle; 3 parts, 0 facts" },
  { kind: "contains", token: "UCL-UCM-UPG", klass: "license", why: "'Top Level Sku For 11.X and Later User License - Migration', with and without the R- e-delivery prefix; 2 parts, 0 facts" },
  { kind: "prefix", token: "LIC4", klass: "license", why: "'License Upgrade of 2500 Addl Users, CM 4.x to CM 5.x'; 1 part. The round-1 LIC- prefix cannot reach it — the digit sits where the hyphen would" },
  { kind: "prefix", token: "UNIFIED-CM", klass: "license", why: "CallManager top-level order line ('CUCM 7.1 top level part number'); 2 parts, 0 facts" },
  { kind: "exact", token: "MOBILE-USR", klass: "license", why: "a CUWL mobile user line whose name is only its SKU" },
  { kind: "exact", token: "UCM-PAK", klass: "license", why: "a CUCM Product Authorization Key whose name is only its SKU" },
  { kind: "exact", token: "UPC-K9-OPT", klass: "license", why: "'Unified Personal Communicator Options'" },
  { kind: "exact", token: "CTI-VCSC-BE6K-PAK", klass: "license", why: "'Config Only E-Delivery VCS Control PAK PID' — a PAK, unlike its CTI-VCS- siblings, which may be the 1RU appliance and are deliberately left alone" },
  // THE BARE `CUBE-` AND `FL-CUBE-` FORMS WERE ADDED LAST, and only because a defect in the KIND
  // axis was hiding them: collabKind carried `CUBE` as a bare power-supply token (a real power cube
  // is CP-PWR-CUBE-N), so 22 Unified Border Element session licences were being called power
  // supplies and never appeared in the `unknown` residue this agent was reading. Fixing the token
  // put them on the board. A wrong kind can hide a wrong class as surely as a wrong class hides a
  // wrong kind — round 7 found the same pair under NXOS-.
  // PROBE MOVED ON MERGE, 12 Sep 2026. `FLASR1-CUBEE-100P` is decided by the routers block's
  // `sku-prefix:FLASR1-` — same class, earlier rule — so the reachability check called this rule
  // shadowed while it decides 29 live parts. That check reads a rule's PROBE, which is the exact
  // "judged by its probe, not by the rows it decides" trap this file has already paid for once: a
  // probe must be a row the rule really wins. Measured with classify() over 91,543 live parts.
  { kind: "regex", token: "cube-session-license", re: /^FLS?A?SR1-|^C1-(?:ASR1-CUBEE|CUBEE?|FL-)|^CUBE\d*-|^FL-CUBE/, probe: "C1-ASR1-CUBEE-4K-R",
    klass: "license", why: "Unified Border Element (CUBE) session licence — ASR 1000, IOS feature-licence, Cisco ONE and bare V12/V14 forms ('CUBE V14 - 1 Standard Trunk Session License', 'Unified Border Element Feature License - 100 Sessions'); 169 parts across routers, security and unified-communications, 0 facts, every one already non-hardware outside these categories. C1-ASR1 without -CUBEE and C1-FL without the hyphen are REFUSED — they reach real ASR chassis and C1-FLOW-IE4K" },
  // `voice-feature-license` WAS HERE AND IS REMOVED ON MERGE, 12 Sep 2026.
  //
  // It read /^FL-C(?:ME|USP)|^FL-E-SRST|^FL-GK-|^FL-PAYG|^FL-SRST$|^FL-VG4XX/ and was correct when
  // it was written against a tree without the routers block. In the merged table the routers
  // block's `sku-regex:feature-licence` decides every one of its rows first — same class, `license`,
  // different reason — so measured with classify() over 91,543 live parts it decides **zero**. Not
  // "its probe is shadowed": zero rows, which is the only test this file accepts for a dead rule
  // after the 8-rule removal of this morning, where 2 of the 8 were alive and taking them out left
  // a licence classed hardware. The FL-CUSP and FL-GK witnesses stay in the suite, asserting the
  // reason `feature-licence` now gives them, so the removal cannot silently lose a class.
  { kind: "regex", token: "cms-meeting-license", re: /^CMS-(?:3X|BRANDING|DLT|PMP|REC|SMP|TCS2CMS)/, probe: "CMS-PMP-K9",
    klass: "license", why: "Meeting Server feature entitlement ('Meeting Server Personal Multiparty (a la carte offer)'); 8 parts, 0 facts. Token-anchored rather than a bare CMS- prefix because CMS-M-M8-K9 and CMS-S-M5-K9 are Meeting Server PLATFORMS — pinned as refusals" },
  { kind: "regex", token: "cucm-entitlement", re: /^CUCM(?:\d|-(?:CPL|EA|PAK|USR|PLM|SL|TP-))/, probe: "CUCM-CPL",
    klass: "license", why: "CUCM device-licence unit, PAK, EA and encryption entitlement ('Unified Communication Manager Device License'); 14 parts, 0 facts. Token-anchored so CUCM-UCS-SRV, the hypothetical server pinned as a refusal, stays out" },

  // Software: an image, a media kit, a version SKU or a virtual edition. The split from `license`
  // above was measured per family rather than assumed — the name vocabulary of each family was
  // counted (image / media / kit / version / release against user / session / port / PAK / tier) and
  // the majority reading taken, the way this file already settled DCNM-. The report records every
  // family's counts, including the four where the split is genuinely mixed.
  { kind: "regex", token: "cucm-version-image", re: /^(?:R-)?CM\d.*-(?:K9|UCS-)/, probe: "CM8.6-K9-NFR",
    klass: "software", why: "CallManager version image, lab / NFR appliance and UCS media kit ('SW CM 9.X Not For Resale, 20 CUWL PRO, 5 TP Room', 'CUCM 8.5 Upgrade Media Kit for UCS'); 95 parts, 0 facts, 73 of 95 names use image vocabulary and none uses entitlement vocabulary alone. The -K9 / -UCS- requirement is what keeps CM8-UM08-04-E7G-ULL, an interfaces-modules part, out" },
  { kind: "prefix", token: "CM-UIP-", klass: "software", why: "CallManager User Investment Protection term software ('CM Software UIP for 7845 plus 2500 users for 1 year'); 36 parts, 0 facts" },
  { kind: "prefix", token: "CM-", klass: "software", why: "CallManager server software and media kit ('SW CallMgr 3.3 For MCS-7825-H1', 'CUCM 8.0.2 Media Upgrade Kit'); 51 parts, all in these three categories, 0 facts" },
  { kind: "prefix", token: "CMBE", klass: "software", why: "CallManager Business Edition software upgrade ('SW Upgrade BE 7.X to 8.0'); 10 parts, 0 facts" },
  { kind: "regex", token: "cucm-version-software", re: /^CUCM-(?:VERS-|UCS-\d)/, probe: "CUCM-VERS-10.5",
    klass: "software", why: "CUCM software version and UC-on-UCS server software ('CUCM Software version 12.5'); 23 parts, 0 facts" },
  { kind: "regex", token: "sme-software", re: /^(?:R-|U)?SME/, probe: "SME-VERS-10.5",
    klass: "software", why: "Session Management Edition image, media kit and version SKU ('SW CM-SME 8.6 Appliance Not For Resale', 'SME Software Version 12.5'); 80 parts across the R- and U- spellings, 0 facts, 46 of 77 names image-worded" },
  { kind: "regex", token: "emergency-responder-software", re: /^(?:R-)?ER[\d.]*-SW-/, probe: "ER87-SW-U71-K9",
    klass: "software", why: "Emergency Responder server software and upgrade media ('EMRGNCY RSPNDR 87 SW UPGD 71 ONLY'); 110 parts, 0 facts, 105 of 110 image-worded" },
  // TOKEN-ANCHORED, and the six SKUs it deliberately misses are the reason. `ER-10.X` is named
  // "Select when upgrading from Cisco Emergency Responder 10.X" and `ER-NEW-OR-ADDON` "Select for
  // new order or additional users": they are the ordering tool's QUESTIONS, and the name rule below
  // calls them non_product. A `^ER[\d.-]` draft swallowed all six as licences — the first version of
  // this rule did exactly that, and the name-rule test case is what caught it.
  { kind: "regex", token: "emergency-responder-entitlement", re: /^ER\d|^ER-(?:911|HCS|PAK|1\dX-)/, probe: "ER90-USR-10",
    klass: "license", why: "Emergency Responder user licence, PAK and HCS add-on ('EMRGNCY RSPNDR 90 USR LIC 10 PHNS'); 29 of the 145 ER parts, 0 facts. A digit must follow ER, or one of four named tokens — the six `ER-<version>.X` rows are ordering questions, not entitlements" },
  { kind: "contains", token: "EMRGNCY-RSPNDR", klass: "license", why: "the Emergency Responder top-level order line, plain and R- e-delivery ('Emergency Responder Top Level'); 2 parts, 0 facts" },
  { kind: "prefix", token: "IME8", klass: "software", why: "Intercompany Media Engine 8.5 appliance software, lab and NFR; 3 parts, 0 facts" },
  { kind: "regex", token: "uc-partner-dlt-kit", re: /^CSR1\d[.X]*-K9-DLT$/, probe: "CSR14X-K9-DLT",
    klass: "software", why: "UC partner Demo/Lab/Training software kit ('UC 14.X Partner Demo/Lab/Training Kit'); 4 parts, 0 facts. Anchored so CSR1000V, the Cloud Services Router, cannot match" },
  { kind: "prefix", token: "UPS1.0-K9", klass: "software", why: "'SW Cisco Unified Presence Server 1.0 DEMO Not For Resale'; 1 part" },
  { kind: "prefix", token: "UCAPPS", klass: "software", why: "UC applications software version ('Version 10.x - Export Unrestricted'); 9 parts, 0 facts" },
  { kind: "prefix", token: "EUR-", klass: "software", why: "contact-centre application media and server software filed in unified-communications ('VVB 12.5 Server Software [Security Enabled]', 'CCX 12.5 Media'); 22 parts, 0 facts" },
  { kind: "regex", token: "vcs-virtual-edition", re: /^CTI-VMVCS|^TMP-VMVCS|^(?:R-|CTI-)ATP-VM-|^EXPWY-VE-/, probe: "CTI-VMVCS-CTRL-K9",
    klass: "software", why: "VCS and Expressway VIRTUAL editions and their trade-in / ATP-demo PIDs ('Virtual VCS Control - includes FindMe application', 'Expressway-C Server, Virtual Edition'); 14 parts, 0 facts. Deliberately only the virtual forms: CTI-VCS-BASE-K9 and EXPWY-C-K9 may be the 1RU appliance and are left as hardware with the question recorded in the report" },
  { kind: "prefix", token: "CMS1K-SW-", klass: "software", why: "'Meeting server 1000 HMN sw preload'; 3 parts, 0 facts" },
  { kind: "regex", token: "im-only-database", re: /^(?:VM-|M7816-)?IM8\d?ONL?Y?DB/, probe: "VM-IM86ONLYDB-K9",
    klass: "software", why: "'DB software for VMWare IM Only, used only if no CUCM present'; 5 parts across three SKU spellings, 0 facts" },
  // `PCP-BE6K-90-K9` ("Prime Collaboration Provisioning for BE6K 9.0") belongs to this family and is
  // DELIBERATELY LEFT OUT: the security agent owns the `PCP-` token this round, and two branches
  // classing one part differently (their `license` against this file's `software`) is a merge
  // conflict about meaning rather than text. Reported in the report's overlap section instead.
  { kind: "regex", token: "prime-collab-software", re: /^PLM10X|^PC-10X-STANDARD/, probe: "PLM10X-K9",
    klass: "software", why: "Prime Licence Manager and Prime Collaboration Standard software ('Prime License Manager 10.X'); 2 parts, 0 facts. NOT a `PC-1` prefix: PC-1OC192-SON-XFP is a Juniper SONET PIC. PCP- is the security agent's token" },
  { kind: "regex", token: "contact-centre-app-media", re: /^CCX(?:-12|-MIG|\d-ADD)|^CVP-(?:12|CCPORT|IVRPORT|NPS)|^IPCE-(?:DIALPT|NPSENT|PRMAGT)|^IVR-12\d-NFR|^CCEH-MED/, probe: "CCX-125-SYS-K9",
    klass: "software", why: "Contact Center Express / CVP / IPCC media kit, non-production system and port licence ('CCX 12.5 Non Production System', 'CVP 12.5 Server Software (Smart)'); 75 parts, 0 facts. Version-anchored: the bare CCX / CVP / IPCE prefixes reach 1,700 contact-center and customer-collaboration parts this agent has not read" },
  { kind: "regex", token: "uc-app-software-kit", re: /^UC(?:7\.0-K9-SDK|-14-LAB|-APPS-SW)/, probe: "UC-APPS-SW-DOD-K9",
    klass: "software", why: "UC applications software kit, lab and DOD-certified build; 4 parts, 0 facts" },
  { kind: "regex", token: "uc-app-edelivery", re: /^R-(?:BE\d|CBE6K|CMS-K9|CUCM|CUWL|EA-UC|HMN-K9|PC-?1|SW-CCM|UC-CBE6K|UCM|UCN\d|UCXN|UNCN|UNIFIED-CM|UNITYCN|VCS2EXPWY|VMVCS|VMW|VPGW|VS\d)/, probe: "R-UNITYCN10-K9",
    klass: "software", why: "the R- (electronic-delivery) twin of a UC application image or top-level SKU ('Unity Connection 10.x Software', 'Prime Collaboration 12.6 Provisioning Software and BASE'); 84 parts, 0 facts. TOKEN-ANCHORED, not a bare R- prefix: 441 parts start R- across ten categories, and R-POLICY-191-SWK9 / R-NAM-VX10-62K9S= / R-ME3400E-B2A= are wireless and switches software still classed hardware — another lane's rows and another lane's call" },
  { kind: "prefix", token: "UCMBE-", klass: "software", why: "'Unified Communication Manager BE MCS 7828 SW kit'; 5 parts, 0 facts" },
  { kind: "regex", token: "cucm-on-ucs-upgrade", re: /^UCS-\d+-8\d-UPG/, probe: "UCS-1000-85-UPG",
    klass: "software", why: "'CUCM 8.5 Server Software for UC on UCS 7500 or higher'; 6 parts, 0 facts. Shaped tightly because UCS- otherwise belongs to servers-unified-computing" },
  { kind: "regex", token: "cucm-appliance-image", re: /^UCM(?:8\.6-K9|-UPG\d)/, probe: "UCM8.6-K9-NFR",
    klass: "software", why: "'SW CM 8.6 Appliance Not For Resale' and the CUWP upgrade image; 2 parts, 0 facts" },
  { kind: "exact", token: "CM5.1.1C-IBMONLY", klass: "software", why: "'UC Manager 5.1.1C Release for IBM Only' — the one CallManager version SKU with neither a -K9 nor a -UCS- marker" },
  { kind: "exact", token: "MCS-OS-2000.2.4", klass: "software", why: "'MCS Server Legacy OS (2000.2.4) Image Kit'" },
  { kind: "exact", token: "ISR-CCP-EXP-NONE", klass: "software", why: "'Config Pro Express on Router Flash w/o default config'. Exact, not an ISR-CCP- prefix: its four siblings are in `routers` and reclassifying them is that lane's decision — reported, not written" },

  // Service: a recurring fee, a training module, an extended-coverage contract.
  { kind: "regex", token: "telepresence-exchange-service", re: /^CTX-(?:NRC-|YRC-)?SERVICE/, probe: "CTX-YRC-SERVICE",
    klass: "service", why: "TelePresence Exchange recurring and non-recurring charge; 4 parts, 0 facts. NOT the bare CTX- prefix: 167 CTX- parts are CITRIX licences in servers-unified-computing" },
  { kind: "prefix", token: "CTT-T4-", klass: "service", why: "'T4 Complete Program - Educator Training Module'; 2 parts, 0 facts" },
  { kind: "regex", token: "smallbiz-extended-care", re: /^SP-CP-860S?-EX-?CARE/, probe: "SP-CP-860-EX-CARE",
    klass: "service", why: "'Extended hardware replacement coverage for Cisco 860' — a COVERAGE contract whose name contains the word hardware, which is exactly why this is a SKU rule and not a name rule; 2 parts, 0 own facts" },

  // non_product: an ordering-tool question or a datasheet cell enumerated as a part number. Each
  // was read individually; none holds a fact, a document or a relation. The `/`-containing and
  // version-shaped ones are EXACT because the general shapes are not safe — see the refusals above.
  { kind: "prefix", token: "DD-", klass: "non_product", why: "a placeholder PID whose name is '<product> dummy' (DD-CODEC-PRO-K9 'Codec Pro dummy', DD-KITPLUS-K9 'Room Kit Plus dummy'); 2 parts, 0 facts. The existing name-dummy-pid rule needs the phrase 'dummy PID' and cannot see these" },
  { kind: "exact", token: "ECRR-FCC-NA", klass: "non_product", why: "'FCC Emergency Call Routing Regulations Not Apply' — an ordering-tool declaration" },
  { kind: "exact", token: "HOSP-TERMS", klass: "non_product", why: "'Mandatory Hospitality Terms and Conditions'" },
  { kind: "exact", token: "TELPRES-DP-DLRPID", klass: "non_product", why: "'Price Adjustment PIDS'" },
  { kind: "exact", token: "UC-UCME", klass: "non_product", why: "'UC320, UC500 or UCME' — an ordering choice naming three products, not a product" },
  { kind: "exact", token: "USB-C", klass: "non_product", why: "a CONNECTOR NAME enumerated from a datasheet cell, the same shape as the QSFP28 form-factor rows above" },
  { kind: "exact", token: "321ABC432DEF", klass: "non_product", why: "a hex example string from a datasheet cell" },
  { kind: "exact", token: "FCH20100312/WZP20100113", klass: "non_product", why: "a pair of SERIAL NUMBERS from a datasheet cell. Exact, not a `/` rule: 1,314 parts contain a slash and 136 carry an own physical fact" },
  { kind: "exact", token: "NM-HD-1V/2V/2VE", klass: "non_product", why: "three network modules listed in one datasheet cell; the concrete SKUs exist beside it" },
  { kind: "exact", token: "19560-19660", klass: "non_product", why: "a UDP PORT RANGE from a Meeting Server table" },
  { kind: "exact", token: "5060-5080", klass: "non_product", why: "a SIP port range from the same table" },
  // Six IOS release numbers and two current ratings, enumerated as parts. Exact rather than a
  // version SHAPE: `^\d+\.\d` matches 499 parts of which 107 carry an own fact, 389 in `video`.
  ...["15.0.1M", "15.0.1M3", "15.1.2T", "15.1.3T", "15.1.T2", "15.1.T3"].map((token) => ({
    kind: "exact" as const, token, klass: "non_product" as const, why: "an IOS release number enumerated as a part from a compatibility table" })),
  ...["6.25A", "7.0A"].map((token) => ({
    kind: "exact" as const, token, klass: "non_product" as const, why: "a CURRENT RATING enumerated as a part from a power table" })),
  { kind: "regex", token: "uc-version-migration-question", re: /^UC-\d{1,2}\.X(?:-OR-EARLIER)?$/, probe: "UC-10.X",
    klass: "non_product", why: "the ordering tool's 'which version are you coming from' choice ('UC 7.X or earlier Version Migration'); 7 parts, 0 facts" },
  // end collab-class

  // wl-uc-class (12 Sep 2026) — THE WIRELESS AND UC CLASS RESIDUE (reviewer round 4 §6, term 3).
  //
  // WHAT WAS MEASURED, and the cohort is recorded by identity in the report so the denominator cannot
  // drift later. Reproduced exactly: `wireless` holds 134 parts classed hardware whose wirelessKind is
  // `software` and 1,187 whose kind is `other`; `unified-communications` holds 239 whose collabKind is
  // `software`. 1,560 rows. Running classify() from THIS tree first — before writing anything, because a
  // rule that re-decides a row another rule already decides is dead weight the suite reports as shadowed —
  // showed 45 of the UC 239 are ALREADY decided by the collab-class block landed earlier today
  // (business-edition-image 36, webex-collab-subscription 7, UCAPPS 2). So the open residue is 1,515, and
  // no rule below is written for those 45.
  //
  // METHOD, and it is this file's own. A NAME found each candidate family; the family was then read IN
  // FULL, every member, before a rule was written; and every rule was re-measured over ALL 91,543 live
  // parts and ALL 13 vendors, not over the two categories that produced it. THE GATE IS AN OWN
  // (non-inherited) PHYSICAL FACT: across this whole block 1,292 rows are decided and NOT ONE carries an
  // own fact of any kind, physical or otherwise. Every rule below is Cisco-only and, apart from
  // `jabber-client` (16 collaboration-endpoints rows, named in the report), reaches only these two
  // categories.
  //
  // REFUSED, each with the product it would have cost (all pinned in tests/productClass.test.ts):
  //   bare `ASR5K-`   the refusal round 5 already measured stands: 32 of the other 175 are real cards.
  //                   Only the two-character LICENCE BLOCKS actually read are taken — 02/03/04/05/0B/0D/
  //                   11/15/1D/21 — and blocks 12, 20 and 0F are EXCLUDED because they hold hardware:
  //                   ASR5K-12-PSC32GK9= is a Packet Services Card, ASR5K-12-LABADV-K9 and the three
  //                   ASR5K-20-LAB-* are chassis lab bundles, ASR5K-0F-B00-2069= is the "Motorola PSC2
  //                   LTE Hardware and Software bundle" this file's name-rule override already names.
  //   bare `ASR55-`   ASR55-DPC / ASR55-UDPC-K9 are Data Processing CARDS and ASR55-CHS-SYS-U8B is a
  //                   chassis system. The rule needs the two-digit block, and vetoes `-UDPCRX`:
  //                   ASR55-04-UDPCRX is "ASR5500 UDPC Card and Initial System SW" — a card in the box.
  //   `MIXS-12-PA2`   fourteen rows of the AT&T PAS rack build — "PAS AC ENCLOSURE", "PAS SPARE BLADE",
  //                   "PAS 10G ENCLOSURE SWITCH", "PAS DC SEISMIC CABINET". Block 12 is the only mixed
  //                   one in 228 MIX* rows and reading the family in full is what found it.
  //   bare `AIR-`     2,186 parts, 61 with an own physical fact. Only the five measured management /
  //                   location sub-families are taken. AIR-MOD-AC-* (AP1800 plug modules), AIR-330-*
  //                   (MobileAccessVE building units), AIR-MRAID12G (a RAID controller), AIR-CT85DC-K9
  //                   (an 8500 controller) and AIR-1550-HAZBBU (a battery) all stay hardware.
  //   bare `FM`       FM-OMNI-5-V, FM-PANEL-9, FM-SECTOR90-16DS and FM-SHARK-16 are ANTENNAS, FM-POE-STD
  //                   a PoE injector, FM-SPLITTER / FM-SURGE / FM-WMOUNT accessories, and the 44
  //                   FLMESH-HW-ACC-* rows carry the letters HW. The throughput rule requires a TIER
  //                   (digits or UN) at the end, which is exactly what separates the licence from the
  //                   radio it unlocks: FM1000-GWY and FM10000-GWY are the real gateways and each holds
  //                   an own physical fact, while FM1000-GWY-500 is named "Software upgrade up to 500
  //                   Mbps". Both bare forms are pinned.
  //   bare `MSE-`     MSE-HD600G10K12G is a 600 GB SAS drive and MSE-MRAID12G a RAID controller.
  //   bare `EDU-`     EDU-CT5520-K9 and EDU-CW9800M are real K12 wireless controllers. (Their KIND is
  //                   wrong — wirelessKind's controller rule wants AIR before CT — which is a finding
  //                   for the wireless owner, in the report, not a class change here.)
  //   bare `C1-`      stays refused as round 2 decided; only C1-AIR-CMX / C1-AIR-K9 / C1-MSE- / C1-WLC-
  //                   are taken, and C1-AIR-CT#### (a real controller on the Cisco ONE form) cannot match.
  //   bare `PROMO`    the existing refusal stands, and PROMOCT5508-1-K9 "Migration to Cisco - 5508 100
  //                   licenses" is left hardware: a controller migration may ship the controller.
  //
  // --- the StarOS / mobile packet core catalogue filed in `wireless` -----------------------------------
  // The single largest family in the residue. Cisco files the whole ASR 5000/5500 packet-core business in
  // `wireless`, so its per-session, per-subscriber and per-card entitlements are scored as access points.
  // The two-character block after the platform token is Cisco's LICENCE NUMBERING — the existing
  // `ASR5K-00` and `ASR5K-99` rules are the same shape, which is why the 5500 siblings are `license` too
  // rather than `software`: the identical product must not sit in two classes on the strength of a
  // spelling. 185 parts, every name "StarOS Release nn System SW, Per UDPC2" or a feature entitlement.
  { kind: "regex", token: "staros-5500-licence", re: /^(?:ASR55|ASR5S|LIF55)-\d\d(?!-UDPCRX)/, probe: "ASR55-00-SWUDP218",
    klass: "license", why: "ASR 5500 StarOS system-software and feature entitlement by licence block ('ASR5500 StarOS Release 18 System SW, Per UDPC2', 'Flow Aware Packet Acceleration, Per ASR5500-U System'); 185 parts, all Cisco, all wireless, 0 own facts. Vetoes ASR55-04-UDPCRX, a UDPC card sold with its software" },
  // The RELEASE IMAGES, which carry no per-unit qualifier: "ASR5000 System Software, Release 21.7, Per SMC
  // or MIO". Software rather than license, the same reading nxos-image and ios-image already take.
  { kind: "regex", token: "staros-image", re: /^(?:ASR5K|ASR55)-SW-R\d/, probe: "ASR5K-SW-R21-K9",
    klass: "software", why: "ASR 5000 / 5500 StarOS release image (ASR5K-SW-R2122-K9 'ASR5000 System Software, Release 21.22'); 63 parts, 0 own facts" },
  { kind: "regex", token: "asr5000-feature-licence", re: /^ASR5K-(?:0[2345BD]|1[15D]|21)-/, probe: "ASR5K-03-HA-P3",
    klass: "license", why: "ASR 5000 per-operator feature licence block ('Sprint Only HA Per PSC3', 'GGSN+S/PGW Sessions License-1, 10K Sessions'); 30 parts, 0 own facts. ONLY the ten blocks read in full — 12, 20 and 0F hold cards, lab chassis bundles and a hardware+software bundle" },
  { kind: "prefix", token: "ASR5000-NETW4", klass: "license", why: "'Cisco ASR5000-NETW4RTM' — the ASR 5000 member of the NETW4 ordering family whose ASA sibling ASA5585-NETW4UP3 is already a licence singleton; 1 part, 0 facts" },
  // Cisco's IMS / mobility application catalogue (MIXS, MIXSA failover-A, MIXSF failover, MIXF): AAA, HSS,
  // PCRF, SDB, CSCF, IP-SMSC, MMS, MMTEL, MSC TAS, ECS storage, Web Element Manager. Sold per subscriber
  // block, per session, per TPS band or per server. 226 undecided of 228; the name vocabulary splits
  // entitlement 125 / image 44, so the family is `license`. 54 of the names contain a BOX word and every
  // one of the 54 was read: "AAA Base Server (incl available technology licensing)" and "Home Subscriber
  // Server Base SW per server" license a server they do not ship.
  { kind: "regex", token: "ims-mobility-licence", re: /^MIX(?:SA|SF|S|F)-[0-9][0-9A-F]-(?!PA2)/, probe: "MIXS-00-HS3S41",
    klass: "license", why: "IMS / mobility application entitlement per subscriber, session, TPS or server ('HSS 10,000 Provisioned Subscriber Block', 'ECS Offboard Storage Server (ESS) Rel 12'); 212 parts, 0 own facts. Vetoes the MIXS-12-PA2* AT&T PAS rack build (14 enclosures, cabinets, blades and switches)" },
  // Quantum Virtualized Packet Core. The `-SW-` release rows first, so a release image is not called a
  // licence: "QVPC StarOS Release 2025.02 System SW".
  { kind: "regex", token: "qvpc-image", re: /^QVP[CM][AF]-\d\d-SW-\d/, probe: "QVPCA-00-SW-2502",
    klass: "software", why: "Quantum Virtualized Packet Core release image ('QVPC StarOS Release 2025.02 System SW'); 10 parts, 0 own facts" },
  { kind: "regex", token: "qvpc-licence", re: /^QVP[CM][AF]-\d\d-/, probe: "QVPCA-00-HA10SW",
    klass: "license", why: "Quantum Virtualized Packet Core session / feature licence ('Home Agent Software License, 10K sessions', 'Session Recovery, IPSG, 10K Sessions'); 109 parts, 0 own facts. The six names containing 'Bundle' are SESSION bundles, read one by one" },
  // The two spellings that exist, not a bare UCC prefix: `UCCX` (Contact Center Express) is a real Cisco
  // product line, and a veto against something the catalogue does not contain today is a guard nobody has
  // ever seen fire. All nine UCC rows in 91,543 are Ultra Cloud Core and were read.
  { kind: "regex", token: "ucc-cloud-core", re: /^UCC(?:5G)?-/, probe: "UCC5G-SMF-S31-L",
    klass: "license", why: "Ultra Cloud Core network-function entitlement ('UCC - Session Management Function (SMF), 1K sessions', 'Ultra Cloud Core (UCC) - Policy Control Function (PCF)'); 8 parts newly decided of 9 matched, all wireless, 0 facts" },
  { kind: "prefix", token: "MI3P-", klass: "license", why: "ANDSF capacity and installation licence ('ANDSF Capacity License (activated clients) - 100k'); 6 parts, 0 facts" },
  { kind: "regex", token: "andsf-release-upgrade", re: /^AND-R\d\d-/, probe: "AND-R17-ALL-10M_S",
    klass: "license", why: "'ANDSF All Inclusive 2017 Release Upgrades- 10M sessions'; 1 part, 0 facts" },
  { kind: "regex", token: "cuto-perpetual", re: /^CUTO-\d\d-P/, probe: "CUTO-00-P91",
    klass: "license", why: "'CUTO Standalone Perpetual 1 Gbps' (Ultra Traffic Optimization); 1 part, 0 facts. Its QVPCA- siblings are taken by qvpc-licence" },
  { kind: "regex", token: "mog-software", re: /^MOG-SW-\d/, probe: "MOG-SW-09",
    klass: "software", why: "'CPS MOG Release 9.0, per instance'; 2 parts, 0 facts" },
  { kind: "prefix", token: "MOG-FDC", klass: "license", why: "'MOG Non-RTU Features, AT&T Only'; 1 part, 0 facts" },
  { kind: "prefix", token: "OWM-", klass: "license", why: "Openwave Mobility TCP-acceleration, video-optimisation and analytics subscription ('MDO+STM+Dynaboost SA per 100K Users', 'PPI+Analytics Bundle 10M Active Users'); 35 parts, all wireless, 0 facts. Its six 'Bundle' names are user-count bundles, read individually" },
  { kind: "prefix", token: "EMSP-", klass: "license", why: "Enterprise Mobility Services Platform run-time and base-platform subscription ('EMSP Run Time (50-250) Access Points: 1 Month Duration'); 48 parts, 0 facts" },
  // --- Cisco Policy Suite, filed in `wireless` --------------------------------------------------------
  // Two spellings, two classes, and the family itself draws the line: `POLICY-` names the SOFTWARE
  // ("Cisco Policy Suite 9 Software (VMWare edition)", 14 image-worded names of 15) and `POL-` the
  // APPLICATION LICENCES ("CPS All-Inclusive Feature Pack - 100K sessions", 18 of 18 entitlement-worded).
  { kind: "regex", token: "policy-suite-software", re: /^(?:R-)?POLICY-|^CISCO-POLICY$/, probe: "POLICY-75-AIO-K9",
    klass: "software", why: "Cisco / Quantum Policy Suite software by release and edition ('Cisco Policy Suite 22.2 Software', 'All-In-One Lab Software (OpenStack)'); 32 parts including the 16 R- e-delivery twins the collab block named as this lane's rows, 0 facts" },
  { kind: "prefix", token: "POL-", klass: "license", why: "Cisco Policy Suite application licence ('DRA Application License - Additional Applications', 'Upgrade from Value Plus to All inclusive - 10M sessions'); 18 parts, 0 facts" },
  { kind: "regex", token: "policy-runtime", re: /^QP-(?:3G|LTE|BNG|SPW|MBL)-/, probe: "QP-LTE-BASE-1",
    klass: "license", why: "Policy Runtime Environment base and lab package ('Policy Runtime Environment - 4G LTE - Addtl Base Package'); 14 parts, 0 facts. Anchored to the five access types rather than a bare QP- prefix" },
  { kind: "regex", token: "policy-dra", re: /^(?:PDRA-P|VDRA)-/, probe: "PDRA-P-PRE-1M",
    klass: "license", why: "Policy DRA premium pack and vDRA application licence ('Policy DRA - Premium Pack - 1M Sessions', 'VDRA Application Base License'); 8 parts, 0 facts" },
  { kind: "regex", token: "policy-feature-pack", re: /^(?:APS|M)-P-(?:AAA|OSS|EXTSPR|SIR)-/, probe: "APS-P-AAA-10K-1T",
    klass: "license", why: "policy feature pack by session count and subscriber tier ('AAA Feature Pack - 10K Sessions - 1M-4.99M'); 15 parts, 0 facts. NOT a bare M- prefix, which this file already refuses (M-ASR1K-* is memory), and not M-[EPS]-B-, the MATE bundle rule" },
  { kind: "regex", token: "cps-automation", re: /^CPS-(?:S-ATS|ANDSF-FDC|DRA-FDC|PCRF-FDC)/, probe: "CPS-S-ATS-MV",
    klass: "license", why: "CPS Automation Tool subscription and release-independent feature credit ('CPS Automation Tool SW SWSS + Install, Multi VM'); 14 parts, 0 facts. Token-anchored: CPS- is one letter away from the CSP- CUBE(SP) and NFV-platform rules already in this table" },
  { kind: "regex", token: "wsg-sami-rtu", re: /^SSAS\d0K9-COSLI/, probe: "SSAS20K9-COSLI20",
    klass: "license", why: "Wireless Security Gateway application software RTU per SAMI blade ('WSG R2.0 Application Software RTU per SAMI (Crypto)'); 8 parts, 0 facts" },
  { kind: "regex", token: "sami-no-app-image", re: /^SC-SBC-NAP-SAMI/, probe: "SC-SBC-NAP-SAMI-1",
    klass: "software", why: "'No App Image For WS-SVC-SAMI-BB=' / 'SAMI No Application Spare Software'; 2 parts, 0 facts" },
  { kind: "regex", token: "prime-virtual-nam", re: /^R-NAM-?VX\d/, probe: "R-NAM-VX10-62K9S",
    klass: "software", why: "'Smart Lic based Cisco Prime Virtual NAM VX10 Software 6.2'; 3 parts across both SKU spellings, 0 facts. The collab block named R-NAM-VX10-62K9S= as a wireless row for this lane to decide" },
  // --- wireless management, location and controller software ------------------------------------------
  { kind: "regex", token: "context-aware-licence", re: /^AIR-(?:CAS-|CA-LE-|LM-WIPS-|CMX-(?:CLD|SVC)-|MSE-PAK|WSA-\dYR)/, probe: "AIR-CAS-1KC-K9",
    klass: "license", why: "Context Aware, local-mode wIPS, CMX Cloud and Mobility Services entitlement ('Context Aware Engine for Clients License For 12K Clients', 'Cisco Enhanced Local Mode wIPS License, Supporting 2000 APs'); 36 parts, 0 facts. Five measured sub-families, never the bare AIR- prefix" },
  { kind: "regex", token: "wlc-ap-image", re: /^AIR-CT\d+-SW-\d/, probe: "AIR-CT2504-SW-8.1",
    klass: "software", why: "wireless controller software release ('Cisco 2504 Wireless Controller SW Rel. 8.1'); 11 parts, 0 facts. wirelessKind already calls these `software`, so until now the kind gate asked them nothing while the class still said hardware — the same pair round 7 found under NXOS-" },
  { kind: "regex", token: "wlc-ap-sw-image", re: /^SW(?:AP|LAP|C)\d{3,4}|^SWIEC\d|^CUWN-SW-/, probe: "SWC5500K9-81",
    klass: "software", why: "access-point and controller image ('Cisco Unified Wireless Controller SW Rel. 7.6', 'Enterprise Wireless Mesh - AP3700 Controller-based SW Image', 'URWB software for IEC6400'); 36 parts, 0 facts. The routers block's ap-image rule is ^SW + a DIGIT and cannot reach SWAP/SWLAP/SWC" },
  { kind: "prefix", token: "SC9800", klass: "software", why: "Catalyst 9800 controller image and cloud edition ('Cisco Catalyst 9800-CL Wireless Controller - AWS', 'Cisco Catalyst 9800-40 Wireless Controller' release 17.15); 8 parts, 0 facts. The transceiver block's family-placeholder rule vetoes SC9800CL by name precisely so this lane could give them a class" },
  { kind: "regex", token: "wism-software", re: /^SC-SVC-WISM\d?-\d/, probe: "SC-SVC-WISM2-8.1",
    klass: "software", why: "'WiSM2 SW Rel. 8.1'; 3 parts, 0 facts. WS-SVCWISM2FIPKIT= (a FIPS kit) carries no release and cannot match" },
  { kind: "regex", token: "mse-software", re: /^MSE-(?:SW-|VA-SW)/, probe: "MSE-SW-NEW-WIPS",
    klass: "software", why: "'MSE software option - WIPS 10.x SW', 'Mobility Services Engine Virtual Appliance SW'; 4 parts, 0 facts. Not a bare MSE- prefix: MSE-HD600G10K12G is a 600 GB drive" },
  { kind: "prefix", token: "MSE-WIPS-", klass: "license", why: "'1 AP WIPS Monitor Mode license', 'MSE WIPS Tracker Term 5Y'; 6 parts, 0 facts" },
  { kind: "regex", token: "cisco-one-wireless", re: /^C1-(?:AIR-(?:CMX|K9)|MSE-|WLC-)|^E2-C1-T-AIR$/, probe: "C1-WLC-AP-T",
    klass: "license", why: "Cisco ONE wireless term licence ('Cisco ONE Wireless LAN Controller AP License (any WLC)', 'CISCO ONE ELA TERM - ACCESS Wireless'); 7 parts, 0 facts. Bare C1- stays refused, and C1-AIR-CT#### — a real controller on the Cisco ONE order form — cannot match" },
  { kind: "regex", token: "promo-location-licence", re: /^PRO-L-(?:AD-LS|CAS|LS)-/, probe: "PRO-L-LS-100AP",
    klass: "license", why: "promotional Context Aware and Location Services licence ('Promotion- 1000 AP Base Location Services licenses'); 10 parts, 0 facts. Distinct from the refused PROMO- prefix, where PROMO-AP2800-S-K9 is a real access point" },
  { kind: "prefix", token: "S-MGMT3X-", klass: "license", why: "'Cisco Ent MGMT: PI 3.x LF, AS Smart Lic, 1 Nexus 5K' — Prime Infrastructure smart licence; 4 parts, 0 facts. The bare S- prefix stays refused (MikroTik optics)" },
  { kind: "prefix", token: "WCS-NAV-", klass: "license", why: "'Cisco WCS Navigator License to support 20 Cisco WCS management platforms'; 1 part, 0 facts" },
  { kind: "exact", token: "C4500E-S8-CA", klass: "license", why: "'5 AP license upgrade for Cisco 4500 Wireless Controller'. Exact, because the modules-misc block owns the other C4500E- feature licences" },
  { kind: "exact", token: "ASCT-EXCMGR", klass: "software", why: "'Exciter Manager Software'. Exact: its ASCT-EX2000 / ASCT-EX3200 siblings are compact exciters, real hardware" },
  // --- Fluidmesh: the plug-in licences, and the radios and antennas they are NOT ----------------------
  // wirelessKind's header already says `FM####-<tier>` is a plug-in licence "classed by productClass.ts".
  // It was not, until now. The tier at the END is the whole discriminator, and the family proves it: the
  // bare FM1000-GWY and FM10000-GWY hold an own physical fact and are the gateways; FM1000-GWY-500 is
  // named "Software upgrade up to 500 Mbps (aggregate throughput)".
  { kind: "regex", token: "fluidmesh-throughput", re: /^FM(?:PONTE|\d{4,5}V?)-(?:FLU-|MOB-|PMCL-|PTP-|GWY-)?(?:MOB-|TRK-)?(?:MOB-)?(?:\d+|UN)$/, probe: "FM3200-30",
    klass: "license", why: "Fluidmesh throughput / Fluidity plug-in licence ('Enable up to 30 Mbit/s ethernet througput in FM3200 Devices for fix backhaul', 'Enable FLUIDITY Fast-roaming Mobile-Unit Mode up to 5 Mbit/sec in FM3500'); 102 parts, all Cisco, all wireless, 0 own facts. Requires a TIER: FM3200B-HW, FM1200V-HW and both bare gateways cannot match" },
  { kind: "regex", token: "fluidmesh-plugin", re: /^FM-(?:AES|TITAN|VLAN|QNET|PROFINET|CANBUS|EMP|FIPS140-2|MONITOR-\d+)$/, probe: "FM-TITAN",
    klass: "license", why: "Fluidmesh software plug-in and FM Monitor device-count licence ('TITAN Plug-in. Enables Fast Failover', 'AES Plug-in'); 18 parts, 0 facts. Named one by one because the rest of the FM- prefix is antennas (FM-OMNI, FM-PANEL, FM-SECTOR90, FM-SHARK), injectors (FM-POE) and accessories" },
  { kind: "exact", token: "FLMESH-SW-PAK", klass: "non_product", why: "'SW Container PID Only' — the container the Fluidmesh plug-ins are ordered under, which ships nothing itself; the same reading as the video block's 'Container (Top Level) PID' rows" },
  // --- ordering options and datasheet cells enumerated as parts ---------------------------------------
  { kind: "regex", token: "regulatory-domain-option", re: /^AIR-(?:AMERICAS|EMEA|ISRAEL|JAPAN)$/, probe: "AIR-EMEA",
    klass: "non_product", why: "'Regulatory Domain Configuration for EMEA (ETSI)' — an ordering-tool choice that ships nothing; 4 parts, 0 facts. Anchored whole, so the 2,186 real AIR- products cannot match" },
  { kind: "regex", token: "demand-planning-adjust", re: /^AIR\d{4}-DP-DLR$/, probe: "AIR3500-DP-DLR",
    klass: "non_product", why: "'Product family - demand planning dollar adjustment' — a price line, the same shape as the collab block's TELPRES-DP-DLRPID; 1 part, 0 facts" },
  // A DATASHEET CELL IS NOT A PRODUCT, wireless edition. Every one of the eighteen is named "Cisco " plus
  // its own SKU and holds no fact: a regulatory band (U-NII-5..8), a security protocol (WPA2, WPA3), a
  // modulation-and-coding-scheme index from an 802.11 data-rate table (MSC0..MSC15), a virtual NIC driver
  // from the 9800-CL datasheet (E1000, E1000E, VMXNET3) and an optic VENDOR plus reach code from a
  // compatibility table (FINISAR-LR, FINISAR-SR). Anchored to the WHOLE SKU, which is what keeps a real
  // product out — SFP-10G-SR is not FINISAR-SR, and MSE-* is not MSC12.
  { kind: "regex", token: "wifi-datasheet-cell", re: /^(?:U-NII-\d|WPA[23]|MSC\d{1,2}|E1000E?|VMXNET3|FINISAR-[LS]R)$/, probe: "U-NII-6",
    klass: "non_product", why: "a band, protocol, MCS index, vNIC driver or optic-vendor code read out of a wireless datasheet table; 18 parts, all Cisco, all wireless, 0 facts" },
  // The antenna-OPTION LETTER of an access point's model suffix, enumerated as five parts. The names are
  // the table cell verbatim: AP1542D is "D: Internal directional antenna", AP1562E is "E: External
  // Antenna". The real products are AIR-AP1542D-x-K9. Anchored whole: AP1572EAC / AP1572EC / AP1572IC
  // carry two own facts each and are left alone.
  { kind: "regex", token: "ap-antenna-option-cell", re: /^AP15[46]2[DEI]$/, probe: "AP1542D",
    klass: "non_product", why: "an access-point antenna-option letter read out of a model-suffix table ('D: Internal directional antenna'); 5 parts, 0 facts" },
  // The two vetoed rows are the same class either way and the veto is about REASON STABILITY, which is
  // this table's stated convention ("so every part those already catch keeps its existing reason").
  // C9120-MULTI and C9120-SINGLE are both named "Dummy PIDs on the test orders:" and are already
  // `non_product` through the `name-dummy-pid` rule, whose witness they are in this suite.
  { kind: "regex", token: "ap-pack-option", re: /^C9\d{3}-(?:OVER|MULTI|SINGLE)$/, probe: "C9130-OVER",
    except: ["C9120-MULTI", "C9120-SINGLE"],
    klass: "non_product", why: "an access-point PACKAGING option that ships nothing ('C9130AX OVER OPTION', 'Minimum Quantity = 10', 'SINGLE PACK OPTION'); 6 parts of the shape's 8, 0 facts. The two C9120 rows are named 'Dummy PIDs on the test orders:' and keep their name-dummy-pid reason" },
  // --- unified-communications: the 194 the collab block did not already decide ------------------------
  // Three families, and the UCM- one splits on the MCS SERVER MODEL. A SKU naming a 78xx server is the
  // media kit or server software FOR that server (78 of its 96 names use image vocabulary, 3 entitlement);
  // a SKU naming a VERSION is a User Connect Licence (42 of 48 entitlement-worded, 0 image-worded).
  { kind: "regex", token: "ucm-node-entitlement", re: /^UCM-\d{4}-(?:UPG-)?(?:NODE|PAK)$/, probe: "UCM-7825-NODE",
    klass: "license", why: "'CUCM 7825 Node', 'CUCM 7835 Upgrade Node', 'Include Upg PAK Auto-expanding PAK for CUCM 8.0'; 11 parts, 0 facts. Placed BEFORE cucm-mcs-software, which would otherwise call a node licence a media kit" },
  { kind: "regex", token: "cucm-mcs-software", re: /^UCM-(?:\d\d-)?78\d\d(?:-|$)/, probe: "UCM-7825-85-KIT",
    klass: "software", why: "CallManager media kit and server software for an MCS 78xx ('CUCM 8.5 Media Kit', 'Unified Communications Manager 8.6 Server Software', 'CUCM 5.1 Media Kit for CUWL Only'); 96 parts, 0 facts. The optional two-digit head is the UCM-51-7845-KIT spelling" },
  { kind: "regex", token: "cucm-put-software", re: /^UCM?-\d+(?:\.(?:\d+|X))?-SW-K9/, probe: "UCM-10.5-SW-K9-XU",
    klass: "software", why: "'CUCM Software Version 10.X for PUT Only, Export Unrestricted' and its UC- spelling ('CUCM Software Version 14 for MCE Only'); 11 parts, 0 facts" },
  { kind: "regex", token: "cucm-user-licence", re: /^UCM-(?:90|9X|10X|11X|12X)-/, probe: "UCM-11X-ESS-UCL",
    klass: "license", why: "UC Manager User Connect, HCS and EA licence by version ('BE6K UCM 11X Enhanced User Connect Lic', 'UC Manager 10.x License for HCS Basic'); 48 parts, 0 facts. The five version tokens are the ones read, not a bare UCM-\\d" },
  // Jabber. The class was not a judgement call in the end: 54 of the family's 102 rows are ALREADY
  // `license` in this table through the -RTU, -UWL and -LIC suffixes, so calling the remaining 48
  // anything else would put one product in two classes. 16 of the 48 sit in collaboration-endpoints
  // under the same SKU spellings — no pattern separates them, they hold no fact either, and they are
  // named in docs/reports/schema-wl-uc-class-2026-09-12.md for that lane's owner to check.
  { kind: "regex", token: "jabber-client", re: /^JAB(?:BER|G)?[89]?-/, probe: "JAB9-DSK-CLNT-EA",
    klass: "license", why: "Jabber client, guest and SDK seat licence ('Jabber for Desktop 9.x Client License for Windows/Mac', 'Jabber Guest Right to Use'); 48 parts newly decided of 102 matched, 0 facts, unified-communications 32 and collaboration-endpoints 16" },
  { kind: "regex", token: "ps-calling-software", re: /^CALL-SW-\d/, probe: "CALL-SW-12.X-K9",
    klass: "software", why: "'PS Calling for EMEAR - Software Version 12'; 6 parts, 0 facts" },
  // E3C WAS IN THE RULE ABOVE AND IS NOT ANY MORE, and the suite is why. The first draft read
  // `^(?:CALL|E3C)-SW-\d` on the strength of ONE row — E3C-SW-15-K9, whose name is only its SKU — and
  // the family was not read. It is two rows, and the other one, E3C-SW-14-K9, is named "On-Premises SW
  // Bundle v14 (1)" and is already a LICENCE, decided by this file's `name-sw-bundle` rule. So the wider
  // form got the class wrong (software for a licence) AND took the only live witness `name-sw-bundle`
  // has, which turned the "every rule fired at least once" assertion red. The v15 sibling is taken
  // exactly, so the v14 row keeps its reason and the name rule keeps its witness.
  { kind: "exact", token: "E3C-SW-15-K9", klass: "license", why: "'Cisco E3C-SW-15-K9' — the v15 of the Enterprise Agreement on-premises software bundle whose v14 sibling E3C-SW-14-K9 is named 'On-Premises SW Bundle v14 (1)' and is already a licence by name; 1 part, 0 facts" },
  // end wl-uc-class
];

/** The reason string a rule emits — the same slug runs/vocab/cisco-round2 uses. */
export function ruleName(r: SkuRule): string {
  return `sku-${r.kind}:${r.token}`;
}

/** Every reason prefix this file can emit, so a test can prove each rule fired at least once. */
export const RULE_NAMES = [
  "empty-sku",
  ...SKU_RULES.map(ruleName),
  // EVERY REASON classify() CAN EMIT MUST BE LISTED HERE. reclassify.ts asks ownedReason() whether
  // a row's existing reason came from this table, and refuses to touch it if not — "an unexplained
  // class is not this table's to overwrite". Correct, and it means a rule added WITHOUT its name
  // here produces rows this table can never correct again: on 10 Sep 2026 the four name rules and
  // ucs-kind-os-license were missing, so 400 tracer SKUs that classify() now calls non_product
  // stayed `license`, reported as "left alone because this table did not decide their class" —
  // about a class this table had decided an hour earlier.
  "name-lic-key", "name-entitlement", "name-sw-bundle", "name-user-tier",
  "name-software-image",
  "name-dummy-pid",
  // collab-class (12 Sep 2026)
  "name-ordering-question",
  // end collab-class
  "ucs-kind-os-license",
  "ucs-kind-non-product",
  // fallback-kinds (12 Sep 2026) — FOUR REASONS THAT WERE EMITTED AND NEVER REGISTERED, found on
  // merge by grepping every `reason:` in this file against this list. The comment at the head of
  // RULE_NAMES describes exactly what that costs: reclassify's `ownedReason()` refuses to touch a
  // row whose reason is not here, so these four would have produced rows the table could never
  // correct again — the same defect as the four name rules on 10 Sep, which left 400 tracer SKUs
  // stranded at `license` while classify() called them non_product. Registered before the rules
  // ever ran, so no row was stranded this time.
  "name-marker-not-a-part",
  "name-ordering-artefact",
  "name-regulatory-label",
  "ucs-datasheet-cell",
  // `ownedReason()` matches an exact reason OR one that begins `<name>:`, so a family of reasons
  // registers as its bare prefix — the form `category-is_hardware=true` has always used.
  "stray-device",
  // the parked-row re-examination (12 Sep 2026): `datasheet-cell:<shape>`, eight shapes
  "datasheet-cell",
  // round-7 ruling C (12 Sep 2026): the bundle plan's leaving families (bundleFamily.ts BUNDLE_PLAN_REASONS).
  // `bundle-plan` and `not-sellable` register as prefixes, the `<name>:` form ownedReason() accepts.
  "bundle-plan",
  "programme-or-solution-label",
  "not-sellable",
  "expired-promotion",
  "packaging-not-a-product",
  "category-is_hardware=false",
  "category-is_hardware=true",
  "category-unknown",
] as const;

/** The SKU as the rules see it: trimmed, upper-cased, spare suffix removed. */
export function ruleSku(sku: string): string {
  return String(sku ?? "").trim().toUpperCase().replace(/=+$/, "");
}

/** Does `rule` fire on an already-normalised SKU? Exported so the proof can drive one rule at a time. */
export function ruleMatches(rule: SkuRule, sku: string): boolean {
  if (rule.except?.some((x) => sku.includes(x))) return false;
  if (rule.kind === "prefix") return sku.startsWith(rule.token);
  if (rule.kind === "suffix") return sku.endsWith(rule.token);
  // A regex rule with no pattern would silently match NOTHING and report success — the failure
  // shape this repo pays for most often — so it throws instead.
  if (rule.kind === "regex") {
    if (!rule.re) throw new Error(`SkuRule ${ruleName(rule)} is kind "regex" and carries no pattern`);
    return rule.re.test(sku);
  }
  // `exact` MUST be its own branch. This function used to end in a bare `return sku.includes(...)`,
  // so any kind it did not name fell through to CONTAINS — an `exact: "NX-OS"` rule would have
  // silently matched every NX-OS-* SKU. Every kind is now named and an unknown one throws.
  if (rule.kind === "exact") return sku === rule.token;
  if (rule.kind === "contains") return sku.includes(rule.token);
  throw new Error(`SkuRule ${ruleName(rule)} has unknown kind "${String(rule.kind)}"`);
}

/**
 * Names that say "licence" and are safe to act on, measured 9 Sep 2026.
 *
 * WHY A NAME RULE AT ALL. `classify()` ends with `categoryIsHardware === true -> hardware`, so a
 * part in a hardware category whose SKU matches no rule is called hardware whatever its name says.
 * In `security` that put 1,998 of 6,544 "hardware" parts on names like
 * `ESA-MFE-3Y-S2  "Email McAfee Anti-Virus 3Y Lic Key, 100-499 Users"`, and because only hardware
 * is scored, every one of them was being asked for a weight and an operating temperature.
 *
 * WHY ONLY FOUR PATTERNS. Eleven were measured. The test is whether a pattern catches a part that
 * carries a PHYSICAL fact — a weight, dimensions, a power draw, an operating temperature — because
 * that is evidence somebody measured a physical object and a licence has none.
 *
 * Run against `security` alone, ALL ELEVEN passed, and that verdict was worthless: only 17 of its
 * 6,544 hardware parts carry a physical fact at all, so there was almost nothing to refuse them
 * with. Re-run against switches/routers/wireless/transceiver — 23,714 parts, 3,723 with physical
 * facts — six of the eleven were refused:
 *
 *     word-license   \blicense\b        1,555 hits, 220 catch real hardware
 *                                       (IE3300-NW-A= "Network Advantage License", 2 physical)
 *     bundle-bare    \bbundle\b           980 hits,   6  (NC55-32T16Q4H-BA is a line card)
 *     lic-abbrev     \blic\b              406 hits,  19  (NCS-57B1-5DSE-SYS "Fixed Scale HW")
 *     subscription   \bsubscription\b     138 hits,  25  (C1E1TN9300XF-5Y)
 *     term-bare      \bterm\b             176 hits,  13
 *     n-year-lic     \b\d+\s*Y\s+lic      13 hits,   12
 *
 * That is this project's recurring lesson in one measurement: the wider net always scores better
 * in the population you are looking at, because its false positives are the rows that look like
 * the true ones. The four below catch 762 of security's 6,544 (11.6%) and zero physical-fact parts
 * in either population. They do NOT catch every licence — roughly half of the misfiled ones stay
 * hardware — and that is the correct trade: a licence left as hardware is a bad score, a real
 * appliance called a licence is a deleted product.
 */
export const NAME_LICENSE_RULES: { name: string; re: RegExp }[] = [
  { name: "name-lic-key", re: /\blic(?:ence|ense)?\s*key\b/i },
  { name: "name-entitlement", re: /\bentitlement\b/i },
  { name: "name-sw-bundle", re: /\b(?:sw|software)\s+bundle\b/i },
  // "100-499 Users", "5K-9999 Users" — a user TIER band, which only a licence is sold in.
  { name: "name-user-tier", re: /\b\d[\d,kK]*\s*-\s*[\d,kK]+\s+users?\b/i },
  // 10 Sep 2026. The name says the part IS software, not that it SHIPS WITH some — which is the
  // whole distinction round 3 could not draw with `\blic\b`. Anchored at the START for the two
  // "Software licence/for" forms so it cannot fire on a trailing clause ("...Base and LAN
  // Enterprise License Bundle"), and matched anywhere only for two unambiguous Cisco phrases.
  // 75 hits across the corpus, ZERO carrying a physical fact, and only one outside the obvious
  // categories: NCS2K-R-S1200K9 "Software for SVO Node", which is software.
  //
  // THIS REPLACED A `-SW` SUFFIX RULE. That rule was clean on switches (73 hits, every name
  // saying "Software license for C2960L" or "IOS build PID") and in `transceiver` -SW means
  // SHORT WAVELENGTH: DS-SFP-FC16G-SW and ONS-QC-16GFC-SW are Fibre Channel optics carrying real
  // physical facts. A name cannot be confused by a reach code; a SKU suffix can.
  { name: "name-software-image", re: /^(?:cisco\s+)?software\s+(?:licen[cs]e|for)\b|\bIOS build PID\b|\bBTS IOS\b/i },
];

export function classify(input: ClassifyInput): Classification {
  const sku = ruleSku(input.sku);
  if (!sku) return { klass: "unknown", reason: "empty-sku" };

  for (const rule of SKU_RULES) if (ruleMatches(rule, sku)) return { klass: rule.klass, reason: ruleName(rule) };

  // round-7 ruling C (12 Sep 2026): the 125 bundle-plan rows that leave `hardware` — 31 software subscriptions,
  // 78 programme/solution labels, 7 self-declared unsellable SKUs, 7 expired promotions and 2 packing pallets.
  // An EXPLICIT (category, sku) list read from the frozen approved reading, never a kind name or a name rule;
  // see bundleFamily.ts for why each of those would have been wrong. After the SKU rules, so a SKU a rule
  // already names keeps that answer.
  const plan = bundlePlanClass(input.sku, input.categorySlug);
  if (plan) return { klass: plan.klass, reason: plan.reason };

  // AFTER the SKU rules and BEFORE the category fallback. The SKU is the more authoritative
  // signal and keeps precedence; the name only gets a say where the SKU said nothing, which is
  // exactly the case that was defaulting to `hardware` on the strength of the category alone.
  // UCS OS AND SUBSCRIPTION SKUS, category-scoped. `servers-unified-computing` carries 3,131
  // parts (25%) that are VMware, SUSE, Red Hat, Windows Server, Citrix, UCS Director, Intersight
  // and Cisco ONE subscriptions sold under a UCS part number and classed `hardware` — so each was
  // scored as a server. No name rule reaches them: "VMware vSphere 5 Enterprise" never says
  // "license". The SKU token does, and ucsKind already names it.
  //
  // Scoped to this category because the prefixes collide elsewhere: `C1-` here is a Cisco ONE
  // software suite and in switches it is `C1-N9K-C9508`, a real Nexus chassis.
  //
  // Acceptance measured before shipping: 0 of the 3,131 carries an OWN (non-inherited) physical
  // fact. The `own` matters — every one of this category's 3,110 inherited facts comes from a
  // GROUP rather than a part, and 878 are physical, so counting inherited facts would have failed
  // this check against values the parts never had.
  // servers (12 Sep 2026): the two hyperconverged categories derive the same ucsKind (partKind.ts). Their
  // os-license rows are 126 NVIDIA GRID / Windows Server / DC-MGT / VMware-terms SKUs ("NVIDIA GRID Software
  // Subscription - VDI Apps 1CCU - 5 Year") and their non-product rows 15 ordering settings (HX-E-TOPO1
  // "10GbE Single or Dual Switch", HCI-IS-MANAGED "Deployment mode ..."); 0 own physical facts in either.
  if (input.categorySlug === "servers-unified-computing" || input.categorySlug === "hyperconverged-systems"
      || input.categorySlug === "hyperconverged-infrastructure") {
    const k = ucsKind(input.sku);
    if (k === "os-license") return { klass: "license", reason: "ucs-kind-os-license" };
    // NOT A PRODUCT. Distinct from `unknown` on purpose: both leave the SCORE, only this one
    // leaves the POPULATION. `unknown` is unfinished work and must keep being counted as
    // something to determine; a solution-ID tag has been determined, and the determination is
    // that it is not a thing anyone ships.
    if (k === "non-product") return { klass: "non_product", reason: "ucs-kind-non-product" };
  }

  const name = typeof input.name === "string" ? input.name : "";
  // A DUMMY PID SHIPS NOTHING (11 Sep 2026, reviewer round). "Dummy PID to Track First PS S/N, 1025WAC
  // Kingfisher", "Dummy PIDs on the test orders:", "N5596 Dummy PID - Not for use outside of N5K/N2K
  // bundles": 71 catalogue names say dummy / tracker / placeholder PID and NONE holds a physical fact.
  // Only "dummy" and "placeholder" are matched: NCS-55A1-24Q6-TRK is a "chassis HW Tracking PID" — in
  // the consumption model the chassis ships under it — and the Cisco ONE "Tracker PID v01 ... no
  // delivery" rows are already licences by their SKU rule, which runs first.
  if (/\bdummy pids?\b|\bplaceholder pid\b/i.test(name)) return { klass: "non_product", reason: "name-dummy-pid" };
  // collab-class (12 Sep 2026) — AN ORDERING-TOOL QUESTION IS NOT A PRODUCT. Cisco's collaboration
  // configurators enumerate their own prompts as part numbers: ER-10.X is named "Select when
  // upgrading from Cisco Emergency Responder 10.X", EXIST-DEPL-OVER10K is "Total Deployment is Over
  // 10,000 users", TP-ROOM-12 is "Choose if Expway or for CUCM version 11.x TP-Room License". There
  // is no SKU shape in common — that is why this is a name rule and not five more exact rules.
  //
  // WHY THIS NAME RULE IS SAFE WHERE THE ROUND-3 LICENCE ONES WERE NOT. The failure mode of a name
  // rule here is that a name DESCRIBES THE DEVICE IT LICENSES; these names describe nothing at all,
  // they instruct the person ordering. Measured over all 91,543 live parts and all 13 vendors: 97
  // parts match, every one Cisco, every one in these three categories, and NOT ONE holds a fact of
  // any kind. It runs AFTER every SKU rule, so a family whose SKU is already known keeps its class —
  // CUP-SERVER8.0-K9 is named "Number of Cisco Unified Presence 8.x nodes required" and is a server
  // licence by its SKU, which is the case that decided the ordering.
  if (/^select (?:when|for|if) |^total deployment is |^choose if |^migrating from |^number of /i.test(name)) {
    return { klass: "non_product", reason: "name-ordering-question" };
  }
  // end collab-class
  // --- fallback-kinds (12 Sep 2026): P-5, the not-a-product NAME shapes -------------------------
  //
  // Four of the asked-nothing survey's six adopted shapes. Each was re-measured over ALL 91,543 live
  // parts and all 13 vendors with the test this file's own name rules were built on — does it catch a
  // part carrying an OWN PHYSICAL FACT? — and then its rows were READ, because the control is
  // necessary and not sufficient (see the two refusals below, which is what reading found).
  //
  //   shape                          hits  vendors  hardware today  physical facts  any own fact
  //   R1 marker name                  135   cisco              111               0             1
  //   R2 ordering artefact            285   cisco              281               0             0
  //   R3 regulatory / asset label      46   cisco               45               0             0
  //   R8 datasheet cell (UCS only)     45   cisco               43               0             0
  //
  // THE ONE OWN FACT is AIR-ANT5175V-N, named "NOT USED 4.9 GHz-5.8 GHz Omni with N Connector" — a
  // withdrawn antenna PID whose own name says it is withdrawn, holding one non-physical fact. Named
  // here rather than vetoed: the vendor's statement about its own part number is the evidence.
  //
  // TWO OF THE SIX ARE **NOT BUILT**, and both refusals came from reading rows the control passed:
  //
  //   R4 session / subscriber capacity licence. 1,239 hits, 0 physical facts — and of the five rows
  //      still classed `hardware`, FOUR ARE REAL APPLIANCES: CUBESP-AP-H250B/K9 "CUBE(SP)
  //      appliance,250 Session,10G Engine,2xSIP10,16xGE,HA", H500B, and two siblings. The fifth,
  //      CN-BNG-100k-L "Session scale for 100K subscribers", is the licence the rule was written for.
  //      A rule that moves one row and can eat four appliances is a bad trade at any exchange rate,
  //      and they are in the routers owner's lane. A narrowed form — require a K/M thousands marker
  //      and veto `appliance` — is put up as a PROPOSAL in the report instead of written here.
  //   R5 "the name is only a release". 119 hits and ZERO rows classed hardware, so it would move
  //      nothing today; and four of its hits are MDS supervisor images whose names END with the
  //      release they ship with (M92S5K9-6.2.11C "MDS 9250i Supervisor/Fabric-3, NX-OS Software
  //      Release 6.2.11C"). That is the exact trap the survey documented for the LOOSE form arriving
  //      one notch tighter. A rule with no population and a known failure mode is not worth its risk.
  //
  // Every one of the four runs AFTER every SKU rule, so a family whose SKU is already known keeps its
  // class, and each is pinned in tests/productClass.test.ts with a refusal beside its positives.

  // R1. The vendor's own statement that a PID ships nothing: "VOID; Not Used", "DO NOT PUBLISH",
  // "Obsolete PID", "PID not used". `not used` is matched anywhere, the bare `void` only at the start
  // (a name may legitimately contain "avoid"), and "not orderable" / "do not order" join them because
  // the same rows carry both spellings.
  // The `\bhardware\b` guard is this file's own, adopted for the same reason it was written: a name
  // that calls itself hardware is not a withdrawn PID, and "Motorola PSC2 LTE Hardware and Software
  // bundle" is the row that taught the file that lesson once already.
  if (!/(^|[^a-z])hardware([^a-z]|$)/i.test(name)
    && /do not publish|obsolete pid|pid not used|(^|[^a-z])(?:not used|not in use|not orderable|do not order)([^a-z]|$)|^\s*\^?(?:void|not used)/i.test(name)) {
    return { klass: "non_product", reason: "name-marker-not-a-part" };
  }
  // R2. An ORDERING ARTEFACT: a line the configurator emits, not a thing in a box. 281 rows, 277 of
  // them in `wireless`: "BOM Level AP2800E Bulk PID for B Domain (CFG)", "Regulatory Domain
  // Configuration", "Base PID", "Contains packing Kit For 2KI". Anchored at the START, because these
  // are the whole name; matched anywhere, "base PID" appears inside real parts' descriptions.
  if (/^(?:regulatory domain configuration|bom level|base pid|contains packing)/i.test(name)) {
    return { klass: "non_product", reason: "name-ordering-artefact" };
  }
  // R3. A STICKER. "MX200 NAL label for China - for auto expand only", "^NAL Certification labels for
  // China for C8200-1N-4T", "asset tab ID label". 45 rows, no vendor but Cisco, no facts.
  if (/(^|[^a-z])nal (?:certification )?labels?([^a-z]|$)|certification labels? for|(^|[^a-z])asset tab id label([^a-z]|$)/i.test(name)) {
    return { klass: "non_product", reason: "name-regulatory-label" };
  }
  // R8. A DATASHEET CELL ENUMERATED AS A PART — "94GB", "2.DDR4-3200MHz", "64108", "10/25/50G" — and
  // THE CATEGORY SCOPE IS THE REFUSAL, not a detail of it. The identical SKU shape in `video` is the
  // Scientific-Atlanta catalogue: the survey built the narrowed, evidence-free version of this rule
  // without the scope and it still selected 568 parts, 534 of them real video product, because
  // `1030032` sits between two described channel filters. Inside these three categories all 45
  // members were read one at a time: 0 facts, 0 documents, 0 descriptions. The name test is part of
  // the rule — a bare number that HAS acquired a description is no longer this shape.
  if ((input.categorySlug === "servers-unified-computing" || input.categorySlug === "hyperconverged-systems"
      || input.categorySlug === "hyperconverged-infrastructure")
    && (/^[\d./]+$/.test(input.sku) || /^[\d.]+ ?(?:gb|tb|mb|ge|mhz|ghz|nm|v|w|a)$/i.test(input.sku)
      || /^\d+\/[\d/]+g?$/.test(input.sku) || /^\d+\.DDR\d/i.test(input.sku))
    && nameIsJustTheSku(input.sku, name)) {
    return { klass: "non_product", reason: "ucs-datasheet-cell" };
  }
  // end fallback-kinds ---------------------------------------------------------------------------

  // ---- THE PARKED ROWS, on the operator's instruction to re-examine them (12 Sep 2026) ----------
  //
  // 760 parts carry `product_class_reason = "catalogue-noise: fails is_part_number"` and sit at
  // `unknown`, so they are in NO denominator — not hardware, not non-product, asked nothing,
  // counted nowhere. `reclassify` refuses to touch them and is RIGHT to: the reason is one
  // `classify()` cannot emit, so a person decided them, and a catch-up pass that silently undoes a
  // deliberate decision is worse than no catch-up pass.
  //
  // The re-examination the operator asked for produced the opposite of what was expected. 555 of
  // the 760 are accepted by TODAY'S `is_part_number`, and the unread-families survey read that as a
  // stale verdict — but 551 of those 555 are ONE family, NCS 2000 assembly numbers, with ZERO own
  // facts and ZERO documents between them. Passing the predicate says the SHAPE is plausible; it is
  // not evidence a product exists. So the parking stands for them, and this block claims only the
  // rows whose shape says outright that they are a cell lifted out of a table.
  //
  // Measured over all 91,543 live parts before being written, and TWO SHAPES WERE NARROWED BY THAT
  // MEASUREMENT rather than by argument:
  //   `^\d+\.\d+` for an IOS release caught 435 rows outside the cohort, 77 WITH PHYSICAL FACTS —
  //      `4022938.58` and `4011176.012.000.AB` are Scientific-Atlanta transmitters whose digits
  //      after the dot are an ITU CHANNEL, which CLAUDE.md already records. Bounded to a 1-2 digit
  //      major version, which no seven-digit S-A number can satisfy.
  //   `BASE-?[A-Z]` for a PHY name caught `VIP-SFP-1GE-BASET`, `C1-UCD-BASE-K9` and
  //      `MC-S-BASE-SM` — real SKUs with "BASE" as a word. Anchored to the start, where a clause
  //      name begins with its speed.
  // After narrowing, every shape below catches ZERO parts with a physical fact anywhere in the
  // catalogue, and the name gate is the same one the UCS rule above uses: a bare token that HAS
  // acquired a description is no longer this shape.
  const CELL_SHAPES: [string, RegExp][] = [
    ["phone-number", /^1-800-\d{3}-\d{4}$/],                                    // 1-800-722-2009, enumerated as a part
    ["magnitude-unit", /^[\d.]+ ?(?:K|M|W|A|V|GB|MB|GE|G|VAC|VDC|MHZ|GHZ|NM|DB|DBM|BTU|LBS?|KG|IN|FT)$/i],
    ["current-range", /^[\d.]+-[\d.]+ ?(?:A|W|V|MA)$/i],                        // 0.9-1.6A, a PSU's draw
    ["ios-release", /^\d{1,2}\.\d{1,2}(?:[._(]|[A-Z]?$)/],                      // 15.2.1T, 12.4(24)T
    ["phy-clause-name", /^\d+G?BASE-?[A-Z]/i],                                  // 1000BASE-LH, 0GBASE-SR
    ["config-cell", /^1\.[A-Z0-9]/i],                                           // 1.HHHL, 1.SSD, 1.UPI
    ["n-noun-cell", /^\d-[A-Z]{2,}$/i],                                         // 1-CPU, 2-CPU
    ["ip-subnet", /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/],                   // five RFC-1918 subnets
  ];
  for (const [tag, re] of CELL_SHAPES) {
    if (re.test(input.sku) && nameIsJustTheSku(input.sku, name)) {
      return { klass: "non_product", reason: `datasheet-cell:${tag}` };
    }
  }
  // end parked rows ------------------------------------------------------------------------------
  // A NAME THAT SAYS HARDWARE OVERRIDES ALL FOUR. Found by reading the dry run rather than by
  // reasoning: `ASR5K-0F-B00-2069=` is a "Motorola PSC2 LTE Hardware and Software bundle", so
  // `name-sw-bundle` fired on a name that calls itself hardware in the same clause. A licence is
  // never described as hardware, so this costs nothing and stops the one class of false positive
  // the physical-fact test could not see — the part has no facts at all, so nothing protected it.
  if (name && !/\bhardware\b/i.test(name)) {
    for (const r of NAME_LICENSE_RULES) if (r.re.test(name)) return { klass: "license", reason: r.name };
  }

  const slug = input.categorySlug ? String(input.categorySlug) : "?";
  // fallback-kinds (12 Sep 2026), reviewer §8: A REAL DEVICE FILED IN A SOFTWARE CATEGORY.
  // The 51 rows reclassify run 973's evidence guards refused — Cisco 8000 and NCS routers, Nexus
  // 9300s, a Catalyst 2960-X, Catalyst 9166 access points, NICs and line cards — are named families
  // in src/core/strayDevice.ts. The guard in the pipeline is the belt; this is the braces, and it is
  // here rather than in a comment because a sampling guard in one command is not a refusal in the
  // code. It sits AFTER every SKU rule and every name rule, so nothing it can reach was already
  // decided; the real repair is a category MOVE and it is a proposal, not a write.
  const stray = strayDevice(input.sku);
  if (stray && input.categoryIsHardware === false) {
    return { klass: "hardware", reason: `stray-device:${stray.kind}` };
  }
  if (input.categoryIsHardware === false) return { klass: "software", reason: `category-is_hardware=false:${slug}` };
  if (input.categoryIsHardware === true) return { klass: "hardware", reason: `category-is_hardware=true:${slug}` };
  return { klass: "unknown", reason: `category-unknown:${slug}` };
}
