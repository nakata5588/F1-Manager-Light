// src/domain/driverContracts.js
import { isDriverContract, isRaceDriverContract } from "./contractRoles.js";

const unwrap=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v)){
    if("error" in v && !("result" in v) && !("value" in v) && !("text" in v))return null;
    if("result" in v)return unwrap(v.result);
    if("value" in v)return unwrap(v.value);
    if("text" in v)return unwrap(v.text);
  }
  return v;
};
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unwrap(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));

function rows(value){
  const raw=unwrap(value);
  if(Array.isArray(raw))return raw;
  if(!raw||typeof raw!=="object")return [];
  for(const key of ["items","rows","list","data"]){
    if(Array.isArray(raw[key]))return raw[key];
  }
  return Object.values(raw).filter((row)=>row&&typeof row==="object"&&!Array.isArray(row));
}
function contractsOf(gs){
  const live=rows(gs?.contracts);
  return live.length?live:rows(gs?.dbContracts);
}
function ratingsOf(gs){
  const live=rows(gs?.driverRatings);
  return live.length?live:rows(gs?.dbDriverRatings);
}

export const driverIdOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
export const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor"],""));

export function activeDriverContract(gs,driverId){
  const year=Number(gs?.activeYear);
  return contractsOf(gs).find((c)=>{
    if(driverIdOf(c)!==String(driverId))return false;
    if(!isDriverContract(c))return false;
    const status=String(pick(c,["status"],"active")).toLowerCase();
    if(["terminated","expired","released","inactive","void"].includes(status))return false;
    const cy=Number(pick(c,["year","season_year"],year));
    return !Number.isFinite(cy)||!Number.isFinite(year)||cy===year;
  })||null;
}

export function ratingForDriver(gs,driverId){
  return ratingsOf(gs).find((r)=>driverIdOf(r)===String(driverId))||{};
}

export function expectedDriverSalary(gs,driverId){
  const rating=ratingForDriver(gs,driverId);
  const contract=activeDriverContract(gs,driverId);
  const ability=Number(pick(rating,["current_ability","overall","pace"],60));
  const rep=Number(pick(rating,["reputation"],ability));
  const market=Number(pick(rating,["market_value"],0));
  const existing=Number(pick(contract||{},["salary","salary_yearly"],0));
  const model=Math.round((Math.max(45,ability)**2)*120 + Math.max(0,rep-50)*18_000);
  return Math.max(150_000,existing,Math.round(market*0.16),model);
}

export function contractAcceptanceChance(gs,driverId,offer,{renewal=false}={}){
  const expected=expectedDriverSalary(gs,driverId);
  const salary=Math.max(0,Number(offer?.salary||0));
  const years=Math.max(1,Number(offer?.years||1));
  const rating=ratingForDriver(gs,driverId);
  const ability=Number(pick(rating,["current_ability","overall","pace"],60));
  const rep=Number(pick(rating,["reputation"],ability));
  const role=String(offer?.role||"Reserve Driver").toLowerCase();

  let chance=0.42;
  const ratio=expected>0?salary/expected:1;
  chance += clamp((ratio-0.75)*0.9,-0.32,0.38);
  chance += Math.min(0.10,(years-1)*0.035);
  if(/main|first|lead/.test(role))chance+=0.08;
  if(/second/.test(role))chance+=0.03;
  if(/reserve|test/.test(role)&&ability>=75)chance-=0.10;
  if(renewal)chance+=0.12;
  if(rep>=80)chance-=0.05;
  return clamp(chance,0.05,0.95);
}

export function terminationCost(gs,contract){
  if(!contract)return 0;
  const salary=Math.max(0,Number(pick(contract,["salary","salary_yearly"],0)));
  const year=Number(gs?.activeYear);
  const until=Number(pick(contract,["contract_until_year","contract_until","end_year"],year));
  const years=Math.max(1,Number.isFinite(until)&&Number.isFinite(year)?until-year+1:1);
  return Math.round(salary*years*0.45);
}

export function makeDriverContract({gs,driver,teamId,teamName,offer,source="player_negotiation"}){
  const year=Number(gs?.activeYear);
  return {
    year,
    team_id:String(teamId),
    team_name:teamName||String(teamId),
    driver_id:driverIdOf(driver),
    driver_name:driver?.display_name||driver?.name||driverIdOf(driver),
    role:offer.role||"Reserve Driver",
    salary:Math.round(Number(offer.salary||0)),
    contract_start_year:year,
    contract_until_year:year+Math.max(1,Number(offer.years||1))-1,
    status:"active",
    source,
  };
}

export function raceSeatCount(gs,teamId){
  return contractsOf(gs).filter((c)=>{
    if(teamIdOf(c)!==String(teamId))return false;
    return isRaceDriverContract(c);
  }).length;
}
