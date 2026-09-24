import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRaceReputation,
  driverReputationHistory,
  raceReputationChange,
} from "../src/domain/driverReputation.js";

function evaluation(overrides={}){
  return {
    driver_id:"D1",
    team_id:"T1",
    year:1980,
    round:5,
    gp_id:"test",
    gp_name:"Test GP",
    dateISO:"1980-05-18",
    expected_finish:10,
    expectation_delta:4,
    teammate_driver_id:"D2",
    teammate_race_delta:2,
    teammate_qualifying_delta:1,
    finish_position:6,
    retired:false,
    retirement_responsibility:null,
    ...overrides,
  };
}

test("reputation rises gradually for genuine overperformance and stays bounded",()=>{
  const change=raceReputationChange({
    reputation:55,
    evaluation:evaluation({finish_position:1,expectation_delta:9,teammate_race_delta:5}),
    recentEntries:[],
  });
  assert.ok(change.delta>0);
  assert.ok(change.delta<=1.5);
  assert.equal(change.after,Math.round((55+change.delta)*10)/10);
  assert.ok(change.reasons.some((reason)=>/Race win/i.test(reason)));
});

test("mechanical DNF is reputation-neutral while driver-error DNF can reduce it",()=>{
  const mechanical=raceReputationChange({
    reputation:70,
    evaluation:evaluation({
      retired:true,
      retirement_responsibility:"mechanical",
      finish_position:18,
      expectation_delta:null,
      teammate_race_delta:null,
    }),
  });
  const mistake=raceReputationChange({
    reputation:70,
    evaluation:evaluation({
      retired:true,
      retirement_responsibility:"driver_error",
      finish_position:18,
      expectation_delta:null,
      teammate_race_delta:null,
    }),
  });
  assert.equal(mechanical.delta,0);
  assert.ok(mistake.delta<0);
});

test("sustained expectation overperformance matters more than a single race",()=>{
  const current=evaluation({expectation_delta:3,finish_position:7});
  const recent=[
    evaluation({round:4,dateISO:"1980-05-01",expectation_delta:3,finish_position:7}),
    evaluation({round:3,dateISO:"1980-04-01",expectation_delta:2.5,finish_position:7.5}),
  ];
  const streak=raceReputationChange({reputation:60,evaluation:current,recentEntries:recent});
  const single=raceReputationChange({reputation:60,evaluation:current,recentEntries:[]});
  assert.ok(streak.delta>single.delta);
  assert.ok(streak.reasons.some((reason)=>/Three-race run above expectations/i.test(reason)));
});

test("applyRaceReputation updates Save World reputation without changing Overall",()=>{
  const gs={
    activeYear:1980,
    currentDateISO:"1980-05-18",
    driverRatings:[
      {driver_id:"D1",current_ability:82,reputation:60,pace:84},
      {driver_id:"D2",current_ability:80,reputation:58,pace:82},
    ],
    driverPerformanceLog:{
      D1:[
        evaluation({round:3,dateISO:"1980-04-01",expectation_delta:3,finish_position:7}),
        evaluation({round:4,dateISO:"1980-05-01",expectation_delta:2,finish_position:8}),
        evaluation({round:5,dateISO:"1980-05-18",expectation_delta:4,finish_position:6}),
      ],
    },
  };
  const resultEntry={
    year:1980,
    round:5,
    gp_id:"test",
    name:"Test GP",
    dateISO:"1980-05-18",
    classification:[
      {driver_id:"D1",team_id:"T1",position:6,driver_performance:evaluation()},
    ],
  };

  const pass=applyRaceReputation(gs,resultEntry);
  const rating=pass.gameState.driverRatings.find((row)=>row.driver_id==="D1");
  assert.equal(rating.current_ability,82);
  assert.ok(rating.reputation>60);
  assert.ok(pass.resultEntry.classification[0].driver_reputation.delta>0);

  const history=driverReputationHistory(pass.gameState,"D1");
  assert.equal(history.length,1);
  assert.equal(history[0].after,rating.reputation);
});
