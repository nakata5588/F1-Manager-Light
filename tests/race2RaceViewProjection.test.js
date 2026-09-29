import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import {
  RACE_VIEW_PROJECTION_SOURCE,
  RACE_VIEW_PROJECTION_VERSION,
  projectRaceStateToRaceView,
} from "../src/race2/adapters/RaceViewProjection.js";

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
