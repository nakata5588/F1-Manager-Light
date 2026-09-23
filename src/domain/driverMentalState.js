// src/domain/driverMentalState.js
// D6.1 — central runtime engine for temporary driver state.
//
// BASE ABILITY / Overall remains in driverRatings.
// Mental state lives only in driverAttributes and changes Current Performance.

import {
  defaultDriverCondition,
  normalizeDriverCondition,
} from "./driverRating.js";
import { retirementResponsibility } from "./driverForm.js";

export const DRIVER_MENTAL_STATE_FIELDS=Object.freeze([
  "confidence","morale","preparation","fatigue",
]);

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;

function meanRevert(value,target=50,rate=0.02){
  const current=Number(value);
  if(!Number.isFinite(current))return target;
  return clamp(current+(target-current)*rate);
}

function storageKey(gs,driverId){
  const raw=String(driverId??"");
  const dict=gs?.driverAttributes||{};
  if(Object.prototype.hasOwnProperty.call(dict,raw))return raw;
  const digits=raw.match(/(\d+)/)?.[1]?.padStart(4,"0");
  if(digits&&Object.prototype.hasOwnProperty.call(dict,digits))return digits;
  return raw||digits||"";
}

export function mentalStateCondition(value){
  return normalizeDriverCondition(value||defaultDriverCondition());
}

export function applyMentalStateDeltaToCondition(condition,deltas={}){
  const current=mentalStateCondition(condition);
  const next={...current};
  for(const field of DRIVER_MENTAL_STATE_FIELDS){
    const delta=Number(deltas?.[field]);
    if(!Number.isFinite(delta)||delta===0)continue;
    next[field]=round1(clamp(Number(current[field])+delta));
  }
  return next;
}

export function setMentalStateValues(condition,values={}){
  const current=mentalStateCondition(condition);
  const next={...current};
  for(const field of DRIVER_MENTAL_STATE_FIELDS){
    const value=Number(values?.[field]);
    if(!Number.isFinite(value))continue;
    next[field]=round1(clamp(value));
  }
  return next;
}

export function applyDriverMentalState(gs,driverId,{
  deltas={},
  values={},
  source="mental_state",
  reason=null,
  dateISO=null,
  meta=null,
  log=true,
}={}){
  if(!gs)return gs;
  const key=storageKey(gs,driverId);
  if(!key)return gs;

  const dict={...(gs?.driverAttributes||{})};
  const before=mentalStateCondition(dict[key]);
  const after=setMentalStateValues(
    applyMentalStateDeltaToCondition(before,deltas),
    values
  );
  dict[key]=after;

  if(!log)return {...gs,driverAttributes:dict};

  const changed=DRIVER_MENTAL_STATE_FIELDS
    .filter((field)=>Number(before[field])!==Number(after[field]))
    .map((field)=>({
      field,
      before:round1(before[field]),
      after:round1(after[field]),
      delta:round1(after[field]-before[field]),
    }));
  if(!changed.length)return {...gs,driverAttributes:dict};

  const logs={...(gs?.driverMentalStateLog||{})};
  logs[key]=[
    ...(logs[key]||[]),
    {
      dateISO:String(dateISO??gs?.currentDateISO??"").slice(0,10)||null,
      source,
      reason,
      changes:changed,
      meta:meta&&typeof meta==="object"?{...meta}:null,
    },
  ].slice(-120);

  return {...gs,driverAttributes:dict,driverMentalStateLog:logs};
}

export function passiveMentalStateRecovery(condition,{dateISO=null}={}){
  const current=mentalStateCondition(condition);
  const dow=dateISO
    ?new Date(`${String(dateISO).slice(0,10)}T00:00:00Z`).getUTCDay()
    :1;
  const baseRecovery=(dow===0||dow===6)?1.7:1.1;
  const highLoadRecovery=current.fatigue>=60?0.3:current.fatigue>=40?0.15:0;
  return setMentalStateValues(current,{
    fatigue:current.fatigue-(baseRecovery+highLoadRecovery),
    preparation:current.preparation+(current.preparation<60?0.20:0),
    confidence:meanRevert(current.confidence,50,0.018),
    morale:meanRevert(current.morale,50,0.010),
  });
}

export function seasonStartMentalState(condition){
  const current=mentalStateCondition(condition);
  return setMentalStateValues(current,{
    fatigue:0,
    preparation:50,
    confidence:50+(current.confidence-50)*0.35,
    morale:50+(current.morale-50)*0.35,
  });
}

export function raceMentalStateChange(row,{
  startPosition=null,
  fieldSize=20,
  wet=false,
}={}){
  const finish=Number(row?.pos??row?.position);
  const start=Number(startPosition??finish);
  const positionDelta=Number.isFinite(start)&&Number.isFinite(finish)?start-finish:0;

  let confidence=Math.max(-2,Math.min(2,positionDelta*0.35));
  let morale=Math.max(-1.5,Math.min(1.5,positionDelta*0.25));
  const reasons=[];

  if(row?.retired){
    const responsibility=retirementResponsibility(row?.retirement_reason);
    // D6.1 keeps retirement effects temporary. Permanent ability is untouched.
    const impact=responsibility.key==="mechanical"
      ?{confidence:-2.0,morale:-1.5}
      :responsibility.key==="driver_error"
        ?{confidence:-4.5,morale:-2.5}
        :responsibility.key==="racing_incident"
          ?{confidence:-3.0,morale:-2.0}
          :{confidence:-3.0,morale:-2.0};
    confidence+=impact.confidence;
    morale+=impact.morale;
    reasons.push(responsibility.label);
  }else if(finish===1){
    confidence+=5;
    morale+=4;
    reasons.push("Race win");
  }else if(finish<=3){
    confidence+=3;
    morale+=2;
    reasons.push(`Podium P${finish}`);
  }else if(finish<=Math.max(5,Math.ceil(Number(fieldSize||20)/2))){
    confidence+=1;
    morale+=0.5;
    reasons.push(`Strong finish P${finish}`);
  }

  const distanceRatio=Math.max(
    0,
    Math.min(1,Number(row?.laps_completed||0)/Math.max(1,Number(row?.race_laps)||60))
  );
  const fallbackLoad=row?.retired?6+distanceRatio*8:16;
  const modeledFatigue=Number(row?.race_fatigue_gain);
  const fatigue=Number.isFinite(modeledFatigue)
    ?modeledFatigue*(row?.retired?Math.max(0.38,distanceRatio):1)
    :fallbackLoad+(wet?3:0);

  return {
    deltas:{
      fatigue:round1(fatigue),
      preparation:-10,
      confidence:round1(confidence),
      morale:round1(morale),
    },
    reasons,
  };
}
