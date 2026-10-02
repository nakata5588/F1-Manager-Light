import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClosedRacingLine,
  racingLineGeometry,
  racingLinePoseAtProgress,
} from "../src/domain/raceSplineV3.js";
import {
  createContinuousRaceSegment,
  retargetContinuousRaceSegment,
  sampleContinuousRaceSegment,
  unwrapRaceWorldTarget,
} from "../src/domain/raceMotionV3.js";

test("Track 3.0A racing line is closed, dense and arc-length addressable",()=>{
  const line=buildClosedRacingLine([[0,0],[100,0],[100,100],[0,100]],{samplesPerSegment:8});
  assert.equal(line.source_count,4);
  assert.equal(line.points.length,32);
  assert.ok(line.total_length>350);
  const a=racingLinePoseAtProgress(line,0);
  const b=racingLinePoseAtProgress(line,1);
  assert.ok(Math.abs(a.x-b.x)<1e-6);
  assert.ok(Math.abs(a.y-b.y)<1e-6);
  assert.ok(Number.isFinite(a.heading));
});

test("RW19 presentation spline keeps the closed path continuous through source vertices",()=>{
  const source={
    view_box:[0,0,100,100],
    points:[[0,0],[100,0],[100,100],[0,100]],
    pit_lane_points:[[10,10],[50,10],[90,10]],
  };
  const line=buildClosedRacingLine(source.points,{samplesPerSegment:8,parameterization:"centripetal"});
  const geometry=racingLineGeometry(source,line);

  assert.equal(geometry.racing_line_v3,true);
  assert.equal(line.parameterization,"centripetal");
  assert.equal(geometry.points.length,32);
  assert.deepEqual(geometry.pit_lane_points,source.pit_lane_points);

  const before=racingLinePoseAtProgress(line,.249);
  const after=racingLinePoseAtProgress(line,.251);
  const delta=Math.abs((((after.heading-before.heading)+540)%360)-180);
  assert.ok(delta<15,`heading should turn smoothly across a source vertex, got ${delta}`);

  const end=racingLinePoseAtProgress(line,.999);
  const start=racingLinePoseAtProgress(line,.001);
  const seamDelta=Math.abs((((start.heading-end.heading)+540)%360)-180);
  assert.ok(seamDelta<15,`start/finish heading should stay continuous, got ${seamDelta}`);
});

test("Track 3.0A world targets unwrap forward across start finish",()=>{
  assert.ok(Math.abs(unwrapRaceWorldTarget(.995,.333)-1.333)<1e-9);
  assert.ok(Math.abs(unwrapRaceWorldTarget(1.333,.667)-1.667)<1e-9);
  assert.ok(Math.abs(unwrapRaceWorldTarget(1.667,1)-2)<1e-9);
  assert.ok(Math.abs(unwrapRaceWorldTarget(2,1.333)-2.333)<1e-9);
});

test("Track 3.0A retargeting preserves position and velocity continuity",()=>{
  const first=createContinuousRaceSegment({
    position:1,
    targetPosition:1.333,
    durationMs:3000,
    clockMs:0,
  });
  const before=sampleContinuousRaceSegment(first,1500);
  const second=retargetContinuousRaceSegment(first,{
    targetPosition:1.667,
    durationMs:3000,
    clockMs:1500,
  });
  const after=sampleContinuousRaceSegment(second,1500);
  assert.ok(Math.abs(before.position-after.position)<1e-10);
  assert.ok(Math.abs(before.velocity-after.velocity)<1e-10);
});

test("Track 3.0A motion extrapolates briefly instead of freezing between snapshots",()=>{
  const segment=createContinuousRaceSegment({
    position:0,
    targetPosition:.333,
    durationMs:3000,
    clockMs:0,
  });
  const atTarget=sampleContinuousRaceSegment(segment,3000);
  const late=sampleContinuousRaceSegment(segment,3300);
  assert.ok(late.position>atTarget.position);
  assert.ok(late.velocity>0);
  assert.equal(late.extrapolated,true);
});

test("Track 3.0A stopped motion never drifts",()=>{
  const segment=createContinuousRaceSegment({
    position:.42,
    targetPosition:.9,
    velocity:.001,
    durationMs:2000,
    clockMs:0,
    stopped:true,
  });
  const late=sampleContinuousRaceSegment(segment,5000);
  assert.equal(late.position,.42);
  assert.equal(late.velocity,0);
});
