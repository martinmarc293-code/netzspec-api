// lib/familyProse.ts — canonical German family prose (block 6), keyed by the canonical family
// string (Cycle 4 §0.2). SINGLE SOURCE: docs/family-prose-review.md mirrors this for operator
// review; data/reviewed-families.json gates whether a family counts toward c5. The page renders
// the prose for any family present here (stub or promoted); indexing is gated separately.
export const familyProse: Record<string, string> = {
  "Cisco Catalyst 2960":
    "Die Cisco Catalyst 2960 Serie war über viele Jahre der Standard-Zugangs-Switch im Enterprise- und Filialumfeld. Die Layer-2-Geräte boten Fast-Ethernet- und Gigabit-Ports in Dichten von 8 bis 48, wahlweise mit PoE/PoE+, verwaltet über Cisco IOS mit den Lizenzstufen LAN Base und LAN Lite. Die Serie hat den End-of-Sale erreicht; Cisco benennt die Catalyst 1000 und Catalyst 9200 Serie als Nachfolger. Die pro Modell verifizierten Lifecycle-Termine sind für die Ersatzteil- und Migrationsplanung maßgeblich.",
  "Cisco Catalyst 2960-X":
    "Die Cisco Catalyst 2960-X und 2960-XR Serie erweiterte die klassische 2960-Linie um FlexStack-Plus-Stapelung, höhere Gigabit-Portdichte und 10-Gigabit-Uplinks. Typische Modelle bieten 24 oder 48 GigE-Ports mit PoE+; die XR-Variante ergänzt redundante Netzteile und erweiterte Layer-3-Funktionen. Die Serie lief unter Cisco IOS und hat den End-of-Sale erreicht; Nachfolger ist die Catalyst 9200 Serie.",
  "Cisco Catalyst 2960-L":
    "Die Cisco Catalyst 2960-L Serie ist eine kompakte, teils lüfterlose Gigabit-Zugangs-Reihe für kleine Standorte und Arbeitsgruppen. Die Layer-2-Geräte bieten 8 bis 48 GigE-Ports, viele mit PoE+, sowie SFP-Uplinks, verwaltet über Cisco IOS (LAN Base). Die Serie hat den End-of-Sale erreicht; Cisco führt die Catalyst 1000 und 9200 Serie als Nachfolger.",
  "Cisco Catalyst 2960-CX":
    "Die Cisco Catalyst 2960-CX Serie umfasst besonders kompakte, lüfterlose Layer-2-Zugangs-Switches für Deployments mit wenig Platz. Die Geräte bieten typischerweise 8 GigE-Ports mit PoE/PoE+ und Uplink-Ports zur Verteilebene. Die Serie hat den End-of-Sale erreicht; als Nachfolger dienen die kompakten Modelle der Catalyst 9200CX Familie.",
  "Cisco Catalyst 3560-X":
    "Die Cisco Catalyst 3560-X Serie war ein eigenständiger Layer-3-Zugangs-Switch für den Enterprise-Campus. Die Geräte boten 24 oder 48 GigE-Ports mit PoE/PoE+, modulare Uplink-Module (bis 10G) und redundante Netzteile, mit vollem Layer-3-Funktionsumfang (IP Base/IP Services) unter Cisco IOS. Die Serie hat den End-of-Sale erreicht; Nachfolger ist die Catalyst 9300 Serie.",
  "Cisco Catalyst 3560-CX":
    "Die Cisco Catalyst 3560-CX Serie kombiniert einen kompakten, lüfterlosen Formfaktor mit vollem Layer-3-Funktionsumfang. Ausgewählte Modelle unterstützen Perpetual PoE und PoE-Pass-Through. Die Serie hat den End-of-Sale erreicht; als Nachfolger dient die kompakte Modellreihe der Catalyst 9300 Familie.",
  "Cisco Catalyst 3750-X":
    "Die Cisco Catalyst 3750-X Serie war ein stapelbarer Layer-3-Zugangs-Switch, der über StackWise Plus mehrere Einheiten zu einem logischen Switch verband und mit StackPower die Stromversorgung im Stapel teilte. Die Geräte boten 24 oder 48 GigE-Ports mit PoE/PoE+, modulare Uplink-Module und redundante Netzteile. Die Serie hat den End-of-Sale erreicht; Nachfolger ist die Catalyst 9300 Serie.",
  "Cisco Catalyst 3650":
    "Die Cisco Catalyst 3650 Serie war ein stapelbarer Layer-3-Zugangs-Switch der ersten UADP-Generation und brachte konvergentes kabelgebundenes und drahtloses Management an die Zugangsschicht. Über StackWise-160 ließen sich mehrere Einheiten stapeln; viele Modelle boten PoE+ und optional mGig-Ports. Die Serie lief unter Cisco IOS XE und hat den End-of-Sale erreicht; Nachfolger ist die Catalyst 9300 (insbesondere 9300L) Serie.",
  "Cisco Catalyst 3850":
    "Die Cisco Catalyst 3850 Serie war der leistungsstärkere stapelbare Layer-3-Zugangs-Switch der UADP-Generation und die Schwester der 3650er. Über StackWise-480 bot sie hohe Stapelbandbreite, per StackPower das Teilen der Stromversorgung; viele Modelle unterstützten mGig sowie 10G-Uplinks über modulare Netzwerkmodule. Die Serie lief unter Cisco IOS XE und hat den End-of-Sale erreicht; Nachfolger ist die Catalyst 9300 Serie.",
  "Cisco Catalyst 4500-X":
    "Die Cisco Catalyst 4500-X Serie war eine kompakte, feste Aggregations-Plattform für den Campus-Kern und die Verteilebene. Die Geräte boten hohe 10-Gigabit-Portdichte, optionale 40G-Uplinks und ließen sich über Virtual Switching System (VSS) zu einem logischen Gerät koppeln. Die Serie hat den End-of-Sale erreicht; Nachfolger ist die Catalyst 9500 Serie.",
  "Cisco Catalyst 1000":
    "Die Cisco Catalyst 1000 Serie ist eine Zugangs-Switch-Familie für kleine und mittlere Unternehmen mit festem Formfaktor und einfachem Betrieb. Die Layer-2-Geräte bieten Fast-Ethernet- oder Gigabit-Ports in Dichten von 8 bis 48, viele mit PoE+, sowie SFP/SFP+-Uplinks; ausgewählte Varianten sind lüfterlos. Für Teile der Reihe hat Cisco End-of-Sale-Termine veröffentlicht.",
  "Cisco Catalyst 9200":
    "Die Cisco Catalyst 9200 Serie ist die Einstiegsklasse der Catalyst-9000-Familie für den Enterprise-Zugriff. Die Modelle bieten 24 oder 48 Gigabit-Ports, wahlweise mit PoE+, und je nach Ausführung 1G- oder 10G-SFP+-Uplinks. Die L-Varianten (9200L) sind auf feste Uplinks und reduzierten Layer-3-Funktionsumfang ausgelegt. Alle Geräte laufen unter Cisco IOS XE, unterstützen StackWise-Stapelung und lassen sich über Cisco Catalyst Center zentral verwalten.",
  "Cisco Catalyst 9300":
    "Die Cisco Catalyst 9300 Serie ist Ciscos führende stapelbare Zugangs-Switch-Familie und die leistungsstärkere Schwester der 9200er. Modelle bieten 24 oder 48 Ports in Gigabit- oder Multigigabit-Ausführung, viele mit PoE+ oder UPOE. Modulare Uplink-Einschübe erlauben Bandbreiten bis 25G/40G; StackWise und StackPower ermöglichen Hochleistungs-Stapelung. Die Geräte laufen unter Cisco IOS XE und unterstützen Cisco Catalyst Center sowie programmierbare Schnittstellen.",
  "HPE Aruba 2930F":
    "Die HPE Aruba 2930F Serie ist eine Layer-3-Lite-Zugangs-Switch-Familie für kleine und mittlere Unternehmen sowie Zweigstellen. Modelle reichen von 8 bis 48 Gigabit-Ports, viele mit PoE+, mit 1G- oder 10G-SFP/SFP+-Uplinks. Die Serie läuft unter ArubaOS-Switch, unterstützt VSF-Stapelung und lässt sich über Aruba Central verwalten.",
  "HPE Aruba CX 6300M":
    "Die HPE Aruba CX 6300M Serie gehört zur modernen CX-Familie und richtet sich an leistungsfähigen Zugriff sowie kompakte Aggregation. Sie läuft unter ArubaOS-CX mit vollständiger API-Steuerung; Modelle bieten 24 oder 48 Gigabit-/Multigigabit-Ports und 25G/50G-Uplinks (SFP56). Die M-Modelle verfügen über modulare, im Betrieb tauschbare Netzteile und Lüfter und unterstützen VSF-Stapelung.",
  "HPE Aruba CX 6200F":
    "Die HPE Aruba CX 6200F Serie ist die Einstiegsklasse der ArubaOS-CX-Familie für den einfachen, abgesicherten Campus-Zugriff. Modelle reichen von 8 bis 48 Gigabit-Ports, viele mit PoE+, mit typischerweise vier SFP+-Uplinks bis 10G. Über VSF lassen sich mehrere Geräte stapeln; ausgewählte Varianten sind lüfterlos.",
};
