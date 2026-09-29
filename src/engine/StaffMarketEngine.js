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
  contractStartYear,
  staffIdOf,
  teamIdOfContract,
} from "../domain/liveContracts.js";
import {
  canonicalStaffRole,
  resolveStaffId,
  staffContractRole,
} from "../domain/staffRoles.js";
import {
  staffMarketScore,
  staffRatingForYear,
  staffRoleRating,
  teamStaffCapability,
} from "../domain/staffPerformance.js";
import {
  STAFF_HIREABLE_ROLES,
  staffExpectedSalary,
  staffMarketRoles,
  staffSalaryAffordable,
  staffWillConsiderTeam,
} from "../domain/staffMarket.js";
import { canAffordStaffTransfer, staffBuyoutQuote } from "../domain/staffTransfers.js";
import {
  isStaffNegotiationActive,
  staffNegotiations,
  startStaffNegotiation,
} from "./StaffNegotiationEngine.js";

const MANAGED_ROLES=STAFF_HIREABLE_ROLES;
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
function roleScore(gs,contract){
  const id=resolveStaffId(gs,contract)||staffIdOf(contract);
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
  return new Map(
    activeStaffContracts(gs)
      .map((contract)=>[resolveStaffId(gs,contract)||staffIdOf(contract),contract])
      .filter(([id])=>Boolean(id))
  );
}
function freeCandidates(gs,role){
  const contracted=activeContractByStaff(gs);
  const today=dateOnly(gs?.currentDateISO);
  return staffCoreRows(gs)
    .filter((row)=>{
      const id=staffIdOf(row);
      return id
        &&!contracted.has(id)
        &&staffAliveForDate(row,today)
        &&staffMarketRoles(gs,id).includes(canonicalStaffRole(role));
    })
    .map((row)=>{
      const id=staffIdOf(row);
      const salary=staffExpectedSalary(gs,id,role);
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
function contractedUpgradeCandidates(gs,buyerTeamId,role,currentScore,{upgradeGap=12}={}){
  const year=Number(gs?.activeYear);
  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  const pendingStaff=new Set(
    staffNegotiations(gs)
      .filter(isStaffNegotiationActive)
      .map((row)=>text(row?.staff_id))
      .filter(Boolean)
  );
  return activeStaffContracts(gs)
    .filter((contract)=>{
      const sellerTeamId=teamIdOfContract(contract);
      if(!sellerTeamId||sellerTeamId===text(buyerTeamId)||sellerTeamId===playerTeamId)return false;
      if(staffContractRole(contract)!==canonicalStaffRole(role))return false;
      if(contractEndYear(contract,year)<=year)return false;
      if(contractStartYear(contract,year)>=year)return false;
      const id=resolveStaffId(gs,contract)||staffIdOf(contract);
      return Boolean(id)&&!pendingStaff.has(id);
    })
    .map((contract)=>{
      const id=resolveStaffId(gs,contract)||staffIdOf(contract);
      const roleScoreValue=staffRoleRating(staffRatingForYear(gs,id),role).score??50;
      const salary=staffExpectedSalary(gs,id,role);
      const buyout=staffBuyoutQuote(gs,contract,{staffId:id,role});
      return {
        contract,
        staff_id:id,
        role_score:roleScoreValue,
        market_score:staffMarketScore(gs,id,role),
        salary,
        buyout,
      };
    })
    .filter((candidate)=>candidate.role_score>=Number(currentScore||50)+upgradeGap)
    .filter((candidate)=>candidate.buyout?.allowed)
    .filter((candidate)=>staffSalaryAffordable(gs,buyerTeamId,candidate.salary))
    .filter((candidate)=>canAffordStaffTransfer(gs,buyerTeamId,candidate.buyout.fee))
    .filter((candidate)=>staffWillConsiderTeam(gs,buyerTeamId,candidate.staff_id))
    .sort((a,b)=>
      b.role_score-a.role_score
      ||b.market_score-a.market_score
      ||Number(a.buyout?.fee||0)-Number(b.buyout?.fee||0)
      ||a.staff_id.localeCompare(b.staff_id)
    );
}
function hasPendingStaffRole(gs,teamId,role){
  const target=canonicalStaffRole(role);
  return staffNegotiations(gs).some((row)=>
    isStaffNegotiationActive(row)
    &&text(row?.team_id)===text(teamId)
    &&canonicalStaffRole(row?.role??row?.offer?.role)===target
  );
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
  if(hasPendingStaffRole(gs,tid,role))return gs;

  const current=activeStaffContracts(gs,{teamId:tid})
    .filter((contract)=>staffContractRole(contract)===role)
    .sort((a,b)=>roleScore(gs,b)-roleScore(gs,a))[0]||null;
  const currentScore=current?roleScore(gs,current):null;
  const free=freeCandidates(gs,role)
    .filter((candidate)=>staffSalaryAffordable(gs,tid,candidate.salary))
    .filter((candidate)=>staffWillConsiderTeam(gs,tid,candidate.staff_id));
  const bestFree=free[0]||null;

  if(!current){
    if(!bestFree)return gs;
    const contracts=currentStaffContracts(gs);
    contracts.push(signingContract(gs,team,role,bestFree));
    return replaceStaffContracts(gs,contracts);
  }

  if(bestFree&&bestFree.role_score>=currentScore+upgradeGap){
    const today=dateOnly(gs?.currentDateISO);
    const year=Number(gs?.activeYear);
    const contracts=currentStaffContracts(gs).map((contract)=>
      contract===current?releaseContract(contract,today,year,"ai_staff_upgrade"):contract
    );
    contracts.push(signingContract(gs,team,role,bestFree));
    return replaceStaffContracts(gs,contracts);
  }

  // Contracted poaching is deliberately rarer than free-agent upgrades.
  // It only targets a clearly stronger AI-team incumbent (+12 OVR), never
  // the player's Staff until an incoming-offer decision flow exists.
  const poach=contractedUpgradeCandidates(gs,tid,role,currentScore,{upgradeGap:12})[0]||null;
  if(!poach)return gs;
  return startStaffNegotiation(gs,{
    staffId:poach.staff_id,
    teamId:tid,
    teamName:team?.team_name||team?.name||tid,
    offer:{
      salary:poach.salary,
      years:poach.role_score>=84?2:1,
      role,
    },
    origin:"ai",
  });
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
    const alternative=freeCandidates(gs,role)
      .filter((candidate)=>staffSalaryAffordable(gs,tid,candidate.salary))
      .filter((candidate)=>staffWillConsiderTeam(gs,tid,candidate.staff_id))[0]||null;
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
    const expected=staffExpectedSalary(gs,id,role);
    const current=Math.max(0,num(contract?.salary??contract?.salary_yearly,0));
    const salary=Math.max(current,expected);
    if(!staffSalaryAffordable(gs,tid,salary)){
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
