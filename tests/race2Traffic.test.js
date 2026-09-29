import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { advanceRaceState, startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import {
  RACE_GRID_SLOT_SPACING_M,
  RACE_TRAFFIC_HARD_GAP_M,
  nearestTrafficAhead,
  raceTrafficContext,
} from "../src/race2/core/RaceTraffic.js";
import { createLiveRaceRunner, runFastRace } from "../src/race2/core/RaceRunner.js";

function input({laps=10,cars=3}={}){
  const entries=Array.from({length:cars},(_,index)=>({
    driverId:`D${index+1}`,
    teamId:`T${Math.floor(index/2)+1}`,
    carId:`C${index+1}`,
    status:"confirmed",
  }));
  return {
    schemaVersion:6,
    engineVersion:"rw2",
    weekendKey:"rw8.5-traffic",
    seed:"rw8.5-traffic",
    entries,
    drivers:entries.map((entry,index)=>({
      driverId:entry.driverId,
      teamId:entry.teamId,
      ratings:{pace:78+index},
      performance:{raceScore:78+index,conditionModifier:0},
    })),
    cars:entries.map((entry,index)=>({
      carId:entry.carId,
      driverId:entry.driverId,
      teamId:entry.teamId,
      performance:{
        overall:78+index,
        qualifying:78+index,
        race:78+index,
        reliability:82,
        chassis:78+index,
        power:78+index,
      },
      state:{componentCondition:{engine:100}},
    })),
    startingGrid:entries.map((entry,index)=>({
      grid:index+1,
      driver_id:entry.driverId,
      team_id:entry.teamId,
    })),
    track:{
      schemaVersion:2,
      trackId:"traffic-test",
      year:1980,
      lengthM:1000,
      laps,
      startFinish:{progress:0,distanceM:0},
      sectors:[
        {id:"sector_1",sector:1,startM:0,endM:333,lengthM:333},
        {id:"sector_2",sector:2,startM:333,endM:666,lengthM:333},
        {id:"sector_3",sector:3,startM:666,endM:1000,lengthM:334},
      ],
      speedProfile:{
        source:"neutral",
        detailed:false,
        sampleSpacingM:1000,
        windowM:null,
        samples:[{distanceM:0,severity:0}],
      },
    },
  };
}

function runningState({laps=10,cars=3,stepMs=100}={}){
  return startRaceState(createRaceState(input({laps,cars}),{stepMs}));
}

function patchCars(state,patches){
  const byId=new Map(Object.entries(patches||{}));
  return {
    ...state,
    cars:state.cars.map((car)=>({...car,...(byId.get(car.carId)||{})})),
  };
}

function car(state,id){
  return state.cars.find((row)=>row.carId===id);
}

test("RW8.5 grid positions start as canonical physical distance, not overlapping zeroes",()=>{
  const state=createRaceState(input({cars:4}));
  assert.deepEqual(
    state.cars.map((row)=>row.absoluteDistanceM),
    [0,-8,-16,-24]
  );
  assert.deepEqual(
    state.cars.map((row)=>row.gridStartOffsetM),
    [0,-8,-16,-24]
  );
  assert.equal(RACE_GRID_SLOT_SPACING_M,8);
  assert.equal(state.cars[1].distanceAlongLapM,992);
  assert.deepEqual(state.classification.map((row)=>row.carId),["C1","C2","C3","C4"]);
  assert.deepEqual(state.classification.map((row)=>row.gapToLeaderM),[0,8,16,24]);
});

test("RW8.5 traffic uses the nearest physical car ahead, even when it is a backmarker",()=>{
  let state=runningState({cars:3});
  state=patchCars(state,{
    C1:{absoluteDistanceM:2050,distanceAlongLapM:50,lap:3,completedLaps:2,speedMs:55,speedKmh:198},
    C2:{absoluteDistanceM:1080,distanceAlongLapM:80,lap:2,completedLaps:1,speedMs:45,speedKmh:162},
    C3:{absoluteDistanceM:2020,distanceAlongLapM:20,lap:3,completedLaps:2,speedMs:50,speedKmh:180},
  });

  const nearest=nearestTrafficAhead(state,car(state,"C1"));
  assert.equal(nearest.car.carId,"C2");
  assert.equal(nearest.gapM,30);

  state=patchCars(state,{
    C2:{dnf:true,status:"dnf",speedMs:0,speedKmh:0},
  });
  const afterRetirement=nearestTrafficAhead(state,car(state,"C1"));
  assert.equal(afterRetirement.car.carId,"C3");
  assert.equal(afterRetirement.gapM,970);
});

test("RW8.5 close following limits target speed before hard spacing is reached",()=>{
  let state=runningState({cars:2});
  state=patchCars(state,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144},
    C2:{absoluteDistanceM:90,distanceAlongLapM:90,speedMs:70,speedKmh:252},
  });

  const context=raceTrafficContext(state,car(state,"C2"));
  assert.equal(context.aheadCarId,"C1");
  assert.equal(context.gapM,10);
  assert.ok(context.desiredGapM>RACE_TRAFFIC_HARD_GAP_M);
  assert.ok(context.speedCeilingMs<40);

  const next=stepRaceState(state);
  const follower=car(next,"C2");
  assert.equal(follower.traffic.aheadCarId,"C1");
  assert.equal(follower.traffic.limited,true);
  assert.ok(follower.targetSpeedKmh<252);
  assert.ok(follower.speedKmh<252);
});

test("RW8.5 hard spacing prevents a faster follower from passing or overlapping",()=>{
  let state=runningState({cars:2,stepMs:1000});
  state=patchCars(state,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:10,speedKmh:36},
    C2:{absoluteDistanceM:94,distanceAlongLapM:94,speedMs:100,speedKmh:360},
  });

  const next=stepRaceState(state);
  const leader=car(next,"C1");
  const follower=car(next,"C2");
  const gap=leader.absoluteDistanceM-follower.absoluteDistanceM;

  assert.ok(gap>=RACE_TRAFFIC_HARD_GAP_M-1e-6);
  assert.ok(follower.absoluteDistanceM<leader.absoluteDistanceM);
  assert.equal(follower.traffic.limited,true);
  assert.equal(follower.traffic.hardLimited,true);
});

test("RW8.5 a train preserves road order and physical minimum gaps over time",()=>{
  let state=runningState({cars:3});
  state=patchCars(state,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:42,speedKmh:151.2},
    C2:{absoluteDistanceM:92,distanceAlongLapM:92,speedMs:58,speedKmh:208.8},
    C3:{absoluteDistanceM:84,distanceAlongLapM:84,speedMs:62,speedKmh:223.2},
  });

  const next=advanceRaceState(state,{steps:150});
  const [first,second,third]=["C1","C2","C3"].map((id)=>car(next,id));

  assert.ok(first.absoluteDistanceM>second.absoluteDistanceM);
  assert.ok(second.absoluteDistanceM>third.absoluteDistanceM);
  assert.ok(first.absoluteDistanceM-second.absoluteDistanceM>=RACE_TRAFFIC_HARD_GAP_M-1e-6);
  assert.ok(second.absoluteDistanceM-third.absoluteDistanceM>=RACE_TRAFFIC_HARD_GAP_M-1e-6);
});

test("RW8.5 retired cars are not traffic blockers",()=>{
  let state=runningState({cars:2});
  state=patchCars(state,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,status:"dnf",dnf:true,speedMs:0,speedKmh:0},
    C2:{absoluteDistanceM:90,distanceAlongLapM:90,speedMs:50,speedKmh:180},
  });

  assert.equal(nearestTrafficAhead(state,car(state,"C2")),null);
  const next=advanceRaceState(state,{steps:40});
  assert.ok(car(next,"C2").absoluteDistanceM>100);
  assert.equal(car(next,"C1").absoluteDistanceM,100);
});

test("RW8.5 Live and Fast share identical traffic-limited canonical state",()=>{
  let initial=runningState({cars:3});
  initial=patchCars(initial,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:45,speedKmh:162},
    C2:{absoluteDistanceM:91,distanceAlongLapM:91,speedMs:60,speedKmh:216},
    C3:{absoluteDistanceM:82,distanceAlongLapM:82,speedMs:65,speedKmh:234},
  });

  const fast=runFastRace(initial,{steps:100});
  const live=createLiveRaceRunner(initial);
  live.advanceElapsed(10000);

  assert.deepEqual(live.getState(),fast);
  assert.deepEqual(live.getState().classification,fast.classification);
  const ordered=live.getState().classification.map((row)=>row.carId);
  assert.deepEqual(ordered,fast.classification.map((row)=>row.carId));
  const first=car(live.getState(),"C1");
  const second=car(live.getState(),"C2");
  assert.ok(first.absoluteDistanceM-second.absoluteDistanceM>=RACE_TRAFFIC_HARD_GAP_M-1e-6);
});
