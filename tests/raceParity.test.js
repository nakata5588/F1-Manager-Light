import test from "node:test";
import assert from "node:assert/strict";

import {
  KNOWN_RACE_PARITY_GAPS,
  PARITY_DOMAINS,
  failedParityDomains,
  normalizeRaceParityResult,
  raceParityMatrix,
  runDirectParityRace,
  runLiveParityRace,
} from "./helpers/raceParity.js";

const SEED = "rw7.1-parity-regression";

function assertFullParity(matrix, label) {
  const failed = failedParityDomains(matrix);
  assert.deepEqual(failed, [], `${label} diverged in: ${failed.join(", ")}`);
}

test("RW7.1 Live Race result is independent of sector chunk size", async () => {
  const sectorBySector = normalizeRaceParityResult(await runLiveParityRace(SEED, { chunks: [1] }));
  const chunked = normalizeRaceParityResult(await runLiveParityRace(SEED, { chunks: [3, 6, 1, 9] }));
  assertFullParity(raceParityMatrix(sectorBySector, chunked), "chunked Live Race");
});

test("RW7.1 Live Race result survives real Save World reload midway", async () => {
  const uninterrupted = normalizeRaceParityResult(await runLiveParityRace(SEED, { chunks: [1] }));
  const reloaded = normalizeRaceParityResult(await runLiveParityRace(SEED, { chunks: [1], reloadAtOrdinal: 17 }));
  assertFullParity(raceParityMatrix(uninterrupted, reloaded), "save/reload Live Race");
});

test("RW7.1 records direct Autosim versus Live Race parity by semantic domain", async (t) => {
  const direct = normalizeRaceParityResult(await runDirectParityRace(SEED));
  const live = normalizeRaceParityResult(await runLiveParityRace(SEED, { chunks: [1] }));
  const matrix = raceParityMatrix(direct, live);
  const failed = failedParityDomains(matrix);
  const unexpected = failed.filter((domain) => !Object.hasOwn(KNOWN_RACE_PARITY_GAPS, domain));

  t.diagnostic(`RW7.1 parity matrix ${JSON.stringify(matrix)}`);
  t.diagnostic(`RW7.1 divergent domains ${JSON.stringify(failed)}`);
  for (const domain of failed) {
    t.diagnostic(`RW7.1 ${domain} direct ${JSON.stringify(direct[domain])}`);
    t.diagnostic(`RW7.1 ${domain} live ${JSON.stringify(live[domain])}`);
  }

  assert.deepEqual(Object.keys(matrix), PARITY_DOMAINS);
  assert.deepEqual(unexpected, [], `unexpected parity divergence outside the RW7 audit: ${unexpected.join(", ")}`);
});

test.todo("RW7.2 unify deterministic Race Control ownership so direct and Live consume the same causal incident history");
test.todo("RW7.4 unify the race clock/timing source so lap times, fastest lap and final timing converge");
test.todo("RW7.6 unify incident, damage and retirement materialization for both race paths");
test.todo("RW7.7 unify pit, tyre and repair materialization for both race paths");
test.todo("RW7.9 make direct Autosim traverse the same Red Flag lifecycle as Live Race");
