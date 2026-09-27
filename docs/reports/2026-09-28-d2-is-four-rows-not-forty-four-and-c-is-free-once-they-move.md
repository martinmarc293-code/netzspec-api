# D2 is four rows, not forty-four — the move already happened, and C is free once they go

**28 Sep 2026.** The instruction was: *"Do the D2 plans now: SKU rules for security's 44 appliance parts
into firewall / ips / email-gateway / web-gateway / management (and these four into module / server),
dry-run counts printed, then C."*

Measured before writing a plan, because a plan built on the wrong denominator is the shape this repo
keeps paying for:

    security + sku_kind = appliance :  4 rows.  hardware 4, retired 0, non-hardware 0.

There is no 44. **The move D2 describes has already run.** The security axis classifies the rest today:

    firewall 468 · analytics 214 · security-module 88 · management 81 · ips 60 · web-gateway 37
    email-gateway 35 · identity 32 · nic 39 · storage-controller 39 · memory 60 · cpu 53 · cable 3
    appliance 4

So the whole of D2 is a **four-row residue**, and every one of the four is a misclassification rather
than an appliance:

| SKU | series | what it is | proposed |
|---|---|---|---|
| `ASA-SSC-AIP-5-K9=` | Security Modules for Secure… | an ASA 5500 **AIP-SSC card** | `security-module` (holds 88) |
| `NAM2420-K9` | Services Modules | Network Analysis Module 2420 | `analytics` or `security-module` — **needs a call** |
| `NAM2440-K9` | Services Modules | Network Analysis Module 2440 | same |
| `TG5500-C220M3S-K9` | UCS C-Series | a **UCS C220 M3** ThreatGrid appliance | `server` |

Two are unambiguous. The two NAMs are not, and I am not guessing: `analytics` (214 parts) and
`security-module` (88) both exist and both are defensible — Cisco sells the NAM 2400 as a rack
appliance *and* files it under "Services Modules", which is the series these rows carry. One call from
whoever owns the security axis settles it.

## Why this makes C free rather than merely unblocked

C was held because requiring `firewall_throughput`, `ipsec_throughput`, `tls_throughput` and
`threat_throughput` of a card, two service modules and a ThreatGrid server is ~32 wrong demands. Once
the four move, **`appliance` in `security` holds ZERO parts** — so the requirement has nothing left to
be wrong about. C stops being a trade-off and becomes a no-op on the data plus a correction to the
profile: the cups drop their series gate and are simply required of `appliance`, which is what a Meraki
MX is asked, and no live part changes its score.

That is a better position than the ruling assumed, and it comes from the population being 4 rather than
44. The order still holds — the four move first — but the second step costs nothing.

## The 88 `security-module` rows are worth one look while someone is here

The AIP-SSC card belongs with them, which raises the obvious question about the reverse direction: are
any of the 88 whole appliances filed as modules? Not measured, and not this report's claim — recorded
only because the same axis produced both and one pass over its 88 rows would answer it.
