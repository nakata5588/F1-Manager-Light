import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import { projectCanonicalRaceTiming } from "../src/race2/core/RaceClassification.js";
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
  assert.deepEqual(view.pit_lane,state.track.pitLane??null);
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
  assert.equal(view.track_state.spray_index,state.weatherState.spray_index);
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

test("RW20 Race View exposes canonical battle telemetry without recomputing the battle in UI",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  const attemptId="rw20-attempt";
  state={
    ...state,
    simulationTimeMs:2400,
    events:[
      ...(state.events||[]),
      {
        type:"overtake_started",
        tick:10,
        timeMs:1000,
        carIds:["C2","C1"],
        driverIds:["D2","D1"],
        payload:{
          attemptId,
          gapM:9.5,
          probability:.72,
          side:1,
          durationMs:5000,
          closingPotentialMs:4.25,
          attemptRangeM:22,
          trackDifficulty:44,
          attackerScore:91.5,
          defenderScore:67.5,
          performanceEdge:24,
        },
      },
    ],
    cars:state.cars.map((car)=>{
      if(car.carId==="C2")return {
        ...car,
        traffic:{
          ...(car.traffic||{}),
          slipstreamActive:true,
          slipstreamAheadCarId:"C1",
          slipstreamStrength:.65,
          slipstreamTargetBonusKmh:5.4,
        },
        battle:{
          ...(car.battle||{}),
          phase:"side_by_side",
          opponentCarId:"C1",
          role:"attacker",
          side:1,
          attemptId,
          startedAtMs:1000,
          expiresAtMs:6000,
          contactRiskPct:.42,
          result:null,
        },
      };
      if(car.carId==="C1")return {
        ...car,
        battle:{
          ...(car.battle||{}),
          phase:"side_by_side",
          opponentCarId:"C2",
          role:"defender",
          side:-1,
          attemptId,
          startedAtMs:1000,
          expiresAtMs:6000,
          contactRiskPct:.42,
          result:null,
        },
      };
      return car;
    }),
  };

  const before=JSON.parse(JSON.stringify(state));
  const view=projectRaceStateToRaceView(state);
  assert.deepEqual(state,before);

  const attacker=view.classification.find((row)=>row.car_id==="C2");
  assert.equal(attacker.battle_context.state,"side_by_side");
  assert.equal(attacker.battle_context.role,"attacker");
  assert.equal(attacker.battle_context.opponent_car_id,"C1");
  assert.equal(attacker.battle_context.started_gap_m,9.5);
  assert.equal(attacker.battle_context.attempt_probability_pct,72);
  assert.equal(attacker.battle_context.closing_potential_kmh,15.3);
  assert.equal(attacker.battle_context.elapsed_ms,1400);
  assert.equal(attacker.battle_context.remaining_ms,3600);
  assert.equal(attacker.battle_context.slipstream_strength_pct,65);
  assert.equal(attacker.battle_context.slipstream_bonus_kmh,5.4);
  assert.equal(attacker.battle_context.attacker_score,91.5);
  assert.equal(attacker.battle_context.defender_score,67.5);
  assert.equal(attacker.battle_context.performance_edge,24);
});

test("RW20 Race View surfaces canonical slipstream pressure before side-by-side begins",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  state={
    ...state,
    cars:state.cars.map((car)=>car.carId==="C2"?{
      ...car,
      traffic:{
        ...(car.traffic||{}),
        aheadCarId:"C1",
        gapM:14.2,
        limited:true,
        hardLimited:false,
        slipstreamActive:true,
        slipstreamAheadCarId:"C1",
        slipstreamRangeM:61,
        slipstreamStrength:.58,
        slipstreamTargetBonusKmh:4.7,
      },
    }:car),
  };

  const view=projectRaceStateToRaceView(state);
  const attacker=view.classification.find((row)=>row.car_id==="C2");
  assert.equal(attacker.battle_context.state,"slipstream");
  assert.equal(attacker.battle_context.opponent_car_id,"C1");
  assert.equal(attacker.battle_context.gap_m,14.2);
  assert.equal(attacker.battle_context.slipstream_strength_pct,58);
  assert.equal(attacker.battle_context.slipstream_bonus_kmh,4.7);
  assert.equal(attacker.traffic.ahead_car_id,"C1");
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
        gap_to_previous_ms:null,
        best_lap_ms:61234,
        battle:{phase:"side_by_side",role:"attacker",opponentCarId:"C2"},
        battle_context:{state:"side_by_side",role:"attacker",opponent_car_id:"C2",remaining_ms:900},
        traffic:{gap_m:4.2,slipstream_active:false},
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
        gap_to_previous_ms:1250,
        best_lap_ms:62345,
        battle:{phase:"side_by_side",role:"defender",opponentCarId:"C1"},
        battle_context:{state:"side_by_side",role:"defender",opponent_car_id:"C1",remaining_ms:900},
        traffic:{gap_m:4.2,slipstream_active:false},
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
  assert.equal(cars[1].gap_to_previous_ms,1250);
  assert.equal(cars[0].best_lap_ms,61234);
  assert.equal(cars[0].battle.phase,"side_by_side");
  assert.equal(cars[1].battle.role,"defender");
  assert.equal(cars[0].battle_context.remaining_ms,900);
  assert.equal(cars[0].traffic.gap_m,4.2);
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

test("RW13C damage presenter includes canonical overall and component percentages",()=>{
  const context={
    drivers:[{driver_id:"D1",display_name:"Mario Andretti"}],
  };
  const event={
    type:"damage",
    driverIds:["D1"],
    payload:{
      source:"contact",
      severity:"major",
      damage:{
        overall_damage_pct:41.6,
        damaged_components:["front_wing","floor"],
        components:{
          front_wing:{damage_pct:52.4},
          floor:{damage_pct:28.1},
        },
      },
    },
  };
  const presented=presentCanonicalRaceEvent(event,context);
  assert.equal(presented.label,"Car damage");
  assert.equal(presented.iconKey,"damage");
  assert.equal(presented.priority,"important");
  assert.equal(
    presented.text,
    "Mario Andretti suffers major damage after contact — 42% overall · front wing 52%, floor 28%"
  );
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


test("RW13A Race View reads lap position delta from canonical car timing state",()=>{
  let state=startRaceState(createRaceState(input(),{stepMs:100}));
  const target=state.cars[0];
  state={
    ...state,
    cars:state.cars.map((car)=>car.carId===target.carId?{
      ...car,
      previousLapPosition:4,
      lastLapPosition:2,
      positionChangeLastLap:2,
      lapPositionHistory:[{lap:3,position:2,previousPosition:4,change:2}],
    }:car),
  };
  state={...state,...projectCanonicalRaceTiming(state)};
  const view=projectRaceStateToRaceView(state);
  const row=view.classification.find((candidate)=>candidate.car_id===target.carId);
  assert.equal(row.previous_lap_position,4);
  assert.equal(row.last_lap_position,2);
  assert.equal(row.position_change_last_lap,2);
});


test("RW13B Control Tower model exposes only canonical classification metadata",()=>{
  const rows=canonicalRaceViewCars({
    classification:[{
      car_id:"C1",
      driver_id:"D1",
      team_id:"T1",
      position:3,
      grid_position:7,
      position_gain:4,
      previous_lap_position:5,
      last_lap_position:3,
      position_change_last_lap:2,
      visual_track_progress:0.4,
      distance_along_lap_m:400,
      absolute_distance_m:1400,
      speed_kmh:210,
      tyre:{compound:"Soft",condition:63},
      damage_state:{overall_damage_pct:31,severity:"moderate"},
      damage_severity:"moderate",
      damaged_components:["front_wing"],
      damage_pace_loss_s_per_lap:0.42,
      pit_state:{active:true,phase:"pit_box"},
      pit_count:1,
    }],
  });
  assert.equal(rows[0].position,3);
  assert.equal(rows[0].grid_position,7);
  assert.equal(rows[0].position_gain,4);
  assert.equal(rows[0].previous_lap_position,5);
  assert.equal(rows[0].last_lap_position,3);
  assert.equal(rows[0].position_change_last_lap,2);
  assert.equal(rows[0].damage_severity,"moderate");
  assert.deepEqual(rows[0].damaged_components,["front_wing"]);
  assert.equal(rows[0].damage_pace_loss_s_per_lap,0.42);
  assert.equal(rows[0].pit_state.phase,"pit_box");
  assert.equal(rows[0].pit_count,1);
});
