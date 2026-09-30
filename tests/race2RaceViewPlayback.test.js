import assert from "node:assert/strict";
import test from "node:test";

import {
  RACE_VIEW_PLAYBACK_SPEEDS,
  advanceCanonicalRaceViewFrame,
  advanceCanonicalRaceViewTimestamp,
  canonicalRaceViewElapsedMs,
  canonicalRaceViewPlaybackSpeed,
  createCanonicalRaceViewFrameClock,
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

test("RW8.14I frame clock owns only wall-clock continuity and resets cleanly",()=>{
  const gs=legacyState();
  const clock=createCanonicalRaceViewFrameClock();

  const prime=clock.frame(gs,{timestampMs:1000,playbackSpeed:4});
  assert.equal(prime.advancedMs,0);

  const next=clock.frame(gs,{timestampMs:1250,playbackSpeed:4});
  assert.equal(next.advancedMs,0,"Legacy remains isolated even when frame time advances");

  clock.reset();
  const resumed=clock.frame(gs,{timestampMs:9000,playbackSpeed:4});
  assert.equal(resumed.advancedMs,0,"resume primes instead of simulating the paused wall-clock gap");
});

test("RW8.14I invalid frame timestamps break continuity instead of creating catch-up time",()=>{
  const gs=legacyState();
  const clock=createCanonicalRaceViewFrameClock();
  clock.frame(gs,{timestampMs:1000});
  clock.frame(gs,{timestampMs:Number.NaN});
  const recovered=clock.frame(gs,{timestampMs:5000});
  assert.equal(recovered.advancedMs,0);
});
