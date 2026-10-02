import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  orientTrackGeometry,
  pointAtTrackProgress,
  resolveTrackLayout,
  trackGeometryViewBox,
  trackPresentationSplineEligible,
  trackRuntimeGeometry,
} from "../../domain/trackLayout.js";
import {
  openPolylineHeadingDegrees,
  sampleOpenPolylinePoint,
} from "../../domain/trackSceneGeometry.js";
import { pitBoxMixForPhase, pitLaneMixForPhase, pitLaneProgressForPhase } from "../../domain/racePitModel.js";
import { TeamLogo } from "../entity/EntityVisuals.jsx";
import RaceCarVisual from "../race/RaceCarVisual.jsx";
import {
  RACE_VIEW_ASPHALT_WIDTH_SVG,
  RACE_VIEW_NOMINAL_TRACK_WIDTH_M,
  raceCarPresentationScale,
} from "../../domain/raceCarPresentation.js";
import { historicalRaceCarLivery } from "../../domain/raceCarLiveries.js";
import { canonicalRaceViewCars, canonicalRaceViewSummary } from "../../race2/view/CanonicalRaceViewModel.js";
import {
  interpolateRaceViewCars,
  raceViewInterpolationAlpha,
  raceViewInterpolationDurationMs,
  raceViewRetargetCanonicalDeltaMs,
  retimeRaceViewInterpolation,
} from "../../race2/view/RaceViewInterpolation.js";
import {
  buildClosedRacingLine,
  racingLineGeometry,
} from "../../domain/raceSplineV3.js";
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

function formatLapTime(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return "—";
  const minutes=Math.floor(n/60000);
  const seconds=(n-minutes*60000)/1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6,"0")}`;
}

function formatBattleDistance(value){
  const n=Number(value);
  return Number.isFinite(n)?`${n.toFixed(n<10?1:0)} m`:"—";
}

function formatBattleDuration(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?`${(n/1000).toFixed(1)} s`:"—";
}

function battleStateLabel(state){
  return {
    side_by_side:"SIDE BY SIDE",
    yielding:"CLEARING",
    slipstream:"TOW",
    pressure:"PRESSURE",
  }[String(state||"")]||String(state||"—").replaceAll("_"," ").toUpperCase();
}

function activeBattleContext(context){
  return ["side_by_side","yielding"].includes(String(context?.state||""));
}

function hasTelemetryNumber(value){
  return value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value));
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
    className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#05070b]"
    style={{border:`2px solid ${visual.ring}`}}
  >
    <span className="text-[6px] font-black leading-none" style={{color:visual.ring}}>{visual.label}</span>
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
  const interpolationRef=useRef(null);

  useEffect(()=>{
    if(frameRef.current!=null){
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current=null;
    }

    const target=canonicalCars;
    const previousTick=previousTickRef.current;
    const previousCanonicalTime=previousCanonicalTimeRef.current;
    const now=performance.now();
    let from=visualCarsRef.current;

    // Sample the exact current visual pose before retargeting. Do not also
    // carry the unfinished canonical duration: the sampled pose already
    // contains that lag. Carrying both caused a growing catch-up queue and
    // visible forward corrections, especially at 8x/16x and after slowing down.
    const interrupted=interpolationRef.current;
    if(playbackRunning&&interrupted){
      const sampled=retimeRaceViewInterpolation({
        startedAtMs:interrupted.startedAtMs,
        durationMs:interrupted.durationMs,
        canonicalDeltaMs:interrupted.canonicalDeltaMs,
        timestampMs:now,
        playbackSpeed,
      });
      if(sampled.alpha<1){
        from=interpolateRaceViewCars(interrupted.from,interrupted.target,{
          alpha:sampled.alpha,
          trackLengthM,
        });
        visualCarsRef.current=from;
      }
    }

    previousTickRef.current=canonicalTick;
    previousCanonicalTimeRef.current=canonicalTimeMs;

    const reset=(
      !playbackRunning||
      previousTick==null||
      canonicalTick<=previousTick||
      !from?.length
    );
    if(reset){
      interpolationRef.current=null;
      visualCarsRef.current=target;
      setVisualCars(target);
      return undefined;
    }

    const canonicalDeltaMs=raceViewRetargetCanonicalDeltaMs(
      0,
      previousCanonicalTime,
      canonicalTimeMs
    );
    const durationMs=raceViewInterpolationDurationMs(
      0,
      canonicalDeltaMs,
      playbackSpeed
    );
    if(durationMs<=0){
      interpolationRef.current=null;
      visualCarsRef.current=target;
      setVisualCars(target);
      return undefined;
    }

    interpolationRef.current={
      from,
      target,
      startedAtMs:now,
      durationMs,
      canonicalDeltaMs,
    };
    let cancelled=false;

    const animate=(timestampMs)=>{
      if(cancelled)return;
      const segment=interpolationRef.current;
      if(!segment){
        frameRef.current=null;
        return;
      }
      const alpha=raceViewInterpolationAlpha(
        segment.startedAtMs,
        segment.durationMs,
        timestampMs
      );
      const next=interpolateRaceViewCars(segment.from,segment.target,{
        alpha,
        trackLengthM,
      });
      visualCarsRef.current=next;
      setVisualCars(next);
      if(alpha<1){
        frameRef.current=window.requestAnimationFrame(animate);
      }else{
        interpolationRef.current=null;
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
    trackLengthM,
  ]);

  useEffect(()=>{
    if(!playbackRunning)return;
    const segment=interpolationRef.current;
    if(!segment)return;

    const now=performance.now();
    const retimed=retimeRaceViewInterpolation({
      startedAtMs:segment.startedAtMs,
      durationMs:segment.durationMs,
      canonicalDeltaMs:segment.canonicalDeltaMs,
      timestampMs:now,
      playbackSpeed,
    });
    if(retimed.alpha>=1||retimed.durationMs<=0)return;

    const current=interpolateRaceViewCars(segment.from,segment.target,{
      alpha:retimed.alpha,
      trackLengthM,
    });
    visualCarsRef.current=current;
    setVisualCars(current);
    interpolationRef.current={
      from:current,
      target:segment.target,
      startedAtMs:now,
      durationMs:retimed.durationMs,
      canonicalDeltaMs:retimed.remainingCanonicalMs,
    };
  },[playbackSpeed,playbackRunning,trackLengthM]);

  return visualCars;
}

function CanonicalCar({
  car,geometry,unitsPerMeter,palette,label,selected,onSelect,onFollow,
  scale=1,retired=false,year,driverNumberValue=null,pitBoxOffset=0,pitBoxSide=1,
  lod="overview",showLabel=false,trackWidthM=RACE_VIEW_NOMINAL_TRACK_WIDTH_M,
}){
  const pose=visualCarPose(car,geometry,unitsPerMeter,{pitBoxOffset,pitBoxSide});
  if(!pose)return null;
  const calibrated=raceCarPresentationScale({
    year,
    model:palette?.model,
    trackWidthM,
    asphaltWidthSvg:RACE_VIEW_ASPHALT_WIDTH_SVG,
  });
  const spriteScale=calibrated.scale;
  const haloRadius=Math.max(
    calibrated.targetWidthSvg*1.35,
    calibrated.targetLengthSvg*.62
  );
  const labelScale=Math.max(.5,Math.min(.78,Number(scale)||.65));
  const engagement=car?.battle_context||null;
  const battleActive=activeBattleContext(engagement);
  const towActive=String(engagement?.state||"")==="slipstream";
  const battleRole=String(engagement?.role||"").toLowerCase()==="attacker"?"ATT":"DEF";
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
    {battleActive?<circle cx="0" cy="0" r={haloRadius*1.28} fill="none" stroke="#fbbf24" strokeWidth={.85*scale} strokeDasharray={(2.2*scale)+" "+(1.7*scale)} opacity=".88"/>:null}
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
    {battleActive?<g transform={`translate(0 ${6.8*labelScale}) rotate(${-pose.heading})`}>
      <rect x={-3.6*labelScale} y={-1.8*labelScale} width={7.2*labelScale} height={3.6*labelScale} rx={1.8*labelScale} fill="#451a03" stroke="#fbbf24" strokeWidth={.45*labelScale} opacity=".90"/>
      <text x="0" y={.9*labelScale} textAnchor="middle" fontSize={2.6*labelScale} fontWeight="900" fill="#fde68a">{battleRole}</text>
    </g>:null}
    {towActive&&(selected||showLabel)?<g transform={`translate(0 ${6.8*labelScale}) rotate(${-pose.heading})`}>
      <rect x={-4.2*labelScale} y={-1.8*labelScale} width={8.4*labelScale} height={3.6*labelScale} rx={1.8*labelScale} fill="#082f49" stroke="#38bdf8" strokeWidth={.45*labelScale} opacity=".88"/>
      <text x="0" y={.9*labelScale} textAnchor="middle" fontSize={2.45*labelScale} fontWeight="900" fill="#bae6fd">TOW</text>
    </g>:null}
    {showLabel?<g transform={`translate(0 ${-5.8*labelScale}) rotate(${-pose.heading})`}>
      <rect x={-4.8*labelScale} y={-2.1*labelScale} width={9.6*labelScale} height={4.2*labelScale} rx={2.1*labelScale} fill="#03060a" stroke={selected?"#f8fafc":"#475569"} strokeWidth={.5*labelScale} opacity=".82"/>
      <text x="0" y={1.05*labelScale} textAnchor="middle" fontSize={3.2*labelScale} fontWeight="900" fill="#f8fafc">{label}</text>
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

function CanonicalBattleOverlay({
  cars,
  geometry,
  unitsPerMeter,
  drivers,
  scale=1,
  pitBoxOffset=0,
  pitBoxSide=1,
}){
  const byId=new Map((cars||[]).map((car)=>[String(car?.car_id||car?.id||""),car]));
  const attackers=(cars||[]).filter((car)=>
    activeBattleContext(car?.battle_context)&&
    String(car?.battle_context?.role||"")==="attacker"&&
    car?.battle_context?.opponent_car_id
  );
  if(!attackers.length)return null;

  return <g pointerEvents="none">
    {attackers.map((attacker)=>{
      const context=attacker.battle_context;
      const defender=byId.get(String(context.opponent_car_id||""));
      if(!defender)return null;
      const a=visualCarPose(attacker,geometry,unitsPerMeter,{pitBoxOffset,pitBoxSide});
      const d=visualCarPose(defender,geometry,unitsPerMeter,{pitBoxOffset,pitBoxSide});
      if(!a||!d)return null;
      const x=(a.x+d.x)/2;
      const y=(a.y+d.y)/2-(10*scale);
      const clearing=String(context.state)==="yielding";
      const stroke=clearing?"#fb923c":"#fbbf24";
      const title=`${shortName(drivers,attacker.driver_id)} ↔ ${shortName(drivers,defender.driver_id)}`;
      const remaining=formatBattleDuration(context?.remaining_ms);
      return <g key={String(context?.attempt_id||`${attacker.id}_${defender.id}`)}>
        <line
          x1={a.x} y1={a.y} x2={d.x} y2={d.y}
          stroke={stroke}
          strokeWidth={1.15*scale}
          strokeDasharray={`${3*scale} ${2*scale}`}
          opacity=".72"
        />
        <g transform={`translate(${x} ${y})`}>
          <rect x={-29*scale} y={-5.4*scale} width={58*scale} height={10.8*scale} rx={4*scale} fill="#090d12" stroke={stroke} strokeWidth={.7*scale} opacity=".92"/>
          <text x="0" y={-0.7*scale} textAnchor="middle" fontSize={3.4*scale} fontWeight="900" fill={stroke}>{title}</text>
          <text x="0" y={3.25*scale} textAnchor="middle" fontSize={2.7*scale} fontWeight="800" fill="#e2e8f0">{battleStateLabel(context.state)}{remaining!=="—"?` · ${remaining}`:""}</text>
        </g>
      </g>;
    })}
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
  drivers,
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
  return <div className="pointer-events-none absolute bottom-3 right-3 z-20 w-[320px] rounded-xl border border-white/10 bg-[#05080d]/42 p-2.5 shadow-xl backdrop-blur-[2px]">
    <div className="mb-1 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.12em] text-slate-300/80">
      <span>Mini-map</span>
      <span className="text-slate-500">Live field</span>
    </div>
    <svg viewBox={viewBox.join(" ")} className="h-[172px] w-full" preserveAspectRatio="xMidYMid meet" aria-label="Race mini-map">
      <polyline points={polyline} fill="none" stroke="#020617" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" opacity=".68"/>
      <polyline points={polyline} fill="none" stroke="#cbd5e1" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" opacity=".82"/>
      {pitPoints.length>1?<polyline points={pitPolyline} fill="none" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".8"/>:null}
      {cars.filter((car)=>!car.retired||car.retirement_trackside?.visible!==false||car.pit_box_parked).map((car)=>{
        const pose=visualCarPose(car,geometry,unitsPerMeter,{pitBoxOffset,pitBoxSide});
        if(!pose)return null;
        const selected=String(car.driver_id)===String(selectedDriverId||"");
        const battleNow=activeBattleContext(car?.battle_context);
        const radius=selected?9.4:7.2;
        return <g key={`mini_${car.id}`} opacity={car.retired?0.58:0.98}>
          <circle
            cx={pose.x}
            cy={pose.y}
            r={radius}
            fill={teamColor(teamBrands,car.team_id,year)}
            stroke={selected?"#fff":"#020617"}
            strokeWidth={selected?2.4:1.3}
          />
          {battleNow?<circle cx={pose.x} cy={pose.y} r={radius+4.2} fill="none" stroke="#fbbf24" strokeWidth="2" opacity=".92"/>:null}
          <text
            x={pose.x}
            y={pose.y+1.9}
            textAnchor="middle"
            fontSize={selected?5.8:5.1}
            fontWeight="900"
            fill="#fff"
            stroke="#020617"
            strokeWidth=".9"
            paintOrder="stroke"
          >{shortName(drivers,car.driver_id)}</text>
        </g>;
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
  return <aside className="hidden h-full min-h-0 overflow-hidden border-r border-white/10 bg-[#070b10] lg:flex lg:flex-col">
    <div className="shrink-0 border-b border-white/10 bg-black/45 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase italic tracking-[0.14em] text-slate-100">Race</div>
        <div className="font-mono text-[10px] font-bold text-slate-200">LAP {summary.lap}/{summary.total_laps??"—"}</div>
      </div>
      <div className="mt-1 grid grid-cols-[23px_18px_24px_minmax(0,1fr)_62px_24px] items-center gap-1 text-[7px] font-black uppercase tracking-[0.10em] text-slate-600">
        <span className="text-right">P</span>
        <span></span>
        <span></span>
        <span>Drv</span>
        <span className="text-right">Gap</span>
        <span></span>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {(cars||[]).map((car,index)=>{
        const mine=String(car.team_id)===String(playerTeamId||"");
        const active=String(car.driver_id)===String(selectedDriverId||"");
        const delta=positionDelta(car.position_change_last_lap);
        const pitActive=Boolean(car?.pit_state?.active);
        const engagementState=String(car?.battle_context?.state||"");
        const battleNow=activeBattleContext(car?.battle_context);
        const towNow=engagementState==="slipstream";
        const engagementEdge=battleNow
          ?" border-l-2 border-l-amber-400/70"
          :towNow
            ?" border-l-2 border-l-sky-400/50"
            :"";
        const statusGap=car.retired
          ?"DNF"
          :pitActive
            ?"PIT"
            :formatGap(car.gap_to_leader_ms,{leader:index===0});
        return <button
          type="button"
          key={car.id}
          title={`${driverName(drivers,car.driver_id)} · ${teamName(teams,car.team_id)}`}
          onClick={()=>onSelectDriver?.(String(car.driver_id||""))}
          className={"grid min-h-[27px] w-full grid-cols-[23px_18px_24px_minmax(0,1fr)_62px_24px] items-center gap-1 border-b border-white/[0.05] px-2 py-1 text-left transition "+(
            active
              ?"bg-cyan-300/[0.14]"
              :mine
                ?"bg-cyan-400/[0.045] hover:bg-white/[0.055]"
                :battleNow
                  ?"bg-amber-400/[0.035] hover:bg-amber-300/[0.06]"
                  :towNow
                    ?"bg-sky-400/[0.025] hover:bg-sky-300/[0.05]"
                    :"hover:bg-white/[0.045]"
          )+engagementEdge}
        >
          <span className={`text-right text-[11px] font-black ${car.retired?"text-slate-500":"text-slate-100"}`}>{car.position}</span>
          <span className={`text-center text-[7px] font-black ${delta.tone}`}>{delta.label==="—"?"":delta.label.replace("▲","↑").replace("▼","↓")}</span>
          <span className="flex justify-center"><TeamLogo teamId={String(car.team_id||"")} name={teamName(teams,car.team_id)} size="h-4 w-4" className="shrink-0 p-0"/></span>
          <span className={`truncate text-[11px] font-black uppercase tracking-[0.055em] ${car.retired?"text-slate-500":"text-slate-100"}`}>{shortName(drivers,car.driver_id)}</span>
          <span className={`text-right font-mono text-[10px] ${car.retired?"font-bold text-rose-300":pitActive?"font-bold text-sky-300":index===0?"font-black text-emerald-300":"text-slate-300"}`}>{statusGap}</span>
          <span className="flex justify-center"><ControlTowerTyre tyre={car.tyre}/></span>
        </button>;
      })}
    </div>
  </aside>;
});

const RaceInfoRail=React.memo(function RaceInfoRail({view,cars,drivers,selectedDriverId,forecastMessage=""}){
  const track=view?.track_state||{};
  const selectedIndex=(cars||[]).findIndex((car)=>String(car?.driver_id||"")===String(selectedDriverId||""));
  const selected=selectedIndex>=0?cars[selectedIndex]:null;
  const behind=selectedIndex>=0?(cars[selectedIndex+1]||null):null;
  const fastest=(cars||[])
    .filter((car)=>Number.isFinite(Number(car?.best_lap_ms))&&Number(car.best_lap_ms)>0)
    .slice()
    .sort((a,b)=>Number(a.best_lap_ms)-Number(b.best_lap_ms))[0]||null;
  const engagement=selected?.battle_context||null;
  const battleOpponent=engagement?.opponent_car_id
    ?(cars||[]).find((car)=>String(car?.car_id||car?.id||"")===String(engagement.opponent_car_id))
    :null;
  const pct=(value)=>Number.isFinite(Number(value))?`${Math.round(Number(value)*100)}%`:"—";
  const metric=(label,value)=><div className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-1.5 last:border-b-0"><span className="text-[9px] uppercase tracking-[0.08em] text-slate-500">{label}</span><strong className="text-right text-[10px] font-semibold text-slate-200">{value}</strong></div>;
  return <aside className="hidden h-full min-h-0 overflow-y-auto border-l border-white/10 bg-[#070b10] lg:flex lg:flex-col">
    <div className="border-b border-white/10 bg-black/35 px-3 py-2.5">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-200">Race conditions</div>
      <div className="mt-1 text-[9px] text-slate-500">{String(view?.last_weather||"—").replaceAll("_"," ")}</div>
    </div>
    <div className="px-3 py-2">
      {metric("Rain",pct(track?.rain_intensity))}
      {metric("Wet",pct(track?.track_wetness))}
      {metric("Grip",Number.isFinite(Number(track?.grip_index))?`${Math.round(Number(track.grip_index))}/100`:"—")}
      {metric("Visibility",Number.isFinite(Number(track?.visibility_index))?`${Math.round(Number(track.visibility_index))}%`:"—")}
      {metric("Track",Number.isFinite(Number(track?.track_temp_c))?`${Number(track.track_temp_c).toFixed(1)}°C`:"—")}
      {metric("Air",Number.isFinite(Number(track?.air_temp_c))?`${Number(track.air_temp_c).toFixed(1)}°C`:"—")}
    </div>
    {forecastMessage?<div className="border-t border-white/10 bg-sky-500/[0.04] px-3 py-2">
      <div className="text-[8px] font-black uppercase tracking-[0.12em] text-sky-300/70">Team forecast</div>
      <div className="mt-1 text-[9px] leading-relaxed text-sky-100/80">{forecastMessage}</div>
    </div>:null}
    <div className="border-y border-white/10 bg-black/25 px-3 py-2">
      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">Fastest lap</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <strong className="truncate text-[11px] text-fuchsia-200">{fastest?shortName(drivers,fastest.driver_id):"—"}</strong>
        <span className="font-mono text-[10px] text-slate-300">{formatLapTime(fastest?.best_lap_ms)}</span>
      </div>
    </div>
    <div className="min-h-0 flex-1 px-3 py-2.5">
      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-200">Selected driver</div>
      {selected?<>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <div className="text-[12px] font-black text-white">{shortName(drivers,selected.driver_id)} · P{selected.position}</div>
            <div className="text-[9px] text-slate-500">{driverName(drivers,selected.driver_id)}</div>
          </div>
          <span className="rounded bg-white/[0.05] px-2 py-1 text-[9px] font-mono text-slate-200">{formatSpeed(selected.speed_kmh)}</span>
        </div>
        {metric("Ahead",selected.position===1?"LEAD":formatGap(selected.gap_to_previous_ms))}
        {metric("Behind",behind?formatGap(behind.gap_to_previous_ms):"—")}
        {metric("Tyre",`${selected?.tyre?.compound||"—"} · ${Number.isFinite(Number(selected?.tyre?.condition))?Math.round(Number(selected.tyre.condition))+"%":"—"}`)}
        {metric("Tyre temp",Number.isFinite(Number(selected?.tyre?.temperature_c))?`${Math.round(Number(selected.tyre.temperature_c))}°C`:"—")}
        {metric("Damage",selected?.damaged_components?.length?String(selected.damage_severity||"damage").toUpperCase():"CLEAR")}
        {metric("Best lap",formatLapTime(selected?.best_lap_ms))}
        {engagement?<div className={"mt-2 rounded-md border px-2 py-2 "+(activeBattleContext(engagement)?"border-amber-300/20 bg-amber-500/[0.08]":"border-sky-300/20 bg-sky-500/[0.07]")}>
          <div className={"text-[8px] font-black uppercase tracking-[0.12em] "+(activeBattleContext(engagement)?"text-amber-300":"text-sky-300")}>Battle telemetry</div>
          <div className={"mt-0.5 text-[10px] font-semibold "+(activeBattleContext(engagement)?"text-amber-100":"text-sky-100")}>{String(engagement.role||"car").toUpperCase()} · {battleStateLabel(engagement.state)}</div>
          {battleOpponent?<div className="mt-0.5 text-[9px] text-slate-400">vs {shortName(drivers,battleOpponent.driver_id)} · {driverName(drivers,battleOpponent.driver_id)}</div>:null}
          <div className="mt-2 border-t border-white/[0.06] pt-1">
            {hasTelemetryNumber(engagement?.gap_m)?metric("Physical gap",formatBattleDistance(engagement.gap_m)):null}
            {hasTelemetryNumber(engagement?.started_gap_m)?metric("Started gap",formatBattleDistance(engagement.started_gap_m)):null}
            {hasTelemetryNumber(engagement?.attempt_probability_pct)?metric(String(engagement?.role)==="defender"?"Attack chance":"Attempt chance",`${Math.round(Number(engagement.attempt_probability_pct))}%`):null}
            {hasTelemetryNumber(engagement?.closing_potential_kmh)?metric(String(engagement?.role)==="defender"?"Opponent closing":"Closing potential",`+${Number(engagement.closing_potential_kmh).toFixed(1)} km/h`):null}
            {hasTelemetryNumber(engagement?.remaining_ms)?metric("Window remaining",formatBattleDuration(engagement.remaining_ms)):null}
            {hasTelemetryNumber(engagement?.contact_risk_pct)?metric("Contact risk / step",`${Number(engagement.contact_risk_pct).toFixed(2)}%`):null}
            {hasTelemetryNumber(engagement?.slipstream_strength_pct)&&Number(engagement.slipstream_strength_pct)>0?metric("Tow strength",`${Math.round(Number(engagement.slipstream_strength_pct))}%`):null}
            {hasTelemetryNumber(engagement?.slipstream_bonus_kmh)&&Number(engagement.slipstream_bonus_kmh)>0?metric("Tow bonus",`+${Number(engagement.slipstream_bonus_kmh).toFixed(1)} km/h`):null}
            {engagement?.result?metric("Outcome",String(engagement.result).replaceAll("_"," ").toUpperCase()):null}
          </div>
        </div>:null}
      </>:<div className="text-[10px] leading-relaxed text-slate-500">Select a driver from the timing tower or track to show live KPIs.</div>}
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
  forecastMessage="",
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
  const presentationTrackWidthM=useMemo(()=>{
    const value=Number(
      resolved?.layout?.track_width_m
      ??resolved?.geometry?.track_width_m
      ??resolved?.track_width_m
    );
    return Number.isFinite(value)&&value>0
      ?value
      :RACE_VIEW_NOMINAL_TRACK_WIDTH_M;
  },[resolved]);
  const runtimeGeometry=useMemo(()=>trackRuntimeGeometry(resolved),[resolved]);
  const sourceGeometry=useMemo(
    ()=>orientTrackGeometry(runtimeGeometry?.geometry||null),
    [runtimeGeometry]
  );
  const presentationLine=useMemo(()=>{
    const sourcePoints=Array.isArray(sourceGeometry?.points)?sourceGeometry.points:[];
    return sourcePoints.length>=3&&trackPresentationSplineEligible(resolved,runtimeGeometry)
      ?buildClosedRacingLine(sourcePoints,{samplesPerSegment:8,parameterization:"centripetal"})
      :null;
  },[resolved,runtimeGeometry,sourceGeometry]);
  const geometry=useMemo(()=>
    presentationLine?.points?.length
      ?racingLineGeometry(sourceGeometry,presentationLine)
      :sourceGeometry
  ,[sourceGeometry,presentationLine]);
  const viewBox=useMemo(()=>trackGeometryViewBox(geometry,{paddingRatio:.06,minPadding:20}),[geometry]);
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  const closedPoints=points.length?[...points,points[0]]:[];
  const polyline=closedPoints.map((point)=>point.join(",")).join(" ");
  const pitLaneAvailable=Boolean(view?.pit_lane?.available);
  const pitLanePoints=pitLaneAvailable&&Array.isArray(geometry?.pit_lane_points)
    ?geometry.pit_lane_points
    :[];
  const pitPolyline=pitLanePoints.map((point)=>point.join(",")).join(" ");
  const unitsPerMeter=trackPathLength(points)/trackLengthM;
  const markerScale=Math.max(.62,Math.min(1.2,Number(viewBox?.[2]||1000)/930));
  const pitBoxSide=useMemo(()=>pitBoxSideSign(geometry),[geometry]);
  const pitBoxOffset=10*markerScale;
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
    :raceViewCameraViewBox(viewBox,{zoom:cameraZoom,center:cameraCenter});
  const trackLod=cameraMode==="fit"
    ?"overview"
    :cameraZoom>=4.5
      ?"close"
      :"medium";
  const weatherVisuals=useMemo(()=>raceViewWeatherVisuals(view?.track_state||{}),[view?.track_state]);

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

  return <div className="grid h-[calc(100vh-145px)] min-h-[650px] overflow-hidden rounded-lg border border-white/10 bg-[#080d13] lg:grid-cols-[342px_minmax(0,1fr)_250px]">
    <ControlTowerPanel
      cars={cars}
      playerTeamId={playerTeamId}
      selectedDriverId={selectedDriverId}
      onSelectDriver={onSelectDriver}
      drivers={drivers}
      teams={teams}
      summary={summary}
    />
    <div className="relative min-h-0 overflow-hidden bg-[#101923]">
      <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
        <span className={"rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] "+controlTone(summary.control)}>{summary.control.replaceAll("_"," ")}</span>
        <span className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[9px] font-semibold text-slate-300">Lap {summary.lap}/{summary.total_laps??"—"}</span>
        <span className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[9px] font-semibold text-slate-400">{playbackRunning?`${playbackSpeed}× live`:"paused"}</span>
        <span className="rounded border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[9px] font-semibold text-sky-100">{String(view?.last_weather||"—").replaceAll("_"," ")}</span>
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
        className={"h-full w-full select-none "+(cameraMode==="free"?"cursor-grab active:cursor-grabbing":"cursor-default")}
        viewBox={cameraBox.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Canonical race track"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointerDrag}
        onPointerCancel={endPointerDrag}
      >
        <defs>
          <linearGradient id="rw15-asphalt" x1="0" x2="1">
            <stop offset="0%" stopColor="#2d333b"/>
            <stop offset="50%" stopColor="#151a20"/>
            <stop offset="100%" stopColor="#30363d"/>
          </linearGradient>
        </defs>
        <rect x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]} fill="#26371f"/>
        {weatherVisuals.grassDarkenOpacity>0?<rect
          x={viewBox[0]} y={viewBox[1]} width={viewBox[2]} height={viewBox[3]}
          fill="#07111a" opacity={weatherVisuals.grassDarkenOpacity}
          pointerEvents="none"
        />:null}
        <polyline points={polyline} fill="none" stroke="#111827" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" opacity=".65"/>
        <polyline points={polyline} fill="none" stroke="#d1d5db" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points={polyline} fill="none" stroke="url(#rw15-asphalt)" strokeWidth={RACE_VIEW_ASPHALT_WIDTH_SVG} strokeLinecap="round" strokeLinejoin="round"/>
        {pitLanePoints.length>1?<g pointerEvents="none">
          <polyline points={pitPolyline} fill="none" stroke="#111827" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" opacity=".72"/>
          <polyline points={pitPolyline} fill="none" stroke="#64748b" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points={pitPolyline} fill="none" stroke="#cbd5e1" strokeWidth=".8" strokeDasharray="3 8" opacity=".45"/>
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
        {weatherVisuals.wetTrackOpacity>0?<polyline
          points={polyline}
          fill="none"
          stroke="#7dd3fc"
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={weatherVisuals.wetTrackOpacity*.45}
          pointerEvents="none"
        />:null}
        <CanonicalBattleOverlay
          cars={visualCars}
          geometry={geometry}
          unitsPerMeter={unitsPerMeter}
          drivers={drivers}
          scale={markerScale}
          pitBoxOffset={pitBoxOffset}
          pitBoxSide={pitBoxSide}
        />
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
            trackWidthM={presentationTrackWidthM}
            retired={car.retired}
            year={year}
            driverNumberValue={driverNumber(drivers,car.driver_id)}
            pitBoxOffset={pitBoxOffset}
            pitBoxSide={pitBoxSide}
          />;
        })}
      </svg>:<div className="flex h-full items-center justify-center text-sm text-slate-500">Track geometry unavailable.</div>}
      <CanonicalMiniMap
        geometry={geometry}
        viewBox={viewBox}
        cars={visualCars}
        unitsPerMeter={unitsPerMeter}
        teamBrands={teamBrands}
        drivers={drivers}
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

    </div>
    <RaceInfoRail
      view={view}
      cars={cars}
      drivers={drivers}
      selectedDriverId={selectedDriverId}
      forecastMessage={forecastMessage}
    />

  </div>;
}
