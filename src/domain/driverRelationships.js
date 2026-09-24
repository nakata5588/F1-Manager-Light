// src/domain/driverRelationships.js
import { activeDriverContracts, driverIdOf, teamIdOf } from "./driverContracts.js";
import { activeStaffContracts, staffIdOf } from "./liveContracts.js";

export const DRIVER_RELATIONSHIP_VERSION=1;
export const NEUTRAL_RELATIONSHIP_SCORE=50;

const clamp100=(value)=>Math.max(0,Math.min(100,Number(value)||0));
const text=(value)=>String(value??"").trim();

export function relationshipKey(driverId,targetType,targetId){
  return [text(driverId),text(targetType),text(targetId)].join("|");
}

export function relationshipBand(value){
  const score=Number(value);
  if(!Number.isFinite(score))return "unknown";
  if(score>=80)return "excellent";
  if(score>=65)return "positive";
  if(score>=45)return "neutral";
  if(score>=30)return "strained";
  return "poor";
}

export function relationshipScore(record){
  if(!record||typeof record!=="object")return NEUTRAL_RELATIONSHIP_SCORE;
  const values=["trust","respect","affinity","satisfaction"]
    .map((key)=>Number(record?.[key]))
    .filter(Number.isFinite);
  if(!values.length)return NEUTRAL_RELATIONSHIP_SCORE;
  return Math.round((values.reduce((sum,value)=>sum+value,0)/values.length)*10)/10;
}

export function emptyDriverRelationships(){
  return {version:DRIVER_RELATIONSHIP_VERSION,relations:{},log:[]};
}

function roleOf(contract){
  return text(contract?.role??contract?.position??contract?.contract_role).toLowerCase().replace(/[ -]+/g,"_");
}

function selectedDriverIds(gs){
  return (Array.isArray(gs?.selectedDrivers)?gs.selectedDrivers:[])
    .map((entry)=>text(entry?.driver_id??entry?.person_id??entry?.id??entry))
    .filter(Boolean);
}

function currentDriverTeams(gs){
  const map=new Map();
  for(const contract of activeDriverContracts(gs)){
    const driverId=driverIdOf(contract);
    const teamId=teamIdOf(contract);
    if(driverId&&teamId)map.set(driverId,teamId);
  }
  const userTeamId=text(gs?.team?.team_id??gs?.team?.id);
  if(userTeamId){
    for(const driverId of selectedDriverIds(gs)){
      if(!map.has(driverId))map.set(driverId,userTeamId);
    }
  }
  return map;
}

function raceDriversByTeam(gs){
  const grouped=new Map();
  for(const contract of activeDriverContracts(gs,{raceOnly:true})){
    const driverId=driverIdOf(contract);
    const teamId=teamIdOf(contract);
    if(!driverId||!teamId)continue;
    if(!grouped.has(teamId))grouped.set(teamId,[]);
    grouped.get(teamId).push(driverId);
  }
  return grouped;
}

function neutralRecord({driverId,targetType,targetId,teamId=null,dateISO=null,source="career_neutral"}){
  const record={
    driver_id:text(driverId),
    target_type:text(targetType),
    target_id:text(targetId),
    team_id:teamId?text(teamId):null,
    trust:NEUTRAL_RELATIONSHIP_SCORE,
    respect:NEUTRAL_RELATIONSHIP_SCORE,
    affinity:NEUTRAL_RELATIONSHIP_SCORE,
    satisfaction:NEUTRAL_RELATIONSHIP_SCORE,
    status:"neutral",
    active:true,
    source,
    created_at:dateISO||null,
    updated_at:dateISO||null,
  };
  record.score=relationshipScore(record);
  return record;
}

function normalizeContainer(gs){
  const raw=gs?.driverRelationships;
  const relations=raw?.relations&&typeof raw.relations==="object"&&!Array.isArray(raw.relations)
    ?{...raw.relations}
    :{};
  return {
    version:DRIVER_RELATIONSHIP_VERSION,
    relations,
    log:Array.isArray(raw?.log)?raw.log.slice():[],
  };
}

export function synchronizeDriverRelationships(gs,{source="relationship_foundation"}={}){
  if(!gs||typeof gs!=="object")return gs;
  const container=normalizeContainer(gs);
  const dateISO=text(gs?.currentDateISO).slice(0,10)||null;
  const driverTeams=currentDriverTeams(gs);
  const raceByTeam=raceDriversByTeam(gs);
  const userTeamId=text(gs?.team?.team_id??gs?.team?.id);

  for(const [key,record] of Object.entries(container.relations)){
    if(record&&typeof record==="object")container.relations[key]={...record,active:false};
  }

  const add=(driverId,targetType,targetId,teamId)=>{
    const did=text(driverId);
    const tid=text(targetId);
    if(!did||!targetType||!tid)return;
    const key=relationshipKey(did,targetType,tid);
    if(container.relations[key]){
      container.relations[key]={
        ...container.relations[key],
        active:true,
        team_id:teamId?text(teamId):container.relations[key]?.team_id??null,
      };
      return;
    }
    container.relations[key]=neutralRecord({
      driverId:did,targetType,targetId:tid,teamId,dateISO,source,
    });
  };

  for(const [driverId,teamId] of driverTeams){
    add(driverId,"team",teamId,teamId);
    if(userTeamId&&teamId===userTeamId)add(driverId,"manager","player_manager",teamId);
  }

  for(const [teamId,driverIds] of raceByTeam){
    for(const driverId of driverIds){
      for(const teammateId of driverIds){
        if(teammateId!==driverId)add(driverId,"teammate",teammateId,teamId);
      }
    }
  }

  const staffByTeam=new Map();
  for(const contract of activeStaffContracts(gs)){
    const teamId=text(contract?.team_id??contract?.constructor_id??contract?.team??contract?.constructor);
    const staffId=staffIdOf(contract);
    const role=roleOf(contract);
    if(!teamId||!staffId||!role)continue;
    if(!staffByTeam.has(teamId))staffByTeam.set(teamId,[]);
    staffByTeam.get(teamId).push({staffId,role});
  }

  for(const [driverId,teamId] of driverTeams){
    for(const staff of staffByTeam.get(teamId)||[]){
      if(staff.role==="race_engineer"||staff.role.includes("race_engineer")){
        add(driverId,"race_engineer",staff.staffId,teamId);
      }
      if(staff.role==="team_principal"||staff.role.includes("team_principal")){
        add(driverId,"team_principal",staff.staffId,teamId);
      }
    }
  }

  for(const [key,record] of Object.entries(container.relations)){
    if(!record||typeof record!=="object")continue;
    const normalized={
      ...record,
      trust:clamp100(record.trust??NEUTRAL_RELATIONSHIP_SCORE),
      respect:clamp100(record.respect??NEUTRAL_RELATIONSHIP_SCORE),
      affinity:clamp100(record.affinity??NEUTRAL_RELATIONSHIP_SCORE),
      satisfaction:clamp100(record.satisfaction??NEUTRAL_RELATIONSHIP_SCORE),
    };
    normalized.score=relationshipScore(normalized);
    normalized.status=relationshipBand(normalized.score);
    container.relations[key]=normalized;
  }

  return {...gs,driverRelationships:container};
}

export function driverRelationshipRecords(gs,driverId){
  const did=text(driverId);
  return Object.values(gs?.driverRelationships?.relations||{})
    .filter((record)=>text(record?.driver_id)===did);
}

export function driverRelationship(gs,driverId,targetType,targetId){
  return gs?.driverRelationships?.relations?.[relationshipKey(driverId,targetType,targetId)]||null;
}
