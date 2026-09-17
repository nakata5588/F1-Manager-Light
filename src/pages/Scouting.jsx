import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "@/state/GameStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DriverPortrait, flagFromCountry } from "@/components/entity/EntityVisuals.jsx";

const DAY=86_400_000;
const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const idOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
const fmtMoney=(n)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(n||0));
function parseISO(value){const [y,m,d]=String(value||"").slice(0,10).split("-").map(Number);return new Date(Date.UTC(y||1970,(m||1)-1,d||1));}
function addDaysISO(value,days){const d=parseISO(value);d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString().slice(0,10);}
function daysBetween(a,b){return Math.max(0,Math.ceil((+parseISO(b)-+parseISO(a))/DAY));}
function progress(a,b,n){if(!a||!b||!n)return 0;const x=+parseISO(a),y=+parseISO(b),z=+parseISO(n);return y<=x?1:Math.max(0,Math.min(1,(z-x)/(y-x)));}
function nice(s){return String(s||"").replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase());}

export default function Scouting(){
  const gameState=useGame(s=>s.gameState);
  const setGameState=useGame(s=>s.setGameState);
  const date=String(gameState?.currentDateISO||"").slice(0,10);
  const year=Number(gameState?.activeYear)||1980;
  const scouting=gameState?.scouting||{};
  const assignments=Array.isArray(scouting.assignments)?scouting.assignments:[];
  const shortlist=Array.isArray(scouting.shortlist)?scouting.shortlist:[];
  const zones=gameState?.dbScoutingZones||[];
  const drivers=gameState?.drivers?.length?gameState.drivers:gameState?.dbDrivers||[];
  const ratings=gameState?.driverRatings?.length?gameState.driverRatings:gameState?.dbDriverRatings||[];
  const contracts=gameState?.contracts?.length?gameState.contracts:gameState?.dbContracts||[];
  const staffContracts=gameState?.staffContracts?.length?gameState.staffContracts:gameState?.dbStaffContracts||[];
  const staffCore=gameState?.staffCore?.length?gameState.staffCore:gameState?.dbStaffCore||[];
  const staffRatings=gameState?.staffRatings?.length?gameState.staffRatings:gameState?.dbStaffRatings||[];

  const [tab,setTab]=useState("assignments");
  const [showStart,setShowStart]=useState(false);
  const [target,setTarget]=useState("");
  const [zoneId,setZoneId]=useState(zones?.[0]?.zone_id||"");
  const [q,setQ]=useState("");

  useEffect(()=>{if(!zoneId&&zones.length)setZoneId(String(zones[0].zone_id));},[zones,zoneId]);

  const ratingById=useMemo(()=>new Map(ratings.map(r=>[idOf(r),r])),[ratings]);
  const contractedIds=useMemo(()=>new Set(contracts.filter(c=>String(pick(c,["role","position","contract_role"],"")).toLowerCase().includes("driver")).map(idOf)),[contracts]);
  const prospects=useMemo(()=>drivers.filter(d=>{
    const id=idOf(d); if(!id)return false;
    return !contractedIds.has(id)||d?.status==="junior_only";
  }).filter(d=>!q||[d.display_name,d.name,d.country_name,d.nationality].some(v=>String(v||"").toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>{
    const ap=Number(pick(ratingById.get(idOf(a)),["potential_ability","potential"],0));
    const bp=Number(pick(ratingById.get(idOf(b)),["potential_ability","potential"],0));
    return bp-ap;
  }),[drivers,contractedIds,ratingById,q]);

  const driverById=useMemo(()=>new Map(drivers.map(d=>[idOf(d),d])),[drivers]);

  const scouts=useMemo(()=>{
    const myTeam=String(gameState?.team?.team_id??gameState?.team?.id??"");
    const coreById=new Map(staffCore.map(s=>[String(s?.staff_id??s?.id??""),s]));
    const ratingByStaff=new Map(staffRatings.map(r=>[String(unbox(r?.staff_id)??""),r]));
    return staffContracts.filter(c=>String(unbox(c?.team_id)??"")===myTeam && /scout|manager|principal/i.test(String(c?.role||"")))
      .map(c=>{
        const id=String(unbox(c?.staff_id)??"");
        const core=coreById.get(id)||{};
        const rt=ratingByStaff.get(id)||{};
        return {id,name:core.staff_name||c.staff_name||id,rating:Math.round((Number(rt.data_analysis||0)+Number(rt.communication||0)+Number(rt.negotiation||0))/3)||"—",role:nice(c.role)};
      });
  },[staffContracts,staffCore,staffRatings,gameState?.team]);

  useEffect(()=>{
    if(!date)return;
    const due=assignments.some(a=>a.status==="active"&&a.finishes_at&&a.finishes_at<=date);
    if(!due)return;
    setGameState({scouting:{...scouting,assignments:assignments.map(a=>a.status==="active"&&a.finishes_at&&a.finishes_at<=date?{...a,status:"completed",completed_at:date}:a),shortlist}});
  },[date,assignments,scouting,shortlist,setGameState]);

  const selectedZone=zones.find(z=>String(z.zone_id)===String(zoneId))||null;
  const duration=selectedZone?Number(selectedZone.travel_time_days||0)+10:14;
  const cost=selectedZone?Math.ceil(duration/7)*Number(selectedZone.cost_per_week||0):0;
  const budget=Number(gameState?.team?.budget??gameState?.finances?.balance??0);

  const startAssignment=(driverId=target,zid=zoneId)=>{
    if(!driverId||!zid||!date)return;
    const zone=zones.find(z=>String(z.zone_id)===String(zid));
    if(!zone)return;
    const days=Number(zone.travel_time_days||0)+10;
    const assignmentCost=Math.ceil(days/7)*Number(zone.cost_per_week||0);
    if(budget<assignmentCost)return;
    const d=driverById.get(String(driverId));
    const a={
      id:`scout_${Date.now()}`,
      title:`Report: ${d?.display_name||d?.name||driverId}`,
      prospect_id:String(driverId),
      zone_id:String(zid),
      region:zone.name||zid,
      status:"active",
      priority:2,
      started_at:date,
      finishes_at:addDaysISO(date,days),
      duration_days:days,
      cost:assignmentCost,
    };
    applyExpense(assignmentCost,`Scouting — ${a.title} (${a.region})`);
    setGameState({scouting:{...scouting,assignments:[...assignments,a],shortlist}});
    setShowStart(false);
  };

  const patchAssignment=(id,patch)=>{
    setGameState({scouting:{...scouting,assignments:assignments.map(a=>a.id===id?{...a,...patch}:a),shortlist}});
  };
  const pauseResume=(a)=>{
    if(a.status==="paused"){
      patchAssignment(a.id,{status:"active",started_at:date,finishes_at:addDaysISO(date,Number(a.remaining_days||7)),remaining_days:null});
    }else{
      patchAssignment(a.id,{status:"paused",remaining_days:daysBetween(date,a.finishes_at),paused_at:date});
    }
  };
  const cancel=(a)=>patchAssignment(a.id,{status:"cancelled",cancelled_at:date});
  const toggleShortlist=(id)=>{
    const sid=String(id);
    const next=shortlist.includes(sid)?shortlist.filter(x=>String(x)!==sid):[...shortlist,sid];
    setGameState({scouting:{...scouting,assignments,shortlist:next}});
  };

  function applyExpense(amount,desc){
    const value=Math.abs(Number(amount||0)), oldBudget=Number(gameState?.team?.budget??gameState?.finances?.balance??0),oldBalance=Number(gameState?.finances?.balance??oldBudget);
    setGameState({
      team:{...(gameState?.team||{}),budget:oldBudget-value},
      finances:{...(gameState?.finances||{}),budget:oldBudget-value,balance:oldBalance-value,season_spend:Number(gameState?.finances?.season_spend||0)+value},
      financeLog:[...(gameState?.financeLog||[]),{id:`tx_scout_${Date.now()}`,dateISO:date,type:"expense",category:"Scouting",desc,amount:-value}],
    });
  }

  return <div className="p-4 md:p-6 space-y-4">
    <div className="flex flex-col md:flex-row md:items-center gap-3">
      <div><h1 className="text-2xl md:text-3xl font-semibold">Scouting</h1><p className="text-sm text-muted-foreground">Scout visible free and junior talent using the regional network available in the database.</p></div>
      <div className="flex-1"/><div className="text-sm">Budget: <strong>{fmtMoney(budget)}</strong></div><Button onClick={()=>setShowStart(v=>!v)}>{showStart?"Close":"Start Assignment"}</Button>
    </div>

    {showStart&&<Card><CardContent className="p-4 grid gap-3">
      <div className="font-semibold">New scouting assignment</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">Prospect<select className="mt-1 border rounded px-3 py-2 w-full" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Select driver…</option>{prospects.map(d=><option key={idOf(d)} value={idOf(d)}>{d.display_name||d.name}</option>)}</select></label>
        <label className="text-sm">Region<select className="mt-1 border rounded px-3 py-2 w-full" value={zoneId} onChange={e=>setZoneId(e.target.value)}>{zones.map(z=><option key={z.zone_id} value={z.zone_id}>{z.name} · {fmtMoney(z.cost_per_week)}/week</option>)}</select></label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm"><span>Duration: <strong>{duration} days</strong></span><span>Cost: <strong>{fmtMoney(cost)}</strong></span><span>ETA: <strong>{date?addDaysISO(date,duration):"—"}</strong></span><Button disabled={!target||!zoneId||budget<cost} onClick={()=>startAssignment()}>Dispatch Scouting</Button></div>
    </CardContent></Card>}

    <div className="flex flex-wrap gap-2">
      {["assignments","prospects","shortlist","scouts"].map(k=><Button key={k} variant={tab===k?"default":"outline"} onClick={()=>setTab(k)}>{nice(k)}</Button>)}
    </div>

    {tab==="assignments"&&<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {[...assignments].reverse().map(a=>{
        const d=driverById.get(String(a.prospect_id));
        const rt=ratingById.get(String(a.prospect_id))||{};
        const pct=a.status==="completed"?1:a.status==="paused"?Number(a.progress||progress(a.started_at,a.finishes_at,a.paused_at||date)):progress(a.started_at,a.finishes_at,date);
        return <Card key={a.id}><CardContent className="p-4 space-y-3">
          <div className="flex justify-between gap-2"><div><div className="text-xs text-muted-foreground">{a.region}</div><div className="font-semibold">{a.title}</div></div><span className="text-xs bg-gray-100 px-2 py-1 rounded h-fit">{nice(a.status)}</span></div>
          <div><div className="flex justify-between text-sm"><span>Progress</span><strong>{Math.round(pct*100)}%</strong></div><div className="h-2 bg-gray-100 rounded overflow-hidden mt-1"><div className="h-full bg-slate-800" style={{width:`${pct*100}%`}}/></div></div>
          <div className="text-xs text-muted-foreground">{a.started_at} → {a.finishes_at} · {fmtMoney(a.cost)}</div>
          {a.status==="completed"&&<div className="grid grid-cols-2 gap-2"><Mini label="Current Ability" value={pick(rt,["current_ability","overall","pace"],"—")}/><Mini label="Potential" value={pick(rt,["potential_ability","potential"],"—")}/></div>}
          {d&&<button type="button" data-entity="driver" data-id={idOf(d)} className="text-sm font-medium hover:underline">Open {d.display_name||d.name}</button>}
          {["active","paused"].includes(a.status)&&<div className="flex gap-2"><Button size="sm" onClick={()=>pauseResume(a)}>{a.status==="paused"?"Resume":"Pause"}</Button><Button size="sm" variant="outline" onClick={()=>cancel(a)}>Cancel</Button></div>}
        </CardContent></Card>;
      })}
      {!assignments.length&&<Card><CardContent className="p-5 text-sm text-muted-foreground">No scouting assignments yet.</CardContent></Card>}
    </div>}

    {(tab==="prospects"||tab==="shortlist")&&<>
      <Card><CardContent className="p-4"><input className="border rounded px-3 py-2 w-full" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search driver or nationality…"/></CardContent></Card>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {(tab==="shortlist"?prospects.filter(d=>shortlist.includes(idOf(d))):prospects).map(d=>{
          const id=idOf(d),rt=ratingById.get(id)||{},hasReport=assignments.some(a=>String(a.prospect_id)===id&&a.status==="completed"),active=assignments.some(a=>String(a.prospect_id)===id&&["active","paused"].includes(a.status));
          return <Card key={id}><CardContent className="p-4 space-y-3">
            <button type="button" data-entity="driver" data-id={id} className="flex items-center gap-3 w-full text-left hover:underline"><DriverPortrait driver={d} size="h-14 w-14"/><div><div className="font-semibold">{d.display_name||d.name}</div><div className="text-xs text-muted-foreground">{flagFromCountry(d.country_name||d.nationality,d.country_code)} {d.country_name||d.nationality||"—"} · Age {d.age??"—"}</div></div></button>
            <div className="grid grid-cols-2 gap-2"><Mini label="Ability" value={hasReport?pick(rt,["current_ability","overall","pace"],"—"):"?"}/><Mini label="Potential" value={hasReport?pick(rt,["potential_ability","potential"],"—"):"?"}/></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" disabled={active||!zones.length} onClick={()=>{setTarget(id);setShowStart(true);setTab("assignments");}}>{hasReport?"New Report":active?"Scouting…":"Request Report"}</Button><Button size="sm" variant="outline" onClick={()=>toggleShortlist(id)}>{shortlist.includes(id)?"Remove Shortlist":"Add Shortlist"}</Button></div>
          </CardContent></Card>;
        })}
      </div>
    </>}

    {tab==="scouts"&&<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {scouts.map(s=><Card key={s.id}><CardContent className="p-4"><div className="font-semibold">{s.name}</div><div className="text-sm text-muted-foreground">{s.role}</div><div className="mt-2 text-sm">Scouting effectiveness: <strong>{s.rating}</strong></div></CardContent></Card>)}
      {!scouts.length&&<Card><CardContent className="p-5"><div className="font-semibold">Team Scouting Network</div><p className="text-sm text-muted-foreground mt-1">No dedicated scout role exists in the current staff database for this team. Assignments therefore use the team’s general management/technical network.</p></CardContent></Card>}
    </div>}
  </div>;
}
function Mini({label,value}){return <div className="border rounded p-2"><div className="text-[10px] text-muted-foreground">{label}</div><div className="font-medium">{value??"—"}</div></div>;}
