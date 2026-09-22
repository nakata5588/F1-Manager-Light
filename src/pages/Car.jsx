import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { DriverPortrait, TeamLogo } from "@/components/entity/EntityVisuals.jsx";
import { carPerformanceRanking, teamCarPerformance } from "@/domain/carPerformance";
import {
  CAR_COMPONENT_SLOTS,
  baseComponentConstructionCost,
  componentConditionForCar,
  componentConditionStatus,
  installedPartsForCar,
  syncGarageState,
} from "@/domain/garage";

const idOf=(o)=>String(o?.driver_id??o?.person_id??o?.id??"");
const nice=(s)=>String(s||"").replaceAll("_"," ").replace(/\b\w/g,(m)=>m.toUpperCase());
const currentKey=(v)=>JSON.stringify(v??null);

function Panel({title,action,children,className=""}){
  return <section className={"rounded-xl border border-white/10 bg-[#12141c] shadow-lg overflow-hidden "+className}>
    <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
      <div className="text-sm font-semibold uppercase tracking-wide">{title}</div>
      <div className="flex-1"/>{action}
    </div>{children}
  </section>;
}
function Metric({label,value}){
  return <div className="rounded-lg border border-white/10 bg-[#171a23] px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="font-semibold mt-0.5">{value}</div>
  </div>;
}
function PerfBar({label,value,rank}){
  const v=Math.max(0,Math.min(100,Number(value)||0));
  return <div>
    <div className="flex items-center gap-3 text-sm"><span className="flex-1 text-slate-400">{label}</span><strong>{v.toFixed(1)}</strong>{rank?<span className="text-xs text-slate-500">#{rank}</span>:null}</div>
    <div className="h-2 mt-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-slate-200" style={{width:v+"%"}}/></div>
  </div>;
}

export default function Car(){
  const gs=useGame((s)=>s.gameState);
  const setGameState=useGame((s)=>s.setGameState);
  const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const teamName=gs?.team?.team_name||gs?.team?.name||teamId||"My Team";
  const drivers=gs?.drivers||[];
  const parts=gs?.development?.parts||[];

  const syncedGarage=useMemo(()=>syncGarageState(gs,gs?.garage||{}),[
    gs?.garage,gs?.contracts,gs?.activeYear,teamId,
  ]);
  const baseStock=syncedGarage?.baseComponentStock||{};

  useEffect(()=>{
    const current=JSON.stringify(gs?.garage?.cars||[]);
    const wanted=JSON.stringify(syncedGarage?.cars||[]);
    if(current!==wanted)setGameState({garage:syncedGarage});
  },[currentKey(gs?.garage?.cars),currentKey(syncedGarage?.cars)]); // eslint-disable-line react-hooks/exhaustive-deps

  const driverById=useMemo(()=>new Map(drivers.map((d)=>[idOf(d),d])),[drivers]);
  const ranking=useMemo(()=>carPerformanceRanking({...gs,garage:syncedGarage}),[gs,syncedGarage]);
  const myRank=ranking.find((r)=>String(r.team_id)===teamId);
  const cars=syncedGarage?.cars||[];
  const [selectedId,setSelectedId]=useState(()=>cars.find((c)=>c.kind!=="reserve")?.id||cars[0]?.id||"");

  useEffect(()=>{
    if(!cars.some((c)=>c.id===selectedId))setSelectedId(cars.find((c)=>c.kind!=="reserve")?.id||cars[0]?.id||"");
  },[cars,selectedId]);

  const selectedCar=cars.find((c)=>c.id===selectedId)||cars[0]||null;
  const selectedDriver=selectedCar?driverById.get(String(selectedCar.driver_id||"")):null;
  const carState={...gs,garage:syncedGarage};
  const selectedPerf=selectedCar?teamCarPerformance(carState,teamId,selectedCar.driver_id):null;
  const selectedFitted=selectedCar?installedPartsForCar(carState,selectedCar):[];
  const componentRows=selectedCar?CAR_COMPONENT_SLOTS.map((slot)=>{
    const condition=componentConditionForCar(carState,selectedCar,slot);
    return {
      slot,condition,status:componentConditionStatus(condition),
      installed:selectedFitted.find((row)=>row.slot===slot)||null,
    };
  }):[];
  const averageCondition=componentRows.length?componentRows.reduce((s,row)=>s+row.condition,0)/componentRows.length:0;

  const updateGarageAndParts=(nextCars,nextParts)=>{
    setGameState({garage:{...syncedGarage,cars:nextCars},development:{...(gs.development||{}),parts:nextParts}});
  };
  const fitPart=(car,part)=>{
    const slot=String(part?.slot||"");
    if(!slot||Number(part?.inv||0)<=0)return;
    const oldId=car?.installedParts?.[slot];
    if(String(oldId||"")===String(part.id))return;
    const nextParts=parts.map((p)=>{
      if(String(p.id)===String(part.id))return {...p,inv:Math.max(0,Number(p.inv||0)-1)};
      if(oldId&&String(p.id)===String(oldId))return {...p,inv:Number(p.inv||0)+1};
      return p;
    });
    const nextCars=cars.map((c)=>c.id===car.id?{...c,installedParts:{...(c.installedParts||{}),[slot]:part.id}}:c);
    updateGarageAndParts(nextCars,nextParts);
  };
  const removePart=(car,slot)=>{
    const oldId=car?.installedParts?.[slot];
    if(!oldId)return;
    const nextParts=parts.map((p)=>String(p.id)===String(oldId)?{...p,inv:Number(p.inv||0)+1}:p);
    const installed={...(car.installedParts||{})}; delete installed[slot];
    const nextCars=cars.map((c)=>c.id===car.id?{...c,installedParts:installed}:c);
    updateGarageAndParts(nextCars,nextParts);
  };
  const spend=(amount,desc)=>{
    const value=Math.abs(Number(amount||0));
    const oldBudget=Number(gs?.team?.budget??gs?.finances?.balance??0);
    const oldBalance=Number(gs?.finances?.balance??oldBudget);
    if(value<=0||oldBudget<value)return false;
    setGameState({
      team:{...(gs?.team||{}),budget:oldBudget-value},
      finances:{...(gs?.finances||{}),budget:oldBudget-value,balance:oldBalance-value,season_spend:Number(gs?.finances?.season_spend||0)+value},
      financeLog:[...(gs?.financeLog||[]),{
        id:`tx_component_${Date.now()}`,
        dateISO:String(gs?.currentDateISO||"").slice(0,10),
        type:"expense",category:"Car Components",desc,amount:-value,
      }],
    });
    return true;
  };

  const buildStandardSpare=(slot)=>{
    const cost=baseComponentConstructionCost(gs,slot);
    const oldBudget=Number(gs?.team?.budget??gs?.finances?.balance??0);
    if(oldBudget<cost)return;
    const stock={...baseStock,[slot]:Number(baseStock?.[slot]||0)+1};
    const oldBalance=Number(gs?.finances?.balance??oldBudget);
    setGameState({
      team:{...(gs?.team||{}),budget:oldBudget-cost},
      finances:{...(gs?.finances||{}),budget:oldBudget-cost,balance:oldBalance-cost,season_spend:Number(gs?.finances?.season_spend||0)+cost},
      garage:{...syncedGarage,baseComponentStock:stock},
      financeLog:[...(gs?.financeLog||[]),{
        id:`tx_component_stock_${Date.now()}`,
        dateISO:String(gs?.currentDateISO||"").slice(0,10),
        type:"expense",category:"Car Components",desc:`Construct standard spare — ${nice(slot)}`,amount:-cost,
      }],
    });
  };

  const replaceBaseComponent=(car,slot)=>{
    if(car?.installedParts?.[slot])return;
    const before=componentConditionForCar(carState,car,slot);
    if(before>=99.5)return;
    const stockCount=Number(baseStock?.[slot]||0);
    const cost=baseComponentConstructionCost(gs,slot);
    const oldBudget=Number(gs?.team?.budget??gs?.finances?.balance??0);
    if(stockCount<=0&&oldBudget<cost)return;

    const nextStock={...baseStock,[slot]:Math.max(0,stockCount-1)};
    const nextCars=cars.map((c)=>c.id!==car.id?c:{...c,componentCondition:{...(c.componentCondition||{}),[slot]:100}});
    const patch={
      garage:{...syncedGarage,baseComponentStock:nextStock,cars:nextCars},
      componentServiceLog:[{
        date:String(gs?.currentDateISO||"").slice(0,10),car_id:car.id,slot,
        condition_before:Number(before.toFixed(1)),condition_after:100,
        action:stockCount>0?"replace_from_stock":"construct_and_replace",
        cost:stockCount>0?0:cost,
      },...(Array.isArray(gs?.componentServiceLog)?gs.componentServiceLog:[])].slice(0,200),
    };
    if(stockCount<=0){
      const oldBalance=Number(gs?.finances?.balance??oldBudget);
      patch.team={...(gs?.team||{}),budget:oldBudget-cost};
      patch.finances={...(gs?.finances||{}),budget:oldBudget-cost,balance:oldBalance-cost,season_spend:Number(gs?.finances?.season_spend||0)+cost};
      patch.financeLog=[...(gs?.financeLog||[]),{
        id:`tx_component_fit_${Date.now()}`,
        dateISO:String(gs?.currentDateISO||"").slice(0,10),
        type:"expense",category:"Car Components",desc:`Construct & fit — ${nice(slot)} · ${car.label}`,amount:-cost,
      }];
    }
    setGameState(patch);
  };

  const availableParts=parts.filter((p)=>Number(p.inv||0)>0);

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
    <div className="rounded-xl border border-white/10 bg-[#12141c] p-5 flex flex-col lg:flex-row lg:items-center gap-4">
      <TeamLogo teamId={teamId} name={teamName} size="h-16 w-16" className="p-1"/>
      <div><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Technical Department</div><h1 className="text-3xl font-bold">My Cars</h1><p className="text-sm text-slate-400">{teamName} · Season {gs?.activeYear||"—"}</p></div>
      <div className="flex-1"/>
      <div className="grid grid-cols-3 gap-2 min-w-[360px]">
        <Metric label="Grid rank" value={myRank?"#"+myRank.rank:"—"}/>
        <Metric label="Overall" value={myRank?Number(myRank.overall).toFixed(1):"—"}/>
        <Metric label="Parts stock" value={availableParts.reduce((s,p)=>s+Number(p.inv||0),0)}/>
      </div>
      <Link to="/Development" className="rounded-md bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold hover:bg-white">Development</Link>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {cars.map((car)=>{
        const driver=driverById.get(String(car.driver_id||""));
        const perf=teamCarPerformance(carState,teamId,car.driver_id);
        const comp=CAR_COMPONENT_SLOTS.map((slot)=>componentConditionForCar(carState,car,slot));
        const health=comp.length?comp.reduce((a,b)=>a+b,0)/comp.length:0;
        const active=car.id===selectedCar?.id;
        return <button key={car.id} onClick={()=>setSelectedId(car.id)} className={"rounded-xl border p-4 text-left transition "+(active?"border-white/40 bg-[#1b1e28]":"border-white/10 bg-[#12141c] hover:bg-[#171a23]")}>
          <div className="flex items-start gap-3">
            <DriverPortrait driver={driver||{display_name:"Car"}} size="h-16 w-16"/>
            <div className="min-w-0 flex-1"><div className="text-[10px] uppercase tracking-wide text-slate-500">{car.kind==="reserve"?"Spare chassis":"Race chassis"}</div><div className="text-lg font-semibold">{car.label}</div><div className="text-sm text-slate-400 truncate">{driver?.display_name||driver?.name||"No driver assigned"}</div></div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3"><Metric label="Overall" value={Number(perf.overall).toFixed(1)}/><Metric label="Reliability" value={Number(perf.reliability).toFixed(1)}/><Metric label="Health" value={health.toFixed(0)+"%"}/></div>
        </button>;
      })}
    </div>

    {selectedCar&&<div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <Panel title={(selectedCar.label||"Car")+" · Performance"} className="xl:col-span-4">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-white/10">
            <DriverPortrait driver={selectedDriver||{display_name:"Unassigned"}} size="h-16 w-16"/>
            <div><div className="font-semibold">{selectedDriver?.display_name||selectedDriver?.name||"No driver assigned"}</div><div className="text-xs text-slate-500">{selectedCar.kind==="reserve"?"Spare chassis":"Race car"}</div></div>
          </div>
          <PerfBar label="Overall" value={selectedPerf?.overall}/>
          <PerfBar label="Qualifying" value={selectedPerf?.qualifying}/>
          <PerfBar label="Race" value={selectedPerf?.race}/>
          <PerfBar label="Reliability" value={selectedPerf?.reliability}/>
          <PerfBar label="Chassis" value={selectedPerf?.chassis}/>
          <Metric label="Average component health" value={averageCondition.toFixed(1)+"%"}/>
          {Number(selectedPerf?.wear_penalty?.reliability||0)<-0.1?<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">Wear reliability impact {Number(selectedPerf.wear_penalty.reliability).toFixed(1)}</div>:null}
        </div>
      </Panel>

      <Panel title="Installed components" className="xl:col-span-5">
        <div className="divide-y divide-white/10">
          {componentRows.map((row)=><div key={row.slot} className="p-3 flex items-center gap-3">
            <div className="min-w-0 flex-1"><div className="text-[10px] uppercase tracking-wide text-slate-500">{nice(row.slot)}</div><div className="font-medium truncate">{row.installed?.part?.name||"Standard component"}</div><div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={row.condition<35?"h-full bg-rose-400":row.condition<60?"h-full bg-amber-300":"h-full bg-emerald-300"} style={{width:Math.max(0,Math.min(100,row.condition))+"%"}}/></div></div>
            <div className="text-right"><div className="font-semibold">{row.condition.toFixed(1)}%</div><div className="text-[10px] text-slate-500">{row.status.label}</div></div>
            {row.installed
              ?<Button size="sm" variant="darkOutline" onClick={()=>removePart(selectedCar,row.slot)}>Remove</Button>
              :<div className="text-right">
                <Button
                  size="sm"
                  variant="darkOutline"
                  disabled={row.condition>=99.5 || (Number(baseStock?.[row.slot]||0)<=0 && Number(gs?.team?.budget??gs?.finances?.balance??0)<baseComponentConstructionCost(gs,row.slot))}
                  onClick={()=>replaceBaseComponent(selectedCar,row.slot)}
                >
                  {Number(baseStock?.[row.slot]||0)>0?"Replace":`Construct & fit · ${baseComponentConstructionCost(gs,row.slot).toLocaleString("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0})}`}
                </Button>
                <div className="text-[10px] text-slate-500 mt-1">Standard spares: {Number(baseStock?.[row.slot]||0)}</div>
              </div>}
          </div>)}
        </div>
      </Panel>

      <Panel title="Warehouse" className="xl:col-span-3" action={<Link to="/Development" className="text-xs text-slate-300">Manufacture ›</Link>}>
        <div className="max-h-[560px] overflow-y-auto divide-y divide-white/10">
          <div className="p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Standard spares</div>
            <div className="space-y-2">
              {CAR_COMPONENT_SLOTS.map((slot)=><div key={slot} className="rounded border border-white/10 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1"><div className="text-sm font-medium">{nice(slot)}</div><div className="text-[10px] text-slate-500">Stock {Number(baseStock?.[slot]||0)} · build cost {baseComponentConstructionCost(gs,slot).toLocaleString("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0})}</div></div>
                  <Button size="sm" variant="darkOutline" onClick={()=>buildStandardSpare(slot)} disabled={Number(gs?.team?.budget??gs?.finances?.balance??0)<baseComponentConstructionCost(gs,slot)}>Construct</Button>
                </div>
              </div>)}
            </div>
          </div>
          {availableParts.map((part)=><div key={part.id} className="p-3">
            <div className="font-medium truncate">{part.name}</div>
            <div className="text-xs text-slate-500">{nice(part.slot)} · +{Number(part.perf||0).toFixed(2)} performance · stock {Number(part.inv||0)}</div>
            <Button className="mt-2 w-full" size="sm" onClick={()=>fitPart(selectedCar,part)}>Fit to {selectedCar.label}</Button>
          </div>)}
          {!availableParts.length?<div className="p-4 text-sm text-slate-500">No developed parts in stock. Complete a development project and manufacture inventory.</div>:null}
        </div>
      </Panel>
    </div>}

    <Panel title="Grid comparison">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-px bg-white/10">
        {ranking.map((row,index)=><div key={row.team_id||index} className={"bg-[#12141c] p-3 flex items-center gap-3 "+(String(row.team_id)===teamId?"ring-1 ring-inset ring-white/30":"")}>
          <div className="w-6 text-right font-semibold">{row.rank||index+1}</div>
          <TeamLogo teamId={row.team_id} name={row.team_name||row.name} size="h-8 w-8"/>
          <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{row.team_name||row.name||row.team_id}</div><div className="text-xs text-slate-500">Overall {Number(row.overall||0).toFixed(1)}</div></div>
        </div>)}
      </div>
    </Panel>
  </div>;
}
