import React, { useMemo, useState } from "react";
import { useGame } from "@/state/GameStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DriverPortrait, TeamLogo, flagFromCountry } from "@/components/entity/EntityVisuals.jsx";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const idOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
const fmtMoney=(n)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(n||0));

export default function Academy(){
  const gameState=useGame(s=>s.gameState);
  const setGameState=useGame(s=>s.setGameState);
  const year=Number(gameState?.activeYear)||1980;
  const date=String(gameState?.currentDateISO||"").slice(0,10);
  const teamId=String(gameState?.team?.team_id??gameState?.team?.id??"");
  const teamName=gameState?.team?.team_name||gameState?.team?.name||"My Team";
  const budget=Number(gameState?.team?.budget??gameState?.finances?.balance??0);
  const facilities=gameState?.facilities?.length?gameState.facilities:gameState?.dbFacilities||[];
  const facility=facilities.find((r)=>String(r?.team_id??r?.team??"")===teamId&&Number(r?.year??year)===year);
  const youthLevel=facility?.youth_program_level;
  const formalAcademy=youthLevel!==null&&youthLevel!==undefined&&youthLevel!=="";

  const drivers=Array.isArray(gameState?.drivers)?gameState.drivers:[];
  const ratings=Array.isArray(gameState?.driverRatings)?gameState.driverRatings:[];
  const contracts=Array.isArray(gameState?.contracts)?gameState.contracts:[];
  const academy=gameState?.academy||{};
  const supported=Array.isArray(academy.drivers)?academy.drivers:[];

  const [q,setQ]=useState("");
  const [tab,setTab]=useState("supported");
  const ratingById=useMemo(()=>new Map(ratings.map((r)=>[idOf(r),r])),[ratings]);
  const driverById=useMemo(()=>new Map(drivers.map((d)=>[idOf(d),d])),[drivers]);
  const contractedIds=useMemo(()=>new Set(contracts.filter((c)=>String(pick(c,["role","position","contract_role"],"")).toLowerCase().includes("driver")).map(idOf)),[contracts]);
  const supportedIds=useMemo(()=>new Set(supported.map(idOf)),[supported]);

  const candidates=useMemo(()=>drivers.filter((d)=>{
    const id=idOf(d);
    if(!id||supportedIds.has(id)||contractedIds.has(id))return false;
    const age=Number(d?.age);
    if(!d?.active_lower_series || !Number.isFinite(age)) return false;
    return formalAcademy
      ? Boolean(d?.canHireAcademy)
      : age >= 16 && age <= 23;
  }).map((d)=>{
    const r=ratingById.get(idOf(d))||{};
    return {...d,overall:pick(r,["current_ability","overall","pace"],"—"),potential:pick(r,["potential_ability","potential"],"—")};
  }).filter((d)=>!q||[d.display_name,d.name,d.country_name,d.nationality,d.lower_series_name].some((v)=>String(v||"").toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>(Number(b.potential)||0)-(Number(a.potential)||0)),[drivers,supportedIds,contractedIds,ratingById,q,formalAcademy]);

  const supportedRows=useMemo(()=>supported.map((entry)=>{
    const id=idOf(entry),d=driverById.get(id)||entry,r=ratingById.get(id)||{};
    return {entry,driver:d,id,overall:pick(r,["current_ability","overall","pace"],"—"),potential:pick(r,["potential_ability","potential"],"—")};
  }),[supported,driverById,ratingById]);

  const supportDriver=(driver)=>{
    const id=idOf(driver); if(!id||supportedIds.has(id))return;
    const signingCost=formalAcademy?100_000:35_000;
    const weekly=formalAcademy?2_500:750;
    if(budget<signingCost)return;
    const record={
      driver_id:id,
      joined_at:date,
      status:"active",
      mode:formalAcademy?"academy":"supported_prospect",
      stipend_weekly:weekly,
      program:formalAcademy?"General Development":"Private Testing Support",
    };
    applyExpense(signingCost,`${formalAcademy?"Academy signing":"Junior support"} — ${driver.display_name||driver.name}`);
    setGameState({academy:{...academy,drivers:[...supported,record]}});
  };

  const removeDriver=(id)=>{
    setGameState({academy:{...academy,drivers:supported.filter((d)=>idOf(d)!==String(id))}});
  };

  const setProgram=(id,program)=>{
    setGameState({academy:{...academy,drivers:supported.map((d)=>idOf(d)===String(id)?{...d,program}:d)}});
  };

  function applyExpense(amount,desc){
    const value=Math.abs(Number(amount||0));
    const budget=Number(gameState?.team?.budget??gameState?.finances?.balance??0);
    const oldBalance=Number(gameState?.finances?.balance??budget);
    setGameState({
      team:{...(gameState?.team||{}),budget:budget-value},
      finances:{...(gameState?.finances||{}),budget:budget-value,balance:oldBalance-value,season_spend:Number(gameState?.finances?.season_spend||0)+value},
      financeLog:[...(gameState?.financeLog||[]),{id:`tx_academy_${Date.now()}`,dateISO:date,type:"expense",category:formalAcademy?"Academy":"Junior Support",desc,amount:-value}],
    });
  }

  const weekly=supported.reduce((sum,d)=>sum+Number(d?.stipend_weekly||0),0);

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
    <div className="rounded-xl border border-white/10 bg-[#12141c] p-5 flex flex-col lg:flex-row lg:items-center gap-4">
      <TeamLogo teamId={teamId} name={teamName} size="h-14 w-14"/>
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Driver Development</div>
        <h1 className="text-2xl md:text-3xl font-semibold">{formalAcademy?"Academy":"Junior Driver Support"}</h1>
        <p className="text-sm text-slate-400">{formalAcademy
          ? `Formal youth programme · facility level ${youthLevel}`
          : `No formal academy exists for ${teamName} in ${year}; use period-appropriate junior support instead.`}</p>
      </div>
      <div className="flex-1"/>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Mini label="Supported" value={supported.length}/>
        <Mini label="Candidates" value={candidates.length}/>
        <Mini label="Weekly cost" value={fmtMoney(weekly)}/>
        <Mini label="Budget" value={fmtMoney(budget)}/>
      </div>
    </div>

    <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
      <div className="font-semibold">{formalAcademy?"Era availability":"Historical context"}</div>
      <p className="text-sm text-slate-400 mt-1">{formalAcademy
        ?"This team has a youth-programme facility in the historical database, so formal academy programmes are available."
        :"The historical facilities database marks youth_program_level as unavailable. The game therefore uses an informal junior-support model instead of inventing a modern academy."}</p>
    </CardContent></Card>

    <div className="flex gap-2">
      <Button variant={tab==="supported"?"default":"outline"} onClick={()=>setTab("supported")}>Supported Drivers</Button>
      <Button variant={tab==="market"?"default":"outline"} onClick={()=>setTab("market")}>Find Talent</Button>
    </div>

    {tab==="supported"&&<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {supportedRows.map(({entry,driver,id,overall,potential})=><Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={id}><CardContent className="p-4 space-y-3">
        <button type="button" data-entity="driver" data-id={id} className="flex items-center gap-3 text-left w-full hover:underline">
          <DriverPortrait driver={driver} size="h-16 w-16"/>
          <div><div className="font-semibold">{driver?.display_name||driver?.name||id}</div><div className="text-xs text-slate-400">{flagFromCountry(driver?.country_name||driver?.nationality,driver?.country_code)} {driver?.country_name||driver?.nationality||"—"} · Age {driver?.age??"—"}</div></div>
        </button>
        <div className="grid grid-cols-3 gap-2"><Mini label="Overall" value={overall}/><Mini label="Potential" value={potential}/><Mini label="Weekly" value={fmtMoney(entry.stipend_weekly||0)}/></div>
        <label className="text-xs text-slate-400">Development plan
          <select className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-2 py-2 w-full text-sm" value={entry.program||""} onChange={(e)=>setProgram(id,e.target.value)}>
            {formalAcademy?<><option>General Development</option><option>Racecraft</option><option>Technical Feedback</option><option>Fitness</option></>:<><option>Private Testing Support</option><option>Race Entry Support</option><option>Technical Mentoring</option></>}
          </select>
        </label>
        <Button size="sm" variant="outline" onClick={()=>removeDriver(id)}>End Support</Button>
      </CardContent></Card>)}
      {!supportedRows.length&&<Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-5 text-sm text-slate-400">No junior drivers are currently supported. Open “Find Talent” to add one.</CardContent></Card>}
    </div>}

    {tab==="market"&&<>
      <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4"><input className="border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search junior driver or nationality…"/></CardContent></Card>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {candidates.map((d)=>{
          const cost=formalAcademy?100_000:35_000;
          return <Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={idOf(d)}><CardContent className="p-4 space-y-3">
            <button type="button" data-entity="driver" data-id={idOf(d)} className="flex items-center gap-3 text-left w-full hover:underline">
              <DriverPortrait driver={d} size="h-16 w-16"/>
              <div className="min-w-0">
                <div className="font-semibold truncate">{d.display_name||d.name}</div>
                <div className="text-xs text-slate-400">
                  {flagFromCountry(d.country_name||d.nationality,d.country_code)} {d.country_name||d.nationality||"—"} · Age {d.age??"—"}
                </div>
                <div className="mt-1 flex gap-1 flex-wrap">
                  {d.youth_eligible && <span className="text-[10px] px-2 py-0.5 rounded bg-teal-500/15 text-teal-300">Youth</span>}
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-slate-300">{d.lower_series_name || "Lower Series"}</span>
                </div>
              </div>
            </button>
            <div className="grid grid-cols-2 gap-2"><Mini label="Overall" value={d.overall}/><Mini label="Potential" value={d.potential}/></div>
            <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-400">{formalAcademy?"Academy entry":"Support fee"}: {fmtMoney(cost)}</span><Button size="sm" disabled={budget<cost} onClick={()=>supportDriver(d)}>{formalAcademy?"Sign to Academy":"Support Driver"}</Button></div>
          </CardContent></Card>;
        })}
        {!candidates.length&&<Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-5 text-sm text-slate-400">No visible junior candidates match the current search.</CardContent></Card>}
      </div>
    </>}
  </div>;
}

function Mini({label,value}){const safe=value&&typeof value==="object"?"—":(value??"—");return <div className="border border-white/10 rounded p-2"><div className="text-[10px] text-slate-400">{label}</div><div className="font-medium text-sm">{safe}</div></div>;}
