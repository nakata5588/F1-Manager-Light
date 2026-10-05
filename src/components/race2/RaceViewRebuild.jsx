import React,{useEffect,useMemo,useRef,useState}from "react";
import {pointAtTrackProgress,trackGeometryViewBox} from "../../domain/trackLayout.js";

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const finite=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const wrap=(value,length)=>{
  const safe=Math.max(1,finite(length,1));
  return ((finite(value,0)%safe)+safe)%safe;
};

function driverName(drivers,id){
  const driver=(drivers||[]).find((row)=>String(row?.driver_id??row?.id??"")===String(id??""));
  return driver?.display_name||driver?.name||`${driver?.first_name??""} ${driver?.last_name??""}`.trim()||String(id||"—");
}

function shortName(drivers,id){
  const name=driverName(drivers,id);
  const parts=String(name).trim().split(/\s+/).filter(Boolean);
  return (parts.at(-1)||name||"?").slice(0,3).toUpperCase();
}

function teamColor(teamId){
  const palette=["#f43f5e","#38bdf8","#22c55e","#f59e0b","#a78bfa","#14b8a6","#fb7185","#84cc16","#f97316","#60a5fa"];
  let hash=0;
  for(const char of String(teamId||""))hash=(hash*31+char.charCodeAt(0))>>>0;
  return palette[hash%palette.length];
}

function sampleCarPose(geometry,progress,lateralOffsetM,unitsPerMeter){
  const center=pointAtTrackProgress(geometry,progress);
  const before=pointAtTrackProgress(geometry,progress-.0015);
  const after=pointAtTrackProgress(geometry,progress+.0015);
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

function renderAnchor(anchor,now){
  if(!anchor)return null;
  const elapsedReal=Math.max(0,(now-anchor.realAtMs)/1000);
  const running=anchor.playbackRunning?1:0;
  const canonicalElapsed=elapsedReal*anchor.playbackSpeed*running;
  const decay=Math.exp(-elapsedReal/Math.max(.055,anchor.correctionTauS));
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
  const [display,setDisplay]=useState([]);
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
      const hugeCorrection=Math.abs(correctionAbsolute)>trackLengthM*.25;
      next.set(id,{
        row,
        absoluteDistanceM:canonicalAbsolute,
        lateralOffsetM:canonicalLateral,
        speedMs:Math.max(0,finite(row?.speed_ms,finite(row?.speed_kmh,0)/3.6)),
        realAtMs:now,
        playbackRunning:Boolean(playbackRunning),
        playbackSpeed:Math.max(.05,finite(playbackSpeed,1)),
        correctionTauS:playbackSpeed>=8?.085:.14,
        absoluteCorrectionM:hugeCorrection?0:correctionAbsolute,
        lateralCorrectionM:hugeCorrection?0:correctionLateral,
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
        const visual={
          ...anchor.row,
          id,
          absolute_distance_m:rendered.absoluteDistanceM,
          distance_along_lap_m:distanceAlongLapM,
          track_progress:distanceAlongLapM/trackLengthM,
          lateral_offset_m:rendered.lateralOffsetM,
        };
        nextRows.push(visual);
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

function viewBoxAround(base,center,zoom=3.2){
  const [x,y,width,height]=base;
  const z=Math.max(1,finite(zoom,1));
  const nextWidth=width/z;
  const nextHeight=height/z;
  const cx=clamp(center?.x??x+width/2,x+nextWidth/2,x+width-nextWidth/2);
  const cy=clamp(center?.y??y+height/2,y+nextHeight/2,y+height-nextHeight/2);
  return [cx-nextWidth/2,cy-nextHeight/2,nextWidth,nextHeight];
}

export default function RaceViewRebuild({
  view,
  drivers=[],
  selectedDriverId="",
  onSelectDriver,
  playbackRunning=false,
  playbackSpeed=1,
}){
  const trackLengthM=Math.max(1,finite(view?.track_length_m,1));
  const geometry=useMemo(()=>{
    const points=Array.isArray(view?.track_geometry?.points)?view.track_geometry.points:[];
    return points.length>=3?{points}:null;
  },[view?.track_geometry]);
  const baseViewBox=useMemo(
    ()=>geometry?trackGeometryViewBox(geometry,{paddingRatio:.07,minPadding:22}):[0,0,1000,600],
    [geometry]
  );
  const visualCars=useContinuousCars(view,{playbackRunning,playbackSpeed});
  const [cameraMode,setCameraMode]=useState("fit");
  const selected=visualCars.find((car)=>String(car?.driver_id||"")===String(selectedDriverId||""))||null;

  const physicalWidthM=Math.max(
    7,
    finite(
      view?.track_width?.usableRaceWidthM,
      finite(view?.track_width?.physicalWidthM,12.5)
    )
  );
  const asphaltWidthSvg=16;
  const unitsPerMeter=asphaltWidthSvg/physicalWidthM;

  const selectedPose=selected&&geometry
    ?sampleCarPose(geometry,selected.track_progress,selected.lateral_offset_m,unitsPerMeter)
    :null;
  const cameraBox=cameraMode==="follow"&&selectedPose
    ?viewBoxAround(baseViewBox,selectedPose,3.2)
    :baseViewBox;

  const points=geometry?.points||[];
  const polyline=points.length?[...points,points[0]].map((point)=>point.join(",")).join(" "):"";
  const sortedCars=visualCars.slice().sort((a,b)=>finite(a?.position,999)-finite(b?.position,999));

  const selectAndFollow=(driverId)=>{
    onSelectDriver?.(String(driverId||""));
    setCameraMode("follow");
  };

  return <div className="grid h-[calc(100vh-145px)] min-h-[650px] overflow-hidden rounded-lg border border-white/10 bg-[#080d13] lg:grid-cols-[270px_minmax(0,1fr)_270px]">
    <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-[#070b10]">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#070b10]/95 px-3 py-3 backdrop-blur">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">Race View Rebuild</div>
        <div className="mt-1 text-[9px] text-slate-500">Canonical state only · no legacy renderer</div>
      </div>
      {sortedCars.map((car)=>{
        const active=String(car?.driver_id||"")===String(selectedDriverId||"");
        return <button
          key={String(car?.car_id||car?.driver_id)}
          type="button"
          onClick={()=>selectAndFollow(car.driver_id)}
          className={"grid w-full grid-cols-[32px_minmax(0,1fr)_58px] items-center gap-2 border-b border-white/[0.05] px-3 py-2 text-left "+(active?"bg-cyan-400/[0.14]":"hover:bg-white/[0.04]")}
        >
          <strong className="text-right text-[12px] text-white">P{finite(car.position,0)}</strong>
          <span className="truncate text-[11px] font-black text-slate-200">{shortName(drivers,car.driver_id)}</span>
          <span className="text-right font-mono text-[9px] text-slate-400">{Math.round(finite(car.speed_kmh,0))} km/h</span>
        </button>;
      })}
    </aside>

    <main className="relative min-h-0 overflow-hidden bg-[#1c2b1d]">
      <div className="absolute left-3 top-3 z-20 flex gap-2">
        <span className="rounded border border-white/10 bg-black/55 px-2 py-1 text-[9px] font-black text-slate-200">
          {playbackRunning?`${playbackSpeed}× LIVE`:"PAUSED"}
        </span>
        <span className="rounded border border-white/10 bg-black/55 px-2 py-1 text-[9px] font-black text-slate-300">
          LAP {finite(view?.current_lap,1)}/{view?.total_laps??"—"}
        </span>
      </div>
      <div className="absolute right-3 top-3 z-20 flex gap-1 rounded border border-white/10 bg-black/55 p-1">
        <button type="button" onClick={()=>setCameraMode("fit")} className={"rounded px-2 py-1 text-[9px] font-black "+(cameraMode==="fit"?"bg-white text-black":"text-slate-300")}>FIT</button>
        <button type="button" disabled={!selected} onClick={()=>setCameraMode("follow")} className={"rounded px-2 py-1 text-[9px] font-black "+(cameraMode==="follow"?"bg-cyan-300 text-black":"text-slate-300 disabled:opacity-30")}>FOLLOW</button>
      </div>

      {geometry?<svg
        className="h-full w-full"
        viewBox={cameraBox.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Race View rebuild track"
      >
        <rect x={baseViewBox[0]} y={baseViewBox[1]} width={baseViewBox[2]} height={baseViewBox[3]} fill="#1c2b1d"/>
        <polyline points={polyline} fill="none" stroke="#e5e7eb" strokeWidth={asphaltWidthSvg+2.5} strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points={polyline} fill="none" stroke="#242a30" strokeWidth={asphaltWidthSvg} strokeLinecap="round" strokeLinejoin="round"/>
        {visualCars.filter((car)=>!car?.retired).map((car)=>{
          const pose=sampleCarPose(geometry,car.track_progress,car.lateral_offset_m,unitsPerMeter);
          if(!pose)return null;
          const active=String(car?.driver_id||"")===String(selectedDriverId||"");
          const inBattle=["side_by_side","yielding"].includes(String(car?.battle_context?.state||""));
          return <g
            key={String(car?.car_id||car?.driver_id)}
            role="button"
            tabIndex="0"
            transform={`translate(${pose.x} ${pose.y}) rotate(${pose.heading})`}
            onClick={(event)=>{event.stopPropagation();selectAndFollow(car.driver_id);}}
            style={{cursor:"pointer"}}
          >
            {active?<circle r="6.3" fill="none" stroke="#67e8f9" strokeWidth="1.1"/>:null}
            {inBattle?<circle r="7.6" fill="none" stroke="#fbbf24" strokeWidth=".8" strokeDasharray="2 1.5"/>:null}
            <rect x="-3.4" y="-1.35" width="6.8" height="2.7" rx=".7" fill={teamColor(car.team_id)} stroke="#020617" strokeWidth=".55"/>
            <circle cx="-1.8" cy="-1.5" r=".55" fill="#020617"/>
            <circle cx="-1.8" cy="1.5" r=".55" fill="#020617"/>
            <circle cx="1.8" cy="-1.5" r=".55" fill="#020617"/>
            <circle cx="1.8" cy="1.5" r=".55" fill="#020617"/>
          </g>;
        })}
      </svg>:<div className="flex h-full items-center justify-center text-sm text-slate-500">Canonical track geometry unavailable.</div>}
    </main>

    <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-[#070b10] p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-300">Selected driver</div>
      {selected?<div className="mt-3 space-y-2">
        <div className="text-lg font-black text-white">{driverName(drivers,selected.driver_id)}</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-[8px] uppercase text-slate-500">Position</div><strong className="text-lg text-white">P{finite(selected.position,0)}</strong></div>
          <div className="rounded border border-white/10 bg-white/[0.03] p-2"><div className="text-[8px] uppercase text-slate-500">Speed</div><strong className="text-lg text-white">{Math.round(finite(selected.speed_kmh,0))}</strong><span className="ml-1 text-[9px] text-slate-500">km/h</span></div>
        </div>
        <div className="rounded border border-white/10 bg-white/[0.03] p-2 text-[10px] text-slate-300">
          <div className="flex justify-between"><span className="text-slate-500">Gap ahead</span><span>{selected.gap_to_previous_ms==null?"—":`+${(finite(selected.gap_to_previous_ms,0)/1000).toFixed(3)}s`}</span></div>
          <div className="mt-1 flex justify-between"><span className="text-slate-500">Pace</span><span>{String(selected.current_pace||"—").toUpperCase()}</span></div>
          <div className="mt-1 flex justify-between"><span className="text-slate-500">Tyre</span><span>{selected?.tyre?.compound||"—"} · {Number.isFinite(Number(selected?.tyre?.condition))?`${Math.round(Number(selected.tyre.condition))}%`:"—"}</span></div>
        </div>
        {selected?.battle_context&&String(selected.battle_context.state||"")!=="none"?<div className="rounded border border-amber-400/30 bg-amber-500/[0.08] p-3">
          <div className="text-[9px] font-black uppercase tracking-[0.14em] text-amber-300">Battle</div>
          <div className="mt-1 text-sm font-black text-amber-50">{String(selected.battle_context.state||"").replaceAll("_"," ").toUpperCase()}</div>
          <div className="mt-1 text-[10px] text-slate-300">Probability {Number.isFinite(Number(selected.battle_context.attempt_probability_pct))?`${Math.round(Number(selected.battle_context.attempt_probability_pct))}%`:"—"}</div>
        </div>:null}
        <div className="rounded border border-sky-400/20 bg-sky-500/[0.05] p-2 text-[9px] leading-relaxed text-sky-100/70">
          Weather graphics, minimap, historical car sprites and Battle overlays are intentionally disabled in this rebuild baseline.
        </div>
      </div>:<div className="mt-3 text-[10px] text-slate-500">Select a car or driver.</div>}
    </aside>
  </div>;
}
