import { isDeepStrictEqual } from "node:util";

import { createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "../../src/core/saveSafety.js";
import {
  completePracticeSession,
  completeQualifyingSession,
  completeRaceSession,
  continueRaceWeekendSession,
  createRaceWeekendState,
  syncRaceWeekendPhaseForDate,
} from "../../src/engine/RaceWeekendEngine.js";
import {
  advanceLiveRaceSector,
  assessLiveRaceRestart,
  createLiveRaceState,
  fastForwardLiveRaceRestart,
  liveRaceReadyToFinalize,
  prepareLiveRaceRestart,
  resumeLiveRace,
} from "../../src/engine/LiveRaceEngine.js";

export const PARITY_GP = {
  gp_id: "rw7_parity_gp",
  gp_name: "RW7 Parity Grand Prix",
  year: 1980,
  race_date: "1980-05-18",
  dateISO: "1980-05-18",
  track_id: "rw7_parity_track",
};

const QUALIFYING_RULE = {
  rule_id: "rw7_1980_parity",
  year: 1980,
  strategy: "best_time_across_sessions",
  session_count: 2,
  max_starters: 24,
  practice_day_offset: -2,
  session_day_offsets: [-2, -1],
  grid_day_offset: -1,
  prequalifying_enabled: false,
  event_overrides: [],
};

export const PARITY_DOMAINS = [
  "incidents",
  "incident_point",
  "damage",
  "dnf",
  "pits",
  "repairs",
  "tyres",
  "race_control",
  "red_flag",
  "lap_times",
  "fastest_lap",
  "final_position",
  "final_timing",
];

export const KNOWN_RACE_PARITY_GAPS = Object.freeze({
  incidents: "Live currently rebuilds future Race Control plans while direct autosim consumes one full-race plan.",
  damage: "Direct autosim does not yet materialize every damage loss into per-lap timing the same way as Live.",
  dnf: "Retirement outcomes can follow regenerated future incidents in Live.",
  pits: "Live repeatedly reprojects strategy and materializes pit state incrementally.",
  repairs: "Live and direct repair histories are materialized through different orchestration paths.",
  tyres: "Tyre state can inherit pit/reprojection differences between the two paths.",
  race_control: "SC/VSC/Local Yellow/Red Flag ownership is not yet unified.",
  red_flag: "Only Live currently executes the full Red Flag lifecycle and restart work.",
  lap_times: "Damage/incident time loss is not yet represented identically in direct lap_times_ms.",
  fastest_lap: "Fastest-lap parity depends on lap_times_ms parity.",
  final_position: "Live position is rebuilt from observed elapsed timing while direct result order is finalized separately.",
  final_timing: "Direct and Live do not yet share one authoritative timing clock.",
});

function fixture(seed) {
  const teams = [
    { team_id: "T1", team_name: "Alpha" },
    { team_id: "T2", team_name: "Beta" },
  ];
  const drivers = [
    { driver_id: "D1", display_name: "Alpha One" },
    { driver_id: "D2", display_name: "Alpha Two" },
    { driver_id: "D3", display_name: "Beta One" },
    { driver_id: "D4", display_name: "Beta Two" },
  ];
  return {
    saveMeta: createNewSaveMeta({ year: 1980, teamId: "T1", seed }),
    activeYear: 1980,
    currentDateISO: "1980-05-16",
    currentRound: 0,
    calendar: [PARITY_GP],
    team: teams[0],
    teams,
    drivers,
    qualifyingRules: { ...QUALIFYING_RULE },
    contracts: [
      { year: 1980, team_id: "T1", driver_id: "D1", role: "main_driver", status: "active", contract_start_year: 1980, contract_until_year: 1980 },
      { year: 1980, team_id: "T1", driver_id: "D2", role: "second_driver", status: "active", contract_start_year: 1980, contract_until_year: 1980 },
      { year: 1980, team_id: "T2", driver_id: "D3", role: "main_driver", status: "active", contract_start_year: 1980, contract_until_year: 1980 },
      { year: 1980, team_id: "T2", driver_id: "D4", role: "second_driver", status: "active", contract_start_year: 1980, contract_until_year: 1980 },
    ],
    driverRatings: drivers.map((driver, index) => ({
      driver_id: driver.driver_id,
      pace: 82 - index,
      qualifying: 84 - index,
      racecraft: 80 - index,
      consistency: 76,
      pressure_handling: 75,
      adaptability: 74,
      mentality: 74,
      current_ability: 80 - index,
      start_launch: 72,
      tire_management: 72,
      race_intelligence: 74,
      crash_likelihood: 10,
      technical_feedback: 78 - index,
    })),
    driverAttributes: {},
    driverAvailability: {},
    medicalHistory: [],
    temporaryDriverAssignments: [],
    standings: { drivers: [], teams: [] },
    results: [],
    inbox: [],
    financeLog: [],
    finances: { balance: 1_000_000, budget: 1_000_000, season_spend: 0, season_income: 0 },
    settings: { gameplay: { enableInjuryRandomEvents: true, enableFatalities: false } },
    pointsSystem: { table: [9, 6, 4, 3] },
    carStats: [
      { year: 1980, team_id: "T1", chassis_spec: 80, aero_spec: 82, gearbox_spec: 80, suspension_spec: 80, brakes_spec: 80, reliability: 92 },
      { year: 1980, team_id: "T2", chassis_spec: 76, aero_spec: 77, gearbox_spec: 76, suspension_spec: 76, brakes_spec: 76, reliability: 90 },
    ],
    teamEngines: [
      { year: 1980, team_id: "T1", power: 82, reliability: 94 },
      { year: 1980, team_id: "T2", power: 78, reliability: 92 },
    ],
    facilities: [],
    sponsorsContracts: [],
    accidentModel: [{ year: 1980, damage_DNF_prob: 0.08, injury_prob: 0.02, fatality_prob: 0.002 }],
    eraSafety: [{ year: 1980, era_safety_index: 0.42, car_safety: 0.5, medical_response: 0.6, marshals_quality: 0.55 }],
    staffContracts: [
      { year: 1980, team_id: "T1", staff_id: "S1", role: "chief_engineer", contract_start: 1979, contract_until: 1982 },
      { year: 1980, team_id: "T2", staff_id: "S2", role: "chief_engineer", contract_start: 1979, contract_until: 1982 },
    ],
    staffRatings: [
      { year: 1980, staff_id: "S1", technical: 92, data_analysis: 88, communication: 80, reliability_focus: 90 },
      { year: 1980, staff_id: "S2", technical: 62, data_analysis: 60, communication: 65, reliability_focus: 62 },
    ],
    coreTracks: [{
      track_id: "rw7_parity_track",
      track_name: "RW7 Parity Track",
      crash_risk: 72,
      overtaking_difficulty: 66,
      tyre_wear: 62,
      lap_length_km: 3.34,
    }],
    trackLayoutByYear: [{
      track_id: "rw7_parity_track",
      year_from: 1973,
      year_to: 1985,
      lap_length_km: 3.34,
      laps: 12,
    }],
    development: {
      parts: [
        { id: "P1", slot: "aero_front", perf: 4, condition: 100 },
        { id: "P2", slot: "aero_front", perf: 4, condition: 100 },
      ],
      projects: [],
      research: [],
    },
    garage: {
      cars: [
        { id: "car_1", kind: "race", driver_id: "D1", installedParts: { aero_front: "P1" } },
        { id: "car_2", kind: "race", driver_id: "D2", installedParts: { aero_front: "P2" } },
        { id: "car_spare", kind: "reserve", driver_id: null, installedParts: {} },
      ],
    },
  };
}

export function createParityRaceStart(seed = "rw7.1-parity") {
  let gs = createRaceWeekendState(fixture(seed), { roundIndex: 0, gp: PARITY_GP });
  gs = completePracticeSession(gs, { gp: PARITY_GP });
  gs = continueRaceWeekendSession(gs);
  gs = completeQualifyingSession(gs, { gp: PARITY_GP });
  gs = { ...gs, currentDateISO: "1980-05-17" };
  gs = continueRaceWeekendSession(gs);
  gs = completeQualifyingSession(gs, { gp: PARITY_GP });
  gs = continueRaceWeekendSession(gs);
  gs = syncRaceWeekendPhaseForDate({ ...gs, currentDateISO: PARITY_GP.race_date }, PARITY_GP.race_date);
  if (gs?.raceWeekendState?.phase !== "race") {
    throw new Error(`RW7.1 parity fixture failed to reach race phase: ${String(gs?.raceWeekendState?.phase)}`);
  }
  return gs;
}

function liveOrdinal(live) {
  const lap = Number(live?.current_lap) || 0;
  const sector = Number(live?.current_sector) || 0;
  if (lap <= 0 || sector <= 0) return 0;
  return (lap - 1) * 3 + sector;
}

function resolveRedFlag(gs) {
  let next = gs;
  let guard = 0;
  while (next?.raceWeekendState?.live_race?.status === "red_flag" && guard < 12) {
    const lifecycle = next?.raceWeekendState?.live_race?.red_flag_lifecycle;
    if (lifecycle?.phase === "restart_pending") {
      next = resumeLiveRace(next);
    } else if (lifecycle?.restart_monitor?.restart_authorized) {
      next = prepareLiveRaceRestart(next);
    } else {
      next = assessLiveRaceRestart(next);
    }
    guard += 1;
  }
  if (next?.raceWeekendState?.live_race?.status === "red_flag") {
    next = fastForwardLiveRaceRestart(next);
    if (next?.raceWeekendState?.live_race?.red_flag_lifecycle?.phase === "restart_pending") {
      next = resumeLiveRace(next);
    }
  }
  return next;
}

export async function runDirectParityRace(seed = "rw7.1-parity") {
  return completeRaceSession(createParityRaceStart(seed), { gp: PARITY_GP });
}

export async function runLiveParityRace(seed = "rw7.1-parity", {
  chunks = [1],
  reloadAtOrdinal = null,
} = {}) {
  let gs = createLiveRaceState(createParityRaceStart(seed), { gp: PARITY_GP });
  let reloaded = false;
  let step = 0;
  let guard = 0;

  while (!liveRaceReadyToFinalize(gs) && guard < 2000) {
    const live = gs?.raceWeekendState?.live_race;
    if (live?.status === "red_flag") {
      gs = resolveRedFlag(gs);
      guard += 1;
      continue;
    }
    if (live?.status !== "running") {
      throw new Error(`RW7.1 live parity run stopped in unexpected state: ${String(live?.status)}`);
    }

    const currentOrdinal = liveOrdinal(live);
    let sectors = Math.max(1, Number(chunks[step % chunks.length]) || 1);
    if (!reloaded && Number.isFinite(Number(reloadAtOrdinal)) && currentOrdinal < Number(reloadAtOrdinal)) {
      sectors = Math.min(sectors, Math.max(1, Number(reloadAtOrdinal) - currentOrdinal));
    }

    gs = advanceLiveRaceSector(gs, { gp: PARITY_GP, sectors });
    step += 1;

    if (!reloaded && Number.isFinite(Number(reloadAtOrdinal)) && liveOrdinal(gs?.raceWeekendState?.live_race) >= Number(reloadAtOrdinal)) {
      const stored = prepareGameStateForSave(gs);
      gs = extractGameStateFromStoredSave({ meta: { name: "RW7.1 parity midway" }, gameState: stored });
      reloaded = true;
    }
    guard += 1;
  }

  if (!liveRaceReadyToFinalize(gs)) {
    throw new Error(`RW7.1 live parity run did not finish after ${guard} iterations.`);
  }
  return completeRaceSession(gs, { gp: PARITY_GP });
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function driverId(row) {
  return String(row?.driver_id ?? row?.driver?.driver_id ?? row?.id ?? "");
}

function sortByDriver(rows) {
  return rows.slice().sort((a, b) => String(a.driver_id).localeCompare(String(b.driver_id)));
}

function sortedIncidents(plan) {
  return (plan?.incidents || [])
    .map((row) => ({
      driver_id: String(row?.driver_id ?? ""),
      other_driver_id: row?.other_driver_id == null ? null : String(row.other_driver_id),
      kind: row?.kind ?? null,
      reason: row?.reason ?? null,
      lap: finiteOrNull(row?.lap),
      sector: finiteOrNull(row?.sector),
      severity: row?.severity ?? null,
      retirement: Boolean(row?.retirement),
    }))
    .sort((a, b) => (a.lap - b.lap) || (a.sector - b.sector) || a.driver_id.localeCompare(b.driver_id));
}

function normalizedStops(row) {
  return (row?.pit_stops || []).map((stop) => ({
    lap: finiteOrNull(stop?.lap),
    reason: stop?.reason ?? stop?.pit_reason ?? stop?.service?.reason ?? null,
    tyre_from: stop?.tyre_from ?? stop?.service?.tyre_from ?? null,
    tyre_to: stop?.tyre_to ?? stop?.service?.tyre_to ?? null,
    refuelled: Boolean(stop?.refuelled ?? stop?.service?.refuelled),
    fuel_added: finiteOrNull(stop?.fuel_added ?? stop?.service?.fuel_added),
    total_loss_s: finiteOrNull(stop?.total_loss_s),
  }));
}

function normalizedRepairs(row) {
  return (row?.pit_stops || [])
    .map((stop) => {
      const repair = stop?.service?.repair ?? stop?.repair ?? null;
      if (!repair) return null;
      const repaired = Array.isArray(repair?.repaired_components) ? repair.repaired_components.map(String).sort() : [];
      if (!repaired.length && !repair?.performed) return null;
      return {
        lap: finiteOrNull(stop?.lap),
        repaired_components: repaired,
        repair_ordinal: finiteOrNull(repair?.repair_ordinal ?? stop?.service?.repair_ordinal),
      };
    })
    .filter(Boolean);
}

function normalizedStints(row) {
  return (row?.stints || []).map((stint) => ({
    tyre_id: stint?.tyre_id ?? null,
    compound: stint?.compound ?? stint?.compound_name ?? null,
    start_lap: finiteOrNull(stint?.start_lap),
    end_lap: finiteOrNull(stint?.end_lap),
    laps: finiteOrNull(stint?.laps),
  }));
}

export function normalizeRaceParityResult(gs) {
  const result = Array.isArray(gs?.results) ? gs.results.at(-1) : null;
  const classification = Array.isArray(result?.classification)
    ? result.classification
    : Array.isArray(gs?.lastRace?.classification)
      ? gs.lastRace.classification
      : [];
  const raceRows = Array.isArray(gs?.lastRace?.race) ? gs.lastRace.race : [];
  const raceByDriver = new Map(raceRows.map((row) => [driverId(row), row]));
  const plan = gs?.raceWeekendState?.race_strategy?.race_control_plan
    || gs?.lastRace?.strategySummary?.race_control
    || null;
  const incidents = sortedIncidents(plan);
  const periods = (plan?.periods || []).map((row) => ({
    type: row?.type ?? null,
    from_lap: finiteOrNull(row?.from_lap),
    from_sector: finiteOrNull(row?.from_sector),
    to_lap: finiteOrNull(row?.to_lap),
    to_sector: finiteOrNull(row?.to_sector),
    cause: row?.cause ?? null,
  }));

  const rows = classification.map((row) => {
    const did = driverId(row);
    return { classification: row, race: raceByDriver.get(did) || {}, driver_id: did };
  });

  return {
    incidents: incidents.map(({ lap, sector, ...row }) => row),
    incident_point: incidents.map(({ driver_id, other_driver_id, kind, reason, lap, sector, retirement }) => ({
      driver_id, other_driver_id, kind, reason, lap, sector, retirement,
    })),
    damage: sortByDriver(rows.map(({ classification: row, driver_id: did }) => ({
      driver_id: did,
      severity: row?.damage_severity ?? row?.damage_state?.severity ?? "none",
      components: Array.isArray(row?.damaged_components) ? row.damaged_components.map(String).sort() : [],
      pace_loss_s_per_lap: finiteOrNull(row?.damage_pace_loss_s_per_lap ?? row?.damage_state?.pace_loss_s_per_lap),
    }))),
    dnf: sortByDriver(rows.map(({ classification: row, driver_id: did }) => ({
      driver_id: did,
      retired: Boolean(row?.retired),
      status: row?.status ?? null,
      reason: row?.retirement_reason ?? null,
      incident_lap: finiteOrNull(row?.incident_lap),
      incident_sector: finiteOrNull(row?.incident_sector),
      laps_completed: finiteOrNull(row?.laps_completed),
    }))),
    pits: sortByDriver(rows.map(({ race, driver_id: did }) => ({ driver_id: did, stops: normalizedStops(race) }))),
    repairs: sortByDriver(rows.map(({ race, driver_id: did }) => ({ driver_id: did, repairs: normalizedRepairs(race) }))),
    tyres: sortByDriver(rows.map(({ classification: row, race, driver_id: did }) => ({
      driver_id: did,
      start_tyre_id: row?.start_tyre_id ?? race?.start_tyre_id ?? null,
      finish_tyre_id: row?.finish_tyre_id ?? race?.finish_tyre_id ?? null,
      tyre_condition_finish: finiteOrNull(row?.tyre_condition_finish ?? race?.tyre_condition_finish),
      stints: normalizedStints(race),
    }))),
    race_control: periods.filter((row) => row.type !== "RED_FLAG"),
    red_flag: {
      periods: periods.filter((row) => row.type === "RED_FLAG"),
      restart_history: (gs?.raceWeekendState?.live_race?.red_flag_history || []).map((row) => ({
        from_lap: finiteOrNull(row?.period?.from_lap ?? row?.from_lap),
        from_sector: finiteOrNull(row?.period?.from_sector ?? row?.from_sector),
        restart_style: row?.restart_style ?? null,
        restart_control: row?.restart_control ?? null,
      })),
    },
    lap_times: sortByDriver(rows.map(({ race, driver_id: did }) => ({
      driver_id: did,
      lap_times_ms: Array.isArray(race?.lap_times_ms) ? race.lap_times_ms.map(finiteOrNull) : [],
    }))),
    fastest_lap: sortByDriver(rows.map(({ classification: row, driver_id: did }) => ({
      driver_id: did,
      best_lap_ms: finiteOrNull(row?.best_lap_ms),
      fastest_lap: Boolean(row?.fastest_lap),
    }))),
    final_position: classification
      .map((row) => ({ driver_id: driverId(row), position: finiteOrNull(row?.position), status: row?.status ?? null }))
      .sort((a, b) => (a.position - b.position) || a.driver_id.localeCompare(b.driver_id)),
    final_timing: sortByDriver(rows.map(({ classification: row, driver_id: did }) => ({
      driver_id: did,
      total_time_ms: finiteOrNull(row?.total_time_ms),
      gap_to_winner_ms: finiteOrNull(row?.gap_to_winner_ms),
      gap_to_previous_ms: finiteOrNull(row?.gap_to_previous_ms),
    }))),
  };
}

export function raceParityMatrix(reference, candidate) {
  return Object.fromEntries(PARITY_DOMAINS.map((domain) => [domain, isDeepStrictEqual(reference?.[domain], candidate?.[domain])]));
}

export function failedParityDomains(matrix) {
  return Object.entries(matrix).filter(([, pass]) => !pass).map(([domain]) => domain);
}
