import React, { useMemo } from "react";
import { useGame } from "../state/GameStore.js";
import TeamOverview from "../components/tiles/TeamOverview.jsx";
import InboxMini from "../components/tiles/InboxMini.jsx";
import GpMiniLists from "../components/tiles/GpMiniLists.jsx";
import { driverContractsOf, driverLineupSlots, driverIdOf } from "../domain/driverContracts.js";
import { driverRoleLabelForSlot } from "../domain/contractRoles.js";

/* ===== Debug card (stub seguro) ===== */
function DebugCard(props) {
  const { title = "Debug", ...rest } = props || {};
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="text-sm font-semibold mb-2">{title}</div>
      <pre className="text-[11px] leading-tight whitespace-pre-wrap break-all opacity-80">
        {JSON.stringify(rest, null, 2)}
      </pre>
    </div>
  );
}

/** ===== Utils ===== */
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
  const { gameState } = useGame();

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

  // === Dados base
  const season     = gameState.activeYear ?? gameState.season ?? null;
  const contracts  = driverContractsOf(gameState);
  const driversDb  = firstArray(gameState.drivers,   gameState.dbDrivers);
  const standings  = gameState.standings && (gameState.standings.drivers || gameState.standings.teams)
    ? gameState.standings : { drivers: [], teams: [] };

  const {
    currentDateISO,
    calendar = [],
    currentRound = 0,
    team,
    inbox = [],
    board = {},
  } = gameState;

  const finances   = gameState.finances || gameState.finance || {};
  const dev        = gameState.development || {};

  // teamId (por id ou por nome a partir dos contracts)
  const teamKey = useMemo(() => {
    if (team?.team_id) return String(team.team_id);
    const tname = team?.team_name || team?.name;
    if (!tname) return null;
    const c = (contracts || []).find((c) => c?.team_name === tname);
    return c?.team_id ? String(c.team_id) : null;
  }, [team, contracts]);

  // Calendário normalizado
  const normalizedCalendar = useMemo(() => {
    return (Array.isArray(calendar) ? calendar : []).map((row) => ({
      ...row,
      date: row?.date ?? row?.race_date ?? null,
      name: row?.name ?? row?.gp_name ?? "Grand Prix",
      gp_id: row?.gp_id ?? row?.id ?? null,
      track_id: row?.track_id ?? null,
    }));
  }, [calendar]);

  // Next 3 e Last 3
  const today = fromISO(currentDateISO);
  const next3 = useMemo(() => {
    const arr = (normalizedCalendar || [])
      .filter(g => g?.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const today = fromISO(currentDateISO);
    return arr.filter(g => fromISO(g.date) >= today);
  }, [normalizedCalendar, currentDateISO]);

  const last3 = useMemo(() => {
    const arr = (normalizedCalendar || [])
      .filter(g => g?.date)
      .sort((a, b) => (a.date > b.date ? -1 : 1));
    const today = fromISO(currentDateISO);
    return arr.filter(g => fromISO(g.date) < today);
  }, [normalizedCalendar, currentDateISO]);

  // Os dois cards do Home representam explicitamente os dois race seats.
  // Standings nunca decidem quem ocupa Main/Second; o live contract state decide.
  const teamDrivers = useMemo(() => {
    if (!teamKey) return [];

    const driverIndex = new Map();
    for (const d of driversDb) {
      const id = d?.driver_id ?? d?.id ?? d?.driverId;
      if (id != null) driverIndex.set(String(id), d);
    }

    const lineup = driverLineupSlots(gameState, teamKey);
    return ["main", "second"].map((slot) => {
      const contract = lineup[slot];
      if (!contract) return null;
      const id = driverIdOf(contract);
      const driver = driverIndex.get(String(id));
      if (!driver) return null;
      return {
        ...driver,
        __contract_role: driverRoleLabelForSlot(slot),
      };
    }).filter(Boolean);
  }, [gameState, driversDb, teamKey]);

  // Pts/Pos por driver
  const driverPointsMap = useMemo(() => {
    const m = new Map();
    (standings?.drivers || []).forEach((r) =>
      m.set(String(r.driver_id ?? r.id ?? r.driverId), { points: r.points ?? 0, position: r.position ?? null })
    );
    return m;
  }, [standings]);

  // Linha da nossa equipa em construtores
  const constructorRow = useMemo(() => {
    const cons = (standings?.constructors && standings.constructors.length
      ? standings.constructors
      : standings?.teams) || [];
    return cons.find((r) => String(r?.team_id) === String(teamKey)) || null;
  }, [standings, teamKey]);

  // Alerts vindos da Inbox
  const alerts = useMemo(() => {
    const arr = Array.isArray(inbox) ? inbox : [];
    return arr.filter((m) => {
      const t = String(m?.type || m?.category || "").toLowerCase();
      const requires = m?.requires_response ?? m?.requiresReply ?? m?.action_required ?? m?.actionRequired;
      const priority = String(m?.priority || "").toLowerCase();
      const unread = m?.unread === true || m?.read === false;
      return (
        t.includes("alert") ||
        t.includes("warning") ||
        priority === "high" ||
        requires === true ||
        (unread && (m?.due_date || m?.deadline))
      );
    }).slice(0, 5);
  }, [inbox]);

  const SHOW_DEBUG_CARD = !teamDrivers.length;

  return (
    <div className="grid gap-4">
      {/* ======= Main grid (12 cols) ======= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Inbox + Team/Drivers (Drivers alargado) */}
        <div className="lg:col-span-5 grid gap-4">
          <CardShell title="News">
            <InboxMini items={inbox} compact />
          </CardShell>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TeamOverview team={team} constructorRow={constructorRow} />
            <div className="md:col-span-2">
              <OurDriversCard drivers={teamDrivers} driverPointsMap={driverPointsMap} />
            </div>
          </div>
        </div>

        {/* MID: Next 3 / Last 3 GPs */}
        <div className="lg:col-span-4 grid gap-4">
          <GpMiniLists next3={next3} last3={last3} currentDateISO={currentDateISO} />
        </div>

        {/* RIGHT: Alerts + Finances + Development + Objectives */}
        <div className="lg:col-span-3 grid gap-4">
          <AlertsMini alerts={alerts} />
          <FinancesCard finances={finances} />
          <DevelopmentCard dev={dev} />
          <ObjectivesCard board={board} />
        </div>
      </div>

      {SHOW_DEBUG_CARD && (
        <DebugCard
          title="Debug snapshot"
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

/* ====== Generic shell ====== */
function CardShell({ title, right, children, className = "" }) {
  return (
    <div className={`bg-white rounded-xl shadow p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        {right}
      </div>
      <div className="mt-2">{children}</div>
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
    <CardShell title="Drivers">
      {drivers.length ? (
        <ul className="divide-y mt-1">
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
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="h-10 w-10 rounded bg-gray-100 flex items-center justify-center text-sm font-medium">
                    {(d?.display_name || d?.name || "?").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 grow">
                  <div className="text-sm font-medium truncate">
                    <span
                      data-entity="driver"
                      data-id={d?.driver_id ?? d?.id ?? d?.driverId}
                      className="entity-link-driver"
                    >
                      {d?.display_name ||
                        d?.name ||
                        `${d?.first_name ?? ""} ${d?.last_name ?? ""}`.trim() ||
                        "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <StatPill label="Pts" value={s.points} />
                    <StatPill label="Pos" value={s.position ? `P${s.position}` : "—"} />
                    <StatPill label="Prep" value={d?.preparation ?? d?.prep ?? "—"} />
                    <StatPill label="Morale" value={d?.morale ?? d?.moral ?? "—"} />
                    {d?.__contract_role && (
                      <StatPill
                        label="Role"
                        value={String(d.__contract_role).replace(/_/g, " ")}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-gray-600 mt-2">No drivers linked to your team.</p>
      )}
    </CardShell>
  );
}

/* ===== Outros cards ===== */
function FinancesCard({ finances = {} }) {
  const balance     = finances.balance ?? finances.cash ?? finances.bank ?? "—";
  const weekly      = finances.weeklyChange ?? finances.weekly_delta ?? finances.weekly ?? "—";
  const nextPayAmt  = finances.nextSponsorAmount ?? finances.next_payment_amount ?? finances.nextPayment ?? "—";
  const nextPayDate = finances.nextSponsorDate ?? finances.next_payment_date ?? finances.nextDate ?? "—";

  return (
    <CardShell title="Finances">
      <ul className="text-sm space-y-1">
        <li className="flex justify-between"><span>Balance</span><span className="font-medium">{fmt(balance)}</span></li>
        <li className="flex justify-between"><span>Weekly change</span><span className="font-medium">{fmt(weekly)}</span></li>
        <li className="flex justify-between">
          <span>Next sponsor payment</span>
          <span className="font-medium">{fmt(nextPayAmt)}{nextPayDate ? ` • ${nextPayDate}` : ""}</span>
        </li>
      </ul>
    </CardShell>
  );
}

function DevelopmentCard({ dev = {} }) {
  const researchPts = dev.researchPoints ?? dev.rp ?? "—";
  const facilities  = firstArray(dev.facilities)?.slice(0, 3);
  const parts       = firstArray(dev.partsInProgress, dev.inProgress)?.slice(0, 3);

  return (
    <CardShell title="Development">
      <div className="text-sm">
        <div className="flex justify-between mb-2">
          <span className="text-gray-600">Research points</span>
          <span className="font-medium">{fmt(researchPts)}</span>
        </div>
        <div className="text-gray-600">Parts in progress</div>
        <ul className="list-disc list-inside">
          {parts.length ? parts.map((p, i) => (
            <li key={i} className="text-sm">
              {p?.name || p?.part || "Part"} {p?.level ? `(L${p.level})` : ""} {p?.eta ? `– ETA ${p.eta}` : ""}
            </li>
          )) : <li className="text-sm text-gray-500">None</li>}
        </ul>
        <div className="text-gray-600 mt-2">Facilities</div>
        <ul className="list-disc list-inside">
          {facilities.length ? facilities.map((f, i) => (
            <li key={i} className="text-sm">
              {(f?.name || f?.facility || "Facility")} {f?.level ? `(L${f.level})` : ""}
            </li>
          )) : <li className="text-sm text-gray-500">—</li>}
        </ul>
      </div>
    </CardShell>
  );
}

function ObjectivesCard({ board = {} }) {
  const objectives = Array.isArray(board?.objectives) ? board.objectives.slice(0, 5) : [];

  return (
    <CardShell title="Objectives">
      {objectives.length ? (
        <ul className="space-y-1">
          {objectives.map((o, i) => (
            <li key={i} className="text-sm flex items-start justify-between gap-3">
              <span className="truncate">
                {o?.title || o?.name || "Objective"}
                {o?.deadline ? <span className="text-gray-500"> • {o.deadline}</span> : null}
              </span>
              <span className={`text-xs rounded px-2 py-0.5 ${badgeClr(o?.status)}`}>
                {o?.status || o?.state || "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">No objectives found.</p>
      )}
    </CardShell>
  );
}

function AlertsMini({ alerts = [] }) {
  return (
    <div className="bg-white rounded-xl shadow p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">Alerts</div>
      {alerts.length ? (
        <ul className="mt-1 space-y-1">
          {alerts.map((m, i) => (
            <li key={i} className="text-sm">
              {m?.subject || m?.title || m?.summary || "Message"}{m?.due_date ? ` • due ${m.due_date}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 text-sm text-gray-600">No alerts.</div>
      )}
    </div>
  );
}

/* ===== Helpers visuais ===== */
function fmt(v) {
  if (v === null || v === undefined || v === "—") return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}
function badgeClr(statusRaw) {
  const s = String(statusRaw || "").toLowerCase();
  if (s.includes("done") || s.includes("complete") || s === "ok") return "bg-emerald-100 text-emerald-700";
  if (s.includes("at risk") || s.includes("warning")) return "bg-amber-100 text-amber-700";
  if (s.includes("fail") || s.includes("overdue") || s.includes("blocked")) return "bg-rose-100 text-rose-700";
  return "bg-gray-100 text-gray-700";
}
