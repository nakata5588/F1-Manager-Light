import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { flagFromCountry } from "../components/entity/EntityVisuals.jsx";
import StaffContractNegotiationModal from "../components/staff/StaffContractNegotiationModal.jsx";
import { contractActiveForYear } from "../domain/liveContracts.js";
import { resolveStaffId, staffRoleDepartment, staffRoleLabel } from "../domain/staffRoles.js";
import { staffRoleRating } from "../domain/staffPerformance.js";
import { staffNegotiationEligibility } from "../domain/staffMarket.js";
import {
  acceptStaffCounterOffer,
  staffNegotiations,
  staffNegotiationStatusBuckets,
  startStaffNegotiation,
  withdrawStaffNegotiation,
} from "../engine/StaffNegotiationEngine.js";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const staffIdOf=(o)=>String(pick(o,["staff_id","person_id","id"],""));
const teamIdOf=(o)=>String(pick(o,["team_id","team","constructor_id","constructor"],""));
const money=(value)=>Number(value)?new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value)):"—";
const statusClass=(status)=>{
  if(status==="accepted")return "border border-emerald-400/20 bg-emerald-500/10 text-emerald-300";
  if(status==="countered")return "border border-amber-400/20 bg-amber-500/10 text-amber-300";
  if(status==="rejected"||status==="signed_elsewhere")return "border border-rose-400/20 bg-rose-500/10 text-rose-300";
  if(status==="withdrawn")return "border border-white/10 bg-white/5 text-slate-400";
  return "border border-sky-400/20 bg-sky-500/10 text-sky-300";
};
const actionLabel=(reason)=>{
  if(reason==="non_hireable_role")return "Not hireable";
  if(reason==="not_interested")return "Not interested";
  if(reason==="budget")return "Budget";
  if(reason==="unavailable")return "Unavailable";
  return "—";
};

export default function Staff(){
  const gs=useGame(s=>s.gameState);
  const setGameState=useGame(s=>s.setGameState);
  const year=Number(gs?.activeYear);
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const userTeamName=gs?.team?.team_name||gs?.team?.name||gs?.team?.short_name||userTeamId;
  const core=Array.isArray(gs?.staffCore)&&gs.staffCore.length?gs.staffCore:(gs?.dbStaffCore||[]);
  const ratings=Array.isArray(gs?.staffRatings)&&gs.staffRatings.length?gs.staffRatings:(gs?.dbStaffRatings||[]);
  const contracts=Array.isArray(gs?.staffContracts)?gs.staffContracts:(gs?.dbStaffContracts||[]);
  const teams=Array.isArray(gs?.teams)&&gs.teams.length?gs.teams:(gs?.dbTeams||[]);

  const [q,setQ]=useState("");
  const [dept,setDept]=useState("ALL");
  const [team,setTeam]=useState("ALL");
  const [market,setMarket]=useState("ALL");
  const [sort,setSort]=useState("overall");
  const [negotiatingStaff,setNegotiatingStaff]=useState(null);

  const coreById=useMemo(()=>new Map(core.map(s=>[staffIdOf(s),s])),[core]);
  const ratingById=useMemo(()=>new Map(ratings.map(r=>[staffIdOf(r),r])),[ratings]);
  const teamNameById=useMemo(()=>new Map(teams.map(t=>[String(t?.team_id??t?.id??""),t?.team_name||t?.name||"—"])),[teams]);

  const negotiations=staffNegotiations(gs);
  const playerNegotiations=useMemo(
    ()=>negotiations
      .filter((row)=>row.origin==="player"&&String(row.team_id)===userTeamId)
      .slice()
      .sort((a,b)=>String(b.resolved_at||b.responded_at||b.submitted_at||"").localeCompare(String(a.resolved_at||a.responded_at||a.submitted_at||""))),
    [negotiations,userTeamId]
  );
  const negotiationBuckets=useMemo(()=>staffNegotiationStatusBuckets(playerNegotiations),[playerNegotiations]);
  const activePlayerNegotiations=negotiationBuckets.active;
  const negotiationHistory=negotiationBuckets.history;
  const activeByStaff=useMemo(()=>{
    const map=new Map();
    for(const row of activePlayerNegotiations){
      if(!map.has(String(row.staff_id)))map.set(String(row.staff_id),row);
    }
    return map;
  },[activePlayerNegotiations]);

  const rows=useMemo(()=>{
    // Only people with a current-season rating or contract are considered active.
    // staff_core is identity metadata and must not make every living person "active".
    const activeContracts=contracts.filter((contract)=>contractActiveForYear(contract,year));
    const ids=new Set([...ratings.map(staffIdOf),...activeContracts.map((contract)=>resolveStaffId(gs,contract))]);
    return [...ids].filter(Boolean).map(id=>{
      const s=coreById.get(id)||{}, rating=ratingById.get(id)||{};
      const contract=activeContracts.find((row)=>resolveStaffId(gs,row)===id)||null;
      const primaryRole=pick(s,["role_primary"],"Staff");
      const assignedRole=contract?pick(contract,["role","position"],primaryRole):null;
      const role=assignedRole||primaryRole;
      const roleLabel=staffRoleLabel(role);
      const tid=teamIdOf(contract);
      const pending=activeByStaff.get(id)||null;
      const eligibility=userTeamId
        ?staffNegotiationEligibility(gs,{staffId:id,teamId:userTeamId})
        :{canNegotiate:false,reason:"no_team",roles:[]};
      const incumbentId=eligibility.incumbent?resolveStaffId(gs,eligibility.incumbent):"";
      const incumbentCore=incumbentId?coreById.get(incumbentId)||{}:null;
      return {
        id,
        name:pick(s,["staff_name","display_name","name"],pick(contract,["staff_name","name"],id)),
        role:roleLabel,
        primaryRole:staffRoleLabel(primaryRole),
        assignedRole:assignedRole?staffRoleLabel(assignedRole):"Free",
        dept:staffRoleDepartment(role),
        country:pick(s,["country_name","country","nationality"],"—"),
        code:pick(s,["country_code"],""),
        overall:staffRoleRating(rating,assignedRole||primaryRole).score??"—",
        team:contract?(teamNameById.get(tid)||pick(contract,["team_name"],"—")):"Free",
        salary:Number(pick(contract,["salary","salary_yearly"],0))||0,
        until:contract?pick(contract,["contract_until","contract_until_year","end_year","end_date"],"—"):"—",
        pending,
        canNegotiate:Boolean(eligibility.canNegotiate)&&!pending,
        negotiationReason:pending?"negotiating":eligibility.reason,
        negotiationRole:eligibility.role||eligibility.roles?.[0]||null,
        expectedSalary:Number(eligibility.expectedSalary||0),
        replacementCost:Number(eligibility.replacementCost||0),
        incumbent:incumbentId?{
          id:incumbentId,
          name:pick(incumbentCore,["staff_name","display_name","name"],pick(eligibility.incumbent,["staff_name","name"],incumbentId)),
        }:null,
      };
    });
  },[ratings,contracts,coreById,ratingById,year,teamNameById,activeByStaff,userTeamId,gs]);

  const depts=["ALL",...Array.from(new Set(rows.map(r=>r.dept))).sort()];
  const teamsOpt=["ALL",...Array.from(new Set(rows.map(r=>r.team))).sort()];
  const filtered=rows.filter(r=>{
    if(dept!=="ALL"&&r.dept!==dept)return false;
    if(team!=="ALL"&&r.team!==team)return false;
    if(market==="Free"&&r.team!=="Free")return false;
    if(market==="Contracted"&&r.team==="Free")return false;
    if(market==="Hireable"&&!r.canNegotiate)return false;
    if(q&&![r.name,r.role,r.primaryRole,r.assignedRole,r.dept,r.country,r.team].some(v=>String(v).toLowerCase().includes(q.toLowerCase())))return false;
    return true;
  }).sort((a,b)=>{
    if(sort==="overall") return (Number(b.overall)||0)-(Number(a.overall)||0)||a.name.localeCompare(b.name);
    if(sort==="role") return a.role.localeCompare(b.role)||a.name.localeCompare(b.name);
    if(sort==="team") return a.team.localeCompare(b.team)||a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });

  const submitNegotiation=(offer)=>{
    if(!negotiatingStaff||!userTeamId)return;
    const next=startStaffNegotiation(gs,{
      staffId:negotiatingStaff.id,
      teamId:userTeamId,
      teamName:userTeamName,
      offer,
      origin:"player",
    });
    setGameState(next);
    setNegotiatingStaff(null);
  };
  const acceptCounter=(id)=>setGameState(acceptStaffCounterOffer(gs,id));
  const withdraw=(id)=>setGameState(withdrawStaffNegotiation(gs,id));

  return <div className="grid gap-4 text-slate-100">
    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <h2 className="text-lg font-semibold">Staff Market</h2>
      <p className="text-sm text-slate-400">Season {year||"—"} · free operational Staff can be approached and negotiated with. Governance roles such as Owner/President are not hireable.</p>
      <div className="mt-3 flex flex-col gap-2 lg:flex-row">
        <input className="flex-1 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" placeholder="Search name/role/team/nationality…" value={q} onChange={e=>setQ(e.target.value)}/>
        <button
          className={"rounded-md border px-3 py-2 text-sm "+(market==="Hireable"?"border-sky-400/30 bg-sky-500/15 text-sky-200":"border-white/10 bg-[#171a23] text-slate-200")}
          onClick={()=>setMarket(market==="Hireable"?"ALL":"Hireable")}
        >Hireable Staff</button>
        <select className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={market} onChange={e=>setMarket(e.target.value)}>
          <option value="ALL">All market</option>
          <option value="Hireable">Hireable now</option>
          <option value="Free">All free</option>
          <option value="Contracted">Contracted</option>
        </select>
        <select className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={dept} onChange={e=>setDept(e.target.value)}>{depts.map(v=><option key={v}>{v}</option>)}</select>
        <select className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={team} onChange={e=>setTeam(e.target.value)}>{teamsOpt.map(v=><option key={v}>{v}</option>)}</select>
        <select className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={sort} onChange={e=>setSort(e.target.value)}><option value="overall">Sort: Overall</option><option value="role">Sort: Role</option><option value="team">Sort: Team</option><option value="name">Sort: Name</option></select>
      </div>
    </div>

    {!!activePlayerNegotiations.length&&<div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Active Staff Negotiations</h3>
          <p className="text-xs text-slate-500">Offers resolve as the calendar advances. AI teams can still sign a free Staff member before your talks conclude.</p>
        </div>
        <span className="text-xs text-slate-500">{activePlayerNegotiations.length} active</span>
      </div>
      <div className="grid gap-2">
        {activePlayerNegotiations.map(n=><div key={n.id} className="flex flex-col gap-3 rounded-lg border border-white/10 bg-[#171a23] p-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{n.staff_name}</div>
            <div className="text-xs text-slate-500">{staffRoleLabel(n.role)} · {money(n.offer?.salary)} · {n.offer?.years} year{Number(n.offer?.years)===1?"":"s"}{n.status==="submitted"&&n.response_date?" · response by "+n.response_date:""}</div>
            {n.status==="countered"&&n.counter_offer?<div className="mt-1 text-sm">Representative asks for <strong>{money(n.counter_offer.salary)}</strong>.</div>:null}
          </div>
          <span className={"rounded px-2 py-1 text-xs font-medium "+statusClass(n.status)}>{String(n.status||"").replaceAll("_"," ")}</span>
          {n.status==="countered"?<div className="flex gap-2">
            <button className="rounded border border-sky-400/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/25" onClick={()=>acceptCounter(n.id)}>Accept counter</button>
            <button className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={()=>withdraw(n.id)}>Withdraw</button>
          </div>:null}
          {n.status==="submitted"?<button className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={()=>withdraw(n.id)}>Withdraw</button>:null}
        </div>)}
      </div>
    </div>}

    {!!negotiationHistory.length&&<details className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3">
        <span className="font-semibold">Staff Negotiation History</span>
        <span className="text-xs text-slate-500">{negotiationHistory.length} completed</span>
      </summary>
      <div className="mt-3 grid gap-2">
        {negotiationHistory.slice(0,20).map(n=><div key={n.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#171a23] p-3">
          <div className="min-w-0 flex-1"><div className="font-medium">{n.staff_name}</div><div className="text-xs text-slate-500">{staffRoleLabel(n.role)} · {money(n.offer?.salary)}{n.resolution_note?" · "+n.resolution_note:""}</div></div>
          <span className={"rounded px-2 py-1 text-xs font-medium "+statusClass(n.status)}>{String(n.status||"").replaceAll("_"," ")}</span>
        </div>)}
      </div>
    </details>}

    <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#11141c] shadow-xl"><table className="min-w-full text-sm">
      <thead className="bg-white/[0.04] text-slate-400"><tr><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Primary Role</th><th className="px-4 py-3 text-left">Assigned Role</th><th className="px-4 py-3 text-left">Dept</th><th className="px-4 py-3 text-left">Team</th><th className="px-4 py-3 text-left">Nationality</th><th className="px-4 py-3 text-right">Overall</th><th className="px-4 py-3 text-right">Salary</th><th className="px-4 py-3 text-left">Contract</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
      <tbody>{filtered.map(s=><tr key={s.id} className="border-t border-white/10 hover:bg-white/[0.04]">
        <td className="px-4 py-2"><button type="button" data-entity="staff" data-id={s.id} className="text-left font-medium hover:underline">{s.name}</button></td>
        <td className="px-4 py-2">{s.primaryRole}</td><td className="px-4 py-2">{s.assignedRole}</td><td className="px-4 py-2">{s.dept}</td><td className="px-4 py-2">{s.team}</td>
        <td className="px-4 py-2">{flagFromCountry(s.country,s.code)} {s.country}</td><td className="px-4 py-2 text-right font-semibold">{s.overall}</td>
        <td className="px-4 py-2 text-right">{money(s.salary)}</td>
        <td className="px-4 py-2">{s.until}</td>
        <td className="px-4 py-2 text-right">
          {s.pending?<span className={"rounded px-2 py-1 text-xs "+statusClass(s.pending.status)}>Negotiating</span>
            :s.canNegotiate?<button className="rounded border border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25" onClick={()=>setNegotiatingStaff(s)}>Approach</button>
            :s.team!=="Free"?<span className="text-xs text-slate-600">—</span>
            :<span className="text-xs text-slate-500">{actionLabel(s.negotiationReason)}</span>}
        </td>
      </tr>)}
      {!filtered.length&&<tr><td colSpan={10} className="px-4 py-6 text-center text-slate-500">No staff found.</td></tr>}</tbody>
    </table></div>

    {negotiatingStaff?<StaffContractNegotiationModal
      staff={negotiatingStaff}
      role={negotiatingStaff.negotiationRole}
      roleLabel={staffRoleLabel(negotiatingStaff.negotiationRole)}
      expectedSalary={negotiatingStaff.expectedSalary}
      incumbent={negotiatingStaff.incumbent}
      replacementCost={negotiatingStaff.replacementCost}
      onClose={()=>setNegotiatingStaff(null)}
      onSubmit={submitNegotiation}
    />:null}
  </div>;
}
