import test from "node:test";
import assert from "node:assert/strict";

import { createNewSaveMeta } from "../src/core/saveSafety.js";
import { applyRaceInjuries, refreshDriverAvailability } from "../src/engine/InjuryEngine.js";
import { buildRaceEntryState, raceEntryDriverIds } from "../src/domain/raceEntry.js";
import { testDriverDevelopmentProfile } from "../src/domain/developmentTesting.js";
import { isReserveDriverContract, isTestDriverContract } from "../src/domain/contractRoles.js";

function baseState(seed="stage19"){
  const drivers=[
    {driver_id:"D1",display_name:"Race One"},
    {driver_id:"D2",display_name:"Race Two"},
    {driver_id:"DR",display_name:"Reserve One"},
    {driver_id:"DT",display_name:"Test One"},
  ];
  return {
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed}),
    activeYear:1980,
    currentDateISO:"1980-05-18",
    currentRound:4,
    team:{team_id:"T1",team_name:"Alpha"},
    teams:[{team_id:"T1",team_name:"Alpha"}],
    drivers,
    driverRatings:[
      {driver_id:"D1",current_ability:78,car_development_impact:55},
      {driver_id:"D2",current_ability:76,car_development_impact:58},
      {driver_id:"DR",current_ability:68,car_development_impact:45},
      {driver_id:"DT",current_ability:64,car_development_impact:82},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"main_driver",contract_start_year:1980,contract_until_year:1980},
      {year:1980,team_id:"T1",driver_id:"D2",role:"second_driver",contract_start_year:1980,contract_until_year:1980},
      {year:1980,team_id:"T1",driver_id:"DR",role:"reserve_driver",contract_start_year:1980,contract_until_year:1980},
      {year:1980,team_id:"T1",driver_id:"DT",role:"test_driver",contract_start_year:1980,contract_until_year:1980},
    ],
    driverAvailability:{},
    inbox:[],
    accidentModel:[{year:1980,minor_prob:0.82,damage_DNF_prob:0.16,injury_prob:0.02}],
    eraSafety:[{year:1980,era_safety_index:0.42,car_safety:0.50,medical_response:0.60,marshals_quality:0.55}],
    settings:{gameplay:{enableInjuryRandomEvents:true}},
  };
}

const monaco={gp_id:"monaco",gp_name:"Monaco Grand Prix",year:1980,race_date:"1980-05-18"};

test("reserve and test driver roles remain distinct",()=>{
  assert.equal(isReserveDriverContract({role:"reserve_driver"}),true);
  assert.equal(isTestDriverContract({role:"reserve_driver"}),false);
  assert.equal(isTestDriverContract({role:"test_driver"}),true);
  assert.equal(isReserveDriverContract({role:"test_driver"}),false);
});

test("race accident can create deterministic injury availability",()=>{
  const race=[
    {
      pos:12,
      retired:true,
      retirement_reason:"Accident",
      driver:{driver_id:"D2",display_name:"Race Two"},
    },
  ];
  const first=applyRaceInjuries(baseState("injury-fixed"),{gp:monaco,race,forceInjuryProbability:1});
  const second=applyRaceInjuries(baseState("injury-fixed"),{gp:monaco,race,forceInjuryProbability:1});

  assert.deepEqual(first.driverAvailability,second.driverAvailability);
  const injury=first.driverAvailability.D2;
  assert.equal(injury.status,"injured");
  assert.ok(["minor","moderate","serious"].includes(injury.severity));
  assert.equal(injury.unavailableFrom,"1980-05-18");
  assert.ok(injury.expectedReturnDate>"1980-05-18");
  assert.equal(injury.source,"race_incident");
  assert.equal(injury.sourceEventId,"monaco");
  assert.ok(first.inbox.some((msg)=>msg.driver_id==="D2"&&msg.type==="MEDICAL"));
});

test("injured race driver is replaced by reserve, never test driver",()=>{
  const gs=baseState();
  gs.driverAvailability.D2={
    driver_id:"D2",
    status:"injured",
    reason:"wrist sprain",
    unavailableFrom:"1980-05-18",
    expectedReturnDate:"1980-06-10",
  };
  const nextGp={gp_id:"belgium",race_date:"1980-06-01",year:1980};
  const entry=buildRaceEntryState(gs,{gp:nextGp,roundIndex:5});
  const slot=entry.entries.find((row)=>row.team_id==="T1"&&row.car_slot===2);

  assert.equal(slot.contracted_driver_id,"D2");
  assert.equal(slot.driver_id,"DR");
  assert.equal(slot.entry_type,"reserve_replacement");
  assert.equal(slot.replacement_for_driver_id,"D2");
  assert.equal(raceEntryDriverIds(entry).includes("DT"),false,"test driver must never be automatic race replacement");
});

test("recovered driver retakes the race seat on expected return date",()=>{
  const gs=baseState();
  gs.driverAvailability.D2={
    driver_id:"D2",
    status:"injured",
    reason:"wrist sprain",
    unavailableFrom:"1980-05-18",
    expectedReturnDate:"1980-06-10",
  };

  const recovered=refreshDriverAvailability(gs,"1980-06-10");
  assert.equal(recovered.driverAvailability.D2.status,"available");

  const entry=buildRaceEntryState(recovered,{
    gp:{gp_id:"france",race_date:"1980-06-10",year:1980},
    roundIndex:6,
  });
  const slot=entry.entries.find((row)=>row.team_id==="T1"&&row.car_slot===2);
  assert.equal(slot.driver_id,"D2");
  assert.equal(slot.entry_type,"contracted");
});

test("test driver provides development feedback while reserve driver does not",()=>{
  const gs=baseState();
  const profile=testDriverDevelopmentProfile(gs,"T1");
  assert.ok(profile);
  assert.equal(profile.driver_id,"DT");
  assert.equal(profile.name,"Test One");
  assert.equal(profile.impact,82);
  assert.ok(profile.performanceMultiplier>1);
  assert.ok(profile.riskReduction>0);
});
