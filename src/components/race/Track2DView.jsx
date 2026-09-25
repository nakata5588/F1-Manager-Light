import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleGauge,
  CloudRain,
  Droplets,
  Flag,
  Gauge,
  ListFilter,
  Map,
  Maximize2,
  Minimize2,
  Thermometer,
  Timer,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { DriverPortrait, TeamLogo } from "../entity/EntityVisuals.jsx";
import { pointAtTrackProgress, resolveTrackLayout, trackGeometryViewBox, trackLayoutResolutionLabel, visualTrackProgress } from "../../domain/trackLayout.js";

function scalar(value){
  if(value&&typeof value==="object"&&Object.hasOwn(value,"result"))return value.result;
  return value;
}

function idOf(row){return String(scalar(row?.driver_id??row?.id)??"");}
function teamIdOf(row){return String(scalar(row?.team_id??row?.id)??"");}

function driverObject(drivers,id){
  return (drivers||[]).find((driver)=>idOf(driver)===String(id))||null;
}

function driverName(drivers,id){
  const row=driverObject(drivers,id);
  return row?.display_name||row?.name||`${row?.first_name??""} ${row?.last_name??""}`.trim()||String(id||"—");
}

function shortDriverName(drivers,id){
  const name=driverName(drivers,id).trim();
  const chunks=name.split(/\s+/).filter(Boolean);
  return (chunks.at(-1)||name||"?").slice(0,3).toUpperCase();
}

function teamName(teams,id){
  const row=(teams||[]).find((team)=>teamIdOf(team)===String(id));
  return row?.team_name||row?.name||String(id||"—");
}

function brandForTeam(teamBrands,teamId,year){
  const tid=String(teamId||"");
  const target=Number(year);
  const rows=(teamBrands||[]).filter((brand)=>String(scalar(brand?.team_id??brand?.id)??"")===tid);
  if(!rows.length)return null;
  const exact=rows.find((brand)=>Number(brand?.year)===target);
  if(exact)return exact;
  const past=rows.filter((brand)=>Number.isFinite(Number(brand?.year))&&Number(brand.year)<=target)
    .sort((a,b)=>Number(b.year)-Number(a.year));
  return past[0]||rows[0];
}

function markerColor(teamBrands,teamId,year){
  return brandForTeam(teamBrands,teamId,year)?.primary_color||"#94a3b8";
}

function resolutionTone(resolution){
  if(resolution==="exact")return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if(resolution==="past_fallback")return "border-sky-400/30 bg-sky-500/10 text-sky-200";
  if(resolution==="future_fallback")return "border-amber-400/30 bg-amber-500/10 text-amber-200";
  return "border-white/10 bg-white/[0.05] text-slate-300";
}

function controlTone(control){
  const key=String(control||"GREEN").toUpperCase();
  if(key==="RED_FLAG")return "border-red-400/40 bg-red-500/15 text-red-200";
  if(key.includes("YELLOW"))return "border-amber-400/40 bg-amber-500/15 text-amber-200";
  if(key.includes("SAFETY")||key==="VSC")return "border-amber-300/40 bg-amber-400/15 text-amber-100";
  return "border-emerald-400/40 bg-emerald-500/15 text-emerald-200";
}

function formatLapTime(ms){
  const n=Number(ms);
  if(!Number.isFinite(n)||n<=0)return "—";
  const minutes=Math.floor(n/60000);
  const seconds=(n-minutes*60000)/1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6,"0")}`;
}

function formatInterval(ms,{leader=false}={}){
  if(leader)return "LEAD";
  const n=Number(ms);
  if(!Number.isFinite(n)||n<0)return "—";
  return `+${(n/1000).toFixed(1)}`;
}

function paceLabel(mode){
  const key=String(mode||"balanced").toLowerCase();
  return {attack:"Attack",balanced:"Balanced",conserve:"Conserve"}[key]||key.replaceAll("_"," ");
}

function pitWindowLabel(window){
  if(!window)return "Stay out";
  const from=Number(window?.from_lap);
  const to=Number(window?.to_lap);
  if(!Number.isFinite(from))return "Stay out";
  if(!Number.isFinite(to)||from===to)return `L${from}`;
  return `L${from}–${to}`;
}

function eventTone(event){
  const control=String(event?.control_type||"").toUpperCase();
  const type=String(event?.type||"").toLowerCase();
  const message=String(event?.display_text||event?.message||"").toLowerCase();
  if(control==="RED_FLAG"||type==="incident"||/dnf|retir|collision|crash/.test(message))return "border-red-500/25 bg-red-950/65";
  if(control.includes("YELLOW"))return "border-amber-400/30 bg-amber-500/10";
  if(type==="pit")return "border-sky-400/25 bg-sky-500/10";
  if(type.includes("weather"))return "border-cyan-400/25 bg-cyan-500/10";
  if(type==="position_change")return "border-violet-400/25 bg-violet-500/10";
  return "border-white/10 bg-black/25";
}

function orderModeValue(row,index,mode){
  if(row?.retired)return "DNF";
  if(mode==="timing")return formatLapTime(row?.last_lap_ms);
  if(mode==="tyres")return `${row?.tyre?.compound||"—"} · ${row?.tyre?.age_laps??"—"}L`;
  if(mode==="strategy")return pitWindowLabel(row?.pit_window);
  return index===0?"LEAD":formatInterval(row?.gap_to_leader_ms);
}

function AnimatedMarker({
  geometry,
  progress,
  color,
  label,
  title,
  mine=false,
  retired=false,
  selected=false,
  onSelect,
}){
  const target=Number(progress)||0;
  const previous=useRef(target);
  const frame=useRef(null);
  const [display,setDisplay]=useState(target);

  useEffect(()=>{
    if(frame.current)cancelAnimationFrame(frame.current);
    let from=previous.current;
    let to=target;
    while(to<from-0.5)to+=1;
    while(to>from+0.5)to-=1;
    if(to<from&&from-to>0.08)to+=1;
    const started=performance.now();
    const duration=650;
    const tick=(now)=>{
      const t=Math.min(1,(now-started)/duration);
      const eased=1-Math.pow(1-t,3);
      setDisplay(from+(to-from)*eased);
      if(t<1)frame.current=requestAnimationFrame(tick);
      else previous.current=((to%1)+1)%1;
    };
    frame.current=requestAnimationFrame(tick);
    return ()=>{if(frame.current)cancelAnimationFrame(frame.current);};
  },[target]);

  const point=pointAtTrackProgress(geometry,display);
  if(!point)return null;
  const radius=selected?16:mine?13:8.5;
  return <g
    role="button"
    tabIndex="0"
    aria-label={title}
    className="cursor-pointer outline-none"
    onClick={onSelect}
    onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelect?.();}}}
  >
    <title>{title}</title>
    {selected?<circle cx={point.x} cy={point.y} r={radius+10} fill="none" stroke="#f8fafc" strokeWidth="2" opacity=".35">
      <animate attributeName="r" values={`${radius+5};${radius+12};${radius+5}`} dur="1.25s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values=".6;.12;.6" dur="1.25s" repeatCount="indefinite"/>
    </circle>:null}
    <circle cx={point.x} cy={point.y} r={radius+3} fill="rgba(2,6,23,.88)" stroke={selected?"#f8fafc":mine?"#f8fafc":"rgba(255,255,255,.42)"} strokeWidth={selected?4:mine?3:1.5}/>
    <circle cx={point.x} cy={point.y} r={radius} fill={retired?"#7f1d1d":color} opacity={retired?0.74:1}/>
    {(mine||selected)?<text x={point.x} y={point.y+3.5} textAnchor="middle" fontSize={selected?"10.5":"9.5"} fontWeight="900" fill="#fff">{label}</text>:null}
    {retired?<path d={`M ${point.x-5} ${point.y-5} L ${point.x+5} ${point.y+5} M ${point.x+5} ${point.y-5} L ${point.x-5} ${point.y+5}`} stroke="#fff" strokeWidth="2"/>:null}
  </g>;
}

function Stat({label,value,tone="text-slate-100",icon=null,sub=null}){
  return <div className="min-w-0 rounded-md border border-white/10 bg-black/25 px-2 py-1.5">
    <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-slate-500">{icon}{label}</div>
    <div className={`mt-0.5 truncate text-xs font-bold ${tone}`}>{value}</div>
    {sub?<div className="truncate text-[9px] text-slate-500">{sub}</div>:null}
  </div>;
}

function DriverInspector({row,drivers,teams,playerTeamId,onClose}){
  if(!row)return null;
  const did=String(row?.driver_id||"");
  const tid=String(row?.team_id||"");
  const mine=tid===String(playerTeamId||"");
  const projection=Number.isFinite(Number(row?.projected_finish_position))?`P${row.projected_finish_position}`:"—";
  const projectionRange=Number.isFinite(Number(row?.projected_finish_best))&&Number.isFinite(Number(row?.projected_finish_worst))
    ?`P${row.projected_finish_best}–P${row.projected_finish_worst}`
    :null;
  return <div className="border-t border-white/10 bg-[#0b1017]/98 p-2.5 backdrop-blur-xl">
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-[220px] flex-1 items-center gap-2">
        <DriverPortrait driver={driverObject(drivers,did)||{display_name:driverName(drivers,did)}} size="h-10 w-10" className="shrink-0 ring-white/15"/>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {mine?<span className="h-2 w-2 rounded-full bg-amber-300"/>:null}
            <div className="truncate text-sm font-bold">P{row?.position??"—"} · {driverName(drivers,did)}</div>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
            <TeamLogo teamId={tid} name={teamName(teams,tid)} size="h-4 w-4" className="shrink-0 p-0"/>
            <span className="truncate">{teamName(teams,tid)}</span>
            {row?.retired?<span className="font-semibold text-red-300">· DNF · {row?.retirement_reason||"Retired"}</span>:null}
          </div>
        </div>
      </div>
      <div className="grid flex-[4] grid-cols-3 gap-1.5 md:grid-cols-6 xl:grid-cols-9">
        <Stat label="Grid" value={`P${row?.grid_position??"—"}`} sub={Number(row?.position_gain)>0?`+${row.position_gain} places`:Number(row?.position_gain)<0?`${row.position_gain} places`:"No net change"}/>
        <Stat label="Interval" value={row?.retired?"DNF":Number(row?.position)===1?"LEADER":formatInterval(row?.interval_ms)} tone="text-sky-200"/>
        <Stat label="Gap" value={row?.retired?"DNF":Number(row?.position)===1?"—":formatInterval(row?.gap_to_leader_ms)} />
        <Stat label="Last" value={formatLapTime(row?.last_lap_ms)} sub={Number.isFinite(Number(row?.last_lap_delta_ms))?`${Number(row.last_lap_delta_ms)>=0?"+":""}${(Number(row.last_lap_delta_ms)/1000).toFixed(3)}`:"—"} icon={<Timer className="h-3 w-3"/>}/>
        <Stat label="Best" value={formatLapTime(row?.best_lap_ms)} tone="text-emerald-300"/>
        <Stat label="Tyre" value={row?.tyre?.compound||"—"} sub={`${row?.tyre?.age_laps??"—"}L · ${Number.isFinite(Number(row?.tyre?.condition))?Number(row.tyre.condition).toFixed(0)+"%":"—"}`} />
        <Stat label="Temp" value={Number.isFinite(Number(row?.tyre?.temperature_c))?`${Number(row.tyre.temperature_c).toFixed(0)}°C`:"—"} icon={<Thermometer className="h-3 w-3"/>}/>
        <Stat label="Strategy" value={paceLabel(row?.current_pace)} sub={pitWindowLabel(row?.pit_window)} icon={<CircleGauge className="h-3 w-3"/>}/>
        <Stat label="Projection" value={projection} sub={projectionRange||(`${Number(row?.projection_confidence_pct||0).toFixed(0)}% confidence`)} tone="text-violet-200"/>
      </div>
      <button type="button" onClick={onClose} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200">Close</button>
    </div>
  </div>;
}

export default function Track2DView({
  trackId,
  year,
  rows=[],
  drivers=[],
  teams=[],
  teamBrands=[],
  playerTeamId="",
  currentLap=0,
  currentSector=0,
  totalLaps=0,
  currentControl="GREEN",
  raceStatus="running",
  lastWeather="SUNNY",
  trackState=null,
  timingSummary=null,
  forecast=null,
  events=[],
  selectedDriverId="",
  onSelectDriver=null,
  onSelectEvent=null,
  busy=false,
  onRestartRace=null,
  onConfirmResults=null,
}){
  const resolved=useMemo(()=>resolveTrackLayout({trackId,year}),[trackId,year]);
  const layout=resolved.layout;
  const geometry=resolved.geometry;
  const fittedViewBox=useMemo(()=>trackGeometryViewBox(geometry),[geometry]);
  const activeRows=(rows||[]).slice().sort((a,b)=>Number(a?.position??999)-Number(b?.position??999));
  const referenceLapMs=activeRows.map((row)=>Number(row?.last_lap_ms||row?.best_lap_ms)).filter((value)=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b)[0]||90000;
  const [orderExpanded,setOrderExpanded]=useState(false);
  const [orderMode,setOrderMode]=useState("order");
  const [feedExpanded,setFeedExpanded]=useState(false);

  const resolvedSelectedId=String(selectedDriverId||activeRows.find((row)=>String(row?.team_id||"")===String(playerTeamId||""))?.driver_id||activeRows[0]?.driver_id||"");
  const selectedRow=activeRows.find((row)=>String(row?.driver_id||"")===resolvedSelectedId)||null;
  const visibleEvents=(events||[]).slice(0,feedExpanded?10:3);
  const progressPct=Math.max(0,Math.min(100,(((Math.max(0,Number(currentLap||0)-1))+(Number(currentSector||0)/3))/Math.max(1,Number(totalLaps||1)))*100));

  if(!layout){
    return <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20 text-sm text-slate-500">
      <div className="text-center"><Map className="mx-auto mb-2 h-6 w-6"/>No 2D circuit asset is available for this track yet.</div>
    </div>;
  }

  const orderPanelClass=orderExpanded
    ?"xl:grid-cols-[minmax(0,1fr)_390px] 2xl:grid-cols-[minmax(0,1fr)_420px]"
    :"xl:grid-cols-[minmax(0,1fr)_235px] 2xl:grid-cols-[minmax(0,1fr)_250px]";

  return <section className="overflow-hidden rounded-xl border border-white/10 bg-[#090d13] shadow-2xl">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0b1017] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Map className="h-4 w-4 text-slate-400"/>
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold">{layout.label} · Race View</h4>
          <div className="text-[9px] text-slate-600">Live positions are visual; race physics remain engine-owned.</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className={`rounded border px-2 py-1 ${resolutionTone(resolved.resolution)}`} title={layout.source_label||""}>{trackLayoutResolutionLabel(resolved.resolution)}</span>
        {layout.historical_status!=="verified"?<span className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/[0.07] px-2 py-1 text-amber-200"><TriangleAlert className="h-3 w-3"/>Provisional</span>:null}
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-semibold ${controlTone(currentControl)}`}><Flag className="h-3 w-3"/>{String(currentControl||"GREEN").replaceAll("_"," ")}</span>
      </div>
    </div>

    <div className={`grid ${orderPanelClass}`}>
      <div className="relative min-h-[560px] overflow-hidden bg-[radial-gradient(circle_at_center,rgba(51,65,85,.16),transparent_64%)] md:min-h-[620px] xl:min-h-[660px] 2xl:min-h-[700px]">
        {geometry?<svg className="absolute inset-0 h-full w-full p-1 md:p-2" viewBox={fittedViewBox.join(" ")} preserveAspectRatio="xMidYMid meet" aria-label={`${layout.label} circuit and live car positions`}>
          {(()=>{
            const closed=[...geometry.points,geometry.points[0]];
            const polyline=closed.map((point)=>point.join(",")).join(" ");
            return <>
              <polyline points={polyline} fill="none" stroke="#020617" strokeWidth="34" strokeLinejoin="round" strokeLinecap="round" opacity=".96"/>
              <polyline points={polyline} fill="none" stroke="#cbd5e1" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" opacity=".74"/>
              <polyline points={polyline} fill="none" stroke="#475569" strokeWidth="2.2" strokeDasharray="8 8" strokeLinejoin="round" strokeLinecap="round" opacity=".72"/>
            </>;
          })()}
          {activeRows.map((row,index)=>{
            const did=String(row?.driver_id||"");
            const tid=String(row?.team_id||"");
            const mine=tid===String(playerTeamId||"");
            const selected=did===resolvedSelectedId;
            const progress=visualTrackProgress(row,{currentLap,currentSector,referenceLapMs,index});
            return <AnimatedMarker
              key={did||index}
              geometry={geometry}
              progress={progress}
              color={markerColor(teamBrands,tid,year)}
              label={shortDriverName(drivers,did)}
              mine={mine}
              selected={selected}
              onSelect={()=>onSelectDriver?.(did)}
              retired={Boolean(row?.retired)}
              title={`P${row?.position??index+1} · ${driverName(drivers,did)} · ${teamName(teams,tid)}`}
            />;
          })}
        </svg>:null}

        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#05080d]/85 to-transparent"/>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#05080d]/75 to-transparent"/>

        <div className="absolute left-3 top-3 z-20 w-[min(420px,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-white/15 bg-[#0a0f16]/90 shadow-xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-2 border-b border-white/10 px-3 py-2">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Live Race Control</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <div className="text-lg font-black">L{Number(currentLap)||0}<span className="text-slate-500">/{Number(totalLaps)||0}</span></div>
                {Number(currentSector)>0?<div className="text-sm font-bold text-amber-300">S{currentSector}</div>:null}
                <div className="text-xs text-slate-400">{String(lastWeather||"SUNNY").replaceAll("_"," ")}</div>
              </div>
            </div>
            <div className={`rounded-md border px-2 py-1 text-[10px] font-bold ${controlTone(currentControl)}`}>{String(currentControl||"GREEN").replaceAll("_"," ")}</div>
          </div>
          <div className="h-1 bg-white/10"><div className="h-full bg-slate-100 transition-all" style={{width:`${progressPct}%`}}/></div>
          <div className="grid grid-cols-3 gap-1 p-2 sm:grid-cols-6">
            <Stat label="Rain" value={`${Math.round(Number(trackState?.rain_intensity||0)*100)}%`} tone="text-sky-300" icon={<CloudRain className="h-3 w-3"/>}/>
            <Stat label="Wet" value={`${Math.round(Number(trackState?.track_wetness||0)*100)}%`} tone="text-cyan-300" icon={<Droplets className="h-3 w-3"/>}/>
            <Stat label="Grip" value={`${Number(trackState?.grip_index??100).toFixed(0)}`} icon={<Gauge className="h-3 w-3"/>}/>
            <Stat label="Visibility" value={`${Number(trackState?.visibility_index??100).toFixed(0)}%`} icon={<Activity className="h-3 w-3"/>}/>
            <Stat label="Track" value={Number.isFinite(Number(trackState?.track_temp_c))?`${Number(trackState.track_temp_c).toFixed(1)}°`:"—"} sub={Number.isFinite(Number(trackState?.air_temp_c))?`Air ${Number(trackState.air_temp_c).toFixed(1)}°`:null} icon={<Thermometer className="h-3 w-3"/>}/>
            <Stat label="Fastest" value={formatLapTime(timingSummary?.fastest_lap_ms)} sub={timingSummary?.fastest_lap_driver_id?driverName(drivers,timingSummary.fastest_lap_driver_id):null} tone="text-fuchsia-300" icon={<Timer className="h-3 w-3"/>}/>
          </div>
          {forecast?.message?<div className="border-t border-white/10 px-3 py-1.5 text-[10px] leading-snug text-sky-200"><span className="font-bold">Team forecast:</span> {forecast.message}</div>:null}
          {(raceStatus==="red_flag"||raceStatus==="finished")?<div className="flex gap-2 border-t border-white/10 p-2">
            {raceStatus==="red_flag"&&onRestartRace?<button type="button" disabled={busy} onClick={onRestartRace} className="rounded-md bg-red-600 px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">{busy?"Restarting…":"Restart Race"}</button>:null}
            {raceStatus==="finished"&&onConfirmResults?<button type="button" disabled={busy} onClick={onConfirmResults} className="rounded-md bg-emerald-400 px-3 py-1.5 text-[10px] font-bold text-slate-950 disabled:opacity-50">Confirm Results</button>:null}
          </div>:null}
        </div>

        <div className="absolute bottom-3 left-3 z-20 w-[min(470px,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-white/15 bg-[#0a0f16]/88 shadow-xl backdrop-blur-xl">
          <button type="button" onClick={()=>setFeedExpanded((value)=>!value)} className="flex w-full items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-left">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Race Feed</div>
              <div className="text-[10px] text-slate-400">{timingSummary?.running_count??activeRows.filter((row)=>!row.retired).length} running · {timingSummary?.retired_count??activeRows.filter((row)=>row.retired).length} DNF</div>
            </div>
            {feedExpanded?<ChevronDown className="h-4 w-4 text-slate-400"/>:<ChevronUp className="h-4 w-4 text-slate-400"/>}
          </button>
          <div className={`grid gap-1 p-2 ${feedExpanded?"max-h-[265px] overflow-y-auto":"max-h-[128px] overflow-hidden"}`}>
            {visibleEvents.map((event,index)=>(
              <button type="button" key={event?.event_key||event?.id||index} onClick={()=>onSelectEvent?.(event)} className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-left text-[10px] leading-snug text-slate-300 hover:bg-white/[0.08] ${eventTone(event)}`}>
                <span className="shrink-0 font-mono text-slate-500">L{event?.lap??"—"}{Number(event?.sector)>0?`·S${event.sector}`:""}</span>
                <span className="min-w-0">{event?.display_text||event?.message||String(event?.type||"Race update").replaceAll("_"," ")}</span>
              </button>
            ))}
            {!visibleEvents.length?<div className="px-2 py-3 text-[10px] text-slate-600">No race-control events yet.</div>:null}
          </div>
        </div>

        {!geometry?<div className="absolute bottom-3 right-3 rounded bg-black/70 px-2 py-1 text-[10px] text-slate-400">Static layout only · centerline pending</div>:null}
      </div>

      <aside className="border-t border-white/10 bg-[#0c1118] xl:border-l xl:border-t-0">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-2">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Track Order</div>
            <div className="text-[9px] text-slate-600">Click a driver to inspect</div>
          </div>
          <button type="button" onClick={()=>setOrderExpanded((value)=>!value)} title={orderExpanded?"Compact Track Order":"Expand Track Order"} className="rounded-md border border-white/10 bg-white/[0.04] p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100">
            {orderExpanded?<Minimize2 className="h-3.5 w-3.5"/>:<Maximize2 className="h-3.5 w-3.5"/>}
          </button>
        </div>

        {orderExpanded?<div className="flex gap-1 border-b border-white/10 p-1.5">
          {[
            ["order","Order"],
            ["timing","Timing"],
            ["tyres","Tyres"],
            ["strategy","Strategy"],
          ].map(([id,label])=><button type="button" key={id} onClick={()=>setOrderMode(id)} className={`flex-1 rounded px-1.5 py-1 text-[9px] font-semibold ${orderMode===id?"bg-slate-100 text-slate-950":"bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]"}`}>{label}</button>)}
        </div>:null}

        <div className="max-h-[610px] overflow-y-auto p-1.5 2xl:max-h-[650px]">
          {activeRows.map((row,index)=>{
            const did=String(row?.driver_id||"");
            const tid=String(row?.team_id||"");
            const mine=tid===String(playerTeamId||"");
            const selected=did===resolvedSelectedId;
            const color=markerColor(teamBrands,tid,year);
            return <button
              type="button"
              key={did||index}
              onClick={()=>onSelectDriver?.(did)}
              className={`mb-1 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[10px] transition ${selected?"border-white/35 bg-white/[0.12] shadow-[0_0_0_1px_rgba(255,255,255,.05)]":mine?"border-amber-300/15 bg-amber-500/[0.06]":"border-transparent bg-white/[0.025] hover:bg-white/[0.06]"}`}
            >
              <span className="w-6 shrink-0 text-right text-xs font-black text-slate-200">P{row?.position??index+1}</span>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/40" style={{backgroundColor:row?.retired?"#7f1d1d":color}}/>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1">
                  {mine?<span className="text-amber-300">●</span>:null}
                  <span className="truncate font-semibold text-slate-100">{driverName(drivers,did)}</span>
                </span>
                {orderExpanded?<span className="mt-0.5 block truncate text-[9px] text-slate-500">{teamName(teams,tid)}</span>:null}
              </span>
              <span className={`shrink-0 font-mono text-[9px] ${row?.retired?"text-red-300":"text-slate-400"}`}>{orderModeValue(row,index,orderExpanded?orderMode:"order")}</span>
              {orderExpanded?<ChevronRight className="h-3 w-3 shrink-0 text-slate-600"/>:null}
            </button>;
          })}
          {!activeRows.length?<div className="px-2 py-6 text-center text-xs text-slate-600">Cars appear after the first live timing update.</div>:null}
        </div>

        {orderExpanded&&selectedRow?<div className="border-t border-white/10 p-2">
          <div className="grid grid-cols-2 gap-1">
            {orderMode==="order"?<>
              <Stat label="Grid" value={`P${selectedRow?.grid_position??"—"}`}/>
              <Stat label="Net" value={Number(selectedRow?.position_gain)>0?`+${selectedRow.position_gain}`:String(selectedRow?.position_gain??0)}/>
              <Stat label="Interval" value={selectedRow?.retired?"DNF":Number(selectedRow?.position)===1?"LEAD":formatInterval(selectedRow?.interval_ms)}/>
              <Stat label="Leader" value={selectedRow?.retired?"DNF":Number(selectedRow?.position)===1?"—":formatInterval(selectedRow?.gap_to_leader_ms)}/>
            </>:null}
            {orderMode==="timing"?<>
              <Stat label="S1" value={formatLapTime(selectedRow?.sector_1_ms)}/>
              <Stat label="S2" value={formatLapTime(selectedRow?.sector_2_ms)}/>
              <Stat label="S3" value={formatLapTime(selectedRow?.sector_3_ms)}/>
              <Stat label="Best" value={formatLapTime(selectedRow?.best_lap_ms)} tone="text-emerald-300"/>
            </>:null}
            {orderMode==="tyres"?<>
              <Stat label="Compound" value={selectedRow?.tyre?.compound||"—"}/>
              <Stat label="Age" value={`${selectedRow?.tyre?.age_laps??"—"}L`}/>
              <Stat label="Condition" value={Number.isFinite(Number(selectedRow?.tyre?.condition))?`${Number(selectedRow.tyre.condition).toFixed(0)}%`:"—"}/>
              <Stat label="Stops" value={selectedRow?.pit_count??0} icon={<Wrench className="h-3 w-3"/>}/>
            </>:null}
            {orderMode==="strategy"?<>
              <Stat label="Pace" value={paceLabel(selectedRow?.current_pace)}/>
              <Stat label="Pit window" value={pitWindowLabel(selectedRow?.pit_window)}/>
              <Stat label="Rejoin" value={Number.isFinite(Number(selectedRow?.pit_rejoin_position))?`P${selectedRow.pit_rejoin_position}`:"—"}/>
              <Stat label="Projection" value={Number.isFinite(Number(selectedRow?.projected_finish_position))?`P${selectedRow.projected_finish_position}`:"—"}/>
            </>:null}
          </div>
        </div>:null}
      </aside>
    </div>

    <DriverInspector
      row={selectedRow}
      drivers={drivers}
      teams={teams}
      playerTeamId={playerTeamId}
      onClose={()=>onSelectDriver?.("")}
    />
  </section>;
}
