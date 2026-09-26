// src/domain/driverKnowledge.js
// Central policy for what the player is allowed to know about a driver.
// Simulation engines may use the real ratings; UI surfaces should use this
// presentation layer so hidden information is not leaked accidentally.

import { activeDriverContract, driverIdOf, teamIdOf } from "./driverContracts.js";
import { driverScoutingFamiliarity } from "./scoutingPolicy.js";

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
  const activeYear=Number(gs?.activeYear);
  const careerStart=Number(gs?.careerMeta?.sourceSeason??gs?.activeYear);
  return asRows(gs?.contracts).some((row)=>{
    if(!sameDriver(driverIdOf(row),driverId)||String(teamIdOf(row))!==teamId)return false;
    const year=Number(pick(row,["year","season_year","contract_start_year","start_year"],NaN));
    if(Number.isFinite(activeYear)&&Number.isFinite(year)&&year>activeYear)return false;
    if(Number.isFinite(careerStart)&&Number.isFinite(year)&&year<careerStart)return false;
    return true;
  });
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
  SCOUTED_LIGHT:"scouted_light",
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
  const specificDepth=String(specific?.depth||specific?.scouting_depth||"deep").toLowerCase();
  const familiarity=driverScoutingFamiliarity(gs,driver||driverId);
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
  }else if(specific&&specificDepth==="light"){
    level=DRIVER_KNOWLEDGE_LEVELS.SCOUTED_LIGHT;
    source="driver_report_light";
    label="Light scout report";
  }else if(specific){
    level=DRIVER_KNOWLEDGE_LEVELS.SCOUTED;
    source="driver_report_deep";
    label="Deep scout report";
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
    DRIVER_KNOWLEDGE_LEVELS.SCOUTED_LIGHT,
    DRIVER_KNOWLEDGE_LEVELS.DISCOVERED,
    DRIVER_KNOWLEDGE_LEVELS.PUBLIC,
    DRIVER_KNOWLEDGE_LEVELS.UNKNOWN,
  ].includes(level);
  const exactPotential=[
    DRIVER_KNOWLEDGE_LEVELS.OWN,
    DRIVER_KNOWLEDGE_LEVELS.ACADEMY,
    DRIVER_KNOWLEDGE_LEVELS.SCOUTED,
  ].includes(level);
  const rangedPotential=[
    DRIVER_KNOWLEDGE_LEVELS.SCOUTED_LIGHT,
    DRIVER_KNOWLEDGE_LEVELS.DISCOVERED,
    DRIVER_KNOWLEDGE_LEVELS.PUBLIC,
    DRIVER_KNOWLEDGE_LEVELS.UNKNOWN,
  ].includes(level);

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
    familiarity,
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
  const familiarity=Number(knowledge?.familiarity?.score||0);
  let span;

  if(knowledge?.level===DRIVER_KNOWLEDGE_LEVELS.SCOUTED_LIGHT){
    span=kind==="potential"?9:4;
  }else if(knowledge?.level===DRIVER_KNOWLEDGE_LEVELS.DISCOVERED){
    span=kind==="potential"?15:10;
  }else if(knowledge?.level===DRIVER_KNOWLEDGE_LEVELS.PUBLIC){
    const publicSpan=familiarity>=82?4:familiarity>=65?6:familiarity>=45?8:10;
    span=kind==="potential"?publicSpan+6:publicSpan;
  }else{
    const unknownSpan=familiarity>=60?10:familiarity>=35?13:17;
    span=kind==="potential"?unknownSpan+6:unknownSpan;
  }

  span=Math.max(2,Math.min(24,Math.round(span)));
  const left=1+(stableHash(`${knowledge.driver_id}:${field}:${knowledge.level}`)%Math.max(1,span-1));
  let min=raw-left;
  min=Math.max(0,Math.min(100-span,min));
  let max=min+span;

  if((min+max)/2===raw){
    if(max<100){min+=1;max+=1;}
    else if(min>0){min-=1;max-=1;}
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
