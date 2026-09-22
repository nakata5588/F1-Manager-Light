// src/layouts/RaceWeekendLayout.jsx
import React, { useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";

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
  const gameState=useGame((s)=>s.gameState);
  const quickSave=useGame((s)=>s.quickSave);
  const advance=useGame((s)=>s.advanceOneDayUntilBreak);
  const [busy,setBusy]=useState(false);
  const [saveLabel,setSaveLabel]=useState("Save Game");

  const dateLabel=useMemo(()=>formatGameDate(gameState?.currentDateISO),[gameState?.currentDateISO]);
  const gpName=gameState?.raceWeekendState?.gp_name||"Race Weekend";

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
    setSaveLabel(result?.meta?.name?"Saved":"Saved");
    window.setTimeout?.(()=>setSaveLabel("Save Game"),1200);
  };

  return <div className="min-h-screen bg-black text-slate-100">
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#07090d]/95 backdrop-blur">
      <div className="min-h-14 px-4 md:px-6 flex flex-wrap items-center gap-2">
        <button type="button" onClick={()=>navigate("/")} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10">
          Main Menu
        </button>
        <button type="button" onClick={save} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10">
          {saveLabel}
        </button>
        <button type="button" onClick={()=>navigate("/LoadGame")} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10">
          Load Game
        </button>
        <button type="button" disabled={busy} onClick={runAdvance} className="rounded-md bg-slate-100 text-slate-950 px-3 py-2 text-xs font-bold hover:bg-white disabled:opacity-50">
          {busy?"Advancing…":"Advance"}
        </button>

        <div className="hidden md:block h-6 w-px bg-white/10 mx-1"/>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Race Weekend</div>
          <div className="text-sm font-semibold truncate">{gpName}</div>
        </div>

        <div className="flex-1"/>
        <div className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
          {dateLabel}
        </div>
      </div>
    </header>
    <main className="min-h-[calc(100vh-3.5rem)] bg-black">
      <Outlet/>
    </main>
  </div>;
}
