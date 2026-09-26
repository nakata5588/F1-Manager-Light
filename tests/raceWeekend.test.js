import test from "node:test";
import assert from "node:assert/strict";

import { createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "../src/core/saveSafety.js";
import {
  completePracticeSession,
  completeQualifyingSession,
  completeRaceSession,
  continueRaceWeekendSession,
  createRaceWeekendState,
  raceWeekendSchedule,
  setPracticeProgramme,
  syncRaceWeekendPhaseForDate,
} from "../src/engine/RaceWeekendEngine.js";
import { PRACTICE_PROGRAMMES, teamEngineeringSupport, trackSetupProfile } from "../src/engine/PracticeSetupEngine.js";
import { conditionModifier, practiceWeekendImpact } from "../src/domain/driverPerformance.js";
import { normalizePhysicalPartState, partUnitById } from "../src/domain/partUnits.js";
import { normalizeRaceWeekendResumeState, raceWeekendCanFinalizeLiveRace, raceWindowForWeekend } from "../src/domain/raceWeekendResume.js";

const gp={
  gp_id:"monaco",
  gp_name:"Monaco Grand Prix",
  year:1980,
  race_date:"1980-05-18",
  dateISO:"1980-05-18",
  track_id:"monaco",
};

const defaultQualifyingRule={
  rule_id:"qual_1980_test",
  year:1980,
  strategy:"best_time_across_sessions",
  session_count:2,
  max_starters:24,
  practice_day_offset:-2,
  session_day_offsets:[-2,-1],
  grid_day_offset:-1,
  prequalifying_enabled:false,
  event_overrides:[],
};

function fixture({qualifyingRules=defaultQualifyingRule,currentDateISO="1980-05-16",seed="rw3-weekend"}={}){
  const teams=[
    {team_id:"T1",team_name:"Alpha"},
    {team_id:"T2",team_name:"Beta"},
  ];
  const drivers=[
    {driver_id:"D1",display_name:"Alpha One"},
    {driver_id:"D2",display_name:"Alpha Two"},
    {driver_id:"D3",display_name:"Beta One"},
    {driver_id:"D4",display_name:"Beta Two"},
  ];
  return {
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed}),
    activeYear:1980,
    currentDateISO,
    currentRound:0,
    calendar:[gp],
    team:teams[0],
    teams,
    drivers,
    qualifyingRules:{...qualifyingRules},
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"main_driver",status:"active",contract_start_year:1980,contract_until_year:1980},
      {year:1980,team_id:"T1",driver_id:"D2",role:"second_driver",status:"active",contract_start_year:1980,contract_until_year:1980},
      {year:1980,team_id:"T2",driver_id:"D3",role:"main_driver",status:"active",contract_start_year:1980,contract_until_year:1980},
      {year:1980,team_id:"T2",driver_id:"D4",role:"second_driver",status:"active",contract_start_year:1980,contract_until_year:1980},
    ],
    driverRatings:drivers.map((driver,index)=>({
      driver_id:driver.driver_id,
      pace:82-index,
      qualifying:84-index,
      racecraft:80-index,
      consistency:76,
      pressure_handling:75,
      adaptability:74,
      mentality:74,
      current_ability:80-index,
      start_launch:72,
      tire_management:72,
      race_intelligence:74,
      crash_likelihood:10,
      technical_feedback:78-index,
    })),
    driverAttributes:{},
    driverAvailability:{},
    medicalHistory:[],
    temporaryDriverAssignments:[],
    standings:{drivers:[],teams:[]},
    results:[],
    inbox:[],
    financeLog:[],
    finances:{balance:1_000_000,budget:1_000_000,season_spend:0,season_income:0},
    settings:{gameplay:{enableInjuryRandomEvents:true,enableFatalities:false}},
    pointsSystem:{table:[9,6,4,3]},
    carStats:[
      {year:1980,team_id:"T1",chassis_spec:80,aero_spec:82,gearbox_spec:80,suspension_spec:80,brakes_spec:80,reliability:92},
      {year:1980,team_id:"T2",chassis_spec:76,aero_spec:77,gearbox_spec:76,suspension_spec:76,brakes_spec:76,reliability:90},
    ],
    teamEngines:[
      {year:1980,team_id:"T1",power:82,reliability:94},
      {year:1980,team_id:"T2",power:78,reliability:92},
    ],
    facilities:[],
    sponsorsContracts:[],
    accidentModel:[{year:1980,damage_DNF_prob:0.08,injury_prob:0.02,fatality_prob:0.002}],
    eraSafety:[{year:1980,era_safety_index:0.42,car_safety:0.5,medical_response:0.6,marshals_quality:0.55}],
    staffContracts:[
      {year:1980,team_id:"T1",staff_id:"S1",role:"chief_engineer",contract_start:1979,contract_until:1982},
      {year:1980,team_id:"T2",staff_id:"S2",role:"chief_engineer",contract_start:1979,contract_until:1982},
    ],
    staffRatings:[
      {year:1980,staff_id:"S1",technical:92,data_analysis:88,communication:80,reliability_focus:90},
      {year:1980,staff_id:"S2",technical:62,data_analysis:60,communication:65,reliability_focus:62},
    ],
    coreTracks:[{
      track_id:"monaco",track_name:"Monaco",crash_risk:78,overtaking_difficulty:88,tyre_wear:62,lap_length_km:3.34,
    }],
    trackLayoutByYear:[{track_id:"monaco",year_from:1973,year_to:1985,lap_length_km:3.34,laps:76}],
    development:{
      parts:[
        {id:"P1",slot:"aero_front",perf:4,condition:100},
        {id:"P2",slot:"aero_front",perf:4,condition:100},
      ],
      projects:[],research:[],
    },
    garage:{
      cars:[
        {id:"car_1",kind:"race",driver_id:"D1",installedParts:{aero_front:"P1"}},
        {id:"car_2",kind:"race",driver_id:"D2",installedParts:{aero_front:"P2"}},
        {id:"car_spare",kind:"reserve",driver_id:null,installedParts:{}},
      ],
    },
  };
}

function startAfterPractice(options={}){
  let gs=createRaceWeekendState(fixture(options),{roundIndex:0,gp});
  gs=completePracticeSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"practice_complete");
  gs=continueRaceWeekendSession(gs);
  return gs;
}

function finish1980Qualifying(options={}){
  let gs=startAfterPractice(options);
  assert.equal(gs.raceWeekendState.phase,"qualifying");
  gs=completeQualifyingSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"qualifying_wait");
  gs={...gs,currentDateISO:"1980-05-17"};
  gs=continueRaceWeekendSession(gs);
  assert.equal(gs.raceWeekendState.phase,"qualifying");
  gs=completeQualifyingSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"qualifying_wait");
  assert.equal(gs.raceWeekendState.qualifying.status,"completed");
  assert.ok(gs.raceWeekendState.startingGrid.rows.length>0);
  gs=continueRaceWeekendSession(gs);
  assert.equal(gs.raceWeekendState.phase,"grid_ready");
  return gs;
}

test("RW3 1980 rule creates two timed Qualifying sessions and a persistent session list",()=>{
  const schedule=raceWeekendSchedule(gp,defaultQualifyingRule);
  assert.equal(schedule.practiceDate,"1980-05-16");
  assert.equal(schedule.qualifyingDate,"1980-05-16");
  assert.equal(schedule.raceDate,"1980-05-18");
  assert.deepEqual(
    schedule.sessions.map((row)=>[row.id,row.type,row.dateISO]),
    [
      ["practice","practice","1980-05-16"],
      ["qualifying_1","qualifying","1980-05-16"],
      ["qualifying_2","qualifying","1980-05-17"],
      ["grid","grid","1980-05-17"],
      ["race","race","1980-05-18"],
    ]
  );

  const gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  assert.equal(gs.raceWeekendState.qualifying_rule_snapshot.strategy,"best_time_across_sessions");
  assert.equal(gs.raceWeekendState.qualifying_rule_snapshot.session_count,2);
  assert.equal(gs.raceWeekendState.qualifying_rule_snapshot.max_starters,24);
  assert.equal(gs.raceWeekendState.sessions.length,5);
});

test("RW3.1 Practice always exposes its report before same-day Qualifying",()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  gs=completePracticeSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"practice_complete");
  assert.ok(gs.raceWeekendState.practice?.results?.length>0);

  gs=continueRaceWeekendSession(gs);
  assert.equal(gs.raceWeekendState.phase,"qualifying");
  assert.equal(gs.raceWeekendState.active_session_id,"qualifying_1");
  assert.equal(gs.currentDateISO,"1980-05-16","same-day transition must not advance the calendar");
});

test("RW3.1 event entry limits preserve historical car counts without pinning driver identities",()=>{
  const qualifyingRules={
    ...defaultQualifyingRule,
    team_entry_limits:{T2:1},
  };
  const gs=createRaceWeekendState(fixture({qualifyingRules}),{roundIndex:0,gp});
  const entries=gs.raceWeekendState.entrants.filter((row)=>row.status==="confirmed");
  assert.equal(entries.length,3);
  assert.equal(entries.filter((row)=>row.team_id==="T1").length,2);
  assert.equal(entries.filter((row)=>row.team_id==="T2").length,1);
  assert.equal(gs.raceEntryState.entry_limits.T2,1);
});

test("RW3 saves and restores between Qualifying sessions without recalculating Q1",()=>{
  let gs=startAfterPractice();
  gs=completeQualifyingSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"qualifying_wait");

  const q1=gs.raceWeekendState.sessions.find((row)=>row.id==="qualifying_1");
  assert.equal(q1.status,"completed");
  assert.equal(q1.results.length,4);

  const saved=prepareGameStateForSave(gs);
  let loaded=extractGameStateFromStoredSave({meta:{name:"RW3 between sessions"},gameState:saved});
  assert.deepEqual(
    loaded.raceWeekendState.sessions.find((row)=>row.id==="qualifying_1"),
    q1
  );

  loaded={...loaded,currentDateISO:"1980-05-17"};
  loaded=continueRaceWeekendSession(loaded);
  loaded=completeQualifyingSession(loaded,{gp});
  assert.equal(loaded.raceWeekendState.phase,"qualifying_wait");
  assert.equal(loaded.raceWeekendState.qualifying.status,"completed");
  assert.ok(loaded.raceWeekendState.startingGrid.rows.length>0);
  loaded=continueRaceWeekendSession(loaded);
  assert.equal(loaded.raceWeekendState.phase,"grid_ready");
  assert.deepEqual(
    loaded.raceWeekendState.sessions.find((row)=>row.id==="qualifying_1"),
    q1,
    "completed Q1 must remain byte-for-byte stable after Q2"
  );
});

test("Qualifying final report uses combined classification order and historical DNQ status",()=>{
  const qualifyingRules={...defaultQualifyingRule,max_starters:2};
  let gs=startAfterPractice({qualifyingRules});
  gs=completeQualifyingSession(gs,{gp});
  gs={...gs,currentDateISO:"1980-05-17"};
  gs=continueRaceWeekendSession(gs);
  gs=completeQualifyingSession(gs,{gp});

  assert.equal(gs.raceWeekendState.phase,"qualifying_wait");
  assert.equal(gs.raceWeekendState.qualifying.status,"completed");
  const finalSession=gs.raceWeekendState.sessions.find((row)=>row.id==="qualifying_2");
  const dnqRows=(finalSession.results||[]).filter((row)=>row.status==="DNQ");
  const qualifiedRows=(finalSession.results||[]).filter((row)=>row.status==="QUALIFIED");
  assert.equal(dnqRows.length,2);
  assert.equal(qualifiedRows.length,2);
  assert.equal(gs.raceWeekendState.startingGrid.rows.length,2);
  assert.deepEqual(
    finalSession.results.map((row)=>row.driver_id),
    gs.raceWeekendState.qualifying.classification
      .filter((row)=>finalSession.results.some((result)=>result.driver_id===row.driver_id))
      .map((row)=>row.driver_id),
    "the completed final report must follow the authoritative combined Qualifying classification"
  );
  assert.ok(finalSession.results.every((row)=>row.final_classification===true));
  assert.ok(finalSession.results.every((row)=>Number.isFinite(row.session_position)));
  assert.ok(finalSession.results.every((row)=>Number.isFinite(row.session_lap_time_ms)));

  gs=continueRaceWeekendSession(gs);
  assert.equal(gs.raceWeekendState.phase,"grid_ready");
});

test("RW3 1980 classification uses each driver's best time across sessions",()=>{
  const gs=finish1980Qualifying();
  const qSessions=gs.raceWeekendState.sessions.filter((row)=>row.type==="qualifying");
  assert.equal(qSessions.length,2);
  assert.ok(qSessions.every((row)=>row.status==="completed"));

  for(const row of gs.raceWeekendState.qualifying.classification){
    const times=qSessions.flatMap((session)=>
      (session.results||[])
        .filter((result)=>result.driver_id===row.driver_id)
        .map((result)=>result.lap_time_ms)
    );
    assert.equal(row.best_time_ms,Math.min(...times));
  }
});

test("RW3 grid limit produces DNQ and Starting Grid is a separate authoritative entity",()=>{
  const qualifyingRules={...defaultQualifyingRule,max_starters:2};
  const gs=finish1980Qualifying({qualifyingRules});
  const classification=gs.raceWeekendState.qualifying.classification;
  const starters=classification.filter((row)=>row.status==="QUALIFIED");
  const dnq=classification.filter((row)=>row.status==="DNQ");

  assert.equal(starters.length,2);
  assert.equal(dnq.length,2);
  assert.equal(gs.raceWeekendState.startingGrid.status,"final");
  assert.equal(gs.raceWeekendState.startingGrid.rows.length,2);
  assert.deepEqual(
    gs.raceWeekendState.grid,
    gs.raceWeekendState.startingGrid.rows,
    "legacy grid alias must point at the persisted Starting Grid rows"
  );
});

test("RW3.2 qualifying sessions add fatigue on top of Practice load",()=>{
  let gs=startAfterPractice();
  const beforeQ1=gs.driverAttributes.D1.fatigue;
  gs=completeQualifyingSession(gs,{gp});
  assert.equal(gs.driverAttributes.D1.fatigue,beforeQ1+3);

  gs={...gs,currentDateISO:"1980-05-17"};
  gs=continueRaceWeekendSession(gs);
  const beforeQ2=gs.driverAttributes.D1.fatigue;
  gs=completeQualifyingSession(gs,{gp});
  assert.equal(gs.driverAttributes.D1.fatigue,beforeQ2+3);
});

test("RW3 player and AI drivers run through exactly the same qualifying sessions",()=>{
  const gs=finish1980Qualifying();
  const qSessions=gs.raceWeekendState.sessions.filter((row)=>row.type==="qualifying");
  for(const session of qSessions){
    const ids=new Set(session.results.map((row)=>row.driver_id));
    assert.deepEqual([...ids].sort(),["D1","D2","D3","D4"]);
    assert.ok(session.results.every((row)=>Number.isFinite(row.lap_time_ms)&&row.lap_time_ms>0));
  }
  assert.equal(qSessions[0].results.filter((row)=>row.team_id==="T1").length,2);
  assert.equal(qSessions[0].results.filter((row)=>row.team_id==="T2").length,2);
});

test("RW3 qualifying is deterministic for the same Save seed across session boundaries",()=>{
  const a=finish1980Qualifying({seed:"rw3-deterministic"});
  const b=finish1980Qualifying({seed:"rw3-deterministic"});
  assert.deepEqual(a.raceWeekendState.sessions,b.raceWeekendState.sessions);
  assert.deepEqual(a.raceWeekendState.qualifying,b.raceWeekendState.qualifying);
  assert.deepEqual(a.raceWeekendState.startingGrid,b.raceWeekendState.startingGrid);
});

test("RW3 Race consumes exactly the saved Starting Grid and never re-runs Qualifying",async()=>{
  let gs=finish1980Qualifying();
  const originalClassification=structuredClone(gs.raceWeekendState.qualifying.classification);
  const reversed=gs.raceWeekendState.startingGrid.rows
    .slice()
    .reverse()
    .map((row,index)=>({...row,grid:index+1}));
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      startingGrid:{...gs.raceWeekendState.startingGrid,rows:reversed},
      grid:reversed,
    },
  };

  gs=syncRaceWeekendPhaseForDate({...gs,currentDateISO:"1980-05-18"},"1980-05-18");
  assert.equal(gs.raceWeekendState.phase,"race");
  gs=await completeRaceSession(gs,{gp});

  assert.equal(gs.raceWeekendState.phase,"results");
  assert.deepEqual(
    gs.results[0].startingGrid.map((row)=>row.driver_id),
    reversed.map((row)=>row.driver_id)
  );
  assert.deepEqual(
    gs.results[0].qualifying.map((row)=>row.driver_id),
    originalClassification.map((row)=>row.driver_id),
    "Qualifying Classification must remain distinct from a subsequently adjusted Starting Grid"
  );
});

test("RW3 pre-qualifying is rule-driven and can eliminate DNPQ before main Qualifying",()=>{
  const qualifyingRules={
    ...defaultQualifyingRule,
    rule_id:"prequal-test",
    session_count:1,
    max_starters:2,
    practice_day_offset:-3,
    session_day_offsets:[-1],
    prequalifying_enabled:true,
    prequalifying_day_offset:-2,
    prequalifying_advance_count:3,
  };
  let gs=startAfterPractice({qualifyingRules,currentDateISO:"1980-05-15"});
  assert.equal(gs.raceWeekendState.phase,"practice_complete");

  gs={...gs,currentDateISO:"1980-05-16"};
  gs=continueRaceWeekendSession(gs);
  assert.equal(gs.raceWeekendState.phase,"qualifying");
  assert.equal(gs.raceWeekendState.active_session_id,"prequalifying");
  gs=completeQualifyingSession(gs,{gp});

  const prequal=gs.raceWeekendState.sessions.find((row)=>row.id==="prequalifying");
  assert.equal(prequal.results.filter((row)=>row.status==="ADVANCED").length,3);
  assert.equal(prequal.results.filter((row)=>row.status==="DNPQ").length,1);
  assert.equal(gs.raceWeekendState.phase,"qualifying_wait");

  gs={...gs,currentDateISO:"1980-05-17"};
  gs=continueRaceWeekendSession(gs);
  gs=completeQualifyingSession(gs,{gp});
  assert.equal(gs.raceWeekendState.qualifying.classification.filter((row)=>row.status==="DNPQ").length,1);
  assert.equal(gs.raceWeekendState.qualifying.classification.filter((row)=>row.status==="DNQ").length,1);
  assert.equal(gs.raceWeekendState.startingGrid.rows.length,2);
});

test("results remain visible until calendar advances beyond race day",async()=>{
  let gs=finish1980Qualifying();
  gs=syncRaceWeekendPhaseForDate({...gs,currentDateISO:"1980-05-18"},"1980-05-18");
  const playerTeam=structuredClone(gs.team);
  gs=await completeRaceSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"results");
  assert.deepEqual(gs.team,playerTeam,"race finalisation must preserve the player team identity used by shell branding");

  const sameDay=syncRaceWeekendPhaseForDate(gs,"1980-05-18");
  assert.equal(sameDay.raceWeekendState.phase,"results");
  const nextDay=syncRaceWeekendPhaseForDate({...gs,currentDateISO:"1980-05-19"},"1980-05-19");
  assert.equal(nextDay.raceWeekendState.phase,"completed");
});

test("RW2 derives circuit setup demands and uses live technical staff support",()=>{
  const gs=fixture();
  const profile=trackSetupProfile(gs,gp);
  assert.equal(profile.source,"derived_gameplay_profile");
  assert.equal(profile.inputs.crash_risk,78);
  assert.equal(profile.inputs.overtaking_difficulty,88);
  assert.notEqual(profile.target.aeroBalance,50);
  assert.ok(teamEngineeringSupport(gs,"T1")>teamEngineeringSupport(gs,"T2"));
});

test("RW2 player Practice programmes create setup knowledge, Preparation, fatigue and differentiated wear",()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  gs=setPracticeProgramme(gs,{driverId:"D1",programmeId:"reliability"});
  gs=setPracticeProgramme(gs,{driverId:"D2",programmeId:"race"});

  gs=normalizePhysicalPartState(gs);
  const beforeD1=conditionModifier(gs,"D1");
  const unitP1=gs.garage.cars.find((row)=>row.id==="car_1").installedParts.aero_front;
  const unitP2=gs.garage.cars.find((row)=>row.id==="car_2").installedParts.aero_front;
  const beforeP1=partUnitById(gs,unitP1).condition;
  const beforeP2=partUnitById(gs,unitP2).condition;

  gs=completePracticeSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"practice_complete");
  const d1=gs.raceWeekendState.practice.results.find((row)=>row.driver_id==="D1");
  const d2=gs.raceWeekendState.practice.results.find((row)=>row.driver_id==="D2");
  assert.equal(d1.programme_id,"reliability");
  assert.equal(d2.programme_id,"race");
  assert.ok(d1.setup_knowledge>0);
  assert.ok(d1.setup_quality>=25&&d1.setup_quality<=100);
  assert.ok(d1.preparation_gain>0);
  assert.ok(gs.driverAttributes.D1.preparation>50);
  assert.ok(gs.driverAttributes.D1.fatigue>0);
  assert.equal(d1.fatigue_before,0);
  assert.equal(d1.fatigue_after,PRACTICE_PROGRAMMES.reliability.fatigue);
  assert.ok(d1.fatigue_efficiency>0&&d1.fatigue_efficiency<=100);
  assert.ok(d1.component_wear.total_wear>0);
  assert.ok(Number.isFinite(d1.component_wear.lowest_condition));
  assert.ok(conditionModifier(gs,"D1")>beforeD1,"Preparation should now improve live driver performance");
  const reliabilityImpact=practiceWeekendImpact(gs,"D1");
  const raceImpact=practiceWeekendImpact(gs,"D2");
  assert.ok(Number.isFinite(reliabilityImpact.qualifying)&&Number.isFinite(reliabilityImpact.race));
  assert.ok(raceImpact.race>reliabilityImpact.race,"Race Focus should create a larger direct race-session Practice bonus");

  const afterP1=partUnitById(gs,unitP1).condition;
  const afterP2=partUnitById(gs,unitP2).condition;
  assert.ok(afterP1<beforeP1,"Practice should wear installed components");
  assert.ok(afterP2<beforeP2,"Practice should wear installed components");
  assert.ok((beforeP2-afterP2)>(beforeP1-afterP1),"Race Focus should create more Practice wear than Reliability Focus");
});

test("RW2 AI teams use the same Practice programme catalogue without player-only bonuses",()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  gs=setPracticeProgramme(gs,{driverId:"D1",programmeId:"qualifying"});
  gs=completePracticeSession(gs,{gp});

  const player=gs.raceWeekendState.practice.results.find((row)=>row.driver_id==="D1");
  const ai=gs.raceWeekendState.practice.results.find((row)=>row.driver_id==="D3");
  assert.equal(player.programme_id,"qualifying");
  assert.ok(Object.prototype.hasOwnProperty.call(PRACTICE_PROGRAMMES,ai.programme_id));
  assert.ok(Number.isFinite(ai.setup_quality));
  assert.ok(Number.isFinite(ai.setup_knowledge));
  assert.ok(Number.isFinite(ai.engineering_support));
});

test("RW2 Practice state survives save/load with programme selections and setup results",()=>{
  let gs=createRaceWeekendState(fixture(),{roundIndex:0,gp});
  gs=setPracticeProgramme(gs,{driverId:"D1",programmeId:"setup"});
  gs=completePracticeSession(gs,{gp});

  const saved=prepareGameStateForSave(gs);
  const loaded=extractGameStateFromStoredSave({meta:{name:"RW2 Practice"},gameState:saved});
  assert.equal(loaded.raceWeekendState.practice_selections.D1,"setup");
  assert.deepEqual(loaded.raceWeekendState.practice,gs.raceWeekendState.practice);
  assert.equal(loaded.driverAttributes.D1.preparation,gs.driverAttributes.D1.preparation);
  assert.deepEqual(loaded.garage,gs.garage,"component condition must survive save/load");
});


test("RW4.3 weekend weather persists across Practice and Qualifying and refreshes the Race forecast",()=>{
  let gs=createRaceWeekendState(fixture({seed:"rw4.3-integration"}),{roundIndex:0,gp});
  assert.deepEqual(
    Object.keys(gs.raceWeekendState.weekend_weather.sessions),
    ["practice","qualifying_1","qualifying_2","race"]
  );
  assert.equal(gs.raceWeekendState.race_strategy.weather_snapshot.source,"weekend_weather_world");
  assert.equal(gs.raceWeekendState.weekend_weather.forecast_revision,0);

  gs=completePracticeSession(gs,{gp});
  assert.equal(gs.raceWeekendState.weekend_weather.forecast_revision,1);
  assert.ok(gs.raceWeekendState.weekend_weather.observed_sessions.includes("practice"));

  gs=continueRaceWeekendSession(gs);
  gs=completeQualifyingSession(gs,{gp});
  assert.equal(gs.raceWeekendState.weekend_weather.forecast_revision,2);
  const q1=gs.raceWeekendState.sessions.find((row)=>row.id==="qualifying_1");
  assert.ok(q1.results.every((row)=>row.weather_state));
  assert.ok(q1.results.every((row)=>Number.isFinite(row.track_wetness)));

  gs={...gs,currentDateISO:"1980-05-17"};
  gs=continueRaceWeekendSession(gs);
  gs=completeQualifyingSession(gs,{gp});
  assert.equal(gs.raceWeekendState.weekend_weather.forecast_revision,3);
  assert.equal(gs.raceWeekendState.phase,"qualifying_wait");
  assert.equal(gs.raceWeekendState.race_strategy.forecast_revision_used,3);
  gs=continueRaceWeekendSession(gs);
  assert.equal(gs.raceWeekendState.phase,"grid_ready");
  assert.ok(gs.raceWeekendState.weekend_weather.forecast.race);
});


test("refresh recovery keeps an active Live Race authoritative over stale weekend sessions", () => {
  for (const stalePhase of ["practice", "practice_complete", "qualifying", "qualifying_wait", "grid_ready"]) {
    const liveRace = {
      status: "running",
      current_lap: 17,
      current_sector: 2,
      classification: [{ driver_id: "D1", position: 1 }],
    };
    const weekend = {
      phase: stalePhase,
      active_session_id: "qualifying_2",
      live_race: liveRace,
    };

    const resumed = normalizeRaceWeekendResumeState(weekend);

    assert.equal(resumed.phase, "race");
    assert.equal(resumed.active_session_id, "race");
    assert.equal(resumed.live_race, liveRace);
    assert.equal(resumed.live_race.current_lap, 17);
    assert.equal(resumed.live_race.current_sector, 2);
    assert.equal(raceWindowForWeekend(resumed), "live");
    assert.equal(raceWindowForWeekend(weekend), "live");
  }
});

test("refresh recovery does not reopen a finished Live Race over Results", () => {
  const weekend = {
    phase: "results",
    active_session_id: null,
    live_race: {
      status: "finished",
      current_lap: 76,
      current_sector: 3,
    },
  };

  const resumed = normalizeRaceWeekendResumeState(weekend);

  assert.equal(resumed, weekend);
  assert.equal(raceWindowForWeekend(resumed), "classification");
});


test("finished live race exposes an explicit finalization gate",()=>{
  const weekend={
    phase:"race",
    active_session_id:"race",
    live_race:{status:"finished",current_lap:53,current_sector:3,total_laps:53},
  };
  assert.equal(raceWeekendCanFinalizeLiveRace(weekend),true);
  assert.equal(raceWindowForWeekend(weekend),"live");

  assert.equal(raceWeekendCanFinalizeLiveRace({
    ...weekend,
    live_race:{...weekend.live_race,status:"running"},
  }),false);
  assert.equal(raceWeekendCanFinalizeLiveRace({
    ...weekend,
    live_race:{...weekend.live_race,current_lap:52},
  }),false);
});
