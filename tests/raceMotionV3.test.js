import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClosedRacingLine,
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
