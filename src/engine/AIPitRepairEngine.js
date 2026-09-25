// src/engine/AIPitRepairEngine.js
// RW5.3B.2C — AI pit-repair decisions.
//
// Decisions are based only on damage already observable at the current race
// point. Historical/future incident data must be filtered by the caller before
// entering this module.

import { CAR_DAMAGE_COMPONENTS } from "./CarDamageEngine.js";
import { buildPitServiceSchedule } from "./PitServiceEngine.js";

const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,num(value,min)));

function controlLaneMultiplier(controlType){
  const type=String(controlType||"GREEN").toUpperCase();
  if(type==="SAFETY_CAR")return 0.58;
  if(type==="VSC")return 0.76;
  if(type==="RED_FLAG")return 0.35;
  return 1;
}

function subsets(values=[]){
  const rows=[];
  const count=values.length;
  for(let mask=1;mask<(1<<count);mask+=1){
    const selected=[];
    for(let index=0;index<count;index+=1){
      if(mask&(1<<index))selected.push(values[index]);
    }
    rows.push(selected);
  }
  return rows;
}

function componentDamagePct(damageState,component){
  return clamp(damageState?.components?.[component]?.damage_pct,0,100);
}

function safetyValueSeconds(damageState,components,remainingLaps){
  const structuralWeights={
    suspension:0.030,
    brakes:0.028,
    cooling:0.024,
    floor:0.012,
    rear_wing:0.009,
    front_wing:0.005,
  };
  const horizon=Math.min(1.6,Math.max(0.35,num(remainingLaps,1)/12));
  return components.reduce((sum,component)=>{
    const damage=componentDamagePct(damageState,component);
    const excess=Math.max(0,damage-50);
    return sum+excess*num(structuralWeights[component],0)*horizon;
  },0);
}

function positionCostFactor(position,fieldSize){
  const pos=Math.max(1,Math.round(num(position,fieldSize||20)));
  const size=Math.max(pos,Math.round(num(fieldSize,20)));
  const percentile=size>1?(pos-1)/(size-1):0.5;
  if(percentile<=0.15)return 1.10;
  if(percentile<=0.40)return 1.05;
  if(percentile>=0.80)return 0.96;
  return 1;
}

export function aiPitRepairDecision({
  year=1980,
  damageState=null,
  remainingLaps=0,
  alreadyStopping=false,
  tyreChange=false,
  tyreServiceS=6.8,
  refuel=false,
  fuelServiceS=0,
  crewFactor=1,
  pitLaneLossS=24,
  controlType="GREEN",
  raceIntelligence=60,
  aggression=50,
  trackOvertakingDifficulty=50,
  position=null,
  fieldSize=20,
  raceImportance=1,
}={}){
  const remaining=Math.max(0,Math.round(num(remainingLaps,0)));
  const damaged=(damageState?.damaged_components||[])
    .map(String)
    .filter((component)=>CAR_DAMAGE_COMPONENTS.includes(component))
    .filter((component)=>componentDamagePct(damageState,component)>=6);

  const baseResult={
    model:"rw5.3b.2c",
    should_repair:false,
    repair_components:[],
    dedicated_stop:false,
    reason:"no_repair_value",
    observed_damage_components:[...damaged],
    recovered_pace_s_per_lap:0,
    projected_stay_out_loss_s:0,
    incremental_service_s:0,
    effective_pit_cost_s:0,
    safety_value_s:0,
    decision_margin_s:0,
  };
  if(!damageState||!damaged.length)return {...baseResult,reason:"no_observed_damage"};
  if(remaining<=1)return {...baseResult,reason:"insufficient_race_remaining"};

  const baseSchedule=buildPitServiceSchedule({
    year,
    tyreChange:Boolean(tyreChange),
    tyreServiceS,
    refuel:Boolean(refuel),
    fuelServiceS,
    damageState,
    repairComponents:[],
    crewFactor,
  });
  const baseStationary=Math.max(0,num(baseSchedule?.total_stationary_s,0));
  const laneCost=alreadyStopping
    ?0
    :Math.max(0,num(pitLaneLossS,24))*controlLaneMultiplier(controlType);

  const intelligence=clamp(raceIntelligence);
  const driverAggression=clamp(aggression);
  const overtakeDifficulty=clamp(trackOvertakingDifficulty);
  const importance=clamp(num(raceImportance,1),0.6,1.4);
  const confidence=0.90+intelligence*0.0015;
  const aggressionCost=1+(driverAggression-50)*0.0025;
  const trafficCost=alreadyStopping?1:0.94+overtakeDifficulty*0.0018;
  const intelligenceCost=1.08-intelligence*0.0015;
  const positionCost=alreadyStopping?1:positionCostFactor(position,fieldSize);
  const costFactor=Math.max(0.82,aggressionCost*trafficCost*intelligenceCost*positionCost);

  let best=null;
  for(const selected of subsets(damaged)){
    const schedule=buildPitServiceSchedule({
      year,
      tyreChange:Boolean(tyreChange),
      tyreServiceS,
      refuel:Boolean(refuel),
      fuelServiceS,
      damageState,
      repairComponents:selected,
      crewFactor,
    });
    const repaired=schedule?.repair;
    const repairedComponents=Array.isArray(repaired?.repaired_components)?repaired.repaired_components:[];
    if(!repairedComponents.length)continue;

    const paceBefore=Math.max(0,num(repaired?.pace_loss_before_s_per_lap,damageState?.pace_loss_s_per_lap));
    const paceAfter=Math.max(0,num(repaired?.pace_loss_after_s_per_lap,paceBefore));
    const recoveredPace=Math.max(0,paceBefore-paceAfter);
    const stayOutLoss=recoveredPace*remaining;
    const safetyValue=safetyValueSeconds(damageState,repairedComponents,remaining);
    const incrementalService=Math.max(0,num(schedule?.total_stationary_s,0)-baseStationary);
    const rawCost=laneCost+incrementalService;
    const adjustedBenefit=(stayOutLoss+safetyValue)*confidence*importance;
    const adjustedCost=rawCost*costFactor;
    const margin=adjustedBenefit-adjustedCost;

    const candidate={
      repair_components:[...repairedComponents],
      recovered_pace_s_per_lap:Number(recoveredPace.toFixed(3)),
      projected_stay_out_loss_s:Number(stayOutLoss.toFixed(2)),
      incremental_service_s:Number(incrementalService.toFixed(2)),
      effective_pit_cost_s:Number(rawCost.toFixed(2)),
      safety_value_s:Number(safetyValue.toFixed(2)),
      decision_margin_s:Number(margin.toFixed(2)),
      service_schedule:schedule,
    };
    if(
      !best||
      candidate.decision_margin_s>best.decision_margin_s||
      candidate.decision_margin_s===best.decision_margin_s&&candidate.repair_components.length<best.repair_components.length
    ){
      best=candidate;
    }
  }

  if(!best||best.decision_margin_s<=0)return {
    ...baseResult,
    reason:"repair_cost_exceeds_value",
    projected_stay_out_loss_s:best?.projected_stay_out_loss_s||0,
    incremental_service_s:best?.incremental_service_s||0,
    effective_pit_cost_s:best?.effective_pit_cost_s||0,
    safety_value_s:best?.safety_value_s||0,
    decision_margin_s:best?.decision_margin_s||0,
  };

  return {
    ...baseResult,
    ...best,
    should_repair:true,
    dedicated_stop:!alreadyStopping,
    reason:alreadyStopping?"opportunistic_repair_value":"dedicated_repair_value",
  };
}
