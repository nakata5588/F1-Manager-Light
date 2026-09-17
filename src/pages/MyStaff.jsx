import React, { useMemo } from "react";
import { useGame } from "../state/GameStore.js";
import { TeamLogo, flagFromCountry } from "../components/entity/EntityVisuals.jsx";

const pick = (o, keys, fb = undefined) => {
  for (const k of keys) {
    const raw=o?.[k];
    const v=raw && typeof raw==="object" && !Array.isArray(raw) ? (raw.result ?? raw.value ?? raw) : raw;
    if(v!==undefined && v!==null && v!=="") return v;
  }
  return fb;
};
const staffIdOf=(o)=>String(pick(o,["staff_id","person_id","id"],""));
const teamIdOf=(o)=>String(pick(o,["team_id","team","constructor_id","constructor"],""));
const nice=(s)=>String(s||"Staff").replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase());

function overallOf(rating){
  const ignore=new Set(["staff_id","staff_name","year"]);
  const vals=Object.entries(rating||{}).filter(([k,v])=>!ignore.has(k) && Number.isFinite(Number(v))).map(([,v])=>Number(v));
  return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : "—";
}

export default function MyStaff(){
  const gs=useGame(s=>s.gameState);
  const year=Number(gs?.activeYear);
  const myTeamId=String(gs?.team?.team_id ?? gs?.team?.id ?? "");
  const myTeamName=gs?.team?.team_name || gs?.team?.name || "My Team";
  const contracts=gs?.staffContracts?.length ? gs.staffContracts : gs?.dbStaffContracts || [];
  const staffCore=gs?.staffCore?.length ? gs.staffCore : gs?.dbStaffCore || [];
  const ratings=gs?.staffRatings?.length ? gs.staffRatings : gs?.dbStaffRatings || [];

  const coreById=useMemo(()=>new Map(staffCore.map(s=>[staffIdOf(s),s])),[staffCore]);
  const ratingById=useMemo(()=>new Map(ratings.map(r=>[staffIdOf(r),r])),[ratings]);

  const rows=useMemo(()=>contracts.filter(c=>{
    const cy=Number(pick(c,["year","season_year"],year));
    return teamIdOf(c)===myTeamId && (!Number.isFinite(year)||!Number.isFinite(cy)||cy===year);
  }).map(c=>{
    const id=staffIdOf(c);
    const core=coreById.get(id)||{};
    const rating=ratingById.get(id)||{};
    return {
      id,
      name:pick(core,["staff_name","display_name","name"],pick(c,["staff_name","name"],id)),
      role:nice(pick(c,["role","position"],pick(core,["role_primary"],"Staff"))),
      country:pick(core,["country_name","country","nationality"],""),
      code:pick(core,["country_code"],""),
      overall:overallOf(rating),
      salary:Number(pick(c,["salary","salary_yearly"],0))||0,
      until:pick(c,["contract_until","contract_until_year","end_year","end_date"],"—"),
    };
  }).sort((a,b)=>String(a.role).localeCompare(String(b.role))||String(a.name).localeCompare(String(b.name))),[contracts,year,myTeamId,coreById,ratingById]);

  return <div className="grid gap-4">
    <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
      <TeamLogo teamId={myTeamId} name={myTeamName} size="h-12 w-12"/>
      <div><h2 className="text-xl font-semibold">My Staff</h2><p className="text-sm text-gray-500">{myTeamName} · Season {year||"—"}</p></div>
    </div>
    <div className="bg-white rounded-xl shadow overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50"><tr>
          <th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Role</th>
          <th className="px-4 py-3 text-left">Nationality</th><th className="px-4 py-3 text-right">Overall</th>
          <th className="px-4 py-3 text-right">Salary</th><th className="px-4 py-3 text-left">Contract</th>
        </tr></thead>
        <tbody>{rows.map(s=><tr key={s.id} className="border-t hover:bg-gray-50">
          <td className="px-4 py-2"><button data-entity="staff" data-id={s.id} className="font-medium hover:underline">{s.name}</button></td>
          <td className="px-4 py-2">{s.role}</td>
          <td className="px-4 py-2">{flagFromCountry(s.country,s.code)} {s.country||"—"}</td>
          <td className="px-4 py-2 text-right font-semibold">{s.overall}</td>
          <td className="px-4 py-2 text-right">{s.salary?new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(s.salary):"—"}</td>
          <td className="px-4 py-2">{s.until}</td>
        </tr>)}
        {!rows.length&&<tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No staff contracts found for this team.</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
