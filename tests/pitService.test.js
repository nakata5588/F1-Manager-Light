import test from "node:test";
import assert from "node:assert/strict";

import { damageStateFromComponents } from "../src/engine/CarDamageEngine.js";
import {
  buildPitServiceSchedule,
  normalPitRepairRecord,
  NORMAL_PIT_REPAIR_EFFECTIVENESS,
} from "../src/engine/PitServiceEngine.js";

test("RW5.3B.2B front-wing work overlaps tyre service instead of blindly adding task times",()=>{
  const damage=damageStateFromComponents({front_wing:60});
  const schedule=buildPitServiceSchedule({
    year:1980,
    tyreChange:true,
    tyreServiceS:6.8,
    damageState:damage,
    repairComponents:["front_wing"],
  });

  const tyre=schedule.tasks.find((task)=>task.type==="tyres");
  const wing=schedule.tasks.find((task)=>task.component==="front_wing");
  assert.ok(tyre);
  assert.ok(wing);
  assert.ok(wing.start_s<tyre.end_s,"front-wing work should overlap tyre service");
  assert.ok(schedule.total_stationary_s>tyre.duration_s);
  assert.ok(
    schedule.total_stationary_s<tyre.duration_s+wing.duration_s,
    "concurrent tasks must not be summed blindly"
  );
  assert.equal(schedule.repair.damage_after.components.front_wing.damage_pct,0);
});

test("RW5.3B.2B repair-only service leaves tyre work out and reduces damage",()=>{
  const damage=damageStateFromComponents({
    front_wing:55,
    floor:40,
    suspension:25,
  });
  const schedule=buildPitServiceSchedule({
    year:1980,
    tyreChange:false,
    damageState:damage,
    repairComponents:["front_wing","floor","suspension"],
  });

  assert.equal(schedule.tyre_change,false);
  assert.equal(schedule.tasks.some((task)=>task.type==="tyres"),false);
  assert.ok(schedule.total_stationary_s>0);
  assert.equal(schedule.repair.damage_after.components.front_wing.damage_pct,0);
  assert.ok(schedule.repair.damage_after.components.floor.damage_pct>0);
  assert.ok(schedule.repair.damage_after.components.floor.damage_pct<damage.components.floor.damage_pct);
  assert.ok(schedule.repair.pace_loss_after_s_per_lap<schedule.repair.pace_loss_before_s_per_lap);
});

test("RW5.3B.2B deep repairs serialize shared-access work while independent work may overlap",()=>{
  const damage=damageStateFromComponents({
    rear_wing:45,
    floor:55,
    suspension:35,
  });
  const schedule=buildPitServiceSchedule({
    year:1980,
    tyreChange:true,
    tyreServiceS:7,
    damageState:damage,
    repairComponents:["rear_wing","floor","suspension"],
  });
  const floor=schedule.tasks.find((task)=>task.component==="floor");
  const suspension=schedule.tasks.find((task)=>task.component==="suspension");
  const rear=schedule.tasks.find((task)=>task.component==="rear_wing");

  assert.ok(floor&&suspension&&rear);
  assert.ok(suspension.start_s>=floor.end_s,"deep mechanical work must not occupy the same access bay");
  assert.ok(rear.start_s<floor.end_s,"independent rear work may overlap deep repair work");
  assert.equal(
    schedule.repair.effectiveness.front_wing,
    0,
    "unrequested components must never be repaired implicitly"
  );
  assert.equal(schedule.repair.effectiveness.floor,NORMAL_PIT_REPAIR_EFFECTIVENESS.floor);
});

test("RW5.3B.2B repair record is causal and tied to one pit stop",()=>{
  const damage=damageStateFromComponents({front_wing:70,floor:35});
  const service=buildPitServiceSchedule({
    year:1980,
    tyreChange:false,
    damageState:damage,
    repairComponents:["front_wing"],
  });
  const record=normalPitRepairRecord({
    driverId:"D1",
    teamId:"T1",
    service:{...service,damage_repair:true,completed:true},
    lap:4,
    sector:3,
    stopKey:"D1:5:1:gy_h",
  });

  assert.ok(record);
  assert.equal(record.driver_id,"D1");
  assert.equal(record.repair_ordinal,12);
  assert.equal(record.pit_stop_key,"D1:5:1:gy_h");
  assert.equal(record.free_service,false);
  assert.deepEqual(record.repaired_components,["front_wing"]);
  assert.ok(record.pace_loss_after_s_per_lap<record.pace_loss_before_s_per_lap);
});
