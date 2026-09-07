import { readFileSync, writeFileSync } from "node:fs";
import { mapLabel } from "../src/core/deepSpecMap.js";
const d = JSON.parse(readFileSync("D:/Project/netzspec-parent/fields-servers-clean.json", "utf8"));
const hit: string[] = [];
for (const r of d.labels) if (mapLabel(r.label, "servers-unified-computing")) hit.push(r.label);
writeFileSync("D:/Project/netzspec-parent/mapped-labels.txt", hit.join("\n"), "utf8");
console.log("  wrote " + hit.length + " already-mapped labels");
