"""One place to open a Postgres connection that cannot wait for ever, and that says who owns it.

    from scraper.brands import dbconn
    conn = dbconn.connect(url, who="watchdog-suite/cisco")

WHY, measured on 6 Sep 2026.

`tests/scraper/test_watchdog.py` hung for 22 minutes inside the shared test runner, holding up the
commit gate for every brand, and it hung at a DIFFERENT case each time. The stack said
`psycopg/waiting.py:wait_select` under `watchdog.load_stale_runs` — waiting on the server for a
reply. The query itself runs in 0.3 s on an index-only scan, so it was never slow: the reply never
arrived. Postgres showed that session `idle`, meaning the server believed it had answered and was
waiting for the next command. Both ends were content and the two disagreed about what had been
sent.

That is a half-alive socket across the SSH tunnel, and this project has met it before: the
supervisor's single long-lived connection died the same way (see the 5 Sep entry in
`docs/SESSION-LOG.md`), which is why `run_brand.py` grew `needs_reconnect()`. The direct evidence
here is that killed clients leave live sessions behind: two Python processes were running against
four Postgres sessions, and one of them had been sitting idle on the watchdog's own query since the
moment its client was killed ten minutes earlier. The close is not reaching the server.

WITHOUT KEEPALIVES A DEAD PEER IS INDISTINGUISHABLE FROM A SLOW ONE, and the default is to wait
until the OS gives up - two hours on Windows. TCP keepalives turn that into an error in about a
minute, and an error is something a caller can act on. This is the same rule the project already
applies above the database: a monitor that cannot tell "could not reach it" from "it said no" sends
someone to the wrong place, and a hang is the version of that which nobody diagnoses at all.

`application_name` is here for the other half of the problem. Three brand sessions and a
supervisor share this server, so when something blocks, the first question is whose it is -
`pg_stat_activity` showed five anonymous sessions and answering that took a process-table cross
reference. A named session answers it in the query that finds the block.

A caller may still override any of these through the DSN: libpq takes the LAST occurrence of a
key, and these are appended, so an explicit `connect_timeout` in the URL wins.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

# ~60 s to notice a peer that has stopped answering: idle 30 s, then 3 probes 10 s apart. Short
# enough that a wedged suite fails inside one run, long enough that a slow query over a 180 ms
# route is never mistaken for a dead one - the round trip to this box is the ROUTE, not the tunnel,
# and a tighter setting would start killing healthy connections on a bad minute.
KEEPALIVE = {
    "keepalives": "1",
    "keepalives_idle": "30",
    "keepalives_interval": "10",
    "keepalives_count": "3",
    # CONNECT_TIMEOUT IS A MITIGATION HERE, NOT A FIX, AND IT IS DATED.
    #
    # 15 s was chosen when connection SETUP was a fraction of a second. On 7 Sep 2026 setup began
    # degrading: measured from this tree, six samples, median 2,891 ms and max 11,844 ms.
    #
    # THIS COMMENT ORIGINALLY SAID "it is setup, not the link", BECAUSE THE ROUND-TRIP MEDIAN WAS
    # FLAT AT ~355 ms. That is false and the juniper session disproved it from 180 samples: the
    # round-trip P90 QUADRUPLED (1,060 -> 1,705 ms) while the median moved 34 ms. Setup is not an
    # independent quantity - it costs a whole handful of round trips, so it AMPLIFIES the link.
    # Measured three ways: 6.2x in juniper's tree, 6.9x in the parent's samples, 8.7x here (noisy,
    # 2.2-33.8). A 100 ms move in round trip is most of a second in setup, which is exactly why the
    # median looks calm while setup crosses a bound - and why hunting for a setup-specific cause
    # finds nothing. A flat MEDIAN is not a flat distribution. The parent's board over a longer window: median
    # 2,563 -> 4,314 ms, share above 5 s 16% -> 43%, **max 14,906 ms** - 99.4% of the old bound,
    # with four probe samples already failing outright.
    #
    # 45 s is three times the worst observed setup and still inside the ~60 s a dead peer takes to
    # surface through the keepalives above, so a hang is still an error a caller can act on rather
    # than a two-hour OS wait. THE CAUSE IS UNKNOWN and a tunnel restart made it worse; this buys
    # the lane time to keep running while somebody finds it. If setup ever approaches 45 s the
    # answer is not another raise - this project has already paid for a mitigation with a hidden
    # expiry, where a smaller batch "fixed" a lock collision by shrinking the window it happened in.
    "connect_timeout": "45",
}


def _default_name() -> str:
    """`netzspec/<script>/<brand>` — the script that opened it and whose lane it belongs to.

    A PID was the first default and it is nearly useless: it is unique, meaningless a minute later,
    and does not survive a restart. What an operator staring at a blocked query needs is WHAT this
    is and WHOSE, which is exactly the pair. The TypeScript side builds the same shape in
    `src/store/db.ts`, so `pg_stat_activity` reads the same way whichever language opened the
    session — and the two must match, because the writers being told apart span both.
    """
    script = Path(sys.argv[0] or "python").name
    for ext in (".py", ".pyw"):
        if script.endswith(ext):
            script = script[: -len(ext)]
    brand = os.environ.get("NETZSPEC_BRAND") or ""
    return f"netzspec/{script or 'python'}" + (f"/{brand}" if brand else "")


def augment(url: str, who: str | None = None) -> str:
    """Append the keepalive parameters (and an application_name) to a libpq URL.

    Appended rather than inserted: libpq honours the last occurrence of a duplicated key, so a
    caller that has deliberately set one in the URL would find it silently overridden if these
    went first. A helper that quietly discards what the caller asked for is the same defect as a
    parameter that is read on some branches and not others.
    """
    parts = [f"{k}={v}" for k, v in KEEPALIVE.items()]
    # The fallback lives HERE rather than in connect(), because a caller that augments a URL and
    # hands it to psycopg itself would otherwise get an anonymous session - and an anonymous
    # session is exactly what made the blocking one hard to attribute. Its own test caught this.
    who = who or os.environ.get("NETZSPEC_APPLICATION_NAME") or _default_name()
    # Postgres truncates application_name at 63 bytes and the value must not carry a '&'.
    parts.append("application_name=" + who.replace("&", "-")[:60])
    sep = "&" if "?" in url else "?"
    return url + sep + "&".join(parts)


def connect(url: str, who: str | None = None, **kw):
    """psycopg.connect with the parameters above and this project's usual row factory.

    `autocommit` defaults to True deliberately. The project's standing rule is that an ad-hoc
    connection opens autocommit and wraps a write in ONE explicit transaction, because a
    `with conn.transaction()` after an earlier statement on a non-autocommit connection is a
    SAVEPOINT, not a commit - a whole operator reopen of 4,164 conflicts was lost that way while
    the script's own output said it had worked.
    """
    kw.setdefault("autocommit", True)
    kw.setdefault("row_factory", dict_row)
    return psycopg.connect(augment(url, who), **kw)
