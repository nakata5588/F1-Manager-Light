// src/components/entity/SeasonSummaryModal.jsx
import React from "react";
import { useGame } from "@/state/GameStore";

function Podium({ title, items, getName }) {
  const top3 = (items || []).slice(0, 3);
  if (!top3.length) return null;

  // ordem visual: 2º (esq) 1º (centro alto) 3º (dir)
  const visual = [top3[1], top3[0], top3[2]];

  return (
    <div className="flex-1 bg-white rounded-xl shadow border">
      <div className="px-4 py-3 border-b">
        <h4 className="font-semibold">{title}</h4>
      </div>
      <div className="flex items-end justify-center gap-4 px-4 py-5">
        {visual.map((it, idx) => {
          const place = [2, 1, 3][idx];
          const heights = { 1: "h-28", 2: "h-20", 3: "h-16" };
          const barClass = `w-20 ${heights[place]} rounded-t-xl flex items-end justify-center bg-gray-100 border`;
          return (
            <div key={idx} className="flex flex-col items-center gap-2">
              <div className={barClass}>
                <span className="mb-2 text-sm font-semibold">#{place}</span>
              </div>
              <div className="max-w-[10rem] text-center text-sm">
                {it ? getName(it) : <span className="opacity-60">—</span>}
              </div>
              <div className="text-xs tabular-nums opacity-70">
                {it?.points ?? 0} pts
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SeasonSummaryModal() {
  const { gameState, setGameState, rolloverSeason } = useGame();

  const visible = Boolean(gameState?.showSeasonSummary);
  if (!visible) return null;

  const year = gameState?.lastSeason ?? gameState?.activeYear ?? 1980;
  const nextYear = (gameState?.activeYear || 1980) + 1;

  const standings = gameState?.standings || { drivers: [], teams: [] };
  const drivers = Array.isArray(standings.drivers) ? standings.drivers : [];
  const teams = Array.isArray(standings.teams) ? standings.teams : [];

  const driverRest = drivers.slice(3);
  const teamRest = teams.slice(3);

  const close = () => setGameState({ showSeasonSummary: false });

  const onStartNextSeason = async () => {
    setGameState({ showSeasonSummary: false });
    await rolloverSeason(nextYear);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={close} aria-hidden="true" />

      {/* card */}
      <div className="relative z-10 w-[min(96vw,1000px)] max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-xl sm:text-2xl font-semibold">Season {year} Summary</h2>
          <button className="rounded-md px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200" onClick={close}>
            Close
          </button>
        </header>

        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          {/* Double podium row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Podium
              title="Drivers' Podium"
              items={drivers}
              getName={(d) => d.name ?? d.display_name ?? d.code ?? "—"}
            />
            <Podium
              title="Constructors' Podium"
              items={teams}
              getName={(t) => t.name ?? t.team_name ?? "—"}
            />
          </div>

          {/* Lists from 4th place */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section>
              <h3 className="text-lg font-semibold mb-2">Drivers (4th and below)</h3>
              {driverRest.length ? (
                <ol className="space-y-1">
                  {driverRest.map((d, i) => (
                    <li
                      key={`${d.id ?? d.driver_id ?? d.name ?? i}_${i}`}
                      className="grid grid-cols-[4ch_1fr_auto] gap-3 items-center text-sm sm:text-base"
                    >
                      <span className="tabular-nums opacity-70">{i + 4}.</span>
                      <span className="truncate">{d.name ?? d.display_name ?? d.code ?? "—"}</span>
                      <span className="tabular-nums font-medium">{d.points ?? 0} pts</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-gray-500">No more drivers to show.</p>
              )}
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">Teams (4th and below)</h3>
              {teamRest.length ? (
                <ol className="space-y-1">
                  {teamRest.map((t, i) => (
                    <li
                      key={`${t.id ?? t.team_id ?? t.name ?? i}_${i}`}
                      className="grid grid-cols-[4ch_1fr_auto] gap-3 items-center text-sm sm:text-base"
                    >
                      <span className="tabular-nums opacity-70">{i + 4}.</span>
                      <span className="truncate">{t.name ?? t.team_name ?? "—"}</span>
                      <span className="tabular-nums font-medium">{t.points ?? 0} pts</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-gray-500">No more teams to show.</p>
              )}
            </section>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          <button className="rounded-lg px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300" onClick={close}>
            Close
          </button>
          <button
            className="rounded-lg px-4 py-2 text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700"
            onClick={onStartNextSeason}
          >
            Start {nextYear}
          </button>
        </footer>
      </div>
    </div>
  );
}
