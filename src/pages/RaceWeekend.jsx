// src/pages/RaceWeekend.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { PRACTICE_PROGRAMMES } from "../engine/PracticeSetupEngine.js";

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
  const setPracticeProgramme=useGame((s)=>s.setRaceWeekendPracticeProgramme);
  const runQualifying=useGame((s)=>s.completeRaceWeekendQualifying);
  const runRace=useGame((s)=>s.completeRaceWeekendRace);
  const advance=useGame((s)=>s.advanceOneDayUntilBreak);
  const [busy,setBusy]=useState(false);

  const weekend=gs?.raceWeekendState;
  const drivers=gs?.drivers||[];
  const teams=gs?.teams||[];
  const playerTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const playerEntrants=(weekend?.entrants||[]).filter((row)=>String(row?.team_id??"")===playerTeamId&&row?.driver_id);
  const practiceResults=weekend?.practice?.results||[];
  const playerPracticeResults=practiceResults.filter((row)=>String(row?.team_id??"")===playerTeamId);
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
      <div className="grid gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-semibold">Practice Programmes</h3>
          <p className="text-sm text-gray-600 mt-1">
            Choose how each car uses Practice. More aggressive or longer running can improve a specific area, but increases fatigue, component wear and issue risk.
          </p>
          <div className="mt-4 grid gap-3">
            {playerEntrants.map((entry)=>{
              const did=String(entry.driver_id);
              const selected=weekend.practice_selections?.[did]||"balanced";
              return <div key={did} className="border rounded-xl p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="font-medium">{driverName(drivers,did)}</div>
                    <div className="text-xs text-gray-500">{teamName(teams,entry.team_id)}</div>
                  </div>
                  <select
                    className="border rounded-lg px-3 py-2 text-sm min-w-[210px]"
                    value={selected}
                    onChange={(e)=>setPracticeProgramme(did,e.target.value)}
                  >
                    {Object.values(PRACTICE_PROGRAMMES).map((programme)=>(
                      <option key={programme.id} value={programme.id}>{programme.label}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-2 text-sm text-gray-600">{PRACTICE_PROGRAMMES[selected]?.description||PRACTICE_PROGRAMMES.balanced.description}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="bg-gray-100 rounded px-2 py-1">Fatigue +{PRACTICE_PROGRAMMES[selected]?.fatigue??5}</span>
                  <span className="bg-gray-100 rounded px-2 py-1">Mileage ×{Number(PRACTICE_PROGRAMMES[selected]?.mileageFactor??1).toFixed(2)}</span>
                  <span className="bg-gray-100 rounded px-2 py-1">Wear ×{Number(PRACTICE_PROGRAMMES[selected]?.wearFactor??1).toFixed(2)}</span>
                </div>
              </div>;
            })}
          </div>
          <div className="mt-3 text-xs text-gray-500">
            AI teams select programmes from the same five options using their car reliability, staff support and driver profile.
          </div>
          <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={()=>perform(runPractice)}>
            {busy?"Running…":"Run Practice"}
          </button>
        </div>
      </div>
    )}

    {weekend.phase==="practice_complete"&&(
      <div className="grid gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <h3 className="font-semibold">Practice Complete</h3>
              <p className="text-sm text-gray-600 mt-1">Setup, Preparation, fatigue and component wear have been committed to the Save.</p>
            </div>
            <div className="text-xs text-gray-500">
              Profile: {weekend.practice?.track_profile?.source==="derived_gameplay_profile"?"gameplay-derived circuit demands":"circuit data"}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            {Object.entries(weekend.practice?.track_profile?.target||{}).map(([key,value])=>(
              <div key={key} className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">{key.replace(/([A-Z])/g," $1").replace(/^./,m=>m.toUpperCase())}</div>
                <div className="font-semibold">{Math.round(Number(value)||0)}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3">
            {playerPracticeResults.map((row)=>(
              <div key={row.driver_id} className="border rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{driverName(drivers,row.driver_id)}</div>
                    <div className="text-xs text-gray-500">{row.programme_label}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="bg-emerald-50 text-emerald-800 rounded px-2 py-1">Setup {Math.round(row.setup_quality)}%</span>
                    <span className="bg-blue-50 text-blue-800 rounded px-2 py-1">Knowledge {Math.round(row.setup_knowledge)}%</span>
                    <span className="bg-slate-100 rounded px-2 py-1">Preparation +{Number(row.preparation_gain).toFixed(1)}</span>
                    <span className="bg-slate-100 rounded px-2 py-1">Fatigue +{row.fatigue_cost}</span>
                  </div>
                </div>
                <p className="mt-2 text-sm">{row.feedback}</p>
                {row.issue_note&&<p className="mt-2 text-sm text-amber-700">{row.issue_note}</p>}
              </div>
            ))}
          </div>

          <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={advanceSession}>
            {busy?"Advancing…":"Advance to Qualifying"}
          </button>
        </div>
      </div>
    )}

    {weekend.phase==="qualifying"&&(
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold">Qualifying</h3>
        <p className="text-sm text-gray-600 mt-1">
          Qualifying now consumes the Preparation, Setup Quality and programme effects created in Practice. Its classification becomes the persistent starting grid consumed by the Race.
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
