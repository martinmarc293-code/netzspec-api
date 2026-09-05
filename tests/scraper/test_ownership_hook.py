"""tests/scraper/test_ownership_hook.py - proof that the ownership pre-commit hook refuses.

    python3.11 tests/scraper/test_ownership_hook.py

The hook exists because of one incident: on 5 Sep 2026 the Juniper session committed the Cisco
session's uncommitted change to data/schema/attribute-aliases.en.json under a message that said
nothing about it. Nothing was lost and nothing said so, which is the worst shape a mistake can
have here.

A hook nobody has watched refuse is a hook nobody knows works, so every case below runs the real
script against a real throwaway git repository and asserts the exit code AND the reason. The
cases that matter are the refusals and the ESCAPE HATCH: a hook that cannot be overridden for a
legitimate shared change gets bypassed with --no-verify for every change, which is worse than no
hook at all.
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HOOK = ROOT / "scripts" / "git-hooks" / "pre-commit"

npass = nfail = 0


def check(cid: str, what: str, ok: bool, got: object = "") -> None:
    global npass, nfail
    if ok:
        npass += 1
    else:
        nfail += 1
    print(f"{'PASS' if ok else 'MISS'} | {cid:6} | {what[:80]:82}" + ("" if ok else f" | got {str(got)[:300]}"))


def git(repo: Path, *args, env: dict | None = None) -> subprocess.CompletedProcess:
    e = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
         "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t", **(env or {})}
    return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env=e)


def make_repo(brand: str | None) -> Path:
    d = Path(tempfile.mkdtemp(prefix="netzspec-hook-"))
    git(d, "init", "-q")
    hooks = d / "scripts" / "git-hooks"
    hooks.mkdir(parents=True)
    shutil.copyfile(HOOK, hooks / "pre-commit")
    os.chmod(hooks / "pre-commit", 0o755)
    # The hook asks scraper/brands/ownership.py who owns what - one source of truth rather than a
    # second copy of the rules in shell - so the throwaway repo needs the real module.
    br = d / "scraper" / "brands"
    br.mkdir(parents=True)
    (br / "__init__.py").write_text("", encoding="utf-8")
    shutil.copyfile(ROOT / "scraper" / "brands" / "ownership.py", br / "ownership.py")
    git(d, "config", "core.hooksPath", "scripts/git-hooks")
    if brand:
        git(d, "config", "netzspec.brand", brand)
    # One commit so `git diff --cached` has a parent. The HOOK FILE ITSELF goes in that commit:
    # left untracked, `git add -A` in a case below stages it, every case then has a shared path it
    # never asked for, and the failures point at the wrong thing entirely. (Found exactly that way.)
    (d / "README").write_text("x", encoding="utf-8")
    git(d, "add", "-A")
    git(d, "-c", "core.hooksPath=", "commit", "-qm", "init")
    return d


def touch(repo: Path, rel: str, text: str = "content\n") -> None:
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


if not HOOK.exists():
    check("H0", f"the hook exists at {HOOK.relative_to(ROOT)}", False, "missing")
    print("\n0 passed, 1 missed")
    raise SystemExit(1)
check("H0", "the hook script exists", True)

repos: list[Path] = []
try:
    # -----------------------------------------------------------------------------------------
    # 1. a brand's OWN files commit without ceremony
    # -----------------------------------------------------------------------------------------
    r = make_repo("juniper"); repos.append(r)
    for rel in ("scraper/brands/juniper/brand.py", "scraper/sources/juniper.py",
                "scraper/sources/juniper_hct.py", "scraper/adapters/juniper_hct.py",
                "tests/scraper/test_juniper.py"):
        touch(r, rel)
    git(r, "add", "-A")
    res = git(r, "commit", "-qm", "juniper work")
    check("O1", "every path derived from the brand slug commits with no override - brand pack, "
                "lane, extractor and suite", res.returncode == 0, res.stdout + res.stderr)

    # -----------------------------------------------------------------------------------------
    # 2. THE REFUSAL: another session's file, and the exact file the incident happened in
    # -----------------------------------------------------------------------------------------
    r = make_repo("juniper"); repos.append(r)
    touch(r, "data/schema/attribute-aliases.en.json", '{"rules": []}\n')
    git(r, "add", "-A")
    res = git(r, "commit", "-qm", "six juniper alias rules")
    out = res.stdout + res.stderr
    check("O2", "SABOTAGE the alias file - the exact file of the 5 Sep incident - is REFUSED "
                "when the Juniper session stages it without saying so",
          res.returncode != 0 and "REFUSED" in out, f"rc={res.returncode} {out[:200]}")
    check("O3", "the refusal NAMES the file rather than saying 'shared files staged'",
          "attribute-aliases.en.json" in out, out[:200])
    check("O4", "the refusal tells you how to proceed AND how to back out",
          "NETZSPEC_SHARED=1" in out and "git restore --staged" in out, out[:300])

    r = make_repo("juniper"); repos.append(r)
    touch(r, "scraper/brands/cisco/brand.py")
    git(r, "add", "-A")
    res = git(r, "commit", "-qm", "oops")
    out = res.stdout + res.stderr
    check("O5", "SABOTAGE another BRAND's pack is refused, and named as FOREIGN rather than "
                "merely shared - NETZSPEC_SHARED must NOT cover someone else's file",
          res.returncode != 0 and "owned by cisco" in out, out[:250])
    res2 = git(r, "commit", "-qm", "oops", env={"NETZSPEC_SHARED": "1"})
    check("O5b", "SABOTAGE ...and the override does not open it: NETZSPEC_SHARED=1 still refuses "
                 "another brand's file, because that is never a legitimate shared change",
          res2.returncode != 0, (res2.stdout + res2.stderr)[:200])

    r = make_repo("juniper"); repos.append(r)
    touch(r, "scraper/worker.py")
    git(r, "add", "-A")
    res = git(r, "commit", "-qm", "oops")
    check("O6", "SABOTAGE the shared worker is refused - it was uncommitted and mid-edit by "
                "another session on 5 Sep while this one was reading it",
          res.returncode != 0, res.stdout + res.stderr)

    # -----------------------------------------------------------------------------------------
    # 3. THE ESCAPE HATCH. A hook with no legitimate override is a hook that gets --no-verify'd
    #    for everything, so both routes are proven, and both must PRINT THE DIFF.
    # -----------------------------------------------------------------------------------------
    r = make_repo("juniper"); repos.append(r)
    touch(r, "data/schema/attribute-aliases.en.json", '{"rules": [["^x$","y","z"]]}\n')
    git(r, "add", "-A")
    res = git(r, "commit", "-qm", "alias rules", env={"NETZSPEC_SHARED": "1"})
    out = res.stdout + res.stderr
    check("O7", "NETZSPEC_SHARED=1 allows a deliberate shared change",
          res.returncode == 0, out[:200])
    check("O8", "...and PRINTS THE DIFF of the shared files, because the 5 Sep mistake was "
                "reading --stat instead of the diff",
          "rules" in out or "+++" in out or "diff --git" in out, out[:300])

    # O9 asserted a SECOND route - a [shared] marker in the commit subject - and it failed. That
    # is the finding, not a broken test: `pre-commit` runs BEFORE git prepares the message, so
    # COMMIT_EDITMSG still holds the PREVIOUS commit's subject. The marker did nothing on the
    # commit carrying it and would have silently allowed the NEXT one. The route was removed from
    # the hook; this case now pins its absence, so nobody re-adds a check that reads the wrong
    # input and reports success.
    r = make_repo("juniper"); repos.append(r)
    touch(r, "src/core/docClass.ts")
    git(r, "add", "-A")
    res = git(r, "commit", "-qm", "[shared] vendor_tool in the DocClass union")
    check("O9", "SABOTAGE a [shared] marker in the subject is NOT a route and must not be one - "
                "pre-commit runs before the message exists, so it would read the PREVIOUS "
                "commit's subject and allow the wrong commit",
          res.returncode != 0, (res.stdout + res.stderr)[:200])
    hook_src = HOOK.read_text(encoding="utf-8")
    check("O9b", "...and the hook no longer READS the message file at all, so the dead route "
                 "cannot come back by accident",
          "head -n 1" not in hook_src and 'grep -c' not in hook_src,
          [l for l in hook_src.splitlines() if "COMMIT_EDITMSG" in l][:2])

    # -----------------------------------------------------------------------------------------
    # 4. the hook must not break a checkout that is not a brand worktree
    # -----------------------------------------------------------------------------------------
    r = make_repo(None); repos.append(r)
    touch(r, "anything.txt")
    git(r, "add", "-A")
    res = git(r, "commit", "-qm", "main checkout")
    out = res.stdout + res.stderr
    check("O10", "SABOTAGE with no netzspec.brand configured the hook allows the commit and SAYS "
                 "it skipped - a hook that blocks every repo it lands in gets deleted",
          res.returncode == 0 and "skipped" in out, f"rc={res.returncode} {out[:200]}")

    # -----------------------------------------------------------------------------------------
    # 5. the ownership rule is DERIVED, so a brand nobody has heard of works with no edit here
    # -----------------------------------------------------------------------------------------
    r = make_repo("arista"); repos.append(r)
    touch(r, "scraper/brands/arista/brand.py")
    touch(r, "scraper/sources/arista.py")
    git(r, "add", "-A")
    res = git(r, "commit", "-qm", "arista pack")
    # Ownership is a TABLE, not a derivation - a deliberate choice in ownership.py ("adding a
    # brand is one entry here"). The consequence has to be stated rather than discovered: a brand
    # with no entry owns NOTHING, so its own pack reads as shared and its first commit is refused.
    # That is defensible as explicit registration; it is indefensible if the refusal does not say
    # so, which is why the message is asserted and not just the exit code.
    out = res.stdout + res.stderr
    check("O11", "a brand with no OWNERSHIP entry owns nothing and is refused - explicit "
                 "registration, and the refusal has to make that legible rather than looking "
                 "like a bug in the hook",
          res.returncode != 0 and "no entry in scraper/brands/ownership.py" in out, out[:260])

    # The drift check between two hand-maintained lists. BRANDS says which packs load; OWNERSHIP
    # says who owns what. Nothing compared them, so a brand could be registered in one and not the
    # other - and the symptom would be a session whose every commit is refused for no visible
    # reason. Same family as `partnerAnchorsPerArticle` being read and never compared.
    sys.path.insert(0, str(ROOT / "scraper"))
    from brands import BRANDS                      # noqa: E402
    from brands.ownership import OWNERSHIP         # noqa: E402
    missing = [b for b in BRANDS if b not in OWNERSHIP]
    check("O14", "every brand in BRANDS has an OWNERSHIP entry - a pack registered in one list "
                 "and not the other gives a session whose commits are all refused with no reason",
          not missing, f"in BRANDS but not OWNERSHIP: {missing}")
    orphan = [b for b in OWNERSHIP if b not in BRANDS]
    check("O15", "...and the other way: an OWNERSHIP entry with no pack is a claim on files no "
                 "session can commit", not orphan, f"in OWNERSHIP but not BRANDS: {orphan}")
    check("O16", "SABOTAGE the canonical suite filename the ACQUISITION GATE runs is owned - "
                 "apply-acquired builds tests/scraper/test_<slug>.py, and the pattern was "
                 "test_<slug>_*.py, so every brand's gate suite read as SHARED",
          all(__import__("brands.ownership", fromlist=["x"]).owner_of_path(
              f"tests/scraper/test_{b}.py") == b for b in BRANDS),
          {b: __import__("brands.ownership", fromlist=["x"]).owner_of_path(f"tests/scraper/test_{b}.py") for b in BRANDS})

    r = make_repo("arista"); repos.append(r)
    touch(r, "scraper/sources/juniper.py")
    git(r, "add", "-A")
    res = git(r, "commit", "-qm", "oops")
    check("O12", "SABOTAGE ...and it does NOT own anyone else's: arista staging juniper.py is "
                 "refused, which is the same rule read the other way",
          res.returncode != 0, (res.stdout + res.stderr)[:200])
    # ---------------------------------------------------------------------------------------
    # 6. the bug that hung this very suite for two minutes
    # ---------------------------------------------------------------------------------------
    # The refusal messages are printed from unquoted heredocs, because they interpolate the file
    # list. In an UNQUOTED heredoc a backtick is COMMAND SUBSTITUTION, so prose written as
    # `git commit` made the hook RUN git commit, which opened an editor and hung - the hook never
    # returned and neither did this file. Same family as the project's Python-heredoc escaping
    # rule, one language over. Comments are safe; heredoc bodies are not.
    hook_lines = HOOK.read_text(encoding="utf-8").splitlines()
    offenders = [(i, l) for i, l in enumerate(hook_lines, 1)
                 if "`" in l and not l.lstrip().startswith("#")]
    check("O13", "SABOTAGE no backtick survives outside a comment - in an unquoted heredoc a "
                 "backtick RUNS what it wraps, and this hook hung for two minutes executing the "
                 "'git commit' in its own error message",
          not offenders, offenders[:3])

finally:
    for r in repos:
        shutil.rmtree(r, ignore_errors=True)

print(f"\n{npass} passed, {nfail} missed")
raise SystemExit(1 if nfail else 0)
