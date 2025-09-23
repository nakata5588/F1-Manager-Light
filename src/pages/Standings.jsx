// src/pages/Standings.jsx
import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";

/* ===== Helpers ===== */
function firstArray(...cands) { for (const c of cands) if (Array.isArray(c)) return c; return []; }
function safeStr(v) { return v == null ? "" : String(v); }
function byAlpha(getKey) { return (a, b) => safeStr(getKey(a)).localeCompare(safeStr(getKey(b))); }
function toStr(id) { return id == null ? "" : String(id); }

/** Normaliza standings vindos do save em vários formatos */
function normalizeStandings(raw) {
  if (!raw) return { drivers: [], teams: [] };
  const drivers = firstArray(raw.drivers, raw.driver, raw.pilots);
  const constructors = firstArray(raw.constructors, raw.constructor);
  const teams = constructors.length ? constructors : firstArray(raw.teams, raw.team);
  return { drivers, teams };
}

/** Index rápido por id (string) */
function mapById(items, pickId) {
  const m = new Map();
  for (const it of items || []) {
    const id = pickId(it);
    if (id != null && id !== "") m.set(String(id), it);
  }
  return m;
}

/* ===== Pontos e Agregação ===== */
function getActivePointsTable(gs, season) {
  const cand =
    gs?.pointsTable ||
    gs?.pointsSystem?.table ||
    gs?.rules?.points_system?.table ||
    gs?.rules?.pointsSystem?.table ||
    gs?.dbPointsSystem?.table;
  if (Array.isArray(cand) && cand.length) return cand;
  if (cand && typeof cand === "object") {
    const maxPos = Math.max(...Object.keys(cand).map((k) => Number(k) || 0), 0);
    const arr = [];
    for (let p = 1; p <= maxPos; p++) arr.push(Number(cand[p] ?? 0) || 0);
    return arr;
  }
  // Fallback (2010+)
  return [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
}
function getPointsForPos(table, pos) {
  if (!pos || pos < 1) return 0;
  return Number(table[pos - 1] ?? 0) || 0;
}

/* ===== Keys e deteções ===== */
function getRaceKey(it, season) {
  const r =
    it?.race_id ?? it?.raceId ?? it?.round_id ?? it?.roundId ??
    it?.round ?? it?.gp_round ??
    it?.gp_id ?? it?.gpId ??
    it?.event_id ?? it?.eventId ??
    it?.race ?? it?.date ?? null;
  const name = it?.gp_name || it?.gpName || it?.event_name || it?.name || "";
  return String(season ?? "") + "|" + String(r ?? name);
}
function hasFastestLap(it) {
  const f = it?.fastest_lap ?? it?.fastestLap ?? it?.is_fastest_lap ?? it?.fastest ?? it?.fl;
  const rank = it?.fastest_lap_rank ?? it?.fastestLapRank ?? it?.fastest_lap_position ?? it?.fastestLapPosition;
  return Boolean(f === true || f === 1 || f === "1" || rank === 1 || rank === "1");
}

/** Itera classificações em MUITOS formatos */
function* iterateAllClassifications(gs) {
  // 1) flat
  if (Array.isArray(gs?.results)) {
    for (const r of gs.results) if (r && (r.driver_id || r.driverId) && (r.position != null)) yield r;
  }
  if (Array.isArray(gs?.classifications)) {
    for (const r of gs.classifications) if (r && (r.driver_id || r.driverId) && (r.position != null)) yield r;
  }
  if (Array.isArray(gs?.raceResults)) {
    for (const r of gs.raceResults) if (r && (r.driver_id || r.driverId) && (r.position != null)) yield r;
  }

  // 2) por GP/round
  for (const bag of [gs?.gpResults, gs?.roundResults, gs?.events]) {
    if (Array.isArray(bag)) {
      for (const gp of bag) {
        const klass = firstArray(gp?.classification, gp?.results, gp?.classifications);
        for (const r of klass) yield { ...r, gp_id: gp?.gp_id ?? gp?.gpId ?? gp?.round ?? gp?.id ?? gp?.event_id };
      }
    }
  }

  // 3) races com classification
  if (Array.isArray(gs?.races)) {
    for (const race of gs.races) {
      const klass = firstArray(race?.classification, race?.results, race?.classifications);
      for (const r of klass) yield { ...r, race_id: race?.race_id ?? race?.raceId ?? race?.round ?? race?.id };
    }
  }

  // 4) calendar[*].classification
  if (Array.isArray(gs?.calendar)) {
    for (const cal of gs.calendar) {
      const klass = firstArray(cal?.classification, cal?.results, cal?.classifications);
      for (const r of klass) yield { ...r, race_id: cal?.track_id ?? cal?.round ?? cal?.gp_id ?? cal?.id };
    }
  }
}

/** team_id do item ou via contracts → senão, tenta DB */
function resolveTeamIdForDriver({ item, season, contractsByDriver, driversById }) {
  const explicit = item?.team_id ?? item?.constructor_id ?? item?.teamId ?? item?.constructorId ?? null;
  if (explicit != null) return String(explicit);

  const did = toStr(item?.driver_id ?? item?.id ?? item?.driverId ?? "");
  if (!did) return null;

  const arr = contractsByDriver.get(did) || [];
  const found = arr.find((c) => {
    const y = c.year == null || season == null || String(c.year) === String(season);
    const role = String(c.role || "").toLowerCase();
    const isDriver = role.includes("driver"); // cobre main_driver/second_driver/test_driver
    const pid = toStr(c.person_id ?? c.driver_id ?? c.id ?? "");
    return y && isDriver && pid === did;
  });
  if (found?.team_id != null) return String(found.team_id);

  // fallback DB (se existir team_id atual no registo do driver)
  const d = driversById.get(did);
  if (d?.team_id != null) return String(d.team_id);
  return null;
}

/** Agrega pontos e estatísticas a partir de resultados */
function aggregateFromResults({ gameState, season, contracts, driversById }) {
  const table = getActivePointsTable(gameState, season);

  // contratos por piloto
  const contractsByDriver = new Map();
  for (const c of contracts || []) {
    const pid = toStr(c.person_id ?? c.driver_id ?? c.id ?? "");
    if (!pid) continue;
    if (!contractsByDriver.has(pid)) contractsByDriver.set(pid, []);
    contractsByDriver.get(pid).push(c);
  }

  const driver = new Map(); // id -> {points, races:Set, wins, podiums, fl, lastTeamId}
  const team   = new Map(); // id -> {points, races:Set, wins, podiums, fl}

  for (const item of iterateAllClassifications(gameState)) {
    const did = toStr(item?.driver_id ?? item?.id ?? item?.driverId ?? "");
    if (!did) continue;

    const pos = Number(item?.position ?? item?.pos ?? item?.finish_position);
    const pts = getPointsForPos(table, pos);
    const fl = hasFastestLap(item);
    const raceKey = getRaceKey(item, season);
    const tid = resolveTeamIdForDriver({ item, season, contractsByDriver, driversById });

    // driver
    if (!driver.has(did)) driver.set(did, { points: 0, races: new Set(), wins: 0, podiums: 0, fl: 0, lastTeamId: null });
    const d = driver.get(did);
    if (pts > 0) d.points += pts;
    d.races.add(raceKey);
    if (pos === 1) d.wins += 1;
    if (pos >= 1 && pos <= 3) d.podiums += 1;
    if (fl) d.fl += 1;
    if (tid != null) d.lastTeamId = tid;

    // team
    if (tid != null) {
      if (!team.has(tid)) team.set(tid, { points: 0, races: new Set(), wins: 0, podiums: 0, fl: 0 });
      const t = team.get(tid);
      if (pts > 0) t.points += pts;
      t.races.add(raceKey);
      if (pos === 1) t.wins += 1;
      if (pos >= 1 && pos <= 3) t.podiums += 1;
      if (fl) t.fl += 1;
    }
  }

  return { driverStats: driver, teamStats: team };
}

/* ===== Logos por ano (fallback inteligente) ===== */
function teamLogoPath(teamRec, season) {
  const p1 = teamRec?.logo_path || teamRec?.brand_logo;
  if (p1) return p1;
  const id = toStr(teamRec?.team_id ?? teamRec?.id ?? teamRec?.teamId);
  if (!id) return null;
  // Ajusta estes caminhos se usares outra pasta:
  const y = season ? String(season) : null;
  if (y) {
    // tenta {id}_{year}.png
    const byYear = `/logos/${id}_${y}.png`;
    return byYear; // o onError do <img> oculta se não existir
  }
  return `/logos/${id}.png`;
}

export default function Standings() {
  const gameState = useGame((s) => s.gameState);
  const [tab, setTab] = useState("teams"); // "teams" | "drivers"

  if (!gameState) {
    return (
      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="text-base font-semibold">No save loaded</h3>
        <p className="text-sm text-gray-600 mt-1">Load or start a new game to see standings.</p>
      </div>
    );
  }

  // DBs/base
  const season     = gameState.activeYear ?? gameState.season ?? null;
  const driversDb  = firstArray(gameState.drivers, gameState.dbDrivers);
  const teamsDb    = firstArray(gameState.teams, gameState.dbTeams);
  const contracts  = firstArray(gameState.contracts, gameState.dbContracts);
  const standings0 = normalizeStandings(gameState.standings);

  // Índices úteis
  const driversById   = useMemo(() => mapById(driversDb, (d) => d.driver_id ?? d.id ?? d.driverId), [driversDb]);
  const teamsById     = useMemo(() => mapById(teamsDb, (t) => t.team_id ?? t.id ?? t.teamId), [teamsDb]);
  const teamNameById  = (id) => teamsById.get(String(id))?.team_name || teamsById.get(String(id))?.name || "";
  const teamLogoById  = (id) => {
    const rec = teamsById.get(String(id));
    return rec ? teamLogoPath(rec, season) : null;
  };

  // Existem resultados?
  const resultsExist =
    (function () {
      if (Array.isArray(gameState?.results) && gameState.results.length) return true;
      if (Array.isArray(gameState?.classifications) && gameState.classifications.length) return true;
      if (Array.isArray(gameState?.raceResults) && gameState.raceResults.length) return true;
      if (Array.isArray(gameState?.gpResults) && gameState.gpResults.length) return true;
      if (Array.isArray(gameState?.roundResults) && gameState.roundResults.length) return true;
      if (Array.isArray(gameState?.events) && gameState.events.length) return true;
      if (Array.isArray(gameState?.races) && gameState.races.length) return true;
      if (Array.isArray(gameState?.calendar) && gameState.calendar.some(c => Array.isArray(c?.classification) && c.classification.length)) return true;
      return false;
    })();

  // Agregação dinâmica
  const aggregation = useMemo(() => {
    return resultsExist
      ? aggregateFromResults({ gameState, season, contracts, driversById })
      : { driverStats: new Map(), teamStats: new Map() };
  }, [gameState, season, contracts, driversById, resultsExist]);

  /* ====== DRIVERS ====== */
  const driverStandings = useMemo(() => {
    // standings vindas do save (podem ter stats)
    const sMap = new Map();
    for (const r of standings0.drivers) {
      const id = String(r.driver_id ?? r.id ?? r.driverId ?? "");
      if (!id) continue;
      sMap.set(id, {
        points: Number(r.points ?? 0) || 0,
        position: r.position ?? null,
        team_id: r.team_id ?? r.constructor_id ?? r.teamId ?? null,
        races: Number(r.races ?? r.starts ?? 0) || 0,
        wins: Number(r.wins ?? 0) || 0,
        podiums: Number(r.podiums ?? r.pods ?? 0) || 0,
        fl: Number(r.fastest_laps ?? r.fastestLaps ?? r.fastests ?? 0) || 0,
      });
    }

    const rows = [];
    for (const d of driversDb) {
      const id = String(d.driver_id ?? d.id ?? d.driverId ?? "");
      if (!id) continue;

      const fromStand = sMap.get(id) || {};
      let points = fromStand.points || 0;

      // stats por default: do standings
      let races   = fromStand.races || 0;
      let wins    = fromStand.wins || 0;
      let podiums = fromStand.podiums || 0;
      let fl      = fromStand.fl || 0;

      // equipa por default: standings
      let team_id = fromStand.team_id ?? null;

      // override por agregação (se existirem resultados)
      const agg = aggregation.driverStats.get(id);
      if (agg) {
        if ((points ?? 0) === 0 && (agg.points ?? 0) > 0) points = agg.points;
        // Só substitui stats se standings não trouxerem (ou forem 0)
        if (races === 0)   races   = agg.races?.size ?? 0;
        if (wins === 0)    wins    = agg.wins ?? 0;
        if (podiums === 0) podiums = agg.podiums ?? 0;
        if (fl === 0)      fl      = agg.fl ?? 0;
        if (!team_id && agg.lastTeamId) team_id = agg.lastTeamId;
      }

      // fallback contracts/DB se ainda não tivermos team_id
      if (!team_id) {
        for (const c of contracts) {
          const pid = toStr(c.person_id ?? c.driver_id ?? c.id ?? "");
          const role = String(c.role || "").toLowerCase();
          const sameYear = season == null || c.year == null || String(c.year) === String(season);
          if (sameYear && pid === id && role.includes("driver") && c.team_id) { team_id = String(c.team_id); break; }
        }
        if (!team_id && d.team_id) team_id = String(d.team_id);
      }

      rows.push({
        driver_id: id,
        display_name: d.display_name || d.name || `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim(),
        portrait_path: d.portrait_path || null,
        team_id: team_id ?? null,
        team_name: teamNameById(team_id) || d.team_name || "",
        team_logo: teamLogoById(team_id),
        points: points || 0,
        races, wins, podiums, fl,
      });
    }

    const allZero = rows.every((r) => (r.points ?? 0) === 0);
    rows.sort(
      allZero
        ? byAlpha((r) => r.display_name)
        : (a, b) =>
            (b.points ?? 0) - (a.points ?? 0) ||
            (b.wins ?? 0) - (a.wins ?? 0) ||
            (b.podiums ?? 0) - (a.podiums ?? 0) ||
            safeStr(a.display_name).localeCompare(safeStr(b.display_name))
    );
    rows.forEach((r, i) => (r.position = i + 1));
    return rows;
  }, [driversDb, contracts, season, standings0.drivers, teamsById, aggregation]);

  /* ====== TEAMS ====== */
  const teamStandings = useMemo(() => {
    const sMap = new Map();
    for (const r of standings0.teams) {
      const id = String(r.team_id ?? r.id ?? r.teamId ?? r.constructor_id ?? "");
      if (!id) continue;
      sMap.set(id, {
        points: Number(r.points ?? 0) || 0,
        position: r.position ?? null,
        races: Number(r.races ?? r.starts ?? 0) || 0,
        wins: Number(r.wins ?? 0) || 0,
        podiums: Number(r.podiums ?? r.pods ?? 0) || 0,
        fl: Number(r.fastest_laps ?? r.fastestLaps ?? r.fastests ?? 0) || 0,
      });
    }

    // construir…
    let rows = [];
    for (const t of teamsDb) {
      const id = String(t.team_id ?? t.id ?? t.teamId ?? "");
      if (!id) continue;
      const base = sMap.get(id) || { points: 0, races: 0, wins: 0, podiums: 0, fl: 0 };

      rows.push({
        team_id: id,
        team_name: t.team_name || t.name || "Team",
        logo_path: teamLogoPath(t, season),
        points: base.points,
        races: base.races,
        wins: base.wins,
        podiums: base.podiums,
        fl: base.fl,
      });
    }

    // Se standings estão a zeros mas existem resultados → usar agregação
    const allZero = rows.every((r) => (r.points ?? 0) === 0);
    if (allZero && aggregation.teamStats.size) {
      rows = rows.map((r) => {
        const agg = aggregation.teamStats.get(r.team_id);
        return {
          ...r,
          points: agg?.points ?? r.points,
          races: (agg?.races?.size ?? 0) || r.races,
          wins: (agg?.wins ?? 0) || r.wins,
          podiums: (agg?.podiums ?? 0) || r.podiums,
          fl: (agg?.fl ?? 0) || r.fl,
        };
      });
    }

    const allZeroFinal = rows.every((r) => (r.points ?? 0) === 0);
    rows.sort(
      allZeroFinal
        ? byAlpha((r) => r.team_name)
        : (a, b) =>
            (b.points ?? 0) - (a.points ?? 0) ||
            (b.wins ?? 0) - (a.wins ?? 0) ||
            (b.podiums ?? 0) - (a.podiums ?? 0) ||
            safeStr(a.team_name).localeCompare(safeStr(b.team_name))
    );
    rows.forEach((r, i) => (r.position = i + 1));
    return rows;
  }, [teamsDb, standings0.teams, aggregation, season]);

  return (
    <div className="grid gap-4">
      {/* Header + Tabs */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Standings {season ? `• ${season}` : ""}</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setTab("teams")}
              className={`px-3 py-1.5 text-sm rounded ${tab === "teams" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
            >
              Constructors
            </button>
            <button
              onClick={() => setTab("drivers")}
              className={`px-3 py-1.5 text-sm rounded ${tab === "drivers" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
            >
              Drivers
            </button>
          </div>
        </div>
      </div>

      {/* Tables */}
      {tab === "teams" ? (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-4 py-2 w-14">Pos</th>
                <th className="px-4 py-2">Team</th>
                <th className="px-2 py-2 text-right">Races</th>
                <th className="px-2 py-2 text-right">Wins</th>
                <th className="px-2 py-2 text-right">Podiums</th>
                <th className="px-2 py-2 text-right">Fastest</th>
                <th className="px-4 py-2 w-24 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {teamStandings.map((r) => (
                <tr key={r.team_id} className="border-t">
                  <td className="px-4 py-2">P{r.position}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      {r.logo_path ? (
                        <img
                          src={r.logo_path}
                          alt={r.team_name}
                          className="h-6 w-6 object-contain"
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      ) : (
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded bg-gray-100 text-[10px] font-semibold">
                          {r.team_name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <button
                        type="button"
                        data-entity="team"
                        data-id={r.team_id}
                        className="text-blue-600 hover:underline cursor-pointer bg-transparent"
                      >
                        {r.team_name}
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">{r.races}</td>
                  <td className="px-2 py-2 text-right">{r.wins}</td>
                  <td className="px-2 py-2 text-right">{r.podiums}</td>
                  <td className="px-2 py-2 text-right">{r.fl}</td>
                  <td className="px-4 py-2 text-right font-semibold">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!teamStandings.length && (
            <div className="px-4 py-6 text-sm text-gray-600">No teams found.</div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-4 py-2 w-14">Pos</th>
                <th className="px-4 py-2">Driver</th>
                <th className="px-4 py-2">Team</th>
                <th className="px-2 py-2 text-right">Races</th>
                <th className="px-2 py-2 text-right">Wins</th>
                <th className="px-2 py-2 text-right">Podiums</th>
                <th className="px-2 py-2 text-right">Fastest</th>
                <th className="px-4 py-2 w-24 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {driverStandings.map((r) => (
                <tr key={r.driver_id} className="border-t">
                  <td className="px-4 py-2">P{r.position}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      {r.portrait_path ? (
                        <img
                          src={r.portrait_path}
                          alt={r.display_name}
                          className="h-7 w-7 rounded object-cover"
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      ) : (
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded bg-gray-100 text-[10px] font-semibold">
                          {r.display_name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <button
                        type="button"
                        data-entity="driver"
                        data-id={r.driver_id}
                        className="text-blue-600 hover:underline cursor-pointer bg-transparent"
                      >
                        {r.display_name}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {r.team_id ? (
                      <div className="flex items-center gap-2">
                        {r.team_logo ? (
                          <img
                            src={r.team_logo}
                            alt={r.team_name}
                            className="h-5 w-5 object-contain"
                            onError={(e) => (e.currentTarget.style.display = "none")}
                          />
                        ) : null}
                        <button
                          type="button"
                          data-entity="team"
                          data-id={r.team_id}
                          className="text-blue-600 hover:underline cursor-pointer bg-transparent"
                        >
                          {r.team_name || "—"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">{r.races}</td>
                  <td className="px-2 py-2 text-right">{r.wins}</td>
                  <td className="px-2 py-2 text-right">{r.podiums}</td>
                  <td className="px-2 py-2 text-right">{r.fl}</td>
                  <td className="px-4 py-2 text-right font-semibold">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!driverStandings.length && (
            <div className="px-4 py-6 text-sm text-gray-600">No drivers found.</div>
          )}
        </div>
      )}
    </div>
  );
}
