// src/domain/carAvailability.js
// Physical car availability for race entry.
// Driver availability and car availability are separate concerns: a fit driver
// cannot enter a GP if the assigned chassis is not raceworthy in time.

import {
  componentConditionForCar,
  componentSlotsForTeam,
} from "./garage.js";
import { activeWorkshopJobs } from "./componentService.js";

const str=(v)=>String(v??"");
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));

export const RACEWORTHY_COMPONENT_MIN=Object.freeze({
  chassis:55,
  underfloor:35,
  suspension:55,
  gearbox:35,
  brakes:40,
  cooling:30,
  turbocharger:28,
  electronics:25,
  kers:25,
  ers_mgu_k:25,
  ers_mgu_h:25,
  battery_pack:25,
  fuel_system:30,
});

const DEFAULT_RACEWORTHY_MIN=20;

export function technicalStateForTeam(gs,teamId){
  const tid=str(teamId);
  const player=str(gs?.team?.team_id??gs?.team?.id);
  if(tid&&tid===player){
    if(!gs?.garage)return null;
    return gs;
  }

  const ai=gs?.aiTechnicalWorld?.teams?.[tid]||null;
  if(!ai?.garage)return null;
  return {
    ...gs,
    team:{team_id:tid},
    // Never use the player's HQ override when evaluating an AI car.
    hq:{facilityLevels:{},upgrades:[]},
    garage:ai.garage,
    development:ai.development||{parts:[],partUnits:[]},
  };
}

export function raceCarsForTeam(gs,teamId){
  const scoped=technicalStateForTeam(gs,teamId);
  return (scoped?.garage?.cars||[])
    .filter((car)=>car?.kind==="race")
    .slice()
    .sort((a,b)=>str(a?.id).localeCompare(str(b?.id)));
}

export function reserveCarForTeam(gs,teamId){
  const scoped=technicalStateForTeam(gs,teamId);
  if(!scoped?.garage?.reserveCarBuilt)return null;
  return (scoped?.garage?.cars||[]).find((car)=>car?.kind==="reserve")||null;
}

export function carForRaceSlot(gs,teamId,slot){
  const cars=raceCarsForTeam(gs,teamId);
  return cars[Math.max(0,Number(slot||1)-1)]||null;
}

function dateOnly(value){
  const raw=str(value).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:"";
}

function projectedConditionForDate(scoped,car,slot,targetDate){
  const now=componentConditionForCar(scoped,car,slot);
  const target=dateOnly(targetDate);
  if(!target)return now;

  const finishing=activeWorkshopJobs(scoped).find((job)=>
    str(job?.car_id)===str(car?.id) &&
    str(job?.slot)===str(slot) &&
    ["restore_standard","build_and_fit_standard"].includes(str(job?.kind)) &&
    dateOnly(job?.finishes_at) &&
    dateOnly(job.finishes_at)<=target
  );
  return finishing?100:now;
}

export function carReadinessForDate(gs,teamId,car,targetDate=null){
  if(!car){
    // Legacy/synthetic states without a materialised technical garage keep the
    // old behaviour. Once a garage exists, missing cars are real unavailable cars.
    const scoped=technicalStateForTeam(gs,teamId);
    return scoped
      ?{available:false,status:"missing_car",reason:"No physical race car is available.",blocking_components:[]}
      :{available:true,status:"legacy_assumed_ready",reason:null,blocking_components:[]};
  }

  const scoped=technicalStateForTeam(gs,teamId);
  if(!scoped){
    return {available:true,status:"legacy_assumed_ready",reason:null,blocking_components:[]};
  }

  const target=dateOnly(targetDate);
  const blockingJobs=activeWorkshopJobs(scoped).filter((job)=>{
    if(str(job?.car_id)!==str(car.id))return false;
    const finish=dateOnly(job?.finishes_at);
    return !target||!finish||finish>target;
  });
  if(blockingJobs.length){
    const soonest=blockingJobs
      .map((job)=>dateOnly(job?.finishes_at))
      .filter(Boolean)
      .sort()[0]||null;
    return {
      available:false,
      status:"workshop",
      reason:soonest
        ?`${car.label||car.id} is still in the workshop until ${soonest}.`
        :`${car.label||car.id} is still in the workshop.`,
      blocking_components:blockingJobs.map((job)=>str(job?.slot)).filter(Boolean),
      ready_at:soonest,
    };
  }

  const slots=componentSlotsForTeam(scoped,teamId);
  const blocking=[];
  for(const slot of slots){
    const condition=clamp(projectedConditionForDate(scoped,car,slot,target));
    const minimum=Number(RACEWORTHY_COMPONENT_MIN[slot]??DEFAULT_RACEWORTHY_MIN);
    if(condition<minimum){
      blocking.push({slot,condition,minimum});
    }
  }

  if(blocking.length){
    const worst=blocking.slice().sort((a,b)=>a.condition-b.condition)[0];
    return {
      available:false,
      status:"not_raceworthy",
      reason:`${car.label||car.id} is not raceworthy: ${String(worst.slot).replaceAll("_"," ")} at ${worst.condition.toFixed(0)}%.`,
      blocking_components:blocking,
      ready_at:null,
    };
  }

  return {
    available:true,
    status:"ready",
    reason:null,
    blocking_components:[],
    ready_at:target||null,
  };
}

export function reserveCarReadinessForDate(gs,teamId,targetDate=null){
  const reserve=reserveCarForTeam(gs,teamId);
  if(!reserve){
    const scoped=technicalStateForTeam(gs,teamId);
    const building=activeWorkshopJobs(scoped||{}).find((job)=>job?.kind==="build_reserve_car");
    return {
      available:false,
      status:building?"reserve_building":"no_reserve_car",
      reason:building
        ?`Reserve Car is still being built until ${dateOnly(building?.finishes_at)||"a later date"}.`
        :"No Reserve Car has been built.",
      car:null,
      ready_at:building?dateOnly(building?.finishes_at):null,
    };
  }
  return {...carReadinessForDate(gs,teamId,reserve,targetDate),car:reserve};
}
