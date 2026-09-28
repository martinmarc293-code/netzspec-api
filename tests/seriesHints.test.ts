// tests/seriesHints.test.ts — rulings 5a/5b on live series facts; every case is a real row shape. Decision:
// docs/decisions/2026-09-28-series-hints-decomposed.md
import { classifySeriesHint, type SeriesHintRow } from "../src/core/seriesHints.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => { if (ok) pass++; else misses.push(`${name}: got ${JSON.stringify(got)}`); };
const row = (o: Partial<SeriesHintRow>): SeriesHintRow =>
  ({ value: "", productClass: "hardware", kind: "fc-switch", series: null, productSeries: null, ...o });
const MDS9100 = "MDS 9100 fabric switches (9124 / 9132T / 9134 / 9148 / 9148S / 9148T / 9148V)";

const lic = classifySeriesHint(row({ value: "MDS9300", productClass: "license", kind: null, series: "MDS 9000 NX-OS and SAN-OS Software" }));
check("5a a licence naming its platform relates license_for, spelling canonical",
  lic.action === "relate+retract" && lic.relation.kind === "license_for" && lic.relation.to === "MDS 9300", lic);
const umb = classifySeriesHint(row({ value: "Cisco MDS 9000", productClass: "software", kind: null }));
check("5a the MDS 9000 umbrella is still a platform for software", umb.action === "relate+retract" && umb.relation.to === "MDS 9000", umb);
check("NEGATIVE 5a a licence naming no platform parks",
  classifySeriesHint(row({ value: "NX-OS 9.3", productClass: "license" })).action === "park");

const mem = classifySeriesHint(row({ value: "MDS 9148S", series: "MDS 9100 Series Multilayer Fabric", productSeries: MDS9100 }));
check("5b a chassis its series lists retracts", mem.bucket === "chassis-member" && mem.action === "retract", mem);
check("NEGATIVE 5b a chassis the list omits parks (MDS 9124V)",
  classifySeriesHint(row({ value: "MDS 9124V", productSeries: MDS9100 })).action === "park");
check("NEGATIVE 5b membership is by exact model: 9148 is not 9148S",
  classifySeriesHint(row({ value: "MDS 9148", productSeries: "MDS 9100 fabric switches (9148S / 9148T)" })).action === "park");

const psu = classifySeriesHint(row({ value: "MDS 9506", kind: "power", series: "MDS 9500 Series Multilayer Directors" }));
check("5b a PSU naming its host chassis relates compatible",
  psu.action === "relate+retract" && psu.relation.kind === "compatible" && psu.relation.to === "MDS 9506", psu);
check("NEGATIVE 5b a linecard naming only the MDS 9000 umbrella parks",
  classifySeriesHint(row({ value: "MDS 9000", kind: "linecard" })).action === "park");
check("NEGATIVE hardware with no kind parks (chassis or not is unknown)",
  classifySeriesHint(row({ value: "MDS 9148S", kind: null, productSeries: MDS9100 })).action === "park");

if (misses.length) { console.log(`series hints: ${pass} passed, ${misses.length} missed`); for (const m of misses) console.log(`  MISS ${m}`); process.exit(1); }
console.log(`series hints: ${pass} passed, 0 missed (5a licence->platform, 5b chassis-member / host-chassis, 6 refusals)`);
