import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { flagFromCountry } from "../components/entity/EntityVisuals.jsx";
import { contractActiveForYear } from "../domain/liveContracts.js";
import { resolveStaffId, staffRoleDepartment, staffRoleLabel } from "../domain/staffRoles.js";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const staffIdOf=(o)=>String(pick(o,["staff_id","person_id","id"],""));
const teamIdOf=(o)=>String(pick(o,["team_id","team","constructor_id","constructor"],""));
const nice=(s)=>String(s||"Staff").replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase());

function overallOf(rating){
  const ignored=new Set(["staff_id","staff_name","year"]);
  const vals=Object.entries(rating||{}).filter(([k,v])=>!ignored.has(k)&&Number.isFinite(Number(v))).map(([,v])=>Number(v));
  return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):"—";
}

function department(role){
  const r=String(role||"").toLowerCase();
  if(/principal|owner|manager|director/.test(r)) return "Leadership";
  if(/aero|cfd|wind/.test(r)) return "Aero";
  if(/engineer|designer|technical|chassis/.test(r)) return "Technical";
  if(/mechanic|pit|operations/.test(r)) return "Operations";
  if(/scout/.test(r)) return "Scouting";
  if(/academy|youth/.test(r)) return "Academy";
  return "Staff";
}

export default function Staff(){
  const gs=useGame(s=>s.gameState);
  const year=Number(gs?.activeYear);
  const core=Array.isArray(gs?.staffCore)&&gs.staffCore.length?gs.staffCore:(gs?.dbStaffCore||[]);
  const ratings=Array.isArray(gs?.staffRatings)&&gs.staffRatings.length?gs.staffRatings:(gs?.dbStaffRatings||[]);
  const contracts=Array.isArray(gs?.staffContracts)?gs.staffContracts:(gs?.dbStaffContracts||[]);
  const teams=Array.isArray(gs?.teams)&&gs.teams.length?gs.teams:(gs?.dbTeams||[]);

  const [q,setQ]=useState("");
  const [dept,setDept]=useState("ALL");
  const [team,setTeam]=useState("ALL");
  const [market,setMarket]=useState("ALL");
  const [sort,setSort]=useState("overall");

  const coreById=useMemo(()=>new Map(core.map(s=>[staffIdOf(s),s])),[core]);
  const ratingById=useMemo(()=>new Map(ratings.map(r=>[staffIdOf(r),r])),[ratings]);
  const teamNameById=useMemo(()=>new Map(teams.map(t=>[String(t?.team_id??t?.id??""),t?.team_name||t?.name||"—"])),[teams]);

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
      return {
        id,
        name:pick(s,["staff_name","display_name","name"],pick(contract,["staff_name","name"],id)),
        role:roleLabel,
        primaryRole:staffRoleLabel(primaryRole),
        assignedRole:assignedRole?staffRoleLabel(assignedRole):"Free",
        dept:staffRoleDepartment(role),
        country:pick(s,["country_name","country","nationality"],"—"),
        code:pick(s,["country_code"],""),
        overall:overallOf(rating),
        team:contract?(teamNameById.get(tid)||pick(contract,["team_name"],"—")):"Free",
        salary:Number(pick(contract,["salary","salary_yearly"],0))||0,
        until:contract?pick(contract,["contract_until","contract_until_year","end_year","end_date"],"—"):"—",
      };
    });
  },[core,ratings,contracts,coreById,ratingById,year,teamNameById]);

  const depts=["ALL",...Array.from(new Set(rows.map(r=>r.dept))).sort()];
  const teamsOpt=["ALL",...Array.from(new Set(rows.map(r=>r.team))).sort()];
  const filtered=rows.filter(r=>{
    if(dept!=="ALL"&&r.dept!==dept)return false;
    if(team!=="ALL"&&r.team!==team)return false;
    if(market==="Free"&&r.team!=="Free")return false;
    if(market==="Contracted"&&r.team==="Free")return false;
    if(q&&![r.name,r.role,r.primaryRole,r.assignedRole,r.dept,r.country,r.team].some(v=>String(v).toLowerCase().includes(q.toLowerCase())))return false;
    return true;
  }).sort((a,b)=>{
    if(sort==="overall") return (Number(b.overall)||0)-(Number(a.overall)||0)||a.name.localeCompare(b.name);
    if(sort==="role") return a.role.localeCompare(b.role)||a.name.localeCompare(b.name);
    if(sort==="team") return a.team.localeCompare(b.team)||a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });

  return <div className="grid gap-4 text-slate-100">
    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <h2 className="text-lg font-semibold">All Staff</h2>
      <p className="text-sm text-slate-400">Season {year||"—"} · click a staff member to open the profile.</p>
      <div className="mt-3 flex flex-col lg:flex-row gap-2">
        <input className="flex-1 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" placeholder="Search name/role/team/nationality…" value={q} onChange={e=>setQ(e.target.value)}/>
        <button
          className={"rounded-md border px-3 py-2 text-sm " + (market==="Free" ? "border-sky-400/30 bg-sky-500/15 text-sky-200" : "border-white/10 bg-[#171a23] text-slate-200")}
          onClick={()=>setMarket(market==="Free"?"ALL":"Free")}
        >Free Staff</button>
        <select className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={market} onChange={e=>setMarket(e.target.value)}>
          <option value="ALL">All market</option>
          <option value="Contracted">Contracted</option>
          <option value="Free">Free</option>
        </select>
        <select className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={dept} onChange={e=>setDept(e.target.value)}>{depts.map(v=><option key={v}>{v}</option>)}</select>
        <select className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={team} onChange={e=>setTeam(e.target.value)}>{teamsOpt.map(v=><option key={v}>{v}</option>)}</select>
        <select className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100" value={sort} onChange={e=>setSort(e.target.value)}><option value="overall">Sort: Overall</option><option value="role">Sort: Role</option><option value="team">Sort: Team</option><option value="name">Sort: Name</option></select>
      </div>
    </div>

    <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#11141c] shadow-xl"><table className="min-w-full text-sm">
      <thead className="bg-white/[0.04] text-slate-400"><tr><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Primary Role</th><th className="px-4 py-3 text-left">Assigned Role</th><th className="px-4 py-3 text-left">Dept</th><th className="px-4 py-3 text-left">Team</th><th className="px-4 py-3 text-left">Nationality</th><th className="px-4 py-3 text-right">Overall</th><th className="px-4 py-3 text-right">Salary</th><th className="px-4 py-3 text-left">Contract</th></tr></thead>
      <tbody>{filtered.map(s=><tr key={s.id} className="border-t border-white/10 hover:bg-white/[0.04]">
        <td className="px-4 py-2"><button type="button" data-entity="staff" data-id={s.id} className="font-medium hover:underline text-left">{s.name}</button></td>
        <td className="px-4 py-2">{s.primaryRole}</td><td className="px-4 py-2">{s.assignedRole}</td><td className="px-4 py-2">{s.dept}</td><td className="px-4 py-2">{s.team}</td>
        <td className="px-4 py-2">{flagFromCountry(s.country,s.code)} {s.country}</td><td className="px-4 py-2 text-right font-semibold">{s.overall}</td>
        <td className="px-4 py-2 text-right">{s.salary?new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(s.salary):"—"}</td>
        <td className="px-4 py-2">{s.until}</td>
      </tr>)}
      {!filtered.length&&<tr><td colSpan={9} className="px-4 py-6 text-center text-slate-500">No staff found.</td></tr>}</tbody>
    </table></div>
  </div>;
}
