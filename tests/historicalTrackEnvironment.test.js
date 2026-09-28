import test from "node:test";
import assert from "node:assert/strict";
import { HISTORICAL_TRACK_ENVIRONMENTS } from "../src/data/historicalTrackEnvironment.js";

test("Buenos Aires historical environment is explicitly presentation-only",()=>{
  const environment=HISTORICAL_TRACK_ENVIRONMENTS.tr_0018_provisional;
  assert.equal(environment.presentation_only,true);
  assert.equal(environment.asset,null);
  assert.equal(environment.reference_year,1980);
  assert.equal(environment.layout,"Circuit No. 15");
  assert.equal(environment.start_finish_location,"upper_straight");
  assert.equal(environment.start_finish_direction,"right");
  assert.deepEqual(environment.view_box,[0,0,1649,954]);
  assert.deepEqual(environment.sector_colors,["#ef4444","#facc15","#22d3ee"]);
  assert.equal(environment.pit_lane_color,"#2563eb");
  assert.equal(environment.contains_track_surface,false);
  assert.equal(environment.contains_track_intel,false);
  assert.equal(environment.native_width,1649);
  assert.equal(environment.native_height,954);
  assert.deepEqual(environment.calibration_transform,{x:0,y:0,scale_x:1,scale_y:1,rotation_deg:0,origin_x:0,origin_y:0});
  assert.equal(environment.runtime_mode,"f1track_procedural");
  assert.equal(environment.package_id,"tr_0018_1974_1981");
  assert.equal(environment.visual_style,"f1track_procedural_environment");
  assert.equal(environment.procedural_environment.theme,"parkland");
  assert.equal(environment.procedural_environment.render_landmarks,false);
  assert.equal(environment.procedural_environment.tree_count,72);
  assert.equal(environment.procedural_environment.pit_complex,true);
});
