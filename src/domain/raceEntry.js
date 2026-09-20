// src/domain/raceEntry.js
import { isRaceDriverContract, isReserveDriverContract, normalizedContractRole } from "./contractRoles.js";

const unwrap=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v)){
    if(v.result!==undefined&&v.result!==null&&v.result!=="")return unwrap(v.result);
    if(v.value!==undefined&&v.value!==null&&v.value!=="")return unwrap(v.value);
  }
  return v;
};

const pick=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const v=unwrap(o?.[k]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};

const asRows=(value)=>{
  const raw=unwrap(value);
  if(Array.isArray(raw))return raw;
  if(!raw||typeof raw!=="object")return [];
  for(const key of ["items","rows","list","data"])if(Array.isArray(raw[key]))return raw[key];
  return Object.values(raw).filter((row)=>row&&typeof row==="object"&&!Array.isArray(row));
};

const driverIdOf=(row)=>String(pick(row,["driver_id","person_id","id"],""));
const teamIdOf=(row)=>String(pick(row,["team_id","constructor_id","team","constructor","id"],""));
const contractsOf=(gs)=>{
  const live=asRows(gs?.contracts);
  return live.length?live:asRows(gs?.dbContracts);
};

function dateOnly(value){
  const s=String(value||"");
  return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):"";
}

function gpDateISO(gp){
  return dateOnly(pick(gp,["dateISO","date","race_date","raceDate","start_date","end_date"],""));
}

function contractActiveForYear(contract,year){
  const status=String(pick(contract,["status"],"active")).toLowerCase();
  if(["terminated","expired","released","inactive"].includes(status))return false;

  const direct=Number(pick(contract,["year","season_year"],NaN));
  const start=Number(pick(contract,["contract_start_year","start_year","contract_start"],NaN));
  const end=Number(pick(contract,["contract_until_year","end_year","contract_until"],NaN));

  if(Number.isFinite(start)||Number.isFinite(end)){
    const lo=Number.isFinite(start)?start:(Number.isFinite(direct)?direct:-Infinity);
    const hi=Number.isFinite(end)?end:(Number.isFinite(direct)?direct:Infinity);
    return year>=lo&&year<=hi;
  }
  return !Number.isFinite(direct)||direct===year;
}

function seatRank(contract,index){
  const role=normalizedContractRole(contract);
  if(/(^|_)(main|lead|first)(_|$)/.test(role))return 0;
  if(/(^|_)(second|driver_?2)(_|$)/.test(role))return 1;
  const explicit=Number(pick(contract,["seat","seat_number","order","priority"],NaN));
  return Number.isFinite(explicit)?10+explicit:100+index;
}

function availabilityRecord(gs,driverId){
  const source=gs?.driverAvailability;
  if(Array.isArray(source)){
    return source.find((row)=>driverIdOf(row)===String(driverId))||null;
  }
  if(source&&typeof source==="object"){
    return source[String(driverId)]??source[driverId]??null;
  }
  return null;
}

export function driverAvailabilityForRace(gs,driverId,gp){
  if(!driverId)return {available:false,status:"vacant",reason:"no_contracted_driver"};

  const rec=availabilityRecord(gs,driverId);
  if(!rec)return {available:true,status:"available",reason:null};

  const status=String(pick(rec,["status","availability_status"],"available")).toLowerCase();
  const raceDate=gpDateISO(gp);
  const from=dateOnly(pick(rec,["unavailableFrom","unavailable_from","from","start_date"],""));
  const to=dateOnly(pick(rec,["expectedReturnDate","expected_return_date","until","end_date"],""));

  if(raceDate){
    if(from&&raceDate<from)return {available:true,status:"available",reason:null};
    if(to&&raceDate>to)return {available:true,status:"available",reason:null};
  }

  if(["","available","fit","active","cleared"].includes(status)){
    return {available:true,status:status||"available",reason:null};
  }

  const unavailable=["injured","injury","suspended","unavailable","medical","retired","withdrawn"];
  if(unavailable.includes(status)){
    return {
      available:false,
      status,
      reason:String(pick(rec,["reason","availability_reason","note"],status)),
    };
  }

  return {available:true,status,reason:null};
}

export function isDriverAvailableForRace(gs,driverId,gp){
  return driverAvailabilityForRace(gs,driverId,gp).available;
}

function activeContractsByRole(gs,teamId,rolePredicate){
  const year=Number(gs?.activeYear);
  return contractsOf(gs)
    .filter((contract)=>teamIdOf(contract)===String(teamId))
    .filter(rolePredicate)
    .filter((contract)=>!Number.isFinite(year)||contractActiveForYear(contract,year));
}

export function activeRaceContracts(gs,teamId){
  return activeContractsByRole(gs,teamId,isRaceDriverContract)
    .map((contract,index)=>({contract,index}))
    .sort((a,b)=>seatRank(a.contract,a.index)-seatRank(b.contract,b.index))
    .map(({contract})=>contract);
}

export function activeReserveContracts(gs,teamId){
  return activeContractsByRole(gs,teamId,isReserveDriverContract);
}

function teamIdsForEntries(gs){
  const explicit=(gs?.teams||[]).map(teamIdOf).filter(Boolean);
  if(explicit.length)return [...new Set(explicit)];
  return [...new Set(
    contractsOf(gs)
      .filter(isRaceDriverContract)
      .map(teamIdOf)
      .filter(Boolean)
  )];
}

export function buildRaceEntryState(gs,{gp,roundIndex}={}){
  const year=Number(gs?.activeYear)||Number(pick(gp,["year","season_year"],NaN))||null;
  const round=Number.isFinite(Number(roundIndex))?Number(roundIndex)+1:Number(pick(gp,["round"],NaN))||null;
  const gpFallback=round?"round_"+round:"gp";
  const gpId=String(pick(gp,["gp_id","id","track_id"],gpFallback));
  const entries=[];

  for(const teamId of teamIdsForEntries(gs)){
    const contracts=activeRaceContracts(gs,teamId);
    const reserveContracts=activeReserveContracts(gs,teamId);
    const usedReserveIds=new Set();

    for(let slot=1;slot<=2;slot+=1){
      const contract=contracts[slot-1]||null;
      const contractedDriverId=contract?driverIdOf(contract):null;
      const availability=driverAvailabilityForRace(gs,contractedDriverId,gp);

      let driverId=contractedDriverId&&availability.available?String(contractedDriverId):null;
      let entryType=driverId?"contracted":null;
      let replacementFor=null;
      let replacementContractId=null;

      if(contractedDriverId&&!availability.available){
        const reserve=reserveContracts.find((candidate)=>{
          const reserveId=driverIdOf(candidate);
          return reserveId &&
            !usedReserveIds.has(reserveId) &&
            driverAvailabilityForRace(gs,reserveId,gp).available;
        })||null;

        if(reserve){
          const reserveId=driverIdOf(reserve);
          usedReserveIds.add(reserveId);
          driverId=reserveId;
          entryType="reserve_replacement";
          replacementFor=String(contractedDriverId);
          replacementContractId=String(pick(reserve,["contract_id","id"],""))||null;
        }
      }

      const confirmed=Boolean(driverId);
      entries.push({
        team_id:String(teamId),
        car_slot:slot,
        driver_id:confirmed?String(driverId):null,
        contracted_driver_id:contractedDriverId?String(contractedDriverId):null,
        entry_type:entryType,
        replacement_for_driver_id:replacementFor,
        replacement_contract_id:replacementContractId,
        status:confirmed?"confirmed":"vacant",
        availability_status:availability.status,
        availability_reason:availability.reason,
      });
    }
  }

  return {
    gp_id:gpId,
    year,
    round,
    dateISO:gpDateISO(gp)||null,
    entries,
  };
}

export function raceEntryDriverIds(raceEntryState){
  return (raceEntryState?.entries||[])
    .filter((entry)=>entry?.status==="confirmed"&&entry?.driver_id)
    .map((entry)=>String(entry.driver_id));
}

export function raceEntryTeamForDriver(raceEntryState,driverId){
  const entry=(raceEntryState?.entries||[]).find((row)=>String(row?.driver_id||"")===String(driverId));
  return entry?.team_id?String(entry.team_id):null;
}
