import test from "node:test";
import assert from "node:assert/strict";

import { createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "../src/core/saveSafety.js";
import {
  completePracticeSession,
  completeQualifyingSession,
  completeRaceSession,
  createRaceWeekendState,
  raceWeekendSchedule,
  setPracticeProgramme,
  syncRaceWeekendPhaseForDate,
} from "../src/engine/RaceWeekendEngine.js";
import { PRACTICE_PROGRAMMES, teamEngineeringSupport, trackSetupProfile } from "../src/engine/PracticeSetupEngine.js";
import { conditionModifier } from "../src/domain/driverPerformance.js";

const gp={
  gp_id:"monaco",
  gp_name:"Monaco Grand Prix",
  year:1980,
  race_date:"1980-05-18",
  dateISO:"1980-05-18",
  track_id:"monaco",
};

function fixture(){
  const teams=[
    {team_id:"T1",team_name:"Alpha"},
    {team_id:"T2",team_name:"Beta"},
  ];
  const drivers=[
    {driver_id:"D1",display_name:"Alpha One"},
    {driver_id:"D2",display_name:"Alpha Two"},
    {driver_id:"D3",display_name:"Beta One"},
    {driver_id:"D4",display_name:"Beta Two"},
  ];
  return {
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed:"rw1-weekend"}),
    activeYear:1980,
    currentDateISO:"1980-05-16",
    currentRound:0,
    calendar:[gp],
    team:teams[0],
    teams,
    drivers,
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"main_driver",status:"active",contract_start_year:1980,contract_until_year:1980},
      {year:1980,team_id:"T1",driver_id:"D2",role:"second_driver",status:"active",contract_start_year:1980,contract_until_year:1980},
      {year:1980,team_id:"T2",driver_id:"D3",role:"main_driver",status:"active",contract_start_year:1980,contract_until_year:1980},
      {year:1980,team_id:"T2",driver_id:"D4",role:"second_driver",status:"active",contract_start_year:1980,contract_until_year:1980},
    ],
    driverRatings:drivers.map((driver,index)=>({
      driver_id:driver.driver_id,
      pace:82-index,
      qualifying:84-index,
      racecraft:80-index,
      consistency:76,
      pressure_handling:75,
      adaptability:74,
      mentality:74,
      current_ability:80-index,
      start_launch:72,
      tire_management:72,
      race_intelligence:74,
      crash_likelihood:10,
      technical_feedback:78-index,
    })),
    driverAttributes:{},
    driverAvailability:{},
    medicalHistory:[],
    temporaryDriverAssignments:[],
    standings:{drivers:[],teams:[]},
    results:[],
    inbox:[],
    financeLog:[],
    finances:{balance:1_000_000,budget:1_000_000,season_spend:0,season_income:0},
    settings:{gameplay:{enableInjuryRandomEvents:true,enableFatalities:false}},
    pointsSystem:{table:[9,6,4,3]},
    carStats:[
      {year:1980,team_id:"T1",chassis_spec:80,aero_spec:82,gearbox_spec:80,suspension_spec:80,brakes_spec:80,reliability:92},
      {year:1980,team_id:"T2",chassis_spec:76,aero_spec:77,gearbox_spec:76,suspension_spec:76,brakes_spec:76,reliability:90},
    ],
    teamEngines:[
      {year:1980,team_id:"T1",power:82,reliability:94},
      {year:1980,team_id:"T2",power:78,reliability:92},
    ],
    facilities:[],
    sponsorsContracts:[],
    accidentModel:[{year:1980,damage_DNF_prob:0.08,injury_prob:0.02,fatality_prob:0.002}],
    eraSafety:[{year:1980,era_safety_index:0.42,car_safety:0.5,medical_response:0.6,marshals_quality:0.55}],
    staffContracts:[
      {year:1980,team_id:"T1",staff_id:"S1",role:"chief_engineer",contract_start:1979,contract_until:1982},
      {year:1980,team_id:"T2",staff_id:"S2",role:"chief_engineer",contract_start:1979,contract_until:1982},
    ],
    staffRatings:[
      {year:1980,staff_id:"S1",technical:92,data_analysis:88,communication:80,reliability_focus:90},
      {year:1980,staff_id:"S2",technical:62,data_analysis:60,communication:65,reliability_focus:62},
    ],
    coreTracks:[{
      track_id:"monaco",track_name:"Monaco",crash_risk:78,overtaking_difficulty:88,tyre_wear:62,lap_length_km:3.34,
    }],
    trackLayoutByYear:[{track_id:"monaco",year_from:1973,year_to:1985,lap_length_km:3.34,laps:76}],
    development:{
      parts:[
        {id:"P1",slot:"aero_front",perf:4,condition:100},
        {id:"P2",slot:"aero_front",perf:4,condition:100},
      ],
      projects:[],research:[],
    },
    garage:{
      cars:[
        {id:"car_1",kind:"race",driver_id:"D1",installedParts:{aero_front:"P1"}},
        {id:"car_2",kind:"race",driver_id:"D2",installedParts:{aero_front:"P2"}},
        {id:"car_spare",kind:"reserve",driver_id:null,installedParts:{}},
      ],
    },
  };
}

test("RW1 derives Friday Practice, Saturday Qualifying and Sunday Race dates",()=>{
  assert.deepEqual(raceWeekendSchedule(gp),{
    practiceDate:"1980-05-16",
    qualifyingDate:"1980-05-17",
    raceDate:"1980-05-18",
  });
});

test("race weekend state persists across session boundaries and save/load",()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  assert.equal(gs.raceWeekendState.phase,"practice");
  assert.equal(gs.raceWeekendState.entrants.length,4);

  gs=completePracticeSession(gs);
  assert.equal(gs.raceWeekendState.phase,"practice_complete");
  assert.equal(gs.raceWeekendState.practice.status,"completed");

  const saved=prepareGameStateForSave(gs);
  const loaded=extractGameStateFromStoredSave({meta:{name:"RW1 mid-weekend"},gameState:saved});
  assert.deepEqual(loaded.raceWeekendState,gs.raceWeekendState);
  assert.deepEqual(loaded.raceEntryState,gs.raceEntryState);
});

test("Practice -> Qualifying -> Grid -> Race uses one persistent qualifying classification",async()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  gs=completePracticeSession(gs);

  gs={...gs,currentDateISO:"1980-05-17"};
  gs=syncRaceWeekendPhaseForDate(gs,gs.currentDateISO);
  assert.equal(gs.raceWeekendState.phase,"qualifying");

  gs=completeQualifyingSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"grid_ready");
  const grid=gs.raceWeekendState.qualifying.classification.map((row)=>row.driver_id);
  assert.equal(grid.length,4);
  assert.deepEqual(gs.raceWeekendState.grid.map((row)=>row.driver_id),grid);

  gs={...gs,currentDateISO:"1980-05-18"};
  gs=syncRaceWeekendPhaseForDate(gs,gs.currentDateISO);
  assert.equal(gs.raceWeekendState.phase,"race");

  gs=await completeRaceSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"results");
  assert.equal(gs.results.length,1);
  assert.deepEqual(gs.results[0].qualifying.map((row)=>row.driver_id),grid,"Race must consume the already-saved Qualifying order");
  assert.equal(gs.results[0].classification.length,4);
});

test("results remain visible until calendar advances beyond race day",async()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  gs=completePracticeSession(gs);
  gs=syncRaceWeekendPhaseForDate({...gs,currentDateISO:"1980-05-17"},"1980-05-17");
  gs=completeQualifyingSession(gs,{gp});
  gs=syncRaceWeekendPhaseForDate({...gs,currentDateISO:"1980-05-18"},"1980-05-18");
  gs=await completeRaceSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"results");

  const sameDay=syncRaceWeekendPhaseForDate(gs,"1980-05-18");
  assert.equal(sameDay.raceWeekendState.phase,"results");
  const nextDay=syncRaceWeekendPhaseForDate({...gs,currentDateISO:"1980-05-19"},"1980-05-19");
  assert.equal(nextDay.raceWeekendState.phase,"completed");
});


test("RW2 derives circuit setup demands and uses live technical staff support",()=>{
  const gs=fixture();
  const profile=trackSetupProfile(gs,gp);
  assert.equal(profile.source,"derived_gameplay_profile");
  assert.equal(profile.inputs.crash_risk,78);
  assert.equal(profile.inputs.overtaking_difficulty,88);
  assert.notEqual(profile.target.aeroBalance,50);
  assert.ok(teamEngineeringSupport(gs,"T1")>teamEngineeringSupport(gs,"T2"));
});

test("RW2 player Practice programmes create setup knowledge, Preparation, fatigue and differentiated wear",()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  gs=setPracticeProgramme(gs,{driverId:"D1",programmeId:"reliability"});
  gs=setPracticeProgramme(gs,{driverId:"D2",programmeId:"race"});

  const beforeD1=conditionModifier(gs,"D1");
  const beforeP1=gs.development.parts.find((p)=>p.id==="P1").condition;
  const beforeP2=gs.development.parts.find((p)=>p.id==="P2").condition;

  gs=completePracticeSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"practice_complete");
  const d1=gs.raceWeekendState.practice.results.find((row)=>row.driver_id==="D1");
  const d2=gs.raceWeekendState.practice.results.find((row)=>row.driver_id==="D2");
  assert.equal(d1.programme_id,"reliability");
  assert.equal(d2.programme_id,"race");
  assert.ok(d1.setup_knowledge>0);
  assert.ok(d1.setup_quality>=25&&d1.setup_quality<=100);
  assert.ok(d1.preparation_gain>0);
  assert.ok(gs.driverAttributes.D1.preparation>50);
  assert.ok(gs.driverAttributes.D1.fatigue>0);
  assert.ok(conditionModifier(gs,"D1")>beforeD1,"Preparation should now improve live driver performance");

  const afterP1=gs.development.parts.find((p)=>p.id==="P1").condition;
  const afterP2=gs.development.parts.find((p)=>p.id==="P2").condition;
  assert.ok(afterP1<beforeP1,"Practice should wear installed components");
  assert.ok(afterP2<beforeP2,"Practice should wear installed components");
  assert.ok((beforeP2-afterP2)>(beforeP1-afterP1),"Race Focus should create more Practice wear than Reliability Focus");
});

test("RW2 AI teams use the same Practice programme catalogue without player-only bonuses",()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  gs=setPracticeProgramme(gs,{driverId:"D1",programmeId:"qualifying"});
  gs=completePracticeSession(gs,{gp});

  const player=gs.raceWeekendState.practice.results.find((row)=>row.driver_id==="D1");
  const ai=gs.raceWeekendState.practice.results.find((row)=>row.driver_id==="D3");
  assert.equal(player.programme_id,"qualifying");
  assert.ok(Object.prototype.hasOwnProperty.call(PRACTICE_PROGRAMMES,ai.programme_id));
  assert.ok(Number.isFinite(ai.setup_quality));
  assert.ok(Number.isFinite(ai.setup_knowledge));
  assert.ok(Number.isFinite(ai.engineering_support));
});

test("RW2 Practice state survives save/load with programme selections and setup results",()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  gs=setPracticeProgramme(gs,{driverId:"D1",programmeId:"setup"});
  gs=completePracticeSession(gs,{gp});

  const saved=prepareGameStateForSave(gs);
  const loaded=extractGameStateFromStoredSave({meta:{name:"RW2 Practice"},gameState:saved});
  assert.equal(loaded.raceWeekendState.practice_selections.D1,"setup");
  assert.deepEqual(loaded.raceWeekendState.practice,gs.raceWeekendState.practice);
  assert.equal(loaded.driverAttributes.D1.preparation,gs.driverAttributes.D1.preparation);
});
