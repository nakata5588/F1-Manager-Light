import test from "node:test";
import assert from "node:assert/strict";

import { createRaceStrategyState } from "../src/engine/RaceStrategyEngine.js";
import { advanceLiveRace, advanceLiveRaceSector, assessLiveRaceRestart, cancelLiveRaceCommand, createLiveRaceState, finalizedLiveRaceRows, formatRaceIncidentMessage, issueLiveRaceCommand, liveRaceReadyToFinalize, prepareLiveRaceRestart, projectObservedRaceState, resumeLiveRace } from "../src/engine/LiveRaceEngine.js";
import { prepareGameStateForSave, extractGameStateFromStoredSave, createNewSaveMeta } from "../src/core/saveSafety.js";
import { RACE_PLAYBACK_SPEEDS, raceEventRequiresPause, raceMotionDurationMs, racePlaybackCanRun, racePlaybackDelayMs, retiredCarVisibleOnTrack, unwrapTrackProgress } from "../src/domain/racePlayback.js";

const gp={gp_id:"test_gp",track_id:"test_track",gp_name:"Test GP",race_date:"1980-05-18"};
const tyres=[
  {tyre_id:"gy_h",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Hard",category:"dry",grip_index:74,wear_rate:0.015,warmup_time_s:2.8},
  {tyre_id:"gy_s",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Soft",category:"dry",grip_index:80,wear_rate:0.022,warmup_time_s:2.2},
  {tyre_id:"gy_i",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Intermediate",category:"intermediate",grip_index:65,wear_rate:0.018,warmup_time_s:3.1},
  {tyre_id:"gy_w",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Wet",category:"wet",grip_index:55,wear_rate:0.020,warmup_time_s:3.5},
];

function resolveRedFlag(gs){
  let next=gs;
  let guard=0;
  while(next?.raceWeekendState?.live_race?.status==="red_flag"&&guard<8){
    const lifecycle=next?.raceWeekendState?.live_race?.red_flag_lifecycle;
    if(lifecycle?.phase==="restart_pending"){
      next=resumeLiveRace(next);
    }else if(lifecycle?.restart_monitor?.restart_authorized){
      next=prepareLiveRaceRestart(next);
    }else{
      next=assessLiveRaceRestart(next);
    }
    guard+=1;
  }
  return next;
}

function advanceTo(gs,target){
  let next=gs;
  let guard=0;
  while(Number(next?.raceWeekendState?.live_race?.current_lap||0)<target&&guard<20){
    if(next?.raceWeekendState?.live_race?.status==="red_flag")next=resolveRedFlag(next);
    const current=Number(next?.raceWeekendState?.live_race?.current_lap||0);
    next=advanceLiveRace(next,{gp,laps:Math.max(1,target-current)});
    guard+=1;
  }
  if(next?.raceWeekendState?.live_race?.status==="red_flag"){
    next=resolveRedFlag(next);
    if(Number(next?.raceWeekendState?.live_race?.current_lap||0)>=Number(next?.raceWeekendState?.live_race?.total_laps||Infinity)){
      next=advanceLiveRace(next,{gp,laps:1});
    }
  }
  return next;
}

function fixture(seed="rw4-live"){
  const drivers=[
    {driver_id:"D1",display_name:"Player One",team_id:"T1"},
    {driver_id:"D2",display_name:"Player Two",team_id:"T1"},
    {driver_id:"D3",display_name:"AI One",team_id:"T2"},
    {driver_id:"D4",display_name:"AI Two",team_id:"T2"},
  ];
  let gs={
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed}),
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

test("RW4.6.1 race-control incident messages use natural language instead of internal severity enums",()=>{
  const samples=[
    {
      controlType:"LOCAL_YELLOW",
      incident:{kind:"collision",reason:"Collision",severity:"low"},
      expected:"Yellow flag — John Watson involved in a minor collision.",
    },
    {
      controlType:"LOCAL_YELLOW",
      incident:{kind:"collision",reason:"Collision",severity:"medium"},
      expected:"Yellow flag — John Watson involved in a significant collision.",
    },
    {
      controlType:"SAFETY_CAR",
      incident:{kind:"collision",reason:"Collision",severity:"high"},
      expected:"Safety Car — John Watson involved in a heavy collision.",
    },
    {
      controlType:"RED_FLAG",
      incident:{kind:"accident",reason:"Accident",severity:"critical"},
      expected:"Red flag — Serious accident involving John Watson.",
    },
    {
      controlType:null,
      incident:{kind:"mechanical",reason:"Engine",severity:"low"},
      expected:"John Watson stops with an engine problem.",
    },
  ];

  for(const sample of samples){
    const message=formatRaceIncidentMessage({
      controlType:sample.controlType,
      driverName:"John Watson",
      incident:sample.incident,
    });
    assert.equal(message,sample.expected);
    assert.doesNotMatch(message,/\((?:low|medium|high|critical)\)/i);
  }
});

test("race incident feed adds a cautious medical status after collisions",()=>{
  assert.equal(
    formatRaceIncidentMessage({
      controlType:"LOCAL_YELLOW",
      driverName:"Nelson Piquet",
      incident:{kind:"collision",reason:"Collision",severity:"high"},
      medicalConcern:true,
    }),
    "Yellow flag — Nelson Piquet involved in a heavy collision. Might be injured."
  );
  assert.equal(
    formatRaceIncidentMessage({
      controlType:"LOCAL_YELLOW",
      driverName:"Nelson Piquet",
      incident:{kind:"collision",reason:"Collision",severity:"low"},
      medicalConcern:false,
    }),
    "Yellow flag — Nelson Piquet involved in a minor collision. Seems to be OK."
  );
});

test("high-risk crash events carry medical concern into the observed Race Feed",()=>{
  let gs=null;
  let incident=null;
  for(let index=0;index<160&&!incident;index+=1){
    const candidate=createLiveRaceState(fixture(`medical-feed-${index}`),{gp});
    const found=(candidate.raceWeekendState.race_strategy.race_control_plan?.incidents||[])
      .find((row)=>["high","critical"].includes(String(row?.severity||"").toLowerCase())&&/accident|collision/i.test(String(row?.kind||row?.reason||"")));
    if(found){
      gs=candidate;
      incident=found;
    }
  }
  assert.ok(gs&&incident,"expected a deterministic high-risk crash seed");
  gs=advanceTo(gs,Number(incident.lap));
  const event=(gs.raceWeekendState.live_race.events||[])
    .find((row)=>String(row?.driver_id)===String(incident.driver_id)&&Number(row?.lap)===Number(incident.lap));
  assert.ok(event);
  assert.equal(event.medical_concern,true);
  assert.ok(Number(event.injury_probability)>0);
  assert.match(event.message,/might be injured/i);
});

test("RW5.1 live race advances through S1, S2 and S3 before completing a lap",()=>{
  let gs=createLiveRaceState(fixture("rw5-sector-step"),{gp});
  assert.equal(gs.raceWeekendState.live_race.current_lap,0);
  assert.equal(gs.raceWeekendState.live_race.current_sector,0);

  gs=advanceLiveRaceSector(gs,{gp,sectors:1});
  let live=gs.raceWeekendState.live_race;
  assert.equal(live.current_lap,1);
  assert.equal(live.current_sector,1);
  assert.equal(live.completed_laps,0);
  assert.ok(live.classification.length===4);
  assert.ok(live.classification.every((row)=>Number.isFinite(Number(row.sector_1_ms))));
  assert.ok(live.classification.every((row)=>row.sector_2_ms==null&&row.sector_3_ms==null));

  const s1Elapsed=new Map(live.classification.map((row)=>[row.driver_id,row.elapsed_ms]));
  gs=advanceLiveRaceSector(gs,{gp,sectors:1});
  live=gs.raceWeekendState.live_race;
  assert.equal(live.current_lap,1);
  assert.equal(live.current_sector,2);
  assert.ok(live.classification.every((row)=>Number.isFinite(Number(row.sector_2_ms))));
  assert.ok(live.classification.every((row)=>row.sector_3_ms==null));
  assert.ok(live.classification.every((row)=>row.elapsed_ms>s1Elapsed.get(row.driver_id)));

  gs=advanceLiveRaceSector(gs,{gp,sectors:1});
  live=gs.raceWeekendState.live_race;
  assert.equal(live.current_lap,1);
  assert.equal(live.current_sector,3);
  assert.equal(live.completed_laps,1);
  assert.ok(live.classification.every((row)=>Number.isFinite(Number(row.sector_3_ms))));
  assert.ok(live.classification.every((row)=>row.laps_completed===1||row.retired));
});

test("RW5.1 +1 Lap remains compatible and lands on S3",()=>{
  let gs=createLiveRaceState(fixture("rw5-lap-compat"),{gp});
  gs=advanceLiveRace(gs,{gp,laps:1});
  const live=gs.raceWeekendState.live_race;
  assert.equal(live.current_lap,1);
  assert.equal(live.current_sector,3);
  assert.equal(live.completed_laps,1);
});

test("RW5.1 sector state survives save/load exactly",()=>{
  let gs=createLiveRaceState(fixture("rw5-sector-save"),{gp});
  gs=advanceLiveRaceSector(gs,{gp,sectors:2});
  const before=gs.raceWeekendState.live_race;
  assert.equal(before.current_lap,1);
  assert.equal(before.current_sector,2);

  const stored=prepareGameStateForSave(gs);
  const loaded=extractGameStateFromStoredSave({meta:{name:"RW5 sector save"},gameState:stored});
  assert.equal(loaded.raceWeekendState.live_race.current_lap,1);
  assert.equal(loaded.raceWeekendState.live_race.current_sector,2);
  assert.deepEqual(loaded.raceWeekendState.live_race.classification,before.classification);

  const a=advanceLiveRaceSector(gs,{gp,sectors:1});
  const b=advanceLiveRaceSector(loaded,{gp,sectors:1});
  assert.deepEqual(a.raceWeekendState.live_race.classification,b.raceWeekendState.live_race.classification);
});

test("live race starts at lap zero and advances incrementally",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  assert.equal(gs.raceWeekendState.live_race.current_lap,0);
  gs=advanceTo(gs,Number(gs.raceWeekendState.live_race.current_lap)+1);
  assert.equal(gs.raceWeekendState.live_race.current_lap,1);
  assert.equal(gs.raceWeekendState.live_race.classification.length,4);
  assert.equal(gs.raceWeekendState.live_race.status,"running");
});

test("RW4.6.1 each observed incident produces one human Race Feed event",()=>{
  let gs=null;
  let targetLap=null;
  for(let index=0;index<60&&!targetLap;index+=1){
    const candidate=createLiveRaceState(fixture(`rw4.6.1-feed-${index}`),{gp});
    const first=candidate.raceWeekendState.race_strategy.race_control_plan?.incidents?.[0]||null;
    if(first){
      gs=candidate;
      targetLap=Number(first.lap);
    }
  }
  assert.ok(gs&&targetLap,"expected a deterministic seed with a race incident");

  gs=advanceTo(gs,targetLap);
  const currentLap=Number(gs.raceWeekendState.live_race.current_lap||0);
  const currentSector=Number(gs.raceWeekendState.live_race.current_sector||3);
  const observedOrdinal=(lap,sector=1)=>(Number(lap)-1)*3+Number(sector||1);
  const liveOrdinal=observedOrdinal(currentLap,currentSector);
  const observedIncidents=(gs.raceWeekendState.race_strategy.race_control_plan?.incidents||[])
    .filter((row)=>observedOrdinal(row?.lap,row?.sector??1)<=liveOrdinal);

  assert.ok(observedIncidents.length>=1,"expected at least one observed incident after advancing the live race");

  for(const incident of observedIncidents){
    const matching=(gs.raceWeekendState.live_race.events||[]).filter((event)=>
      Number(event?.lap)===Number(incident.lap)&&
      String(event?.driver_id||"")===String(incident.driver_id)&&
      ["incident","race_control"].includes(String(event?.type))
    );
    assert.equal(matching.length,1,"each observed incident should produce exactly one player-facing incident/control message");
    assert.doesNotMatch(matching[0].message,/\((?:low|medium|high|critical)\)/i);
    assert.doesNotMatch(matching[0].message,/\b(?:low|medium|high|critical)\b/i);
  }

  const incidentControlEvents=(gs.raceWeekendState.live_race.events||[]).filter((event)=>
    event?.type==="race_control"&&event?.cause==="incident"
  );
  for(const event of incidentControlEvents){
    assert.doesNotMatch(String(event?.message||""),/Race control intervention/i);
    assert.match(String(event?.message||""),/incident|accident|collision|flag|Driver|Player/i);
  }
});

test("pace command is lap-scoped and changes only future simulation",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  gs=advanceTo(gs,3);
  const before=structuredClone(gs.raceWeekendState.live_race.classification);
  gs=issueLiveRaceCommand(gs,{driverId:"D1",type:"pace",paceMode:"attack"});
  const commands=gs.raceWeekendState.race_strategy.live_commands.D1;
  assert.equal(commands.at(-1).effective_lap,4);
  const commandEvent=gs.raceWeekendState.live_race.events.at(-1);
  assert.equal(commandEvent.type,"command");
  assert.match(commandEvent.message,/Player One was told to push/);
  gs=advanceTo(gs,Number(gs.raceWeekendState.live_race.current_lap)+1);
  assert.equal(gs.raceWeekendState.live_race.current_lap,4);
  assert.ok(gs.raceWeekendState.live_race.projected_race.find((r)=>r.driver.driver_id==="D1").strategy_summary.live_command_count>=1);
  assert.equal(before.find((r)=>r.driver_id==="D1").elapsed_ms,
    advanceTo(createLiveRaceState(fixture(),{gp}),3).raceWeekendState.live_race.classification.find((r)=>r.driver_id==="D1").elapsed_ms);
});

test("D6.3B let-through order is only accepted for a close team-mate immediately behind",()=>{
  let gs=createLiveRaceState(fixture("d63b-team-order"),{gp});
  gs=advanceTo(gs,2);
  const rows=gs.raceWeekendState.live_race.classification.map((row)=>{
    if(row.driver_id==="D1")return {...row,position:1,retired:false};
    if(row.driver_id==="D2")return {...row,position:2,retired:false,gap_to_previous_ms:1200,interval_ms:1200};
    return row;
  });
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      live_race:{...gs.raceWeekendState.live_race,classification:rows},
    },
  };

  gs=issueLiveRaceCommand(gs,{driverId:"D1",type:"team_order",teamOrder:"yield",teammateId:"D2"});
  const command=gs.raceWeekendState.race_strategy.live_commands.D1.at(-1);
  assert.equal(command.type,"team_order");
  assert.equal(command.team_order,"yield");
  assert.equal(command.teammate_id,"D2");
  assert.equal(command.effective_lap,3);
  assert.match(gs.raceWeekendState.live_race.events.at(-1).message,/let Player Two through/i);

  gs=advanceTo(gs,3);
  const projected=gs.raceWeekendState.live_race.projected_race.find((row)=>row.driver.driver_id==="D1");
  assert.ok(projected.strategy_summary.strategy_decisions.some((decision)=>decision.action==="team_order"&&decision.order==="yield"&&decision.lap===3));
});

test("D6.3B rejects a let-through order when the team-mate is not directly behind",()=>{
  let gs=createLiveRaceState(fixture("d63b-invalid-team-order"),{gp});
  gs=advanceTo(gs,2);
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      live_race:{
        ...gs.raceWeekendState.live_race,
        classification:gs.raceWeekendState.live_race.classification.map((row)=>{
          if(row.driver_id==="D1")return {...row,position:1};
          if(row.driver_id==="D2")return {...row,position:3,gap_to_previous_ms:900};
          return row;
        }),
      },
    },
  };
  const before=structuredClone(gs.raceWeekendState.race_strategy.live_commands||{});
  const next=issueLiveRaceCommand(gs,{driverId:"D1",type:"team_order",teamOrder:"yield",teammateId:"D2"});
  assert.deepEqual(next.raceWeekendState.race_strategy.live_commands||{},before);
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
  assert.equal(pitEvent.tyre_from,"Hard");
  assert.equal(pitEvent.tyre_to,"Soft");
  assert.ok(Number.isFinite(pitEvent.stationary_s));
  assert.ok(Number.isFinite(pitEvent.expected_stationary_s));
  assert.ok(Number.isFinite(pitEvent.execution_delta_s));
  assert.ok(Number.isFinite(pitEvent.crew_error_delay_s));
  assert.ok(Number.isFinite(pitEvent.pit_lane_loss_s));
  assert.ok(Number.isFinite(pitEvent.total_loss_s));
  assert.ok(Number.isFinite(pitEvent.position_before));
  assert.ok(Number.isFinite(pitEvent.position_after));
  assert.match(pitEvent.message,/Player One changed from Hard to Soft tyres/);
  assert.match(pitEvent.message,/stationary/);
  assert.match(pitEvent.message,/P\d+ → P\d+/);
  assert.equal(pitEvent.message.includes("D1 pitted"),false);
  assert.equal(pitEvent.message.includes("gy_s"),false);
  assert.equal(pitEvent.message.includes("gy_h"),false);
});

test("RW5.2B player tyre choice is not automatically reversed by weather logic",()=>{
  let base=fixture("rw5.2b-player-tyre-authority");
  const wetWeather={
    ...base.raceWeekendState.race_strategy.weather_snapshot,
    state:"LIGHT_RAIN",
    segments:[{from_lap:1,to_lap:12,state:"LIGHT_RAIN"}],
    wet_race:true,
  };
  base={
    ...base,
    raceWeekendState:{
      ...base.raceWeekendState,
      race_strategy:{
        ...base.raceWeekendState.race_strategy,
        weather_snapshot:wetWeather,
        selections:{
          ...base.raceWeekendState.race_strategy.selections,
          D1:{...base.raceWeekendState.race_strategy.selections.D1,start_tyre_id:"gy_i",pit_plan:"no_stop"},
        },
      },
    },
  };
  let gs=createLiveRaceState(base,{gp});
  gs=advanceTo(gs,2);
  gs=issueLiveRaceCommand(gs,{driverId:"D1",type:"pit",tyreId:"gy_s"});
  gs=advanceTo(gs,6);
  const row=gs.raceWeekendState.live_race.projected_race.find((r)=>r.driver.driver_id==="D1");
  const stops=row.pit_stops.filter((stop)=>Number(stop.lap)>=3);
  assert.equal(stops[0]?.reason,"player_call");
  assert.equal(stops[0]?.tyre_to,"gy_s");
  assert.equal(stops.some((stop)=>stop.reason==="weather"),false);
  const softState=row.tyre_state_by_lap.find((state)=>Number(state.lap)>=3&&state.tyre_id==="gy_s");
  assert.ok(softState);
  assert.ok(Number(softState.weather_penalty_s)>0.5,"slicks on a wetting track must lose progressively more performance");
});

test("RW5.2B player driver complains when the chosen tyre mismatches track conditions",()=>{
  let base=fixture("rw5.2b-driver-feedback");
  base={
    ...base,
    raceWeekendState:{
      ...base.raceWeekendState,
      race_strategy:{
        ...base.raceWeekendState.race_strategy,
        weather_snapshot:{
          ...base.raceWeekendState.race_strategy.weather_snapshot,
          state:"LIGHT_RAIN",
          segments:[{from_lap:1,to_lap:12,state:"LIGHT_RAIN"}],
          wet_race:true,
        },
        selections:{
          ...base.raceWeekendState.race_strategy.selections,
          D1:{...base.raceWeekendState.race_strategy.selections.D1,start_tyre_id:"gy_i",pit_plan:"no_stop"},
        },
      },
    },
  };
  let gs=createLiveRaceState(base,{gp});
  gs=advanceTo(gs,2);
  gs=issueLiveRaceCommand(gs,{driverId:"D1",type:"pit",tyreId:"gy_s"});
  gs=advanceTo(gs,4);
  const feedback=gs.raceWeekendState.live_race.events.find((event)=>
    event.type==="driver_feedback"&&event.driver_id==="D1"&&event.tyre_category==="dry"
  );
  assert.ok(feedback);
  assert.match(feedback.message,/slippery|too wet|intermediates/i);
  assert.ok(Number(feedback.weather_penalty_s)>0.5);
});

test("RW5.2D3.1 intermediates do not report a drying track while wetness is rising",()=>{
  let base=fixture("rw5.2d3.1-rising-wetness-feedback");
  base={
    ...base,
    raceWeekendState:{
      ...base.raceWeekendState,
      race_strategy:{
        ...base.raceWeekendState.race_strategy,
        weather_snapshot:{
          ...base.raceWeekendState.race_strategy.weather_snapshot,
          state:"LIGHT_RAIN",
          starting_track_wetness:0,
          starting_air_temp_c:24,
          starting_track_temp_c:32,
          segments:[{from_lap:1,to_lap:12,state:"LIGHT_RAIN"}],
          wet_race:true,
        },
        selections:{
          ...base.raceWeekendState.race_strategy.selections,
          D1:{...base.raceWeekendState.race_strategy.selections.D1,start_tyre_id:"gy_i",pit_plan:"no_stop"},
        },
      },
    },
  };
  let gs=createLiveRaceState(base,{gp});
  gs=advanceTo(gs,4);
  const feedback=gs.raceWeekendState.live_race.events.filter((event)=>event.type==="driver_feedback"&&event.driver_id==="D1");
  assert.equal(feedback.some((event)=>/track is drying|overheating/i.test(event.message)),false);
  const states=gs.raceWeekendState.live_race.projected_race
    .find((row)=>row.driver.driver_id==="D1")
    .tyre_state_by_lap.slice(0,4);
  assert.ok(states.some((state)=>Number(state.wetness_delta)>0));
  assert.ok(states.some((state)=>Number(state.rain_intensity)>0));
});

test("RW5.2D3 live race reports the start and strengthening of rain",()=>{
  let base=fixture("rw5.2d3-weather-report");
  base={
    ...base,
    raceWeekendState:{
      ...base.raceWeekendState,
      race_strategy:{
        ...base.raceWeekendState.race_strategy,
        weather_snapshot:{
          ...base.raceWeekendState.race_strategy.weather_snapshot,
          state:"SUNNY",
          starting_track_wetness:0,
          starting_air_temp_c:25,
          starting_track_temp_c:34,
          segments:[
            {from_lap:1,to_lap:4,state:"SUNNY"},
            {from_lap:5,to_lap:12,state:"LIGHT_RAIN"},
          ],
          wet_race:true,
        },
      },
    },
  };
  let gs=createLiveRaceState(base,{gp});
  gs=advanceTo(gs,9);
  const reports=gs.raceWeekendState.live_race.events.filter((event)=>event.type==="weather_report");
  assert.ok(reports.some((event)=>event.report_kind==="rain_started"));
  assert.ok(reports.some((event)=>event.report_kind==="rain_rising"));
  const started=reports.find((event)=>event.report_kind==="rain_started");
  assert.equal(started.lap,5);
  assert.ok(started.rain_intensity>0&&started.rain_intensity<0.30);
  assert.match(started.message,/rain has started/i);
});

test("RW5.2D3 an in-progress v2 live save upgrades its future environment without a new career",()=>{
  let gs=createLiveRaceState(fixture("rw5.2d3-live-save-upgrade"),{gp});
  gs=advanceTo(gs,2);
  const live=gs.raceWeekendState.live_race;
  const plan=gs.raceWeekendState.race_strategy.race_control_plan;
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      race_strategy:{
        ...gs.raceWeekendState.race_strategy,
        race_control_plan:{
          ...plan,
          version:2,
          environment_model:null,
          weather_timeline:(plan.weather_timeline||[]).map((row)=>({
            lap:row.lap,state:row.state,rain_intensity:row.rain_intensity,
            track_wetness:row.track_wetness,rubber_level:row.rubber_level,
            grip_index:row.grip_index,visibility_index:row.visibility_index,
          })),
        },
      },
      live_race:{...live,version:2},
    },
  };
  const stored=prepareGameStateForSave(gs);
  let loaded=extractGameStateFromStoredSave({meta:{name:"D3 old live save"},gameState:stored});
  loaded=advanceTo(loaded,3);
  assert.equal(loaded.raceWeekendState.live_race.version,3);
  assert.equal(loaded.raceWeekendState.race_strategy.race_control_plan.version,3);
  assert.equal(loaded.raceWeekendState.race_strategy.race_control_plan.environment_model,"rw5.2d3.1");
  assert.ok(Number.isFinite(Number(loaded.raceWeekendState.live_race.track_state.track_temp_c)));
  assert.ok(Number.isFinite(Number(loaded.raceWeekendState.live_race.track_state.spray_index)));
});

test("RW5.2A pending player order can be cancelled before it takes effect",()=>{
  let gs=createLiveRaceState(fixture("cancel-order"),{gp});
  gs=advanceLiveRace(gs,{gp,laps:2});
  gs=issueLiveRaceCommand(gs,{driverId:"D1",type:"pit",tyreId:"gy_s"});
  assert.equal(gs.raceWeekendState.race_strategy.live_commands.D1.filter((row)=>row.type==="pit").length,1);
  gs=cancelLiveRaceCommand(gs,{driverId:"D1"});
  assert.equal(gs.raceWeekendState.race_strategy.live_commands.D1.filter((row)=>row.type==="pit").length,0);
  assert.equal(gs.raceWeekendState.live_race.events.at(-1).type,"command_cancelled");
  assert.match(gs.raceWeekendState.live_race.events.at(-1).message,/cancelled/i);
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


test("RW4.11 local yellow is followed by an observed green-flag event",()=>{
  let gs=createLiveRaceState(fixture("rw4.11-yellow-green"),{gp});
  gs=advanceTo(gs,1);
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      race_strategy:{
        ...gs.raceWeekendState.race_strategy,
        race_control_plan:{
          ...gs.raceWeekendState.race_strategy.race_control_plan,
          periods:[{type:"LOCAL_YELLOW",from_lap:1,to_lap:1,cause:"incident",priority:3}],
          incidents:[],
        },
      },
      live_race:{
        ...gs.raceWeekendState.live_race,
        current_control:"LOCAL_YELLOW",
        events:[
          ...(gs.raceWeekendState.live_race.events||[]),
          {lap:1,type:"race_control",control_type:"LOCAL_YELLOW",message:"Yellow flag — Race control intervention."},
        ],
      },
    },
  };

  gs=advanceTo(gs,2);
  const green=(gs.raceWeekendState.live_race.events||[]).find(
    (event)=>event.control_type==="GREEN"&&Number(event.lap)===2
  );
  assert.ok(green,"a one-lap yellow must explicitly return to green on the following lap");
  assert.match(green.message,/green flag/i);
});

test("RW4.11 Race Feed history is not truncated after 100 observed events",()=>{
  let gs=createLiveRaceState(fixture("rw4.11-event-history"),{gp});
  gs=advanceTo(gs,2);
  const historical=Array.from({length:120},(_,index)=>({
    lap:Math.min(2,index%3),
    type:"history_test",
    event_key:`history:${index}`,
    message:`Observed event ${index}`,
  }));
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      live_race:{...gs.raceWeekendState.live_race,events:historical},
    },
  };
  gs=issueLiveRaceCommand(gs,{driverId:"D1",type:"pace",paceMode:"attack"});
  assert.equal(gs.raceWeekendState.live_race.events.length,121);
  assert.equal(gs.raceWeekendState.live_race.events[0].event_key,"history:0");
  assert.equal(gs.raceWeekendState.live_race.events.at(-1).type,"command");

  const stored=prepareGameStateForSave(gs);
  const loaded=extractGameStateFromStoredSave({meta:{name:"RW4.11 full race history"},gameState:stored});
  assert.equal(loaded.raceWeekendState.live_race.events.length,121);
  assert.equal(loaded.raceWeekendState.live_race.events[0].event_key,"history:0");
});

test("RW5.2D4.4 red flag requires explicit restart preparation before resuming",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  const plan=gs.raceWeekendState.race_strategy.race_control_plan;
  const beforeRows=gs.raceWeekendState.live_race.classification;
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      live_race:{
        ...gs.raceWeekendState.live_race,
        status:"red_flag",
        current_lap:5,
        current_sector:2,
        current_control:"RED_FLAG",
        red_flag_period:{type:"RED_FLAG",from_lap:5,from_sector:2,to_lap:5,cause:"incident"},
      },
    },
  };

  const blocked=advanceLiveRaceSector(gs,{gp,sectors:1});
  assert.equal(blocked.raceWeekendState.live_race.current_lap,5);
  assert.equal(blocked.raceWeekendState.live_race.current_sector,2);

  const premature=resumeLiveRace(gs);
  assert.equal(premature.raceWeekendState.live_race.status,"red_flag");

  const firstCheck=assessLiveRaceRestart(gs);
  assert.equal(firstCheck.raceWeekendState.live_race.status,"red_flag");
  assert.equal(firstCheck.raceWeekendState.live_race.red_flag_lifecycle.restart_monitor.restart_authorized,true);

  const prepared=prepareLiveRaceRestart(firstCheck);
  assert.equal(prepared.raceWeekendState.live_race.status,"red_flag");
  assert.equal(prepared.raceWeekendState.live_race.red_flag_lifecycle.phase,"restart_pending");
  assert.equal(prepared.raceWeekendState.live_race.red_flag_lifecycle.race_progress_frozen,true);

  const stored=prepareGameStateForSave(prepared);
  const loaded=extractGameStateFromStoredSave({meta:{name:"D4.4 suspended save"},gameState:stored});
  assert.equal(loaded.raceWeekendState.live_race.status,"red_flag");
  assert.equal(loaded.raceWeekendState.live_race.red_flag_lifecycle.phase,"restart_pending");
  assert.equal(loaded.raceWeekendState.live_race.current_lap,5);
  assert.equal(loaded.raceWeekendState.live_race.current_sector,2);

  const resumed=resumeLiveRace(loaded);
  assert.equal(resumed.raceWeekendState.live_race.status,"running");
  assert.equal(resumed.raceWeekendState.live_race.current_lap,5);
  assert.equal(resumed.raceWeekendState.live_race.current_sector,2);
  assert.deepEqual(resumed.raceWeekendState.race_strategy.race_control_plan,plan);
  assert.equal(resumed.raceWeekendState.live_race.red_flag_lifecycle,null);
  assert.equal(resumed.raceWeekendState.live_race.red_flag_history.length,1);
  assert.equal(resumed.raceWeekendState.live_race.red_flag_history[0].phase,"resumed");
  assert.equal(resumed.raceWeekendState.live_race.events.at(-1).type,"restart");

  // A restart is a lifecycle transition, not a rebuild of the classification.
  assert.deepEqual(resumed.raceWeekendState.live_race.classification,beforeRows);
});


test("finalized live rows preserve exactly the retirements visible to the player",()=>{
  let gs=createLiveRaceState(fixture(),{gp});
  gs=advanceTo(gs,12);
  const live=gs.raceWeekendState.live_race;
  const retiredId=live.classification.at(-1).driver_id;
  const forced=live.classification.map((row,index)=>index===live.classification.length-1
    ? {...row,retired:true,status:"DNF",retirement_reason:"Engine",incident_lap:1}
    : {...row,retired:false,status:"RUNNING",retirement_reason:null,incident_lap:null}
  );
  const projectedWithFuturePits=live.projected_race.map((row)=>{
    const did=String(row?.driver?.driver_id||"");
    if(did!==String(retiredId))return row;
    return {
      ...row,
      pit_stops:[
        {lap:2,tyre_from:"gy_h",tyre_to:"gy_s",total_loss_s:24},
        {lap:8,tyre_from:"gy_s",tyre_to:"gy_h",total_loss_s:24},
      ],
      lap_times_ms:Array.from({length:12},()=>90000),
      tyre_state_by_lap:Array.from({length:12},(_,index)=>({lap:index+1,condition:100-index})),
      strategy_decisions:[{lap:2,type:"pit"},{lap:8,type:"pit"}],
      stints:[
        {compound:"Hard",start_lap:1,end_lap:1,laps:1},
        {compound:"Soft",start_lap:2,end_lap:7,laps:6},
      ],
      strategy_summary:{
        pit_count:2,
        pit_stops:2,
        pit_laps:[2,8],
        used_tyres:["Hard","Soft"],
        refuelled:true,
        refuel_count:2,
        fuel_stop_laps:[2,8],
        lowest_tyre_condition:12,
        strategy_decisions:[{lap:2,type:"pit"},{lap:8,type:"pit"}],
      },
    };
  });
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      live_race:{
        ...live,
        status:"finished",
        current_lap:live.total_laps,
        classification:forced,
        projected_race:projectedWithFuturePits,
      },
    },
  };
  const rows=finalizedLiveRaceRows(gs);
  assert.equal(rows.filter((row)=>row.retired).length,1);
  const retired=rows.find((row)=>row.retired);
  assert.equal(retired.retirement_reason,"Engine");
  assert.equal(retired.incident_lap,1);
  assert.equal(retired.laps_completed,0);
  assert.equal(retired.pit_stops.length,0,"a lap-one DNF cannot retain future simulated pit stops");
  assert.equal(retired.lap_times_ms.length,0);
  assert.equal(retired.tyre_state_by_lap.length,0);
  assert.equal(retired.strategy_decisions.length,0);
  assert.equal(retired.strategy_summary.pit_count,0);
  assert.equal(retired.strategy_summary.pit_stops,0);
  assert.deepEqual(retired.strategy_summary.pit_laps,[]);
  assert.deepEqual(retired.strategy_summary.used_tyres,["Hard"]);
  assert.equal(retired.strategy_summary.refuelled,false);
  assert.equal(retired.strategy_summary.refuel_count,0);
  assert.deepEqual(retired.strategy_summary.fuel_stop_laps,[]);
  assert.deepEqual(retired.strategy_summary.strategy_decisions,[]);
  assert.equal(retired.strategy_summary.lowest_tyre_condition,100);
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
  assert.ok(Number.isFinite(leader.projected_finish_best));
  assert.ok(Number.isFinite(leader.projected_finish_worst));
  assert.equal(leader.projection_source,"observed_live_state");
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

test("RW4.10 finish projection ignores hidden final classification and future-only fields",()=>{
  const observed=[
    {
      driver_id:"D1",position:2,elapsed_ms:360000,recent_pace_ms:90000,current_pace:"balanced",next_pace:"attack",
      tyre:{condition:72},observed_tyre_wear_per_lap:2.1,observed_sample_count:4,expected_future_pit_loss_s:12,
      pit_window:{target_lap:8},
      hidden_final_position:4,
      future_lap_times_ms:[85000,84000,83000],
    },
    {
      driver_id:"D2",position:1,elapsed_ms:357000,recent_pace_ms:90500,current_pace:"balanced",next_pace:"balanced",
      tyre:{condition:81},observed_tyre_wear_per_lap:1.4,observed_sample_count:4,expected_future_pit_loss_s:0,
      pit_window:null,
      hidden_final_position:1,
      future_lap_times_ms:[99000,99000,99000],
    },
    {
      driver_id:"D3",position:3,elapsed_ms:365000,recent_pace_ms:89200,current_pace:"attack",next_pace:"attack",
      tyre:{condition:60},observed_tyre_wear_per_lap:2.8,observed_sample_count:3,expected_future_pit_loss_s:0,
      pit_window:null,
      hidden_final_position:2,
      future_lap_times_ms:[70000,70000,70000],
    },
  ];
  const first=projectObservedRaceState(observed,{lap:4,totalLaps:12,forecastConfidencePct:58});

  const altered=structuredClone(observed);
  altered[0].hidden_final_position=1;
  altered[1].hidden_final_position=4;
  altered[2].hidden_final_position=1;
  altered[0].future_lap_times_ms=[20000,20000,20000];
  altered[1].future_lap_times_ms=[200000,200000,200000];
  altered[2].future_lap_times_ms=[30000,30000,30000];

  const second=projectObservedRaceState(altered,{lap:4,totalLaps:12,forecastConfidencePct:58});
  assert.deepEqual(
    second.map((row)=>({
      id:row.driver_id,
      projected:row.projected_finish_position,
      best:row.projected_finish_best,
      worst:row.projected_finish_worst,
      elapsed:row.projected_elapsed_ms,
    })),
    first.map((row)=>({
      id:row.driver_id,
      projected:row.projected_finish_position,
      best:row.projected_finish_best,
      worst:row.projected_finish_worst,
      elapsed:row.projected_elapsed_ms,
    })),
    "player-facing projection must not consume hidden final positions or future lap times"
  );
});

test("RW4.10 live timing exposes projection range, confidence and traffic-aware pit rejoin",()=>{
  let gs=createLiveRaceState(fixture("rw4.10-projection"),{gp});
  gs=advanceTo(gs,4);
  const rows=gs.raceWeekendState.live_race.classification;
  const player=rows.find((row)=>row.driver_id==="D1");
  assert.ok(player);
  assert.equal(player.projection_source,"observed_live_state");
  assert.ok(Number.isFinite(player.projected_finish_position));
  assert.ok(Number.isFinite(player.projected_finish_best));
  assert.ok(Number.isFinite(player.projected_finish_worst));
  assert.ok(player.projected_finish_best<=player.projected_finish_position);
  assert.ok(player.projected_finish_worst>=player.projected_finish_position);
  assert.ok(Number.isFinite(player.projection_confidence_pct));
  assert.ok(Number.isFinite(player.recent_pace_ms)&&player.recent_pace_ms>0);
  assert.ok(Number.isFinite(player.pit_rejoin_position));
  assert.ok(Number.isFinite(player.pit_rejoin_best));
  assert.ok(Number.isFinite(player.pit_rejoin_worst));
  assert.ok(player.pit_rejoin_best<=player.pit_rejoin_position);
  assert.ok(player.pit_rejoin_worst>=player.pit_rejoin_position);
  assert.ok(Number.isFinite(player.pit_rejoin_traffic_count));
});

test("RW4.10 observed tyre snapshots cannot be rewritten by a future pace command",()=>{
  let base=createLiveRaceState(fixture("rw4.10-tyre-snapshot"),{gp});
  base=advanceTo(base,4);
  const beforeRace=base.raceWeekendState.live_race.projected_race.find((row)=>row.driver.driver_id==="D1");
  const beforeSnapshot=structuredClone(beforeRace.tyre_state_by_lap.find((row)=>row.lap===4));
  assert.ok(beforeSnapshot);
  assert.equal(
    base.raceWeekendState.live_race.classification.find((row)=>row.driver_id==="D1").tyre.source,
    "observed_lap_snapshot"
  );

  let commanded=issueLiveRaceCommand(base,{driverId:"D1",type:"pace",paceMode:"attack"});
  commanded=advanceTo(commanded,5);
  const afterRace=commanded.raceWeekendState.live_race.projected_race.find((row)=>row.driver.driver_id==="D1");
  const afterSnapshot=afterRace.tyre_state_by_lap.find((row)=>row.lap===4);
  assert.deepEqual(afterSnapshot,beforeSnapshot,"a command effective from lap 5 must not rewrite the observed tyre state from lap 4");
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


test("RW6.5 playback speed ladder is bounded and progressively faster",()=>{
  assert.deepEqual(RACE_PLAYBACK_SPEEDS,[1,2,4,8]);
  const delays=RACE_PLAYBACK_SPEEDS.map(racePlaybackDelayMs);
  assert.deepEqual(delays,[9000,4500,2250,1125]);
  assert.equal(racePlaybackDelayMs(999),9000);
});

test("RW6.5 autoplay only runs while the live race is in running state",()=>{
  assert.equal(racePlaybackCanRun({status:"running",current_lap:10,total_laps:20}),true);
  assert.equal(racePlaybackCanRun({status:"red_flag",current_lap:10,total_laps:20}),false);
  assert.equal(racePlaybackCanRun({status:"finished",current_lap:20,total_laps:20}),false);
  assert.equal(racePlaybackCanRun(null),false);
});


test("RW6.6 motion duration bridges playback ticks without long idle gaps",()=>{
  for(const speed of RACE_PLAYBACK_SPEEDS){
    const delay=racePlaybackDelayMs(speed);
    const motion=raceMotionDurationMs(speed);
    assert.ok(motion>=delay,`motion should cover the full ${speed}x playback interval`);
    assert.ok(motion-delay<=100,`motion should not lag far behind at ${speed}x`);
  }
});

test("RW6.6 track progress unwrap crosses start-finish in the forward direction",()=>{
  assert.ok(Math.abs(unwrapTrackProgress(.92,.08)-1.08)<1e-9);
  assert.ok(Math.abs(unwrapTrackProgress(1.08,.34)-1.34)<1e-9);
});

test("RW6.6 track progress preserves small backwards corrections for live gaps",()=>{
  assert.ok(Math.abs(unwrapTrackProgress(.52,.49)-.49)<1e-9);
});

test("RW6.6 invalid visual targets keep the last usable progress",()=>{
  assert.equal(unwrapTrackProgress(.42,Number.NaN),.42);
  assert.equal(unwrapTrackProgress(Number.NaN,.31),.31);
});


test("RW6.6A player feedback and critical popups require playback pause",()=>{
  const context={playerTeamId:"t_player",playerDriverIds:["d_a","d_b"]};
  assert.equal(raceEventRequiresPause({type:"driver_feedback",driver_id:"d_a"},context),true);
  assert.equal(raceEventRequiresPause({type:"driver_feedback",driver_id:"d_other"},context),false);
  assert.equal(raceEventRequiresPause({type:"incident",driver_id:"d_other"},context),true);
  assert.equal(raceEventRequiresPause({type:"weather_report",report_kind:"rain_started"},context),true);
  assert.equal(raceEventRequiresPause({type:"race_control",control_type:"SAFETY_CAR"},context),true);
  assert.equal(raceEventRequiresPause({type:"race_control",control_type:"GREEN"},context),false);
});

test("RW6.6A event batches pause if any contained event requires attention",()=>{
  const context={playerTeamId:"t_player",playerDriverIds:["d_a"]};
  assert.equal(raceEventRequiresPause({
    type:"event_batch",
    events:[
      {type:"position_change",driver_id:"d_other"},
      {type:"driver_feedback",driver_id:"d_a"},
    ],
  },context),true);
});

test("RW6.6A retired cars stay visible through the incident then clear under green",()=>{
  const row={retired:true,incident_lap:5,incident_sector:2};
  assert.equal(retiredCarVisibleOnTrack(row,{currentLap:5,currentSector:2,currentControl:"GREEN"}),true);
  assert.equal(retiredCarVisibleOnTrack(row,{currentLap:5,currentSector:3,currentControl:"GREEN"}),true);
  assert.equal(retiredCarVisibleOnTrack(row,{currentLap:6,currentSector:1,currentControl:"GREEN"}),false);
});

test("RW6.6A neutralised races keep retired cars visible for recovery",()=>{
  const row={retired:true,incident_lap:5,incident_sector:1};
  for(const control of ["SAFETY_CAR","VSC","RED_FLAG"]){
    assert.equal(retiredCarVisibleOnTrack(row,{currentLap:7,currentSector:3,currentControl:control}),true);
  }
  assert.equal(retiredCarVisibleOnTrack({retired:false},{currentLap:7,currentSector:3,currentControl:"GREEN"}),true);
});
