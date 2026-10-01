import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { advanceRaceState, startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import {
  advanceRaceResources,
  fuelBurnKgPerKmForYear,
  raceResourcePerformance,
} from "../src/race2/core/RaceResources.js";
import { raceTargetSpeedProfile } from "../src/race2/core/RaceDynamics.js";
import { createLiveRaceRunner, runFastRace } from "../src/race2/core/RaceRunner.js";
import {
  tyreConditionEffects as sharedTyreConditionEffects,
} from "../src/domain/raceTyreModel.js";
import {
  tyreConditionEffects as strategyTyreConditionEffects,
} from "../src/engine/RaceStrategyEngine.js";

function tyre(id,compound,grip,wear,warmup=2.5){
  return {
    tyre_id:id,
    supplier:"Test",
    compound_name:compound,
    category:"dry",
    grip_index:grip,
    wear_rate:wear,
    warmup_time_s:warmup,
  };
}

function input({
  year=1980,
  cars=1,
  paceMode="balanced",
  tyreManagement=60,
  refuellingAllowed=false,
}={}){
  const entries=Array.from({length:cars},(_,index)=>({
    driverId:`D${index+1}`,
    teamId:`T${index+1}`,
    carId:`C${index+1}`,
    status:"confirmed",
  }));
  const tyres=[
    tyre("test_h","Hard",74,0.015,2.8),
    tyre("test_s","Soft",82,0.022,2.2),
  ];
  return {
    schemaVersion:8,
    engineVersion:"rw2",
    weekendKey:"rw8.7-resources",
    seed:"rw8.7-resources",
    year,
    entries,
    drivers:entries.map((entry,index)=>({
      driverId:entry.driverId,
      teamId:entry.teamId,
      ratings:{},
      performance:{
        raceScore:82-index,
        conditionModifier:0,
        overtaking:75,
        defending:75,
        mistakePropensity:20,
        aggression:50,
        tyreManagement:index===0?tyreManagement:60,
      },
    })),
    cars:entries.map((entry,index)=>({
      carId:entry.carId,
      driverId:entry.driverId,
      teamId:entry.teamId,
      state:{componentCondition:{engine:100}},
      resourceSetup:{
        strategy:{
          startTyreId:index===0?"test_s":"test_h",
          nextTyreId:index===0?"test_h":"test_s",
          paceMode,
          fuelPlan:"balanced",
          pitPlan:"no_stop",
          plannedStopLap:null,
        },
        tyres,
      },
      performance:{
        overall:82,
        qualifying:82,
        race:82,
        reliability:84,
        chassis:82,
        power:82,
      },
    })),
    rules:{
      race:{refuelling_allowed:refuellingAllowed},
    },
    startingGrid:entries.map((entry,index)=>({
      grid:index+1,
      driver_id:entry.driverId,
      team_id:entry.teamId,
    })),
    weather:{
      state:"SUNNY",
      avg_temp_c:22,
      track_temp_c:34,
    },
    track:{
      schemaVersion:2,
      trackId:"resource-test",
      year,
      lengthM:5000,
      laps:20,
      traits:{tyreWear:60},
      startFinish:{progress:0,distanceM:0},
      sectors:[
        {id:"sector_1",sector:1,startM:0,endM:1666,lengthM:1666},
        {id:"sector_2",sector:2,startM:1666,endM:3333,lengthM:1667},
        {id:"sector_3",sector:3,startM:3333,endM:5000,lengthM:1667},
      ],
      speedProfile:{
        source:"neutral",
        detailed:false,
        sampleSpacingM:5000,
        windowM:null,
        samples:[{distanceM:0,severity:0}],
      },
    },
  };
}

function runningState(options={},stepMs=100){
  return startRaceState(createRaceState(input(options),{stepMs}));
}

function car(state,id="C1"){
  return state.cars.find((row)=>row.carId===id);
}

test("RW8.7 RaceState initializes canonical tyre, fuel and temperature snapshots",()=>{
  const state=createRaceState(input({paceMode:"attack",refuellingAllowed:true}));
  const row=car(state);

  assert.equal(row.tyre.tyre_id,"test_s");
  assert.equal(row.tyre.compound,"Soft");
  assert.equal(row.tyre.condition,100);
  assert.equal(row.tyre.age_laps,0);
  assert.ok(Number.isFinite(row.tyre.temperature_c));
  assert.ok(row.fuelKg>0);
  assert.equal(row.engineTemperature,82);
  assert.equal(row.resources.paceMode,"attack");
  assert.equal(row.resources.strategy.nextTyreId,"test_h");
  assert.equal(row.resources.availableTyres.length,2);
  assert.equal(row.resources.refuellingDeferred,true);
  assert.ok(row.resources.initialFuelKg>row.resources.fuelReserveKg);
});

test("RW8.7 shared Legacy and RW2 tyre condition effects remain one source of truth",()=>{
  for(const condition of [100,70,55,44,30,24,10,0]){
    assert.deepEqual(
      strategyTyreConditionEffects(condition),
      sharedTyreConditionEffects(condition)
    );
  }
});

test("RW8.7 temporary full-race fuel load covers maximum normal burn before pit phase exists",()=>{
  const state=createRaceState(input({paceMode:"attack"}));
  const row=car(state);
  const raceKm=(state.track.lengthM*state.session.lapLimit)/1000;
  const worstNormalBurn=raceKm*row.resources.fuelBurnKgPerKm*1.04*1.05;

  assert.ok(row.resources.initialFuelKg>worstNormalBurn);
  assert.ok(row.resources.initialFuelKg-worstNormalBurn>=row.resources.fuelReserveKg-1e-6);
});

test("RW8.8 planned refuelling stint sizes initial fuel to the stop rather than full race",()=>{
  const base=input({refuellingAllowed:true});
  base.cars[0].resourceSetup.strategy.pitPlan="one_stop";
  base.cars[0].resourceSetup.strategy.plannedStopLap=10;
  const state=createRaceState(base);
  const row=car(state);
  const fullRaceKm=(state.track.lengthM*state.session.lapLimit)/1000;
  const fullRaceWorst=fullRaceKm*row.resources.fuelBurnKgPerKm*1.04*1.05;

  assert.equal(row.resources.fuelStintPlanned,true);
  assert.equal(row.resources.plannedFuelStopLap,10);
  assert.ok(row.resources.initialFuelKg<fullRaceWorst);
  assert.ok(row.resources.initialFuelKg>0);
});

test("RW8.8 no-refuelling era keeps safe full-race fuel even with a tyre stop planned",()=>{
  const base=input({refuellingAllowed:false});
  base.cars[0].resourceSetup.strategy.pitPlan="one_stop";
  base.cars[0].resourceSetup.strategy.plannedStopLap=10;
  const state=createRaceState(base);
  const row=car(state);
  const fullRaceKm=(state.track.lengthM*state.session.lapLimit)/1000;
  const worst=fullRaceKm*row.resources.fuelBurnKgPerKm*1.04*1.05;

  assert.equal(row.resources.fuelStintPlanned,false);
  assert.ok(row.resources.initialFuelKg>worst);
});

test("RW8.7 tyre wear and fuel burn integrate from actual physical distance",()=>{
  const state=runningState();
  const previous=car(state);
  const moved={
    ...previous,
    absoluteDistanceM:previous.absoluteDistanceM+2500,
    distanceAlongLapM:2500,
  };
  const [next]=advanceRaceResources(state,[moved],{stepMs:100});

  assert.equal(next.tyre.age_distance_m,2500);
  assert.equal(next.tyre.age_laps,0.5);
  assert.ok(next.tyre.condition<100);
  assert.ok(next.tyre.wear_per_lap_pct>0);
  assert.ok(next.fuelKg<previous.fuelKg);

  const expectedFuelUse=
    previous.resources.fuelBurnKgPerKm*
    2.5*
    (0.95+0.82*0.10);
  assert.ok(Math.abs((previous.fuelKg-next.fuelKg)-expectedFuelUse)<1e-5);
});

test("RW10A canonical race steps consume tyres and fuel from real travelled distance",()=>{
  const initial=runningState({paceMode:"balanced"});
  const before=car(initial);
  let next=initial;

  for(let index=0;index<400;index+=1)next=stepRaceState(next);

  const evolved=car(next);
  assert.ok(evolved.absoluteDistanceM>before.absoluteDistanceM);
  assert.ok(evolved.tyre.condition<before.tyre.condition);
  assert.ok(evolved.tyre.age_distance_m>0);
  assert.ok(evolved.tyre.age_laps>0);
  assert.ok(evolved.fuelKg<before.fuelKg);
});

test("RW8.7 stopped distance does not consume tyre condition or fuel",()=>{
  const state=runningState();
  const previous=car(state);
  const stationary={...previous};
  const [next]=advanceRaceResources(state,[stationary],{stepMs:1000});

  assert.equal(next.tyre.condition,previous.tyre.condition);
  assert.equal(next.tyre.age_distance_m,previous.tyre.age_distance_m);
  assert.equal(next.fuelKg,previous.fuelKg);
  assert.notEqual(next.tyre.temperature_c,previous.tyre.temperature_c);
  assert.notEqual(next.engineTemperature,previous.engineTemperature);
});

test("RW8.7 tyre management and pace mode change wear without separate engines",()=>{
  const good=runningState({tyreManagement:95,paceMode:"conserve"});
  const poor=runningState({tyreManagement:25,paceMode:"attack"});

  const distance=5000;
  const goodNext=advanceRaceResources(good,[{
    ...car(good),
    absoluteDistanceM:distance,
    distanceAlongLapM:0,
  }],{stepMs:100});
  const poorNext=advanceRaceResources(poor,[{
    ...car(poor),
    absoluteDistanceM:distance,
    distanceAlongLapM:0,
  }],{stepMs:100});

  assert.ok(goodNext[0].tyre.condition>poorNext[0].tyre.condition);
  assert.ok(goodNext[0].tyre.wear_per_lap_pct<poorNext[0].tyre.wear_per_lap_pct);
  assert.ok(goodNext[0].fuelKg>poorNext[0].fuelKg);
});

test("RW8.7 worn or badly-temperatured tyres reduce canonical pace target",()=>{
  const state=runningState();
  const fresh=car(state);
  const freshProfile=raceTargetSpeedProfile(state,fresh);

  const compromised={
    ...fresh,
    tyre:{
      ...fresh.tyre,
      condition:18,
      temperature_c:fresh.tyre.optimal_temperature_c+35,
      ...sharedTyreConditionEffects(18),
    },
  };
  const compromisedEffects=raceResourcePerformance(compromised);
  const compromisedProfile=raceTargetSpeedProfile(state,compromised);

  assert.ok(compromisedEffects.tyreTemperaturePenalty>0);
  assert.ok(compromisedEffects.tyreGripMultiplier<1);
  assert.ok(compromisedProfile.targetSpeedKmh<freshProfile.targetSpeedKmh);
});

test("RW8.7 burning fuel reduces mass penalty while starvation below reserve hurts pace",()=>{
  const state=runningState();
  const full=car(state);
  const low={
    ...full,
    fuelKg:full.resources.fuelReserveKg*1.2,
  };
  const empty={
    ...full,
    fuelKg:0,
  };

  const fullEffects=raceResourcePerformance(full);
  const lowEffects=raceResourcePerformance(low);
  const emptyEffects=raceResourcePerformance(empty);

  assert.ok(lowEffects.fuelMassPenalty<fullEffects.fuelMassPenalty);
  assert.equal(lowEffects.fuelStarvationPenalty,0);
  assert.ok(emptyEffects.fuelStarvationPenalty>0);
  assert.ok(emptyEffects.paceMultiplier<lowEffects.paceMultiplier);
});

test("RW8.7 engine temperature evolves continuously and overheating reduces performance",()=>{
  const state=runningState({paceMode:"attack"});
  let next=state;
  for(let index=0;index<300;index+=1)next=stepRaceState(next);

  assert.ok(Number.isFinite(car(next).engineTemperature));
  assert.notEqual(car(next).engineTemperature,82);

  const normal={...car(next),engineTemperature:100};
  const hot={...car(next),engineTemperature:125};
  const normalEffects=raceResourcePerformance(normal);
  const hotEffects=raceResourcePerformance(hot);

  assert.equal(normalEffects.engineTemperaturePenalty,0);
  assert.ok(hotEffects.engineTemperaturePenalty>0);
  assert.ok(hotEffects.paceMultiplier<normalEffects.paceMultiplier);
});

test("RW8.7 DNF freezes fuel, tyre distance and temperatures with the car",()=>{
  let state=runningState();
  const before=car(state);
  state={
    ...state,
    cars:[{
      ...before,
      dnf:true,
      status:"dnf",
      speedMs:0,
      speedKmh:0,
    }],
  };
  const next=stepRaceState(state);
  const retired=car(next);

  assert.equal(retired.fuelKg,before.fuelKg);
  assert.deepEqual(retired.tyre,before.tyre);
  assert.equal(retired.engineTemperature,before.engineTemperature);
});

test("RW8.7 fixed-step resource evolution remains deterministic",()=>{
  const a=advanceRaceState(runningState({paceMode:"attack"}),{steps:300});
  const b=advanceRaceState(runningState({paceMode:"attack"}),{steps:300});
  assert.deepEqual(a,b);
});

test("RW8.7 Live and Fast expose identical tyre fuel and temperature state",()=>{
  const initial=runningState({cars:2,paceMode:"balanced"});
  const fast=runFastRace(initial,{steps:250});
  const live=createLiveRaceRunner(initial);
  live.advanceElapsed(25000);

  assert.deepEqual(live.getState(),fast);
  assert.deepEqual(
    live.getState().cars.map((row)=>({
      carId:row.carId,
      tyre:row.tyre,
      fuelKg:row.fuelKg,
      engineTemperature:row.engineTemperature,
      resources:row.resources,
    })),
    fast.cars.map((row)=>({
      carId:row.carId,
      tyre:row.tyre,
      fuelKg:row.fuelKg,
      engineTemperature:row.engineTemperature,
      resources:row.resources,
    }))
  );
});

test("RW8.7 fuel burn model is era-aware and trends down toward modern efficiency",()=>{
  assert.ok(fuelBurnKgPerKmForYear(1986)>fuelBurnKgPerKmForYear(1992));
  assert.ok(fuelBurnKgPerKmForYear(1998)>fuelBurnKgPerKmForYear(2026));
});
