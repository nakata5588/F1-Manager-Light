import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrackLayout, pointAtTrackProgress, trackIntelligenceProfile } from "../src/domain/trackLayout.js";

test("Track 2.1A.3 resolves Buenos Aires 1980 as verified Circuit No. 15",()=>{
  const resolved=resolveTrackLayout({trackId:"tr_0018",year:1980});
  assert.equal(resolved.resolution,"exact");
  assert.equal(resolved.layout.label,"Buenos Aires — Circuit No. 15");
  assert.equal(resolved.layout.historical_status,"verified");
  assert.equal(resolved.layout.geometry_status,"historical_verified");
  assert.equal(resolved.layout.lap_length_km,5.968);
  assert.equal(resolved.layout.asset,"/tracks/historical/buenos-aires-no15-1980.svg");
  assert.equal(resolved.geometry.quality,"historical_verified");
});

test("Track 2.1A.3 Buenos Aires S/F is on upper straight and race direction is right",()=>{
  const {layout,geometry}=resolveTrackLayout({trackId:"tr_0018",year:1980});
  const profile=trackIntelligenceProfile(layout);
  const start=pointAtTrackProgress(geometry,profile.start_finish_progress);
  const after=pointAtTrackProgress(geometry,0.012);
  assert.ok(start.y<350,"S/F must remain on the upper straight");
  assert.ok(Math.abs(after.y-start.y)<8,"the opening segment must remain horizontal");
  assert.ok(after.x>start.x,"cars must travel from S/F to the right");
  assert.equal(layout.start_finish_direction,"right");
});

test("Track 2.1A.3 keeps historical environment separate from functional geometry",()=>{
  const {layout,geometry}=resolveTrackLayout({trackId:"tr_0018",year:1980});
  assert.notEqual(layout.asset,geometry.source_environment,"asset metadata and geometry source may reference the same file but are independent fields");
  assert.equal(geometry.derivation,"hand_authored_historical_reference");
  assert.ok(Array.isArray(geometry.points));
  assert.ok(geometry.points.length>=80);
});
