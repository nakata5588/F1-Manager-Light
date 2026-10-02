import test from "node:test";
import assert from "node:assert/strict";

import {
  activeSeasonOfficialRaceCount,
  currentWorldCadence,
  stampWorldCadence,
} from "../src/domain/worldCadence.js";

function state(overrides={}){
  return {
    activeYear:1980,
    currentDateISO:"1980-01-01",
    currentRound:0,
    calendar:[
      {round:1,gp_id:"ARG",race_date:"1980-01-13"},
      {round:2,gp_id:"BRA",race_date:"1980-01-27"},
    ],
    results:[],
    manager:{development:{processed_result_keys:[]}},
    ...overrides,
  };
}

test("world cadence distinguishes month boundary, pre-GP and post-GP events",()=>{
  const month=currentWorldCadence(state());
  assert.equal(month.firstOfMonth,true);
  assert.equal(month.preGrandPrix,false);
  assert.equal(month.postGrandPrix,false);

  const pre=currentWorldCadence(state({currentDateISO:"1980-01-12"}));
  assert.equal(pre.preGrandPrix,true);

  const result={year:1980,round:1,key:"1980:1"};
  const post=currentWorldCadence(state({
    currentDateISO:"1980-01-14",
    results:[result],
    _worldCadence:{official_race_count:0},
  }));
  assert.equal(post.postGrandPrix,true);
  assert.equal(activeSeasonOfficialRaceCount({...state(),results:[result]}),1);
});

test("world cadence stamp makes the same official result a one-shot event",()=>{
  const gs=state({
    currentDateISO:"1980-01-14",
    results:[{year:1980,round:1,key:"1980:1"}],
    _worldCadence:{official_race_count:0},
  });
  const due=currentWorldCadence(gs);
  assert.equal(due.postGrandPrix,true);

  const stamped=stampWorldCadence(gs,due);
  const repeated=currentWorldCadence(stamped);
  assert.equal(repeated.postGrandPrix,false);
  assert.equal(stamped._worldCadence.official_race_count,1);
});

test("legacy saves perform one catch-up GP review and then stamp it",()=>{
  const gs=state({
    currentDateISO:"1980-06-01",
    results:[
      {year:1980,round:1,key:"1980:1"},
      {year:1980,round:2,key:"1980:2"},
    ],
  });
  const due=currentWorldCadence(gs);
  assert.equal(due.postGrandPrix,true);
  assert.equal(currentWorldCadence(stampWorldCadence(gs,due)).postGrandPrix,false);
});
