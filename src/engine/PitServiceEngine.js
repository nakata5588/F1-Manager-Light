// src/engine/PitServiceEngine.js
// RW5.3B.2B — normal pit service scheduler.
//
// This module owns what can be serviced during an ordinary pit stop and how
// concurrent tasks share stationary time. RaceStrategyEngine remains the owner
// of the final stop timing; CarDamageEngine remains the owner of damage physics.

import { CAR_DAMAGE_COMPONENTS, damageStateFromComponents, repairDamageState } from "./CarDamageEngine.js";

const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min=0,max=Infinity)=>Math.max(min,Math.min(max,num(value,min)));

export const NORMAL_PIT_REPAIR_EFFECTIVENESS=Object.freeze({
  front_wing:1.00,
  rear_wing:0.65,
  floor:0.40,
  suspension:0.45,
  brakes:0.45,
  cooling:0.50,
});

const COMPONENT_SERVICE_PROFILE=Object.freeze({
  front_wing:{base_s:6.0,damage_s:0.055,work_group:"front",start_mode:"overlap"},
  rear_wing:{base_s:16.0,damage_s:0.090,work_group:"rear",start_mode:"partial"},
  floor:{base_s:25.0,damage_s:0.120,work_group:"deep",start_mode:"partial"},
  suspension:{base_s:22.0,damage_s:0.115,work_group:"deep",start_mode:"partial"},
  brakes:{base_s:18.0,damage_s:0.095,work_group:"deep",start_mode:"partial"},
  cooling:{base_s:17.0,damage_s:0.090,work_group:"deep",start_mode:"partial"},
});

function eraServiceFactor(year){
  const y=Number(year)||1980;
  if(y<=1985)return 1.08;
  if(y<=1995)return 1.03;
  if(y<=2008)return 0.98;
  return 0.94;
}

function requestedSet(requestedComponents=[]){
  return new Set((requestedComponents||[]).map(String).filter((component)=>CAR_DAMAGE_COMPONENTS.includes(component)));
}

export function normalPitRepairComponents(damageState,requestedComponents=[]){
  const requested=requestedSet(requestedComponents);
  if(!requested.size)return [];
  return (damageState?.damaged_components||[])
    .map(String)
    .filter((component)=>requested.has(component)&&CAR_DAMAGE_COMPONENTS.includes(component));
}

function repairEffectivenessFor(components=[]){
  const selected=new Set(components.map(String));
  return Object.fromEntries(CAR_DAMAGE_COMPONENTS.map((component)=>[
    component,
    selected.has(component)?Number(NORMAL_PIT_REPAIR_EFFECTIVENESS[component]||0):0,
  ]));
}

function repairDurationS(component,damagePct,{year=1980,crewFactor=1}={}){
  const profile=COMPONENT_SERVICE_PROFILE[component];
  if(!profile)return 0;
  const era=eraServiceFactor(year);
  const crew=clamp(crewFactor,0.82,1.20);
  return Math.max(1,(profile.base_s+clamp(damagePct,0,100)*profile.damage_s)*era*crew);
}

function scheduleRepairTasks(components,damageState,{year=1980,crewFactor=1,primaryServiceS=0}={}){
  const tasks=[];
  let deepCursor=Math.max(1.5,primaryServiceS*0.38);
  for(const component of components){
    const profile=COMPONENT_SERVICE_PROFILE[component];
    if(!profile)continue;
    const damagePct=Number(damageState?.components?.[component]?.damage_pct||0);
    const duration=repairDurationS(component,damagePct,{year,crewFactor});
    let start=0;
    if(profile.work_group==="front"){
      start=Math.min(0.8,primaryServiceS*0.15);
    }else if(profile.work_group==="rear"){
      start=Math.max(1.0,primaryServiceS*0.30);
    }else{
      start=deepCursor;
      deepCursor+=duration;
    }
    tasks.push({
      id:`repair_${component}`,
      type:"repair",
      component,
      work_group:profile.work_group,
      start_s:Number(start.toFixed(2)),
      duration_s:Number(duration.toFixed(2)),
      end_s:Number((start+duration).toFixed(2)),
      damage_before_pct:Number(damagePct.toFixed(1)),
    });
  }
  return tasks;
}

export function buildPitServiceSchedule({
  year=1980,
  tyreChange=true,
  tyreServiceS=6.8,
  refuel=false,
  fuelServiceS=0,
  damageState=null,
  repairComponents=[],
  crewFactor=1,
}={}){
  const current=damageState||damageStateFromComponents({},{source:"none"});
  const selected=normalPitRepairComponents(current,repairComponents);
  const effectiveness=repairEffectivenessFor(selected);
  const repaired=selected.length
    ?repairDamageState(current,{effectiveness,source:"normal_pit_repair"})
    :current;

  const tasks=[];
  const tyreTime=tyreChange?Math.max(2,num(tyreServiceS,6.8)):0;
  const fuelTime=refuel?Math.max(0,num(fuelServiceS,0)):0;
  if(tyreChange){
    tasks.push({
      id:"tyres",
      type:"tyres",
      start_s:0,
      duration_s:Number(tyreTime.toFixed(2)),
      end_s:Number(tyreTime.toFixed(2)),
    });
  }
  if(refuel&&fuelTime>0){
    tasks.push({
      id:"refuel",
      type:"refuel",
      start_s:0,
      duration_s:Number(fuelTime.toFixed(2)),
      end_s:Number(fuelTime.toFixed(2)),
    });
  }

  const primaryService=Math.max(tyreTime,fuelTime,0);
  tasks.push(...scheduleRepairTasks(selected,current,{
    year,
    crewFactor,
    primaryServiceS:primaryService,
  }));

  const total=tasks.length?Math.max(...tasks.map((task)=>Number(task.end_s)||0)):0;
  const repairTasks=tasks.filter((task)=>task.type==="repair");
  const repairEnd=repairTasks.length?Math.max(...repairTasks.map((task)=>Number(task.end_s)||0)):0;
  const repairStart=repairTasks.length?Math.min(...repairTasks.map((task)=>Number(task.start_s)||0)):0;
  const repairDuration=Math.max(0,repairEnd-repairStart);
  const repairedComponents=selected.filter((component)=>
    Number(repaired?.components?.[component]?.damage_pct||0)<
    Number(current?.components?.[component]?.damage_pct||0)
  );

  return {
    model:"rw5.3b.2b",
    total_stationary_s:Number(total.toFixed(2)),
    tyre_change:Boolean(tyreChange),
    refuel:Boolean(refuel),
    tasks,
    repair:{
      requested_components:[...selected],
      repaired_components:repairedComponents,
      effectiveness,
      duration_s:Number(repairDuration.toFixed(2)),
      damage_before:structuredClone(current),
      damage_after:structuredClone(repaired),
      pace_loss_before_s_per_lap:Number(current?.pace_loss_s_per_lap||0),
      pace_loss_after_s_per_lap:Number(repaired?.pace_loss_s_per_lap||0),
    },
  };
}

export function normalPitRepairRecord({
  driverId,
  teamId,
  service,
  lap,
  sector=3,
  stopKey=null,
  source="normal_pit_repair",
}={}){
  const repair=service?.repair;
  const repairedComponents=Array.isArray(repair?.repaired_components)?repair.repaired_components:[];
  if(!driverId||!repairedComponents.length)return null;
  const l=Math.max(1,Number(lap)||1);
  const s=Math.max(1,Math.min(3,Number(sector)||3));
  return {
    type:"damage_repair",
    source,
    work_source:"pit_stop",
    driver_id:String(driverId),
    team_id:String(teamId||""),
    lap:l,
    sector:s,
    repair_ordinal:(l-1)*3+s,
    pit_stop_key:stopKey?String(stopKey):null,
    repaired_components:[...repairedComponents],
    effectiveness:{...(repair?.effectiveness||{})},
    damage_before:structuredClone(repair?.damage_before||null),
    damage_after:structuredClone(repair?.damage_after||null),
    pace_loss_before_s_per_lap:Number(repair?.pace_loss_before_s_per_lap||0),
    pace_loss_after_s_per_lap:Number(repair?.pace_loss_after_s_per_lap||0),
    repair_duration_s:Number(repair?.duration_s||0),
    free_service:false,
  };
}
