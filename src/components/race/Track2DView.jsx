import React, { useEffect, useMemo, useRef, useState } from "react";
import { Flag, Map, TriangleAlert } from "lucide-react";
import { pointAtTrackProgress, resolveTrackLayout, trackLayoutResolutionLabel, visualTrackProgress } from "../../domain/trackLayout.js";

function scalar(value){
  if(value&&typeof value==="object"&&Object.hasOwn(value,"result"))return value.result;
  return value;
}

function idOf(row){return String(scalar(row?.driver_id??row?.id)??"");}
function teamIdOf(row){return String(scalar(row?.team_id??row?.id)??"");}

function driverName(drivers,id){
  const row=(drivers||[]).find((driver)=>idOf(driver)===String(id));
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

function AnimatedMarker({geometry,progress,color,label,title,mine=false,retired=false}){
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
  const radius=mine?12:8;
  return <g>
    <title>{title}</title>
    <circle cx={point.x} cy={point.y} r={radius+3} fill="rgba(2,6,23,.78)" stroke={mine?"#f8fafc":"rgba(255,255,255,.42)"} strokeWidth={mine?3:1.5}/>
    <circle cx={point.x} cy={point.y} r={radius} fill={retired?"#7f1d1d":color} opacity={retired?0.72:1}/>
    {mine?<text x={point.x} y={point.y+3.5} textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">{label}</text>:null}
    {retired?<path d={`M ${point.x-5} ${point.y-5} L ${point.x+5} ${point.y+5} M ${point.x+5} ${point.y-5} L ${point.x-5} ${point.y+5}`} stroke="#fff" strokeWidth="2"/>:null}
  </g>;
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
}){
  const resolved=useMemo(()=>resolveTrackLayout({trackId,year}),[trackId,year]);
  const layout=resolved.layout;
  const geometry=resolved.geometry;
  const activeRows=(rows||[]).slice().sort((a,b)=>Number(a?.position??999)-Number(b?.position??999));
  const referenceLapMs=activeRows.map((row)=>Number(row?.last_lap_ms||row?.best_lap_ms)).filter((value)=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b)[0]||90000;

  if(!layout){
    return <div className="flex min-h-[300px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20 text-sm text-slate-500">
      <div className="text-center"><Map className="mx-auto mb-2 h-6 w-6"/>No 2D circuit asset is available for this track yet.</div>
    </div>;
  }

  return <section className="overflow-hidden rounded-xl border border-white/10 bg-[#090d13]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Map className="h-4 w-4 text-slate-400"/>
          <h4 className="truncate text-sm font-semibold">{layout.label} · 2D Circuit</h4>
        </div>
        <div className="mt-0.5 text-[10px] text-slate-500">Visual track position is derived from the live timing snapshot; race physics remain engine-owned.</div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className={`rounded border px-2 py-1 ${resolutionTone(resolved.resolution)}`} title={layout.source_label||""}>{trackLayoutResolutionLabel(resolved.resolution)}</span>
        {layout.historical_status!=="verified"?<span className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/[0.07] px-2 py-1 text-amber-200"><TriangleAlert className="h-3 w-3"/>Provisional</span>:null}
        <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-slate-400"><Flag className="h-3 w-3"/>{String(currentControl||"GREEN").replaceAll("_"," ")}</span>
      </div>
    </div>

    <div className="grid xl:grid-cols-[minmax(0,1fr)_240px]">
      <div className="relative min-h-[340px] bg-[radial-gradient(circle_at_center,rgba(51,65,85,.14),transparent_62%)] md:min-h-[430px]">
        {geometry?<svg className="absolute inset-0 h-full w-full p-5" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" aria-label={`${layout.label} circuit and live car positions`}>
          {(()=>{
            const closed=[...geometry.points,geometry.points[0]];
            const polyline=closed.map((point)=>point.join(",")).join(" ");
            return <>
              <polyline points={polyline} fill="none" stroke="#020617" strokeWidth="36" strokeLinejoin="round" strokeLinecap="round" opacity=".95"/>
              <polyline points={polyline} fill="none" stroke="#cbd5e1" strokeWidth="17" strokeLinejoin="round" strokeLinecap="round" opacity=".72"/>
              <polyline points={polyline} fill="none" stroke="#475569" strokeWidth="2" strokeDasharray="8 8" strokeLinejoin="round" strokeLinecap="round" opacity=".7"/>
            </>;
          })()}
          {activeRows.map((row,index)=>{
            const did=String(row?.driver_id||"");
            const tid=String(row?.team_id||"");
            const mine=tid===String(playerTeamId||"");
            const progress=visualTrackProgress(row,{currentLap,currentSector,referenceLapMs,index});
            return <AnimatedMarker
              key={did||index}
              geometry={geometry}
              progress={progress}
              color={markerColor(teamBrands,tid,year)}
              label={shortDriverName(drivers,did)}
              mine={mine}
              retired={Boolean(row?.retired)}
              title={`P${row?.position??index+1} · ${driverName(drivers,did)} · ${teamName(teams,tid)}`}
            />;
          })}
        </svg>:null}
        {!geometry?<div className="absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 text-[10px] text-slate-400">Static layout only · centerline pending</div>:null}
      </div>

      <div className="border-t border-white/10 bg-[#0d121a] p-2 xl:border-l xl:border-t-0">
        <div className="flex items-center justify-between gap-2 px-1 pb-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <span>Track order</span><span>L{Number(currentLap)||0}/{Number(totalLaps)||0}</span>
        </div>
        <div className="max-h-[410px] overflow-y-auto pr-1">
          {activeRows.map((row,index)=>{
            const did=String(row?.driver_id||"");
            const tid=String(row?.team_id||"");
            const mine=tid===String(playerTeamId||"");
            const color=markerColor(teamBrands,tid,year);
            return <div key={did||index} className={`mb-1 flex items-center gap-2 rounded px-2 py-1.5 text-[11px] ${mine?"bg-white/[0.08]":"bg-white/[0.025]"}`}>
              <span className="w-6 shrink-0 text-right font-bold text-slate-300">P{row?.position??index+1}</span>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/40" style={{backgroundColor:row?.retired?"#7f1d1d":color}}/>
              <span className="min-w-0 flex-1 truncate font-medium text-slate-200">{driverName(drivers,did)}</span>
              <span className="font-mono text-[10px] text-slate-500">{index===0?"LEAD":row?.retired?"DNF":`+${(Number(row?.gap_to_leader_ms||0)/1000).toFixed(1)}`}</span>
            </div>;
          })}
          {!activeRows.length?<div className="px-2 py-6 text-center text-xs text-slate-600">Cars appear after the first live timing update.</div>:null}
        </div>
      </div>
    </div>
  </section>;
}
