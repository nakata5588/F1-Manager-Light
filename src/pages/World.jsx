import React,{useMemo,useState} from "react";
import {useSearchParams} from "react-router-dom";
import {Globe2,Trophy} from "lucide-react";
import {useGame} from "../state/GameStore.js";
import Champions from "./Champions.jsx";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

function driverIdOf(row){
  return text(row?.driver_id??row?.id);
}

function seriesIdOf(row){
  return text(row?.series_id??row?.id);
}

function entryRows(snapshot){
  if(Array.isArray(snapshot?.entries))return snapshot.entries;
  if(snapshot?.entries&&typeof snapshot.entries==="object")return Object.values(snapshot.entries);
  return [];
}

function standingsFor(snapshot,seriesId){
  const raw=snapshot?.standings?.[seriesId];
  return raw&&typeof raw==="object"?raw:null;
}

function winnerFor(result){
  return rows(result?.classification).find((row)=>Number(row?.position)===1&&row?.status!=="dnf")||null;
}

function seasonSnapshots(world){
  if(!world||typeof world!=="object")return [];
  const all=[
    ...rows(world.history),
    world,
  ].filter((row)=>Number.isInteger(Number(row?.season_year)));
  const byYear=new Map();
  for(const row of all)byYear.set(Number(row.season_year),row);
  return [...byYear.entries()]
    .sort((a,b)=>b[0]-a[0])
    .map(([,row])=>row);
}

function LowerSeriesView(){
  const gs=useGame((state)=>state.gameState);
  const world=gs?.lowerSeriesWorld||null;
  const [seasonChoice,setSeasonChoice]=useState(null);
  const [seriesChoice,setSeriesChoice]=useState("");

  const drivers=useMemo(()=>{
    const merged=new Map();
    for(const row of [...rows(gs?.dbDrivers),...rows(gs?.drivers)]){
      const id=driverIdOf(row);
      if(id)merged.set(id,{...(merged.get(id)||{}),...row});
    }
    return merged;
  },[gs?.dbDrivers,gs?.drivers]);

  const seasons=useMemo(()=>seasonSnapshots(world),[world]);
  if(!world){
    return <div className="rounded-xl border border-white/10 bg-[#11141c] p-6 text-slate-300">
      <h2 className="text-lg font-semibold text-white">Lower Series</h2>
      <p className="mt-2 text-sm text-slate-400">This save does not contain a Lower Series world yet. Start a new career on the current game version to initialise it.</p>
    </div>;
  }

  const availableYears=seasons.map((row)=>Number(row.season_year));
  const selectedYear=availableYears.includes(Number(seasonChoice))
    ?Number(seasonChoice)
    :Number(world.season_year);
  const snapshot=seasons.find((row)=>Number(row.season_year)===selectedYear)||world;
  const entries=entryRows(snapshot);

  const series=rows(snapshot?.series)
    .filter((row)=>seriesIdOf(row))
    .slice()
    .sort((a,b)=>
      (num(a?.series_level,99)-num(b?.series_level,99))||
      text(a?.series_name).localeCompare(text(b?.series_name))
    );

  const entrantCount=(id)=>entries.filter((entry)=>String(entry?.series_id||"")===String(id)).length;
  const defaultSeries=series.find((row)=>entrantCount(seriesIdOf(row))>0)||series[0]||null;
  const selectedSeries=series.find((row)=>seriesIdOf(row)===seriesChoice)||defaultSeries;
  const selectedSeriesId=seriesIdOf(selectedSeries);

  const seriesEntries=entries
    .filter((entry)=>String(entry?.series_id||"")===selectedSeriesId)
    .slice()
    .sort((a,b)=>{
      const an=text(drivers.get(driverIdOf(a))?.display_name??drivers.get(driverIdOf(a))?.name??driverIdOf(a));
      const bn=text(drivers.get(driverIdOf(b))?.display_name??drivers.get(driverIdOf(b))?.name??driverIdOf(b));
      return an.localeCompare(bn);
    });

  const standing=standingsFor(snapshot,selectedSeriesId);
  const driverStandings=rows(standing?.drivers);
  const events=rows(snapshot?.events)
    .filter((event)=>String(event?.series_id||"")===selectedSeriesId)
    .slice()
    .sort((a,b)=>Number(a?.round||0)-Number(b?.round||0));
  const results=rows(snapshot?.results)
    .filter((result)=>String(result?.series_id||"")===selectedSeriesId);
  const resultByEvent=new Map(results.map((result)=>[String(result?.event_id),result]));
  const completed=events.filter((event)=>["completed","skipped"].includes(String(event?.status))).length;
  const level=num(selectedSeries?.series_level,null);
  const simulated=[2,3].includes(level);

  return <div className="grid gap-4">
    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-white">Lower Series</h2>
          <p className="mt-1 text-sm text-slate-400">The live feeder-series world for this career.</p>
        </div>
        <label className="grid gap-1 text-xs text-slate-500">
          Season
          <select
            className="min-w-28 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100"
            value={selectedYear}
            onChange={(event)=>{setSeasonChoice(Number(event.target.value));setSeriesChoice("");}}
          >
            {availableYears.map((year)=><option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500">
          Championship
          <select
            className="min-w-64 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100"
            value={selectedSeriesId}
            onChange={(event)=>setSeriesChoice(event.target.value)}
          >
            {series.map((row)=><option key={seriesIdOf(row)} value={seriesIdOf(row)}>
              {row.series_name||row.short_name||seriesIdOf(row)}
            </option>)}
          </select>
        </label>
      </div>

      {selectedSeries?<div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-3 text-sm">
        <span className="text-slate-400">Level <strong className="text-slate-100">{level??"—"}</strong></span>
        <span className="text-slate-400">Drivers <strong className="text-slate-100">{seriesEntries.length}</strong></span>
        <span className="text-slate-400">Rounds <strong className="text-slate-100">{events.length?completed+"/"+events.length:"—"}</strong></span>
        {standing?.champion_driver_id?<span className="text-slate-400">Champion <strong className="text-amber-300">{drivers.get(String(standing.champion_driver_id))?.display_name||drivers.get(String(standing.champion_driver_id))?.name||standing.champion_driver_id}</strong></span>:null}
      </div>:null}
    </div>

    {!selectedSeries?<div className="rounded-xl border border-white/10 bg-[#11141c] p-6 text-sm text-slate-400">No Lower Series are available for this season.</div>:<>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#11141c] shadow-xl">
        <div className="border-b border-white/10 px-4 py-3">
          <h3 className="font-semibold text-white">Standings</h3>
          {!simulated?<p className="mt-1 text-xs text-slate-500">This level is tracked in the world but is not yet race-simulated.</p>:null}
        </div>

        {driverStandings.length?<div className="overflow-x-auto"><table className="min-w-full text-sm">
          <thead className="bg-white/[0.04] text-slate-400"><tr>
            <th className="px-4 py-2 text-left">Pos</th>
            <th className="px-4 py-2 text-left">Driver</th>
            <th className="px-4 py-2 text-left">Team</th>
            <th className="px-4 py-2 text-right">Wins</th>
            <th className="px-4 py-2 text-right">Podiums</th>
            <th className="px-4 py-2 text-right">Pts</th>
          </tr></thead>
          <tbody>{driverStandings.map((row)=><tr key={row.driver_id} className="border-t border-white/10">
            <td className="px-4 py-2 font-semibold">{row.position}</td>
            <td className="px-4 py-2"><button type="button" data-entity="driver" data-id={row.driver_id} className="font-medium text-slate-100 hover:underline">{row.driver_name||drivers.get(String(row.driver_id))?.display_name||row.driver_id}</button></td>
            <td className="px-4 py-2 text-slate-400">{row.team_name||"—"}</td>
            <td className="px-4 py-2 text-right">{row.wins||0}</td>
            <td className="px-4 py-2 text-right">{row.podiums||0}</td>
            <td className="px-4 py-2 text-right font-semibold">{row.points||0}</td>
          </tr>)}</tbody>
        </table></div>:seriesEntries.length?<div className="divide-y divide-white/10">
          {seriesEntries.map((entry)=>{
            const driver=drivers.get(driverIdOf(entry));
            return <div key={driverIdOf(entry)} className="flex items-center gap-3 px-4 py-3 text-sm">
              <button type="button" data-entity="driver" data-id={driverIdOf(entry)} className="font-medium text-slate-100 hover:underline">{driver?.display_name||driver?.name||driverIdOf(entry)}</button>
              <span className="ml-auto text-slate-500">{entry.team_name||"Team not assigned"}</span>
            </div>;
          })}
        </div>:<div className="p-5 text-sm text-slate-500">No drivers are currently assigned to this championship.</div>}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#11141c] shadow-xl">
        <div className="border-b border-white/10 px-4 py-3"><h3 className="font-semibold text-white">Calendar & Results</h3></div>
        {events.length?<div className="overflow-x-auto"><table className="min-w-full text-sm">
          <thead className="bg-white/[0.04] text-slate-400"><tr>
            <th className="px-4 py-2 text-left">Round</th>
            <th className="px-4 py-2 text-left">Date</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Winner</th>
          </tr></thead>
          <tbody>{events.map((event)=>{
            const result=resultByEvent.get(String(event.event_id));
            const winner=winnerFor(result);
            return <tr key={event.event_id} className="border-t border-white/10">
              <td className="px-4 py-2">{event.round}</td>
              <td className="px-4 py-2 text-slate-300">{event.event_date||"—"}</td>
              <td className="px-4 py-2 capitalize text-slate-400">{String(event.status||"scheduled").replaceAll("_"," ")}</td>
              <td className="px-4 py-2 text-slate-100">{winner?.driver_name||"—"}</td>
            </tr>;
          })}</tbody>
        </table></div>:<div className="p-5 text-sm text-slate-500">{simulated?"No events scheduled.":"Race simulation is not active for this level yet."}</div>}
      </div>
    </>}
  </div>;
}

export default function World(){
  const [params,setParams]=useSearchParams();
  const view=params.get("view")==="champions"?"champions":"lower-series";

  const setView=(next)=>{
    const copy=new URLSearchParams(params);
    if(next==="lower-series")copy.delete("view");
    else copy.set("view",next);
    setParams(copy,{replace:true});
  };

  return <div className="grid gap-4 text-slate-100">
    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <div className="flex items-center gap-3">
        <Globe2 className="h-5 w-5 text-sky-300"/>
        <div>
          <h1 className="text-xl font-semibold">World</h1>
          <p className="text-sm text-slate-400">Championships beyond your Formula 1 team.</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={()=>setView("lower-series")}
          className={"rounded-md border px-3 py-2 text-sm font-medium "+(view==="lower-series"?"border-sky-400/30 bg-sky-500/15 text-sky-200":"border-white/10 bg-white/5 text-slate-300 hover:bg-white/10")}
        >Lower Series</button>
        <button
          type="button"
          onClick={()=>setView("champions")}
          className={"flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium "+(view==="champions"?"border-amber-400/30 bg-amber-500/15 text-amber-200":"border-white/10 bg-white/5 text-slate-300 hover:bg-white/10")}
        ><Trophy className="h-4 w-4"/> Champions</button>
      </div>
    </div>

    {view==="champions"?<Champions/>:<LowerSeriesView/>}
  </div>;
}
