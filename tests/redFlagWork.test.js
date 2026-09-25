import test from "node:test";
import assert from "node:assert/strict";

import { createRedFlagSuspension, prepareRedFlagRestart } from "../src/engine/RedFlagLifecycleEngine.js";
import {
  applyAutomaticRedFlagWork,
  applyRedFlagTyreChange,
  redFlagWorkCapability,
} from "../src/engine/RedFlagWorkEngine.js";

const tyres=[
  {tyre_id:"gy_h",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Hard",category:"dry",grip_index:74,wear_rate:0.015},
  {tyre_id:"gy_w",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Wet",category:"wet",grip_index:55,wear_rate:0.020},
  {tyre_id:"mi_h",year_from:1980,year_to:1980,supplier:"Michelin",compound_name:"Hard",category:"dry",grip_index:76,wear_rate:0.014},
  {tyre_id:"mi_w",year_from:1980,year_to:1980,supplier:"Michelin",compound_name:"Wet",category:"wet",grip_index:56,wear_rate:0.019},
];

function fixture(){
  const classification=[
    {
      driver_id:"D1",team_id:"T1",position:1,status:"RUNNING",retired:false,pit_count:1,
      tyre:{tyre_id:"gy_h",compound:"Hard",category:"dry",condition:63,age_laps:9,stint_number:1},
    },
    {
      driver_id:"D2",team_id:"T2",position:2,status:"RUNNING",retired:false,pit_count:0,
      tyre:{tyre_id:"mi_h",compound:"Hard",category:"dry",condition:82,age_laps:5,stint_number:1},
    },
  ];
  const lifecycle=createRedFlagSuspension({
    year:1980,
    rules:{restart_style:"era_restart"},
    period:{type:"RED_FLAG",cause:"weather",from_lap:6,from_sector:2},
    classification,
    lap:6,
    sector:2,
    trackState:{state:"HEAVY_RAIN",track_wetness:0.84,rain_intensity:0.72},
  });
  return {
    activeYear:1980,
    team:{team_id:"T1",name:"Player"},
    drivers:[
      {driver_id:"D1",display_name:"Player One",team_id:"T1"},
      {driver_id:"D2",display_name:"AI One",team_id:"T2"},
    ],
    tyres,
    dbTyres:tyres,
    raceStrategyWorld:{teamSuppliers:{T1:"Goodyear",T2:"Michelin"}},
    raceWeekendState:{
      phase:"race",
      race_strategy:{live_commands:{}},
      live_race:{
        status:"red_flag",
        current_lap:6,
        current_sector:2,
        current_control:"RED_FLAG",
        classification,
        events:[],
        red_flag_lifecycle:lifecycle,
      },
    },
  };
}

test("RW5.2D4.5 player tyre work is free service and persists as a race command",()=>{
  const gs=fixture();
  const beforePitCount=gs.raceWeekendState.live_race.classification[0].pit_count;
  const next=applyRedFlagTyreChange(gs,{driverId:"D1",tyreId:"gy_w"});

  const row=next.raceWeekendState.live_race.classification.find((item)=>item.driver_id==="D1");
  assert.equal(row.tyre.tyre_id,"gy_w");
  assert.equal(row.tyre.compound,"Wet");
  assert.equal(row.tyre.condition,100);
  assert.equal(row.tyre.age_laps,0);
  assert.equal(row.pit_count,beforePitCount);

  const command=next.raceWeekendState.race_strategy.live_commands.D1.at(-1);
  assert.equal(command.type,"red_flag_tyre");
  assert.equal(command.tyre_id,"gy_w");
  assert.equal(command.effective_lap,6);

  const work=next.raceWeekendState.live_race.red_flag_lifecycle.work_log.at(-1);
  assert.equal(work.type,"tyre_change");
  assert.equal(work.free_service,true);
  assert.equal(work.tyre_from_id,"gy_h");
  assert.equal(work.tyre_to_id,"gy_w");
  assert.equal(next.raceWeekendState.live_race.events.at(-1).type,"red_flag_work");
});

test("RW5.2D4.5 engine rejects a tyre from another team supplier",()=>{
  const gs=fixture();
  const next=applyRedFlagTyreChange(gs,{driverId:"D1",tyreId:"mi_w"});
  assert.equal(next,gs);
});

test("RW5.2D4.5 player cannot modify an AI car",()=>{
  const gs=fixture();
  const capability=redFlagWorkCapability(gs,{driverId:"D2"});
  assert.equal(capability.allowed,false);
  assert.equal(capability.reason,"not_player_driver");
  assert.equal(applyRedFlagTyreChange(gs,{driverId:"D2",tyreId:"mi_w"}),gs);
});

test("RW5.2D4.5 work is locked after restart preparation",()=>{
  const gs=fixture();
  const lifecycle=gs.raceWeekendState.live_race.red_flag_lifecycle;
  const authorized={
    ...lifecycle,
    restart_monitor:{
      ...lifecycle.restart_monitor,
      restart_authorized:true,
      safe_streak:lifecycle.restart_monitor.required_safe_checks,
      recommended_control:"GREEN",
    },
  };
  const pending={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      live_race:{
        ...gs.raceWeekendState.live_race,
        red_flag_lifecycle:prepareRedFlagRestart(authorized),
      },
    },
  };
  assert.equal(pending.raceWeekendState.live_race.red_flag_lifecycle.phase,"restart_pending");
  const next=applyRedFlagTyreChange(pending,{driverId:"D1",tyreId:"gy_w"});
  assert.equal(next,pending);
});

test("RW5.2D4.5 AI uses its own supplier and reacts to wet Red Flag conditions",()=>{
  const gs=fixture();
  const next=applyAutomaticRedFlagWork(gs);

  const player=next.raceWeekendState.live_race.classification.find((row)=>row.driver_id==="D1");
  const ai=next.raceWeekendState.live_race.classification.find((row)=>row.driver_id==="D2");
  assert.equal(player.tyre.tyre_id,"gy_h");
  assert.equal(ai.tyre.tyre_id,"mi_w");

  const command=next.raceWeekendState.race_strategy.live_commands.D2.at(-1);
  assert.equal(command.type,"red_flag_tyre");
  assert.equal(command.tyre_id,"mi_w");

  const work=next.raceWeekendState.live_race.red_flag_lifecycle.work_log.find((entry)=>entry.driver_id==="D2");
  assert.equal(work.source,"ai");
});
