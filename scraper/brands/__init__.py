"""scraper.brands - one self-contained pack per manufacturer.

WHY THIS EXISTS. Every brand publishes its specifications differently, blocks differently, names
its parts differently and goes end-of-life differently. Cisco puts a series datasheet behind
Akamai with an ordering table of two hundred PIDs; HPE publishes QuickSpecs with a different
document shape entirely; Arista puts everything on one page. A single watchdog with twenty
per-source special cases becomes a file nobody can change safely, and a single "scraper" that
tries to be all of them is the same mistake one level down.

So a brand is a DIRECTORY. To add HPE you copy `cisco/`, rename it, and edit the manifest and the
brand rules. That is the whole workflow, and `brands/README.md` is the checklist.

WHAT IS AND IS NOT COPIED. The manifest, the coverage targets, the document classes, the
discovery roots and the brand's own checks are per brand - those are the things that genuinely
differ. The fetch engine, the queue, the lease, the gate, the normaliser and the fact store stay
SHARED and are imported, never copied: three copies of a helper is three copies of the same bug
(D:\\Project\\CLAUDE.md section 10), and a bug fixed in Cisco's copy of a lease loop that stays
broken in HPE's is exactly the failure that rule was written for. The line is: anything that
encodes what a brand publishes belongs in the pack; anything that encodes how this system works
belongs in the engine.

DAILY, FOREVER. A brand pack is never "finished". Cisco reaching full coverage does not retire
its pack - it moves it from BUILDING to MAINTAINING, where the daily job is change detection:
new PIDs, revised datasheets, new end-of-life bulletins. `brand.schedule` says what runs daily,
weekly and monthly, and the brand watchdog reports staleness against it, so a pack that has
silently stopped running is visible as a pack whose documents are all older than its own policy.
"""
from __future__ import annotations

import importlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent

#: Packs in the order they were built. Adding a name here is the only registration step.
BRANDS = ("cisco",)


def load_brand(slug: str):
    """Import a brand pack by slug and return its `BRAND` manifest.

    Raises rather than returning None: a typo'd brand name that silently produced "no checks to
    run" would look exactly like a healthy brand with nothing wrong, which is the failure mode
    this project has a standing rule about (a monitor's own failure must be loud).
    """
    name = (slug or "").strip().lower().replace("-", "_")
    if not name:
        raise ValueError("no brand slug given")
    if not (ROOT / name / "brand.py").exists():
        known = ", ".join(sorted(p.name for p in ROOT.iterdir() if (p / "brand.py").exists()))
        raise ValueError(f"no brand pack {slug!r} under scraper/brands (have: {known or 'none'})")
    mod = importlib.import_module(f"brands.{name}.brand")
    if not hasattr(mod, "BRAND"):
        raise ValueError(f"scraper/brands/{name}/brand.py defines no BRAND manifest")
    return mod.BRAND


def all_brands() -> list:
    return [load_brand(s) for s in BRANDS]
