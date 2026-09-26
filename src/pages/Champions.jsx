import React,{useMemo,useState} from "react";
import {useGame} from "../state/GameStore";
import {championshipRuleForYear} from "../domain/championshipRules.js";

const tabs=[["drivers","Driver Champions"],["constructors","Constructor Champions"],["rules","Rules & Regulations"]];
const rows=(v)=>Array.isArray(v)?v:[];
const yearOf=(r)=>Number(r?.year);
const clean=(v)=>String(v??"").trim();

function ruleSummary(year){
  const r=championshipRuleForYear(year);
  const counting=(rule)=>{
    if(rule?.type==="all")return "All results count";
    if(rule?.type==="none")return "No championship";
    if(rule?.type==="best")return `Best ${rule.count} results count`;
    if(rule?.type==="split")return `Split-season discard rule: ${rule.segments.map(s=>`R${s.from}–${s.to}, best ${s.count}`).join(" · ")}`;
    return "—";
  };
  const changes=[];
  changes.push(`Race points: ${r.racePoints.join("–")}`);
  changes.push(`Drivers: ${counting(r.driverCounting)}`);
  if(r.constructorChampionship){
    changes.push(`Constructors: ${r.constructorCarsScoring==="best_one"?"best car only scores per race":"all eligible cars score"}; ${counting(r.constructorCounting)}`);
  }else changes.push("Constructors' Championship not yet introduced");
  if(r.fastestLap.points)changes.push(`Fastest lap: +${r.fastestLap.points} (${r.fastestLap.eligibility.replaceAll("_"," ")})`);
  if(r.sprintPoints.length)changes.push(`Sprint points: ${r.sprintPoints.join("–")}`);
  if(r.finalRaceMultiplier!==1)changes.push(`Final race points ×${r.finalRaceMultiplier}`);
  if(r.sharedDrivePoints==="split")changes.push("Shared-drive points are split between drivers");
  if(r.shortenedRace?.type==="graduated")changes.push("Shortened races use graduated points bands");
  else if(r.shortenedRace?.type==="half")changes.push("Shortened races may award half points");
  return changes;
}

export default function Champions(){
  const {gameState:gs}=useGame();
  const [tab,setTab]=useState("drivers");
  const currentYear=Number(gs?.activeYear)||new Date().getFullYear();
  const historical=gs?.dbHistoricalChampionships||{};

  const driverChampions=useMemo(()=>{
    const out=rows(historical.drivers).filter(r=>yearOf(r)<=currentYear&&Number(r?.position)===1);
    for(const season of rows(gs?.historySeasons)){
      const year=yearOf(season); if(!Number.isFinite(year)||year>currentYear)continue;
      const champion=rows(season?.standings?.drivers).slice().sort((a,b)=>Number(a.position??999)-Number(b.position??999))[0];
      if(champion&&!out.some(r=>yearOf(r)===year))out.push({...champion,year,driver_name:champion.driver_name||champion.name});
    }
    return out.sort((a,b)=>yearOf(b)-yearOf(a));
  },[historical.drivers,gs?.historySeasons,currentYear]);

  const constructorChampions=useMemo(()=>{
    const out=rows(historical.constructors).filter(r=>yearOf(r)<=currentYear&&Number(r?.position)===1);
    for(const season of rows(gs?.historySeasons)){
      const year=yearOf(season); if(!Number.isFinite(year)||year>currentYear)continue;
      const champion=rows(season?.standings?.teams).slice().sort((a,b)=>Number(a.position??999)-Number(b.position??999))[0];
      if(champion&&!out.some(r=>yearOf(r)===year))out.push({...champion,year,constructor_name:champion.constructor_name||champion.team_name||champion.name});
    }
    return out.sort((a,b)=>yearOf(b)-yearOf(a));
  },[historical.constructors,gs?.historySeasons,currentYear]);

  const ruleYears=useMemo(()=>Array.from({length:Math.max(0,currentYear-1949)},(_,i)=>1950+i).reverse(),[currentYear]);

  return <div className="p-5 space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-white">Champions</h1><p className="text-sm text-slate-400">Formula 1 championship archive · through {currentYear}</p></div>
      <div className="flex rounded-lg border border-white/10 bg-[#0b0e14] p-1">
        {tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={`px-3 py-2 rounded-md text-xs font-semibold ${tab===id?"bg-white text-black":"text-slate-300 hover:bg-white/5"}`}>{label}</button>)}
      </div>
    </div>

    {tab==="drivers"&&<div className="rounded-xl border border-white/10 overflow-hidden bg-[#0b0e14]"><table className="w-full text-sm"><thead className="bg-white/5 text-slate-300"><tr><th className="text-left px-4 py-3">Year</th><th className="text-left px-4 py-3">World Champion</th><th className="text-left px-4 py-3">Car / Constructor</th><th className="text-right px-4 py-3">Points</th></tr></thead><tbody>{driverChampions.map(r=><tr key={`${yearOf(r)}-${r.driver_id||r.driver_name}`} className="border-t border-white/10"><td className="px-4 py-3 font-semibold">{yearOf(r)}</td><td className="px-4 py-3">{clean(r.driver_name||r.name)||"—"}</td><td className="px-4 py-3 text-slate-300">{clean(r.constructor_name||r.team_name)||"—"}</td><td className="px-4 py-3 text-right tabular-nums">{r.points??"—"}</td></tr>)}</tbody></table></div>}

    {tab==="constructors"&&<div className="rounded-xl border border-white/10 overflow-hidden bg-[#0b0e14]"><table className="w-full text-sm"><thead className="bg-white/5 text-slate-300"><tr><th className="text-left px-4 py-3">Year</th><th className="text-left px-4 py-3">Constructor Champion</th><th className="text-right px-4 py-3">Points</th></tr></thead><tbody>{constructorChampions.map(r=><tr key={`${yearOf(r)}-${r.constructor_id||r.team_id||r.constructor_name}`} className="border-t border-white/10"><td className="px-4 py-3 font-semibold">{yearOf(r)}</td><td className="px-4 py-3">{clean(r.constructor_name||r.team_name||r.name)||"—"}</td><td className="px-4 py-3 text-right tabular-nums">{r.points??"—"}</td></tr>)}</tbody></table></div>}

    {tab==="rules"&&<div className="space-y-2">{ruleYears.map(year=><div key={year} className="rounded-xl border border-white/10 bg-[#0b0e14] px-4 py-3"><div className="flex gap-4"><div className="w-14 shrink-0 text-lg font-bold text-white">{year}</div><div className="flex flex-wrap gap-2">{ruleSummary(year).map((item,i)=><span key={i} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">{item}</span>)}</div></div></div>)}</div>}
  </div>;
}
