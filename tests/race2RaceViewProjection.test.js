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
import { presentCanonicalRaceEvent } from "../src/race2/presentation/RaceEventPresenter.js";

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
      retirement:{reason:"Engine failure"},
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
