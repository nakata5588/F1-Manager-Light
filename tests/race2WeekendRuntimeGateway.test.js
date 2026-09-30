import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_RACE_ENGINE_VERSION,
  advanceRaceWeekendElapsed,
  raceWeekendCanonicalView,
  raceWeekendUsesCanonicalRuntime,
} from "../src/race2/gateway/RaceWeekendRuntimeGateway.js";

const state=(engine_version="legacy",phase="race")=>({
  raceWeekendState:{engine_version,phase},
});

test("RW8.14E canonical runtime routing is explicit and race-phase locked",()=>{
  assert.equal(CANONICAL_RACE_ENGINE_VERSION,"rw2");
  assert.equal(raceWeekendUsesCanonicalRuntime(state("rw2","race")),true);
  assert.equal(raceWeekendUsesCanonicalRuntime(state("legacy","race")),false);
  assert.equal(raceWeekendUsesCanonicalRuntime(state("rw2","grid_ready")),false);
  assert.equal(raceWeekendUsesCanonicalRuntime({}),false);
});

test("RW8.14E leaves Legacy and pre-race states byte-for-byte untouched",()=>{
  const legacy=state("legacy","race");
  const preRace=state("rw2","grid_ready");
  assert.equal(advanceRaceWeekendElapsed(legacy,{elapsedMs:1000}),legacy);
  assert.equal(advanceRaceWeekendElapsed(preRace,{elapsedMs:1000}),preRace);
  assert.equal(raceWeekendCanonicalView(legacy),null);
  assert.equal(raceWeekendCanonicalView(preRace),null);
});
