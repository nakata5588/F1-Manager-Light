import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CloudRain,
  Droplets,
  Flag,
  Gauge,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Thermometer,
  Timer,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { DriverPortrait, TeamLogo } from "../entity/EntityVisuals.jsx";
import { focusTrackViewBox, orientTrackGeometry, pointAtTrackProgress, raceEventTrackProgress, resolveTrackLayout, trackGeometryViewBox, trackIntelligenceProfile, trackLayoutResolutionLabel, trackMarkerSegment, trackSectorPolylinePoints, visualTrackProgress } from "../../domain/trackLayout.js";
import { raceAverageSpeedKmh, raceMotionDurationMs, retiredCarVisibleOnTrack, unwrapTrackProgress } from "../../domain/racePlayback.js";
import { buildRaceVisualModel, interpolateVisualGap, visualMotionProgress } from "../../domain/raceVisualModel.js";

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

function driverSurname(drivers,id){
  const name=driverName(drivers,id).trim();
  const chunks=name.split(/\s+/).filter(Boolean);
  return chunks.at(-1)||name||"?";
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

function tyreVisual(compound){
  const key=String(compound||"").toLowerCase();
  if(key.includes("inter"))return {label:"I",ring:"#39ff14"};
  if(key.includes("wet"))return {label:"W",ring:"#18a8ff"};
  if(key.includes("option")||key.includes("soft"))return {label:"S",ring:"#ff3030"};
  if(key.includes("medium"))return {label:"M",ring:"#ffd800"};
  if(key.includes("prime")||key.includes("hard"))return {label:"H",ring:"#f5f7fa"};
  const cMatch=key.match(/(?:^|\b)c([1-5])(?:\b|$)/);
  if(cMatch){
    const number=Number(cMatch[1]);
    return {label:`C${number}`,ring:number<=2?"#f5f7fa":number===3?"#ffd800":"#ff3030"};
  }
  return {label:"T",ring:"#94a3b8"};
}

function MiniTyreIcon({compound,size=17}){
  const visual=tyreVisual(compound);
  return <span
    title={String(compound||"Tyre")}
    aria-label={String(compound||"Tyre")}
    className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-[#06080c]"
    style={{width:size,height:size,border:`${Math.max(2,Math.round(size*.12))}px solid ${visual.ring}`,boxShadow:"inset 0 0 0 1px rgba(255,255,255,.10)"}}
  >
    <span className="rounded-full bg-slate-700" style={{width:Math.round(size*.38),height:Math.round(size*.38)}}/>
    <span className="absolute text-center font-black leading-none" style={{fontSize:Math.max(5,Math.round(size*.22)),color:visual.ring}}>{visual.label}</span>
  </span>;
}

function useAnimatedViewBox(target,duration=420){
  const normalized=Array.isArray(target)&&target.length===4?target.map(Number):[0,0,1000,1000];
  const [display,setDisplay]=useState(normalized);
  const current=useRef(normalized);
  const frame=useRef(null);
  const key=normalized.map((value)=>Number(value).toFixed(2)).join(":");

  useEffect(()=>{
    if(frame.current)cancelAnimationFrame(frame.current);
    const from=current.current.map(Number);
    const to=normalized;
    const started=performance.now();
    const tick=(now)=>{
      const t=Math.min(1,(now-started)/Math.max(1,Number(duration)||1));
      const eased=1-Math.pow(1-t,3);
      const next=from.map((value,index)=>value+(to[index]-value)*eased);
      current.current=next;
      setDisplay(next);
      if(t<1)frame.current=requestAnimationFrame(tick);
    };
    frame.current=requestAnimationFrame(tick);
    return ()=>{if(frame.current)cancelAnimationFrame(frame.current);};
  },[key,duration]);

  return display;
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

function incidentMarkerTone(event){
  const control=String(event?.control_type||"").toUpperCase();
  const type=String(event?.type||"").toLowerCase();
  const message=String(event?.display_text||event?.message||"").toLowerCase();
  if(control==="RED_FLAG"||type==="incident"||/dnf|retir|collision|crash/.test(message))return {fill:"#ef4444",stroke:"#fecaca",label:"!"};
  if(control.includes("YELLOW"))return {fill:"#f59e0b",stroke:"#fde68a",label:"!"};
  if(type.includes("weather"))return {fill:"#0ea5e9",stroke:"#bae6fd",label:"W"};
  return {fill:"#64748b",stroke:"#e2e8f0",label:"•"};
}

function orderModeValue(row,index,mode){
  if(row?.retired)return "DNF";
  if(mode==="timing")return formatLapTime(row?.last_lap_ms);
  if(mode==="tyres")return `${row?.tyre?.compound||"—"} · ${row?.tyre?.age_laps??"—"}L`;
  if(mode==="strategy")return pitWindowLabel(row?.pit_window);
  return index===0?"LEAD":formatInterval(row?.gap_to_leader_ms);
}

function useSmoothTrackProgress(target,{duration=700,individualDuration=null,running=false,onFrame=null}={}){
  const normalizedTarget=Number(target)||0;
  const currentRef=useRef(normalizedTarget);
  const targetRef=useRef(normalizedTarget);
  const frameRef=useRef(null);
  const onFrameRef=useRef(onFrame);
  const [display,setDisplay]=useState(normalizedTarget);

  useEffect(()=>{onFrameRef.current=onFrame;},[onFrame]);

  useEffect(()=>{
    if(frameRef.current)cancelAnimationFrame(frameRef.current);
    const from=currentRef.current;
    const previousTarget=targetRef.current;
    const to=unwrapTrackProgress(from,normalizedTarget);
    const previousUnwrapped=unwrapTrackProgress(from,previousTarget);
    const targetChanged=Math.abs(to-previousUnwrapped)>0.000001;
    targetRef.current=to;

    if(!running){
      if(targetChanged){
        currentRef.current=to;
        setDisplay(to);
        onFrameRef.current?.(to);
      }
      return undefined;
    }

    if(Math.abs(to-from)<0.000001){
      onFrameRef.current?.(from);
      return undefined;
    }

    const started=performance.now();
    const motionDuration=Math.max(1,Number(duration)||700);
    const tick=(now)=>{
      const t=Math.min(1,(now-started)/motionDuration);
      const visualT=visualMotionProgress(t,{
        individualDurationMs:individualDuration??motionDuration,
        globalDurationMs:motionDuration,
      });
      const value=from+(to-from)*visualT;
      currentRef.current=value;
      setDisplay(value);
      onFrameRef.current?.(value);
      if(t<1)frameRef.current=requestAnimationFrame(tick);
    };
    frameRef.current=requestAnimationFrame(tick);
    return ()=>{if(frameRef.current)cancelAnimationFrame(frameRef.current);};
  },[normalizedTarget,running,duration,individualDuration]);

  return display;
}

function useSmoothNumber(target,{duration=700,running=false}={}){
  const normalized=target==null?NaN:Number(target);
  const valid=Number.isFinite(normalized);
  const currentRef=useRef(valid?normalized:null);
  const targetRef=useRef(valid?normalized:null);
  const frameRef=useRef(null);
  const [display,setDisplay]=useState(valid?normalized:null);

  useEffect(()=>{
    if(frameRef.current)cancelAnimationFrame(frameRef.current);
    const next=target==null?NaN:Number(target);
    if(!Number.isFinite(next)){
      currentRef.current=null;
      targetRef.current=null;
      setDisplay(null);
      return undefined;
    }
    const from=currentRef.current==null?next:Number(currentRef.current);
    const previousTarget=targetRef.current;
    const changed=previousTarget==null||!Number.isFinite(Number(previousTarget))||Math.abs(next-Number(previousTarget))>0.001;
    targetRef.current=next;

    if(!running||!changed){
      currentRef.current=next;
      setDisplay(next);
      return undefined;
    }

    const started=performance.now();
    const motionDuration=Math.max(1,Number(duration)||700);
    const tick=(now)=>{
      const t=Math.min(1,(now-started)/motionDuration);
      const value=interpolateVisualGap(from,next,t);
      currentRef.current=value;
      setDisplay(value);
      if(t<1)frameRef.current=requestAnimationFrame(tick);
    };
    frameRef.current=requestAnimationFrame(tick);
    return ()=>{if(frameRef.current)cancelAnimationFrame(frameRef.current);};
  },[target,running,duration]);

  return display;
}

function AnimatedGapValue({target,leader=false,retired=false,running=false,duration=700,className=""}){
  const display=useSmoothNumber(target,{duration,running});
  const text=retired?"DNF":leader?"LEAD":formatInterval(display);
  return <span className={className}>{text}</span>;
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
  motionRunning=false,
  motionDuration=700,
  individualMotionDuration=null,
  onVisualProgress=null,
}){
  const display=useSmoothTrackProgress(progress,{
    duration:motionDuration,
    individualDuration:individualMotionDuration,
    running:motionRunning,
    onFrame:onVisualProgress,
  });
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

function DriverInspector({row,drivers,teams,playerTeamId}){
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
        <Stat label="Strategy" value={paceLabel(row?.current_pace)} sub={pitWindowLabel(row?.pit_window)} icon={<Gauge className="h-3 w-3"/>}/>
        <Stat label="Projection" value={projection} sub={projectionRange||(`${Number(row?.projection_confidence_pct||0).toFixed(0)}% confidence`)} tone="text-violet-200"/>
      </div>
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
  playbackRunning=false,
  playbackSpeed=1,
  playbackBaseSectorMs=30000,
  lapLengthKm=null,
  busy=false,
  onRestartRace=null,
  onConfirmResults=null,
}){
  const resolved=useMemo(()=>resolveTrackLayout({trackId,year}),[trackId,year]);
  const layout=resolved.layout;
  const intelligence=useMemo(()=>trackIntelligenceProfile(layout),[layout]);
  const geometry=resolved.geometry;
  const displayGeometry=useMemo(()=>orientTrackGeometry(geometry),[geometry]);
  const fittedViewBox=useMemo(()=>trackGeometryViewBox(displayGeometry),[displayGeometry]);
  const activeRows=useMemo(()=>(rows||[]).slice().sort((a,b)=>Number(a?.position??999)-Number(b?.position??999)),[rows]);
  const referenceLapMs=activeRows.map((row)=>Number(row?.last_lap_ms||row?.best_lap_ms)).filter((value)=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b)[0]||90000;
  const [orderExpanded,setOrderExpanded]=useState(false);
  const [orderMode,setOrderMode]=useState("order");
  const [feedExpanded,setFeedExpanded]=useState(false);
  const [cameraMode,setCameraMode]=useState("fit");
  const [showTrackIntel,setShowTrackIntel]=useState(true);
  const svgRef=useRef(null);
  const followViewBoxRef=useRef(null);
  const motionDuration=raceMotionDurationMs(playbackSpeed,playbackBaseSectorMs);
  const visualModel=useMemo(()=>buildRaceVisualModel(activeRows,{
    currentSector:Math.max(1,Number(currentSector)||1),
    playbackSpeed,
    globalSectorMs:playbackBaseSectorMs,
    currentControl,
  }),[activeRows,currentSector,playbackSpeed,playbackBaseSectorMs,currentControl]);
  const visualByDriver=useMemo(()=>new globalThis.Map(visualModel.map((row)=>[String(row.driver_id),row])),[visualModel]);
  const averageSpeedKmh=raceAverageSpeedKmh(lapLengthKm,referenceLapMs);

  useEffect(()=>{
    followViewBoxRef.current=null;
    setCameraMode("fit");
  },[trackId,year]);

  const resolvedSelectedId=String(selectedDriverId||"");
  const selectedRow=activeRows.find((row)=>String(row?.driver_id||"")===resolvedSelectedId)||null;
  const selectedIndex=Math.max(0,activeRows.findIndex((row)=>String(row?.driver_id||"")===resolvedSelectedId));
  const selectedVisibleOnTrack=selectedRow?retiredCarVisibleOnTrack(selectedRow,{currentLap,currentSector,currentControl}):false;
  const selectedProgress=selectedRow&&selectedVisibleOnTrack?visualTrackProgress(selectedRow,{currentLap,currentSector,referenceLapMs,index:selectedIndex}):null;
  const selectedPoint=selectedProgress==null?null:pointAtTrackProgress(displayGeometry,selectedProgress);
  const snapshotFocusViewBox=cameraMode==="follow"&&selectedPoint
    ?focusTrackViewBox(fittedViewBox,selectedPoint,{zoom:2.45,minWidth:210,minHeight:155})
    :fittedViewBox;
  const renderedViewBox=cameraMode==="follow"
    ?(followViewBoxRef.current||snapshotFocusViewBox)
    :fittedViewBox;
  const selectDriver=(driverId)=>{
    followViewBoxRef.current=null;
    setCameraMode("follow");
    onSelectDriver?.(String(driverId||""));
  };
  const followSelectedVisualProgress=(progress)=>{
    if(cameraMode!=="follow"||!svgRef.current)return;
    const point=pointAtTrackProgress(displayGeometry,progress);
    if(!point)return;
    const box=focusTrackViewBox(fittedViewBox,point,{zoom:2.45,minWidth:210,minHeight:155});
    followViewBoxRef.current=box;
    svgRef.current.setAttribute("viewBox",box.join(" "));
  };
  useEffect(()=>{followViewBoxRef.current=null;},[resolvedSelectedId]);
  const visibleEvents=(events||[]).slice(0,feedExpanded?10:3);
  const trackIntelEvents=(events||[]).filter((event)=>{
    const progress=raceEventTrackProgress(event,intelligence);
    if(progress==null)return false;
    const control=String(event?.control_type||"").toUpperCase();
    const type=String(event?.type||"").toLowerCase();
    const message=String(event?.display_text||event?.message||"").toLowerCase();
    return type==="incident"||type==="race_control"||control.includes("YELLOW")||control==="RED_FLAG"||/dnf|retir|collision|crash/.test(message);
  }).slice(0,8);
  const progressPct=Math.max(0,Math.min(100,(((Math.max(0,Number(currentLap||0)-1))+(Number(currentSector||0)/3))/Math.max(1,Number(totalLaps||1)))*100));

  if(!layout){
    return <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20 text-sm text-slate-500">
      <div className="text-center"><MapIcon className="mx-auto mb-2 h-6 w-6"/>No 2D circuit asset is available for this track yet.</div>
    </div>;
  }

  const orderPanelClass=orderExpanded
    ?"xl:grid-cols-[300px_minmax(0,1fr)_188px] 2xl:grid-cols-[320px_minmax(0,1fr)_198px]"
    :"xl:grid-cols-[172px_minmax(0,1fr)_188px] 2xl:grid-cols-[184px_minmax(0,1fr)_198px]";

  return <section className="overflow-hidden rounded-xl border border-white/10 bg-[#090d13] shadow-2xl">
    <div className="flex min-h-10 items-center gap-2 border-b border-white/10 bg-[#0b1017] px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <MapIcon className="h-3.5 w-3.5 shrink-0 text-slate-500"/>
        <h4 className="truncate text-[12px] font-semibold">{layout.label} · Race View</h4>
      </div>
      <div className="flex-1"/>
      <div className="flex shrink-0 items-center gap-1 text-[9px]">
        <span className={`rounded border px-1.5 py-1 ${resolutionTone(resolved.resolution)}`} title={layout.source_label||""}>{resolved.fallback?"Provisional":"Layout"}</span>
        {layout.historical_status!=="verified"?<span className="inline-flex items-center rounded border border-amber-500/20 bg-amber-500/[0.07] px-1.5 py-1 text-amber-200"><TriangleAlert className="mr-1 h-3 w-3"/>PROV</span>:null}
        <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 font-bold ${controlTone(currentControl)}`}><Flag className="h-3 w-3"/>{String(currentControl||"GREEN").replaceAll("_"," ")}</span>
      </div>
    </div>
    <div className="h-0.5 bg-white/[0.04]"><div className="h-full bg-sky-300/80 transition-all" style={{width:`${progressPct}%`}}/></div>

    <div className={`grid ${orderPanelClass}`}>
      <div className="relative order-1 min-h-[470px] overflow-hidden bg-[radial-gradient(circle_at_center,rgba(51,65,85,.16),transparent_64%)] md:min-h-[510px] xl:order-2 xl:min-h-[540px] 2xl:min-h-[570px]">
        {displayGeometry?<svg ref={svgRef} className="absolute inset-0 h-full w-full p-1 md:p-2" viewBox={renderedViewBox.join(" ")} preserveAspectRatio="xMidYMid meet" aria-label={`${layout.label} circuit and live car positions`}>
          {(()=>{
            const closed=[...displayGeometry.points,displayGeometry.points[0]];
            const polyline=closed.map((point)=>point.join(",")).join(" ");
            return <>
              <polyline points={polyline} fill="none" stroke="#020617" strokeWidth="34" strokeLinejoin="round" strokeLinecap="round" opacity=".96"/>
              <polyline points={polyline} fill="none" stroke="#cbd5e1" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" opacity=".74"/>
              {showTrackIntel&&Number(currentSector)>0?(()=>{
                const sector=Math.max(1,Math.min(3,Number(currentSector)||1));
                const segment=trackSectorPolylinePoints(displayGeometry,sector,intelligence,{samples:42});
                return <polyline
                  points={segment.map((point)=>point.join(",")).join(" ")}
                  fill="none"
                  stroke={String(currentControl||"").includes("YELLOW")?"#f59e0b":"#38bdf8"}
                  strokeWidth="22"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity=".23"
                />;
              })():null}
              <polyline points={polyline} fill="none" stroke="#475569" strokeWidth="2.2" strokeDasharray="8 8" strokeLinejoin="round" strokeLinecap="round" opacity=".72"/>
              {showTrackIntel&&Array.isArray(displayGeometry?.pit_lane_points)&&displayGeometry.pit_lane_points.length>1?<polyline
                points={displayGeometry.pit_lane_points.map((point)=>point.join(",")).join(" ")}
                fill="none"
                stroke="#22c55e"
                strokeWidth="8"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray="10 5"
                opacity=".78"
              />:null}
              {showTrackIntel&&intelligence.pit_entry_progress!=null?(()=>{
                const line=trackMarkerSegment(displayGeometry,intelligence.pit_entry_progress,{length:28});
                return line?<g><line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#22c55e" strokeWidth="3"/><text x={line.center.x} y={line.center.y-10} textAnchor="middle" fontSize="7" fontWeight="800" fill="#86efac">PIT IN</text></g>:null;
              })():null}
              {showTrackIntel&&intelligence.pit_exit_progress!=null?(()=>{
                const line=trackMarkerSegment(displayGeometry,intelligence.pit_exit_progress,{length:28});
                return line?<g><line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#22c55e" strokeWidth="3"/><text x={line.center.x} y={line.center.y-10} textAnchor="middle" fontSize="7" fontWeight="800" fill="#86efac">PIT OUT</text></g>:null;
              })():null}
              {showTrackIntel?(()=>{
                const markers=[
                  {progress:intelligence.start_finish_progress,label:"S/F",kind:"start"},
                  {progress:intelligence.sector_boundaries[0],label:"S2",kind:"sector"},
                  {progress:intelligence.sector_boundaries[1],label:"S3",kind:"sector"},
                ];
                return markers.map((marker)=>{
                  const line=trackMarkerSegment(displayGeometry,marker.progress,{length:marker.kind==="start"?48:38});
                  if(!line)return null;
                  const current=marker.kind==="sector"&&Number(currentSector)===Number(marker.label.slice(1));
                  return <g key={marker.label}>
                    <line
                      x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                      stroke={marker.kind==="start"?"#f8fafc":current?"#38bdf8":"#94a3b8"}
                      strokeWidth={marker.kind==="start"?5:3}
                      strokeDasharray={marker.kind==="start"?"5 4":"none"}
                      opacity={marker.kind==="start"?0.95:0.85}
                    />
                    <circle cx={line.center.x} cy={line.center.y} r={marker.kind==="start"?13:11} fill="#05080d" stroke={marker.kind==="start"?"#f8fafc":current?"#38bdf8":"#64748b"} strokeWidth="2"/>
                    <text x={line.center.x} y={line.center.y+3.2} textAnchor="middle" fontSize={marker.kind==="start"?"7.5":"8"} fontWeight="900" fill={marker.kind==="start"?"#f8fafc":current?"#7dd3fc":"#cbd5e1"}>{marker.label}</text>
                  </g>;
                });
              })():null}
              {showTrackIntel?[1,2,3].map((sector)=>{
                const sectorProgress=raceEventTrackProgress({sector,sector_progress:.5},intelligence);
                const point=pointAtTrackProgress(displayGeometry,sectorProgress);
                if(!point)return null;
                const active=Number(currentSector)===sector;
                return <g key={`sector-label-${sector}`} opacity={active?1:.62}>
                  <circle cx={point.x} cy={point.y} r={active?12:9} fill={active?"#0c4a6e":"#0f172a"} stroke={active?"#38bdf8":"#475569"} strokeWidth="1.5"/>
                  <text x={point.x} y={point.y+3} textAnchor="middle" fontSize={active?"8.5":"7.5"} fontWeight="900" fill={active?"#e0f2fe":"#94a3b8"}>S{sector}</text>
                </g>;
              }):null}
              {showTrackIntel?trackIntelEvents.map((event,index)=>{
                const progress=raceEventTrackProgress(event,intelligence);
                const base=pointAtTrackProgress(displayGeometry,progress);
                if(!base)return null;
                const tone=incidentMarkerTone(event);
                const angle=(index%4)*(Math.PI/2);
                const offset=(index%3)*7;
                const x=base.x+Math.cos(angle)*offset;
                const y=base.y+Math.sin(angle)*offset;
                return <g
                  key={event?.event_key||event?.id||`track-event-${index}`}
                  role="button"
                  tabIndex="0"
                  className="cursor-pointer outline-none"
                  onClick={()=>onSelectEvent?.(event)}
                  onKeyDown={(keyboardEvent)=>{if(keyboardEvent.key==="Enter"||keyboardEvent.key===" "){keyboardEvent.preventDefault();onSelectEvent?.(event);}}}
                >
                  <title>{event?.display_text||event?.message||"Race event"}</title>
                  <circle cx={x} cy={y} r="13" fill="#020617" stroke={tone.stroke} strokeWidth="2.5"/>
                  <circle cx={x} cy={y} r="9" fill={tone.fill} opacity=".95"/>
                  <text x={x} y={y+3.5} textAnchor="middle" fontSize="9" fontWeight="900" fill="#fff">{tone.label}</text>
                </g>;
              }):null}
            </>;
          })()}
          {activeRows.map((row,index)=>{
            const did=String(row?.driver_id||"");
            const tid=String(row?.team_id||"");
            const mine=tid===String(playerTeamId||"");
            const selected=did===resolvedSelectedId;
            const visibleOnTrack=retiredCarVisibleOnTrack(row,{currentLap,currentSector,currentControl});
            if(!visibleOnTrack)return null;
            const progress=visualTrackProgress(row,{currentLap,currentSector,referenceLapMs,index});
            const visualRow=visualByDriver.get(did);
            return <AnimatedMarker
              key={did||index}
              geometry={displayGeometry}
              progress={progress}
              color={markerColor(teamBrands,tid,year)}
              label={shortDriverName(drivers,did)}
              mine={mine}
              selected={selected}
              onSelect={()=>selectDriver(did)}
              retired={Boolean(row?.retired)}
              motionRunning={Boolean(playbackRunning)}
              motionDuration={motionDuration}
              individualMotionDuration={visualRow?.motion_duration_ms??motionDuration}
              onVisualProgress={selected?followSelectedVisualProgress:null}
              title={`P${row?.position??index+1} · ${driverName(drivers,did)} · ${teamName(teams,tid)}`}
            />;
          })}
        </svg>:null}

        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#05080d]/85 to-transparent"/>
        <div className="absolute right-3 top-3 z-30 flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={()=>setShowTrackIntel((value)=>!value)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[9px] font-semibold shadow-lg backdrop-blur ${showTrackIntel?"border-sky-400/30 bg-sky-500/15 text-sky-200":"border-white/15 bg-[#0a0f16]/90 text-slate-400 hover:bg-white/[0.10]"}`}
          ><Flag className="h-3.5 w-3.5"/>Track intel</button>
          {cameraMode==="follow"?<button
            type="button"
            onClick={()=>{followViewBoxRef.current=null;setCameraMode("fit");}}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-[#0a0f16]/90 px-2.5 py-1.5 text-[9px] font-semibold text-slate-300 shadow-lg backdrop-blur hover:bg-white/[0.10]"
          ><Minimize2 className="h-3.5 w-3.5"/>Full track</button>:null}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#05080d]/75 to-transparent"/>

        <div className="absolute bottom-3 left-3 z-20 w-[min(420px,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-white/15 bg-[#0a0f16]/88 shadow-xl backdrop-blur-xl">
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

      <aside className="order-2 border-t border-white/10 bg-[#070a0f] xl:order-1 xl:border-r xl:border-t-0">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-2">
          <div>
            <div className="text-[16px] font-black tracking-tight text-slate-100">L{Number(currentLap)||0}<span className="text-[10px] text-slate-500">/{Number(totalLaps)||0}</span></div>
            <div className="text-[8px] font-bold uppercase tracking-[0.14em] text-sky-300">Sector {Math.max(1,Number(currentSector)||1)} · {playbackRunning?`${playbackSpeed}× LIVE`:"PAUSED"}</div>
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

        <div className="max-h-[545px] overflow-y-auto p-0.5 2xl:max-h-[580px]">
          {activeRows.map((row,index)=>{
            const did=String(row?.driver_id||"");
            const tid=String(row?.team_id||"");
            const mine=tid===String(playerTeamId||"");
            const selected=did===resolvedSelectedId;
            const color=markerColor(teamBrands,tid,year);
            return <button
              type="button"
              key={did||index}
              onClick={()=>selectDriver(did)}
              className={`mb-px flex w-full items-center gap-1 border-l-[3px] px-1 py-[4px] text-left text-[9px] transition ${selected?"bg-white/[0.13]":"hover:bg-white/[0.055]"}`}
              style={{borderLeftColor:row?.retired?"#7f1d1d":color}}
            >
              <span className="w-6 shrink-0 text-right text-[10px] font-black italic text-slate-100">{row?.position??index+1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1">
                  {mine?<span title="Your Team" className="text-[7px] text-amber-300">◆</span>:null}
                  <span className="truncate font-black tracking-[0.03em] text-slate-100">{orderExpanded?driverName(drivers,did):shortDriverName(drivers,did)}</span>
                </span>
                {orderExpanded?<span className="block truncate text-[8px] text-slate-600">{teamName(teams,tid)}</span>:null}
              </span>
              {!orderExpanded?<MiniTyreIcon compound={row?.tyre?.compound} size={13}/>:null}
              {orderExpanded&&orderMode==="tyres"
                ?<span className="flex shrink-0 items-center gap-1 font-mono text-[8px] text-slate-400"><MiniTyreIcon compound={row?.tyre?.compound} size={15}/>{row?.tyre?.age_laps??"—"}L</span>
                :(!orderExpanded||orderMode==="order")
                  ?<AnimatedGapValue
                    target={row?.gap_to_leader_ms}
                    leader={index===0}
                    retired={Boolean(row?.retired)}
                    running={Boolean(playbackRunning)}
                    duration={motionDuration}
                    className={`shrink-0 font-mono text-[8px] ${row?.retired?"text-red-300":index===0?"text-slate-100":"text-slate-400"}`}
                  />
                  :<span className={`shrink-0 font-mono text-[8px] ${row?.retired?"text-red-300":"text-slate-400"}`}>{orderModeValue(row,index,orderMode)}</span>}
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
              <Stat label="Interval" value={<AnimatedGapValue target={selectedRow?.interval_ms} leader={Number(selectedRow?.position)===1} retired={Boolean(selectedRow?.retired)} running={Boolean(playbackRunning)} duration={motionDuration}/>}/>
              <Stat label="Leader" value={selectedRow?.retired?"DNF":Number(selectedRow?.position)===1?"—":<AnimatedGapValue target={selectedRow?.gap_to_leader_ms} running={Boolean(playbackRunning)} duration={motionDuration}/>}/>
            </>:null}
            {orderMode==="timing"?<>
              <Stat label="S1" value={formatLapTime(selectedRow?.sector_1_ms)}/>
              <Stat label="S2" value={formatLapTime(selectedRow?.sector_2_ms)}/>
              <Stat label="S3" value={formatLapTime(selectedRow?.sector_3_ms)}/>
              <Stat label="Best" value={formatLapTime(selectedRow?.best_lap_ms)} tone="text-emerald-300"/>
            </>:null}
            {orderMode==="tyres"?<>
              <div className="min-w-0 rounded-md border border-white/10 bg-black/25 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-[0.12em] text-slate-500">Compound</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs font-bold"><MiniTyreIcon compound={selectedRow?.tyre?.compound} size={20}/>{selectedRow?.tyre?.compound||"—"}</div>
              </div>
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

      <aside className="order-3 border-t border-white/10 bg-[#080c12] xl:border-l xl:border-t-0">
        <div className="border-b border-white/10 px-2.5 py-2">
          <div className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">Race Conditions</div>
          <div className="mt-1 text-sm font-black text-slate-100">{String(lastWeather||"SUNNY").replaceAll("_"," ")}</div>
          {forecast?.message?<div className="mt-0.5 text-[8px] leading-snug text-sky-300/75">{forecast.message}</div>:null}
        </div>
        <div className="grid grid-cols-2 gap-px bg-white/[0.06]">
          <div className="bg-[#0b1017] p-2">
            <div className="flex items-center gap-1 text-[8px] uppercase text-slate-500"><CloudRain className="h-3 w-3"/>Rain</div>
            <div className="mt-0.5 text-sm font-black text-sky-300">{Math.round(Number(trackState?.rain_intensity||0)*100)}%</div>
          </div>
          <div className="bg-[#0b1017] p-2">
            <div className="flex items-center gap-1 text-[8px] uppercase text-slate-500"><Droplets className="h-3 w-3"/>Wet</div>
            <div className="mt-0.5 text-sm font-black text-cyan-300">{Math.round(Number(trackState?.track_wetness||0)*100)}%</div>
          </div>
          <div className="bg-[#0b1017] p-2">
            <div className="text-[8px] uppercase text-slate-500">Grip</div>
            <div className="mt-0.5 text-sm font-black text-slate-100">{Number(trackState?.grip_index??100).toFixed(0)}</div>
          </div>
          <div className="bg-[#0b1017] p-2">
            <div className="text-[8px] uppercase text-slate-500">Visibility</div>
            <div className="mt-0.5 text-sm font-black text-slate-100">{Number(trackState?.visibility_index??100).toFixed(0)}%</div>
          </div>
        </div>
        <div className="grid gap-1.5 p-2.5 text-[9px]">
          <div className="flex items-center justify-between gap-2 rounded bg-white/[0.035] px-2 py-1.5"><span className="text-slate-500">Track</span><span className="font-bold text-slate-200">{Number.isFinite(Number(trackState?.track_temp_c))?Number(trackState.track_temp_c).toFixed(1)+"°C":"—"}</span></div>
          <div className="flex items-center justify-between gap-2 rounded bg-white/[0.035] px-2 py-1.5"><span className="text-slate-500">Air</span><span className="font-bold text-slate-200">{Number.isFinite(Number(trackState?.air_temp_c))?Number(trackState.air_temp_c).toFixed(1)+"°C":"—"}</span></div>
          <div className="rounded border border-fuchsia-400/10 bg-fuchsia-500/[0.05] px-2 py-1.5">
            <div className="text-[7px] font-bold uppercase tracking-[0.12em] text-fuchsia-300/70">Fastest Lap</div>
            <div className="mt-0.5 font-mono text-[12px] font-black text-fuchsia-300">{formatLapTime(timingSummary?.fastest_lap_ms)}</div>
            <div className="truncate text-[8px] text-slate-500">{timingSummary?.fastest_lap_driver_id?driverName(drivers,timingSummary.fastest_lap_driver_id):"—"}</div>
          </div>
          <div className="rounded border border-sky-400/10 bg-sky-500/[0.04] px-2 py-1.5">
            <div className="text-[7px] font-bold uppercase tracking-[0.12em] text-sky-300/70">Live Pace</div>
            <div className="mt-0.5 text-[11px] font-black text-sky-200">{Math.round(Number(playbackBaseSectorMs||0)/100)/10}s / sector</div>
            <div className="text-[8px] text-slate-500">1× real time{Number.isFinite(Number(lapLengthKm))?` · ${Number(lapLengthKm).toFixed(3)} km`:""}{Number.isFinite(Number(averageSpeedKmh))?` · ~${Math.round(averageSpeedKmh)} km/h avg`:""}</div>
          </div>
          {selectedRow?<div className="rounded border border-white/10 bg-white/[0.035] px-2 py-1.5">
            <div className="truncate text-[9px] font-bold text-slate-200">{driverName(drivers,selectedRow.driver_id)}</div>
            <div className="mt-0.5 flex justify-between text-[8px] text-slate-500"><span>P{selectedRow.position??"—"}</span><AnimatedGapValue target={selectedRow?.gap_to_leader_ms} leader={Number(selectedRow.position)===1} retired={Boolean(selectedRow.retired)} running={Boolean(playbackRunning)} duration={motionDuration}/></div>
            <div className="mt-1 flex items-center gap-1"><MiniTyreIcon compound={selectedRow?.tyre?.compound} size={15}/><span className="text-[8px] text-slate-400">{selectedRow?.tyre?.compound||"—"} · {Number.isFinite(Number(selectedRow?.tyre?.condition))?Number(selectedRow.tyre.condition).toFixed(0)+"%":"—"}</span></div>
          </div>:null}
        </div>
      </aside>
    </div>
  </section>;
}
