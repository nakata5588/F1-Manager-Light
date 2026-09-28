// src/engine/StaffMarketEngine.js
// Deterministic AI Staff recruitment/retention.
//
// Staff hiring is role-specific and uses the same canonical role rating shown
// in the UI. The engine only manages roles already represented in the current
// era, so missing historical role coverage is not mistaken for a vacancy.

import {
  activeStaffContracts,
  collectionRows,
  contractEndYear,
  staffIdOf,
  teamIdOfContract,
} from "../domain/liveContracts.js";
import {
  canonicalStaffRole,
  staffContractRole,
} from "../domain/staffRoles.js";
import {
  staffMarketScore,
  staffRatingForYear,
  staffReputation,
  staffRoleRating,
  teamStaffCapability,
} from "../domain/staffPerformance.js";
import { teamReputation } from "../domain/teamReputation.js";

const MANAGED_ROLES=Object.freeze([
  "team_principal",
  "technical_director",
  "chief_designer",
  "chief_engineer",
  "chief_strategist",
  "race_engineer",
]);
const MANAGED_ROLE_SET=new Set(MANAGED_ROLES);

const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"");
const dateOnly=(value)=>text(value).slice(0,10);

function teamIdOf(row){
  return text(row?.team_id??row?.id??row?.constructor_id);
}
function staffCoreRows(gs){
  const live=collectionRows(gs?.staffCore);
  return live.length?live:collectionRows(gs?.dbStaffCore);
}
function teamRows(gs){
  const live=collectionRows(gs?.teams);
  return live.length?live:collectionRows(gs?.dbTeams);
}
function currentStaffContracts(gs){
  return collectionRows(gs?.staffContracts);
}
function staffName(row){
  return text(row?.staff_name??row?.display_name??row?.name??row?.person_name);
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
function salaryBounds(gs){
  const rule=financialRule(gs);
  const min=Math.max(20_000,num(rule?.min_salary_staff,40_000));
  const max=Math.max(min,num(rule?.max_salary_staff,300_000));
  return {min,max};
}
function teamBudget(gs,teamId){
  const id=text(teamId);
  const aiBudget=num(gs?.aiTechnicalWorld?.teams?.[id]?.budget,NaN);
  if(Number.isFinite(aiBudget))return aiBudget;
  const team=teamRows(gs).find((row)=>teamIdOf(row)===id);
  const direct=num(team?.budget??team?.cash??team?.balance,NaN);
  return Number.isFinite(direct)?direct:NaN;
}
function expectedStaffSalary(gs,staffId,role){
  const {min,max}=salaryBounds(gs);
  const score=staffMarketScore(gs,staffId,role);
  const ratio=Math.max(0,Math.min(1,score/100));
  return Math.round((min+(max-min)*ratio*ratio)/5_000)*5_000;
}
function staffWillingToJoin(gs,teamId,candidate){
  const reputation=staffReputation(staffRatingForYear(gs,candidate.staff_id));
  let teamRep=50;
  try{
    const value=Number(teamReputation(gs,teamId));
    if(Number.isFinite(value))teamRep=value;
  }catch{}
  // Free agents can move upward or sideways freely. The very highest-profile
  // Staff require at least a credible team; this is market willingness, not a
  // technical-performance modifier.
  return teamRep+45>=reputation;
}
function affordableStaffSalary(gs,teamId,salary){
  const {max}=salaryBounds(gs);
  if(num(salary)>max*1.05)return false;
  const budget=teamBudget(gs,teamId);
  if(!Number.isFinite(budget))return true;
  // Salary is annual. Keep a meaningful reserve for the technical programme
  // instead of allowing Staff recruitment to consume the whole team budget.
  return num(salary)<=Math.max(50_000,budget*0.12);
}
function roleScore(gs,contract){
  const id=staffIdOf(contract);
  return staffRoleRating(staffRatingForYear(gs,id),staffContractRole(contract)).score??50;
}
function representedRoles(gs){
  const roles=new Set(
    activeStaffContracts(gs)
      .map(staffContractRole)
      .filter((role)=>MANAGED_ROLE_SET.has(role))
  );
  return MANAGED_ROLES.filter((role)=>roles.has(role));
}
function activeContractByStaff(gs){
  return new Map(activeStaffContracts(gs).map((contract)=>[staffIdOf(contract),contract]));
}
function freeCandidates(gs,role){
  const contracted=activeContractByStaff(gs);
  const today=dateOnly(gs?.currentDateISO);
  return staffCoreRows(gs)
    .filter((row)=>{
      const id=staffIdOf(row);
      return id&&!contracted.has(id)&&staffAliveForDate(row,today);
    })
    .map((row)=>{
      const id=staffIdOf(row);
      const salary=expectedStaffSalary(gs,id,role);
      return {
        staff:row,
        staff_id:id,
        score:staffMarketScore(gs,id,role),
        role_score:staffRoleRating(staffRatingForYear(gs,id),role).score??50,
        salary,
      };
    })
    .sort((a,b)=>b.score-a.score||b.role_score-a.role_score||a.staff_id.localeCompare(b.staff_id));
}
function capabilityPriority(gs,teamId,role){
  if(["technical_director","chief_designer","chief_engineer"].includes(role)){
    return 100-teamStaffCapability(gs,teamId,"technical_program");
  }
  if(role==="chief_strategist")return 100-teamStaffCapability(gs,teamId,"strategy");
  if(role==="race_engineer")return 100-teamStaffCapability(gs,teamId,"setup");
  if(role==="team_principal")return 100-teamStaffCapability(gs,teamId,"team_environment");
  return 50;
}
function releaseContract(contract,today,year,reason){
  return {
    ...contract,
    status:"released",
    released_at:today,
    release_reason:reason,
    contract_until_year:year,
    contract_until:year,
    end_year:year,
  };
}
function signingContract(gs,team,role,candidate){
  const year=Number(gs?.activeYear);
  const today=dateOnly(gs?.currentDateISO);
  const duration=candidate.role_score>=82?2:1;
  return {
    year,
    team_id:teamIdOf(team),
    team_name:team?.team_name||team?.name||teamIdOf(team),
    staff_id:candidate.staff_id,
    staff_name:staffName(candidate.staff)||candidate.staff_id,
    role:canonicalStaffRole(role),
    contract_start_year:year,
    contract_start:year,
    contract_until_year:year+duration,
    contract_until:year+duration,
    salary:candidate.salary,
    status:"active",
    source:"ai_staff_market",
    signed_at:today,
  };
}
function replaceStaffContracts(gs,contracts){
  return {...gs,staffContracts:contracts};
}
function fillOrUpgradeRole(gs,team,role,{upgradeGap=8}={}){
  const tid=teamIdOf(team);
  const current=activeStaffContracts(gs,{teamId:tid})
    .filter((contract)=>staffContractRole(contract)===role)
    .sort((a,b)=>roleScore(gs,b)-roleScore(gs,a))[0]||null;
  const candidates=freeCandidates(gs,role)
    .filter((candidate)=>affordableStaffSalary(gs,tid,candidate.salary))
    .filter((candidate)=>staffWillingToJoin(gs,tid,candidate));
  const best=candidates[0]||null;
  if(!best)return gs;

  const currentScore=current?roleScore(gs,current):null;
  if(current&&best.role_score<currentScore+upgradeGap)return gs;

  const today=dateOnly(gs?.currentDateISO);
  const year=Number(gs?.activeYear);
  const contracts=currentStaffContracts(gs).map((contract)=>
    contract===current?releaseContract(contract,today,year,"ai_staff_upgrade"):contract
  );
  contracts.push(signingContract(gs,team,role,best));
  return replaceStaffContracts(gs,contracts);
}
function renewExpiringStaff(gs,team,roles){
  const year=Number(gs?.activeYear);
  const tid=teamIdOf(team);
  const contracts=currentStaffContracts(gs);
  let changed=false;
  const next=contracts.map((contract)=>{
    if(teamIdOfContract(contract)!==tid)return contract;
    const role=staffContractRole(contract);
    if(!roles.includes(role))return contract;
    if(contractEndYear(contract,year)!==year)return contract;
    if(Number(contract?.ai_staff_renewal_year)===year)return contract;

    const incumbentScore=roleScore(gs,contract);
    const alternative=freeCandidates(gs,role)[0]||null;
    const materialUpgrade=alternative&&alternative.role_score>=incumbentScore+8;
    const retain=incumbentScore>=58&&!materialUpgrade;
    changed=true;
    if(!retain){
      return {
        ...contract,
        ai_staff_renewal_year:year,
        ai_staff_renewal_plan:"release_end",
      };
    }

    const id=staffIdOf(contract);
    const expected=expectedStaffSalary(gs,id,role);
    const current=Math.max(0,num(contract?.salary??contract?.salary_yearly,0));
    const salary=Math.max(current,expected);
    if(!affordableStaffSalary(gs,tid,salary)){
      return {
        ...contract,
        ai_staff_renewal_year:year,
        ai_staff_renewal_plan:"release_end_budget",
      };
    }
    const duration=incumbentScore>=82?2:1;
    return {
      ...contract,
      salary,
      contract_until_year:year+duration,
      contract_until:year+duration,
      end_year:year+duration,
      ai_staff_renewal_year:year,
      ai_staff_renewal_plan:"renew",
      renewal_source:"ai_staff_market",
    };
  });
  return changed?replaceStaffContracts(gs,next):gs;
}

export function applyStaffMarketTick(gs){
  if(!gs||!Array.isArray(gs?.staffContracts))return gs;
  const currentDate=dateOnly(gs?.currentDateISO);
  if(!currentDate)return gs;
  const month=currentDate.slice(0,7);
  if(gs?._lastAIStaffMarketMonth===month)return gs;

  const teams=teamRows(gs);
  if(!teams.length)return {...gs,_lastAIStaffMarketMonth:month};
  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  const roles=representedRoles(gs);
  if(!roles.length)return {...gs,_lastAIStaffMarketMonth:month};

  let next={...gs};
  const monthNumber=Number(currentDate.slice(5,7));
  const aiTeams=teams
    .filter((team)=>teamIdOf(team)&&teamIdOf(team)!==playerTeamId)
    .sort((a,b)=>teamIdOf(a).localeCompare(teamIdOf(b)));

  for(const team of aiTeams){
    const tid=teamIdOf(team);
    if(monthNumber>=7)next=renewExpiringStaff(next,team,roles);

    // Vacancies and upgrades are considered in weakness order. A candidate
    // signed by one team immediately leaves the free market for the next team.
    const priorities=roles.slice().sort((a,b)=>
      capabilityPriority(next,tid,b)-capabilityPriority(next,tid,a)||a.localeCompare(b)
    );
    for(const role of priorities){
      next=fillOrUpgradeRole(next,team,role,{upgradeGap:8});
    }
  }

  return {...next,_lastAIStaffMarketMonth:month};
}
