import fs from "node:fs/promises";
import path from "node:path";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";
import { canonicalTeamId, canonicalTeamName } from "../src/domain/teamIdentity.js";
import { createTeamConstructorBridgeResolver } from "../src/domain/teamConstructorBridge.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const referenceDir=path.join(root,"data","reference");

function unbox(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(Object.prototype.hasOwnProperty.call(value,"result"))return unbox(value.result);
    if(Object.prototype.hasOwnProperty.call(value,"value"))return unbox(value.value);
    if(Object.prototype.hasOwnProperty.call(value,"text"))return unbox(value.text);
  }
  return value;
}

function pick(row,keys,fallback=undefined){
  for(const key of keys){
    const value=unbox(row?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
}

function integer(value){
  const n=Number(unbox(value));
  return Number.isInteger(n)?n:null;
}

function text(value){
  const raw=unbox(value);
  return raw===undefined||raw===null?"":String(raw).trim();
}

function canon(value){
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}

function rowYear(row){
  return integer(pick(row,["year","season_year","season","yr"],null));
}

function rowRound(row){
  return integer(pick(row,["round","raceRound","roundNumber"],null));
}

function teamIdOf(row){
  return canonicalTeamId(pick(row,["team_id","entrant_id","managerial_team_id","constructor_id","id"],""));
}

function driverIdOf(row){
  return text(pick(row,["driver_id","person_id","id"],""));
}

function activeAtYear(row,year){
  const exact=rowYear(row);
  const from=integer(pick(row,["contract_start","contract_start_year","start_year","year_from"],null));
  const to=integer(pick(row,["contract_until","contract_until_year","end_year","year_to"],null));
  if(from!==null)return year>=from&&(to===null||year<=to);
  return exact===year;
}

function exactTeamRows(rows,teamId,year){
  return (rows||[]).filter((row)=>teamIdOf(row)===teamId&&rowYear(row)===year);
}

function activeTeamRows(rows,teamId,year){
  return (rows||[]).filter((row)=>teamIdOf(row)===teamId&&activeAtYear(row,year));
}

function firstNonEmpty(values){
  for(const value of values){
    const v=text(value);
    if(v)return v;
  }
  return "";
}

function setText(set){
  return [...set].filter(Boolean).sort().join(", ");
}

async function readJson(dir,name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dir,name),"utf8"));}
  catch{return fallback;}
}

const yearArg=process.argv.find((arg)=>arg.startsWith("--year="));
const requestedYear=yearArg?Number(yearArg.slice("--year=".length)):2007;
if(!Number.isInteger(requestedYear)||requestedYear<1950){
  throw new Error(`Invalid --year value: ${yearArg||requestedYear}`);
}
const jsonOnly=process.argv.includes("--json");

const [
  results,teams,drivers,entryRows,constructorReference,
  teamBrands,facilities,staffContracts,teamEngineHistory,teamEngines,
  contracts,carStats,
]=await Promise.all([
  readJson(dataDir,"race_results.json"),
  readJson(dataDir,"teams.json"),
  readJson(dataDir,"drivers.json"),
  readJson(dataDir,"f1_entry_list_history.json"),
  readJson(referenceDir,"constructor_id_map.json",{constructors:[]}),
  readJson(dataDir,"team_brands.json"),
  readJson(dataDir,"facilities.json"),
  readJson(dataDir,"staff_contracts.json"),
  readJson(dataDir,"team_engine_history.json"),
  readJson(dataDir,"team_engines.json"),
  readJson(dataDir,"contracts.json"),
  readJson(dataDir,"car_stats_by_year.json"),
]);

const bridgeResolver=createTeamConstructorBridgeResolver({
  teams,
  constructorReference,
  entryRows,
});

const driverIds=new Set();
const driverNameToId=new Map();
const driverArchiveIdToId=new Map();
const driverNameById=new Map();
for(const driver of drivers||[]){
  const id=driverIdOf(driver);
  if(!id)continue;
  driverIds.add(id);
  const name=firstNonEmpty([
    pick(driver,["display_name","driver_name","full_name","name"],""),
    id,
  ]);
  driverNameById.set(id,name);
  const archiveId=integer(pick(driver,["driverID_arch","driverId_arch","driverId"],null));
  if(archiveId!==null)driverArchiveIdToId.set(archiveId,id);
  for(const candidate of [driver.display_name,driver.driver_name,driver.full_name,driver.name]){
    const key=canon(candidate);
    if(key&&!driverNameToId.has(key))driverNameToId.set(key,id);
  }
}

function resolveDriver(row){
  const direct=driverIdOf(row);
  if(direct&&driverIds.has(direct))return direct;
  const archiveId=integer(pick(row,["driverId","driverID"],null));
  if(archiveId!==null&&driverArchiveIdToId.has(archiveId))return driverArchiveIdToId.get(archiveId);
  const name=pick(row,["driver_name","display_name","driverName","name"],"");
  return driverNameToId.get(canon(name))||direct||text(name);
}

function displayDriver(id,row=null){
  return driverNameById.get(id)||
    firstNonEmpty([pick(row||{},["driver_name","display_name","driverName","name"],""),id])||
    "Unknown";
}

const currentResults=(results||[]).filter((row)=>rowYear(row)===requestedYear);
const previousResults=(results||[]).filter((row)=>rowYear(row)===requestedYear-1);
const rounds=currentResults.map(rowRound).filter((value)=>value!==null&&value>0);
const openingRound=rounds.length?Math.min(...rounds):1;

function aggregateResultRows(rows,{opening=false}={}){
  const byTeam=new Map();
  for(const row of rows){
    const did=resolveDriver(row);
    const link=bridgeResolver.resolve(row,{driverId:did,year:rowYear(row)});
    const tid=canonicalTeamId(link.team_id);
    if(!tid)continue;

    if(!byTeam.has(tid)){
      byTeam.set(tid,{
        teamId:tid,
        teamName:canonicalTeamName(link.team_name||tid),
        rows:0,
        exactEntrantRows:0,
        estimatedRows:0,
        drivers:new Map(),
        openingDrivers:new Map(),
        resolvedDrivers:new Map(),
        openingResolvedDrivers:new Map(),
        constructors:new Set(),
        chassis:new Set(),
        engines:new Set(),
        relationBasis:new Set(),
      });
    }

    const rec=byTeam.get(tid);
    rec.rows+=1;
    if(link.exact_entrant)rec.exactEntrantRows+=1;
    else rec.estimatedRows+=1;
    if(link.relation_basis)rec.relationBasis.add(String(link.relation_basis));
    if(link.constructor_name)rec.constructors.add(String(link.constructor_name));
    if(link.chassis_name)rec.chassis.add(String(link.chassis_name));
    if(link.engine_name)rec.engines.add(String(link.engine_name));

    // Keep all resolved Results relationships visible to the audit, but keep
    // exact entrant evidence separate. This lets T3.1 distinguish a usable
    // Round 1 candidate from a relationship that still needs stronger proof.
    if(did){
      rec.resolvedDrivers.set(did,displayDriver(did,row));
      if(opening&&rowRound(row)===openingRound){
        rec.openingResolvedDrivers.set(did,displayDriver(did,row));
      }
    }
    if(did&&link.exact_entrant){
      rec.drivers.set(did,displayDriver(did,row));
      if(opening&&rowRound(row)===openingRound){
        rec.openingDrivers.set(did,displayDriver(did,row));
      }
    }
  }
  return byTeam;
}

const currentByTeam=aggregateResultRows(currentResults,{opening:true});
const previousByTeam=aggregateResultRows(previousResults);

const teamMasterById=new Map();
for(const team of teams||[]){
  const id=teamIdOf(team);
  if(id&&!teamMasterById.has(id))teamMasterById.set(id,team);
}

const activeRaceContracts=(contracts||[]).filter((row)=>
  activeAtYear(row,requestedYear)&&isRaceDriverContract(row)
);
const raceContractsByTeam=new Map();
for(const row of activeRaceContracts){
  const tid=teamIdOf(row);
  const did=driverIdOf(row);
  if(!tid||!did)continue;
  if(!raceContractsByTeam.has(tid))raceContractsByTeam.set(tid,new Map());
  raceContractsByTeam.get(tid).set(did,displayDriver(did,row));
}

function facilityCoverage(rows){
  if(!rows.length)return {rows:0,levels:0};
  const fields=[
    "wind_tunnel_level","simulator_level","aero_dept_level",
    "_chassis_shop_level","chassis_shop_level",
    "manufacturing_level","manufacturing_leve",
    "pitcrew_training_level","youth_program_level",
  ];
  const levels=fields.filter((field)=>rows.some((row)=>Number.isFinite(Number(unbox(row?.[field]))))).length;
  return {rows:rows.length,levels};
}

function budgetCoverage(rows){
  const value=rows
    .map((row)=>Number(pick(row,["starting_budget","start_budget","budget_start"],NaN)))
    .find((n)=>Number.isFinite(n)&&n>0);
  return Number.isFinite(value)?value:null;
}

function engineCoverage(teamId){
  const historical=exactTeamRows(teamEngineHistory,teamId,requestedYear);
  const current=exactTeamRows(teamEngines,teamId,requestedYear);
  return firstNonEmpty([
    ...historical.map((row)=>pick(row,["engine_canonical","engine_name","engine_raw"],"")),
    ...current.map((row)=>pick(row,["engine_name","name","engine"],"")),
  ]);
}

function staffCoverage(teamId){
  const rows=activeTeamRows(staffContracts,teamId,requestedYear);
  const unique=new Set();
  for(const row of rows){
    const id=firstNonEmpty([
      pick(row,["staff_id","person_id","id"],""),
      pick(row,["staff_name","display_name","name"],""),
    ]);
    const role=text(pick(row,["role","position"],"staff"));
    if(id)unique.add(`${id}|${role}`);
  }
  return unique.size;
}

function carCoverage(teamId){
  return exactTeamRows(carStats,teamId,requestedYear).length;
}

const rows=[];
const issueCounts=new Map();
const roundOneDriverTeams=new Map();

for(const [teamId,resultRec] of [...currentByTeam.entries()].sort((a,b)=>
  String(a[1].teamName).localeCompare(String(b[1].teamName))
)){
  const master=teamMasterById.get(teamId)||{};
  const contractsMap=raceContractsByTeam.get(teamId)||new Map();
  const r1ExactMap=resultRec.openingDrivers;
  const r1ResolvedMap=resultRec.openingResolvedDrivers;
  const seasonExactMap=resultRec.drivers;
  const seasonResolvedMap=resultRec.resolvedDrivers;
  const openingEvidence=new Map([...contractsMap,...r1ResolvedMap]);
  const openingExactEvidence=new Map([...contractsMap,...r1ExactMap]);

  for(const [did] of r1ResolvedMap){
    if(!roundOneDriverTeams.has(did))roundOneDriverTeams.set(did,new Set());
    roundOneDriverTeams.get(did).add(teamId);
  }

  const brandRows=exactTeamRows(teamBrands,teamId,requestedYear);
  const facilityRows=exactTeamRows(facilities,teamId,requestedYear);
  const facility=facilityCoverage(facilityRows);
  const budget=budgetCoverage(brandRows);
  const staff=staffCoverage(teamId);
  const curatedEngine=engineCoverage(teamId);
  const resultEngine=setText(resultRec.engines);
  const carRows=carCoverage(teamId);
  const previous=previousByTeam.get(teamId);
  const country=firstNonEmpty([master.country_code,master.country,master.nationality]);
  const base=firstNonEmpty([master.team_base,master.hq,master.base]);
  const issues=[];

  if(resultRec.exactEntrantRows===0)issues.push("entrant_estimated_only");
  if(r1ResolvedMap.size===0)issues.push("no_round1_driver_evidence");
  if(r1ResolvedMap.size>r1ExactMap.size)issues.push("round1_driver_relation_needs_proof");
  if(openingEvidence.size<2)issues.push("opening_driver_evidence_lt2");
  if(!country&&!base)issues.push("hq_country_uncovered");
  if(budget===null)issues.push("budget_not_curated");
  if(facility.levels===0)issues.push("facilities_not_curated");
  if(staff===0)issues.push("staff_uncovered");
  if(!curatedEngine&&!resultEngine)issues.push("engine_uncovered");
  if(carRows===0)issues.push("car_stats_uncovered");

  for(const issue of issues)issueCounts.set(issue,(issueCounts.get(issue)||0)+1);

  rows.push({
    year:requestedYear,
    team_id:teamId,
    team_name:resultRec.teamName||canonicalTeamName(master.team_name||teamId),
    result_rows:resultRec.rows,
    exact_entrant_rows:resultRec.exactEntrantRows,
    estimated_result_rows:resultRec.estimatedRows,
    opening_round:openingRound,
    round1_drivers:[...r1ResolvedMap.values()],
    round1_exact_drivers:[...r1ExactMap.values()],
    contracted_drivers:[...contractsMap.values()],
    opening_driver_evidence:[...openingEvidence.values()],
    opening_exact_evidence:[...openingExactEvidence.values()],
    season_result_drivers:[...seasonResolvedMap.values()],
    season_exact_drivers:[...seasonExactMap.values()],
    constructors:[...resultRec.constructors].sort(),
    chassis:[...resultRec.chassis].sort(),
    result_engines:[...resultRec.engines].sort(),
    curated_engine:curatedEngine||null,
    country:country||null,
    hq_or_base:base||null,
    starting_budget:budget,
    facility_rows:facility.rows,
    facility_levels:facility.levels,
    active_staff:staff,
    car_stat_rows:carRows,
    previous_year_result_rows:previous?.rows||0,
    previous_year_same_team_id:Boolean(previous?.rows),
    relation_basis:[...resultRec.relationBasis].sort(),
    issues,
  });
}

const duplicateRoundOneDrivers=[...roundOneDriverTeams.entries()]
  .filter(([,teamIds])=>teamIds.size>1)
  .map(([driverId,teamIds])=>({
    driver_id:driverId,
    driver_name:displayDriver(driverId),
    team_ids:[...teamIds].sort(),
  }));

const summary={
  year:requestedYear,
  previous_year:requestedYear-1,
  source:"race_results.json",
  opening_round:openingRound,
  result_rows:currentResults.length,
  teams:rows.length,
  teams_with_exact_entrant_evidence:rows.filter((row)=>row.exact_entrant_rows>0).length,
  teams_with_round1_driver_evidence:rows.filter((row)=>row.round1_drivers.length>0).length,
  teams_with_exact_round1_driver_evidence:rows.filter((row)=>row.round1_exact_drivers.length>0).length,
  teams_with_two_opening_driver_evidence:rows.filter((row)=>row.opening_driver_evidence.length>=2).length,
  teams_with_two_exact_opening_driver_evidence:rows.filter((row)=>row.opening_exact_evidence.length>=2).length,
  teams_with_budget:rows.filter((row)=>row.starting_budget!==null).length,
  teams_with_facilities:rows.filter((row)=>row.facility_levels>0).length,
  teams_with_staff:rows.filter((row)=>row.active_staff>0).length,
  teams_with_engine_evidence:rows.filter((row)=>row.curated_engine||row.result_engines.length).length,
  teams_with_car_stats:rows.filter((row)=>row.car_stat_rows>0).length,
  teams_with_hq_or_country:rows.filter((row)=>row.country||row.hq_or_base).length,
  teams_with_previous_year_same_id_results:rows.filter((row)=>row.previous_year_same_team_id).length,
  duplicate_round1_drivers:duplicateRoundOneDrivers.length,
  issue_counts:Object.fromEntries([...issueCounts.entries()].sort((a,b)=>a[0].localeCompare(b[0]))),
};

const output={summary,teams:rows,duplicate_round1_drivers:duplicateRoundOneDrivers};

if(jsonOnly){
  console.log(JSON.stringify(output,null,2));
}else{
  console.log(`\nTeams 3.0 — Results-First Audit (${requestedYear})`);
  console.log(`Historical authority: race_results.json · opening evidence round: ${openingRound}`);
  console.table(rows.map((row)=>({
    TEAM:row.team_name,
    RESULTS:row.result_rows,
    EXACT:row.exact_entrant_rows,
    R1_DRV:row.round1_drivers.length,
    R1_EXACT:row.round1_exact_drivers.length,
    CONTRACT_DRV:row.contracted_drivers.length,
    OPENING_DRV:row.opening_driver_evidence.length,
    SEASON_DRV:row.season_result_drivers.length,
    HQ:row.country||row.hq_or_base?"OK":"—",
    BUDGET:row.starting_budget!==null?"OK":"—",
    FAC:row.facility_levels||"—",
    STAFF:row.active_staff||"—",
    ENGINE:(row.curated_engine||row.result_engines.length)?"OK":"—",
    CAR:row.car_stat_rows||"—",
    PREV:row.previous_year_result_rows||"—",
    ISSUES:row.issues.join(", ")||"—",
  })));

  console.log("\nCoverage");
  console.log(`  Teams from Results: ${summary.teams}`);
  console.log(`  Exact entrant evidence: ${summary.teams_with_exact_entrant_evidence}/${summary.teams}`);
  console.log(`  Round ${openingRound} driver evidence: ${summary.teams_with_round1_driver_evidence}/${summary.teams}`);
  console.log(`  Exact Round ${openingRound} entrant+driver evidence: ${summary.teams_with_exact_round1_driver_evidence}/${summary.teams}`);
  console.log(`  >=2 opening driver candidates (contracts + Round ${openingRound}): ${summary.teams_with_two_opening_driver_evidence}/${summary.teams}`);
  console.log(`  >=2 exact opening driver evidence: ${summary.teams_with_two_exact_opening_driver_evidence}/${summary.teams}`);
  console.log(`  HQ/country known: ${summary.teams_with_hq_or_country}/${summary.teams}`);
  console.log(`  Curated starting budget: ${summary.teams_with_budget}/${summary.teams}`);
  console.log(`  Facilities coverage: ${summary.teams_with_facilities}/${summary.teams}`);
  console.log(`  Staff coverage: ${summary.teams_with_staff}/${summary.teams}`);
  console.log(`  Engine evidence (Results or curated): ${summary.teams_with_engine_evidence}/${summary.teams}`);
  console.log(`  Car-stat coverage: ${summary.teams_with_car_stats}/${summary.teams}`);
  console.log(`  Same canonical team ID present in ${requestedYear-1} Results: ${summary.teams_with_previous_year_same_id_results}/${summary.teams}`);

  if(duplicateRoundOneDrivers.length){
    console.log("\nRound 1 driver conflicts");
    console.table(duplicateRoundOneDrivers);
  }

  console.log("\nImportant: gaps are diagnostic only. T3.0 does not synthesize or write opening-state data.");
}
