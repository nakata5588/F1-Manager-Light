// src/core/saveSafety.js
import { hashSeed } from "./random.js";
import { normalizePhysicalPartState } from "../domain/partUnits.js";
import { synchronizeDriverRelationships } from "../domain/driverRelationships.js";
import { normalizeRaceWeekendGrid } from "../domain/raceWeekendCompatibility.js";

export const SAVE_SCHEMA_VERSION = 2;
export const MIN_SUPPORTED_SAVE_SCHEMA_VERSION = 0;
export const GAME_VERSION = "1.0.1";

let fallbackSeedCounter = 0;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeStandingsRows(value, idKey) {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];

  for (const key of ["rows", "items", "table", "entries", "standings", "classification"]) {
    if (Array.isArray(value[key])) return value[key];
  }

  return Object.entries(value).flatMap(([key, row]) => {
    if (!isRecord(row)) return [];
    const hasIdentity =
      row.id != null ||
      row.driver_id != null ||
      row.team_id != null ||
      row.constructor_id != null;
    return hasIdentity || !idKey ? [row] : [{ ...row, [idKey]: key }];
  });
}

function normalizeStandingsState(state) {
  const standings = isRecord(state?.standings) ? state.standings : {};
  const drivers = normalizeStandingsRows(
    standings.drivers ?? standings.driverStandings ?? standings.driver_standings ?? [],
    "driver_id"
  );
  const teams = normalizeStandingsRows(
    standings.teams ??
      standings.constructors ??
      standings.teamStandings ??
      standings.constructorStandings ??
      standings.team_standings ??
      [],
    "team_id"
  );

  return {
    ...state,
    standings: {
      ...standings,
      drivers,
      teams,
    },
  };
}

function teamIdentity(state) {
  const team = state?.team || {};
  return String(team.team_id ?? team.id ?? team.team_name ?? team.name ?? "no-team");
}

function stableLegacySeed(state) {
  const identity = [
    "legacy",
    state?.careerMeta?.sourceSeason ?? state?.activeYear ?? state?.seasonYear ?? "season",
    teamIdentity(state),
    state?.currentDateISO ?? "date",
    state?.currentRound ?? 0,
    Array.isArray(state?.historySeasons) ? state.historySeasons.length : 0,
    Array.isArray(state?.resultsHistory) ? state.resultsHistory.length : 0,
    Array.isArray(state?.financeLog) ? state.financeLog.length : 0,
  ].join("|");
  return `f1ml-legacy-${hashSeed(identity).toString(16)}`;
}

function entropyToken() {
  try {
    const cryptoObj = globalThis?.crypto;
    if (cryptoObj?.getRandomValues) {
      const values = new Uint32Array(2);
      cryptoObj.getRandomValues(values);
      return `${values[0].toString(36)}${values[1].toString(36)}`;
    }
  } catch {}

  fallbackSeedCounter += 1;
  return `${Date.now().toString(36)}-${fallbackSeedCounter.toString(36)}`;
}

export function createCareerSeed({ year, teamId, entropy } = {}) {
  const token = entropy == null || entropy === "" ? entropyToken() : String(entropy);
  return `f1ml-${String(year ?? "season")}-${String(teamId ?? "no-team")}-${token}`;
}

export function createNewSaveMeta({ year, teamId, seed, entropy } = {}) {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    seed: String(seed ?? createCareerSeed({ year, teamId, entropy })),
    migrations: [],
  };
}

function migrateV0ToV1(state) {
  const next = clone(state);
  const existingMeta = isRecord(next.saveMeta) ? next.saveMeta : {};
  next.saveMeta = {
    ...existingMeta,
    schemaVersion: 1,
    gameVersion: String(existingMeta.gameVersion ?? GAME_VERSION),
    seed: String(existingMeta.seed ?? stableLegacySeed(next)),
    migrations: [
      ...(Array.isArray(existingMeta.migrations) ? existingMeta.migrations : []),
      {
        id: "save-schema-v0-to-v1",
        from: 0,
        to: 1,
        policy: "structural_metadata_only_no_gameplay_recalculation",
      },
    ],
  };
  return next;
}

function migrateV1ToV2(state) {
  const normalized = normalizePhysicalPartState(clone(state));
  const existingMeta = isRecord(normalized.saveMeta) ? normalized.saveMeta : {};
  normalized.saveMeta = {
    ...existingMeta,
    schemaVersion: 2,
    gameVersion: String(existingMeta.gameVersion ?? GAME_VERSION),
    seed: String(existingMeta.seed ?? stableLegacySeed(normalized)),
    migrations: [
      ...(Array.isArray(existingMeta.migrations) ? existingMeta.migrations : []),
      {
        id: "save-schema-v1-to-v2-physical-part-units",
        from: 1,
        to: 2,
        policy: "migrate_part_design_inventory_to_independent_physical_units",
      },
    ],
  };
  return normalized;
}

const MIGRATIONS = new Map([
  [0, migrateV0ToV1],
  [1, migrateV1ToV2],
]);

export function migrateGameState(input) {
  if (!isRecord(input)) throw new TypeError("Save gameState must be an object.");

  let state = clone(input);
  let version = Number(state?.saveMeta?.schemaVersion ?? 0);

  if (!Number.isInteger(version)) {
    throw new Error(`Unsupported save schema version ${state?.saveMeta?.schemaVersion}.`);
  }
  if (version > SAVE_SCHEMA_VERSION) {
    throw new Error(`Save schema version ${version} is newer than supported version ${SAVE_SCHEMA_VERSION}.`);
  }
  if (version < MIN_SUPPORTED_SAVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported save schema version ${version}.`);
  }

  while (version < SAVE_SCHEMA_VERSION) {
    const migrate = MIGRATIONS.get(version);
    if (!migrate) throw new Error(`No save migration path exists from schema version ${version}.`);
    state = migrate(state);
    const nextVersion = Number(state?.saveMeta?.schemaVersion);
    if (!Number.isInteger(nextVersion) || nextVersion <= version) {
      throw new Error(`Save migration from schema version ${version} did not advance the schema.`);
    }
    version = nextVersion;
  }

  state.saveMeta = {
    ...(isRecord(state.saveMeta) ? state.saveMeta : {}),
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: String(state?.saveMeta?.gameVersion ?? GAME_VERSION),
    seed: String(state?.saveMeta?.seed ?? stableLegacySeed(state)),
    migrations: Array.isArray(state?.saveMeta?.migrations) ? state.saveMeta.migrations : [],
  };

  state = normalizeStandingsState(state);
  if (state?.raceWeekendState) {
    state = {
      ...state,
      raceWeekendState: normalizeRaceWeekendGrid(state.raceWeekendState),
    };
  }
  return synchronizeDriverRelationships(state,{source:"save_backfill_neutral"});
}

export function prepareGameStateForSave(input) {
  const state = migrateGameState(input);
  return {
    ...state,
    saveMeta: {
      ...state.saveMeta,
      schemaVersion: SAVE_SCHEMA_VERSION,
      gameVersion: GAME_VERSION,
    },
  };
}

export function migrateStoredSave(input) {
  if (!isRecord(input)) throw new TypeError("Stored save must be an object.");

  if (isRecord(input.gameState)) {
    const legacyGameVersion = input?.meta?.gameVersion ?? input?.meta?.version ?? null;
    const sourceState = legacyGameVersion != null && !isRecord(input.gameState.saveMeta)
      ? { ...input.gameState, saveMeta: { schemaVersion: 0, gameVersion: String(legacyGameVersion) } }
      : input.gameState;
    const gameState = migrateGameState(sourceState);
    return {
      ...clone(input),
      meta: {
        ...(isRecord(input.meta) ? input.meta : {}),
        schemaVersion: SAVE_SCHEMA_VERSION,
        gameVersion: GAME_VERSION,
        seed: gameState.saveMeta.seed,
      },
      gameState,
    };
  }

  return migrateGameState(input);
}

export function extractGameStateFromStoredSave(input) {
  const migrated = migrateStoredSave(input);
  return isRecord(migrated.gameState) ? migrated.gameState : migrated;
}
