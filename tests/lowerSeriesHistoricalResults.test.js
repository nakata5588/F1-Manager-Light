import test from "node:test";
import assert from "node:assert/strict";
import {
  lowerSeriesHistoricalResultCoverage,
  lowerSeriesHistoricalResultsBeforeYear,
  lowerSeriesHistoricalResultsForYear,
  normalizeLowerSeriesHistoricalResult,
} from "../src/domain/lowerSeriesHistoricalResults.js";

const facts=[
  {lower_result_id:"r1",year:1982,series_id:"F2",round:1,driver_id:"D1",position:2,source_url:"https://example.test/1982"},
  {lower_result_id:"r2",year:1983,series_id:"F3",round:1,driver_id:"D1",position:1,source_url:"https://example.test/1983"},
  {lower_result_id:"r3",year:1984,series_id:"F3",round:1,driver_id:"D1",position:3,source_url:"https://example.test/1984"},
];

test("LS9B normalizes factual historical Lower Series result rows",()=>{
  const row=normalizeLowerSeriesHistoricalResult({
    result_id:"x",season:"2007",seriesId:"GP2",race_round:"2",person_id:"D7",
    finish_position:"4",grid_position:"8",points:"5",pole:"false",fastest_lap:"true",
  });
  assert.equal(row.lower_result_id,"x");
  assert.equal(row.year,2007);
  assert.equal(row.series_id,"GP2");
  assert.equal(row.round,2);
  assert.equal(row.driver_id,"D7");
  assert.equal(row.position,4);
  assert.equal(row.grid,8);
  assert.equal(row.points,5);
  assert.equal(row.pole,false);
  assert.equal(row.fastest_lap,true);
});

test("LS9B filters exact historical seasons without touching Save World results",()=>{
  const selected=lowerSeriesHistoricalResultsForYear(facts,1983);
  assert.deepEqual(selected.map((row)=>row.lower_result_id),["r2"]);
});

test("LS9B temporal firewall exposes only pre-start evidence",()=>{
  const prior=lowerSeriesHistoricalResultsBeforeYear(facts,1983,{driverIds:["D1"]});
  assert.deepEqual(prior.map((row)=>row.lower_result_id),["r1"]);
  assert.equal(prior.some((row)=>row.year>=1983),false);
});

test("LS9B coverage preserves unresolved identities instead of inventing IDs",()=>{
  const coverage=lowerSeriesHistoricalResultCoverage([
    ...facts,
    {year:1983,driver_name:"Unresolved Driver",series_id:"F3"},
    {year:1983,driver_id:"D2",driver_name:"Known",source:"Racing Years"},
  ]);
  assert.equal(coverage.results,5);
  assert.equal(coverage.unresolved_drivers,1);
  assert.equal(coverage.unresolved_sources,1);
});
