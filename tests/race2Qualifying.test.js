import test from "node:test";
import assert from "node:assert/strict";

import {
  QUALIFYING_MODEL_VERSION,
  simulateCanonicalQualifying,
} from "../src/race2/core/QualifyingSimulation.js";

function input(overrides={}){
  return {
    modelVersion:QUALIFYING_MODEL_VERSION,
    seed:"rw8.13-detached",
    sessionKey:"qualifying_1",
    entropyKey:"1980-monaco-qualifying_1",
    referenceLapMs:58654,
    weather:{
      wet:false,
      performanceMultiplier:1,
      state:"SUNNY",
      trackWetness:0,
      trackGrip:92,
      airTempC:24,
      trackTempC:36,
    },
    entrants:[
      {driverId:"D1",teamId:"T1",basePerformance:86.4},
      {driverId:"D2",teamId:"T1",basePerformance:84.2},
      {driverId:"D3",teamId:"T2",basePerformance:81.7},
    ],
    ...overrides,
  };
}

test("RW8.13 canonical Qualifying is deterministic, detached and non-mutating",()=>{
  const snapshot=input();
  const before=structuredClone(snapshot);
  const a=simulateCanonicalQualifying(snapshot);
  const b=simulateCanonicalQualifying(snapshot);

  assert.deepEqual(a,b);
  assert.deepEqual(snapshot,before);
  assert.equal(a.model,"rw8.13");
  assert.equal(a.modelVersion,1);
  assert.equal(a.source,"rw8.13_qualifying_core");
  assert.equal(a.results.length,3);
  assert.ok(a.results.every((row)=>Number.isFinite(row.lap_time_ms)&&row.lap_time_ms>=25000));
  assert.deepEqual(
    a.results.map((row)=>row.position),
    [1,2,3]
  );
  assert.deepEqual(
    a.results.map((row)=>row.lap_time_ms),
    a.results.map((row)=>row.lap_time_ms).slice().sort((x,y)=>x-y)
  );
});

test("RW8.13 Qualifying seed and session entropy are scoped",()=>{
  const base=simulateCanonicalQualifying(input());
  const otherSeed=simulateCanonicalQualifying(input({seed:"rw8.13-other-seed"}));
  const otherSession=simulateCanonicalQualifying(input({
    sessionKey:"qualifying_2",
    entropyKey:"1980-monaco-qualifying_2",
  }));

  assert.notDeepEqual(
    base.results.map((row)=>row.lap_time_ms),
    otherSeed.results.map((row)=>row.lap_time_ms)
  );
  assert.notDeepEqual(
    base.results.map((row)=>row.lap_time_ms),
    otherSession.results.map((row)=>row.lap_time_ms)
  );
});

test("RW8.13 Qualifying applies the detached canonical weather timing factor",()=>{
  const dry=simulateCanonicalQualifying(input());
  const wet=simulateCanonicalQualifying(input({
    weather:{
      wet:true,
      performanceMultiplier:0.90,
      state:"HEAVY_RAIN",
      trackWetness:0.55,
      trackGrip:68,
      airTempC:19,
      trackTempC:21,
    },
  }));

  const dryByDriver=new Map(dry.results.map((row)=>[row.driver_id,row]));
  for(const row of wet.results){
    assert.equal(row.wet_session,true);
    assert.equal(row.weather_state,"HEAVY_RAIN");
    assert.ok(row.lap_time_ms>dryByDriver.get(row.driver_id).lap_time_ms);
  }
});

test("RW8.13 Qualifying rejects unknown model versions",()=>{
  assert.throws(
    ()=>simulateCanonicalQualifying(input({modelVersion:999})),
    /QualifyingInput\.modelVersion must be 1/
  );
});
