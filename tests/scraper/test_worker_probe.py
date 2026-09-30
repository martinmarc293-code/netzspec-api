"""scraper/worker_probe.py judge(): what counts as the document, and what STOPS the probe (reviewer ruling 30 Sep 2026:
a refusal or a challenge is never worked around -- the lane stops and reports).

    python3.11 tests/scraper/test_worker_probe.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scraper"))
from worker_probe import judge  # noqa: E402

DOC = "<html><table><tr><td>Ports</td><td>48</td></tr></table></html>"
CASES = [
    ("200 with a table is the document", {"status": 200, "html": DOC}, 0, "pass"),
    ("200 with no table is not the document", {"status": 200, "html": "<html>shell</html>"}, 0, "no-document"),
    ("403 stops", {"status": 403, "html": "Access Denied"}, 0, "stop"),
    ("429 stops", {"status": 429, "html": ""}, 0, "stop"),
    ("a page the browser judged blocked stops", {"status": 200, "html": DOC, "blocked": True}, 0, "stop"),
    # a challenge that CLEARED by itself still stops: the ruling is to stop and report, never to proceed past one
    ("a challenge seen during the fetch stops even when it cleared", {"status": 200, "html": DOC}, 1, "stop"),
    ("robots.txt refusal is its own answer", {"status": None, "html": "", "blocked": True, "reason": "robots"}, 0, "robots"),
    ("a <tablet> tag is not a table", {"status": 200, "html": "<html><tablet></tablet></html>"}, 0, "no-document"),
    ("a navigation error is not the document", {"status": None, "html": "", "error": "Timeout"}, 0, "no-document"),
]


def main() -> int:
    miss = 0
    for name, res, delta, want in CASES:
        got = judge(res, delta)[0]
        if got != want:
            miss += 1
            print(f"MISS | {name}: got {got}, want {want}")
    print(f"worker_probe judge: {len(CASES) - miss} passed, {miss} missed")
    return 1 if miss else 0


if __name__ == "__main__":
    raise SystemExit(main())
