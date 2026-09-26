// scripts/generate-driver-talent-evidence.mjs
// D7.R1A analysis-only generator. It writes ignored audit artifacts under
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
  throw new Error("D7.R1A requires public/data/drivers.json.");
}
if(!events.length){
  throw new Error(
    "D7.R1A requires the derived historical race archive. Run npm run season:generate first, then npm run talent:evidence."
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
      schema_version:1,
      generated_at:null,
      stage:"D7.R1A",
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
  "D7.R1A talent evidence:",
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
console.log("Wrote scripts/output/driver_talent_evidence.json");
console.log("Wrote scripts/output/driver_talent_evidence_audit.json");
