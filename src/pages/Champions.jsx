import React,{useMemo,useState} from "react";
import {Trophy,Medal,Flag,UsersRound,Gauge,Sparkles} from "lucide-react";
import {useGame} from "../state/GameStore";
import {DriverPortrait,TeamLogo} from "../components/entity/EntityVisuals.jsx";
import {championshipRuleForYear} from "../domain/championshipRules.js";
import {canonicalTeamId,canonicalTeamName} from "../domain/teamIdentity.js";
import {createHistoricalResultTeamResolver} from "../domain/historicalResultTeamResolver.js";

const tabs=[["champions","Champions"],["rules","Rules & Regulations"]];
const rows=(v)=>Array.isArray(v)?v:[];
const yearOf=(r)=>Number(r?.year);
const clean=(v)=>String(v??"").trim();

function pointsLabel(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "—";
  return Number.isInteger(n)?String(n):String(Number(n.toFixed(2)));
}

function countingLabel(rule){
  if(rule?.type==="all")return "All results count";
  if(rule?.type==="none")return "No championship";
  if(rule?.type==="best")return `Best ${rule.count} results count`;
  if(rule?.type==="split"){
    return rule.segments
      .map((segment)=>`Rounds ${segment.from}–${segment.to}: best ${segment.count}`)
      .join(" · ");
  }
  return "—";
}

function sameArray(a,b){
  return JSON.stringify(a||[])===JSON.stringify(b||[]);
}

function sameCounting(a,b){
  return JSON.stringify(a||null)===JSON.stringify(b||null);
}

function ruleChanges(year){
  if(year<=1950)return ["Formula 1 World Championship scoring begins"];
  const now=championshipRuleForYear(year);
  const prev=championshipRuleForYear(year-1);
  const changes=[];

  if(!sameArray(now.racePoints,prev.racePoints)){
    changes.push(`Race scoring changed to ${now.racePoints.join("–")}`);
  }
  if(!sameCounting(now.driverCounting,prev.driverCounting)){
    changes.push(`Driver championship counting changed: ${countingLabel(now.driverCounting)}`);
  }
  if(now.constructorChampionship!==prev.constructorChampionship){
    changes.push(now.constructorChampionship
      ?"Constructors' Championship introduced"
      :"Constructors' Championship removed");
  }
  if(now.constructorChampionship&&(
    now.constructorCarsScoring!==prev.constructorCarsScoring||
    !sameCounting(now.constructorCounting,prev.constructorCounting)
  )){
    changes.push(
      `Constructor scoring changed: ${now.constructorCarsScoring==="best_one"?"only the best car scores":"all eligible cars score"} · ${countingLabel(now.constructorCounting)}`
    );
  }
  if(now.constructorChampionship&&!sameArray(now.constructorRacePoints,prev.constructorRacePoints)){
    changes.push(`Constructor race points changed to ${now.constructorRacePoints.join("–")}`);
  }
  if(now.fastestLap.points!==prev.fastestLap.points||now.fastestLap.eligibility!==prev.fastestLap.eligibility){
    if(now.fastestLap.points){
      changes.push(`Fastest-lap bonus introduced: +${now.fastestLap.points} point${now.fastestLap.points===1?"":"s"} (${now.fastestLap.eligibility.replaceAll("_"," ")})`);
    }else if(prev.fastestLap.points){
      changes.push("Fastest-lap bonus removed");
    }
  }
  if(!sameArray(now.sprintPoints,prev.sprintPoints)){
    changes.push(now.sprintPoints.length
      ?`Sprint scoring introduced/changed: ${now.sprintPoints.join("–")}`
      :"Sprint scoring removed");
  }
  if(now.finalRaceMultiplier!==prev.finalRaceMultiplier){
    changes.push(now.finalRaceMultiplier===1
      ?"Final-round points returned to normal"
      :`Final round awards ×${now.finalRaceMultiplier} points`);
  }
  if(now.sharedDrivePoints!==prev.sharedDrivePoints){
    changes.push(now.sharedDrivePoints==="split"
      ?"Shared-drive points are split between drivers"
      :"Shared-drive championship points rule changed");
  }
  if(now.shortenedRace?.type!==prev.shortenedRace?.type){
    if(now.shortenedRace?.type==="graduated")changes.push("Shortened races move to graduated points bands");
    else if(now.shortenedRace?.type==="half")changes.push("Shortened races may award half points");
    else changes.push("Shortened-race scoring rule changed");
  }
  return changes;
}

function ruleSections(year){
  const rule=championshipRuleForYear(year);
  const constructorText=rule.constructorChampionship
    ?`${rule.constructorCarsScoring==="best_one"?"Only the best car scores per race":"All eligible cars score"} · ${countingLabel(rule.constructorCounting)}`
    :"Not contested";

  const extras=[];
  if(rule.fastestLap.points){
    extras.push(`Fastest lap +${rule.fastestLap.points} (${rule.fastestLap.eligibility.replaceAll("_"," ")})`);
  }
  if(rule.sprintPoints.length)extras.push(`Sprint: ${rule.sprintPoints.join("–")}`);
  if(rule.finalRaceMultiplier!==1)extras.push(`Final race ×${rule.finalRaceMultiplier}`);
  if(rule.sharedDrivePoints==="split")extras.push("Shared-drive points split");
  if(rule.shortenedRace?.type==="graduated")extras.push("Graduated points for shortened races");
  else if(rule.shortenedRace?.type==="half")extras.push("Half points possible for shortened races");

  const constructorRacePoints=!sameArray(rule.constructorRacePoints,rule.racePoints)
    ?` · Constructors: ${rule.constructorRacePoints.join("–")}`
    :"";

  return [
    {icon:Flag,label:"Race scoring",value:`${rule.racePoints.join("–")}${constructorRacePoints}`},
    {icon:UsersRound,label:"Driver championship",value:countingLabel(rule.driverCounting)},
    {icon:Trophy,label:"Constructor championship",value:constructorText},
    {icon:Sparkles,label:"Bonuses & exceptions",value:extras.length?extras.join(" · "):"None"},
  ];
}

function ChampionVisual({type,row,year,driverMap,teamMap,teamResolver}){
  if(type==="driver"){
    if(!row)return <div className="text-sm text-slate-500">No champion recorded</div>;
    const id=clean(row.driver_id??row.id);
    const name=clean(row.driver_name??row.name)||"Unknown driver";
    const driver=driverMap.get(id)||{driver_id:id,display_name:name,driver_name:name};
    const constructorName=canonicalTeamName(clean(row.constructor_name??row.team_name)||"—");
    return (
      <button type="button" data-entity="driver" data-id={id} className="flex min-w-0 items-center gap-3 text-left hover:opacity-90">
        <DriverPortrait driver={{...driver,driver_id:id,display_name:name}} year={year} size="h-11 w-11" className="shrink-0"/>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100 hover:underline">{name}</div>
          <div className="mt-0.5 truncate text-xs text-slate-400">{constructorName}</div>
        </div>
      </button>
    );
  }

  if(!row)return <div className="text-sm text-slate-500">{year<1958?"Championship not contested":"No champion recorded"}</div>;
  const rawId=canonicalTeamId(clean(row.constructor_id??row.team_id??row.id));
  const name=canonicalTeamName(clean(row.constructor_name??row.team_name??row.name)||"Unknown constructor");
  const resolved=teamMap.has(rawId)
    ?{id:rawId,name:canonicalTeamName(teamMap.get(rawId)?.team_name??teamMap.get(rawId)?.name??name),known:true}
    :(teamResolver?.resolve({team_name:name},{fallback:"raw"})||{id:"",name,known:false});
  const id=resolved?.id&&teamMap.has(canonicalTeamId(resolved.id))?canonicalTeamId(resolved.id):"";
  const team=id?teamMap.get(id):null;
  const displayName=canonicalTeamName(clean(team?.team_name??team?.name??resolved?.name)||name);
  const content=(
    <>
      <TeamLogo teamId={id||rawId} name={displayName} year={year} size="h-11 w-11" className="shrink-0 p-1"/>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-100">{displayName}</div>
        {displayName!==name?<div className="mt-0.5 truncate text-xs text-slate-400">{name}</div>:null}
      </div>
    </>
  );
  return id?(
    <button type="button" data-entity="team" data-id={id} className="flex min-w-0 items-center gap-3 text-left hover:opacity-90 hover:underline">
      {content}
    </button>
  ):(
    <div className="flex min-w-0 items-center gap-3 text-left" title="No managerial Team profile is available for this historical constructor">
      {content}
    </div>
  );
}

export default function Champions(){
  const {gameState:gs}=useGame();
  const [tab,setTab]=useState("champions");
  const [showAllRules,setShowAllRules]=useState(false);
  const currentYear=Number(gs?.activeYear)||new Date().getFullYear();
  const sourceSeason=Number(gs?.careerMeta?.sourceSeason);
  const historicalLimit=Number.isFinite(sourceSeason)?sourceSeason-1:currentYear;
  const historical=gs?.dbHistoricalChampionships||{};

  const driverMap=useMemo(()=>{
    const map=new Map();
    for(const driver of [...rows(gs?.dbDrivers),...rows(gs?.drivers)]){
      const id=clean(driver?.driver_id??driver?.id);
      if(id)map.set(id,{...(map.get(id)||{}),...driver});
    }
    return map;
  },[gs?.dbDrivers,gs?.drivers]);

  const teamMap=useMemo(()=>{
    const map=new Map();
    for(const team of [...rows(gs?.dbTeams),...rows(gs?.teams)]){
      const id=canonicalTeamId(clean(team?.team_id??team?.constructor_id??team?.id));
      if(id)map.set(id,{...(map.get(id)||{}),...team,team_id:id,team_name:canonicalTeamName(team?.team_name??team?.name??id)});
    }
    return map;
  },[gs?.dbTeams,gs?.teams]);
  const historicalTeamResolver=useMemo(
    ()=>createHistoricalResultTeamResolver({teams:[...teamMap.values()]}),
    [teamMap]
  );

  const championRows=useMemo(()=>{
    const byYear=new Map();

    for(const row of rows(historical.drivers)){
      const year=yearOf(row);
      if(year>historicalLimit||Number(row?.position)!==1)continue;
      const rec=byYear.get(year)||{year,driver:null,constructor:null,source:"historical"};
      rec.driver=row;
      byYear.set(year,rec);
    }
    for(const row of rows(historical.constructors)){
      const year=yearOf(row);
      if(year>historicalLimit||Number(row?.position)!==1)continue;
      const rec=byYear.get(year)||{year,driver:null,constructor:null,source:"historical"};
      rec.constructor=row;
      byYear.set(year,rec);
    }

    for(const season of rows(gs?.historySeasons)){
      const year=yearOf(season);
      if(!Number.isFinite(year)||year>currentYear)continue;
      const driver=rows(season?.standings?.drivers)
        .slice()
        .sort((a,b)=>Number(a?.position??999)-Number(b?.position??999))[0]||null;
      const constructor=rows(season?.standings?.teams)
        .slice()
        .sort((a,b)=>Number(a?.position??999)-Number(b?.position??999))[0]||null;
      if(!driver&&!constructor)continue;
      byYear.set(year,{
        year,
        driver:driver?{
          ...driver,
          driver_name:driver.driver_name||driver.name,
          constructor_id:driver.constructor_id||driver.team_id,
          constructor_name:driver.constructor_name||driver.team_name||
            clean(teamMap.get(clean(driver.team_id))?.team_name??teamMap.get(clean(driver.team_id))?.name),
        }:null,
        constructor:constructor?{
          ...constructor,
          constructor_id:constructor.constructor_id||constructor.team_id,
          constructor_name:constructor.constructor_name||constructor.team_name||constructor.name||
            clean(teamMap.get(clean(constructor.team_id))?.team_name??teamMap.get(clean(constructor.team_id))?.name),
        }:null,
        source:"save_world",
      });
    }

    return [...byYear.values()].sort((a,b)=>b.year-a.year);
  },[historical.drivers,historical.constructors,historicalLimit,gs?.historySeasons,currentYear,teamMap]);

  const latestChampionYear=championRows[0]?.year??null;
  const allRuleYears=useMemo(
    ()=>Array.from({length:Math.max(0,currentYear-1949)},(_,index)=>1950+index).reverse(),
    [currentYear]
  );
  const changedRuleYears=useMemo(
    ()=>allRuleYears.filter((year)=>year===1950||year===currentYear||ruleChanges(year).length>0),
    [allRuleYears,currentYear]
  );
  const visibleRuleYears=showAllRules?allRuleYears:changedRuleYears;

  return (
    <div className="p-5 space-y-4 text-slate-100">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Champions</h1>
          <p className="text-sm text-slate-400">
            Formula 1 championship archive{latestChampionYear?` · through ${latestChampionYear}`:""}
          </p>
        </div>
        <div className="flex rounded-lg border border-white/10 bg-[#0b0e14] p-1">
          {tabs.map(([id,label])=>(
            <button
              key={id}
              onClick={()=>setTab(id)}
              className={`px-4 py-2 rounded-md text-xs font-semibold transition ${tab===id?"bg-white text-black":"text-slate-300 hover:bg-white/5 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab==="champions"&&(
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b0e14]">
          <div className="grid grid-cols-[88px_minmax(260px,1fr)_92px_minmax(260px,1fr)_92px] items-center gap-4 border-b border-white/10 bg-white/[0.04] px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <div>Year</div>
            <div>Driver Champion</div>
            <div className="text-right">Points</div>
            <div>Constructor Champion</div>
            <div className="text-right">Points</div>
          </div>
          <div className="divide-y divide-white/10">
            {championRows.map((entry)=>(
              <div
                key={entry.year}
                className="grid grid-cols-[88px_minmax(260px,1fr)_92px_minmax(260px,1fr)_92px] items-center gap-4 px-4 py-3.5 transition hover:bg-white/[0.025]"
              >
                <div>
                  <div className="text-lg font-bold text-white">{entry.year}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                    {entry.source==="save_world"?"Career World":"Historical"}
                  </div>
                </div>
                <ChampionVisual type="driver" row={entry.driver} year={entry.year} driverMap={driverMap} teamMap={teamMap} teamResolver={historicalTeamResolver}/>
                <div className="text-right text-lg font-semibold tabular-nums text-slate-100">
                  {pointsLabel(entry.driver?.points)}
                </div>
                <ChampionVisual type="constructor" row={entry.constructor} year={entry.year} driverMap={driverMap} teamMap={teamMap} teamResolver={historicalTeamResolver}/>
                <div className="text-right text-lg font-semibold tabular-nums text-slate-100">
                  {entry.constructor?pointsLabel(entry.constructor?.points):"—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==="rules"&&(
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b0e14] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-white">Championship rule timeline</div>
              <div className="mt-0.5 text-xs text-slate-400">
                Only seasons up to {currentYear} are visible. Changes are highlighted instead of repeating identical rules every year.
              </div>
            </div>
            <div className="flex rounded-lg border border-white/10 bg-black/20 p-1">
              <button
                onClick={()=>setShowAllRules(false)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${!showAllRules?"bg-white text-black":"text-slate-300 hover:text-white"}`}
              >
                Changes only
              </button>
              <button
                onClick={()=>setShowAllRules(true)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${showAllRules?"bg-white text-black":"text-slate-300 hover:text-white"}`}
              >
                All seasons
              </button>
            </div>
          </div>

          {visibleRuleYears.map((year)=>{
            const changes=ruleChanges(year);
            const sections=ruleSections(year);
            const current=year===currentYear;
            return (
              <section key={year} className={`overflow-hidden rounded-xl border ${current?"border-sky-400/40 bg-sky-400/[0.035]":"border-white/10 bg-[#0b0e14]"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="text-xl font-bold text-white">{year}</div>
                    {current?<span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">Current season</span>:null}
                    {changes.length?<span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">{changes.length} change{changes.length===1?"":"s"}</span>:null}
                  </div>
                  {!showAllRules&&year!==1950&&changes.length===0?<span className="text-xs text-slate-500">No changes</span>:null}
                </div>

                <div className="grid gap-px bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
                  {sections.map(({icon:Icon,label,value})=>(
                    <div key={label} className="bg-[#0b0e14] px-4 py-3">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        <Icon size={13}/>{label}
                      </div>
                      <div className="mt-1.5 text-sm leading-5 text-slate-200">{value}</div>
                    </div>
                  ))}
                </div>

                {changes.length?(
                  <div className="px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-amber-300/80">
                      <Gauge size={13}/>What changed
                    </div>
                    <div className="grid gap-1.5 md:grid-cols-2">
                      {changes.map((change,index)=>(
                        <div key={index} className="flex gap-2 text-xs leading-5 text-slate-300">
                          <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300/70"/>
                          <span>{change}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ):null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
