// src/race2/core/RacePitStops.js
// RW8.8: canonical pit-lane / pit-stop lifecycle for RW2.
//
// Strategy already decides the planned stop lap and next tyre. This module owns
// execution only: entry, pit-lane timing, box queue, service, exit and rejoin.

import { hashSeed } from "../../core/random.js";
import { buildPitServiceSchedule } from "../../engine/PitServiceEngine.js";
import {
  normalisePitPhaseDurations,
  pitLaneProgressForPhase,
  pitLaneLossMultiplierForRaceControl,
  pitLaneLossSeconds,
  pitRefuelServiceSecondsForYear,
} from "../../domain/racePitModel.js";
import { trackSectorAtDistance } from "../track/TrackModel.js";
import { freshRaceTyre, raceTrackTempC } from "./RaceResources.js";
import { initialBattleState } from "./RaceOvertaking.js";
import { initialTrafficState } from "./RaceTraffic.js";

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,finite(value,min)));
const round=(value,digits=6)=>{
  const parsed=finite(value,null);
  return parsed==null?null:Number(parsed.toFixed(digits));
};

export function initialRacePitState(){
  return {
    status:"track",
    active:false,
    completed:false,
    stopSequence:0,
    plannedStopLap:null,
    entryAbsoluteM:null,
    boxAbsoluteM:null,
    exitAbsoluteM:null,
    phase:null,
    phaseIndex:null,
    phaseElapsedMs:0,
    phaseTotalMs:0,
    lossElapsedMs:0,
    lossTotalMs:0,
    queueElapsedMs:0,
    serviceApplied:false,
    serviceAppliedThisStep:false,
    service:null,
    history:[],
  };
}

function unit(state,key){
  return hashSeed(`${state?.seed??"rw2"}::rw8.8::${key}`)/4294967296;
}

function carById(cars,id){
  return (cars||[]).find((row)=>String(row?.carId??"")===String(id??""))??null;
}

function setCar(cars,next){
  const index=(cars||[]).findIndex((row)=>String(row?.carId??"")===String(next?.carId??""));
  if(index<0)return cars;
  const out=[...cars];
  out[index]=next;
  return out;
}

function plannedStopLap(car){
  const value=finite(car?.resources?.strategy?.plannedStopLap,null);
  return value==null?null:Math.max(1,Math.round(value));
}

function stopEntryAbsoluteM(state,car){
  const lap=plannedStopLap(car);
  const length=Math.max(1,finite(state?.track?.lengthM,1));
  if(lap==null)return null;
  const entry=finite(state?.track?.pitLane?.entryM,null);
  return entry==null
    ?lap*length
    :(lap-1)*length+entry;
}

function stopExitAbsoluteM(state,car){
  const lap=plannedStopLap(car);
  const length=Math.max(1,finite(state?.track?.lengthM,1));
  if(lap==null)return null;
  const entry=finite(state?.track?.pitLane?.entryM,null);
  const exit=finite(state?.track?.pitLane?.exitM,null);
  const entryAbs=stopEntryAbsoluteM(state,car);
  if(exit==null||entryAbs==null)return entryAbs;
  if(entry==null)return lap*length+exit;
  return exit<=entry
    ?lap*length+exit
    :(lap-1)*length+exit;
}

function fuelRequiredToFinishKg(state,car,fromAbsoluteM){
  const length=Math.max(1,finite(state?.track?.lengthM,1));
  const laps=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));
  const finishDistance=length*laps;
  const remainingKm=Math.max(0,finishDistance-finite(fromAbsoluteM,0))/1000;
  const burn=Math.max(0,finite(car?.resources?.fuelBurnKgPerKm,0));
  const reserve=Math.max(0,finite(car?.resources?.fuelReserveKg,1.5));
  const power=clamp(finite(car?.performance?.car?.power,70),0,100);
  const worstNormalPowerMult=0.95+(power/100)*0.10;
  return remainingKm*burn*1.04*worstNormalPowerMult+reserve;
}

function tyreOption(car,id){
  const options=Array.isArray(car?.resources?.availableTyres)
    ?car.resources.availableTyres
    :[];
  return options.find((row)=>String(row?.tyre_id??"")===String(id??""))??null;
}

function raceLineTransitSeconds(state,car,entryAbsoluteM,exitAbsoluteM){
  const distanceM=Math.max(0,finite(exitAbsoluteM,entryAbsoluteM)-finite(entryAbsoluteM,0));
  if(distanceM<=0)return 0;
  const speedFromTarget=finite(car?.targetSpeedKmh,null);
  const referenceSpeedMs=Math.max(
    20,
    finite(car?.speedMs,0),
    speedFromTarget==null?0:speedFromTarget/3.6
  );
  return distanceM/referenceSpeedMs;
}

function physicalPitPhases(lossPhases,trackTransitS){
  const phases=(lossPhases||[]).map((row)=>({...row}));
  const transitMs=Math.max(0,Math.round(finite(trackTransitS,0)*1000));
  if(transitMs<=0)return phases;

  const moving=new Set(["pit_entry","pit_lane","pit_exit","rejoin"]);
  const movingWeight=phases
    .filter((row)=>moving.has(String(row?.phase||"")))
    .reduce((sum,row)=>sum+Math.max(0,finite(row?.duration_ms,0)),0);

  let allocated=0;
  let lastMoving=-1;
  for(let index=0;index<phases.length;index+=1){
    if(!moving.has(String(phases[index]?.phase||"")))continue;
    lastMoving=index;
    const weight=Math.max(0,finite(phases[index]?.duration_ms,0));
    const extra=movingWeight>0
      ?Math.floor(transitMs*weight/movingWeight)
      :0;
    phases[index]={
      ...phases[index],
      duration_ms:Math.max(0,Math.round(finite(phases[index]?.duration_ms,0)))+extra,
    };
    allocated+=extra;
  }

  if(lastMoving<0){
    const laneIndex=phases.findIndex((row)=>String(row?.phase||"")==="pit_lane");
    if(laneIndex>=0){
      phases[laneIndex]={
        ...phases[laneIndex],
        duration_ms:Math.max(0,Math.round(finite(phases[laneIndex]?.duration_ms,0)))+transitMs,
      };
    }
    return phases;
  }

  const remainder=transitMs-allocated;
  if(remainder>0){
    phases[lastMoving]={
      ...phases[lastMoving],
      duration_ms:Math.max(0,Math.round(finite(phases[lastMoving]?.duration_ms,0)))+remainder,
    };
  }
  return phases;
}

function servicePlan(state,car,entryAbsoluteM,exitAbsoluteM){
  const strategy=car?.resources?.strategy||{};
  const nextTyreId=strategy?.nextTyreId??null;
  const tyreChoice=tyreOption(car,nextTyreId);
  // A fresh set of the same compound is still a tyre change. The tyre id is
  // the compound/spec identifier, not a unique physical set identifier.
  const tyreChange=Boolean(tyreChoice&&strategy?.tyreChangeRequested!==false);
  const crew=car?.resources?.pitCrew||{};
  const baseCrewServiceS=Math.max(2,finite(crew?.avg_time_s,6.8));
  const expectedTyreS=tyreChange?baseCrewServiceS:0;
  const variation=Math.max(0,finite(crew?.execution_variance_s,0.5));
  const sequence=Math.max(1,Math.floor(finite(car?.pitState?.stopSequence,0))+1);
  const key=`${state?.tick}:${car?.carId}:${sequence}`;
  const serviceVariation=(unit(state,`service-a:${key}`)+unit(state,`service-b:${key}`)-1)*variation;
  const tyreServiceS=tyreChange?Math.max(2,expectedTyreS+serviceVariation):0;

  const refuelRequested=strategy?.refuelRequested===undefined
    ?Boolean(car?.resources?.fuelStintPlanned)
    :Boolean(strategy.refuelRequested);
  const refuellingAllowed=Boolean(car?.resources?.refuellingDeferred&&refuelRequested);
  const targetFuel=refuellingAllowed
    ?fuelRequiredToFinishKg(state,car,entryAbsoluteM)
    :finite(car?.fuelKg,0);
  const fuelAddedKg=refuellingAllowed
    ?Math.max(0,targetFuel-finite(car?.fuelKg,0))
    :0;
  const refuel=fuelAddedKg>0.01;
  const refuelServiceS=refuel?pitRefuelServiceSecondsForYear(state?.track?.year):0;
  const repairComponents=Array.isArray(strategy?.repairComponentsRequested)
    ?strategy.repairComponentsRequested.map(String).filter(Boolean)
    :[];
  const crewFactor=clamp(baseCrewServiceS/6.8,0.82,1.20);
  const serviceSchedule=buildPitServiceSchedule({
    year:finite(state?.track?.year,1980),
    tyreChange,
    tyreServiceS,
    refuel,
    fuelServiceS:refuelServiceS,
    damageState:car?.damage,
    repairComponents,
    crewFactor,
  });

  const errorChance=clamp(
    finite(crew?.effective_error_chance,crew?.error_rate??0.05),
    0.005,
    0.35
  );
  const errorRoll=unit(state,`error:${key}`);
  const error=errorRoll<errorChance;
  const errorDelayS=error?3+unit(state,`error-delay:${key}`)*8:0;
  const stationaryS=Math.max(0,finite(serviceSchedule?.total_stationary_s,0))+errorDelayS;
  const laneLossS=pitLaneLossSeconds(state?.track,24)*
    pitLaneLossMultiplierForRaceControl(state?.raceControlState?.mode);
  const trackTransitS=raceLineTransitSeconds(state,car,entryAbsoluteM,exitAbsoluteM);
  const stop={
    lap:plannedStopLap(car),
    reason:strategy?.autoPitReason??(strategy?.pitPlan==="command"?"player_call":strategy?.pitPlan==="one_stop"?"planned":null),
    tyre_from:car?.tyre?.tyre_id??null,
    tyre_to:tyreChange?tyreChoice?.tyre_id??null:car?.tyre?.tyre_id??null,
    tyre_changed:tyreChange,
    refuelled:refuel,
    fuel_added_kg:round(fuelAddedKg,6),
    fuel_target_kg:round(targetFuel,6),
    expected_stationary_s:round(finite(serviceSchedule?.total_stationary_s,0),3),
    stationary_s:round(stationaryS,3),
    tasks:(serviceSchedule?.tasks||[]).map((task)=>({...task})),
    repair:serviceSchedule?.repair?structuredClone(serviceSchedule.repair):null,
    crew_error:error,
    crew_error_delay_s:round(errorDelayS,3),
    pit_lane_loss_s:round(laneLossS,3),
    track_transit_s:round(trackTransitS,3),
    total_loss_s:round(laneLossS+stationaryS,3),
  };
  const lossPhases=normalisePitPhaseDurations(stop);
  return {
    stop,
    phases:physicalPitPhases(lossPhases,trackTransitS),
    tyreChoice,
  };
}

function firstPositivePhase(phases){
  const index=Math.max(0,(phases||[]).findIndex((row)=>finite(row?.duration_ms,0)>0));
  return {index,phase:phases?.[index]??{phase:"pit_entry",duration_ms:0}};
}

function beginPitStop(state,previous,proposed){
  const entryAbsoluteM=stopEntryAbsoluteM(state,previous);
  if(entryAbsoluteM==null)return proposed;
  const exitAbsoluteM=Math.max(entryAbsoluteM,finite(stopExitAbsoluteM(state,previous),entryAbsoluteM));
  const {stop,phases,tyreChoice}=servicePlan(
    state,
    previous,
    entryAbsoluteM,
    exitAbsoluteM
  );
  const first=firstPositivePhase(phases);
  const boxAbsoluteM=entryAbsoluteM+(exitAbsoluteM-entryAbsoluteM)*0.52;
  const sequence=Math.max(1,Math.floor(finite(previous?.pitState?.stopSequence,0))+1);

  return {
    ...proposed,
    absoluteDistanceM:round(entryAbsoluteM,6),
    distanceAlongLapM:round(((entryAbsoluteM%state.track.lengthM)+state.track.lengthM)%state.track.lengthM,6),
    speedMs:0,
    speedKmh:0,
    accelerationMs2:0,
    lateralOffsetM:0,
    traffic:initialTrafficState(),
    battle:initialBattleState(),
    zoneId:first.phase.phase,
    zoneType:"pit",
    pitState:{
      ...initialRacePitState(),
      status:first.phase.phase,
      active:true,
      completed:false,
      stopSequence:sequence,
      plannedStopLap:plannedStopLap(previous),
      entryAbsoluteM:round(entryAbsoluteM,6),
      boxAbsoluteM:round(boxAbsoluteM,6),
      exitAbsoluteM:round(exitAbsoluteM,6),
      phase:first.phase.phase,
      phaseIndex:first.index,
      phaseElapsedMs:0,
      phaseTotalMs:Math.max(0,Math.round(finite(first.phase.duration_ms,0))),
      lossElapsedMs:0,
      lossTotalMs:Math.max(0,Math.round(stop.total_loss_s*1000)),
      queueElapsedMs:0,
      serviceApplied:false,
      serviceAppliedThisStep:false,
      service:{
        ...stop,
        phases,
        tyreChoice:tyreChoice?{...tyreChoice}:null,
      },
      history:Array.isArray(previous?.pitState?.history)
        ?previous.pitState.history.map((row)=>({...row}))
        :[],
    },
  };
}

function pitAbsoluteDistance(pit){
  const entry=finite(pit?.entryAbsoluteM,0);
  const exit=finite(pit?.exitAbsoluteM,entry);
  const progress=pitLaneProgressForPhase(pit,{boxProgress:0.52});
  if(progress==null)return entry;
  return entry+(exit-entry)*progress;
}

function applyService(state,car,pit){
  if(pit?.serviceApplied)return {car,pit};
  const service=pit?.service||{};
  const option=service?.tyreChoice||null;
  const nextTyre=service?.tyre_changed&&option
    ?freshRaceTyre(option,{
      trackTempC:raceTrackTempC(state),
      tyreManagement:car?.tyre?.tyre_management,
      stintNumber:Math.max(1,finite(car?.tyre?.stint_number,1)+1),
    })
    :car?.tyre;
  const nextFuel=service?.refuelled
    ?Math.max(finite(car?.fuelKg,0),finite(service?.fuel_target_kg,car?.fuelKg??0))
    :car?.fuelKg;
  const repairedComponents=Array.isArray(service?.repair?.repaired_components)
    ?service.repair.repaired_components
    :[];
  const repairedDamage=repairedComponents.length
    ?structuredClone(service?.repair?.damage_after||car?.damage)
    :car?.damage;
  return {
    car:{
      ...car,
      tyre:nextTyre,
      fuelKg:round(nextFuel,6),
      damage:repairedComponents.length&&!(repairedDamage?.damaged_components||[]).length
        ?null
        :repairedDamage,
    },
    pit:{
      ...pit,
      serviceApplied:true,
      serviceAppliedThisStep:true,
    },
  };
}

function phaseIsBoxOccupying(phase){
  return ["pit_box","pit_release"].includes(String(phase||""));
}

function advanceActivePit(state,car,stepMs,{boxOccupied=false}={}){
  let pit={
    ...(car?.pitState||initialRacePitState()),
    service:{...(car?.pitState?.service||{})},
    serviceAppliedThisStep:false,
  };
  let next={...car,pitState:pit};
  let remaining=Math.max(0,Math.round(finite(stepMs,100)));
  const phases=pit?.service?.phases||[];

  while(remaining>0&&pit.active){
    const phase=String(pit.phase||"");
    if(phase==="pit_queue"&&boxOccupied){
      pit={
        ...pit,
        phaseElapsedMs:finite(pit.phaseElapsedMs,0)+remaining,
        queueElapsedMs:finite(pit.queueElapsedMs,0)+remaining,
        lossElapsedMs:finite(pit.lossElapsedMs,0)+remaining,
        lossTotalMs:finite(pit.lossTotalMs,0)+remaining,
      };
      remaining=0;
      break;
    }

    let index=Math.max(0,Math.floor(finite(pit.phaseIndex,0)));
    const row=phases[index];
    if(!row){
      pit={...pit,active:false,completed:true,status:"track",phase:"completed"};
      break;
    }
    const duration=Math.max(0,Math.round(finite(row.duration_ms,0)));
    const elapsed=Math.max(0,finite(pit.phaseElapsedMs,0));
    const room=Math.max(0,duration-elapsed);

    if(room<=0){
      const leavingBox=row.phase==="pit_box";
      index+=1;
      const nextRow=phases[index];
      if(leavingBox&&!pit.serviceApplied){
        const applied=applyService(state,next,pit);
        next=applied.car;
        pit=applied.pit;
      }
      if(!nextRow){
        pit={...pit,active:false,completed:true,status:"track",phase:"completed",phaseIndex:phases.length,phaseElapsedMs:0,phaseTotalMs:0};
        break;
      }
      if(nextRow.phase==="pit_queue"&&!boxOccupied){
        index+=1;
      }
      const actual=phases[index];
      pit={
        ...pit,
        phaseIndex:index,
        phase:actual?.phase??"completed",
        status:actual?.phase??"track",
        phaseElapsedMs:0,
        phaseTotalMs:Math.max(0,Math.round(finite(actual?.duration_ms,0))),
      };
      continue;
    }

    const consumed=Math.min(room,remaining);
    const phaseLoss=Math.max(0,finite(row?.loss_ms,duration));
    const lossBefore=duration>0
      ?phaseLoss*clamp(elapsed/duration,0,1)
      :phaseLoss;
    const lossAfter=duration>0
      ?phaseLoss*clamp((elapsed+consumed)/duration,0,1)
      :phaseLoss;
    const consumedLoss=Math.max(0,lossAfter-lossBefore);
    pit={
      ...pit,
      phaseElapsedMs:elapsed+consumed,
      lossElapsedMs:Math.min(
        finite(pit.lossTotalMs,0),
        finite(pit.lossElapsedMs,0)+consumedLoss
      ),
    };
    remaining-=consumed;
  }

  const absolute=pitAbsoluteDistance(pit);
  const previousAbsolute=finite(car?.absoluteDistanceM,absolute);
  const dt=Math.max(0.001,finite(stepMs,100)/1000);
  const speed=Math.max(0,(absolute-previousAbsolute)/dt);
  const length=Math.max(1,finite(state?.track?.lengthM,1));
  const completedLaps=Math.max(0,Math.floor(absolute/length));
  const distanceAlong=((absolute%length)+length)%length;
  const sector=trackSectorAtDistance(state?.track,distanceAlong)??1;

  if(pit.completed){
    const record={
      stopSequence:pit.stopSequence,
      lap:pit.plannedStopLap,
      reason:pit?.service?.reason??null,
      tyreFrom:pit?.service?.tyre_from??null,
      tyreTo:pit?.service?.tyre_to??null,
      tyreChanged:Boolean(pit?.service?.tyre_changed),
      refuelled:Boolean(pit?.service?.refuelled),
      fuelAddedKg:finite(pit?.service?.fuel_added_kg,0),
      repairedComponents:Array.isArray(pit?.service?.repair?.repaired_components)
        ?[...pit.service.repair.repaired_components]
        :[],
      repairDurationS:finite(pit?.service?.repair?.duration_s,0),
      stationaryMs:Math.max(0,Math.round(finite(pit?.service?.stationary_s,0)*1000)),
      pitLaneLossMs:Math.max(0,Math.round(finite(pit?.service?.pit_lane_loss_s,0)*1000)),
      queueDelayMs:Math.max(0,Math.round(finite(pit?.queueElapsedMs,0))),
      crewErrorDelayMs:Math.max(0,Math.round(finite(pit?.service?.crew_error_delay_s,0)*1000)),
      doubleStack:finite(pit?.queueElapsedMs,0)>0,
      lossMs:finite(pit?.lossElapsedMs,pit?.lossTotalMs??0),
    };
    pit={
      ...pit,
      status:"track",
      active:false,
      completed:true,
      history:[...(pit.history||[]),record],
    };
    const activePlan=String(next?.resources?.strategy?.pitPlan||"");
    next={
      ...next,
      resources:{
        ...(next?.resources||{}),
        strategy:{
          ...(next?.resources?.strategy||{}),
          plannedStopLap:null,
          pitPlan:activePlan==="adaptive"?"adaptive":"completed",
          autoPitReason:null,
          tyreChangeRequested:true,
          refuelRequested:false,
          repairComponentsRequested:[],
        },
      },
    };
  }

  return {
    ...next,
    absoluteDistanceM:round(absolute,6),
    distanceAlongLapM:round(distanceAlong,6),
    completedLaps,
    lap:completedLaps+1,
    sector,
    speedMs:round(speed,6),
    speedKmh:round(speed*3.6,6),
    accelerationMs2:0,
    lateralOffsetM:0,
    traffic:initialTrafficState(),
    battle:initialBattleState(),
    zoneId:pit.completed?`sector_${sector}`:pit.phase,
    zoneType:pit.completed?"sector":"pit",
    pitState:pit,
  };
}

function pitTriggerCrossed(state,previous,proposed){
  const entry=stopEntryAbsoluteM(state,previous);
  if(entry==null)return false;
  if(previous?.pitState?.active)return false;
  if(plannedStopLap(previous)==null)return false;
  const from=finite(previous?.absoluteDistanceM,0);
  const to=finite(proposed?.absoluteDistanceM,from);
  return from<entry&&to>=entry;
}

function activeBoxTeams(cars){
  return new Set(
    (cars||[])
      .filter((row)=>row?.pitState?.active&&phaseIsBoxOccupying(row?.pitState?.phase))
      .map((row)=>String(row?.teamId??""))
      .filter(Boolean)
  );
}

function event(type,state,car,payload={}){
  return {
    type,
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    timeMs:Math.max(0,finite(state?.simulationTimeMs,0)),
    carIds:[car?.carId].filter(Boolean),
    driverIds:[car?.driverId].filter(Boolean),
    payload,
  };
}

export function advanceRacePitStops(state,proposedCars,{stepMs=100}={}){
  let cars=(proposedCars||[]).map((row)=>({...row}));
  const events=[];
  const boxes=activeBoxTeams(state?.cars||[]);

  const ordered=[...(state?.cars||[])].sort((a,b)=>
    finite(a?.absoluteDistanceM,0)-finite(b?.absoluteDistanceM,0)||
    String(a?.carId??"").localeCompare(String(b?.carId??""))
  );

  for(const previous of ordered){
    let proposed=carById(cars,previous?.carId);
    if(!proposed)continue;

    if(previous?.pitState?.active){
      const team=String(previous?.teamId??"");
      const ownOccupying=phaseIsBoxOccupying(previous?.pitState?.phase);
      const boxOccupied=Boolean(team&&boxes.has(team)&&!ownOccupying);
      const beforePhase=previous?.pitState?.phase;
      const beforeService=Boolean(previous?.pitState?.serviceApplied);
      proposed=advanceActivePit(state,previous,stepMs,{boxOccupied});
      cars=setCar(cars,proposed);
      if(phaseIsBoxOccupying(proposed?.pitState?.phase)&&team)boxes.add(team);
      if(ownOccupying&&!phaseIsBoxOccupying(proposed?.pitState?.phase)&&team)boxes.delete(team);

      if(!beforeService&&proposed?.pitState?.serviceApplied){
        events.push(event("pit_service_completed",state,proposed,{
          stopSequence:proposed.pitState.stopSequence,
          reason:proposed?.pitState?.service?.reason??null,
          tyreFrom:proposed?.pitState?.service?.tyre_from??null,
          tyreTo:proposed?.pitState?.service?.tyre_to??null,
          tyreChanged:Boolean(proposed?.pitState?.service?.tyre_changed),
          refuelled:Boolean(proposed?.pitState?.service?.refuelled),
          fuelAddedKg:finite(proposed?.pitState?.service?.fuel_added_kg,0),
          repairedComponents:Array.isArray(proposed?.pitState?.service?.repair?.repaired_components)
            ?[...proposed.pitState.service.repair.repaired_components]
            :[],
          repairDurationS:finite(proposed?.pitState?.service?.repair?.duration_s,0),
          paceLossBeforeSPerLap:finite(proposed?.pitState?.service?.repair?.pace_loss_before_s_per_lap,null),
          paceLossAfterSPerLap:finite(proposed?.pitState?.service?.repair?.pace_loss_after_s_per_lap,null),
          stationaryMs:Math.max(0,Math.round(finite(proposed?.pitState?.service?.stationary_s,0)*1000)),
          pitLaneLossMs:Math.max(0,Math.round(finite(proposed?.pitState?.service?.pit_lane_loss_s,0)*1000)),
          queueDelayMs:Math.max(0,Math.round(finite(proposed?.pitState?.queueElapsedMs,0))),
          crewErrorDelayMs:Math.max(0,Math.round(finite(proposed?.pitState?.service?.crew_error_delay_s,0)*1000)),
          doubleStack:finite(proposed?.pitState?.queueElapsedMs,0)>0,
          crewError:Boolean(proposed?.pitState?.service?.crew_error),
        }));
      }
      if(beforePhase!=="completed"&&proposed?.pitState?.completed){
        events.push(event("pit_exit",state,proposed,{
          stopSequence:proposed.pitState.stopSequence,
          lossMs:proposed.pitState.lossElapsedMs,
          stationaryMs:Math.max(0,Math.round(finite(proposed?.pitState?.service?.stationary_s,0)*1000)),
          pitLaneLossMs:Math.max(0,Math.round(finite(proposed?.pitState?.service?.pit_lane_loss_s,0)*1000)),
          queueDelayMs:Math.max(0,Math.round(finite(proposed?.pitState?.queueElapsedMs,0))),
          crewErrorDelayMs:Math.max(0,Math.round(finite(proposed?.pitState?.service?.crew_error_delay_s,0)*1000)),
          doubleStack:finite(proposed?.pitState?.queueElapsedMs,0)>0,
          crewError:Boolean(proposed?.pitState?.service?.crew_error),
        }));
      }
      continue;
    }

    if(pitTriggerCrossed(state,previous,proposed)){
      proposed=beginPitStop(state,previous,proposed);
      cars=setCar(cars,proposed);
      events.push(event("pit_entry",state,proposed,{
        stopSequence:proposed.pitState.stopSequence,
        plannedStopLap:proposed.pitState.plannedStopLap,
        reason:proposed?.pitState?.service?.reason??null,
        tyreTo:proposed?.pitState?.service?.tyre_to??null,
      }));
    }
  }

  const active=cars
    .filter((row)=>row?.pitState?.active)
    .map((row)=>row.carId);

  return {
    cars,
    events,
    pitLaneState:{
      cars:active,
      boxes:[...new Set(
        cars
          .filter((row)=>row?.pitState?.active&&phaseIsBoxOccupying(row?.pitState?.phase))
          .map((row)=>String(row?.teamId??""))
          .filter(Boolean)
      )].sort(),
    },
  };
}
