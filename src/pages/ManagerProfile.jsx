// src/pages/ManagerProfile.jsx
import React from "react";
import { Link } from "react-router-dom";
import { UserRound, BriefcaseBusiness, Trophy, Gauge, Info } from "lucide-react";
import { useGame } from "../state/GameStore.js";
import { TeamLogo } from "../components/entity/EntityVisuals.jsx";
import {
  MANAGER_ATTRIBUTES,
  managerAge,
  managerBackground,
  managerDisplayName,
  managerEffectSummary,
  managerExperience,
  managerReputationLabel,
} from "../domain/managerProfile.js";

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));

function initials(name){
  return String(name||"TM").split(/\s+/).map((part)=>part[0]).filter(Boolean).slice(0,2).join("").toUpperCase()||"TM";
}

function ManagerPortrait({manager,name}){
  if(manager?.portrait_data_url){
    return <img src={manager.portrait_data_url} alt={name} className="h-24 w-24 rounded-2xl object-cover border border-white/10 bg-white/5"/>;
  }
  return <div className="h-24 w-24 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center text-2xl font-bold text-slate-200">{initials(name)}</div>;
}

function Metric({label,value,subtle=false}){
  return <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
    <div className={"mt-1 font-semibold "+(subtle?"text-sm text-slate-300":"text-base text-slate-100")}>{value??"—"}</div>
  </div>;
}

function AttributeCard({definition,value}){
  const score=Math.round(clamp(value));
  return <div className="rounded-lg border border-white/10 bg-[#0d1017] p-3">
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-100">{definition.label}</div>
        <div className="mt-1 text-[11px] leading-4 text-slate-500">{definition.description}</div>
      </div>
      <div className="text-xl font-bold tabular-nums text-slate-100">{score}</div>
    </div>
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-slate-200" style={{width:score+"%"}}/>
    </div>
  </div>;
}

function effectText(row){
  if(!row?.active)return "Foundation ready · Race Weekend wiring pending";
  const value=Number(row?.value||0);
  if(row.format==="pp"){
    const pp=Math.round(value*1000)/10;
    return (pp>=0?"+":"")+pp.toFixed(1)+" pp";
  }
  if(row.format==="percent"){
    const pct=Math.round(value*1000)/10;
    return (pct>=0?"+":"")+pct.toFixed(1)+"% positive response";
  }
  if(row.format==="inverse_percent"){
    const pct=Math.round((-value)*1000)/10;
    return (pct>=0?"+":"")+pct.toFixed(1)+"% faster lead time";
  }
  return "—";
}

export default function ManagerProfile(){
  const gameState=useGame((state)=>state.gameState);
  const manager=gameState?.manager||null;

  if(!manager){
    return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] p-4 md:p-6 text-slate-100">
      <div className="mx-auto max-w-3xl rounded-xl border border-white/10 bg-[#12141c] p-6">
        <div className="flex items-center gap-3">
          <UserRound className="h-8 w-8 text-slate-400"/>
          <div>
            <h1 className="text-2xl font-semibold">Team Manager Profile</h1>
            <p className="text-sm text-slate-400">This career was created before player-manager profiles were introduced.</p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-300">
          Existing saves remain compatible and are not assigned invented personal details. New careers create the manager during New Game.
        </p>
        <Link to="/NewGame" className="mt-5 inline-flex rounded-md bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-white">Open New Game</Link>
      </div>
    </div>;
  }

  const name=managerDisplayName(manager);
  const age=managerAge(manager,gameState?.currentDateISO);
  const background=managerBackground(manager.background);
  const experience=managerExperience(manager.experience_level);
  const teamId=String(manager.current_team_id??gameState?.team?.team_id??gameState?.team?.id??"");
  const teamName=manager.current_team_name??gameState?.team?.team_name??gameState?.team?.name??"Unattached";
  const effects=managerEffectSummary(gameState);
  const history=Array.isArray(manager.career_history)?manager.career_history:[];
  const achievements=Array.isArray(manager.achievements)?manager.achievements:[];

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] p-4 md:p-6 text-slate-100 space-y-4">
    <section className="rounded-xl border border-white/10 bg-[#12141c] p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <ManagerPortrait manager={manager} name={name}/>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Team Manager</div>
          <h1 className="mt-1 text-3xl font-semibold">{name}</h1>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-400">
            <span>{manager.nationality_name||"Nationality not set"}</span>
            {age!=null?<span>Age {age}</span>:null}
            <span>{background.label}</span>
            <span>{experience.label}</span>
          </div>
        </div>
        <div className="flex-1"/>
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0d1017] px-4 py-3">
          {teamId?<TeamLogo teamId={teamId} name={teamName} size="h-12 w-12" className="p-1"/>:null}
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Current Team</div>
            <div className="font-semibold">{teamName}</div>
            <div className="text-xs text-slate-500">Team Manager</div>
          </div>
        </div>
      </div>
    </section>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <section className="xl:col-span-8 rounded-xl border border-white/10 bg-[#12141c] overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-slate-400"/>
            <h2 className="text-sm font-semibold uppercase tracking-wide">Manager Attributes</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">Background creates a trade-off profile. Experience adjusts starting level; attributes are intended to evolve through the career.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          {MANAGER_ATTRIBUTES.map((definition)=><AttributeCard key={definition.key} definition={definition} value={manager.attributes?.[definition.key]}/>)}
        </div>
      </section>

      <section className="xl:col-span-4 rounded-xl border border-white/10 bg-[#12141c] overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Career Standing</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 p-4">
          <Metric label="Reputation" value={Math.round(Number(manager.reputation||0))+"/100"}/>
          <Metric label="Level" value={managerReputationLabel(manager.reputation)}/>
          <Metric label="Potential" value={Math.round(Number(manager.potential||0))+"/100"}/>
          <Metric label="Career Start" value={manager.career_start_year||"—"}/>
          <Metric label="Contract Until" value={manager.current_job?.contract_until_year||"—"}/>
          <Metric label="Background" value={background.label} subtle/>
        </div>
      </section>
    </div>

    <section className="rounded-xl border border-white/10 bg-[#12141c] overflow-hidden">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-slate-400"/>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Gameplay Influence</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">These are bounded management modifiers. They never replace driver ability, car performance, specialist staff or facilities.</p>
      </div>
      <div className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
        {effects.map((row)=><div key={row.key} className="rounded-lg border border-white/10 bg-[#0d1017] px-3 py-3">
          <div className="text-xs text-slate-500">{row.label}</div>
          <div className={"mt-1 text-sm font-semibold "+(row.active?"text-slate-100":"text-amber-300")}>{effectText(row)}</div>
        </div>)}
      </div>
    </section>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-white/10 bg-[#12141c] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <BriefcaseBusiness className="h-4 w-4 text-slate-400"/>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Career History</h2>
        </div>
        {history.length?<div className="divide-y divide-white/10">{history.map((job,index)=><div key={(job.team_id||job.team_name||"job")+"_"+index} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{job.team_name||job.team_id||"Team"}</div>
            <div className="text-xs text-slate-500">{job.role||"Team Manager"}</div>
          </div>
          <div className="text-xs text-slate-400">{job.start_year||"—"}–{job.end_year||"Present"}</div>
        </div>)}</div>:<div className="p-4 text-sm text-slate-500">No career history yet.</div>}
      </section>

      <section className="rounded-xl border border-white/10 bg-[#12141c] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Trophy className="h-4 w-4 text-slate-400"/>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Achievements</h2>
        </div>
        {achievements.length?<div className="divide-y divide-white/10">{achievements.map((item,index)=><div key={(item.id||item.title||"achievement")+"_"+index} className="px-4 py-3">
          <div className="font-medium">{item.title||item.name||"Achievement"}</div>
          {item.season?<div className="text-xs text-slate-500">Season {item.season}</div>:null}
        </div>)}</div>:<div className="p-4 text-sm text-slate-500">No major achievements yet. Career honours will be recorded here.</div>}
      </section>
    </div>
  </div>;
}
