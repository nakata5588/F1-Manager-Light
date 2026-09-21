// src/domain/driverContracts.js
import { isDriverContract, isRaceDriverContract, isReserveDriverContract } from "./contractRoles.js";
import { driverMarketEvaluation } from "./driverMarketEvaluation.js";

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

export function contractEndYear(contract,fallbackYear=NaN){
  const value=Number(pick(contract,["contract_until_year","contract_until","end_year"],fallbackYear));
  return Number.isFinite(value)?value:Number(fallbackYear);
}

export function contractActiveForYear(contract,year){
  if(!contract)return false;
  const status=String(pick(contract,["status"],"active")).toLowerCase();
  if(["terminated","expired","released","inactive","void"].includes(status))return false;
  const direct=Number(pick(contract,["year","season_year"],NaN));
  const start=Number(pick(contract,["contract_start_year","start_year"],direct));
  const end=contractEndYear(contract,direct);
  const y=Number(year);
  if(!Number.isFinite(y))return true;
  const lo=Number.isFinite(start)?start:(Number.isFinite(direct)?direct:-Infinity);
  const hi=Number.isFinite(end)?end:(Number.isFinite(direct)?direct:Infinity);
  return y>=lo&&y<=hi;
}

export function expiringDriverContracts(gs,{teamId=null}={}){
  const year=Number(gs?.activeYear);
  return contractsOf(gs).filter((contract)=>{
    if(!isDriverContract(contract)||!contractActiveForYear(contract,year))return false;
    if(teamId!=null&&teamIdOf(contract)!==String(teamId))return false;
    return contractEndYear(contract,year)===year;
  });
}

export function activeDriverContract(gs,driverId){
  const year=Number(gs?.activeYear);
  return contractsOf(gs).find((c)=>
    driverIdOf(c)===String(driverId) &&
    isDriverContract(c) &&
    contractActiveForYear(c,year)
  )||null;
}

export function ratingForDriver(gs,driverId){
  return ratingsOf(gs).find((r)=>driverIdOf(r)===String(driverId))||{};
}

export function expectedDriverSalary(gs,driverId){
  const rating=ratingForDriver(gs,driverId);
  const evaluation=driverMarketEvaluation(gs,driverId);
  const contract=activeDriverContract(gs,driverId);
  const rawAbility=Number(pick(rating,["current_ability","overall","pace"],NaN));
  const ability=Number.isFinite(rawAbility)&&rawAbility>0?rawAbility:Number(evaluation.score||55);
  const rawRep=Number(pick(rating,["reputation"],NaN));
  const rep=Number.isFinite(rawRep)&&rawRep>0?rawRep:Number(evaluation.reputation??ability);
  const rawMarket=Number(pick(rating,["market_value"],NaN));
  const market=Number.isFinite(rawMarket)&&rawMarket>0?rawMarket:Number(evaluation.market_value||0);
  const existing=Number(pick(contract||{},["salary","salary_yearly"],0));
  const model=Math.round((Math.max(45,ability)**2)*120 + Math.max(0,rep-50)*18_000);
  return Math.max(150_000,existing,Math.round(market*0.16),model);
}

export function contractAcceptanceChance(gs,driverId,offer,{renewal=false}={}){
  const expected=expectedDriverSalary(gs,driverId);
  const salary=Math.max(0,Number(offer?.salary||0));
  const years=Math.max(1,Number(offer?.years||1));
  const rating=ratingForDriver(gs,driverId);
  const evaluation=driverMarketEvaluation(gs,driverId);
  const rawAbility=Number(pick(rating,["current_ability","overall","pace"],NaN));
  const ability=Number.isFinite(rawAbility)&&rawAbility>0?rawAbility:Number(evaluation.score||55);
  const rawRep=Number(pick(rating,["reputation"],NaN));
  const rep=Number.isFinite(rawRep)&&rawRep>0?rawRep:Number(evaluation.reputation??ability);
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
  const year=Number(gs?.activeYear);
  return contractsOf(gs).filter((c)=>
    teamIdOf(c)===String(teamId) &&
    isRaceDriverContract(c) &&
    contractActiveForYear(c,year)
  ).length;
}


export function reserveSeatCount(gs,teamId){
  const year=Number(gs?.activeYear);
  return contractsOf(gs).filter((c)=>{
    if(teamIdOf(c)!==String(teamId)||!isReserveDriverContract(c))return false;
    return contractActiveForYear(c,year);
  }).length;
}


export function releaseDriverContract(gs,driverId,{reason="released_by_team"}={}){
  if(!gs)return gs;
  const contract=activeDriverContract(gs,driverId);
  if(!contract)return gs;

  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  if(teamIdOf(contract)!==userTeamId)return gs;

  const cost=terminationCost(gs,contract);
  const today=String(gs?.currentDateISO||"").slice(0,10);
  const nextContracts=(gs?.contracts||[]).map((row)=>{
    if(row!==contract)return row;
    return {
      ...row,
      status:"released",
      released_at:today||null,
      termination_reason:reason,
      termination_cost:cost,
    };
  });

  const oldBalance=Number(gs?.finances?.balance??gs?.team?.budget??0);
  const nextBalance=oldBalance-cost;
  const financeLog=Array.isArray(gs?.financeLog)?gs.financeLog:[];
  const sig="driver-release:"+driverId+":"+today;
  const tx=cost>0&&!financeLog.some((row)=>row?.sig===sig)
    ? [{
        id:"tx_"+sig,
        dateISO:today,
        type:"expense",
        category:"Driver",
        desc:"Contract termination — "+(contract.driver_name||driverId),
        amount:-cost,
        sig,
      }]
    : [];

  return {
    ...gs,
    contracts:nextContracts,
    team:{...(gs?.team||{}),budget:Number(gs?.team?.budget??oldBalance)-cost},
    finances:{
      ...(gs?.finances||{}),
      balance:nextBalance,
      budget:Number(gs?.finances?.budget??oldBalance)-cost,
      season_spend:Number(gs?.finances?.season_spend||0)+cost,
    },
    financeLog:[...tx,...financeLog],
    inbox:[{
      id:"release_"+driverId+"_"+today,
      date:today,
      unread:true,
      type:"STAFF",
      from:"Driver Management",
      tag:"Contracts",
      subject:"Contract terminated — "+(contract.driver_name||driverId),
      body:(contract.driver_name||driverId)+" has been released from the team. Termination cost: $"+cost.toLocaleString("en-US")+".",
      driver_id:String(driverId),
      team_id:userTeamId,
    },...(gs?.inbox||[])],
  };
}

export function extendDriverContract(gs,driverId,offer){
  const contract=activeDriverContract(gs,driverId);
  if(!contract)return gs;
  const year=Number(gs?.activeYear);
  const currentEnd=contractEndYear(contract,year);
  const extensionYears=Math.max(1,Math.min(5,Math.round(Number(offer?.years||1))));
  const newEnd=Math.max(year,currentEnd)+extensionYears;
  const salary=Math.max(0,Math.round(Number(offer?.salary??contract?.salary??0)));
  const role=offer?.role||contract?.role||"Driver";

  return {
    ...gs,
    contracts:(gs?.contracts||[]).map((row)=>row===contract?{
      ...row,
      role,
      salary,
      contract_until_year:newEnd,
      contract_until:newEnd,
      end_year:newEnd,
      status:"active",
      renewed_at:String(gs?.currentDateISO||"").slice(0,10)||null,
      renewal_extension_years:extensionYears,
    }:row),
  };
}
