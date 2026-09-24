import test from "node:test";
import assert from "node:assert/strict";

import { processPlayerTechnicalLifecycle } from "../src/domain/playerTechnicalLifecycle.js";

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-04-10",
    team:{team_id:"T1"},
    development:{
      projects:[],
      parts:[],
      partUnits:[],
      manufacturing:[],
      research:[],
    },
    garage:{
      cars:[
        {id:"car_1",kind:"race",installedParts:{},componentCondition:{}},
        {id:"car_2",kind:"race",installedParts:{},componentCondition:{}},
      ],
      serviceJobs:[],
      baseComponentStock:{},
    },
  };
}

test("player development completes from the game clock without mounting Development UI",()=>{
  const gs=fixture();
  gs.development.projects=[{
    id:"dev_T1_1980-03-01_001",
    name:"Front Wing · Balanced Package · P1",
    type:"aero_front",
    objective_id:"balanced",
    status:"active",
    started_at:"1980-03-01",
    finishes_at:"1980-04-05",
    target_design_perf:1.25,
    perf_delta:1.25,
    engineers:3,
  }];

  const next=processPlayerTechnicalLifecycle(gs);

  assert.equal(next.development.projects[0].status,"completed");
  assert.equal(next.development.projects[0].completed_at,"1980-04-05");
  assert.equal(next.development.projects[0].progress,1);
  const blueprint=next.development.parts.find((part)=>part.created_from==="dev_T1_1980-03-01_001");
  assert.ok(blueprint);
  assert.equal(blueprint.slot,"aero_front");
  assert.equal(blueprint.perf,1.25);
  assert.equal(blueprint.created_at,"1980-04-05");
});

test("paused development remains paused after its former ETA",()=>{
  const gs=fixture();
  gs.development.projects=[{
    id:"paused",
    name:"Paused design",
    type:"chassis",
    status:"paused",
    started_at:"1980-03-01",
    finishes_at:"1980-04-01",
    progress:0.7,
    target_design_perf:1,
  }];

  const next=processPlayerTechnicalLifecycle(gs);

  assert.equal(next.development.projects[0].status,"paused");
  assert.equal(next.development.parts.length,0);
});

test("blueprint manufacturing completes from the game clock and creates physical units",()=>{
  const gs=fixture();
  gs.development.parts=[{
    id:"part_front",
    name:"Front Wing P1",
    slot:"aero_front",
    version:"P1",
    perf:1.1,
    inv:0,
    in_manufacturing:2,
  }];
  gs.development.manufacturing=[{
    id:"mfg_front_01",
    part_id:"part_front",
    title:"Front Wing P1 batch",
    qty:2,
    unit_cost:100000,
    started_at:"1980-04-01",
    finishes_at:"1980-04-08",
    status:"active",
  }];

  const next=processPlayerTechnicalLifecycle(gs);

  assert.equal(next.development.manufacturing[0].status,"completed");
  assert.equal(next.development.manufacturing[0].completed_at,"1980-04-08");
  assert.equal(next.development.partUnits.length,2);
  assert.ok(next.development.partUnits.every((unit)=>unit.design_id==="part_front"));
  assert.ok(next.development.partUnits.every((unit)=>unit.manufactured_at==="1980-04-08"));
  assert.equal(next.development.parts[0].in_manufacturing,0);
  assert.equal(next.development.parts[0].inv,2);
});

test("technical lifecycle processing is idempotent on the same date",()=>{
  const gs=fixture();
  gs.development.parts=[{
    id:"part_chassis",
    name:"Chassis P1",
    slot:"chassis",
    version:"P1",
    perf:1,
    inv:0,
    in_manufacturing:1,
  }];
  gs.development.manufacturing=[{
    id:"mfg_chassis_01",
    part_id:"part_chassis",
    qty:1,
    finishes_at:"1980-04-10",
    status:"active",
  }];

  const once=processPlayerTechnicalLifecycle(gs);
  const twice=processPlayerTechnicalLifecycle(once);

  assert.equal(once.development.partUnits.length,1);
  assert.equal(twice.development.partUnits.length,1);
  assert.deepEqual(twice.development.manufacturing,once.development.manufacturing);
});
