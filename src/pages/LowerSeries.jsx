import React,{useMemo,useState} from "react";
import {Eye,Flag,Sparkles,Trophy,UsersRound} from "lucide-react";
import {useGame} from "../state/GameStore.js";
import {lowerSeriesSeasonSnapshots,lowerSeriesWorldSummary} from "../domain/lowerSeriesTimeline.js";
import {lowerSeriesMovementLabel} from "../domain/lowerSeriesCareerMovement.js";

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

function SummaryCard({icon:Icon,label,value,detail}){
  return <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><Icon className="h-4 w-4"/>{label}</div>
    <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    {detail?<div className="mt-1 text-xs text-slate-500">{detail}</div>:null}
  </div>;
}

function interestLabel(interest){
  return interest?text(interest?.status).replaceAll("_"," ")||"—":"—";
}
function interestTone(status){
  const key=text(status);
  if(key==="academy_priority")return "border-violet-400/30 bg-violet-500/15 text-violet-200";
  if(key==="priority")return "border-amber-400/30 bg-amber-500/15 text-amber-200";
  if(key==="interested")return "border-sky-400/30 bg-sky-500/15 text-sky-200";
  return "border-white/10 bg-white/5 text-slate-300";
}
function movementTone(movement){
  const outcome=text(movement?.effective_outcome);
  if(outcome==="promoted")return "border-emerald-400/30 bg-emerald-500/15 text-emerald-200";
  if(outcome==="f1_ready"||movement?.f1_ready)return "border-amber-400/30 bg-amber-500/15 text-amber-200";
  if(outcome==="promotion_pending")return "border-sky-400/30 bg-sky-500/15 text-sky-200";
  if(outcome==="promotion_blocked")return "border-rose-400/30 bg-rose-500/15 text-rose-200";
  return "border-white/10 bg-white/5 text-slate-400";
}

export default function LowerSeries(){
  const gs=useGame((state)=>state.gameState);
  const world=gs?.lowerSeriesWorld||null;
  const [seasonChoice,setSeasonChoice]=useState(null);
  const [seriesChoice,setSeriesChoice]=useState("");

  const drivers=useMemo(()=>{
    const map=new Map();
    for(const row of [...rows(gs?.dbDrivers),...rows(gs?.drivers)]){
      const id=driverIdOf(row);
      if(id)map.set(id,{...(map.get(id)||{}),...row});
    }
    return map;
  },[gs?.dbDrivers,gs?.drivers]);

  const seasons=useMemo(()=>lowerSeriesSeasonSnapshots(world).slice().reverse(),[world]);
  const summary=useMemo(()=>lowerSeriesWorldSummary(gs),[gs]);

  if(!world){
    return <div className="rounded-xl border border-white/10 bg-[#11141c] p-6 text-slate-300">
      <h1 className="text-xl font-semibold text-white">Lower Series</h1>
      <p className="mt-2 text-sm text-slate-400">This save does not contain a Lower Series world yet. Start a new career on the current game version to initialise it.</p>
    </div>;
  }

  const availableYears=seasons.map((row)=>Number(row.season_year));
  const selectedYear=availableYears.includes(Number(seasonChoice))?Number(seasonChoice):Number(world.season_year);
  const snapshot=seasons.find((row)=>Number(row.season_year)===selectedYear)||world;
  const entries=entryRows(snapshot);
  const series=rows(snapshot?.series).filter((row)=>seriesIdOf(row)).slice().sort((a,b)=>
    (num(a?.series_level,99)-num(b?.series_level,99))||text(a?.series_name).localeCompare(text(b?.series_name))
  );
  const entrantCount=(id)=>entries.filter((entry)=>String(entry?.series_id||"")===String(id)).length;
  const defaultSeries=series.find((row)=>entrantCount(seriesIdOf(row))>0)||series[0]||null;
  const selectedSeries=series.find((row)=>seriesIdOf(row)===seriesChoice)||defaultSeries;
  const selectedSeriesId=seriesIdOf(selectedSeries);
  const seriesEntries=entries.filter((entry)=>String(entry?.series_id||"")===selectedSeriesId);
  const entryByDriver=new Map(seriesEntries.map((entry)=>[driverIdOf(entry),entry]));
  const standing=snapshot?.standings?.[selectedSeriesId]||null;
  const driverStandings=rows(standing?.drivers);

  return <div className="grid gap-4 text-slate-100">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryCard icon={Flag} label="Season" value={summary.season_year??"—"} detail="Save World"/>
      <SummaryCard icon={Trophy} label="Series" value={summary.series} detail="Active categories"/>
      <SummaryCard icon={UsersRound} label="Drivers" value={summary.drivers} detail="Tracked prospects"/>
      <SummaryCard icon={Sparkles} label="F1 Ready" value={summary.f1_ready} detail="Earned through results"/>
      <SummaryCard icon={Eye} label="F1 Interest" value={summary.f1_interest} detail="Current monitored prospects"/>
    </div>

    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <h1 className="text-xl font-semibold text-white">Lower Series</h1>
      <p className="mt-1 text-sm text-slate-400">Championship standings, prospect status and the route towards Formula 1.</p>
      <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-3 lg:flex-row lg:items-end">
        <label className="grid gap-1 text-xs text-slate-500">Season
          <select className="min-w-28 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={selectedYear} onChange={(event)=>{setSeasonChoice(Number(event.target.value));setSeriesChoice("");}}>
            {availableYears.map((year)=><option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500">Championship
          <select className="min-w-64 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={selectedSeriesId} onChange={(event)=>setSeriesChoice(event.target.value)}>
            {series.map((row)=><option key={seriesIdOf(row)} value={seriesIdOf(row)}>{row.series_name||row.short_name||seriesIdOf(row)}</option>)}
          </select>
        </label>
        {selectedSeries?<div className="text-sm text-slate-400 lg:ml-auto">Level <strong className="text-slate-100">{num(selectedSeries?.series_level,"—")}</strong> · Drivers <strong className="text-slate-100">{seriesEntries.length}</strong></div>:null}
      </div>
    </div>

    {!selectedSeries?<div className="rounded-xl border border-white/10 bg-[#11141c] p-6 text-sm text-slate-400">No Lower Series are available for this season.</div>:
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#11141c] shadow-xl">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="font-semibold text-white">Standings & Prospect Status</h2>
        {standing?.champion_driver_id?<p className="mt-1 text-xs text-amber-300">Champion: {drivers.get(String(standing.champion_driver_id))?.display_name||drivers.get(String(standing.champion_driver_id))?.name||standing.champion_driver_id}</p>:null}
      </div>
      {driverStandings.length?<div className="overflow-x-auto"><table className="min-w-full text-sm">
        <thead className="bg-white/[0.04] text-slate-400"><tr>
          <th className="px-4 py-2 text-left">Pos</th>
          <th className="px-4 py-2 text-left">Driver</th>
          <th className="px-4 py-2 text-left">Team</th>
          <th className="px-4 py-2 text-right">Wins</th>
          <th className="px-4 py-2 text-right">Podiums</th>
          <th className="px-4 py-2 text-right">Pts</th>
          <th className="px-4 py-2 text-left">Prospect Rep.</th>
          <th className="px-4 py-2 text-left">F1 Interest</th>
          <th className="px-4 py-2 text-left">Career Path</th>
        </tr></thead>
        <tbody>{driverStandings.map((row)=>{
          const id=String(row.driver_id);
          const entry=entryByDriver.get(id)||{};
          const prospect=snapshot?.prospects?.[id]||null;
          const interest=prospect?.best_f1_interest||rows(prospect?.f1_interest)[0]||null;
          const movement=entry?.career_movement||null;
          return <tr key={id} className="border-t border-white/10 align-top">
            <td className="px-4 py-3 font-semibold">{row.position}</td>
            <td className="px-4 py-3"><button type="button" data-entity="driver" data-id={id} className="font-medium text-slate-100 hover:underline">{row.driver_name||drivers.get(id)?.display_name||drivers.get(id)?.name||id}</button></td>
            <td className="px-4 py-3 text-slate-400">{row.team_name||entry?.team_name||"—"}</td>
            <td className="px-4 py-3 text-right">{row.wins||0}</td>
            <td className="px-4 py-3 text-right">{row.podiums||0}</td>
            <td className="px-4 py-3 text-right font-semibold">{row.points||0}</td>
            <td className="px-4 py-3 text-slate-300">{num(prospect?.prospect_reputation,null)===null?"—":prospect.prospect_reputation}</td>
            <td className="px-4 py-3">{interest?<span className={"inline-flex rounded-full border px-2 py-1 text-xs capitalize "+interestTone(interest?.status)}>{interestLabel(interest)}</span>:<span className="text-slate-600">—</span>}</td>
            <td className="px-4 py-3">{movement?<span className={"inline-flex rounded-full border px-2 py-1 text-xs "+movementTone(movement)}>{lowerSeriesMovementLabel(movement)}</span>:<span className="text-slate-600">—</span>}</td>
          </tr>;
        })}</tbody>
      </table></div>:seriesEntries.length?<div className="divide-y divide-white/10">
        {seriesEntries.slice().sort((a,b)=>{
          const an=text(drivers.get(driverIdOf(a))?.display_name??drivers.get(driverIdOf(a))?.name??driverIdOf(a));
          const bn=text(drivers.get(driverIdOf(b))?.display_name??drivers.get(driverIdOf(b))?.name??driverIdOf(b));
          return an.localeCompare(bn);
        }).map((entry)=>{
          const id=driverIdOf(entry);
          const driver=drivers.get(id);
          const prospect=snapshot?.prospects?.[id]||null;
          const interest=prospect?.best_f1_interest||rows(prospect?.f1_interest)[0]||null;
          const movement=entry?.career_movement||null;
          return <div key={id} className="flex flex-col gap-2 px-4 py-3 text-sm md:flex-row md:items-center">
            <button type="button" data-entity="driver" data-id={id} className="font-medium text-slate-100 hover:underline">{driver?.display_name||driver?.name||id}</button>
            <span className="text-slate-500">{entry?.team_name||"Team not assigned"}</span>
            <div className="flex flex-wrap gap-2 md:ml-auto">
              {num(prospect?.prospect_reputation,null)!==null?<span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">Prospect Rep. {prospect.prospect_reputation}{num(prospect?.performance?.starts,0)===0?" · baseline":""}</span>:null}
              {interest?<span className={"rounded-full border px-2 py-1 text-xs capitalize "+interestTone(interest?.status)}>{interestLabel(interest)}</span>:null}
              {movement?<span className={"rounded-full border px-2 py-1 text-xs "+movementTone(movement)}>{lowerSeriesMovementLabel(movement)}</span>:null}
            </div>
          </div>;
        })}
      </div>:<div className="p-5 text-sm text-slate-500">No drivers are currently assigned to this championship.</div>}
    </div>}
  </div>;
}
