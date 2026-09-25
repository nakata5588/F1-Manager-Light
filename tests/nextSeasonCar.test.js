import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceNextSeasonCarDay,
  defaultNextSeasonCarProgramme,
  nextSeasonEngineeringCapacity,
  normalizeNextSeasonCarProgramme,
  pauseNextSeasonCarProgramme,
  resumeNextSeasonCarProgramme,
  setNextSeasonCarEngineers,
  startNextSeasonCarProgramme,
} from "../src/domain/nextSeasonCar.js";
import { technicalDevelopmentCapacity } from "../src/domain/developmentProject.js";
import { prepareGameStateForSave } from "../src/core/saveSafety.js";

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-03-01",
    team:{team_id:"PLAYER",budget:6_000_000},
    finances:{balance:6_000_000,budget:6_000_000,season_spend:0},
    facilities:[{
      year:1980,team_id:"PLAYER",
      aero_dept_level:8,wind_tunnel_level:8,
      manufacturing_leve:8,_chassis_shop_level:8,
    }],
    hq:{facilityLevels:{}},
    development:{
      projects:[{
        id:"current_1",status:"active",engineers:3,
        started_at:"1980-02-01",finishes_at:"1980-04-01",
      }],
      parts:[],partUnits:[],manufacturing:[],research:[],
      technologyProjects:[],aeroTestingUsage:[],
      nextSeasonCar:null,
    },
    carStats:[{year:1980,team_id:"PLAYER",chassis_spec:75,aero_spec:74}],
    financeLog:[],
  };
}

test("missing next-season state normalizes safely for old saves",()=>{
  const programme=normalizeNextSeasonCarProgramme(undefined,{activeYear:1980});
  assert.deepEqual(programme,defaultNextSeasonCarProgramme(1980));
  assert.equal(programme.targetSeason,1981);
  assert.equal(programme.status,"not_started");
});

test("next-season programme uses engineers but never consumes a Current Car project slot",()=>{
  const gs=fixture();
  const before=technicalDevelopmentCapacity(gs,"PLAYER",{
    engineeringSupport:80,
    projects:gs.development.projects,
  });
  const started=startNextSeasonCarProgramme(gs,{
    teamId:"PLAYER",
    engineers:4,
    engineeringSupport:80,
  });
  const after=nextSeasonEngineeringCapacity(started,{
    teamId:"PLAYER",
    engineeringSupport:80,
  });

  assert.equal(started.development.nextSeasonCar.status,"active");
  assert.equal(started.development.nextSeasonCar.regulation_impact.targetSeason,1981);
  assert.equal(started.development.nextSeasonCar.regulation_impact.governance.next_season_locked,true);
  assert.ok(started.development.nextSeasonCar.knowledge_at_launch);
  assert.ok(started.development.nextSeasonCar.knowledge_carryover);
  assert.equal(started.development.nextSeasonCar.knowledge_carryover.targetSeason,1981);
  assert.equal(started.development.nextSeasonCar.technical_philosophy.id,"balanced");
  assert.ok(started.development.nextSeasonCar.technical_package);
  assert.equal(started.development.nextSeasonCar.technical_package.stage_scope.materialized_to_car_stats,false);
  assert.equal(after.active_projects,before.active_projects);
  assert.equal(after.max_projects,before.max_projects);
  assert.equal(after.reserved_engineers,4);
  assert.equal(after.available_engineers,before.available_engineers-4);
  assert.ok(started.finances.balance<gs.finances.balance);
  assert.equal(started.financeLog.at(-1).category,"Next Season Car");
});

test("next-season programme progresses once per in-game day and preserves current car baseline",()=>{
  let gs=startNextSeasonCarProgramme(fixture(),{
    teamId:"PLAYER",
    engineers:5,
    engineeringSupport:80,
  });
  const baseline=structuredClone(gs.carStats);

  gs={...gs,currentDateISO:"1980-03-02"};
  const once=advanceNextSeasonCarDay(gs);
  const twice=advanceNextSeasonCarDay(once);

  assert.ok(once.development.nextSeasonCar.overall_progress>0);
  assert.equal(
    twice.development.nextSeasonCar.overall_progress,
    once.development.nextSeasonCar.overall_progress
  );
  assert.deepEqual(once.carStats,baseline);
});

test("next-season engineering allocation can be changed within the shared pool",()=>{
  let gs=startNextSeasonCarProgramme(fixture(),{
    teamId:"PLAYER",
    engineers:3,
    engineeringSupport:80,
  });
  gs=setNextSeasonCarEngineers(gs,{
    teamId:"PLAYER",
    engineers:5,
    engineeringSupport:80,
  });
  assert.equal(gs.development.nextSeasonCar.engineers,5);

  const unchanged=setNextSeasonCarEngineers(gs,{
    teamId:"PLAYER",
    engineers:99,
    engineeringSupport:80,
  });
  assert.equal(unchanged.development.nextSeasonCar.engineers,5);
});

test("pausing next-season programme releases its engineers and resume reclaims them",()=>{
  let gs=startNextSeasonCarProgramme(fixture(),{
    teamId:"PLAYER",
    engineers:4,
    engineeringSupport:80,
  });
  const activeCapacity=nextSeasonEngineeringCapacity(gs,{teamId:"PLAYER",engineeringSupport:80});

  gs=pauseNextSeasonCarProgramme(gs);
  const pausedCapacity=nextSeasonEngineeringCapacity(gs,{teamId:"PLAYER",engineeringSupport:80});
  assert.equal(gs.development.nextSeasonCar.status,"paused");
  assert.equal(pausedCapacity.available_engineers,activeCapacity.available_engineers+4);

  gs=resumeNextSeasonCarProgramme(gs,{teamId:"PLAYER",engineeringSupport:80});
  assert.equal(gs.development.nextSeasonCar.status,"active");
});

test("next-season programme persists through normal save preparation",()=>{
  let gs=startNextSeasonCarProgramme(fixture(),{
    teamId:"PLAYER",
    engineers:4,
    engineeringSupport:80,
  });
  gs={...gs,currentDateISO:"1980-03-02"};
  gs=advanceNextSeasonCarDay(gs);

  const saved=prepareGameStateForSave(gs);
  assert.equal(saved.development.nextSeasonCar.targetSeason,1981);
  assert.equal(saved.development.nextSeasonCar.engineers,4);
  assert.equal(
    saved.development.nextSeasonCar.overall_progress,
    gs.development.nextSeasonCar.overall_progress
  );
  assert.equal(
    saved.development.nextSeasonCar.technical_package.overall.projected,
    gs.development.nextSeasonCar.technical_package.overall.projected
  );
  assert.equal(saved.development.nextSeasonCar.technical_philosophy.id,"balanced");
});
