// src/core/layerChecks.ts — the layers reviewer's STANDING checks over a category's built rows (layers review round 2, 14 Sep 2026).
// Pure over data/layers/cisco-<category>.rows.tsv and the mapping files; read by tests/layersStanding.test.ts and scripts.
//
//   spare = base     X and X= carry the same series, kind, bucket and plan
//   plan coverage    no row left in the not-this-category bucket (every one carries a plan), no row unplaced
//   twins            no two live rows whose SKUs fold (case, whitespace) to one identity
//   leakage          a layered row that ANOTHER category's mapping places by a SKU rule in a real series (a cross-claim). Each
//                    group must be recorded with its reason and exact row count — a new or grown group fails, a stale entry fails.
//   rule shadowing   a SKU rule of the category's own mapping that matches nothing (dead), or whose every match another rule of
//                    the SAME series decides (redundant), or that loses its matches to ANOTHER series (shadowed; recorded or failed).
//   label check      a row still in a series by a stored label carries evidence (SKU token, name, family token, compatible link);
//                    a row the check moved sits in its line's shared parts; the recorded evidence agrees with labelEvidence today.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { placePart, loadLineFile, familyOf, twinKey, twinRank, type Placement } from "./productLine.js";
import { labelEvidence, digitTokens, digitPattern } from "./labelEvidence.js";

export type LayerRow = Record<string, string>;

/** closing items at aa1143f, item 1: a device is never a shared part. Layers round 3 (operator, 14 Sep 2026): every whole-device
 * kind joins — `device` (interfaces-modules' marker for a whole device filed among cards), `ont` and `olt`. One set, read by
 * scripts/build-layers.mts (the pending_review hold) and by the standing check. */
// Layers round 3, wireless round: the wireless whole-device kinds join — `ap` (access points and mesh extenders), `wlc` (controllers),
// `backhaul` (the URWB radios) and `sensor` (the Aironet 1800s active sensor). A controller in shared parts was found the same day
// (AIR-CT85DC-K9 in AireOS shared parts); the check now names such a row.
// Layers round 3, servers + hyperconverged round: the UCS machine kinds join — `server` and `fabric-interconnect` (ucsKind's UCS_MACHINE
// with `chassis`, already here). On joining they named 148 rows in the three UCS categories' shared parts: servers and fabric
// interconnects whose series the mappings lacked (C420 M3, the Scalable M4 blade modules, XE130c, 6600), datasheet cells and
// placeholders, and a few parts the kind axis reads as machines.
// Layers round 3, security round: securityKind's SEC_BOX joins — `firewall`, `ips`, `email-gateway`, `web-gateway`, `management`,
// `analytics`, `identity` (`appliance` was already here). Only the security axis returns these words.
export const DEVICE_KINDS: ReadonlySet<string> = new Set(["router", "sp-router", "switch", "fex", "chassis", "appliance", "device", "ont", "olt", "ap", "wlc", "backhaul", "sensor", "server", "fabric-interconnect",
  "firewall", "ips", "email-gateway", "web-gateway", "management", "analytics", "identity",
  // Layers round 3, video round: videoKind's VIDEO_BOX joins — `node` (GS7000 / fibre nodes) and `system` (configured systems); `chassis` was in.
  "node", "system",
  // Layers round 3, storage round: sanKind's SAN_BOX joins — `fc-switch` (MDS fabric switches) and `director` (MDS directors).
  "fc-switch", "director",
  // Layers round 3, unified-communications round: collabKind's calling boxes join — `phone`, `gateway` (VG / SPA8000 voice gateways) and
  // `ata` (analog telephone adapters). The video endpoints and room peripherals are the collaboration-endpoints round's.
  "phone", "gateway", "ata",
  // Layers round 3, collaboration-endpoints round: the rest of collabKind's COLLAB_ENDPOINT ("a whole product with its own specification
  // sheet") joins — video devices and codecs, DECT bases, and the cameras, microphones, speakers, headsets, touch panels, displays and
  // key expansion modules Cisco sells as products of their own.
  "video-device", "video-codec", "dect-base", "camera", "microphone", "speaker", "headset", "touch-panel", "display", "expansion-module",
  // Layers round 3, meraki round: merakiKind names an access point `access-point` (wireless's kind is `ap`); its camera, appliance,
  // gateway, sensor and switch nouns are already here.
  "access-point"]);
export function deviceInSharedParts(rows: LayerRow[]): LayerRow[] {
  return rows.filter((r) => /shared parts$/.test(r.series ?? "") && DEVICE_KINDS.has(r.kind ?? ""));
}

/**
 * Rows a reviewed category plans to MOVE out that the target category's mapping would not place (layers round 3, operator: "every
 * target mapping must place every arrival"). Read from the source's built rows (name and stored label as the page has them) and
 * the target's mapping file; plans that ran are history and are not judged.
 */
export function unplacedArrivals(category: string, rows: LayerRow[], plans: readonly { sku: string; category: string; action: string; to: string; run_id?: number | string | null; product_class?: string }[], vendor = "cisco",
  targetRows: (to: string) => LayerRow[] = (to) => readLayerRows(to, vendor)): { sku: string; to: string; why: string }[] {
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  const out: { sku: string; to: string; why: string }[] = [];
  // the twin rule on the target page (re-audit decisions, N-1 / Q-20, 15 Sep 2026): a spare planned in beside its layered base — a
  // generic cord whose label means nothing to the target mapping — lands in its twin's series when the pages are rebuilt
  const twinsOf = new Map<string, Set<string>>();
  const twinLayered = (to: string, sku: string) => {
    if (!twinsOf.has(to)) { try { twinsOf.set(to, new Set(targetRows(to).filter((r) => r.bucket === "layered" && !r.plan).map((r) => twinKey(r.sku)))); } catch { twinsOf.set(to, new Set()); } }
    return twinsOf.get(to)!.has(twinKey(sku));
  };
  for (const p of plans) {
    if (p.category !== category || p.action !== "move" || (p.run_id ?? null) !== null) continue;
    // re-audit decisions (operator, 15 Sep 2026, Q-24): a category merge moves every class; a plan that says its row is not hardware
    // has no row on the hardware pages and no series to land in (nonHardwarePlansOnPage checks that the field tells the truth)
    if (p.product_class && p.product_class !== "hardware") continue;
    const r = bySku.get(p.sku);
    if (!r) { out.push({ sku: p.sku, to: p.to, why: `the planned SKU is not a row of ${category}'s built rows` }); continue; }
    const loaded = loadLineFile(vendor, p.to);
    if (!loaded) { out.push({ sku: p.sku, to: p.to, why: `${p.to} has no mapping file` }); continue; }
    const q = placePart(vendor, p.to, { sku: r.sku, name: r.name, series: r.series_label }, loaded);
    if (!q && twinLayered(p.to, p.sku)) continue;
    if (!q) out.push({ sku: p.sku, to: p.to, why: `no rule of ${p.to} places it, and no twin of it is layered there` });
    else if (q.line === "(not this category)") out.push({ sku: p.sku, to: p.to, why: `${p.to} lists it as not this category (${(q as { why: string }).why})` });
  }
  return out;
}

/** Plans that say their row is NOT hardware (a merge moving every class, Q-24) whose SKU is nevertheless a row of the category's
 * hardware page: the field would hide a hardware row from the arrivals check. */
export function nonHardwarePlansOnPage(category: string, rows: LayerRow[], plans: readonly { sku: string; category: string; product_class?: string; run_id?: number | string | null }[]): string[] {
  const onPage = new Set(rows.map((r) => r.sku.trim().toUpperCase()));
  return plans.filter((p) => p.category === category && (p.run_id ?? null) === null && p.product_class && p.product_class !== "hardware" && onPage.has(p.sku.trim().toUpperCase())).map((p) => p.sku);
}

type SeriesEntry = { series: string; family: string | null; parts: number; kinds: Record<string, number>; roles: Record<string, number> };
/** A series entry of the page JSON that does not agree with its own rows (closing items at aa1143f, item 11): parts, the kind and
 * role tallies, and the family — every layered row of the series carries the entry's family ("" on a row = null on the entry). */
export function seriesEntryDisagreements(summary: { lines: { line: string; series: SeriesEntry[] }[] }, rows: LayerRow[]): { line: string; series: string; fields: string[]; detail: string }[] {
  const out: { line: string; series: string; fields: string[]; detail: string }[] = [];
  const tally = (xs: string[]) => { const m: Record<string, number> = {}; for (const x of xs) m[x] = (m[x] ?? 0) + 1; return JSON.stringify(Object.entries(m).sort()); };
  for (const l of summary.lines) for (const s of l.series) {
    const mine = rows.filter((r) => r.bucket === "layered" && r.product_line === l.line && r.series === s.series);
    const fields: string[] = [], detail: string[] = [];
    if (mine.length !== s.parts) { fields.push("parts"); detail.push(`entry ${s.parts}, rows ${mine.length}`); }
    if (tally(mine.map((r) => r.kind)) !== JSON.stringify(Object.entries(s.kinds).sort())) { fields.push("kinds"); detail.push(`entry ${JSON.stringify(s.kinds)}`); }
    const roleOf = (r: LayerRow) => (r.deploy_role ? r.deploy_role : r.role_issue ? "(kind issue)" : null);
    if (tally(mine.map(roleOf).filter((x): x is string => x !== null)) !== JSON.stringify(Object.entries(s.roles).sort())) { fields.push("roles"); detail.push(`entry ${JSON.stringify(s.roles)}`); }
    const fams = [...new Set(mine.map((r) => r.product_family ?? ""))];
    if (fams.some((f) => f !== (s.family ?? ""))) { fields.push("family"); detail.push(`entry ${JSON.stringify(s.family)}, rows ${JSON.stringify(fams)}`); }
    if (fields.length) out.push({ line: l.line, series: s.series, fields, detail: detail.join("; ") });
  }
  return out;
}

/** Built rows that break the label check: in a series by a label without evidence, or moved by the check but not in shared parts. */
export function labelViolations(rows: LayerRow[]): { sku: string; why: string }[] {
  const out: { sku: string; why: string }[] = [];
  for (const r of rows) {
    if (r.bucket !== "layered") continue;
    const pb = r.placed_by ?? "", ev = r.label_evidence ?? "";
    // pre-ruling C1 (layers round 3): a label mapped directly to the line's shared parts claims no series and is not judged —
    // sharedLabelNotExplicit() checks that the mapping file lists that label on the shared-parts series
    if (pb.startsWith("label ") && r.series === `${r.product_line} shared parts`) {
      if (ev) out.push({ sku: r.sku, why: `a label placed it directly in ${r.series}, yet evidence "${ev}" was recorded (C1: such a row is not judged)` });
      continue;
    }
    if (pb.startsWith("label ")) {
      if (!ev) out.push({ sku: r.sku, why: "placed by a label, no label_evidence recorded" });
      else if (ev.startsWith("none")) out.push({ sku: r.sku, why: `placed in ${r.series} by a label the evidence does not support (${ev})` });
    } else if (pb.startsWith("label-unsupported")) {
      if (r.series !== `${r.product_line} shared parts`) out.push({ sku: r.sku, why: `moved by the label check but sits in ${r.series}` });
      if (!ev.startsWith("none")) out.push({ sku: r.sku, why: `moved by the label check with evidence "${ev}"` });
    }
  }
  return out;
}

/** Pre-ruling C1 (layers round 3): rows a stored label placed directly in a shared-parts series, whose label the mapping file does
 * NOT list on that series — "a label mapped directly to shared parts is not judged" holds only while the mapping says so explicitly. */
export function sharedLabelNotExplicit(category: string, rows: LayerRow[], vendor = "cisco"): { sku: string; why: string }[] {
  const loaded = loadLineFile(vendor, category);
  const out: { sku: string; why: string }[] = [];
  for (const r of rows) {
    if (r.bucket !== "layered" || !(r.placed_by ?? "").startsWith("label ") || r.series !== `${r.product_line} shared parts`) continue;
    const label = (r.placed_by ?? "").slice("label ".length).trim().toLowerCase();
    const s = loaded?.file.lines.find((l) => l.line === r.product_line)?.series.find((x) => x.series === r.series);
    if (!s) out.push({ sku: r.sku, why: `${r.series} is not a series of the mapping file` });
    else if (!(s.labels ?? []).some((x) => x.trim().toLowerCase() === label)) out.push({ sku: r.sku, why: `label "${label}" is not listed on ${r.series}` });
  }
  return out;
}

/** Kept label rows whose recorded evidence today's labelEvidence no longer gives (a code change the build has not caught up with).
 * Rows kept by a compatible link are counted apart: the built rows do not carry the relations, so they are not recomputed here. */
export function labelEvidenceDrift(category: string, rows: LayerRow[], vendor = "cisco"): { drift: { sku: string; recorded: string; now: string }[]; compatible: number } {
  const loaded = loadLineFile(vendor, category);
  const drift: { sku: string; recorded: string; now: string }[] = [];
  let compatible = 0;
  if (!loaded) return { drift, compatible };
  for (const r of rows) {
    if (r.bucket !== "layered" || !(r.placed_by ?? "").startsWith("label ") || !r.label_evidence) continue;
    if (r.label_evidence.startsWith("compatible") || r.label_evidence.includes("twin ")) { if (r.label_evidence.startsWith("compatible")) compatible++; continue; }
    const ln = loaded.file.lines.find((l) => l.line === r.product_line);
    if (!ln) { drift.push({ sku: r.sku, recorded: r.label_evidence, now: `line ${r.product_line} is not in the mapping` }); continue; }
    const ev = labelEvidence({ sku: r.sku ?? "", name: r.name ?? null }, r.series, { family: familyOf(loaded, r.series), siblings: ln.series.map((s) => ({ series: s.series, family: s.family?.trim() || null })) });
    const now = `${ev.kind}: ${ev.detail}`;
    if (now !== r.label_evidence) drift.push({ sku: r.sku, recorded: r.label_evidence, now });
  }
  return { drift, compatible };
}

/**
 * Q-26 (operator, "after the runs"; re-audit finding B1, 15 Sep 2026). B1 found the label check keeping rows on digits that are not
 * platforms — MX700's 7xx range read "CA750" as a 7xx model and kept the Avizia carts in TelePresence MX — and proposed a rule: a
 * digit token preceded by letters counts only when those letters are the series' own model prefix.
 *
 * MEASURED FIRST, over every page's committed rows, and the proposal does not survive its own measurement. 79 of the 462 kept label
 * rows are evidenced by a series digit token that is glued to letters everywhere it appears, and reading all of them, every one is a
 * CORRECT keep: the glued letters are the vendor's SKU spelling of the same platform, which the series NAME spells differently —
 * C9300 for "Catalyst 9300", N9800 for "Nexus 9000", Cat6509 for "Catalyst 6500", ASR1002 for "ASR 1000", IW6300 for
 * "IW6300 / ESW6300". The rule as proposed would move 40 right rows and no wrong ones, because all three rows B1 found are already
 * gone: AVIZ-CA300 / CA750 are placed by a hard SKU rule into TelePresence (legacy) shared parts, the 7160 rows sit in a renamed
 * "Cisco 7100 VPN routers (7120 / 7140 / 7160)" placed by SKU, and ACC-PHD1080P= is kept by the word "PrecisionHD", not by 1080.
 *
 * So this is a CHECK and not a placement rule: it moves nothing, and it reports the rows whose glued spelling the page cannot
 * account for, so a returning CA750 shows up as a NEW entry instead of being kept in silence. Three rescues, each derivable from
 * the page rather than from a hand list:
 *   1. a clean, unglued hit of the same token anywhere in the SKU or name;
 *   2. the glued letters, or the letters+token together, are a word of the series name (CGR1000 under "CGR 1000 Connected Grid",
 *      IW6300 under "IW6300 / ESW6300");
 *   3. a row of the SAME series placed by a SKU RULE — never by a label, or the weakest evidence would corroborate itself — writes
 *      the same spelling (C9300X-NM-8Y= attests C+9300 for Catalyst 9300; kinship is a suffix match, so Cat6509 and WS-C6597 count
 *      as one family).
 * The control is the case it was written for: the TelePresence MX series has 152 SKU-placed rows and not one writes CA<ddd>, so a
 * label-placed AVIZ-CA750 would be reported here.
 */
export function gluedDigitKeeps(rows: LayerRow[]): { sku: string; series: string; token: string; prefix: string; why: string }[] {
  const seriesWords = (s: string) => new Set(s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  const hits = (hay: string, tok: string): { prefix: string }[] => {
    const g = new RegExp(digitPattern(tok).re.source, "gi");
    const out: { prefix: string }[] = [];
    for (let m = g.exec(hay); m; m = g.exec(hay)) out.push({ prefix: (/([A-Za-z]*)$/.exec(hay.slice(0, m.index)) ?? ["", ""])[1].toUpperCase() });
    return out;
  };
  // rescue 3's index, from SKU-rule-placed rows only
  const attested: { series: string; token: string; prefix: string; by: string }[] = [];
  for (const r of rows) {
    if (!/^sku /.test(r.placed_by ?? "") || !r.series) continue;
    for (const tok of digitTokens(r.series)) for (const h of hits(r.sku ?? "", tok)) if (h.prefix) attested.push({ series: r.series, token: tok, prefix: h.prefix, by: r.sku });
  }
  const out: { sku: string; series: string; token: string; prefix: string; why: string }[] = [];
  for (const r of rows) {
    if (r.bucket !== "layered" || !/^label /.test(r.placed_by ?? "") || !r.label_evidence) continue;
    const m = /^(?:sku-token|name): ([0-9]{3,5})$/.exec(r.label_evidence);
    if (!m || !digitTokens(r.series ?? "").includes(m[1])) continue;
    const token = m[1];
    const all = [...hits(r.sku ?? "", token), ...hits(r.name ?? "", token)];
    if (!all.length || all.some((h) => !h.prefix)) continue;                                   // 1
    const words = seriesWords(r.series);
    if (all.some((h) => words.has(h.prefix) || words.has(`${h.prefix}${token}`))) continue;     // 2
    if (attested.some((a) => a.series === r.series && a.token === token                        // 3
        && all.some((h) => h.prefix.endsWith(a.prefix) || a.prefix.endsWith(h.prefix)))) continue;
    out.push({ sku: r.sku, series: r.series, token, prefix: all[0].prefix,
      why: `kept on "${all[0].prefix}${token}", a spelling of ${token} this page does not attest for ${r.series}` });
  }
  return out;
}

/**
 * Q-27 / re-audit finding B2 (operator, "after the runs"). A hard SKU catch-all into shared parts is invisible to every check: a
 * rule like `^CP-` -> "IP Phones shared parts" places HARD, so the label check never judges those rows and the device check sees
 * only device kinds. Collaboration's round ran this scan by hand and moved 189 rows out; nobody had run it anywhere else.
 *
 * THE REVERSE OF THE LABEL CHECK: for a row sitting in a line's shared parts, would any SIBLING series of that line keep it on its
 * own evidence? It calls `labelEvidence` rather than re-implementing it, so the token strength is exactly the forward check's —
 * `sku-token` or `name` only, never `family` (too weak to name one series) and never `compatible` (the built rows carry no
 * relations). Exactly ONE winner is required: labelEvidence's rival rule already returns "none" when two series name a row as
 * specifically, which is the collaboration round's "parts named for two products stay in shared parts", so that case falls out of
 * the rule it already has rather than needing one of its own.
 *
 * Measured over the 15 reviewed categories: 6,607 shared-parts rows, 805 named by exactly one series (servers 264, HCI 109,
 * collaboration 104 — a further 104 after that round moved 189 — switches 98, wireless 66, routers 46, storage 38, HX 31,
 * security 27, IM 11, UC 5, video 3, optical 3; transceiver and meraki hold no shared-parts rows at all).
 *
 * It REPORTS. It must not move rows, and reading them says why: 12 of the 805 are named on a STANDARDS number, not a platform —
 * CAB-ACU "AC Power Cord (UK), C13, BS 1363" reads as Catalyst 1300, PWR-CAB-CHN-* "IEC60320" as 6000, PWR-CAB-AC-CHN "GB2099" as
 * Catalyst 1000. The forward check keeps 0 rows on that shape today, so this is not a defect on the published pages; it is the
 * guard a reverse scan would need before it could ever place anything.
 */
export function sharedPartsNamedBySeries(rows: LayerRow[], category: string, vendor = "cisco"):
  { sku: string; from: string; to: string; kind: string; detail: string; placed_by: string }[] {
  const loaded = loadLineFile(vendor, category);
  if (!loaded) return [];
  const out: { sku: string; from: string; to: string; kind: string; detail: string; placed_by: string }[] = [];
  for (const r of rows) {
    if (r.bucket !== "layered" || !/ shared parts$/.test(r.series ?? "")) continue;
    const ln = loaded.file.lines.find((l) => l.line === r.product_line);
    if (!ln) continue;
    const siblings = ln.series.map((s) => ({ series: s.series, family: s.family?.trim() || null }));
    const won: { series: string; kind: string; detail: string }[] = [];
    for (const s of ln.series) {
      if (/ shared parts$/.test(s.series)) continue;
      const ev = labelEvidence({ sku: r.sku, name: r.name ?? null }, s.series, { family: familyOf(loaded, s.series), siblings });
      if (ev.kind === "sku-token" || ev.kind === "name") won.push({ series: s.series, kind: ev.kind, detail: ev.detail });
    }
    if (won.length !== 1) continue;
    out.push({ sku: r.sku, from: r.series, to: won[0].series, kind: won[0].kind, detail: won[0].detail, placed_by: r.placed_by ?? "" });
  }
  return out;
}

/** How strongly a piece of evidence identifies a series. A WIDENED round number (200 matching 2xx) is the weakest — it is what
 * `digitPattern` broadens on purpose, and the Q-27 review found it behind most of the queue's wrong proposals. An EXACT 3-5 digit
 * token and the FULL series name carry their own identity; a WORD borrows it from the absence of a rival. */
export function evidenceStrength(detail: string, series: string): "widened" | "exact" | "fullname" | "word" {
  if (/^[0-9]+$/.test(detail))
    return /^[1-9]000$/.test(detail) || /^[0-9]{2}00$/.test(detail) || /^[1-9]00$/.test(detail) ? "widened" : "exact";
  return detail === series ? "fullname" : "word";
}

/**
 * THE SCAN Q-27's REVERSE CHECK CANNOT MAKE (16 Sep 2026). `sharedPartsNamedBySeries` only ever asks the siblings of a row's OWN
 * product line, which is right for promoting a row within its line — and it means a row filed under the WRONG LINE is invisible
 * to it. `N20-BBLKD2=` is a "UCS C250 M2 and M1 HDD blanking panel" sitting in the B-Series line's shared parts, so the only
 * series that could ever claim it was UCS B250: the wrong answer, reached because the right one was never a candidate.
 *
 * This asks the same question of every line of the category, and reports a row that NO series of its own line names while
 * EXACTLY ONE series of another line does. It is deliberately restricted to STRONG evidence — an exact digit token or the full
 * series name — because the unrestricted scan returns 541 rows of which 412 rest on a widened round number, and a queue that big
 * at that precision is one nobody runs twice. It finds things like `AIR-PSU1-770W`, "770W AC Hot-Plug Power Supply for 5520
 * Controller", sitting under Wireless Antennas.
 *
 * **90 rows, and a first measurement of the same idea said 49** — worth stating, because the two are different questions and the
 * gap is the whole design decision. That version required exactly one claim AT ANY STRENGTH and then asked whether it was strong,
 * so a row claimed strongly by one series and weakly by another was dropped as ambiguous. This one asks for exactly one STRONG
 * claim and lets a weak rival stand, on the grounds that a widened number is not evidence enough to veto an exact one. All 90
 * were read either way; the extra 41 are the same mixture as the 49.
 *
 * Recorded as an exact count per category for the same reason Q-27's is: a rise is a new mis-file, a fall is a review doing its
 * job, and both directions fail so neither drifts in silence.
 */
export function crossLineNamedBySeries(rows: LayerRow[], category: string, vendor = "cisco"):
  { sku: string; from: string; fromLine: string; to: string; toLine: string; kind: string; detail: string }[] {
  const loaded = loadLineFile(vendor, category);
  if (!loaded) return [];
  const out: { sku: string; from: string; fromLine: string; to: string; toLine: string; kind: string; detail: string }[] = [];
  for (const r of rows) {
    if (r.bucket !== "layered" || !/ shared parts$/.test(r.series ?? "")) continue;
    let ownClaims = 0;
    const other: { series: string; line: string; kind: string; detail: string }[] = [];
    for (const ln of loaded.file.lines) {
      const siblings = ln.series.map((s) => ({ series: s.series, family: s.family?.trim() || null }));
      for (const s of ln.series) {
        if (/ shared parts$/.test(s.series)) continue;
        const ev = labelEvidence({ sku: r.sku, name: r.name ?? null }, s.series, { family: familyOf(loaded, s.series), siblings });
        if (ev.kind !== "sku-token" && ev.kind !== "name") continue;
        if (ln.line === r.product_line) { ownClaims++; continue; }
        // only the bands that identify a series on their own; a widened number or a word is not enough to move a row's LINE
        const strength = evidenceStrength(ev.detail, s.series);
        if (strength === "exact" || strength === "fullname") other.push({ series: s.series, line: ln.line, kind: ev.kind, detail: ev.detail });
      }
    }
    // a row its own line can place is the forward check's business, not this one
    if (ownClaims > 0 || other.length !== 1) continue;
    out.push({ sku: r.sku, from: r.series, fromLine: r.product_line ?? "", to: other[0].series, toLine: other[0].line, kind: other[0].kind, detail: other[0].detail });
  }
  return out;
}

export function readLayerRows(category: string, vendor = "cisco"): LayerRow[] {
  const p = path.join(REPO_ROOT, "data", "layers", `${vendor}-${category}.rows.tsv`);
  const lines = fs.readFileSync(p, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
}

/**
 * spare = base, widened to the twin rule (re-audit decisions, operator, 15 Sep 2026, N-1): X, X=, X- and X-- carry the same series,
 * kind, bucket and plan. Each member is compared with the group's reference — the base when it is a row, else the lowest twinRank —
 * and reported under the reference's SKU (the key the recorded exceptions use), with the member that disagrees.
 */
export function pairDisagreements(rows: LayerRow[]): { sku: string; member: string; fields: string[] }[] {
  const groups = new Map<string, LayerRow[]>();
  for (const r of rows) { const k = twinKey(r.sku); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const out: { sku: string; member: string; fields: string[] }[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ref = [...members].sort((a, b) => twinRank(a.sku) - twinRank(b.sku))[0];
    for (const m of members) {
      if (m === ref) continue;
      const fields = ["series", "kind", "bucket", "plan"].filter((f) => (ref[f] ?? "") !== (m[f] ?? ""));
      if (fields.length) out.push({ sku: ref.sku, member: m.sku, fields });
    }
  }
  return out;
}

/**
 * THE CROSS-CATEGORY TWIN CHECK (re-audit decisions, operator, 15 Sep 2026, Q-20): the twin rule across pages — X, X=, X- and X-- live in
 * ONE category. Each member's home once its plans run is its category, its move target, or nowhere (a class plan takes it off the
 * hardware pages); a group whose hardware members still end in two or more categories is a split no plan joins.
 */
export function crossCategoryTwins(rowsByCat: ReadonlyMap<string, LayerRow[]>): { key: string; members: { category: string; sku: string; plan: string }[] }[] {
  const groups = new Map<string, { category: string; sku: string; plan: string }[]>();
  for (const [category, rows] of rowsByCat) for (const r of rows) {
    const k = twinKey(r.sku);
    groups.set(k, [...(groups.get(k) ?? []), { category, sku: r.sku, plan: r.plan ?? "" }]);
  }
  const out: { key: string; members: { category: string; sku: string; plan: string }[] }[] = [];
  for (const [key, members] of groups) {
    if (new Set(members.map((m) => m.category)).size < 2) continue;
    const homes = new Set(members.filter((m) => !m.plan.startsWith("class ")).map((m) => (m.plan.startsWith("move ") ? m.plan.slice("move ".length) : m.category)));
    if (homes.size > 1) out.push({ key, members });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Identity fold: case and every whitespace character. `C9200L-48P- 4G` and `c9200l-48p-4g` are one part. */
export const foldSku = (sku: string): string => sku.replace(/\s+/g, "").toUpperCase();
export function twinGroups(rows: LayerRow[]): string[][] {
  const g = new Map<string, string[]>();
  for (const r of rows) { const k = foldSku(r.sku); g.set(k, [...(g.get(k) ?? []), r.sku]); }
  return [...g.values()].filter((v) => v.length > 1);
}

export type CrossClaim = { category: string; claimed_by: string; series: string; rule: string; rows: number; examples: string[] };

/** A series another mapping marks as a move-out holder ("every row carries a move plan") does not claim a home. */
const isMoveOut = (loaded: NonNullable<ReturnType<typeof loadLineFile>>, series: string) =>
  loaded.file.lines.some((l) => l.series.some((s) => s.series === series && /every row carries a move plan/.test(s.note ?? "")));

export function crossClaims(category: string, rows: LayerRow[], categories: string[], vendor = "cisco"): CrossClaim[] {
  const groups = new Map<string, CrossClaim>();
  const files = Object.fromEntries(categories.filter((c) => c !== category).map((c) => [c, loadLineFile(vendor, c)]));
  for (const r of rows) {
    if (r.bucket !== "layered") continue;
    for (const [T, loaded] of Object.entries(files)) {
      if (!loaded) continue;
      const p = placePart(vendor, T, { sku: r.sku, name: r.name, series: r.series_label }, loaded) as Placement | null;
      if (!p || p.line === "(not this category)" || !p.rule.startsWith("sku") || /shared parts$/.test(p.series) || isMoveOut(loaded, p.series)) continue;
      const k = `${T}|${p.series}|${p.rule}`;
      const g = groups.get(k) ?? { category, claimed_by: T, series: p.series, rule: p.rule, rows: 0, examples: [] };
      g.rows++; if (g.examples.length < 3) g.examples.push(r.sku);
      groups.set(k, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.rows - a.rows);
}

export type RuleUse = { series: string; rule: string; matched: number; decided: number; lost_to: Record<string, number> };

/**
 * How each SKU rule of the category's mapping is used, over its own non-planned rows plus the rows planned INTO it (their names and
 * labels from the source category's built rows). A move-out series ("every row carries a move plan") is skipped: its rules place
 * rows that leave, which the page never shows as layered.
 */
export function ruleUse(category: string, ownRows: LayerRow[], incoming: LayerRow[], vendor = "cisco"): RuleUse[] {
  const loaded = loadLineFile(vendor, category);
  if (!loaded) return [];
  const pop = [...ownRows.filter((r) => r.bucket !== "pending_plan"), ...incoming];
  const out: RuleUse[] = [];
  for (const l of loaded.file.lines) for (const s of l.series) {
    if (/every row carries a move plan/.test(s.note ?? "")) continue;
    for (const src of s.sku ?? []) out.push({ series: s.series, rule: src, matched: 0, decided: 0, lost_to: {} });
  }
  const res = out.map((u) => new RegExp(u.rule));
  for (const r of pop) {
    const full = r.sku.toUpperCase().trim().replace(/=+$/, "");
    const raw = full.replace(/^(2D-|C1-|EDU-|NAL-)/, "");
    const p = placePart(vendor, category, { sku: r.sku, name: r.name, series: r.series_label }, loaded) as Placement | null;
    res.forEach((re, i) => {
      if (!re.test(raw)) return;
      const u = out[i]; u.matched++;
      if (p && p.rule === `sku ${u.rule}` && p.series === u.series) u.decided++;
      else { const k = p ? `${p.series} <- ${p.rule}` : "unplaced"; u.lost_to[k] = (u.lost_to[k] ?? 0) + 1; }
    });
  }
  return out;
}

export function classifyRules(uses: RuleUse[]): { dead: RuleUse[]; redundant: RuleUse[]; shadowed: RuleUse[] } {
  const dead = uses.filter((u) => u.matched === 0);
  const lost = uses.filter((u) => u.matched > 0 && u.decided === 0);
  const sameSeries = (u: RuleUse) => Object.keys(u.lost_to).every((k) => k.startsWith(`${u.series} <- sku `));
  return { dead, redundant: lost.filter(sameSeries), shadowed: lost.filter((u) => !sameSeries(u)) };
}

/** Rows planned into `category` from every other category, read from their built rows (name and label as the page has them). */
export function incomingRows(category: string, categories: string[], plans: { sku: string; category: string; action: string; to: string }[]): LayerRow[] {
  const byCat = new Map<string, Map<string, LayerRow>>();
  const out: LayerRow[] = [];
  for (const p of plans) {
    if (p.action !== "move" || p.to !== category || !categories.includes(p.category)) continue;
    if (!byCat.has(p.category)) byCat.set(p.category, new Map(readLayerRows(p.category).map((r) => [r.sku, r])));
    const r = byCat.get(p.category)!.get(p.sku);
    if (r) out.push(r);
  }
  return out;
}
