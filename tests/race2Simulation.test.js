import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState, DEFAULT_RACE_STEP_MS, RACE_STATE_SCHEMA_VERSION } from "../src/race2/core/RaceState.js";
import { advanceRaceState, startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import { applyCanonicalLapTiming, canonicalOfficialRaceTimeMs } from "../src/race2/core/RaceLapTiming.js";

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
  assert.ok(car.finishTimeMs>=9500&&car.finishTimeMs<=10500,"crossing must be timed inside the finalized fixed step");
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


test("RW9B schema-11 runtime migration seeds the official clock from canonical car timing",()=>{
  const legacy={
    schemaVersion:11,
    simulationTimeMs:99_000,
    session:{clock:{elapsedMs:99_000}},
    cars:[
      {carId:"C1",status:"running",elapsedMs:42_500,finishTimeMs:null},
      {carId:"C2",status:"finished",elapsedMs:44_100,finishTimeMs:44_100},
    ],
  };
  assert.equal(canonicalOfficialRaceTimeMs(legacy),44_100);
});


test("RW9B2 resumed schema-11 partial lap cannot become fastest lap",()=>{
  const legacy={
    schemaVersion:11,
    simulationTimeMs:50_000,
    session:{lapLimit:3,clock:{elapsedMs:50_000}},
    track:{lengthM:100,laps:3},
    cars:[{
      carId:"car_1",
      gridPosition:1,
      status:"running",
      dnf:false,
      absoluteDistanceM:190,
      distanceAlongLapM:90,
      completedLaps:1,
      lap:2,
      elapsedMs:50_000,
      finishTimeMs:null,
      pitState:{status:"track"},
    }],
  };
  const nextCar={
    ...legacy.cars[0],
    absoluteDistanceM:205,
    distanceAlongLapM:5,
    completedLaps:2,
    lap:3,
  };
  const [migrated]=applyCanonicalLapTiming(legacy,[nextCar],{stepMs:1000});
  assert.equal(migrated.lapTimes.length,0);
  assert.equal(migrated.bestLapMs,null);
  assert.equal(migrated.bestLapNumber,null);
  assert.equal(migrated.lapTimingBaselineValid,true);
  assert.ok(migrated.lapStartedAtMs>=50_000&&migrated.lapStartedAtMs<=51_000);
});


test("RW10G canonical sector crossings sum to official lap time and preserve lap deltas",()=>{
  let state=startRaceState(createRaceState(input({laps:2,cars:1}),{stepMs:1000}));

  const advanceTiming=(distance,{stepMs=1000,status="running"}={})=>{
    const previous=state.cars[0];
    const completedLaps=Math.max(0,Math.floor(distance/state.track.lengthM));
    const distanceAlongLapM=((distance%state.track.lengthM)+state.track.lengthM)%state.track.lengthM;
    const nextCar={
      ...previous,
      absoluteDistanceM:distance,
      distanceAlongLapM,
      completedLaps,
      lap:Math.min(state.session.lapLimit,completedLaps+1),
      sector:distanceAlongLapM<33?1:distanceAlongLapM<66?2:3,
      status,
    };
    const [timed]=applyCanonicalLapTiming(state,[nextCar],{stepMs});
    const officialStart=canonicalOfficialRaceTimeMs(state);
    state={
      ...state,
      officialRaceTimeMs:officialStart+stepMs,
      session:{
        ...state.session,
        clock:{
          ...(state.session.clock||{}),
          officialElapsedMs:officialStart+stepMs,
        },
      },
      cars:[timed],
    };
    return timed;
  };

  let car=advanceTiming(40);
  assert.equal(car.sectorTimes.length,1);
  assert.equal(car.sectorTimes[0].sector,1);
  assert.equal(car.sector1Ms,825);

  car=advanceTiming(75);
  assert.equal(car.sectorTimes.length,2);
  assert.equal(car.sectorTimes[1].sector,2);

  car=advanceTiming(100);
  assert.equal(car.sectorTimes.length,3);
  assert.deepEqual(car.sectorTimes.map((row)=>row.sector),[1,2,3]);
  assert.equal(car.lastLapMs,3000);
  assert.equal(
    Number((car.sector1Ms+car.sector2Ms+car.sector3Ms).toFixed(3)),
    car.lastLapMs
  );
  assert.equal(car.previousLapMs,null);
  assert.equal(car.lastLapDeltaMs,null);

  car=advanceTiming(200,{stepMs:4000,status:"finished"});
  assert.equal(car.sectorTimes.length,6);
  assert.equal(car.lastLapMs,4000);
  assert.equal(car.previousLapMs,3000);
  assert.equal(car.lastLapDeltaMs,1000);
  assert.equal(
    Number((car.sector1Ms+car.sector2Ms+car.sector3Ms).toFixed(3)),
    car.lastLapMs
  );
});

test("RW10G migrated runtime skips one partial sector instead of inventing a fastest split",()=>{
  const legacy={
    schemaVersion:12,
    officialRaceTimeMs:50_000,
    session:{lapLimit:3,clock:{officialElapsedMs:50_000}},
    track:{
      lengthM:100,
      laps:3,
      sectors:[
        {sector:1,startM:0,endM:33},
        {sector:2,startM:33,endM:66},
        {sector:3,startM:66,endM:100},
      ],
    },
    cars:[{
      carId:"car_1",
      gridPosition:1,
      status:"running",
      dnf:false,
      absoluteDistanceM:40,
      distanceAlongLapM:40,
      completedLaps:0,
      lap:1,
      elapsedMs:50_000,
      lapStartedAtMs:0,
      lapTimingBaselineValid:true,
      pitState:{status:"track"},
    }],
  };
  const nextCar={
    ...legacy.cars[0],
    absoluteDistanceM:70,
    distanceAlongLapM:70,
    sector:3,
  };
  const [migrated]=applyCanonicalLapTiming(legacy,[nextCar],{stepMs:1000});

  assert.equal(migrated.sectorTimes.length,0);
  assert.equal(migrated.sectorTimingBaselineValid,true);
  assert.ok(migrated.sectorStartedAtMs>=50_000&&migrated.sectorStartedAtMs<=51_000);
});


test("RW13A canonical lap timing records position gained or lost during each completed lap",()=>{
  let state=startRaceState(createRaceState(input({laps:3,cars:2}),{stepMs:100}));
  state={
    ...state,
    cars:state.cars.map((car)=>car.carId==="car_2"?{
      ...car,
      absoluteDistanceM:95,
      distanceAlongLapM:95,
      completedLaps:0,
      lap:1,
      sector:3,
      gridPosition:2,
      lastLapPosition:2,
    }:car),
  };
  const previous=state.cars.find((car)=>car.carId==="car_2");
  const firstCrossing={
    ...previous,
    absoluteDistanceM:105,
    distanceAlongLapM:5,
    completedLaps:1,
    lap:2,
    sector:1,
  };
  const [afterLapOne]=applyCanonicalLapTiming(state,[firstCrossing],{
    stepMs:100,
    positionByCar:new Map([["car_2",1]]),
  });
  assert.equal(afterLapOne.previousLapPosition,2);
  assert.equal(afterLapOne.lastLapPosition,1);
  assert.equal(afterLapOne.positionChangeLastLap,1);
  assert.deepEqual(afterLapOne.lapPositionHistory,[{
    lap:1,position:1,previousPosition:2,change:1,
  }]);

  const secondState={
    ...state,
    officialRaceTimeMs:100,
    session:{
      ...state.session,
      clock:{...(state.session.clock||{}),officialElapsedMs:100},
    },
    cars:[{
      ...afterLapOne,
      absoluteDistanceM:195,
      distanceAlongLapM:95,
      completedLaps:1,
      lap:2,
      sector:3,
    }],
  };
  const secondCrossing={
    ...secondState.cars[0],
    absoluteDistanceM:205,
    distanceAlongLapM:5,
    completedLaps:2,
    lap:3,
    sector:1,
  };
  const [afterLapTwo]=applyCanonicalLapTiming(secondState,[secondCrossing],{
    stepMs:100,
    positionByCar:new Map([["car_2",2]]),
  });
  assert.equal(afterLapTwo.previousLapPosition,1);
  assert.equal(afterLapTwo.lastLapPosition,2);
  assert.equal(afterLapTwo.positionChangeLastLap,-1);
  assert.deepEqual(afterLapTwo.lapPositionHistory.at(-1),{
    lap:2,position:2,previousPosition:1,change:-1,
  });
});
