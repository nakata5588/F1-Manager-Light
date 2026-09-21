// src/domain/liveContracts.js
// Canonical helpers for career-time contracts. Once a career has a live
// collection, even an empty one, historical db* rows must not be resurrected.

export function unwrapValue(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if("error" in value && !("result" in value) && !("value" in value) && !("text" in value))return null;
    if("result" in value)return unwrapValue(value.result);
    if("value" in value)return unwrapValue(value.value);
    if("text" in value)return unwrapValue(value.text);
  }
  return value;
}

export function pickValue(obj,keys,fallback=undefined){
  for(const key of keys){
    const value=unwrapValue(obj?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
}

export function collectionRows(value){
  const raw=unwrapValue(value);
  if(Array.isArray(raw))return raw;
  if(!raw||typeof raw!=="object")return [];
  for(const key of ["items","rows","list","data"]){
    if(Array.isArray(raw[key]))return raw[key];
  }
  return Object.values(raw).filter((row)=>row&&typeof row==="object"&&!Array.isArray(row));
}

export function preferLiveRows(gs,liveKey,dbKey){
  const hasLive=Boolean(
    gs &&
    Object.prototype.hasOwnProperty.call(gs,liveKey) &&
    gs[liveKey]!==undefined &&
    gs[liveKey]!==null
  );
  return collectionRows(hasLive?gs[liveKey]:gs?.[dbKey]);
}

export function contractEndYear(contract,fallbackYear=NaN){
  const value=Number(pickValue(contract,["contract_until_year","contract_until","end_year"],fallbackYear));
  return Number.isFinite(value)?value:Number(fallbackYear);
}

export function contractStartYear(contract,fallbackYear=NaN){
  const direct=Number(pickValue(contract,["year","season_year"],fallbackYear));
  const value=Number(pickValue(contract,["contract_start_year","start_year"],direct));
  return Number.isFinite(value)?value:(Number.isFinite(direct)?direct:Number(fallbackYear));
}

export function contractStatus(contract){
  return String(pickValue(contract,["status"],"active")).trim().toLowerCase();
}

export function contractActiveForYear(contract,year){
  if(!contract)return false;
  if(["terminated","expired","released","inactive","void","deceased"].includes(contractStatus(contract)))return false;

  const direct=Number(pickValue(contract,["year","season_year"],NaN));
  const start=contractStartYear(contract,direct);
  const end=contractEndYear(contract,direct);
  const y=Number(year);
  if(!Number.isFinite(y))return true;

  const lo=Number.isFinite(start)?start:(Number.isFinite(direct)?direct:-Infinity);
  const hi=Number.isFinite(end)?end:(Number.isFinite(direct)?direct:Infinity);
  return y>=lo&&y<=hi;
}

export const staffIdOf=(row)=>String(pickValue(row,["staff_id","person_id","id"],""));
export const teamIdOfContract=(row)=>String(pickValue(row,["team_id","constructor_id","team","constructor"],""));

export function staffContractsOf(gs){
  return preferLiveRows(gs,"staffContracts","dbStaffContracts");
}

export function activeStaffContracts(gs,{teamId=null}={}){
  const year=Number(gs?.activeYear);
  return staffContractsOf(gs).filter((contract)=>{
    if(!contractActiveForYear(contract,year))return false;
    if(teamId!=null&&teamIdOfContract(contract)!==String(teamId))return false;
    return true;
  });
}
