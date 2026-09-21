// src/domain/driverContracts.js
import { isDriverContract, isRaceDriverContract, isReserveDriverContract } from "./contractRoles.js";
import { driverMarketEvaluation } from "./driverMarketEvaluation.js";
import {
  collectionRows,
  contractActiveForYear,
  contractEndYear,
  pickValue,
  preferLiveRows,
} from "./liveContracts.js";

const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));

function contractsOf(gs){
  return preferLiveRows(gs,"contracts","dbContracts");
}
function ratingsOf(gs){
  const live=collectionRows(gs?.driverRatings);
  return live.length?live:collectionRows(gs?.dbDriverRatings);
}

export { contractActiveForYear, contractEndYear };
export const driverIdOf=(o)=>String(pickValue(o,["driver_id","person_id","id"],""));
export const teamIdOf=(o)=>String(pickValue(o,["team_id","constructor_id","team","constructor"],""));

export function driverContractsOf(gs){
  return contractsOf(gs);
}

export function activeDriverContracts(gs,{teamId=null,raceOnly=false}={}){
  const year=Number(gs?.activeYear);
  return contractsOf(gs).filter((contract)=>{
    if(!isDriverContract(contract)||!contractActiveForYear(contract,year))return false;
    if(teamId!=null&&teamIdOf(contract)!==String(teamId))return false;
    if(raceOnly&&!isRaceDriverContract(contract))return false;
    return true;
  });
}

export function currentDriverTeamId(gs,driverId){
  const contract=activeDriverContract(gs,driverId);
  return contract?teamIdOf(contract):"";
}

export function freeAgentDrivers(gs){
  const activeIds=new Set(activeDriverContracts(gs).map(driverIdOf));
  return (Array.isArray(gs?.drivers)?gs.drivers:[]).filter((driver)=>{
    const id=driverIdOf(driver);
    if(!id||activeIds.has(id))return false;
    const status=String(driver?.status||"eligible").toLowerCase();
    return !["deceased","retired","hidden"].includes(status);
  });
}

export function expiringDriverContracts(gs,{teamId=null}={}){
  const year=Number(gs?.activeYear);
  return activeDriverContracts(gs,{teamId}).filter(
    (contract)=>contractEndYear(contract,year)===year
  );
}

export function activeDriverContract(gs,driverId){
  return activeDriverContracts(gs).find(
    (contract)=>driverIdOf(contract)===String(driverId)
  )||null;
}

export function ratingForDriver(gs,driverId){
  return ratingsOf(gs).find((r)=>driverIdOf(r)===String(driverId))||{};
}

export function expectedDriverSalary(gs,driverId){
  const rating=ratingForDriver(gs,driverId);
  const evaluation=driverMarketEvaluation(gs,driverId);
  const contract=activeDriverContract(gs,driverId);
  const rawAbility=Number(pickValue(rating,["current_ability","overall","pace"],NaN));
  const ability=Number.isFinite(rawAbility)&&rawAbility>0?rawAbility:Number(evaluation.score||55);
  const rawRep=Number(pickValue(rating,["reputation"],NaN));
  const rep=Number.isFinite(rawRep)&&rawRep>0?rawRep:Number(evaluation.reputation??ability);
  const rawMarket=Number(pickValue(rating,["market_value"],NaN));
  const market=Number.isFinite(rawMarket)&&rawMarket>0?rawMarket:Number(evaluation.market_value||0);
  const existing=Number(pickValue(contract||{},["salary","salary_yearly"],0));
  const model=Math.round((Math.max(45,ability)**2)*120 + Math.max(0,rep-50)*18_000);
  return Math.max(150_000,existing,Math.round(market*0.16),model);
}

export function contractAcceptanceChance(gs,driverId,offer,{renewal=false}={}){
  const expected=expectedDriverSalary(gs,driverId);
  const salary=Math.max(0,Number(offer?.salary||0));
  const years=Math.max(1,Number(offer?.years||1));
  const rating=ratingForDriver(gs,driverId);
  const evaluation=driverMarketEvaluation(gs,driverId);
  const rawAbility=Number(pickValue(rating,["current_ability","overall","pace"],NaN));
  const ability=Number.isFinite(rawAbility)&&rawAbility>0?rawAbility:Number(evaluation.score||55);
  const rawRep=Number(pickValue(rating,["reputation"],NaN));
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
  const salary=Math.max(0,Number(pickValue(contract,["salary","salary_yearly"],0)));
  const year=Number(gs?.activeYear);
  const until=Number(pickValue(contract,["contract_until_year","contract_until","end_year"],year));
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
  return activeDriverContracts(gs,{teamId,raceOnly:true}).length;
}

export function reserveSeatCount(gs,teamId){
  return activeDriverContracts(gs,{teamId}).filter(isReserveDriverContract).length;
}

export function releaseDriverContract(gs,driverId,{reason="released_by_team"}={}){
  if(!gs)return gs;
  const contract=activeDriverContract(gs,driverId);
  if(!contract)return gs;

  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  if(teamIdOf(contract)!==userTeamId)return gs;

  const cost=terminationCost(gs,contract);
  const today=String(gs?.currentDateISO||"").slice(0,10);
  const nextContracts=(Array.isArray(gs?.contracts)?gs.contracts:[]).map((row)=>{
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
    driverNegotiations:(gs?.driverNegotiations||[]).map((negotiation)=>
      String(negotiation?.driver_id)===String(driverId) &&
      String(negotiation?.kind||"")==="renewal" &&
      ["submitted","countered"].includes(String(negotiation?.status||"").toLowerCase())
        ?{...negotiation,status:"withdrawn",resolved_at:today,resolution_note:"Contract was terminated by the team."}
        :negotiation
    ),
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
    contracts:(Array.isArray(gs?.contracts)?gs.contracts:[]).map((row)=>row===contract?{
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
