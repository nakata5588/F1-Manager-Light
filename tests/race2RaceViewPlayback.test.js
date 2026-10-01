import assert from "node:assert/strict";
import test from "node:test";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";

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

function canonicalState(){
  const input={
    schemaVersion:15,engineVersion:"rw2",weekendKey:"rw8.14i-frame-clock",seed:"rw8.14i",year:2004,
    entries:[{driverId:"D1",teamId:"T1",carId:"C1",status:"confirmed"}],
    drivers:[{driverId:"D1",teamId:"T1",performance:{raceScore:80}}],
    cars:[{carId:"C1",driverId:"D1",teamId:"T1",performance:{race:80,reliability:100}}],
    startingGrid:[{driverId:"D1",teamId:"T1",gridPosition:1}],
    track:{schemaVersion:2,trackId:"T",year:2004,lengthM:5000,laps:3,traits:{},startFinish:{progress:0,distanceM:0},sectors:[{id:"sector_1",sector:1,startM:0,endM:1666,lengthM:1666},{id:"sector_2",sector:2,startM:1666,endM:3333,lengthM:1667},{id:"sector_3",sector:3,startM:3333,endM:5000,lengthM:1667}],speedProfile:{source:"neutral",detailed:false,sampleSpacingM:5000,windowM:null,samples:[{distanceM:0,severity:0}] }},
    weather:{state:"SUNNY",avg_temp_c:22,track_temp_c:30,timeline:[]},raceControl:{rules:{}},
  };
  const runtime={version:1,source:"rw8.14b_race_runtime",state:startRaceState(createRaceState(input,{stepMs:100})),accumulatorMs:0};
  return {activeYear:2004,raceWeekendState:{engine_version:"rw2",phase:"race",canonical_race_runtime:runtime}};
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
  const gs=canonicalState();
  const clock=createCanonicalRaceViewFrameClock();

  const prime=clock.frame(gs,{timestampMs:1000,playbackSpeed:4});
  assert.equal(prime.advancedMs,0);

  const next=clock.frame(gs,{timestampMs:1250,playbackSpeed:4});
  assert.equal(next.advancedMs,1000,"canonical runtime receives scaled elapsed frame time");

  clock.reset();
  const resumed=clock.frame(gs,{timestampMs:9000,playbackSpeed:4});
  assert.equal(resumed.advancedMs,0,"resume primes instead of simulating the paused wall-clock gap");
});

test("RW8.14I invalid frame timestamps break continuity instead of creating catch-up time",()=>{
  const gs=canonicalState();
  const clock=createCanonicalRaceViewFrameClock();
  clock.frame(gs,{timestampMs:1000});
  clock.frame(gs,{timestampMs:Number.NaN});
  const recovered=clock.frame(gs,{timestampMs:5000});
  assert.equal(recovered.advancedMs,0);
});
