// src/engine/AITechnicalEngine.js
// Stage 5A: deterministic AI technical lifecycle foundation.
// AI teams use the same component eligibility, physical-unit and manufacturing
// primitives as the player. Historical data seeds the world; aiTechnicalWorld
// becomes the save-world source of truth afterwards.

import { availableCarComponentSlots, COMPONENT_STAT_KEY } from "../domain/carComponents.js";
import { derivePartTechnicalProfile } from "../domain/carPartPerformance.js";
import { partManufactureQuote } from "../domain/componentService.js";
import {
  createManufacturedPartUnits,
  fitPhysicalPartUnit,
  normalizePhysicalPartState,
  warehousePartUnitsForDesign,
} from "../domain/partUnits.js";
import { teamWorkRateMultiplier } from "../domain/teamMorale.js";
import { activeDriverContracts, driverIdOf } from "../domain/driverContracts.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const str=(v)=>String(v??"");
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};

function parseISO(value){
  const [y,m,d]=String(value||"").slice(0,10).split("-").map(Number);
  return new Date(Date.UTC(y||1970,(m||1)-1,d||1));
}
function addDaysISO(value,days){
  const d=parseISO(value);
  d.setUTCDate(d.getUTCDate()+Math.max(0,Math.floor(Number(days)||0)));
  return d.toISOString().slice(0,10);
}
function safeId(value){return str(value).replace(/[^a-zA-Z0-9_-]+/g,"_");}
function yearOf(gs){return Number(gs?.activeYear)||Number(str(gs?.currentDateISO).slice(0,4))||1980;}
function teamIdOf(row){return str(row?.team_id??row?.team??row?.constructor_id??row?.constructor);}
function rowForTeam(rows,teamId,year){
  const list=Array.isArray(rows)?rows:[];
  return list.find((row)=>teamIdOf(row)===str(teamId)&&Number(row?.year??row?.season_year)===Number(year))
    ||list.find((row)=>teamIdOf(row)===str(teamId))
    ||null;
}
function stableHash(text){
  let h=2166136261;
  for(const ch of str(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return h>>>0;
}
function teamRows(gs){
  const rows=Array.isArray(gs?.teams)&&gs.teams.length?gs.teams:(gs?.dbTeams||[]);
  const year=yearOf(gs);
  const activeIds=new Set();

  for(const row of gs?.carStats||gs?.dbCarStats||[]){
    const rowYear=Number(row?.year??row?.season_year);
    if(Number.isFinite(rowYear)&&rowYear!==year)continue;
    const id=teamIdOf(row);
    if(id)activeIds.add(id);
  }
  for(const row of gs?.teamEngines||gs?.dbTeamEngines||[]){
    const rowYear=Number(row?.year??row?.season_year);
    if(Number.isFinite(rowYear)&&rowYear!==year)continue;
    const id=teamIdOf(row);
    if(id)activeIds.add(id);
  }
  for(const contract of activeDriverContracts(gs)){
    const id=teamIdOf(contract);
    if(id)activeIds.add(id);
  }

  if(activeIds.size){
    const byId=new Map(rows.map((row)=>[teamIdOf(row),row]).filter(([id])=>id));
    return [...activeIds].sort().map((id)=>byId.get(id)||{team_id:id});
  }

  const seen=new Map();
  for(const row of rows){
    const id=teamIdOf(row);
    if(!id)continue;
    const from=num(row?.year_from??row?.start_year??row?.founded_year,year);
    const toRaw=row?.year_to??row?.end_year??row?.last_year;
    const to=toRaw==null||toRaw===""?Infinity:num(toRaw,Infinity);
    if(year<from||year>to)continue;
    if(!seen.has(id))seen.set(id,row);
  }
  return [...seen.values()];
}
function facilityRow(gs,teamId){
  const year=yearOf(gs);
  return rowForTeam(gs?.facilities||gs?.dbFacilities||[],teamId,year)||{};
}
function facilityLevel(row,...keys){
  for(const key of keys){
    const value=Number(row?.[key]);
    if(Number.isFinite(value))return clamp(value,1,10);
  }
  return 5;
}
function engineeringStrength(gs,teamId){
  const f=facilityRow(gs,teamId);
  const aero=facilityLevel(f,"aero_dept_level","aero_level");
  const wind=facilityLevel(f,"wind_tunnel_level");
  const mfg=facilityLevel(f,"manufacturing_level","manufacturing_leve");
  const chassis=facilityLevel(f,"_chassis_shop_level","chassis_shop_level");
  return Number(((aero+wind+mfg+chassis)/4).toFixed(2));
}
function historicalBudgetSeed(gs,teamId){
  const year=yearOf(gs);
  const rows=gs?.financeLedger||gs?.dbFinanceLedger||[];
  const row=rowForTeam(rows,teamId,year)||{};
  for(const key of ["balance","budget","cash","opening_balance","season_budget"]){
    const value=Number(row?.[key]);
    if(Number.isFinite(value)&&value>0)return value;
  }
  // Fallback is a deterministic gameplay reserve derived from existing facilities,
  // not a recurring AI cash injection.
  return Math.round((1_250_000+engineeringStrength(gs,teamId)*350_000)/10_000)*10_000;
}
function initialCars(teamId){
  return [1,2].map((slot)=>({
    id:`ai_${safeId(teamId)}_car_${slot}`,
    label:`Car ${slot}`,
    kind:"race",
    ai_team_id:str(teamId),
    installedParts:{},
    componentCondition:{},
  }));
}
function scopedState(gs,teamId,state){
  return {
    ...gs,
    team:{team_id:str(teamId),budget:num(state?.budget,0)},
    finances:{...(gs?.finances||{}),balance:num(state?.budget,0)},
    garage:state?.garage||{cars:initialCars(teamId),serviceJobs:[],baseComponentStock:{}},
    development:state?.development||{projects:[],parts:[],partUnits:[],manufacturing:[],research:[]},
  };
}
function componentBaseline(gs,teamId,slot){
  const car=rowForTeam(gs?.carStats||gs?.dbCarStats||[],teamId,yearOf(gs))||{};
  const key=COMPONENT_STAT_KEY[slot];
  if(key){
    const value=Number(car?.[key]);
    if(Number.isFinite(value))return clamp(value);
  }
  const fallback={
    chassis:"chassis_spec",aero_front:"aero_spec",aero_rear:"aero_spec",
    sidepods:"aero_spec",underfloor:"aero_spec",suspension:"suspension_spec",
    gearbox:"gearbox_spec",brakes:"brakes_spec",cooling:"cooling_spec",
  }[slot];
  return fallback?clamp(num(car?.[fallback],70)):70;
}
function completedDesignCount(state,slot){
  return (state?.development?.parts||[]).filter((part)=>str(part?.slot)===str(slot)).length;
}
function chooseNeed(gs,teamId,state){
  const slots=availableCarComponentSlots(gs,teamId);
  if(!slots.length)return null;
  const scored=slots.map((slot)=>{
    const baseline=componentBaseline(gs,teamId,slot);
    const prior=completedDesignCount(state,slot);
    const tie=(stableHash(`${teamId}|${yearOf(gs)}|${slot}`)%1000)/1_000_000;
    return {slot,baseline,score:baseline+prior*5+tie};
  }).sort((a,b)=>a.score-b.score||a.slot.localeCompare(b.slot));
  return scored[0]||null;
}
function projectQuote(gs,teamId,state,need){
  const strength=engineeringStrength(gs,teamId);
  const moraleTime=teamWorkRateMultiplier(gs,teamId);
  const prior=completedDesignCount(state,need.slot);
  const baseDays=34-prior*2;
  const days=Math.max(10,Math.round(baseDays*Math.max(0.72,1.16-strength*0.045)*moraleTime));
  const cost=Math.round((145_000+strength*42_000+prior*55_000)/10_000)*10_000;
  const perf=Number((0.45+strength*0.085+Math.max(0,78-need.baseline)*0.018).toFixed(2));
  return {days,cost,perf,strength};
}
function activeProjects(state){return (state?.development?.projects||[]).filter((p)=>p?.status==="active");}
function activeManufacturing(state){return (state?.development?.manufacturing||[]).filter((p)=>p?.status==="active");}

export function normalizeAITechnicalWorld(gs){
  if(!gs)return gs;
  const player=str(gs?.team?.team_id??gs?.team?.id);
  const existing=gs?.aiTechnicalWorld?.teams||{};
  const teams={...existing};
  for(const row of teamRows(gs)){
    const teamId=teamIdOf(row);
    if(!teamId||teamId===player)continue;
    if(teams[teamId])continue;
    teams[teamId]={
      team_id:teamId,
      budget:historicalBudgetSeed(gs,teamId),
      garage:{cars:initialCars(teamId),serviceJobs:[],baseComponentStock:{}},
      development:{projects:[],parts:[],partUnits:[],manufacturing:[],research:[]},
      planning:{last_date:null,last_need:null,cycle:0},
      finance_log:[],
    };
  }
  return {...gs,aiTechnicalWorld:{...(gs?.aiTechnicalWorld||{}),version:1,teams}};
}

export function aiTechnicalTeamState(gs,teamId){
  return gs?.aiTechnicalWorld?.teams?.[str(teamId)]||null;
}

export function aiTechnicalScopedState(gs,teamId){
  const normalized=normalizeAITechnicalWorld(gs);
  const state=aiTechnicalTeamState(normalized,teamId);
  return state?normalizePhysicalPartState(scopedState(normalized,teamId,state)):null;
}

export function aiTechnicalRaceCars(gs,teamId){
  const state=aiTechnicalTeamState(gs,teamId);
  return (state?.garage?.cars||[]).filter((car)=>car?.kind==="race");
}

export function aiTechnicalCarForDriver(gs,teamId,driverId=null){
  const cars=aiTechnicalRaceCars(gs,teamId);
  if(!cars.length)return null;
  if(driverId==null||driverId==="")return null;
  const did=str(driverId);
  const liveEntry=(gs?.raceEntryState?.entries||[]).find((entry)=>
    str(entry?.team_id)===str(teamId) &&
    str(entry?.driver_id)===did &&
    Number(entry?.car_slot)>=1 &&
    Number(entry?.car_slot)<=2
  );
  if(liveEntry)return cars[Number(liveEntry.car_slot)-1]||null;

  const raceContracts=activeDriverContracts(gs,{teamId,raceOnly:true});
  const index=raceContracts.findIndex((contract)=>driverIdOf(contract)===did);
  return index>=0?(cars[index]||null):null;
}

function replaceTeamState(gs,teamId,nextState){
  return {
    ...gs,
    aiTechnicalWorld:{
      ...(gs?.aiTechnicalWorld||{}),
      version:1,
      teams:{...(gs?.aiTechnicalWorld?.teams||{}),[str(teamId)]:nextState},
    },
  };
}

export function planAITechnicalProject(gs,teamId){
  let next=normalizeAITechnicalWorld(gs);
  const state=aiTechnicalTeamState(next,teamId);
  if(!state)return next;
  if(activeProjects(state).length||activeManufacturing(state).length)return next;
  const today=str(next?.currentDateISO).slice(0,10);
  if(!today)return next;

  const need=chooseNeed(next,teamId,state);
  if(!need)return next;
  const quote=projectQuote(next,teamId,state,need);
  if(num(state?.budget,0)<quote.cost)return next;

  const cycle=num(state?.planning?.cycle,0)+1;
  const id=`ai_dev_${safeId(teamId)}_${yearOf(next)}_${String(cycle).padStart(3,"0")}`;
  const project={
    id,
    team_id:str(teamId),
    name:`AI ${need.slot.replaceAll("_"," ")} package ${cycle}`,
    type:need.slot,
    phase:"design",
    status:"active",
    started_at:today,
    finishes_at:addDaysISO(today,quote.days),
    duration_days:quote.days,
    cost:quote.cost,
    perf_delta:quote.perf,
    engineering_strength:quote.strength,
    need_baseline:need.baseline,
  };
  const nextState={
    ...state,
    budget:num(state.budget,0)-quote.cost,
    development:{...(state.development||{}),projects:[...(state.development?.projects||[]),project]},
    planning:{...(state.planning||{}),last_date:today,last_need:need.slot,cycle},
    finance_log:[...(state.finance_log||[]),{id:`ai_tx_${id}`,dateISO:today,type:"expense",category:"Development",amount:-quote.cost,desc:project.name}],
  };
  return replaceTeamState(next,teamId,nextState);
}

function completeDesigns(gs,teamId,state,today){
  let changed=false;
  const scoped=scopedState(gs,teamId,state);
  let parts=[...(state?.development?.parts||[])];
  const projects=(state?.development?.projects||[]).map((project)=>{
    if(project?.status!=="active"||!project?.finishes_at||project.finishes_at>today)return project;
    changed=true;
    const designId=`part_${project.id}`;
    if(!parts.some((part)=>str(part?.id)===designId)){
      const draft={
        id:designId,name:project.name,slot:project.type,
        version:`AI-${completedDesignCount(state,project.type)+1}`,
        perf:num(project.perf_delta,0),inv:0,in_manufacturing:0,
        prototype:true,created_from:project.id,ai_team_id:str(teamId),
      };
      parts.push({...draft,technical_profile:derivePartTechnicalProfile(scoped,draft)});
    }
    return {...project,status:"completed",progress:1,completed_at:today};
  });
  return {changed,state:changed?{...state,development:{...(state.development||{}),projects,parts}}:state};
}

function queueManufacturing(gs,teamId,state,today){
  if(activeManufacturing(state).length)return state;
  const parts=state?.development?.parts||[];
  const candidate=parts.slice().reverse().find((part)=>{
    const units=(state?.development?.partUnits||[]).filter((u)=>str(u?.design_id)===str(part?.id));
    return units.length<2&&num(part?.in_manufacturing,0)<=0;
  });
  if(!candidate)return state;
  const scoped=normalizePhysicalPartState(scopedState(gs,teamId,state));
  const quote=partManufactureQuote(scoped,candidate);
  const qty=2;
  const cost=num(quote?.cost,0)*qty;
  if(num(state?.budget,0)<cost)return state;
  const batch=`ai_mfg_${safeId(teamId)}_${safeId(candidate.id)}`;
  const job={
    id:batch,part_id:candidate.id,title:`${candidate.name} batch`,qty,
    unit_cost:num(quote?.cost,0),started_at:today,
    finishes_at:addDaysISO(today,num(quote?.days,2)),duration_days:num(quote?.days,2),
    status:"active",team_id:str(teamId),
  };
  return {
    ...state,budget:num(state.budget,0)-cost,
    development:{
      ...(state.development||{}),
      parts:parts.map((p)=>str(p?.id)===str(candidate.id)?{...p,in_manufacturing:qty}:p),
      manufacturing:[...(state.development?.manufacturing||[]),job],
    },
    finance_log:[...(state.finance_log||[]),{id:`ai_tx_${batch}`,dateISO:today,type:"expense",category:"Manufacturing",amount:-cost,desc:job.title}],
  };
}

function completeManufacturing(gs,teamId,state,today){
  let scoped=normalizePhysicalPartState(scopedState(gs,teamId,state));
  let changed=false;
  let manufacturing=[...(state?.development?.manufacturing||[])];
  for(let i=0;i<manufacturing.length;i+=1){
    const job=manufacturing[i];
    if(job?.status!=="active"||!job?.finishes_at||job.finishes_at>today)continue;
    changed=true;
    scoped=createManufacturedPartUnits(scoped,{designId:job.part_id,qty:job.qty,batchId:job.id,manufacturedAt:today});
    manufacturing[i]={...job,status:"completed",completed_at:today};
    scoped={
      ...scoped,
      development:{
        ...(scoped.development||{}),
        parts:(scoped.development?.parts||[]).map((p)=>str(p?.id)===str(job.part_id)?{...p,in_manufacturing:0}:p),
        manufacturing,
      },
    };
  }
  if(!changed)return state;

  // Install one physical unit per race car. This deliberately happens in car order,
  // so save states can represent split specifications if only one unit is available.
  const latestCompleted=manufacturing.filter((j)=>j?.status==="completed").slice(-1)[0];
  if(latestCompleted){
    const design=(scoped?.development?.parts||[]).find((p)=>str(p?.id)===str(latestCompleted.part_id));
    if(design){
      for(const car of scoped?.garage?.cars||[]){
        if(car?.kind!=="race")continue;
        const unit=warehousePartUnitsForDesign(scoped,design.id)[0];
        if(!unit)break;
        scoped=fitPhysicalPartUnit(scoped,{carId:car.id,slot:design.slot,designId:design.id,unitId:unit.id});
      }
    }
  }
  const normalized=normalizePhysicalPartState(scoped);
  return {
    ...state,
    garage:normalized.garage,
    development:normalized.development,
  };
}

export function tickAITechnicalTeam(gs,teamId,{allowPlanning=true}={}){
  let next=normalizeAITechnicalWorld(gs);
  let state=aiTechnicalTeamState(next,teamId);
  if(!state)return next;
  const today=str(next?.currentDateISO).slice(0,10);
  if(!today)return next;

  const completed=completeDesigns(next,teamId,state,today);
  state=completed.state;
  state=completeManufacturing(next,teamId,state,today);
  state=queueManufacturing(next,teamId,state,today);
  next=replaceTeamState(next,teamId,state);

  if(allowPlanning&&!activeProjects(state).length&&!activeManufacturing(state).length){
    next=planAITechnicalProject(next,teamId);
  }
  return next;
}

export function tickAITechnicalWorld(gs,{allowPlanning=true}={}){
  let next=normalizeAITechnicalWorld(gs);
  const player=str(next?.team?.team_id??next?.team?.id);
  const ids=teamRows(next)
    .map(teamIdOf)
    .filter((teamId)=>teamId&&teamId!==player&&aiTechnicalTeamState(next,teamId))
    .sort();
  for(const teamId of ids)next=tickAITechnicalTeam(next,teamId,{allowPlanning});
  return next;
}
