// src/core/docSubject.ts — the SUBJECT of a document: the kinds of product it DESCRIBES (reviewer ruling (b'), 2 Oct 2026).
//
// A document-scoped fact (a value the document states once for the whole document, inherited into the SKUs it lists) may only
// reach a part whose kind is a SUBJECT kind. Being LISTED is being compatible, never being described: a UCS spec sheet lists
// its CPUs, drives, licences and a CPU assembly tool, and describes the server. describesPart's component shapes are a
// DENYLIST of SKU patterns and leak the next tool, blank or option (UCS-CPUAT=, UCS-DIMM-BLK=, UCS-MSTOR-SD= were about to
// receive the servers' humidity and EMC lists); this is the ALLOWLIST. Measured over the store on 2 Oct 2026 with a first
// cut of this table: 33,410 document-scoped inherited facts, 15,412 of them on a kind the document does not describe.
//
// THE SUBJECT, in order:
//   1. a per-document override in data/reference/doc-subjects.json, each carrying its witness (reviewer condition 1: a sheet
//      that also SPECIFIES its own modules or power supplies under a section heading has those kinds as subjects too);
//   2. the title's HEAD noun -- the rightmost subject noun after the boilerplate is stripped: "Catalyst 9400 Supervisor Engine
//      Modules" describes cards, "NCS 5500 Modular Chassis: Fabric and Fan Modules" describes fabric and fan modules,
//      "Catalyst 9300 Series Switches" describes switches; component nouns in the same head phrase join ("Cable and
//      Transceiver Modules");
//   3. a title naming no subject noun describes a DEVICE: layerChecks' DEVICE_KINDS.
// NOT JUDGED is its own verdict, never a pass (reviewer condition 2): an untitled document, a receiver whose category has no
// kind axis, a kind the axes leave unclassified. Callers COUNT it; the store refuses document-scoped inheritance it cannot
// judge (a gap is recoverable, a wrong value is not).
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { DEVICE_KINDS } from "./layerChecks.js";

/** What slots into or plugs into a device: the subjects of card, module, adapter and engine sheets. */
export const CARD_KINDS: ReadonlySet<string> = new Set(["linecard", "module", "interface", "supervisor", "fabric", "transponder", "mux",
  "amplifier", "roadm", "controller", "processor", "expansion-module", "security-module", "io-module", "storage-controller", "nic", "adapter",
  "cellular", "gpu"]);
export const OPTIC_KINDS: ReadonlySet<string> = new Set(["pluggable", "bidi", "tunable"]);
export const CABLE_KINDS: ReadonlySet<string> = new Set(["cable", "stack-cable", "power-cord", "breakout-cable"]);
/** Kinds an axis returns when it could not classify, or for things that are not hardware: never judged, always counted. */
export const UNJUDGED_KINDS: ReadonlySet<string> = new Set(["unknown", "software", "non-hardware", "non-product", "bundle"]);

type Noun = { re: RegExp; group: string; kinds: ReadonlySet<string> };
const W = (s: string) => new RegExp(`(?<![A-Za-z])(?:${s})(?![A-Za-z])`, "gi");
// DEVICE nouns name the machine; a device noun to the RIGHT of a component noun makes the sheet a device sheet
// ("Line-Card Chassis Route Processor" is a processor sheet: the rightmost noun wins).
const NOUNS: Noun[] = [
  { re: W("switch(?:es)?|routers?|servers?|chassis|appliances?|directors?|fabric interconnects?|fabric extenders?|wireless controllers?|access points?|gateways?|firewalls?|phones?|platforms?|systems?|nodes?|uCPE|endpoints?|cameras?|codecs?|sensors?|backhaul|OLTs?|ONTs?"), group: "device", kinds: DEVICE_KINDS },
  { re: W("line ?-?cards?|interface cards?|cards?|modules?|adapters?|supervisors?(?: engines?)?|engines?|route processors?|processors?|WICs?|NIMs?|controllers?|fabric(?: modules?| cards?)?"), group: "card", kinds: CARD_KINDS },
  { re: W("transceivers?|optics|SFPs?|QSFPs?"), group: "optic", kinds: OPTIC_KINDS },
  { re: W("cables?|cabling|power cords?"), group: "cable", kinds: CABLE_KINDS },
  { re: W("power suppl(?:y|ies)|power modules?|PSUs?"), group: "power", kinds: new Set(["power"]) },
  { re: W("fans?|fan trays?"), group: "fan", kinds: new Set(["fan"]) },
  { re: W("antennas?"), group: "antenna", kinds: new Set(["antenna"]) },
  { re: W("headsets?"), group: "headset", kinds: new Set(["headset"]) },
  { re: W("memory|DIMMs?"), group: "memory", kinds: new Set(["memory", "flash"]) },
  { re: W("drives?|SSDs?|HDDs?"), group: "drive", kinds: new Set(["drive"]) },
];
// boilerplate that never names the subject: stripped before the head noun is read
const BOILER = W("data ?sheets?|spec(?:ification)? ?sheets?|ordering guides?|at-a-glance|product bulletins?|series|family|cisco");

export type DocSubject =
  | { judged: true; source: "override" | "title" | "default"; groups: string[]; kinds: ReadonlySet<string>; witness?: string }
  | { judged: false; reason: string };

/** The subject read from a title alone (no override): exported for the tests and the store check. */
export function subjectFromTitle(title: string | null | undefined): DocSubject {
  if (!title || !title.trim()) return { judged: false, reason: "untitled document" };
  const t = title.replace(/\s+-\s+Cisco\s*$/i, "").replace(BOILER, " ");
  const afterColon = t.includes(":") ? t.slice(t.lastIndexOf(":") + 1) : t;   // "NCS 5500 Modular Chassis: Fabric and Fan Modules"
  // the head noun stands BEFORE a prepositional phrase: "Cellular Modules for the Cisco 1000 Series Connected Grid Routers"
  // describes modules, "Line Cards with 7-Fabric Supervisor" line cards (the store check's one miss, 2 Oct)
  const head = afterColon.split(/(?<![A-Za-z])(?:for|with)(?![A-Za-z])/i)[0];
  type Hit = { start: number; end: number; text: string; noun: Noun };
  let hits: Hit[] = [];
  for (const noun of NOUNS) for (const m of head.matchAll(noun.re)) hits.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], noun });
  // a hit inside a longer hit is the same words read twice ("Controllers" inside "Wireless Controllers", "Engine" inside
  // "Supervisor Engine"): the longer reading wins
  hits = hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
  if (!hits.length) return { judged: true, source: "default", groups: ["device"], kinds: DEVICE_KINDS };
  hits.sort((a, b) => b.end - a.end || (b.end - b.start) - (a.end - a.start));
  const top = hits[0];
  if (top.noun.group === "device") return { judged: true, source: "title", groups: ["device"], kinds: DEVICE_KINDS };
  // A component head: walk LEFT over component nouns that stand right next to it or are joined to it by and / & / , / "/"
  // ("Fan Modules", "Fabric and Fan Modules", "Cable and Transceiver Modules"). Any other word stops the walk, so a modifier
  // further left never joins ("QSFP-DD Transponder Line Card" describes line cards, not optics), and a device noun never joins.
  const joined: Hit[] = [top];
  let cursor = top.start;
  for (const h of hits.slice(1)) {
    if (h.end > cursor) continue;
    if (h.noun.group === "device" || !/^\s*(?:(?:and|&|,|\/)\s*)?$/i.test(head.slice(h.end, cursor))) break;
    joined.push(h); cursor = h.start;
  }
  let groups = [...new Set(joined.map((h) => h.noun.group))];
  // A GENERIC head ("Modules", "Cards", "Adapters") named by a specific modifier is that modifier's thing: "Transceiver
  // Modules" are optics and "Fan Modules" fans, so the card group stays only when a card noun other than the head joined.
  if (/^(?:modules?|cards?|adapters?)$/i.test(top.text.trim()) && groups.length > 1 && !joined.slice(1).some((h) => h.noun.group === "card")) {
    groups = groups.filter((g) => g !== "card");
  }
  const kinds = new Set<string>();
  for (const h of joined) if (groups.includes(h.noun.group)) for (const k of h.noun.kinds) kinds.add(k);
  return { judged: true, source: "title", groups, kinds };
}

export type SubjectOverride = { doc_id: string; url?: string; title?: string; add_kinds?: string[]; kinds?: string[]; witness: string; reason: string };
export const DOC_SUBJECTS_FILE = path.join(REPO_ROOT, "data", "reference", "doc-subjects.json");
/** The override table, refused at load when an entry has no witness, no reason, no kinds, or appears twice. */
export function parseOverrides(d: { overrides?: SubjectOverride[] }): Map<string, SubjectOverride> {
  const m = new Map<string, SubjectOverride>();
  for (const o of d.overrides ?? []) {
    if (!o.doc_id || !o.witness || !o.reason) throw new Error(`doc-subjects.json: an override needs doc_id, witness and reason (${JSON.stringify(o).slice(0, 120)})`);
    if (!o.kinds?.length && !o.add_kinds?.length) throw new Error(`doc-subjects.json: ${o.doc_id} names neither kinds nor add_kinds`);
    if (m.has(o.doc_id)) throw new Error(`doc-subjects.json: ${o.doc_id} appears twice`);
    m.set(o.doc_id, o);
  }
  return m;
}
let OVERRIDES: Map<string, SubjectOverride> | null = null;
function overrides(): Map<string, SubjectOverride> {
  if (!OVERRIDES) OVERRIDES = fs.existsSync(DOC_SUBJECTS_FILE) ? parseOverrides(JSON.parse(fs.readFileSync(DOC_SUBJECTS_FILE, "utf8"))) : new Map();
  return OVERRIDES;
}

/** A document's subject: its override (witnessed), else its title. */
export function docSubject(doc: { doc_id?: string | null; title?: string | null }, table: Map<string, SubjectOverride> = overrides()): DocSubject {
  const o = doc.doc_id ? table.get(doc.doc_id) : undefined;
  const base = subjectFromTitle(doc.title);
  if (!o) return base;
  const kinds = new Set<string>(o.kinds ?? (base.judged ? base.kinds : []));
  for (const k of o.add_kinds ?? []) kinds.add(k);
  return { judged: true, source: "override", groups: ["override"], kinds, witness: o.witness };
}

export type SubjectVerdict = { verdict: "in" } | { verdict: "out"; reason: string } | { verdict: "not_judged"; reason: string };

/** Is a receiver of kind `kind` (undefined: its category has no kind axis) a subject of the document? */
export function judgeReceiver(subject: DocSubject, kind: string | undefined): SubjectVerdict {
  if (!subject.judged) return { verdict: "not_judged", reason: subject.reason };
  if (kind === undefined) return { verdict: "not_judged", reason: "the receiver's category has no kind axis" };
  if (UNJUDGED_KINDS.has(kind)) return { verdict: "not_judged", reason: `the kind axis reads the receiver as '${kind}'` };
  if (subject.kinds.has(kind)) return { verdict: "in" };
  return { verdict: "out", reason: `a ${kind} is not what this document describes (${subject.source}: ${("groups" in subject ? subject.groups : []).join("+")})` };
}
