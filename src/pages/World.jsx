import React,{useMemo,useState} from "react";
import {useSearchParams} from "react-router-dom";
import {
  Eye,
  Flag,
  Globe2,
  ShieldCheck,
  Sparkles,
  Trophy,
  UsersRound,
} from "lucide-react";
import {useGame} from "../state/GameStore.js";
import {
  lowerSeriesSeasonSnapshots,
  lowerSeriesWorldSummary,
} from "../domain/lowerSeriesTimeline.js";
import {lowerSeriesMovementLabel} from "../domain/lowerSeriesCareerMovement.js";
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
  return rows(result?.classification).find((row)=>
    Number(row?.position)===1&&String(row?.status||"").toLowerCase()!=="dnf"
  )||null;
}

function prospectFor(snapshot,driverId){
  return snapshot?.prospects?.[String(driverId)]||null;
}

function interestLabel(interest){
  if(!interest)return "—";
  return text(interest?.status).replaceAll("_"," ")||"—";
}

function interestTone(status){
  const key=text(status);
  if(key==="academy_priority")return "border-violet-400/30 bg-violet-500/15 text-violet-200";
  if(key==="priority")return "border-amber-400/30 bg-amber-500/15 text-amber-200";
  if(key==="interested")return "border-sky-400/30 bg-sky-500/15 text-sky-200";
  if(key==="monitoring")return "border-white/10 bg-white/5 text-slate-300";
  return "border-white/10 bg-white/5 text-slate-500";
}

function movementTone(movement){
  const outcome=text(movement?.effective_outcome);
  if(outcome==="promoted")return "border-emerald-400/30 bg-emerald-500/15 text-emerald-200";
  if(outcome==="f1_ready"||movement?.f1_ready)return "border-amber-400/30 bg-amber-500/15 text-amber-200";
  if(outcome==="promotion_pending")return "border-sky-400/30 bg-sky-500/15 text-sky-200";
  if(outcome==="promotion_blocked")return "border-rose-400/30 bg-rose-500/15 text-rose-200";
  return "border-white/10 bg-white/5 text-slate-400";
}

function SummaryCard({icon:Icon,label,value,detail}){
  return <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
      <Icon className="h-4 w-4"/>
      {label}
    </div>
    <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    {detail?<div className="mt-1 text-xs text-slate-500">{detail}</div>:null}
  </div>;
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

  const seasons=useMemo(
    ()=>lowerSeriesSeasonSnapshots(world).slice().reverse(),
    [world]
  );
  const summary=useMemo(()=>lowerSeriesWorldSummary(gs),[gs]);
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

  const entrantCount=(id)=>entries.filter((entry)=>
    String(entry?.series_id||"")===String(id)
  ).length;
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
  const entryByDriver=new Map(seriesEntries.map((entry)=>[driverIdOf(entry),entry]));

  const standing=standingsFor(snapshot,selectedSeriesId);
  const driverStandings=rows(standing?.drivers);
  const events=rows(snapshot?.events)
    .filter((event)=>String(event?.series_id||"")===selectedSeriesId)
    .slice()
    .sort((a,b)=>Number(a?.round||0)-Number(b?.round||0));
  const results=rows(snapshot?.results)
    .filter((result)=>String(result?.series_id||"")===selectedSeriesId);
  const resultByEvent=new Map(results.map((result)=>[String(result?.event_id),result]));
  const completed=events.filter((event)=>
    ["completed","skipped"].includes(String(event?.status))
  ).length;
  const level=num(selectedSeries?.series_level,null);
  const simulated=[2,3,4,5].includes(level);

  return <div className="grid gap-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryCard icon={Flag} label="Season" value={summary.season_year??"—"} detail="Save World"/>
      <SummaryCard icon={Trophy} label="Series" value={summary.series} detail="Active categories"/>
      <SummaryCard icon={UsersRound} label="Drivers" value={summary.drivers} detail="Tracked prospects"/>
      <SummaryCard icon={Sparkles} label="F1 Ready" value={summary.f1_ready} detail="Earned through results"/>
      <SummaryCard icon={Eye} label="F1 Interest" value={summary.f1_interest} detail="Current monitored prospects"/>
    </div>

    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <h2 className="text-xl font-semibold text-white">Lower Series</h2>
      <p className="mt-1 text-sm text-slate-400">Championships, standings, prospect visibility and the route towards Formula 1.</p>
    </div>


      <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-white">Championship browser</h3>
            <p className="mt-1 text-sm text-slate-400">Every played season remains available from the Save-World archive.</p>
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
            <h3 className="font-semibold text-white">Standings & Prospect Status</h3>
            {!simulated?<p className="mt-1 text-xs text-slate-500">This category is tracked structurally but has no active race simulation model.</p>:null}
          </div>

          {driverStandings.length?<div className="overflow-x-auto"><table className="min-w-full text-sm">
            <thead className="bg-white/[0.04] text-slate-400"><tr>
              <th className="px-4 py-2 text-left">Pos</th>
              <th className="px-4 py-2 text-left">Driver</th>
              <th className="px-4 py-2 text-left">Team</th>
              <th className="px-4 py-2 text-right">Wins</th>
              <th className="px-4 py-2 text-right">Podiums</th>
              <th className="px-4 py-2 text-right">Pts</th>
              <th className="px-4 py-2 text-left" title="Public junior-career reputation. Before race evidence it starts from a category-level baseline.">Prospect Rep.</th>
              <th className="px-4 py-2 text-left">F1 Interest</th>
              <th className="px-4 py-2 text-left">Career Path</th>
            </tr></thead>
            <tbody>{driverStandings.map((row)=>{
              const id=String(row.driver_id);
              const entry=entryByDriver.get(id)||{};
              const prospect=prospectFor(snapshot,id);
              const interest=prospect?.best_f1_interest||rows(prospect?.f1_interest)[0]||null;
              const movement=entry?.career_movement||null;
              return <tr key={row.driver_id} className="border-t border-white/10 align-top">
                <td className="px-4 py-3 font-semibold">{row.position}</td>
                <td className="px-4 py-3"><button type="button" data-entity="driver" data-id={row.driver_id} className="font-medium text-slate-100 hover:underline">{row.driver_name||drivers.get(id)?.display_name||row.driver_id}</button></td>
                <td className="px-4 py-3 text-slate-400">{row.team_name||entry?.team_name||"—"}</td>
                <td className="px-4 py-3 text-right">{row.wins||0}</td>
                <td className="px-4 py-3 text-right">{row.podiums||0}</td>
                <td className="px-4 py-3 text-right font-semibold">{row.points||0}</td>
                <td className="px-4 py-3 text-slate-300">
                  {num(prospect?.prospect_reputation,null)===null
                    ?"—"
                    :<span title={num(prospect?.performance?.starts,0)>0
                      ?"Public reputation derived from Lower Series results."
                      :"Initial category baseline; it will move once race results exist."}>
                      {prospect.prospect_reputation}
                      {num(prospect?.performance?.starts,0)===0?<span className="ml-1 text-[9px] uppercase tracking-wide text-slate-600">baseline</span>:null}
                    </span>}
                </td>
                <td className="px-4 py-3">
                  {interest?<span className={"inline-flex rounded-full border px-2 py-1 text-xs capitalize "+interestTone(interest?.status)}>
                    {interestLabel(interest)}
                  </span>:<span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3">
                  {movement?<span className={"inline-flex rounded-full border px-2 py-1 text-xs "+movementTone(movement)}>
                    {lowerSeriesMovementLabel(movement)}
                  </span>:<span className="text-slate-600">—</span>}
                </td>
              </tr>;
            })}</tbody>
          </table></div>:seriesEntries.length?<div className="divide-y divide-white/10">
            {seriesEntries.map((entry)=>{
              const id=driverIdOf(entry);
              const driver=drivers.get(id);
              const prospect=prospectFor(snapshot,id);
              const interest=prospect?.best_f1_interest||rows(prospect?.f1_interest)[0]||null;
              return <div key={id} className="flex flex-col gap-2 px-4 py-3 text-sm md:flex-row md:items-center">
                <button type="button" data-entity="driver" data-id={id} className="font-medium text-slate-100 hover:underline">{driver?.display_name||driver?.name||id}</button>
                <span className="text-slate-500">{entry.team_name||"Team not assigned"}</span>
                <div className="md:ml-auto flex flex-wrap gap-2">
                  {num(prospect?.prospect_reputation,null)!==null?<span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">Prospect Rep. {prospect.prospect_reputation}{num(prospect?.performance?.starts,0)===0?" · baseline":""}</span>:null}
                  {interest?<span className={"rounded-full border px-2 py-1 text-xs capitalize "+interestTone(interest?.status)}>{interestLabel(interest)}</span>:null}
                  {entry?.career_movement?<span className={"rounded-full border px-2 py-1 text-xs "+movementTone(entry.career_movement)}>{lowerSeriesMovementLabel(entry.career_movement)}</span>:null}
                </div>
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
                <td className="px-4 py-2 text-slate-100">
                  {winner?.driver_id?<button type="button" data-entity="driver" data-id={winner.driver_id} className="hover:underline">{winner.driver_name||drivers.get(String(winner.driver_id))?.display_name||winner.driver_id}</button>:winner?.driver_name||"—"}
                </td>
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
          <p className="text-sm text-slate-400">Championships, junior careers and titles across your alternate F1 world.</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={()=>setView("lower-series")}
          className={"flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium "+(view==="lower-series"?"border-sky-400/30 bg-sky-500/15 text-sky-200":"border-white/10 bg-white/5 text-slate-300 hover:bg-white/10")}
        ><ShieldCheck className="h-4 w-4"/> Lower Series</button>
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
