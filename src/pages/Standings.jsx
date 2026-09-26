import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { DriverPortrait, TeamLogo } from "../components/entity/EntityVisuals.jsx";
import { aggregateHistoricalConstructors, aggregateHistoricalDrivers } from "../domain/championshipHistory.js";

const str=(v)=>(v==null?"":String(v));
const firstArray=(...items)=>items.find(Array.isArray)||[];
const num=(v,fb=0)=>Number.isFinite(Number(v))?Number(v):fb;

function driverName(driver,fallback="—"){
  return driver?.display_name||driver?.name||`${driver?.first_name??""} ${driver?.last_name??""}`.trim()||fallback;
}
function teamName(team,fallback="—"){
  return team?.team_name||team?.name||team?.short_name||fallback;
}
function resultYear(row){return Number(row?.year??row?.season_year);}
function finishPosition(row,index){return Number(row?.position??row?.pos??index+1);}
function isRetired(row){return Boolean(row?.retired)||String(row?.status||"").toUpperCase()==="DNF";}
function qualifyingPoleIds(race){
  return new Set((race?.qualifying||[])
    .filter((row,index)=>Number(row?.position??index+1)===1&&row?.driver_id!=null)
    .map((row)=>String(row.driver_id)));
}

function aggregateCareerResults(results,year,driversById,teamsById){
  const driverMap=new Map();
  const teamMap=new Map();

  for(const race of results.filter((r)=>resultYear(r)===Number(year))){
    const raceKey=String(race?.key??`${year}_${race?.round??race?.gp_id??race?.name??"race"}`);
    const poleIds=qualifyingPoleIds(race);
    for(const [index,row] of (race?.classification||[]).entries()){
      const did=str(row?.driver_id??row?.id);
      if(!did)continue;
      const tid=str(row?.team_id??row?.constructor_id);
      const pos=finishPosition(row,index);
      const retired=isRetired(row);
      const points=num(row?.points,0);
      const dbDriver=driversById.get(did);
      const dbTeam=teamsById.get(tid);

      const d=driverMap.get(did)||{
        id:did,name:driverName(dbDriver,did),teamId:tid,teamName:teamName(dbTeam,tid||"—"),
        points:0,races:0,wins:0,podiums:0,fastestLaps:0,poles:0,dnfs:0,bestFinish:null,finishSum:0,finishCount:0,
        driver:dbDriver||{driver_id:did,display_name:did},_teamStarts:new Map(),
      };
      d.points+=points;
      d.races+=1;
      if(!retired&&pos===1)d.wins+=1;
      if(!retired&&pos>=1&&pos<=3)d.podiums+=1;
      if(row?.fastest_lap)d.fastestLaps+=1;
      if(poleIds.has(did))d.poles+=1;
      if(retired)d.dnfs+=1;
      if(Number.isFinite(pos)&&pos>0){
        d.finishSum+=pos;
        d.finishCount+=1;
        d.bestFinish=d.bestFinish==null?pos:Math.min(d.bestFinish,pos);
      }
      if(tid)d._teamStarts.set(tid,(d._teamStarts.get(tid)||0)+1);
      driverMap.set(did,d);

      if(tid){
        const t=teamMap.get(tid)||{
          id:tid,name:teamName(dbTeam,row?.team_name||tid),points:0,wins:0,podiums:0,fastestLaps:0,poles:0,dnfs:0,races:new Set(),
          team:dbTeam||{team_id:tid,team_name:row?.team_name||tid},
        };
        t.points+=points;
        t.races.add(raceKey);
        if(!retired&&pos===1)t.wins+=1;
        if(!retired&&pos>=1&&pos<=3)t.podiums+=1;
        if(row?.fastest_lap)t.fastestLaps+=1;
        if(poleIds.has(did))t.poles+=1;
        if(retired)t.dnfs+=1;
        teamMap.set(tid,t);
      }
    }
  }

  const drivers=[...driverMap.values()].map((row)=>{
    const preferred=[...row._teamStarts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||row.teamId;
    return {
      ...row,
      teamId:preferred,
      teamName:teamName(teamsById.get(preferred),preferred||row.teamName),
      averageFinish:row.finishCount?Number((row.finishSum/row.finishCount).toFixed(2)):null,
      pointsPerRace:row.races?Number((row.points/row.races).toFixed(2)):0,
      _teamStarts:undefined,finishSum:undefined,finishCount:undefined,
    };
  }).sort((a,b)=>b.points-a.points||b.wins-a.wins||a.name.localeCompare(b.name));

  const teams=[...teamMap.values()].map((row)=>({
    ...row,
    races:row.races.size,
    pointsPerRace:row.races.size?Number((row.points/row.races.size).toFixed(2)):0,
  })).sort((a,b)=>b.points-a.points||b.wins-a.wins||a.name.localeCompare(b.name));

  return {drivers,teams};
}

function aggregateHistorical(history,year,driversById,teamsById,championships){
  const drivers=aggregateHistoricalDrivers(history,year,driversById,teamsById,championships).map((row)=>({
    ...row,
    teamId:row.team_id,
    teamName:row.team_name,
    driver:driversById.get(row.id)||{driver_id:row.id,display_name:row.name},
  }));
  const teams=aggregateHistoricalConstructors(history,year,teamsById,championships).map((row)=>({
    ...row,
    team:teamsById.get(row.id)||{team_id:row.id,team_name:row.name},
  }));
  return {drivers,teams};
}

export default function Standings(){
  const gameState=useGame((s)=>s.gameState);
  const activeYear=Number(gameState?.activeYear);
  const [tab,setTab]=useState("teams");
  const [yearFilter,setYearFilter]=useState(()=>String(activeYear||""));

  useEffect(()=>{ if(Number.isFinite(activeYear))setYearFilter(String(activeYear)); },[activeYear]);

  const liveDriversDb=Array.isArray(gameState?.drivers)?gameState.drivers:[];
  const seedDriversDb=Array.isArray(gameState?.dbDrivers)?gameState.dbDrivers:[];
  const liveTeamsDb=Array.isArray(gameState?.teams)?gameState.teams:[];
  const seedTeamsDb=Array.isArray(gameState?.dbTeams)?gameState.dbTeams:[];
  const liveStandings=gameState?.standings||{drivers:[],teams:[]};
  const results=Array.isArray(gameState?.results)?gameState.results:[];
  const history=Array.isArray(gameState?.dbDriverHistory)?gameState.dbDriverHistory:[];
  const historicalChampionships=gameState?.dbHistoricalChampionships||null;

  // Historical DB rows are the base, but the Save World is authoritative.
  // This is especially important for runtime fields such as portrait_path.
  const driversById=useMemo(()=>{
    const map=new Map();
    for(const d of seedDriversDb){
      const id=str(d?.driver_id??d?.id);
      if(id)map.set(id,d);
    }
    for(const d of liveDriversDb){
      const id=str(d?.driver_id??d?.id);
      if(id)map.set(id,{...(map.get(id)||{}),...d});
    }
    return map;
  },[seedDriversDb,liveDriversDb]);
  const teamsById=useMemo(()=>{
    const map=new Map();
    for(const t of seedTeamsDb){
      const id=str(t?.team_id??t?.id);
      if(id)map.set(id,t);
    }
    for(const t of liveTeamsDb){
      const id=str(t?.team_id??t?.id);
      if(id)map.set(id,{...(map.get(id)||{}),...t});
    }
    return map;
  },[seedTeamsDb,liveTeamsDb]);

  const yearOptions=useMemo(()=>{
    const years=new Set();
    if(Number.isFinite(activeYear))years.add(activeYear);
    for(const row of results){
      const y=resultYear(row);
      if(Number.isFinite(y)&&(!Number.isFinite(activeYear)||y<=activeYear))years.add(y);
    }
    for(const row of history){
      const y=Number(row?.year);
      if(Number.isFinite(y)&&(!Number.isFinite(activeYear)||y<=activeYear))years.add(y);
    }
    return [...years].sort((a,b)=>b-a);
  },[activeYear,results,history]);

  const selectedYear=Number(yearFilter||activeYear);
  const careerArchive=useMemo(
    ()=>aggregateCareerResults(results,selectedYear,driversById,teamsById),
    [results,selectedYear,driversById,teamsById]
  );
  const historicalArchive=useMemo(
    ()=>aggregateHistorical(history,selectedYear,driversById,teamsById,historicalChampionships),
    [history,selectedYear,driversById,teamsById,historicalChampionships]
  );

  const hasCareerResults=results.some((r)=>resultYear(r)===selectedYear);
  const isCurrent=selectedYear===activeYear;

  const currentRows=useMemo(()=>{
    const sourceDrivers=firstArray(liveStandings?.drivers,liveStandings?.driver,liveStandings?.pilots);
    const statsByDriver=new Map(careerArchive.drivers.map((row)=>[row.id,row]));
    const liveDrivers=sourceDrivers.map((row,index)=>{
      const id=str(row?.driver_id??row?.id??row?.driverId);
      const db=driversById.get(id);
      const stats=statsByDriver.get(id)||{};
      const tid=str(row?.team_id??row?.constructor_id??stats.teamId??db?.team_id??db?.constructor_id);
      return {
        id,name:row?.name||driverName(db,id),teamId:tid,teamName:teamName(teamsById.get(tid),stats.teamName||tid||"—"),
        points:num(row?.points,0),races:num(stats.races,0),wins:num(stats.wins,0),podiums:num(stats.podiums,0),
        fastestLaps:num(stats.fastestLaps,0),poles:num(stats.poles,0),dnfs:num(stats.dnfs,0),
        bestFinish:stats.bestFinish??null,averageFinish:stats.averageFinish??null,pointsPerRace:num(stats.pointsPerRace,0),
        driver:db||{driver_id:id,display_name:row?.name||id},position:num(row?.position,index+1),
      };
    }).sort((a,b)=>a.position-b.position||b.points-a.points);

    const sourceTeams=firstArray(liveStandings?.teams,liveStandings?.constructors,liveStandings?.team,liveStandings?.constructor);
    const statsByTeam=new Map(careerArchive.teams.map((row)=>[row.id,row]));
    const liveTeams=sourceTeams.map((row,index)=>{
      const id=str(row?.team_id??row?.constructor_id??row?.id);
      const db=teamsById.get(id);
      const stats=statsByTeam.get(id)||{};
      return {
        id,name:row?.team_name||row?.name||teamName(db,id),points:num(row?.points,0),
        races:num(stats.races,0),wins:num(stats.wins,0),podiums:num(stats.podiums,0),
        fastestLaps:num(stats.fastestLaps,0),poles:num(stats.poles,0),dnfs:num(stats.dnfs,0),pointsPerRace:num(stats.pointsPerRace,0),
        team:db||{team_id:id,team_name:row?.team_name||row?.name||id},position:num(row?.position,index+1),
      };
    }).sort((a,b)=>a.position-b.position||b.points-a.points);

    return {drivers:liveDrivers,teams:liveTeams};
  },[liveStandings,careerArchive,driversById,teamsById]);

  let dataset;
  let sourceLabel;
  if(isCurrent){
    dataset=currentRows;
    sourceLabel="Live Save World";
  }else if(hasCareerResults){
    dataset=careerArchive;
    sourceLabel="Career archive";
  }else{
    dataset=historicalArchive;
    sourceLabel="Historical F1 archive";
  }

  const rows=tab==="drivers"?dataset.drivers:dataset.teams;

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 grid gap-4">
    <div className="rounded-xl border border-white/10 bg-[#12141c] shadow-lg p-4 flex flex-col md:flex-row md:items-center gap-3">
      <div>
        <h2 className="text-xl font-semibold">Standings</h2>
        <p className="text-sm text-slate-400">Season {selectedYear||"—"} · {sourceLabel}</p>
      </div>
      <div className="flex-1"/>
      <select value={yearFilter} onChange={(e)=>setYearFilter(e.target.value)} className="border border-white/10 bg-[#191c26] text-slate-100 rounded-md px-3 py-2 text-sm">
        {yearOptions.map((year)=><option key={year} value={year}>{year}{year===activeYear?" · current":""}</option>)}
      </select>
      <div className="flex rounded-lg border border-white/10 bg-[#0d0f15] p-1">
        <button onClick={()=>setTab("teams")} className={`px-3 py-1.5 rounded-md text-sm ${tab==="teams"?"bg-slate-100 text-slate-950":"text-slate-300"}`}>Constructors</button>
        <button onClick={()=>setTab("drivers")} className={`px-3 py-1.5 rounded-md text-sm ${tab==="drivers"?"bg-slate-100 text-slate-950":"text-slate-300"}`}>Drivers</button>
      </div>
    </div>

    <div className="rounded-xl border border-white/10 bg-[#12141c] shadow-lg overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-[#171a23] text-slate-300">
          <tr>
            <th className="px-4 py-3 text-right w-16">Pos</th>
            <th className="px-4 py-3 text-left">{tab==="drivers"?"Driver":"Team"}</th>
            {tab==="drivers"&&<th className="px-4 py-3 text-left">{sourceLabel==="Historical F1 archive"?"Car / Constructor":"Team"}</th>}
            <th className="px-4 py-3 text-right">Races</th>
            <th className="px-4 py-3 text-right">Wins</th>
            <th className="px-4 py-3 text-right">Podiums</th>
            <th className="px-4 py-3 text-right">Poles</th>
            <th className="px-4 py-3 text-right">FL</th>
            <th className="px-4 py-3 text-right">DNF</th>
            {tab==="drivers"&&<th className="px-4 py-3 text-right">Best</th>}
            {tab==="drivers"&&<th className="px-4 py-3 text-right">Avg</th>}
            <th className="px-4 py-3 text-right">Pts/Race</th>
            <th className="px-4 py-3 text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row,index)=><tr key={row.id||`${tab}_${index}`} className="border-t border-white/10 hover:bg-white/5">
            <td className="px-4 py-2 text-right font-medium">{row.position??index+1}</td>
            <td className="px-4 py-2">
              {tab==="drivers"&&row.id?(
                <button type="button" data-entity="driver" data-id={row.id} className="flex items-center gap-3 text-left font-medium hover:underline">
                  <DriverPortrait driver={row.driver} size="h-9 w-9"/><span>{row.name}</span>
                </button>
              ):row.id?(
                <button type="button" data-entity="team" data-id={row.id} className="flex items-center gap-3 text-left font-medium hover:underline">
                  <TeamLogo teamId={row.id} name={row.name} size="h-9 w-9"/><span>{row.name}</span>
                </button>
              ):row.name}
            </td>
            {tab==="drivers"&&<td className="px-4 py-2"><span className="inline-flex items-center gap-2"><TeamLogo teamId={row.teamId} name={row.teamName} size="h-7 w-7"/>{row.teamName}</span></td>}
            <td className="px-4 py-2 text-right">{row.races}</td>
            <td className="px-4 py-2 text-right">{row.wins}</td>
            <td className="px-4 py-2 text-right">{row.podiums}</td>
            <td className="px-4 py-2 text-right">{row.poles??0}</td>
            <td className="px-4 py-2 text-right">{row.fastestLaps??0}</td>
            <td className={`px-4 py-2 text-right ${Number(row.dnfs)>0?"text-rose-300":""}`}>{row.dnfs??0}</td>
            {tab==="drivers"&&<td className="px-4 py-2 text-right">{row.bestFinish?("P"+row.bestFinish):"—"}</td>}
            {tab==="drivers"&&<td className="px-4 py-2 text-right">{row.averageFinish!=null?Number(row.averageFinish).toFixed(1):"—"}</td>}
            <td className="px-4 py-2 text-right">{Number(row.pointsPerRace||0).toFixed(1)}</td>
            <td className="px-4 py-2 text-right font-semibold">{Number(row.points||0).toLocaleString("en-GB",{maximumFractionDigits:2})}</td>
          </tr>)}
          {!rows.length?<tr><td colSpan={tab==="drivers"?13:10} className="px-4 py-8 text-center text-slate-500">
            {isCurrent?"No standings yet for the current season.":"No standings data available for this season."}
          </td></tr>:null}
        </tbody>
      </table>
    </div>
  </div>;
}
