import test from "node:test";
import assert from "node:assert/strict";
import { HISTORICAL_TRACK_ENVIRONMENTS } from "../src/data/historicalTrackEnvironment.js";

test("Buenos Aires historical environment is explicitly presentation-only",()=>{
  const environment=HISTORICAL_TRACK_ENVIRONMENTS.tr_0018_provisional;
  assert.equal(environment.presentation_only,true);
  assert.equal(environment.asset,"/tracks/historical/buenos-aires-no15-1980.webp");
  assert.equal(environment.reference_year,1980);
  assert.equal(environment.layout,"Circuit No. 15");
  assert.equal(environment.start_finish_location,"upper_straight");
  assert.equal(environment.start_finish_direction,"right");
  assert.deepEqual(environment.view_box,[0,0,1649,954]);
  assert.deepEqual(environment.sector_colors,["#ef4444","#22d3ee","#facc15"]);
  assert.equal(environment.pit_lane_color,"#2563eb");
  assert.equal(environment.contains_track_surface,true);
  assert.equal(environment.contains_track_intel,true);
  assert.equal(environment.native_width,1649);
  assert.equal(environment.native_height,954);
  assert.deepEqual(environment.calibration_transform,{x:0,y:0,scale_x:1,scale_y:1,rotation_deg:0,origin_x:824.5,origin_y:477});
  assert.equal(environment.visual_style,"single_raster_environment");
});
