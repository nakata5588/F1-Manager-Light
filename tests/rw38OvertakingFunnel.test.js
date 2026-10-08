import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseOvertakingEvents } from "../src/race2/diagnostics/OvertakingFunnelAudit.js";

test("RW38-A reconstructs attempts and explains failures without modifying events",()=>{
  const events=[
    {type:"overtake_started",timeMs:1000,payload:{attemptId:"a",gapM:12,closingPotentialMs:2.5,probability:0.6,trackPhase:"straight"}},
    {type:"overtake_started",timeMs:1500,payload:{attemptId:"b",gapM:17,closingPotentialMs:0.6}},
    {type:"overtake_completed",timeMs:3000,payload:{attemptId:"a"}},
    {type:"overtake_failed",timeMs:12000,payload:{attemptId:"b",reason:"approach_timeout"}},
  ];
  const before=structuredClone(events);
  const report=diagnoseOvertakingEvents(events);
  assert.deepEqual(events,before);
  assert.equal(report.attempts,2);
  assert.equal(report.byOutcome.completed,1);
  assert.equal(report.byOutcome.failed,1);
  assert.equal(report.failureReasons.approach_timeout,1);
  assert.equal(report.completionRatePct,50);
  assert.equal(report.averageInitialGapM,14.5);
  assert.equal(report.sideBySideCount,null);
  assert.equal(report.samples[0].durationMs,2000);
});

test("RW38-A keeps orphan and incomplete outcomes visible instead of inventing results",()=>{
  const report=diagnoseOvertakingEvents([
    {type:"overtake_completed",timeMs:4000,payload:{attemptId:"unknown"}},
    {type:"overtake_started",timeMs:5000,payload:{attemptId:"pending"}},
    {type:"overtake_started",timeMs:6000,payload:{attemptId:"yellow"}},
    {type:"overtake_aborted",timeMs:6100,payload:{attemptId:"yellow",reason:"local_yellow"}},
  ]);
  assert.equal(report.orphanOutcomeCount,1);
  assert.equal(report.byOutcome.unresolved,1);
  assert.equal(report.byOutcome.aborted,1);
  assert.equal(report.failureReasons.local_yellow,1);
});
