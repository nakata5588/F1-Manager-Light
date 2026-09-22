// src/components/entity/DriverModal.jsx
import { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  X, Filter, MoreVertical, Dumbbell, Megaphone,
  Handshake, FileText, Coffee, Search
} from "lucide-react";
import { useModalStore } from "../../state/ModalStore.js";
import { useGame } from "../../state/GameStore.js";
import { driverOverallPresentation, hasMeaningfulDriverAttributes } from "../../domain/driverMarketEvaluation.js";
import { driverProfileSnapshot } from "../../domain/driverProfile.js";
import { presentDriverKnowledgeValue } from "../../domain/driverKnowledge.js";
import { driverDerivedRatings } from "../../domain/driverDerivedRatings.js";
import {
  driverAttributeGroups,
  driverAttributeGroupScore,
  driverAttributeGroupBehaviourForScore,
  driverAttributeValue,
  driverDevelopmentFocus,
  driverDevelopmentFocusState,
  driverWheelToWheelBehaviour,
} from "../../domain/driverAttributeGroups.js";
import { DriverPortrait, TeamLogo, flagFromCountry } from "./EntityVisuals.jsx";
import ContractNegotiationModal from "../drivers/ContractNegotiationModal.jsx";
import {
  activeDriverContract,
  driverContractsOf,
  expectedDriverSalary,
  releaseDriverContract,
  teamIdOf,
  terminationCost,
} from "../../domain/driverContracts.js";
import {
  driverNegotiationEligibility,
  driverNegotiations,
  isNegotiationActive,
  startDriverNegotiation,
  startDriverRenewal,
} from "../../engine/NegotiationEngine.js";

/* ======================== Helpers & Const ======================== */

const TABS = [
  { key: "overview",    label: "Overview" },
  { key: "attributes",  label: "Attributes" },
  { key: "development", label: "Development" },
  { key: "career",      label: "Career" },
];

const TAB_ALIASES = Object.freeze({
  statistics: "career",
  performance: "career",
  contract: "overview",
  achievements: "career",
});

// --- unwrap Excel-like cells or Rich values { formula, result } / { value } / { text }
function unbox(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("error" in v && !("result" in v) && !("value" in v) && !("text" in v)) return null;
    if ("result" in v) return unbox(v.result);
    if ("value" in v) return unbox(v.value);
    if ("text" in v) return unbox(v.text);
  }
  return v;
}
function isRecord(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function displayValue(v, fallback = "—") {
  const x = unbox(v);
  if (x === null || x === undefined || x === "") return fallback;
  if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") return x;
  return String(x);
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
  if (s.includes("reserve") || s.includes("reserva")) return "Reserve Driver";
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
  if (!Number.isFinite(raw)) return "text-slate-500";
  const v = Math.max(0, Math.min(100, raw));
  const idx = v < 25 ? 0 : v < 50 ? 1 : v < 63 ? 2 : v < 75 ? 3 : v < 85 ? 4 : 5;
  const pos = ["text-rose-400","text-rose-300","text-amber-300","text-amber-200","text-emerald-300","text-emerald-200"];
  const neg = ["text-emerald-200","text-emerald-300","text-amber-200","text-amber-300","text-rose-300","text-rose-400"];
  return (inverse ? neg : pos)[idx];
}
function presentationColorClass(shown, { inverse = false } = {}) {
  if (!shown || shown.visibility === "hidden" || shown.visibility === "missing") return "text-slate-500";
  const basis = shown.visibility === "exact" ? shown.value : shown.sortValue;
  return attrColorClass(basis, { inverse });
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
  if (!isRecord(obj)) return null;
  const keys = [
    "driver_id", "driverId", "id", "person_id", "personId", "driver", "driver_code"
  ];
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const n = normDriverId(obj[k]);
      if (n) return n;
    }
  }
  if (isRecord(obj.driver)) return extractDriverId(obj.driver);
  return null;
}

/* ======================== Component ======================== */

export default function DriverModal({ entity, onClose, pageMode = false }) {
  const navigate = useNavigate();
  const modalSetTab = useModalStore((s) => s.setTab);
  const rawTab = unbox(entity.tab) || "overview";
  const initialTab = TAB_ALIASES[rawTab] || rawTab;
  const [pageTab, setPageTab] = useState(initialTab);
  const activeTab = pageMode ? pageTab : initialTab;
  const setTab = (tab) => {
    if (pageMode) setPageTab(tab);
    else modalSetTab(tab);
  };
  const idNorm = useMemo(() => normDriverId(entity.id), [entity.id]);

  // Read the store through stable primitive/reference selectors. All collections
  // are normalized locally before profile logic uses find/filter/map.
  const gs = useGame((s) => s.gameState);
  const setGameState = useGame((s) => s.setGameState);
  const queueEvent = useGame((s) => s.queueEvent);
  const [contractTalkOpen, setContractTalkOpen] = useState(false);
  const [marketTalkOpen, setMarketTalkOpen] = useState(false);
  const [compareDriverId, setCompareDriverId] = useState("");
  const [compareQuery, setCompareQuery] = useState("");
  const [compareMode, setCompareMode] = useState("performance");

  const driversList = useMemo(() => {
    const merged = new Map();
    for (const row of toArraySafe(gs?.dbDrivers)) {
      const id = normDriverId(row?.driver_id ?? row?.driverId ?? row?.id);
      if (id) merged.set(id, row);
    }
    for (const row of toArraySafe(gs?.drivers)) {
      const id = normDriverId(row?.driver_id ?? row?.driverId ?? row?.id);
      if (id) merged.set(id, { ...(merged.get(id) || {}), ...row });
    }
    return [...merged.values()];
  }, [gs?.drivers, gs?.dbDrivers]);
  const ratingsList = useMemo(() => {
    const merged = new Map();
    for (const row of toArraySafe(gs?.dbDriverRatings)) {
      const id = normDriverId(row?.driver_id ?? row?.driverId ?? row?.id);
      if (id) merged.set(id, row);
    }
    for (const row of toArraySafe(gs?.driverRatings)) {
      const id = normDriverId(row?.driver_id ?? row?.driverId ?? row?.id);
      if (id) merged.set(id, { ...(merged.get(id) || {}), ...row });
    }
    return [...merged.values()];
  }, [gs?.driverRatings, gs?.dbDriverRatings]);
  const contractsList = useMemo(
    () => driverContractsOf(gs),
    [gs?.contracts, gs?.dbContracts]
  );
  const careerRaw = useMemo(() => {
    const live = toArraySafe(gs?.driverCareer);
    return live.length ? live : toArraySafe(gs?.dbDriverCareer);
  }, [gs?.driverCareer, gs?.dbDriverCareer]);
  const generatedHistoryRaw = useMemo(
    () => [...toArraySafe(gs?.driverHistory), ...toArraySafe(gs?.dbDriverHistory)],
    [gs?.driverHistory, gs?.dbDriverHistory]
  );
  const achievementsArr = useMemo(
    () => toArraySafe(gs?.achievements).length ? toArraySafe(gs?.achievements) : toArraySafe(gs?.dbAchievements),
    [gs?.achievements, gs?.dbAchievements]
  );
  const results = useMemo(() => toArraySafe(gs?.results), [gs?.results]);
  const historySeasons = useMemo(() => toArraySafe(gs?.historySeasons), [gs?.historySeasons]);
  const teamsList = useMemo(() => {
    const merged = new Map();
    for (const row of toArraySafe(gs?.dbTeams)) {
      const id = String(unbox(row?.team_id ?? row?.id ?? ""));
      if (id) merged.set(id, row);
    }
    for (const row of toArraySafe(gs?.teams)) {
      const id = String(unbox(row?.team_id ?? row?.id ?? ""));
      if (id) merged.set(id, { ...(merged.get(id) || {}), ...row });
    }
    return [...merged.values()];
  }, [gs?.teams, gs?.dbTeams]);
  const standings = isRecord(gs?.standings) ? gs.standings : { drivers: [], teams: [] };
  const driverAttributesDict = isRecord(gs?.driverAttributes) ? gs.driverAttributes : {};
  const gameYear = Number(gs?.activeYear ?? (gs?.currentDateISO ? String(gs.currentDateISO).slice(0,4) : NaN));
  const careerStartYear = Number(gs?.careerMeta?.sourceSeason ?? gs?.activeYear ?? (gs?.currentDateISO ? String(gs.currentDateISO).slice(0,4) : NaN));
  const gameDateISO = gs?.currentDateISO ?? null;
  const myTeamId = gs?.team?.team_id ?? gs?.team?.id ?? null;
  const myTeamName = displayValue(gs?.team?.team_name ?? gs?.team?.name, null);


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

  const condition = useMemo(() => {
    const directKey = String(driver?.driver_id ?? entity.id ?? "");
    const direct = driverAttributesDict?.[directKey];
    const compat = idNorm ? driverAttributesDict?.[idNorm] : null;
    return {
      confidence: 50,
      fatigue: 0,
      morale: 50,
      preparation: 50,
      ...(isRecord(compat) ? compat : {}),
      ...(isRecord(direct) ? direct : {}),
    };
  }, [driverAttributesDict, driver?.driver_id, entity.id, idNorm]);

  const driverId = String(unbox(driver?.driver_id ?? driver?.person_id ?? driver?.id ?? entity.id) ?? "");
  const profileSnapshot = useMemo(
    () => driverProfileSnapshot(gs, driver || driverId),
    [gs, driver, driverId]
  );
  const comparisonDriver = useMemo(
    () => compareDriverId
      ? (driversList || []).find((d) => sameDriver(d?.driver_id ?? d?.driverId ?? d?.id, compareDriverId)) || null
      : null,
    [compareDriverId, driversList]
  );
  const comparisonSnapshot = useMemo(
    () => comparisonDriver ? driverProfileSnapshot(gs, comparisonDriver) : null,
    [gs, comparisonDriver]
  );
  const developmentLog = useMemo(() => {
    const log = isRecord(gs?.driverAttrLog) ? gs.driverAttrLog : {};
    const direct = toArraySafe(log?.[driverId]);
    const compat = idNorm ? toArraySafe(log?.[idNorm]) : [];
    return [...direct, ...compat]
      .filter((row, index, rows) => rows.findIndex((x) =>
        String(x?.dateISO||"")===String(row?.dateISO||"") &&
        String(x?.attr||"")===String(row?.attr||"") &&
        Number(x?.after)===Number(row?.after)
      )===index)
      .sort((a,b) => String(b?.dateISO||"").localeCompare(String(a?.dateISO||"")));
  }, [gs?.driverAttrLog, driverId, idNorm]);

  const contract = useMemo(
    () => activeDriverContract(gs, driverId),
    [gs, driverId]
  );

  // Contract values are needed by the live-season memo below. Keep these
  // declarations before any memo that references them to avoid TDZ crashes.
  // Runtime contracts use contract_start_year / contract_until_year; keep the
  // legacy aliases as fallbacks for old saves.
  const contractStart =
    unbox(contract?.contract_start_year) ??
    unbox(contract?.contract_start) ??
    unbox(contract?.start_year) ??
    unbox(contract?.start_date) ??
    null;
  const contractEnd =
    unbox(contract?.contract_until_year) ??
    unbox(contract?.contract_until) ??
    unbox(contract?.end_year) ??
    unbox(contract?.end_date) ??
    null;
  const contractTeamId = contract ? teamIdOf(contract) : "";
  const contractTeamRecord = (teamsList || []).find((team) =>
    String(unbox(team?.team_id ?? team?.id ?? "")) === String(contractTeamId)
  );
  const contractTeam = displayValue(
    contract?.team_name ??
    contractTeamRecord?.team_name ??
    contractTeamRecord?.name ??
    contract?.team,
    null
  );
  const contractRole = contract ? niceRole(contract?.role) : null;
  const contractSalary = unbox(contract?.salary ?? contract?.salary_yearly);

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
      team_name: displayValue(next.team_name ?? next.team, "Unknown Team"),
      when: whenISO,
      whenLabel: whenISO ? (whenISO.length === 10 ? whenISO : String(unbox(next.start_year))) : (unbox(next.start_year) ?? "future"),
    };
  }, [contractsList, idNorm, gameDateISO, gameYear]);

  const careerAll = useMemo(() => {
    const merged = new Map();
    const push = (row, priority = 0) => {
      if (!sameDriver(row?.driver_id ?? row?.driverId, idNorm)) return;
      const y = Number(unbox(row?.year));
      if (!Number.isFinite(y) || (Number.isFinite(careerStartYear) && y >= careerStartYear)) return;
      const series = getSeries(row) || "F1";
      const teamKey = String(unbox(row?.team_id) ?? unbox(row?.team_name) ?? "");
      const key = [y, series.toUpperCase(), teamKey].join("|");
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, { ...row, __priority: priority });
        return;
      }
      const next = { ...prev };
      for (const [k, v] of Object.entries(row || {})) {
        if (v !== undefined && v !== null && v !== "") next[k] = v;
      }
      next.__priority = Math.max(Number(prev.__priority || 0), priority);
      merged.set(key, next);
    };
    for (const row of generatedHistoryRaw || []) push(row, 1);
    for (const row of careerRaw || []) push(row, 2);
    return [...merged.values()].map(({ __priority, ...row }) => row);
  }, [careerRaw, generatedHistoryRaw, idNorm, careerStartYear]);

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

  const simulatedCareerRows = useMemo(() => {
    if (!Number.isFinite(gameYear)) return [];
    const byKey = new Map();
    const teamNameById = new Map((teamsList || []).map((t) => [
      String(t?.team_id ?? t?.id ?? ""),
      unbox(t?.team_name) || unbox(t?.name) || String(t?.team_id ?? t?.id ?? ""),
    ]));

    for (const event of results || []) {
      const y = Number(event?.year);
      if (!Number.isFinite(y) || y < careerStartYear || y > gameYear) continue;
      const raceRow = toArraySafe(event?.classification).find((r) => sameDriver(r?.driver_id ?? r?.id, idNorm));
      const qRow = toArraySafe(event?.qualifying).find((r) => sameDriver(r?.driver_id ?? r?.id, idNorm));
      if (!raceRow && !qRow) continue;

      const team_id = unbox(raceRow?.team_id ?? qRow?.team_id) ?? null;
      const key = [y, String(team_id ?? "")].join("|");
      if (!byKey.has(key)) {
        byKey.set(key, {
          __simulated: true,
          __live: y === gameYear,
          year: y,
          series_division: "F1",
          team_id,
          team_name: teamNameById.get(String(team_id ?? "")) || (y === gameYear ? contractTeam : null) || "—",
          starts: 0, races: 0, wins: 0, podiums: 0, poles: 0, fastest_laps: 0, points: 0, champ_pos: null,
        });
      }
      const rec = byKey.get(key);
      if (raceRow) {
        rec.starts += 1;
        rec.races += 1;
        const pos = Number(raceRow.position);
        if (!raceRow.retired && pos === 1) rec.wins += 1;
        if (!raceRow.retired && pos >= 1 && pos <= 3) rec.podiums += 1;
        if (raceRow.fastest_lap) rec.fastest_laps += 1;
        rec.points += Number(raceRow.points || 0);
      }
      if (qRow && Number(qRow.position) === 1) rec.poles += 1;
    }

    for (const rec of byKey.values()) {
      const seasonStanding = rec.year === gameYear
        ? toArraySafe(standings?.drivers)
        : toArraySafe(historySeasons.find((h) => Number(h?.year) === Number(rec.year))?.standings?.drivers);
      const standing = seasonStanding.find((r) => sameDriver(r?.driver_id ?? r?.id, idNorm));
      rec.champ_pos = standing?.position ?? null;
    }

    return [...byKey.values()].sort((a,b) => Number(a.year)-Number(b.year));
  }, [results, standings, historySeasons, teamsList, gameYear, careerStartYear, idNorm, contractTeam]);

  const liveSeasonRows = useMemo(
    () => simulatedCareerRows.filter((r) => Number(r.year) === Number(gameYear)),
    [simulatedCareerRows, gameYear]
  );

  const liveSeasonRow = useMemo(() => {
    if (!liveSeasonRows.length) return null;
    const sum = (key) => liveSeasonRows.reduce((acc, row) => acc + Number(row?.[key] || 0), 0);
    const last = liveSeasonRows[liveSeasonRows.length - 1];
    return {
      ...last,
      starts: sum("starts"),
      races: sum("races"),
      wins: sum("wins"),
      podiums: sum("podiums"),
      poles: sum("poles"),
      fastest_laps: sum("fastest_laps"),
      points: sum("points"),
    };
  }, [liveSeasonRows]);

  const filteredCareer = useMemo(() => {
    const rows = [...(careerAll || []), ...(simulatedCareerRows || [])];
    if (seriesSel === "All") return rows;
    return rows.filter((r) => getSeries(r).toUpperCase() === seriesSel.toUpperCase());
  }, [careerAll, simulatedCareerRows, seriesSel]);

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

  // Achievements are championship outcomes, not a duplicate wins/podium log.
  // Historical seasons use career/achievement data; played seasons use the
  // archived standings derived from actual race results.
  const achievementsList = useMemo(() => {
    const map=new Map();
    const add=(row,priority=0)=>{
      const year=Number(unbox(row?.year));
      const pos=Number(unbox(
        row?.driver_championship ??
        row?.championship_position ??
        row?.champ_pos ??
        row?.position
      ));
      if(!Number.isFinite(year)||year>=Number(gameYear))return;
      if(!Number.isFinite(pos)||pos<1||pos>3)return;
      const series=String(getSeries(row)||"F1").toUpperCase();
      if(series&&series!=="F1")return;
      const key=String(year);
      const prev=map.get(key);
      if(prev&&Number(prev.__priority||0)>priority)return;
      map.set(key,{
        year,
        position:pos,
        achievement:pos===1?"World Champion":`Championship P${pos}`,
        team_id:unbox(row?.team_id)??null,
        team_name:displayValue(row?.team_name??row?.team,"—"),
        __priority:priority,
      });
    };

    for(const row of achievementsArr||[]){
      if(sameDriver(extractDriverId(row),idNorm))add(row,1);
    }
    for(const row of careerAll||[])add(row,2);
    for(const row of simulatedCareerRows||[])add(row,3);

    return [...map.values()]
      .map(({__priority,...row})=>row)
      .sort((a,b)=>Number(a.year)-Number(b.year));
  }, [achievementsArr,careerAll,simulatedCareerRows,idNorm,gameYear]);
  const yearsRaced = useMemo(() => {
    const rookie = Number(unbox(driver?.f1_rookie_season));
    if (!Number.isFinite(rookie) || !Number.isFinite(gameYear)) return null;
    const v = gameYear - rookie;
    return v < 0 ? 0 : v;
  }, [driver?.f1_rookie_season, gameYear]);

  const computedAge = useMemo(() => {
    const explicit = Number(driver?.age);
    return Number.isFinite(explicit) ? explicit : ageOnYear(driver?.dob, gameYear);
  }, [driver?.age, driver?.dob, gameYear]);

  const overallView  = profileSnapshot?.overall || driverOverallPresentation(gs, driver || entity.id);
  const knowledge     = profileSnapshot?.knowledge || null;
  const overallPresentation = presentDriverKnowledgeValue(
    knowledge,
    "current_ability",
    overallView?.value,
    {kind:"ability",estimated:overallView?.estimated}
  );
  const overallLabel  = overallPresentation.label;
  const rawMarketValue = Number(unbox(attrs?.market_value));
  const marketValue   = Number.isFinite(rawMarketValue) && rawMarketValue > 0 ? rawMarketValue : null;
  const meaningfulAttrs = hasMeaningfulDriverAttributes(attrs) ? attrs : null;
  const driverName    = displayValue(driver?.display_name ?? driver?.name, "Unknown Driver");
  const driverNumber  = displayValue(driver?.prefered_number ?? driver?.preferred_number ?? driver?.driver_number, null);
  const driverCountry = displayValue(driver?.country_name ?? driver?.nationality ?? driver?.country, "—");

  const isOwnDriver =
    !!contract &&
    !!myTeamId &&
    String(contractTeamId) === String(myTeamId);

  const marketEligibility = useMemo(
    () => (!isOwnDriver && myTeamId && driverId)
      ? driverNegotiationEligibility(gs, { driverId, teamId: String(myTeamId) })
      : { canNegotiate: false, reason: "own_driver", roles: [], contract, pending: null },
    [gs, driverId, myTeamId, isOwnDriver, contract]
  );

  const renewalPending = useMemo(
    () => driverNegotiations(gs).some((negotiation) =>
      negotiation?.kind === "renewal" &&
      negotiation?.origin === "player" &&
      String(negotiation?.driver_id) === String(driverId) &&
      String(negotiation?.team_id) === String(myTeamId ?? "") &&
      isNegotiationActive(negotiation)
    ),
    [gs, driverId, myTeamId]
  );

  const releaseCost = isOwnDriver && contract ? terminationCost(gs, contract) : 0;
  const developmentFocusKey = driverDevelopmentFocus(gs, driverId);
  const developmentFocusState = driverDevelopmentFocusState(gs, driverId);
  const developmentTraining = gs?.driverDevelopmentTraining?.[driverId]||null;
  const potentialLog = (gs?.driverPotentialLog?.[driverId]||[])
    .slice()
    .sort((a,b)=>String(b?.dateISO||"").localeCompare(String(a?.dateISO||"")));

  function setDriverDevelopmentFocus(groupKey) {
    if (!isOwnDriver || !driverId || !groupKey) return;
    if(developmentFocusState?.locked && developmentFocusState?.groupKey!==groupKey)return;
    const monthKey=String(gameDateISO||"").slice(0,7);
    setGameState({
      driverDevelopmentFocus:{
        ...(gs?.driverDevelopmentFocus||{}),
        [driverId]:groupKey,
      },
      driverDevelopmentFocusMeta:{
        ...(gs?.driverDevelopmentFocusMeta||{}),
        [driverId]:{
          groupKey,
          monthKey,
          selectedAt:gameDateISO,
        },
      },
    });
  }

  function openScoutingForDriver() {
    if (!driverId) return;
    onClose?.();
    navigate(`/Scouting?driver=${encodeURIComponent(driverId)}`);
  }

  function submitContractRenewal(offer) {
    if (!isOwnDriver || !contract || !driverId) return;
    const next = startDriverRenewal(gs, {
      driverId,
      teamId: String(myTeamId),
      teamName: myTeamName || contractTeam || String(myTeamId),
      offer: { ...offer, role: contractRole },
      origin: "player",
    });
    setGameState(next);
    setContractTalkOpen(false);
  }

  function releaseCurrentDriver() {
    if (!isOwnDriver || !contract || !driverId) return;
    const ok = window.confirm(
      "Release " + driverName + "?\n\nContract termination cost: " + fmtMoney(releaseCost) +
      "\n\nThe driver will become available to the market immediately."
    );
    if (!ok) return;
    setGameState(releaseDriverContract(gs, driverId));
    setContractTalkOpen(false);
  }

  function submitMarketNegotiation(offer) {
    if (!marketEligibility?.canNegotiate || !myTeamId || !driverId) return;
    const next = startDriverNegotiation(gs, {
      driverId,
      teamId: String(myTeamId),
      teamName: myTeamName || String(myTeamId),
      offer,
      origin: "player",
    });
    setGameState(next);
    setMarketTalkOpen(false);
  }

  if (!driver) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Driver not found</h3>
          {!pageMode && <button onClick={onClose} className="p-2 rounded hover:bg-gray-100"><X size={18} /></button>}
        </div>
        <p className="text-sm text-gray-500">ID: {entity.id}</p>
      </div>
    );
  }

  return (
    <div className={`flex bg-[#090b10] text-slate-100 ${pageMode ? "min-h-[calc(100vh-5rem)] rounded-2xl border border-white/10 shadow-xl" : "h-[92vh]"}`}>
      <aside className="w-[290px] shrink-0 border-r border-white/10 bg-[#11141c] p-5 overflow-y-auto">
        <div className="flex items-center gap-3">
          <DriverPortrait driver={driver} size="h-20 w-20" className="!rounded-xl"/>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Driver</div>
            <div className="text-xl font-semibold leading-tight truncate">{driverName}</div>
            <div className="mt-1 text-xs text-slate-400">
              {flagFromCountry(driverCountry, driver?.country_code)} {driverCountry}
              {driverNumber ? ` · #${driverNumber}` : ""}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-[#171a23] p-3">
          <div className="flex items-center gap-3">
            <TeamLogo teamId={contractTeamId || profileSnapshot?.teamId} name={contractTeam || profileSnapshot?.teamName || "Team"} size="h-10 w-10"/>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{contractTeam || profileSnapshot?.teamName || "Free Agent"}</div>
              <div className="text-xs text-slate-500">{contractRole || "No active role"}</div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <ProfileMetric label="OVR" value={overallLabel}/>
          <ProfileMetric label="Champ" value={profileSnapshot?.season?.championshipPosition ? `P${profileSnapshot.season.championshipPosition}` : "—"}/>
          <ProfileMetric label="Points" value={profileSnapshot?.season?.points ?? 0}/>
        </div>

        <div className="mt-4">
          {knowledge?.canSeeCondition ? (
            <div className="space-y-3">
              <ConditionBar label="Confidence" value={condition?.confidence ?? 50}/>
              <ConditionBar label="Morale" value={condition?.morale ?? 50}/>
              <ConditionBar label="Preparation" value={condition?.preparation ?? 50}/>
              <ConditionBar label="Fatigue" value={condition?.fatigue ?? 0} inverse/>
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-[#171a23] p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Private condition data</div>
              <div className="mt-1 text-xs text-slate-400">Confidence, morale, preparation and fatigue are only visible for your contracted team drivers.</div>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-white/10 pt-4 text-xs text-slate-400 space-y-2">
          <div className="flex justify-between gap-3"><span>Age</span><strong className="text-slate-200">{computedAge ?? "—"}</strong></div>
          <div className="flex justify-between gap-3"><span>Rookie season</span><strong className="text-slate-200">{unbox(driver?.f1_rookie_season) ?? "—"}</strong></div>
          <div className="flex justify-between gap-3"><span>Years raced</span><strong className="text-slate-200">{yearsRaced ?? "—"}</strong></div>
          <div className="flex justify-between gap-3"><span>Market value</span><strong className="text-slate-200">{knowledge?.exactAbility?fmtMoney(marketValue):"Scout required"}</strong></div>
        </div>

        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Contract</div>
          <div className="mt-2 space-y-2 text-xs text-slate-400">
            <div className="flex justify-between gap-3"><span>Team</span><strong className="max-w-[150px] truncate text-right text-slate-200">{contractTeam||"Free Agent"}</strong></div>
            <div className="flex justify-between gap-3"><span>Role</span><strong className="text-right text-slate-200">{contractRole||"—"}</strong></div>
            <div className="flex justify-between gap-3"><span>Salary</span><strong className="text-right text-slate-200">{contract?fmtMoney(contractSalary):"—"}</strong></div>
            <div className="flex justify-between gap-3"><span>Ends</span><strong className="text-right text-slate-200">{contractEnd||"—"}</strong></div>
          </div>
          {futureTransfer && (
            <div className="mt-3 rounded-lg border border-purple-400/20 bg-purple-500/10 p-2 text-[11px] text-purple-200">
              Joins {futureTransfer.team_name} {futureTransfer.whenLabel}.
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 flex flex-col bg-[#0c0f15]">
        <header className="border-b border-white/10 bg-[#11141c]">
          <div className="flex items-start justify-between gap-4 px-5 pt-4">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Driver Profile</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold truncate">{driverName}</h2>
                {isOwnDriver && <span className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-300">YOUR DRIVER</span>}
                {!profileSnapshot?.availability?.available && (
                  <span className="rounded bg-rose-500/15 px-2 py-1 text-[10px] font-medium uppercase text-rose-300">
                    {profileSnapshot?.availability?.status || "Unavailable"}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {contractTeam || profileSnapshot?.teamName || "Free Agent"} · {contractRole || "No active role"}
                {knowledge?.canSeeCondition && Number.isFinite(Number(profileSnapshot?.conditionImpact?.total))
                  ? ` · Current performance ${Number(profileSnapshot.conditionImpact.total)>=0?"+":""}${Number(profileSnapshot.conditionImpact.total).toFixed(1)}`
                  : ""}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <DriverActionsMenu
                driver={driver}
                condition={condition}
                isOwnDriver={!!isOwnDriver}
                label={isOwnDriver ? "Actions" : "Interact"}
                queueEvent={queueEvent}
                currentDateISO={gameDateISO}
                onContractTalk={() => setContractTalkOpen(true)}
                onRelease={releaseCurrentDriver}
                onOpenNegotiation={() => setMarketTalkOpen(true)}
                onScout={openScoutingForDriver}
                onDevelopment={() => setTab("development")}
                knowledge={knowledge}
                renewalPending={renewalPending}
                releaseCost={releaseCost}
                marketEligibility={marketEligibility}
              />
              {!pageMode && (
                <button onClick={onClose} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5 hover:text-white" aria-label="Close">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          <nav className="mt-4 flex gap-1 overflow-x-auto px-5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${activeTab === t.key ? "border-sky-300 text-white" : "border-transparent text-slate-500 hover:text-slate-200"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <section className="min-h-0 flex-1 overflow-y-auto p-5">
          {activeTab === "overview" && (
            <OverviewTab
              snapshot={profileSnapshot}
              condition={condition}
              knowledge={knowledge}
              overallLabel={overallLabel}
              contractTeam={contractTeam}
              contractRole={contractRole}
              contractStart={contractStart}
              contractEnd={contractEnd}
              contractSalary={contractSalary}
              futureTransfer={futureTransfer}
            />
          )}

          {activeTab === "attributes" && (
            <AttributesTab
              attrs={meaningfulAttrs}
              condition={condition}
              knowledge={knowledge}
              driver={driver}
              currentSnapshot={profileSnapshot}
              comparisonDriver={comparisonDriver}
              comparisonSnapshot={comparisonSnapshot}
              comparisonCandidates={(driversList||[]).filter((candidate) => {
                const candidateId=candidate?.driver_id ?? candidate?.driverId ?? candidate?.id;
                const status=String(candidate?.status||"").toLowerCase();
                return !sameDriver(candidateId,driverId) && !["hidden","deceased"].includes(status);
              })}
              compareDriverId={compareDriverId}
              setCompareDriverId={setCompareDriverId}
              compareQuery={compareQuery}
              setCompareQuery={setCompareQuery}
              compareMode={compareMode}
              setCompareMode={setCompareMode}
            />
          )}

          {activeTab === "development" && (
            <DevelopmentTab
              attrs={meaningfulAttrs}
              log={developmentLog}
              knowledge={knowledge}
              isOwnDriver={!!isOwnDriver}
              focusKey={developmentFocusKey}
              focusState={developmentFocusState}
              training={developmentTraining}
              potentialLog={potentialLog}
              onSetFocus={setDriverDevelopmentFocus}
            />
          )}

          {activeTab === "career" && (
            <div className="space-y-7">
              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Career Statistics</div>
                <StatisticsTab
                  gameYear={gameYear}
                  seriesSel={seriesSel}
                  setSeriesSel={setSeriesSel}
                  seriesOptions={seriesOptions}
                  rows={filteredCareer}
                  agg={statsAgg}
                />
              </div>
              <div className="border-t border-white/10 pt-5">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Played-Race Performance</div>
                    <div className="mt-1 text-sm text-slate-300">Form evaluates results against the car, qualifying, team-mate comparison and incident responsibility.</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-[#171a23] px-3 py-2 text-right">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Current Form</div>
                    <div className={`text-lg font-semibold ${Number(profileSnapshot?.form?.score)>=76?"text-emerald-300":Number(profileSnapshot?.form?.score)<58?"text-rose-300":"text-slate-200"}`}>
                      {profileSnapshot?.form?.score!=null?`${Number(profileSnapshot.form.score).toFixed(1)} · ${profileSnapshot.form.label}`:"—"}
                    </div>
                  </div>
                </div>
                <PerformanceHistory items={profileSnapshot?.performanceHistory||[]} />
              </div>
              <div className="border-t border-white/10 pt-5">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Season History by Team</div>
                <CareerTab
                  seriesSel={seriesSel}
                  setSeriesSel={setSeriesSel}
                  seriesOptions={seriesOptions}
                  timeline={careerTimeline}
                  totals={careerTotals}
                  showFilter={false}
                />
              </div>
              <div className="border-t border-white/10 pt-5">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Achievements</div>
                <AchievementsTab items={achievementsList} />
              </div>
            </div>
          )}
        </section>
      </main>

      {contractTalkOpen && isOwnDriver && contract && (
        <ContractNegotiationModal
          driver={driver}
          roles={[contractRole]}
          expectedSalary={expectedDriverSalary(gs, driverId)}
          onClose={() => setContractTalkOpen(false)}
          onSubmit={submitContractRenewal}
        />
      )}

      {marketTalkOpen && !isOwnDriver && marketEligibility?.canNegotiate && (
        <ContractNegotiationModal
          driver={driver}
          roles={marketEligibility.roles}
          expectedSalary={expectedDriverSalary(gs, driverId)}
          contextNote={
            marketEligibility?.kind==="transfer"
              ?("This is a transfer from "+(contractTeam||"the current team")+
                ". If the driver accepts, "+fmtMoney(marketEligibility?.buyout?.fee||0)+
                " will be paid as "+(marketEligibility?.buyout?.type==="fixed_clause"?"a release clause.":"buyout compensation."))
              :""
          }
          onClose={() => setMarketTalkOpen(false)}
          onSubmit={submitMarketNegotiation}
        />
      )}
    </div>
  );
}

/* ======================== Small UI ======================== */

function KV({ label, value, className = "" }) {
  const v = displayValue(value);
  return (
    <div className={`flex justify-between gap-3 text-sm ${className}`}>
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

/* ======================== Tabs ======================== */

function ProfileMetric({ label, value, tone = "" }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#171a23] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${tone}`}>{displayValue(value)}</div>
    </div>
  );
}

function ConditionBar({ label, value, inverse = false }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const effective = inverse ? 100-v : v;
  const tone = effective >= 70 ? "bg-emerald-300" : effective >= 45 ? "bg-amber-300" : "bg-rose-400";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <strong>{Math.round(v)}</strong>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${tone}`} style={{width:`${v}%`}}/>
      </div>
    </div>
  );
}

function OverviewTab({
  snapshot,
  condition,
  knowledge,
  overallLabel,
  contractTeam,
  contractRole,
  contractStart,
  contractEnd,
  contractSalary,
  futureTransfer,
}) {
  const season=snapshot?.season||{};
  const impact=snapshot?.conditionImpact||{};
  const availability=snapshot?.availability||{};
  const canSeeCondition=Boolean(knowledge?.canSeeCondition);
  const impactValue=canSeeCondition?Number(impact?.total):NaN;
  const impactTone=Number.isFinite(impactValue)
    ?(impactValue>=0?"text-emerald-300":"text-rose-300")
    :"text-slate-200";

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {!availability.available && (
        <div className="xl:col-span-12 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-300">{String(availability.status||"Unavailable").replaceAll("_"," ")}</div>
          <div className="mt-1 text-sm text-slate-200">
            {availability.reason||"Driver is currently unavailable."}
            {availability.expectedReturnDate?` · Expected return ${availability.expectedReturnDate}`:""}
          </div>
        </div>
      )}

      <div className="xl:col-span-7 rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current State</div>
          <span className="rounded bg-sky-500/10 px-2 py-1 text-[10px] uppercase tracking-wide text-sky-300">{knowledge?.label||"Unscouted"}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <ProfileMetric label="Overall" value={overallLabel}/>
          <ProfileMetric label="Championship" value={season.championshipPosition?`P${season.championshipPosition}`:"—"}/>
          <ProfileMetric label="Points" value={season.points??0}/>
          <ProfileMetric
            label="Form"
            value={snapshot?.form?.score!=null?`${Number(snapshot.form.score).toFixed(1)} · ${snapshot.form.label}`:"—"}
            tone={snapshot?.form?.score!=null?(Number(snapshot.form.score)>=76?"text-emerald-300":Number(snapshot.form.score)<58?"text-rose-300":"text-slate-200"):""}
          />
        </div>

        {canSeeCondition ? (
          <>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <ConditionBar label="Confidence" value={condition?.confidence??50}/>
                <ConditionBar label="Morale" value={condition?.morale??50}/>
              </div>
              <div className="space-y-3">
                <ConditionBar label="Preparation" value={condition?.preparation??50}/>
                <ConditionBar label="Fatigue" value={condition?.fatigue??0} inverse/>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-4 md:grid-cols-4">
              <ProfileMetric label="Conf effect" value={Number.isFinite(Number(impact?.confidenceEffect))?`${Number(impact.confidenceEffect)>=0?"+":""}${Number(impact.confidenceEffect).toFixed(1)}`:"—"}/>
              <ProfileMetric label="Morale effect" value={Number.isFinite(Number(impact?.moraleEffect))?`${Number(impact.moraleEffect)>=0?"+":""}${Number(impact.moraleEffect).toFixed(1)}`:"—"}/>
              <ProfileMetric label="Prep effect" value={Number.isFinite(Number(impact?.preparationEffect))?`${Number(impact.preparationEffect)>=0?"+":""}${Number(impact.preparationEffect).toFixed(1)}`:"—"}/>
              <ProfileMetric label="Fatigue effect" value={Number.isFinite(Number(impact?.fatigueEffect))?Number(impact.fatigueEffect).toFixed(1):"—"}/>
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-lg border border-white/10 bg-[#171a23] p-4 text-sm text-slate-400">
            Day-to-day condition is private team data. Public/scouting knowledge does not reveal current confidence, morale, preparation or fatigue.
          </div>
        )}
      </div>

      <div className="xl:col-span-5 rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Season Snapshot</div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
          <ProfileMetric label="Starts" value={season.starts??0}/>
          <ProfileMetric label="Wins" value={season.wins??0}/>
          <ProfileMetric label="Podiums" value={season.podiums??0}/>
          <ProfileMetric label="Poles" value={season.poles??0}/>
          <ProfileMetric label="DNF" value={season.dnfs??0} tone={season.dnfs?"text-rose-300":""}/>
          <ProfileMetric label="Best finish" value={season.bestFinish?`P${season.bestFinish}`:"—"}/>
        </div>
      </div>

      {snapshot?.performanceHistory?.[0]&&(
        <div className="xl:col-span-12 rounded-xl border border-white/10 bg-[#12141c] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest Race Evaluation</div>
              <div className="mt-1 text-sm text-slate-200">{snapshot.performanceHistory[0].gp_name||`Round ${snapshot.performanceHistory[0].round||"—"}`}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                Expected ~P{Number(snapshot.performanceHistory[0].expected_finish||0).toFixed(1)} · {snapshot.performanceHistory[0].retired?(snapshot.performanceHistory[0].retirement_reason||"DNF"):`Finished P${snapshot.performanceHistory[0].finish_position||"—"}`}
              </div>
            </div>
            <div className={`rounded-lg border px-3 py-2 text-xl font-semibold ${Number(snapshot.performanceHistory[0].score)>=76?"border-emerald-400/20 bg-emerald-500/10 text-emerald-300":Number(snapshot.performanceHistory[0].score)<58?"border-rose-400/20 bg-rose-500/10 text-rose-300":"border-white/10 bg-white/5 text-slate-200"}`}>
              {Number(snapshot.performanceHistory[0].score||0).toFixed(1)}
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {(snapshot.performanceHistory[0].factors||[]).slice(0,4).map((factor,index)=>(
              <div key={`${factor.key||"factor"}-${index}`} className={`rounded-lg border border-white/5 bg-[#171a23] p-2 text-xs ${factor.tone==="positive"?"text-emerald-300":factor.tone==="negative"?"text-rose-300":"text-slate-400"}`}>
                {factor.value>0?"+":""}{Number(factor.value||0).toFixed(1)} · {factor.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="xl:col-span-12 rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Knowledge & Decision Support</div>
        <p className="mt-2 text-sm text-slate-300">{knowledge?.label||"Unscouted"}</p>
        <p className="mt-1 text-xs text-slate-400">
          Exact driver ratings are only available through your own team, Academy support or a completed specific scouting report. Regional scouting and public F1 knowledge use ranges instead of database-perfect numbers.
        </p>
        <div className="mt-3 rounded-lg border border-white/10 bg-[#171a23] p-3 text-xs text-slate-400">
          Overall ability stays separate from current performance. Hidden day-to-day condition never changes the permanent Overall shown by the rating model.
        </div>
      </div>
    </div>
  );
}

function DevelopmentTab({
  attrs,
  log,
  knowledge,
  isOwnDriver,
  focusKey,
  focusState,
  training,
  potentialLog,
  onSetFocus,
}) {
  const overall=presentDriverKnowledgeValue(knowledge,"current_ability",attrs?.current_ability,{kind:"ability"});
  const potential=presentDriverKnowledgeValue(knowledge,"potential_ability",attrs?.potential_ability,{kind:"potential"});
  const canSeeHistory=Boolean(knowledge?.canSeeDevelopmentHistory);
  const groups=driverAttributeGroups();
  const latestPotential=(potentialLog||[])[0]||null;
  const trainingDays=Number(training?.trainingDays||0);
  const fatigueSpent=Number(training?.fatigueSpent||0);
  const focusLocked=Boolean(focusState?.locked);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-4 rounded-xl border border-white/10 bg-[#12141c] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Development State</div>
            <span className="text-[10px] uppercase tracking-wide text-sky-300">{knowledge?.label||"Unscouted"}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <ProfileMetric label="Current ability" value={overall.label}/>
            <ProfileMetric label="Dynamic potential" value={potential.label}/>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Potential is a live career ceiling, not a guaranteed destination. Results relative to the car, team environment and sustained development can raise or lower it over time.
          </p>

          {isOwnDriver && (
            <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-[#171a23] p-3 text-xs text-slate-400">
              <div className="flex justify-between gap-3">
                <span>Active focus</span>
                <strong className="text-slate-200">{groups.find((group)=>group.key===focusKey)?.label||"None selected"}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>Training days this month</span>
                <strong className="text-slate-200">{trainingDays}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>Development fatigue</span>
                <strong className="text-amber-200">+{fatigueSpent.toFixed(1)}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>Focus status</span>
                <strong className={focusLocked?"text-sky-300":"text-slate-200"}>{focusLocked?"Locked for this month":"Can select this month"}</strong>
              </div>
            </div>
          )}

          {canSeeHistory&&latestPotential&&(
            <div className="mt-3 rounded-lg border border-white/10 bg-[#171a23] p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-400">Latest potential movement</span>
                <strong className={Number(latestPotential.delta)>0?"text-emerald-300":Number(latestPotential.delta)<0?"text-rose-300":"text-slate-300"}>
                  {Number(latestPotential.delta)>0?"+":""}{Number(latestPotential.delta||0).toFixed(2)}
                </strong>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Form {latestPotential.form_score??"—"} · {latestPotential.environment_label||"Environment"} · {latestPotential.training_days||0} training days
              </div>
            </div>
          )}
        </div>

        <div className="xl:col-span-8 rounded-xl border border-white/10 bg-[#12141c] p-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly Development Focus</div>
            <div className="mt-1 text-sm text-slate-300">
              {isOwnDriver
                ?"Choose one group for the month. Training load accumulates fatigue during weekdays; the month's work is converted into development at the next monthly progression."
                :"Development focus is only managed for drivers under your team control."}
            </div>
          </div>

          {isOwnDriver&&focusLocked&&(
            <div className="mt-3 rounded-lg border border-sky-400/20 bg-sky-500/10 p-3 text-xs text-sky-200">
              This month's focus is locked. You can choose a different group when the calendar moves into the next month.
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {groups.map((group)=>{
              const rawScore=driverAttributeGroupScore(attrs,group.key);
              const shown=presentDriverKnowledgeValue(knowledge,`group_${group.key}`,rawScore,{kind:"attribute"});
              const behaviour=shown.sortValue!=null
                ?driverAttributeGroupBehaviourForScore(group.key,shown.sortValue)
                :null;
              const active=focusKey===group.key;
              const unavailable=Boolean(isOwnDriver&&focusLocked&&!active);
              return (
                <div key={group.key} className={`rounded-xl border p-3 ${active?"border-sky-400/40 bg-sky-500/10":"border-white/10 bg-[#171a23]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{group.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{group.attributes.map((attribute)=>attribute.label).join(" · ")}</div>
                    </div>
                    <div className={`text-lg font-semibold ${presentationColorClass(shown)}`}>{shown.label}</div>
                  </div>
                  <p className="mt-2 min-h-[34px] text-xs text-slate-400">
                    {behaviour?.text||"Scout the driver to assess this development area."}
                  </p>
                  {isOwnDriver&&(
                    <button
                      onClick={()=>onSetFocus?.(group.key)}
                      disabled={active||unavailable}
                      className={`mt-3 w-full rounded-lg px-3 py-2 text-xs font-medium ${active?"bg-sky-500/15 text-sky-300":"border border-white/10 text-slate-200 hover:bg-white/5"} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {active?"Current monthly focus":unavailable?"Available next month":"Select for this month"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent Development</div>
            <div className="mt-1 text-sm text-slate-300">Permanent attribute changes recorded in this save.</div>
          </div>
          {canSeeHistory && <span className="text-xs text-slate-500">{Math.min(log?.length||0,12)} shown</span>}
        </div>

        {!canSeeHistory ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-[#171a23] p-4 text-sm text-slate-400">
            Development history is internal team/Academy data. Scouting reports can reveal current ability and potential, but not the hidden month-by-month progression log.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3 text-left">Date</th>
                  <th className="py-2 pr-3 text-left">Attribute</th>
                  <th className="py-2 pr-3 text-right">Before</th>
                  <th className="py-2 pr-3 text-right">After</th>
                  <th className="py-2 pr-3 text-right">Δ</th>
                  <th className="py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {(log||[]).slice(0,12).map((row,index)=>{
                  const delta=Number(row?.delta??(Number(row?.after)-Number(row?.before)));
                  return (
                    <tr key={`${row?.dateISO||"date"}-${row?.attr||"attr"}-${index}`}>
                      <td className="py-2 pr-3 text-slate-400">{row?.dateISO||"—"}</td>
                      <td className="py-2 pr-3 font-medium">{niceRole(String(row?.attr||"—").replaceAll("_"," "))}</td>
                      <td className="py-2 pr-3 text-right">{isNumeric(row?.before)?Number(row.before).toFixed(2):"—"}</td>
                      <td className="py-2 pr-3 text-right">{isNumeric(row?.after)?Number(row.after).toFixed(2):"—"}</td>
                      <td className={`py-2 pr-3 text-right font-medium ${delta>0?"text-emerald-300":delta<0?"text-rose-300":"text-slate-400"}`}>
                        {Number.isFinite(delta)?`${delta>0?"+":""}${delta.toFixed(2)}`:"—"}
                      </td>
                      <td className="py-2 text-slate-400">{displayValue(row?.source,"—")}</td>
                    </tr>
                  );
                })}
                {!(log||[]).length && (
                  <tr><td colSpan={6} className="py-6 text-center text-sm text-slate-500">No permanent development changes have been recorded in this save yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
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
                  <tr key={r.year} className={r.year===gameYear ? "bg-sky-500/10" : (isChampion ? "bg-amber-500/10" : "")}>
                    <td className="pr-3 py-1">{r.year}{r.year===gameYear ? " (current)" : ""}</td>
                    <td className="text-right pr-3 py-1">{r.starts}</td>
                    <td className={`text-right pr-3 py-1 ${Number(r.wins) > 0 ? "text-rose-300 font-semibold" : ""}`}>{r.wins}</td>
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

function CareerTab({ seriesSel, setSeriesSel, seriesOptions, timeline, totals, showFilter = true }) {
  if (!timeline?.length) {
    return (
      <div className="space-y-4">
        {showFilter && <SeriesFilter seriesSel={seriesSel} setSeriesSel={setSeriesSel} seriesOptions={seriesOptions} />}
        <p className="text-gray-500 text-sm">No career data.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {showFilter && <SeriesFilter seriesSel={seriesSel} setSeriesSel={setSeriesSel} seriesOptions={seriesOptions} />}

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
                <tr key={`${unbox(r.year)}-${i}`} className={isChampion ? "bg-amber-500/10" : ""}>
                  <td className="pr-3 py-1">{displayValue(r.year)}</td>
                  <td className="pr-3 py-1">{series}</td>
                  <td className="pr-3 py-1">
                    {r.team_id ? (
                      <span data-entity="team" data-id={unbox(r.team_id)} className="entity-link-team">
                        {displayValue(r.team_name ?? r.team_id)}
                      </span>
                    ) : (
                      displayValue(r.team_name)
                    )}
                  </td>
                  <td className="text-right pr-3 py-1">{displayValue(unbox(r.starts) ?? unbox(r.races), 0)}</td>
                  <td className={`text-right pr-3 py-1 ${Number(unbox(r.wins)) > 0 ? "text-rose-300 font-semibold" : ""}`}>{displayValue(r.wins, 0)}</td>
                  <td className="text-right pr-3 py-1">{displayValue(r.podiums, 0)}</td>
                  <td className="text-right pr-3 py-1">{displayValue(r.poles, 0)}</td>
                  <td className="text-right pr-3 py-1">{displayValue(r.fastest_laps, 0)}</td>
                  <td className="text-right pr-3 py-1">{displayValue(r.points, 0)}</td>
                  <td className="text-right pr-0 py-1">
                    {isNumeric(r.champ_pos)
                      ? `P${unbox(r.champ_pos)}`
                      : (isTransfer ? <span className="italic text-purple-300">Transfer</span> : displayValue(r.champ_pos))}
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

function AttributesTab({
  attrs,
  condition,
  knowledge,
  driver,
  currentSnapshot,
  comparisonDriver,
  comparisonSnapshot,
  comparisonCandidates,
  compareDriverId,
  setCompareDriverId,
  compareQuery,
  setCompareQuery,
  compareMode,
  setCompareMode,
}) {
  if (!attrs) return <p className="text-slate-500 text-sm">No attributes.</p>;

  const groups=driverAttributeGroups();
  const derived=driverDerivedRatings(attrs);
  const comparisonAttrs=comparisonSnapshot?.rating||null;
  const comparisonKnowledge=comparisonSnapshot?.knowledge||null;
  const comparisonDerived=driverDerivedRatings(comparisonAttrs);
  const nameOf=(d)=>displayValue(d?.display_name??d?.name,"Unknown Driver");
  const currentName=nameOf(driver);
  const comparisonName=comparisonDriver?nameOf(comparisonDriver):"";
  const currentContract=currentSnapshot?.contract||null;
  const comparisonContract=comparisonSnapshot?.contract||null;

  const shownValue=(knowledgeState,field,value,{kind="attribute"}={})=>
    presentDriverKnowledgeValue(knowledgeState,field,value,{kind});

  const renderShown=(shown,{inverse=false,size=""}={})=>(
    <span
      className={`font-semibold ${size} ${presentationColorClass(shown,{inverse})}`}
      title={
        shown?.visibility==="range"?"Scouting/public estimate range":
        shown?.visibility==="hidden"?"Requires scouting":
        shown?.visibility==="exact"?"Exact known value":"No data"
      }
    >
      {shown?.label??"—"}
    </span>
  );

  const renderValue=(knowledgeState,field,value,{kind="attribute",inverse=false,size=""}={})=>
    renderShown(shownValue(knowledgeState,field,value,{kind}),{inverse,size});

  const differenceFor=(field,left,right,{kind="attribute",inverse=false}={})=>{
    const leftShown=shownValue(knowledge,field,left,{kind});
    const rightShown=shownValue(comparisonKnowledge,field,right,{kind});
    if(leftShown?.sortValue==null||rightShown?.sortValue==null){
      return <span className="text-slate-600">—</span>;
    }
    const raw=(Number(leftShown.sortValue)-Number(rightShown.sortValue))*(inverse?-1:1);
    const delta=Math.abs(raw)<0.05?0:raw;
    const approximate=leftShown.visibility==="range"||rightShown.visibility==="range";
    const tone=delta>0.05?"text-emerald-300":delta<-0.05?"text-rose-300":"text-slate-500";
    return (
      <span className={`font-medium ${tone}`} title="Difference from the visible/known comparison values">
        {approximate?"≈":""}{delta>0?"+":""}{delta.toFixed(1)}
      </span>
    );
  };

  const comparisonSuggestions=(comparisonCandidates||[])
    .filter((candidate)=>{
      const query=String(compareQuery||"").trim().toLowerCase();
      if(!query)return false;
      return nameOf(candidate).toLowerCase().includes(query);
    })
    .sort((a,b)=>nameOf(a).localeCompare(nameOf(b)))
    .slice(0,8);

  const selectComparison=(candidate)=>{
    const id=String(candidate?.driver_id??candidate?.driverId??candidate?.id??"");
    setCompareDriverId(id);
    setCompareQuery(nameOf(candidate));
  };

  const currentOvertaking=shownValue(knowledge,"derived_overtaking",derived?.overtaking?.value,{kind:"attribute"});
  const currentDefending=shownValue(knowledge,"derived_defending",derived?.defending?.value,{kind:"attribute"});
  const wheelBehaviour=currentOvertaking.sortValue!=null&&currentDefending.sortValue!=null
    ?driverWheelToWheelBehaviour(currentOvertaking.sortValue,currentDefending.sortValue)
    :null;

  const derivedText=(key,shown)=>{
    if(shown?.sortValue==null)return "Scout the driver to assess this area.";
    const score=Number(shown.sortValue);
    if(key==="overtaking"){
      if(score>=85)return "Creates and completes overtakes at an elite level, especially when opportunities are limited.";
      if(score>=75)return "A strong overtaker who usually converts pace and positioning into passes.";
      if(score>=65)return "Capable of making progress in traffic, but not consistently dominant in attack.";
      if(score>=55)return "Can complete straightforward passes but may lose time behind similarly paced cars.";
      return "Overtaking is a weakness and traffic can seriously limit race progress.";
    }
    if(key==="defending"){
      if(score>=85)return "Exceptionally difficult to pass and very effective at protecting track position.";
      if(score>=75)return "Strong defender who usually makes rivals work hard to complete a pass.";
      if(score>=65)return "Generally competent in defence, with some vulnerability against stronger attackers.";
      if(score>=55)return "Can defend basic situations but sustained pressure often exposes weaknesses.";
      return "Vulnerable when defending and likely to surrender positions under pressure.";
    }
    if(key==="strategy_intelligence"){
      return score>=75
        ?"Reads races well and adapts decisions effectively as strategy and conditions evolve."
        :score>=60
          ?"Makes reasonable strategic decisions but can miss opportunities in complex races."
          :"Race-reading is a weakness and changing strategic situations can catch the driver out.";
    }
    if(key==="setup_feedback"){
      return score>=75
        ?"Gives engineers clear, actionable setup feedback and accelerates weekend understanding."
        :score>=60
          ?"Provides useful setup feedback, though engineers may still need more time to find the optimum."
          :"Limited feedback can slow setup convergence during practice.";
    }
    if(key==="development_impact"){
      return score>=75
        ?"A major asset to long-term car development through feedback, leadership and testing input."
        :score>=60
          ?"Makes a useful contribution to development without being a primary technical reference."
          :"Offers limited value to long-term technical development.";
    }
    return "";
  };

  const salaryDifference=()=>{
    if(!comparisonDriver)return null;
    const left=Number(currentContract?.salary??currentContract?.salary_yearly);
    const right=Number(comparisonContract?.salary??comparisonContract?.salary_yearly);
    if(!Number.isFinite(left)||!Number.isFinite(right))return null;
    const diff=left-right;
    return `${diff>0?"+":""}${fmtMoney(diff)}`;
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Driver Knowledge</div>
            <div className="mt-1 text-sm text-slate-300">{knowledge?.label||"Unscouted"}</div>
            <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-[#171a23] p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Overall</div>
                <div className="mt-1">{renderValue(knowledge,"current_ability",attrs.current_ability,{kind:"ability",size:"text-xl"})}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#171a23] p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Potential</div>
                <div className="mt-1">{renderValue(knowledge,"potential_ability",attrs.potential_ability,{kind:"potential",size:"text-xl"})}</div>
              </div>
            </div>
          </div>

          <div className="relative w-full lg:w-[340px]">
            <div className="text-xs text-slate-400">Compare with</div>
            <div className="relative mt-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-slate-500"/>
              <input
                value={compareQuery}
                onChange={(e)=>{
                  const value=e.target.value;
                  setCompareQuery(value);
                  if(compareDriverId&&value!==comparisonName)setCompareDriverId("");
                }}
                onKeyDown={(e)=>{
                  if(e.key==="Enter"&&comparisonSuggestions[0]){
                    e.preventDefault();
                    selectComparison(comparisonSuggestions[0]);
                  }
                }}
                placeholder="Type a driver name…"
                className="w-full rounded-lg border border-white/10 bg-[#191c26] py-2 pl-9 pr-9 text-sm text-slate-100 outline-none focus:border-sky-400/50"
              />
              {(compareQuery||compareDriverId)&&(
                <button
                  type="button"
                  onClick={()=>{setCompareQuery("");setCompareDriverId("");}}
                  className="absolute right-2 top-1.5 rounded p-1 text-slate-500 hover:text-white"
                  aria-label="Clear comparison"
                >
                  <X size={14}/>
                </button>
              )}
            </div>

            {!!compareQuery&&!compareDriverId&&comparisonSuggestions.length>0&&(
              <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-white/10 bg-[#171a23] shadow-xl">
                {comparisonSuggestions.map((candidate)=>{
                  const id=String(candidate?.driver_id??candidate?.driverId??candidate?.id??"");
                  return (
                    <button
                      key={id}
                      type="button"
                      onMouseDown={(e)=>e.preventDefault()}
                      onClick={()=>selectComparison(candidate)}
                      className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-white/5"
                    >
                      <DriverPortrait driver={candidate} size="h-8 w-8"/>
                      <span className="truncate">{nameOf(candidate)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {!!compareQuery&&!compareDriverId&&!comparisonSuggestions.length&&(
              <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-white/10 bg-[#171a23] p-3 text-xs text-slate-500">
                No matching driver.
              </div>
            )}
          </div>
        </div>
      </div>

      {knowledge?.canSeeCondition && (
        <div className="rounded-xl border border-white/10 bg-[#12141c] p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Current Condition</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Confidence","confidence",condition?.confidence??50,false],
              ["Morale","morale",condition?.morale??50,false],
              ["Preparation","preparation",condition?.preparation??50,false],
              ["Fatigue","fatigue",condition?.fatigue??0,true],
            ].map(([label,field,value,inverse])=>(
              <div key={field} className="rounded-lg border border-white/10 bg-[#171a23] p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1">{renderValue(knowledge,field,value,{kind:"condition",inverse,size:"text-lg"})}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {comparisonDriver && (
        <div className="rounded-xl border border-sky-400/20 bg-sky-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">Compare Drivers</div>
              <div className="mt-1 text-sm text-slate-300">{currentName} vs {comparisonName}</div>
            </div>
            <div className="flex rounded-lg border border-white/10 bg-[#11141c] p-1">
              {[
                ["performance","Performance"],
                ["contract","Contract"],
              ].map(([key,label])=>(
                <button
                  key={key}
                  onClick={()=>setCompareMode(key)}
                  className={`rounded-md px-3 py-1.5 text-xs ${compareMode===key?"bg-white/10 text-white":"text-slate-500 hover:text-slate-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {compareMode==="performance" ? (
            <div className="mt-4 grid grid-cols-[minmax(110px,1fr)_90px_90px_72px] gap-x-3 text-sm">
              <div className="pb-2 text-xs uppercase tracking-wide text-slate-500">Metric</div>
              <div className="pb-2 text-right text-xs uppercase tracking-wide text-slate-500">{currentName}</div>
              <div className="pb-2 text-right text-xs uppercase tracking-wide text-slate-500">{comparisonName}</div>
              <div className="pb-2 text-right text-xs uppercase tracking-wide text-slate-500">Δ</div>

              {[
                ["Overall","current_ability",attrs.current_ability,comparisonAttrs?.current_ability,"ability",false],
                ["Potential","potential_ability",attrs.potential_ability,comparisonAttrs?.potential_ability,"potential",false],
                ["Pace","pace",attrs.pace,comparisonAttrs?.pace,"attribute",false],
                ["Qualifying","qualifying",attrs.qualifying,comparisonAttrs?.qualifying,"attribute",false],
                ["Racecraft","racecraft",attrs.racecraft,comparisonAttrs?.racecraft,"attribute",false],
                ["Consistency","consistency",attrs.consistency,comparisonAttrs?.consistency,"attribute",false],
                ["Wet Skill","wet_skill",attrs.wet_skill,comparisonAttrs?.wet_skill,"attribute",false],
                ["Tyre Management","tire_management",attrs.tire_management,comparisonAttrs?.tire_management,"attribute",false],
                ["Overtaking","derived_overtaking",derived.overtaking?.value,comparisonDerived.overtaking?.value,"attribute",false],
                ["Defending","derived_defending",derived.defending?.value,comparisonDerived.defending?.value,"attribute",false],
                ["Strategy","derived_strategy",derived.strategy_intelligence?.value,comparisonDerived.strategy_intelligence?.value,"attribute",false],
              ].map(([label,field,left,right,kind,inverse])=>(
                <div key={field} className="contents">
                  <div className="border-t border-white/10 py-2 text-slate-400">{label}</div>
                  <div className="border-t border-white/10 py-2 text-right">{renderValue(knowledge,field,left,{kind,inverse})}</div>
                  <div className="border-t border-white/10 py-2 text-right">{renderValue(comparisonKnowledge,field,right,{kind,inverse})}</div>
                  <div className="border-t border-white/10 py-2 text-right">{differenceFor(field,left,right,{kind,inverse})}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-[#171a23] p-3">
                  <div className="text-sm font-semibold">{currentName}</div>
                  <div className="mt-2 space-y-2 text-xs">
                    <KV label="Team" value={displayValue(currentSnapshot?.teamName,"Free Agent")}/>
                    <KV label="Role" value={niceRole(currentContract?.role)}/>
                    <KV label="Contract end" value={displayValue(currentContract?.contract_until_year??currentContract?.contract_until??currentContract?.end_year??currentContract?.end_date,"—")}/>
                    <KV label="Salary" value={currentContract?fmtMoney(currentContract?.salary??currentContract?.salary_yearly):"—"}/>
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#171a23] p-3">
                  <div className="text-sm font-semibold">{comparisonName}</div>
                  <div className="mt-2 space-y-2 text-xs">
                    <KV label="Team" value={displayValue(comparisonSnapshot?.teamName,"Free Agent")}/>
                    <KV label="Role" value={niceRole(comparisonContract?.role)}/>
                    <KV label="Contract end" value={displayValue(comparisonContract?.contract_until_year??comparisonContract?.contract_until??comparisonContract?.end_year??comparisonContract?.end_date,"—")}/>
                    <KV label="Salary" value={comparisonContract?fmtMoney(comparisonContract?.salary??comparisonContract?.salary_yearly):"—"}/>
                  </div>
                </div>
              </div>
              {salaryDifference()&&(
                <div className="mt-3 text-right text-xs text-slate-400">
                  Salary difference ({currentName} − {comparisonName}): <strong className="text-slate-200">{salaryDifference()}</strong>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {groups.map((group)=>{
          const rawGroupScore=driverAttributeGroupScore(attrs,group.key);
          const shownGroup=shownValue(knowledge,`group_${group.key}`,rawGroupScore,{kind:"attribute"});
          const comparisonGroupScore=driverAttributeGroupScore(comparisonAttrs,group.key);
          const shownComparisonGroup=shownValue(comparisonKnowledge,`group_${group.key}`,comparisonGroupScore,{kind:"attribute"});
          const behaviour=shownGroup.sortValue!=null
            ?driverAttributeGroupBehaviourForScore(group.key,shownGroup.sortValue)
            :null;
          return (
            <div key={group.key} className="rounded-xl border border-white/10 bg-[#12141c] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{group.label}</div>
                  <div className="mt-1 text-xs text-slate-500">{group.description}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[9px] uppercase tracking-wide text-slate-600">Average</div>
                  <div>{renderShown(shownGroup,{size:"text-lg"})}</div>
                  {comparisonDriver&&(
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      vs {renderShown(shownComparisonGroup)} · {differenceFor(`group_${group.key}`,rawGroupScore,comparisonGroupScore,{kind:"attribute"})}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-white/5 bg-[#171a23] p-3 text-xs text-slate-400">
                {behaviour?.text||"Scout the driver to understand how this group affects race behaviour."}
              </div>

              <div className="mt-3 space-y-2">
                {comparisonDriver&&(
                  <div className="grid grid-cols-[1fr_72px_72px_58px] gap-2 text-[9px] uppercase tracking-wide text-slate-600">
                    <span>Attribute</span><span className="text-right">Driver</span><span className="text-right">Compare</span><span className="text-right">Δ</span>
                  </div>
                )}
                {group.attributes.map((attribute)=>{
                  const field=attribute.field;
                  const left=driverAttributeValue(attrs,attribute);
                  const right=driverAttributeValue(comparisonAttrs,attribute);
                  return (
                    <div key={field} className={`grid items-center gap-2 text-sm ${comparisonDriver?"grid-cols-[1fr_72px_72px_58px]":"grid-cols-[1fr_82px]"}`}>
                      <span className="text-slate-400">{attribute.label}</span>
                      <div className="text-right">{renderValue(knowledge,field,left,{kind:"attribute",inverse:attribute.inverse})}</div>
                      {comparisonDriver&&(
                        <>
                          <div className="text-right">{renderValue(comparisonKnowledge,field,right,{kind:"attribute",inverse:attribute.inverse})}</div>
                          <div className="text-right">{differenceFor(field,left,right,{kind:"attribute",inverse:attribute.inverse})}</div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Race Behaviour & Derived Ratings</div>
        <p className="text-xs text-slate-500">These ratings combine existing attributes; they are not separate database attributes.</p>

        <div className="mt-4 rounded-lg border border-white/10 bg-[#171a23] p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Wheel-to-wheel profile</div>
          <div className="mt-1 text-sm text-slate-300">
            {wheelBehaviour?.text||"Scout the driver to assess attacking and defensive behaviour."}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            ["overtaking","Overtaking"],
            ["defending","Defending"],
            ["strategy_intelligence","Strategy Intelligence"],
            ["setup_feedback","Setup Feedback"],
            ["development_impact","Development Impact"],
          ].map(([key,label])=>{
            const field=`derived_${key}`;
            const left=derived?.[key]?.value;
            const right=comparisonDerived?.[key]?.value;
            const shown=shownValue(knowledge,field,left,{kind:"attribute"});
            return (
              <div key={key} className="rounded-lg border border-white/10 bg-[#171a23] p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <div>{renderShown(shown,{size:"text-lg"})}</div>
                  {comparisonDriver&&(
                    <div className="text-right text-xs">
                      <div>{renderValue(comparisonKnowledge,field,right,{kind:"attribute"})}</div>
                      <div className="mt-0.5">{differenceFor(field,left,right,{kind:"attribute"})}</div>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">{derivedText(key,shown)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function PerformanceHistory({ items }) {
  const rows=(items||[]).slice(0,8);
  if(!rows.length){
    return <p className="text-slate-500 text-sm">No played-race performance evaluations yet.</p>;
  }
  return (
    <div className="space-y-3">
      {rows.map((row,index)=>(
        <div key={`${row?.year||"year"}-${row?.round||index}`} className="rounded-lg border border-white/10 bg-[#171a23] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{row?.gp_name||`Round ${row?.round||"—"}`}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {row?.year||"—"} · expected ~P{Number(row?.expected_finish||0).toFixed(1)} · {row?.retired?(row?.retirement_reason||"DNF"):`finished P${row?.finish_position||"—"}`}
              </div>
            </div>
            <div className={`rounded-lg border px-3 py-1.5 text-lg font-semibold ${Number(row?.score)>=76?"border-emerald-400/20 bg-emerald-500/10 text-emerald-300":Number(row?.score)<58?"border-rose-400/20 bg-rose-500/10 text-rose-300":"border-white/10 bg-white/5 text-slate-200"}`}>
              {Number(row?.score||0).toFixed(1)}
            </div>
          </div>
          {!!row?.factors?.length&&(
            <div className="mt-3 space-y-1">
              {row.factors.slice(0,4).map((factor,i)=>(
                <div key={`${factor.key||"factor"}-${i}`} className={`text-xs ${factor.tone==="positive"?"text-emerald-300":factor.tone==="negative"?"text-rose-300":"text-slate-400"}`}>
                  {factor.value>0?"+":""}{Number(factor.value||0).toFixed(1)} · {factor.message}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AchievementsTab({ items }) {
  if (!items?.length) return <p className="text-gray-500 text-sm">No championship top-three achievements yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-gray-500 text-xs">
          <tr>
            <th className="text-left pr-3 py-1">Year</th>
            <th className="text-left pr-3 py-1">Achievement</th>
            <th className="text-left pr-0 py-1">Team</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {items.map((a, i) => (
            <tr key={`${a.year||"year"}-${i}`} className={Number(a.position)===1?"bg-amber-500/10":""}>
              <td className="pr-3 py-2">{displayValue(a.year)}</td>
              <td className={`pr-3 py-2 font-medium ${Number(a.position)===1?"text-amber-200":"text-slate-200"}`}>
                {displayValue(a.achievement)}
              </td>
              <td className="pr-0 py-2">
                {a.team_id ? (
                  <span data-entity="team" data-id={unbox(a.team_id)} className="entity-link-team">
                    {displayValue(a.team_name ?? a.team_id)}
                  </span>
                ) : (
                  displayValue(a.team_name)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        className="border border-white/10 bg-[#191c26] text-slate-100 rounded-md px-2 py-1 text-sm"
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
        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium hover:bg-gray-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
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
          className="absolute right-0 z-30 mt-2 w-72 origin-top-right rounded-xl border bg-white text-gray-900 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <div className="max-h-[60vh] overflow-y-auto p-1">{children}</div>
        </div>
      )}
    </div>
  );
}

function DriverActionsMenu({
  driver,
  condition,
  isOwnDriver,
  label = "Actions",
  queueEvent,
  currentDateISO,
  onContractTalk,
  onRelease,
  onOpenNegotiation,
  onScout,
  onDevelopment,
  knowledge = null,
  renewalPending = false,
  releaseCost = 0,
  marketEligibility = null,
}) {
  const fx = {
    addAttr: (attr, delta) => ({ key: "driver_attr", driverId: unbox(driver?.driver_id), attr, delta }),
    fatigue: (delta) => ({ key: "fatigue", delta }),
  };

  const ownGroups = [
    {
      title: "Development",
      items: [
        {
          key: "open_development",
          icon: <Dumbbell size={14} />,
          label: "Development focus",
          desc: "Choose a group for potential-bound monthly development",
        },
      ],
    },
    {
      title: "Media & PR",
      items: [
        { key: "sponsor_event", icon: <Megaphone size={14} />, label: "Sponsor activation", desc: "Reputation↑ | +Fatigue", effects: [fx.addAttr("reputation", +1), fx.fatigue(+1)] },
      ],
    },
    {
      title: "Wellbeing & Admin",
      items: [
        { key: "rest_day", icon: <Coffee size={14} />, label: "Rest day", desc: "-Fatigue", effects: [fx.fatigue(-3)] },
        {
          key: "contract_talk",
          icon: <FileText size={14} />,
          label: renewalPending ? "Renewal pending" : "Contract talk",
          desc: renewalPending ? "Awaiting the driver's response" : "Negotiate a contract extension",
          disabled: renewalPending,
        },
        {
          key: "release_driver",
          icon: <Handshake size={14} />,
          label: "Release driver",
          desc: "Terminate contract · " + fmtMoney(releaseCost),
        },
      ],
    },
  ];
  const marketReason = String(marketEligibility?.reason || "");
  const marketAction = marketEligibility?.canNegotiate
    ? {
        key: "open_negotiation",
        icon: <Handshake size={14} />,
        label: marketEligibility?.kind==="transfer" ? "Approach for transfer" : "Open negotiations",
        desc: marketEligibility?.kind==="transfer"
          ?("Buyout "+fmtMoney(marketEligibility?.buyout?.fee||0)+" · "+(marketEligibility.roles || []).join(" / "))
          :("Formal offer · "+(marketEligibility.roles || []).join(" / ")),
      }
    : marketReason === "active_negotiation"
      ? {
          key: "open_negotiation",
          icon: <Handshake size={14} />,
          label: "Negotiation pending",
          desc: "Awaiting the driver's response",
          disabled: true,
        }
      : marketReason === "insufficient_buyout_funds"
        ? {
            key: "open_negotiation",
            icon: <Handshake size={14} />,
            label: "Buyout unaffordable",
            desc: "Required compensation: "+fmtMoney(marketEligibility?.buyout?.fee||0),
            disabled: true,
          }
        : marketReason === "under_contract"
          ? {
              key: "open_negotiation",
              icon: <Handshake size={14} />,
              label: "Under contract",
              desc: "This contract cannot currently be bought out under the active contract rules",
              disabled: true,
            }
          : marketReason === "lineup_full"
            ? {
                key: "open_negotiation",
                icon: <Handshake size={14} />,
                label: "Line-up full",
                desc: "No Main, Second, Reserve or Test Driver role is currently vacant",
                disabled: true,
              }
            : marketReason === "not_f1_eligible"
              ? {
                  key: "open_negotiation",
                  icon: <Handshake size={14} />,
                  label: "Not eligible for F1 contract",
                  desc: "This driver cannot currently be approached for an F1 role",
                  disabled: true,
                }
              : {
                  key: "open_negotiation",
                  icon: <Handshake size={14} />,
                  label: "Negotiations unavailable",
                  desc: "No valid contract action is available",
                  disabled: true,
                };

  const scoutAction = {
    key:"scout_driver",
    icon:<Search size={14}/>,
    label:knowledge?.level==="scouted" ? "Refresh scout report" : "Scout driver",
    desc:knowledge?.level==="scouted"
      ?"Commission a fresh individual report"
      :"Open a specific-driver scouting assignment",
  };

  const otherGroups = [
    {
      title: "Recruitment",
      items: [scoutAction, marketAction],
    },
  ];

  const groups = isOwnDriver ? ownGroups : otherGroups;

  function onPick(it) {
    if (it?.disabled) return;
    if (it?.key === "contract_talk") {
      if (typeof onContractTalk === "function") onContractTalk();
      return;
    }
    if (it?.key === "release_driver") {
      if (typeof onRelease === "function") onRelease();
      return;
    }
    if (it?.key === "open_negotiation") {
      if (typeof onOpenNegotiation === "function") onOpenNegotiation();
      return;
    }
    if (it?.key === "scout_driver") {
      if (typeof onScout === "function") onScout();
      return;
    }
    if (it?.key === "open_development") {
      if (typeof onDevelopment === "function") onDevelopment();
      return;
    }
    if (typeof queueEvent !== "function") return;
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
                  disabled={Boolean(it.disabled)}
                  className={"flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"}
                  title={it.disabled && it.key === "contract_talk" ? "A renewal negotiation is already active" : undefined}
                >
                  <span className="mt-0.5 shrink-0">{it.icon}</span>
                  <span className="flex-1">
                    <span className="block text-[13px] leading-tight font-medium">{it.label}</span>
                    {it.desc && <span className="block text-[11px] leading-tight text-gray-500 dark:text-gray-400">
                      {it.desc}
                    </span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {gi < groups.length - 1 && <div className="my-1 h-px w-full bg-gray-100 dark:bg-zinc-800" />}
        </div>
      ))}

      {!isOwnDriver && (
        <div className="px-2 pb-2 text-[10px] text-gray-400">
          Scouting uses the same knowledge rules as the profile: regional estimates remain ranges and a full report unlocks exact ratings.
        </div>
      )}
      <div className="px-2 pb-2 text-[10px] text-gray-400">Scroll for more • ESC to close</div>
    </ActionsButton>
  );
}
