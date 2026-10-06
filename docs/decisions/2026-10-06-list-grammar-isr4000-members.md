# The list grammar reads run 1495's new members; the residue stays unclassified (6 Oct 2026)

**Ruling (reviewer, 6 Oct ~07:35 UTC):** "CLASSIFY, DON'T RAISE THE CEILING: read the +98 supported_protocols / +4
certifications members -- real identifiers -> extend the grammar (listShapes), junk -> refuse; the ceiling moves only if a
residue remains with a named reason."

**Measured.** Run 1495 (the ISR 4000 sheet c78-732542 and its serial NIMs) put the cisco unclassified ratchet over its
ceiling: supported_protocols 3,195 > 3,097, certifications 1,926 > 1,922. The 102 new member occurrences, read in full:

| member | n | verdict | why |
| --- | --- | --- | --- |
| `Frame Relay`, `static routes` | 16 + 16 | accept (`PROTOCOL_NAMED_6OCT`) | a WAN protocol and a routing method the router sheet names in words |
| `EIA-232`, `EIA-449`, `EIA-530`, `EIA-530A`, `V.35`, `X.21` | 3 each | accept (`SERIAL_STANDARD_6OCT`) | serial standards on NIM-1T/2T/4T, ITU-T V/X series written without "ITU-T" |
| `T1 IC CS-03:2004` | 4 | accept (`CERT_IC_CS03_6OCT`) | Industry Canada CS-03, declared for the T1 interface |
| `Border Gateway` | 16 | **residue, unclassified** | the 160-character cap: the Protocols row is comma-delimited, so the extractor's list test (two bullets or two standards prefixes) reads it as a scalar and keeps 160 of ~800 characters |
| `Routing Information Protocol Versions 1`, `2 (RIP and RIPv2)` | 16 + 16 | **residue, unclassified** | the splitter's cut through "Versions 1 and 2 (RIP and RIPv2)" |

Nothing was junk in the refuse sense (no prose, no heading), so nothing was refused.

**Whole-member rules, so no stored value moves.** `reshapeList` keeps an accepted member and an unclassified one alike, so a
member that goes from unclassified to accept changes no normaliser output and NORM_VERSION stays 1.8.8. Before/after over every
vendor's live members (59,820 occurrences): the only flips are cisco supported_protocols unclassified -> accept 133 and cisco
certifications unclassified -> accept 4 (the older occurrences of the same members count too). Cisco unclassified becomes
supported_protocols **3,062** (ceiling 3,097) and certifications **1,922** (ceiling 1,922): the ratchet is green with the
ceiling untouched. The mould contract hash is unchanged (201b779a47640e74): it pins the shapes' accept/flagged/refuse sources,
not the extraction rules.

**Proof.** tests/listShapes.test.ts 75/0: each witness accepted in its own cup, the three residue members stay unclassified, and
four sabotage/scope cases. Sabotaged: dropping the whole-member anchor turns 1 case red; removing the protocol hook 8; removing
the certifications hook 1; restored by hash.

**Found on the way, not acted on (routers):** the 160 cap on comma-delimited list cells truncates every router Protocols and
Encapsulations row read this way (ISR 4000: BGP, IS-IS, IGMPv3, PIM, MPLS, L2TPv3, BFD, HDLC, PPPoE and the serial standards
are all past character 160), and `Multilink` -- the cut tail of "Multilink Frame Relay (MLFR)" -- is *accepted* by the loose
token rule. The fix belongs in the extractor's list test (a comma-dense cell under a list label is a list); it is a gate
contract change ("move one, move both", gate-extract.ts cellMatches), so it goes to the reviewer first.

## Addendum, 6 Oct 2026 evening: (A)'s classify pass (GRAMMAR_6OCT_B)

**Ruling (reviewer, ~17:20):** "build with the sabotage cases → fix the 7 gate misses → classify the recovered members (no ceiling
raise) → re-apply the router corpus." (The "7 gate misses" were the Q2 measurement's own: it re-read joined values whole, where the
real gate expands a joined record into its cells first; re-measured that way, 769 of 769 changed cells re-read clean.)

**Measured.** Keeping comma cells whole (cisco_specs_deep, COMMA_LIST_MIN_ITEMS 5) recovered 55 distinct list members the grammar left
unclassified over the 455 router documents (334 protocol + 7 certification occurrences). Read in full:

- **Read now (whole members, one witness each, `GRAMMAR_6OCT_B`):** BGP Router Reflector, Call Home, IP sec, Cisco Discovery Protocol,
  split DNS, syslog, NAT/PAT, NAT pools, NAT traversal, static NAT, symmetric NAT, OTV (under its footnote marker "[6]"), DHCP/DNS in
  a stated role (client / server / relay), IGMP with its versions, Layer 3 VPN / L3 VPN, "Serial (RS-232, RS-449, X.21, V.35, and
  EIA-530)", "Multilink Frame Relay (MLFR) (FR.15 and FR.16)"; for certifications, a standard behind an edition note or a Class
  qualifier the splitter left at its front ("Third Edition EN 62368-1: 2020", "Class A EN/IEC 61000-3-3/3-11 ...").
- **Residue, unclassified with its cause (`RESIDUE_6OCT_B`):** "Layer 2" (the splitter's cut through "Layer 2 and Layer 3 VPN"), QoS
  mechanism words (classification, shaping, policing ...), SD-WAN feature names (zero-trust, whitelisting ...), a section heading
  ("Routing Protocols"), two fused space-separated runs, edition fragments ("Third Edition" alone).

**The guard the measurement forced.** The certification head rule first flipped ONE aruba member from refuse to accept ("Class A EN
55035 ... part 15 subpart B"): a refused member is dropped and salvaged by reshapeList, so that flip would have moved a stored value in
another lane. A member the prose rule refuses now keeps that verdict; the suite holds the aruba member refused (removing the guard
turns that case red).

**All-vendor before/after (59,820 member occurrences):** the only flips are unclassified -> accept -- cisco supported_protocols 122,
hpe certifications 93, aruba certifications 35. No refused or flagged member changes verdict, so no stored value moves anywhere and
NORM stays 1.8.8. Cisco unclassified supported_protocols 3,062 -> 2,940 before the re-apply; the hpe and aruba lines only fall.

**Proof.** tests/listShapes.test.ts 110/0: 24 witnesses accepted, the residue held unclassified, sabotage on whole-member reading, an
unnamed role, a non-serial Serial group, a footnote on a non-name, scope, and the aruba guard. Sabotage: the protocol hook removed ->
22 witness cases red; the prose guard removed -> exactly the aruba case red; restored by md5 each time.

**Extended after the fact-weighted forecast (same evening).** Planning the router re-apply itself (scripts/q2-ratchet-forecast.mts:
current facts of the same document replaced by what the plan offers, store refusals excluded) showed certifications +20 -- four
members, five parts each, the record-weighted count had not seen. Each is a real standard in a form the grammar missed: "TIA/EIA/
IS-968 ..." (a triple issuer), "G.824 IEEE 802.3 RTTE Directive" (the second half of "ITU-T G.823, G.824"), "Designed to meet
GR-63-CORE" (a prose lead-in), "CFR Part 15:2016" ("47 CFR Part 15" whose 47 the run splitter peeled off). CERT_FRONT_6OCT_B and the
lead-in on CERT_HEAD_6OCT_B read them, behind the same prose guard. All-vendor before/after: still only unclassified -> accept --
cisco protocols 122, cisco certifications 67, hpe certifications 93, aruba certifications 35; cisco now 2,940 / 1,855 against
ceilings 3,062 / 1,922. Forecast for the re-apply: certifications net 0, protocols net +4 ("Layer 2" +16 where the "Border Gateway"
stump -16 goes). Suite 114/0; the front rule removed -> its 3 witnesses red.

**GRAMMAR_6OCT_C -- the re-apply's classify pass (same day, ~22:00 UTC).** Run 1514's router re-apply left 95 member forms
unclassified that are real identifiers, read in full: 45 protocol names written out whole ("Link Aggregation Control Protocol
(LACP): IEEE 802.3ad", "One-to-one NAT", "Segment Routing"), 22 certifications ("UL/CSA/IEC/EN 60950-1", "ACA TS001", "FIPS
140-2"), 5 EMC standards ("AS/NZ CISPR32", "47 CFR FCC Part 15B"), and a region label in front of a standard ("USA: UL 60950-1").
The rule is EXACT whole members for the three lists (a near miss keeps its answer -- 'DNS proxies' and 'ACA TS0011' are cases),
and for the region label: strip it and read what follows, behind the same refusal guard as the Class heads. Residue that stays
unclassified is named in RESIDUE_6OCT_C with its cause.

All vendors, every live fact (65,308 member-occurrences): 95 forms flip, every one unclassified -> accept -- cisco protocols 389,
certifications 515, emc 8; hpe certifications 35; aruba certifications 19; arista protocols 1. No stored value moves (an accepted
and an unclassified member are kept alike by reshapeList; NORM stays 1.8.8). Cisco now: certifications 1,710 (from 2,225), emc 64
(72), protocols 2,856 (3,245); the ceilings are lowered to those counts.

**One ceiling RISES, with its named reason:** ieee_standards 16,829 -> 16,839, for 'SNMP v1, v2c, and v3' and 'SNMPv1, v2c, and
v3' -- a protocol a sheet's Standards row lists, filed under ieee_standards by run 1514. An IEEE grammar must not read SNMP, so it
stays unclassified (RESIDUE_6OCT_C), per the 07:35 ruling "the ceiling moves only if a residue remains with a named reason".

Sabotage, each hook removed in turn and restored by md5: protocol exact -> 45 red, emc exact -> 5, certification exact -> 23 (the 22
plus the 'Canada:' region case, whose remainder is an exact member), region strip -> 3. **The region strip's refusal guard first
went 0 red**: the hand-written fixture ("USA: Class A EN 55035 ...") was refused by the Class-head block below, so it never reached
this guard. The all-vendor flip run with the guard removed found the member that does need it -- an aruba cell (4 facts) beginning
"Europe: EN 62368-1:2014 +A11:2017 2nd Ed. ...", refused as prose, which flips refuse -> accept (a stored value would move). That
real member is now the case, and removing the guard turns exactly it red. Suite 210/0.
