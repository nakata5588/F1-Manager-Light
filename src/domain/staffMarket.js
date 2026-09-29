// src/domain/staffMarket.js
// Shared Staff-market rules for both player and AI recruitment.
// This module owns who can be hired, salary guidance, team interest and
// replacement cost so UI and engines do not invent separate market rules.

import {
  activeStaffContracts,
  collectionRows,
  contractEndYear,
  staffIdOf,
} from "./liveContracts.js";
import {
  canonicalStaffRole,
  resolveStaffId,
  staffContractRole,
} from "./staffRoles.js";
import {
  staffMarketScore,
  staffRatingForYear,
  staffReputation,
  staffRoleRating,
} from "./staffPerformance.js";
import { teamReputation } from "./teamReputation.js";
import { teamBudgetAvailable } from "./teamFinance.js";

export const STAFF_HIREABLE_ROLES=Object.freeze([
  "team_principal",
  "technical_director",
  "chief_designer",
  "chief_engineer",
  "chief_strategist",
  "race_engineer",
]);
const HIREABLE_ROLE_SET=new Set(STAFF_HIREABLE_ROLES);

const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"");
const dateOnly=(value)=>text(value).slice(0,10);

function staffCoreRows(gs){
  const live=collectionRows(gs?.staffCore);
  return live.length?live:collectionRows(gs?.dbStaffCore);
}
function teamRows(gs){
  const live=collectionRows(gs?.teams);
  return live.length?live:collectionRows(gs?.dbTeams);
}
function teamIdOf(row){
  return text(row?.team_id??row?.id??row?.constructor_id);
}
function staffAliveForDate(row,dateISO){
  const death=dateOnly(row?.death_date);
  return !death||!dateISO||death>dateISO;
}
function financialRule(gs){
  const year=Number(gs?.activeYear);
  const rows=[
    ...collectionRows(gs?.financialRules),
    ...collectionRows(gs?.dbFinancialRules),
  ];
  return rows.find((row)=>Number(row?.year)===year)
    ||rows.filter((row)=>Number(row?.year)<=year).sort((a,b)=>num(b?.year)-num(a?.year))[0]
    ||rows[0]
    ||{};
}
export function staffSalaryBounds(gs){
  const rule=financialRule(gs);
  const min=Math.max(20_000,num(rule?.min_salary_staff,40_000));
  const max=Math.max(min,num(rule?.max_salary_staff,300_000));
  return {min,max};
}
export function staffCoreFor(gs,staffId){
  const id=text(staffId);
  return staffCoreRows(gs).find((row)=>staffIdOf(row)===id)||null;
}
export function isStaffRoleHireable(role){
  return HIREABLE_ROLE_SET.has(canonicalStaffRole(role));
}
export function staffPrimaryRole(gs,staffId){
  const row=staffCoreFor(gs,staffId);
  return canonicalStaffRole(row?.role_primary??row?.role??row?.position??"staff");
}
export function staffMarketRoles(gs,staffId){
  const role=staffPrimaryRole(gs,staffId);
  return isStaffRoleHireable(role)?[role]:[];
}
export function staffActiveContract(gs,staffId){
  const id=text(staffId);
  return activeStaffContracts(gs).find((contract)=>resolveStaffId(gs,contract)===id)||null;
}
export function staffExpectedSalary(gs,staffId,role){
  const {min,max}=staffSalaryBounds(gs);
  const score=staffMarketScore(gs,staffId,role);
  const ratio=Math.max(0,Math.min(1,score/100));
  return Math.round((min+(max-min)*ratio*ratio)/5_000)*5_000;
}
export function staffTeamBudget(gs,teamId){
  return teamBudgetAvailable(gs,teamId);
}
export function staffTeamReputation(gs,teamId){
  let value=50;
  try{
    const resolved=Number(teamReputation(gs,teamId));
    if(Number.isFinite(resolved))value=resolved;
  }catch{}
  return value;
}
export function staffWillConsiderTeam(gs,teamId,staffId){
  const reputation=staffReputation(staffRatingForYear(gs,staffId));
  return staffTeamReputation(gs,teamId)+55>=reputation;
}
export function staffSalaryAffordable(gs,teamId,salary){
  const {max}=staffSalaryBounds(gs);
  if(num(salary)>max*1.05)return false;
  const budget=staffTeamBudget(gs,teamId);
  if(!Number.isFinite(budget))return true;
  return num(salary)<=Math.max(50_000,budget*0.12);
}
export function staffTerminationCost(gs,contract){
  if(!contract)return 0;
  const salary=Math.max(0,num(contract?.salary??contract?.salary_yearly,0));
  const year=Number(gs?.activeYear);
  const until=contractEndYear(contract,year);
  const years=Math.max(1,Number.isFinite(until)&&Number.isFinite(year)?until-year+1:1);
  return Math.round(salary*years*0.45);
}
export function staffRoleIncumbent(gs,teamId,role){
  const canonical=canonicalStaffRole(role);
  return activeStaffContracts(gs,{teamId:text(teamId)})
    .filter((contract)=>staffContractRole(contract)===canonical)
    .sort((a,b)=>{
      const aId=resolveStaffId(gs,a);
      const bId=resolveStaffId(gs,b);
      const aScore=staffRoleRating(staffRatingForYear(gs,aId),canonical).score??50;
      const bScore=staffRoleRating(staffRatingForYear(gs,bId),canonical).score??50;
      return bScore-aScore;
    })[0]||null;
}
export function staffMarketCandidate(gs,staffId,role=null){
  const id=text(staffId);
  const staff=staffCoreFor(gs,id);
  if(!staff)return null;
  const roles=staffMarketRoles(gs,id);
  const chosen=canonicalStaffRole(role||roles[0]||staffPrimaryRole(gs,id));
  const rating=staffRatingForYear(gs,id);
  return {
    staff,
    staff_id:id,
    role:chosen,
    roles,
    role_score:staffRoleRating(rating,chosen).score??50,
    market_score:staffMarketScore(gs,id,chosen),
    reputation:staffReputation(rating),
    expected_salary:staffExpectedSalary(gs,id,chosen),
  };
}
export function staffNegotiationEligibility(gs,{staffId,teamId,role=null}={}){
  const id=text(staffId);
  const tid=text(teamId);
  if(!id)return {canNegotiate:false,reason:"unknown_staff",roles:[]};
  if(!tid)return {canNegotiate:false,reason:"no_team",roles:[]};
  const staff=staffCoreFor(gs,id);
  if(!staff)return {canNegotiate:false,reason:"unknown_staff",roles:[]};
  if(!staffAliveForDate(staff,dateOnly(gs?.currentDateISO))){
    return {canNegotiate:false,reason:"unavailable",roles:[]};
  }
  const active=staffActiveContract(gs,id);
  if(active){
    return {
      canNegotiate:false,
      reason:"contracted",
      roles:[],
      contract:active,
    };
  }
  const roles=staffMarketRoles(gs,id);
  if(!roles.length){
    return {
      canNegotiate:false,
      reason:"non_hireable_role",
      roles:[],
      primaryRole:staffPrimaryRole(gs,id),
    };
  }
  const requested=role?canonicalStaffRole(role):roles[0];
  if(!roles.includes(requested)){
    return {canNegotiate:false,reason:"role_unavailable",roles};
  }
  if(!staffWillConsiderTeam(gs,tid,id)){
    return {canNegotiate:false,reason:"not_interested",roles};
  }
  const expectedSalary=staffExpectedSalary(gs,id,requested);
  if(!staffSalaryAffordable(gs,tid,expectedSalary)){
    return {
      canNegotiate:false,
      reason:"budget",
      roles,
      expectedSalary,
    };
  }
  const incumbent=staffRoleIncumbent(gs,tid,requested);
  return {
    canNegotiate:true,
    reason:"available",
    roles,
    role:requested,
    expectedSalary,
    incumbent,
    replacementCost:staffTerminationCost(gs,incumbent),
  };
}
