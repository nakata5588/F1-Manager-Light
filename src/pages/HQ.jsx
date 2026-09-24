import React, { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useGame } from "@/state/GameStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TeamLogo } from "@/components/entity/EntityVisuals.jsx";

const FACILITIES = [
  { key:"wind_tunnel_level", name:"Wind Tunnel", category:"Aerodynamics", desc:"Physical aerodynamic testing. Improves the effectiveness of aero development." },
  { key:"aero_dept_level", name:"Aerodynamics Department", category:"Technical", desc:"Design capability for wings, bodywork and ground-effect concepts." },
  { key:"_chassis_shop_level", name:"Chassis Workshop", category:"Technical", desc:"Design and construction capability for the chassis and structural components." },
  { key:"manufacturing_leve", name:"Manufacturing", category:"Production", desc:"Workshop capacity, tooling and quality control for producing car parts." },
  { key:"pitcrew_training_level", name:"Pit Crew Training", category:"Operations", desc:"Preparation of mechanics and race crew for reliable pit operations." },
  { key:"simulator_level", name:"Driver Simulator", category:"Simulation", desc:"Driver-in-the-loop simulation infrastructure." },
  { key:"youth_program_level", name:"Youth Programme", category:"Driver Development", desc:"Formal junior-driver development programme." },
];

const fmtMoney=(n)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(n||0));
const niceDate=(iso)=>iso||"—";
function parseISO(value){const [y,m,d]=String(value||"").slice(0,10).split("-").map(Number);return new Date(Date.UTC(y||1970,(m||1)-1,d||1));}
function addDaysISO(value,days){const d=parseISO(value);d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString().slice(0,10);}
function progress(start,finish,now){if(!start||!finish||!now)return 0;const a=+parseISO(start),b=+parseISO(finish),n=+parseISO(now);return b<=a?1:Math.max(0,Math.min(1,(n-a)/(b-a)));}

export default function HQ(){
  const gameState=useGame(s=>s.gameState);
  const setGameState=useGame(s=>s.setGameState);
  const year=Number(gameState?.activeYear)||1980;
  const date=String(gameState?.currentDateISO||"").slice(0,10);
  const teamId=String(gameState?.team?.team_id??gameState?.team?.id??"");
  const facilities=gameState?.facilities?.length?gameState.facilities:gameState?.dbFacilities||[];
  const baseRow=useMemo(()=>facilities.find((r)=>String(r?.team_id??r?.team??"")===teamId && Number(r?.year??year)===year)||null,[facilities,teamId,year]);
  const hq=gameState?.hq||{};
  const levels=hq.facilityLevels||{};
  const upgrades=Array.isArray(hq.upgrades)?hq.upgrades:[];
  const budget=Number(gameState?.team?.budget??gameState?.finances?.balance??0);
  const teamName=gameState?.team?.team_name||gameState?.team?.name||"My Team";

  const available=useMemo(()=>FACILITIES.filter((f)=>baseRow && baseRow[f.key]!==null && baseRow[f.key]!==undefined && baseRow[f.key]!==""),[baseRow]);

  useEffect(()=>{
    if(!date||!upgrades.length)return;
    const completed=upgrades.filter((u)=>u.status==="active"&&u.finishes_at&&u.finishes_at<=date);
    if(!completed.length)return;
    const nextLevels={...levels};
    for(const u of completed) nextLevels[u.facility_key]=Math.max(Number(nextLevels[u.facility_key]??baseRow?.[u.facility_key]??0),Number(u.target_level||0));
    setGameState({hq:{...hq,facilityLevels:nextLevels,upgrades:upgrades.map((u)=>completed.some((x)=>x.id===u.id)?{...u,status:"completed",completed_at:date}:u)}});
  },[date,upgrades,levels,baseRow,hq,setGameState]);

  const levelOf=(key)=>Number(levels[key]??baseRow?.[key]??0);
  const activeUpgrade=(key)=>upgrades.find((u)=>u.facility_key===key&&u.status==="active")||null;

  const startUpgrade=(facility)=>{
    if(!date||activeUpgrade(facility.key))return;
    const level=levelOf(facility.key);
    if(level>=10)return;
    const maintenance=Number(baseRow?.maintenance_cost||1_000_000);
    const cost=Math.round(maintenance*(0.18+level*0.035));
    const days=28+level*6;
    if(budget<cost)return;
    const upgrade={
      id:`hq_${facility.key}_${Date.now()}`,
      facility_key:facility.key,
      name:facility.name,
      from_level:level,
      target_level:level+1,
      cost,
      started_at:date,
      finishes_at:addDaysISO(date,days),
      status:"active",
    };
    const oldBalance=Number(gameState?.finances?.balance??budget);
    setGameState({
      hq:{...hq,facilityLevels:levels,upgrades:[...upgrades,upgrade]},
      team:{...(gameState?.team||{}),budget:budget-cost},
      finances:{...(gameState?.finances||{}),budget:budget-cost,balance:oldBalance-cost,season_spend:Number(gameState?.finances?.season_spend||0)+cost},
      financeLog:[...(gameState?.financeLog||[]),{
        id:`tx_hq_${Date.now()}`,dateISO:date,type:"expense",category:"Facilities",desc:`${facility.name} upgrade to level ${level+1}`,amount:-cost,
      }],
    });
  };

  const cancelUpgrade=(id)=>{
    const u=upgrades.find((x)=>x.id===id);
    if(!u||u.status!=="active")return;
    // 50% refund reflects committed design/construction costs.
    const refund=Math.round(Number(u.cost||0)*0.5);
    const oldBalance=Number(gameState?.finances?.balance??budget);
    setGameState({
      hq:{...hq,facilityLevels:levels,upgrades:upgrades.map((x)=>x.id===id?{...x,status:"cancelled",cancelled_at:date}:x)},
      team:{...(gameState?.team||{}),budget:budget+refund},
      finances:{...(gameState?.finances||{}),budget:budget+refund,balance:oldBalance+refund,season_income:Number(gameState?.finances?.season_income||0)+refund},
      financeLog:[...(gameState?.financeLog||[]),{id:`tx_hq_refund_${Date.now()}`,dateISO:date,type:"income",category:"Facilities Refund",desc:`${u.name} cancellation refund`,amount:refund}],
    });
  };

  const avg=available.length?available.reduce((s,f)=>s+levelOf(f.key),0)/available.length:0;

  const effectText=(facility,level)=>{
    if(facility.key==="wind_tunnel_level") return `Aero development factor contribution: +${(level/40).toFixed(2)} alongside the Aero Department.`;
    if(facility.key==="aero_dept_level") return `Aero development factor contribution: +${(level/40).toFixed(2)} alongside the Wind Tunnel.`;
    if(facility.key==="_chassis_shop_level") return `Chassis/suspension/brakes development effectiveness: ×${(0.80+level/25).toFixed(2)}.`;
    if(facility.key==="manufacturing_leve") {
      const buildDays=Math.max(3,Math.round(10-level*0.6));
      const costMult=Math.max(0.72,1.12-level*0.025);
      return `Manufacturing jobs: ~${buildDays} days; cost multiplier ×${costMult.toFixed(2)}. Also improves development efficiency.`;
    }
    if(facility.key==="pitcrew_training_level") return `Improves the daily pit-crew training rate. Training Load is managed in Development → Pit Crew and feeds live pit-stop pace, consistency and error risk.`;
    if(facility.key==="youth_program_level") return level>0?`Unlocks the formal Academy and scales monthly academy development programmes (current level ${level}).`:"No formal Academy is available; only lower-effect era-appropriate junior support can be used.";
    if(facility.key==="simulator_level") return "Scales monthly driver development and AI training efficiency. Higher levels accelerate progression toward a driver’s potential.";
    return "Improves the related team operation.";
  };

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
    <div className="rounded-xl border border-white/10 bg-[#12141c] p-2.5 flex flex-wrap items-center gap-2.5">
      <TeamLogo teamId={teamId} name={teamName} size="h-10 w-10" className="p-0.5"/>
      <div className="flex-1"/>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        <MiniStat label="Budget" value={fmtMoney(budget)}/>
        <MiniStat label="Facilities" value={available.length}/>
        <MiniStat label="Avg Level" value={avg.toFixed(1)}/>
        <MiniStat label="Upgrading" value={upgrades.filter((u)=>u.status==="active").length}/>
      </div>
    </div>

    {!baseRow&&<Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 text-sm text-amber-300">No facility record is available for this team in {year}.</CardContent></Card>}

    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Available Facilities" value={available.length}/>
      <Stat label="Average Level" value={avg.toFixed(1)}/>
      <Stat label="Upgrading" value={upgrades.filter((u)=>u.status==="active").length}/>
      <Stat label="Annual Maintenance" value={fmtMoney(baseRow?.maintenance_cost||0)}/>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      <Link to="/Development" className="rounded-lg border border-white/10 bg-[#12141c] p-3 hover:bg-[#171a23]"><div className="font-medium">Development →</div><div className="text-xs text-slate-500">Wind tunnel, aero, chassis and manufacturing feed car projects.</div></Link>
      <Link to="/MyStaff" className="rounded-lg border border-white/10 bg-[#12141c] p-3 hover:bg-[#171a23]"><div className="font-medium">Staff & Pit Crew →</div><div className="text-xs text-slate-500">Pit crew training connects to live race operations.</div></Link>
      <Link to="/Academy" className="rounded-lg border border-white/10 bg-[#12141c] p-3 hover:bg-[#171a23]"><div className="font-medium">Academy →</div><div className="text-xs text-slate-500">Youth Programme availability controls the formal academy model.</div></Link>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {available.map((f)=>{
        const level=levelOf(f.key);
        const u=activeUpgrade(f.key);
        const maintenance=Number(baseRow?.maintenance_cost||1_000_000);
        const nextCost=Math.round(maintenance*(0.18+level*0.035));
        const pct=u?progress(u.started_at,u.finishes_at,date):0;
        return <Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={f.key}><CardContent className="p-4 space-y-3">
          <div><div className="text-xs text-slate-400">{f.category}</div><div className="text-lg font-semibold">{f.name}</div></div>
          <p className="text-sm text-slate-400 min-h-[2.5rem]">{f.desc}</p>
          <div className="text-xs rounded-lg bg-white/5 border px-3 py-2"><strong>Current effect:</strong> {effectText(f,level)}</div>
          <div><div className="flex justify-between text-sm"><span>Level</span><strong>{level} / 10</strong></div><div className="h-2 bg-white/10 rounded overflow-hidden mt-1"><div className="h-full bg-slate-800" style={{width:`${level*10}%`}}/></div></div>
          {u?<div className="border rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm"><span>Upgrade to level {u.target_level}</span><strong>{Math.round(pct*100)}%</strong></div>
            <div className="h-2 bg-white/10 rounded overflow-hidden"><div className="h-full bg-slate-200" style={{width:`${pct*100}%`}}/></div>
            <div className="text-xs text-slate-400">{niceDate(u.started_at)} → {niceDate(u.finishes_at)} · {fmtMoney(u.cost)}</div>
            <Button size="sm" variant="darkOutline" onClick={()=>cancelUpgrade(u.id)}>Cancel (50% refund)</Button>
          </div>:<div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-400">Next level: {fmtMoney(nextCost)}</div>
            <Button size="sm" onClick={()=>startUpgrade(f)} disabled={level>=10||budget<nextCost}>{level>=10?"Max level":"Upgrade"}</Button>
          </div>}
        </CardContent></Card>;
      })}
    </div>

    <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
      <div className="font-semibold mb-3">Upgrade History</div>
      {upgrades.length?<div className="space-y-2">{[...upgrades].reverse().map((u)=><div key={u.id} className="flex flex-col md:flex-row md:items-center gap-2 border rounded-lg p-3 text-sm"><strong>{u.name}</strong><span>Level {u.from_level} → {u.target_level}</span><span className="text-slate-400">{u.started_at} → {u.finishes_at}</span><span className="md:ml-auto">{fmtMoney(u.cost)} · {u.status}</span></div>)}</div>:<div className="text-sm text-slate-400">No facility upgrades in this career.</div>}
    </CardContent></Card>
  </div>;
}

function Stat({label,value}){return <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4"><div className="text-xs text-slate-400">{label}</div><div className="text-xl font-semibold">{value}</div></CardContent></Card>;}


function MiniStat({label,value}){
  return <div className="rounded-lg border border-white/10 bg-[#171a23] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className="font-semibold mt-0.5 truncate">{value}</div></div>;
}
