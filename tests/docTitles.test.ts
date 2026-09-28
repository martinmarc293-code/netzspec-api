// tests/docTitles.test.ts — a PDF's own title is read, a missing one is null, an authoring placeholder is refused.
// Decision: docs/decisions/2026-09-28-untitled-documents.md
import { genericTitle, pdfTitleOf, titleOf } from "../scripts/backfill-doc-titles.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  if (got === want) pass++;
  else misses.push(`${name}\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`);
};
const pdf = (body: string) => Buffer.from(`%PDF-1.4\n${body}\n%%EOF\n`, "latin1");

check("literal /Title with escaped parens",
  pdfTitleOf(pdf("1 0 obj << /Title (Catalyst 9300 \\(C9300\\) Data Sheet) >> endobj")), "Catalyst 9300 (C9300) Data Sheet");
check("hex /Title in UTF-16BE", pdfTitleOf(pdf("1 0 obj << /Title <FEFF00550043005300200043003200320030> >> endobj")), "UCS C220");
check("a dangling odd byte does not throw", pdfTitleOf(pdf("1 0 obj << /Title <FEFF0055004300530020004300320032003000> >> endobj")), "UCS C220");
check("XMP dc:title wins, entities decoded",
  pdfTitleOf(pdf('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">UCS C220 M8 &amp; C240</rdf:li></rdf:Alt></dc:title>')),
  "UCS C220 M8 & C240");
check("NEGATIVE a PDF with no title is null, not a guess", pdfTitleOf(pdf("1 0 obj << /Producer (Acrobat) >> endobj")), null);
check("NEGATIVE HTML bytes are not read as a PDF", pdfTitleOf(Buffer.from("<html><title>x y z</title></html>")), null);
check("html <title> still read", titleOf("<html><title>Cisco &#8211; Nexus</title></html>"), "Cisco " + String.fromCharCode(0x2013) + " Nexus");
check("NEGATIVE an authoring placeholder is refused", genericTitle("Microsoft Word - C9300_ds.docx"), true);
check("a real title is not refused", genericTitle("Cisco Catalyst 9300 Series Switches Data Sheet"), false);

if (misses.length) {
  console.log(`FAIL ${misses.length} of ${pass + misses.length}:`);
  for (const m of misses) console.log(`  ${m}`);
  process.exit(1);
}
console.log(`doc titles: ${pass} of ${pass} — PDF literal/hex/XMP read, absence is null, placeholders refused`);
