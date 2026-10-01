import test from "node:test";
import assert from "node:assert/strict";

import { normalisePitPhaseDurations } from "../src/domain/racePitModel.js";
import { createLivePitState } from "../src/engine/LivePitStopEngine.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { advanceRaceState, startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import { createLiveRaceRunner, runFastRace } from "../src/race2/core/RaceRunner.js";
import { nearestTrafficAhead } from "../src/race2/core/RaceTraffic.js";
import { presentCanonicalRaceEvent } from "../src/race2/presentation/RaceEventPresenter.js";

function input({
  year=1980,
  refuellingAllowed=true,
  cars=2,
  sameTeam=false,
  withPitAnchors=true,
  plannedStopLap=2,
  pitPlan="one_stop",
  laps=4,
}={}){
  const entries=Array.from({length:cars},(_,index)=>({
    driverId:`D${index+1}`,
    teamId:sameTeam?"T1":`T${index+1}`,
    carId:`C${index+1}`,
    status:"confirmed",
  }));
  const tyres=[
    {tyre_id:"soft",supplier:"Test",compound_name:"Soft",category:"dry",grip_index:84,wear_rate:0.020,warmup_time_s:2.2},
    {tyre_id:"hard",supplier:"Test",compound_name:"Hard",category:"dry",grip_index:76,wear_rate:0.014,warmup_time_s:3.0},
    {tyre_id:"inter",supplier:"Test",compound_name:"Intermediate",category:"intermediate",grip_index:70,wear_rate:0.016,warmup_time_s:2.8},
    {tyre_id:"wet",supplier:"Test",compound_name:"Wet",category:"wet",grip_index:66,wear_rate:0.018,warmup_time_s:2.6},
  ];
  return {
    schemaVersion:9,
    engineVersion:"rw2",
    weekendKey:"rw8.8-pits",
    seed:"rw8.8-pits",
    year,
    entries,
    drivers:entries.map((entry)=>({
      driverId:entry.driverId,
      teamId:entry.teamId,
      ratings:{},
      performance:{
        raceScore:80,
        conditionModifier:0,
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
          pitPlan,
          plannedStopLap,
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
      trackId:"pit-test",
      year,
      lengthM:1000,
      laps,
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
      pitLane:withPitAnchors?{
        available:true,
        entryProgress:0.9,
        exitProgress:0.1,
        entryM:900,
        exitM:100,
        points:[],
      }:{
        available:false,
        entryProgress:null,
        exitProgress:null,
        entryM:null,
        exitM:null,
        points:[],
      },
    },
  };
}

function runningState(options={},stepMs=100){
  return startRaceState(createRaceState(input(options),{stepMs}));
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

function placeBeforePit(state,id="C1",offsetM=2){
  const row=car(state,id);
  const lap=Number(row?.resources?.strategy?.plannedStopLap||2);
  const length=state.track.lengthM;
  const entry=state.track.pitLane.entryM;
  const entryAbs=entry==null?lap*length:(lap-1)*length+entry;
  const absolute=entryAbs-offsetM;
  return patchCar(state,id,{
    absoluteDistanceM:absolute,
    distanceAlongLapM:((absolute%length)+length)%length,
    completedLaps:Math.max(0,Math.floor(absolute/length)),
    lap:Math.floor(absolute/length)+1,
    sector:3,
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
  return next;
}

test("RW8.8 Legacy live playback and RW2 share one pit phase timing model",()=>{
  const stop={
    lap:10,
    pit_lane_loss_s:20,
    stationary_s:5,
    queue_delay_s:1.5,
    pit_lane_traffic_loss_s:0.4,
    release_delay_s:0.5,
    total_loss_s:27.4,
    tyre_to:"hard",
  };
  const live=createLivePitState({driverId:"D1",stop});
  assert.deepEqual(live.phases,normalisePitPhaseDurations(stop));
});

test("RW8.8 planned stop enters canonical pit state at physical pit entry",()=>{
  let state=placeBeforePit(runningState());
  const next=stepRaceState(state);
  const row=car(next);

  assert.equal(row.pitState.active,true);
  assert.equal(row.pitState.status,"pit_entry");
  assert.equal(row.pitState.plannedStopLap,2);
  assert.equal(row.pitState.entryAbsoluteM,1900);
  assert.equal(row.pitState.exitAbsoluteM,2100);
  assert.equal(row.absoluteDistanceM,1900);
  assert.ok(next.pitLaneState.cars.includes("C1"));
  assert.ok(next.events.some((event)=>event.type==="pit_entry"));
});

test("RW8.8 pit cars leave normal traffic and overtaking space immediately",()=>{
  let state=placeBeforePit(runningState());
  state=patchCar(state,"C2",{
    absoluteDistanceM:1888,
    distanceAlongLapM:888,
    completedLaps:1,
    lap:2,
    sector:3,
    speedMs:55,
    speedKmh:198,
  });
  const next=stepRaceState(state);
  const follower=car(next,"C2");

  assert.equal(car(next,"C1").pitState.active,true);
  const nearest=nearestTrafficAhead(next,follower,{ignoreBattleOpponent:false});
  assert.equal(nearest,null);
  assert.equal(car(next,"C1").battle.phase,"none");
  assert.equal(car(next,"C1").traffic.aheadCarId,null);
});

test("RW8.8 pit-lane loss stays additive to normal race-line transit",()=>{
  let state=placeBeforePit(runningState({cars:1}));
  state=stepRaceState(state);
  const row=car(state);
  const phases=row.pitState.service.phases;
  const physicalMs=phases.reduce((sum,phase)=>sum+Number(phase.duration_ms||0),0);
  const lossMs=phases.reduce((sum,phase)=>sum+Number(phase.loss_ms||0),0);
  const transitMs=Math.round(Number(row.pitState.service.track_transit_s||0)*1000);

  assert.ok(transitMs>0);
  assert.equal(lossMs,row.pitState.lossTotalMs);
  assert.ok(physicalMs>lossMs);
  assert.ok(Math.abs((physicalMs-lossMs)-transitMs)<=2);
});

test("RW8.8 completed stop changes tyre, refuels when allowed and rejoins same canonical race",()=>{
  let state=placeBeforePit(runningState({year:1980,refuellingAllowed:true,cars:1}));
  state=stepRaceState(state);
  const serviceAtEntry=car(state).pitState.service;
  assert.equal(serviceAtEntry.refuelled,true);
  assert.ok(serviceAtEntry.fuel_added_kg>0);
  assert.ok(serviceAtEntry.fuel_target_kg>0);

  const completed=runUntil(state,(s)=>car(s).pitState.completed&&!car(s).pitState.active,{maxSteps:500});
  const row=car(completed);
  const history=row.pitState.history[0];

  assert.equal(row.pitState.completed,true);
  assert.equal(row.pitState.status,"track");
  assert.equal(row.tyre.tyre_id,"hard");
  assert.equal(row.tyre.stint_number,2);
  assert.equal(history.refuelled,true);
  assert.ok(history.fuelAddedKg>0);
  assert.ok(row.pitState.history.length===1);
  assert.equal(row.resources.strategy.plannedStopLap,null);
  assert.equal(row.resources.strategy.pitPlan,"completed");
  const serviceEvent=completed.events.find((event)=>event.type==="pit_service_completed");
  assert.ok(serviceEvent);
  assert.equal(serviceEvent.payload.tyreFrom,"soft");
  assert.equal(serviceEvent.payload.tyreTo,"hard");
  assert.equal(serviceEvent.payload.tyreChanged,true);
  assert.equal(serviceEvent.payload.refuelled,true);
  assert.ok(serviceEvent.payload.fuelAddedKg>0);
  assert.equal(typeof serviceEvent.payload.crewError,"boolean");
  assert.ok(completed.events.some((event)=>event.type==="pit_exit"));
});

test("RW8.8 no-refuelling era performs tyre stop without adding fuel",()=>{
  let state=placeBeforePit(runningState({year:2026,refuellingAllowed:false,cars:1}));
  state=stepRaceState(state);
  const entryFuel=car(state).fuelKg;
  const service=car(state).pitState.service;
  assert.equal(service.refuelled,false);

  const completed=runUntil(state,(s)=>car(s).pitState.completed&&!car(s).pitState.active,{maxSteps:500});
  assert.equal(car(completed).tyre.tyre_id,"hard");
  assert.ok(car(completed).fuelKg<=entryFuel+1e-6);
});

test("RW8.8 missing pit anchors uses timing-safe start-finish fallback without NaN",()=>{
  let state=placeBeforePit(runningState({withPitAnchors:false,cars:1}));
  const next=stepRaceState(state);
  const row=car(next);

  assert.equal(row.pitState.active,true);
  assert.equal(row.pitState.entryAbsoluteM,2000);
  assert.equal(row.pitState.exitAbsoluteM,2000);
  assert.ok(Number.isFinite(row.absoluteDistanceM));

  const completed=runUntil(next,(s)=>car(s).pitState.completed&&!car(s).pitState.active,{maxSteps:500});
  assert.ok(Number.isFinite(car(completed).absoluteDistanceM));
  assert.equal(car(completed).pitState.status,"track");
});

test("RW8.8 same-team simultaneous stops create a canonical double-stack queue",()=>{
  let state=runningState({cars:2,sameTeam:true,refuellingAllowed:false});
  state=placeBeforePit(state,"C1",1);
  state=placeBeforePit(state,"C2",7);
  state=patchCar(state,"C1",{speedMs:80,speedKmh:288});
  state=patchCar(state,"C2",{speedMs:80,speedKmh:288});

  state=stepRaceState(state);
  assert.equal(car(state,"C1").pitState.active,true);
  assert.equal(car(state,"C2").pitState.active,true);

  let queued=null;
  for(let index=0;index<400&&!queued;index+=1){
    state=stepRaceState(state);
    const rows=state.cars.filter((row)=>row.pitState.active);
    queued=rows.find((row)=>row.pitState.phase==="pit_queue"&&row.pitState.queueElapsedMs>0)||null;
  }

  assert.ok(queued,"expected one same-team car to wait for the occupied box");
  assert.ok(queued.pitState.queueElapsedMs>0);
  assert.ok(queued.pitState.lossTotalMs>Math.round(queued.pitState.service.total_loss_s*1000));

  const queuedCarId=queued.carId;
  const queuedDriverId=queued.driverId;
  state=runUntil(
    state,
    (candidate)=>{
      const row=car(candidate,queuedCarId);
      return row?.pitState?.completed&&!row?.pitState?.active;
    },
    {maxSteps:500}
  );

  const serviceEvent=state.events.find((event)=>
    event.type==="pit_service_completed"&&event.driverIds?.includes(queuedDriverId)
  );
  const exitEvent=state.events.find((event)=>
    event.type==="pit_exit"&&event.driverIds?.includes(queuedDriverId)
  );
  assert.ok(serviceEvent);
  assert.ok(exitEvent);
  assert.equal(serviceEvent.payload.doubleStack,true);
  assert.ok(serviceEvent.payload.queueDelayMs>0);
  assert.ok(serviceEvent.payload.stationaryMs>=0);
  assert.ok(serviceEvent.payload.pitLaneLossMs>=0);
  assert.equal(exitEvent.payload.doubleStack,true);
  assert.equal(exitEvent.payload.queueDelayMs,serviceEvent.payload.queueDelayMs);

  const presented=presentCanonicalRaceEvent(serviceEvent,{
    drivers:[{driver_id:queuedDriverId,display_name:"Queued Driver"}],
    tyres:[],
  });
  assert.match(presented.text,/double-stack delay/i);
});

test("RW8.8 pit state survives save/resume deterministically",()=>{
  let state=placeBeforePit(runningState({cars:1}));
  state=stepRaceState(state);
  state=advanceRaceState(state,{steps:25});
  const restored=JSON.parse(JSON.stringify(state));

  const a=advanceRaceState(state,{steps:120});
  const b=advanceRaceState(restored,{steps:120});
  assert.deepEqual(a,b);
});

test("RW8.8 Live and Fast expose identical pit lifecycle, resources and events",()=>{
  let initial=placeBeforePit(runningState({cars:1}));
  const fast=runFastRace(initial,{steps:180});
  const live=createLiveRaceRunner(initial);
  live.advanceElapsed(18000);

  assert.deepEqual(live.getState(),fast);
  assert.deepEqual(live.getState().pitLaneState,fast.pitLaneState);
  assert.deepEqual(live.getState().events,fast.events);
  assert.deepEqual(car(live.getState()).pitState,car(fast).pitState);
});


test("RW8.14K1 adaptive strategy schedules a degradation stop before tyres become critical",()=>{
  let state=runningState({cars:1,plannedStopLap:null,pitPlan:"adaptive",laps:12});
  state=patchCar(state,"C1",{
    absoluteDistanceM:1898,
    distanceAlongLapM:898,
    completedLaps:1,
    lap:2,
    sector:3,
    speedMs:60,
    speedKmh:216,
    tyre:{...car(state).tyre,condition:33},
  });

  const next=stepRaceState(state);
  const row=car(next);
  assert.equal(row.pitState.active,true);
  assert.equal(row.pitState.plannedStopLap,2);
  assert.equal(row.pitState.service.reason,"degradation");
  assert.ok(next.events.some((event)=>event.type==="pit_entry"&&event.payload?.reason==="degradation"));

  const completed=runUntil(next,(s)=>car(s).pitState.completed&&!car(s).pitState.active,{maxSteps:500});
  assert.equal(car(completed).resources.strategy.pitPlan,"adaptive");
  assert.equal(car(completed).resources.strategy.plannedStopLap,null);
});

test("RW8.14K1 adaptive strategy switches tyre category when live weather requires it",()=>{
  let state=runningState({cars:1,plannedStopLap:null,pitPlan:"adaptive"});
  state={
    ...state,
    weatherState:{...(state.weatherState||{}),state:"WETTING",track_wetness:0.35},
  };
  state=patchCar(state,"C1",{
    absoluteDistanceM:1898,
    distanceAlongLapM:898,
    completedLaps:1,
    lap:2,
    sector:3,
    speedMs:60,
    speedKmh:216,
    tyre:{...car(state).tyre,condition:82,category:"dry"},
  });

  const next=stepRaceState(state);
  const row=car(next);
  assert.equal(row.pitState.active,true);
  assert.equal(row.pitState.service.reason,"weather");
  assert.equal(row.pitState.service.tyre_to,"inter");
});
