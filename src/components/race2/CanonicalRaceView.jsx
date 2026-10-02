import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  orientTrackGeometry,
  pointAtTrackProgress,
  resolveTrackLayout,
  trackGeometryViewBox,
  trackIntelligenceProfile,
  trackPresentationGeometry,
} from "../../domain/trackLayout.js";
import {
  buildPitLanePresentationGeometry,
  openPolylineHeadingDegrees,
  sampleOpenPolylinePoint,
  simplifyTrackPresentationGeometry,
} from "../../domain/trackSceneGeometry.js";
import { pitBoxMixForPhase, pitLaneMixForPhase, pitLaneProgressForPhase } from "../../domain/racePitModel.js";
import { TeamLogo } from "../entity/EntityVisuals.jsx";
import RaceCarVisual from "../race/RaceCarVisual.jsx";
import TrackSceneRenderer from "../race/TrackSceneRenderer.jsx";
import {
  followTrackViewBox,
  trackLodForZoom,
  trackMarkerScaleForViewBox,
} from "../../domain/trackCamera.js";
import { historicalRaceCarLivery } from "../../domain/raceCarLiveries.js";
import { canonicalRaceViewCars, canonicalRaceViewSummary } from "../../race2/view/CanonicalRaceViewModel.js";
import {
  interpolateRaceViewCars,
  raceViewInterpolationAlpha,
  raceViewInterpolationDurationMs,
} from "../../race2/view/RaceViewInterpolation.js";
import {
  clampRaceViewZoom,
  raceViewBoxCenter,
  raceViewCameraViewBox,
  raceViewPitBoxProgress,
  raceViewWeatherVisuals,
} from "../../race2/view/RaceViewPresentation.js";

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

function driverNumber(drivers,id){
  const row=(drivers||[]).find((driver)=>driverId(driver)===String(id));
  return row?.race_number??row?.driver_number??row?.number??null;
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

function teamVisualPalette(teamBrands,teamIdValue,year,name=""){
  const id=String(teamIdValue||"");
  const rows=(teamBrands||[]).filter((row)=>String(scalar(row?.team_id??row?.id)??"")===id);
  const target=Number(year);
  const brand=rows.find((row)=>Number(row?.year)===target)
    ||rows
      .filter((row)=>Number.isFinite(Number(row?.year))&&Number(row.year)<=target)
      .sort((a,b)=>Number(b.year)-Number(a.year))[0]
    ||rows[0]
    ||{};
  const historical=historicalRaceCarLivery({
    year,
    teamId:id,
    teamName:name||brand?.team_name||brand?.team_official_name,
  });
  return {
    primary:historical?.primary||brand?.primary_color||brand?.primary||brand?.color||hashColor(id),
    secondary:historical?.secondary||brand?.secondary_color||"#e2e8f0",
    accent:historical?.accent||brand?.accent_color||brand?.secondary_color||"#cbd5e1",
    sponsor:historical?.sponsor||brand?.short_name||null,
    pattern:historical?.pattern||null,
    model:historical?.model||null,
  };
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

function positionDelta(value){
  const n=Number(value)||0;
  if(n>0)return {label:`▲${n}`,tone:"text-emerald-300"};
  if(n<0)return {label:`▼${Math.abs(n)}`,tone:"text-rose-300"};
  return {label:"—",tone:"text-slate-600"};
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

function ControlTowerTyre({tyre}){
  const visual=tyreVisual(tyre?.compound);
  const condition=Number(tyre?.condition);
  return <span
    title={`${tyre?.compound||"Tyre"}${Number.isFinite(condition)?` · ${Math.round(condition)}%`:""}`}
    className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#05070b]"
    style={{border:`2px solid ${visual.ring}`}}
  >
    <span className="text-[7px] font-black leading-none" style={{color:visual.ring}}>{visual.label}</span>
  </span>;
}

function damageLabel(car){
  const state=car?.damage_state||{};
  const pct=Number(state?.overall_damage_pct);
  if(!car?.damaged_components?.length&&!Number.isFinite(pct))return null;
  return Number.isFinite(pct)
    ?`DMG ${Math.round(pct)}%`
    :"DMG";
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

function blendHeadingDegrees(from,to,mix){
  const delta=((Number(to)-Number(from)+540)%360)-180;
  return Number(from)+delta*Math.max(0,Math.min(1,Number(mix)||0));
}

function pitLanePose(geometry,progress,{lateralOffset=0,sideSign=1}={}){
  const points=Array.isArray(geometry?.pit_lane_points)?geometry.pit_lane_points:[];
  if(points.length<2||!Number.isFinite(Number(progress)))return null;
  const normalized=Math.max(0,Math.min(1,Number(progress)));
  const point=sampleOpenPolylinePoint(points,normalized);
  if(!point)return null;
  const heading=openPolylineHeadingDegrees(points,normalized)||0;
  const radians=heading*Math.PI/180;
  const normal={x:-Math.sin(radians),y:Math.cos(radians)};
  const offset=Number(lateralOffset)||0;
  const sign=Number(sideSign)<0?-1:1;
  return {
    x:point.x+normal.x*offset*sign,
    y:point.y+normal.y*offset*sign,
    heading,
  };
}

function pitBoxSideSign(geometry){
  const pit=pitLanePose(geometry,0.52);
  const trackPoints=Array.isArray(geometry?.points)?geometry.points:[];
  if(!pit||!trackPoints.length)return 1;
  let nearest=null;
  let nearestDistance=Infinity;
  for(const point of trackPoints){
    const x=Number(point?.[0]);
    const y=Number(point?.[1]);
    if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    const distance=Math.hypot(pit.x-x,pit.y-y);
    if(distance<nearestDistance){
      nearestDistance=distance;
      nearest={x,y};
    }
  }
  if(!nearest)return 1;
  const radians=pit.heading*Math.PI/180;
  const normal={x:-Math.sin(radians),y:Math.cos(radians)};
  const away={x:pit.x-nearest.x,y:pit.y-nearest.y};
  return normal.x*away.x+normal.y*away.y>=0?1:-1;
}

function visualCarPose(car,geometry,unitsPerMeter,{pitBoxOffset=0,pitBoxSide=1}={}){
  const track=carPose(geometry,car?.track_progress,car?.lateral_offset_m,unitsPerMeter);
  if(!track)return null;
  const pitProgress=Number(car?.pit_lane_progress);
  const pitMix=Math.max(0,Math.min(1,Number(car?.pit_lane_mix)||0));
  if(!Number.isFinite(pitProgress)||pitMix<=0)return track;
  const boxMix=Math.max(0,Math.min(1,Number(car?.pit_box_mix)||0));
  const pit=pitLanePose(geometry,pitProgress,{
    lateralOffset:pitBoxOffset*boxMix,
    sideSign:pitBoxSide,
  });
  if(!pit)return track;
  return {
    x:track.x+(pit.x-track.x)*pitMix,
    y:track.y+(pit.y-track.y)*pitMix,
    heading:blendHeadingDegrees(track.heading,pit.heading,pitMix),
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
  ]);

  return visualCars;
}

function CanonicalCar({
  car,geometry,unitsPerMeter,palette,label,selected,onSelect,onFollow,
  scale=1,retired=false,year,driverNumberValue=null,pitBoxOffset=0,pitBoxSide=1,
  lod="overview",showLabel=false,
}){
  const pose=visualCarPose(car,geometry,unitsPerMeter,{pitBoxOffset,pitBoxSide});
  if(!pose)return null;
  const spriteScale=(lod==="close"?.68:lod==="medium"?.58:.48)*scale;
  const haloRadius=(lod==="close"?10.5:12.5)*scale;
  return <g
    role="button"
    tabIndex="0"
    aria-label={label}
    transform={`translate(${pose.x} ${pose.y}) rotate(${pose.heading})`}
    onClick={onSelect}
    onDoubleClick={(event)=>{event.preventDefault();event.stopPropagation();onFollow?.();}}
    onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelect?.();}}}
    style={{cursor:"pointer",opacity:retired?0.72:1}}
  >
    <title>{label}</title>
    {selected?<circle cx="0" cy="0" r={haloRadius} fill="none" stroke="#f8fafc" strokeWidth={1.15*scale} opacity=".82"/>:null}
    <g transform={`scale(${spriteScale})`}>
      <RaceCarVisual
        year={year}
        color={palette?.primary}
        secondary={palette?.secondary}
        accent={palette?.accent}
        selected={selected}
        retired={retired}
        lod={selected&&lod!=="overview"?"close":lod}
        damageState={car?.damage_state}
        driverNumber={driverNumberValue}
        sponsorLabel={palette?.sponsor}
        liveryPattern={palette?.pattern}
        historicalModel={palette?.model}
      />
    </g>
    {showLabel?<g transform={`translate(0 ${-9.2*scale}) rotate(${-pose.heading})`}>
      <rect x={-6.7*scale} y={-2.7*scale} width={13.4*scale} height={5.4*scale} rx={2.7*scale} fill="#03060a" stroke={selected?"#f8fafc":"#475569"} strokeWidth={.55*scale} opacity=".82"/>
      <text x="0" y={1.25*scale} textAnchor="middle" fontSize={4.1*scale} fontWeight="900" fill="#f8fafc">{label}</text>
    </g>:null}
  </g>;
}

function CanonicalSpray({car,geometry,unitsPerMeter,opacity=0,scale=1,pitBoxOffset=0,pitBoxSide=1}){
  if(opacity<=0||car?.retired)return null;
  const pose=visualCarPose(car,geometry,unitsPerMeter,{pitBoxOffset,pitBoxSide});
  if(!pose)return null;
  return <g
    pointerEvents="none"
    transform={`translate(${pose.x} ${pose.y}) rotate(${pose.heading})`}
    opacity={opacity}
  >
    <ellipse cx={-11*scale} cy="0" rx={13*scale} ry={4.2*scale} fill="#dbeafe" opacity=".24"/>
    <ellipse cx={-20*scale} cy="0" rx={18*scale} ry={6.2*scale} fill="#e0f2fe" opacity=".13"/>
  </g>;
}

function PitBoxMarker({geometry,progress,color,label,scale=1,active=false,sideSign=1}){
  const pose=pitLanePose(geometry,progress,{lateralOffset:10*scale,sideSign});
  if(!pose)return null;
  const width=(active?11:6.5)*scale;
  const height=(active?5.5:2.6)*scale;
  return <g
    pointerEvents="none"
    transform={`translate(${pose.x} ${pose.y}) rotate(${pose.heading})`}
    opacity={active?0.94:0.18}
  >
    <rect
      x={-width/2}
      y={-height/2}
      width={width}
      height={height}
      rx={1.1*scale}
      fill={active?"#070b10":"#111827"}
      stroke={color}
      strokeWidth={active?1.35*scale:.7*scale}
    />
    {active?<>
      <line x1={-4*scale} y1={-1.45*scale} x2={4*scale} y2={-1.45*scale} stroke={color} strokeWidth={.9*scale}/>
      <text x="0" y={1.7*scale} textAnchor="middle" fontSize={3.5*scale} fontWeight="900" fill="#f8fafc">{label}</text>
    </>:null}
  </g>;
}

function CanonicalMiniMap({
  geometry,
  viewBox,
  cars,
  unitsPerMeter,
  teamBrands,
  year,
  selectedDriverId,
  pitBoxOffset,
  pitBoxSide,
}){
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  if(points.length<2)return null;
  const polyline=[...points,points[0]].map((point)=>point.join(",")).join(" ");
  const pitPoints=Array.isArray(geometry?.pit_lane_points)?geometry.pit_lane_points:[];
  const pitPolyline=pitPoints.map((point)=>point.join(",")).join(" ");
  return <div className="pointer-events-none absolute bottom-12 right-3 z-20 w-[210px] rounded-lg border border-white/15 bg-[#05080d]/88 p-2 shadow-xl backdrop-blur">
    <div className="mb-1 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">
      <span>Mini-map</span>
      <span>Full circuit</span>
    </div>
    <svg viewBox={viewBox.join(" ")} className="h-[118px] w-full" preserveAspectRatio="xMidYMid meet" aria-label="Race mini-map">
      <rect x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]} fill="#111923"/>
      <polyline points={polyline} fill="none" stroke="#475569" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={polyline} fill="none" stroke="#cbd5e1" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
      {pitPoints.length>1?<polyline points={pitPolyline} fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>:null}
      {cars.filter((car)=>!car.retired||car.retirement_trackside?.visible!==false||car.pit_box_parked).map((car)=>{
        const pose=visualCarPose(car,geometry,unitsPerMeter,{pitBoxOffset,pitBoxSide});
        if(!pose)return null;
        const selected=String(car.driver_id)===String(selectedDriverId||"");
        return <circle
          key={`mini_${car.id}`}
          cx={pose.x}
          cy={pose.y}
          r={selected?5.2:3.1}
          fill={teamColor(teamBrands,car.team_id,year)}
          stroke={selected?"#fff":"#020617"}
          strokeWidth={selected?2:1}
          opacity={car.retired?0.65:0.95}
        />;
      })}
    </svg>
  </div>;
}


const ControlTowerPanel=React.memo(function ControlTowerPanel({
  cars,
  playerTeamId,
  selectedDriverId,
  onSelectDriver,
  drivers,
  teams,
  summary,
}){
  return <aside className="pointer-events-auto absolute left-3 top-14 z-30 hidden w-[310px] overflow-hidden rounded-lg border border-white/15 bg-[#05080d]/90 shadow-2xl backdrop-blur-md lg:block">
    <div className="border-b border-white/10 bg-black/55 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-black uppercase italic tracking-[0.14em] text-slate-100">Race</div>
        <div className="font-mono text-[9px] font-bold text-slate-300">LAP {summary.lap}/{summary.total_laps??"—"}</div>
      </div>
      <div className="mt-1 text-[7px] font-bold uppercase tracking-[0.14em] text-slate-600">Official classification</div>
    </div>
    <div className="max-h-[570px] overflow-y-auto">
      {(cars||[]).map((car,index)=>{
        const mine=String(car.team_id)===String(playerTeamId||"");
        const active=String(car.driver_id)===String(selectedDriverId||"");
        const delta=positionDelta(car.position_change_last_lap);
        const damage=damageLabel(car);
        const pitActive=Boolean(car?.pit_state?.active);
        const clearedDnf=Boolean(car?.retired&&car?.retirement_trackside?.status==="cleared");
        const status=car.retired
          ?(clearedDnf?"DNF · BOX":"DNF")
          :pitActive
            ?"PIT"
            :damage;
        return <button
          type="button"
          key={car.id}
          onClick={()=>onSelectDriver?.(String(car.driver_id||""))}
          className={"grid w-full grid-cols-[22px_20px_26px_minmax(0,1fr)_58px_24px] items-center gap-1 border-b border-white/[0.05] px-2 py-[5px] text-left transition "+(
            active
              ?"bg-cyan-300/[0.14]"
              :mine
                ?"bg-cyan-400/[0.045] hover:bg-white/[0.055]"
                :"hover:bg-white/[0.045]"
          )}
        >
          <span className={`text-right text-[11px] font-black ${car.retired?"text-slate-500":"text-slate-100"}`}>{car.position}</span>
          <span className={`text-center text-[7px] font-black ${delta.tone}`}>{delta.label==="—"?"":delta.label.replace("▲","↑").replace("▼","↓")}</span>
          <span className="flex justify-center"><TeamLogo teamId={String(car.team_id||"")} name={teamName(teams,car.team_id)} size="h-4 w-4" className="shrink-0 p-0"/></span>
          <span className="min-w-0">
            <span className={`block truncate text-[10px] font-black uppercase tracking-[0.06em] ${car.retired?"text-slate-500":"text-slate-100"}`}>{shortName(drivers,car.driver_id)}</span>
            {status?<span className={`block truncate text-[6px] font-bold uppercase tracking-[0.08em] ${car.retired?"text-rose-300":pitActive?"text-sky-300":"text-amber-300"}`}>{status}</span>:null}
          </span>
          <span className={`text-right font-mono text-[9px] ${index===0?"font-black text-emerald-300":"text-slate-300"}`}>{formatGap(car.gap_to_leader_ms,{leader:index===0})}</span>
          <span className="flex justify-center"><ControlTowerTyre tyre={car.tyre}/></span>
        </button>;
      })}
    </div>
  </aside>;
});

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
  const teamIds=useMemo(()=>{
    const ids=[];
    for(const car of cars){
      const id=String(car?.team_id||"");
      if(id&&!ids.includes(id))ids.push(id);
    }
    return ids.sort((a,b)=>a.localeCompare(b));
  },[cars]);
  const motionTargets=useMemo(()=>cars.map((car)=>{
    const boxProgress=raceViewPitBoxProgress(teamIds,car?.team_id);
    const active=Boolean(car?.pit_state?.active);
    const retirementCleared=Boolean(
      car?.retired&&car?.retirement_trackside?.status==="cleared"
    );
    const completedPit=Boolean(car?.pit_state?.completed);
    return {
      ...car,
      pit_lane_active:active||retirementCleared,
      pit_lane_progress:retirementCleared
        ?boxProgress
        :active
          ?pitLaneProgressForPhase(car.pit_state,{boxProgress})
          :completedPit
            ?1
            :null,
      pit_lane_mix:retirementCleared
        ?1
        :active
          ?pitLaneMixForPhase(car.pit_state)
          :0,
      pit_box_mix:retirementCleared
        ?1
        :active
          ?pitBoxMixForPhase(car.pit_state)
          :0,
      pit_box_progress:boxProgress,
      pit_box_parked:retirementCleared,
    };
  }),[cars,teamIds]);
  const visualCars=useCanonicalRaceViewMotion(motionTargets,{
    trackLengthM,
    canonicalTick:summary.canonical_tick,
    canonicalTimeMs:summary.canonical_time_ms,
    playbackRunning,
    playbackSpeed,
  });
  const resolved=useMemo(()=>resolveTrackLayout({trackId,year}),[trackId,year]);
  const layout=resolved?.layout||null;
  const environment=resolved?.environment||null;
  const intelligence=useMemo(()=>trackIntelligenceProfile(layout),[layout]);
  const proceduralEnvironmentActive=Boolean(
    environment?.runtime_mode==="f1track_procedural"&&environment?.procedural_environment
  );
  const calibratedGeometry=useMemo(
    ()=>trackPresentationGeometry(resolved?.geometry||null,layout),
    [resolved?.geometry,layout]
  );
  const smoothedGeometry=useMemo(()=>{
    if(!proceduralEnvironmentActive)return calibratedGeometry;
    const style=environment?.race_view_style||{};
    return simplifyTrackPresentationGeometry(calibratedGeometry,{
      tolerance:Number(style.presentation_tolerance||1.25),
      pitTolerance:Number(style.pit_presentation_tolerance||.7),
    });
  },[calibratedGeometry,proceduralEnvironmentActive,environment?.race_view_style]);
  const baseGeometry=useMemo(
    ()=>proceduralEnvironmentActive?smoothedGeometry:orientTrackGeometry(smoothedGeometry),
    [smoothedGeometry,proceduralEnvironmentActive]
  );
  const geometry=useMemo(()=>{
    if(!proceduralEnvironmentActive)return baseGeometry;
    const style=environment?.race_view_style||{};
    return buildPitLanePresentationGeometry(baseGeometry,{
      entryProgress:intelligence?.pit_entry_progress,
      exitProgress:intelligence?.pit_exit_progress,
      separation:Number(style.pit_visual_separation||0),
      mergeFraction:Number(style.pit_merge_fraction||.14),
      samples:Number(style.pit_visual_samples||72),
      mergeSamples:Number(style.pit_merge_samples||12),
    });
  },[baseGeometry,proceduralEnvironmentActive,environment?.race_view_style,intelligence?.pit_entry_progress,intelligence?.pit_exit_progress]);
  const viewBox=useMemo(()=>trackGeometryViewBox(geometry,{paddingRatio:.055,minPadding:18}),[geometry]);
  const sceneViewBox=useMemo(()=>
    Array.isArray(environment?.view_box)&&environment.view_box.length===4
      ?environment.view_box.map(Number)
      :viewBox,
    [environment?.view_box,viewBox]
  );
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  const closedPoints=points.length?[...points,points[0]]:[];
  const polyline=closedPoints.map((point)=>point.join(",")).join(" ");
  const pitLaneAvailable=Boolean(view?.pit_lane?.available);
  const pitLanePoints=pitLaneAvailable&&Array.isArray(geometry?.pit_lane_points)
    ?geometry.pit_lane_points
    :[];
  const pitPolyline=pitLanePoints.map((point)=>point.join(",")).join(" ");
  const unitsPerMeter=trackPathLength(points)/trackLengthM;
  const pitBoxSide=useMemo(()=>pitBoxSideSign(geometry),[geometry]);
  const selectedVisual=visualCars.find((car)=>String(car.driver_id)===String(selectedDriverId||""))||null;
  const selectedVisualPose=selectedVisual
    ?visualCarPose(selectedVisual,geometry,unitsPerMeter,{pitBoxOffset,pitBoxSide})
    :null;
  const activePitTeamIds=new Set(
    visualCars
      .filter((car)=>car?.pit_lane_active&&!car?.retired)
      .map((car)=>String(car?.team_id||""))
  );
  const [cameraMode,setCameraMode]=useState("fit");
  const [cameraZoom,setCameraZoom]=useState(1);
  const [freeCenter,setFreeCenter]=useState(null);
  const svgRef=useRef(null);
  const dragRef=useRef(null);
  const baseCenter=useMemo(()=>raceViewBoxCenter(viewBox),[viewBox]);
  const followCenter=selectedVisualPose
    ?{x:selectedVisualPose.x,y:selectedVisualPose.y}
    :baseCenter;
  const cameraCenter=cameraMode==="follow"
    ?followCenter
    :(freeCenter||baseCenter);
  const cameraBox=cameraMode==="fit"
    ?viewBox
    :cameraMode==="follow"&&selectedVisualPose
      ?followTrackViewBox(viewBox,selectedVisualPose,{
        zoom:cameraZoom,
        minWidth:180,
        minHeight:135,
        lookAheadRatio:.16,
      })
      :raceViewCameraViewBox(viewBox,{zoom:cameraZoom,center:cameraCenter});
  const trackLod=trackLodForZoom(cameraMode==="fit"?1:cameraZoom);
  const markerScale=trackMarkerScaleForViewBox(cameraBox,viewBox,{power:.68,min:.28,max:1});
  const pitBoxOffset=10*markerScale;
  const weatherVisuals=useMemo(()=>raceViewWeatherVisuals(view?.track_state||{}),[view?.track_state]);
  const rainPct=Math.round(weatherVisuals.rain*100);
  const wetPct=Math.round(weatherVisuals.wet*100);
  const visibilityPct=Math.round(weatherVisuals.visibility*100);
  const sprayPct=Math.round(weatherVisuals.spray*100);

  const switchToFit=()=>{
    setCameraMode("fit");
    setCameraZoom(1);
    setFreeCenter(null);
  };
  const switchToFollow=()=>{
    if(!selectedVisualPose)return;
    setCameraMode("follow");
    setCameraZoom((current)=>Math.max(2.2,clampRaceViewZoom(current)));
  };
  const switchToFree=()=>{
    setFreeCenter(cameraCenter);
    setCameraMode("free");
    setCameraZoom((current)=>Math.max(1.15,clampRaceViewZoom(current)));
  };
  const onWheel=(event)=>{
    event.preventDefault();
    const factor=event.deltaY<0?1.18:(1/1.18);
    setCameraZoom((current)=>clampRaceViewZoom(current*factor));
    if(cameraMode==="fit"){
      setFreeCenter(baseCenter);
      setCameraMode("free");
    }
  };
  const onPointerDown=(event)=>{
    if(event.button!==0)return;
    const svg=svgRef.current;
    if(!svg)return;
    const rect=svg.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current={
      pointerId:event.pointerId,
      clientX:event.clientX,
      clientY:event.clientY,
      center:{...cameraCenter},
      unitsPerPixelX:cameraBox[2]/rect.width,
      unitsPerPixelY:cameraBox[3]/rect.height,
    };
    setFreeCenter({...cameraCenter});
    setCameraMode("free");
  };
  const onPointerMove=(event)=>{
    const drag=dragRef.current;
    if(!drag||drag.pointerId!==event.pointerId)return;
    setFreeCenter({
      x:drag.center.x-(event.clientX-drag.clientX)*drag.unitsPerPixelX,
      y:drag.center.y-(event.clientY-drag.clientY)*drag.unitsPerPixelY,
    });
  };
  const endPointerDrag=(event)=>{
    if(dragRef.current?.pointerId===event.pointerId)dragRef.current=null;
  };

  return <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#080d13]">
    <div className="relative min-h-[600px] overflow-hidden bg-[#101923]">
      <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
        <span className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-200">Canonical Race View</span>
        <span className={"rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] "+controlTone(summary.control)}>{summary.control.replaceAll("_"," ")}</span>
        <span className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[9px] font-semibold text-slate-300">Lap {summary.lap}/{summary.total_laps??"—"}</span>
        <span className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[9px] font-semibold text-slate-400">{playbackRunning?`${playbackSpeed}× live`:"paused"}</span>
        <span className="rounded border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[9px] font-semibold text-sky-100">Rain {rainPct}% · Wet {wetPct}% · Vis {visibilityPct}% · Spray {sprayPct}%</span>
      </div>
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-lg border border-white/10 bg-black/55 p-1 shadow-lg backdrop-blur">
        {["fit","follow","free"].map((mode)=><button
          key={mode}
          type="button"
          disabled={mode==="follow"&&!selectedVisual}
          onClick={()=>mode==="fit"?switchToFit():mode==="follow"?switchToFollow():switchToFree()}
          className={"rounded px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] transition "+(cameraMode===mode?"bg-cyan-400 text-slate-950":"text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35")}
        >{mode}</button>)}
        <span className="min-w-[40px] px-1 text-center text-[9px] font-mono text-slate-400">{cameraZoom.toFixed(1)}×</span>
      </div>

      {points.length>1?<svg
        ref={svgRef}
        className={"h-[600px] w-full select-none md:h-[720px] "+(cameraMode==="free"?"cursor-grab active:cursor-grabbing":"cursor-default")}
        viewBox={cameraBox.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Canonical race track"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointerDrag}
        onPointerCancel={endPointerDrag}
      >
        {proceduralEnvironmentActive?<TrackSceneRenderer
          geometry={geometry}
          environment={environment?.procedural_environment}
          style={environment?.race_view_style}
          viewBox={sceneViewBox}
          wetness={weatherVisuals.wet}
          lod={trackLod}
        />:<>
          <defs>
            <linearGradient id="rw15-asphalt" x1="0" x2="1">
              <stop offset="0%" stopColor="#3b4148"/>
              <stop offset="50%" stopColor="#20262d"/>
              <stop offset="100%" stopColor="#394049"/>
            </linearGradient>
          </defs>
          <rect x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]} fill="#354326"/>
          <polyline points={polyline} fill="none" stroke="#182018" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" opacity=".72"/>
          <polyline points={polyline} fill="none" stroke="#e5e7eb" strokeWidth="19" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points={polyline} fill="none" stroke="url(#rw15-asphalt)" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round"/>
        </>}
        {pitLanePoints.length>1?<g pointerEvents="none">
          {!proceduralEnvironmentActive?<>
            <polyline points={pitPolyline} fill="none" stroke="#111827" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" opacity=".72"/>
            <polyline points={pitPolyline} fill="none" stroke="#64748b" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={pitPolyline} fill="none" stroke="#cbd5e1" strokeWidth=".8" strokeDasharray="3 8" opacity=".45"/>
          </>:null}
          {teamIds.map((id,index)=>{
            const progress=raceViewPitBoxProgress(teamIds,id);
            const name=teamName(teams,id);
            return <PitBoxMarker
              key={`pit_box_${id}`}
              geometry={geometry}
              progress={progress}
              color={teamColor(teamBrands,id,year)}
              label={(name||String(index+1)).slice(0,3).toUpperCase()}
              scale={markerScale}
              active={activePitTeamIds.has(id)}
              sideSign={pitBoxSide}
            />;
          })}
        </g>:null}
        {!proceduralEnvironmentActive&&weatherVisuals.wetTrackOpacity>0?<polyline
          points={polyline}
          fill="none"
          stroke="#7dd3fc"
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={weatherVisuals.wetTrackOpacity*.45}
          pointerEvents="none"
        />:null}
        {visualCars.filter((car)=>
          !car.retired||
          car.retirement_trackside?.visible!==false||
          (car.pit_box_parked&&pitLanePoints.length>1)
        ).map((car)=><CanonicalSpray
          key={`spray_${car.id}`}
          car={car}
          geometry={geometry}
          unitsPerMeter={unitsPerMeter}
          opacity={cameraMode==="follow"&&weatherVisuals.spray>=0.65?Math.min(.12,weatherVisuals.sprayOpacity*.28):0}
          scale={markerScale}
          pitBoxOffset={pitBoxOffset}
          pitBoxSide={pitBoxSide}
        />)}
        {visualCars.filter((car)=>
          !car.retired||
          car.retirement_trackside?.visible!==false||
          (car.pit_box_parked&&pitLanePoints.length>1)
        ).map((car)=>{
          const teamLabel=teamName(teams,car.team_id);
          const palette=teamVisualPalette(teamBrands,car.team_id,year,teamLabel);
          const label=shortName(drivers,car.driver_id);
          const title=`P${car.position} · ${driverName(drivers,car.driver_id)} · ${teamLabel} · ${formatSpeed(car.speed_kmh)}`;
          return <CanonicalCar
            key={car.id}
            car={car}
            geometry={geometry}
            unitsPerMeter={unitsPerMeter}
            palette={palette}
            label={label}
            selected={String(car.driver_id)===String(selectedDriverId||"")}
            playbackRunning={playbackRunning}
            onSelect={()=>onSelectDriver?.(String(car.driver_id||""))}
            onFollow={()=>{
              onSelectDriver?.(String(car.driver_id||""));
              setCameraMode("follow");
              setCameraZoom((current)=>Math.max(2.2,clampRaceViewZoom(current)));
            }}
            scale={markerScale}
            lod={trackLod}
            showLabel={String(car.driver_id)===String(selectedDriverId||"")||(cameraMode==="fit"&&String(car.team_id)===String(playerTeamId||""))}
            retired={car.retired}
            year={year}
            driverNumberValue={driverNumber(drivers,car.driver_id)}
            pitBoxOffset={pitBoxOffset}
            pitBoxSide={pitBoxSide}
          />;
        })}
      </svg>:<div className="flex h-[600px] items-center justify-center text-sm text-slate-500 md:h-[720px]">Track geometry unavailable.</div>}
      <CanonicalMiniMap
        geometry={geometry}
        viewBox={viewBox}
        cars={visualCars}
        unitsPerMeter={unitsPerMeter}
        teamBrands={teamBrands}
        year={year}
        selectedDriverId={selectedDriverId}
        pitBoxOffset={pitBoxOffset}
        pitBoxSide={pitBoxSide}
      />
      {weatherVisuals.rainOpacity>0?<div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          opacity:weatherVisuals.rainOpacity*.32,
          backgroundImage:"linear-gradient(112deg, transparent 0 47%, rgba(186,230,253,.52) 48% 50%, transparent 51% 100%), linear-gradient(112deg, transparent 0 47%, rgba(224,242,254,.30) 48% 49%, transparent 50% 100%)",
          backgroundSize:"38px 112px, 61px 146px",
          backgroundPosition:"0 0, 13px 21px",
        }}
      />:null}
      {weatherVisuals.fogOpacity>0?<div
        className="pointer-events-none absolute inset-0 z-10 bg-slate-300"
        style={{opacity:weatherVisuals.fogOpacity*.48}}
      />:null}

      <ControlTowerPanel
        cars={cars}
        playerTeamId={playerTeamId}
        selectedDriverId={selectedDriverId}
        onSelectDriver={onSelectDriver}
        drivers={drivers}
        teams={teams}
        summary={summary}
      />

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded border border-white/10 bg-black/45 px-2.5 py-1.5 text-[9px] text-slate-400">
        Tick {summary.canonical_tick} · {(summary.canonical_time_ms/1000).toFixed(1)}s · {summary.weather.replaceAll("_"," ")}
      </div>
    </div>

  </div>;
}
