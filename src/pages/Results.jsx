// src/pages/Results.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../state/GameStore";

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

  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    if (!results.length) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !results.some((r) => r.key === selectedKey)) {
      setSelectedKey(results[results.length - 1]?.key ?? null);
    }
  }, [results, selectedKey]);

  const selected = useMemo(
    () => results.find((r) => r.key === selectedKey) || results[results.length - 1] || null,
    [results, selectedKey]
  );

  return (
    <div className="grid gap-4">
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="text-lg font-semibold">Results</h2>
        <p className="text-sm text-gray-600">
          Todas as corridas disputadas nesta carreira. Seleciona uma corrida para ver a classificação.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Ano</th>
                <th className="px-3 py-2 text-left">Rnd</th>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-right">Classificados</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.key}
                  className={`border-t cursor-pointer ${selected?.key === r.key ? "bg-blue-50" : "hover:bg-gray-50"}`}
                  onClick={() => setSelectedKey(r.key)}
                >
                  <td className="px-3 py-2">{r.year ?? "—"}</td>
                  <td className="px-3 py-2">{r.round ?? "—"}</td>
                  <td className="px-3 py-2">{r.name ?? r.gp_name ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.classification?.length ?? 0}</td>
                </tr>
              ))}
              {!results.length && (
                <tr>
                  <td className="px-3 py-3 text-gray-600" colSpan={4}>Sem resultados ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="bg-white rounded-xl shadow p-4">
          <h3 className="text-base font-semibold">
            {selected.name || selected.gp_name || "Grand Prix"}
            {selected.round ? <span className="text-gray-500"> · Round {selected.round}</span> : null}
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-right w-16">Pos</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-left">Notas</th>
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
                    return (
                      <tr key={`${did}_${idx}`} className="border-t">
                        <td className="px-3 py-2 text-right font-medium">{row.position ?? "—"}</td>
                        <td className="px-3 py-2">{name}</td>
                        <td className="px-3 py-2">{team}</td>
                        <td className="px-3 py-2">{row.fastest_lap ? "FL" : "—"}</td>
                      </tr>
                    );
                  })}
                {!selected.classification?.length && (
                  <tr>
                    <td className="px-3 py-3 text-gray-600" colSpan={4}>Sem classificação nesta corrida.</td>
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
