import test from "node:test";
import assert from "node:assert/strict";

import { createRng, rngFor } from "../src/core/random.js";
import {
  GAME_VERSION,
  SAVE_SCHEMA_VERSION,
  createNewSaveMeta,
  extractGameStateFromStoredSave,
  migrateGameState,
  migrateStoredSave,
  prepareGameStateForSave,
} from "../src/core/saveSafety.js";
import { runRaceWeekend } from "../src/engine/GPEngine.js";
import { applyMarketTick } from "../src/engine/MarketEngine.js";

test("seeded RNG is deterministic and entropy-key scoped", () => {
  const a = createRng("1980-monaco-race");
  const b = createRng("1980-monaco-race");
  assert.deepEqual(
    [a.next(), a.next(), a.int(1, 100), a.pick(["a", "b", "c"])],
    [b.next(), b.next(), b.int(1, 100), b.pick(["a", "b", "c"])]
  );

  const gs = { saveMeta: { seed: "career-a" } };
  const raceA = rngFor(gs, "1980-monaco-race");
  const raceB = rngFor(gs, "1980-monaco-race");
  const injury = rngFor(gs, "driver-d_0203-injury");
  assert.equal(raceA.next(), raceB.next());
  assert.notEqual(raceA.next(), injury.next());
});

test("legacy gameState migrates structurally without changing gameplay fields", () => {
  const legacy = {
    activeYear: 1980,
    currentDateISO: "1980-05-18",
    currentRound: 5,
    team: { team_id: "t_williams", name: "Williams" },
    standings: { drivers: [{ driver_id: "d_1", points: 12 }], teams: [] },
    results: [{ key: "1980_5_monaco", classification: [{ driver_id: "d_1", position: 1 }] }],
    financeLog: [{ id: "tx_1", amount: 1000 }],
  };

  const migrated = migrateGameState(legacy);
  const { saveMeta, ...gameplay } = migrated;

  assert.deepEqual(gameplay, legacy);
  assert.equal(saveMeta.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.equal(saveMeta.gameVersion, GAME_VERSION);
  assert.match(saveMeta.seed, /^f1ml-legacy-/);
  assert.deepEqual(saveMeta.migrations, [{
    id: "save-schema-v0-to-v1",
    from: 0,
    to: 1,
    policy: "structural_metadata_only_no_gameplay_recalculation",
  }]);

  assert.equal(migrateGameState(legacy).saveMeta.seed, saveMeta.seed);
});

test("manual legacy save envelope and rolling Continue save both migrate", () => {
  const legacyState = {
    activeYear: 1980,
    currentDateISO: "1980-01-01",
    currentRound: 0,
    team: { team_id: "t_1" },
  };
  const manual = {
    meta: { name: "Old save", version: "0.1.0", savedAt: "2026-09-20T00:00:00.000Z" },
    gameState: legacyState,
  };

  const migratedEnvelope = migrateStoredSave(manual);
  assert.equal(migratedEnvelope.meta.name, "Old save");
  assert.equal(migratedEnvelope.meta.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.equal(migratedEnvelope.meta.gameVersion, GAME_VERSION);
  assert.equal(migratedEnvelope.meta.seed, migratedEnvelope.gameState.saveMeta.seed);
  assert.deepEqual(extractGameStateFromStoredSave(manual), migratedEnvelope.gameState);

  const migratedContinue = extractGameStateFromStoredSave(legacyState);
  assert.equal(migratedContinue.saveMeta.schemaVersion, SAVE_SCHEMA_VERSION);
});

test("current saves are idempotent and future schemas are rejected", () => {
  const current = prepareGameStateForSave({
    activeYear: 1980,
    currentDateISO: "1980-01-01",
    team: { team_id: "t_1" },
    saveMeta: createNewSaveMeta({ year: 1980, teamId: "t_1", seed: "fixed-seed" }),
  });

  assert.deepEqual(migrateGameState(current), current);
  assert.throws(
    () => migrateGameState({ ...current, saveMeta: { ...current.saveMeta, schemaVersion: SAVE_SCHEMA_VERSION + 1 } }),
    /newer than supported/
  );
});

function raceFixture(seed = "race-regression") {
  const teams = [
    { team_id: "t_1", team_name: "Alpha" },
    { team_id: "t_2", team_name: "Beta" },
  ];
  const drivers = [
    { driver_id: "d_1", display_name: "Driver One" },
    { driver_id: "d_2", display_name: "Driver Two" },
    { driver_id: "d_3", display_name: "Driver Three" },
    { driver_id: "d_4", display_name: "Driver Four" },
  ];
  const contracts = [
    { year: 1980, role: "Driver", driver_id: "d_1", team_id: "t_1" },
    { year: 1980, role: "Driver", driver_id: "d_2", team_id: "t_1" },
    { year: 1980, role: "Driver", driver_id: "d_3", team_id: "t_2" },
    { year: 1980, role: "Driver", driver_id: "d_4", team_id: "t_2" },
  ];
  const driverRatings = drivers.map((driver, index) => ({
    driver_id: driver.driver_id,
    pace: 78 - index * 2,
    qualifying: 80 - index * 2,
    racecraft: 79 - index,
    consistency: 76,
    pressure_handling: 74,
    adaptability: 72,
    mentality: 75,
    current_ability: 78 - index,
    start_launch: 70,
    tire_management: 72,
    race_intelligence: 74,
    crash_likelihood: 20,
  }));

  return {
    saveMeta: createNewSaveMeta({ year: 1980, teamId: "t_1", seed }),
    activeYear: 1980,
    currentDateISO: "1980-05-18",
    currentRound: 4,
    team: teams[0],
    teams,
    drivers,
    contracts,
    driverRatings,
    standings: { drivers: [], teams: [] },
    results: [],
    inbox: [],
    financeLog: [],
    driverAttributes: {},
    pointsSystem: { table: [9, 6, 4, 3] },
    carStats: [
      { year: 1980, team_id: "t_1", chassis_spec: 82, aero_spec: 80, gearbox_spec: 78, suspension_spec: 80, brakes_spec: 78, reliability: 92 },
      { year: 1980, team_id: "t_2", chassis_spec: 76, aero_spec: 74, gearbox_spec: 75, suspension_spec: 74, brakes_spec: 76, reliability: 90 },
    ],
    teamEngines: [
      { year: 1980, team_id: "t_1", power: 82, reliability: 94 },
      { year: 1980, team_id: "t_2", power: 78, reliability: 92 },
    ],
    accidentModel: [{ year: 1980, damage_DNF_prob: 0.08 }],
    sponsorsContracts: [],
  };
}

test("GP gameplay output is reproducible for the same save seed and entropy key", async () => {
  const gp = { gp_id: "monaco", gp_name: "Monaco Grand Prix", year: 1980 };
  const first = await runRaceWeekend(raceFixture(), { roundIndex: 4, gp });
  const second = await runRaceWeekend(raceFixture(), { roundIndex: 4, gp });

  assert.deepEqual(first.results, second.results);
  assert.deepEqual(first.standings, second.standings);
  assert.deepEqual(first.driverAttributes, second.driverAttributes);
  assert.deepEqual(
    first.lastRace.race.map((row) => ({
      driver: row.driver?.driver_id,
      pos: row.pos,
      retired: row.retired,
      reason: row.retirement_reason,
      time: row.total_time_ms,
      bestLap: row.best_lap_ms,
    })),
    second.lastRace.race.map((row) => ({
      driver: row.driver?.driver_id,
      pos: row.pos,
      retired: row.retired,
      reason: row.retirement_reason,
      time: row.total_time_ms,
      bestLap: row.best_lap_ms,
    }))
  );
});


test("market news is deterministic for the same save seed and game date", () => {
  const base = {
    saveMeta: createNewSaveMeta({ year: 1980, teamId: "t_1", seed: "market-determinism" }),
    activeYear: 1980,
    currentDateISO: "1980-05-20",
    _lastAIDriverMarketMonth: "1980-05",
    team: { team_id: "t_1", team_name: "Alpha" },
    teams: [
      { team_id: "t_1", team_name: "Alpha" },
      { team_id: "t_2", team_name: "Beta" },
    ],
    drivers: [
      { driver_id: "d_1", display_name: "Driver One" },
      { driver_id: "d_2", display_name: "Driver Two" },
    ],
    standings: { drivers: [{ driver_id: "d_1", position: 3, points: 12 }], teams: [] },
    inbox: [],
  };

  let fixture = base;
  let first = null;
  for (let i = 0; i < 5000; i += 1) {
    fixture = {
      ...base,
      saveMeta: createNewSaveMeta({ year: 1980, teamId: "t_1", seed: `market-determinism-${i}` }),
    };
    const candidate = applyMarketTick(fixture);
    if ((candidate.inbox || []).length) {
      first = candidate;
      break;
    }
  }

  assert.ok(first, "Expected at least one deterministic seed to produce a market news item.");
  const second = applyMarketTick(fixture);
  assert.deepEqual(first, second);
});
