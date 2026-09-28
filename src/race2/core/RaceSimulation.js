// src/race2/core/RaceSimulation.js
// RW8.2: deterministic fixed-step advancement for the canonical RW2 RaceState.
// Pace, braking, traffic and tyre dynamics are layered on later; this stage
// owns only time progression and continuous kinematics from the current car state.

import { trackSectorAtDistance, wrapTrackDistanceM } from "../track/TrackModel.js";

const finite=(value,fallback=0)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const positive=(value,fallback=0)=>{
  const parsed=finite(value,fallback);
  return parsed>0?parsed:fallback;
};

function stepMsFor(state){
  return Math.max(10,Math.min(1000,Math.round(
    positive(state?.session?.simulation?.stepMs,100)
  )));
}

function lapLimitFor(state){
  const value=Number(state?.session?.lapLimit);
  return Number.isFinite(value)&&value>0?Math.round(value):null;
}

function advanceCar(state,car,stepMs){
  if(car?.dnf||car?.status==="dnf"||car?.status==="finished")return car;
  const lengthM=positive(state?.track?.lengthM,0);
  if(lengthM<=0)return car;

  const dt=stepMs/1000;
  const speedMs=Math.max(0,finite(car?.speedMs,finite(car?.speedKmh,0)/3.6));
  const acceleration=Math.max(-100,Math.min(100,finite(car?.accelerationMs2,0)));
  const nextSpeedMs=Math.max(0,speedMs+acceleration*dt);
  const deltaM=((speedMs+nextSpeedMs)/2)*dt;
  const currentAbsolute=Math.max(0,finite(car?.absoluteDistanceM,0));
  let nextAbsolute=currentAbsolute+Math.max(0,deltaM);

  const lapLimit=lapLimitFor(state);
  const finishDistance=lapLimit==null?null:lapLimit*lengthM;
  const finished=finishDistance!=null&&nextAbsolute>=finishDistance;
  if(finished)nextAbsolute=finishDistance;

  const completedLaps=Math.max(0,Math.floor((nextAbsolute+1e-9)/lengthM));
  const distanceAlongLapM=finished
    ?0
    :wrapTrackDistanceM(state.track,nextAbsolute)??0;
  const lap=finished
    ?lapLimit
    :completedLaps+1;
  const sector=finished
    ?3
    :(trackSectorAtDistance(state.track,distanceAlongLapM)??1);

  return {
    ...car,
    lap,
    completedLaps,
    sector,
    distanceAlongLapM:Number(distanceAlongLapM.toFixed(6)),
    absoluteDistanceM:Number(nextAbsolute.toFixed(6)),
    speedMs:Number(nextSpeedMs.toFixed(6)),
    speedKmh:Number((nextSpeedMs*3.6).toFixed(6)),
    elapsedMs:Math.max(0,finite(car?.elapsedMs,0))+stepMs,
    zoneId:finished?"finish":`sector_${sector}`,
    zoneType:finished?"finish":"sector",
    status:finished?"finished":"running",
  };
}

export function startRaceState(state){
  if(!state||state.status!=="ready")return state;
  return {
    ...state,
    status:"running",
    session:{
      ...state.session,
      phase:"race",
    },
    cars:(state.cars||[]).map((car)=>
      car?.dnf
        ?{...car,status:"dnf"}
        :{...car,status:"running"}
    ),
  };
}

export function stepRaceState(state){
  if(!state||state.status!=="running")return state;
  const stepMs=stepMsFor(state);
  const cars=(state.cars||[]).map((car)=>advanceCar(state,car,stepMs));
  const allResolved=cars.length>0&&cars.every((car)=>car?.dnf||car?.status==="dnf"||car?.status==="finished");
  const status=allResolved?"finished":"running";

  return {
    ...state,
    tick:Math.max(0,Math.floor(finite(state?.tick,0)))+1,
    simulationTimeMs:Math.max(0,finite(state?.simulationTimeMs,0))+stepMs,
    status,
    session:{
      ...state.session,
      phase:status==="finished"?"finished":"race",
      clock:{
        ...(state?.session?.clock||{}),
        elapsedMs:Math.max(0,finite(state?.session?.clock?.elapsedMs,0))+stepMs,
      },
    },
    cars,
  };
}

export function advanceRaceState(state,{steps=1}={}){
  let next=state;
  const count=Math.max(0,Math.floor(Number(steps)||0));
  for(let index=0;index<count;index+=1){
    next=stepRaceState(next);
    if(!next||next.status==="finished")break;
  }
  return next;
}
