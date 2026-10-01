import test from "node:test";
import assert from "node:assert/strict";

import {
  createManagerProfile,
  deriveManagerAttributes,
} from "../src/domain/managerProfile.js";
import {
  applyManagerCareerProgression,
  applyManagerPerformanceRegression,
} from "../src/domain/managerProgression.js";
import { migrateGameState, prepareGameStateForSave } from "../src/core/saveSafety.js";

const ATTRIBUTE_KEYS=[
  "leadership",
  "personnel",
  "negotiation",
  "technical",
  "commercial",
  "race_management",
];

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
    calendar:Array.from({length:14},(_,index)=>({round:index+1})),
    results:[],
    historySeasons:[],
    inbox:[],
    managerEmploymentState:{status:"active"},
  };
}

function result(year,round,position=1){
  const playerWins=position===1;
  return {
    key:`${year}_${round}_m7a_${position}`,
    year,
    round,
    gp_id:`m7a_gp_${year}_${round}`,
    dateISO:`${year}-${String(Math.min(12,round+2)).padStart(2,"0")}-01`,
    classification:[
      {
        team_id:playerWins?"T1":"T2",
        driver_id:`A_${year}_${round}`,
        position:1,
        points:9,
        constructor_points:9,
        status:"Finished",
        retired:false,
      },
      {
        team_id:playerWins?"T2":"T1",
        driver_id:`B_${year}_${round}`,
        position:playerWins?2:position,
        points:playerWins?6:0,
        constructor_points:playerWins?6:0,
        status:"Finished",
        retired:false,
      },
    ],
  };
}

function pressure(status,races){
  return {
    status,
    races,
    seasonProgress:1,
    jobSecurity:status==="critical"?15:30,
    canBeDismissed:true,
  };
}

function growthCeilings(profile){
  const baseline=deriveManagerAttributes({
    background:profile.background,
    experience:profile.experience_level,
  });
  const average=ATTRIBUTE_KEYS.reduce((sum,key)=>sum+Number(baseline[key]||0),0)/ATTRIBUTE_KEYS.length;
  const potential=Math.max(1,Math.min(99,Number(profile.potential)||1));
  const allowance=Math.max(0,potential-average);
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((key)=>[
      key,
      Math.min(99,Math.round(Number(baseline[key]||50)+allowance)),
    ])
  );
}

function regressionFloors(profile){
  const baseline=deriveManagerAttributes({
    background:profile.background,
    experience:profile.experience_level,
  });
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((key)=>[
      key,
      Math.max(25,Math.round(Number(baseline[key]||50)-15)),
    ])
  );
}

function assertNoDuplicateManagerLedgers(gs){
  const development=gs.manager.development;
  const processed=development.processed_result_keys;
  const history=development.history;
  const achievements=gs.manager.achievements;

  assert.equal(new Set(processed).size,processed.length,"processed result keys must remain unique");
  assert.equal(new Set(history.map((row)=>row.id)).size,history.length,"development history ids must remain unique");
  assert.equal(new Set(achievements.map((row)=>row.id)).size,achievements.length,"achievement ids must remain unique");
  assert.ok(history.length<=60,"development history must stay inside its canonical bound");
}

test("Manager M7A five-season progression soak is idempotent and save-safe",()=>{
  let gs=state();
  const ceilings=growthCeilings(gs.manager);
  let expectedRaces=0;

  for(let year=1980;year<1985;year+=1){
    const seasonResults=Array.from({length:14},(_,index)=>result(year,index+1,1));
    gs={
      ...gs,
      activeYear:year,
      currentDateISO:`${year}-12-20`,
      results:[...gs.results,...seasonResults],
    };
    expectedRaces+=seasonResults.length;

    gs=applyManagerCareerProgression(gs);
    const afterFirstTick={
      xp:gs.manager.development.xp,
      level:gs.manager.development.level,
      races:gs.manager.development.races_managed,
      keys:[...gs.manager.development.processed_result_keys],
      achievements:gs.manager.achievements.map((row)=>row.id),
      history:gs.manager.development.history.map((row)=>row.id),
    };

    gs=applyManagerCareerProgression(gs);
    assert.equal(gs.manager.development.xp,afterFirstTick.xp);
    assert.equal(gs.manager.development.level,afterFirstTick.level);
    assert.equal(gs.manager.development.races_managed,afterFirstTick.races);
    assert.deepEqual(gs.manager.development.processed_result_keys,afterFirstTick.keys);
    assert.deepEqual(gs.manager.achievements.map((row)=>row.id),afterFirstTick.achievements);
    assert.deepEqual(gs.manager.development.history.map((row)=>row.id),afterFirstTick.history);

    gs=migrateGameState(prepareGameStateForSave(gs));
    gs=applyManagerCareerProgression(gs);

    assert.equal(gs.manager.development.races_managed,expectedRaces);
    assert.equal(gs.manager.development.processed_result_keys.length,expectedRaces);
    assert.equal(gs.manager.career_history.length,1);
    assert.equal(gs.manager.career_history[0].team_id,"T1");
    assertNoDuplicateManagerLedgers(gs);

    for(const key of ATTRIBUTE_KEYS){
      assert.ok(gs.manager.attributes[key]>=1);
      assert.ok(gs.manager.attributes[key]<=ceilings[key],`${key} must respect its growth ceiling`);
    }
    assert.ok(gs.manager.reputation>=0&&gs.manager.reputation<=100);
  }

  assert.ok(gs.manager.development.level>1,"sustained success should create visible career progression");
  assert.ok(gs.manager.achievements.some((row)=>row.id==="manager_first_points"));
  assert.ok(gs.manager.achievements.some((row)=>row.id==="manager_first_podium"));
  assert.ok(gs.manager.achievements.some((row)=>row.id==="manager_first_win"));
});

test("Manager M7A ten-season regression soak is idempotent, bounded and floor-safe",()=>{
  let gs=state(manager({reputation:8}));
  const floors=regressionFloors(gs.manager);
  const startingXp=gs.manager.development.xp;
  const startingLevel=gs.manager.development.level;

  for(let year=1980;year<1990;year+=1){
    gs={
      ...gs,
      activeYear:year,
      currentDateISO:`${year}-12-01`,
    };

    for(let checkpoint=1;checkpoint<=8;checkpoint+=1){
      const status=checkpoint%2===1?"critical":"under_pressure";
      const options={
        assessment:pressure(status,checkpoint),
        criticalStreak:status==="critical"?checkpoint:0,
        pressureStreak:checkpoint,
      };

      const once=applyManagerPerformanceRegression(gs,options);
      const twice=applyManagerPerformanceRegression(once,options);
      assert.deepEqual(twice.manager,once.manager,"the same regression checkpoint must be inert");
      gs=twice;

      const beforeSave={
        reputation:gs.manager.reputation,
        attributes:{...gs.manager.attributes},
        history:gs.manager.development.history.map((row)=>row.id),
        key:gs.manager.development.last_regression_key,
      };
      gs=migrateGameState(prepareGameStateForSave(gs));
      gs=applyManagerPerformanceRegression(gs,options);

      assert.equal(gs.manager.reputation,beforeSave.reputation);
      assert.deepEqual(gs.manager.attributes,beforeSave.attributes);
      assert.deepEqual(gs.manager.development.history.map((row)=>row.id),beforeSave.history);
      assert.equal(gs.manager.development.last_regression_key,beforeSave.key);
      assertNoDuplicateManagerLedgers(gs);

      gs={...gs,currentDateISO:`${year}-12-${String(Math.min(28,checkpoint+1)).padStart(2,"0")}`};
    }

    assert.equal(gs.manager.development.xp,startingXp,"regression must not remove experience XP");
    assert.equal(gs.manager.development.level,startingLevel,"Career Level must not regress");
    assert.ok(gs.manager.reputation>=0&&gs.manager.reputation<=100);

    for(const key of ATTRIBUTE_KEYS){
      assert.ok(gs.manager.attributes[key]>=floors[key],`${key} must respect its regression floor`);
      assert.ok(gs.manager.attributes[key]<=99);
    }
  }
});

test("Manager M7A mixed-form soak keeps Career Level monotonic and all ledgers stable",()=>{
  let gs=state(manager({development:{xp:245,level:3}}));
  let previousLevel=gs.manager.development.level;

  for(let year=1980;year<1986;year+=1){
    const seasonResults=Array.from(
      {length:14},
      (_,index)=>result(year,index+1,(year+index)%2===0?1:10)
    );
    gs={
      ...gs,
      activeYear:year,
      currentDateISO:`${year}-11-01`,
      results:[...gs.results,...seasonResults],
    };

    gs=applyManagerCareerProgression(gs);
    const progressedLevel=gs.manager.development.level;
    assert.ok(progressedLevel>=previousLevel);

    const regressionOptions={
      assessment:pressure(year%2===0?"critical":"under_pressure",14),
      criticalStreak:year%2===0?1:0,
      pressureStreak:3,
    };
    gs=applyManagerPerformanceRegression(gs,regressionOptions);
    assert.equal(gs.manager.development.level,progressedLevel);

    const managerBeforeRepeat=gs.manager;
    gs=applyManagerCareerProgression(gs);
    gs=applyManagerPerformanceRegression(gs,regressionOptions);
    assert.deepEqual(gs.manager,managerBeforeRepeat);

    gs=migrateGameState(prepareGameStateForSave(gs));
    assert.ok(gs.manager.development.level>=previousLevel);
    previousLevel=gs.manager.development.level;
    assertNoDuplicateManagerLedgers(gs);
  }
});
