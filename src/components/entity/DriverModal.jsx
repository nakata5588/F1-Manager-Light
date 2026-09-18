// src/components/entity/DriverModal.jsx
import { useMemo, useState, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  X, Filter, MoreVertical, Dumbbell, Megaphone, Wrench,
  Handshake, Search, FileText, Coffee, MessageSquare
} from "lucide-react";
import { useModalStore } from "../../state/ModalStore.js";
import { useGame } from "../../state/GameStore.js";

/* ======================== Helpers & Const ======================== */

const TABS = [
  { key: "contract",     label: "Contract" },
  { key: "statistics",   label: "Statistics" },
  { key: "career",       label: "Career" },
  { key: "attributes",   label: "Attributes" },
  { key: "achievements", label: "Achievements" },
];

// --- unwrap Excel-like cells or Rich values { formula, result } / { value } / { text }
function unbox(v) {
  if (v && typeof v === "object") {
    if ("result" in v) return v.result;
    if ("value" in v) return v.value;
    if ("text" in v) return v.text;
  }
  return v;
}

function yearFrom(any) {
  const v = unbox(any);
  if (!v) return NaN;
  if (typeof v === "number") return v;
  const m = String(v).match(/(\d{4})/);
  return m ? Number(m[1]) : NaN;
}
function ageOnYear(dob, Y) {
  const y = yearFrom(dob);
  return Number.isFinite(y) && Number.isFinite(Y) ? Math.max(0, Y - y) : null;
}
function fmtMoney(n) {
  const x = Number(unbox(n));
  if (!Number.isFinite(x)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency: "USD", maximumFractionDigits: 0
    }).format(x);
  } catch {
    return String(x);
  }
}
function isNumeric(v) {
  const x = unbox(v);
  return x !== null && x !== undefined && x !== "" && !Number.isNaN(Number(x));
}
function isoFromAny(v) {
  const s = String(unbox(v) ?? "");
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  return null;
}
function niceRole(role) {
  const s = String(unbox(role) || "").toLowerCase();
  if (s.includes("main")) return "Main Driver";
  if (s.includes("second")) return "Second Driver";
  if (s.includes("test")) return "Test Driver";
  return unbox(role) || "—";
}
function getSeries(row) {
  return String(unbox(row?.series_division ?? row?.series) ?? "");
}
function toArraySafe(x) {
  const v = unbox(x);
  if (Array.isArray(v)) return v;
  if (!v) return [];
  if (Array.isArray(v.items)) return v.items;
  if (typeof v === "object") return Object.values(v);
  return [];
}
function attrColorClass(n, { inverse = false } = {}) {
  const raw = Number(unbox(n));
  if (!Number.isFinite(raw)) return "text-gray-800";
  const v = Math.max(0, Math.min(100, raw));
  const idx = v < 25 ? 0 : v < 50 ? 1 : v < 63 ? 2 : v < 75 ? 3 : v < 85 ? 4 : 5;
  const pos = ["text-red-700","text-red-600","text-amber-500","text-amber-600","text-green-500","text-green-600"];
  const neg = ["text-green-600","text-green-500","text-amber-600","text-amber-500","text-red-600","text-red-700"];
  return (inverse ? neg : pos)[idx];
}
function normDriverId(x) {
  const v = unbox(x);
  if (v == null) return null;
  const m = String(v).toLowerCase().match(/(\d+)/);
  return m ? m[1].padStart(4, "0") : null;
}
function sameDriver(a, b) {
  const na = normDriverId(a);
  const nb = normDriverId(b);
  return !!na && !!nb && na === nb;
}

// Try to extract a driver id from a generic record (for achievements etc.)
function extractDriverId(obj) {
  const keys = [
    "driver_id", "driverId", "id", "person_id", "personId", "driver", "driver_code"
  ];
  for (const k of keys) {
    if (k in (obj || {})) {
      const v = obj[k];
      const n = normDriverId(v);
      if (n) return n;
    }
  }
  // sometimes nested
  if (obj?.driver && typeof obj.driver === "object") {
    const n = extractDriverId(obj.driver);
    if (n) return n;
  }
  return null;
}

/* ======================== Component ======================== */

export default function DriverModal({ entity, onClose }) {
  const setTab = useModalStore((s) => s.setTab);
  const rawTab = unbox(entity.tab) || "contract";
  const activeTab = rawTab === "overview" ? "contract" : rawTab; // compat
  const idNorm = useMemo(() => normDriverId(entity.id), [entity.id]);

  // ✅ Seleção MEMOIZADA com useShallow para evitar “getSnapshot” novo a cada render
  const selector = useShallow((s) => {
    const gs = s.gameState;
    return {
      driversList:   gs.drivers?.length ? gs.drivers : (gs.dbDrivers || []),
      ratingsList:   gs.driverRatings?.length ? gs.driverRatings : (gs.dbDriverRatings || []),
      contractsList: gs.contracts?.length ? gs.contracts : (gs.dbContracts || []),
      careerRaw:     Array.isArray(gs.dbDriverCareer)
        ? gs.dbDriverCareer
        : (Array.isArray(gs.driverCareer) ? gs.driverCareer : []),
      achievementsRaw: gs.dbAchievements ?? gs.achievements ?? null,
      results: Array.isArray(gs.results) ? gs.results : [],
      standings: gs.standings || { drivers: [], teams: [] },
      gameYear: Number(gs.activeYear ?? (gs.currentDateISO ? gs.currentDateISO.slice(0,4) : NaN)),
      gameDateISO: gs.currentDateISO ?? null,
      myTeamId:   gs.team?.team_id ?? gs.team?.id ?? null,
      myTeamName: gs.team?.team_name ?? gs.team?.name ?? null,
      queueEvent: s.queueEvent, // método é estável no store
    };
  });

  const {
    driversList, ratingsList, contractsList, careerRaw,
    achievementsRaw, results, standings, gameYear, gameDateISO,
    myTeamId, myTeamName, queueEvent
  } = useGame(selector);

  const achievementsArr = useMemo(() => toArraySafe(achievementsRaw), [achievementsRaw]);

  const driver = useMemo(
    () => (driversList || []).find((d) =>
      sameDriver(d?.driver_id ?? d?.driverId ?? d?.id, idNorm)
    ) || null,
    [driversList, idNorm]
  );

  const attrs = useMemo(
    () => (ratingsList || []).find((r) =>
      sameDriver(r?.driver_id ?? r?.driverId ?? r?.id, idNorm)
    ) || null,
    [ratingsList, idNorm]
  );

  const contract = useMemo(
    () => (contractsList || []).find((c) =>
      sameDriver(c?.driver_id ?? c?.person_id ?? c?.id, idNorm)
    ) || null,
    [contractsList, idNorm]
  );

  // Contract values are needed by the live-season memo below. Keep these
  // declarations before any memo that references them to avoid TDZ crashes.
  const contractStart = unbox(contract?.contract_start) ?? unbox(contract?.start_year) ?? unbox(contract?.start_date) ?? null;
  const contractEnd = unbox(contract?.contract_until) ?? unbox(contract?.end_year) ?? unbox(contract?.end_date) ?? null;
  const contractTeam = unbox(contract?.team_name) ?? null;
  const contractRole = niceRole(contract?.role);
  const contractSalary = unbox(contract?.salary);

  const futureTransfer = useMemo(() => {
    const list = (contractsList || []).filter((c) => sameDriver(c?.driver_id ?? c?.person_id ?? c?.id, idNorm));
    if (!list.length || !gameDateISO) return null;
    const candidates = list.filter((c) => {
      const sd = isoFromAny(c.start_date);
      const sy = Number(unbox(c.start_year));
      if (sd && sd > gameDateISO) return true;
      if (Number.isFinite(sy) && Number.isFinite(gameYear) && sy > gameYear) return true;
      return false;
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const ad = isoFromAny(a.start_date) || `${unbox(a.start_year) || 9999}-01-01`;
      const bd = isoFromAny(b.start_date) || `${unbox(b.start_year) || 9999}-01-01`;
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
    const next = candidates[0];
    const whenISO = isoFromAny(next.start_date) || (Number.isFinite(unbox(next.start_year)) ? `${unbox(next.start_year)}-01-01` : null);
    return {
      team_name: unbox(next.team_name) || unbox(next.team) || "Unknown Team",
      when: whenISO,
      whenLabel: whenISO ? (whenISO.length === 10 ? whenISO : String(unbox(next.start_year))) : (unbox(next.start_year) ?? "future"),
    };
  }, [contractsList, idNorm, gameDateISO, gameYear]);

  const careerAll = useMemo(
    () => (careerRaw || []).filter((r) => sameDriver(r?.driver_id ?? r?.driverId, idNorm)),
    [careerRaw, idNorm]
  );

  // ==== Filtros (tabs Statistics/Career) ====
  const seriesOptions = useMemo(() => {
    const set = new Set(
      (careerAll || []).map(getSeries).map((s) => s.trim()).filter(Boolean)
    );
    if ((results || []).some((r) => Number(r?.year) === Number(gameYear))) set.add("F1");
    return ["All", ...Array.from(set).sort()];
  }, [careerAll, results, gameYear]);

  const defaultSeries = useMemo(() => (seriesOptions.includes("F1") ? "F1" : "All"), [seriesOptions]);
  const [seriesSel, setSeriesSel] = useState(defaultSeries);
  useEffect(() => {
    if (seriesSel !== defaultSeries) setSeriesSel(defaultSeries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSeries]);

  const liveSeasonRow = useMemo(() => {
    if (!Number.isFinite(gameYear)) return null;
    const seasonEvents = (results || []).filter((r) => Number(r?.year) === Number(gameYear));
    if (!seasonEvents.length) return null;

    let starts = 0, wins = 0, podiums = 0, poles = 0, fastest_laps = 0, points = 0;
    let team_id = null;
    for (const event of seasonEvents) {
      const raceRow = (event?.classification || []).find((r) => sameDriver(r?.driver_id, idNorm));
      if (raceRow) {
        starts += 1;
        const pos = Number(raceRow.position);
        if (pos === 1) wins += 1;
        if (pos >= 1 && pos <= 3) podiums += 1;
        if (raceRow.fastest_lap) fastest_laps += 1;
        points += Number(raceRow.points || 0);
        if (raceRow.team_id != null) team_id = unbox(raceRow.team_id);
      }
      const qRow = (event?.qualifying || []).find((r) => sameDriver(r?.driver_id, idNorm));
      if (qRow && Number(qRow.position) === 1) poles += 1;
      if (!team_id && qRow?.team_id != null) team_id = unbox(qRow.team_id);
    }
    if (!starts) return null;

    const standing = (standings?.drivers || []).find((r) => sameDriver(r?.driver_id ?? r?.id, idNorm));
    const teamRow = (standings?.teams || []).find((r) => String(r?.team_id ?? r?.constructor_id ?? "") === String(team_id ?? ""));
    return {
      __live: true,
      year: gameYear,
      series_division: "F1",
      team_id,
      team_name: teamRow?.team_name || contractTeam || "—",
      starts,
      races: starts,
      wins,
      podiums,
      poles,
      fastest_laps,
      points,
      champ_pos: standing?.position ?? null,
    };
  }, [results, standings, gameYear, idNorm, contractTeam]);

  const filteredCareer = useMemo(() => {
    const byYear = (careerAll || []).filter((r) => Number(unbox(r?.year)) < Number(gameYear));
    const rows = liveSeasonRow ? [...byYear, liveSeasonRow] : byYear;
    if (seriesSel === "All") return rows;
    return rows.filter((r) => getSeries(r).toUpperCase() === seriesSel.toUpperCase());
  }, [careerAll, gameYear, seriesSel, liveSeasonRow]);

  const statsAgg = useMemo(() => {
    if (!filteredCareer.length) return null;
    const rows = filteredCareer;
    const sum = (fn) => rows.reduce((acc, r) => acc + Number(unbox(fn(r)) || 0), 0);
    const starts       = sum((r) => r.starts ?? r.races);
    const wins         = sum((r) => r.wins);
    const podiums      = sum((r) => r.podiums);
    const poles        = sum((r) => r.poles);
    const fastest_laps = sum((r) => r.fastest_laps);
    const points       = sum((r) => r.points);
    const yearsWithPoints = rows.filter((r) => unbox(r.points) !== undefined);
    const avgPoints = yearsWithPoints.length
      ? (yearsWithPoints.reduce((a, r) => a + Number(unbox(r.points) || 0), 0) / yearsWithPoints.length)
      : null;
    const numericPositions = rows.map((r) => unbox(r.champ_pos)).filter(isNumeric).map(Number);
    const highestPos  = numericPositions.length ? Math.min(...numericPositions) : null;
    const highestCount= numericPositions.length ? numericPositions.filter((p) => p === (highestPos ?? 0)).length : 0;
    const avgPos = numericPositions.length
      ? (numericPositions.reduce((a, v) => a + v, 0) / numericPositions.length)
      : null;
    return { starts, wins, podiums, poles, fastest_laps, points, avgPoints, highestPos, highestCount, avgPos };
  }, [filteredCareer]);

  const careerTimeline = useMemo(() => {
    const list = (filteredCareer || []).slice();
    list.sort((a, b) => {
      const ya = Number(unbox(a.year)) || 0;
      const yb = Number(unbox(b.year)) || 0;
      if (ya !== yb) return ya - yb;
      const ta = String(unbox(a.champ_pos) ?? "").toLowerCase() === "transfer" ? 1 : 0;
      const tb = String(unbox(b.champ_pos) ?? "").toLowerCase() === "transfer" ? 1 : 0;
      if (ta !== tb) return tb - ta;
      const oa = Number(unbox(a.order)) || 0;
      const ob = Number(unbox(b.order)) || 0;
      if (oa !== ob) return oa - ob;
      return String(unbox(a.team_name) || "").localeCompare(String(unbox(b.team_name) || ""));
    });
    return list;
  }, [filteredCareer]);

  const careerTotals = useMemo(() => {
    if (!careerTimeline.length) return null;
    const sum = (fn) => careerTimeline.reduce((acc, r) => acc + Number(unbox(fn(r)) || 0), 0);
    return {
      starts: sum((r) => r.starts ?? r.races),
      wins: sum((r) => r.wins),
      podiums: sum((r) => r.podiums),
      poles: sum((r) => r.poles),
      fastest_laps: sum((r) => r.fastest_laps),
    };
  }, [careerTimeline]);

  // Historical achievement IDs are not fully aligned with the current driver IDs.
  // Prefer exact achievement records, then fill gaps from the driver's own career rows.
  const achievementsList = useMemo(() => {
    const direct = achievementsArr
      .filter((a) => sameDriver(extractDriverId(a), idNorm))
      .filter((a) => Number(unbox(a.year)) < Number(gameYear))
      .map((a) => ({ ...a, __source: "achievements" }));

    const derived = (careerAll || [])
      .filter((r) => Number(unbox(r?.year)) < Number(gameYear))
      .filter((r) => {
        const wins = Number(unbox(r?.wins) || 0);
        const podiums = Number(unbox(r?.podiums) || 0);
        const pos = Number(unbox(r?.champ_pos));
        return wins > 0 || podiums > 0 || (Number.isFinite(pos) && pos <= 3);
      })
      .map((r) => ({
        driver_id: driver?.driver_id ?? entity.id,
        team_id: unbox(r?.team_id) ?? null,
        team_name: unbox(r?.team_name) ?? "—",
        year: Number(unbox(r?.year)),
        wins: Number(unbox(r?.wins) || 0),
        podiums: Number(unbox(r?.podiums) || 0),
        driver_championship: isNumeric(r?.champ_pos) ? Number(unbox(r?.champ_pos)) : null,
        team_championship: null,
        __source: "career",
      }));

    if (liveSeasonRow && (liveSeasonRow.wins > 0 || liveSeasonRow.podiums > 0)) {
      derived.push({
        driver_id: driver?.driver_id ?? entity.id,
        team_id: liveSeasonRow.team_id,
        team_name: liveSeasonRow.team_name,
        year: gameYear,
        wins: liveSeasonRow.wins,
        podiums: liveSeasonRow.podiums,
        driver_championship: liveSeasonRow.champ_pos,
        team_championship: null,
        __source: "live",
        __live: true,
      });
    }

    const map = new Map();
    for (const row of [...derived, ...direct]) {
      const key = [Number(unbox(row.year)), String(unbox(row.team_id) ?? unbox(row.team_name) ?? "")].join("|");
      map.set(key, row);
    }
    return [...map.values()].sort((a,b) => Number(unbox(a.year)||0) - Number(unbox(b.year)||0));
  }, [achievementsArr, careerAll, liveSeasonRow, idNorm, gameYear, driver?.driver_id, entity.id]);

  const yearsRaced = useMemo(() => {
    const rookie = Number(unbox(driver?.f1_rookie_season));
    if (!Number.isFinite(rookie) || !Number.isFinite(gameYear)) return null;
    const v = gameYear - rookie;
    return v < 0 ? 0 : v;
  }, [driver?.f1_rookie_season, gameYear]);

  const computedAge = useMemo(() => ageOnYear(driver?.dob, gameYear), [driver?.dob, gameYear]);

  const overall       = attrs?.current_ability != null ? Math.round(Number(unbox(attrs.current_ability))) : null;
  const marketValue   = unbox(attrs?.market_value);
  const driverName    = unbox(driver?.display_name) || unbox(driver?.name);
  const driverNumber  = unbox(driver?.prefered_number);
  const driverCountry = unbox(driver?.country_name);

  const isOwnDriver =
    (unbox(driver?.team_id) && myTeamId && String(unbox(driver.team_id)) === String(myTeamId)) ||
    (contractTeam && myTeamName && String(contractTeam) === String(myTeamName));

  if (!driver) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Driver not found</h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500">ID: {entity.id}</p>
      </div>
    );
  }

  return (
    <div className="flex h-[92vh]">
      {/* Left */}
      <aside className="w-80 border-r p-5 overflow-y-auto">
        <div className="text-lg font-semibold leading-tight">
          {driverName}
        </div>
        <div className="text-xs text-gray-500 mb-3">
          {driverCountry} • #{driverNumber ?? "—"}
        </div>

        {unbox(driver.portrait_path) ? (
          <img
            src={unbox(driver.portrait_path)}
            alt={driverName}
            className="w-full rounded-xl object-cover"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div className="w-full aspect-[5/4] rounded-xl bg-gray-100 flex items-center justify-center text-xl font-semibold">
            {(driverName || "?").slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="mt-4 grid gap-2 text-sm">
          <Row label="Age"           value={computedAge ?? "—"} />
          <Row label="DOB"           value={driver?.dob ? `${unbox(driver.dob)}${computedAge != null ? ` (${computedAge})` : ""}` : "—"} />
          <Row label="Team"          value={contractTeam ?? "—"} />
          <Row label="Role"          value={contractRole ?? "—"} />
          <Row label="Overall"       value={overall ?? "—"} />
          <Row label="Rookie Season" value={unbox(driver?.f1_rookie_season) ?? "—"} />
          <Row label="Years Raced"   value={yearsRaced ?? "—"} />
          <Row label="Market Value"  value={fmtMoney(marketValue)} />
          <Row label="Salary"        value={fmtMoney(contractSalary)} />
        </div>

        {futureTransfer && (
          <p className="mt-3 text-sm italic text-purple-700">
            Will transfer to <span className="font-medium">{futureTransfer.team_name}</span> in {futureTransfer.whenLabel}.
          </p>
        )}
      </aside>

      {/* Right */}
      <main className="min-w-0 flex-1 flex flex-col">
        <header className="flex items-center justify-between border-b px-5">
          <nav className="flex gap-1 py-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-sm rounded-t ${activeTab === t.key ? "bg-white border-x border-t" : "text-gray-600 hover:text-black"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <DriverActionsMenu
              driver={driver}
              isOwnDriver={!!isOwnDriver}
              label={isOwnDriver ? "Actions" : "Interact"}
              queueEvent={queueEvent}
              currentDateISO={gameDateISO}
            />
            <button onClick={onClose} className="m-1 p-2 rounded hover:bg-gray-100" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>

        <section className="p-5 overflow-y-auto">
          {activeTab === "contract" && (
            <ContractTab
              team={contractTeam}
              start={contractStart}
              end={contractEnd}
              salary={contractSalary}
              role={contractRole}
            />
          )}

          {activeTab === "statistics" && (
            <StatisticsTab
              gameYear={gameYear}
              seriesSel={seriesSel}
              setSeriesSel={setSeriesSel}
              seriesOptions={seriesOptions}
              rows={filteredCareer}
              agg={statsAgg}
            />
          )}

          {activeTab === "career" && (
            <CareerTab
              seriesSel={seriesSel}
              setSeriesSel={setSeriesSel}
              seriesOptions={seriesOptions}
              timeline={careerTimeline}
              totals={careerTotals}
            />
          )}

          {activeTab === "attributes" && <AttributesTab attrs={attrs} />}

          {activeTab === "achievements" && <AchievementsTab items={achievementsList} />}
        </section>
      </main>
    </div>
  );
}

/* ======================== Small UI ======================== */

function Row({ label, value }) {
  const v = unbox(value);
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{v ?? "—"}</span>
    </div>
  );
}
function KV({ label, value, className = "" }) {
  const v = unbox(value);
  return (
    <div className={`flex justify-between gap-3 text-sm ${className}`}>
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{v ?? "—"}</span>
    </div>
  );
}

/* ======================== Tabs ======================== */

function ContractTab({ team, start, end, salary, role }) {
  const fmtStartEnd = (v) => {
    if (!v) return "—";
    const y = yearFrom(v);
    return Number.isFinite(y) ? String(y) : String(unbox(v));
  };
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4">
        <KV label="Team"   value={team} />
        <KV label="Role"   value={role ?? "—"} />
        <KV label="Start"  value={fmtStartEnd(start)} />
        <KV label="End"    value={fmtStartEnd(end)} />
        <KV label="Salary" value={fmtMoney(salary)} />
      </div>
    </div>
  );
}

function StatisticsTab({ gameYear, seriesSel, setSeriesSel, seriesOptions, rows, agg }) {
  if (!rows?.length) {
    return (
      <div className="space-y-4">
        <SeriesFilter seriesSel={seriesSel} setSeriesSel={setSeriesSel} seriesOptions={seriesOptions} />
        <p className="text-gray-500 text-sm">
          No statistics available through {gameYear}{seriesSel && seriesSel !== "All" ? ` • ${seriesSel}` : ""}.
        </p>
      </div>
    );
  }

  const perYear = [];
  const map = new Map();
  for (const r of rows) {
    const y = Number(unbox(r.year)) || 0;
    if (!map.has(y)) {
      map.set(y, { year: y, starts: 0, wins: 0, podiums: 0, poles: 0, fl: 0, points: 0, champ_pos: null });
      perYear.push(map.get(y));
    }
    const it = map.get(y);
    it.starts  += Number(unbox(r.starts ?? r.races) ?? 0);
    it.wins    += Number(unbox(r.wins) ?? 0);
    it.podiums += Number(unbox(r.podiums) ?? 0);
    it.poles   += Number(unbox(r.poles) ?? 0);
    it.fl      += Number(unbox(r.fastest_laps) ?? 0);
    it.points  += Number(unbox(r.points) ?? 0);

    const cp = unbox(r.champ_pos);
    if (cp && String(cp).toLowerCase() !== "transfer") {
      if (isNumeric(cp)) {
        const num = Number(cp);
        if (!isNumeric(it.champ_pos) || num < Number(it.champ_pos)) it.champ_pos = num;
      } else if (String(cp).toUpperCase() === "NC" && it.champ_pos == null) {
        it.champ_pos = "NC";
      }
    }
  }
  perYear.sort((a, b) => a.year - b.year);

  return (
    <div className="space-y-5">
      <SeriesFilter seriesSel={seriesSel} setSeriesSel={setSeriesSel} seriesOptions={seriesOptions} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KV label="Starts"            value={agg?.starts ?? 0} />
        <KV label="Wins"              value={agg?.wins ?? 0} />
        <KV label="Podiums"           value={agg?.podiums ?? 0} />
        <KV label="Poles"             value={agg?.poles ?? 0} />
        <KV label="Fastest Laps"      value={agg?.fastest_laps ?? 0} />
        <KV label="Points"            value={agg?.points ?? 0} />
        <KV label="Avg Points"        value={agg?.avgPoints != null ? agg.avgPoints.toFixed(2) : "—"} />
        <KV label="Highest Position"  value={
          agg?.highestPos != null
            ? `P${agg.highestPos}${agg.highestCount ? ` (${agg.highestCount}×)` : ""}`
            : "—"
        } />
        <KV label="Avg Position"      value={agg?.avgPos != null ? agg.avgPos.toFixed(2) : "—"} />
      </div>

      <div>
        <div className="text-sm font-semibold mb-2">
          By Season {seriesSel && seriesSel !== "All" ? `• ${seriesSel}` : ""}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-gray-500 text-xs">
              <tr>
                <th className="text-left pr-3 py-1">Year</th>
                <th className="text-right pr-3 py-1">Starts</th>
                <th className="text-right pr-3 py-1">Wins</th>
                <th className="text-right pr-3 py-1">Podiums</th>
                <th className="text-right pr-3 py-1">Poles</th>
                <th className="text-right pr-3 py-1">FLaps</th>
                <th className="text-right pr-0 py-1">Points</th>
                <th className="text-right pr-0 py-1">Pos</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {perYear.map((r) => {
                const isChampion = isNumeric(r.champ_pos) && Number(r.champ_pos) === 1;
                return (
                  <tr key={r.year} className={r.year===gameYear ? "bg-blue-50" : (isChampion ? "bg-amber-100/70" : "")}>
                    <td className="pr-3 py-1">{r.year}{r.year===gameYear ? " (current)" : ""}</td>
                    <td className="text-right pr-3 py-1">{r.starts}</td>
                    <td className={`text-right pr-3 py-1 ${Number(r.wins) > 0 ? "text-red-600 font-semibold" : ""}`}>{r.wins}</td>
                    <td className="text-right pr-3 py-1">{r.podiums}</td>
                    <td className="text-right pr-3 py-1">{r.poles}</td>
                    <td className="text-right pr-3 py-1">{r.fl}</td>
                    <td className="text-right pr-3 py-1">{r.points}</td>
                    <td className="text-right pr-0 py-1">
                      {isNumeric(r.champ_pos) ? `P${r.champ_pos}` : (r.champ_pos ?? "—")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CareerTab({ seriesSel, setSeriesSel, seriesOptions, timeline, totals }) {
  if (!timeline?.length) {
    return (
      <div className="space-y-4">
        <SeriesFilter seriesSel={seriesSel} setSeriesSel={setSeriesSel} seriesOptions={seriesOptions} />
        <p className="text-gray-500 text-sm">No career data.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <SeriesFilter seriesSel={seriesSel} setSeriesSel={setSeriesSel} seriesOptions={seriesOptions} />

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-gray-500 text-xs">
            <tr>
              <th className="text-left pr-3 py-1">Year</th>
              <th className="text-left pr-3 py-1">Series</th>
              <th className="text-left pr-3 py-1">Team</th>
              <th className="text-right pr-3 py-1">Starts</th>
              <th className="text-right pr-3 py-1">Wins</th>
              <th className="text-right pr-3 py-1">Podiums</th>
              <th className="text-right pr-3 py-1">Poles</th>
              <th className="text-right pr-3 py-1">FLaps</th>
              <th className="text-right pr-3 py-1">Points</th>
              <th className="text-right pr-0 py-1">Position</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {timeline.map((r, i) => {
              const series = unbox(r.series_division) ?? unbox(r.series) ?? "—";
              const isTransfer = String(unbox(r.champ_pos) ?? "").toLowerCase() === "transfer";
              const isChampion = isNumeric(r.champ_pos) && Number(unbox(r.champ_pos)) === 1;
              return (
                <tr key={`${unbox(r.year)}-${i}`} className={isChampion ? "bg-amber-100/70" : ""}>
                  <td className="pr-3 py-1">{unbox(r.year) ?? "—"}</td>
                  <td className="pr-3 py-1">{series}</td>
                  <td className="pr-3 py-1">
                    {r.team_id ? (
                      <span data-entity="team" data-id={unbox(r.team_id)} className="entity-link-team">
                        {unbox(r.team_name) || unbox(r.team_id)}
                      </span>
                    ) : (
                      unbox(r.team_name) || "—"
                    )}
                  </td>
                  <td className="text-right pr-3 py-1">{unbox(r.starts) ?? unbox(r.races) ?? 0}</td>
                  <td className={`text-right pr-3 py-1 ${Number(unbox(r.wins)) > 0 ? "text-red-600 font-semibold" : ""}`}>{unbox(r.wins) ?? 0}</td>
                  <td className="text-right pr-3 py-1">{unbox(r.podiums) ?? 0}</td>
                  <td className="text-right pr-3 py-1">{unbox(r.poles) ?? 0}</td>
                  <td className="text-right pr-3 py-1">{unbox(r.fastest_laps) ?? 0}</td>
                  <td className="text-right pr-3 py-1">{unbox(r.points) ?? 0}</td>
                  <td className="text-right pr-0 py-1">
                    {isNumeric(r.champ_pos)
                      ? `P${unbox(r.champ_pos)}`
                      : (isTransfer ? <span className="italic text-purple-700">Transfer</span> : (unbox(r.champ_pos) ?? "—"))}
                  </td>
                </tr>
              );
            })}
            {totals && (
              <tr className="font-semibold">
                <td colSpan={3} className="pr-3 py-1 text-right">Totals</td>
                <td className="text-right pr-3 py-1">{totals.starts}</td>
                <td className="text-right pr-3 py-1">{totals.wins}</td>
                <td className="text-right pr-3 py-1">{totals.podiums}</td>
                <td className="text-right pr-3 py-1">{totals.poles}</td>
                <td className="text-right pr-3 py-1">{totals.fastest_laps}</td>
                <td className="text-right pr-3 py-1">—</td>
                <td className="text-right pr-0 py-1">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AttributesTab({ attrs }) {
  if (!attrs) return <p className="text-gray-500 text-sm">No attributes.</p>;
  const rows = [
    ["Overall",               attrs.current_ability,               false],
    ["Potential",             attrs.potential_ability,             false],
    ["Pace",                  attrs.pace,                           false],
    ["Qualifying",            attrs.qualifying,                     false],
    ["Start/Launch",          attrs.start_launch,                   false],
    ["Racecraft",             attrs.racecraft,                      false],
    ["Wet Skill",             attrs.wet_skill,                      false],
    ["Consistency",           attrs.consistency,                    false],
    ["Tyre Management",       attrs.tire_management,                false],
    ["Race Intelligence",     attrs.race_intelligence,              false],
    ["Technical Feedback",    attrs.technical_feedback,             false],
    ["Adaptability",          attrs.adaptability,                   false],
    ["ERS/Fuel Management",   attrs.ers_fuel_management,            false],
    ["Mentality",             attrs.mentality,                      false],
    ["Aggression",            attrs.agression ?? attrs.aggression,  false],
    ["Crash Likelihood",      attrs.crash_likelihood,               true],
    ["Pressure Handling",     attrs.pressure_handling,              false],
    ["Leadership",            attrs.leadership,                     false],
    ["Team Player",           attrs.team_player,                    false],
    ["Car Dev. Impact",       attrs.car_development_impact,         false],
    ["Reputation",            attrs.reputation,                     false],
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {rows.map(([label, value, inverse]) => (
        <div key={label} className="flex justify-between gap-3 text-sm">
          <span className="text-gray-500">{label}</span>
          <span className={`font-medium ${attrColorClass(value, { inverse })}`}>{unbox(value) ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

function AchievementsTab({ items }) {
  if (!items?.length) return <p className="text-gray-500 text-sm">No achievements yet.</p>;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-gray-500 text-xs">
            <tr>
              <th className="text-left pr-3 py-1">Year</th>
              <th className="text-left pr-3 py-1">Team</th>
              <th className="text-left pr-3 py-1">Drivers' Champ</th>
              <th className="text-left pr-3 py-1">Constructors' Champ</th>
              <th className="text-right pr-3 py-1">Wins</th>
              <th className="text-right pr-0 py-1">Podiums</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((a, i) => (
              <tr key={i}>
                <td className="pr-3 py-1">{unbox(a.year) ?? "—"}{a.__live ? " (current)" : ""}</td>
                <td className="pr-3 py-1">
                  {a.team_id ? (
                    <span data-entity="team" data-id={unbox(a.team_id)} className="entity-link-team">
                      {unbox(a.team_name) || unbox(a.team_id) || "—"}
                    </span>
                  ) : (
                    unbox(a.team_name) || "—"
                  )}
                </td>
                <td className="pr-3 py-1">{unbox(a.driver_championship) ?? "—"}</td>
                <td className="pr-3 py-1">{unbox(a.team_championship) ?? "—"}</td>
                <td className="text-right pr-3 py-1">{unbox(a.wins) ?? 0}</td>
                <td className="text-right pr-0 py-1">{unbox(a.podiums) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ======================== Tiny bits ======================== */

function SeriesFilter({ seriesSel, setSeriesSel, seriesOptions }) {
  if (!seriesOptions || seriesOptions.length <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1">
        <Filter size={14}/> Series
      </span>
      <select
        className="border rounded-md px-2 py-1 text-sm"
        value={seriesSel}
        onChange={(e) => setSeriesSel(e.target.value)}
      >
        {seriesOptions.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}

/* Actions / Interact */

function ActionsButton({ label = "Actions", children, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  return (
    <div ref={ref} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-zinc-800"
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
      >
        <MoreVertical size={16} />
        <span className="hidden sm:inline">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 z-30 mt-2 w-72 origin-top-right rounded-xl border bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="max-h-[60vh] overflow-y-auto p-1">{children}</div>
        </div>
      )}
    </div>
  );
}

function DriverActionsMenu({ driver, isOwnDriver, label = "Actions", queueEvent, currentDateISO }) {
  const fx = {
    addAttr: (attr, delta) => ({ key: "driver_attr", driverId: unbox(driver?.driver_id), attr, delta }),
    fatigue: (delta) => ({ key: "fatigue", delta }),
    synergy: (delta) => ({ key: "team_synergy", delta }),
  };

  const ownGroups = [
    {
      title: "Training & Development",
      items: [
        { key: "sim_braking",  icon: <Dumbbell size={14} />, label: "Simulator — Consistency", desc: "+Consistency | +Fatigue", effects: [fx.addAttr("consistency", +1), fx.fatigue(+2)] },
        { key: "sim_pace",     icon: <Dumbbell size={14} />, label: "Simulator — Pace",         desc: "+Pace | +Fatigue",        effects: [fx.addAttr("pace", +1), fx.fatigue(+2)] },
        { key: "qual_runs",    icon: <Dumbbell size={14} />, label: "Quali sims",               desc: "+Qualifying | +Fatigue",  effects: [fx.addAttr("qualifying", +1), fx.fatigue(+2)] },
        { key: "wet_practice", icon: <Dumbbell size={14} />, label: "Wet practice",             desc: "+Wet Skill | +Fatigue",   effects: [fx.addAttr("wet_skill", +1), fx.fatigue(+2)] },
        { key: "tyre_drills",  icon: <Dumbbell size={14} />, label: "Tyre mgmt drills",         desc: "+Tyre Mgmt | +Fatigue",   effects: [fx.addAttr("tire_management", +1), fx.fatigue(+2)] },
        { key: "racecraft",    icon: <Dumbbell size={14} />, label: "Racecraft study",          desc: "+Racecraft | +Fatigue",   effects: [fx.addAttr("racecraft", +1), fx.fatigue(+1)] },
        { key: "data_review",  icon: <Wrench size={14}   />, label: "Data review w/ engineers", desc: "+Team synergy",           effects: [fx.synergy(+1)] },
      ],
    },
    {
      title: "Media & PR",
      items: [
        { key: "sponsor_event", icon: <Megaphone size={14} />, label: "Sponsor activation", desc: "Reputation↑ | +Fatigue", effects: [fx.addAttr("reputation", +1), fx.fatigue(+1)] },
        { key: "tv_interview",  icon: <Megaphone size={14} />, label: "TV interview",       desc: "Reputation ± (risk) | +Fatigue", effects: [fx.fatigue(+1)] },
        { key: "media_training",icon: <MessageSquare size={14} />, label: "Media training", desc: "+Pressure Handling", effects: [fx.addAttr("pressure_handling", +1)] },
      ],
    },
    {
      title: "Wellbeing & Admin",
      items: [
        { key: "rest_day",      icon: <Coffee size={14} />, label: "Rest day",       desc: "-Fatigue", effects: [fx.fatigue(-3)] },
        { key: "physical",      icon: <Dumbbell size={14} />, label: "Physical training", desc: "+Mentality | +Fatigue", effects: [fx.addAttr("mentality", +1), fx.fatigue(+3)] },
        { key: "contract_talk", icon: <FileText size={14} />, label: "Contract talk", desc: "Opens negotiation flow", effects: [] },
      ],
    },
  ];

  const otherGroups = [
    {
      title: "Scouting & Info",
      items: [
        { key: "scout_watch",       icon: <Search size={14} />,    label: "Observe performance", desc: "Scouting report", effects: [] },
        { key: "agent_probe",       icon: <Handshake size={14} />, label: "Approach agent",      desc: "Salary & clauses", effects: [] },
        { key: "private_test_offer",icon: <Search size={14} />,    label: "Offer private test",  desc: "If legal", effects: [] },
      ],
    },
    {
      title: "Market Actions",
      items: [
        { key: "open_negotiation",  icon: <Handshake size={14} />, label: "Open negotiations", desc: "Formal offer", effects: [] },
        { key: "networking_event",  icon: <Handshake size={14} />, label: "Networking at event", desc: "Relationship↑", effects: [] },
      ],
    },
    {
      title: "Media",
      items: [
        { key: "press_comment", icon: <Megaphone size={14} />, label: "Comment to press", desc: "Affects morale/rival", effects: [] },
        { key: "rumor_check",   icon: <Search size={14} />,    label: "Investigate rumors", desc: "Unhappy? buyout?", effects: [] },
      ],
    },
  ];

  const groups = isOwnDriver ? ownGroups : otherGroups;

  function onPick(it) {
    queueEvent({
      type: isOwnDriver ? "driver_action" : "market_action",
      title: it.label,
      date: currentDateISO,
      participants: [unbox(driver?.driver_id)],
      effects: it.effects || [],
      meta: { uiKey: it.key, driverId: unbox(driver?.driver_id), driverName: unbox(driver?.display_name) || unbox(driver?.name) },
    });
  }

  return (
    <ActionsButton label={label}>
      <div className="px-2 pt-2 pb-1 sticky top-0 bg-white dark:bg-zinc-900">
        <div className="text-[10px] uppercase font-semibold tracking-wide text-gray-500">Quick actions</div>
      </div>

      {groups.map((g, gi) => (
        <div key={g.title} className={gi > 0 ? "pt-1" : ""}>
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {g.title}
          </p>
          <ul className="mb-1">
            {g.items.map((it) => (
              <li key={it.key}>
                <button
                  type="button"
                  onClick={() => onPick(it)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-zinc-800"
                >
                  <span className="mt-0.5 shrink-0">{it.icon}</span>
                  <span className="flex-1">
                    <span className="block text-[13px] leading-tight font-medium">{it.label}</span>
                    {it.desc && <span className="block text-[11px] leading-tight text-gray-500 dark:text-gray-400">{it.desc}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {gi < groups.length - 1 && <div className="my-1 h-px w-full bg-gray-100 dark:bg-zinc-800" />}
        </div>
      ))}

      <div className="px-2 pb-2 text-[10px] text-gray-400">Scroll for more • ESC to close</div>
    </ActionsButton>
  );
}
