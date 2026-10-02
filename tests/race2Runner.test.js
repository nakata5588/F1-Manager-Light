import test from "node:test";
import assert from "node:assert/strict";

import { raceControlRulesForYear } from "../src/engine/RaceControlEngine.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { raceStepMs, startRaceState } from "../src/race2/core/RaceSimulation.js";
import {
  createLiveRaceRunner,
  raceStepMs as runnerRaceStepMs,
  runFastRace,
  runFastRaceToEnd,
} from "../src/race2/core/RaceRunner.js";

function input({laps=3}={}){
  return {
    schemaVersion:3,
    engineVersion:"rw2",
    weekendKey:"runner-test",
    seed:"runner-seed",
    entries:[{driverId:"D1",teamId:"T1",carId:"C1",status:"confirmed"}],
    drivers:[{driverId:"D1",teamId:"T1",ratings:{pace:80}}],
    cars:[{carId:"C1",driverId:"D1",teamId:"T1",state:{componentCondition:{engine:100}}}],
    startingGrid:[{driver_id:"D1",team_id:"T1",grid:1}],
    track:{lengthM:1000,laps,sectorBoundariesM:[0,333,666,1000]},
  };
}

function runningState({laps=3,stepMs=100}={}){
  const started=startRaceState(createRaceState(input({laps}),{stepMs}));
  return {
    ...started,
    cars:started.cars.map((car)=>({...car,speedMs:50,speedKmh:180})),
  };
}

test("RW8.3 Live elapsed chunks and Fast steps share one canonical outcome",()=>{
  const initial=runningState();
  const fast=runFastRace(initial,{steps:100});
  const live=createLiveRaceRunner(initial);
  for(const ms of [17,83,250,650,1000,3000,5000])live.advanceElapsed(ms);

  assert.deepEqual(live.getState(),fast);
  assert.equal(live.getAccumulatorMs(),0);
  assert.equal(fast.tick,100);
  assert.equal(fast.cars[0].absoluteDistanceM,500);
});

test("RW8.3 Live runner retains sub-step time and resumes without changing outcome",()=>{
  const initial=runningState();
  const first=createLiveRaceRunner(initial);
  first.advanceElapsed(255);
  const saved=first.snapshot();

  const resumed=createLiveRaceRunner(saved.state,{accumulatorMs:saved.accumulatorMs});
  resumed.advanceElapsed(745);

  const uninterrupted=createLiveRaceRunner(initial);
  uninterrupted.advanceElapsed(1000);

  assert.deepEqual(resumed.getState(),uninterrupted.getState());
  assert.equal(resumed.getAccumulatorMs(),0);
});

test("RW8.3 Live elapsed threshold is stable for fractional millisecond chunks",()=>{
  const initial=runningState({laps:10});
  const chunked=createLiveRaceRunner(initial);
  for(let index=0;index<1000;index+=1)chunked.advanceElapsed(0.1);

  const whole=createLiveRaceRunner(initial);
  whole.advanceElapsed(100);

  assert.deepEqual(chunked.getState(),whole.getState());
  assert.equal(chunked.getState().tick,1);
  assert.equal(chunked.getAccumulatorMs(),0);
});

test("RW8.3 runner and core share the same canonical step duration normalization",()=>{
  const initial=runningState();
  const state={
    ...initial,
    session:{
      ...initial.session,
      simulation:{...initial.session.simulation,stepMs:null},
    },
  };

  assert.equal(raceStepMs(state),100);
  assert.equal(runnerRaceStepMs(state),raceStepMs(state));

  const fast=runFastRace(state,{steps:1});
  const live=createLiveRaceRunner(state);
  live.advanceElapsed(100);

  assert.deepEqual(live.getState(),fast);
  assert.equal(fast.tick,1);
  assert.equal(fast.simulationTimeMs,100);
});

test("RW8.3 Fast-to-end is only a scheduler over canonical steps",()=>{
  const initial=runningState({laps:1});
  const finished=runFastRaceToEnd(initial,{maxSteps:250});

  assert.equal(finished.status,"finished");
  assert.equal(finished.cars[0].status,"finished");
  assert.equal(finished.cars[0].absoluteDistanceM,1000);
  assert.equal(finished.tick,200);
});

test("RW8.3 Fast-to-end fails explicitly instead of returning a partial race",()=>{
  const initial=runningState({laps:2});
  assert.throws(
    ()=>runFastRaceToEnd(initial,{maxSteps:10}),
    /did not finish within 10 canonical steps/
  );
});


test("RW9C Live stepping and Fast-to-end converge on the same final RaceState",()=>{
  const initial=runningState({laps:1});
  const fast=runFastRaceToEnd(initial,{maxSteps:5000});
  const live=createLiveRaceRunner(initial);

  let guard=0;
  while(live.getState()?.status!=="finished"&&guard<5000){
    live.step();
    guard+=1;
  }

  assert.ok(guard<5000,"live canonical runner must finish inside the same guard");
  assert.deepEqual(live.getState(),fast);
});


test("RW11F Live runner yields immediately when a canonical Red Flag is activated",()=>{
  const extreme={
    lap:1,
    state:"STORM",
    rain_intensity:1,
    rain_band:"HEAVY",
    track_wetness:0.95,
    wetness_delta:0,
    rubber_level:0,
    grip_index:24,
    air_temp_c:15,
    track_temp_c:17,
    spray_index:0.96,
    spray_band:"HEAVY",
    visibility_index:28,
    visibility_band:"VERY_POOR",
    standing_water_index:92,
    standing_water_band:"HEAVY",
    raceability_index:12,
    raceability_hazard_index:88,
    raceability_band:"CRITICAL",
    raceability_factors:{},
    raceability_dominant_factors:["standing_water","visibility"],
  };
  const source={
    ...input({laps:3}),
    year:2026,
    rules:{race:{refuelling_allowed:false}},
    raceControl:{rules:raceControlRulesForYear(2026)},
    weather:{state:"STORM",timeline:[extreme,{...extreme,lap:2},{...extreme,lap:3}]},
    track:{
      ...input({laps:3}).track,
      year:2026,
      traits:{tyreWear:50},
      startFinish:{progress:0,distanceM:0},
      sectors:[
        {id:"sector_1",sector:1,startM:0,endM:333,lengthM:333},
        {id:"sector_2",sector:2,startM:333,endM:666,lengthM:333},
        {id:"sector_3",sector:3,startM:666,endM:1000,lengthM:334},
      ],
      speedProfile:{source:"neutral",detailed:false,sampleSpacingM:1000,windowM:null,samples:[{distanceM:0,severity:0}]},
    },
  };
  const initial=startRaceState(createRaceState(source,{stepMs:100}));
  const live=createLiveRaceRunner(initial);

  live.advanceElapsed(1000);

  assert.equal(live.getState().tick,1);
  assert.equal(live.getState().raceControlState.mode,"RED_FLAG");
  assert.equal(live.getState().raceControlState.redFlagLifecycle.phase,"suspended");
  assert.equal(live.getAccumulatorMs(),0);
});
