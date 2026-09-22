import test from "node:test";
import assert from "node:assert/strict";
import {
  driverAttributeGroups,
  driverAttributeGroupScore,
  driverAttributeGroupBehaviourForScore,
  driverAttributeTrainingLimit,
  driverGroupDevelopmentPlan,
  driverWheelToWheelBehaviour,
} from "../src/domain/driverAttributeGroups.js";
import { applyProgressionTick } from "../src/engine/ProgressionEngine.js";

const rating={
  year:1980,
  driver_id:"D1",
  current_ability:70,
  potential_ability:82,
  pace:76,
  qualifying:72,
  start_launch:68,
  racecraft:74,
  wet_skill:70,
  consistency:73,
  tire_management:69,
  race_intelligence:75,
  technical_feedback:67,
  adaptability:71,
  ers_fuel_management:68,
  mentality:72,
  aggression:78,
  crash_likelihood:24,
  pressure_handling:74,
  leadership:66,
  team_player:70,
  car_development_impact:65,
};

test("driver groups expose simple positive-direction averages",()=>{
  const groups=driverAttributeGroups();
  assert.deepEqual(groups.map((group)=>group.key),[
    "pace","racecraft","control","management","technical","mental","risk",
  ]);
  assert.equal(driverAttributeGroupScore(rating,"pace"),72);
  assert.equal(driverAttributeGroupScore(rating,"risk"),77);
});

test("group behaviour summaries translate scores into race-facing descriptions",()=>{
  const strong=driverAttributeGroupBehaviourForScore("management",82);
  const weak=driverAttributeGroupBehaviourForScore("management",48);
  assert.equal(strong.band,"strong");
  assert.match(strong.text,/tyres|resources/i);
  assert.equal(weak.band,"weak");
  assert.match(weak.text,/strategy|stint/i);
});

test("focused development is potential-bound and slows before the ceiling",()=>{
  const plan=driverGroupDevelopmentPlan(rating,"pace",{baseGain:1});
  assert.equal(plan.length,3);
  assert.ok(plan.every((change)=>change.after>change.before));
  assert.ok(plan.every((change)=>change.after<=change.limit));
  assert.ok(plan.every((change)=>change.limit<100));

  const paceLimit=driverAttributeTrainingLimit(rating,driverAttributeGroups()[0].attributes[0]);
  assert.equal(paceLimit.limit,85);

  const capped=driverGroupDevelopmentPlan({...rating,current_ability:82},"pace",{baseGain:1});
  assert.deepEqual(capped,[]);
});

test("risk focus improves control by reducing crash likelihood rather than increasing it",()=>{
  const plan=driverGroupDevelopmentPlan(rating,"risk",{baseGain:1});
  const crash=plan.find((change)=>change.field==="crash_likelihood");
  const aggression=plan.find((change)=>change.field==="aggression");
  assert.ok(crash);
  assert.ok(aggression);
  assert.ok(crash.delta<0);
  assert.ok(aggression.delta>0);
  assert.ok(crash.after>=crash.limit);
});

test("wheel-to-wheel summary distinguishes attacking and defensive profiles",()=>{
  const attacking=driverWheelToWheelBehaviour(86,58);
  const defensive=driverWheelToWheelBehaviour(58,86);
  const complete=driverWheelToWheelBehaviour(88,87);
  assert.match(attacking.text,/overtak|attack/i);
  assert.match(attacking.text,/defend|protect/i);
  assert.match(defensive.text,/pass|attack/i);
  assert.match(complete.text,/attack|overtak/i);
  assert.match(complete.text,/defen|protect/i);
});

test("monthly progression applies the selected group focus and logs its source",()=>{
  const gs={
    activeYear:1980,
    currentDateISO:"1980-02-01",
    _lastDriverProgressionMonth:"1980-01",
    team:{team_id:"T1",team_name:"Player Team"},
    drivers:[{driver_id:"D1",display_name:"Focused Driver",age:22}],
    driverRatings:[{...rating}],
    driverAttributes:{D1:{confidence:50,fatigue:0,morale:50,preparation:50}},
    contracts:[{
      year:1980,
      driver_id:"D1",
      team_id:"T1",
      team_name:"Player Team",
      role:"Main Driver",
      status:"active",
      contract_start_year:1980,
      contract_until_year:1981,
    }],
    facilities:[{year:1980,team_id:"T1",simulator_level:5}],
    driverDevelopmentFocus:{D1:"pace"},
    driverDevelopmentFocusMeta:{D1:{groupKey:"pace",monthKey:"1980-01",selectedAt:"1980-01-01"}},
    driverDevelopmentTraining:{D1:{monthKey:"1980-01",groupKey:"pace",trainingDays:18,fatigueSpent:36,lastTrainingDate:"1980-01-31"}},
    results:[],
  };

  const next=applyProgressionTick(gs);
  const focusChanges=(next.driverAttrLog?.["0001"]||next.driverAttrLog?.D1||[])
    .filter((row)=>row.source==="development_focus_pace");

  assert.ok(focusChanges.length>0);
  assert.ok(focusChanges.every((row)=>["pace","qualifying","start_launch"].includes(row.attr)));
  assert.equal(next.driverDevelopmentFocus.D1,"pace");
  assert.equal(next.driverDevelopmentTraining.D1.monthKey,"1980-02");
});

test("monthly focus adds weekday fatigue progressively and auto-locks a carried focus",()=>{
  const gs={
    activeYear:1980,
    currentDateISO:"1980-02-04",
    _lastDriverProgressionMonth:"1980-02",
    team:{team_id:"T1"},
    drivers:[{driver_id:"D1",display_name:"Focused Driver",age:22}],
    driverRatings:[{...rating}],
    driverAttributes:{D1:{confidence:50,fatigue:10,morale:50,preparation:50}},
    contracts:[{year:1980,driver_id:"D1",team_id:"T1",role:"Main Driver",status:"active",contract_until_year:1981}],
    driverDevelopmentFocus:{D1:"pace"},
    driverDevelopmentFocusMeta:{D1:{groupKey:"pace",monthKey:"1980-01",selectedAt:"1980-01-01"}},
  };

  const next=applyProgressionTick(gs);
  assert.ok(next.driverAttributes.D1.fatigue>10,"weekday development load should exceed normal recovery");
  assert.equal(next.driverDevelopmentTraining.D1.trainingDays,1);
  assert.equal(next.driverDevelopmentTraining.D1.fatigueSpent,2);
  assert.equal(next.driverDevelopmentFocusMeta.D1.monthKey,"1980-02");
  assert.equal(next.driverDevelopmentFocusMeta.D1.groupKey,"pace");

  const sameDay=applyProgressionTick(next);
  assert.equal(sameDay.driverDevelopmentTraining.D1.trainingDays,1,"training load must be idempotent on the same date");
});
