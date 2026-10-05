import React,{useEffect,useMemo,useRef,useState}from "react";
import {pointAtTrackProgress,trackGeometryViewBox} from "../../domain/trackLayout.js";
import RaceCarVisual from "../race/RaceCarVisual.jsx";
import {historicalRaceCarLivery} from "../../domain/raceCarLiveries.js";
import {raceCarPresentationScale,raceViewLateralUnitsPerMeter} from "../../domain/raceCarPresentation.js";
import {TeamLogo} from "../entity/EntityVisuals.jsx";

const UNDERCUT_ASPHALT_WIDTH=28;
const FOLLOW_ZOOM=6.1;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const finite=(value,fallback=0)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const wrap=(value,length)=>{
  const safe=Math.max(1,finite(length,1));
  return ((finite(value,0)%safe)+safe)%safe;
};

function driverId(row){return String(row?.driver_id??row?.id??"");}
function teamId(row){return String(row?.team_id??row?.id??"");}

function driverName(drivers,id){
  const driver=(drivers||[]).find((row)=>driverId(row)===String(id??""));
  return driver?.display_name||driver?.name||`${driver?.first_name??""} ${driver?.last_name??""}`.trim()||String(id||"—");
}

function shortName(drivers,id){
  const name=driverName(drivers,id);
  const parts=String(name).trim().split(/\s+/).filter(Boolean);
  return (parts.at(-1)||name||"?").slice(0,3).toUpperCase();
}

function driverNumber(drivers,id){
  const row=(drivers||[]).find((driver)=>driverId(driver)===String(id??""));
  return row?.race_number??row?.driver_number??row?.number??null;
}

function teamName(teams,id){
  const row=(teams||[]).find((team)=>teamId(team)===String(id??""));
  return row?.team_name||row?.name||String(id||"—");
}

function hashColor(value){
  const palette=["#ef4444","#3b82f6","#22c55e","#f59e0b","#a855f7","#06b6d4","#f97316","#ec4899","#84cc16","#8b5cf6"];
  let hash=0;
  for(const char of String(value||""))hash=(hash*31+char.charCodeAt(0))>>>0;
  return palette[hash%palette.length];
}

function teamVisualPalette(teamBrands,teamIdValue,year,name=""){
  const id=String(teamIdValue||"");
  const rows=(teamBrands||[]).filter((row)=>String(row?.team_id??row?.id??"")===id);
  const target=Number(year);
  const brand=rows.find((row)=>Number(row?.year)===target)
    ||rows.filter((row)=>Number(row?.year)<=target).sort((a,b)=>Number(b.year)-Number(a.year))[0]
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
  return Number.isFinite(n)&&n>=0?`+${(n/1000).toFixed(n>=10000?1:3)}`:"—";
}

function formatLapTime(ms){
  const n=Number(ms);
  if(!Number.isFinite(n)||n<=0)return "—";
  const minutes=Math.floor(n/60000);
  const seconds=(n-minutes*60000)/1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6,"0")}`;
}

function battleActive(context){
  return ["side_by_side","yielding"].includes(String(context?.state||""));
}

function tyreVisual(compound){
  const key=String(compound||"").toLowerCase();
  if(key.includes("inter"))return {label:"I",ring:"#39ff14"};
  if(key.includes("wet"))return {label:"W",ring:"#18a8ff"};
  if(key.includes("soft")||key.includes("option"))return {label:"S",ring:"#ff3030"};
  if(key.includes("medium"))return {label:"M",ring:"#ffd800"};
  if(key.includes("hard")||key.includes("prime"))return {label:"H",ring:"#f5f7fa"};
  return {label:"T",ring:"#94a3b8"};
}

function TyreBadge({tyre}){
  const visual=tyreVisual(tyre?.compound);
  return <span
    title={tyre?.compound||"Tyre"}
    className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#05070b]"
    style={{border:`2px solid ${visual.ring}`}}
  >
    <span className="text-[6px] font-black" style={{color:visual.ring}}>{visual.label}</span>
  </span>;
}

function positionDelta(value){
  const n=Number(value)||0;
  if(n>0)return {label:`↑${n}`,tone:"text-emerald-300"};
  if(n<0)return {label:`↓${Math.abs(n)}`,tone:"text-rose-300"};
  return {label:"",tone:"text-slate-600"};
}

function renderAnchor(anchor,now){
  if(!anchor)return null;
  const elapsedReal=Math.max(0,(now-anchor.realAtMs)/1000);
  const canonicalElapsed=elapsedReal*anchor.playbackSpeed*(anchor.playbackRunning?1:0);
  const decay=Math.exp(-elapsedReal/Math.max(.12,anchor.correctionTauS));
  return {
    absoluteDistanceM:
      anchor.absoluteDistanceM+
      anchor.speedMs*canonicalElapsed+
      anchor.absoluteCorrectionM*decay,
    lateralOffsetM:
      anchor.lateralOffsetM+
      anchor.lateralCorrectionM*decay,
  };
}

function useContinuousCars(view,{playbackRunning=false,playbackSpeed=1}={}){
  const rows=Array.isArray(view?.classification)?view.classification:[];
  const trackLengthM=Math.max(1,finite(view?.track_length_m,1));
  const anchorsRef=useRef(new Map());
  const displayRef=useRef(new Map());
  const [display,setDisplay]=useState(rows);
  const tick=finite(view?.canonical_tick,0);

  useEffect(()=>{
    const now=performance.now();
    const previous=anchorsRef.current;
    const next=new Map();

    for(const row of rows){
      const id=String(row?.car_id??row?.driver_id??"");
      if(!id)continue;
      const previousAnchor=previous.get(id);
      const previousRendered=displayRef.current.get(id)||
        (previousAnchor?renderAnchor(previousAnchor,now):null);
      const canonicalAbsolute=finite(row?.absolute_distance_m,0);
      const canonicalLateral=finite(row?.lateral_offset_m,0);
      const correctionAbsolute=previousRendered
        ?previousRendered.absoluteDistanceM-canonicalAbsolute
        :0;
      const correctionLateral=previousRendered
        ?previousRendered.lateralOffsetM-canonicalLateral
        :0;
      const reset=Math.abs(correctionAbsolute)>trackLengthM*.2;

      next.set(id,{
        row,
        absoluteDistanceM:canonicalAbsolute,
        lateralOffsetM:canonicalLateral,
        speedMs:Math.max(0,finite(row?.speed_ms,finite(row?.speed_kmh,0)/3.6)),
        realAtMs:now,
        playbackRunning:Boolean(playbackRunning),
        playbackSpeed:Math.max(.05,finite(playbackSpeed,1)),
        correctionTauS:playbackSpeed>=8?.20:.32,
        absoluteCorrectionM:reset?0:correctionAbsolute,
        lateralCorrectionM:reset?0:correctionLateral,
      });
    }
    anchorsRef.current=next;
  },[tick,playbackRunning,playbackSpeed,trackLengthM,rows]);

  useEffect(()=>{
    let frame=null;
    let alive=true;
    const draw=(now)=>{
      if(!alive)return;
      const nextRows=[];
      const nextMap=new Map();
      for(const [id,anchor] of anchorsRef.current.entries()){
        const rendered=renderAnchor(anchor,now);
        if(!rendered)continue;
        const distanceAlongLapM=wrap(rendered.absoluteDistanceM,trackLengthM);
        nextRows.push({
          ...anchor.row,
          id,
          absolute_distance_m:rendered.absoluteDistanceM,
          distance_along_lap_m:distanceAlongLapM,
          track_progress:distanceAlongLapM/trackLengthM,
          lateral_offset_m:rendered.lateralOffsetM,
        });
        nextMap.set(id,rendered);
      }
      displayRef.current=nextMap;
      setDisplay(nextRows);
      frame=window.requestAnimationFrame(draw);
    };
    frame=window.requestAnimationFrame(draw);
    return ()=>{
      alive=false;
      if(frame!=null)window.cancelAnimationFrame(frame);
    };
  },[trackLengthM]);

  return display;
}

function sampleCarPose(geometry,progress,lateralOffsetM,unitsPerMeter,trackLengthM){
  const center=pointAtTrackProgress(geometry,progress);
  const tangentDistanceM=18;
  const delta=tangentDistanceM/Math.max(1,trackLengthM);
  const before=pointAtTrackProgress(geometry,progress-delta);
  const after=pointAtTrackProgress(geometry,progress+delta);
  if(!center||!before||!after)return null;
  const dx=after.x-before.x;
  const dy=after.y-before.y;
  const length=Math.hypot(dx,dy)||1;
  const lateral=finite(lateralOffsetM,0)*unitsPerMeter;
  return {
    x:center.x+(-dy/length)*lateral,
    y:center.y+(dx/length)*lateral,
    heading:Math.atan2(dy,dx)*180/Math.PI,
  };
}

function viewBoxAround(base,center,zoom){
  const [x,y,width,height]=base;
  const z=Math.max(1,finite(zoom,1));
  const nextWidth=width/z;
  const nextHeight=height/z;
  const cx=clamp(center?.x??x+width/2,x+nextWidth/2,x+width-nextWidth/2);
  const cy=clamp(center?.y??y+height/2,y+nextHeight/2,y+height-nextHeight/2);
  return [cx-nextWidth/2,cy-nextHeight/2,nextWidth,nextHeight];
}

const ControlTower=React.memo(function ControlTower({
  cars,playerTeamId,selectedDriverId,onSelectDriver,drivers,teams,currentLap,totalLaps,
}){
  return <aside className="hidden h-full min-h-0 overflow-hidden border-r border-white/10 bg-[#070b10] lg:flex lg:flex-col">
    <div className="shrink-0 border-b border-white/10 bg-black/45 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase italic tracking-[0.14em] text-slate-100">Race</div>
        <div className="font-mono text-[10px] font-bold text-slate-200">LAP {currentLap}/{totalLaps??"—"}</div>
      </div>
      <div className="mt-1 grid grid-cols-[23px_18px_24px_minmax(0,1fr)_62px_24px] items-center gap-1 text-[7px] font-black uppercase tracking-[0.10em] text-slate-600">
        <span className="text-right">P</span><span></span><span></span><span>Drv</span><span className="text-right">Gap</span><span></span>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {(cars||[]).map((car,index)=>{
        const mine=String(car.team_id)===String(playerTeamId||"");
        const active=String(car.driver_id)===String(selectedDriverId||"");
        const delta=positionDelta(car.position_change_last_lap);
        const pitActive=Boolean(car?.pit_state?.active);
        const battleNow=battleActive(car?.battle_context);
        const status=car.retired?"DNF":pitActive?"PIT":formatGap(car.gap_to_leader_ms,{leader:index===0});
        return <button
          type="button"
          key={String(car.car_id||car.driver_id)}
          title={`${driverName(drivers,car.driver_id)} · ${teamName(teams,car.team_id)}`}
          onClick={()=>onSelectDriver?.(String(car.driver_id||""))}
          className={"grid min-h-[27px] w-full grid-cols-[23px_18px_24px_minmax(0,1fr)_62px_24px] items-center gap-1 border-b border-white/[0.05] px-2 py-1 text-left transition "+(
            active?"bg-cyan-300/[0.14]":mine?"bg-cyan-400/[0.045] hover:bg-white/[0.055]":battleNow?"border-l-2 border-l-amber-400/70 bg-amber-400/[0.035]":"hover:bg-white/[0.045]"
          )}
        >
          <span className={"text-right text-[11px] font-black "+(car.retired?"text-slate-500":"text-slate-100")}>{finite(car.position,index+1)}</span>
          <span className={"text-center text-[7px] font-black "+delta.tone}>{delta.label}</span>
          <span className="flex justify-center"><TeamLogo teamId={String(car.team_id||"")} name={teamName(teams,car.team_id)} size="h-4 w-4" className="shrink-0 p-0"/></span>
          <span className={"truncate text-[11px] font-black uppercase tracking-[0.055em] "+(car.retired?"text-slate-500":"text-slate-100")}>{shortName(drivers,car.driver_id)}</span>
          <span className={"text-right font-mono text-[10px] "+(car.retired?"font-bold text-rose-300":pitActive?"font-bold text-sky-300":index===0?"font-black text-emerald-300":"text-slate-300")}>{status}</span>
          <span className="flex justify-center"><TyreBadge tyre={car.tyre}/></span>
        </button>;
      })}
    </div>
  </aside>;
});

const InfoRail=React.memo(function InfoRail({view,cars,drivers,selectedDriverId,forecastMessage=""}){
  const selectedIndex=(cars||[]).findIndex((car)=>String(car?.driver_id||"")===String(selectedDriverId||""));
  const selected=selectedIndex>=0?cars[selectedIndex]:null;
  const behind=selectedIndex>=0?cars[selectedIndex+1]||null:null;
  const fastest=(cars||[]).filter((car)=>Number(car?.best_lap_ms)>0).slice().sort((a,b)=>Number(a.best_lap_ms)-Number(b.best_lap_ms))[0]||null;
  const engagement=selected?.battle_context||null;
  const track=view?.track_state||{};
  const metric=(label,value)=><div className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-1.5 last:border-b-0"><span className="text-[9px] uppercase tracking-[0.08em] text-slate-500">{label}</span><strong className="text-right text-[10px] font-semibold text-slate-200">{value}</strong></div>;

  return <aside className="hidden h-full min-h-0 overflow-y-auto border-l border-white/10 bg-[#070b10] lg:flex lg:flex-col">
    <div className="border-b border-white/10 bg-black/35 px-3 py-2.5">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-200">Race conditions</div>
      <div className="mt-1 text-[9px] text-slate-500">{String(view?.last_weather||"—").replaceAll("_"," ")}</div>
    </div>
    <div className="px-3 py-2">
      {metric("Rain",`${Math.round(clamp(track?.rain_intensity,0,1)*100)}%`)}
      {metric("Wet",`${Math.round(clamp(track?.track_wetness,0,1)*100)}%`)}
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
          <div><div className="text-[12px] font-black text-white">{shortName(drivers,selected.driver_id)} · P{selected.position}</div><div className="text-[9px] text-slate-500">{driverName(drivers,selected.driver_id)}</div></div>
          <span className="rounded bg-white/[0.05] px-2 py-1 text-[9px] font-mono text-slate-200">{Math.round(finite(selected.speed_kmh,0))} km/h</span>
        </div>
        {metric("Ahead",selected.position===1?"LEAD":formatGap(selected.gap_to_previous_ms))}
        {metric("Behind",behind?formatGap(behind.gap_to_previous_ms):"—")}
        {metric("Tyre",`${selected?.tyre?.compound||"—"} · ${Number.isFinite(Number(selected?.tyre?.condition))?Math.round(Number(selected.tyre.condition))+"%":"—"}`)}
        {metric("Fuel",Number.isFinite(Number(selected?.fuel_kg))?`${Number(selected.fuel_kg).toFixed(1)} kg`:"—")}
        {metric("Pace",String(selected?.current_pace||"—").toUpperCase())}
        {engagement&&String(engagement.state||"")!=="none"?<div className={"mt-3 rounded-md border px-2 py-2 "+(battleActive(engagement)?"border-amber-300/30 bg-amber-500/[0.09]":"border-sky-300/20 bg-sky-500/[0.07]")}>
          <div className={"text-[8px] font-black uppercase tracking-[0.12em] "+(battleActive(engagement)?"text-amber-300":"text-sky-300")}>Battle telemetry</div>
          <div className="mt-1 text-[11px] font-black text-white">{String(engagement.role||"car").toUpperCase()} · {String(engagement.state||"").replaceAll("_"," ").toUpperCase()}</div>
          {Number.isFinite(Number(engagement?.attempt_probability_pct))?metric("Pass chance",`${Math.round(Number(engagement.attempt_probability_pct))}%`):null}
          {Number.isFinite(Number(engagement?.driver_edge))?metric("Driver edge",`${Number(engagement.driver_edge)>=0?"+":""}${Number(engagement.driver_edge).toFixed(0)}`):null}
          {Number.isFinite(Number(engagement?.car_edge))?metric("Car edge",`${Number(engagement.car_edge)>=0?"+":""}${Number(engagement.car_edge).toFixed(0)}`):null}
          {engagement?.track_phase?metric("Track",String(engagement.track_phase).replaceAll("_"," ").toUpperCase()):null}
        </div>:null}
      </>:<div className="text-[10px] leading-relaxed text-slate-500">Select a driver from the timing tower or track to show live KPIs.</div>}
    </div>
  </aside>;
});

function StartingGrid({cars,geometry,trackLengthM,unitsPerMeter}){
  return <g pointerEvents="none" opacity=".52">
    {(cars||[]).filter((car)=>Number.isFinite(Number(car?.grid_start_offset_m))&&Number.isFinite(Number(car?.grid_lane_offset_m))).map((car)=>{
      const progress=wrap(Number(car.grid_start_offset_m),trackLengthM)/trackLengthM;
      const pose=sampleCarPose(geometry,progress,Number(car.grid_lane_offset_m),unitsPerMeter,trackLengthM);
      if(!pose)return null;
      return <g key={`grid_${car.car_id||car.driver_id}`} transform={`translate(${pose.x} ${pose.y}) rotate(${pose.heading})`}>
        <rect x="-4.4" y="-2.0" width="8.8" height="4" fill="none" stroke="#f8fafc" strokeWidth=".55"/>
      </g>;
    })}
  </g>;
}

function UndercutTrackViewport({
  view,cars,trackLengthM,drivers,teams,teamBrands,selectedDriverId,onSelectDriver,year,playbackRunning,playbackSpeed,
}){
  const geometry=useMemo(()=>{
    const points=Array.isArray(view?.track_geometry?.points)?view.track_geometry.points:[];
    return points.length>=3?{points}:null;
  },[view?.track_geometry]);
  const baseViewBox=useMemo(
    ()=>geometry?trackGeometryViewBox(geometry,{paddingRatio:.05,minPadding:18}):[0,0,1000,600],
    [geometry]
  );
  const visualCars=useContinuousCars(view,{playbackRunning,playbackSpeed});
  const [cameraMode,setCameraMode]=useState(selectedDriverId?"follow":"fit");
  const [zoom,setZoom]=useState(FOLLOW_ZOOM);
  const selected=visualCars.find((car)=>String(car?.driver_id||"")===String(selectedDriverId||""))||null;
  const physicalWidthM=Math.max(7,finite(view?.track_width?.physicalWidthM,12.5));
  const unitsPerMeter=raceViewLateralUnitsPerMeter({
    trackWidthM:physicalWidthM,
    asphaltWidthSvg:UNDERCUT_ASPHALT_WIDTH,
  });
  const selectedPose=selected&&geometry
    ?sampleCarPose(geometry,selected.track_progress,selected.lateral_offset_m,unitsPerMeter,trackLengthM)
    :null;
  const cameraBox=cameraMode==="follow"&&selectedPose
    ?viewBoxAround(baseViewBox,selectedPose,zoom)
    :baseViewBox;
  const points=geometry?.points||[];
  const polyline=points.length?[...points,points[0]].map((point)=>point.join(",")).join(" "):"";

  const selectAndFollow=(driverIdValue)=>{
    onSelectDriver?.(String(driverIdValue||""));
    setCameraMode("follow");
  };

  return <div className="relative min-h-0 overflow-hidden bg-[#759b3b]">
    <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
      <span className="rounded border border-emerald-400/30 bg-black/45 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-200">{String(view?.current_control||"GREEN").replaceAll("_"," ")}</span>
      <span className="rounded border border-white/10 bg-black/45 px-2 py-1 text-[9px] font-semibold text-slate-200">Lap {finite(view?.current_lap,1)}/{view?.total_laps??"—"}</span>
      <span className="rounded border border-white/10 bg-black/45 px-2 py-1 text-[9px] font-semibold text-slate-300">{playbackRunning?`${playbackSpeed}× live`:"paused"}</span>
    </div>
    <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded border border-white/15 bg-black/60 p-1">
      <button type="button" onClick={()=>setCameraMode("fit")} className={"rounded px-2 py-1 text-[9px] font-black "+(cameraMode==="fit"?"bg-white text-black":"text-slate-300")}>FIT</button>
      <button type="button" disabled={!selected} onClick={()=>setCameraMode("follow")} className={"rounded px-2 py-1 text-[9px] font-black "+(cameraMode==="follow"?"bg-cyan-300 text-black":"text-slate-300 disabled:opacity-30")}>FOLLOW</button>
      <button type="button" disabled={cameraMode!=="follow"} onClick={()=>setZoom((value)=>clamp(value/1.18,3.8,9)} className="rounded px-2 py-1 text-[10px] font-black text-slate-300 disabled:opacity-30">−</button>
      <button type="button" disabled={cameraMode!=="follow"} onClick={()=>setZoom((value)=>clamp(value*1.18,3.8,9)} className="rounded px-2 py-1 text-[10px] font-black text-slate-300 disabled:opacity-30">+</button>
    </div>

    {geometry?<svg className="h-full w-full" viewBox={cameraBox.join(" ")} preserveAspectRatio="xMidYMid meet" aria-label="Undercut-inspired race track">
      <rect x={baseViewBox[0]} y={baseViewBox[1]} width={baseViewBox[2]} height={baseViewBox[3]} fill="#759b3b"/>
      <polyline points={polyline} fill="none" stroke="#25292d" strokeWidth={UNDERCUT_ASPHALT_WIDTH+5.5} strokeLinecap="round" strokeLinejoin="round" opacity=".7"/>
      <polyline points={polyline} fill="none" stroke="#f5f5f4" strokeWidth={UNDERCUT_ASPHALT_WIDTH+2.5} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={polyline} fill="none" stroke="#55585d" strokeWidth={UNDERCUT_ASPHALT_WIDTH} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={polyline} fill="none" stroke="#686b70" strokeWidth=".75" strokeLinecap="round" strokeLinejoin="round" opacity=".65"/>
      <StartingGrid cars={cars} geometry={geometry} trackLengthM={trackLengthM} unitsPerMeter={unitsPerMeter}/>
      {visualCars.filter((car)=>!car?.retired).map((car)=>{
        const pose=sampleCarPose(geometry,car.track_progress,car.lateral_offset_m,unitsPerMeter,trackLengthM);
        if(!pose)return null;
        const active=String(car?.driver_id||"")===String(selectedDriverId||"");
        const teamLabel=teamName(teams,car.team_id);
        const palette=teamVisualPalette(teamBrands,car.team_id,year,teamLabel);
        const calibrated=raceCarPresentationScale({
          year,
          model:palette.model,
          trackWidthM:physicalWidthM,
          asphaltWidthSvg:UNDERCUT_ASPHALT_WIDTH,
        });
        const battleNow=battleActive(car?.battle_context);
        return <g
          key={String(car?.car_id||car?.driver_id)}
          role="button"
          tabIndex="0"
          transform={`translate(${pose.x} ${pose.y}) rotate(${pose.heading})`}
          onPointerDown={(event)=>event.stopPropagation()}
          onClick={(event)=>{event.stopPropagation();selectAndFollow(car.driver_id);}}
          onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();selectAndFollow(car.driver_id);}}}
          style={{cursor:"pointer"}}
        >
          {active?<circle r={Math.max(7.2,calibrated.targetLengthSvg*.68)} fill="rgba(255,255,255,.06)" stroke="#fff" strokeWidth="1.15"/>:null}
          {battleNow?<circle r={Math.max(8.5,calibrated.targetLengthSvg*.78)} fill="none" stroke="#fbbf24" strokeWidth=".8" strokeDasharray="2.4 1.7"/>:null}
          <g transform={`scale(${calibrated.scale})`}>
            <RaceCarVisual
              year={year}
              color={palette.primary}
              secondary={palette.secondary}
              accent={palette.accent}
              selected={active}
              retired={car.retired}
              lod={cameraMode==="follow"?"close":"medium"}
              damageState={car.damage_state}
              driverNumber={driverNumber(drivers,car.driver_id)}
              sponsorLabel={palette.sponsor}
              liveryPattern={palette.pattern}
              historicalModel={palette.model}
            />
          </g>
        </g>;
      })}
    </svg>:<div className="flex h-full items-center justify-center bg-[#182018] text-sm text-slate-500">Canonical track geometry unavailable.</div>}
  </div>;
}

export default function RaceViewRebuild({
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
  void trackId;
  const cars=useMemo(()=>Array.isArray(view?.classification)?view.classification:[],[view?.classification]);
  const sortedCars=useMemo(()=>cars.slice().sort((a,b)=>finite(a?.position,999)-finite(b?.position,999)),[cars]);
  const trackLengthM=Math.max(1,finite(view?.track_length_m,1));

  return <div className="grid h-[calc(100vh-145px)] min-h-[650px] overflow-hidden rounded-lg border border-white/10 bg-[#080d13] lg:grid-cols-[330px_minmax(0,1fr)_300px]">
    <ControlTower
      cars={sortedCars}
      playerTeamId={playerTeamId}
      selectedDriverId={selectedDriverId}
      onSelectDriver={onSelectDriver}
      drivers={drivers}
      teams={teams}
      currentLap={finite(view?.current_lap,1)}
      totalLaps={view?.total_laps}
    />
    <UndercutTrackViewport
      view={view}
      cars={sortedCars}
      trackLengthM={trackLengthM}
      drivers={drivers}
      teams={teams}
      teamBrands={teamBrands}
      selectedDriverId={selectedDriverId}
      onSelectDriver={onSelectDriver}
      year={year}
      playbackRunning={playbackRunning}
      playbackSpeed={playbackSpeed}
    />
    <InfoRail
      view={view}
      cars={sortedCars}
      drivers={drivers}
      selectedDriverId={selectedDriverId}
      forecastMessage={forecastMessage}
    />
  </div>;
}
