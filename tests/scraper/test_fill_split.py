"""scripts/fill-split-families.py: the document family, and what commits tonight vs what is staged (reviewer ruling B, 30 Sep
2026: a family seen for the first time is staged until the day adds >= 5 golden rows; a family with golden rows commits).

    python3.11 tests/scraper/test_fill_split.py
"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("split", Path(__file__).resolve().parents[2] / "scripts" / "fill-split-families.py")
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

C9300 = "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html"
C9300_PDF = "https://www.cisco.com/c/dam/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.pdf"
CASES = [
    ("an HTML datasheet's family is its series directory", S.family_of(C9300),
     "https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/"),
    ("the same series' PDF under /c/dam/ has its own directory (a different prefix, same series segment)", S.family_of(C9300_PDF),
     "https://www.cisco.com/c/dam/en/us/products/collateral/switches/catalyst-9300-series-switches/"),
    ("a file directly under collateral/<area>/ never takes the file name into the family",
     S.family_of("https://www.cisco.com/c/en/us/products/collateral/switches/x-data-sheet.html"),
     "https://www.cisco.com/c/en/us/products/collateral/switches/"),
    ("a spare's '=' and case do not separate a PID", S.norm(" c9300-24p= "), "C9300-24P"),
    ("a family listing PIDs, none of them ours, is staged as no_listed_parts (which demotes)",
     S.decide(3, 0, 40, 0, 0, docs_with_pids=2)[1].split(":")[0], "no_listed_parts"),
    ("a family whose documents listed NO PID at all is an extractor gap, never no_listed_parts (dry run 5: 27 UCS sheets)",
     S.decide(3, 0, 40, 0, 0, docs_with_pids=0)[1].split(":")[0], "no_pid_list"),
    ("a new family (golden rows < 5) is staged, golden rows owed", S.decide(3, 2, 40, 0, 4)[0], "staged"),
    ("...and the reason says how many are owed", S.decide(3, 2, 40, 0, 4)[1], "golden rows owed: 4 in scope, 5 needed"),
    ("a family with 5 golden rows and a clean extract commits", S.decide(3, 2, 40, 1, 5)[0], "commit"),
    ("defects over 5% of the facts stage it", S.decide(3, 2, 40, 3, 9)[0], "staged"),
    ("defects at exactly 5% still commit (the budget is 'more than')", S.decide(3, 2, 40, 2, 9)[0], "commit"),
]


def main() -> int:
    miss = 0
    for name, got, want in CASES:
        if got != want:
            miss += 1
            print(f"MISS | {name}: got {got!r}, want {want!r}")
    print(f"fill split: {len(CASES) - miss} passed, {miss} missed")
    return 1 if miss else 0


if __name__ == "__main__":
    raise SystemExit(main())
