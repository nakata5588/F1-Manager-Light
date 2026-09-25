import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRaceability, raceabilityBand } from "../src/engine/RaceabilityEngine.js";
import { buildTrackWeatherTimeline } from "../src/engine/RaceControlEngine.js";

test("RW5.2D4.1 dry healthy conditions remain highly raceable",()=>{
  const result=evaluateRaceability({
    wetness:0,
    sprayIndex:0,
    visibilityIndex:100,
    gripIndex:95,
    rainIntensity:0,
    wetnessDelta:0,
  });
  assert.ok(result.index>95);
  assert.equal(result.band,"GOOD");
  assert.ok(result.hazard_index<5);
});

test("RW5.2D4.1 no single visibility threshold can make an otherwise dry track critical",()=>{
  const result=evaluateRaceability({
    wetness:0,
    sprayIndex:0,
    visibilityIndex:35,
    gripIndex:95,
    rainIntensity:0,
    wetnessDelta:0,
  });
  assert.ok(result.index>75);
  assert.equal(result.band,"GOOD");
});

test("RW5.2D4.1 combined extreme wet conditions produce critical raceability",()=>{
  const result=evaluateRaceability({
    wetness:0.92,
    sprayIndex:0.96,
    visibilityIndex:36,
    gripIndex:28,
    rainIntensity:0.68,
    wetnessDelta:0.025,
  });
  assert.ok(result.index<35);
  assert.equal(result.band,"CRITICAL");
  assert.ok(result.dominant_factors.includes("spray"));
  assert.ok(result.dominant_factors.includes("visibility")||result.dominant_factors.includes("wetness"));
});

test("RW5.2D4.1 worsening water trend reduces raceability without becoming a hard trigger",()=>{
  const stable=evaluateRaceability({
    wetness:0.62,
    sprayIndex:0.58,
    visibilityIndex:58,
    gripIndex:52,
    rainIntensity:0.48,
    wetnessDelta:0,
  });
  const worsening=evaluateRaceability({
    wetness:0.62,
    sprayIndex:0.58,
    visibilityIndex:58,
    gripIndex:52,
    rainIntensity:0.48,
    wetnessDelta:0.04,
  });
  assert.ok(worsening.index<stable.index);
  assert.ok(stable.index-worsening.index<5);
});

test("RW5.2D4.1 composite bands are based on the combined index",()=>{
  assert.equal(raceabilityBand(90),"GOOD");
  assert.equal(raceabilityBand(70),"DEGRADED");
  assert.equal(raceabilityBand(50),"POOR");
  assert.equal(raceabilityBand(20),"CRITICAL");
});

test("RW5.2D4.1 weather timeline exposes raceability telemetry on every lap",()=>{
  const gs={
    activeYear:1980,
    teams:[{team_id:"T1"},{team_id:"T2"}],
    dbWeatherStates:[],
    raceWeekendState:{gp_id:"TEST_GP"},
  };
  const weather={
    state:"LIGHT_RAIN",
    starting_track_wetness:0.35,
    starting_rubber_level:8,
    starting_air_temp_c:20,
    starting_track_temp_c:23,
    wind_profile:"medium",
    segments:[{from_lap:1,to_lap:6,state:"LIGHT_RAIN"}],
  };
  const timeline=buildTrackWeatherTimeline(gs,weather,{
    track_id:"TEST_TRACK",
    laps:6,
    drainage_rating:0.45,
  });

  assert.equal(timeline.length,6);
  for(const row of timeline){
    assert.ok(Number.isFinite(row.raceability_index));
    assert.ok(Number.isFinite(row.raceability_hazard_index));
    assert.ok(["GOOD","DEGRADED","POOR","CRITICAL"].includes(row.raceability_band));
    assert.equal(typeof row.raceability_factors,"object");
    assert.ok(Array.isArray(row.raceability_dominant_factors));
  }
});
