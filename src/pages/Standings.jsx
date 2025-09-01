// src/pages/Standings.jsx
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

function safeNum(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function normalizeDriverStandings(raw) {
  if (!Array.isArray(raw)) return [];
  const list = raw.map((r, i) => ({
    position: safeNum(r.position, i + 1),
    driver_id: r.driver_id ?? r.id ?? `D_${i + 1}`,
    driver_name: r.driver_name ?? r.name ?? "Driver",
    team_id: r.team_id ?? r.constructor_id ?? null,
    team_name: r.team_name ?? r.constructor_name ?? r.team ?? "",
    points: safeNum(r.points),
    wins: safeNum(r.wins),
    podiums: safeNum(r.podiums),
    races: safeNum(r.races),
  }));
  return list.sort((a, b) => (b.points - a.points) || (b.wins - a.wins));
}

function normalizeTeamStandings(raw) {
  if (!Array.isArray(raw)) return [];
  const list = raw.map((r, i) => ({
    position: safeNum(r.position, i + 1),
    team_id: r.team_id ?? r.id ?? `T_${i + 1}`,
    team_name: r.team_name ?? r.name ?? "Team",
    points: safeNum(r.points),
    wins: safeNum(r.wins),
    podiums: safeNum(r.podiums),
    races: safeNum(r.races),
  }));
  return list.sort((a, b) => (b.points - a.points) || (b.wins - a.wins));
}

function buildFallbackFromCalendar(calendar = []) {
  return {
    drivers: [],
    teams: [],
    seasonRounds: Array.from(new Set(calendar.map((c) => c.round))).filter(Boolean).length || 0,
    seasonYear: calendar[0]?.year ?? null,
  };
}

export default function Standings() {
  const { gameState } = useGame();
  const [tab, setTab] = useState("drivers");

  const { driversTable, teamsTable, seasonYear, seasonRounds } = useMemo(() => {
    const st = gameState?.standings || {};
    const drivers = normalizeDriverStandings(st.drivers || st.driver || st.pilots || []);
    const teams = normalizeTeamStandings(st.teams || st.constructors || []);
    const metaYear = st.year ?? gameState?.seasonYear ?? gameState?.calendar?.[0]?.year ?? null;
    const metaRounds =
      st.round || st.racesCompleted || Array.from(new Set((gameState?.calendar || []).map((c) => c.round))).filter(Boolean).length || 0;

    if (!drivers.length && !teams.length) {
      const fb = buildFallbackFromCalendar(gameState?.calendar || []);
      return {
        driversTable: [],
        teamsTable: [],
        seasonYear: fb.seasonYear ?? metaYear,
        seasonRounds: fb.seasonRounds ?? metaRounds,
      };
    }
    return { driversTable: drivers, teamsTable: teams, seasonYear: metaYear, seasonRounds: metaRounds };
  }, [gameState]);

  const leaderDriver = driversTable[0];
  const leaderTeam = teamsTable[0];

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">Standings</h1>
        <div className="text-sm text-muted-foreground">
          {seasonYear ? `Season ${seasonYear}` : "Season"} • {seasonRounds || 0} rounds
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <Button variant={tab === "drivers" ? "default" : "outline"} onClick={() => setTab("drivers")}>
          Drivers
        </Button>
        <Button variant={tab === "constructors" ? "default" : "outline"} onClick={() => setTab("constructors")}>
          Constructors
        </Button>
      </div>

      {/* Leaders snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Drivers’ Leader</div>
            {leaderDriver ? (
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  {leaderDriver.driver_name}
                  {leaderDriver.team_name ? <span className="text-muted-foreground"> — {leaderDriver.team_name}</span> : null}
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold">{leaderDriver.points} pts</div>
                  <div className="text-xs text-muted-foreground">{leaderDriver.wins} wins</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No data yet.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Constructors’ Leader</div>
            {leaderTeam ? (
              <div className="flex items-center justify-between">
                <div className="font-medium">{leaderTeam.team_name}</div>
                <div className="text-right">
                  <div className="text-xl font-semibold">{leaderTeam.points} pts</div>
                  <div className="text-xs text-muted-foreground">{leaderTeam.wins} wins</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No data yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tables */}
      {tab === "drivers" ? (
        <StandingsTableDrivers rows={driversTable} />
      ) : (
        <StandingsTableConstructors rows={teamsTable} />
      )}
    </div>
  );
}

function StandingsTableDrivers({ rows }) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-left">
              <th className="px-3 py-2 w-12">#</th>
              <th className="px-3 py-2">Driver</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2 text-right">Wins</th>
              <th className="px-3 py-2 text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                  No driver standings yet.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.driver_id} className={idx === 0 ? "bg-primary/5" : ""}>
                  <td className="px-3 py-2">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.driver_name}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.team_name}</td>
                  <td className="px-3 py-2 text-right">{r.wins}</td>
                  <td className="px-3 py-2 text-right font-semibold">{r.points}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function StandingsTableConstructors({ rows }) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-left">
              <th className="px-3 py-2 w-12">#</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2 text-right">Wins</th>
              <th className="px-3 py-2 text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  No constructor standings yet.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.team_id} className={idx === 0 ? "bg-primary/5" : ""}>
                  <td className="px-3 py-2">{idx + 1}</td>
                  <td className="px-3 py-2 font-medium">{r.team_name}</td>
                  <td className="px-3 py-2 text-right">{r.wins}</td>
                  <td className="px-3 py-2 text-right font-semibold">{r.points}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
