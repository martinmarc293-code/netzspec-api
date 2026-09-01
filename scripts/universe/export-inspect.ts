// scripts/universe/export-inspect.ts — human-readable dump of what is actually stored, with
// provenance, so a person can check the data rather than trust a summary.
//   npx tsx scripts/universe/export-inspect.ts [--vendor cisco] [--tier 1] [--out FILE]
import fs from "node:fs"; import path from "node:path"; import { MongoClient } from "mongodb";
import { FIELD_DICTIONARY } from "../../lib/fieldSchema.js";
const arg=(n:string)=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:null;};
const OUT=arg("--out")||"reports/data-inspection.md";
const TIER=arg("--tier");
const root=process.cwd();
const env=Object.fromEntries(fs.readFileSync(path.join(root,".env.local"),"utf8").split("\n")
  .filter(l=>l.includes("=")&&!l.trim().startsWith("#"))
  .map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
async function main(){
const c=new MongoClient(env.MONGODB_URI as string,{serverSelectionTimeoutMS:30000}); await c.connect();
const db=c.db(env.MONGODB_DB as string), P=db.collection("parts");
const q:Record<string,unknown> = TIER? {"specs_v2.prov.tier": Number(TIER)} : {};
const parts=await P.find(q,{projection:{_id:0,sku:1,vendor:1,category:1,family:1,specs_v2:1,completeness_v2:1}}).limit(400).toArray();
const docs=await db.collection("source_docs").find({},{projection:{_id:0,doc_id:1,url:1}}).toArray();
const docUrl=new Map(docs.map(d=>[d.doc_id,d.url]));
const L:string[]=[];
L.push(`# What is actually stored in specs_v2`);
L.push(``);
L.push(`Generated ${new Date().toISOString()} · ${parts.length} parts shown${TIER?` (filtered to tier ${TIER})`:""}.`);
L.push(``);
L.push(`Every row shows the value, the unit, the trust tier, and the EXACT cell it came from`);
L.push(`(table:row:column inside the source document), so any value can be traced back by hand.`);
L.push(``);
for(const p of parts){
  const specs=(p.specs_v2 as any[])||[];
  const cv=p.completeness_v2 as any;
  L.push(`## ${p.sku}  <sub>${p.vendor} · ${p.category} · ${p.family||""}</sub>`);
  if(cv&&!cv.no_profile) L.push(`completeness: **${cv.required_present}/${cv.required_total}** required fields (${cv.pct}%)`);
  L.push(``);
  L.push(`| field | value | unit | tier | state | from cell | source document |`);
  L.push(`|---|---|---|---|---|---|---|`);
  for(const s of specs.sort((a,b)=>a.k.localeCompare(b.k))){
    const d=FIELD_DICTIONARY[s.k];
    const url=s.prov?.doc_id?docUrl.get(s.prov.doc_id):"";
    const short=url?String(url).split("/").pop():"(seed)";
    L.push(`| ${d?d.de:s.k} \`${s.k}\` | ${JSON.stringify(s.value)} | ${s.unit??""} | ${s.prov?.tier??""} | ${s.state}${s.inherited?" (Serienangabe)":""} | \`${s.prov?.locator??""}\` | ${short} |`);
  }
  L.push(``);
}
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,L.join("\n")+"\n");
console.log(`wrote ${OUT} — ${parts.length} parts, ${parts.reduce((a,p)=>a+((p.specs_v2 as any[])||[]).length,0)} spec rows`);
await c.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
