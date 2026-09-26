// src/domain/managerProfileStorage.js
// Reusable Team Manager drafts for New Game.
// Stored outside save files so the same personal profile can be reused across careers.

export const MANAGER_PROFILE_STORAGE_KEY="f1ml_manager_profiles_v1";
const STORE_VERSION=1;
const MAX_SAVED_PROFILES=8;

const PROFILE_FIELDS=Object.freeze([
  "first_name",
  "last_name",
  "nationality_name",
  "nationality_code",
  "date_of_birth",
  "place_of_birth",
  "portrait_data_url",
  "portrait_file_name",
  "background",
  "experience_level",
]);

function defaultStore(){
  return {version:STORE_VERSION,lastUsed:null,profiles:[]};
}

function browserStorage(){
  try{return typeof globalThis!=="undefined"?globalThis.localStorage:null;}catch{return null;}
}

export function sanitizeManagerDraft(input){
  const source=input&&typeof input==="object"?input:{};
  const out={};
  for(const key of PROFILE_FIELDS){
    const value=source[key];
    if(value===undefined)continue;
    out[key]=value===null?null:String(value);
  }
  if(out.nationality_code)out.nationality_code=out.nationality_code.toUpperCase().slice(0,3);
  return out;
}

export function managerDraftLabel(profile){
  const first=String(profile?.first_name||"").trim();
  const last=String(profile?.last_name||"").trim();
  return [first,last].filter(Boolean).join(" ")||"Team Manager";
}

export function managerDraftId(profile){
  const base=[
    managerDraftLabel(profile),
    String(profile?.date_of_birth||""),
    String(profile?.nationality_name||""),
  ].join("|").toLowerCase();
  let hash=2166136261;
  for(const ch of base){
    hash^=ch.charCodeAt(0);
    hash=Math.imul(hash,16777619);
  }
  return "manager_"+(hash>>>0).toString(16);
}

export function readManagerProfileStore(storage=browserStorage()){
  if(!storage)return defaultStore();
  try{
    const raw=storage.getItem(MANAGER_PROFILE_STORAGE_KEY);
    if(!raw)return defaultStore();
    const parsed=JSON.parse(raw);
    return {
      version:STORE_VERSION,
      lastUsed:parsed?.lastUsed?sanitizeManagerDraft(parsed.lastUsed):null,
      profiles:Array.isArray(parsed?.profiles)
        ?parsed.profiles
          .filter((row)=>row&&typeof row==="object")
          .slice(0,MAX_SAVED_PROFILES)
          .map((row)=>({
            id:String(row.id||managerDraftId(row.profile||row)),
            label:String(row.label||managerDraftLabel(row.profile||row)),
            profile:sanitizeManagerDraft(row.profile||row),
            updatedAt:row.updatedAt?String(row.updatedAt):null,
          }))
        :[],
    };
  }catch{
    return defaultStore();
  }
}

function writeStore(store,storage=browserStorage()){
  if(!storage)return {ok:false,store,error:"Browser storage is unavailable."};
  try{
    storage.setItem(MANAGER_PROFILE_STORAGE_KEY,JSON.stringify(store));
    return {ok:true,store,error:null};
  }catch(error){
    return {ok:false,store,error:String(error?.message||error)};
  }
}

export function rememberLastUsedManagerProfile(profile,storage=browserStorage()){
  const current=readManagerProfileStore(storage);
  const store={...current,lastUsed:sanitizeManagerDraft(profile)};
  return writeStore(store,storage);
}

export function saveManagerProfile(profile,storage=browserStorage()){
  const current=readManagerProfileStore(storage);
  const draft=sanitizeManagerDraft(profile);
  const id=managerDraftId(draft);
  const row={
    id,
    label:managerDraftLabel(draft),
    profile:draft,
    updatedAt:new Date().toISOString(),
  };
  const profiles=[
    row,
    ...current.profiles.filter((item)=>String(item.id)!==id),
  ].slice(0,MAX_SAVED_PROFILES);
  return writeStore({...current,profiles},storage);
}

export function deleteManagerProfile(id,storage=browserStorage()){
  const current=readManagerProfileStore(storage);
  const profiles=current.profiles.filter((item)=>String(item.id)!==String(id));
  return writeStore({...current,profiles},storage);
}
