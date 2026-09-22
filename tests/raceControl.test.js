import test from "node:test";
import assert from "node:assert/strict";

import {
  accidentRetirementChance,
  buildTrackWeatherTimeline,
  createRaceControlPlan,
  mechanicalRetirementChance,
  mergeRaceControlHistory,
  raceControlAtLap,
  raceControlRulesForYear,
} from "../src/engine/RaceControlEngine.js";
import { createNewSaveMeta } from "../src/core/saveSafety.js";
import { raceReliabilityProfile } from "../src/domain/carPerformance.js";

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
  assert.ok(timeline[3].grip_index<timeline[11].grip_index);
  assert.ok(timeline[0].crash_risk_multiplier>1);
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

test("RW4.9 canonical reliability reacts to component condition and Reliability Focus",()=>{
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

  assert.ok(wornProfile.reliability_pct<healthyProfile.reliability_pct-5);
  assert.ok(wornRisk>healthyRisk);

  const focused=structuredClone(worn);
  focused.raceWeekendState={practice:{results:[
    {driver_id:"D1",programme_id:"reliability",reliability_bonus:1.35},
  ]}};
  const focusedProfile=raceReliabilityProfile(focused,"T1","D1");
  const focusedRisk=mechanicalRetirementChance(focused,{driver:{driver_id:"D1"},mechanical_risk_multiplier:1});

  assert.equal(focusedProfile.practice_bonus_pct,1.4);
  assert.ok(focusedProfile.reliability_pct>wornProfile.reliability_pct);
  assert.ok(focusedRisk<wornRisk);
});

test("RW4.9 facilities and completed reliability work feed the same canonical race profile",()=>{
  const base=gs(1980);
  const baseline=raceReliabilityProfile(base,"T1","D1");

  const improved=structuredClone(base);
  improved.hq={facilityLevels:{manufacturing_level:9}};
  improved.development={
    projects:[
      {id:"REL1",area:"Reliability",status:"completed",target_gain:3},
    ],
  };
  const profile=raceReliabilityProfile(improved,"T1","D1");

  assert.equal(profile.manufacturing_level,9);
  assert.equal(profile.facility_bonus_pct,1.6);
  assert.equal(profile.development_bonus_pct,1.2);
  assert.ok(profile.reliability_pct>baseline.reliability_pct);
  assert.equal(profile.source,"canonical_race_reliability");
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
