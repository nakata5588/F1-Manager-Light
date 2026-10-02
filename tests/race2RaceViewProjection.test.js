import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import {
  RACE_VIEW_PROJECTION_SOURCE,
  RACE_VIEW_PROJECTION_VERSION,
  projectRaceStateToRaceView,
} from "../src/race2/adapters/RaceViewProjection.js";
import { canonicalRaceViewCars } from "../src/race2/view/CanonicalRaceViewModel.js";
import {
  batchCanonicalRaceAttentionEvents,
  canonicalRaceEventRequiresPause,
  canonicalRaceFlagNotice,
  presentCanonicalRaceEvent,
} from "../src/race2/presentation/RaceEventPresenter.js";

function input(){
  return {
    schemaVersion:15,
    engineVersion:"rw2",
    weekendKey:"race-view-projection",
    seed:"rw8.14a",
    entries:[
      {driverId:"D1",teamId:"T1",carId:"C1",status:"confirmed"},
      {driverId:"D2",teamId:"T2",carId:"C2",status:"confirmed"},
    ],
    drivers:[
      {driverId:"D1",teamId:"T1",performance:{raceScore:82}},
      {driverId:"D2",teamId:"T2",performance:{raceScore:78}},
    ],
    cars:[
      {
        carId:"C1",driverId:"D1",teamId:"T1",
        state:{componentCondition:{engine:100}},
        performance:{overall:82,race:82,power:82,chassis:80},
      },
      {
        carId:"C2",driverId:"D2",teamId:"T2",
        state:{componentCondition:{engine:100}},
        performance:{overall:78,race:78,power:78,chassis:78},
      },
    ],
    startingGrid:[
      {driver_id:"D1",team_id:"T1",grid:1},
      {driver_id:"D2",team_id:"T2",grid:2},
    ],
    track:{lengthM:1000,laps:3,sectorBoundariesM:[0,333,666,1000]},
    raceControl:{rules:{}},
  };
}

test("RW8.14A projects canonical RaceState into a Race View read model without recalculating order or gaps",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  state=stepRaceState(state);

  const before=JSON.parse(JSON.stringify(state));
  const view=projectRaceStateToRaceView(state);

  assert.deepEqual(state,before,"projection must not mutate canonical RaceState");
  assert.equal(view.engine_version,"rw2");
  assert.equal(view.source,RACE_VIEW_PROJECTION_SOURCE);
  assert.equal(view.projection_version,RACE_VIEW_PROJECTION_VERSION);
  assert.equal(view.canonical_tick,state.tick);
  assert.equal(view.track_length_m,state.track.lengthM);
  assert.equal(view.classification.length,state.classification.length);

  for(let index=0;index<state.classification.length;index+=1){
    const canonical=state.classification[index];
    const row=view.classification[index];
    const car=state.cars.find((candidate)=>candidate.carId===canonical.carId);

    assert.equal(row.position,canonical.position);
    assert.equal(row.driver_id,canonical.driverId);
    assert.equal(row.team_id,canonical.teamId);
    assert.equal(row.position_gain,Number(car.gridPosition||0)-Number(canonical.position||0));
    assert.equal(row.gap_to_leader_ms,canonical.gapToLeaderMs);
    assert.equal(row.gap_to_previous_ms,canonical.intervalMs);
    assert.equal(row.distance_along_lap_m,canonical.distanceAlongLapM);
    assert.equal(row.speed_kmh,car.speedKmh);
    assert.equal(
      row.visual_track_progress,
      Number((((canonical.distanceAlongLapM/state.track.lengthM)%1+1)%1).toFixed(9))
    );
  }
});

test("RW8.14A keeps retirement, resources and Race Control as projections of canonical car state",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  const first=state.cars[0];
  state={
    ...state,
    raceControlState:{...(state.raceControlState||{}),mode:"VSC"},
    cars:state.cars.map((car)=>car.carId===first.carId?{
      ...car,
      dnf:true,
      status:"dnf",
      speedMs:0,
      speedKmh:0,
      fuelKg:12.5,
      retirement:{
        reason:"Engine failure",
        trackside:{
          status:"parked",
          visible:true,
          parkedAbsoluteM:first.absoluteDistanceM,
          parkedDistanceAlongLapM:first.distanceAlongLapM,
          lateralOffsetM:-5.25,
          passTargets:[{carId:"C2",targetAbsoluteM:1000}],
          pendingCarIds:["C2"],
          clearedTo:"pit_box_pending_geometry",
        },
      },
      damage:{severity:"major"},
      pitState:{phase:"retired",active:false},
    }:car),
  };
  state={
    ...state,
    classification:state.classification.map((row)=>row.carId===first.carId?{
      ...row,
      status:"dnf",
    }:row),
  };

  const view=projectRaceStateToRaceView(state);
  const row=view.classification.find((candidate)=>candidate.car_id===first.carId);

  assert.equal(view.current_control,"VSC");
  assert.equal(view.last_weather,state.weatherState.state);
  assert.equal(view.track_state.track_wetness,state.weatherState.track_wetness);
  assert.equal(view.track_state.grip_index,state.weatherState.grip_index);
  assert.equal(row.retired,true);
  assert.equal(row.status,"DNF");
  assert.equal(row.retirement_reason,"Engine failure");
  assert.equal(row.incident_lap,first.lap);
  assert.equal(row.incident_sector,first.sector);
  assert.equal(row.retirement_trackside.status,"parked");
  assert.equal(row.retirement_trackside.visible,true);
  assert.equal(row.lateral_offset_m,-5.25);
  assert.equal(row.fuel_kg,12.5);
  assert.deepEqual(row.damage_state,{severity:"major"});
  assert.equal(view.pit_states[row.driver_id].active,false);
});

test("RW8.14A rejects missing canonical state explicitly",()=>{
  assert.throws(()=>projectRaceStateToRaceView(null),/RaceState is required/);
});


test("RW9 canonical visual model ignores sector/gap reconstruction",()=>{
  const view={
    classification:[
      {
        car_id:"C1",
        driver_id:"D1",
        team_id:"T1",
        position:1,
        lap:4,
        sector:1,
        gap_to_leader_ms:0,
        visual_track_progress:0.4175,
        distance_along_lap_m:417.5,
        absolute_distance_m:3417.5,
        speed_kmh:212,
      },
      {
        car_id:"C2",
        driver_id:"D2",
        team_id:"T2",
        position:2,
        lap:4,
        sector:3,
        gap_to_leader_ms:45000,
        visual_track_progress:0.4175,
        distance_along_lap_m:417.5,
        absolute_distance_m:3417.5,
        speed_kmh:198,
      },
    ],
  };

  const cars=canonicalRaceViewCars(view);
  assert.equal(cars[0].track_progress,0.4175);
  assert.equal(cars[1].track_progress,0.4175);
  assert.equal(cars[0].distance_along_lap_m,417.5);
  assert.equal(cars[1].distance_along_lap_m,417.5);
});


test("RW10B canonical event presenter humanizes Race Control lifecycle events",()=>{
  const deployed=presentCanonicalRaceEvent({
    type:"race_control_changed",
    payload:{from:"GREEN",to:"SAFETY_CAR",source:"incident"},
  });
  const resumed=presentCanonicalRaceEvent({
    type:"race_control_changed",
    payload:{from:"RED_FLAG",to:"GREEN",source:"restart"},
  });

  assert.equal(deployed.label,"Race Control");
  assert.equal(deployed.text,"Safety Car deployed");
  assert.equal(deployed.iconKey,"race_control");
  assert.equal(deployed.priority,"important");
  assert.equal(resumed.text,"Race restarted under green flag");
});

test("RW10B canonical event presenter resolves driver and tyre facts without writing UI text into RaceState",()=>{
  const context={
    drivers:[{driver_id:"D1",display_name:"Mario Andretti"}],
    tyres:[{tyre_id:"gy_s",compound_name:"Soft"}],
  };
  const source={
    type:"pit_service_completed",
    driverIds:["D1"],
    payload:{tyreTo:"gy_s",tyreChanged:true,refuelled:false},
  };
  const presented=presentCanonicalRaceEvent(source,context);

  assert.equal(presented.label,"Pit service");
  assert.equal(presented.text,"Mario Andretti changes to Soft tyres");
  assert.equal(presented.iconKey,"pit");
  assert.equal(source.message,undefined);
  assert.equal(source.display_text,undefined);
});

test("RW10B canonical event presenter covers incidents, retirements and battles with human messages",()=>{
  const context={
    drivers:[
      {driver_id:"D1",display_name:"Mario Andretti"},
      {driver_id:"D2",display_name:"Keke Rosberg"},
    ],
  };
  assert.equal(
    presentCanonicalRaceEvent({
      type:"retirement",
      driverIds:["D2"],
      payload:{reason:"gearbox_failure"},
    },context).text,
    "Keke Rosberg retires — Gearbox failure"
  );
  assert.equal(
    presentCanonicalRaceEvent({
      type:"contact",
      driverIds:["D1","D2"],
      payload:{severity:"minor"},
    },context).text,
    "Contact between Mario Andretti and Keke Rosberg"
  );
  assert.equal(
    presentCanonicalRaceEvent({
      type:"overtake_completed",
      driverIds:["D1","D2"],
      payload:{},
    },context).text,
    "Mario Andretti passes Keke Rosberg"
  );
});


test("RW10C Race View projection exposes pending commands and Race Control as read-only view state",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  state={
    ...state,
    commandQueue:[{
      id:"cmd-1",
      sequence:1,
      issuedAtTick:state.tick,
      effectiveAtTick:state.tick+1,
      source:"player",
      driverId:"D1",
      teamId:"T1",
      type:"pit",
      payload:{tyreId:"hard",tyreChange:true,refuel:false},
    }],
    raceControlState:{
      ...(state.raceControlState||{}),
      mode:"SAFETY_CAR",
      source:"incident",
      assessment:{severity:"high"},
    },
  };

  const before=JSON.parse(JSON.stringify(state));
  const view=projectRaceStateToRaceView(state);

  assert.deepEqual(state,before);
  assert.equal(view.pending_commands.length,1);
  assert.equal(view.pending_commands[0].driverId,"D1");
  assert.equal(view.pending_commands[0].payload.tyreId,"hard");
  assert.equal(view.race_control_state.mode,"SAFETY_CAR");
  assert.equal(view.race_control_state.source,"incident");

  view.pending_commands[0].payload.tyreId="mutated";
  view.race_control_state.assessment.severity="mutated";
  assert.equal(state.commandQueue[0].payload.tyreId,"hard");
  assert.equal(state.raceControlState.assessment.severity,"high");
});

test("RW10C canonical Race Control banner reuses Legacy flag semantics without reading Legacy plans",()=>{
  const safety=canonicalRaceFlagNotice({
    status:"running",
    current_control:"SAFETY_CAR",
    race_control_state:{source:"incident"},
    events:[],
  });
  const red=canonicalRaceFlagNotice({
    status:"running",
    current_control:"RED_FLAG",
    race_control_state:{source:"weather"},
    events:[],
  });
  const finished=canonicalRaceFlagNotice({
    status:"finished",
    current_control:"GREEN",
  });

  assert.deepEqual(
    {type:safety.type,label:safety.label,subtitle:safety.subtitle,reason:safety.reason},
    {type:"SAFETY_CAR",label:"SAFETY CAR",subtitle:"DEPLOYED",reason:"Incident on track"}
  );
  assert.equal(red.label,"RED FLAG");
  assert.equal(red.subtitle,"SESSION STOPPED");
  assert.equal(red.reason,"Weather conditions");
  assert.equal(finished.type,"CHEQUERED");
});

test("RW10C canonical attention policy auto-pauses important facts but ignores routine battles",()=>{
  const player={playerDriverIds:["D1"]};
  assert.equal(canonicalRaceEventRequiresPause({
    type:"race_control_changed",
    payload:{from:"GREEN",to:"SAFETY_CAR"},
  },player),true);
  assert.equal(canonicalRaceEventRequiresPause({
    type:"mechanical_failure",
    driverIds:["D2"],
    payload:{reason:"engine"},
  },player),true);
  assert.equal(canonicalRaceEventRequiresPause({
    type:"pit_service_completed",
    driverIds:["D1"],
    payload:{tyreChanged:true},
  },player),true);
  assert.equal(canonicalRaceEventRequiresPause({
    type:"overtake_completed",
    driverIds:["D1","D2"],
    payload:{},
  },player),false);
});

test("RW10C simultaneous canonical incidents are batched into one popup payload",()=>{
  const events=[
    {
      id:"evt-1",sequence:1,tick:40,type:"contact",
      driverIds:["D1","D2"],payload:{},
      display_text:"Contact between D1 and D2",
    },
    {
      id:"evt-2",sequence:2,tick:40,type:"damage",
      driverIds:["D1"],payload:{source:"contact",severity:"medium"},
      display_text:"D1 suffers damage",
    },
    {
      id:"evt-3",sequence:3,tick:41,type:"overtake_started",
      driverIds:["D3","D4"],payload:{},
      display_text:"D3 attacks D4",
    },
  ];
  const batch=batchCanonicalRaceAttentionEvents(events,{playerDriverIds:["D1"]});

  assert.equal(batch.type,"event_batch");
  assert.equal(batch.tick,40);
  assert.equal(batch.events.length,2);
  assert.equal(batch.event_key,"rw2_event_batch:40:evt-1|evt-2");
});


test("RW10C projection fills Legacy-compatible pit and damage display fields from canonical CarState",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  const first=state.cars[0];
  state={
    ...state,
    cars:state.cars.map((car)=>car.carId===first.carId?{
      ...car,
      damage:{
        severity:"major",
        damaged_components:["front_wing","floor"],
        pace_loss_s_per_lap:1.25,
      },
      pitState:{
        ...(car.pitState||{}),
        active:true,
        completed:false,
        history:[{stopSequence:1,lap:1}],
      },
      resources:{
        ...(car.resources||{}),
        strategy:{
          ...(car.resources?.strategy||{}),
          pitPlan:"one_stop",
          plannedStopLap:2,
        },
      },
    }:car),
  };

  const row=projectRaceStateToRaceView(state).classification.find((candidate)=>candidate.car_id===first.carId);
  assert.equal(row.planned_stop_lap,2);
  assert.equal(row.pit_plan,"one_stop");
  assert.deepEqual(row.pit_window,{from_lap:2,to_lap:2});
  assert.equal(row.pit_count,2);
  assert.equal(row.damage_severity,"major");
  assert.deepEqual(row.damaged_components,["front_wing","floor"]);
  assert.equal(row.damage_pace_loss_s_per_lap,1.25);
});


test("RW10D presenter restores Legacy-style weather and driver feedback from canonical facts",()=>{
  const context={
    drivers:[{driver_id:"D1",display_name:"Mario Andretti"}],
  };
  const weatherSource={
    type:"weather_report",
    payload:{
      kind:"rain_started",
      referenceLap:8,
      fromState:"SUNNY",
      toState:"LIGHT_RAIN",
      rainIntensity:0.22,
      trackWetness:0.24,
    },
  };
  const feedbackSource={
    type:"driver_feedback",
    driverIds:["D1"],
    payload:{
      kind:"tyre_weather_mismatch",
      tyreCategory:"dry",
      recommendedCategory:"intermediate",
      trackWetness:0.24,
    },
  };

  const weather=presentCanonicalRaceEvent(weatherSource,context);
  const feedback=presentCanonicalRaceEvent(feedbackSource,context);

  assert.equal(weather.label,"Weather");
  assert.equal(weather.text,"Rain has started");
  assert.equal(weather.iconKey,"weather");
  assert.equal(weatherSource.message,undefined);

  assert.equal(feedback.label,"Driver feedback");
  assert.equal(
    feedback.text,
    'Mario Andretti: "It\'s getting slippery. Intermediates are becoming an option."'
  );
  assert.equal(feedback.iconKey,"feedback");
  assert.equal(feedbackSource.message,undefined);

  assert.equal(canonicalRaceEventRequiresPause(weatherSource,{playerDriverIds:["D1"]}),true);
  assert.equal(canonicalRaceEventRequiresPause(feedbackSource,{playerDriverIds:["D1"]}),true);
  assert.equal(canonicalRaceEventRequiresPause(feedbackSource,{playerDriverIds:["D2"]}),false);
});


test("RW10E presenter reports canonical pit repairs and cancelled commands without inferring damage",()=>{
  const context={
    drivers:[{driver_id:"D1",display_name:"Mario Andretti"}],
    tyres:[{tyre_id:"soft",compound_name:"Soft"}],
  };
  const service=presentCanonicalRaceEvent({
    type:"pit_service_completed",
    driverIds:["D1"],
    payload:{
      tyreTo:"soft",
      tyreChanged:true,
      refuelled:false,
      repairedComponents:["front_wing"],
    },
  },context);
  const cancelled=presentCanonicalRaceEvent({
    type:"command_cancelled",
    driverIds:["D1"],
    payload:{commandType:"pit",reason:"player_cancelled"},
  },context);

  assert.equal(
    service.text,
    "Mario Andretti changes to Soft tyres and repairs front wing"
  );
  assert.equal(
    presentCanonicalRaceEvent({
      type:"pit_service_completed",
      driverIds:["D1"],
      payload:{
        tyreTo:"soft",
        tyreChanged:false,
        refuelled:false,
        repairedComponents:["front_wing"],
      },
    },context).text,
    "Mario Andretti repairs front wing"
  );
  assert.equal(cancelled.text,"Mario Andretti: pit cancelled");
  assert.equal(cancelled.iconKey,"command");
});


test("RW10F projects canonical Red Flag restart information without sharing nested RaceState references",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  state={
    ...state,
    raceControlState:{
      ...(state.raceControlState||{}),
      mode:"RED_FLAG",
      source:"weather",
      redFlagLifecycle:{
        phase:"suspended",
        triggered_lap:3,
        triggered_sector:2,
        holding_area:"starting_grid",
        restart_grid_source:"suspension_order",
        restart_grid:[
          {driver_id:"D1",team_id:"T1",restart_position:1},
          {driver_id:"D2",team_id:"T2",restart_position:2},
        ],
        restart_monitor:{
          status:"waiting_for_improvement",
          check_count:1,
          safe_streak:0,
          required_safe_checks:2,
          restart_authorized:false,
        },
        work_policy:{
          id:"historic_restart_service",
          label:"Historic restart service",
          tyre_change:true,
        },
      },
    },
  };

  const view=projectRaceStateToRaceView(state);
  const lifecycle=view.race_control_state.redFlagLifecycle;

  assert.equal(view.current_control,"RED_FLAG");
  assert.equal(lifecycle.phase,"suspended");
  assert.equal(lifecycle.restart_grid[0].driver_id,"D1");
  assert.equal(lifecycle.restart_monitor.required_safe_checks,2);

  lifecycle.restart_grid[0].restart_position=99;
  lifecycle.restart_monitor.safe_streak=99;
  lifecycle.work_policy.label="mutated";

  assert.equal(state.raceControlState.redFlagLifecycle.restart_grid[0].restart_position,1);
  assert.equal(state.raceControlState.redFlagLifecycle.restart_monitor.safe_streak,0);
  assert.equal(state.raceControlState.redFlagLifecycle.work_policy.label,"Historic restart service");
});


test("RW10G Race View projects official sector timing and lap deltas without recalculation",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  const first=state.cars[0];
  state={
    ...state,
    cars:state.cars.map((car)=>car.carId===first.carId?{
      ...car,
      sector1Ms:21_111,
      sector2Ms:28_222,
      sector3Ms:30_333,
      lastLapMs:79_666,
      previousLapMs:80_500,
      lastLapDeltaMs:-834,
      bestLapMs:79_666,
      bestLapNumber:2,
    }:car),
  };

  const row=projectRaceStateToRaceView(state).classification
    .find((candidate)=>candidate.car_id===first.carId);

  assert.equal(row.sector_1_ms,21_111);
  assert.equal(row.sector_2_ms,28_222);
  assert.equal(row.sector_3_ms,30_333);
  assert.equal(row.last_lap_ms,79_666);
  assert.equal(row.previous_lap_ms,80_500);
  assert.equal(row.last_lap_delta_ms,-834);
  assert.equal(row.best_lap_ms,79_666);
  assert.equal(row.best_lap_number,2);
});


test("RW11G cleared DNF remains in official classification but is marked hidden from the track presentation",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  const first=state.cars[0];
  state={
    ...state,
    cars:state.cars.map((car)=>car.carId===first.carId?{
      ...car,
      dnf:true,
      status:"dnf",
      speedMs:0,
      speedKmh:0,
      retirement:{
        reason:"Engine failure",
        trackside:{
          status:"cleared",
          visible:false,
          parkedAbsoluteM:240,
          parkedDistanceAlongLapM:240,
          lateralOffsetM:5.25,
          passTargets:[],
          pendingCarIds:[],
          clearedAtTick:12,
          clearedAtTimeMs:1200,
          clearedTo:"pit_box_pending_geometry",
        },
      },
    }:car),
  };

  const view=projectRaceStateToRaceView(state);
  const row=view.classification.find((candidate)=>candidate.car_id===first.carId);
  const visual=canonicalRaceViewCars(view).find((candidate)=>candidate.car_id===first.carId);

  assert.ok(row,"DNF must remain part of the official classification");
  assert.equal(row.retired,true);
  assert.equal(row.retirement_trackside.status,"cleared");
  assert.equal(row.retirement_trackside.visible,false);
  assert.equal(visual.retirement_trackside.visible,false);
});


test("RW12A visual model preserves signed canonical grid distance for start-finish interpolation",()=>{
  const cars=canonicalRaceViewCars({
    classification:[{
      car_id:"C2",
      driver_id:"D2",
      team_id:"T2",
      position:2,
      visual_track_progress:0.992,
      distance_along_lap_m:992,
      absolute_distance_m:-8,
      speed_kmh:0,
    }],
  });
  assert.equal(cars[0].absolute_distance_m,-8);
  assert.equal(cars[0].track_progress,0.992);
});
