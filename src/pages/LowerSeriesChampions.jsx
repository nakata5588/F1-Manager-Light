import React,{useMemo,useState} from "react";
import {useGame} from "../state/GameStore.js";
import {lowerSeriesSeasonSnapshots} from "../domain/lowerSeriesTimeline.js";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const driverIdOf=(row)=>text(row?.driver_id??row?.id);
const seriesIdOf=(row)=>text(row?.series_id??row?.id);
const entryRows=(snapshot)=>Array.isArray(snapshot?.entries)?snapshot.entries:
  (snapshot?.entries&&typeof snapshot.entries==="object"?Object.values(snapshot.entries):[]);

export default function LowerSeriesChampions(){
  const gs=useGame((state)=>state.gameState);
  const world=gs?.lowerSeriesWorld||null;
  const [seriesFilter,setSeriesFilter]=useState("ALL");

  const drivers=useMemo(()=>{
    const map=new Map();
    for(const row of [...rows(gs?.dbDrivers),...rows(gs?.drivers)]){
      const id=driverIdOf(row);
      if(id)map.set(id,{...(map.get(id)||{}),...row});
    }
    return map;
  },[gs?.dbDrivers,gs?.drivers]);

  const snapshots=useMemo(()=>lowerSeriesSeasonSnapshots(world).slice().reverse(),[world]);
  const champions=useMemo(()=>snapshots.flatMap((snapshot)=>{
    const entries=entryRows(snapshot);
    return rows(snapshot?.series).map((series)=>{
      const id=seriesIdOf(series);
      const standing=snapshot?.standings?.[id]||null;
      const championId=text(standing?.champion_driver_id);
      if(!standing?.complete||!championId)return null;
      const driverRow=rows(standing?.drivers).find((row)=>driverIdOf(row)===championId)||null;
      const teamId=text(standing?.champion_team_id);
      const teamRow=rows(standing?.teams).find((row)=>text(row?.lower_team_id??row?.team_id??row?.id)===teamId)||null;
      const entry=entries.find((row)=>String(row?.series_id||"")===id&&driverIdOf(row)===championId)||null;
      return {
        year:Number(snapshot?.season_year),
        series_id:id,
        series_name:text(series?.series_name??series?.short_name)||id,
        series_level:num(series?.series_level,99),
        driver_id:championId,
        driver_name:text(driverRow?.driver_name)||text(drivers.get(championId)?.display_name??drivers.get(championId)?.name)||championId,
        team_name:text(teamRow?.team_name??driverRow?.team_name??entry?.team_name)||"—",
        wins:num(driverRow?.wins,0),
        points:num(driverRow?.points,0),
      };
    }).filter(Boolean);
  }),[snapshots,drivers]);

  const seriesOptions=useMemo(()=>{
    const map=new Map();
    for(const row of champions)if(!map.has(row.series_id))map.set(row.series_id,row.series_name);
    return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  },[champions]);
  const filtered=seriesFilter==="ALL"?champions:champions.filter((row)=>row.series_id===seriesFilter);

  if(!world){
    return <div className="rounded-xl border border-white/10 bg-[#11141c] p-6 text-slate-300">
      <h1 className="text-xl font-semibold">Lower League Champions</h1>
      <p className="mt-2 text-sm text-slate-400">This save does not contain a Lower Series world yet.</p>
    </div>;
  }

  return <div className="grid gap-4 text-slate-100">
    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <h1 className="text-xl font-semibold">Lower League Champions</h1>
      <p className="mt-1 text-sm text-slate-400">Champions from completed Lower Series seasons only. Formula 1 champions remain in Season → Champions.</p>
      <div className="mt-4 border-t border-white/10 pt-3">
        <select value={seriesFilter} onChange={(event)=>setSeriesFilter(event.target.value)} className="min-w-64 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100">
          <option value="ALL">All championships</option>
          {seriesOptions.map(([id,name])=><option key={id} value={id}>{name}</option>)}
        </select>
      </div>
    </div>

    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#11141c] shadow-xl">
      {filtered.length?<div className="overflow-x-auto"><table className="min-w-full text-sm">
        <thead className="bg-white/[0.04] text-slate-400"><tr>
          <th className="px-4 py-3 text-left">Season</th>
          <th className="px-4 py-3 text-left">Championship</th>
          <th className="px-4 py-3 text-left">Champion</th>
          <th className="px-4 py-3 text-left">Team</th>
          <th className="px-4 py-3 text-right">Wins</th>
          <th className="px-4 py-3 text-right">Points</th>
        </tr></thead>
        <tbody>{filtered.map((row)=><tr key={row.year+"_"+row.series_id} className="border-t border-white/10">
          <td className="px-4 py-3 font-semibold">{row.year}</td>
          <td className="px-4 py-3"><div className="font-medium">{row.series_name}</div><div className="text-xs text-slate-500">Level {row.series_level}</div></td>
          <td className="px-4 py-3"><button type="button" data-entity="driver" data-id={row.driver_id} className="font-medium hover:underline">{row.driver_name}</button></td>
          <td className="px-4 py-3 text-slate-400">{row.team_name}</td>
          <td className="px-4 py-3 text-right">{row.wins}</td>
          <td className="px-4 py-3 text-right">{row.points}</td>
        </tr>)}</tbody>
      </table></div>:<div className="p-6 text-sm text-slate-500">No completed Lower Series championships are stored in this save yet.</div>}
    </div>
  </div>;
}
