import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const seasonIndex=path.join(dataDir,"seasons","index.json");

const derivedTopLevel=new Set([
  "team_seasons.json",
  "driver_f1_history.json",
  "race_results_archive.json",
]);

const generatorFiles=[
  "scripts/build-team-constructor-bridge.mjs",
  "scripts/build-team-seasons.mjs",
  "scripts/build-driver-history.mjs",
  "scripts/build-historical-championships.mjs",
  "scripts/build-race-results-archive.mjs",
  "scripts/build-season-packs.mjs",
  "scripts/build-historical-assets.mjs",
  "src/data/seasonPackMaterializer.js",
  "src/domain/teamConstructorBridge.js",
  "src/domain/teamIdentity.js",
  "src/domain/driverStartingRating.js",
  "src/domain/driverWorldEntry.js",
  "src/domain/driverFeederPlacement.js",
  "src/domain/lowerSeriesTeams.js",
];

async function statOrNull(file){
  try{return await fs.stat(file);}
  catch{return null;}
}

async function missingGeneratedOutput(){
  for(const rel of [
    "public/data/team_seasons.json",
    "public/data/driver_f1_history.json",
    "public/data/race_results_archive.json",
    "public/data/seasons/index.json",
  ]){
    if(!await statOrNull(path.join(root,rel)))return rel;
  }

  try{
    const index=JSON.parse(await fs.readFile(seasonIndex,"utf8"));
    for(const row of Array.isArray(index?.years)?index.years:[]){
      const rel=String(row?.path||"").replace(/^\/+/, "");
      if(rel&&!await statOrNull(path.join(root,rel)))return rel;
    }
  }catch{
    return "public/data/seasons/index.json";
  }
  return null;
}

async function latestSourceMtime(){
  let latest=0;
  const entries=await fs.readdir(dataDir,{withFileTypes:true});
  for(const entry of entries){
    if(!entry.isFile()||!entry.name.endsWith(".json")||derivedTopLevel.has(entry.name))continue;
    const stat=await statOrNull(path.join(dataDir,entry.name));
    if(stat)latest=Math.max(latest,stat.mtimeMs);
  }
  for(const rel of generatorFiles){
    const stat=await statOrNull(path.join(root,rel));
    if(stat)latest=Math.max(latest,stat.mtimeMs);
  }
  return latest;
}

async function needsRefresh(){
  const missing=await missingGeneratedOutput();
  if(missing)return {refresh:true,reason:`missing ${missing}`};

  const indexStat=await statOrNull(seasonIndex);
  const sourceMtime=await latestSourceMtime();
  if(!indexStat||sourceMtime>indexStat.mtimeMs){
    return {refresh:true,reason:"source data or generator code is newer than the Season Packs"};
  }
  return {refresh:false,reason:"derived data is current"};
}

const decision=await needsRefresh();
if(!decision.refresh){
  console.log(`[dev-data] ${decision.reason}; starting Vite.`);
  process.exit(0);
}

console.log(`[dev-data] ${decision.reason}; rebuilding derived runtime data once before Vite.`);
const npmExec=process.env.npm_execpath;
const command=npmExec?process.execPath:(process.platform==="win32"?"npm.cmd":"npm");
const args=npmExec?[npmExec,"run","season:derive"]:["run","season:derive"];
const run=spawnSync(command,args,{
  cwd:root,
  stdio:"inherit",
});
if(run.error)throw run.error;
if(run.status!==0)process.exit(run.status??1);
