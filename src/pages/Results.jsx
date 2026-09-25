// src/pages/Results.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../state/GameStore";
import { DriverPortrait, TeamLogo } from "../components/entity/EntityVisuals.jsx";
import { GrandPrixFlag } from "../components/entity/GrandPrixFlag.jsx";
import { historicalRaceStarted, historicalResultCode, historicalResultDisplay, historicalResultInfo } from "../domain/historicalRaceStatus.js";

const pick = (obj, keys, fb = undefined) => {
  for (const k of keys) {
    const v = obj ? obj[k] : undefined;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fb;
};

function resolveDriverName(drivers, id) {
  const d = (drivers || []).find((x) => String(x.driver_id ?? x.id) === String(id));
  return d?.display_name || d?.name || `${d?.first_name ?? ""} ${d?.last_name ?? ""}`.trim() || id || "—";
}

function resolveTeamNameById(teams, id) {
  const t = (teams || []).find((x) => String(x.team_id ?? x.id) === String(id));
  return t?.team_name || t?.name || id || "—";
}

function pointsTableFromState(gameState) {
  const rec = gameState?.pointsSystem;
  if (Array.isArray(rec?.table) && rec.table.length) return rec.table.map(Number);
  if (rec?.table && typeof rec.table === "object") {
    return Object.keys(rec.table)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => Number(rec.table[k]) || 0);
  }
  const places = Array.isArray(rec?.places_csv)
    ? rec.places_csv
    : String(rec?.places_csv || "").split(",").map((s) => s.trim()).filter(Boolean);
  const parsed = places.map(Number).filter(Number.isFinite);
  return parsed.length ? parsed : [9, 6, 4, 3, 2, 1];
}

function formatRaceTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  const totalSeconds = n / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function formatLapTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  const totalSeconds = n / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function formatGap(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "—";
  return `+${(n / 1000).toFixed(3)}`;
}

function rowsWithCalculatedGaps(rows) {
  const sorted = (rows || [])
    .slice()
    .sort((a, b) => (Number(a?.position) || Infinity) - (Number(b?.position) || Infinity));

  const winner = sorted.find((row) => Number(row?.position) === 1);
  const winnerTime = numberOrNull(winner?.total_time_ms);

  return sorted.map((row, index) => {
    const totalTime = numberOrNull(row?.total_time_ms);
    const previousTime = index > 0 ? numberOrNull(sorted[index - 1]?.total_time_ms) : null;
    const calculatedToWinner =
      totalTime != null && winnerTime != null && totalTime >= winnerTime
        ? totalTime - winnerTime
        : numberOrNull(row?.gap_to_winner_ms);
    const calculatedGap =
      index === 0
        ? 0
        : totalTime != null && previousTime != null && totalTime >= previousTime
          ? totalTime - previousTime
          : numberOrNull(row?.gap_to_previous_ms);

    return {
      ...row,
      __toWinnerMs: calculatedToWinner,
      __gapMs: calculatedGap,
    };
  });
}

function resolveTeamIdForYear(contracts, year, driverId) {
  for (const c of contracts || []) {
    const y = Number(pick(c, ["year", "season_year"], NaN));
    const role = String(pick(c, ["role", "position", "contract_role", "type"], "")).toLowerCase();
    const pid = String(pick(c, ["driver_id", "person_id", "id"], ""));
    if (y === Number(year) && role.includes("driver") && pid === String(driverId)) {
      const tid = pick(c, ["team_id", "team", "constructor"], null);
      if (tid != null && tid !== "") return String(tid);
    }
  }
  return null;
}

function normalizeLegacyLastRace(lastRace, activeYear) {
  if (!lastRace || !Array.isArray(lastRace.race)) return null;
  const round = Number(lastRace.roundIndex ?? -1) + 1;
  const year = Number(activeYear) || null;
  const key = `${year ?? "season"}_${round || "round"}_${lastRace.gpName || "gp"}`;
  return {
    key,
    year,
    round,
    name: lastRace.gpName || `Round ${round}`,
    dateISO: lastRace.date || null,
    classification: lastRace.race.map((row) => ({
      position: row?.pos ?? row?.position ?? null,
      driver_id: row?.driver?.driver_id ?? row?.driver_id ?? null,
      team_id: row?.driver?.team_id ?? row?.driver?.constructor_id ?? row?.team_id ?? null,
      fastest_lap: Boolean(row?.fastest_lap ?? row?.fastestLap),
    })),
  };
}

function canon(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rawDriverName(row) {
  return String(pick(row, ["driver_name", "driverName", "display_name", "name"], "") || "").trim();
}

function rawTeamName(row) {
  return String(pick(row, ["team_name", "constructorName", "constructor_name", "constructor", "team"], "") || "").trim();
}

function makeHistoricalRaceEvents(rows, drivers, teams, careerStartYear) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const driverIds = new Set((drivers || []).map((d) => String(d?.driver_id ?? d?.id ?? "")).filter(Boolean));
  const driverArchiveToId = new Map();
  const driverNameToId = new Map();
  for (const d of drivers || []) {
    const id = String(d?.driver_id ?? d?.id ?? "");
    if (!id) continue;
    const archiveId = numberOrNull(pick(d, ["driverID_arch", "driverId_arch", "driverId"], null));
    if (archiveId != null) driverArchiveToId.set(archiveId, id);
    for (const name of [d?.display_name, d?.driver_name, d?.name, d?.full_name]) {
      const key = canon(name);
      if (key && !driverNameToId.has(key)) driverNameToId.set(key, id);
    }
  }

  const teamIds = new Set((teams || []).map((t) => String(t?.team_id ?? t?.id ?? "")).filter(Boolean));
  const teamNameToId = new Map();
  for (const t of teams || []) {
    const id = String(t?.team_id ?? t?.id ?? "");
    if (!id) continue;
    for (const name of [t?.team_name, t?.name, t?.short_name, t?.official_name]) {
      const key = canon(name);
      if (key && !teamNameToId.has(key)) teamNameToId.set(key, id);
    }
  }

  const resolveDriverId = (row) => {
    const direct = String(pick(row, ["driver_id", "person_id"], "") || "");
    if (direct && driverIds.has(direct)) return direct;
    const archive = numberOrNull(pick(row, ["driverId", "driverID"], null));
    if (archive != null && driverArchiveToId.has(archive)) return driverArchiveToId.get(archive);
    const byName = driverNameToId.get(canon(rawDriverName(row)));
    return byName || direct || (archive != null ? `archive_driver_${archive}` : rawDriverName(row));
  };

  const resolveTeamId = (row) => {
    const direct = String(pick(row, ["team_id", "constructor_id"], "") || "");
    if (direct && teamIds.has(direct)) return direct;
    const byName = teamNameToId.get(canon(rawTeamName(row)));
    return byName || direct || rawTeamName(row);
  };

  const groups = new Map();
  const cutoff = Number(careerStartYear);
  for (const row of rows) {
    const year = numberOrNull(pick(row, ["year", "season_year", "season"], null));
    if (year == null) continue;
    // Historical outcomes seed the world only before the player's career.
    // From the career start onwards the simulated Save World is authoritative.
    if (Number.isFinite(cutoff) && year >= cutoff) continue;

    const round = numberOrNull(pick(row, ["round", "race_round", "round_number"], null));
    const gpName = String(pick(row, ["gp_name", "race", "raceName", "name"], round != null ? `Round ${round}` : "Grand Prix"));
    const gpId = pick(row, ["gp_id", "race_id", "raceId"], null);
    const key = `hist_${year}_${round ?? "x"}_${String(gpId ?? gpName).replace(/\s+/g, "_")}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        year,
        round,
        name: gpName,
        gp_name: gpName,
        gp_id: gpId,
        track_id: pick(row, ["track_id", "circuit_id", "circuitId"], null),
        dateISO: pick(row, ["dateISO", "race_date", "date"], null),
        historical: true,
        source: "historical_database",
        classification: [],
        startingGrid: [],
        qualifying: [],
      });
    }

    const event = groups.get(key);
    const driverId = resolveDriverId(row);
    const driverName = rawDriverName(row) || resolveDriverName(drivers, driverId);
    const teamId = resolveTeamId(row);
    const teamName = rawTeamName(row) || resolveTeamNameById(teams, teamId);
    const position = numberOrNull(pick(row, ["position", "positionOrder", "position_order", "finish_position", "pos"], null));
    const grid = numberOrNull(pick(row, ["grid", "gridPosition", "grid_position", "starting_grid"], null));
    const fastestRank = numberOrNull(pick(row, ["rank", "fastestLapRank", "fastest_lap_rank"], null));
    const statusInfo = historicalResultInfo(row);
    const retired = statusInfo.isDnf;
    const status = statusInfo.label;
    const resultCode = historicalResultCode(row);

    event.classification.push({
      position,
      driver_id: driverId,
      driver_name: driverName,
      team_id: teamId,
      team_name: teamName,
      retired,
      status,
      result_code: resultCode,
      retirement_reason: retired ? status : null,
      points: numberOrNull(pick(row, ["points"], null)),
      fastest_lap: fastestRank === 1 || ["true","1","yes"].includes(String(pick(row, ["fastest_lap", "fastestLap"], false)).toLowerCase()),
      laps_completed: numberOrNull(pick(row, ["laps", "laps_completed"], null)),
      total_time_ms: numberOrNull(pick(row, ["milliseconds", "total_time_ms"], null)),
      grid,
    });

    if (grid != null && grid > 0) {
      event.startingGrid.push({ driver_id: driverId, grid });
      event.qualifying.push({ driver_id: driverId, position: grid, best_time_ms: null });
    }
  }

  return [...groups.values()]
    .map((event) => ({
      ...event,
      classification: event.classification.sort((a,b) => (Number(a.position) || Infinity) - (Number(b.position) || Infinity)),
      startingGrid: event.startingGrid.sort((a,b) => Number(a.grid) - Number(b.grid)),
      qualifying: event.qualifying.sort((a,b) => Number(a.position) - Number(b.position)),
    }))
    .sort((a,b) => Number(a.year) - Number(b.year) || Number(a.round || 0) - Number(b.round || 0));
}

function rowDriverKey(row) {
  return String(row?.driver_id ?? row?.driver_key ?? row?.driver_name ?? "");
}

function rowTeamKey(row) {
  return String(row?.team_id ?? row?.team_key ?? row?.team_name ?? "");
}

export default function ResultsPage() {
  const gameState = useGame((s) => s.gameState);

  const driversDb = useMemo(() => {
    const merged = new Map();
    for (const d of gameState?.dbDrivers || []) {
      const id = String(d?.driver_id ?? d?.id ?? "");
      if (id) merged.set(id, d);
    }
    for (const d of gameState?.drivers || []) {
      const id = String(d?.driver_id ?? d?.id ?? "");
      if (id) merged.set(id, { ...(merged.get(id) || {}), ...d });
    }
    return [...merged.values()];
  }, [gameState?.drivers, gameState?.dbDrivers]);
  const teamsDb = useMemo(() => {
    const merged = new Map();
    for (const t of gameState?.dbTeams || []) {
      const id = String(t?.team_id ?? t?.id ?? "");
      if (id) merged.set(id, t);
    }
    for (const t of gameState?.teams || []) {
      const id = String(t?.team_id ?? t?.id ?? "");
      if (id) merged.set(id, { ...(merged.get(id) || {}), ...t });
    }
    return [...merged.values()];
  }, [gameState?.teams, gameState?.dbTeams]);
  const contractsDb = useMemo(() => gameState?.contracts || gameState?.dbContracts || [], [gameState?.contracts, gameState?.dbContracts]);
  const activeYear = gameState?.activeYear;
  const careerStartYear = Number(gameState?.careerMeta?.sourceSeason ?? gameState?.careerMeta?.startYear ?? activeYear);
  const pointsTable = useMemo(() => pointsTableFromState(gameState), [gameState?.pointsSystem]);
  const currentDecade = Number.isFinite(Number(activeYear))
    ? Math.floor(Number(activeYear) / 10) * 10
    : null;
  const [archiveIndex, setArchiveIndex] = useState(null);
  const [historicalRows, setHistoricalRows] = useState([]);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [decadeFilter, setDecadeFilter] = useState(currentDecade);
  const [yearFilter, setYearFilter] = useState(Number.isFinite(Number(activeYear)) ? String(Number(activeYear)) : "");
  const [selectedKey, setSelectedKey] = useState(null);

  const careerResults = useMemo(() => (
    Array.isArray(gameState?.results) && gameState.results.length
      ? gameState.results
      : (() => {
          const legacy = normalizeLegacyLastRace(gameState?.lastRace, activeYear);
          return legacy ? [legacy] : [];
        })()
  ), [gameState?.results, gameState?.lastRace, activeYear]);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/race_results_archive_index.json", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((index) => {
        if (!cancelled) setArchiveIndex(index && Array.isArray(index.decades) ? index : null);
      })
      .catch(() => {
        if (!cancelled) setArchiveIndex(null);
      });
    return () => { cancelled = true; };
  }, []);

  const decadeOptions = useMemo(() => {
    const values = new Set();
    const cutoff = Number(careerStartYear);

    for (const entry of archiveIndex?.decades || []) {
      const decade = Number(entry?.decade);
      if (!Number.isFinite(decade)) continue;
      const hasPreCareerYear = (entry?.years || []).some((year) => Number(year) < cutoff);
      if (!Number.isFinite(cutoff) || hasPreCareerYear) values.add(decade);
    }
    for (const event of careerResults) {
      const year = Number(event?.year);
      if (Number.isFinite(year)) values.add(Math.floor(year / 10) * 10);
    }
    if (Number.isFinite(currentDecade)) values.add(currentDecade);
    return [...values].sort((a,b) => b-a);
  }, [archiveIndex, careerResults, careerStartYear, currentDecade]);

  useEffect(() => {
    if (!Number.isFinite(Number(activeYear))) return;
    const year = Number(activeYear);
    setDecadeFilter(Math.floor(year / 10) * 10);
    setYearFilter(String(year));
    setSelectedKey(null);
  }, [activeYear]);

  useEffect(() => {
    let cancelled = false;
    const decade = Number(decadeFilter);
    if (!Number.isFinite(decade)) {
      setHistoricalRows([]);
      setHistoricalLoading(false);
      return () => { cancelled = true; };
    }

    const entry = (archiveIndex?.decades || []).find((item) => Number(item?.decade) === decade);
    const cutoff = Number(careerStartYear);
    const needsHistorical = entry
      ? (entry.years || []).some((year) => !Number.isFinite(cutoff) || Number(year) < cutoff)
      : decade < Math.floor((Number.isFinite(cutoff) ? cutoff : decade) / 10) * 10;

    if (archiveIndex && !needsHistorical) {
      setHistoricalRows([]);
      setHistoricalLoading(false);
      return () => { cancelled = true; };
    }

    setHistoricalRows([]);
    setHistoricalLoading(true);

    const loadDecade = async () => {
      const filename = entry?.file || `race_results_archive_${decade}s.json`;
      try {
        const decadeRes = await fetch(`/data/${filename}`, { cache: "no-store" });
        if (decadeRes.ok) {
          const rows = await decadeRes.json();
          if (Array.isArray(rows)) return rows;
        }

        // Backwards-compatible fallback for workspaces that have not generated
        // the decade files yet.
        const archiveRes = await fetch("/data/race_results_archive.json", { cache: "no-store" });
        if (archiveRes.ok) {
          const archive = await archiveRes.json();
          if (Array.isArray(archive)) {
            return archive.filter((row) => Math.floor(Number(row?.year) / 10) * 10 === decade);
          }
        }

        const rawRes = await fetch("/data/race_results.json", { cache: "no-store" });
        if (!rawRes.ok) throw new Error(`HTTP ${rawRes.status}`);
        const raw = await rawRes.json();
        return Array.isArray(raw)
          ? raw.filter((row) => Math.floor(Number(pick(row, ["year","season_year","season"], NaN)) / 10) * 10 === decade)
          : [];
      } catch (error) {
        console.warn("[Results] historical race archive unavailable:", error);
        return [];
      }
    };

    loadDecade()
      .then((rows) => { if (!cancelled) setHistoricalRows(rows); })
      .finally(() => { if (!cancelled) setHistoricalLoading(false); });

    return () => { cancelled = true; };
  }, [decadeFilter, archiveIndex, careerStartYear]);

  const historicalResults = useMemo(() => {
    const cutoff = Number(careerStartYear);
    const decade = Number(decadeFilter);
    const isArchive = historicalRows.some((row) => Array.isArray(row?.classification));
    const normalized = isArchive
      ? historicalRows
      : makeHistoricalRaceEvents(historicalRows, driversDb, teamsDb, careerStartYear);

    return normalized.filter((row) => {
      const year = Number(row?.year);
      return Number.isFinite(year)
        && (!Number.isFinite(cutoff) || year < cutoff)
        && (!Number.isFinite(decade) || Math.floor(year / 10) * 10 === decade);
    });
  }, [historicalRows, driversDb, teamsDb, careerStartYear, decadeFilter]);

  const results = useMemo(() => {
    const decade = Number(decadeFilter);
    const careerForDecade = careerResults.filter((row) => {
      const year = Number(row?.year);
      return Number.isFinite(year) && (!Number.isFinite(decade) || Math.floor(year / 10) * 10 === decade);
    });
    const arr = [...historicalResults, ...careerForDecade];
    arr.sort((a, b) => {
      const ay = Number(a.year) || 0;
      const by = Number(b.year) || 0;
      if (ay !== by) return ay - by;
      const ar = Number(a.round) || 0;
      const br = Number(b.round) || 0;
      if (ar !== br) return ar - br;
      return String(a.key || "").localeCompare(String(b.key || ""));
    });
    return arr;
  }, [historicalResults, careerResults, decadeFilter]);

  const yearOptions = useMemo(() => {
    const years = new Set(results.map((r) => Number(r.year)).filter(Number.isFinite));
    const entry = (archiveIndex?.decades || []).find((item) => Number(item?.decade) === Number(decadeFilter));
    const cutoff = Number(careerStartYear);
    for (const year of entry?.years || []) {
      const y = Number(year);
      if (Number.isFinite(y) && (!Number.isFinite(cutoff) || y < cutoff)) years.add(y);
    }
    if (Number.isFinite(Number(activeYear)) && Math.floor(Number(activeYear)/10)*10 === Number(decadeFilter)) {
      years.add(Number(activeYear));
    }
    return [...years].sort((a,b) => b-a);
  }, [results, archiveIndex, decadeFilter, careerStartYear, activeYear]);

  useEffect(() => {
    if (!yearOptions.length) {
      setYearFilter("");
      return;
    }
    const active = Number(activeYear);
    const preferred = Number.isFinite(active)
      && Math.floor(active / 10) * 10 === Number(decadeFilter)
      && yearOptions.includes(active)
        ? active
        : yearOptions[0];
    if (!yearOptions.includes(Number(yearFilter))) {
      setYearFilter(String(preferred));
      setSelectedKey(null);
    }
  }, [yearOptions, activeYear, decadeFilter, yearFilter]);

  const yearScopedResults = useMemo(
    () => results.filter((r) => Number(r?.year) === Number(yearFilter)),
    [results, yearFilter]
  );

  const filteredResults = yearScopedResults;

  useEffect(() => {
    if (!filteredResults.length) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !filteredResults.some((r) => r.key === selectedKey)) {
      setSelectedKey(filteredResults[filteredResults.length - 1]?.key ?? null);
    }
  }, [filteredResults, selectedKey]);

  const selected = useMemo(
    () => filteredResults.find((r) => r.key === selectedKey) || filteredResults[filteredResults.length - 1] || null,
    [filteredResults, selectedKey]
  );

  const selectedGrid = useMemo(() => new Map(
    (selected?.startingGrid || []).map((row, index) => [
      String(row?.driver_id ?? ""),
      Number(row?.grid ?? index + 1),
    ])
  ), [selected]);

  const selectedQualifying = useMemo(() => new Map(
    (selected?.qualifying || []).map((row, index) => [
      String(row?.driver_id ?? ""),
      { position:Number(row?.position ?? index + 1), best_time_ms:row?.best_time_ms ?? null },
    ])
  ), [selected]);

  const selectedRows = useMemo(
    () => rowsWithCalculatedGaps(selected?.classification || []),
    [selected]
  );

  const selectedSummary = useMemo(() => {
    const rows = selected?.classification || [];
    const winner = rows.find((row) => Number(row?.position) === 1 && !row?.retired) || rows[0] || null;
    const fastest = selected?.historical ? null : rows.find((row) => row?.fastest_lap) || null;
    const pole = [...selectedQualifying.entries()].find(([, row]) => Number(row.position) === 1)?.[0] || null;
    const poleRow = pole ? rows.find((row) => rowDriverKey(row) === String(pole)) : null;
    return {
      winner: winner ? (winner?.driver_name || resolveDriverName(driversDb, winner.driver_id)) : "—",
      pole: pole ? (poleRow?.driver_name || resolveDriverName(driversDb, pole)) : "—",
      fastest: fastest ? (fastest?.driver_name || resolveDriverName(driversDb, fastest.driver_id)) : "—",
      dnfs: rows.filter((row) => historicalResultInfo(row).isDnf).length,
      pitStops: rows.reduce((sum, row) => sum + (Array.isArray(row?.pit_stops) ? row.pit_stops.length : Number(row?.strategy_summary?.pit_count || 0)), 0),
      weather: selected?.weather?.state || selected?.raceStrategy?.weather?.state || "—",
      laps: selected?.track?.laps || selected?.raceStrategy?.track?.laps || rows[0]?.race_laps || "—",
    };
  }, [selected, selectedQualifying, driversDb]);

  return (
    <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 grid gap-4">
      <div className="bg-[#12141c] border border-white/10 rounded-xl shadow-lg p-4">
        <h2 className="text-lg font-semibold">Results</h2>
        <p className="text-sm text-slate-400">
          Arquivo histórico anterior ao início da carreira + resultados simulados da tua carreira. O arquivo histórico é carregado por década para manter a página rápida.
        </p>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          <select
            aria-label="Decade"
            className="border border-white/10 bg-[#191c26] text-slate-100 rounded-md px-3 py-2 text-sm"
            value={decadeFilter ?? ""}
            onChange={(e)=>{
              setDecadeFilter(Number(e.target.value));
              setSelectedKey(null);
            }}
          >
            {decadeOptions.map((decade)=><option key={decade} value={decade}>{decade}s</option>)}
          </select>
          <select
            aria-label="Season"
            className="border border-white/10 bg-[#191c26] text-slate-100 rounded-md px-3 py-2 text-sm"
            value={yearFilter}
            onChange={(e)=>{
              setYearFilter(e.target.value);
              setSelectedKey(null);
            }}
          >
            {yearOptions.map((y)=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{filteredResults.length} race{filteredResults.length===1?"":"s"} shown</span>
          {historicalLoading ? <span>Loading historical archive…</span> : null}
        </div>

        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#171a23] text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left">Ano</th>
                <th className="px-3 py-2 text-left">Rnd</th>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-left">Winner</th>
                <th className="px-3 py-2 text-right">DNF</th>
                <th className="px-3 py-2 text-right">Starters</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.map((r) => (
                <tr
                  key={r.key}
                  className={`border-t border-white/10 cursor-pointer ${selected?.key === r.key ? "bg-white/10" : "hover:bg-white/5"}`}
                  onClick={() => setSelectedKey(r.key)}
                >
                  <td className="px-3 py-2">{r.year ?? "—"}</td>
                  <td className="px-3 py-2">{r.round ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <GrandPrixFlag gameState={gameState} record={r} size="sm"/>
                      <span>{r.name ?? r.gp_name ?? "—"}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">{(() => {
                    const winner=(r.classification||[]).find((row)=>Number(row?.position)===1&&!row?.retired);
                    return winner?.driver_name || resolveDriverName(driversDb,winner?.driver_id);
                  })()}</td>
                  <td className="px-3 py-2 text-right text-rose-300">{(r.classification||[]).filter((row)=>historicalResultInfo(row).isDnf).length}</td>
                  <td className="px-3 py-2 text-right">{(r.classification||[]).filter((row)=>historicalRaceStarted(row)).length}</td>
                </tr>
              ))}
              {!filteredResults.length && (
                <tr>
                  <td className="px-3 py-3 text-slate-400" colSpan={6}>Sem resultados ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="bg-[#12141c] border border-white/10 rounded-xl shadow-lg p-4">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <GrandPrixFlag gameState={gameState} record={selected} size="md"/>
            <span>
              {selected.name || selected.gp_name || "Grand Prix"}
              {selected.round ? <span className="text-slate-400"> · Round {selected.round}</span> : null}
            </span>
          </h3>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            <RaceMetric label="Winner" value={selectedSummary.winner}/>
            <RaceMetric label="Pole" value={selectedSummary.pole}/>
            <RaceMetric label="Fastest Lap" value={selectedSummary.fastest}/>
            <RaceMetric label="DNF" value={selectedSummary.dnfs}/>
            <RaceMetric label="Pit Stops" value={selectedSummary.pitStops}/>
            <RaceMetric label="Laps" value={selectedSummary.laps}/>
            <RaceMetric label="Weather" value={selectedSummary.weather}/>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#171a23] text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-right w-16">Pos</th>
                  <th className="px-3 py-2 text-right">Grid</th>
                  <th className="px-3 py-2 text-right">+/-</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Laps</th>
                  <th className="px-3 py-2 text-right">Stops</th>
                  <th className="px-3 py-2 text-right">Time</th>
                  <th className="px-3 py-2 text-right">To Winner</th>
                  <th className="px-3 py-2 text-right">Gap</th>
                  <th className="px-3 py-2 text-right">Best Lap</th>
                  <th className="px-3 py-2 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((row, idx) => {
                    const did = rowDriverKey(row);
                    const name = row?.driver_name || resolveDriverName(driversDb, did);
                    const tid = row.team_id || resolveTeamIdForYear(contractsDb, selected.year ?? activeYear, did);
                    const team = row?.team_name || resolveTeamNameById(teamsDb, tid);
                    const position = Number(row.position);
                    const resultInfo = historicalResultInfo(row);
                    const retired = resultInfo.isDnf;
                    const resultLabel = historicalResultDisplay(row);
                    const grid = selectedGrid.get(did) ?? null;
                    const positionsGained = resultInfo.key==="finished" && Number.isFinite(grid) && Number.isFinite(position) ? grid - position : null;
                    const stops = Array.isArray(row?.pit_stops) ? row.pit_stops.length : Number(row?.strategy_summary?.pit_count || 0);
                    const points = Number.isFinite(Number(row.points))
                      ? Number(row.points)
                      : selected?.historical
                        ? "—"
                        : retired
                          ? 0
                          : Number(pointsTable[position - 1] || 0);
                    return (
                      <tr key={`${did}_${idx}`} className="border-t border-white/10">
                        <td className={`px-3 py-2 text-right font-medium ${resultInfo.key==="dnf"?"text-rose-300":resultInfo.key==="finished"?"":"text-amber-300"}`}>{resultLabel}</td>
                        <td className="px-3 py-2 text-right">{grid ?? "—"}</td>
                        <td className={`px-3 py-2 text-right ${positionsGained>0?"text-emerald-300":positionsGained<0?"text-rose-300":""}`}>{positionsGained==null?"—":positionsGained>0?("+"+positionsGained):positionsGained}</td>
                        <td className="px-3 py-2">
                          <button type="button" data-entity="driver" data-id={did} className="flex items-center gap-3 font-medium hover:underline text-left">
                            <DriverPortrait driver={(driversDb || []).find((d)=>String(d?.driver_id ?? d?.id)===did) || { display_name:name }} size="h-9 w-9" />
                            <span>{name}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" data-entity="team" data-id={tid} className="inline-flex items-center gap-2 hover:underline">
                            <TeamLogo teamId={tid} name={team} size="h-8 w-8" />
                            <span>{team}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <span className={resultInfo.key==="dnf"?"text-rose-300":resultInfo.key==="finished"?"text-emerald-300":"text-amber-300"}>
                            {resultInfo.label}{retired && row.laps_completed ? ` · Lap ${row.laps_completed}` : ""}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">{row.laps_completed ?? row.race_laps ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{stops}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatRaceTime(row.total_time_ms)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGap(row.__toWinnerMs)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGap(row.__gapMs)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${!selected?.historical && row.fastest_lap ? "font-semibold text-purple-300" : ""}`}>
                          {selected?.historical ? "—" : <>{formatLapTime(row.best_lap_ms)}{row.fastest_lap ? " FL" : ""}</>}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{points}</td>
                      </tr>
                    );
                  })}
                {!selected.classification?.length && (
                  <tr>
                    <td className="px-3 py-3 text-slate-400" colSpan={13}>Sem classificação nesta corrida.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


function RaceMetric({label,value}) {
  return <div className="rounded-lg border border-white/10 bg-[#171a23] px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-0.5 font-semibold truncate">{value ?? "—"}</div>
  </div>;
}
