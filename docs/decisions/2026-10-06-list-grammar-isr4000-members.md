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
