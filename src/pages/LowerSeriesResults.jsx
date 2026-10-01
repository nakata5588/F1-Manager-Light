import React,{useMemo,useState} from "react";
import {useGame} from "../state/GameStore.js";
import {lowerSeriesSeasonSnapshots} from "../domain/lowerSeriesTimeline.js";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const seriesIdOf=(row)=>text(row?.series_id??row?.id);
const driverIdOf=(row)=>text(row?.driver_id??row?.id);

function winnerFor(result){
  return rows(result?.classification).find((row)=>Number(row?.position)===1&&String(row?.status||"").toLowerCase()!=="dnf")||null;
}

export default function LowerSeriesResults(){
  const gs=useGame((state)=>state.gameState);
  const world=gs?.lowerSeriesWorld||null;
  const [seasonChoice,setSeasonChoice]=useState(null);
  const [seriesChoice,setSeriesChoice]=useState("");
  const [eventChoice,setEventChoice]=useState("");

  const drivers=useMemo(()=>{
    const map=new Map();
    for(const row of [...rows(gs?.dbDrivers),...rows(gs?.drivers)]){
      const id=driverIdOf(row);
      if(id)map.set(id,{...(map.get(id)||{}),...row});
    }
    return map;
  },[gs?.dbDrivers,gs?.drivers]);

  const seasons=useMemo(()=>lowerSeriesSeasonSnapshots(world).slice().reverse(),[world]);
  if(!world){
    return <div className="rounded-xl border border-white/10 bg-[#11141c] p-6 text-slate-300">
      <h1 className="text-xl font-semibold">Lower League Results</h1>
      <p className="mt-2 text-sm text-slate-400">This save does not contain a Lower Series world yet.</p>
    </div>;
  }

  const availableYears=seasons.map((row)=>Number(row.season_year));
  const selectedYear=availableYears.includes(Number(seasonChoice))?Number(seasonChoice):Number(world.season_year);
  const snapshot=seasons.find((row)=>Number(row.season_year)===selectedYear)||world;
  const series=rows(snapshot?.series).filter((row)=>seriesIdOf(row)).slice().sort((a,b)=>
    (num(a?.series_level,99)-num(b?.series_level,99))||text(a?.series_name).localeCompare(text(b?.series_name))
  );
  const defaultSeries=series.find((row)=>rows(snapshot?.events).some((event)=>String(event?.series_id)===seriesIdOf(row)))||series[0]||null;
  const selectedSeries=series.find((row)=>seriesIdOf(row)===seriesChoice)||defaultSeries;
  const selectedSeriesId=seriesIdOf(selectedSeries);
  const events=rows(snapshot?.events).filter((event)=>String(event?.series_id||"")===selectedSeriesId).slice().sort((a,b)=>Number(a?.round||0)-Number(b?.round||0));
  const results=rows(snapshot?.results).filter((result)=>String(result?.series_id||"")===selectedSeriesId);
  const resultByEvent=new Map(results.map((result)=>[String(result?.event_id),result]));
  const defaultEvent=[...events].reverse().find((event)=>resultByEvent.has(String(event?.event_id)))||events[0]||null;
  const selectedEvent=events.find((event)=>String(event?.event_id)===eventChoice)||defaultEvent;
  const selectedResult=selectedEvent?resultByEvent.get(String(selectedEvent.event_id))||null:null;
  const classification=rows(selectedResult?.classification).slice().sort((a,b)=>Number(a?.position||999)-Number(b?.position||999));

  return <div className="grid gap-4 text-slate-100">
    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <h1 className="text-xl font-semibold">Lower League Results</h1>
      <p className="mt-1 text-sm text-slate-400">Race results only from the Lower Series Save World. Formula 1 results remain in Season → Results.</p>
      <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-3 lg:flex-row lg:items-end">
        <label className="grid gap-1 text-xs text-slate-500">Season
          <select className="min-w-28 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={selectedYear} onChange={(event)=>{setSeasonChoice(Number(event.target.value));setSeriesChoice("");setEventChoice("");}}>
            {availableYears.map((year)=><option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500">Championship
          <select className="min-w-64 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={selectedSeriesId} onChange={(event)=>{setSeriesChoice(event.target.value);setEventChoice("");}}>
            {series.map((row)=><option key={seriesIdOf(row)} value={seriesIdOf(row)}>{row.series_name||row.short_name||seriesIdOf(row)}</option>)}
          </select>
        </label>
      </div>
    </div>

    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#11141c] shadow-xl">
      <div className="border-b border-white/10 px-4 py-3"><h2 className="font-semibold">Race Calendar</h2></div>
      {events.length?<div className="overflow-x-auto"><table className="min-w-full text-sm">
        <thead className="bg-white/[0.04] text-slate-400"><tr>
          <th className="px-4 py-2 text-left">Round</th>
          <th className="px-4 py-2 text-left">Date</th>
          <th className="px-4 py-2 text-left">Status</th>
          <th className="px-4 py-2 text-left">Winner</th>
          <th className="px-4 py-2 text-right">View</th>
        </tr></thead>
        <tbody>{events.map((event)=>{
          const result=resultByEvent.get(String(event.event_id));
          const winner=winnerFor(result);
          const active=String(selectedEvent?.event_id)===String(event.event_id);
          return <tr key={event.event_id} className={"border-t border-white/10 "+(active?"bg-white/[0.04]":"")}>
            <td className="px-4 py-2">{event.round}</td>
            <td className="px-4 py-2 text-slate-300">{event.event_date||"—"}</td>
            <td className="px-4 py-2 capitalize text-slate-400">{String(event.status||"scheduled").replaceAll("_"," ")}</td>
            <td className="px-4 py-2">{winner?.driver_id?<button type="button" data-entity="driver" data-id={winner.driver_id} className="hover:underline">{winner.driver_name||drivers.get(String(winner.driver_id))?.display_name||winner.driver_id}</button>:"—"}</td>
            <td className="px-4 py-2 text-right"><button type="button" className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs" onClick={()=>setEventChoice(String(event.event_id))}>Results</button></td>
          </tr>;
        })}</tbody>
      </table></div>:<div className="p-5 text-sm text-slate-500">No events are scheduled for this championship.</div>}
    </div>

    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#11141c] shadow-xl">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="font-semibold">{selectedEvent?`Round ${selectedEvent.round} · ${selectedEvent.event_date||"—"}`:"Classification"}</h2>
      </div>
      {classification.length?<div className="overflow-x-auto"><table className="min-w-full text-sm">
        <thead className="bg-white/[0.04] text-slate-400"><tr>
          <th className="px-4 py-2 text-left">Pos</th>
          <th className="px-4 py-2 text-left">Driver</th>
          <th className="px-4 py-2 text-left">Team</th>
          <th className="px-4 py-2 text-right">Grid</th>
          <th className="px-4 py-2 text-left">Status</th>
          <th className="px-4 py-2 text-right">Points</th>
          <th className="px-4 py-2 text-left">Pole</th>
        </tr></thead>
        <tbody>{classification.map((row)=><tr key={String(row.driver_id)+"_"+String(row.position)} className="border-t border-white/10">
          <td className="px-4 py-2 font-semibold">{row.position??"—"}</td>
          <td className="px-4 py-2">{row.driver_id?<button type="button" data-entity="driver" data-id={row.driver_id} className="font-medium hover:underline">{row.driver_name||drivers.get(String(row.driver_id))?.display_name||row.driver_id}</button>:row.driver_name||"—"}</td>
          <td className="px-4 py-2 text-slate-400">{row.team_name||"—"}</td>
          <td className="px-4 py-2 text-right">{row.grid_position??"—"}</td>
          <td className="px-4 py-2 capitalize text-slate-400">{String(row.status||"—").replaceAll("_"," ")}</td>
          <td className="px-4 py-2 text-right">{row.points??0}</td>
          <td className="px-4 py-2">{row.pole?"Yes":"—"}</td>
        </tr>)}</tbody>
      </table></div>:<div className="p-5 text-sm text-slate-500">{selectedEvent&&String(selectedEvent.status)==="skipped"?"This event was skipped.":"No classification is available for this event yet."}</div>}
    </div>
  </div>;
}
