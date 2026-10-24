import test from "node:test";
import assert from "node:assert/strict";
import {managedPracticeState,appendPracticeStint,markPracticeDamage,repairPracticeCar,canRunPracticeStint} from "../src/engine/ManagedPracticeSession.js";

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
