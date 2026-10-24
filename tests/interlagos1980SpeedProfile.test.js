import test from "node:test";
import assert from "node:assert/strict";
import { provisionalInterlagosSpeedProfile,INTERLAGOS_1979_1980_TURNS } from "../src/data/tracks/tr_0028_interlagos.speedProfile.js";

test("Interlagos 1979–1980 historical corner envelope stays era-scoped",()=>{
  for(const year of [1979,1980]){
    const profile=provisionalInterlagosSpeedProfile("tr_0028",year,7873,"tr_0028_long");
    assert.ok(profile);
    assert.equal(profile.provisional,true);
    assert.equal(profile.brakingModel,"distance_sensitive");
    assert.equal(profile.referenceTurns,INTERLAGOS_1979_1980_TURNS.length);
    assert.ok(profile.samples.length>=120);
    assert.ok(profile.samples.some(s=>s.severity>0.8));
    assert.ok(profile.samples.some(s=>s.severity<0.01));
    assert.ok(profile.samples.every(s=>s.severity>=0&&s.severity<=1));
    assert.ok(profile.samples.every((s,i)=>i===0||s.distanceM>profile.samples[i-1].distanceM));
    assert.deepEqual(profile,provisionalInterlagosSpeedProfile("tr_0028",year,7873,"tr_0028_long"));
  }
  for(const year of [1973,1978,1981,1990,2000,2024]){
    assert.equal(provisionalInterlagosSpeedProfile("tr_0028",year,7873,"tr_0028_long"),null);
  }
  assert.equal(provisionalInterlagosSpeedProfile("tr_0028",1980,4309,"tr_0028_short"),null);
  assert.equal(provisionalInterlagosSpeedProfile("tr_0018",1980,7873,"tr_0028_long"),null);
});
