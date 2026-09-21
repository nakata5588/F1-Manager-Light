import test from "node:test";
import assert from "node:assert/strict";
import {
  abilityAttributeScore,
  ensureAbilityAnchor,
  recalculateCurrentAbility,
  fatiguePenalty,
  defaultDriverCondition,
} from "../src/domain/driverRating.js";
import { triggerDailyTick } from "../src/engine/EventEngine.js";

const baseRating={
  year:1980,
  driver_id:"d_test",
  current_ability:70,
  potential_ability:80,
  pace:80,
  qualifying:78,
  start_launch:76,
  racecraft:79,
  wet_skill:72,
  consistency:75,
  tire_management:74,
  race_intelligence:77,
  technical_feedback:70,
  adaptability:73,
  ers_fuel_management:70,
  mentality:76,
  pressure_handling:75,
  crash_likelihood:20,
};

test("driver overall moves from attribute changes while preserving historical baseline",()=>{
  const anchored=ensureAbilityAnchor(baseRating);
  assert.equal(anchored._ability_anchor_current,70);
  assert.ok(Number.isFinite(abilityAttributeScore(anchored)));

  const improved=recalculateCurrentAbility({...anchored,consistency:anchored.consistency+5});
  assert.ok(improved.current_ability>70,"consistency training should increase live overall");
  assert.ok(improved.current_ability<=80,"overall must respect potential ceiling");

  const regressed=recalculateCurrentAbility({...anchored,pace:anchored.pace-5});
  assert.ok(regressed.current_ability<70,"attribute decline should lower live overall");
});

test("driver action persists fatigue and recalculates overall in the daily event tick",()=>{
  const gs={
    currentDateISO:"1980-01-02",
    drivers:[{driver_id:"d_0001",display_name:"Test Driver"}],
    driverRatings:[{...baseRating,driver_id:"d_0001"}],
    driverAttributes:{
      d_0001:{confidence:50,fatigue:0,morale:50,preparation:50},
    },
    eventsQueue:[{
      id:"ev_train",
      type:"driver_action",
      title:"Simulator — Consistency",
      participants:["d_0001"],
      meta:{driverId:"d_0001"},
      effects:[
        {key:"driver_attr",driverId:"d_0001",attr:"consistency",delta:1},
        {key:"fatigue",delta:2},
      ],
      dateISO:"1980-01-02",
      done:false,
    }],
    inbox:[],
  };

  const next=triggerDailyTick(gs);
  const rating=next.driverRatings.find((r)=>r.driver_id==="d_0001");
  assert.equal(rating.consistency,76);
  assert.ok(rating.current_ability>70);
  assert.equal(next.driverAttributes.d_0001.fatigue,2);
  assert.equal(next.eventsQueue[0].done,true);
});

test("new drivers start fresh and fatigue becomes a real 0-100 performance penalty",()=>{
  assert.deepEqual(defaultDriverCondition(),{confidence:50,fatigue:0,morale:50,preparation:50});
  assert.equal(fatiguePenalty({driverAttributes:{d1:{fatigue:10}}},"d1"),0);
  assert.ok(fatiguePenalty({driverAttributes:{d1:{fatigue:25}}},"d1")>0);
  assert.ok(fatiguePenalty({driverAttributes:{d1:{fatigue:50}}},"d1")>fatiguePenalty({driverAttributes:{d1:{fatigue:25}}},"d1"));
  assert.ok(fatiguePenalty({driverAttributes:{d1:{fatigue:70}}},"d1")>=6);
  assert.equal(fatiguePenalty({driverAttributes:{d1:{fatigue:100}}},"d1"),10.8);
});


test("profile condition actions persist confidence, morale and preparation",()=>{
  const gs={
    currentDateISO:"1980-01-03",
    drivers:[{driver_id:"d_0001",display_name:"Test Driver"}],
    driverRatings:[{...baseRating,driver_id:"d_0001"}],
    driverAttributes:{d_0001:{confidence:50,fatigue:0,morale:50,preparation:50}},
    eventsQueue:[{
      id:"ev_condition",
      type:"driver_action",
      title:"Data review",
      participants:["d_0001"],
      effects:[
        {key:"driver_condition",driverId:"d_0001",attr:"preparation",delta:2},
        {key:"driver_condition",driverId:"d_0001",attr:"confidence",delta:1},
        {key:"driver_condition",driverId:"d_0001",attr:"morale",delta:1},
      ],
      dateISO:"1980-01-03",
      done:false,
    }],
    inbox:[],
  };
  const next=triggerDailyTick(gs);
  assert.equal(next.driverAttributes.d_0001.preparation,52);
  assert.equal(next.driverAttributes.d_0001.confidence,51);
  assert.equal(next.driverAttributes.d_0001.morale,51);
});


test("high fatigue blocks intensive training instead of allowing endless sessions",()=>{
  const gs={
    currentDateISO:"1980-01-04",
    drivers:[{driver_id:"d_0001",display_name:"Tired Driver"}],
    driverRatings:[{...baseRating,driver_id:"d_0001"}],
    driverAttributes:{d_0001:{confidence:50,fatigue:85,morale:50,preparation:50}},
    eventsQueue:[{
      id:"ev_tired_train",
      type:"driver_action",
      title:"Simulator — Pace",
      participants:["d_0001"],
      meta:{driverId:"d_0001",uiKey:"sim_pace"},
      effects:[
        {key:"driver_attr",driverId:"d_0001",attr:"pace",delta:1},
        {key:"fatigue",delta:2},
      ],
      dateISO:"1980-01-04",
      done:false,
    }],
    inbox:[],
  };

  const next=triggerDailyTick(gs);
  const rating=next.driverRatings.find((r)=>r.driver_id==="d_0001");
  assert.equal(rating.pace,80);
  assert.equal(next.driverAttributes.d_0001.fatigue,85);
  assert.ok(next.inbox.some((m)=>/Training cancelled/.test(String(m.body||""))));
});

test("moderate fatigue reduces intensive training gains before the hard block",()=>{
  const gs={
    currentDateISO:"1980-01-05",
    drivers:[{driver_id:"d_0001",display_name:"Loaded Driver"}],
    driverRatings:[{...baseRating,driver_id:"d_0001"}],
    driverAttributes:{d_0001:{confidence:50,fatigue:50,morale:50,preparation:50}},
    eventsQueue:[{
      id:"ev_loaded_train",
      type:"driver_action",
      title:"Simulator — Pace",
      participants:["d_0001"],
      meta:{driverId:"d_0001",uiKey:"sim_pace"},
      effects:[
        {key:"driver_attr",driverId:"d_0001",attr:"pace",delta:1},
        {key:"fatigue",delta:2},
      ],
      dateISO:"1980-01-05",
      done:false,
    }],
    inbox:[],
  };

  const next=triggerDailyTick(gs);
  const rating=next.driverRatings.find((r)=>r.driver_id==="d_0001");
  assert.equal(rating.pace,80.75);
  assert.equal(next.driverAttributes.d_0001.fatigue,52);
});
