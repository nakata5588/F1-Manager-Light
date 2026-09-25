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

export function canonicalTeamId(value){
  const raw=String(value??"").trim();
  if(!raw)return raw;
  return TEAM_ID_ALIASES[raw]||raw;
}

export function canonicalTeamName(value){
  const raw=String(value??"").trim();
  if(!raw)return raw;
  return TEAM_NAME_ALIASES[raw.toLowerCase()]||raw;
}

export function canonicalTeamIdentity(row){
  if(!row||typeof row!=="object")return row;
  const out={...row};

  for(const key of Object.keys(out)){
    if(key==="team_id"||key==="constructor_id"||key==="primary_team_id"||key.endsWith("_team_id")){
      out[key]=canonicalTeamId(out[key]);
      continue;
    }
    if(
      key==="team_name"||
      key==="primary_team_name"||
      key.endsWith("_team_name")
    ){
      out[key]=canonicalTeamName(out[key]);
    }
  }

  if(typeof out.teams==="string"&&out.teams.trim().toLowerCase()==="team lotus"){
    out.teams="Lotus";
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
