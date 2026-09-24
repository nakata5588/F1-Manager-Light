import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { DriverPortrait, TeamLogo, flagFromCountry } from "../components/entity/EntityVisuals.jsx";
import { fatigueStatus } from "../domain/driverRating.js";
import { driverProfileSnapshot } from "../domain/driverProfile.js";
import ContractNegotiationModal from "../components/drivers/ContractNegotiationModal.jsx";
import {
  changeDriverContractRole,
  driverLineupSlots,
  expectedDriverSalary,
  releaseDriverContract,
  terminationCost,
} from "../domain/driverContracts.js";
import {
  driverNegotiations,
  isNegotiationActive,
  startDriverRenewal,
} from "../engine/NegotiationEngine.js";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const idOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
const num=(v,fb=0)=>Number.isFinite(Number(unbox(v)))?Number(unbox(v)):fb;
const one=(v)=>Number.isFinite(Number(unbox(v)))?Number(unbox(v)).toFixed(1):"—";

const SLOT_ORDER=[
  {key:"main",label:"Main Driver",description:"Primary race seat"},
  {key:"second",label:"Second Driver",description:"Second race seat"},
  {key:"reserve",label:"Reserve Driver",description:"First replacement when a race driver is unavailable"},
  {key:"test",label:"Test Driver",description:"Development and testing specialist"},
];

function money(value){
  return Number(value)?new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value)):"—";
}
function Metric({label,value,tone=""}){
  return <div className="rounded-lg border border-white/10 bg-[#171a23] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className={"font-semibold mt-0.5 "+tone}>{value??"—"}</div></div>;
}
function Bar({label,value,inverse=false}){
  const v=Math.max(0,Math.min(100,Number(value)||0));
  const good=inverse?100-v:v;
  const tone=good>=70?"bg-emerald-300":good>=45?"bg-amber-300":"bg-rose-400";
  return <div><div className="flex justify-between text-xs"><span className="text-slate-400">{label}</span><strong>{Math.round(v)}%</strong></div><div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={"h-full "+tone} style={{width:v+"%"}}/></div></div>;
}

export default function MyDrivers(){
  const navigate=useNavigate();
  const gs=useGame((s)=>s.gameState);
  const setGameState=useGame((s)=>s.setGameState);
  const year=Number(gs?.activeYear);
  const myTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const myTeamName=gs?.team?.team_name||gs?.team?.name||"My Team";
  const drivers=gs?.drivers?.length?gs.drivers:gs?.dbDrivers||[];
  const standings=gs?.standings?.drivers||[];
  const driverById=useMemo(()=>new Map(drivers.map((d)=>[idOf(d),d])),[drivers]);
  const [renewingRow,setRenewingRow]=useState(null);
  const [changingRoleRow,setChangingRoleRow]=useState(null);
  const [targetRoleKey,setTargetRoleKey]=useState("");
  const negotiations=driverNegotiations(gs);

  const activeRenewalByDriver=useMemo(()=>{
    const map=new Map();
    for(const negotiation of negotiations){
      if(negotiation?.kind==="renewal"&&negotiation?.origin==="player"&&isNegotiationActive(negotiation))map.set(String(negotiation.driver_id),negotiation);
    }
    return map;
  },[negotiations]);

  const slotRows=useMemo(()=>{
    const lineup=driverLineupSlots(gs,myTeamId);
    return SLOT_ORDER.map((slot)=>{
      const contract=lineup[slot.key]||null;
      if(!contract)return {...slot,contract:null};
      const id=idOf(contract);
      const driver=driverById.get(id)||{driver_id:id,display_name:pick(contract,["driver_name","name"],id)};
      const profile=driverProfileSnapshot(gs,driver);
      const overallView=profile.overall;
      const condition=profile.condition;
      const fatigue=fatigueStatus(gs,id);
      const conditionImpact=profile.conditionImpact;
      const rating=profile.rating||{};
      const stats=profile.season;
      const standing=standings.find((row)=>String(row?.driver_id??row?.id??"")===id)||null;
      const availability=profile.availability?.availability||null;
      const medical=profile.availability?.medical||null;
      return {
        ...slot,contract,id,driver,rating,condition,fatigue,conditionImpact,stats,standing,availability,medical,
        name:driver.display_name||driver.name||pick(contract,["driver_name","name"],id),
        overall:overallView.estimated?`~${overallView.value}`:overallView.value,
        salary:num(pick(contract,["salary","salary_yearly"],0),0),
        until:pick(contract,["contract_until_year","contract_until","end_year","end_date"],"—"),
      };
    });
  },[gs,driverById,myTeamId,standings]);

  const annualPayroll=slotRows.reduce((sum,row)=>sum+Number(row.salary||0),0);

  function submitRenewal(offer){
    if(!renewingRow)return;
    setGameState(startDriverRenewal(gs,{driverId:renewingRow.id,teamId:myTeamId,teamName:myTeamName,offer:{...offer,role:renewingRow.label},origin:"player"}));
    setRenewingRow(null);
  }
  function releaseDriver(row){
    if(!row?.contract)return;
    const cost=terminationCost(gs,row.contract);
    if(!window.confirm("Release "+row.name+"?\n\nContract termination cost: "+money(cost)+"\n\nThis immediately opens the "+row.label+" seat."))return;
    setGameState(releaseDriverContract(gs,row.id));
  }
  function openRoleChange(row){setChangingRoleRow(row);setTargetRoleKey(SLOT_ORDER.find((slot)=>slot.key!==row.key)?.key||"");}
  function applyRoleChange(){
    if(!changingRoleRow||!targetRoleKey)return;
    setGameState(changeDriverContractRole(gs,{driverId:changingRoleRow.id,targetRole:targetRoleKey,teamId:myTeamId,swapIfOccupied:true}));
    setChangingRoleRow(null);setTargetRoleKey("");
  }

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
    <div className="rounded-xl border border-white/10 bg-[#12141c] shadow-lg p-5 flex flex-col lg:flex-row lg:items-center gap-4">
      <TeamLogo teamId={myTeamId} name={myTeamName} size="h-16 w-16"/>
      <div><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Race Department</div><h1 className="text-3xl font-bold">My Drivers</h1><p className="text-sm text-slate-400">{myTeamName} · Season {year||"—"}</p></div>
      <div className="flex-1"/>
      <div className="grid grid-cols-3 gap-2 min-w-[360px]"><Metric label="Filled roles" value={slotRows.filter((r)=>r.contract).length+"/4"}/><Metric label="Annual payroll" value={money(annualPayroll)}/><Metric label="Negotiations" value={activeRenewalByDriver.size}/></div>
      <button type="button" className="rounded-md px-4 py-2 text-sm bg-slate-100 text-slate-950 font-semibold" onClick={()=>navigate("/Drivers")}>Driver Market</button>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {slotRows.map((row)=>row.contract?<article key={row.key} className="rounded-xl border border-white/10 bg-[#12141c] shadow-lg overflow-hidden">
        <button type="button" data-entity="driver" data-id={row.id} className="w-full text-left hover:bg-white/[0.02] p-4">
          <div className="flex items-start gap-4">
            <DriverPortrait driver={row.driver} size="h-24 w-24"/>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wide text-slate-500">{row.label}</div>
              <div className="text-2xl font-semibold truncate">{row.name}</div>
              <div className="text-sm text-slate-400">{flagFromCountry(row.driver?.country_name||row.driver?.nationality,row.driver?.country_code)} {row.driver?.country_name||row.driver?.nationality||"—"} · Age {row.driver?.age??"—"}</div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                <Metric label="Overall" value={row.overall}/>
                <Metric label="Champ pos" value={row.standing?.position?("P"+row.standing.position):"—"}/>
                <Metric label="Points" value={row.standing?.points??row.stats.points}/>
                <Metric label="Contract" value={row.until}/>
              </div>
            </div>
          </div>
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/10 border-y border-white/10">
          <div className="bg-[#12141c] p-4 space-y-3">
            <Bar label="Confidence" value={row.condition.confidence}/>
            <Bar label="Morale" value={row.condition.morale}/>
            <Bar label="Preparation" value={row.condition.preparation}/>
            <Bar label="Fatigue" value={row.condition.fatigue} inverse/>
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Current performance effect</span>
                <strong className={row.conditionImpact.total>=0?"text-emerald-300":"text-rose-300"}>{row.conditionImpact.total>=0?"+":""}{row.conditionImpact.total.toFixed(1)}</strong>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1 text-[10px]">
                <span title="Confidence changes mainly with practice quality and race outcomes">Conf {row.conditionImpact.confidenceEffect>=0?"+":""}{row.conditionImpact.confidenceEffect.toFixed(1)}</span>
                <span title="Morale changes mainly with race results and team/contract events">Mor {row.conditionImpact.moraleEffect>=0?"+":""}{row.conditionImpact.moraleEffect.toFixed(1)}</span>
                <span title="Preparation rises through Practice and decays after a race">Prep {row.conditionImpact.preparationEffect>=0?"+":""}{row.conditionImpact.preparationEffect.toFixed(1)}</span>
                <span title="Fatigue directly reduces qualifying/race pace and also raises accident risk">Fat {row.conditionImpact.fatigueEffect.toFixed(1)}</span>
              </div>
            </div>
          </div>
          <div className="bg-[#12141c] p-4 grid grid-cols-3 gap-2">
            <Metric label="Starts" value={row.stats.races}/><Metric label="Wins" value={row.stats.wins}/><Metric label="Podiums" value={row.stats.podiums}/><Metric label="DNF" value={row.stats.dnfs} tone={row.stats.dnfs?"text-rose-300":""}/><Metric label="Best" value={row.stats.bestFinish?("P"+row.stats.bestFinish):"—"}/><Metric label="Avg finish" value={row.stats.avgFinish??"—"}/>
          </div>
        </div>

        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          <Metric label="Pace" value={one(pick(row.rating,["pace"],NaN))}/><Metric label="Qualifying" value={one(pick(row.rating,["qualifying"],NaN))}/><Metric label="Racecraft" value={one(pick(row.rating,["racecraft"],NaN))}/><Metric label="Consistency" value={one(pick(row.rating,["consistency"],NaN))}/><Metric label="Wet skill" value={one(pick(row.rating,["wet_skill"],NaN))}/><Metric label="Tyre mgmt" value={one(pick(row.rating,["tire_management"],NaN))}/><Metric label="Feedback" value={one(pick(row.rating,["technical_feedback"],NaN))}/><Metric label="Salary" value={money(row.salary)}/>
        </div>

        {(row.availability||row.medical)?<div className="mx-4 mb-4 rounded-lg border border-white/10 bg-[#171a23] p-3 text-sm">
          <div className="font-medium">Medical / availability</div>
          <div className="text-xs text-slate-400 mt-1">Status: {row.availability?.status||"available"}{row.availability?.expectedReturnDate?" · expected return "+row.availability.expectedReturnDate:""}{row.medical?.injury_reason?" · "+row.medical.injury_reason:""}</div>
        </div>:null}

        <div className="px-4 pb-4 flex flex-wrap items-center gap-2">
          <span className={"text-xs px-2 py-1 rounded "+(row.condition.fatigue>=70?"bg-rose-500/15 text-rose-300":"bg-white/5 text-slate-300")}>{row.fatigue.label}</span>
          {activeRenewalByDriver.has(String(row.id))?<span className="text-xs px-2 py-1 rounded bg-sky-500/15 text-sky-300">Renewal pending</span>:<button type="button" className="border border-white/15 rounded-md px-3 py-1.5 text-xs hover:bg-white/5" onClick={()=>setRenewingRow(row)}>Renew contract</button>}
          <button type="button" className="border border-white/15 rounded-md px-3 py-1.5 text-xs hover:bg-white/5" onClick={()=>openRoleChange(row)}>Change role</button>
          <button type="button" className="border border-rose-500/30 text-rose-300 rounded-md px-3 py-1.5 text-xs hover:bg-rose-500/10" onClick={()=>releaseDriver(row)}>Release · {money(terminationCost(gs,row.contract))}</button>
        </div>
      </article>:<div key={row.key} className="rounded-xl border border-dashed border-white/20 bg-[#12141c] p-5">
        <div className="text-xs uppercase tracking-wide text-slate-500">{row.label}</div><div className="mt-1 text-xl font-semibold">Vacant</div><div className="mt-1 text-sm text-slate-400">{row.description}</div><button type="button" className="mt-4 rounded-md bg-slate-100 text-slate-950 px-3 py-2 text-sm font-semibold" onClick={()=>navigate("/Drivers")}>Find a driver</button>
      </div>)}
    </div>

    {renewingRow&&<ContractNegotiationModal driver={renewingRow.driver} roles={[renewingRow.label]} expectedSalary={expectedDriverSalary(gs,renewingRow.id)} onClose={()=>setRenewingRow(null)} onSubmit={submitRenewal}/>}
    {changingRoleRow&&<div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-[#12141c] border border-white/10 shadow-xl p-5">
        <div className="text-lg font-semibold">Change driver role</div><div className="mt-1 text-sm text-slate-400">{changingRoleRow.name} is currently {changingRoleRow.label}.</div>
        <label className="block mt-4 text-sm font-medium">New role</label>
        <select className="mt-1 w-full border border-white/10 rounded-md px-3 py-2 text-sm bg-[#191c26] text-slate-100" value={targetRoleKey} onChange={(e)=>setTargetRoleKey(e.target.value)}>
          {SLOT_ORDER.filter((slot)=>slot.key!==changingRoleRow.key).map((slot)=>{const occupied=slotRows.find((row)=>row.key===slot.key&&row.contract);return <option key={slot.key} value={slot.key}>{slot.label}{occupied?" — swap with "+occupied.name:""}</option>;})}
        </select>
        <p className="mt-3 text-xs text-slate-500">If occupied, the two drivers swap roles atomically. Promotions/demotions retain the existing morale and confidence effects.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="border border-white/15 rounded-md px-3 py-2 text-sm" onClick={()=>{setChangingRoleRow(null);setTargetRoleKey("");}}>Cancel</button><button className="rounded-md px-3 py-2 text-sm bg-slate-100 text-slate-950 font-semibold disabled:opacity-40" disabled={!targetRoleKey} onClick={applyRoleChange}>Apply role change</button></div>
      </div>
    </div>}
  </div>;
}
