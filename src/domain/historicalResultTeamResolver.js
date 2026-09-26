// src/domain/historicalResultTeamResolver.js
// Shared reconciliation for historical race-result team identity.
//
// This intentionally mirrors the long-standing resolver used by the driver
// history and race-results archive builders:
//   constructorId -> constructor_id_map -> historical name -> managerial team.
//
// Technical constructor/chassis identity is NOT produced here. Consumers that
// need it (for example Team/Entrant <-> Constructor bridge) must preserve it
// separately instead of promoting it into a managerial Team.

import { canonicalTeamId, canonicalTeamName } from "./teamIdentity.js";

function scalar(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(Object.prototype.hasOwnProperty.call(value,"result"))return scalar(value.result);
    if(Object.prototype.hasOwnProperty.call(value,"value"))return scalar(value.value);
    if(Object.prototype.hasOwnProperty.call(value,"text"))return scalar(value.text);
  }
  return value;
}

function text(value){
  const raw=scalar(value);
  if(raw===undefined||raw===null)return "";
  return String(raw).trim();
}

function first(row,keys){
  for(const key of keys){
    if(!row||!Object.prototype.hasOwnProperty.call(row,key))continue;
    const value=text(row[key]);
    if(value)return value;
  }
  return "";
}

function integer(value){
  const n=Number(scalar(value));
  return Number.isInteger(n)?n:null;
}

function canon(value){
  return canonicalTeamName(text(value))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}

function referenceRows(constructorReference){
  if(Array.isArray(constructorReference))return constructorReference;
  return Array.isArray(constructorReference?.constructors)
    ?constructorReference.constructors
    :[];
}

export function historicalManagerialTeamName(name,teamNameToId=new Map()){
  const raw=canonicalTeamName(text(name));
  if(!raw)return "";

  if(/^team lotus$/i.test(raw))return "Lotus";

  const dash=raw.indexOf("-");
  if(dash>0){
    const base=raw.slice(0,dash).trim();
    if(base&&teamNameToId.has(canon(base)))return base;
  }

  return raw;
}

export function createHistoricalResultTeamResolver({
  teams=[],
  constructorReference=[],
}={}){
  const teamNameToId=new Map();
  const teamNameById=new Map();

  for(const team of Array.isArray(teams)?teams:[]){
    const id=canonicalTeamId(first(team,["team_id","id","constructor_id"]));
    if(!id)continue;

    const name=canonicalTeamName(first(team,["team_name","name","short_name"])||id);
    if(!teamNameById.has(id))teamNameById.set(id,name);

    for(const candidate of [
      team?.team_name,
      team?.name,
      team?.short_name,
      team?.official_name,
      team?.team_official_name,
    ]){
      const key=canon(candidate);
      if(key&&!teamNameToId.has(key))teamNameToId.set(key,id);
    }
  }

  const constructorIdToName=new Map(
    referenceRows(constructorReference)
      .map((row)=>[
        integer(row?.constructorId),
        canonicalTeamName(text(row?.constructorName)),
      ])
      .filter(([id,name])=>id!=null&&name)
  );

  const resolve=(row,options={})=>{
    const ignoreDirectIds=Boolean(options?.ignoreDirectIds);
    const fallback=String(options?.fallback||"archive");

    const directRaw=first(row,["team_id","constructor_id"]);
    const direct=canonicalTeamId(directRaw);

    // Preserve the established resolver behaviour for normal historical
    // consumers: a known direct ID wins. The Team/Constructor bridge can set
    // ignoreDirectIds=true because those fields are overloaded in legacy
    // race-results imports and may describe the technical constructor.
    if(!ignoreDirectIds&&direct&&teamNameById.has(direct)){
      return {
        id:direct,
        name:teamNameById.get(direct)||direct,
        known:true,
        basis:"direct_id",
        raw_name:"",
        reference_name:"",
      };
    }

    const constructorId=integer(row?.constructorId??row?.constructorID);
    const referenceName=constructorId!=null
      ?(constructorIdToName.get(constructorId)||"")
      :"";
    const rawName=first(row,[
      "team_name",
      "constructor_name",
      "constructorName",
      "constructor",
      "team",
    ])||referenceName;

    const managerialName=historicalManagerialTeamName(rawName,teamNameToId);
    const mapped=teamNameToId.get(canon(managerialName));
    if(mapped){
      return {
        id:canonicalTeamId(mapped),
        name:teamNameById.get(canonicalTeamId(mapped))||canonicalTeamName(managerialName)||mapped,
        known:true,
        basis:"historical_name",
        raw_name:rawName,
        reference_name:referenceName,
      };
    }

    if(!ignoreDirectIds&&direct){
      return {
        id:direct,
        name:teamNameById.get(direct)||canonicalTeamName(rawName)||direct,
        known:teamNameById.has(direct),
        basis:"direct_id_fallback",
        raw_name:rawName,
        reference_name:referenceName,
      };
    }

    const fallbackId=constructorId!=null
      ?`archive_constructor_${constructorId}`
      :(fallback==="raw"?rawName:"");

    return {
      id:fallbackId,
      name:canonicalTeamName(rawName)||fallbackId,
      known:false,
      basis:"unresolved",
      raw_name:rawName,
      reference_name:referenceName,
    };
  };

  return Object.freeze({
    resolve,
    resolveId:(row,options={})=>resolve(row,options).id,
    nameForId:(id)=>teamNameById.get(canonicalTeamId(id))||"",
    isKnownId:(id)=>teamNameById.has(canonicalTeamId(id)),
  });
}
