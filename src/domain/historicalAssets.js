// src/domain/historicalAssets.js
// Fast runtime resolver for driver portraits, staff portraits and team logos.
//
// The filesystem is scanned only by scripts/build-historical-assets.mjs before
// dev/build. Runtime resolution is an in-memory object lookup plus a binary
// search through the usually tiny year timeline.
import { HISTORICAL_ASSET_MANIFEST } from "../generated/historicalAssets.js";
import { visualAssetOverrideSet } from "./visualAssetOverrides.js";

const EMPTY_SET=Object.freeze({default:"",history:Object.freeze([])});
const TYPE_ALIASES=Object.freeze({
  driver:"drivers",
  drivers:"drivers",
  staff:"staff",
  team:"teams",
  teams:"teams",
  logo:"teams",
  logos:"teams",
});

export function normalizeHistoricalAssetAlias(value){
  return String(value??"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"");
}

function normalizedType(type){
  return TYPE_ALIASES[String(type??"").toLowerCase()]||String(type??"").toLowerCase();
}

function aliasList(input){
  const rows=Array.isArray(input)?input:[input];
  const out=[];
  const seen=new Set();
  for(const value of rows){
    const key=normalizeHistoricalAssetAlias(value);
    if(!key||seen.has(key))continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function historicalAssetSet(type,aliases){
  const bucket=HISTORICAL_ASSET_MANIFEST?.[normalizedType(type)]||{};
  for(const key of aliasList(aliases)){
    const row=bucket[key];
    if(row)return row;
  }
  return EMPTY_SET;
}

function latestAtOrBefore(history,year){
  let lo=0;
  let hi=history.length-1;
  let best=-1;
  while(lo<=hi){
    const mid=(lo+hi)>>1;
    const rowYear=Number(history[mid]?.year);
    if(rowYear<=year){
      best=mid;
      lo=mid+1;
    }else{
      hi=mid-1;
    }
  }
  return best;
}

function pushUnique(out,seen,value){
  const path=String(value||"").trim();
  if(!path||seen.has(path))return;
  seen.add(path);
  out.push(path);
}

export function historicalAssetCandidatesFromSet(set,activeYear,fallbacks=[]){
  const history=Array.isArray(set?.history)?set.history:[];
  const out=[];
  const seen=new Set();
  const year=Number(activeYear);

  if(Number.isFinite(year)&&history.length){
    const pastIndex=latestAtOrBefore(history,year);
    if(pastIndex>=0)pushUnique(out,seen,history[pastIndex]?.path);

    // A timeless default is the correct pre-history representation when it
    // exists. Only use the nearest future image if no default is available.
    pushUnique(out,seen,set?.default);
    if(pastIndex<0)pushUnique(out,seen,history[0]?.path);

    // Extra fallbacks make a broken/missing selected file recover gracefully.
    for(let i=history.length-1;i>=0;i--)pushUnique(out,seen,history[i]?.path);
  }else{
    pushUnique(out,seen,set?.default);
    for(let i=history.length-1;i>=0;i--)pushUnique(out,seen,history[i]?.path);
  }

  if(!history.length)pushUnique(out,seen,set?.default);

  const fallbackRows=Array.isArray(fallbacks)?fallbacks:[fallbacks];
  for(const fallback of fallbackRows)pushUnique(out,seen,fallback);

  return out;
}

export function historicalAssetCandidates(type,aliases,activeYear,fallbacks=[]){
  return historicalAssetCandidatesFromSet(
    historicalAssetSet(type,aliases),
    activeYear,
    fallbacks
  );
}
export function mergeHistoricalAssetSets(baseSet,overrideSet){
  const base=baseSet&&typeof baseSet==="object"?baseSet:EMPTY_SET;
  const override=overrideSet&&typeof overrideSet==="object"?overrideSet:null;
  if(!override)return base;

  const historyByYear=new Map();
  for(const row of Array.isArray(base.history)?base.history:[]){
    const year=Number(row?.year);
    if(Number.isFinite(year)&&row?.path)historyByYear.set(year,{year,path:String(row.path)});
  }
  for(const row of Array.isArray(override.history)?override.history:[]){
    const year=Number(row?.year);
    if(Number.isFinite(year)&&row?.path)historyByYear.set(year,{year,path:String(row.path)});
  }

  return {
    default:String(override.default||base.default||""),
    history:[...historyByYear.values()].sort((a,b)=>a.year-b.year),
  };
}

export function historicalAssetCandidatesWithOverrides(type,aliases,activeYear,overrides,entityId,fallbacks=[]){
  const base=historicalAssetSet(type,aliases);
  const override=visualAssetOverrideSet(overrides,type,entityId);
  return historicalAssetCandidatesFromSet(
    mergeHistoricalAssetSets(base,override),
    activeYear,
    fallbacks
  );
}


export function resolveHistoricalAsset(type,aliases,activeYear,fallback=""){
  return historicalAssetCandidates(type,aliases,activeYear,fallback)[0]||"";
}

export function historicalAssetTimeline(type,aliases){
  const set=historicalAssetSet(type,aliases);
  return Array.isArray(set?.history)?set.history:[];
}

export function historicalAssetManifest(){
  return HISTORICAL_ASSET_MANIFEST;
}
