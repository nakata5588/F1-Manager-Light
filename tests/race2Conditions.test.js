import test from "node:test";
import assert from "node:assert/strict";

import { raceControlRulesForYear } from "../src/engine/RaceControlEngine.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { advanceRaceConditions } from "../src/race2/core/RaceConditions.js";
import { startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";

function weatherRow(lap,{
  state="SUNNY",
  wetness=0,
  rain=0,
  grip=80,
  trackTemp=30,
  airTemp=22,
  standingWater=0,
  visibility=100,
  spray=0,
  raceability=95,
  hazard=5,
}={}){
  return {
    lap,
    state,
    rain_intensity:rain,
    rain_band:rain>0.7?"HEAVY":rain>0.1?"LIGHT":"NONE",
    track_wetness:wetness,
    wetness_delta:0,
    rubber_level:20,
    grip_index:grip,
    air_temp_c:airTemp,
    track_temp_c:trackTemp,
    spray_index:spray,
    spray_band:spray>0.7?"HEAVY":"NONE",
    visibility_index:visibility,
    visibility_band:visibility<50?"VERY_POOR":"CLEAR",
    standing_water_index:standingWater,
    standing_water_band:standingWater>60?"HEAVY":"NONE",
    raceability_index:raceability,
    raceability_hazard_index:hazard,
    raceability_band:raceability<35?"CRITICAL":"GOOD",
    raceability_factors:{},
    raceability_dominant_factors:[],
  };
}

function input({
  year=1980,
  rules=raceControlRulesForYear(year),
  timeline=[
    weatherRow(1),
    weatherRow(2,{state:"LIGHT_RAIN",wetness:0.45,rain:0.46,grip:62,trackTemp:23,airTemp:19,standingWater:22,visibility:76,spray:0.28,raceability:68,hazard:32}),
    weatherRow(3,{state:"HEAVY_RAIN",wetness:0.82,rain:0.8,grip:38,trackTemp:19,airTemp:17,standingWater:72,visibility:44,spray:0.78,raceability:28,hazard:72}),
  ],
}={}){
  return {
    schemaVersion:12,
    engineVersion:"rw2",
    weekendKey:"rw8.11a-conditions",
    seed:"rw8.11a",
    year,
    entries:[{driverId:"D1",teamId:"T1",carId:"C1",status:"confirmed"}],
    drivers:[{
      driverId:"D1",
      teamId:"T1",
      performance:{raceScore:80,overtaking:70,defending:70,mistakePropensity:30,aggression:50,tyreManagement:70},
    }],
    cars:[{
      carId:"C1",
      driverId:"D1",
      teamId:"T1",
      state:{componentCondition:{engine:100}},
      performance:{overall:80,qualifying:80,race:80,reliability:85,chassis:80,power:80},
      resourceSetup:{tyres:[]},
    }],
    rules:{race:{refuelling_allowed:false}},
    raceControl:{rules},
    weather:{state:timeline[0].state,timeline},
    startingGrid:[{grid:1,driver_id:"D1",team_id:"T1"}],
    track:{
      schemaVersion:2,
      trackId:"conditions-test",
      year,
      lengthM:1000,
      laps:3,
      traits:{tyreWear:50},
      startFinish:{progress:0,distanceM:0},
      sectors:[
        {id:"sector_1",sector:1,startM:0,endM:333,lengthM:333},
        {id:"sector_2",sector:2,startM:333,endM:666,lengthM:333},
        {id:"sector_3",sector:3,startM:666,endM:1000,lengthM:334},
      ],
      speedProfile:{source:"neutral",detailed:false,sampleSpacingM:1000,windowM:null,samples:[{distanceM:0,severity:0}]},
    },
  };
}

test("RW8.11A initial RaceState materialises canonical weather, track and era Race Control state",()=>{
  const state=createRaceState(input());
  assert.equal(state.schemaVersion,10);
  assert.equal(state.trackState.weatherState,"SUNNY");
  assert.equal(state.trackState.referenceLap,1);
  assert.equal(state.weatherState.currentLap,1);
  assert.equal(state.weatherState.timeline.length,3);
  assert.equal(state.raceControlState.rules.era_id,"pre_standard_safety_car");
  assert.equal(state.raceControlState.recommendedMode,"GREEN");
});

test("RW8.11A conditions follow the leader reference lap from the snapshotted weather timeline",()=>{
  const state=startRaceState(createRaceState(input()));
  const cars=state.cars.map((car)=>({...car,lap:2,completedLaps:1}));
  const next=advanceRaceConditions(state,cars,[]);
  assert.equal(next.trackState.referenceLap,2);
  assert.equal(next.trackState.weatherState,"LIGHT_RAIN");
  assert.equal(next.trackState.wetness,0.45);
  assert.equal(next.weatherState.track_temp_c,23);
});

test("RW8.11A reuses era-aware incident policy instead of inventing RW2 thresholds",()=>{
  const event={
    type:"damage",
    carIds:["C1"],
    driverIds:["D1"],
    payload:{source:"contact",severity:"high",severityScore:0.84},
  };

  const historic=createRaceState(input({year:1980}));
  const historicDecision=advanceRaceConditions(historic,historic.cars,[event]);
  assert.equal(historicDecision.raceControlState.recommendedMode,"LOCAL_YELLOW");

  const modern=createRaceState(input({year:2015}));
  const mediumEvent={
    ...event,
    payload:{source:"contact",severity:"medium",severityScore:0.55},
  };
  const modernDecision=advanceRaceConditions(modern,modern.cars,[mediumEvent]);
  assert.equal(modernDecision.raceControlState.recommendedMode,"VSC");
});

test("RW8.11A severe weather assessment can recommend an era-available Red Flag",()=>{
  const extreme=weatherRow(1,{
    state:"STORM",
    wetness:0.95,
    rain:1,
    grip:24,
    trackTemp:17,
    airTemp:15,
    standingWater:92,
    visibility:28,
    spray:0.96,
    raceability:12,
    hazard:88,
  });
  const state=createRaceState(input({year:2026,timeline:[extreme,extreme,extreme]}));
  const first=advanceRaceConditions(state,state.cars,[]);
  const repeat=advanceRaceConditions(state,state.cars,[]);
  assert.deepEqual(first,repeat);
  assert.equal(first.raceControlState.recommendedMode,"RED_FLAG");
  assert.equal(first.raceControlState.source,"weather");
});

test("RW8.11A fixed-step simulation persists canonical condition state",()=>{
  let state=startRaceState(createRaceState(input()));
  state={...state,cars:state.cars.map((car)=>({
    ...car,
    lap:2,
    completedLaps:1,
    absoluteDistanceM:1000,
    distanceAlongLapM:0,
    sector:1,
  }))};
  const next=stepRaceState(state);
  assert.equal(next.trackState.referenceLap,2);
  assert.equal(next.weatherState.currentLap,2);
  assert.equal(next.session.weather.state,"LIGHT_RAIN");
  assert.equal(next.session.raceControl.model,"rw8.11a");
});
