import test from "node:test";
import assert from "node:assert/strict";

import {
  assessRestartConditions,
  createRestartMonitor,
  fastForwardRestartConditions,
  restartHysteresisPolicyForYear,
  suspendRestartProcedure,
} from "../src/engine/RestartHysteresisEngine.js";

const modernRules={safety_car:true,virtual_safety_car:true,red_flag:true};
const historicRules={safety_car:false,virtual_safety_car:false,red_flag:true};

function row(lap,overrides={}){
  return {
    lap,
    raceability_index:80,
    raceability_hazard_index:20,
    standing_water_index:10,
    visibility_index:90,
    spray_index:0.10,
    grip_index:82,
    rain_intensity:0.10,
    wetness_delta:-0.01,
    raceability_band:"GOOD",
    ...overrides,
  };
}

function extreme(lap){
  return row(lap,{
    raceability_index:18,
    raceability_hazard_index:82,
    standing_water_index:92,
    visibility_index:28,
    spray_index:0.98,
    grip_index:24,
    rain_intensity:0.84,
    wetness_delta:0.03,
    raceability_band:"CRITICAL",
  });
}

function safetyCarLevel(lap){
  return row(lap,{
    raceability_index:50,
    raceability_hazard_index:50,
    standing_water_index:65,
    visibility_index:45,
    spray_index:0.75,
    grip_index:40,
    rain_intensity:0.65,
    wetness_delta:0,
    raceability_band:"POOR",
  });
}

test("RW5.2D4.6 weather restart needs two consecutive safe observations",()=>{
  const timeline=[extreme(1),row(2),row(3)];
  let monitor=createRestartMonitor({
    year:1980,
    rules:historicRules,
    cause:"weather",
    triggerTrackState:timeline[0],
  });
  assert.equal(monitor.required_safe_checks,2);
  assert.equal(monitor.restart_authorized,false);

  let result=assessRestartConditions({
    monitor,year:1980,rules:historicRules,cause:"weather",timeline,currentLap:1,
  });
  monitor=result.monitor;
  assert.equal(result.safe,true);
  assert.equal(monitor.safe_streak,1);
  assert.equal(monitor.restart_authorized,false);

  result=assessRestartConditions({
    monitor,year:1980,rules:historicRules,cause:"weather",timeline,currentLap:1,
  });
  assert.equal(result.safe,true);
  assert.equal(result.monitor.safe_streak,2);
  assert.equal(result.monitor.restart_authorized,true);
  assert.equal(result.monitor.recommended_control,"GREEN");
});

test("Track 2.0 Red Flag fast-forward finds the first sustained safe restart window",()=>{
  const timeline=[extreme(1),extreme(2),extreme(3),row(4),row(5),row(6)];
  const monitor=createRestartMonitor({
    year:1980,
    rules:historicRules,
    cause:"weather",
    triggerTrackState:timeline[0],
  });
  const result=fastForwardRestartConditions({
    monitor,
    year:1980,
    rules:historicRules,
    cause:"weather",
    timeline,
    currentLap:1,
  });

  assert.equal(result.authorized,true);
  assert.equal(result.monitor.restart_authorized,true);
  assert.equal(result.monitor.recommended_control,"GREEN");
  assert.ok(result.checks_advanced>=4);
  assert.equal(result.monitor.safe_streak,2);
  assert.ok(Number(result.observation.timeline_index)>=4);
});

test("Track 2.0 Red Flag fast-forward keeps waiting after an unsafe race timeline until weather recovers",()=>{
  const timeline=[extreme(1),extreme(2),extreme(3)];
  const monitor=createRestartMonitor({
    year:1980,
    rules:historicRules,
    cause:"weather",
    triggerTrackState:timeline[0],
  });
  const result=fastForwardRestartConditions({
    monitor,
    year:1980,
    rules:historicRules,
    cause:"weather",
    timeline,
    currentLap:1,
  });

  assert.equal(result.authorized,true);
  assert.equal(result.exhausted,false);
  assert.equal(result.monitor.restart_authorized,true);
  assert.equal(result.monitor.safe_streak,2);
  assert.ok(result.generated_recovery_checks>=2);
  assert.equal(result.observation.track_state.restart_recovery_generated,true);
  assert.equal(result.observation.lap,1,"race distance remains frozen while wall-clock weather improves");
});

test("RW5.2D4.6 one unsafe observation resets the safe streak",()=>{
  const timeline=[extreme(1),row(2),extreme(3),row(4),row(5)];
  let monitor=createRestartMonitor({
    year:1980,rules:historicRules,cause:"weather",triggerTrackState:timeline[0],
  });

  let result=assessRestartConditions({
    monitor,year:1980,rules:historicRules,cause:"weather",timeline,currentLap:1,
  });
  assert.equal(result.monitor.safe_streak,1);

  result=assessRestartConditions({
    monitor:result.monitor,year:1980,rules:historicRules,cause:"weather",timeline,currentLap:1,
  });
  assert.equal(result.safe,false);
  assert.equal(result.monitor.safe_streak,0);
  assert.equal(result.monitor.restart_authorized,false);

  result=assessRestartConditions({
    monitor:result.monitor,year:1980,rules:historicRules,cause:"weather",timeline,currentLap:1,
  });
  assert.equal(result.monitor.safe_streak,1);
  assert.equal(result.monitor.restart_authorized,false);
});

test("RW5.2D4.6 modern era may authorise a Safety Car resumption",()=>{
  const timeline=[extreme(1),safetyCarLevel(2),safetyCarLevel(3)];
  let monitor=createRestartMonitor({
    year:2026,rules:modernRules,cause:"weather",triggerTrackState:timeline[0],
  });

  let result=assessRestartConditions({
    monitor,year:2026,rules:modernRules,cause:"weather",timeline,currentLap:1,
  });
  assert.equal(result.safe,true);
  result=assessRestartConditions({
    monitor:result.monitor,year:2026,rules:modernRules,cause:"weather",timeline,currentLap:1,
  });
  assert.equal(result.authorized,true);
  assert.equal(result.recommended_control,"SAFETY_CAR");
});

test("RW5.2D4.6 historic era requires a lower green-release threshold",()=>{
  const policy=restartHysteresisPolicyForYear(1980,historicRules,"weather");
  assert.equal(policy.allow_safety_car_restart,false);
  assert.equal(policy.release_score_max,47);

  const timeline=[extreme(1),safetyCarLevel(2),safetyCarLevel(3)];
  let monitor=createRestartMonitor({
    year:1980,rules:historicRules,cause:"weather",triggerTrackState:timeline[0],
  });
  let result=assessRestartConditions({
    monitor,year:1980,rules:historicRules,cause:"weather",timeline,currentLap:1,
  });
  assert.equal(result.safe,false);
  assert.equal(result.monitor.restart_authorized,false);
});

test("RW5.2D4.6 incident suspension needs one environmental clearance check",()=>{
  const timeline=[row(1),row(2)];
  const monitor=createRestartMonitor({
    year:1980,rules:historicRules,cause:"incident",triggerTrackState:timeline[0],
  });
  assert.equal(monitor.required_safe_checks,1);
  const result=assessRestartConditions({
    monitor,year:1980,rules:historicRules,cause:"incident",timeline,currentLap:1,
  });
  assert.equal(result.authorized,true);
});

test("RW5.2D4.6 final validation can suspend an already prepared resumption",()=>{
  const timeline=[extreme(1),row(2),row(3),extreme(4)];
  let monitor=createRestartMonitor({
    year:2026,rules:modernRules,cause:"weather",triggerTrackState:timeline[0],
  });
  let result=assessRestartConditions({
    monitor,year:2026,rules:modernRules,cause:"weather",timeline,currentLap:1,
  });
  result=assessRestartConditions({
    monitor:result.monitor,year:2026,rules:modernRules,cause:"weather",timeline,currentLap:1,
  });
  assert.equal(result.authorized,true);

  const final=assessRestartConditions({
    monitor:result.monitor,
    year:2026,
    rules:modernRules,
    cause:"weather",
    timeline,
    currentLap:1,
    finalValidation:true,
  });
  assert.equal(final.safe,false);
  assert.equal(final.authorized,false);

  const lifecycle=suspendRestartProcedure({
    phase:"restart_pending",
    work_locked:true,
    restart_prepared:true,
    restart_authorized:true,
    restart_monitor:result.monitor,
  },final.monitor);
  assert.equal(lifecycle.phase,"suspended");
  assert.equal(lifecycle.work_locked,false);
  assert.equal(lifecycle.restart_prepared,false);
  assert.equal(lifecycle.restart_monitor.safe_streak,0);
  assert.equal(lifecycle.restart_monitor.status,"procedure_suspended");
});
