// src/domain/teamIdentity.js
// Canonical managerial team identity aliases.
//
// These aliases collapse historical naming duplicates that refer to the same
// F1 team. They must stay exact and conservative: Lotus F1 and engine-suffixed
// historical constructor labels remain separate entities.

export const TEAM_ID_ALIASES=Object.freeze({
  t_0040:"t_0005", // "Team Lotus" duplicate -> canonical "Lotus"
});

export const TEAM_NAME_ALIASES=Object.freeze({
  "team lotus":"Lotus",
});

function identityScalar(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(Object.prototype.hasOwnProperty.call(value,"result"))return identityScalar(value.result);
    if(Object.prototype.hasOwnProperty.call(value,"value"))return identityScalar(value.value);
  }
  return value;
}

function mapIdentityValue(value,mapper){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(Object.prototype.hasOwnProperty.call(value,"result")){
      return {...value,result:mapper(value.result)};
    }
    if(Object.prototype.hasOwnProperty.call(value,"value")){
      return {...value,value:mapper(value.value)};
    }
    return value;
  }
  return mapper(value);
}

export function canonicalTeamId(value){
  const raw=String(identityScalar(value)??"").trim();
  if(!raw)return raw;
  return TEAM_ID_ALIASES[raw]||raw;
}

export function canonicalTeamName(value){
  const raw=String(identityScalar(value)??"").trim();
  if(!raw)return raw;
  return TEAM_NAME_ALIASES[raw.toLowerCase()]||raw;
}

export function canonicalTeamIdentity(row){
  if(!row||typeof row!=="object")return row;
  const out={...row};

  for(const key of Object.keys(out)){
    if(key==="team_id"||key==="constructor_id"||key==="primary_team_id"||key.endsWith("_team_id")){
      out[key]=mapIdentityValue(out[key],canonicalTeamId);
      continue;
    }
    if(
      key==="team_name"||
      key==="primary_team_name"||
      key.endsWith("_team_name")
    ){
      out[key]=mapIdentityValue(out[key],canonicalTeamName);
    }
  }

  const teamsValue=identityScalar(out.teams);
  if(typeof teamsValue==="string"&&teamsValue.trim().toLowerCase()==="team lotus"){
    out.teams=mapIdentityValue(out.teams,canonicalTeamName);
  }
  return out;
}

export function mergeCanonicalTeamRows(rows){
  const byId=new Map();
  for(const source of Array.isArray(rows)?rows:[]){
    const row=canonicalTeamIdentity(source);
    const id=canonicalTeamId(row?.team_id??row?.constructor_id??row?.id);
    if(!id){
      continue;
    }
    const normalized={...row,team_id:id};
    const prev=byId.get(id);
    if(!prev){
      byId.set(id,normalized);
      continue;
    }
    const merged={...prev};
    for(const [key,value] of Object.entries(normalized)){
      if((merged[key]===undefined||merged[key]===null||merged[key]==="")&&value!==undefined&&value!==null&&value!==""){
        merged[key]=value;
      }
    }
    merged.team_id=id;
    merged.team_name=canonicalTeamName(merged.team_name);
    byId.set(id,merged);
  }
  return [...byId.values()];
}
