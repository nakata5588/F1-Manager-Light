import test from "node:test";
import assert from "node:assert/strict";

import { createManagerProfile } from "../src/domain/managerProfile.js";
import { applyManagerCareerProgression } from "../src/domain/managerProgression.js";
import { managerJobOpportunity } from "../src/domain/managerJobMarket.js";
import {
  acceptManagerJobOffer,
  dismissPlayerManager,
  processManagerJobApplications,
  submitManagerJobApplication,
} from "../src/engine/ManagerCareerEngine.js";
import { migrateGameState, prepareGameStateForSave } from "../src/core/saveSafety.js";
import { normalizeAITechnicalWorld } from "../src/engine/AITechnicalEngine.js";

const ATTRIBUTE_KEYS=[
  "leadership",
  "personnel",
  "negotiation",
  "technical",
  "commercial",
  "race_management",
];

function manager(){
  return createManagerProfile({
    first_name:"Full",
    last_name:"Career",
    nationality_name:"Portuguese",
    date_of_birth:"1945-01-01",
    background:"newcomer",
    experience_level:"experienced",
    reputation:70,
  },{
    year:1980,
    team:{team_id:"T1",team_name:"Team One"},
  });
}

function technicalTeam(teamId,budget,gearbox,hqLevel){
  return {
    team_id:teamId,
    budget,
    initial_budget:budget,
    garage:{
      cars:[
        {id:"car_1",label:"Car 1",kind:"race",driver_id:null,componentCondition:{gearbox},installedParts:{}},
        {id:"car_2",label:"Car 2",kind:"race",driver_id:null,componentCondition:{gearbox:gearbox-3},installedParts:{}},
      ],
      serviceJobs:[],
      baseComponentStock:{},
    },
    development:{
      projects:[{id:`${teamId}_project`}],
      parts:[],partUnits:[],manufacturing:[],research:[],aeroTestingUsage:[],
      technicalKnowledge:null,technicalStrategy:null,nextSeasonCar:null,
    },
    hq:{facilityLevels:{design_centre:hqLevel},upgrades:[]},
    academy:{drivers:[{driver_id:`${teamId}_junior`}]},
    scouting:{assignments:[],shortlist:[`${teamId}_target`]},
    board:{reputation:45+hqLevel,actions:[{id:`${teamId}_board_action`}]},
    legacy_runtime:{
      commercialScore:50+hqLevel,
      ops:{pitcrew:{error_prob:0.04,avg_time_s:4.5-hqLevel*0.1}},
      rdProjectsActive:[{id:`${teamId}_legacy_rd`}],
      meta:{team:{synergy:hqLevel},popularity:{team:10+hqLevel}},
      selectedDrivers:[`${teamId}_D1`,`${teamId}_D2`],
      financeFlags:{[`${teamId}_flag`]:true},
    },
    finance_summary:{balance:budget,budget,season_spend:0,season_income:0},
    finance_log:[{id:`${teamId}_tx`,amount:1000}],
    planning:{},
    strategy_planning:{},
    economy:{season_year:1980,last_allocation:0,opening_budget:budget},
    season_history:[],
    next_season_history:[],
    technology_projects:[],
    technology_unlocks:{},
    componentServiceLog:[],
    componentWearLog:[],
  };
}

function state(){
  return {
    activeYear:1980,
    currentDateISO:"1980-01-01",
    currentRound:0,
    team:{team_id:"T1",team_name:"Team One",budget:1_100_000},
    teams:[
      {team_id:"T1",team_name:"Team One",budget:1_100_000},
      {team_id:"T2",team_name:"Team Two",budget:2_200_000},
      {team_id:"T3",team_name:"Team Three",budget:3_300_000},
    ],
    manager:manager(),
    finances:{balance:1_100_000,budget:1_100_000,season_spend:0,season_income:0},
    financeLog:[{id:"T1_tx",amount:1000}],
    garage:{
      cars:[
        {id:"car_1",label:"Car 1",kind:"race",driver_id:null,componentCondition:{gearbox:61},installedParts:{}},
        {id:"car_2",label:"Car 2",kind:"race",driver_id:null,componentCondition:{gearbox:58},installedParts:{}},
      ],
      serviceJobs:[],
      baseComponentStock:{},
    },
    development:{
      projects:[{id:"T1_project"}],
      parts:[],partUnits:[],manufacturing:[],research:[],aeroTestingUsage:[],
      technicalKnowledge:null,technicalStrategy:null,nextSeasonCar:null,technologyProjects:[],
    },
    hq:{facilityLevels:{design_centre:2},upgrades:[]},
    academy:{drivers:[{driver_id:"T1_junior"}]},
    scouting:{assignments:[],shortlist:["T1_target"]},
    board:{reputation:47,actions:[{id:"T1_board_action"}]},
    commercialScore:52,
    ops:{pitcrew:{error_prob:0.04,avg_time_s:4.3}},
    rdProjectsActive:[{id:"T1_legacy_rd"}],
    meta:{team:{synergy:2},popularity:{team:12}},
    selectedDrivers:["T1_D1","T1_D2"],
    financeFlags:{T1_flag:true},
    eventsQueue:[],
    componentServiceLog:[],
    componentWearLog:[],
    technicalUnlocks:{},
    aiTechnicalWorld:{
      version:1,
      teams:{
        T2:technicalTeam("T2",2_200_000,72,3),
        T3:technicalTeam("T3",3_300_000,83,4),
      },
    },
    managerControlArchive:{},
    managerJobApplications:[],
    managerEmploymentState:{status:"active"},
    teamReputationState:{
      T1:{team_id:"T1",reputation:40},
      T2:{team_id:"T2",reputation:42},
      T3:{team_id:"T3",reputation:44},
    },
    staffCore:[],
    staffRatings:[],
    staffContracts:[],
    staffNegotiations:[],
    contracts:[],
    dbContracts:[],
    standings:{drivers:[],teams:[]},
    calendar:Array.from({length:6},(_,index)=>({round:index+1})),
    results:[],
    historySeasons:[],
    inbox:[],
  };
}

function raceResult(year,round,teamId){
  const rivals=["T1","T2","T3"].filter((id)=>id!==teamId);
  const win=round%3===0;
  const position=win?1:5;
  const points=win?9:2;
  return {
    key:`${year}_${round}_m7b_${teamId}`,
    year,
    round,
    gp_id:`m7b_gp_${year}_${round}`,
    dateISO:`${year}-${String(round+2).padStart(2,"0")}-01`,
    classification:[
      {
        team_id:teamId,
        driver_id:`${teamId}_${year}_${round}`,
        position,
        points,
        constructor_points:points,
        status:"Finished",
        retired:false,
      },
      {
        team_id:rivals[0],
        driver_id:`${rivals[0]}_${year}_${round}`,
        position:win?2:1,
        points:win?6:9,
        constructor_points:win?6:9,
        status:"Finished",
        retired:false,
      },
      {
        team_id:rivals[1],
        driver_id:`${rivals[1]}_${year}_${round}`,
        position:win?3:2,
        points:win?4:6,
        constructor_points:win?4:6,
        status:"Finished",
        retired:false,
      },
    ],
  };
}

function saveRoundTrip(gs){
  return migrateGameState(prepareGameStateForSave(gs));
}

function addManagedSeason(gs,year,teamId){
  assert.equal(gs.manager.current_team_id,teamId);
  const beforeLevel=gs.manager.development.level;
  const season=Array.from({length:6},(_,index)=>raceResult(year,index+1,teamId));
  let next={
    ...gs,
    activeYear:year,
    currentDateISO:`${year}-10-15`,
    results:[...gs.results,...season],
  };
  next=applyManagerCareerProgression(next);
  const afterFirst=next.manager;
  next=applyManagerCareerProgression(next);
  assert.deepEqual(next.manager,afterFirst,"reprocessing the same season must be inert");
  assert.ok(next.manager.development.level>=beforeLevel,"Career Level must never regress");
  next=saveRoundTrip(next);
  assert.ok(next.manager.development.level>=beforeLevel,"Save/Load must preserve Career Level");
  return next;
}

function updateControlledAssets(gs,{budget,gearbox,hqLevel}){
  return {
    ...gs,
    team:{...gs.team,budget},
    teams:gs.teams.map((team)=>team.team_id===gs.team.team_id?{...team,budget}:team),
    finances:{...gs.finances,balance:budget,budget},
    garage:{
      ...gs.garage,
      cars:gs.garage.cars.map((car)=>car.id==="car_1"
        ?{...car,componentCondition:{...car.componentCondition,gearbox}}
        :car),
    },
    hq:{...gs.hq,facilityLevels:{...gs.hq.facilityLevels,design_centre:hqLevel}},
  };
}

function evolveAiTeam(gs,teamId,{budget,gearbox,hqLevel}){
  const current=gs.aiTechnicalWorld.teams[teamId];
  assert.ok(current,`${teamId} must be AI-controlled before AI evolution`);
  return {
    ...gs,
    aiTechnicalWorld:{
      ...gs.aiTechnicalWorld,
      teams:{
        ...gs.aiTechnicalWorld.teams,
        [teamId]:{
          ...current,
          budget,
          finance_summary:{...current.finance_summary,balance:budget,budget},
          garage:{
            ...current.garage,
            cars:current.garage.cars.map((car)=>car.id==="car_1"
              ?{...car,componentCondition:{...car.componentCondition,gearbox}}
              :car),
          },
          hq:{...current.hq,facilityLevels:{...current.hq.facilityLevels,design_centre:hqLevel}},
        },
      },
    },
  };
}

function assertControlledIdentity(gs,teamId,{gearbox,hqLevel}){
  assert.equal(gs.team.team_id,teamId);
  assert.equal(gs.manager.current_team_id,teamId);
  assert.equal(gs.manager.current_job.status,"active");
  assert.equal(gs.finances.balance,gs.team.budget);
  assert.equal(gs.garage.cars.find((car)=>car.id==="car_1").componentCondition.gearbox,gearbox);
  assert.equal(gs.hq.facilityLevels.design_centre,hqLevel);
  assert.equal(gs.development.projects[0].id,`${teamId}_project`);
  assert.equal(gs.academy.drivers[0].driver_id,`${teamId}_junior`);
  assert.equal(gs.scouting.shortlist[0],`${teamId}_target`);
  assert.equal(gs.board.actions[0].id,`${teamId}_board_action`);
  assert.deepEqual(gs.selectedDrivers,[`${teamId}_D1`,`${teamId}_D2`]);
  assert.equal(
    gs.aiTechnicalWorld.teams[teamId],
    undefined,
    "controlled team must not remain duplicated in AI world"
  );
}

function dismissAndJoin(gs,{fromTeam,toTeam,endYear,startYear}){
  let next={...gs,activeYear:endYear,currentDateISO:`${endYear}-12-20`};
  next=dismissPlayerManager(next,{force:true,reason:"board_dismissal"});
  assert.equal(next.manager.current_job.status,"fired");
  assert.equal(next.manager.current_team_id,null);
  assert.equal(next.team,null);
  assert.equal(next.managerEmploymentState.status,"unemployed");
  assert.equal(next.managerEmploymentState.former_team_id,fromTeam);
  assert.ok(next.aiTechnicalWorld.teams[fromTeam],"former team must move to AI control");

  next=saveRoundTrip(next);
  assert.equal(next.managerEmploymentState.status,"unemployed");
  assert.equal(next.team,null);

  next={...next,activeYear:startYear,currentDateISO:`${startYear}-01-05`};
  next=normalizeAITechnicalWorld(next);
  const targetBudget=next.aiTechnicalWorld.teams[toTeam]?.budget;
  const formerBudget=next.aiTechnicalWorld.teams[fromTeam]?.budget;
  assert.ok(Number.isFinite(Number(targetBudget)));
  assert.ok(Number.isFinite(Number(formerBudget)));
  assert.notEqual(targetBudget,formerBudget,"fixture teams must keep independent finances");

  const opportunity=managerJobOpportunity(next,toTeam);
  assert.ok(opportunity);
  assert.equal(
    opportunity.available,
    true,
    `${toTeam} must be available through the canonical Job Market`
  );

  next=submitManagerJobApplication(next,toTeam);
  const application=next.managerJobApplications.at(-1);
  assert.ok(application);
  assert.equal(application.team_id,toTeam);
  assert.equal(application.status,"submitted");

  next={...next,currentDateISO:application.response_date};
  next=processManagerJobApplications(next,{
    forceOutcomeById:{[application.id]:"offer"},
  });
  const offered=next.managerJobApplications.find((row)=>row.id===application.id);
  assert.equal(offered.status,"offer");

  next=saveRoundTrip(next);
  assert.equal(next.manager.current_team_id,null);
  assert.equal(
    next.managerJobApplications.find((row)=>row.id===application.id).status,
    "offer"
  );

  next=acceptManagerJobOffer(next,application.id);
  assert.equal(next.manager.current_team_id,toTeam);
  assert.equal(next.finances.balance,targetBudget,"new employer must materialize its own canonical finances");
  assert.equal(next.managerEmploymentState.status,"active");
  assert.equal(
    next.managerJobApplications.find((row)=>row.id===application.id).status,
    "accepted"
  );

  next=saveRoundTrip(next);
  assert.equal(next.manager.current_team_id,toTeam);
  return next;
}

function assertCareerLedgers(gs,expectedRaces){
  const development=gs.manager.development;
  assert.equal(development.races_managed,expectedRaces);
  assert.equal(development.processed_result_keys.length,expectedRaces);
  assert.equal(new Set(development.processed_result_keys).size,expectedRaces);
  assert.equal(
    new Set(gs.manager.achievements.map((row)=>row.id)).size,
    gs.manager.achievements.length
  );
  assert.equal(
    new Set(development.history.map((row)=>row.id)).size,
    development.history.length
  );
  assert.ok(development.history.length<=60);
  assert.ok(gs.manager.reputation>=0&&gs.manager.reputation<=100);
  for(const key of ATTRIBUTE_KEYS){
    assert.ok(
      gs.manager.attributes[key]>=1&&gs.manager.attributes[key]<=99,
      `${key} must stay bounded`
    );
  }
}

test("Manager M7B full 16-season career survives firings, unemployment, team changes and return to a former team",()=>{
  let gs=state();
  let expectedRaces=0;
  let previousLevel=gs.manager.development.level;

  for(let year=1980;year<=1983;year+=1){
    gs=addManagedSeason(gs,year,"T1");
    expectedRaces+=6;
    assert.ok(gs.manager.development.level>=previousLevel);
    previousLevel=gs.manager.development.level;
  }

  gs=updateControlledAssets(gs,{budget:1_050_000,gearbox:54,hqLevel:3});
  gs=dismissAndJoin(gs,{
    fromTeam:"T1",
    toTeam:"T2",
    endYear:1983,
    startYear:1984,
  });
  assertControlledIdentity(gs,"T2",{gearbox:72,hqLevel:3});
  assert.equal(gs.managerControlArchive.T1.hq.facilityLevels.design_centre,3);

  gs=evolveAiTeam(gs,"T1",{budget:1_600_000,gearbox:47,hqLevel:5});

  for(let year=1984;year<=1987;year+=1){
    gs=addManagedSeason(gs,year,"T2");
    expectedRaces+=6;
    assert.ok(gs.manager.development.level>=previousLevel);
    previousLevel=gs.manager.development.level;
  }

  gs=updateControlledAssets(gs,{budget:2_050_000,gearbox:63,hqLevel:4});
  gs=dismissAndJoin(gs,{
    fromTeam:"T2",
    toTeam:"T3",
    endYear:1987,
    startYear:1988,
  });
  assertControlledIdentity(gs,"T3",{gearbox:83,hqLevel:4});

  gs=evolveAiTeam(gs,"T2",{budget:2_500_000,gearbox:56,hqLevel:5});

  for(let year=1988;year<=1991;year+=1){
    gs=addManagedSeason(gs,year,"T3");
    expectedRaces+=6;
    assert.ok(gs.manager.development.level>=previousLevel);
    previousLevel=gs.manager.development.level;
  }

  gs=updateControlledAssets(gs,{budget:3_000_000,gearbox:71,hqLevel:5});
  gs=dismissAndJoin(gs,{
    fromTeam:"T3",
    toTeam:"T1",
    endYear:1991,
    startYear:1992,
  });

  assertControlledIdentity(gs,"T1",{gearbox:47,hqLevel:5});
  assert.equal(gs.managerControlArchive.T1.hq.facilityLevels.design_centre,3);
  assert.equal(
    gs.aiTechnicalWorld.teams.T2.garage.cars.find((car)=>car.id==="car_1").componentCondition.gearbox,
    56
  );
  assert.equal(
    gs.aiTechnicalWorld.teams.T3.garage.cars.find((car)=>car.id==="car_1").componentCondition.gearbox,
    71
  );

  for(let year=1992;year<=1995;year+=1){
    gs=addManagedSeason(gs,year,"T1");
    expectedRaces+=6;
    assert.ok(gs.manager.development.level>=previousLevel);
    previousLevel=gs.manager.development.level;
  }

  assertCareerLedgers(gs,expectedRaces);
  assert.equal(expectedRaces,96);
  assert.equal(
    gs.managerJobApplications.filter((row)=>row.status==="accepted").length,
    3
  );
  assert.deepEqual(
    gs.manager.career_history.map((row)=>row.team_id),
    ["T1","T2","T3","T1"]
  );
  assert.ok(
    gs.manager.career_history
      .slice(0,3)
      .every((row)=>row.end_year!=null&&row.status==="fired")
  );
  assert.equal(gs.manager.career_history.at(-1).end_year,null);
  assert.equal(gs.manager.career_history.at(-1).status,"active");
  assert.equal(
    gs.manager.career_history.filter((row)=>row.team_id==="T1").length,
    2
  );

  const beforeRepeat=gs.manager;
  gs=applyManagerCareerProgression(gs);
  assert.deepEqual(
    gs.manager,
    beforeRepeat,
    "final full-career reprocessing must remain idempotent"
  );

  gs=saveRoundTrip(gs);
  assertCareerLedgers(gs,96);
  assert.deepEqual(
    gs.manager.career_history.map((row)=>row.team_id),
    ["T1","T2","T3","T1"]
  );
  assert.equal(gs.manager.current_team_id,"T1");
});
