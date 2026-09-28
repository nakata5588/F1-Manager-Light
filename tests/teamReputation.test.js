import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRaceTeamReputation,
  applySeasonTeamReputation,
  teamReputation,
} from "../src/domain/teamReputation.js";

function baseState(){
  return {
    activeYear:1980,
    currentDateISO:"1980-05-18",
    teams:[
      {team_id:"T1",team_name:"Alpha"},
      {team_id:"T2",team_name:"Beta"},
    ],
    standings:{
      teams:[
        {team_id:"T1",position:1,points:20},
        {team_id:"T2",position:2,points:10},
      ],
      drivers:[
        {driver_id:"D1",team_id:"T1",position:1,points:12},
        {driver_id:"D2",team_id:"T2",position:2,points:10},
      ],
    },
    results:[],
  };
}

test("race win and overperformance raise Team Reputation",()=>{
  const gs=baseState();
  const next=applyRaceTeamReputation(gs,{
    gp:{gp_name:"Test GP"},
    race:[
      {
        driver_id:"D1",team_id:"T1",position:1,retired:false,
        driver_performance:{expected_finish:6,expectation_delta:5},
      },
      {
        driver_id:"D3",team_id:"T1",position:5,retired:false,
        driver_performance:{expected_finish:8,expectation_delta:3},
      },
      {
        driver_id:"D2",team_id:"T2",position:2,retired:false,
        driver_performance:{expected_finish:2,expectation_delta:0},
      },
      {
        driver_id:"D4",team_id:"T2",position:6,retired:false,
        driver_performance:{expected_finish:4,expectation_delta:-2},
      },
    ],
  });

  assert.ok(teamReputation(next,"T1")>teamReputation(gs,"T1"));
  assert.ok(next.teamReputationLog.T1.length===1);
  assert.ok(next.teamReputationLog.T1[0].reasons.some((row)=>row.key==="win"));
});

test("persistent GP and standings underperformance can reduce Team Reputation",()=>{
  const gs={
    ...baseState(),
    standings:{
      ...baseState().standings,
      teams:[
        {team_id:"T1",position:2,points:8},
        {team_id:"T2",position:1,points:25},
      ],
    },
    teamReputationState:{T1:{team_id:"T1",reputation:60}},
  };
  const next=applyRaceTeamReputation(gs,{
    gp:{gp_name:"Poor GP"},
    race:[
      {
        driver_id:"D1",team_id:"T1",position:10,retired:false,
        driver_performance:{expected_finish:3,expectation_delta:-7},
      },
      {
        driver_id:"D3",team_id:"T1",position:12,retired:false,
        driver_performance:{expected_finish:5,expectation_delta:-7},
      },
      {
        driver_id:"D2",team_id:"T2",position:1,retired:false,
        driver_performance:{expected_finish:8,expectation_delta:7},
      },
      {
        driver_id:"D4",team_id:"T2",position:4,retired:false,
        driver_performance:{expected_finish:10,expectation_delta:6},
      },
    ],
  });
  assert.ok(teamReputation(next,"T1")<60);
});

test("season titles give explicit Team Reputation bonuses",()=>{
  const gs={
    ...baseState(),
    teamReputationState:{
      T1:{team_id:"T1",reputation:60},
      T2:{team_id:"T2",reputation:60},
    },
  };
  const next=applySeasonTeamReputation(gs,1980);
  assert.ok(teamReputation(next,"T1")>=68);
  const log=next.teamReputationLog.T1.at(-1);
  assert.equal(log.delta,8);
  assert.ok(log.reasons.some((row)=>row.key==="constructors_title"));
  assert.ok(log.reasons.some((row)=>row.key==="drivers_title"));
});

test("Team Reputation is distinct from Operational Morale",()=>{
  const gs={
    ...baseState(),
    teamReputationState:{T1:{team_id:"T1",reputation:72}},
    teamOperationalState:{T1:{team_id:"T1",morale:18}},
  };
  assert.equal(teamReputation(gs,"T1"),72);
  assert.equal(gs.teamOperationalState.T1.morale,18);
});


test("historical reputation baseline does not double-count mirrored runtime history",()=>{
  const history=[
    {year:1978,series_division:"F1",team_id:"T1",driver_id:"D1",wins:3,podiums:7},
    {year:1978,series_division:"F1",team_id:"T1",driver_id:"D2",wins:2,podiums:5},
  ];
  const achievements=[
    {year:1978,team_id:"T1",driver_id:"D1",driver_championship:1},
  ];
  const once=teamReputation({
    activeYear:1980,
    dbDriverHistory:history,
    dbAchievements:achievements,
  },"T1");
  const mirrored=teamReputation({
    activeYear:1980,
    dbDriverHistory:history,
    driverHistory:history,
    dbAchievements:achievements,
  },"T1");
  assert.equal(mirrored,once);
});

test("historical Reputation inherits verified organisation history and ignores selected-season future results",()=>{
  const base={
    activeYear:1980,
    dbTeamSeasons:[
      {year:1977,team_id:"OLD"},
      {year:1978,team_id:"OLD"},
      {year:1979,team_id:"OLD"},
    ],
    dbDriverHistory:[
      {year:1977,series_division:"F1",driver_id:"D1",team_id:"OLD",wins:3,podiums:6,starts:17,points:55},
      {year:1978,series_division:"F1",driver_id:"D1",team_id:"OLD",wins:2,podiums:5,starts:16,points:45},
      {year:1979,series_division:"F1",driver_id:"D1",team_id:"OLD",wins:1,podiums:4,starts:15,points:35},
      {year:1980,series_division:"F1",driver_id:"D2",team_id:"NEW",wins:15,podiums:25,starts:30,points:300},
    ],
    dbHistoricalChampionships:{
      constructors:[
        {year:1978,constructor_id:"OLD",position:1},
        {year:1979,constructor_id:"OLD",position:2},
        {year:1980,constructor_id:"NEW",position:1},
      ],
      drivers:[
        {year:1978,constructor_id:"OLD",position:1,driver_id:"D1"},
        {year:1980,constructor_id:"NEW",position:1,driver_id:"D2"},
      ],
    },
    teamHistoricalStrength:[
      {year:1980,team_id:"NEW",recent_competitiveness:72},
    ],
  };

  const noLineage=teamReputation(base,"NEW");
  const withLineage=teamReputation({
    ...base,
    dbTeamLineageHistory:[
      {predecessor_team_id:"OLD",successor_team_id:"NEW",effective_from_year:1980,verified:true},
    ],
  },"NEW");
  assert.ok(withLineage>noLineage,[withLineage,noLineage]);

  const withoutSelectedSeason={
    ...base,
    dbDriverHistory:base.dbDriverHistory.filter((row)=>Number(row.year)<1980),
    dbHistoricalChampionships:{
      constructors:base.dbHistoricalChampionships.constructors.filter((row)=>Number(row.year)<1980),
      drivers:base.dbHistoricalChampionships.drivers.filter((row)=>Number(row.year)<1980),
    },
    dbTeamLineageHistory:[
      {predecessor_team_id:"OLD",successor_team_id:"NEW",effective_from_year:1980,verified:true},
    ],
  };
  assert.equal(withLineage,teamReputation(withoutSelectedSeason,"NEW"));
});

test("career source season freezes the historical Reputation seed",()=>{
  const gs={
    activeYear:1980,
    dbTeamSeasons:[
      {year:1978,team_id:"T1"},
      {year:1979,team_id:"T1"},
      {year:1980,team_id:"T1"},
    ],
    dbDriverHistory:[
      {year:1978,series_division:"F1",driver_id:"D1",team_id:"T1",wins:1,podiums:2,starts:16},
      {year:1979,series_division:"F1",driver_id:"D1",team_id:"T1",wins:1,podiums:3,starts:16},
      {year:1980,series_division:"F1",driver_id:"D1",team_id:"T1",wins:12,podiums:20,starts:16},
    ],
    dbHistoricalChampionships:{constructors:[],drivers:[]},
    teamHistoricalStrength:[{year:1980,team_id:"T1",recent_competitiveness:55}],
  };
  const january=teamReputation(gs,"T1");
  const later=teamReputation({
    ...gs,
    activeYear:1982,
    careerMeta:{sourceSeason:1980},
    teamReputationState:{},
  },"T1");
  assert.equal(later,january);
});
