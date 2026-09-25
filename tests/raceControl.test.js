import test from "node:test";
import assert from "node:assert/strict";

import {
  accidentConditionalRetirementChance,
  accidentIncidentChance,
  accidentRetirementChance,
  buildTrackWeatherTimeline,
  createRaceControlPlan,
  mechanicalRetirementChance,
  mergeRaceControlHistory,
  raceControlAtLap,
  raceControlAtPoint,
  raceControlRulesForYear,
} from "../src/engine/RaceControlEngine.js";
import { createNewSaveMeta } from "../src/core/saveSafety.js";
import { raceReliabilityProfile } from "../src/domain/carPerformance.js";
import { carReliabilityProfile, mechanicalFailureChance, selectMechanicalFailureReason } from "../src/domain/carReliability.js";

function gs(year=1980){
  return {
    saveMeta:createNewSaveMeta({year,teamId:"T1",seed:"rw4.2-control"}),
    activeYear:year,
    team:{team_id:"T1",team_name:"Player"},
    drivers:[
      {driver_id:"D1",team_id:"T1"},
      {driver_id:"D2",team_id:"T2"},
    ],
    driverRatings:[
      {driver_id:"D1",crash_likelihood:35},
      {driver_id:"D2",crash_likelihood:35},
    ],
    driverAttributes:{D1:{fatigue:20},D2:{fatigue:20}},
    raceEntryState:{entries:[
      {driver_id:"D1",team_id:"T1",status:"confirmed"},
      {driver_id:"D2",team_id:"T2",status:"confirmed"},
    ]},
    carStats:[
      {year,team_id:"T1",reliability:84},
      {year,team_id:"T2",reliability:82},
    ],
    teamEngines:[
      {year,team_id:"T1",reliability:84},
      {year,team_id:"T2",reliability:82},
    ],
    accidentModel:[{year,damage_DNF_prob:0.16}],
    dbWeatherStates:[
      {id:"SUNNY",crash_risk_ppm:1,dnf_risk_ppm:1,safety_car_chance_pct:5,red_flag_chance_pct:0},
      {id:"LIGHT_RAIN",crash_risk_ppm:1.6,dnf_risk_ppm:1.1,safety_car_chance_pct:12,red_flag_chance_pct:1},
      {id:"HEAVY_RAIN",crash_risk_ppm:2.4,dnf_risk_ppm:1.2,safety_car_chance_pct:28,red_flag_chance_pct:4},
      {id:"STORM",crash_risk_ppm:3.2,dnf_risk_ppm:1.3,safety_car_chance_pct:45,red_flag_chance_pct:15},
      {id:"DRYING",crash_risk_ppm:1.2,dnf_risk_ppm:1,safety_car_chance_pct:7,red_flag_chance_pct:1},
    ],
  };
}

const track={track_id:"t",laps:12,lap_length_km:5,pit_lane_loss_s:22};
const dryWeather={state:"SUNNY",segments:[{from_lap:1,to_lap:12,state:"SUNNY"}]};
const mixedWeather={state:"HEAVY_RAIN",segments:[
  {from_lap:1,to_lap:4,state:"HEAVY_RAIN"},
  {from_lap:5,to_lap:12,state:"DRYING"},
]};

test("RW5.3A.1 repairable incidents preserve the calibrated 1980 DNF target",()=>{
  const state=gs(1980);
  const row={
    driver:{driver_id:"D1"},
    incident_risk_multiplier:1,
    mechanical_risk_multiplier:1,
  };
  const target=accidentRetirementChance(state,row);
  const incident=accidentIncidentChance(state,row);
  const conditional=accidentConditionalRetirementChance(state,row);

  assert.equal(target,0.15);
  assert.ok(incident>target);
  assert.equal(Number(incident.toFixed(3)),0.21);
  assert.ok(conditional>0&&conditional<1);
  assert.ok(Math.abs(incident*conditional-target)<1e-12);
});

test("RW5.3A.1 weather raises incident frequency without changing target-vs-conditional math",()=>{
  const state=gs(1980);
  const row={
    driver:{driver_id:"D1"},
    incident_risk_multiplier:2.4,
    mechanical_risk_multiplier:1,
  };
  const target=accidentRetirementChance(state,row);
  const incident=accidentIncidentChance(state,row);
  const conditional=accidentConditionalRetirementChance(state,row);
  assert.ok(target>0.15);
  assert.ok(incident>target);
  assert.ok(Math.abs(incident*conditional-target)<1e-12);
});

test("race control availability follows the era",()=>{
  const y1980=raceControlRulesForYear(1980);
  assert.equal(y1980.safety_car,false);
  assert.equal(y1980.virtual_safety_car,false);
  assert.equal(y1980.red_flag,true);

  const y1993=raceControlRulesForYear(1993);
  assert.equal(y1993.safety_car,true);
  assert.equal(y1993.virtual_safety_car,false);

  const y2015=raceControlRulesForYear(2015);
  assert.equal(y2015.safety_car,true);
  assert.equal(y2015.virtual_safety_car,true);
});

test("weather timeline models a wet track that dries progressively",()=>{
  const timeline=buildTrackWeatherTimeline(gs(),mixedWeather,track);
  assert.equal(timeline.length,12);
  assert.ok(timeline[3].track_wetness>timeline[0].track_wetness);
  assert.ok(timeline[11].track_wetness<timeline[4].track_wetness);
  const worstGrip=Math.min(...timeline.map((row)=>row.grip_index));
  assert.ok(timeline[11].grip_index>worstGrip,"grip should recover from the wettest/lowest-grip point as the circuit dries");
  assert.ok(timeline[0].crash_risk_multiplier>1);
});


test("RW5.2D1 green dry track rubbers in instead of starting near maximum grip",()=>{
  const state=gs();
  state.raceEntryState={entries:Array.from({length:20},(_,index)=>({
    driver_id:`F${index+1}`,team_id:`T${Math.floor(index/2)+1}`,status:"confirmed",
  }))};
  const dry={state:"SUNNY",starting_track_wetness:0,starting_rubber_level:8,segments:[{from_lap:1,to_lap:30,state:"SUNNY"}]};
  const timeline=buildTrackWeatherTimeline(state,dry,{...track,laps:30});
  assert.ok(timeline[0].grip_index>=50&&timeline[0].grip_index<=65,"a green track should begin around the 50–60 grip-index range");
  assert.ok(timeline.at(-1).rubber_level>timeline[0].rubber_level,"dry traffic should lay rubber down");
  assert.ok(timeline.at(-1).grip_index>timeline[0].grip_index,"rubbering-in should improve dry grip");
});

test("RW5.2D1 sustained light rain keeps accumulating surface water beyond a fixed target",()=>{
  const weather={
    state:"LIGHT_RAIN",
    starting_track_wetness:0,
    starting_rubber_level:24,
    track_temp_c:24,
    wind_profile:"medium",
    segments:[{from_lap:1,to_lap:30,state:"LIGHT_RAIN"}],
  };
  const timeline=buildTrackWeatherTimeline(gs(),weather,{...track,laps:30});
  assert.ok(timeline[9].track_wetness>timeline[0].track_wetness);
  assert.ok(timeline.at(-1).track_wetness>0.62,"light rain must not be capped at the old 62% wetness target");
  assert.equal(timeline[0].rain_band,"MODERATE");
  assert.ok(timeline.at(-1).rubber_level<timeline[0].rubber_level,"persistent rain should wash rubber away");
  assert.ok(timeline.at(-1).grip_index<timeline[0].grip_index);
});

test("RW5.2D1 drying removes water lap by lap and restores grip",()=>{
  const weather={
    state:"DRYING",
    starting_track_wetness:0.82,
    starting_rubber_level:10,
    track_temp_c:29,
    wind_profile:"medium",
    segments:[{from_lap:1,to_lap:24,state:"DRYING"}],
  };
  const timeline=buildTrackWeatherTimeline(gs(),weather,{...track,laps:24});
  assert.ok(timeline.at(-1).track_wetness<timeline[0].track_wetness);
  assert.ok(timeline.at(-1).grip_index>timeline[0].grip_index);
  assert.equal(timeline.at(-1).rain_intensity,0);
});


test("RW5.2D3 rain intensity ramps into a shower instead of jumping straight to the state target",()=>{
  const weather={
    state:"SUNNY",
    avg_temp_c:25,
    starting_air_temp_c:25,
    starting_track_temp_c:34,
    starting_track_wetness:0,
    starting_rubber_level:18,
    wind_profile:"medium",
    segments:[
      {from_lap:1,to_lap:4,state:"SUNNY"},
      {from_lap:5,to_lap:14,state:"LIGHT_RAIN"},
    ],
  };
  const timeline=buildTrackWeatherTimeline(gs(),weather,{...track,laps:14});
  assert.equal(timeline[3].rain_intensity,0);
  assert.ok(timeline[4].rain_intensity>0.05&&timeline[4].rain_intensity<0.30);
  assert.ok(timeline[5].rain_intensity>timeline[4].rain_intensity);
  assert.ok(timeline[8].rain_intensity>timeline[5].rain_intensity);
  assert.ok(timeline[8].rain_intensity<0.46);
});

test("RW5.2D3.1 prolonged rain varies inside its regime instead of plateauing at 46%",()=>{
  const weather={
    state:"LIGHT_RAIN",
    avg_temp_c:24,
    starting_air_temp_c:24,
    starting_track_temp_c:30,
    starting_track_wetness:0.12,
    starting_rubber_level:30,
    wind_profile:"medium",
    segments:[{from_lap:1,to_lap:48,state:"LIGHT_RAIN"}],
  };
  const timeline=buildTrackWeatherTimeline(gs(),weather,{...track,laps:48,track_id:"rain-variation"});
  const settled=timeline.slice(18).map((row)=>row.rain_intensity);
  const roundedUnique=new Set(settled.map((value)=>Number(value).toFixed(2)));
  assert.ok(roundedUnique.size>=4,"a weather regime must not collapse to one fixed intensity");
  assert.ok(Math.max(...settled)-Math.min(...settled)>=0.04,"rain should strengthen and ease within the same regime");
  assert.equal(settled.every((value)=>Number(value)===0.46),false);
});

test("RW5.2D2 track temperature evolves during a dry session instead of remaining fixed",()=>{
  const weather={
    state:"SUNNY",
    avg_temp_c:24,
    starting_air_temp_c:24,
    starting_track_temp_c:35,
    starting_track_wetness:0,
    starting_rubber_level:12,
    wind_profile:"medium",
    segments:[{from_lap:1,to_lap:30,state:"SUNNY"}],
  };
  const timeline=buildTrackWeatherTimeline(gs(),weather,{...track,laps:30});
  const temps=timeline.map((row)=>row.track_temp_c);
  assert.ok(temps.every(Number.isFinite));
  assert.ok(Math.max(...temps)-Math.min(...temps)>=0.5,"track temperature should move through the session");
  assert.ok(timeline.every((row)=>Number.isFinite(row.air_temp_c)));
});

test("RW5.2D2 rain cools the track and spray reduces visibility",()=>{
  const state=gs();
  state.raceEntryState={entries:Array.from({length:20},(_,index)=>({
    driver_id:`W${index+1}`,team_id:`T${Math.floor(index/2)+1}`,status:"confirmed",
  }))};
  const weather={
    state:"SUNNY",
    avg_temp_c:25,
    starting_air_temp_c:25,
    starting_track_temp_c:39,
    starting_track_wetness:0,
    starting_rubber_level:20,
    wind_profile:"medium",
    segments:[
      {from_lap:1,to_lap:4,state:"SUNNY"},
      {from_lap:5,to_lap:16,state:"HEAVY_RAIN"},
    ],
  };
  const timeline=buildTrackWeatherTimeline(state,weather,{...track,laps:16});
  const beforeRain=timeline[3];
  const wet=timeline.at(-1);
  assert.ok(wet.track_temp_c<beforeRain.track_temp_c,"sustained rain should cool the asphalt");
  assert.ok(wet.spray_index>beforeRain.spray_index);
  assert.ok(wet.visibility_index<beforeRain.visibility_index);
  assert.ok(["MODERATE","HEAVY","EXTREME"].includes(wet.spray_band));
  assert.ok(["POOR","VERY_POOR"].includes(wet.visibility_band));
});

test("RW5.2D2 spray can persist after rain stops and clears as the surface dries",()=>{
  const weather={
    state:"DRYING",
    avg_temp_c:23,
    starting_air_temp_c:22,
    starting_track_temp_c:24,
    starting_track_wetness:0.88,
    starting_rubber_level:8,
    wind_profile:"medium",
    segments:[{from_lap:1,to_lap:24,state:"DRYING"}],
  };
  const timeline=buildTrackWeatherTimeline(gs(),weather,{...track,laps:24});
  assert.equal(timeline[0].rain_intensity,0);
  assert.ok(timeline[0].spray_index>0.20,"standing water should still generate spray after rainfall stops");
  assert.ok(timeline.at(-1).spray_index<timeline[0].spray_index);
  assert.ok(timeline.at(-1).visibility_index>timeline[0].visibility_index);
});

test("1980 race control never invents modern Safety Car or VSC periods",()=>{
  const state=gs(1980);
  const race=[
    {driver:{driver_id:"D1"},incident_risk_multiplier:3.5,mechanical_risk_multiplier:1},
    {driver:{driver_id:"D2"},incident_risk_multiplier:3.5,mechanical_risk_multiplier:1},
  ];
  const plan=createRaceControlPlan(state,{gp:{gp_id:"historic",track_id:"t"},race,weather:mixedWeather,track});
  assert.equal(plan.rules.era_id,"pre_standard_safety_car");
  assert.ok(plan.periods.every((row)=>!["SAFETY_CAR","VSC"].includes(row.type)));
});

test("1980 local yellow periods are single-lap warnings",()=>{
  let found=null;
  for(let index=0;index<80&&!found;index+=1){
    const state=gs(1980);
    state.saveMeta=createNewSaveMeta({year:1980,teamId:"T1",seed:`rw4.11-yellow-${index}`});
    const race=[
      {driver:{driver_id:"D1"},incident_risk_multiplier:4,mechanical_risk_multiplier:1},
      {driver:{driver_id:"D2"},incident_risk_multiplier:4,mechanical_risk_multiplier:1},
    ];
    const plan=createRaceControlPlan(state,{gp:{gp_id:"historic-yellow",track_id:"t"},race,weather:dryWeather,track});
    const yellows=plan.periods.filter((row)=>row.type==="LOCAL_YELLOW");
    if(yellows.length)found=yellows;
  }
  assert.ok(found?.length,"expected at least one deterministic 1980 local-yellow plan");
  assert.ok(found.every((row)=>Number(row.to_lap)===Number(row.from_lap)));
  assert.ok(found.every((row)=>Number(row.from_sector)>=1&&Number(row.from_sector)<=3));
  assert.ok(found.every((row)=>Number(row.to_sector)===3));
});

test("RW5.2 race control activates at the incident sector, not the whole lap",()=>{
  let plan=null;
  let incident=null;
  for(let index=0;index<120&&!incident;index+=1){
    const state=gs(1980);
    state.saveMeta=createNewSaveMeta({year:1980,teamId:"T1",seed:`rw5-sector-control-${index}`});
    const race=[
      {driver:{driver_id:"D1"},incident_risk_multiplier:4,mechanical_risk_multiplier:0.2},
      {driver:{driver_id:"D2"},incident_risk_multiplier:4,mechanical_risk_multiplier:0.2},
    ];
    const candidate=createRaceControlPlan(state,{gp:{gp_id:"sector-control",track_id:"t"},race,weather:dryWeather,track});
    const crash=candidate.incidents.find((row)=>/accident|collision/i.test(String(row.kind||row.reason||"")));
    if(crash){
      plan=candidate;
      incident=crash;
    }
  }
  assert.ok(plan&&incident);
  assert.ok([1,2,3].includes(Number(incident.sector)));

  const period=plan.periods.find((row)=>String(row.driver_id)===String(incident.driver_id)&&Number(row.from_lap)===Number(incident.lap));
  assert.ok(period);
  assert.equal(Number(period.from_sector),Number(incident.sector));

  if(Number(incident.sector)>1){
    assert.equal(raceControlAtPoint(plan,incident.lap,incident.sector-1).type,"GREEN");
  }
  assert.equal(raceControlAtPoint(plan,incident.lap,incident.sector).type,period.type);
});

test("RW5.2 pre-Safety-Car era allows severe incidents to escalate to red flags",()=>{
  let red=null;
  for(let index=0;index<500&&!red;index+=1){
    const state=gs(1980);
    state.saveMeta=createNewSaveMeta({year:1980,teamId:"T1",seed:`rw5-red-${index}`});
    const race=Array.from({length:12},(_,driverIndex)=>({
      driver:{driver_id:driverIndex%2===0?"D1":"D2"},
      incident_risk_multiplier:4,
      mechanical_risk_multiplier:0.05,
    }));
    const plan=createRaceControlPlan(state,{gp:{gp_id:"red-calibration",track_id:"t"},race,weather:dryWeather,track});
    red=plan.periods.find((row)=>row.type==="RED_FLAG")||null;
  }
  assert.ok(red,"historic severe crashes should be able to produce a red flag without a Safety Car");
  assert.ok([1,2,3].includes(Number(red.from_sector)));
});

test("race-control planning is deterministic for the same Save seed",()=>{
  const state=gs(2015);
  const race=[
    {driver:{driver_id:"D1"},incident_risk_multiplier:2.2,mechanical_risk_multiplier:1.1},
    {driver:{driver_id:"D2"},incident_risk_multiplier:1.8,mechanical_risk_multiplier:1},
  ];
  const a=createRaceControlPlan(state,{gp:{gp_id:"modern",track_id:"t"},race,weather:dryWeather,track});
  const b=createRaceControlPlan(state,{gp:{gp_id:"modern",track_id:"t"},race,weather:dryWeather,track});
  assert.deepEqual(a,b);
});

test("unified reliability reacts to physical condition without practice magic bonuses",()=>{
  const base=gs(1980);
  base.garage={cars:[
    {
      id:"car_1",
      label:"Car 1",
      kind:"race",
      driver_id:"D1",
      installedParts:{},
      componentCondition:{gearbox:100,cooling:100,brakes:100,suspension:100,fuel_system:100,exhaust_system:100},
    },
  ]};

  const healthyProfile=raceReliabilityProfile(base,"T1","D1");
  const healthyRisk=mechanicalRetirementChance(base,{driver:{driver_id:"D1"},mechanical_risk_multiplier:1});

  const worn=structuredClone(base);
  worn.garage.cars[0].componentCondition.gearbox=18;
  worn.garage.cars[0].componentCondition.cooling=22;
  worn.garage.cars[0].componentCondition.brakes=28;
  const wornProfile=raceReliabilityProfile(worn,"T1","D1");
  const wornRisk=mechanicalRetirementChance(worn,{driver:{driver_id:"D1"},mechanical_risk_multiplier:1});

  assert.ok(wornProfile.reliability_pct<healthyProfile.reliability_pct-3);
  assert.ok(wornProfile.condition_penalty_pct>healthyProfile.condition_penalty_pct);
  assert.ok(wornRisk>healthyRisk);

  const focused=structuredClone(worn);
  focused.raceWeekendState={practice:{results:[
    {driver_id:"D1",programme_id:"reliability",reliability_bonus:99},
  ]}};
  const focusedProfile=raceReliabilityProfile(focused,"T1","D1");
  const focusedRisk=mechanicalRetirementChance(focused,{driver:{driver_id:"D1"},mechanical_risk_multiplier:1});

  assert.equal(focusedProfile.practice_bonus_pct,0);
  assert.equal(focusedProfile.reliability_pct,wornProfile.reliability_pct);
  assert.equal(focusedRisk,wornRisk);
});

test("facilities and placeholder research no longer add hidden race reliability",()=>{
  const base=gs(1980);
  const baseline=raceReliabilityProfile(base,"T1","D1");

  const changed=structuredClone(base);
  changed.hq={facilityLevels:{manufacturing_level:9}};
  changed.development={
    projects:[{id:"REL1",area:"Reliability",status:"completed",target_gain:50}],
    research:[{id:"reliability",area:"Reliability",status:"completed",gain:50}],
  };
  const profile=raceReliabilityProfile(changed,"T1","D1");

  assert.equal(profile.facility_bonus_pct,0);
  assert.equal(profile.reliability_pct,baseline.reliability_pct);
  assert.equal(profile.source,"unified_car_reliability_v1");
});

test("RW4.9 canonical accident and mechanical risk stay deterministic inputs for both race paths",()=>{
  const state=gs(1980);
  const row={
    driver:{driver_id:"D1"},
    incident_risk_multiplier:1.4,
    mechanical_risk_multiplier:1.2,
  };
  assert.equal(accidentRetirementChance(state,row),accidentRetirementChance(state,row));
  assert.equal(mechanicalRetirementChance(state,row),mechanicalRetirementChance(state,row));
  assert.ok(accidentRetirementChance(state,row)>0);
  assert.ok(mechanicalRetirementChance(state,row)>0);
});

test("past incidents stay locked while future risk can be recalculated",()=>{
  const previous={
    rules:raceControlRulesForYear(2015),
    incidents:[
      {driver_id:"D1",lap:2,reason:"Collision"},
      {driver_id:"D2",lap:9,reason:"Engine"},
    ],
    periods:[{type:"VSC",from_lap:2,to_lap:3,cause:"incident",priority:2}],
    weather_timeline:Array.from({length:12},(_,i)=>({lap:i+1,state:"SUNNY"})),
  };
  const fresh={
    rules:raceControlRulesForYear(2015),
    incidents:[
      {driver_id:"D1",lap:7,reason:"Accident"},
      {driver_id:"D2",lap:6,reason:"Gearbox"},
    ],
    periods:[{type:"SAFETY_CAR",from_lap:6,to_lap:8,cause:"incident",priority:1}],
    weather_timeline:Array.from({length:12},(_,i)=>({lap:i+1,state:"SUNNY"})),
  };
  const merged=mergeRaceControlHistory(previous,fresh,4);
  assert.equal(merged.incidents.find((row)=>row.driver_id==="D1").lap,2);
  assert.equal(merged.incidents.find((row)=>row.driver_id==="D2").lap,6);
  assert.equal(raceControlAtLap(merged,2).type,"VSC");
  assert.equal(raceControlAtLap(merged,6).type,"SAFETY_CAR");
});


test("unified failure probability is the same function consumed by Race Control",()=>{
  const state=gs(1980);
  state.garage={cars:[{
    id:"car_1",kind:"race",driver_id:"D1",installedParts:{},
    componentCondition:{gearbox:52,cooling:58,suspension:70,brakes:75},
  }]};
  const profile=carReliabilityProfile(state,"T1","D1");
  const direct=mechanicalFailureChance(profile,{
    session:"race",
    riskMultiplier:1.2,
    fatigue:20,
  });
  const control=mechanicalRetirementChance(state,{
    driver:{driver_id:"D1"},
    mechanical_risk_multiplier:1.2,
  });
  assert.equal(control,direct);
});

test("failure cause weighting follows component condition",()=>{
  const state=gs(1980);
  state.garage={cars:[{
    id:"car_1",kind:"race",driver_id:"D1",installedParts:{},
    componentCondition:{gearbox:8,cooling:95,suspension:95,brakes:95,fuel_system:95,exhaust_system:95},
  }]};
  const profile=carReliabilityProfile(state,"T1","D1");
  const gearbox=profile.components.find((row)=>row.slot==="gearbox");
  const cooling=profile.components.find((row)=>row.slot==="cooling");
  assert.ok(gearbox.condition_penalty_pct>cooling.condition_penalty_pct);
  const lowRoll=selectMechanicalFailureReason(profile,0);
  assert.ok(lowRoll.reason);
});


test("RW5.3B.1 observed damage repairs survive future hazard-plan recalculation",()=>{
  const previous={
    incidents:[],
    periods:[],
    damage_repairs:[
      {driver_id:"D1",repair_ordinal:5,source:"red_flag_repair"},
      {driver_id:"D2",repair_ordinal:9,source:"future_test_repair"},
    ],
    weather_timeline:Array.from({length:12},(_,index)=>({lap:index+1})),
  };
  const fresh={
    incidents:[],
    periods:[],
    weather_timeline:Array.from({length:12},(_,index)=>({lap:index+1})),
  };
  const merged=mergeRaceControlHistory(previous,fresh,2,2);
  assert.equal(merged.damage_repairs.length,1);
  assert.equal(merged.damage_repairs[0].driver_id,"D1");
  assert.equal(merged.damage_repairs[0].repair_ordinal,5);
});
