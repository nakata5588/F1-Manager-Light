// src/domain/staffTransfers.js
// Staff transfer compensation uses the same era contract rules as driver
// transfers while keeping a Staff-specific valuation formula.

import { effectiveContractRule } from "./driverTransfers.js";
import {
  contractEndYear,
  staffIdOf,
  teamIdOfContract,
} from "./liveContracts.js";
import { staffContractRole, resolveStaffId } from "./staffRoles.js";
import { staffMarketScore } from "./staffPerformance.js";
import { applyTeamBudgetDelta, teamBudgetAvailable } from "./teamFinance.js";

const text=(value)=>String(value??"");
const num=(value,fallback=NaN)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const bool=(value)=>{
  if(typeof value==="boolean")return value;
  return ["true","1","yes","y"].includes(text(value).trim().toLowerCase());
};
function ruleClauses(rule){
  if(rule?.clauses&&typeof rule.clauses==="object")return rule.clauses;
  try{return JSON.parse(text(rule?.clauses_json||"{}"));}catch{return {};}
}

export function staffBuyoutQuote(gs,contract,{staffId=null,role=null}={}){
  if(!contract)return {allowed:false,reason:"missing_contract",fee:0,type:"none"};
  const rule=effectiveContractRule(gs);
  if(rule&&!bool(rule?.buyout_allowed)){
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
      sellerTeamId:teamIdOfContract(contract),
      rule,
    };
  }

  const clauses=ruleClauses(rule);
  const minFee=Math.max(0,num(clauses?.buyout_fee_min,40_000));
  const maxFee=Math.max(minFee,num(clauses?.buyout_fee_max,2_500_000));
  const year=Number(gs?.activeYear);
  const remainingYears=Math.max(1,contractEndYear(contract,year)-year+1);
  const salary=Math.max(0,num(contract?.salary??contract?.salary_yearly,0));
  const sid=text(staffId||resolveStaffId(gs,contract)||staffIdOf(contract));
  const staffRole=role||staffContractRole(contract);
  const quality=Math.max(0,num(staffMarketScore(gs,sid,staffRole),55));

  const salaryBase=salary*remainingYears*0.70;
  const qualityBase=Math.max(0,quality-50)*8_000;
  const raw=Math.max(minFee,salaryBase,qualityBase);
  const fee=Math.round(Math.max(minFee,Math.min(maxFee,raw))/5_000)*5_000;

  return {
    allowed:true,
    reason:"negotiated_compensation",
    fee,
    type:"compensation",
    remainingYears,
    sellerTeamId:teamIdOfContract(contract),
    rule,
  };
}
export function canAffordStaffTransfer(gs,teamId,fee){
  const budget=teamBudgetAvailable(gs,teamId);
  if(!Number.isFinite(budget))return true;
  return budget>=Math.max(0,Number(fee)||0);
}


export function applyStaffTransferSettlement(gs,{
  staffId,
  buyerTeamId,
  sellerTeamId,
  fee,
}={}){
  const amount=Math.max(0,Math.round(Number(fee)||0));
  const buyer=text(buyerTeamId);
  const seller=text(sellerTeamId);
  if(!gs||!buyer||!seller||buyer===seller||amount<=0)return gs;
  if(!canAffordStaffTransfer(gs,buyer,amount))return null;
  let next=applyTeamBudgetDelta(gs,buyer,-amount,{
    category:"Staff Transfer",
    desc:"Staff compensation paid",
    sig:["staff-transfer","paid",text(gs?.currentDateISO).slice(0,10),staffId,buyer].join(":"),
  });
  next=applyTeamBudgetDelta(next,seller,amount,{
    category:"Staff Transfer",
    desc:"Staff compensation received",
    sig:["staff-transfer","received",text(gs?.currentDateISO).slice(0,10),staffId,seller].join(":"),
  });
  return next;
}
