// scripts/generate-driver-talent-evidence.mjs
// D7.R1B analysis-only generator. It writes ignored audit artifacts under
// scripts/output and does not alter runtime ratings, Season Packs or saves.

import fs from "node:fs/promises";
import path from "node:path";
import {
  buildDriverTalentEvidence,
  buildDriverTalentEvidenceAudit,
} from "../src/domain/driverTalentEvidence.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const outputDir=path.join(root,"scripts","output");

async function readJson(name,fallback=[]){
  try{
    return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));
  }catch{
    return fallback;
  }
}

const [drivers,events,carCompetitiveness,careerRows]=await Promise.all([
  readJson("drivers.json",[]),
  readJson("race_results_archive.json",[]),
  readJson("car_competitiveness_by_year.json",[]),
  readJson("driver_career.json",[]),
]);

if(!drivers.length){
  throw new Error("D7.R1B requires public/data/drivers.json.");
}
if(!events.length){
  throw new Error(
    "D7.R1B requires the derived historical race archive. Run npm run season:generate first, then npm run talent:evidence."
  );
}

const evidence=buildDriverTalentEvidence({
  drivers,
  events,
  carCompetitiveness,
  careerRows,
});
const audit=buildDriverTalentEvidenceAudit(evidence);

await fs.mkdir(outputDir,{recursive:true});
await Promise.all([
  fs.writeFile(
    path.join(outputDir,"driver_talent_evidence.json"),
    JSON.stringify({
      format:"f1ml-driver-talent-evidence",
      schema_version:2,
      generated_at:null,
      stage:"D7.R1B",
      authority:"analysis_only",
      drivers:evidence,
    },null,2)+"\n",
    "utf8"
  ),
  fs.writeFile(
    path.join(outputDir,"driver_talent_evidence_audit.json"),
    JSON.stringify(audit,null,2)+"\n",
    "utf8"
  ),
]);

console.log(
  "D7.R1B talent evidence:",
  audit.total_drivers+" drivers · "+
  audit.drivers_with_f1_starts+" with F1 starts · "+
  Object.entries(audit.confidence_counts).map(([band,count])=>band+":"+count).join(" · ")
);
console.log("Top comparative evidence (diagnostic only; not ratings):");
for(const row of audit.top_relative_evidence.slice(0,15)){
  console.log(
    "  "+String(row.comparative_evidence_percentile).padStart(5)+
    " · "+row.display_name+
    " · "+row.starts+" starts · "+row.confidence
  );
}
const sentinelNames=[
  "Ayrton Senna","Alain Prost","Michael Schumacher","Lewis Hamilton",
  "Juan Manuel Fangio","Jim Clark","Max Verstappen","Fernando Alonso"
];
console.log("Calibration sentinels — R1A -> R1B (diagnostic only):");
for(const wanted of sentinelNames){
  const row=evidence.find(item=>String(item.display_name||"").normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g,"").toLowerCase()===wanted.normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g,"").toLowerCase());
  if(!row)continue;
  const before=row.r1a_comparative_evidence_percentiles||{};
  const after=row.comparative_evidence_percentiles||{};
  const delta=(key)=>{
    const a=Number(after?.[key]);
    const b=Number(before?.[key]);
    return Number.isFinite(a)&&Number.isFinite(b)?Number((a-b).toFixed(1)):"—";
  };
  console.log(
    "  "+row.display_name+
    " · composite "+String(before.composite??"—")+" -> "+String(after.composite??"—")+
    " ("+delta("composite")+")"+
    " · Q "+String(before.qualifying??"—")+" -> "+String(after.qualifying??"—")+
    " · Race "+String(before.race??"—")+" -> "+String(after.race??"—")+
    " · Peak "+String(before.peak??"—")+" -> "+String(after.peak??"—")+
    " · field "+String(row.opposition_context?.average_field_strength??"—")+
    " · teammate "+String(row.opposition_context?.average_teammate_strength??"—")+
    " · "+row.sample.starts+" starts · "+row.confidence.band
  );
}
console.log("Wrote scripts/output/driver_talent_evidence.json");
console.log("Wrote scripts/output/driver_talent_evidence_audit.json");
