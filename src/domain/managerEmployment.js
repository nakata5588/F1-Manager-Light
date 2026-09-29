// src/domain/managerEmployment.js
// Canonical player employment model.
//
// The player is the Team Principal of the controlled team. Historical Staff
// data remains factual seed data, but once the Save World begins the player's
// appointment occupies that role and any historical incumbent is released.

import { deriveBoardState } from "./boardState.js";
import { activeStaffContracts, teamIdOfContract } from "./liveContracts.js";
import { managerDisplayName } from "./managerProfile.js";
import { staffContractRole } from "./staffRoles.js";
import { synchronizeDriverRelationships } from "./driverRelationships.js";

const text=(value)=>String(value??"").trim();
const clamp01=(value)=>Math.max(0,Math.min(1,Number(value)||0));

export const PLAYER_MANAGER_ROLE="team_principal";
export const PLAYER_MANAGER_ROLE_LABEL="Team Principal";

export function playerManagerTeamId(gs){
  return text(gs?.manager?.current_team_id??gs?.team?.team_id??gs?.team?.id);
}

export function playerManagerIsActiveTeamPrincipal(gs,teamId=null){
  const manager=gs?.manager;
  if(!manager)return false;
  const job=manager?.current_job||{};
  const status=text(job?.status||"active").toLowerCase();
  if(status!=="active")return false;
  const assigned=text(job?.team_id??manager?.current_team_id??gs?.team?.team_id??gs?.team?.id);
  const target=text(teamId??assigned);
  return Boolean(assigned)&&assigned===target;
}

function closeHistoricalPrincipal(contract,gs){
  const year=Number(gs?.activeYear);
  const date=text(gs?.currentDateISO).slice(0,10)||null;
  return {
    ...contract,
    status:"released",
    released_at:date,
    release_reason:"player_manager_appointment",
    contract_until_year:year,
    contract_until:year,
    end_year:year,
  };
}

export function applyPlayerManagerTeamPrincipalAppointment(gs){
  if(!gs||!playerManagerIsActiveTeamPrincipal(gs))return gs;
  const teamId=playerManagerTeamId(gs);
  let changed=false;
  const contracts=(Array.isArray(gs?.staffContracts)?gs.staffContracts:[]).map((contract)=>{
    if(teamIdOfContract(contract)!==teamId)return contract;
    if(staffContractRole(contract)!==PLAYER_MANAGER_ROLE)return contract;
    const status=text(contract?.status||"active").toLowerCase();
    if(["released","terminated","expired","inactive","void","bought_out"].includes(status))return contract;
    changed=true;
    return closeHistoricalPrincipal(contract,gs);
  });
  if(!changed)return synchronizeDriverRelationships(gs,{source:"player_manager_team_principal"});
  return synchronizeDriverRelationships({...gs,staffContracts:contracts},{source:"player_manager_team_principal"});
}

export function managerEmploymentAssessment(gs){
  const manager=gs?.manager;
  if(!manager){
    return {
      status:"unavailable",
      label:"No Manager Profile",
      score:null,
      jobSecurity:null,
      canBeDismissed:false,
      races:0,
      seasonProgress:0,
      boardConfidence:null,
      objectiveScore:null,
    };
  }

  const active=playerManagerIsActiveTeamPrincipal(gs);
  if(!active){
    return {
      status:"unemployed",
      label:"Unattached",
      score:0,
      jobSecurity:0,
      canBeDismissed:false,
      races:0,
      seasonProgress:0,
      boardConfidence:null,
      objectiveScore:null,
    };
  }

  const board=deriveBoardState(gs);
  const races=Math.max(0,Number(board?.metrics?.races||0));
  const totalRaces=Math.max(1,Number(board?.metrics?.totalRaces||1));
  const seasonProgress=clamp01(races/totalRaces);
  const objectiveScore=clamp01(board?.objectiveScore??0.5);
  const boardConfidence=clamp01(board?.confidence??0.5);

  // Early-season protection prevents one or two poor races from behaving like
  // a mature dismissal decision. As the season progresses, board confidence
  // and objective delivery increasingly determine employment security.
  const maturity=clamp01(seasonProgress/0.5);
  const protectedBaseline=0.58;
  const liveScore=boardConfidence*0.62+objectiveScore*0.38;
  const security=clamp01(protectedBaseline*(1-maturity)+liveScore*maturity);

  let status="secure";
  let label="Secure";
  if(seasonProgress<0.20){
    status="evaluating";
    label="Evaluating";
  }else if(security<0.22){
    status="critical";
    label="Critical";
  }else if(security<0.38){
    status="under_pressure";
    label="Under Pressure";
  }else if(security<0.58){
    status="stable";
    label="Stable";
  }

  return {
    status,
    label,
    score:Number(security.toFixed(3)),
    jobSecurity:Math.round(security*100),
    canBeDismissed:seasonProgress>=0.35&&races>=5,
    races,
    totalRaces,
    seasonProgress:Number(seasonProgress.toFixed(3)),
    boardConfidence:Number(boardConfidence.toFixed(3)),
    objectiveScore:Number(objectiveScore.toFixed(3)),
    expectation:board?.expectation??null,
    managerName:managerDisplayName(manager),
    teamId:playerManagerTeamId(gs),
  };
}
