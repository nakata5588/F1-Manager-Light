// src/domain/garage.js
import { isRaceDriverContract, isReserveDriverContract } from "./contractRoles.js";
import { activeDriverContracts as canonicalActiveDriverContracts } from "./driverContracts.js";

const unwrap=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??null):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unwrap(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
export const driverIdOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
export const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor"],""));

export const CAR_COMPONENT_SLOTS=Object.freeze([
  "chassis","aero_front","aero_rear","suspension","gearbox","brakes","cooling","turbocharger",
]);

export function defaultComponentCondition(){
  return Object.fromEntries(CAR_COMPONENT_SLOTS.map((slot)=>[slot,100]));
}

export function activeDriverContracts(gs,teamId){
  return canonicalActiveDriverContracts(gs,{teamId});
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
      componentCondition:{
        ...defaultComponentCondition(),
        ...(existing.get(car.id)?.componentCondition||{}),
      },
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

export const PART_CONDITION_RELIABILITY_RISK=Object.freeze({
  chassis:3.0,
  aero_front:0.8,
  aero_rear:0.8,
  suspension:5.0,
  gearbox:7.0,
  brakes:4.0,
  cooling:8.0,
  turbocharger:6.0,
});

export function installedPartsForCar(gs,car){
  const byId=new Map((gs?.development?.parts||[]).map((part)=>[String(part.id),part]));
  return Object.entries(car?.installedParts||{})
    .map(([slot,id])=>({slot,part:byId.get(String(id))}))
    .filter((x)=>x.part);
}

export function componentConditionForCar(gs,car,slot){
  const installedId=car?.installedParts?.[slot];
  if(installedId){
    const part=(gs?.development?.parts||[]).find((row)=>String(row?.id??"")===String(installedId));
    if(part)return Math.max(0,Math.min(100,Number(part?.condition??100)));
  }
  return Math.max(0,Math.min(100,Number(car?.componentCondition?.[slot]??100)));
}

export function componentConditionStatus(value){
  const condition=Math.max(0,Math.min(100,Number(value)||0));
  if(condition>=80)return {key:"healthy",label:"Healthy"};
  if(condition>=60)return {key:"worn",label:"Worn"};
  if(condition>=40)return {key:"degraded",label:"Degraded"};
  if(condition>=20)return {key:"critical",label:"Critical"};
  return {key:"failing",label:"Failing"};
}

export function baseConditionAdjustmentForCar(gs,car){
  let qualifying=0,race=0,reliability=0;
  for(const slot of CAR_COMPONENT_SLOTS){
    if(car?.installedParts?.[slot])continue;
    const condition=componentConditionForCar(gs,car,slot);
    const loss=Math.max(0,85-condition);
    if(loss<=0)continue;
    const profile=PART_SLOT_EFFECTS[slot]||{qualifying:0.45,race:0.45,reliability:0.04};
    const severity=loss/85;
    qualifying-=severity*(1.4+profile.qualifying*2.2);
    race-=severity*(1.6+profile.race*2.4);
    const reliabilityRisk=Number(PART_CONDITION_RELIABILITY_RISK[slot]??3);
    reliability-=severity*reliabilityRisk*1.35;
    if(condition<35){
      const critical=(35-condition)/35;
      race-=critical*1.5;
      reliability-=critical*reliabilityRisk*0.75;
    }
  }
  return {qualifying,race,reliability};
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
    const conditionLoss=Math.max(0,0.80-condition)/0.80;
    const reliabilityRisk=Number(PART_CONDITION_RELIABILITY_RISK[slot]??3);
    reliability-=conditionLoss*reliabilityRisk;
  }
  return {qualifying,race,reliability};
}

export function garageCarForDriver(gs,driverId){
  return (gs?.garage?.cars||[]).find((car)=>String(car?.driver_id??"")===String(driverId??""))||null;
}
