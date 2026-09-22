import test from "node:test";
import assert from "node:assert/strict";

import { createRaceStrategyState } from "../src/engine/RaceStrategyEngine.js";
import { advanceLiveRace, createLiveRaceState, finalizedLiveRaceRows, issueLiveRaceCommand, liveRaceReadyToFinalize, resumeLiveRace } from "../src/engine/LiveRaceEngine.js";
import { prepareGameStateForSave, extractGameStateFromStoredSave, createNewSaveMeta } from "../src/core/saveSafety.js";

const gp={gp_id:"test_gp",track_id:"test_track",gp_name:"Test GP",race_date:"1980-05-18"};
const tyres=[
  {tyre_id:"gy_h",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Hard",category:"dry",grip_index:74,wear_rate:0.015,warmup_time_s:2.8},
  {tyre_id:"gy_s",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Soft",category:"dry",grip_index:80,wear_rate:0.022,warmup_time_s:2.2},
  {tyre_id:"gy_i",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Intermediate",category:"intermediate",grip_index:65,wear_rate:0.018,warmup_time_s:3.1},
  {tyre_id:"gy_w",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Wet",category:"wet",grip_index:55,wear_rate:0.020,warmup_time_s:3.5},
];

function advanceTo(gs,target){
  let next=gs;
  let guard=0;
  while(Number(next?.raceWeekendState?.live_race?.current_lap||0)<target&&guard<20){
    if(next?.raceWeekendState?.live_race?.status==="red_flag")next=resumeLiveRace(next);
    const current=Number(next?.raceWeekendState?.live_race?.current_lap||0);
    next=advanceLiveRace(next,{gp,laps:Math.max(1,target-current)});
    guard+=1;
  }
  if(next?.raceWeekendState?.live_race?.status==="red_flag"){
    next=resumeLiveRace(next);
    if(Number(next?.raceWeekendState?.live_race?.current_lap||0)>=Number(next?.raceWeekendState?.live_race?.total_laps||Infinity)){
      next=advanceLiveRace(next,{gp,laps:1});
    }
  }
  return next;
}

function fixture(){
  const drivers=[
    {driver_id:"D1",display_name:"Player One",team_id:"T1"},
    {driver_id:"D2",display_name:"Player Two",team_id:"T1"},
    {driver_id:"D3",display_name:"AI One",team_id:"T2"},
    {driver_id:"D4",display_name:"AI Two",team_id:"T2"},
  ];
  let gs={
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed:"rw4-live"}),
    activeYear:1980,currentDateISO:"1980-05-18",team:{team_id:"T1",name:"Player"},teams:[{team_id:"T1",team_name:"Player"},{team_id:"T2",team_name:"AI"}],
    drivers,tyres,dbTyres:tyres,
    driverRatings:drivers.map((d,i)=>({driver_id:d.driver_id,pace:78-i,racecraft:76,consistency:75,tire_management:70,race_intelligence:72,start_launch:70,mentality:72,pressure_handling:72,adaptability:72,current_ability:77-i,crash_likelihood:20})),
    driverAttributes:Object.fromEntries(drivers.map((d)=>[d.driver_id,{fatigue:10,preparation:60,confidence:55,morale:55}])),
    raceEntryState:{entries:drivers.map((d,i)=>({driver_id:d.driver_id,team_id:d.team_id,status:"confirmed",car_slot:(i%2)+1,entry_type:"race_driver"}))},
    trackLayoutByYear:[{track_id:"test_track",year_from:1970,year_to:1990,lap_length_km:5,laps:12,pit_lane_loss_s:20}],
    coreTracks:[{track_id:"test_track",tyre_wear:55,overtaking_difficulty:55,lap_length_km:5}],
    dbWeatherProfiles:[{track_id:"test_track",month:5,avg_temp:22,rain_chance:0,storm_chance:0,wind_profile:"low"}],
    dbWeatherStates:[{id:"SUNNY",crash_risk_ppm:1}],
    carStats:[{team_id:"T1",year:1980,chassis_spec:76,aero_spec:75,gearbox_spec:74,suspension_spec:74,brakes_spec:75,reliability:.85},{team_id:"T2",year:1980,chassis_spec:75,aero_spec:74,gearbox_spec:74,suspension_spec:74,brakes_spec:74,reliability:.84}],
    teamEngines:[{team_id:"T1",year:1980,power:78,reliability:82},{team_id:"T2",year:1980,power:77,reliability:81}],
    facilities:[],dbPitcrewRoster:[],
  };
  const built=createRaceStrategyState(gs,{gp,raceEntryState:gs.raceEntryState});
  gs=built.gameState;
  const rows=drivers.map((d,i)=>({grid:i+1,driver_id:d.driver_id,team_id:d.team_id,qualifying_position:i+1,best_time_ms:90000+i*100}));
  gs.raceWeekendState={phase:"race",roundIndex:0,startingGrid:{status:"final",rows},grid:rows,race_strategy:built.state};
  return gs;
}

test("live race starts at lap zero and advances incrementally",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  assert.equal(gs.raceWeekendState.live_race.current_lap,0);
  gs=advanceTo(gs,Number(gs.raceWeekendState.live_race.current_lap)+1);
  assert.equal(gs.raceWeekendState.live_race.current_lap,1);
  assert.equal(gs.raceWeekendState.live_race.classification.length,4);
  assert.equal(gs.raceWeekendState.live_race.status,"running");
});

test("pace command is lap-scoped and changes only future simulation",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  gs=advanceTo(gs,3);
  const before=structuredClone(gs.raceWeekendState.live_race.classification);
  gs=issueLiveRaceCommand(gs,{driverId:"D1",type:"pace",paceMode:"attack"});
  const commands=gs.raceWeekendState.race_strategy.live_commands.D1;
  assert.equal(commands.at(-1).effective_lap,4);
  gs=advanceTo(gs,Number(gs.raceWeekendState.live_race.current_lap)+1);
  assert.equal(gs.raceWeekendState.live_race.current_lap,4);
  assert.ok(gs.raceWeekendState.live_race.projected_race.find((r)=>r.driver.driver_id==="D1").strategy_summary.live_command_count>=1);
  assert.equal(before.find((r)=>r.driver_id==="D1").elapsed_ms,
    advanceTo(createLiveRaceState(fixture(),{gp}),3).raceWeekendState.live_race.classification.find((r)=>r.driver_id==="D1").elapsed_ms);
});

test("Pit Now schedules the selected tyre for the next lap",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  gs=advanceTo(gs,2);
  gs=issueLiveRaceCommand(gs,{driverId:"D1",type:"pit",tyreId:"gy_s"});
  assert.equal(gs.raceWeekendState.race_strategy.live_commands.D1.at(-1).effective_lap,3);
  gs=advanceTo(gs,Number(gs.raceWeekendState.live_race.current_lap)+1);
  const row=gs.raceWeekendState.live_race.projected_race.find((r)=>r.driver.driver_id==="D1");
  const stop=row.pit_stops.find((p)=>p.lap===3);
  assert.ok(stop);
  assert.equal(stop.reason,"player_call");
  assert.equal(stop.tyre_to,"gy_s");
  const pitEvent=gs.raceWeekendState.live_race.events.find((event)=>event.type==="pit"&&event.driver_id==="D1");
  assert.ok(pitEvent);
  assert.equal(pitEvent.driver_name,"Player One");
  assert.match(pitEvent.message,/Player One pits for Soft tyres/);
  assert.equal(pitEvent.message.includes("D1 pitted"),false);
  assert.equal(pitEvent.message.includes("gy_s"),false);
  assert.equal(pitEvent.message.includes("gy_h"),false);
});

test("AI driver cannot receive player live commands",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  const next=issueLiveRaceCommand(gs,{driverId:"D3",type:"pace",paceMode:"attack"});
  assert.deepEqual(next.raceWeekendState.race_strategy.live_commands,{});
});

test("live race survives save/load at the exact lap with commands intact",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  gs=advanceTo(gs,4);
  gs=issueLiveRaceCommand(gs,{driverId:"D1",type:"pace",paceMode:"conserve"});
  const stored=prepareGameStateForSave(gs);
  const loaded=extractGameStateFromStoredSave({meta:{name:"Live race"},gameState:stored});
  assert.equal(loaded.raceWeekendState.live_race.current_lap,4);
  assert.deepEqual(loaded.raceWeekendState.race_strategy.live_commands,gs.raceWeekendState.race_strategy.live_commands);
  const a=advanceTo(gs,5);
  const b=advanceTo(loaded,5);
  assert.deepEqual(a.raceWeekendState.live_race.classification,b.raceWeekendState.live_race.classification);
});

test("race must reach its final lap before it can be finalized",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  assert.equal(liveRaceReadyToFinalize(gs),false);
  gs=advanceTo(gs,12);
  assert.equal(gs.raceWeekendState.live_race.current_lap,12);
  assert.equal(gs.raceWeekendState.live_race.status,"finished");
  assert.equal(liveRaceReadyToFinalize(gs),true);
});


test("red flag state can be resumed without rebuilding the race",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  const plan=gs.raceWeekendState.race_strategy.race_control_plan;
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      live_race:{
        ...gs.raceWeekendState.live_race,
        status:"red_flag",
        current_lap:5,
        current_control:"RED_FLAG",
        red_flag_period:{type:"RED_FLAG",from_lap:5,to_lap:5,cause:"incident"},
      },
    },
  };
  const resumed=resumeLiveRace(gs);
  assert.equal(resumed.raceWeekendState.live_race.status,"running");
  assert.equal(resumed.raceWeekendState.live_race.current_lap,5);
  assert.equal(resumed.raceWeekendState.race_strategy.race_control_plan,plan);
  assert.equal(resumed.raceWeekendState.live_race.events.at(-1).type,"restart");
});


test("finalized live rows preserve exactly the retirements visible to the player",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  gs=advanceTo(gs,12);
  const live=gs.raceWeekendState.live_race;
  const forced=live.classification.map((row,index)=>index===live.classification.length-1
    ? {...row,retired:true,status:"DNF",retirement_reason:"Engine",incident_lap:9}
    : {...row,retired:false,status:"RUNNING",retirement_reason:null,incident_lap:null}
  );
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      live_race:{...live,status:"finished",current_lap:live.total_laps,classification:forced},
    },
  };
  const rows=finalizedLiveRaceRows(gs);
  assert.equal(rows.filter((row)=>row.retired).length,1);
  const retired=rows.find((row)=>row.retired);
  assert.equal(retired.retirement_reason,"Engine");
  assert.equal(retired.incident_lap,9);
  assert.equal(retired.laps_completed,9);
  assert.equal(rows.filter((row)=>!row.retired).every((row)=>row.status==="Finished"),true);
});


test("RW4.4 live timing exposes sectors, intervals, tyre age, position change and strategy projection",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  gs=advanceTo(gs,4);
  const rows=gs.raceWeekendState.live_race.classification;
  assert.equal(rows.length,4);
  const leader=rows[0];
  assert.equal(leader.gap_to_leader_ms,0);
  assert.equal(leader.interval_ms,0);
  assert.ok(Number.isFinite(leader.grid_position));
  assert.ok(Number.isFinite(leader.position_gain));
  assert.ok(Number.isFinite(leader.position_change_last_lap));
  assert.ok(Number.isFinite(leader.projected_finish_position));
  assert.ok(Number.isFinite(leader.pit_rejoin_position)&&leader.pit_rejoin_position>=1);
  assert.ok(Number.isFinite(leader.pit_loss_estimate_s)&&leader.pit_loss_estimate_s>0);
  assert.ok(Number.isFinite(leader.best_lap_ms)&&leader.best_lap_ms>0);
  assert.ok(Number.isFinite(leader.best_lap_number)&&leader.best_lap_number>=1);
  assert.ok(Number.isFinite(leader.previous_lap_ms)&&leader.previous_lap_ms>0);
  assert.equal(leader.last_lap_delta_ms,leader.last_lap_ms-leader.previous_lap_ms);
  assert.ok(Number.isFinite(leader.tyre.age_laps)&&leader.tyre.age_laps>=1);
  assert.ok(Number.isFinite(leader.tyre.temperature_c));
  assert.ok(["conserve","balanced","attack"].includes(leader.current_pace));
  assert.ok(leader.pit_window===null||Number.isFinite(leader.pit_window.target_lap));
  assert.equal(
    leader.sector_1_ms+leader.sector_2_ms+leader.sector_3_ms,
    leader.last_lap_ms,
    "display sectors must add back to the exact simulated lap time"
  );

  const second=rows[1];
  assert.ok(Number(second.interval_ms)>=0);
  assert.ok(Number(second.gap_to_leader_ms)>=Number(second.interval_ms));

  const timing=gs.raceWeekendState.live_race.timing_summary;
  assert.equal(timing.leader_driver_id,leader.driver_id);
  assert.ok(Number.isFinite(timing.fastest_lap_ms)&&timing.fastest_lap_ms>0);
  assert.equal(timing.running_count+timing.retired_count,rows.length);
});

test("RW4.4 advanced timing remains deterministic after save/load",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  gs=advanceTo(gs,5);
  const stored=prepareGameStateForSave(gs);
  const loaded=extractGameStateFromStoredSave({meta:{name:"RW4.4 timing"},gameState:stored});
  assert.deepEqual(
    loaded.raceWeekendState.live_race.classification,
    gs.raceWeekendState.live_race.classification
  );
  assert.deepEqual(
    loaded.raceWeekendState.live_race.timing_summary,
    gs.raceWeekendState.live_race.timing_summary
  );
});
