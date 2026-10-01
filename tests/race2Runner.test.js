import test from "node:test";
import assert from "node:assert/strict";

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
