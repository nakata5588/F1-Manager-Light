// src/domain/garage.js
import { isRaceDriverContract, isReserveDriverContract } from "./contractRoles.js";
import { activeDriverContracts as canonicalActiveDriverContracts } from "./driverContracts.js";
import { COMPONENT_FALLBACK_CATALOG, availableCarComponentSlots } from "./carComponents.js";
import { partDesignIdOfUnit, partUnits } from "./partUnits.js";
import { combineTechnicalAdjustments, technicalAdjustmentForPart } from "./carPartPerformance.js";

const unwrap=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??null):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unwrap(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
export const driverIdOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
export const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor"],""));

export const CAR_COMPONENT_SLOTS=Object.freeze(COMPONENT_FALLBACK_CATALOG.map((row)=>row.part_type));

export function componentSlotsForTeam(gs,teamId=null){
  const tid=String(teamId??gs?.team?.team_id??gs?.team?.id??"");
  const slots=availableCarComponentSlots(gs,tid);
  return slots.length?slots:[...CAR_COMPONENT_SLOTS];
}

export function defaultComponentCondition(slots=CAR_COMPONENT_SLOTS){
  return Object.fromEntries((slots||CAR_COMPONENT_SLOTS).map((slot)=>[slot,100]));
}

export function defaultBaseComponentStock(slots=CAR_COMPONENT_SLOTS){
  return Object.fromEntries((slots||CAR_COMPONENT_SLOTS).map((slot)=>[slot,0]));
}

// Game-economy values are calibrated to public relative modern F1 cost anchors
// (chassis >> gearbox >> wings) rather than claiming exact historical invoices.
export const BASE_COMPONENT_BUILD_COST=Object.freeze({
  chassis:600000,
  aero_front:90000,
  aero_rear:110000,
  suspension:125000,
  gearbox:350000,
  brakes:70000,
  cooling:95000,
  turbocharger:200000,
  electronics:100000,
  kers:250000,
  ers_mgu_k:350000,
  ers_mgu_h:400000,
  battery_pack:280000,
  fuel_system:100000,
  exhaust_system:80000,
});

export function baseComponentConstructionCost(gs,slot){
  const base=Number(BASE_COMPONENT_BUILD_COST[slot]??80000);
  const levelRaw=Number(gs?.hq?.facilityLevels?.manufacturing_leve ?? gs?.hq?.facilityLevels?.manufacturing_level);
  let level=Number.isFinite(levelRaw)?levelRaw:null;
  if(level==null){
    const year=Number(gs?.activeYear);
    const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
    const rows=Array.isArray(gs?.facilities)&&gs.facilities.length?gs.facilities:(gs?.dbFacilities||[]);
    const row=rows.find((r)=>
      String(pick(r,["team_id","team"],""))===teamId &&
      (!Number.isFinite(Number(pick(r,["year","season_year"],year)))||Number(pick(r,["year","season_year"],year))===year)
    );
    level=Number(pick(row||{},["manufacturing_leve","manufacturing_level"],5));
  }
  const efficiency=Math.max(0.72,Math.min(1.15,1.12-(Number(level)||5)*0.025));
  return Math.round(base*efficiency/1000)*1000;
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
  const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const eligibleSlots=componentSlotsForTeam(gs,teamId);
  return {
    ...(garage||{}),
    baseComponentStock:{
      ...defaultBaseComponentStock(eligibleSlots),
      ...(garage?.baseComponentStock||{}),
    },
    cars:wanted.map((car)=>({
      ...car,
      ...(existing.get(car.id)||{}),
      id:car.id,
      label:car.label,
      kind:car.kind,
      driver_id:car.driver_id,
      installedParts:{...(existing.get(car.id)?.installedParts||{})},
      componentCondition:{
        ...defaultComponentCondition(eligibleSlots),
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
  electronics:{qualifying:0.10,race:0.16,reliability:0.42},
  kers:{qualifying:0.34,race:0.40,reliability:0.06},
  ers_mgu_k:{qualifying:0.42,race:0.48,reliability:0.08},
  ers_mgu_h:{qualifying:0.35,race:0.42,reliability:0.07},
  battery_pack:{qualifying:0.18,race:0.34,reliability:0.12},
  fuel_system:{qualifying:0.12,race:0.28,reliability:0.30},
  exhaust_system:{qualifying:0.24,race:0.28,reliability:0.10},
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
  electronics:5.5,
  kers:6.0,
  ers_mgu_k:6.5,
  ers_mgu_h:7.0,
  battery_pack:7.5,
  fuel_system:6.5,
  exhaust_system:3.5,
});

export function installedPartsForCar(gs,car){
  const designs=new Map((gs?.development?.parts||[]).map((part)=>[String(part.id),part]));
  const units=new Map(partUnits(gs).map((unit)=>[String(unit?.id??""),unit]));
  return Object.entries(car?.installedParts||{})
    .map(([slot,ref])=>{
      const id=String(ref??"");
      const unit=units.get(id)||null;
      const design=unit
        ?designs.get(partDesignIdOfUnit(unit))
        :designs.get(id);
      return {slot,part:design||null,unit};
    })
    .filter((x)=>x.part);
}

export function componentConditionForCar(gs,car,slot){
  const installedId=car?.installedParts?.[slot];
  if(installedId){
    const unit=partUnits(gs).find((row)=>String(row?.id??"")===String(installedId));
    if(unit)return Math.max(0,Math.min(100,Number(unit?.condition??100)));
    // Legacy save fallback until schema migration is persisted.
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
  for(const slot of componentSlotsForTeam(gs)){
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
  const eligible=new Set(componentSlotsForTeam(gs));
  const rows=[];
  let wearReliabilityPenalty=0;
  for(const {slot,part,unit} of installedPartsForCar(gs,car)){
    if(!eligible.has(slot))continue;
    const conditionPct=Math.max(0,Math.min(100,Number(unit?.condition??part?.condition??100)));
    rows.push(technicalAdjustmentForPart(gs,{slot,part,condition:conditionPct}));

    const condition=conditionPct/100;
    const conditionLoss=Math.max(0,0.80-condition)/0.80;
    const reliabilityRisk=Number(PART_CONDITION_RELIABILITY_RISK[slot]??3);
    wearReliabilityPenalty+=conditionLoss*reliabilityRisk;
  }
  const combined=combineTechnicalAdjustments(rows);
  return {
    qualifying:combined.qualifying,
    race:combined.race,
    reliability:combined.reliability-wearReliabilityPenalty,
    technical:combined.technical,
  };
}

export function garageCarForDriver(gs,driverId){
  const did=String(driverId??"");
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const liveEntry=(gs?.raceEntryState?.entries||[]).find((entry)=>
    String(entry?.driver_id??"")===did &&
    String(entry?.team_id??"")===userTeamId &&
    Number(entry?.car_slot)>=1 &&
    Number(entry?.car_slot)<=2
  );
  if(liveEntry){
    const raceCar=(gs?.garage?.cars||[]).find((car)=>String(car?.id)===`car_${Number(liveEntry.car_slot)}`);
    if(raceCar)return raceCar;
  }
  return (gs?.garage?.cars||[]).find((car)=>String(car?.driver_id??"")===did)||null;
}
