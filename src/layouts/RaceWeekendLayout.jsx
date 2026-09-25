// src/layouts/RaceWeekendLayout.jsx
import React, { useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { GrandPrixFlag } from "../components/entity/GrandPrixFlag.jsx";

function formatGameDate(iso){
  if(!iso)return "—";
  const [year,month,day]=String(iso).slice(0,10).split("-").map(Number);
  const date=new Date(Date.UTC(year||0,(month||1)-1,day||1));
  if(Number.isNaN(date.getTime()))return String(iso);
  return date.toLocaleDateString("en-GB",{
    weekday:"short",day:"2-digit",month:"long",year:"numeric",timeZone:"UTC",
  });
}

export default function RaceWeekendLayout(){
  const navigate=useNavigate();
  const location=useLocation();
  const gameState=useGame((s)=>s.gameState);
  const quickSave=useGame((s)=>s.quickSave);
  const advance=useGame((s)=>s.advanceOneDayUntilBreak);
  const [busy,setBusy]=useState(false);
  const [saveLabel,setSaveLabel]=useState("Save Game");
  const [controlsOpen,setControlsOpen]=useState(false);

  const dateLabel=useMemo(()=>formatGameDate(gameState?.currentDateISO),[gameState?.currentDateISO]);
  const weekend=gameState?.raceWeekendState||null;
  const gp=(gameState?.calendar||[])[Number(weekend?.roundIndex)||0]||{};

  const runAdvance=async()=>{
    if(busy)return;
    setBusy(true);
    try{
      await advance();
    }finally{
      setBusy(false);
    }
  };

  const save=()=>{
    const result=quickSave?.();
    setSaveLabel(result?.ok===false?"Save failed":"Saved");
    window.setTimeout?.(()=>setSaveLabel("Save Game"),1600);
  };

  return <div className="min-h-screen bg-[#080b11] text-slate-100">
    <header className="relative sticky top-0 z-50 border-b border-white/10 bg-[#0d1118]/96 backdrop-blur">
      <div className="flex min-h-10 items-center gap-2 px-2 md:px-4">
        {weekend?<div className="flex min-w-0 items-center gap-2">
          <GrandPrixFlag gameState={gameState} gp={gp} size="sm"/>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[11px] font-semibold text-slate-200">R{weekend.round} · {weekend.gp_name}</div>
            <div className="text-[8px] uppercase tracking-[0.12em] text-slate-600">{String(weekend.phase||"").replaceAll("_"," ")}</div>
          </div>
        </div>:<div className="text-[11px] font-semibold text-slate-300">Race Weekend</div>}

        <div className="flex-1"/>
        <div className="hidden rounded border border-white/10 bg-white/[0.035] px-2 py-1 text-[10px] text-slate-400 sm:block">
          {dateLabel}
        </div>
        <button
          type="button"
          aria-expanded={controlsOpen}
          onClick={()=>setControlsOpen((value)=>!value)}
          className={"rounded border px-2 py-1 text-[10px] font-semibold transition "+(controlsOpen?"border-slate-200/30 bg-slate-100 text-slate-950":"border-white/12 bg-white/[0.045] text-slate-300 hover:bg-white/[0.08]")}
        >
          {controlsOpen?"Hide":"Menu"}
        </button>
      </div>

      {controlsOpen?<div className="absolute left-0 right-0 top-full flex flex-wrap items-center gap-1 border-b border-t border-white/10 bg-[#0a0e14]/98 px-2 py-1.5 shadow-xl backdrop-blur md:px-4">
        <button type="button" onClick={()=>{setControlsOpen(false);navigate("/Home");}} className="rounded bg-slate-100 px-2.5 py-1.5 text-[10px] font-bold text-slate-950 hover:bg-white">
          Home
        </button>
        <button type="button" onClick={()=>{setControlsOpen(false);navigate("/");}} className="rounded border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] font-semibold hover:bg-white/10">
          Main Menu
        </button>
        <button type="button" onClick={save} className="rounded border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] font-semibold hover:bg-white/10">
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={()=>{setControlsOpen(false);navigate("/LoadGame",{state:{returnTo:`${location.pathname}${location.search}${location.hash}`}});}}
          className="rounded border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] font-semibold hover:bg-white/10"
        >
          Load Game
        </button>
        <button type="button" disabled={busy} onClick={runAdvance} className="rounded bg-slate-100 px-2.5 py-1.5 text-[10px] font-bold text-slate-950 hover:bg-white disabled:opacity-50">
          {busy?"Advancing…":"Advance"}
        </button>
        <div className="ml-auto block text-[9px] text-slate-600 sm:hidden">{dateLabel}</div>
      </div>:null}
    </header>
    <main className="min-h-[calc(100vh-2.5rem)] bg-[#080b11]">
      <Outlet/>
    </main>
  </div>;
}
