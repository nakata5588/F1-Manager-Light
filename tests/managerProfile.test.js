import test from "node:test";
import assert from "node:assert/strict";

import {
  createManagerProfile,
  deriveManagerAttributes,
  managerGameplayEffects,
} from "../src/domain/managerProfile.js";
import { deriveBoardState } from "../src/domain/boardState.js";
import {
  applyPlayerManagerTeamPrincipalAppointment,
  managerEmploymentAssessment,
  playerManagerIsActiveTeamPrincipal,
} from "../src/domain/managerEmployment.js";
import {
  archiveControlledTeamForAI,
  materializeTeamForPlayer,
} from "../src/domain/managerTeamControl.js";
import {
  managerJobOpportunity,
  managerJobOpportunities,
} from "../src/domain/managerJobMarket.js";
import {
  acceptManagerJobOffer,
  autosimUnemployedRaceIfDue,
  dismissPlayerManager,
  processManagerCareerTick,
  processManagerJobApplications,
  submitManagerJobApplication,
} from "../src/engine/ManagerCareerEngine.js";
import { contractAcceptanceChance, expectedDriverSalary } from "../src/domain/driverContracts.js";
import { applyRaceTeamMorale } from "../src/domain/teamMorale.js";
import { applyManagerCareerProgression } from "../src/domain/managerProgression.js";

function playerManager(overrides={}){
  return createManagerProfile({
    first_name:"Test",
    last_name:"Manager",
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

function baseState(manager=null){
  return {
    activeYear:1980,
    currentDateISO:"1980-03-01",
    team:{team_id:"T1",team_name:"Player Team"},
    manager,
    teams:[
      {team_id:"T1",team_name:"Player Team"},
      {team_id:"T2",team_name:"AI Team"},
    ],
    teamBrands:[
      {team_id:"T1",board_expectation:"midfield"},
      {team_id:"T2",board_expectation:"midfield"},
    ],
    standings:{teams:[],drivers:[]},
    calendar:Array.from({length:14},(_,i)=>({round:i+1})),
    results:[],
    drivers:[
      {driver_id:"D3",display_name:"Free Star",status:"eligible"},
    ],
    driverRatings:[
      {driver_id:"D3",current_ability:76,pace:80,reputation:70,market_value:1_500_000},
    ],
    contracts:[],
    teamOperationalState:{T1:{morale:50},T2:{morale:50}},
    teamMoraleLog:{},
  };
}

test("manager backgrounds are balanced trade-offs rather than free overall points",()=>{
  const newcomer=deriveManagerAttributes({background:"newcomer",experience:"experienced"});
  const engineer=deriveManagerAttributes({background:"engineer",experience:"experienced"});
  const commercial=deriveManagerAttributes({background:"commercial",experience:"experienced"});

  const total=(row)=>Object.values(row).reduce((sum,value)=>sum+value,0);
  assert.equal(total(newcomer),total(engineer));
  assert.equal(total(newcomer),total(commercial));
  assert.ok(engineer.technical>newcomer.technical);
  assert.ok(engineer.commercial<newcomer.commercial);
  assert.ok(commercial.negotiation>newcomer.negotiation);
  assert.ok(commercial.technical<newcomer.technical);
});

test("experience trades starting strength and reputation for growth potential",()=>{
  const rookie=playerManager({experience_level:"rookie"});
  const veteran=playerManager({experience_level:"veteran"});

  assert.ok(veteran.attributes.leadership>rookie.attributes.leadership);
  assert.ok(veteran.reputation>rookie.reputation);
  assert.ok(rookie.potential>veteran.potential);
});

test("manager gameplay modifiers only apply to the player team",()=>{
  const manager=playerManager({
    attributes:{
      leadership:90,personnel:90,negotiation:90,technical:90,commercial:90,race_management:90,
    },
  });
  const gs=baseState(manager);
  const player=managerGameplayEffects(gs,{teamId:"T1"});
  const ai=managerGameplayEffects(gs,{teamId:"T2"});

  assert.equal(player.active,true);
  assert.ok(player.contractAcceptanceDelta>0);
  assert.ok(player.relationshipPositiveMultiplier>1);
  assert.ok(player.relationshipNegativeMultiplier<1);
  assert.ok(player.technicalTimeMultiplier<1);
  assert.equal(ai.active,false);
  assert.equal(ai.contractAcceptanceDelta,0);
  assert.equal(ai.relationshipPositiveMultiplier,1);
  assert.equal(ai.relationshipNegativeMultiplier,1);
  assert.equal(ai.technicalTimeMultiplier,1);
});

test("leadership changes board confidence modestly without replacing objectives",()=>{
  const low=baseState(playerManager({attributes:{leadership:20}}));
  const high=baseState(playerManager({attributes:{leadership:90}}));
  const lowBoard=deriveBoardState(low);
  const highBoard=deriveBoardState(high);

  assert.ok(highBoard.confidence>lowBoard.confidence);
  assert.ok(highBoard.confidence-lowBoard.confidence<0.10);
  assert.deepEqual(
    highBoard.objectives.map((row)=>row.id),
    lowBoard.objectives.map((row)=>row.id)
  );
});

test("negotiation skill improves player contract acceptance but never buffs an AI team",()=>{
  const weak=baseState(playerManager({attributes:{negotiation:20}}));
  const strong=baseState(playerManager({attributes:{negotiation:90}}));
  const expected=expectedDriverSalary(strong,"D3");
  const offer={salary:expected,years:2,role:"Main Driver"};

  const weakPlayer=contractAcceptanceChance(weak,"D3",offer,{teamId:"T1"});
  const strongPlayer=contractAcceptanceChance(strong,"D3",offer,{teamId:"T1"});
  const weakAI=contractAcceptanceChance(weak,"D3",offer,{teamId:"T2"});
  const strongAI=contractAcceptanceChance(strong,"D3",offer,{teamId:"T2"});

  assert.ok(strongPlayer>weakPlayer);
  assert.equal(strongAI,weakAI);
});

test("people management amplifies good morale and cushions bad morale for the player team",()=>{
  const weak=baseState(playerManager({attributes:{leadership:20,personnel:20}}));
  const strong=baseState(playerManager({attributes:{leadership:90,personnel:90}}));

  const winRace=[{team_id:"T1",driver_id:"D3",position:1,pos:1,points:10,retired:false}];
  const dnfRace=[
    {team_id:"T1",driver_id:"D3",retired:true,retirement_reason:"Mechanical"},
    {team_id:"T1",driver_id:"D4",retired:true,retirement_reason:"Mechanical"},
  ];

  const weakWin=applyRaceTeamMorale(weak,{race:winRace,gp:{name:"Test GP"}});
  const strongWin=applyRaceTeamMorale(strong,{race:winRace,gp:{name:"Test GP"}});
  assert.ok(strongWin.teamOperationalState.T1.morale>weakWin.teamOperationalState.T1.morale);

  const weakDnf=applyRaceTeamMorale(weak,{race:dnfRace,gp:{name:"Test GP"}});
  const strongDnf=applyRaceTeamMorale(strong,{race:dnfRace,gp:{name:"Test GP"}});
  assert.ok(strongDnf.teamOperationalState.T1.morale>weakDnf.teamOperationalState.T1.morale);
});

test("technical and race-management modifiers stay deliberately bounded",()=>{
  const manager=playerManager({
    attributes:{technical:99,race_management:99},
  });
  const effects=managerGameplayEffects(baseState(manager),{teamId:"T1"});

  assert.ok(effects.technicalTimeMultiplier>=0.94);
  assert.ok(effects.technicalRiskMultiplier>=0.90);
  assert.ok(effects.raceExecutionErrorMultiplier>=0.92);
  assert.ok(Math.abs(effects.raceStrategyQualityDelta)<=0.05);
});


test("player manager is canonically a Team Principal and legacy role labels migrate",()=>{
  const fresh=playerManager();
  assert.equal(fresh.current_job.role,"Team Principal");
  assert.equal(fresh.career_history[0].role,"Team Principal");

  const migrated=createManagerProfile({
    ...fresh,
    current_job:{...fresh.current_job,role:"Team Manager"},
    career_history:[{team_id:"T1",team_name:"Player Team",role:"Team Manager",start_year:1978,end_year:null,status:"active"}],
  },{year:1980,team:{team_id:"T1",team_name:"Player Team"}});
  assert.equal(migrated.current_job.role,"Team Principal");
  assert.equal(migrated.career_history[0].role,"Team Principal");
});

test("player Team Principal appointment releases historical incumbent without removing AI principals",()=>{
  const gs=baseState(playerManager());
  gs.staffCore=[
    {staff_id:"P1",staff_name:"Historical Player Principal",role_primary:"team_principal"},
    {staff_id:"P2",staff_name:"AI Principal",role_primary:"team_principal"},
  ];
  gs.staffRatings=[];
  gs.staffContracts=[
    {year:1980,team_id:"T1",staff_id:"P1",staff_name:"Historical Player Principal",role:"team_principal",status:"active",contract_start_year:1979,contract_until_year:1981},
    {year:1980,team_id:"T2",staff_id:"P2",staff_name:"AI Principal",role:"team_principal",status:"active",contract_start_year:1979,contract_until_year:1981},
  ];
  const next=applyPlayerManagerTeamPrincipalAppointment(gs);
  assert.equal(playerManagerIsActiveTeamPrincipal(next,"T1"),true);
  assert.equal(next.staffContracts.find((row)=>row.staff_id==="P1").status,"released");
  assert.equal(next.staffContracts.find((row)=>row.staff_id==="P1").release_reason,"player_manager_appointment");
  assert.equal(next.staffContracts.find((row)=>row.staff_id==="P2").status,"active");
});

test("job security reuses Board performance with early-season dismissal protection",()=>{
  const gs=baseState(playerManager());
  const early=managerEmploymentAssessment(gs);
  assert.equal(early.status,"evaluating");
  assert.equal(early.canBeDismissed,false);
  assert.ok(early.jobSecurity>=0&&early.jobSecurity<=100);

  gs.results=Array.from({length:8},(_,index)=>({
    year:1980,
    round:index+1,
    classification:[
      {team_id:"T2",position:1,points:9,retired:false},
      {team_id:"T1",position:10,points:0,retired:false},
    ],
  }));
  const mature=managerEmploymentAssessment(gs);
  assert.equal(mature.canBeDismissed,true);
  assert.ok(["stable","under_pressure","critical","secure"].includes(mature.status));
  assert.ok(mature.seasonProgress>=0.5);
});


test("Manager contract renewal adds exactly two seasons from the renewal year",()=>{
  const manager=playerManager();
  const currentHistory=(manager.career_history||[]).map((row)=>({
    ...row,
    contract_until_year:1981,
  }));
  const gs={
    ...baseState({
      ...manager,
      current_job:{...manager.current_job,contract_until_year:1981,status:"active"},
      career_history:currentHistory,
    }),
    activeYear:1982,
    currentDateISO:"1982-01-02",
    managerEmploymentState:{
      status:"active",
      last_security:60,
      last_evaluated_races:14,
      critical_streak:0,
      pressure_streak:0,
    },
  };

  const next=processManagerCareerTick(gs);
  assert.equal(next.manager.current_job.contract_until_year,1983);
  assert.equal(next.manager.career_history.find((row)=>row.end_year==null)?.contract_until_year,1983);
  assert.match(next.inbox[0].body,/1983 season/);
});

test("unemployed manager stays unattached after normalization and gameplay effects switch off",()=>{
  const employed=playerManager();
  const unemployed={
    ...employed,
    current_team_id:null,
    current_team_name:null,
    current_job:{
      ...employed.current_job,
      team_id:null,
      team_name:null,
      status:"fired",
    },
  };
  const normalized=createManagerProfile(unemployed,{
    year:1980,
    team:{team_id:"T1",team_name:"Former Team"},
  });
  assert.equal(normalized.current_team_id,null);
  assert.equal(normalized.current_job.team_id,null);
  assert.equal(normalized.current_job.status,"fired");

  const effects=managerGameplayEffects(baseState(normalized),{teamId:"T1"});
  assert.equal(effects.active,false);
  assert.equal(effects.boardConfidenceDelta,0);
});


test("player appointment leaves expired historical Team Principal contracts untouched",()=>{
  const gs=baseState(playerManager());
  gs.activeYear=1982;
  gs.currentDateISO="1982-03-01";
  gs.staffContracts=[
    {
      year:1979,team_id:"T1",staff_id:"OLD",staff_name:"Old Principal",
      role:"team_principal",status:"active",
      contract_start_year:1978,contract_until_year:1980,end_year:1980,
    },
  ];
  const next=applyPlayerManagerTeamPrincipalAppointment(gs);
  const old=next.staffContracts[0];
  assert.equal(old.status,"active");
  assert.equal(old.contract_until_year,1980);
  assert.equal(old.end_year,1980);
  assert.equal(old.release_reason,undefined);
});

test("player appointment cancels persisted Team Principal negotiations",()=>{
  const gs=baseState(playerManager());
  gs.staffContracts=[];
  gs.staffNegotiations=[
    {
      id:"legacy_tp_offer",staff_id:"P3",team_id:"T1",
      role:"team_principal",offer:{role:"team_principal",salary:200000,years:2},
      status:"countered",origin:"player",
    },
  ];
  const next=applyPlayerManagerTeamPrincipalAppointment(gs);
  assert.equal(next.staffNegotiations[0].status,"withdrawn");
  assert.equal(next.staffNegotiations[0].resolution_reason,"player_manager_appointment");
});


test("dismissing the player archives old-team assets and makes the Manager unattached",()=>{
  const gs=baseState(playerManager());
  gs.team={team_id:"T1",team_name:"Player Team",budget:2_400_000};
  gs.finances={balance:2_400_000,budget:2_400_000,season_spend:125_000,season_income:300_000};
  gs.financeLog=[{id:"old_tx",amount:-1000}];
  gs.garage={
    cars:[
      {id:"car_1",label:"Car 1",kind:"race",driver_id:null,componentCondition:{gearbox:61},installedParts:{}},
      {id:"car_2",label:"Car 2",kind:"race",driver_id:null,componentCondition:{gearbox:72},installedParts:{}},
    ],
    serviceJobs:[],
    baseComponentStock:{},
  };
  gs.development={projects:[{id:"old_project"}],parts:[],partUnits:[],manufacturing:[],research:[],aeroTestingUsage:[],technologyProjects:[]};
  gs.hq={facilityLevels:{design_centre:3},upgrades:[{id:"old_hq_upgrade"}]};
  gs.academy={drivers:[{driver_id:"J1"}]};
  gs.scouting={assignments:[{id:"scout_old",status:"active"}],shortlist:["J2"]};
  gs.board={reputation:73,actions:[{id:"board_old"}]};
  gs.commercialScore=81;
  gs.ops={pitcrew:{error_prob:0.04,avg_time_s:4.3}};
  gs.rdProjectsActive=[{id:"legacy_rd",costMonthly:25000}];
  gs.meta={team:{synergy:12},popularity:{team:15,drivers:{D1:7}}};
  gs.selectedDrivers=["D1","D2"];
  gs.financeFlags={old_flag:true};
  gs.eventsQueue=[{
    id:"future_training",type:"driver_action",dateISO:"1980-03-05",done:false,
    effects:[{key:"money",delta:-50000}],
  }];
  gs.aiTechnicalWorld={
    version:1,
    teams:{
      T2:{
        team_id:"T2",
        budget:6_500_000,
        initial_budget:6_500_000,
        garage:{
          cars:[
            {id:"car_1",label:"Car 1",kind:"race",driver_id:null,componentCondition:{gearbox:91},installedParts:{}},
            {id:"car_2",label:"Car 2",kind:"race",driver_id:null,componentCondition:{gearbox:88},installedParts:{}},
          ],
          serviceJobs:[],
          baseComponentStock:{},
        },
        development:{projects:[{id:"target_project"}],parts:[],partUnits:[],manufacturing:[],research:[],aeroTestingUsage:[],technicalKnowledge:null,technicalStrategy:null,nextSeasonCar:null},
        hq:{facilityLevels:{design_centre:5},upgrades:[{id:"target_hq_upgrade"}]},
        academy:{drivers:[{driver_id:"J9"}]},
        scouting:{assignments:[],shortlist:["J8"]},
        finance_summary:{balance:6_500_000,budget:6_500_000,season_spend:50_000,season_income:500_000},
        finance_log:[{id:"target_tx",amount:500000}],
        planning:{},
        strategy_planning:{},
        economy:{season_year:1980,last_allocation:0,opening_budget:6_500_000},
        season_history:[],
        next_season_history:[],
        technology_projects:[],
        technology_unlocks:{},
        componentServiceLog:[],
        componentWearLog:[],
      },
    },
  };
  gs.driverNegotiations=[{
    id:"old_driver_talk",origin:"player",team_id:"T1",status:"submitted",
  }];
  gs.staffNegotiations=[{
    id:"old_staff_talk",origin:"player",team_id:"T1",status:"countered",
  }];

  const next=dismissPlayerManager(gs,{force:true});
  assert.equal(next.manager.current_job.status,"fired");
  assert.equal(next.manager.current_team_id,null);
  assert.equal(next.team,null);
  assert.equal(next.finances,null);
  assert.equal(next.driverNegotiations[0].status,"withdrawn");
  assert.equal(next.staffNegotiations[0].status,"withdrawn");

  const archived=next.aiTechnicalWorld.teams.T1;
  assert.ok(archived);
  assert.equal(archived.budget,2_400_000);
  assert.equal(archived.garage.cars.find((car)=>car.id==="car_1").componentCondition.gearbox,61);
  assert.equal(archived.hq.facilityLevels.design_centre,3);
  assert.equal(archived.academy.drivers[0].driver_id,"J1");
  assert.equal(archived.board.reputation,73);
  assert.equal(archived.legacy_runtime.commercialScore,81);
  assert.equal(archived.legacy_runtime.ops.pitcrew.avg_time_s,4.3);
  assert.equal(archived.legacy_runtime.rdProjectsActive[0].id,"legacy_rd");
  assert.equal(next.eventsQueue[0].done,true);
  assert.equal(next.eventsQueue[0].cancelled,true);
  assert.equal(next.eventsQueue[0].cancel_reason,"manager_departure");
  assert.equal(next.commercialScore,null);
  assert.deepEqual(next.ops,{});
  assert.deepEqual(next.rdProjectsActive,[]);
  assert.deepEqual(next.meta,{popularity:{drivers:{D1:7}}});
  assert.deepEqual(next.selectedDrivers,[]);
  assert.deepEqual(next.financeFlags,{});
  assert.equal(next.managerEmploymentState.former_team_id,"T1");
});

test("Manager job market can move control to a different team's own assets",()=>{
  let gs=baseState(playerManager({reputation:55}));
  gs.team={team_id:"T1",team_name:"Player Team",budget:2_400_000};
  gs.finances={balance:2_400_000,budget:2_400_000,season_spend:0,season_income:0};
  gs.garage={
    cars:[
      {id:"car_1",label:"Car 1",kind:"race",componentCondition:{gearbox:61},installedParts:{}},
      {id:"car_2",label:"Car 2",kind:"race",componentCondition:{gearbox:72},installedParts:{}},
    ],
    serviceJobs:[],baseComponentStock:{},
  };
  gs.development={projects:[{id:"old_project"}],parts:[],partUnits:[],manufacturing:[],research:[],aeroTestingUsage:[],technologyProjects:[]};
  gs.hq={facilityLevels:{design_centre:2},upgrades:[]};
  gs.meta={popularity:{drivers:{D1:7}}};
  gs.aiTechnicalWorld={
    version:1,
    teams:{
      T2:{
        team_id:"T2",
        budget:6_500_000,
        initial_budget:6_500_000,
        garage:{
          cars:[
            {id:"car_1",label:"Car 1",kind:"race",componentCondition:{gearbox:94},installedParts:{}},
            {id:"car_2",label:"Car 2",kind:"race",componentCondition:{gearbox:89},installedParts:{}},
          ],
          serviceJobs:[],baseComponentStock:{},
        },
        development:{projects:[{id:"target_project"}],parts:[],partUnits:[],manufacturing:[],research:[],aeroTestingUsage:[],technicalKnowledge:null,technicalStrategy:null,nextSeasonCar:null},
        hq:{facilityLevels:{design_centre:5},upgrades:[]},
        academy:{drivers:[{driver_id:"T2_JUNIOR"}]},
        scouting:{assignments:[],shortlist:["T2_TARGET"]},
        board:{reputation:64,actions:[{id:"target_board_action"}]},
        legacy_runtime:{
          commercialScore:69,
          ops:{pitcrew:{error_prob:0.02,avg_time_s:3.8}},
          rdProjectsActive:[{id:"target_legacy_rd"}],
          meta:{team:{synergy:8},popularity:{team:22}},
          selectedDrivers:["T2D1","T2D2"],
          financeFlags:{target_flag:true},
        },
        finance_summary:{balance:6_500_000,budget:6_500_000,season_spend:25_000,season_income:400_000},
        finance_log:[],
        planning:{},strategy_planning:{},
        economy:{season_year:1980,last_allocation:0,opening_budget:6_500_000},
        season_history:[],next_season_history:[],
        technology_projects:[],technology_unlocks:{},
        componentServiceLog:[],componentWearLog:[],
      },
    },
  };

  gs=dismissPlayerManager(gs,{force:true});
  const opportunity=managerJobOpportunity(gs,"T2");
  assert.equal(opportunity.available,true);

  gs=submitManagerJobApplication(gs,"T2");
  assert.equal(gs.managerJobApplications.length,1);
  const application=gs.managerJobApplications[0];
  gs={...gs,currentDateISO:application.response_date};
  gs=processManagerJobApplications(gs,{forceOutcomeById:{[application.id]:"offer"}});
  assert.equal(gs.managerJobApplications[0].status,"offer");

  gs=acceptManagerJobOffer(gs,application.id);
  assert.equal(gs.manager.current_job.status,"active");
  assert.equal(gs.manager.current_team_id,"T2");
  assert.equal(gs.team.team_id,"T2");
  assert.equal(gs.finances.balance,6_500_000);
  assert.equal(gs.hq.facilityLevels.design_centre,5);
  assert.equal(gs.development.projects[0].id,"target_project");
  assert.equal(gs.garage.cars.find((car)=>car.id==="car_1").componentCondition.gearbox,94);
  assert.equal(gs.academy.drivers[0].driver_id,"T2_JUNIOR");
  assert.equal(gs.board.reputation,64);
  assert.equal(gs.commercialScore,69);
  assert.equal(gs.ops.pitcrew.avg_time_s,3.8);
  assert.equal(gs.rdProjectsActive[0].id,"target_legacy_rd");
  assert.equal(gs.meta.team.synergy,8);
  assert.equal(gs.meta.popularity.team,22);
  assert.equal(gs.meta.popularity.drivers.D1,7);
  assert.deepEqual(gs.selectedDrivers,["T2D1","T2D2"]);
  assert.equal(gs.financeFlags.target_flag,true);
  assert.ok(gs.aiTechnicalWorld.teams.T1);
  assert.equal(gs.aiTechnicalWorld.teams.T2,undefined);
  assert.equal(gs.aiTechnicalWorld.teams.T1.hq.facilityLevels.design_centre,2);
  assert.equal(gs.manager.career_history.at(-1).team_id,"T2");
  assert.equal(gs.manager.career_history.at(-1).status,"active");
});

test("job market exposes vacancy/replacement logic without changing Save World",()=>{
  const gs=baseState(playerManager({reputation:60}));
  const dismissed=dismissPlayerManager({
    ...gs,
    garage:{cars:[],serviceJobs:[],baseComponentStock:{}},
    development:{projects:[],parts:[],partUnits:[],manufacturing:[],research:[],aeroTestingUsage:[],technologyProjects:[]},
    hq:{facilityLevels:{},upgrades:[]},
  },{force:true});
  const rows=managerJobOpportunities(dismissed);
  assert.ok(rows.some((row)=>row.team_id==="T2"));
  assert.equal(dismissed.manager.current_team_id,null);
  assert.equal(dismissed.team,null);
});

test("unemployed race autosim recognizes the scheduled race date without duplicating archived results",async()=>{
  const gs=baseState(playerManager());
  const unemployed={
    ...gs,
    currentDateISO:"1980-03-10",
    currentRound:0,
    calendar:[
      {gp_id:"gp_test",name:"Test GP",race_date:"1980-03-10"},
      {gp_id:"gp_next",name:"Next GP",race_date:"1980-03-24"},
    ],
    results:[{key:"1980_1_gp_test",year:1980,round:1,gp_id:"gp_test",classification:[]}],
    manager:{
      ...gs.manager,
      current_team_id:null,
      current_team_name:null,
      current_job:{...gs.manager.current_job,team_id:null,team_name:null,status:"fired"},
    },
    team:null,
  };
  const next=await autosimUnemployedRaceIfDue(unemployed);
  assert.equal(next.results.length,1);
  assert.equal(next.currentRound,1);
  assert.equal(next.raceWeekendState??null,null);
});


test("Manager M4 consumes official race results exactly once",()=>{
  const gs={
    ...baseState(playerManager()),
    currentDateISO:"1980-03-02",
    results:[{
      key:"1980_1_gp_test",year:1980,round:1,gp_id:"gp_test",dateISO:"1980-03-01",
      classification:[
        {position:1,driver_id:"D1",team_id:"T1",points:9,constructor_points:9,status:"Finished",retired:false},
        {position:2,driver_id:"D2",team_id:"T2",points:6,constructor_points:6,status:"Finished",retired:false},
        {position:5,driver_id:"D3",team_id:"T1",points:2,constructor_points:2,status:"Finished",retired:false},
      ],
    }],
  };

  const first=applyManagerCareerProgression(gs);
  assert.equal(first.manager.development.xp,17);
  assert.equal(first.manager.development.races_managed,1);
  assert.equal(first.manager.development.points_races,1);
  assert.equal(first.manager.development.podiums,1);
  assert.equal(first.manager.development.wins,1);
  assert.equal(first.manager.reputation,35.25);
  assert.deepEqual(
    first.manager.achievements.map((row)=>row.id),
    ["manager_first_points","manager_first_podium","manager_first_win"]
  );
  assert.deepEqual(first.manager.development.processed_result_keys,["1980_1_gp_test"]);

  const second=applyManagerCareerProgression(first);
  assert.equal(second.manager.development.xp,17);
  assert.equal(second.manager.development.races_managed,1);
  assert.equal(second.manager.achievements.length,3);
});

test("Manager M4 levels from XP and preserves background-shaped growth",()=>{
  const manager=playerManager({
    development:{xp:95,level:1},
  });
  const gs={
    ...baseState(manager),
    results:[{
      key:"1980_1_level",year:1980,round:1,dateISO:"1980-03-01",
      classification:[
        {position:1,driver_id:"D1",team_id:"T1",points:9,constructor_points:9,status:"Finished"},
        {position:2,driver_id:"D2",team_id:"T2",points:6,constructor_points:6,status:"Finished"},
      ],
    }],
  };
  const next=applyManagerCareerProgression(gs);
  assert.equal(next.manager.development.xp,112);
  assert.equal(next.manager.development.level,2);
  assert.equal(next.manager.attributes.leadership,51);
  assert.equal(next.manager.attributes.personnel,50);
  assert.ok(next.manager.attributes.leadership<=next.manager.potential);
});

test("Manager M4 attributes results to the team actually managed on the race date",()=>{
  const manager=playerManager({
    current_team_id:"T2",
    current_team_name:"AI Team",
    current_job:{
      team_id:"T2",team_name:"AI Team",role:"Team Principal",
      joined_at:"1980-07-01",start_year:1980,contract_until_year:1982,status:"active",
    },
    career_history:[
      {
        team_id:"T1",team_name:"Player Team",role:"Team Principal",
        joined_at:"1980-01-01",start_year:1980,end_year:1980,
        ended_at:"1980-05-31",status:"fired",
      },
      {
        team_id:"T2",team_name:"AI Team",role:"Team Principal",
        joined_at:"1980-07-01",start_year:1980,end_year:null,status:"active",
      },
    ],
  });
  const race=(key,date,teamId)=>({
    key,year:1980,dateISO:date,
    classification:[
      {position:1,driver_id:key+"_a",team_id:teamId,points:9,constructor_points:9,status:"Finished"},
      {position:2,driver_id:key+"_b",team_id:teamId==="T1"?"T2":"T1",points:6,constructor_points:6,status:"Finished"},
    ],
  });
  const gs={
    ...baseState(manager),
    team:{team_id:"T2",team_name:"AI Team"},
    results:[
      {...race("old_team","1980-04-01","T1"),round:1},
      {...race("unemployed_gap","1980-06-15","T1"),round:2},
      {...race("new_team","1980-08-01","T2"),round:3},
    ],
  };
  const next=applyManagerCareerProgression(gs);
  assert.equal(next.manager.development.races_managed,2);
  assert.equal(next.manager.development.wins,2);
  assert.equal(next.manager.development.processed_result_keys.length,3);
});

test("Manager M4 records completed Save World championships as career achievements",()=>{
  const gs={
    ...baseState(playerManager()),
    currentDateISO:"1980-10-01",
    calendar:[{round:1},{round:2}],
    results:[
      {
        key:"1980_1",year:1980,round:1,dateISO:"1980-09-01",
        classification:[
          {position:1,driver_id:"D1",team_id:"T1",points:9,constructor_points:9,status:"Finished"},
          {position:2,driver_id:"D2",team_id:"T2",points:6,constructor_points:6,status:"Finished"},
        ],
      },
      {
        key:"1980_2",year:1980,round:2,dateISO:"1980-09-20",
        classification:[
          {position:1,driver_id:"D1",team_id:"T1",points:9,constructor_points:9,status:"Finished"},
          {position:2,driver_id:"D2",team_id:"T2",points:6,constructor_points:6,status:"Finished"},
        ],
      },
    ],
    standings:{
      teams:[
        {team_id:"T1",team_name:"Player Team",position:1,points:18},
        {team_id:"T2",team_name:"AI Team",position:2,points:12},
      ],
      drivers:[
        {driver_id:"D1",team_id:"T1",position:1,points:18},
        {driver_id:"D2",team_id:"T2",position:2,points:12},
      ],
    },
  };
  const next=applyManagerCareerProgression(gs);
  assert.equal(next.manager.development.constructor_titles,1);
  assert.equal(next.manager.development.driver_titles,1);
  assert.ok(next.manager.development.processed_seasons.includes(1980));
  assert.ok(next.manager.achievements.some((row)=>row.id==="manager_constructor_title_1980_T1"));
  assert.ok(next.manager.achievements.some((row)=>row.id==="manager_driver_title_1980_D1"));
  assert.equal(next.manager.development.xp,134);
  assert.equal(next.manager.development.level,2);
});

test("Manager M4 progression ledger survives manager profile normalization",()=>{
  const original=playerManager({
    development:{
      xp:245,level:3,last_progression_at:"1981-07-01",
      processed_result_keys:["1980_1","1980_2"],
      processed_seasons:[1980],
      races_managed:20,points_races:12,podiums:5,wins:2,
      constructor_titles:1,driver_titles:1,
    },
  });
  const normalized=createManagerProfile(original,{year:1981,team:{team_id:"T1",team_name:"Player Team"}});
  assert.equal(normalized.development.xp,245);
  assert.equal(normalized.development.level,3);
  assert.deepEqual(normalized.development.processed_result_keys,["1980_1","1980_2"]);
  assert.deepEqual(normalized.development.processed_seasons,[1980]);
  assert.equal(normalized.development.races_managed,20);
  assert.equal(normalized.development.constructor_titles,1);
});


test("Manager M4 does not award a championship after leaving before the finale",()=>{
  const baseManager=playerManager();
  const manager={
    ...baseManager,
    current_team_id:null,
    current_team_name:null,
    current_job:{
      ...baseManager.current_job,
      team_id:null,
      team_name:null,
      status:"fired",
      ended_at:"1980-05-31",
      end_year:1980,
    },
    career_history:[{
      team_id:"T1",team_name:"Player Team",role:"Team Principal",
      joined_at:"1980-01-01",start_year:1980,end_year:1980,
      ended_at:"1980-05-31",status:"fired",
    }],
  };
  const gs={
    ...baseState(manager),
    team:null,
    currentDateISO:"1980-10-01",
    calendar:[{round:1},{round:2}],
    results:[
      {
        key:"1980_1_managed",year:1980,round:1,dateISO:"1980-04-01",
        classification:[
          {position:1,driver_id:"D1",team_id:"T1",points:9,constructor_points:9,status:"Finished"},
          {position:2,driver_id:"D2",team_id:"T2",points:6,constructor_points:6,status:"Finished"},
        ],
      },
      {
        key:"1980_2_after_departure",year:1980,round:2,dateISO:"1980-09-20",
        classification:[
          {position:1,driver_id:"D1",team_id:"T1",points:9,constructor_points:9,status:"Finished"},
          {position:2,driver_id:"D2",team_id:"T2",points:6,constructor_points:6,status:"Finished"},
        ],
      },
    ],
    standings:{
      teams:[
        {team_id:"T1",team_name:"Player Team",position:1,points:18},
        {team_id:"T2",team_name:"AI Team",position:2,points:12},
      ],
      drivers:[
        {driver_id:"D1",team_id:"T1",position:1,points:18},
        {driver_id:"D2",team_id:"T2",position:2,points:12},
      ],
    },
  };
  const next=applyManagerCareerProgression(gs);
  assert.equal(next.manager.development.races_managed,1);
  assert.equal(next.manager.development.constructor_titles,0);
  assert.equal(next.manager.development.driver_titles,0);
  assert.ok(next.manager.development.processed_seasons.includes(1980));
  assert.equal(next.manager.achievements.some((row)=>row.type==="constructor_champion"),false);
  assert.equal(next.manager.achievements.some((row)=>row.type==="driver_champion"),false);
});


function poorManagerRace(round){
  return {
    key:`1980_${round}_manager_balance_poor`,
    year:1980,
    round,
    dateISO:`1980-${String(Math.min(12,round+2)).padStart(2,"0")}-01`,
    classification:[
      {team_id:"T2",driver_id:`T2_${round}`,position:1,points:9,constructor_points:9,status:"Finished",retired:false},
      {team_id:"T1",driver_id:`T1_${round}`,position:10,points:0,constructor_points:0,status:"Finished",retired:false},
    ],
  };
}

function unemployedManager(overrides={}){
  const employed=playerManager(overrides);
  return {
    ...employed,
    current_team_id:null,
    current_team_name:null,
    current_job:{
      ...employed.current_job,
      team_id:null,
      team_name:null,
      status:"fired",
    },
  };
}

test("Manager balance protects the opening races even under catastrophic results",()=>{
  const gs={
    ...baseState(playerManager()),
    currentDateISO:"1980-06-01",
    results:Array.from({length:4},(_,index)=>poorManagerRace(index+1)),
  };
  const assessment=managerEmploymentAssessment(gs);
  assert.equal(assessment.status,"under_pressure");
  assert.equal(assessment.canBeDismissed,false);

  const next=processManagerCareerTick(gs);
  assert.equal(next.manager.current_job.status,"active");
  assert.equal(next.managerEmploymentState.pressure_streak,1);
});

test("Manager balance requires sustained critical performance before dismissal",()=>{
  let gs={
    ...baseState(playerManager()),
    currentDateISO:"1980-08-01",
    results:Array.from({length:6},(_,index)=>poorManagerRace(index+1)),
  };

  gs=processManagerCareerTick(gs);
  assert.equal(gs.manager.current_job.status,"active");
  assert.equal(gs.managerEmploymentState.last_status,"critical");
  assert.equal(gs.managerEmploymentState.critical_streak,1);

  gs={
    ...gs,
    currentDateISO:"1980-09-01",
    results:[...gs.results,poorManagerRace(7)],
  };
  gs=processManagerCareerTick(gs);

  assert.equal(gs.manager.current_job.status,"fired");
  assert.equal(gs.manager.current_team_id,null);
  assert.equal(gs.managerEmploymentState.dismissal_reason,"board_dismissal");
});

test("Manager balance resets dismissal pressure after a genuine performance recovery",()=>{
  let gs={
    ...baseState(playerManager()),
    currentDateISO:"1980-08-01",
    results:Array.from({length:6},(_,index)=>poorManagerRace(index+1)),
  };
  gs=processManagerCareerTick(gs);
  assert.equal(gs.managerEmploymentState.critical_streak,1);

  const recovery={
    key:"1980_7_manager_balance_recovery",
    year:1980,
    round:7,
    dateISO:"1980-09-01",
    classification:[
      {team_id:"T1",driver_id:"T1_RECOVERY",position:1,points:9,constructor_points:9,status:"Finished",retired:false},
      {team_id:"T2",driver_id:"T2_RECOVERY",position:2,points:6,constructor_points:6,status:"Finished",retired:false},
    ],
  };
  gs={
    ...gs,
    currentDateISO:"1980-09-02",
    results:[...gs.results,recovery],
    standings:{
      ...gs.standings,
      teams:[
        {team_id:"T1",position:1,points:9},
        {team_id:"T2",position:2,points:60},
      ],
    },
  };
  gs=processManagerCareerTick(gs);

  assert.equal(gs.manager.current_job.status,"active");
  assert.equal(gs.managerEmploymentState.last_status,"secure");
  assert.equal(gs.managerEmploymentState.critical_streak,0);
  assert.equal(gs.managerEmploymentState.pressure_streak,0);
});

test("Manager contract expiry does not renew a manager below the Board security threshold",()=>{
  const manager=playerManager();
  const gs={
    ...baseState({
      ...manager,
      current_job:{...manager.current_job,contract_until_year:1981,status:"active"},
      career_history:(manager.career_history||[]).map((row)=>({...row,contract_until_year:1981})),
    }),
    activeYear:1982,
    currentDateISO:"1982-01-02",
    managerEmploymentState:{
      status:"active",
      last_security:44,
      last_evaluated_races:14,
      critical_streak:0,
      pressure_streak:0,
    },
  };

  const next=processManagerCareerTick(gs);
  assert.equal(next.manager.current_job.status,"contract_ended");
  assert.equal(next.manager.current_team_id,null);
  assert.equal(next.managerEmploymentState.dismissal_reason,"contract_not_renewed");
});

test("Manager Job Market opens plausible vacancies but blocks prestige jumps and former-team cooling off",()=>{
  const manager=unemployedManager({reputation:35});
  const base={
    ...baseState(manager),
    team:null,
    managerEmploymentState:{status:"unemployed"},
    teamReputationState:{
      T1:{reputation:30},
      T2:{reputation:50},
    },
    // Represent the Team Principal role elsewhere in the same era so T2's
    // missing incumbent is a real Save World vacancy, not missing source data.
    staffRatings:[{
      year:1980,staff_id:"TP1",reputation:40,
      leadership:40,conflict_management:40,negotiation:40,budget_management:40,
      motivation:40,communication:40,strategy:40,technical:40,
    }],
    staffContracts:[{
      year:1980,team_id:"T1",staff_id:"TP1",staff_name:"Recorded Principal",
      role:"team_principal",status:"active",
      contract_start_year:1979,contract_until_year:1982,
    }],
  };

  const plausible=managerJobOpportunity(base,"T2");
  assert.equal(plausible.vacancy,true);
  assert.equal(plausible.available,true);

  const prestige=managerJobOpportunity({
    ...base,
    teamReputationState:{...base.teamReputationState,T2:{reputation:68}},
  },"T2");
  assert.equal(prestige.available,false);
  assert.equal(prestige.reason,"Team prestige currently beyond Manager standing");

  const coolingBase={
    ...base,
    manager:unemployedManager({reputation:60}),
    currentDateISO:"1980-03-30",
    managerEmploymentState:{
      status:"unemployed",
      former_team_id:"T1",
      unemployed_since:"1980-01-01",
    },
  };
  const cooling=managerJobOpportunity(coolingBase,"T1");
  assert.equal(cooling.available,false);
  assert.equal(cooling.reason,"Cooling-off period after leaving team");

  const eligibleAgain=managerJobOpportunity({
    ...coolingBase,
    currentDateISO:"1980-03-31",
  },"T1");
  assert.equal(eligibleAgain.available,true);
});

test("Manager Job Market only challenges a comparable incumbent when contract timing supports it",()=>{
  const manager=unemployedManager({reputation:45});
  const incumbentRating={
    year:1980,
    staff_id:"TP2",
    reputation:51,
    leadership:51,
    conflict_management:51,
    negotiation:51,
    budget_management:51,
    motivation:51,
    communication:51,
    strategy:51,
    technical:51,
  };
  const base={
    ...baseState(manager),
    team:null,
    managerEmploymentState:{status:"unemployed"},
    teamReputationState:{T2:{reputation:45}},
    staffRatings:[incumbentRating],
    staffContracts:[{
      year:1979,
      team_id:"T2",
      staff_id:"TP2",
      staff_name:"Comparable Principal",
      role:"team_principal",
      status:"active",
      contract_start_year:1979,
      contract_until_year:1982,
    }],
  };

  const protectedIncumbent=managerJobOpportunity(base,"T2");
  assert.equal(protectedIncumbent.vacancy,false);
  assert.equal(protectedIncumbent.incumbent_expiring,false);
  assert.equal(protectedIncumbent.available,false);

  const expiring=managerJobOpportunity({
    ...base,
    staffContracts:base.staffContracts.map((row)=>({...row,contract_until_year:1980})),
  },"T2");
  assert.equal(expiring.incumbent_expiring,true);
  assert.equal(expiring.replace_incumbent,true);
  assert.equal(expiring.available,true);
});
