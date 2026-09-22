import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { TeamLogo, flagFromCountry } from "../components/entity/EntityVisuals.jsx";
import { teamEngineeringSupport } from "../engine/PracticeSetupEngine.js";

const pick=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const raw=o?.[k];
    const v=raw&&typeof raw==="object"&&!Array.isArray(raw)?(raw.result??raw.value??raw):raw;
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const staffIdOf=(o)=>String(pick(o,["staff_id","person_id","id"],""));
const teamIdOf=(o)=>String(pick(o,["team_id","team","constructor_id","constructor"],""));
const nice=(s)=>String(s||"Staff").replace(/_/g," ").replace(/\b\w/g,(m)=>m.toUpperCase());
const money=(v)=>Number(v)?new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(v)):"—";
const META_KEYS=new Set(["staff_id","staff_name","year","season_year"]);

function numericRatings(rating){
  return Object.entries(rating||{})
    .filter(([key,value])=>!META_KEYS.has(key)&&Number.isFinite(Number(value)))
    .map(([key,value])=>({key,label:nice(key),value:Number(value)}))
    .sort((a,b)=>b.value-a.value);
}
function overallOf(rating){
  const vals=numericRatings(rating).map((row)=>row.value);
  return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
}
function ratingForYear(rows,id,year){
  const candidates=(rows||[]).filter((row)=>staffIdOf(row)===String(id));
  const exact=candidates.find((row)=>Number(pick(row,["year","season_year"],NaN))===Number(year));
  if(exact)return exact;
  return candidates
    .filter((row)=>Number(pick(row,["year","season_year"],-Infinity))<=Number(year))
    .sort((a,b)=>Number(pick(b,["year","season_year"],0))-Number(pick(a,["year","season_year"],0)))[0]
    ||candidates[0]||{};
}
function ratingTone(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "text-slate-500";
  if(n>=90)return "text-emerald-300";
  if(n>=80)return "text-cyan-300";
  if(n>=70)return "text-slate-200";
  if(n>=60)return "text-amber-300";
  return "text-rose-300";
}

export default function MyStaff(){
  const gs=useGame((s)=>s.gameState);
  const year=Number(gs?.activeYear);
  const myTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const myTeamName=gs?.team?.team_name||gs?.team?.name||"My Team";
  const contracts=gs?.staffContracts?.length?gs.staffContracts:gs?.dbStaffContracts||[];
  const staffCore=gs?.staffCore?.length?gs.staffCore:gs?.dbStaffCore||[];
  const ratings=gs?.staffRatings?.length?gs.staffRatings:gs?.dbStaffRatings||[];
  const pitcrew=gs?.pitcrewRoster?.length?gs.pitcrewRoster:gs?.dbPitcrewRoster||[];

  const coreById=useMemo(()=>new Map(staffCore.map((s)=>[staffIdOf(s),s])),[staffCore]);

  const rows=useMemo(()=>contracts.filter((c)=>{
    const cy=Number(pick(c,["year","season_year"],year));
    return teamIdOf(c)===myTeamId&&(!Number.isFinite(year)||!Number.isFinite(cy)||cy===year);
  }).map((c)=>{
    const id=staffIdOf(c);
    const core=coreById.get(id)||{};
    const rating=ratingForYear(ratings,id,year);
    const attrs=numericRatings(rating);
    return {
      id,
      name:pick(core,["staff_name","display_name","name"],pick(c,["staff_name","name"],id)),
      role:nice(pick(c,["role","position"],pick(core,["role_primary"],"Staff"))),
      country:pick(core,["country_name","country","nationality"],""),
      code:pick(core,["country_code"],""),
      overall:overallOf(rating),
      ratingYear:pick(rating,["year","season_year"],null),
      attributes:attrs,
      salary:Number(pick(c,["salary","salary_yearly"],0))||0,
      until:pick(c,["contract_until","contract_until_year","end_year","end_date"],"—"),
    };
  }).sort((a,b)=>String(a.role).localeCompare(String(b.role))||String(a.name).localeCompare(String(b.name))),[contracts,year,myTeamId,coreById,ratings]);

  const engineeringSupport=useMemo(()=>teamEngineeringSupport(gs,myTeamId),[gs,myTeamId]);
  const livePit=gs?.raceStrategyWorld?.pitCrews?.[myTeamId]||null;

  const pit=useMemo(()=>livePit||pitcrew.find((row)=>
    teamIdOf(row)===myTeamId&&Number(pick(row,["year","season_year"],year))===year
  )||pitcrew.find((row)=>teamIdOf(row)===myTeamId)||null,[livePit,pitcrew,myTeamId,year]);

  const avgOverall=rows.filter((r)=>Number.isFinite(r.overall));
  const average=avgOverall.length?Math.round(avgOverall.reduce((s,r)=>s+r.overall,0)/avgOverall.length):null;
  const payroll=rows.reduce((sum,row)=>sum+Number(row.salary||0),0);

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
    <div className="rounded-xl border border-white/10 bg-[#12141c] shadow-lg p-5 flex flex-col lg:flex-row lg:items-center gap-4">
      <TeamLogo teamId={myTeamId} name={myTeamName} size="h-16 w-16" className="p-1"/>
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Team Personnel</div>
        <h2 className="text-2xl font-semibold">My Staff</h2>
        <p className="text-sm text-slate-400">{myTeamName} · Season {year||"—"}</p>
      </div>
      <div className="flex-1"/>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 min-w-[420px]">
        <Metric label="Staff" value={rows.length}/>
        <Metric label="Average rating" value={average??"—"}/>
        <Metric label="Engineering support" value={Math.round(Number(engineeringSupport||0))+"/100"}/>
        <Metric label="Annual payroll" value={money(payroll)}/>
      </div>
      <Link to="/Staff" className="rounded-md bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold hover:bg-white">Staff Market</Link>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <section className="xl:col-span-9 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rows.map((staff)=><article key={staff.id} className="rounded-xl border border-white/10 bg-[#12141c] shadow-lg overflow-hidden">
          <div className="p-4 flex items-start gap-4">
            <div className="h-16 w-16 rounded-full border border-white/10 bg-[#1b1e28] flex items-center justify-center text-lg font-bold">
              {String(staff.name||"?").split(/\s+/).filter(Boolean).map((x)=>x[0]).join("").slice(0,2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wide text-slate-500">{staff.role}</div>
              <button data-entity="staff" data-id={staff.id} className="text-xl font-semibold hover:underline text-left truncate max-w-full">{staff.name}</button>
              <div className="text-sm text-slate-400 mt-1">{flagFromCountry(staff.country,staff.code)} {staff.country||"—"}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Overall</div>
              <div className={`text-3xl font-bold ${ratingTone(staff.overall)}`}>{staff.overall??"—"}</div>
              {staff.ratingYear?<div className="text-[10px] text-slate-600">ratings {staff.ratingYear}</div>:null}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-px bg-white/10 border-y border-white/10">
            {staff.attributes.slice(0,6).map((attr)=><div key={attr.key} className="bg-[#171a23] p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{attr.label}</div>
              <div className={`text-lg font-semibold ${ratingTone(attr.value)}`}>{attr.value}</div>
            </div>)}
            {!staff.attributes.length?<div className="col-span-3 bg-[#171a23] p-3 text-sm text-slate-500">No staff ratings available for this season.</div>:null}
          </div>

          <div className="p-4 grid grid-cols-2 gap-3 text-sm">
            <Info label="Salary" value={money(staff.salary)}/>
            <Info label="Contract until" value={staff.until}/>
            <Info label="Gameplay hook" value={/engineer|technical|designer/i.test(staff.role)?"Practice setup / engineering":/principal|owner/i.test(staff.role)?"Management / contracts":"Department support"}/>
            <Info label="Rating source" value={staff.ratingYear?("Season "+staff.ratingYear):"No seasonal rating"}/>
          </div>
        </article>)}
        {!rows.length?<div className="lg:col-span-2 rounded-xl border border-white/10 bg-[#12141c] p-8 text-center text-slate-500">No staff contracts found for this team.</div>:null}
      </section>

      <aside className="xl:col-span-3 space-y-4">
        <section className="rounded-xl border border-white/10 bg-[#12141c] shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <div className="font-semibold">Pit Crew</div>
            <div className="text-xs text-slate-500">Live team operational unit</div>
          </div>
          {pit?<div className="p-4 space-y-4">
            <PitMetric label="Average stop" value={Number(pick(pit,["avg_time_s","avg_time"],0)).toFixed(1)+"s"} progress={Math.max(0,100-(Number(pick(pit,["avg_time_s","avg_time"],10))-4)*15)}/>
            <PitMetric label="Consistency" value={Math.round(Number(pick(pit,["consistency"],0)))+"%"} progress={Number(pick(pit,["consistency"],0))}/>
            <PitMetric label="Error rate" value={(Number(pick(pit,["error_rate"],0))*100).toFixed(1)+"%"} progress={Math.max(0,100-Number(pick(pit,["error_rate"],0))*1000)}/>
            <PitMetric label="Training load" value={Math.round(Number(pick(pit,["training_load"],50)))+"%"} progress={Number(pick(pit,["training_load"],50))}/>
            <div className="rounded-lg border border-white/10 bg-[#171a23] p-3 text-xs text-slate-400">
              Training Load is now managed in Development → Pit Crew. Higher load improves the crew faster, but sustained load above 60% creates a temporary race-day penalty to stop time, consistency and error risk.
            </div>
            <Link to="/Development" className="inline-flex rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10">Manage pit crew training →</Link>
            <div className="pt-2 border-t border-white/10 text-xs text-slate-500">Source: {pick(pit,["source"],"historical/team data")} · used by the race-strategy pit-stop model.</div>
          </div>:<div className="p-5 text-sm text-slate-500">No pit-crew record for this Team/season.</div>}
        </section>

        <section className="rounded-xl border border-white/10 bg-[#12141c] shadow-lg p-4">
          <div className="font-semibold">Personnel links</div>
          <div className="mt-3 grid gap-2 text-sm">
            <Link to="/Development" className="rounded-md bg-white/5 px-3 py-2 hover:bg-white/10">Technical Development →</Link>
            <Link to="/HQ" className="rounded-md bg-white/5 px-3 py-2 hover:bg-white/10">Facilities / HQ →</Link>
            <Link to="/Scouting" className="rounded-md bg-white/5 px-3 py-2 hover:bg-white/10">Scouting →</Link>
          </div>
        </section>
      </aside>
    </div>
  </div>;
}

function Metric({label,value}){
  return <div className="rounded-lg bg-white/5 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className="font-semibold truncate">{value}</div></div>;
}
function Info({label,value}){
  return <div><div className="text-xs text-slate-500">{label}</div><div className="font-medium">{value??"—"}</div></div>;
}
function PitMetric({label,value,progress}){
  const width=Math.max(0,Math.min(100,Number(progress)||0));
  return <div>
    <div className="flex items-center justify-between gap-2 text-sm"><span className="text-slate-400">{label}</span><strong>{value}</strong></div>
    <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-slate-200" style={{width:`${width}%`}}/></div>
  </div>;
}
