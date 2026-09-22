// src/domain/componentWear.js
import {
  componentSlotsForTeam,
  garageCarForDriver,
  installedPartsForCar,
  syncGarageState,
} from "./garage.js";

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const driverIdOf=(row)=>String(row?.driver?.driver_id??row?.driver?.id??row?.driver_id??"");

export const BASE_COMPONENT_WEAR=Object.freeze({
  chassis:1.8,
  aero_front:2.8,
  aero_rear:2.5,
  suspension:3.4,
  gearbox:4.2,
  brakes:3.8,
  cooling:3.2,
  turbocharger:4.5,
  electronics:2.1,
  kers:3.6,
  ers_mgu_k:4.0,
  ers_mgu_h:4.3,
  battery_pack:3.0,
  fuel_system:3.2,
  exhaust_system:2.6,
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
  electronics:0.18,
  kers:0.20,
  ers_mgu_k:0.20,
  ers_mgu_h:0.18,
  battery_pack:0.15,
  fuel_system:0.25,
  exhaust_system:0.35,
});

const SEVERITY_DAMAGE=Object.freeze({
  low:1.5,
  medium:5.0,
  high:11.0,
  critical:19.0,
});

function mechanicalAffectedSlots(reason){
  const value=String(reason||"").toLowerCase();
  if(/gearbox|transmission/.test(value))return new Set(["gearbox"]);
  if(/suspension/.test(value))return new Set(["suspension"]);
  if(/cooling/.test(value))return new Set(["cooling"]);
  if(/engine/.test(value))return new Set(["cooling","turbocharger","fuel_system","exhaust_system"]);
  if(/electrical/.test(value))return new Set(["electronics","ers_mgu_k","ers_mgu_h","battery_pack"]);
  if(/fuel/.test(value))return new Set(["fuel_system","cooling"]);
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

function raceDistanceFactor(row){
  if(!row?.retired)return 1;
  const laps=Number(row?.laps_completed);
  const raceLaps=Math.max(1,Number(row?.race_laps)||60);
  if(!Number.isFinite(laps))return 0.65;
  return clamp(laps/raceLaps,0.25,1);
}

export function componentWearForRaceRow(row,slot){
  const base=Number(BASE_COMPONENT_WEAR[slot]??2.5)*raceDistanceFactor(row);
  if(!row?.retired)return base;

  const reason=String(row?.retirement_reason||"");
  if(/accident|collision/i.test(reason)){
    const severity=severityOf(row);
    return base+Number(SEVERITY_DAMAGE[severity]||1.5)*Number(ACCIDENT_SLOT_MULTIPLIER[slot]??0.4);
  }
  const affected=mechanicalAffectedSlots(reason);
  if(affected.has(slot))return base+8;
  return base+0.8;
}

function applyWearDeltas(gs,garage,partDeltas,baseDeltas,wearRows){
  const beforePartById=new Map((gs?.development?.parts||[]).map((part)=>[
    String(part?.id??""),
    clamp(part?.condition??100),
  ]));
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

  const eligibleSlots=componentSlotsForTeam(gs);
  const cars=(garage?.cars||[]).map((car)=>{
    const condition={...(car?.componentCondition||{})};
    for(const slot of eligibleSlots){
      const wear=baseDeltas.get(String(car.id)+"::"+slot);
      if(!wear)continue;
      condition[slot]=Number(clamp(Number(condition[slot]??100)-wear).toFixed(1));
    }
    return {...car,componentCondition:condition};
  });
  const nextGarage={...garage,cars};

  const partAfterById=new Map(parts.map((part)=>[String(part?.id??""),clamp(part?.condition??100)]));
  const carAfterById=new Map(cars.map((car)=>[String(car.id),car]));
  const enrichedRows=wearRows.map((row)=>{
    if(row.part_id){
      return {
        ...row,
        condition_before:beforePartById.get(String(row.part_id))??null,
        condition_after:partAfterById.get(String(row.part_id))??null,
      };
    }
    const car=carAfterById.get(String(row.car_id));
    const after=clamp(car?.componentCondition?.[row.slot]??100);
    return {
      ...row,
      condition_before:Number(clamp(after+Number(row.wear||0)).toFixed(1)),
      condition_after:after,
    };
  });

  return {
    ...gs,
    garage:nextGarage,
    development:{...(gs?.development||{}),parts},
    componentWearLog:[...enrichedRows,...(Array.isArray(gs?.componentWearLog)?gs.componentWearLog:[])].slice(0,500),
  };
}

export function applyRaceComponentWear(gs,{race=[],gp=null}={}){
  if(!gs)return gs;
  const garage=syncGarageState(gs,gs?.garage||{});
  const partDeltas=new Map();
  const baseDeltas=new Map();
  const wearRows=[];

  const eligibleSlots=componentSlotsForTeam({...gs,garage});
  for(const row of race||[]){
    const driverId=driverIdOf(row);
    if(!driverId)continue;
    const car=garageCarForDriver({...gs,garage},driverId);
    if(!car)continue;
    const fittedBySlot=new Map(installedPartsForCar({...gs,garage},car).map((x)=>[x.slot,x.part]));

    for(const slot of eligibleSlots){
      const wear=componentWearForRaceRow(row,slot);
      const part=fittedBySlot.get(slot)||null;
      if(part){
        const id=String(part?.id??"");
        if(!id)continue;
        partDeltas.set(id,(partDeltas.get(id)||0)+wear);
        wearRows.push({
          gp_id:String(gp?.gp_id??gp?.id??gp?.track_id??""),
          date:String(gs?.currentDateISO||gp?.race_date||"").slice(0,10),
          session:"race",
          driver_id:driverId,
          car_id:car.id,
          part_id:id,
          component_source:"developed_part",
          slot,
          wear:Number(wear.toFixed(2)),
          retirement_reason:row?.retirement_reason||null,
          incident_severity:row?.incident_severity||null,
        });
      }else{
        const key=String(car.id)+"::"+slot;
        baseDeltas.set(key,(baseDeltas.get(key)||0)+wear);
        wearRows.push({
          gp_id:String(gp?.gp_id??gp?.id??gp?.track_id??""),
          date:String(gs?.currentDateISO||gp?.race_date||"").slice(0,10),
          session:"race",
          driver_id:driverId,
          car_id:car.id,
          part_id:null,
          component_source:"base_component",
          slot,
          wear:Number(wear.toFixed(2)),
          retirement_reason:row?.retirement_reason||null,
          incident_severity:row?.incident_severity||null,
        });
      }
    }
  }

  if(!partDeltas.size&&!baseDeltas.size)return {...gs,garage};
  return applyWearDeltas(gs,garage,partDeltas,baseDeltas,wearRows);
}

export function applyPracticeComponentWear(gs,{practiceResults=[],gp=null}={}){
  if(!gs)return gs;
  const garage=syncGarageState(gs,gs?.garage||{});
  const partDeltas=new Map();
  const baseDeltas=new Map();
  const wearRows=[];

  const eligibleSlots=componentSlotsForTeam({...gs,garage});
  for(const result of practiceResults||[]){
    const driverId=String(result?.driver_id??"");
    if(!driverId)continue;
    const car=garageCarForDriver({...gs,garage},driverId);
    if(!car)continue;

    const mileageFactor=clamp(Number(result?.mileage_factor??1),0.4,1.8);
    const programmeWear=clamp(Number(result?.wear_factor??1),0.5,1.8);
    const issue=String(result?.issue_type||"").toLowerCase();
    const issueSlot=String(result?.issue_slot||"");
    const fittedBySlot=new Map(installedPartsForCar({...gs,garage},car).map((x)=>[x.slot,x.part]));

    for(const slot of eligibleSlots){
      let wear=Number(BASE_COMPONENT_WEAR[slot]??2.5)*0.34*mileageFactor*programmeWear;
      if(issue==="contact"){
        wear+=3.0*Number(ACCIDENT_SLOT_MULTIPLIER[slot]??0.4);
      }else if(issue==="mechanical"&&slot===issueSlot){
        wear+=4.5;
      }else if(issue==="mechanical"){
        wear+=0.30;
      }

      const part=fittedBySlot.get(slot)||null;
      if(part){
        const id=String(part?.id??"");
        if(!id)continue;
        partDeltas.set(id,(partDeltas.get(id)||0)+wear);
        wearRows.push({
          gp_id:String(gp?.gp_id??gp?.id??gp?.track_id??""),
          date:String(gs?.currentDateISO||"").slice(0,10),
          session:"practice",
          driver_id:driverId,
          car_id:car.id,
          part_id:id,
          component_source:"developed_part",
          slot,
          wear:Number(wear.toFixed(2)),
          issue_type:result?.issue_type||null,
          programme:result?.programme_id||null,
        });
      }else{
        const key=String(car.id)+"::"+slot;
        baseDeltas.set(key,(baseDeltas.get(key)||0)+wear);
        wearRows.push({
          gp_id:String(gp?.gp_id??gp?.id??gp?.track_id??""),
          date:String(gs?.currentDateISO||"").slice(0,10),
          session:"practice",
          driver_id:driverId,
          car_id:car.id,
          part_id:null,
          component_source:"base_component",
          slot,
          wear:Number(wear.toFixed(2)),
          issue_type:result?.issue_type||null,
          programme:result?.programme_id||null,
        });
      }
    }
  }

  if(!partDeltas.size&&!baseDeltas.size)return {...gs,garage};
  return applyWearDeltas(gs,garage,partDeltas,baseDeltas,wearRows);
}

export function practiceWearSummary(gs,{driverId,gp=null}={}){
  const did=String(driverId??"");
  const gpId=String(gp?.gp_id??gp?.id??gp?.track_id??gs?.raceWeekendState?.gp_id??"");
  const date=String(gs?.currentDateISO||"").slice(0,10);
  const rows=(gs?.componentWearLog||[]).filter((row)=>
    row?.session==="practice" &&
    String(row?.driver_id??"")===did &&
    (!gpId||String(row?.gp_id??"")===gpId) &&
    (!date||String(row?.date??"")===date)
  );
  const total=rows.reduce((sum,row)=>sum+Number(row?.wear||0),0);
  const worst=rows.slice().sort((a,b)=>Number(b?.wear||0)-Number(a?.wear||0))[0]||null;
  const lowest=rows
    .filter((row)=>Number.isFinite(Number(row?.condition_after)))
    .slice()
    .sort((a,b)=>Number(a.condition_after)-Number(b.condition_after))[0]||null;
  return {
    total_wear:Number(total.toFixed(2)),
    worst_slot:worst?.slot||null,
    worst_wear:Number(worst?.wear||0),
    lowest_slot:lowest?.slot||null,
    lowest_condition:Number.isFinite(Number(lowest?.condition_after))?Number(lowest.condition_after):null,
  };
}
