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
  const palette=["#dc2626","#0ea5e9","#16a34a","#f59e0b","#8b5cf6","#0f766e","#db2777","#65a30d","#ea580c","#2563eb"];
  let hash=0;
  for(const char of String(teamId||""))hash=(hash*31+char.charCodeAt(0))>>>0;
  return palette[hash%palette.length];
}

function formatGap(car,index){
  if(index===0)return "LEADER";
  const ms=finite(car?.gap_to_leader_ms,null);
  return ms==null?"—":`+${(ms/1000).toFixed(ms>=10000?1:3)}`;
}

function tyreLabel(tyre){
  const compound=String(tyre?.compound||"—").toUpperCase();
  const condition=Number(tyre?.condition);
  return Number.isFinite(condition)?`${compound} ${Math.round(condition)}%`:compound;
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

function viewBoxAround(base,center,zoom=3.4){
  const [x,y,width,height]=base;
  const z=Math.max(1,finite(zoom,1));
  const nextWidth=width/z;
  const nextHeight=height/z;
  const cx=clamp(center?.x??x+width/2,x+nextWidth/2,x+width-nextWidth/2);
  const cy=clamp(center?.y??y+height/2,y+nextHeight/2,y+height-nextHeight/2);
  return [cx-nextWidth/2,cy-nextHeight/2,nextWidth,nextHeight];
}

function TelemetryTile({label,value,accent=""}){
  return <div className="min-w-0 border-r border-white/10 px-3 last:border-r-0">
    <div className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
    <div className={"mt-1 truncate font-mono text-[13px] font-black "+(accent||"text-slate-100")}>{value}</div>
  </div>;
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
    ()=>geometry?trackGeometryViewBox(geometry,{paddingRatio:.075,minPadding:24}):[0,0,1000,600],
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
    ?viewBoxAround(baseViewBox,selectedPose,3.4)
    :baseViewBox;

  const points=geometry?.points||[];
  const polyline=points.length?[...points,points[0]].map((point)=>point.join(",")).join(" "):"";
  const sortedCars=visualCars.slice().sort((a,b)=>finite(a?.position,999)-finite(b?.position,999));
  const selectedBattle=selected?.battle_context&&String(selected.battle_context.state||"")!=="none"
    ?selected.battle_context
    :null;

  const selectAndFollow=(driverId)=>{
    onSelectDriver?.(String(driverId||""));
    setCameraMode("follow");
  };

  const trackState=view?.track_state||{};
  const weather=String(view?.last_weather||"SUNNY").replaceAll("_"," ");
  const rainPct=Math.round(clamp(trackState?.rain_intensity,0,1)*100);
  const wetPct=Math.round(clamp(trackState?.track_wetness,0,1)*100);

  return <div className="flex h-[calc(100vh-145px)] min-h-[650px] flex-col overflow-hidden rounded-lg border border-white/10 bg-[#07090c] text-slate-100">
    <header className="flex h-8 shrink-0 items-center justify-between border-b border-white/10 bg-[#090b0f] px-3 font-mono text-[9px]">
      <div className="flex items-center gap-4 text-slate-400">
        <span className="font-black text-amber-200">{weather}</span>
        <span>RAIN {rainPct}%</span>
        <span>WET {wetPct}%</span>
        <span className="text-slate-600">|</span>
        <span>SESSION RACE</span>
      </div>
      <div className="flex items-center gap-4">
        <span className={playbackRunning?"font-black text-lime-300":"font-black text-amber-300"}>{playbackRunning?"LIVE":"PAUSED"}</span>
        <span className="text-white">LAP {finite(view?.current_lap,1)}/{view?.total_laps??"—"}</span>
        <span className="text-slate-400">{playbackSpeed}×</span>
        <button type="button" onClick={()=>setCameraMode("fit")} className={cameraMode==="fit"?"font-black text-white":"text-slate-500 hover:text-white"}>TRACK</button>
        <button type="button" disabled={!selected} onClick={()=>setCameraMode("follow")} className={cameraMode==="follow"?"font-black text-lime-300":"text-slate-500 hover:text-white disabled:opacity-30"}>FOLLOW</button>
      </div>
    </header>

    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_292px]">
      <main className="relative min-h-0 overflow-hidden bg-[#6b8f35]">
        {geometry?<svg
          className="h-full w-full"
          viewBox={cameraBox.join(" ")}
          preserveAspectRatio="xMidYMid meet"
          aria-label="Live race track"
        >
          <rect x={baseViewBox[0]} y={baseViewBox[1]} width={baseViewBox[2]} height={baseViewBox[3]} fill="#6b8f35"/>
          <polyline points={polyline} fill="none" stroke="#f3f4f6" strokeWidth={asphaltWidthSvg+3.2} strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points={polyline} fill="none" stroke="#4b4e52" strokeWidth={asphaltWidthSvg} strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points={polyline} fill="none" stroke="#62666b" strokeWidth=".8" strokeLinecap="round" strokeLinejoin="round" opacity=".55"/>
          {visualCars.filter((car)=>!car?.retired).map((car)=>{
            const pose=sampleCarPose(geometry,car.track_progress,car.lateral_offset_m,unitsPerMeter);
            if(!pose)return null;
            const active=String(car?.driver_id||"")===String(selectedDriverId||"");
            const inBattle=["side_by_side","yielding"].includes(String(car?.battle_context?.state||""));
            const color=teamColor(car.team_id);
            return <g
              key={String(car?.car_id||car?.driver_id)}
              role="button"
              tabIndex="0"
              transform={`translate(${pose.x} ${pose.y}) rotate(${pose.heading})`}
              onClick={(event)=>{event.stopPropagation();selectAndFollow(car.driver_id);}}
              onKeyDown={(event)=>{
                if(event.key==="Enter"||event.key===" "){
                  event.preventDefault();
                  selectAndFollow(car.driver_id);
                }
              }}
              style={{cursor:"pointer"}}
            >
              {active?<circle r="8.4" fill="rgba(255,255,255,.08)" stroke="#fff" strokeWidth="1.15"/>:null}
              {inBattle?<circle r="10.2" fill="none" stroke="#facc15" strokeWidth=".85" strokeDasharray="2.3 1.7"/>:null}
              <rect x="-4.4" y="-1.45" width="8.8" height="2.9" rx=".75" fill={color} stroke="#111827" strokeWidth=".6"/>
              <rect x="-1.5" y="-.82" width="2.9" height="1.64" rx=".5" fill="#111827"/>
              <rect x="2.25" y="-.95" width="1.55" height="1.9" rx=".45" fill="#d1d5db" opacity=".82"/>
              <circle cx="-2.6" cy="-1.65" r=".62" fill="#111827"/>
              <circle cx="-2.6" cy="1.65" r=".62" fill="#111827"/>
              <circle cx="2.45" cy="-1.65" r=".62" fill="#111827"/>
              <circle cx="2.45" cy="1.65" r=".62" fill="#111827"/>
            </g>;
          })}
        </svg>:<div className="flex h-full items-center justify-center bg-[#1b2418] text-sm text-slate-500">Canonical track geometry unavailable.</div>}

        {selected?<div className="pointer-events-none absolute bottom-3 left-3 rounded border border-white/20 bg-black/65 px-3 py-2 shadow-lg">
          <div className="text-[8px] font-black uppercase tracking-[0.16em] text-lime-300">Follow</div>
          <div className="mt-0.5 text-[12px] font-black text-white">{driverName(drivers,selected.driver_id)}</div>
        </div>:null}
      </main>

      <aside className="min-h-0 overflow-hidden border-l border-white/10 bg-[#0a0d12]">
        <div className="grid h-8 grid-cols-[34px_8px_minmax(0,1fr)_66px_42px] items-center gap-1 border-b border-white/10 bg-[#111722] px-2 text-[7px] font-black uppercase tracking-[0.11em] text-slate-500">
          <span className="text-center">P</span>
          <span></span>
          <span>Driver</span>
          <span className="text-right">Gap</span>
          <span className="text-right">Stop</span>
        </div>
        <div className="h-[calc(100%-2rem)] overflow-y-auto">
          {sortedCars.map((car,index)=>{
            const active=String(car?.driver_id||"")===String(selectedDriverId||"");
            const battle=["side_by_side","yielding"].includes(String(car?.battle_context?.state||""));
            return <button
              key={String(car?.car_id||car?.driver_id)}
              type="button"
              onClick={()=>selectAndFollow(car.driver_id)}
              className={"grid min-h-[31px] w-full grid-cols-[34px_8px_minmax(0,1fr)_66px_42px] items-center gap-1 border-b border-white/[0.055] px-2 text-left transition "+(
                active?"bg-[#273348]":battle?"bg-amber-500/[0.08]":"hover:bg-white/[0.035]"
              )}
            >
              <span className="flex h-6 items-center justify-center bg-[#541c2c] text-[12px] font-black text-amber-200">{finite(car.position,index+1)}</span>
              <span className="h-5" style={{backgroundColor:teamColor(car.team_id)}}></span>
              <span className="truncate text-[11px] font-black uppercase tracking-[0.04em] text-slate-100">{shortName(drivers,car.driver_id)}</span>
              <span className={"text-right font-mono text-[9px] "+(index===0?"font-black text-lime-300":"text-slate-300")}>{formatGap(car,index)}</span>
              <span className="text-right font-mono text-[9px] text-slate-400">{Math.max(0,Math.round(finite(car?.pit_count,0)))}</span>
            </button>;
          })}
        </div>
      </aside>
    </div>

    <footer className="shrink-0 border-t border-white/10 bg-[#080b10]">
      {selected?<div className="grid min-h-[88px] grid-cols-[190px_repeat(7,minmax(0,1fr))] items-stretch">
        <div className="flex min-w-0 flex-col justify-center border-r border-white/10 bg-[#101722] px-4">
          <div className="truncate text-[15px] font-black uppercase tracking-[0.05em] text-white">{driverName(drivers,selected.driver_id)}</div>
          <div className="mt-1 flex items-center gap-3 font-mono text-[9px] text-slate-500">
            <span className="font-black text-lime-300">P{finite(selected.position,0)}</span>
            <span>{selected.team_id||"—"}</span>
          </div>
        </div>
        <TelemetryTile label="Tyre" value={tyreLabel(selected.tyre)} accent="text-cyan-200"/>
        <TelemetryTile label="Tyre temp" value={Number.isFinite(Number(selected?.tyre?.temperature_c))?`${Math.round(Number(selected.tyre.temperature_c))}°C`:"—"}/>
        <TelemetryTile label="Fuel" value={Number.isFinite(Number(selected?.fuel_kg))?`${Number(selected.fuel_kg).toFixed(1)} kg`:"—"}/>
        <TelemetryTile label="Engine" value={Number.isFinite(Number(selected?.engine_temperature))?`${Math.round(Number(selected.engine_temperature))}°C`:"—"}/>
        <TelemetryTile label="Speed" value={`${Math.round(finite(selected.speed_kmh,0))} km/h`} accent="text-white"/>
        <TelemetryTile label="Pace" value={String(selected.current_pace||"—").toUpperCase()} accent={String(selected.current_pace||"").toLowerCase()==="attack"?"text-rose-300":String(selected.current_pace||"").toLowerCase()==="conserve"?"text-sky-300":"text-slate-100"}/>
        <TelemetryTile
          label={selectedBattle?"Battle":"Gap ahead"}
          value={selectedBattle
            ?`${String(selectedBattle.state||"").replaceAll("_"," ").toUpperCase()} ${Number.isFinite(Number(selectedBattle.attempt_probability_pct))?`${Math.round(Number(selectedBattle.attempt_probability_pct))}%`:""}`
            :selected.gap_to_previous_ms==null?"—":`+${(finite(selected.gap_to_previous_ms,0)/1000).toFixed(3)}s`
          }
          accent={selectedBattle?"text-amber-300":"text-slate-100"}
        />
      </div>:<div className="flex h-[88px] items-center justify-center text-[10px] font-mono uppercase tracking-[0.15em] text-slate-600">Select a driver from the timing tower or track</div>}
    </footer>
  </div>;
}
