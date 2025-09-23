// src/pages/NewGame.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore";

/* ---------- helpers ---------- */
const ERA_DECADES = ["1950s","1960s","1970s","1980s","1990s","2000s","2010s","2020s"];

const eraToRange = (era) => {
  const m1=/^(\d{4})s$/.exec(era); const m2=/^(\d{2})s$/.exec(era); const m3=/^(\d{4})\s*-\s*(\d{4})$/.exec(era);
  if(m1){const s=+m1[1]; return [s,s+9];}
  if(m2){const d=+m2[1]; const s=d+(d<=30?2000:1900); return [s,s+9];}
  if(m3){const a=+m3[1],b=+m3[2]; return [Math.min(a,b),Math.max(a,b)];}
  return [1900,2100];
};
const pick = (obj, keys, fb=undefined) => { for (const k of keys){ if(obj && obj[k]!=null && obj[k]!=="") return obj[k]; } return fb; };
const canon = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g,"").trim();
const getTeamId = (t) => String(pick(t, ["team_id","id","name","team_name","short_name"], JSON.stringify(t)));
const sameTeam = (rec, team) => {
  const recId = pick(rec, ["team_id","team","constructor_id","constructor","name","team_name","short_name"]);
  if (recId != null && getTeamId(team) === String(recId)) return true;
  const rn = pick(rec, ["team_name","constructor","name","team","short_name"]);
  const tn = pick(team, ["name","team_name","short_name"]);
  return rn && tn && canon(rn) === canon(tn);
};

/** Garante string segura para JSX */
function safeText(v, fallback = "—") {
  if (v == null) return fallback;
  if (typeof v === "string" || typeof v === "number") return String(v);
  // tenta .message (erros), depois toString, senão JSON
  return String(v?.message ?? (typeof v?.toString === "function" ? v.toString() : JSON.stringify(v)));
}

/* Pequeno avatar fallback (iniciais) */
function FallbackAvatar({ title }) {
  const initials = String(title || "?")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center text-xs font-bold">
      {initials}
    </div>
  );
}

/* Componente de Logo com fallback */
function TeamLogo({ candidates, title }) {
  const [src, setSrc] = useState(Array.isArray(candidates) && candidates.length ? candidates[0] : "");
  const [failedIdx, setFailedIdx] = useState(0);

  if (!src) return <FallbackAvatar title={safeText(title, "?")} />;

  return (
    <img
      src={src}
      alt={safeText(title, "Team")}
      className="w-8 h-8 rounded-md object-contain bg-white/5"
      onError={() => {
        const next = failedIdx + 1;
        if (Array.isArray(candidates) && next < candidates.length) {
          setFailedIdx(next);
          setSrc(candidates[next]);
        } else {
          setSrc(""); // força fallback de iniciais
        }
      }}
    />
  );
}

/* ---------- componente ---------- */
export default function NewGame() {
  const navigate = useNavigate();
  const {
    gameState,
    loadData,
    applyYearFilter,
    startNewGame,
    saveLocal,
    getTeamDisplayName,
    getTeamLogoCandidates,
  } = useGame();

  const [step, setStep] = useState(0);
  const [era, setEra] = useState("1980s");
  const [year, setYear] = useState(String(gameState?.activeYear ?? 1980));
  const [teamId, setTeamId] = useState("");
  const [difficulty, setDifficulty] = useState("Normal");

  // bootstrap data
  useEffect(() => {
    if (!gameState?.dbDrivers?.length || !gameState?.dbCalendar?.length || !gameState?.dbTeams?.length) {
      loadData();
    }
  }, [gameState?.dbDrivers?.length, gameState?.dbCalendar?.length, gameState?.dbTeams?.length, loadData]);

  // usar yearsAvailable do store (calculado no loadData)
  const allYears = useMemo(() => {
    const ys = gameState?.yearsAvailable || [];
    if (Array.isArray(ys) && ys.length) return ys.map(String);
    return ["1980"];
  }, [gameState?.yearsAvailable]);

  const eraYears = useMemo(() => {
    const [a,b] = eraToRange(era);
    const list = (allYears || []).filter((y) => (+y)>=a && (+y)<=b);
    return list.length ? list : allYears;
  }, [allYears, era]);

  // quando muda a era, garantir que o ano está dentro do range e aplicar slice
  useEffect(() => {
    if (Array.isArray(eraYears) && eraYears.length) {
      if (!eraYears.includes(year)) {
        setYear(eraYears[0]);
        applyYearFilter(+eraYears[0]);
        setTeamId("");
      } else {
        applyYearFilter(+year);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eraYears.length, era]);

  const pickYear = (y) => { setYear(String(y)); applyYearFilter(+y); setTeamId(""); };

  // listas filtradas (já em snapshot)
  const teamsForYear = Array.isArray(gameState?.teams) ? gameState.teams : [];
  const contracts = Array.isArray(gameState?.contracts) ? gameState.contracts : [];
  const gpCount = Array.isArray(gameState?.calendar) ? gameState.calendar.length : 0;
  const driverCount = Array.isArray(gameState?.drivers) ? gameState.drivers.length : 0;

  const isLoading = !Array.isArray(gameState?.dbCalendar) || !gameState.dbCalendar.length
                 || !Array.isArray(gameState?.dbTeams) || !gameState.dbTeams.length
                 || !(allYears && allYears.length);

  const canNext = useMemo(() => {
    if (step === 0) return !!era;
    if (step === 1) return !!year && eraYears.includes(year);
    if (step === 2) return !!teamId;
    if (step === 3) return !!difficulty;
    return true;
  }, [step, era, year, teamId, difficulty, eraYears]);

  const goNext = () => setStep((s) => Math.min(s + 1, 3));
  const goPrev = () => setStep((s) => Math.max(s - 1, 0));

  const handleFinish = () => {
    if (teamId === "create") { navigate("/CreateTeam", { state: { era, year, difficulty } }); return; }
    const team = teamsForYear.find((t) => getTeamId(t) === teamId) ?? null;
    startNewGame({ era, year: +year, team, difficulty });
    saveLocal();
    navigate("/Home");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">New Game</h1>

        {/* crumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <StepDot active={step >= 0} label="CHOOSE ERA" /><span className="opacity-40">/</span>
          <StepDot active={step >= 1} label="CHOOSE YEAR" /><span className="opacity-40">/</span>
          <StepDot active={step >= 2} label="CHOOSE TEAM" /><span className="opacity-40">/</span>
          <StepDot active={step >= 3} label="DIFFICULTY" />
        </div>

        <div className="rounded-2xl bg-white/5 border border-white/10 p-6">
          {isLoading ? (
            <div className="py-10 text-center opacity-80">Loading dataset…</div>
          ) : (
            <>
              {step === 0 && (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold mb-2">Choose Era</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {ERA_DECADES.map((label) => {
                      const [a,b]=eraToRange(label); const selected=era===label;
                      return (
                        <button key={label} onClick={()=>setEra(label)}
                          className={`p-4 rounded-xl border text-left ${selected?"border-emerald-400 bg-emerald-400/10":"border-white/10 hover:border-white/30"}`}>
                          <div className="font-medium">{label}</div>
                          <div className="text-xs opacity-70">{a}–{b}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold mb-2">Choose Year</h2>
                  <div className="flex flex-wrap gap-2">
                    {Array.isArray(eraYears) && eraYears.map((y) => {
                      const selected = year === y;
                      return (
                        <button key={y} onClick={() => pickYear(y)}
                          className={`px-3 py-2 rounded-lg border text-sm ${selected?"border-emerald-400 bg-emerald-400/10":"border-white/10 hover:border-white/30"}`}>
                          {y}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs opacity-70">
                    Dataset for {safeText(year)}: {safeText(gpCount)} GPs · {safeText(teamsForYear.length)} teams · {safeText(driverCount)} drivers (hidden excluded).
                  </p>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold mb-2">Choose Team</h2>

                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* Create team */}
                    <button
                      onClick={() => setTeamId("create")}
                      className={`p-4 rounded-xl border text-left ${
                        teamId === "create" ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <div className="font-medium text-lg">Create New Team</div>
                      <div className="text-xs opacity-70">Start as a brand-new privateer entry</div>
                    </button>

                    {/* Existing teams */}
                    {Array.isArray(teamsForYear) && teamsForYear.map((t) => {
                      const id = getTeamId(t);
                      const selected = teamId === id;

                      const engineRec = Array.isArray(gameState?.teamEngines) ? gameState.teamEngines.find((e) => sameTeam(e, t)) : null;
                      const engineName = safeText(pick(engineRec, ["engine_name","name","engine","power_unit"], "—"));

                      const rawTitle = typeof getTeamDisplayName === "function"
                        ? getTeamDisplayName(t)
                        : pick(t, ["official_name","team_name","name","short_name"], id);
                      const title = safeText(rawTitle, id);

                      const base = safeText(pick(t, ["team_base", "base", "country", "nation", "location"], "—"));

                      const driverContracts = (contracts || []).filter(
                        (c) => sameTeam(c, t) && /driver/i.test(String(pick(c,["role","position"], "")))
                      );
                      const driverNames = driverContracts
                        .map((c) => pick(c, ["driver_name","name","full_name","short_name"], null))
                        .filter(Boolean)
                        .map((n) => safeText(n));
                      const driversText =
                        driverNames.length === 0
                          ? "—"
                          : driverNames.length <= 2
                          ? driverNames.join(", ")
                          : `${driverNames.slice(0,2).join(", ")} +${driverNames.length - 2}`;

                      const logoCandidates = typeof getTeamLogoCandidates === "function"
                        ? getTeamLogoCandidates(t)
                        : [`/logos/teams/${id}.png`];

                      return (
                        <button
                          key={id}
                          onClick={() => setTeamId(id)}
                          className={`p-4 rounded-xl border text-left ${
                            selected ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <TeamLogo candidates={logoCandidates} title={title} />
                            <div className="font-medium text-lg">{title}</div>
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs opacity-80">
                            <div><span className="opacity-60">Base:</span> {base}</div>
                            <div><span className="opacity-60">Engine:</span> {engineName}</div>
                            <div className="col-span-2"><span className="opacity-60">Drivers:</span> {driversText}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold mb-2">Choose Difficulty</h2>
                  <div className="flex flex-wrap gap-2">
                    {["Easy","Normal","Hard"].map((d) => {
                      const selected = difficulty === d;
                      return (
                        <button key={d} onClick={() => setDifficulty(d)}
                          className={`px-3 py-2 rounded-lg border text-sm ${selected?"border-emerald-400 bg-emerald-400/10":"border-white/10 hover:border-white/30"}`}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* footer */}
        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/20 hover:border-white/40">
              Main Menu
            </button>
            <button onClick={goPrev} disabled={step===0}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border ${
                step===0 ? "border-white/10 text-white/40 cursor-not-allowed":"border-white/20 hover:border-white/40"
              }`}>
              Back
            </button>
          </div>

          {step < 3 ? (
            <button onClick={goNext} disabled={!canNext || isLoading}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${
                canNext && !isLoading ? "bg-emerald-500 hover:bg-emerald-600":"bg-emerald-500/40 cursor-not-allowed"
              } text-white`}>
              Next
            </button>
          ) : (
            <button onClick={handleFinish} disabled={!canNext || isLoading}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${
                canNext && !isLoading ? "bg-emerald-500 hover:bg-emerald-600":"bg-emerald-500/40 cursor-not-allowed"
              } text-white`}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepDot({ active, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-400" : "bg-white/30"}`} />
      <span className={`uppercase tracking-wide ${active ? "text-white" : "text-white/60"}`}>{label}</span>
    </div>
  );
}
