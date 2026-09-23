import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFreshCareerState,
  freshCareerRuntimeDefaults,
} from "../src/core/freshCareer.js";

test("fresh career keeps historical season seed data but drops every prior runtime system",()=>{
  const old={
    dbDrivers:[{driver_id:"D1"}],
    dbTeams:[{team_id:"T1"}],
    yearsAvailable:[1980],
    seasonPackMeta:{year:1980,format:"f1ml-season-pack"},
    calendar:[{gp_id:"ARG"}],
    teams:[{team_id:"T1"}],
    drivers:[{driver_id:"D1"}],
    contracts:[{team_id:"T1",driver_id:"D1",role:"Main Driver"}],
    carStats:[{year:1980,team_id:"T1",chassis_spec:80}],

    // Simulated state from an old career that must never leak.
    results:[{round:5}],
    lastRace:{gp_id:"OLD"},
    driverPerformanceLog:{D1:[{score:95}]},
    driverForm:{D1:{score:91,label:"Excellent"}},
    driverAttributes:{D1:{fatigue:88,confidence:12}},
    driverAvailability:{D1:{status:"injured"}},
    development:{projects:[{id:"OLD_PROJECT"}],parts:[{id:"OLD_PART"}]},
    garage:{cars:[{id:"car_1",componentCondition:{gearbox:23}}]},
    componentServiceLog:[{action:"restore"}],
    aiTechnicalWorld:{version:1,teams:{R:{development:{projects:[{id:"AI_OLD"}]}}}},
    teamOperationalState:{T1:{morale:12}},
    teamMoraleLog:{T1:[{delta:-10}]},
    financeLog:[{id:"old_tx"}],
    medicalHistory:[{driver_id:"D1"}],
    raceWeekendState:{phase:"race"},
    raceEntryState:{entries:[{driver_id:"D1"}]},
    futureRuntimeLeak:{should_not_survive:true},
    careerMeta:{started:true,sourceSeason:1979},
    saveMeta:{seed:"old-save"},
  };

  const fresh=buildFreshCareerState(old,{
    activeYear:1980,
    currentDateISO:"1980-01-01",
    team:{team_id:"T1"},
    driverAttributes:{D1:{fatigue:0,confidence:50}},
    careerMeta:{started:true,sourceSeason:1980},
    saveMeta:{seed:"new-save"},
  });

  assert.deepEqual(fresh.dbDrivers,old.dbDrivers);
  assert.deepEqual(fresh.calendar,old.calendar);
  assert.deepEqual(fresh.contracts,old.contracts);
  assert.equal(fresh.seasonPackMeta.year,1980);

  assert.deepEqual(fresh.results,[]);
  assert.equal(fresh.lastRace,null);
  assert.deepEqual(fresh.driverPerformanceLog,{});
  assert.deepEqual(fresh.driverForm,{});
  assert.deepEqual(fresh.development,{projects:[],parts:[],partUnits:[],manufacturing:[],research:[]});
  assert.deepEqual(fresh.garage,{cars:[],serviceJobs:[],baseComponentStock:{}});
  assert.deepEqual(fresh.componentServiceLog,[]);
  assert.deepEqual(fresh.aiTechnicalWorld,{version:1,teams:{}});
  assert.deepEqual(fresh.teamOperationalState,{});
  assert.deepEqual(fresh.teamMoraleLog,{});
  assert.deepEqual(fresh.financeLog,[]);
  assert.deepEqual(fresh.medicalHistory,[]);
  assert.equal(fresh.raceWeekendState,null);
  assert.equal(fresh.raceEntryState,null);
  assert.equal("futureRuntimeLeak" in fresh,false);
  assert.equal(fresh.saveMeta.seed,"new-save");
  assert.equal(fresh.careerMeta.sourceSeason,1980);
  assert.equal(fresh.driverAttributes.D1.fatigue,0);
});

test("fresh runtime defaults explicitly reset car, development and driver-form state",()=>{
  const defaults=freshCareerRuntimeDefaults();
  assert.deepEqual(defaults.development.projects,[]);
  assert.deepEqual(defaults.development.partUnits,[]);
  assert.deepEqual(defaults.garage.cars,[]);
  assert.deepEqual(defaults.aiTechnicalWorld.teams,{});
  assert.deepEqual(defaults.driverPerformanceLog,{});
  assert.deepEqual(defaults.driverForm,{});
  assert.deepEqual(defaults.teamOperationalState,{});
  assert.equal(defaults.lastRace,null);
});
