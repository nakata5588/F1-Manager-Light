import test from "node:test";
import assert from "node:assert/strict";
import {lowerSeriesHistoryForCareer,lowerSeriesHistorySummary} from "../src/domain/lowerSeriesHistoryView.js";

const historical=[
  {lower_result_id:"past",year:2006,series_id:"gp2",round:1,driver_id:"D1",position:2},
  {lower_result_id:"start",year:2007,series_id:"gp2",round:1,driver_id:"D1",position:1},
  {lower_result_id:"future",year:2008,series_id:"gp2",round:1,driver_id:"D1",position:1},
];

const world={
  season_year:2008,
  history:[{
    season_year:2007,
    results:[{event_id:"save-2007",series_id:"gp2",round:1,classification:[{driver_id:"D1",position:4}]}],
  }],
  results:[{event_id:"save-2008",series_id:"gp2",round:1,classification:[{driver_id:"D1",position:3}]}],
};

test("LS9E history view never leaks same-year or future factual results into a career",()=>{
  const view=lowerSeriesHistoryForCareer({historicalResults:historical,lowerSeriesWorld:world,careerStartYear:2007,driverId:"D1"});
  assert.deepEqual(view.map((row)=>row.lower_result_id||row.event_id),["past","save-2007","save-2008"]);
  assert.equal(view[0].history_origin,"factual_pre_save");
  assert.equal(view[0].immutable,true);
  assert.ok(view.slice(1).every((row)=>row.history_origin==="save_world"&&row.immutable===false));
});

test("LS9E history view filters both factual and Save-World history by driver and series",()=>{
  const mixed=[...historical,{lower_result_id:"other",year:2006,series_id:"f3",driver_id:"D2",position:1}];
  const view=lowerSeriesHistoryForCareer({historicalResults:mixed,lowerSeriesWorld:world,careerStartYear:2007,driverId:"D1",seriesId:"gp2"});
  assert.equal(view.length,3);
  assert.ok(view.every((row)=>row.series_id==="gp2"));
});

test("LS9E history summary keeps factual database evidence separate from simulated Save history",()=>{
  assert.deepEqual(lowerSeriesHistorySummary({historicalResults:historical,lowerSeriesWorld:world,careerStartYear:2007}),{
    rows:3,
    factual_pre_save:1,
    save_world:2,
  });
});
