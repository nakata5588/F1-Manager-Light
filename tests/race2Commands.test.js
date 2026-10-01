import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelRaceCommand,
  queueRaceCommand,
} from "../src/race2/core/RaceCommands.js";
import { damageStateFromComponents } from "../src/engine/CarDamageEngine.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import { createLiveRaceRunner, runFastRace } from "../src/race2/core/RaceRunner.js";

function input({cars=1,refuellingAllowed=false}={}){
  const entries=Array.from({length:cars},(_,index)=>({
    driverId:`D${index+1}`,
    teamId:`T${index+1}`,
    carId:`C${index+1}`,
    status:"confirmed",
  }));
  const tyres=[
    {tyre_id:"soft",supplier:"Test",compound_name:"Soft",category:"dry",grip_index:84,wear_rate:0.020,warmup_time_s:2.2},
    {tyre_id:"hard",supplier:"Test",compound_name:"Hard",category:"dry",grip_index:76,wear_rate:0.014,warmup_time_s:3.0},
  ];
  return {
    schemaVersion:10,
    engineVersion:"rw2",
    weekendKey:"rw8.9-commands",
    seed:"rw8.9-commands",
    year:2026,
    entries,
    drivers:entries.map((entry)=>({
      driverId:entry.driverId,
      teamId:entry.teamId,
      performance:{
        raceScore:80,
        overtaking:75,
        defending:75,
        mistakePropensity:15,
        aggression:45,
        tyreManagement:70,
      },
    })),
    cars:entries.map((entry)=>({
      carId:entry.carId,
      driverId:entry.driverId,
      teamId:entry.teamId,
      state:{componentCondition:{engine:100}},
      resourceSetup:{
        strategy:{
          startTyreId:"soft",
          nextTyreId:"hard",
          paceMode:"balanced",
          fuelPlan:"balanced",
          pitPlan:"no_stop",
          plannedStopLap:null,
        },
        pitCrew:{
          avg_time_s:2.2,
          consistency:90,
          error_rate:0.005,
          execution_variance_s:0,
          fatigue:0,
        },
        tyres,
      },
      performance:{
        overall:80,
        qualifying:80,
        race:80,
        reliability:85,
        chassis:80,
        power:80,
      },
    })),
    rules:{race:{refuelling_allowed:refuellingAllowed}},
    startingGrid:entries.map((entry,index)=>({
      grid:index+1,
      driver_id:entry.driverId,
      team_id:entry.teamId,
    })),
    weather:{state:"SUNNY",avg_temp_c:22,track_temp_c:34},
    track:{
      schemaVersion:2,
      trackId:"command-test",
      year:2026,
      lengthM:1000,
      laps:4,
      traits:{tyreWear:50,pitLaneLossS:8},
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
      pitLane:{
        available:true,
        entryProgress:0.9,
        exitProgress:0.1,
        entryM:900,
        exitM:100,
        points:[],
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

function patchCar(state,id,patch){
  return {
    ...state,
    cars:state.cars.map((row)=>row.carId===id?{...row,...patch}:row),
  };
}

function atDistance(state,absolute,id="C1"){
  const length=state.track.lengthM;
  const distance=((absolute%length)+length)%length;
  return patchCar(state,id,{
    absoluteDistanceM:absolute,
    distanceAlongLapM:distance,
    completedLaps:Math.max(0,Math.floor(absolute/length)),
    lap:Math.floor(absolute/length)+1,
    sector:distance<333?1:distance<666?2:3,
    speedMs:60,
    speedKmh:216,
  });
}

function runUntil(state,predicate,{maxSteps=1000}={}){
  let next=state;
  for(let index=0;index<maxSteps;index+=1){
    if(predicate(next))return next;
    next=stepRaceState(next);
  }
  throw new Error("condition not reached");
}

test("RW8.9 pending commands have deterministic ids and newer same-type order replaces older",()=>{
  let state=runningState();
  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pace",
    payload:{paceMode:"attack"},
    effectiveAtTick:5,
  });
  assert.equal(state.commandQueue.length,1);
  assert.equal(state.commandQueue[0].id,"rw8.9-commands:cmd:1");
  assert.equal(state.commandQueue[0].sequence,1);
  assert.equal(state.nextCommandSequence,2);

  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pace",
    payload:{paceMode:"conserve"},
    effectiveAtTick:5,
  });
  assert.equal(state.commandQueue.length,1);
  assert.equal(state.commandQueue[0].id,"rw8.9-commands:cmd:2");
  assert.equal(state.commandQueue[0].payload.paceMode,"conserve");
  assert.equal(state.nextCommandSequence,3);

  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pace",
    payload:{paceMode:"balanced"},
    effectiveAtTick:8,
  });
  assert.equal(state.commandQueue.length,2);
  assert.deepEqual(state.commandQueue.map((row)=>row.effectiveAtTick),[5,8]);

  state=cancelRaceCommand(state,{driverId:"D1",type:"pace"});
  assert.deepEqual(state.commandQueue,[]);
  const cancelled=state.events.filter((event)=>event.type==="command_cancelled");
  assert.equal(cancelled.length,2);
  assert.deepEqual(cancelled.map((event)=>event.sequence),[1,2]);
  assert.equal(cancelled[0].payload.commandType,"pace");
  assert.equal(cancelled[0].payload.reason,"player_cancelled");
  assert.equal(state.nextEventSequence,3);
});

test("RW8.9 pace command applies on its canonical tick and becomes an official event",()=>{
  let state=runningState();
  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pace",
    payload:{paceMode:"attack"},
    effectiveAtTick:0,
  });
  const next=stepRaceState(state);

  assert.equal(car(next).resources.paceMode,"attack");
  assert.deepEqual(next.commandQueue,[]);
  const applied=next.events.find((event)=>event.type==="command_applied");
  assert.ok(applied);
  assert.equal(applied.payload.commandType,"pace");
  assert.equal(applied.payload.paceMode,"attack");
});

test("RW8.9 default command latency is one fixed tick",()=>{
  let state=runningState();
  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pace",
    payload:{paceMode:"attack"},
  });
  assert.equal(state.commandQueue[0].effectiveAtTick,1);

  const first=stepRaceState(state);
  assert.equal(car(first).resources.paceMode,"balanced");
  assert.equal(first.commandQueue.length,1);

  const second=stepRaceState(first);
  assert.equal(car(second).resources.paceMode,"attack");
  assert.equal(second.commandQueue.length,0);
});

test("RW8.9 pit command before entry commits to the nearest reachable pit lane",()=>{
  let state=atDistance(runningState(),898);
  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pit",
    payload:{tyreId:"hard",tyreChange:true,refuel:false},
    effectiveAtTick:0,
  });
  const next=stepRaceState(state);

  assert.equal(car(next).pitState.active,true);
  assert.equal(car(next).pitState.plannedStopLap,1);
  assert.equal(car(next).pitState.service.tyre_to,"hard");
  assert.ok(next.events.some((event)=>event.type==="command_applied"&&event.payload.plannedStopLap===1));
  assert.ok(next.events.some((event)=>event.type==="pit_entry"));
});

test("RW8.9 pit command after pit entry targets the following lap",()=>{
  let state=atDistance(runningState(),920);
  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pit",
    payload:{tyreId:"hard",tyreChange:true,refuel:false},
    effectiveAtTick:0,
  });
  const next=stepRaceState(state);

  assert.equal(car(next).pitState.active,false);
  assert.equal(car(next).resources.strategy.plannedStopLap,2);
  const applied=next.events.find((event)=>event.type==="command_applied");
  assert.equal(applied.payload.plannedStopLap,2);
});

test("RW8.9 same-compound pit call fits a fresh set instead of treating it as no change",()=>{
  let state=atDistance(runningState(),898);
  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pit",
    payload:{tyreId:"soft",tyreChange:true,refuel:false},
    effectiveAtTick:0,
  });
  state=stepRaceState(state);
  assert.equal(car(state).pitState.service.tyre_changed,true);
  assert.equal(car(state).pitState.service.tyre_from,"soft");
  assert.equal(car(state).pitState.service.tyre_to,"soft");

  const completed=runUntil(
    state,
    (candidate)=>car(candidate).pitState.completed&&!car(candidate).pitState.active
  );
  assert.equal(car(completed).tyre.tyre_id,"soft");
  assert.equal(car(completed).tyre.stint_number,2);
});

test("RW8.9 rejects commands for another team or unavailable tyres",()=>{
  const state=runningState();
  const wrongTeam=queueRaceCommand(state,{
    driverId:"D1",
    teamId:"T999",
    type:"pace",
    payload:{paceMode:"attack"},
  });
  assert.equal(wrongTeam,state);

  const badTyre=queueRaceCommand(state,{
    driverId:"D1",
    type:"pit",
    payload:{tyreId:"moon",tyreChange:true},
  });
  assert.equal(badTyre,state);
});

test("RW8.9 Live and Fast execute the same queued command through the same core",()=>{
  const initial=runningState();
  const command={
    driverId:"D1",
    type:"pace",
    payload:{paceMode:"attack"},
    effectiveAtTick:0,
  };

  const fast=runFastRace(queueRaceCommand(initial,command),{steps:80});
  const live=createLiveRaceRunner(initial);
  live.queueCommand(command);
  for(let index=0;index<80;index+=1)live.step();

  assert.deepEqual(live.getState(),fast);
});


test("RW10E repair-only pit command uses shared damage repair truth without changing tyres",()=>{
  let state=atDistance(runningState(),898);
  state=patchCar(state,"C1",{
    damage:damageStateFromComponents({
      front_wing:60,
      floor:40,
    },{source:"test_damage"}),
  });
  const startingTyre=car(state).tyre.tyre_id;

  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pit",
    payload:{
      tyreChange:false,
      refuel:false,
      repairComponents:["front_wing"],
    },
    effectiveAtTick:0,
  });
  assert.equal(state.commandQueue.length,1);
  assert.deepEqual(state.commandQueue[0].payload.repairComponents,["front_wing"]);

  state=stepRaceState(state);
  assert.equal(car(state).pitState.active,true);
  assert.equal(car(state).pitState.service.tyre_changed,false);
  assert.deepEqual(
    car(state).pitState.service.repair.repaired_components,
    ["front_wing"]
  );

  const completed=runUntil(
    state,
    (candidate)=>car(candidate).pitState.completed&&!car(candidate).pitState.active
  );
  const repaired=car(completed);

  assert.equal(repaired.tyre.tyre_id,startingTyre);
  assert.equal(repaired.damage.components.front_wing.damage_pct,0);
  assert.equal(repaired.damage.components.floor.damage_pct,40);
  assert.deepEqual(repaired.damage.damaged_components,["floor"]);
  assert.deepEqual(repaired.resources.strategy.repairComponentsRequested,[]);

  const serviceEvent=completed.events.find((event)=>
    event.type==="pit_service_completed"&&
    event.payload?.repairedComponents?.includes("front_wing")
  );
  assert.ok(serviceEvent);
  assert.deepEqual(serviceEvent.payload.repairedComponents,["front_wing"]);
  assert.ok(serviceEvent.payload.repairDurationS>0);
});

test("RW10E repairDamage normalizes to all currently damaged canonical components",()=>{
  let state=runningState();
  state=patchCar(state,"C1",{
    damage:damageStateFromComponents({
      front_wing:45,
      floor:35,
    },{source:"test_damage"}),
  });

  state=queueRaceCommand(state,{
    driverId:"D1",
    type:"pit",
    tyreChange:false,
    refuel:false,
    repairDamage:true,
  });

  assert.equal(state.commandQueue.length,1);
  assert.deepEqual(
    new Set(state.commandQueue[0].payload.repairComponents),
    new Set(["front_wing","floor"])
  );
});
