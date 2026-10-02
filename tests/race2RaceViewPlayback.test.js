import assert from "node:assert/strict";
import test from "node:test";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";

import {
  nextRacePlaybackEpoch,
  normalizeRacePlaybackEpoch,
  racePlaybackAdvanceAllowed,
} from "../src/race2/runtime/RacePlaybackGate.js";

import {
  RACE_VIEW_PLAYBACK_SPEEDS,
  advanceCanonicalRaceViewFrame,
  advanceCanonicalRaceViewTimestamp,
  canonicalRaceViewElapsedMs,
  canonicalRaceViewPlaybackSpeed,
  createCanonicalRaceViewFrameClock,
  raceViewFrameElapsedMs,
} from "../src/race2/runtime/RaceViewPlayback.js";
import {
  interpolateRaceViewCar,
  interpolateRaceViewCars,
  raceViewInterpolationAlpha,
  raceViewInterpolationDurationMs,
  raceViewRetargetCanonicalDeltaMs,
  retimeRaceViewInterpolation,
  wrapRaceViewDistanceM,
} from "../src/race2/view/RaceViewInterpolation.js";
import {
  clampRaceViewZoom,
  raceViewBoxCenter,
  raceViewCameraViewBox,
  raceViewPitBoxProgress,
  raceViewWeatherVisuals,
} from "../src/race2/view/RaceViewPresentation.js";
import {
  pitBoxMixForPhase,
  pitLaneMixForPhase,
} from "../src/domain/racePitModel.js";

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

test("RW26 playback epoch invalidates stale in-flight canonical frames",()=>{
  const started=normalizeRacePlaybackEpoch(4);
  assert.equal(racePlaybackAdvanceAllowed(started,4),true);

  const paused=nextRacePlaybackEpoch(started);
  assert.equal(paused,5);
  assert.equal(
    racePlaybackAdvanceAllowed(started,paused),
    false,
    "a frame started before Pause cannot commit afterwards"
  );
  assert.equal(
    racePlaybackAdvanceAllowed(paused,paused,{autosimActive:true}),
    false,
    "Autosim ownership also blocks live-frame commits"
  );
  assert.equal(racePlaybackAdvanceAllowed(paused,paused),true);
});

test("RW8.14G exposes a bounded discrete playback-speed contract",()=>{
  assert.deepEqual(RACE_VIEW_PLAYBACK_SPEEDS,[0.5,1,2,4,8,16]);
  assert.equal(canonicalRaceViewPlaybackSpeed(undefined),1);
  assert.equal(canonicalRaceViewPlaybackSpeed(1.8),2);
  assert.equal(canonicalRaceViewPlaybackSpeed(99),16);
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


test("RW8.14J frame clock exposes elapsed sampling for the Zustand dispatch boundary",()=>{
  const clock=createCanonicalRaceViewFrameClock();
  assert.equal(clock.sampleElapsedMs(1000),0);
  assert.equal(clock.sampleElapsedMs(1125),125);
  clock.reset();
  assert.equal(clock.sampleElapsedMs(9000),0);
  assert.equal(clock.sampleElapsedMs(9250),250);
});


test("RW12A derives wall-clock interpolation duration from canonical time and playback speed",()=>{
  assert.equal(raceViewInterpolationDurationMs(1000,1100,1),100);
  assert.equal(raceViewInterpolationDurationMs(1000,1100,4),25);
  assert.equal(raceViewInterpolationDurationMs(1000,1100,8),12.5);
  assert.equal(raceViewInterpolationDurationMs(1000,1100,16),12);
  assert.equal(raceViewInterpolationDurationMs(1000,1100,0.5),200);
  assert.equal(raceViewInterpolationDurationMs(1100,1100,1),0);
  assert.equal(raceViewInterpolationAlpha(1000,100,1050),0.5);
  assert.equal(raceViewInterpolationAlpha(1000,100,1200),1);
});

test("RW21 retargets from the sampled visual pose without carrying stale canonical backlog",()=>{
  assert.equal(raceViewRetargetCanonicalDeltaMs(300,1000,1200),200);
  assert.equal(raceViewRetargetCanonicalDeltaMs(0,1000,1200),200);
  assert.equal(raceViewRetargetCanonicalDeltaMs(300,1200,1100),0);
});

test("RW21 high-speed retargeting stays tied to playback time instead of a 40 ms artificial floor",()=>{
  const oneStepAt16x=raceViewInterpolationDurationMs(1000,1100,16);
  const fourStepsAt16x=raceViewInterpolationDurationMs(1000,1400,16);
  assert.equal(oneStepAt16x,12);
  assert.equal(fourStepsAt16x,25);
  assert.ok(fourStepsAt16x<40);
});

test("RW18 retimes an in-flight visual segment from its current progress without snapping",()=>{
  const slowed=retimeRaceViewInterpolation({
    startedAtMs:1000,
    durationMs:40,
    canonicalDeltaMs:400,
    timestampMs:1020,
    playbackSpeed:1,
  });
  assert.equal(slowed.alpha,0.5);
  assert.equal(slowed.remainingCanonicalMs,200);
  assert.equal(slowed.durationMs,200);

  const accelerated=retimeRaceViewInterpolation({
    startedAtMs:1000,
    durationMs:200,
    canonicalDeltaMs:200,
    timestampMs:1050,
    playbackSpeed:16,
  });
  assert.equal(accelerated.alpha,0.25);
  assert.equal(accelerated.remainingCanonicalMs,150);
  assert.equal(accelerated.durationMs,12);
});

test("RW12A interpolates absolute distance through lap wrap without moving backwards",()=>{
  const from={
    id:"C1",
    car_id:"C1",
    absolute_distance_m:990,
    distance_along_lap_m:990,
    track_progress:0.99,
    lateral_offset_m:0,
    position:1,
  };
  const to={
    ...from,
    absolute_distance_m:1010,
    distance_along_lap_m:10,
    track_progress:0.01,
  };
  const halfway=interpolateRaceViewCar(from,to,{alpha:0.5,trackLengthM:1000});
  assert.equal(halfway.absolute_distance_m,1000);
  assert.equal(halfway.distance_along_lap_m,0);
  assert.equal(halfway.track_progress,0);
  assert.equal(wrapRaceViewDistanceM(1005,1000),5);
});

test("RW12A preserves signed grid distance and crosses start-finish continuously",()=>{
  const from={
    id:"C2",
    car_id:"C2",
    absolute_distance_m:-8,
    distance_along_lap_m:992,
    track_progress:0.992,
    lateral_offset_m:0,
  };
  const to={
    ...from,
    absolute_distance_m:8,
    distance_along_lap_m:8,
    track_progress:0.008,
  };
  const halfway=interpolateRaceViewCar(from,to,{alpha:0.5,trackLengthM:1000});
  assert.equal(halfway.absolute_distance_m,0);
  assert.equal(halfway.distance_along_lap_m,0);
  assert.equal(halfway.track_progress,0);
});

test("RW12A interpolates verge movement for a newly retired car without changing canonical metadata",()=>{
  const from={
    id:"C1",
    car_id:"C1",
    absolute_distance_m:450,
    distance_along_lap_m:450,
    track_progress:0.45,
    lateral_offset_m:0,
    retired:false,
    status:"RUNNING",
  };
  const to={
    ...from,
    absolute_distance_m:500,
    distance_along_lap_m:500,
    track_progress:0.5,
    lateral_offset_m:5.25,
    retired:true,
    status:"DNF",
    retirement_trackside:{status:"parked",visible:true},
  };
  const halfway=interpolateRaceViewCar(from,to,{alpha:0.5,trackLengthM:1000});
  assert.equal(halfway.absolute_distance_m,475);
  assert.equal(halfway.lateral_offset_m,2.625);
  assert.equal(halfway.retired,true);
  assert.equal(halfway.status,"DNF");
  assert.equal(halfway.retirement_trackside.status,"parked");
});

test("RW12A visual interpolation keeps target ordering and only smooths pose fields",()=>{
  const from=[
    {id:"C1",car_id:"C1",absolute_distance_m:100,track_progress:0.1,lateral_offset_m:0,position:2},
    {id:"C2",car_id:"C2",absolute_distance_m:120,track_progress:0.12,lateral_offset_m:0,position:1},
  ];
  const to=[
    {id:"C1",car_id:"C1",absolute_distance_m:140,track_progress:0.14,lateral_offset_m:1,position:1},
    {id:"C2",car_id:"C2",absolute_distance_m:130,track_progress:0.13,lateral_offset_m:-1,position:2},
  ];
  const frame=interpolateRaceViewCars(from,to,{alpha:0.5,trackLengthM:1000});
  assert.deepEqual(frame.map((row)=>row.car_id),["C1","C2"]);
  assert.deepEqual(frame.map((row)=>row.position),[1,2]);
  assert.deepEqual(frame.map((row)=>row.absolute_distance_m),[120,125]);
  assert.deepEqual(frame.map((row)=>row.lateral_offset_m),[0.5,-0.5]);
});


test("RW12B camera viewBox keeps FIT geometry and zooms around a supplied center",()=>{
  const base=[0,0,1000,500];
  assert.deepEqual(raceViewBoxCenter(base),{x:500,y:250});
  assert.deepEqual(raceViewCameraViewBox(base,{zoom:1,center:{x:500,y:250}}),base);
  assert.deepEqual(
    raceViewCameraViewBox(base,{zoom:2,center:{x:250,y:100}}),
    [0,-25,500,250]
  );
  assert.equal(clampRaceViewZoom(99),6);
  assert.equal(clampRaceViewZoom(0.1),1);
});

test("RW12B weather visuals are derived only from canonical track-state indices",()=>{
  const dry=raceViewWeatherVisuals({
    rain_intensity:0,
    track_wetness:0,
    visibility_index:100,
    spray_index:0,
    standing_water_index:0,
  });
  assert.equal(dry.rainOpacity,0);
  assert.equal(dry.fogOpacity,0);
  assert.equal(dry.wetTrackOpacity,0);
  assert.equal(dry.sprayOpacity,0);

  const wet=raceViewWeatherVisuals({
    rain_intensity:0.8,
    track_wetness:0.9,
    visibility_index:40,
    spray_index:0.75,
    standing_water_index:70,
  });
  assert.equal(wet.rain,0.8);
  assert.equal(wet.wet,0.9);
  assert.equal(wet.visibility,0.4);
  assert.equal(wet.spray,0.75);
  assert.ok(wet.rainOpacity>0.2);
  assert.ok(wet.fogOpacity>0.3);
  assert.ok(wet.wetTrackOpacity>0.45);
  assert.ok(wet.sprayOpacity>0.05);
  assert.ok(wet.sprayOpacity<=0.14);
});


test("RW12C pit boxes are distributed deterministically by team order",()=>{
  const teams=["T1","T2","T3"];
  assert.equal(raceViewPitBoxProgress(teams,"T1"),0.2);
  assert.equal(raceViewPitBoxProgress(teams,"T2"),0.52);
  assert.equal(raceViewPitBoxProgress(teams,"T3"),0.84);
  assert.equal(raceViewPitBoxProgress(["T1"],"T1"),0.52);
});

test("RW12C RW12A interpolation keeps pit-lane travel continuous through entry and exit",()=>{
  const track={trackLengthM:1000};
  const entry=interpolateRaceViewCar(
    {id:"C1",absolute_distance_m:900,lateral_offset_m:0,pit_lane_active:false,pit_lane_progress:null},
    {id:"C1",absolute_distance_m:910,lateral_offset_m:0,pit_lane_active:true,pit_lane_progress:0.2,pit_box_progress:0.52},
    {alpha:0.5,...track}
  );
  assert.equal(entry.pit_lane_active,true);
  assert.equal(entry.pit_lane_progress,0.1);

  const exit=interpolateRaceViewCar(
    {id:"C1",absolute_distance_m:1090,lateral_offset_m:0,pit_lane_active:true,pit_lane_progress:0.9,pit_box_progress:0.52},
    {id:"C1",absolute_distance_m:1100,lateral_offset_m:0,pit_lane_active:false,pit_lane_progress:null,pit_box_progress:0.52},
    {alpha:0.5,...track}
  );
  assert.equal(exit.pit_lane_active,true);
  assert.equal(exit.pit_lane_progress,0.95);

  const rejoined=interpolateRaceViewCar(
    {id:"C1",absolute_distance_m:1090,lateral_offset_m:0,pit_lane_active:true,pit_lane_progress:0.9,pit_box_progress:0.52},
    {id:"C1",absolute_distance_m:1100,lateral_offset_m:0,pit_lane_active:false,pit_lane_progress:null,pit_box_progress:0.52},
    {alpha:1,...track}
  );
  assert.equal(rejoined.pit_lane_active,false);
});


test("RW12D cleared DNF snaps to its team pit box instead of animating across the circuit",()=>{
  const from={
    id:"C1",
    car_id:"C1",
    absolute_distance_m:500,
    lateral_offset_m:5.25,
    retired:true,
    pit_lane_active:false,
    pit_lane_progress:null,
    pit_box_progress:0.62,
  };
  const to={
    ...from,
    pit_lane_active:true,
    pit_lane_progress:0.62,
    pit_box_progress:0.62,
    pit_box_parked:true,
    retirement_trackside:{status:"cleared",visible:false},
  };
  const frame=interpolateRaceViewCar(from,to,{alpha:0.05,trackLengthM:1000});
  assert.equal(frame.pit_lane_active,true);
  assert.equal(frame.pit_lane_progress,0.62);
  assert.equal(frame.pit_box_parked,true);
});


test("RW13D.1 pit entry and rejoin expose a continuous presentation mix",()=>{
  assert.equal(pitLaneMixForPhase({
    active:true,phase:"pit_entry",phaseElapsedMs:250,phaseTotalMs:1000,
  }),0.25);
  assert.equal(pitLaneMixForPhase({
    active:true,phase:"pit_lane",phaseElapsedMs:10,phaseTotalMs:1000,
  }),1);
  assert.equal(pitLaneMixForPhase({
    active:true,phase:"rejoin",phaseElapsedMs:250,phaseTotalMs:1000,
  }),0.75);
  assert.equal(pitLaneMixForPhase({
    active:false,completed:true,phase:"completed",phaseElapsedMs:0,phaseTotalMs:0,
  }),0);
  assert.equal(pitBoxMixForPhase({active:true,phase:"pit_box"}),1);
  assert.equal(pitBoxMixForPhase({active:true,phase:"pit_release"}),1);
  assert.equal(pitBoxMixForPhase({active:true,phase:"pit_lane"}),0);
});

test("RW13D.1 interpolation blends pit-lane and pit-box pose state instead of snapping",()=>{
  const frame=interpolateRaceViewCar(
    {
      id:"C1",absolute_distance_m:990,lateral_offset_m:0,
      pit_lane_active:true,pit_lane_progress:0.9,pit_lane_mix:1,pit_box_mix:0,
    },
    {
      id:"C1",absolute_distance_m:1000,lateral_offset_m:0,
      pit_lane_active:false,pit_lane_progress:1,pit_lane_mix:0,pit_box_mix:0,
    },
    {alpha:0.5,trackLengthM:1000}
  );
  assert.equal(frame.pit_lane_active,true);
  assert.equal(frame.pit_lane_progress,0.95);
  assert.equal(frame.pit_lane_mix,0.5);
  assert.equal(frame.pit_box_mix,0);
});
