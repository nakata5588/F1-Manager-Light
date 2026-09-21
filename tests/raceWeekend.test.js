import test from "node:test";
import assert from "node:assert/strict";

import { createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "../src/core/saveSafety.js";
import {
  completePracticeSession,
  completeQualifyingSession,
  completeRaceSession,
  createRaceWeekendState,
  raceWeekendSchedule,
  syncRaceWeekendPhaseForDate,
} from "../src/engine/RaceWeekendEngine.js";

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
    development:{parts:[],projects:[],research:[]},
    garage:null,
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
