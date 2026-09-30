// tests/shippingClass.test.ts — FINAL FILL ORDER item 4 (30 Sep 2026): the shipping-class table, its replay, and the ONE place
// shop_ready accepts a Versandgewicht in place of a measured weight (a kind the table lists, and only that).
import { shippingClassOf, shippingClasses, shippingClassRaw, shippingFromClassRaw } from "../src/core/shippingClass.js";
import { replayDerived } from "../src/core/derivedReplay.js";
import { shopReady, type PartView, type Fact } from "../src/core/jtlExport.js";
import { LEDGER_KINDS } from "../src/core/cupLedger.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else misses.push(`${name}\n      got  ${g}\n      want ${w}`);
};

// ---- the table ------------------------------------------------------------------------------------------------------------
const rows = shippingClasses();
check("the table holds 26 rows: the 28 pairs the prediction counted, less the two excluded after reading their rows", rows.length, 26);
check("every row names a (category, kind) some ledger holds -- a typo would be a row that can never match",
  rows.filter((r) => !(LEDGER_KINDS[r.category] ?? []).includes(r.kind)).map((r) => `${r.category}/${r.kind}`), []);
check("a switch fan is XL, 5 kg (measured p90 4.4 kg, rounded up)", [shippingClassOf("switches", "fan")?.tier, shippingClassOf("switches", "fan")?.kg], ["XL", 5]);
check("a router fan tray is XXL, 15 kg (measured p90 12.2 kg): NOT a small parcel", shippingClassOf("routers", "fan")?.kg, 15);
check("a switch is not a small component", shippingClassOf("switches", "switch"), null);
check("a chassis is not a small component", shippingClassOf("switches", "chassis"), null);
check("an unknown kind is not a small component", shippingClassOf("switches", undefined), null);

// ---- the replay the census and the completeness report use -----------------------------------------------------------------
const fan = shippingClassOf("switches", "fan")!;
check("the raw names the class and its tier", shippingClassRaw(fan), "shipping class switches/fan: tier XL = 5 kg");
check("the raw replays to the tier's kg", shippingFromClassRaw(shippingClassRaw(fan)), 5);
check("REPLAY: the registered derivation reproduces it", replayDerived("derived:shipping-class", shippingClassRaw(fan)), null);
check("SABOTAGE: a raw whose class the table has moved to another tier is refused (stale, re-derive)",
  shippingFromClassRaw("shipping class switches/fan: tier S = 0.5 kg"), null);
check("SABOTAGE: a class the table does not list is refused", shippingFromClassRaw("shipping class switches/switch: tier S = 0.5 kg"), null);
check("REPLAY SABOTAGE: an unreadable raw is refused through the registry", replayDerived("derived:shipping-class", "about 1 kg")?.reason, "DERIVATION_REFUSED");

// ---- shop_ready: the Versandgewicht counts for a listed kind only -----------------------------------------------------------
const facts = (o: Record<string, [unknown, string | null]>): Map<string, Fact> => new Map(Object.entries(o).map(([k, [value, unit]]) => [k, { value, unit }]));
const base: PartView = { sku: "C3850-FAN-T1=", name: "Cisco Catalyst 3850 Fan Module", nameState: "real", slug: "c3850-fan-t1", category: "switches",
  categoryDe: "Switches", kind: "fan", series: "Catalyst 3850", subBrand: null, deployRole: null, facts: new Map(), required: new Set() };
const why = (p: PartView) => shopReady(p).reasons.includes("weight");
check("a fan with a Versandgewicht and no Artikelgewicht is NOT blocked on weight", why({ ...base, facts: facts({ shipping_weight: [5, "kg"] }) }), false);
check("CONTROL: the same fan with neither is blocked on weight", why(base), true);
check("CONTROL: a measured weight still satisfies it, as before", why({ ...base, facts: facts({ weight: [2.6, "kg"] }) }), false);
check("SABOTAGE: a SWITCH with only a Versandgewicht is still blocked on weight (devices need a measured weight)",
  why({ ...base, sku: "C9200-24P", kind: "switch", facts: facts({ shipping_weight: [7, "kg"] }) }), true);

const TOTAL = 17;
if (misses.length || pass !== TOTAL) {
  for (const m of misses) console.log(`  MISS ${m}`);
  console.error(`\n${pass}/${TOTAL} shipping-class cases passed${pass + misses.length !== TOTAL ? ` (ran ${pass + misses.length}, expected ${TOTAL})` : ""}.`);
  process.exit(1);
}
console.log(`${pass}/${TOTAL} shipping-class cases passed`);
