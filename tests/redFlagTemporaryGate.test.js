import test from "node:test";
import assert from "node:assert/strict";
import {
  weatherRaceControlAssessment,
  incidentRaceControlAssessment,
  RED_FLAGS_ENABLED,
} from "../src/engine/RaceControlPolicyEngine.js";
import { buildTrackWeatherTimeline } from "../src/engine/RaceControlEngine.js";

const rules={red_flag:true,safety_car:false,virtual_safety_car:false};
test("temporary policy gate prevents red flags for extreme weather and critical incidents",()=>{
  assert.equal(RED_FLAGS_ENABLED,false);
  const extreme={rain_intensity:1,track_wetness:1,standing_water_index:100,visibility_index:0,spray_index:1,grip_index:20,raceability_hazard_index:100,wetness_delta:0.1};
  assert.notEqual(weatherRaceControlAssessment({rules,row:extreme}).action,"RED_FLAG");
  assert.notEqual(incidentRaceControlAssessment({rules,incident:{severity:"critical",kind:"accident"},weatherRow:extreme}).action,"RED_FLAG");
});
test("1980 rain timeline keeps evolving beyond lap 15 when run for full 53 laps",()=>{
  const weather={state:"LIGHT_RAIN",starting_track_wetness:0.12,segments:[{from_lap:1,to_lap:53,state:"LIGHT_RAIN"}]};
  const timeline=buildTrackWeatherTimeline({activeYear:1980,teams:Array.from({length:10},(_,i)=>({id:i}))},weather,{track_id:"ARGENTINA",laps:53,drainage_rating:0.5});
  assert.equal(timeline.length,53);
  assert.equal(timeline[52].lap,53);
  assert.ok(new Set(timeline.slice(15).map(row=>row.track_wetness)).size>1);
  assert.ok(new Set(timeline.slice(15).map(row=>row.rain_intensity)).size>1);
});
