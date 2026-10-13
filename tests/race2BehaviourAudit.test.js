import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateRaceBehaviour,
  summarizeRaceBehaviour,
  summarizeGreenFlagPassingWindows,
} from "../src/race2/diagnostics/RaceBehaviourAudit.js";

function fixture(){
  return {
    seed:"audit-seed",
    status:"finished",
    tick:123,
    simulationTimeMs:12_300,
    officialRaceTimeMs:12_000,
    events:[
      {type:"overtake_started"},
      {type:"overtake_completed"},
      {type:"contact"},
      {type:"damage",payload:{damage:{overall_damage_pct:20}}},
      {type:"pit_entry",payload:{reason:"degradation"}},
      {type:"pit_service_completed",payload:{repairedComponents:["front_wing"],doubleStack:true,crewError:false}},
      {type:"pit_exit"},
      {type:"race_control_changed",payload:{from:"GREEN",to:"LOCAL_YELLOW"}},
      {type:"retirement"},
    ],
    cars:[
      {
        status:"finished",
        dnf:false,
        tyre:{condition:72,wear_per_lap_pct:1.5,age_laps:12},
        resources:{paceMode:"balanced"},
        damage:{damaged_components:["floor"],overall_damage_pct:10},
      },
      {
        status:"dnf",
        dnf:true,
        tyre:{condition:64,wear_per_lap_pct:2.1,age_laps:8},
        resources:{paceMode:"attack"},
        damage:{damaged_components:[],overall_damage_pct:0},
      },
    ],
  };
}

test("RW11A race behaviour audit summarizes canonical facts without mutation",()=>{
  const source=fixture();
  const snapshot=structuredClone(source);
  const summary=summarizeRaceBehaviour(source,{scenario:"test"});

  assert.deepEqual(source,snapshot);
  assert.equal(summary.scenario,"test");
  assert.equal(summary.overtakes.attempts,1);
  assert.equal(summary.overtakes.completed,1);
  assert.equal(summary.overtakes.contacts,1);
  assert.equal(summary.pits.services,1);
  assert.equal(summary.pits.repairs,1);
  assert.equal(summary.pits.doubleStacks,1);
  assert.equal(summary.pits.reasons.degradation,1);
  assert.equal(summary.incidents.damageEvents,1);
  assert.equal(summary.finalState.dnfs,1);
  assert.equal(summary.finalState.carsCarryingDamage,1);
  assert.equal(summary.tyres.averageCondition,68);
  assert.equal(summary.tyres.minimumCondition,64);
  assert.equal(summary.tyres.averageWearPerLapPct,1.8);
  assert.equal(summary.pace.balanced,1);
  assert.equal(summary.pace.attack,1);
  assert.equal(summary.raceControl.transitions["GREEN->LOCAL_YELLOW"],1);
});

test("RW59 green-flag passing metric excludes sustained Safety Car periods",()=>{
  const race={
    simulationTimeMs:120_000,
    events:[
      {type:"overtake_started",timeMs:20_000},
      {type:"race_control_changed",timeMs:30_000,payload:{from:"GREEN",to:"SAFETY_CAR"}},
      {type:"race_control_changed",timeMs:90_000,payload:{from:"SAFETY_CAR",to:"GREEN"}},
      {type:"overtake_started",timeMs:100_000},
    ],
  };
  const before=structuredClone(race);
  const audit=summarizeGreenFlagPassingWindows(race);
  assert.deepEqual(race,before,"diagnostic must never mutate official race events");
  assert.equal(audit.attempts,2);
  assert.equal(audit.longestUnrestrictedWindow.durationMs,80_000);
  assert.equal(audit.longestGreenFlagWindow.durationMs,20_000);
  assert.equal(audit.greenFlagDurationMs,60_000);
  assert.equal(audit.neutralisedDurationMs,60_000);
  assert.equal(audit.finalMode,"GREEN");
});

test("RW59 terminal safety-car period is not a green-flag drought",()=>{
  const audit=summarizeGreenFlagPassingWindows({
    simulationTimeMs:120_000,
    events:[
      {type:"overtake_started",timeMs:20_000},
      {type:"race_control_changed",timeMs:30_000,payload:{to:"SAFETY_CAR"}},
    ],
  });
  assert.equal(audit.longestUnrestrictedWindow.durationMs,100_000);
  assert.equal(audit.longestGreenFlagWindow.durationMs,20_000);
  assert.equal(audit.finalMode,"SAFETY_CAR");
  assert.equal(audit.neutralisedDurationMs,90_000);
});

test("RW11A aggregate exposes averages across deterministic audit runs",()=>{
  const a=summarizeRaceBehaviour(fixture());
  const second=fixture();
  second.events.push({type:"overtake_started"},{type:"overtake_completed"},{type:"pit_entry",payload:{reason:"weather"}},{type:"pit_service_completed",payload:{}},{type:"pit_exit"});
  second.cars[0].tyre.condition=60;
  const b=summarizeRaceBehaviour(second);

  const aggregate=aggregateRaceBehaviour([a,b]);
  assert.equal(aggregate.runs,2);
  assert.equal(aggregate.overtakes.attempts,1.5);
  assert.equal(aggregate.overtakes.completed,1.5);
  assert.equal(aggregate.pits.services,1.5);
  assert.equal(aggregate.finalState.dnfs,1);
  assert.equal(aggregate.tyres.averageCondition,65);
});


test("RW11A behaviour audit smoke runs the 1980 calibration scenario on the canonical core",{timeout:120_000},(t)=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const output=execFileSync(
    process.execPath,
    [path.join(root,"scripts","audit-race-behaviour.mjs"),"--seeds=1","--scenario=1980-dry","--json-only"],
    {cwd:root,encoding:"utf8",maxBuffer:4*1024*1024}
  );
  const marker="RW11A_JSON=";
  const line=output.split(/\\r?\\n/).find((row)=>row.startsWith(marker));
  assert.ok(line,"audit output must include its machine-readable report");
  const report=JSON.parse(line.slice(marker.length));
  assert.deepEqual(Object.keys(report.scenarios),["1980-dry"]);
  for(const [name,row] of Object.entries(report.scenarios)){
    assert.equal(row.aggregate.runs,1);
    assert.equal(row.runs[0].status,"finished");
    assert.equal(row.runs[0].fieldSize,16);
    t.diagnostic(`RW11A ${name} baseline ${JSON.stringify(row.aggregate)}`);
  }
});
