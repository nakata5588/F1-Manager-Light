import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  orientTrackGeometry,
  pointAtTrackProgress,
  resolveTrackLayout,
  trackGeometryViewBox,
} from "../../domain/trackLayout.js";
import { canonicalRaceViewCars, canonicalRaceViewSummary } from "../../race2/view/CanonicalRaceViewModel.js";
import {
  interpolateRaceViewCars,
  raceViewInterpolationAlpha,
  raceViewInterpolationDurationMs,
} from "../../race2/view/RaceViewInterpolation.js";

function scalar(value){
  if(value&&typeof value==="object"&&Object.hasOwn(value,"result"))return value.result;
  return value;
}

function driverId(row){return String(scalar(row?.driver_id??row?.id)??"");}
function teamId(row){return String(scalar(row?.team_id??row?.id)??"");}

function driverName(drivers,id){
  const row=(drivers||[]).find((driver)=>driverId(driver)===String(id));
  return row?.display_name||row?.name||`${row?.first_name??""} ${row?.last_name??""}`.trim()||String(id||"—");
}

function shortName(drivers,id){
  const name=driverName(drivers,id).trim();
  const parts=name.split(/\s+/).filter(Boolean);
  return (parts.at(-1)||name||"?").slice(0,3).toUpperCase();
}

function teamName(teams,id){
  const row=(teams||[]).find((team)=>teamId(team)===String(id));
  return row?.team_name||row?.name||String(id||"—");
}

function hashColor(value){
  const palette=["#ef4444","#3b82f6","#22c55e","#f59e0b","#a855f7","#06b6d4","#f97316","#ec4899","#84cc16","#8b5cf6"];
  let hash=0;
  for(const char of String(value||""))hash=(hash*31+char.charCodeAt(0))>>>0;
  return palette[hash%palette.length];
}

function teamColor(teamBrands,teamIdValue,year){
  const id=String(teamIdValue||"");
  const rows=(teamBrands||[]).filter((row)=>String(scalar(row?.team_id??row?.id)??"")===id);
  if(rows.length){
    const target=Number(year);
    const exact=rows.find((row)=>Number(row?.year)===target);
    const past=rows
      .filter((row)=>Number.isFinite(Number(row?.year))&&Number(row.year)<=target)
      .sort((a,b)=>Number(b.year)-Number(a.year))[0];
    const brand=exact||past||rows[0];
    return brand?.primary_color||brand?.primary||brand?.color||hashColor(id);
  }
  return hashColor(id);
}

function formatGap(ms,{leader=false}={}){
  if(leader)return "LEAD";
  const n=Number(ms);
  if(!Number.isFinite(n)||n<0)return "—";
  return `+${(n/1000).toFixed(3)}`;
}

function formatSpeed(value){
  const n=Number(value);
  return Number.isFinite(n)?`${Math.round(n)} km/h`:"—";
}

function trackPathLength(points=[]){
  if(!Array.isArray(points)||points.length<2)return 0;
  let total=0;
  for(let i=0;i<points.length;i+=1){
    const a=points[i];
    const b=points[(i+1)%points.length];
    total+=Math.hypot(Number(b?.[0]||0)-Number(a?.[0]||0),Number(b?.[1]||0)-Number(a?.[1]||0));
  }
  return total;
}

function carPose(geometry,progress,lateralOffsetM,unitsPerMeter){
  const center=pointAtTrackProgress(geometry,progress);
  if(!center)return null;
  const before=pointAtTrackProgress(geometry,progress-0.0025);
  const after=pointAtTrackProgress(geometry,progress+0.0025);
  if(!before||!after)return {...center,heading:0};
  const dx=after.x-before.x;
  const dy=after.y-before.y;
  const length=Math.hypot(dx,dy)||1;
  const heading=Math.atan2(dy,dx)*180/Math.PI;
  const lateral=Number(lateralOffsetM||0)*Number(unitsPerMeter||0);
  return {
    x:center.x+(-dy/length)*lateral,
    y:center.y+(dx/length)*lateral,
    heading,
  };
}

function controlTone(control){
  const key=String(control||"GREEN").toUpperCase();
  if(key==="RED_FLAG")return "border-red-400/30 bg-red-500/10 text-red-200";
  if(key.includes("YELLOW")||key.includes("SAFETY")||key==="VSC")return "border-amber-400/30 bg-amber-500/10 text-amber-200";
  return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
}

function useCanonicalRaceViewMotion(canonicalCars,{
  trackLengthM,
  canonicalTick,
  canonicalTimeMs,
  playbackRunning,
  playbackSpeed,
}){
  const [visualCars,setVisualCars]=useState(canonicalCars);
  const visualCarsRef=useRef(canonicalCars);
  const previousTickRef=useRef(canonicalTick);
  const previousCanonicalTimeRef=useRef(canonicalTimeMs);
  const frameRef=useRef(null);

  useEffect(()=>{
    if(frameRef.current!=null){
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current=null;
    }

    const target=canonicalCars;
    const previousTick=previousTickRef.current;
    const previousCanonicalTime=previousCanonicalTimeRef.current;
    previousTickRef.current=canonicalTick;
    previousCanonicalTimeRef.current=canonicalTimeMs;

    const reset=(
      !playbackRunning||
      previousTick==null||
      canonicalTick<=previousTick||
      !visualCarsRef.current?.length
    );
    if(reset){
      visualCarsRef.current=target;
      setVisualCars(target);
      return undefined;
    }

    const durationMs=raceViewInterpolationDurationMs(
      previousCanonicalTime,
      canonicalTimeMs,
      playbackSpeed
    );
    if(durationMs<=0){
      visualCarsRef.current=target;
      setVisualCars(target);
      return undefined;
    }

    const from=visualCarsRef.current;
    const startedAtMs=performance.now();
    let cancelled=false;

    const animate=(timestampMs)=>{
      if(cancelled)return;
      const alpha=raceViewInterpolationAlpha(startedAtMs,durationMs,timestampMs);
      const next=interpolateRaceViewCars(from,target,{
        alpha,
        trackLengthM,
      });
      visualCarsRef.current=next;
      setVisualCars(next);
      if(alpha<1){
        frameRef.current=window.requestAnimationFrame(animate);
      }else{
        frameRef.current=null;
      }
    };

    frameRef.current=window.requestAnimationFrame(animate);
    return ()=>{
      cancelled=true;
      if(frameRef.current!=null){
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current=null;
      }
    };
  },[
    canonicalTick,
    canonicalTimeMs,
    playbackRunning,
    playbackSpeed,
    trackLengthM,
    canonicalCars,
  ]);

  return visualCars;
}

function CanonicalCar({car,geometry,unitsPerMeter,color,label,selected,onSelect,scale=1,retired=false}){
  const pose=carPose(geometry,car.track_progress,car.lateral_offset_m,unitsPerMeter);
  if(!pose)return null;
  const length=14*scale;
  const width=7*scale;
  return <g
    role="button"
    tabIndex="0"
    aria-label={label}
    transform={`translate(${pose.x} ${pose.y}) rotate(${pose.heading})`}
    onClick={onSelect}
    onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelect?.();}}}
    style={{cursor:"pointer",opacity:retired?0.62:1}}
  >
    <title>{label}</title>
    {selected?<circle cx="0" cy="0" r={12*scale} fill="none" stroke="#fff" strokeWidth={1.7*scale} opacity=".9"/>:null}
    <rect x={-length*.48} y={-width*.50} width={length*.78} height={width} rx={2.2*scale} fill={color} stroke="#020617" strokeWidth={1.2*scale}/>
    <path d={`M ${length*.30} 0 L ${length*.05} ${-width*.42} L ${length*.05} ${width*.42} Z`} fill={color} stroke="#020617" strokeWidth={1*scale}/>
    <line x1={-length*.38} y1={-width*.72} x2={-length*.38} y2={width*.72} stroke="#111827" strokeWidth={2*scale}/>
    <text x="0" y={-width*.95} transform={`rotate(${-pose.heading})`} textAnchor="middle" fontSize={5.5*scale} fontWeight="900" fill="#fff" stroke="#020617" strokeWidth=".7" paintOrder="stroke">{label}</text>
  </g>;
}

export default function CanonicalRaceView({
  view,
  trackId,
  year,
  drivers=[],
  teams=[],
  teamBrands=[],
  playerTeamId="",
  selectedDriverId="",
  onSelectDriver,
  playbackRunning=false,
  playbackSpeed=1,
}){
  const summary=useMemo(()=>canonicalRaceViewSummary(view),[view]);
  const cars=useMemo(()=>canonicalRaceViewCars(view),[view]);
  const trackLengthM=Math.max(1,Number(view?.track_length_m)||1);
  const visualCars=useCanonicalRaceViewMotion(cars,{
    trackLengthM,
    canonicalTick:summary.canonical_tick,
    canonicalTimeMs:summary.canonical_time_ms,
    playbackRunning,
    playbackSpeed,
  });
  const resolved=useMemo(()=>resolveTrackLayout({trackId,year}),[trackId,year]);
  const geometry=useMemo(()=>orientTrackGeometry(resolved?.geometry||null),[resolved?.geometry]);
  const viewBox=useMemo(()=>trackGeometryViewBox(geometry,{paddingRatio:.10,minPadding:28}),[geometry]);
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  const closedPoints=points.length?[...points,points[0]]:[];
  const polyline=closedPoints.map((point)=>point.join(",")).join(" ");
  const unitsPerMeter=trackPathLength(points)/trackLengthM;
  const markerScale=Math.max(.65,Math.min(1.35,Number(viewBox?.[2]||1000)/900));
  const selected=cars.find((car)=>String(car.driver_id)===String(selectedDriverId||""))||null;

  return <div className="grid overflow-hidden rounded-lg border border-white/10 bg-[#080d13] lg:grid-cols-[minmax(0,1fr)_290px]">
    <div className="relative min-h-[430px] overflow-hidden bg-[#101923]">
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <span className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-200">Canonical Race View</span>
        <span className={"rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] "+controlTone(summary.control)}>{summary.control.replaceAll("_"," ")}</span>
        <span className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[9px] font-semibold text-slate-300">Lap {summary.lap}/{summary.total_laps??"—"}</span>
        <span className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[9px] font-semibold text-slate-400">{playbackRunning?`${playbackSpeed}× live`:"paused"}</span>
      </div>

      {points.length>1?<svg
        className="h-[430px] w-full md:h-[540px]"
        viewBox={viewBox.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Canonical race track"
      >
        <defs>
          <linearGradient id="rw9-asphalt" x1="0" x2="1">
            <stop offset="0%" stopColor="#2d333b"/>
            <stop offset="50%" stopColor="#151a20"/>
            <stop offset="100%" stopColor="#30363d"/>
          </linearGradient>
        </defs>
        <rect x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]} fill="#26371f"/>
        <polyline points={polyline} fill="none" stroke="#111827" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" opacity=".65"/>
        <polyline points={polyline} fill="none" stroke="#d1d5db" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points={polyline} fill="none" stroke="url(#rw9-asphalt)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points={polyline} fill="none" stroke="#f8fafc" strokeWidth=".65" strokeDasharray="2 13" opacity=".18"/>
        {visualCars.filter((car)=>!car.retired||car.retirement_trackside?.visible!==false).map((car)=>{
          const color=teamColor(teamBrands,car.team_id,year);
          const label=shortName(drivers,car.driver_id);
          const title=`P${car.position} · ${driverName(drivers,car.driver_id)} · ${teamName(teams,car.team_id)} · ${formatSpeed(car.speed_kmh)}`;
          return <CanonicalCar
            key={car.id}
            car={car}
            geometry={geometry}
            unitsPerMeter={unitsPerMeter}
            color={color}
            label={label}
            selected={String(car.driver_id)===String(selectedDriverId||"")}
            playbackRunning={playbackRunning}
            onSelect={()=>onSelectDriver?.(String(car.driver_id||""))}
            scale={markerScale}
            retired={car.retired}
          />;
        })}
      </svg>:<div className="flex h-[430px] items-center justify-center text-sm text-slate-500">Track geometry unavailable.</div>}

      <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-white/10 bg-black/45 px-2.5 py-1.5 text-[9px] text-slate-400">
        Tick {summary.canonical_tick} · {(summary.canonical_time_ms/1000).toFixed(1)}s · {summary.weather.replaceAll("_"," ")}
      </div>
    </div>

    <aside className="border-t border-white/10 bg-[#0b1017] lg:border-l lg:border-t-0">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Official classification</div>
        <div className="mt-0.5 text-[10px] text-slate-600">Read directly from canonical RaceState</div>
      </div>
      <div className="max-h-[470px] overflow-y-auto">
        {cars.map((car,index)=>{
          const mine=String(car.team_id)===String(playerTeamId||"");
          const active=String(car.driver_id)===String(selectedDriverId||"");
          return <button
            type="button"
            key={car.id}
            onClick={()=>onSelectDriver?.(String(car.driver_id||""))}
            className={"grid w-full grid-cols-[30px_minmax(0,1fr)_72px] items-center gap-2 border-b border-white/[0.055] px-2.5 py-2 text-left transition "+(active?"bg-white/[0.09]":mine?"bg-cyan-500/[0.045] hover:bg-white/[0.06]":"hover:bg-white/[0.045]")}
          >
            <span className="text-right text-xs font-black text-slate-100">{car.position}</span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-slate-200">{driverName(drivers,car.driver_id)}</span>
              <span className="block truncate text-[9px] text-slate-500">{car.retired?car.status:`${formatSpeed(car.speed_kmh)} · ${car.tyre?.compound||"—"} ${Number.isFinite(Number(car.tyre?.condition))?Math.round(Number(car.tyre.condition))+"%":""}`}</span>
            </span>
            <span className="text-right text-[10px] font-mono text-slate-400">{formatGap(car.gap_to_leader_ms,{leader:index===0})}</span>
          </button>;
        })}
      </div>
      {selected?<div className="border-t border-white/10 p-3">
        <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">Selected car</div>
        <div className="mt-1 text-sm font-semibold text-slate-100">{driverName(drivers,selected.driver_id)}</div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px]">
          <div className="rounded bg-white/[0.04] px-2 py-1.5 text-slate-400">Speed <span className="float-right font-semibold text-slate-200">{formatSpeed(selected.speed_kmh)}</span></div>
          <div className="rounded bg-white/[0.04] px-2 py-1.5 text-slate-400">Pace <span className="float-right font-semibold text-slate-200">{String(selected.current_pace||"—")}</span></div>
          <div className="rounded bg-white/[0.04] px-2 py-1.5 text-slate-400">Tyre <span className="float-right font-semibold text-slate-200">{selected.tyre?.compound||"—"}</span></div>
          <div className="rounded bg-white/[0.04] px-2 py-1.5 text-slate-400">Fuel <span className="float-right font-semibold text-slate-200">{Number.isFinite(Number(selected.fuel_kg))?Number(selected.fuel_kg).toFixed(1)+" kg":"—"}</span></div>
        </div>
      </div>:null}
    </aside>
  </div>;
}
