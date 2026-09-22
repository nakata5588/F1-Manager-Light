// src/pages/RaceWeekend.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { PRACTICE_PROGRAMMES } from "../engine/PracticeSetupEngine.js";
import { PIT_PLANS, RACE_PACE_MODES, tyresForTeam } from "../engine/RaceStrategyEngine.js";

const STEPS=[
  ["practice","Practice"],
  ["qualifying","Qualifying"],
  ["grid","Grid"],
  ["race","Race"],
  ["results","Results"],
];

function phaseIndex(phase){
  if(phase==="practice"||phase==="practice_complete")return 0;
  if(phase==="qualifying"||phase==="qualifying_wait")return 1;
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
function tyreName(tyres,id){
  const tyre=(tyres||[]).find((row)=>String(row?.tyre_id??row?.id??"")===String(id??""));
  return tyre?.compound_name||String(id||"—");
}
function currentFatigue(gs,id){
  const direct=gs?.driverAttributes?.[String(id)];
  if(direct&&Number.isFinite(Number(direct.fatigue)))return Number(direct.fatigue);
  const digits=String(id??"").match(/(\d+)/)?.[1]?.padStart(4,"0");
  return Number(gs?.driverAttributes?.[digits]?.fatigue||0);
}
function formatLapTime(ms){
  const n=Number(ms);
  if(!Number.isFinite(n)||n<=0)return "—";
  const minutes=Math.floor(n/60000);
  const seconds=(n-minutes*60000)/1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6,"0")}`;
}
function formatGap(ms,bestMs){
  const n=Number(ms);
  const best=Number(bestMs);
  if(!Number.isFinite(n)||!Number.isFinite(best)||n<=0||best<=0)return "—";
  const delta=n-best;
  return delta<=0.5?"—":`+${(delta/1000).toFixed(3)}`;
}
function formatRaceTime(ms){
  const n=Number(ms);
  if(!Number.isFinite(n)||n<=0)return "—";
  const hours=Math.floor(n/3600000);
  const minutes=Math.floor((n-hours*3600000)/60000);
  const seconds=(n-hours*3600000-minutes*60000)/1000;
  return hours>0
    ?`${hours}:${String(minutes).padStart(2,"0")}:${seconds.toFixed(3).padStart(6,"0")}`
    :`${minutes}:${seconds.toFixed(3).padStart(6,"0")}`;
}
function statusClass(status){
  const key=String(status||"").toUpperCase();
  if(["QUALIFIED","ADVANCED","STARTER","CONTINUES","FINISHED"].includes(key))return "bg-emerald-50 text-emerald-800";
  if(["DNQ","DNPQ","ELIMINATED","DNF","RETIRED"].includes(key))return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-700";
}
function sessionStatus(row,session){
  if(row?.status)return String(row.status).toUpperCase();
  if(session?.advance_count)return "ADVANCED";
  return "CONTINUES";
}
function QualifyingTable({title,rows=[],drivers,teams,session=null,overall=false,cutoff=null}){
  const ordered=rows.slice().sort((a,b)=>Number(a?.position??999)-Number(b?.position??999));
  const times=ordered.map((row)=>Number(row?.best_time_ms??row?.lap_time_ms)).filter((value)=>Number.isFinite(value)&&value>0);
  const best=times.length?Math.min(...times):null;
  return <div className="border rounded-xl overflow-hidden">
    {title&&<div className="px-4 py-3 bg-gray-50 border-b flex flex-wrap items-center justify-between gap-2">
      <div className="font-medium text-sm">{title}</div>
      <div className="text-xs text-gray-500">{ordered.length} drivers</div>
    </div>}
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-right">Pos</th>
            <th className="px-3 py-2 text-left">Driver</th>
            <th className="px-3 py-2 text-left">Team</th>
            <th className="px-3 py-2 text-right">Time</th>
            <th className="px-3 py-2 text-right">Gap</th>
            <th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row,index)=>{
            const time=Number(row?.best_time_ms??row?.lap_time_ms);
            const status=overall?String(row?.status||"").toUpperCase():sessionStatus(row,session);
            const atCutoff=Number.isFinite(Number(cutoff))&&index===Number(cutoff);
            return <React.Fragment key={row.driver_id||index}>
              {atCutoff&&<tr className="bg-amber-50 border-y-2 border-amber-300">
                <td colSpan={6} className="px-3 py-1 text-xs font-medium text-amber-900">
                  Qualification cut — only the first {cutoff} cars qualify for the race
                </td>
              </tr>}
              <tr className="border-t">
                <td className="px-3 py-2 text-right font-semibold">P{row.position??index+1}</td>
                <td className="px-3 py-2">{driverName(drivers,row.driver_id)}</td>
                <td className="px-3 py-2">{teamName(teams,row.team_id)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatLapTime(time)}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-500">{formatGap(time,best)}</td>
                <td className="px-3 py-2">
                  <span className={"rounded px-2 py-1 text-xs "+statusClass(status)}>{status||"—"}</span>
                </td>
              </tr>
            </React.Fragment>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}

export default function RaceWeekend(){
  const navigate=useNavigate();
  const gs=useGame((s)=>s.gameState);
  const runPractice=useGame((s)=>s.completeRaceWeekendPractice);
  const setPracticeProgramme=useGame((s)=>s.setRaceWeekendPracticeProgramme);
  const setRaceStrategy=useGame((s)=>s.setRaceWeekendStrategy);
  const runQualifying=useGame((s)=>s.completeRaceWeekendQualifying);
  const runRace=useGame((s)=>s.completeRaceWeekendRace);
  const continueWeekend=useGame((s)=>s.continueRaceWeekendSession);
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
  const startingGridRows=weekend?.startingGrid?.rows||weekend?.grid||[];
  const qualifyingSessions=(weekend?.sessions||[]).filter((row)=>["prequalifying","qualifying"].includes(row?.type));
  const activeSession=(weekend?.sessions||[]).find((row)=>String(row?.id)===String(weekend?.active_session_id||""))
    ||qualifyingSessions.find((row)=>row?.status!=="completed")
    ||null;
  const dnqRows=classification.filter((row)=>["DNQ","DNPQ"].includes(String(row?.status||"")));
  const raceStrategy=weekend?.race_strategy||null;
  const completedQualifyingSessions=qualifyingSessions.filter((session)=>session.status==="completed");
  const lastCompletedQualifyingSession=completedQualifyingSessions.at(-1)||null;
  const confirmedEntrants=(weekend?.entrants||[]).filter((row)=>row?.status==="confirmed"&&row?.driver_id);
  const qualifyingCutoff=Number(weekend?.qualifying_rule_snapshot?.max_starters??weekend?.qualifying?.cutoff_position);
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
  const continueRaceWeekend=()=>perform(async()=>{
    await continueWeekend();
  });

  return <div className="grid gap-4">
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">Round {weekend.round}</div>
          <h2 className="text-xl font-semibold">{weekend.gp_name}</h2>
          <div className="text-sm text-gray-600 mt-1">
            {(weekend.sessions||[]).map((session)=>`${session.label} ${session.dateISO}`).join(" · ")}
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
                  <span className="bg-gray-100 rounded px-2 py-1">Current fatigue {currentFatigue(gs,did).toFixed(0)}/100</span>
                  <span className="bg-gray-100 rounded px-2 py-1">Practice load +{PRACTICE_PROGRAMMES[selected]?.fatigue??5}</span>
                  <span className="bg-gray-100 rounded px-2 py-1">Mileage ×{Number(PRACTICE_PROGRAMMES[selected]?.mileageFactor??1).toFixed(2)}</span>
                  <span className="bg-gray-100 rounded px-2 py-1">Component wear ×{Number(PRACTICE_PROGRAMMES[selected]?.wearFactor??1).toFixed(2)}</span>
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
            {[
              ["Crash Risk",weekend.practice?.track_profile?.inputs?.crash_risk],
              ["Overtaking Difficulty",weekend.practice?.track_profile?.inputs?.overtaking_difficulty],
              ["Tyre Wear",weekend.practice?.track_profile?.inputs?.tyre_wear],
              ["Lap Length",weekend.practice?.track_profile?.inputs?.lap_length_km],
            ].map(([label,value])=>(
              <div key={label} className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="font-semibold">{label==="Lap Length"?`${Number(value||0).toFixed(2)} km`:Math.round(Number(value)||0)}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">The exact ideal setup remains hidden. Driver feedback and Setup Quality show how close the team is to the working window.</p>

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
                    <span className="bg-slate-100 rounded px-2 py-1">Fatigue {Number(row.fatigue_before??0).toFixed(0)} → {Number(row.fatigue_after??row.fatigue_cost??0).toFixed(0)}</span>
                    <span className="bg-slate-100 rounded px-2 py-1">Learning efficiency {Number(row.fatigue_efficiency??100).toFixed(0)}%</span>
                    <span className="bg-amber-50 text-amber-800 rounded px-2 py-1">Component wear {Number(row.component_wear?.total_wear??0).toFixed(1)}</span>
                  </div>
                </div>
                <p className="mt-2 text-sm">{row.feedback}</p>
                {row.component_wear?.lowest_slot&&(
                  <p className="mt-1 text-xs text-gray-500">
                    Lowest component after Practice: {String(row.component_wear.lowest_slot).replaceAll("_"," ")} · {Number(row.component_wear.lowest_condition??0).toFixed(1)}%.
                  </p>
                )}
                {Number(row.fatigue_performance_penalty_before||0)>0&&(
                  <p className="mt-1 text-xs text-amber-700">
                    Existing fatigue reduced the driver's effective performance by about {Number(row.fatigue_performance_penalty_before).toFixed(1)} driver-score points before this session.
                  </p>
                )}
                {row.issue_note&&<p className="mt-2 text-sm text-amber-700">{row.issue_note}</p>}
              </div>
            ))}
          </div>

          <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={continueRaceWeekend}>
            {busy?"Continuing…":activeSession?.dateISO===gs?.currentDateISO?"Continue to Qualifying":"Advance to Qualifying"}
          </button>
        </div>
      </div>
    )}

    {weekend.phase==="qualifying"&&(
      <div className="bg-white rounded-xl shadow p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h3 className="font-semibold">{activeSession?.label||"Qualifying"}</h3>
            <p className="text-sm text-gray-600 mt-1">
              Every entrant uses the same era rule, setup/preparation model and deterministic session seed. Completed sessions are locked into the Save.
            </p>
          </div>
          <div className="text-xs text-gray-500 text-right">
            <div>{activeSession?.dateISO||weekend.qualifyingDate}</div>
            <div>{weekend.qualifying_rule_snapshot?.strategy?.replaceAll("_"," ")||"era rules"}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="border rounded-lg p-3"><div className="text-xs text-gray-500">Entrants</div><div className="font-semibold">{confirmedEntrants.length}</div></div>
          <div className="border rounded-lg p-3"><div className="text-xs text-gray-500">Race grid</div><div className="font-semibold">{Number.isFinite(qualifyingCutoff)?qualifyingCutoff:"—"}</div></div>
          <div className="border rounded-lg p-3"><div className="text-xs text-gray-500">Sessions</div><div className="font-semibold">{qualifyingSessions.length}</div></div>
          <div className="border rounded-lg p-3"><div className="text-xs text-gray-500">Format</div><div className="font-semibold capitalize">{String(weekend.qualifying_rule_snapshot?.strategy||"").replaceAll("_"," ")}</div></div>
        </div>

        {completedQualifyingSessions.length>0&&(
          <div className="mt-4 grid gap-4">
            {completedQualifyingSessions.map((session)=>(
              <QualifyingTable key={session.id} title={session.label+" — saved classification"} rows={session.results||[]} drivers={drivers} teams={teams} session={session}/>
            ))}
          </div>
        )}

        <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={()=>perform(runQualifying)}>
          {busy?"Running…":`Run ${activeSession?.label||"Qualifying"}`}
        </button>
      </div>
    )}

    {weekend.phase==="qualifying_wait"&&(
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold">{lastCompletedQualifyingSession?.label||"Qualifying"} Complete</h3>
        <p className="text-sm text-gray-600 mt-1">
          This classification is saved and will not be recalculated. Next: {activeSession?.label||"Qualifying"} on {activeSession?.dateISO||"the next session date"}.
        </p>
        {weekend.qualifying_rule_snapshot?.strategy==="best_time_across_sessions"&&!lastCompletedQualifyingSession?.advance_count&&(
          <div className="mt-3 rounded-lg bg-blue-50 text-blue-900 px-3 py-2 text-sm">
            No cars are eliminated after this session. The final order uses each driver's best valid time across all qualifying sessions.
          </div>
        )}
        {lastCompletedQualifyingSession&&(
          <div className="mt-4">
            <QualifyingTable title={lastCompletedQualifyingSession.label+" — classification"} rows={lastCompletedQualifyingSession.results||[]} drivers={drivers} teams={teams} session={lastCompletedQualifyingSession}/>
          </div>
        )}
        <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={continueRaceWeekend}>
          {busy?"Continuing…":activeSession?.dateISO===gs?.currentDateISO?"Continue to next session":"Advance toward next session"}
        </button>
      </div>
    )}

    {(weekend.phase==="grid_ready"||weekend.phase==="race")&&(
      <div className="grid gap-4">
        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Overall Qualifying Classification</h3>
              <p className="text-sm text-gray-600 mt-1">
                Best qualifying times are final. {startingGridRows.length} cars qualified from {confirmedEntrants.length} entries.
              </p>
            </div>
            <span className="text-xs text-gray-500">Grid limit: {Number.isFinite(qualifyingCutoff)?qualifyingCutoff:"—"}</span>
          </div>
          <div className="mt-4">
            <QualifyingTable rows={classification} drivers={drivers} teams={teams} overall cutoff={qualifyingCutoff}/>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <h3 className="font-semibold">Race Strategy</h3>
              <p className="text-sm text-gray-600 mt-1">
                The race now resolves tyre life, temperature, weather transitions and pit losses lap by lap. Strategy rules are locked to this era.
              </p>
            </div>
            <div className="text-xs text-gray-500 md:text-right">
              <div>{raceStrategy?.rules_snapshot?.label||"Era rules"}</div>
              <div>{raceStrategy?.track_snapshot?.laps||"—"} laps · pit loss {Number(raceStrategy?.track_snapshot?.pit_lane_loss_s||0).toFixed(1)}s</div>
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-slate-50 border px-3 py-2 text-sm">
            <span className="font-medium">Forecast:</span>{" "}
            {String(raceStrategy?.weather_snapshot?.state||"SUNNY").replaceAll("_"," ")}
            {" · "}{Number(raceStrategy?.weather_snapshot?.avg_temp_c||0).toFixed(0)}°C
            {" · rain "}{Number(raceStrategy?.weather_snapshot?.rain_chance_pct||0).toFixed(0)}%
            {" · refuelling "}{raceStrategy?.rules_snapshot?.refuelling_allowed?"available":"not allowed"}
          </div>

          <div className="mt-4 grid gap-3">
            {playerEntrants.map((entry)=>{
              const did=String(entry.driver_id);
              const selection=raceStrategy?.selections?.[did]||{};
              const tyres=tyresForTeam(gs,String(entry.team_id??""));
              const supplier=gs?.raceStrategyWorld?.teamSuppliers?.[String(entry.team_id??"")]||tyres[0]?.supplier||"—";
              return <div key={did} className="border rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{driverName(drivers,did)}</div>
                    <div className="text-xs text-gray-500">{supplier} · fatigue {currentFatigue(gs,did).toFixed(0)}/100</div>
                  </div>
                  <div className="text-xs text-gray-500">{raceStrategy?.rules_snapshot?.notes}</div>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
                  <label className="text-xs text-gray-600">Start tyre
                    <select className="mt-1 w-full border rounded-lg px-2 py-2 text-sm" value={selection.start_tyre_id||""} onChange={(e)=>setRaceStrategy(did,{start_tyre_id:e.target.value})}>
                      {tyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>{tyre.compound_name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-gray-600">Pace
                    <select className="mt-1 w-full border rounded-lg px-2 py-2 text-sm" value={selection.pace_mode||"balanced"} onChange={(e)=>setRaceStrategy(did,{pace_mode:e.target.value})}>
                      {Object.values(RACE_PACE_MODES).map((mode)=><option key={mode.id} value={mode.id}>{mode.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-gray-600">Pit plan
                    <select className="mt-1 w-full border rounded-lg px-2 py-2 text-sm" value={selection.pit_plan||"adaptive"} onChange={(e)=>setRaceStrategy(did,{pit_plan:e.target.value})}>
                      {Object.values(PIT_PLANS).map((plan)=><option key={plan.id} value={plan.id}>{plan.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-gray-600">Next tyre
                    <select className="mt-1 w-full border rounded-lg px-2 py-2 text-sm" value={selection.next_tyre_id||selection.start_tyre_id||""} onChange={(e)=>setRaceStrategy(did,{next_tyre_id:e.target.value})}>
                      {tyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>{tyre.compound_name}</option>)}
                    </select>
                  </label>
                  {selection.pit_plan==="one_stop"?(
                    <label className="text-xs text-gray-600">Target lap
                      <input className="mt-1 w-full border rounded-lg px-2 py-2 text-sm" type="number" min="2" max={Math.max(2,Number(raceStrategy?.track_snapshot?.laps||3)-2)} value={selection.planned_stop_lap||Math.round(Number(raceStrategy?.track_snapshot?.laps||0)/2)} onChange={(e)=>setRaceStrategy(did,{planned_stop_lap:Number(e.target.value)})}/>
                    </label>
                  ):raceStrategy?.rules_snapshot?.refuelling_allowed?(
                    <label className="text-xs text-gray-600">Fuel plan
                      <select className="mt-1 w-full border rounded-lg px-2 py-2 text-sm" value={selection.fuel_plan||"balanced"} onChange={(e)=>setRaceStrategy(did,{fuel_plan:e.target.value})}>
                        <option value="light_start">Light start / refuel</option>
                        <option value="balanced">Balanced</option>
                        <option value="heavy_start">Heavy start</option>
                      </select>
                    </label>
                  ):(
                    <div className="text-xs text-gray-500 border rounded-lg px-2 py-2">Fuel strategy disabled for this era.</div>
                  )}
                </div>
              </div>;
            })}
          </div>
          <div className="mt-3 text-xs text-gray-500">
            AI Teams use the same tyre, weather, pit-loss and era-rule model. In classic eras they prefer non-stop races unless degradation or weather makes a stop worthwhile.
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Starting Grid</h3>
              <p className="text-sm text-gray-600 mt-1">{startingGridRows.length} starters · {dnqRows.length} DNQ/DNPQ.</p>
            </div>
            {weekend.phase==="grid_ready"&&<span className="text-xs text-gray-500">Race day: {weekend.raceDate}</span>}
          </div>
          <div className="mt-3 overflow-x-auto border rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-right">Grid</th>
                  <th className="px-3 py-2 text-right">Qual</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-right">Best time</th>
                  <th className="px-3 py-2 text-right">Penalty</th>
                </tr>
              </thead>
              <tbody>
                {startingGridRows.map((row)=>(
                  <tr className="border-t" key={row.driver_id}>
                    <td className="px-3 py-2 text-right font-semibold">P{row.grid}</td>
                    <td className="px-3 py-2 text-right">P{row.qualifying_position??row.grid}</td>
                    <td className="px-3 py-2">{driverName(drivers,row.driver_id)}</td>
                    <td className="px-3 py-2">{teamName(teams,row.team_id)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatLapTime(row.best_time_ms)}</td>
                    <td className="px-3 py-2 text-right">{Number(row.penalty_places||0)>0?"+"+row.penalty_places:"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {dnqRows.length>0&&(
            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2">Did not qualify</h4>
              <QualifyingTable rows={dnqRows} drivers={drivers} teams={teams} overall/>
            </div>
          )}

          {weekend.phase==="grid_ready"?(
            <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={continueRaceWeekend}>
              {busy?"Advancing…":"Advance to Race Day"}
            </button>
          ):(
            <button disabled={busy} className="mt-4 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={()=>perform(runRace)}>
              {busy?"Running…":"Run Race"}
            </button>
          )}
        </div>
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

        {Array.isArray(lastResult?.classification)&&lastResult.classification.length>0&&(
          <div className="mt-4 overflow-x-auto border rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-right">Finish</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Tyres / Stops</th>
                  <th className="px-3 py-2 text-right">Time / Gap</th>
                  <th className="px-3 py-2 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {lastResult.classification.map((row,index)=>{
                  const status=String(row.status||(row.retired?"DNF":"Finished"));
                  const gap=index===0
                    ?formatRaceTime(row.total_time_ms)
                    :row.retired
                      ?(row.retirement_reason||status)
                      :Number.isFinite(Number(row.gap_to_winner_ms))
                        ?"+"+(Number(row.gap_to_winner_ms)/1000).toFixed(3)+"s"
                        :"—";
                  return <tr className="border-t" key={row.driver_id||index}>
                    <td className="px-3 py-2 text-right font-semibold">P{row.position??index+1}</td>
                    <td className="px-3 py-2">{driverName(drivers,row.driver_id)}</td>
                    <td className="px-3 py-2">{teamName(teams,row.team_id)}</td>
                    <td className="px-3 py-2"><span className={"rounded px-2 py-1 text-xs "+statusClass(status)}>{status}</span></td>
                    <td className="px-3 py-2 text-xs">
                      <div>{row.tyre_supplier||"—"} · {tyreName(gs?.tyres,row.start_tyre_id)}</div>
                      <div className="text-gray-500">{row.strategy_summary?.pit_count??row.pit_stops?.length??0} stop(s){row.strategy_summary?.pit_laps?.length?" · L"+row.strategy_summary.pit_laps.join(", "):""}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{gap}</td>
                    <td className="px-3 py-2 text-right font-medium">{row.points??0}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm" onClick={()=>navigate("/Results")}>Open Full Results</button>
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
