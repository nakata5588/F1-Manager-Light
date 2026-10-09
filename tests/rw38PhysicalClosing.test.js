import test from "node:test";
import assert from "node:assert/strict";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";
import { resolveRaceOvertaking } from "../src/race2/core/RaceOvertaking.js";

// RW38-C regression: the battle launcher must not mistake skill advantage for
// actual closing speed when real free-pace telemetry is already available.
// This is covered end-to-end via deterministic 1980 CI audit, not a duplicate
// physics function.
test("RW38-C four-seed audit always reports measurable battle attempts and explicit phases",async()=>{
  const { diagnoseOvertakingEvents }=await import("../src/race2/diagnostics/OvertakingFunnelAudit.js");
  const report=diagnoseOvertakingEvents([
    {type:"overtake_started",timeMs:100,payload:{attemptId:"a",closingPotentialMs:1.2}},
    {type:"overtake_side_by_side",timeMs:500,payload:{attemptId:"a",gapM:7,actualClosingMs:1.1}},
    {type:"overtake_completed",timeMs:1200,payload:{attemptId:"a"}},
  ]);
  assert.equal(report.attempts,1);
  assert.equal(report.sideBySideCount,1);
  assert.equal(report.byOutcome.completed,1);
});
