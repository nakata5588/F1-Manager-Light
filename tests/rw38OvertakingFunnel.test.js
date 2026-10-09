import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseOvertakingEvents } from "../src/race2/diagnostics/OvertakingFunnelAudit.js";

test("RW38-A reconstructs attempts and explains failures without modifying events",()=>{
  const events=[
    {type:"overtake_started",timeMs:1000,payload:{attemptId:"a",gapM:12,closingPotentialMs:2.5,probability:0.6,trackPhase:"straight"}},
    {type:"overtake_started",timeMs:1500,payload:{attemptId:"b",gapM:17,closingPotentialMs:0.6}},
    {type:"overtake_side_by_side",timeMs:2400,payload:{attemptId:"a",gapM:6.9,actualClosingMs:2.1}},
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
  assert.equal(report.sideBySideCount,1);
  assert.equal(report.failedBeforeSideBySide,1);
  assert.equal(report.samples[0].lastClosingMs,2.1);
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

test("RW38-A CI emits compact four-seed 1980 funnel report", {timeout:300_000}, async t=>{
  const {execFileSync}=await import("node:child_process");
  const {fileURLToPath}=await import("node:url");
  const path=(await import("node:path")).default;
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const output=execFileSync(process.execPath,[
    path.join(root,"scripts","audit-race-behaviour.mjs"),
    "--seeds=4","--scenario=1980-dry","--json-only"
  ],{cwd:root,encoding:"utf8",timeout:290_000,maxBuffer:12*1024*1024});
  const line=output.split(/\r?\n/).find(row=>row.startsWith("RW11A_JSON="));
  assert.ok(line,"canonical audit must produce JSON");
  const report=JSON.parse(line.slice("RW11A_JSON=".length));
  const scenario=report.scenarios["1980-dry"];
  assert.equal(scenario.runs.length,4);
  const summary={
    scenario:"1980-dry",
    seeds:4,
    funnel:scenario.overtakingFunnel,
    perSeed:scenario.runs.map(run=>({
      seed:run.seed,
      attempted:run.overtakingFunnel.attempts,
      reachedSideBySide:run.overtakingFunnel.sideBySideCount,
      failedBeforeSideBySide:run.overtakingFunnel.failedBeforeSideBySide,
      averageFailedFinalGapM:run.overtakingFunnel.averageFailedFinalGapM,
      averageFailedLastClosingMs:run.overtakingFunnel.averageFailedLastClosingMs,
      outcomes:run.overtakingFunnel.byOutcome,
      reasons:run.overtakingFunnel.failureReasons,
      completionRatePct:run.overtakingFunnel.completionRatePct,
      averageInitialGapM:run.overtakingFunnel.averageInitialGapM,
      averageClosingPotentialMs:run.overtakingFunnel.averageClosingPotentialMs
    }))
  };
  t.diagnostic("RW38_CI_FUNNEL="+JSON.stringify(summary));
});
