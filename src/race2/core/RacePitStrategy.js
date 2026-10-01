// src/race2/core/RacePitStrategy.js
// RW8.14K1 / RW11D: canonical pit-strategy planner + live strategy forecast.
//
// Strategy owns the decision and forecast. RacePitStops remains execution-only,
// while Race View only projects the canonical fields stored here.

import {
  pitLaneLossMultiplierForRaceControl,
  pitLaneLossSeconds,
  pitRefuelServiceSecondsForYear,
} from "../../domain/racePitModel.js";
import { aiPitRepairDecision } from "../../engine/AIPitRepairEngine.js";
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
  const laneLoss=Math.max(0,pitLaneLossSeconds(state?.track,24))*
    pitLaneLossMultiplierForRaceControl(state?.raceControlState?.mode);
  const crew=car?.resources?.pitCrew||{};
  const service=tyreChange
    ?Math.max(2,finite(crew?.avg_time_s,6.8))
    :0;
  return round(laneLoss+service,3);
}

function repairDecisionFor(state,car,{window=null,nextTyre=null,position=null,fieldSize=20}={}){
  const damage=car?.damage;
  const observed=Array.isArray(damage?.damaged_components)
    ?damage.damaged_components.map(String).filter(Boolean)
    :[];
  if(!damage||!observed.length)return null;

  const strategy=car?.resources?.strategy||{};
  const currentLap=currentLapFor(car);
  const stopLap=window
    ?Math.max(currentLap,Math.round(finite(window?.recommended_lap,currentLap)))
    :currentLap;
  const remainingAtService=Math.max(
    0,
    remainingLapsFor(state,car)-Math.max(0,stopLap-currentLap)
  );
  const crew=car?.resources?.pitCrew||{};
  const crewServiceS=Math.max(2,finite(crew?.avg_time_s,6.8));
  const tyreChange=Boolean(window&&(nextTyre?.tyre_id??strategy?.nextTyreId));
  const refuel=Boolean(
    car?.resources?.refuellingDeferred&&strategy?.refuelRequested
  );
  const year=finite(state?.track?.year,1980);

  return aiPitRepairDecision({
    year,
    damageState:damage,
    remainingLaps:remainingAtService,
    alreadyStopping:Boolean(window),
    tyreChange,
    tyreServiceS:tyreChange?crewServiceS:0,
    refuel,
    fuelServiceS:refuel?pitRefuelServiceSecondsForYear(year):0,
    crewFactor:clamp(crewServiceS/6.8,0.82,1.20),
    pitLaneLossS:pitLaneLossSeconds(state?.track,24),
    controlType:state?.raceControlState?.mode??"GREEN",
    raceIntelligence:finite(car?.performance?.driver?.raceIntelligence,60),
    aggression:finite(car?.performance?.driver?.aggression,50),
    trackOvertakingDifficulty:finite(state?.track?.traits?.overtakingDifficulty,50),
    position,
    fieldSize,
  });
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

    const strategy=car?.resources?.strategy||{};
    const baseWindow=pitWindowFor(stateLike,car);
    const targetCategory=baseWindow?.target_category??text(car?.tyre?.category||"dry");
    const nextTyre=baseWindow?bestAvailableTyre(car,targetCategory):null;
    const position=positionByCar.get(String(car?.carId??""))??null;
    const repairDecision=repairDecisionFor(stateLike,car,{
      window:baseWindow,
      nextTyre,
      position,
      fieldSize:classification.length,
    });
    const repairPlanned=Boolean(
      strategy?.aiControlled!==false&&repairDecision?.should_repair
    );
    const repairOnly=Boolean(
      repairPlanned&&!baseWindow&&repairDecision?.dedicated_stop
    );
    const repairLap=repairOnly?nextReachablePitLap(stateLike,car):null;
    const window=baseWindow??(repairLap==null?null:{
      from_lap:repairLap,
      to_lap:repairLap,
      recommended_lap:repairLap,
      reason:"damage_repair",
      target_category:text(car?.tyre?.category||"dry"),
    });
    const nextTyreId=baseWindow
      ?nextTyre?.tyre_id??strategy?.nextTyreId??null
      :null;
    const tyreChangeRequested=Boolean(baseWindow&&nextTyreId);
    const basePitLossS=expectedPitLossSeconds(
      stateLike,
      car,
      {tyreChange:tyreChangeRequested}
    );
    const repairServiceS=repairPlanned
      ?Math.max(0,finite(repairDecision?.incremental_service_s,0))
      :0;
    const pitLossS=round(basePitLossS+repairServiceS,3);
    const rejoin=rejoinSnapshot(stateLike,car,pitLossS,referenceSpeedMs);
    const confidence=confidencePct(stateLike,car,window);
    const remainingDistance=Math.max(0,finishDistance-finite(car?.absoluteDistanceM,0));
    const paceSpeed=lapPaceSpeedMs(stateLike,car,referenceSpeedMs);
    const fadeCostS=tyreFadeCostSeconds(stateLike,car,window);
    const stopCostS=window?pitLossS:0;
    const repairBenefitS=repairPlanned
      ?Math.max(0,finite(repairDecision?.projected_stay_out_loss_s,0))
      :0;
    const projectedTimeS=Math.max(
      0,
      remainingDistance/paceSpeed+fadeCostS+stopCostS-repairBenefitS
    );
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
        current_position:position,
        pit_window:window?{
          from_lap:window.from_lap,
          to_lap:window.to_lap,
          recommended_lap:window.recommended_lap,
        }:null,
        pit_reason:window?.reason??null,
        next_tyre_id:nextTyreId,
        tyre_change_requested:tyreChangeRequested,
        expected_pit_loss_s:window?pitLossS:null,
        pit_rejoin_position:window?rejoin.position:null,
        pit_rejoin_best:window?rejoin.best:null,
        pit_rejoin_worst:window?rejoin.worst:null,
        pit_rejoin_traffic_count:window?rejoin.trafficCount:null,
        damage_repair:repairDecision?{
          model:repairDecision.model??null,
          should_repair:Boolean(repairDecision.should_repair),
          repair_components:Array.isArray(repairDecision.repair_components)
            ?[...repairDecision.repair_components]
            :[],
          dedicated_stop:Boolean(repairDecision.dedicated_stop),
          reason:repairDecision.reason??null,
          recovered_pace_s_per_lap:finite(repairDecision.recovered_pace_s_per_lap,0),
          projected_stay_out_loss_s:finite(repairDecision.projected_stay_out_loss_s,0),
          incremental_service_s:finite(repairDecision.incremental_service_s,0),
          effective_pit_cost_s:finite(repairDecision.effective_pit_cost_s,0),
          safety_value_s:finite(repairDecision.safety_value_s,0),
          decision_margin_s:finite(repairDecision.decision_margin_s,0),
        }:null,
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

  const pitPlan=text(strategy?.pitPlan);
  const adaptive=pitPlan==="adaptive";
  const aiControlled=strategy?.aiControlled!==false;
  const window=forecast?.pit_window??null;
  const automaticWindow=Boolean(aiControlled&&window);
  const automaticRepair=Boolean(
    aiControlled&&
    forecast?.damage_repair?.should_repair&&
    Array.isArray(forecast?.damage_repair?.repair_components)&&
    forecast.damage_repair.repair_components.length
  );

  // A player pit command is authoritative. The shared strategy engine may
  // expose advice, but must never silently rewrite an explicit player call.
  if(pitPlan==="command")return base;

  // AI plans are starting intentions, not hard locks. Once the canonical
  // forecast identifies a real weather/degradation window, AI cars must be
  // allowed to react even if they began the race as no_stop / one_stop /
  // completed. Player non-adaptive plans remain untouched.
  if(!adaptive&&!automaticWindow&&!automaticRepair)return base;

  if(!window){
    const requestedRepairs=Array.isArray(strategy?.repairComponentsRequested)
      ?strategy.repairComponentsRequested
      :[];
    const hasAutomaticPlan=Boolean(strategy?.autoPitReason)||requestedRepairs.length>0;
    if(!hasAutomaticPlan)return base;
    if(!adaptive&&!aiControlled)return base;
    return {
      ...base,
      resources:{
        ...base.resources,
        strategy:{
          ...base.resources.strategy,
          plannedStopLap:null,
          autoPitReason:null,
          repairComponentsRequested:[],
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
  const tyreChangeRequested=forecast?.tyre_change_requested===undefined
    ?Boolean(forecast?.next_tyre_id??strategy?.nextTyreId)
    :Boolean(forecast.tyre_change_requested);
  const nextTyreId=tyreChangeRequested
    ?forecast?.next_tyre_id??strategy?.nextTyreId??null
    :strategy?.nextTyreId??null;
  const repairComponents=automaticRepair
    ?forecast.damage_repair.repair_components.map(String).filter(Boolean)
    :[];

  return {
    ...base,
    resources:{
      ...base.resources,
      strategy:{
        ...base.resources.strategy,
        plannedStopLap:recommended,
        nextTyreId,
        tyreChangeRequested,
        repairComponentsRequested:repairComponents,
        autoPitReason:adaptive||automaticWindow||forecast?.pit_reason==="damage_repair"
          ?forecast?.pit_reason??"strategy"
          :strategy?.autoPitReason??null,
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
