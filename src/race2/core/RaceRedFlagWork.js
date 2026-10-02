// src/race2/core/RaceRedFlagWork.js
// RW23: work performed while canonical RaceState is suspended by a Red Flag.
//
// Red Flag lifecycle/policy remains shared with the existing historical policy
// engines. This module only mutates canonical car/resource state. It never
// changes classification, race distance, official timing or restart authority.

import {
  RED_FLAG_REPAIR_EFFECTIVENESS,
  repairDamageState,
} from "../../engine/CarDamageEngine.js";
import { RACE_PACE_MODES } from "../../domain/raceTyreModel.js";
import { freshRaceTyre, raceTrackTempC } from "./RaceResources.js";

const PIT_PLANS=new Set(["no_stop","adaptive","one_stop"]);

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"");
const clamp=(value,min,max)=>Math.max(min,Math.min(max,finite(value,min)));

function lifecycleFor(state){
  return state?.raceControlState?.redFlagLifecycle||null;
}

export function canonicalRedFlagWorkWindowOpen(state){
  const lifecycle=lifecycleFor(state);
  return Boolean(
    state?.status==="running"&&
    text(state?.raceControlState?.mode).toUpperCase()==="RED_FLAG"&&
    lifecycle&&
    text(lifecycle?.phase)==="suspended"&&
    lifecycle?.work_locked!==true
  );
}

function carByDriver(state,driverId){
  return (state?.cars||[]).find((car)=>text(car?.driverId)===text(driverId))??null;
}

function replaceCar(state,nextCar){
  return {
    ...state,
    cars:(state?.cars||[]).map((car)=>
      text(car?.carId)===text(nextCar?.carId)?nextCar:car
    ),
  };
}

function ownedActiveCar(state,{driverId,teamId}={}){
  if(!canonicalRedFlagWorkWindowOpen(state))return null;
  const car=carByDriver(state,driverId);
  if(!car||car?.dnf||car?.status==="dnf"||car?.status==="finished")return null;
  if(teamId&&text(car?.teamId)!==text(teamId))return null;
  return car;
}

function tyreOption(car,tyreId){
  const wanted=text(tyreId);
  if(!wanted)return null;
  return (car?.resources?.availableTyres||[])
    .find((row)=>text(row?.tyre_id??row?.id)===wanted)??null;
}

function workSequence(state){
  return Math.max(1,Math.floor(finite(lifecycleFor(state)?.sequence,1)));
}

function workLog(state){
  return Array.isArray(lifecycleFor(state)?.work_log)
    ?lifecycleFor(state).work_log.map((row)=>structuredClone(row))
    :[];
}

function hasWork(state,driverId,type){
  const sequence=workSequence(state);
  return workLog(state).some((row)=>
    text(row?.driver_id)===text(driverId)&&
    text(row?.type)===text(type)&&
    Number(row?.red_flag_sequence)===sequence
  );
}

function replaceLifecycle(state,nextLog){
  return {
    ...state,
    raceControlState:{
      ...(state?.raceControlState||{}),
      redFlagLifecycle:{
        ...(lifecycleFor(state)||{}),
        work_log:nextLog,
      },
    },
  };
}

function appendCanonicalEvent(state,type,car,payload={}){
  const sequence=Math.max(1,Math.floor(finite(state?.nextEventSequence,1)));
  const event={
    id:`${state?.weekendKey??"race"}:${sequence}`,
    sequence,
    type,
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    timeMs:Math.max(0,finite(state?.simulationTimeMs,0)),
    carIds:[car?.carId].filter(Boolean),
    driverIds:[car?.driverId].filter(Boolean),
    payload,
  };
  return {
    ...state,
    events:[...(state?.events||[]),event],
    nextEventSequence:sequence+1,
  };
}

function workEntry(state,car,type,payload={}){
  return {
    type,
    source:payload?.source??"player",
    driver_id:car?.driverId??null,
    team_id:car?.teamId??null,
    red_flag_sequence:workSequence(state),
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    time_ms:Math.max(0,finite(state?.simulationTimeMs,0)),
    ...payload,
  };
}

function withWorkLog(state,entry,{replaceType=false}={}){
  let log=workLog(state);
  if(replaceType){
    log=log.filter((row)=>!(
      text(row?.type)===text(entry?.type)&&
      text(row?.driver_id)===text(entry?.driver_id)&&
      Number(row?.red_flag_sequence)===Number(entry?.red_flag_sequence)
    ));
  }
  return replaceLifecycle(state,[...log,entry]);
}

export function applyCanonicalRedFlagTyreChange(state,{
  driverId,
  teamId=null,
  tyreId,
  source="player",
}={}){
  const car=ownedActiveCar(state,{driverId,teamId});
  const lifecycle=lifecycleFor(state);
  if(!car||lifecycle?.work_policy?.tyre_change!==true)return state;

  const option=tyreOption(car,tyreId);
  if(!option)return state;
  if(text(car?.tyre?.tyre_id)===text(option?.tyre_id)&&finite(car?.tyre?.condition,100)>=99.999){
    return state;
  }

  const before=car?.tyre?structuredClone(car.tyre):null;
  const tyre=freshRaceTyre(option,{
    trackTempC:raceTrackTempC(state),
    tyreManagement:car?.tyre?.tyre_management,
    stintNumber:Math.max(1,Math.floor(finite(car?.tyre?.stint_number,1)))+1,
  });
  let next=replaceCar(state,{
    ...car,
    tyre,
    resources:{
      ...(car?.resources||{}),
      tyreGripMultiplier:1,
      tyreTemperaturePenalty:0,
    },
  });

  const entry=workEntry(state,car,"tyre_change",{
    source,
    tyre_from_id:before?.tyre_id??null,
    tyre_from:before?.compound??null,
    tyre_to_id:tyre?.tyre_id??null,
    tyre_to:tyre?.compound??null,
    free_service:true,
  });
  next=withWorkLog(next,entry,{replaceType:true});
  return appendCanonicalEvent(next,"red_flag_work",car,{
    workType:"tyre_change",
    source,
    tyreFromId:entry.tyre_from_id,
    tyreFrom:entry.tyre_from,
    tyreToId:entry.tyre_to_id,
    tyreTo:entry.tyre_to,
    freeService:true,
  });
}

export function applyCanonicalRedFlagDamageRepair(state,{
  driverId,
  teamId=null,
  source="player",
}={}){
  const car=ownedActiveCar(state,{driverId,teamId});
  const lifecycle=lifecycleFor(state);
  if(!car||lifecycle?.work_policy?.genuine_accident_repair!==true)return state;
  if(hasWork(state,car?.driverId,"damage_repair"))return state;
  if(!(car?.damage?.damaged_components||[]).length)return state;

  const before=structuredClone(car.damage);
  const after=repairDamageState(before,{
    effectiveness:RED_FLAG_REPAIR_EFFECTIVENESS,
    source:"red_flag_repair",
  });
  const repaired=(before?.damaged_components||[]).filter((component)=>
    finite(after?.components?.[component]?.damage_pct,0)<
    finite(before?.components?.[component]?.damage_pct,0)
  );
  if(!repaired.length)return state;

  let next=replaceCar(state,{...car,damage:after});
  const entry=workEntry(state,car,"damage_repair",{
    source,
    repaired_components:repaired,
    damage_before:before,
    damage_after:structuredClone(after),
    pace_loss_before_s_per_lap:finite(before?.pace_loss_s_per_lap,0),
    pace_loss_after_s_per_lap:finite(after?.pace_loss_s_per_lap,0),
    effectiveness:{...RED_FLAG_REPAIR_EFFECTIVENESS},
    free_service:true,
  });
  next=withWorkLog(next,entry,{replaceType:true});
  return appendCanonicalEvent(next,"red_flag_work",car,{
    workType:"damage_repair",
    source,
    repairedComponents:[...repaired],
    paceLossBeforeSPerLap:entry.pace_loss_before_s_per_lap,
    paceLossAfterSPerLap:entry.pace_loss_after_s_per_lap,
    freeService:true,
  });
}

export function applyCanonicalRedFlagRestartStrategy(state,{
  driverId,
  teamId=null,
  paceMode=null,
  pitPlan=null,
  nextTyreId=null,
  plannedStopLap=null,
  source="player",
}={}){
  const car=ownedActiveCar(state,{driverId,teamId});
  if(!car)return state;

  const resources={...(car?.resources||{})};
  const strategy={...(resources?.strategy||{})};
  let changed=false;

  const pace=text(paceMode);
  if(pace&&RACE_PACE_MODES[pace]&&pace!==text(resources?.paceMode)){
    resources.paceMode=pace;
    changed=true;
  }

  const plan=text(pitPlan);
  if(plan&&PIT_PLANS.has(plan)&&plan!==text(strategy?.pitPlan)){
    strategy.pitPlan=plan;
    if(plan==="no_stop"){
      strategy.plannedStopLap=null;
    }else if(plan==="one_stop"&&finite(strategy?.plannedStopLap,null)==null){
      const limit=Math.max(1,Math.floor(finite(state?.session?.lapLimit,state?.track?.laps??1)));
      const currentLap=Math.max(1,Math.floor(finite(car?.lap,1)));
      if(limit>currentLap+1){
        strategy.plannedStopLap=Math.min(
          limit-1,
          currentLap+Math.max(1,Math.ceil((limit-currentLap)/2))
        );
      }
    }
    changed=true;
  }

  if(nextTyreId){
    const option=tyreOption(car,nextTyreId);
    if(option&&text(strategy?.nextTyreId)!==text(option?.tyre_id)){
      strategy.nextTyreId=text(option.tyre_id);
      strategy.tyreChangeRequested=true;
      changed=true;
    }
  }

  if(plannedStopLap!==null&&plannedStopLap!==undefined){
    const limit=Math.max(1,Math.floor(finite(state?.session?.lapLimit,state?.track?.laps??1)));
    const currentLap=Math.max(1,Math.floor(finite(car?.lap,1)));
    const requested=Math.max(currentLap+1,Math.min(limit-1,Math.round(finite(plannedStopLap,currentLap+1))));
    if(limit>1&&requested!==finite(strategy?.plannedStopLap,null)){
      strategy.plannedStopLap=requested;
      changed=true;
    }
  }

  if(!changed)return state;
  resources.strategy=strategy;
  let next=replaceCar(state,{...car,resources});
  const entry=workEntry(state,car,"restart_strategy",{
    source,
    pace_mode:resources.paceMode??null,
    pit_plan:strategy.pitPlan??null,
    next_tyre_id:strategy.nextTyreId??null,
    planned_stop_lap:finite(strategy.plannedStopLap,null),
  });
  next=withWorkLog(next,entry,{replaceType:true});
  return appendCanonicalEvent(next,"red_flag_work",car,{
    workType:"restart_strategy",
    source,
    paceMode:entry.pace_mode,
    pitPlan:entry.pit_plan,
    nextTyreId:entry.next_tyre_id,
    plannedStopLap:entry.planned_stop_lap,
  });
}

function targetTyreCategory(state){
  const wetness=finite(
    state?.weatherState?.track_wetness,
    finite(state?.weatherState?.current?.track_wetness,0)
  );
  if(wetness>=0.72)return "wet";
  if(wetness>=0.20)return "intermediate";
  return "dry";
}

function bestTyre(car,category){
  return (car?.resources?.availableTyres||[])
    .filter((row)=>text(row?.category||"dry")===text(category))
    .slice()
    .sort((a,b)=>
      finite(b?.grip_index,75)-finite(a?.grip_index,75)||
      finite(a?.wear_rate,0.018)-finite(b?.wear_rate,0.018)||
      text(a?.tyre_id).localeCompare(text(b?.tyre_id))
    )[0]??null;
}

export function applyAutomaticCanonicalRedFlagWork(state){
  if(!canonicalRedFlagWorkWindowOpen(state))return state;
  let next=state;
  const policy=lifecycleFor(state)?.work_policy||{};
  const desired=targetTyreCategory(state);

  for(const original of state?.cars||[]){
    if(original?.resources?.strategy?.aiControlled!==true)continue;
    if(original?.dnf||original?.status==="dnf"||original?.status==="finished")continue;

    let car=carByDriver(next,original.driverId);
    if(
      policy?.genuine_accident_repair===true&&
      (car?.damage?.damaged_components||[]).length&&
      finite(car?.damage?.pace_loss_s_per_lap,0)>=0.10
    ){
      next=applyCanonicalRedFlagDamageRepair(next,{
        driverId:car.driverId,
        teamId:car.teamId,
        source:"ai",
      });
      car=carByDriver(next,original.driverId);
    }

    if(policy?.tyre_change!==true)continue;
    const condition=finite(car?.tyre?.condition,100);
    const mismatch=text(car?.tyre?.category||"dry")!==desired;
    const worn=condition<55;
    if(!mismatch&&!worn)continue;
    const option=bestTyre(car,desired)??bestTyre(car,text(car?.tyre?.category||"dry"));
    if(!option)continue;
    next=applyCanonicalRedFlagTyreChange(next,{
      driverId:car.driverId,
      teamId:car.teamId,
      tyreId:option.tyre_id,
      source:"ai",
    });
  }

  return next;
}
