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
  Minus,
  Plus,
  Thermometer,
  Timer,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { DriverPortrait, TeamLogo } from "../entity/EntityVisuals.jsx";
import { orientTrackGeometry, pointAtTrackProgress, raceEventTrackProgress, resolveTrackLayout, trackGeometryViewBox, trackIntelligenceProfile, trackLayoutResolutionLabel, trackMarkerSegment, trackPresentationGeometry, trackSectorPolylinePoints } from "../../domain/trackLayout.js";
import { raceMarkerLaneOffset, racePlaybackDelayMs, retiredCarVisibleOnTrack } from "../../domain/racePlayback.js";
import { openPolylineHeadingDegrees, simplifyTrackPresentationGeometry, trackHeadingDegrees } from "../../domain/trackSceneGeometry.js";
import { dampTrackViewBox, followTrackViewBox, panTrackViewBox, trackCameraZoomFactor, trackFollowZoomFromWheel, trackLodForZoom, trackMarkerScaleForViewBox, zoomTrackViewBox } from "../../domain/trackCamera.js";
import TrackSceneRenderer from "./TrackSceneRenderer.jsx";
import RaceCarsLayer from "./RaceCarsLayer.jsx";
import RaceCarsLayerV3 from "./RaceCarsLayerV3.jsx";
import { buildClosedRacingLine } from "../../domain/raceSplineV3.js";
import { advanceVisualTimelineProgress, applyVisualPitLaneState, authoritativeRaceWorldProgress, createVisualRaceTimeline, driverVisualMotionDurationMs, raceVisualSnapshotKey, visualPitLaneState, visualRaceTimelineFrame } from "../../domain/raceVisualModel.js";

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

function markerPalette(teamBrands,teamId,year){
  const brand=brandForTeam(teamBrands,teamId,year);
  return {
    primary:brand?.primary_color||"#94a3b8",
    secondary:brand?.secondary_color||"#e2e8f0",
  };
}
function markerColor(teamBrands,teamId,year){
  return markerPalette(teamBrands,teamId,year).primary;
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
  return `+${(n/1000).toFixed(3)}`;
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

function useVisualRaceTimeline({
  rows,
  currentLap,
  currentSector,
  referenceLapMs,
  playbackRunning,
  playbackSpeed,
  playbackBaseSectorMs,
  currentControl,
  hasPitLane=false,
  pitEntryProgress=null,
  pitExitProgress=null,
}){
  const snapshotKey=useMemo(
    ()=>raceVisualSnapshotKey(rows,{currentLap,currentSector}),
    [rows,currentLap,currentSector]
  );
  const previousSnapshotRef=useRef(null);
  const previousContextRef=useRef(null);
  const progressRef=useRef(1);
  const [progress,setProgress]=useState(1);
  const [timeline,setTimeline]=useState(()=>createVisualRaceTimeline(rows,rows,{
    previousLap:currentLap,
    previousSector:currentSector,
    currentLap,
    currentSector,
    referenceLapMs,
    playbackSpeed,
    globalSectorMs:playbackBaseSectorMs,
    currentControl,
  }));

  useEffect(()=>{
    const previousSnapshot=previousSnapshotRef.current;
    const previousContext=previousContextRef.current;
    const nextTimeline=createVisualRaceTimeline(previousSnapshot?.rows||rows,rows,{
      previousLap:previousContext?.lap??currentLap,
      previousSector:previousContext?.sector??currentSector,
      currentLap,
      currentSector,
      referenceLapMs,
      playbackSpeed,
      globalSectorMs:playbackBaseSectorMs,
      currentControl,
    });
    const shouldAnimate=Boolean(
      playbackRunning
      &&previousSnapshot
      &&previousSnapshot.key!==snapshotKey
      &&Number(currentLap)>0
      &&Number(currentSector)>0
    );
    previousSnapshotRef.current={
      key:snapshotKey,
      rows:(rows||[]).map((row)=>({...row})),
    };
    previousContextRef.current={lap:currentLap,sector:currentSector};
    setTimeline(nextTimeline);
    progressRef.current=shouldAnimate?0:1;
    setProgress(shouldAnimate?0:1);
  // Snapshot changes are the only event that starts a new visual transition.
  // Speed/pause changes must continue the existing transition without teleporting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[snapshotKey]);

  const durationMs=racePlaybackDelayMs(playbackSpeed,playbackBaseSectorMs);
  useEffect(()=>{
    if(!playbackRunning||progressRef.current>=1)return undefined;
    let frame=null;
    let previousTime=performance.now();
    let previousCommit=previousTime;
    const speed=Math.max(1,Number(playbackSpeed)||1);
    // React updates the timing panels/targets at a modest cadence. The car layer
    // interpolates those targets independently at display refresh rate.
    const frameIntervalMs=speed>=8?36:speed>=4?40:50;
    const tick=(now)=>{
      const delta=Math.max(0,now-previousTime);
      previousTime=now;
      const next=advanceVisualTimelineProgress(progressRef.current,{
        deltaMs:delta,
        durationMs,
        running:true,
      });
      progressRef.current=next;
      if(next>=1||now-previousCommit>=frameIntervalMs){
        previousCommit=now;
        setProgress(next);
      }
      if(next<1)frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return ()=>{if(frame)cancelAnimationFrame(frame);};
  },[playbackRunning,durationMs,timeline,playbackSpeed]);

  const frame=useMemo(()=>visualRaceTimelineFrame(timeline,progress),[timeline,progress]);
  return useMemo(()=>({
    ...frame,
    rows:applyVisualPitLaneState(frame.rows,rows,{
      hasPitLane,
      pitEntryProgress,
      pitExitProgress,
    }),
  }),[frame,rows,hasPitLane,pitEntryProgress,pitExitProgress]);
}

function pointAtOpenPolylineProgress(points,progress){
  const valid=(Array.isArray(points)?points:[])
    .filter((point)=>Array.isArray(point)&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1])))
    .map((point)=>[Number(point[0]),Number(point[1])]);
  if(valid.length<2)return null;
  const segments=[];
  let total=0;
  for(let index=0;index<valid.length-1;index+=1){
    const [ax,ay]=valid[index];
    const [bx,by]=valid[index+1];
    const length=Math.hypot(bx-ax,by-ay);
    segments.push({start:total,length,ax,ay,bx,by});
    total+=length;
  }
  if(total<=0)return {x:valid[0][0],y:valid[0][1]};
  const t=Math.max(0,Math.min(1,Number(progress)||0));
  const target=t*total;
  let segment=segments.at(-1);
  for(const candidate of segments){
    if(target<=candidate.start+candidate.length){
      segment=candidate;
      break;
    }
  }
  const local=segment.length>0?Math.max(0,Math.min(1,(target-segment.start)/segment.length)):0;
  return {
    x:segment.ax+(segment.bx-segment.ax)*local,
    y:segment.ay+(segment.by-segment.ay)*local,
  };
}

function markerVisualPoint(geometry,{
  trackProgress=0,
  pitLaneProgress=null,
  pitLaneMix=0,
  laneOffset=0,
}={}){
  const trackPoint=pointAtTrackProgress(geometry,Number(trackProgress)||0);
  if(!trackPoint)return null;
  const mix=Math.max(0,Math.min(1,Number(pitLaneMix)||0));
  const pitPoint=Number.isFinite(Number(pitLaneProgress))
    ?pointAtOpenPolylineProgress(geometry?.pit_lane_points,Number(pitLaneProgress))
    :null;
  const effectiveMix=pitPoint?mix:0;
  let point=pitPoint&&effectiveMix>0
    ?{
      x:trackPoint.x+(pitPoint.x-trackPoint.x)*effectiveMix,
      y:trackPoint.y+(pitPoint.y-trackPoint.y)*effectiveMix,
    }
    :trackPoint;

  const lateral=(Number(laneOffset)||0)*(1-effectiveMix);
  if(Math.abs(lateral)>0.0001){
    const before=pointAtTrackProgress(geometry,Number(trackProgress||0)-0.0045);
    const after=pointAtTrackProgress(geometry,Number(trackProgress||0)+0.0045);
    if(before&&after){
      const dx=after.x-before.x;
      const dy=after.y-before.y;
      const length=Math.hypot(dx,dy);
      if(length>0.0001){
        point={
          x:point.x+(-dy/length)*lateral,
          y:point.y+(dx/length)*lateral,
        };
      }
    }
  }
  return point;
}

function AnimatedMarker({
  geometry,
  progress,
  pitLaneProgress=null,
  pitLaneMix=0,
  color,
  secondaryColor="#e2e8f0",
  label,
  title,
  mine=false,
  retired=false,
  selected=false,
  markerScale=1,
  laneOffset=0,
  onSelect,
  onVisualPoint=null,
}){
  const display=Number(progress)||0;
  const laneTarget=Number(laneOffset)||0;
  const laneDisplayRef=useRef(laneTarget);
  const [laneDisplay,setLaneDisplay]=useState(laneTarget);
  const pitTarget={
    progress:Number.isFinite(Number(pitLaneProgress))?Math.max(0,Math.min(1,Number(pitLaneProgress))):0,
    mix:Math.max(0,Math.min(1,Number(pitLaneMix)||0)),
  };
  const pitDisplayRef=useRef(pitTarget);
  const [pitDisplay,setPitDisplay]=useState(pitTarget);

  useEffect(()=>{
    let frame=null;
    const tick=()=>{
      const current=laneDisplayRef.current;
      const next=current+(laneTarget-current)*0.30;
      if(Math.abs(laneTarget-next)<0.015){
        laneDisplayRef.current=laneTarget;
        setLaneDisplay(laneTarget);
        return;
      }
      laneDisplayRef.current=next;
      setLaneDisplay(next);
      frame=requestAnimationFrame(tick);
    };
    if(Math.abs(laneDisplayRef.current-laneTarget)<0.015){
      laneDisplayRef.current=laneTarget;
      setLaneDisplay(laneTarget);
      return undefined;
    }
    frame=requestAnimationFrame(tick);
    return ()=>{if(frame)cancelAnimationFrame(frame);};
  },[laneTarget]);

  useEffect(()=>{
    let frame=null;
    const tick=()=>{
      const current=pitDisplayRef.current;
      const next={
        progress:current.progress+(pitTarget.progress-current.progress)*0.34,
        mix:current.mix+(pitTarget.mix-current.mix)*0.34,
      };
      const settled=Math.abs(next.progress-pitTarget.progress)<0.001&&Math.abs(next.mix-pitTarget.mix)<0.001;
      const value=settled?pitTarget:next;
      pitDisplayRef.current=value;
      setPitDisplay(value);
      if(!settled)frame=requestAnimationFrame(tick);
    };
    const current=pitDisplayRef.current;
    if(Math.abs(current.progress-pitTarget.progress)<0.001&&Math.abs(current.mix-pitTarget.mix)<0.001){
      pitDisplayRef.current=pitTarget;
      setPitDisplay(pitTarget);
      return undefined;
    }
    frame=requestAnimationFrame(tick);
    return ()=>{if(frame)cancelAnimationFrame(frame);};
  },[pitTarget.progress,pitTarget.mix]);

  const point=markerVisualPoint(geometry,{
    trackProgress:display,
    pitLaneProgress:pitDisplay.progress,
    pitLaneMix:pitDisplay.mix,
    laneOffset:laneDisplay,
  });

  useEffect(()=>{
    if(point)onVisualPoint?.(point);
  },[point?.x,point?.y,onVisualPoint]);

  if(!point)return null;

  const trackHeading=trackHeadingDegrees(geometry,display);
  const pitHeading=openPolylineHeadingDegrees(geometry?.pit_lane_points,pitDisplay.progress);
  const headingDelta=((pitHeading-trackHeading+540)%360)-180;
  const heading=trackHeading+(headingDelta*Math.max(0,Math.min(1,pitDisplay.mix)));

  const scale=Math.max(0.08,Math.min(1.25,Number(markerScale)||1));
  const radius=(selected?11.5:mine?9.5:8.5)*scale;
  const textSize=(selected?6.9:mine?6.2:5.8)*scale;
  const outerGap=2.3*scale;
  const haloGap=4.5*scale;
  const haloPulse=3.2*scale;
  return <g
    role="button"
    tabIndex="0"
    data-track-interactive="true"
    aria-label={title}
    className="cursor-pointer outline-none"
    onClick={onSelect}
    onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelect?.();}}}
  >
    <title>{title}</title>
    {selected?<circle cx={point.x} cy={point.y} r={radius+haloGap} fill="none" stroke="#f8fafc" strokeWidth={1.8*scale} opacity=".42">
      <animate
        attributeName="r"
        values={`${radius+haloGap-haloPulse};${radius+haloGap+haloPulse};${radius+haloGap-haloPulse}`}
        dur="1.15s"
        repeatCount="indefinite"
      />
      <animate attributeName="opacity" values=".62;.18;.62" dur="1.15s" repeatCount="indefinite"/>
    </circle>:null}
    <g transform={`translate(${point.x} ${point.y}) rotate(${heading}) scale(${scale})`} opacity={retired?0.62:1}>
      <ellipse cx="-1.5" cy="2.2" rx="13.8" ry="5.2" fill="#020617" opacity=".35"/>
      <rect x="-8.5" y="-7.2" width="5.4" height="4.2" rx="1" fill="#05070a"/>
      <rect x="-8.5" y="3" width="5.4" height="4.2" rx="1" fill="#05070a"/>
      <rect x="5.1" y="-6.6" width="5.2" height="3.8" rx="1" fill="#05070a"/>
      <rect x="5.1" y="2.8" width="5.2" height="3.8" rx="1" fill="#05070a"/>
      <rect x="-12" y="-5.6" width="3.4" height="11.2" rx=".7" fill={secondaryColor} stroke="#020617" strokeWidth=".8"/>
      <path
        d="M -9 -3.9 L -5.3 -5.1 L 2.8 -4.3 L 7.4 -2.5 L 13.8 -1.4 L 16 0 L 13.8 1.4 L 7.4 2.5 L 2.8 4.3 L -5.3 5.1 L -9 3.9 Z"
        fill={retired?"#7f1d1d":color}
        stroke={selected?"#f8fafc":"#0b0f16"}
        strokeWidth={selected?1.6:1.05}
      />
      <path d="M -6.8 -2.8 L -1.5 -3.3 L 2.6 -2.4 L 2.6 2.4 L -1.5 3.3 L -6.8 2.8 Z" fill={secondaryColor} opacity=".88"/>
      <ellipse cx="1.1" cy="0" rx="2.8" ry="2.25" fill="#111827" stroke="#cbd5e1" strokeWidth=".65"/>
      <path d="M 7.6 -1.1 L 14.1 -.55 L 14.1 .55 L 7.6 1.1 Z" fill={secondaryColor} opacity=".9"/>
      <line x1="-10.4" y1="-4.8" x2="-10.4" y2="4.8" stroke="#020617" strokeWidth=".8"/>
    </g>
    <g transform={`translate(${point.x} ${point.y}) scale(${scale})`} pointerEvents="none">
      <rect x="-10.5" y="-15.5" width="21" height="7.5" rx="3.7" fill="#020617" stroke={selected?"#f8fafc":mine?"#fbbf24":"#475569"} strokeWidth="1" opacity=".94"/>
      <text x="0" y="-10.2" textAnchor="middle" fontSize="5.7" fontWeight="900" fill="#fff">{label}</text>
    </g>
    {retired?(()=>{
      const arm=4.8*scale;
      return <path d={`M ${point.x-arm} ${point.y-arm} L ${point.x+arm} ${point.y+arm} M ${point.x+arm} ${point.y-arm} L ${point.x-arm} ${point.y+arm}`} stroke="#fff" strokeWidth={1.6*scale}/>;
    })():null}
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

function polygonPoints(points=[]){
  return (points||[]).map((point)=>point.join(",")).join(" ");
}

function ProceduralTrackEnvironment({environment,viewBox=[0,0,1000,1000]}){
  if(!environment)return null;
  const [vx,vy,vw,vh]=viewBox;
  return <g pointerEvents="none" aria-hidden="true">
    <rect x={vx} y={vy} width={vw} height={vh} fill={environment.base||"#405b29"}/>
    <rect x={vx} y={vy} width={vw} height={vh} fill="url(#track-grass-grid)" opacity=".12"/>
    {(environment.roads||[]).map((road,index)=><g key={"road-"+index}>
      <polyline points={polygonPoints(road.points)} fill="none" stroke="#171b1d" strokeWidth={Number(road.width||14)+6} strokeLinecap="round" strokeLinejoin="round" opacity=".65"/>
      <polyline points={polygonPoints(road.points)} fill="none" stroke="#5a5d5f" strokeWidth={Number(road.width||14)} strokeLinecap="round" strokeLinejoin="round" opacity=".9"/>
      <polyline points={polygonPoints(road.points)} fill="none" stroke="#8f9393" strokeWidth="1.6" strokeDasharray="12 10" opacity=".5"/>
    </g>)}
    {Array.isArray(environment.lake)&&environment.lake.length>2?<g>
      <polygon points={polygonPoints(environment.lake)} fill="#0a7189" stroke="#07566b" strokeWidth="8"/>
      <polygon points={polygonPoints(environment.lake)} fill="url(#track-water)" opacity=".44"/>
    </g>:null}
    {(environment.runoffs||[]).map((points,index)=><polygon key={"runoff-"+index} points={polygonPoints(points)} fill="#2f9e77" stroke="#d1d5db" strokeWidth="2" opacity=".92"/>)}
    {(environment.sand||[]).map((points,index)=><polygon key={"sand-"+index} points={polygonPoints(points)} fill="#d9b978" stroke="#b8995e" strokeWidth="3" opacity=".96"/>)}
    {(environment.buildings||[]).map((row,index)=><g key={"building-"+index}>
      <rect x={row.x+5} y={row.y+6} width={row.w} height={row.h} rx="3" fill="#111827" opacity=".34"/>
      <rect x={row.x} y={row.y} width={row.w} height={row.h} rx="3" fill="#d6d9dc" stroke="#737980" strokeWidth="2"/>
      <line x1={row.x+6} y1={row.y+row.h*.36} x2={row.x+row.w-6} y2={row.y+row.h*.36} stroke="#a3a8ad" strokeWidth="2"/>
      <line x1={row.x+6} y1={row.y+row.h*.68} x2={row.x+row.w-6} y2={row.y+row.h*.68} stroke="#a3a8ad" strokeWidth="2"/>
    </g>)}
    {(environment.grandstands||[]).map((row,index)=><g key={"stand-"+index} transform={`rotate(${Number(row.rotation||0)} ${row.x+row.w/2} ${row.y+row.h/2})`}>
      <rect x={row.x+4} y={row.y+5} width={row.w} height={row.h} rx="2" fill="#020617" opacity=".35"/>
      <rect x={row.x} y={row.y} width={row.w} height={row.h} rx="2" fill="#334155" stroke="#94a3b8" strokeWidth="2"/>
      {Array.from({length:5},(_,line)=><line key={line} x1={row.x+4} y1={row.y+5+line*(Math.max(4,row.h-10)/4)} x2={row.x+row.w-4} y2={row.y+5+line*(Math.max(4,row.h-10)/4)} stroke={line%2?"#ef4444":"#60a5fa"} strokeWidth="2" opacity=".75"/>)}
    </g>)}
    {(environment.trees||[]).map((tree,index)=>{
      const [x,y,r]=tree;
      return <g key={"tree-"+index}>
        <circle cx={x+3} cy={y+5} r={r} fill="#020617" opacity=".25"/>
        <circle cx={x} cy={y} r={r} fill="#1f6a2c" stroke="#123d1b" strokeWidth="2"/>
        <circle cx={x-r*.22} cy={y-r*.25} r={r*.55} fill="#4f9b35" opacity=".88"/>
      </g>;
    })}
  </g>;
}

function TrackMiniMap({geometry,rows=[],teamBrands=[],year,currentControl="GREEN"}){
  if(!geometry||!Array.isArray(geometry?.points)||geometry.points.length<2)return null;
  const viewBox=trackGeometryViewBox(geometry,{paddingRatio:.07,minPadding:22});
  const loop=[...geometry.points,geometry.points[0]];
  return <div className="pointer-events-none absolute bottom-3 right-3 z-20 w-[224px] rounded-md bg-black/15 p-1.5 xl:w-[236px] 2xl:w-[260px]">
    <div className="mb-0.5 flex items-center justify-between px-0.5 text-[7px] font-bold uppercase tracking-[0.12em] text-white/55">
      <span>Mini Map</span><span className={String(currentControl).includes("YELLOW")?"text-amber-300/80":"text-emerald-300/80"}>{String(currentControl||"GREEN").replaceAll("_"," ")}</span>
    </div>
    <svg className="h-[128px] w-full opacity-90 xl:h-[136px] 2xl:h-[150px]" viewBox={viewBox.join(" ")} preserveAspectRatio="xMidYMid meet" aria-label="Circuit mini map">
      <polyline points={polygonPoints(loop)} fill="none" stroke="#020617" strokeWidth="12" strokeLinejoin="round" strokeLinecap="round" opacity=".72"/>
      <polyline points={polygonPoints(loop)} fill="none" stroke="#e5e7eb" strokeWidth="5.2" strokeLinejoin="round" strokeLinecap="round" opacity=".9"/>
      <polyline points={polygonPoints(loop)} fill="none" stroke="#4b5563" strokeWidth="3.1" strokeLinejoin="round" strokeLinecap="round"/>
      {Array.isArray(geometry?.pit_lane_points)&&geometry.pit_lane_points.length>1?<polyline points={polygonPoints(geometry.pit_lane_points)} fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" opacity=".65"/>:null}
      {(rows||[]).filter((row)=>!row?.retired).map((row,index)=>{
        const point=pointAtTrackProgress(geometry,Number(row?.visual_track_progress));
        if(!point)return null;
        const color=markerColor(teamBrands,row?.team_id,year);
        return <circle key={String(row?.driver_id||index)} cx={point.x} cy={point.y} r="4.2" fill={color} stroke="#fff" strokeWidth="1.1"/>;
      })}
    </svg>
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
  const environment=resolved.environment;
  const intelligence=useMemo(()=>trackIntelligenceProfile(layout),[layout]);
  const geometry=resolved.geometry;
  const environmentAssetActive=Boolean(environment?.asset&&environment?.runtime_mode!=="legacy_vector_fallback");
  const proceduralEnvironmentActive=Boolean(environment?.runtime_mode==="f1track_procedural"&&environment?.procedural_environment);
  const [trackRenderMode,setTrackRenderMode]=useState("full");
  const fullTrackSceneActive=proceduralEnvironmentActive&&trackRenderMode==="full";
  const rawWetness=Number(trackState?.wetness??trackState?.track_wetness??trackState?.track?.end_wetness??trackState?.track?.wetness??0);
  const sceneWetness=Number.isFinite(rawWetness)?Math.max(0,Math.min(1,rawWetness>1?rawWetness/100:rawWetness)):0;
  const calibratedGeometry=useMemo(()=>trackPresentationGeometry(geometry,layout),[geometry,layout]);
  const smoothedPresentationGeometry=useMemo(()=>{
    if(!proceduralEnvironmentActive)return calibratedGeometry;
    const style=environment?.race_view_style||{};
    return simplifyTrackPresentationGeometry(calibratedGeometry,{
      tolerance:Number(style.presentation_tolerance||1.25),
      pitTolerance:Number(style.pit_presentation_tolerance||.7),
    });
  },[calibratedGeometry,proceduralEnvironmentActive,environment?.race_view_style]);
  const displayGeometry=useMemo(
    ()=>(environmentAssetActive||proceduralEnvironmentActive)?smoothedPresentationGeometry:orientTrackGeometry(smoothedPresentationGeometry),
    [smoothedPresentationGeometry,environmentAssetActive,proceduralEnvironmentActive]
  );
  const racingLineV3=useMemo(
    ()=>buildClosedRacingLine(displayGeometry?.points,{samplesPerSegment:8}),
    [displayGeometry]
  );
  const miniMapGeometry=displayGeometry;
  const fittedViewBox=useMemo(()=>trackGeometryViewBox(displayGeometry),[displayGeometry]);
  const environmentViewBox=useMemo(()=>(
    Array.isArray(environment?.view_box)&&environment.view_box.length===4
      ?environment.view_box.map(Number)
      :(Array.isArray(geometry?.view_box)&&geometry.view_box.length===4?geometry.view_box.map(Number):[0,0,1000,1000])
  ),[environment?.view_box,geometry?.view_box]);
  const historicalEnvironment=Boolean((environmentAssetActive||proceduralEnvironmentActive)&&layout?.historical_status==="verified");
  const environmentContainsTrackSurface=Boolean(environment?.contains_track_surface);
  const environmentContainsTrackIntel=Boolean(environment?.contains_track_intel);
  const fitViewBox=useMemo(()=>{
    if(!historicalEnvironment)return fittedViewBox;
    const [gx,gy,gw,gh]=fittedViewBox;
    const [ex,ey,ew,eh]=environmentViewBox;
    const minX=Math.min(gx,ex);
    const minY=Math.min(gy,ey);
    const maxX=Math.max(gx+gw,ex+ew);
    const maxY=Math.max(gy+gh,ey+eh);
    return [
      Number(minX.toFixed(2)),
      Number(minY.toFixed(2)),
      Number((maxX-minX).toFixed(2)),
      Number((maxY-minY).toFixed(2)),
    ];
  },[environmentViewBox,fittedViewBox,historicalEnvironment]);
  const authoritativeRows=useMemo(()=>(rows||[]).slice().sort((a,b)=>Number(a?.position??999)-Number(b?.position??999)),[rows]);
  const referenceLapMs=authoritativeRows.map((row)=>Number(row?.last_lap_ms||row?.best_lap_ms)).filter((value)=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b)[0]||90000;
  const hasValidatedPitLane=Boolean(
    Array.isArray(displayGeometry?.pit_lane_points)
    &&displayGeometry.pit_lane_points.length>1
    &&String(layout?.geometry_status||displayGeometry?.quality||"").toLowerCase().includes("verified")
    &&Number.isFinite(Number(intelligence?.pit_entry_progress))
    &&Number.isFinite(Number(intelligence?.pit_exit_progress))
  );
  const visualFrame=useVisualRaceTimeline({
    rows:authoritativeRows,
    currentLap,
    currentSector,
    referenceLapMs,
    playbackRunning,
    playbackSpeed,
    playbackBaseSectorMs,
    currentControl,
    hasPitLane:hasValidatedPitLane,
    pitEntryProgress:intelligence?.pit_entry_progress,
    pitExitProgress:intelligence?.pit_exit_progress,
  });
  const activeRows=visualFrame.rows;
  const [motionEngine,setMotionEngine]=useState("v3");
  const [cameraMode,setCameraMode]=useState("fit");
  const [followZoom,setFollowZoom]=useState(5.25);
  const [freeViewBox,setFreeViewBox]=useState(null);
  const [showTrackIntel,setShowTrackIntel]=useState(true);
  const svgRef=useRef(null);
  const worldSvgRef=useRef(null);
  const followViewBoxRef=useRef(null);
  const followCameraTargetRef=useRef(null);
  const followCameraFrameRef=useRef(null);
  const followCameraTimeRef=useRef(null);
  const panGestureRef=useRef(null);

  useEffect(()=>{
    followViewBoxRef.current=null;
    panGestureRef.current=null;
    setFreeViewBox(null);
    setCameraMode("fit");
    setTrackRenderMode("full");
  },[trackId,year]);

  const resolvedSelectedId=String(selectedDriverId||"");
  const selectedIndex=activeRows.findIndex((row)=>String(row?.driver_id||"")===resolvedSelectedId);
  const selectedRow=selectedIndex>=0?activeRows[selectedIndex]:null;
  const selectedAheadGapRaw=selectedRow?.interval_ms??selectedRow?.gap_to_previous_ms;
  const selectedAheadGapMs=selectedRow&&!selectedRow?.retired&&selectedIndex>0&&selectedAheadGapRaw!=null&&Number.isFinite(Number(selectedAheadGapRaw))
    ?Number(selectedAheadGapRaw)
    :null;
  const selectedBehindRow=selectedRow&&!selectedRow?.retired&&selectedIndex>=0&&selectedIndex<activeRows.length-1
    ?activeRows[selectedIndex+1]
    :null;
  const selectedBehindGapRaw=selectedBehindRow?.interval_ms??selectedBehindRow?.gap_to_previous_ms;
  const selectedBehindGapMs=selectedBehindRow&&!selectedBehindRow?.retired&&selectedBehindGapRaw!=null&&Number.isFinite(Number(selectedBehindGapRaw))
    ?Number(selectedBehindGapRaw)
    :null;
  const selectedVisibleOnTrack=selectedRow?retiredCarVisibleOnTrack(selectedRow,{currentLap,currentSector,currentControl}):false;
  const selectedProgress=selectedRow&&selectedVisibleOnTrack?Number(selectedRow?.visual_track_progress):null;
  const selectedPoint=selectedProgress==null?null:markerVisualPoint(displayGeometry,{
    trackProgress:selectedProgress,
    pitLaneProgress:selectedRow?.visual_pit_lane_progress,
    pitLaneMix:selectedRow?.visual_pit_lane_mix,
  });
  const selectedTrackHeading=selectedProgress==null?0:trackHeadingDegrees(displayGeometry,selectedProgress);
  const selectedPitHeading=openPolylineHeadingDegrees(displayGeometry?.pit_lane_points,selectedRow?.visual_pit_lane_progress);
  const selectedPitMix=Math.max(0,Math.min(1,Number(selectedRow?.visual_pit_lane_mix)||0));
  const selectedHeadingDelta=((selectedPitHeading-selectedTrackHeading+540)%360)-180;
  const selectedCameraPoint=selectedPoint?{
    ...selectedPoint,
    heading:selectedTrackHeading+selectedHeadingDelta*selectedPitMix,
  }:null;
  const snapshotFocusViewBox=cameraMode==="follow"&&selectedCameraPoint
    ?followTrackViewBox(fitViewBox,selectedCameraPoint,{zoom:followZoom,minWidth:88,minHeight:64,lookAheadRatio:.10})
    :fitViewBox;
  const renderedViewBox=cameraMode==="follow"
    ?(followViewBoxRef.current||snapshotFocusViewBox)
    :cameraMode==="free"&&freeViewBox
      ?freeViewBox
      :fitViewBox;
  const effectiveCameraZoom=trackCameraZoomFactor(renderedViewBox,fitViewBox);
  const targetCameraZoom=cameraMode==="follow"?followZoom:effectiveCameraZoom;
  const trackLod=trackLodForZoom(targetCameraZoom);
  const markerScale=trackMarkerScaleForViewBox(
    cameraMode==="follow"?snapshotFocusViewBox:renderedViewBox,
    fitViewBox,
    {power:.72,min:.16,max:1}
  );
  const selectDriver=(driverId)=>{
    followViewBoxRef.current=null;
    setCameraMode("follow");
    onSelectDriver?.(String(driverId||""));
  };
  const followSelectedVisualPoint=(point)=>{
    if(cameraMode!=="follow"||!svgRef.current||!point)return;
    followCameraTargetRef.current=followTrackViewBox(fitViewBox,point,{
      zoom:followZoom,
      minWidth:88,
      minHeight:64,
      lookAheadRatio:.10,
    });
    if(followCameraFrameRef.current)return;
    const tick=(now)=>{
      if(cameraMode!=="follow"||!svgRef.current){
        followCameraFrameRef.current=null;
        followCameraTimeRef.current=null;
        return;
      }
      const target=followCameraTargetRef.current;
      if(!target){
        followCameraFrameRef.current=null;
        followCameraTimeRef.current=null;
        return;
      }
      const previous=followCameraTimeRef.current??now;
      const delta=Math.max(1,Math.min(50,now-previous));
      followCameraTimeRef.current=now;
      const current=followViewBoxRef.current||target;
      const box=dampTrackViewBox(current,target,delta,{timeConstantMs:82,snap:.02});
      const settled=box.every((value,index)=>Math.abs(value-target[index])<0.001);
      followViewBoxRef.current=box;
      const viewBoxText=box.join(" ");
      svgRef.current.setAttribute("viewBox",viewBoxText);
      worldSvgRef.current?.setAttribute("viewBox",viewBoxText);
      if(settled){
        followCameraFrameRef.current=null;
        followCameraTimeRef.current=null;
      }else{
        followCameraFrameRef.current=requestAnimationFrame(tick);
      }
    };
    followCameraFrameRef.current=requestAnimationFrame(tick);
  };
  useEffect(()=>{
    followViewBoxRef.current=null;
    followCameraTargetRef.current=null;
    followCameraTimeRef.current=null;
    if(followCameraFrameRef.current){
      cancelAnimationFrame(followCameraFrameRef.current);
      followCameraFrameRef.current=null;
    }
  },[resolvedSelectedId,cameraMode]);
  useEffect(()=>()=>{if(followCameraFrameRef.current)cancelAnimationFrame(followCameraFrameRef.current);},[]);
  const svgPointFromEvent=(event)=>{
    const svg=svgRef.current;
    if(!svg)return null;
    const matrix=svg.getScreenCTM?.();
    if(!matrix)return null;
    const point=svg.createSVGPoint();
    point.x=Number(event.clientX);
    point.y=Number(event.clientY);
    const transformed=point.matrixTransform(matrix.inverse());
    return {x:transformed.x,y:transformed.y};
  };
  const stopFollowCamera=()=>{
    followViewBoxRef.current=null;
    followCameraTargetRef.current=null;
    if(followCameraFrameRef.current){
      cancelAnimationFrame(followCameraFrameRef.current);
      followCameraFrameRef.current=null;
    }
    followCameraTimeRef.current=null;
  };
  const handleTrackWheel=(event)=>{
    if(!svgRef.current)return;
    event.preventDefault();
    if(cameraMode==="follow"&&selectedVisibleOnTrack){
      setFollowZoom((value)=>Number(trackFollowZoomFromWheel(value,event.deltaY,{min:1.35,max:12,step:1.12}).toFixed(3)));
      return;
    }
    const anchor=svgPointFromEvent(event);
    if(!anchor)return;
    const current=cameraMode==="free"&&freeViewBox?freeViewBox:fitViewBox;
    const factor=event.deltaY<0?0.87:1.15;
    stopFollowCamera();
    setCameraMode("free");
    setFreeViewBox(zoomTrackViewBox(current,fitViewBox,{
      x:anchor.x,
      y:anchor.y,
      factor,
      minWidth:Math.max(72,fitViewBox[2]/13),
      minHeight:Math.max(48,fitViewBox[3]/13),
    }));
  };
  const handleTrackPointerDown=(event)=>{
    if(event.button!==0||!svgRef.current)return;
    if(event.target?.closest?.('[data-track-interactive="true"]'))return;
    const current=cameraMode==="follow"
      ?(followViewBoxRef.current||snapshotFocusViewBox)
      :cameraMode==="free"&&freeViewBox
        ?freeViewBox
        :fitViewBox;
    panGestureRef.current={clientX:event.clientX,clientY:event.clientY,viewBox:[...current]};
    svgRef.current.setPointerCapture?.(event.pointerId);
  };
  const handleTrackPointerMove=(event)=>{
    const gesture=panGestureRef.current;
    if(!gesture||!svgRef.current)return;
    const rect=svgRef.current.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return;
    const dx=-(event.clientX-gesture.clientX)*(gesture.viewBox[2]/rect.width);
    const dy=-(event.clientY-gesture.clientY)*(gesture.viewBox[3]/rect.height);
    stopFollowCamera();
    setCameraMode("free");
    setFreeViewBox(panTrackViewBox(gesture.viewBox,fitViewBox,dx,dy));
  };
  const handleTrackPointerUp=(event)=>{
    panGestureRef.current=null;
    svgRef.current?.releasePointerCapture?.(event.pointerId);
  };
  const resetTrackCamera=()=>{
    stopFollowCamera();
    panGestureRef.current=null;
    setFreeViewBox(null);
    setCameraMode("fit");
  };

  useEffect(()=>{
    const handleKeyDown=(event)=>{
      if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey)return;
      const tag=String(event.target?.tagName||"").toLowerCase();
      if(["input","textarea","select"].includes(tag)||event.target?.isContentEditable)return;
      if(String(event.key||"").toLowerCase()==="t"){
        setTrackRenderMode((mode)=>mode==="full"?"schematic":"full");
        resetTrackCamera();
      }
    };
    window.addEventListener("keydown",handleKeyDown);
    return ()=>window.removeEventListener("keydown",handleKeyDown);
  },[]);

  const trackIntelEvents=(events||[]).filter((event)=>{
    const progress=raceEventTrackProgress(event,intelligence);
    if(progress==null)return false;
    const control=String(event?.control_type||"").toUpperCase();
    const type=String(event?.type||"").toLowerCase();
    const message=String(event?.display_text||event?.message||"").toLowerCase();
    return type==="incident"||type==="race_control"||control.includes("YELLOW")||control==="RED_FLAG"||/dnf|retir|collision|crash/.test(message);
  }).slice(0,8);
  const raceCarsLegacy=activeRows
    .map((row,index)=>({row,index}))
    .sort((a,b)=>{
      const aSelected=String(a.row?.driver_id||"")===resolvedSelectedId?1:0;
      const bSelected=String(b.row?.driver_id||"")===resolvedSelectedId?1:0;
      return aSelected-bSelected;
    })
    .flatMap(({row,index})=>{
      const did=String(row?.driver_id||"");
      const tid=String(row?.team_id||"");
      const selected=did===resolvedSelectedId;
      if(!retiredCarVisibleOnTrack(row,{currentLap,currentSector,currentControl}))return [];
      const previousGap=Number(row?.interval_ms);
      const nextGap=Number(activeRows[index+1]?.interval_ms);
      const closeBattle=(
        (Number.isFinite(previousGap)&&previousGap>=0&&previousGap<1600)
        ||(Number.isFinite(nextGap)&&nextGap>=0&&nextGap<1600)
      );
      const palette=markerPalette(teamBrands,tid,year);
      return [{
        id:did||String(index),
        progress:Number(row?.visual_track_progress)||0,
        pitLaneProgress:Number.isFinite(Number(row?.visual_pit_lane_progress))?Number(row.visual_pit_lane_progress):0,
        pitLaneMix:Math.max(0,Math.min(1,Number(row?.visual_pit_lane_mix)||0)),
        laneOffset:raceMarkerLaneOffset(index,{
          cameraMode:cameraMode==="fit"?"fit":"follow",
          zoom:targetCameraZoom,
          closeBattle,
          selected,
        }),
        color:palette.primary,
        secondary:palette.secondary,
        label:shortDriverName(drivers,did),
        mine:tid===String(playerTeamId||""),
        selected,
        retired:Boolean(row?.retired),
        title:`P${row?.position??index+1} · ${driverName(drivers,did)} · ${teamName(teams,tid)}`,
        onSelect:()=>selectDriver(did),
      }];
    });

  const raceCarsV3=authoritativeRows
    .map((row,index)=>({row,index}))
    .sort((a,b)=>{
      const aSelected=String(a.row?.driver_id||"")===resolvedSelectedId?1:0;
      const bSelected=String(b.row?.driver_id||"")===resolvedSelectedId?1:0;
      return aSelected-bSelected;
    })
    .flatMap(({row,index})=>{
      const did=String(row?.driver_id||"");
      const tid=String(row?.team_id||"");
      const selected=did===resolvedSelectedId;
      if(!retiredCarVisibleOnTrack(row,{currentLap,currentSector,currentControl}))return [];
      const pit=visualPitLaneState(row,{
        hasPitLane:hasValidatedPitLane,
        pitEntryProgress:intelligence?.pit_entry_progress,
        pitExitProgress:intelligence?.pit_exit_progress,
      });
      const baseWorld=authoritativeRaceWorldProgress(row,{
        currentLap,
        currentSector,
        referenceLapMs,
        index,
      });
      const targetWorldProgress=pit.track_anchor_progress==null
        ?baseWorld
        :Number(pit.track_anchor_progress);
      const previousGap=Number(row?.interval_ms);
      const nextGap=Number(authoritativeRows[index+1]?.interval_ms);
      const closeBattle=(
        (Number.isFinite(previousGap)&&previousGap>=0&&previousGap<1600)
        ||(Number.isFinite(nextGap)&&nextGap>=0&&nextGap<1600)
      );
      const palette=markerPalette(teamBrands,tid,year);
      return [{
        id:did||String(index),
        targetWorldProgress,
        motionDurationMs:driverVisualMotionDurationMs(row,{
          currentSector:Math.max(1,Number(currentSector)||1),
          playbackSpeed,
          globalSectorMs:playbackBaseSectorMs,
          currentControl,
        }),
        targetPitLaneProgress:Number.isFinite(Number(pit.pit_lane_progress))?Number(pit.pit_lane_progress):0,
        targetPitLaneMix:Math.max(0,Math.min(1,Number(pit.pit_lane_mix)||0)),
        stopped:Boolean(pit.stopped||row?.retired||String(currentControl||"").toUpperCase()==="RED_FLAG"),
        laneOffset:raceMarkerLaneOffset(index,{
          cameraMode:cameraMode==="fit"?"fit":"follow",
          zoom:targetCameraZoom,
          closeBattle,
          selected,
        }),
        color:palette.primary,
        secondary:palette.secondary,
        label:shortDriverName(drivers,did),
        mine:tid===String(playerTeamId||""),
        selected,
        retired:Boolean(row?.retired),
        title:`P${row?.position??index+1} · ${driverName(drivers,did)} · ${teamName(teams,tid)}`,
        onSelect:()=>selectDriver(did),
      }];
    });
  const progressPct=Math.max(0,Math.min(100,(((Math.max(0,Number(currentLap||0)-1))+(Number(currentSector||0)/3))/Math.max(1,Number(totalLaps||1)))*100));

  if(!layout){
    return <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20 text-sm text-slate-500">
      <div className="text-center"><MapIcon className="mx-auto mb-2 h-6 w-6"/>No 2D circuit asset is available for this track yet.</div>
    </div>;
  }

  const orderPanelClass="xl:grid-cols-[336px_minmax(0,1fr)_176px] 2xl:grid-cols-[360px_minmax(0,1fr)_188px]";

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
      <div className="relative order-1 min-h-[520px] overflow-hidden bg-[radial-gradient(circle_at_center,rgba(51,65,85,.16),transparent_64%)] md:min-h-[570px] xl:order-2 xl:min-h-[620px] 2xl:min-h-[680px]">
        {displayGeometry&&fullTrackSceneActive?<svg
          ref={worldSvgRef}
          className="pointer-events-none absolute inset-0 h-full w-full p-1 md:p-2"
          viewBox={renderedViewBox.join(" ")}
          preserveAspectRatio={cameraMode==="follow"?"xMidYMid slice":"xMidYMid meet"}
          aria-hidden="true"
        >
          <TrackSceneRenderer geometry={displayGeometry} environment={environment.procedural_environment} style={environment.race_view_style} viewBox={environmentViewBox} wetness={sceneWetness} lod={trackLod}/>
        </svg>:null}
        {displayGeometry?<svg ref={svgRef} className="absolute inset-0 h-full w-full touch-none p-1 md:p-2" onWheel={handleTrackWheel} onPointerDown={handleTrackPointerDown} onPointerMove={handleTrackPointerMove} onPointerUp={handleTrackPointerUp} onPointerCancel={handleTrackPointerUp} viewBox={renderedViewBox.join(" ")} preserveAspectRatio={cameraMode==="follow"?"xMidYMid slice":"xMidYMid meet"} aria-label={`${layout.label} circuit and live car positions`}>
          <defs>
            <pattern id="track-grass-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 0 28 L 28 0 M -7 7 L 7 -7 M 21 35 L 35 21" stroke="#9cc36d" strokeWidth="2" opacity=".28"/></pattern>
            <pattern id="track-water" width="36" height="16" patternUnits="userSpaceOnUse"><path d="M0 8 Q9 2 18 8 T36 8" fill="none" stroke="#71d5e7" strokeWidth="2" opacity=".6"/></pattern>
          </defs>
          {environmentAssetActive?<image href={environment.asset} x={environmentViewBox[0]} y={environmentViewBox[1]} width={environmentViewBox[2]} height={environmentViewBox[3]} preserveAspectRatio="none" opacity="1" pointerEvents="none"/>:null}
          {(()=>{
            const closed=[...displayGeometry.points,displayGeometry.points[0]];
            const polyline=closed.map((point)=>point.join(",")).join(" ");
            return <>
              {historicalEnvironment
                ?(!environmentContainsTrackSurface&&!fullTrackSceneActive?<>
                  <polyline points={polyline} fill="none" stroke="#020617" strokeWidth={environment?.race_view_style?.outer_shadow_width||45} strokeLinejoin="round" strokeLinecap="round" opacity=".44"/>
                  <polyline points={polyline} fill="none" stroke={environment?.race_view_style?.kerb_white||"#f8fafc"} strokeWidth={environment?.race_view_style?.kerb_width||39} strokeLinejoin="round" strokeLinecap="round" opacity=".98"/>
                  <polyline points={polyline} fill="none" stroke={environment?.race_view_style?.kerb_red||"#ef4444"} strokeWidth={environment?.race_view_style?.kerb_width||39} strokeDasharray="18 16" strokeLinejoin="round" strokeLinecap="butt" opacity=".98"/>
                  <polyline points={polyline} fill="none" stroke={environment?.race_view_style?.asphalt||"#26282b"} strokeWidth={environment?.race_view_style?.road_width||31} strokeLinejoin="round" strokeLinecap="round" opacity=".995"/>
                  <polyline points={polyline} fill="none" stroke={environment?.race_view_style?.asphalt_highlight||"#34383d"} strokeWidth={Math.max(8,Number(environment?.race_view_style?.road_width||31)-9)} strokeLinejoin="round" strokeLinecap="round" opacity=".72"/>
                </>:null)
                :<>
                  <polyline points={polyline} fill="none" stroke="#020617" strokeWidth="34" strokeLinejoin="round" strokeLinecap="round" opacity=".96"/>
                  <polyline points={polyline} fill="none" stroke="#cbd5e1" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" opacity=".74"/>
                </>}
              {showTrackIntel&&historicalEnvironment&&!environmentContainsTrackIntel?[1,2,3].map((sector)=>{
                const segment=trackSectorPolylinePoints(displayGeometry,sector,intelligence,{samples:110});
                const colors=Array.isArray(layout?.sector_colors)&&layout.sector_colors.length>=3?layout.sector_colors:["#ef4444","#22d3ee","#facc15"];
                return <polyline
                  key={`historic-sector-${sector}`}
                  points={segment.map((point)=>point.join(",")).join(" ")}
                  fill="none"
                  stroke={colors[sector-1]}
                  strokeWidth={fullTrackSceneActive?"1.7":"4.2"}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={fullTrackSceneActive?"7 10":"11 9"}
                  opacity={fullTrackSceneActive?".55":".9"}
                />;
              }):showTrackIntel&&!historicalEnvironment&&Number(currentSector)>0?(()=>{
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
              {!historicalEnvironment?<polyline points={polyline} fill="none" stroke="#475569" strokeWidth="2.2" strokeDasharray="8 8" strokeLinejoin="round" strokeLinecap="round" opacity=".72"/>:null}
              {historicalEnvironment&&!environmentContainsTrackSurface&&!fullTrackSceneActive&&Array.isArray(displayGeometry?.pit_lane_points)&&displayGeometry.pit_lane_points.length>1?<g>
                <polyline
                  points={displayGeometry.pit_lane_points.map((point)=>point.join(",")).join(" ")}
                  fill="none"
                  stroke="#0b1116"
                  strokeWidth="15"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity=".65"
                />
                <polyline
                  points={displayGeometry.pit_lane_points.map((point)=>point.join(",")).join(" ")}
                  fill="none"
                  stroke="#303840"
                  strokeWidth="10"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity=".99"
                />
              </g>:null}
              {showTrackIntel&&(!historicalEnvironment||!environmentContainsTrackIntel)&&Array.isArray(displayGeometry?.pit_lane_points)&&displayGeometry.pit_lane_points.length>1?<polyline
                points={displayGeometry.pit_lane_points.map((point)=>point.join(",")).join(" ")}
                fill="none"
                stroke={historicalEnvironment?(layout?.pit_lane_color||"#2563eb"):"#22c55e"}
                strokeWidth={historicalEnvironment?(fullTrackSceneActive?"1.8":"4.5"):"8"}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={historicalEnvironment?"12 8":"10 5"}
                opacity=".95"
              />:null}
              {showTrackIntel&&intelligence.pit_entry_progress!=null?(()=>{
                const line=trackMarkerSegment(displayGeometry,intelligence.pit_entry_progress,{length:28});
                return line?<g><line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={historicalEnvironment?(layout?.pit_lane_color||"#2563eb"):"#22c55e"} strokeWidth="3"/><text x={line.center.x} y={line.center.y-10} textAnchor="middle" fontSize="7" fontWeight="800" fill={historicalEnvironment?"#93c5fd":"#86efac"}>PIT IN</text></g>:null;
              })():null}
              {showTrackIntel&&intelligence.pit_exit_progress!=null?(()=>{
                const line=trackMarkerSegment(displayGeometry,intelligence.pit_exit_progress,{length:28});
                return line?<g><line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={historicalEnvironment?(layout?.pit_lane_color||"#2563eb"):"#22c55e"} strokeWidth="3"/><text x={line.center.x} y={line.center.y-10} textAnchor="middle" fontSize="7" fontWeight="800" fill={historicalEnvironment?"#93c5fd":"#86efac"}>PIT OUT</text></g>:null;
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
          <RaceCarsLayer
            geometry={displayGeometry}
            cars={raceCars}
            markerScale={markerScale}
            playbackRunning={playbackRunning}
            onSelectedPoint={followSelectedVisualPoint}
            lod={trackLod}
          />

        </svg>:null}
        <TrackMiniMap geometry={miniMapGeometry} rows={activeRows} teamBrands={teamBrands} year={year} currentControl={currentControl}/>

        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#05080d]/85 to-transparent"/>
        <div className="absolute right-3 top-3 z-30 flex flex-col items-end gap-1.5">
          {proceduralEnvironmentActive?<button
            type="button"
            title="T · Switch full 2D / schematic view"
            onClick={()=>{setTrackRenderMode((mode)=>mode==="full"?"schematic":"full");resetTrackCamera();}}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-[#0a0f16]/90 px-2.5 py-1.5 text-[9px] font-semibold text-slate-300 shadow-lg backdrop-blur hover:bg-white/[0.10]"
          ><MapIcon className="h-3.5 w-3.5"/>{trackRenderMode==="full"?"2D Scene":"Schematic"} · T</button>:null}
          <button
            type="button"
            onClick={()=>setShowTrackIntel((value)=>!value)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[9px] font-semibold shadow-lg backdrop-blur ${showTrackIntel?"border-sky-400/30 bg-sky-500/15 text-sky-200":"border-white/15 bg-[#0a0f16]/90 text-slate-400 hover:bg-white/[0.10]"}`}
          ><Flag className="h-3.5 w-3.5"/>Track intel</button>
          {cameraMode==="follow"?<>
            <div className="flex items-center overflow-hidden rounded-md border border-white/15 bg-[#0a0f16]/90 shadow-lg backdrop-blur">
              <button
                type="button"
                title="Zoom out"
                onClick={()=>setFollowZoom((value)=>Number(trackFollowZoomFromWheel(value,1,{min:1.35,max:12,step:1.16}).toFixed(3)))}
                className="inline-flex h-7 w-7 items-center justify-center text-slate-300 hover:bg-white/[0.10]"
              ><Minus className="h-3.5 w-3.5"/></button>
              <span className="min-w-[54px] border-x border-white/10 px-1.5 text-center text-[9px] font-bold text-slate-300">{followZoom.toFixed(2)}× · {trackLod==="close"?"C":trackLod==="medium"?"M":"O"}</span>
              <button
                type="button"
                title="Zoom in"
                onClick={()=>setFollowZoom((value)=>Number(trackFollowZoomFromWheel(value,-1,{min:1.35,max:12,step:1.16}).toFixed(3)))}
                className="inline-flex h-7 w-7 items-center justify-center text-slate-300 hover:bg-white/[0.10]"
              ><Plus className="h-3.5 w-3.5"/></button>
            </div>
            <button
              type="button"
              onClick={resetTrackCamera}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-[#0a0f16]/90 px-2.5 py-1.5 text-[9px] font-semibold text-slate-300 shadow-lg backdrop-blur hover:bg-white/[0.10]"
            ><Minimize2 className="h-3.5 w-3.5"/>Full track</button>
          </>:cameraMode==="free"?<>
            <div className="rounded-md border border-white/15 bg-[#0a0f16]/90 px-2.5 py-1.5 text-[9px] font-semibold text-slate-300 shadow-lg backdrop-blur">Wheel zoom · drag pan</div>
            <button
              type="button"
              onClick={resetTrackCamera}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-[#0a0f16]/90 px-2.5 py-1.5 text-[9px] font-semibold text-slate-300 shadow-lg backdrop-blur hover:bg-white/[0.10]"
            ><Minimize2 className="h-3.5 w-3.5"/>Full track</button>
          </>:null}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#05080d]/75 to-transparent"/>

        {!geometry?<div className="absolute bottom-3 right-3 rounded bg-black/70 px-2 py-1 text-[10px] text-slate-400">Static layout only · centerline pending</div>:null}
      </div>

      <aside className="order-2 flex min-h-0 flex-col border-t border-white/10 bg-[#070a0f] xl:order-1 xl:border-r xl:border-t-0">
        <div className="border-b border-white/10 bg-[#0a0e14] px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[17px] font-black italic tracking-[-0.04em] text-slate-100">
              <span className="mr-1 rounded-sm bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-950">F1</span>
              RACE
            </div>
            <div className="text-[8px] font-bold uppercase tracking-[0.14em] text-sky-300">{playbackRunning?`${playbackSpeed}× LIVE`:"PAUSED"}</div>
          </div>
          <div className="mt-1 text-[12px] font-black tracking-wide text-slate-100">LAP {Number(currentLap)||0}<span className="font-semibold text-slate-500">/{Number(totalLaps)||0}</span></div>
          <div className="mt-0.5 text-[8px] uppercase tracking-[0.12em] text-slate-600">Sector {Math.max(1,Number(currentSector)||1)} · Gap to leader / interval</div>
        </div>

        <div className="grid grid-cols-[34px_22px_42px_minmax(56px,1fr)_24px_52px_34px] items-center gap-1 border-b border-white/10 bg-[#0b1017] px-1.5 py-1 text-[8px] font-bold uppercase tracking-[0.10em] text-slate-600">
          <span className="text-right">Pos</span><span/><span>Drv</span><span className="text-right">Leader</span><span className="text-center">Tyre</span><span className="text-right">Int.</span><span className="text-right">Gain</span>
        </div>

        <div className="grid min-h-0 flex-1 p-0.5" style={{gridTemplateRows:`repeat(${Math.max(1,activeRows.length)},minmax(0,1fr))`}}>
          {activeRows.map((row,index)=>{
            const did=String(row?.driver_id||"");
            const tid=String(row?.team_id||"");
            const mine=tid===String(playerTeamId||"");
            const selected=did===resolvedSelectedId;
            const palette=markerPalette(teamBrands,tid,year);
            const positionDelta=Number(row?.visual_position_delta)||0;
            const gridPosition=Number(row?.grid_position);
            const livePosition=Number(row?.position??index+1);
            const gridGain=Number.isFinite(gridPosition)&&Number.isFinite(livePosition)
              ?gridPosition-livePosition
              :null;
            return <button
              type="button"
              key={did||index}
              onClick={()=>selectDriver(did)}
              className={`min-h-0 grid w-full grid-cols-[34px_22px_42px_minmax(56px,1fr)_24px_52px_34px] items-center gap-1 border-l-[3px] px-1 py-0 text-left transition ${selected?"bg-white/[0.13]":"hover:bg-white/[0.055]"}`}
              style={{borderLeftColor:row?.retired?"#7f1d1d":palette.primary}}
            >
              <span className="flex items-center justify-end gap-0.5 text-right text-[10px] font-black italic leading-none text-slate-100">
                {positionDelta>0?<ChevronUp className="h-3 w-3 shrink-0 text-emerald-300" aria-label="Position gained"/>:positionDelta<0?<ChevronDown className="h-3 w-3 shrink-0 text-red-300" aria-label="Position lost"/>:null}
                <span>{row?.position??index+1}</span>
              </span>
              <span className="flex items-center justify-center"><TeamLogo teamId={tid} name={teamName(teams,tid)} size="h-3.5 w-3.5" className="p-0"/></span>
              <span className={`truncate text-[10px] font-black leading-none tracking-[0.04em] ${mine?"text-amber-200":"text-slate-100"}`}>{shortDriverName(drivers,did)}</span>
              <span className={`text-right font-mono text-[9px] ${row?.retired?"text-red-300":index===0?"font-bold text-slate-100":"text-slate-300"}`}>
                {row?.retired?"DNF":index===0?"LEAD":formatInterval(row?.gap_to_leader_ms)}
              </span>
              <span className="flex justify-center"><MiniTyreIcon compound={row?.tyre?.compound} size={12}/></span>
              <span className={`text-right font-mono text-[9px] ${row?.retired?"text-red-300":index===0?"text-slate-600":"text-sky-300"}`}>
                {row?.retired?"DNF":index===0?"LEAD":formatInterval(row?.interval_ms??row?.gap_to_previous_ms)}
              </span>
              <span className={`text-right font-mono text-[9px] font-bold ${row?.retired||gridGain==null?"text-slate-600":gridGain>0?"text-emerald-300":gridGain<0?"text-red-300":"text-slate-500"}`}>
                {row?.retired||gridGain==null?"—":gridGain>0?`+${gridGain}`:String(gridGain)}
              </span>
            </button>;
          })}
          {!activeRows.length?<div className="px-2 py-6 text-center text-xs text-slate-600">Cars are forming on the grid.</div>:null}
        </div>
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
          {selectedRow?<div className="rounded border border-white/10 bg-white/[0.035] px-2 py-1.5">
            <div className="truncate text-[9px] font-bold text-slate-200">{driverName(drivers,selectedRow.driver_id)}</div>
            <div className="mt-0.5 flex justify-between text-[8px] text-slate-500"><span>P{selectedRow.position??"—"}</span><span>{selectedRow?.retired?"DNF":Number(selectedRow.position)===1?"LEAD":formatInterval(selectedRow?.gap_to_leader_ms)}</span></div>
            <div className="mt-1 flex items-center gap-1"><MiniTyreIcon compound={selectedRow?.tyre?.compound} size={15}/><span className="text-[8px] text-slate-400">{selectedRow?.tyre?.compound||"—"} · {Number.isFinite(Number(selectedRow?.tyre?.condition))?Number(selectedRow.tyre.condition).toFixed(0)+"%":"—"}</span></div>
            <div className="mt-1 grid grid-cols-2 gap-1 border-t border-white/5 pt-1 text-[8px]">
              <div className="rounded bg-black/20 px-1.5 py-1"><span className="text-slate-600">Ahead</span><div className="font-mono font-bold text-sky-300">{selectedRow?.retired?"—":selectedIndex===0?"LEAD":Number.isFinite(selectedAheadGapMs)?formatInterval(selectedAheadGapMs):"—"}</div></div>
              <div className="rounded bg-black/20 px-1.5 py-1"><span className="text-slate-600">Behind</span><div className="font-mono font-bold text-slate-300">{selectedRow?.retired?"—":Number.isFinite(selectedBehindGapMs)?formatInterval(selectedBehindGapMs):"—"}</div></div>
            </div>
          </div>:null}
        </div>
      </aside>
    </div>
  </section>;
}
