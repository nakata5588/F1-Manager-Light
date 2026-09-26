// scripts/generate-driver-feeder-placement.mjs
// D7.W2 analysis-only generic feeder placement audit.

import fs from "node:fs/promises";
import path from "node:path";
import { inferDriverWorldEntries } from "../src/domain/driverWorldEntry.js";
import {
  inferDriverFeederPlacements,
  buildDriverFeederPlacementAudit,
} from "../src/domain/driverFeederPlacement.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const outputDir=path.join(root,"scripts","output");
const year=Number(process.argv.find(arg=>arg.startsWith("--year="))?.split("=")[1]||1980);

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}

const [drivers,driverYearStatus,driverCareer,driverDevelopmentHistory,driverHistory]=await Promise.all([
  readJson("drivers.json",[]),
  readJson("driver_year_status.json",[]),
  readJson("driver_career.json",[]),
  readJson("driver_development_history.json",[]),
  readJson("driver_f1_history.json",[]),
]);

if(!drivers.length)throw new Error("D7.W2 requires public/data/drivers.json.");

const entries=inferDriverWorldEntries(drivers,{
  driverYearStatus,driverCareer,driverDevelopmentHistory,driverHistory,
});
const placements=inferDriverFeederPlacements(drivers,entries,year);
const audit=buildDriverFeederPlacementAudit(placements);

await fs.mkdir(outputDir,{recursive:true});
await Promise.all([
  fs.writeFile(
    path.join(outputDir,`driver_feeder_placement_${year}.json`),
    JSON.stringify({
      format:"f1ml-driver-feeder-placement-candidate",
      schema_version:1,
      generated_at:null,
      stage:"D7.W2",
      authority:"analysis_only",
      year,
      placements,
    },null,2)+"\n",
    "utf8"
  ),
  fs.writeFile(
    path.join(outputDir,`driver_feeder_placement_${year}_audit.json`),
    JSON.stringify(audit,null,2)+"\n",
    "utf8"
  ),
]);

console.log("D7.W2 generic feeder placement:",year,"·",placements.length,"profiles");
console.log(
  "Placement counts:",
  Object.entries(audit.placement_counts).map(([key,count])=>key+":"+count).join(" · ")
);

const norm=(value)=>String(value||"")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g,"").trim();
const sentinels=[
  "Ayrton Senna","Alain Prost","Nelson Piquet","Nigel Mansell",
  "Roberto Moreno","Michele Alboreto","Derek Warwick",
  "Michael Schumacher","Lewis Hamilton","Fernando Alonso","Max Verstappen"
];
console.log(year+" feeder sentinels (analysis only):");
for(const name of sentinels){
  const row=placements.find(item=>norm(item.display_name)===norm(name));
  if(!row)continue;
  console.log(
    "  "+name+
    " · "+row.placement+
    " · age "+String(row.age??"—")+
    " · academy "+String(row.can_hire_academy)+
    " · F1 hire "+String(row.can_hire_f1)+
    " · scouting "+row.scouting_profile
  );
}

console.log(`Wrote scripts/output/driver_feeder_placement_${year}.json`);
console.log(`Wrote scripts/output/driver_feeder_placement_${year}_audit.json`);
