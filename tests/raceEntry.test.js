import test from "node:test";
import assert from "node:assert/strict";

import {
  activeRaceContracts,
  buildRaceEntryState,
  isDriverAvailableForRace,
  raceEntryDriverIds,
} from "../src/domain/raceEntry.js";
import { runRaceWeekend } from "../src/engine/GPEngine.js";
import { createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "../src/core/saveSafety.js";
import { syncGarageState } from "../src/domain/garage.js";
import { queueWorkshopJob, standardRestoreQuote } from "../src/domain/componentService.js";

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
    {driver_id:"D5",display_name:"Alpha Test"},
    {driver_id:"D6",display_name:"Future Driver"},
    {driver_id:"D7",display_name:"Alpha Reserve"},
  ];
  const contracts=[
    {year:1980,team_id:"T1",driver_id:"D1",role:"main_driver",contract_start_year:1980,contract_until_year:1980},
    {year:1980,team_id:"T1",driver_id:"D2",role:"second_driver",contract_start_year:1980,contract_until_year:1980},
    {year:1980,team_id:"T1",driver_id:"D5",role:"test_driver",contract_start_year:1980,contract_until_year:1980},
    {year:1980,team_id:"T2",driver_id:"D3",role:"main_driver",contract_start_year:1980,contract_until_year:1980},
    {year:1980,team_id:"T2",driver_id:"D4",role:"second_driver",contract_start_year:1980,contract_until_year:1980},
    {year:1980,team_id:"T1",driver_id:"D7",role:"reserve_driver",contract_start_year:1980,contract_until_year:1980},
    {year:1981,team_id:"T1",driver_id:"D6",role:"second_driver",contract_start_year:1981,contract_until_year:1981},
  ];
  return {
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed:"race-entry-stage-18"}),
    activeYear:1980,
    currentDateISO:"1980-05-18",
    currentRound:4,
    team:teams[0],
    teams,
    drivers,
    contracts,
    driverRatings:drivers.map((d,index)=>({
      driver_id:d.driver_id,
      pace:80-index,
      qualifying:80-index,
      racecraft:78-index,
      consistency:75,
      pressure_handling:75,
      adaptability:72,
      mentality:74,
      current_ability:78-index,
      start_launch:70,
      tire_management:72,
      race_intelligence:73,
      crash_likelihood:15,
    })),
    standings:{drivers:[],teams:[]},
    results:[],
    inbox:[],
    financeLog:[],
    driverAttributes:{},
    pointsSystem:{table:[9,6,4,3]},
    carStats:[
      {year:1980,team_id:"T1",chassis_spec:80,aero_spec:80,gearbox_spec:78,suspension_spec:79,brakes_spec:78,reliability:92},
      {year:1980,team_id:"T2",chassis_spec:76,aero_spec:76,gearbox_spec:75,suspension_spec:75,brakes_spec:75,reliability:90},
    ],
    teamEngines:[
      {year:1980,team_id:"T1",power:82,reliability:94},
      {year:1980,team_id:"T2",power:78,reliability:92},
    ],
    accidentModel:[{year:1980,damage_DNF_prob:0.08}],
    sponsorsContracts:[],
  };
}

const gp={gp_id:"monaco",gp_name:"Monaco Grand Prix",year:1980,race_date:"1980-05-18"};

test("race-entry builder uses only current race-driver contracts",()=>{
  const gs=fixture();
  const t1=activeRaceContracts(gs,"T1");
  assert.deepEqual(t1.map((c)=>c.driver_id),["D1","D2"]);

  const state=buildRaceEntryState(gs,{gp,roundIndex:4});
  assert.equal(state.gp_id,"monaco");
  assert.equal(state.round,5);
  assert.deepEqual(raceEntryDriverIds(state).sort(),["D1","D2","D3","D4"]);
  assert.equal(state.entries.some((e)=>e.driver_id==="D5"),false,"test driver must not enter");
  assert.equal(state.entries.some((e)=>e.driver_id==="D6"),false,"future contract must not enter");
});

test("unavailable contracted driver uses reserve driver when available",()=>{
  const gs=fixture();
  gs.driverAvailability={
    D2:{
      status:"injured",
      reason:"wrist injury",
      unavailableFrom:"1980-05-01",
      expectedReturnDate:"1980-06-01",
    },
  };

  assert.equal(isDriverAvailableForRace(gs,"D2",gp),false);
  const state=buildRaceEntryState(gs,{gp,roundIndex:4});
  const slot=state.entries.find((e)=>e.team_id==="T1"&&e.car_slot===2);
  assert.equal(slot.contracted_driver_id,"D2");
  assert.equal(slot.driver_id,"D7");
  assert.equal(slot.entry_type,"reserve_replacement");
  assert.equal(slot.replacement_for_driver_id,"D2");
  assert.equal(slot.status,"confirmed");
  assert.equal(slot.availability_status,"injured");
  assert.equal(slot.availability_reason,"wrist injury");
});

test("unavailable contracted driver leaves a vacancy when no reserve exists",()=>{
  const gs=fixture();
  gs.contracts=gs.contracts.filter((c)=>c.role!=="reserve_driver");
  gs.driverAvailability={
    D2:{status:"injured",reason:"wrist injury",unavailableFrom:"1980-05-01",expectedReturnDate:"1980-06-01"},
  };
  const state=buildRaceEntryState(gs,{gp,roundIndex:4});
  const slot=state.entries.find((e)=>e.team_id==="T1"&&e.car_slot===2);
  assert.equal(slot.driver_id,null);
  assert.equal(slot.status,"vacant");
});

test("availability windows do not block races outside the unavailable dates",()=>{
  const gs=fixture();
  gs.driverAvailability={
    D2:{
      status:"injured",
      unavailableFrom:"1980-05-01",
      expectedReturnDate:"1980-06-01",
    },
  };
  assert.equal(isDriverAvailableForRace(gs,"D2",{...gp,race_date:"1980-06-15"}),true);
});

test("GP engine consumes race entries instead of every driver contract",async()=>{
  const gs=fixture();
  gs.driverAvailability={
    D2:{status:"suspended",reason:"one-race suspension"},
  };

  // Legacy/incomplete saves can have authoritative standings without detailed
  // result rows for every earlier GP. Those carried points must survive.
  gs.standings.drivers=[
    {driver_id:"D1",name:"Alpha One",team_id:"T1",points:4,position:2},
    {driver_id:"D2",name:"Alpha Two",team_id:"T1",points:5,position:1},
  ];
  gs.standings.teams=[
    {team_id:"T1",team_name:"Alpha",points:7,position:1},
  ];

  const next=await runRaceWeekend(gs,{roundIndex:4,gp});
  assert.ok(next.raceEntryState);
  assert.deepEqual(raceEntryDriverIds(next.raceEntryState).sort(),["D1","D3","D4","D7"]);

  const classification=next.results[0].classification;
  const classified=new Set(classification.map((row)=>String(row.driver_id)));
  assert.equal(classified.has("D1"),true);
  assert.equal(classified.has("D3"),true);
  assert.equal(classified.has("D4"),true);
  assert.equal(classified.has("D7"),true,"reserve driver should replace unavailable race driver");
  assert.equal(classified.has("D2"),false,"unavailable driver must not race");
  assert.equal(classified.has("D5"),false,"test driver must not race");

  const d1RacePoints=Number(classification.find((row)=>row.driver_id==="D1")?.points||0);
  assert.equal(
    next.standings.drivers.find((row)=>row.driver_id==="D1")?.points,
    4+d1RacePoints,
    "a driver who races must add the current result to carried standings points when old result rows are missing"
  );
  assert.equal(
    next.standings.drivers.find((row)=>row.driver_id==="D2")?.points,
    5,
    "missing a GP must not remove championship points"
  );

  const t1RacePoints=classification
    .filter((row)=>row.team_id==="T1")
    .reduce((sum,row)=>sum+Number(row.constructor_points||0),0);
  assert.equal(
    next.standings.teams.find((row)=>row.team_id==="T1")?.points,
    7+t1RacePoints,
    "constructor standings must preserve the same carried Save World baseline"
  );
  assert.deepEqual(next.results[0].raceEntry,next.raceEntryState.entries);
});

test("complete result history is not double-counted when standings already match it",async()=>{
  const gs=fixture();
  gs.results=[{
    key:"1980_4_prior",
    year:1980,
    round:4,
    gp_id:"prior",
    classification:[
      {driver_id:"D1",team_id:"T1",points:9,constructor_points:9},
      {driver_id:"D2",team_id:"T1",points:6,constructor_points:6},
      {driver_id:"D3",team_id:"T2",points:4,constructor_points:4},
      {driver_id:"D4",team_id:"T2",points:3,constructor_points:3},
    ],
  }];
  gs.standings.drivers=[
    {driver_id:"D1",name:"Alpha One",team_id:"T1",points:9,position:1},
    {driver_id:"D2",name:"Alpha Two",team_id:"T1",points:6,position:2},
  ];
  gs.standings.teams=[
    {team_id:"T1",team_name:"Alpha",points:15,position:1},
    {team_id:"T2",team_name:"Beta",points:7,position:2},
  ];

  const next=await runRaceWeekend(gs,{roundIndex:4,gp});
  const current=next.results.find((row)=>row.gp_id==="monaco").classification;
  const d1RacePoints=Number(current.find((row)=>row.driver_id==="D1")?.points||0);
  const t1RacePoints=current
    .filter((row)=>row.team_id==="T1")
    .reduce((sum,row)=>sum+Number(row.constructor_points||0),0);

  assert.equal(next.standings.drivers.find((row)=>row.driver_id==="D1")?.points,9+d1RacePoints);
  assert.equal(next.standings.teams.find((row)=>row.team_id==="T1")?.points,15+t1RacePoints);
});

test("race-entry and availability state survive save/load round-trip",()=>{
  const gs=fixture();
  gs.driverAvailability={
    D2:{status:"injured",reason:"wrist injury",unavailableFrom:"1980-05-01",expectedReturnDate:"1980-06-01"},
  };
  gs.raceEntryState=buildRaceEntryState(gs,{gp,roundIndex:4});

  const saved=prepareGameStateForSave(gs);
  const loaded=extractGameStateFromStoredSave({meta:{name:"Stage 18"},gameState:saved});

  assert.deepEqual(loaded.driverAvailability,gs.driverAvailability);
  assert.deepEqual(loaded.raceEntryState,gs.raceEntryState);
});


function withMaterializedPlayerGarage(gs){
  const garage=syncGarageState(gs,{});
  return {...gs,garage};
}

test("a non-raceworthy car is withdrawn from the GP when no Reserve Car exists",()=>{
  let gs=withMaterializedPlayerGarage(fixture());
  gs={
    ...gs,
    garage:{
      ...gs.garage,
      cars:gs.garage.cars.map((car)=>car.id==="car_1"?{
        ...car,
        componentCondition:{...(car.componentCondition||{}),chassis:18,suspension:22},
      }:car),
    },
  };

  const state=buildRaceEntryState(gs,{gp,roundIndex:4});
  const slot1=state.entries.find((entry)=>entry.team_id==="T1"&&entry.car_slot===1);
  const slot2=state.entries.find((entry)=>entry.team_id==="T1"&&entry.car_slot===2);

  assert.equal(slot1.status,"car_unavailable");
  assert.equal(slot1.driver_id,null);
  assert.match(slot1.car_availability_reason,/not raceworthy/i);
  assert.equal(slot2.status,"confirmed");
  assert.equal(slot2.driver_id,"D2");
});

test("a built Reserve Car substitutes one damaged primary chassis and keeps the contracted driver",()=>{
  let gs=withMaterializedPlayerGarage(fixture());
  gs={
    ...gs,
    garage:syncGarageState(gs,{
      ...gs.garage,
      reserveCarBuilt:true,
      cars:gs.garage.cars.map((car)=>car.id==="car_1"?{
        ...car,
        componentCondition:{...(car.componentCondition||{}),chassis:18,suspension:22},
      }:car),
    }),
  };
  // sync after reserveCarBuilt creates the physical reserve chassis.
  gs={...gs,garage:syncGarageState(gs,gs.garage)};

  const state=buildRaceEntryState(gs,{gp,roundIndex:4});
  const slot1=state.entries.find((entry)=>entry.team_id==="T1"&&entry.car_slot===1);

  assert.equal(slot1.status,"confirmed");
  assert.equal(slot1.driver_id,"D1");
  assert.equal(slot1.car_source,"reserve_car");
  assert.equal(slot1.car_id,"car_spare");
  assert.equal(slot1.original_car_id,"car_1");
});

test("one Reserve Car cannot replace two unavailable race cars",()=>{
  let gs=withMaterializedPlayerGarage(fixture());
  const damaged=gs.garage.cars.map((car)=>({
    ...car,
    componentCondition:{...(car.componentCondition||{}),chassis:15,suspension:20},
  }));
  gs={
    ...gs,
    garage:syncGarageState(gs,{...gs.garage,reserveCarBuilt:true,cars:damaged}),
  };
  gs={...gs,garage:syncGarageState(gs,gs.garage)};

  const state=buildRaceEntryState(gs,{gp,roundIndex:4});
  const playerEntries=state.entries.filter((entry)=>entry.team_id==="T1");
  assert.equal(playerEntries.filter((entry)=>entry.car_source==="reserve_car").length,1);
  assert.equal(playerEntries.filter((entry)=>entry.status==="car_unavailable").length,1);
});

test("a repair scheduled to finish before the GP makes the primary car raceworthy in time",()=>{
  let gs=withMaterializedPlayerGarage(fixture());
  gs.currentDateISO="1980-04-01";
  gs={
    ...gs,
    garage:{
      ...gs.garage,
      cars:gs.garage.cars.map((car)=>car.id==="car_1"?{
        ...car,
        componentCondition:{...(car.componentCondition||{}),chassis:40},
      }:car),
    },
  };
  const car=gs.garage.cars.find((row)=>row.id==="car_1");
  const quote=standardRestoreQuote(gs,"chassis",40,{carId:car.id});
  gs=queueWorkshopJob(gs,quote,{
    id:"repair_before_monaco",
    title:"Restore chassis",
    startedAt:gs.currentDateISO,
  });
  const job=gs.garage.serviceJobs.find((row)=>row.id==="repair_before_monaco");
  assert.ok(job.finishes_at<gp.race_date);

  const state=buildRaceEntryState(gs,{gp,roundIndex:4});
  const slot1=state.entries.find((entry)=>entry.team_id==="T1"&&entry.car_slot===1);
  assert.equal(slot1.status,"confirmed");
  assert.equal(slot1.car_source,"primary");
  assert.equal(slot1.driver_id,"D1");
});
