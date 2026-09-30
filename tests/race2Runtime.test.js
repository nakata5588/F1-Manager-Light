import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceCanonicalRaceRuntime,
  canonicalRaceView,
  restoreCanonicalRaceRunner,
} from "../src/race2/runtime/RaceRuntime.js";
import { createLiveRaceRunner } from "../src/race2/core/RaceRunner.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";

function input(){
  return {
    schemaVersion:15,
    engineVersion:"rw2",
    weekendKey:"rw8.14b-runtime",
    seed:"rw8.14b",
    year:2004,
    entries:[
      {driverId:"D1",teamId:"T1",carId:"C1",status:"confirmed"},
      {driverId:"D2",teamId:"T2",carId:"C2",status:"confirmed"},
    ],
    drivers:[
      {driverId:"D1",teamId:"T1",performance:{raceScore:80}},
      {driverId:"D2",teamId:"T2",performance:{raceScore:78}},
    ],
    cars:[
      {carId:"C1",driverId:"D1",teamId:"T1",performance:{race:80,reliability:100}},
      {carId:"C2",driverId:"D2",teamId:"T2",performance:{race:78,reliability:100}},
    ],
    startingGrid:[
      {driverId:"D1",teamId:"T1",gridPosition:1},
      {driverId:"D2",teamId:"T2",gridPosition:2},
    ],
    track:{trackId:"T",lengthM:5000,laps:3,sectors:[{id:"s1",startM:0,endM:5000}],traits:{}},
    weather:{timeline:[]},
    raceControl:{rules:{}},
  };
}

function runtime(){
  return {
    version:1,
    source:"rw8.14b_race_runtime",
    state:startRaceState(createRaceState(input(),{stepMs:100})),
    accumulatorMs:0,
  };
}

test("RW8.14B runtime restoration preserves fixed-step elapsed scheduling",()=>{
  const initial=runtime();
  const first=advanceCanonicalRaceRuntime(initial,250);
  assert.equal(first.state.tick,2);
  assert.equal(first.accumulatorMs,50);

  const restored=restoreCanonicalRaceRunner(first);
  restored.advanceElapsed(50);
  assert.equal(restored.getState().tick,3);
  assert.equal(restored.getAccumulatorMs(),0);
});

test("RW8.14B serialized runtime matches an uninterrupted canonical runner",()=>{
  const initial=runtime();
  const uninterrupted=createLiveRaceRunner(initial.state);
  uninterrupted.advanceElapsed(375);

  const persisted=advanceCanonicalRaceRuntime(initial,125);
  const resumed=advanceCanonicalRaceRuntime(persisted,250);

  assert.deepEqual(resumed.state,uninterrupted.getState());
  assert.equal(resumed.accumulatorMs,uninterrupted.getAccumulatorMs());
});

test("RW8.14B Race View is a projection of the persisted canonical state",()=>{
  const next=advanceCanonicalRaceRuntime(runtime(),300);
  const view=canonicalRaceView(next);
  assert.equal(view.source,"rw8.14a_race_state");
  assert.equal(view.canonical_tick,next.state.tick);
  assert.equal(view.cars.length,next.state.cars.length);
  assert.equal(view.cars[0].absolute_distance_m,next.state.cars.find((car)=>car.carId===view.cars[0].car_id).absoluteDistanceM);
});
