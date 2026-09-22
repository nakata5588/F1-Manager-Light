// src/domain/driverKnowledge.js
// Central policy for what the player is allowed to know about a driver.
// Simulation engines may use the real ratings; UI surfaces should use this
// presentation layer so hidden information is not leaked accidentally.

import { activeDriverContract, driverIdOf, teamIdOf } from "./driverContracts.js";

const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
  }
  return value;
};
const pick=(row,keys,fallback=undefined)=>{
  for(const key of keys){
    const value=unwrap(row?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
};
const asRows=(value)=>{
  const raw=unwrap(value);
  if(Array.isArray(raw))return raw;
  if(!raw||typeof raw!=="object")return [];
  for(const key of ["items","rows","list","data"])if(Array.isArray(raw[key]))return raw[key];
  return Object.values(raw).filter((row)=>row&&typeof row==="object"&&!Array.isArray(row));
};
const normalizeId=(value)=>{
  const raw=unwrap(value);
  if(raw===null||raw===undefined||raw==="")return "";
  const text=String(raw);
  const match=text.match(/(\d+)/);
  return match?match[1].padStart(4,"0"):text.toLowerCase();
};
const sameDriver=(a,b)=>Boolean(normalizeId(a)&&normalizeId(a)===normalizeId(b));
const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));

function driverRecord(gs,driverOrId){
  if(driverOrId&&typeof driverOrId==="object")return driverOrId;
  const id=String(driverOrId??"");
  const rows=[...asRows(gs?.dbDrivers),...asRows(gs?.drivers)];
  return rows.reduce((found,row)=>sameDriver(driverIdOf(row),id)?{...(found||{}),...row}:found,null);
}
function playerTeamId(gs){
  return String(gs?.team?.team_id??gs?.team?.id??"");
}
function academySupported(gs,driverId){
  return asRows(gs?.academy?.drivers).some((row)=>
    sameDriver(driverIdOf(row),driverId)
    && !["ended","cancelled","released","inactive"].includes(String(row?.status||"active").toLowerCase())
  );
}
function completedSpecificReport(gs,driverId){
  return asRows(gs?.scouting?.assignments)
    .filter((row)=>String(row?.status||"").toLowerCase()==="completed")
    .filter((row)=>String(row?.mode||"driver").toLowerCase()!=="region")
    .filter((row)=>sameDriver(row?.prospect_id??row?.driver_id,driverId))
    .sort((a,b)=>String(b?.completed_at||b?.finishes_at||"").localeCompare(String(a?.completed_at||a?.finishes_at||"")))[0]||null;
}
function completedRegionalDiscovery(gs,driverId){
  return asRows(gs?.scouting?.assignments)
    .filter((row)=>String(row?.status||"").toLowerCase()==="completed")
    .filter((row)=>String(row?.mode||"").toLowerCase()==="region")
    .filter((row)=>asRows(row?.discovered_ids).some((id)=>sameDriver(id,driverId)))
    .sort((a,b)=>String(b?.completed_at||b?.finishes_at||"").localeCompare(String(a?.completed_at||a?.finishes_at||"")))[0]||null;
}
function hadPlayerContract(gs,driverId){
  const teamId=playerTeamId(gs);
  if(!teamId)return false;
  return asRows(gs?.contracts).some((row)=>
    sameDriver(driverIdOf(row),driverId)&&String(teamIdOf(row))===teamId
  );
}
function hasF1Career(gs,driverId){
  const activeYear=Number(gs?.activeYear);
  const career=[...asRows(gs?.dbDriverCareer),...asRows(gs?.driverCareer)];
  if(career.some((row)=>{
    if(!sameDriver(driverIdOf(row),driverId))return false;
    const year=Number(pick(row,["year","season_year"],NaN));
    if(Number.isFinite(activeYear)&&Number.isFinite(year)&&year>activeYear)return false;
    return String(pick(row,["series_division","series"],"")).toUpperCase()==="F1";
  }))return true;

  return asRows(gs?.results).some((event)=>
    !Number.isFinite(activeYear)||!Number.isFinite(Number(event?.year))||Number(event.year)<=activeYear
      ? asRows(event?.classification).some((row)=>sameDriver(row?.driver_id??row?.id,driverId))
      : false
  );
}

export const DRIVER_KNOWLEDGE_LEVELS=Object.freeze({
  OWN:"own",
  ACADEMY:"academy",
  SCOUTED:"scouted",
  DISCOVERED:"discovered",
  PUBLIC:"public",
  UNKNOWN:"unknown",
});

export function driverKnowledgeState(gs,driverOrId){
  const driver=driverRecord(gs,driverOrId);
  const driverId=driverIdOf(driver)||String(driverOrId??"");
  const contract=activeDriverContract(gs,driverId);
  const myTeam=playerTeamId(gs);
  const specific=completedSpecificReport(gs,driverId);
  const regional=completedRegionalDiscovery(gs,driverId);
  const isOwn=Boolean(contract&&myTeam&&String(teamIdOf(contract))===myTeam);
  const isAcademy=academySupported(gs,driverId);

  let level=DRIVER_KNOWLEDGE_LEVELS.UNKNOWN;
  let source="unscouted";
  let label="Unscouted";

  if(isOwn){
    level=DRIVER_KNOWLEDGE_LEVELS.OWN;
    source="current_team";
    label="Team data";
  }else if(isAcademy){
    level=DRIVER_KNOWLEDGE_LEVELS.ACADEMY;
    source="academy";
    label="Academy data";
  }else if(specific){
    level=DRIVER_KNOWLEDGE_LEVELS.SCOUTED;
    source="driver_report";
    label="Full scout report";
  }else if(regional){
    level=DRIVER_KNOWLEDGE_LEVELS.DISCOVERED;
    source="regional_report";
    label="Regional estimate";
  }else if(contract||hasF1Career(gs,driverId)||hadPlayerContract(gs,driverId)){
    level=DRIVER_KNOWLEDGE_LEVELS.PUBLIC;
    source=hadPlayerContract(gs,driverId)?"former_team":"public_f1";
    label=hadPlayerContract(gs,driverId)?"Known driver":"Public estimate";
  }

  const exactAbility=[
    DRIVER_KNOWLEDGE_LEVELS.OWN,
    DRIVER_KNOWLEDGE_LEVELS.ACADEMY,
    DRIVER_KNOWLEDGE_LEVELS.SCOUTED,
  ].includes(level);
  const rangedAbility=[
    DRIVER_KNOWLEDGE_LEVELS.DISCOVERED,
    DRIVER_KNOWLEDGE_LEVELS.PUBLIC,
  ].includes(level);
  const exactPotential=[
    DRIVER_KNOWLEDGE_LEVELS.OWN,
    DRIVER_KNOWLEDGE_LEVELS.ACADEMY,
    DRIVER_KNOWLEDGE_LEVELS.SCOUTED,
  ].includes(level);
  const rangedPotential=level===DRIVER_KNOWLEDGE_LEVELS.DISCOVERED;

  return {
    driver_id:String(driverId),
    level,
    source,
    label,
    exactAbility,
    rangedAbility,
    exactPotential,
    rangedPotential,
    exactAttributes:exactAbility,
    rangedAttributes:rangedAbility,
    canSeeCondition:level===DRIVER_KNOWLEDGE_LEVELS.OWN,
    canSeeDevelopmentHistory:[
      DRIVER_KNOWLEDGE_LEVELS.OWN,
      DRIVER_KNOWLEDGE_LEVELS.ACADEMY,
    ].includes(level),
    canSeeExactAbility:exactAbility,
    canSeeExactPotential:exactPotential,
    specificReport:specific,
    regionalReport:regional,
  };
}

function stableHash(text){
  let h=2166136261;
  for(const char of String(text||"")){
    h^=char.charCodeAt(0);
    h=Math.imul(h,16777619);
  }
  return Math.abs(h>>>0);
}
function rangeFor(knowledge,field,value,kind){
  const raw=clamp(Math.round(Number(value)),0,100);
  let span;
  if(kind==="potential")span=14;
  else if(knowledge.level===DRIVER_KNOWLEDGE_LEVELS.PUBLIC)span=6;
  else span=10;

  span=Math.max(2,Math.min(20,span));
  const left=1+(stableHash(`${knowledge.driver_id}:${field}:${knowledge.level}`)%(span-1));
  let min=raw-left;
  min=Math.max(0,Math.min(100-span,min));
  let max=min+span;

  // Never make the exact value trivially recoverable as the midpoint of a
  // displayed estimate range. Keep the real value inside the interval while
  // shifting the range when necessary.
  if((min+max)/2===raw){
    if(max<100){
      min+=1;
      max+=1;
    }else if(min>0){
      min-=1;
      max-=1;
    }
  }
  return {min,max};
}

export function presentDriverKnowledgeValue(knowledge,field,rawValue,{kind="ability",estimated=false}={}){
  const numeric=Number(unwrap(rawValue));
  if(!Number.isFinite(numeric)){
    return {visibility:"missing",label:"—",value:null,min:null,max:null,sortValue:null};
  }

  let exact=false;
  let ranged=false;
  if(kind==="condition"){
    exact=Boolean(knowledge?.canSeeCondition);
  }else if(kind==="potential"){
    exact=Boolean(knowledge?.exactPotential);
    ranged=Boolean(knowledge?.rangedPotential);
  }else if(kind==="attribute"){
    exact=Boolean(knowledge?.exactAttributes);
    ranged=Boolean(knowledge?.rangedAttributes);
  }else{
    exact=Boolean(knowledge?.exactAbility);
    ranged=Boolean(knowledge?.rangedAbility);
  }

  if(exact){
    const rounded=Number(numeric.toFixed(1));
    return {
      visibility:"exact",
      label:`${estimated?"~":""}${Number.isInteger(rounded)?rounded:rounded.toFixed(1)}`,
      value:rounded,
      min:rounded,
      max:rounded,
      sortValue:rounded,
    };
  }

  if(ranged){
    const {min,max}=rangeFor(knowledge,field,numeric,kind);
    return {
      visibility:"range",
      label:`${min}–${max}`,
      value:null,
      min,
      max,
      sortValue:(min+max)/2,
    };
  }

  return {visibility:"hidden",label:"?",value:null,min:null,max:null,sortValue:null};
}

export function driverKnowledgeLabel(knowledge){
  return knowledge?.label||"Unscouted";
}
