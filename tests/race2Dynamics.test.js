import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { advanceRaceState, startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import {
  eraStraightSpeedKmh,
  raceDynamicsForCar,
  raceTargetSpeedProfile,
} from "../src/race2/core/RaceDynamics.js";

function speedProfile({corner=false}={}){
  if(!corner){
    return {
      source:"neutral",
      detailed:false,
      sampleSpacingM:1000,
      windowM:null,
      samples:[{distanceM:0,severity:0}],
    };
  }
  return {
    source:"test",
    detailed:true,
    sampleSpacingM:100,
    windowM:50,
    samples:[
      {distanceM:0,severity:0},
      {distanceM:100,severity:0},
      {distanceM:200,severity:0},
      {distanceM:300,severity:0},
      {distanceM:400,severity:0},
      {distanceM:500,severity:1},
      {distanceM:600,severity:0.25},
      {distanceM:700,severity:0},
      {distanceM:800,severity:0},
      {distanceM:900,severity:0},
    ],
  };
}

function input({
  power=70,
  race=70,
  chassis=70,
  driver=70,
  corner=false,
}={}){
  return {
    schemaVersion:4,
    engineVersion:"rw2",
    weekendKey:"rw8.3b-dynamics",
    seed:"rw8.3b-dynamics",
    entries:[{driverId:"D1",teamId:"T1",carId:"C1",status:"confirmed"}],
    drivers:[{
      driverId:"D1",
      teamId:"T1",
      ratings:{pace:driver},
      performance:{raceScore:driver,conditionModifier:0},
    }],
    cars:[{
      carId:"C1",
      driverId:"D1",
      teamId:"T1",
      performance:{overall:race,qualifying:race,race,reliability:80,chassis,power},
      state:{componentCondition:{engine:100}},
    }],
    startingGrid:[{grid:1,driver_id:"D1",team_id:"T1"}],
    track:{
      schemaVersion:2,
      trackId:"test",
      year:1980,
      lengthM:1000,
      laps:3,
      startFinish:{progress:0,distanceM:0},
      sectors:[
        {id:"sector_1",sector:1,startM:0,endM:333,lengthM:333},
        {id:"sector_2",sector:2,startM:333,endM:666,lengthM:333},
        {id:"sector_3",sector:3,startM:666,endM:1000,lengthM:334},
      ],
      speedProfile:speedProfile({corner}),
    },
  };
}

function runningState(options={}){
  return startRaceState(createRaceState(input(options),{stepMs:100}));
}

function patchCar(state,patch){
  return {
    ...state,
    cars:state.cars.map((car)=>({...car,...patch})),
  };
}

test("RW8.3B era speed envelope remains historical and monotonic",()=>{
  assert.ok(eraStraightSpeedKmh(1950)<eraStraightSpeedKmh(1980));
  assert.ok(eraStraightSpeedKmh(1980)<eraStraightSpeedKmh(2020));
  assert.equal(eraStraightSpeedKmh(1980),315);
});

test("RW8.3B stronger car and driver produce a higher straight target speed",()=>{
  const low=runningState({power:50,race:50,chassis:50,driver:50});
  const high=runningState({power:90,race:90,chassis:90,driver:90});

  const lowTarget=raceTargetSpeedProfile(low,low.cars[0]).targetSpeedKmh;
  const highTarget=raceTargetSpeedProfile(high,high.cars[0]).targetSpeedKmh;

  assert.ok(highTarget>lowTarget);
  assert.ok(lowTarget>250);
  assert.ok(highTarget<340);
});

test("RW8.3B verified corner severity lowers target speed",()=>{
  let state=runningState({power:80,race:80,chassis:80,driver:80,corner:true});
  const straight=raceTargetSpeedProfile(state,{...state.cars[0],distanceAlongLapM:100,speedMs:10});
  const corner=raceTargetSpeedProfile(state,{...state.cars[0],distanceAlongLapM:500,speedMs:10});

  assert.ok(corner.cornerSeverity>0.9);
  assert.ok(corner.targetSpeedKmh<straight.targetSpeedKmh-100);
});

test("RW8.3B braking starts before the corner through physical lookahead",()=>{
  let state=runningState({power:80,race:80,chassis:80,driver:80,corner:true});
  state=patchCar(state,{
    absoluteDistanceM:300,
    distanceAlongLapM:300,
    speedMs:280/3.6,
    speedKmh:280,
  });

  const dynamics=raceDynamicsForCar(state,state.cars[0]);
  assert.ok(dynamics.effectiveCornerSeverity>dynamics.cornerSeverity);
  assert.ok(dynamics.targetSpeedKmh<280);
  assert.ok(dynamics.accelerationMs2<0);

  const next=stepRaceState(state);
  assert.ok(next.cars[0].speedKmh<280);
  assert.ok(next.cars[0].accelerationMs2<0);
  assert.ok(next.cars[0].dynamicsLookaheadM>100);
});

test("RW8.3B canonical core accelerates from rest and persists speed telemetry",()=>{
  const state=runningState({power:82,race:80,chassis:78,driver:81});
  const next=stepRaceState(state);
  const car=next.cars[0];

  assert.ok(car.accelerationMs2>0);
  assert.ok(car.speedKmh>0);
  assert.ok(car.targetSpeedKmh>0);
  assert.equal(car.cornerSeverity,0);
  assert.ok(car.absoluteDistanceM>0);
});

test("RW8.3B sector boundaries do not create pace discontinuities",()=>{
  const state=runningState({power:75,race:75,chassis:75,driver:75});
  const before=raceTargetSpeedProfile(state,{...state.cars[0],distanceAlongLapM:332,speedMs:50});
  const after=raceTargetSpeedProfile(state,{...state.cars[0],distanceAlongLapM:334,speedMs:50});

  assert.equal(before.targetSpeedKmh,after.targetSpeedKmh);
  assert.equal(before.cornerSeverity,after.cornerSeverity);
});

test("RW8.3B fixed-step dynamics remain deterministic",()=>{
  const initial=runningState({power:84,race:82,chassis:80,driver:83,corner:true});
  const a=advanceRaceState(initial,{steps:120});
  const b=advanceRaceState(initial,{steps:120});

  assert.deepEqual(a,b);
  assert.equal(a.tick,120);
  assert.ok(a.cars[0].absoluteDistanceM>0);
});

test("distance-sensitive braking keeps approaching straight speed until the physically required braking zone",()=>{
  const state=runningState({power:84,race:82,chassis:80,driver:83,corner:true});
  const track={
    ...state.track,
    speedProfile:{...state.track.speedProfile,brakingModel:"distance_sensitive"},
  };
  const approaching={...state.cars[0],speedMs:280/3.6,speedKmh:280};
  const earlier=raceTargetSpeedProfile({...state,track},{
    ...approaching,distanceAlongLapM:300,
  });
  const near=raceTargetSpeedProfile({...state,track},{
    ...approaching,distanceAlongLapM:480,
  });
  assert.ok(earlier.targetSpeedKmh>near.targetSpeedKmh+35,
    "a car 200 m from a slow turn must not be held at the corner speed already");
  assert.ok(near.targetSpeedKmh<earlier.targetSpeedKmh);
  assert.ok(earlier.targetSpeedKmh<=earlier.straightTargetKmh);
});
