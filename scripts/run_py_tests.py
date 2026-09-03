"""scripts/run_py_tests.py — runs every Python suite as its own process and fails if any fails.
Mirrors scripts/run-tests.ts: each suite prints PASS/MISS lines and exits non-zero on a miss.

    python3.11 scripts/run_py_tests.py [substring-filter]
"""
from __future__ import annotations
import subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
only = sys.argv[1] if len(sys.argv) > 1 else ""

files = sorted(ROOT.glob("tests/scraper/test_*.py")) + [ROOT / "scraper" / "test_extract_gate.py"]
# a source slug is hyphenated (hpe-quickspecs) while its module is underscored (hpe_quickspecs); accept either
files = [f for f in files if f.exists() and (not only or only in str(f) or only.replace("-", "_") in str(f))]
if not files:
    print("no python test files found"); sys.exit(1)

failed = 0
for f in files:
    r = subprocess.run([sys.executable, str(f)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    ok = r.returncode == 0
    failed += 0 if ok else 1
    tail = (r.stdout + r.stderr).strip().splitlines()
    tail = tail[-1:] if ok else tail[-25:]
    print(f"{'PASS' if ok else 'FAIL'}  {f.relative_to(ROOT)}\n    " + "\n    ".join(tail))
print(f"\n{len(files) - failed}/{len(files)} python suites passed")
sys.exit(1 if failed else 0)
