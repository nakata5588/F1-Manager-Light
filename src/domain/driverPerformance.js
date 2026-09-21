// src/domain/driverPerformance.js
import { driverCondition } from "./driverRating.js";
import { teamCarPerformance } from "./carPerformance.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const n=(v,fb=50)=>{const x=Number(v);return Number.isFinite(x)?x:fb;};

export function conditionModifier(gs,driverId){
  const c=driverCondition(gs,driverId)||{};
  const confidence=n(c.confidence,50);
  const morale=n(c.morale,50);
  const fatigue=n(c.fatigue,0);
  const preparation=n(c.preparation,50);

  const positive=
    (confidence-50)*0.050+
    (morale-50)*0.030+
    (preparation-50)*0.040;
  const fatiguePenalty=Math.max(0,fatigue-25)*0.080;
  return Math.max(-8,Math.min(6,positive-fatiguePenalty));
}

export function qualifyingDriverScore(rating,gs,driverId){
  const r=rating||{};
  const score=
    n(r.pace,60)*0.30+
    n(r.qualifying,r.pace??60)*0.36+
    n(r.consistency,60)*0.08+
    n(r.pressure_handling,60)*0.10+
    n(r.adaptability,60)*0.06+
    n(r.mentality,60)*0.05+
    n(r.current_ability,60)*0.05;
  return clamp(score+conditionModifier(gs,driverId));
}

export function raceDriverScore(rating,gs,driverId){
  const r=rating||{};
  const score=
    n(r.pace,60)*0.20+
    n(r.racecraft,60)*0.18+
    n(r.consistency,60)*0.15+
    n(r.tire_management,60)*0.10+
    n(r.race_intelligence,60)*0.10+
    n(r.start_launch,60)*0.06+
    n(r.mentality,60)*0.06+
    n(r.pressure_handling,60)*0.05+
    n(r.adaptability,60)*0.05+
    n(r.current_ability,60)*0.05;
  return clamp(score+conditionModifier(gs,driverId));
}

export function wetDriverModifier(rating){
  const wet=n(rating?.wet_skill,50);
  const adapt=n(rating?.adaptability,50);
  return ((wet-50)*0.10)+((adapt-50)*0.04);
}

function teamSynergyModifier(gs){
  const value=Number(gs?.meta?.team?.synergy ?? 0);
  if(!Number.isFinite(value))return 0;
  return Math.max(-1.5,Math.min(1.5,value*0.03));
}


function practiceResult(gs,driverId){
  return (gs?.raceWeekendState?.practice?.results||[]).find(
    (row)=>String(row?.driver_id??"")===String(driverId??"")
  )||null;
}

function practicePerformanceModifier(gs,driverId,session){
  const row=practiceResult(gs,driverId);
  if(!row)return 0;
  const quality=n(row.setup_quality,50);
  const qualityModifier=(quality-50)*(session==="qualifying"?0.050:0.035);
  const programmeBonus=session==="qualifying"
    ?n(row.qualifying_bonus,0)
    :n(row.race_bonus,0);
  return Math.max(-3,Math.min(4,qualityModifier+programmeBonus));
}

export function combinedQualifyingPerformance({gs,driver,rating,teamId,wet=false}){
  const driverScore=qualifyingDriverScore(rating,gs,driver?.driver_id);
  const car=teamCarPerformance(gs,teamId,driver?.driver_id);
  const wetMod=wet?wetDriverModifier(rating):0;
  const synergy=teamSynergyModifier(gs);
  // Car matters slightly more than driver over a single lap.
  const practice=practicePerformanceModifier(gs,driver?.driver_id,"qualifying");
  return driverScore*0.47+car.qualifying*0.53+wetMod+synergy+practice;
}

export function combinedRacePerformance({gs,driver,rating,teamId,wet=false}){
  const driverScore=raceDriverScore(rating,gs,driver?.driver_id);
  const car=teamCarPerformance(gs,teamId,driver?.driver_id);
  const wetMod=wet?wetDriverModifier(rating):0;
  const synergy=teamSynergyModifier(gs);
  const practice=practicePerformanceModifier(gs,driver?.driver_id,"race");
  return driverScore*0.52+car.race*0.48+wetMod+synergy+practice;
}
