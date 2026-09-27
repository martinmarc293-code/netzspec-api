# `amplifier` is not a split: 88 of 88 video "amplifiers" are OPTICAL, and video already has the RF kind

**27 Sep 2026.** The B ruling made `amplifier` one of four kind splits: *"optical-amplifier (EDFA,
optical-networking: gain, wavelength band, power_max) and rf-amplifier (video already has it: rf_gain,
passband). The optical parts move by partKind rule; the profile moves with them."*

The premise is that video's `amplifier` rows are RF amplifiers. **They are optical amplifiers**, and
video already carries a separate `rf-amplifier` kind for the RF ones. So there is nothing to split:
`amplifier` means the same physical object in both categories, which makes it a **case D row** — a
profile edited in one place — not a case B.

## The measurement

Spread-sampled rather than head-sampled, because both lists are ordered by SKU and a head sample is one
product family — and because the verifier prints only ONE witness per side, which is what made the
premise plausible.

| population | rows | names reading OPTICAL | names reading RF |
|---|---|---|---|
| `video` / `amplifier` | 88 | **88** | **0** |
| `optical-networking` / `amplifier` | 70 | 61 | 0 |
| `video` / `rf-amplifier` | 51 | 0 | 30 |

    video/amplifier               4000770   (P2-EDFA-FPST-4X17-SA) Opt Post Amp, 4/17dBm, Cnstnt Unfrmty, SA
                                  4027010   GS7000 EDFA, Gain Flattened Low, 17dBm, SA
                                  4036055   (P2-EDFA-MOD-1x17-SA) 1550 EDFA Opt Amp, 17dBm, SA
    optical-networking/amplifier  15216-EDFA1=      Metro Erbium-Doped Fiber Amplifier 17 dBm
                                  15454-OPT-PRE     ONS 15454 Optical Pre-Amplifier Module
                                  NCS1K-ILA-R-C=    NCS 1010 In-Line Amplifier with 1x Raman - C-band
    video/rf-amplifier            4003776           (P2-HEDA-R w/CCB) Rev HEDA, 5-200MHz, CCB
                                  GS7K-LA-4052=     GS7000 LNCH AMP, 4W, 40/52
                                  GS7K-SHO-LA85102  GS7K SHO Launch Amp 1.2 GHz 85/102 MHz

`video` is the cable-access category, which carries the optical transport of an HFC plant — EDFAs in
one kind and RF launch amplifiers in another. The RF split it already has is the one the ruling
proposed to create.

## So the cup divergence means the opposite of what it looked like

The parity test reported: `tx_power` asked by video and not optical-networking; `power_max` and
`product_compatibility` asked by optical-networking and not video. Read as two devices that is a
distinction. Read as **one** device it is the D principle exactly — and the evidence is in the names:
every video row states its output in **dBm** (`17dBm`, `20/18.5dBm`, `4/17dBm`), which is `tx_power`.
An optical amplifier has an output power whichever category it is filed under, and it has a power draw
and a compatibility list too.

So `amplifier` joins the 22-row table as a 23rd row, both ways:

| kind | category | cups it is not asked | rows |
|---|---|---|---|
| `amplifier` | optical-networking | `tx_power` | 70 |
| `amplifier` | video | `power_max`, `product_compatibility` | 88 |

That is a two-way widening, which the existing applier already handles — `alsoAskedOf` widens whatever
was there, so a cup required of `amplifier` in one category and absent in the other is the same
operation as every other row.

## B is three splits, and the other three survived the same check

Checked in both directions, because a split I was confident about is exactly where I would not look:

* **camera** — collaboration-endpoints is `Cisco Desk Camera 4K`, `PTZ 4K Camera`, `Quad Camera`,
  `Precision 40 Camera with 8x zoom`; meraki is `MV12`, `MV23`, `MV53X-HW`, `MV72`. Conferencing
  against surveillance. **Split.**
* **gateway** — unified-communications is `8-Port IP Telephony Gateway`, `PBX-IP Media Gateway-Digital`,
  `T1 IP-Media Gateway`, `VG400 Analog Voice Gateway with 6 FXS and 6 FXO`; meraki is `MG21`, `MG41`,
  `MG41E-HW Meraki MG41 Cellular Gateway`. Voice against cellular. **Split.**
* **sensor** — wireless is 15 × `Cisco Aironet 1800S Series Network Sensor`; meraki is `MT10`…`MT20`.
  Wi-Fi monitoring against environmental. **Split**, as the reviewer ruled after the earlier hold.

## The general point, and it is the same one twice tonight

The verifier prints ONE witness per side of a divergence, because a line has to fit on a line. A witness
is enough to recognise a divergence and not enough to classify it, and the two mistakes it invites are
opposite: `sensor` looked like a misclassification and is a real split; `amplifier` looked like a real
split and is a profile gap. Both were settled by reading the whole population, and in both cases the
single witness was a true statement that pointed the wrong way.
