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
  { kind: "prefix", token: "WAE-SUB", klass: "license", why: "WAN Automation Engine subscription ('WAE Basic Planning Pkg, 500-999 devices'); same family, same gate" },
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
  "ucs-kind-os-license",
  "ucs-kind-non-product",
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
  if (input.categorySlug === "servers-unified-computing") {
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
  // A NAME THAT SAYS HARDWARE OVERRIDES ALL FOUR. Found by reading the dry run rather than by
  // reasoning: `ASR5K-0F-B00-2069=` is a "Motorola PSC2 LTE Hardware and Software bundle", so
  // `name-sw-bundle` fired on a name that calls itself hardware in the same clause. A licence is
  // never described as hardware, so this costs nothing and stops the one class of false positive
  // the physical-fact test could not see — the part has no facts at all, so nothing protected it.
  if (name && !/\bhardware\b/i.test(name)) {
    for (const r of NAME_LICENSE_RULES) if (r.re.test(name)) return { klass: "license", reason: r.name };
  }

  const slug = input.categorySlug ? String(input.categorySlug) : "?";
  if (input.categoryIsHardware === false) return { klass: "software", reason: `category-is_hardware=false:${slug}` };
  if (input.categoryIsHardware === true) return { klass: "hardware", reason: `category-is_hardware=true:${slug}` };
  return { klass: "unknown", reason: `category-unknown:${slug}` };
}
