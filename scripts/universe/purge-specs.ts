// scripts/universe/purge-specs.ts — remove specs_v2 entries by tier and field key.
//   npx tsx scripts/universe/purge-specs.ts --tier 1 --keys poe_budget,power_max [--commit]
// Used when a field turns out to be semantically wrong rather than mechanically wrong: the value
// was really in the cell, but the cell meant something narrower than the field claims. Leaving it
// in place would be worse than the gap it fills.
import fs from "node:fs"; import path from "node:path"; import { MongoClient } from "mongodb";
import { completenessV2, PROFILES } from "../../lib/fieldSchema.js";
const arg=(n:string)=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:null;};
const COMMIT=process.argv.includes("--commit");
const TIER=Number(arg("--tier")??"1");
const KEYS=new Set((arg("--keys")||"").split(",").map(s=>s.trim()).filter(Boolean));
if(!KEYS.size){console.error("--keys required");process.exit(2);}
const root=process.cwd();
const env=Object.fromEntries(fs.readFileSync(path.join(root,".env.local"),"utf8").split("\n")
  .filter(l=>l.includes("=")&&!l.trim().startsWith("#"))
  .map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
async function main(){
const c=new MongoClient(env.MONGODB_URI as string,{serverSelectionTimeoutMS:30000,retryReads:true});
await c.connect(); const P=c.db(env.MONGODB_DB as string).collection("parts");
const cur=P.find({"specs_v2.k":{$in:[...KEYS]}},{projection:{_id:0,sku:1,category:1,specs_v2:1}}).batchSize(200);
let parts=0,removed=0; const ops:any[]=[];
for await(const p of cur){
  const specs=(p.specs_v2 as any[])||[];
  const keep=specs.filter(s=>!(KEYS.has(s.k)&&(s.prov?.tier??0)===TIER));
  const n=specs.length-keep.length;
  if(!n) continue;
  parts++; removed+=n;
  const cat=String(p.category||"");
  const values:Record<string,unknown>={};
  for(const s of keep) if(s.state==="verified"||s.state==="corroborated") values[s.k]=s.value;
  const cv=PROFILES[cat]?completenessV2(cat,values):null;
  if(COMMIT) ops.push({updateOne:{filter:{sku:p.sku},update:{$set:{specs_v2:keep,
    ...(cv?{completeness_v2:{required_total:cv.required_total,required_present:cv.required_present,
      pct:cv.pct,missing:cv.missing,no_profile:cv.no_profile,computed_at:new Date().toISOString().slice(0,10)}}:{})}}}});
  if(COMMIT&&ops.length>=400){await P.bulkWrite(ops.splice(0),{ordered:false});}
}
if(COMMIT&&ops.length) await P.bulkWrite(ops,{ordered:false});
console.log(`${COMMIT?"PURGED":"DRY RUN"} — ${removed} entries (tier ${TIER}, keys ${[...KEYS].join(",")}) from ${parts} parts`);
await c.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
