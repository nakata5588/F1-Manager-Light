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
  assert.ok(teamReputation(next,"T1")>60);
  const log=next.teamReputationLog.T1.at(-1);
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
