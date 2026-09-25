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
  assert.deepEqual(saveMeta.migrations, [
    {
      id: "save-schema-v0-to-v1",
      from: 0,
      to: 1,
      policy: "structural_metadata_only_no_gameplay_recalculation",
    },
    {
      id: "save-schema-v1-to-v2-physical-part-units",
      from: 1,
      to: 2,
      policy: "migrate_part_design_inventory_to_independent_physical_units",
    },
  ]);

  assert.equal(migrateGameState(legacy).saveMeta.seed, saveMeta.seed);
});

test("imported saves normalize object-shaped standings before entering the UI", () => {
  const imported = {
    meta: { version: GAME_VERSION },
    gameState: {
      activeYear: 1980,
      currentDateISO: "1980-05-18",
      team: { team_id: "t_williams", team_name: "Williams" },
      saveMeta: createNewSaveMeta({ year: 1980, teamId: "t_williams", seed: "object-standings" }),
      standings: {
        teams: {
          t_williams: { position: 1, points: 34 },
          t_brabham: { position: 2, points: 27 },
        },
        drivers: {
          d_0178: { position: 1, points: 30 },
          d_0199: { position: 2, points: 24 },
        },
      },
    },
  };

  const restored = extractGameStateFromStoredSave(imported);

  assert.ok(Array.isArray(restored.standings.teams));
  assert.ok(Array.isArray(restored.standings.drivers));
  assert.deepEqual(restored.standings.teams[0], {
    team_id: "t_williams",
    position: 1,
    points: 34,
  });
  assert.deepEqual(restored.standings.drivers[0], {
    driver_id: "d_0178",
    position: 1,
    points: 30,
  });
});

test("imported saves unwrap legacy standings row containers", () => {
  const restored = migrateGameState({
    activeYear: 1980,
    currentDateISO: "1980-05-18",
    team: { team_id: "t_williams" },
    standings: {
      teams: { rows: [{ team_id: "t_williams", position: 3, points: 12 }] },
      drivers: { items: [{ driver_id: "d_0178", position: 4, points: 8 }] },
    },
  });

  assert.deepEqual(restored.standings.teams, [
    { team_id: "t_williams", position: 3, points: 12 },
  ]);
  assert.deepEqual(restored.standings.drivers, [
    { driver_id: "d_0178", position: 4, points: 8 },
  ]);
});

test("legacy Race Weekend collections normalize before entering the UI", () => {
  const imported = {
    meta: { version: GAME_VERSION },
    gameState: {
      activeYear: 1980,
      currentDateISO: "1980-05-18",
      team: { team_id: "t_williams" },
      saveMeta: createNewSaveMeta({ year: 1980, teamId: "t_williams", seed: "legacy-rw-shapes" }),
      raceWeekendState: {
        phase: "race",
        entrants: {
          d_1: { driver_id: "d_1", team_id: "t_williams", status: "confirmed" },
          d_2: { driver_id: "d_2", team_id: "t_brabham", status: "confirmed" },
        },
        sessions: {
          grid: { type: "grid", status: "completed" },
          race: { type: "race", status: "pending" },
        },
        qualifying: {
          classification: {
            d_1: { driver_id: "d_1", position: 1 },
            d_2: { driver_id: "d_2", position: 2 },
          },
        },
        startingGrid: {
          generated_at: "1980-05-17",
          rows: {
            d_1: { driver_id: "d_1", team_id: "t_williams", grid: 1 },
            d_2: { driver_id: "d_2", team_id: "t_brabham", grid: 2 },
          },
        },
        grid: {
          d_1: { driver_id: "d_1", team_id: "t_williams", grid: 1 },
          d_2: { driver_id: "d_2", team_id: "t_brabham", grid: 2 },
        },
        live_race: {
          classification: {
            d_1: { driver_id: "d_1", position: 1 },
            d_2: { driver_id: "d_2", position: 2 },
          },
          events: {
            incident_1: { lap: 4, type: "incident", message: "Legacy incident" },
          },
        },
      },
    },
  };

  const restored = extractGameStateFromStoredSave(imported);
  const weekend = restored.raceWeekendState;

  assert.ok(Array.isArray(weekend.entrants));
  assert.ok(Array.isArray(weekend.sessions));
  assert.ok(Array.isArray(weekend.qualifying.classification));
  assert.ok(Array.isArray(weekend.startingGrid.rows));
  assert.ok(Array.isArray(weekend.grid));
  assert.ok(Array.isArray(weekend.live_race.classification));
  assert.ok(Array.isArray(weekend.live_race.events));
  assert.equal(weekend.startingGrid.generated_at, "1980-05-17");
  assert.equal(weekend.startingGrid.rows[0].driver_id, "d_1");
  assert.equal(weekend.sessions.find((row)=>row.id==="grid")?.type, "grid");
});

test("legacy array-shaped startingGrid is upgraded to the current rows container", () => {
  const restored = migrateGameState({
    activeYear: 1980,
    currentDateISO: "1980-05-18",
    team: { team_id: "t_williams" },
    raceWeekendState: {
      phase: "grid_ready",
      startingGrid: [
        { driver_id: "d_1", team_id: "t_williams", grid: 1 },
        { driver_id: "d_2", team_id: "t_brabham", grid: 2 },
      ],
      grid: null,
    },
  });

  assert.deepEqual(restored.raceWeekendState.startingGrid.rows, [
    { driver_id: "d_1", team_id: "t_williams", grid: 1 },
    { driver_id: "d_2", team_id: "t_brabham", grid: 2 },
  ]);
  assert.deepEqual(restored.raceWeekendState.grid, restored.raceWeekendState.startingGrid.rows);
});

test("current Race Weekend collection shapes remain unchanged by save normalization", () => {
  const raceWeekendState = {
    phase: "race",
    entrants: [{ driver_id: "d_1", team_id: "t_1", status: "confirmed" }],
    sessions: [{ id: "race", type: "race", status: "pending" }],
    qualifying: { classification: [{ driver_id: "d_1", position: 1 }] },
    startingGrid: {
      generated_at: "1980-05-17",
      rows: [{ driver_id: "d_1", team_id: "t_1", grid: 1 }],
    },
    grid: [{ driver_id: "d_1", team_id: "t_1", grid: 1 }],
    live_race: {
      classification: [{ driver_id: "d_1", position: 1 }],
      events: [{ lap: 1, type: "start_ready", message: "Ready" }],
    },
  };
  const restored = migrateGameState({
    activeYear: 1980,
    currentDateISO: "1980-05-18",
    team: { team_id: "t_1" },
    saveMeta: createNewSaveMeta({ year: 1980, teamId: "t_1", seed: "current-rw-shape" }),
    raceWeekendState,
  });

  assert.deepEqual(restored.raceWeekendState, raceWeekendState);
});

test("v1 saves migrate shared design inventory into deterministic physical units", () => {
  const legacyV1 = {
    activeYear:1980,
    currentDateISO:"1980-05-18",
    team:{team_id:"T1"},
    saveMeta:{
      schemaVersion:1,
      gameVersion:"1.0.1",
      seed:"physical-migration",
      migrations:[{id:"save-schema-v0-to-v1",from:0,to:1,policy:"structural_metadata_only_no_gameplay_recalculation"}],
    },
    development:{
      parts:[{id:"P1",slot:"aero_front",perf:3,condition:72,inv:1}],
    },
    garage:{
      cars:[
        {id:"car_1",installedParts:{aero_front:"P1"}},
        {id:"car_2",installedParts:{}},
      ],
    },
  };

  const migrated=migrateGameState(legacyV1);
  assert.equal(migrated.saveMeta.schemaVersion,2);
  assert.equal(migrated.development.partUnits.length,2);
  const installedId=migrated.garage.cars[0].installedParts.aero_front;
  assert.notEqual(installedId,"P1");
  const installed=migrated.development.partUnits.find((unit)=>unit.id===installedId);
  assert.equal(installed.design_id,"P1");
  assert.equal(installed.condition,72);
  const warehouse=migrated.development.partUnits.find((unit)=>unit.id!==installedId);
  assert.equal(warehouse.design_id,"P1");
  assert.equal(warehouse.condition,72);
  assert.equal(migrated.development.parts[0].inv,1);
  assert.deepEqual(migrateGameState(migrated),migrated);
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
  assert.equal(migratedEnvelope.gameState.saveMeta.gameVersion, "0.1.0");
  assert.deepEqual(extractGameStateFromStoredSave(manual), migratedEnvelope.gameState);

  const migratedContinue = extractGameStateFromStoredSave(legacyState);
  assert.equal(migratedContinue.saveMeta.schemaVersion, SAVE_SCHEMA_VERSION);
});

test("save snapshots retain in-progress live Race Weekend state", () => {
  const state=prepareGameStateForSave({
    activeYear:1980,
    currentDateISO:"1980-05-18",
    currentRound:4,
    team:{team_id:"t_1"},
    saveMeta:createNewSaveMeta({year:1980,teamId:"t_1",seed:"rw-recovery"}),
    raceEntryState:{entries:[{driver_id:"d_1",team_id:"t_1",status:"confirmed"}]},
    raceWeekendState:{
      gp_id:"monaco",
      phase:"race",
      roundIndex:4,
      live_race:{
        status:"running",
        current_lap:17,
        current_sector:2,
        classification:[{driver_id:"d_1",position:3,elapsed_ms:123456}],
        events:[{lap:17,type:"command",message:"Push"}],
      },
      race_strategy:{live_commands:{d_1:[{type:"pace",pace_mode:"attack",effective_lap:18}]}},
    },
  });
  const loaded=extractGameStateFromStoredSave(state);
  assert.equal(loaded.raceWeekendState.phase,"race");
  assert.equal(loaded.raceWeekendState.live_race.current_lap,17);
  assert.equal(loaded.raceWeekendState.live_race.current_sector,2);
  assert.equal(loaded.raceWeekendState.race_strategy.live_commands.d_1[0].pace_mode,"attack");
  assert.equal(loaded.raceEntryState.entries[0].driver_id,"d_1");
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



test("uploaded visual assets survive save preparation and reload", () => {
  const dataUrl="data:image/webp;base64,UPLOAD";
  const state={
    activeYear:1980,
    currentDateISO:"1980-05-18",
    currentRound:5,
    team:{team_id:"t_0001",team_name:"Williams"},
    standings:{drivers:[],teams:[]},
    saveMeta:createNewSaveMeta({year:1980,teamId:"t_0001",seed:"visual-upload"}),
    visualAssetOverrides:{
      drivers:{
        d_0117:{
          default:"",
          history:[{year:1980,path:dataUrl}],
        },
      },
      staff:{},
      teams:{},
    },
  };

  const prepared=prepareGameStateForSave(state);
  const restored=extractGameStateFromStoredSave({
    meta:{version:GAME_VERSION},
    gameState:prepared,
  });

  assert.equal(
    restored.visualAssetOverrides.drivers.d_0117.history[0].path,
    dataUrl
  );
});

test("GP gameplay output is reproducible for the same save seed and entropy key", async () => {
  const gp = { gp_id: "monaco", gp_name: "Monaco Grand Prix", year: 1980 };
  const first = await runRaceWeekend(raceFixture(), { roundIndex: 4, gp });
  const second = await runRaceWeekend(raceFixture(), { roundIndex: 4, gp });

  assert.deepEqual(first.results, second.results);
  assert.deepEqual(first.standings, second.standings);
  assert.deepEqual(first.driverAttributes, second.driverAttributes);
  for(const driver of first.drivers){
    const condition=first.driverAttributes?.[driver.driver_id];
    assert.ok(condition,"race weekend should create a condition record for every entrant");
    assert.ok(Number(condition.fatigue)>=8,"race weekend must add meaningful fatigue");
    assert.equal(Number(condition.preparation),40,"race weekend should consume preparation");
  }
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
