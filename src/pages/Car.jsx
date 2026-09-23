import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, ArrowLeft, ArrowRight, BarChart3, CarFront, CircleDot, Factory, Gauge, Settings2, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { DriverPortrait, TeamLogo } from "@/components/entity/EntityVisuals.jsx";
import { carPerformanceRanking, teamCarPerformance } from "@/domain/carPerformance";
import Development from "@/pages/Development.jsx";
import {
  componentSlotsForTeam,
  activeDriverContracts,
  driverIdOf,
  baseComponentConstructionCost,
  componentConditionForCar,
  componentConditionStatus,
  installedPartsForCar,
  syncGarageState,
} from "@/domain/garage";
import { isRaceDriverContract } from "@/domain/contractRoles.js";
import { componentGroup, componentLabel } from "@/domain/carComponents.js";
import { fitPhysicalPartUnit, inventoryCountForDesign, normalizePhysicalPartState, removePhysicalPartUnit, warehousePartUnitsForDesign } from "@/domain/partUnits.js";
import { activeWorkshopJobFor, activeWorkshopJobs, partUnitRestoreQuote, queueWorkshopJob, standardBuildQuote, standardRestoreQuote } from "@/domain/componentService.js";
import { derivePartTechnicalProfile } from "@/domain/carPartPerformance.js";
import { teamCarCharacteristics } from "@/domain/carCharacteristics.js";

const idOf=(o)=>String(o?.driver_id??o?.person_id??o?.id??"");
const nice=(s)=>String(s||"").replaceAll("_"," ").replace(/\b\w/g,(m)=>m.toUpperCase());
const currentKey=(v)=>JSON.stringify(v??null);
const moneyCompact=(n)=>"US$"+new Intl.NumberFormat("en-GB",{notation:"compact",maximumFractionDigits:1}).format(Number(n)||0);

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

const PERFORMANCE_METRICS=[
  ["overall","Overall"],
  ["qualifying","Qualifying"],
  ["race","Race Pace"],
  ["power","Power"],
  ["chassis","Chassis"],
  ["reliability","Reliability"],
];
const CHARACTERISTIC_METRICS=[
  ["top_speed","Top Speed"],
  ["acceleration","Acceleration"],
  ["low_speed","Low-speed"],
  ["medium_speed","Medium-speed"],
  ["high_speed","High-speed"],
  ["mechanical_grip","Mechanical Grip"],
  ["braking","Braking"],
  ["aero_efficiency","Aero Efficiency"],
  ["aero_stability","Aero Stability"],
  ["tyre_preservation","Tyre Preservation"],
  ["cooling","Cooling"],
  ["ground_effect","Ground Effect"],
];
const PART_ICON_BY_SLOT={
  chassis:CarFront,
  aero_front:Activity,
  aero_rear:Activity,
  sidepods:Activity,
  underfloor:CarFront,
  suspension:Wrench,
  gearbox:Settings2,
  brakes:CircleDot,
  cooling:Activity,
  turbocharger:Gauge,
  electronics:Activity,
  kers:Gauge,
  ers_mgu_k:Gauge,
  ers_mgu_h:Gauge,
  battery_pack:Activity,
  fuel_system:Gauge,
  exhaust_system:Activity,
};
function PartIcon({slot}){
  const Icon=PART_ICON_BY_SLOT[slot]||Settings2;
  return <Icon className="h-5 w-5 text-slate-300"/>;
}
function daysBetween(a,b){
  if(!a||!b)return null;
  const x=Date.parse(String(a).slice(0,10)+"T00:00:00Z");
  const y=Date.parse(String(b).slice(0,10)+"T00:00:00Z");
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  return Math.ceil((y-x)/86400000);
}
function projectProgress(project,currentDateISO){
  if(project?.status==="completed")return 100;
  if(project?.status==="paused")return Math.max(0,Math.min(100,Number(project?.progress||0)*100));
  const total=daysBetween(project?.started_at,project?.finishes_at);
  const remain=daysBetween(currentDateISO,project?.finishes_at);
  if(!Number.isFinite(total)||total<=0||!Number.isFinite(remain))return 0;
  return Math.max(0,Math.min(100,((total-remain)/total)*100));
}
function isTargetPerformanceRow(row,teamId,driverId=null){
  if(String(row?.team_id??"")!==String(teamId??""))return false;
  if(driverId==null||driverId==="")return true;
  return String(row?.driver_id??"")===String(driverId);
}
function metricRank(ranking,teamId,perf,key,driverId=null){
  const rows=ranking.map((row)=>isTargetPerformanceRow(row,teamId,driverId)?{...row,[key]:Number(perf?.[key]??row?.[key]??0)}:row);
  const sorted=[...rows].sort((a,b)=>
    Number(b?.[key]||0)-Number(a?.[key]||0) ||
    String(a?.team_id??"").localeCompare(String(b?.team_id??"")) ||
    String(a?.driver_id??"").localeCompare(String(b?.driver_id??""))
  );
  const idx=sorted.findIndex((row)=>isTargetPerformanceRow(row,teamId,driverId));
  return idx>=0?idx+1:null;
}
function metricAverage(ranking,teamId,perf,key,driverId=null){
  const vals=ranking.map((row)=>Number(isTargetPerformanceRow(row,teamId,driverId)?perf?.[key]??row?.[key]:row?.[key])).filter(Number.isFinite);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
}
function ProgressLine({value,warn=false}){
  const v=Math.max(0,Math.min(100,Number(value)||0));
  return <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={warn?"h-full bg-amber-300":"h-full bg-slate-200"} style={{width:v+"%"}}/></div>;
}
function StatusPill({status,condition}){
  const key=status?.key||"healthy";
  const cls=key==="failing"||key==="critical"?"border-rose-400/30 bg-rose-400/10 text-rose-300":key==="degraded"||key==="worn"?"border-amber-300/30 bg-amber-300/10 text-amber-200":"border-emerald-300/20 bg-emerald-300/10 text-emerald-300";
  return <span className={"inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase "+cls}>{condition<60?<TriangleAlert className="h-3 w-3"/>:null}{status?.label||nice(key)}</span>;
}
function PerformanceRows({ranking,teamId,perf,driverId=null}){
  return <div className="space-y-3">
    {PERFORMANCE_METRICS.map(([key,label])=>{
      const value=Number(perf?.[key]||0);
      const avg=metricAverage(ranking,teamId,perf,key,driverId);
      const delta=value-avg;
      const rank=metricRank(ranking,teamId,perf,key,driverId);
      return <div key={key}>
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-sm items-center"><span className="text-slate-400">{label}</span><strong className="tabular-nums">{value.toFixed(1)}</strong><span className={"w-10 text-right text-xs "+(rank&&rank<=3?"text-cyan-300":"text-slate-500")}>{rank?"#"+rank:"—"}</span></div>
        <div className="mt-1.5 flex items-center gap-2"><div className="flex-1"><ProgressLine value={value} warn={delta<-5}/></div><span className={"w-14 text-right text-[10px] "+(delta>=0?"text-emerald-300":"text-amber-300")}>{(delta>=0?"+":"")+delta.toFixed(1)}</span></div>
      </div>;
    })}
    <div className="pt-2 border-t border-white/10 text-[10px] uppercase tracking-wide text-slate-500">Delta vs current grid average</div>
  </div>;
}
function PerformancePanel({ranking,teamId,perf,driverId=null,title="Car Performance"}){
  return <Panel title={title}><div className="p-4"><PerformanceRows ranking={ranking} teamId={teamId} perf={perf} driverId={driverId}/></div></Panel>;
}

export default function Car(){
  const gs=useGame((s)=>s.gameState);
  const [searchParams,setSearchParams]=useSearchParams();
  const setGameState=useGame((s)=>s.setGameState);
  const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const teamName=gs?.team?.team_name||gs?.team?.name||teamId||"My Team";
  const drivers=gs?.drivers||[];
  const currentDateISO=String(gs?.currentDateISO||"").slice(0,10);
  const [carInfoTab,setCarInfoTab]=useState("performance");
  const [analysisMode,setAnalysisMode]=useState("characteristics");

  const rawSyncedGarage=useMemo(()=>syncGarageState(gs,gs?.garage||{}),[
    gs?.garage,gs?.contracts,gs?.activeYear,teamId,
  ]);
  const physicalState=useMemo(
    ()=>normalizePhysicalPartState({...gs,garage:rawSyncedGarage}),
    [gs,rawSyncedGarage]
  );
  const syncedGarage=physicalState?.garage||rawSyncedGarage;
  const parts=physicalState?.development?.parts||[];
  const partUnits=physicalState?.development?.partUnits||[];
  const projects=Array.isArray(physicalState?.development?.projects)?physicalState.development.projects:[];
  const manufacturing=Array.isArray(physicalState?.development?.manufacturing)?physicalState.development.manufacturing:[];
  const baseStock=syncedGarage?.baseComponentStock||{};

  useEffect(()=>{
    const garageChanged=currentKey(gs?.garage?.cars)!==currentKey(syncedGarage?.cars);
    const unitsChanged=Array.isArray(physicalState?.development?.partUnits) &&
      currentKey(gs?.development?.partUnits)!==currentKey(partUnits);
    const partsChanged=Array.isArray(physicalState?.development?.parts) &&
      currentKey(gs?.development?.parts)!==currentKey(parts);
    if(garageChanged||unitsChanged||partsChanged){
      setGameState({
        garage:syncedGarage,
        development:{...(gs?.development||{}),...(physicalState?.development||{})},
      });
    }
  },[
    currentKey(gs?.garage?.cars),
    currentKey(syncedGarage?.cars),
    currentKey(gs?.development?.partUnits),
    currentKey(partUnits),
    currentKey(gs?.development?.parts),
    currentKey(parts),
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const driverById=useMemo(()=>new Map(drivers.map((d)=>[idOf(d),d])),[drivers]);
  const ranking=useMemo(()=>carPerformanceRanking(physicalState),[physicalState]);
  const myRank=ranking.find((r)=>String(r.team_id)===teamId);
  const carGrid=useMemo(()=>{
    const state=physicalState;
    return (gs?.teams||[]).flatMap((team)=>{
      const tid=String(team?.team_id??team?.id??"");
      if(!tid)return [];
      const raceContracts=activeDriverContracts(state,tid).filter(isRaceDriverContract);
      if(!raceContracts.length){
        return [{
          ...teamCarPerformance(state,tid),
          team_id:tid,
          team_name:team?.team_name||team?.name||tid,
          driver_id:null,
          car_slot:1,
        }];
      }
      return raceContracts.map((contract,index)=>{
        const did=driverIdOf(contract)||null;
        return {
          ...teamCarPerformance(state,tid,did),
          team_id:tid,
          team_name:team?.team_name||team?.name||tid,
          driver_id:did,
          car_slot:index+1,
        };
      });
    });
  },[physicalState]);
  const characteristicGrid=useMemo(()=>carGrid.map((row)=>({
    ...row,
    ...teamCarCharacteristics(physicalState,row.team_id,row.driver_id).values,
  })),[physicalState,carGrid]);
  const cars=syncedGarage?.cars||[];
  const raceCars=cars.filter((c)=>c.kind!=="reserve");
  const viewRaw=searchParams.get("view")||"overview";
  const view=["overview","car","analysis","development"].includes(viewRaw)?viewRaw:"overview";
  const selectedId=searchParams.get("car")||raceCars[0]?.id||cars[0]?.id||"";
  const selectedCar=cars.find((c)=>c.id===selectedId)||raceCars[0]||cars[0]||null;
  const selectedDriver=selectedCar?driverById.get(String(selectedCar.driver_id||"")):null;
  const carState=physicalState;
  const selectedPerf=selectedCar?teamCarPerformance(carState,teamId,selectedCar.driver_id):null;
  const selectedCharacteristics=selectedCar?teamCarCharacteristics(carState,teamId,selectedCar.driver_id):null;
  const selectedFitted=selectedCar?installedPartsForCar(carState,selectedCar):[];
  const eligibleComponentSlots=componentSlotsForTeam(carState,teamId);
  const componentRows=selectedCar?eligibleComponentSlots.map((slot)=>{
    const condition=componentConditionForCar(carState,selectedCar,slot);
    return {
      slot,condition,status:componentConditionStatus(condition),
      installed:selectedFitted.find((row)=>row.slot===slot)||null,
    };
  }):[];
  const averageCondition=componentRows.length?componentRows.reduce((s,row)=>s+row.condition,0)/componentRows.length:0;

  const commitPhysicalState=(nextState)=>{
    const normalized=normalizePhysicalPartState(nextState);
    setGameState({
      garage:normalized?.garage,
      development:normalized?.development,
    });
  };
  const fitPart=(car,part)=>{
    const slot=String(part?.slot||"");
    if(!slot||inventoryCountForDesign(carState,part?.id)<=0)return;
    const next=fitPhysicalPartUnit(carState,{carId:car.id,slot,designId:part.id});
    commitPhysicalState(next);
  };
  const removePart=(car,slot)=>{
    if(!car?.installedParts?.[slot])return;
    const next=removePhysicalPartUnit(carState,{carId:car.id,slot});
    commitPhysicalState(next);
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

  const startWorkshopJob=(quote,title)=>{
    if(!quote||!currentDateISO)return false;
    const budget=Number(gs?.team?.budget??gs?.finances?.balance??0);
    if(budget<Number(quote.cost||0))return false;
    const beforeJobs=(carState?.garage?.serviceJobs||[]).length;
    const next=queueWorkshopJob(carState,quote,{
      id:`workshop_${Date.now()}`,
      title,
      startedAt:currentDateISO,
    });
    if((next?.garage?.serviceJobs||[]).length<=beforeJobs)return false;
    if(!spend(quote.cost,title))return false;
    setGameState({
      garage:next?.garage,
      development:next?.development||carState?.development,
    });
    return true;
  };

  const buildStandardSpare=(slot)=>{
    const quote=standardBuildQuote(carState,slot);
    startWorkshopJob(quote,`Build standard spare — ${componentLabel(carState,slot)}`);
  };

  const restoreStandardComponent=(car,slot)=>{
    if(car?.installedParts?.[slot])return;
    const condition=componentConditionForCar(carState,car,slot);
    if(condition>=99.5)return;
    const quote=standardRestoreQuote(carState,slot,condition,{carId:car.id});
    startWorkshopJob(quote,`Restore — ${componentLabel(carState,slot)} · ${car.label}`);
  };

  const restoreDevelopedUnit=(part,unit)=>{
    if(!part||!unit||Number(unit?.condition??100)>=99.5)return;
    const quote=partUnitRestoreQuote(carState,unit.id);
    startWorkshopJob(quote,`Restore ${part.name||part.version||componentLabel(carState,part.slot)} · ${unit.id}`);
  };

  const replaceBaseComponent=(car,slot)=>{
    if(car?.installedParts?.[slot])return;
    const before=componentConditionForCar(carState,car,slot);
    if(before>=99.5)return;
    const stockCount=Number(baseStock?.[slot]||0);

    if(stockCount<=0){
      const quote=standardBuildQuote(carState,slot,{fitCarId:car.id});
      startWorkshopJob(quote,`Build & fit — ${componentLabel(carState,slot)} · ${car.label}`);
      return;
    }

    const nextStock={...baseStock,[slot]:Math.max(0,stockCount-1)};
    const nextCars=cars.map((c)=>c.id!==car.id?c:{...c,componentCondition:{...(c.componentCondition||{}),[slot]:100}});
    setGameState({
      garage:{...syncedGarage,baseComponentStock:nextStock,cars:nextCars},
      componentServiceLog:[{
        date:String(gs?.currentDateISO||"").slice(0,10),car_id:car.id,slot,
        condition_before:Number(before.toFixed(1)),condition_after:100,
        action:"replace_from_stock",
        cost:0,
      },...(Array.isArray(gs?.componentServiceLog)?gs.componentServiceLog:[])].slice(0,300),
    });
  };

  const availableParts=parts.filter((p)=>inventoryCountForDesign(carState,p.id)>0);
  const activeProjects=projects.filter((p)=>p.status==="active"||p.status==="paused");
  const activeManufacturing=manufacturing.filter((m)=>m.status==="active");
  const workshop=activeWorkshopJobs(carState);
  const setView=(nextView,extra={})=>{
    const next=new URLSearchParams(searchParams);
    next.set("view",nextView);
    ["car","group","tab"].forEach((key)=>next.delete(key));
    Object.entries(extra).forEach(([key,value])=>{if(value!=null&&value!=="")next.set(key,String(value));});
    setSearchParams(next);
  };
  const openCar=(carId)=>setView("car",{car:carId,group:"aero"});
  const openDevelopment=(tab="projects")=>setView("development",{tab});
  const setDevelopmentTab=(tab)=>{
    const next=new URLSearchParams(searchParams);
    next.set("view","development");
    next.set("tab",tab);
    setSearchParams(next);
  };
  const setCarGroup=(group)=>{
    const next=new URLSearchParams(searchParams);
    next.set("view","car");
    next.set("car",selectedCar?.id||"");
    next.set("group",group);
    setSearchParams(next);
  };

  const title=view==="car"?(selectedCar?.label||"Car"):view==="analysis"?"Car Analysis":view==="development"?"Car Parts Development":"Cars";
  const selectedGroup=searchParams.get("group")==="mechanical"?"mechanical":"aero";
  const visibleComponents=componentRows.filter((row)=>componentGroup(row.slot)===selectedGroup);
  const fleetHealth=raceCars.length?raceCars.map((car)=>{
    const vals=eligibleComponentSlots.map((slot)=>componentConditionForCar(carState,car,slot));
    return vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);
  }).reduce((a,b)=>a+b,0)/raceCars.length:0;

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-5 space-y-4">
    <div className="rounded-xl border border-white/10 bg-[#12141c] px-4 py-3 flex flex-col xl:flex-row xl:items-center gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={()=>view==="overview"?null:setView("overview")} className="h-10 w-10 shrink-0 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center">
          {view==="overview"?<CarFront className="h-5 w-5"/>:<ArrowLeft className="h-4 w-4"/>}
        </button>
        <TeamLogo teamId={teamId} name={teamName} size="h-10 w-10" className="p-0.5"/>
        <div className="min-w-0"><div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Technical Department</div><h1 className="text-xl md:text-2xl font-semibold truncate">{title}</h1>{view==="car"?<div className="text-xs text-slate-400 truncate">Assigned to <span className="text-slate-200 font-medium">{selectedDriver?.display_name||selectedDriver?.name||"No driver assigned"}</span></div>:null}</div>
      </div>
      <div className="flex-1"/>
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-white/10 bg-[#0d0f15] p-1">
        <button onClick={()=>setView("overview")} className={"px-3 py-2 rounded-md text-xs font-semibold whitespace-nowrap "+(view==="overview"?"bg-slate-100 text-slate-950":"text-slate-400 hover:text-white hover:bg-white/5")}>Overview</button>
        {raceCars.map((car)=><button key={car.id} onClick={()=>openCar(car.id)} className={"px-3 py-2 rounded-md text-xs font-semibold whitespace-nowrap "+(view==="car"&&selectedCar?.id===car.id?"bg-slate-100 text-slate-950":"text-slate-400 hover:text-white hover:bg-white/5")}>{car.label}</button>)}
        <button onClick={()=>setView("analysis",{car:selectedCar?.id||raceCars[0]?.id})} className={"px-3 py-2 rounded-md text-xs font-semibold whitespace-nowrap "+(view==="analysis"?"bg-slate-100 text-slate-950":"text-slate-400 hover:text-white hover:bg-white/5")}>Analysis</button>
        <button onClick={()=>openDevelopment("projects")} className={"px-3 py-2 rounded-md text-xs font-semibold whitespace-nowrap "+(view==="development"?"bg-slate-100 text-slate-950":"text-slate-400 hover:text-white hover:bg-white/5")}>Development</button>
      </div>
    </div>

    {view==="overview"&&<div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <div className="xl:col-span-8 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {raceCars.map((car)=>{
            const driver=driverById.get(String(car.driver_id||""));
            const perf=teamCarPerformance(carState,teamId,car.driver_id);
            const conditions=eligibleComponentSlots.map((slot)=>componentConditionForCar(carState,car,slot));
            const health=conditions.reduce((a,b)=>a+b,0)/Math.max(1,conditions.length);
            const alerts=conditions.filter((value)=>value<60).length;
            return <button key={car.id} onClick={()=>openCar(car.id)} className="group rounded-xl border border-white/10 bg-[#12141c] hover:bg-[#171a23] hover:border-white/20 transition text-left overflow-hidden">
              <div className="p-4 flex items-start gap-3">
                <DriverPortrait driver={driver||{display_name:"Car"}} size="h-16 w-16"/>
                <div className="min-w-0 flex-1"><div className="text-[10px] uppercase tracking-wide text-slate-500">Race Car</div><div className="text-xl font-semibold">{car.label}</div><div className="text-sm text-slate-400 truncate">{driver?.display_name||driver?.name||"No driver assigned"}</div></div>
                <ArrowRight className="h-4 w-4 text-slate-600 group-hover:text-slate-300"/>
              </div>
              <div className="grid grid-cols-3 gap-px bg-white/10">
                <div className="bg-[#12141c] p-3"><div className="text-[10px] uppercase text-slate-500">Overall</div><div className="font-semibold">{Number(perf.overall).toFixed(1)}</div></div>
                <div className="bg-[#12141c] p-3"><div className="text-[10px] uppercase text-slate-500">Race</div><div className="font-semibold">{Number(perf.race).toFixed(1)}</div></div>
                <div className="bg-[#12141c] p-3"><div className="text-[10px] uppercase text-slate-500">Condition</div><div className={alerts?"font-semibold text-amber-300":"font-semibold"}>{health.toFixed(0)}%</div></div>
              </div>
              {alerts?<div className="px-4 py-2 border-t border-white/10 text-xs text-amber-300 flex items-center gap-2"><TriangleAlert className="h-3.5 w-3.5"/>{alerts} component{alerts===1?"":"s"} need attention</div>:null}
            </button>;
          })}
        </div>

        <Panel title="Car Parts Development" action={<button onClick={()=>openDevelopment("projects")} className="text-xs text-slate-300 hover:text-white flex items-center gap-1">Open department <ArrowRight className="h-3.5 w-3.5"/></button>}>
          {activeProjects.length?<div className="divide-y divide-white/10">{activeProjects.slice(0,3).map((p)=>{
            const progress=projectProgress(p,currentDateISO);
            const remaining=daysBetween(currentDateISO,p.finishes_at);
            return <button key={p.id} onClick={()=>openDevelopment("projects")} className="w-full p-3 grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1fr)_90px_70px_20px] gap-3 items-center text-left hover:bg-white/[0.03]">
              <div className="min-w-0"><div className="text-xs text-slate-500 uppercase">{nice(p.type)} · {nice(p.phase)}</div><div className="font-medium truncate">{p.name}</div><div className="mt-2"><ProgressLine value={progress}/></div></div>
              <div className="hidden md:block text-right"><div className="text-[10px] uppercase text-slate-500">Engineers</div><strong>{p.engineers||0}</strong></div>
              <div className="text-right"><div className="text-[10px] uppercase text-slate-500">ETA</div><strong>{Number.isFinite(remaining)?Math.max(0,remaining)+"d":"—"}</strong></div>
              <ArrowRight className="hidden md:block h-4 w-4 text-slate-600"/>
            </button>;
          })}</div>:<div className="p-5 flex items-center justify-between gap-4"><div><div className="font-medium">No active car development project</div><div className="text-sm text-slate-500">Start a design project without leaving the Cars hub.</div></div><Button size="sm" onClick={()=>openDevelopment("projects")}>Start project</Button></div>}
        </Panel>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button onClick={()=>setView("analysis",{car:raceCars[0]?.id})} className="rounded-xl border border-white/10 bg-[#12141c] p-4 text-left hover:bg-[#171a23] flex items-center gap-4"><div className="h-11 w-11 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center"><BarChart3 className="h-5 w-5"/></div><div className="flex-1"><div className="font-semibold">Car Analysis</div><div className="text-sm text-slate-500">Compare your car against the current grid average.</div></div><ArrowRight className="h-4 w-4 text-slate-600"/></button>
          <button onClick={()=>openDevelopment("manufacturing")} className="rounded-xl border border-white/10 bg-[#12141c] p-4 text-left hover:bg-[#171a23] flex items-center gap-4"><div className="h-11 w-11 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center"><Factory className="h-5 w-5"/></div><div className="flex-1"><div className="font-semibold">Manufacturing</div><div className="text-sm text-slate-500">{activeManufacturing.length} active · {availableParts.length} stocked designs</div></div><ArrowRight className="h-4 w-4 text-slate-600"/></button>
        </div>
      </div>
      <div className="xl:col-span-4 space-y-4">
        <PerformancePanel ranking={ranking} teamId={teamId} perf={myRank} title="Team Car Performance"/>
        <Panel title="Technical Summary"><div className="p-3 grid grid-cols-2 gap-2"><Metric label="Grid rank" value={myRank?"#"+myRank.rank:"—"}/><Metric label="Fleet health" value={fleetHealth.toFixed(0)+"%"}/><Metric label="Active projects" value={activeProjects.length}/><Metric label="Manufacturing" value={activeManufacturing.length}/><Metric label="Workshop" value={workshop.length}/><Metric label="Parts stock" value={availableParts.reduce((s,p)=>s+Number(p.inv||0),0)}/><Metric label="Budget" value={Number(gs?.team?.budget??gs?.finances?.balance??0).toLocaleString("en-GB",{notation:"compact",maximumFractionDigits:1})}/></div></Panel>
      </div>
    </div>}

    {view==="car"&&selectedCar&&<div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <Panel title={(selectedCar.label||"Car")+" · Components"} className="xl:col-span-8" action={<div className="flex gap-1"><button onClick={()=>setCarGroup("aero")} className={"px-3 py-1.5 rounded text-xs font-semibold "+(selectedGroup==="aero"?"bg-slate-100 text-slate-950":"bg-white/5 text-slate-400")}>Aerodynamics</button><button onClick={()=>setCarGroup("mechanical")} className={"px-3 py-1.5 rounded text-xs font-semibold "+(selectedGroup==="mechanical"?"bg-slate-100 text-slate-950":"bg-white/5 text-slate-400")}>Mechanical</button></div>}>
        <div className="divide-y divide-white/10">{visibleComponents.map((row)=>{
          const stocked=parts.find((p)=>String(p.slot)===row.slot&&inventoryCountForDesign(carState,p.id)>0);
          const standardStock=Number(baseStock?.[row.slot]||0);
          const buildQuote=standardBuildQuote(carState,row.slot);
          const restoreQuote=standardRestoreQuote(carState,row.slot,row.condition,{carId:selectedCar.id});
          const activeCarJob=activeWorkshopJobFor(carState,{carId:selectedCar.id,slot:row.slot});
          const activeSpareJob=activeWorkshopJobFor(carState,{slot:row.slot,kind:"build_standard_spare"});
          const restorable=parts
            .filter((p)=>String(p.slot)===row.slot)
            .flatMap((p)=>warehousePartUnitsForDesign(carState,p.id).map((unit)=>({part:p,unit})))
            .filter(({unit})=>Number(unit?.condition??100)<99.5)
            .sort((a,b)=>Number(a.unit?.condition??100)-Number(b.unit?.condition??100))[0]||null;
          const restorableQuote=restorable?partUnitRestoreQuote(carState,restorable.unit.id):null;
          return <div key={row.slot} className="px-3 py-2.5 grid grid-cols-[36px_minmax(0,1fr)] md:grid-cols-[36px_minmax(0,1fr)_78px_minmax(230px,auto)] gap-3 items-center">
            <div className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center"><PartIcon slot={row.slot}/></div>
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2 items-center"><strong>{componentLabel(carState,row.slot)}</strong><StatusPill status={row.status} condition={row.condition}/></div>
              <div className="text-[11px] text-slate-500 truncate">{row.installed?.part?.name||"Standard component"}{row.installed?.part?.version?" · "+row.installed.part.version:""}{row.installed?.unit?.id?" · "+row.installed.unit.id:""}</div>
              {row.installed?.part?(()=>{const tech=derivePartTechnicalProfile(carState,row.installed.part);return <div className="text-[10px] text-slate-500 truncate">Wt {tech.design.weight_kg.toFixed(1)}kg · DF {tech.design.downforce.toFixed(3)} · Drag {tech.design.drag.toFixed(3)} · Rel {(tech.design.reliability*100).toFixed(1)}%</div>;})():null}
              <div className="mt-1.5"><ProgressLine value={row.condition} warn={row.condition<60}/></div>
            </div>
            <div className="text-right"><div className="font-semibold tabular-nums">{row.condition.toFixed(1)}%</div><div className="text-[9px] uppercase tracking-wide text-slate-500">condition</div></div>
            <div className="col-span-2 md:col-span-1 flex flex-wrap md:justify-end gap-1.5">
              {activeCarJob?<div className="rounded border border-cyan-300/20 bg-cyan-300/10 px-2 py-1.5 text-[10px] text-cyan-200 whitespace-nowrap">Workshop · {activeCarJob.finishes_at}</div>:null}
              {stocked?<Button size="sm" className="whitespace-nowrap" onClick={()=>fitPart(selectedCar,stocked)} disabled={Boolean(activeCarJob)}>Fit {stocked.version||"developed"} · {warehousePartUnitsForDesign(carState,stocked.id)[0]?.condition?.toFixed?.(0)??100}%</Button>:null}
              {row.installed?<Button size="sm" className="whitespace-nowrap" variant="darkOutline" onClick={()=>removePart(selectedCar,row.slot)} disabled={Boolean(activeCarJob)}>Remove</Button>:row.condition<99.5?<>
                <Button size="sm" className="whitespace-nowrap" variant="darkOutline" disabled={Boolean(activeCarJob)||Number(gs?.team?.budget??gs?.finances?.balance??0)<Number(restoreQuote.cost||0)} onClick={()=>restoreStandardComponent(selectedCar,row.slot)}>Restore · {restoreQuote.days}d · {moneyCompact(restoreQuote.cost)}</Button>
                <Button size="sm" className="whitespace-nowrap" variant="darkOutline" disabled={Boolean(activeCarJob)||(standardStock<=0&&Number(gs?.team?.budget??gs?.finances?.balance??0)<Number(buildQuote.cost||0))} onClick={()=>replaceBaseComponent(selectedCar,row.slot)}>{standardStock>0?"Replace · "+standardStock+" stock":"Build & fit · "+buildQuote.days+"d · "+moneyCompact(buildQuote.cost)}</Button>
              </>:<Button size="sm" className="whitespace-nowrap" variant="darkOutline" disabled={Boolean(activeSpareJob)||Number(gs?.team?.budget??gs?.finances?.balance??0)<Number(buildQuote.cost||0)} onClick={()=>buildStandardSpare(row.slot)}>{activeSpareJob?"Spare building":"Build spare · "+buildQuote.days+"d · "+moneyCompact(buildQuote.cost)}</Button>}
              {restorable&&restorableQuote?<Button size="sm" className="whitespace-nowrap" variant="darkOutline" disabled={Number(gs?.team?.budget??gs?.finances?.balance??0)<Number(restorableQuote.cost||0)} onClick={()=>restoreDevelopedUnit(restorable.part,restorable.unit)}>Restore {restorable.part.version||"part"} · {Number(restorable.unit.condition||0).toFixed(0)}% · {restorableQuote.days}d · {moneyCompact(restorableQuote.cost)}</Button>:null}
            </div>
          </div>;
        })}</div>
      </Panel>
      <div className="xl:col-span-4">
        <Panel title="Car Overview" action={<div className="flex gap-1">
          {[["performance","Performance"],["characteristics","Characteristics"],["reliability","Reliability"]].map(([key,label])=><button key={key} onClick={()=>setCarInfoTab(key)} className={"px-2 py-1 rounded text-[10px] font-semibold "+(carInfoTab===key?"bg-slate-100 text-slate-950":"bg-white/5 text-slate-400 hover:text-white")}>{label}</button>)}
        </div>}>
          <div className="p-3">
            {carInfoTab==="performance"?<PerformanceRows ranking={carGrid} teamId={teamId} perf={selectedPerf} driverId={selectedCar?.driver_id}/>:null}
            {carInfoTab==="characteristics"?<div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {CHARACTERISTIC_METRICS.map(([key,label])=>{
                  const value=selectedCharacteristics?.values?.[key];
                  if(value==null)return null;
                  const delta=Number(selectedCharacteristics?.upgrade_delta?.[key]||0);
                  return <Metric key={key} label={label} value={<span>{Number(value).toFixed(1)}{Math.abs(delta)>=0.05?<span className={delta>=0?"ml-1 text-emerald-300 text-xs":"ml-1 text-amber-300 text-xs"}>{delta>=0?"+":""}{delta.toFixed(1)}</span>:null}</span>}/>;
                })}
              </div>
              <div className="border-t border-white/10 pt-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Technical delta</div>
                {selectedFitted.length?<div className="grid grid-cols-4 gap-2 text-xs">
                  <div><span className="text-slate-500">Weight</span><div className="font-semibold">{(Number(selectedPerf?.technical_delta?.weight_kg||0)<=0?"":"+")+Number(selectedPerf?.technical_delta?.weight_kg||0).toFixed(2)+"kg"}</div></div>
                  <div><span className="text-slate-500">Drag</span><div className="font-semibold">{(Number(selectedPerf?.technical_delta?.drag||0)<=0?"":"+")+Number(selectedPerf?.technical_delta?.drag||0).toFixed(4)}</div></div>
                  <div><span className="text-slate-500">Downforce</span><div className="font-semibold">+{Number(selectedPerf?.technical_delta?.downforce||0).toFixed(4)}</div></div>
                  <div><span className="text-slate-500">Design Rel.</span><div className="font-semibold">+{Number(selectedPerf?.technical_delta?.design_reliability_pct||0).toFixed(1)}pp</div></div>
                </div>:<div className="text-xs text-slate-400">Historical baseline specification; no developed upgrade is fitted.</div>}
              </div>
            </div>:null}
            {carInfoTab==="reliability"?<div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Historical base" value={Number(selectedPerf?.reliability_profile?.historical?.combined_pct||selectedPerf?.reliability||0).toFixed(1)+"%"}/>
                <Metric label="Effective" value={Number(selectedPerf?.reliability_profile?.reliability_pct||selectedPerf?.reliability||0).toFixed(1)+"%"}/>
                <Metric label="Design delta" value={(Number(selectedPerf?.reliability_profile?.design_delta_pct||0)>=0?"+":"")+Number(selectedPerf?.reliability_profile?.design_delta_pct||0).toFixed(1)+" pp"}/>
                <Metric label="Condition penalty" value={"-"+Number(selectedPerf?.reliability_profile?.condition_penalty_pct||0).toFixed(1)+" pp"}/>
              </div>
              {(selectedPerf?.reliability_profile?.weakest_components||[]).length?<div className="border-t border-white/10 pt-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Highest component risk</div>
                {(selectedPerf.reliability_profile.weakest_components||[]).slice(0,4).map((row)=><div key={row.slot} className="flex items-center gap-2 text-xs py-1"><span className="flex-1 text-slate-300">{row.label||componentLabel(carState,row.slot)}</span><span className="text-slate-500">{Number(row.condition_pct||100).toFixed(0)}%</span><span className={Number(row.condition_penalty_pct||0)>2?"text-rose-300":"text-slate-400"}>-{Number(row.condition_penalty_pct||0).toFixed(1)}pp</span></div>)}
              </div>:null}
            </div>:null}
          </div>
          <div className="border-t border-white/10 bg-[#0d0f15] p-3 grid grid-cols-4 gap-2 text-xs">
            <div><div className="text-[9px] uppercase text-slate-500">Driver</div><div className="font-medium truncate">{selectedDriver?.display_name||selectedDriver?.name||"Unassigned"}</div></div>
            <div><div className="text-[9px] uppercase text-slate-500">Condition</div><div className="font-medium">{averageCondition.toFixed(1)}%</div></div>
            <div><div className="text-[9px] uppercase text-slate-500">Upgrades</div><div className="font-medium">{selectedFitted.length}</div></div>
            <div><div className="text-[9px] uppercase text-slate-500">Rel. penalty</div><div className="font-medium">{Number(selectedPerf?.wear_penalty?.reliability||0).toFixed(1)}</div></div>
          </div>
        </Panel>
      </div>
    </div>}

    {view==="analysis"&&<div className="space-y-3">
      <Panel title="Compare Car"><div className="p-2.5 flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">{raceCars.map((car)=>{
          const d=driverById.get(String(car.driver_id||""));
          const active=car.id===selectedCar?.id;
          return <button key={car.id} onClick={()=>setView("analysis",{car:car.id})} className={"rounded-lg border px-3 py-2 flex items-center gap-3 text-left "+(active?"border-cyan-300/30 bg-cyan-300/[0.08]":"border-white/10 bg-white/[0.03] hover:bg-white/[0.05]")}><DriverPortrait driver={d||{display_name:"Car"}} size="h-10 w-10"/><div className="min-w-0 flex-1"><div className="font-semibold">{car.label}</div><div className="text-xs text-slate-500 truncate">{d?.display_name||d?.name||"No driver assigned"}</div></div>{active?<span className="text-[10px] uppercase tracking-wide text-cyan-300">Selected</span>:null}</button>;
        })}</div>
        <div className="lg:max-w-[430px] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-500">Historical starting specification is TEAM + YEAR, so Car 1 and Car 2 can begin identical. Physical units, wear, accidents, upgrades and setup make them diverge during the save.</div>
      </div></Panel>
      <Panel title="Grid Analysis" action={<div className="flex gap-1"><button onClick={()=>setAnalysisMode("characteristics")} className={"px-3 py-1.5 rounded text-xs font-semibold "+(analysisMode==="characteristics"?"bg-slate-100 text-slate-950":"bg-white/5 text-slate-400")}>Characteristics</button><button onClick={()=>setAnalysisMode("performance")} className={"px-3 py-1.5 rounded text-xs font-semibold "+(analysisMode==="performance"?"bg-slate-100 text-slate-950":"bg-white/5 text-slate-400")}>Performance</button></div>}>
        {analysisMode==="performance"?<div className="max-h-[68vh] overflow-auto"><table className="min-w-full text-sm"><thead className="bg-[#171a23] text-slate-400"><tr><th className="px-4 py-2.5 text-left">Performance</th><th className="px-4 py-2.5 text-right">{selectedCar?.label||"Selected"}</th><th className="px-4 py-2.5 text-right">Grid Average</th><th className="px-4 py-2.5 text-right">Delta</th><th className="px-4 py-2.5 text-right">Rank</th></tr></thead><tbody>{PERFORMANCE_METRICS.map(([key,label])=>{
          const value=Number(selectedPerf?.[key]||0); const avg=metricAverage(carGrid,teamId,selectedPerf,key,selectedCar?.driver_id); const delta=value-avg; const rank=metricRank(carGrid,teamId,selectedPerf,key,selectedCar?.driver_id);
          return <tr key={key} className="border-t border-white/10"><td className="px-4 py-3 font-medium">{label}</td><td className="px-4 py-3 text-right font-semibold">{value.toFixed(1)}</td><td className="px-4 py-3 text-right text-slate-400">{avg.toFixed(1)}</td><td className={"px-4 py-3 text-right font-medium "+(delta>=0?"text-emerald-300":"text-amber-300")}>{(delta>=0?"+":"")+delta.toFixed(1)}</td><td className={"px-4 py-3 text-right font-semibold "+(rank&&rank<=3?"text-cyan-300":"")}>{rank?"#"+rank:"—"}</td></tr>;
        })}</tbody></table></div>:<div className="max-h-[68vh] overflow-auto">
          <table className="min-w-[1080px] w-full text-xs">
            <thead className="sticky top-0 z-10 bg-[#171a23] text-slate-400"><tr><th className="px-3 py-2 text-left">Team / Car</th>{CHARACTERISTIC_METRICS.filter(([key])=>selectedCharacteristics?.values?.[key]!=null).map(([key,label])=><th key={key} className="px-3 py-2 text-right whitespace-nowrap">{label}</th>)}</tr></thead>
            <tbody>{characteristicGrid.map((row,index)=>{
              const isSelected=String(row.team_id)===teamId&&String(row.driver_id||"")===String(selectedCar?.driver_id||"");
              const driver=driverById.get(String(row.driver_id||""));
              return <tr key={String(row.team_id)+"-"+String(row.driver_id||index)} className={"border-t border-white/10 "+(isSelected?"bg-cyan-300/[0.08]":"")}>
                <td className="px-3 py-2"><div className="font-medium">{row.team_name||row.team_id} · Car {row.car_slot||1}</div><div className="text-[10px] text-slate-500">{driver?.display_name||driver?.name||row.driver_id||"Team baseline"}</div></td>
                {CHARACTERISTIC_METRICS.filter(([key])=>selectedCharacteristics?.values?.[key]!=null).map(([key])=>{const value=row?.[key]; const selectedValue=Number(selectedCharacteristics?.values?.[key]||0); const cls=isSelected?"font-semibold text-cyan-200":Number(value)>selectedValue?"text-emerald-300":"text-slate-300"; return <td key={key} className={"px-3 py-2 text-right tabular-nums "+cls}>{value==null?"—":Number(value).toFixed(1)}</td>;})}
              </tr>;
            })}</tbody>
          </table>
        </div>}
      </Panel>
    </div>}

    {view==="development"&&<Development embedded initialTab={searchParams.get("tab")||"projects"} onTabChange={setDevelopmentTab}/>}
  </div>;
}
