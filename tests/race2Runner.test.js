import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";
import {
  createLiveRaceRunner,
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

function runningState(options={}){
  const started=startRaceState(createRaceState(input(options),{stepMs:100}));
  return {
    ...started,
    cars:started.cars.map((car)=>({...car,speedMs:50,speedKmh:180})),
  };
}

test("Live elapsed chunks and Fast steps share one canonical outcome",()=>{
  const initial=runningState();
  const fast=runFastRace(initial,{steps:100});
  const live=createLiveRaceRunner(initial);
  for(const ms of [17,83,250,650,1000,3000,5000])live.advanceElapsed(ms);

  assert.deepEqual(live.getState(),fast);
  assert.equal(live.getAccumulatorMs(),0);
  assert.equal(fast.tick,100);
  assert.equal(fast.cars[0].absoluteDistanceM,500);
});

test("Live runner retains sub-step time and can resume without changing outcome",()=>{
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

test("Fast-to-end is only a scheduler over canonical steps",()=>{
  const initial=runningState({laps:1});
  const finished=runFastRaceToEnd(initial,{maxSteps:250});

  assert.equal(finished.status,"finished");
  assert.equal(finished.cars[0].status,"finished");
  assert.equal(finished.cars[0].absoluteDistanceM,1000);
  assert.equal(finished.tick,200);
});

test("Fast-to-end fails explicitly instead of returning a partial race",()=>{
  const initial=runningState({laps:2});
  assert.throws(
    ()=>runFastRaceToEnd(initial,{maxSteps:10}),
    /did not finish within 10 canonical steps/
  );
});
