import React, { useMemo } from "react";
import { Briefcase, CalendarDays, CircleDollarSign, X } from "lucide-react";
import { useGame } from "../../state/GameStore.js";
import { StaffPortrait, TeamLogo, flagFromCountry } from "./EntityVisuals.jsx";
import { contractActiveForYear } from "../../domain/liveContracts.js";
import { resolveStaffId, staffRoleLabel } from "../../domain/staffRoles.js";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const staffIdOf=(o)=>String(pick(o,["staff_id","person_id","id"],""));
const nice=(s)=>String(s||"Staff").replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase());

function overallOf(rating){
  const ignored=new Set(["staff_id","staff_name","year"]);
  const vals=Object.entries(rating||{}).filter(([k,v])=>!ignored.has(k)&&Number.isFinite(Number(v))).map(([,v])=>Number(v));
  return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
}

function tone(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "text-slate-500";
  if(n>=82)return "text-emerald-300";
  if(n>=68)return "text-sky-300";
  if(n>=52)return "text-amber-300";
  return "text-rose-300";
}

export default function StaffModal({entity,onClose,pageMode=false}){
  const gs=useGame(s=>s.gameState);
  const year=Number(gs?.activeYear);
  const coreList=gs?.staffCore?.length?gs.staffCore:gs?.dbStaffCore||[];
  const ratings=gs?.staffRatings?.length?gs.staffRatings:gs?.dbStaffRatings||[];
  const contracts=gs?.staffContracts?.length?gs.staffContracts:gs?.dbStaffContracts||[];
  const dbContracts=Array.isArray(gs?.dbStaffContracts)?gs.dbStaffContracts:[];
  const teams=gs?.teams?.length?gs.teams:gs?.dbTeams||[];
  const id=String(entity.id);

  const staff=useMemo(()=>coreList.find(s=>staffIdOf(s)===id)||null,[coreList,id]);
  const rating=useMemo(()=>{
    const candidates=ratings.filter((row)=>staffIdOf(row)===id);
    return candidates.find((row)=>Number(row?.year??row?.season_year)===year)
      ||candidates.filter((row)=>Number(row?.year??row?.season_year)<=year)
        .sort((a,b)=>Number(b?.year??b?.season_year??0)-Number(a?.year??a?.season_year??0))[0]
      ||candidates[0]
      ||null;
  },[ratings,id,year]);
  const contractRows=useMemo(()=>{
    const merged=new Map();
    for(const row of [...dbContracts,...contracts]){
      if(resolveStaffId(gs,row)!==id)continue;
      const key=[
        String(row?.team_id??row?.team??""),
        String(row?.role??row?.position??""),
        String(row?.contract_start??row?.contract_start_year??row?.start_year??row?.year??""),
        String(row?.contract_until??row?.contract_until_year??row?.end_year??row?.year??""),
      ].join("|");
      merged.set(key,row);
    }
    return [...merged.values()];
  },[dbContracts,contracts,gs,id]);
  const contract=useMemo(()=>contractRows.find((row)=>contractActiveForYear(row,year))||null,[contractRows,year]);

  if(!staff&&!contract){
    return <div className="rounded-2xl border border-white/10 bg-[#090b10] p-6 text-slate-100">
      <div className="flex justify-between"><h3 className="font-semibold">Staff member not found</h3>{!pageMode&&<button onClick={onClose}><X size={18}/></button>}</div>
      <p className="text-sm text-slate-500">{id}</p>
    </div>;
  }

  const name=pick(staff,["staff_name","display_name","name"],pick(contract,["staff_name","name"],id));
  const country=pick(staff,["country_name","country","nationality"],"");
  const role=staffRoleLabel(pick(contract,["role","position"],pick(staff,["role_primary"],"Staff")));
  const primaryRole=staffRoleLabel(pick(staff,["role_primary"],role));
  const overall=overallOf(rating);
  const skills=Object.entries(rating||{})
    .filter(([k,v])=>!["staff_id","staff_name","year"].includes(k)&&Number.isFinite(Number(v)))
    .sort((a,b)=>Number(b[1])-Number(a[1]));
  const teamId=String(pick(contract,["team_id","team"],""));
  const team=teams.find((row)=>String(row?.team_id??row?.id??"")===teamId)||null;
  const teamName=pick(contract,["team_name"],pick(team,["team_name","name","short_name"],teamId||"Free"));
  const until=pick(contract,["contract_until","contract_until_year","end_year","end_date"],"—");
  const salary=fmtMoney(pick(contract,["salary","salary_yearly"],null));

  return <div className={"flex flex-col overflow-hidden bg-[#090b10] text-slate-100 lg:flex-row "+(pageMode
    ?"min-h-[calc(100vh-5rem)] rounded-2xl border border-white/10 shadow-xl"
    :"max-h-[92vh] rounded-2xl border border-white/10 shadow-2xl")}>
    <aside className="shrink-0 border-b border-white/10 bg-[#11141c] p-5 lg:w-[290px] lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-3">
        <StaffPortrait staff={staff||{staff_name:name}} size="h-20 w-20" className="!rounded-xl"/>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Staff</div>
          <div className="truncate text-xl font-semibold leading-tight">{name}</div>
          <div className="mt-1 text-xs text-slate-400">{flagFromCountry(country,pick(staff,["country_code"],""))} {country||"—"}</div>
        </div>
      </div>

      {teamId?(
        <button
          type="button"
          data-entity="team"
          data-id={teamId}
          className="mt-4 w-full rounded-xl border border-white/10 bg-[#171a23] p-3 text-left hover:bg-white/5"
        >
          <div className="flex items-center gap-3">
            <TeamLogo teamId={teamId} name={teamName} size="h-10 w-10"/>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{teamName}</div>
              <div className="text-xs text-slate-500">{role} · View team</div>
            </div>
          </div>
        </button>
      ):(
        <div className="mt-4 rounded-xl border border-white/10 bg-[#171a23] p-3 text-sm text-slate-400">Free Staff</div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <ProfileMetric label="OVR" value={overall??"—"} valueClass={tone(overall)}/>
        <ProfileMetric label="Season" value={year||"—"}/>
        <ProfileMetric label="Role" value={shortRole(role)}/>
      </div>

      <div className="mt-4 space-y-2 border-t border-white/10 pt-4 text-xs">
        <SidebarRow icon={<Briefcase size={13}/>} label="Primary role" value={primaryRole}/>
        <SidebarRow icon={<CalendarDays size={13}/>} label="Contract to" value={until}/>
        <SidebarRow icon={<CircleDollarSign size={13}/>} label="Salary" value={salary}/>
      </div>
    </aside>

    <main className="min-w-0 flex-1 overflow-y-auto">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 bg-[#0f1219] px-5 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Staff Profile</div>
          <h2 className="mt-1 text-2xl font-bold">{name}</h2>
          <p className="mt-1 text-sm text-slate-400">{role}{teamId?` · ${teamName}`:" · Free Staff"}</p>
        </div>
        {!pageMode&&<button onClick={onClose} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5 hover:text-white"><X size={18}/></button>}
      </header>

      <div className="grid gap-5 p-5">
        <section>
          <div className="mb-2">
            <h3 className="font-semibold">Contract & Role</h3>
            <p className="text-xs text-slate-500">Current-season assignment and employment information.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Info label="Assigned role" value={role}/>
            <Info label="Primary role" value={primaryRole}/>
            <Info label="Contract to" value={until}/>
            <Info label="Salary" value={salary}/>
          </div>
        </section>

        <section>
          <div className="mb-2">
            <h3 className="font-semibold">Career Assignments</h3>
            <p className="text-xs text-slate-500">Historical team and role records available in the database.</p>
          </div>
          <div className="space-y-2">
            {contractRows.slice().sort((a,b)=>Number(b?.year??b?.season_year??0)-Number(a?.year??a?.season_year??0)).map((row,index)=>{
              const rowTeamId=String(pick(row,["team_id","team"],""));
              const rowTeam=teams.find((teamRow)=>String(teamRow?.team_id??teamRow?.id??"")===rowTeamId)||null;
              const rowTeamName=pick(row,["team_name"],pick(rowTeam,["team_name","name","short_name"],rowTeamId||"Unknown Team"));
              const start=pick(row,["contract_start","contract_start_year","start_year","year"],"—");
              const end=pick(row,["contract_until","contract_until_year","end_year","year"],"—");
              const range=String(start)===String(end)?String(start):String(start)+"–"+String(end);
              return <div key={rowTeamId+"|"+String(row?.role||row?.position||"")+"|"+index} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#171a23] px-3 py-2">
                {rowTeamId?<button type="button" data-entity="team" data-id={rowTeamId} className="shrink-0"><TeamLogo teamId={rowTeamId} name={rowTeamName} size="h-8 w-8"/></button>:null}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{rowTeamId?<button type="button" data-entity="team" data-id={rowTeamId} className="hover:underline">{rowTeamName}</button>:rowTeamName}</div>
                  <div className="text-xs text-slate-500">{staffRoleLabel(pick(row,["role","position"],"Staff"))}</div>
                </div>
                <div className="shrink-0 text-xs text-slate-400">{range}</div>
              </div>;
            })}
            {!contractRows.length?<div className="rounded-lg border border-white/10 bg-[#171a23] p-4 text-sm text-slate-500">No historical staff assignments recorded.</div>:null}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold">Attributes</h3>
              <p className="text-xs text-slate-500">Current staff ratings for season {year||"—"}.</p>
            </div>
            {overall!=null?<div className={"text-sm font-semibold "+tone(overall)}>Overall {overall}</div>:null}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
            {skills.map(([k,v])=><div key={k} className="rounded-lg border border-white/10 bg-[#171a23] p-3">
              <div className="text-xs text-slate-500">{nice(k)}</div>
              <div className={"mt-1 text-lg font-semibold "+tone(v)}>{v}</div>
            </div>)}
            {!skills.length&&<div className="col-span-full rounded-lg border border-white/10 bg-[#171a23] p-4 text-sm text-slate-500">No ratings available for this season.</div>}
          </div>
        </section>
      </div>
    </main>
  </div>;
}

function fmtMoney(v){const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n):"—";}
function shortRole(value){
  const words=String(value||"—").split(" ");
  return words.length>2?words.map((word)=>word[0]).join("").toUpperCase():String(value||"—");
}
function ProfileMetric({label,value,valueClass=""}){
  return <div className="rounded-lg border border-white/10 bg-[#171a23] px-2 py-1.5">
    <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className={"truncate text-[13px] font-semibold "+valueClass}>{value??"—"}</div>
  </div>;
}
function SidebarRow({icon,label,value}){
  return <div className="flex items-start justify-between gap-3">
    <span className="flex items-center gap-1.5 text-slate-500">{icon}{label}</span>
    <strong className="max-w-[145px] text-right font-medium text-slate-200">{value??"—"}</strong>
  </div>;
}
function Info({label,value}){
  return <div className="rounded-lg border border-white/10 bg-[#171a23] p-3">
    <div className="text-xs text-slate-500">{label}</div>
    <div className="mt-1 font-medium text-slate-200">{value??"—"}</div>
  </div>;
}
