import fs from "node:fs/promises";
import path from "node:path";
import { createTeamConstructorBridgeResolver } from "../src/domain/teamConstructorBridge.js";
import { canonicalTeamId, canonicalTeamName } from "../src/domain/teamIdentity.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");

const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
    if(value.text!==undefined&&value.text!==null&&value.text!=="")return unwrap(value.text);
  }
  return value;
};
const pick=(row,keys,fallback="")=>{
  for(const key of keys){
    const value=unwrap(row?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
};
const canon=(value)=>String(unwrap(value)??"")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9]+/g,"")
  .trim();

async function readJson(file,fallback=[]){
  try{return JSON.parse(await fs.readFile(file,"utf8"));}
  catch{return fallback;}
}

const yearArg=process.argv.find((arg)=>arg.startsWith("--year="));
const focusYear=yearArg?Number(yearArg.slice("--year=".length)):2011;
const windowArg=process.argv.find((arg)=>arg.startsWith("--window="));
const windowSize=windowArg?Math.max(0,Number(windowArg.slice("--window=".length))||0):1;

const [results,teams,drivers,constructorReference,entryRows]=await Promise.all([
  readJson(path.join(dataDir,"race_results.json"),[]),
  readJson(path.join(dataDir,"teams.json"),[]),
  readJson(path.join(dataDir,"drivers.json"),[]),
  readJson(path.join(root,"data","reference","constructor_id_map.json"),{constructors:[]}),
  readJson(path.join(dataDir,"f1_entry_list_history.json"),[]),
]);

const driverIds=new Set();
const archiveToDriver=new Map();
const nameToDriver=new Map();
for(const driver of drivers){
  const id=String(pick(driver,["driver_id","id"],""));
  if(!id)continue;
  driverIds.add(id);
  const archive=Number(pick(driver,["driverID_arch","driverId_arch","driverId"],NaN));
  if(Number.isFinite(archive))archiveToDriver.set(archive,id);
  for(const value of [driver.display_name,driver.driver_name,driver.full_name,driver.name]){
    const key=canon(value);
    if(key&&!nameToDriver.has(key))nameToDriver.set(key,id);
  }
}
function driverIdFor(row){
  const direct=String(pick(row,["driver_id","person_id"],""));
  if(direct&&driverIds.has(direct))return direct;
  const archive=Number(pick(row,["driverId","driverID"],NaN));
  if(Number.isFinite(archive)&&archiveToDriver.has(archive))return archiveToDriver.get(archive);
  return nameToDriver.get(canon(pick(row,["driver_name","driverName","display_name","name"],"")))||direct||"";
}

const resolver=createTeamConstructorBridgeResolver({teams,constructorReference,entryRows});
const teamMaster=new Map(
  teams.map((team)=>[
    canonicalTeamId(pick(team,["team_id","id","constructor_id"],"")),
    team,
  ]).filter(([id])=>id)
);

const byYear=new Map();
for(const row of results){
  const year=Number(pick(row,["year","season_year"],NaN));
  if(!Number.isInteger(year))continue;
  const driverId=driverIdFor(row);
  const link=resolver.resolve(row,{year,driverId});
  const round=Number(pick(row,["round","raceRound","roundNumber"],NaN));
  const key=[
    canonicalTeamId(link.team_id||"unresolved"),
    link.constructor_id||"",
    link.constructor_name||"",
    link.relation_basis||"",
  ].join("|");
  if(!byYear.has(year))byYear.set(year,new Map());
  const rows=byYear.get(year);
  if(!rows.has(key)){
    const master=teamMaster.get(canonicalTeamId(link.team_id))||{};
    rows.set(key,{
      year,
      team_id:canonicalTeamId(link.team_id)||null,
      resolved_team_name:canonicalTeamName(link.team_name)||null,
      master_team_name:canonicalTeamName(pick(master,["team_name","name","short_name"],""))||null,
      constructor_id:link.constructor_id||null,
      constructor_name:link.constructor_name||null,
      chassis_name:link.chassis_name||null,
      engine_name:link.engine_name||null,
      relation_basis:link.relation_basis,
      confidence:link.confidence,
      exact_entrant:Boolean(link.exact_entrant),
      result_rows:0,
      round1_driver_ids:new Set(),
      all_driver_ids:new Set(),
    });
  }
  const rec=rows.get(key);
  rec.result_rows+=1;
  if(driverId){
    rec.all_driver_ids.add(driverId);
    if(round===1)rec.round1_driver_ids.add(driverId);
  }
}

const start=focusYear-windowSize;
const end=focusYear+windowSize;
console.log("\nTeams 3.0 — Results ↔ Teams identity audit");
console.log(`Focus: ${focusYear} · window ${start}-${end}`);

for(let year=start;year<=end;year++){
  const rows=[...(byYear.get(year)?.values()||[])].sort((a,b)=>
    String(a.resolved_team_name||a.constructor_name||"").localeCompare(
      String(b.resolved_team_name||b.constructor_name||"")
    )
  );
  console.log(`\n${year}: ${new Set(rows.map((row)=>row.team_id).filter(Boolean)).size} resolved managerial teams`);
  console.table(rows.map((row)=>({
    TEAM_ID:row.team_id||"—",
    TEAM:row.resolved_team_name||"—",
    MASTER:row.master_team_name||"—",
    CONSTRUCTOR:row.constructor_name||"—",
    BASIS:row.relation_basis||"—",
    CONF:row.confidence||"—",
    EXACT:row.exact_entrant?"yes":"no",
    R1:row.round1_driver_ids.size,
    DRIVERS:row.all_driver_ids.size,
    ROWS:row.result_rows,
  })));
}

const focusRows=[...(byYear.get(focusYear)?.values()||[])];
const unresolved=focusRows.filter((row)=>!row.team_id);
const noRound1=focusRows.filter((row)=>row.team_id&&row.round1_driver_ids.size===0);
const lowRound1=focusRows.filter((row)=>row.team_id&&row.round1_driver_ids.size>0&&String(row.confidence).toUpperCase()==="LOW");
const multiLinks=new Map();
for(const row of focusRows){
  if(!row.constructor_name||!row.team_id)continue;
  const key=canon(row.constructor_name);
  if(!multiLinks.has(key))multiLinks.set(key,new Set());
  multiLinks.get(key).add(row.team_id);
}
const ambiguous=[...multiLinks.entries()]
  .filter(([,ids])=>ids.size>1)
  .map(([constructor,ids])=>({constructor,team_ids:[...ids].sort()}));

console.log("\nFocus diagnostics");
console.log(JSON.stringify({
  year:focusYear,
  unresolved_links:unresolved.length,
  resolved_links_without_round1:noRound1.length,
  low_confidence_round1_links:lowRound1.length,
  constructors_linked_to_multiple_team_ids:ambiguous,
},null,2));
