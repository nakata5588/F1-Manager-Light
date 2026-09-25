import test from "node:test";
import assert from "node:assert/strict";
import { buildFreshCareerState, freshCareerRuntimeState } from "../src/state/newGameRuntime.js";
import { seasonPackStatePatch } from "../src/data/seasonPackLoader.js";

test("fresh career runtime clears driver form, development and team morale state", () => {
  const conditions = { D1: { confidence: 50, morale: 50, preparation: 50, fatigue: 0 } };
  const dirty = {
    results: [{ key: "old-race" }],
    lastRace: { gpName: "Old GP" },
    driverPerformanceLog: { D1: [{ score: 91 }] },
    driverForm: { D1: { score: 88 } },
    driverDevelopmentFocus: { D1: "pace" },
    driverDevelopmentFocusMeta: { D1: { monthKey: "1980-06" } },
    driverDevelopmentTraining: { D1: { days: 12 } },
    driverLifecycle: { D1: { stage: "prime" } },
    driverLifecycleLog: { D1: [{ stage: "prime" }] },
    driverPotentialLog: { D1: [{ after: 90 }] },
    driverAbilityLog: { D1: [{ after: 85 }] },
    driverMentalStateLog: { D1: [{ source: "old-race" }] },
    driverReputationLog: { D1: [{ delta: 1.2 }] },
    driverRelationships: { version:1, relations: { "D1|team|OLD": { driver_id:"D1", target_type:"team", target_id:"OLD", trust:10 } }, log:[{old:true}] },
    driverRivalries: { version:1, pairs:{ "D1|D2":{driver_a_id:"D1",driver_b_id:"D2",rivalry:80} }, log:[{old:true}] },
    driverStaffAssignments: { version:1, assignments:{ "D1|race_engineer":{driver_id:"D1",staff_id:"OLD_E",team_id:"OLD",role:"race_engineer",active:true} }, history:[{staff_id:"OLD_E"}] },
    teamOperationalState: { T1: { morale: 22 } },
    teamMoraleLog: { T1: [{ delta: -5 }] },
    teamReputationState: { T1: { reputation: 81 } },
    teamReputationLog: { T1: [{ delta: 2 }] },
  };

  const next = { ...dirty, ...freshCareerRuntimeState({ initialDriverConditions: conditions }) };

  assert.deepEqual(next.results, []);
  assert.equal(next.lastRace, null);
  assert.deepEqual(next.driverPerformanceLog, {});
  assert.deepEqual(next.driverForm, {});
  assert.deepEqual(next.driverDevelopmentFocus, {});
  assert.deepEqual(next.driverDevelopmentFocusMeta, {});
  assert.deepEqual(next.driverDevelopmentTraining, {});
  assert.deepEqual(next.driverLifecycle, {});
  assert.deepEqual(next.driverLifecycleLog, {});
  assert.deepEqual(next.driverPotentialLog, {});
  assert.deepEqual(next.driverAbilityLog, {});
  assert.deepEqual(next.driverMentalStateLog, {});
  assert.deepEqual(next.driverReputationLog, {});
  assert.deepEqual(next.driverRelationships, { version:2, relations:{}, log:[] });
  assert.deepEqual(next.driverRivalries, { version:1, pairs:{}, log:[] });
  assert.deepEqual(next.driverStaffAssignments, { version:1, assignments:{}, history:[] });
  assert.deepEqual(next.teamOperationalState, {});
  assert.deepEqual(next.teamMoraleLog, {});
  assert.deepEqual(next.teamReputationState, {});
  assert.deepEqual(next.teamReputationLog, {});
  assert.deepEqual(next.driverAttributes, conditions);
  assert.equal(next._lastDriverProgressionMonth, null);
});


test("fresh career copies historical seed only and drops Cars plus unknown runtime state", () => {
  const source = {
    dbDrivers: [{ driver_id: "D1" }],
    dbTeams: [{ team_id: "T1" }],
    yearsAvailable: [1980],
    seasonPackMeta: { format: "f1ml-season-pack", year: 1980 },
    calendar: [{ gp_id: "ARG" }],
    teams: [{ team_id: "T1" }],
    drivers: [{ driver_id: "D1" }],
    contracts: [{ team_id: "T1", driver_id: "D1", role: "Main Driver" }],
    carStats: [{ year: 1980, team_id: "T1", chassis_spec: 80 }],

    results: [{ key: "old-race" }],
    lastRace: { gpName: "Old GP" },
    driverPerformanceLog: { D1: [{ score: 95 }] },
    driverForm: { D1: { score: 91, label: "Excellent" } },
    driverDevelopmentFocus: { D1: "pace" },
    driverMentalStateLog: { D1: [{ source: "old-race" }] },
    driverReputationLog: { D1: [{ delta: -0.8 }] },
    driverRelationships: { version:1, relations: { "D1|team|OLD": { driver_id:"D1", target_type:"team", target_id:"OLD", trust:10 } }, log:[] },
    driverRivalries: { version:1, pairs:{ "D1|D2":{driver_a_id:"D1",driver_b_id:"D2",rivalry:65} }, log:[] },
    driverStaffAssignments: { version:1, assignments:{ "D1|race_engineer":{driver_id:"D1",staff_id:"OLD_E",team_id:"OLD",role:"race_engineer",active:true} }, history:[] },
    driverAttributes: { D1: { fatigue: 88, confidence: 12 } },
    development: {
      projects: [{ id: "OLD_PROJECT" }],
      parts: [{ id: "OLD_PART" }],
      partUnits: [{ id: "OLD_UNIT", design_id: "OLD_PART", condition: 12 }],
      manufacturing: [{ id: "OLD_JOB" }],
      research: [],
      aeroTestingUsage: [{ period_id: "2025-ATP1", wind_tunnel_hours: 40, cfd_mauh: 2.5 }],
    },
    garage: {
      cars: [{ id: "car_1", componentCondition: { gearbox: 23 } }],
      serviceJobs: [{ id: "OLD_SERVICE" }],
    },
    componentWearLog: [{ slot: "gearbox", wear: 20 }],
    componentServiceLog: [{ action: "restore" }],
    aiTechnicalWorld: {
      version: 1,
      teams: { RENAULT: { development: { projects: [{ id: "AI_OLD" }] } } },
    },
    teamOperationalState: { T1: { morale: 12 } },
    teamMoraleLog: { T1: [{ delta: -10 }] },
    financeLog: [{ id: "OLD_TX" }],
    medicalHistory: [{ driver_id: "D1" }],
    raceWeekendState: { phase: "race" },
    raceEntryState: { entries: [{ driver_id: "D1" }] },
    futureRuntimeLeak: { should_not_survive: true },
    careerMeta: { started: true, sourceSeason: 1979 },
    saveMeta: { seed: "old-save" },
  };

  const fresh = buildFreshCareerState(source, {
    activeYear: 1980,
    currentDateISO: "1980-01-01",
    team: { team_id: "T1" },
    driverAttributes: { D1: { fatigue: 0, confidence: 50 } },
    careerMeta: { started: true, sourceSeason: 1980 },
    saveMeta: { seed: "new-save" },
  });

  assert.deepEqual(fresh.dbDrivers, source.dbDrivers);
  assert.deepEqual(fresh.calendar, source.calendar);
  assert.deepEqual(fresh.contracts, source.contracts);
  assert.equal(fresh.seasonPackMeta.year, 1980);

  assert.deepEqual(fresh.results, []);
  assert.equal(fresh.lastRace, null);
  assert.deepEqual(fresh.driverPerformanceLog, {});
  assert.deepEqual(fresh.driverForm, {});
  assert.deepEqual(fresh.driverDevelopmentFocus, {});
  assert.deepEqual(fresh.driverMentalStateLog, {});
  assert.deepEqual(fresh.driverReputationLog, {});
  assert.ok(fresh.driverRelationships.relations["D1|team|T1"]);
  assert.equal(fresh.driverRelationships.relations["D1|team|T1"].trust,50);
  assert.equal(fresh.driverRelationships.relations["D1|team|OLD"],undefined);
  assert.deepEqual(fresh.driverRivalries, { version:1, pairs:{}, log:[] });
  assert.deepEqual(fresh.driverStaffAssignments, { version:1, assignments:{}, history:[] });
  assert.deepEqual(fresh.development, { projects: [], parts: [], partUnits: [], manufacturing: [], research: [], technologyProjects: [], aeroTestingUsage: [], technicalKnowledge: null, technicalStrategy: null, nextSeasonCar: null });
  assert.deepEqual(fresh.technicalUnlocks, {});
  assert.deepEqual(fresh.technologyDiscoverySeen, {});
  assert.deepEqual(fresh.garage, { cars: [], serviceJobs: [], baseComponentStock: {}, reserveCarBuilt: false });
  assert.deepEqual(fresh.componentWearLog, []);
  assert.deepEqual(fresh.componentServiceLog, []);
  assert.deepEqual(fresh.aiTechnicalWorld, { version: 1, teams: {} });
  assert.deepEqual(fresh.regulationGovernance, { version: 1, votes: [], approved_changes: [] });
  assert.deepEqual(fresh.teamOperationalState, {});
  assert.deepEqual(fresh.teamMoraleLog, {});
  assert.deepEqual(fresh.teamReputationState, {});
  assert.deepEqual(fresh.teamReputationLog, {});
  assert.deepEqual(fresh.financeLog, []);
  assert.deepEqual(fresh.medicalHistory, []);
  assert.equal(fresh.raceWeekendState, null);
  assert.equal(fresh.raceEntryState, null);
  assert.equal("futureRuntimeLeak" in fresh, false);
  assert.equal(fresh.saveMeta.seed, "new-save");
  assert.equal(fresh.careerMeta.sourceSeason, 1980);
  assert.equal(fresh.driverAttributes.D1.fatigue, 0);
});


test("Season Pack driver rows receive current portrait paths before New Game starts", () => {
  const patch=seasonPackStatePatch({
    format:"f1ml-season-pack",
    schemaVersion:1,
    year:1980,
    validation:{ok:true},
    state:{
      drivers:[
        {driver_id:"d_0117",display_name:"Alain Prost",portrait_path:""},
        {driver_id:"custom",display_name:"Custom Driver",portrait_path:"/custom/driver.png"},
      ],
    },
  });

  assert.equal(patch.drivers[0].portrait_path,"/portraits/drivers/d_0117.webp");
  assert.equal(patch.drivers[1].portrait_path,"/custom/driver.png");
});

test("fresh career boundary rehydrates live and DB driver portraits", () => {
  const fresh=buildFreshCareerState({
    activeYear:1980,
    seasonPackMeta:{format:"f1ml-season-pack",year:1980},
    drivers:[{driver_id:"d_0117",display_name:"Alain Prost",portrait_path:""}],
    dbDrivers:[{driver_id:"d_0178",display_name:"Alan Jones",portrait_path:""}],
  },{
    activeYear:1980,
    currentDateISO:"1980-01-01",
  });

  assert.equal(fresh.drivers[0].portrait_path,"/portraits/drivers/d_0117.webp");
  assert.equal(fresh.dbDrivers[0].portrait_path,"/portraits/drivers/d_0178.webp");
});
