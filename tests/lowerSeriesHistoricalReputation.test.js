import assert from "node:assert/strict";
import test from "node:test";

import {
  historicalProspectReputationEvidence,
  openingProspectReputation,
} from "../src/domain/lowerSeriesHistoricalReputation.js";

const result=(year,position,{driver_id="D1",series_id="GP2",status="finished",points=0,pole=false}={})=>({
  year,driver_id,series_id,round:1,position,status,points,pole,
});

test("LS9C opening reputation uses only factual seasons before New Game year",()=>{
  const gs={
    dbLowerSeriesHistoricalResults:[
      result(2005,8,{points:1}),
      result(2006,1,{points:10,pole:true}),
      result(2007,1,{points:10,pole:true}),
      result(2008,1,{points:10,pole:true}),
    ],
  };
  const evidence=historicalProspectReputationEvidence(gs,"D1",2007);
  assert.ok(evidence);
  assert.equal(evidence.evidence_results,2);
  assert.equal(evidence.latest_evidence_year,2006);
  assert.equal(evidence.temporal_cutoff_year,2007);
  assert.equal(evidence.source,"factual_pre_start_lower_series_results");
  assert.ok(evidence.evidence_seasons.every((row)=>row.year<2007));
});

test("LS9C same-year and future rows cannot leak into opening reputation",()=>{
  const pastOnly={dbLowerSeriesHistoricalResults:[result(2006,9)]};
  const withFuture={dbLowerSeriesHistoricalResults:[
    result(2006,9),
    result(2007,1,{points:10,pole:true}),
    result(2008,1,{points:10,pole:true}),
  ]};
  const a=historicalProspectReputationEvidence(pastOnly,"D1",2007);
  const b=historicalProspectReputationEvidence(withFuture,"D1",2007);
  assert.equal(a.prospect_reputation,b.prospect_reputation);
  assert.deepEqual(a.evidence_seasons,b.evidence_seasons);
});

test("LS9C falls back to category baseline when no factual pre-start history exists",()=>{
  const gs={dbLowerSeriesHistoricalResults:[result(2007,1),result(2008,1)]};
  const opening=openingProspectReputation(gs,{driver_id:"D1",series_level:2},2007,28);
  assert.equal(opening.prospect_reputation,28);
  assert.equal(opening.source,"series_level_baseline");
  assert.equal(opening.used_fallback,true);
  assert.equal(opening.evidence_results,0);
});

test("LS9C ignores unresolved historical identities rather than guessing driver ids",()=>{
  const gs={dbLowerSeriesHistoricalResults:[
    {year:2006,driver_name:"Unresolved Driver",series_id:"F3",position:1,status:"finished"},
  ]};
  assert.equal(historicalProspectReputationEvidence(gs,"D1",2007),null);
});
