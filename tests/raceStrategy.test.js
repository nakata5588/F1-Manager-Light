import test from "node:test";
import assert from "node:assert/strict";

import {
  createRaceStrategyState,
  ensureRaceStrategyWorld,
  fuelStopTargetsForRace,
  raceStrategyRulesForYear,
  raceTrackProfile,
  setRaceStrategySelection,
  simulateManagedRace,
  tyresForTeam,
  tyreConditionEffects,
} from "../src/engine/RaceStrategyEngine.js";
import { damageStateFromComponents } from "../src/engine/CarDamageEngine.js";
import {
  aiTyreCrossoverDecision,
  tyreCrossoverProfile,
  tyreWeatherPenaltyForWetness,
} from "../src/engine/TyreCrossoverEngine.js";

const tyres=[
  {tyre_id:"gy_h",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Hard",category:"dry",grip_index:74,wear_rate:0.015,warmup_time_s:2.8},
  {tyre_id:"gy_s",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Soft",category:"dry",grip_index:80,wear_rate:0.022,warmup_time_s:2.2},
  {tyre_id:"gy_i",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Intermediate",category:"intermediate",grip_index:65,wear_rate:0.018,warmup_time_s:3.1},
  {tyre_id:"gy_w",year_from:1980,year_to:1980,supplier:"Goodyear",compound_name:"Wet",category:"wet",grip_index:55,wear_rate:0.020,warmup_time_s:3.5},
  {tyre_id:"mi_h",year_from:1980,year_to:1980,supplier:"Michelin",compound_name:"Hard",category:"dry",grip_index:76,wear_rate:0.014,warmup_time_s:2.7},
  {tyre_id:"mi_s",year_from:1980,year_to:1980,supplier:"Michelin",compound_name:"Soft",category:"dry",grip_index:82,wear_rate:0.021,warmup_time_s:2.1},
  {tyre_id:"mi_i",year_from:1980,year_to:1980,supplier:"Michelin",compound_name:"Intermediate",category:"intermediate",grip_index:66,wear_rate:0.017,warmup_time_s:3.0},
  {tyre_id:"mi_w",year_from:1980,year_to:1980,supplier:"Michelin",compound_name:"Wet",category:"wet",grip_index:56,wear_rate:0.019,warmup_time_s:3.4},
];

function driver(id,name,team_id){return {driver_id:id,display_name:name,team_id};}

function fixture(overrides={}){
  const drivers=[
    driver("d_w1","Williams High","t_williams"),
    driver("d_w2","Williams Low","t_williams"),
    driver("d_f1","Ferrari One","t_ferrari"),
    driver("d_f2","Ferrari Two","t_ferrari"),
  ];
  const ratings=[
    {driver_id:"d_w1",pace:76,racecraft:76,consistency:74,tire_management:90,race_intelligence:78,start_launch:70,mentality:72,pressure_handling:72,adaptability:72,current_ability:76,crash_likelihood:25},
    {driver_id:"d_w2",pace:76,racecraft:76,consistency:74,tire_management:40,race_intelligence:70,start_launch:70,mentality:72,pressure_handling:72,adaptability:72,current_ability:76,crash_likelihood:25},
    {driver_id:"d_f1",pace:78,racecraft:77,consistency:73,tire_management:70,race_intelligence:74,start_launch:72,mentality:74,pressure_handling:74,adaptability:74,current_ability:78,crash_likelihood:25},
    {driver_id:"d_f2",pace:75,racecraft:75,consistency:72,tire_management:66,race_intelligence:72,start_launch:68,mentality:72,pressure_handling:72,adaptability:70,current_ability:75,crash_likelihood:25},
  ];
  const entries=drivers.map((d,index)=>({
    driver_id:d.driver_id,
    team_id:d.team_id,
    status:"confirmed",
    car_slot:(index%2)+1,
    entry_type:"race_driver",
  }));
  const gs={
    activeYear:1980,
    currentDateISO:"1980-05-18",
    saveMeta:{seed:"rw4-test-seed"},
    team:{team_id:"t_williams",name:"Williams"},
    teams:[
      {team_id:"t_williams",team_name:"Williams"},
      {team_id:"t_ferrari",team_name:"Ferrari"},
    ],
    drivers,
    driverRatings:ratings,
    driverAttributes:Object.fromEntries(drivers.map((d)=>[d.driver_id,{fatigue:10,preparation:60,confidence:55,morale:55}])),
    tyres,
    dbTyres:tyres,
    trackLayoutByYear:[{track_id:"monaco",year_from:1973,year_to:1985,lap_length_km:3.34,laps:30,pit_lane_loss_s:24}],
    coreTracks:[{track_id:"monaco",track_name:"Monaco",tyre_wear:65,overtaking_difficulty:88,lap_length_km:3.34,pit_lane_loss_s:25}],
    dbWeatherProfiles:[{track_id:"monaco",month:5,avg_temp:22,rain_chance:0,storm_chance:0,wind_profile:"low"}],
    dbWeatherStates:[
      {id:"SUNNY",crash_risk_ppm:1},
      {id:"LIGHT_RAIN",crash_risk_ppm:1.6},
      {id:"HEAVY_RAIN",crash_risk_ppm:2.4},
      {id:"STORM",crash_risk_ppm:3.2},
    ],
    dbPitcrewRoster:[
      {team_id:"t_williams",year:1980,avg_time:6.2,consistency:85,error_rate:0.02},
      {team_id:"t_ferrari",year:1980,avg_time:6.4,consistency:82,error_rate:0.03},
    ],
    facilities:[
      {team_id:"t_williams",year:1980,pitcrew_training_level:7},
      {team_id:"t_ferrari",year:1980,pitcrew_training_level:6},
    ],
    carStats:[
      {team_id:"t_williams",year:1980,chassis_spec:76,aero_spec:75,gearbox_spec:74,suspension_spec:74,brakes_spec:75,cooling_spec:74,reliability:0.84},
      {team_id:"t_ferrari",year:1980,chassis_spec:77,aero_spec:76,gearbox_spec:75,suspension_spec:75,brakes_spec:76,cooling_spec:74,reliability:0.83},
    ],
    teamEngines:[
      {team_id:"t_williams",year:1980,power:78,reliability:82,chassis_integration:76},
      {team_id:"t_ferrari",year:1980,power:80,reliability:80,chassis_integration:77},
    ],
    raceEntryState:{entries},
    ...overrides,
  };
  return gs;
}

const gp={gp_id:"gp_monaco_1980",track_id:"monaco",gp_name:"Monaco Grand Prix",race_date:"1980-05-18"};

function withStrategy(gs,gpInput=gp){
  const built=createRaceStrategyState(gs,{gp:gpInput,raceEntryState:gs.raceEntryState});
  return {
    ...built.gameState,
    raceWeekendState:{
      phase:"race",
      race_strategy:built.state,
    },
  };
}

function grid(gs){
  return [
    {pos:1,driver:gs.drivers[2]},
    {pos:2,driver:gs.drivers[0]},
    {pos:3,driver:gs.drivers[3]},
    {pos:4,driver:gs.drivers[1]},
  ];
}

test("refuelling rules follow the historical 1980-2010 era boundaries",()=>{
  const r1980=raceStrategyRulesForYear(1980);
  assert.equal(r1980.refuelling_allowed,false);
  assert.equal(r1980.refuelling_style,"prohibited");
  assert.equal(r1980.mandatory_dry_compounds,1);
  assert.equal(r1980.default_pit_plan,"no_stop");

  const r1982=raceStrategyRulesForYear(1982);
  const r1983=raceStrategyRulesForYear(1983);
  assert.equal(r1982.refuelling_allowed,true);
  assert.equal(r1982.refuelling_style,"optional_experimental");
  assert.equal(r1983.refuelling_allowed,true);

  const r1984=raceStrategyRulesForYear(1984);
  const r1993=raceStrategyRulesForYear(1993);
  assert.equal(r1984.refuelling_allowed,false);
  assert.equal(r1993.refuelling_allowed,false);

  const r1994=raceStrategyRulesForYear(1994);
  const r2008=raceStrategyRulesForYear(2008);
  const r2009=raceStrategyRulesForYear(2009);
  assert.equal(r1994.refuelling_allowed,true);
  assert.equal(r1994.refuelling_style,"strategic_standard");
  assert.equal(r2008.refuelling_allowed,true);
  assert.equal(r2008.mandatory_dry_compounds,2);
  assert.equal(r2009.refuelling_allowed,true);

  const r2010=raceStrategyRulesForYear(2010);
  assert.equal(r2010.refuelling_allowed,false);
  assert.equal(r2010.refuelling_style,"prohibited");
  assert.equal(r2010.mandatory_dry_compounds,2);
});

test("era-aware fuel plans create stops only where refuelling is legal",()=>{
  const laps=60;
  const early=raceStrategyRulesForYear(1983);
  assert.deepEqual(fuelStopTargetsForRace(early,"balanced",laps),[]);
  assert.deepEqual(fuelStopTargetsForRace(early,"heavy_start",laps),[]);
  assert.deepEqual(fuelStopTargetsForRace(early,"light_start",laps),[31]);

  const banned=raceStrategyRulesForYear(1984);
  assert.deepEqual(fuelStopTargetsForRace(banned,"light_start",laps),[]);

  const standard=raceStrategyRulesForYear(1994);
  assert.deepEqual(fuelStopTargetsForRace(standard,"balanced",laps),[30]);
  assert.deepEqual(fuelStopTargetsForRace(standard,"heavy_start",laps),[40]);
  assert.deepEqual(fuelStopTargetsForRace(standard,"light_start",laps),[20,40]);

  const modern=raceStrategyRulesForYear(2010);
  assert.deepEqual(fuelStopTargetsForRace(modern,"light_start",laps),[]);
});

test("1994-2009 balanced strategy actually executes a refuelling stop",()=>{
  const year=2004;
  const gs=fixture({
    activeYear:year,
    currentDateISO:"2004-05-23",
    trackLayoutByYear:[{track_id:"monaco",year_from:1994,year_to:2009,lap_length_km:3.34,laps:30,pit_lane_loss_s:24}],
    dbPitcrewRoster:[
      {team_id:"t_williams",year,avg_time:6.2,consistency:85,error_rate:0.02},
      {team_id:"t_ferrari",year,avg_time:6.4,consistency:82,error_rate:0.03},
    ],
    facilities:[
      {team_id:"t_williams",year,pitcrew_training_level:7},
      {team_id:"t_ferrari",year,pitcrew_training_level:6},
    ],
    carStats:[
      {team_id:"t_williams",year,chassis_spec:76,aero_spec:75,gearbox_spec:74,suspension_spec:74,brakes_spec:75,cooling_spec:74,reliability:0.84},
      {team_id:"t_ferrari",year,chassis_spec:77,aero_spec:76,gearbox_spec:75,suspension_spec:75,brakes_spec:76,cooling_spec:74,reliability:0.83},
    ],
    teamEngines:[
      {team_id:"t_williams",year,power:78,reliability:82,chassis_integration:76},
      {team_id:"t_ferrari",year,power:80,reliability:80,chassis_integration:77},
    ],
  });
  const gp2004={...gp,gp_id:"gp_monaco_2004",race_date:"2004-05-23",year};
  const raceGs=withStrategy(gs,gp2004);
  const simulated=simulateManagedRace(raceGs,{
    gp:gp2004,
    grid:grid(raceGs),
    ratings:raceGs.driverRatings,
    roundIndex:0,
  });
  const player=simulated.race.find((row)=>String(row?.driver?.driver_id)==="d_w1");
  assert.ok(player);
  assert.equal(player.strategy_summary.refuelled,true);
  assert.equal(player.strategy_summary.refuel_count,1);
  assert.deepEqual(player.strategy_summary.fuel_stop_targets,[15]);
  assert.ok(player.pit_stops.some((stop)=>stop.refuelled===true&&Number(stop.lap)>=15));
});

test("1980 supplier calibration seeds the world once and Save World stays authoritative",()=>{
  const seeded=ensureRaceStrategyWorld(fixture());
  assert.equal(seeded.raceStrategyWorld.teamSuppliers.t_ferrari,"Michelin");
  assert.equal(seeded.raceStrategyWorld.teamSuppliers.t_williams,"Goodyear");
  assert.equal(seeded.raceStrategyWorld.pitCrews.t_williams.source,"career_seed");

  const alternate={
    ...seeded,
    raceStrategyWorld:{
      ...seeded.raceStrategyWorld,
      teamSuppliers:{...seeded.raceStrategyWorld.teamSuppliers,t_williams:"Michelin"},
    },
  };
  const preserved=ensureRaceStrategyWorld(alternate);
  assert.equal(preserved.raceStrategyWorld.teamSuppliers.t_williams,"Michelin");
});

test("track strategy snapshot uses year-specific laps and pit-lane loss",()=>{
  const track=raceTrackProfile(fixture(),gp);
  assert.equal(track.laps,30);
  assert.equal(track.pit_lane_loss_s,24);
  assert.equal(track.lap_length_km,3.34);
});

test("RW4.8 AI strategy plans from its own forecast instead of hidden actual weather",()=>{
  const base=fixture();
  const actualRace={
    id:"race",
    kind:"race",
    state:"HEAVY_RAIN",
    segments:[{from_pct:0,to_pct:1,state:"HEAVY_RAIN"}],
    air_temp_c:18,
    track_temp_c:19,
    rain_chance_profile_pct:90,
    storm_chance_profile_pct:10,
    wind_profile:"medium",
    track:{start_wetness:0.84,end_wetness:0.90,rubber_level:3,grip_index:62},
  };
  const wetForecast={
    session_id:"race",
    predicted_state:"HEAVY_RAIN",
    rain_chance_pct:85,
    air_temp_c:18,
    confidence_pct:60,
    forecast_revision:0,
    timing:{mode:"rain_from_start",horizon_pct:0.25},
    source:"team_forecast",
  };
  const dryForecast={
    session_id:"race",
    predicted_state:"SUNNY",
    rain_chance_pct:15,
    air_temp_c:22,
    confidence_pct:48,
    forecast_revision:0,
    timing:{mode:"dry_stable",horizon_pct:0.20},
    source:"team_forecast",
  };
  const gs={
    ...base,
    raceWeekendState:{
      gp_id:gp.gp_id,
      track_id:gp.track_id,
      weekend_weather:{
        version:2,
        source:"weekend_weather_world",
        forecast_team_id:"t_williams",
        forecast_accuracy:0.60,
        forecast_revision:0,
        observed_sessions:[],
        sessions:{race:actualRace},
        forecast:{race:wetForecast},
        forecasts_by_team:{
          t_williams:{team_id:"t_williams",forecast_accuracy:0.60,forecast_revision:0,forecast:{race:wetForecast}},
          t_ferrari:{team_id:"t_ferrari",forecast_accuracy:0.48,forecast_revision:0,forecast:{race:dryForecast}},
        },
      },
    },
  };

  const built=createRaceStrategyState(gs,{gp,raceEntryState:gs.raceEntryState});
  assert.equal(built.state.weather_snapshot.state,"HEAVY_RAIN","hidden actual weather remains the simulation truth");

  const playerTyre=tyresForTeam(built.gameState,"t_williams")
    .find((row)=>row.tyre_id===built.state.selections.d_w1.start_tyre_id);
  const aiTyre=tyresForTeam(built.gameState,"t_ferrari")
    .find((row)=>row.tyre_id===built.state.selections.d_f1.start_tyre_id);

  assert.equal(playerTyre.category,"wet","player planning follows the player's wet forecast");
  assert.equal(aiTyre.category,"dry","AI planning follows its dry forecast rather than the hidden wet truth");
  assert.equal(built.state.forecast_revisions_used.t_ferrari,0);
});

test("player strategy persists and 1980 rejects in-race fuel strategy",()=>{
  let gs=withStrategy(fixture());
  gs=setRaceStrategySelection(gs,{
    driverId:"d_w1",
    patch:{start_tyre_id:"gy_s",next_tyre_id:"gy_h",pace_mode:"attack",pit_plan:"one_stop",planned_stop_lap:15,fuel_plan:"light_start"},
  });
  const s=gs.raceWeekendState.race_strategy.selections.d_w1;
  assert.equal(s.start_tyre_id,"gy_s");
  assert.equal(s.next_tyre_id,"gy_h");
  assert.equal(s.pace_mode,"attack");
  assert.equal(s.pit_plan,"one_stop");
  assert.equal(s.planned_stop_lap,15);
  assert.equal(s.fuel_plan,"not_applicable");
});

test("planned stop uses circuit pit loss and produces persisted stint history",()=>{
  let gs=withStrategy(fixture());
  gs=setRaceStrategySelection(gs,{
    driverId:"d_w1",
    patch:{start_tyre_id:"gy_s",next_tyre_id:"gy_h",pace_mode:"balanced",pit_plan:"one_stop",planned_stop_lap:15},
  });
  const result=simulateManagedRace(gs,{gp,grid:grid(gs),ratings:gs.driverRatings,roundIndex:0});
  const row=result.race.find((r)=>r.driver.driver_id==="d_w1");
  assert.ok(row);
  assert.ok(row.pit_stops.length>=1);
  assert.equal(row.pit_stops[0].lap,15);
  assert.ok(row.pit_stops[0].total_loss_s>24);
  assert.ok(row.stints.length>=2);
  assert.equal(row.race_laps,30);
  assert.equal(row.strategy_summary.refuelled,false);
});

test("driver tyre-management rating materially changes degradation",()=>{
  let gs=withStrategy(fixture());
  for(const did of ["d_w1","d_w2"]){
    gs=setRaceStrategySelection(gs,{driverId:did,patch:{start_tyre_id:"gy_h",next_tyre_id:"gy_h",pace_mode:"balanced",pit_plan:"no_stop"}});
  }
  const result=simulateManagedRace(gs,{gp,grid:grid(gs),ratings:gs.driverRatings,roundIndex:0});
  const high=result.race.find((r)=>r.driver.driver_id==="d_w1");
  const low=result.race.find((r)=>r.driver.driver_id==="d_w2");
  assert.ok(high.lowest_tyre_condition>low.lowest_tyre_condition);
});

test("heavy rain selects wet-weather tyres and increases race incident exposure",()=>{
  const wetGp={...gp,weather:"Heavy Rain"};
  const gs=withStrategy(fixture(),wetGp);
  const strategy=gs.raceWeekendState.race_strategy;
  assert.equal(strategy.weather_snapshot.wet_race,true);
  const userStart=strategy.selections.d_w1.start_tyre_id;
  const tyre=tyresForTeam(gs,"t_williams").find((row)=>row.tyre_id===userStart);
  assert.equal(tyre.category,"wet");

  const result=simulateManagedRace(gs,{gp:wetGp,grid:grid(gs),ratings:gs.driverRatings,roundIndex:0});
  assert.ok(result.race.every((row)=>row.incident_risk_multiplier>1));
});

test("race simulation is deterministic for the same save seed and strategy",()=>{
  let gs=withStrategy(fixture());
  gs=setRaceStrategySelection(gs,{driverId:"d_w1",patch:{pit_plan:"adaptive",pace_mode:"attack"}});
  const a=simulateManagedRace(gs,{gp,grid:grid(gs),ratings:gs.driverRatings,roundIndex:0});
  const b=simulateManagedRace(gs,{gp,grid:grid(gs),ratings:gs.driverRatings,roundIndex:0});
  assert.deepEqual(
    a.race.map((row)=>({id:row.driver.driver_id,time:row.total_time_ms,pits:row.pit_stops,condition:row.tyre_condition_finish})),
    b.race.map((row)=>({id:row.driver.driver_id,time:row.total_time_ms,pits:row.pit_stops,condition:row.tyre_condition_finish}))
  );
});

test("sparse tyre catalog carries the nearest prior family instead of producing an empty race",()=>{
  const gs1981=fixture({activeYear:1981,currentDateISO:"1981-05-17",tyres:[]});
  const built=createRaceStrategyState(gs1981,{gp:{...gp,race_date:"1981-05-17"},raceEntryState:gs1981.raceEntryState});
  assert.ok(built.state.selections.d_w1.start_tyre_id);
  assert.ok(tyresForTeam(built.gameState,"t_williams").length>0);
});


test("RW4.5 tyre condition has progressive pace, grip and incident consequences",()=>{
  const fresh=tyreConditionEffects(90);
  const used=tyreConditionEffects(55);
  const worn=tyreConditionEffects(30);
  const critical=tyreConditionEffects(8);
  assert.equal(fresh.pace_penalty_s,0);
  assert.ok(used.pace_penalty_s>fresh.pace_penalty_s);
  assert.ok(worn.pace_penalty_s>used.pace_penalty_s);
  assert.ok(critical.pace_penalty_s>worn.pace_penalty_s);
  assert.ok(critical.grip_multiplier<worn.grip_multiplier);
  assert.ok(critical.risk_multiplier>worn.risk_multiplier);
  assert.equal(critical.band,"critical");
});

test("RW4.5 Attack on Softs wears tyres and loads the driver more than Conserve on Hards",()=>{
  let attack=withStrategy(fixture());
  attack=setRaceStrategySelection(attack,{driverId:"d_w1",patch:{start_tyre_id:"gy_s",next_tyre_id:"gy_h",pace_mode:"attack",pit_plan:"no_stop"}});
  const attackRace=simulateManagedRace(attack,{gp,grid:grid(attack),ratings:attack.driverRatings,roundIndex:0});
  const attackRow=attackRace.race.find((row)=>row.driver.driver_id==="d_w1");

  let conserve=withStrategy(fixture());
  conserve=setRaceStrategySelection(conserve,{driverId:"d_w1",patch:{start_tyre_id:"gy_h",next_tyre_id:"gy_h",pace_mode:"conserve",pit_plan:"no_stop"}});
  const conserveRace=simulateManagedRace(conserve,{gp,grid:grid(conserve),ratings:conserve.driverRatings,roundIndex:0});
  const conserveRow=conserveRace.race.find((row)=>row.driver.driver_id==="d_w1");

  assert.ok(attackRow.lowest_tyre_condition<conserveRow.lowest_tyre_condition);
  assert.ok(attackRow.race_fatigue_gain>conserveRow.race_fatigue_gain);
  assert.ok(attackRow.tyre_risk_multiplier>=conserveRow.tyre_risk_multiplier);
});

test("RW4.5 AI does not routinely run a severely worn tyre down to ten percent before reacting",()=>{
  const longTrack={...gp,gp_id:"gp_rw45_ai",track_id:"monaco"};
  const highWearFixture=fixture({
    trackLayoutByYear:[{track_id:"monaco",year_from:1973,year_to:1985,lap_length_km:3.34,laps:50,pit_lane_loss_s:24}],
    coreTracks:[{track_id:"monaco",track_name:"Monaco",tyre_wear:90,overtaking_difficulty:88,lap_length_km:3.34,pit_lane_loss_s:25}],
  });
  let gs=withStrategy(highWearFixture,longTrack);
  gs={
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      race_strategy:{
        ...gs.raceWeekendState.race_strategy,
        selections:{
          ...gs.raceWeekendState.race_strategy.selections,
          d_f1:{...gs.raceWeekendState.race_strategy.selections.d_f1,start_tyre_id:"mi_s",next_tyre_id:"mi_h",pace_mode:"attack",pit_plan:"adaptive"},
        },
      },
    },
  };
  const result=simulateManagedRace(gs,{gp:longTrack,grid:grid(gs),ratings:gs.driverRatings,roundIndex:0});
  const ai=result.race.find((row)=>row.driver.driver_id==="d_f1");
  assert.ok(ai.pit_stops.length>=1,"AI should react to degradation when a stop is worthwhile");
  const degradationStop=ai.strategy_decisions.find((decision)=>["degradation_value","degradation","tyre_safety"].includes(decision.reason));
  assert.ok(degradationStop,"AI should record why it reacted to tyre degradation");
  assert.ok(degradationStop.tyre_condition>9,"AI reaction should happen before the old near-10% emergency threshold");
  assert.ok(Number.isFinite(degradationStop.estimated_pit_loss_s));
  assert.ok(Number.isFinite(degradationStop.projected_stay_out_loss_s));
});


test("RW5.2D3 AI drivers use individual slick-to-intermediate crossover points",()=>{
  const ratings=[
    {driver_id:"d_f1",race_intelligence:74,adaptability:74,aggression:50},
    {driver_id:"d_f2",race_intelligence:72,adaptability:70,aggression:50},
    {driver_id:"d_w1",race_intelligence:78,adaptability:72,aggression:50},
    {driver_id:"d_w2",race_intelligence:70,adaptability:72,aggression:50},
  ];
  const rows=ratings.map((rating)=>({
    id:rating.driver_id,
    profile:tyreCrossoverProfile({driverId:rating.driver_id,teamId:rating.driver_id.startsWith("d_f")?"t_ferrari":"t_williams",rating}),
    rating,
  }));
  assert.ok(rows.every((row)=>row.profile.slick_to_inter>=0.20&&row.profile.slick_to_inter<=0.30));
  assert.ok(rows.every((row)=>row.profile.inter_to_wet>=0.66&&row.profile.inter_to_wet<=0.78));
  const unique=new Set(rows.map((row)=>row.profile.slick_to_inter.toFixed(3)));
  assert.ok(unique.size>=3,"the field should not share one wetness threshold");

  const ordered=rows.slice().sort((a,b)=>a.profile.slick_to_inter-b.profile.slick_to_inter);
  const early=ordered[0],late=ordered.at(-1);
  const wetness=(early.profile.slick_to_inter+late.profile.slick_to_inter)/2;
  const earlyDecision=aiTyreCrossoverDecision({
    driverId:early.id,teamId:early.id.startsWith("d_f")?"t_ferrari":"t_williams",rating:early.rating,
    currentCategory:"dry",wetness,wetnessDelta:0,rainIntensity:0,lap:12,totalLaps:40,
  });
  const lateDecision=aiTyreCrossoverDecision({
    driverId:late.id,teamId:late.id.startsWith("d_f")?"t_ferrari":"t_williams",rating:late.rating,
    currentCategory:"dry",wetness,wetnessDelta:0,rainIntensity:0,lap:12,totalLaps:40,
  });
  assert.equal(earlyDecision.should_pit,true);
  assert.equal(lateDecision.should_pit,false);
});

test("RW5.2D3 crossover hysteresis blocks an immediate intermediate-to-wet correction",()=>{
  const rating={race_intelligence:72,adaptability:72,aggression:50};
  const tooSoon=aiTyreCrossoverDecision({
    driverId:"d_f1",teamId:"t_ferrari",rating,
    currentCategory:"intermediate",wetness:0.82,wetnessDelta:0.02,rainIntensity:0.70,
    lap:12,totalLaps:40,lastPitLap:10,
  });
  assert.equal(tooSoon.should_pit,false);
  assert.equal(tooSoon.target_category,"wet");
  assert.equal(tooSoon.cooldown_active,true);

  const later=aiTyreCrossoverDecision({
    driverId:"d_f1",teamId:"t_ferrari",rating,
    currentCategory:"intermediate",wetness:0.82,wetnessDelta:0.02,rainIntensity:0.70,
    lap:14,totalLaps:40,lastPitLap:10,
  });
  assert.equal(later.should_pit,true);
  assert.equal(later.target_category,"wet");
});

test("RW5.2D3 tyre weather cost changes progressively with surface water",()=>{
  const slickDamp=tyreWeatherPenaltyForWetness("dry",0.15);
  const slickInter=tyreWeatherPenaltyForWetness("dry",0.28);
  const slickWet=tyreWeatherPenaltyForWetness("dry",0.60);
  assert.ok(slickDamp<slickInter);
  assert.ok(slickInter<slickWet);
  assert.ok(tyreWeatherPenaltyForWetness("intermediate",0.40)<slickWet);
  assert.ok(tyreWeatherPenaltyForWetness("wet",0.05)>tyreWeatherPenaltyForWetness("wet",0.75));
});


test("RW5.2D4.5 red-flag tyre command changes stint with zero pit-stop loss",()=>{
  const base=withStrategy(fixture());
  const did="d_w1";
  const raceGs={
    ...base,
    raceWeekendState:{
      ...base.raceWeekendState,
      live_race:{status:"running",current_lap:4,current_sector:3,total_laps:30},
      race_strategy:{
        ...base.raceWeekendState.race_strategy,
        live_commands:{
          ...(base.raceWeekendState.race_strategy.live_commands||{}),
          [did]:[{
            type:"red_flag_tyre",
            tyre_id:"gy_s",
            effective_lap:5,
            red_flag_sequence:1,
          }],
        },
      },
    },
  };

  const simulated=simulateManagedRace(raceGs,{
    gp,
    grid:grid(raceGs),
    ratings:raceGs.driverRatings,
    roundIndex:0,
  });
  const row=simulated.race.find((item)=>String(item?.driver?.driver_id)==did);
  assert.ok(row);

  const decision=row.strategy_decisions.find((item)=>item.action==="red_flag_tyre_change");
  assert.ok(decision);
  assert.equal(decision.lap,5);
  assert.equal(decision.tyre_to,"gy_s");
  assert.equal(decision.time_cost_s,0);

  const lap5=row.tyre_state_by_lap.find((item)=>Number(item.lap)===5);
  assert.equal(lap5.tyre_id,"gy_s");
  assert.ok(Number(lap5.condition)>95);

  // Red Flag service must never be represented as an ordinary pit stop.
  assert.equal(row.pit_stops.some((stop)=>Number(stop.lap)===5&&String(stop.reason).includes("red_flag")),false);
});


test("RW5.3B.2C AI never repairs damage before the incident is observable",()=>{
  const gs0=fixture({
    trackLayoutByYear:[{track_id:"monaco",year_from:1973,year_to:1985,lap_length_km:3.34,laps:30,pit_lane_loss_s:12}],
    coreTracks:[{track_id:"monaco",track_name:"Monaco",tyre_wear:20,overtaking_difficulty:88,lap_length_km:3.34,pit_lane_loss_s:12}],
  });
  const base=withStrategy(gs0);
  const damage=damageStateFromComponents({front_wing:75});
  const strategy=base.raceWeekendState.race_strategy;
  const ferrari={...strategy.selections.d_f1,pit_plan:"one_stop",planned_stop_lap:15};
  const raceGs={
    ...base,
    raceWeekendState:{
      ...base.raceWeekendState,
      race_strategy:{
        ...strategy,
        selections:{...strategy.selections,d_f1:ferrari},
        race_control_plan:{
          incidents:[{
            driver_id:"d_f1",
            lap:5,
            sector:3,
            damage_ordinal:15,
            retirement:false,
            kind:"collision",
            reason:"Collision",
            severity:"medium",
            damage,
            time_loss_s:0,
          }],
          damage_repairs:[],
          periods:[],
          weather_timeline:[],
        },
      },
    },
  };

  const simulated=simulateManagedRace(raceGs,{
    gp,
    grid:grid(raceGs),
    ratings:raceGs.driverRatings,
    roundIndex:0,
  });
  const ai=simulated.race.find((row)=>row.driver.driver_id==="d_f1");
  const repairStops=(ai?.pit_stops||[]).filter((stop)=>stop?.service?.repair?.repaired_components?.length);
  assert.ok(repairStops.length>=1,"AI should eventually repair worthwhile observed damage");
  assert.ok(repairStops.every((stop)=>Number(stop.lap)>=6),"future incident data must not trigger an early repair");

  const decision=(ai?.strategy_decisions||[]).find((row)=>row.action==="pit_repair");
  assert.ok(decision);
  assert.ok(Number(decision.lap)>=6);
  assert.ok(decision.repair_components.includes("front_wing"));
  assert.ok(Number.isFinite(decision.projected_damage_loss_s));
  assert.ok(Number.isFinite(decision.repair_cost_s));
});


test("RW5.3C RaceStrategy applies double-stack delay when both team cars pit together",()=>{
  let seeded=fixture();
  const leadRating=seeded.driverRatings.find((row)=>row.driver_id==="d_w1");
  seeded={
    ...seeded,
    driverRatings:seeded.driverRatings.map((row)=>
      row.driver_id==="d_w2"?{...leadRating,driver_id:"d_w2"}:row
    ),
  };
  const base=withStrategy(seeded);
  const liveCommands={
    d_w1:[{type:"pit",tyre_id:"gy_s",tyre_change:true,effective_lap:5}],
    d_w2:[{type:"pit",tyre_id:"gy_s",tyre_change:true,effective_lap:5}],
  };
  const raceGs={
    ...base,
    raceWeekendState:{
      ...base.raceWeekendState,
      live_race:{status:"running",current_lap:4,current_sector:3,total_laps:30},
      race_strategy:{
        ...base.raceWeekendState.race_strategy,
        live_commands:liveCommands,
      },
    },
  };

  const simulated=simulateManagedRace(raceGs,{
    gp,
    grid:grid(raceGs),
    ratings:raceGs.driverRatings,
    roundIndex:0,
  });
  const teamRows=simulated.race.filter((row)=>String(row.team_id)==="t_williams");
  const stops=teamRows.map((row)=>row.pit_stops.find((stop)=>Number(stop.lap)===5)).filter(Boolean);
  assert.equal(stops.length,2);
  assert.equal(stops.filter((stop)=>stop.double_stack).length,1);
  const queued=stops.find((stop)=>stop.double_stack);
  assert.ok(Number(queued.queue_delay_s)>0);
  assert.ok(Number(queued.total_loss_s)>Number(queued.base_total_loss_s));
  assert.equal(queued.pit_traffic_model,"rw5.3c");
  assert.equal(queued.service.pit_traffic.double_stack,true);
});
