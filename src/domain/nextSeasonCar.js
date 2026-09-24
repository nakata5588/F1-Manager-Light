// src/domain/nextSeasonCar.js
// Stage 7.1 — Next Season Car programme foundation.
//
// The next-season car is a persistent technical programme. It is NOT a physical
// car during the current season and it does not consume a Current Car project
// slot. It does consume real engineering capacity and budget.

import { technicalDevelopmentCapacity } from "./developmentProject.js";
import { nextSeasonRegulationImpact } from "./nextSeasonRegulations.js";
import { nextSeasonKnowledgeCarryover, technicalKnowledgeSnapshot } from "./technicalKnowledge.js";

const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const str=(v)=>String(v??"");

export const NEXT_SEASON_PHASES=Object.freeze([
  {id:"concept",label:"Concept",weight:15,description:"Overall technical direction, packaging targets and first-order architecture."},
  {id:"design",label:"Design",weight:45,description:"Detailed aerodynamic, chassis and mechanical design work."},
  {id:"integration",label:"Integration",weight:25,description:"Combine the main systems into one coherent technical package."},
  {id:"validation",label:"Validation",weight:15,description:"Validate the package before it becomes the following season's baseline car."},
]);

function activeYearOf(gs){
  return Number(gs?.activeYear)||Number(str(gs?.currentDateISO).slice(0,4))||1980;
}

function dateOnly(value){
  const raw=str(value).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:"";
}

function facilitySnapshot(gs,teamId){
  const year=activeYearOf(gs);
  const row=(gs?.facilities||[]).find((item)=>
    str(item?.team_id??item?.team)===str(teamId) &&
    (!Number.isFinite(Number(item?.year))||Number(item?.year)===year)
  )||{};
  const hq=gs?.hq?.facilityLevels||{};
  const value=(...keys)=>{
    for(const key of keys){
      const v=Number(hq?.[key]??row?.[key]);
      if(Number.isFinite(v))return clamp(v,1,10);
    }
    return 5;
  };
  const aero=value("aero_dept_level");
  const wind=value("wind_tunnel_level");
  const chassis=value("_chassis_shop_level","chassis_shop_level");
  const manufacturing=value("manufacturing_leve","manufacturing_level");
  return {
    aero,wind,chassis,manufacturing,
    average:Number(((aero+wind+chassis+manufacturing)/4).toFixed(2)),
  };
}

function phaseForProgress(progress){
  const overall=clamp(progress,0,100);
  let cursor=0;
  for(const phase of NEXT_SEASON_PHASES){
    const end=cursor+phase.weight;
    if(overall<end || phase.id===NEXT_SEASON_PHASES.at(-1).id){
      const within=phase.weight>0?clamp(((overall-cursor)/phase.weight)*100,0,100):100;
      return {...phase,phase_progress:Number(within.toFixed(2)),start:cursor,end};
    }
    cursor=end;
  }
  return {...NEXT_SEASON_PHASES.at(-1),phase_progress:100,start:85,end:100};
}

export function defaultNextSeasonCarProgramme(activeYear=1980){
  const year=Number(activeYear)||1980;
  return {
    version:1,
    targetSeason:year+1,
    status:"not_started",
    phase:"concept",
    phase_progress:0,
    overall_progress:0,
    engineers:0,
    launch_cost:0,
    budget_committed:0,
    budget_spent:0,
    started_at:null,
    last_progress_date:null,
    completed_at:null,
    readiness:"planning",
    regulation_impact:null,
    knowledge_at_launch:null,
    knowledge_carryover:null,
  };
}

export function normalizeNextSeasonCarProgramme(input,{activeYear=1980}={}){
  const fallback=defaultNextSeasonCarProgramme(activeYear);
  const source=input&&typeof input==="object"?input:{};
  const overall=clamp(num(source.overall_progress,source.progress??0),0,100);
  const phase=phaseForProgress(overall);
  const rawStatus=str(source.status||fallback.status);
  const allowed=new Set(["not_started","active","paused","completed"]);
  const status=overall>=100?"completed":(allowed.has(rawStatus)?rawStatus:"not_started");
  const targetRaw=Number(source.targetSeason??source.target_season);
  const targetSeason=Number.isInteger(targetRaw)&&targetRaw>0
    ?targetRaw
    :Number(activeYear||1980)+1;
  return {
    ...fallback,
    ...source,
    version:1,
    targetSeason,
    status,
    phase:phase.id,
    phase_progress:phase.phase_progress,
    overall_progress:Number(overall.toFixed(2)),
    engineers:Math.max(0,Math.floor(num(source.engineers,0))),
    launch_cost:Math.max(0,Math.round(num(source.launch_cost,0))),
    budget_committed:Math.max(0,Math.round(num(source.budget_committed,0))),
    budget_spent:Math.max(0,Math.round(num(source.budget_spent,0))),
    started_at:dateOnly(source.started_at)||null,
    last_progress_date:dateOnly(source.last_progress_date)||null,
    completed_at:dateOnly(source.completed_at)||null,
    readiness:overall>=100?"ready":str(source.readiness||"planning"),
  };
}

export function nextSeasonProgrammePhase(programme){
  return phaseForProgress(num(programme?.overall_progress,0));
}

export function nextSeasonProgrammeQuote(gs,{engineers=4,teamId=null}={}){
  const id=str(teamId??gs?.team?.team_id??gs?.team?.id);
  const allocated=Math.max(1,Math.floor(num(engineers,4)));
  const facilities=facilitySnapshot(gs,id);
  const efficiency=clamp(1.12-facilities.average*0.025,0.82,1.08);
  const launchCost=Math.round((260_000+allocated*72_500)*efficiency/10_000)*10_000;
  return {
    engineers:allocated,
    launch_cost:launchCost,
    facilities,
    targetSeason:activeYearOf(gs)+1,
  };
}

function financeBalance(gs){
  return num(gs?.finances?.balance, num(gs?.team?.budget,0));
}

function patchBudget(gs,amount,description){
  const value=Math.max(0,Math.round(num(amount,0)));
  const oldTeamBudget=num(gs?.team?.budget,financeBalance(gs));
  const oldBalance=financeBalance(gs);
  const date=dateOnly(gs?.currentDateISO);
  const id=`next_car_${date||"date"}_${Math.abs(value)}`;
  return {
    ...gs,
    team:{...(gs?.team||{}),budget:oldTeamBudget-value},
    finances:{
      ...(gs?.finances||{}),
      budget:num(gs?.finances?.budget,oldTeamBudget)-value,
      balance:oldBalance-value,
      season_spend:num(gs?.finances?.season_spend,0)+value,
    },
    financeLog:[
      ...(Array.isArray(gs?.financeLog)?gs.financeLog:[]),
      {id,dateISO:date,type:"expense",category:"Next Season Car",amount:-value,desc:description},
    ],
  };
}

export function nextSeasonEngineeringCapacity(gs,{teamId=null,engineeringSupport=50}={}){
  const id=str(teamId??gs?.team?.team_id??gs?.team?.id);
  const dev=gs?.development||{};
  const programme=normalizeNextSeasonCarProgramme(dev?.nextSeasonCar,{activeYear:activeYearOf(gs)});
  const reserved=programme.status==="active"?programme.engineers:0;
  return technicalDevelopmentCapacity(gs,id,{
    engineeringSupport,
    projects:Array.isArray(dev?.projects)?dev.projects:[],
    reservedEngineers:reserved,
  });
}

export function startNextSeasonCarProgramme(gs,{
  teamId=null,
  engineers=4,
  engineeringSupport=50,
}={}){
  if(!gs||typeof gs!=="object")return gs;
  const id=str(teamId??gs?.team?.team_id??gs?.team?.id);
  const dev=gs?.development||{};
  const existing=normalizeNextSeasonCarProgramme(dev?.nextSeasonCar,{activeYear:activeYearOf(gs)});
  if(existing.status!=="not_started")return gs;

  const baseCapacity=technicalDevelopmentCapacity(gs,id,{
    engineeringSupport,
    projects:Array.isArray(dev?.projects)?dev.projects:[],
    reservedEngineers:0,
  });
  const requested=Math.max(1,Math.floor(num(engineers,4)));
  if(requested>baseCapacity.available_engineers)return gs;

  const quote=nextSeasonProgrammeQuote(gs,{engineers:requested,teamId:id});
  if(financeBalance(gs)<quote.launch_cost)return gs;

  const date=dateOnly(gs?.currentDateISO);
  let next=patchBudget(gs,quote.launch_cost,`Next Season Car — ${quote.targetSeason} programme launch`);
  const regulationImpact=nextSeasonRegulationImpact(gs,{targetSeason:quote.targetSeason,teamId:id});
  const knowledgeAtLaunch=technicalKnowledgeSnapshot(gs,{teamId:id});
  const knowledgeCarryover=nextSeasonKnowledgeCarryover(gs,{
    teamId:id,
    targetSeason:quote.targetSeason,
    regulationImpact,
  });
  const programme=normalizeNextSeasonCarProgramme({
    ...defaultNextSeasonCarProgramme(activeYearOf(gs)),
    targetSeason:quote.targetSeason,
    status:"active",
    engineers:requested,
    launch_cost:quote.launch_cost,
    budget_committed:quote.launch_cost,
    budget_spent:quote.launch_cost,
    started_at:date,
    last_progress_date:date,
    regulation_impact:regulationImpact,
    knowledge_at_launch:knowledgeAtLaunch,
    knowledge_carryover:knowledgeCarryover,
  },{activeYear:activeYearOf(gs)});

  return {
    ...next,
    development:{
      ...(next?.development||{}),
      nextSeasonCar:programme,
    },
  };
}

export function setNextSeasonCarEngineers(gs,{
  teamId=null,
  engineers=0,
  engineeringSupport=50,
}={}){
  if(!gs||typeof gs!=="object")return gs;
  const id=str(teamId??gs?.team?.team_id??gs?.team?.id);
  const dev=gs?.development||{};
  const programme=normalizeNextSeasonCarProgramme(dev?.nextSeasonCar,{activeYear:activeYearOf(gs)});
  if(programme.status==="not_started"||programme.status==="completed")return gs;

  const baseCapacity=technicalDevelopmentCapacity(gs,id,{
    engineeringSupport,
    projects:Array.isArray(dev?.projects)?dev.projects:[],
    reservedEngineers:0,
  });
  const requested=Math.max(1,Math.floor(num(engineers,programme.engineers||1)));
  if(requested>baseCapacity.available_engineers)return gs;

  return {
    ...gs,
    development:{
      ...dev,
      nextSeasonCar:{...programme,engineers:requested},
    },
  };
}

export function pauseNextSeasonCarProgramme(gs){
  const dev=gs?.development||{};
  const programme=normalizeNextSeasonCarProgramme(dev?.nextSeasonCar,{activeYear:activeYearOf(gs)});
  if(programme.status!=="active")return gs;
  return {...gs,development:{...dev,nextSeasonCar:{...programme,status:"paused"}}};
}

export function resumeNextSeasonCarProgramme(gs,{teamId=null,engineeringSupport=50}={}){
  const dev=gs?.development||{};
  const programme=normalizeNextSeasonCarProgramme(dev?.nextSeasonCar,{activeYear:activeYearOf(gs)});
  if(programme.status!=="paused")return gs;
  const id=str(teamId??gs?.team?.team_id??gs?.team?.id);
  const capacity=technicalDevelopmentCapacity(gs,id,{
    engineeringSupport,
    projects:Array.isArray(dev?.projects)?dev.projects:[],
    reservedEngineers:0,
  });
  if(programme.engineers>capacity.available_engineers)return gs;
  return {...gs,development:{...dev,nextSeasonCar:{...programme,status:"active"}}};
}

export function advanceNextSeasonCarDay(gs,{teamId=null}={}){
  if(!gs||typeof gs!=="object")return gs;
  const dev=gs?.development||{};
  const activeYear=activeYearOf(gs);
  const programme=normalizeNextSeasonCarProgramme(dev?.nextSeasonCar,{activeYear});
  const today=dateOnly(gs?.currentDateISO);
  if(!today||programme.status!=="active"||programme.engineers<=0)return gs;
  if(programme.targetSeason<=activeYear)return gs;
  if(programme.last_progress_date&&programme.last_progress_date>=today)return gs;

  const id=str(teamId??gs?.team?.team_id??gs?.team?.id);
  const facilities=facilitySnapshot(gs,id);
  const facilityFactor=clamp(0.78+facilities.average*0.045,0.82,1.24);
  const engineerFactor=Math.max(1,programme.engineers);
  const dailyProgress=engineerFactor*0.11*facilityFactor;
  const overall=clamp(programme.overall_progress+dailyProgress,0,100);
  const phase=phaseForProgress(overall);
  const completed=overall>=100;
  const knowledgeCarryover=nextSeasonKnowledgeCarryover(gs,{
    teamId:id,
    targetSeason:programme.targetSeason,
    regulationImpact:programme.regulation_impact||null,
    development:dev,
  });

  return {
    ...gs,
    development:{
      ...dev,
      nextSeasonCar:{
        ...programme,
        status:completed?"completed":"active",
        phase:phase.id,
        phase_progress:phase.phase_progress,
        overall_progress:Number(overall.toFixed(2)),
        last_progress_date:today,
        completed_at:completed?today:null,
        readiness:completed?"ready":"developing",
        engineers:completed?0:programme.engineers,
        knowledge_carryover:knowledgeCarryover,
      },
    },
  };
}
