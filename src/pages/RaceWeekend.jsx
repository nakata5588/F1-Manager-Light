// src/pages/RaceWeekend.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { PRACTICE_PROGRAMMES } from "../engine/PracticeSetupEngine.js";
import { PIT_PLANS, RACE_PACE_MODES, tyresForTeam } from "../engine/RaceStrategyEngine.js";
import { conditionModifierBreakdown, practiceWeekendImpact } from "../domain/driverPerformance.js";
import { DriverPortrait, TeamLogo } from "../components/entity/EntityVisuals.jsx";
import { Activity, CircleDot, Droplets, Flag, Gauge, Thermometer, Timer, Wrench } from "lucide-react";

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
function driverObject(drivers,id){
  return (drivers||[]).find((row)=>driverId(row)===String(id))||null;
}
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
function signedLapDelta(ms){
  const n=Number(ms);
  if(!Number.isFinite(n))return "—";
  if(Math.abs(n)<1)return "±0.000";
  return (n>0?"+":"−")+(Math.abs(n)/1000).toFixed(3);
}
function lapDeltaTone(ms){
  const n=Number(ms);
  if(!Number.isFinite(n)||Math.abs(n)<1)return "text-slate-500";
  return n<0?"text-emerald-400":"text-rose-400";
}
function fatigueTone(value){
  const n=Number(value)||0;
  if(n<=25)return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  if(n<=55)return "text-amber-300 bg-amber-500/10 border-amber-500/20";
  if(n<=75)return "text-orange-300 bg-orange-500/10 border-orange-500/20";
  return "text-rose-300 bg-rose-500/10 border-rose-500/20";
}
function wearTone(multiplier){
  const n=Number(multiplier)||1;
  if(n<=0.85)return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  if(n<=1.05)return "text-slate-200 bg-white/[0.04] border-white/10";
  if(n<=1.20)return "text-amber-300 bg-amber-500/10 border-amber-500/20";
  return "text-rose-300 bg-rose-500/10 border-rose-500/20";
}
function conditionTone(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "text-slate-400 bg-white/[0.04]";
  if(n>=70)return "text-emerald-300 bg-emerald-500/10";
  if(n>=40)return "text-amber-300 bg-amber-500/10";
  if(n>=20)return "text-orange-300 bg-orange-500/10";
  return "text-rose-300 bg-rose-500/15";
}
function paceTone(mode){
  const key=String(mode||"balanced");
  if(key==="attack")return "text-rose-300 bg-rose-500/10";
  if(key==="conserve")return "text-cyan-300 bg-cyan-500/10";
  return "text-slate-200 bg-white/[0.04]";
}
function temperatureTone(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "text-slate-400";
  if(n<75)return "text-cyan-300";
  if(n<=105)return "text-emerald-300";
  if(n<=120)return "text-amber-300";
  return "text-rose-300";
}
function tyreTone(compound){
  const key=String(compound||"").toLowerCase();
  if(key.includes("soft"))return "bg-rose-500 text-white";
  if(key.includes("medium"))return "bg-amber-400 text-slate-950";
  if(key.includes("hard"))return "bg-slate-100 text-slate-950";
  if(key.includes("inter"))return "bg-emerald-500 text-white";
  if(key.includes("wet"))return "bg-blue-500 text-white";
  return "bg-slate-600 text-white";
}
function programmeIntensity(programme){
  const fatigue=Number(programme?.fatigue)||0;
  if(fatigue<=5)return {label:"Light",tone:"text-emerald-300"};
  if(fatigue<=8)return {label:"Standard",tone:"text-slate-200"};
  return {label:"Heavy",tone:"text-amber-300"};
}
function indexDescriptor(value,{inverse=false}={}){
  const n=Math.max(0,Math.min(100,Number(value)||0));
  const level=n<30?"Low":n<55?"Moderate":n<75?"High":"Very high";
  const tone=n<30?"text-emerald-300":n<55?"text-slate-200":n<75?"text-amber-300":"text-rose-300";
  return {level,tone,inverse};
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
function isWetState(state){
  return /RAIN|STORM|WETTING|DRIZZLE/i.test(String(state||""));
}
function teamForecastText(weatherSnapshot,currentLap,currentState,confidence){
  const lap=Math.max(0,Number(currentLap)||0);
  const segments=(weatherSnapshot?.segments||[]).slice().sort((a,b)=>Number(a.from_lap)-Number(b.from_lap));
  const wetNow=isWetState(currentState);
  const next=segments.find((segment)=>Number(segment.from_lap)>lap&&isWetState(segment.state)!==wetNow);
  const conf=Number.isFinite(Number(confidence))?Math.round(Number(confidence)):null;
  if(!next){
    const base=wetNow?"Rain expected to persist for now.":"No major rain change expected soon.";
    return conf==null?base:`${base} Forecast confidence ${conf}%.`;
  }
  const laps=Math.max(1,Number(next.from_lap)-lap);
  const timing=laps===1?"next lap":`~${laps} laps`;
  const text=!wetNow&&isWetState(next.state)
    ?`Rain might start in ${timing}.`
    :`Rain may ease or stop in ${timing}.`;
  return conf==null?text:`${text} Forecast confidence ${conf}%.`;
}
function controlNotice(plan,liveRace,drivers){
  const lap=Number(liveRace?.current_lap)||0;
  const current=String(liveRace?.current_control||"GREEN");
  if(current==="GREEN")return null;
  const period=(plan?.periods||[]).find((row)=>lap>=Number(row?.from_lap)&&lap<=Number(row?.to_lap))
    ||liveRace?.red_flag_period
    ||null;
  const incident=period?.driver_id
    ?(plan?.incidents||[]).find((row)=>String(row?.driver_id)===String(period.driver_id)&&Number(row?.lap)===Number(period?.from_lap))
    :null;
  const label={
    LOCAL_YELLOW:"LOCAL YELLOW",
    SAFETY_CAR:"SAFETY CAR",
    VSC:"VIRTUAL SAFETY CAR",
    RED_FLAG:"RED FLAG",
  }[current]||current.replaceAll("_"," ");
  let reason="Race control intervention";
  if(period?.cause==="weather")reason="Extreme weather conditions";
  else if(incident){
    const who=driverName(drivers,incident.driver_id);
    reason=`${who} — ${String(incident.reason||incident.kind||"incident").replaceAll("_"," ")} (${incident.severity||"unknown"})`;
  }else if(period?.cause)reason=String(period.cause).replaceAll("_"," ");
  return {label,reason,type:current};
}
function controlNoticeTone(type){
  if(type==="RED_FLAG")return "border-red-500/50 bg-red-950/80 text-red-100";
  if(type==="SAFETY_CAR"||type==="VSC")return "border-amber-400/50 bg-amber-500/15 text-amber-100";
  return "border-yellow-400/50 bg-yellow-500/15 text-yellow-100";
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
  const columnCount=ordered.length>=24?3:ordered.length>14?2:1;
  const groupSize=Math.ceil(ordered.length/columnCount);
  const groups=Array.from({length:columnCount},(_,index)=>({
    rows:ordered.slice(index*groupSize,(index+1)*groupSize),
    offset:index*groupSize,
  })).filter((group)=>group.rows.length);

  const renderGroup=({rows:group,offset})=><div className="overflow-hidden rounded-lg border border-white/10 bg-[#11161f]" key={offset}>
    <table className="w-full text-[11px] leading-tight">
      <thead className="bg-[#171d27] text-[9px] uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-2 py-1.5 text-right w-8">Pos</th>
          <th className="px-2 py-1.5 text-left">Driver / Team</th>
          <th className="px-2 py-1.5 text-right">Time / Gap</th>
          <th className="px-2 py-1.5 text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {group.map((row,localIndex)=>{
          const globalIndex=offset+localIndex;
          const time=Number(row?.best_time_ms??row?.lap_time_ms);
          const status=overall?String(row?.status||"").toUpperCase():sessionStatus(row,session);
          const atCutoff=Number.isFinite(Number(cutoff))&&globalIndex===Number(cutoff);
          return <React.Fragment key={row.driver_id||globalIndex}>
            {atCutoff&&<tr className="border-y border-amber-400/30 bg-amber-500/10">
              <td colSpan={4} className="px-2 py-1 text-[9px] font-medium text-amber-300">Cut — first {cutoff} qualify</td>
            </tr>}
            <tr className="border-t border-white/5 hover:bg-white/[0.025]">
              <td className="px-2 py-1.5 text-right font-bold">P{row.position??globalIndex+1}</td>
              <td className="px-2 py-1.5 min-w-0">
                <span className="font-semibold text-slate-100">{driverName(drivers,row.driver_id)}</span>
                <span className="text-slate-600"> · </span>
                <span className="text-[10px] text-slate-500">{teamName(teams,row.team_id)}</span>
              </td>
              <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">
                <span>{formatLapTime(time)}</span>
                <span className="ml-1.5 text-[9px] text-slate-600">{formatGap(time,best)}</span>
              </td>
              <td className="px-2 py-1.5 text-right">
                <span className={"rounded px-1.5 py-0.5 text-[9px] "+statusClass(status)}>{status||"—"}</span>
              </td>
            </tr>
          </React.Fragment>;
        })}
      </tbody>
    </table>
  </div>;

  const gridClass=columnCount===3
    ?"grid gap-2 xl:grid-cols-3"
    :columnCount===2
      ?"grid gap-2 xl:grid-cols-2"
      :"grid gap-2";
  return <div className="rounded-xl border border-white/10 bg-[#0f141d] p-2.5">
    {title&&<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div className="font-medium text-xs">{title}</div>
      <div className="text-[10px] text-slate-500">{ordered.length} drivers · {columnCount} column{columnCount>1?"s":""}</div>
    </div>}
    <div className={gridClass}>{groups.map(renderGroup)}</div>
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
  const activeControlNotice=controlNotice(raceControlPlan,liveRace,drivers);
  const liveTeamForecast=teamForecastText(
    raceStrategy?.weather_snapshot,
    liveRace?.current_lap,
    liveRace?.last_weather||raceStrategy?.weather_snapshot?.state,
    raceForecast?.confidence_pct
  );
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
    {id:"overview",label:"Forecast",enabled:true},
    {id:"practice",label:"Practice",enabled:!terminalWeekend&&(Boolean(weekend?.practice)||["practice","practice_complete"].includes(String(weekend?.phase)))},
    {id:"qualifying",label:"Qualifying",enabled:!terminalWeekend&&qualifyingSessions.length>0},
    {id:"strategy",label:"Strategy",enabled:["grid_ready","race"].includes(String(weekend?.phase))&&Boolean(raceStrategy)},
    {id:"grid",label:"Starting Grid",enabled:["grid_ready","race"].includes(String(weekend?.phase))&&startingGridRows.length>0},
    {id:"live",label:"Live Timing",enabled:String(weekend?.phase)==="race"},
    {id:"classification",label:"Results",enabled:Boolean(lastResult)||terminalWeekend},
  ];

  if(!weekend){
    return <div className="min-h-[calc(100vh-3.5rem)] bg-[#080b11] p-6 text-slate-100">
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5">
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

  return <div className="min-h-[calc(100vh-3.5rem)] bg-[#080b11] p-4 md:p-6 text-slate-100 grid gap-4 content-start">
    <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
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

      {!(activeWindow==="live"&&weekend.phase==="race")&&<div className="grid grid-cols-5 gap-2 mt-5">
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
      </div>}
    </div>

    <nav className="sticky top-14 z-40 -mx-4 md:-mx-6 px-4 md:px-6 border-y border-white/10 bg-[#080b11]/95 backdrop-blur">
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
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
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
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Session setup</div>
            <h3 className="mt-1 text-lg font-semibold">Practice Programmes</h3>
            <p className="text-sm text-slate-400 mt-1">Choose what each car should learn from Practice. The programme changes mileage, fatigue, wear and the type of preparation gained.</p>
          </div>
          <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={()=>perform(runPractice)}>
            {busy?"Running…":"Run Practice"}
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {playerEntrants.map((entry)=>{
            const did=String(entry.driver_id);
            const selected=weekend.practice_selections?.[did]||"balanced";
            const programme=PRACTICE_PROGRAMMES[selected]||PRACTICE_PROGRAMMES.balanced;
            const fatigue=currentFatigue(gs,did);
            const intensity=programmeIntensity(programme);
            const driver=driverObject(drivers,did);
            return <div key={did} className="rounded-xl border border-white/10 bg-[#171d27] p-4">
              <div className="flex items-start gap-3">
                <DriverPortrait driver={driver||{display_name:driverName(drivers,did)}} size="h-16 w-16" className="ring-white/10"/>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-lg">{driverName(drivers,did)}</div>
                      <div className="text-xs text-slate-500">{teamName(teams,entry.team_id)}</div>
                    </div>
                    <select
                      className="border border-white/10 bg-[#0d1118] text-slate-100 rounded-lg px-3 py-2 text-sm min-w-[180px]"
                      value={selected}
                      onChange={(e)=>setPracticeProgramme(did,e.target.value)}
                    >
                      {Object.values(PRACTICE_PROGRAMMES).map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{programme.description}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className={"rounded-lg border p-3 "+fatigueTone(fatigue)}>
                  <div className="flex items-center gap-1.5 opacity-80"><Activity className="h-3.5 w-3.5"/>Fatigue</div>
                  <div className="mt-1 text-lg font-bold">{fatigue.toFixed(0)}<span className="text-xs font-normal">/100</span></div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex items-center gap-1.5 text-slate-500"><Gauge className="h-3.5 w-3.5"/>Session intensity</div>
                  <div className={"mt-1 text-lg font-bold "+intensity.tone}>{intensity.label}</div>
                  <div className="text-[10px] text-slate-500">Expected fatigue +{programme.fatigue}</div>
                </div>
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-300">
                  <div className="flex items-center gap-1.5 opacity-80"><Timer className="h-3.5 w-3.5"/>Mileage</div>
                  <div className="mt-1 text-lg font-bold">×{Number(programme.mileageFactor??1).toFixed(2)}</div>
                  <div className="text-[10px] opacity-70">relative running distance</div>
                </div>
                <div className={"rounded-lg border p-3 "+wearTone(programme.wearFactor)}>
                  <div className="flex items-center gap-1.5 opacity-80"><Wrench className="h-3.5 w-3.5"/>Component wear</div>
                  <div className="mt-1 text-lg font-bold">×{Number(programme.wearFactor??1).toFixed(2)}</div>
                  <div className="text-[10px] opacity-70">relative wear rate</div>
                </div>
              </div>

              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Programme focus</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded bg-violet-500/10 px-2 py-1 text-violet-300">Setup ×{Number(programme.learningMultiplier||1).toFixed(2)}</span>
                  <span className="rounded bg-sky-500/10 px-2 py-1 text-sky-300">Qualifying +{Number(programme.qualifyingBonus||0).toFixed(2)}</span>
                  <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-300">Race +{Number(programme.raceBonus||0).toFixed(2)}</span>
                  <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">Reliability +{Number(programme.reliabilityBonus||0).toFixed(2)}</span>
                </div>
              </div>
            </div>;
          })}
        </div>

        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
          Session intensity replaces the old “Practice Load” label: it summarises how demanding the selected programme is for the driver. Component selection/test parts will only be added once they are connected to real Car/Development effects.
        </div>
      </div>
    )}

    {activeWindow==="practice"&&Boolean(weekend.practice)&&weekend.phase!=="practice"&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Session review</div>
            <h3 className="mt-1 text-lg font-semibold">Practice Complete</h3>
            <p className="text-sm text-slate-400 mt-1">These are gameplay indices and session outcomes, not literal real-world percentages.</p>
          </div>
          {weekend.phase==="practice_complete"&&<button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={continueRaceWeekend}>
            {busy?"Continuing…":activeSession?.dateISO===gs?.currentDateISO?"Continue to Qualifying":"Advance to Qualifying"}
          </button>}
        </div>

        {(()=>{
          const inputs=weekend.practice?.track_profile?.inputs||{};
          const crash=indexDescriptor(inputs.crash_risk);
          const overtake=indexDescriptor(inputs.overtaking_difficulty);
          const wear=indexDescriptor(inputs.tyre_wear);
          return <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-sm">
            <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Crash Risk Index</div>
              <div className={"mt-1 text-xl font-bold "+crash.tone}>{Math.round(Number(inputs.crash_risk)||0)}/100</div>
              <div className="text-xs text-slate-400">{crash.level} incident-proneness. This is not a {Math.round(Number(inputs.crash_risk)||0)}% crash probability.</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Overtaking Difficulty</div>
              <div className={"mt-1 text-xl font-bold "+overtake.tone}>{Math.round(Number(inputs.overtaking_difficulty)||0)}/100</div>
              <div className="text-xs text-slate-400">{overtake.level} difficulty. Higher means passing is harder, not a percentage chance.</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Tyre Wear Index</div>
              <div className={"mt-1 text-xl font-bold "+wear.tone}>{Math.round(Number(inputs.tyre_wear)||0)}/100</div>
              <div className="text-xs text-slate-400">{wear.level} circuit demand on tyres; used by degradation and strategy models.</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Lap Length</div>
              <div className="mt-1 text-xl font-bold text-sky-300">{Number(inputs.lap_length_km||0).toFixed(2)} km</div>
              <div className="text-xs text-slate-400">Physical circuit length used for race distance and session calculations.</div>
            </div>
          </div>;
        })()}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {playerPracticeResults.map((row)=>{
            const fatigueAfter=Number(row.fatigue_after??row.fatigue_cost??0);
            const practiceImpact=practiceWeekendImpact(gs,row.driver_id);
            const conditionImpact=conditionModifierBreakdown(gs,row.driver_id);
            return <div key={row.driver_id} className="rounded-xl border border-white/10 bg-[#171d27] p-4">
              <div className="flex items-start gap-3">
                <DriverPortrait driver={driverObject(drivers,row.driver_id)||{display_name:driverName(drivers,row.driver_id)}} size="h-14 w-14" className="ring-white/10"/>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{driverName(drivers,row.driver_id)}</div>
                  <div className="text-xs text-slate-500">{row.programme_label}</div>
                  <p className="mt-1 text-sm text-slate-300">{row.feedback}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-emerald-500/10 p-2 text-emerald-300"><div className="text-[10px] uppercase opacity-70">Setup quality</div><div className="text-lg font-bold">{Math.round(row.setup_quality)}%</div></div>
                <div className="rounded bg-blue-500/10 p-2 text-blue-300"><div className="text-[10px] uppercase opacity-70">Setup knowledge</div><div className="text-lg font-bold">{Math.round(row.setup_knowledge)}%</div></div>
                <div className="rounded bg-cyan-500/10 p-2 text-cyan-300"><div className="text-[10px] uppercase opacity-70">Race relevance</div><div className="text-lg font-bold">{Number(row.race_weather_relevance??0).toFixed(0)}%</div></div>
                <div className="rounded bg-violet-500/10 p-2 text-violet-300"><div className="text-[10px] uppercase opacity-70">Qualifying relevance</div><div className="text-lg font-bold">{Number(row.qualifying_weather_relevance??0).toFixed(0)}%</div></div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded bg-white/[0.05] px-2 py-1 text-slate-300">Preparation +{Number(row.preparation_gain).toFixed(1)}</span>
                <span className={"rounded px-2 py-1 "+fatigueTone(fatigueAfter)}>Fatigue {Number(row.fatigue_before??0).toFixed(0)} → {fatigueAfter.toFixed(0)}</span>
                <span className="rounded bg-white/[0.05] px-2 py-1 text-slate-300">Learning {Number(row.fatigue_efficiency??100).toFixed(0)}%</span>
                <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">Wear +{Number(row.component_wear?.total_wear??0).toFixed(1)}</span>
              </div>

              <div className="mt-3 rounded-lg border border-white/10 bg-[#0f141d] p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Weekend performance effect</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-slate-500">Qualifying</div><div className="font-bold text-violet-300">{practiceImpact.qualifying>=0?"+":""}{practiceImpact.qualifying.toFixed(2)}</div></div>
                  <div><div className="text-slate-500">Race</div><div className="font-bold text-emerald-300">{practiceImpact.race>=0?"+":""}{practiceImpact.race.toFixed(2)}</div></div>
                  <div><div className="text-slate-500">Condition</div><div className={conditionImpact.total>=0?"font-bold text-emerald-300":"font-bold text-rose-300"}>{conditionImpact.total>=0?"+":""}{conditionImpact.total.toFixed(2)}</div></div>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                  Setup quality and programme focus directly modify qualifying/race performance. Preparation, confidence and fatigue feed the driver condition modifier; component wear feeds car performance and reliability. Setup knowledge is indirect: it helps generate setup quality and preparation rather than adding a second hidden bonus.
                </p>
              </div>

              {row.component_wear?.lowest_slot&&<div className="mt-2 text-xs text-slate-500">
                Lowest component: {String(row.component_wear.lowest_slot).replaceAll("_"," ")} · {Number(row.component_wear.lowest_condition??0).toFixed(1)}%.
              </div>}
              {Number(row.fatigue_performance_penalty_before||0)>0&&<div className="mt-2 text-xs text-amber-300">
                Pre-session fatigue reduced effective driver score by ~{Number(row.fatigue_performance_penalty_before).toFixed(1)}.
              </div>}
              {row.issue_note&&<div className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">{row.issue_note}</div>}
            </div>;
          })}
        </div>
      </div>
    )}

    {activeWindow==="qualifying"&&weekend.phase==="qualifying"&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Qualifying session</div>
            <h3 className="mt-1 text-lg font-semibold">{activeSession?.label||"Qualifying"}</h3>
            <p className="text-sm text-slate-400 mt-1">Compact timing view; completed sessions stay locked in the Save.</p>
            <div className="mt-1 text-xs text-slate-500">{activeSession?.dateISO||weekend.qualifyingDate} · {weekend.qualifying_rule_snapshot?.strategy?.replaceAll("_"," ")||"era rules"}</div>
          </div>
          <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={()=>perform(runQualifying)}>
            {busy?"Running…":`Run ${activeSession?.label||"Qualifying"}`}
          </button>
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

      </div>
    )}

    {activeWindow==="qualifying"&&weekend.phase==="qualifying_wait"&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Session complete</div>
            <h3 className="mt-1 font-semibold">{lastCompletedQualifyingSession?.label||"Qualifying"} Complete</h3>
            <p className="text-sm text-slate-400 mt-1">Saved classification. Next: {activeSession?.label||"Qualifying"} on {activeSession?.dateISO||"the next session date"}.</p>
          </div>
          <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={continueRaceWeekend}>
            {busy?"Continuing…":activeSession?.dateISO===gs?.currentDateISO?"Continue to next session":"Advance toward next session"}
          </button>
        </div>
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
      </div>
    )}

    {(weekend.phase==="grid_ready"||weekend.phase==="race")&&(
      <div className="grid gap-4">
        <div className={(activeWindow==="qualifying"?"":"hidden ")+"rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl"}>
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

        <div className={(activeWindow==="strategy"?"":"hidden ")+"rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl"}>
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
                    <select className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.start_tyre_id||""} onChange={(e)=>setRaceStrategy(did,{start_tyre_id:e.target.value})}>
                      {tyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>{tyre.compound_name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">Pace
                    <select className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.pace_mode||"balanced"} onChange={(e)=>setRaceStrategy(did,{pace_mode:e.target.value})}>
                      {Object.values(RACE_PACE_MODES).map((mode)=><option key={mode.id} value={mode.id}>{mode.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">Pit plan
                    <select className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.pit_plan||"adaptive"} onChange={(e)=>setRaceStrategy(did,{pit_plan:e.target.value})}>
                      {Object.values(PIT_PLANS).map((plan)=><option key={plan.id} value={plan.id}>{plan.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">Next tyre
                    <select className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.next_tyre_id||selection.start_tyre_id||""} onChange={(e)=>setRaceStrategy(did,{next_tyre_id:e.target.value})}>
                      {tyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>{tyre.compound_name}</option>)}
                    </select>
                  </label>
                  {selection.pit_plan==="one_stop"?(
                    <label className="text-xs text-slate-400">Target lap
                      <input className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" type="number" min="2" max={Math.max(2,Number(raceStrategy?.track_snapshot?.laps||3)-2)} value={selection.planned_stop_lap||Math.round(Number(raceStrategy?.track_snapshot?.laps||0)/2)} onChange={(e)=>setRaceStrategy(did,{planned_stop_lap:Number(e.target.value)})}/>
                    </label>
                  ):raceStrategy?.rules_snapshot?.refuelling_allowed?(
                    <label className="text-xs text-slate-400">Fuel plan
                      <select className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.fuel_plan||"balanced"} onChange={(e)=>setRaceStrategy(did,{fuel_plan:e.target.value})}>
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
          <div className="rounded-xl border border-white/10 bg-[#11161f] pb-44 text-slate-100 shadow-xl overflow-hidden xl:pb-24">
            <div className="p-4 border-b border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Live Race Control</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-3">
                    <h3 className="text-xl font-semibold">Lap {liveRace.current_lap} / {liveRace.total_laps}</h3>
                    <span className="text-sm text-slate-400">{String(liveRace.last_weather||raceStrategy?.weather_snapshot?.state||"SUNNY").replaceAll("_"," ")}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {activeControlNotice&&<div className={"max-w-xl rounded-lg border px-3 py-2 text-right text-xs "+controlNoticeTone(activeControlNotice.type)}>
                    <div className="flex items-center justify-end gap-1.5 font-bold"><Flag className="h-3.5 w-3.5"/>{activeControlNotice.label}</div>
                    <div className="mt-0.5 opacity-80">{activeControlNotice.reason}</div>
                    {activeControlNotice.type==="RED_FLAG"&&<div className="mt-0.5 opacity-70">Restart: {String(raceControlRules?.restart_style||"era rules").replaceAll("_"," ")}.</div>}
                  </div>}
                  <div className="flex flex-wrap justify-end gap-2">
                    {liveRace.status==="running"&&<>
                      <button disabled={busy} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50" onClick={()=>perform(()=>advanceLiveRace(1))}>+1 Lap</button>
                      <button disabled={busy} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50" onClick={()=>perform(()=>advanceLiveRace(5))}>+5 Laps</button>
                      <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-3 py-2 text-sm font-semibold hover:bg-white disabled:opacity-50" onClick={()=>perform(()=>advanceLiveRace(Math.max(1,Number(liveRace.total_laps)-Number(liveRace.current_lap))))}>Run to Finish</button>
                    </>}
                    {liveRace.status==="red_flag"&&<button disabled={busy} className="rounded-lg bg-red-600 text-white px-3 py-2 text-sm font-semibold disabled:opacity-50" onClick={()=>perform(resumeLiveRace)}>
                      {busy?"Restarting…":"Restart Race"}
                    </button>}
                    {liveRace.status==="finished"&&<button disabled={busy} className="rounded-lg bg-emerald-400 text-slate-950 px-3 py-2 text-sm font-semibold disabled:opacity-50" onClick={()=>perform(runRace)}>Confirm Results</button>}
                  </div>
                </div>
              </div>

              <div className="mt-3 h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-slate-200 transition-all" style={{width:String(Math.max(0,Math.min(100,(Number(liveRace.current_lap||0)/Math.max(1,Number(liveRace.total_laps||1)))*100)))+"%"}}/>
              </div>

              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 text-sm">
                <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500"><Flag className="h-3.5 w-3.5"/>Race Control</div>
                  <div className={"mt-1 font-bold "+(String(liveRace.current_control||"GREEN")==="GREEN"?"text-emerald-300":"text-amber-300")}>{String(liveRace.current_control||"GREEN").replaceAll("_"," ")}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500"><Droplets className="h-3.5 w-3.5"/>Rain</div>
                  <div className="mt-1 font-bold text-sky-300">{Math.round(Number(trackState?.rain_intensity||0)*100)}%</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500"><Droplets className="h-3.5 w-3.5"/>Wetness</div>
                  <div className="mt-1 font-bold text-cyan-300">{Math.round(Number(trackState?.track_wetness||0)*100)}%</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500"><Gauge className="h-3.5 w-3.5"/>Grip</div>
                  <div className="mt-1 font-bold">{Number(trackState?.grip_index??100).toFixed(0)}%</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500"><Activity className="h-3.5 w-3.5"/>Visibility</div>
                  <div className="mt-1 font-bold">{Number(trackState?.visibility_index??100).toFixed(0)}%</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500"><Thermometer className="h-3.5 w-3.5"/>Track Temp</div>
                  <div className="mt-1 font-bold">{Number(activeWeather?.track_temp_c??raceWeatherRow?.track_temp_c??0).toFixed(0)}°C</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500"><Timer className="h-3.5 w-3.5"/>Fastest Lap</div>
                  <div className="mt-1 font-bold font-mono text-fuchsia-300">{formatLapTime(timingSummary?.fastest_lap_ms)}</div>
                  <div className="text-[10px] text-slate-500">{timingSummary?.fastest_lap_driver_id?driverName(drivers,timingSummary.fastest_lap_driver_id):"—"}</div>
                </div>
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.08] px-3 py-2 text-xs text-sky-100">
                <Droplets className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300"/>
                <div><span className="font-semibold">Team Forecast:</span> {liveTeamForecast}</div>
              </div>
            </div>

            <div className="border-b border-white/10 bg-[#0f141d] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Race Feed</div>
                <div className="text-[10px] text-slate-600">{timingSummary?.running_count??liveRows.filter((r)=>!r.retired).length} running · {timingSummary?.retired_count??liveRows.filter((r)=>r.retired).length} DNF</div>
              </div>
              <div className="mt-2 grid gap-x-5 gap-y-1 text-xs md:grid-cols-2">
                {(liveRace.events||[]).slice(-6).reverse().map((event,index)=><div className="flex min-w-0 gap-2" key={index}>
                  <span className="shrink-0 font-mono text-slate-600">L{event.lap}</span>
                  <span className="truncate text-slate-300">{liveEventText(event,drivers)}</span>
                </div>)}
                {!(liveRace.events||[]).length&&<div className="text-slate-600">No race-control events yet.</div>}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1780px] w-full text-xs">
                <thead className="bg-[#171d27] text-slate-400 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-right">Pos</th>
                    <th className="px-2 py-2 text-center">Δ Lap</th>
                    <th className="px-3 py-2 text-left">Driver</th>
                    <th className="px-3 py-2 text-right">Interval</th>
                    <th className="px-3 py-2 text-right">Leader</th>
                    <th className="px-3 py-2 text-right">S1</th>
                    <th className="px-3 py-2 text-right">S2</th>
                    <th className="px-3 py-2 text-right">S3</th>
                    <th className="px-3 py-2 text-right">Last</th>
                    <th className="px-3 py-2 text-right">Δ Last</th>
                    <th className="px-3 py-2 text-right">Best</th>
                    <th className="px-3 py-2 text-center">Tyre</th>
                    <th className="px-3 py-2 text-right">Age</th>
                    <th className="px-3 py-2 text-right">Cond</th>
                    <th className="px-3 py-2 text-right">Temp</th>
                    <th className="px-3 py-2 text-right">Stops</th>
                    <th className="px-3 py-2 text-center">Pace</th>
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
                    const gridGain=Number(row.position_gain)||0;
                    const lapGain=Number(row.position_change_last_lap)||0;
                    const compound=row.tyre?.compound||tyreName(gs?.tyres,row.tyre?.tyre_id);
                    const rowTone=row.retired
                      ?"bg-red-950/55 text-red-100"
                      :mine
                        ?"bg-white/[0.07]"
                        :"hover:bg-white/[0.025]";
                    return <tr className={"border-t border-white/5 "+rowTone} key={row.driver_id}>
                      <td className="px-3 py-2 text-right text-sm font-bold">P{row.position??index+1}</td>
                      <td className={"px-2 py-2 text-center font-semibold "+(lapGain>0?"text-emerald-400":lapGain<0?"text-rose-400":"text-slate-600")}>{positionDelta(lapGain)}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-100">{driverName(drivers,row.driver_id)}</div>
                        <div className="text-[10px] text-slate-500">{teamName(teams,row.team_id)} · Grid P{row.grid_position??"—"} · net {positionDelta(gridGain)}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{row.retired?"—":index===0?"LEADER":formatInterval(row.interval_ms)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-400">{row.retired?(row.retirement_reason||"DNF"):index===0?"—":formatInterval(row.gap_to_leader_ms)}</td>
                      <td className={"px-3 py-2 text-right font-mono "+(s1Fast?"text-fuchsia-300":"text-slate-300")}>{formatLapTime(row.sector_1_ms)}</td>
                      <td className={"px-3 py-2 text-right font-mono "+(s2Fast?"text-fuchsia-300":"text-slate-300")}>{formatLapTime(row.sector_2_ms)}</td>
                      <td className={"px-3 py-2 text-right font-mono "+(s3Fast?"text-fuchsia-300":"text-slate-300")}>{formatLapTime(row.sector_3_ms)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatLapTime(row.last_lap_ms)}</td>
                      <td className={"px-3 py-2 text-right font-mono font-semibold "+lapDeltaTone(row.last_lap_delta_ms)}>{signedLapDelta(row.last_lap_delta_ms)}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-300">{formatLapTime(row.best_lap_ms)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={"inline-flex min-w-12 justify-center rounded-full px-2 py-1 text-[10px] font-bold "+tyreTone(compound)}>{compound||"—"}</span>
                        {row.retired?<div className="mt-1 text-[9px] font-semibold text-red-300">DNF · L{row.incident_lap}</div>:null}
                      </td>
                      <td className="px-3 py-2 text-right">{row.tyre?.age_laps??"—"}L</td>
                      <td className="px-3 py-2 text-right"><span className={"rounded px-1.5 py-1 font-semibold "+conditionTone(row.tyre?.condition)}>{Number.isFinite(Number(row.tyre?.condition))?Number(row.tyre.condition).toFixed(0)+"%":"—"}</span></td>
                      <td className={"px-3 py-2 text-right font-semibold "+temperatureTone(row.tyre?.temperature_c)}>{Number.isFinite(Number(row.tyre?.temperature_c))?Number(row.tyre.temperature_c).toFixed(0)+"°":"—"}</td>
                      <td className="px-3 py-2 text-right">{row.pit_count??0}</td>
                      <td className="px-3 py-2 text-center"><span className={"rounded px-2 py-1 text-[10px] font-semibold "+paceTone(row.current_pace)}>{paceLabel(row.current_pace)}</span></td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-white/5 px-2 py-1">{pitWindowLabel(row.pit_window)}</span>
                        {!row.retired&&Number.isFinite(Number(row.pit_rejoin_position))?<div className="mt-1 text-[9px] text-sky-300">pit now → ~P{row.pit_rejoin_position}</div>:null}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">P{row.projected_finish_position??"—"}</td>
                    </tr>;
                  })}
                  {!liveRows.length?<tr><td colSpan={19} className="px-4 py-6 text-center text-slate-500">Race timing will populate after the first completed lap.</td></tr>:null}
                </tbody>
              </table>
            </div>

            <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/15 bg-[#0b0f16]/95 p-2 shadow-[0_-10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="grid gap-2 xl:grid-cols-2">
                {playerEntrants.map((entry)=>{
                  const did=String(entry.driver_id);
                  const driver=driverObject(drivers,did);
                  const teamTyres=tyresForTeam(gs,String(entry.team_id??""));
                  const commands=raceStrategy?.live_commands?.[did]||[];
                  const liveDriver=liveRows.find((row)=>String(row.driver_id)===did);
                  const latestPace=liveDriver?.current_pace||commands.filter((row)=>row.type==="pace").at(-1)?.pace_mode||raceStrategy?.selections?.[did]?.pace_mode||"balanced";
                  const unavailable=liveRace.status!=="running"||Boolean(liveDriver?.retired);
                  const compound=liveDriver?.tyre?.compound||"—";
                  return <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-[#171d27] p-2" key={did}>
                    <DriverPortrait driver={driver||{display_name:driverName(drivers,did)}} size="h-11 w-11" className="ring-white/10"/>
                    <div className="min-w-[130px]">
                      <div className="text-xs font-semibold">{driverName(drivers,did)}</div>
                      <div className="text-[10px] text-slate-500">P{liveDriver?.position??"—"} · Δ lap {positionDelta(liveDriver?.position_change_last_lap)} · grid {positionDelta(liveDriver?.position_gain)}</div>
                      <div className="text-[10px] text-sky-300">{liveDriver?.pit_window?`${pitWindowLabel(liveDriver.pit_window)} · pit now ~P${liveDriver?.pit_rejoin_position??"—"}`:"No planned pit window"}</div>
                    </div>

                    <div className="flex flex-1 flex-wrap items-center gap-1.5 text-[10px]">
                      <span title="Tyre / age" className={"inline-flex items-center gap-1 rounded px-2 py-1 font-bold "+tyreTone(compound)}><CircleDot className="h-3 w-3"/>{compound} {liveDriver?.tyre?.age_laps??0}L</span>
                      <span title="Tyre condition" className={"inline-flex items-center gap-1 rounded px-2 py-1 font-semibold "+conditionTone(liveDriver?.tyre?.condition)}><Activity className="h-3 w-3"/>{Number.isFinite(Number(liveDriver?.tyre?.condition))?Number(liveDriver.tyre.condition).toFixed(0)+"%":"—"}</span>
                      <span title="Tyre temperature" className={"inline-flex items-center gap-1 rounded bg-white/[0.04] px-2 py-1 "+temperatureTone(liveDriver?.tyre?.temperature_c)}><Thermometer className="h-3 w-3"/>{Number.isFinite(Number(liveDriver?.tyre?.temperature_c))?Number(liveDriver.tyre.temperature_c).toFixed(0)+"°":"—"}</span>
                      <span title="Pit stops" className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-2 py-1 text-slate-300"><Wrench className="h-3 w-3"/>{liveDriver?.pit_count??0}</span>
                      <span title="Best lap" className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-2 py-1 font-mono text-slate-300"><Timer className="h-3 w-3"/>{formatLapTime(liveDriver?.best_lap_ms)}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Gauge className="h-4 w-4 text-slate-500"/>
                      <select title="Pace next lap" disabled={unavailable} className={"rounded-md border border-white/10 px-2 py-1.5 text-xs disabled:opacity-50 "+paceTone(latestPace)} value={latestPace} onChange={(e)=>setLiveCommand({driverId:did,type:"pace",paceMode:e.target.value})}>
                        {Object.values(RACE_PACE_MODES).map((mode)=><option className="bg-[#11161f] text-slate-100" key={mode.id} value={mode.id}>{mode.label}</option>)}
                      </select>
                      <Wrench className="h-4 w-4 text-slate-500"/>
                      <select title="Pit next lap" disabled={unavailable} className="rounded-md border border-white/10 bg-[#0f141d] px-2 py-1.5 text-xs text-slate-100 disabled:opacity-50" value="" onChange={(e)=>{if(e.target.value)setLiveCommand({driverId:did,type:"pit",tyreId:e.target.value});}}>
                        <option value="">Stay out</option>
                        {teamTyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>Pit → {tyre.compound_name}</option>)}
                      </select>
                    </div>
                  </div>;
                })}
              </div>
            </div>
          </div>
        )}

        <div className={(activeWindow==="grid"?"":"hidden ")+"rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl"}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Starting Grid</h3>
              <p className="text-sm text-slate-400 mt-1">{startingGridRows.length} starters · {dnqRows.length} DNQ/DNPQ.</p>
            </div>
            {weekend.phase==="grid_ready"&&<span className="text-xs text-slate-500">Race day: {weekend.raceDate}</span>}
          </div>
          <div className="mt-3 overflow-x-auto border rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-[#171d27]">
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
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <TeamLogo teamId={String(row.team_id||"")} name={teamName(teams,row.team_id)} size="h-6 w-6" className="p-0.5"/>
                        <span>{teamName(teams,row.team_id)}</span>
                      </div>
                    </td>
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

    {activeWindow==="classification"&&["results","completed"].includes(String(weekend.phase))&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] shadow-xl overflow-hidden">
        {(()=>{
          const rows=Array.isArray(lastResult?.classification)?lastResult.classification:[];
          const gridByDriver=new Map((lastResult?.startingGrid||startingGridRows||[]).map((row,index)=>[
            String(row?.driver_id??""),
            Number(row?.grid??index+1),
          ]));
          const winner=rows[0]||null;
          const podium=[rows[1],rows[0],rows[2]].filter(Boolean);
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

              {podium.length>0&&<div className="mt-5 grid items-end gap-3 md:grid-cols-3">
                {podium.map((row)=>{
                  const pos=Number(row?.position)||rows.findIndex((r)=>r===row)+1;
                  const isWinner=pos===1;
                  const gap=isWinner
                    ?formatRaceTime(row?.total_time_ms)
                    :Number.isFinite(Number(row?.gap_to_winner_ms))
                      ?formatInterval(row.gap_to_winner_ms)
                      :(row?.retirement_reason||row?.status||"—");
                  return <div key={row.driver_id||pos} className={"relative rounded-xl border p-4 text-center "+(isWinner?"md:min-h-[205px] border-amber-400/40 bg-amber-400/[0.08]":"md:min-h-[175px] border-white/10 bg-[#171d27]")}>
                    <div className={"mx-auto mb-2 flex items-center justify-center rounded-full font-black "+(isWinner?"h-9 w-9 bg-amber-300 text-slate-950":"h-8 w-8 bg-white/10 text-slate-100")}>P{pos}</div>
                    <DriverPortrait driver={driverObject(drivers,row.driver_id)||{display_name:driverName(drivers,row.driver_id)}} size={isWinner?"h-20 w-20":"h-16 w-16"} className="mx-auto ring-white/15"/>
                    <div className="mt-2 font-bold">{driverName(drivers,row.driver_id)}</div>
                    <div className="mt-1 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                      <TeamLogo teamId={String(row.team_id||"")} name={teamName(teams,row.team_id)} size="h-5 w-5" className="p-0.5"/>
                      <span>{teamName(teams,row.team_id)}</span>
                    </div>
                    <div className={"mt-2 font-mono text-sm "+(isWinner?"text-amber-200":"text-slate-300")}>{gap}</div>
                  </div>;
                })}
              </div>}

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
                <thead className="bg-[#171d27] text-slate-400 uppercase tracking-wide text-[11px]">
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
              {weekend.phase==="results"
                ?<button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={advanceSession}>
                  {busy?"Advancing…":"Continue after Grand Prix"}
                </button>
                :<button className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold" onClick={()=>navigate("/Home")}>Return Home</button>}
            </div>
          </>;
        })()}
      </div>
    )}

  </div>;
}
