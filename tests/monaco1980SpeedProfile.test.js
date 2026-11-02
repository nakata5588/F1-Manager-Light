import test from "node:test";
import assert from "node:assert/strict";
import {provisionalMonacoSpeedProfile,MONACO_1976_1985_TURNS} from "../src/data/tracks/tr_0056_monaco.speedProfile.js";
import {buildTrackModel} from "../src/race2/track/TrackModel.js";

test("Monaco 1980 uses provisional era-scoped physical severity rather than flat neutral",()=>{
  const gs={activeYear:1980,coreTracks:[{track_id:"tr_0056",lap_length_km:3.312}],
    trackLayoutByYear:[{track_id:"tr_0056",year_from:1976,year_to:1985,lap_length_km:3.312,laps:76}]};
  const model=buildTrackModel(gs,{gp:{track_id:"tr_0056",year:1980,laps:76}});
  assert.equal(model.layoutId,"tr_0056_1976_1985");
  assert.equal(model.lengthM,3312);
  assert.equal(model.speedProfile.source,"historical_named_turn_reference_approximate");
  assert.equal(model.speedProfile.provisional,true);
  assert.equal(model.speedProfile.referenceTurns,MONACO_1976_1985_TURNS.length);
  assert.ok(model.speedProfile.samples.length>=120);
  const severity=model.speedProfile.samples.map(s=>s.severity);
  assert.ok(Math.max(...severity)>0.85);
  assert.ok(Math.min(...severity)<0.1);
  assert.deepEqual(model.speedProfile,buildTrackModel(gs,{gp:{track_id:"tr_0056",year:1980,laps:76}}).speedProfile);
});

test("Monaco provisional physics never leaks across historical layouts or other tracks",()=>{
  for(const year of [1950,1973,1986,1990,2000,2026]){
    assert.equal(provisionalMonacoSpeedProfile("tr_0056",year,3312,"tr_0056_1976_1985"),null);
  }
  assert.equal(provisionalMonacoSpeedProfile("tr_0056",1980,3312,"tr_0056_1986_1996"),null);
  assert.equal(provisionalMonacoSpeedProfile("tr_0056",1980,3337,"tr_0056_2003_modern"),null);
  assert.equal(provisionalMonacoSpeedProfile("tr_0028",1980,3312,"tr_0056_1976_1985"),null);
  assert.equal(provisionalMonacoSpeedProfile("tr_0056",1980,4309,"tr_0056_1976_1985"),null);
});
