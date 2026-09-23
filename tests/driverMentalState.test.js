import test from "node:test";
import assert from "node:assert/strict";
import {
  appendDriverMentalStateLog,
  applyDriverMentalState,
  applyMentalStateDeltaToCondition,
  driverMentalStateHistory,
  passiveMentalStateRecovery,
  raceMentalStateChange,
  seasonStartMentalState,
} from "../src/domain/driverMentalState.js";
import { conditionModifierBreakdown } from "../src/domain/driverPerformance.js";

test("mental state deltas are temporary and clamped without touching ratings",()=>{
  const gs={
    currentDateISO:"1980-05-20",
    driverRatings:[{driver_id:"D1",current_ability:90,pace:92}],
    driverAttributes:{D1:{confidence:95,morale:5,preparation:50,fatigue:98}},
  };
  const next=applyDriverMentalState(gs,"D1",{
    deltas:{confidence:20,morale:-20,preparation:7,fatigue:10},
    source:"test",
  });

  assert.equal(next.driverAttributes.D1.confidence,100);
  assert.equal(next.driverAttributes.D1.morale,0);
  assert.equal(next.driverAttributes.D1.preparation,57);
  assert.equal(next.driverAttributes.D1.fatigue,100);
  assert.deepEqual(next.driverRatings,gs.driverRatings);
  assert.equal(next.driverMentalStateLog.D1.length,1);
});

test("passive recovery reduces fatigue and mean-reverts confidence/morale",()=>{
  const next=passiveMentalStateRecovery(
    {confidence:80,morale:20,preparation:40,fatigue:70},
    {dateISO:"1980-05-24"}
  );
  assert.ok(next.fatigue<70);
  assert.ok(next.preparation>40);
  assert.ok(next.confidence<80);
  assert.ok(next.morale>20);
});

test("season start resets physical load while preserving some confidence/morale momentum",()=>{
  const next=seasonStartMentalState({confidence:80,morale:20,preparation:90,fatigue:75});
  assert.equal(next.fatigue,0);
  assert.equal(next.preparation,50);
  assert.equal(next.confidence,60.5);
  assert.equal(next.morale,39.5);
});

test("mechanical DNF hurts the team but does not blame Driver Morale or Confidence",()=>{
  const change=raceMentalStateChange({
    pos:20,
    retired:true,
    retirement_reason:"Engine",
    laps_completed:30,
    race_laps:60,
  },{startPosition:5,fieldSize:20,wet:false});

  assert.equal(change.deltas.confidence,0);
  assert.equal(change.deltas.morale,0);
  assert.equal(change.deltas.preparation,-10);
  assert.ok(change.reasons.some((reason)=>/Mechanical/i.test(reason)));
});

test("accident DNF reduces Driver Morale while a points result above expectation raises it",()=>{
  const crash=raceMentalStateChange({
    pos:18,
    retired:true,
    retirement_reason:"Accident",
    laps_completed:20,
    race_laps:60,
  },{startPosition:8,expectedPosition:9,fieldSize:20,wet:false});
  assert.ok(crash.deltas.morale<0);
  assert.ok(crash.deltas.confidence<0);

  const strong=raceMentalStateChange({
    pos:5,
    retired:false,
    points:2,
    laps_completed:60,
    race_laps:60,
  },{startPosition:8,expectedPosition:10,points:2,fieldSize:20,wet:false});
  assert.ok(strong.deltas.morale>1);
  assert.ok(strong.deltas.confidence>1);
  assert.ok(strong.reasons.some((reason)=>/above expectation/i.test(reason)));
  assert.ok(strong.reasons.some((reason)=>/Points finish/i.test(reason)));
});

test("condition delta helper keeps all four values in range",()=>{
  const next=applyMentalStateDeltaToCondition(
    {confidence:50,morale:50,preparation:50,fatigue:0},
    {confidence:100,morale:-100,preparation:60,fatigue:-20}
  );
  assert.deepEqual(next,{confidence:100,fatigue:0,morale:0,preparation:100});
});


test("mental state changes Current Performance while permanent Overall stays fixed",()=>{
  const gs={
    driverRatings:[{driver_id:"D1",current_ability:90,pace:92}],
    driverAttributes:{D1:{confidence:50,morale:50,preparation:50,fatigue:0}},
  };
  const before=conditionModifierBreakdown(gs,"D1").total;
  const next=applyDriverMentalState(gs,"D1",{
    deltas:{confidence:-15,morale:-10,preparation:-20,fatigue:65},
    source:"stress-test",
  });
  const after=conditionModifierBreakdown(next,"D1").total;

  assert.ok(after<before);
  assert.equal(next.driverRatings[0].current_ability,90);
});


test("mental-state history resolves compatible driver ID keys and keeps human-readable causes",()=>{
  const logs=appendDriverMentalStateLog({},"0001",{
    before:{confidence:50,morale:50,preparation:50,fatigue:0},
    after:{confidence:51,morale:50,preparation:58,fatigue:7},
    source:"practice",
    reason:"Balanced practice",
    dateISO:"1980-01-10",
  });
  const history=driverMentalStateHistory({driverMentalStateLog:logs},"D1",{limit:5});
  assert.equal(history.length,1);
  assert.equal(history[0].reason,"Balanced practice");
  assert.equal(history[0].changes.find((row)=>row.field==="preparation").delta,8);
});
