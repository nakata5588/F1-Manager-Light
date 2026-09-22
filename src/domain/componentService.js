// src/domain/componentService.js
// Time-based workshop jobs for standard components and developed physical units.

import { baseComponentConstructionCost } from "./garage.js";
import {
  normalizePhysicalPartState,
  partDesignById,
  partUnitById,
  physicalUnitLocation,
} from "./partUnits.js";

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const str=(v)=>String(v??"");

function parseISO(value){
  const raw=String(value||"").slice(0,10);
  const [y,m,d]=raw.split("-").map(Number);
  return new Date(Date.UTC(y||1970,(m||1)-1,d||1));
}
function addDaysISO(value,days){
  const d=parseISO(value);
  d.setUTCDate(d.getUTCDate()+Math.max(0,Math.floor(Number(days)||0)));
  return d.toISOString().slice(0,10);
}

export function manufacturingLevel(gs){
  const direct=Number(
    gs?.hq?.facilityLevels?.manufacturing_level ??
    gs?.hq?.facilityLevels?.manufacturing_leve
  );
  if(Number.isFinite(direct))return clamp(direct,1,10);

  const year=Number(gs?.activeYear);
  const teamId=str(gs?.team?.team_id??gs?.team?.id);
  const rows=Array.isArray(gs?.facilities)&&gs.facilities.length
    ?gs.facilities
    :(gs?.dbFacilities||[]);
  const row=rows.find((item)=>{
    const tid=str(item?.team_id??item?.team);
    const rowYear=Number(item?.year??item?.season_year);
    return tid===teamId&&(!Number.isFinite(year)||!Number.isFinite(rowYear)||rowYear===year);
  })||{};
  const fallback=Number(row?.manufacturing_level??row?.manufacturing_leve);
  return Number.isFinite(fallback)?clamp(fallback,1,10):5;
}

export function standardBuildQuote(gs,slot,{fitCarId=null}={}){
  const level=manufacturingLevel(gs);
  const cost=baseComponentConstructionCost(gs,slot);
  const days=Math.max(2,Math.round(9-level*0.55));
  return {
    kind:fitCarId?"build_and_fit_standard":"build_standard_spare",
    slot:str(slot),
    car_id:fitCarId?str(fitCarId):null,
    cost,
    days,
  };
}

export function standardRestoreQuote(gs,slot,condition,{carId=null}={}){
  const level=manufacturingLevel(gs);
  const current=clamp(condition);
  const missing=Math.max(0,100-current);
  const newCost=baseComponentConstructionCost(gs,slot);
  const cost=Math.max(
    5_000,
    Math.round(newCost*(0.12+0.43*(missing/100))/1000)*1000
  );
  const rawDays=1+missing/18;
  const speed=Math.max(0.58,1.12-level*0.055);
  const days=Math.max(1,Math.round(rawDays*speed));
  return {
    kind:"restore_standard",
    slot:str(slot),
    car_id:carId?str(carId):null,
    condition_before:current,
    cost,
    days,
  };
}

export function partUnitRestoreQuote(gs,unitId){
  const normalized=normalizePhysicalPartState(gs);
  const unit=partUnitById(normalized,unitId);
  if(!unit)return null;
  const design=partDesignById(normalized,unit.design_id);
  const slot=str(unit?.slot??design?.slot);
  const current=clamp(unit?.condition??100);
  const missing=Math.max(0,100-current);
  const level=manufacturingLevel(normalized);
  const newCost=baseComponentConstructionCost(normalized,slot);
  const performanceFactor=1+Math.max(0,Number(design?.perf||0))*0.07;
  const cost=Math.max(
    5_000,
    Math.round(newCost*(0.10+0.38*(missing/100))*performanceFactor/1000)*1000
  );
  const rawDays=1+missing/20;
  const speed=Math.max(0.58,1.12-level*0.055);
  const days=Math.max(1,Math.round(rawDays*speed));
  return {
    kind:"restore_part_unit",
    slot,
    unit_id:str(unit.id),
    design_id:str(unit.design_id),
    condition_before:current,
    cost,
    days,
  };
}

export function workshopJobs(gs){
  return Array.isArray(gs?.garage?.serviceJobs)?gs.garage.serviceJobs:[];
}

export function activeWorkshopJobs(gs){
  return workshopJobs(gs).filter((job)=>job?.status==="active");
}

export function activeWorkshopJobFor(gs,{carId=null,slot=null,unitId=null,kind=null}={}){
  return activeWorkshopJobs(gs).find((job)=>{
    if(kind&&str(job?.kind)!==str(kind))return false;
    if(carId&&str(job?.car_id)!==str(carId))return false;
    if(slot&&str(job?.slot)!==str(slot))return false;
    if(unitId&&str(job?.unit_id)!==str(unitId))return false;
    return true;
  })||null;
}

export function unitIsInWorkshop(gs,unitId){
  return Boolean(activeWorkshopJobFor(gs,{unitId}));
}

export function queueWorkshopJob(gs,quote,{
  id=null,
  title=null,
  startedAt=null,
}={}){
  if(!quote||!quote.kind)return gs;
  const start=String(startedAt||gs?.currentDateISO||"").slice(0,10);
  if(!start)return gs;

  if(quote.unit_id){
    const location=physicalUnitLocation(gs,quote.unit_id);
    if(location.kind!=="warehouse")return gs;
    if(activeWorkshopJobFor(gs,{unitId:quote.unit_id}))return gs;
  }
  if(quote.car_id&&quote.slot){
    if(activeWorkshopJobFor(gs,{carId:quote.car_id,slot:quote.slot}))return gs;
  }

  const job={
    id:id||`workshop_${Date.now()}`,
    kind:quote.kind,
    title:title||quote.kind.replaceAll("_"," "),
    slot:quote.slot||null,
    car_id:quote.car_id||null,
    unit_id:quote.unit_id||null,
    design_id:quote.design_id||null,
    condition_before:quote.condition_before??null,
    cost:Number(quote.cost||0),
    started_at:start,
    finishes_at:addDaysISO(start,quote.days),
    duration_days:Number(quote.days||0),
    status:"active",
  };
  return {
    ...gs,
    garage:{
      ...(gs?.garage||{}),
      serviceJobs:[...workshopJobs(gs),job],
    },
  };
}

export function processWorkshopJobs(gs){
  if(!gs)return gs;
  const today=String(gs?.currentDateISO||"").slice(0,10);
  if(!today)return gs;
  const jobs=workshopJobs(gs);
  if(!jobs.some((job)=>job?.status==="active"&&job?.finishes_at&&job.finishes_at<=today))return gs;

  let next=normalizePhysicalPartState(gs);
  let cars=[...(next?.garage?.cars||[])];
  let stock={...(next?.garage?.baseComponentStock||{})};
  let units=[...(next?.development?.partUnits||[])];
  const serviceLog=[...(Array.isArray(next?.componentServiceLog)?next.componentServiceLog:[])];

  const nextJobs=jobs.map((job)=>{
    if(job?.status!=="active"||!job?.finishes_at||job.finishes_at>today)return job;

    if(job.kind==="build_standard_spare"){
      stock[job.slot]=Number(stock?.[job.slot]||0)+1;
    }else if(job.kind==="build_and_fit_standard"){
      cars=cars.map((car)=>str(car?.id)===str(job.car_id)
        ?{
          ...car,
          componentCondition:{
            ...(car?.componentCondition||{}),
            [job.slot]:100,
          },
        }
        :car
      );
    }else if(job.kind==="restore_standard"){
      cars=cars.map((car)=>str(car?.id)===str(job.car_id)
        ?{
          ...car,
          componentCondition:{
            ...(car?.componentCondition||{}),
            [job.slot]:100,
          },
        }
        :car
      );
    }else if(job.kind==="restore_part_unit"){
      units=units.map((unit)=>str(unit?.id)===str(job.unit_id)
        ?{
          ...unit,
          condition:100,
          last_service_date:today,
        }
        :unit
      );
    }

    serviceLog.unshift({
      date:today,
      job_id:job.id,
      action:job.kind,
      car_id:job.car_id||null,
      unit_id:job.unit_id||null,
      design_id:job.design_id||null,
      slot:job.slot||null,
      condition_before:job.condition_before??null,
      condition_after:["restore_standard","restore_part_unit","build_and_fit_standard"].includes(job.kind)?100:null,
      cost:Number(job.cost||0),
    });
    return {...job,status:"completed",completed_at:today};
  });

  next={
    ...next,
    garage:{
      ...(next?.garage||{}),
      cars,
      baseComponentStock:stock,
      serviceJobs:nextJobs,
    },
    development:{
      ...(next?.development||{}),
      partUnits:units,
    },
    componentServiceLog:serviceLog.slice(0,300),
  };
  return normalizePhysicalPartState(next);
}
