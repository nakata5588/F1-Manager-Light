// src/domain/driverMentalState.js
// D6.1 — central runtime engine for temporary driver state.
//
// BASE ABILITY / Overall remains in driverRatings.
// Mental state lives only in driverAttributes and changes Current Performance.

import {
  defaultDriverCondition,
  normalizeDriverCondition,
} from "./driverRating.js";

export const DRIVER_MENTAL_STATE_FIELDS=Object.freeze([
  "confidence","morale","preparation","fatigue",
]);

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;

function retirementMentalContext(reasonInput){
  const reason=String(reasonInput||"").toLowerCase();
  if(/engine|gearbox|transmission|electrical|cooling|fuel|hydraulic|suspension|brake|turbo|oil|fire|mechanical|power unit|driveshaft|clutch/.test(reason)){
    return {key:"mechanical",label:"Mechanical retirement"};
  }
  if(/accident|crash|spin|spun|driver error|mistake/.test(reason)){
    return {key:"driver_error",label:"Driver-error retirement"};
  }
  if(/collision|contact/.test(reason)){
    return {key:"racing_incident",label:"Racing-incident retirement"};
  }
  return {key:"unknown",label:"Retirement"};
}

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


export function mentalStateChanges(beforeInput,afterInput){
  const before=mentalStateCondition(beforeInput);
  const after=mentalStateCondition(afterInput);
  return DRIVER_MENTAL_STATE_FIELDS
    .filter((field)=>Number(before[field])!==Number(after[field]))
    .map((field)=>({
      field,
      before:round1(before[field]),
      after:round1(after[field]),
      delta:round1(after[field]-before[field]),
    }));
}

export function appendDriverMentalStateLog(logsInput,driverId,{
  before,
  after,
  source="mental_state",
  reason=null,
  dateISO=null,
  meta=null,
}={}){
  const changes=mentalStateChanges(before,after);
  if(!changes.length)return {...(logsInput||{})};
  const logs={...(logsInput||{})};
  const key=String(driverId??"");
  if(!key)return logs;
  logs[key]=[
    ...(logs[key]||[]),
    {
      dateISO:String(dateISO||"").slice(0,10)||null,
      source,
      reason,
      changes,
      meta:meta&&typeof meta==="object"?{...meta}:null,
    },
  ].slice(-120);
  return logs;
}

function comparableDriverKey(value){
  const raw=String(value??"");
  const digits=raw.match(/(\d+)/)?.[1];
  return digits?digits.padStart(4,"0"):raw.toLowerCase();
}

export function driverMentalStateHistory(gs,driverId,{limit=12}={}){
  const wanted=comparableDriverKey(driverId);
  const entries=[];
  for(const [key,rows] of Object.entries(gs?.driverMentalStateLog||{})){
    if(comparableDriverKey(key)!==wanted)continue;
    for(const row of Array.isArray(rows)?rows:[])entries.push(row);
  }
  return entries
    .slice()
    .sort((a,b)=>String(b?.dateISO||"").localeCompare(String(a?.dateISO||"")))
    .slice(0,Math.max(1,Number(limit)||12));
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

  const logs=appendDriverMentalStateLog(gs?.driverMentalStateLog,key,{
    before,
    after,
    source,
    reason,
    dateISO:dateISO??gs?.currentDateISO,
    meta,
  });
  return {...gs,driverAttributes:dict,driverMentalStateLog:logs};
}

export function passiveMentalStateRecovery(condition,{dateISO=null}={}){
  const current=mentalStateCondition(condition);
  const dow=dateISO
    ?new Date(`${String(dateISO).slice(0,10)}T00:00:00Z`).getUTCDay()
    :1;
  const weekend=dow===0||dow===6;
  const baseRecovery=weekend?4.5:3.2;
  const loadRecovery=current.fatigue>=75
    ?2.0
    :current.fatigue>=55
      ?1.4
      :current.fatigue>=35
        ?0.8
        :current.fatigue>=15
          ?0.3
          :0;
  return setMentalStateValues(current,{
    fatigue:current.fatigue-(baseRecovery+loadRecovery),
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

function expectationDeltaOf(entry){
  if(!entry||entry?.retired)return null;
  const explicit=Number(entry?.expectation_delta);
  if(Number.isFinite(explicit))return explicit;
  const expected=Number(entry?.expected_finish);
  const finish=Number(entry?.finish_position);
  return Number.isFinite(expected)&&Number.isFinite(finish)?expected-finish:null;
}

function teammateRaceDeltaOf(entry){
  if(!entry||entry?.retired)return null;
  const value=Number(entry?.teammate_race_delta);
  return Number.isFinite(value)?value:null;
}

function recentExpectationStreak(entries,currentDelta){
  if(!Number.isFinite(currentDelta)||Math.abs(currentDelta)<1.5)return 0;
  const previous=(Array.isArray(entries)?entries:[])
    .slice()
    .sort((a,b)=>String(b?.dateISO||"").localeCompare(String(a?.dateISO||""))||Number(b?.round||0)-Number(a?.round||0))
    .map(expectationDeltaOf)
    .filter(Number.isFinite)
    .slice(0,2);
  if(previous.length<2)return 0;
  const sequence=[currentDelta,...previous];
  if(sequence.every((value)=>value>=1.5))return 1;
  if(sequence.every((value)=>value<=-1.5))return -1;
  return 0;
}

export function expectationTeammateMentalAdjustment(performance,{
  rating=null,
  recentEntries=[],
}={}){
  if(!performance||performance?.retired){
    return {
      confidence:0,
      morale:0,
      reasons:[],
      expectationDelta:null,
      teammateDelta:null,
      streak:0,
      swingMultiplier:1,
    };
  }

  const mentality=Number(rating?.mentality);
  const pressure=Number(rating?.pressure_handling);
  const mentalAverage=[
    Number.isFinite(mentality)?mentality:50,
    Number.isFinite(pressure)?pressure:50,
  ].reduce((a,b)=>a+b,0)/2;
  // High Mentality / Pressure Handling dampens emotional volatility. Low
  // resilience amplifies it. Permanent ability is never changed here.
  const swingMultiplier=Math.max(0.8,Math.min(1.2,1.2-(mentalAverage/100)*0.4));

  const expectationDelta=expectationDeltaOf(performance);
  const teammateDelta=teammateRaceDeltaOf(performance);
  const qualifyingDelta=Number(performance?.teammate_qualifying_delta);
  const reasons=[];
  let confidence=0;
  let morale=0;

  if(Number.isFinite(expectationDelta)&&Math.abs(expectationDelta)>=0.75){
    confidence+=Math.max(-2.4,Math.min(2.4,expectationDelta*0.40));
    morale+=Math.max(-1.3,Math.min(1.3,expectationDelta*0.22));
    if(expectationDelta>0){
      reasons.push(`Result above expectation by ${Math.abs(expectationDelta).toFixed(1)} position(s) (~P${Number(performance?.expected_finish).toFixed(1)})`);
    }else{
      reasons.push(`Result below expectation by ${Math.abs(expectationDelta).toFixed(1)} position(s) (~P${Number(performance?.expected_finish).toFixed(1)})`);
    }
  }

  if(Number.isFinite(teammateDelta)&&Math.abs(teammateDelta)>=0.5){
    confidence+=Math.max(-0.9,Math.min(0.9,teammateDelta*0.22));
    morale+=Math.max(-0.5,Math.min(0.5,teammateDelta*0.12));
    reasons.push(
      teammateDelta>0
        ?`Finished ${Math.abs(teammateDelta).toFixed(0)} position(s) ahead of team-mate`
        :`Finished ${Math.abs(teammateDelta).toFixed(0)} position(s) behind team-mate`
    );
  }

  if(Number.isFinite(qualifyingDelta)&&Math.abs(qualifyingDelta)>=1){
    confidence+=Math.max(-0.35,Math.min(0.35,qualifyingDelta*0.10));
    reasons.push(
      qualifyingDelta>0
        ?`Out-qualified team-mate by ${Math.abs(qualifyingDelta).toFixed(0)} position(s)`
        :`Out-qualified by team-mate by ${Math.abs(qualifyingDelta).toFixed(0)} position(s)`
    );
  }

  const streak=recentExpectationStreak(recentEntries,expectationDelta);
  if(streak>0){
    confidence+=1.0;
    morale+=0.6;
    reasons.push("Three-race run above expectations");
  }else if(streak<0){
    confidence-=1.2;
    morale-=0.8;
    reasons.push("Three-race run below expectations");
  }

  return {
    confidence:round1(confidence*swingMultiplier),
    morale:round1(morale*swingMultiplier),
    reasons,
    expectationDelta:Number.isFinite(expectationDelta)?round1(expectationDelta):null,
    teammateDelta:Number.isFinite(teammateDelta)?round1(teammateDelta):null,
    streak,
    swingMultiplier:round1(swingMultiplier),
  };
}

export function raceMentalStateChange(row,{
  startPosition=null,
  expectedPosition=null,
  points=null,
  fieldSize=20,
  wet=false,
  performance=null,
  rating=null,
  recentEntries=[],
}={}){
  const finish=Number(row?.pos??row?.position);
  const start=Number(startPosition??finish);
  const positionDelta=Number.isFinite(start)&&Number.isFinite(finish)?start-finish:0;
  const responsibility=row?.retired?retirementMentalContext(row?.retirement_reason):null;

  // A retirement itself is a TEAM operational setback, not automatic blame on
  // the driver. Only incidents attributable to an accident/error affect Driver
  // Morale/Confidence. Mechanical/unknown DNFs therefore start neutral.
  let confidence=(row?.retired&&["mechanical","unknown"].includes(responsibility?.key))
    ?0
    :Math.max(-2,Math.min(2,positionDelta*0.35));
  let morale=(row?.retired&&["mechanical","unknown"].includes(responsibility?.key))
    ?0
    :Math.max(-1.5,Math.min(1.5,positionDelta*0.25));
  const reasons=[];

  if(row?.retired){
    const impact=responsibility.key==="driver_error"
      ?{confidence:-4.5,morale:-3.0}
      :responsibility.key==="racing_incident"
        ?{confidence:-3.0,morale:-2.0}
        :{confidence:0,morale:0};
    confidence+=impact.confidence;
    morale+=impact.morale;
    reasons.push(responsibility.label);
  }else{
    if(finish===1){
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

    const scored=Number(points??row?.points);
    if(Number.isFinite(scored)&&scored>0&&finish>3){
      confidence+=0.5;
      morale+=1.0;
      reasons.push(`Points finish (+${scored})`);
    }

    const evaluatedPerformance={
      ...(row?.driver_performance||{}),
      ...(performance||{}),
      expected_finish:performance?.expected_finish??row?.driver_performance?.expected_finish??expectedPosition,
      finish_position:performance?.finish_position??row?.driver_performance?.finish_position??finish,
      retired:Boolean(performance?.retired??row?.driver_performance?.retired??row?.retired),
    };
    const expectationImpact=expectationTeammateMentalAdjustment(evaluatedPerformance,{
      rating,
      recentEntries,
    });
    confidence+=expectationImpact.confidence;
    morale+=expectationImpact.morale;
    reasons.push(...expectationImpact.reasons);
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
