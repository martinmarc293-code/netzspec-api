// Dump the populations III.0-4 reads, one TSV per (category.kind), sorted by SKU, for reading.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const parts: any[] = JSON.parse(readFileSync("D:/tmp/kindlayer-III0/C/raw/parts.json", "utf8"));
const POPS = [
  "switches.switch", "transceiver.pluggable", "routers.module", "video.optic",
  "optical-networking.pluggable", "optical-networking.pluggable-tunable",
  "wireless.other", "servers-unified-computing.unknown", "video.unknown", "hyperconverged-systems.unknown",
  "hyperconverged-infrastructure.unknown", "collaboration-endpoints.unknown", "unified-communications.unknown",
  "optical-networking.other", "storage-networking.other", "transceiver.accessory", "meraki.unknown", "conferencing.unknown",
  "routers.enterprise", "servers-unified-computing.server", "security.firewall", "routers.forwarding", "routers.transceiver",
  "unified-communications.server-component", "collaboration-endpoints.server-component", "interfaces-modules.interface",
  "wireless.appliance", "wireless.backhaul", "security.appliance", "conferencing.server-component",
];
mkdirSync("D:/tmp/kindlayer-III0/C/raw/pops", { recursive: true });
const clean = (s: unknown) => String(s ?? "").replace(/[\t\r\n]+/g, " ").slice(0, 150);
for (const pop of POPS) {
  const [c, k] = pop.split(".");
  const rows = parts.filter((p) => p.category === c && p.kind === k).sort((a, b) => a.sku.localeCompare(b.sku));
  const lines = rows.map((p) => [p.sku, p.held, p.own_facts, clean(p.series), clean(p.name),
    Object.keys(p.facts).join(","), p.kind_noname !== p.kind ? "axis=" + p.kind_noname : ""].join("\t"));
  writeFileSync(`D:/tmp/kindlayer-III0/C/raw/pops/${pop}.tsv`, "sku\theld\town\tseries\tname\tfacts\tnote\n" + lines.join("\n") + "\n");
  console.log(pop, rows.length);
}
// interfaces-modules: every kind, for the CPAK/CFP read
const im = parts.filter((p) => p.category === "interfaces-modules").sort((a, b) => a.sku.localeCompare(b.sku));
writeFileSync("D:/tmp/kindlayer-III0/C/raw/pops/interfaces-modules.ALL.tsv", "sku\tkind\theld\town\tseries\tname\n" +
  im.map((p) => [p.sku, p.kind, p.held, p.own_facts, clean(p.series), clean(p.name)].join("\t")).join("\n") + "\n");
