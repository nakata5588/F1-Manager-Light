import test from "node:test";
import assert from "node:assert/strict";

import { createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "../src/core/saveSafety.js";
import { ensureTemporaryReplacements, eligibleEmergencyDrivers } from "../src/engine/ReplacementEngine.js";
import { buildRaceEntryState, raceEntryDriverIds } from "../src/domain/raceEntry.js";
import { runRaceWeekend } from "../src/engine/GPEngine.js";

function fixture({withReserve=false}={}){
  const drivers=[
    {driver_id:"D1",display_name:"Race One",status:"eligible",canHireF1:true},
    {driver_id:"D2",display_name:"Race Two",status:"eligible",canHireF1:true},
    {driver_id:"DR",display_name:"Reserve One",status:"eligible",canHireF1:true},
    {driver_id:"DT",display_name:"Test One",status:"eligible",canHireF1:true},
    {driver_id:"F1",display_name:"Free Ace",status:"eligible",canHireF1:true},
    {driver_id:"F2",display_name:"Free Two",status:"eligible",canHireF1:true},
  ];
  const contracts=[
    {year:1980,team_id:"T1",driver_id:"D1",role:"main_driver",status:"active"},
    {year:1980,team_id:"T1",driver_id:"D2",role:"second_driver",status:"active"},
    {year:1980,team_id:"T1",driver_id:"DT",role:"test_driver",status:"active"},
  ];
  if(withReserve) contracts.push({year:1980,team_id:"T1",driver_id:"DR",role:"reserve_driver",status:"active"});

  return {
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed:"stage20-replacements"}),
    activeYear:1980,
    currentDateISO:"1980-06-01",
    currentRound:5,
    team:{team_id:"T1",team_name:"Alpha",budget:2_000_000},
    teams:[{team_id:"T1",team_name:"Alpha"}],
    drivers,
    contracts,
    driverRatings:[
      {driver_id:"D1",current_ability:78,pace:79,racecraft:78,consistency:76,reputation:70,crash_likelihood:12},
      {driver_id:"D2",current_ability:75,pace:76,racecraft:75,consistency:75,reputation:66,crash_likelihood:12},
      {driver_id:"DR",current_ability:66,pace:66,racecraft:65,consistency:70,reputation:50,crash_likelihood:15},
      {driver_id:"DT",current_ability:80,pace:80,racecraft:78,consistency:80,reputation:75,crash_likelihood:12},
      {driver_id:"F1",current_ability:72,pace:73,racecraft:74,consistency:76,reputation:62,market_value:500_000,crash_likelihood:14},
      {driver_id:"F2",current_ability:63,pace:64,racecraft:64,consistency:65,reputation:48,market_value:250_000,crash_likelihood:18},
    ],
    driverAvailability:{
      D2:{driver_id:"D2",status:"injured",reason:"concussion",unavailableFrom:"1980-05-20",expectedReturnDate:"1980-06-20"},
    },
    temporaryDriverAssignments:[],
    medicalHistory:[],
    financeLog:[],
    finances:{budget:2_000_000,balance:2_000_000,season_spend:0,season_income:0},
    inbox:[],
    standings:{drivers:[],teams:[]},
    results:[],
    driverAttributes:{},
    pointsSystem:{table:[9,6,4,3,2,1]},
    carStats:[{year:1980,team_id:"T1",chassis_spec:78,aero_spec:76,gearbox_spec:75,suspension_spec:76,brakes_spec:75,reliability:95}],
    teamEngines:[{year:1980,team_id:"T1",power:78,reliability:95}],
    accidentModel:[{year:1980,damage_DNF_prob:0.08,injury_prob:0,fatality_prob:0}],
    eraSafety:[{year:1980,era_safety_index:0.42,car_safety:0.50,medical_response:0.60}],
    sponsorsContracts:[],
    settings:{gameplay:{enableInjuryRandomEvents:true,enableFatalities:true}},
  };
}

const gp={gp_id:"belgium",gp_name:"Belgian Grand Prix",year:1980,race_date:"1980-06-01"};

test("contracted reserve has priority over emergency free agents",()=>{
  const gs=fixture({withReserve:true});
  const prepared=ensureTemporaryReplacements(gs,{gp,roundIndex:5});
  assert.equal(prepared.temporaryDriverAssignments.length,0);

  const entry=buildRaceEntryState(prepared,{gp,roundIndex:5});
  const slot=entry.entries.find((row)=>row.team_id==="T1"&&row.car_slot===2);
  assert.equal(slot.driver_id,"DR");
  assert.equal(slot.entry_type,"reserve_replacement");
  assert.equal(slot.replacement_for_driver_id,"D2");
  assert.equal(raceEntryDriverIds(entry).includes("DT"),false);
});

test("without reserve the best eligible free agent becomes a one-GP emergency substitute",()=>{
  const gs=fixture();
  const prepared=ensureTemporaryReplacements(gs,{gp,roundIndex:5});
  assert.equal(prepared.temporaryDriverAssignments.length,1);

  const assignment=prepared.temporaryDriverAssignments[0];
  assert.equal(assignment.gp_id,"belgium");
  assert.equal(assignment.team_id,"T1");
  assert.equal(assignment.car_slot,2);
  assert.equal(assignment.driver_id,"F1");
  assert.equal(assignment.replaces_driver_id,"D2");
  assert.equal(assignment.role,"Emergency Substitute");
  assert.ok(assignment.fee>=25_000);

  const entry=buildRaceEntryState(prepared,{gp,roundIndex:5});
  const slot=entry.entries.find((row)=>row.team_id==="T1"&&row.car_slot===2);
  assert.equal(slot.driver_id,"F1");
  assert.equal(slot.entry_type,"emergency_substitute");
  assert.equal(slot.temporary_assignment_id,assignment.id);
  assert.equal(raceEntryDriverIds(entry).includes("DT"),false,"test driver must never be emergency substitute");
});

test("test driver is not in the emergency candidate pool because it is contracted for testing",()=>{
  const gs=fixture();
  const candidates=eligibleEmergencyDrivers(gs,gp);
  const ids=candidates.map((driver)=>driver.driver_id);
  assert.equal(ids.includes("DT"),false);
  assert.deepEqual(ids.slice(0,2),["F1","F2"]);
});

test("emergency assignment is scoped to one Grand Prix",()=>{
  const gs=fixture();
  const prepared=ensureTemporaryReplacements(gs,{gp,roundIndex:5});
  const nextGp={gp_id:"france",gp_name:"French Grand Prix",year:1980,race_date:"1980-06-08"};

  const franceEntry=buildRaceEntryState(prepared,{gp:nextGp,roundIndex:6});
  const franceSlot=franceEntry.entries.find((row)=>row.team_id==="T1"&&row.car_slot===2);
  assert.equal(franceSlot.driver_id,null);
  assert.equal(franceSlot.status,"vacant");

  const preparedFrance=ensureTemporaryReplacements(prepared,{gp:nextGp,roundIndex:6});
  assert.equal(preparedFrance.temporaryDriverAssignments.length,2);
  assert.equal(preparedFrance.temporaryDriverAssignments[1].gp_id,"france");
});

test("player emergency fee and assignment are idempotent for the same GP",()=>{
  const gs=fixture();
  const first=ensureTemporaryReplacements(gs,{gp,roundIndex:5});
  const second=ensureTemporaryReplacements(first,{gp,roundIndex:5});

  assert.equal(first.temporaryDriverAssignments.length,1);
  assert.equal(second.temporaryDriverAssignments.length,1);
  const fee=first.temporaryDriverAssignments[0].fee;
  assert.equal(first.team.budget,2_000_000-fee);
  assert.equal(second.team.budget,first.team.budget);
  assert.equal(first.financeLog.filter((tx)=>String(tx.sig||"").startsWith("temp-driver:")).length,1);
  assert.equal(second.financeLog.filter((tx)=>String(tx.sig||"").startsWith("temp-driver:")).length,1);
});

test("when there is no reserve or free agent the car remains vacant",()=>{
  const gs=fixture();
  gs.drivers=gs.drivers.filter((d)=>!["F1","F2"].includes(d.driver_id));
  gs.driverRatings=gs.driverRatings.filter((r)=>!["F1","F2"].includes(r.driver_id));

  const prepared=ensureTemporaryReplacements(gs,{gp,roundIndex:5});
  assert.equal(prepared.temporaryDriverAssignments.length,0);
  const entry=buildRaceEntryState(prepared,{gp,roundIndex:5});
  const slot=entry.entries.find((row)=>row.team_id==="T1"&&row.car_slot===2);
  assert.equal(slot.driver_id,null);
  assert.equal(slot.status,"vacant");
  assert.ok(prepared.inbox.some((msg)=>msg.subject==="No emergency replacement available"));
});

test("a missing permanent race seat can be covered by reserve before the emergency market",()=>{
  const gs=fixture({withReserve:true});
  gs.contracts=gs.contracts.map((c)=>
    c.driver_id==="D2"?{...c,status:"terminated",termination_reason:"fatality"}:c
  );
  gs.drivers=gs.drivers.map((d)=>d.driver_id==="D2"?{...d,status:"deceased",canHireF1:false}:d);
  gs.driverAvailability.D2={driver_id:"D2",status:"deceased",reason:"fatal race accident"};

  const prepared=ensureTemporaryReplacements(gs,{gp,roundIndex:5});
  assert.equal(prepared.temporaryDriverAssignments.length,0);
  const entry=buildRaceEntryState(prepared,{gp,roundIndex:5});
  assert.equal(entry.entries.some((row)=>row.driver_id==="DR"&&row.entry_type==="reserve_replacement"),true);
});

test("GPEngine races the emergency substitute for the correct team",async()=>{
  const gs=fixture();
  const next=await runRaceWeekend(gs,{gp,roundIndex:5});

  assert.equal(next.temporaryDriverAssignments.length,1);
  const assignment=next.temporaryDriverAssignments[0];
  const raceEntry=next.results[0].raceEntry;
  assert.ok(raceEntry.some((row)=>row.driver_id===assignment.driver_id&&row.entry_type==="emergency_substitute"));
  assert.ok(next.results[0].qualifying.some((row)=>row.driver_id===assignment.driver_id&&row.team_id==="T1"));
  assert.ok(next.results[0].classification.some((row)=>row.driver_id===assignment.driver_id&&row.team_id==="T1"));
});

test("temporary assignments survive save/load round-trip",()=>{
  const prepared=ensureTemporaryReplacements(fixture(),{gp,roundIndex:5});
  const saved=prepareGameStateForSave(prepared);
  const loaded=extractGameStateFromStoredSave({meta:{name:"Stage 20"},gameState:saved});
  assert.deepEqual(loaded.temporaryDriverAssignments,prepared.temporaryDriverAssignments);
});
