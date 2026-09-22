// src/components/entity/EntityQuickViews.jsx
import React, { useMemo } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../../state/GameStore.js";
import { driverProfileSnapshot } from "../../domain/driverProfile.js";
import { presentDriverKnowledgeValue } from "../../domain/driverKnowledge.js";
import { activeDriverContract, driverContractsOf, driverIdOf, teamIdOf } from "../../domain/driverContracts.js";
import { contractRoleLabel, isDriverContract } from "../../domain/contractRoles.js";
import { DriverPortrait, TeamLogo, flagFromCountry } from "./EntityVisuals.jsx";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v.text??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const asRows=(value)=>{
  const raw=unbox(value);
  if(Array.isArray(raw))return raw;
  if(!raw||typeof raw!=="object")return [];
  for(const key of ["items","rows","list","data"])if(Array.isArray(raw[key]))return raw[key];
  return Object.values(raw).filter((row)=>row&&typeof row==="object"&&!Array.isArray(row));
};
const normalizeDriverId=(value)=>{
  const raw=String(unbox(value)??"");
  const m=raw.match(/(\d+)/);
  return m?m[1].padStart(4,"0"):raw;
};
const sameDriver=(a,b)=>Boolean(normalizeDriverId(a)&&normalizeDriverId(a)===normalizeDriverId(b));
const fmtMoney=(value)=>{
  const n=Number(unbox(value));
  if(!Number.isFinite(n))return "—";
  return new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n);
};
const nice=(s)=>String(s||"").replace(/_/g," ").replace(/\b\w/g,(m)=>m.toUpperCase());

function QuickShell({children,onClose,onFullProfile}){
  return (
    <div className="overflow-hidden rounded-2xl bg-[#0c0f15] text-slate-100">
      <div className="flex items-center justify-end gap-2 border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={onFullProfile}
          className="inline-flex items-center gap-2 rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/15"
        >
          Full Profile <ArrowUpRight size={14}/>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/5 hover:text-white"
          aria-label="Close quick view"
        >
          <X size={16}/>
        </button>
      </div>
      {children}
    </div>
  );
}

function Metric({label,value,tone=""}){
  return (
    <div className="rounded-lg border border-white/10 bg-[#151923] p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-base font-semibold ${tone}`}>{value??"—"}</div>
    </div>
  );
}

function openFull(navigate,onClose,path){
  onClose?.();
  navigate(path);
}

export function DriverQuickView({entity,onClose}){
  const navigate=useNavigate();
  const gs=useGame((s)=>s.gameState);
  const drivers=[...asRows(gs?.dbDrivers),...asRows(gs?.drivers)];
  const id=String(entity?.id??"");
  const driver=drivers.reduce((found,row)=>sameDriver(driverIdOf(row),id)?{...(found||{}),...row}:found,null);
  const snapshot=driverProfileSnapshot(gs,driver||id);
  const knowledge=snapshot?.knowledge;
  const overall=presentDriverKnowledgeValue(
    knowledge,
    "current_ability",
    snapshot?.overall?.value,
    {kind:"ability",estimated:snapshot?.overall?.estimated}
  );
  const potential=presentDriverKnowledgeValue(
    knowledge,
    "potential_ability",
    snapshot?.rating?.potential_ability,
    {kind:"potential"}
  );
  const condition=snapshot?.condition||{};
  const form=snapshot?.form||{};
  const name=pick(driver,["display_name","name","driver_name"],id);
  const country=pick(driver,["country_name","country","nationality"],"");
  const number=pick(driver,["prefered_number","preferred_number","driver_number"],null);
  const role=contractRoleLabel(snapshot?.contract)||pick(snapshot?.contract,["role"],"");
  const formTone=Number(form?.score)>=76?"text-emerald-300":Number(form?.score)<58&&form?.score!=null?"text-rose-300":"text-slate-200";

  return (
    <QuickShell onClose={onClose} onFullProfile={()=>openFull(navigate,onClose,`/drivers/${encodeURIComponent(id)}`)}>
      <div className="p-5">
        <div className="flex items-center gap-4">
          <DriverPortrait driver={driver} size="h-20 w-20" className="!rounded-xl"/>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Driver Quick View</div>
            <div className="mt-1 truncate text-2xl font-semibold">{name}</div>
            <div className="mt-1 text-sm text-slate-400">
              {flagFromCountry(country,pick(driver,["country_code"],""))} {country||"—"}
              {number!=null?` · #${number}`:""}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <TeamLogo teamId={snapshot?.teamId} name={snapshot?.teamName||"Team"} size="h-7 w-7"/>
              <span>{snapshot?.teamName||"Free Agent"}{role?` · ${role}`:""}</span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Overall" value={overall.label}/>
          <Metric label="Potential" value={potential.label}/>
          <Metric label="Form" value={form?.score!=null?`${Number(form.score).toFixed(1)} · ${form.label}`:"—"} tone={formTone}/>
          <Metric label="Championship" value={snapshot?.season?.championshipPosition?`P${snapshot.season.championshipPosition}`:"—"}/>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-[#11141c] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Knowledge</div>
            <span className="text-xs text-sky-300">{knowledge?.label||"Unscouted"}</span>
          </div>
          {knowledge?.canSeeCondition ? (
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <Metric label="Confidence" value={Math.round(Number(condition?.confidence??50))}/>
              <Metric label="Morale" value={Math.round(Number(condition?.morale??50))}/>
              <Metric label="Prep" value={Math.round(Number(condition?.preparation??50))}/>
              <Metric label="Fatigue" value={Math.round(Number(condition?.fatigue??0))}/>
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">Current condition is private team information.</div>
          )}
        </div>
      </div>
    </QuickShell>
  );
}

export function TeamQuickView({entity,onClose}){
  const navigate=useNavigate();
  const gs=useGame((s)=>s.gameState);
  const id=String(entity?.id??"");
  const year=Number(gs?.activeYear);
  const teams=[...asRows(gs?.dbTeams),...asRows(gs?.teams)];
  const brands=[...asRows(gs?.dbTeamBrands),...asRows(gs?.teamBrands)];
  const team=teams.reduce((found,row)=>String(row?.team_id??row?.id??"")===id?{...(found||{}),...row}:found,null);
  const brand=brands
    .filter((row)=>String(row?.team_id??"")===id)
    .sort((a,b)=>Math.abs(Number(a?.year??year)-year)-Math.abs(Number(b?.year??year)-year))[0]||null;
  const name=pick(team,["team_name","name"],pick(brand,["official_name","team_name"],id));
  const country=pick(team,["country"],pick(brand,["country"],""));
  const base=pick(team,["team_base","base"],pick(brand,["base"],""));
  const standings=asRows(gs?.standings?.teams);
  const standing=standings.find((row)=>String(row?.team_id??row?.id??"")===id)||null;
  const contracts=driverContractsOf(gs).filter((row)=>String(teamIdOf(row))===id&&isDriverContract(row));
  const drivers=[...asRows(gs?.dbDrivers),...asRows(gs?.drivers)];
  const lineUp=contracts
    .map((contract)=>{
      const did=driverIdOf(contract);
      const driver=drivers.reduce((found,row)=>sameDriver(driverIdOf(row),did)?{...(found||{}),...row}:found,null);
      return driver?{driver,contract}:null;
    })
    .filter(Boolean)
    .slice(0,4);

  return (
    <QuickShell onClose={onClose} onFullProfile={()=>openFull(navigate,onClose,`/teams/${encodeURIComponent(id)}`)}>
      <div className="p-5">
        <div className="flex items-center gap-4">
          <TeamLogo teamId={id} name={name} size="h-20 w-20"/>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Team Quick View</div>
            <div className="mt-1 truncate text-2xl font-semibold">{name}</div>
            <div className="mt-1 text-sm text-slate-400">
              {flagFromCountry(country,pick(team,["country_code"],pick(brand,["country_code"],"")))} {country||"—"}
              {base?` · ${base}`:""}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Championship" value={standing?.position?`P${standing.position}`:"—"}/>
          <Metric label="Points" value={standing?.points??0}/>
          <Metric label="Founded" value={pick(team,["founded_year"],pick(brand,["founded_year"],"—"))}/>
          <Metric label="Budget" value={fmtMoney(pick(team,["budget"],pick(brand,["starting_budget"],null)))}/>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Current Drivers</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {lineUp.map(({driver,contract})=>(
              <div key={driverIdOf(driver)} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#151923] p-3">
                <DriverPortrait driver={driver} size="h-9 w-9"/>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{pick(driver,["display_name","name"],driverIdOf(driver))}</div>
                  <div className="text-xs text-slate-500">{contractRoleLabel(contract)||nice(contract?.role)}</div>
                </div>
              </div>
            ))}
            {!lineUp.length&&<div className="text-sm text-slate-500">No current drivers linked.</div>}
          </div>
        </div>
      </div>
    </QuickShell>
  );
}

export function StaffQuickView({entity,onClose}){
  const navigate=useNavigate();
  const gs=useGame((s)=>s.gameState);
  const year=Number(gs?.activeYear);
  const id=String(entity?.id??"");
  const core=[...asRows(gs?.dbStaffCore),...asRows(gs?.staffCore)];
  const ratings=[...asRows(gs?.dbStaffRatings),...asRows(gs?.staffRatings)];
  const contracts=[...asRows(gs?.dbStaffContracts),...asRows(gs?.staffContracts)];
  const staff=core.reduce((found,row)=>String(pick(row,["staff_id","person_id","id"],""))===id?{...(found||{}),...row}:found,null);
  const rating=ratings
    .filter((row)=>String(pick(row,["staff_id","person_id","id"],""))===id)
    .sort((a,b)=>Math.abs(Number(a?.year??year)-year)-Math.abs(Number(b?.year??year)-year))[0]||null;
  const contract=contracts.find((row)=>
    String(pick(row,["staff_id","person_id","id"],""))===id &&
    (!Number.isFinite(year)||!Number.isFinite(Number(row?.year))||Number(row.year)===year)
  )||null;
  const name=pick(staff,["staff_name","display_name","name"],pick(contract,["staff_name","name"],id));
  const country=pick(staff,["country_name","country","nationality"],"");
  const role=nice(pick(contract,["role","position"],pick(staff,["role_primary"],"Staff")));
  const skills=Object.entries(rating||{})
    .filter(([key,value])=>!["staff_id","staff_name","year"].includes(key)&&Number.isFinite(Number(value)))
    .sort((a,b)=>Number(b[1])-Number(a[1]));
  const overall=skills.length?Math.round(skills.reduce((sum,[,value])=>sum+Number(value),0)/skills.length):null;
  const initials=String(name||"?").split(/\s+/).filter(Boolean).map((part)=>part[0]).join("").slice(0,2).toUpperCase();

  return (
    <QuickShell onClose={onClose} onFullProfile={()=>openFull(navigate,onClose,`/staff/${encodeURIComponent(id)}`)}>
      <div className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-white/10 bg-[#151923] text-xl font-semibold">{initials||"?"}</div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Staff Quick View</div>
            <div className="mt-1 truncate text-2xl font-semibold">{name}</div>
            <div className="mt-1 text-sm text-slate-400">{flagFromCountry(country,pick(staff,["country_code"],""))} {country||"—"} · {role}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Overall" value={overall??"—"}/>
          <Metric label="Team" value={pick(contract,["team_name","team"],"Free Agent")}/>
          <Metric label="Contract to" value={pick(contract,["contract_until","contract_until_year","end_year","end_date"],"—")}/>
          <Metric label="Salary" value={fmtMoney(pick(contract,["salary","salary_yearly"],null))}/>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Top Attributes</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {skills.slice(0,6).map(([key,value])=>(
              <Metric key={key} label={nice(key)} value={value}/>
            ))}
            {!skills.length&&<div className="text-sm text-slate-500">No current ratings available.</div>}
          </div>
        </div>
      </div>
    </QuickShell>
  );
}
