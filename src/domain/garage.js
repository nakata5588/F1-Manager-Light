// src/domain/garage.js
import { isDriverContract, isRaceDriverContract, isReserveDriverContract } from "./contractRoles.js";

const unwrap=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??null):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unwrap(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
export const driverIdOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
export const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor"],""));

export function activeDriverContracts(gs,teamId){
  const year=Number(gs?.activeYear);
  return (gs?.contracts||[]).filter((row)=>{
    const id=driverIdOf(row);
    if(!id||teamIdOf(row)!==String(teamId))return false;
    if(!isDriverContract(row))return false;
    const cy=Number(pick(row,["year","season_year"],year));
    return !Number.isFinite(cy)||!Number.isFinite(year)||cy===year;
  });
}

export function desiredGarageCars(gs){
  const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const contracts=activeDriverContracts(gs,teamId);
  const race=contracts.filter(isRaceDriverContract);
  const reserve=contracts.find(isReserveDriverContract);
  return [
    {id:"car_1",label:"Car 1",kind:"race",driver_id:driverIdOf(race[0]||{})||null},
    {id:"car_2",label:"Car 2",kind:"race",driver_id:driverIdOf(race[1]||{})||null},
    {id:"car_spare",label:"Reserve / Spare",kind:"reserve",driver_id:driverIdOf(reserve||{})||null},
  ];
}

export function syncGarageState(gs,garage){
  const wanted=desiredGarageCars(gs);
  const existing=new Map((garage?.cars||[]).map((car)=>[String(car.id),car]));
  return {
    ...(garage||{}),
    cars:wanted.map((car)=>({
      ...car,
      ...(existing.get(car.id)||{}),
      id:car.id,
      label:car.label,
      kind:car.kind,
      driver_id:car.driver_id,
      installedParts:{...(existing.get(car.id)?.installedParts||{})},
    })),
  };
}

export const PART_SLOT_EFFECTS=Object.freeze({
  chassis:{qualifying:0.60,race:0.70,reliability:0.08},
  aero_front:{qualifying:0.78,race:0.52,reliability:0.02},
  aero_rear:{qualifying:0.72,race:0.58,reliability:0.03},
  suspension:{qualifying:0.34,race:0.58,reliability:0.06},
  gearbox:{qualifying:0.42,race:0.55,reliability:0.10},
  brakes:{qualifying:0.20,race:0.48,reliability:0.08},
  cooling:{qualifying:0.08,race:0.22,reliability:0.65},
  turbocharger:{qualifying:0.62,race:0.50,reliability:0.04},
});

export function installedPartsForCar(gs,car){
  const byId=new Map((gs?.development?.parts||[]).map((part)=>[String(part.id),part]));
  return Object.entries(car?.installedParts||{})
    .map(([slot,id])=>({slot,part:byId.get(String(id))}))
    .filter((x)=>x.part);
}

export function installedAdjustmentForCar(gs,car){
  let qualifying=0,race=0,reliability=0;
  for(const {slot,part} of installedPartsForCar(gs,car)){
    const profile=PART_SLOT_EFFECTS[slot]||{qualifying:0.45,race:0.45,reliability:0.04};
    const perf=Math.max(0,Number(part?.perf||0));
    const condition=Math.max(0,Math.min(100,Number(part?.condition??100)))/100;
    qualifying+=perf*profile.qualifying*condition;
    race+=perf*profile.race*condition;
    reliability+=perf*profile.reliability*condition;
  }
  return {qualifying,race,reliability};
}

export function garageCarForDriver(gs,driverId){
  return (gs?.garage?.cars||[]).find((car)=>String(car?.driver_id??"")===String(driverId??""))||null;
}
