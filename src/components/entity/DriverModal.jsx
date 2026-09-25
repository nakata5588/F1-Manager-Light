// src/components/entity/DriverModal.jsx
import { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  X, Filter, MoreVertical, Dumbbell, Megaphone,
  Handshake, FileText, Coffee, Search, Info, Trophy
} from "lucide-react";
import { useModalStore } from "../../state/ModalStore.js";
import { useGame } from "../../state/GameStore.js";
import { driverOverallPresentation, hasMeaningfulDriverAttributes } from "../../domain/driverMarketEvaluation.js";
import { driverProfileSnapshot } from "../../domain/driverProfile.js";
import { presentDriverKnowledgeValue } from "../../domain/driverKnowledge.js";
import { driverDerivedRatings } from "../../domain/driverDerivedRatings.js";
import {
  annotateCareerTransfers,
  applyResultChampionshipPositions,
  historicalCareerDriverMatches,
  historicalCareerRowKey,
  markChampionshipPositionTeam,
  mergeHistoricalCareerSources,
  resolveHistoricalTeamId,
} from "../../domain/driverCareerIdentity.js";
import { driverConstructorChampionships } from "../../domain/championshipHistory.js";
import {
  driverAttributeGroups,
  driverAttributeGroupScore,
  driverAttributeGroupBehaviourForScore,
  driverAttributeValue,
  driverDevelopmentFocus,
  driverDevelopmentFocusState,
  driverWheelToWheelBehaviour,
} from "../../domain/driverAttributeGroups.js";
import { DriverPortrait, StaffPortrait, TeamLogo, flagFromCountry } from "./EntityVisuals.jsx";
import { GrandPrixFlag } from "./GrandPrixFlag.jsx";
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
import { driverRelationshipRecords } from "../../domain/driverRelationships.js";
import { driverRivalryEventLogForDriver, driverRivalryRecords } from "../../domain/driverRivalries.js";
import { driverRelationshipConsequenceProfile } from "../../domain/driverRelationshipConsequences.js";
import { formatRelationshipYears, historicalDriverRelationshipRecords } from "../../domain/driverRelationshipHistory.js";
import { managerDisplayName } from "../../domain/managerProfile.js";

/* ======================== Helpers & Const ======================== */

const TABS = [
  { key: "overview",    label: "Overview" },
  { key: "attributes",  label: "Attributes" },
  { key: "development", label: "Development" },
  { key: "form",        label: "Form" },
  { key: "relationships", label: "Relationships" },
  { key: "career",      label: "Career" },
];

const TAB_ALIASES = Object.freeze({
  statistics: "career",
  performance: "form",
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
  const careerRaw = useMemo(
    () => mergeHistoricalCareerSources(
      toArraySafe(gs?.driverCareer),
      toArraySafe(gs?.dbDriverCareer),
      [...toArraySafe(gs?.dbTeams), ...toArraySafe(gs?.teams)]
    ),
    [gs?.driverCareer, gs?.dbDriverCareer, gs?.dbTeams, gs?.teams]
  );
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
  const driverIdentityName = displayValue(driver?.display_name ?? driver?.name, "");


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
      if (!historicalCareerDriverMatches(row,{driverId:driver?.driver_id??driver?.id??entity.id,driverName:driverIdentityName})) return;
      const y = Number(unbox(row?.year));
      if (!Number.isFinite(y) || (Number.isFinite(careerStartYear) && y >= careerStartYear)) return;
      const key = historicalCareerRowKey(row,teamsList);
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
    // Manual career rows are fallback/enrichment only. Result-derived history
    // is authoritative for starts, points, teams and other race statistics.
    for (const row of careerRaw || []) push(row, 1);
    for (const row of generatedHistoryRaw || []) push(row, 2);
    const rows=[...merged.values()].map(({ __priority, ...row }) => row);
    return applyResultChampionshipPositions(rows,generatedHistoryRaw);
  }, [careerRaw, generatedHistoryRaw, driver?.driver_id, driver?.id, entity.id, driverIdentityName, teamsList, careerStartYear]);

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
          driver_id: driverId,
          driver_name: driverIdentityName,
          series_division: "F1",
          team_id,
          team_name: teamNameById.get(String(team_id ?? "")) || (y === gameYear ? contractTeam : null) || "—",
          starts: 0, races: 0, wins: 0, podiums: 0, poles: 0, fastest_laps: 0, dnf: 0, points: 0, champ_pos: null,
          first_round: null, last_round: null,
        });
      }
      const rec = byKey.get(key);
      const round=Number(event?.round ?? event?.round_number ?? event?.roundIndex ?? event?.round_index);
      if(Number.isFinite(round)){
        rec.first_round=rec.first_round==null?round:Math.min(rec.first_round,round);
        rec.last_round=rec.last_round==null?round:Math.max(rec.last_round,round);
      }
      if (raceRow) {
        rec.starts += 1;
        rec.races += 1;
        const pos = Number(raceRow.position ?? raceRow.pos);
        const retired=Boolean(raceRow.retired)||String(raceRow.status||"").toUpperCase()==="DNF";
        if (!retired && pos === 1) rec.wins += 1;
        if (!retired && pos >= 1 && pos <= 3) rec.podiums += 1;
        if (raceRow.fastest_lap) rec.fastest_laps += 1;
        if (retired) rec.dnf += 1;
        rec.points += Number(raceRow.points || 0);
      }
      if (qRow && Number(qRow.position ?? qRow.pos) === 1) rec.poles += 1;
    }

    for (const rec of byKey.values()) {
      const seasonStanding = rec.year === gameYear
        ? toArraySafe(standings?.drivers)
        : toArraySafe(historySeasons.find((h) => Number(h?.year) === Number(rec.year))?.standings?.drivers);
      const standing = seasonStanding.find((r) => sameDriver(r?.driver_id ?? r?.id, idNorm));
      rec.champ_pos = standing?.position ?? standing?.pos ?? null;
    }

    return [...byKey.values()].sort((a,b) => Number(a.year)-Number(b.year));
  }, [results, standings, historySeasons, teamsList, gameYear, careerStartYear, idNorm, contractTeam, driverId, driverIdentityName]);

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
      dnf: sum("dnf"),
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
    const dnfs         = sum((r) => r.dnf ?? r.dnfs);
    const points       = sum((r) => r.points);
    const yearsWithPoints = rows.filter((r) => unbox(r.points) !== undefined);
    const avgPoints = yearsWithPoints.length
      ? (yearsWithPoints.reduce((a, r) => a + Number(unbox(r.points) || 0), 0) / yearsWithPoints.length)
      : null;
    const championshipRows=markChampionshipPositionTeam(rows)
      .filter((r)=>r.__showChampionshipPosition!==false&&!r.__live&&isNumeric(r.champ_pos));
    const positionsBySeason=new Map();
    for(const row of championshipRows){
      positionsBySeason.set(`${unbox(row.year)}|${getSeries(row).toUpperCase()}`,Number(unbox(row.champ_pos)));
    }
    const numericPositions=[...positionsBySeason.values()];
    const highestPos  = numericPositions.length ? Math.min(...numericPositions) : null;
    const highestCount= numericPositions.length ? numericPositions.filter((p) => p === (highestPos ?? 0)).length : 0;
    const avgPos = numericPositions.length
      ? (numericPositions.reduce((a, v) => a + v, 0) / numericPositions.length)
      : null;
    return { starts, wins, podiums, poles, fastest_laps, dnfs, points, avgPoints, highestPos, highestCount, avgPos };
  }, [filteredCareer]);

  const careerTimeline = useMemo(() => {
    const list = (filteredCareer || []).slice();
    list.sort((a, b) => {
      const ya = Number(unbox(a.year)) || 0;
      const yb = Number(unbox(b.year)) || 0;
      if (ya !== yb) return ya - yb;
      const la=Number(unbox(a.last_round));
      const lb=Number(unbox(b.last_round));
      if(Number.isFinite(la)&&Number.isFinite(lb)&&la!==lb)return la-lb;
      if(Number.isFinite(la)!==Number.isFinite(lb))return Number.isFinite(la)?1:-1;
      const oa = Number(unbox(a.order));
      const ob = Number(unbox(b.order));
      if(Number.isFinite(oa)&&Number.isFinite(ob)&&oa!==ob)return oa-ob;
      return String(unbox(a.team_name) || "").localeCompare(String(unbox(b.team_name) || ""));
    });
    return annotateCareerTransfers(markChampionshipPositionTeam(list));
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
  const shortF1Career = useMemo(() => {
    const source=[...(careerAll||[]),...(simulatedCareerRows||[])]
      .filter((row)=>String(getSeries(row)||"F1").toUpperCase()==="F1")
      .filter((row)=>{
        const year=Number(unbox(row?.year));
        const starts=Number(unbox(row?.starts??row?.races));
        return Number.isFinite(year)&&(starts>0||year===Number(gameYear));
      })
      .map((row)=>{
        const year=Number(unbox(row?.year));
        const teamId=resolveHistoricalTeamId(row,teamsList)||String(unbox(row?.team_id??""));
        const teamRecord=(teamsList||[]).find((team)=>String(unbox(team?.team_id??team?.id??""))===String(teamId));
        const teamName=displayValue(
          teamRecord?.team_name??teamRecord?.name??row?.team_name??row?.team,
          "Unknown Team"
        );
        return {
          year,
          teamId:String(teamId||teamName),
          teamName:String(teamName),
          lastRound:Number(unbox(row?.last_round)),
        };
      })
      .sort((a,b)=>a.year-b.year||
        (Number.isFinite(a.lastRound)?a.lastRound:999)-(Number.isFinite(b.lastRound)?b.lastRound:999));

    const unique=[];
    const seen=new Set();
    for(const row of source){
      const key=`${row.year}|${row.teamId}`;
      if(seen.has(key))continue;
      seen.add(key);
      unique.push(row);
    }

    const stints=[];
    for(const row of unique){
      const previous=stints[stints.length-1];
      if(previous&&previous.teamId===row.teamId&&row.year<=previous.endYear+1){
        previous.endYear=Math.max(previous.endYear,row.year);
      }else{
        stints.push({
          teamId:row.teamId,
          teamName:row.teamName,
          startYear:row.year,
          endYear:row.year,
        });
      }
    }

    const shortYear=(year)=>String(Math.abs(Number(year))%100).padStart(2,"0");
    return stints.map((stint)=>{
      const current=
        Number(stint.endYear)===Number(gameYear)&&
        (String(stint.teamId)===String(contractTeamId)||String(stint.teamName)===String(contractTeam));
      let years;
      if(current){
        years=`${shortYear(stint.startYear)}–current`;
      }else if(stint.startYear===stint.endYear){
        years=shortYear(stint.startYear);
      }else{
        years=`${shortYear(stint.startYear)}–${shortYear(stint.endYear)}`;
      }
      return {...stint,current,label:`${years} ${stint.teamName}`};
    });
  }, [careerAll,simulatedCareerRows,teamsList,gameYear,contractTeamId,contractTeam]);

  const driverTitles = useMemo(() => {
    const titles=[];
    const seen=new Set();

    // Drivers Championship: championship P1 only, with the team attached to
    // the actual title season.
    for(const achievement of achievementsList||[]){
      if(Number(achievement?.position)!==1)continue;
      const year=Number(achievement?.year);
      if(!Number.isFinite(year)||year>=Number(gameYear))continue;
      const key=`${year}|driver`;
      if(seen.has(key))continue;
      seen.add(key);
      titles.push({
        year,
        type:"driver",
        label:"Drivers Championship",
        team_id:String(unbox(achievement?.team_id??"")),
        team_name:displayValue(achievement?.team_name??achievement?.team,"—"),
      });
    }

    // Constructors Championship: use the same standings-derived history as
    // the Standings/Team pages.
    const careerRows=[...(careerAll||[]),...(simulatedCareerRows||[])]
      .filter((row)=>String(getSeries(row)||"F1").toUpperCase()==="F1")
      .filter((row)=>Number(unbox(row?.year))<Number(gameYear))
      .map((row)=>({
        ...row,
        team_id:resolveHistoricalTeamId(row,teamsList)||String(unbox(row?.team_id??"")),
      }));

    for(const champion of driverConstructorChampionships(gs,careerRows)){
      const year=Number(champion?.year);
      if(!Number.isFinite(year)||year>=Number(gameYear))continue;
      const key=`${year}|constructor`;
      if(seen.has(key))continue;
      seen.add(key);
      titles.push({
        year,
        type:"constructor",
        label:"Constructors Championship",
        team_id:String(champion?.team_id??""),
        team_name:displayValue(champion?.team_name,"—"),
      });
    }

    return titles.sort((a,b)=>a.year-b.year||a.type.localeCompare(b.type));
  }, [gs,achievementsList,careerAll,simulatedCareerRows,teamsList,gameYear]);

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
  const abilityLog = (gs?.driverAbilityLog?.[driverId]||[])
    .slice()
    .sort((a,b)=>String(b?.dateISO||"").localeCompare(String(a?.dateISO||"")));
  const lifecycleLog = (gs?.driverLifecycleLog?.[driverId]||[])
    .slice()
    .sort((a,b)=>String(a?.asOf||a?.dateISO||"").localeCompare(String(b?.asOf||b?.dateISO||"")));

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
      <aside className="w-[360px] shrink-0 border-r border-white/10 bg-[#11141c] p-5 overflow-y-auto">
        <div className="flex items-center gap-3">
          <DriverPortrait driver={driver} size="h-36 w-36" className="!rounded-xl"/>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Driver</div>
            <div className="text-xl font-semibold leading-tight truncate">{driverName}</div>
            <div className="mt-1 text-xs text-slate-400">
              {flagFromCountry(driverCountry, driver?.country_code)} {driverCountry}
              {driverNumber ? ` · #${driverNumber}` : ""}
            </div>
          </div>
        </div>

        {(contractTeamId || profileSnapshot?.teamId) ? (
          <button
            type="button"
            data-entity="team"
            data-id={contractTeamId || profileSnapshot?.teamId}
            className="mt-4 w-full rounded-xl border border-white/10 bg-[#171a23] p-3 text-left hover:bg-white/5"
          >
            <div className="flex items-center gap-3">
              <TeamLogo teamId={contractTeamId || profileSnapshot?.teamId} name={contractTeam || profileSnapshot?.teamName || "Team"} size="h-10 w-10"/>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{contractTeam || profileSnapshot?.teamName || "Team"}</div>
                <div className="text-xs text-slate-500">{contractRole || "No active role"} · View team</div>
              </div>
            </div>
          </button>
        ) : (
          <div className="mt-4 rounded-xl border border-white/10 bg-[#171a23] p-3 text-sm text-slate-400">
            Free Agent
          </div>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2">
          <ProfileMetric label="OVR" value={overallLabel} compact/>
          <ProfileMetric label="Champ" value={profileSnapshot?.season?.championshipPosition ? `P${profileSnapshot.season.championshipPosition}` : "—"} compact/>
          <ProfileMetric label="Points" value={profileSnapshot?.season?.points ?? 0} compact/>
        </div>

        {knowledge?.canSeeCondition&&(
          <div className="mt-4 space-y-3">
            <ConditionBar label="Confidence" value={condition?.confidence ?? 50}/>
            <ConditionBar label="Morale" value={condition?.morale ?? 50}/>
            <ConditionBar label="Preparation" value={condition?.preparation ?? 50}/>
            <ConditionBar label="Fatigue" value={condition?.fatigue ?? 0} inverse/>
          </div>
        )}

        <div className="mt-4 border-t border-white/10 pt-4 text-xs text-slate-400 space-y-2">
          <div className="flex justify-between gap-3"><span>Age</span><strong className="text-slate-200">{computedAge ?? "—"}</strong></div>
          <div className="flex justify-between gap-3"><span>Rookie season</span><strong className="text-slate-200">{unbox(driver?.f1_rookie_season) ?? "—"}</strong></div>
          <div className="flex justify-between gap-3"><span>Years raced</span><strong className="text-slate-200">{yearsRaced ?? "—"}</strong></div>
        </div>

        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">F1 Career</div>
          <div className="mt-2 space-y-1 text-[11px]">
            {shortF1Career.length?shortF1Career.map((stint,index)=>(
              <div key={`${stint.startYear}-${stint.teamId}-${index}`} className="flex items-center gap-2 text-slate-300">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400/70"/>
                <span className={stint.current?"font-semibold text-sky-300":""}>{stint.label}</span>
              </div>
            )):<div className="text-slate-600">No F1 career recorded.</div>}
          </div>
        </div>

        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Titles</div>
          {driverTitles.length>0&&(
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <div className="rounded-md border border-amber-400/15 bg-amber-500/[0.06] px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wide text-slate-500">Drivers</div>
                <div className="text-sm font-bold text-amber-200">{driverTitles.filter((title)=>title.type==="driver").length}</div>
              </div>
              <div className="rounded-md border border-sky-400/15 bg-sky-500/[0.06] px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wide text-slate-500">Constructors</div>
                <div className="text-sm font-bold text-sky-200">{driverTitles.filter((title)=>title.type==="constructor").length}</div>
              </div>
            </div>
          )}
          <div className="mt-2 space-y-1.5 text-[11px]">
            {driverTitles.length?driverTitles.map((title,index)=>(
              <div key={`${title.year}-${title.type}-${index}`} className="flex items-center gap-2 text-slate-300">
                {title.type==="driver"
                  ?<Trophy size={12} className="shrink-0 text-amber-300"/>
                  :<span className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border border-sky-300/40 bg-sky-500/10 text-[7px] font-bold text-sky-300">C</span>}
                <span className="min-w-0">
                  <strong className="text-slate-200">{title.year}</strong> · {title.label}
                  {title.team_name&&title.team_name!=="—"&&(
                    <span className="text-slate-500"> · {title.team_name}</span>
                  )}
                </span>
              </div>
            )):<div className="text-slate-600">No F1 titles.</div>}
          </div>
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
              <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="text-2xl font-semibold truncate">{driverName}</h2>
                <span className="text-sm text-slate-400">· {contractTeam || profileSnapshot?.teamName || "Free Agent"} · {contractRole || "No active role"}</span>
                {isOwnDriver && <span className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-300">YOUR DRIVER</span>}
                {!profileSnapshot?.availability?.available && (
                  <span className="rounded bg-rose-500/15 px-2 py-1 text-[10px] font-medium uppercase text-rose-300">
                    {profileSnapshot?.availability?.status || "Unavailable"}
                  </span>
                )}
              </div>
              {knowledge?.canSeeCondition && Number.isFinite(Number(profileSnapshot?.conditionImpact?.total))&&(
                <div className="mt-0.5 text-[11px] text-slate-500">
                  Current performance {Number(profileSnapshot.conditionImpact.total)>=0?"+":""}{Number(profileSnapshot.conditionImpact.total).toFixed(1)}
                </div>
              )}
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
              gameState={gs}
            />
          )}

          {activeTab === "attributes" && (
            <AttributesTab
              attrs={meaningfulAttrs}
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
              abilityLog={abilityLog}
              lifecycle={profileSnapshot?.lifecycle}
              lifecycleLog={lifecycleLog}
              currentYear={gameYear}
              onSetFocus={setDriverDevelopmentFocus}
            />
          )}

          {activeTab === "form" && (
            <FormTab
              form={profileSnapshot?.form}
              items={profileSnapshot?.performanceHistory||[]}
              gameState={gs}
            />
          )}

          {activeTab === "relationships" && (
            <RelationshipsTab gameState={gs} driverId={driverId} />
          )}

          {activeTab === "career" && (
            <div className="space-y-5">
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
              <div className="border-t border-white/10 pt-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Season History by Team</div>
                <CareerTab
                  seriesSel={seriesSel}
                  setSeriesSel={setSeriesSel}
                  seriesOptions={seriesOptions}
                  timeline={careerTimeline}
                  totals={careerTotals}
                  teams={teamsList}
                  showFilter={false}
                />
              </div>
              <div className="border-t border-white/10 pt-4">
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

function ProfileMetric({ label, value, tone = "", cardTone = "", title = "", compact = false }) {
  return (
    <div
      title={title||undefined}
      className={`rounded-lg border border-white/10 bg-[#171a23] ${compact?"px-2 py-1.5":"px-3 py-2"} ${cardTone}`}
    >
      <div className={`${compact?"text-[9px]":"text-[10px]"} uppercase tracking-wide text-slate-500`}>{label}</div>
      <div className={`${compact?"mt-0 text-[13px]":"mt-0.5 text-sm"} font-semibold ${tone}`}>{displayValue(value)}</div>
    </div>
  );
}

function ChampionshipMedal({ position }) {
  const isSilver=Number(position)===2;
  const medalClass=isSilver
    ?"border-slate-200/70 bg-gradient-to-br from-slate-100 via-slate-300 to-slate-500 text-slate-800"
    :"border-orange-300/70 bg-gradient-to-br from-orange-200 via-orange-400 to-amber-700 text-amber-950";
  const ribbonClass=isSilver
    ?"from-slate-200 via-slate-500 to-slate-200"
    :"from-orange-200 via-orange-500 to-orange-200";
  return (
    <span
      className="relative inline-flex h-5 w-4 shrink-0 items-end justify-center"
      aria-label={isSilver?"Championship runner-up":"Championship third place"}
      title={isSilver?"Championship runner-up":"Championship third place"}
    >
      <span className={`absolute top-0 h-2.5 w-3 bg-gradient-to-r ${ribbonClass}`} style={{clipPath:"polygon(0 0,42% 0,50% 100%,58% 0,100% 0,72% 100%,28% 100%)"}}/>
      <span className={`relative z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[8px] font-black leading-none shadow-sm ${medalClass}`}>
        {position}
      </span>
    </span>
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

function conditionFormulaRows(condition,impact){
  const confidence=Number(condition?.confidence??50);
  const morale=Number(condition?.morale??50);
  const preparation=Number(condition?.preparation??50);
  const fatigue=Number(condition?.fatigue??0);
  const signed=(value,digits=2)=>`${value>=0?"+":""}${Number(value||0).toFixed(digits)}`;
  const deltaText=(value)=>signed(value-50,1);

  let fatigueFormula;
  if(fatigue<=10)fatigueFormula=`Fatigue ${fatigue.toFixed(1)} ≤ 10 → no performance penalty`;
  else if(fatigue<=30)fatigueFormula=`(${fatigue.toFixed(1)} − 10) × 0.06 = ${signed(impact?.fatigueEffect,2)}`;
  else if(fatigue<=50)fatigueFormula=`−[1.20 + (${fatigue.toFixed(1)} − 30) × 0.10] = ${signed(impact?.fatigueEffect,2)}`;
  else if(fatigue<=70)fatigueFormula=`−[3.20 + (${fatigue.toFixed(1)} − 50) × 0.14] = ${signed(impact?.fatigueEffect,2)}`;
  else fatigueFormula=`High-fatigue curve at ${fatigue.toFixed(1)} = ${signed(impact?.fatigueEffect,2)}`;

  return [
    {
      label:"Confidence",
      value:impact?.confidenceEffect,
      explanation:`${confidence.toFixed(1)} is ${deltaText(confidence)} from neutral 50; × 0.05 = ${signed(impact?.confidenceEffect,2)}`,
    },
    {
      label:"Morale",
      value:impact?.moraleEffect,
      explanation:`${morale.toFixed(1)} is ${deltaText(morale)} from neutral 50; × 0.03 = ${signed(impact?.moraleEffect,2)}`,
    },
    {
      label:"Preparation",
      value:impact?.preparationEffect,
      explanation:`${preparation.toFixed(1)} is ${deltaText(preparation)} from neutral 50; × 0.04 = ${signed(impact?.preparationEffect,2)}`,
    },
    {
      label:"Fatigue",
      value:impact?.fatigueEffect,
      explanation:fatigueFormula,
    },
    {
      label:"Medical",
      value:impact?.medicalEffect,
      explanation:Number(impact?.medicalEffect||0)<0
        ?`Current medical status applies ${signed(impact?.medicalEffect,2)}`
        :"No active medical performance penalty.",
    },
  ];
}

function ConditionExplanationPanel({snapshot,condition}){
  const [open,setOpen]=useState(false);
  const impact=snapshot?.conditionImpact||{};
  const history=snapshot?.mentalStateHistory||[];
  const rows=conditionFormulaRows(condition,impact);
  const raw=rows.reduce((sum,row)=>sum+Number(row.value||0),0);
  const total=Number(impact?.total||0);
  const signed=(value,digits=2)=>`${value>=0?"+":""}${Number(value||0).toFixed(digits)}`;

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Current Performance Impact</div>
          <div className="mt-0.5 text-[11px] text-slate-400">Temporary state changes race/qualifying performance; it never changes Overall by itself.</div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`text-lg font-semibold ${total>=0?"text-emerald-300":"text-rose-300"}`}>{signed(total)}</div>
          <button
            type="button"
            onClick={()=>setOpen((value)=>!value)}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${open?"border-sky-400/30 bg-sky-500/10 text-sky-300":"border-white/10 text-slate-400 hover:text-white"}`}
            aria-expanded={open}
            title="Explain the current performance modifier"
          >
            <Info size={12}/> Why these values?
          </button>
        </div>
      </div>

      {open&&(
        <div className="mt-3 rounded-lg border border-sky-400/15 bg-sky-500/[0.04] p-3">
          <div className="space-y-2">
            {rows.map((row)=>{
              const value=Number(row.value||0);
              return (
                <div key={row.label} className="grid gap-1 rounded-md border border-white/10 bg-[#171a23] px-2.5 py-2 md:grid-cols-[110px_70px_minmax(0,1fr)] md:items-center">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{row.label}</span>
                  <span className={`text-sm font-semibold ${value>0?"text-emerald-300":value<0?"text-rose-300":"text-slate-400"}`}>{signed(value)}</span>
                  <span className="text-[11px] text-slate-400">{row.explanation}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            Raw sum {signed(raw)} · final modifier is limited to the game range −12.00 to +6.00 → {signed(total)}.
          </div>

          <div className="mt-3 border-t border-white/10 pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recent causes</div>
            {history.length?(
              <div className="mt-2 space-y-2">
                {history.slice(0,6).map((entry,index)=>(
                  <div key={`${entry?.dateISO||"event"}-${entry?.source||"state"}-${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                    <span className="min-w-[72px] text-slate-500">{entry?.dateISO||"—"}</span>
                    <span className="font-medium text-slate-300">{entry?.reason||String(entry?.source||"Mental state").replaceAll("_"," ")}</span>
                    <span className="flex flex-wrap gap-1">
                      {(entry?.changes||[]).map((change)=>{
                        const delta=Number(change?.delta||0);
                        return <span key={change.field} className={`rounded border border-white/10 px-1.5 py-0.5 ${delta>0?"text-emerald-300":delta<0?"text-rose-300":"text-slate-400"}`}>{String(change.field||"").replaceAll("_"," ")} {signed(delta,1)}</span>;
                      })}
                    </span>
                  </div>
                ))}
              </div>
            ):(
              <div className="mt-2 text-[11px] text-slate-500">No recorded mental-state events yet for this save.</div>
            )}
            <div className="mt-2 text-[10px] leading-4 text-slate-500">Passive daily recovery is not logged line-by-line: Fatigue falls naturally, while Confidence and Morale drift slowly back toward 50.</div>
          </div>
        </div>
      )}
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
  gameState,
}) {
  const [showExpectationInfo,setShowExpectationInfo]=useState(false);
  const season=snapshot?.season||{};
  const availability=snapshot?.availability||{};
  const canSeeCondition=Boolean(knowledge?.canSeeCondition);
  const reputationView=presentDriverKnowledgeValue(
    knowledge,
    "reputation",
    snapshot?.reputation,
    {kind:"attribute"}
  );
  const performanceRows=snapshot?.performanceHistory||[];
  const expectationDeltaOf=(row)=>{
    if(row?.retired)return null;
    const explicit=Number(row?.expectation_delta);
    if(Number.isFinite(explicit))return explicit;
    const expected=Number(row?.expected_finish);
    const finish=Number(row?.finish_position);
    return Number.isFinite(expected)&&Number.isFinite(finish)?expected-finish:null;
  };
  const expectationRows=performanceRows
    .map((row)=>({...row,__expectationDelta:expectationDeltaOf(row)}))
    .filter((row)=>Number.isFinite(row.__expectationDelta));
  const latestExpectation=expectationRows[0]||null;
  const expectationWindow=expectationRows.slice(0,5);
  const expectationAverage=expectationWindow.length
    ?expectationWindow.reduce((sum,row)=>sum+row.__expectationDelta,0)/expectationWindow.length
    :null;
  const expectationTrend=expectationAverage==null
    ?"No data"
    :expectationAverage>=1.5
      ?"Above expectation"
      :expectationAverage<=-1.5
        ?"Below expectation"
        :"On expectation";
  const comparableDelta=(value)=>{
    if(value===null||value===undefined||value==="")return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  };
  const raceTeammateRows=performanceRows
    .map((row)=>comparableDelta(row?.teammate_race_delta))
    .filter(Number.isFinite);
  const qualiTeammateRows=performanceRows
    .map((row)=>comparableDelta(row?.teammate_qualifying_delta))
    .filter(Number.isFinite);
  const h2h=(values)=>({
    wins:values.filter((value)=>value>0).length,
    losses:values.filter((value)=>value<0).length,
    ties:values.filter((value)=>value===0).length,
    avg:values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null,
  });
  const raceH2H=h2h(raceTeammateRows);
  const qualiH2H=h2h(qualiTeammateRows);

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
      {availability.available && availability.status==="limited" && (
        <div className="xl:col-span-12 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-300">Fit with minor injury</div>
          <div className="mt-1 text-sm text-slate-200">
            {availability.reason||"Minor injury"} · Driver remains selectable, but current performance is temporarily reduced
            {availability.expectedReturnDate?` until approximately ${availability.expectedReturnDate}`:""}.
          </div>
        </div>
      )}

      <div className="xl:col-span-7 rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current State</div>
          <span className="rounded bg-sky-500/10 px-2 py-1 text-[10px] uppercase tracking-wide text-sky-300">{knowledge?.label||"Unscouted"}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <ProfileMetric label="Overall" value={overallLabel}/>
          <ProfileMetric
            label="Reputation"
            value={reputationView?.label??"—"}
            tone={presentationColorClass(reputationView)}
            title="Paddock, media and fan standing. Reputation affects market evaluation, salary expectations and negotiations; it does not add race pace or Overall."
          />
          <ProfileMetric label="Championship" value={season.championshipPosition?`P${season.championshipPosition}`:"—"}/>
          <ProfileMetric label="Points" value={season.points??0}/>
          <ProfileMetric
            label="Form"
            value={snapshot?.form?.score!=null?`${Number(snapshot.form.score).toFixed(1)} · ${snapshot.form.label}`:"—"}
            tone={snapshot?.form?.score!=null?(Number(snapshot.form.score)>=76?"text-emerald-300":Number(snapshot.form.score)<58?"text-rose-300":"text-slate-200"):""}
          />
        </div>

        {canSeeCondition&&(
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

            <ConditionExplanationPanel snapshot={snapshot} condition={condition}/>
          </>
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

      <div className="xl:col-span-6 rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Performance vs Expectation</div>
          <button
            type="button"
            onClick={()=>setShowExpectationInfo((value)=>!value)}
            className="inline-flex items-center gap-1 rounded border border-sky-400/20 bg-sky-500/[0.06] px-2 py-1 text-[10px] font-medium text-sky-300 hover:bg-sky-500/10"
            aria-expanded={showExpectationInfo}
            title="How expectation is calculated"
          >
            <Info size={12}/> How is this calculated?
          </button>
        </div>
        {showExpectationInfo&&(
          <div className="mt-2 rounded-lg border border-sky-400/15 bg-sky-500/[0.05] p-2.5 text-[11px] leading-4 text-slate-400">
            <strong className="text-slate-200">Expected finish</strong> is the car/machinery baseline for that Grand Prix relative to the field.
            A positive delta means the driver finished ahead of that expectation; a negative delta means below it.
            <span className="text-slate-500"> It feeds race evaluation, Form and temporary Confidence/Morale responses, but does not directly change Overall.</span>
          </div>
        )}
        {latestExpectation?(
          <>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <ProfileMetric
                label="Latest"
                value={`${latestExpectation.__expectationDelta>=0?"+":""}${latestExpectation.__expectationDelta.toFixed(1)} pos`}
                tone={latestExpectation.__expectationDelta>0?"text-emerald-300":latestExpectation.__expectationDelta<0?"text-rose-300":"text-slate-300"}
              />
              <ProfileMetric
                label="Last 5 Avg"
                value={expectationAverage!=null?`${expectationAverage>=0?"+":""}${expectationAverage.toFixed(1)} pos`:"—"}
                tone={expectationAverage>0?"text-emerald-300":expectationAverage<0?"text-rose-300":"text-slate-300"}
              />
              <ProfileMetric
                label="Trend"
                value={expectationTrend}
                tone={expectationAverage>=1.5?"text-emerald-300":expectationAverage<=-1.5?"text-rose-300":"text-sky-300"}
              />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {latestExpectation.gp_name||`Round ${latestExpectation.round||"—"}`} · expected ~P{Number(latestExpectation.expected_finish||0).toFixed(1)} · finished P{latestExpectation.finish_position||"—"}.
            </div>
          </>
        ):(
          <div className="mt-3 text-sm text-slate-500">No completed race with a valid car expectation yet.</div>
        )}
      </div>

      <div className="xl:col-span-6 rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Teammate Comparison</div>
        {raceTeammateRows.length||qualiTeammateRows.length?(
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <ProfileMetric
                label="Race H2H"
                value={raceTeammateRows.length?`${raceH2H.wins}–${raceH2H.losses}${raceH2H.ties?`–${raceH2H.ties}`:""}`:"—"}
                tone={raceH2H.wins>raceH2H.losses?"text-emerald-300":raceH2H.wins<raceH2H.losses?"text-rose-300":"text-slate-300"}
              />
              <ProfileMetric
                label="Qualifying H2H"
                value={qualiTeammateRows.length?`${qualiH2H.wins}–${qualiH2H.losses}${qualiH2H.ties?`–${qualiH2H.ties}`:""}`:"—"}
                tone={qualiH2H.wins>qualiH2H.losses?"text-emerald-300":qualiH2H.wins<qualiH2H.losses?"text-rose-300":"text-slate-300"}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
              {raceH2H.avg!=null&&<span>Avg race delta <strong className={raceH2H.avg>0?"text-emerald-300":raceH2H.avg<0?"text-rose-300":"text-slate-300"}>{raceH2H.avg>=0?"+":""}{raceH2H.avg.toFixed(1)} positions</strong></span>}
              {qualiH2H.avg!=null&&<span>Avg qualifying delta <strong className={qualiH2H.avg>0?"text-emerald-300":qualiH2H.avg<0?"text-rose-300":"text-slate-300"}>{qualiH2H.avg>=0?"+":""}{qualiH2H.avg.toFixed(1)} positions</strong></span>}
            </div>
          </>
        ):(
          <div className="mt-3 text-sm text-slate-500">No comparable team-mate race data yet.</div>
        )}
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
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last 10 Grands Prix</div>
            <div className="mt-1 text-xs text-slate-400">Recent played-race results and performance evaluation.</div>
          </div>
          {!!snapshot?.performanceHistory?.length&&(
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{Math.min(10,snapshot.performanceHistory.length)} shown</div>
          )}
        </div>
        {snapshot?.performanceHistory?.length?(
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[minmax(190px,1fr)_62px_100px_62px_72px_92px] gap-2 border-b border-white/10 pb-1.5 text-[9px] uppercase tracking-wide text-slate-500">
                <span>Grand Prix</span><span className="text-right">Quali</span><span className="text-right">Result</span><span className="text-right">Δ</span><span className="text-right">Eval.</span><span className="text-right">Best Lap</span>
              </div>
              {snapshot.performanceHistory.slice(0,10).map((race,index)=>{
                const retired=Boolean(race?.retired);
                const score=Number(race?.score);
                const resultLabel=retired
                  ?`DNF · ${race?.retirement_reason||"Retired"}`
                  :race?.finish_position!=null?`P${race.finish_position}`:"—";
                const quali=Number(race?.qualifying_position);
                const finish=Number(race?.finish_position);
                const positionDelta=!retired&&Number.isFinite(quali)&&Number.isFinite(finish)?quali-finish:null;
                const deltaLabel=retired?"DNF":positionDelta==null?"—":`${positionDelta>0?"+":""}${positionDelta}`;
                const bestLapMs=Number(race?.best_lap_ms);
                const bestLapLabel=Number.isFinite(bestLapMs)&&bestLapMs>0
                  ?`${Math.floor(bestLapMs/60000)}:${((bestLapMs%60000)/1000).toFixed(3).padStart(6,"0")}`
                  :"—";
                return (
                  <div key={`${race?.year||"year"}-${race?.round||index}-${race?.gp_id||race?.gp_name||index}`} className="grid grid-cols-[minmax(190px,1fr)_62px_100px_62px_72px_92px] gap-2 border-b border-white/5 py-2 text-xs last:border-b-0">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5 font-medium text-slate-200">
                        <GrandPrixFlag gameState={gameState} record={race} size="sm"/>
                        <span className="truncate">{race?.gp_name||`Round ${race?.round||"—"}`}</span>
                      </div>
                      <div className="mt-0.5 text-[9px] text-slate-600">{race?.year||""}{race?.round?` · R${race.round}`:""}</div>
                    </div>
                    <div className="text-right text-slate-300">{race?.qualifying_position!=null?`P${race.qualifying_position}`:"—"}</div>
                    <div className={`truncate text-right font-medium ${retired?"text-rose-300":Number(race?.finish_position)<=3?"text-emerald-300":"text-slate-200"}`} title={resultLabel}>{resultLabel}</div>
                    <div className={`text-right font-semibold ${retired||Number(positionDelta)<0?"text-rose-300":Number(positionDelta)>0?"text-emerald-300":"text-slate-500"}`}>{deltaLabel}</div>
                    <div className={`text-right font-semibold ${score>=76?"text-emerald-300":score<58?"text-rose-300":"text-slate-300"}`}>{Number.isFinite(score)?score.toFixed(1):"—"}</div>
                    <div className={`text-right font-mono ${race?.fastest_lap?"text-fuchsia-300":"text-slate-400"}`} title={race?.fastest_lap?"Fastest lap of the race":undefined}>{bestLapLabel}{race?.fastest_lap?" ★":""}</div>
                  </div>
                );
              })}
            </div>
          </div>        ):(
          <div className="mt-3 rounded-lg border border-white/10 bg-[#171a23] p-3 text-xs text-slate-500">No played Grand Prix results yet in this save.</div>
        )}
      </div>
    </div>
  );
}

const DRIVER_LIFECYCLE_STAGES=[
  {key:"youth",label:"Youth",y:82},
  {key:"rookie",label:"Rookie",y:68},
  {key:"developing",label:"Developing",y:46},
  {key:"prime",label:"Prime",y:24},
  {key:"veteran",label:"Veteran",y:34},
  {key:"decline",label:"Decline",y:58},
  {key:"retirement_window",label:"Retirement",y:82},
];

function StageTimeline({lifecycle,history=[],currentYear=null}){
  const current=String(lifecycle?.stage||"");
  const points=DRIVER_LIFECYCLE_STAGES.map((stage,index)=>{
    const x=45+index*100;
    return {...stage,x};
  });
  const transitions=(history||[])
    .filter((row)=>row?.stage)
    .reduce((out,row)=>{
      const last=out[out.length-1];
      if(!last||last.stage!==row.stage)out.push(row);
      return out;
    },[])
    .slice(-8);
  const currentIndex=Math.max(0,DRIVER_LIFECYCLE_STAGES.findIndex((stage)=>stage.key===current));
  const age=Number(lifecycle?.age);
  const year=Number(currentYear);
  const targetAges={youth:20,rookie:22,developing:24,prime:28,veteran:32,decline:35,retirement_window:39};
  const transitionYearByStage=new Map(transitions.map((row)=>[
    String(row?.stage||""),
    Number(String(row?.asOf||row?.dateISO||"").slice(0,4))||null,
  ]));
  const rookieYear=Number(lifecycle?.rookieYear);
  if(!transitionYearByStage.get("rookie")&&Number.isFinite(rookieYear)){
    transitionYearByStage.set("rookie",rookieYear);
  }
  const yearLabel=(point,index)=>{
    const actual=transitionYearByStage.get(point.key);
    if(actual)return String(actual);
    if(point.key===current&&Number.isFinite(year))return String(year);
    if(index>currentIndex&&Number.isFinite(year)&&Number.isFinite(age)){
      const target=Number(targetAges[point.key]);
      const projected=year+Math.max(1,Number.isFinite(target)?target-age:index-currentIndex);
      return `~${projected}`;
    }
    return "";
  };

  return (
    <div className="rounded-xl border border-white/10 bg-[#12141c] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Career Stage Timeline</div>
          <div className="mt-1 text-sm text-slate-300">Recorded years use career/save history; future years prefixed with ~ are dynamic projections, not fixed milestones.</div>
          <div className="mt-2 flex gap-4 text-[10px] uppercase tracking-wide">
            <span className="text-rose-300">● Past</span>
            <span className="text-sky-300">● Current</span>
            <span className="text-blue-300">● Future projection</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Current stage</div>
          <div className="font-semibold text-sky-300">{lifecycle?.label||"—"}</div>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <svg viewBox="0 0 690 126" className="h-32 min-w-[620px] w-full" role="img" aria-label="Driver career stage curve">
          {points.slice(0,-1).map((point,index)=>{
            const next=points[index+1];
            const segmentPast=index<currentIndex;
            const segmentFuture=index>=currentIndex;
            return <line
              key={`segment-${point.key}`}
              x1={point.x} y1={point.y} x2={next.x} y2={next.y}
              stroke={segmentPast?"#fb7185":segmentFuture?"#60a5fa":"rgba(148,163,184,.45)"}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={segmentFuture?"5 5":undefined}
              opacity={0.7}
            />;
          })}
          {points.map((point,index)=>{
            const active=point.key===current;
            const past=index<currentIndex;
            const future=index>currentIndex;
            const fill=active?"#7dd3fc":past?"#fb7185":future?"#60a5fa":"#64748b";
            const textFill=active?"#bae6fd":past?"#fda4af":future?"#93c5fd":"#64748b";
            return <g key={point.key}>
              <circle cx={point.x} cy={point.y} r={active?8:5} fill={fill} stroke={active?"#e0f2fe":"#0f172a"} strokeWidth={active?2:1}/>
              <line x1={point.x} y1={point.y+8} x2={point.x} y2="94" stroke={past?"rgba(251,113,133,.20)":future?"rgba(96,165,250,.18)":"rgba(148,163,184,.14)"} strokeWidth="1"/>
              <text x={point.x} y="106" textAnchor="middle" fontSize="9" fill={textFill}>{point.label}</text>
              <text x={point.x} y="119" textAnchor="middle" fontSize="8" fill={textFill}>{yearLabel(point,index)}</text>
            </g>;
          })}
        </svg>
      </div>
      {transitions.length>0&&(
        <div className="mt-2 flex flex-wrap gap-2 border-t border-white/10 pt-3 text-[11px]">
          {transitions.map((row,index)=>(
            <span key={`${row.asOf||row.dateISO||"stage"}-${index}`} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-400">
              {row.asOf||row.dateISO||"—"} · {row.label||niceRole(row.stage)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PressureCard({title,value,factors=[],positive=false}){
  return (
    <div className="rounded-xl border border-white/10 bg-[#171a23] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        <div className={`text-xl font-semibold ${positive?"text-emerald-300":"text-rose-300"}`}>{Math.round(Number(value||0))}</div>
      </div>
      <div className="mt-2 space-y-2">
        {factors.length?factors.map((factor)=>(
          <div key={factor.key} className="border-t border-white/5 pt-2 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-300">{factor.label}</span>
              <span className={positive?"text-emerald-300":"text-rose-300"}>{Number(factor.value||0).toFixed(1)}</span>
            </div>
            <div className="mt-0.5 text-[10px] leading-4 text-slate-500">{factor.explanation}</div>
          </div>
        )):<div className="text-[11px] text-slate-500">No active factors at the moment.</div>}
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
  abilityLog,
  lifecycle,
  lifecycleLog,
  currentYear,
  onSetFocus,
}) {
  const overall=presentDriverKnowledgeValue(knowledge,"current_ability",attrs?.current_ability,{kind:"ability"});
  const potential=presentDriverKnowledgeValue(knowledge,"potential_ability",attrs?.potential_ability,{kind:"potential"});
  const canSeeHistory=Boolean(knowledge?.canSeeDevelopmentHistory);
  const groups=driverAttributeGroups();
  const latestPotential=(potentialLog||[])[0]||null;
  const latestAbility=(abilityLog||[])[0]||null;
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
            <ProfileMetric label="Career stage" value={lifecycle?.label||"—"}/>
            <ProfileMetric
              label="Trajectory"
              value={lifecycle?.trajectoryLabel||(lifecycle?.trajectory?niceRole(lifecycle.trajectory):"—")}
              tone={lifecycle?.trajectory==="rising"?"text-emerald-300":lifecycle?.trajectory==="falling"?"text-rose-300":"text-slate-200"}
            />
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
          {canSeeHistory&&latestAbility&&(
            <div className="mt-3 rounded-lg border border-white/10 bg-[#171a23] p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-400">Latest ability movement</span>
                <strong className={Number(latestAbility.delta)>0?"text-emerald-300":Number(latestAbility.delta)<0?"text-rose-300":"text-slate-300"}>
                  {Number(latestAbility.delta)>0?"+":""}{Number(latestAbility.delta||0).toFixed(2)}
                </strong>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                {latestAbility.before!=null?Number(latestAbility.before).toFixed(1):"—"} → {latestAbility.after!=null?Number(latestAbility.after).toFixed(1):"—"} · {niceRole(latestAbility.stage||"development")}
              </div>
            </div>
          )}

          {canSeeHistory&&lifecycle&&(
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <PressureCard title="Positive Pressure" value={lifecycle.positivePressure} factors={lifecycle.positiveFactors||[]} positive/>
              <PressureCard title="Regression Pressure" value={lifecycle.negativePressure} factors={lifecycle.negativeFactors||[]}/>
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

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {(focusLocked&&focusKey?groups.filter((group)=>group.key===focusKey):groups).map((group)=>{
              const rawScore=driverAttributeGroupScore(attrs,group.key);
              const shown=presentDriverKnowledgeValue(knowledge,`group_${group.key}`,rawScore,{kind:"attribute"});
              const behaviour=shown.sortValue!=null
                ?driverAttributeGroupBehaviourForScore(group.key,shown.sortValue)
                :null;
              const active=focusKey===group.key;
              const unavailable=Boolean(isOwnDriver&&focusLocked&&!active);
              return (
                <div key={group.key} className={`rounded-xl border p-2.5 ${active?"border-sky-400/40 bg-sky-500/10":"border-white/10 bg-[#171a23]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{group.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{group.attributes.map((attribute)=>attribute.label).join(" · ")}</div>
                    </div>
                    <div className={`text-lg font-semibold ${presentationColorClass(shown)}`}>{shown.label}</div>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
                    {behaviour?.text||"Scout the driver to assess this development area."}
                  </p>
                  {isOwnDriver&&(
                    <button
                      onClick={()=>onSetFocus?.(group.key)}
                      disabled={active||unavailable}
                      className={`mt-2 w-full rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${active?"bg-sky-500/15 text-sky-300":"border border-white/10 text-slate-200 hover:bg-white/5"} disabled:cursor-not-allowed disabled:opacity-50`}
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

      {canSeeHistory&&lifecycle&&<StageTimeline lifecycle={lifecycle} history={lifecycleLog||[]} currentYear={currentYear}/>}

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
            <table className="min-w-full text-xs">
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
                  const effectiveDelta=String(row?.attr||"")==="crash_likelihood"?-delta:delta;
                  return (
                    <tr key={`${row?.dateISO||"date"}-${row?.attr||"attr"}-${index}`}>
                      <td className="py-2 pr-3 text-slate-400">{row?.dateISO||"—"}</td>
                      <td className="py-2 pr-3 font-medium">{niceRole(String(row?.attr||"—").replaceAll("_"," "))}</td>
                      <td className="py-2 pr-3 text-right">{isNumeric(row?.before)?Number(row.before).toFixed(2):"—"}</td>
                      <td className="py-2 pr-3 text-right">{isNumeric(row?.after)?Number(row.after).toFixed(2):"—"}</td>
                      <td className={`py-2 pr-3 text-right font-medium ${effectiveDelta>0?"text-emerald-300":effectiveDelta<0?"text-rose-300":"text-slate-400"}`}>
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
      <div className="space-y-3">
        <SeriesFilter seriesSel={seriesSel} setSeriesSel={setSeriesSel} seriesOptions={seriesOptions} />
        <p className="text-gray-500 text-sm">
          No statistics available through {gameYear}{seriesSel && seriesSel !== "All" ? ` • ${seriesSel}` : ""}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SeriesFilter seriesSel={seriesSel} setSeriesSel={setSeriesSel} seriesOptions={seriesOptions} />
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5 xl:grid-cols-10">
        <ProfileMetric label="Starts" value={agg?.starts ?? 0} cardTone="border-slate-400/15 bg-slate-400/[0.05]" compact />
        <ProfileMetric label="Wins" value={agg?.wins ?? 0} tone="text-emerald-300" cardTone="border-emerald-400/20 bg-emerald-500/[0.06]" compact />
        <ProfileMetric label="Podiums" value={agg?.podiums ?? 0} tone="text-amber-300" cardTone="border-amber-400/20 bg-amber-500/[0.06]" compact />
        <ProfileMetric label="Poles" value={agg?.poles ?? 0} tone="text-violet-300" cardTone="border-violet-400/20 bg-violet-500/[0.06]" compact />
        <ProfileMetric label="Fastest Laps" value={agg?.fastest_laps ?? 0} tone="text-cyan-300" cardTone="border-cyan-400/20 bg-cyan-500/[0.06]" compact />
        <ProfileMetric label="DNF" value={agg?.dnfs ?? 0} tone={agg?.dnfs?"text-rose-300":""} cardTone="border-rose-400/20 bg-rose-500/[0.06]" compact />
        <ProfileMetric label="Points" value={agg?.points ?? 0} tone="text-emerald-300" cardTone="border-emerald-400/20 bg-emerald-500/[0.06]" compact />
        <ProfileMetric label="Avg Points" value={agg?.avgPoints != null ? agg.avgPoints.toFixed(2) : "—"} tone="text-sky-300" cardTone="border-sky-400/20 bg-sky-500/[0.06]" compact />
        <ProfileMetric label="Best Champ." value={agg?.highestPos != null ? `P${agg.highestPos}` : "—"} tone="text-amber-300" cardTone="border-amber-400/20 bg-amber-500/[0.06]" compact />
        <ProfileMetric label="Avg Champ." value={agg?.avgPos != null ? agg.avgPos.toFixed(1) : "—"} tone="text-blue-300" cardTone="border-blue-400/20 bg-blue-500/[0.06]" compact />
      </div>
    </div>
  );
}

function CareerTab({ seriesSel, setSeriesSel, seriesOptions, timeline, totals, teams = [], showFilter = true }) {
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
        <table className="min-w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="text-left pr-2 py-1">Year</th>
              <th className="text-left pr-2 py-1">Series</th>
              <th className="text-left pr-2 py-1">Team</th>
              <th className="text-right pr-2 py-1">Starts</th>
              <th className="text-right pr-2 py-1">Wins</th>
              <th className="text-right pr-2 py-1">Podiums</th>
              <th className="text-right pr-2 py-1">Poles</th>
              <th className="text-right pr-2 py-1">FLaps</th>
              <th className="text-right pr-2 py-1">Points</th>
              <th className="text-right pr-0 py-1">Position</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {timeline.map((r, i) => {
              const series = unbox(r.series_division) ?? unbox(r.series) ?? "—";
              const isTransfer = String(unbox(r.champ_pos) ?? "").toLowerCase() === "transfer";
              const showChampionship=r.__showChampionshipPosition!==false;
              const isLive=Boolean(r.__live);
              const finalPosition=showChampionship&&isNumeric(r.champ_pos)?Number(unbox(r.champ_pos)):null;
              const isChampion = !isLive && finalPosition === 1;
              const historicalTeamId = resolveHistoricalTeamId(r,teams);
              const teamName = displayValue(r.team_name ?? r.team_id);
              const transfer=r.__transfer||null;
              return (
                <tr
                  key={`${unbox(r.year)}-${i}`}
                  className={
                    isChampion
                      ?"bg-amber-500/10"
                      :String(series).toUpperCase()!=="F1"
                        ?"bg-violet-500/[0.08]"
                        :""
                  }
                >
                  <td className="pr-2 py-1">{displayValue(r.year)}</td>
                  <td className="pr-2 py-1">{series}</td>
                  <td className="pr-2 py-1">
                    <div>
                      <span className="inline-flex items-center gap-2">
                        <TeamLogo teamId={historicalTeamId} name={teamName} size="h-5 w-5" className="shrink-0"/>
                        {historicalTeamId ? (
                          <span data-entity="team" data-id={historicalTeamId} className="entity-link-team">
                            {teamName}
                          </span>
                        ) : (
                          <span>{teamName}</span>
                        )}
                      </span>
                      {transfer&&(
                        <div className="mt-0.5 text-[9px] text-purple-300">
                          Transfer from {transfer.from}{Number.isFinite(Number(transfer.round))?` · joined R${transfer.round}`:""}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="text-right pr-2 py-1">{displayValue(unbox(r.starts) ?? unbox(r.races), 0)}</td>
                  <td className={`text-right pr-2 py-1 ${Number(unbox(r.wins)) > 0 ? "text-emerald-300 font-semibold" : ""}`}>{displayValue(r.wins, 0)}</td>
                  <td className="text-right pr-2 py-1">{displayValue(r.podiums, 0)}</td>
                  <td className="text-right pr-2 py-1">{displayValue(r.poles, 0)}</td>
                  <td className="text-right pr-2 py-1">{displayValue(r.fastest_laps, 0)}</td>
                  <td className="text-right pr-2 py-1">{displayValue(r.points, 0)}</td>
                  <td className="text-right pr-0 py-1">
                    {!showChampionship ? (
                      <span className="text-slate-600">—</span>
                    ) : finalPosition != null ? (
                      <span className={`inline-flex items-center justify-end gap-1 font-semibold ${isLive?"text-sky-300":finalPosition===1?"text-amber-300":finalPosition===2?"text-slate-300":finalPosition===3?"text-orange-400":""}`}>
                        {!isLive&&finalPosition===1&&<Trophy size={12} aria-label="World Champion"/>}
                        {!isLive&&finalPosition===2&&<ChampionshipMedal position={2}/>}
                        {!isLive&&finalPosition===3&&<ChampionshipMedal position={3}/>} 
                        <span>P{finalPosition}{isLive&&<span className="ml-1 text-[9px] uppercase tracking-wide">Live</span>}</span>
                      </span>
                    ) : (
                      isTransfer ? <span className="italic text-purple-300">Transfer</span> : displayValue(r.champ_pos)
                    )}
                  </td>
                </tr>
              );
            })}
            {totals && (
              <tr className="font-semibold">
                <td colSpan={3} className="pr-2 py-1 text-right">Totals</td>
                <td className="text-right pr-2 py-1">{totals.starts}</td>
                <td className="text-right pr-2 py-1">{totals.wins}</td>
                <td className="text-right pr-2 py-1">{totals.podiums}</td>
                <td className="text-right pr-2 py-1">{totals.poles}</td>
                <td className="text-right pr-2 py-1">{totals.fastest_laps}</td>
                <td className="text-right pr-2 py-1">—</td>
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

  const integerAttributeLabel=(shown)=>{
    if(!shown)return "—";
    if(shown.visibility==="exact"&&shown.sortValue!=null){
      const prefix=String(shown.label||"").startsWith("~")?"~":"";
      return `${prefix}${Math.round(Number(shown.sortValue))}`;
    }
    if(shown.visibility==="range"&&shown.min!=null&&shown.max!=null){
      return `${Math.round(Number(shown.min))}–${Math.round(Number(shown.max))}`;
    }
    return shown.label??"—";
  };

  const renderShown=(shown,{inverse=false,size="",toneOverride=null}={})=>(
    <span
      className={`font-semibold ${size} ${toneOverride??presentationColorClass(shown,{inverse})}`}
      title={
        shown?.visibility==="range"?"Scouting/public estimate range":
        shown?.visibility==="hidden"?"Requires scouting":
        shown?.visibility==="exact"?"Exact known value":"No data"
      }
    >
      {integerAttributeLabel(shown)}
    </span>
  );

  const renderValue=(knowledgeState,field,value,{kind="attribute",inverse=false,size="",toneOverride=null}={})=>
    renderShown(shownValue(knowledgeState,field,value,{kind}),{inverse,size,toneOverride});

  const comparisonTone=(leftShown,rightShown,{inverse=false,side="left"}={})=>{
    if(leftShown?.sortValue==null||rightShown?.sortValue==null)return "text-slate-400";
    const raw=(Number(leftShown.sortValue)-Number(rightShown.sortValue))*(inverse?-1:1);
    if(Math.abs(raw)<0.05)return "text-slate-300";
    const leftBetter=raw>0;
    const better=side==="left"?leftBetter:!leftBetter;
    return better?"text-emerald-300":"text-rose-300";
  };

  const renderComparisonValue=(side,knowledgeState,field,value,otherKnowledge,otherValue,{kind="attribute",inverse=false,size=""}={})=>{
    const shown=shownValue(knowledgeState,field,value,{kind});
    const other=shownValue(otherKnowledge,field,otherValue,{kind});
    const leftShown=side==="left"?shown:other;
    const rightShown=side==="left"?other:shown;
    return renderShown(shown,{
      inverse,
      size,
      toneOverride:comparisonTone(leftShown,rightShown,{inverse,side}),
    });
  };

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
        {approximate?"≈":""}{delta>0?"+":""}{Math.round(delta)}
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

  const compactCompareSections=[
    {
      label:"Pace & Racecraft",
      metrics:[
        ["Pace","pace",attrs?.pace,comparisonAttrs?.pace,false],
        ["Qualifying","qualifying",attrs?.qualifying,comparisonAttrs?.qualifying,false],
        ["Start & Launch","start_launch",attrs?.start_launch,comparisonAttrs?.start_launch,false],
        ["Racecraft","racecraft",attrs?.racecraft,comparisonAttrs?.racecraft,false],
        ["Overtaking","derived_overtaking",derived?.overtaking?.value,comparisonDerived?.overtaking?.value,false],
        ["Defending","derived_defending",derived?.defending?.value,comparisonDerived?.defending?.value,false],
      ],
    },
    {
      label:"Control & Management",
      metrics:[
        ["Race Intelligence","race_intelligence",attrs?.race_intelligence,comparisonAttrs?.race_intelligence,false],
        ["Pressure Handling","pressure_handling",attrs?.pressure_handling,comparisonAttrs?.pressure_handling,false],
        ["Consistency","consistency",attrs?.consistency,comparisonAttrs?.consistency,false],
        ["Wet Skill","wet_skill",attrs?.wet_skill,comparisonAttrs?.wet_skill,false],
        ["Adaptability","adaptability",attrs?.adaptability,comparisonAttrs?.adaptability,false],
        ["Tyre Management","tire_management",attrs?.tire_management,comparisonAttrs?.tire_management,false],
        ["Strategy","derived_strategy",derived?.strategy_intelligence?.value,comparisonDerived?.strategy_intelligence?.value,false],
      ],
    },
    {
      label:"Technical & Mental",
      metrics:[
        ["ERS / Fuel","ers_fuel_management",attrs?.ers_fuel_management,comparisonAttrs?.ers_fuel_management,false],
        ["Technical Feedback","technical_feedback",attrs?.technical_feedback,comparisonAttrs?.technical_feedback,false],
        ["Development","car_development_impact",attrs?.car_development_impact,comparisonAttrs?.car_development_impact,false],
        ["Mentality","mentality",attrs?.mentality,comparisonAttrs?.mentality,false],
        ["Leadership","leadership",attrs?.leadership,comparisonAttrs?.leadership,false],
        ["Team Player","team_player",attrs?.team_player,comparisonAttrs?.team_player,false],
        ["Crash Likelihood","crash_likelihood",attrs?.crash_likelihood,comparisonAttrs?.crash_likelihood,true],
      ],
    },
  ];

  const compareBar=(field,left,right,inverse=false)=>{
    const leftShown=shownValue(knowledge,field,left,{kind:"attribute"});
    const rightShown=shownValue(comparisonKnowledge,field,right,{kind:"attribute"});
    if(leftShown?.sortValue==null||rightShown?.sortValue==null){
      return <div className="h-1.5 flex-1 rounded-full bg-white/10"/>;
    }
    const raw=(Number(leftShown.sortValue)-Number(rightShown.sortValue))*(inverse?-1:1);
    if(Math.abs(raw)<0.05){
      return <div className="relative h-1.5 flex-1 rounded-full bg-white/10"><span className="absolute left-1/2 top-0 h-1.5 w-px bg-slate-500"/></div>;
    }
    const width=Math.min(50,Math.max(3,Math.abs(raw)*2.5));
    const leftBetter=raw>0;
    return (
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <span className="absolute left-1/2 top-0 h-1.5 w-px bg-slate-600"/>
        <span
          className={`absolute top-0 h-1.5 rounded-full ${leftBetter?"bg-emerald-400":"bg-rose-400"}`}
          style={leftBetter?{right:"50%",width:`${width}%`}:{left:"50%",width:`${width}%`}}
        />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-[#12141c] p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="mr-2 min-w-[120px]">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Driver Knowledge</div>
              <div className="mt-0.5 text-xs text-slate-300">{knowledge?.label||"Unscouted"}</div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#171a23] px-2 py-1.5">
              <span className="text-[9px] uppercase tracking-wide text-slate-500">OVR</span>
              {renderValue(knowledge,"current_ability",attrs.current_ability,{kind:"ability",size:"text-base"})}
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#171a23] px-2 py-1.5">
              <span className="text-[9px] uppercase tracking-wide text-slate-500">Potential</span>
              {renderValue(knowledge,"potential_ability",attrs.potential_ability,{kind:"potential",size:"text-base"})}
            </div>
          </div>

          <div className="relative w-full lg:w-[250px]">
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



      {comparisonDriver && (
        <div className="rounded-xl border border-sky-400/20 bg-sky-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">Compare Drivers</div>
              <div className="mt-1 text-sm text-slate-300">{currentName} vs {comparisonName}</div>
              {compareMode==="performance"&&(
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
                  <span>
                    OVR&nbsp;
                    {renderComparisonValue("left",knowledge,"current_ability",attrs?.current_ability,comparisonKnowledge,comparisonAttrs?.current_ability,{kind:"ability"})}
                    <span className="mx-1 text-slate-600">vs</span>
                    {renderComparisonValue("right",comparisonKnowledge,"current_ability",comparisonAttrs?.current_ability,knowledge,attrs?.current_ability,{kind:"ability"})}
                  </span>
                  <span>
                    Potential&nbsp;
                    {renderComparisonValue("left",knowledge,"potential_ability",attrs?.potential_ability,comparisonKnowledge,comparisonAttrs?.potential_ability,{kind:"potential"})}
                    <span className="mx-1 text-slate-600">vs</span>
                    {renderComparisonValue("right",comparisonKnowledge,"potential_ability",comparisonAttrs?.potential_ability,knowledge,attrs?.potential_ability,{kind:"potential"})}
                  </span>
                </div>
              )}
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
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              {compactCompareSections.map((section)=>(
                <div key={section.label} className="rounded-lg border border-white/10 bg-[#11141c] p-2.5">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{section.label}</div>
                  <div className="space-y-0.5">
                    {section.metrics.map(([label,field,left,right,inverse])=>(
                      <div key={field} className="grid grid-cols-[minmax(88px,1fr)_34px_minmax(52px,.9fr)_34px] items-center gap-1.5 rounded px-1 py-1 text-[11px] hover:bg-white/[0.025]">
                        <span className="truncate text-slate-400" title={label}>{label}</span>
                        <span className="text-right">{renderComparisonValue("left",knowledge,field,left,comparisonKnowledge,right,{kind:"attribute",inverse})}</span>
                        {compareBar(field,left,right,inverse)}
                        <span className="text-right">{renderComparisonValue("right",comparisonKnowledge,field,right,knowledge,left,{kind:"attribute",inverse})}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="lg:col-span-3 flex flex-wrap items-center justify-between gap-2 px-1 pt-1 text-[10px] text-slate-500">
                <span>{currentName} left · {comparisonName} right</span>
                <span>Green = stronger · Red = weaker · lower Crash Likelihood is better</span>
              </div>
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

      <div className={`${comparisonDriver&&compareMode==="performance"?"hidden":""} grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6`}>
        {groups.map((group)=>{
          const rawGroupScore=driverAttributeGroupScore(attrs,group.key);
          const shownGroup=shownValue(knowledge,`group_${group.key}`,rawGroupScore,{kind:"attribute"});
          const comparisonGroupScore=driverAttributeGroupScore(comparisonAttrs,group.key);
          const shownComparisonGroup=shownValue(comparisonKnowledge,`group_${group.key}`,comparisonGroupScore,{kind:"attribute"});
          const behaviour=shownGroup.sortValue!=null
            ?driverAttributeGroupBehaviourForScore(group.key,shownGroup.sortValue)
            :null;
          return (
            <div key={group.key} className="min-w-0 rounded-xl border border-white/10 bg-[#12141c] p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400" title={group.description}>{group.label}</div>
                  <div className="mt-0.5 truncate text-[9px] text-slate-600">{group.attributes.map((attribute)=>attribute.label).join(" · ")}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[9px] uppercase tracking-wide text-slate-600">Average</div>
                  <div>{renderShown(shownGroup,{
                    size:"text-lg",
                    toneOverride:comparisonDriver?comparisonTone(shownGroup,shownComparisonGroup,{side:"left"}):null,
                  })}</div>
                  {comparisonDriver&&(
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      vs {renderShown(shownComparisonGroup,{toneOverride:comparisonTone(shownGroup,shownComparisonGroup,{side:"right"})})} · {differenceFor(`group_${group.key}`,rawGroupScore,comparisonGroupScore,{kind:"attribute"})}
                    </div>
                  )}
                </div>
              </div>

              <details className="mt-2 text-[10px] text-slate-500">
                <summary className="cursor-pointer select-none hover:text-slate-300">Behaviour note</summary>
                <div className="mt-1 rounded border border-white/5 bg-[#171a23] p-2 leading-4">
                  {behaviour?.text||"Scout the driver to understand how this group affects race behaviour."}
                </div>
              </details>

              <div className="mt-2 space-y-1">
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
                    <div key={field} className={`grid items-center gap-1.5 text-xs ${comparisonDriver?"grid-cols-[1fr_58px_58px_48px]":"grid-cols-[1fr_58px]"}`}>
                      <span className="text-slate-400">{attribute.label}</span>
                      <div className="text-right">
                        {comparisonDriver
                          ?renderComparisonValue("left",knowledge,field,left,comparisonKnowledge,right,{kind:"attribute",inverse:attribute.inverse})
                          :renderValue(knowledge,field,left,{kind:"attribute",inverse:attribute.inverse})}
                      </div>
                      {comparisonDriver&&(
                        <>
                          <div className="text-right">{renderComparisonValue("right",comparisonKnowledge,field,right,knowledge,left,{kind:"attribute",inverse:attribute.inverse})}</div>
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

      <div className={`${comparisonDriver&&compareMode==="performance"?"hidden":""} rounded-xl border border-white/10 bg-[#12141c] p-3`}>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Race Behaviour & Derived Ratings</div>
        <p className="text-xs text-slate-500">These ratings combine existing attributes; they are not separate database attributes.</p>

        <details className="mt-2 rounded-lg border border-white/10 bg-[#171a23] p-2.5">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-500">Wheel-to-wheel profile</summary>
          <div className="mt-1 text-xs text-slate-300">
            {wheelBehaviour?.text||"Scout the driver to assess attacking and defensive behaviour."}
          </div>
        </details>

        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
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
              <div key={key} className="rounded-lg border border-white/10 bg-[#171a23] p-2.5">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <div>{renderShown(shown,{
                    size:"text-lg",
                    toneOverride:comparisonDriver
                      ?comparisonTone(shown,shownValue(comparisonKnowledge,field,right,{kind:"attribute"}),{side:"left"})
                      :null,
                  })}</div>
                  {comparisonDriver&&(
                    <div className="text-right text-xs">
                      <div>{renderComparisonValue("right",comparisonKnowledge,field,right,knowledge,left,{kind:"attribute"})}</div>
                      <div className="mt-0.5">{differenceFor(field,left,right,{kind:"attribute"})}</div>
                    </div>
                  )}
                </div>
                <div className="mt-1 truncate text-[9px] text-slate-600" title={derivedText(key,shown)}>{derivedText(key,shown)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RelationshipsTab({ gameState, driverId }) {
  const [statusFilter,setStatusFilter]=useState("all");
  const [yearFilter,setYearFilter]=useState("all");
  const [showLegend,setShowLegend]=useState(false);
  const openEntity=useModalStore((state)=>state.open);

  const drivers=[...(gameState?.drivers||[]),...(gameState?.dbDrivers||[])];
  const teams=[...(gameState?.teams||[]),...(gameState?.dbTeams||[])];
  const staff=[...(gameState?.staffCore||[]),...(gameState?.dbStaffCore||[])];
  const subjectDriver=drivers.find((item)=>String(item?.driver_id??item?.id??"")===String(driverId))||null;
  const subjectName=subjectDriver?.display_name||subjectDriver?.name||[subjectDriver?.first_name,subjectDriver?.last_name].filter(Boolean).join(" ")||null;
  const activeYear=Number(gameState?.activeYear);
  const relationshipYear=(value)=>{
    const year=Number(value);
    return Number.isInteger(year)&&year>=1950?year:null;
  };

  const liveRecords=driverRelationshipRecords(gameState,driverId);
  const historicalRecords=historicalDriverRelationshipRecords(gameState,{
    driverId,
    driverName:subjectName,
  });
  const rivalries=driverRivalryRecords(gameState,driverId);
  const activeTeamId=liveRecords.find((record)=>record?.active&&record?.target_type==="team")?.target_id||null;
  const activeTeammateId=liveRecords.find((record)=>record?.active&&record?.target_type==="teammate")?.target_id||null;
  const consequenceProfile=driverRelationshipConsequenceProfile(gameState,driverId,{
    teamId:activeTeamId,
    teammateId:activeTeammateId,
  });
  const visibleRivalries=rivalries.filter((row)=>
    row?.active||
    Number(row?.collisions||0)>0||
    Number(row?.championship_battles||0)>0||
    Number(row?.close_battles||0)>=3
  );
  const visibleRivalryKeys=new Set(visibleRivalries.map((row)=>String(row?.pair_key||"")).filter(Boolean));

  const yearsForRecord=(record)=>{
    const values=new Set(
      (Array.isArray(record?.years)?record.years:[])
        .map(relationshipYear)
        .filter((year)=>year!==null)
    );
    for(const raw of [record?.created_at,record?.updated_at]){
      const year=relationshipYear(String(raw||"").slice(0,4));
      if(year!==null)values.add(year);
    }
    const currentYear=relationshipYear(activeYear);
    if(record?.active&&currentYear!==null)values.add(currentYear);
    return [...values].sort((a,b)=>a-b);
  };

  const merged=new Map();
  for(const record of historicalRecords){
    merged.set(String(record?.target_type)+"|"+String(record?.target_id),{
      ...record,
      years:yearsForRecord(record),
    });
  }
  for(const record of liveRecords){
    const key=String(record?.target_type)+"|"+String(record?.target_id);
    const historical=merged.get(key)||null;
    const years=new Set([
      ...(historical?.years||[]),
      ...yearsForRecord(record),
    ]);
    merged.set(key,{
      ...(historical||{}),
      ...record,
      target_name:record?.target_name||historical?.target_name||null,
      years:[...years].map(relationshipYear).filter((year)=>year!==null).sort((a,b)=>a-b),
      scores_known:true,
      historical_context:Boolean(historical),
    });
  }

  const allRecords=[...merged.values()].sort((a,b)=>
    Number(b?.active===true)-Number(a?.active===true)||
    Number((b?.years||[]).at(-1)||0)-Number((a?.years||[]).at(-1)||0)||
    Number(b?.score||0)-Number(a?.score||0)
  );
  const yearOptions=[...new Set(
    allRecords.flatMap((record)=>record?.years||[])
      .map(relationshipYear)
      .filter((year)=>year!==null)
  )].sort((a,b)=>b-a);
  const records=allRecords.filter((record)=>{
    if(statusFilter==="active"&&!record?.active)return false;
    if(statusFilter==="inactive"&&record?.active)return false;
    if(yearFilter!=="all"&&!(record?.years||[]).includes(Number(yearFilter)))return false;
    return true;
  });

  const manager=gameState?.manager||null;
  const managerName=managerDisplayName(manager);
  const targetMeta=(record)=>{
    const targetId=String(record?.target_id||"");
    if(record?.target_type==="teammate"||record?.target_type==="rival"){
      const matched=drivers.find((item)=>String(item?.driver_id??item?.id??"")===targetId)
        ||drivers.find((item)=>String(item?.display_name||item?.name||"").toLowerCase()===String(record?.target_name||"").toLowerCase())
        ||null;
      const row=matched||{driver_id:targetId,display_name:record?.target_name||targetId};
      const resolvedId=String(matched?.driver_id??matched?.id??"");
      return {
        name:row?.display_name||row?.name||[row?.first_name,row?.last_name].filter(Boolean).join(" ")||record?.target_name||targetId,
        visual:<DriverPortrait driver={row} size="h-9 w-9"/>,
        entity:resolvedId?{type:"driver",id:resolvedId}:null,
      };
    }
    if(record?.target_type==="team"){
      const row=teams.find((item)=>String(item?.team_id??item?.id??"")===targetId)||null;
      const name=row?.team_name||row?.name||row?.short_name||record?.target_name||targetId;
      const resolvedId=String(row?.team_id??row?.id??"");
      return {
        name,
        visual:<TeamLogo teamId={targetId} name={name} size="h-9 w-9" className="p-0.5"/>,
        entity:resolvedId?{type:"team",id:resolvedId}:null,
      };
    }
    if(record?.target_type==="manager"){
      return {
        name:managerName,
        visual:<StaffPortrait staff={{display_name:managerName,portrait_path:manager?.portrait_data_url||null}} size="h-9 w-9"/>,
        entity:null,
      };
    }
    const matched=staff.find((item)=>String(item?.staff_id??item?.person_id??item?.id??"")===targetId)||null;
    const row=matched||{staff_id:targetId,staff_name:record?.target_name||targetId};
    const resolvedId=String(matched?.staff_id??matched?.person_id??matched?.id??"");
    return {
      name:row?.display_name||row?.staff_name||row?.name||[row?.first_name,row?.last_name].filter(Boolean).join(" ")||record?.target_name||targetId,
      visual:<StaffPortrait staff={row} size="h-9 w-9"/>,
      entity:resolvedId?{type:"staff",id:resolvedId}:null,
    };
  };
  const typeLabel=(value)=>({
    teammate:"Team-mate",
    rival:"Rival",
    team:"Team",
    manager:"Manager",
    team_principal:"Team Principal",
    race_engineer:"Race Engineer",
  }[String(value)]||String(value||"Relationship").replaceAll("_"," "));

  const niceRole=(value)=>{
    const key=String(value||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
    if(!key)return "";
    if(/main|first|lead|driver_?1/.test(key))return "Main Driver";
    if(/second|driver_?2/.test(key))return "Second Driver";
    if(/reserve/.test(key))return "Reserve Driver";
    if(/test|tester/.test(key))return "Test Driver";
    return key.split("_").filter(Boolean).map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(" ");
  };
  const relationTone=(score)=>{
    if(score===null||score===undefined||score==="")return "text-slate-500";
    const value=Number(score);
    if(value>=65)return "text-emerald-300";
    if(value<45)return "text-rose-300";
    return "text-slate-200";
  };
  const rivalryTone=(value)=>{
    if(value===null||value===undefined||value==="")return "text-slate-500";
    const n=Number(value)||0;
    if(n>=60)return "text-rose-300";
    if(n>=35)return "text-amber-300";
    if(n>=15)return "text-sky-300";
    return "text-slate-400";
  };
  const metricTone=(short,value)=>{
    if(value===null||value===undefined||value==="")return "text-slate-600";
    if(short==="T")return "text-sky-300";
    if(short==="R")return "text-emerald-300";
    if(short==="A")return "text-violet-300";
    if(short==="S")return "text-amber-300";
    return rivalryTone(value);
  };
  const metricShort=(field)=>({
    trust:"T",
    respect:"R",
    affinity:"A",
    satisfaction:"S",
    rivalry:"Riv",
  }[String(field)]||String(field||"").slice(0,3));
  const metricValue=(value)=>value===null||value===undefined||value===""?"—":Number(value).toFixed(0);

  const performanceRows=Array.isArray(gameState?.driverPerformanceLog?.[String(driverId)])
    ?gameState.driverPerformanceLog[String(driverId)]
    :[];
  const h2hFor=(record)=>{
    if(record?.target_type!=="teammate"||record?.scores_known===false)return null;
    const rows=performanceRows.filter((row)=>String(row?.teammate_driver_id??"")===String(record?.target_id??""));
    const race=rows.map((row)=>Number(row?.teammate_race_delta)).filter(Number.isFinite);
    const quali=rows.map((row)=>Number(row?.teammate_qualifying_delta)).filter(Number.isFinite);
    const tally=(values)=>({
      wins:values.filter((value)=>value>0).length,
      losses:values.filter((value)=>value<0).length,
      ties:values.filter((value)=>value===0).length,
    });
    return {race:tally(race),quali:tally(quali),races:rows.length};
  };

  const logs=[
    ...(gameState?.driverRelationships?.log||[])
      .filter((entry)=>String(entry?.driver_id??"")===String(driverId)),
    ...driverRivalryEventLogForDriver(gameState,driverId)
      .filter((entry)=>visibleRivalryKeys.has(String(entry?.pair_key||""))),
  ]
    .sort((a,b)=>String(b?.dateISO||"").localeCompare(String(a?.dateISO||"")))
    .slice(0,12);

  if(!allRecords.length&&!visibleRivalries.length){
    return <div className="rounded-lg border border-white/10 bg-[#12141c] p-4 text-sm text-slate-400">No relationships have been established for this driver yet.</div>;
  }

  return <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
    <div className="space-y-2">
      {visibleRivalries.length?<section className="rounded-lg border border-white/10 bg-[#12141c] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Global Driver Rivalries</div>
            <div className="mt-0.5 text-[10px] text-slate-600">Persists across teams · separate from team-mate tension.</div>
          </div>
          <span className="text-[10px] text-slate-500">{visibleRivalries.filter((row)=>row.active).length} active</span>
        </div>
        <div className="mt-2 space-y-1.5">
          {visibleRivalries.map((rivalry)=>{
            const target=targetMeta(rivalry);
            const openTarget=target.entity?()=>openEntity({...target.entity,tab:"overview"}):null;
            const yearsLabel=formatRelationshipYears(rivalry?.years||[]);
            const counters=[
              Number(rivalry?.close_battles||0)>0?`${Number(rivalry.close_battles)} close battle${Number(rivalry.close_battles)===1?"":"s"}`:null,
              Number(rivalry?.collisions||0)>0?`${Number(rivalry.collisions)} collision${Number(rivalry.collisions)===1?"":"s"}`:null,
              Number(rivalry?.championship_battles||0)>0?`${Number(rivalry.championship_battles)} title-fight event${Number(rivalry.championship_battles)===1?"":"s"}`:null,
            ].filter(Boolean);
            return <div key={rivalry.pair_key||String(rivalry.driver_a_id)+"|"+String(rivalry.driver_b_id)} className="flex min-w-0 items-center gap-2.5 rounded-md border border-white/5 bg-[#0f1117] px-2.5 py-2">
              {openTarget?<button type="button" onClick={openTarget} className="shrink-0 rounded-full hover:ring-2 hover:ring-sky-400/30">{target.visual}</button>:<div className="shrink-0">{target.visual}</div>}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {openTarget?<button type="button" onClick={openTarget} className="truncate text-sm font-semibold text-slate-100 hover:text-sky-300 hover:underline">{target.name}</button>:<strong className="truncate text-sm text-slate-100">{target.name}</strong>}
                  <span className={"rounded px-1.5 py-0.5 text-[9px] capitalize "+(rivalry.active?"bg-rose-500/10 text-rose-300":"bg-white/5 text-slate-500")}>{rivalry.status||"emerging"}</span>
                  {yearsLabel?<span className="text-[9px] text-slate-600">{yearsLabel}</span>:null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
                  <span className={rivalryTone(rivalry.rivalry)}>Rivalry <strong>{Number(rivalry?.rivalry||0).toFixed(0)}</strong></span>
                  <span className="text-emerald-300">Respect <strong>{Number(rivalry?.respect??50).toFixed(0)}</strong></span>
                  {counters.length?<span className="text-slate-600">{counters.join(" · ")}</span>:null}
                </div>
              </div>
            </div>;
          })}
        </div>
      </section>:null}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-[#12141c] px-3 py-2">
        <div className="flex items-center gap-1">
          {[["all","All"],["active","Active"],["inactive","Inactive"]].map(([key,label])=><button
            key={key}
            type="button"
            onClick={()=>setStatusFilter(key)}
            className={"rounded px-2 py-1 text-[10px] font-medium "+(statusFilter===key?"bg-slate-100 text-slate-950":"bg-white/5 text-slate-400 hover:text-white")}
          >{label}</button>)}
        </div>
        <select value={yearFilter} onChange={(event)=>setYearFilter(event.target.value)} className="rounded border border-white/10 bg-[#171a23] px-2 py-1 text-[10px] text-slate-300">
          <option value="all">All years</option>
          {yearOptions.map((year)=><option key={year} value={year}>{year}</option>)}
        </select>
        <div className="flex-1"/>
        <button
          type="button"
          onClick={()=>setShowLegend((value)=>!value)}
          className={"inline-flex h-7 w-7 items-center justify-center rounded border text-slate-400 hover:text-white "+(showLegend?"border-sky-400/30 bg-sky-500/10":"border-white/10 bg-white/5")}
          aria-expanded={showLegend}
          title="Relationship metrics"
        ><Info size={13}/></button>
      </div>

      {showLegend?<div className="rounded-lg border border-sky-400/15 bg-sky-500/[0.04] px-3 py-2 text-[10px] text-slate-400">
        <span className="mr-3"><strong className="text-sky-300">T</strong> Trust</span>
        <span className="mr-3"><strong className="text-emerald-300">R</strong> Respect</span>
        <span className="mr-3"><strong className="text-violet-300">A</strong> Affinity</span>
        <span className="mr-3"><strong className="text-amber-300">S</strong> Satisfaction</span>
        <span><strong className="text-rose-300">Riv</strong> Rivalry</span>
        <div className="mt-1 text-slate-600">Historical database links establish who shared a team; pre-career relationship scores stay unknown until the Save World creates them.</div>
      </div>:null}

      {records.length?records.map((record)=>{
        const h2h=h2hFor(record);
        const target=targetMeta(record);
        const metrics=[
          ["T",record?.trust,"Trust"],
          ["R",record?.respect,"Respect"],
          ["A",record?.affinity,"Affinity"],
          ["S",record?.satisfaction,"Satisfaction"],
          ...(record?.target_type==="teammate"?[["Riv",record?.rivalry,"Rivalry"]]:[]),
        ];
        const expectedRole=niceRole(record?.expected_role);
        const currentRole=niceRole(record?.current_role);
        const showExpected=Boolean(expectedRole&&(!currentRole||expectedRole!==currentRole));
        const yearsLabel=formatRelationshipYears(record?.years||[]);
        const scoreKnown=record?.scores_known!==false&&record?.score!==null&&record?.score!==undefined;
        const openTarget=target.entity
          ?()=>openEntity({...target.entity,tab:"overview"})
          :null;
        return <div key={String(record?.driver_id)+"|"+String(record?.target_type)+"|"+String(record?.target_id)} className={"rounded-lg border px-3 py-2 "+(record?.active?"border-white/10 bg-[#12141c]":"border-white/5 bg-[#0f1117]")}>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="shrink-0">
              {openTarget?<button type="button" onClick={openTarget} className="rounded-full hover:ring-2 hover:ring-sky-400/30" title={"Open "+target.name}>{target.visual}</button>:target.visual}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[9px] uppercase tracking-[0.14em] text-slate-500">{typeLabel(record?.target_type)}</span>
                {openTarget
                  ?<button type="button" onClick={openTarget} className="truncate text-sm font-bold text-slate-100 hover:text-sky-300 hover:underline" title={"Open "+target.name}>{target.name}</button>
                  :<strong className="truncate text-sm text-slate-100">{target.name}</strong>}
                <span className={"rounded px-1.5 py-0.5 text-[9px] "+(record?.active?"bg-emerald-500/10 text-emerald-300":"bg-white/5 text-slate-500")}>{record?.active?"Active":"Inactive"}</span>
                {yearsLabel?<span className="text-[9px] text-slate-500">{yearsLabel}</span>:null}
                {showExpected?<span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-300">Expected role: {expectedRole}</span>:null}
              </div>
              {record?.active?<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                {metrics.map(([short,value,title])=><span key={short} title={title} className={metricTone(short,value)}><span className="opacity-70">{short}</span> <strong>{metricValue(value)}</strong></span>)}
                {h2h?<>
                  <span>Race <strong className="text-slate-300">{h2h.race.wins}-{h2h.race.losses}{h2h.race.ties?"-"+h2h.race.ties:""}</strong></span>
                  <span>Quali <strong className="text-slate-300">{h2h.quali.wins}-{h2h.quali.losses}{h2h.quali.ties?"-"+h2h.quali.ties:""}</strong></span>
                </>:null}
                {record?.target_type==="teammate"&&record?.rivalry!==null&&record?.rivalry!==undefined?<span className={"capitalize "+rivalryTone(record?.rivalry)}>{record?.rivalry_status||"low"} rivalry</span>:null}
              </div>:null}
            </div>
            {record?.active?<div className="shrink-0 text-right">
              <div className={"text-xl font-bold leading-none "+relationTone(record?.score)}>{scoreKnown?Number(record.score).toFixed(0):"—"}</div>
              <div className="mt-0.5 text-[9px] capitalize text-slate-600">{scoreKnown?(record?.status||"neutral"):"Neutral"}</div>
            </div>:null}
          </div>
        </div>;
      }):<div className="rounded-lg border border-white/10 bg-[#12141c] p-4 text-xs text-slate-500">No relationships match the selected filters.</div>}
    </div>

    <aside className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-[#12141c] p-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Gameplay Consequences</div>
        <div className="mt-1 text-[10px] leading-4 text-slate-600">Relationships affect temporary state and cooperation, never base ability or raw car pace.</div>
        <div className="mt-2 space-y-1.5 text-[10px]">
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Team climate</span><strong className={relationTone(consequenceProfile?.climate?.score)}>{Number(consequenceProfile?.climate?.score??50).toFixed(0)} · {consequenceProfile?.climate?.label||"Stable"}</strong></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Race morale</span><strong className={Number(consequenceProfile?.race_morale_delta||0)>0?"text-emerald-300":Number(consequenceProfile?.race_morale_delta||0)<0?"text-rose-300":"text-slate-400"}>{Number(consequenceProfile?.race_morale_delta||0)>=0?"+":""}{Number(consequenceProfile?.race_morale_delta||0).toFixed(2)} / GP</strong></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Engineer setup</span><strong className={consequenceProfile?.engineer?.known?(Number(consequenceProfile.engineer.multiplier)>=1?"text-emerald-300":"text-rose-300"):"text-slate-500"}>{consequenceProfile?.engineer?.known?`×${Number(consequenceProfile.engineer.multiplier).toFixed(2)}`:"No data"}</strong></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Renewal acceptance</span><strong className={Number(consequenceProfile?.renewal_acceptance_delta||0)>0?"text-emerald-300":Number(consequenceProfile?.renewal_acceptance_delta||0)<0?"text-rose-300":"text-slate-400"}>{Number(consequenceProfile?.renewal_acceptance_delta||0)>=0?"+":""}{(Number(consequenceProfile?.renewal_acceptance_delta||0)*100).toFixed(0)} pp</strong></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Team-order cooperation</span><strong className={consequenceProfile?.team_order?.at_risk?"text-amber-300":"text-slate-300"}>{consequenceProfile?.team_order?`${Math.round(Number(consequenceProfile.team_order.probability||1)*100)}% · ${consequenceProfile.team_order.label}`:"—"}</strong></div>
          {consequenceProfile?.strongest_rival?<div className="flex items-center justify-between gap-3"><span className="text-slate-500">Rival pressure</span><strong className="text-amber-300">±{Number(consequenceProfile?.rival_confidence_swing||0).toFixed(2)} Confidence</strong></div>:null}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#12141c] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Recent Events</div>
      <div className="mt-2 space-y-1.5">
        {logs.length?logs.map((entry,index)=>{
          const eventTarget=targetMeta(entry);
          return <div key={entry?.id||index} className="border-b border-white/5 pb-1.5 last:border-0 last:pb-0">
            <div className="flex items-center justify-between gap-2 text-[9px] text-slate-600">
              <span>{entry?.dateISO||"—"}</span>
              <span className="capitalize">{String(entry?.source||"event").replaceAll("_"," ")}</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] font-medium text-slate-300" title={entry?.reason||"Relationship changed"}>{entry?.reason||"Relationship changed"}</div>
            <div className="mt-0.5 truncate text-[9px] text-slate-500">{typeLabel(entry?.target_type)} · {eventTarget.name}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
              {(entry?.changes||[]).map((change)=>{
                const delta=Number(change?.delta||0);
                const short=metricShort(change?.field);
                return <span key={change?.field} className={"text-[9px] "+metricTone(short,change?.after)}>{short} {delta>0?"+":""}{delta.toFixed(1)}</span>;
              })}
            </div>
          </div>;
        }):<div className="text-xs text-slate-500">No relationship-changing events yet.</div>}
      </div>
      </div>
    </aside>
  </div>;
}

function FormTab({ form, items, gameState }) {
  const years=Array.from(new Set((items||[]).map((row)=>Number(row?.year)).filter(Number.isFinite))).sort((a,b)=>b-a);
  const [year,setYear]=useState("All");
  const filtered=year==="All"?(items||[]):(items||[]).filter((row)=>Number(row?.year)===Number(year));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-white/10 bg-[#12141c] p-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Driver Form</div>
          <div className="mt-1 text-sm text-slate-300">Race-by-race performance versus car expectation, qualifying, team-mate and incident responsibility.</div>
        </div>
        <div className="flex items-end gap-3">
          <label className="text-xs text-slate-400">
            Season
            <select value={year} onChange={(e)=>setYear(e.target.value)} className="ml-2 rounded-md border border-white/10 bg-[#171a23] px-2 py-1.5 text-slate-200">
              <option value="All">All</option>
              {years.map((y)=><option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <div className="rounded-lg border border-white/10 bg-[#171a23] px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Current Form</div>
            <div className={`text-lg font-semibold ${Number(form?.score)>=76?"text-emerald-300":Number(form?.score)<58?"text-rose-300":"text-slate-200"}`}>
              {form?.score!=null?`${Number(form.score).toFixed(1)} · ${form.label}`:"—"}
            </div>
          </div>
        </div>
      </div>
      <PerformanceHistory items={filtered} gameState={gameState} />
    </div>
  );
}

function PerformanceHistory({ items, gameState }) {
  const rows=(items||[]);
  if(!rows.length){
    return <p className="text-slate-500 text-sm">No played-race performance evaluations yet.</p>;
  }
  const deltaTone=(value)=>{
    if(value===null||value===undefined||value==="")return "text-slate-500";
    const n=Number(value);
    if(!Number.isFinite(n)||Math.abs(n)<0.05)return "text-slate-500";
    return n>0?"text-emerald-300":"text-rose-300";
  };
  const deltaLabel=(value,digits=1)=>{
    if(value===null||value===undefined||value==="")return "—";
    const n=Number(value);
    if(!Number.isFinite(n))return "—";
    return `${n>0?"+":""}${n.toFixed(digits)}`;
  };
  const resultLabel=(row)=>{
    if(row?.retired)return row?.retirement_reason?`DNF · ${row.retirement_reason}`:"DNF";
    return row?.finish_position!=null?`P${row.finish_position}`:"—";
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#12141c]">
      <table className="min-w-[980px] w-full text-xs">
        <thead className="bg-[#171a23] text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Season</th>
            <th className="px-3 py-2 text-left">Grand Prix</th>
            <th className="px-3 py-2 text-right">Quali</th>
            <th className="px-3 py-2 text-right">Grid</th>
            <th className="px-3 py-2 text-right">Result</th>
            <th className="px-3 py-2 text-right">Expected</th>
            <th className="px-3 py-2 text-right">Δ Exp.</th>
            <th className="px-3 py-2 text-right">Race vs TM</th>
            <th className="px-3 py-2 text-right">Quali vs TM</th>
            <th className="px-3 py-2 text-right">Eval.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row,index)=>{
            const score=Number(row?.score);
            const factorTitle=(row?.factors||[]).map((factor)=>factor.message).filter(Boolean).join(" · ");
            return (
              <tr key={`${row?.year||"year"}-${row?.round||index}-${row?.gp_id||row?.gp_name||index}`} className="border-t border-white/10 hover:bg-white/[0.025]">
                <td className="px-3 py-2 text-slate-500">{row?.year||"—"}</td>
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-1.5 font-medium text-slate-200" title={factorTitle||undefined}>
                    <GrandPrixFlag gameState={gameState} record={row} size="sm"/>
                    <span className="truncate">{row?.gp_name||`Round ${row?.round||"—"}`}</span>
                  </div>
                  {row?.round&&<div className="mt-0.5 text-[9px] text-slate-600">Round {row.round}</div>}
                </td>
                <td className="px-3 py-2 text-right text-slate-300">{row?.qualifying_position!=null?`P${row.qualifying_position}`:"—"}</td>
                <td className="px-3 py-2 text-right text-slate-300">{row?.grid_position!=null?`P${row.grid_position}`:"—"}</td>
                <td className={`px-3 py-2 text-right font-medium ${row?.retired?"text-rose-300":Number(row?.finish_position)<=3?"text-emerald-300":"text-slate-200"}`}>
                  {resultLabel(row)}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">{Number.isFinite(Number(row?.expected_finish))?`P${Number(row.expected_finish).toFixed(1)}`:"—"}</td>
                <td className={`px-3 py-2 text-right font-medium ${deltaTone(row?.expectation_delta)}`}>{deltaLabel(row?.expectation_delta,1)}</td>
                <td className={`px-3 py-2 text-right font-medium ${deltaTone(row?.teammate_race_delta)}`}>{deltaLabel(row?.teammate_race_delta,0)}</td>
                <td className={`px-3 py-2 text-right font-medium ${deltaTone(row?.teammate_qualifying_delta)}`}>{deltaLabel(row?.teammate_qualifying_delta,0)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${score>=76?"text-emerald-300":score<58?"text-rose-300":"text-sky-300"}`}>
                  {Number.isFinite(score)?score.toFixed(1):"—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-white/10 px-3 py-2 text-[10px] text-slate-600">
        Positive deltas mean the driver beat the car expectation or team-mate. Hover a Grand Prix for the evaluation factors.
      </div>
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
            <th className="text-left pr-2 py-1">Year</th>
            <th className="text-left pr-2 py-1">Achievement</th>
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
                  <span data-entity="team" data-id={unbox(a.team_id)} className="entity-link-team inline-flex items-center gap-2">
                    <TeamLogo teamId={String(unbox(a.team_id))} name={displayValue(a.team_name ?? a.team_id)} size="h-6 w-6"/>
                    <span>{displayValue(a.team_name ?? a.team_id)}</span>
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
