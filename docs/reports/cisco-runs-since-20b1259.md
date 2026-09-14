# Runs executed since commit 20b1259 (2026-09-12 21:39 +01:00)

Read from the `runs` table on 14 Sep 2026 (read-only, application_name `cisco/runs-since-20b1259`). **66 runs, #998–#1063.** The earlier status that said none was wrong.

| kind | status | runs |
|---|---|---|
| sync-dictionary | succeeded | 2 |
| reclassify | succeeded | 2 |
| bundle-plan-facts | failed | 2 |
| bundle-plan-facts | succeeded | 1 |
| move-category | succeeded | 10 |
| recompute-completeness | succeeded | 15 |
| apply-renormalize | succeeded | 24 |
| apply-renormalize | failed | 10 |

Row moves and class changes (the runs that change where a part lives):

- **#999** reclassify (succeeded, 2026-09-12 22:12:18) — {"by_rule":{"bundle-plan":31,"not-sellable":7,"expired-promotion":7,"packaging-not-a-product":2,"programme-or-solution-label":71},"changed":118,"scanned":87083,"written":118,"unchanged":82552,"reason_only":3069,"by_trans
- **#1000** bundle-plan-facts (failed, 2026-09-12 22:12:36) — {"error":"FACT_NO_DOCUMENT: a verified fact at tier 2 must name the document it was read from (facts_verified_needs_source); tier 0 is the only source-less tier — field \"pack_quantity\", raw \"2 Pack\"","error_type":"Er
- **#1001** bundle-plan-facts (failed, 2026-09-12 22:13:03) — {"error":"FACT_NO_DOCUMENT: a verified fact at tier 2 must name the document it was read from (facts_verified_needs_source); tier 0 is the only source-less tier — field \"pack_quantity\", raw \"2 Pack\"","error_type":"Er
- **#1002** bundle-plan-facts (succeeded, 2026-09-12 22:14:07) — {"inserted":8,"retracted":17}
- **#1003** move-category (succeeded, 2026-09-12 22:14:54) — {"to":"routers","from":"ios-nx-os-software","skus":["8201-SYS","8202-SYS","A99-4T-FC","N540-24Q8L2DD-SYS","N540-24Z8Q2C-SYS","N540-ACC-SYS","N540X-6Z18G-SYS-A","N540X-ACC-SYS","N560-7-SYS","N560-7-SYS-E","NC55-MPA-12T-S-
- **#1004** move-category (succeeded, 2026-09-12 22:15:01) — {"to":"routers","from":"cloud-systems-management","skus":["C1100TG-1N24P32A","C1100TG-1N32A","C1100TGX-1N24P32A"],"moved":3}
- **#1005** move-category (succeeded, 2026-09-12 22:15:08) — {"to":"switches","from":"cloud-systems-management","skus":["2960-X","2960-XR"],"moved":2}
- **#1006** move-category (succeeded, 2026-09-12 22:15:15) — {"to":"wireless","from":"cloud-systems-management","skus":["CW9162I","CW9166D1","CW9166I"],"moved":3}
- **#1007** move-category (succeeded, 2026-09-12 22:15:23) — {"to":"servers-unified-computing","from":"cloud-systems-management","skus":["DN3-HW-APL-XL","DN3-HW-APL-XL=","DN3-P-I8D25GF","DN3-P-I8Q25GF"],"moved":4}
- **#1008** move-category (succeeded, 2026-09-12 22:15:30) — {"to":"switches","from":"data-center-analytics","skus":["TA-C93180YC-FX","TA-C93180YC-FX-NR","TA-C93180YC-FX3","TA-C93180YC-FX="],"moved":4}
- **#1009** move-category (succeeded, 2026-09-12 22:15:38) — {"to":"servers-unified-computing","from":"data-center-analytics","skus":["APIC-O-ID10GC","APIC-P-I8D25GF","APIC-P-ID10GC"],"moved":3}
- **#1010** move-category (succeeded, 2026-09-12 22:15:45) — {"to":"switches","from":"software","skus":["N35-F-X16P","N35-F-X16P=","N35-F-X4Q","N35-F-X4Q="],"moved":4}
- **#1023** reclassify (succeeded, 2026-09-13 00:37:27) — {"by_rule":{"sku-exact:UCSC-SWRST":1,"ucs-kind-non-product":4,"sku-exact:C9800-CL-K9":1,"sku-exact:DOCK-LNX-ADV-BC":1,"sku-exact:DOCK-LNX-ADV-BD":1,"sku-exact:DOCK-LNX-BSC-BC":1,"sku-exact:DOCK-LNX-BSC-BD":1,"sku-exact:D
- **#1024** move-category (succeeded, 2026-09-13 00:38:03) — {"to":"switches","from":"collaboration-endpoints","skus":["C1200-8FP-2G-OPT","CS-PANO-SWITCH+","CS-PANO-SWITCH2+","CTS-5K-LC-SWITCH","CTS-5K-UI-SWITCH"],"moved":5}
- **#1061** move-category (succeeded, 2026-09-14 12:30:56) — {"to":"switches","from":"meraki","skus":["MS100","MS120","MS120-24","MS120-24P","MS120-48","MS120-48FP","MS120-48LP","MS120-8","MS120-8FP","MS120-8LP","MS125","MS125-24","MS125-24P","MS125-48","MS125-48FP","MS125-48LP","

Every run:

| id | kind | status | started | scope | stats (truncated) |
|---|---|---|---|---|---|
| 998 | sync-dictionary | succeeded | 2026-09-12 22:11:04 | — | {"updated":1,"inserted":2,"orphaned":[],"profiles":6110,"reshaped":[],"unchanged":599,"label_drift":["tls_throughput"],"profiles_updated":2, |
| 999 | reclassify | succeeded | 2026-09-12 22:12:18 | cisco | {"by_rule":{"bundle-plan":31,"not-sellable":7,"expired-promotion":7,"packaging-not-a-product":2,"programme-or-solution-label":71},"changed": |
| 1000 | bundle-plan-facts | failed | 2026-09-12 22:12:36 | — | {"error":"FACT_NO_DOCUMENT: a verified fact at tier 2 must name the document it was read from (facts_verified_needs_source); tier 0 is the o |
| 1001 | bundle-plan-facts | failed | 2026-09-12 22:13:03 | — | {"error":"FACT_NO_DOCUMENT: a verified fact at tier 2 must name the document it was read from (facts_verified_needs_source); tier 0 is the o |
| 1002 | bundle-plan-facts | succeeded | 2026-09-12 22:14:07 | — | {"inserted":8,"retracted":17} |
| 1003 | move-category | succeeded | 2026-09-12 22:14:54 | cisco | {"to":"routers","from":"ios-nx-os-software","skus":["8201-SYS","8202-SYS","A99-4T-FC","N540-24Q8L2DD-SYS","N540-24Z8Q2C-SYS","N540-ACC-SYS", |
| 1004 | move-category | succeeded | 2026-09-12 22:15:01 | cisco | {"to":"routers","from":"cloud-systems-management","skus":["C1100TG-1N24P32A","C1100TG-1N32A","C1100TGX-1N24P32A"],"moved":3} |
| 1005 | move-category | succeeded | 2026-09-12 22:15:08 | cisco | {"to":"switches","from":"cloud-systems-management","skus":["2960-X","2960-XR"],"moved":2} |
| 1006 | move-category | succeeded | 2026-09-12 22:15:15 | cisco | {"to":"wireless","from":"cloud-systems-management","skus":["CW9162I","CW9166D1","CW9166I"],"moved":3} |
| 1007 | move-category | succeeded | 2026-09-12 22:15:23 | cisco | {"to":"servers-unified-computing","from":"cloud-systems-management","skus":["DN3-HW-APL-XL","DN3-HW-APL-XL=","DN3-P-I8D25GF","DN3-P-I8Q25GF" |
| 1008 | move-category | succeeded | 2026-09-12 22:15:30 | cisco | {"to":"switches","from":"data-center-analytics","skus":["TA-C93180YC-FX","TA-C93180YC-FX-NR","TA-C93180YC-FX3","TA-C93180YC-FX="],"moved":4} |
| 1009 | move-category | succeeded | 2026-09-12 22:15:38 | cisco | {"to":"servers-unified-computing","from":"data-center-analytics","skus":["APIC-O-ID10GC","APIC-P-I8D25GF","APIC-P-ID10GC"],"moved":3} |
| 1010 | move-category | succeeded | 2026-09-12 22:15:45 | cisco | {"to":"switches","from":"software","skus":["N35-F-X16P","N35-F-X16P=","N35-F-X4Q","N35-F-X4Q="],"moved":4} |
| 1011 | recompute-completeness | succeeded | 2026-09-12 22:16:15 | cisco / servers-unified-computing | {"parts":12918,"written":1439,"unchanged":11479,"no_profile":0,"non_hardware":3324,"retired_completeness_rows":0} |
| 1012 | recompute-completeness | succeeded | 2026-09-12 22:17:25 | cisco / hyperconverged-systems | {"parts":1772,"written":164,"unchanged":1608,"no_profile":0,"non_hardware":568,"retired_completeness_rows":0} |
| 1013 | recompute-completeness | succeeded | 2026-09-12 22:18:07 | cisco / hyperconverged-infrastructure | {"parts":1004,"written":0,"unchanged":1004,"no_profile":0,"non_hardware":218,"retired_completeness_rows":0} |
| 1014 | recompute-completeness | succeeded | 2026-09-12 22:18:46 | cisco / wireless | {"parts":6272,"written":85,"unchanged":6187,"no_profile":0,"non_hardware":2261,"retired_completeness_rows":0} |
| 1015 | recompute-completeness | succeeded | 2026-09-12 22:19:38 | cisco / collaboration-endpoints | {"parts":3222,"written":11,"unchanged":3211,"no_profile":0,"non_hardware":382,"retired_completeness_rows":0} |
| 1016 | recompute-completeness | succeeded | 2026-09-12 22:20:27 | cisco / conferencing | {"parts":3749,"written":1,"unchanged":3748,"no_profile":0,"non_hardware":3680,"retired_completeness_rows":0} |
| 1017 | recompute-completeness | succeeded | 2026-09-12 22:21:15 | cisco / routers | {"parts":8377,"written":31,"unchanged":8346,"no_profile":0,"non_hardware":2907,"retired_completeness_rows":0} |
| 1018 | recompute-completeness | succeeded | 2026-09-12 22:22:32 | cisco / switches | {"parts":9873,"written":10,"unchanged":9863,"no_profile":0,"non_hardware":2445,"retired_completeness_rows":0} |
| 1019 | recompute-completeness | succeeded | 2026-09-12 22:23:40 | cisco / ios-nx-os-software | {"parts":284,"written":0,"unchanged":284,"no_profile":0,"non_hardware":284,"retired_completeness_rows":0} |
| 1020 | recompute-completeness | succeeded | 2026-09-12 22:24:19 | cisco / cloud-systems-management | {"parts":5673,"written":0,"unchanged":5673,"no_profile":0,"non_hardware":5673,"retired_completeness_rows":0} |
| 1021 | recompute-completeness | succeeded | 2026-09-12 22:25:08 | cisco / data-center-analytics | {"parts":205,"written":0,"unchanged":205,"no_profile":0,"non_hardware":205,"retired_completeness_rows":0} |
| 1022 | recompute-completeness | succeeded | 2026-09-12 22:25:46 | cisco / software | {"parts":815,"written":0,"unchanged":815,"no_profile":0,"non_hardware":815,"retired_completeness_rows":0} |
| 1023 | reclassify | succeeded | 2026-09-13 00:37:27 | cisco | {"by_rule":{"sku-exact:UCSC-SWRST":1,"ucs-kind-non-product":4,"sku-exact:C9800-CL-K9":1,"sku-exact:DOCK-LNX-ADV-BC":1,"sku-exact:DOCK-LNX-AD |
| 1024 | move-category | succeeded | 2026-09-13 00:38:03 | cisco | {"to":"switches","from":"collaboration-endpoints","skus":["C1200-8FP-2G-OPT","CS-PANO-SWITCH+","CS-PANO-SWITCH2+","CTS-5K-LC-SWITCH","CTS-5K |
| 1025 | apply-renormalize | succeeded | 2026-09-13 00:42:34 | — | {"same":2016,"changed":18,"refused":0,"selected":2659,"restamped":2016,"retracted":0,"sign_flips":0,"superseded":18,"unrecoverable":625,"tie |
| 1026 | apply-renormalize | failed | 2026-09-13 00:43:38 | — | {"error":"gate did not pass (FAIL: 2 miss(es), recall 1.0000, precision 1.0000): [\"CHANGE_SHARE_EXCEEDED 100.0% of 1 replayable rows change |
| 1027 | apply-renormalize | succeeded | 2026-09-13 00:43:46 | — | {"same":238,"changed":1,"refused":0,"selected":650,"restamped":238,"retracted":0,"sign_flips":1,"superseded":1,"unrecoverable":407,"tier0_pr |
| 1028 | apply-renormalize | succeeded | 2026-09-13 00:43:56 | — | {"same":243,"changed":8,"refused":0,"selected":373,"restamped":243,"retracted":0,"sign_flips":8,"superseded":8,"unrecoverable":122,"tier0_pr |
| 1029 | apply-renormalize | succeeded | 2026-09-13 00:44:20 | — | {"same":3023,"changed":46,"refused":72,"selected":3520,"restamped":3023,"retracted":72,"sign_flips":0,"superseded":46,"unrecoverable":379,"t |
| 1030 | apply-renormalize | succeeded | 2026-09-13 00:47:43 | — | {"same":88,"changed":0,"refused":15,"selected":103,"restamped":88,"retracted":15,"sign_flips":0,"superseded":0,"unrecoverable":0,"tier0_prot |
| 1031 | apply-renormalize | succeeded | 2026-09-13 00:48:49 | — | {"same":189,"changed":0,"refused":0,"selected":1841,"restamped":189,"retracted":0,"sign_flips":0,"superseded":0,"unrecoverable":1652,"tier0_ |
| 1032 | apply-renormalize | succeeded | 2026-09-13 00:48:58 | — | {"same":49,"changed":0,"refused":0,"selected":333,"restamped":49,"retracted":0,"sign_flips":0,"superseded":0,"unrecoverable":284,"tier0_prot |
| 1033 | apply-renormalize | succeeded | 2026-09-13 00:49:09 | — | {"same":364,"changed":0,"refused":0,"selected":364,"restamped":364,"retracted":0,"sign_flips":0,"superseded":0,"unrecoverable":0,"tier0_prot |
| 1034 | apply-renormalize | succeeded | 2026-09-13 00:49:22 | — | {"same":34,"changed":0,"refused":0,"selected":301,"restamped":34,"retracted":0,"sign_flips":0,"superseded":0,"unrecoverable":267,"tier0_prot |
| 1035 | apply-renormalize | succeeded | 2026-09-13 00:49:36 | — | {"same":15,"changed":0,"refused":0,"selected":63,"restamped":15,"retracted":0,"sign_flips":0,"superseded":0,"unrecoverable":48,"tier0_protec |
| 1036 | apply-renormalize | succeeded | 2026-09-13 00:50:02 | — | {"same":15,"changed":0,"refused":0,"selected":63,"restamped":15,"retracted":0,"sign_flips":0,"superseded":0,"unrecoverable":48,"tier0_protec |
| 1037 | apply-renormalize | succeeded | 2026-09-13 00:50:13 | — | {"same":732,"changed":0,"refused":0,"selected":2984,"restamped":732,"retracted":0,"sign_flips":0,"superseded":0,"unrecoverable":2247,"tier0_ |
| 1038 | sync-dictionary | succeeded | 2026-09-13 00:53:17 | — | {"updated":17,"inserted":2,"orphaned":[],"profiles":6116,"reshaped":[{"key":"ip_rating","facts":9,"sample":[],"changed":["type s->e","domain |
| 1039 | apply-renormalize | failed | 2026-09-13 00:59:26 | cisco | {"field":"standard","rolled_back":{"facts_removed":319,"facts_restored":319,"evidence_removed":319,"conflicts_removed":0,"states_recomputed" |
| 1040 | apply-renormalize | failed | 2026-09-13 01:09:29 | cisco | {"field":"mounting","rolled_back":{"facts_removed":82,"facts_restored":82,"evidence_removed":79,"conflicts_removed":0,"states_recomputed":0} |
| 1041 | apply-renormalize | succeeded | 2026-09-13 01:13:58 | cisco | {"same":0,"changed":1,"refused":0,"selected":1,"restamped":0,"retracted":0,"sign_flips":1,"superseded":1,"unrecoverable":0,"tier0_protected" |
| 1042 | apply-renormalize | failed | 2026-09-13 01:14:12 | cisco | {"field":"standard","rolled_back":{"facts_removed":77,"facts_restored":77,"evidence_removed":77,"conflicts_removed":0,"states_recomputed":0} |
| 1043 | apply-renormalize | failed | 2026-09-13 01:17:31 | cisco | {"field":"cellular_bands","rolled_back":{"facts_removed":63,"facts_restored":63,"evidence_removed":60,"conflicts_removed":0,"states_recomput |
| 1044 | apply-renormalize | failed | 2026-09-13 01:21:00 | cisco | {"field":"ui_languages","rolled_back":{"facts_removed":50,"facts_restored":50,"evidence_removed":49,"conflicts_removed":0,"states_recomputed |
| 1045 | apply-renormalize | failed | 2026-09-13 01:25:02 | cisco | {"field":"audio_codecs","rolled_back":{"facts_removed":30,"facts_restored":30,"evidence_removed":30,"conflicts_removed":0,"states_recomputed |
| 1046 | apply-renormalize | succeeded | 2026-09-13 01:28:38 | cisco | {"same":0,"changed":14,"refused":0,"selected":14,"restamped":0,"retracted":0,"sign_flips":0,"superseded":14,"unrecoverable":0,"tier0_protect |
| 1047 | apply-renormalize | succeeded | 2026-09-13 01:29:10 | cisco | {"same":0,"changed":9,"refused":0,"selected":9,"restamped":0,"retracted":0,"sign_flips":0,"superseded":9,"unrecoverable":0,"tier0_protected" |
| 1048 | apply-renormalize | succeeded | 2026-09-13 01:29:28 | cisco | {"same":0,"changed":11,"refused":0,"selected":11,"restamped":0,"retracted":0,"sign_flips":0,"superseded":11,"unrecoverable":0,"tier0_protect |
| 1049 | apply-renormalize | succeeded | 2026-09-13 01:29:47 | cisco | {"same":0,"changed":6,"refused":0,"selected":6,"restamped":0,"retracted":0,"sign_flips":0,"superseded":6,"unrecoverable":0,"tier0_protected" |
| 1050 | apply-renormalize | failed | 2026-09-13 01:31:17 | cisco | {"field":"standard","rolled_back":{"facts_removed":505,"facts_restored":505,"evidence_removed":505,"conflicts_removed":0,"states_recomputed" |
| 1051 | apply-renormalize | failed | 2026-09-13 01:47:09 | cisco | {"field":"standard","rolled_back":{"facts_removed":128,"facts_restored":128,"evidence_removed":128,"conflicts_removed":0,"states_recomputed" |
| 1052 | apply-renormalize | failed | 2026-09-13 01:54:00 | cisco | {"field":"standard","rolled_back":{"facts_removed":133,"facts_restored":133,"evidence_removed":133,"conflicts_removed":0,"states_recomputed" |
| 1053 | apply-renormalize | succeeded | 2026-09-13 02:07:50 | cisco | {"same":0,"changed":2025,"refused":8,"selected":2595,"restamped":0,"retracted":8,"sign_flips":0,"superseded":2025,"unrecoverable":7,"tier0_p |
| 1054 | apply-renormalize | succeeded | 2026-09-13 02:07:57 | cisco | {"same":0,"changed":903,"refused":31,"selected":994,"restamped":0,"retracted":31,"sign_flips":0,"superseded":903,"unrecoverable":60,"tier0_p |
| 1055 | apply-renormalize | succeeded | 2026-09-13 02:08:01 | cisco | {"same":0,"changed":62,"refused":3,"selected":65,"restamped":0,"retracted":3,"sign_flips":0,"superseded":62,"unrecoverable":0,"tier0_protect |
| 1056 | apply-renormalize | succeeded | 2026-09-13 02:08:02 | cisco | {"same":0,"changed":334,"refused":6,"selected":353,"restamped":0,"retracted":6,"sign_flips":0,"superseded":334,"unrecoverable":13,"tier0_pro |
| 1057 | apply-renormalize | succeeded | 2026-09-13 02:08:04 | cisco | {"same":0,"changed":9,"refused":0,"selected":9,"restamped":0,"retracted":0,"sign_flips":0,"superseded":9,"unrecoverable":0,"tier0_protected" |
| 1058 | apply-renormalize | succeeded | 2026-09-13 02:08:04 | cisco | {"same":0,"changed":80,"refused":0,"selected":89,"restamped":0,"retracted":0,"sign_flips":0,"superseded":80,"unrecoverable":9,"tier0_protect |
| 1059 | apply-renormalize | succeeded | 2026-09-13 02:08:05 | cisco | {"same":0,"changed":14,"refused":0,"selected":14,"restamped":0,"retracted":0,"sign_flips":0,"superseded":14,"unrecoverable":0,"tier0_protect |
| 1060 | recompute-completeness | succeeded | 2026-09-13 02:10:47 | cisco | {"parts":86944,"written":229,"unchanged":86715,"no_profile":0,"non_hardware":44577,"retired_completeness_rows":0} |
| 1061 | move-category | succeeded | 2026-09-14 12:30:56 | cisco | {"to":"switches","from":"meraki","skus":["MS100","MS120","MS120-24","MS120-24P","MS120-48","MS120-48FP","MS120-48LP","MS120-8","MS120-8FP"," |
| 1062 | recompute-completeness | succeeded | 2026-09-14 12:34:35 | cisco / switches | {"parts":9986,"written":2655,"unchanged":7331,"no_profile":0,"non_hardware":2445,"retired_completeness_rows":0} |
| 1063 | recompute-completeness | succeeded | 2026-09-14 12:35:44 | cisco / meraki | {"parts":175,"written":138,"unchanged":37,"no_profile":0,"non_hardware":20,"retired_completeness_rows":0} |
