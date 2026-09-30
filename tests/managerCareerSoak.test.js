import test from "node:test";
import assert from "node:assert/strict";

import { createManagerProfile } from "../src/domain/managerProfile.js";
import {
  applyManagerCareerProgression,
  applyManagerPerformanceRegression,
} from "../src/domain/managerProgression.js";
import { migrateGameState, prepareGameStateForSave } from "../src/core/saveSafety.js";

function manager(overrides={}){
  return createManagerProfile({
    first_name:"Soak",
    last_name:"Test",
    background:"newcomer",
    experience_level:"experienced",
    ...overrides,
  },{
    year:1980,
    team:{team_id:"T1",team_name:"Player Team"},
  });
}

function state(profile=manager()){
  return {
    activeYear:1980,
    currentDateISO:"1980-03-01",
    currentRound:0,
    manager:profile,
    team:{team_id:"T1",team_name:"Player Team"},
    teams:[{team_id:"T1",team_name:"Player Team"},{team_id:"T2",team_name:"Rival Team"}],
    teamBrands:[{team_id:"T1",board_expectation:"midfield"},{team_id:"T2",board_expectation:"midfield"}],
    board:{reputation:0.5},
    standings:{teams:[],drivers:[]},
    calendar:Array.from({length:14},(_,i)=>({round:i+1})),
    results:[],
    inbox:[],
    managerEmploymentState:{status:"active"},
  };
}

function result(year,round,position){
  return {
    key:`${year}_${round}_m7_${position}`,
    year,
    round,
    dateISO:`${year}-${String(Math.min(12,round+2)).padStart(2,"0")}-01`,
    classification:[
      {team_id:position===1?"T1":"T2",driver_id:`A_${year}_${round}`,position:1,points:9,constructor_points:9,status:"Finished",retired:false},
      {team_id:position===1?"T2":"T1",driver_id:`B_${year}_${round}`,position,points:position===1?9:0,constructor_points:position===1?9:0,status:"Finished",retired:false},
    ],
  };
}

function pressure(status,races=14){
  return {
    status,
    races,
    seasonProgress:1,
    jobSecurity:status==="critical"?15:status==="under_pressure"?30:70,
    canBeDismissed:true,
  };
}

test("Manager M7 five-season positive soak keeps progression bounded and save-safe",()=>{
  let gs=state();
  for(let year=1980;year<1985;year+=1){
    gs={...gs,activeYear:year,currentDateISO:`${year}-12-01`,results:Array.from({length:14},(_,i)=>result(year,i+1,1))};
    gs=applyManagerCareerProgression(gs);
    gs=migrateGameState(prepareGameStateForSave(gs));
    assert.ok(gs.manager.development.level>=1&&gs.manager.development.level<=10);
    assert.ok(gs.manager.development.xp>=0);
    assert.ok(gs.manager.reputation>=0&&gs.manager.reputation<=100);
    for(const value of Object.values(gs.manager.attributes)) assert.ok(value>=0&&value<=100);
  }
  assert.ok(gs.manager.development.level>1,"sustained success should create visible career progression");
  assert.ok(Array.isArray(gs.manager.development.history));
});

test("Manager M7 sustained pressure cannot drive skills or reputation beyond legal bounds",()=>{
  let gs=state(manager({reputation:8}));
  for(let year=1980;year<1990;year+=1){
    gs={...gs,activeYear:year,currentDateISO:`${year}-12-01`};
    for(let checkpoint=1;checkpoint<=8;checkpoint+=1){
      gs=applyManagerPerformanceRegression(gs,{
        assessment:pressure(checkpoint%2?"critical":"under_pressure"),
        criticalStreak:checkpoint,
        pressureStreak:checkpoint,
      });
      gs={...gs,currentDateISO:`${year}-12-${String(Math.min(28,checkpoint+1)).padStart(2,"0")}`};
    }
    gs=migrateGameState(prepareGameStateForSave(gs));
    assert.ok(gs.manager.reputation>=0&&gs.manager.reputation<=100);
    for(const value of Object.values(gs.manager.attributes)) assert.ok(value>=0&&value<=100);
  }
});

test("Manager M7 mixed-form soak does not mutate Career Level downward",()=>{
  let gs=state(manager({development:{xp:245,level:3}}));
  let previousLevel=gs.manager.development.level;
  for(let year=1980;year<1986;year+=1){
    gs={...gs,activeYear:year,currentDateISO:`${year}-11-01`,results:Array.from({length:14},(_,i)=>result(year,i+1,(year+i)%2?1:10))};
    gs=applyManagerCareerProgression(gs);
    gs=applyManagerPerformanceRegression(gs,{
      assessment:pressure(year%2?"critical":"under_pressure"),
      criticalStreak:2,
      pressureStreak:3,
    });
    assert.ok(gs.manager.development.level>=previousLevel,"Career Level represents experience and must not regress");
    previousLevel=gs.manager.development.level;
    gs=migrateGameState(prepareGameStateForSave(gs));
  }
});
