import test from "node:test";
import assert from "node:assert/strict";
import { freshCareerRuntimeState } from "../src/state/newGameRuntime.js";

test("fresh career runtime clears driver form, development and team morale state", () => {
  const conditions = { D1: { confidence: 50, morale: 50, preparation: 50, fatigue: 0 } };
  const dirty = {
    results: [{ key: "old-race" }],
    lastRace: { gpName: "Old GP" },
    driverPerformanceLog: { D1: [{ score: 91 }] },
    driverForm: { D1: { score: 88 } },
    driverDevelopmentFocus: { D1: "pace" },
    driverDevelopmentFocusMeta: { D1: { monthKey: "1980-06" } },
    driverDevelopmentTraining: { D1: { days: 12 } },
    driverLifecycle: { D1: { stage: "prime" } },
    driverLifecycleLog: { D1: [{ stage: "prime" }] },
    driverPotentialLog: { D1: [{ after: 90 }] },
    driverAbilityLog: { D1: [{ after: 85 }] },
    teamOperationalState: { T1: { morale: 22 } },
    teamMoraleLog: { T1: [{ delta: -5 }] },
  };

  const next = { ...dirty, ...freshCareerRuntimeState({ initialDriverConditions: conditions }) };

  assert.deepEqual(next.results, []);
  assert.equal(next.lastRace, null);
  assert.deepEqual(next.driverPerformanceLog, {});
  assert.deepEqual(next.driverForm, {});
  assert.deepEqual(next.driverDevelopmentFocus, {});
  assert.deepEqual(next.driverDevelopmentFocusMeta, {});
  assert.deepEqual(next.driverDevelopmentTraining, {});
  assert.deepEqual(next.driverLifecycle, {});
  assert.deepEqual(next.driverLifecycleLog, {});
  assert.deepEqual(next.driverPotentialLog, {});
  assert.deepEqual(next.driverAbilityLog, {});
  assert.deepEqual(next.teamOperationalState, {});
  assert.deepEqual(next.teamMoraleLog, {});
  assert.deepEqual(next.driverAttributes, conditions);
  assert.equal(next._lastDriverProgressionMonth, null);
});
