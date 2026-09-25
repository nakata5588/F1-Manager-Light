// src/domain/seasonTechnicalTransition.js
// Stage 7.7B — physical technical transition between seasons.
//
// Knowledge and archived design history persist. Current-car Blueprints, physical
// units, workshop/manufacturing jobs and fitted components do not remain usable
// on the following-season chassis.

import { availableCarComponentSlots } from "./carComponents.js";
import { defaultBaseComponentStock, defaultComponentCondition } from "./garage.js";
import { normalizePhysicalPartState } from "./partUnits.js";

const str=(v)=>String(v??"");
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};

function rolloverDate(targetYear){
  return `${Number(targetYear)}-01-01`;
}

function archiveDesigns(parts,targetYear){
  const date=rolloverDate(targetYear);
  const previous=Number(targetYear)-1;
  return (Array.isArray(parts)?parts:[]).map((part)=>{
    if(part?.status==="legacy"||part?.legal_for_season===false){
      return {...part,inv:0,in_manufacturing:0};
    }
    return {
      ...part,
      status:"legacy",
      legal_for_season:false,
      legacy_after_season:previous,
      archived_at:part?.archived_at||date,
      inv:0,
      in_manufacturing:0,
    };
  });
}

function retireUnits(units,targetYear){
  const date=rolloverDate(targetYear);
  return (Array.isArray(units)?units:[]).map((unit)=>{
    if(unit?.status==="retired")return unit;
    return {
      ...unit,
      status:"retired",
      retired_at:unit?.retired_at||date,
      retirement_reason:unit?.retirement_reason||"season_rollover",
    };
  });
}

function closeSeasonProjects(projects,targetYear){
  const date=rolloverDate(targetYear);
  return (Array.isArray(projects)?projects:[]).map((project)=>{
    if(!["active","paused"].includes(str(project?.status)))return project;
    return {
      ...project,
      status:"season_ended",
      ended_at:date,
      end_reason:"season_rollover",
      remaining_days:null,
    };
  });
}

function closeManufacturingJobs(jobs,targetYear){
  const date=rolloverDate(targetYear);
  return (Array.isArray(jobs)?jobs:[]).map((job)=>{
    if(!["active","paused"].includes(str(job?.status)))return job;
    return {
      ...job,
      status:"season_ended",
      ended_at:date,
      end_reason:"season_rollover",
    };
  });
}

function closeWorkshopJobs(jobs,targetYear){
  const date=rolloverDate(targetYear);
  return (Array.isArray(jobs)?jobs:[]).map((job)=>{
    if(str(job?.status)!=="active")return job;
    return {
      ...job,
      status:"season_ended",
      ended_at:date,
      end_reason:"season_rollover",
    };
  });
}

function resetGarage(globalState,scope,teamId,targetYear){
  const targetState={
    ...globalState,
    activeYear:Number(targetYear),
    currentDateISO:rolloverDate(targetYear),
    team:{...(globalState?.team||{}),team_id:str(teamId),id:str(teamId)},
    development:scope?.development||{},
    garage:scope?.garage||{},
  };
  const slots=availableCarComponentSlots(targetState,teamId);
  const conditions=defaultComponentCondition(slots);
  const stock=defaultBaseComponentStock(slots);
  const priorCars=Array.isArray(scope?.garage?.cars)?scope.garage.cars:[];

  return {
    ...(scope?.garage||{}),
    reserveCarBuilt:false,
    baseComponentStock:stock,
    serviceJobs:closeWorkshopJobs(scope?.garage?.serviceJobs,targetYear),
    cars:priorCars
      .filter((car)=>str(car?.kind)!=="reserve"&&str(car?.id)!=="car_spare")
      .map((car)=>({
        ...car,
        installedParts:{},
        componentCondition:{...conditions},
        season_year:Number(targetYear),
      })),
  };
}

export function transitionPhysicalTechnicalScope(globalState,scope,{
  teamId=null,
  targetYear=null,
}={}){
  if(!scope||typeof scope!=="object")return scope;
  const target=Number(targetYear);
  if(!Number.isFinite(target))return scope;

  const normalized=normalizePhysicalPartState({
    ...globalState,
    team:{...(globalState?.team||{}),team_id:str(teamId),id:str(teamId)},
    development:scope?.development||{},
    garage:scope?.garage||{},
  });
  const dev=normalized?.development||{};
  const garage=resetGarage(globalState,normalized,teamId,target);

  return {
    ...scope,
    development:{
      ...dev,
      projects:closeSeasonProjects(dev?.projects,target),
      parts:archiveDesigns(dev?.parts,target),
      partUnits:retireUnits(dev?.partUnits,target),
      manufacturing:closeManufacturingJobs(dev?.manufacturing,target),
    },
    garage,
    physical_season_transition:{
      version:1,
      season:target,
      applied_at:rolloverDate(target),
      blueprints_archived:(dev?.parts||[]).length,
      units_retired:(dev?.partUnits||[]).filter((unit)=>unit?.status!=="retired").length,
    },
  };
}

export function transitionPhysicalTechnicalWorld(state,targetYear){
  if(!state||typeof state!=="object")return state;
  const target=Number(targetYear);
  const playerId=str(state?.team?.team_id??state?.team?.id);
  const playerScope=transitionPhysicalTechnicalScope(
    state,
    {development:state?.development||{},garage:state?.garage||{}},
    {teamId:playerId,targetYear:target}
  );

  const teams={...(state?.aiTechnicalWorld?.teams||{})};
  for(const [teamId,teamState] of Object.entries(teams)){
    teams[teamId]=transitionPhysicalTechnicalScope(
      state,
      teamState,
      {teamId,targetYear:target}
    );
  }

  return {
    ...state,
    development:playerScope.development,
    garage:playerScope.garage,
    physicalSeasonTransition:playerScope.physical_season_transition,
    aiTechnicalWorld:state?.aiTechnicalWorld
      ?{...state.aiTechnicalWorld,teams}
      :state?.aiTechnicalWorld,
  };
}

export function activeBlueprint(part){
  return Boolean(
    part &&
    part?.status!=="legacy" &&
    part?.legal_for_season!==false
  );
}

export function activePhysicalUnit(unit){
  return Boolean(unit&&unit?.status!=="retired");
}
