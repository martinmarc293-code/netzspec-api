// tests/docTitles.test.ts — a PDF's Info /Title is read (not the first /Title in the file); a missing one is null;
// titles that name the authoring process are refused. Decision: docs/decisions/2026-09-28-untitled-documents.md
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pdfInfoTitles, titleOf, titleRefusal } from "../scripts/backfill-doc-titles.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  if (got === want) pass++;
  else misses.push(`${name}\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`);
};
const BS = String.fromCharCode(92);

// Refusals: every negative is a row the first (raw-byte) version wrote as "recovered" on 28 Sep.
check("NEGATIVE 'Print' is one token", titleRefusal("Print"), "single_token");
check("NEGATIVE an image asset name", titleRefusal("Cisco_Logo_2PMS_TM_10in"), "single_token");
check("NEGATIVE a template name", titleRefusal("MS Word Template_102504"), "placeholder");
check("NEGATIVE a file path", titleRefusal(`C:${BS}Users${BS}e0081951${BS}Documents${BS}Shark drawing`), "file_path");
check("NEGATIVE a file name", titleRefusal("FEDEX1.pdf"), "file_name");
check("NEGATIVE bytes that are not text", titleRefusal(String.fromCharCode(0xb1, 0x68, 0xfb, 0x67, 0x4e, 0xe4, 0x25, 0xf4, 0xa9, 0x53)), "not_text");
check("a real title passes", titleRefusal("Cisco 8100 Series Secure Routers"), null);
check("a German title passes", titleRefusal("Datenblatt der Schalter f" + String.fromCharCode(0xfc) + "r B" + String.fromCharCode(0xfc) + "ros"), null);
check("html <title> still read", titleOf("<html><title>Cisco &#8211; Nexus</title></html>"), "Cisco " + String.fromCharCode(0x2013) + " Nexus");

// The parser case the raw-byte version got wrong: a bookmark's /Title (Print) sits BEFORE the Info dictionary.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doctitles-"));
const withInfo = path.join(dir, "info.pdf"), noInfo = path.join(dir, "none.pdf");
fs.writeFileSync(withInfo, [
  "%PDF-1.4", "1 0 obj", "<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>", "endobj",
  "2 0 obj", "<< /Type /Pages /Kids [] /Count 0 >>", "endobj",
  "4 0 obj", "<< /Title (Print) >>", "endobj",
  "3 0 obj", "<< /Title (Cisco 8100 Series Secure Routers) /Producer (x) >>", "endobj",
  "trailer", "<< /Root 1 0 R /Info 3 0 R >>", "%%EOF", ""].join("\n"), "latin1");
fs.writeFileSync(noInfo, [
  "%PDF-1.4", "1 0 obj", "<< /Type /Catalog /Pages 2 0 R >>", "endobj",
  "2 0 obj", "<< /Type /Pages /Kids [] /Count 0 >>", "endobj",
  "trailer", "<< /Root 1 0 R >>", "%%EOF", ""].join("\n"), "latin1");
let got: Map<string, { title: string | null; error: string | null }> | null = null;
try { got = pdfInfoTitles([withInfo, noInfo]); } catch (e) {
  console.log(`NOT EXERCISED: pdfInfoTitles could not run here (${e instanceof Error ? e.message : String(e)})`);
  process.exit(2);
}
check("the Info /Title wins over an earlier bookmark /Title", got.get(withInfo)?.title, "Cisco 8100 Series Secure Routers");
check("NEGATIVE a PDF with no Info dictionary is null, not a guess", got.get(noInfo)?.title, null);
fs.rmSync(dir, { recursive: true, force: true });

if (misses.length) {
  console.log(`FAIL ${misses.length} of ${pass + misses.length}:`);
  for (const m of misses) console.log(`  ${m}`);
  process.exit(1);
}
console.log(`doc titles: ${pass} of ${pass} — Info /Title read past a bookmark, absence is null, six real junk shapes refused`);
