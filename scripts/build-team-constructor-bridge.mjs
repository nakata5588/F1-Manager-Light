import fs from "node:fs/promises";
import path from "node:path";
import { createTeamConstructorBridgeResolver } from "../src/domain/teamConstructorBridge.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const target=path.join(dataDir,"team_constructor_bridge.json");

async function readJson(file,fallback=[]){
  try{return JSON.parse(await fs.readFile(file,"utf8"));}
  catch{return fallback;}
}

const [raceRows,teams,drivers,constructorReference,entryRows]=await Promise.all([
  readJson(path.join(dataDir,"race_results.json"),[]),
  readJson(path.join(dataDir,"teams.json"),[]),
  readJson(path.join(dataDir,"drivers.json"),[]),
  readJson(path.join(root,"data","reference","constructor_id_map.json"),{constructors:[]}),
  readJson(path.join(dataDir,"f1_entry_list_history.json"),[]),
]);

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
const first=(row,keys,fallback="")=>{
  for(const key of keys){
    const value=unwrap(row?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
};

const driverArchiveIdToId=new Map();
const driverNameToId=new Map();
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
  const name=first(row,["driver_name","driverName","display_name","name"],"");
  return driverNameToId.get(canon(name))||"";
}

const resolver=createTeamConstructorBridgeResolver({
  teams,
  constructorReference,
  entryRows,
});

const byKey=new Map();
let unresolved=0;
let exactEntrants=0;
let estimatedEntrants=0;

for(const row of Array.isArray(raceRows)?raceRows:[]){
  const driverId=resolveDriver(row);
  const link=resolver.resolve(row,{driverId});
  if(!link.year||!link.constructor_name)continue;

  if(!link.team_id)unresolved+=1;
  else if(link.exact_entrant)exactEntrants+=1;
  else estimatedEntrants+=1;

  const key=[
    link.year,
    link.team_id||"unresolved",
    link.constructor_id||link.constructor_name,
    link.relation_basis,
  ].join("|");

  if(!byKey.has(key)){
    byKey.set(key,{
      ...link,
      driver_ids:new Set(),
      rounds:new Set(),
      result_rows:0,
    });
  }
  const rec=byKey.get(key);
  rec.result_rows+=1;
  if(driverId)rec.driver_ids.add(driverId);
  const round=Number(first(row,["round","raceRound","roundNumber"],NaN));
  if(Number.isFinite(round))rec.rounds.add(round);
}

const output=[...byKey.values()]
  .map((row)=>({
    year:row.year,
    team_id:row.team_id||null,
    team_name:row.team_name||null,
    entrant_id:row.entrant_id||null,
    entrant_name:row.entrant_name||null,
    constructor_id:row.constructor_id||null,
    constructor_name:row.constructor_name,
    chassis_name:row.chassis_name||null,
    engine_name:row.engine_name||null,
    relation_basis:row.relation_basis,
    confidence:row.confidence,
    exact_entrant:Boolean(row.exact_entrant),
    driver_ids:[...row.driver_ids].sort(),
    rounds:[...row.rounds].sort((a,b)=>a-b),
    first_round:row.rounds.size?Math.min(...row.rounds):null,
    last_round:row.rounds.size?Math.max(...row.rounds):null,
    result_rows:row.result_rows,
  }))
  .sort((a,b)=>
    a.year-b.year||
    String(a.team_name||"").localeCompare(String(b.team_name||""))||
    String(a.constructor_name||"").localeCompare(String(b.constructor_name||""))
  );

await fs.writeFile(target,JSON.stringify(output,null,2)+"\n","utf8");
console.log(
  `Generated team_constructor_bridge.json: ${output.length} links · ${exactEntrants} exact result links · ${estimatedEntrants} estimated result links · ${unresolved} unresolved result links`
);
