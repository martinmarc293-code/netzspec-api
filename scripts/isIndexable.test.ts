// Unit tests for isIndexable() — run: npx tsx scripts/isIndexable.test.ts
import { isIndexable, type IndexPart } from "../lib/isIndexable";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); }
}

// A fully-complete part (all 7 conditions pass), with reviewed prose for its family.
const full: IndexPart = {
  sku: "C9200-24T", family: "Cisco 9200 Switches",
  provenance: { source_url: "https://cisco.com/ds.html", verified_at: "2026-08-28" },
  i18n: { de: {
    attributes: Array.from({ length: 12 }, (_, i) => ({ name: `attr${i}`, value: `24 Gigabit ${i}` })),
    faq: [
      { q: "Ports?", a: "Der C9200-24T hat 24 Gigabit-Ports." },
      { q: "Layer?", a: "Der C9200-24T ist ein Layer-3-Switch." },
      { q: "PoE?", a: "Nein." },
    ],
  } },
  lifecycle: { status: "active", source_url: "https://cisco.com/eol-list.html", successor_sku: "C9300" },
  compat: [{ relation: "vendor_verified", source_url: "https://cisco.com/tmg.html" }],
  reviewedProse: true,
};

check("full part is indexable", isIndexable(full).ok === true);

// one fixture per failing condition
const drop = (mut: (p: IndexPart) => void, cond: string) => {
  const p: IndexPart = JSON.parse(JSON.stringify(full));
  mut(p);
  const r = isIndexable(p);
  check(`fails ${cond}`, r.ok === false && r.failing.includes(cond));
};
drop((p) => { p.provenance = {}; }, "c1");
drop((p) => { p.i18n!.de!.attributes = p.i18n!.de!.attributes!.slice(0, 5); }, "c2");
drop((p) => { p.lifecycle = {}; }, "c3");
drop((p) => { p.compat = []; p.lifecycle = { status: "active", source_url: "x" }; }, "c4"); // no vendor-verified, no successor
drop((p) => { p.reviewedProse = false; p.family = "Unreviewed Family"; }, "c5");
drop((p) => { p.i18n!.de!.faq = [{ q: "?", a: "generic" }]; }, "c6");
drop((p) => { p.provenance = { source_url: "https://cisco.com/ds.html", verified_at: "2026-08-28" }; p.lifecycle = {}; p.compat = []; }, "c7");

// c4 STRICT — form-factor must NOT satisfy c4 (only vendor_verified or successor)
const ffOnly: IndexPart = JSON.parse(JSON.stringify(full));
ffOnly.compat = [{ relation: "form_factor", source_url: "" }];
ffOnly.lifecycle = { status: "active", source_url: "x" }; // no successor
check("c4 strict: form-factor does NOT pass c4", isIndexable(ffOnly).failing.includes("c4"));

// c5 via reviewedFamilies set (not the flag)
const viaSet: IndexPart = JSON.parse(JSON.stringify(full));
viaSet.reviewedProse = false;
check("c5 via reviewedFamilies set", isIndexable(viaSet, { reviewedFamilies: new Set(["Cisco 9200 Switches"]) }).ok === true);

console.log(`\nisIndexable tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
