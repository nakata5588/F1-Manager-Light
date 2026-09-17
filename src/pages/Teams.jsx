import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { TeamLogo, flagFromCountry } from "../components/entity/EntityVisuals.jsx";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","id","team","constructor"],""));

export default function Teams(){
  const gs=useGame(s=>s.gameState);
  const years=gs?.yearsAvailable?.length ? gs.yearsAvailable : [gs?.activeYear||1980];
  const [year,setYear]=useState(Number(gs?.activeYear)||Number(years[0])||1980);
  const [q,setQ]=useState("");
  const teams=gs?.dbTeams||[];
  const contracts=gs?.dbContracts||[];
  const staffContracts=gs?.dbStaffContracts||[];

  const rows=useMemo(()=>{
    const teamIds=new Set();
    for(const c of contracts){
      const cy=Number(pick(c,["year","season_year"],NaN));
      if(cy===Number(year)) {
        const tid=teamIdOf(c); if(tid) teamIds.add(tid);
      }
    }
    for(const c of staffContracts){
      const cy=Number(pick(c,["year","season_year"],NaN));
      if(cy===Number(year)) {
        const tid=teamIdOf(c); if(tid) teamIds.add(tid);
      }
    }
    const source=teamIds.size?teams.filter(t=>teamIds.has(teamIdOf(t))):teams.filter(t=>{
      const founded=Number(pick(t,["founded_year","first_year","start_year"],-Infinity));
      const ended=Number(pick(t,["end_year","defunct_year","last_year"],Infinity));
      return Number(year)>=founded && Number(year)<=ended;
    });
    return source.map(t=>{
      const id=teamIdOf(t);
      const driverCount=contracts.filter(c=>Number(pick(c,["year","season_year"],NaN))===Number(year)&&teamIdOf(c)===id&&String(pick(c,["role","position"],"")).toLowerCase().includes("driver")).length;
      const principal=staffContracts.find(c=>Number(pick(c,["year","season_year"],NaN))===Number(year)&&teamIdOf(c)===id&&/principal|owner/i.test(String(pick(c,["role","position"],""))));
      return {
        id,
        name:pick(t,["team_name","name","short_name"],id),
        shortName:pick(t,["short_name"],""),
        country:pick(t,["team_base","country","base"],""),
        code:pick(t,["country_code"],""),
        founded:pick(t,["founded_year"],"—"),
        drivers:driverCount,
        principal:pick(principal,["staff_name","name"],"—"),
      };
    }).sort((a,b)=>a.name.localeCompare(b.name));
  },[teams,contracts,staffContracts,year]);

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
