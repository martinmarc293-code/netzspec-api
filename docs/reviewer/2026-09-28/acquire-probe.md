# Acquire probe, 30 Sep 2026 (FILL PIPELINE 1a, option A)

Box: google-chrome-stable 154.0.8037.92-1 under xvfb-run, playwright 1.60.0 (/opt/netzspec/pw), the lane's own client
(worker.Browser profile mode, headless=False, default UA `... X11; Linux x86_64 ... Chrome/154.0.0.0`, no proxy), force
fetches into a throwaway cache. URLs: data/probe/spec-20.txt (20 of 204 queued datasheet-named HTML pages, seed 20260930).

| | box (acquire-probe-box.json) | laptop control, same 5 URLs (acquire-probe-laptop-control.json) |
| --- | --- | --- |
| control example.com first / last | 200 / 200 | 200 / 200 |
| 403 / 429 / challenge | 0 / 0 / 0 of 20 | 0 / 0 / 0 of 5 |
| HTTP 200 | 20 of 20 | 5 of 5 |
| the document (200 + a table) | 15 of 20 | 0 of 5 |
| se/2017/10 data-sheets-1508478352914 | 228 B Akamai "An error occurred while processing your request" (errors.edgesuite.net ref #50) | 228 B, same |
| se/2020/9 nb-06-cat9800-80 ... | 354,842 B "Log In to Cisco" | 355,689 B, same |
| se/2021/5 datasheet-c78-744371 | 354,605 B "Log In to Cisco" | 355,680 B, same |
| se/2020/8 nb-06-cat9800-wirel-cont ... | 354,728 B "Log In to Cisco" | 355,827 B, same |
| solutions/.../intelligent-wan-akamai/datasheet-c78-734173 | 600,555 B marketing page "Cisco SD-WAN for a secure, future-ready workplace" (retired, redirected) | 615,442 B, same |

By the gate as written (>= 19 of 20 with tables): **FAIL, 15**. By the control on the axis the question is about
(this client on this IP vs the proven laptop lane): **identical outcome on all 5 failures** -- the 5 are dead or
login-walled URLs in the queue, not access. The gate mixed "can the box read cisco.com" with "is the queued URL a live
public datasheet".

The queue shape behind 3 of the 5: `/c/en/us/products/se/` (sales-enablement collateral, login-only): 527 rows in the
lane, **0 ever done**; 33 of them in tonight's 1,809-URL target. Tonight's target by type: html 299, pdf 746, listing 764.
