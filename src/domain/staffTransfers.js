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
import { staffTeamBudget } from "./staffMarket.js";

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
  const budget=staffTeamBudget(gs,teamId);
  if(!Number.isFinite(budget))return true;
  return budget>=Math.max(0,Number(fee)||0);
}

function adjustPlayerBudget(gs,amount,{staffId,teamId,kind}={}){
  const old=Number(gs?.finances?.balance??gs?.team?.budget??0);
  const nextBalance=old+amount;
  const date=text(gs?.currentDateISO).slice(0,10);
  const sig=["staff-transfer",kind,date,staffId,teamId].join(":");
  const log=Array.isArray(gs?.financeLog)?gs.financeLog:[];
  const tx=log.some((row)=>row?.sig===sig)?[]:[{
    id:"tx_"+sig,
    dateISO:date,
    type:amount>=0?"income":"expense",
    category:"Staff Transfer",
    desc:(amount>=0?"Staff compensation received":"Staff compensation paid"),
    amount,
    sig,
  }];
  return {
    ...gs,
    team:{...(gs?.team||{}),budget:nextBalance},
    finances:{
      ...(gs?.finances||{}),
      balance:nextBalance,
      budget:nextBalance,
      season_spend:Number(gs?.finances?.season_spend||0)+(amount<0?Math.abs(amount):0),
      season_income:Number(gs?.finances?.season_income||0)+(amount>0?amount:0),
    },
    financeLog:[...tx,...log],
  };
}
function adjustNonPlayerBudget(gs,teamId,amount){
  const tid=text(teamId);
  let next=gs;
  const aiTeams=gs?.aiTechnicalWorld?.teams;
  if(aiTeams&&typeof aiTeams==="object"&&aiTeams[tid]){
    const current=Number(aiTeams[tid]?.budget);
    if(Number.isFinite(current)){
      next={
        ...next,
        aiTechnicalWorld:{
          ...(next?.aiTechnicalWorld||{}),
          teams:{
            ...aiTeams,
            [tid]:{...aiTeams[tid],budget:current+amount},
          },
        },
      };
    }
  }
  if(Array.isArray(next?.teams)){
    next={
      ...next,
      teams:next.teams.map((team)=>{
        const id=text(team?.team_id??team?.id??team?.constructor_id);
        if(id!==tid)return team;
        const current=Number(team?.budget??team?.cash??team?.balance);
        if(!Number.isFinite(current))return team;
        if("budget" in team)return {...team,budget:current+amount};
        if("cash" in team)return {...team,cash:current+amount};
        return {...team,balance:current+amount};
      }),
    };
  }
  return next;
}
function adjustTeamBudget(gs,teamId,amount,meta){
  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  return text(teamId)===playerTeamId
    ?adjustPlayerBudget(gs,amount,meta)
    :adjustNonPlayerBudget(gs,teamId,amount);
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
  let next=adjustTeamBudget(gs,buyer,-amount,{staffId,teamId:buyer,kind:"paid"});
  next=adjustTeamBudget(next,seller,amount,{staffId,teamId:seller,kind:"received"});
  return next;
}
