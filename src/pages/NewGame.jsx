import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore";

const ERA_DECADES = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];

const eraToRange = (era) => {
  const m1 = /^(\d{4})s$/.exec(era);
  const m2 = /^(\d{2})s$/.exec(era);
  const m3 = /^(\d{4})\s*-\s*(\d{4})$/.exec(era);
  if (m1) { const s = +m1[1]; return [s, s + 9]; }
  if (m2) { const d = +m2[1]; const s = d + (d <= 30 ? 2000 : 1900); return [s, s + 9]; }
  if (m3) { const a = +m3[1], b = +m3[2]; return [Math.min(a, b), Math.max(a, b)]; }
  return [1900, 2100];
};

const pick = (obj, keys, fb = undefined) => {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  return fb;
};
const canon = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
const getTeamId = (t) => String(pick(t, ["team_id", "id", "name", "team_name", "short_name"], JSON.stringify(t)));
const sameTeam = (rec, team) => {
  const recId = pick(rec, ["team_id", "team", "constructor_id", "constructor", "name", "team_name", "short_name"]);
  if (recId != null && getTeamId(team) === String(recId)) return true;
  const rn = pick(rec, ["team_name", "constructor", "name", "team", "short_name"]);
  const tn = pick(team, ["name", "team_name", "short_name"]);
  return rn && tn && canon(rn) === canon(tn);
};

function safeText(v, fallback = "—") {
  if (v == null) return fallback;
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v?.text === "string") return v.text;
  if (v?.result != null) return String(v.result);
  if (v?.value != null && typeof v.value !== "object") return String(v.value);
  try { return JSON.stringify(v); } catch { return fallback; }
}

function FallbackAvatar({ title }) {
  const initials = String(title || "?").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center text-xs font-bold">{initials}</div>;
}

function TeamLogo({ candidates, title }) {
  const [failedIdx, setFailedIdx] = useState(0);
  const src = Array.isArray(candidates) ? candidates[failedIdx] : null;
  if (!src) return <FallbackAvatar title={title} />;
  return (
    <img
      src={src}
      alt={safeText(title, "Team")}
      className="w-8 h-8 rounded-md object-contain bg-white/5"
      onError={() => setFailedIdx((i) => i + 1)}
    />
  );
}

const FRESH_CAREER_PATCH = {
  results: [],
  lastRace: null,
  financeFlags: {},
  rdProjectsActive: [],
  meta: {},
  ops: {},
  selectedDrivers: [],
  _seasonFinishedAt: null,
  showSeasonSummary: false,
};

export default function NewGame() {
  const navigate = useNavigate();
  const {
    gameState,
    applyYearFilter,
    startNewGame,
    setGameState,
    saveLocal,
    getTeamDisplayName,
    getTeamLogoCandidates,
  } = useGame();

  const [step, setStep] = useState(0);
  const [era, setEra] = useState("1980s");
  const [year, setYear] = useState(String(gameState?.activeYear ?? 1980));
  const [teamId, setTeamId] = useState("");
  const [difficulty, setDifficulty] = useState("Normal");

  const allYears = useMemo(() => {
    const ys = gameState?.yearsAvailable || [];
    return Array.isArray(ys) && ys.length ? ys.map(String) : ["1980"];
  }, [gameState?.yearsAvailable]);

  const eraYears = useMemo(() => {
    const [a, b] = eraToRange(era);
    const list = allYears.filter((y) => +y >= a && +y <= b);
    return list.length ? list : allYears;
  }, [allYears, era]);

  useEffect(() => {
    if (!eraYears.length) return;
    const target = eraYears.includes(year) ? year : eraYears[0];
    if (target !== year) setYear(target);
    applyYearFilter(+target);
    setTeamId("");
  }, [era, eraYears.join("|"), applyYearFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickYear = (y) => {
    setYear(String(y));
    applyYearFilter(+y);
    setTeamId("");
  };

  const teamsForYear = Array.isArray(gameState?.teams) ? gameState.teams : [];
  const contracts = Array.isArray(gameState?.contracts) ? gameState.contracts : [];
  const gpCount = Array.isArray(gameState?.calendar) ? gameState.calendar.length : 0;
  const driverCount = Array.isArray(gameState?.drivers) ? gameState.drivers.length : 0;
  const isLoading = !gameState?.dbCalendar?.length || !gameState?.dbTeams?.length || !gameState?.dbDrivers?.length;

  const canNext = step === 0 ? !!era : step === 1 ? !!year && eraYears.includes(year) : step === 2 ? !!teamId : !!difficulty;

  const handleFinish = () => {
    if (teamId === "create") {
      navigate("/CreateTeam", { state: { era, year, difficulty } });
      return;
    }
    const team = teamsForYear.find((t) => getTeamId(t) === teamId) ?? null;
    startNewGame({ era, year: +year, team, difficulty });
    setGameState(FRESH_CAREER_PATCH);
    saveLocal();
    navigate("/Home");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">New Game</h1>

        <div className="flex items-center gap-2 text-sm mb-6">
          <StepDot active={step >= 0} label="CHOOSE ERA" /><span className="opacity-40">/</span>
          <StepDot active={step >= 1} label="CHOOSE YEAR" /><span className="opacity-40">/</span>
          <StepDot active={step >= 2} label="CHOOSE TEAM" /><span className="opacity-40">/</span>
          <StepDot active={step >= 3} label="DIFFICULTY" />
        </div>

        <div className="rounded-2xl bg-white/5 border border-white/10 p-6">
          {isLoading ? <div className="py-10 text-center opacity-80">Loading dataset…</div> : (
            <>
              {step === 0 && (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold">Choose Era</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {ERA_DECADES.map((label) => {
                      const [a, b] = eraToRange(label);
                      const selected = era === label;
                      return (
                        <button key={label} onClick={() => setEra(label)} className={`p-4 rounded-xl border text-left ${selected ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30"}`}>
                          <div className="font-medium">{label}</div><div className="text-xs opacity-70">{a}–{b}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold">Choose Year</h2>
                  <div className="flex flex-wrap gap-2">
                    {eraYears.map((y) => (
                      <button key={y} onClick={() => pickYear(y)} className={`px-3 py-2 rounded-lg border text-sm ${year === y ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30"}`}>{y}</button>
                    ))}
                  </div>
                  <p className="text-xs opacity-70">Dataset for {safeText(year)}: {gpCount} GPs · {teamsForYear.length} teams · {driverCount} drivers.</p>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold">Choose Team</h2>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <button onClick={() => setTeamId("create")} className={`p-4 rounded-xl border text-left ${teamId === "create" ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30"}`}>
                      <div className="font-medium text-lg">Create New Team</div><div className="text-xs opacity-70">Start as a brand-new privateer entry</div>
                    </button>
                    {teamsForYear.map((t) => {
                      const id = getTeamId(t);
                      const engineRec = gameState?.teamEngines?.find?.((e) => sameTeam(e, t));
                      const title = safeText(getTeamDisplayName?.(t) ?? pick(t, ["team_name", "name", "short_name"], id), id);
                      const driverNames = contracts.filter((c) => sameTeam(c, t) && /driver/i.test(String(pick(c, ["role", "position"], ""))))
                        .map((c) => safeText(pick(c, ["driver_name", "name", "full_name"], ""))).filter(Boolean);
                      return (
                        <button key={id} onClick={() => setTeamId(id)} className={`p-4 rounded-xl border text-left ${teamId === id ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30"}`}>
                          <div className="flex items-center gap-3"><TeamLogo candidates={getTeamLogoCandidates?.(t) || []} title={title} /><div className="font-medium text-lg">{title}</div></div>
                          <div className="mt-2 text-xs opacity-80 space-y-1">
                            <div>Base: {safeText(pick(t, ["team_base", "base", "country", "location"], "—"))}</div>
                            <div>Engine: {safeText(pick(engineRec, ["engine_name", "name", "engine"], "—"))}</div>
                            <div>Drivers: {driverNames.length ? driverNames.slice(0, 2).join(", ") : "—"}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold">Choose Difficulty</h2>
                  <div className="flex gap-2">{["Easy", "Normal", "Hard"].map((d) => <button key={d} onClick={() => setDifficulty(d)} className={`px-3 py-2 rounded-lg border text-sm ${difficulty === d ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30"}`}>{d}</button>)}</div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-2">
            <button onClick={() => navigate("/")} className="px-4 py-2 rounded-lg border border-white/20 hover:border-white/40">Main Menu</button>
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="px-4 py-2 rounded-lg border border-white/20 disabled:opacity-40">Back</button>
          </div>
          {step < 3 ? (
            <button onClick={() => setStep((s) => Math.min(3, s + 1))} disabled={!canNext || isLoading} className="px-4 py-2 rounded-lg bg-emerald-500 disabled:opacity-40">Next</button>
          ) : (
            <button onClick={handleFinish} disabled={!canNext || isLoading} className="px-4 py-2 rounded-lg bg-emerald-500 disabled:opacity-40">Continue</button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepDot({ active, label }) {
  return <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-400" : "bg-white/30"}`} /><span className={`uppercase tracking-wide ${active ? "text-white" : "text-white/60"}`}>{label}</span></div>;
}
