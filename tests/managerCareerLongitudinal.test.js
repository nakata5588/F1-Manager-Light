import test from "node:test";
import assert from "node:assert/strict";

import { createManagerProfile } from "../src/domain/managerProfile.js";
import { applyManagerCareerProgression } from "../src/domain/managerProgression.js";
import { migrateGameState, prepareGameStateForSave } from "../src/core/saveSafety.js";

function manager(overrides={}){
  return createManagerProfile({
    first_name:"Long",
    last_name:"Career",
    nationality_name:"Portuguese",
    date_of_birth:"1945-01-01",
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
    currentDateISO:"1980-01-01",
    team:{team_id:"T1",team_name:"Player Team"},
    teams:[
      {team_id:"T1",team_name:"Player Team"},
      {team_id:"T2",team_name:"Rival Team"},
    ],
    manager:managerProfile,
    results:[],
    historySeasons:[],
    standings:{teams:[],drivers:[]},
    calendar:[],
    inbox:[],
  };
}

function race({year,round,outcome}){
  const date=`${year}-${String(Math.min(12,Math.ceil(round/2))).padStart(2,"0")}-${String((round%27)+1).padStart(2,"0")}`;
  let position=10;
  let points=0;
  if(outcome==="points"){position=5;points=2;}
  if(outcome==="podium"){position=2;points=6;}
  if(outcome==="win"){position=1;points=9;}
  return {
    key:`${year}_${round}_career_soak`,
    year,
    round,
    gp_id:`gp_${year}_${round}`,
    dateISO:date,
    classification:[
      {
        position,
        driver_id:`T1_D_${year}_${round}`,
        team_id:"T1",
        points,
        constructor_points:points,
        status:"Finished",
        retired:false,
      },
      {
        position:position===1?2:1,
        driver_id:`T2_D_${year}_${round}`,
        team_id:"T2",
        points:position===1?6:9,
        constructor_points:position===1?6:9,
        status:"Finished",
        retired:false,
      },
    ],
  };
}

function expectedXp(outcome){
  if(outcome==="win")return 17;
  if(outcome==="podium")return 11;
  if(outcome==="points")return 7;
  return 5;
}

test("Manager M4 stays idempotent across a three-season Save/Load soak",()=>{
  let gs=state();
  let expected={
    xp:0,
    races:0,
    pointsRaces:0,
    podiums:0,
    wins:0,
  };

  for(let year=1980;year<=1982;year++){
    for(let round=1;round<=16;round++){
      const outcome=round%5===0
        ?"win"
        :round%3===0
          ?"podium"
          :round%2===0
            ?"points"
            :"finish";
      gs={
        ...gs,
        activeYear:year,
        currentDateISO:`${year}-12-20`,
        results:[...gs.results,race({year,round,outcome})],
      };

      expected.xp+=expectedXp(outcome);
      expected.races+=1;
      if(outcome!=="finish")expected.pointsRaces+=1;
      if(outcome==="podium"||outcome==="win")expected.podiums+=1;
      if(outcome==="win")expected.wins+=1;

      gs=applyManagerCareerProgression(gs);
      // Daily ticks may revisit the same archive repeatedly; they must be inert.
      gs=applyManagerCareerProgression(gs);

      if(round%4===0){
        gs=migrateGameState(prepareGameStateForSave(gs));
        gs=applyManagerCareerProgression(gs);
      }
    }
  }

  assert.equal(gs.manager.development.races_managed,expected.races);
  assert.equal(gs.manager.development.points_races,expected.pointsRaces);
  assert.equal(gs.manager.development.podiums,expected.podiums);
  assert.equal(gs.manager.development.wins,expected.wins);
  assert.equal(gs.manager.development.xp,expected.xp);
  assert.equal(gs.manager.development.processed_result_keys.length,expected.races);
  assert.equal(new Set(gs.manager.development.processed_result_keys).size,expected.races);

  const repeated=applyManagerCareerProgression(gs);
  assert.equal(repeated.manager.development.xp,expected.xp);
  assert.equal(repeated.manager.development.races_managed,expected.races);
  assert.equal(repeated.manager.achievements.length,gs.manager.achievements.length);
});

test("Manager M4 growth stops at background-shaped potential ceilings",()=>{
  const engineer=manager({
    background:"engineer",
    experience_level:"experienced",
    development:{xp:30000,level:1},
  });
  const gs={
    ...state(engineer),
    results:[race({year:1980,round:1,outcome:"win"})],
  };

  const next=applyManagerCareerProgression(gs);

  assert.equal(next.manager.development.level,301);
  assert.deepEqual(next.manager.attributes,{
    leadership:84,
    personnel:78,
    negotiation:78,
    technical:98,
    commercial:77,
    race_management:89,
  });
  assert.ok(Object.values(next.manager.attributes).every((value)=>value<=99));
});

test("Manager M4 Save/Load preserves the exact progression ledger before later results",()=>{
  let gs={
    ...state(),
    results:[
      race({year:1980,round:1,outcome:"win"}),
      race({year:1980,round:2,outcome:"points"}),
    ],
  };
  gs=applyManagerCareerProgression(gs);
  const before={
    xp:gs.manager.development.xp,
    level:gs.manager.development.level,
    keys:[...gs.manager.development.processed_result_keys],
    achievements:gs.manager.achievements.map((row)=>row.id),
  };

  gs=migrateGameState(prepareGameStateForSave(gs));
  assert.equal(gs.manager.development.xp,before.xp);
  assert.equal(gs.manager.development.level,before.level);
  assert.deepEqual(gs.manager.development.processed_result_keys,before.keys);
  assert.deepEqual(gs.manager.achievements.map((row)=>row.id),before.achievements);

  gs={
    ...gs,
    currentDateISO:"1980-04-01",
    results:[...gs.results,race({year:1980,round:3,outcome:"podium"})],
  };
  gs=applyManagerCareerProgression(gs);

  assert.equal(gs.manager.development.races_managed,3);
  assert.equal(gs.manager.development.xp,before.xp+11);
  assert.equal(gs.manager.development.processed_result_keys.length,3);
  assert.equal(new Set(gs.manager.development.processed_result_keys).size,3);
});
