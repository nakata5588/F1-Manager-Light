// scripts/generate-driver-talent-profiles.mjs
// D7.R1C analysis-only candidate Talent Profile generator.
// Outputs are ignored development artifacts; runtime ratings are untouched.

import fs from "node:fs/promises";
import path from "node:path";
import { buildDriverTalentEvidence } from "../src/domain/driverTalentEvidence.js";
import {
  inferDriverTalentProfiles,
  buildDriverTalentProfileAudit,
} from "../src/domain/driverTalentProfileInference.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const outputDir=path.join(root,"scripts","output");

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}

const [drivers,events,carCompetitiveness,careerRows]=await Promise.all([
  readJson("drivers.json",[]),
  readJson("race_results_archive.json",[]),
  readJson("car_competitiveness_by_year.json",[]),
  readJson("driver_career.json",[]),
]);

if(!drivers.length)throw new Error("D7.R1C requires public/data/drivers.json.");
if(!events.length){
  throw new Error(
    "D7.R1C requires the derived historical race archive. Run npm run season:generate first."
  );
}

const evidence=buildDriverTalentEvidence({
  drivers,
  events,
  carCompetitiveness,
  careerRows,
});
const profiles=inferDriverTalentProfiles(evidence);
const audit=buildDriverTalentProfileAudit(profiles);

await fs.mkdir(outputDir,{recursive:true});
await Promise.all([
  fs.writeFile(
    path.join(outputDir,"driver_talent_profiles_candidate.json"),
    JSON.stringify({
      format:"f1ml-driver-talent-profiles-candidate",
      schema_version:1,
      generated_at:null,
      stage:"D7.R1C",
      authority:"analysis_only",
      profiles,
    },null,2)+"\n",
    "utf8"
  ),
  fs.writeFile(
    path.join(outputDir,"driver_talent_profiles_audit.json"),
    JSON.stringify(audit,null,2)+"\n",
    "utf8"
  ),
]);

console.log(
  "D7.R1C candidate Talent Profiles:",
  audit.total_profiles+" profiles · "+
  audit.profiles_with_f1_starts+" with F1 starts · "+
  audit.profiles_without_f1_starts+" without F1 starts"
);
console.log(
  "Peak Ability distribution:",
  Object.entries(audit.peak_ability_distribution)
    .map(([bucket,count])=>bucket+":"+count)
    .join(" · ")
);
console.log("Top candidate profiles (analysis only; not runtime ratings):");
for(const row of audit.top_profiles.slice(0,20)){
  console.log(
    "  "+String(row.peak_ability).padStart(4)+
    " · "+row.display_name+
    " · "+row.talent_band+
    " · Pace "+row.pace+
    " · Q "+row.qualifying+
    " · Racecraft "+row.racecraft+
    " · "+row.confidence
  );
}

const sentinelNames=[
  "Ayrton Senna","Alain Prost","Michael Schumacher","Lewis Hamilton",
  "Juan Fangio","Jim Clark","Max Verstappen","Fernando Alonso"
];
console.log("Calibration sentinels — candidate Talent ceilings:");
for(const wanted of sentinelNames){
  const normalized=wanted.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const row=profiles.find(item=>
    String(item.display_name||"").normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"").toLowerCase()===normalized
  );
  if(!row)continue;
  console.log(
    "  "+row.display_name+
    " · PA "+row.peak_ability+
    " · Pace "+row.ceilings.pace+
    " · Q "+row.ceilings.qualifying+
    " · Racecraft "+row.ceilings.racecraft+
    " · Cons "+row.ceilings.consistency+
    " · RaceIQ "+row.ceilings.race_intelligence+
    " · Pressure "+row.ceilings.pressure_handling+
    " · "+row.profile_confidence.band
  );
}

console.log("Wrote scripts/output/driver_talent_profiles_candidate.json");
console.log("Wrote scripts/output/driver_talent_profiles_audit.json");
