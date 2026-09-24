// src/state/GameStore.js
import { create } from "zustand";
import { triggerDailyTick } from "@/engine/EventEngine";
import { processScoutingTick } from "@/engine/ScoutingEngine";
import { createCareerMeta } from "@/core/careerBoundary";
import { rolloverSeasonPure } from "@/core/season";
import { fetchSeasonPack, seasonPackStatePatch } from "@/data/seasonPackLoader";
import { defaultDriverCondition } from "@/domain/driverRating";
import { buildFreshCareerState } from "@/state/newGameRuntime";
import { GAME_VERSION, SAVE_SCHEMA_VERSION, createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "@/core/saveSafety";
import { refreshDriverAvailability } from "@/engine/InjuryEngine";
import { processWorkshopJobs } from "@/domain/componentService";
import { tickAITechnicalWorld } from "@/engine/AITechnicalEngine";
import { syncGarageState } from "@/domain/garage";
import { processTechnologyAdoption, processTechnologyDiscoveryNews } from "@/domain/technologyAdoption";
import {
  applyOpeningStateToDriver,
  openingDriverId,
  openingStateExcluded,
  openingStateIsRaceSeat,
  openingStateIsTeamCommitment,
  openingStateRowsForYear,
  openingTeamId,
} from "@/domain/driverOpeningState";

/** ===== CONSTs de save ===== */
const SAVE_KEY = "f1hm_save";
const SAVE_PREFIX = "f1ml_save_";
const LAST_SAVE_KEY = "f1ml_last_save_key";

/** ===== util curto ===== */
function nowIso() { return new Date().toISOString(); }
function defaultSaveName(gs) {
  const team = gs?.team?.team_name || gs?.team?.name || "Save";
  const season = gs?.activeYear || gs?.seasonYear || "";
  return `${team}${season ? ` — ${season}` : ""}`;
}
function safeJSONParse(str) { try { return JSON.parse(str); } catch { return null; } }

/* ---------- helpers extra para dedupe ---------- */
function stableStringify(obj) { try { return JSON.stringify(obj); } catch { return String(obj); } }
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
let __savingMutex = false;
let __lastSaveHash = null;
let __lastSaveTs = 0;
let __lastSaveResult = null;
const DEDUPE_WINDOW_MS = 1200;

/** ===== DEFAULT SETTINGS ===== */
const defaultSettings = {
  uiTheme: "auto",
  language: "en",
  dateFormat: "yyyy-MM-dd",
  autosave: true,
  autosaveIntervalMin: 10,
  notifications: true,
  audio: { masterVolume: 70, sfxVolume: 70, musicVolume: 30 },
  gameplay: {
    difficulty: "normal",
    simSpeed: 1,
    rulesEra: "1980",
    enableInjuryRandomEvents: true,
    enableFatalities: true,
    enableWeatherRandomness: true,
    autoRollover: false,
  },
  data: { datasource: "json", remoteUrl: "" },
  developer: { showDevTools: false, verboseLogs: false },
};

/** ===== fetch JSON (public/data) ===== */
async function fetchJsonSafe(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const head = (await res.text()).slice(0, 120);
    throw new Error(`Not JSON (${ct}) on ${path}. Head: ${head}`);
  }
  return res.json();
}
async function fetchOptional(path, fallback = []) {
  try { return await fetchJsonSafe(path); } catch { return fallback; }
}

/** ==================== QUOTA-SAFE STORAGE ==================== */
const HEAVY_KEYS = [
  "dbCalendar","dbDrivers","dbTeams","dbDriverRatings","dbDriverHistory","dbDriverOpeningState","dbStaffRatings",
  "dbTeamBrands","dbTeamEngines","dbContracts","dbSponsorsContracts",
  "dbRules","dbEraSafety","dbAccidentModel","dbDriverCareer","dbAchievements",
  "dbFacilities","dbCarStats","dbStaffContracts","dbStaffCore",
  "dbTyres","dbPointsSystems","dbQualifyingRules","dbQualifyingRuleOverrides","dbPenaltiesRules","dbFinancialRules",
  "dbBoardGoals","dbAgendaBlocks","dbLogosIndex","dbAIDifficulty",
  "dbContractRules","dbYouthIntakeRules","dbScoutingZones","dbTrackLayoutByYear","dbTeamSeasons","dbCoreTracks",
  "dbWeatherProfiles","dbWeatherStates","dbPitcrewRoster",
];
function makeLightSnapshot(gs) {
  const light = { ...gs };
  for (const k of HEAVY_KEYS) delete light[k];
  return prepareGameStateForSave(light);
}
function isQuotaError(e) {
  return e && (e.name === "QuotaExceededError" || e.code === 22 || String(e).includes("exceeded the quota"));
}
function evictOldSaves(minKeep = 3) {
  try {
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SAVE_PREFIX)) {
        const raw = localStorage.getItem(k);
        let ts = 0;
        try { ts = Date.parse(JSON.parse(raw)?.meta?.savedAt || ""); } catch {}
        if (!Number.isFinite(ts)) {
          const m = String(k).match(/(\d{10,})$/);
          if (m) ts = Number(m[1]);
        }
        items.push({ key: k, ts: ts || 0 });
      }
    }
    items.sort((a,b) => a.ts - b.ts);
    let removed = 0;
    while (items.length > minKeep) {
      const it = items.shift();
      localStorage.removeItem(it.key);
      removed++;
    }
    return removed;
  } catch { return 0; }
}
function setItemQuotaSafe(key, value, { evictManualSaves = true } = {}) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (!isQuotaError(e)) throw e;
    // Background/rolling autosaves must never delete the user's manual saves.
    if (!evictManualSaves) return false;
    evictOldSaves(2);
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }
}
function cleanupLegacyAutosaveDuplicate() {
  try { localStorage.removeItem("f1ml.autosave"); } catch {}
}
function setRollingSnapshot(value) {
  cleanupLegacyAutosaveDuplicate();
  return setItemQuotaSafe(SAVE_KEY, value, { evictManualSaves: false });
}

function hydrateLoadedGameState(saved) {
  return {
    ...saved,
    settings: { ...defaultSettings, ...(saved?.settings || {}) },
    inbox: Array.isArray(saved?.inbox) ? saved.inbox : [],
    eventsQueue: Array.isArray(saved?.eventsQueue) ? saved.eventsQueue : [],
    driverAttrLog: saved?.driverAttrLog || {},
    driverAvailability: saved?.driverAvailability || {},
    medicalHistory: Array.isArray(saved?.medicalHistory) ? saved.medicalHistory : [],
    temporaryDriverAssignments: Array.isArray(saved?.temporaryDriverAssignments) ? saved.temporaryDriverAssignments : [],
    driverNegotiations: Array.isArray(saved?.driverNegotiations) ? saved.driverNegotiations : [],
    raceEntryState: saved?.raceEntryState || null,
    raceWeekendState: saved?.raceWeekendState || null,
    financeLog: Array.isArray(saved?.financeLog) ? saved.financeLog : [],
    finances: saved?.finances || null,
    showSeasonSummary: false,
  };
}

function latestManualSaveKey() {
  try {
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(SAVE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      let ts = 0;
      try { ts = Date.parse(JSON.parse(raw)?.meta?.savedAt || ""); } catch {}
      if (!Number.isFinite(ts) || ts <= 0) {
        const match = String(key).match(/(\d{10,})$/);
        if (match) ts = Number(match[1]);
      }
      items.push({ key, ts: Number(ts) || 0 });
    }
    items.sort((a, b) => b.ts - a.ts);
    return items[0]?.key || null;
  } catch {
    return null;
  }
}

function checkpointRaceWeekendState(gs) {
  try {
    const phase=String(gs?.raceWeekendState?.phase||"");
    if(!phase||phase==="completed"||gs?.settings?.autosave===false)return false;
    const light=makeLightSnapshot(gs);
    // One rolling recovery snapshot is enough. A second full copy used to
    // double localStorage pressure during live weekends and could trigger
    // eviction of manual saves.
    return setRollingSnapshot(JSON.stringify(light));
  } catch (error) {
    console.warn("race weekend checkpoint failed:",error);
    return false;
  }
}

/** ===== Excel sanitizers ===== */
function unexcel(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    // ExcelJS can export formula failures as { error: "#N/A" }. Those objects
    // must never reach React as renderable values.
    if ("error" in v && !("result" in v) && !("value" in v)) return null;
    if (v.result != null && v.result !== "") return unexcel(v.result);
    if (v.value  != null && v.value  !== "") return unexcel(v.value);
    if ("error" in v) return null;
  }
  return v;
}
function unexcelDeep(x) {
  const u = unexcel(x);
  if (Array.isArray(u)) return u.map(unexcelDeep);
  if (u && typeof u === "object") {
    const out = {};
    for (const [k, v] of Object.entries(u)) out[k] = unexcelDeep(v);
    return out;
  }
  return u;
}

/* ======================= Helpers de mapeamento ======================= */
function pick(obj, keys, fallback = undefined) {
  for (const k of keys) {
    const raw = obj ? obj[k] : undefined;
    const val = unexcel(raw);
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return fallback;
}
function canon(val) {
  return String(unexcel(val) ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}
function getTeamId(t) {
  return String(pick(t, ["team_id", "id", "name", "team_name", "short_name"], JSON.stringify(t)));
}
function getYearNumber(r) {
  const direct = pick(r, ["year", "season_year", "season", "yr", "y"], null);
  if (direct != null && direct !== "") return Number(direct);
  const dateLike = pick(r, ["date", "race_date", "start_date", "end_date"], "");
  if (typeof dateLike === "string" && dateLike.length >= 4) {
    const maybe = Number(dateLike.slice(0, 4));
    if (!Number.isNaN(maybe)) return maybe;
  }
  return NaN;
}
function extractGPYear(gp) {
  const y = getYearNumber(gp);
  return Number.isNaN(y) ? NaN : y;
}

/** ===== datas util ===== */
function firstDayISO(Y) {
  const y = String(Number(Y)).padStart(4, "0");
  return `${y}-01-01`;
}
const clampISO = (iso) => String(iso || "").slice(0, 10);
const parseISO = (iso) => {
  if (!iso) return new Date(NaN);
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y || 0, (m || 1) - 1, d || 1));
};
const addDaysISO = (iso, n = 1) => {
  const d = parseISO(iso);
  if (isNaN(+d)) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const firstDefined = (...vals) => vals.find((v) => v != null && v !== "");
const gpDateISO = (gp) =>
  clampISO(firstDefined(gp?.dateISO, gp?.date, gp?.race_date, gp?.start_date, gp?.end_date, gp?.raceDate));

/** ===== atributos/driver logs ===== */
function yearFrom(val) {
  if (!val && val !== 0) return NaN;
  if (val instanceof Date) return val.getUTCFullYear();
  const m = String(val).match(/(\d{4})/);
  return m ? Number(m[1]) : NaN;
}
function ageOnYear(dob, Y) {
  const y = yearFrom(dob);
  return Number.isNaN(y) ? NaN : Y - y;
}
function computeDriverStatus(selectedYear, driver) {
  const Y = Number(selectedYear);
  const birthYear = yearFrom(driver.dob ?? driver.date_of_birth);
  const start = Number(driver.career_start_year ?? NaN);
  const debut = Number(driver.f1_rookie_season ?? NaN);
  const retire = driver.career_end_year == null || driver.career_end_year === "" ? null : Number(driver.career_end_year);
  const deceasedYear = yearFrom(driver.death_date);

  if (Number.isFinite(birthYear) && Y < birthYear) return "hidden";
  if (!Number.isNaN(deceasedYear) && deceasedYear <= Y) return "deceased";
  if (Number.isFinite(start) && Y < start) return "hidden";
  if (retire !== null && Y > retire) return "retired";
  if (Number.isFinite(debut)) return Y < debut ? "pre_f1" : "eligible";
  return "pre_f1";
}
function activeInYear(entity, year) {
  const first = pick(entity, ["first_year", "start_year", "founded_year"], -Infinity);
  const last = pick(entity, ["last_year", "end_year", "defunct_year"], Infinity);
  const y = Number(year);
  return y >= Number(first ?? -Infinity) && y <= Number(last ?? Infinity);
}
function filterByYear(records, year) {
  const y = Number(year);
  return (records || []).filter((r) => Number(getYearNumber(r)) === y);
}
function filterByYearRange(records, year) {
  const y = Number(year);
  return (records || []).filter((r) => {
    const start = Number(pick(r, ["start_year", "from_year", "first_year", "year_start", "start", "from", "year_from", "contract_start", "contract_start_year"], -Infinity));
    const endRaw = pick(r, ["end_year", "to_year", "last_year", "year_end", "end", "to", "year_to", "contract_until", "contract_until_year"], Infinity);
    const end = endRaw == null || endRaw === "" ? Infinity : Number(endRaw);
    if (Number.isNaN(start) && end === Infinity) {
      const yr = Number(getYearNumber(r));
      return yr === y;
    }
    return y >= (Number.isNaN(start) ? -Infinity : start) && y <= (Number.isNaN(end) ? Infinity : end);
  });
}
function qualifyingRulesForYear(baseRows, overrideRows, year) {
  const y=Number(year);
  const historical=(baseRows||[])
    .filter((row)=>{
      const ry=Number(getYearNumber(row));
      return Number.isFinite(ry)&&ry<=y;
    })
    .sort((a,b)=>Number(getYearNumber(b))-Number(getYearNumber(a)))[0]||{};
  const overrides=filterByYearRange(overrideRows||[],y);
  const generic=overrides.filter((row)=>!pick(row,["gp_id","event_id","track_id","circuit_id"],null));
  const eventOverrides=overrides.filter((row)=>pick(row,["gp_id","event_id","track_id","circuit_id"],null));
  return {
    ...historical,
    ...generic.reduce((acc,row)=>({...acc,...row}),{}),
    year:y,
    rule_source:"historical_seed_calibration",
    event_overrides:eventOverrides.map((row)=>({...row})),
  };
}
function normalizeTeam(t) {
  const base = pick(t, ["team_base", "base", "hq", "headquarters", "country", "location", "nation"], null);
  const name = pick(t, ["name", "team_name", "short_name"], null);
  const id = getTeamId(t);
  return { ...t, team_id: id, name: name ?? id, base };
}
function sameTeam(rec, team) {
  const recId = pick(rec, ["team_id", "team", "constructor_id", "constructor", "name", "team_name", "short_name"]);
  if (recId != null && getTeamId(team) === String(recId)) return true;
  const rn = pick(rec, ["team_name", "constructor", "name", "team", "short_name"]);
  const tn = pick(team, ["name", "team_name", "short_name"]);
  return rn && tn && canon(rn) === canon(tn);
}

/* ===== Helpers Finance ===== */
function findTeamBrandForYear(gs, teamId, year) {
  const pool = gs.dbTeamBrands || [];
  const exact = pool.filter(r => String(pick(r, ["team_id","team","constructor"])) === String(teamId) && Number(getYearNumber(r)) === Number(year));
  if (exact.length) return exact[0];
  const ranged = filterByYearRange(pool, year).find(r => String(pick(r, ["team_id","team","constructor"])) === String(teamId));
  return ranged || null;
}
function computeStartingBudget(gs, teamId, year) {
  const rec = findTeamBrandForYear(gs, teamId, year);
  const val = Number(pick(rec || {}, ["starting_budget", "start_budget", "budget_start"], 0)) || 0;
  return Math.max(0, val);
}

/* ======================= STORE ======================= */
export const useGame = create((set, get) => ({
  gameState: {
    currentDateISO: "1980-01-01",
    currentRound: 0,

    // DB bruta
    dbCalendar: [],
    dbDrivers: [],
    dbTeams: [],
    dbDriverRatings: [],
    dbDriverHistory: [],
    dbDriverOpeningState: [],
    dbStaffRatings: [],
    dbTeamBrands: [],
    dbTeamEngines: [],
    dbContracts: [],
    dbSponsorsContracts: [],
    dbRules: [],
    dbEraSafety: [],
    dbAccidentModel: [],
    dbFacilities: [],
    dbCarStats: [],
    dbCarParts: [],
    dbStaffContracts: [],
    dbStaffCore: [],

    // novas DBs
    dbTyres: [],
    dbPointsSystems: [],
    dbQualifyingRules: [],
    dbQualifyingRuleOverrides: [],
    dbPenaltiesRules: [],
    dbFinancialRules: [],
    dbBoardGoals: [],
    dbAgendaBlocks: [],
    dbLogosIndex: [],
    dbAIDifficulty: [],
    dbContractRules: [],
    dbYouthIntakeRules: [],
    dbScoutingZones: [],
    dbTrackLayoutByYear: [],
    dbTeamSeasons: [],
    dbCoreTracks: [],
    dbWeatherProfiles: [],
    dbWeatherStates: [],
    dbPitcrewRoster: [],

    yearsAvailable: [],
    seasonPackIndex: [],
    seasonPackMeta: null,

    // filtrados
    activeYear: 1980,
    calendar: [],
    drivers: [],
    teams: [],
    driverRatings: [],
    driverOpeningState: [],
    staffRatings: [],
    staffCore: [],
    teamBrands: [],
    teamEngines: [],
    contracts: [],
    sponsorsContracts: [],
    rules: [],
    eraSafety: [],
    accidentModel: [],
    facilities: [],
    carStats: [],
    staffContracts: [],

    // filtrados novos
    tyres: [],
    pointsSystem: null,
    qualifyingRules: null,
    penaltiesRules: [],
    financialRules: [],
    agendaBlocks: [],
    coreTracks: [],
    trackLayoutByYear: [],

    // adicionais
    driverStats: {},
    driverCareer: {},
    driverAttributes: {},
    driverMentalStateLog: {},
    driverRelationships: { version: 1, relations: {}, log: [] },
    driverAvailability: {},
    medicalHistory: [],
    temporaryDriverAssignments: [],
    driverNegotiations: [],
    raceEntryState: null,
    raceWeekendState: null,
    dbAchievements: [],
    achievements: [],
    dbDriverCareer: [],

    // Settings
    settings: defaultSettings,

    // save/ui
    team: null,
    standings: { drivers: [], teams: [] },

    // Inbox e fila
    inbox: [],
    eventsQueue: [],

    // histórico de atributos por piloto
    driverAttrLog: {},

    // 💰 Finanças
    financeLog: [],
    finances: null,

    // 🔄 Season summary modal flag
    showSeasonSummary: false,
  },

  currentSaveKey: null,

  /* ==== UI Toaster ==== */
  uiToasts: [],
  pushToast: (input) => {
    const allow = get().gameState?.settings?.notifications !== false;
    if (!allow) return null;
    const id = input?.id || `t_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const toast = {
      id,
      title: input?.title || "Notification",
      description: input?.description || "",
      type: input?.type || "info",
      ttl: Number.isFinite(input?.ttl) ? input.ttl : 3000,
    };
    set((s) => ({ uiToasts: [...(s.uiToasts || []), toast] }));
    if (toast.ttl > 0) {
      setTimeout(() => { try { get().dismissToast(id); } catch {} }, toast.ttl);
    }
    return id;
  },
  dismissToast: (id) => set((s) => ({ uiToasts: (s.uiToasts || []).filter((t) => t.id !== id) })),

  setGameState: (partial) => set((s) => ({ gameState: { ...s.gameState, ...partial } })),

  updateSettings: (next) => {
    set((state) => ({
      gameState: {
        ...state.gameState,
        settings: { ...state.gameState?.settings, ...next },
      },
    }));
  },

  loadSeasonPack: async (yearInput, { fallback = true } = {}) => {
    const year = Number(yearInput);
    if (!Number.isInteger(year)) return { ok: false, source: "invalid" };
    try {
      const pack = await fetchSeasonPack(year);
      const patch = seasonPackStatePatch(pack);
      set((s) => ({
        gameState: {
          ...s.gameState,
          ...patch,
        },
      }));
      return { ok: true, source: "season-pack", pack };
    } catch (error) {
      console.warn(`[SeasonPack] ${year} unavailable; using legacy materializer.`, error);
      if (fallback) {
        get().applyYearFilter(year, { normalizeDate: true });
        set((s) => ({
          gameState: {
            ...s.gameState,
            seasonPackMeta: {
              format: "legacy-year-filter",
              schemaVersion: 0,
              year,
              error: String(error?.message || error),
            },
          },
        }));
        return { ok: true, source: "legacy", error };
      }
      return { ok: false, source: "season-pack", error };
    }
  },

  setActiveYear: (year, opts = { normalizeDate: true }) => {
    const { normalizeDate = true } = opts || {};
    get().applyYearFilter(Number(year), { normalizeDate });
  },

  /** ===================== ROLLOVER / NEW SEASON ===================== */
  rolloverSeason: async (targetYear) => {
    const st = get().gameState || {};
    const nextYear = Number(targetYear ?? (st.activeYear || 1980) + 1);

    try {
      // Never applyYearFilter here: that would replace the simulated career
      // with historical future assignments/outcomes from the Global Database.
      set((s) => ({ gameState: rolloverSeasonPure(s.gameState, nextYear) }));
    } catch (e) {
      console.warn("rolloverSeason fallback:", e);
      set((s) => ({
        gameState: {
          ...s.gameState,
          activeYear: nextYear,
          currentDateISO: `${nextYear}-01-01`,
          currentRound: 0,
          standings: { drivers: [], teams: [] },
          _seasonFinishedAt: null,
          showSeasonSummary: false,
        },
      }));
    }

    get().pushToast?.({
      title: `Season ${nextYear} started`,
      description: "Career world rolled forward; structural calendar loaded.",
      type: "success",
      ttl: 3000,
    });
  },

  /** ===================== AVANÇAR UM DIA ===================== */
  advanceOneDay: async () => {
    const s = get().gameState;
    const baseISO = clampISO(s.currentDateISO || firstDayISO(s.activeYear || 1980));
    const newISO  = addDaysISO(baseISO, 1);
    const nextCalendarYear = Number(String(newISO).slice(0, 4));
    let updated = { ...s, currentDateISO: newISO };
    if (Number.isInteger(nextCalendarYear) && nextCalendarYear > Number(s.activeYear || 0)) {
      updated = rolloverSeasonPure(s, nextCalendarYear);
    }
    try {
      const res = triggerDailyTick(updated);
      updated = res?.state || res?.patched || res || updated;
      updated = processScoutingTick(updated);
      updated = refreshDriverAvailability(updated, updated.currentDateISO);
      updated = processWorkshopJobs(updated);
      updated = processTechnologyAdoption(updated);
      updated = tickAITechnicalWorld(updated);
      updated = processTechnologyDiscoveryNews(updated);
      const changes = res?.changes || res?.attrChanges || [];
      if (Array.isArray(changes) && changes.length) {
        // se tiveres esta função noutro sítio, mantém; caso não, remove esta linha
        if (typeof applyAttrChangesDict === "function") {
          updated = { ...updated, driverAttrLog: applyAttrChangesDict(updated.driverAttrLog, changes) };
        }
      }
    } catch (e) {
      console.warn("[EventEngine] daily tick failed:", e);
    }

    // Keep single-day advance behavior aligned with "advance until break".
    try { const mod = await import("@/engine/RuleEngine"); if (typeof mod.applyRulesTick === "function") updated = mod.applyRulesTick(updated) || updated; } catch {}
    try { const mod = await import("@/engine/ProgressionEngine"); if (typeof mod.applyProgressionTick === "function") updated = mod.applyProgressionTick(updated) || updated; } catch {}
    try { const mod = await import("@/engine/EconomyEngine"); if (typeof mod.applyEconomyTick === "function") updated = mod.applyEconomyTick(updated) || updated; } catch {}
    try { const mod = await import("@/engine/MarketEngine"); if (typeof mod.applyMarketTick === "function") updated = mod.applyMarketTick(updated) || updated; } catch {}
    try { const mod = await import("@/engine/NegotiationEngine"); if (typeof mod.processDriverNegotiations === "function") updated = mod.processDriverNegotiations(updated) || updated; } catch {}
    try { const mod = await import("@/engine/InboxEngine"); if (typeof mod.syncInbox === "function") updated = mod.syncInbox(updated) || updated; } catch {}

    set({ gameState: updated });

    // ---- Fim de época: se já passámos a última corrida, abre Season Summary ----
    try {
      const gs = get().gameState || updated || {};
      const lastIdx = Math.max(0, (gs.calendar?.length || 1) - 1);
      const lastRaceISO = gpDateISO(gs.calendar?.[lastIdx]);
      const todayISO = clampISO(gs.currentDateISO);
      const yearNow = gs.activeYear || gs.seasonYear || gs.season || null;

      const canTrigger =
        lastRaceISO &&
        todayISO > lastRaceISO &&
        gs._seasonFinishedAt !== yearNow;

      if (canTrigger) {
        set({ gameState: { ...gs, _seasonFinishedAt: yearNow, showSeasonSummary: true } });
      }
    } catch (e) {
      console.warn("end-of-season check failed:", e);
    }
  },

  /** ===================== CARREGAR DB ===================== */
  loadData: async () => {
    try {
      const [
        driversRaw, calendarRaw, teamsRaw, driverRatingsRaw, driverCareerRaw, driverHistoryRaw, driverOpeningStateRaw, achievementsRaw,
        staffRatingsRaw, staffCoreRaw, teamBrandsRaw, teamEnginesRaw, contractsRaw, sponsorsContractsRaw,
        rulesRaw, eraSafetyRaw, accidentModelRaw, facilitiesRaw, carStatsRaw, carPartsRaw, staffContractsRaw,
        tyresRaw, pointsSystemsRaw, qualifyingRulesRaw, qualifyingRuleOverridesRaw, penaltiesRulesRaw, financialRulesRaw, boardGoalsRaw,
        agendaBlocksRaw, logosIndexRaw, aiDifficultyRaw, contractRulesRaw, youthIntakeRaw,
        scoutingZonesRaw, trackLayoutByYearRaw, teamSeasonsRaw, coreTracksRaw,
        weatherProfilesRaw, weatherStatesRaw, pitcrewRosterRaw, seasonIndexRaw,
      ] = await Promise.all([
        fetchJsonSafe("/data/drivers.json"),
        fetchJsonSafe("/data/calendar.json"),
        fetchJsonSafe("/data/teams.json"),
        fetchJsonSafe("/data/driver_ratings.json"),
        fetchJsonSafe("/data/driver_career.json"),
        fetchOptional("/data/driver_f1_history.json", []),
        fetchOptional("/data/driver_opening_state.json", []),
        fetchJsonSafe("/data/achievements.json"),
        fetchJsonSafe("/data/staff_ratings.json"),
        fetchOptional("/data/staff_core.json", []),
        fetchJsonSafe("/data/team_brands.json"),
        fetchJsonSafe("/data/team_engines.json"),
        fetchJsonSafe("/data/contracts.json"),
        fetchJsonSafe("/data/sponsors_contracts.json"),
        fetchJsonSafe("/data/rules.json"),
        fetchJsonSafe("/data/era_safety.json"),
        fetchJsonSafe("/data/accident_model.json").catch(() => ({})),
        fetchJsonSafe("/data/facilities.json"),
        fetchOptional("/data/car_stats_by_year.json", []),
        fetchOptional("/data/car_parts.json", []),
        fetchJsonSafe("/data/staff_contracts.json"),

        fetchOptional("/data/tyres_catalog.json", []),
        fetchOptional("/data/points_systems.json", []),
        fetchOptional("/data/qualifying_rules.json", []),
        fetchOptional("/data/qualifying_rule_overrides.json", []),
        fetchOptional("/data/penalties_rules.json", []),
        fetchOptional("/data/financial_rules.json", []),
        fetchOptional("/data/board_goals_templates.json", []),
        fetchOptional("/data/agenda_blocks.json", []),
        fetchOptional("/data/logos_index.json", []),
        fetchOptional("/data/ai_difficulty.json", []),
        fetchOptional("/data/contract_rules.json", []),
        fetchOptional("/data/youth_intake_rules.json", []),
        fetchOptional("/data/scouting_zones.json", []),
        fetchOptional("/data/track_layout_by_year.json", []),
        fetchOptional("/data/team_seasons.json", []),
        fetchOptional("/data/core_tracks.json", []),
        fetchOptional("/data/weather_profiles.json", []),
        fetchOptional("/data/weather_states.json", []),
        fetchOptional("/data/pitcrew_roster.json", []),
        fetchOptional("/data/seasons/index.json", { years: [] }),
      ]);

      const drivers           = unexcelDeep(driversRaw);
      const calendar          = unexcelDeep(calendarRaw);
      const teams             = unexcelDeep(teamsRaw);
      const driverRatings     = unexcelDeep(driverRatingsRaw);
      const driverCareer      = Array.isArray(driverCareerRaw) ? unexcelDeep(driverCareerRaw) : [];
      const driverHistory     = Array.isArray(driverHistoryRaw) ? unexcelDeep(driverHistoryRaw) : [];
      const driverOpeningState = Array.isArray(driverOpeningStateRaw) ? unexcelDeep(driverOpeningStateRaw) : [];
      const achievements      = (achievementsRaw && typeof achievementsRaw === "object") ? unexcelDeep(achievementsRaw) : { version: 1, list: [] };
      const staffRatings      = unexcelDeep(staffRatingsRaw);
      const staffCore         = unexcelDeep(staffCoreRaw);
      const teamBrands        = unexcelDeep(teamBrandsRaw);
      const teamEngines       = unexcelDeep(teamEnginesRaw);
      const contracts         = unexcelDeep(contractsRaw);
      const sponsorsContracts = unexcelDeep(sponsorsContractsRaw);
      const rules             = unexcelDeep(rulesRaw);
      const eraSafety         = unexcelDeep(eraSafetyRaw);
      const accidentModel     = (Array.isArray(accidentModelRaw) || typeof accidentModelRaw === "object") ? unexcelDeep(accidentModelRaw) : {};
      const facilities        = unexcelDeep(facilitiesRaw);
      const carStats          = unexcelDeep(carStatsRaw);
      const carParts          = unexcelDeep(carPartsRaw);
      const staffContracts    = unexcelDeep(staffContractsRaw);

      const tyres              = unexcelDeep(tyresRaw);
      const pointsSystems      = unexcelDeep(pointsSystemsRaw);
      const qualifyingRulesRawDb = unexcelDeep(qualifyingRulesRaw);
      const qualifyingRuleOverrides = unexcelDeep(qualifyingRuleOverridesRaw);
      const penaltiesRules     = unexcelDeep(penaltiesRulesRaw);
      const financialRules     = unexcelDeep(financialRulesRaw);
      const boardGoals         = unexcelDeep(boardGoalsRaw);
      const agendaBlocks       = unexcelDeep(agendaBlocksRaw);
      const logosIndex         = unexcelDeep(logosIndexRaw);
      const aiDifficulty       = unexcelDeep(aiDifficultyRaw);
      const contractRules      = unexcelDeep(contractRulesRaw);
      const youthIntake        = unexcelDeep(youthIntakeRaw);
      const scoutingZones      = unexcelDeep(scoutingZonesRaw);
      const trackLayoutByYear  = unexcelDeep(trackLayoutByYearRaw);
      const teamSeasons         = unexcelDeep(teamSeasonsRaw);
      const coreTracks          = unexcelDeep(coreTracksRaw);
      const weatherProfiles     = unexcelDeep(weatherProfilesRaw);
      const weatherStates       = unexcelDeep(weatherStatesRaw);
      const pitcrewRoster       = unexcelDeep(pitcrewRosterRaw);
      const seasonPackIndex      = Array.isArray(seasonIndexRaw?.years) ? unexcelDeep(seasonIndexRaw.years) : [];

      const packYears = seasonPackIndex
        .filter((row) => row?.ready !== false)
        .map((row) => Number(row?.year))
        .filter(Number.isInteger);
      const yearsAvailable = packYears.length
        ? Array.from(new Set(packYears)).sort((a,b)=>a-b)
        : Array.from(
            new Set((calendar || []).map((gp) => {
              const yr = gp?.season_year ?? gp?.year ?? (typeof gp?.race_date === "string" ? gp.race_date.slice(0, 4) : null);
              return yr != null ? Number(yr) : null;
            }).filter((x) => x != null))
          ).sort((a, b) => a - b);

      set((s) => ({
        gameState: {
          ...s.gameState,
          dbDrivers: drivers,
          dbCalendar: calendar,
          dbTeams: teams,
          dbDriverRatings: driverRatings,
          dbDriverHistory: driverHistory,
          dbDriverOpeningState: driverOpeningState,
          dbStaffRatings: staffRatings,
          dbStaffCore: staffCore,
          dbDriverCareer: driverCareer,
          dbAchievements: achievements,
          dbTeamBrands: teamBrands,
          dbTeamEngines: teamEngines,
          dbContracts: contracts,
          dbSponsorsContracts: sponsorsContracts,
          dbRules: rules,
          dbEraSafety: eraSafety,
          dbAccidentModel: accidentModel,
          dbFacilities: facilities,
          dbCarStats: carStats,
          dbCarParts: carParts,
          dbStaffContracts: staffContracts,

          dbTyres: tyres,
          dbPointsSystems: pointsSystems,
          dbQualifyingRules: qualifyingRulesRawDb,
          dbQualifyingRuleOverrides: qualifyingRuleOverrides,
          dbPenaltiesRules: penaltiesRules,
          dbFinancialRules: financialRules,
          dbBoardGoals: boardGoals,
          dbAgendaBlocks: agendaBlocks,
          dbLogosIndex: logosIndex,
          dbAIDifficulty: aiDifficulty,
          dbContractRules: contractRules,
          dbYouthIntakeRules: youthIntake,
          dbScoutingZones: scoutingZones,
          dbTrackLayoutByYear: trackLayoutByYear,
          dbTeamSeasons: teamSeasons,
          dbCoreTracks: coreTracks,
          dbWeatherProfiles: weatherProfiles,
          dbWeatherStates: weatherStates,
          dbPitcrewRoster: pitcrewRoster,
          coreTracks,
          trackLayoutByYear,

          yearsAvailable,
          seasonPackIndex,
        },
      }));

      const activeY = get().gameState.activeYear || (yearsAvailable[0] ?? 1980);
      const hydrated = get().gameState;
      const hasActiveCareer = Boolean(
        hydrated?.careerMeta?.started &&
        Array.isArray(hydrated?.teams) && hydrated.teams.length &&
        Array.isArray(hydrated?.drivers) && hydrated.drivers.length
      );
      // Rehydrating db* for a lightweight save must never replace the active
      // simulated world with the historical database for the same year.
      if (!hasActiveCareer) get().applyYearFilter(activeY);

      set((s) => {
        const gs = s.gameState;
        const needsInit = !gs.currentDateISO || String(gs.currentDateISO).length < 10;
        return needsInit
          ? { gameState: { ...gs, currentDateISO: firstDayISO(activeY), currentRound: 0 } }
          : { gameState: gs };
      });

      // inbox seed mínima
      set((s) => ({
        gameState: {
          ...s.gameState,
          team: s.gameState.team ?? { name: "McLaren" },
          inbox:
            s.gameState.inbox.length > 0
              ? s.gameState.inbox
              : [
                  {
                    id: 1,
                    subject: "Tyre allocation confirmed",
                    from: "FIA",
                    tag: "FIA",
                    date: `${activeY}-01-05`,
                    body: "Tyre allocation for the next GP has been confirmed.",
                  },
                  {
                    id: 2,
                    subject: "Sponsor meeting recap",
                    from: "Commercial",
                    tag: "Sponsors",
                    date: `${activeY}-01-03`,
                    body: "Meeting with partners completed. Expect contract updates soon.",
                  },
                ],
          eventsQueue: s.gameState.eventsQueue || [],
          driverAttrLog: s.gameState.driverAttrLog || {},
        },
      }));
    } catch (err) {
      console.error("loadData() failed:", err);
    }
  },

  /** ===================== FILTRO POR ANO ===================== */
  applyYearFilter: (year, opts = {}) => {
    const prev = get().gameState;
    const y = Number(year);
    const normalizeDate = Boolean(opts.normalizeDate);

    const calendar = (prev.dbCalendar || []).filter((gp) => extractGPYear(gp) === y);
    const driverOpeningState = openingStateRowsForYear(prev.dbDriverOpeningState || [], y);
    const hasOpeningState = driverOpeningState.length > 0;
    const openingByDriver = new Map(
      driverOpeningState.map((row) => [openingDriverId(row), row]).filter(([id]) => id)
    );

    const contractsExact = filterByYear(prev.dbContracts, y);
    const contractsRange = filterByYearRange(prev.dbContracts, y);
    const contractKey = (row) => [
      String(pick(row, ["driver_id","person_id","id"], "")),
      String(pick(row, ["team_id","team","constructor_id","constructor"], "")),
      String(pick(row, ["role","position","contract_role"], "")),
    ].join("|");
    const contractsMap = new Map();
    for (const row of [...contractsRange, ...contractsExact]) contractsMap.set(contractKey(row), row);
    const historicalContracts = [...contractsMap.values()];
    const historicalByDriverTeam = new Map(
      historicalContracts.map((row) => [[
        String(pick(row, ["driver_id","person_id","id"], "")),
        String(pick(row, ["team_id","team","constructor_id","constructor"], "")),
      ].join("|"), row])
    );

    const contracts = hasOpeningState
      ? driverOpeningState
          .filter(openingStateIsTeamCommitment)
          .map((opening) => {
            const did = openingDriverId(opening);
            const tid = openingTeamId(opening);
            if (!did || !tid) return null;
            const base = historicalByDriverTeam.get([did, tid].join("|")) || {};
            const rawRole = String(pick(opening, ["opening_role"], pick(base, ["role","position","contract_role"], "")) || "");
            const role = openingStateIsRaceSeat(opening)
              ? (/second/i.test(rawRole) ? "Second Driver" : (/main|first|lead/i.test(rawRole) ? "Main Driver" : "Race Driver"))
              : (rawRole || "Driver");
            return {
              ...base,
              year: y,
              team_id: tid,
              team_name: pick(opening, ["opening_team_name"], pick(base, ["team_name"], tid)),
              driver_id: did,
              driver_name: pick(opening, ["display_name"], pick(base, ["driver_name","name"], did)),
              role,
              status: "active",
              contract_start_year: Number(pick(base, ["contract_start_year","contract_start","start_year"], y)) || y,
              contract_until_year: Number(pick(base, ["contract_until_year","contract_until","end_year"], y)) || y,
              opening_state_seed: true,
              synthetic: false,
              source: "driver_opening_state",
              opening_world_status: pick(opening, ["opening_world_status"], null),
              opening_availability: pick(opening, ["opening_availability"], null),
            };
          })
          .filter(Boolean)
      : historicalContracts;

    const teamsAll = prev.dbTeams || [];
    let teams = teamsAll.filter((t) => contracts.some((c) => sameTeam(c, t)));
    if (teams.length === 0) {
      teams = teamsAll.filter((t) => activeInYear(t, y));
    }
    teams = teams.map(normalizeTeam);

    const driverIdsFromContracts = new Set(
      (contracts || [])
        .filter((c) => /driver/i.test(String(pick(c, ["role", "position", "contract_role"], ""))))
        .map((c) => String(unexcel(pick(c, ["driver_id", "person_id", "id"])))).filter(Boolean)
    );

    const careerRowsThisYear = filterByYear(prev.dbDriverCareer || [], y);
    const lowerSeriesRows = careerRowsThisYear.filter(
      (row) => String(pick(row, ["series_division", "division", "series"], "")).toUpperCase() !== "F1"
    );
    const lowerSeriesIds = new Set(
      lowerSeriesRows
        .map((row) => String(pick(row, ["driver_id", "person_id", "id"], "")))
        .filter(Boolean)
    );
    const lowerSeriesById = new Map();
    for (const row of lowerSeriesRows) {
      const id = String(pick(row, ["driver_id","person_id","id"], ""));
      if (id && !lowerSeriesById.has(id)) lowerSeriesById.set(id,row);
    }

    const youthRule = filterByYearRange(prev.dbYouthIntakeRules || [], y)[0] || {};
    const youthMinAge = Number(pick(youthRule, ["min_age"], 16));
    const youthMaxAge = Number(pick(youthRule, ["max_age"], 19));

    const openingDriverIds = new Set(driverOpeningState.map(openingDriverId).filter(Boolean));
    const driverPool = hasOpeningState
      ? (prev.dbDrivers || []).filter((d) => openingDriverIds.has(String(d.driver_id ?? d.id ?? d.code ?? "")))
      : (prev.dbDrivers || []);

    const driversWithStatus = driverPool.map((d) => {
      const first = d.first_name ?? d.firstname ?? d.given_name ?? d.forename ?? d.first ?? "";
      const last = d.last_name ?? d.lastname ?? d.family_name ?? d.surname ?? d.last ?? "";
      const combo = `${first} ${last}`.trim();
      const display_name = d.driver_name || d.name || d.display_name || d.full_name || d.fullname || combo || d.code || "";
      const driverId = String(d.driver_id ?? d.id ?? d.code ?? "");
      const age = ageOnYear(d.dob ?? d.date_of_birth, y);
      const openingRow = openingByDriver.get(driverId) || null;
      if (hasOpeningState) {
        if (!openingRow || openingStateExcluded(openingRow)) return null;
        return applyOpeningStateToDriver({
          ...d,
          driver_id: driverId || null,
          display_name,
          name: display_name || d.name || "",
          country: d.country_name ?? d.country ?? "",
          country_code: d.country_code ?? d.nationality_code ?? "",
          dob: d.dob ?? d.date_of_birth ?? "",
          prefered_number: d.prefered_number ?? d.number ?? "",
          portrait_path: d.portrait_path ?? d.portrait ?? "",
          helmet_color_primary: d.helmet_color_primary ?? "",
          helmet_color_secondary: d.helmet_color_secondary ?? "",
          age,
        }, openingRow, y, { youthMinAge, youthMaxAge });
      }

      const baseStatus = computeDriverStatus(y, d);
      const hasF1Contract = driverIdsFromContracts.has(driverId);
      const careerStart = d.career_start_year == null || d.career_start_year === ""
        ? NaN
        : Number(d.career_start_year);
      const f1Debut = d.f1_rookie_season == null || d.f1_rookie_season === ""
        ? NaN
        : Number(d.f1_rookie_season);
      const explicitPreF1Active =
        Number.isFinite(careerStart) &&
        careerStart <= y &&
        Number.isFinite(f1Debut) &&
        y < f1Debut;
      // Older records often omit career_start_year. In that case, infer a
      // conservative feeder-series window only shortly before the F1 debut.
      const inferredFromDebut =
        !Number.isFinite(careerStart) &&
        Number.isFinite(f1Debut) &&
        y < f1Debut &&
        (f1Debut - y) <= 3 &&
        Number.isFinite(age) &&
        age >= 16;
      const inferredPreF1Active = explicitPreF1Active || inferredFromDebut;
      const inLowerSeries = lowerSeriesIds.has(driverId) || inferredPreF1Active;
      const lowerSeriesRow = lowerSeriesById.get(driverId) || null;

      let status = baseStatus;
      if (hasF1Contract && baseStatus !== "deceased" && baseStatus !== "hidden") {
        status = "eligible";
      } else if (inLowerSeries && !hasF1Contract && !["deceased","retired","hidden"].includes(baseStatus)) {
        status = "lower_series";
      } else if (baseStatus === "pre_f1") {
        status = inferredPreF1Active ? "lower_series" : "hidden";
      }

      const isYouth =
        inLowerSeries &&
        Number.isFinite(age) &&
        age >= youthMinAge &&
        age <= youthMaxAge;
      const canHireAcademy = isYouth && !hasF1Contract;
      if (canHireAcademy) status = "junior_only";

      const canHireF1 =
        status === "eligible" ||
        ((status === "lower_series" || status === "junior_only") && Number.isFinite(age) && age >= 18);

      return {
        ...d,
        driver_id: driverId || null,
        display_name,
        name: display_name || d.name || "",
        country: d.country_name ?? d.country ?? "",
        country_code: d.country_code ?? d.nationality_code ?? "",
        dob: d.dob ?? d.date_of_birth ?? "",
        prefered_number: d.prefered_number ?? d.number ?? "",
        portrait_path: d.portrait_path ?? d.portrait ?? "",
        helmet_color_primary: d.helmet_color_primary ?? "",
        helmet_color_secondary: d.helmet_color_secondary ?? "",
        status,
        age,
        active_lower_series: inLowerSeries,
        lower_series_name: pick(lowerSeriesRow || {}, ["series_division","division","series"], inferredPreF1Active ? "Lower Series" : ""),
        youth_eligible: isYouth,
        canHireF1,
        canHireAcademy,
      };
    });

    const drivers = driversWithStatus.filter(
      (d) =>
        d &&
        (hasOpeningState
          ? ["eligible", "lower_series", "junior_only", "retired"].includes(d.status)
          : ["eligible", "lower_series", "junior_only"].includes(d.status)) &&
        d.driver_id &&
        (d.display_name || d.name)
    );

    const driverRatingsExact = filterByYear(prev.dbDriverRatings, y);
    const staffRatingsExact  = filterByYear(prev.dbStaffRatings, y);
    const driverRatings = driverRatingsExact.length ? driverRatingsExact : filterByYearRange(prev.dbDriverRatings, y);

    const staffRatingMap = new Map();
    const staffRatingCandidates = (prev.dbStaffRatings || [])
      .filter((row) => {
        const ry = Number(getYearNumber(row));
        return Number.isFinite(ry) && ry <= y && (y - ry) <= 5;
      })
      .sort((a,b) => Number(getYearNumber(a)) - Number(getYearNumber(b)));
    for (const row of staffRatingCandidates) {
      const id = String(pick(row, ["staff_id","person_id","id"], ""));
      if (id) staffRatingMap.set(id,row);
    }
    for (const row of staffRatingsExact) {
      const id = String(pick(row, ["staff_id","person_id","id"], ""));
      if (id) staffRatingMap.set(id,row);
    }
    const staffRatings = [...staffRatingMap.values()];
    const staffCore = (prev.dbStaffCore || []).filter((s) => {
      const born = yearFrom(pick(s, ["dob", "birthdate"], null));
      const died = yearFrom(pick(s, ["death_date"], null));
      return (!Number.isFinite(born) || born <= y) && (!Number.isFinite(died) || died >= y);
    });

    const teamBrandsExact = filterByYear(prev.dbTeamBrands, y);
    const teamBrands = teamBrandsExact.length ? teamBrandsExact : filterByYearRange(prev.dbTeamBrands, y);

    const teamEnginesExact = filterByYear(prev.dbTeamEngines, y);
    let teamEngines = teamEnginesExact.length ? teamEnginesExact : filterByYearRange(prev.dbTeamEngines, y);
    const teamSet = new Set(teams.map((t) => getTeamId(t)));
    teamEngines = teamEngines.filter((e) => {
      const tid = String(pick(e, ["team_id","team","constructor"]));
      return teams.some((t) => sameTeam(e, t)) || teamSet.has(tid);
    });

    const facilitiesExact = filterByYear(prev.dbFacilities, y);
    const facilities = facilitiesExact.length ? facilitiesExact : filterByYearRange(prev.dbFacilities, y);

    const carStatsExact = filterByYear(prev.dbCarStats || [], y);
    const carStats = carStatsExact.length ? carStatsExact : filterByYearRange(prev.dbCarStats || [], y);

    const staffContractsExact = filterByYear(prev.dbStaffContracts || [], y);
    const staffContractsRange = filterByYearRange(prev.dbStaffContracts || [], y);
    const staffContractMap = new Map();
    for (const row of [...staffContractsRange, ...staffContractsExact]) {
      const key = [
        String(pick(row, ["staff_id","person_id","id"], "")),
        String(pick(row, ["team_id","team","constructor_id","constructor"], "")),
        String(pick(row, ["role","position"], "")),
      ].join("|");
      staffContractMap.set(key,row);
    }
    const staffContracts = [...staffContractMap.values()];

    const sponsorsExact = filterByYear(prev.dbSponsorsContracts, y);
    const sponsorsContracts = sponsorsExact.length ? sponsorsExact : filterByYearRange(prev.dbSponsorsContracts, y);

    const rulesExact = filterByYear(prev.dbRules, y);
    const rulesRanged = filterByYearRange(prev.dbRules, y);
    const rules = rulesExact.length ? rulesExact : rulesRanged;

    const eraSafetyExact = filterByYear(prev.dbEraSafety, y);
    const eraSafetyRanged = filterByYearRange(prev.dbEraSafety, y);
    const eraSafety = eraSafetyExact.length ? eraSafetyExact : eraSafetyRanged;

    let accidentModel = prev.dbAccidentModel;
    if (Array.isArray(prev.dbAccidentModel)) {
      const accExact = filterByYear(prev.dbAccidentModel, y);
      const accRange = filterByYearRange(prev.dbAccidentModel, y);
      accidentModel = accExact.length ? accExact : (accRange.length ? accRange : prev.dbAccidentModel);
    }

    const tyres = filterByYear(prev.dbTyres, y).length
      ? filterByYear(prev.dbTyres, y)
      : filterByYearRange(prev.dbTyres, y);

    const pointsSystemRec = (() => {
      const exact = filterByYear(prev.dbPointsSystems, y);
      if (exact.length) return exact[0];
      const ranged = filterByYearRange(prev.dbPointsSystems, y);
      return ranged.length ? ranged[0] : null;
    })();

    const qualifyingRules = qualifyingRulesForYear(prev.dbQualifyingRules,prev.dbQualifyingRuleOverrides,y);

    const penaltiesRules = filterByYear(prev.dbPenaltiesRules, y).length
      ? filterByYear(prev.dbPenaltiesRules, y)
      : filterByYearRange(prev.dbPenaltiesRules, y);

    const financialRules = filterByYear(prev.dbFinancialRules, y).length
      ? filterByYear(prev.dbFinancialRules, y)
      : filterByYearRange(prev.dbFinancialRules, y);

    const agendaBlocks = filterByYear(prev.dbAgendaBlocks, y).length
      ? filterByYear(prev.dbAgendaBlocks, y)
      : filterByYearRange(prev.dbAgendaBlocks, y);

    const nextState = {
      ...prev,
      activeYear: y,
      calendar,
      teams,
      drivers,
      driverRatings,
      driverOpeningState,
      staffRatings,
      staffCore,
      teamBrands,
      teamEngines,
      contracts,
      facilities,
      carStats,
      staffContracts,
      sponsorsContracts,
      rules,
      eraSafety,
      accidentModel,

      tyres,
      pointsSystem: pointsSystemRec,
      qualifyingRules,
      penaltiesRules,
      financialRules,
      agendaBlocks,
    };

    if (normalizeDate) {
      nextState.currentDateISO = firstDayISO(y);
      nextState.currentRound = 0;
    } else if (!nextState.currentDateISO || String(nextState.currentDateISO).length < 10) {
      nextState.currentDateISO = firstDayISO(y);
      nextState.currentRound = 0;
    }

    set(() => ({ gameState: nextState }));
  },

  /** ===================== UTIL DE EQUIPA ===================== */
  getTeamDisplayName: (team) => {
    const st = get().gameState;
    const brands = st.teamBrands?.length ? st.teamBrands : st.dbTeamBrands || [];
    const rec =
      (brands || []).find((b) => {
        const recId = pick(b, ["team_id", "team", "constructor_id", "constructor", "name", "team_name", "short_name"]);
        if (recId != null && getTeamId(team) === String(recId)) return true;
        const rn = pick(b, ["team_name", "constructor", "name", "team", "short_name"]);
        const tn = pick(team, ["name", "team_name", "short_name"]);
        return rn && tn && canon(rn) === canon(tn);
      }) || null;

    const brandName = pick(rec, ["official_name", "team_name", "name", "short_name"], null);
    const teamFallback = pick(team, ["official_name", "team_name", "name", "short_name"], getTeamId(team));
    return brandName ?? teamFallback;
  },

  getTeamLogoCandidates: (team) => {
    const st = get().gameState;
    const id = getTeamId(team);
    const year = st.activeYear || 1980;

    const viaIndex = (st.dbLogosIndex || []).filter((r) => {
      const tid = String(pick(r, ["team_id","id"]));
      const from = Number(pick(r, ["year_from","from"], -Infinity));
      const to   = Number(pick(r, ["year_to","to"], Infinity));
      return tid === String(id) && year >= from && year <= (isNaN(to) ? Infinity : to);
    }).map((r) => String(pick(r, ["path_rel","path","logo_path"])).replace(/^\/+/, "")).filter(Boolean);

    const short = (team.short_name || team.team_name || team.name || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    const cands = [...viaIndex, `logos/teams/${id}.png`];
    if (short && short !== id.toLowerCase()) cands.push(`logos/teams/${short}.png`);
    const base = (import.meta?.env?.BASE_URL ?? "/").replace(/\/+$/, "");
    return Array.from(new Set(cands.filter(Boolean)))
      .map((rel) => `${base}/${String(rel).replace(/^\/+/, "")}`);
  },

  /** ===================== NEW GAME ===================== */
  startNewGame: (cfg) => {
    const { year, team, difficulty } = cfg;
    const y = Number(year);
    if (Number(get().gameState?.seasonPackMeta?.year) !== y) {
      get().applyYearFilter(y, { normalizeDate: true });
    }

    const teamId = getTeamId(team || {});
    const db = get().gameState;
    const startingBudget = computeStartingBudget(db, teamId, y);
    const initialDriverConditions = Object.fromEntries(
      (db.drivers || []).map((d) => [String(d?.driver_id ?? d?.id ?? ""), defaultDriverCondition()]).filter(([id]) => id)
    );

    let fresh = buildFreshCareerState(db, {
      currentDateISO: firstDayISO(y),
      currentRound: 0,
      activeYear: y,
      team: team ? { ...team, budget: startingBudget } : null,
      careerMeta: createCareerMeta(db, y),
      saveMeta: createNewSaveMeta({ year: y, teamId }),
      settings: db?.settings ?? defaultSettings,
      inbox: [{
        id: `welcome_${y}_${teamId || "team"}`,
        subject: "Welcome to the paddock",
        from: "FIA",
        tag: "FIA",
        date: `${y}-01-02`,
        body: `Difficulty set to ${difficulty}. Good luck!`,
      }],
      driverAttributes: initialDriverConditions,
      finances: {
        budget: startingBudget,
        balance: startingBudget,
        weekly_burn: 0,
        season_spend: 0,
        season_income: 0,
      },
    });

    // A fresh career starts with newly-created physical cars and pristine
    // standard components. No garage/wear state may come from the old career.
    fresh = { ...fresh, garage: syncGarageState(fresh, fresh.garage) };

    set({ gameState: fresh, currentSaveKey: null });
  },

  startNewGameFromCreateTeam: (payload) => {
    try {
      const { year, team, drivers, difficulty } = payload;
      const y = Number(year);
      if (Number(get().gameState?.seasonPackMeta?.year) !== y) {
        get().applyYearFilter(y, { normalizeDate: true });
      }

      const teamId = getTeamId(team || {});
      const db = get().gameState;
      const startingBudget = computeStartingBudget(db, teamId, y);
      const initialDriverConditions = Object.fromEntries(
        (db.drivers || []).map((d) => [String(d?.driver_id ?? d?.id ?? ""), defaultDriverCondition()]).filter(([id]) => id)
      );

      const userTeam = {
        team_id: team.team_id,
        name: team.name,
        short_name: team.short_name,
        colors: team.colors,
        engine_id: team.engine_id,
        budget: startingBudget,
        logo_data_url: team.logo_data_url ?? null,
        logo_file_name: team.logo_file_name ?? null,
        is_user_controlled: true,
      };

      let fresh = buildFreshCareerState(db, {
        currentDateISO: firstDayISO(y),
        currentRound: 0,
        activeYear: y,
        careerMeta: createCareerMeta(db, y),
        saveMeta: createNewSaveMeta({ year: y, teamId }),
        team: userTeam,
        selectedDrivers: Array.isArray(drivers) ? drivers : [],
        settings: db?.settings ?? defaultSettings,
        inbox: [
          {
            id: `welcome_${y}_${teamId || "team"}`,
            subject: "Welcome to the paddock",
            from: "FIA",
            tag: "FIA",
            date: `${y}-01-02`,
            body: `Your entry has been accepted for the ${y} World Championship.`,
          },
          {
            id: `supplier_${y}_${teamId || "team"}`,
            subject: "Supplier contract signed",
            from: "Commercial",
            tag: "Suppliers",
            date: `${y}-01-03`,
            body: `Engine supply confirmed for ${team.short_name}.`,
          },
        ],
        driverAttributes: initialDriverConditions,
        finances: {
          budget: startingBudget,
          balance: startingBudget,
          weekly_burn: 0,
          season_spend: 0,
          season_income: 0,
        },
      });

      // Create Team may not yet have canonical driver contracts, so keep the
      // garage fresh and let the normal roster sync assign seats once available.
      fresh = { ...fresh, garage: syncGarageState(fresh, fresh.garage) };

      set({ gameState: fresh, currentSaveKey: null });
      get().saveLocal?.();
      return true;
    } catch (e) {
      console.error("startNewGameFromCreateTeam() failed:", e);
      return false;
    }
  },

  /** ===================== SAVE / LOAD ===================== */
  saveLocal: () => {
    try {
      const state = get().gameState;
      const light = makeLightSnapshot(state);
      // SAVE_KEY is the rolling "Continue" snapshot. It must not create a
      // visible/manual save slot every time a new career starts or autosaves.
      return setRollingSnapshot( JSON.stringify(light));
    } catch (e) {
      console.error("saveLocal() failed:", e);
      return false;
    }
  },

  loadLocal: () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const saved = extractGameStateFromStoredSave(JSON.parse(raw));
      set({ gameState: hydrateLoadedGameState(saved), currentSaveKey: null });
      return true;
    } catch (e) {
      console.error("loadLocal() failed:", e);
      return false;
    }
  },

  hasAnySave: () => {
    try {
      if (localStorage.getItem(SAVE_KEY)) return true;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(SAVE_PREFIX)) return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  loadLastPlayed: () => {
    if (get().loadLocal()) return true;
    try {
      const remembered = localStorage.getItem(LAST_SAVE_KEY);
      if (remembered && get().loadFromKey(remembered)) return true;
      const latest = latestManualSaveKey();
      return latest ? Boolean(get().loadFromKey(latest)) : false;
    } catch (e) {
      console.error("loadLastPlayed() failed:", e);
      return false;
    }
  },

  getLastSaveMeta: () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return { slot: 1, dateISO: parsed.currentDateISO ?? "1980-01-01" };
    } catch {
      return null;
    }
  },

  loadGame: (gs) => {
    if (!gs || typeof gs !== "object") return null;
    const migrated = extractGameStateFromStoredSave(gs);
    set({ gameState: hydrateLoadedGameState(migrated), currentSaveKey: null });
    return migrated;
  },

  saveGame: (options) => {
    if (__savingMutex) return __lastSaveResult;
    __savingMutex = true;
    try {
      const state = get();
      const gs = state.gameState || {};
      const light = makeLightSnapshot(gs);

      const nameIn = options?.name;
      const overwriteKeyIn = options?.overwriteKey;
      const meta = { name: (nameIn || "").trim() || defaultSaveName(gs), version: GAME_VERSION, schemaVersion: SAVE_SCHEMA_VERSION, gameVersion: GAME_VERSION, seed: light.saveMeta?.seed ?? null, savedAt: nowIso() };
      const payload = { meta, gameState: light };

      const now = Date.now();
      const h = hash32(stableStringify({ k: overwriteKeyIn, n: meta.name, d: gs.currentDateISO, r: gs.currentRound }));
      if (__lastSaveHash === h && now - __lastSaveTs < DEDUPE_WINDOW_MS) {
        __savingMutex = false;
        return __lastSaveResult;
      }

      // Save As / Save to slot always create a new manual save unless the
      // caller explicitly supplies overwriteKey. This avoids overwriting a
      // previous career just because it happened to be the last save used.
      const key = overwriteKeyIn || `${SAVE_PREFIX}${now}`;

      let persisted = false;
      let continueSnapshotOk = false;
      let errorMessage = null;
      // Reclaim the obsolete duplicate Race Weekend autosave before a manual
      // save attempts quota eviction.
      cleanupLegacyAutosaveDuplicate();
      try {
        persisted = setItemQuotaSafe(key, JSON.stringify(payload));
        if (persisted) {
          localStorage.setItem(LAST_SAVE_KEY, key);
          // Keep Continue in sync with the most recently saved career.
          continueSnapshotOk = setRollingSnapshot( JSON.stringify(light));
          set({ currentSaveKey: key });
        } else {
          errorMessage = "Browser storage is full. The save was not written.";
          console.warn("saveGame: quota still exceeded after eviction.");
        }
      } catch (e) {
        errorMessage = String(e?.message || e || "Save failed.");
        console.warn("saveGame (multi) failed:", e);
      }

      __lastSaveHash = h;
      __lastSaveTs = now;
      __lastSaveResult = persisted
        ? { ok: true, key, meta, continueSnapshotOk }
        : { ok: false, key: null, meta, error: errorMessage || "Save failed." };
      return __lastSaveResult;
    } finally {
      setTimeout(() => { __savingMutex = false; }, 0);
    }
  },

  quickSave: () => {
    const gs = get().gameState || {};
    const base = defaultSaveName(gs);
    const hhmm = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const overwrite = get().currentSaveKey;
    return get().saveGame({ name: `${base} — ${hhmm}`, overwriteKey: overwrite || undefined });
  },

  getLastSaveKey: () => {
    try { return localStorage.getItem(LAST_SAVE_KEY); } catch { return null; }
  },

  loadFromKey: (key) => {
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = safeJSONParse(raw);
      if (!obj || typeof obj !== "object") return null;
      const gs = extractGameStateFromStoredSave(obj);
      if (gs && typeof gs === "object") {
        set({ gameState: hydrateLoadedGameState(gs), currentSaveKey: key });
        try {
          localStorage.setItem(LAST_SAVE_KEY, key);
          // Loading a manual/imported save must also become the active Continue
          // snapshot, otherwise Continue can reopen a different career.
          setRollingSnapshot( JSON.stringify(makeLightSnapshot(gs)));
        } catch {}
        return gs;
      }
    } catch (e) {
      console.warn("loadFromKey failed:", e);
    }
    return null;
  },

  // ====== Queue de eventos (ex.: ações de piloto) ======
  queueEvent: (ev) => {
    const getS = get;
    const setS = set;

    const gs = getS().gameState;
    const today = (gs?.currentDateISO || new Date().toISOString()).slice(0,10);

    const scheduled = {
      id: ev.id || `ev_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      type: ev.type || "driver_action",
      title: ev.title || "Action",
      participants: Array.isArray(ev.participants) ? ev.participants : (ev.participants ? [ev.participants] : []),
      meta: ev.meta || {},
      effects: Array.isArray(ev.effects) ? ev.effects : [],
      dateISO: ev.dateISO || addDaysISO(today, 1),
      done: false,
    };

    const queue = Array.isArray(gs.eventsQueue) ? gs.eventsQueue.slice() : [];
    queue.push(scheduled);

    setS((state) => ({
      gameState: {
        ...state.gameState,
        eventsQueue: queue,
      }
    }));

    const who = scheduled?.meta?.driverName || "";
    getS().pushToast({
      title: "Action scheduled for tomorrow",
      description: `${scheduled.title}${who ? ` • ${who}` : ""} → ${scheduled.dateISO}`,
      type: "success",
      ttl: 2600,
    });
  },

  /** ===================== RACE WEEKEND ACTIONS ===================== */
  setRaceWeekendPracticeProgramme: async (driverId,programmeId) => {
    const gs=get().gameState;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.setPracticeProgramme(gs,{driverId,programmeId});
    set({gameState:next});
    checkpointRaceWeekendState(next);
    return next?.raceWeekendState||null;
  },

  setRaceWeekendStrategy: async (driverId,patch) => {
    const gs=get().gameState;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.setRaceStrategy(gs,{driverId,patch});
    set({gameState:next});
    checkpointRaceWeekendState(next);
    return next?.raceWeekendState?.race_strategy||null;
  },

  completeRaceWeekendPractice: async () => {
    const gs=get().gameState;
    const weekend=gs?.raceWeekendState;
    const gp=gs?.calendar?.[Number(weekend?.roundIndex)||0]||null;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.completePracticeSession(gs,{gp});
    set({gameState:next});
    try {
      if(next?.settings?.autosave!==false){
        const light=makeLightSnapshot(next);
        localStorage.setItem("f1ml.autosave",JSON.stringify({gameState:light,ts:Date.now()}));
        setRollingSnapshot(JSON.stringify(light));
      }
    } catch {}
    return next?.raceWeekendState||null;
  },

  completeRaceWeekendQualifying: async () => {
    const gs=get().gameState;
    const weekend=gs?.raceWeekendState;
    if(!weekend)return null;
    const gp=gs?.calendar?.[Number(weekend.roundIndex)||0]||null;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.completeQualifyingSession(gs,{gp});
    set({gameState:next});
    try {
      if(next?.settings?.autosave!==false){
        const light=makeLightSnapshot(next);
        localStorage.setItem("f1ml.autosave",JSON.stringify({gameState:light,ts:Date.now()}));
        setRollingSnapshot(JSON.stringify(light));
      }
    } catch {}
    return next?.raceWeekendState||null;
  },

  startRaceWeekendLiveRace: async () => {
    const gs=get().gameState;
    const weekend=gs?.raceWeekendState;
    if(!weekend)return null;
    const gp=gs?.calendar?.[Number(weekend.roundIndex)||0]||null;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.startLiveRace(gs,{gp});
    set({gameState:next});
    checkpointRaceWeekendState(next);
    return next?.raceWeekendState?.live_race||null;
  },

  advanceRaceWeekendLiveRace: async (laps=1) => {
    const gs=get().gameState;
    const weekend=gs?.raceWeekendState;
    if(!weekend)return null;
    const gp=gs?.calendar?.[Number(weekend.roundIndex)||0]||null;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.advanceLiveRaceSession(gs,{gp,laps});
    set({gameState:next});
    checkpointRaceWeekendState(next);
    return next?.raceWeekendState?.live_race||null;
  },

  advanceRaceWeekendLiveRaceSector: async (sectors=1) => {
    const gs=get().gameState;
    const weekend=gs?.raceWeekendState;
    if(!weekend)return null;
    const gp=gs?.calendar?.[Number(weekend.roundIndex)||0]||null;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.advanceLiveRaceSectorSession(gs,{gp,sectors});
    set({gameState:next});
    checkpointRaceWeekendState(next);
    return next?.raceWeekendState?.live_race||null;
  },

  setRaceWeekendLiveCommand: async (command) => {
    const gs=get().gameState;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.setLiveRaceCommand(gs,command||{});
    set({gameState:next});
    checkpointRaceWeekendState(next);
    return next?.raceWeekendState?.live_race||null;
  },

  cancelRaceWeekendLiveCommand: async (command={}) => {
    const gs=get().gameState;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.cancelLiveRaceOrder(gs,command);
    set({gameState:next});
    checkpointRaceWeekendState(next);
    return next?.raceWeekendState?.live_race||null;
  },

  resumeRaceWeekendLiveRace: async () => {
    const gs=get().gameState;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=mod.resumeLiveRaceSession(gs);
    set({gameState:next});
    checkpointRaceWeekendState(next);
    return next?.raceWeekendState?.live_race||null;
  },

  completeRaceWeekendRace: async () => {
    const gs=get().gameState;
    const weekend=gs?.raceWeekendState;
    if(!weekend)return null;
    const gp=gs?.calendar?.[Number(weekend.roundIndex)||0]||null;
    const mod=await import("@/engine/RaceWeekendEngine");
    const next=await mod.completeRaceSession(gs,{gp});
    set({gameState:next});
    try {
      if(next?.settings?.autosave!==false){
        const light=makeLightSnapshot(next);
        localStorage.setItem("f1ml.autosave",JSON.stringify({gameState:light,ts:Date.now()}));
        setRollingSnapshot(JSON.stringify(light));
      }
    } catch {}
    return next?.raceWeekendState||null;
  },

  continueRaceWeekendSession: async () => {
    const mod=await import("@/engine/RaceWeekendEngine");
    let gs=get().gameState;
    if(!gs?.raceWeekendState)return null;

    let next=mod.continueRaceWeekendSession(gs);
    if(next!==gs){
      set({gameState:next});
      checkpointRaceWeekendState(next);
      return {
        oldDate:clampISO(gs.currentDateISO),
        newDate:clampISO(next.currentDateISO),
        roundChanged:false,
        round:next.currentRound??0,
        breakReason:"race_weekend",
        raceWeekendPhase:next.raceWeekendState?.phase,
        sameDay:true,
      };
    }

    const advanced=await get().advanceOneDayUntilBreak();
    gs=get().gameState;
    next=mod.continueRaceWeekendSession(gs);
    if(next!==gs){
      set({gameState:next});
      return {
        ...(advanced||{}),
        breakReason:"race_weekend",
        raceWeekendPhase:next.raceWeekendState?.phase,
      };
    }
    return advanced;
  },

  /** ===================== AVANÇAR ATÉ BREAK ===================== */
  advanceOneDayUntilBreak: async () => {
    let s=get().gameState;
    if(!s)return {oldDate:null,newDate:null,roundChanged:false,round:0};

    const currentWeekend=s?.raceWeekendState;
    if(currentWeekend&&["practice","qualifying","race"].includes(String(currentWeekend.phase))){
      return {
        oldDate:clampISO(s.currentDateISO),
        newDate:clampISO(s.currentDateISO),
        roundChanged:false,
        round:s.currentRound??0,
        breakReason:"race_weekend",
        raceWeekendPhase:currentWeekend.phase,
      };
    }

    const baseISO=clampISO(s.currentDateISO||firstDayISO(s.activeYear||1980));
    const newISO=addDaysISO(baseISO,1);
    const round=s.currentRound??0;
    const nextGP=s.calendar?.[round]??null;
    const nextISO=gpDateISO(nextGP);

    let roundChanged=false;
    let newRound=round;

    if(nextISO){
      const tNew=parseISO(newISO).getTime();
      const tNext=parseISO(nextISO).getTime();
      if(isFinite(tNew)&&isFinite(tNext)&&tNew>tNext){
        const lastIdx=Math.max(0,(s.calendar?.length||1)-1);
        newRound=Math.min(round+1,lastIdx);
        roundChanged=newRound!==round;
      }
    }

    let updated={...s,currentDateISO:newISO,currentRound:newRound};
    const nextCalendarYear=Number(String(newISO).slice(0,4));
    if(Number.isInteger(nextCalendarYear)&&nextCalendarYear>Number(s.activeYear||0)){
      updated=rolloverSeasonPure(s,nextCalendarYear);
      newRound=0;
      roundChanged=true;
    }

    try {
      const res=triggerDailyTick(updated);
      const {state:next1,patched,changes,attrChanges}=res||{};
      updated=next1||patched||res||updated;
      updated=processScoutingTick(updated);
      updated=refreshDriverAvailability(updated,updated.currentDateISO);
      updated=processWorkshopJobs(updated);
      updated=processTechnologyAdoption(updated);
      updated=tickAITechnicalWorld(updated);
      updated=processTechnologyDiscoveryNews(updated);
      const ch=changes||attrChanges||[];
      if(Array.isArray(ch)&&ch.length&&typeof applyAttrChangesDict==="function"){
        updated={...updated,driverAttrLog:applyAttrChangesDict(updated.driverAttrLog,ch)};
      }
    } catch(e){
      console.warn("[EventEngine] daily tick failed:",e);
    }

    try { const mod=await import("@/engine/RuleEngine"); if(typeof mod.applyRulesTick==="function") updated=mod.applyRulesTick(updated)||updated; } catch {}
    try { const mod=await import("@/engine/ProgressionEngine"); if(typeof mod.applyProgressionTick==="function") updated=mod.applyProgressionTick(updated)||updated; } catch {}
    try { const mod=await import("@/engine/EconomyEngine"); if(typeof mod.applyEconomyTick==="function") updated=mod.applyEconomyTick(updated)||updated; } catch {}
    try { const mod=await import("@/engine/MarketEngine"); if(typeof mod.applyMarketTick==="function") updated=mod.applyMarketTick(updated)||updated; } catch {}
    try { const mod=await import("@/engine/NegotiationEngine"); if(typeof mod.processDriverNegotiations==="function") updated=mod.processDriverNegotiations(updated)||updated; } catch {}
    try { const mod=await import("@/engine/InboxEngine"); if(typeof mod.syncInbox==="function") updated=mod.syncInbox(updated)||updated; } catch {}

    let weekendBreak=null;
    try {
      const mod=await import("@/engine/RaceWeekendEngine");
      updated=mod.syncRaceWeekendPhaseForDate(updated,updated.currentDateISO);

      const roundNow=updated.currentRound??0;
      const gp=updated.calendar?.[roundNow]??null;
      if(mod.shouldCreateWeekendForDate(updated,{roundIndex:roundNow,gp,dateISO:updated.currentDateISO})){
        updated=mod.createRaceWeekendState(updated,{roundIndex:roundNow,gp});
      }
      const phase=String(updated?.raceWeekendState?.phase||"");
      if(["practice","qualifying","race"].includes(phase)){
        weekendBreak={breakReason:"race_weekend",raceWeekendPhase:phase};
      }
    } catch(e){
      console.warn("[RaceWeekend] state sync failed:",e);
    }

    set({gameState:updated});

    try {
      const gs=get().gameState||updated||{};
      const lastIdx=Math.max(0,(gs.calendar?.length||1)-1);
      const lastRaceISO=gpDateISO(gs.calendar?.[lastIdx]);
      const todayISO=clampISO(gs.currentDateISO);
      const yearNow=gs.activeYear||gs.seasonYear||gs.season||null;
      const canTrigger=lastRaceISO&&todayISO>lastRaceISO&&gs._seasonFinishedAt!==yearNow;
      if(canTrigger){
        set({gameState:{...gs,_seasonFinishedAt:yearNow,showSeasonSummary:true}});
        updated=get().gameState;
      }
    } catch(e){
      console.warn("end-of-season check failed:",e);
    }

    try {
      if(updated?.settings?.autosave!==false){
        const light=makeLightSnapshot(updated);
        localStorage.setItem("f1ml.autosave",JSON.stringify({gameState:light,ts:Date.now()}));
        setRollingSnapshot(JSON.stringify(light));
      }
    } catch {}

    return {
      oldDate:baseISO,
      newDate:newISO,
      roundChanged,
      round:newRound,
      ...(weekendBreak||{}),
    };
  },

  /* ======================= SELECTORS ======================= */
  selectDriverById: (id) => {
    const s = get().gameState;
    return (s.drivers || []).find(d => String(d.driver_id) === String(id));
  },
  selectContractByDriverId: (id) => {
    const s = get().gameState;
    return (s.contracts || []).find(c =>
      String(pick(c, ["driver_id"])) === String(id) &&
      String(getYearNumber(c)) === String(s.activeYear) &&
      (c.status || "active") === "active"
    );
  },
  selectDriverStats: (id) => get().gameState.driverStats?.[id],
  selectDriverCareer: (id) => get().gameState.driverCareer?.[id] || [],
  selectDriverAttributes: (id) => {
    const dict = get().gameState.driverAttributes;
    if (dict && dict[id]) return dict[id];
    const ratings = get().gameState.driverRatings || [];
    const rec = ratings.find(r => String(r.driver_id) === String(id));
    return rec || null;
  },
  selectDriverAttrLog: (id) => {
    const s = get().gameState;
    const dict = s.driverAttrLog || {};
    const key = String(id).match(/(\d+)/)?.[1]?.padStart(4, "0") || String(id);
    return Array.isArray(dict[key]) ? dict[key] : [];
  },
  getTyresForYear: (year, category) => {
    const st = get().gameState;
    const list = filterByYear(st.dbTyres || [], year).length
      ? filterByYear(st.dbTyres || [], year)
      : filterByYearRange(st.dbTyres || [], year);
    return category ? list.filter(t => String(t.category).toLowerCase() === String(category).toLowerCase()) : list;
  },
  getPointsForYear: (year) => {
    const st = get().gameState;
    const rec = (() => {
      const ex = filterByYear(st.dbPointsSystems || [], year);
      if (ex.length) return ex[0];
      const rg = filterByYearRange(st.dbPointsSystems || [], year);
      return rg.length ? rg[0] : null;
    })();
    if (!rec) return [9,6,4,3,2,1];
    const places = Array.isArray(rec.places_csv) ? rec.places_csv : String(rec.places_csv || "").split(",").map(s => s.trim()).filter(Boolean);
    return places.map(Number).filter(n => Number.isFinite(n));
  },
  getAgendaBlocksForYear: (year) => {
    const st = get().gameState;
    const ex = filterByYear(st.dbAgendaBlocks || [], year);
    const rg = filterByYearRange(st.dbAgendaBlocks || [], year);
    return ex.length ? ex : rg;
  },
}));
