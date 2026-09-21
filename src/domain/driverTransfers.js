// src/domain/driverTransfers.js
import { driverMarketEvaluation } from "./driverMarketEvaluation.js";
import { contractEndYear, teamIdOf } from "./driverContracts.js";

const num=(value,fallback=NaN)=>{
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
};
const bool=(value)=>{
  if(typeof value==="boolean")return value;
  return ["true","1","yes","y"].includes(String(value??"").trim().toLowerCase());
};

export function effectiveContractRule(gs,year=gs?.activeYear){
  const y=Number(year);
  const rows=Array.isArray(gs?.contractRules)&&gs.contractRules.length
    ?gs.contractRules
    :(Array.isArray(gs?.dbContractRules)?gs.dbContractRules:[]);
  return rows.find((row)=>{
    const from=num(row?.year_from,-Infinity);
    const to=num(row?.year_to,Infinity);
    return y>=from&&y<=to;
  })||null;
}

function ruleClauses(rule){
  if(rule?.clauses&&typeof rule.clauses==="object")return rule.clauses;
  try{
    return JSON.parse(String(rule?.clauses_json||"{}"));
  }catch{
    return {};
  }
}

export function driverBuyoutQuote(gs,contract,{driverId=null}={}){
  if(!contract)return {allowed:false,reason:"missing_contract",fee:0,type:"none"};
  const rule=effectiveContractRule(gs);
  if(rule && !bool(rule?.buyout_allowed)){
    return {allowed:false,reason:"buyout_not_allowed",fee:0,type:"none",rule};
  }

  const explicit=num(
    contract?.release_clause ??
    contract?.release_clause_value ??
    contract?.buyout_value ??
    contract?.buyout_fee,
    NaN
  );
  if(Number.isFinite(explicit)&&explicit>=0){
    return {
      allowed:true,
      reason:"fixed_clause",
      fee:Math.round(explicit),
      type:"fixed_clause",
      sellerTeamId:teamIdOf(contract),
      rule,
    };
  }

  const clauses=ruleClauses(rule);
  const minFee=Math.max(0,num(clauses?.buyout_fee_min,50_000));
  const maxFee=Math.max(minFee,num(clauses?.buyout_fee_max,3_000_000));
  const year=Number(gs?.activeYear);
  const remainingYears=Math.max(1,contractEndYear(contract,year)-year+1);
  const salary=Math.max(0,num(contract?.salary??contract?.salary_yearly,0));
  const evaluation=driverMarketEvaluation(gs,driverId||contract?.driver_id);
  const market=Math.max(0,num(evaluation?.market_value,0));
  const quality=Math.max(0,num(evaluation?.score,55));

  const salaryBase=salary*remainingYears*0.65;
  const marketBase=market*0.20;
  const qualityBase=Math.max(0,quality-50)*12_000;
  const raw=Math.max(minFee,salaryBase,marketBase+qualityBase);
  const fee=Math.round(Math.max(minFee,Math.min(maxFee,raw))/5_000)*5_000;

  return {
    allowed:true,
    reason:"negotiated_compensation",
    fee,
    type:"compensation",
    remainingYears,
    sellerTeamId:teamIdOf(contract),
    rule,
  };
}

export function canAffordTransfer(gs,teamId,fee){
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  if(String(teamId)!==userTeamId)return true;
  const balance=Number(gs?.finances?.balance??gs?.team?.budget??0);
  return balance>=Number(fee||0);
}
