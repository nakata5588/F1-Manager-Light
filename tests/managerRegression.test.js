import test from "node:test";
import assert from "node:assert/strict";

import { createManagerProfile } from "../src/domain/managerProfile.js";
import {
  applyManagerCareerProgression,
  applyManagerPerformanceRegression,
} from "../src/domain/managerProgression.js";
import { processManagerCareerTick } from "../src/engine/ManagerCareerEngine.js";
import { migrateGameState, prepareGameStateForSave } from "../src/core/saveSafety.js";

function manager(overrides={}){
  return createManagerProfile({
    first_name:"Regression",
    last_name:"Test",
    background:"newcomer",
    experience_level:"experienced",
    ...overrides,
  },{
    year:1980,
    team:{team_id:"T1",team_name:"Player Team"},
  });
}

function state(managerProfile=manager()){
  return {
    activeYear:1980,
    currentDateISO:"1980-07-01",
    currentRound:0,
    manager:managerProfile,
    team:{team_id:"T1",team_name:"Player Team"},
    teams:[
      {team_id:"T1",team_name:"Player Team"},
      {team_id:"T2",team_name:"Rival Team"},
    ],
    teamBrands:[
      {team_id:"T1",board_expectation:"midfield"},
      {team_id:"T2",board_expectation:"midfield"},
    ],
    board:{reputation:0.5},
    standings:{teams:[],drivers:[]},
    calendar:Array.from({length:14},(_,i)=>({round:i+1})),
    results:[],
    inbox:[],
    managerEmploymentState:{status:"active"},
  };
}

function assessment({
  status="under_pressure",
  races=4,
  seasonProgress=0.3,
  jobSecurity=30,
}={}){
  return {
    status,
    races,
    seasonProgress,
    jobSecurity,
    canBeDismissed:races>=5&&seasonProgress>=0.35,
  };
}

function poorRace(round){
  return {
    key:`1980_${round}_manager_m5_poor`,
    year:1980,
    round,
    dateISO:`1980-${String(Math.min(12,round+2)).padStart(2,"0")}-01`,
    classification:[
      {team_id:"T2",driver_id:`T2_${round}`,position:1,points:9,constructor_points:9,status:"Finished",retired:false},
      {team_id:"T1",driver_id:`T1_${round}`,position:10,points:0,constructor_points:0,status:"Finished",retired:false},
    ],
  };
}

test("Manager M5 keeps Career Level/XP as experience while current skills can regress",()=>{
  const gs=state(manager({development:{xp:245,level:3}}));
  const next=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"under_pressure",races:6}),
    pressureStreak:3,
  });

  assert.equal(next.manager.development.xp,245);
  assert.equal(next.manager.development.level,3);
  assert.equal(next.manager.attributes.race_management,49);
  assert.equal(next.manager.attributes.leadership,50);
  assert.equal(next.manager.reputation,34.85);
  assert.equal(next.manager.development.attribute_regressions,1);
  assert.equal(next.manager.development.reputation_lost,0.15);
});

test("Manager M5 does not remove a permanent attribute for the first isolated pressure result",()=>{
  const gs=state();
  const next=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"under_pressure",races:4}),
    pressureStreak:1,
  });

  assert.deepEqual(next.manager.attributes,gs.manager.attributes);
  assert.equal(next.manager.reputation,34.85);
  assert.equal(next.manager.development.attribute_regressions,0);
});

test("Manager M5 alternates sustained pressure regression between Race Management and Leadership",()=>{
  let gs=state();

  gs=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"under_pressure",races:6}),
    pressureStreak:3,
  });
  assert.equal(gs.manager.attributes.race_management,49);
  assert.equal(gs.manager.attributes.leadership,50);

  gs={...gs,currentDateISO:"1980-09-01"};
  gs=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"under_pressure",races:9,seasonProgress:0.64}),
    pressureStreak:6,
  });
  assert.equal(gs.manager.attributes.race_management,49);
  assert.equal(gs.manager.attributes.leadership,49);
});

test("Manager M5 critical pressure costs Race Management first and Leadership on the next critical evaluation",()=>{
  let gs=state();

  gs=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"critical",races:6,seasonProgress:0.43,jobSecurity:18}),
    criticalStreak:1,
    pressureStreak:1,
  });
  assert.equal(gs.manager.attributes.race_management,49);
  assert.equal(gs.manager.attributes.leadership,50);
  assert.equal(gs.manager.reputation,34.65);

  gs={...gs,currentDateISO:"1980-08-01"};
  gs=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"critical",races:7,seasonProgress:0.50,jobSecurity:15}),
    criticalStreak:2,
    pressureStreak:2,
  });
  assert.equal(gs.manager.attributes.race_management,49);
  assert.equal(gs.manager.attributes.leadership,49);
  assert.equal(gs.manager.reputation,34.30);
});

test("Manager M5 regression is idempotent for the same season/race checkpoint",()=>{
  const gs=state();
  const first=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"critical",races:6,seasonProgress:0.43,jobSecurity:18}),
    criticalStreak:1,
  });
  const second=applyManagerPerformanceRegression(first,{
    assessment:assessment({status:"critical",races:6,seasonProgress:0.43,jobSecurity:18}),
    criticalStreak:1,
  });

  assert.equal(second.manager.attributes.race_management,49);
  assert.equal(second.manager.reputation,34.65);
  assert.equal(second.manager.development.attribute_regressions,1);
  assert.equal(second.manager.development.reputation_lost,0.35);
});

test("Manager M5 preserves regression ledger through Save/Load",()=>{
  let gs=applyManagerPerformanceRegression(state(),{
    assessment:assessment({status:"under_pressure",races:6}),
    pressureStreak:3,
  });
  const key=gs.manager.development.last_regression_key;

  gs=migrateGameState(prepareGameStateForSave(gs));

  assert.equal(gs.manager.development.last_regression_key,key);
  assert.equal(gs.manager.development.attribute_regressions,1);
  assert.equal(gs.manager.development.reputation_lost,0.15);

  const repeated=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"under_pressure",races:6}),
    pressureStreak:3,
  });
  assert.equal(repeated.manager.attributes.race_management,49);
  assert.equal(repeated.manager.reputation,34.85);
});

test("Manager M5 regression respects a background-shaped floor",()=>{
  const low=manager({
    attributes:{
      leadership:35,
      personnel:35,
      negotiation:35,
      technical:35,
      commercial:35,
      race_management:35,
    },
  });
  let gs=state(low);

  gs=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"critical",races:6,seasonProgress:0.43,jobSecurity:18}),
    criticalStreak:1,
  });
  gs={...gs,currentDateISO:"1980-08-01"};
  gs=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"critical",races:7,seasonProgress:0.50,jobSecurity:15}),
    criticalStreak:2,
  });

  assert.equal(gs.manager.attributes.race_management,35);
  assert.equal(gs.manager.attributes.leadership,35);
  assert.equal(gs.manager.development.attribute_regressions,0);
});

test("Manager M5 applies regression before a sustained-critical dismissal",()=>{
  let gs={
    ...state(),
    currentDateISO:"1980-08-01",
    results:Array.from({length:6},(_,index)=>poorRace(index+1)),
  };

  gs=processManagerCareerTick(gs);
  assert.equal(gs.manager.current_job.status,"active");
  assert.equal(gs.managerEmploymentState.last_status,"critical");
  assert.equal(gs.manager.attributes.race_management,49);
  assert.equal(gs.manager.attributes.leadership,50);

  gs={
    ...gs,
    currentDateISO:"1980-09-01",
    results:[...gs.results,poorRace(7)],
  };
  gs=processManagerCareerTick(gs);

  assert.equal(gs.manager.current_job.status,"fired");
  assert.equal(gs.manager.attributes.race_management,49);
  assert.equal(gs.manager.attributes.leadership,49);
  assert.ok(gs.manager.reputation<35);
});


test("Manager M5.1 records visible progression history when a Career Level changes",()=>{
  const gs={
    ...state(manager({development:{xp:95,level:1}})),
    currentDateISO:"1980-03-02",
    results:[{
      key:"1980_1_m51_win",
      year:1980,
      round:1,
      dateISO:"1980-03-01",
      classification:[
        {team_id:"T1",driver_id:"T1_A",position:1,points:9,constructor_points:9,status:"Finished",retired:false},
        {team_id:"T2",driver_id:"T2_A",position:2,points:6,constructor_points:6,status:"Finished",retired:false},
      ],
    }],
  };

  const next=applyManagerCareerProgression(gs);
  const event=next.manager.development.history[0];

  assert.equal(next.manager.development.level,2);
  assert.equal(event.type,"progression");
  assert.equal(event.title,"Career Level 2");
  assert.equal(event.reputation_delta,0.25);
  assert.deepEqual(event.attribute_changes,[{
    key:"leadership",
    delta:1,
    before:50,
    after:51,
  }]);
});

test("Manager M5.1 records regression reason and survives Save/Load without duplication",()=>{
  let gs=applyManagerPerformanceRegression(state(),{
    assessment:assessment({status:"critical",races:6,seasonProgress:0.43,jobSecurity:18}),
    criticalStreak:1,
    pressureStreak:1,
  });

  assert.equal(gs.manager.development.history.length,1);
  assert.equal(gs.manager.development.history[0].type,"regression");
  assert.equal(gs.manager.development.history[0].reputation_delta,-0.35);
  assert.deepEqual(gs.manager.development.history[0].attribute_changes,[{
    key:"race_management",
    delta:-1,
    before:50,
    after:49,
  }]);

  gs=migrateGameState(prepareGameStateForSave(gs));
  assert.equal(gs.manager.development.history.length,1);
  assert.equal(gs.manager.development.history[0].id,"regression:1980:6");

  const repeated=applyManagerPerformanceRegression(gs,{
    assessment:assessment({status:"critical",races:6,seasonProgress:0.43,jobSecurity:18}),
    criticalStreak:1,
    pressureStreak:1,
  });
  assert.equal(repeated.manager.development.history.length,1);
});

test("Manager M5.1 bounds development history in normalized profiles",()=>{
  const history=Array.from({length:75},(_,index)=>({
    id:"event_"+index,
    date:`1980-01-${String((index%28)+1).padStart(2,"0")}`,
    type:"progression",
    title:"Event "+index,
    reputation_delta:0.03,
    attribute_changes:[],
  }));
  const normalized=manager({development:{history}});

  assert.equal(normalized.development.history.length,60);
  assert.equal(normalized.development.history[0].id,"event_0");
  assert.equal(normalized.development.history.at(-1).id,"event_59");
});
