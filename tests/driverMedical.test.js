import test from "node:test";
import assert from "node:assert/strict";
import { driverAvailabilityForRace, buildRaceEntryState } from "../src/domain/raceEntry.js";
import { medicalPerformancePenalty, conditionModifierBreakdown } from "../src/domain/driverPerformance.js";
import { driverAvailabilitySnapshot } from "../src/domain/driverProfile.js";

const gp={gp_id:"test",race_date:"1980-05-20"};

test("minor injury keeps a driver eligible but applies temporary current-performance loss",()=>{
  const gs={
    activeYear:1980,
    currentDateISO:"1980-05-19",
    driverAttributes:{D1:{confidence:50,morale:50,preparation:50,fatigue:0}},
    driverAvailability:{
      D1:{
        driver_id:"D1",
        status:"limited",
        severity:"minor",
        reason:"wrist sprain",
        performancePenalty:2.4,
        unavailableFrom:"1980-05-18",
        expectedReturnDate:"1980-05-25",
      },
    },
    medicalHistory:[],
  };
  assert.equal(driverAvailabilityForRace(gs,"D1",gp).available,true);
  assert.equal(driverAvailabilitySnapshot(gs,"D1").available,true);
  assert.equal(medicalPerformancePenalty(gs,"D1"),2.4);
  assert.equal(conditionModifierBreakdown(gs,"D1").medicalEffect,-2.4);
});

test("serious injury makes the race driver unavailable and promotes the Reserve Driver",()=>{
  const gs={
    activeYear:1980,
    currentDateISO:"1980-05-19",
    teams:[{team_id:"T1"}],
    contracts:[
      {year:1980,driver_id:"D1",team_id:"T1",role:"Main Driver",status:"active",contract_until_year:1981},
      {year:1980,driver_id:"D2",team_id:"T1",role:"Second Driver",status:"active",contract_until_year:1981},
      {year:1980,driver_id:"R1",team_id:"T1",role:"Reserve Driver",status:"active",contract_until_year:1981},
    ],
    driverAvailability:{
      D1:{
        driver_id:"D1",
        status:"injured",
        severity:"serious",
        reason:"leg fracture",
        unavailableFrom:"1980-05-18",
        expectedReturnDate:"1980-07-01",
      },
    },
  };
  assert.equal(driverAvailabilityForRace(gs,"D1",gp).available,false);
  const entry=buildRaceEntryState(gs,{gp,roundIndex:4});
  const car1=entry.entries.find((row)=>row.team_id==="T1"&&row.car_slot===1);
  assert.equal(car1.driver_id,"R1");
  assert.equal(car1.entry_type,"reserve_replacement");
  assert.equal(car1.replacement_for_driver_id,"D1");
});
