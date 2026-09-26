import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore";
import { DriverPortrait } from "../components/entity/EntityVisuals.jsx";
import { newGameTeamPreview } from "../domain/newGameTeamPreview.js";
import {
  deleteManagerProfile,
  readManagerProfileStore,
  rememberLastUsedManagerProfile,
  saveManagerProfile,
} from "../domain/managerProfileStorage.js";
import {
  MANAGER_ATTRIBUTES,
  MANAGER_BACKGROUNDS,
  MANAGER_EXPERIENCE_LEVELS,
  createManagerProfile,
  managerAge,
  managerBackground,
  managerExperience,
} from "../domain/managerProfile.js";

const ERA_DECADES = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];
const STEP_LABELS=["CHOOSE ERA","CHOOSE YEAR","CREATE MANAGER","CHOOSE TEAM","DIFFICULTY","REVIEW"];

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
const getTeamId = (t) => String(pick(t, ["team_id", "id", "name", "team_name", "short_name"], JSON.stringify(t)));

function safeText(v, fallback = "—") {
  if (v == null) return fallback;
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v?.text === "string") return v.text;
  if (v?.result != null) return String(v.result);
  if (v?.value != null && typeof v.value !== "object") return String(v.value);
  try { return JSON.stringify(v); } catch { return fallback; }
}

function fmtMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function FallbackAvatar({ title, large=false }) {
  const initials = String(title || "?").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return <div className={(large?"w-20 h-20 rounded-2xl text-xl":"w-8 h-8 rounded-md text-xs")+" bg-white/10 flex items-center justify-center font-bold"}>{initials}</div>;
}

function TeamLogo({ candidates, title, large=false }) {
  const [failedIdx, setFailedIdx] = useState(0);
  const src = Array.isArray(candidates) ? candidates[failedIdx] : null;
  if (!src) return <FallbackAvatar title={title} large={large} />;
  return (
    <img
      src={src}
      alt={safeText(title, "Team")}
      className={(large?"w-20 h-20 rounded-2xl":"w-8 h-8 rounded-md")+" object-contain bg-white/5"}
      onError={() => setFailedIdx((i) => i + 1)}
    />
  );
}

function ManagerPortrait({manager,size="large"}){
  const name=(String(manager?.first_name||"")+" "+String(manager?.last_name||"")).trim()||"Team Manager";
  const large=size==="large";
  if(manager?.portrait_data_url){
    return <img src={manager.portrait_data_url} alt={name} className={(large?"w-24 h-24 rounded-2xl":"w-12 h-12 rounded-xl")+" object-cover border border-white/10 bg-white/5"}/>;
  }
  return <FallbackAvatar title={name} large={large}/>;
}

function readManagerPortrait(file){
  return new Promise((resolve,reject)=>{
    if(!file){resolve({dataUrl:null,fileName:null});return;}
    if(!String(file.type||"").startsWith("image/")){reject(new Error("Please choose an image file."));return;}
    if(Number(file.size||0)>8_000_000){reject(new Error("Image is too large. Maximum source size is 8 MB."));return;}
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("Unable to read image."));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error("Unable to process image."));
      img.onload=()=>{
        const target=512;
        const canvas=document.createElement("canvas");
        canvas.width=target;
        canvas.height=target;
        const ctx=canvas.getContext("2d");
        const source=Math.min(img.naturalWidth||img.width,img.naturalHeight||img.height);
        const sx=((img.naturalWidth||img.width)-source)/2;
        const sy=((img.naturalHeight||img.height)-source)/2;
        ctx.drawImage(img,sx,sy,source,source,0,0,target,target);
        let dataUrl="";
        try{dataUrl=canvas.toDataURL("image/webp",0.82);}catch{dataUrl=canvas.toDataURL("image/jpeg",0.82);}
        resolve({dataUrl,fileName:file.name||"manager-profile"});
      };
      img.src=String(reader.result||"");
    };
    reader.readAsDataURL(file);
  });
}

export default function NewGame() {
  const navigate = useNavigate();
  const {
    gameState,
    applyYearFilter,
    loadSeasonPack,
    startNewGame,
    saveLocal,
    getTeamDisplayName,
    getTeamLogoCandidates,
  } = useGame();

  const initialYear=String(gameState?.activeYear ?? 1980);
  const [step, setStep] = useState(0);
  const [era, setEra] = useState("1980s");
  const [year, setYear] = useState(initialYear);
  const [teamId, setTeamId] = useState("");
  const [difficulty, setDifficulty] = useState("Normal");
  const [manager, setManager] = useState({
    first_name:"",
    last_name:"",
    nationality_name:"",
    nationality_code:"",
    date_of_birth:String(Number(initialYear)-35).padStart(4,"0")+"-01-01",
    place_of_birth:"",
    portrait_data_url:null,
    portrait_file_name:null,
    background:"newcomer",
    experience_level:"rookie",
  });
  const [dobTouched,setDobTouched]=useState(false);
  const [portraitError,setPortraitError]=useState("");
  const [lastUsedManager,setLastUsedManager]=useState(null);
  const [savedManagerProfiles,setSavedManagerProfiles]=useState([]);
  const [managerProfileNotice,setManagerProfileNotice]=useState("");
  const [yearLoading, setYearLoading] = useState(false);
  const [yearSource, setYearSource] = useState("");
  const [yearError, setYearError] = useState("");

  useEffect(()=>{
    const snapshot=readManagerProfileStore();
    setLastUsedManager(snapshot.lastUsed);
    setSavedManagerProfiles(snapshot.profiles);
  },[]);

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
    let cancelled=false;
    const target=eraYears.includes(year)?year:eraYears[0];
    if(target!==year)setYear(target);
    setTeamId("");
    setYearLoading(true);
    setYearError("");
    Promise.resolve(loadSeasonPack?.(+target))
      .then((res)=>{
        if(cancelled)return;
        setYearSource(res?.source==="season-pack"?"Season Pack":"Legacy fallback");
        if(!res?.ok)setYearError(String(res?.error?.message||"Unable to load season."));
      })
      .catch((err)=>{
        if(cancelled)return;
        applyYearFilter(+target);
        setYearSource("Legacy fallback");
        setYearError(String(err?.message||err));
      })
      .finally(()=>{if(!cancelled)setYearLoading(false);});
    return ()=>{cancelled=true;};
  }, [era, eraYears.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    if(dobTouched)return;
    const defaultDob=String(Number(year)-35).padStart(4,"0")+"-01-01";
    setManager((current)=>({...current,date_of_birth:defaultDob}));
  },[year,dobTouched]);

  const pickYear = async (y) => {
    setYear(String(y));
    setTeamId("");
    setYearLoading(true);
    setYearError("");
    try{
      const res=await loadSeasonPack?.(+y);
      setYearSource(res?.source==="season-pack"?"Season Pack":"Legacy fallback");
      if(!res?.ok)setYearError(String(res?.error?.message||"Unable to load season."));
    }catch(err){
      applyYearFilter(+y);
      setYearSource("Legacy fallback");
      setYearError(String(err?.message||err));
    }finally{
      setYearLoading(false);
    }
  };

  const teamsForYear = Array.isArray(gameState?.teams) ? gameState.teams : [];
  const gpCount = Array.isArray(gameState?.calendar) ? gameState.calendar.length : 0;
  const driverCount = Array.isArray(gameState?.drivers) ? gameState.drivers.length : 0;
  const isLoading = !gameState?.dbCalendar?.length || !gameState?.dbTeams?.length || !gameState?.dbDrivers?.length;
  const selectedTeam=teamId==="create"?null:(teamsForYear.find((team)=>getTeamId(team)===teamId)||null);
  const selectedTeamTitle=teamId==="create"
    ?"Create New Team"
    :safeText(getTeamDisplayName?.(selectedTeam)??pick(selectedTeam,["team_name","name","short_name"],teamId),"—");
  const teamPreviews=useMemo(()=>{
    const previews=new Map();
    for(const team of teamsForYear){
      const id=getTeamId(team);
      previews.set(id,newGameTeamPreview(gameState,team));
    }
    return previews;
  },[gameState,teamsForYear]);
  const selectedTeamPreview=selectedTeam?teamPreviews.get(getTeamId(selectedTeam))||null:null;
  const managerPreview=useMemo(
    ()=>createManagerProfile(manager,{year:+year,team:selectedTeam||{name:teamId==="create"?"New Team":"Unattached"}}),
    [manager,year,selectedTeam,teamId]
  );
  const managerPreviewAge=managerAge(managerPreview,String(year).padStart(4,"0")+"-01-01");
  const managerValid=Boolean(
    String(manager.first_name||"").trim() &&
    String(manager.last_name||"").trim() &&
    String(manager.nationality_name||"").trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(manager.date_of_birth||"")) &&
    managerPreviewAge!=null && managerPreviewAge>=21 && managerPreviewAge<=85
  );

  const canNext = !yearLoading && (
    step === 0 ? !!era :
    step === 1 ? !!year && eraYears.includes(year) :
    step === 2 ? managerValid :
    step === 3 ? !!teamId :
    step === 4 ? !!difficulty :
    managerValid && !!teamId && !!difficulty
  );

  const patchManager=(patch)=>setManager((current)=>({...current,...patch}));

  const loadManagerDraft=(draft,label="Saved profile")=>{
    if(!draft)return;
    setManager((current)=>({...current,...draft}));
    setDobTouched(Boolean(draft.date_of_birth));
    setPortraitError("");
    setManagerProfileNotice(label+" loaded.");
  };

  const refreshManagerProfiles=()=>{
    const snapshot=readManagerProfileStore();
    setLastUsedManager(snapshot.lastUsed);
    setSavedManagerProfiles(snapshot.profiles);
  };

  const saveCurrentManagerProfile=()=>{
    const result=saveManagerProfile(manager);
    refreshManagerProfiles();
    setManagerProfileNotice(result.ok?"Manager profile saved.":"Unable to save manager profile.");
  };

  const removeManagerProfile=(id)=>{
    const result=deleteManagerProfile(id);
    refreshManagerProfiles();
    setManagerProfileNotice(result.ok?"Saved profile removed.":"Unable to remove saved profile.");
  };

  const rememberCurrentManager=()=>{
    const result=rememberLastUsedManagerProfile(manager);
    if(result.ok){
      setLastUsedManager(result.store.lastUsed);
      setManagerProfileNotice("Last Used profile updated.");
    }
  };

  const handlePortrait=async(file)=>{
    setPortraitError("");
    try{
      const result=await readManagerPortrait(file);
      patchManager({portrait_data_url:result.dataUrl,portrait_file_name:result.fileName});
    }catch(error){
      setPortraitError(String(error?.message||error));
    }
  };

  const handleFinish = async () => {
    if (!canNext) return;
    rememberCurrentManager();
    if (teamId === "create") {
      navigate("/CreateTeam", { state: { era, year, difficulty, manager } });
      return;
    }
    const loaded=await loadSeasonPack?.(+year);
    if(loaded && !loaded.ok){
      setYearError(String(loaded?.error?.message||"Unable to load selected season."));
      return;
    }
    const freshTeams=useGame.getState().gameState?.teams||teamsForYear;
    const team = freshTeams.find((t) => getTeamId(t) === teamId) ?? null;
    startNewGame({ era, year: +year, team, difficulty, manager });
    saveLocal();
    navigate("/Home");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="f1ml-responsive-shell py-6">
        <h1 className="text-3xl font-bold mb-6">New Game</h1>

        <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs mb-6">
          {STEP_LABELS.map((label,index)=><React.Fragment key={label}>
            <StepDot active={step >= index} current={step===index} label={label} />
            {index<STEP_LABELS.length-1?<span className="opacity-30">/</span>:null}
          </React.Fragment>)}
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
                        <button key={label} onClick={() => setEra(label)} className={"p-4 rounded-xl border text-left "+(selected ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30")}>
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
                      <button key={y} onClick={() => pickYear(y)} className={"px-3 py-2 rounded-lg border text-sm "+(year === y ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30")}>{y}</button>
                    ))}
                  </div>
                  <p className="text-xs opacity-70">
                    Dataset for {safeText(year)}: {yearLoading ? "loading…" : gpCount+" GPs · "+teamsForYear.length+" teams · "+driverCount+" drivers"}
                    {yearSource ? " · "+yearSource : ""}
                  </p>
                  {yearError && <p className="text-xs text-amber-300">{yearError}</p>}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-xl font-semibold">Create Team Manager</h2>
                    <p className="mt-1 text-sm text-slate-400">This is your career identity. Backgrounds redistribute the same core ability; experience trades starting strength for long-term potential.</p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#0d0f15] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="mr-1">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Manager Profiles</div>
                        <div className="text-[11px] text-slate-600">Reuse the same identity across careers.</div>
                      </div>
                      {lastUsedManager?<button type="button" onClick={()=>loadManagerDraft(lastUsedManager,"Last Used")} className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-left hover:border-emerald-300">
                        <div className="text-[10px] uppercase tracking-wide text-emerald-300">Last Used</div>
                        <div className="text-sm font-semibold">{[lastUsedManager.first_name,lastUsedManager.last_name].filter(Boolean).join(" ")||"Team Manager"}</div>
                      </button>:null}
                      {savedManagerProfiles.map((row)=><div key={row.id} className="flex overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
                        <button type="button" onClick={()=>loadManagerDraft(row.profile,row.label)} className="px-3 py-2 text-left hover:bg-white/[0.05]">
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Saved</div>
                          <div className="max-w-[180px] truncate text-sm font-semibold">{row.label}</div>
                        </button>
                        <button type="button" aria-label={"Delete "+row.label} onClick={()=>removeManagerProfile(row.id)} className="border-l border-white/10 px-2 text-slate-500 hover:bg-white/[0.05] hover:text-rose-300">×</button>
                      </div>)}
                      <div className="flex-1"/>
                      <button type="button" onClick={saveCurrentManagerProfile} disabled={!managerValid} className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold hover:border-white/35 disabled:opacity-40">Save current profile</button>
                    </div>
                    {managerProfileNotice?<div className="mt-2 text-xs text-slate-400">{managerProfileNotice}</div>:null}
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="text-sm">First name<input value={manager.first_name} onChange={(e)=>patchManager({first_name:e.target.value})} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0d0f15] px-3 py-2" placeholder="First name"/></label>
                        <label className="text-sm">Last name<input value={manager.last_name} onChange={(e)=>patchManager({last_name:e.target.value})} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0d0f15] px-3 py-2" placeholder="Last name"/></label>
                        <label className="text-sm">Nationality<input value={manager.nationality_name} onChange={(e)=>patchManager({nationality_name:e.target.value})} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0d0f15] px-3 py-2" placeholder="e.g. Portuguese"/></label>
                        <label className="text-sm">Nationality code <span className="text-xs text-slate-500">(optional)</span><input value={manager.nationality_code} maxLength={3} onChange={(e)=>patchManager({nationality_code:e.target.value.toUpperCase()})} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0d0f15] px-3 py-2 uppercase" placeholder="PRT"/></label>
                        <label className="text-sm">Date of birth<input type="date" value={manager.date_of_birth} onChange={(e)=>{setDobTouched(true);patchManager({date_of_birth:e.target.value});}} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0d0f15] px-3 py-2"/></label>
                        <label className="text-sm">Place of birth <span className="text-xs text-slate-500">(optional)</span><input value={manager.place_of_birth} onChange={(e)=>patchManager({place_of_birth:e.target.value})} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0d0f15] px-3 py-2" placeholder="City, Country"/></label>
                      </div>
                      {managerPreviewAge!=null&&managerPreviewAge<21?<div className="text-xs text-amber-300">The Team Manager must be at least 21 at the start of the selected season.</div>:null}

                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500 mb-2">Background</div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {MANAGER_BACKGROUNDS.map((row)=><button type="button" key={row.id} onClick={()=>patchManager({background:row.id})} className={"rounded-xl border p-3 text-left "+(manager.background===row.id?"border-emerald-400 bg-emerald-400/10":"border-white/10 hover:border-white/30")}>
                            <div className="font-semibold">{row.label}</div>
                            <div className="mt-1 text-xs text-slate-400">{row.description}</div>
                          </button>)}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500 mb-2">Starting Experience</div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                          {MANAGER_EXPERIENCE_LEVELS.map((row)=><button type="button" key={row.id} onClick={()=>patchManager({experience_level:row.id})} className={"rounded-xl border p-3 text-left "+(manager.experience_level===row.id?"border-emerald-400 bg-emerald-400/10":"border-white/10 hover:border-white/30")}>
                            <div className="font-semibold">{row.label}</div>
                            <div className="mt-1 text-xs text-slate-400">{row.description}</div>
                          </button>)}
                        </div>
                      </div>
                    </div>

                    <aside className="rounded-xl border border-white/10 bg-[#0d0f15] p-4 h-fit">
                      <div className="flex items-center gap-3">
                        <ManagerPortrait manager={managerPreview}/>
                        <div>
                          <div className="text-lg font-semibold">{managerPreview.display_name}</div>
                          <div className="text-xs text-slate-400">{manager.nationality_name||"Nationality"}{managerPreviewAge!=null?" · Age "+managerPreviewAge:""}</div>
                          <div className="mt-1 text-xs text-slate-500">{managerBackground(manager.background).label} · {managerExperience(manager.experience_level).label}</div>
                        </div>
                      </div>
                      <label className="mt-4 block text-xs text-slate-400">Profile photo <span className="text-slate-600">(optional)</span>
                        <input type="file" accept="image/*" onChange={(e)=>handlePortrait(e.target.files?.[0])} className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-slate-200"/>
                      </label>
                      {portraitError?<div className="mt-2 text-xs text-amber-300">{portraitError}</div>:null}
                      {manager.portrait_data_url?<button type="button" onClick={()=>patchManager({portrait_data_url:null,portrait_file_name:null})} className="mt-2 text-xs text-slate-400 hover:text-white">Remove photo</button>:null}

                      <div className="mt-5 space-y-2">
                        {MANAGER_ATTRIBUTES.map((definition)=><div key={definition.key} className="flex items-center gap-2 text-xs">
                          <span className="min-w-0 flex-1 text-slate-400">{definition.shortLabel}</span>
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-slate-200" style={{width:String(managerPreview.attributes?.[definition.key]||0)+"%"}}/></div>
                          <span className="w-6 text-right font-semibold tabular-nums">{managerPreview.attributes?.[definition.key]}</span>
                        </div>)}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-white/[0.04] p-2"><div className="text-[10px] uppercase text-slate-500">Reputation</div><div className="font-semibold">{Math.round(managerPreview.reputation)}/100</div></div>
                        <div className="rounded-lg bg-white/[0.04] p-2"><div className="text-[10px] uppercase text-slate-500">Potential</div><div className="font-semibold">{Math.round(managerPreview.potential)}/100</div></div>
                      </div>
                    </aside>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-semibold">Choose Team</h2>
                    <p className="mt-1 text-sm text-slate-400">Compare the historical opening conditions for {year}. These values describe the team you are taking over before the Save World begins.</p>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="max-h-[72vh] space-y-2 overflow-y-auto pr-1">
                      <button onClick={() => setTeamId("create")} className={"w-full rounded-xl border p-3 text-left "+(teamId === "create" ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 bg-[#0d0f15] hover:border-white/30")}>
                        <div className="font-medium">Create New Team</div>
                        <div className="mt-1 text-xs text-slate-400">Start as a brand-new privateer entry</div>
                      </button>

                      {teamsForYear.map((t) => {
                        const id = getTeamId(t);
                        const title = safeText(getTeamDisplayName?.(t) ?? pick(t, ["team_name", "name", "short_name"], id), id);
                        const preview=teamPreviews.get(id);
                        const selected=teamId===id;
                        return (
                          <button key={id} onClick={() => setTeamId(id)} className={"w-full rounded-xl border p-3 text-left transition "+(selected ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 bg-[#0d0f15] hover:border-white/30")}>
                            <div className="flex items-center gap-3">
                              <TeamLogo candidates={getTeamLogoCandidates?.(t) || []} title={title} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{title}</div>
                                <div className="truncate text-[11px] text-slate-500">{preview?.championshipExpectationLabel||"—"}</div>
                              </div>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-1.5">
                              <div className="rounded-md bg-white/[0.04] px-2 py-1.5"><div className="text-[9px] uppercase tracking-wide text-slate-500">Rep</div><div className="text-xs font-semibold">{preview?.reputation!=null?Math.round(preview.reputation):"—"}</div></div>
                              <div className="rounded-md bg-white/[0.04] px-2 py-1.5"><div className="text-[9px] uppercase tracking-wide text-slate-500">Car</div><div className="text-xs font-semibold">{preview?.car?.overall!=null?Math.round(preview.car.overall):"—"}</div></div>
                              <div className="rounded-md bg-white/[0.04] px-2 py-1.5"><div className="text-[9px] uppercase tracking-wide text-slate-500">Budget</div><div className="truncate text-xs font-semibold">{fmtMoney(preview?.startingBudget)}</div></div>
                            </div>
                            <div className="mt-2 truncate text-[11px] text-slate-400">
                              {preview?.drivers?.length
                                ?preview.drivers.map((driver)=>driver.name+" "+(driver.overall==null?"—":(driver.estimated?"~":"")+Math.round(driver.overall))).join(" · ")
                                :"Drivers —"}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="min-h-[460px] rounded-xl border border-white/10 bg-[#0d0f15] p-5 xl:sticky xl:top-4 xl:self-start">
                      {teamId==="create" ? (
                        <div className="flex h-full min-h-[380px] flex-col items-center justify-center text-center">
                          <FallbackAvatar title="Create New Team" large/>
                          <div className="mt-4 text-xl font-semibold">Create New Team</div>
                          <p className="mt-2 max-w-md text-sm text-slate-400">Build a new privateer entry instead of inheriting an existing constructor. Your starting identity, finances and technical package will be configured in the next screen.</p>
                        </div>
                      ) : selectedTeam && selectedTeamPreview ? (
                        <div className="space-y-5">
                          <div className="flex items-start gap-4">
                            <TeamLogo candidates={getTeamLogoCandidates?.(selectedTeam) || []} title={selectedTeamTitle} large />
                            <div className="min-w-0 flex-1">
                              <div className="text-2xl font-semibold">{selectedTeamTitle}</div>
                              <div className="mt-1 text-sm text-slate-400">
                                {safeText(pick(selectedTeam,["team_base","base","country","location"],"—"))}
                                {selectedTeamPreview.engineName?" · "+selectedTeamPreview.engineName:""}
                              </div>
                              <div className="mt-2 text-xs text-slate-500">Historical opening conditions · {year}</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Reputation</div>
                              <div className="mt-1 text-lg font-semibold">{selectedTeamPreview.reputation!=null?Math.round(selectedTeamPreview.reputation)+"/100":"—"}</div>
                              <div className="text-xs text-slate-500">{selectedTeamPreview.reputationLabel}</div>
                            </div>
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Starting Budget</div>
                              <div className="mt-1 text-lg font-semibold">{fmtMoney(selectedTeamPreview.startingBudget)}</div>
                              <div className="text-xs text-slate-500">Career opening funds</div>
                            </div>
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Car Overall</div>
                              <div className="mt-1 text-lg font-semibold">{selectedTeamPreview.car?.overall!=null?selectedTeamPreview.car.overall.toFixed(1):"—"}</div>
                              <div className="text-xs text-slate-500">Historical technical package</div>
                            </div>
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Drivers OVR</div>
                              <div className="mt-1 text-lg font-semibold">{selectedTeamPreview.driversOverall!=null?selectedTeamPreview.driversOverall.toFixed(1):"—"}</div>
                              <div className="text-xs text-slate-500">Main + Second average</div>
                            </div>
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Facilities</div>
                              <div className="mt-1 text-lg font-semibold">{selectedTeamPreview.facilities?.average!=null?selectedTeamPreview.facilities.average.toFixed(1)+"/10":"—"}</div>
                              <div className="text-xs text-slate-500">{selectedTeamPreview.facilities?.available||0} era-available areas</div>
                            </div>
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Championship Projection</div>
                              <div className="mt-1 text-lg font-semibold leading-5">{selectedTeamPreview.championshipExpectationLabel}</div>
                              <div className="mt-1 text-xs text-slate-500">Model strength {selectedTeamPreview.championshipProjection?.score?.toFixed?.(1)??"—"}/100</div>
                            </div>
                          </div>

                          <div>
                            <div className="mb-2 text-xs uppercase tracking-[0.15em] text-slate-500">Projection Factors</div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                              {[
                                ["Car","car"],
                                ["Drivers","drivers"],
                                ["Staff","staff"],
                                ["Facilities","facilities"],
                                ["Budget","budget"],
                                ["Reputation","reputation"],
                              ].map(([label,key])=>{
                                const value=selectedTeamPreview.championshipProjection?.factors?.[key];
                                const weight=selectedTeamPreview.championshipProjection?.weights?.[key];
                                return <div key={key} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                                  <div className="text-[9px] uppercase tracking-wide text-slate-500">{label} · {weight?Math.round(weight*100):0}%</div>
                                  <div className="mt-1 text-sm font-semibold">{Number.isFinite(Number(value))?Number(value).toFixed(1):"—"}</div>
                                </div>;
                              })}
                            </div>
                            <div className="mt-2 text-[11px] text-slate-600">Projected finishing range is calculated against the full {selectedTeamPreview.championshipProjection?.fieldSize||teamsForYear.length}-team field. Missing historical factors are excluded and the remaining weights are rebalanced.</div>
                          </div>

                          <div>
                            <div className="mb-2 text-xs uppercase tracking-[0.15em] text-slate-500">Race Drivers</div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {selectedTeamPreview.drivers.map((row)=>(
                                <div key={row.slot+"_"+row.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                  <DriverPortrait driver={row.driver||{display_name:row.name}} size="h-16 w-16"/>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500">{row.slot==="main"?"Main Driver":"Second Driver"}</div>
                                    <div className="truncate font-semibold">{row.name}</div>
                                    <div className="mt-1 text-sm text-slate-300">OVR {row.overall==null?"—":(row.estimated?"~":"")+Math.round(row.overall)}</div>
                                  </div>
                                </div>
                              ))}
                              {!selectedTeamPreview.drivers.length?<div className="text-sm text-slate-500">No race-driver lineup is available for this season.</div>:null}
                            </div>
                          </div>

                          <div className="grid gap-4 xl:grid-cols-2">
                            <div>
                              <div className="mb-2 text-xs uppercase tracking-[0.15em] text-slate-500">Car Performance</div>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-lg bg-white/[0.03] p-3"><div className="text-[10px] uppercase text-slate-500">Qualifying</div><div className="mt-1 font-semibold">{selectedTeamPreview.car?.qualifying!=null?selectedTeamPreview.car.qualifying.toFixed(1):"—"}</div></div>
                                <div className="rounded-lg bg-white/[0.03] p-3"><div className="text-[10px] uppercase text-slate-500">Race Pace</div><div className="mt-1 font-semibold">{selectedTeamPreview.car?.race!=null?selectedTeamPreview.car.race.toFixed(1):"—"}</div></div>
                                <div className="rounded-lg bg-white/[0.03] p-3"><div className="text-[10px] uppercase text-slate-500">Reliability</div><div className="mt-1 font-semibold">{selectedTeamPreview.car?.reliability!=null?selectedTeamPreview.car.reliability.toFixed(1):"—"}</div></div>
                              </div>
                            </div>
                            <div>
                              <div className="mb-2 text-xs uppercase tracking-[0.15em] text-slate-500">Facilities</div>
                              {selectedTeamPreview.facilities?.items?.length?<div className="grid grid-cols-2 gap-2">
                                {selectedTeamPreview.facilities.items.map((row)=><div key={row.label} className="rounded-lg bg-white/[0.03] px-3 py-2">
                                  <div className="truncate text-[10px] uppercase tracking-wide text-slate-500">{row.label}</div>
                                  <div className="mt-1 flex items-center gap-2">
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-slate-300" style={{width:String(Math.max(0,Math.min(10,row.level))*10)+"%"}}/></div>
                                    <div className="w-8 text-right text-sm font-semibold">{row.level}/10</div>
                                  </div>
                                </div>)}
                              </div>:<div className="text-sm text-slate-500">No facility data is available for this season.</div>}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex min-h-[380px] items-center justify-center text-center text-sm text-slate-500">Select a team to inspect its starting conditions.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-semibold">Choose Difficulty</h2>
                    <p className="mt-1 text-sm text-slate-400">Difficulty remains separate from your manager background. Manager attributes are career identity, not a difficulty selector.</p>
                  </div>
                  <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
                    {["Easy", "Normal", "Hard"].map((d) => <button key={d} onClick={() => setDifficulty(d)} className={"px-4 py-4 rounded-xl border text-left "+(difficulty === d ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 hover:border-white/30")}>
                      <div className="font-semibold">{d}</div>
                    </button>)}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-xl font-semibold">Career Summary</h2>
                    <p className="mt-1 text-sm text-slate-400">Review the starting conditions before creating the Save World.</p>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-[#0d0f15] p-4">
                      <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Manager</div>
                      <div className="mt-3 flex items-center gap-3">
                        <ManagerPortrait manager={managerPreview} size="small"/>
                        <div><div className="font-semibold">{managerPreview.display_name}</div><div className="text-xs text-slate-400">{manager.nationality_name}{managerPreviewAge!=null?" · Age "+managerPreviewAge:""}</div></div>
                      </div>
                      <div className="mt-3 text-sm text-slate-300">{managerBackground(manager.background).label} · {managerExperience(manager.experience_level).label}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#0d0f15] p-4">
                      <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Career</div>
                      <div className="mt-3 text-2xl font-semibold">{year}</div>
                      <div className="mt-1 text-sm text-slate-400">Formula One World Championship</div>
                      <div className="mt-3 text-xs text-slate-500">{gpCount} Grands Prix · {teamsForYear.length} teams</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#0d0f15] p-4">
                      <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Team</div>
                      <div className="mt-3 flex items-center gap-3">
                        {selectedTeam?<TeamLogo candidates={getTeamLogoCandidates?.(selectedTeam)||[]} title={selectedTeamTitle} large/>:<FallbackAvatar title={selectedTeamTitle} large/>}
                        <div><div className="font-semibold">{selectedTeamTitle}</div><div className="text-xs text-slate-400">Difficulty: {difficulty}</div></div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#0d0f15] p-4">
                    <div className="text-xs uppercase tracking-[0.15em] text-slate-500">Starting Manager Attributes</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                      {MANAGER_ATTRIBUTES.map((definition)=><div key={definition.key} className="rounded-lg bg-white/[0.04] p-3">
                        <div className="text-[10px] text-slate-500">{definition.shortLabel}</div>
                        <div className="mt-1 text-xl font-semibold">{managerPreview.attributes?.[definition.key]}</div>
                      </div>)}
                    </div>
                    <div className="mt-3 text-xs text-slate-500">These ratings create bounded management modifiers. They do not add car pace or replace specialist staff.</div>
                  </div>
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
          {step < STEP_LABELS.length-1 ? (
            <button onClick={() => setStep((s) => Math.min(STEP_LABELS.length-1, s + 1))} disabled={!canNext || isLoading || yearLoading} className="px-4 py-2 rounded-lg bg-emerald-500 disabled:opacity-40">Next</button>
          ) : (
            <button onClick={handleFinish} disabled={!canNext || isLoading || yearLoading} className="px-5 py-2 rounded-lg bg-emerald-500 font-semibold disabled:opacity-40">{teamId==="create"?"Continue to Create Team":"Start Career"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepDot({ active, current, label }) {
  return <div className="flex items-center gap-2"><span className={"h-2.5 w-2.5 rounded-full "+(current?"bg-white ring-2 ring-emerald-400":active?"bg-emerald-400":"bg-white/30")} /><span className={"uppercase tracking-wide "+(active?"text-white":"text-white/60")}>{label}</span></div>;
}
