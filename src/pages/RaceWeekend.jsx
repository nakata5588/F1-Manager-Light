// src/pages/RaceWeekend.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { PRACTICE_PROGRAMMES } from "../engine/PracticeSetupEngine.js";
import { PIT_PLANS, RACE_PACE_MODES, tyresForTeam } from "../engine/RaceStrategyEngine.js";
import { TeamLogo } from "../components/entity/EntityVisuals.jsx";

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
function formatInterval(ms,{leader=false}={}){
  const n=Number(ms);
  if(leader)return "LEADER";
  if(!Number.isFinite(n)||n<0)return "—";
  return "+"+(n/1000).toFixed(3);
}
function positionDelta(value){
  const n=Number(value)||0;
  if(n>0)return "▲ "+n;
  if(n<0)return "▼ "+Math.abs(n);
  return "—";
}
function pitWindowLabel(window){
  if(!window)return "Stay out";
  if(Number(window.from_lap)===Number(window.to_lap))return "L"+window.from_lap;
  return "L"+window.from_lap+"–"+window.to_lap;
}
function paceLabel(mode){
  return RACE_PACE_MODES?.[String(mode)]?.label||String(mode||"Balanced").replaceAll("_"," ");
}
function liveEventText(event,drivers){
  const name=event?.driver_id?driverName(drivers,event.driver_id):null;
  const raw=String(event?.message||event?.type||"");
  if(!name)return raw;
  const id=String(event.driver_id);
  if(raw.startsWith(id+":"))return name+raw.slice(id.length);
  if(raw.startsWith(id+" "))return name+raw.slice(id.length);
  return raw.includes(name)?raw:name+" · "+raw;
}
function raceWindowForPhase(phase,hasLive=false){
  if(phase==="practice"||phase==="practice_complete")return "practice";
  if(phase==="qualifying"||phase==="qualifying_wait")return "qualifying";
  if(phase==="grid_ready")return "strategy";
  if(phase==="race")return hasLive?"live":"grid";
  if(phase==="results"||phase==="completed")return "classification";
  return "overview";
}
function statusClass(status){
  const key=String(status||"").toUpperCase();
  if(["QUALIFIED","ADVANCED","STARTER","CONTINUES","FINISHED"].includes(key))return "bg-emerald-500/15 text-emerald-300";
  if(["DNQ","DNPQ","ELIMINATED","DNF","RETIRED"].includes(key))return "bg-amber-500/15 text-amber-300";
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
    {title&&<div className="px-4 py-3 bg-[#121722] border-b flex flex-wrap items-center justify-between gap-2">
      <div className="font-medium text-sm">{title}</div>
      <div className="text-xs text-slate-500">{ordered.length} drivers</div>
    </div>}
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-[#121722]">
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
                <td className="px-3 py-2 text-right font-mono text-slate-500">{formatGap(time,best)}</td>
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
  const startLiveRace=useGame((s)=>s.startRaceWeekendLiveRace);
  const advanceLiveRace=useGame((s)=>s.advanceRaceWeekendLiveRace);
  const setLiveCommand=useGame((s)=>s.setRaceWeekendLiveCommand);
  const resumeLiveRace=useGame((s)=>s.resumeRaceWeekendLiveRace);
  const continueWeekend=useGame((s)=>s.continueRaceWeekendSession);
  const advance=useGame((s)=>s.advanceOneDayUntilBreak);
  const [busy,setBusy]=useState(false);
  const [activeWindow,setActiveWindow]=useState("overview");

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
  const liveRace=weekend?.live_race||null;
  const liveRows=liveRace?.classification||[];
  const trackState=liveRace?.track_state||null;
  const timingSummary=liveRace?.timing_summary||null;
  const liveBestSectors=useMemo(()=>{
    const values=(key)=>liveRows.map((row)=>Number(row?.[key])).filter((value)=>Number.isFinite(value)&&value>0);
    const s1=values("sector_1_ms"),s2=values("sector_2_ms"),s3=values("sector_3_ms");
    return {
      sector_1_ms:s1.length?Math.min(...s1):null,
      sector_2_ms:s2.length?Math.min(...s2):null,
      sector_3_ms:s3.length?Math.min(...s3):null,
    };
  },[liveRows]);
  const raceControlPlan=raceStrategy?.race_control_plan||null;
  const raceControlRules=raceControlPlan?.rules||null;
  const weekendWeather=weekend?.weekend_weather||null;
  const weatherObserved=new Set(weekendWeather?.observed_sessions||[]);
  const weatherSessionRows=(weekend?.sessions||[]).filter((session)=>weekendWeather?.sessions?.[String(session?.id||"")]);
  const activeWeather=weekendWeather?.sessions?.[String(weekend?.active_session_id||"")]||null;
  const raceWeatherRow=Object.values(weekendWeather?.sessions||{}).find((row)=>row?.kind==="race")||null;
  const raceForecast=raceWeatherRow?weekendWeather?.forecast?.[String(raceWeatherRow.id)]:null;
  const completedQualifyingSessions=qualifyingSessions.filter((session)=>session.status==="completed");
  const lastCompletedQualifyingSession=completedQualifyingSessions.at(-1)||null;
  const confirmedEntrants=(weekend?.entrants||[]).filter((row)=>row?.status==="confirmed"&&row?.driver_id);
  const qualifyingCutoff=Number(weekend?.qualifying_rule_snapshot?.max_starters??weekend?.qualifying?.cutoff_position);
  useEffect(()=>{
    setActiveWindow(raceWindowForPhase(weekend?.phase,Boolean(liveRace)));
  },[weekend?.phase,Boolean(liveRace)]);

  const lastResult=useMemo(()=>{
    const key=weekend?.race_result_key;
    if(!key)return null;
    return (gs?.results||[]).find((row)=>row?.key===key)||null;
  },[gs?.results,weekend?.race_result_key]);

  const driverStandings=gs?.standings?.drivers||[];
  const constructorStandings=gs?.standings?.teams||gs?.standings?.constructors||[];
  const driverStandingById=new Map(driverStandings.map((row,index)=>[
    String(row?.driver_id??row?.id??""),
    {position:Number(row?.position??index+1),points:Number(row?.points??0)},
  ]));
  const constructorStandingById=new Map(constructorStandings.map((row,index)=>[
    String(row?.team_id??row?.constructor_id??row?.id??""),
    {position:Number(row?.position??index+1),points:Number(row?.points??0)},
  ]));

  const terminalWeekend=["results","completed"].includes(String(weekend?.phase));
  const windowTabs=[
    {id:"overview",label:"Overview",enabled:true},
    {id:"practice",label:"Practice",enabled:!terminalWeekend&&(Boolean(weekend?.practice)||["practice","practice_complete"].includes(String(weekend?.phase)))},
    {id:"qualifying",label:"Qualifying",enabled:!terminalWeekend&&qualifyingSessions.length>0},
    {id:"strategy",label:"Strategy",enabled:["grid_ready","race"].includes(String(weekend?.phase))&&Boolean(raceStrategy)},
    {id:"grid",label:"Starting Grid",enabled:["grid_ready","race"].includes(String(weekend?.phase))&&startingGridRows.length>0},
    {id:"live",label:"Live Timing",enabled:String(weekend?.phase)==="race"},
    {id:"classification",label:"Classification",enabled:Boolean(lastResult)||terminalWeekend},
  ];

  if(!weekend){
    return <div className="min-h-[calc(100vh-3.5rem)] bg-black p-6 text-slate-100">
      <div className="rounded-xl border border-white/10 bg-[#0b0e14] p-5">
        <h2 className="text-lg font-semibold">Race Weekend</h2>
        <p className="text-sm text-slate-400 mt-1">No active race weekend. Advance the calendar to the next Grand Prix weekend.</p>
      </div>
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

  return <div className="min-h-[calc(100vh-3.5rem)] bg-black p-4 md:p-6 text-slate-100 grid gap-4 content-start">
    <div className="rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Round {weekend.round}</div>
          <h2 className="text-xl font-semibold">{weekend.gp_name}</h2>
          <div className="text-sm text-slate-400 mt-1">
            {(weekend.sessions||[]).map((session)=>`${session.label} ${session.dateISO}`).join(" · ")}
          </div>
        </div>
        <div className="text-sm px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
          {String(weekend.phase||"").replaceAll("_"," ")}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 mt-5">
        {STEPS.map(([id,label],index)=>{
          const state=index<currentIndex?"complete":index===currentIndex?"active":"upcoming";
          const cls=state==="complete"
            ?"bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
            :state==="active"
              ?"bg-slate-100 border-slate-100 text-slate-950"
              :"bg-white/[0.03] border-white/10 text-slate-500";
          return <div key={id} className={`border rounded-lg px-2 py-3 text-center text-xs md:text-sm font-medium ${cls}`}>
            {label}
          </div>;
        })}
      </div>
    </div>

    <nav className="sticky top-14 z-40 -mx-4 md:-mx-6 px-4 md:px-6 border-y border-white/10 bg-black/95 backdrop-blur">
      <div className="flex gap-1 overflow-x-auto py-2">
        {windowTabs.map((tab)=>(
          <button
            type="button"
            key={tab.id}
            disabled={!tab.enabled}
            onClick={()=>tab.enabled&&setActiveWindow(tab.id)}
            className={
              "shrink-0 rounded-md px-3 py-2 text-xs font-semibold transition "+
              (activeWindow===tab.id
                ?"bg-slate-100 text-slate-950"
                :tab.enabled
                  ?"border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                  :"border border-white/5 bg-white/[0.02] text-slate-700 cursor-not-allowed")
            }
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>

    {activeWindow==="overview"&&weekendWeather&&(
      <div className="rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h3 className="font-semibold">Weekend Weather Centre</h3>
            <p className="text-sm text-slate-400 mt-1">
              Forecasts are estimates. Actual conditions are fixed in the Save, while forecast confidence improves as the weekend progresses.
            </p>
          </div>
          <div className="text-xs text-slate-500 md:text-right">
            <div>Team forecast capability {Math.round(Number(weekendWeather.forecast_accuracy||0)*100)}%</div>
            <div>Revision {Number(weekendWeather.forecast_revision||0)+1}</div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {weatherSessionRows.map((session)=>{
            const sid=String(session.id);
            const actual=weekendWeather.sessions?.[sid];
            const forecast=weekendWeather.forecast?.[sid];
            const current=String(weekend.active_session_id||"")===sid&&["practice","qualifying","race"].includes(String(weekend.phase));
            const known=weatherObserved.has(sid)||current;
            const state=known?actual?.state:forecast?.predicted_state;
            return <div key={sid} className={"border rounded-xl p-3 "+(current?"ring-2 ring-slate-300":"")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{session.label}</div>
                  <div className="text-xs text-slate-500">{session.dateISO}</div>
                </div>
                <span className={"text-[11px] rounded px-2 py-1 "+(known?"bg-emerald-500/15 text-emerald-300":"bg-blue-500/15 text-blue-300")}>
                  {current?"LIVE":known?"OBSERVED":"FORECAST"}
                </span>
              </div>
              <div className="mt-3 font-semibold">{String(state||"UNKNOWN").replaceAll("_"," ")}</div>
              {known?<div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-400">
                <div>Air {Number(actual?.air_temp_c||0).toFixed(1)}°C</div>
                <div>Track {Number(actual?.track_temp_c||0).toFixed(1)}°C</div>
                <div>Wetness {Math.round(Number(actual?.track?.start_wetness||0)*100)}%</div>
                <div>Grip {Number(actual?.track?.grip_index||0).toFixed(0)}%</div>
                <div>Rubber {Number(actual?.track?.rubber_level||0).toFixed(0)}%</div>
                <div>Rain {Math.round(Number(actual?.rain_intensity||0)*100)}%</div>
              </div>:<div className="mt-2 text-xs text-slate-400">
                Rain {Number(forecast?.rain_chance_pct||0).toFixed(0)}% · Air {Number(forecast?.air_temp_c||0).toFixed(1)}°C ±{Number(forecast?.temperature_range_c||0).toFixed(1)} · confidence {Number(forecast?.confidence_pct||0).toFixed(0)}%
              </div>}
            </div>;
          })}
        </div>
      </div>
    )}

    {activeWindow==="practice"&&weekend.phase==="practice"&&(
      <div className="grid gap-4">
        <div className="rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl">
          <h3 className="font-semibold">Practice Programmes</h3>
          <p className="text-sm text-slate-400 mt-1">
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
                    <div className="text-xs text-slate-500">{teamName(teams,entry.team_id)}</div>
                  </div>
                  <select
                    className="border border-white/10 bg-[#090c11] text-slate-100 rounded-lg px-3 py-2 text-sm min-w-[210px]"
                    value={selected}
                    onChange={(e)=>setPracticeProgramme(did,e.target.value)}
                  >
                    {Object.values(PRACTICE_PROGRAMMES).map((programme)=>(
                      <option key={programme.id} value={programme.id}>{programme.label}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-2 text-sm text-slate-400">{PRACTICE_PROGRAMMES[selected]?.description||PRACTICE_PROGRAMMES.balanced.description}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="bg-white/[0.06] text-slate-300 rounded px-2 py-1">Current fatigue {currentFatigue(gs,did).toFixed(0)}/100</span>
                  <span className="bg-white/[0.06] text-slate-300 rounded px-2 py-1">Practice load +{PRACTICE_PROGRAMMES[selected]?.fatigue??5}</span>
                  <span className="bg-white/[0.06] text-slate-300 rounded px-2 py-1">Mileage ×{Number(PRACTICE_PROGRAMMES[selected]?.mileageFactor??1).toFixed(2)}</span>
                  <span className="bg-white/[0.06] text-slate-300 rounded px-2 py-1">Component wear ×{Number(PRACTICE_PROGRAMMES[selected]?.wearFactor??1).toFixed(2)}</span>
                </div>
              </div>;
            })}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            AI teams select programmes from the same five options using car reliability, staff support, driver profile and the session conditions. Wet running improves wet-condition knowledge but can be less representative of a dry Qualifying or Race.
          </div>
          <button disabled={busy} className="mt-4 rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm disabled:opacity-50" onClick={()=>perform(runPractice)}>
            {busy?"Running…":"Run Practice"}
          </button>
        </div>
      </div>
    )}

    {activeWindow==="practice"&&Boolean(weekend.practice)&&weekend.phase!=="practice"&&(
      <div className="grid gap-4">
        <div className="rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <h3 className="font-semibold">Practice Complete</h3>
              <p className="text-sm text-slate-400 mt-1">Setup, Preparation, fatigue and component wear have been committed to the Save.</p>
            </div>
            <div className="text-xs text-slate-500">
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
                <div className="text-xs text-slate-500">{label}</div>
                <div className="font-semibold">{label==="Lap Length"?`${Number(value||0).toFixed(2)} km`:Math.round(Number(value)||0)}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">The exact ideal setup remains hidden. Driver feedback and Setup Quality show how close the team is to the working window.</p>

          <div className="mt-4 grid gap-3">
            {playerPracticeResults.map((row)=>(
              <div key={row.driver_id} className="border rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{driverName(drivers,row.driver_id)}</div>
                    <div className="text-xs text-slate-500">{row.programme_label}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="bg-emerald-500/15 text-emerald-300 rounded px-2 py-1">Setup {Math.round(row.setup_quality)}%</span>
                    <span className="bg-blue-500/15 text-blue-300 rounded px-2 py-1">Knowledge {Math.round(row.setup_knowledge)}%</span>
                    <span className="bg-white/[0.06] text-slate-300 rounded px-2 py-1">Preparation +{Number(row.preparation_gain).toFixed(1)}</span>
                    <span className="bg-white/[0.06] text-slate-300 rounded px-2 py-1">Fatigue {Number(row.fatigue_before??0).toFixed(0)} → {Number(row.fatigue_after??row.fatigue_cost??0).toFixed(0)}</span>
                    <span className="bg-white/[0.06] text-slate-300 rounded px-2 py-1">Learning efficiency {Number(row.fatigue_efficiency??100).toFixed(0)}%</span>
                    <span className="bg-amber-500/15 text-amber-300 rounded px-2 py-1">Component wear {Number(row.component_wear?.total_wear??0).toFixed(1)}</span>
                    <span className="bg-cyan-500/15 text-cyan-300 rounded px-2 py-1">Race relevance {Number(row.race_weather_relevance??0).toFixed(0)}%</span>
                    <span className="bg-violet-500/15 text-violet-300 rounded px-2 py-1">Qualifying relevance {Number(row.qualifying_weather_relevance??0).toFixed(0)}%</span>
                  </div>
                </div>
                <p className="mt-2 text-sm">{row.feedback}</p>
                {row.component_wear?.lowest_slot&&(
                  <p className="mt-1 text-xs text-slate-500">
                    Lowest component after Practice: {String(row.component_wear.lowest_slot).replaceAll("_"," ")} · {Number(row.component_wear.lowest_condition??0).toFixed(1)}%.
                  </p>
                )}
                {Number(row.fatigue_performance_penalty_before||0)>0&&(
                  <p className="mt-1 text-xs text-amber-300">
                    Existing fatigue reduced the driver's effective performance by about {Number(row.fatigue_performance_penalty_before).toFixed(1)} driver-score points before this session.
                  </p>
                )}
                {row.issue_note&&<p className="mt-2 text-sm text-amber-300">{row.issue_note}</p>}
              </div>
            ))}
          </div>

          {weekend.phase==="practice_complete"&&<button disabled={busy} className="mt-4 rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={continueRaceWeekend}>
            {busy?"Continuing…":activeSession?.dateISO===gs?.currentDateISO?"Continue to Qualifying":"Advance to Qualifying"}
          </button>}
        </div>
      </div>
    )}

    {activeWindow==="qualifying"&&weekend.phase==="qualifying"&&(
      <div className="rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h3 className="font-semibold">{activeSession?.label||"Qualifying"}</h3>
            <p className="text-sm text-slate-400 mt-1">
              Every entrant uses the same era rule, setup/preparation model and deterministic session seed. Completed sessions are locked into the Save.
            </p>
          </div>
          <div className="text-xs text-slate-500 text-right">
            <div>{activeSession?.dateISO||weekend.qualifyingDate}</div>
            <div>{weekend.qualifying_rule_snapshot?.strategy?.replaceAll("_"," ")||"era rules"}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Entrants</div><div className="font-semibold">{confirmedEntrants.length}</div></div>
          <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Race grid</div><div className="font-semibold">{Number.isFinite(qualifyingCutoff)?qualifyingCutoff:"—"}</div></div>
          <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Sessions</div><div className="font-semibold">{qualifyingSessions.length}</div></div>
          <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Format</div><div className="font-semibold capitalize">{String(weekend.qualifying_rule_snapshot?.strategy||"").replaceAll("_"," ")}</div></div>
        </div>

        {completedQualifyingSessions.length>0&&(
          <div className="mt-4 grid gap-4">
            {completedQualifyingSessions.map((session)=>(
              <QualifyingTable key={session.id} title={session.label+" — saved classification"} rows={session.results||[]} drivers={drivers} teams={teams} session={session}/>
            ))}
          </div>
        )}

        <button disabled={busy} className="mt-4 rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm disabled:opacity-50" onClick={()=>perform(runQualifying)}>
          {busy?"Running…":`Run ${activeSession?.label||"Qualifying"}`}
        </button>
      </div>
    )}

    {activeWindow==="qualifying"&&weekend.phase==="qualifying_wait"&&(
      <div className="rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl">
        <h3 className="font-semibold">{lastCompletedQualifyingSession?.label||"Qualifying"} Complete</h3>
        <p className="text-sm text-slate-400 mt-1">
          This classification is saved and will not be recalculated. Next: {activeSession?.label||"Qualifying"} on {activeSession?.dateISO||"the next session date"}.
        </p>
        {weekend.qualifying_rule_snapshot?.strategy==="best_time_across_sessions"&&!lastCompletedQualifyingSession?.advance_count&&(
          <div className="mt-3 rounded-lg bg-blue-500/15 text-blue-200 px-3 py-2 text-sm">
            No cars are eliminated after this session. The final order uses each driver's best valid time across all qualifying sessions.
          </div>
        )}
        {lastCompletedQualifyingSession&&(
          <div className="mt-4">
            <QualifyingTable title={lastCompletedQualifyingSession.label+" — classification"} rows={lastCompletedQualifyingSession.results||[]} drivers={drivers} teams={teams} session={lastCompletedQualifyingSession}/>
          </div>
        )}
        <button disabled={busy} className="mt-4 rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm disabled:opacity-50" onClick={continueRaceWeekend}>
          {busy?"Continuing…":activeSession?.dateISO===gs?.currentDateISO?"Continue to next session":"Advance toward next session"}
        </button>
      </div>
    )}

    {(weekend.phase==="grid_ready"||weekend.phase==="race")&&(
      <div className="grid gap-4">
        <div className={(activeWindow==="qualifying"?"":"hidden ")+"rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Overall Qualifying Classification</h3>
              <p className="text-sm text-slate-400 mt-1">
                Best qualifying times are final. {startingGridRows.length} cars qualified from {confirmedEntrants.length} entries.
              </p>
            </div>
            <span className="text-xs text-slate-500">Grid limit: {Number.isFinite(qualifyingCutoff)?qualifyingCutoff:"—"}</span>
          </div>
          <div className="mt-4">
            <QualifyingTable rows={classification} drivers={drivers} teams={teams} overall cutoff={qualifyingCutoff}/>
          </div>
        </div>

        <div className={(activeWindow==="strategy"?"":"hidden ")+"rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl"}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <h3 className="font-semibold">Race Strategy</h3>
              <p className="text-sm text-slate-400 mt-1">
                The race now resolves tyre life, temperature, weather transitions and pit losses lap by lap. Strategy rules are locked to this era.
              </p>
            </div>
            <div className="text-xs text-slate-500 md:text-right">
              <div>{raceStrategy?.rules_snapshot?.label||"Era rules"}</div>
              <div>{raceStrategy?.track_snapshot?.laps||"—"} laps · pit loss {Number(raceStrategy?.track_snapshot?.pit_lane_loss_s||0).toFixed(1)}s</div>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
            <span className="font-medium">Race forecast:</span>{" "}
            {String(raceForecast?.predicted_state||raceStrategy?.weather_snapshot?.state||"SUNNY").replaceAll("_"," ")}
            {" · "}{Number(raceForecast?.air_temp_c??raceStrategy?.weather_snapshot?.avg_temp_c??0).toFixed(0)}°C
            {" · rain "}{Number(raceForecast?.rain_chance_pct??raceStrategy?.weather_snapshot?.rain_chance_pct??0).toFixed(0)}%
            {raceForecast?<>{" · confidence "}{Number(raceForecast.confidence_pct||0).toFixed(0)}%</>:null}
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
                    <div className="text-xs text-slate-500">{supplier} · fatigue {currentFatigue(gs,did).toFixed(0)}/100</div>
                  </div>
                  <div className="text-xs text-slate-500">{raceStrategy?.rules_snapshot?.notes}</div>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
                  <label className="text-xs text-slate-400">Start tyre
                    <select className="mt-1 w-full border border-white/10 bg-[#090c11] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.start_tyre_id||""} onChange={(e)=>setRaceStrategy(did,{start_tyre_id:e.target.value})}>
                      {tyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>{tyre.compound_name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">Pace
                    <select className="mt-1 w-full border border-white/10 bg-[#090c11] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.pace_mode||"balanced"} onChange={(e)=>setRaceStrategy(did,{pace_mode:e.target.value})}>
                      {Object.values(RACE_PACE_MODES).map((mode)=><option key={mode.id} value={mode.id}>{mode.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">Pit plan
                    <select className="mt-1 w-full border border-white/10 bg-[#090c11] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.pit_plan||"adaptive"} onChange={(e)=>setRaceStrategy(did,{pit_plan:e.target.value})}>
                      {Object.values(PIT_PLANS).map((plan)=><option key={plan.id} value={plan.id}>{plan.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">Next tyre
                    <select className="mt-1 w-full border border-white/10 bg-[#090c11] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.next_tyre_id||selection.start_tyre_id||""} onChange={(e)=>setRaceStrategy(did,{next_tyre_id:e.target.value})}>
                      {tyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>{tyre.compound_name}</option>)}
                    </select>
                  </label>
                  {selection.pit_plan==="one_stop"?(
                    <label className="text-xs text-slate-400">Target lap
                      <input className="mt-1 w-full border border-white/10 bg-[#090c11] text-slate-100 rounded-lg px-2 py-2 text-sm" type="number" min="2" max={Math.max(2,Number(raceStrategy?.track_snapshot?.laps||3)-2)} value={selection.planned_stop_lap||Math.round(Number(raceStrategy?.track_snapshot?.laps||0)/2)} onChange={(e)=>setRaceStrategy(did,{planned_stop_lap:Number(e.target.value)})}/>
                    </label>
                  ):raceStrategy?.rules_snapshot?.refuelling_allowed?(
                    <label className="text-xs text-slate-400">Fuel plan
                      <select className="mt-1 w-full border border-white/10 bg-[#090c11] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.fuel_plan||"balanced"} onChange={(e)=>setRaceStrategy(did,{fuel_plan:e.target.value})}>
                        <option value="light_start">Light start / refuel</option>
                        <option value="balanced">Balanced</option>
                        <option value="heavy_start">Heavy start</option>
                      </select>
                    </label>
                  ):(
                    <div className="text-xs text-slate-500 border rounded-lg px-2 py-2">Fuel strategy disabled for this era.</div>
                  )}
                </div>
              </div>;
            })}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            AI Teams use the same tyre, weather, pit-loss and era-rule model. In classic eras they prefer non-stop races unless degradation or weather makes a stop worthwhile.
          </div>
        </div>

        {activeWindow==="live"&&weekend.phase==="race"&&liveRace&&(
          <div className="rounded-xl border border-white/10 bg-[#0b0e14] text-slate-100 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Advanced Live Timing</div>
                  <h3 className="mt-1 text-xl font-semibold">Live Race Control</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    Lap {liveRace.current_lap} / {liveRace.total_laps} · {String(liveRace.last_weather||raceStrategy?.weather_snapshot?.state||"SUNNY").replaceAll("_"," ")}
                    {" · "}{String(liveRace.current_control||"GREEN").replaceAll("_"," ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {liveRace.status==="running"&&<>
                    <button disabled={busy} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50" onClick={()=>perform(()=>advanceLiveRace(1))}>+1 Lap</button>
                    <button disabled={busy} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50" onClick={()=>perform(()=>advanceLiveRace(5))}>+5 Laps</button>
                    <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-3 py-2 text-sm font-semibold hover:bg-white disabled:opacity-50" onClick={()=>perform(()=>advanceLiveRace(Math.max(1,Number(liveRace.total_laps)-Number(liveRace.current_lap))))}>Run to Finish</button>
                  </>}
                  {liveRace.status==="red_flag"&&<button disabled={busy} className="rounded-lg bg-red-600 text-white px-3 py-2 text-sm font-semibold disabled:opacity-50" onClick={()=>perform(resumeLiveRace)}>
                    {busy?"Restarting…":"Restart Race"}
                  </button>}
                  {liveRace.status==="finished"&&<button disabled={busy} className="rounded-lg bg-emerald-500 text-slate-950 px-3 py-2 text-sm font-semibold disabled:opacity-50" onClick={()=>perform(runRace)}>Confirm Results</button>}
                </div>
              </div>

              <div className="mt-4 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-slate-200 transition-all" style={{width:`${Math.max(0,Math.min(100,(Number(liveRace.current_lap||0)/Math.max(1,Number(liveRace.total_laps||1)))*100))}%`}}/>
              </div>

              {liveRace.status==="red_flag"&&<div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/60 text-red-100 p-3 text-sm">
                <div className="font-semibold">RED FLAG — race suspended on lap {liveRace.current_lap}</div>
                <div className="mt-1 text-red-200/80">Cars are stopped. Restart style: {String(raceControlRules?.restart_style||"era rules").replaceAll("_"," ")}.</div>
              </div>}

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-sm">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Race Control</div><div className="font-semibold mt-1">{String(liveRace.current_control||"GREEN").replaceAll("_"," ")}</div></div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Rain</div><div className="font-semibold mt-1">{Math.round(Number(trackState?.rain_intensity||0)*100)}%</div></div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Wetness</div><div className="font-semibold mt-1">{Math.round(Number(trackState?.track_wetness||0)*100)}%</div></div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Grip / Visibility</div><div className="font-semibold mt-1">{Number(trackState?.grip_index??100).toFixed(0)}% / {Number(trackState?.visibility_index??100).toFixed(0)}%</div></div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Fastest Lap</div><div className="font-semibold mt-1">{formatLapTime(timingSummary?.fastest_lap_ms)}</div><div className="text-[11px] text-slate-500">{timingSummary?.fastest_lap_driver_id?driverName(drivers,timingSummary.fastest_lap_driver_id):"—"}{timingSummary?.fastest_lap_number?` · L${timingSummary.fastest_lap_number}`:""}</div></div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Running / DNF</div><div className="font-semibold mt-1">{timingSummary?.running_count??liveRows.filter((r)=>!r.retired).length} / {timingSummary?.retired_count??liveRows.filter((r)=>r.retired).length}</div></div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Field Spread</div><div className="font-semibold mt-1">{timingSummary&&Number(timingSummary.field_spread_ms)>0?formatInterval(timingSummary.field_spread_ms):"—"}</div></div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Era</div><div className="font-semibold mt-1 text-xs">{raceControlRules?.label||"Era rules"}</div></div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1680px] w-full text-xs">
                <thead className="bg-[#121722] text-slate-400 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-right">Pos</th>
                    <th className="px-2 py-2 text-center">±</th>
                    <th className="px-3 py-2 text-left">Driver</th>
                    <th className="px-3 py-2 text-right">Interval</th>
                    <th className="px-3 py-2 text-right">Leader</th>
                    <th className="px-3 py-2 text-right">S1</th>
                    <th className="px-3 py-2 text-right">S2</th>
                    <th className="px-3 py-2 text-right">S3</th>
                    <th className="px-3 py-2 text-right">Last</th>
                    <th className="px-3 py-2 text-right">Best</th>
                    <th className="px-3 py-2 text-left">Tyre</th>
                    <th className="px-3 py-2 text-right">Age</th>
                    <th className="px-3 py-2 text-right">Cond</th>
                    <th className="px-3 py-2 text-right">Temp</th>
                    <th className="px-3 py-2 text-right">Stops</th>
                    <th className="px-3 py-2 text-left">Pace</th>
                    <th className="px-3 py-2 text-left">Pit window</th>
                    <th className="px-3 py-2 text-right">Proj</th>
                  </tr>
                </thead>
                <tbody>
                  {liveRows.map((row,index)=>{
                    const mine=String(row.team_id||"")===playerTeamId;
                    const s1Fast=Number(row.sector_1_ms)>0&&Number(row.sector_1_ms)===Number(liveBestSectors.sector_1_ms);
                    const s2Fast=Number(row.sector_2_ms)>0&&Number(row.sector_2_ms)===Number(liveBestSectors.sector_2_ms);
                    const s3Fast=Number(row.sector_3_ms)>0&&Number(row.sector_3_ms)===Number(liveBestSectors.sector_3_ms);
                    const gain=Number(row.position_gain)||0;
                    return <tr className={"border-t border-white/5 "+(mine?"bg-white/[0.06]":"hover:bg-white/[0.025]")} key={row.driver_id}>
                      <td className="px-3 py-2 text-right text-sm font-bold">P{row.position??index+1}</td>
                      <td className={"px-2 py-2 text-center font-semibold "+(gain>0?"text-emerald-400":gain<0?"text-rose-400":"text-slate-600")}>{positionDelta(gain)}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-100">{driverName(drivers,row.driver_id)}</div>
                        <div className="text-[11px] text-slate-500">{teamName(teams,row.team_id)} · Grid P{row.grid_position??"—"}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{row.retired?"—":index===0?"LEADER":formatInterval(row.interval_ms)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-400">{row.retired?(row.retirement_reason||"DNF"):index===0?"—":formatInterval(row.gap_to_leader_ms)}</td>
                      <td className={"px-3 py-2 text-right font-mono "+(s1Fast?"text-fuchsia-300":"text-slate-300")}>{formatLapTime(row.sector_1_ms)}</td>
                      <td className={"px-3 py-2 text-right font-mono "+(s2Fast?"text-fuchsia-300":"text-slate-300")}>{formatLapTime(row.sector_2_ms)}</td>
                      <td className={"px-3 py-2 text-right font-mono "+(s3Fast?"text-fuchsia-300":"text-slate-300")}>{formatLapTime(row.sector_3_ms)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatLapTime(row.last_lap_ms)}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-300">{formatLapTime(row.best_lap_ms)}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold">{row.tyre?.compound||tyreName(gs?.tyres,row.tyre?.tyre_id)}</div>
                        {row.retired?<div className="text-[10px] text-amber-300">DNF · L{row.incident_lap}</div>:null}
                      </td>
                      <td className="px-3 py-2 text-right">{row.tyre?.age_laps??"—"}L</td>
                      <td className="px-3 py-2 text-right">{Number.isFinite(Number(row.tyre?.condition))?Number(row.tyre.condition).toFixed(0)+"%":"—"}</td>
                      <td className="px-3 py-2 text-right">{Number.isFinite(Number(row.tyre?.temperature_c))?Number(row.tyre.temperature_c).toFixed(0)+"°":"—"}</td>
                      <td className="px-3 py-2 text-right">{row.pit_count??0}</td>
                      <td className="px-3 py-2">{paceLabel(row.current_pace)}</td>
                      <td className="px-3 py-2"><span className="rounded bg-white/5 px-2 py-1">{pitWindowLabel(row.pit_window)}</span></td>
                      <td className="px-3 py-2 text-right font-semibold">P{row.projected_finish_position??"—"}</td>
                    </tr>;
                  })}
                  {!liveRows.length?<tr><td colSpan={18} className="px-4 py-6 text-center text-slate-500">Race timing will populate after the first completed lap.</td></tr>:null}
                </tbody>
              </table>
            </div>

            <div className="border-t border-white/10 p-4 grid gap-3 xl:grid-cols-2">
              {playerEntrants.map((entry)=>{
                const did=String(entry.driver_id);
                const teamTyres=tyresForTeam(gs,String(entry.team_id??""));
                const commands=raceStrategy?.live_commands?.[did]||[];
                const liveDriver=liveRows.find((row)=>String(row.driver_id)===did);
                const latestPace=liveDriver?.current_pace||commands.filter((row)=>row.type==="pace").at(-1)?.pace_mode||raceStrategy?.selections?.[did]?.pace_mode||"balanced";
                const unavailable=liveRace.status!=="running"||Boolean(liveDriver?.retired);
                return <div className="rounded-xl border border-white/10 bg-[#121722] p-4" key={did}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">Your car</div>
                      <div className="font-semibold text-lg">{driverName(drivers,did)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg">P{liveDriver?.position??"—"} <span className="text-xs font-normal text-slate-500">→ projected P{liveDriver?.projected_finish_position??"—"}</span></div>
                      <div className={"text-xs "+(Number(liveDriver?.position_gain)>0?"text-emerald-400":Number(liveDriver?.position_gain)<0?"text-rose-400":"text-slate-500")}>{positionDelta(liveDriver?.position_gain)} from grid</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                    <div className="rounded bg-white/5 p-2"><div className="text-slate-500">Tyre</div><div className="font-semibold">{liveDriver?.tyre?.compound||"—"} · {liveDriver?.tyre?.age_laps??0}L</div></div>
                    <div className="rounded bg-white/5 p-2"><div className="text-slate-500">Condition</div><div className="font-semibold">{Number.isFinite(Number(liveDriver?.tyre?.condition))?Number(liveDriver.tyre.condition).toFixed(0)+"%":"—"}</div></div>
                    <div className="rounded bg-white/5 p-2"><div className="text-slate-500">Tyre temp</div><div className="font-semibold">{Number.isFinite(Number(liveDriver?.tyre?.temperature_c))?Number(liveDriver.tyre.temperature_c).toFixed(0)+"°C":"—"}</div></div>
                    <div className="rounded bg-white/5 p-2"><div className="text-slate-500">Stops</div><div className="font-semibold">{liveDriver?.pit_count??0}</div></div>
                    <div className="rounded bg-white/5 p-2"><div className="text-slate-500">Pit window</div><div className="font-semibold">{pitWindowLabel(liveDriver?.pit_window)}</div></div>
                    <div className="rounded bg-white/5 p-2"><div className="text-slate-500">Best lap</div><div className="font-semibold font-mono">{formatLapTime(liveDriver?.best_lap_ms)}</div></div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-400">Pace next lap
                      <select disabled={unavailable} className="mt-1 w-full border border-white/10 bg-[#0b0e14] text-slate-100 rounded-lg px-2 py-2 text-sm disabled:opacity-50" value={latestPace} onChange={(e)=>setLiveCommand({driverId:did,type:"pace",paceMode:e.target.value})}>
                        {Object.values(RACE_PACE_MODES).map((mode)=><option key={mode.id} value={mode.id}>{mode.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-slate-400">Pit next lap
                      <select disabled={unavailable} className="mt-1 w-full border border-white/10 bg-[#0b0e14] text-slate-100 rounded-lg px-2 py-2 text-sm disabled:opacity-50" value="" onChange={(e)=>{if(e.target.value)setLiveCommand({driverId:did,type:"pit",tyreId:e.target.value});}}>
                        <option value="">Stay out</option>
                        {teamTyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>Pit → {tyre.compound_name}</option>)}
                      </select>
                    </label>
                  </div>
                </div>;
              })}
            </div>

            {(liveRace.events||[]).length>0&&<div className="border-t border-white/10 bg-[#090c11] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Race feed</div>
              <div className="mt-2 grid gap-1 text-sm">{(liveRace.events||[]).slice(-8).reverse().map((event,index)=><div className="flex gap-2" key={index}><span className="font-mono text-slate-500">L{event.lap}</span><span>{liveEventText(event,drivers)}</span></div>)}</div>
            </div>}
          </div>
        )}

        <div className={(activeWindow==="grid"?"":"hidden ")+"rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl"}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Starting Grid</h3>
              <p className="text-sm text-slate-400 mt-1">{startingGridRows.length} starters · {dnqRows.length} DNQ/DNPQ.</p>
            </div>
            {weekend.phase==="grid_ready"&&<span className="text-xs text-slate-500">Race day: {weekend.raceDate}</span>}
          </div>
          <div className="mt-3 overflow-x-auto border rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-[#121722]">
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
            <button disabled={busy} className="mt-4 rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm disabled:opacity-50" onClick={continueRaceWeekend}>
              {busy?"Advancing…":"Advance to Race Day"}
            </button>
          ):!liveRace?(
            <button disabled={busy} className="mt-4 rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm disabled:opacity-50" onClick={()=>perform(startLiveRace)}>
              {busy?"Preparing…":"Start Race"}
            </button>
          ):null}
        </div>
      </div>
    )}

    {activeWindow==="classification"&&weekend.phase==="results"&&(
      <div className="rounded-xl border border-white/10 bg-[#0b0e14] shadow-xl overflow-hidden">
        {(()=>{
          const rows=Array.isArray(lastResult?.classification)?lastResult.classification:[];
          const gridByDriver=new Map((lastResult?.startingGrid||startingGridRows||[]).map((row,index)=>[
            String(row?.driver_id??""),
            Number(row?.grid??index+1),
          ]));
          const winner=rows[0]||null;
          const fastest=rows.find((row)=>row?.fastest_lap)||rows
            .filter((row)=>Number.isFinite(Number(row?.best_lap_ms))&&Number(row.best_lap_ms)>0)
            .slice().sort((a,b)=>Number(a.best_lap_ms)-Number(b.best_lap_ms))[0]||null;
          const retirements=rows.filter((row)=>row?.retired||String(row?.status).toUpperCase()==="DNF").length;
          const weatherState=String(lastResult?.weather?.state||raceStrategy?.weather_snapshot?.state||"—").replaceAll("_"," ");
          return <>
            <div className="p-5 border-b border-white/10">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Official Classification</div>
                  <h3 className="mt-1 text-2xl font-semibold">{lastResult?.name||weekend.gp_name}</h3>
                  <div className="mt-1 text-sm text-slate-400">Round {lastResult?.round??weekend.round} · {lastResult?.dateISO||weekend.raceDate}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Winner</div>
                  <div className="text-lg font-bold">{winner?driverName(drivers,winner.driver_id):"—"}</div>
                  <div className="text-xs text-slate-400">{winner?teamName(teams,winner.team_id):"—"}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Race Time</div>
                  <div className="mt-1 font-semibold font-mono">{formatRaceTime(winner?.total_time_ms)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Fastest Lap</div>
                  <div className="mt-1 font-semibold font-mono">{formatLapTime(fastest?.best_lap_ms)}</div>
                  <div className="text-[11px] text-slate-500">{fastest?driverName(drivers,fastest.driver_id):"—"}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Retirements</div>
                  <div className="mt-1 font-semibold">{retirements} / {rows.length}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Conditions</div>
                  <div className="mt-1 font-semibold">{weatherState}</div>
                  <div className="text-[11px] text-slate-500">{Number(lastResult?.weather?.avg_temp_c||0)>0?Number(lastResult.weather.avg_temp_c).toFixed(0)+"°C air":"Race weather"}</div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1320px] w-full text-sm">
                <thead className="bg-[#121722] text-slate-400 uppercase tracking-wide text-[11px]">
                  <tr>
                    <th className="px-3 py-2 text-right">Pos</th>
                    <th className="px-2 py-2 text-center">±</th>
                    <th className="px-3 py-2 text-left">Driver</th>
                    <th className="px-3 py-2 text-left">Team</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Stops</th>
                    <th className="px-3 py-2 text-right">Best Lap</th>
                    <th className="px-3 py-2 text-right">Time / Gap</th>
                    <th className="px-3 py-2 text-right">Race Pts</th>
                    <th className="px-3 py-2 text-right">Championship</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row,index)=>{
                    const did=String(row?.driver_id??"");
                    const tid=String(row?.team_id??"");
                    const finish=Number(row?.position??index+1);
                    const grid=Number(gridByDriver.get(did)||finish);
                    const delta=grid-finish;
                    const status=String(row?.status||(row?.retired?"DNF":"Finished"));
                    const gap=index===0
                      ?formatRaceTime(row?.total_time_ms)
                      :row?.retired
                        ?(row?.retirement_reason||status)+(row?.incident_lap?" · L"+row.incident_lap:"")
                        :Number.isFinite(Number(row?.gap_to_winner_ms))
                          ?formatInterval(row.gap_to_winner_ms)
                          :"—";
                    const standing=driverStandingById.get(did);
                    const teamStanding=constructorStandingById.get(tid);
                    return <tr key={did||index} className={"border-t border-white/5 "+(tid===playerTeamId?"bg-white/[0.06]":"hover:bg-white/[0.025]")}>
                      <td className="px-3 py-3 text-right text-base font-bold">P{finish}</td>
                      <td className={"px-2 py-3 text-center font-semibold "+(delta>0?"text-emerald-400":delta<0?"text-rose-400":"text-slate-600")}>{positionDelta(delta)}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-100">{driverName(drivers,did)}</div>
                        <div className="text-[11px] text-slate-500">Grid P{grid}{row?.fastest_lap?" · Fastest lap":""}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <TeamLogo teamId={tid} name={teamName(teams,tid)} size="h-7 w-7" className="p-0.5"/>
                          <div>
                            <div className="font-medium">{teamName(teams,tid)}</div>
                            <div className="text-[11px] text-slate-500">{teamStanding?"Constructors P"+teamStanding.position+" · "+teamStanding.points+" pts":"—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={"rounded px-2 py-1 text-xs "+(row?.retired?"bg-amber-500/15 text-amber-300":"bg-emerald-500/15 text-emerald-300")}>{status}</span>
                        {Number.isFinite(Number(row?.laps_completed))&&<div className="mt-1 text-[11px] text-slate-500">{row.laps_completed}/{row.race_laps??row.laps_completed} laps</div>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="font-semibold">{row?.strategy_summary?.pit_count??row?.pit_stops?.length??0}</div>
                        <div className="text-[11px] text-slate-500">{row?.strategy_summary?.pit_laps?.length?"L"+row.strategy_summary.pit_laps.join(", "):"—"}</div>
                      </td>
                      <td className={"px-3 py-3 text-right font-mono "+(row?.fastest_lap?"text-fuchsia-300 font-semibold":"")}>{formatLapTime(row?.best_lap_ms)}</td>
                      <td className="px-3 py-3 text-right font-mono">{gap}</td>
                      <td className="px-3 py-3 text-right font-bold">{row?.points??0}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="font-bold">{standing?"P"+standing.position:"—"}</div>
                        <div className="text-[11px] text-slate-500">{standing?standing.points+" pts":"—"}</div>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-white/10 flex flex-wrap gap-2">
              <button className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10" onClick={()=>navigate("/Results")}>Open Full Results</button>
              <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={advanceSession}>
                {busy?"Advancing…":"Continue after Grand Prix"}
              </button>
            </div>
          </>;
        })()}
      </div>
    )}

    {activeWindow==="classification"&&weekend.phase==="completed"&&(
      <div className="rounded-xl border border-white/10 bg-[#0b0e14] p-5 shadow-xl">
        <h3 className="font-semibold">Weekend Complete</h3>
        <button className="mt-3 rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm" onClick={()=>navigate("/Home")}>Return Home</button>
      </div>
    )}
  </div>;
}
