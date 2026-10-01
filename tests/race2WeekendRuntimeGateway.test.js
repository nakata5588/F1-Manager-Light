import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_RACE_ENGINE_VERSION,
  advanceRaceWeekendElapsed,
  autosimRaceWeekendToEnd,
  cancelRaceWeekendCanonicalCommand,
  queueRaceWeekendCanonicalCommand,
  raceWeekendCanonicalCheckpointDue,
  raceWeekendCanonicalView,
  raceWeekendUsesCanonicalRuntime,
} from "../src/race2/gateway/RaceWeekendRuntimeGateway.js";
import {
  RACE_VIEW_PLAYBACK_SPEEDS,
  advanceCanonicalRaceViewFrame,
  canonicalRaceViewElapsedMs,
  canonicalRaceViewPlaybackSpeed,
} from "../src/race2/runtime/RaceViewPlayback.js";

const state=(engine_version="legacy",phase="race")=>({
  raceWeekendState:{engine_version,phase},
});

test("RW8.14E canonical runtime routing is explicit, normalized and race-phase locked",()=>{
  assert.equal(CANONICAL_RACE_ENGINE_VERSION,"rw2");
  assert.equal(raceWeekendUsesCanonicalRuntime(state("rw2","race")),true);
  assert.equal(raceWeekendUsesCanonicalRuntime(state(" RW2 "," RACE ")),true);
  assert.equal(raceWeekendUsesCanonicalRuntime(state("legacy","race")),false);
  assert.equal(raceWeekendUsesCanonicalRuntime(state("rw2","grid_ready")),false);
  assert.equal(raceWeekendUsesCanonicalRuntime({}),false);
});

test("RW8.14E leaves Legacy and pre-race states byte-for-byte untouched",()=>{
  const legacy=state("legacy","race");
  const preRace=state("rw2","grid_ready");
  assert.equal(advanceRaceWeekendElapsed(legacy,{elapsedMs:1000}),legacy);
  assert.equal(autosimRaceWeekendToEnd(legacy),legacy);
  assert.equal(advanceRaceWeekendElapsed(preRace,{elapsedMs:1000}),preRace);
  assert.equal(raceWeekendCanonicalView(legacy),null);
  assert.equal(raceWeekendCanonicalView(preRace),null);
});

test("RW8.14G Race View playback scales elapsed time instead of sector stepping",()=>{
  assert.deepEqual(RACE_VIEW_PLAYBACK_SPEEDS,[0.5,1,2,4,8]);
  assert.equal(canonicalRaceViewPlaybackSpeed(1.8),2);
  assert.equal(canonicalRaceViewPlaybackSpeed(99),8);
  assert.equal(canonicalRaceViewElapsedMs(250,4),1000);
  assert.equal(canonicalRaceViewElapsedMs(250,0.5),125);
});

test("RW8.14G Race View playback cannot route Legacy into canonical runtime",()=>{
  const legacy=state("legacy","race");
  const frame=advanceCanonicalRaceViewFrame(legacy,{elapsedMs:250,playbackSpeed:4});
  assert.equal(frame.gameState,legacy);
  assert.equal(frame.view,null);
  assert.equal(frame.advancedMs,0);
});


test("RW8.14J command and checkpoint gateways refuse Legacy ownership",()=>{
  const legacy=state("legacy","race");
  assert.equal(queueRaceWeekendCanonicalCommand(legacy,{command:{type:"pace",driverId:"D1",paceMode:"attack"}}),legacy);
  assert.equal(cancelRaceWeekendCanonicalCommand(legacy,{criteria:{driverId:"D1"}}),legacy);
  assert.equal(raceWeekendCanonicalCheckpointDue(legacy,legacy),false);
});
