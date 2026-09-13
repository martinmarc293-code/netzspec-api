"""Render III0-1-label-shares.md and III0-2-jaccard.md from raw/item1-label-shares.json and raw/item2-jaccard.json."""
import json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
A = "D:/tmp/kindlayer-III0/A"
i1 = json.load(open(A + "/raw/item1-label-shares.json", encoding="utf-8"))
i2 = json.load(open(A + "/raw/item2-jaccard.json", encoding="utf-8"))
meta = i1["meta"]
HEAD = sys.argv[1] if len(sys.argv) > 1 else "?"

def c(x):
    if x is None:
        return "—"
    return str(x).replace("|", "/").replace("\n", " ")

def f(x):
    return "—" if x is None else ("%g" % x)

PRIORITY = ["switches.switch", "wireless.ap", "routers.enterprise", "collaboration-endpoints.phone", "transceiver.pluggable",
            "servers-unified-computing.server", "servers-unified-computing.cpu", "servers-unified-computing.drive",
            "video.transmitter", "security.firewall"]

def table(rows, out):
    out.append("| cup | proposed | today (HEAD profile) | label occ. (held docs) | inventory occ. | **share %** | attr % | kind-doc % | facts % (doc+inh) | prose % | unmapped-label hint | fill path | verdict |")
    out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        hint = "—"
        if r.get("hint_unmapped_share") is not None and (r["share"] or 0) < 50 and r["hint_labels"]:
            hint = "%s%% · %s" % (f(r["hint_unmapped_share"]), c(r["hint_labels"][0]))
        facts = f(r["share_facts"])
        if r.get("share_relation") is not None:
            facts += " · relation " + f(r["share_relation"])
        cup = c(r["cup"]) + (" **NEW**" if r["isNew"] else "")
        verdict = c(r["verdict"]) + (" ⚑ attribution-sensitive" if r.get("flag") else "")
        if r["isNew"] and r["top_labels"]:
            verdict += " — would-map labels: " + c("; ".join(r["top_labels"][:3]))
        origin = "" if r["origin"] in ("",) else ""
        out.append("| %s | %s | %s | %s | %s | **%s** | %s | %s | %s | %s | %s | %s | %s |" % (
            cup, c(r["proposed"]), c(r["today"]), r["doc_label_occ"], f(r["inv_occ"]), f(r["share"]), f(r["share_attr"]),
            f(r.get("share_kind_docs")), facts, f(r["share_prose"]), hint, c(r["fill_path"]), verdict))

def fails(rows):
    """proposed required/pending (non-NEW, non-demotion) cups under the bar"""
    return [r for r in rows if r["proposed"] in ("required",) or r["proposed"].startswith("pending")
            if not r["isNew"] and r["share"] is not None and r["share"] < 50 and "derivation" not in r["verdict"]
            and "demotion" not in r["origin"]]

def passes(rows):
    return [r for r in rows if (r["proposed"] == "required" or r["proposed"].startswith("pending")) and not r["isNew"]
            and r["share"] is not None and r["share"] >= 50]

def demotions(rows):
    return [r for r in rows if "demotion" in r["origin"] or r["proposed"] == "demotion candidate"]

def cov(cv):
    return "parts %d · held %d · readable held %d (unreadable %d) · readable held docs %d" % (
        cv["parts"], cv["held"], cv["readable_held"], cv["unreadable_held"], cv["readable_docs"])

out = []
out.append("# Kind layer III.0 item 1 — label-occurrence shares over HELD parts, per (kind, role)")
out.append("")
out.append("Agent `kindlayer-A`, measurement only (nothing from Part II implemented). Repo `D:\\Project\\netzspec-api-cisco` at HEAD `%s`; live store read-only (`application_name agent/kindlayer-A`) at %s. Raw JSON: `raw/item1-label-shares.json`. Scripts: `scripts/`." % (HEAD, meta["generated_at"]))
out.append("")
out.append("## Evidence method and coverage (read this first)")
out.append("")
cv = meta["coverage"]
out.append("- **Population:** live Cisco hardware (`retired_at IS NULL AND product_class='hardware'`) = **%d** parts (spec v2 says 42,383). Kind = `partKind(category, sku, name)` exactly as `scripts/build-cup-ledger.mts` calls it." % cv["live_cisco_hardware"])
out.append("- **Held** = linked through `doc_parts` to a `source_docs` row whose `doc_type` is in the **ledger builder's** list `vendor_datasheet_html, vendor_datasheet_pdf, vendor_page, vendor_tool` (this includes `vendor_page`; `src/core/docClass.ts` SPEC_BEARING does not — the ledger's list was used). Held parts: **%d**; held spec-bearing documents: **%d**." % (cv["held"], cv["held_spec_docs"]))
out.append("- **Label evidence is PER DOCUMENT, from the pipeline's own extractors re-run on the laptop cache copy** (`scraper/cache`, a working copy of the box cache): `adapters/cisco_specs_deep.extract_document` for cisco.com HTML, `sources/meraki.extract` for documentation.meraki.com; PDF labels are NOT re-run — they come from the PDF extractor's recorded output `runs/extract/cisco-pdf-*.json` matched on `source_url`. Every label is mapped with the real `mapLabel(label, part.category)` at HEAD (sentinels `__*` count as unmapped).")
st = cv["doc_status"]
out.append("- **Document coverage:** %s. Readable documents that yielded zero labels: %d (counted as readable, printing nothing)." % (", ".join("%s = %d" % (k, v) for k, v in sorted(st.items())), cv["readable_docs_with_zero_labels"]))
out.append("- **Part coverage:** held parts with ≥1 readable held document = **%d / %d (%.1f%%)**. Every share below is over the READABLE held parts of that kind/role; the per-section coverage line gives both numbers." % (cv["readable_held"], cv["held"], 100.0 * cv["readable_held"] / cv["held"]))
ctl = meta["control"]
out.append("- **Control (can fail):** of %d stored document-sourced value facts on readable held parts, **%s%%** have their key present in the re-extracted label evidence of that part (%d). Misses are expected where a fact came from a non-spec document or an older document version; the largest missing keys: %s." % (
    ctl["doc_facts_on_readable_held_parts"], ctl["share"], ctl["key_present_in_reextracted_labels"], ", ".join("%s %d" % (k, v) for k, v in ctl["top_missing_keys"][:8])))
out.append("- **share %** (the verdict basis, the spec's join) = a part is evidenced for a cup when ANY readable held document linked to it prints a label that maps to one of the cup's keys. **attr %** = stricter: only labels in the document's family-scope records or in the record of the part's own SKU. **kind-doc %** = only documents where this (category, kind) holds ≥50% of the document's live-hardware part links (a document ABOUT this kind). A row is flagged **⚑ attribution-sensitive** when attr % or kind-doc % lands on the other side of 50% — typical for component kinds, which are linked to their HOST's datasheet and inherit the host's rows at document level.")
out.append("- **facts % (doc+inh)** = held parts holding a current, non-retracted value fact from a document or inherited under the key; **prose %** = description/name-mining facts. These are **facts-based presence, NOT label presence**, shown beside the label share only. For `product_compatibility` the column also gives the share of held parts with an outgoing `compatible`/`module_of`/`accessory_for` relation (I.4: the COMPAT fill path is the relation).")
out.append("- **label occ. (held docs)** = (document, distinct label) pairs mapping to the cup across the kind's readable held documents. **inventory occ.** = the committed ledger's category-level `label_occurrences` (from `runs/vocab/cisco-datasheets/labels.json`, not per document); for keys the ledger does not carry it is the inventory `field_key` count (category-unscoped), marked † in fill path.")
out.append("- **fill path** from the committed `data/ledger/cisco-<category>.json` (seen / derived / seed-only / none; `(filled)` = `observed_filled`); † = recomputed the same way for a key the ledger does not list for that category.")
out.append("- **today** = `kindQuestionSet(category, current kind)` at HEAD. **Gated (pending) cups are measured over ALL held parts of the kind, not over the gate-open population.**")
out.append("- **unmapped-label hint** (only where share <50%): share of readable held parts with no mapped label for the cup but an UNMAPPED label matching a keyword for it, with the top such label. An upper bound that also catches feature bullets; never used for a verdict. It separates \"the datasheet does not print it\" from \"the mapper at HEAD does not map it\".")
out.append("- **NEW keys** (not in the dictionary at HEAD: `drive_form_factor`, `drive_endurance_dwpd`, `gpu_memory`, `controller_cache`, `wlc_throughput`) are measured by a keyword regex over the same per-document labels (would-map), and are always optional. `display_size` is marked NEW in the spec but EXISTS at HEAD (commit 3aff73b) and is measured as a live key.")
out.append("- **Verdict rules:** proposed required/pending → `required — measured ≥50%` or `optional — promote when measured (<50%)`; role demotion candidates → `stays required (≥50%)` / `demote to optional (<50%)`; proposed optional → `optional as proposed` (+ `promotable` when ≥50%); cups whose every key is in `DERIVED_FILL_PATHS` → `required — registered derivation`.")
out.append("- **Roles are PROVISIONAL.** switch: Appendix A.2 parsed from SPEC-v2.md AS WRITTEN (`?` rows → unresolved; `heuristic` rows used as written, including `Business 350/250 Smart/220/110` → **industrial**, which contradicts II.1's prose — a sensitivity run with those four as `smb` is at the end). ap / router / phone: A.3–A.5 have no role column, so the series were assigned from the Part II prose (II.4, II.3, II.10) by this agent; the confidence per series (explicit = named in the prose, heuristic = my reading, ? = unresolved, moved-out = a wrong-table move) is listed in each role section. Router rows the spec moves out (HWIC, WAE, ENCS, CRS, ASR 9000, NCS 5500, 8000) are excluded from every router role table.")
out.append("- **What this cannot see:** the laptop cache copy may not be the exact bytes the store extracted from; 18 held documents were unreadable here; shares measure what the mapper at HEAD maps, so a mapper gap reads as label absence (see the hint column).")
out.append("")

# ---------------- headline ----------------
out.append("## Headline verdicts (priority kinds and roles)")
out.append("")
kinds = i1["kinds"]
def headline(name, block):
    rows = block["rows"]
    if block["coverage"]["readable_held"] == 0:
        return "- **%s** — not measurable: 0 readable held parts (%s)." % (name, cov(block["coverage"]))
    fl = fails(rows)
    ps = passes(rows)
    s = "- **%s** (%d readable held of %d parts): proposed required/pending passing ≥50%%: %d; **failing (<50%%) → optional: %s**" % (
        name, block["coverage"]["readable_held"], block["coverage"]["parts"], len(ps),
        ", ".join("`%s` %s" % (r["cup"], f(r["share"])) for r in fl) or "none")
    dm = demotions(rows)
    if dm:
        s += "; demotion candidates: " + ", ".join("`%s` %s → %s" % (r["cup"], f(r["share"]), "STAYS REQUIRED" if r["share"] is not None and r["share"] >= 50 else "demote") for r in dm)
    return s
for k in PRIORITY:
    e = kinds[k]
    out.append(headline(k, e))
    for role, rb in (e.get("roles") or {}).items():
        out.append("  " + headline("%s · role `%s`" % (k, role), rb))
out.append("")

# ---------------- sections ----------------
def section(k, e):
    out.append("## %s — target: %s" % (k, c(e["target"])))
    out.append("")
    if e.get("note"):
        out.append("_Note: %s_" % e["note"])
        out.append("")
    out.append("Coverage (kind level): " + cov(e["coverage"]))
    out.append("")
    if e["coverage"]["readable_held"] == 0:
        out.append("**Not measurable — no readable held parts.** Proposed cups: " + ", ".join("`%s`(%s)" % (r["cup"], r["proposed"]) for r in e["rows"]))
        out.append("")
        return
    table(e["rows"], out)
    out.append("")
    if e.get("roles"):
        un = e.get("unresolved_or_moved") or {}
        if un:
            out.append("Parts with no role (unresolved / moved-out), by series: " + ", ".join("%s %d" % (c(s), v["parts"]) for s, v in sorted(un.items(), key=lambda x: -x[1]["parts"])))
            out.append("")
        for role, rb in e["roles"].items():
            out.append("### %s · role `%s` (provisional)" % (k, role))
            out.append("")
            if rb.get("note"):
                out.append("_Delta note: %s_" % rb["note"])
                out.append("")
            out.append("Coverage: " + cov(rb["coverage"]))
            out.append("")
            ser = rb.get("series") or {}
            byconf = {}
            for s, v in ser.items():
                byconf.setdefault(v["confidence"], []).append((s, v))
            parts_line = []
            for conf, lst in sorted(byconf.items()):
                lst.sort(key=lambda x: -x[1]["parts"])
                parts_line.append("**%s** (%d parts): %s" % (conf, sum(v["parts"] for _, v in lst),
                                  ", ".join("%s %d/%d" % (c(s), v["parts"], v["readable_held"]) for s, v in lst)))
            out.append("Series in this role (parts/readable held): " + " · ".join(parts_line))
            out.append("")
            if rb["coverage"]["readable_held"] == 0:
                out.append("**Not measurable — no readable held parts in this role.**")
                out.append("")
                continue
            table(rb["rows"], out)
            out.append("")

done = set()
for k in PRIORITY:
    section(k, kinds[k]); done.add(k)
out.append("---")
out.append("")
out.append("# Remaining kinds (Part II order by category)")
out.append("")
not_measurable = []
for k, e in kinds.items():
    if k in done:
        continue
    if e["coverage"]["readable_held"] == 0:
        not_measurable.append((k, e))
        continue
    section(k, e)
out.append("## Kinds with no readable held parts (not measurable)")
out.append("")
out.append("| kind | target | parts | held | readable held | proposed cups |")
out.append("|---|---|---|---|---|---|")
for k, e in not_measurable:
    out.append("| %s | %s | %d | %d | %d | %s |" % (k, c(e["target"]), e["coverage"]["parts"], e["coverage"]["held"], e["coverage"]["readable_held"],
               ", ".join("%s(%s)" % (r["cup"].replace("|", "/"), r["proposed"][:3]) for r in e["rows"])))
out.append("")
out.append("Kinds the spec proposes that do not exist yet and so have no held parts to measure: `switches.chassis` (inside `switch` today), `transceiver.cable` (DAC/AOC inside `pluggable`), `routers.appliance`, `storage-networking.fc-switch` (measured under its current name `switch`), and `sp-core` rows still inside `routers.enterprise`. Item 4 counts these populations; this item does not.")
out.append("")

# ---------------- sensitivity ----------------
sw = kinds["switches.switch"]
alt = sw.get("roles_sensitivity-business-smb")
if alt:
    out.append("## Sensitivity: switches.switch with `Business 350`, `Business 250 Smart`, `Business 220`, `Business 110 Series Unmanaged` read as `smb` (II.1 prose) instead of `industrial` (A.2 as written)")
    out.append("")
    for role in ("smb", "industrial"):
        a, b = sw["roles"][role], alt[role]
        out.append("- role `%s`: as written %s; sensitivity %s" % (role, cov(a["coverage"]), cov(b["coverage"])))
        diffs = []
        amap = {r["cup"]: r for r in a["rows"]}
        for r in b["rows"]:
            ra = amap.get(r["cup"])
            if ra and ra["verdict"].split(" ·")[0] != r["verdict"].split(" ·")[0]:
                diffs.append("`%s` %s%% (%s) → %s%% (%s)" % (r["cup"], f(ra["share"]), ra["verdict"].split(" —")[0], f(r["share"]), r["verdict"].split(" —")[0]))
        out.append("  - verdict changes: " + ("; ".join(diffs) if diffs else "none"))
    out.append("")
    out.append("Full sensitivity tables are in `raw/item1-label-shares.json` under `roles_sensitivity-business-smb`.")
    out.append("")

open(A + "/III0-1-label-shares.md", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("wrote III0-1", len(out), "lines")

# =====================================================================================================
o = []
o.append("# Kind layer III.0 item 2 — term-13 label-Jaccard, before and after the role split")
o.append("")
o.append("Agent `kindlayer-A`, HEAD `%s`, same evidence as item 1 (per-document labels from the pipeline's extractors re-run on the laptop cache, PDF labels from recorded extractor output, `mapLabel(label, category)` at HEAD; held = ledger's spec-bearing doc types; %d of %d held parts readable). Raw: `raw/item2-jaccard.json` (includes every group with its evidenced key set)." % (HEAD, cv["readable_held"], cv["held"]))
o.append("")
o.append("## Formula implemented")
o.append("")
o.append("```")
o.append("groups   G = parts of the kind grouped by parts.series; null/empty series -> first token of the name after a leading 'Cisco'")
o.append("           only groups with >= 1 READABLE HELD part are kept (evidence exists only for held parts)")
o.append("n_g      = number of readable held parts in group g            (variant 'all-part weights': all parts of the group)")
o.append("K        = the kind's required-cup keys:")
o.append("           K_now      = kindQuestionSet(category, kind).required  UNION  .pending keys  (today's profile at HEAD)")
o.append("           K_proposed = proposed required + pending keys of the archetype (core before the split; core + role adds - role demotions after)")
o.append("S_g      = { k in K : at least one readable held part of g has a document printing a label that maps to k }   (union)")
o.append("           variant 'majority': k evidenced on >= 50% of g's readable held parts")
o.append("           variant 'label strings': the raw label strings (not keys) that map into K_now")
o.append("J(a,b)   = |S_a ∩ S_b| / |S_a ∪ S_b|;   pairs with S_a = S_b = ∅ are skipped (0/0) and counted")
o.append("mean     = Σ_{a<b} n_a·n_b·J(S_a,S_b)  /  Σ_{a<b} n_a·n_b          (all unordered pairs of distinct groups)")
o.append("after    = the same sum POOLED over pairs whose two groups share a role (groups are formed within a role);")
o.append("           parts with no role (unresolved / '?') are reported as their own bucket and excluded from the pooled mean;")
o.append("           router rows the spec moves out of the kind are excluded after the split")
o.append("fails    = mean < 0.5")
o.append("```")
o.append("")
o.append("## Summary")
o.append("")
o.append("| kind | groups (readable) | before: K_now union | before: majority | before: label strings | before: K_proposed | after (pooled within role): K_now union | after: majority | after: label strings | after: K_proposed |")
o.append("|---|---|---|---|---|---|---|---|---|---|")
for k, v in i2["kinds"].items():
    b = v["before_all_rows"]
    a = v.get("after_pooled_within_role")
    o.append("| %s | %d | **%s** | %s | %s | %s | %s | %s | %s | %s |" % (
        k, b["now_union_heldweights"]["groups"], f(b["now_union_heldweights"]["mean"]), f(b["now_majority"]["mean"]), f(b["now_label_strings"]["mean"]),
        f(b["proposed_union"]["mean"]),
        ("**%s**" % f(a["now_union"])) if a else "— (no role axis proposed)", f(a["now_majority"]) if a else "—",
        f(a["now_label_strings"]) if a else "—", f(a["proposed_union"]) if a else "—"))
o.append("")
o.append("Other variants per kind (before): all-part weights, dropping groups with an empty set — see the detail tables.")
o.append("")
for k, v in i2["kinds"].items():
    o.append("## %s" % k)
    o.append("")
    o.append("K_now (%d): %s" % (len(v["K_now"]), ", ".join("`%s`" % x for x in v["K_now"])))
    o.append("")
    o.append("K_proposed core (%d): %s" % (len(v["K_proposed_core"]), ", ".join("`%s`" % x for x in v["K_proposed_core"])))
    o.append("")
    b = v["before_all_rows"]
    o.append("| before-split variant | mean | groups | pairs | pairs skipped (both empty) |")
    o.append("|---|---|---|---|---|")
    for name, lab in [("now_union_heldweights", "K_now, union, readable-held weights"), ("now_union_allpartweights", "K_now, union, all-part weights"),
                      ("now_union_drop_empty_groups", "K_now, union, groups with empty set dropped"), ("now_majority", "K_now, majority"),
                      ("now_label_strings", "label strings into K_now"), ("proposed_union", "K_proposed core, union")]:
        x = b[name]
        o.append("| %s | **%s** | %d | %d | %d |" % (lab, f(x["mean"]), x["groups"], x["pairs"], x["skipped_both_empty"]))
    o.append("")
    if "before_excluding_moved_out" in v and k.startswith("routers"):
        o.append("Before, excluding the moved-out router rows: K_now union %s, K_proposed %s." % (
            f(v["before_excluding_moved_out"]["now_union_heldweights"]["mean"]), f(v["before_excluding_moved_out"]["proposed_union"]["mean"])))
        o.append("")
    if "after_per_role" in v:
        a = v["after_pooled_within_role"]
        o.append("**After the split (pooled within role):** K_now union **%s** · majority %s · label strings %s · K_proposed %s" % (
            f(a["now_union"]), f(a["now_majority"]), f(a["now_label_strings"]), f(a["proposed_union"])))
        o.append("")
        thin = [role for role, rv in v["after_per_role"].items() if role != "(unresolved)" and rv["now_union_heldweights"]["pairs"] == 0]
        if thin:
            o.append("_Caution: roles with no measurable pair (fewer than two groups holding readable evidence) contribute nothing to the pooled mean: %s. The pooled 'after' number describes only the remaining roles._" % ", ".join("`%s`" % t for t in thin))
            o.append("")
        o.append("| role | parts | readable held | groups (readable) | K_now union | majority | label strings | K_role union | pairs | skipped |")
        o.append("|---|---|---|---|---|---|---|---|---|---|")
        for role, rv in v["after_per_role"].items():
            x = rv["now_union_heldweights"]
            o.append("| %s | %d | %d | %d | %s | %s | %s | %s | %d | %d |" % (role, rv["parts"], rv["readable_held"], x["groups"], f(x["mean"]),
                     f(rv["now_majority"]["mean"]), f(rv["now_label_strings"]["mean"]), f(rv["proposed_union"]["mean"]), x["pairs"], x["skipped_both_empty"]))
        o.append("")
    # largest groups
    gs = b.get("groups") or []
    if gs:
        o.append("Largest groups (before): " + "; ".join("%s n=%d/%d |S|=%d" % (c(g["group"]), g["readable_held"], g["parts"], len(g["now_keys"])) for g in gs[:12]))
        o.append("")

open(A + "/III0-2-jaccard.md", "w", encoding="utf-8").write("\n".join(o) + "\n")
print("wrote III0-2", len(o), "lines")
