// src/domain/newGameTeamPreview.js
// Read-only historical preview used by New Game team selection.
// It deliberately ignores mutable Save World state so an existing career
// cannot leak reputation, garage upgrades or board state into a new career.

import { driverIdOf, driverLineupSlots } from "./driverContracts.js";
import { driverOverallPresentation } from "./driverMarketEvaluation.js";
import { teamCarPerformance } from "./carPerformance.js";
import { BOARD_EXPECTATION_LABEL, normalizeBoardExpectation } from "./boardState.js";
import { teamReputation, teamReputationLabel } from "./teamReputation.js";

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
      ? Math.round((levels.reduce((sum,value)=>sum+value,0)/levels.length)*10)/10
      : null,
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

export function newGameTeamPreview(gs,team){
  const year=Number(gs?.activeYear)||Number(gs?.seasonPackMeta?.year)||1980;
  const teamId=teamIdOf(team);
  const world=historicalWorld(gs,team);
  const brand=brandForTeam(gs,teamId,year);
  const lineup=driverLineupSlots(gs,teamId);
  const expectation=normalizeBoardExpectation(pick(brand,["board_expectation","season_expectation","expectation"],"midfield"));

  let reputation=null;
  let car=null;
  try{ reputation=teamReputation(world,teamId); }catch{ reputation=null; }
  try{ car=teamCarPerformance(world,teamId); }catch{ car=null; }

  const finance=financeSnapshot(gs,team,teamId,year);
  const facilities=facilitySnapshot(gs,teamId,year);
  const engine=rowForTeam(collection(gs?.teamEngines,gs?.dbTeamEngines),teamId,year)||{};
  const drivers=[
    driverPreview(gs,lineup?.main,"main"),
    driverPreview(gs,lineup?.second,"second"),
  ].filter(Boolean);
  const knownDriverOveralls=drivers.map((row)=>row.overall).filter(Number.isFinite);

  return {
    teamId,
    year,
    reputation:Number.isFinite(Number(reputation))?Number(reputation):null,
    reputationLabel:Number.isFinite(Number(reputation))?teamReputationLabel(reputation):"Unknown",
    startingBudget:finance.startingBudget,
    budgetSource:finance.source,
    championshipExpectation:expectation,
    championshipExpectationLabel:BOARD_EXPECTATION_LABEL[expectation]||"Competitive season",
    car:car?{
      overall:Number(car.overall),
      qualifying:Number(car.qualifying),
      race:Number(car.race),
      reliability:Number(car.reliability),
    }:null,
    facilities,
    engineName:String(pick(engine,["engine_name","name","engine"],""))||null,
    drivers,
    driversOverall:knownDriverOveralls.length
      ? Math.round((knownDriverOveralls.reduce((sum,value)=>sum+value,0)/knownDriverOveralls.length)*10)/10
      : null,
  };
}
