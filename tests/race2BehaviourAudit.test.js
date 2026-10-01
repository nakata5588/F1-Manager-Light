import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateRaceBehaviour,
  summarizeRaceBehaviour,
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


test("RW11A behaviour audit smoke runs every calibration scenario on the canonical core",{timeout:120_000},(t)=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const output=execFileSync(
    process.execPath,
    [path.join(root,"scripts","audit-race-behaviour.mjs"),"--seeds=1"],
    {cwd:root,encoding:"utf8",maxBuffer:4*1024*1024}
  );
  const marker='{\\n  "generatedAt"';
  const start=output.indexOf(marker);
  assert.ok(start>=0,"audit output must include its JSON report");
  const report=JSON.parse(output.slice(start));
  assert.deepEqual(
    Object.keys(report.scenarios),
    ["1980-dry","1980-wet","2004-dry","2026-dry"]
  );
  for(const [name,row] of Object.entries(report.scenarios)){
    assert.equal(row.aggregate.runs,1);
    assert.equal(row.runs[0].status,"finished");
    assert.equal(row.runs[0].fieldSize,16);
    t.diagnostic(`RW11A ${name} baseline ${JSON.stringify(row.aggregate)}`);
  }
});
