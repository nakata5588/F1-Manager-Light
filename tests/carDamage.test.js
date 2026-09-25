import test from "node:test";
import assert from "node:assert/strict";

import {
  damageFromIncident,
  damagePenaltyMsBetweenOrdinals,
  damageStateFromComponents,
  damageStateThroughTimeline,
  mergeDamageStates,
  repairDamageState,
} from "../src/engine/CarDamageEngine.js";
import { createRaceControlPlan } from "../src/engine/RaceControlEngine.js";
import { finalizedLiveRaceRows } from "../src/engine/LiveRaceEngine.js";
import { createNewSaveMeta } from "../src/core/saveSafety.js";

function controlGs(seed="rw5.3a"){
  return {
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed}),
    activeYear:1980,
    team:{team_id:"T1"},
    drivers:[
      {driver_id:"D1",team_id:"T1"},
      {driver_id:"D2",team_id:"T2"},
    ],
    driverRatings:[
      {driver_id:"D1",crash_likelihood:70},
      {driver_id:"D2",crash_likelihood:70},
    ],
    driverAttributes:{D1:{fatigue:30},D2:{fatigue:30}},
    raceEntryState:{entries:[
      {driver_id:"D1",team_id:"T1",status:"confirmed"},
      {driver_id:"D2",team_id:"T2",status:"confirmed"},
    ]},
    carStats:[
      {year:1980,team_id:"T1",reliability:96},
      {year:1980,team_id:"T2",reliability:96},
    ],
    teamEngines:[
      {year:1980,team_id:"T1",reliability:96},
      {year:1980,team_id:"T2",reliability:96},
    ],
    accidentModel:[{year:1980,damage_DNF_prob:0.16}],
    dbWeatherStates:[{id:"SUNNY",crash_risk_ppm:1,dnf_risk_ppm:1}],
  };
}

const track={track_id:"damage_test",laps:12,lap_length_km:5,pit_lane_loss_s:22};
const weather={state:"SUNNY",segments:[{from_lap:1,to_lap:12,state:"SUNNY"}]};

test("RW5.3A component damage produces explicit performance effects",()=>{
  const state=damageStateFromComponents({
    front_wing:60,
    floor:35,
    suspension:20,
  });
  assert.deepEqual(state.damaged_components,["front_wing","floor","suspension"]);
  assert.equal(state.components.front_wing.severity,"major");
  assert.ok(state.aero_loss_pct>40);
  assert.ok(state.handling_loss_pct>10);
  assert.ok(state.pace_loss_s_per_lap>0.7);
  assert.equal(state.can_continue,true);
});

test("RW5.3A incident damage can be survivable or terminal from the same physical model",()=>{
  const survivable=damageFromIncident({
    kind:"collision",
    severityScore:0.55,
    componentRolls:[0.5,0.5,0.5,0.5,0.5,0.5],
    impactRoll:0.45,
    retirementRoll:1,
  });
  assert.ok(survivable?.damaged_components?.length>=2);
  assert.equal(survivable.retirement_required,false);
  assert.ok(survivable.pace_loss_s_per_lap>0);

  const terminal=damageFromIncident({
    kind:"accident",
    severityScore:0.98,
    componentRolls:[0.9,0.9,0.9,0.9,0.9,0.9],
    impactRoll:1,
    retirementRoll:0,
  });
  assert.equal(terminal.retirement_required,true);
  assert.ok(["major","critical"].includes(terminal.severity));
});

test("RW5.3A repeated contact accumulates rather than replacing previous damage",()=>{
  const first=damageStateFromComponents({front_wing:35,floor:15});
  const second=damageStateFromComponents({front_wing:30,suspension:25});
  const merged=mergeDamageStates([first,second]);
  assert.ok(merged.components.front_wing.damage_pct>35);
  assert.ok(merged.components.suspension.damage_pct>=25);
  assert.ok(merged.pace_loss_s_per_lap>first.pace_loss_s_per_lap);
});

test("RW5.3A damage costs time only after the incident point",()=>{
  const damage=damageStateFromComponents({front_wing:60});
  const incidents=[{
    driver_id:"D1",
    damage_ordinal:5,
    damage,
  }];
  assert.equal(damagePenaltyMsBetweenOrdinals(incidents,"D1",0,5),0);
  assert.ok(damagePenaltyMsBetweenOrdinals(incidents,"D1",5,8)>0);
  assert.ok(damagePenaltyMsBetweenOrdinals(incidents,"D2",5,8)===0);
});

test("RW5.3A Race Control gives crash incidents explicit damage and retirement booleans",()=>{
  let crash=null;
  let repairable=null;
  for(let index=0;index<250&&(!crash||!repairable);index+=1){
    const state=controlGs(`rw5.3a-plan-${index}`);
    const plan=createRaceControlPlan(state,{
      gp:{gp_id:"damage-plan",track_id:"damage_test"},
      race:[
        {driver:{driver_id:"D1"},incident_risk_multiplier:4,mechanical_risk_multiplier:0.01},
        {driver:{driver_id:"D2"},incident_risk_multiplier:4,mechanical_risk_multiplier:0.01},
      ],
      weather,
      track,
    });
    for(const incident of plan.incidents){
      if(!/accident|collision/.test(String(incident?.kind||"")))continue;
      crash=crash||incident;
      if(incident.retirement===false&&incident.damage)repairable=incident;
    }
  }
  assert.ok(crash,"expected a deterministic crash sample");
  assert.equal(typeof crash.retirement,"boolean");
  assert.ok(crash.damage);
  assert.equal(crash.damage.model,"rw5.3a");
  assert.ok(crash.damage.damaged_components.length>0);
  assert.ok(repairable,"damage model should allow some crash incidents to continue");
  assert.equal(repairable.retirement,false);
  assert.ok(repairable.damage.pace_loss_s_per_lap>0);
});

test("RW5.3A finalised Live Race rows preserve damage and damage-adjusted lap times",()=>{
  const damage=damageStateFromComponents({front_wing:60});
  const baseLap=90000;
  const gs={
    raceWeekendState:{
      race_strategy:{
        race_control_plan:{
          incidents:[{
            driver_id:"D1",
            lap:1,
            sector:1,
            retirement:false,
            damage_ordinal:1,
            damage,
          }],
        },
      },
      live_race:{
        status:"finished",
        current_lap:3,
        current_sector:3,
        total_laps:3,
        classification:[{
          driver_id:"D1",
          position:1,
          elapsed_ms:272000,
          retired:false,
          status:"RUNNING",
          damage_state:damage,
          damage_severity:damage.severity,
          damaged_components:damage.damaged_components,
          damage_pace_loss_s_per_lap:damage.pace_loss_s_per_lap,
          damage_incident_lap:1,
          damage_incident_sector:1,
          incident_kind:"collision",
          incident_reason:"Collision",
        }],
        projected_race:[{
          driver:{driver_id:"D1"},
          pos:1,
          race_laps:3,
          lap_times_ms:[baseLap,baseLap,baseLap],
          pit_stops:[],
          tyre_state_by_lap:[],
          strategy_decisions:[],
          stints:[],
          strategy_summary:{pit_count:0},
        }],
      },
    },
  };
  const rows=finalizedLiveRaceRows(gs);
  assert.equal(rows.length,1);
  assert.equal(rows[0].damage_severity,damage.severity);
  assert.deepEqual(rows[0].damaged_components,damage.damaged_components);
  assert.ok(rows[0].lap_times_ms[1]>baseLap);
  assert.ok(rows[0].best_lap_ms>=baseLap);
  assert.equal(rows[0].incident_kind,"collision");
});


test("RW5.3A.1 era calibration can raise conditional DNF probability without changing damage physics",()=>{
  const damage=damageFromIncident({
    kind:"accident",
    severityScore:0.40,
    componentRolls:[0.5,0.5,0.5,0.5,0.5,0.5],
    impactRoll:0.5,
    retirementRoll:0.80,
    retirementProbabilityOverride:0.70,
  });
  assert.ok(damage);
  assert.equal(damage.retirement_probability_source,"era_calibration");
  assert.equal(damage.retirement_probability,0.7);
  assert.ok(damage.damage_retirement_probability<damage.retirement_probability);
  assert.equal(damage.retirement_required,false);

  const retired=damageFromIncident({
    kind:"accident",
    severityScore:0.40,
    componentRolls:[0.5,0.5,0.5,0.5,0.5,0.5],
    impactRoll:0.5,
    retirementRoll:0.60,
    retirementProbabilityOverride:0.70,
  });
  assert.equal(retired.retirement_required,true);
  assert.deepEqual(retired.components,damage.components);
});


test("RW5.3B.1 Red Flag repair removes replaceable aero damage and reduces residual pace loss",()=>{
  const damaged=damageStateFromComponents({
    front_wing:72,
    floor:50,
    suspension:28,
  });
  const repaired=repairDamageState(damaged);

  assert.equal(repaired.components.front_wing.damage_pct,0);
  assert.ok(repaired.components.floor.damage_pct>0);
  assert.ok(repaired.components.floor.damage_pct<damaged.components.floor.damage_pct);
  assert.ok(repaired.components.suspension.damage_pct<damaged.components.suspension.damage_pct);
  assert.ok(repaired.pace_loss_s_per_lap<damaged.pace_loss_s_per_lap);
});

test("RW5.3B.1 repair changes only future damage penalty, never the already-driven segment",()=>{
  const damage=damageStateFromComponents({front_wing:70,floor:45});
  const incidents=[{
    driver_id:"D1",
    damage_ordinal:3,
    damage,
  }];
  const repairs=[{
    driver_id:"D1",
    repair_ordinal:6,
    source:"red_flag_repair",
  }];

  const beforeRepair=damagePenaltyMsBetweenOrdinals(incidents,"D1",3,6,repairs);
  const afterRepair=damagePenaltyMsBetweenOrdinals(incidents,"D1",6,9,repairs);
  const noRepairAfter=damagePenaltyMsBetweenOrdinals(incidents,"D1",6,9,[]);

  assert.ok(beforeRepair>0);
  assert.ok(afterRepair>0);
  assert.ok(afterRepair<noRepairAfter);
});

test("RW5.3B.1 later contact accumulates onto residual post-repair damage",()=>{
  const first=damageStateFromComponents({front_wing:65,floor:40});
  const second=damageStateFromComponents({suspension:35});
  const incidents=[
    {driver_id:"D1",damage_ordinal:3,damage:first},
    {driver_id:"D1",damage_ordinal:9,damage:second},
  ];
  const repairs=[{driver_id:"D1",repair_ordinal:6,source:"red_flag_repair"}];

  const afterRepair=damageStateThroughTimeline(incidents,repairs,"D1",6);
  const afterSecond=damageStateThroughTimeline(incidents,repairs,"D1",9);

  assert.equal(afterRepair.components.front_wing.damage_pct,0);
  assert.ok(afterSecond.components.suspension.damage_pct>afterRepair.components.suspension.damage_pct);
  assert.ok(afterSecond.pace_loss_s_per_lap>afterRepair.pace_loss_s_per_lap);
});
