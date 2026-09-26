// scripts/generate-driver-world-entry.mjs
// D7.W1 analysis-only generator.
// Produces candidate historical world-entry rows and an audit snapshot.
// Runtime Season Packs are intentionally untouched in W1.

import fs from "node:fs/promises";
import path from "node:path";
import {
  inferDriverWorldEntries,
  driverWorldStageAtYear,
  buildDriverWorldEntryAudit,
} from "../src/domain/driverWorldEntry.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const outputDir=path.join(root,"scripts","output");

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}

const [drivers,driverYearStatus,driverCareer,driverDevelopmentHistory,driverHistory]=await Promise.all([
  readJson("drivers.json",[]),
  readJson("driver_year_status.json",[]),
  readJson("driver_career.json",[]),
  readJson("driver_development_history.json",[]),
]);

if(!drivers.length)throw new Error("D7.W1 requires public/data/drivers.json.");

const context={driverYearStatus,driverCareer,driverDevelopmentHistory,driverHistory};
const entries=inferDriverWorldEntries(drivers,context);
const audit=buildDriverWorldEntryAudit(entries,drivers);

await fs.mkdir(outputDir,{recursive:true});
await Promise.all([
  fs.writeFile(
    path.join(outputDir,"driver_world_entry_candidate.json"),
    JSON.stringify({
      format:"f1ml-driver-world-entry-candidate",
      schema_version:1,
      generated_at:null,
      stage:"D7.W1",
      authority:"analysis_only",
      entries,
    },null,2)+"\n",
    "utf8"
  ),
  fs.writeFile(
    path.join(outputDir,"driver_world_entry_audit.json"),
    JSON.stringify(audit,null,2)+"\n",
    "utf8"
  ),
]);

console.log(
  "D7.W1 world-entry candidates:",
  audit.total_drivers+" drivers · "+
  audit.resolved+" resolved · "+
  audit.unresolved+" unresolved"
);
console.log(
  "Entry sources:",
  Object.entries(audit.entry_source_counts)
    .map(([key,count])=>key+":"+count)
    .join(" · ")
);
console.log(
  "Entry levels:",
  Object.entries(audit.entry_level_counts)
    .map(([key,count])=>key+":"+count)
    .join(" · ")
);

const norm=(value)=>String(value||"")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g,"")
  .trim();

const sentinelNames=[
  "Ayrton Senna","Alain Prost","Nelson Piquet","Nigel Mansell",
  "Roberto Moreno","Michele Alboreto","Derek Warwick",
  "Michael Schumacher","Lewis Hamilton","Fernando Alonso","Max Verstappen"
];
console.log("1980 world-entry sentinels (analysis only):");
for(const wanted of sentinelNames){
  const driver=drivers.find(row=>norm(row.display_name)===norm(wanted));
  const entry=entries.find(row=>norm(row.display_name)===norm(wanted));
  if(!driver||!entry)continue;
  const state=driverWorldStageAtYear(driver,entry,1980);
  console.log(
    "  "+wanted+
    " · first "+String(entry.first_world_year??"—")+
    " · debut "+String(entry.reference_f1_debut_year??"—")+
    " · 1980 "+state.stage+
    " · age "+String(state.age??"—")+
    " · "+entry.entry_source+
    " · "+entry.entry_confidence
  );
}

console.log(
  "1980 active-world count:",
  audit.year_snapshots?.["1980"]?.active_world??0,
  "of",
  audit.total_drivers
);
console.log(
  "1980 stage counts:",
  JSON.stringify(audit.year_snapshots?.["1980"]?.counts||{})
);
console.log("Wrote scripts/output/driver_world_entry_candidate.json");
console.log("Wrote scripts/output/driver_world_entry_audit.json");
