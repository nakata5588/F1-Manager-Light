import test from "node:test";
import assert from "node:assert/strict";

import { normalisePitPhaseDurations, pitLaneProgressForPhase } from "../src/domain/racePitModel.js";
import { damageStateFromComponents } from "../src/engine/CarDamageEngine.js";
import { createLivePitState } from "../src/engine/LivePitStopEngine.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { advanceRaceState, startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import { createLiveRaceRunner, runFastRace } from "../src/race2/core/RaceRunner.js";
import { nearestTrafficAhead } from "../src/race2/core/RaceTraffic.js";
import {
  buildCanonicalStrategyForecasts,
  planCanonicalPitStrategies,
} from "../src/race2/core/RacePitStrategy.js";
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
  aiControlled=true,
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
        raceIntelligence:75,
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
          aiControlled,
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


test("RW11D canonical strategy forecast exposes pit window, rejoin, traffic and finish projection",()=>{
  let state=runningState({cars:3,plannedStopLap:null,pitPlan:"adaptive",laps:20});
  state=patchCar(state,"C1",{
    absoluteDistanceM:3900,
    distanceAlongLapM:900,
    completedLaps:3,
    lap:4,
    sector:3,
    tyre:{
      ...car(state,"C1").tyre,
      condition:65,
      wear_rate:0.030,
      thermal_stress_multiplier:1,
    },
  });

  const forecasts=buildCanonicalStrategyForecasts(state,state.cars);
  const forecast=forecasts.get("C1");

  assert.ok(forecast);
  assert.equal(forecast.model,"rw11d");
  assert.ok(forecast.pit_window);
  assert.equal(forecast.pit_reason,"degradation");
  assert.ok(forecast.pit_window.recommended_lap>=4);
  assert.ok(Number.isFinite(forecast.pit_rejoin_position));
  assert.ok(Number.isFinite(forecast.pit_rejoin_traffic_count));
  assert.ok(Number.isFinite(forecast.projected_finish_position));
  assert.ok(Number.isFinite(forecast.projected_finish_best));
  assert.ok(Number.isFinite(forecast.projected_finish_worst));
  assert.ok(forecast.projection_confidence_pct>=35);
  assert.ok(forecast.projection_confidence_pct<=92);
  assert.ok(forecast.projected_finish_tyre_condition<45);
});

test("RW11D healthy tyre forecast can recommend staying out without inventing a stop",()=>{
  let state=runningState({cars:2,plannedStopLap:null,pitPlan:"adaptive",laps:12});
  state=patchCar(state,"C1",{
    absoluteDistanceM:2900,
    distanceAlongLapM:900,
    completedLaps:2,
    lap:3,
    sector:3,
    tyre:{
      ...car(state,"C1").tyre,
      condition:96,
      wear_rate:0.004,
      thermal_stress_multiplier:1,
    },
  });

  const forecast=buildCanonicalStrategyForecasts(state,state.cars).get("C1");
  assert.ok(forecast);
  assert.equal(forecast.pit_window,null);
  assert.equal(forecast.pit_reason,null);
  assert.equal(forecast.pit_rejoin_position,null);
  assert.ok(Number.isFinite(forecast.projected_finish_position));
  assert.ok(Number.isFinite(forecast.projection_confidence_pct));
});

test("RW11D adaptive strategy replans an old automatic stop from the current canonical forecast",()=>{
  let state=runningState({cars:1,plannedStopLap:10,pitPlan:"adaptive",laps:16});
  state=patchCar(state,"C1",{
    absoluteDistanceM:4900,
    distanceAlongLapM:900,
    completedLaps:4,
    lap:5,
    sector:3,
    tyre:{
      ...car(state,"C1").tyre,
      condition:54,
      wear_rate:0.034,
      thermal_stress_multiplier:1,
    },
    resources:{
      ...car(state,"C1").resources,
      strategy:{
        ...car(state,"C1").resources.strategy,
        pitPlan:"adaptive",
        plannedStopLap:10,
        autoPitReason:"degradation",
      },
    },
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  assert.equal(planned.resources.strategy.pitPlan,"adaptive");
  assert.equal(planned.resources.strategy.autoPitReason,"degradation");
  assert.ok(planned.resources.strategy.plannedStopLap>=5);
  assert.notEqual(planned.resources.strategy.plannedStopLap,10);
  assert.ok(planned.resources.strategy.forecast?.pit_window);
});

test("RW11D live weather mismatch produces an immediate canonical strategy window",()=>{
  let state=runningState({cars:1,plannedStopLap:null,pitPlan:"adaptive",laps:12});
  state={
    ...state,
    weatherState:{...(state.weatherState||{}),state:"WETTING",track_wetness:0.35},
    trackState:{...(state.trackState||{}),wetness:0.35,weatherState:"WETTING"},
  };
  state=patchCar(state,"C1",{
    absoluteDistanceM:3898,
    distanceAlongLapM:898,
    completedLaps:3,
    lap:4,
    sector:3,
    tyre:{...car(state).tyre,condition:88,category:"dry"},
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  const forecast=planned.resources.strategy.forecast;
  assert.equal(forecast.pit_reason,"weather");
  assert.equal(forecast.next_tyre_id,"inter");
  assert.equal(planned.resources.strategy.plannedStopLap,4);
  assert.equal(planned.resources.strategy.nextTyreId,"inter");
});


test("RW11D damage repair joins an existing adaptive tyre stop instead of creating a second strategy",()=>{
  let state=runningState({cars:1,plannedStopLap:null,pitPlan:"adaptive",laps:24});
  state=patchCar(state,"C1",{
    absoluteDistanceM:1898,
    distanceAlongLapM:898,
    completedLaps:1,
    lap:2,
    sector:3,
    speedMs:60,
    speedKmh:216,
    tyre:{...car(state).tyre,condition:33},
    damage:damageStateFromComponents({front_wing:70}),
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  const forecast=planned.resources.strategy.forecast;
  assert.equal(forecast.pit_reason,"degradation");
  assert.equal(forecast.damage_repair.should_repair,true);
  assert.equal(forecast.damage_repair.dedicated_stop,false);
  assert.ok(forecast.damage_repair.repair_components.includes("front_wing"));
  assert.deepEqual(planned.resources.strategy.repairComponentsRequested,["front_wing"]);
  assert.equal(planned.resources.strategy.tyreChangeRequested,true);

  const next=stepRaceState(state);
  const row=car(next);
  assert.equal(row.pitState.active,true);
  assert.equal(row.pitState.service.reason,"degradation");
  assert.equal(row.pitState.service.tyre_changed,true);
  assert.ok(row.pitState.service.repair.repaired_components.includes("front_wing"));
});

test("RW11D minor damage does not invent a dedicated repair stop when value is negative",()=>{
  let state=runningState({cars:1,plannedStopLap:null,pitPlan:"adaptive",laps:6});
  state=patchCar(state,"C1",{
    absoluteDistanceM:1900,
    distanceAlongLapM:900,
    completedLaps:1,
    lap:2,
    sector:3,
    tyre:{...car(state).tyre,condition:98,wear_rate:0.002},
    damage:damageStateFromComponents({front_wing:20}),
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  const forecast=planned.resources.strategy.forecast;
  assert.equal(forecast.pit_window,null);
  assert.equal(forecast.damage_repair.should_repair,false);
  assert.equal(forecast.damage_repair.dedicated_stop,false);
  assert.equal(planned.resources.strategy.plannedStopLap,null);
  assert.deepEqual(planned.resources.strategy.repairComponentsRequested??[],[]);
});

test("RW11D neutralisation can create a canonical dedicated damage-repair stop without changing tyres",()=>{
  let state=runningState({cars:1,plannedStopLap:null,pitPlan:"adaptive",laps:45});
  state={
    ...state,
    raceControlState:{...(state.raceControlState||{}),mode:"SAFETY_CAR"},
  };
  state=patchCar(state,"C1",{
    absoluteDistanceM:1900,
    distanceAlongLapM:900,
    completedLaps:1,
    lap:2,
    sector:3,
    tyre:{...car(state).tyre,condition:100,wear_rate:0.002},
    damage:damageStateFromComponents({front_wing:90}),
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  const forecast=planned.resources.strategy.forecast;
  assert.equal(forecast.pit_reason,"damage_repair");
  assert.ok(forecast.pit_window);
  assert.equal(forecast.damage_repair.should_repair,true);
  assert.equal(forecast.damage_repair.dedicated_stop,true);
  assert.ok(forecast.damage_repair.repair_components.includes("front_wing"));
  assert.equal(forecast.tyre_change_requested,false);
  assert.equal(planned.resources.strategy.tyreChangeRequested,false);
  assert.ok(planned.resources.strategy.plannedStopLap>=2);
  assert.deepEqual(planned.resources.strategy.repairComponentsRequested,["front_wing"]);
});


test("RW11D canonical forecast and pit execution share the same Safety Car pit-lane loss",()=>{
  let state=placeBeforePit(runningState({
    cars:1,
    plannedStopLap:2,
    pitPlan:"one_stop",
    refuellingAllowed:false,
  }));
  state={
    ...state,
    raceControlState:{...(state.raceControlState||{}),mode:"SAFETY_CAR"},
  };

  const forecast=buildCanonicalStrategyForecasts(state,state.cars).get("C1");
  assert.ok(forecast?.pit_window);
  assert.equal(forecast.expected_pit_loss_s,6.84);

  const next=stepRaceState(state);
  const service=car(next).pitState.service;
  assert.equal(car(next).pitState.active,true);
  assert.equal(service.pit_lane_loss_s,4.64);
  assert.equal(service.expected_stationary_s,2.2);
  assert.equal(service.total_loss_s,6.84);
});


test("RW11D AI fixed one-stop attaches valuable repair work to the existing stop",()=>{
  let state=placeBeforePit(runningState({
    cars:1,
    plannedStopLap:2,
    pitPlan:"one_stop",
    laps:24,
    aiControlled:true,
  }));
  state=patchCar(state,"C1",{
    damage:damageStateFromComponents({front_wing:70}),
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  assert.equal(planned.resources.strategy.pitPlan,"one_stop");
  assert.equal(planned.resources.strategy.plannedStopLap,2);
  assert.deepEqual(planned.resources.strategy.repairComponentsRequested,["front_wing"]);

  const next=stepRaceState(state);
  assert.equal(car(next).pitState.active,true);
  assert.equal(car(next).pitState.service.reason,"planned");
  assert.ok(car(next).pitState.service.repair.repaired_components.includes("front_wing"));
});

test("RW11D player-controlled car receives repair advice without automatic repair orders",()=>{
  let state=runningState({
    cars:1,
    plannedStopLap:null,
    pitPlan:"adaptive",
    laps:45,
    aiControlled:false,
  });
  state={
    ...state,
    raceControlState:{...(state.raceControlState||{}),mode:"SAFETY_CAR"},
  };
  state=patchCar(state,"C1",{
    absoluteDistanceM:1900,
    distanceAlongLapM:900,
    completedLaps:1,
    lap:2,
    sector:3,
    tyre:{...car(state).tyre,condition:100,wear_rate:0.002},
    damage:damageStateFromComponents({front_wing:90}),
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  const forecast=planned.resources.strategy.forecast;
  assert.equal(forecast.damage_repair.should_repair,true);
  assert.equal(forecast.damage_repair.dedicated_stop,true);
  assert.equal(forecast.pit_window,null);
  assert.equal(planned.resources.strategy.plannedStopLap,null);
  assert.deepEqual(planned.resources.strategy.repairComponentsRequested??[],[]);
});


test("RW11E AI no-stop plan is an opening intent, not a lock against severe tyre degradation",()=>{
  let state=runningState({
    cars:1,
    plannedStopLap:null,
    pitPlan:"no_stop",
    laps:20,
    aiControlled:true,
  });
  state=patchCar(state,"C1",{
    absoluteDistanceM:12900,
    distanceAlongLapM:900,
    completedLaps:12,
    lap:13,
    sector:3,
    tyre:{
      ...car(state).tyre,
      condition:28,
      wear_rate:0.028,
      wear_per_lap_pct:4.2,
    },
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  assert.equal(planned.resources.strategy.pitPlan,"no_stop");
  assert.equal(planned.resources.strategy.forecast?.pit_reason,"degradation");
  assert.equal(planned.resources.strategy.autoPitReason,"degradation");
  assert.ok(Number.isFinite(planned.resources.strategy.plannedStopLap));
  assert.ok(planned.resources.strategy.plannedStopLap>=13);
  assert.equal(planned.resources.strategy.tyreChangeRequested,true);
});

test("RW11E player no-stop plan receives degradation forecast without an automatic pit order",()=>{
  let state=runningState({
    cars:1,
    plannedStopLap:null,
    pitPlan:"no_stop",
    laps:20,
    aiControlled:false,
  });
  state=patchCar(state,"C1",{
    absoluteDistanceM:12900,
    distanceAlongLapM:900,
    completedLaps:12,
    lap:13,
    sector:3,
    tyre:{
      ...car(state).tyre,
      condition:28,
      wear_rate:0.028,
      wear_per_lap_pct:4.2,
    },
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  assert.equal(planned.resources.strategy.forecast?.pit_reason,"degradation");
  assert.equal(planned.resources.strategy.plannedStopLap,null);
  assert.equal(planned.resources.strategy.autoPitReason??null,null);
});

test("RW11E AI no-stop plan reacts immediately to a canonical wet-weather crossover",()=>{
  let state=runningState({
    cars:1,
    plannedStopLap:null,
    pitPlan:"no_stop",
    laps:12,
    aiControlled:true,
  });
  state={
    ...state,
    weatherState:{...(state.weatherState||{}),state:"WETTING",track_wetness:0.35},
    trackState:{...(state.trackState||{}),wetness:0.35,weatherState:"WETTING"},
  };
  state=patchCar(state,"C1",{
    absoluteDistanceM:3898,
    distanceAlongLapM:898,
    completedLaps:3,
    lap:4,
    sector:3,
    tyre:{...car(state).tyre,condition:90,category:"dry"},
  });

  const [planned]=planCanonicalPitStrategies(state,state.cars);
  assert.equal(planned.resources.strategy.forecast?.pit_reason,"weather");
  assert.equal(planned.resources.strategy.nextTyreId,"inter");
  assert.equal(planned.resources.strategy.autoPitReason,"weather");
  assert.equal(planned.resources.strategy.plannedStopLap,4);
});


test("RW12C shared pit phase progress maps entry, box and exit onto one pit-lane axis",()=>{
  const phases=[
    {phase:"pit_entry",duration_ms:1000},
    {phase:"pit_lane",duration_ms:1000},
    {phase:"pit_queue",duration_ms:500},
    {phase:"pit_box",duration_ms:2000},
    {phase:"pit_release",duration_ms:500},
    {phase:"pit_exit",duration_ms:1000},
    {phase:"rejoin",duration_ms:1000},
  ];
  assert.equal(pitLaneProgressForPhase({
    active:true,phase:"pit_entry",phaseIndex:0,phaseElapsedMs:500,service:{phases},
  },{boxProgress:0.6}),0.15);
  assert.equal(pitLaneProgressForPhase({
    active:true,phase:"pit_lane",phaseIndex:1,phaseElapsedMs:1000,service:{phases},
  },{boxProgress:0.6}),0.6);
  assert.equal(pitLaneProgressForPhase({
    active:true,phase:"pit_box",phaseIndex:3,phaseElapsedMs:800,service:{phases},
  },{boxProgress:0.6}),0.6);
  assert.equal(pitLaneProgressForPhase({
    active:true,phase:"pit_exit",phaseIndex:5,phaseElapsedMs:1000,service:{phases},
  },{boxProgress:0.6}),0.8);
  assert.equal(pitLaneProgressForPhase({
    active:false,completed:true,phase:"completed",service:{phases},
  },{boxProgress:0.6}),1);
});
