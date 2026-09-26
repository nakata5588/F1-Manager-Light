// src/domain/driverCareerIdentity.js
// Reconciles historical career rows with the live driver/team identities.
// Historical imports can retain legacy IDs even when the live canonical ID changed.

import { canonicalHistoricalTeam, resolveHistoricalTeamId } from "./teamIdentity.js";
export { canonicalHistoricalTeam, resolveHistoricalTeamId };

function unbox(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unbox(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unbox(value.value);
    if(value.text!==undefined&&value.text!==null&&value.text!=="")return unbox(value.text);
  }
  return value;
}

function normId(value){
  const raw=unbox(value);
  if(raw==null||raw==="")return "";
  const match=String(raw).toLowerCase().match(/(\d+)/);
  return match?match[1].padStart(4,"0"):String(raw).trim().toLowerCase();
}

export function normalizeHistoricalName(value){
  return String(unbox(value)??"")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}

export function historicalCareerDriverMatches(row,{driverId=null,driverName=null}={}){
  const rowId=normId(row?.driver_id??row?.driverId??row?.person_id??row?.id);
  const liveId=normId(driverId);
  if(rowId&&liveId&&rowId===liveId)return true;

  const rowName=normalizeHistoricalName(
    row?.driver_name??row?.display_name??row?.name
  );
  const liveName=normalizeHistoricalName(driverName);
  return Boolean(rowName&&liveName&&rowName===liveName);
}

function careerDriverToken(row){
  const name=normalizeHistoricalName(row?.driver_name??row?.display_name??row?.name);
  if(name)return name;
  return normId(row?.driver_id??row?.driverId??row?.person_id??row?.id);
}

export function historicalCareerRowKey(row,teams=[]){
  const year=Number(unbox(row?.year));
  const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
  const driver=careerDriverToken(row);
  const teamId=resolveHistoricalTeamId(row,teams);
  const teamName=normalizeHistoricalName(row?.team_name??row?.team??row?.constructor);
  return [Number.isFinite(year)?year:"",series,driver,teamId||teamName].join("|");
}


export function mergeHistoricalCareerSources(liveRows=[],canonicalRows=[],teams=[]){
  const merged=new Map();
  const apply=(row)=>{
    if(!row||typeof row!=="object")return;
    const key=historicalCareerRowKey(row,teams);
    const prev=merged.get(key)||{};
    const next={...prev};
    for(const [field,value] of Object.entries(row)){
      const resolved=unbox(value);
      if(resolved!==undefined&&resolved!==null&&resolved!=="")next[field]=value;
    }
    merged.set(key,next);
  };

  // Runtime/generated rows establish coverage. Canonical driver_career rows are
  // applied second so historical championship position/FL/poles are not lost.
  for(const row of Array.isArray(liveRows)?liveRows:[])apply(row);
  for(const row of Array.isArray(canonicalRows)?canonicalRows:[])apply(row);
  return [...merged.values()].map((row)=>{
    const canonical=canonicalHistoricalTeam(row,teams);
    return {
      ...row,
      team_id:canonical.id||row?.team_id||null,
      team_name:canonical.name||row?.team_name||row?.team||"—",
    };
  });
}


function hasChampionshipPosition(value){
  const resolved=unbox(value);
  return resolved!==undefined&&resolved!==null&&resolved!=="";
}

function seasonKey(row){
  const year=Number(unbox(row?.year));
  const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
  return [Number.isFinite(year)?year:"",series].join("|");
}

export function deriveCareerChampionshipPositions(rows=[]){
  const source=Array.isArray(rows)?rows:[];
  const seasonDrivers=new Map();

  for(const row of source){
    if(!row||typeof row!=="object")continue;
    const driver=careerDriverToken(row);
    if(!driver)continue;
    const key=seasonKey(row);
    if(!seasonDrivers.has(key))seasonDrivers.set(key,new Map());
    const drivers=seasonDrivers.get(key);
    const rec=drivers.get(driver)||{points:0,wins:0,podiums:0,poles:0,driver};
    rec.points+=Number(unbox(row?.points)||0);
    rec.wins+=Number(unbox(row?.wins)||0);
    rec.podiums+=Number(unbox(row?.podiums)||0);
    rec.poles+=Number(unbox(row?.poles)||0);
    drivers.set(driver,rec);
  }

  const ranks=new Map();
  for(const [key,drivers] of seasonDrivers.entries()){
    const ordered=[...drivers.values()].sort((a,b)=>
      b.points-a.points||
      b.wins-a.wins||
      b.podiums-a.podiums||
      b.poles-a.poles||
      a.driver.localeCompare(b.driver)
    );
    ordered.forEach((row,index)=>ranks.set(`${key}|${row.driver}`,index+1));
  }

  return source.map((row)=>{
    if(hasChampionshipPosition(row?.champ_pos))return row;
    const driver=careerDriverToken(row);
    const rank=ranks.get(`${seasonKey(row)}|${driver}`);
    return Number.isFinite(rank)?{...row,champ_pos:rank,__champ_pos_derived:true}:row;
  });
}


export function applyResultChampionshipPositions(careerRows=[],resultRows=[]){
  const resultSource=Array.isArray(resultRows)?resultRows:[];
  const bySeason=new Map();

  for(const row of resultSource){
    if(!row||typeof row!=="object")continue;
    const driver=careerDriverToken(row);
    if(!driver)continue;
    const key=seasonKey(row);
    if(!bySeason.has(key))bySeason.set(key,new Map());
    const drivers=bySeason.get(key);
    const rec=drivers.get(driver)||{
      driver,
      name:String(unbox(row?.driver_name??row?.display_name??row?.name??driver)??driver),
      points:0,
      wins:0,
    };
    rec.points+=Number(unbox(row?.points)||0);
    rec.wins+=Number(unbox(row?.wins)||0);
    drivers.set(driver,rec);
  }

  const positions=new Map();
  for(const [key,drivers] of bySeason.entries()){
    const ordered=[...drivers.values()].sort((a,b)=>
      b.points-a.points||
      b.wins-a.wins||
      a.name.localeCompare(b.name)
    );
    ordered.forEach((row,index)=>positions.set(`${key}|${row.driver}`,index+1));
  }

  return (Array.isArray(careerRows)?careerRows:[]).map((row)=>{
    const driver=careerDriverToken(row);
    const resultPosition=positions.get(`${seasonKey(row)}|${driver}`);
    if(Number.isFinite(resultPosition)){
      return {
        ...row,
        champ_pos:resultPosition,
        __champ_pos_source:"historical_results",
      };
    }
    return {
      ...row,
      __champ_pos_source:hasChampionshipPosition(row?.champ_pos)?"career_fallback":"missing",
    };
  });
}

function rowTeamLabel(row){
  return String(unbox(row?.team_name??row?.team??row?.team_id??"")??"").trim()||"Unknown team";
}

function careerRowOrderValue(row,index){
  const firstRound=Number(unbox(row?.first_round));
  const lastRound=Number(unbox(row?.last_round));
  const order=Number(unbox(row?.order));
  if(Number.isFinite(firstRound))return firstRound*1000+(Number.isFinite(lastRound)?lastRound:0);
  if(Number.isFinite(lastRound))return lastRound*1000;
  if(Number.isFinite(order))return 100000+order;
  return 200000+index;
}

export function annotateCareerTransfers(rows=[]){
  const source=(Array.isArray(rows)?rows:[]).map((row,index)=>({...row,__transferIndex:index}));
  const groups=new Map();
  for(const row of source){
    const key=`${seasonKey(row)}|${careerDriverToken(row)}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }

  const annotations=new Map();
  for(const group of groups.values()){
    const distinct=[...new Set(group.map((row)=>String(unbox(row?.team_id??row?.team_name??""))))];
    if(distinct.length<=1)continue;
    const ordered=group.slice().sort((a,b)=>
      careerRowOrderValue(a,a.__transferIndex)-careerRowOrderValue(b,b.__transferIndex)
    );
    for(let i=1;i<ordered.length;i++){
      const previous=ordered[i-1];
      const current=ordered[i];
      const firstRound=Number(unbox(current?.first_round));
      annotations.set(current.__transferIndex,{
        from:rowTeamLabel(previous),
        to:rowTeamLabel(current),
        round:Number.isFinite(firstRound)?firstRound:null,
      });
    }
  }

  return source.map((row)=>{
    const note=annotations.get(row.__transferIndex)||null;
    const {__transferIndex,...rest}=row;
    return note?{...rest,__transfer:note}:rest;
  });
}

export function markChampionshipPositionTeam(rows=[]){
  const source=(Array.isArray(rows)?rows:[]).map((row,index)=>({...row,__careerRowIndex:index}));
  const groups=new Map();

  for(const row of source){
    const key=`${seasonKey(row)}|${careerDriverToken(row)}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }

  const chosen=new Set();
  for(const group of groups.values()){
    if(group.length===1){
      chosen.add(group[0].__careerRowIndex);
      continue;
    }
    const ordered=group.slice().sort((a,b)=>{
      const aLast=Number(unbox(a?.last_round));
      const bLast=Number(unbox(b?.last_round));
      const aHasLast=Number.isFinite(aLast);
      const bHasLast=Number.isFinite(bLast);
      if(aHasLast||bHasLast){
        if(aHasLast!==bHasLast)return aHasLast?1:-1;
        if(aLast!==bLast)return aLast-bLast;
      }
      const aOrder=Number(unbox(a?.order));
      const bOrder=Number(unbox(b?.order));
      const aHasOrder=Number.isFinite(aOrder);
      const bHasOrder=Number.isFinite(bOrder);
      if(aHasOrder||bHasOrder){
        if(aHasOrder!==bHasOrder)return aHasOrder?1:-1;
        if(aOrder!==bOrder)return aOrder-bOrder;
      }
      return a.__careerRowIndex-b.__careerRowIndex;
    });
    chosen.add(ordered.at(-1).__careerRowIndex);
  }

  return source.map((row)=>{
    const show=chosen.has(row.__careerRowIndex);
    const {__careerRowIndex,...rest}=row;
    return {...rest,__showChampionshipPosition:show};
  });
}
