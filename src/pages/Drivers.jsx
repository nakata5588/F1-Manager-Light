import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { ageOn } from "../utils/date.js";
import { DriverPortrait, flagFromCountry } from "../components/entity/EntityVisuals.jsx";

const idOf=(o)=>String(o?.driver_id??o?.person_id??o?.id??"");
const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor"],""));
const nameOf=(d)=>d?.display_name||d?.name||d?.driver_name||`${d?.first_name??""} ${d?.last_name??""}`.trim()||idOf(d)||"—";

function marketStatus(driver, contract){
  if(contract) return "Contracted";
  if(driver?.status==="junior_only" || driver?.canHireAcademy) return "Youth";
  if(driver?.status==="lower_series") return "Lower Series";
  if(driver?.canHireF1 || driver?.status==="eligible") return "Free";
  return "Available";
}

export default function Drivers(){
  const gs=useGame(s=>s.gameState);
  const drivers=Array.isArray(gs?.drivers)?gs.drivers:[];
  const ratings=Array.isArray(gs?.driverRatings)?gs.driverRatings:[];
  const contracts=Array.isArray(gs?.contracts)?gs.contracts:[];
  const teams=Array.isArray(gs?.teams)?gs.teams:[];
  const activeYear=Number(gs?.activeYear);

  const [q,setQ]=useState("");
  const [team,setTeam]=useState("ALL");
  const [status,setStatus]=useState("ALL");
  const [sortKey,setSortKey]=useState("name");
  const [sortDir,setSortDir]=useState("asc");
  const [page,setPage]=useState(1);
  const PAGE_SIZE=16;

  const teamNames=useMemo(()=>new Map(teams.map(t=>[String(t?.team_id??t?.id??""),t?.team_name||t?.name||t?.short_name||"—"])),[teams]);
  const ratingById=useMemo(()=>new Map(ratings.map(r=>[idOf(r),r])),[ratings]);
  const contractById=useMemo(()=>{
    const m=new Map();
    for(const c of contracts){
      const id=idOf(c); if(!id) continue;
      const role=String(pick(c,["role","position","contract_role"],"")).toLowerCase();
      if(role&&!role.includes("driver")) continue;
      const y=Number(pick(c,["year","season_year"],activeYear));
      if(Number.isFinite(activeYear)&&Number.isFinite(y)&&y!==activeYear) continue;
      if(!m.has(id)) m.set(id,c);
    }
    return m;
  },[contracts,activeYear]);

  const rows=useMemo(()=>drivers.map(d=>{
    const id=idOf(d), rating=ratingById.get(id)||{}, contract=contractById.get(id)||null;
    const tid=teamIdOf(contract)||teamIdOf(d);
    const ms=marketStatus(d,contract);
    return {
      ...d,id,name:nameOf(d),
      team_id:tid||null,
      team_name:contract?(teamNames.get(tid)||pick(contract,["team_name"],"—")):"—",
      nationality:pick(d,["country_name","nationality","country"],"—"),
      country_code:pick(d,["country_code","nationality_code"],""),
      age:d?.age??ageOn(gs?.currentDateISO,d?.birthdate??d?.dob),
      overall:pick(rating,["current_ability","overall","pace"],"—"),
      contract_until:contract?pick(contract,["contract_until_year","contract_until","end_year","end_date"],"—"):"—",
      market_status:ms,
    };
  }),[drivers,ratingById,contractById,teamNames,gs?.currentDateISO]);

  const teamOptions=useMemo(()=>["ALL",...Array.from(new Set(rows.map(r=>r.team_name).filter(v=>v&&v!=="—"))).sort()],[rows]);
  const statusOptions=["ALL","Contracted","Free","Youth","Lower Series","Available"];

  const filtered=useMemo(()=>{
    const n=q.trim().toLowerCase();
    return rows.filter(r=>{
      if(n&&![r.name,r.team_name,r.nationality,r.market_status].some(v=>String(v??"").toLowerCase().includes(n))) return false;
      if(team!=="ALL"&&r.team_name!==team) return false;
      if(status!=="ALL"&&r.market_status!==status) return false;
      return true;
    });
  },[rows,q,team,status]);

  const sorted=useMemo(()=>[...filtered].sort((a,b)=>{
    const av=a[sortKey],bv=b[sortKey],an=Number(av),bn=Number(bv);
    const cmp=(av!=="—"&&bv!=="—"&&Number.isFinite(an)&&Number.isFinite(bn))?an-bn:String(av??"").localeCompare(String(bv??""),undefined,{numeric:true,sensitivity:"base"});
    return sortDir==="asc"?cmp:-cmp;
  }),[filtered,sortKey,sortDir]);

  const pages=Math.max(1,Math.ceil(sorted.length/PAGE_SIZE));
  const p=Math.min(page,pages);
  const paged=sorted.slice((p-1)*PAGE_SIZE,p*PAGE_SIZE);

  const headers=[
    ["name","Driver"],["team_name","Team"],["nationality","Nationality"],["market_status","Status"],
    ["age","Age"],["overall","Overall"],["contract_until","Contract"]
  ];

  return <div className="grid gap-4">
    <div className="bg-white rounded-xl shadow p-4">
      <h2 className="text-lg font-semibold">All Drivers</h2>
      <p className="text-sm text-gray-500">Visible driver market for season {activeYear||"—"} · contracted, free and youth talent.</p>
      <div className="mt-3 flex flex-col lg:flex-row gap-2">
        <input className="border rounded-md px-3 py-2 text-sm flex-1" placeholder="Search driver/team/nationality/status…" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/>
        <select className="border rounded-md px-3 py-2 text-sm" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{statusOptions.map(v=><option key={v}>{v}</option>)}</select>
        <select className="border rounded-md px-3 py-2 text-sm" value={team} onChange={e=>{setTeam(e.target.value);setPage(1);}}>{teamOptions.map(v=><option key={v}>{v}</option>)}</select>
        <select className="border rounded-md px-3 py-2 text-sm" value={sortKey} onChange={e=>setSortKey(e.target.value)}>{headers.map(([k,l])=><option key={k} value={k}>Sort: {l}</option>)}</select>
        <button className="border rounded-md px-3 py-2 text-sm" onClick={()=>setSortDir(d=>d==="asc"?"desc":"asc")}>{sortDir==="asc"?"Asc ↑":"Desc ↓"}</button>
      </div>
    </div>

    <div className="bg-white rounded-xl shadow overflow-x-auto"><table className="min-w-full text-sm">
      <thead className="bg-gray-50"><tr>{headers.map(([k,l])=><th key={k} className="px-4 py-3 text-left cursor-pointer" onClick={()=>{if(sortKey===k)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortKey(k);setSortDir("asc");}}}>{l}{sortKey===k?(sortDir==="asc"?" ↑":" ↓"):""}</th>)}</tr></thead>
      <tbody>{paged.map(d=><tr key={d.id} className="border-t hover:bg-gray-50">
        <td className="px-4 py-2"><button type="button" data-entity="driver" data-id={d.id} className="flex items-center gap-3 font-medium hover:underline text-left"><DriverPortrait driver={d} size="h-10 w-10"/><span>{d.name}</span></button></td>
        <td className="px-4 py-2">{d.team_name}</td>
        <td className="px-4 py-2">{flagFromCountry(d.nationality,d.country_code)} {d.nationality}</td>
        <td className="px-4 py-2"><span className="px-2 py-1 rounded bg-gray-100 text-xs">{d.market_status}</span></td>
        <td className="px-4 py-2">{d.age??"—"}</td><td className="px-4 py-2 font-semibold">{d.overall}</td><td className="px-4 py-2">{d.contract_until}</td>
      </tr>)}
      {!paged.length&&<tr><td colSpan={headers.length} className="px-4 py-6 text-center text-gray-500">No drivers found.</td></tr>}</tbody>
    </table></div>

    <div className="flex items-center justify-between text-sm"><span className="text-gray-600">{sorted.length} results · Page {p}/{pages}</span><div className="flex gap-2"><button className="border rounded px-3 py-1 disabled:opacity-40" disabled={p<=1} onClick={()=>setPage(x=>Math.max(1,x-1))}>Prev</button><button className="border rounded px-3 py-1 disabled:opacity-40" disabled={p>=pages} onClick={()=>setPage(x=>Math.min(pages,x+1))}>Next</button></div></div>
  </div>;
}
