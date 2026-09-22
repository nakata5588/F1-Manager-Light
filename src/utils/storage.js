// src/utils/storage.js

/** ===== CONSTs de save ===== */
const SAVE_PREFIX = "f1ml_save_";
const HEAVY_KEYS = [
  "dbCalendar", "dbDrivers", "dbTeams", "dbDriverRatings", "dbStaffRatings",
  "dbTeamBrands", "dbTeamEngines", "dbContracts", "dbSponsorsContracts",
  "dbRules", "dbEraSafety", "dbAccidentModel", "dbDriverCareer", "dbAchievements",
  "dbFacilities", "dbStaffContracts",
  "dbTyres", "dbPointsSystems", "dbQualifyingRules", "dbQualifyingRuleOverrides", "dbPenaltiesRules", "dbFinancialRules",
  "dbBoardGoals", "dbAgendaBlocks", "dbLogosIndex", "dbAIDifficulty",
  "dbContractRules", "dbYouthIntakeRules", "dbScoutingZones", "dbTrackLayoutByYear", "dbCoreTracks",
  "dbWeatherProfiles", "dbWeatherStates", "dbPitcrewRoster",
];

// ... (todas as funções que lidam com localStorage)
// makeLightSnapshot, evictOldSaves, isQuotaError, setItemQuotaSafe

/**
 * Cria uma cópia "leve" do estado, excluindo as chaves "pesadas" para poupar espaço.
 * @param {object} gs - O estado do jogo (gameState) completo.
 * @returns {object} Uma cópia do estado sem os dados brutos.
 */
export function makeLightSnapshot(gs) {
  const light = { ...gs };
  for (const k of HEAVY_KEYS) delete light[k];
  return light;
}

function isQuotaError(e) {
  return e && (e.name === "QuotaExceededError" || e.code === 22 || String(e).includes("exceeded the quota"));
}

export function evictOldSaves(minKeep = 3) {
  // ... a tua função de evictOldSaves aqui ...
}

export function setItemQuotaSafe(key, value) {
  // ... a tua função de setItemQuotaSafe aqui ...
}