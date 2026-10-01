// src/race2/core/RacePitStrategy.js
// RW8.14K1 / RW11D: canonical pit-strategy planner + live strategy forecast.
//
// Strategy owns the decision and forecast. RacePitStops remains execution-only,
// while Race View only projects the canonical fields stored here.

import { pitLaneLossSeconds } from "../../domain/racePitModel.js";
import { tyreConditionEffects } from "../../domain/raceTyreModel.js";
import {
  buildRaceClassification,
  canonicalTimingReferenceSpeedMs,
} from "./RaceClassification.js";
import { canonicalProjectedTyreWearPerLap } from "./RaceResources.js";

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,finite(value,min)));
const round=(value,digits=3)=>{
  const parsed=finite(value,null);
  return parsed==null?null:Number(parsed.toFixed(digits));
};
const text=(value)=>String(value??"").trim().toLowerCase();

function lapLimitFor(state){
  return Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));
}

function currentLapFor(car){
  return Math.max(1,Math.round(finite(car?.lap,finite(car?.completedLaps,0)+1)));
}

function remainingLapsFor(state,car){
  return Math.max(0,lapLimitFor(state)-currentLapFor(car)+1);
}

export function nextReachablePitLap(state,car){
  const length=Math.max(1,finite(state?.track?.lengthM,1));
  const absolute=Math.max(0,finite(car?.absoluteDistanceM,0));
  const currentLap=Math.max(1,Math.floor(absolute/length)+1);
  const entry=finite(state?.track?.pitLane?.entryM,null);
  const currentEntry=entry==null
    ?currentLap*length
    :(currentLap-1)*length+entry;
  const target=absolute<currentEntry-1e-6
    ?currentLap
    :currentLap+1;
  const limit=lapLimitFor(state);
  return target<=limit?target:null;
}

function weatherTyreCategory(state){
  const weather=text(
    state?.weatherState?.state
    ??state?.weatherState?.current?.state
    ??state?.trackState?.weatherState
  );
  const wetness=finite(
    state?.weatherState?.track_wetness
    ??state?.trackState?.wetness,
    null
  );
  if(["heavy_rain","storm"].includes(weather)||(wetness!=null&&wetness>=0.68))return "wet";
  if(["light_rain","wetting","drying","drizzle_drying"].includes(weather)||(wetness!=null&&wetness>=0.22))return "intermediate";
  return "dry";
}

function bestAvailableTyre(car,category){
  const currentId=String(car?.tyre?.tyre_id??"");
  const exact=(car?.resources?.availableTyres||[])
    .filter((row)=>text(row?.category||"dry")===category&&String(row?.tyre_id??"")!==currentId)
    .sort((a,b)=>
      finite(b?.grip_index,75)-finite(a?.grip_index,75)||
      finite(a?.wear_rate,0.018)-finite(b?.wear_rate,0.018)||
      String(a?.tyre_id??"").localeCompare(String(b?.tyre_id??""))
    );
  return exact[0]??null;
}

function expectedPitLossSeconds(state,car,{tyreChange=true}={}){
  const laneLoss=Math.max(0,pitLaneLossSeconds(state?.track,24));
  const crew=car?.resources?.pitCrew||{};
  const service=tyreChange
    ?Math.max(2,finite(crew?.avg_time_s,6.8))
    :0;
  return round(laneLoss+service,3);
}

function pitWindowFor(state,car){
  const currentLap=currentLapFor(car);
  const limit=lapLimitFor(state);
  const remaining=remainingLapsFor(state,car);
  const reachable=nextReachablePitLap(state,car);
  if(reachable==null||remaining<=2)return null;

  const currentCategory=text(car?.tyre?.category||"dry");
  const targetCategory=weatherTyreCategory(state);
  const weatherMismatch=currentCategory!==targetCategory&&Boolean(bestAvailableTyre(car,targetCategory));
  if(weatherMismatch){
    return {
      from_lap:reachable,
      to_lap:Math.min(limit,reachable+1),
      recommended_lap:reachable,
      reason:"weather",
      target_category:targetCategory,
    };
  }

  const strategy=car?.resources?.strategy||{};
  const configured=finite(strategy?.plannedStopLap,null);
  if(text(strategy?.pitPlan)!=="adaptive"&&configured!=null){
    const lap=clamp(Math.round(configured),reachable,limit);
    return {
      from_lap:lap,
      to_lap:lap,
      recommended_lap:lap,
      reason:text(strategy?.pitPlan)==="command"?"player_call":"planned",
      target_category:currentCategory,
    };
  }

  if(currentLap<=1)return null;

  const condition=clamp(finite(car?.tyre?.condition,100),0,100);
  const wearPerLap=Math.max(0,canonicalProjectedTyreWearPerLap(state,car));
  if(wearPerLap<=0.05)return null;

  const projectedFinishCondition=condition-wearPerLap*remaining;
  // 45% is the shared transition into the materially worn tyre band. Plan
  // around ~50% so the stop happens before the steepest pace/risk penalty.
  if(projectedFinishCondition>45)return null;

  const lapsToTarget=Math.max(0,(condition-50)/wearPerLap);
  const center=clamp(currentLap+Math.max(0,Math.floor(lapsToTarget)),reachable,Math.max(reachable,limit-2));
  const thermalStress=Math.max(1,finite(car?.tyre?.thermal_stress_multiplier,1));
  const earlyBias=thermalStress>=1.10?1:0;
  const recommended=clamp(center-earlyBias,reachable,Math.max(reachable,limit-2));

  return {
    from_lap:Math.max(reachable,recommended-1),
    to_lap:Math.min(Math.max(reachable,limit-2),recommended+1),
    recommended_lap:recommended,
    reason:"degradation",
    target_category:currentCategory,
  };
}

function lapPaceSpeedMs(state,car,referenceSpeedMs){
  const length=Math.max(1,finite(state?.track?.lengthM,1));
  const lastLapMs=finite(car?.lastLapMs,null);
  if(lastLapMs!=null&&lastLapMs>1000){
    return clamp(length/(lastLapMs/1000),25,100);
  }
  const target=finite(car?.targetSpeedKmh,null);
  if(target!=null&&target>0)return clamp(target/3.6,25,100);
  return clamp(referenceSpeedMs,25,100);
}

function tyreFadeCostSeconds(state,car,window){
  const remaining=remainingLapsFor(state,car);
  if(remaining<=0)return 0;
  const condition=clamp(finite(car?.tyre?.condition,100),0,100);
  const wear=Math.max(0,canonicalProjectedTyreWearPerLap(state,car));
  const currentPenalty=Math.max(0,finite(tyreConditionEffects(condition)?.pace_penalty_s,0));

  const lapsOnCurrent=window
    ?Math.max(0,Math.min(remaining,window.recommended_lap-currentLapFor(car)))
    :remaining;
  const endCondition=clamp(condition-wear*lapsOnCurrent,0,100);
  const endPenalty=Math.max(0,finite(tyreConditionEffects(endCondition)?.pace_penalty_s,0));
  return round(((currentPenalty+endPenalty)/2)*lapsOnCurrent,3);
}

function rejoinSnapshot(stateLike,car,pitLossS,referenceSpeedMs){
  const active=(stateLike?.cars||[]).filter((row)=>
    row&&!row?.dnf&&row?.status!=="dnf"&&row?.status!=="finished"&&
    String(row?.carId??"")!==String(car?.carId??"")
  );
  const currentAbsolute=Math.max(0,finite(car?.absoluteDistanceM,0));
  const positionForLoss=(lossS)=>{
    const projected=currentAbsolute-Math.max(0,lossS)*referenceSpeedMs;
    return 1+active.filter((row)=>finite(row?.absoluteDistanceM,0)>projected+1e-6).length;
  };
  const uncertaintyS=Math.max(1.5,Math.min(4,pitLossS*0.12));
  const nominalPosition=positionForLoss(pitLossS);
  const bestPosition=positionForLoss(Math.max(0,pitLossS-uncertaintyS));
  const worstPosition=positionForLoss(pitLossS+uncertaintyS);
  const projectedAbsolute=currentAbsolute-pitLossS*referenceSpeedMs;
  const trafficRadiusM=referenceSpeedMs*3.5;
  const trafficCount=active.filter((row)=>
    Math.abs(finite(row?.absoluteDistanceM,0)-projectedAbsolute)<=trafficRadiusM
  ).length;
  return {
    position:nominalPosition,
    best:Math.min(bestPosition,worstPosition),
    worst:Math.max(bestPosition,worstPosition),
    trafficCount,
  };
}

function confidencePct(state,car,window){
  const limit=lapLimitFor(state);
  const completed=Math.max(0,finite(car?.completedLaps,0));
  const elapsedRatio=clamp(completed/Math.max(1,limit),0,1);
  const wearKnown=finite(car?.tyre?.wear_per_lap_pct,0)>0.05;
  const lapKnown=finite(car?.lastLapMs,null)!=null;
  const wetness=clamp(finite(state?.trackState?.wetness,state?.weatherState?.track_wetness??0),0,1);
  const rain=clamp(finite(state?.trackState?.rainIntensity,state?.weatherState?.rain_intensity??0),0,1);
  const weatherPenalty=(wetness>0.05&&wetness<0.75?8:0)+(rain>0.03?5:0);
  const windowBonus=window?4:0;
  return Math.round(clamp(
    48+elapsedRatio*24+(wearKnown?10:0)+(lapKnown?8:0)+windowBonus-weatherPenalty,
    35,
    92
  ));
}

export function buildCanonicalStrategyForecasts(state,cars=state?.cars||[]){
  const stateLike={...state,cars};
  const classification=buildRaceClassification(stateLike);
  const positionByCar=new Map(classification.map((row)=>[String(row?.carId??""),row?.position]));
  const referenceSpeedMs=Math.max(25,finite(canonicalTimingReferenceSpeedMs(stateLike),55));
  const length=Math.max(1,finite(state?.track?.lengthM,1));
  const finishDistance=length*lapLimitFor(state);
  const provisional=[];

  for(const car of cars||[]){
    if(!car||car?.dnf||["dnf","finished"].includes(text(car?.status))){
      provisional.push({
        carId:String(car?.carId??""),
        forecast:null,
        projectedTimeS:Infinity,
        uncertaintyS:Infinity,
      });
      continue;
    }

    const window=pitWindowFor(stateLike,car);
    const targetCategory=window?.target_category??text(car?.tyre?.category||"dry");
    const nextTyre=window?bestAvailableTyre(car,targetCategory):null;
    const pitLossS=expectedPitLossSeconds(stateLike,car,{tyreChange:Boolean(window)});
    const rejoin=rejoinSnapshot(stateLike,car,pitLossS,referenceSpeedMs);
    const confidence=confidencePct(stateLike,car,window);
    const remainingDistance=Math.max(0,finishDistance-finite(car?.absoluteDistanceM,0));
    const paceSpeed=lapPaceSpeedMs(stateLike,car,referenceSpeedMs);
    const fadeCostS=tyreFadeCostSeconds(stateLike,car,window);
    const stopCostS=window?pitLossS:0;
    const projectedTimeS=remainingDistance/paceSpeed+fadeCostS+stopCostS;
    const uncertaintyS=Math.max(2,(100-confidence)*0.18+remainingLapsFor(stateLike,car)*0.08);
    const wearPerLap=Math.max(0,canonicalProjectedTyreWearPerLap(stateLike,car));
    const projectedFinishCondition=clamp(
      finite(car?.tyre?.condition,100)-wearPerLap*remainingLapsFor(stateLike,car),
      0,
      100
    );

    provisional.push({
      carId:String(car?.carId??""),
      projectedTimeS,
      uncertaintyS,
      forecast:{
        model:"rw11d",
        current_position:positionByCar.get(String(car?.carId??""))??null,
        pit_window:window?{
          from_lap:window.from_lap,
          to_lap:window.to_lap,
          recommended_lap:window.recommended_lap,
        }:null,
        pit_reason:window?.reason??null,
        next_tyre_id:nextTyre?.tyre_id??car?.resources?.strategy?.nextTyreId??null,
        expected_pit_loss_s:window?pitLossS:null,
        pit_rejoin_position:window?rejoin.position:null,
        pit_rejoin_best:window?rejoin.best:null,
        pit_rejoin_worst:window?rejoin.worst:null,
        pit_rejoin_traffic_count:window?rejoin.trafficCount:null,
        projected_finish_position:null,
        projected_finish_best:null,
        projected_finish_worst:null,
        projection_confidence_pct:confidence,
        projected_finish_tyre_condition:round(projectedFinishCondition,2),
        projected_wear_per_lap_pct:round(wearPerLap,3),
      },
    });
  }

  const active=provisional.filter((row)=>Number.isFinite(row.projectedTimeS));
  const nominal=[...active].sort((a,b)=>
    a.projectedTimeS-b.projectedTimeS||a.carId.localeCompare(b.carId)
  );
  const nominalPosition=new Map(nominal.map((row,index)=>[row.carId,index+1]));

  return new Map(provisional.map((row)=>{
    if(!row.forecast)return [row.carId,null];
    const own=row.projectedTimeS;
    const bestTime=own-row.uncertaintyS;
    const worstTime=own+row.uncertaintyS;
    const best=1+active.filter((other)=>other.carId!==row.carId&&other.projectedTimeS<bestTime).length;
    const worst=1+active.filter((other)=>other.carId!==row.carId&&other.projectedTimeS<worstTime).length;
    return [row.carId,{
      ...row.forecast,
      projected_finish_position:nominalPosition.get(row.carId)??null,
      projected_finish_best:Math.min(best,worst),
      projected_finish_worst:Math.max(best,worst),
    }];
  }));
}

function planCar(state,car,forecast){
  if(!car)return car;
  const strategy=car?.resources?.strategy||{};
  const base={
    ...car,
    resources:{
      ...(car?.resources||{}),
      strategy:{
        ...strategy,
        forecast:forecast?{...forecast}:null,
      },
    },
  };

  if(car?.dnf||["dnf","finished"].includes(text(car?.status))||car?.pitState?.active)return base;
  if(text(strategy?.pitPlan)!=="adaptive")return base;

  const window=forecast?.pit_window??null;
  if(!window){
    if(!strategy?.autoPitReason)return base;
    return {
      ...base,
      resources:{
        ...base.resources,
        strategy:{
          ...base.resources.strategy,
          plannedStopLap:null,
          autoPitReason:null,
        },
      },
    };
  }

  const reachable=nextReachablePitLap(state,car);
  if(reachable==null)return base;
  const recommended=clamp(
    Math.round(finite(window?.recommended_lap,reachable)),
    reachable,
    lapLimitFor(state)
  );
  const nextTyreId=forecast?.next_tyre_id??strategy?.nextTyreId??null;

  return {
    ...base,
    resources:{
      ...base.resources,
      strategy:{
        ...base.resources.strategy,
        plannedStopLap:recommended,
        nextTyreId,
        tyreChangeRequested:Boolean(nextTyreId),
        autoPitReason:forecast?.pit_reason??"strategy",
      },
    },
  };
}

export function planCanonicalPitStrategies(state,cars=state?.cars||[]){
  const stateLike={...state,cars};
  const forecasts=buildCanonicalStrategyForecasts(stateLike,cars);
  return (cars||[]).map((car)=>
    planCar(stateLike,car,forecasts.get(String(car?.carId??""))??null)
  );
}
