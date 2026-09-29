// src/race2/core/RaceControlLifecycle.js
// RW8.11B: canonical Race Control lifecycle and enforcement for RW2.
//
// Assessment remains owned by RaceConditions / shared policy engines.
// Historical mechanisms, Red Flag suspension and restart hysteresis remain
// owned by the existing shared engines. This layer persists the official RW2
// mode and exposes the restrictions consumed by the fixed-step core.

import { hashSeed } from "../../core/random.js";
import { raceControlDurationLaps } from "../../engine/RaceControlEngine.js";
import {
  completeRedFlagRestart,
  createRedFlagSuspension,
  prepareRedFlagRestart,
} from "../../engine/RedFlagLifecycleEngine.js";
import { fastForwardRestartConditions } from "../../engine/RestartHysteresisEngine.js";
import { initialBattleState } from "./RaceOvertaking.js";

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"");
const rank=Object.freeze({GREEN:0,LOCAL_YELLOW:1,VSC:2,SAFETY_CAR:3,RED_FLAG:4});

function deterministicUnit(state,key){
  return hashSeed(`${text(state?.seed)||"rw2"}::rw8.11b::${text(key)}`)/4294967296;
}

function eventDescriptor(type,state,payload={}){
  return {
    type,
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    timeMs:Math.max(0,finite(state?.simulationTimeMs,0)),
    carIds:[],
    driverIds:[],
    payload,
  };
}

function classificationForLifecycle(state,cars){
  const byCar=new Map((state?.classification||[]).map((row)=>[text(row?.carId),row]));
  return (cars||[]).map((car,index)=>{
    const row=byCar.get(text(car?.carId))||{};
    return {
      driver_id:car?.driverId??null,
      team_id:car?.teamId??null,
      position:finite(row?.position,index+1),
      grid_position:finite(car?.gridPosition,index+1),
      laps_completed:finite(car?.completedLaps,0),
      elapsed_ms:finite(car?.elapsedMs,null),
      status:car?.dnf?"DNF":text(car?.status||"RUNNING").toUpperCase(),
      retired:Boolean(car?.dnf),
      tyre:car?.tyre?{
        tyre_id:car.tyre.tyre_id??null,
        compound:car.tyre.compound??null,
        category:car.tyre.category??null,
        condition:finite(car.tyre.condition,null),
        age_laps:finite(car.tyre.age_laps,null),
      }:null,
    };
  });
}

function sharedWeatherRow(state){
  return state?.weatherState?.current||{};
}

function lifecycleEvent(state,from,to,source,extra={}){
  return eventDescriptor("race_control_changed",state,{
    from,
    to,
    source:source??null,
    referenceLap:finite(state?.raceControlState?.referenceLap,1),
    ...extra,
  });
}

export function raceControlPaceMultiplier(mode){
  switch(text(mode).toUpperCase()){
    case "SAFETY_CAR": return 0.58;
    case "VSC": return 0.76;
    default: return 1;
  }
}

export function raceControlOvertakingAllowed(state){
  return text(state?.raceControlState?.mode||"GREEN").toUpperCase()==="GREEN";
}

export function raceControlFreezesProgress(state){
  const control=state?.raceControlState||{};
  return text(control.mode).toUpperCase()==="RED_FLAG"&&
    text(control?.redFlagLifecycle?.phase||"suspended")!=="resumed";
}

export function neutralizeBattles(cars=[]){
  return (cars||[]).map((car)=>({
    ...car,
    lateralOffsetM:0,
    battle:initialBattleState(),
  }));
}

function activateRedFlag(state,control,cars,source){
  const referenceLap=Math.max(1,Math.floor(finite(control?.referenceLap,1)));
  const lifecycle=createRedFlagSuspension({
    year:finite(state?.track?.year,1980),
    rules:control?.rules||{},
    period:{
      cause:source||"race_control",
      from_lap:referenceLap,
      from_sector:1,
      race_control_score:finite(control?.assessment?.score,null),
      race_control_severity:control?.assessment?.severity??null,
      race_control_signals:control?.assessment?.severe_signals||[],
      race_control_factors:control?.assessment?.dominant_factors||control?.assessment?.reason_factors||[],
    },
    classification:classificationForLifecycle(state,cars),
    lap:referenceLap,
    sector:1,
    trackState:sharedWeatherRow(state),
    sequence:finite(control?.sequence,0)+1,
  });
  return {
    control:{
      ...control,
      model:"rw8.11b",
      phase:"enforced",
      mode:"RED_FLAG",
      source:source??control?.source??null,
      activatedTick:Math.max(0,Math.floor(finite(state?.tick,0))),
      activatedReferenceLap:referenceLap,
      minimumReleaseLap:referenceLap,
      sequence:finite(control?.sequence,0)+1,
      redFlagLifecycle:lifecycle,
    },
    events:[lifecycleEvent(state,text(control?.mode||"GREEN").toUpperCase(),"RED_FLAG",source,{
      lifecycle:"suspended",
    })],
  };
}

export function enforceRaceControlAssessment(state,assessedControl,cars){
  const previous=state?.raceControlState||{};
  const control={...previous,...assessedControl,model:"rw8.11b",phase:"enforced"};
  const current=text(previous?.mode||"GREEN").toUpperCase();
  const recommended=text(assessedControl?.recommendedMode||"GREEN").toUpperCase();
  const referenceLap=Math.max(1,Math.floor(finite(assessedControl?.referenceLap,1)));

  if(current==="RED_FLAG"&&previous?.redFlagLifecycle&&
    text(previous.redFlagLifecycle.phase)!=="resumed"){
    return {raceControlState:{...control,mode:"RED_FLAG",redFlagLifecycle:previous.redFlagLifecycle},events:[]};
  }

  if(recommended==="RED_FLAG"&&current!=="RED_FLAG"){
    return activateRedFlag(state,control,cars,assessedControl?.source);
  }

  if((rank[recommended]??0)>(rank[current]??0)||current==="GREEN"){
    if(recommended==="GREEN"){
      if(current==="GREEN")return {raceControlState:{...control,mode:"GREEN"},events:[]};
    }else{
      const duration=raceControlDurationLaps(
        recommended,
        deterministicUnit(state,`duration:${recommended}:${state?.tick}:${referenceLap}`)
      );
      return {
        raceControlState:{
          ...control,
          mode:recommended,
          activatedTick:Math.max(0,Math.floor(finite(state?.tick,0))),
          activatedReferenceLap:referenceLap,
          minimumReleaseLap:referenceLap+Math.max(1,duration),
          sequence:finite(previous?.sequence,0)+1,
          redFlagLifecycle:null,
        },
        events:[lifecycleEvent(state,current,recommended,assessedControl?.source,{durationLaps:duration})],
      };
    }
  }

  if(recommended!=="GREEN"&&(rank[recommended]??0)>=(rank[current]??0)){
    return {raceControlState:{...control,mode:recommended},events:[]};
  }

  const releaseLap=Math.max(1,Math.floor(finite(previous?.minimumReleaseLap,referenceLap)));
  if(referenceLap<releaseLap){
    return {raceControlState:{...control,mode:current},events:[]};
  }

  if(current!=="GREEN"){
    return {
      raceControlState:{
        ...control,
        mode:"GREEN",
        source:null,
        minimumReleaseLap:null,
        redFlagLifecycle:null,
      },
      events:[lifecycleEvent(state,current,"GREEN","clear")],
    };
  }

  return {raceControlState:{...control,mode:"GREEN"},events:[]};
}

export function advanceRedFlagSuspension(state){
  const control=state?.raceControlState||{};
  const lifecycle=control?.redFlagLifecycle;
  if(text(control?.mode).toUpperCase()!=="RED_FLAG"||!lifecycle){
    return {raceControlState:control,events:[],weatherRow:null};
  }
  if(text(lifecycle?.phase)==="resumed"){
    return {raceControlState:{...control,mode:text(lifecycle?.restart_control||"GREEN").toUpperCase()},events:[]};
  }

  const timeline=Array.isArray(state?.weatherState?.timeline)?state.weatherState.timeline:[];
  const currentLap=Math.max(1,Math.floor(finite(control?.referenceLap,state?.trackState?.referenceLap??1)));
  const progressed=fastForwardRestartConditions({
    monitor:lifecycle?.restart_monitor,
    year:finite(state?.track?.year,1980),
    rules:control?.rules||{},
    cause:lifecycle?.cause||"weather",
    timeline,
    currentLap,
  });

  if(!progressed?.authorized){
    return {
      raceControlState:{
        ...control,
        redFlagLifecycle:{...lifecycle,restart_monitor:progressed.monitor},
      },
      events:[],
      weatherRow:null,
    };
  }

  const prepared=prepareRedFlagRestart({
    ...lifecycle,
    restart_monitor:progressed.monitor,
  });
  const resumed=completeRedFlagRestart(prepared,{
    lap:currentLap,
    sector:1,
    restartControl:progressed?.recommended_control||"GREEN",
  });
  const nextMode=text(resumed?.restart_control||"GREEN").toUpperCase();
  return {
    raceControlState:{
      ...control,
      mode:nextMode,
      phase:"enforced",
      source:nextMode==="GREEN"?null:"restart",
      redFlagLifecycle:resumed,
      minimumReleaseLap:nextMode==="GREEN"?null:currentLap,
    },
    events:[lifecycleEvent(state,"RED_FLAG",nextMode,"restart",{
      lifecycle:"resumed",
      checksAdvanced:progressed?.checks_advanced??0,
    })],
    weatherRow:progressed?.observation?.track_state
      ?{...progressed.observation.track_state,lap:currentLap}
      :null,
  };
}
