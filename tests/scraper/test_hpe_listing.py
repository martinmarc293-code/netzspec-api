"""tests/scraper/test_hpe_listing.py — proof for the HPE QuickSpecs enumeration in
scraper/sources/hpe_quickspecs.py (resolve('listing') + discover over the media-library JSON).

Synthetic fixtures only: the library JSON shape was read from the live endpoint on 2026-09-03
(stat.total 2894, items[].title, items[].cta.link ending in .<docid>.html). Half the cases are
refusals: a server QuickSpecs must NOT become a task, a short page must NOT queue a next page,
a non-JSON body must yield nothing.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scraper"))
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa
        pass
from sources import hpe_quickspecs as H  # noqa: E402

misses: list[str] = []
passed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed
    if ok:
        passed += 1
        print(f"PASS  {name}")
    else:
        misses.append(f"{name}: {detail}")
        print(f"MISS  {name}: {detail}")


def item(title: str, doc: str) -> dict:
    return {"label": "quickspecs", "title": title, "lastUpdated": "Aug 17, 2026",
            "cta": {"link": f"/us/en/resources.quickspecs.{title.lower().replace(' ', '-')}.{doc}.html?parentPage=/us/en/resource-library", "text": "Read more"},
            "shareBox": {"link": f"/us/en/resources.quickspecs.x.{doc}.html"}}


def page(items: list[dict]) -> str:
    body = json.dumps({"stat": {"total": 2894, "text": "Showing {0}-{1} results of {2}"}, "items": items})
    esc = body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f'<html><head></head><body><pre style="word-wrap: break-word;">{esc}</pre></body></html>'


# resolve
check("R1 listing key 1 -> first library page", H.resolve({"task": "listing", "key": "1"}) == H.LIBRARY_JSON, H.resolve({"task": "listing", "key": "1"}))
check("R2 listing key 7 -> &page=7", (H.resolve({"task": "listing", "key": "7"}) or "").endswith("&page=7"))
check("R3 listing with a full URL passes through", H.resolve({"task": "listing", "key": "https://www.hpe.com/x.json"}) == "https://www.hpe.com/x.json")
check("R4 listing with a non-numeric key is refused", H.resolve({"task": "listing", "key": "switches"}) is None)
check("R5 datasheet key doc id -> psnow url", H.resolve({"task": "datasheet", "key": "a00073540enw"}) == "https://www.hpe.com/psnow/doc/a00073540enw")

# discover: a full page with 20 items, 3 networking, 17 servers
items = [item("HPE Aruba Networking CX 6300 Switch Series QuickSpecs", "a00073540enw"),
         item("HPE ProLiant DL380 Gen11 Server QuickSpecs", "a00092000enw"),
         item("HPE Aruba Networking 650 Series Campus Access Points QuickSpecs", "a50004266enw"),
         item("HPE Networking Comware Switch Series 5945 QuickSpecs", "a00047323enw")]
items += [item(f"HPE ProLiant ML{i} Gen11 Server QuickSpecs", f"a0009{i:04d}enw") for i in range(1000, 1016)]
assert len(items) == 20
tasks = H.discover(page(items), {"task": "listing", "key": "1"})
ds = [t for t in tasks if t["task"] == "datasheet"]
nxt = [t for t in tasks if t["task"] == "listing"]
check("D1 three networking documents become datasheet tasks", len(ds) == 3, repr([t["key"] for t in ds]))
check("D2 doc ids are lower-case and urls absolute", all(t["key"] == t["key"].lower() and t["url"].startswith("https://www.hpe.com/psnow/doc/") for t in ds), repr(ds[:1]))
check("D3 the CX 6300 document is among them", any(t["key"] == "a00073540enw" for t in ds))
check("D4 no server QuickSpecs was queued (refusal)", not any("a00092000enw" == t["key"] or t["key"].startswith("a00091") for t in ds), repr([t["key"] for t in ds]))
check("D5 a full page queues page 2", len(nxt) == 1 and nxt[0]["key"] == "2", repr(nxt))
check("D6 datasheet tasks outrank the next page", all(t["priority"] < nxt[0]["priority"] for t in ds) if nxt else False)

# refusals
short = H.discover(page(items[:3]), {"task": "listing", "key": "4"})
check("D7 a short (last) page does not queue a next page", not any(t["task"] == "listing" for t in short), repr(short))
check("D8 a non-JSON body yields nothing", H.discover("<html><body><h1>QuickSpecs</h1></body></html>", {"task": "listing", "key": "1"}) == [])
check("D9 bare JSON (no <pre>) is accepted too", len(H.discover(json.dumps({"items": items[:4]}), {"task": "listing", "key": "1"})) == 3)
check("D10 discover on a datasheet task returns nothing", H.discover(page(items), {"task": "datasheet", "key": "a00073540enw"}) == [])
check("D11 an item without a doc id in its link is skipped", H.discover(page([{"title": "HPE Aruba Networking Switch QuickSpecs", "cta": {"link": "/us/en/nothing.html"}}]), {"task": "listing", "key": "1"}) == [])

print(f"\nhpe listing: {passed}/{passed + len(misses)} cases")
if misses:
    print("MISSES:\n  " + "\n  ".join(misses))
    sys.exit(1)
print("every refusal was for the stated reason")
