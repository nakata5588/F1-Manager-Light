// src/domain/technicalResearch.js
// Stage 6.2 — Technical research focus and project support.
//
// Research focus controls how the technical department distributes passive
// engineering knowledge. Research Points do not improve the car by themselves;
// they can be committed to a design brief to reduce uncertainty/time and give
// a modest expected-performance benefit.

import { carComponentDefinition } from "./carComponents.js";

const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const str=(v)=>String(v??"");
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const round=(v,d=2)=>Number(Number(v||0).toFixed(d));

export const TECHNICAL_RESEARCH_AREAS=Object.freeze([
  {
    id:"aero",
    label:"Aerodynamics",
    description:"Wings, sidepods and underfloor knowledge. Supports aerodynamic design projects.",
  },
  {
    id:"chassis",
    label:"Chassis Dynamics",
    description:"Chassis, suspension and braking knowledge. Supports mechanical-grip and mass-reduction work.",
  },
  {
    id:"reliability",
    label:"Reliability Engineering",
    description:"Failure analysis, materials and operating margin. Best used on Reliability design briefs.",
  },
  {
    id:"powertrain",
    label:"Powertrain Integration",
    description:"Gearbox, cooling, fuel, exhaust and power-unit integration knowledge.",
  },
]);

export function defaultTechnicalResearch(){
  return TECHNICAL_RESEARCH_AREAS.map((area)=>({
    ...area,
    focus:25,
    points:0,
  }));
}

export function normalizeTechnicalResearch(rows){
  const source=Array.isArray(rows)?rows:[];
  const byId=new Map(source.map((row)=>[str(row?.id),row]));
  let normalized=TECHNICAL_RESEARCH_AREAS.map((area)=>({
    ...area,
    ...(byId.get(area.id)||{}),
    id:area.id,
    area:area.label,
    label:area.label,
    description:area.description,
    focus:clamp(num(byId.get(area.id)?.focus,25),0,100),
    points:Math.max(0,num(byId.get(area.id)?.points,0)),
  }));
  const total=normalized.reduce((sum,row)=>sum+row.focus,0);
  if(Math.abs(total-100)>0.001){
    if(total<=0){
      normalized=normalized.map((row)=>({...row,focus:25}));
    }else{
      let used=0;
      normalized=normalized.map((row,index)=>{
        if(index===normalized.length-1)return {...row,focus:round(100-used,1)};
        const focus=round(row.focus/total*100,1);
        used+=focus;
        return {...row,focus};
      });
    }
  }
  return normalized;
}

export function setTechnicalResearchFocus(rows,areaId,nextFocus){
  const normalized=normalizeTechnicalResearch(rows);
  const key=str(areaId);
  const target=normalized.find((row)=>row.id===key);
  if(!target)return normalized;
  const value=clamp(num(nextFocus,target.focus),0,100);
  const others=normalized.filter((row)=>row.id!==key);
  const remainder=Math.max(0,100-value);
  const otherTotal=others.reduce((sum,row)=>sum+row.focus,0);
  let used=0;
  const next=normalized.map((row)=>{
    if(row.id===key)return {...row,focus:round(value,1)};
    const index=others.findIndex((item)=>item.id===row.id);
    const focus=index===others.length-1
      ?round(remainder-used,1)
      :round(otherTotal>0?(row.focus/otherTotal)*remainder:remainder/Math.max(1,others.length),1);
    used+=focus;
    return {...row,focus};
  });
  return normalizeTechnicalResearch(next);
}

function yearOf(gs){
  return Number(gs?.activeYear)||Number(str(gs?.currentDateISO).slice(0,4))||1980;
}

function facilityRow(gs){
  const teamId=str(gs?.team?.team_id??gs?.team?.id);
  const year=yearOf(gs);
  const rows=Array.isArray(gs?.facilities)&&gs.facilities.length?gs.facilities:(gs?.dbFacilities||[]);
  return rows.find((row)=>
    str(row?.team_id??row?.team)===teamId &&
    (!Number.isFinite(Number(row?.year))||Number(row?.year)===year)
  )||{};
}

function level(gs,key,fallback=5){
  const direct=Number(gs?.hq?.facilityLevels?.[key]);
  if(Number.isFinite(direct))return clamp(direct,0,10);
  const row=facilityRow(gs);
  const historical=Number(row?.[key]);
  return Number.isFinite(historical)?clamp(historical,0,10):fallback;
}

export function technicalResearchDailyOutput(gs){
  const aero=level(gs,"aero_dept_level",5);
  const wind=level(gs,"wind_tunnel_level",5);
  const chassis=level(gs,"_chassis_shop_level",5);
  const manufacturing=level(gs,"manufacturing_leve",5);
  const average=(aero+wind+chassis+manufacturing)/4;
  const total=round(0.28+average*0.035,3);
  return {
    total_points_per_day:total,
    facility_average:round(average,2),
  };
}

export function advanceTechnicalResearch(gs,dateISO){
  if(!gs||!dateISO)return gs;
  const dev=gs?.development||{};
  if(str(dev?.lastResearchDate)===str(dateISO))return gs;
  const rows=normalizeTechnicalResearch(dev?.research);
  const output=technicalResearchDailyOutput(gs);
  const research=rows.map((row)=>({
    ...row,
    points:round(row.points+output.total_points_per_day*(row.focus/100),3),
  }));
  return {
    ...gs,
    development:{
      ...dev,
      research,
      lastResearchDate:str(dateISO),
    },
  };
}

export function technicalResearchAreaForProject(gs,slot,objectiveId="balanced"){
  if(str(objectiveId)==="reliability")return "reliability";
  const key=str(slot);
  if(["chassis","suspension","brakes"].includes(key))return "chassis";
  if(["gearbox","cooling","turbocharger","electronics","kers","ers_mgu_k","ers_mgu_h","battery_pack","fuel_system","exhaust_system"].includes(key))return "powertrain";
  const area=str(carComponentDefinition(gs,key)?.impact_area);
  if(area==="aero")return "aero";
  if(area==="powertrain"||area==="hybrid"||area==="cooling")return "powertrain";
  if(area==="reliability")return "reliability";
  return "chassis";
}

export function technicalResearchArea(rows,areaId){
  return normalizeTechnicalResearch(rows).find((row)=>row.id===str(areaId))||null;
}

export function technicalResearchSupport(rows,areaId,requestedPoints=0){
  const area=technicalResearchArea(rows,areaId);
  const available=Math.max(0,num(area?.points,0));
  const used=Math.min(15,available,Math.max(0,num(requestedPoints,0)));
  return {
    area_id:str(areaId),
    area_label:area?.label||str(areaId),
    available_points:round(available,2),
    points_used:round(used,2),
    duration_multiplier:round(1-Math.min(0.15,used*0.01),4),
    risk_reduction:round(Math.min(0.06,used*0.004),4),
    performance_multiplier:round(1+Math.min(0.06,used*0.004),4),
  };
}

export function consumeTechnicalResearch(rows,areaId,points){
  const normalized=normalizeTechnicalResearch(rows);
  const used=Math.max(0,num(points,0));
  return normalized.map((row)=>
    row.id===str(areaId)
      ?{...row,points:round(Math.max(0,row.points-used),3)}
      :row
  );
}
