// src/domain/teamConstructorBridge.js
// Temporal bridge between managerial Team/Entrant identity and the technical
// Constructor/Chassis identity used by historical F1 results.
//
// Architectural rule:
// - Team / Entrant is the managerial entity used by the career world.
// - Constructor identity is preserved for historical results and standings.
// - When an exact entrant source is unavailable, constructor-family matching
//   may provide a conservative fallback, explicitly marked as estimated.

import {
  canonicalTeamId,
  canonicalTeamName,
  createTeamIdentityResolver,
  normalizeTeamIdentityName,
} from "./teamIdentity.js";

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
    const value=text(row?.[key]);
    if(value)return value;
  }
  return "";
}

function integer(value){
  const n=Number(scalar(value));
  return Number.isInteger(n)?n:null;
}

export function constructorTechnicalIdentity(nameInput){
  const constructorName=canonicalTeamName(text(nameInput));
  if(!constructorName)return {
    constructor_name:"",
    chassis_name:"",
    engine_name:"",
    constructor_family:"",
  };

  const parts=constructorName
    .split(/\s*[-–—]\s*/)
    .map((part)=>part.trim())
    .filter(Boolean);

  // Ergast-style historic constructor labels generally encode
  // "chassis/constructor - engine" (Lotus-Climax, BRP-BRM, Cooper-Maserati).
  // The first segment is therefore a safe technical family hint, not proof of
  // the managerial entrant.
  const chassisName=parts[0]||constructorName;
  const engineName=parts.length>1?parts.slice(1).join("-"):"";
  return {
    constructor_name:constructorName,
    chassis_name:chassisName,
    engine_name:engineName,
    constructor_family:normalizeTeamIdentityName(chassisName),
  };
}

function constructorIdentity(row,constructorNamesByArchiveId,teamResolver){
  const numericId=integer(row?.constructorId);
  const referenced=numericId!=null?text(constructorNamesByArchiveId?.get(numericId)):"";
  const rawName=first(row,[
    "constructor_name",
    "constructorName",
    "constructor",
    "technical_constructor_name",
  ])||referenced||first(row,["team_name","team"]);

  const technical=constructorTechnicalIdentity(rawName);

  // Preserve an exact historical constructor ID whenever the master already
  // contains it. Do not collapse engine-suffixed constructor identities.
  const exact=teamResolver.resolve({team_name:technical.constructor_name});
  const exactNameMatch=
    exact?.id&&
    normalizeTeamIdentityName(exact?.name)===normalizeTeamIdentityName(technical.constructor_name);

  const directConstructor=canonicalTeamId(first(row,["constructor_id"]));
  const constructorId=
    directConstructor||
    (exactNameMatch?exact.id:"")||
    (numericId!=null?`archive_constructor_${numericId}`:"")||
    (technical.constructor_family?`legacy_constructor_${normalizeTeamIdentityName(technical.constructor_name)}`:"");

  return {
    ...technical,
    constructor_id:constructorId,
  };
}

function entryKey(year,driverId){
  return `${Number(year)}|${text(driverId)}`;
}

function buildEntryIndex(entryRows){
  const byYearDriver=new Map();
  for(const row of Array.isArray(entryRows)?entryRows:[]){
    const year=integer(row?.year??row?.season_year);
    const driverId=first(row,["driver_id","person_id"]);
    if(year==null||!driverId)continue;
    const key=entryKey(year,driverId);
    if(!byYearDriver.has(key))byYearDriver.set(key,[]);
    byYearDriver.get(key).push(row);
  }
  return byYearDriver;
}

function explicitEntrantFromRow(row,teamResolver){
  const explicitId=canonicalTeamId(first(row,[
    "entrant_id",
    "managerial_team_id",
    "entry_team_id",
  ]));
  const explicitName=first(row,[
    "entrant_name",
    "managerial_team_name",
    "entry_team_name",
  ]);

  if(explicitId){
    const resolved=teamResolver.resolve({team_id:explicitId,team_name:explicitName});
    if(resolved.id)return {resolved,basis:"explicit_entrant",confidence:"HIGH"};
  }
  if(explicitName){
    const resolved=teamResolver.resolve({team_name:explicitName});
    if(resolved.id)return {resolved,basis:"explicit_entrant",confidence:"HIGH"};
  }
  return null;
}

function entrantFromEntryList({year,driverId,entryIndex,teamResolver}){
  if(year==null||!driverId)return null;
  const candidates=entryIndex.get(entryKey(year,driverId))||[];
  const resolved=[];
  for(const row of candidates){
    const result=teamResolver.resolve({
      team_id:first(row,["team_id","entrant_id","managerial_team_id"]),
      team_name:first(row,["team_name","entrant_name","managerial_team_name"]),
    });
    if(result.id&&!resolved.some((item)=>item.id===result.id))resolved.push(result);
  }
  if(resolved.length!==1)return null;
  return {resolved:resolved[0],basis:"entry_list_driver",confidence:"HIGH"};
}

function entrantFromConstructorFamily(technical,teamResolver){
  if(!technical?.chassis_name)return null;
  const resolved=teamResolver.resolve({team_name:technical.chassis_name});
  if(!resolved.id)return null;
  return {
    resolved,
    basis:"constructor_family_fallback",
    confidence:"MEDIUM",
  };
}

export function createTeamConstructorBridgeResolver({
  teams=[],
  constructorReference=[],
  entryRows=[],
}={}){
  const teamResolver=createTeamIdentityResolver(teams);
  const refs=Array.isArray(constructorReference)
    ?constructorReference
    :Array.isArray(constructorReference?.constructors)?constructorReference.constructors:[];
  const constructorNamesByArchiveId=new Map(
    refs
      .map((row)=>[integer(row?.constructorId),text(row?.constructorName)])
      .filter(([id,name])=>id!=null&&name)
  );
  const entryIndex=buildEntryIndex(entryRows);

  const resolve=(row,options={})=>{
    const year=integer(row?.year??row?.season_year??options?.year);
    const driverId=first(options,["driverId","driver_id"])||first(row,["driver_id","person_id"]);
    const constructor=constructorIdentity(row,constructorNamesByArchiveId,teamResolver);

    let entrant=explicitEntrantFromRow(row,teamResolver);
    if(!entrant){
      entrant=entrantFromEntryList({year,driverId,entryIndex,teamResolver});
    }
    if(!entrant){
      entrant=entrantFromConstructorFamily(constructor,teamResolver);
    }

    if(!entrant){
      // Last-resort compatibility: if the result already carries a canonical
      // managerial team ID use it, but mark it as low-confidence because many
      // historic imports used team_id for constructor identity.
      const directTeam=canonicalTeamId(first(row,["team_id"]));
      if(directTeam){
        const resolved=teamResolver.resolve({team_id:directTeam});
        if(resolved.id){
          entrant={resolved,basis:"legacy_team_id_fallback",confidence:"LOW"};
        }
      }
    }

    return {
      year,
      team_id:entrant?.resolved?.id||"",
      team_name:entrant?.resolved?.name||"",
      entrant_id:entrant?.resolved?.id||"",
      entrant_name:entrant?.resolved?.name||"",
      constructor_id:constructor.constructor_id,
      constructor_name:constructor.constructor_name,
      chassis_name:constructor.chassis_name,
      engine_name:constructor.engine_name,
      relation_basis:entrant?.basis||"unresolved",
      confidence:entrant?.confidence||"LOW",
      exact_entrant:Boolean(entrant&&["explicit_entrant","entry_list_driver"].includes(entrant.basis)),
    };
  };

  return Object.freeze({resolve});
}

export function resolveTeamConstructorLink(row,context={}){
  return createTeamConstructorBridgeResolver(context).resolve(row,context);
}

export function groupBridgeByTeamSeason(rows){
  const byKey=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const year=integer(row?.year);
    const teamId=canonicalTeamId(row?.team_id);
    if(year==null||!teamId)continue;
    const key=`${year}|${teamId}`;
    if(!byKey.has(key)){
      byKey.set(key,{
        year,
        team_id:teamId,
        team_name:canonicalTeamName(row?.team_name)||teamId,
        constructor_ids:new Set(),
        constructor_names:new Set(),
        chassis_names:new Set(),
        engine_names:new Set(),
        relation_basis:new Set(),
        confidence:new Set(),
      });
    }
    const rec=byKey.get(key);
    if(row?.constructor_id)rec.constructor_ids.add(String(row.constructor_id));
    if(row?.constructor_name)rec.constructor_names.add(String(row.constructor_name));
    if(row?.chassis_name)rec.chassis_names.add(String(row.chassis_name));
    if(row?.engine_name)rec.engine_names.add(String(row.engine_name));
    if(row?.relation_basis)rec.relation_basis.add(String(row.relation_basis));
    if(row?.confidence)rec.confidence.add(String(row.confidence));
  }

  return [...byKey.values()].map((rec)=>({
    year:rec.year,
    team_id:rec.team_id,
    team_name:rec.team_name,
    constructor_ids:[...rec.constructor_ids].sort(),
    constructor_names:[...rec.constructor_names].sort(),
    chassis_names:[...rec.chassis_names].sort(),
    engine_names:[...rec.engine_names].sort(),
    relation_basis:[...rec.relation_basis].sort(),
    confidence:[...rec.confidence].sort(),
  }));
}
