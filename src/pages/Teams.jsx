import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { TeamLogo, flagFromCountry } from "../components/entity/EntityVisuals.jsx";
import { teamReputation, teamReputationLabel } from "../domain/teamReputation.js";
import { contractActiveForYear } from "../domain/liveContracts.js";
import { canonicalStaffRole, resolveStaffId, staffRoleLabel } from "../domain/staffRoles.js";
import { canonicalTeamId, canonicalTeamName } from "../domain/teamIdentity.js";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const rawTeamIdOf=(o)=>String(pick(o,["team_id","constructor_id","id","team","constructor"],""));
const teamIdOf=(o)=>canonicalTeamId(rawTeamIdOf(o));

export default function Teams(){
  const gs=useGame(s=>s.gameState);
  const currentYear=Number(gs?.activeYear)||1980;
  const years=(gs?.yearsAvailable?.length ? gs.yearsAvailable : [currentYear]).filter((y)=>Number(y)<=currentYear);
  const [year,setYear]=useState(Number(gs?.activeYear)||Number(years[0])||1980);
  const [q,setQ]=useState("");
  const teams=gs?.dbTeams||[];
  const contracts=gs?.dbContracts||[];
  const staffContracts=gs?.dbStaffContracts||[];
  const brands=gs?.dbTeamBrands||[];
  const career=gs?.dbDriverCareer||[];
  const achievements=Array.isArray(gs?.dbAchievements)?gs.dbAchievements:(gs?.dbAchievements?.list||[]);
  const teamSeasons=Array.isArray(gs?.dbTeamSeasons)?gs.dbTeamSeasons:[];

  const rows=useMemo(()=>{
    const y=Number(year);
    const teamIds=new Set();

    const seasonRows=teamSeasons.filter((r)=>Number(pick(r,["year","season_year"],NaN))===y);
    for(const row of seasonRows){ const tid=teamIdOf(row); if(tid) teamIds.add(tid); }

    const brandRows=brands.filter((b)=>Number(pick(b,["year","season_year"],NaN))===y);
    for(const b of brandRows){ const tid=teamIdOf(b); if(tid) teamIds.add(tid); }

    for(const row of career){
      if(Number(pick(row,["year","season_year"],NaN))!==y) continue;
      if(String(pick(row,["series_division","division","series"],"")).toUpperCase()!=="F1") continue;
      const tid=teamIdOf(row); if(tid) teamIds.add(tid);
    }
    for(const row of achievements){
      if(Number(pick(row,["year","season_year"],NaN))!==y) continue;
      const tid=teamIdOf(row); if(tid) teamIds.add(tid);
    }
    for(const c of contracts){
      if(contractActiveForYear(c,y)){
        const tid=teamIdOf(c); if(tid) teamIds.add(tid);
      }
    }

    const sourceRaw=teamIds.size
      ? teams.filter((t)=>teamIds.has(teamIdOf(t)))
      : teams.filter((t)=>{
          const founded=Number(pick(t,["founded_year","first_year","start_year"],NaN));
          const endedRaw=pick(t,["end_year","defunct_year","last_year"],null);
          const ended=endedRaw==null||endedRaw===""?Infinity:Number(endedRaw);
          return Number.isFinite(founded)&&y>=founded&&y<=ended;
        });

    // Old saves/generated datasets may still contain the pre-canonical
    // t_0040 "Team Lotus" duplicate. Collapse aliases by canonical ID and
    // prefer the genuinely canonical master row when both are present.
    const sourceById=new Map();
    for(const team of sourceRaw){
      const id=teamIdOf(team);
      const rawId=rawTeamIdOf(team);
      const prev=sourceById.get(id);
      if(!prev||rawId===id)sourceById.set(id,team);
    }
    const source=[...sourceById.values()];

    const brandById=new Map(brandRows.map((b)=>[teamIdOf(b),b]));
    const seasonById=new Map(seasonRows.map((r)=>[teamIdOf(r),r]));
    return source.map(t=>{
      const id=teamIdOf(t);
      const driverCount=contracts.filter(c=>contractActiveForYear(c,y)&&teamIdOf(c)===id&&String(pick(c,["role","position"],"")).toLowerCase().includes("driver")).length;
      const assignedStaff=staffContracts.filter(c=>contractActiveForYear(c,y)&&teamIdOf(c)===id);
      const staffAssignments=assignedStaff.map((row)=>({
        id:resolveStaffId(gs,row),
        name:pick(row,["staff_name","name","person_name"],"Staff"),
        role:staffRoleLabel(pick(row,["role","position"],"Staff")),
        canonicalRole:canonicalStaffRole(pick(row,["role","position"],"Staff")),
      }));
      const principal=staffAssignments.find((row)=>["team_principal","owner"].includes(row.canonicalRole))||null;
      const staffRoles=staffAssignments.map((row)=>row.role);
      const brand=brandById.get(id)||{};
      const seasonRec=seasonById.get(id)||{};
      return {
        id,
        name:canonicalTeamName(pick(brand,["team_name","team_official_name","short_name"],pick(seasonRec,["team_name"],pick(t,["team_name","name","short_name"],id)))),
        shortName:pick(brand,["short_name"],pick(t,["short_name"],"")),
        country:pick(t,["team_base","country","base"],""),
        code:pick(t,["country_code"],""),
        founded:pick(t,["founded_year"],"—"),
        drivers:driverCount ||
          Number(pick(seasonRec,["driver_count"],0)) ||
          career.filter((r)=>
            Number(pick(r,["year"],NaN))===y &&
            String(pick(r,["series_division"],"")).toUpperCase()==="F1" &&
            teamIdOf(r)===id
          ).length,
        principal:principal?.name||"—",
        staffCount:assignedStaff.length,
        staffRoles,
        staffAssignments,
        reputation:y===currentYear?teamReputation(gs,id):null,
      };
    }).sort((a,b)=>a.name.localeCompare(b.name));
  },[teams,contracts,staffContracts,brands,career,achievements,teamSeasons,year,currentYear,gs]);

  const filtered=rows.filter(r=>!q||[`${r.name}`,`${r.country}`,`${r.principal}`].some(v=>v.toLowerCase().includes(q.toLowerCase())));

  return <div className="grid gap-4 text-slate-100">
    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div><h2 className="text-xl font-semibold">All Teams</h2><p className="text-sm text-slate-400">Teams active in the selected season.</p></div>
        <div className="flex-1"/>
        <select className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" value={year} onChange={e=>setYear(Number(e.target.value))}>
          {years.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <input className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" placeholder="Search team…" value={q} onChange={e=>setQ(e.target.value)}/>
      </div>
    </div>

    <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#11141c] shadow-xl">
      <table className="min-w-full text-sm">
        <thead className="bg-white/[0.04] text-slate-400"><tr>
          <th className="px-4 py-3 text-left">Team</th><th className="px-4 py-3 text-left">Country / Base</th>
          <th className="px-4 py-3 text-left">Principal / Owner</th><th className="px-4 py-3 text-left">Staff assignments</th><th className="px-4 py-3 text-right">Drivers</th><th className="px-4 py-3 text-right">Reputation</th><th className="px-4 py-3 text-right">Founded</th>
        </tr></thead>
        <tbody>{filtered.map(t=><tr key={t.id} className="border-t border-white/10 hover:bg-white/[0.04]">
          <td className="px-4 py-2">
            <button type="button" data-entity="team" data-id={t.id} className="flex items-center gap-3 font-medium hover:underline text-left">
              <TeamLogo teamId={t.id} name={t.name} size="h-9 w-9"/><span>{t.name}</span>
            </button>
          </td>
          <td className="px-4 py-2">{flagFromCountry(t.country,t.code)} {t.country||"—"}</td>
          <td className="px-4 py-2">{t.principal}</td>
          <td className="px-4 py-2">
            <div className="font-medium">{t.staffCount}</div>
            <div className="mt-0.5 max-w-[360px] space-y-0.5 text-xs text-slate-500">
              {(t.staffAssignments||[]).slice(0,3).map((assignment,index)=><div key={assignment.id||assignment.name+"_"+index} className="truncate" title={assignment.role+" · "+assignment.name}>
                <span className="text-slate-600">{assignment.role}:</span>{" "}
                {assignment.id?<button type="button" data-entity="staff" data-id={assignment.id} className="text-slate-400 hover:text-slate-200 hover:underline">{assignment.name}</button>:<span>{assignment.name}</span>}
              </div>)}
              {(t.staffAssignments||[]).length>3?<div className="text-slate-600">+{t.staffAssignments.length-3} more</div>:null}
              {!t.staffAssignments?.length?<div>—</div>:null}
            </div>
          </td>
          <td className="px-4 py-2 text-right">{t.drivers}</td>
          <td className="px-4 py-2 text-right">
            {t.reputation!=null?(
              <span className={Number(t.reputation)>=72?"font-semibold text-emerald-300":Number(t.reputation)<48?"font-semibold text-rose-300":"font-medium text-slate-300"}>
                {Math.round(Number(t.reputation))} · {teamReputationLabel(t.reputation)}
              </span>
            ):"—"}
          </td>
          <td className="px-4 py-2 text-right">{t.founded}</td>
        </tr>)}
        {!filtered.length&&<tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No teams found for {year}.</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
