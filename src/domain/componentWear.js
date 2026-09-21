// src/domain/componentWear.js
import { garageCarForDriver, installedPartsForCar, syncGarageState } from "./garage.js";

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const driverIdOf=(row)=>String(row?.driver?.driver_id??row?.driver?.id??row?.driver_id??"");

export const BASE_COMPONENT_WEAR=Object.freeze({
  chassis:1.2,
  aero_front:1.8,
  aero_rear:1.5,
  suspension:2.0,
  gearbox:2.4,
  brakes:2.2,
  cooling:2.0,
  turbocharger:2.8,
});

const ACCIDENT_SLOT_MULTIPLIER=Object.freeze({
  chassis:0.55,
  aero_front:1.00,
  aero_rear:0.65,
  suspension:0.85,
  gearbox:0.25,
  brakes:0.55,
  cooling:0.35,
  turbocharger:0.20,
});

const SEVERITY_DAMAGE=Object.freeze({
  low:1.0,
  medium:4.0,
  high:9.0,
  critical:16.0,
});

function mechanicalAffectedSlots(reason){
  const value=String(reason||"").toLowerCase();
  if(/gearbox|transmission/.test(value))return new Set(["gearbox"]);
  if(/suspension/.test(value))return new Set(["suspension"]);
  if(/cooling/.test(value))return new Set(["cooling"]);
  if(/engine/.test(value))return new Set(["cooling","turbocharger"]);
  if(/electrical/.test(value))return new Set(["cooling"]);
  if(/fuel/.test(value))return new Set(["cooling"]);
  return new Set();
}

function severityOf(row){
  const explicit=String(row?.incident_severity||"").toLowerCase();
  if(SEVERITY_DAMAGE[explicit]!=null)return explicit;
  const score=Number(row?.incident_severity_score);
  if(Number.isFinite(score)){
    if(score>=0.96)return "critical";
    if(score>=0.82)return "high";
    if(score>=0.55)return "medium";
  }
  return "low";
}

export function componentWearForRaceRow(row,slot){
  const base=Number(BASE_COMPONENT_WEAR[slot]??1.5);
  if(!row?.retired)return base;

  const reason=String(row?.retirement_reason||"");
  if(/accident|collision/i.test(reason)){
    const severity=severityOf(row);
    return base+Number(SEVERITY_DAMAGE[severity]||1)*Number(ACCIDENT_SLOT_MULTIPLIER[slot]??0.4);
  }

  const affected=mechanicalAffectedSlots(reason);
  if(affected.has(slot))return base+6;
  return base+0.6;
}

export function applyRaceComponentWear(gs,{race=[],gp=null}={}){
  if(!gs)return gs;
  const garage=syncGarageState(gs,gs?.garage||{});
  const partDeltas=new Map();
  const wearRows=[];

  for(const row of race||[]){
    const driverId=driverIdOf(row);
    if(!driverId)continue;
    const car=garageCarForDriver({...gs,garage},driverId);
    if(!car)continue;

    for(const {slot,part} of installedPartsForCar({...gs,garage},car)){
      const id=String(part?.id??"");
      if(!id)continue;
      const wear=componentWearForRaceRow(row,slot);
      partDeltas.set(id,(partDeltas.get(id)||0)+wear);
      wearRows.push({
        gp_id:String(gp?.gp_id??gp?.id??gp?.track_id??""),
        date:String(gs?.currentDateISO||gp?.race_date||"").slice(0,10),
        driver_id:driverId,
        car_id:car.id,
        part_id:id,
        slot,
        wear:Number(wear.toFixed(2)),
        retirement_reason:row?.retirement_reason||null,
        incident_severity:row?.incident_severity||null,
      });
    }
  }

  if(!partDeltas.size){
    return garage===gs?.garage?gs:{...gs,garage};
  }

  const parts=(gs?.development?.parts||[]).map((part)=>{
    const wear=partDeltas.get(String(part?.id??""));
    if(!wear)return part;
    const before=clamp(part?.condition??100);
    return {
      ...part,
      condition:Number(clamp(before-wear).toFixed(1)),
      last_wear:Number(wear.toFixed(2)),
      last_wear_date:String(gs?.currentDateISO||"").slice(0,10)||null,
    };
  });

  return {
    ...gs,
    garage,
    development:{...(gs?.development||{}),parts},
    componentWearLog:[...wearRows,...(Array.isArray(gs?.componentWearLog)?gs.componentWearLog:[])].slice(0,200),
  };
}


export function applyPracticeComponentWear(gs,{practiceResults=[],gp=null}={}){
  if(!gs)return gs;
  const garage=syncGarageState(gs,gs?.garage||{});
  const partDeltas=new Map();
  const wearRows=[];

  for(const result of practiceResults||[]){
    const driverId=String(result?.driver_id??"");
    if(!driverId)continue;
    const car=garageCarForDriver({...gs,garage},driverId);
    if(!car)continue;

    const mileageFactor=clamp(Number(result?.mileage_factor??1),0.4,1.8);
    const programmeWear=clamp(Number(result?.wear_factor??1),0.5,1.6);
    const issue=String(result?.issue_type||"").toLowerCase();
    const issueSlot=String(result?.issue_slot||"");

    for(const {slot,part} of installedPartsForCar({...gs,garage},car)){
      const id=String(part?.id??"");
      if(!id)continue;

      let wear=Number(BASE_COMPONENT_WEAR[slot]??1.5)*0.28*mileageFactor*programmeWear;
      if(issue==="contact"){
        wear+=2.5*Number(ACCIDENT_SLOT_MULTIPLIER[slot]??0.4);
      }else if(issue==="mechanical"&&slot===issueSlot){
        wear+=3.5;
      }else if(issue==="mechanical"){
        wear+=0.25;
      }

      partDeltas.set(id,(partDeltas.get(id)||0)+wear);
      wearRows.push({
        gp_id:String(gp?.gp_id??gp?.id??gp?.track_id??""),
        date:String(gs?.currentDateISO||"").slice(0,10),
        session:"practice",
        driver_id:driverId,
        car_id:car.id,
        part_id:id,
        slot,
        wear:Number(wear.toFixed(2)),
        issue_type:result?.issue_type||null,
        programme:result?.programme_id||null,
      });
    }
  }

  if(!partDeltas.size){
    return garage===gs?.garage?gs:{...gs,garage};
  }

  const parts=(gs?.development?.parts||[]).map((part)=>{
    const wear=partDeltas.get(String(part?.id??""));
    if(!wear)return part;
    const before=clamp(part?.condition??100);
    return {
      ...part,
      condition:Number(clamp(before-wear).toFixed(1)),
      last_wear:Number(wear.toFixed(2)),
      last_wear_date:String(gs?.currentDateISO||"").slice(0,10)||null,
    };
  });

  return {
    ...gs,
    garage,
    development:{...(gs?.development||{}),parts},
    componentWearLog:[...wearRows,...(Array.isArray(gs?.componentWearLog)?gs.componentWearLog:[])].slice(0,200),
  };
}
