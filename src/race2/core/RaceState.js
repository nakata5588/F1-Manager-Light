// src/race2/core/RaceState.js
// RW8.2: canonical continuous RaceState for Race Weekend 2.0.

import { cloneRaceContractValue } from "../contracts/raceContracts.js";
import { trackSectorAtDistance, wrapTrackDistanceM } from "../track/TrackModel.js";
import { projectCanonicalRaceTiming } from "./RaceClassification.js";
import { initialGridAbsoluteDistanceM, initialTrafficState } from "./RaceTraffic.js";
import { initialBattleState } from "./RaceOvertaking.js";
import { initialRaceResources } from "./RaceResources.js";
import { initialRacePitState } from "./RacePitStops.js";
import { initialRaceConditions } from "./RaceConditions.js";

export const RACE_STATE_SCHEMA_VERSION=12;
export const DEFAULT_RACE_STEP_MS=100;

const text=(value)=>String(value??"");
const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const positive=(value,fallback=null)=>{
  const parsed=finite(value,null);
  return parsed!=null&&parsed>0?parsed:fallback;
};

export function normalizeRaceStepMs(value=DEFAULT_RACE_STEP_MS){
  return Math.max(10,Math.min(1000,Math.round(
    positive(value,DEFAULT_RACE_STEP_MS)
  )));
}

function driverIdOf(row){
  return text(row?.driverId??row?.driver_id??row?.id)||null;
}

function teamIdOf(row){
  return text(row?.teamId??row?.team_id??row?.constructor_id??row?.team)||null;
}

function gridPositionOf(row,index){
  const explicit=finite(row?.gridPosition??row?.grid_position??row?.grid??row?.position,null);
  return explicit==null?index+1:Math.max(1,Math.round(explicit));
}

function carForGridRow(input,row){
  const driverId=driverIdOf(row);
  const teamId=teamIdOf(row);
  return (input?.cars||[]).find((car)=>
    driverIdOf(car)===driverId&&
    (!teamId||!teamIdOf(car)||teamIdOf(car)===teamId)
  )??null;
}

function driverForGridRow(input,row){
  const driverId=driverIdOf(row);
  return (input?.drivers||[]).find((driver)=>driverIdOf(driver)===driverId)??null;
}

function entryForGridRow(input,row){
  const driverId=driverIdOf(row);
  const teamId=teamIdOf(row);
  return (input?.entries||[]).find((entry)=>
    driverIdOf(entry)===driverId&&
    (!teamId||!teamIdOf(entry)||teamIdOf(entry)===teamId)
  )??null;
}

function initialCarState(input,row,index){
  const car=carForGridRow(input,row);
  const driver=driverForGridRow(input,row);
  const entry=entryForGridRow(input,row);
  const driverId=driverIdOf(row)??driverIdOf(entry)??driverIdOf(car);
  const teamId=teamIdOf(row)??teamIdOf(entry)??teamIdOf(car);
  const carId=text(car?.carId??car?.car_id??entry?.carId??entry?.car_id)||null;
  if(!driverId||!teamId||!carId)return null;

  const gridPosition=gridPositionOf(row,index);
  const resourceState=initialRaceResources(input,car||{},driver||{});
  const absoluteDistanceM=initialGridAbsoluteDistanceM(gridPosition);
  const distanceAlongLapM=wrapTrackDistanceM(input.track,absoluteDistanceM)??0;
  const sector=trackSectorAtDistance(input.track,distanceAlongLapM)??1;
  return {
    carId,
    driverId,
    teamId,
    gridPosition,
    gridStartOffsetM:absoluteDistanceM,
    lap:1,
    completedLaps:0,
    sector,
    distanceAlongLapM:Number(distanceAlongLapM.toFixed(6)),
    absoluteDistanceM:Number(absoluteDistanceM.toFixed(6)),
    speedMs:0,
    speedKmh:0,
    accelerationMs2:0,
    targetSpeedKmh:0,
    cornerSeverity:0,
    effectiveCornerSeverity:0,
    dynamicsLookaheadM:0,
    performance:{
      car:cloneRaceContractValue(car?.performance??null),
      driver:cloneRaceContractValue(driver?.performance??null),
    },
    reliability:cloneRaceContractValue(car?.reliability??null),
    lateralOffsetM:0,
    zoneId:`sector_${sector}`,
    zoneType:"sector",
    elapsedMs:0,
    finishTimeMs:null,
    lapStartedAtMs:0,
    lastLapMs:null,
    bestLapMs:null,
    bestLapNumber:null,
    lapTimes:[],
    status:"ready",
    tyre:cloneRaceContractValue(resourceState.tyre),
    fuelKg:resourceState.fuelKg,
    engineTemperature:resourceState.engineTemperature,
    resources:cloneRaceContractValue(resourceState.resources),
    components:cloneRaceContractValue(car?.state?.componentCondition??{}),
    damage:null,
    retirement:null,
    commands:{},
    pitState:initialRacePitState(),
    traffic:initialTrafficState(),
    battle:initialBattleState(),
    dnf:false,
  };
}

export function createRaceState(input,{stepMs=DEFAULT_RACE_STEP_MS}={}){
  if(!input||typeof input!=="object")throw new TypeError("RaceWeekendInput is required");
  const lengthM=positive(input?.track?.lengthM,null);
  if(lengthM==null)throw new TypeError("RaceWeekendInput.track.lengthM must be a positive number");

  const normalizedStepMs=normalizeRaceStepMs(stepMs);
  const grid=Array.isArray(input?.startingGrid)&&input.startingGrid.length
    ?input.startingGrid
    :(input?.entries||[]);
  const cars=grid
    .map((row,index)=>initialCarState(input,row,index))
    .filter(Boolean)
    .sort((a,b)=>a.gridPosition-b.gridPosition||a.carId.localeCompare(b.carId));

  if(!cars.length)throw new TypeError("RaceWeekendInput must contain at least one entered car");

  const conditions=initialRaceConditions(input);
  const state={
    schemaVersion:RACE_STATE_SCHEMA_VERSION,
    contractVersion:finite(input?.schemaVersion,null),
    engineVersion:input?.engineVersion??null,
    weekendKey:input?.weekendKey??null,
    seed:text(input?.seed)||null,
    tick:0,
    simulationTimeMs:0,
    officialRaceTimeMs:0,
    session:{
      type:"race",
      format:null,
      phase:"grid",
      clock:{elapsedMs:0,officialElapsedMs:0},
      lapLimit:positive(input?.track?.laps,null),
      timeLimit:null,
      activeCars:cars.map((car)=>car.carId),
      weather:cloneRaceContractValue(input?.weather??null),
      raceControl:cloneRaceContractValue(conditions.raceControlState),
      simulation:{stepMs:normalizedStepMs},
    },
    status:"ready",
    track:cloneRaceContractValue(input.track),
    cars,
    classification:[],
    timingState:null,
    trackState:cloneRaceContractValue(conditions.trackState),
    weatherState:cloneRaceContractValue(conditions.weatherState),
    raceControlState:cloneRaceContractValue(conditions.raceControlState),
    commandQueue:[],
    nextCommandSequence:1,
    pitLaneState:{cars:[],boxes:[]},
    events:[],
    nextEventSequence:1,
    rngState:{seed:text(input?.seed)||null,counter:0},
    result:null,
  };
  return {...state,...projectCanonicalRaceTiming(state)};
}
