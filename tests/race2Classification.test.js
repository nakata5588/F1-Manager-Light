import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import { projectCanonicalRaceTiming } from "../src/race2/core/RaceClassification.js";
import { createLiveRaceRunner, runFastRace } from "../src/race2/core/RaceRunner.js";

function input({laps=3,cars=3}={}){
  const entries=Array.from({length:cars},(_,index)=>({
    driverId:`D${index+1}`,
    teamId:index<2?"T1":"T2",
    carId:`C${index+1}`,
    status:"confirmed",
  }));
  return {
    schemaVersion:5,
    engineVersion:"rw2",
    weekendKey:"rw8.4-classification",
    seed:"rw8.4-classification",
    entries,
    drivers:entries.map((entry)=>({
      driverId:entry.driverId,
      teamId:entry.teamId,
      ratings:{pace:80},
    })),
    cars:entries.map((entry)=>({
      carId:entry.carId,
      driverId:entry.driverId,
      teamId:entry.teamId,
      state:{componentCondition:{engine:100}},
    })),
    startingGrid:entries.map((entry,index)=>({
      grid:index+1,
      driver_id:entry.driverId,
      team_id:entry.teamId,
    })),
    track:{
      schemaVersion:2,
      trackId:"test",
      year:1980,
      lengthM:100,
      laps,
      startFinish:{progress:0,distanceM:0},
      sectors:[
        {id:"sector_1",sector:1,startM:0,endM:33,lengthM:33},
        {id:"sector_2",sector:2,startM:33,endM:66,lengthM:33},
        {id:"sector_3",sector:3,startM:66,endM:100,lengthM:34},
      ],
      speedProfile:{
        source:"neutral",
        detailed:false,
        sampleSpacingM:100,
        windowM:null,
        samples:[{distanceM:0,severity:0}],
      },
    },
  };
}

function runningState(options={}){
  return startRaceState(createRaceState(input(options),{stepMs:100}));
}

function patchCars(state,patches){
  const byId=new Map(Object.entries(patches||{}));
  return {
    ...state,
    cars:state.cars.map((car)=>({...car,...(byId.get(car.carId)||{})})),
  };
}

test("RW8.4 classification order comes only from canonical absolute distance",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{absoluteDistanceM:120,distanceAlongLapM:20,lap:2,completedLaps:1,speedMs:50,speedKmh:180},
    C2:{absoluteDistanceM:155,distanceAlongLapM:55,lap:2,completedLaps:1,speedMs:50,speedKmh:180},
    C3:{absoluteDistanceM:140,distanceAlongLapM:40,lap:2,completedLaps:1,speedMs:50,speedKmh:180},
  });
  state={...state,cars:[state.cars[2],state.cars[0],state.cars[1]]};

  const {classification}=projectCanonicalRaceTiming(state);

  assert.deepEqual(classification.map((row)=>row.carId),["C2","C3","C1"]);
  assert.deepEqual(classification.map((row)=>row.position),[1,2,3]);
  assert.equal(classification[0].gapToLeaderM,0);
  assert.equal(classification[1].gapToLeaderM,15);
  assert.equal(classification[2].gapToLeaderM,35);
});

test("RW8.4 live time gaps are deterministic projections from distance",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{absoluteDistanceM:250,distanceAlongLapM:50,lap:3,completedLaps:2,speedMs:50,speedKmh:180},
    C2:{absoluteDistanceM:225,distanceAlongLapM:25,lap:3,completedLaps:2,speedMs:50,speedKmh:180},
    C3:{absoluteDistanceM:120,distanceAlongLapM:20,lap:2,completedLaps:1,speedMs:50,speedKmh:180},
  });

  const projected=projectCanonicalRaceTiming(state);
  const [leader,second,third]=projected.classification;

  assert.equal(projected.timingState.source,"absolute_distance");
  assert.equal(projected.timingState.referenceSpeedMs,50);
  assert.equal(leader.gapToLeaderMs,0);
  assert.equal(second.gapToLeaderM,25);
  assert.equal(second.gapToLeaderMs,500);
  assert.equal(second.intervalMs,500);
  assert.equal(third.lapsBehind,1);
  assert.equal(third.gapToLeaderMs,null);
  assert.equal(third.timingBasis,"lap_gap");
});

test("RW8.4 a retired car freezes at its real distance and drops only when passed",()=>{
  let state=runningState({cars:2});
  state=patchCars(state,{
    C1:{absoluteDistanceM:240,distanceAlongLapM:40,lap:3,completedLaps:2,status:"dnf",dnf:true,speedMs:0,speedKmh:0},
    C2:{absoluteDistanceM:230,distanceAlongLapM:30,lap:3,completedLaps:2,speedMs:50,speedKmh:180},
  });

  let projected=projectCanonicalRaceTiming(state);
  assert.deepEqual(projected.classification.map((row)=>row.carId),["C1","C2"]);
  assert.equal(projected.classification[0].timingBasis,"leader");

  state=patchCars(state,{
    C2:{absoluteDistanceM:240,distanceAlongLapM:40},
  });
  projected=projectCanonicalRaceTiming(state);
  assert.deepEqual(
    projected.classification.map((row)=>row.carId),
    ["C1","C2"],
    "matching a retired car's frozen distance is not yet an overtake"
  );

  state=patchCars(state,{
    C2:{absoluteDistanceM:245,distanceAlongLapM:45},
  });
  projected=projectCanonicalRaceTiming(state);

  assert.deepEqual(projected.classification.map((row)=>row.carId),["C2","C1"]);
  assert.equal(projected.classification[1].timingBasis,"unavailable");
  assert.equal(projected.classification[1].gapToLeaderMs,null);
});

test("RW8.4 finish order uses interpolated crossing time inside the canonical tick",()=>{
  let state=runningState({laps:1,cars:2});
  state=patchCars(state,{
    C1:{absoluteDistanceM:99,distanceAlongLapM:99,sector:3,speedMs:10,speedKmh:36},
    C2:{absoluteDistanceM:99.5,distanceAlongLapM:99.5,sector:3,speedMs:10,speedKmh:36},
  });

  const next=stepRaceState(state);
  const [winner,second]=next.classification;

  assert.equal(next.status,"finished");
  assert.equal(winner.carId,"C2");
  assert.equal(second.carId,"C1");
  assert.equal(winner.finishTimeMs,50);
  assert.equal(second.finishTimeMs,100);
  assert.equal(second.gapToLeaderMs,50);
  assert.equal(second.intervalMs,50);
  assert.equal(second.timingBasis,"finish_time");
});

test("RW8.4 RaceState initializes and starts with canonical grid classification",()=>{
  const ready=createRaceState(input({cars:2}));
  assert.deepEqual(ready.classification.map((row)=>row.carId),["C1","C2"]);
  assert.ok(ready.classification.every((row)=>row.status==="ready"));

  const started=startRaceState(ready);
  assert.deepEqual(started.classification.map((row)=>row.carId),["C1","C2"]);
  assert.ok(started.classification.every((row)=>row.status==="running"));
  assert.equal(started.timingState.leaderCarId,"C1");
});

test("RW8.4 Live and Fast expose the same canonical classification",()=>{
  let initial=runningState({laps:5,cars:2});
  initial=patchCars(initial,{
    C1:{speedMs:50,speedKmh:180},
    C2:{speedMs:45,speedKmh:162},
  });

  const fast=runFastRace(initial,{steps:50});
  const live=createLiveRaceRunner(initial);
  live.advanceElapsed(5000);

  assert.deepEqual(live.getState().classification,fast.classification);
  assert.deepEqual(live.getState().timingState,fast.timingState);
  assert.deepEqual(live.getState(),fast);
});
