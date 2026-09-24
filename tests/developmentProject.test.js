import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDevelopmentProjection,
  developmentObjectivesForSlot,
  developmentStrengthTarget,
  realizeDevelopmentProjection,
  technicalDevelopmentCapacity,
} from "../src/domain/developmentProject.js";

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-06-01",
    team:{team_id:"RENAULT"},
    carParts:[],
    facilities:[
      {year:1980,team_id:"RENAULT",aero_dept_level:7,wind_tunnel_level:7,manufacturing_leve:7,_chassis_shop_level:7},
    ],
    hq:{facilityLevels:{}},
  };
}

test("Development 2.0 exposes slot-relevant design objectives",()=>{
  const gs=fixture();
  const aero=developmentObjectivesForSlot(gs,"aero_front").map((row)=>row.id);
  const gearbox=developmentObjectivesForSlot(gs,"gearbox").map((row)=>row.id);

  assert.ok(aero.includes("downforce"));
  assert.ok(aero.includes("efficiency"));
  assert.ok(aero.includes("reliability"));
  assert.ok(!gearbox.includes("downforce"));
  assert.ok(gearbox.includes("power_delivery"));
});

test("successive player designs accumulate specification strength instead of resetting",()=>{
  const parts=[
    {id:"front-v1",slot:"aero_front",perf:1.4,version:"P1"},
    {id:"front-v2",slot:"aero_front",perf:2.1,version:"P2"},
  ];
  const target=developmentStrengthTarget(parts,"aero_front",0.7);
  assert.equal(target.current_part.id,"front-v2");
  assert.equal(target.current_strength,2.1);
  assert.equal(target.target_strength,2.8);
  assert.equal(target.increment,0.7);
});

test("development strength is capped to prevent runaway current-car inflation",()=>{
  const target=developmentStrengthTarget([
    {id:"x",slot:"chassis",perf:5.8},
  ],"chassis",1.5);
  assert.equal(target.target_strength,6);
  assert.ok(target.increment<=0.201);
  assert.equal(target.headroom,0.2);
});

test("downforce and efficiency briefs create real technical trade-offs",()=>{
  const gs=fixture();
  const downforce=buildDevelopmentProjection(gs,{
    slot:"aero_front",objectiveId:"downforce",targetStrength:2.5,
  });
  const efficiency=buildDevelopmentProjection(gs,{
    slot:"aero_front",objectiveId:"efficiency",targetStrength:2.5,
  });

  assert.ok(downforce.delta.downforce>efficiency.delta.downforce);
  assert.ok(Math.abs(efficiency.delta.drag)>Math.abs(downforce.delta.drag));
  assert.ok(downforce.characteristic_bias.high_speed>0);
  assert.ok(efficiency.characteristic_bias.top_speed>0);
  assert.ok(downforce.characteristic_bias.top_speed<0);
});

test("reliability brief sacrifices pure performance for a larger reliability gain",()=>{
  const gs=fixture();
  const balanced=buildDevelopmentProjection(gs,{
    slot:"gearbox",objectiveId:"balanced",targetStrength:2.5,
  });
  const reliable=buildDevelopmentProjection(gs,{
    slot:"gearbox",objectiveId:"reliability",targetStrength:2.5,
  });

  assert.ok(reliable.delta.reliability_pct>balanced.delta.reliability_pct);
  assert.ok(reliable.delta.system_efficiency<balanced.delta.system_efficiency);
});

test("project realization is deterministic and records expected-vs-actual result",()=>{
  const gs=fixture();
  const projection=buildDevelopmentProjection(gs,{
    slot:"aero_front",objectiveId:"downforce",targetStrength:2.5,
  });
  const project={
    id:"dev_RENAULT_1980-06-01_001",
    risk:0.18,
    test_driver_feedback:72,
    technical_projection:projection,
  };
  const a=realizeDevelopmentProjection(project);
  const b=realizeDevelopmentProjection(project);

  assert.deepEqual(a,b);
  assert.ok(a.realization.multiplier>=0.82&&a.realization.multiplier<=1.16);
  assert.ok(["above_expectation","on_target","below_expectation"].includes(a.realization.result));
});

test("technical capacity is finite and active projects consume the engineering pool",()=>{
  const gs=fixture();
  const empty=technicalDevelopmentCapacity(gs,"RENAULT",{engineeringSupport:70,projects:[]});
  const used=technicalDevelopmentCapacity(gs,"RENAULT",{
    engineeringSupport:70,
    projects:[
      {status:"active",engineers:4},
      {status:"paused",engineers:2},
    ],
  });

  assert.ok(empty.engineer_pool>=6);
  assert.equal(used.used_engineers,4,"paused project should release its engineers");
  assert.equal(used.available_engineers,empty.engineer_pool-4);
  assert.equal(used.active_projects,2,"paused project should still occupy a project slot");
  assert.ok(used.max_projects>=1&&used.max_projects<=3);
});
