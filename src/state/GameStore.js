import { create } from "zustand";

/** Onde vamos guardar o "save" local (opcional) */
const SAVE_KEY = "f1hm_save";

/** ===== DEFAULT SETTINGS (para a página Settings.jsx) ===== */
const defaultSettings = {
  uiTheme: "auto",              // auto | light | dark
  language: "en",               // en | pt | es | fr
  dateFormat: "yyyy-MM-dd",
  autosave: true,
  autosaveIntervalMin: 10,
  notifications: true,
  audio: { masterVolume: 70, sfxVolume: 70, musicVolume: 30 },
  gameplay: {
    difficulty: "normal",       // easy | normal | hard | custom
    simSpeed: 1,                // 0.25..8
    rulesEra: "1980",
    enableInjuryRandomEvents: true,
    enableWeatherRandomness: true,
  },
  data: { datasource: "json", remoteUrl: "" },
  developer: { showDevTools: false, verboseLogs: false },
};

/** Helper para ler JSON com erro legível na consola (safe: devolve [] se falhar) */
async function fetchJsonSafe(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`fetchJsonSafe: falhou a carregar ${path}:`, e?.message || e);
    return [];
  }
}

/* =======================
   Helpers de mapeamento
   ======================= */
function pick(obj, keys, fallback = undefined) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return fallback;
}
function canon(val) {
  return String(val ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
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

/* ===== datas/idades para drivers ===== */
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

/** Estado do piloto */
function computeDriverStatus(selectedYear, driver) {
  const Y = Number(selectedYear);
  const start = Number(driver.career_start_year ?? NaN);
  const debut = Number(driver.f1_rookie_season ?? NaN);
  const retire = driver.career_end_year == null || driver.career_end_year === "" ? null : Number(driver.career_end_year);
  const deceasedYear = yearFrom(driver.death_date);

  if (!Number.isNaN(deceasedYear) && deceasedYear <= Y) return "deceased";
  if (Number.isFinite(start) && Y < start) return "hidden";
  if (retire !== null && Y > retire) return "retired";
  if (Number.isFinite(debut)) return Y < debut ? "junior_only" : "eligible";
  return "junior_only";
}

/** Ativo num ano (para entidades com first/last) */
function activeInYear(entity, year) {
  const first = pick(entity, ["first_year", "start_year", "founded_year"], -Infinity);
  const last = pick(entity, ["last_year", "end_year", "defunct_year"], Infinity);
  const y = Number(year);
  return y >= Number(first ?? -Infinity) && y <= Number(last ?? Infinity);
}

/** Filtros por ano / intervalo */
function filterByYear(records, year) {
  const y = Number(year);
  return (records || []).filter((r) => Number(getYearNumber(r)) === y);
}
function filterByYearRange(records, year) {
  const y = Number(year);
  return (records || []).filter((r) => {
    const start = Number(pick(r, ["start_year", "from_year", "first_year", "year_start", "start", "from"], -Infinity));
    const endRaw = pick(r, ["end_year", "to_year", "last_year", "year_end", "end", "to"], Infinity);
    const end = endRaw == null || endRaw === "" ? Infinity : Number(endRaw);
    if (Number.isNaN(start) && end === Infinity) {
      const yr = Number(getYearNumber(r));
      return yr === y;
    }
    return y >= (Number.isNaN(start) ? -Infinity : start) && y <= (Number.isNaN(end) ? Infinity : end);
  });
}

/** Normaliza equipa (inclui team_base) */
function normalizeTeam(t) {
  const base = pick(
    t,
    ["team_base", "base", "hq", "headquarters", "country", "location", "nation"],
    null
  );
  const name = pick(t, ["name", "team_name", "short_name"], null);
  const id = getTeamId(t);
  return { ...t, team_id: id, name: name ?? id, base };
}

/** match flexível */
function sameTeam(rec, team) {
  const recId = pick(rec, ["team_id", "team", "constructor_id", "constructor", "name", "team_name", "short_name"]);
  if (recId != null && getTeamId(team) === String(recId)) return true;
  const rn = pick(rec, ["team_name", "constructor", "name", "team", "short_name"]);
  const tn = pick(team, ["name", "team_name", "short_name"]);
  return rn && tn && canon(rn) === canon(tn);
}

/* ===== assets / logos ===== */
function buildAssetUrl(relPath) {
  const base = (import.meta?.env?.BASE_URL ?? "/").replace(/\/+$/, "");
  const rel = String(relPath || "").replace(/^\/+/, "");
  return `${base}/${rel}`;
}
function buildTeamLogoCandidates(team) {
  const id = getTeamId(team);
  const short = (team.short_name || team.team_name || team.name || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const cands = [`logos/teams/${id}.png`];
  if (short && short !== id.toLowerCase()) cands.push(`logos/teams/${short}.png`);
  return cands.map(buildAssetUrl);
}

export const useGame = create((set, get) => ({
  gameState: {
    currentDateISO: "1980-01-01",
    currentRound: 0,

    // BD bruta
    dbCalendar: [],
    dbDrivers: [],
    dbTeams: [],
    dbDriverRatings: [],
    dbStaffRatings: [],
    dbTeamBrands: [],
    dbTeamEngines: [],
    dbContracts: [],
    dbSponsorsContracts: [],
    dbRules: [],
    dbEraSafety: [],
    dbAccidentModel: [],

    // Filtrados
    activeYear: 1980,
    calendar: [],
    drivers: [],
    teams: [],
    driverRatings: [],
    staffRatings: [],
    teamBrands: [],
    teamEngines: [],
    contracts: [],
    sponsorsContracts: [],
    rules: [],
    eraSafety: [],
    accidentModel: [],

    // Settings (novo)
    settings: defaultSettings,

    // save
    team: null,
    standings: { drivers: [], teams: [] },
    inbox: [],
  },

  setGameState: (partial) => set((s) => ({ gameState: { ...s.gameState, ...partial } })),

  /** Atualiza apenas settings (para Settings.jsx) */
  updateSettings: (next) => {
    set((state) => ({
      gameState: {
        ...state.gameState,
        settings: { ...state.gameState?.settings, ...next },
      },
    }));
  },

  advanceOneDay: () => {
    const { currentDateISO } = get().gameState;
    const [y, m, d] = currentDateISO.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    const nextISO = dt.toISOString().slice(0, 10);
    set((s) => ({ gameState: { ...s.gameState, currentDateISO: nextISO } }));
  },

  loadData: async () => {
    try {
      const [
        drivers,
        calendar,
        teams,
        driverRatings,
        staffRatings,
        teamBrands,
        teamEngines,
        contracts,
        sponsorsContracts,
        rules,
        eraSafety,
        accidentModel,
      ] = await Promise.all([
        fetchJsonSafe("/data/drivers.json"),
        fetchJsonSafe("/data/calendar.json"),
        fetchJsonSafe("/data/teams.json"),
        fetchJsonSafe("/data/driver_ratings.json"),
        fetchJsonSafe("/data/staff_ratings.json"),
        fetchJsonSafe("/data/team_brands.json"),
        fetchJsonSafe("/data/team_engines.json"),
        fetchJsonSafe("/data/contracts.json"),
        fetchJsonSafe("/data/sponsors_contracts.json"),
        fetchJsonSafe("/data/rules.json"),
        fetchJsonSafe("/data/era_safety.json"),
        fetchJsonSafe("/data/accident_model.json"),
      ]);

      set((s) => ({
        gameState: {
          ...s.gameState,
          dbDrivers: drivers,
          dbCalendar: calendar,
          dbTeams: teams,
          dbDriverRatings: driverRatings,
          dbStaffRatings: staffRatings,
          dbTeamBrands: teamBrands,
          dbTeamEngines: teamEngines,
          dbContracts: contracts,
          dbSponsorsContracts: sponsorsContracts,
          dbRules: rules,
          dbEraSafety: eraSafety,
          dbAccidentModel: accidentModel,
        },
      }));

      const activeY = get().gameState.activeYear || 1980;
      get().applyYearFilter(activeY);

      set((s) => ({
        gameState: {
          ...s.gameState,
          team: s.gameState.team ?? { name: "McLaren", budget: 12000000 },
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
        },
      }));
    } catch (err) {
      console.error("loadData() failed:", err);
    }
  },

  applyYearFilter: (year) => {
    const prev = get().gameState;
    const y = Number(year);

    const calendar = (prev.dbCalendar || []).filter((gp) => extractGPYear(gp) === y);

    const teamsRaw = (prev.dbTeams || []).filter((t) => activeInYear(t, y));
    const teams = teamsRaw.map(normalizeTeam);

    // === Drivers robustos (suporta Excel: driver_id + driver_name) ===
    const driversWithStatus = (prev.dbDrivers || []).map((d) => {
      // nome: tentar vários campos, com prioridade ao driver_name do Excel
      const first =
        d.first_name ?? d.firstname ?? d.given_name ?? d.forename ?? d.first ?? "";
      const last =
        d.last_name ?? d.lastname ?? d.family_name ?? d.surname ?? d.last ?? "";
      const combo = `${first} ${last}`.trim();
      const display_name =
        d.driver_name || // Excel
        d.name || d.display_name || d.full_name || d.fullname || combo || d.code || "";

      const status = computeDriverStatus(y, d);
      const age = ageOnYear(d.dob, y);
      const canHireF1 = status === "eligible";
      const canHireAcademy = status === "junior_only" || (!Number.isNaN(age) && age <= 16);

      return {
        ...d,
        driver_id: d.driver_id ?? d.id ?? d.code ?? null, // Excel já traz driver_id
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
        canHireF1,
        canHireAcademy,
      };
    });
    const drivers = driversWithStatus
      .filter((d) => d.status !== "hidden")
      .filter((d) => d.driver_id && (d.display_name || d.name));

    // ✅ EXTRACTS
    const driverRatingsExact = filterByYear(prev.dbDriverRatings, y);
    const staffRatingsExact  = filterByYear(prev.dbStaffRatings, y);
    const driverRatings = driverRatingsExact.length ? driverRatingsExact : filterByYearRange(prev.dbDriverRatings, y);
    const staffRatings  = staffRatingsExact.length ? staffRatingsExact : filterByYearRange(prev.dbStaffRatings, y);

    const teamBrandsExact = filterByYear(prev.dbTeamBrands, y);
    const teamEnginesExact = filterByYear(prev.dbTeamEngines, y);
    const teamBrands = teamBrandsExact.length ? teamBrandsExact : filterByYearRange(prev.dbTeamBrands, y);
    const teamEngines = teamEnginesExact.length ? teamEnginesExact : filterByYearRange(prev.dbTeamEngines, y);

    const contractsExact = filterByYear(prev.dbContracts, y);
    const contracts = contractsExact.length ? contractsExact : filterByYearRange(prev.dbContracts, y);

    const sponsorsExact = filterByYear(prev.dbSponsorsContracts, y);
    const sponsorsContracts = sponsorsExact.length ? sponsorsExact : filterByYearRange(prev.dbSponsorsContracts, y);

    const rulesExact = filterByYear(prev.dbRules, y);
    const rulesRanged = filterByYearRange(prev.dbRules, y);
    const rules = rulesExact.length ? rulesExact : rulesRanged;

    const eraSafetyExact = filterByYear(prev.dbEraSafety, y);
    const eraSafetyRanged = filterByYearRange(prev.dbEraSafety, y);
    const eraSafety = eraSafetyExact.length ? eraSafetyExact : eraSafetyRanged;

    const accidentModelExact = filterByYear(prev.dbAccidentModel, y);
    const accidentModelRanged = filterByYearRange(prev.dbAccidentModel, y);
    const accidentModel = accidentModelExact.length ? accidentModelExact : accidentModelRanged;

    if ((drivers || []).length === 0 && (prev.dbDrivers || []).length > 0) {
      console.warn(
        `[GameStore] Year ${y}: 0 drivers após filtro. Verifica drivers.json (driver_id, driver_name, career_start_year, f1_rookie_season, career_end_year, death_date, dob).`
      );
    }

    set(() => ({
      gameState: {
        ...prev,
        activeYear: y,
        calendar,
        teams,
        drivers,
        driverRatings,
        staffRatings,
        teamBrands,
        teamEngines,
        contracts,
        sponsorsContracts,
        rules,
        eraSafety,
        accidentModel,
      },
    }));
  },

  /** Nome preferencial a partir de team_brands (com fallbacks) */
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

  /** URLs candidatos para o logo (.png), com BASE_URL */
  getTeamLogoCandidates: (team) => buildTeamLogoCandidates(team),

  // ====== NEW GAME ======
  startNewGame: (cfg) => {
    const { year, team, difficulty } = cfg;
    get().applyYearFilter(year);

    const initial = {
      currentDateISO: `${year}-01-01`,
      currentRound: 0,
      team: team ?? null,
      standings: { drivers: [], teams: [] },
      inbox: [
        {
          id: Date.now(),
          subject: "Welcome to the paddock",
          from: "FIA",
          tag: "FIA",
          date: `${year}-01-02`,
          body: `Difficulty set to ${difficulty}. Good luck!`,
        },
      ],
      // mantém settings existentes ao iniciar novo jogo
      settings: get().gameState?.settings ?? defaultSettings,
      activeYear: Number(year),
    };

    set((s) => ({
      gameState: { ...s.gameState, ...initial },
    }));
  },

  /** ====== NEW GAME — Create Team (wizard) ====== */
  startNewGameFromCreateTeam: (payload) => {
    try {
      const { year, team, drivers, difficulty } = payload;
      const y = Number(year);

      // 1) Garantir dados filtrados para o ano
      get().applyYearFilter(y);

      // 2) Construir equipa do utilizador (inclui logo)
      const userTeam = {
        team_id: team.team_id,
        name: team.name,
        short_name: team.short_name,
        colors: team.colors,
        engine_id: team.engine_id,
        budget: team.starting_budget ?? 5_000_000,
        logo_data_url: team.logo_data_url ?? null,
        logo_file_name: team.logo_file_name ?? null,
        is_user_controlled: true,
      };

      // 3) Inbox inicial
      const inbox = [
        {
          id: Date.now(),
          subject: "Welcome to the paddock",
          from: "FIA",
          tag: "FIA",
          date: `${y}-01-02`,
          body: `Your entry has been accepted for the ${y} World Championship.`,
        },
        {
          id: Date.now() + 1,
          subject: "Supplier contract signed",
          from: "Commercial",
          tag: "Suppliers",
          date: `${y}-01-03`,
          body: `Engine supply confirmed for ${team.short_name}.`,
        },
      ];

      // 4) Atualizar gameState mantendo a tua estrutura
      set((s) => ({
        gameState: {
          ...s.gameState,
          currentDateISO: `${y}-01-01`,
          currentRound: 0,
          activeYear: y,
          team: userTeam,
          selectedDrivers: Array.isArray(drivers) ? drivers : [],
          standings: { drivers: [], teams: [] },
          inbox,
          // mantém settings
          settings: s.gameState?.settings ?? defaultSettings,
        },
      }));

      // 5) Guardar no SAVE_KEY único já usado no teu projeto
      get().saveLocal?.();

      return true;
    } catch (e) {
      console.error("startNewGameFromCreateTeam() failed:", e);
      return false;
    }
  },

  // ====== SAVE / LOAD ======
  saveLocal: () => {
    try {
      const state = get().gameState;
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error("saveLocal() failed:", e);
      return false;
    }
  },

  // Alias para compatibilidade com Settings.jsx
  saveGame: () => get().saveLocal(),

  loadLocal: () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      set(() => ({
        gameState: {
          ...saved,
          // garante defaults de settings se o save for antigo
          settings: { ...defaultSettings, ...(saved.settings || {}) },
        },
      }));
      return true;
    } catch (e) {
      console.error("loadLocal() failed:", e);
      return false;
    }
  },

  // ====== META MAIN MENU ======
  hasAnySave: () => {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  },
  loadLastPlayed: () => get().loadLocal(),
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
}));
