import test from "node:test";
import assert from "node:assert/strict";

import { damageStateFromComponents } from "../src/engine/CarDamageEngine.js";
import { applyPitTrafficModel } from "../src/engine/PitTrafficEngine.js";
import { createLivePitState, settleLivePitState } from "../src/engine/LivePitStopEngine.js";
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


test("RW5.3C same-team same-lap stops create a real double-stack queue",()=>{
  const rows=[
    {
      driver:{driver_id:"D1",team_id:"T1"},
      team_id:"T1",
      total_time_ms:180000,
      lap_times_ms:[90000,90000],
      pit_stops:[{lap:2,stationary_s:6,pit_lane_loss_s:20,total_loss_s:26}],
      strategy_summary:{},
    },
    {
      driver:{driver_id:"D2",team_id:"T1"},
      team_id:"T1",
      total_time_ms:181000,
      lap_times_ms:[90500,90500],
      pit_stops:[{lap:2,stationary_s:6.4,pit_lane_loss_s:20,total_loss_s:26.4}],
      strategy_summary:{},
    },
  ];
  const adjusted=applyPitTrafficModel(rows,{
    year:1980,
    pitCrews:{T1:{consistency:80,fatigue:0}},
  });
  const first=adjusted[0].pit_stops[0];
  const second=adjusted[1].pit_stops[0];

  assert.equal(first.double_stack,false);
  assert.equal(first.queue_delay_s,0);
  assert.equal(second.double_stack,true);
  assert.ok(second.box_occupied_delay_s>0);
  assert.ok(second.crew_prep_delay_s>0);
  assert.equal(
    Number(second.total_loss_s.toFixed(2)),
    Number((second.base_total_loss_s+second.pit_traffic_loss_s).toFixed(2))
  );
  assert.ok(adjusted[1].total_time_ms>rows[1].total_time_ms);
  assert.equal(adjusted[1].strategy_summary.double_stack_count,1);
});

test("RW5.3C different teams share pit-lane traffic without sharing a pit box",()=>{
  const rows=[
    {
      driver:{driver_id:"D1",team_id:"T1"},team_id:"T1",total_time_ms:180000,
      lap_times_ms:[90000,90000],
      pit_stops:[{lap:2,stationary_s:6,pit_lane_loss_s:20,total_loss_s:26}],
      strategy_summary:{},
    },
    {
      driver:{driver_id:"D3",team_id:"T2"},team_id:"T2",total_time_ms:180000,
      lap_times_ms:[90000,90000],
      pit_stops:[{lap:2,stationary_s:6,pit_lane_loss_s:20,total_loss_s:26}],
      strategy_summary:{},
    },
  ];
  const adjusted=applyPitTrafficModel(rows,{year:1980,pitCrews:{}});
  for(const row of adjusted){
    const stop=row.pit_stops[0];
    assert.equal(stop.queue_delay_s,0);
    assert.equal(stop.double_stack,false);
    assert.ok(stop.pit_lane_traffic_loss_s>0);
    assert.equal(stop.pit_lane_conflict_count,1);
  }
});

test("RW5.3C release conflicts become a hold only in the configured later-era policy",()=>{
  const rows=[
    {
      driver:{driver_id:"D1",team_id:"T1"},team_id:"T1",total_time_ms:180000,
      lap_times_ms:[90000,90000],
      pit_stops:[{lap:2,stationary_s:6,pit_lane_loss_s:20,total_loss_s:26}],
      strategy_summary:{},
    },
    {
      driver:{driver_id:"D3",team_id:"T2"},team_id:"T2",total_time_ms:193000,
      lap_times_ms:[96500,96500],
      pit_stops:[{lap:2,stationary_s:6,pit_lane_loss_s:20,total_loss_s:26}],
      strategy_summary:{},
    },
  ];
  const classic=applyPitTrafficModel(rows,{year:1980,pitCrews:{}});
  const later=applyPitTrafficModel(rows,{year:2000,pitCrews:{}});
  assert.equal(classic[0].pit_stops[0].release_delay_s,0);
  assert.equal(classic[0].pit_stops[0].release_hold,false);
  assert.ok(later[0].pit_stops[0].release_delay_s>0);
  assert.equal(later[0].pit_stops[0].release_hold,true);
});

test("RW5.3C live pit state exposes queue and release phases while preserving exact loss",()=>{
  const stop={
    lap:5,
    tyre_from:"hard",
    tyre_to:"soft",
    tyre_changed:true,
    pit_lane_loss_s:20,
    stationary_s:6,
    queue_delay_s:4,
    pit_lane_traffic_loss_s:0.5,
    release_delay_s:0.55,
    total_loss_s:31.05,
    double_stack:true,
    box_queue_position:2,
    pit_traffic_model:"rw5.3c",
  };
  let state=createLivePitState({driverId:"D1",stop,sequence:1,entryLap:4,entrySector:3});
  assert.ok(state.phases.some((phase)=>phase.phase==="pit_queue"&&phase.duration_ms===4000));
  assert.ok(state.phases.some((phase)=>phase.phase==="pit_release"&&phase.duration_ms===550));
  assert.equal(state.pit_traffic.double_stack,true);
  assert.equal(state.queue_total_ms,4000);
  assert.equal(state.release_total_ms,550);

  state=settleLivePitState(state);
  assert.equal(state.completed,true);
  assert.equal(state.loss_elapsed_ms,31050);
  assert.equal(state.loss_elapsed_ms,state.loss_total_ms);
  assert.equal(state.service.completed,true);
});
