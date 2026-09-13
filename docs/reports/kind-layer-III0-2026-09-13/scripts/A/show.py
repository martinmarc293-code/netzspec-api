import json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
d = json.load(open("D:/tmp/kindlayer-III0/A/raw/item1-label-shares.json", encoding="utf-8"))
key = sys.argv[1]
sub = sys.argv[2] if len(sys.argv) > 2 else None
e = d["kinds"][key]
blocks = [("kind", e)] if sub is None else list(e[sub].items())
for name, b in blocks:
    print("==", key, name, b["coverage"])
    for r in b["rows"]:
        print(f"  {r['cup'][:26]:26} {r['proposed'][:20]:20} {r['today'][:20]:20} occ={r['doc_label_occ']:5} inv={r['inv_occ']} sh={r['share']} att={r['share_attr']} f={r['share_facts']} {r['fill_path'][:20]:20} | {r['verdict'][:48]}")
