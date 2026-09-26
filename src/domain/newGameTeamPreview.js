// src/domain/newGameTeamPreview.js
// Read-only historical preview used by New Game team selection.
// It deliberately ignores mutable Save World state so an existing career
// cannot leak reputation, garage upgrades or board state into a new career.

import { driverIdOf, driverLineupSlots } from "./driverContracts.js";
import { driverOverallPresentation } from "./driverMarketEvaluation.js";
import { teamCarPerformance } from "./carPerformance.js";
import { teamReputation, teamReputationLabel } from "./teamReputation.js";
import { teamStaffStructure } from "./staffRoles.js";

const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
  }
  return value;
};

const pick=(obj,keys,fallback=undefined)=>{
  for(const key of keys){
    const value=unwrap(obj?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
};

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const teamIdOf=(row)=>String(pick(row,["team_id","constructor_id","id","team","constructor"],""));
const yearOf=(row)=>Number(pick(row,["year","season_year"],NaN));

function collection(primary,fallback){
  return Array.isArray(primary)&&primary.length?primary:(Array.isArray(fallback)?fallback:[]);
}

function rowForTeam(rows,teamId,year){
  const source=Array.isArray(rows)?rows:[];
  const exact=source.find((row)=>
    teamIdOf(row)===String(teamId)&&
    (!Number.isFinite(yearOf(row))||yearOf(row)===Number(year))
  );
  if(exact)return exact;
  return source.find((row)=>teamIdOf(row)===String(teamId))||null;
}

function brandForTeam(gs,teamId,year){
  return rowForTeam(collection(gs?.teamBrands,gs?.dbTeamBrands),teamId,year)||{};
}

function financeSnapshot(gs,team,teamId,year){
  const brand=brandForTeam(gs,teamId,year);
  const raw=pick(brand,["starting_budget","start_budget","budget_start"],
    pick(team,["starting_budget","start_budget","budget_start","budget"],null)
  );
  const budget=Number(raw);
  return {
    startingBudget:Number.isFinite(budget)&&budget>0?budget:null,
    source:Number.isFinite(budget)&&budget>0?"historical_team_brand":null,
  };
}

const FACILITY_FIELDS=Object.freeze([
  {label:"Wind Tunnel",keys:["wind_tunnel_level"]},
  {label:"Aero Department",keys:["aero_dept_level"]},
  {label:"Chassis Workshop",keys:["_chassis_shop_level","chassis_shop_level"]},
  {label:"Manufacturing",keys:["manufacturing_leve","manufacturing_level"]},
  {label:"Pit Crew Training",keys:["pitcrew_training_level"]},
  {label:"Simulator",keys:["simulator_level"]},
  {label:"Youth Programme",keys:["youth_program_level"]},
]);

function facilitySnapshot(gs,teamId,year){
  const facility=rowForTeam(collection(gs?.facilities,gs?.dbFacilities),teamId,year);
  const brand=brandForTeam(gs,teamId,year);
  const source=facility||brand||{};
  const items=FACILITY_FIELDS
    .map(({label,keys})=>({label,level:Number(pick(source,keys,NaN))}))
    .filter((row)=>Number.isFinite(row.level));
  const levels=items.map((row)=>row.level);
  return {
    available:levels.length,
    average:levels.length
      ?Math.round((levels.reduce((sum,value)=>sum+value,0)/levels.length)*10)/10
      :null,
    items,
  };
}

function historicalWorld(gs,team){
  return {
    ...gs,
    team,
    board:null,
    teamReputationState:{},
    teamReputationLog:{},
    teamOperationalState:{},
    garage:{cars:[],serviceJobs:[],baseComponentStock:{},reserveCarBuilt:false},
    development:{projects:[],parts:[],partUnits:[],manufacturing:[],research:[],technologyProjects:[],aeroTestingUsage:[]},
    aiTechnicalWorld:{version:1,teams:{}},
    hq:{facilityLevels:{},upgrades:[]},
    componentWearLog:[],
  };
}

function driverFor(gs,id){
  return collection(gs?.drivers,gs?.dbDrivers).find((driver)=>
    String(pick(driver,["driver_id","person_id","id"],""))===String(id)
  )||null;
}

function driverPreview(gs,contract,slot){
  if(!contract)return null;
  const id=driverIdOf(contract);
  const driver=driverFor(gs,id);
  const overall=driverOverallPresentation(gs,driver||id);
  return {
    slot,
    id,
    contract,
    driver,
    name:String(
      pick(driver,["display_name","driver_name","name","full_name"],
        pick(contract,["driver_name","name","full_name"],id||"Driver")
      )
    ),
    overall:Number.isFinite(Number(overall?.value))?Number(overall.value):null,
    estimated:Boolean(overall?.estimated),
  };
}

const STAFF_META_KEYS=new Set([
  "staff_id","person_id","id","staff_name","display_name","name",
  "year","season_year","role","position","team_id","team_name",
]);

function staffRatingForYear(gs,id,year){
  const rows=collection(gs?.staffRatings,gs?.dbStaffRatings)
    .filter((row)=>String(pick(row,["staff_id","person_id","id"],""))===String(id));
  const exact=rows.find((row)=>Number(pick(row,["year","season_year"],NaN))===Number(year));
  if(exact)return exact;
  return rows
    .filter((row)=>Number(pick(row,["year","season_year"],-Infinity))<=Number(year))
    .sort((a,b)=>Number(pick(b,["year","season_year"],0))-Number(pick(a,["year","season_year"],0)))[0]
    ||rows[0]||null;
}

function staffOverall(rating){
  if(!rating)return null;
  const values=Object.entries(rating)
    .filter(([key,value])=>!STAFF_META_KEYS.has(key)&&Number.isFinite(Number(unwrap(value))))
    .map(([,value])=>Number(unwrap(value)));
  return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
}

function staffSnapshot(gs,teamId,year){
  const structure=teamStaffStructure(gs,teamId);
  const rows=structure.map((contract)=>{
    const id=String(contract?.staff_id||"");
    const overall=staffOverall(staffRatingForYear(gs,id,year));
    return {
      id,
      role:contract?.role_label||contract?.canonical_role||pick(contract,["role","position"],"Staff"),
      overall:Number.isFinite(overall)?Math.round(overall*10)/10:null,
    };
  });
  const known=rows.map((row)=>row.overall).filter(Number.isFinite);
  return {
    count:rows.length,
    rated:known.length,
    overall:known.length?Math.round((known.reduce((sum,value)=>sum+value,0)/known.length)*10)/10:null,
    rows,
  };
}

function rawTeamSnapshot(gs,team){
  const year=Number(gs?.activeYear)||Number(gs?.seasonPackMeta?.year)||1980;
  const teamId=teamIdOf(team);
  const world=historicalWorld(gs,team);
  const brand=brandForTeam(gs,teamId,year);
  const lineup=driverLineupSlots(gs,teamId);

  let reputation=null;
  let car=null;
  try{reputation=teamReputation(world,teamId);}catch{reputation=null;}
  try{car=teamCarPerformance(world,teamId);}catch{car=null;}

  const finance=financeSnapshot(gs,team,teamId,year);
  const facilities=facilitySnapshot(gs,teamId,year);
  const staff=staffSnapshot(gs,teamId,year);
  const engine=rowForTeam(collection(gs?.teamEngines,gs?.dbTeamEngines),teamId,year)||{};
  const drivers=[
    driverPreview(gs,lineup?.main,"main"),
    driverPreview(gs,lineup?.second,"second"),
  ].filter(Boolean);
  const knownDriverOveralls=drivers.map((row)=>row.overall).filter(Number.isFinite);

  return {
    team,
    teamId,
    year,
    reputation:Number.isFinite(Number(reputation))?Number(reputation):null,
    reputationLabel:Number.isFinite(Number(reputation))?teamReputationLabel(reputation):"Unknown",
    startingBudget:finance.startingBudget,
    budgetSource:finance.source,
    boardExpectation:String(pick(brand,["board_expectation","season_expectation","expectation"],"")||"")||null,
    car:car?{
      overall:Number(car.overall),
      qualifying:Number(car.qualifying),
      race:Number(car.race),
      reliability:Number(car.reliability),
    }:null,
    facilities,
    staff,
    engineName:String(pick(engine,["engine_name","name","engine"],""))||null,
    drivers,
    driversOverall:knownDriverOveralls.length
      ?Math.round((knownDriverOveralls.reduce((sum,value)=>sum+value,0)/knownDriverOveralls.length)*10)/10
      :null,
  };
}

export const CHAMPIONSHIP_PROJECTION_WEIGHTS=Object.freeze({
  car:0.35,
  drivers:0.25,
  staff:0.15,
  facilities:0.10,
  budget:0.10,
  reputation:0.05,
});

function relativeBudgetScore(value,allBudgets){
  const raw=Number(value);
  if(!Number.isFinite(raw)||raw<=0)return null;
  const logs=(allBudgets||[])
    .map(Number)
    .filter((item)=>Number.isFinite(item)&&item>0)
    .map((item)=>Math.log(item));
  if(!logs.length)return null;
  const current=Math.log(raw);
  const min=Math.min(...logs);
  const max=Math.max(...logs);
  if(Math.abs(max-min)<1e-9)return 50;
  return clamp(((current-min)/(max-min))*100);
}

function factorBundle(snapshot,budgets){
  return {
    car:Number.isFinite(snapshot?.car?.overall)?clamp(snapshot.car.overall):null,
    drivers:Number.isFinite(snapshot?.driversOverall)?clamp(snapshot.driversOverall):null,
    staff:Number.isFinite(snapshot?.staff?.overall)?clamp(snapshot.staff.overall):null,
    facilities:Number.isFinite(snapshot?.facilities?.average)?clamp(snapshot.facilities.average*10):null,
    budget:relativeBudgetScore(snapshot?.startingBudget,budgets),
    reputation:Number.isFinite(snapshot?.reputation)?clamp(snapshot.reputation):null,
  };
}

function strengthScore(factors){
  let weighted=0;
  let weightUsed=0;
  for(const [key,weight] of Object.entries(CHAMPIONSHIP_PROJECTION_WEIGHTS)){
    const value=Number(factors?.[key]);
    if(!Number.isFinite(value))continue;
    weighted+=value*weight;
    weightUsed+=weight;
  }
  return {
    score:weightUsed>0?weighted/weightUsed:null,
    completeness:weightUsed,
  };
}

function ordinal(position){
  const n=Math.max(1,Math.round(Number(position)||1));
  const mod100=n%100;
  const suffix=(mod100>=11&&mod100<=13)?"th":n%10===1?"st":n%10===2?"nd":n%10===3?"rd":"th";
  return String(n)+suffix;
}

function projectionFromScored(scored,targetTeamId){
  const target=scored.find((row)=>row.teamId===String(targetTeamId));
  if(!target)return null;

  const nominal=scored.findIndex((row)=>row.teamId===target.teamId)+1;
  const tolerance=4.0+(1-clamp(target.completeness,0,1))*5.0;
  let minPosition=1+scored.filter((row)=>row.score>target.score+tolerance).length;
  let maxPosition=scored.filter((row)=>row.score>=target.score-tolerance).length;

  minPosition=Math.min(minPosition,nominal);
  maxPosition=Math.max(maxPosition,nominal);
  if(minPosition===maxPosition&&scored.length>1){
    if(nominal===1)maxPosition=Math.min(scored.length,2);
    else if(nominal===scored.length)minPosition=Math.max(1,nominal-1);
    else{
      minPosition=Math.max(1,nominal-1);
      maxPosition=Math.min(scored.length,nominal+1);
    }
  }

  return {
    nominalPosition:nominal,
    minPosition,
    maxPosition,
    label:minPosition===maxPosition?ordinal(minPosition):ordinal(minPosition)+"–"+ordinal(maxPosition),
    score:Math.round(target.score*10)/10,
    completeness:Math.round(target.completeness*100),
    factors:Object.fromEntries(Object.entries(target.factors).map(([key,value])=>[
      key,
      Number.isFinite(Number(value))?Math.round(Number(value)*10)/10:null,
    ])),
    weights:CHAMPIONSHIP_PROJECTION_WEIGHTS,
    fieldSize:scored.length,
    method:"competitive_strength_v1",
  };
}

export function newGameTeamPreviews(gs){
  const teams=collection(gs?.teams,gs?.dbTeams);
  if(!teams.length)return new Map();

  // Critical performance rule: each team snapshot is derived exactly once.
  // The championship table is then scored/sorted once and shared by all previews.
  const field=teams.map((team)=>rawTeamSnapshot(gs,team));
  const budgets=field
    .map((row)=>row.startingBudget)
    .filter((value)=>Number.isFinite(Number(value))&&Number(value)>0);

  const scored=field.map((row)=>{
    const factors=factorBundle(row,budgets);
    const strength=strengthScore(factors);
    return {...row,factors,...strength};
  }).filter((row)=>Number.isFinite(row.score));

  scored.sort((a,b)=>b.score-a.score||String(a.teamId).localeCompare(String(b.teamId)));

  const previews=new Map();
  for(const snapshot of field){
    const projection=projectionFromScored(scored,snapshot.teamId);
    previews.set(snapshot.teamId,{
      ...snapshot,
      championshipProjection:projection,
      championshipExpectation:projection,
      championshipExpectationLabel:projection?.label||"—",
    });
  }
  return previews;
}

export function newGameTeamPreview(gs,team){
  const teamId=teamIdOf(team);
  return newGameTeamPreviews(gs).get(teamId)||{
    ...rawTeamSnapshot(gs,team),
    championshipProjection:null,
    championshipExpectation:null,
    championshipExpectationLabel:"—",
  };
}

