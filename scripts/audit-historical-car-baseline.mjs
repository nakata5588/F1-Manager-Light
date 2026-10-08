// Historical car baseline audit: real archive evidence and managerial identity.
// Diagnostic only. Does not materialize a playable car or touch drivers.
import fs from "node:fs/promises";
import { createTeamConstructorBridgeResolver } from "../src/domain/teamConstructorBridge.js";
import { materializeHistoricalCarBaselines } from "../src/domain/historicalCarResultBaseline.js";

const root=new URL("../",import.meta.url);
async function read(path,fallback=[]){
  try{return JSON.parse(await fs.readFile(new URL(path,root),"utf8"));}
  catch(err){if(err.code==="ENOENT")return fallback;throw err;}
}
const [results,teams,drivers,reference,entries]=await Promise.all([
  read("public/data/race_results.json"),
  read("public/data/teams.json"),
  read("public/data/drivers.json"),
  read("data/reference/constructor_id_map.json",{constructors:[]}),
  read("public/data/f1_entry_list_history.json"),
]);
if(!results.length)throw Error("Historical results missing; run data build first");
const resolver=createTeamConstructorBridgeResolver({teams,constructorReference:reference,entryRows:entries});
const archiveDrivers=new Map();
const idDrivers=new Set();
for(const driver of drivers){
  const id=String(driver.driver_id??driver.id??"");
  if(!id)continue;
  idDrivers.add(id);
  const archive=Number(driver.driverID_arch??driver.driverId_arch??driver.driverId);
  if(Number.isFinite(archive))archiveDrivers.set(archive,id);
}
const year=Number(process.argv.find(arg=>arg.startsWith("--year="))?.split("=")[1]??2000);
let skippedTeam=0,skippedDriver=0,estimatedTeam=0,matched=0;
const prepared=[];
for(const result of results){
  if(Number(result.year??result.season_year)!==year)continue;
  const raw=String(result.driver_id??"");
  const driver=idDrivers.has(raw)?raw:archiveDrivers.get(Number(result.driverId??result.driverID))??"";
  if(!driver){skippedDriver++;continue;}
  const link=resolver.resolve(result,{driverId:driver,year});
  const team=String(link?.team_id??"").trim();
  if(!team){skippedTeam++;continue;}
  if(!link.exact_entrant){estimatedTeam++;continue;}
  matched++;
  prepared.push({...result,team_id:team,driver_id:driver});
}
const baselines=materializeHistoricalCarBaselines(prepared,year);
const summary={
  kind:"historical_results_baseline_audit",
  year,sourceResults:results.filter(x=>Number(x.year??x.season_year)===year).length,
  exactEntrantResults:matched,
  skippedUnmappedDriver:skippedDriver,
  skippedUnmappedTeam:skippedTeam,
  excludedEstimatedEntrant:estimatedTeam,
  rankedTeams:baselines.map(x=>({team_id:x.team_id,race:x.race,qualifying:x.qualifying,
    reliability:x.reliability,drivers:x.evidence_driver_count,rows:x.evidence_result_count,confidence:x.confidence})),
};
console.log("HISTORICAL_CAR_BASELINE_AUDIT="+JSON.stringify(summary));
if(!baselines.length)throw Error("No verified team/result matches: do not activate car baselines");
