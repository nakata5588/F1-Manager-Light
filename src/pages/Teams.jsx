import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { TeamLogo, flagFromCountry } from "../components/entity/EntityVisuals.jsx";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","id","team","constructor"],""));

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
      if(Number(pick(c,["year","season_year"],NaN))===y){
        const tid=teamIdOf(c); if(tid) teamIds.add(tid);
      }
    }

    const source=teamIds.size
      ? teams.filter((t)=>teamIds.has(teamIdOf(t)))
      : teams.filter((t)=>{
          const founded=Number(pick(t,["founded_year","first_year","start_year"],NaN));
          const endedRaw=pick(t,["end_year","defunct_year","last_year"],null);
          const ended=endedRaw==null||endedRaw===""?Infinity:Number(endedRaw);
          return Number.isFinite(founded)&&y>=founded&&y<=ended;
        });

    const brandById=new Map(brandRows.map((b)=>[teamIdOf(b),b]));
    const seasonById=new Map(seasonRows.map((r)=>[teamIdOf(r),r]));
    return source.map(t=>{
      const id=teamIdOf(t);
      const driverCount=contracts.filter(c=>Number(pick(c,["year","season_year"],NaN))===Number(year)&&teamIdOf(c)===id&&String(pick(c,["role","position"],"")).toLowerCase().includes("driver")).length;
      const principal=staffContracts.find(c=>Number(pick(c,["year","season_year"],NaN))===Number(year)&&teamIdOf(c)===id&&/principal|owner/i.test(String(pick(c,["role","position"],""))));
      const brand=brandById.get(id)||{};
      const seasonRec=seasonById.get(id)||{};
      return {
        id,
        name:pick(brand,["team_name","team_official_name","short_name"],pick(seasonRec,["team_name"],pick(t,["team_name","name","short_name"],id))),
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
        principal:pick(principal,["staff_name","name"],"—"),
      };
    }).sort((a,b)=>a.name.localeCompare(b.name));
  },[teams,contracts,staffContracts,brands,career,achievements,teamSeasons,year]);

  const filtered=rows.filter(r=>!q||[`${r.name}`,`${r.country}`,`${r.principal}`].some(v=>v.toLowerCase().includes(q.toLowerCase())));

  return <div className="grid gap-4">
    <div className="bg-white rounded-xl shadow p-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div><h2 className="text-xl font-semibold">All Teams</h2><p className="text-sm text-gray-500">Teams active in the selected season.</p></div>
        <div className="flex-1"/>
        <select className="border rounded-md px-3 py-2 text-sm" value={year} onChange={e=>setYear(Number(e.target.value))}>
          {years.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <input className="border rounded-md px-3 py-2 text-sm" placeholder="Search team…" value={q} onChange={e=>setQ(e.target.value)}/>
      </div>
    </div>

    <div className="bg-white rounded-xl shadow overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50"><tr>
          <th className="px-4 py-3 text-left">Team</th><th className="px-4 py-3 text-left">Country / Base</th>
          <th className="px-4 py-3 text-left">Principal / Owner</th><th className="px-4 py-3 text-right">Drivers</th><th className="px-4 py-3 text-right">Founded</th>
        </tr></thead>
        <tbody>{filtered.map(t=><tr key={t.id} className="border-t hover:bg-gray-50">
          <td className="px-4 py-2">
            <button type="button" data-entity="team" data-id={t.id} className="flex items-center gap-3 font-medium hover:underline text-left">
              <TeamLogo teamId={t.id} name={t.name} size="h-9 w-9"/><span>{t.name}</span>
            </button>
          </td>
          <td className="px-4 py-2">{flagFromCountry(t.country,t.code)} {t.country||"—"}</td>
          <td className="px-4 py-2">{t.principal}</td>
          <td className="px-4 py-2 text-right">{t.drivers}</td>
          <td className="px-4 py-2 text-right">{t.founded}</td>
        </tr>)}
        {!filtered.length&&<tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">No teams found for {year}.</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
