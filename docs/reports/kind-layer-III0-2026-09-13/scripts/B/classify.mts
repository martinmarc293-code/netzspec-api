// classify.mts — applies rules.mts to the live dump (parts.json) and writes:
//   classified.json            one line per part of the four kinds with role / issue / rule
//   classify-report.txt        per kind, per series, per rule: counts and every distinct name stem (for reading)
//   summary.json               the numbers the markdown report and the proposed data file are built from
// No DB access; the dump is from dump.mts (read-only connection).
import { readFileSync, writeFileSync } from "node:fs";
import { RULES, normalise, SPEC_AP, SPEC_ROUTER, specPhoneRole, type Rule } from "./rules.mts";

const rows: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/B/parts.json", "utf8"));
const spec = readFileSync("D:/tmp/kindlayer-III0/SPEC-v2.md", "utf8").replace(/\r/g, "").split("\n");

// Appendix A.2 proposed roles per series.
const specSwitch = new Map<string, { role: string; conf: string; parts: number }>();
{
  const i = spec.findIndex((l) => l.startsWith("## A.2"));
  for (let j = i + 1; j < spec.length && !spec[j].startsWith("## "); j++) {
    const l = spec[j];
    if (!l.startsWith("| ") || l.startsWith("| series") || l.startsWith("|---")) continue;
    const c = l.split("|").slice(1, -1).map((x) => x.trim());
    specSwitch.set(c[0], { parts: Number(c[1]), role: c[2], conf: c[3] });
  }
}

const KINDS: Record<string, [string, string]> = {
  switch: ["switches", "switch"], ap: ["wireless", "ap"], router: ["routers", "enterprise"], phone: ["collaboration-endpoints", "phone"],
};

function specRole(kind: string, series: string, sku: string): string | null {
  if (kind === "switch") { const s = specSwitch.get(series); return s ? s.role : null; }
  if (kind === "ap") return SPEC_AP[series] ?? null;
  if (kind === "router") return SPEC_ROUTER[series] ?? null;
  return specPhoneRole(series, sku);
}

function classify(kind: string, sku: string, name: string): { rule: Rule | null } {
  const S = normalise(sku);
  const R = sku.toUpperCase().trim().replace(/=+$/, "");
  for (const r of RULES) {
    if (r.kind !== kind) continue;
    if (r.raw && !r.raw.test(R)) continue;
    if (r.re && !r.re.test(S)) continue;
    if (r.name && !r.name.test(name)) continue;
    if (!r.raw && !r.re && !r.name) continue;
    return { rule: r };
  }
  return { rule: null };
}

const out: any[] = [];
for (const [kind, [cat, k]] of Object.entries(KINDS)) {
  for (const p of rows.filter((r) => r.category === cat && r.kind === k)) {
    const { rule } = classify(kind, p.sku, p.name ?? "");
    const sr = specRole(kind, p.series ?? "(null)", p.sku);
    out.push({
      kind, sku: p.sku, name: p.name ?? "", series: p.series ?? "(null)", spec_doc: p.spec_doc,
      rule: rule?.id ?? "unmatched", role: rule?.role ?? null, issue: rule?.issue ?? null, spec_role: sr,
    });
  }
}
writeFileSync("D:/tmp/kindlayer-III0/B/classified.json", JSON.stringify(out));

// ---------------- report for reading
const lines: string[] = [];
const summary: any = { kinds: {}, series: [], rules: {}, mixed: [] };
const placeholder = (n: string) => /^Cisco\s+\S+$/.test(n.trim()) || !n.trim();
for (const kind of Object.keys(KINDS)) {
  const ks = out.filter((r) => r.kind === kind);
  const roles: Record<string, number> = {};
  const issues: Record<string, number> = {};
  let unresolved = 0;
  for (const r of ks) {
    if (r.issue) issues[r.issue] = (issues[r.issue] ?? 0) + 1;
    else if (r.role) roles[r.role] = (roles[r.role] ?? 0) + 1;
    else unresolved++;
  }
  const issueTotal = Object.values(issues).reduce((a, b) => a + b, 0);
  const members = ks.length - issueTotal;
  // disagreement with the spec, counted per row
  let agree = 0, differ = 0, specNone = 0, issueVsSpec = 0, nullVsSpec = 0;
  for (const r of ks) {
    if (r.spec_role === null || r.spec_role === "?") { specNone++; continue; }
    if (r.issue) { issueVsSpec++; continue; }
    if (!r.role) { nullVsSpec++; continue; }
    if (r.role === r.spec_role) agree++; else differ++;
  }
  summary.kinds[kind] = {
    parts: ks.length, members, roles, issues, issue_total: issueTotal, unresolved,
    null_share_members: +(unresolved / members).toFixed(4),
    null_share_all: +((unresolved + issueTotal) / ks.length).toFixed(4),
    spec_rows: { agree, differ_role: differ, spec_none_or_q: specNone, kind_issue_spec_gave_role: issueVsSpec, unresolved_spec_gave_role: nullVsSpec },
    series_count: new Set(ks.map((r) => r.series)).size,
  };
  lines.push(`\n######## ${kind}: ${ks.length} parts, members ${members}, roles ${JSON.stringify(roles)}, issues ${issueTotal}, unresolved ${unresolved}`);
  const bySeries = new Map<string, any[]>();
  for (const r of ks) { if (!bySeries.has(r.series)) bySeries.set(r.series, []); bySeries.get(r.series)!.push(r); }
  for (const [s, rs] of [...bySeries.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sRoles: Record<string, number> = {}; const sIss: Record<string, number> = {}; let sNull = 0;
    const byRule = new Map<string, any[]>();
    for (const r of rs) {
      if (r.issue) sIss[r.issue] = (sIss[r.issue] ?? 0) + 1; else if (r.role) sRoles[r.role] = (sRoles[r.role] ?? 0) + 1; else sNull++;
      if (!byRule.has(r.rule)) byRule.set(r.rule, []); byRule.get(r.rule)!.push(r);
    }
    const sp = kind === "switch" ? specSwitch.get(s) : null;
    const specR = kind === "switch" ? (sp ? `${sp.role} (${sp.conf})` : "-") : (kind === "phone" ? "desk/token" : ((kind === "ap" ? SPEC_AP[s] : SPEC_ROUTER[s]) ?? "-"));
    let dis = 0;
    for (const r of rs) { if (r.spec_role && r.spec_role !== "?" && (r.issue || !r.role || r.role !== r.spec_role)) dis++; }
    const samples = [];
    const seen = new Set<string>();
    for (const [, rr] of byRule) { const named = rr.find((x) => !placeholder(x.name)) ?? rr[0]; if (!seen.has(named.sku)) { seen.add(named.sku); samples.push({ sku: named.sku, name: named.name.slice(0, 90), rule: named.rule }); } }
    for (const r of rs) { if (samples.length >= 3) break; if (!seen.has(r.sku) && !placeholder(r.name)) { seen.add(r.sku); samples.push({ sku: r.sku, name: r.name.slice(0, 90), rule: r.rule }); } }
    summary.series.push({ kind, series: s, parts: rs.length, spec_doc: rs.filter((r) => r.spec_doc).length, roles: sRoles, issues: sIss, unresolved: sNull, spec: specR, spec_parts: sp?.parts ?? null, disagree_rows: dis, rules: [...byRule.entries()].map(([id, rr]) => ({ id, n: rr.length })), samples });
    if (Object.keys(sRoles).length > 1) summary.mixed.push({ kind, series: s, roles: sRoles, issues: sIss, unresolved: sNull, rules: [...byRule.entries()].map(([id, rr]) => ({ id, n: rr.length })) });
    lines.push(`\n## ${s} | ${rs.length} | roles ${JSON.stringify(sRoles)} issues ${JSON.stringify(sIss)} null ${sNull} | spec ${specR} | disagree ${dis}`);
    for (const [id, rr] of byRule) {
      // distinct name "stems" for reading: first 60 chars of name, deduplicated
      const names = [...new Set(rr.map((x) => `${x.sku.slice(0, 22)} «${x.name.slice(0, 70)}»`))];
      lines.push(`  [${id}] ×${rr.length}: ${names.slice(0, 6).join(" | ")}${names.length > 6 ? ` … (+${names.length - 6})` : ""}`);
    }
  }
}
for (const r of RULES) summary.rules[r.id] = out.filter((x) => x.rule === r.id).length;
summary.rules["unmatched"] = out.filter((x) => x.rule === "unmatched").length;
writeFileSync("D:/tmp/kindlayer-III0/B/classify-report.txt", lines.join("\n"));
writeFileSync("D:/tmp/kindlayer-III0/B/summary.json", JSON.stringify(summary, null, 1));
for (const [k, v] of Object.entries(summary.kinds)) console.log(k, JSON.stringify(v));
console.log("rules with zero matches:", Object.entries(summary.rules).filter(([, n]) => n === 0).map(([id]) => id).join(", ") || "none");
console.log("unmatched rows:", summary.rules["unmatched"]);
