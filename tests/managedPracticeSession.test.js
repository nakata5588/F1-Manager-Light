import test from "node:test";
import assert from "node:assert/strict";
import {managedPracticeState,appendPracticeStint,markPracticeDamage,repairPracticeCar,canRunPracticeStint,managedPracticeSummary} from "../src/engine/ManagedPracticeSession.js";

test("managed Practice stints consume shared session clock and retain outcomes",()=>{
  const initial=managedPracticeState({});
  const first=appendPracticeStint(initial,{driverId:"D1",programmeId:"setup",minutes:10,outcome:{setup_quality:88}});
  const second=appendPracticeStint(first,{driverId:"D2",programmeId:"race",minutes:15,outcome:{setup_quality:72}});
  assert.equal(second.elapsed_minutes,25);
  assert.equal(second.stints.length,2);
  assert.equal(second.stints[0].outcome.setup_quality,88);
  assert.equal(second.stints[1].start_minute,10);
  assert.equal(canRunPracticeStint(second,"D1",40),false);
});
test("damaged car cannot run until repair, which consumes shared minutes",()=>{
  const initial=markPracticeDamage(managedPracticeState({}),"D1","Front wing");
  assert.equal(canRunPracticeStint(initial,"D1",10),false);
  const repaired=repairPracticeCar(initial,{driverId:"D1",minutes:15});
  assert.equal(repaired.elapsed_minutes,15);
  assert.equal(canRunPracticeStint(repaired,"D1",10),true);
  assert.equal(repaired.repairs.D1,null);
});

test("a repair cannot consume time beyond the end of Practice",()=>{
  const state=markPracticeDamage({...managedPracticeState({}),elapsed_minutes:52},"D1","Suspension");
  const blocked=repairPracticeCar(state,{driverId:"D1",minutes:15});
  assert.deepEqual(blocked,state);
  assert.equal(canRunPracticeStint(blocked,"D1",5),false);
});
test("stint summary reflects recorded outcomes and elapsed running",()=>{
  let state=managedPracticeState({});
  state=appendPracticeStint(state,{driverId:"D1",programmeId:"race",minutes:10,outcome:{setup_quality:80}});
  state=appendPracticeStint(state,{driverId:"D1",programmeId:"setup",minutes:10,outcome:{setup_quality:90,issue_type:"contact"}});
  assert.deepEqual(managedPracticeSummary(state,"D1"),{stints:2,minutes:20,issues:1,lastOutcome:{setup_quality:90,issue_type:"contact"}});
});

test("managed Practice state survives JSON save/load without losing stint outcomes",()=>{
  const original=appendPracticeStint(managedPracticeState({}),{
    driverId:"D1",programmeId:"setup",minutes:10,
    outcome:{setup:{gearing:63},setup_knowledge:18.2,fatigue_cost:1},
  });
  const restored=managedPracticeState({managed_practice:JSON.parse(JSON.stringify(original))});
  assert.deepEqual(restored,original);
  assert.equal(managedPracticeSummary(restored,"D1").lastOutcome.setup.gearing,63);
});
