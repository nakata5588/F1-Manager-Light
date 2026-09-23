// src/domain/driverCareerIdentity.js
// Reconciles historical career rows with the live driver/team identities.
// Historical imports can retain legacy IDs even when the live canonical ID changed.

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

export function resolveHistoricalTeamId(row,teams=[]){
  const direct=String(unbox(row?.team_id??row?.constructor_id??"")??"").trim();
  if(direct)return direct;

  const wanted=normalizeHistoricalName(row?.team_name??row?.team??row?.constructor);
  if(!wanted)return "";

  const candidates=(Array.isArray(teams)?teams:[])
    .map((team)=>({
      team,
      id:String(unbox(team?.team_id??team?.id??"")??"").trim(),
      name:normalizeHistoricalName(team?.team_name??team?.name??team?.short_name),
    }))
    .filter((entry)=>entry.id&&entry.name);

  const exact=candidates.find((entry)=>entry.name===wanted);
  if(exact)return exact.id;

  // Historical names can include a founder/sponsor prefix (e.g. Walter Wolf -> Wolf).
  const fuzzy=candidates
    .filter((entry)=>entry.name.length>=4&&(wanted.includes(entry.name)||entry.name.includes(wanted)))
    .sort((a,b)=>b.name.length-a.name.length)[0];
  return fuzzy?.id||"";
}

export function historicalCareerRowKey(row,teams=[]){
  const year=Number(unbox(row?.year));
  const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
  const teamId=resolveHistoricalTeamId(row,teams);
  const teamName=normalizeHistoricalName(row?.team_name??row?.team??row?.constructor);
  return [Number.isFinite(year)?year:"",series,teamId||teamName].join("|");
}
