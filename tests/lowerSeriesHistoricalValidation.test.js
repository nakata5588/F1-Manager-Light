import test from "node:test";
import assert from "node:assert/strict";
import {lowerSeriesHistoricalVerticalSlice,validateLowerSeriesHistoricalResults} from "../src/domain/lowerSeriesHistoricalValidation.js";

const seriesById={
  british_f3:{competition_model:"TEAM_BASED"},
  gp2:{competition_model:"TEAM_BASED"},
  fia_f2_2009:{competition_model:"CENTRAL_OPERATION"},
};

test("LS9D preserves unresolved identities as warnings instead of inventing ids",()=>{
  const audit=validateLowerSeriesHistoricalResults([
    {lower_result_id:"bf3:1983:1:senna",year:1983,series_id:"british_f3",round:1,driver_name:"Ayrton Senna",source_url:"https://example.test/source"},
  ],{seriesIds:["british_f3"],seriesById});
  assert.equal(audit.valid,true);
  assert.equal(audit.by_code.unresolved_driver_identity,1);
});

test("LS9D rejects fake teams in central-operation FIA F2 history",()=>{
  const audit=validateLowerSeriesHistoricalResults([
    {lower_result_id:"f2:2009:1:x",year:2009,series_id:"fia_f2_2009",driver_id:"d_x",lower_team_id:"fake_team",source:"archive"},
  ],{seriesIds:["fia_f2_2009"],driverIds:["d_x"],teamIds:["fake_team"],seriesById});
  assert.equal(audit.valid,false);
  assert.equal(audit.by_code.central_operation_has_team,1);
});

test("LS9D reports duplicate ids and missing provenance",()=>{
  const rows=[
    {lower_result_id:"gp2:2007:1:a",year:2007,series_id:"gp2",driver_id:"d_a"},
    {lower_result_id:"gp2:2007:1:a",year:2007,series_id:"gp2",driver_id:"d_b"},
  ];
  const audit=validateLowerSeriesHistoricalResults(rows,{seriesIds:["gp2"],driverIds:["d_a","d_b"],seriesById});
  assert.equal(audit.valid,false);
  assert.equal(audit.by_code.duplicate_result_id,1);
  assert.equal(audit.by_code.missing_source,2);
});

test("LS9D vertical slices quantify factual coverage without requiring completeness",()=>{
  const rows=[
    {year:1983,series_id:"british_f3",round:1,driver_id:"d_senna",source:"Racing Years"},
    {year:1983,series_id:"british_f3",round:1,driver_name:"Unresolved",source:"Racing Years"},
    {year:2007,series_id:"gp2",round:1,driver_id:"d_hamilton",source:"archive"},
  ];
  const slice=lowerSeriesHistoricalVerticalSlice(rows,{year:1983,seriesId:"british_f3"});
  assert.equal(slice.results,2);
  assert.equal(slice.events,1);
  assert.equal(slice.resolved_drivers,1);
  assert.equal(slice.unresolved_driver_rows,1);
  assert.equal(slice.source_coverage,1);
});
