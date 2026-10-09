import fs from "node:fs/promises";
import path from "node:path";
import { readJsonOptional, readJsonRequired } from "./lib/json-source.mjs";
import { canonicalTeamId, canonicalTeamName } from "../src/domain/teamIdentity.js";
import { createTeamConstructorBridgeResolver } from "../src/domain/teamConstructorBridge.js";
import { historicalFirst as first, historicalNameKey as canon, historicalResultYear, createHistoricalDriverResolver } from "./lib/historical-results-normalizer.mjs";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const source=path.join(dataDir,"race_results.json");
const target=path.join(dataDir,"team_seasons.json");

const [rows,teams,drivers,constructorReference,entryRows]=await Promise.all([
  readJsonRequired(source,{label:"race_results.json"}),
  readJsonRequired(path.join(dataDir,"teams.json"),{label:"teams.json"}),
  readJsonRequired(path.join(dataDir,"drivers.json"),{label:"drivers.json"}),
  readJsonRequired(path.join(root,"data","reference","constructor_id_map.json"),{label:"data/reference/constructor_id_map.json"}),
  readJsonOptional(path.join(dataDir,"f1_entry_list_history.json"),[]),
]);

const resolveDriver=createHistoricalDriverResolver(drivers);

const bridgeResolver=createTeamConstructorBridgeResolver({
  teams,
  constructorReference,
  entryRows,
});

const byKey=new Map();
let sourceIndex=0;
for(const row of Array.isArray(rows)?rows:[]){
  const year=historicalResultYear(row);
  const driverId=resolveDriver(row,{allowUnknownDirect:true});
  if(!Number.isFinite(year)){sourceIndex+=1;continue;}

  const link=bridgeResolver.resolve(row,{driverId});
  // team_seasons is the managerial participation authority. Never promote an
  // unresolved technical constructor/chassis into a Team just to keep a row.
  // The technical identity remains preserved in team_constructor_bridge.json.
  const teamId=canonicalTeamId(link.team_id);
  const teamName=canonicalTeamName(link.team_name||teamId);
  if(!teamId){sourceIndex+=1;continue;}

  const key=`${year}|${teamId}`;
  if(!byKey.has(key)){
    byKey.set(key,{
      year,
      team_id:teamId,
      team_name:teamName,
      driver_ids:new Set(),
      drivers:new Map(),
      resolved_drivers:new Map(),
      constructor_ids:new Set(),
      constructor_names:new Set(),
      chassis_names:new Set(),
      engine_names:new Set(),
      exact_constructor_ids:new Set(),
      exact_constructor_names:new Set(),
      exact_chassis_names:new Set(),
      exact_engine_names:new Set(),
      relation_basis:new Set(),
      confidence:new Set(),
      rounds:new Set(),
      exact_entrant_rows:0,
      estimated_rows:0,
      unresolved_rows:0,
    });
  }

  const rec=byKey.get(key);
  const roundRaw=Number(first(row,["round","raceRound","roundNumber"],NaN));
  const raceDate=String(first(row,["race_date","date","dateISO"],""));
  if(Number.isFinite(roundRaw))rec.rounds.add(roundRaw);

  // Keep a separate Results-derived relationship cache for New Game fallback.
  // This is deliberately NOT the confirmed historical roster: estimated
  // Team/Entrant resolution may be used only as explicit Round 1 opening
  // evidence, never as silent proof of a season-long historical contract.
  if(driverId){
    const prev=rec.resolved_drivers.get(driverId)||{
      driver_id:driverId,
      appearances:0,
      first_round:null,
      first_date:null,
      first_source_index:sourceIndex,
      first_exact_entrant:false,
      first_relation_basis:new Set(),
      first_confidence:new Set(),
    };
    prev.appearances+=1;
    if(Number.isFinite(roundRaw)&&(prev.first_round==null||roundRaw<prev.first_round)){
      prev.first_round=roundRaw;
      prev.first_date=raceDate||null;
      prev.first_source_index=sourceIndex;
      prev.first_exact_entrant=Boolean(link.exact_entrant);
      prev.first_relation_basis=new Set(link.relation_basis?[String(link.relation_basis)]:[]);
      prev.first_confidence=new Set(link.confidence?[String(link.confidence)]:[]);
    }else if(Number.isFinite(roundRaw)&&roundRaw===prev.first_round){
      if(raceDate&&(!prev.first_date||raceDate<prev.first_date))prev.first_date=raceDate;
      prev.first_source_index=Math.min(prev.first_source_index,sourceIndex);
      prev.first_exact_entrant=Boolean(prev.first_exact_entrant||link.exact_entrant);
      if(link.relation_basis)prev.first_relation_basis.add(String(link.relation_basis));
      if(link.confidence)prev.first_confidence.add(String(link.confidence));
    }
    rec.resolved_drivers.set(driverId,prev);
  }

  // Only exact entrant evidence is allowed to populate a confirmed historical
  // roster. The fallback cache above remains separately labelled.
  if(driverId&&link.exact_entrant){
    rec.driver_ids.add(driverId);
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
  if(link.exact_entrant){
    if(link.constructor_id)rec.exact_constructor_ids.add(String(link.constructor_id));
    if(link.constructor_name)rec.exact_constructor_names.add(String(link.constructor_name));
    if(link.chassis_name)rec.exact_chassis_names.add(String(link.chassis_name));
    if(link.engine_name)rec.exact_engine_names.add(String(link.engine_name));
  }
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
    first_race_driver_candidates:[...row.resolved_drivers.values()]
      .filter((driver)=>Number(driver.first_round)===1)
      .map((driver)=>({
        driver_id:driver.driver_id,
        appearances:driver.appearances,
        first_round:driver.first_round,
        first_date:driver.first_date,
        first_source_index:driver.first_source_index,
        exact_entrant:Boolean(driver.first_exact_entrant),
        relation_basis:[...driver.first_relation_basis].sort(),
        confidence:[...driver.first_confidence].sort(),
        source:"race_results_round_1",
      }))
      .sort((a,b)=>
        a.first_source_index-b.first_source_index||
        b.appearances-a.appearances||
        a.driver_id.localeCompare(b.driver_id)
      ),
    first_team_appearance_round:row.rounds.size?Math.min(...row.rounds):null,
    first_team_appearance_driver_candidates:[...row.resolved_drivers.values()]
      .filter((driver)=>{
        const firstTeamRound=row.rounds.size?Math.min(...row.rounds):null;
        return firstTeamRound!=null&&Number(driver.first_round)===firstTeamRound;
      })
      .map((driver)=>({
        driver_id:driver.driver_id,
        appearances:driver.appearances,
        first_round:driver.first_round,
        first_date:driver.first_date,
        first_source_index:driver.first_source_index,
        exact_entrant:Boolean(driver.first_exact_entrant),
        relation_basis:[...driver.first_relation_basis].sort(),
        confidence:[...driver.first_confidence].sort(),
        source:"race_results_first_team_appearance",
      }))
      .sort((a,b)=>
        a.first_source_index-b.first_source_index||
        b.appearances-a.appearances||
        a.driver_id.localeCompare(b.driver_id)
      ),
    constructor_ids:[...row.constructor_ids].sort(),
    constructor_names:[...row.constructor_names].sort(),
    chassis_names:[...row.chassis_names].sort(),
    engine_names:[...row.engine_names].sort(),
    exact_constructor_ids:[...row.exact_constructor_ids].sort(),
    exact_constructor_names:[...row.exact_constructor_names].sort(),
    exact_chassis_names:[...row.exact_chassis_names].sort(),
    exact_engine_names:[...row.exact_engine_names].sort(),
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
