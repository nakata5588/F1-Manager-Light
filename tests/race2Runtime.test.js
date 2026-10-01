import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceCanonicalRaceRuntime,
  advanceCanonicalRaceWeekendElapsed,
  canonicalRaceView,
  canonicalRaceRuntimeNeedsCheckpoint,
  canonicalRaceWeekendView,
  cancelCanonicalRaceWeekendCommand,
  ensureCanonicalRaceRuntime,
  queueCanonicalRaceWeekendCommand,
  restoreCanonicalRaceRunner,
  runCanonicalRaceWeekendToEnd,
} from "../src/race2/runtime/RaceRuntime.js";
import { RACE_VIEW_PROJECTION_SOURCE } from "../src/race2/adapters/RaceViewProjection.js";
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
    track:{
      schemaVersion:2,
      trackId:"T",
      year:2004,
      lengthM:5000,
      laps:3,
      traits:{},
      startFinish:{progress:0,distanceM:0},
      sectors:[
        {id:"sector_1",sector:1,startM:0,endM:1666,lengthM:1666},
        {id:"sector_2",sector:2,startM:1666,endM:3333,lengthM:1667},
        {id:"sector_3",sector:3,startM:3333,endM:5000,lengthM:1667},
      ],
      speedProfile:{source:"neutral",detailed:false,sampleSpacingM:5000,windowM:null,samples:[{distanceM:0,severity:0}]},
    },
    weather:{state:"SUNNY",avg_temp_c:22,track_temp_c:30,timeline:[]},
    raceControl:{rules:{}},
  };
}

function runtime(){
  return {version:1,source:"rw8.14b_race_runtime",state:startRaceState(createRaceState(input(),{stepMs:100})),accumulatorMs:0};
}

function gameState({engine="rw2",phase="race",runtimeSnapshot=null}={}){
  const source=input();
  return {
    activeYear:2004,
    raceEntryState:{entries:source.entries},
    raceWeekendState:{engine_version:engine,key:source.weekendKey,year:2004,phase,entrants:source.entries,startingGrid:{rows:source.startingGrid},canonical_race_runtime:runtimeSnapshot},
    drivers:source.drivers.map((row)=>({driver_id:row.driverId,team_id:row.teamId})),
    dbDrivers:source.drivers.map((row)=>({driver_id:row.driverId,team_id:row.teamId})),
    dbCarStats:[],dbCoreTracks:[],dbTrackLayoutByYear:[],dbWeatherProfiles:[],dbWeatherStates:[],
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
  assert.equal(view.source,RACE_VIEW_PROJECTION_SOURCE);
  assert.equal(view.canonical_tick,next.state.tick);
  assert.equal(view.classification.length,next.state.cars.length);
  assert.equal(view.classification[0].absolute_distance_m,next.state.cars.find((car)=>car.carId===view.classification[0].car_id).absoluteDistanceM);
});

test("RW8.14C runtime entry leaves Legacy and pre-race weekends untouched",()=>{
  const legacy=gameState({engine:"legacy"});
  assert.equal(ensureCanonicalRaceRuntime(legacy),legacy);
  const preRace=gameState({engine:"rw2",phase:"grid_ready"});
  assert.equal(ensureCanonicalRaceRuntime(preRace),preRace);
});

test("RW8.14C runtime entry resumes an existing RW2 snapshot without recreating it",()=>{
  const snapshot=runtime();
  const gs=gameState({runtimeSnapshot:snapshot});
  assert.equal(ensureCanonicalRaceRuntime(gs),gs);
  assert.equal(gs.raceWeekendState.canonical_race_runtime,snapshot);
});

test("RW8.14D elapsed dispatch advances RW2 fixed steps without sector translation",()=>{
  const gs=gameState({runtimeSnapshot:runtime()});
  const next=advanceCanonicalRaceWeekendElapsed(gs,{elapsedMs:250});
  assert.equal(next.raceWeekendState.canonical_race_runtime.state.tick,2);
  assert.equal(next.raceWeekendState.canonical_race_runtime.accumulatorMs,50);
  const view=canonicalRaceWeekendView(next);
  assert.equal(view.source,RACE_VIEW_PROJECTION_SOURCE);
  assert.equal(view.canonical_tick,2);
});

test("RW8.14D elapsed dispatch cannot mutate Legacy or pre-race weekends",()=>{
  const legacy=gameState({engine:"legacy",runtimeSnapshot:runtime()});
  assert.equal(advanceCanonicalRaceWeekendElapsed(legacy,{elapsedMs:1000}),legacy);
  assert.equal(canonicalRaceWeekendView(legacy),null);
  const preRace=gameState({engine:"rw2",phase:"grid_ready"});
  assert.equal(advanceCanonicalRaceWeekendElapsed(preRace,{elapsedMs:1000}),preRace);
});


test("RW8.14J canonical command boundary queues and cancels RaceRunner commands",()=>{
  const gs=gameState({runtimeSnapshot:runtime()});
  const queued=queueCanonicalRaceWeekendCommand(gs,{
    command:{type:"pace",driverId:"D1",paceMode:"attack"},
  });
  const queue=queued.raceWeekendState.canonical_race_runtime.state.commandQueue;
  assert.equal(queue.length,1);
  assert.equal(queue[0].driverId,"D1");
  assert.equal(queue[0].type,"pace");
  assert.equal(queue[0].payload?.paceMode,"attack");

  const cancelled=cancelCanonicalRaceWeekendCommand(queued,{criteria:{driverId:"D1"}});
  assert.equal(cancelled.raceWeekendState.canonical_race_runtime.state.commandQueue.length,0);
});

test("RW8.14J canonical checkpoint cadence follows simulation time instead of browser frames",()=>{
  const initial=runtime();
  const beforeBoundary=advanceCanonicalRaceRuntime(initial,4900);
  const acrossBoundary=advanceCanonicalRaceRuntime(beforeBoundary,200);
  const sameBucket=advanceCanonicalRaceRuntime(acrossBoundary,100);

  assert.equal(canonicalRaceRuntimeNeedsCheckpoint(initial,beforeBoundary),false);
  assert.equal(canonicalRaceRuntimeNeedsCheckpoint(beforeBoundary,acrossBoundary),true);
  assert.equal(canonicalRaceRuntimeNeedsCheckpoint(acrossBoundary,sameBucket),false);
});


test("RW9C gameplay Autosim finishes the attached canonical runtime without mutating its input",()=>{
  const snapshot=runtime();
  const initial=gameState({runtimeSnapshot:snapshot});
  const next=runCanonicalRaceWeekendToEnd(initial,{maxSteps:200_000});
  const state=next.raceWeekendState.canonical_race_runtime.state;

  assert.equal(state.status,"finished");
  assert.ok(state.cars.every((car)=>car.dnf||car.status==="finished"));
  assert.equal(next.raceWeekendState.engine_version,"rw2");
  assert.equal(initial.raceWeekendState.canonical_race_runtime.state.status,"running");
  assert.equal(next.raceWeekendState.canonical_race_runtime.accumulatorMs,0);
});
