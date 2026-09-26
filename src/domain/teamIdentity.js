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
    if(Object.prototype.hasOwnProperty.call(value,"text"))return identityScalar(value.text);
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

// Runtime/gameplay datasets canonicalize managerial Team/Entrant identity
// without rewriting technical Constructor/Chassis identity.
export function canonicalManagerialTeamIdentity(row){
  if(!row||typeof row!=="object"||Array.isArray(row))return row;
  const out={...row};
  const idFields=["team_id","entrant_id","managerial_team_id","entry_team_id","primary_team_id"];
  const nameFields=["team_name","entrant_name","managerial_team_name","entry_team_name","primary_team_name"];

  for(const key of idFields){
    if(Object.prototype.hasOwnProperty.call(out,key)){
      out[key]=mapIdentityValue(out[key],canonicalTeamId);
    }
  }
  for(const key of nameFields){
    if(Object.prototype.hasOwnProperty.call(out,key)){
      out[key]=mapIdentityValue(out[key],canonicalTeamName);
    }
  }

  if(Object.prototype.hasOwnProperty.call(out,"team")){
    out.team=mapIdentityValue(out.team,(value)=>{
      const raw=String(identityScalar(value)??"").trim();
      if(!raw)return raw;
      const id=canonicalTeamId(raw);
      return id!==raw?id:canonicalTeamName(raw);
    });
  }
  return out;
}

export function canonicalManagerialTeamRows(rows){
  return (Array.isArray(rows)?rows:[]).map(canonicalManagerialTeamIdentity);
}


const TEAM_ID_FIELDS=Object.freeze(["team_id","constructor_id","teamId","constructorId"]);
const TEAM_NAME_FIELDS=Object.freeze([
  "team_name",
  "constructor_name",
  "constructorName",
  "teamName",
  "team",
  "constructor",
]);

function identityText(value){
  const raw=identityScalar(value);
  if(raw===undefined||raw===null||raw==="")return "";
  if(typeof raw==="object")return "";
  return String(raw).trim();
}

function firstIdentityText(row,fields){
  for(const field of fields){
    const value=identityText(row?.[field]);
    if(value)return value;
  }
  return "";
}

export function normalizeTeamIdentityName(value){
  return canonicalTeamName(identityText(value))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}

function teamCandidateNames(team){
  const values=[
    team?.team_name,
    team?.name,
    team?.short_name,
    team?.official_name,
    team?.team_official_name,
  ];
  const seen=new Set();
  const names=[];
  for(const value of values){
    const label=canonicalTeamName(identityText(value));
    const key=normalizeTeamIdentityName(label);
    if(!key||seen.has(key))continue;
    seen.add(key);
    names.push({label,key});
  }
  return names;
}

function resolvedCandidate(candidate,match,rawName="",ambiguousCandidateIds=[]){
  return {
    id:candidate?.id||"",
    name:candidate?.name||canonicalTeamName(rawName),
    match,
    raw_name:identityText(rawName),
    ambiguous_candidate_ids:ambiguousCandidateIds,
  };
}

export function createTeamIdentityResolver(teams=[]){
  const source=Array.isArray(teams)?teams:[];
  const byId=new Map();
  const byName=new Map();

  for(const team of source){
    if(!team||typeof team!=="object")continue;
    const id=canonicalTeamId(team?.team_id??team?.constructor_id??team?.id);
    if(!id)continue;
    const names=teamCandidateNames(team);
    const name=canonicalTeamName(
      identityText(team?.team_name??team?.name??team?.short_name??id)
    )||id;
    const rawId=identityText(team?.team_id??team?.constructor_id??team?.id);
    const candidate={team,id,name,names,rawId,canonicalSource:rawId===id};
    const existing=byId.get(id);
    if(!existing||(!existing.canonicalSource&&candidate.canonicalSource))byId.set(id,candidate);
    for(const entry of names){
      if(!byName.has(entry.key))byName.set(entry.key,new Set());
      byName.get(entry.key).add(id);
    }
  }

  const resolve=(row,options={})=>{
    const directRaw=firstIdentityText(row,TEAM_ID_FIELDS);
    const direct=canonicalTeamId(directRaw);
    if(direct&&byId.has(direct)){
      return resolvedCandidate(byId.get(direct),"direct_id");
    }

    const rawNames=[];
    for(const field of TEAM_NAME_FIELDS){
      const value=identityText(row?.[field]);
      if(value)rawNames.push(value);
    }
    const fallbackName=identityText(options?.fallbackName);
    if(fallbackName)rawNames.push(fallbackName);

    const exactAmbiguous=new Set();
    for(const rawName of rawNames){
      const key=normalizeTeamIdentityName(rawName);
      if(!key)continue;
      const ids=byName.get(key);
      if(ids?.size===1){
        const id=[...ids][0];
        return resolvedCandidate(byId.get(id),"exact_name",rawName);
      }
      if(ids?.size>1)for(const id of ids)exactAmbiguous.add(id);
    }

    // Historical imports sometimes include founder/sponsor prefixes
    // (for example "Walter Wolf" for the canonical "Wolf" team). Fuzzy
    // reconciliation is accepted only when every match points to one unique
    // canonical ID, so labels such as "Haas Lola" are never guessed.
    const fuzzyIds=new Set();
    let fuzzyRawName="";
    for(const rawName of rawNames){
      const wanted=normalizeTeamIdentityName(rawName);
      if(wanted.length<4)continue;
      for(const candidate of byId.values()){
        if(candidate.names.some((entry)=>
          entry.key.length>=4&&(wanted.includes(entry.key)||entry.key.includes(wanted))
        )){
          fuzzyIds.add(candidate.id);
          fuzzyRawName=fuzzyRawName||rawName;
        }
      }
    }
    if(fuzzyIds.size===1){
      const id=[...fuzzyIds][0];
      return resolvedCandidate(byId.get(id),"fuzzy_name",fuzzyRawName);
    }

    const unresolvedName=rawNames[0]||"";
    const ambiguous=[...new Set([...exactAmbiguous,...fuzzyIds])].sort();
    return {
      id:direct||"",
      name:canonicalTeamName(unresolvedName),
      match:direct?"unresolved_id":(ambiguous.length?"ambiguous_name":(unresolvedName?"unresolved_name":"unresolved")),
      raw_name:unresolvedName,
      ambiguous_candidate_ids:ambiguous,
    };
  };

  return Object.freeze({
    resolve,
    resolveId:(row,options={})=>resolve(row,options).id,
  });
}

export function resolveHistoricalTeamIdentity(row,teams=[],options={}){
  return createTeamIdentityResolver(teams).resolve(row,options);
}

export function resolveHistoricalTeamId(row,teams=[],options={}){
  return resolveHistoricalTeamIdentity(row,teams,options).id;
}

export function canonicalHistoricalTeam(row,teams=[],options={}){
  const resolved=resolveHistoricalTeamIdentity(row,teams,options);
  return {id:resolved.id,name:resolved.name};
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
