// tests/valuePid.test.ts — the rows whose SKU is a datasheet CELL, and the three nets that were
// not used because each swallowed real products.
//
// `valuePidShape` decides which rows `hygiene value-pids` will retire, so almost every case here
// is a REFUSAL. The rule matches 114 rows in a 91,543-part catalogue; three wider versions were
// measured first and each looked better by the numbers, because the false positives a wider net
// picks up are precisely the rows that resemble the true ones. Every SKU below is real.
import { valuePidShape } from "../src/pipeline/hygiene.js";

type Case = { sku: string; retire: boolean; why: string };

const CASES: Case[] = [
  // --- it MUST match: a number with a unit glued on, named "Cisco <the value>" and nothing else
  { sku: "200K", retire: true, why: "a concurrent-session count from an ASA table" },
  { sku: "10.4G", retire: true, why: "a Firepower 2100 throughput figure" },
  { sku: "1010.5W", retire: true, why: "a power draw" },
  { sku: "42RU", retire: true, why: "a rack height" },
  { sku: "960GB", retire: true, why: "a disk capacity" },
  { sku: "2.4GHz", retire: true, why: "a radio band" },
  { sku: "6.25A", retire: true, why: "a current" },
  { sku: "250V", retire: true, why: "a voltage" },
  { sku: " 12.5W ", retire: true, why: "surrounding whitespace is not a difference" },
  { sku: "128k", retire: true, why: "the unit is matched case-insensitively" },

  // --- REFUSED: the dotted decimal. 523 rows, 280 of them in `video`, and they are real.
  { sku: "4022938.26", retire: false, why: "GS7000 DWDM Tx, 1556.55nm — .26 is its ITU channel" },
  { sku: "4013900.1530", retire: false, why: "the same family; .1530 is the WAVELENGTH" },
  { sku: "1.6.1_002", retire: false, why: "a firmware version, and not this rule's business" },

  // --- REFUSED: the numeric range. 132 rows, and Cisco names real models that way.
  { sku: "9800-40", retire: false, why: "a Catalyst 9800-40 Wireless Controller" },
  { sku: "9800-80", retire: false, why: "and the 9800-80" },
  { sku: "5-15", retire: false, why: "the NEMA 5-15 power plug" },
  { sku: "1000-4999", retire: false, why: "a user tier — a true positive the rule deliberately gives up" },

  // --- REFUSED: anything with a real PID around the number
  { sku: "C9500-12Q", retire: false, why: "a switch" },
  { sku: "SFP-10G-SR", retire: false, why: "an optic" },
  { sku: "00VX183", retire: false, why: "a Lenovo 10G SFP+ transceiver that isPartNumber rejects" },
  { sku: "10060", retire: false, why: "an Extreme 1G SFP: a bare number with no unit is not a value shape" },
  { sku: "10-2614-01", retire: false, why: "a Cisco manufacturing number" },
  { sku: "1545-1548", retire: false, why: "a wavelength band" },
  { sku: "15216-2950", retire: false, why: "an ONS 15216 part" },
  { sku: "", retire: false, why: "the empty string is not a value shape" },
  { sku: "W", retire: false, why: "a unit with no number is not a value" },
  { sku: "12.5WX", retire: false, why: "trailing junk after the unit means it is not a bare value" },
  { sku: "A9K-800G-OPT-LIC", retire: false, why: "a licence, and a licence is a part" },
];

export function run(): { passed: number; failed: number; lines: string[] } {
  const lines: string[] = [];
  let passed = 0, failed = 0;
  for (const c of CASES) {
    const got = valuePidShape(c.sku);
    if (Boolean(got) === c.retire) passed++;
    else {
      failed++;
      lines.push(`    MISS ${JSON.stringify(c.sku)} -> ${got ? got.rule : "no match"}, ` +
                 `wanted ${c.retire ? "a match" : "no match"} (${c.why})`);
    }
  }

  // The rule must NAME the unit it fired on, so a retirement traces back to the shape that caused
  // it rather than to a bare "value_as_pid" that says nothing.
  const r = valuePidShape("200K");
  if (r && r.rule === "value_as_pid:k") passed++;
  else { failed++; lines.push(`    MISS 200K gave rule ${r?.rule} — the reason must name the unit`); }

  const refusals = CASES.filter((c) => !c.retire).length;
  lines.unshift(`    value-pid shape: ${passed} passed, ${failed} missed (${refusals} refusal cases)`);
  return { passed, failed, lines };
}

const r = run();
console.log(r.lines.join("\n"));
if (r.failed) process.exit(1);
