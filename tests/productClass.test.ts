// tests/productClass.test.ts — proof for src/core/productClass.ts over real Cisco part numbers.
//
//   npx tsx tests/productClass.test.ts
//
// Every SKU below exists in data/reference (cisco-enumeration-full.json, datasheet-skus-full.json
// or cisco-eol-pids.json); none was invented to fit a rule. The cases are chosen for the ways a
// classifier goes wrong, not for the easy middle: a spare suffix that must not change the class,
// a licence sold inside a hardware category, a hardware-looking PID inside a software category,
// lower-case input, and the empty string. The suite also asserts that EVERY rule in the
// docs/DATA_MODEL.md table fired at least once — a rule no case reaches is a rule nobody has
// seen work — and that the reason names the rule, because parts.product_class_reason is how a
// wrong class is traced back.
import fs from "node:fs";
import { classify, ruleSku, ruleName, ruleMatches, RULE_NAMES, SKU_RULES, type ProductClass, type SkuRule } from "../src/core/productClass.js";

type Case = { sku: string; cat?: string; hw?: boolean | null; want: ProductClass; reason: string; note?: string };

const cases: Case[] = [
  // ---- service ----------------------------------------------------------------------------
  { sku: "CON-SNT-C9200L24", cat: "switches", hw: true, want: "service", reason: "sku-prefix:CON-", note: "SmartNet for a switch: the category is hardware, the SKU rule wins" },
  { sku: "CON-ECMU-CT8500UP", cat: "wireless", hw: true, want: "service", reason: "sku-prefix:CON-" },
  { sku: "con-snt-c9200l24", cat: "switches", hw: true, want: "service", reason: "sku-prefix:CON-", note: "lower-case input" },

  // ---- license: prefixes ------------------------------------------------------------------
  { sku: "L-C9200-24-E-A", cat: "switches", hw: true, want: "license", reason: "sku-prefix:L-" },
  { sku: "L-C9200-24-E-A=", cat: "switches", hw: true, want: "license", reason: "sku-prefix:L-", note: "spare suffix on a licence is still the licence" },
  { sku: "L-12KSR-EPN2SFDN", cat: "cloud-systems-management", hw: false, want: "license", reason: "sku-prefix:L-" },
  // Round 3, 8 Sep 2026. Both sat in `security` classed hardware by the category fallback alone,
  // so each was carrying an appliance profile — a weight and an operating temperature — that a
  // monthly cloud subscription can never satisfy.
  { sku: "MSLA-XDR-ADV-AP-F", cat: "security", hw: true, want: "license", reason: "sku-prefix:MSLA-", note: "Managed Service Licence Agreement inside a hardware category" },
  { sku: "SPLA-UMB-DNS-A-K9", cat: "security", hw: true, want: "license", reason: "sku-prefix:SPLA-", note: "Service Provider Licence Agreement; the -K9 crypto suffix does not make it hardware" },
  { sku: "S-ISE-APX-1YR-100", cat: "security", hw: true, want: "license", reason: "sku-prefix:S-ISE-", note: "the existing ISE- rule cannot reach it: the S- puts the token off the front" },
  { sku: "ASA-CSC10-100U-1Y", cat: "security", hw: true, want: "license", reason: "sku-prefix:ASA-CSC", note: "a CSC-SSM user licence" },
  { sku: "ASA-CSC20-PLUS=", cat: "security", hw: true, want: "license", reason: "sku-prefix:ASA-CSC", note: "and a Plus licence with a spare suffix" },
  // THE VETO THAT MATTERS: the module the licences above are FOR must stay hardware. `ASA-CSC` was
  // chosen over the bare `CSC` token precisely so this case cannot be swallowed.
  { sku: "CSC-SSM-10", cat: "security", hw: true, want: "hardware", reason: "category-is_hardware=true:security", note: "the real Content Security and Control module — no ASA- prefix, so no rule fires" },
  { sku: "LIC-CT5508-25A", cat: "wireless", hw: true, want: "license", reason: "sku-prefix:LIC-" },
  { sku: "SL-1100TG-APP-K9", cat: "routers", hw: true, want: "license", reason: "sku-prefix:SL-" },
  { sku: "E-15454-R1061SWK9=", cat: "optical-networking", hw: true, want: "license", reason: "sku-prefix:E-", note: "e-delivery licence with a spare suffix" },
  // ---- license: round 3, the SKUs whose only licence evidence is their NAME -----------------
  // Every one of these was classed 'hardware' by the category fallback and inherited a chassis's
  // certifications, operating temperature and altitude ceiling.
  { sku: "NC55P-ADVL3-5501S=", cat: "routers", hw: true, want: "license", reason: "sku-prefix:NC55P-", note: "'NCS 5500 L3VPN Lic for NCS-5501-SE'. 312 such parts, all classed hardware, 297 of them in one datasheet's PID list" },
  { sku: "NC55P-MSEC-50T=", cat: "routers", hw: true, want: "license", reason: "sku-prefix:NC55P-" },
  { sku: "IAP-VNF-LG-3Y", cat: "routers", hw: true, want: "license", reason: "sku-prefix:IAP-VNF-" },
  { sku: "NSO-VNFM-100", cat: "routers", hw: true, want: "license", reason: "sku-prefix:NSO-VNFM-" },
  { sku: "CUIC-PHY-PRE-K9", cat: "video", hw: true, want: "license", reason: "sku-prefix:CUIC-PHY-" },
  { sku: "IAP-NE-LG-1Y", cat: "routers", hw: true, want: "license", reason: "sku-prefix:IAP-NE-LG-" },
  { sku: "FL-SRST-168", cat: "routers", hw: true, want: "license", reason: "sku-prefix:FL-SRST-" },
  { sku: "FL-CCME-100", cat: "routers", hw: true, want: "license", reason: "sku-prefix:FL-CCME-" },
  { sku: "ASA-AC-E-5510=", cat: "security", hw: true, want: "license", reason: "sku-prefix:ASA-AC-E-" },
  { sku: "FP7010-URL-SIG", cat: "security", hw: true, want: "license", reason: "sku-suffix:-SIG" },

  // ---- license: suffixes and infixes ------------------------------------------------------
  { sku: "P2-CH-F-F-28-F-AAE", cat: "video", hw: true, want: "license", reason: "sku-suffix:AAE" },
  { sku: "15454-M-LIC-100G=", cat: "optical-networking", hw: true, want: "license", reason: "sku-contains:-LIC-" },
  { sku: "C9300-DNA-A-24-3Y", cat: "switches", hw: true, want: "license", reason: "sku-contains:DNA" },
  { sku: "C9200-DNA-E-24-3Y", cat: "switches", hw: true, want: "license", reason: "sku-contains:DNA" },
  { sku: "AIR-DNA-A-3Y", cat: "wireless", hw: true, want: "license", reason: "sku-contains:DNA" },

  // ---- round 2 (runs/vocab/cisco-round2/product-class-rules.json) --------------------------
  // Every SKU here is a row in the live parts table today, every one is currently classed
  // `hardware`, and every one is a licence, a subscription, a software image or a service.
  { sku: "A-FLEX-01-12.5-K9", cat: "unified-communications", hw: true, want: "license", reason: "sku-prefix:A-FLEX-", note: "Webex Flex Plan: the safe subset of the REJECTED bare A- prefix" },
  { sku: "A-SUB-210-3PC-NA", cat: "unified-communications", hw: true, want: "license", reason: "sku-prefix:A-SUB-" },
  { sku: "3PTY-UWL-RTU", cat: "unified-communications", hw: true, want: "license", reason: "sku-contains:-UWL-", note: "matches -UWL- and -RTU; the table order decides the reason" },
  { sku: "3PTY-CLIENT-UWL", cat: "unified-communications", hw: true, want: "license", reason: "sku-suffix:-UWL" },
  { sku: "AC-APX-1YR-100", cat: "security", hw: true, want: "license", reason: "sku-prefix:AC-APX" },
  { sku: "AC-PLS-1YR-100", cat: "security", hw: true, want: "license", reason: "sku-prefix:AC-PLS" },
  { sku: "ISE-10VM-K9=", cat: "security", hw: true, want: "license", reason: "sku-prefix:ISE-", note: "a VM entitlement with a spare suffix" },
  { sku: "ISE-PLS-1YR-100", cat: "security", hw: true, want: "license", reason: "sku-prefix:ISE-", note: "was classed by the category before round 2; the SKU rule is the right answer" },
  { sku: "C1F13CT1P-T-ADVG", cat: "switches", hw: true, want: "license", reason: "sku-prefix:C1F", note: "Cisco ONE Foundation perpetual software, sold under a switch category" },
  { sku: "C9200-DNX-A-24-3Y", cat: "switches", hw: true, want: "license", reason: "sku-contains:-DNX-", note: "the round-1 table catches DNA and misses DNX" },
  { sku: "ADN-8KE-400G-RTU", cat: "routers", hw: true, want: "license", reason: "sku-suffix:-RTU" },
  { sku: "540-ADN-L-RTU-P", cat: "routers", hw: true, want: "license", reason: "sku-contains:-RTU-" },
  { sku: "E3S-CDO5508P", cat: "security", hw: true, want: "license", reason: "sku-prefix:E3S-" },
  { sku: "E2SF-KEN-APPSEC", cat: "security", hw: true, want: "license", reason: "sku-prefix:E2SF-", note: "escapes the round-1 E- prefix because of the digit" },
  { sku: "AMP4E-SEC-SUB", cat: "security", hw: true, want: "license", reason: "sku-suffix:-SUB" },
  { sku: "UCSS-ATT-CUB1-1", cat: "unified-communications", hw: true, want: "license", reason: "sku-prefix:UCSS-" },
  { sku: "8KSW-A-SIA-3", cat: "routers", hw: true, want: "license", reason: "sku-contains:-SIA" },
  { sku: "EVAL-CUIC-BASE-K9", cat: "servers-unified-computing", hw: true, want: "license", reason: "sku-prefix:EVAL-" },
  { sku: "EI-SUBSCRIPTIONS", cat: "switches", hw: true, want: "license", reason: "sku-contains:SUBSCR" },
  { sku: "WAESUBSCRIPTIBDQ8", cat: "routers", hw: true, want: "license", reason: "sku-contains:SUBSCR", note: "no dashes at all: a contains rule, not a suffix" },
  { sku: "SW-CCME-UL-ENH", cat: "unified-communications", hw: true, want: "software", reason: "sku-prefix:SW-" },
  { sku: "SVS-CTIR-DUO-L", cat: "servers-unified-computing", hw: true, want: "service", reason: "sku-prefix:SVS-" },
  { sku: "ASF-CORE-G-SSME-1I", cat: "security", hw: true, want: "service", reason: "sku-prefix:ASF-" },

  // ---- hardware ---------------------------------------------------------------------------
  { sku: "C9200L-24P-4G", cat: "switches", hw: true, want: "hardware", reason: "category-is_hardware=true:switches" },
  { sku: "SFP-10G-SR=", cat: "transceiver", hw: true, want: "hardware", reason: "category-is_hardware=true:transceiver", note: "a spare suffix is not a class change" },
  { sku: "PWR-C5-1KWAC=", cat: "interfaces-modules", hw: true, want: "hardware", reason: "category-is_hardware=true:interfaces-modules" },
  { sku: "WS-C2960X-24PS-L", cat: "switches", hw: true, want: "hardware", reason: "category-is_hardware=true:switches" },
  { sku: "N9K-C93180YC-EX", cat: "switches", hw: true, want: "hardware", reason: "category-is_hardware=true:switches" },
  { sku: "GLC-TE", cat: "transceiver", hw: true, want: "hardware", reason: "category-is_hardware=true:transceiver" },
  { sku: "QSFP-100G-SR4-S", cat: "transceiver", hw: true, want: "hardware", reason: "category-is_hardware=true:transceiver" },
  { sku: "AIR-AP2802I-E-K9", cat: "wireless", hw: true, want: "hardware", reason: "category-is_hardware=true:wireless" },
  { sku: "FPR-1010", cat: "security", hw: true, want: "hardware", reason: "category-is_hardware=true:security" },
  { sku: "ASA5508-K9", cat: "security", hw: true, want: "hardware", reason: "category-is_hardware=true:security" },
  { sku: "C9300-24H", cat: "switches", hw: true, want: "hardware", reason: "category-is_hardware=true:switches" },
  { sku: "ISR1100-4G", cat: "routers", hw: true, want: "hardware", reason: "category-is_hardware=true:routers" },
  { sku: "STACK-CAB-1M", cat: "interfaces-modules", hw: true, want: "hardware", reason: "category-is_hardware=true:interfaces-modules" },
  { sku: "NIM-1GE-CU-SFP", cat: "interfaces-modules", hw: true, want: "hardware", reason: "category-is_hardware=true:interfaces-modules" },
  { sku: "C9K-150W-ADPT", cat: "interfaces-modules", hw: true, want: "hardware", reason: "category-is_hardware=true:interfaces-modules" },
  { sku: "MR24", cat: "meraki", hw: true, want: "hardware", reason: "category-is_hardware=true:meraki" },
  { sku: "UCSC-C220-M5SX", cat: "servers-unified-computing", hw: true, want: "hardware", reason: "category-is_hardware=true:servers-unified-computing" },
  { sku: "CTS-SX20-PHD4X-K9", cat: "collaboration-endpoints", hw: true, want: "hardware", reason: "category-is_hardware=true:collaboration-endpoints" },

  // ---- software: the category decides when no SKU rule fires ------------------------------
  // Until round 8 (11 Sep 2026) this path was exercised by C1A1ATCAT36501, a Cisco ONE subscription.
  // sku-regex:cisco-one now classes that one `license` in every category — as round 7's C1A1TN rule
  // already did for its siblings — so the category path needs a PID no SKU rule reaches. This one
  // also pins that cisco-one does not reach the HYPHENATED C1- form.
  { sku: "C1-ADD-OPTOUT", cat: "software", hw: false, want: "software", reason: "category-is_hardware=false:software", note: "Cisco DNA Premier Add-On Session Opt Out — no SKU rule, the category decides" },
  { sku: "C1A1ATCAT36501", cat: "software", hw: false, want: "license", reason: "sku-regex:cisco-one", note: "a Cisco ONE term subscription: licence by its SKU, whatever category it is filed in" },
  { sku: "8000-SW-LICENSE", cat: "ios-nx-os-software", hw: false, want: "software", reason: "category-is_hardware=false:ios-nx-os-software" },
  // collab-class (12 Sep 2026): this row used to be A-CMS-API, and `sku-regex:webex-collab-subscription`
  // now classes every `A-` + two-letter SKU a licence, so it stopped exercising the category path —
  // the same churn the round-8 note above describes one line up. ICME-ERIAGT-T1 replaces it: one of
  // 1,599 contact-center parts that still reach the fallback after the whole collab block.
  { sku: "ICME-ERIAGT-T1", cat: "contact-center", hw: false, want: "software", reason: "category-is_hardware=false:contact-center", note: "'ERI Agent Licenses - Tier 1' — no SKU rule, no name rule, the category decides" },

  // ---- unknown ----------------------------------------------------------------------------
  { sku: "", cat: "switches", hw: true, want: "unknown", reason: "empty-sku", note: "an empty SKU never gets a hardware profile" },
  { sku: "   ", cat: "switches", hw: true, want: "unknown", reason: "empty-sku" },
  { sku: "=", cat: "switches", hw: true, want: "unknown", reason: "empty-sku", note: "a bare spare suffix is no SKU" },
  { sku: "C9300-24H", cat: undefined, hw: undefined, want: "unknown", reason: "category-unknown:?", note: "no category row: not hardware by default" },
  { sku: "C9300-24H", cat: "firewalls", hw: null, want: "unknown", reason: "category-unknown:firewalls" },

  // ===== modules-misc (12 Sep 2026) ===========================================================
  // The class residue of interfaces-modules, meraki and data-center-networking. Every SKU is a
  // live row; every rule was gated across all 91,682 parts before it was written (the counts are
  // in productClass.ts). The REFUSALS for this block are in `mustStayHardware` below.
  { sku: "C4500E-IPB-S", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-regex:c4500e-feature-license", note: "'IP BASE software license for spare Supervisor Engine 8L-E (paper delivery)' — and it serves an INHERITED ipv6_routes 128000" },
  { sku: "C4500E-LB-ES", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-regex:c4500e-feature-license" },
  { sku: "ASA5500-SC-100=", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-prefix:ASA5500-SC-", note: "'ASA 5500 100 Security Contexts License'" },
  { sku: "ASA-SC-50-100=", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-prefix:ASA-SC-" },
  { sku: "ASA5500-GTP=", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-prefix:ASA5500-GTP" },
  { sku: "SNAM-100VOICE", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-prefix:SNAM-" },
  { sku: "SLFL-29=", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-prefix:SLFL-", note: "'Technology and Feature Paper PAKs for Cisco 2900'; the existing SL- prefix cannot reach it" },
  { sku: "FR-SVC-WVPN-5000", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-prefix:FR-SVC-WVPN-" },
  { sku: "M9200EXT12K9=", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-regex:mds-licence" },
  { sku: "M97IOA24102X", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-regex:mds-licence", note: "the trailing letter is why the pattern ends [A-Z]?" },
  { sku: "L5-D-M97S-AXK9=", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-regex:mds-analytics-term" },
  { sku: "SWLIC-SPA-UBR10-DS", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-prefix:SWLIC-" },
  { sku: "ACE30-MOD-UPG2=", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-regex:ace30-upgrade-entitlement" },
  { sku: "ACE30-UPG-08-K9=", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-regex:ace30-upgrade-entitlement" },
  { sku: "MG21-ENT-5Y", cat: "meraki", hw: true, want: "license", reason: "sku-regex:meraki-term-license" },
  { sku: "MG52E-ENT-10Y", cat: "meraki", hw: true, want: "license", reason: "sku-regex:meraki-term-license" },
  { sku: "HF6100-64ED-SVC-D", cat: "data-center-networking", hw: true, want: "license", reason: "sku-regex:hyperfabric-subscription", note: "'subscription linked bundle'" },
  { sku: "HF6100-32D-SVC", cat: "data-center-networking", hw: true, want: "license", reason: "sku-regex:hyperfabric-subscription" },
  { sku: "UCS-FI-6664-SW", cat: "interfaces-modules", hw: true, want: "license", reason: "sku-regex:ucs-fi-mandatory-sw-license" },
  { sku: "NAM-APPL-SW-5.1-K9", cat: "interfaces-modules", hw: true, want: "software", reason: "sku-regex:release-in-sku" },
  { sku: "N1K-C1010-NAM-4.2=", cat: "interfaces-modules", hw: true, want: "software", reason: "sku-regex:nam-software-image" },
  { sku: "SM-NAM-SW-5.1", cat: "interfaces-modules", hw: true, want: "software", reason: "sku-regex:nam-software-image" },
  { sku: "SC6K-NAM-1.2.1", cat: "interfaces-modules", hw: true, want: "software", reason: "sku-regex:sc6k-service-module-software" },
  { sku: "R-SC6K-A51-ACE=", cat: "interfaces-modules", hw: true, want: "software", reason: "sku-regex:sc6k-service-module-software" },
  { sku: "SC-SVC-WVPN-11-K9", cat: "interfaces-modules", hw: true, want: "software", reason: "sku-regex:wvpn-module-software" },
  { sku: "HF6100-60L4D-NOS", cat: "data-center-networking", hw: true, want: "software", reason: "sku-regex:hyperfabric-nos-image" },
  { sku: "2900-ZTD-CFG", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:ztd-cvo-config-option" },
  { sku: "CVO1900-CFG", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:ztd-cvo-config-option" },
  { sku: "CB-B3G1-SG250-08HP", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:promo-bundle-not-orderable" },
  { sku: "SG220-28MP-CBW-BG1", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:promo-bundle-not-orderable" },
  { sku: "AIR-RM3000L1-UXK9=", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-exact:AIR-RM3000L1-UXK9", note: "its entire name is 'DO NOT USE'" },
  { sku: "PA-A3-OC3MM-U=", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:army-booking-code" },
  { sku: "53-BB96-ALxxxM", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:literal-placeholder-in-sku" },
  { sku: "JE8E808GE8-NBxxxF", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:literal-placeholder-in-sku" },
  { sku: "EDGE8-xxU", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:literal-placeholder-in-sku" },
  // the datasheet cells, one per alternative of the pattern
  { sku: "16-F", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product", note: "a fibre count read out of a table" },
  { sku: "1E-12", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product", note: "a bit-error rate" },
  { sku: "9.0M", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product", note: "a bare cable length" },
  { sku: "G.652", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "TIA-568", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "PAM4", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "MPO-24", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "OM4/OM5", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "CL91", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "RS-FEC", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "IR-1", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "SM-IR", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "OC-3/STM-1", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product", note: "serves 3 INHERITED facts today — a retraction proposal" },
  { sku: "OC48/STM-16", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "400G-400ZR-OFEC-16QAM", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "FOIC1-OFEC-DP-DQPSK", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "1000BASE-BX10-D", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "3DES/AES", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "S3_8.10.10", cat: "interfaces-modules", hw: true, want: "non_product", reason: "sku-regex:datasheet-cell-not-a-product" },
  { sku: "C2900ISR-CICS-SL", cat: "interfaces-modules", hw: true, want: "service", reason: "sku-regex:isr-customization-service" },
  // ===== end modules-misc =====================================================================
];

let pass = 0;
let sabotages = 0;
const misses: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { misses.push(name); console.log(`MISS  ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`); }
}

const seenReasons = new Set<string>();
for (const c of cases) {
  const got = classify({ sku: c.sku, categorySlug: c.cat, categoryIsHardware: c.hw });
  seenReasons.add(got.reason);
  check(`${JSON.stringify(c.sku)} (${c.cat ?? "no category"}) -> ${c.want}${c.note ? `  [${c.note}]` : ""}`,
    got.klass === c.want && got.reason === c.reason, `got ${got.klass} / ${got.reason}, wanted ${c.want} / ${c.reason}`);
}

// ---- sabotage: the rules that must NOT fire ---------------------------------------------------
// A licence in a hardware category is a licence: the category must never outrank a SKU rule.
check("SABOTAGE categoryIsHardware=true cannot turn a CON- SKU into hardware",
  classify({ sku: "CON-SNT-C9200L24", categoryIsHardware: true }).klass === "service");
check("SABOTAGE categoryIsHardware=true cannot turn an L- SKU into hardware",
  classify({ sku: "L-C9200-24-E-A", categoryIsHardware: true }).klass === "license");
// A hardware-shaped PID in a non-hardware category is software: the category is the only thing
// that separates hardware from software, and it says no.
check("SABOTAGE a hardware-looking SKU inside a software category is software, not hardware",
  classify({ sku: "C9300-24H", categorySlug: "software", categoryIsHardware: false }).klass === "software");
// The spare suffix is stripped before the SUFFIX rules run, or "-AAE=" would escape them.
check("SABOTAGE a spare suffix cannot hide a licence suffix (\"...-AAE=\" is still a licence)",
  classify({ sku: "P2-CH-F-F-28-F-AAE=", categoryIsHardware: true }).klass === "license");
check("SABOTAGE ruleSku strips only trailing '=' and only after trimming", ruleSku("  sfp-10g-sr==  ") === "SFP-10G-SR" && ruleSku("A=B") === "A=B");
// Nothing is inferred from the category NAME.
check("SABOTAGE a category slug named 'software' with is_hardware=true is hardware (the row decides, not the name)",
  classify({ sku: "C9300-24H", categorySlug: "software", categoryIsHardware: true }).klass === "hardware");
check("SABOTAGE a category slug named 'switches' with is_hardware unknown is unknown, never hardware",
  classify({ sku: "C9300-24H", categorySlug: "switches" }).klass === "unknown");
// Order inside the licence rules: the reason names the FIRST rule in table order.
check("SABOTAGE 'LIC-' is reported as the prefix rule, not as the '-LIC-' infix it also contains",
  classify({ sku: "LIC-MS120-8-1YR", categoryIsHardware: true }).reason === "sku-prefix:LIC-");

// ---- the four round-2 rules that were REJECTED --------------------------------------------------
// Each case is a real part the rule would have swallowed. If someone adds the rule back, exactly
// one of these goes red and its note says what the rule would have cost. A rejection nobody can
// see is a rejection that gets undone by the next person to read the proposals file.
sabotages++;
check("SABOTAGE REJECTED sku-prefix:A- — A-D800-D800-7M is an Arista QSFP-DD active optical cable (7 facts), not a Cisco subscription",
  classify({ sku: "A-D800-D800-7M", categorySlug: "transceiver", categoryIsHardware: true }).klass === "hardware",
  classify({ sku: "A-D800-D800-7M", categoryIsHardware: true }));
sabotages++;
check("SABOTAGE REJECTED sku-suffix:-LIC — 15454-AR-MXP-LIC is an ONS15454 Any-Rate Muxponder card, licence-RESTRICTED hardware",
  classify({ sku: "15454-AR-MXP-LIC", categorySlug: "optical-networking", categoryIsHardware: true }).klass === "hardware",
  classify({ sku: "15454-AR-MXP-LIC", categoryIsHardware: true }));
sabotages++;
check("SABOTAGE REJECTED sku-suffix:-LIC — 15454-M-100GC-LIC= is a 100G OTU-4 line card carrying 5 facts",
  classify({ sku: "15454-M-100GC-LIC=", categorySlug: "optical-networking", categoryIsHardware: true }).klass === "hardware");
sabotages++;
check("SABOTAGE REJECTED sku-prefix:C1- — C1-N9K-C9508 is a real Nexus 9508 chassis in Cisco ONE ordering form",
  classify({ sku: "C1-N9K-C9508", categorySlug: "switches", categoryIsHardware: true }).klass === "hardware");
sabotages++;
check("SABOTAGE REJECTED sku-prefix:C1- — C1-C2960X-48LPS-L is a Catalyst 2960-X, 48 GigE PoE (2 facts)",
  classify({ sku: "C1-C2960X-48LPS-L", categorySlug: "switches", categoryIsHardware: true }).klass === "hardware");
sabotages++;
check("SABOTAGE REJECTED sku-fails-is_part_number — 10-2834-01 and 1030033 are real Cisco PIDs the junk gate refuses; the class table does not read that gate",
  classify({ sku: "10-2834-01", categorySlug: "optical-networking", categoryIsHardware: true }).klass === "hardware"
  && classify({ sku: "1030033", categorySlug: "video", categoryIsHardware: true }).klass === "hardware");
// The one measured exception inside an adopted rule.
sabotages++;
check("SABOTAGE the ISE- veto — ISE-SNS-ACCYKIT is the physical SNS accessory kit and stays hardware, while ISE-SNS-3595-K9 style licences do not exist",
  classify({ sku: "ISE-SNS-ACCYKIT", categorySlug: "security", categoryIsHardware: true }).klass === "hardware"
  && classify({ sku: "ISE-ADV-1YR-50K", categorySlug: "security", categoryIsHardware: true }).klass === "license");
// The rules are shapes, not family names (docs/CISCO_GAPS.md finding 9).
sabotages++;
check("SABOTAGE a hardware PID inside a licence-heavy family is untouched (TG5000-CHAS-AC, AIR-AP-VBLE-ADPTR=, CSM4-UCS2-50-HW)",
  ["TG5000-CHAS-AC", "TG-M7-MEM-32GB", "AIR-AP-VBLE-ADPTR=", "CSM4-UCS2-50-HW"]
    .every((s) => classify({ sku: s, categorySlug: "security", categoryIsHardware: true }).klass === "hardware"));

// ---- SABOTAGE: the four products a NAME-based licence rule destroys ---------------------------
// Round 3 was found from part NAMES, and a name rule was written, measured and abandoned. These
// are the parts that killed it. Each is real hardware whose DESCRIPTION mentions a licence, and
// each would lose its hardware class - and with it its coverage and its own facts - under any of
// the name predicates tried. They are pinned here so the next person who has that idea (it is a
// good idea, and it is wrong) finds the counter-examples already written down instead of shipping
// it and discovering them in production.
sabotages++;
{
  const nameTrapped: [string, string, string][] = [
    ["C9500-24Q-A=", "switches", "Catalyst 9500 24-port 40G, Adv. License, no PS - a real switch. Structurally identical to N55-96P-SSK9 'Nexus 5500 Storage License, 96 Ports', which IS a licence, so no name rule separates them"],
    ["FP8250-BASE-K9", "security", "FirePOWER 8250 Chassis, No IPS Lic, 2U, 7 Slots - a chassis whose name says it has NO licence"],
    ["AIR-CT5508-25PROM", "wireless", "5508 Wireless Controller w/ 25 AP Lic. - hardware sold bundled with licences"],
    ["NCS1K4-QXP-L-K9=", "optical-networking", "NCS1004 3.2T QSFP-DD DCO Licensed Transponder - 'Licensed' is an adjective on a real card, the same trap that made round 2 reject sku-suffix:-LIC"],
    ["WS-C3850-24PW-S", "switches", "Catalyst 3850 24-port PoE with a wireless licence - a real switch carrying its own facts"],
  ];
  const wrong = nameTrapped.filter(([sku, cat]) => classify({ sku, categorySlug: cat, categoryIsHardware: true }).klass !== "hardware");
  check(`SABOTAGE the ${nameTrapped.length} real products whose NAMES mention a licence stay hardware`,
    wrong.length === 0, wrong.map(([s]) => s).join(", "));
}
// Every rule the table holds is reachable: no rule is shadowed into never firing by an earlier one.
{
  const unreachable = SKU_RULES.filter((r) => {
    // A regex rule carries its own probe: a generated one would never match, so the rule would
    // be reported unreachable for ever — a check that always fails teaches people to ignore it.
    // An `exact` rule's only possible probe is its own token.
    const probe = r.probe ?? (r.kind === "exact" ? r.token : r.kind === "prefix" ? r.token + "0000TEST" : r.kind === "suffix" ? "TEST0000" + r.token : "TEST" + r.token + "0000");
    return classify({ sku: probe, categoryIsHardware: true }).reason !== ruleName(r);
  }).map(ruleName);
  check(`no rule in the table is shadowed into never firing (${SKU_RULES.length} rules)`, unreachable.length === 0, unreachable);
}
// `exact` is exact. ruleMatches() used to END in a bare contains, so a kind it did not name fell
// through to substring matching — an exact "NX-OS" would have eaten every NX-OS-* SKU. Sabotage:
// the whole SKU matches, a longer SKU carrying it does not, and an unknown kind throws rather than
// silently becoming a contains rule.
{
  const ex: SkuRule = { kind: "exact", token: "NX-OS", klass: "software", why: "test" };
  check("exact rule matches its own SKU", ruleMatches(ex, "NX-OS"));
  check("SABOTAGE exact rule does NOT match a longer SKU containing its token (NX-OS-ES-XF)", !ruleMatches(ex, "NX-OS-ES-XF"));
  check("SABOTAGE exact rule does NOT match with a prefix in front (CISCO-NX-OS)", !ruleMatches(ex, "CISCO-NX-OS"));
  let threw = false;
  try { ruleMatches({ kind: "bogus" as SkuRule["kind"], token: "X", klass: "license", why: "test" }, "X"); } catch { threw = true; }
  check("SABOTAGE a rule of unknown kind throws instead of falling through to contains", threw);
}

// ---- every rule in the table fired at least once --------------------------------------------------
const untested = RULE_NAMES.filter((r) => ![...seenReasons].some((s) => s === r || s.startsWith(r + ":")));
// SUB-, SWSS, -STU and MERAKI-LIC are in the table but no PID carrying them exists in data/reference
// today (grep across the three files: 0 hits). They are exercised with the shapes the table
// describes, flagged here so the day a real one appears it replaces the placeholder.
const SHAPES_ONLY: Record<string, string> = { "sku-prefix:SUB-": "SUB-C9200-24", "sku-prefix:SWSS": "SWSS-UPGRADES", "sku-suffix:-STU": "N93-LAN1K9-STU", "sku-contains:MERAKI-LIC": "ENT-MERAKI-LIC" };
// Table order shadows a rule: "-LIC-" is tested before "MERAKI-LIC", so any SKU with text after
// "MERAKI-LIC" (e.g. "MERAKI-LIC-MS") is classed by "-LIC-" and the MERAKI-LIC rule can only fire
// when the token ends the SKU. Same class either way, different reason. Pinned here so a
// re-ordering of the table is a visible change, not a silent one.
check("table order: 'MERAKI-LIC-MS' is classed license by the '-LIC-' rule that precedes 'MERAKI-LIC'",
  classify({ sku: "MERAKI-LIC-MS", categoryIsHardware: true }).reason === "sku-contains:-LIC-");
for (const [rule, sku] of Object.entries(SHAPES_ONLY)) {
  const got = classify({ sku, categoryIsHardware: true });
  check(`table shape ${rule} fires (no real PID in data/reference yet: ${sku})`, got.klass === "license" && got.reason === rule, `${got.klass} / ${got.reason}`);
  seenReasons.add(got.reason);
}
// `name-user-tier` HAS NO LIVE POPULATION, and that is recorded rather than exempted.
//
// 12 Sep 2026, on merging the collab block. Measured with classify() over every live part of every
// vendor — 91,543 rows — the rule decides ZERO: the security block's `term-user-band` and the collab
// block's `MIG-` prefix take its whole population by SKU, and a SKU rule runs before every name
// rule. It is NOT removed, and the distinction from the removed `voice-feature-license` is the one
// that matters: that rule's population is covered by another rule matching the SAME SKU FAMILIES,
// where this one is the generic net for a user-tier name whose SKU no rule happens to name. Take it
// out and the next such licence arriving in a hardware category stays `hardware`.
//
// So it is exercised the way SHAPES_ONLY exercises a rule with no PID — on a name shaped like the
// ones it is for, with a SKU no rule in the table decides. The day a real part reaches it, this
// block should be replaced by that part.
{
  const got = classify({ sku: "XYZ-NOT-A-REAL-FAMILY", name: "Extra 1K - 10K Users", category: "unified-communications" } as never);
  check("name shape name-user-tier fires (0 live parts decide it today: term-user-band and MIG- take them by SKU)",
    got.klass === "license" && got.reason === "name-user-tier", `${got.klass} / ${got.reason}`);
  seenReasons.add(got.reason);
}
// The six rules added 9-10 Sep 2026: four NAME rules and two derived from the UCS SKU kind. Each
// needs a real SKU here or the "every rule fired" assertion below reports it as never exercised —
// which is exactly what it did when they were added without these cases. Every SKU is from the
// catalogue, with the name the catalogue holds, because the name rules read the NAME.
{
  const added: [string, string, string, string, string][] = [
    // sku, name, category, expected class, expected reason
    // 12 Sep 2026. These three ESA rows USED to be the witnesses for name-lic-key / name-sw-bundle /
    // name-user-tier. The security block's `sku-regex:term-user-band` now decides all three by their
    // SKU, and a SKU rule runs before every name rule — same class, different reason. They stay here
    // because the reason CHANGED and that must be visible, not because the name rules need them; the
    // three name rules get their own witnesses below, each outside term-user-band's shape.
    ["ESA-MFE-3Y-S2", "Email McAfee Anti-Virus 3Y Lic Key, 100-499 Users", "security", "license", "sku-regex:term-user-band"],
    // collab-class (12 Sep 2026): A-CC-NCMN-ENT stood here and is now caught by its SKU
    // (webex-collab-subscription), so it no longer reaches the name rule. This one does — one of the
    // nine parts whose ONLY licence evidence is the word "entitlement" after the whole collab block.
    ["CCX-90-CMBLDLIC", "CCX 9.0 CCX CM Bundle Appliance Entitlement, PAK pDelivery", "contact-center", "license", "name-entitlement"],
    ["ESA-ESO-1Y-S5", "ESA Outbound SW Bundle(ENC+DLP) 1Y Lic, 5K-9,999 Users", "security", "license", "sku-regex:term-user-band"],
    ["ESA-ESI-1Y-S2", "Inbound Essentials Bun(AS+AV+OF) 1Y Lic,100-499 Users", "security", "license", "sku-regex:term-user-band"],
    // The replacements. Each is a real part whose SKU no rule in the table decides, so the name rule
    // is the thing under test — which is what the three rows above stopped being.
    ["ESA-ENC-5Y-S4-K9", "ESA PXE Encryption 5Y Lic Key, 1K-4,999 Users", "security", "license", "name-lic-key"],
    ["UNITYCN12-K9-LAB", "Unity Connection 12.x Lab Software Bundle (E-Delivery Only)", "unified-communications", "license", "sku-prefix:UNITYCN"],   // 12 Sep: UNITYCN decides it before any name rule is consulted
    // MERGE, 12 Sep 2026 — both witnesses were taken by the collab block's SKU rules, and their
    // replacements were found by running classify() over the catalogue rather than chosen by eye.
    // `uc-app-edelivery` now decides R-UNITYCN10-K9-LAB and `MIG-` decides MIG-CUCM-ENHP-B; both
    // stay, at their new reasons, because the class must be shown not to have moved.
    // and the CLASS moved with the reason, from `license` to `software`: a lab software bundle read
    // by its name is a licence, read by its e-delivery SKU it is the software itself. Both are
    // defensible and the SKU is the more authoritative signal, which is why SKU rules run first.
    ["R-UNITYCN10-K9-LAB", "Unity Connection 10.x Lab Software Bundle", "unified-communications", "software", "sku-regex:uc-app-edelivery"],
    ["MIG-CUCM-ENHP-B", "Migration to UC Manager 9.x/10.x Enh Plus - 1K - 10K Users", "unified-communications", "license", "sku-prefix:MIG-"],
    // The real witness for name-sw-bundle: 1 of the 5 live parts the merged table decides by it.
    ["E3C-SW-14-K9", "On-Premises SW Bundle v14 (1)", "unified-communications", "license", "name-sw-bundle"],
    ["VMW-VS5-ENTP-5A", "VMware vSphere 5 Enterprise", "servers-unified-computing", "license", "ucs-kind-os-license"],
    ["UCS-SID-WKL-SAP", "Cisco UCS-SID-WKL-SAP", "servers-unified-computing", "non_product", "ucs-kind-non-product"],
    // Round 4, 10 Sep 2026, working `switches`. Every SKU and name is from the catalogue.
    ["LL-C2960XR-48TS-I=", "Catalyst 2960 family 48 GE ports IOS IP Lite sw relicense", "switches", "license", "sku-prefix:LL-"],
    ["IE3300-NW-A=", "Network Advantage License for IE3300, Perpetual", "switches", "license", "sku-contains:-NW-A"],
    ["C9400-NW-E", "Cisco Catalyst 9400 Network Essential License", "switches", "license", "sku-contains:-NW-E"],
    ["N55-96P-SSK9", "Nexus 5500 Storage License, 96 Ports", "switches", "license", "sku-suffix:SSK9"],
    ["N7K-EL21K9", "Nexus 7000 Enhanced layer 2 (includes FabricPath, RISE)", "switches", "license", "sku-contains:-EL2"],
    ["N55-LAN1K9=", "Layer 3 License for Nexus 5500 Platform", "switches", "license", "sku-suffix:LAN1K9"],
    ["N3K-C3048-BAS1K9", "Nexus 3048 Layer 3 Base License", "switches", "license", "sku-suffix:BAS1K9"],
    ["N5020-FNPV-SSK9=", "FCoE NPV Lic for Nexus 5020", "switches", "license", "sku-suffix:SSK9"],
    ["N5020-FNPV-K9", "FCoE NPV Lic for Nexus 5020", "switches", "license", "sku-contains:-FNPV"],
    ["C9500-LIC=", "Cisco DNA software license upgrade from Essentials to Advantage", "switches", "license", "sku-suffix:-LIC"],
    ["C9300-24-E-A-3", "24-port NW and Cisco DNA Essentials to NW and Cisco DNA Advantage Upgrade License", "switches", "license", "sku-regex:tier-upgrade"],
    ["C2960L-16TS-LL-SW", "Software license for C2960L", "switches", "license", "name-software-image"],
    // Round 4b: the residual families, found by re-auditing switches after round 4 landed.
    ["C9200CX-DNXA-12-5Y", "C9200CX Cisco Catalyst Advantage software subscription, 12-port, 5 Year", "switches", "license", "sku-contains:-DNXA-"],
    ["C9200CX-DNXE-8-3Y", "C9200CX Cisco Catalyst Essentials software subscription, 8-port, 3 Year", "switches", "license", "sku-contains:-DNXE-"],
    ["N55-VMFEXK9", "Nexus 5500 series VM-FEX license", "switches", "license", "sku-contains:VMFEX"],
    // Round 5, 10 Sep 2026 — the eleven flat-profile categories. Every SKU and name is real.
    ["S-A9K-8HG-AIP-TR", "ASR 9000 Full-Scale VRF License for 800G Packet Transport", "routers", "license", "sku-prefix:S-A9K"],
    ["S-XRV-P-SUB-1G", "IOS XRv 9K 1G throughput License for IP MPLS Premium pkg-SBP", "routers", "license", "sku-prefix:S-XRV"],
    ["A9K-DDOS-AIF-10-C", "ASR 9K AIF 1-yr Subscription One vDDoS instance 10Gbps China", "routers", "license", "sku-prefix:A9K-DDOS"],
    ["LIF5K-00-CSXGTDT", "GTP and Diameter Interface Throttling 1K sessions (Failover)", "wireless", "license", "sku-prefix:LIF5K-"],
    ["ASR5K-00-CSXADCR", "Application Detection & Control (ADC) Per System Per Release", "wireless", "license", "sku-prefix:ASR5K-00"],
    ["ASR5K-99-HA01DPYU", "Home Agent DNS Intercept Proxy Ent. Upg License, 1K Sessions", "wireless", "license", "sku-prefix:ASR5K-99"],
    ["QMOG-00-FAPIS0K9", "API GW per site", "routers", "license", "sku-prefix:QMOG-"],
    ["ANDSF-ENT-ADV-5YR", "CPS ANDSF Enterprise Advanced, 50 Subscribers, 5 Yr Subscrip", "wireless", "license", "sku-prefix:ANDSF-"],
    ["MIG-12X-ENH2MTG", "BE6000 License Feature Upgrade 12.x UCL Enhanced to CUWL Mtg", "unified-communications", "license", "sku-prefix:MIG-1"],
    ["WAE-SUB-PLN-STDM", "WAE Standard Planning Pkg, 500 or more medium devices, Subsc", "routers", "license", "sku-prefix:WAE-SUB"],
    ["WAE-ENC-FEAT-DNF-S", "WAE Distributed Netflow feature option RTU SIA", "routers", "license", "sku-prefix:WAE-ENC"],
    ["XR-NCS1K-621K9", "NCS 1000 Cisco IOS XR Software Release 6.2.1 RTU - USB key", "optical-networking", "license", "sku-prefix:XR-NCS1K"],
    ["FL-CUBEE-25=", "Unified Border Element Enterprise RTU license - 25 sessions", "routers", "license", "sku-prefix:FL-CUBEE"],
    ["HX-VSP-FND-D", "Factory Installed - vSphere6.0 SW (End user provides License)", "hyperconverged-systems", "license", "sku-prefix:HX-VSP"],
    ["AIR-WIPS-AP-5=", "Wireless Intrusion Prevention Services License", "wireless", "license", "sku-prefix:AIR-WIPS"],
    ["C1-SL-29-UC-K9", "Cisco ONE Unified Communication License for Cisco 2901-2951", "routers", "license", "sku-prefix:C1-SL-"],
    ["MC-S-DMNF-SM", "MATE Collector Dmd Netflow; Small Device; Subscription", "routers", "license", "sku-prefix:MC-S-"],
    ["NCS2K-L-R1080FSK9", "NCS 2K/MSTP - R10.8.0 SW, Upgrade License RTU - FlexSpectrum", "optical-networking", "license", "sku-prefix:NCS2K-L-R"],
    ["UCXN7-48P-UWLADD", "Additional Unity Connection 7.0 48P Server License - CUWL on", "unified-communications", "license", "sku-contains:UWLADD"],
    // The six Invicta operating systems, which replaced the UCSW token removed from ucsKind.
    ["UCSW-A-OS5.X-K9", "UCS Invicta C3124SA Appliance Operating System 5.X - K9", "servers-unified-computing", "license", "sku-contains:-OS5."],
    // Round 7, 11 Sep 2026 — closing the switches residue. Every SKU and name is from the catalogue.
    ["CISCO-NTP-MIB", "Cisco CISCO-NTP-MIB", "switches", "non_product", "sku-suffix:-MIB"],
    ["C1-R-N56FNPV-K9", "Cisco ONE Nexus 5600 FNPV License (Reference, No License)", "switches", "non_product", "sku-prefix:C1-R-"],
    ["NXOS-703I4.1", "Nexus 9500, 9300, 3000 Base NX-OS Software Rel 7.0(3)I4(1)", "switches", "software", "sku-prefix:NXOS-"],
    ["NX-OS-ES-XF", "Cisco NX-OS Essentials SW license for a 10/25/40G+ Nexus 9K Leaf", "switches", "software", "sku-prefix:NX-OS-"],
    ["C1A1TN9300XF-5Y", "Cisco ACI and NX-OS subscription Advantage package for 10/25/40G+ Cisco N9000 leaf switch, 5-year term", "switches", "license", "sku-prefix:C1A1TN"],
    ["C1E1TN9300XF-5Y", "Cisco ACI and NX-OS subscription Essentials package for 10/25/40G+ Cisco N9000 leaf switch, 5-year term", "switches", "license", "sku-prefix:C1E1TN"],
    ["ACI-ES-XF", "Cisco ACI Essentials SW license for a 10/25/40G+ Cisco Nexus 9K Leaf", "switches", "license", "sku-prefix:ACI-ES-"],
    ["ACI-AD-GF", "ACI Advantage SW license for a 1G Nexus 9K Leaf", "switches", "license", "sku-prefix:ACI-AD-"],
    ["N7K-C7010-XL", "Cisco Nexus 7010 Scalable Feature License", "switches", "license", "sku-regex:n7k-scalable-feature"],
    ["N55-LAN1K9-IN=", "Nexus 5500 Layer 3 Base Enterprise License, Spare", "switches", "license", "sku-contains:LAN1K9"],
    ["N3K-LAN2K9", "Nexus 3000 Layer 3 LAN Enterprise License for Nexus 3464C", "switches", "license", "sku-contains:LAN2K9"],
    ["N55-BAS1K9-BUN", "Layer 3 License for Nexus 5500 Platform", "switches", "license", "sku-contains:BAS1K9"],
    ["N5020-SSK9-LAB", "Storage Protocol Services license for N5020 LAB Bundle", "switches", "license", "sku-contains:SSK9"],
    ["E3N-IE4000L-RA-E", "Stratix 5400L DNA (up to 12 ports), Essential License", "switches", "license", "sku-prefix:E3N-"],
    ["C3750X-12S-S-E", "C3750X-12S IP Base to IP Services Paper License", "switches", "license", "sku-regex:tier-upgrade"],
    // Round 8, 11 Sep 2026 — the residue a licence-word net could not see. Real SKUs and names.
    ["N5KUK9-503N1.1", "Nexus 5000 Base OS Software Rel 5.0(3)N1(1a)", "switches", "software", "sku-regex:nxos-image"],
    ["N7KS2K9-6210", "Cisco NX-OS Release 6.2(10) for SUP2 Nexus 7000", "switches", "software", "sku-regex:nxos-image"],
    ["S19UK9-15102T", "Cisco 1900 IOS UNIVERSAL", "routers", "software", "sku-regex:ios-image"],
    ["S45XUK9-33-1511SG", "Cisco IOS Software XE Release 3.3.0 SG crypto universal image for Cisco Catalyst 4500-X 32-port and 40-port models", "switches", "software", "sku-regex:ios-image"],
    ["C1A2ANEX55481K9", "Cisco ONE Advanced Perpetual Nexus 5548", "switches", "license", "sku-regex:cisco-one"],
    ["C1P1TN9300GF-5Y", "Cisco C1P1TN9300GF-5Y", "switches", "license", "sku-regex:cisco-one"],
    ["C1E1ATCAT38502-5Y", "Cisco ONE Essentials Term C3850 48-Port 5Y", "switches", "license", "sku-regex:cisco-one"],
    ["ELA-CUIC-BASE-K9", "ELA Cisco UCS Director Base Software License", "servers-unified-computing", "license", "sku-prefix:ELA-"],
    ["ELA2-C1-NEX55961F", "Cisco ONE ELA FND Perpetual Nexus 5596", "switches", "license", "sku-prefix:ELA2-"],
    ["ELAC-CUIC-SERV500", "Cisco UCS Director Capped ELA-Servers 500", "servers-unified-computing", "license", "sku-prefix:ELAC-"],
    ["ELAU-CUIC-SERV5000", "Cisco UCS Director UnCapped ELA-Servers 5000", "servers-unified-computing", "license", "sku-prefix:ELAU-"],
    ["E2C1-NEX55961F", "Cisco ONE EA FND Perpetual Nexus 5596", "switches", "license", "sku-prefix:E2C1-"],
    ["D2OPS-MOD-7Y", "DCN Day2 Ops Assurance and Insights for Modular, 7Y", "switches", "license", "sku-prefix:D2OPS-"],
    ["C1-DCL-N5K-K9", "Cisco ONE DCNM for LAN Advanced Edt. for Nexus 5000", "switches", "license", "sku-prefix:C1-DCL-"],
    ["C1-DCS-N5K-K9", "Cisco ONE DCNM for SAN License for Nexus 5000", "switches", "license", "sku-prefix:C1-DCS-"],
    ["C1-ISE-PLS-30-T", "Cisco ONE ISE PLUS 30 End-Point Lic Term", "switches", "license", "sku-prefix:C1-ISE-"],
    ["DCNM-S-M93XK9=", "DCNM SAN Adv Features for MDS 9300 Switch-Based", "storage-networking", "software", "sku-prefix:DCNM-"],
    ["N7K-C7018-SBUN-P1", "Inc. LAN,ADV,TRS,EL2,DCNM,DCNMSAN,MPLS,SAN,XL - Promotion", "switches", "license", "sku-contains:-SBUN-"],
    ["N6001-DFA-BUN-P1", "Nexus 6001 DFA Bundle-Limited Time Promo; LAN, EL2, DCNM-LAN", "switches", "license", "sku-contains:-DFA-BUN-"],
    ["N7K-DFA-P1", "Nexus DFA production support", "switches", "license", "sku-regex:nexus-dfa"],
    ["CONE-2921-FND-P", "Perpetual License Cisco ONE Foundation 2900 ISR Family", "routers", "license", "sku-regex:cone-tier"],
    ["CD-3750G-48EMI=", "● IP Services image upgrade kit for standard versions of the Cisco Catalyst 3750G-48TS and 3750G-48PS switches ● Provides advanced IP routing", "switches", "software", "sku-regex:cd-image-kit"],
    ["R-CD-ME3400-A2I=", "E-delivery METROIPACCESS image upgrade kit for Cisco ME 3400 Series Switches with METROACCESS image", "switches", "software", "sku-regex:cd-image-kit"],
    ["ACI-VPOD-MGMT=", "ACI vPod virtual pod redundant management cluster software (vSpine/vLeaf + vSpine/vLeaf)", "switches", "software", "sku-prefix:ACI-VPOD-"],
    ["N3K-XNC-MM-B-SM", "Nexus 3000, XNC with Monitor Manager Small Bundle", "switches", "software", "sku-prefix:N3K-XNC-"],
    ["N3K-ES-XF2", "Nexus 3432D-S Essential License including Layer-3 LAN Enterprise and Telemetry features", "switches", "license", "sku-prefix:N3K-ES-"],
    ["C3750X-48-IOS-S-E", "C3750X-48 IP Base to IP Services factory IOS Upgrade", "switches", "license", "sku-regex:factory-ios-upgrade"],
    ["S45EUK9T-S9-310E", "CAT4500E SUP9E Universal Crypto Image", "switches", "software", "sku-regex:ios-xe-image"],
    ["SISR4300UK9-316S", "Cisco ISR 4300 Series IOS XE Universal", "routers", "software", "sku-regex:ios-xe-image"],
    ["SWLC4400K9-50", "Cisco Unified WLAN Controller SW Release 5.0 - ED", "switches", "software", "sku-regex:wlc-software"],
    ["SWISMK9-41", "Cisco Unified WLAN Controller SW Release 4.1", "switches", "software", "sku-regex:wlc-software"],
    ["M9500FMS1K9", "Cisco FMS package for one Cisco MDS 9500 Series Multilayer Director", "storage-networking", "license", "sku-contains:FMS1K9"],
    ["C1-N5K-UPG", "Cisco ONE Upgrade for Nexus 5000 - CHOOSE ONLY QTY 1 HERE", "switches", "license", "sku-regex:c1-nexus-upgrade"],
    ["C1-SWATCH-50-T", "Cisco ONE StealthWatch 50 FPS Lic Term", "switches", "license", "sku-prefix:C1-SWATCH-"],
    ["C1-CAT-ADD-T", "Cisco ONE Term Add for Catalyst Switches - CHOOSE QTY 1 HERE", "switches", "license", "sku-prefix:C1-CAT-"],
    ["3750G48-AISK9LC-B=", "Advanced IP Services upgrade for 3750G-48 with IP Base", "switches", "license", "sku-contains:AISK9LC"],
    ["C4500E-LB-IPB=", "Lan Base to IP Base license Spare", "switches", "license", "sku-suffix:-LB-IPB"],
    ["N3548-ALGK9", "Nexus 3500 Algo Boost License", "switches", "license", "sku-exact:N3548-ALGK9"],
    ["N3K-STR1K9", "Telemetry license for Nexus 3000 platform", "switches", "license", "sku-exact:N3K-STR1K9"],
    ["N5020-P02K9=", "Nexus 5020 Storage Protocols Services License Promotion", "switches", "license", "sku-exact:N5020-P02K9"],
    ["C4500X-IPB", "Catalyst 4500-X IP BASE software license (paper delivery)", "switches", "license", "sku-exact:C4500X-IPB"],
    ["IE-LICENSE-SPARE", "Spare license for software upgrade (L2 to L3 features or MRP protocols)", "switches", "license", "sku-exact:IE-LICENSE-SPARE"],
    ["IE2000-B-E=", "IE2000 LAN Base to Enhanced LAN Base Paper NAT License to Enable NAT Capability", "switches", "license", "sku-exact:IE2000-B-E"],
    ["SV-VF30-BASE+5K9", "Cisco VFrame 3.0 Director Base + 5 Node License", "switches", "license", "sku-exact:SV-VF30-BASE+5K9"],
    ["DCN-SYNCE-XF", "SyncE add-on license", "switches", "license", "sku-exact:DCN-SYNCE-XF"],
    ["PRIMEINFRAEXPAUY2", "Prime Infra Expansion", "switches", "license", "sku-exact:PRIMEINFRAEXPAUY2"],
    ["IE-SW-SPARE", "SPARE IOS software for IE2000U, CGS2520, IE3000, IE3010, ESM", "switches", "software", "sku-exact:IE-SW-SPARE"],
    ["CSP-SW", "Data Center NFV Platform Software", "switches", "software", "sku-exact:CSP-SW"],
    ["IOX-IE4K-CORE", "Cisco IOx Core Software for IE4K family", "switches", "software", "sku-exact:IOX-IE4K-CORE"],
    ["N7K-NAM-SW-6.0-K9", "Cisco Prime NAM Software version 6.0", "switches", "software", "sku-exact:N7K-NAM-SW-6.0-K9"],
    ["NX-OS", "Cisco NX-OS", "switches", "software", "sku-exact:NX-OS"],
    ["SF-ASASM-8.5-K8", "ASA Software 8.5 for Catalyst 6500-E ASASM, 2 free VFW", "switches", "software", "sku-exact:SF-ASASM-8.5-K8"],
    ["C2K-SW-EXT", "C2K Security and Vulnerability Software Support extension", "switches", "service", "sku-exact:C2K-SW-EXT"],
    ["SC4K-SUPK9-7.6.9", "Catalyst 4K Supervisor Flash Image w/ SSH, Release 7.6.9", "switches", "software", "sku-prefix:SC4K-"],
    ["NO-POWER-CORD", "ECO friendly green option, no power cable will be shipped", "switches", "non_product", "sku-exact:NO-POWER-CORD"],
    ["S45XU-331-1511SG", "Cisco IOS Software XE Release 3.3.1 SG non-crypto universal image for Cisco Catalyst 4500-X 16-port and 24-port models", "switches", "software", "sku-regex:cat4500-xe-image"],
    ["S45EUK9-S8-38E", "Cisco Catalyst 4500 Supervisor Engine 8L-E Cisco IOS Software XE release 3.8.1E crypto universal", "switches", "software", "sku-regex:cat4500-xe-image"],
    ["PWR-C2-1025WAC-", "Dummy PID to Track First PS S/N, 1025WAC Kingfisher", "switches", "non_product", "name-dummy-pid"],
    ["C9120-MULTI", "Dummy PIDs on the test orders:", "wireless", "non_product", "name-dummy-pid"],
    // Transceiver kind census, 11 Sep 2026 — names verbatim from the catalogue.
    ["SFP7010-TAC-OPS", "SVP Cisco FirePOWER 7010 IPS, Apps and URL Adjustable OPS", "transceiver", "license", "sku-regex:firepower-svp-subscription"],
    ["SFP8370TAMC-OPS", "SVP FirePOWER 8370 IPS, Apps, AMP & URL Adjustable OPS", "transceiver", "license", "sku-regex:firepower-svp-subscription"],
    ["QSFP-", "Cisco QSFP-", "transceiver", "non_product", "sku-exact:QSFP-"],
    ["QSFP-DD", "Cisco QSFP-DD", "transceiver", "non_product", "sku-exact:QSFP-DD"],
    ["QSFP28", "Cisco QSFP28", "transceiver", "non_product", "sku-exact:QSFP28"],
    ["QSFP28-DD", "Cisco QSFP28-DD", "transceiver", "non_product", "sku-exact:QSFP28-DD"],
    ["QSFP56", "Cisco QSFP56", "transceiver", "non_product", "sku-exact:QSFP56"],
    ["QSFP56-DD", "Cisco QSFP56-DD", "transceiver", "non_product", "sku-exact:QSFP56-DD"],
    ["QSFP112", "Cisco QSFP112", "transceiver", "non_product", "sku-exact:QSFP112"],
    ["SFP28", "Cisco SFP28", "transceiver", "non_product", "sku-exact:SFP28"],
    ["SFP56", "Cisco SFP56", "transceiver", "non_product", "sku-exact:SFP56"],
    ["QSFP-H40G-CUxM", "QSFP to QSFP copper direct-attach cables (length x- 1m to 5m)", "transceiver", "non_product", "sku-regex:family-placeholder"],
    ["SFP-H10GB-CUxM=", "Cisco SFP-H10GB-CUxM=", "transceiver", "non_product", "sku-regex:family-placeholder"],
    ["CWDM-SFP10G-xxxx=", "Cisco CWDM-SFP10G-xxxx=", "transceiver", "non_product", "sku-regex:family-placeholder"],
    ["XFP-RF-ITUXX=", "Cisco XFP QAM Transmitter Fixed Wavelength ITUXX 1", "transceiver", "non_product", "sku-regex:family-placeholder"],
    // video (12 Sep 2026). Every SKU and name is from the catalogue.
    ["SWLIC-RFGW1-OCTAL3", "RFGW-1 3 QAM OCTAL LICENSE: MUST CONFIGURE WITH RFGW1", "video", "license", "sku-prefix:SWLIC-"],
    ["SWLIC-DS384", "QAM DS-384 License (Single QAM): Must configure with RFGW-DS", "video", "license", "sku-prefix:SWLIC-"],
    ["INODEMGR-STD-NOD", "Intelligent Node Mgr - Standard RTU SW License", "video", "license", "sku-exact:INODEMGR-STD-NOD"],
    ["4021701C", "RFGW-1 License Upgrade, PowerKey, 4 QAMs Per Port", "video", "license", "sku-exact:4021701C"],
    ["4021700", "RFGW-1 Data License Option Kit", "video", "license", "sku-exact:4021700"],
    ["4021701", "RFGW-1 License Upgrade, PowerKey, 4 QAMs Per Port", "video", "license", "sku-exact:4021701"],
    ["4021702", "RFGW-1 License, DVB Scrambling", "video", "license", "sku-exact:4021702"],
    ["RFGW-1-RMU", "RF Gateway 1 Remote Management Utility", "video", "software", "sku-regex:rfgw-mgmt-utility"],
    ["RFGW-10-RPU", "RF Gateway 10 Remote Provisioning Utility", "video", "software", "sku-regex:rfgw-mgmt-utility"],
    ["SCBR8-UK9-173", "Cisco CBR8 IOS XE UNIVERSAL", "video", "software", "sku-prefix:SCBR8-UK9"],
    ["CBR-8-IOS-OPT", "IOS OPT CLS", "video", "software", "sku-exact:CBR-8-IOS-OPT"],
    ["CBR-8", "Container (Top Level) PID for configuring the cBR-8 System", "video", "non_product", "sku-exact:CBR-8"],
    ["HA-RPHY", "Container (Top Level) PID for configuring the RPHY HA shelf", "video", "non_product", "sku-exact:HA-RPHY"],
    ["GS7000", "Cisco GS7000", "video", "non_product", "sku-exact:GS7000"],
    ["ITU20", "Cisco ITU20", "video", "non_product", "sku-exact:ITU20"],
    ["E2000/APC", "Cisco E2000/APC", "video", "non_product", "sku-exact:E2000/APC"],
    // end video (12 Sep 2026)
    // routers (12 Sep 2026) — one real catalogue PID per rule of the routers class block, name verbatim.
    ["WAE-72-SW-K9", "WAE 7.2 Software", "routers", "license", "sku-regex:wae"],
    ["XC-RP_TEST-01.03", "Tar File of SMUs and Images Except The Security Image", "routers", "software", "sku-regex:xr-crs-image"],
    ["XC-XLAT44-10M", "SW license for 10M NAT44 translations", "routers", "license", "sku-regex:xc-licence"],
    ["XR-A9K-X64K9-07.6", "Cisco IOS XR 64 Bit IP/MPLS Core Software 3DES", "routers", "software", "sku-regex:xr-image"],
    ["XR-EA-SW-CRS", "Internal attributions PID for CRS", "routers", "non_product", "sku-prefix:XR-EA-"],
    ["MC-1Y-NDA-B-ADSM", "MATE Collector Adv Bndl, Sm Dev, 1Y Sub (inc sw support)", "routers", "license", "sku-regex:mate-collector"],
    ["MATE-DESIGN-S-FL", "MATE Design, Subscription, Floating Lic Suite", "routers", "license", "sku-prefix:MATE-"],
    ["8KSW-PRM-B-P", "Premier Perpetual SW for 8000 Type B Device.", "routers", "license", "sku-prefix:8KSW"],
    ["CUBESP-32KP-RED", "CUBE(SP) redundant 32k Session Perpetual Lic for ASR1k Seri", "routers", "license", "sku-regex:cube-sp-session"],
    ["FLASR1-CUBES-4KP", "CUBE(SP) 4K Session License for ASR 1000 Series", "routers", "license", "sku-prefix:FLASR1-"],
    ["FLSASR1-FPI", "Flex. Pack. Insp License for ASR1000 Series", "routers", "license", "sku-prefix:FLSASR"],
    ["FLSA1-1HXIPS8G", "Crypto throughput License for ASR1001-HX 8G", "routers", "license", "sku-prefix:FLSA1"],
    ["FL-C800-APP", "AppX Feature Set License for 800 Series", "routers", "license", "sku-regex:feature-licence"],
    ["S-A9903-IVRF", "ASR 9903 License to Activate up to 8 VRFs for Fixed Ports", "routers", "license", "sku-prefix:S-A99"],
    ["ACT-TPE-V-SUPP", "TPE GET STARTED REMOTE LoRaWAN fundamentals support", "routers", "service", "sku-regex:act-service"],
    ["ACT-TPE-NAS-20K", "Actility TPE NAS, Additional pack of 20K endpoints", "routers", "license", "sku-prefix:ACT-"],
    ["SWOA-1900ISR-C1EA", "SWOA for 1900ISR Cisco ONE Plus ELA", "routers", "license", "sku-prefix:SWOA-"],
    ["WAN-AUTOMATION-S-R", "WAE Flexible Consumption (SIA) Single Network - SIA Renewal", "routers", "license", "sku-prefix:WAN-"],
    ["CSP-2KP-RED", "CUBE(SP) 2K Session License for ASR1000 Series, redundant", "routers", "license", "sku-regex:cube-sp-pak"],
    ["SASR1KRPUNPNLK9165", "Cisco ASR 1000 RP2/RP3 UNIVERSAL NO PAYLOAD ENCRYPT W/O LI", "routers", "software", "sku-prefix:SASR"],
    ["SISR1100UCMK9-169", "SD-WAN Image for ISR 1100 platforms. (Currently supported platforms: ISR 1111-8P and ISR 1117-4P only)", "routers", "software", "sku-regex:ios-xe-image-2"],
    ["S805CHP-12321", "Cisco 805 Series IOS IP/FW PLUS", "routers", "software", "sku-regex:ios12-image"],
    ["WAAS-ENT-SM-M=", "WAAS Enterprise License for SRE SM. Medium deployment.", "routers", "license", "sku-prefix:WAAS-"],
    ["MD-3Y-NDA-B-BA", "MATE Design Basic Bndl, 3Y Sub (inc sw support)", "routers", "license", "sku-prefix:MD-"],
    ["ML-P-SVR-DL", "MATE Live Dedicated Server License; Perpetual", "routers", "license", "sku-prefix:ML-"],
    ["CGR1K-IPSW-K9-42", "(ITRON ONLY) Connected Grid OS Software Version 4.2", "routers", "software", "sku-prefix:CGR1K-IPSW-"],
    ["C1-ISRWAAS-RTU2500", "Cisco ONE ISRWAAS RTU for 2500 connections", "routers", "license", "sku-regex:rtu-n"],
    ["ESS-ADN-AC-100G-RT", "Access Essentials to Advantage Upgrade RTU per 100G", "routers", "license", "sku-regex:rtu-per-g"],
    ["NGA-ADN-PRM-L-P", "ADN to PRM Perpetual SW for 8010 Type L Device", "routers", "license", "sku-prefix:NGA-"],
    ["SCUE-ISE-8.6-K9", "Cisco Unity Express Release 8.6", "routers", "software", "sku-prefix:SCUE-"],
    ["SCUSP-SM-8.5-K9", "Cisco Unified SIP Proxy Release 8.5", "routers", "software", "sku-prefix:SCUSP-"],
    ["SUMG-SM7-86-K9", "Cisco Unified Messaging Gateway Release 8.6", "routers", "software", "sku-prefix:SUMG-"],
    ["SLASR1-IPB", "Cisco ASR 1000 IP BASE License", "routers", "license", "sku-prefix:SLASR"],
    ["SDR-C-ISR4K-MON", "Cisco SDR-C-ISR4K-MON", "routers", "license", "sku-prefix:SDR-"],
    ["LS-RV34XSEC-DEV", "Security software subscription for Cisco RV34x routers", "routers", "license", "sku-prefix:LS-"],
    ["R-XRV9000-601-RRVG", "Cisco IOS XRV 9000 64-bit software, vRR profile with VGA support", "routers", "software", "sku-prefix:R-XRV"],
    ["C1-ISRWAAS-2500", "Cisco ONE ISRWAAS RTU for 2500 Connections", "routers", "license", "sku-prefix:C1-ISRWAAS"],
    ["C1-FL-C800-WAASX", "Cisco ONE WAASX Feature License RTU for 88x and 89x", "routers", "license", "sku-prefix:C1-FL-"],
    ["IOSXE-AUTO-MODE", "Cisco IOS XE Autonomous Mode (default mode)", "routers", "software", "sku-prefix:IOSXE-"],
    ["C8000-HSEC", "U.S. Export Restriction Compliance license for Catalyst 8000 series", "routers", "license", "sku-regex:hsec"],
    ["CRS-DDOS-10PK=", "10-PK Bundle for Arbor DDoS TMS on CRS", "routers", "license", "sku-prefix:CRS-DDOS-"],
    ["OAI-SPN-A-WAE-F-L", "Offer Attribution (Immediate) for SPNA WAE-F", "routers", "non_product", "sku-prefix:OAI-"],
    ["OAD-SPN-A-WAE-F-L", "Offer Attribution (Daily) for SPNA WAE-F", "routers", "non_product", "sku-prefix:OAD-"],
    ["ISR860-SW-SPARECD=", "Software CD for ISR 860", "routers", "software", "sku-suffix:SPARECD"],
    ["FW3.0.33", "ADSL Firmware for IOS 12406T and above", "routers", "software", "sku-regex:adsl-firmware"],
    ["ASR1002XIMGWSSH", "Image - with SSH", "routers", "software", "sku-regex:asr-image-kit"],
    ["DVD-I43-5.4-K9", "ISRWAAS software version 5.4 on DVD for ISR4300 Series", "routers", "software", "sku-prefix:DVD-"],
    ["QW-10-SW-K9", "Quantum WAVE Software Package", "routers", "software", "sku-regex:quantum-wave"],
    ["SW9105AX-EWCEX-K9", "Embedded Wireless Controller software for C1130/C1130X", "routers", "software", "sku-regex:ap-image"],
    ["A9K-MACSEC-40", "ASR 9000 MACSEC 40G Right to Use License - PAK", "routers", "license", "sku-prefix:A9K-MACSEC"],
    ["A9K-WDM-ADV-FEC=", "Advanced FEC License for 400G IPoDWDM LC, Per Port", "routers", "license", "sku-prefix:A9K-WDM-"],
    ["A9K9901-UP256-456G", "ASR 9901 256 – 456 Upgrade License", "routers", "license", "sku-regex:a9k-chassis-upgrade"],
    ["A9K-800G-IVRF", "Infrastructure VRF license to turn on up to 8 VRF instances per 8-port 100 Gigabit Ethernet line card", "routers", "license", "sku-regex:a9k-lc-feature-licence"],
    ["A9K-RSP440L-ALIC", "A9K-RSP440-LTUpgrade License to activate 440Gbps/slot", "routers", "license", "sku-exact:A9K-RSP440L-ALIC"],
    ["CPFLICENSEA8UM", "Cisco CPFLICENSEA8UM", "routers", "license", "sku-exact:CPFLICENSEA8UM"],
    ["CPFLICENSEA8UK", "Cisco CPFLICENSEA8UK", "routers", "license", "sku-exact:CPFLICENSEA8UK"],
    ["IOX-SOFTWARE", "Cisco IOX-SOFTWARE", "routers", "software", "sku-exact:IOX-SOFTWARE"],
    ["M-S-B-BV", "MATE Infra Visibility Bndl, Subscription", "routers", "license", "sku-regex:mate-bundle"],
    ["FLS-ASR1001-5G", "Upgrade from 2.5 Gbps to 5Gbps License for ASR 1001", "routers", "license", "sku-prefix:FLS-ASR"],
    ["C1-SL19-DATA-APPK9", "Cisco ONE DATA features for 1900 series APP license", "routers", "license", "sku-regex:cisco-one-sl"],
    ["ASR920-1588", "Cisco ASR 920 IEEE 1588-2008 BC/MC License", "routers", "license", "sku-exact:ASR920-1588"],
    ["CME-UL", "Cisco Communication Manager Express (CME) - 1 User License", "routers", "license", "sku-exact:CME-UL"],
    ["IOTFND-IR8100", "IoT FND Subscription License for Managing IR8100 Router (3/5/10 year)", "routers", "license", "sku-exact:IOTFND-IR8100"],
    ["IXM-LORAWAN-CPF", "System part number for Common Packet Forwarder license for LoRaWAN macro gateways. Available as an option when ordering main IXM PID’s", "routers", "license", "sku-exact:IXM-LORAWAN-CPF"],
    ["CRS-SWM-EXTN=", "IOS XR Software Support Extension for CRS for 1 year", "routers", "service", "sku-exact:CRS-SWM-EXTN"],
    ["NCS-MC-LIC600=", "NCS6000 per 60x10GE card IOS-XR M/C capability spare", "routers", "license", "sku-exact:NCS-MC-LIC600"],
    ["IR510-COMPUTE-1.4", "IR510 Software PID for compute module", "routers", "software", "sku-exact:IR510-COMPUTE-1.4"],
    ["DISK-MODE-RAID-5", "Configure Hard Drives as RAID 5", "routers", "non_product", "sku-exact:DISK-MODE-RAID-5"],
    ["DISK-MODE-RAID1JBD", "Configure Two Hard Drives in RAID 1 Config and 3rd Non RAID", "routers", "non_product", "sku-exact:DISK-MODE-RAID1JBD"],
    ["CRS-8-NO-FC", "CRS 8 slots with no fabric card option", "routers", "non_product", "sku-exact:CRS-8-NO-FC"],
    ["ASR1000-SPA", "SPA for ASR1000; No Physical Part; For Tracking Only", "routers", "non_product", "sku-exact:ASR1000-SPA"],
    // end routers (12 Sep 2026)
    // ---- security (12 Sep 2026) ------------------------------------------------------------------
    // One witness per rule of the security class-residue block, chosen by running the worktree's own
    // classify() over the whole 91,543-part catalogue and taking, per rule, a part it decides with
    // exactly that reason — preferring one with no facts at all. SKU and name are the catalogue's,
    // verbatim (the leading "^" on a few names is really in the row: a scraped bullet). Together the
    // 107 rules decide 4,553 parts and NOT ONE of them carries an own physical fact.
    // The count in the trailing comment is how many parts that rule decides catalogue-wide; where the
    // witness sits outside `security`, that is the rule reaching another category and is deliberate.
    //
    // SVP (service-provider) subscriptions.
    ["SAM8150TAMC-OPS", "SVP Cisco FirePOWER AMP8150 IPS, Apps and URL Adjustable OPS", "security", "license", "sku-regex:svp-model-glued"],      // 378
    ["S-ST-CL-PCM", "SVP SW Cloud Public Monitoring, Eff Mega Flows (EMF)", "security", "license", "sku-regex:svp-security-token"],               // 743
    ["F-S-FP8390-TA-3Y", "SVP Cisco FirePOWER 8390 IPS and Apps 3YR Service Subs", "security", "license", "sku-prefix:F-S-"],                     // 8
    ["ST-EP-OPS", "Cisco Secure Network Analytics Endpoint Adjustable OPS", "security", "license", "sku-regex:svp-ops-sms"],                      // 371
    // Software images.
    ["SF-FP5.4-K9", "Cisco FirePOWER Software v5.4", "security", "software", "sku-prefix:SF-"],                                                   // 497
    // Threat Defense / IPS licences glued to a firewall model, and the termed subscriptions.
    ["CSF12T-T", "CSF 1210CE Threat Defense IPS License", "security", "license", "sku-regex:threat-licence-glued"],                               // 131
    ["ASA5512-IP1Y", "ASA 5512-X NGFW IPS 1Year", "security", "license", "sku-regex:firewall-term-subscription"],                                 // 501
    ["ASA5515-IPS-SSP", "ASA 5515-X IPS SSP License", "security", "license", "sku-regex:asa-ips-ssp-licence"],                                    // 5
    ["ASA5505-SEC-PL", "ASA 5505 Sec. Plus Lic. w/ HA, DMZ, VLAN trunk, more conns.", "security", "license", "sku-regex:asa-security-plus"],      // 10
    ["ASA5500-ENCR-K7", "ASA 5500 Strong Encryption License (3DES/AES) for NPE HW", "security", "license", "sku-regex:asa-encryption-licence"],   // 3
    ["ASA5585-BOT-FIL", "ASA 5585-X Botnet Traffic Filter", "security", "license", "sku-regex:asa-botnet-term"],                                  // 1 — the untermed member; see the rule's probe
    // Firepower platform and cloud-management licences.
    ["FPR2120-P", "Cloud Management for FPR 2120", "security", "license", "sku-regex:fw-cloud-management"],                                       // 26
    ["FPR1000-ASA", "Cisco Firepower 1000 Standard ASA License", "security", "license", "sku-regex:fpr-standard-asa"],                            // 3
    ["FPR4K-ENC-K9", "Cisco Firepower 4000 Series ASA Strong Encryption (3DES/AES)", "security", "license", "sku-regex:fpr-platform-licence"],    // 15
    ["FPR9K-TD-BASE", "Cisco FPR9K Module Threat Defense Base License", "security", "license", "sku-exact:FPR9K-TD-BASE"],                        // 1
    ["CSF200-ASA-CAR", "Cisco Firewall 200 ASA Carrier License", "security", "license", "sku-regex:carrier-context-licence"],                     // 3
    ["FTDv5", "Cisco FTDv5", "security", "software", "sku-regex:ftdv-tier"],                                                                      // 6
    ["FWM-BASE", "Base Tenant entitlement: subscription of 1, 3, and 5 years available", "security", "license", "sku-prefix:FWM-"],               // 125
    ["CDO-ML-CSF1240", "Cloud Management and Logging for CSF1240", "security", "license", "sku-prefix:CDO-"],                                     // 6
    ["FMC-6.0-K9", "Cisco Firepower Management Center Software v6.0", "security", "software", "sku-regex:fmc-software"],                          // 3
    ["FPR-RVDP-1G", "Radware Virtual Defense Pro 1-Gbps license for Firepower", "security", "license", "sku-prefix:FPR-RVDP-"],                   // 6
    ["FP7120-VPN-K9", "Cisco FirePOWER 7120 VPN License", "security", "license", "sku-regex:ips-vpn-licence"],                                    // 26
    // IOS SSL VPN feature licences (routers' feature, filed in security).
    ["FL-SSLVPN25-K9", "Cisco SSLVPN Feature license - 25 users", "security", "license", "sku-prefix:FL-SSLVPN"],                                 // 6
    ["FL-WEBVPN-25-K9", "Feature License IOS SSL VPN Up To 25 Users (Incremental)", "security", "license", "sku-prefix:FL-WEBVPN"],               // 6
    // AMP / virtual-appliance. The software member is exact and runs first.
    ["FP-AMP-CLOUD-SW", "Cisco AMP Private Cloud Virtual Appliance.", "security", "software", "sku-exact:FP-AMP-CLOUD-SW"],                       // 1
    ["FP-VMW-TA-3Y", "Cisco FirePOWER Virtual IPS and Apps 3YR Service Subs", "security", "license", "sku-prefix:FP-VMW-"],                       // 13
    ["FP-AMP-1Y-S3", "Cisco Advanced Malware Protection 1YR, 500-999 Nodes", "security", "license", "sku-prefix:FP-AMP-"],                        // 65
    // Secure Client (AnyConnect) and ASA VPN licences.
    ["ASA-AC-M-5580", "AnyConnect Mobile - ASA 5580 (req. Essentials or Premium)", "security", "license", "sku-prefix:ASA-AC-M-"],                // 24
    ["ASA-AC-PH-5525", "AnyConnect VPN Phone License - ASA 5525-X (req Premium lic)", "security", "license", "sku-prefix:ASA-AC-PH-"],            // 24
    ["ASA-FPS-CL-5520", "FIPS compliant VPN Client License (ASA 5520)", "security", "license", "sku-prefix:ASA-FPS-"],                            // 24
    ["ASA-VPNP-5580", "Premium Shared VPN Participant License - ASA 5580", "security", "license", "sku-prefix:ASA-VPNP-"],                        // 22
    ["ASA-VPNS-50K", "Premium Shared VPN Server License - 50K users", "security", "license", "sku-prefix:ASA-VPNS-"],                             // 22
    ["ASA5500-SSL-50", "ASA 5500 SSL VPN 50 Premium User License", "security", "license", "sku-prefix:ASA5500-SSL-"],                             // 22
    ["ASA-SSL-25-50", "ASA 5500 SSL VPN 25 to 50 Premium User License Option", "security", "license", "sku-prefix:ASA-SSL-"],                     // 21
    ["ASA-VPN-FL-250=", "ASA 5500 SSL VPN 250 Premium Users - 2 mt - Burst License", "security", "license", "sku-prefix:ASA-VPN-FL-"],            // 6
    ["ASA-UC-50", "^ASA 5500 UC Proxy 50 Session License", "security", "license", "sku-prefix:ASA-UC-"],                                          // 17
    ["ASA-ADV-END-SEC", "ASA 5500 Advanced Endpoint Assessment License for SSL VPN", "security", "license", "sku-prefix:ASA-ADV-END"],            // 2
    ["CVPN-CSD-34", "Cisco Secure Desktop 3.4.x (All Platforms)", "security", "software", "sku-prefix:CVPN-"],                                    // 14
    ["ASA5505-SW-50", "ASA 5505 50 User software license", "security", "license", "sku-prefix:ASA5505-SW-"],                                      // 6
    ["ASA5515-ME-K8", "ASA 5515-X Intercompany Media Engine K8 License", "security", "license", "sku-regex:asa-media-engine"],                    // 16
    ["ASA1000V-04=", "4 ASA1000V / VNMC incremental licenses", "security", "license", "sku-prefix:ASA1000V-"],                                    // 10
    ["ASA5500-SW-SVC-K9", "^ASA 5500 Series SSL VPN Client Software (7.x Only)", "security", "software", "sku-prefix:ASA5500-SW-"],               // 2
    // Security Manager.
    ["CSMUCS50-47", "CSM 4.7 Server License for 50 devices", "security", "license", "sku-regex:csm-licence"],                                     // 222
    ["CSM4-UCS2-50-SW", "CSM 4.3 on Windows 2008 Enterprise R2 - 50 device license", "security", "license", "sku-regex:csm-ucs-software"],        // 4
    // Cloud security subscriptions, one witness per product line.
    ["KENNA-PD", "Cisco Vulnerability Management - Private Deployment", "security", "license", "sku-prefix:KENNA-"],                              // 19
    ["XDR-ESS", "Cisco XDR-ESS", "security", "license", "sku-prefix:XDR-"],                                                                       // 19
    ["SAL-CL-LA-1GB", "Cisco SAL, Logging Analytics and Detection, 1GB/Day Vol", "security", "license", "sku-prefix:SAL-"],                       // 26
    ["SEC-SVP-3P", "Cisco Security SVP 3 Product Bundle", "security", "license", "sku-prefix:SEC-"],                                              // 29
    ["SELA-SWATCH-PCM-5Y", "Security ELA to Stealthwatch PCM Allocation - 5Y", "security", "license", "sku-prefix:SELA-"],                        // 7
    ["SWATCHC-PNM-TRK-1Y", "Cisco Stealthwatch Cloud PNM Subs for DNA - 1 YR", "security", "license", "sku-prefix:SWATCHC-"],                     // 4
    ["ST-CL-PNM", "Cisco Secure Cloud Analytics Pvt Network Monitoring-Endpoint", "security", "license", "sku-prefix:ST-CL-"],                    // 3
    ["SWATCH-CL-PNM", "Stealthwatch Cloud PNM Term License", "security", "license", "sku-prefix:SWATCH-CL-"],                                     // 1
    ["AWS-CPPO-SCA-PCM", "AWS CPPO SCA Public Cloud Monitoring", "security", "license", "sku-prefix:AWS-CPPO-"],                                  // 3
    ["LICOA-SWATCHC-PNM", "LICOA-Cisco Secure Cloud Analytics - PNM", "security", "license", "sku-prefix:LICOA-"],                                // 1
    ["MCD-ADV", "Cisco MCD-ADV", "security", "license", "sku-prefix:MCD-"],                                                                       // 4
    ["CSAM-1V", "Security Intellishield Alert Mgr- 1 add-on virtual user- Titan SKU Reduction", "security", "license", "sku-prefix:CSAM-"],       // 11
    ["CPT-SEC-ADV", "Cisco Cloud Protection Security Suite -Advantage", "security", "license", "sku-prefix:CPT-SEC-"],                            // 2
    ["CLDPRT-SEC-SUITE", "Cisco Cloud Protection Security Suite", "security", "license", "sku-prefix:CLDPRT-"],                                   // 1
    ["SA-DLP", "Cisco SA-DLP", "security", "license", "sku-prefix:SA-"],                                                                          // 16
    ["E3-SEC-CDO", "Cisco E3-SEC-CDO", "security", "license", "sku-prefix:E3-SEC-"],                                                              // 4
    ["E2F-SEC-CDO", "Cisco E2F-SEC-CDO", "security", "license", "sku-prefix:E2F-"],                                                               // 4
    ["TG-CL-K9", "Cisco TG-CL-K9", "security", "license", "sku-prefix:TG-CL-"],                                                                   // 2
    ["H-ESAP-AT6K-K9=", "Hybrid Email, AMP, TG - Premium File Analysis, 6K Files/Day", "security", "license", "sku-prefix:H-ES"],                 // 42
    ["CES-AMP", "Cisco CES-AMP", "security", "license", "sku-prefix:CES-"],                                                                       // 16
    ["UMB-ROAM", "Umbrella Roaming", "security", "license", "sku-prefix:UMB-"],                                                                   // 32
    ["SCA-INS", "Cisco Attack Surface Management License", "security", "license", "sku-exact:SCA-INS"],                                           // 1
    // Threat Grid, FireSIGHT/FMC virtual, Cisco ONE, Nexus 1000V, Prime Cable Provisioning.
    ["TG5004-SW-K9", "Threat Grid Software for 5004 Model, Up to 1500 Files / Day", "security", "software", "sku-regex:tg-software"],             // 4
    ["FS-KVM-SW-K9", "Cisco Firepower Management Center, (KVM) for 25 devices", "security", "software", "sku-prefix:FS-KVM-"],                    // 3
    ["C1-1Y-UCD-1-K9", "UCS Director - 1 License for Server,Storage,Network", "servers-unified-computing", "license", "sku-regex:c1-term-tracking"], // 7, 1 outside security
    ["C1-LC-5-5Y", "Cisco ONE StealthWatch 5 FPS Term -5Y", "security", "license", "sku-prefix:C1-LC"],                                           // 8
    ["C1-FPR9K-44-TMC", "C1 FPR9K SM-44 Threat Defense Threat, Malware and URL License", "security", "license", "sku-prefix:C1-FPR"],             // 2
    ["N1K-ASA1K-16=", "Nexus 1000V and ASA 1000V Paper CPU License Qty 16", "security", "license", "sku-prefix:N1K-ASA1K-"],                      // 10
    ["N1K-VLCPU-16=", "^Nexus 1000V Adv Ed Paper Multi-Hypervisor License Qty 16", "security", "license", "sku-prefix:N1K-VLCPU-"],               // 6
    ["PCP-DPE", "Prime Cable Provisioning DPE License", "cloud-systems-management", "license", "sku-prefix:PCP-"],                                // 24, 14 outside security
    // Cyber Vision, Threat Defense Virtual, Stealthwatch / Lancope.
    ["CV-A", "Cisco CV-A", "security", "license", "sku-regex:cyber-vision-tier"],                                                                 // 24
    ["FTD-V-5S-T", "Cisco FTD-V-5S-T", "security", "license", "sku-regex:ftdv-subscription"],                                                     // 42
    ["LC-INTIAL", "Service for Initial Installation", "security", "service", "sku-regex:stealthwatch-service"],                                   // 3 (sic: the catalogue spells it INTIAL)
    ["LC-SLIC-FC-2K", "1 Year maintenance on SLIC for FC 2K", "security", "license", "sku-regex:stealthwatch-collection-licence"],                // 14
    ["LC-FC-2010-U-K9", "FC 1010 upgrade to FC 2010", "security", "license", "sku-regex:stealthwatch-upgrade-licence"],                           // 12
    ["CV-CNTR-M6N-SW", "Cyber Vision Center M6N Software", "security", "software", "sku-regex:cyber-vision-software"],                            // 2
    // Rules that deliberately reach other categories: the ASR 9000 licences filed in Security Manager,
    // and the term+user-band tail that is security's largest single family.
    ["A9K-40G-AIP-SE", "L3VPN Line Card License, for use with A9K-40GE-SE Line Cards", "routers", "license", "sku-regex:a9k-lc-feature-licence"],        // 40, 32 in routers
    ["ESA-SO-1Y-S6", "Email Sophos Anti-Virus 1Y Lic Key, 10K-24,999 Users", "security", "license", "sku-regex:term-user-band"],                  // 417
    // ISE, Broadband Access Center, Webex Meetings Server, Prime Security Manager, Nexus FCoE.
    ["R-ISE-VM-K9", "Cisco Identity Services Engine VM (eDelivery)", "security", "license", "sku-prefix:R-ISE-"],                                 // 16
    ["ISESW114-3415-M-K9", "Cisco Identity Services Engine software version 1.1.4", "security", "software", "sku-regex:ise-software-image"],      // 2
    ["BAC-SVS-500K=", "^BAC 500,000 subscriber service license", "security", "license", "sku-prefix:BAC-"],                                       // 3
    ["WBXMTSVR2-K9", "Webex Meetings Server 2.x Software Kit", "security", "software", "sku-regex:webex-meetings-server-kit"],                    // 4
    ["WMSVR2-UP-K9", "MTGS SRVR Upgrade - Phys Del - Standard Encryption", "security", "software", "sku-prefix:WMSVR"],                           // 2
    ["PRSM-DEV-5=", "PRSM - License - Manage 5 Additional Devices", "security", "license", "sku-prefix:PRSM-DEV-"],                               // 5
    ["PRSMV9-SW-5-PR", "Prime Security Manager - Software - 5 Device Promotion", "security", "software", "sku-regex:prsm-software"],              // 6
    ["N7K-FCOEF132XP=", "^FCoE License for Nexus 7000 32-port 10G SFP+ (F1), Spare", "security", "license", "sku-regex:nexus-fcoe-licence"],      // 2
    // The singletons whose own name says licence or software (class residue §C).
    ["ASA-SW-UPGRADE=", "Cisco ASA Software one-time upgrade for nonsupport customers", "security", "license", "sku-exact:ASA-SW-UPGRADE"],
    ["FPR2K-EXCLUDE-SUBS", "Cisco Firepower 2100 Series - Exclude Subscriptions", "security", "license", "sku-exact:FPR2K-EXCLUDE-SUBS"],
    ["FPR-SEC-TERM", "Cisco Secure Firewall Term Licenses - For Distributors/Drop Ship Orders", "security", "license", "sku-exact:FPR-SEC-TERM"],
    ["IPS-SW-7.1", "Cisco IPS Software 7.1", "security", "software", "sku-exact:IPS-SW-7.1"],
    ["ISA-FTD6.6-K9", "Cisco FTD unified software v6.6 for ISA3000", "security", "software", "sku-regex:isa-ftd-image"],
    ["ISA-FTD7.0-K9", "Cisco ISA-FTD7.0-K9", "security", "software", "sku-regex:isa-ftd-image"],
    ["SCPS-BASE-K9", "^Smart Connected Personalized Spaces Base Software", "security", "software", "sku-exact:SCPS-BASE-K9"],
    ["SCMS-BASE-K9", "^Smart Connected Meeting Spaces Base Software", "security", "software", "sku-exact:SCMS-BASE-K9"],
    ["SECURE-WORKLOAD-V", "Cisco Secure Workload Software Appliance", "security", "software", "sku-exact:SECURE-WORKLOAD-V"],
    ["CTS-SATELLITE=", "License for TelePres over satellite network - physical", "security", "license", "sku-exact:CTS-SATELLITE"],
    ["ESS-2020-L-B=", "^ESS-2020 LAN Lite Base to LAN Base Paper License Spare", "security", "license", "sku-exact:ESS-2020-L-B"],
    ["SS-EX-K9-1", "^S+C EXEC EXPERIENCE BASE LIC FOR 1 CONF ROOM & 1 EXEC OFFICE", "security", "license", "sku-exact:SS-EX-K9-1"],
    ["R-SS-EX-K9-1", "Cisco R-SS-EX-K9-1", "security", "license", "sku-exact:R-SS-EX-K9-1"],
    ["ASA5585-NETW4UP3", "Prime Network 4- Cisco ASA5585 - RTM Upgrade W/3 YR PASS", "security", "license", "sku-exact:ASA5585-NETW4UP3"],
    ["C1-TAAS-ENDPT-K9", "Cisco C1-TAAS-ENDPT-K9", "security", "license", "sku-exact:C1-TAAS-ENDPT-K9"],
    // LAST in the table, and the two that reach furthest outside security.
    ["WAE-7.2-K9", "WAE 7.2 Software", "routers", "software", "sku-regex:release-in-sku"],   // 12 Sep: the wae rule vetoes a release number, so the image rule decides it
    ["CVIM-SW-2.0-K9=", "Cisco VIM Software Version 2.0", "cloud-systems-management", "software", "sku-regex:release-in-sku"],                                                        // 128 outside security
    ["SEPC-SW-K9", "Cisco SEPC-SW-K9", "security", "software", "sku-suffix:-SW-K9"],                                                              // 88
    // ---- security round 2 (12 Sep 2026): the foreign paper licences filed in "Security Manager" ----
    // 351 parts decided between them, 110 of them in `security`, ZERO carrying an own physical fact.
    // The families that reach other categories are the same PID spellings there, so the witness is a
    // security row wherever one exists and the trailing comment carries both counts.
    ["SLFL-ASR1=", "Technology and Feature Paper PAKs for ASR1000 Series", "security", "license", "sku-regex:asr-paper-pak"],                     // 164, security 34
    ["FL-C1900-PA=", "^Cisco 19xx Performance Agent Spare", "security", "license", "sku-regex:feature-licence"],                               // 49, security 15
    ["XC-XLAT64-SL=", "SW license for Stateless NAT64", "security", "license", "sku-regex:xc-licence"],                                    // 52, security 5
    ["M92IOASSN=", "Cisco IOA License (1 engine) for SSN-16 on MDS 9200, spare", "security", "license", "sku-regex:mds-licence"],         // 6, security 3
    ["WAAS-ENT-NM=", "Cisco WAAS Enterprise License for 1 NME model 502 or 522", "security", "license", "sku-prefix:WAAS-"],      // 15, security 5
    ["ASR920-GNSS=", "ASR 920 GNSS License", "security", "license", "sku-regex:asr920-licence"],                                                  // 13, security 3
    ["EA-WBX-CNF-K9", "Enterprise Agreement WebEx Conferencing Suite - Top Level", "security", "license", "sku-regex:ea-top-level"],              // 6, security 5
    ["CUWL-STD-K9", "Unified Workspace Licensing - Top Level for STD - 9.x", "security", "license", "sku-prefix:CUWL"],                     // 1
    ["NETREG-SG", "^Network Registrar Smart Grid Physical Delivery PID (DCT use)", "security", "license", "sku-regex:prime-registrar-pid"],       // 6, security 4
    ["R-WMSVR2-UP-K9", "Cisco R-WMSVR2-UP-K9", "security", "software", "sku-regex:r-security-edelivery"],                                         // 5
    ["MP-WMS-MIG-K9=", "MP to MTGS SRVR- Phys Deliv -Standard Encrypt- DO A2Q SURVEY", "security", "software", "sku-prefix:MP-WMS-"],             // 1
    ["CDV-CIS-7.0-NFR", "Cisco CDV-CIS-7.0-NFR", "security", "license", "sku-regex:cdv-nfr"],                                                    // 2
    ["P-CDV-CIS-6.2-NFR", "Physical Delivery - Cisco DV-CIS Not For Resale Lic - 1 Yr T", "security", "license", "sku-regex:cdv-nfr"],            // the singleton this rule replaced
    ["CDAVLT-UP=", "^Vault upgrade, additional hours SD", "security", "license", "sku-prefix:CDAVLT-"],                                           // 1
    ["PRM-WAAS-WM-VIDEO=", "WAAS Coupon: Microsoft-Licensed Windows Media Live Streaming", "security", "license", "sku-prefix:PRM-WAAS-"],        // 1
    ["CSP-TPEX-RED=", "CUBE(SP) TP Session Paper PAK for ASR1000 Series, redundant", "security", "license", "sku-prefix:CSP-TPEX-"],              // 1
    ["CTIR-NGFW-S=", "Cisco Talos Incident Response Retainer-Small, Attach with NGFW", "security", "service", "sku-prefix:CTIR-"],                // 1
    ["LC-PROXY", "Proxy Flow Adapter Integration", "security", "license", "sku-regex:stealthwatch-feature"],                                      // 3
    ["LC-INITIAL=", "Service for Initial Installation", "security", "service", "sku-regex:stealthwatch-service"],                                 // the correctly-spelled twin of LC-INTIAL
    ["CV-LICENSE", "Cyber Vision subscription license *", "security", "license", "sku-exact:CV-LICENSE"],                                         // 1
    ["CSW-ONPRM-K9", "Cisco CSW-ONPRM-K9", "security", "license", "sku-regex:workload-subscription"],                                             // 8, security 4
    ["FTDc5", "Cisco FTDc5", "security", "software", "sku-regex:ftdc-tier"],                                                                      // 6
    ["FP9K-OPT-OUT", "Opt out of SVP FirePOWER 9K selection", "security", "non_product", "sku-exact:FP9K-OPT-OUT"],                               // 1
    ["AC-NAMFIPS-DRV", "3eTI FIPS Drivers for AnyConnect Network Access Manager", "security", "license", "sku-prefix:AC-NAMFIPS-"],               // 2
  ];
  for (const [sku, name, cat, klass, reason] of added) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`${reason} fires on ${sku}`, got.klass === klass && got.reason === reason,
      `${got.klass} / ${got.reason}`);
    seenReasons.add(got.reason);
  }
}
// --- ROUND 4 REFUSALS: the products each new rule must never touch ---------------------------------
// Every one is a real part that a slightly wider version of the rule above it would have deleted.
// If one goes red, a rule was widened and this names the product it just declassified.
{
  const mustStayHardware: [string, string, string, string][] = [
    // sku, name, category, which rule would have eaten it
    // NAMES ARE THE CATALOGUE'S, verbatim (11 Sep 2026). Seven entries here had been paraphrased, and
    // a paraphrase can hide exactly what a name rule reads: PROMO-AP2800-S-K9 is really "...with DNA-A
    // Lic -S Domain", and the tidied test name had dropped the "Lic". A refusal tested on a cleaner
    // name than the part carries is a stand-in, not the part.
    ["C9300-48U-A", "C9300-48U-A – Catalyst 9300 48-port 1G copper with modular uplinks, UPOE, Network Advantage",
      "switches", "tier-upgrade / a name rule on 'Network Advantage' (206 hits, ~200 real switches; this one has 7 physical facts)"],
    // video (12 Sep 2026): real hardware beside each new video rule
    ["CBR-8-CCAP-CHASS", "Cisco cBR-8 Series CCAP Router Chassis", "video", "exact CBR-8 (the container) — the chassis must stay"],
    ["CBR-8-SYSTEM-KIT", "Cisco approval required to book; a system without line cards", "video", "exact CBR-8 / the container rule widened to a prefix"],
    ["GS7K-OPT-NODE", "GS7000 Node", "video", "exact GS7000 widened to a prefix — every GS7000 node would go"],
    ["GS7000-OP-BWDM-NCBC8-BC18-NC2027FR-SAMPO", "Cisco GS7000-OP-BWDM-NCBC8-BC18-NC2027FR-SAMPO", "video", "exact GS7000 widened to a prefix — an optical-hub passive"],
    ["HA-RPHY-CHASSIS", "Cisco Remote PHY Shelf 7200 Chassis", "video", "exact HA-RPHY (the container) widened to a prefix"],
    ["RFGW-1", "RFGW-1-D CHASSIS,FPD,I/O,FANs, 2 PS AND 6 QAM MODULE SLOTS", "video", "rfgw-mgmt-utility widened past R[MP]U"],
    ["RFGW-10-RFSW1", "RFGW RF Switch v1", "video", "rfgw-mgmt-utility widened to any RFGW-10-R*"],
    ["4021052", "LGX-DWDM-SQAM 8Ch 1G SA EXP DTP 20, 21, 22, 23, 24, 25, 26, 27", "video", "a numeric licence exact widened to a 40210 prefix"],
    ["P2-15TXM-12-EM-IWDM-SA-ITU20-1WD", "Cisco P2-15TXM-12-EM-IWDM-SA-ITU20-1WD", "video", "exact ITU20 widened to a contains — an iWDM transmitter"],
    ["C9500-24Q-A=", "Catalyst 9500 24-port 40G, Adv. License, no PS",
      "switches", "the trap named in the round-3 comment: structurally identical to N55-96P-SSK9 and it is a real Catalyst"],
    ["N3K-C3172-FA-L3", "Nexus 3172PQ, Forward Airflow (port side exhaust), AC P/S, Base and LAN Enterprise License Bundle",
      "switches", "any name rule on 'License' — 37 of these exist and each is a box you rack"],
    ["C9500X-28C8D-E", "Catalyst 9500 28x100G + 8x400G switch, NW Essentials License",
      "switches", "a name rule on 'Network/NW Essentials'"],
    ["WS-CF-UPG=", "Catalyst 6500/Cisco 7600 Compact Flash Adapter with 512M CF",
      "switches", "a `-UPG` suffix rule — this is a physical flash adapter, which is why -UPG was rejected"],
    ["CAB-TA-SW", "Switzerland AC Type A Power Cable",
      "switches", "a `-SW` suffix rule: SW is the COUNTRY here"],
    ["DS-SFP-FC16G-SW", "16-Gbps Fibre Channel shortwave SFP+, LC connector (16G Fibre Channel support only on last 24 ports (highlighted in Orange on the chassis for easy identification ) of the Cisco Nexus 5672UP-16G",
      "transceiver", "a `-SW` suffix rule: SW is SHORT WAVELENGTH here, the same reach-code trap as -S/-L/-Z"],
    ["FP8250-BASE-K9", "Cisco FirePOWER 8250 Chassis, No IPS Lic, 2U, 7 Slots",
      "security", "a name rule on 'Lic' — this chassis's name says it has NO licence"],
    ["WS-C4500X-24X-IPB", "Cisco WS-C4500X-24X-IPB Catalyst 4500-X gemanagter L3-10G-Aggregations-Switch (24× 10G-SFP+, IP Base, 1 HE)",
      "switches", "an `-IPB` rule — IP Base is a FEATURE TIER in real switch PIDs; this one carries 13 own facts"],
    // --- round 5 refusals -------------------------------------------------------------------
    ["PROMO-AP2800-S-K9", "AP2800(Internal Ant only) Promotion with DNA-A Lic -S Domain",
      "wireless", "a `PROMO-` prefix — 99 parts, and these are real access points bundled with a licence"],
    // THIS ONE PASSED THE AUTOMATED GATE and was killed by reading the family: 0 physical facts and
    // 53 of 53 "licence-named", because every name contains "AP Lic." — and all 53 ship a
    // controller with five or ten physical access points.
    ["AIRCT2504-1602IH10", "Bundle WLC2504 w/ 10 AP Lic. and 10 AP-1602i H Reg Domain",
      "wireless", "an `AIRCT2504-` prefix — every member is a controller-plus-APs hardware bundle"],
    ["HX-SP-NVME-6X8TB", "HX NVMe Pak w/1x375GB Optane, 1x1TB NVMe, 6x8TB NVMe",
      "hyperconverged-systems", "an `HX-SP` prefix — this is a drive pak; only HX-VSP (vSphere) is a licence"],
    ["ASR5K-SMC-K9", "System Management Card 4GB",
      "wireless", "the bare `ASR5K-` prefix — 32 of the 175 outside the 00/99 blocks carry physical facts"],
    ["ASR5K-MEM-PSC2=", "DIMM Replacement Kit for PSC2 - 32GB",
      "wireless", "the bare `ASR5K-` prefix, again"],
    ["NCS2K-MF-COVER=", "1RU cover for mechanical frame",
      "optical-networking", "an `NCS2K-M` prefix — 9 of those 90 carry physical facts"],
    ["HX-NVMEI4-I1600", "1.6TB 2.5in U.2 Intel P5600 NVMe High Perf Medium Endurance",
      "hyperconverged-systems", "an `HX-NV` prefix — 29 of 139 carry physical facts; they are drives"],
    // Round 6, 10 Sep 2026 — found by asking which NON-hardware parts carry an own PHYSICAL fact.
    ["E-SSD-SATA-1TB=", "1 TB, SATA SSD drive for UCS-E M6 spare",
      "servers-unified-computing", "the round-1 `E-` licence prefix — E- means e-delivery, but E-SSD- is the UCS-E module's drive family"],
    ["UCS-EZ-ENSC-B200", "UCS B200 M3 Blade Server w/ 2650, 8x16GB, Dual VIC",
      "servers-unified-computing", "ucsKind's `EZ` os-license token — a SmartPlay pack of real blade servers"],
    ["UCSW-SD480G0KA4-C", "480GB 2.5 inch SATA SSD",
      "servers-unified-computing", "ucsKind's `UCSW` os-license token, generalised from one part to the whole Invicta line"],
    ["UCS-SL-HANA-7", "HANA Solution with 8 B440 M2 Blades",
      "servers-unified-computing", "ucsKind's `SL` os-license token"],
    // Round 7 refusals — each a real product a slightly wider round-7 rule would have deleted.
    ["ACI-C9336-APIC-B1", "ACI Bundle with 2 9336 and APIC",
      "switches", "a bare `ACI-` prefix — ACI bundles ship real Nexus 9336 switches"],
    ["WS-SUP720-3BXL", "Catalyst 6500/Cisco 7600 Supervisor 720 Fabric MSFC3 PFC3BXL",
      "switches", "a bare `-XL` suffix — this is a supervisor engine, which is why the rule is anchored to N7K-C70nn-XL"],
    // C3750X-24S-S stood here until 11 Sep 2026, described as a real product. It is NOT in the
    // catalogue — Cisco's PID is WS-C3750X-24S-S, which the anchored regex never sees at all. Replaced
    // by a catalogue switch of exactly the shape the widening admits: a LETTERED port token, one tier.
    ["C9300-24UB-A", "C9300-24UB-A – Catalyst 9300 higher scale 24-port 1G copper with modular uplinks, UPOE, Network Advantage",
      "switches", "the widened tier-upgrade regex — lettered port token (24UB), ONE tier letter, 15 facts"],
    ["C9300-24S-A", "C9300-24S-A – Catalyst 9300 24-port 1G SFP with modular uplinks, Network Advantage",
      "switches", "the widened tier-upgrade regex — one tier letter, a real switch"],
    // Round 8 refusals — each a real product the obvious wider form of a round-8 rule would take.
    ["C1000-16T-2G-L", "Cisco C1000-16T-2G-L Catalyst-1000-Managed-Switch (L2, IOS) – 16× 1G-RJ45 + 2× 1G-SFP",
      "switches", "cisco-one widened to C1 + anything — a Catalyst 1000 switch with 13 facts puts a DIGIT after C1"],
    ["C1100TG-1N32A", "Cisco 1100 Terminal Services Gateway w/ 32 Async, 1 NIM (support for 2 GB DRAM)",
      "cloud-systems-management", "cisco-one widened to C1 + anything — a terminal gateway with 25 facts"],
    ["C1-N9K-C9364C", "Cisco ONE Nexus 9300 ACI & NX-OS Spine, 64p 40/100G",
      "switches", "a bare C1- prefix — a Cisco ONE spine SWITCH, why only named C1- sub-families are rules"],
    ["CONE-2921-ATO", "ISR 2921 for Cisco ONE",
      "routers", "a bare CONE- prefix — an assemble-to-order ISR 2921 router"],
    ["CD-DSKCAM-C-US", "Cisco Desk Camera 4K in carbon black for United States (includes USB 3.0 C-to-A and USB 3.0 C-to-C cables)",
      "collaboration-endpoints", "a bare CD- prefix — a desk camera"],
    ["SSD-120G=", "Cisco pluggable USB3.0 120G SSD storage, spare",
      "switches", "ios-image widened to three-digit releases — the 120G reads as a release"],
    ["C4500E-S7L/2-IPB", "Upgrade to Redundant Sup7L-E with IPBASE License",
      "switches", "a bare -IPB suffix (WS-C4500X-24X-IPB above is the other) — this upgrade ships a redundant supervisor"],
    // The dummy-PID name rule matches "dummy" and "placeholder" only: an NCS "HW Tracking PID" is the
    // line the chassis ships under in the consumption model.
    ["NCS-55A1-24Q6-TRK", "NCS 55A1 Fixed 24X10, 25G and 6X100G chassis HW Tracking PID",
      "routers", "a name rule on 'tracking PID' — this is the chassis' own line in the consumption model"],
    ["N5K-C5548UP-FA", "Chassis includes 32 fixed unified ports, Front-to-Back Airflow, 2 750W AC Power Supplies, Fan Trays, 1 Expansion Slot",
      "switches", "nxos-image without the no-hyphen anchor — N5K- followed by a chassis"],
    // Transceiver kind census refusals, 11 Sep 2026. A TWO-letter -xx is Cisco's region code on Small
    // Business gear; the first draft of family-placeholder (`X{2,}`) filed 190 such switches as non-products.
    ["SG350-28-K9-xx", "Cisco SG350-28-K9-xx", "switches", "family-placeholder at X{2,} — -xx is the REGION, not a spec"],
    ["SF110D-08-xx", "Cisco SF110D-08 8-port 10/100 Desktop Switch", "switches", "family-placeholder at X{2,} — a real desktop switch with 9 facts"],
    ["CBS350-8P-2G-xx", "Cisco CBS350-8P-2G-xx", "switches", "family-placeholder at X{2,} — region code on a Catalyst Business switch"],
    // (SC9800CLAMIK9-xxxx stood here asserting "stays hardware". MOVED into the wl-uc-class block on
    //  12 Sep 2026: the family-placeholder comment says outright that the 9800-CL cloud controllers
    //  "are software, not placeholders", and that lane has now given them `software`, so the proxy
    //  assertion is false while the thing it proves — family-placeholder must not decide them — still
    //  holds and is asserted there against the rule by name.)
    ["SFP-GE-S", "Cisco SFP-GE-S 1000BASE-SX SFP-Modul — SX (Kurzstrecke), Multimode, bis 550 m (OM3)", "transceiver", "firepower-svp-subscription without its digits-after-SFP anchor"],
    // routers (12 Sep 2026) — each a real part the obvious wider form of a routers class rule would take. Names verbatim.
    ["XC-SLOT-CVR-E", "X-Series Family Slot Cover", "switches", "xc-licence without its SLOT- fence — a slot cover"],
    ["XR-10GB-LR", "10GBASE-LR X2 (single-mode fiber)", "switches", "a bare XR- prefix — an X2 optic"],
    ["MC-3G-HSPA-U", "3.5G (non-US) HSPA MC8795V with SMS/GPS", "routers", "mate-collector widened to bare MC- — a 3G modem card"],
    ["MC-3G-HSPA+7", "3.7G (non-US) HSPA+ Release 7 MC8705 with SMS/GPS", "routers", "mate-collector widened to bare MC- ('Release 7' is the radio release)"],
    ["CUBESP-AP-H250B/K9", "CUBE(SP) appliance,250 Session,10G Engine,2xSIP10,16xGE,HA", "routers", "cube-sp-session without its AP- fence — the appliance"],
    ["FL-8XX-512U1GB", "512 MB DRAM upgrade to 1 GB for Cisco 892FSP, 896VA, 897VA, 897VAB, 898EA, 891F model (Feature License)", "routers", "feature-licence without its DRAM-upgrade fence (a physical fact)"],
    ["FL-1900-256U512MB", "CISCO1905 DRAM Upgrade from 256MB to 512MB", "interfaces-modules", "feature-licence fenced only on FL-8XX- — the same DRAM-upgrade shape, found by the dry run"],
    ["CSP-5444", "2RU NFV Platform 2 CPU-44 cores", "switches", "cube-sp-pak widened to bare CSP- — an NFV platform"],
    ["ESS-9300-10X-E", "ESS9300 board, no cooling plate, Network Essentials software", "switches", "rtu-per-g widened to bare ESS- — a board with 3 physical facts"],
    ["CISCO2911-HSEC+/K9", "VPN ISM module HSEC bundles for 2911 ISR platform", "routers", "hsec widened past the +/ — an ISM module bundle"],
    ["CRS-FP140-C", "Cisco CRS Series Forwarding Processor 140G inc MC&TE license", "routers", "CRS-DDOS- widened to bare CRS- — a forwarding processor"],
    ["A9K-MPA-32X1GE", "ASR 9000 32-port 1-Gigabit Ethernet Modular Port Adapter with MACSec, requires cSFP or SFP optics", "routers", "a bare A9K- licence prefix — a port adapter with a physical fact"],
    ["A9K-36X10GE-SE", "Cisco ASR 9000 36-Port 10GE Service Edge Optimized Line Card, requires SFP+ optics", "routers", "a9k-lc-feature-licence not anchored to the whole tail — the CARD its -AIP-SE licence is for"],
    ["IXM-LPWA-900-K9+", "TAA PID for Cisco wireless gateway for LoRaWAN, operates on the frequency subset of 902 - 928 MHz ISM band, applicable to LoRaWAN regional profile for Americas, Asia (not for India and China) and Pacific", "routers", "IXM-LORAWAN-CPF widened to IXM- — the gateway"],
    ["IW9165E-x-AP", "Industrial Wireless 9165E, 11ax 6E, 4 RF ports, x domain, Wi-Fi AP software", "routers", "a region placeholder rule on -x- — the SG350-xx lesson: identical hardware in every domain"],
    ["M-ASR1002X-4GB", "Cisco ASR1002-X 4GB DRAM", "routers", "mate-bundle widened to bare M- — a DRAM module"],
    // Hardware BUNDLES that carry a licence in the name (reviewer §6.1): every one ships a router.
    ["ISR4331-SEC/K9", "Cisco ISR 4331 Sec bundle w/SEC license", "routers", "a name or -SEC rule on a licence bundle — ships an ISR 4331"],
    ["ISR4331-V/K9", "Cisco ISR 4331 UC Bundle, PVDM4-32, UC License", "routers", "a UC-licence rule — ships an ISR 4331 and a PVDM4"],
    ["CISCO2921-SEC/K9", "Cisco 2921 Security Bundle w/ SEC license PAK", "routers", "a 'license PAK' name rule — ships a 2921"],
    ["C2911-VSEC/K9", "Cisco 2911 Voice Sec. Bundle, PVDM3-16, UC and SEC License PAK", "routers", "a 'License PAK' name rule — ships a 2911"],
    ["C1-CISCO4331/K9", "Cisco ONE ISR 4331 (3GE,2NIM,1SM,4G FLASH,4G DRAM,IPB)", "routers", "a bare C1- prefix — the Cisco ONE HARDWARE bundle"],
    ["ASR1002X-10G-K9", "ASR1002-X, 10G, K9, AES license", "routers", "an 'AES license' name rule — a chassis bundle"],
    ["ASR1001-X", "Cisco ASR 1001-X Router Chassis (ESP integrated; upgradable from 2.5-Gbps to 20-Gbps via software activated license)", "routers", "any name rule on 'software activated license'"],
    ["CISCO5940RA-K9", "Cisco 5940 ESR air-cooled card with 4 Gigabit Ethernet ports and 1 console port. Includes Cisco 5940 Advanced Enterprise Services Cisco IOS Software.", "routers", "a name rule on 'IOS Software' — an embedded router card"],
    ["SPIAD2901-8FXS/K9", "Cisco SPIAD2901 with 8FXS, PVDM3-16, UC License PAK", "routers", "a 'License PAK' name rule — a 2901 with FXS ports"],
    ["ISR4331-SPM", "Cisco ISR 4331 (3GE, 2NIM, 1SM) w/ SDWAN Promotion", "routers", "a promotion rule — the router sold on promotion"],
    ["ASR1000-RP3-PR", "Cisco ASR1000 Route Processor 3 Promotion", "routers", "a promotion rule — a route processor"],
    ["C881G+7-K9", "Secure Router with WAN FE and Embedded 3.7G HSPA+ Release 7 with SMS/GPS", "routers", "a 'Release' software rule — a router with an embedded modem"],
    // end routers (12 Sep 2026)
    ["SG350-28-K9-xx", "Cisco SG350-28-K9-xx", "switches", "family-placeholder at X{2,} — -xx is the REGION, not a spec"],
    ["SF110D-08-xx", "Cisco SF110D-08 8-port 10/100 Desktop Switch", "switches", "family-placeholder at X{2,} — a real desktop switch with 9 facts"],
    ["CBS350-8P-2G-xx", "Cisco CBS350-8P-2G-xx", "switches", "family-placeholder at X{2,} — region code on a Catalyst Business switch"],
    // (SC9800CLAMIK9-xxxx stood here asserting "stays hardware". MOVED into the wl-uc-class block on
    //  12 Sep 2026: the family-placeholder comment says outright that the 9800-CL cloud controllers
    //  "are software, not placeholders", and that lane has now given them `software`, so the proxy
    //  assertion is false while the thing it proves — family-placeholder must not decide them — still
    //  holds and is asserted there against the rule by name.)
    ["SFP-GE-S", "Cisco SFP-GE-S 1000BASE-SX SFP-Modul — SX (Kurzstrecke), Multimode, bis 550 m (OM3)", "transceiver", "firepower-svp-subscription without its digits-after-SFP anchor"],
    // ---- security (12 Sep 2026) ------------------------------------------------------------------
    // The nine products the security block's wider forms would have deleted. Each is named in that
    // block's REFUSED comment; this is where the refusal is actually enforced. SKUs and names verbatim.
    ["S-4554LC80D", "MikroTik S-4554LC80D 1,25G SFP BiDi – Singlemode, Single-LC, 80 km",
      "transceiver", "a bare `S-` prefix on svp-security-token — a MikroTik BiDi optic with 8 facts; the rule is a token list for exactly this reason"],
    ["SSTACK-LS-OPS", "SwiftStack Operations & Admin Training (max 10 attendees)",
      "servers-unified-computing", "svp-ops-sms unvetoed — an `-OPS` that is OPERATIONS TRAINING, not an Adjustable OPS subscription"],
    ["FP-PWR-DC-650W", "Cisco FirePOWER 650W DC Power Supply",
      "security", "a bare `FP-` prefix under FP-AMP-/FP-VMW- — this is a power supply"],
    ["FP-NMSB-10G", "Cisco FirePOWER LCD 10G Switch - 2U",
      "security", "a bare `FP-` prefix, again — a module"],
    ["ASA-SSP-60-INC1", "ASA 5585-X Security Services Processor-60 with 6GE, 4SFP+",
      "security", "a bare `ASA-SSP-` prefix — 46 of these are the 5585-X's physical blades, which is why asa-ips-ssp-licence is anchored to ASA55[1-5]n-IPS-SSP"],
    ["LC-FC-PWR-AC-1200W", "1200W / 800W V2 AC Power Supply for 2U C-Series Servers",
      "security", "a bare `LC-` prefix under the Stealthwatch licence rules — a Lancope appliance PSU"],
    ["CV-CNTR-M8N", "Cyber Vision Center hardware appliance ( Cisco UCS C225 M8 Rack Server )",
      "security", "a bare `CV-` prefix under cyber-vision-tier — the Center APPLIANCE, 5 facts of which 2 are physical; only CV-E/CV-A/CV-IDS are licences and only -SW is software"],
    ["ST-M5-10G-4FI", "Cisco Stealthwatch Accelerated 4x10G SFP+ NIC",
      "security", "a bare `ST-` prefix under svp-ops-sms / ST-CL- — a NIC card carrying a fact"],
    ["C1-TETRATION", "Cisco Secure Workload bundle part number that includes the hardware and software subscription license.",
      "security", "a bare `C1-` prefix under C1-LC / C1-FPR / c1-term-tracking — a hardware bundle; its own name says hardware"],
    ["CSM4-UCS2-150-HW", "CSM UCS bundle to manage 150 devices",
      "security", "csm-ucs-software widened off the `-SW` tail — the -HW half is a UCS server bundle, and securityKind files it `management`"],
    ["FPR1010T-SBE", "Cisco Secure Firewall FPR1010 Small Business Edition",
      "security", "threat-licence-glued without its `-SBE` except — bundle or licence is undecided (open question), so it stays hardware rather than being guessed"],
    ["ASA5512-SSD120-K9", "NGFW ASA 5512-X w/ SW,6GE Data,1GE Mgmt,AC,3DES/AES,SSD 120G",
      "security", "any `-SW,` name rule and, in securityKind, the drive marker — this is the APPLIANCE ordered with its SSD"],
    // Round 2 refusals: the products the foreign-paper-licence rules must never take.
    ["ASR920-PWR-BLANK", "ASR920 Power Supply Blank Cover",
      "routers", "a bare `ASR920-` prefix — a power supply blank cover; asr920-licence is anchored to IPSEC / GNSS / nG-n"],
    ["TA-CL-8U-M6-K9", "Cisco Secure Workload Gen3 8RU Cluster",
      "security", "workload-subscription widened to `TA-` — a Gen3 hardware cluster"],
    ["FPR9K-SUP=", "Cisco Firepower 9000 Series Supervisor Spare",
      "security", "nothing in round 2, and it is pinned because securityKind now files it `module`: a supervisor is real hardware"],
    // ===== modules-misc (12 Sep 2026): the refusals for the block at the foot of the case table.
    // Each one is a real part a slightly wider version of one of my rules would have eaten, and
    // every one was found by reading the gate output across all 91,682 parts.
    ["ASA5505-50-AIP5-K9", "Cisco ASA 5505 50-User Adaptive Security Appliance with AIP-SSC-5 (chassis, software)", "interfaces-modules", "ASA5500-SC- widened to ASA55- — this is an appliance bundle with 2 facts"],
    ["CSC-SSM-20", "Cisco CSC-SSM-20", "interfaces-modules", "ASA-SC- widened to drop the ASA — the real content-security module"],
    ["ACE30-MOD-K9", "Application Control Engine 30 Hardware", "interfaces-modules", "ace30-upgrade-entitlement widened to bare ACE30- — the MODULE itself"],
    ["ACE30-MOD-16-K9", "ACE30 Module with 16G, 6G Comp, 30K SSL TPS and 250VC", "interfaces-modules", "ace30-upgrade widened — a real module, not an upgrade"],
    ["MG21-HW-NA", "Meraki MG21 Cellular Gateway – North America", "meraki", "meraki-term-license widened to ^MG — the gateway itself"],
    ["MG21E", "Cisco MG21E", "meraki", "meraki-term-license without its -\\d+Y tail"],
    ["HF6100-32D-D", "Cisco 6000 Hyperfabric switch, 32x400Gbps QSFP-DD, configurable hardware only", "data-center-networking", "hyperfabric-subscription widened to -[DS]$ — 'hardware only' is the refusal"],
    ["HF6100-64ED-S", "Cisco 6000 Hyperfabric switch, 64x800Gbps OSFP, fixed hardware only", "data-center-networking", "hyperfabric-subscription without its -SVC anchor"],
    ["UCS-FI-6536-U", "1RU FI for UCS Manager, with no PSU, with 36 ports", "interfaces-modules", "ucs-fi-mandatory-sw-license widened past its -SW tail — a real fabric interconnect"],
    ["NAM2420-K9", "Cisco NAM2420-K9", "interfaces-modules", "nam-software-image widened to bare NAM — the appliance itself"],
    ["WS-SVC-NAM3-6G-K9", "Cisco Catalyst 6500 Series Network Analysis Module (NAM-3)", "interfaces-modules", "nam-software-image widened to contains:NAM — the blade itself"],
    ["7300-1OC48POS-SMS", "Cisco 7304 1-Port OC-48c/STM-16 Packet over SONET/SDH Line Card", "interfaces-modules", "security's announced -SMS suffix rule — SM-S is single-mode SHORT REACH, and this card has an own fact"],
    ["FL-1900-256U512MB", "CISCO1905 DRAM Upgrade from 256MB to 512MB", "interfaces-modules", "routers' announced ^FL-(?!8XX-) — a DRAM upgrade carrying its own dram fact"],
    ["SD-X45-2GB-E=", "Cisco Catalyst 4500 SD card 2GB", "interfaces-modules", "datasheet-cell 1E-\\d+ or \\d+M widened past the whole-SKU anchor"],
    ["CB-LC-LC-MMF10M", "Cisco CB-LC-LC-MMF10M", "interfaces-modules", "datasheet-cell \\d+(\\.\\d+)?M without the whole-SKU anchor — a 10 m patch cord"],
    ["OC48E/POS-LR-FC-B", "1 Port OC-48c/STM-16c SONET/SDH 1550nm LR with FC", "interfaces-modules", "datasheet-cell OC-?\\d+ without the whole-SKU anchor — a real POS line card"],
    ["MPO-12P-QSFP", "Cisco MPO-12P-QSFP", "transceiver", "datasheet-cell MPO-?\\d+ without the whole-SKU anchor"],
    ["SR-1G-2C", "Cisco SR-1G-2C", "transceiver", "datasheet-cell (IR|LR|SR)-\\d without the whole-SKU anchor"],
    ["ONS-SC-Z3-1470=", "SFP – OC-48/STM-16/GE, CWDM, 1470 nm", "transceiver", "literal-placeholder widened to XXX[A-Z]$ — the concrete wavelength SKU"],
  ];
  for (const [sku, name, cat, wouldEat] of mustStayHardware) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`stays hardware: ${sku} (would have been eaten by ${wouldEat.slice(0, 46)})`,
      got.klass === "hardware", `got ${got.klass} / ${got.reason}`);
  }
}

// servers (12 Sep 2026) ------------------------------------------------------------------------------------
// S1-S7 and the hyperconverged-only rules. Every SKU is a live catalogue row (read-only snapshot, 11/12 Sep).
{
  const SRV = "servers-unified-computing", HXS = "hyperconverged-systems", HCI = "hyperconverged-infrastructure";
  const POS: [string, string, string, ProductClass, string][] = [
    ["N10-MGT016", "UCS Manager v4.0", SRV, "software", "sku-regex:ucs-manager-image"],
    ["N20-FW018", "UCS 5108 Blade Chassis FW Package 4.2", SRV, "software", "sku-regex:ucs-firmware-package"],
    ["N10-L003", "UCS 6100 Series Fabric Interconnect/Storage protocol license", SRV, "license", "sku-regex:ucs-fi-port-licence"],
    ["HX-L-6400-25G", "FI per port license to connect to B-Series, C-Series or FEX", HXS, "license", "sku-regex:ucs-fi-port-licence"],
    ["UCS-MDMGR-1S", "Cisco UCS-MDMGR-1S", SRV, "license", "sku-regex:ucs-management-licence"],
    ["CIMC-C220M4-209E", "Cisco C-Series Software 2.0(9e) for C220 M4 servers", SRV, "software", "sku-regex:ucs-platform-software"],
    ["UCSC-SWRAID5=", "Software Raid 5 upgrade key for embedded Raid", SRV, "license", "sku-regex:ucs-licence-key"],
    ["E3A-CWOM-A", "Cisco Workload Optimization Manager Advantage - Per VM", SRV, "license", "sku-contains:CWOM"],
    ["HXDPS001-3YR", "HyperFlex Data Platform Datacenter Advantage Subscription", HXS, "license", "sku-regex:hyperflex-data-platform-licence"],
    ["NT-NCI-STR-PR", "Cisco NT-NCI-STR-PR", HCI, "license", "sku-prefix:NT-"],
    ["PLHC-HXMCVSI-OND", "Cisco+ Hybrid Cloud HX VSI Compute Ondemand for Memory", HXS, "license", "sku-regex:cisco-plus-hybrid-cloud"],
    ["HCI-NVGRVAS-4YRM6", "NVIDIA GRID Software Subscription - VDI Apps 1CCU - 4 Year", HCI, "license", "sku-regex:hyperconverged-sw-subscription"],
    // the ucsKind class mapping, widened to the two hyperconverged categories
    ["HX-MSWS-19-ST16C", "Cisco HX-MSWS-19-ST16C", HXS, "license", "ucs-kind-os-license"],
    ["HX-E-TOPO1", "10GbE Single or Dual Switch (2, 3, or 4 node)", HXS, "non_product", "ucs-kind-non-product"],
  ];
  for (const [sku, name, cat, want, reason] of POS) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    seenReasons.add(got.reason);
    check(`servers: ${sku} -> ${want} (${reason})`, got.klass === want && got.reason === reason, `got ${got.klass} / ${got.reason}`);
  }
  // REFUSALS — more of them than positives. Each is a real product one of the rules above would cost if
  // widened: named in the survey's refusal table or read out of the same families.
  // BOUNDED AT BOTH ENDS (12 Sep 2026). This was `slice(firstServersRule)` — "my block is everything from here
  // to the end of the table" — which was true while the servers block WAS last. The merge put video, collab,
  // routers, optical, security and modules-misc after it, so the slice silently claimed five other agents' rules
  // and this refusal ("no SERVERS rule may take a HyperFlex -SMS row") failed against a SECURITY rule. A subset
  // defined by position is a subset that the next commit redefines.
  const first = SKU_RULES.findIndex((r) => r.token === "ucs-manager-image");
  const last = SKU_RULES.findIndex((r) => r.token === "hyperconverged-sw-subscription");
  const mine = SKU_RULES.slice(first, last + 1);
  const REF: [string, string, string][] = [
    ["UCS-EN120E208B/K9", "Promo UCS E-Series NCE DW-EHWIC, 2C, 8GB RAM, 200GB HDD", SRV],
    ["UCS-SL-VDI-B200-01", "UCS VDI PROMO 2x6296,2xB200", SRV],
    ["UCS-SL-VDI-B200-02", "UCS VDI PROMO 2x6296,2xB200", SRV],
    ["DUO-TOKEN-10PACK", "A hardware token used with a Cisco Duo subscription (10 pack)", SRV],
    ["UCSX-C-M6-HS-R", "CPU Heat Sink", SRV],
    ["UCSW-SD480G0KA4-C", "480GB 2.5 inch SATA SSD", SRV],
    ["UCS-SPM-MINI", "UCS 5108 AC2 Chassis w/ FI6324", SRV],
    ["N20-C6508", "UCS 5108 Blade Svr AC Chassis/0 PSU/8 fans/0 fabric extender", SRV],
    ["UCSB-B200-M6++", "UCS B200 M6 Blade w/o CPU, mem, HDD, mezz", SRV],
    ["HX-M5S-HXDP-BR", "Cisco HX2X0C M5 Hyperflex System", HXS],
    ["HXAF-M5S-HXDP-BR", "Cisco HXAF2X0C M5 Hyperflex System", HXS],
    ["PLHC-MLOM-40G-04", "Cisco+ UCS VIC 1440 modular LOM for Blade Servers", SRV],
    ["PLHC-IOM-2408", "UCS 2408 I/O Module (8 External 25Gb Ports, 32 Internal 10Gb", SRV],
    ["HX-E-240-M6SX", "Cisco HyperFlex Hybrid Edge 240 Full Capacity M6 system", HXS],
    ["HX-INT-SW02", "C220 and C240 M6 Chassis Intrusion Switch", HXS],
    ["NTX-SW-PS", "Cisco NTX-SW-PS", HCI],
    ["HCINX240C-M8L", "Cisco Compute Hyperconverged C240 M8 2RU standard rack server", HCI],
  ];
  for (const [sku, name, cat] of REF) {
    const hitBy = mine.filter((r) => ruleMatches(r, ruleSku(sku))).map(ruleName);
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`servers REFUSAL: ${sku} is hit by none of the servers rules and stays hardware`, hitBy.length === 0 && got.klass === "hardware",
      `hit by ${hitBy.join(",") || "none"}; classify ${got.klass} / ${got.reason}`);
  }
  // the vetoes, each FOR its stated reason
  check("servers REFUSAL: HXDPE-SLR-SMS-1K is left to the security agent's -SMS rule (hyperflex veto)",
    !mine.some((r) => ruleMatches(r, "HXDPE-SLR-SMS-1K")));
  check("servers REFUSAL: C1-CWOM-750SVR-5Y keeps its ucs-kind-os-license reason (CWOM veto)",
    classify({ sku: "C1-CWOM-750SVR-5Y", categorySlug: SRV, categoryIsHardware: true }).reason === "ucs-kind-os-license");
  // SABOTAGE per rule: take each rule out of the table and its own positive must lose that reason.
  for (const [sku, , cat, , reason] of POS.filter(([, , , , r]) => r.startsWith("sku-"))) {
    const i = SKU_RULES.findIndex((r) => ruleName(r) === reason);
    const [rule] = SKU_RULES.splice(i, 1);
    const got = classify({ sku, categorySlug: cat, categoryIsHardware: true });
    SKU_RULES.splice(i, 0, rule);
    sabotages++;
    check(`SABOTAGE servers: without ${reason}, ${sku} is no longer classed by it`, got.reason !== reason, `still ${got.reason}`);
  }
}
// collab (12 Sep 2026) — the collaboration residue rules. Every SKU and name is from the catalogue.
{
  const fire: [string, string, string, ProductClass, string][] = [
    ["HCS-HCMF-S-TIER5", "HCS Tier 5 HCM-F for Standard Users for 750K to 1.", "unified-communications", "license", "sku-prefix:HCS-"],
    ["UNITYCN8-MAXP-HCS", "Unity Connection 8.x Port License - Max ports for", "unified-communications", "license", "sku-prefix:UNITYCN"],
    ["UPG-UCM9TO10-ETOS", "UC Manager Upgrade ENH to STD, v9.x to 10.x, 1 user", "unified-communications", "license", "sku-prefix:UPG-UC"],
    ["UPG-TP-11TO12-ROOM", "Upg to UCM 12.x TP Room from 11.x", "unified-communications", "license", "sku-prefix:UPG-TP-"],
    ["USOL-B-SE-UIP-3YR=", "Solution UIP - Package B, SE, 3-Year", "unified-communications", "license", "sku-prefix:USOL-"],
    ["CUWL-T-2M", "CUWL - Collab 2 Month, 1 User", "unified-communications", "license", "sku-prefix:CUWL"],
    ["A-SPK-SH-RMM", "MX 200/300, MX700/800 and Room 55/70 Subscription", "collaboration-endpoints", "license", "sku-prefix:A-SPK-"],
    ["A-WRK-BUN-C", "Webex Meetings and Webex Calling Committed", "conferencing", "license", "sku-prefix:A-WRK-"],
    ["A-WORK-MEET-C", "Webex Meetings + VOIP Committed (1)", "conferencing", "license", "sku-prefix:A-WORK"],
    ["A-PRM-S-UCM-10X-K9", "UC Manager 10x - SW Kit for UCM", "unified-communications", "license", "sku-prefix:A-PRM-"],
    ["A-HST-SW-NU-10X-K9", "Cisco Collaboration Subscription (CCS) - Software", "unified-communications", "license", "sku-prefix:A-HST-"],
    ["A-TPAAS-PMPPLUS", "TP as a Service - Personal Multi Party for CMS", "conferencing", "license", "sku-prefix:A-TPAAS"],
    ["CTES-MRC-EP-1-T1", "CTES Monthly Recurring Fees - 1 screen endpoint (0-100)", "collaboration-endpoints", "service", "sku-prefix:CTES-MRC-"],
    ["TLS_AES_128_GCM_SHA256", "Cisco TLS_AES_128_GCM_SHA256", "conferencing", "non_product", "sku-regex:tls-cipher-suite"],
    ["7906-PER-ROOM", "Number of 7906 per room", "unified-communications", "non_product", "sku-suffix:-PER-ROOM"],
  ];
  for (const [sku, name, cat, want, reason] of fire) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`collab residue: ${sku} -> ${want} by ${reason}`, got.klass === want && got.reason === reason, `${got.klass} / ${got.reason}`);
    seenReasons.add(got.reason);
  }
  // REFUSALS — more of them than positives. Each is a real device whose SKU sits next to a rule's token.
  const stay: [string, string, string, string][] = [
    ["UNITYCN7-BUNDLE", "Unity Connection 7.x SW plus HW Bundle", "unified-communications", "UNITYCN without its BUNDLE veto — the bundle ships a server"],
    ["CP-8851-3PW-NA-MK9", "MLB Subscription- Phone 8851", "unified-communications", "a subscription NAME on a real phone — no rule reads the word"],
    ["CS-KIT-SUB-K9", "MLB for Subscription Room Kit", "unified-communications", "the same: a Room Kit shipped under a device subscription"],
    ["CTI-CMS-1000-K9", "Cisco Meeting Server 1000", "conferencing", "A-CMS read as a bare CMS token — the appliance itself"],
    ["CMS-M-M8-K9", "Cisco CMS-M-M8-K9", "conferencing", "A-CMS read as a bare CMS token — a Meeting Server platform"],
    ["BE7H-M6-K9", "Cisco Business Edition 7000H (M6) Appliance, Export Restr SW", "unified-communications", "a UC-software prefix read loosely — the BE7000 appliance"],
    ["EXPWY-1200-K9", "Cisco Expressway Series Multi-purpose 1200 Appliance", "unified-communications", "an Expressway licence rule — the 1200 appliance"],
    ["VG350-144FXS/K9", "Cisco VG350 144 FXS Bundle", "unified-communications", "a 'bundle' read as a software bundle — a 144-port gateway"],
    ["HS-WL-730-BUNAS-P", "730 Wireless Dual On-ear Headset+Stand USB-A Bundle-Platinum", "collaboration-endpoints", "a 'bundle' read as a licence — a headset"],
    ["SP-ATLAS-I128SYS=", "Atlas I128SYS Ceiling Tile IP Speaker", "unified-communications", "SP- read as a subscription prefix — an IP speaker"],
    ["CP-7942G-APACSP", "Cisco UC phone 7942G AsiaPac Bundle", "unified-communications", "a -SP suffix read as a service — a phone"],
    ["UPGRADE-KIT-TEST", "hypothetical hardware upgrade kit", "unified-communications", "the bare UPG- prefix, refused: only UPG-UC and UPG-TP- are licences"],
    ["SPA8000-BR", "8-Port IP Telephony Gateway", "unified-communications", "a Brazil-region gateway beside the -PER-ROOM and TLS_ non-product rules"],
    ["CP-8831-3PCC-K9", "Cisco IP Conference Phone 8831", "collaboration-endpoints", "a per-room conference phone — PER-ROOM is a suffix, not a word"],
    ["TLS-GATEWAY-K9", "hypothetical gateway", "unified-communications", "tls-cipher-suite without its underscore anchor"],
    ["AHCS-100", "hypothetical part", "unified-communications", "HCS- read as a contains token rather than a prefix"],
    ["CUCM-UCS-SRV", "hypothetical server", "unified-communications", "CUWL read as CU* — a different family"],
  ];
  for (const [sku, name, cat, wouldEat] of stay) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`collab refusal: ${sku} stays hardware (would have been eaten by ${wouldEat.slice(0, 50)})`, got.klass === "hardware", `${got.klass} / ${got.reason}`);
  }
  // SABOTAGE: drop the UNITYCN veto and the bundle must be eaten — the veto is live, not decorative.
  const unity = SKU_RULES.find((r) => r.token === "UNITYCN")!;
  check("SABOTAGE UNITYCN without its BUNDLE veto eats UNITYCN7-BUNDLE", ruleMatches({ ...unity, except: [] }, "UNITYCN7-BUNDLE"));
  const tls = SKU_RULES.find((r) => r.token === "tls-cipher-suite")!;
  check("SABOTAGE tls-cipher-suite widened to a hyphen eats TLS-GATEWAY-K9", ruleMatches({ ...tls, re: /^TLS[_-]/ }, "TLS-GATEWAY-K9"));
}
// end collab
// --- optical-storage (12 Sep 2026): the residue in optical-networking and storage-networking ----------------------
// Names verbatim from the catalogue (read back 12 Sep 2026). Each positive names the rule that must fire; each
// refusal is a real part the obvious wider form of a rule would take.
{
  const added: [string, string, string, string, string][] = [
    ["M92S2K9-5.2.1", "MDS 9200 Supervisor/Fabric-2, NX-OS Software Release 5.2(1)", "storage-networking", "software", "sku-regex:mds-image"],
    ["M9124VS8K9-N9.3.2", "MDS 9124V 64G FC - NXOS NPE System Image version 9.3(2)", "storage-networking", "software", "sku-regex:mds-image"],
    ["M9148S6K9NPE8.5.1", "MDS 9148S 16G FC NX-OS NPE Software Rel. 8.5.1", "storage-networking", "software", "sku-regex:mds-image"],
    ["SSI-M9K9-528", "MDS SSI Image 5.2(8)", "storage-networking", "software", "sku-prefix:SSI-M9K9-"],
    ["M91XK9-SD-5Y", "MDS SA + DCNM Subscription M9100 5Y", "storage-networking", "license", "sku-regex:mds-subscription"],
    ["M9148S-PL12", "Cisco MDS 9148S 12-port On-Demand Activation license", "storage-networking", "license", "sku-regex:mds-licence"],
    ["M9100ENT1K9", "Cisco MDS Enterprise Package for one MDS 9100 Series Switch", "storage-networking", "license", "sku-regex:mds-licence"],
    ["M92DMM184K9", "MDS 9200 Data Mobility Manager (DMM) License for one 18/4", "storage-networking", "license", "sku-regex:mds-licence"],
    ["C1-ENT-M9700K9", "Cisco ONE Enterprise Package License for 1 MDS9700 Switch", "storage-networking", "license", "sku-prefix:C1-ENT-M9"],
    ["UCS-EP-MDS9148S-L1", "MDS 9148S 16G FC 12-port upgrade license + 8G SW SFPs", "storage-networking", "license", "sku-prefix:UCS-EP-MDS"],
    ["L1-D-M91S-AXK9", "SAN Analytics solution license for MDS9100 1 year", "storage-networking", "license", "sku-regex:mds-analytics-term"],
    ["MDS-9222I-FREE-SW", "9222i SMB Free Software Package Promotion", "storage-networking", "software", "sku-exact:MDS-9222I-FREE-SW"],
    ["SF15454M-R1001K9", "MSTP - R10.0.1 Preloaded SW, TCC3, TNC/E, TSC/E - NO WSON", "optical-networking", "software", "sku-prefix:SF15454"],
    ["NCS2K-M-R1001K9", "NCS 2K/MSTP - R10.0.1 SW, Media (DVD) SW RTU - WSON CP", "optical-networking", "license", "sku-prefix:NCS2K-M-R"],
    ["NCS2K-R-B1200K9=", "NCS 2K Rel 12.0 NE SW, SVO Base License, One Chassis, USB", "optical-networking", "license", "sku-prefix:NCS2K-R-"],
    ["15454-R9.8.1SWK9", "15454 ANSI ETSI MSTP Rel. 9.8.1 Pkgs., DVD, RTU License", "optical-networking", "license", "sku-regex:mstp-release"],
    ["15454M-R1070SWK9", "MSTP - ANSI & ETSI, R10.7 - RTU LIC DVD, NO WSON", "optical-networking", "license", "sku-regex:mstp-release"],
    ["XR-NCS4K-612K9", "NCS 4000 IOS XR Software Release 6.1.2 USB key- RTU License", "optical-networking", "license", "sku-prefix:XR-NCS4K"],
    ["XR-1K2-L-712K9", "NCS 1002 IOS XR Software Release 712 RTU", "optical-networking", "license", "sku-prefix:XR-1K"],
    ["SNCS42R2NK9178", "● Provides a consolidated software package for NCS4200 RSP2 ● Includes SSH and SNMPv3 support but not data plane encryption support", "optical-networking", "software", "sku-prefix:SNCS42"],
    ["S-NCS1K4-ULIC-100=", "NCS 1004 Universal 100G Client Smart License", "optical-networking", "license", "sku-regex:ncs-smart-licence"],
    ["S-OAS-ONP-5.0-SW", "OAS Optical Network Planner Software Version 5.0", "optical-networking", "software", "sku-prefix:S-OAS-"],
    ["CONC-RTM-ESS-SM", "Essential CONC subscription for small device with support", "optical-networking", "license", "sku-prefix:CONC-RTM-"],
    ["FASTPADMPR-B2780=", "License for Bisync 2780 support.", "optical-networking", "license", "sku-prefix:FASTPAD"],
    ["ESP-SW-2.0=", "ESP Version 2.0 Software For ATM and FR SVCs, PNNI", "optical-networking", "software", "sku-regex:legacy-protocol-sw"],
    ["OAS-COSM-MLCL", "Cisco Optical Site Manager - Managed Line Card License", "optical-networking", "license", "sku-prefix:OAS-COSM-"],
    ["UAS-PM", "Cisco UAS-PM", "optical-networking", "non_product", "sku-regex:pm-counter-name"],
    ["MS-SESR", "Cisco MS-SESR", "optical-networking", "non_product", "sku-regex:pm-counter-name"],
    ["CV-S", "Cisco CV-S", "optical-networking", "non_product", "sku-regex:pm-counter-name"],
    ["CP-16-QAM", "Cisco CP-16-QAM", "optical-networking", "non_product", "sku-regex:modulation-name"],
    ["DP-QPSK", "Cisco DP-QPSK", "optical-networking", "non_product", "sku-regex:modulation-name"],
    ["OTU3e", "Cisco OTU3e", "optical-networking", "non_product", "sku-regex:otu-rate-name"],
    ["OTU-4", "Cisco OTU-4", "optical-networking", "non_product", "sku-regex:otu-rate-name"],
    ["LINE-TX", "Cisco LINE-TX", "optical-networking", "non_product", "sku-regex:monitor-point-name"],
    ["LC-LC", "Cisco LC-LC", "optical-networking", "non_product", "sku-regex:monitor-point-name"],
  ];
  for (const [sku, name, cat, klass, reason] of added) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`${reason} fires on ${sku}`, got.klass === klass && got.reason === reason, `${got.klass} / ${got.reason}`);
    seenReasons.add(got.reason);
  }
  const mustStayHardware: [string, string, string, string][] = [
    ["M9XT-FC1632", "MDS 32G FC Port Expansion module, w/ 16 active ports for Base", "storage-networking", "mds-licence without its M9XT- refusal — the one real module in the M9 family"],
    ["NCS2K-MR-MXP-LIC=", "10/40/100G MR Muxponder - Licensable for Encryption", "optical-networking", "an NCS2K-M-R prefix without the hyphen after R — a muxponder"],
    ["NCS2K-MF-UPG-4=", "Mesh Interconnection MF Unit - Upgrade - 4 Degrees", "optical-networking", "an NCS2K-M prefix — a passive mesh unit"],
    ["NCS2K-MF-COVER=", "1RU cover for mechanical frame", "optical-networking", "an NCS2K-M prefix — a cover"],
    ["15216-LC-LC-20", "Fiber patchcord - LC to LC - 8m", "optical-networking", "monitor-point-name unanchored — a real patch cord carries LC-LC"],
    ["CV-BBLKD-S2", "Cisco CV-BBLKD-S2", "security", "pm-counter-name with an unanchored -S suffix"],
  ];
  for (const [sku, name, cat, wouldEat] of mustStayHardware) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`stays hardware: ${sku} (would have been eaten by ${wouldEat.slice(0, 46)})`, got.klass === "hardware", `got ${got.klass} / ${got.reason}`);
  }
}
// --- end optical-storage ---------------------------------------------------------------------------------------------

// 12 Sep 2026, after the merge: three rows that used to be pinned as "stays hardware" are read correctly by a
// later agent's rule — two software images and a Cyber Vision licence. What the cases were for survives: the
// WIDENED form of another rule must not be what decides them. So the assertion is the deciding rule, by name.
{
  const decidedBy: [string, string, string, ProductClass, string][] = [
    ["XC-LCBASE-03.00", "^Cisco IOS-XR Line Card Base Software version v3.0 for CRS-1", "routers", "software", "sku-regex:xr-crs-image"],
    ["M92S7K9-9.3.2A", "MDS 9220i 32G FCIP Switch NX-OS version 9.3(2A)", "storage-networking", "software", "sku-regex:mds-image"],
    ["CV-A-100", "Cyber Vision Advantage License for 100 endpoints", "security", "license", "sku-regex:cyber-vision-tier"],
  ];
  for (const [sku, name, cat, klass, reason] of decidedBy) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`${sku} is decided by ${reason}, not by a widened neighbour`, got.klass === klass && got.reason === reason,
      `${got.klass} / ${got.reason}`);
  }
}

// collab-class (12 Sep 2026) — the FALLBACK RESIDUE of the three collaboration categories: the
// 1,430 non-hardware rows collabKind was calling `unknown`, and the one hardware family among them.
// Every SKU and every name is verbatim from the catalogue. There are more refusals than positives,
// and each refusal names the wider form of a rule above that would have deleted a real product.
{
  const fire: [string, string, string, ProductClass, string][] = [
    // Webex / cloud collaboration subscription
    ["A-EPF-APP-T1", "Webex Events App (formerly Socio) 0-250", "conferencing", "license", "sku-regex:webex-collab-subscription"],
    ["A-CJP-CNPN", "Webex Contact Center Premium Named Agent", "unified-communications", "license", "sku-regex:webex-collab-subscription"],
    ["A-SS-NBR", "NBR Storage 1 GB", "conferencing", "license", "sku-regex:webex-collab-subscription"],
    ["A-SW-EXPWY-14X-K9", "Expressway Version 14.2.5 Restricted Software", "unified-communications", "license", "sku-regex:webex-collab-subscription"],
    ["EA-TPCNF-USR-T2", "EA TP Multi-Party User - Tier B", "unified-communications", "license", "sku-prefix:EA-"],
    ["EA-CMS-KW-COUNT", "Total Knowledge Worker Count for CMS Add On Suite", "conferencing", "license", "sku-prefix:EA-"],
    ["GM-ELA-6Y-EPT", "GM ELA, 6 year term - Collab End Point SW (upgr incl)", "collaboration-endpoints", "license", "sku-exact:GM-ELA-6Y-EPT"],
    ["COL-WBX-ADVG", "Advantage 3 year term - WebEx - 1K Units", "conferencing", "license", "sku-prefix:COL-WBX-"],
    ["WBX-MC1-BE-10USR", "Webex MC 10 hosts, 1 yr subscription", "conferencing", "license", "sku-prefix:WBX-"],
    ["WEBEX-EXTERNAL", "WebEx External Ports for CUWL Add-on", "unified-communications", "license", "sku-prefix:WEBEX-"],
    // UC application entitlements
    ["MIG-9X-BASTOENH", "Mig from UCM 9.x Bas to Enh User Lic", "unified-communications", "license", "sku-prefix:MIG-"],
    ["UPG-CUCM-ENHP-C", "Upgrade to UCM 9/10/11 Enh Plus from v8.x or earlier - 10K", "unified-communications", "license", "sku-prefix:UPG-"],
    ["UPG-6K-PRO", "BE6000 CUWL Professional - SW Upgrade", "unified-communications", "license", "sku-prefix:UPG-"],
    ["UP-UCM9TO10-ENHP-A", "Upg to UCM 10.x Enh Plus from 9.x", "unified-communications", "license", "sku-prefix:UP-UCM"],
    ["M-UCN-UWLS-8TO10=", "UNTYCXN UWLS Migrate -8x to 10x - Order correct license qty", "unified-communications", "license", "sku-regex:uwl-version-migration"],
    ["UWL-11X-PRO", "CUWL Professional 11.x Users - Service Use Only", "unified-communications", "license", "sku-prefix:UWL"],
    ["RTMU-T-1Y-SUP", "Right To Major Upg for CUWL Upg Support - Collab 1 Yr,1 User", "unified-communications", "license", "sku-prefix:RTMU-"],
    ["CUAC11X-ADV-HA", "Unified Attendant Console Advanced 11.x Server HA", "unified-communications", "license", "sku-prefix:CUAC"],
    ["CUE-ATT-CON=", "Unified Enterprise Attendant Console", "unified-communications", "license", "sku-regex:attendant-console-legacy"],
    ["UCXN-11X-SC-PORTS", "Unity Connection 11.x SpeechConnect Ports", "unified-communications", "license", "sku-prefix:UCXN"],
    ["UNCN7-100USR-K9=", "Unity Connection, 16 ports, 100 users - All user Features", "unified-communications", "license", "sku-prefix:UNCN"],
    ["UNITY-50-USR-ADDON", "Additional Unity 5.x Users for CUWL", "unified-communications", "license", "sku-prefix:UNITY"],
    ["SPEECHVIEWPRO-1YR", "SpeechView Pro for Unity Connection 8.x 1 Year license", "unified-communications", "license", "sku-prefix:SPEECHVIEW"],
    ["SPCHVIEW-PAK", "SpeechView for Unity Connection 9.x PAK", "unified-communications", "license", "sku-prefix:SPCHVIEW"],
    ["CUP-SERVER8.5-K9", "Unified Presence Server License", "unified-communications", "license", "sku-prefix:CUP"],
    ["PXY-8.6-SPM-SW", "CUP SIP Proxy Mode", "unified-communications", "license", "sku-prefix:PXY-"],
    ["PAS-UIP-LRG-3YR", "EPAS Software UIP per seat, 1500 + for 3 Years", "unified-communications", "license", "sku-prefix:PAS-"],
    ["BE6K-UCL-ENHP", "Business Edition 6000 - Enhanced Plus User Connect Lic", "unified-communications", "license", "sku-regex:be6000-entitlement"],
    ["BE6K-START-UWL35", "BE6000 Starter Bundle with 35 UWL Standard Licenses", "unified-communications", "license", "sku-regex:be6000-entitlement"],
    ["BE6K-SW-12.5", "Business Edition 6000 v12.5 export restricted software", "unified-communications", "software", "sku-regex:business-edition-image"],
    ["BE7K-SW-9X10X-XU", "Media (no lic) for Cisco Collaboration 9.x 10.x Export Unrst", "unified-communications", "software", "sku-regex:business-edition-image"],
    ["BE3K-ENH-USER", "Unified CMBE 3K Enhanced User Connect License (no VM)", "unified-communications", "license", "sku-prefix:BE3K"],
    ["BE-12X-UWLS-STR", "BE6000 v12 UWL Standard Starter licenses (35-pack)", "unified-communications", "license", "sku-regex:be6000-starter"],
    ["CPW-UC61-150USR-K9", "Partner Workspace UC 6.1 for 150 users", "unified-communications", "license", "sku-prefix:CPW-UC"],
    ["SRST14-EP", "Survivable Remote Site Telephony (SRST) V14 - 1 Device Lic", "unified-communications", "license", "sku-prefix:SRST"],
    // A LICENCE NAMED "PHONE". One of the six the reverse name control found; a name rule reading
    // "Phone" as hardware evidence would have kept it, and a kind rule would have asked it a display.
    ["CME-EA-LIC12X", "CME Phone / Seat License for EA", "unified-communications", "license", "sku-regex:cme-user-license"],
    ["CUSP10-5CPS", "Unified SIP Proxy 10.x: 5 calls/sec (Smart License)", "unified-communications", "license", "sku-prefix:CUSP10-"],
    ["TP-SMP-SL2SMP", "TP Screen License or MCU trade-in for 1 Shared Multiparty", "conferencing", "license", "sku-prefix:TP-SMP"],
    ["KEY-CER1.X-10K=", "Cisco KEY-CER1.X-10K=", "unified-communications", "license", "sku-prefix:KEY-CER"],
    ["UIP-CER-SVR-3YR=", "User Investment Protection CER Server 3 Years", "unified-communications", "license", "sku-prefix:UIP-CER-"],
    ["VMW-UC-FND5-SNS", "UC Virt. Foundation 5.x SnS", "unified-communications", "license", "sku-prefix:VMW-UC-"],
    ["VMW-VS6-HYP-K9", "Embedded License, Cisco UC Virt. Hypervisor 6.x (2-socket)", "unified-communications", "license", "sku-regex:uc-virt-embedded-license"],
    ["VXME-WINDOWS-HCS", "VXME for Windows for HCS", "unified-communications", "license", "sku-prefix:VXME-"],
    ["VPGW-99-LAR-K9=", "Virtualized PGW for HCS - Large Config", "unified-communications", "license", "sku-prefix:VPGW"],
    ["CUMC-CLIENT-SYM-UW", "Unified Mobile Communicator Symbian Client for CUWL", "unified-communications", "license", "sku-prefix:CUMC-"],
    ["CUCILYNC-CPW", "UC Integration for Lync Single Lic", "unified-communications", "license", "sku-prefix:CUCILYNC"],
    ["VOIP-IPH-CPW", "Mobile for iPhone", "unified-communications", "license", "sku-regex:jabber-mobile-client"],
    ["SP-INFORMACST-1K=", "InformaCast - 1000 End Point Licenses", "unified-communications", "license", "sku-regex:informacast-license"],
    ["SP-INFMCST-3-25K=", "Cisco SP-INFMCST-3-25K=", "unified-communications", "license", "sku-regex:informacast-license"],
    ["CUC-SL-EXRTKY-K9=", "Export Restricted Authorization Key for CUC -Smart Licensing", "unified-communications", "license", "sku-regex:cuc-smart-license-key"],
    ["UCM-S-UCS-UPG-NODE", "CUCM CUCM-UCS-1000 Upgrade Node", "unified-communications", "license", "sku-regex:ucm-node-license"],
    ["UCN-12X-VM-UCL", "BE6000 Unity Connection 12x Basic Voicemail Lic addon to UCL", "unified-communications", "license", "sku-regex:be6000-voicemail-ucl"],
    ["SPCTRXMW260000015=", "Citrix Solutions Plus Voice Office 100 User License Spare", "unified-communications", "license", "sku-prefix:SPCTRXMW"],
    ["V-CLOUD-SP", "Vyopta vAnalytics Cloud Starter Pack Subscription", "conferencing", "license", "sku-prefix:V-CLOUD"],
    ["ESNA-TMSBOOKING-SP", "Cisco ESNA-TMSBOOKING-SP", "conferencing", "license", "sku-prefix:ESNA-"],
    ["SP-ARC-XPS-ATT-CON", "SolutionsPlus ARC Express PC Attendant Console", "unified-communications", "license", "sku-prefix:SP-ARC-XPS"],
    ["MPE-20-UWLA-PAK", "MeetingPlace Express 2.0 UWL Add-On PAK", "unified-communications", "license", "sku-regex:meetingplace-addon"],
    ["PUBLIC-IP-DEV-BE", "Public Space non-app phone add-on for UWL BE", "unified-communications", "license", "sku-regex:uc-per-device-addon"],
    ["UCM-HOSP-ROOMS", "UCM Hospitality - Number of Hotel rooms", "unified-communications", "license", "sku-prefix:UCM-HOSP"],
    ["ADD-JAB-TO-ENH", "Add Jabber Device to Enhanced License in UC Manager 8.x", "unified-communications", "license", "sku-regex:uc-alacarte-migration"],
    ["DBUPGRADE-SME", "Royalty option for IBM database upgrade", "unified-communications", "license", "sku-regex:uc-db-upgrade-royalty"],
    ["VCS-MIG-EXP", "Migrate from VCS to Expressway", "unified-communications", "license", "sku-regex:vcs-migration"],
    ["R-UCL-UCM-UPG-K9", "Top Level Sku For 11.X and Later User License - Migration", "unified-communications", "license", "sku-contains:UCL-UCM-UPG"],
    ["LIC4.X-5.X-U-2500=", "License Upgrade of 2500 Addl Users, CM 4.x to CM 5.x", "unified-communications", "license", "sku-prefix:LIC4"],
    ["UNIFIED-CM7.1", "CUCM 7.1 top level part number", "unified-communications", "license", "sku-prefix:UNIFIED-CM"],
    ["MOBILE-USR", "Cisco MOBILE-USR", "unified-communications", "license", "sku-exact:MOBILE-USR"],
    ["UCM-PAK", "Cisco UCM-PAK", "unified-communications", "license", "sku-exact:UCM-PAK"],
    ["UPC-K9-OPT", "Unified Personal Communicator Options", "unified-communications", "license", "sku-exact:UPC-K9-OPT"],
    ["CTI-VCSC-BE6K-PAK", "Config Only E-Delivery VCS Control PAK PID", "unified-communications", "license", "sku-exact:CTI-VCSC-BE6K-PAK"],
    // MERGE, 12 Sep 2026: these four reach an EARLIER rule from the routers block — same class,
    // different reason — because the collab block is appended last. Pinned at the reason the merged
    // table really gives, not the one the collab block would give alone: a test that asserts the
    // reason of a shadowed rule is a test that will be "fixed" by deleting a live rule.
    ["FLASR1-CUBEE-16KP", "Unified Border Element - Enterprise Edition 16000 Sessions", "unified-communications", "license", "sku-prefix:FLASR1-"],
    ["FLSASR1-CUE-500=", "Uni Border Element-Ent Edition 500 Sessions-Paper PAK-ASR1k", "unified-communications", "license", "sku-prefix:FLSASR"],
    ["C1-ASR1-CUBEE-4KP", "ONE Unified Border Element Ent, 4000 Sessions, Redun", "unified-communications", "license", "sku-regex:cube-session-license"],
    ["C1-FL-CUBEE-25", "ONE Unified Border Element Enterprise Lic 25 sessions", "unified-communications", "license", "sku-prefix:C1-FL-"],
    // The bare CUBE forms, which only became visible once collabKind stopped calling them power supplies.
    ["CUBE14-T-STD", "CUBE V14 - 1 Standard Trunk Session License", "unified-communications", "license", "sku-regex:cube-session-license"],
    ["CUBE-T-RED-UP", "CUBE - 1 Standard to Redundant Trunk Session License Upgrade", "unified-communications", "license", "sku-regex:cube-session-license"],
    ["FL-CUBE-100=", "Unified Border Element Feature License - 100 Sessions", "unified-communications", "license", "sku-regex:feature-licence"],
    ["C1-CUBE-UP-RED", "Upgrade to C1 CUBE for CUBE REDUNDANT legacy license", "unified-communications", "license", "sku-regex:cube-session-license"],
    // These two are the witnesses of the REMOVED `voice-feature-license` rule, kept deliberately.
    // Measured over 91,543 live parts, that rule decided zero rows in the merged table because
    // `feature-licence` takes them all; these rows prove the class did not move with it.
    ["FL-CUSP-100U200=", "CUSP Upgrade License for 100 to 200 SIP requests/second", "unified-communications", "license", "sku-regex:feature-licence"],
    ["FL-GK-2951=", "Gatekeeper Feature Paper PAK -2951 platform", "unified-communications", "license", "sku-regex:feature-licence"],
    ["CMS-PMP-K9", "Meeting Server Personal Multiparty (a la carte offer)", "conferencing", "license", "sku-regex:cms-meeting-license"],
    ["CUCM-CPL", "Unified Communication Manager Device License", "unified-communications", "license", "sku-regex:cucm-entitlement"],
    ["CUCM861-EA-K9-PAK", "UC Manager 8.6.1 EA PAK", "unified-communications", "license", "sku-regex:cucm-entitlement"],
    // Software: images, media kits, version SKUs, virtual editions
    ["CM9.X-K9-NFR", "SW CM 9.X Not For Resale, 20 CUWL PRO, 5 TP Room", "unified-communications", "software", "sku-regex:cucm-version-image"],
    ["CM85-UCS-1000-UKIT", "CUCM 8.5 Upgrade Media Kit for UCS", "unified-communications", "software", "sku-regex:cucm-version-image"],
    ["R-CM8.6-K9-NFRTRNG", "SW CM 8.6 Not For Resale Trng Partners Only", "unified-communications", "software", "sku-regex:cucm-version-image"],
    ["CM-UIP-7845-3YR=", "CM Software UIP for 7845 for 3 year", "unified-communications", "software", "sku-prefix:CM-UIP-"],
    ["CM-7835K9-802-UKIT", "CUCM 8.0.2 Media Upgrade Kit", "unified-communications", "software", "sku-prefix:CM-"],
    ["CMBE8.0-U-K9=", "SW Upgrade BE 7.X to 8.0", "unified-communications", "software", "sku-prefix:CMBE"],
    ["CUCM-VERS-12.5-XU", "CUCM Software version 12.5 (Export Unrestricted)", "unified-communications", "software", "sku-regex:cucm-version-software"],
    ["CUCM-UCS-7500-86", "Unified Communications Manager 8.6 Server Software", "unified-communications", "software", "sku-regex:cucm-version-software"],
    ["SME-VERS-12.5", "SME Software Version 12.5", "unified-communications", "software", "sku-regex:sme-software"],
    ["USME8.6-K9-NFR", "SW CM-SME 8.6 Appliance Not For Resale", "unified-communications", "software", "sku-regex:sme-software"],
    ["R-SME8.6-K9-NFR", "SW CM-SME 8.6 Appliance Not For Resale", "unified-communications", "software", "sku-regex:sme-software"],
    ["ER87-SW-U71-K9", "EMRGNCY RSPNDR 87 SW UPGD 71 ONLY", "unified-communications", "software", "sku-regex:emergency-responder-software"],
    ["ER12.5-SW-UZZ-K9=", "Emergency Responder 12.5 Server Software Upgrade 10.X 11.X for PUT only", "unified-communications", "software", "sku-regex:emergency-responder-software"],
    ["ER90-USR-10-ADD", "EMRGNCY RSPNDR 90 USR LIC 10 PHNS ADDL", "unified-communications", "license", "sku-regex:emergency-responder-entitlement"],
    ["ER-911-EA-PAK", "ER 911 for EA PAK", "unified-communications", "license", "sku-regex:emergency-responder-entitlement"],
    ["R-EMRGNCY-RSPNDR", "Cisco Emergency Responder Top Level (for Electronic Delivery)", "unified-communications", "license", "sku-contains:EMRGNCY-RSPNDR"],
    ["IME8.5-K9-NFR-TRNG", "SW IME 8.5 Appliance Not For Resale", "unified-communications", "software", "sku-prefix:IME8"],
    ["CSR14X-K9-DLT=", "UC 14 Partner Demo/Lab/Training Kit - Product Upgrade Tool", "unified-communications", "software", "sku-regex:uc-partner-dlt-kit"],
    ["UPS1.0-K9-NFR=", "SW Cisco Unified Presence Server 1.0 DEMO Not For Resale", "unified-communications", "software", "sku-prefix:UPS1.0-K9"],
    // MERGE, 12 Sep 2026: UCAPPSW-12.5-XU-K9 carries a RELEASE NUMBER, so `release-in-sku` decides
    // it first — same class, different reason, and it left UCAPPS with no witness. Both are pinned:
    // the one UCAPPS really wins (measured, 5 live parts) and the one it does not.
    ["UCAPPSW-10.X-XU-K9", "Version 10.x - Export Unrestricted", "unified-communications", "software", "sku-prefix:UCAPPS"],
    ["UCAPPSW-12.5-XU-K9", "Version 12.x - Export Unrestricted", "unified-communications", "software", "sku-regex:release-in-sku"],
    ["EUR-CVP126VVB-SEC", "VVB 12.6 Server Software [Security Enabled]", "unified-communications", "software", "sku-prefix:EUR-"],
    ["CTI-VMVCS-CTRL-K9", "Virtual VCS Control - includes FindMe application", "unified-communications", "software", "sku-regex:vcs-virtual-edition"],
    ["EXPWY-VE-E-K9=", "Expressway-E Server, Virtual Edition", "unified-communications", "software", "sku-regex:vcs-virtual-edition"],
    ["R-ATP-VM-VCSE-K9", "E-Delivery ATP Demo - Virtual VCS Expressway", "unified-communications", "software", "sku-regex:vcs-virtual-edition"],
    ["CMS1K-SW-HMN", "Meeting server 1000 HMN sw preload", "conferencing", "software", "sku-prefix:CMS1K-SW-"],
    ["VM-IM86ONLYDB-K9", "DB software for VMWare IM Only, used only if no CUCM present", "unified-communications", "software", "sku-regex:im-only-database"],
    ["M7816-IM85ONYDB-K9", "IM ONLY DB for CUP 8.5", "unified-communications", "software", "sku-regex:im-only-database"],
    ["PLM10X-K9=", "Prime License Manager 10.X", "unified-communications", "software", "sku-regex:prime-collab-software"],
    ["CCX-125-NPS-K9=", "CCX 12.5 Non Production System", "unified-communications", "software", "sku-regex:contact-centre-app-media"],
    ["CVP-125-SRV-LAB", "CVP 12.5 Server Software (Smart)", "unified-communications", "software", "sku-regex:contact-centre-app-media"],
    ["UC-APPS-SW-DOD-K9", "DOD Certified Version of CUWL", "unified-communications", "software", "sku-regex:uc-app-software-kit"],
    ["R-UNITYCN10-XU-K9", "Unity Connection 10.x Software - Export Unrestricted", "unified-communications", "software", "sku-regex:uc-app-edelivery"],
    ["R-PC12.6-PRSW-K9=", "Prime Collaboration 12.6 Provisioning Software and BASE", "unified-communications", "software", "sku-regex:uc-app-edelivery"],
    ["R-VMVCS-CTRL-K9", "TelePresence Video Communication Server Control (virtualized application)", "unified-communications", "software", "sku-regex:uc-app-edelivery"],
    ["UCMBE-7828-85-KIT", "Unified Communication Manager BE MCS 7828 SW kit", "unified-communications", "software", "sku-prefix:UCMBE-"],
    ["UCS-7500-86-UPG=", "CUCM 8.6 Server Software for UC on UCS 7500 or higher", "unified-communications", "software", "sku-regex:cucm-on-ucs-upgrade"],
    ["UCM8.6-K9-NFR", "SW CM 8.6 Appliance Not For Resale", "unified-communications", "software", "sku-regex:cucm-appliance-image"],
    ["CM5.1.1C-IBMONLY", "UC Manager 5.1.1C Release for IBM Only", "unified-communications", "software", "sku-exact:CM5.1.1C-IBMONLY"],
    ["MCS-OS-2000.2.4=", "MCS Server Legacy OS (2000.2.4) Image Kit", "unified-communications", "software", "sku-exact:MCS-OS-2000.2.4"],
    ["ISR-CCP-EXP-NONE", "Config Pro Express on Router Flash w/o default config", "unified-communications", "software", "sku-exact:ISR-CCP-EXP-NONE"],
    // Service
    ["CTX-YRC-SERVICE", "Yearly Recurring Charge for Cisco TelePresence Exchange", "collaboration-endpoints", "service", "sku-regex:telepresence-exchange-service"],
    ["CTT-T4-FULL", "T4 Complete Program - Educator Training Module", "collaboration-endpoints", "service", "sku-prefix:CTT-T4-"],
    ["SP-CP-860S-EXCARE=", "Extended hardware replacement coverage for Cisco 860S, only available in North America", "collaboration-endpoints", "service", "sku-regex:smallbiz-extended-care"],
    // non_product
    ["DD-CODEC-PRO-K9", "Codec Pro dummy", "collaboration-endpoints", "non_product", "sku-prefix:DD-"],
    ["ECRR-FCC-NA", "FCC Emergency Call Routing Regulations Not Apply", "unified-communications", "non_product", "sku-exact:ECRR-FCC-NA"],
    ["HOSP-TERMS", "Mandatory Hospitality Terms and Conditions", "unified-communications", "non_product", "sku-exact:HOSP-TERMS"],
    ["TELPRES-DP-DLRPID", "Price Adjustment PIDS", "collaboration-endpoints", "non_product", "sku-exact:TELPRES-DP-DLRPID"],
    ["UC-UCME", "UC320, UC500 or UCME", "unified-communications", "non_product", "sku-exact:UC-UCME"],
    ["USB-C", "Cisco USB-C", "collaboration-endpoints", "non_product", "sku-exact:USB-C"],
    ["321ABC432DEF", "Cisco 321ABC432DEF", "collaboration-endpoints", "non_product", "sku-exact:321ABC432DEF"],
    ["FCH20100312/WZP20100113", "Cisco FCH20100312/WZP20100113", "collaboration-endpoints", "non_product", "sku-exact:FCH20100312/WZP20100113"],
    ["NM-HD-1V/2V/2VE", "Cisco NM-HD-1V/2V/2VE", "unified-communications", "non_product", "sku-exact:NM-HD-1V/2V/2VE"],
    ["19560-19660", "Cisco 19560-19660", "unified-communications", "non_product", "sku-exact:19560-19660"],
    ["5060-5080", "Cisco 5060-5080", "unified-communications", "non_product", "sku-exact:5060-5080"],
    ["15.0.1M", "Cisco 15.0.1M", "unified-communications", "non_product", "sku-exact:15.0.1M"],
    ["15.0.1M3", "Cisco 15.0.1M3", "unified-communications", "non_product", "sku-exact:15.0.1M3"],
    ["15.1.2T", "Cisco 15.1.2T", "unified-communications", "non_product", "sku-exact:15.1.2T"],
    ["15.1.3T", "Cisco 15.1.3T", "unified-communications", "non_product", "sku-exact:15.1.3T"],
    ["15.1.T2", "Cisco 15.1.T2", "unified-communications", "non_product", "sku-exact:15.1.T2"],
    ["15.1.T3", "Cisco 15.1.T3", "unified-communications", "non_product", "sku-exact:15.1.T3"],
    ["6.25A", "Cisco 6.25A", "collaboration-endpoints", "non_product", "sku-exact:6.25A"],
    ["7.0A", "Cisco 7.0A", "collaboration-endpoints", "non_product", "sku-exact:7.0A"],
    ["UC-7.X-OR-EARLIER", "UC 7.X or earlier Version Migration", "unified-communications", "non_product", "sku-regex:uc-version-migration-question"],
    // The ordering-question NAME rule: no SKU shape in common, which is why it is a name rule.
    ["ER-10.X", "Select when upgrading from Cisco Emergency Responder 10.X", "unified-communications", "non_product", "name-ordering-question"],
    ["EXIST-DEPL-OVER10K", "Total Deployment is Over 10,000 users", "unified-communications", "non_product", "name-ordering-question"],
    ["TP-ROOM-12", "Choose if Expway or for CUCM version 11.x TP-Room License", "conferencing", "non_product", "name-ordering-question"],
    ["OTHER-APP", "Migrating from Other Application to CUWL", "unified-communications", "non_product", "name-ordering-question"],
    ["FIRST-PRO", "Select when first ordering or upgrading CUWL Pro licenses", "unified-communications", "non_product", "name-ordering-question"],
  ];
  for (const [sku, name, cat, want, reason] of fire) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`collab-class: ${sku} -> ${want} by ${reason}`, got.klass === want && got.reason === reason, `${got.klass} / ${got.reason}`);
    seenReasons.add(got.reason);
  }

  // REFUSALS. Each is a real part that a wider form of one of the rules above would have deleted,
  // and every one carries either an own physical fact or a name that plainly describes a thing.
  const stay: [string, string, string, string][] = [
    // The bare `A-` prefix, refused in round 2 and still refused: all 45 own-physical-fact parts
    // under it are Arista cables, and every Arista member is `A-<one letter><three digits>-`.
    ["A-D800-D800-7M", "Arista A-D800-D800-7M AOC QSFP-DD auf QSFP-DD - aktives optisches Kabel (AOC), Länge 7 m",
      "transceiver", "webex-collab-subscription widened to one letter after A- — an Arista AOC cable with an own physical fact"],
    ["A-O400-2Q200-10M", "Arista A-O400-2Q200-10M 400G AOC OSFP auf 2x QSFP56 - aktives optisches Kabel (AOC), Länge 10 m",
      "transceiver", "the same, with three own physical facts"],
    // The R- e-delivery prefix. These are wireless / switches SOFTWARE wrongly classed hardware —
    // another lane's rows AND another lane's class (software, not licence), so the rule is anchored
    // on a UC application token instead and they are reported rather than written.
    // (R-POLICY-241-SWK9 and R-NAM-VX20-62K9S= stood here asserting "stays hardware". MOVED into the
    //  wl-uc-class block on 12 Sep 2026 — this note said they were "another lane's rows AND another
    //  lane's class (software, not licence) ... reported rather than written", and that lane has now
    //  written them as software. What this list was proving, that uc-app-edelivery must not decide
    //  them, is asserted there against the rule by name, and the bare-R- sabotage below is unchanged.)
    ["R-ME3400E-B2I=", "Metro Base to Metro IPAccess Image Upgrade for ME3400E Switch", "switches", "a bare R- prefix — a switches IOS image"],
    // Cisco ONE: the round-2 refusal, re-confirmed for the CUBE rule.
    ["C1-ASR1001-HX/K9", "ONE - ASR1001-HX, 4x10GE+4x1GE, 2x P/S", "routers", "cube-session-license without its -CUBEE anchor — a real ASR 1001-HX chassis"],
    ["C1-FLOW-IE4K", "ONE Netflow IE4000", "switches", "cube-session-license with C1-FL and no hyphen — this one carries 14 facts"],
    // The CallManager version shape needs its -K9 / -UCS- marker.
    ["CM8-UM08-04-E7G-ULL", "Cisco CM8-UM08-04-E7G-ULL", "interfaces-modules", "cucm-version-image without the -K9 / -UCS- requirement"],
    ["CUCM-UCS-SRV", "hypothetical server", "unified-communications", "a bare CUCM prefix — cucm-entitlement is token-anchored so this stays out"],
    // Juniper, under a Prime Collaboration shape.
    ["PC-1OC192-SON-XFP", "SONET/SDH OC192/STM64 PIC with XFP", "interfaces-modules", "prime-collab-software as a `PC-1` prefix — a JUNIPER SONET PIC"],
    // BUSINESS EDITION: the appliance and its parts. These SIX are the defect the class-against-kind
    // control caught after the block was already green — a bare `BE6K-` prefix passed every
    // automated test (115 parts, Cisco only, ZERO facts anywhere) and ate all of them, because a
    // part with no facts cannot be refused by a fact gate. The residue had been read in full; the
    // rest of the family had not.
    ["BE6K-M6-K9", "Business Edition 6000 (M6) Appliance, Export Restr SW", "unified-communications", "a bare BE6K- prefix — the Business Edition 6000 appliance itself"],
    ["BE6K-M7-XU", "Business Edition 6000 Svr (M7), Export Unrestricted SW", "unified-communications", "the same, one generation on"],
    ["BE6K-ST-BDL-K9=", "Business Edition 6000M Svr (M3), Export Restricted SW", "unified-communications", "a bare BE6K- prefix — ST-BDL is a SERVER; START is the licence pack"],
    ["BE6K-STBDL-PLS-XU=", "Business Edition 6000H (M3), Export Unrestrict. SW", "unified-communications", "the same, and the reason the token is ST-/STBDL and not bare ST"],
    ["BE6K-PSU-M6-1200", "1200W Titanium power supply for C-Series Servers", "unified-communications", "a bare BE6K- prefix — a 1200W PSU"],
    ["BE6K-RAIDCTRLR-M6", "12G SAS RAID Controller w/4GB FBWC (16 Drv) w/1U Brkt", "unified-communications", "a bare BE6K- prefix — a RAID controller"],
    // Business Edition, continued.
    ["BE7K-NIC-M6", "Cisco-Intel X710T4LG 4x10 GbE RJ45 PCIe NIC", "unified-communications", "a bare BE\\d prefix — a 4x10GbE NIC with an own physical fact"],
    // The slash and version shapes, which are not markers.
    ["QSFP-4SFP10G-CU3M", "40GBASE-CR4 QSFP+ to 4 10GBASE-CU SFP+ direct attach breakout cable assembly, 3 meter passive",
      "transceiver", "a `/`-or-digits non_product shape read loosely"],
    ["MP232-R", "Cisco MP232-R", "servers-unified-computing", "a bare MP prefix under meetingplace-addon"],
    ["ISR-CCP-CD", "Config Professional on CD, CCP-Express on Router Flash (Both system and spare)",
      "routers", "an ISR-CCP- prefix — correct to reclassify, but a routers row and the routers owner's call"],
    // THE ONE REAL HARDWARE FAMILY IN THE RESIDUE, and the UNITY licence prefix's reason for a veto.
    ["UNITY-PIMG-MITEL", "PBX-IP Media Gateway for Mitel SX200 and SX2000 PBXs", "unified-communications", "the UNITY licence prefix without its -PIMG veto"],
    ["UNITY-PIMG-LEGEND", "PBX-IP Media Gateway for Avaya Merlin Legend systems", "unified-communications", "the same"],
    ["UNITY-TIMG-1=", "T1 IP-Media Gateway", "unified-communications", "the UNITY licence prefix without its -TIMG veto"],
    // Real collaboration hardware that stays hardware and is a collabKind gap, not a class defect.
    ["SPK-SHARE-K9", "Webex Share wireless screen-sharing adapter.", "collaboration-endpoints", "any SP-/SPK- prefix rule — a real screen-sharing adapter"],
    ["SPVAC-H450-W-US=", "SolutionsPlus: Jabra Handset 450 for Cisco -White-US", "collaboration-endpoints", "an SP- prefix rule — a Jabra handset"],
    ["UC-RAID-9271", "MegaRAID 9271-8i + Battery Backup for C240 and C220", "unified-communications", "a bare UC- prefix under uc-version-migration-question / uc-app-software-kit — a RAID controller"],
    ["EM-HDA-6FXO", "Cisco EM-HDA-6FXO", "unified-communications", "any name-blind residue rule — a 6-port FXO voice extension module"],
    ["SM-X-NIM-ADPTR", "SM-X Adapter for one NIM module for Cisco 4000 Series ISR", "unified-communications", "the same — a physical module adapter"],
    ["C1200-8FP-2G-OPT", "Catalyst 1200 8-port GE Switch, Full PoE, 2x1G Combo", "collaboration-endpoints", "any residue rule — a real Catalyst 1200 switch, misfiled (a category-move proposal)"],
    ["WBP54G", "802.11b/g wireless bridge", "collaboration-endpoints", "a WB* prefix under WBX- — a real wireless bridge"],
    ["ADPT-HDMI-DVID=", "Adaptor HDMI to DVID cable", "collaboration-endpoints", "any residue rule — a real cable"],
    ["HS-WL-ADPT-USBC=", "Headset Wireless Bluetooth USB-C Adapter with USB-C to A converter", "collaboration-endpoints", "any residue rule — a real USB adapter"],
    ["CTS-ATP-MX200-K9", "ATP Demo Cisco TelePresence MX200 42", "collaboration-endpoints", "a CTS-ATP- rule read as a demo licence — an ATP demo SHIPS the MX200"],
    ["CP-ROOMPH-NA-MK9", "MLB Subscription Room Phone", "unified-communications", "a subscription NAME on a real main logic board"],
    ["SP-ATLAS-IPDC=", "Wall Mount Clock, Less Enc.", "unified-communications", "an SP- prefix rule — an Atlas PoE IP clock"],
    ["CS-PANO-SWITCH2+", "Room Panorama - Cisco C1000 16 Port Switch", "collaboration-endpoints", "any residue rule — a Catalyst C1000 sold inside Room Panorama"],
    ["CTS-5K-LC-SWITCH", "Catalyst 2960C Switch 12 FE PoE, 2 x Dual Uplink, Lan Base", "collaboration-endpoints", "a CTS-5K- rule — a Catalyst 2960C with an own physical fact"],
    ["CTS-ST-INT-PLATE=", "Interface plate CAM-P60 to Speaker Track 60", "collaboration-endpoints", "any residue rule — a metal interface plate"],
    ["CP-HS-W-5EC8=", "8-pack Ear Pad Spare (optional accessory) for 520 and 530 Series", "collaboration-endpoints", "any residue rule — ear pads"],
    ["CS-R-USB-T10-KIT", "Touch 10 Kit for Room USB Upgrade", "collaboration-endpoints", "an upgrade-kit rule — this kit ships a Touch 10 panel"],
    ["AVIZ-TAC-K9", "SolutionsPlus: Avizia Tactical", "collaboration-endpoints", "an AVIZ- rule — the Avizia telehealth cart, not its -SW sibling"],
    ["CTI-VCS-BRAGEEARS=", "116269 Brage Rack Ears Kit", "unified-communications", "a CTI-VCS- rule — rack ears"],
    // The name rule must not read a DEVICE description as an ordering question.
    ["CS-BOARD70S-K9++", "Cisco Webex Board 70S", "collaboration-endpoints", "name-ordering-question widened past its anchors"],
  ];
  for (const [sku, name, cat, wouldEat] of stay) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`collab-class refusal: ${sku} stays hardware (would have been eaten by ${wouldEat.slice(0, 52)})`,
      got.klass === "hardware", `${got.klass} / ${got.reason}`);
  }
  check(`collab-class has at least as many refusals (${stay.length}) as it has rule families`, stay.length >= 30);

  // A SECOND KIND OF REFUSAL, and it needs its own assertion because "stays hardware" cannot state
  // it. Citrix and VMware in servers-unified-computing are ALREADY licences (ucs-kind-os-license),
  // so a bare CTX- or VMW- prefix here would not change their class — it would change their REASON
  // and quietly move them into this agent's block, in a category the servers agent owns. What must
  // hold is that no collab-class rule is the one that decides them.
  const collabRuleNames = new Set(SKU_RULES.slice(SKU_RULES.findIndex((r) => r.token === "webex-collab-subscription"))
    .map(ruleName).concat("name-ordering-question"));
  const notMine: [string, string, string, string][] = [
    ["CTX-XD-ENT-U-1A=", "Citrix XenDesktop Enterprise Edition, 1 user, 1yr Support Required", "servers-unified-computing", "a bare CTX- prefix — 167 Citrix licences the servers agent owns"],
    ["VMW-VSP-STD-4A", "VMware vSphere 6 Standard (1 CPU), 4-yr, Support Required", "servers-unified-computing", "a bare VMW- prefix — the servers agent's vSphere licences"],
    ["VMW-VS5-ENTP-3A", "VMware vSphere 5 Enterprise Plus (1 CPU), 3yr Support Required", "servers-unified-computing", "uc-virt-embedded-license widened past its three UC forms"],
    ["A-CMS-API", "CMS TMS Appint for Exchange/O365 or Cal. Connector", "conferencing", "nothing — this one IS a collab-class row, listed to show the assertion can fail"],
  ];
  for (const [sku, name, cat, wouldEat] of notMine.slice(0, 3)) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: cat === "servers-unified-computing" });
    check(`collab-class does not decide ${sku} (${wouldEat.slice(0, 50)})`, !collabRuleNames.has(got.reason), `${got.klass} / ${got.reason}`);
  }
  // The control for that assertion: it must be able to FAIL. A-CMS-API is a collab-class row, so the
  // predicate above must return true for it — otherwise the three checks prove nothing.
  check("CONTROL: the not-decided-here predicate does fire on a row this block DOES decide",
    collabRuleNames.has(classify({ sku: "A-CMS-API", name: "CMS TMS Appint", categorySlug: "conferencing", categoryIsHardware: true }).reason));

  // SABOTAGE. Each disables exactly one guard and asserts the thing it protects is eaten — a veto or
  // an anchor that nothing would notice if removed is not a guard.
  const unityLic = SKU_RULES.find((r) => r.kind === "prefix" && r.token === "UNITY")!;
  check("SABOTAGE the UNITY licence prefix without its -PIMG veto eats a real media gateway",
    ruleMatches({ ...unityLic, except: [] }, "UNITY-PIMG-MITEL"));
  check("SABOTAGE the UNITY licence prefix without its BUNDLE veto re-eats UNITYCN7-BUNDLE",
    ruleMatches({ ...unityLic, except: ["-PIMG", "-TIMG"] }, "UNITYCN7-BUNDLE"));
  const webex = SKU_RULES.find((r) => r.token === "webex-collab-subscription")!;
  check("SABOTAGE webex-collab-subscription at ONE letter after A- eats the Arista AOC cable",
    ruleMatches({ ...webex, re: /^A-[A-Z]/ }, "A-D800-D800-7M"));
  const cube = SKU_RULES.find((r) => r.token === "cube-session-license")!;
  check("SABOTAGE cube-session-license without its -CUBEE anchor eats the ASR 1001-HX chassis",
    ruleMatches({ ...cube, re: /^FLS?A?SR1-|^C1-(?:ASR1|CUBEE|FL)/ }, "C1-ASR1001-HX/K9"));
  check("SABOTAGE cube-session-license with C1-FL and no hyphen eats C1-FLOW-IE4K",
    ruleMatches({ ...cube, re: /^C1-FL/ }, "C1-FLOW-IE4K"));
  const cmImg = SKU_RULES.find((r) => r.token === "cucm-version-image")!;
  check("SABOTAGE cucm-version-image without its -K9 / -UCS- marker eats CM8-UM08-04-E7G-ULL",
    ruleMatches({ ...cmImg, re: /^(?:R-)?CM\d/ }, "CM8-UM08-04-E7G-ULL"));
  const ctx = SKU_RULES.find((r) => r.token === "telepresence-exchange-service")!;
  check("SABOTAGE telepresence-exchange-service as a bare CTX- prefix eats a Citrix licence",
    ruleMatches({ ...ctx, re: /^CTX-/ }, "CTX-XD-ENT-U-1A"));
  const vmw = SKU_RULES.find((r) => r.token === "uc-virt-embedded-license")!;
  check("SABOTAGE uc-virt-embedded-license widened to VMW-VS eats the servers agent's vSphere licence",
    ruleMatches({ ...vmw, re: /^VMW-VS/ }, "VMW-VSP-STD-4A"));
  const edel = SKU_RULES.find((r) => r.token === "uc-app-edelivery")!;
  check("SABOTAGE uc-app-edelivery as a bare R- prefix eats the wireless Policy Suite software",
    ruleMatches({ ...edel, re: /^R-/ }, "R-POLICY-241-SWK9"));
  const prime = SKU_RULES.find((r) => r.token === "prime-collab-software")!;
  check("SABOTAGE prime-collab-software as a PC-1 prefix eats a Juniper SONET PIC",
    ruleMatches({ ...prime, re: /^PC-1/ }, "PC-1OC192-SON-XFP"));
  const ccx = SKU_RULES.find((r) => r.token === "contact-centre-app-media")!;
  check("SABOTAGE contact-centre-app-media without its version anchor reaches unread contact-center PIDs",
    ruleMatches({ ...ccx, re: /^CCX/ }, "CCX-41-90UQAQMS1"));
  const dlt = SKU_RULES.find((r) => r.token === "uc-partner-dlt-kit")!;
  check("SABOTAGE uc-partner-dlt-kit widened to CSR1x eats the Cloud Services Router",
    ruleMatches({ ...dlt, re: /^CSR1\d/ }, "CSR1000V"));
  const ucsUpg = SKU_RULES.find((r) => r.token === "cucm-on-ucs-upgrade")!;
  check("SABOTAGE cucm-on-ucs-upgrade as a bare UCS- prefix reaches the servers agent's catalogue",
    ruleMatches({ ...ucsUpg, re: /^UCS-/ }, "UCS-CPU-I6338"));
  // The BE6K defect, as a sabotage: the bare prefix is what was written first, and it eats the
  // appliance, its PSU and its RAID controller. Restoring the bare form must make all three red.
  const be = SKU_RULES.find((r) => r.token === "be6000-entitlement")!;
  for (const eaten of ["BE6K-M6-K9", "BE6K-PSU-M6-1200", "BE6K-ST-BDL-K9"]) {
    check(`SABOTAGE be6000-entitlement as a bare BE6K- prefix eats ${eaten}`,
      ruleMatches({ ...be, kind: "prefix", token: "BE6K-", re: undefined }, eaten));
  }
  check("be6000-entitlement takes START and refuses ST-BDL — the family's own distinction",
    ruleMatches(be, "BE6K-START-UWL35") && !ruleMatches(be, "BE6K-ST-BDL-K9"));
  // The bare CUBE- forms must not reach a real power cube, which is the token collabKind had wrong.
  check("cube-session-license leaves CP-PWR-CUBE-4 alone (a real IP phone power transformer)",
    !ruleMatches(cube, "CP-PWR-CUBE-4"));
  check("SABOTAGE cube-session-license widened to CUBE anywhere eats CP-PWR-CUBE-4",
    ruleMatches({ ...cube, re: /CUBE/ }, "CP-PWR-CUBE-4"));
  // The name rule: an ordering question is a whole-name shape, and a device name must not match.
  check("SABOTAGE name-ordering-question unanchored ('number of' anywhere) eats a port-count spec name",
    /number of /i.test("Switch with a high number of PoE ports") && !/^number of /i.test("Switch with a high number of PoE ports"));
  check("name-ordering-question leaves a device alone",
    classify({ sku: "CS-BOARD70S-K9", name: "Cisco Webex Board 70S", categorySlug: "collaboration-endpoints", categoryIsHardware: true }).klass === "hardware");
  sabotages += 22;
}
// end collab-class

// wl-uc-class (12 Sep 2026) — the wireless and unified-communications class residue named by the
// reviewer's round 4 §6: wireless kind `software` 134 and kind `other` 1,187, UC kind `software` 239.
// Every SKU and every name below is verbatim from the live catalogue — each was looked up before it was
// pinned, because a refusal pinned against a SKU that does not exist is a test that proves nothing.
// There are more refusals than positives, and each refusal names the wider form of the rule above it
// and the real product that form would have declassified.
{
  const fire: [string, string, string, ProductClass, string][] = [
    // --- the StarOS / mobile packet core catalogue filed in `wireless` -----------------------------
    ["ASR55-00-SWUDP218", "ASR5500 StarOS Release 18 System SW, Per UDPC2", "wireless", "license", "sku-regex:staros-5500-licence"],
    ["ASR5S-00SWUD22122=", "ASR5500 Subscr Release 21.22 System SW, Per UDPC2", "wireless", "license", "sku-regex:staros-5500-licence"],
    ["LIF55-00-SWUDP219=", "ASR5500 StarOS Release 19 System SW, Per UDPC2 (Failover)", "wireless", "license", "sku-regex:staros-5500-licence"],
    ["ASR5K-SW-R21-K9", "ASR5000 System Software, Release 21.0, Per SMC or MIO", "wireless", "software", "sku-regex:staros-image"],
    ["ASR5K-03-HA-P3=", "Sprint Only HA Per PSC3", "wireless", "license", "sku-regex:asr5000-feature-licence"],
    ["ASR5K-1D-R120-K9=", "SCM R12 upgrade, including IMSI prefix, AAR enable", "wireless", "license", "sku-regex:asr5000-feature-licence"],
    ["ASR5000-NETW4RTM", "Cisco ASR5000-NETW4RTM", "wireless", "license", "sku-prefix:ASR5000-NETW4"],
    ["MIXS-00-HS3S41=", "HSS 10,000 Provisioned Subscriber Block", "wireless", "license", "sku-regex:ims-mobility-licence"],
    ["MIXSA-00-SSE0R10", "ECS Offboard Storage Server (ESS) Rel 10", "wireless", "license", "sku-regex:ims-mobility-licence"],
    ["MIXF-0D-1-SB31-M1", "TMO SBC Bundle per 1K Ports, 16K Sess, Call Model 1 Failover", "wireless", "license", "sku-regex:ims-mobility-licence"],
    ["QVPCA-00-SW-2502", "QVPC StarOS Release 2025.02 System SW", "wireless", "software", "sku-regex:qvpc-image"],
    ["QVPCA-00-HA10SW", "Home Agent Software License, 10K sessions", "wireless", "license", "sku-regex:qvpc-licence"],
    ["UCC5G-SMF-S31-L", "UCC - Session Management Function (SMF), 1K sessions", "wireless", "license", "sku-regex:ucc-cloud-core"],
    ["MI3P-00-AND-100S=", "ANDSF Capacity License (activated clients) - 100k", "wireless", "license", "sku-prefix:MI3P-"],
    ["AND-R17-ALL-10M_S=", "ANDSF All Inclusive 2017 Release Upgrades- 10M sessions", "wireless", "license", "sku-regex:andsf-release-upgrade"],
    ["CUTO-00-P91=", "CUTO Standalone Perpetual 1 Gbps", "wireless", "license", "sku-regex:cuto-perpetual"],
    ["MOG-SW-09=", "CPS MOG Release 9.0, per instance", "wireless", "software", "sku-regex:mog-software"],
    ["MOG-FDC-100=", "MOG Non-RTU Features, AT&T Only", "wireless", "license", "sku-prefix:MOG-FDC"],
    ["OWM-4-PPA-K9=", "PPI+Analytics Bundle 1-9.9M Active Users", "wireless", "license", "sku-prefix:OWM-"],
    ["EMSP-L-BASE-5Y", "EMSP Base Platform Large package - 5 Year Duration", "wireless", "license", "sku-prefix:EMSP-"],
    // --- Cisco Policy Suite: the software and the application licences, two spellings ---------------
    ["POLICY-75-AIO-K9", "Cisco Policy Suite 7.5 All-In-One Lab Software", "wireless", "software", "sku-regex:policy-suite-software"],
    ["R-POLICY-241-SWK9", "Cisco Policy Suite 24.1 Software", "wireless", "software", "sku-regex:policy-suite-software"],
    ["POL-P-ALL-100K", "CPS All-Inclusive Feature Pack - 100K sessions", "wireless", "license", "sku-prefix:POL-"],
    ["QP-LTE-BASE-1", "Cisco QP-LTE-BASE-1", "wireless", "license", "sku-regex:policy-runtime"],
    ["PDRA-P-PRE-1M", "Policy DRA - Premium Pack - 1M Sessions", "wireless", "license", "sku-regex:policy-dra"],
    ["VDRA-INIT", "VDRA Application Base License", "wireless", "license", "sku-regex:policy-dra"],
    ["APS-P-AAA-10K-1T", "AAA Feature Pack - 10K Sessions - 1-999K", "wireless", "license", "sku-regex:policy-feature-pack"],
    ["M-P-SIR-10K-1T", "Subscriber Intelligence Module - 10k Subscribers - 10-999K", "wireless", "license", "sku-regex:policy-feature-pack"],
    ["CPS-S-ATS-MV=", "CPS Automation Tool SW SWSS + Install, Multi VM", "wireless", "license", "sku-regex:cps-automation"],
    ["SSAS20K9-COSLI20", "WSG R2.0 Application Software RTU per SAMI (Crypto)", "wireless", "license", "sku-regex:wsg-sami-rtu"],
    ["SC-SBC-NAP-SAMI-1", "No App Image For WS-SVC-SAMI-BB=", "wireless", "software", "sku-regex:sami-no-app-image"],
    ["R-NAM-VX10-62K9S=", "Smart Lic based Cisco Prime Virtual NAM VX10 Software 6.2", "wireless", "software", "sku-regex:prime-virtual-nam"],
    // --- wireless management, location and controller software -------------------------------------
    ["AIR-CAS-1KC-K9", "Context Aware Engine for Clients License For 1K Clients", "wireless", "license", "sku-regex:context-aware-licence"],
    ["AIR-LM-WIPS-2000", "Cisco Enhanced Local Mode wIPS License, Supporting 2000 APs", "wireless", "license", "sku-regex:context-aware-licence"],
    ["AIR-CMX-CLD-CPA-1Y", "CMX Cloud - Connect with Presence Analytics 1Yr license", "wireless", "license", "sku-regex:context-aware-licence"],
    ["AIR-CT2504-SW-8.1", "Cisco 2504 Wireless Controller SW Rel. 8.1", "wireless", "software", "sku-regex:wlc-ap-image"],
    ["SWC5500K9-81", "Cisco Unified Wireless Controller SW Release 8.1", "wireless", "software", "sku-regex:wlc-ap-sw-image"],
    ["SWLAP3700-MESH-K9", "Enterprise Wireless Mesh - AP3700 Controller-based SW Image", "wireless", "software", "sku-regex:wlc-ap-sw-image"],
    ["SWIEC6400-URWB", "URWB software for IEC6400", "wireless", "software", "sku-regex:wlc-ap-sw-image"],
    ["SC9800CLAMIK9-xxxx", "Cisco Catalyst 9800-CL Wireless Controller - AWS", "wireless", "software", "sku-prefix:SC9800"],
    ["SC980080K9-171", "UNIVERSAL (NETWORK ESSENTIALS)", "wireless", "software", "sku-prefix:SC9800"],
    ["SC-SVC-WISM2-8.1", "WiSM2 SW Rel. 8.1", "wireless", "software", "sku-regex:wism-software"],
    ["MSE-SW-NEW-WIPS", "MSE software option - WIPS 10.x SW", "wireless", "software", "sku-regex:mse-software"],
    ["MSE-WIPS-T-5Y", "MSE WIPS Tracker Term 5Y", "wireless", "license", "sku-prefix:MSE-WIPS-"],
    ["C1-WLC-AP-T", "Cisco ONE Wireless LAN Controller Term License", "wireless", "license", "sku-regex:cisco-one-wireless"],
    ["C1-MSE-WIPS-1", "Cisco ONE Mobility Svcs - Wireless Intrusion Prevention 1AP", "wireless", "license", "sku-regex:cisco-one-wireless"],
    ["PRO-L-LS-100AP", "Promotion- 100 AP Base Location Services license", "wireless", "license", "sku-regex:promo-location-licence"],
    ["S-MGMT3X-N5K", "Cisco Ent MGMT: PI 3.x LF, AS Smart Lic, 1 Nexus 5K", "wireless", "license", "sku-prefix:S-MGMT3X-"],
    ["WCS-NAV-20", "Cisco WCS Navigator License to support 20 Cisco WCS management platforms", "wireless", "license", "sku-prefix:WCS-NAV-"],
    ["C4500E-S8-CA", "5 AP license upgrade for Cisco 4500 Wireless Controller", "wireless", "license", "sku-exact:C4500E-S8-CA"],
    ["ASCT-EXCMGR", "Exciter Manager Software", "wireless", "software", "sku-exact:ASCT-EXCMGR"],
    // --- Fluidmesh ---------------------------------------------------------------------------------
    ["FM3200-30", "Enable up to 30 Mbit/s ethernet througput in FM3200 Devices for fix backhaul", "wireless", "license", "sku-regex:fluidmesh-throughput"],
    ["FM4500-FLU-TRK-15", "Enable FLUIDITY Infrastructure Mode up to 15 Mbit/sec in FM4500", "wireless", "license", "sku-regex:fluidmesh-throughput"],
    ["FM1000-GWY-500", "Software upgrade up to 500 Mbps (aggregate throughput)", "wireless", "license", "sku-regex:fluidmesh-throughput"],
    ["FM4800-FLU-TRK-MOB-250", "Cisco FM4800-FLU-TRK-MOB-250", "wireless", "license", "sku-regex:fluidmesh-throughput"],
    ["FM-TITAN", "TITAN Plug-in. Enables Fast Failover in case of network, radio or power failure", "wireless", "license", "sku-regex:fluidmesh-plugin"],
    ["FM-MONITOR-2500", "Cisco FM-MONITOR-2500", "wireless", "license", "sku-regex:fluidmesh-plugin"],
    ["FLMESH-SW-PAK", "SW Container PID Only", "wireless", "non_product", "sku-exact:FLMESH-SW-PAK"],
    // --- ordering options and datasheet cells ------------------------------------------------------
    ["AIR-EMEA", "Regulatory Domain Configuration for EMEA (ETSI)", "wireless", "non_product", "sku-regex:regulatory-domain-option"],
    ["AIR3500-DP-DLR", "Product family - demand planning dollar adjustment", "wireless", "non_product", "sku-regex:demand-planning-adjust"],
    ["U-NII-6", "Cisco U-NII-6", "wireless", "non_product", "sku-regex:wifi-datasheet-cell"],
    ["WPA3", "Cisco WPA3", "wireless", "non_product", "sku-regex:wifi-datasheet-cell"],
    ["MSC15", "Cisco MSC15", "wireless", "non_product", "sku-regex:wifi-datasheet-cell"],
    ["VMXNET3", "Cisco VMXNET3", "wireless", "non_product", "sku-regex:wifi-datasheet-cell"],
    ["FINISAR-LR", "Cisco FINISAR-LR", "wireless", "non_product", "sku-regex:wifi-datasheet-cell"],
    ["AP1542D", "D: Internal directional antenna", "wireless", "non_product", "sku-regex:ap-antenna-option-cell"],
    ["AP1562E", "E: External Antenna", "wireless", "non_product", "sku-regex:ap-antenna-option-cell"],
    ["C9130-OVER", "C9130AX OVER OPTION", "wireless", "non_product", "sku-regex:ap-pack-option"],
    ["C9130-MULTI", "Minimum Quantity = 10", "wireless", "non_product", "sku-regex:ap-pack-option"],
    // --- unified-communications --------------------------------------------------------------------
    ["UCM-7825-NODE", "CUCM 7825 Node", "unified-communications", "license", "sku-regex:ucm-node-entitlement"],
    ["UCM-7835-UPG-PAK", "Include Upg PAK Auto-expanding PAK for CUCM 8.0", "unified-communications", "license", "sku-regex:ucm-node-entitlement"],
    ["UCM-7825-85-KIT", "CUCM 8.5 Media Kit", "unified-communications", "software", "sku-regex:cucm-mcs-software"],
    ["UCM-51-7845-KIT", "CUCM 5.1 Media Kit for CUWL Only", "unified-communications", "software", "sku-regex:cucm-mcs-software"],
    ["UCM-7816-86", "Unified Communications Manager 8.6 Server Software", "unified-communications", "software", "sku-regex:cucm-mcs-software"],
    ["UCM-10.5-SW-K9-XU=", "CUCM Software Version 10.X for PUT Only, Export Unrestricted", "unified-communications", "software", "sku-regex:cucm-put-software"],
    ["UC-14-SW-K9-XU=", "CUCM Software Version 14 for MCE Only, Export Unrestricted", "unified-communications", "software", "sku-regex:cucm-put-software"],
    ["UCM-11X-ESS-UCL", "BE6K UCM 11X Essential User Connect Lic-Single Fulfillment", "unified-communications", "license", "sku-regex:cucm-user-licence"],
    ["UCM-90-ENHP-UCL", "BE6K UCM 90 Enhanced Plus User Connect License", "unified-communications", "license", "sku-regex:cucm-user-licence"],
    ["JAB9-DSK-CLNT-EA", "Jabber for Desktop 9.x Client License for Windows/Mac", "unified-communications", "license", "sku-regex:jabber-client"],
    ["JABBER-GUEST-EA-K9", "Jabber Guest Right to Use", "unified-communications", "license", "sku-regex:jabber-client"],
    ["JABG-EXP-2SBDL-K9=", "Jabber Guest 2 Session Bundle", "unified-communications", "license", "sku-regex:jabber-client"],
    ["CALL-SW-12.X-K9", "PS Calling for EMEAR - Software Version 12", "unified-communications", "software", "sku-regex:ps-calling-software"],
    ["E3C-SW-15-K9", "Cisco E3C-SW-15-K9", "unified-communications", "license", "sku-exact:E3C-SW-15-K9"],
  ];
  for (const [sku, name, cat, want, reason] of fire) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`wl-uc-class: ${sku} -> ${want} by ${reason}`, got.klass === want && got.reason === reason, `${got.klass} / ${got.reason}`);
    seenReasons.add(got.reason);
  }

  // REFUSALS. Every one is a real product, with the catalogue's own name, that a wider form of a rule
  // above would have deleted. Nine of them carry an own fact, which is why the fact gate could refuse
  // those nine; the rest could only be found by reading the family, which is the point.
  const stay: [string, string, string, string][] = [
    // The ASR 5000/5500 platform. The rule takes LICENCE BLOCKS, never the platform token.
    ["ASR5K-SMC-K9", "System Management Card 4GB", "wireless", "a bare ASR5K- prefix — the System Management Card"],
    ["ASR5K-MEM-PSC2=", "DIMM Replacement Kit for PSC2 - 32GB", "wireless", "a bare ASR5K- prefix — a DIMM kit"],
    ["ASR5K-0110G-MM-K9", "XGLC 1-Port 10 Gigabit Ethernet Line Card w/MM SFP+", "wireless", "a bare ASR5K- prefix — a line card with an own physical fact"],
    ["ASR5K-12-PSC32GK9=", "Packet Services Card (PSC2) 32GB, ATT Femto only", "wireless", "asr5000-feature-licence widened to any two-character block — block 12 holds a CARD"],
    ["ASR5K-20-LAB-PSC3", "ASR 5000 Platform Partner Lab Bundle, 3x PSC3", "wireless", "the same — block 20 holds chassis lab bundles"],
    ["ASR5K-0F-B00-2069=", "Motorola PSC2 LTE Hardware and Software bundle", "wireless", "the same — block 0F is a hardware+software bundle"],
    ["ASR5K-232216V3-K9", "ASR5000 Bundle, incl 2xSMC/3xPSC2 16GB/2xRCC/2xSPIO 3PN", "wireless", "a two-digit block read off a six-digit configuration code"],
    ["ASR55-DPC-K9", "ASR5500 Data Processing Card (DPC)", "wireless", "a bare ASR55- prefix — a Data Processing Card"],
    ["ASR55-UDPC-K9", "ASR5500 Universal Data Processing Card (UDPC)", "wireless", "the same"],
    ["ASR55-CHS-SYS-U8B", "ASR5500-U System w/chassis, 8 UDPC, 2 UMIO-SR, 4 FSC, 2 SSC", "wireless", "a bare ASR55- prefix — a chassis system"],
    ["ASR55-04-UDPCRX", "ASR5500 UDPC Card and Initial System SW, KDDI Only", "wireless", "staros-5500-licence without its -UDPCRX veto — a card sold with its software"],
    // The one mixed MIX* block: AT&T's PAS rack build.
    ["MIXS-12-PA2121AC=", "PAS AC ENCLOSURE [ATT US PAS Only]", "wireless", "ims-mobility-licence without its PA2 veto — an enclosure"],
    ["MIXS-12-PA2211BL=", "PAS SPARE BLADE [ATT US PAS Only]", "wireless", "the same — a spare blade"],
    ["MIXS-12-PA2141CO=", "PAS 10G ENCLOSURE SWITCH [ATT US PAS Only]", "wireless", "the same — an enclosure switch"],
    // AIR-: 2,186 products, 61 with an own physical fact. Five measured sub-families only.
    ["AIR-MRAID12G", "Cisco 12G SAS Modular Raid Controller", "wireless", "a bare AIR- prefix — a RAID controller"],
    ["AIR-MOD-AC-EU", "AP1800 AC plug module for the EU", "wireless", "a bare AIR- prefix — an AC plug module"],
    ["AIR-330-MB-1", "MobileAccessVE One-link Main Building Unit", "wireless", "a bare AIR- prefix — a DAS building unit"],
    ["AIR-CT85DC-SP-K9", "8500 Series Wireless Controller with 0 APs included, Dual DC PSU", "wireless", "an AIR-CT rule read without the -SW- release anchor — an 8500 controller"],
    ["AIR-1550-HAZBBU", "1550 Series Hazardous Location Battery Backup Unit", "wireless", "a bare AIR- prefix — a battery backup unit"],
    ["AIR-CORD1500-40UE=", "Aironet 1500 AC Power Cord, 40 ft. unterm, EU", "wireless", "a bare AIR- prefix — a power cord with an own fact"],
    ["AIR-MSE3350-HD=", "Field Replaceable Hard Disk For The MSE 3350", "wireless", "an AIR-MSE rule wider than -PAK — a hard disk"],
    ["AIR-MSE-B2-C3-W25", "MSE 3350 Bundle", "wireless", "an AIR-MSE rule wider than -PAK — a bundle that ships the MSE 3350"],
    ["AIR-VBLE1-K9", "Cisco CMX Beacon Point", "wireless", "an AIR-...BLE rule — a physical beacon point"],
    ["MSE-HD600G10K12G", "600GB 6Gb SAS 10K RPM SFF HDD/hot plug/drive sled mounted", "wireless", "a bare MSE- prefix — a 600 GB drive"],
    ["MSE-MRAID12G", "Cisco 12G SAS Modular Raid Controller", "wireless", "a bare MSE- prefix — a RAID controller"],
    // Fluidmesh: the tier at the end is the whole discriminator.
    ["FM1000-GWY", "Cisco FM1000 Gateway for Fluidity up to 1 Gbps of aggregate throughput", "wireless", "fluidmesh-throughput without its tier requirement — the gateway itself, with an own physical fact"],
    ["FM10000-GWY", "Cisco FM10000 Gateway for Fluidity up to 10 Gpbs of aggregate throughput", "wireless", "the same, one model up"],
    ["FM3200B-HW", "Cisco FM3200 Base, single MIMO radio device, up to 15 Mbit/s", "wireless", "fluidmesh-throughput with -HW read as a tier — a backhaul radio"],
    ["FM1200V-HW", "Cisco FM1200 Volo, single MIMO radio device, up to 2.5 Mbit/s", "wireless", "the same"],
    ["FM-OMNI-5-V", "Cisco FM-OMNI-5-V", "wireless", "a bare FM- prefix — an omni antenna"],
    ["FM-PANEL-9", "Cisco FM-PANEL-9", "wireless", "a bare FM- prefix — a panel antenna"],
    ["FM-SHARK-16", "Cisco FM-SHARK-16", "wireless", "a bare FM- prefix — a shark-fin antenna"],
    ["FM-SECTOR90-16DS", "Cisco FM-SECTOR90-16DS", "wireless", "a bare FM- prefix — a 90-degree sector antenna"],
    ["FM-POE-STD", "Cisco FM-POE-STD", "wireless", "a bare FM- prefix — a PoE injector"],
    ["FLMESH-HW-ACC-61", "Cisco FLMESH-HW-ACC-61", "wireless", "a bare FLMESH- prefix — a Fluidmesh accessory with an own fact"],
    // Ordering options and datasheet cells are anchored to the WHOLE SKU.
    ["C9800-40-K9", "Cisco Catalyst 9800-40 Wireless Controller", "wireless", "ap-pack-option widened to ^C9\\d{3}- — the real Catalyst 9800-40 controller"],
    ["AP1572IC", "Cisco AP1572IC", "wireless", "ap-antenna-option-cell widened to ^AP1 — an AP variant carrying two own facts"],
    ["AP18321-UXK9", "Hydra 3X3 cost saving version for Corsica Lite AP1830", "wireless", "the same — a real AP1830 variant"],
    ["C9124-CVR1=", "Paintable cover for Catalyst 9124AX", "wireless", "a C9124- prefix — a paintable cover"],
    // Cisco ONE and EDU: the ordering-form spellings of real controllers.
    ["C1-AIR-CT5508-K9", "Cisco ONE - 5500 series WLAN Controller w/ 0 AP lics", "wireless", "cisco-one-wireless widened to ^C1-AIR- — a real 5508 controller on the Cisco ONE form"],
    ["C1-N9K-C9508", "Cisco ONE Nexus 9508 Chassis with 8 linecard slots", "switches", "cisco-one-wireless widened to a bare C1- — round 2's refusal, still refused"],
    ["EDU-CT5520-K9", "Cisco 5520 Wireless Controller w/rack mounting kit K12", "wireless", "a bare EDU- prefix — a real K12 controller"],
    ["EDU-CW9800M", "Cisco EDU-CW9800M", "wireless", "the same"],
    ["PROMOCT5508-1-K9", "Migration to Cisco - 5508 100 licenses", "wireless", "promo-location-licence widened to ^PRO — a controller migration that may ship the controller"],
    // Other lanes' products that a wider token would have reached.
    ["S-4554LC80D", "MikroTik S-4554LC80D 1,25G SFP BiDi", "transceiver", "S-MGMT3X- widened to a bare S- — a MikroTik optic with two own physical facts"],
    ["WS-SVCWISM2FIPKIT=", "WS-SVC-WISM2 FIPS Kit", "wireless", "wism-software read as a WISM substring — a FIPS kit"],
    ["ASCT-EX3200", "Compact exciter", "wireless", "an ASCT- prefix — a compact exciter; only its -EXCMGR software sibling is taken"],
    ["IWA-SATAIN-220M6", "C220M6 SATA Interposer board (1U)", "wireless", "any residue rule — a server interposer board misfiled in wireless"],
    ["CS-ROOM70P-WMK=", "Cisco Room 70 Panorama Wall Mount Kit - hangs on wall", "wireless", "any residue rule — a wall mount kit with an own physical fact (a category-move proposal)"],
    ["CW-INJ-8", "Cisco CW-INJ-8", "wireless", "any residue rule — a PoE injector, and a wirelessKind gap reported rather than classed"],
    ["FM-PONTE-50", "Cisco FM-PONTE-50", "wireless", "fluidmesh-throughput read over the hyphenated FM- form — undecided between a PONTE radio and a 50 Mbps tier, so left hardware and reported"],
    ["WL5520-28-ADV-100", "Cisco WL5520-28-ADV-100", "wireless", "any WL<model>-<tier> rule — a controller-and-licence bundle whose name is only its SKU, left hardware and reported"],
  ];
  for (const [sku, name, cat, wouldEat] of stay) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`wl-uc-class refusal: ${sku} stays hardware (would have been eaten by ${wouldEat.slice(0, 56)})`,
      got.klass === "hardware", `${got.klass} / ${got.reason}`);
  }
  check(`wl-uc-class has more refusals (${stay.length}) than positives (${fire.length}) is NOT required, but it has at least 40`, stay.length >= 40);

  // A SECOND KIND OF REFUSAL, the one "stays hardware" cannot state. The twelve WPA-HXDP rows in
  // hyperconverged-systems are ALREADY licences (the servers agent's hyperflex rule), so a bare ^WPA
  // prefix here would not change their class — it would change their REASON to `non_product` and move
  // twelve rows of another agent's category into this block. What must hold is that no rule of mine
  // decides them.
  const mineNames = new Set(SKU_RULES.slice(SKU_RULES.findIndex((r) => r.token === "staros-5500-licence")).map(ruleName));
  for (const [sku, name, cat] of [
    ["WPA-ELA-HXDP-3Y", "WPA Purposes Only 3Y Data Center Hyperflex Software", "hyperconverged-systems"],
    ["WPA-HXDP-5Y-OASUB", "WPA Purposes Only 5Y Data Center Hyperflex OA Ratable", "hyperconverged-systems"],
  ] as [string, string, string][]) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: true });
    check(`wl-uc-class does not decide ${sku} (a bare ^WPA prefix would take the servers agent's HyperFlex EA rows)`,
      !mineNames.has(got.reason) && got.klass === "license", `${got.klass} / ${got.reason}`);
  }
  // The control for that assertion: the predicate must be able to fire. WPA3 IS one of my rows.
  check("CONTROL: the not-decided-here predicate does fire on a row this block DOES decide (WPA3)",
    mineNames.has(classify({ sku: "WPA3", name: "Cisco WPA3", categorySlug: "wireless", categoryIsHardware: true }).reason));

  // THREE REFUSALS THAT MOVED HERE from other blocks' "stays hardware" lists, because this block gave
  // those rows a class and "stays hardware" is only a PROXY for what those lists were proving. Asserted
  // against the rule BY NAME instead, which is what they meant and which survives a later decision.
  for (const [sku, name, notThis, why] of [
    ["SC9800CLAMIK9-xxxx", "Cisco Catalyst 9800-CL Wireless Controller - AWS", "sku-regex:family-placeholder",
      "a cloud controller, not a -xxxx placeholder; the transceiver block's veto says so in writing"],
    ["R-POLICY-241-SWK9", "Cisco Policy Suite 24.1 Software", "sku-regex:uc-app-edelivery",
      "wireless Policy Suite software, not a UC application's e-delivery twin"],
    ["R-NAM-VX20-62K9S=", "Smat Lic based Cisco Prime Virtual NAM VX20 Software 6.2", "sku-regex:uc-app-edelivery",
      "wireless Prime Virtual NAM software, the same"],
  ] as [string, string, string, string][]) {
    const got = classify({ sku, name, categorySlug: "wireless", categoryIsHardware: true });
    check(`wl-uc-class: ${sku} is NOT decided by ${notThis} (${why.slice(0, 58)})`,
      got.reason !== notThis && got.klass === "software", `${got.klass} / ${got.reason}`);
  }
  // And the control for THAT: family-placeholder must still decide a real placeholder, or the three
  // assertions above would pass because the rule had stopped working rather than because it was fenced.
  check("CONTROL: family-placeholder still decides DWDM-XFP-XX.YY",
    classify({ sku: "DWDM-XFP-XX.YY", name: "Cisco DWDM-XFP-xx.yy", categorySlug: "transceiver", categoryIsHardware: true }).reason
      === "sku-regex:family-placeholder");

  // SABOTAGE. Each disables exactly one guard and asserts the product it protects is eaten. A veto or an
  // anchor whose removal nothing notices is not a guard.
  const staros55 = SKU_RULES.find((r) => r.token === "staros-5500-licence")!;
  check("SABOTAGE staros-5500-licence without its -UDPCRX veto eats the UDPC card",
    ruleMatches({ ...staros55, re: /^(?:ASR55|ASR5S|LIF55)-\d\d/ }, "ASR55-04-UDPCRX"));
  for (const eaten of ["ASR55-DPC-K9", "ASR55-CHS-SYS-U8B", "ASR55-UDPC-K9"]) {
    check(`SABOTAGE staros-5500-licence as a bare ASR55- prefix eats ${eaten}`,
      ruleMatches({ ...staros55, kind: "prefix", token: "ASR55-", re: undefined }, eaten));
  }
  const asr5k = SKU_RULES.find((r) => r.token === "asr5000-feature-licence")!;
  for (const eaten of ["ASR5K-12-PSC32GK9", "ASR5K-20-LAB-PSC3", "ASR5K-0F-B00-2069"]) {
    check(`SABOTAGE asr5000-feature-licence widened to any two-character block eats ${eaten}`,
      ruleMatches({ ...asr5k, re: /^ASR5K-[0-9A-F]{2}-/ }, eaten));
  }
  const mix = SKU_RULES.find((r) => r.token === "ims-mobility-licence")!;
  for (const eaten of ["MIXS-12-PA2121AC", "MIXS-12-PA2211BL", "MIXS-12-PA2141CO"]) {
    check(`SABOTAGE ims-mobility-licence without its PA2 veto eats ${eaten}`,
      ruleMatches({ ...mix, re: /^MIX(?:SA|SF|S|F)-[0-9][0-9A-F]-/ }, eaten));
  }
  const caware = SKU_RULES.find((r) => r.token === "context-aware-licence")!;
  for (const eaten of ["AIR-MRAID12G", "AIR-MOD-AC-EU", "AIR-1550-HAZBBU", "AIR-CT85DC-SP-K9"]) {
    check(`SABOTAGE context-aware-licence as a bare AIR- prefix eats ${eaten}`,
      ruleMatches({ ...caware, kind: "prefix", token: "AIR-", re: undefined }, eaten));
  }
  const fmTier = SKU_RULES.find((r) => r.token === "fluidmesh-throughput")!;
  for (const eaten of ["FM1000-GWY", "FM10000-GWY", "FM3200B-HW", "FM1200V-HW"]) {
    check(`SABOTAGE fluidmesh-throughput without its tier requirement eats ${eaten}`,
      ruleMatches({ ...fmTier, re: /^FM(?:PONTE|\d{4,5}[A-Z]?)-/ }, eaten));
  }
  const fmPlug = SKU_RULES.find((r) => r.token === "fluidmesh-plugin")!;
  for (const eaten of ["FM-OMNI-5-V", "FM-PANEL-9", "FM-SHARK-16", "FM-POE-STD", "FM-SECTOR90-16DS"]) {
    check(`SABOTAGE fluidmesh-plugin as a bare FM- prefix eats ${eaten}`,
      ruleMatches({ ...fmPlug, kind: "prefix", token: "FM-", re: undefined }, eaten));
  }
  const cell = SKU_RULES.find((r) => r.token === "wifi-datasheet-cell")!;
  check("SABOTAGE wifi-datasheet-cell with WPA unanchored eats the servers agent's HyperFlex EA row",
    ruleMatches({ ...cell, re: /^WPA/ }, "WPA-ELA-HXDP-3Y"));
  const apCell = SKU_RULES.find((r) => r.token === "ap-antenna-option-cell")!;
  for (const eaten of ["AP1572IC", "AP18321-UXK9"]) {
    check(`SABOTAGE ap-antenna-option-cell widened to ^AP1 eats ${eaten}`, ruleMatches({ ...apCell, re: /^AP1/ }, eaten));
  }
  const pack = SKU_RULES.find((r) => r.token === "ap-pack-option")!;
  check("SABOTAGE ap-pack-option widened to ^C9\\d{3}- eats the Catalyst 9800-40 controller",
    ruleMatches({ ...pack, re: /^C9\d{3}-/ }, "C9800-40-K9"));
  const c1w = SKU_RULES.find((r) => r.token === "cisco-one-wireless")!;
  check("SABOTAGE cisco-one-wireless widened to ^C1-AIR- eats the Cisco ONE 5508 controller",
    ruleMatches({ ...c1w, re: /^C1-AIR-/ }, "C1-AIR-CT5508-K9"));
  check("SABOTAGE cisco-one-wireless as a bare C1- prefix eats the Nexus 9508 chassis",
    ruleMatches({ ...c1w, kind: "prefix", token: "C1-", re: undefined }, "C1-N9K-C9508"));
  const mgmt = SKU_RULES.find((r) => r.kind === "prefix" && r.token === "S-MGMT3X-")!;
  check("SABOTAGE S-MGMT3X- as a bare S- prefix eats a MikroTik optic",
    ruleMatches({ ...mgmt, token: "S-" }, "S-4554LC80D"));
  const mseSw = SKU_RULES.find((r) => r.token === "mse-software")!;
  check("SABOTAGE mse-software as a bare MSE- prefix eats the 600 GB drive",
    ruleMatches({ ...mseSw, kind: "prefix", token: "MSE-", re: undefined }, "MSE-HD600G10K12G"));
  const wism = SKU_RULES.find((r) => r.token === "wism-software")!;
  check("SABOTAGE wism-software read as a WISM substring eats the WiSM2 FIPS kit",
    ruleMatches({ ...wism, kind: "contains", token: "WISM", re: undefined }, "WS-SVCWISM2FIPKIT"));
  const promoL = SKU_RULES.find((r) => r.token === "promo-location-licence")!;
  check("SABOTAGE promo-location-licence widened to ^PRO eats the 5508 migration promotion",
    ruleMatches({ ...promoL, re: /^PRO/ }, "PROMOCT5508-1-K9"));
  // ORDER, not a veto: cucm-mcs-software WOULD take a node licence, which is why the node rule runs
  // first. This asserts the overlap exists — if it stops existing, the ordering comment is stale.
  const mcs = SKU_RULES.find((r) => r.token === "cucm-mcs-software")!;
  check("cucm-mcs-software does reach UCM-7825-NODE, so ucm-node-entitlement must run before it",
    ruleMatches(mcs, "UCM-7825-NODE")
    && SKU_RULES.findIndex((r) => r.token === "ucm-node-entitlement") < SKU_RULES.findIndex((r) => r.token === "cucm-mcs-software"));
  check("SABOTAGE cucm-mcs-software as a bare UCM- prefix calls a User Connect Licence a media kit",
    ruleMatches({ ...mcs, kind: "prefix", token: "UCM-", re: undefined }, "UCM-11X-ESS-UCL"));
  // qvpc-image must run before qvpc-licence, or a release image is called a licence.
  check("qvpc-image runs before qvpc-licence and both reach QVPCA-00-SW-2502",
    ruleMatches(SKU_RULES.find((r) => r.token === "qvpc-licence")!, "QVPCA-00-SW-2502")
    && SKU_RULES.findIndex((r) => r.token === "qvpc-image") < SKU_RULES.findIndex((r) => r.token === "qvpc-licence"));
  // THE CLASS CONTROL for Jabber. It was not a judgement call: the table ALREADY calls most of the
  // family `license` through the -RTU / -UWL / -LIC suffixes, so any other class would put one product
  // in two. If this drops, the jabber-client class needs re-deciding, not patching.
  const jabberAlready = ["JABBER-CLNT-RTU", "JAB9-DSK-CLNT-RTU"].map((s) =>
    classify({ sku: s, name: "", categorySlug: "unified-communications", categoryIsHardware: true }));
  check("jabber-client agrees with the class the table already gives the family through -RTU",
    jabberAlready.every((c) => c.klass === "license"),
    jabberAlready.map((c) => `${c.klass}/${c.reason}`).join(" "));
  // THE E3C LESSON, as a live assertion rather than a comment. The v14 row must keep `name-sw-bundle`:
  // it is that rule's only live witness, and the first draft of ps-calling-software took it.
  check("ps-calling-software leaves E3C-SW-14-K9 to name-sw-bundle (its only live witness)",
    classify({ sku: "E3C-SW-14-K9", name: "On-Premises SW Bundle v14 (1)", categorySlug: "unified-communications", categoryIsHardware: true }).reason
      === "name-sw-bundle");
  check("SABOTAGE ps-calling-software widened to E3C takes that witness and gets the class wrong",
    ruleMatches({ ...SKU_RULES.find((r) => r.token === "ps-calling-software")!, re: /^(?:CALL|E3C)-SW-\d/ }, "E3C-SW-14-K9"));
  // And the two C9120 rows keep name-dummy-pid for the same reason, which is what the veto is for.
  check("ap-pack-option leaves the two 'Dummy PIDs on the test orders:' rows to name-dummy-pid",
    ["C9120-MULTI", "C9120-SINGLE"].every((s) =>
      classify({ sku: s, name: "Dummy PIDs on the test orders:", categorySlug: "wireless", categoryIsHardware: true }).reason === "name-dummy-pid"));
  check("SABOTAGE ap-pack-option without its C9120 veto takes them",
    ruleMatches({ ...pack, except: [] }, "C9120-MULTI"));
  sabotages += 33;
}
// end wl-uc-class

// ---- EVERY REASON classify() EMITS MUST BE IN RULE_NAMES (12 Sep 2026) -----------------------
// The check that would have caught four unregistered reasons on merge. `ownedReason()` in
// reclassify refuses to correct a row whose reason is not in RULE_NAMES, so a rule added without
// its name there produces rows the table can NEVER correct again. That happened on 10 Sep and left
// 400 tracer SKUs stranded at `license` while classify() called them non_product, and it happened
// again with the fallback-kinds block's four name reasons — caught here rather than in production.
//
// Derived from the SOURCE of productClass.ts, not from a list, so it cannot drift from the thing it
// describes. A family (`stray-device:<kind>`, `datasheet-cell:<shape>`) registers as its bare
// prefix, the form `ownedReason` matches and `category-is_hardware=true` has always used.
{
  const src = fs.readFileSync(new URL("../src/core/productClass.ts", import.meta.url), "utf8");
  const emitted = new Set<string>();
  for (const m of src.matchAll(/reason: "([^"$]+)"/g)) emitted.add(m[1]);
  for (const m of src.matchAll(/reason: `([a-z0-9=_-]+):\$\{/gi)) emitted.add(m[1]);
  const owned = (r: string) => (RULE_NAMES as readonly string[]).some((n) => r === n || r.startsWith(`${n}:`));
  const missing = [...emitted].filter((r) => !owned(r));
  check(`every reason classify() can emit is in RULE_NAMES (${emitted.size} forms) — an unregistered `
      + "reason is a row reclassify can never correct", missing.length === 0, missing.join(", "));
  check("…and the derivation found the reasons at all, rather than passing on an empty set",
    emitted.size >= 10, `found ${emitted.size}`);
}

// ---- THE PARKED-ROW CELL SHAPES: a witness each, and the refusals the narrowing protects -------
// Every SKU is a real live Cisco part. The refusals are the rows a WIDER form of the same shape
// swallowed when it was measured over all 91,543 parts, which is why they are cases and not a note.
{
  const cells: [string, string, string][] = [
    ["1-800-722-2009", "video", "datasheet-cell:phone-number"],
    ["1742.4W", "switches", "datasheet-cell:magnitude-unit"],
    ["0.9-1.6A", "switches", "datasheet-cell:current-range"],
    ["15.1.1T", "routers", "datasheet-cell:ios-release"],
    ["1000BASE-LH", "interfaces-modules", "datasheet-cell:phy-clause-name"],
    ["1.HHHL", "servers-unified-computing", "datasheet-cell:config-cell"],
    ["1-CPU", "hyperconverged-infrastructure", "datasheet-cell:n-noun-cell"],
    ["172.16.20.0/24", "security", "datasheet-cell:ip-subnet"],
  ];
  for (const [sku, cat, reason] of cells) {
    const got = classify({ sku, name: `Cisco ${sku}`, categorySlug: cat, categoryIsHardware: true });
    check(`cell shape: ${sku} is not a product (${reason})`,
      got.klass === "non_product" && got.reason === reason, `${got.klass} / ${got.reason}`);
    seenReasons.add(got.reason);
  }
  // `^\d+\.\d+` for an IOS release caught 435 rows outside the cohort, 77 WITH PHYSICAL FACTS,
  // because a Scientific-Atlanta transmitter's digits after the dot are an ITU CHANNEL — already in
  // CLAUDE.md. `BASE-?[A-Z]` caught real SKUs carrying "BASE" as a word.
  const refusals: [string, string, string][] = [
    ["4022938.58", "video", "an S-A transmitter whose decimals are an ITU channel, not a release"],
    ["4011176.012.000.AB", "video", "the same shape with a longer tail"],
    ["VIP-SFP-1GE-BASET", "interfaces-modules", "a real transceiver with BASE as a word"],
    ["C1-UCD-BASE-K9", "switches", "a real SKU with BASE as a word"],
    ["MC-S-BASE-SM", "optical-networking", "a real part with BASE as a word"],
  ];
  for (const [sku, cat, why] of refusals) {
    const got = classify({ sku, name: `Cisco ${sku}`, categorySlug: cat, categoryIsHardware: true });
    check(`SABOTAGE the cell shapes do NOT take ${sku} — ${why}`,
      !got.reason.startsWith("datasheet-cell:"), `${got.klass} / ${got.reason}`);
  }
  sabotages += refusals.length + 1;
  // THE NAME GATE IS THE OTHER HALF, and it is the guard the UCS cell rule above already relies on:
  // a cell-shaped SKU that HAS acquired a real description is no longer this shape.
  const described = classify({ sku: "1742.4W", name: "Catalyst 9600 1742.4W AC power supply",
    categorySlug: "switches", categoryIsHardware: true });
  check("SABOTAGE a cell-shaped SKU with a REAL description is not taken",
    !described.reason.startsWith("datasheet-cell:"), `${described.klass} / ${described.reason}`);
}

// ---- WITNESSES FOR THE FIVE REASONS THE REGISTRATION CHECK EXPOSED (12 Sep 2026) --------------
// Registering the fallback-kinds block's reasons in RULE_NAMES immediately turned the
// "every rule fired at least once" assertion red for all five: they were emitted by classify() and
// exercised only through `ruleMatches` or the kind path, so no case had ever produced the REASON.
// A rule whose reason nothing asserts is a rule nobody can trace a wrong class back through, which
// is what `parts.product_class_reason` exists for. Every row below is a real live Cisco part found
// by running classify() over the catalogue, not written by hand.
{
  const witnesses: [string, string, string, string][] = [
    ["C890-M5-CPU-BOARD", "Void: Not Used", "servers-unified-computing", "name-marker-not-a-part"],
    ["CBW142A-NA-MULTI", "BOM Level CBW142ACM Bulk PID for A Domain", "wireless", "name-ordering-artefact"],
    ["CTS-NAL-CP-DX70", "DX70 NAL label for China", "collaboration-endpoints", "name-regulatory-label"],
    ["1.DDR4-3200MHz", "Cisco 1.DDR4-3200MHz", "hyperconverged-infrastructure", "ucs-datasheet-cell"],
    // A REAL DEVICE FILED IN A SOFTWARE CATEGORY — the reviewer's §8 point that a device a
    // software-token rule can reach is a device whose kind marker is missing. All three are the
    // physical box: an ASR 9000 line card, a Nexus 9300 and a Wi-Fi 7 access point.
    ["A99-4T-FC", "ASR 9000 4T Flexible Consumption Line Card", "ios-nx-os-software", "stray-device:linecard"],
    ["TA-C93180YC-FX", "Nexus 9300 with 48p 10/25G SFP+, 6p 100G QSFP", "data-center-analytics", "stray-device:switch"],
    ["CW9166D1", "Cisco CW9166D1", "cloud-systems-management", "stray-device:ap"],
    // round-7 ruling C (12 Sep 2026): the bundle plan's leaving families, one real row each, from the frozen
    // reference data/reference/cisco-bundle-rows-2026-09-12.json (bundleFamily.ts bundlePlanClass).
    ["AVIZ-CA300-SW-MS", "Avizia CA300 Multisite Option", "collaboration-endpoints", "bundle-plan:software-subscription"],
    ["EDU-C9800-BNDL", "EDU Bundle for Catalyst 9800 at 50 Percent Off", "wireless", "programme-or-solution-label"],
    ["CESIUM-BM-C220AP", "(Internal Only) Cesium BareMetal 1x 8C, 24GB, 2x900GB", "servers-unified-computing", "not-sellable:self-declared"],
    ["AIR-CT100-1140A30", "802.11a/g/n FCC Cfg5508-100 30AP WCS Demo Promo ends 8/1/10", "wireless", "expired-promotion"],
    ["UCSW-SA-PALET", "UCSW Invicta Unracked Packing Pallet", "servers-unified-computing", "packaging-not-a-product"],
    // phase-1 close §5.5 (13 Sep 2026): the software rows the device-noun read found, one witness per exact rule.
    ["DOCK-LNX-ADV-BC", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-LNX-ADV-BC"],
    ["DOCK-LNX-ADV-BD", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-LNX-ADV-BD"],
    ["DOCK-LNX-BSC-BC", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-LNX-BSC-BC"],
    ["DOCK-LNX-BSC-BD", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-LNX-BSC-BD"],
    ["DOCK-LNX-STD-BC", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-LNX-STD-BC"],
    ["DOCK-LNX-STD-BD", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-LNX-STD-BD"],
    ["DOCK-WIN-ADV-BC", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-WIN-ADV-BC"],
    ["DOCK-WIN-ADV-BD", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-WIN-ADV-BD"],
    ["DOCK-WIN-STD-BC", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-WIN-STD-BC"],
    ["DOCK-WIN-STD-BD", "Docker EE for Server with Support", "servers-unified-computing", "sku-exact:DOCK-WIN-STD-BD"],
    ["UCSC-SWRST", "RAID support for AHCI Capable SAS Controller in Intel RST", "servers-unified-computing", "sku-exact:UCSC-SWRST"],
    ["C9800-CL-K9", "Cisco Catalyst 9800-CL Wireless Controller for Cloud", "wireless", "sku-exact:C9800-CL-K9"],
  ];
  for (const [sku, name, cat, reason] of witnesses) {
    const got = classify({ sku, name, categorySlug: cat, categoryIsHardware: cat !== "ios-nx-os-software" && cat !== "data-center-analytics" && cat !== "cloud-systems-management" });
    check(`reason witness: ${sku} -> ${reason}`, got.reason === reason, `${got.klass} / ${got.reason}`);
    seenReasons.add(got.reason);
  }
}

const stillUntested = RULE_NAMES.filter((r) => ![...seenReasons].some((s) => s === r || s.startsWith(r + ":")));
check(`every rule in the docs/DATA_MODEL.md table fired at least once (${RULE_NAMES.length} rules)`, stillUntested.length === 0, `never fired: ${stillUntested.join(", ")}`);
check("at least 25 real Cisco SKUs are covered", cases.filter((c) => c.sku.trim()).length >= 25);
check("every reason names its rule (non-empty, one of RULE_NAMES)", [...seenReasons].every((s) => RULE_NAMES.some((r) => s === r || s.startsWith(r + ":"))));
console.log(`(rules exercised only by table shapes, no real PID yet: ${untested.length ? untested.join(", ") : "none"})`);

console.log(`\nproductClass: ${pass} passed, ${misses.length} missed (${sabotages} sabotage cases)`);
if (misses.length) process.exit(1);
