// The in-memory save boundary. Keep persisted v0-v2 saves flat until an
// explicitly versioned, tested storage migration is introduced.
// This module classifies ownership; it never derives gameplay or compacts data.
export const SAVE_SECTION_LAYOUT_VERSION = 1;

export const REFERENCE_DATA_KEYS = Object.freeze([

  "dbCalendar","dbDrivers","dbTeams","dbDriverRatings","dbDriverRatingProfiles","dbDriverHistory","dbHistoricalChampionships","dbDriverOpeningState","dbStaffRatings","dbSeries","dbSeriesRules","dbLowerSeriesTeams","dbLowerSeriesEntries",
  "dbTeamBrands","dbTeamEngines","dbContracts","dbSponsorsContracts",
  "dbRules","dbEraSafety","dbAccidentModel","dbDriverCareer","dbAchievements",
  "dbFacilities","dbCarStats","dbStaffContracts","dbStaffCore",
  "dbTyres","dbPointsSystems","dbQualifyingRules","dbQualifyingRuleOverrides","dbPenaltiesRules","dbFinancialRules",
  "dbBoardGoals","dbAgendaBlocks","dbLogosIndex","dbAIDifficulty",
  "dbContractRules","dbYouthIntakeRules","dbScoutingZones","dbTrackLayoutByYear","dbTeamSeasons","dbTeamConstructorBridge","dbTeamLineageHistory","dbCoreTracks",
  "dbWeatherProfiles","dbWeatherStates","dbPitcrewRoster",
]);

// The canonical Race Weekend state (including unfinished race runtime) belongs
// entirely to the active section. Never compact or project it while saving.
export const ACTIVE_RACE_SAVE_KEYS = Object.freeze([
  "raceEntryState", "raceWeekendState",
]);

// These keys hold previously archived career events, not reference DB results.
export const ARCHIVED_RESULT_SAVE_KEYS = Object.freeze([
  "results", "resultsHistory", "historySeasons",
]);

const referenceKeys = new Set(REFERENCE_DATA_KEYS);
const activeKeys = new Set(ACTIVE_RACE_SAVE_KEYS);
const archiveKeys = new Set(ARCHIVED_RESULT_SAVE_KEYS);

function asRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(name + " must be an object.");
  }
  return value;
}

// Unknown and newly added gameplay fields stay in careerState by default;
// an unrecognised field must never be silently dropped from a save.
export function partitionGameStateForSave(gameState) {
  const state = asRecord(gameState, "gameState");
  const groups = {
    referenceData: [],
    careerState: [],
    activeRace: [],
    archivedResults: [],
  };
  const keyOrder = [];
  for (const [key, value] of Object.entries(state)) {
    keyOrder.push(key);
    const group = referenceKeys.has(key) ? "referenceData"
      : activeKeys.has(key) ? "activeRace"
      : archiveKeys.has(key) ? "archivedResults"
      : "careerState";
    groups[group].push([key, value]);
  }
  return {
    layoutVersion: SAVE_SECTION_LAYOUT_VERSION,
    keyOrder,
    referenceData: Object.fromEntries(groups.referenceData),
    careerState: Object.fromEntries(groups.careerState),
    activeRace: Object.fromEntries(groups.activeRace),
    archivedResults: Object.fromEntries(groups.archivedResults),
  };
}

// Rebuild the existing flat gameState, preserving original key order for the
// legacy JSON envelope and existing manual-save duplicate detection.
export function reassembleSaveSections(partition, { includeReferenceData = false } = {}) {
  const parts = asRecord(partition, "save sections");
  if (parts.layoutVersion !== SAVE_SECTION_LAYOUT_VERSION) {
    throw new Error("Unsupported save section layout version " + parts.layoutVersion + ".");
  }
  const groups = [
    ["careerState", parts.careerState],
    ["activeRace", parts.activeRace],
    ["archivedResults", parts.archivedResults],
    ...(includeReferenceData ? [["referenceData", parts.referenceData]] : []),
  ];
  const values = new Map();
  for (const [name, group] of groups) {
    for (const [key, value] of Object.entries(asRecord(group, name))) {
      if (values.has(key)) throw new Error("Duplicate save field " + key + ".");
      values.set(key, value);
    }
  }
  const ordered = [];
  const seen = new Set();
  for (const key of Array.isArray(parts.keyOrder) ? parts.keyOrder : []) {
    if (seen.has(key) || !values.has(key)) continue;
    ordered.push([key, values.get(key)]);
    seen.add(key);
  }
  for (const [key, value] of values) {
    if (!seen.has(key)) ordered.push([key, value]);
  }
  return Object.fromEntries(ordered);
}

export function legacyCompatibleSaveState(gameState) {
  return reassembleSaveSections(partitionGameStateForSave(gameState));
}
