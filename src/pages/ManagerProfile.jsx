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
import { managerEmploymentAssessment } from "../domain/managerEmployment.js";
import { managerJobApplications, managerJobOpportunities } from "../domain/managerJobMarket.js";
import { acceptManagerJobOffer, submitManagerJobApplication } from "../engine/ManagerCareerEngine.js";

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

function signedDelta(value,{digits=0}={}){
  const n=Number(value||0);
  if(!Number.isFinite(n)||Math.abs(n)<0.0001)return null;
  return (n>0?"+":"")+n.toFixed(digits);
}

function DevelopmentEvent({event}){
  const attributeChanges=Array.isArray(event?.attribute_changes)?event.attribute_changes:[];
  const reputationDelta=signedDelta(event?.reputation_delta,{digits:2});
  return <div className="px-4 py-3">
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-slate-100">{event?.title||"Career development"}</div>
        {event?.reason?<div className="mt-0.5 text-xs leading-5 text-slate-500">{event.reason}</div>:null}
      </div>
      {event?.date?<div className="text-xs tabular-nums text-slate-500">{event.date}</div>:null}
    </div>
    {(attributeChanges.length||reputationDelta)?<div className="mt-2 flex flex-wrap gap-1.5">
      {attributeChanges.map((change,index)=>{
        const definition=MANAGER_ATTRIBUTES.find((row)=>row.key===change?.key);
        const delta=signedDelta(change?.delta);
        return delta?<span key={(change?.key||"attr")+"_"+index} className={"rounded-md border px-2 py-1 text-[11px] "+(Number(change?.delta)>=0?"border-emerald-400/20 bg-emerald-400/10 text-emerald-200":"border-rose-400/20 bg-rose-400/10 text-rose-200")}>
          {(definition?.shortLabel||String(change?.key||"Attribute").replaceAll("_"," "))+" "+delta}
        </span>:null;
      })}
      {reputationDelta?<span className={"rounded-md border px-2 py-1 text-[11px] "+(Number(event?.reputation_delta)>=0?"border-sky-400/20 bg-sky-400/10 text-sky-200":"border-amber-400/20 bg-amber-400/10 text-amber-200")}>
        Reputation {reputationDelta}
      </span>:null}
      {Number.isFinite(Number(event?.level))?<span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300">Level {Number(event.level)}</span>:null}
    </div>:null}
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
  const setGameState=useGame((state)=>state.setGameState);
  const manager=gameState?.manager||null;

  if(!manager){
    return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] p-4 md:p-6 text-slate-100">
      <div className="mx-auto max-w-3xl rounded-xl border border-white/10 bg-[#12141c] p-6">
        <div className="flex items-center gap-3">
          <UserRound className="h-8 w-8 text-slate-400"/>
          <div>
            <h1 className="text-2xl font-semibold">Team Principal Profile</h1>
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
  const development=manager.development||{};
  const developmentHistory=Array.isArray(development.history)?development.history:[];
  const employment=managerEmploymentAssessment(gameState);
  const unemployed=employment.status==="unemployed";
  const opportunities=unemployed?managerJobOpportunities(gameState):[];
  const applications=managerJobApplications(gameState)
    .slice()
    .sort((a,b)=>String(b?.resolved_at||b?.submitted_at||"").localeCompare(String(a?.resolved_at||a?.submitted_at||"")));
  const activeApplicationByTeam=new Map();
  for(const row of applications){
    if(["submitted","offer"].includes(String(row?.status||"").toLowerCase())&&!activeApplicationByTeam.has(String(row?.team_id))){
      activeApplicationByTeam.set(String(row.team_id),row);
    }
  }

  const applyForJob=(teamId)=>{
    setGameState(submitManagerJobApplication(gameState,teamId));
  };
  const acceptOffer=(applicationId)=>{
    setGameState(acceptManagerJobOffer(gameState,applicationId));
  };

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] p-4 md:p-6 text-slate-100 space-y-4">
    <section className="rounded-xl border border-white/10 bg-[#12141c] p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <ManagerPortrait manager={manager} name={name}/>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Team Principal</div>
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
            <div className="text-xs text-slate-500">Team Principal</div>
          </div>
        </div>
      </div>
    </section>

    {unemployed?<section className="rounded-xl border border-amber-400/20 bg-[#12141c] overflow-hidden">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-200">Team Principal Job Market</h2>
            <p className="mt-1 text-xs text-slate-400">Your Save World continues while you are unattached. Apply to teams with a vacancy or a Board willing to replace its current Team Principal.</p>
          </div>
          <div className="flex-1"/>
          <div className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-100">
            Reputation {Math.round(Number(manager.reputation||0))}/100
          </div>
        </div>
      </div>

      {applications.some((row)=>["submitted","offer"].includes(String(row?.status||"").toLowerCase()))?<div className="border-b border-white/10 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Active applications</div>
        <div className="grid gap-2 md:grid-cols-2">
          {applications.filter((row)=>["submitted","offer"].includes(String(row?.status||"").toLowerCase())).map((row)=><div key={row.id} className="rounded-lg border border-white/10 bg-[#0d1017] p-3">
            <div className="flex items-start gap-3">
              <TeamLogo teamId={row.team_id} name={row.team_name} size="h-9 w-9" className="p-0.5"/>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{row.team_name}</div>
                <div className="text-xs text-slate-500">
                  {row.status==="offer"
                    ?("Offer · "+Number(row.offer?.contract_years||2)+" years")
                    :("Application submitted · response "+(row.response_date||"pending"))}
                </div>
              </div>
              {row.status==="offer"?<button type="button" onClick={()=>acceptOffer(row.id)} className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400">Accept offer</button>:null}
            </div>
          </div>)}
        </div>
      </div>:null}

      <div className="grid gap-3 p-4 lg:grid-cols-2">
        {opportunities.map((row)=>{
          const active=activeApplicationByTeam.get(String(row.team_id));
          return <div key={row.team_id} className={"rounded-lg border p-3 "+(row.available?"border-white/10 bg-[#0d1017]":"border-white/5 bg-black/10 opacity-70")}>
            <div className="flex items-start gap-3">
              <TeamLogo teamId={row.team_id} name={row.team_name} size="h-11 w-11" className="p-0.5"/>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{row.team_name}</div>
                <div className="mt-0.5 text-xs text-slate-500">Board interest {row.interest}% · Team reputation {Math.round(row.team_reputation)}</div>
                <div className="mt-2 text-xs text-slate-400">
                  {row.vacancy
                    ?"Team Principal vacancy"
                    :row.incumbent
                      ?("Current TP: "+(row.incumbent.staff_name||row.incumbent.staff_id)+" · "+Math.round(row.incumbent.market_score))
                      :"No incumbent recorded"}
                </div>
                <div className="mt-1 text-xs text-slate-500">{row.reason}</div>
              </div>
              <div className="shrink-0">
                {active
                  ?<span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">{active.status==="offer"?"Offer received":"Applied"}</span>
                  :row.available
                    ?<button type="button" onClick={()=>applyForJob(row.team_id)} className="rounded-md border border-sky-400/30 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25">Apply</button>
                    :<span className="text-xs text-slate-600">Unavailable</span>}
              </div>
            </div>
          </div>;
        })}
        {!opportunities.length?<div className="rounded-lg border border-white/10 bg-[#0d1017] p-4 text-sm text-slate-400">No active F1 Team Principal opportunities are currently visible.</div>:null}
      </div>

      {applications.some((row)=>!["submitted","offer"].includes(String(row?.status||"").toLowerCase()))?<details className="border-t border-white/10 p-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">Application history</summary>
        <div className="mt-3 grid gap-2">
          {applications.filter((row)=>!["submitted","offer"].includes(String(row?.status||"").toLowerCase())).slice(0,12).map((row)=><div key={row.id} className="flex items-center gap-3 rounded-lg bg-white/[0.025] px-3 py-2 text-sm">
            <span className="flex-1">{row.team_name}</span>
            <span className="text-xs text-slate-500">{String(row.status||"").replaceAll("_"," ")}</span>
          </div>)}
        </div>
      </details>:null}
    </section>:null}

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
          <Metric label="Standing" value={managerReputationLabel(manager.reputation)}/>
          <Metric label="Career Level" value={Math.max(1,Number(development.level||1))}/>
          <Metric label="XP" value={Math.max(0,Number(development.xp||0))}/>
          <Metric label="Potential" value={Math.round(Number(manager.potential||0))+"/100"}/>
          <Metric label="Races Managed" value={Math.max(0,Number(development.races_managed||0))}/>
          <Metric label="Wins" value={Math.max(0,Number(development.wins||0))}/>
          <Metric label="Podiums" value={Math.max(0,Number(development.podiums||0))}/>
          <Metric label="Career Start" value={manager.career_start_year||"—"}/>
          <Metric label="Contract Until" value={manager.current_job?.contract_until_year||"—"}/>
          <Metric label="Job Security" value={employment.jobSecurity==null?"—":employment.jobSecurity+"%"}/>
          <Metric label="Board Status" value={employment.label}/>
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

    <section className="rounded-xl border border-white/10 bg-[#12141c] overflow-hidden">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-slate-400"/>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Development History</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">Permanent skill and reputation changes from career progression or sustained Board pressure.</p>
      </div>
      {developmentHistory.length
        ?<div className="divide-y divide-white/10">{developmentHistory.slice(0,12).map((event,index)=><DevelopmentEvent key={(event?.id||event?.date||"development")+"_"+index} event={event}/>)}</div>
        :<div className="p-4 text-sm text-slate-500">No permanent career changes recorded yet.</div>}
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
            <div className="text-xs text-slate-500">{job.role||"Team Principal"}</div>
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
