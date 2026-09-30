import assert from "node:assert/strict";
import test from "node:test";

import {
  RACE_VIEW_PLAYBACK_SPEEDS,
  advanceCanonicalRaceViewFrame,
  advanceCanonicalRaceViewTimestamp,
  canonicalRaceViewElapsedMs,
  canonicalRaceViewPlaybackSpeed,
  raceViewFrameElapsedMs,
} from "../src/race2/runtime/RaceViewPlayback.js";

function legacyState(){
  return {raceWeekendState:{engine_version:"legacy",phase:"race"}};
}

test("RW8.14G exposes a bounded discrete playback-speed contract",()=>{
  assert.deepEqual(RACE_VIEW_PLAYBACK_SPEEDS,[0.5,1,2,4,8]);
  assert.equal(canonicalRaceViewPlaybackSpeed(undefined),1);
  assert.equal(canonicalRaceViewPlaybackSpeed(1.8),2);
  assert.equal(canonicalRaceViewPlaybackSpeed(99),8);
  assert.equal(canonicalRaceViewPlaybackSpeed(-4),0.5);
});

test("RW8.14G scales elapsed time without inventing sector checkpoints",()=>{
  assert.equal(canonicalRaceViewElapsedMs(250,4),1000);
  assert.equal(canonicalRaceViewElapsedMs(250,0.5),125);
  assert.equal(canonicalRaceViewElapsedMs(-100,2),0);
});

test("RW8.14G leaves Legacy ownership untouched",()=>{
  const gs=legacyState();
  const frame=advanceCanonicalRaceViewFrame(gs,{elapsedMs:250,playbackSpeed:4});
  assert.equal(frame.gameState,gs);
  assert.equal(frame.view,null);
  assert.equal(frame.advancedMs,0);
});

test("RW8.14H primes and resumes the Race View clock without catch-up time",()=>{
  assert.equal(raceViewFrameElapsedMs(null,1000),0);
  assert.equal(raceViewFrameElapsedMs(undefined,1000),0);
  assert.equal(raceViewFrameElapsedMs(1000,1250),250);
  assert.equal(raceViewFrameElapsedMs(1250,1200),0);
  assert.equal(raceViewFrameElapsedMs(1000,Number.NaN),0);
});

test("RW8.14H timestamp boundary still refuses to advance Legacy",()=>{
  const gs=legacyState();
  const frame=advanceCanonicalRaceViewTimestamp(gs,{
    previousTimestampMs:1000,
    currentTimestampMs:1250,
    playbackSpeed:4,
  });
  assert.equal(frame.gameState,gs);
  assert.equal(frame.view,null);
  assert.equal(frame.advancedMs,0);
});
