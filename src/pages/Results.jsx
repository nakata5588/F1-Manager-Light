// src/pages/Results.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../state/GameStore";
import { DriverPortrait, TeamLogo } from "../components/entity/EntityVisuals.jsx";

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

export default function ResultsPage() {
  const gameState = useGame((s) => s.gameState);

  const driversDb = useMemo(() => gameState?.drivers || gameState?.dbDrivers || [], [gameState]);
  const teamsDb = useMemo(() => gameState?.teams || gameState?.dbTeams || [], [gameState]);
  const contractsDb = useMemo(() => gameState?.contracts || gameState?.dbContracts || [], [gameState]);
  const activeYear = gameState?.activeYear;
  const pointsTable = useMemo(() => pointsTableFromState(gameState), [gameState?.pointsSystem]);

  const resultsRaw = useMemo(() => {
    if (Array.isArray(gameState?.results) && gameState.results.length) return gameState.results;
    const legacy = normalizeLegacyLastRace(gameState?.lastRace, activeYear);
    return legacy ? [legacy] : [];
  }, [gameState?.results, gameState?.lastRace, activeYear]);

  const results = useMemo(() => {
    const arr = resultsRaw.slice();
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
  }, [resultsRaw]);

  const [yearFilter, setYearFilter] = useState(() => String(activeYear ?? "ALL"));
  const [driverFilter, setDriverFilter] = useState("ALL");
  const [gpFilter, setGpFilter] = useState("ALL");
  const [selectedKey, setSelectedKey] = useState(null);

  const yearOptions = useMemo(() => {
    const years = new Set(results.map((r) => Number(r.year)).filter(Number.isFinite));
    if (Number.isFinite(Number(activeYear))) years.add(Number(activeYear));
    return ["ALL", ...Array.from(years).sort((a,b)=>a-b)];
  }, [results, activeYear]);

  useEffect(() => {
    setYearFilter(String(activeYear ?? "ALL"));
    setDriverFilter("ALL");
    setGpFilter("ALL");
    setSelectedKey(null);
  }, [activeYear]);
  const gpOptions = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      const key = String(r.gp_id ?? r.name ?? r.gp_name ?? "");
      if (key) map.set(key, r.name ?? r.gp_name ?? key);
    }
    return [["ALL","All Grands Prix"], ...Array.from(map.entries()).sort((a,b)=>String(a[1]).localeCompare(String(b[1])))];
  }, [results]);
  const driverOptions = useMemo(() => {
    const ids = new Set();
    for (const r of results) for (const row of r.classification || []) if (row?.driver_id != null) ids.add(String(row.driver_id));
    return [["ALL","All Drivers"], ...Array.from(ids).map((id)=>[id,resolveDriverName(driversDb,id)]).sort((a,b)=>a[1].localeCompare(b[1]))];
  }, [results, driversDb]);

  const filteredResults = useMemo(() => results.filter((r) => {
    if (yearFilter !== "ALL" && Number(r.year) !== Number(yearFilter)) return false;
    const gpKey = String(r.gp_id ?? r.name ?? r.gp_name ?? "");
    if (gpFilter !== "ALL" && gpKey !== gpFilter) return false;
    if (driverFilter !== "ALL" && !(r.classification || []).some((row) => String(row?.driver_id) === String(driverFilter))) return false;
    return true;
  }), [results, yearFilter, driverFilter, gpFilter]);

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

  const selectedSummary = useMemo(() => {
    const rows = selected?.classification || [];
    const winner = rows.find((row) => Number(row?.position) === 1 && !row?.retired) || rows[0] || null;
    const fastest = rows.find((row) => row?.fastest_lap) || null;
    const pole = [...selectedQualifying.entries()].find(([, row]) => Number(row.position) === 1)?.[0] || null;
    return {
      winner: winner ? resolveDriverName(driversDb, winner.driver_id) : "—",
      pole: pole ? resolveDriverName(driversDb, pole) : "—",
      fastest: fastest ? resolveDriverName(driversDb, fastest.driver_id) : "—",
      dnfs: rows.filter((row) => row?.retired || String(row?.status || "").toUpperCase() === "DNF").length,
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
          Todas as corridas disputadas nesta carreira. Seleciona uma corrida para ver a classificação.
        </p>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          <select className="border border-white/10 bg-[#191c26] text-slate-100 rounded-md px-3 py-2 text-sm" value={yearFilter} onChange={(e)=>setYearFilter(e.target.value)}>
            {yearOptions.map((y)=><option key={y} value={y}>{y==="ALL"?"All years":y}</option>)}
          </select>
          <select className="border border-white/10 bg-[#191c26] text-slate-100 rounded-md px-3 py-2 text-sm" value={driverFilter} onChange={(e)=>setDriverFilter(e.target.value)}>
            {driverOptions.map(([id,name])=><option key={id} value={id}>{name}</option>)}
          </select>
          <select className="border border-white/10 bg-[#191c26] text-slate-100 rounded-md px-3 py-2 text-sm" value={gpFilter} onChange={(e)=>setGpFilter(e.target.value)}>
            {gpOptions.map(([id,name])=><option key={id} value={id}>{name}</option>)}
          </select>
        </div>

        <div className="mt-3 overflow-x-auto">
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
                  <td className="px-3 py-2">{r.name ?? r.gp_name ?? "—"}</td>
                  <td className="px-3 py-2">{resolveDriverName(driversDb,(r.classification||[]).find((row)=>Number(row?.position)===1&&!row?.retired)?.driver_id)}</td>
                  <td className="px-3 py-2 text-right text-rose-300">{(r.classification||[]).filter((row)=>row?.retired||String(row?.status||"").toUpperCase()==="DNF").length}</td>
                  <td className="px-3 py-2 text-right">{r.classification?.length ?? 0}</td>
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
          <h3 className="text-base font-semibold">
            {selected.name || selected.gp_name || "Grand Prix"}
            {selected.round ? <span className="text-slate-400"> · Round {selected.round}</span> : null}
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
                  <th className="px-3 py-2 text-left">Strategy</th>
                  <th className="px-3 py-2 text-right">Time</th>
                  <th className="px-3 py-2 text-right">To Winner</th>
                  <th className="px-3 py-2 text-right">Gap</th>
                  <th className="px-3 py-2 text-right">Best Lap</th>
                  <th className="px-3 py-2 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {(selected.classification || [])
                  .slice()
                  .sort((a, b) => (Number(a.position) || Infinity) - (Number(b.position) || Infinity))
                  .map((row, idx) => {
                    const did = String(row.driver_id ?? "");
                    const name = resolveDriverName(driversDb, did);
                    const tid = row.team_id || resolveTeamIdForYear(contractsDb, selected.year ?? activeYear, did);
                    const team = resolveTeamNameById(teamsDb, tid);
                    const position = Number(row.position);
                    const retired = row?.retired || String(row?.status||"").toUpperCase()==="DNF";
                    const grid = selectedGrid.get(did) ?? null;
                    const positionsGained = Number.isFinite(grid) && Number.isFinite(position) ? grid - position : null;
                    const stops = Array.isArray(row?.pit_stops) ? row.pit_stops.length : Number(row?.strategy_summary?.pit_count || 0);
                    const strategy = row?.strategy_summary || {};
                    const tyres = Array.isArray(strategy?.used_tyres) ? strategy.used_tyres.filter(Boolean).join(" → ") : "";
                    const points = retired
                      ? 0
                      : Number.isFinite(Number(row.points))
                        ? Number(row.points)
                        : Number(pointsTable[position - 1] || 0);
                    return (
                      <tr key={`${did}_${idx}`} className="border-t border-white/10">
                        <td className="px-3 py-2 text-right font-medium">{retired ? "DNF" : (row.position ?? "—")}</td>
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
                          {retired
                            ? <span className="text-rose-300">{row.retirement_reason || "Retired"}{row.laps_completed ? ` · Lap ${row.laps_completed}` : ""}</span>
                            : <span className="text-emerald-300">Finished</span>}
                        </td>
                        <td className="px-3 py-2 text-right">{row.laps_completed ?? row.race_laps ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{stops}</td>
                        <td className="px-3 py-2 min-w-[180px]">
                          <div className="text-xs">{strategy.pit_plan ? String(strategy.pit_plan).replaceAll("_"," ") : "—"}</div>
                          <div className="text-[10px] text-slate-500">{tyres || (row.start_tyre_id ? `${row.start_tyre_id} → ${row.finish_tyre_id || "—"}` : "")}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{retired ? "—" : formatRaceTime(row.total_time_ms)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGap(row.gap_to_winner_ms)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGap(row.gap_to_previous_ms)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${row.fastest_lap ? "font-semibold text-purple-300" : ""}`}>
                          {formatLapTime(row.best_lap_ms)}{row.fastest_lap ? " FL" : ""}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{points}</td>
                      </tr>
                    );
                  })}
                {!selected.classification?.length && (
                  <tr>
                    <td className="px-3 py-3 text-slate-400" colSpan={14}>Sem classificação nesta corrida.</td>
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
