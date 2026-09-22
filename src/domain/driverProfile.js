// src/domain/driverProfile.js
// Shared read-model helpers for Driver UI surfaces.
// Keep this file presentation-oriented and side-effect free: it composes live
// Save World state without becoming a second source of truth for driver rules.

import { driverOverallPresentation } from "./driverMarketEvaluation.js";
import { driverCondition } from "./driverRating.js";
import { conditionModifierBreakdown } from "./driverPerformance.js";
import { activeDriverContract, driverIdOf, teamIdOf } from "./driverContracts.js";
import { driverKnowledgeState } from "./driverKnowledge.js";

const unbox=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v)){
    if(v.result!==undefined&&v.result!==null&&v.result!=="")return unbox(v.result);
    if(v.value!==undefined&&v.value!==null&&v.value!=="")return unbox(v.value);
    if(v.text!==undefined&&v.text!==null&&v.text!=="")return unbox(v.text);
  }
  return v;
};
const pick=(o,keys,fb=undefined)=>{
  for(const key of keys){
    const value=unbox(o?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fb;
};
const asRows=(value)=>{
  const raw=unbox(value);
  if(Array.isArray(raw))return raw;
  if(!raw||typeof raw!=="object")return [];
  for(const key of ["items","rows","list","data"])if(Array.isArray(raw[key]))return raw[key];
  return Object.values(raw).filter((row)=>row&&typeof row==="object"&&!Array.isArray(row));
};
const normDriverId=(value)=>{
  const raw=unbox(value);
  if(raw==null)return "";
  const match=String(raw).toLowerCase().match(/(\d+)/);
  return match?match[1].padStart(4,"0"):String(raw);
};
const sameDriver=(a,b)=>Boolean(normDriverId(a)&&normDriverId(a)===normDriverId(b));
const finite=(value,fb=null)=>{
  const number=Number(unbox(value));
  return Number.isFinite(number)?number:fb;
};

export function driverSeasonSnapshot(gs,driverId,year=Number(gs?.activeYear)){
  const snapshot={
    starts:0,
    races:0,
    wins:0,
    podiums:0,
    poles:0,
    fastestLaps:0,
    dnfs:0,
    points:0,
    bestFinish:null,
    averageFinish:null,
    finishSum:0,
    finishCount:0,
    championshipPosition:null,
  };

  for(const event of asRows(gs?.results)){
    if(Number(event?.year)!==Number(year))continue;
    const raceRow=asRows(event?.classification).find((row)=>sameDriver(row?.driver_id??row?.id,driverId));
    const qualifyingRow=asRows(event?.qualifying).find((row)=>sameDriver(row?.driver_id??row?.id,driverId));

    if(qualifyingRow&&Number(qualifyingRow?.position)===1)snapshot.poles+=1;
    if(!raceRow)continue;

    const retired=Boolean(raceRow?.retired)||String(raceRow?.status||"").toUpperCase()==="DNF";
    const position=finite(raceRow?.position);

    snapshot.starts+=1;
    snapshot.races+=1;
    snapshot.points+=finite(raceRow?.points,0)||0;
    if(!retired&&position===1)snapshot.wins+=1;
    if(!retired&&position!=null&&position>=1&&position<=3)snapshot.podiums+=1;
    if(retired)snapshot.dnfs+=1;
    if(Boolean(raceRow?.fastest_lap))snapshot.fastestLaps+=1;

    if(position!=null&&position>0){
      snapshot.bestFinish=snapshot.bestFinish==null?position:Math.min(snapshot.bestFinish,position);
      snapshot.finishSum+=position;
      snapshot.finishCount+=1;
    }
  }

  snapshot.averageFinish=snapshot.finishCount
    ?Number((snapshot.finishSum/snapshot.finishCount).toFixed(1))
    :null;

  const standing=asRows(gs?.standings?.drivers).find((row)=>sameDriver(row?.driver_id??row?.id,driverId));
  if(standing){
    snapshot.championshipPosition=finite(standing?.position);
    const standingPoints=finite(standing?.points);
    if(standingPoints!=null)snapshot.points=standingPoints;
  }

  return snapshot;
}

export function driverAvailabilitySnapshot(gs,driverId){
  const source=gs?.driverAvailability;
  const availability=Array.isArray(source)
    ?source.find((row)=>sameDriver(driverIdOf(row),driverId))||null
    :(source&&typeof source==="object"
      ?source[String(driverId)]||Object.values(source).find((row)=>sameDriver(driverIdOf(row),driverId))||null
      :null);

  const medical=asRows(gs?.medicalHistory)
    .filter((row)=>sameDriver(row?.driver_id??row?.id,driverId))
    .sort((a,b)=>String(b?.date||"").localeCompare(String(a?.date||"")))[0]||null;

  const status=String(pick(availability||{},["status","availability_status"],"available")).toLowerCase();
  const available=["","available","fit","active","cleared"].includes(status);

  return {
    availability,
    medical,
    status:status||"available",
    available,
    reason:pick(availability||{},["reason","availability_reason","note"],medical?.injury_reason??null),
    severity:pick(availability||{},["severity"],medical?.injury_severity??null),
    expectedReturnDate:pick(availability||{},["expectedReturnDate","expected_return_date"],medical?.expected_return_date??null),
  };
}

export function driverProfileSnapshot(gs,driverOrId){
  const requestedId=typeof driverOrId==="object"
    ?driverIdOf(driverOrId)
    :String(driverOrId??"");

  const driverMap=new Map();
  for(const row of asRows(gs?.dbDrivers)){
    const key=normDriverId(driverIdOf(row));
    if(key)driverMap.set(key,row);
  }
  for(const row of asRows(gs?.drivers)){
    const key=normDriverId(driverIdOf(row));
    if(key)driverMap.set(key,{...(driverMap.get(key)||{}),...row});
  }
  const driver=typeof driverOrId==="object"
    ?{...(driverMap.get(normDriverId(requestedId))||{}),...driverOrId}
    :driverMap.get(normDriverId(requestedId))||null;

  const driverId=driverIdOf(driver)||requestedId;
  const ratings=[
    ...asRows(gs?.dbDriverRatings),
    ...asRows(gs?.driverRatings),
  ];
  const rating=ratings.reduce((found,row)=>
    sameDriver(driverIdOf(row),driverId)?{...(found||{}),...row}:found
  ,null)||{};

  const contract=activeDriverContract(gs,driverId);
  const teamId=contract?teamIdOf(contract):String(pick(driver||{},["team_id","constructor_id"],""));
  const teams=[...asRows(gs?.dbTeams),...asRows(gs?.teams)];
  const team=teams.reduce((found,row)=>{
    const id=String(pick(row,["team_id","id"],""));
    return id&&id===String(teamId)?{...(found||{}),...row}:found;
  },null);
  const condition=driverCondition(gs,driverId);
  const conditionImpact=conditionModifierBreakdown(gs,driverId);
  const overall=driverOverallPresentation(gs,driver||driverId);
  const season=driverSeasonSnapshot(gs,driverId);
  const availability=driverAvailabilitySnapshot(gs,driverId);
  const knowledge=driverKnowledgeState(gs,driver||driverId);

  return {
    driverId,
    driver,
    rating,
    contract,
    teamId,
    team,
    teamName:pick(contract||{},["team_name"],pick(team||{},["team_name","name","short_name"],null)),
    overall,
    condition,
    conditionImpact,
    season,
    availability,
    knowledge,
  };
}
