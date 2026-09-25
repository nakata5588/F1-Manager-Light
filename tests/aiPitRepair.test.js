import test from "node:test";
import assert from "node:assert/strict";

import { aiPitRepairDecision } from "../src/engine/AIPitRepairEngine.js";
import { damageStateFromComponents } from "../src/engine/CarDamageEngine.js";

test("RW5.3B.2C ignores minor damage when a dedicated stop cannot pay back",()=>{
  const damage=damageStateFromComponents({front_wing:20});
  const decision=aiPitRepairDecision({
    year:1980,
    damageState:damage,
    remainingLaps:5,
    alreadyStopping:false,
    pitLaneLossS:24,
    controlType:"GREEN",
    raceIntelligence:70,
    aggression:50,
    trackOvertakingDifficulty:60,
  });
  assert.equal(decision.should_repair,false);
  assert.equal(decision.dedicated_stop,false);
});

test("RW5.3B.2C repairs valuable damage opportunistically during an existing stop",()=>{
  const damage=damageStateFromComponents({front_wing:70});
  const decision=aiPitRepairDecision({
    year:1980,
    damageState:damage,
    remainingLaps:20,
    alreadyStopping:true,
    tyreChange:true,
    tyreServiceS:6.8,
    pitLaneLossS:24,
    controlType:"GREEN",
    raceIntelligence:75,
    aggression:50,
    trackOvertakingDifficulty:70,
  });
  assert.equal(decision.should_repair,true);
  assert.equal(decision.dedicated_stop,false);
  assert.ok(decision.repair_components.includes("front_wing"));
  assert.ok(decision.recovered_pace_s_per_lap>0);
  assert.ok(decision.projected_stay_out_loss_s>decision.incremental_service_s);
  assert.ok(decision.decision_margin_s>0);
});

test("RW5.3B.2C neutralisation can turn a dedicated repair stop into good value",()=>{
  const damage=damageStateFromComponents({front_wing:90});
  const common={
    year:1980,
    damageState:damage,
    remainingLaps:40,
    alreadyStopping:false,
    pitLaneLossS:24,
    raceIntelligence:60,
    aggression:50,
    trackOvertakingDifficulty:50,
    position:20,
    fieldSize:20,
  };
  const green=aiPitRepairDecision({...common,controlType:"GREEN"});
  const safetyCar=aiPitRepairDecision({...common,controlType:"SAFETY_CAR"});
  assert.equal(green.should_repair,false);
  assert.equal(safetyCar.should_repair,true);
  assert.equal(safetyCar.dedicated_stop,true);
  assert.ok(safetyCar.effective_pit_cost_s<green.effective_pit_cost_s);
});

test("RW5.3B.2C aggression changes willingness to sacrifice track time",()=>{
  const damage=damageStateFromComponents({front_wing:60});
  const common={
    year:1980,
    damageState:damage,
    remainingLaps:14,
    alreadyStopping:true,
    tyreChange:true,
    tyreServiceS:6.8,
    raceIntelligence:70,
    trackOvertakingDifficulty:50,
  };
  const measured=aiPitRepairDecision({...common,aggression:30});
  const aggressive=aiPitRepairDecision({...common,aggression:90});
  assert.ok(measured.decision_margin_s>aggressive.decision_margin_s);
});
