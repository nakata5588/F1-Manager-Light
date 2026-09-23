// src/domain/carReliability.js
// Unified reliability model shared by Cars, Practice and Race Control.
// Historical car/engine reliability is the baseline. Developed design quality and
// physical component condition only contribute deltas, avoiding double-counting.

import { availableCarComponentSlots, carComponentDefinition } from "./carComponents.js";
import { derivePartTechnicalProfile } from "./carPartPerformance.js";
import { partDesignById, partUnitById } from "./partUnits.js";
import { aiTechnicalCarForDriver, aiTechnicalScopedState } from "../engine/AITechnicalEngine.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const str=(v)=>String(v??"");
const round1=(v)=>Math.round(Number(v||0)*10)/10;

export const COMPONENT_RELIABILITY_CRITICALITY=Object.freeze({
  chassis:1.00,
  aero_front:0.30,
  aero_rear:0.32,
  sidepods:0.42,
  underfloor:0.52,
  suspension:1.15,
  gearbox:1.35,
  brakes:0.95,
  cooling:1.25,
  turbocharger:1.20,
  electronics:1.05,
  kers:1.10,
  ers_mgu_k:1.18,
  ers_mgu_h:1.25,
  battery_pack:1.15,
  fuel_system:1.15,
  exhaust_system:0.65,
});

function yearOf(gs){return Number(gs?.activeYear)||Number(String(gs?.currentDateISO||"").slice(0,4))||1980;}
function teamIdOf(row){return str(pick(row,["team_id","team","constructor_id","constructor"],""));}
function rowForTeam(rows,teamId,year){
  const list=Array.isArray(rows)?rows:[];
  return list.find((row)=>teamIdOf(row)===str(teamId)&&Number(row?.year??row?.season_year)===Number(year))
    ||list.find((row)=>teamIdOf(row)===str(teamId))
    ||{};
}
function percentReliability(value,fallback){
  const n=num(value,NaN);
  if(!Number.isFinite(n))return fallback;
  return n<=1?n*100:n;
}
function playerCarForDriver(gs,driverId){
  const did=str(driverId);
  const live=(gs?.raceEntryState?.entries||[]).find((row)=>
    str(row?.driver_id)===did &&
    Number(row?.car_slot)>=1 &&
    Number(row?.car_slot)<=2
  );
  if(live){
    const car=(gs?.garage?.cars||[]).find((row)=>str(row?.id)===`car_${Number(live.car_slot)}`);
    if(car)return car;
  }
  return (gs?.garage?.cars||[]).find((row)=>str(row?.driver_id)===did)||null;
}

export function historicalReliabilityBaseline(gs,teamId){
  const year=yearOf(gs);
  const car=rowForTeam(gs?.carStats||gs?.dbCarStats||[],teamId,year);
  const engine=rowForTeam(gs?.teamEngines||gs?.dbTeamEngines||[],teamId,year);
  const carPct=percentReliability(car?.reliability,75);
  const enginePct=percentReliability(
    pick(engine,["reliability_override","reliability"],NaN),
    carPct
  );
  return {
    car_pct:clamp(carPct,30,99),
    engine_pct:clamp(enginePct,30,99),
    combined_pct:clamp(carPct*0.55+enginePct*0.45,30,99),
  };
}

function componentBaselineReliability(gs,slot){
  const def=carComponentDefinition(gs,slot)||{};
  return clamp(percentReliability(def?.base_reliability,80),35,99);
}
function conditionPenaltyPct(condition,criticality){
  const missing=(100-clamp(condition))/100;
  // Mild wear has little effect; once condition falls, critical components become
  // disproportionately more likely to fail.
  return Math.pow(missing,1.42)*18*Math.max(0.2,Number(criticality||1));
}

function componentRow(gs,car,slot){
  const definition=carComponentDefinition(gs,slot)||{};
  const baselinePct=componentBaselineReliability(gs,slot);
  const installedRef=car?.installedParts?.[slot];
  const unit=installedRef?partUnitById(gs,installedRef):null;
  const design=unit?partDesignById(gs,unit.design_id):installedRef?partDesignById(gs,installedRef):null;
  const condition=clamp(unit?.condition??car?.componentCondition?.[slot]??100);
  const criticality=Number(COMPONENT_RELIABILITY_CRITICALITY[slot]??1);

  let designPct=baselinePct;
  if(design){
    const profile=derivePartTechnicalProfile(gs,{...design,slot});
    designPct=clamp(num(profile?.design?.reliability,baselinePct/100)*100,35,99);
  }

  const designDelta=designPct-baselinePct;
  const conditionPenalty=conditionPenaltyPct(condition,criticality);
  const delta=designDelta-conditionPenalty;
  const riskWeight=Math.max(0.05,criticality*(1+conditionPenalty/14));

  return {
    slot,
    label:definition?.label||slot,
    baseline_pct:round1(baselinePct),
    design_pct:round1(designPct),
    design_delta_pct:round1(designDelta),
    condition_pct:round1(condition),
    condition_penalty_pct:round1(conditionPenalty),
    net_delta_pct:round1(delta),
    criticality:Number(criticality.toFixed(2)),
    risk_weight:Number(riskWeight.toFixed(3)),
    source:design?"developed_part":"standard_component",
    design_id:design?.id||null,
    unit_id:unit?.id||null,
  };
}

function physicalComponentProfile(gs,teamId,driverId){
  const player=str(gs?.team?.team_id??gs?.team?.id);
  const isPlayer=str(teamId)===player;
  const sourceState=isPlayer?gs:aiTechnicalScopedState(gs,teamId);
  if(!sourceState)return null;

  if(driverId==null||driverId===""){
    const raceCars=(sourceState?.garage?.cars||[]).filter((car)=>car?.kind==="race");
    if(!raceCars.length)return null;
    const rows=raceCars.map((car)=>componentProfileForCar(sourceState,teamId,car)).filter(Boolean);
    if(!rows.length)return null;
    return {
      design_delta_pct:rows.reduce((s,row)=>s+row.design_delta_pct,0)/rows.length,
      condition_penalty_pct:rows.reduce((s,row)=>s+row.condition_penalty_pct,0)/rows.length,
      component_delta_pct:rows.reduce((s,row)=>s+row.component_delta_pct,0)/rows.length,
      components:rows.flatMap((row)=>row.components),
      weakest:rows.flatMap((row)=>row.weakest).sort((a,b)=>b.risk_weight-a.risk_weight).slice(0,5),
    };
  }

  const car=isPlayer
    ?playerCarForDriver(gs,driverId)
    :aiTechnicalCarForDriver(gs,teamId,driverId);
  return car?componentProfileForCar(sourceState,teamId,car):null;
}

function componentProfileForCar(gs,teamId,car){
  const slots=availableCarComponentSlots(gs,teamId);
  const components=slots.map((slot)=>componentRow(gs,car,slot));
  if(!components.length)return null;
  const totalWeight=components.reduce((sum,row)=>sum+row.criticality,0)||1;
  const designDelta=components.reduce((sum,row)=>sum+row.design_delta_pct*row.criticality,0)/totalWeight;
  const conditionPenalty=components.reduce((sum,row)=>sum+row.condition_penalty_pct*row.criticality,0)/totalWeight;
  const weakest=components.slice().sort((a,b)=>
    (b.condition_penalty_pct*b.criticality)-(a.condition_penalty_pct*a.criticality)
  ).slice(0,5);
  return {
    design_delta_pct:designDelta,
    condition_penalty_pct:conditionPenalty,
    component_delta_pct:designDelta-conditionPenalty,
    components,
    weakest,
  };
}

export function carReliabilityProfile(gs,teamId,driverId=null){
  const historical=historicalReliabilityBaseline(gs,teamId);
  const physical=physicalComponentProfile(gs,teamId,driverId);
  const componentDelta=physical?.component_delta_pct||0;
  const reliabilityPct=clamp(historical.combined_pct+componentDelta,35,98.5);
  return {
    team_id:str(teamId),
    driver_id:driverId==null?null:str(driverId),
    reliability:Number((reliabilityPct/100).toFixed(4)),
    reliability_pct:round1(reliabilityPct),
    historical,
    design_delta_pct:round1(physical?.design_delta_pct||0),
    condition_penalty_pct:round1(physical?.condition_penalty_pct||0),
    component_delta_pct:round1(componentDelta),
    components:physical?.components||[],
    weakest_components:physical?.weakest||[],
    source:"unified_car_reliability_v1",
  };
}

export function mechanicalFailureChance(profile,{
  session="race",
  riskMultiplier=1,
  programmeRisk=1,
  weatherRisk=1,
  fatigue=0,
}={}){
  const reliability=clamp(num(profile?.reliability,0.75),0.20,0.995);
  const unreliability=1-reliability;
  const fatiguePenalty=Math.max(0,num(fatigue,0)-55)*0.00018;
  let chance;
  if(session==="practice"){
    chance=(0.0025+unreliability*0.030)*num(programmeRisk,1)*num(weatherRisk,1)+fatiguePenalty*0.35;
    return Math.max(0.001,Math.min(0.09,chance));
  }
  if(session==="qualifying"){
    chance=(0.004+unreliability*0.095)*num(riskMultiplier,1)+fatiguePenalty*0.55;
    return Math.max(0.002,Math.min(0.16,chance));
  }
  chance=unreliability*0.68*num(riskMultiplier,1)+fatiguePenalty;
  return Math.max(0.015,Math.min(0.36,chance));
}

const SLOT_FAILURE_REASON=Object.freeze({
  chassis:"Chassis",
  aero_front:"Front wing",
  aero_rear:"Rear wing",
  sidepods:"Bodywork",
  underfloor:"Floor",
  suspension:"Suspension",
  gearbox:"Gearbox",
  brakes:"Brakes",
  cooling:"Cooling",
  turbocharger:"Turbo",
  electronics:"Electrical",
  kers:"KERS",
  ers_mgu_k:"MGU-K",
  ers_mgu_h:"MGU-H",
  battery_pack:"Energy store",
  fuel_system:"Fuel system",
  exhaust_system:"Exhaust",
});

export function mechanicalFailureCandidates(profile){
  const componentRows=(profile?.components||[])
    .map((row)=>({
      slot:row.slot,
      reason:SLOT_FAILURE_REASON[row.slot]||row.label||row.slot,
      weight:Math.max(0.02,row.risk_weight*(1+row.condition_penalty_pct/8)),
    }));
  const engineUnreliability=Math.max(0.02,(100-num(profile?.historical?.engine_pct,80))/12);
  return [
    ...componentRows,
    {slot:"engine",reason:"Engine",weight:engineUnreliability},
  ];
}

export function selectMechanicalFailureReason(profile,roll=0.5){
  const candidates=mechanicalFailureCandidates(profile);
  const total=candidates.reduce((sum,row)=>sum+row.weight,0)||1;
  let target=Math.max(0,Math.min(0.999999,Number(roll)||0))*total;
  for(const row of candidates){
    target-=row.weight;
    if(target<=0)return row;
  }
  return candidates.at(-1)||{slot:"engine",reason:"Engine",weight:1};
}
