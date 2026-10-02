import test from "node:test";
import assert from "node:assert/strict";

import { damageStateFromComponents } from "../src/engine/CarDamageEngine.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { raceTargetSpeedProfile } from "../src/race2/core/RaceDynamics.js";
import {
  advanceRetirementTrackside,
  raceIncidentHazardProbability,
  resolveRaceIncidents,
} from "../src/race2/core/RaceIncidents.js";
import { startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import { createLiveRaceRunner, runFastRace } from "../src/race2/core/RaceRunner.js";

function input({
  seed="rw8.10-incidents",
  mechanicalChance=0,
  accidentChance=0,
  accidentRetirementChance=0,
}={}){
  const entries=[
    {driverId:"D1",teamId:"T1",carId:"C1",status:"confirmed"},
    {driverId:"D2",teamId:"T2",carId:"C2",status:"confirmed"},
  ];
  const reliability=(teamId)=>({
    profile:{
      team_id:teamId,
      reliability:0.82,
      reliability_pct:82,
      historical:{engine_pct:80},
      components:[],
      source:"test_reliability",
    },
    mechanicalFailureChance:mechanicalChance,
    accidentIncidentChance:accidentChance,
    accidentConditionalRetirementChance:accidentRetirementChance,
  });
  return {
    schemaVersion:11,
    engineVersion:"rw2",
    weekendKey:"rw8.10-incidents",
    seed,
    year:1980,
    entries,
    drivers:[
      {driverId:"D1",teamId:"T1",performance:{raceScore:80,overtaking:70,defending:70,mistakePropensity:35,aggression:55,tyreManagement:70}},
      {driverId:"D2",teamId:"T2",performance:{raceScore:80,overtaking:70,defending:70,mistakePropensity:35,aggression:55,tyreManagement:70}},
    ],
    cars:[
      {
        carId:"C1",driverId:"D1",teamId:"T1",
        state:{componentCondition:{engine:100}},
        reliability:reliability("T1"),
        performance:{overall:80,qualifying:80,race:80,reliability:82,chassis:80,power:80},
      },
      {
        carId:"C2",driverId:"D2",teamId:"T2",
        state:{componentCondition:{engine:100}},
        reliability:reliability("T2"),
        performance:{overall:80,qualifying:80,race:80,reliability:82,chassis:80,power:80},
      },
    ],
    startingGrid:[
      {grid:1,driver_id:"D1",team_id:"T1"},
      {grid:2,driver_id:"D2",team_id:"T2"},
    ],
    weather:{state:"SUNNY",avg_temp_c:22,track_temp_c:34},
    track:{
      schemaVersion:2,
      trackId:"incident-test",
      year:1980,
      lengthM:1000,
      laps:4,
      traits:{tyreWear:50},
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

function runningState(options={}){
  return startRaceState(createRaceState(input(options),{stepMs:100}));
}

function car(state,id="C1"){
  return state.cars.find((row)=>row.carId===id);
}

function patchCars(state,patches){
  const byId=new Map(Object.entries(patches||{}));
  return {
    ...state,
    cars:state.cars.map((row)=>({...row,...(byId.get(row.carId)||{})})),
  };
}

test("RW8.10 distance hazard composes to the snapshotted whole-race probability",()=>{
  const total=0.24;
  const half=raceIncidentHazardProbability(total,0.5);
  const composed=1-(1-half)*(1-half);
  assert.ok(Math.abs(composed-total)<1e-12);
  assert.equal(raceIncidentHazardProbability(0,1),0);
});

test("RW8.10 contact uses the shared CarDamageEngine and persists canonical damage",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:55,speedKmh:198,effectiveCornerSeverity:0.65},
    C2:{absoluteDistanceM:99,distanceAlongLapM:99,speedMs:35,speedKmh:126,effectiveCornerSeverity:0.65},
  });
  const source=[{
    type:"contact",
    carIds:["C1","C2"],
    driverIds:["D1","D2"],
    payload:{attemptId:"contact-test",probability:0.5},
  }];

  const first=resolveRaceIncidents(state,state.cars,source,{stepMs:100});
  const second=resolveRaceIncidents(state,state.cars,source,{stepMs:100});

  assert.deepEqual(first,second);
  assert.ok(car({cars:first.cars},"C1").damage);
  assert.ok(car({cars:first.cars},"C2").damage);
  assert.equal(first.events.filter((event)=>event.type==="damage").length,2);
});

test("RW8.10 contact retirement is independent from solo-accident conditional retirement calibration",()=>{
  let base=runningState({accidentRetirementChance:0});
  base=patchCars(base,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:42,speedKmh:151.2,effectiveCornerSeverity:0.15},
    C2:{absoluteDistanceM:99,distanceAlongLapM:99,speedMs:40,speedKmh:144,effectiveCornerSeverity:0.15},
  });
  const source=[{
    type:"contact",
    carIds:["C1","C2"],
    driverIds:["D1","D2"],
    payload:{attemptId:"contact-retirement-calibration"},
  }];

  const lowConditional=resolveRaceIncidents(base,base.cars,source,{stepMs:100});
  const highState={
    ...base,
    cars:base.cars.map((row)=>({
      ...row,
      reliability:{...row.reliability,accidentConditionalRetirementChance:1},
    })),
  };
  const highConditional=resolveRaceIncidents(highState,highState.cars,source,{stepMs:100});

  assert.deepEqual(
    lowConditional.cars.map((row)=>({carId:row.carId,dnf:row.dnf,damage:row.damage})),
    highConditional.cars.map((row)=>({carId:row.carId,dnf:row.dnf,damage:row.damage}))
  );
});

test("RW8.10 finish-crossing distance still contributes to incident exposure",()=>{
  let state=runningState({mechanicalChance:1});
  state=patchCars(state,{
    C1:{absoluteDistanceM:3990,distanceAlongLapM:990,completedLaps:3,lap:4,status:"running"},
  });
  const moved=state.cars.map((row)=>row.carId==="C1"?{
    ...row,
    absoluteDistanceM:4000,
    distanceAlongLapM:0,
    completedLaps:4,
    lap:4,
    status:"finished",
    speedMs:55,
    speedKmh:198,
  }:row);

  const resolved=resolveRaceIncidents(state,moved,[],{stepMs:100});
  const failed=car({cars:resolved.cars},"C1");
  assert.equal(failed.dnf,true);
  assert.equal(failed.retirement.kind,"mechanical");
  assert.ok(resolved.events.some((event)=>event.type==="mechanical_failure"&&event.carIds.includes("C1")));
});

test("RW8.10 guaranteed mechanical exposure creates canonical DNF with reason",()=>{
  let state=runningState({mechanicalChance:1});
  const moved=state.cars.map((row)=>({
    ...row,
    absoluteDistanceM:row.absoluteDistanceM+100,
    distanceAlongLapM:100,
    speedMs:50,
    speedKmh:180,
  }));
  const resolved=resolveRaceIncidents(state,moved,[],{stepMs:100});
  const failed=car({cars:resolved.cars},"C1");

  assert.equal(failed.dnf,true);
  assert.equal(failed.status,"dnf");
  assert.equal(failed.speedMs,0);
  assert.equal(failed.retirement.kind,"mechanical");
  assert.ok(failed.retirement.reason);
  assert.ok(resolved.events.some((event)=>event.type==="mechanical_failure"&&event.carIds.includes("C1")));
  assert.ok(resolved.events.some((event)=>event.type==="retirement"&&event.carIds.includes("C1")));
});

test("RW8.10 canonical damage lowers pace through shared damage pace-loss output",()=>{
  const state=patchCars(runningState(),{
    C1:{speedMs:50,speedKmh:180,distanceAlongLapM:150,absoluteDistanceM:150,effectiveCornerSeverity:0},
  });
  const clean=car(state,"C1");
  const damaged={
    ...clean,
    damage:damageStateFromComponents({front_wing:80,floor:70,suspension:45}),
  };

  const cleanProfile=raceTargetSpeedProfile(state,clean);
  const damagedProfile=raceTargetSpeedProfile(state,damaged);
  assert.ok(damaged.damage.pace_loss_s_per_lap>0);
  assert.ok(damagedProfile.damagePaceMultiplier<1);
  assert.ok(damagedProfile.targetSpeedKmh<cleanProfile.targetSpeedKmh);
});

test("RW8.10 DNF cars freeze on subsequent canonical simulation steps",()=>{
  let state=runningState({mechanicalChance:1});
  state=patchCars(state,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:60,speedKmh:216},
    C2:{absoluteDistanceM:80,distanceAlongLapM:80,speedMs:60,speedKmh:216},
  });

  const next=stepRaceState(state);
  const failed=car(next,"C1");
  assert.equal(failed.dnf,true);
  const frozenDistance=failed.absoluteDistanceM;
  const after=stepRaceState(next);
  assert.equal(car(after,"C1").absoluteDistanceM,frozenDistance);
  assert.equal(car(after,"C1").speedMs,0);
});

test("RW8.10 Live and Fast execute identical incidents, damage, DNF and events",()=>{
  let initial=runningState({
    seed:"rw8.10-parity",
    mechanicalChance:1,
    accidentChance:0,
  });
  initial=patchCars(initial,{
    C1:{speedMs:20,speedKmh:72},
    C2:{speedMs:20,speedKmh:72},
  });

  const fast=runFastRace(initial,{steps:30});
  const live=createLiveRaceRunner(initial);
  for(let index=0;index<30;index+=1)live.step();

  assert.deepEqual(live.getState(),fast);
  assert.deepEqual(live.getState().events,fast.events);
  assert.deepEqual(live.getState().cars.map((row)=>row.damage),fast.cars.map((row)=>row.damage));
  assert.deepEqual(live.getState().cars.map((row)=>row.retirement),fast.cars.map((row)=>row.retirement));
});


test("RW11G retired car stays trackside until the last running car passes the retirement point",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{
      absoluteDistanceM:500,
      distanceAlongLapM:500,
      completedLaps:0,
      lap:1,
      sector:2,
      speedMs:0,
      speedKmh:0,
      dnf:true,
      status:"dnf",
      retirement:{
        kind:"mechanical",
        reason:"Engine",
        source:"test",
        tick:10,
        timeMs:1000,
        trackside:{
          status:"parked",
          visible:true,
          parkedAbsoluteM:500,
          parkedDistanceAlongLapM:500,
          parkedLap:1,
          parkedSector:2,
          lateralOffsetM:5.25,
          passTargets:null,
          pendingCarIds:null,
          clearedAtTick:null,
          clearedAtTimeMs:null,
          clearedTo:"pit_box_pending_geometry",
        },
      },
    },
    C2:{
      absoluteDistanceM:450,
      distanceAlongLapM:450,
      completedLaps:0,
      lap:1,
      sector:2,
      speedMs:50,
      speedKmh:180,
      dnf:false,
      status:"running",
    },
  });

  const parked=advanceRetirementTrackside(state,state.cars);
  const retired=car({cars:parked.cars},"C1");
  assert.equal(retired.absoluteDistanceM,500);
  assert.equal(retired.retirement.trackside.status,"parked");
  assert.equal(retired.retirement.trackside.visible,true);
  assert.deepEqual(retired.retirement.trackside.pendingCarIds,["C2"]);
  assert.equal(retired.retirement.trackside.passTargets[0].targetAbsoluteM,500);
  assert.equal(parked.events.length,0);

  const progressed={
    ...state,
    tick:state.tick+1,
    simulationTimeMs:state.simulationTimeMs+100,
    cars:parked.cars.map((row)=>row.carId==="C2"?{
      ...row,
      absoluteDistanceM:510,
      distanceAlongLapM:510,
    }:row),
  };
  const cleared=advanceRetirementTrackside(progressed,progressed.cars);
  const clearedCar=car({cars:cleared.cars},"C1");
  assert.equal(clearedCar.absoluteDistanceM,500);
  assert.equal(clearedCar.retirement.trackside.status,"cleared");
  assert.equal(clearedCar.retirement.trackside.visible,false);
  assert.deepEqual(clearedCar.retirement.trackside.pendingCarIds,[]);
  assert.equal(cleared.events.length,1);
  assert.equal(cleared.events[0].type,"retirement_cleared");
});

test("RW11G a car already beyond the DNF point must complete its next physical pass before clearance",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{
      absoluteDistanceM:500,
      distanceAlongLapM:500,
      dnf:true,
      status:"dnf",
      speedMs:0,
      speedKmh:0,
      retirement:{
        kind:"accident",
        reason:"Accident",
        trackside:{
          status:"parked",
          visible:true,
          parkedAbsoluteM:500,
          parkedDistanceAlongLapM:500,
          lateralOffsetM:-5.25,
          passTargets:null,
        },
      },
    },
    C2:{
      absoluteDistanceM:700,
      distanceAlongLapM:700,
      completedLaps:0,
      lap:1,
      dnf:false,
      status:"running",
    },
  });

  const parked=advanceRetirementTrackside(state,state.cars);
  const trackside=car({cars:parked.cars},"C1").retirement.trackside;
  assert.equal(trackside.status,"parked");
  assert.equal(trackside.passTargets[0].targetAbsoluteM,1500);

  const beforeNextPass={
    ...state,
    cars:parked.cars.map((row)=>row.carId==="C2"?{
      ...row,
      absoluteDistanceM:1499,
      distanceAlongLapM:499,
      completedLaps:1,
      lap:2,
    }:row),
  };
  assert.equal(
    car({cars:advanceRetirementTrackside(beforeNextPass,beforeNextPass.cars).cars},"C1").retirement.trackside.status,
    "parked"
  );

  const afterNextPass={
    ...state,
    cars:parked.cars.map((row)=>row.carId==="C2"?{
      ...row,
      absoluteDistanceM:1501,
      distanceAlongLapM:501,
      completedLaps:1,
      lap:2,
    }:row),
  };
  assert.equal(
    car({cars:advanceRetirementTrackside(afterNextPass,afterNextPass.cars).cars},"C1").retirement.trackside.status,
    "cleared"
  );
});
