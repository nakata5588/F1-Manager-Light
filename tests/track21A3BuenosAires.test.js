import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrackLayout, pointAtTrackProgress, trackIntelligenceProfile } from "../src/domain/trackLayout.js";

test("Track 2.1A.4 resolves Buenos Aires 1980 as verified Circuit No. 15",()=>{
  const resolved=resolveTrackLayout({trackId:"tr_0018",year:1980});
  assert.equal(resolved.resolution,"exact");
  assert.equal(resolved.layout.label,"Buenos Aires — Circuit No. 15");
  assert.equal(resolved.layout.historical_status,"verified");
  assert.equal(resolved.layout.geometry_status,"historical_verified");
  assert.equal(resolved.layout.lap_length_km,5.968);
  assert.equal(resolved.layout.asset,"/tracks/historical/buenos-aires-no15-1980.webp");
  assert.equal(resolved.geometry.quality,"historical_verified");
});

test("Track 2.1A.4 Buenos Aires S/F is on upper straight and race direction is right",()=>{
  const {layout,geometry}=resolveTrackLayout({trackId:"tr_0018",year:1980});
  const profile=trackIntelligenceProfile(layout);
  const start=pointAtTrackProgress(geometry,profile.start_finish_progress);
  const after=pointAtTrackProgress(geometry,0.012);
  assert.ok(start.y<350,"S/F must remain on the upper straight");
  assert.ok(Math.abs(after.y-start.y)<8,"the opening segment must remain horizontal");
  assert.ok(after.x>start.x,"cars must travel from S/F to the right");
  assert.equal(layout.start_finish_direction,"right");
});

test("Track 2.1A.4 keeps environment artwork non-authoritative",()=>{
  const {layout,geometry}=resolveTrackLayout({trackId:"tr_0018",year:1980});
  assert.ok(layout.asset,"presentation artwork must be independently registered");
  assert.equal(geometry.derivation,"user_reference_trace_2026_09_26");
  assert.ok(Array.isArray(geometry.points));
  assert.ok(geometry.points.length>=250);
  assert.ok(Array.isArray(geometry.pit_lane_points));
  assert.ok(geometry.pit_lane_points.length>=60);
  assert.deepEqual(geometry.view_box,[0,0,1649,954]);
  assert.deepEqual(layout.environment_view_box,[0,0,1649,954]);
  assert.deepEqual(layout.sector_boundaries,[0.3246,0.6940]);
  assert.equal(layout.pit_entry_progress,0.9499);
  assert.equal(layout.pit_exit_progress,0.0789);
  assert.deepEqual(layout.sector_colors,["#ef4444","#22d3ee","#facc15"]);
  assert.equal(layout.pit_lane_color,"#2563eb");
  assert.equal(Object.hasOwn(geometry,"asset"),false,"functional geometry must not consume the presentation asset as physics data");
});
