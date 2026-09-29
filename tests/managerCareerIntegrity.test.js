import test from "node:test";
import assert from "node:assert/strict";

import { createManagerProfile } from "../src/domain/managerProfile.js";
import {
  archiveControlledTeamForAI,
  clearPlayerTeamControl,
  materializeTeamForPlayer,
} from "../src/domain/managerTeamControl.js";
import { migrateGameState, prepareGameStateForSave } from "../src/core/saveSafety.js";

function manager(teamId="T1",teamName="Team One"){
  return createManagerProfile({
    first_name:"Career",last_name:"Test",nationality_name:"Portuguese",
    date_of_birth:"1945-01-01",background:"newcomer",experience_level:"experienced",
  },{year:1980,team:{team_id:teamId,team_name:teamName}});
}

function technicalTeam(teamId,budget,gearbox,hqLevel){
  return {
    team_id:teamId,budget,initial_budget:budget,
    garage:{cars:[{id:"car_1",kind:"race",componentCondition:{gearbox},installedParts:{}}],serviceJobs:[],baseComponentStock:{}},
    development:{projects:[{id:`${teamId}_project`}],parts:[],partUnits:[],manufacturing:[],research:[],aeroTestingUsage:[],technicalKnowledge:null,technicalStrategy:null,nextSeasonCar:null},
    hq:{facilityLevels:{design_centre:hqLevel},upgrades:[]},
    academy:{drivers:[{driver_id:`${teamId}_junior`}]},
    scouting:{assignments:[],shortlist:[`${teamId}_target`]},
    board:{reputation:50+hqLevel},
    finance_summary:{balance:budget,budget,season_spend:0,season_income:0},finance_log:[],
    planning:{},strategy_planning:{},economy:{season_year:1980,last_allocation:0,opening_budget:budget},
    season_history:[],next_season_history:[],technology_projects:[],technology_unlocks:{},
    componentServiceLog:[],componentWearLog:[],legacy_runtime:{},
  };
}

function state(){
  return {
    activeYear:1980,currentDateISO:"1980-03-01",currentRound:0,
    team:{team_id:"T1",team_name:"Team One",budget:2_000_000},
    teams:[{team_id:"T1",team_name:"Team One",budget:2_000_000},{team_id:"T2",team_name:"Team Two",budget:5_000_000}],
    manager:manager(),
    finances:{balance:2_000_000,budget:2_000_000,season_spend:100_000,season_income:200_000},financeLog:[{id:"T1_tx"}],
    garage:{cars:[{id:"car_1",kind:"race",componentCondition:{gearbox:61},installedParts:{}}],serviceJobs:[],baseComponentStock:{}},
    development:{projects:[{id:"T1_player_project"}],parts:[],partUnits:[],manufacturing:[],research:[],aeroTestingUsage:[],technologyProjects:[]},
    hq:{facilityLevels:{design_centre:2},upgrades:[]},academy:{drivers:[{driver_id:"T1_junior"}]},scouting:{assignments:[],shortlist:["T1_target"]},board:{reputation:52},
    commercialScore:null,ops:{},rdProjectsActive:[],meta:{},selectedDrivers:[],financeFlags:{},eventsQueue:[],componentServiceLog:[],componentWearLog:[],technicalUnlocks:{},
    aiTechnicalWorld:{version:1,teams:{T2:technicalTeam("T2",5_000_000,91,5)}},
    managerControlArchive:{},managerJobApplications:[],managerEmploymentState:{status:"active"},
    standings:{drivers:[],teams:[]},results:[],inbox:[],
  };
}

test("manager career state survives save migration while unemployed with a pending offer",()=>{
  const gs=state();
  const archived=archiveControlledTeamForAI(gs);
  const unemployed={
    ...clearPlayerTeamControl(archived),
    manager:{...gs.manager,current_team_id:null,current_team_name:null,current_job:{...gs.manager.current_job,team_id:null,team_name:null,status:"fired"}},
    managerEmploymentState:{status:"unemployed",former_team_id:"T1",unemployed_since:"1980-03-01"},
    managerJobApplications:[{id:"job_T2",team_id:"T2",status:"offer",offer:{role:"Team Principal",contract_years:2},offer_expires:"1980-03-10"}],
  };
  const loaded=migrateGameState(prepareGameStateForSave(unemployed));
  assert.equal(loaded.manager.current_team_id,null);
  assert.equal(loaded.manager.current_job.status,"fired");
  assert.equal(loaded.managerEmploymentState.status,"unemployed");
  assert.equal(loaded.managerJobApplications[0].status,"offer");
  assert.equal(loaded.managerControlArchive.T1.hq.facilityLevels.design_centre,2);
  assert.equal(loaded.aiTechnicalWorld.teams.T1.garage.cars[0].componentCondition.gearbox,61);
});

test("repeated T1 to T2 to T1 control handoff restores each team's own latest state",()=>{
  let gs=state();
  gs=archiveControlledTeamForAI(gs);
  gs=clearPlayerTeamControl(gs);
  gs=materializeTeamForPlayer(gs,"T2");
  assert.equal(gs.team.team_id,"T2");
  assert.equal(gs.finances.balance,5_000_000);
  assert.equal(gs.garage.cars[0].componentCondition.gearbox,91);

  // Simulate player-era changes at T2 before leaving it.
  gs={...gs,finances:{...gs.finances,balance:4_200_000,budget:4_200_000},garage:{...gs.garage,cars:gs.garage.cars.map((car)=>({...car,componentCondition:{...car.componentCondition,gearbox:73}}))}};
  gs=archiveControlledTeamForAI(gs);
  gs=clearPlayerTeamControl(gs);

  // Simulate T1 evolving while controlled by AI; returning must use this latest
  // AI state, not the older managerControlArchive snapshot.
  gs={...gs,aiTechnicalWorld:{...gs.aiTechnicalWorld,teams:{...gs.aiTechnicalWorld.teams,T1:{...gs.aiTechnicalWorld.teams.T1,budget:1_650_000,finance_summary:{...gs.aiTechnicalWorld.teams.T1.finance_summary,balance:1_650_000,budget:1_650_000},hq:{facilityLevels:{design_centre:3},upgrades:[]},garage:{...gs.aiTechnicalWorld.teams.T1.garage,cars:gs.aiTechnicalWorld.teams.T1.garage.cars.map((car)=>({...car,componentCondition:{...car.componentCondition,gearbox:48}}))}}}}};
  gs=materializeTeamForPlayer(gs,"T1");
  assert.equal(gs.team.team_id,"T1");
  assert.equal(gs.finances.balance,1_650_000);
  assert.equal(gs.hq.facilityLevels.design_centre,3);
  assert.equal(gs.garage.cars[0].componentCondition.gearbox,48);
  assert.equal(gs.aiTechnicalWorld.teams.T2.budget,4_200_000);
  assert.equal(gs.aiTechnicalWorld.teams.T2.garage.cars[0].componentCondition.gearbox,73);
});

test("career history and team archives survive repeated save round trips",()=>{
  let gs=state();
  gs.manager={...gs.manager,career_history:[
    {team_id:"T1",team_name:"Team One",role:"Team Principal",start_year:1980,end_year:1981,status:"fired"},
    {team_id:"T2",team_name:"Team Two",role:"Team Principal",start_year:1982,end_year:null,status:"active"},
  ]};
  gs=archiveControlledTeamForAI(gs);
  for(let i=0;i<3;i++)gs=migrateGameState(prepareGameStateForSave(gs));
  assert.equal(gs.manager.career_history.length,2);
  assert.equal(gs.manager.career_history[0].team_id,"T1");
  assert.equal(gs.manager.career_history[1].team_id,"T2");
  assert.equal(gs.managerControlArchive.T1.team_id,"T1");
  assert.equal(gs.aiTechnicalWorld.teams.T1.budget,2_000_000);
});
