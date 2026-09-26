import fs from "node:fs/promises";
import path from "node:path";
import { canonicalTeamId, canonicalTeamName } from "../src/domain/teamIdentity.js";
import { createTeamConstructorBridgeResolver } from "../src/domain/teamConstructorBridge.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const source=path.join(dataDir,"race_results.json");
const target=path.join(dataDir,"team_seasons.json");

const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
    if(value.text!==undefined&&value.text!==null&&value.text!=="")return unwrap(value.text);
  }
  return value;
};
const canon=(value)=>String(unwrap(value)??"")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9]+/g,"")
  .trim();
const first=(row,keys,fallback=undefined)=>{
  for(const key of keys){
    const value=unwrap(row?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
};

async function readJson(file,fallback=[]){
  try{return JSON.parse(await fs.readFile(file,"utf8"));}
  catch{return fallback;}
}

const [rows,teams,drivers,constructorReference,entryRows]=await Promise.all([
  readJson(source,[]),
  readJson(path.join(dataDir,"teams.json"),[]),
  readJson(path.join(dataDir,"drivers.json"),[]),
  readJson(path.join(root,"data","reference","constructor_id_map.json"),{constructors:[]}),
  readJson(path.join(dataDir,"f1_entry_list_history.json"),[]),
]);

const driverNameToId=new Map();
const driverArchiveIdToId=new Map();
for(const driver of drivers){
  const id=String(first(driver,["driver_id","id"],""));
  if(!id)continue;
  const archiveId=Number(first(driver,["driverID_arch","driverId_arch","driverId"],NaN));
  if(Number.isFinite(archiveId))driverArchiveIdToId.set(archiveId,id);
  for(const value of [driver.display_name,driver.driver_name,driver.name,driver.full_name]){
    const key=canon(value);
    if(key&&!driverNameToId.has(key))driverNameToId.set(key,id);
  }
}

function resolveDriver(row){
  const direct=String(first(row,["driver_id","person_id"],""));
  if(direct)return direct;
  const archiveId=Number(first(row,["driverId","driverID"],NaN));
  if(Number.isFinite(archiveId)&&driverArchiveIdToId.has(archiveId))return driverArchiveIdToId.get(archiveId);
  const name=first(row,["driver_name","display_name","driverName","name"],"");
  return driverNameToId.get(canon(name))||"";
}

const bridgeResolver=createTeamConstructorBridgeResolver({
  teams,
  constructorReference,
  entryRows,
});

const byKey=new Map();
let sourceIndex=0;
for(const row of Array.isArray(rows)?rows:[]){
  const year=Number(first(row,["year","season_year"],NaN));
  const driverId=resolveDriver(row);
  if(!Number.isFinite(year)){sourceIndex+=1;continue;}

  const link=bridgeResolver.resolve(row,{driverId});
  // If an entrant cannot yet be resolved, preserve the technical constructor
  // as a compatibility fallback rather than silently dropping participation.
  const teamId=canonicalTeamId(link.team_id||link.constructor_id);
  const teamName=canonicalTeamName(link.team_name||link.chassis_name||link.constructor_name||teamId);
  if(!teamId){sourceIndex+=1;continue;}

  const key=`${year}|${teamId}`;
  if(!byKey.has(key)){
    byKey.set(key,{
      year,
      team_id:teamId,
      team_name:teamName,
      driver_ids:new Set(),
      drivers:new Map(),
      constructor_ids:new Set(),
      constructor_names:new Set(),
      chassis_names:new Set(),
      engine_names:new Set(),
      relation_basis:new Set(),
      confidence:new Set(),
      exact_entrant_rows:0,
      estimated_rows:0,
      unresolved_rows:0,
    });
  }

  const rec=byKey.get(key);
  if(driverId){
    rec.driver_ids.add(driverId);
    const roundRaw=Number(first(row,["round","raceRound","roundNumber"],NaN));
    const raceDate=String(first(row,["race_date","date","dateISO"],""));
    const prev=rec.drivers.get(driverId)||{
      driver_id:driverId,
      appearances:0,
      first_round:null,
      first_date:null,
      first_source_index:sourceIndex,
    };
    prev.appearances+=1;
    if(Number.isFinite(roundRaw)&&(prev.first_round==null||roundRaw<prev.first_round))prev.first_round=roundRaw;
    if(raceDate&&(!prev.first_date||raceDate<prev.first_date))prev.first_date=raceDate;
    prev.first_source_index=Math.min(prev.first_source_index,sourceIndex);
    rec.drivers.set(driverId,prev);
  }

  if(link.constructor_id)rec.constructor_ids.add(String(link.constructor_id));
  if(link.constructor_name)rec.constructor_names.add(String(link.constructor_name));
  if(link.chassis_name)rec.chassis_names.add(String(link.chassis_name));
  if(link.engine_name)rec.engine_names.add(String(link.engine_name));
  if(link.relation_basis)rec.relation_basis.add(String(link.relation_basis));
  if(link.confidence)rec.confidence.add(String(link.confidence));
  if(link.exact_entrant)rec.exact_entrant_rows+=1;
  else if(link.team_id)rec.estimated_rows+=1;
  else rec.unresolved_rows+=1;

  if(!rec.team_name&&teamName)rec.team_name=teamName;
  sourceIndex+=1;
}

const output=[...byKey.values()]
  .map((row)=>({
    year:row.year,
    team_id:row.team_id,
    team_name:row.team_name,
    participation_identity:"team_or_entrant",
    driver_count:row.driver_ids.size,
    driver_ids:[...row.driver_ids].sort(),
    drivers:[...row.drivers.values()].sort((a,b)=>{
      const ar=Number.isFinite(a.first_round)?a.first_round:999;
      const br=Number.isFinite(b.first_round)?b.first_round:999;
      return ar-br||
        a.first_source_index-b.first_source_index||
        b.appearances-a.appearances||
        a.driver_id.localeCompare(b.driver_id);
    }),
    constructor_ids:[...row.constructor_ids].sort(),
    constructor_names:[...row.constructor_names].sort(),
    chassis_names:[...row.chassis_names].sort(),
    engine_names:[...row.engine_names].sort(),
    constructor_count:row.constructor_ids.size||row.constructor_names.size,
    relation_basis:[...row.relation_basis].sort(),
    identity_confidence:[...row.confidence].sort(),
    exact_entrant_rows:row.exact_entrant_rows,
    estimated_rows:row.estimated_rows,
    unresolved_rows:row.unresolved_rows,
  }))
  .sort((a,b)=>a.year-b.year||a.team_name.localeCompare(b.team_name));

await fs.writeFile(target,JSON.stringify(output,null,2)+"\n","utf8");
console.log(
  `Generated team_seasons.json: ${output.length} team/entrant-season rows from ${rows.length} race-result rows`
);
