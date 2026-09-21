import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { DriverPortrait, TeamLogo } from "../components/entity/EntityVisuals.jsx";
import { currentDriverTeamId } from "../domain/driverContracts.js";
import { buildSeasonResultStats } from "../domain/seasonStats.js";

const str = (v) => (v == null ? "" : String(v));
const firstArray = (...items) => items.find(Array.isArray) || [];

function driverName(driver, fallback = "—") {
  return driver?.display_name || driver?.name || `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || fallback;
}

export default function Standings() {
  const gameState = useGame((s) => s.gameState);
  const [tab, setTab] = useState("teams");

  const driversDb = firstArray(gameState?.drivers, gameState?.dbDrivers);
  const teamsDb = firstArray(gameState?.teams, gameState?.dbTeams);
  const standings = gameState?.standings || { drivers: [], teams: [] };
  const results = Array.isArray(gameState?.results) ? gameState.results : [];
  const activeYear = gameState?.activeYear;

  const driversById = useMemo(
    () => new Map(driversDb.map((d) => [str(d?.driver_id ?? d?.id), d])),
    [driversDb]
  );
  const teamsById = useMemo(
    () => new Map(teamsDb.map((t) => [str(t?.team_id ?? t?.id), t])),
    [teamsDb]
  );

  const resolveTeam = useMemo(
    () => (driverId) => currentDriverTeamId(gameState, driverId),
    [gameState?.contracts, gameState?.dbContracts, activeYear]
  );

  const stats = useMemo(
    () => buildSeasonResultStats(results, activeYear, (driverId) => resolveTeam(driverId)),
    [results, activeYear, resolveTeam]
  );

  const driverRows = useMemo(() => {
    const source = firstArray(standings?.drivers, standings?.driver, standings?.pilots);
    return source
      .map((row) => {
        const id = str(row?.driver_id ?? row?.id ?? row?.driverId);
        const db = driversById.get(id);
        const st = stats.drivers.get(id) || {};
        const teamId = str(
          row?.team_id ??
          row?.constructor_id ??
          db?.team_id ??
          db?.constructor_id ??
          db?.team ??
          resolveTeam(id)
        );
        return {
          id,
          name: row?.name || driverName(db, id),
          teamId,
          teamName: teamsById.get(teamId)?.team_name || teamsById.get(teamId)?.name || teamId || "—",
          points: Number(row?.points || 0),
          races: Number(st.races ?? 0),
          wins: Number(st.wins ?? 0),
          podiums: Number(st.podiums ?? 0),
          fastestLaps: Number(st.fastestLaps ?? 0),
          driver: db || { driver_id: id, display_name: row?.name || id },
        };
      })
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }, [standings, driversById, teamsById, stats, resolveTeam, activeYear]);

  const teamRows = useMemo(() => {
    const source = firstArray(standings?.teams, standings?.constructors, standings?.team, standings?.constructor);
    const standingsByTeam = new Map(
      source.map((row) => [str(row?.team_id ?? row?.constructor_id ?? row?.id), row])
    );
    const pointsFromDrivers = new Map();
    for (const row of driverRows) {
      if (!row.teamId) continue;
      pointsFromDrivers.set(row.teamId, (pointsFromDrivers.get(row.teamId) || 0) + Number(row.points || 0));
    }

    const ids = new Set([
      ...teamsDb.map((team) => str(team?.team_id ?? team?.id)).filter(Boolean),
      ...standingsByTeam.keys(),
      ...pointsFromDrivers.keys(),
    ]);

    return Array.from(ids)
      .map((id) => {
        const row = standingsByTeam.get(id) || {};
        const db = teamsById.get(id);
        const st = stats.teams.get(id);
        return {
          id,
          name: row?.team_name || row?.name || db?.team_name || db?.name || id || "—",
          points: Number(row?.points ?? pointsFromDrivers.get(id) ?? 0),
          races: Number(st?.races?.size ?? 0),
          wins: Number(st?.wins ?? 0),
          podiums: Number(st?.podiums ?? 0),
          team: db || { team_id: id, team_name: row?.team_name || row?.name || id },
        };
      })
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }, [standings, teamsDb, teamsById, stats, driverRows]);

  const rows = tab === "drivers" ? driverRows : teamRows;

  return (
    <div className="grid gap-4">
      <div className="bg-white rounded-xl shadow p-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Standings</h2>
          <p className="text-sm text-gray-600">Season {activeYear ?? "—"}</p>
        </div>
        <div className="flex rounded-lg border p-1">
          <button onClick={() => setTab("teams")} className={`px-3 py-1.5 rounded-md text-sm ${tab === "teams" ? "bg-slate-900 text-white" : ""}`}>Constructors</button>
          <button onClick={() => setTab("drivers")} className={`px-3 py-1.5 rounded-md text-sm ${tab === "drivers" ? "bg-slate-900 text-white" : ""}`}>Drivers</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-right w-16">Pos</th>
              <th className="px-4 py-3 text-left">{tab === "drivers" ? "Driver" : "Team"}</th>
              {tab === "drivers" && <th className="px-4 py-3 text-left">Team</th>}
              <th className="px-4 py-3 text-right">Races</th>
              <th className="px-4 py-3 text-right">Wins</th>
              <th className="px-4 py-3 text-right">Podiums</th>
              {tab === "drivers" && <th className="px-4 py-3 text-right">FL</th>}
              <th className="px-4 py-3 text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id || `${tab}_${index}`} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2 text-right font-medium">{index + 1}</td>
                <td className="px-4 py-2">
                  {tab === "drivers" && row.id ? (
                    <button type="button" data-entity="driver" data-id={row.id} className="flex items-center gap-3 text-left font-medium hover:underline">
                      <DriverPortrait driver={row.driver} size="h-9 w-9" />
                      <span>{row.name}</span>
                    </button>
                  ) : row.id ? (
                    <button type="button" data-entity="team" data-id={row.id} className="flex items-center gap-3 text-left font-medium hover:underline">
                      <TeamLogo teamId={row.id} name={row.name} size="h-9 w-9" />
                      <span>{row.name}</span>
                    </button>
                  ) : row.name}
                </td>
                {tab === "drivers" && <td className="px-4 py-2"><span className="inline-flex items-center gap-2"><TeamLogo teamId={row.teamId} name={row.teamName} size="h-7 w-7" />{row.teamName}</span></td>}
                <td className="px-4 py-2 text-right">{row.races}</td>
                <td className="px-4 py-2 text-right">{row.wins}</td>
                <td className="px-4 py-2 text-right">{row.podiums}</td>
                {tab === "drivers" && <td className="px-4 py-2 text-right">{row.fastestLaps}</td>}
                <td className="px-4 py-2 text-right font-semibold">{row.points}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={tab === "drivers" ? 8 : 6} className="px-4 py-6 text-center text-gray-500">No standings yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
