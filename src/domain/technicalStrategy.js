// src/domain/technicalStrategy.js
// Stage 7.5 — Current Car vs Next Season Car strategic resource allocation.
//
// Strategy redistributes finite technical effort. It does not create free performance:
// engineers are shared directly; Research and aero-analysis multipliers are zero-sum
// around the Balanced baseline.

import { technicalDevelopmentCapacity } from "./developmentProject.js";

const str=(v)=>String(v??"");
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const round=(v,d=2)=>Number(Number(v||0).toFixed(d));

export const TECHNICAL_STRATEGY_PRESETS=Object.freeze([
  {
    id:"current_car_push",
    label:"Current Car Push",
    description:"Protect the current-season campaign and keep future work deliberately lean.",
    current_car_share:70,
    next_season_share:30,
    engineer_target_share:0.30,
    future_research_share:0.25,
    future_aero_share:0.25,
  },
  {
    id:"balanced",
    label:"Balanced",
    description:"Split technical attention evenly between current competitiveness and next season.",
    current_car_share:50,
    next_season_share:50,
    engineer_target_share:0.50,
    future_research_share:0.50,
    future_aero_share:0.50,
  },
  {
    id:"next_season_priority",
    label:"Next Season Priority",
    description:"Accept a measured current-car sacrifice to accelerate the following-season package.",
    current_car_share:30,
    next_season_share:70,
    engineer_target_share:0.65,
    future_research_share:0.70,
    future_aero_share:0.70,
  },
  {
    id:"future_first",
    label:"Future First",
    description:"Commit heavily to the following season and minimise current-car technical support.",
    current_car_share:15,
    next_season_share:85,
    engineer_target_share:0.80,
    future_research_share:0.85,
    future_aero_share:0.80,
  },
]);

const BY_ID=new Map(TECHNICAL_STRATEGY_PRESETS.map((row)=>[row.id,row]));

export function technicalStrategyPreset(id="balanced"){
  return BY_ID.get(str(id))||BY_ID.get("balanced");
}

export function defaultTechnicalStrategy(){
  const preset=technicalStrategyPreset("balanced");
  return {
    version:1,
    id:preset.id,
    label:preset.label,
    description:preset.description,
    current_car_share:preset.current_car_share,
    next_season_share:preset.next_season_share,
    engineer_target_share:preset.engineer_target_share,
    future_research_share:preset.future_research_share,
    future_aero_share:preset.future_aero_share,
    changed_at:null,
  };
}

export function normalizeTechnicalStrategy(input){
  const source=input&&typeof input==="object"?input:{};
  const preset=technicalStrategyPreset(source.id||"balanced");
  return {
    version:1,
    id:preset.id,
    label:preset.label,
    description:preset.description,
    current_car_share:preset.current_car_share,
    next_season_share:preset.next_season_share,
    engineer_target_share:preset.engineer_target_share,
    future_research_share:preset.future_research_share,
    future_aero_share:preset.future_aero_share,
    changed_at:source.changed_at?str(source.changed_at).slice(0,10):null,
  };
}

export function technicalStrategyOf(gs){
  return normalizeTechnicalStrategy(gs?.development?.technicalStrategy);
}

export function setTechnicalStrategy(gs,{strategyId="balanced",dateISO=null}={}){
  if(!gs||typeof gs!=="object")return gs;
  const preset=technicalStrategyPreset(strategyId);
  const dev=gs?.development||{};
  return {
    ...gs,
    development:{
      ...dev,
      technicalStrategy:{
        version:1,
        id:preset.id,
        label:preset.label,
        description:preset.description,
        current_car_share:preset.current_car_share,
        next_season_share:preset.next_season_share,
        engineer_target_share:preset.engineer_target_share,
        future_research_share:preset.future_research_share,
        future_aero_share:preset.future_aero_share,
        changed_at:str(dateISO??gs?.currentDateISO).slice(0,10)||null,
      },
    },
  };
}

function symmetricMultipliers(futureShare){
  const future=clamp(num(futureShare,0.5),0,1);
  const delta=(future-0.5)*0.60;
  return {
    current_car_multiplier:round(1-delta,3),
    next_season_multiplier:round(1+delta,3),
  };
}

export function technicalStrategyResearchMultipliers(gsOrStrategy){
  const strategy=gsOrStrategy?.development
    ?technicalStrategyOf(gsOrStrategy)
    :normalizeTechnicalStrategy(gsOrStrategy);
  return {
    ...symmetricMultipliers(strategy.future_research_share),
    future_share:strategy.future_research_share,
    strategy_id:strategy.id,
  };
}

export function technicalStrategyAeroMultipliers(gsOrStrategy){
  const strategy=gsOrStrategy?.development
    ?technicalStrategyOf(gsOrStrategy)
    :normalizeTechnicalStrategy(gsOrStrategy);
  return {
    ...symmetricMultipliers(strategy.future_aero_share),
    future_share:strategy.future_aero_share,
    strategy_id:strategy.id,
  };
}

export function technicalStrategySnapshot(gs,{
  teamId=null,
  engineeringSupport=50,
  projects=null,
  nextSeasonCar=null,
}={}){
  const strategy=technicalStrategyOf(gs);
  const id=str(teamId??gs?.team?.team_id??gs?.team?.id);
  const dev=gs?.development||{};
  const projectRows=Array.isArray(projects)?projects:(Array.isArray(dev?.projects)?dev.projects:[]);
  const programme=nextSeasonCar||dev?.nextSeasonCar||{};
  const base=technicalDevelopmentCapacity(gs,id,{
    engineeringSupport,
    projects:projectRows,
    reservedEngineers:0,
  });
  const actualNext=(programme?.status==="active"||programme?.status==="paused")
    ?Math.max(0,Math.floor(num(programme?.engineers,0)))
    :0;
  const targetNext=Math.max(
    programme?.status==="completed"?0:1,
    Math.round(base.engineer_pool*strategy.engineer_target_share)
  );
  const feasibleNext=Math.max(
    programme?.status==="completed"?0:1,
    Math.min(targetNext,Math.max(0,base.engineer_pool-base.project_engineers))
  );
  const actualFree=Math.max(0,base.engineer_pool-base.project_engineers-actualNext);
  const research=technicalStrategyResearchMultipliers(strategy);
  const aero=technicalStrategyAeroMultipliers(strategy);

  return {
    version:1,
    strategy,
    engineers:{
      pool:base.engineer_pool,
      current_projects:base.project_engineers,
      next_season:actualNext,
      free:actualFree,
      target_next_season:targetNext,
      feasible_next_season:feasibleNext,
      blocked_engineers:Math.max(0,targetNext-feasibleNext),
      target_reached:actualNext===feasibleNext,
    },
    research,
    aero,
    shares:{
      current_car:strategy.current_car_share,
      next_season:strategy.next_season_share,
    },
  };
}
