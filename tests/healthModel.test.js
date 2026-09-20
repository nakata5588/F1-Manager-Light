import test from "node:test";
import assert from "node:assert/strict";

import { createNewSaveMeta } from "../src/core/saveSafety.js";
import {
  applyRaceHealthOutcomes,
  healthOutcomeProbabilities,
  refreshDriverAvailability,
} from "../src/engine/InjuryEngine.js";
import { buildRaceEntryState } from "../src/domain/raceEntry.js";

function state(seed="health-model"){
  return {
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed}),
    activeYear:1980,
    currentDateISO:"1980-05-18",
    team:{team_id:"T1",team_name:"Alpha"},
    teams:[{team_id:"T1",team_name:"Alpha"}],
    drivers:[
      {driver_id:"D1",display_name:"Driver One",status:"eligible",canHireF1:true},
      {driver_id:"D2",display_name:"Driver Two",status:"eligible",canHireF1:true},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"main_driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"D2",role:"second_driver",status:"active"},
    ],
    driverAvailability:{},
    medicalHistory:[],
    inbox:[],
    accidentModel:[{
      year:1980,
      minor_prob:0.82,
      damage_DNF_prob:0.16,
      injury_prob:0.02,
      fatality_prob:0.002,
    }],
    eraSafety:[{
      year:1980,
      era_safety_index:0.42,
      car_safety:0.50,
      medical_response:0.60,
      marshals_quality:0.55,
    }],
    settings:{gameplay:{enableInjuryRandomEvents:true,enableFatalities:true}},
  };
}

const gp={gp_id:"monaco",gp_name:"Monaco Grand Prix",year:1980,race_date:"1980-05-18"};
const incident=(severity,driverId="D1")=>({
  retired:true,
  retirement_reason:"Accident",
  incident_severity:severity,
  driver:{driver_id:driverId,display_name:driverId==="D1"?"Driver One":"Driver Two"},
});

test("1980 health model keeps injury and fatality as separate probabilities",()=>{
  const gs=state();
  const low=healthOutcomeProbabilities(gs,incident("low"));
  const medium=healthOutcomeProbabilities(gs,incident("medium"));
  const high=healthOutcomeProbabilities(gs,incident("high"));
  const critical=healthOutcomeProbabilities(gs,incident("critical"));

  assert.equal(low.baseInjuryProbability,0.02);
  assert.equal(low.baseFatalityProbability,0.002);
  assert.ok(low.injuryProbability<medium.injuryProbability);
  assert.ok(medium.injuryProbability<high.injuryProbability);
  assert.ok(high.injuryProbability<critical.injuryProbability);
  assert.ok(low.fatalityProbability<medium.fatalityProbability);
  assert.ok(medium.fatalityProbability<high.fatalityProbability);
  assert.ok(high.fatalityProbability<critical.fatalityProbability);
  assert.ok(critical.fatalityProbability<critical.injuryProbability);
});

test("forced fatal outcome permanently removes driver from future race entries",()=>{
  const gs=state("fatal-outcome");
  const next=applyRaceHealthOutcomes(gs,{
    gp,
    race:[incident("critical")],
    forceFatalityProbability:1,
    forceInjuryProbability:0,
  });

  assert.equal(next.driverAvailability.D1.status,"deceased");
  assert.equal(next.driverAvailability.D1.expectedReturnDate,null);
  assert.equal(next.drivers.find((d)=>d.driver_id==="D1")?.status,"deceased");
  assert.equal(next.drivers.find((d)=>d.driver_id==="D1")?.canHireF1,false);
  assert.equal(next.contracts.find((c)=>c.driver_id==="D1")?.status,"terminated");
  assert.equal(next.contracts.find((c)=>c.driver_id==="D1")?.termination_reason,"fatality");
  assert.equal(next.medicalHistory.at(-1)?.outcome,"fatality");
  assert.ok(next.inbox.some((msg)=>msg.driver_id==="D1"&&/Fatal accident/.test(msg.subject)));

  const later=refreshDriverAvailability(next,"1980-12-31");
  assert.equal(later.driverAvailability.D1.status,"deceased");

  const entry=buildRaceEntryState(later,{
    gp:{gp_id:"belgium",race_date:"1980-06-01",year:1980},
    roundIndex:5,
  });
  const slot=entry.entries.find((row)=>row.team_id==="T1"&&row.car_slot===1);
  assert.equal(slot.driver_id,null);
  assert.equal(slot.status,"vacant");
});

test("fatalities setting can disable death without disabling the health engine",()=>{
  const gs=state("fatal-disabled");
  gs.settings.gameplay.enableFatalities=false;
  const next=applyRaceHealthOutcomes(gs,{
    gp,
    race:[incident("critical")],
    forceFatalityProbability:1,
    forceInjuryProbability:0,
  });
  assert.equal(next.driverAvailability.D1,undefined);
  assert.equal(next.drivers.find((d)=>d.driver_id==="D1")?.status,"eligible");
});

test("forced injury stores incident severity and medical history",()=>{
  const gs=state("injury-outcome");
  const next=applyRaceHealthOutcomes(gs,{
    gp,
    race:[incident("high","D2")],
    forceFatalityProbability:0,
    forceInjuryProbability:1,
  });

  const injury=next.driverAvailability.D2;
  assert.equal(injury.status,"injured");
  assert.equal(injury.incidentSeverity,"high");
  assert.ok(["minor","moderate","serious"].includes(injury.severity));
  assert.ok(injury.expectedReturnDate>"1980-05-18");
  const history=next.medicalHistory.at(-1);
  assert.equal(history.driver_id,"D2");
  assert.equal(history.outcome,"injury");
  assert.equal(history.incident_severity,"high");
  assert.ok(history.injury_probability>0);
  assert.ok(history.fatality_probability>=0);
});
