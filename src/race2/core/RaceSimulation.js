// src/race2/core/RaceSimulation.js
// RW8.2: deterministic fixed-step advancement for the canonical RW2 RaceState.
// RW8.3B layers pace/braking/corner dynamics onto the same fixed-step core.
// RW8.5 adds canonical physical traffic/following.
// RW8.6 adds overtaking/side-by-side battles.
// RW8.7 adds canonical tyres, fuel and temperatures.
// RW8.8 adds canonical pit-lane / pit-stop execution.
// RW8.9 applies canonical race commands before the same physics step.
// RW8.10 resolves canonical incidents, reliability failures, damage and DNF.
// RW8.11A projects canonical weather/track conditions and Race Control assessments.

import { trackSectorAtDistance, wrapTrackDistanceM } from "../track/TrackModel.js";
import { normalizeRaceStepMs } from "./RaceState.js";
import { raceAccelerationForTarget, raceDynamicsForCar } from "./RaceDynamics.js";
import { projectCanonicalRaceTiming } from "./RaceClassification.js";
import { enforceRaceTrafficSpacing, raceTrafficContext } from "./RaceTraffic.js";
import { resolveRaceOvertaking } from "./RaceOvertaking.js";
import { advanceRaceResources } from "./RaceResources.js";
import { advanceRacePitStops } from "./RacePitStops.js";
import { applyDueRaceCommands } from "./RaceCommands.js";
import { resolveRaceIncidents } from "./RaceIncidents.js";
import { advanceRaceConditions } from "./RaceConditions.js";

const finite=(value,fallback=0)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const positive=(value,fallback=0)=>{
  const parsed=finite(value,fallback);
  return parsed>0?parsed:fallback;
};

export function raceStepMs(state){
  return normalizeRaceStepMs(state?.session?.simulation?.stepMs);
}

function lapLimitFor(state){
  const value=Number(state?.session?.lapLimit);
  return Number.isFinite(value)&&value>0?Math.round(value):null;
}

function timeToDistanceS(speedMs,accelerationMs2,distanceM,maxTimeS){
  const speed=Math.max(0,finite(speedMs,0));
  const acceleration=finite(accelerationMs2,0);
  const distance=Math.max(0,finite(distanceM,0));
  const maxTime=Math.max(0,finite(maxTimeS,0));
  if(distance<=0||maxTime<=0)return 0;

  if(Math.abs(acceleration)<1e-9){
    if(speed<=1e-9)return maxTime;
    return Math.min(maxTime,distance/speed);
  }

  const discriminant=speed*speed+2*acceleration*distance;
  if(discriminant<0)return maxTime;
  const root=Math.sqrt(discriminant);
  const candidates=[
    (-speed+root)/acceleration,
    (-speed-root)/acceleration,
  ].filter((value)=>Number.isFinite(value)&&value>=0&&value<=maxTime+1e-9);

  return candidates.length?Math.min(...candidates):maxTime;
}

function advanceCar(state,car,stepMs){
  if(car?.dnf||car?.status==="dnf"||car?.status==="finished")return car;
  if(String(car?.pitState?.status??"track")!=="track")return car;
  const lengthM=positive(state?.track?.lengthM,0);
  if(lengthM<=0)return car;

  const dt=stepMs/1000;
  const dynamics=raceDynamicsForCar(state,car);
  const trafficContext=raceTrafficContext(state,car);
  const speedMs=Math.max(0,finite(car?.speedMs,finite(car?.speedKmh,0)/3.6));
  const freeTargetSpeedKmh=finite(dynamics?.targetSpeedKmh,null);
  const trafficTargetSpeedKmh=trafficContext?.speedCeilingMs==null
    ?null
    :Math.max(0,trafficContext.speedCeilingMs*3.6);
  const trafficLimited=trafficTargetSpeedKmh!=null&&(
    freeTargetSpeedKmh!=null
      ?trafficTargetSpeedKmh<freeTargetSpeedKmh-0.01
      :trafficTargetSpeedKmh<speedMs*3.6-0.01
  );
  const effectiveTargetSpeedKmh=trafficLimited
    ?Math.max(0,Math.min(
      trafficTargetSpeedKmh,
      freeTargetSpeedKmh??trafficTargetSpeedKmh
    ))
    :freeTargetSpeedKmh;
  const acceleration=Math.max(-100,Math.min(100,finite(
    trafficLimited
      ?raceAccelerationForTarget(state,car,effectiveTargetSpeedKmh)
      :dynamics?.accelerationMs2,
    finite(car?.accelerationMs2,0)
  )));
  const unconstrainedNextSpeed=speedMs+acceleration*dt;
  const nextSpeedMs=Math.max(0,unconstrainedNextSpeed);
  const motionTime=acceleration<0&&unconstrainedNextSpeed<0
    ?Math.min(dt,speedMs/Math.max(1e-9,-acceleration))
    :dt;
  const deltaM=acceleration<0&&unconstrainedNextSpeed<0
    ?((speedMs+0)/2)*motionTime
    :((speedMs+nextSpeedMs)/2)*dt;
  const currentAbsolute=finite(car?.absoluteDistanceM,0);
  let nextAbsolute=Number((currentAbsolute+Math.max(0,deltaM)).toFixed(6));

  const lapLimit=lapLimitFor(state);
  const finishDistance=lapLimit==null?null:lapLimit*lengthM;
  const finished=finishDistance!=null&&nextAbsolute>=finishDistance;
  let finishTimeMs=finite(car?.finishTimeMs,null);
  if(finished){
    const remainingDistance=Math.max(0,finishDistance-currentAbsolute);
    const crossingTimeS=timeToDistanceS(speedMs,acceleration,remainingDistance,motionTime);
    finishTimeMs=Number((Math.max(0,finite(state?.simulationTimeMs,0))+crossingTimeS*1000).toFixed(3));
    nextAbsolute=Number(finishDistance.toFixed(6));
  }

  const completedLaps=Math.max(0,Math.floor(nextAbsolute/lengthM));
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
    absoluteDistanceM:nextAbsolute,
    speedMs:Number(nextSpeedMs.toFixed(6)),
    speedKmh:Number((nextSpeedMs*3.6).toFixed(6)),
    accelerationMs2:Number(acceleration.toFixed(6)),
    targetSpeedKmh:Number(finite(
      effectiveTargetSpeedKmh,
      dynamics?.targetSpeedKmh??car?.targetSpeedKmh??0
    ).toFixed(6)),
    traffic:{
      aheadCarId:trafficContext?.aheadCarId??null,
      gapM:trafficContext?.gapM??null,
      hardGapM:trafficContext?.hardGapM??null,
      desiredGapM:trafficContext?.desiredGapM??null,
      followRangeM:trafficContext?.followRangeM??null,
      targetSpeedKmh:trafficLimited?Number(trafficTargetSpeedKmh.toFixed(6)):null,
      limited:trafficLimited,
      hardLimited:false,
    },
    cornerSeverity:Number(finite(dynamics?.cornerSeverity,car?.cornerSeverity||0).toFixed(6)),
    effectiveCornerSeverity:Number(finite(dynamics?.effectiveCornerSeverity,car?.effectiveCornerSeverity||0).toFixed(6)),
    dynamicsLookaheadM:Number(finite(dynamics?.lookaheadM,car?.dynamicsLookaheadM||0).toFixed(6)),
    elapsedMs:finished
      ?finishTimeMs
      :Math.max(0,finite(car?.elapsedMs,0))+stepMs,
    finishTimeMs,
    zoneId:finished?"finish":`sector_${sector}`,
    zoneType:finished?"finish":"sector",
    status:finished?"finished":"running",
  };
}

export function startRaceState(state){
  if(!state||state.status!=="ready")return state;
  const started={
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
  return {...started,...projectCanonicalRaceTiming(started)};
}

export function stepRaceState(state){
  if(!state||state.status!=="running")return state;
  const stepMs=raceStepMs(state);
  const commands=applyDueRaceCommands(state);
  const workingState={
    ...state,
    cars:commands.cars,
    commandQueue:commands.commandQueue,
  };
  const proposedCars=(workingState.cars||[]).map((car)=>advanceCar(workingState,car,stepMs));
  const pits=advanceRacePitStops(workingState,proposedCars,{stepMs});
  const postPitById=new Map((pits.cars||[]).map((car)=>[car?.carId,car]));
  const interactionCars=(workingState.cars||[]).map((previous)=>{
    const postPit=postPitById.get(previous?.carId)??previous;
    const wasTrack=String(previous?.pitState?.status??"track")==="track";
    const isTrack=String(postPit?.pitState?.status??"track")==="track";
    // Cars that remain on track keep their pre-step position as the traffic
    // reference. Pit entries/rejoins use the post-pit state so availability
    // changes are immediate without weakening RW8.5 hard spacing.
    return wasTrack&&isTrack?previous:postPit;
  });
  const interactionState={
    ...workingState,
    cars:interactionCars,
    pitLaneState:pits.pitLaneState,
  };
  const overtaking=resolveRaceOvertaking(interactionState,pits.cars,{stepMs});
  const spacedCars=enforceRaceTrafficSpacing(interactionState,overtaking.cars,{
    stepMs,
    bypassPairs:overtaking.bypassPairs,
  });
  const incidents=resolveRaceIncidents(workingState,spacedCars,overtaking.events,{stepMs});
  const conditions=advanceRaceConditions(
    workingState,
    incidents.cars,
    [...(overtaking.events||[]),...(incidents.events||[])]
  );
  const conditionsState={
    ...workingState,
    cars:incidents.cars,
    trackState:conditions.trackState,
    weatherState:conditions.weatherState,
    raceControlState:conditions.raceControlState,
  };
  const cars=advanceRaceResources(conditionsState,incidents.cars,{stepMs});
  const rawEvents=[
    ...(commands.events||[]),
    ...(pits.events||[]),
    ...(overtaking.events||[]),
    ...(incidents.events||[]),
    ...(conditions.events||[]),
  ];
  const generatedEvents=rawEvents.map((event,index)=>{
    const sequence=Math.max(1,Math.floor(finite(state?.nextEventSequence,1)))+index;
    return {
      id:`${state?.weekendKey??"race"}:${sequence}`,
      sequence,
      ...event,
    };
  });
  const allResolved=cars.length>0&&cars.every((car)=>car?.dnf||car?.status==="dnf"||car?.status==="finished");
  const status=allResolved?"finished":"running";

  const next={
    ...workingState,
    tick:Math.max(0,Math.floor(finite(state?.tick,0)))+1,
    simulationTimeMs:Math.max(0,finite(state?.simulationTimeMs,0))+stepMs,
    status,
    session:{
      ...state.session,
      phase:status==="finished"?"finished":"race",
      weather:conditions.weatherState?.current??state?.session?.weather??null,
      raceControl:conditions.raceControlState,
      clock:{
        ...(state?.session?.clock||{}),
        elapsedMs:Math.max(0,finite(state?.session?.clock?.elapsedMs,0))+stepMs,
      },
    },
    cars,
    trackState:conditions.trackState,
    weatherState:conditions.weatherState,
    raceControlState:conditions.raceControlState,
    pitLaneState:pits.pitLaneState,
    events:[...(state?.events||[]),...generatedEvents],
    nextEventSequence:Math.max(1,Math.floor(finite(state?.nextEventSequence,1)))+generatedEvents.length,
  };
  return {...next,...projectCanonicalRaceTiming(next)};
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
