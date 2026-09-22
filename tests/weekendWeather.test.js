import test from "node:test";
import assert from "node:assert/strict";

import { createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "../src/core/saveSafety.js";
import {
  createWeekendWeatherState,
  forecastAccuracyForTeam,
  observeWeekendWeatherSession,
  raceWeekendWeatherSession,
  sessionWeatherIsWet,
  sessionWeatherPerformanceMultiplier,
  weatherSimilarity,
} from "../src/engine/WeekendWeatherEngine.js";
import { buildRaceWeatherSnapshot } from "../src/engine/RaceStrategyEngine.js";
import { trackSetupProfile } from "../src/engine/PracticeSetupEngine.js";

const gp={gp_id:"weather_gp",track_id:"weather_track",race_date:"1980-05-18",year:1980};
const sessions=[
  {id:"practice",type:"practice",label:"Practice",dateISO:"1980-05-16"},
  {id:"qualifying_1",type:"qualifying",label:"Qualifying 1",dateISO:"1980-05-16"},
  {id:"qualifying_2",type:"qualifying",label:"Qualifying 2",dateISO:"1980-05-17"},
  {id:"grid",type:"grid",label:"Grid",dateISO:"1980-05-17"},
  {id:"race",type:"race",label:"Race",dateISO:"1980-05-18"},
];

function baseGs(year=1980,seed="rw4.3-weather"){
  return {
    saveMeta:createNewSaveMeta({year,teamId:"T1",seed}),
    activeYear:year,
    currentDateISO:year+"-05-16",
    team:{team_id:"T1",team_name:"Player"},
    teams:[{team_id:"T1",team_name:"Player"}],
    staffContracts:[
      {team_id:"T1",staff_id:"S1",role:"chief_engineer",contract_start:1970,contract_until:2030,status:"active"},
      {team_id:"T1",staff_id:"S2",role:"strategist",contract_start:1970,contract_until:2030,status:"active"},
    ],
    staffRatings:[
      {staff_id:"S1",technical:88,data_analysis:90,communication:82},
      {staff_id:"S2",technical:76,data_analysis:94,communication:90},
    ],
    facilities:[{team_id:"T1",year,pitcrew_training_level:7}],
    dbWeatherProfiles:[{
      track_id:"weather_track",month:5,avg_temp:23,rain_chance:46,storm_chance:7,wind_profile:"medium",
    }],
    coreTracks:[{
      track_id:"weather_track",track_name:"Weather Circuit",crash_risk:60,overtaking_difficulty:55,tyre_wear:58,lap_length_km:5,
    }],
    trackLayoutByYear:[{track_id:"weather_track",year_from:1970,year_to:2030,lap_length_km:5,laps:60,pit_lane_loss_s:22}],
  };
}

test("weekend weather world is deterministic and covers every competitive session",()=>{
  const gs=baseGs();
  const a=createWeekendWeatherState(gs,{gp,sessions});
  const b=createWeekendWeatherState(gs,{gp,sessions});
  assert.deepEqual(a,b);
  assert.deepEqual(Object.keys(a.sessions),["practice","qualifying_1","qualifying_2","race"]);
  assert.equal(a.source,"weekend_weather_world");
  assert.ok(a.forecast.practice);
  assert.ok(a.forecast.race);
});

test("forecast capability is era-aware and 1980 remains intentionally uncertain",()=>{
  const oldAccuracy=forecastAccuracyForTeam(baseGs(1980),"T1");
  const modernAccuracy=forecastAccuracyForTeam(baseGs(2020),"T1");
  assert.ok(oldAccuracy<=0.68);
  assert.ok(oldAccuracy>=0.42);
  assert.ok(modernAccuracy>oldAccuracy);
});

test("observing a session refreshes future forecast without rewriting actual weather",()=>{
  const gs=baseGs();
  const world=createWeekendWeatherState(gs,{gp,sessions});
  const state={...gs,raceWeekendState:{gp_id:gp.gp_id,track_id:gp.track_id,active_session_id:"practice",weekend_weather:world}};
  const actualBefore=structuredClone(state.raceWeekendState.weekend_weather.sessions);
  const forecastBefore=structuredClone(state.raceWeekendState.weekend_weather.forecast);
  const next=observeWeekendWeatherSession(state,"practice");
  assert.equal(next.raceWeekendState.weekend_weather.forecast_revision,1);
  assert.ok(next.raceWeekendState.weekend_weather.observed_sessions.includes("practice"));
  assert.deepEqual(next.raceWeekendState.weekend_weather.sessions,actualBefore);
  assert.notDeepEqual(next.raceWeekendState.weekend_weather.forecast,forecastBefore);
});

test("weekend weather state is save/load safe",()=>{
  const gs=baseGs();
  const world=createWeekendWeatherState(gs,{gp,sessions});
  const state={...gs,raceWeekendState:{gp_id:gp.gp_id,track_id:gp.track_id,active_session_id:"practice",weekend_weather:world}};
  const saved=prepareGameStateForSave(state);
  const loaded=extractGameStateFromStoredSave({meta:{name:"weather"},gameState:saved});
  assert.deepEqual(loaded.raceWeekendState.weekend_weather,world);
});

test("wet Practice changes the setup target and session performance model",()=>{
  const gs=baseGs();
  const dry={state:"SUNNY",track:{start_wetness:0,grip_index:94},track_temp_c:35};
  const wet={state:"HEAVY_RAIN",track:{start_wetness:0.82,grip_index:68},track_temp_c:20};
  const dryProfile=trackSetupProfile(gs,gp,dry);
  const wetProfile=trackSetupProfile(gs,gp,wet);
  assert.ok(wetProfile.target.mechanicalGrip>dryProfile.target.mechanicalGrip);
  assert.ok(wetProfile.target.aeroBalance>dryProfile.target.aeroBalance);
  assert.ok(wetProfile.target.gearing<dryProfile.target.gearing);
  assert.equal(sessionWeatherIsWet(wet),true);
  assert.ok(sessionWeatherPerformanceMultiplier(wet)<sessionWeatherPerformanceMultiplier(dry));
});

test("Practice relevance falls when Race conditions are from a different weather family",()=>{
  const dry={state:"SUNNY",track:{end_wetness:0.02},track_temp_c:34};
  const similar={state:"CLOUDY",track:{start_wetness:0.03},track_temp_c:29};
  const wet={state:"HEAVY_RAIN",track:{start_wetness:0.82},track_temp_c:19};
  assert.ok(weatherSimilarity(dry,similar)>weatherSimilarity(dry,wet));
});

test("RaceStrategy consumes the saved weekend Race weather instead of generating a new one",()=>{
  const gs=baseGs();
  const world=createWeekendWeatherState(gs,{gp,sessions});
  const state={...gs,raceWeekendState:{gp_id:gp.gp_id,track_id:gp.track_id,active_session_id:"practice",weekend_weather:world}};
  const race=raceWeekendWeatherSession(state);
  const snapshot=buildRaceWeatherSnapshot(state,gp,{
    track_id:"weather_track",laps:60,lap_length_km:5,pit_lane_loss_s:22,tyre_wear:58,overtaking_difficulty:55,
  });
  assert.equal(snapshot.source,"weekend_weather_world");
  assert.equal(snapshot.state,race.state);
  assert.equal(snapshot.avg_temp_c,race.air_temp_c);
  assert.equal(snapshot.starting_track_wetness,race.track.start_wetness);
  assert.equal(snapshot.rubber_level,race.track.rubber_level);
});
