import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_RACE_SAVE_KEYS,
  ARCHIVED_RESULT_SAVE_KEYS,
  REFERENCE_DATA_KEYS,
  SAVE_SECTION_LAYOUT_VERSION,
  legacyCompatibleSaveState,
  partitionGameStateForSave,
  reassembleSaveSections,
} from "../src/core/saveSections.js";
import { SAVE_SCHEMA_VERSION, prepareGameStateForSave, extractGameStateFromStoredSave } from "../src/core/saveSafety.js";

function stateFixture() {
  return {
    activeYear: 1980,
    dbDrivers: [{ driver_id: "d_1", name: "Reference Only" }],
    saveMeta: { schemaVersion: SAVE_SCHEMA_VERSION, seed: "renault-1980", gameVersion: "1.0.1", migrations: [] },
    finances: { balance: 1_200_000 },
    raceEntryState: { entries: [{ driver_id: "d_1", team_id: "renault" }] },
    raceWeekendState: {
      phase: "race",
      engine_version: "rw2",
      canonical_race_runtime: {
        state: {
          status: "running", tick: 1820,
          cars: [{ driver_id: "d_1", distanceAlongLap: 2563.425, damage: { engine: 0.3 } }],
          tyreWear: { d_1: 0.43217 },
          rngState: { seed: 12345, cursor: 881 },
        },
      },
      live_race: { status: "running", projected_race: [{ gap: 0.1329 }] },
    },
    results: [{ key: "1980_1_argentina", classification: [{ driver_id: "d_1", position: 1, gap: null }] }],
    resultsHistory: [{ season: 1979, races: [{ event: "previous", laps: 75 }] }],
    historySeasons: [{ year: 1979, standings: [{ driver_id: "d_2", points: 42 }] }],
    dbCarStats: [{ team_id: "renault", race: 90 }],
    lowerSeriesWorld: { seed: "lower-1980", currentRound: 1 },
    futureCareerFeature: { mustPersist: true },
  };
}

test("reference data is only classified; old v2 on-disk snapshot is identical", () => {
  const state = stateFixture();
  const oldSnapshot = { ...state };
  for (const key of REFERENCE_DATA_KEYS) delete oldSnapshot[key];
  const newSnapshot = legacyCompatibleSaveState(state);
  assert.deepEqual(newSnapshot, oldSnapshot);
  assert.equal(JSON.stringify(newSnapshot), JSON.stringify(oldSnapshot),
    "preserve JSON field order and manual-save dedupe signatures");
  assert.equal(state.dbDrivers.length, 1, "source gameState must not be mutated");
  assert.equal(state.dbCarStats.length, 1);
});

test("section ownership separates reference, active race, archive and career without losses", () => {
  const original = stateFixture();
  const sections = partitionGameStateForSave(original);
  assert.equal(sections.layoutVersion, SAVE_SECTION_LAYOUT_VERSION);
  assert.deepEqual(Object.keys(sections.referenceData), ["dbDrivers", "dbCarStats"]);
  assert.deepEqual(Object.keys(sections.activeRace), [...ACTIVE_RACE_SAVE_KEYS]);
  assert.deepEqual(Object.keys(sections.archivedResults), [...ARCHIVED_RESULT_SAVE_KEYS]);
  assert.equal(sections.careerState.lowerSeriesWorld, original.lowerSeriesWorld);
  assert.equal(sections.careerState.futureCareerFeature, original.futureCareerFeature);
  assert.deepEqual(reassembleSaveSections(sections, { includeReferenceData: true }), original);
  assert.equal(
    JSON.stringify(reassembleSaveSections(sections, { includeReferenceData: true })),
    JSON.stringify(original),
    "the full in-memory state can be reconstructed without reordering fields"
  );
});

test("active race checkpoint keeps every canonical field, future projection and exact seed", () => {
  const state = stateFixture();
  const saved = legacyCompatibleSaveState(state);
  assert.strictEqual(saved.raceWeekendState, state.raceWeekendState);
  assert.deepEqual(saved.raceWeekendState.canonical_race_runtime.state,
    state.raceWeekendState.canonical_race_runtime.state);
  assert.deepEqual(saved.raceWeekendState.live_race.projected_race,
    [{ gap: 0.1329 }], "an unfinished race must not be compacted");
  const migrated = extractGameStateFromStoredSave({
    meta: { name: "Renault 1980" },
    gameState: prepareGameStateForSave(saved),
  });
  assert.equal(migrated.saveMeta.seed, "renault-1980");
  assert.deepEqual(migrated.raceWeekendState.canonical_race_runtime.state,
    state.raceWeekendState.canonical_race_runtime.state);
});

test("archived official results, history and unfamiliar fields are preserved exactly", () => {
  const state = stateFixture();
  const snapshot = legacyCompatibleSaveState(state);
  assert.strictEqual(snapshot.results, state.results);
  assert.strictEqual(snapshot.resultsHistory, state.resultsHistory);
  assert.strictEqual(snapshot.historySeasons, state.historySeasons);
  assert.deepEqual(snapshot.results[0].classification[0], {
    driver_id: "d_1", position: 1, gap: null,
  });
  assert.deepEqual(snapshot.futureCareerFeature, { mustPersist: true });
  assert.deepEqual(snapshot.lowerSeriesWorld, state.lowerSeriesWorld);
});

test("unknown partition layouts and duplicate fields cannot silently corrupt saves", () => {
  const sections = partitionGameStateForSave(stateFixture());
  assert.throws(() => reassembleSaveSections({ ...sections, layoutVersion: 999 }),
    /Unsupported save section layout/);
  assert.throws(() => reassembleSaveSections({
    ...sections, archivedResults: { ...sections.archivedResults, finances: {} },
  }), /Duplicate save field finances/);
  assert.throws(() => partitionGameStateForSave(null), /gameState must be an object/);
});
