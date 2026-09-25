import test from "node:test";
import assert from "node:assert/strict";

import {
  completeRedFlagRestart,
  createRedFlagSuspension,
  legacyRedFlagLifecycle,
  prepareRedFlagRestart,
  redFlagClockPolicyForYear,
  redFlagHoldingAreaForYear,
} from "../src/engine/RedFlagLifecycleEngine.js";

test("RW5.2D4.4 holding area changes with the 2015 suspension procedure",()=>{
  assert.equal(redFlagHoldingAreaForYear(1980),"starting_grid");
  assert.equal(redFlagHoldingAreaForYear(2014),"starting_grid");
  assert.equal(redFlagHoldingAreaForYear(2015),"pit_lane");
  assert.equal(redFlagHoldingAreaForYear(2026),"pit_lane");
});

test("RW5.2D4.4 modern clock policy separates frozen track progress from formal timekeeping",()=>{
  assert.equal(redFlagClockPolicyForYear(1980),"track_progress_frozen");
  assert.equal(redFlagClockPolicyForYear(2015),"timekeeping_continues_suspension_allowance");
  assert.equal(redFlagClockPolicyForYear(2026),"timekeeping_continues_suspension_allowance");
});

test("RW5.2D4.4 suspension snapshots classification and environment deterministically",()=>{
  const lifecycle=createRedFlagSuspension({
    year:1980,
    rules:{restart_style:"era_restart",red_flag_holding_area:"starting_grid"},
    period:{
      type:"RED_FLAG",
      cause:"weather",
      from_lap:7,
      from_sector:1,
      race_control_score:84.2,
      race_control_severity:"EXTREME",
      race_control_signals:["standing_water","visibility"],
      race_control_factors:["raceability","standing_water"],
    },
    classification:[
      {driver_id:"D2",team_id:"T2",position:2,laps_completed:6,elapsed_ms:550000,status:"RUNNING",retired:false,tyre:{tyre_id:"w",compound:"Wet",category:"wet",condition:88,age_laps:5}},
      {driver_id:"D1",team_id:"T1",position:1,laps_completed:6,elapsed_ms:548000,status:"RUNNING",retired:false,tyre:{tyre_id:"w",compound:"Wet",category:"wet",condition:90,age_laps:5}},
    ],
    lap:7,
    sector:1,
    trackState:{
      state:"STORM",
      rain_intensity:0.78,
      track_wetness:0.96,
      standing_water_index:91,
      raceability_index:18,
      visibility_index:31,
      spray_index:0.98,
      grip_index:24,
    },
  });

  assert.equal(lifecycle.phase,"suspended");
  assert.equal(lifecycle.race_progress_frozen,true);
  assert.equal(lifecycle.overtaking_allowed,false);
  assert.equal(lifecycle.holding_area,"starting_grid");
  assert.deepEqual(lifecycle.classification_snapshot.map((row)=>row.driver_id),["D1","D2"]);
  assert.equal(lifecycle.classification_snapshot[0].position,1);
  assert.equal(lifecycle.track_snapshot.standing_water_index,91);
  assert.equal(lifecycle.suspension_period.race_control_score,84.2);
});

test("RW5.2D4.4 restart lifecycle is explicitly suspended -> pending -> resumed",()=>{
  const suspended=createRedFlagSuspension({
    year:2026,
    rules:{restart_style:"modern_restart"},
    lap:10,
    sector:2,
  });

  const cannotSkip=completeRedFlagRestart(suspended,{lap:10,sector:2});
  assert.equal(cannotSkip.phase,"suspended");

  const pending=prepareRedFlagRestart(suspended);
  assert.equal(pending.phase,"restart_pending");
  assert.equal(pending.restart_prepared,true);
  assert.equal(pending.restart_authorized,true);
  assert.equal(pending.race_progress_frozen,true);

  const resumed=completeRedFlagRestart(pending,{lap:10,sector:2});
  assert.equal(resumed.phase,"resumed");
  assert.equal(resumed.race_progress_frozen,false);
  assert.equal(resumed.overtaking_allowed,true);
  assert.equal(resumed.resumed_lap,10);
  assert.equal(resumed.resumed_sector,2);
});

test("RW5.2D4.4 legacy red-flag saves can be normalised into the lifecycle",()=>{
  const lifecycle=legacyRedFlagLifecycle({
    year:1980,
    rules:{restart_style:"era_restart"},
    live:{
      status:"red_flag",
      current_lap:4,
      current_sector:3,
      current_control:"RED_FLAG",
      red_flag_period:{type:"RED_FLAG",from_lap:4,from_sector:3,cause:"incident"},
      classification:[{driver_id:"D1",position:1,status:"RUNNING"}],
      track_state:{raceability_index:33},
    },
  });

  assert.equal(lifecycle.phase,"suspended");
  assert.equal(lifecycle.triggered_lap,4);
  assert.equal(lifecycle.triggered_sector,3);
  assert.equal(lifecycle.classification_snapshot.length,1);
});
