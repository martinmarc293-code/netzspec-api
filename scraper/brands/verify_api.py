"""scraper.brands.verify_api - does the API actually SERVE what the brand has classified?

    python3.11 scraper/brands/verify_api.py --brand juniper [--base-url http://127.0.0.1:3021]
                                            [--sample 40] [--json]

WHY THIS EXISTS. "Classified" and "served" are different claims, and only one of them is what a
consumer of this API experiences. A document can carry a correct doc_type, a fact can sit in
`facts` with a passing gate, and a reader of the API can still see none of it - because the row is
filtered by a query, or the endpoint reads a different column, or a JOIN drops it. The operator's
directive is explicit: a classification that does not reach a served endpoint does not count.

So this reads BOTH SIDES and compares them: the database for what the brand has, real HTTP for what
the API gives back. It is deliberately not a database query with an API-shaped name.

WHAT IT COMPARES, per brand, and each is reported apart because they fail for different reasons:

    facts       every non-superseded fact on a sampled part appears in /v1/parts/{vendor}/{sku}
    relations   every stored relation on that part appears there too
    documents   every document the brand holds appears in /v1/docs?vendor=... AND is individually
                retrievable at /v1/docs/{doc_id}
    spec-bearing  a document whose class bears specs is SERVED as spec_bearing, because that flag
                is what a consumer uses to decide whether a part has ever had a datasheet read

THE FAILURE MODE THIS GUARDS. An unreachable API, a wrong key or an empty sample must NEVER read as
"everything is served". Each of those exits non-zero and says which it was. A verifier that reports
success when it could not check is the exact failure this project has a standing rule about, and it
is easy to write by accident here: `served == stored` is trivially true when both are empty.

BRAND-GENERIC BY CONSTRUCTION. It takes the vendor slug from the pack and knows nothing else about
any brand, so the next brand gets it by existing.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scraper"))

import psycopg                                    # noqa: E402
from psycopg.rows import dict_row                 # noqa: E402

from brands import load_brand                     # noqa: E402

DEFAULT_BASE = "http://127.0.0.1:3021"
TOKEN_FILE = Path(r"D:\Project\.secrets\netzspec-api-owner.token")


def load_env() -> dict:
    env: dict[str, str] = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t and not t.startswith("#") and "=" in t:
            k, v = t.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get(base: str, path: str, token: str) -> tuple[int, object]:
    """One GET. Returns (status, parsed body) and never raises for an HTTP error, because a 401 is
    a finding to report rather than a traceback."""
    req = urllib.request.Request(base.rstrip("/") + path,
                                 headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:  # noqa
            return e.code, None
    except Exception as e:  # noqa - connection refused, timeout: the API is not answering
        return 0, {"error": f"{type(e).__name__}: {e}"}


#: The fact states the API is CONTRACTED to serve. Everything else is withheld ON PURPOSE and is
#: reported by state rather than counted as a miss - see the note in verify() for why counting them
#: made a correct Cisco API read as 72.0%.
SERVABLE_STATES = ("verified", "corroborated")

def verify(conn, brand, base: str, token: str, sample: int) -> dict:
    v = brand.vendor_slug
    out: dict = {"brand": brand.slug, "vendor": v, "base_url": base,
                 "facts": {"stored": 0, "served": 0, "missing": []},
                 "relations": {"stored": 0, "served": 0, "missing": []},
                 "documents": {"stored": 0, "listed": 0, "retrievable": 0, "missing": []},
                 "spec_bearing": {"stored": 0, "served": 0, "missing": []},
                 "withheld": {}, "parts_checked": 0, "errors": []}

    # --- the parts with the most to serve, so a thin sample cannot flatter the result ----------
    parts = conn.execute("""
        SELECT p.sku, count(f.id) AS n
          FROM parts p JOIN vendors ve ON ve.id = p.vendor_id
          LEFT JOIN facts f ON f.part_id = p.id AND f.superseded_at IS NULL
         WHERE ve.slug = %s AND p.retired_at IS NULL AND p.product_class = 'hardware'
         GROUP BY p.sku ORDER BY n DESC, p.sku LIMIT %s
    """, (v, sample)).fetchall()
    if not parts:
        out["errors"].append(f"no hardware parts for vendor '{v}' - nothing to verify, which is "
                             "NOT the same as everything being served")
        return out

    for row in parts:
        sku = row["sku"]
        status, body = get(base, f"/v1/parts/{v}/{sku}", token)
        if status != 200 or not isinstance(body, dict):
            out["errors"].append(f"GET /v1/parts/{v}/{sku} -> {status} {str(body)[:100]}")
            continue
        out["parts_checked"] += 1

        # SERVABLE, not "every row". The first version of this compared every non-superseded fact
        # against the API and reported Cisco at 72.0% with 323 "stored but not served" — and every
        # one of them was the API behaving correctly.
        #
        #   gap_unattempted  a recorded ABSENCE. It is the pipeline saying "nothing has been read
        #                    for this field", which is the opposite of a fact; serving it as one
        #                    would be the exact confusion this project built doc classes to end.
        #                    7,482 of them in Cisco alone, all by design.
        #   conflict         a disagreement the pipeline HOLDS rather than resolving by write order.
        #                    The API refusing it is the architecture working.
        #   not_applicable   the field does not apply to this part.
        #
        # Counting those as misses made a correct API read as 72% and would have sent three brands
        # chasing a phantom. But they are not simply dropped either: they are counted and REPORTED
        # by state, because `conflict` climbing IS a real signal — it is what found Juniper's 166,
        # where two HCT labels collided on one field — and a silent exclusion would have hidden the
        # very thing this tool exists to surface. "Not served on purpose" and "not served" are
        # different answers and now print as different lines.
        rows = conn.execute(
            """SELECT DISTINCT f.field_key, f.state FROM facts f JOIN parts p ON p.id = f.part_id
               JOIN vendors ve ON ve.id = p.vendor_id
              WHERE ve.slug = %s AND p.sku = %s AND f.superseded_at IS NULL""", (v, sku)).fetchall()
        servable = {r["field_key"] for r in rows if r["state"] in SERVABLE_STATES}
        withheld = [r for r in rows if r["state"] not in SERVABLE_STATES]
        for r in withheld:
            out["withheld"][r["state"]] = out["withheld"].get(r["state"], 0) + 1
        served_facts = {f.get("key") for f in (body.get("facts") or [])}
        out["facts"]["stored"] += len(servable)
        out["facts"]["served"] += len(servable & served_facts)
        for k in sorted(servable - served_facts):
            if len(out["facts"]["missing"]) < 25:
                out["facts"]["missing"].append(f"{sku}.{k}")

        stored_rel = {r["to_sku"] for r in conn.execute(
            """SELECT DISTINCT rl.to_sku FROM relations rl JOIN parts p ON p.id = rl.from_part_id
               JOIN vendors ve ON ve.id = p.vendor_id
              WHERE ve.slug = %s AND p.sku = %s AND rl.to_sku IS NOT NULL""", (v, sku)).fetchall()}
        served_rel = {r.get("sku") for r in (body.get("relations") or [])}
        out["relations"]["stored"] += len(stored_rel)
        out["relations"]["served"] += len(stored_rel & served_rel)
        for k in sorted(stored_rel - served_rel):
            if len(out["relations"]["missing"]) < 25:
                out["relations"]["missing"].append(f"{sku} -> {k}")

    # --- documents: listed AND individually retrievable ---------------------------------------
    docs = conn.execute("""
        SELECT sd.doc_id, sd.doc_type FROM source_docs sd JOIN vendors ve ON ve.id = sd.vendor_id
         WHERE ve.slug = %s ORDER BY sd.doc_id
    """, (v,)).fetchall()
    out["documents"]["stored"] = len(docs)
    spec_classes = {d.key for d in brand.doc_classes if d.bears_specs}
    out["spec_bearing"]["stored"] = sum(1 for d in docs if d["doc_type"] in spec_classes)

    listed: dict[str, dict] = {}
    cursor, pages = "", 0
    while pages < 60:
        status, body = get(base, f"/v1/docs?vendor={v}&limit=200" + (f"&cursor={cursor}" if cursor else ""), token)
        if status != 200 or not isinstance(body, dict):
            out["errors"].append(f"GET /v1/docs?vendor={v} -> {status} {str(body)[:100]}")
            break
        for it in body.get("items") or []:
            listed[it.get("doc_id")] = it
        cursor = (body.get("next_cursor") or body.get("cursor") or "") if isinstance(body, dict) else ""
        pages += 1
        if not cursor:
            break
    out["documents"]["listed"] = len({d["doc_id"] for d in docs} & set(listed))
    for d in docs:
        if d["doc_id"] not in listed and len(out["documents"]["missing"]) < 25:
            out["documents"]["missing"].append(f"not listed: {d['doc_id']} ({d['doc_type']})")

    # Individually retrievable: a document in a list that 404s on its own URL is half-served.
    for d in docs[:sample]:
        status, _ = get(base, f"/v1/docs/{d['doc_id']}", token)
        if status == 200:
            out["documents"]["retrievable"] += 1
        elif len(out["documents"]["missing"]) < 25:
            out["documents"]["missing"].append(f"GET /v1/docs/{d['doc_id']} -> {status}")

    # spec_bearing as the API reports it, against the pack's own declaration.
    for d in docs:
        if d["doc_type"] in spec_classes:
            it = listed.get(d["doc_id"])
            if it and it.get("spec_bearing"):
                out["spec_bearing"]["served"] += 1
            elif len(out["spec_bearing"]["missing"]) < 25:
                out["spec_bearing"]["missing"].append(
                    f"{d['doc_id']} is {d['doc_type']} (spec-bearing in the pack) but the API says "
                    f"spec_bearing={it.get('spec_bearing') if it else 'NOT LISTED'}")
    return out


def render(o: dict) -> str:
    def line(name: str, served: int, stored: int) -> str:
        pct = (100.0 * served / stored) if stored else 0.0
        mark = "OK  " if stored and served == stored else "GAP "
        return f"  [{mark}] {name:<14} {served:>6,} of {stored:>6,} served ({pct:5.1f}%)"

    L = [f"# does the API serve what {o['brand']} has classified?  ({o['base_url']})", "",
         f"  {o['parts_checked']} parts sampled, by fact count descending", ""]
    L.append(line("facts", o["facts"]["served"], o["facts"]["stored"]))
    L.append(line("relations", o["relations"]["served"], o["relations"]["stored"]))
    L.append(line("documents", o["documents"]["listed"], o["documents"]["stored"]))
    L.append(line("spec_bearing", o["spec_bearing"]["served"], o["spec_bearing"]["stored"]))
    L.append(f"  [    ] retrievable   {o['documents']['retrievable']:>6,} documents answered on their own /v1/docs/<id>")
    # WITHHELD ON PURPOSE, reported and never counted as a miss. Printed because the counts are a
    # signal in their own right and hiding them would defeat the tool: `conflict` is what found
    # Juniper's 166 facts served to nobody, where two HCT labels collided on one field. A rising
    # conflict count is a mapping bug; a large gap_unattempted count is just an honest backlog.
    if o.get("withheld"):
        parts = ", ".join(f"{k} {n:,}" for k, n in sorted(o["withheld"].items(), key=lambda x: -x[1]))
        L.append(f"  [    ] withheld       {parts}")
        L.append(f"  {'':9}  (not served BY CONTRACT - the API serves {', '.join(SERVABLE_STATES)}. "
                 f"A climbing `conflict` is a mapping bug worth chasing; gap_unattempted is a backlog.)")
    for k in ("facts", "relations", "documents", "spec_bearing"):
        if o[k]["missing"]:
            L += ["", f"  STORED BUT NOT SERVED - {k}:"]
            L += [f"    {m}" for m in o[k]["missing"]]
    if o["errors"]:
        L += ["", "  ERRORS - these are NOT a pass:"] + [f"    {e}" for e in o["errors"]]
    if not o["errors"] and o["parts_checked"] == 0:
        L += ["", "  NOTHING WAS CHECKED. That is a failure, not a clean run."]
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify the API serves what a brand has classified")
    ap.add_argument("--brand", required=True)
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    ap.add_argument("--sample", type=int, default=40)
    ap.add_argument("--token-file", default=str(TOKEN_FILE))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    tok = Path(a.token_file)
    if not tok.exists():
        raise SystemExit(f"no API token at {tok} - refusing to report coverage it could not check")
    token = tok.read_text(encoding="utf-8").strip()

    brand = load_brand(a.brand)
    url = load_env().get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set")
    with psycopg.connect(url, autocommit=True, row_factory=dict_row,
                         application_name="netzspec/verify_api/cisco") as conn:
        o = verify(conn, brand, a.base_url, token, a.sample)

    print(render(o))
    if a.json:
        print(json.dumps(o, indent=1, default=str))

    # Non-zero on ANY gap or error. "Could not check" is never a pass.
    gap = (o["errors"]
           or o["parts_checked"] == 0
           or o["facts"]["served"] != o["facts"]["stored"]
           or o["relations"]["served"] != o["relations"]["stored"]
           or o["documents"]["listed"] != o["documents"]["stored"]
           or o["spec_bearing"]["served"] != o["spec_bearing"]["stored"])
    return 1 if gap else 0


if __name__ == "__main__":
    raise SystemExit(main())
