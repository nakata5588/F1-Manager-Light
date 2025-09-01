import React, { useMemo } from "react";
import { useGame } from "../state/GameStore.js";
import NextGpCard from "../components/tiles/NextGpCard.jsx";
import CalendarSnapshot from "../components/tiles/CalendarSnapshot.jsx";
import TeamOverview from "../components/tiles/TeamOverview.jsx";
import InboxMini from "../components/tiles/InboxMini.jsx";

/**
 * Home (Hub) – contracts-driven roster, DB-aware, com DebugCard
 * - Usa contracts (person_id) para descobrir os pilotos da equipa.
 * - Filtra só contratos de DRIVER (role contém "driver" OU person_id começa por "d_").
 * - Mapeia person_id -> drivers[driver_id].
 * - Normaliza calendário {date,name}.
 */

// ===== Utils =====
function fromISO(iso) {
  if (!iso) return new Date(NaN);
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toISO(date) {
  try { return new Date(date).toISOString().slice(0, 10); } catch { return ""; }
}
function firstArray(...cands) { for (const c of cands) if (Array.isArray(c)) return c; return []; }

export default function Home() {
  const { gameState, setGameState } = useGame();

  if (!gameState) {
    return (
      <div className="grid gap-4">
        <div className="bg-white rounded-xl shadow p-4">
          <h3 className="text-base font-semibold">No save loaded</h3>
          <p className="text-sm text-gray-600 mt-1">Load or start a new game to see your Hub.</p>
        </div>
      </div>
    );
  }

  // === Dados (filtrados pelo GameStore.applyYearFilter)
  const season     = gameState.activeYear ?? gameState.season ?? null;
  const contracts  = firstArray(gameState.contracts, gameState.dbContracts);
  const driversDb  = firstArray(gameState.drivers,   gameState.dbDrivers);
  const standings  = gameState.standings && (gameState.standings.drivers || gameState.standings.teams)
    ? gameState.standings : { drivers: [], teams: [] };

  const {
    currentDateISO,
    calendar = [],
    currentRound = 0,
    team,             // { team_id?, name?/team_name? }
    inbox = [],
  } = gameState;

  // teamId: usa team.team_id; senão infere por team_name nos contracts
  const teamKey = useMemo(() => {
    if (team?.team_id) return String(team.team_id);
    const tname = team?.team_name || team?.name;
    if (!tname) return null;
    const c = (contracts || []).find((c) => c?.team_name === tname);
    return c?.team_id ? String(c.team_id) : null;
  }, [team, contracts]);

  // ===== Calendar normalizado =====
  const normalizedCalendar = useMemo(() => {
    return (Array.isArray(calendar) ? calendar : []).map((row) => ({
      ...row,
      date: row?.date ?? row?.race_date ?? null,
      name: row?.name ?? row?.gp_name ?? "Grand Prix",
    }));
  }, [calendar]);

  // Next GP (primeiro >= hoje, senão fallback)
  const today = fromISO(currentDateISO);
  const nextGp = useMemo(() => {
    if (!normalizedCalendar.length) return null;
    const future = normalizedCalendar
      .filter((g) => g?.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .find((g) => fromISO(g.date) >= today);
    return future || normalizedCalendar[currentRound] || normalizedCalendar[0] || null;
  }, [normalizedCalendar, currentRound, currentDateISO]);

  // ===== Pilotos da nossa equipa via contracts (person_id + role com "driver") =====
  const teamDrivers = useMemo(() => {
    const result = [];
    if (!teamKey) return result;

    // index de drivers por driver_id
    const driverIndex = new Map();
    for (const d of driversDb) {
      const id = d?.driver_id ?? d?.id ?? d?.driverId;
      if (id != null) driverIndex.set(String(id), d);
    }

    const isActive = (c) => {
      if (!c) return false;
      const status = String(c.status || "").toLowerCase();
      if (status === "active") return true;
      const end =
        c.contract_until || c.end_date || c.contract_end || c.valid_until || c.endDate || c.until;
      if (!end) return true; // sem fim → ativo
      const endDt = fromISO(String(end));
      if (Number.isNaN(endDt.getTime())) return true;
      return !(endDt < today);
    };

    const isDriverContract = (c) => {
      const role = String(c.role || "").toLowerCase();
      const pid  = String(c.person_id || c.driver_id || c.id || "");
      return role.includes("driver") || pid.startsWith("d_");
    };

    for (const c of contracts) {
      // filtrar por época se existir no contract
      if (season != null && c.year != null && String(c.year) !== String(season)) continue;
      if (String(c?.team_id) !== String(teamKey)) continue;
      if (!isDriverContract(c)) continue;           // ignora staff
      if (!isActive(c)) continue;

      const personId = c?.person_id ?? c?.driver_id ?? c?.id;
      const d = personId != null ? driverIndex.get(String(personId)) : undefined;
      if (d) result.push({ ...d, __contract_role: c.role || null });
    }

    // ordenar por posição no campeonato, se existir
    const posMap = new Map(
      (standings?.drivers || []).map((r) => [String(r.driver_id ?? r.id ?? r.driverId), r.position])
    );

    return result
      .slice()
      .sort(
        (a, b) =>
          (posMap.get(String(a?.driver_id ?? a?.id ?? a?.driverId)) || 999) -
          (posMap.get(String(b?.driver_id ?? b?.id ?? b?.driverId)) || 999)
      )
      .slice(0, 2);
  }, [contracts, driversDb, standings, teamKey, currentDateISO, season]);

  // Mapa de pontos/posição por driver
  const driverPointsMap = useMemo(() => {
    const m = new Map();
    (standings?.drivers || []).forEach((r) =>
      m.set(String(r.driver_id ?? r.id ?? r.driverId), { points: r.points ?? 0, position: r.position ?? null })
    );
    return m;
  }, [standings]);

  // Linha da nossa equipa em construtores/equipas
  const constructorRow = useMemo(() => {
    const cons = (standings?.constructors && standings.constructors.length
      ? standings.constructors
      : standings?.teams) || [];
    return cons.find((r) => String(r?.team_id) === String(teamKey)) || null;
  }, [standings, teamKey]);

  // ===== Actions =====
  const advanceOneDay = () => {
    const base = fromISO(currentDateISO);
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + 1);
    const nextISO = toISO(dt);
    setGameState({ currentDateISO: nextISO });
  };

  const saveGame = () => {
    try {
      localStorage.setItem("f1hm_save", JSON.stringify(gameState));
      alert("Game saved locally.");
    } catch (e) {
      console.error("Save failed", e);
      alert("Save failed (see console)");
    }
  };

  const SHOW_DEBUG_CARD = !teamDrivers.length;

  return (
    <div className="grid gap-4">
      {/* Top row */}
      <div className="grid md:grid-cols-3 gap-4">
        <NextGpCard currentDateISO={currentDateISO} gp={nextGp} onAdvanceDay={advanceOneDay} />
        <CalendarSnapshot calendar={normalizedCalendar} currentRound={currentRound} />
        <TeamOverview team={team} onSave={saveGame} constructorRow={constructorRow} />
      </div>

      {/* Middle row */}
      <div className="grid md:grid-cols-3 gap-4">
        <OurDriversCard drivers={teamDrivers} driverPointsMap={driverPointsMap} />
        <StandingsMiniCard standings={standings} teamId={teamKey} />
        <div className="md:col-span-1">
          <div className="bg-white rounded-xl shadow p-4 h-full">
            <h3 className="text-base font-semibold">Coming soon</h3>
            <p className="text-sm text-gray-600 mt-1">More widgets here.</p>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid md:grid-cols-3 gap-4">
        <InboxMini items={inbox} />
        <div className="md:col-span-2 flex flex-wrap gap-2 items-center">
          <button className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200" onClick={advanceOneDay}>
            Advance 1 day
          </button>
          <button className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200" onClick={saveGame}>
            Save (local)
          </button>
        </div>
      </div>

      {SHOW_DEBUG_CARD && (
        <DebugCard
          teamKey={teamKey}
          season={season}
          contracts={contracts}
          drivers={driversDb}
          standings={standings}
        />
      )}
    </div>
  );
}

/* ====== Inline tiles ====== */
function StatPill({ label, value }) {
  return (
    <div className="text-xs bg-gray-100 rounded px-2 py-0.5">
      <span className="text-gray-500 mr-1">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

function OurDriversCard({ drivers = [], driverPointsMap }) {
  return (
    <div className="bg-white rounded-xl shadow p-4 h-full">
      <h3 className="text-base font-semibold">Our Drivers</h3>
      {drivers.length ? (
        <ul className="divide-y mt-2">
          {drivers.map((d) => {
            const key = String(d?.driver_id ?? d?.id ?? d?.driverId ?? Math.random());
            const s = driverPointsMap?.get(String(d?.driver_id ?? d?.id ?? d?.driverId)) || {
              points: 0,
              position: null,
            };
            return (
              <li key={key} className="py-3 flex items-center gap-3">
                {d?.portrait_path ? (
                  <img
                    src={d.portrait_path}
                    alt={d?.display_name || d?.name || "Driver"}
                    className="h-10 w-10 rounded object-cover"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                ) : (
                  <div className="h-10 w-10 rounded bg-gray-100 flex items-center justify-center text-sm font-medium">
                    {(d?.display_name || d?.name || "?").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 grow">
                  <div className="text-sm font-medium truncate">
                    {d?.display_name || d?.name || `${d?.first_name ?? ""} ${d?.last_name ?? ""}`.trim() || "—"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <StatPill label="Pts" value={s.points} />
                    <StatPill label="Pos" value={s.position ? `P${s.position}` : "—"} />
                    <StatPill label="Prep" value={d?.preparation ?? d?.prep ?? "—"} />
                    <StatPill label="Morale" value={d?.morale ?? d?.moral ?? "—"} />
                    {d?.__contract_role && <StatPill label="Role" value={String(d.__contract_role).replace(/_/g, " ")} />}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-gray-600 mt-2">No drivers linked to your team.</p>
      )}
    </div>
  );
}

function MiniRow({ left, right, highlight }) {
  return (
    <li className={`px-3 py-2 text-sm flex items-center justify-between ${highlight ? "bg-indigo-50" : ""}`}>
      <span className="truncate">{left}</span>
      <span className="font-medium">{right}</span>
    </li>
  );
}

function StandingsMiniCard({ standings = {}, teamId }) {
  const cons = Array.isArray(standings.constructors) && standings.constructors.length
    ? standings.constructors
    : (Array.isArray(standings.teams) ? standings.teams : []);
  const drvs = Array.isArray(standings.drivers) ? standings.drivers : [];

  const topC  = cons.slice(0, 5);
  const ourC  = cons.find((r) => String(r?.team_id) === String(teamId));
  const rowsC = [...topC];
  if (ourC && !topC.some((r) => String(r.team_id) === String(ourC.team_id))) rowsC.push(ourC);

  const topD  = drvs.slice(0, 5);
  const ourD  = drvs.filter((r) => String(r?.team_id) === String(teamId));
  const dMap  = new Map(topD.map((r) => [String(r.driver_id ?? r.id ?? r.driverId), r]));
  ourD.forEach((r) => { const k = String(r.driver_id ?? r.id ?? r.driverId); if (!dMap.has(k)) dMap.set(k, r); });
  const rowsD = Array.from(dMap.values());

  return (
    <div className="bg-white rounded-xl shadow p-4 h-full">
      <h3 className="text-base font-semibold">Standings Snapshot</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Constructors</div>
          <div className="rounded-xl border overflow-hidden">
            <ul className="divide-y">
              {rowsC.length ? rowsC.map((r) => (
                <MiniRow
                  key={String(r.team_id)}
                  left={`${r.position ? "P" + r.position : "—"} ${r.team_name || r.name || "—"}`}
                  right={`${r.points ?? 0} pts`}
                  highlight={String(r.team_id) === String(teamId)}
                />
              )) : <li className="px-3 py-2 text-sm text-gray-500">No data.</li>}
            </ul>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Drivers</div>
          <div className="rounded-xl border overflow-hidden">
            <ul className="divide-y">
              {rowsD.length ? rowsD.map((r) => (
                <MiniRow
                  key={String(r.driver_id ?? r.id ?? r.driverId)}
                  left={`${r.position ? "P" + r.position : "—"} ${r.driver_name || r.name || "—"}`}
                  right={`${r.points ?? 0} pts`}
                  highlight={String(r.team_id) === String(teamId)}
                />
              )) : <li className="px-3 py-2 text-sm text-gray-500">No data.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function DebugCard({ teamKey, season, contracts, drivers, standings }) {
  const sample = (arr) => (Array.isArray(arr) ? arr.slice(0, 5) : []);
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="text-amber-900 font-semibold">Debug info</div>
      <div className="text-xs text-amber-900/90 mt-2 grid md:grid-cols-4 gap-3">
        <div>
          <div className="font-medium">Keys</div>
          <div>teamKey: <code>{String(teamKey)}</code></div>
          <div>season: <code>{String(season ?? "—")}</code></div>
        </div>
        <div>
          <div className="font-medium">Counts</div>
          <div>contracts: {Array.isArray(contracts) ? contracts.length : 0}</div>
          <div>drivers: {Array.isArray(drivers) ? drivers.length : 0}</div>
          <div>standings.drivers: {Array.isArray(standings?.drivers) ? standings.drivers.length : 0}</div>
        </div>
        <div className="md:col-span-2">
          <div className="font-medium">Sample</div>
          <pre className="text-[10px] leading-tight whitespace-pre-wrap bg-white border rounded p-2 mt-1">{JSON.stringify({
            contracts: sample(contracts),
            drivers: sample(drivers),
            standings_drivers: sample(standings?.drivers),
          }, null, 2)}</pre>
        </div>
      </div>
      <div className="text-[10px] text-amber-900/70 mt-2">
        Tip: este painel aparece quando ainda não consegui mostrar os pilotos. Agora trabalhamos com
        <code> person_id </code> e filtramos apenas contratos de <code>driver</code>.
      </div>
    </div>
  );
}
