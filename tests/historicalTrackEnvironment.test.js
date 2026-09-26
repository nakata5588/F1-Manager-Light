import test from "node:test";
import assert from "node:assert/strict";
import { HISTORICAL_TRACK_ENVIRONMENTS } from "../src/data/historicalTrackEnvironment.js";

test("Buenos Aires historical environment is explicitly presentation-only",()=>{
  const environment=HISTORICAL_TRACK_ENVIRONMENTS.tr_0018_provisional;
  assert.equal(environment.presentation_only,true);
  assert.equal(environment.reference_year,1980);
  assert.equal(environment.layout,"Circuit No. 15");
  assert.equal(environment.start_finish_location,"upper_straight");
  assert.equal(environment.start_finish_direction,"right");
  assert.deepEqual(environment.view_box,[0,0,1642,958]);
});
