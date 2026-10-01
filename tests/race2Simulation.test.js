import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState, DEFAULT_RACE_STEP_MS, RACE_STATE_SCHEMA_VERSION } from "../src/race2/core/RaceState.js";
import { advanceRaceState, startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import { applyCanonicalLapTiming } from "../src/race2/core/RaceLapTiming.js";

function input({laps=2,cars=2}={}){
  const entries=Array.from({length:cars},(_,index)=>({driverId:`D${index+1}`,teamId:index<2?"T1":"T2",carId:`car_${index+1}`,status:"confirmed"}));
  return {schemaVersion:3,engineVersion:"rw2",weekendKey:"1980_1_test",seed:"rw8.2-fixed-step",track:{schemaVersion:1,trackId:"test",lengthM:100,laps,startFinish:{progress:0,distanceM:0},sectors:[{id:"sector_1",sector:1,startM:0,endM:33,lengthM:33},{id:"sector_2",sector:2,startM:33,endM:66,lengthM:33},{id:"sector_3",sector:3,startM:66,endM:100,lengthM:34}]},entries,cars:entries.map((entry)=>({carId:entry.carId,driverId:entry.driverId,teamId:entry.teamId,state:{componentCondition:{engine:95}}})),startingGrid:entries.map((entry,index)=>({grid:index+1,driver_id:entry.driverId,team_id:entry.teamId})),weather:{state:"SUNNY"}};
}

function withKinematics(state,carId,patch){return {...state,cars:state.cars.map((car)=>car.carId===carId?{...car,...patch}:car)};}

test("RW8.2 creates one authoritative continuous CarState per entered grid car",()=>{
  const state=createRaceState(input());
  assert.equal(state.schemaVersion,RACE_STATE_SCHEMA_VERSION); assert.equal(state.status,"ready"); assert.equal(state.tick,0); assert.equal(state.simulationTimeMs,0); assert.equal(state.session.simulation.stepMs,DEFAULT_RACE_STEP_MS); assert.equal(state.cars.length,2); assert.deepEqual(state.cars.map((car)=>car.carId),["car_1","car_2"]); assert.ok(state.cars.every((car)=>car.lap===1)); assert.ok(state.cars.every((car)=>car.completedLaps===0)); assert.deepEqual(state.cars.map((car)=>car.absoluteDistanceM),[0,-8]); assert.deepEqual(state.cars.map((car)=>car.gridStartOffsetM),[0,-8]); assert.equal(state.cars[0].distanceAlongLapM,0); assert.equal(state.cars[1].distanceAlongLapM,92); assert.deepEqual(state.cars.map((car)=>car.sector),[1,3]);
});

test("RW8.2 fixed-step advancement converts speed into continuous physical distance",()=>{
  let state=startRaceState(createRaceState(input())); state=withKinematics(state,"car_1",{speedMs:10,speedKmh:36}); state=advanceRaceState(state,{steps:10}); const car=state.cars.find((row)=>row.carId==="car_1"); assert.equal(state.tick,10); assert.equal(state.simulationTimeMs,1000); assert.ok(Math.abs(car.absoluteDistanceM-10)<1e-9); assert.ok(Math.abs(car.distanceAlongLapM-10)<1e-9); assert.equal(car.lap,1); assert.equal(car.completedLaps,0); assert.equal(car.sector,1);
});

test("RW8.2 crossing start/finish derives lap and distance from absoluteDistanceM",()=>{
  let state=startRaceState(createRaceState(input({laps:3,cars:1}))); state=withKinematics(state,"car_1",{absoluteDistanceM:95,distanceAlongLapM:95,lap:1,completedLaps:0,sector:3,speedMs:10,speedKmh:36}); state=advanceRaceState(state,{steps:10}); const car=state.cars[0]; assert.ok(Math.abs(car.absoluteDistanceM-105)<1e-9); assert.ok(Math.abs(car.distanceAlongLapM-5)<1e-9); assert.equal(car.completedLaps,1); assert.equal(car.lap,2); assert.equal(car.sector,1);
});

test("RW8.2 the same initial state and fixed number of steps are deterministic",()=>{
  let a=startRaceState(createRaceState(input())); let b=startRaceState(createRaceState(input())); a=withKinematics(a,"car_1",{speedMs:17.5,speedKmh:63,accelerationMs2:0.4}); b=withKinematics(b,"car_1",{speedMs:17.5,speedKmh:63,accelerationMs2:0.4}); a=advanceRaceState(a,{steps:37}); b=advanceRaceState(b,{steps:37}); assert.deepEqual(a,b);
});

test("RW8.2 braking to zero inside a fixed step integrates only until the stop time",()=>{
  let state=startRaceState(createRaceState(input({laps:3,cars:1}),{stepMs:1000})); state=withKinematics(state,"car_1",{speedMs:10,speedKmh:36,accelerationMs2:-100}); const car=stepRaceState(state).cars[0]; assert.equal(car.speedMs,0); assert.equal(car.speedKmh,0); assert.equal(car.absoluteDistanceM,0.5); assert.equal(car.distanceAlongLapM,0.5); assert.equal(car.completedLaps,0);
});

test("RW8.2 lap fields derive from the stored canonical absolute distance",()=>{
  let state=startRaceState(createRaceState(input({laps:3,cars:1}))); state=withKinematics(state,"car_1",{absoluteDistanceM:99.9999996,distanceAlongLapM:99.9999996,speedMs:0,speedKmh:0}); const car=stepRaceState(state).cars[0]; assert.equal(car.absoluteDistanceM,100); assert.equal(car.distanceAlongLapM,0); assert.equal(car.completedLaps,1); assert.equal(car.lap,2); assert.equal(car.sector,1);
});

test("RW8.2 DNF cars are frozen while the same core continues advancing active cars",()=>{
  let state=startRaceState(createRaceState(input())); state={...state,cars:state.cars.map((car)=>car.carId==="car_1"?{...car,dnf:true,status:"dnf",absoluteDistanceM:42,distanceAlongLapM:42,speedMs:50,speedKmh:180}:{...car,speedMs:10,speedKmh:36})}; const before=state.cars.find((row)=>row.carId==="car_2").absoluteDistanceM; const next=stepRaceState(state); const retired=next.cars.find((row)=>row.carId==="car_1"); const active=next.cars.find((row)=>row.carId==="car_2"); assert.equal(retired.absoluteDistanceM,42); assert.equal(retired.distanceAlongLapM,42); assert.equal(retired.elapsedMs,0); assert.ok(active.absoluteDistanceM>before); assert.equal(next.status,"running");
});

test("RW8.2 the canonical core clamps a car at the race finish",()=>{
  let state=startRaceState(createRaceState(input({laps:1,cars:1}))); state=withKinematics(state,"car_1",{absoluteDistanceM:99,distanceAlongLapM:99,sector:3,speedMs:20,speedKmh:72}); const next=stepRaceState(state); const car=next.cars[0]; assert.equal(car.absoluteDistanceM,100); assert.equal(car.distanceAlongLapM,0); assert.equal(car.completedLaps,1); assert.equal(car.lap,1); assert.equal(car.status,"finished"); assert.equal(car.zoneType,"finish"); assert.equal(next.status,"finished"); assert.equal(next.session.phase,"finished");
});


test("RW9B official clock records the physical finish-line crossing as canonical lap time",()=>{
  let state=startRaceState(createRaceState(input({laps:1,cars:1}),{stepMs:1000}));
  state={
    ...state,
    simulationTimeMs:9500,
    officialRaceTimeMs:9500,
    session:{
      ...state.session,
      clock:{...(state.session.clock||{}),elapsedMs:9500,officialElapsedMs:9500},
    },
  };
  state=withKinematics(state,"car_1",{
    absoluteDistanceM:99,
    distanceAlongLapM:99,
    lap:1,
    completedLaps:0,
    sector:3,
    speedMs:20,
    speedKmh:72,
    lapStartedAtMs:0,
  });

  const next=stepRaceState(state);
  const car=next.cars[0];

  assert.equal(car.status,"finished");
  assert.equal(car.completedLaps,1);
  assert.equal(car.lapTimes.length,1);
  assert.equal(car.lapTimes[0].lap,1);
  assert.equal(car.lastLapMs,car.finishTimeMs);
  assert.equal(car.bestLapMs,car.finishTimeMs);
  assert.equal(car.bestLapNumber,1);
  assert.equal(car.lapTimes[0].timeMs,car.finishTimeMs);
  assert.equal(car.lapTimes[0].completedAtMs,car.finishTimeMs);
  assert.ok(car.finishTimeMs>9500&&car.finishTimeMs<10500,"crossing must be timed inside the fixed step");
  assert.equal(next.officialRaceTimeMs,car.finishTimeMs,"terminal official clock stops at the final physical crossing");
  assert.equal(next.session.clock.officialElapsedMs,car.finishTimeMs);
});

test("RW9B canonical lap timer also observes a start/finish crossing inside pit-lane movement",()=>{
  let state=startRaceState(createRaceState(input({laps:3,cars:1}),{stepMs:100}));
  state={
    ...state,
    officialRaceTimeMs:10_000,
    session:{...state.session,clock:{...state.session.clock,officialElapsedMs:10_000}},
    cars:state.cars.map((car)=>({
      ...car,
      absoluteDistanceM:95,
      distanceAlongLapM:95,
      pitState:{...(car.pitState||{}),status:"pit_lane",phase:"pit_lane",active:true},
    })),
  };
  const previous=state.cars[0];
  const nextCar={
    ...previous,
    absoluteDistanceM:105,
    distanceAlongLapM:5,
    completedLaps:1,
    lap:2,
    pitState:{...previous.pitState,status:"pit_lane",phase:"pit_lane",active:true},
  };

  const [timed]=applyCanonicalLapTiming(state,[nextCar],{stepMs:100});
  assert.equal(timed.lapTimes.length,1);
  assert.equal(timed.lapTimes[0].lap,1);
  assert.equal(timed.lapTimes[0].completedAtMs,10_050);
  assert.equal(timed.lastLapMs,10_050);
  assert.equal(timed.bestLapMs,10_050);
});
