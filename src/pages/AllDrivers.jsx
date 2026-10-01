import React,{useMemo,useState} from "react";
import {useGame} from "../state/GameStore.js";
import {DriverPortrait,flagFromCountry} from "../components/entity/EntityVisuals.jsx";
import {activeDriverContracts} from "../domain/driverContracts.js";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const idOf=(row)=>text(row?.driver_id??row?.person_id??row?.id);
const titleCase=(value)=>text(value).replaceAll("_"," ").replace(/\b\w/g,(char)=>char.toUpperCase());

function driverName(row){
  return text(row?.display_name??row?.driver_name??row?.name)||
    `${text(row?.first_name)} ${text(row?.last_name)}`.trim()||
    idOf(row)||
    "—";
}

function lifecycleLabel(driver,contract){
  const status=text(driver?.status).toLowerCase();
  if(status==="deceased")return "Deceased";
  if(status==="retired")return "Retired";
  if(status==="hidden")return "Historical";
  if(driver?.active_lower_series===true||["lower_series","junior_only"].includes(status))return "Lower Series";
  if(contract)return "Active F1";
  if(status==="eligible"||driver?.canHireF1===true)return "F1 Eligible";
  if(status)return titleCase(status);
  return "Historical";
}

export default function AllDrivers(){
  const gs=useGame((state)=>state.gameState);
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState("ALL");
  const [page,setPage]=useState(1);
  const PAGE_SIZE=30;

  const teamNames=useMemo(()=>{
    const map=new Map();
    for(const team of [...rows(gs?.dbTeams),...rows(gs?.teams)]){
      const id=text(team?.team_id??team?.constructor_id??team?.id);
      if(id)map.set(id,text(team?.short_name??team?.team_name??team?.name)||id);
    }
    return map;
  },[gs?.dbTeams,gs?.teams]);

  const contractByDriver=useMemo(()=>{
    const map=new Map();
    for(const contract of activeDriverContracts(gs)){
      const id=idOf(contract);
      if(id&&!map.has(id))map.set(id,contract);
    }
    return map;
  },[gs]);

  const all=useMemo(()=>{
    const map=new Map();
    for(const driver of [...rows(gs?.dbDrivers),...rows(gs?.drivers)]){
      const id=idOf(driver);
      if(!id)continue;
      map.set(id,{...(map.get(id)||{}),...driver,driver_id:id});
    }
    return [...map.values()].map((driver)=>{
      const id=idOf(driver);
      const contract=contractByDriver.get(id)||null;
      const teamId=text(contract?.team_id??contract?.constructor_id??driver?.team_id??driver?.constructor_id);
      const nationality=text(driver?.country_name??driver?.nationality??driver?.country)||"—";
      return {
        ...driver,
        id,
        name:driverName(driver),
        nationality,
        country_code:text(driver?.country_code??driver?.nationality_code),
        lifecycle:lifecycleLabel(driver,contract),
        team_name:teamId?(teamNames.get(teamId)||text(contract?.team_name)||teamId):"—",
        birth:text(driver?.birthdate??driver?.dob??driver?.date_of_birth),
        death:text(driver?.deathdate??driver?.date_of_death),
      };
    }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
  },[gs?.dbDrivers,gs?.drivers,contractByDriver,teamNames]);

  const statuses=useMemo(()=>["ALL",...Array.from(new Set(all.map((driver)=>driver.lifecycle))).sort()],[all]);
  const filtered=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    return all.filter((driver)=>{
      if(status!=="ALL"&&driver.lifecycle!==status)return false;
      if(!needle)return true;
      return [driver.name,driver.id,driver.nationality,driver.lifecycle,driver.team_name]
        .some((value)=>text(value).toLowerCase().includes(needle));
    });
  },[all,query,status]);

  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const currentPage=Math.min(page,pages);
  const visible=filtered.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);

  return <div className="grid gap-4 text-slate-100">
    <div className="rounded-xl border border-white/10 bg-[#11141c] p-4 shadow-xl">
      <h1 className="text-xl font-semibold">All Drivers</h1>
      <p className="mt-1 text-sm text-slate-400">World directory across the full database and the current Save World, including active, junior, retired and deceased drivers.</p>
      <div className="mt-4 flex flex-col gap-2 md:flex-row">
        <input
          value={query}
          onChange={(event)=>{setQuery(event.target.value);setPage(1);}}
          placeholder="Search driver, ID, nationality, team or status…"
          className="flex-1 rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
        />
        <select
          value={status}
          onChange={(event)=>{setStatus(event.target.value);setPage(1);}}
          className="rounded-md border border-white/10 bg-[#171a23] px-3 py-2 text-sm text-slate-100"
        >
          {statuses.map((value)=><option key={value} value={value}>{value==="ALL"?"All statuses":value}</option>)}
        </select>
      </div>
    </div>

    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#11141c] shadow-xl">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-white/[0.04] text-slate-400"><tr>
            <th className="px-4 py-3 text-left">Driver</th>
            <th className="px-4 py-3 text-left">Nationality</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-left">Current Team</th>
            <th className="px-4 py-3 text-left">Born</th>
            <th className="px-4 py-3 text-left">Died</th>
            <th className="px-4 py-3 text-left">ID</th>
          </tr></thead>
          <tbody>{visible.map((driver)=><tr key={driver.id} className="border-t border-white/10 hover:bg-white/[0.04]">
            <td className="px-4 py-2">
              <button type="button" data-entity="driver" data-id={driver.id} className="flex items-center gap-3 text-left font-medium hover:underline">
                <DriverPortrait driver={driver} size="h-10 w-10"/>
                <span>{driver.name}</span>
              </button>
            </td>
            <td className="px-4 py-2">{flagFromCountry(driver.nationality,driver.country_code)} {driver.nationality}</td>
            <td className="px-4 py-2"><span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">{driver.lifecycle}</span></td>
            <td className="px-4 py-2 text-slate-300">{driver.team_name}</td>
            <td className="px-4 py-2 text-slate-400">{driver.birth||"—"}</td>
            <td className="px-4 py-2 text-slate-400">{driver.death||"—"}</td>
            <td className="px-4 py-2 font-mono text-xs text-slate-500">{driver.id}</td>
          </tr>)}
          {!visible.length?<tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No drivers found.</td></tr>:null}</tbody>
        </table>
      </div>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#11141c] px-3 py-2 text-sm">
      <span className="text-slate-400">{filtered.length} drivers · Page {currentPage}/{pages}</span>
      <div className="flex gap-2">
        <button className="rounded border border-white/10 bg-white/5 px-3 py-1.5 disabled:opacity-40" disabled={currentPage<=1} onClick={()=>setPage((value)=>Math.max(1,value-1))}>Prev</button>
        <button className="rounded border border-white/10 bg-white/5 px-3 py-1.5 disabled:opacity-40" disabled={currentPage>=pages} onClick={()=>setPage((value)=>Math.min(pages,value+1))}>Next</button>
      </div>
    </div>
  </div>;
}
