// src/pages/RaceWeekend.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";

const STEPS=[
  ["practice","Practice"],
  ["qualifying","Qualifying"],
  ["grid","Grid"],
  ["race","Race"],
  ["results","Results"],
];

function phaseIndex(phase){
  if(phase==="practice"||phase==="practice_complete")return 0;
  if(phase==="qualifying")return 1;
  if(phase==="grid_ready")return 2;
  if(phase==="race")return 3;
  if(phase==="results"||phase==="completed")return 4;
  return 0;
}
function driverId(row){return String(row?.driver_id??row?.id??"");}
function driverName(drivers,id){
  const d=(drivers||[]).find((row)=>driverId(row)===String(id));
  return d?.display_name||d?.name||`${d?.first_name??""} ${d?.last_name??""}`.trim()||String(id||"—");
}
function teamName(teams,id){
  const t=(teams||[]).find((row)=>String(row?.team_id??row?.id??"")===String(id));
  return t?.team_name||t?.name||String(id||"—");
}

export default function RaceWeekend(){
  const navigate=useNavigate();
  const gs=useGame((s)=>s.gameState);
  const runPractice=useGame((s)=>s.completeRaceWeekendPractice);
  const runQualifying=useGame((s)=>s.completeRaceWeekendQualifying);
  const runRace=useGame((s)=>s.completeRaceWeekendRace);
  const advance=useGame((s)=>s.advanceOneDayUntilBreak);
  const [busy,setBusy]=useState(false);

  const weekend=gs?.raceWeekendState;
  const drivers=gs?.drivers||[];
  const teams=gs?.teams||[];
  const currentIndex=phaseIndex(weekend?.phase);
  const classification=weekend?.qualifying?.classification||[];
  const lastResult=useMemo(()=>{
    const key=weekend?.race_result_key;
    if(!key)return null;
    return (gs?.results||[]).find((row)=>row?.key===key)||null;
  },[gs?.results,weekend?.race_result_key]);

  if(!weekend){
    return <div className="bg-white rounded-xl shadow p-5">
      <h2 className="text-lg font-semibold">Race Weekend</h2>
      <p className="text-sm text-gray-600 mt-1">No active race weekend. Advance the calendar to the next Grand Prix weekend.</p>
    </div>;
  }

  const perform=async(fn)=>{
    if(busy)return;
    setBusy(true);
    try{await fn();}finally{setBusy(false);}
  };

  const advanceSession=()=>perform(async()=>{
    const res=await advance();
    if(res?.breakReason!=="race_weekend"&&gs?.raceWeekendState?.phase==="results")navigate("/Home");
  });

  return <div className="grid gap-4">
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">Round {weekend.round}</div>
          <h2 className="text-xl font-semibold">{weekend.gp_name}</h2>
          <div className="text-sm text-gray-600 mt-1">
            Practice {weekend.practiceDate} · Qualifying {weekend.qualifyingDate} · Race {weekend.raceDate}
          </div>
        </div>
        <div className="text-sm px-3 py-1.5 rounded-full bg-slate-100">
          {String(weekend.phase||"").replaceAll("_"," ")}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 mt-5">
        {STEPS.map(([id,label],index)=>{
          const state=index<currentIndex?"complete":index===currentIndex?"active":"upcoming";
          const cls=state==="complete"
            ?"bg-emerald-100 border-emerald-300 text-emerald-800"
            :state==="active"
              ?"bg-slate-900 border-slate-900 text-white"
              :"bg-gray-50 border-gray-200 text-gray-500";
          return <div key={id} className={`border rounded-lg px-2 py-3 text-center text-xs md:text-sm font-medium ${cls}`}>
            {label}
          </div>;
        })}
      </div>
    </div>

    {weekend.phase==="practice"&&(
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold">Practice</h3>
        <p className="text-sm text-gray-600 mt-1">
          RW1 establishes the authoritative Practice session and race-entry boundary. Setup learning and selectable practice programmes arrive in RW2.
        </p>
        <div className="mt-3 text-sm text-gray-600">{weekend.entrants?.length||0} cars entered for the weekend.</div>
        <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={()=>perform(runPractice)}>
          {busy?"Running…":"Run Practice"}
        </button>
      </div>
    )}

    {weekend.phase==="practice_complete"&&(
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold">Practice Complete</h3>
        <p className="text-sm text-gray-600 mt-1">Practice is locked into the Save. Advance one day to reach Qualifying.</p>
        <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={advanceSession}>
          {busy?"Advancing…":"Advance to Qualifying"}
        </button>
      </div>
    )}

    {weekend.phase==="qualifying"&&(
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold">Qualifying</h3>
        <p className="text-sm text-gray-600 mt-1">
          Qualifying is now a separate deterministic session. Its classification becomes the persistent starting grid consumed by the Race.
        </p>
        <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={()=>perform(runQualifying)}>
          {busy?"Running…":"Run Qualifying"}
        </button>
      </div>
    )}

    {(weekend.phase==="grid_ready"||weekend.phase==="race")&&(
      <div className="bg-white rounded-xl shadow p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Starting Grid</h3>
            <p className="text-sm text-gray-600 mt-1">{classification.length} qualified starters.</p>
          </div>
          {weekend.phase==="grid_ready"&&<span className="text-xs text-gray-500">Race day: {weekend.raceDate}</span>}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr><th className="px-3 py-2 text-right">Grid</th><th className="px-3 py-2 text-left">Driver</th><th className="px-3 py-2 text-left">Team</th></tr>
            </thead>
            <tbody>
              {classification.map((row)=>(
                <tr className="border-t" key={row.driver_id}>
                  <td className="px-3 py-2 text-right font-semibold">P{row.position}</td>
                  <td className="px-3 py-2">{driverName(drivers,row.driver_id)}</td>
                  <td className="px-3 py-2">{teamName(teams,row.team_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {weekend.phase==="grid_ready"?(
          <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={advanceSession}>
            {busy?"Advancing…":"Advance to Race Day"}
          </button>
        ):(
          <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={()=>perform(runRace)}>
            {busy?"Running…":"Run Race"}
          </button>
        )}
      </div>
    )}

    {weekend.phase==="results"&&(
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold">Race Complete</h3>
        <p className="text-sm text-gray-600 mt-1">
          {lastResult?.classification?.[0]
            ?`Winner: ${driverName(drivers,lastResult.classification[0].driver_id)}.`
            :"Classification saved."}
          {" "}Championship, injuries, component wear and finances have been processed.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm" onClick={()=>navigate("/Results")}>View Results</button>
          <button disabled={busy} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50" onClick={advanceSession}>
            {busy?"Advancing…":"Continue after Grand Prix"}
          </button>
        </div>
      </div>
    )}

    {weekend.phase==="completed"&&(
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold">Weekend Complete</h3>
        <button className="mt-3 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm" onClick={()=>navigate("/Home")}>Return Home</button>
      </div>
    )}
  </div>;
}
