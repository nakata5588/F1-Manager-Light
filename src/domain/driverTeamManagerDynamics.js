// src/domain/driverTeamManagerDynamics.js
import { applyDriverRelationshipChange } from "./relationshipEvents.js";

const text=(value)=>String(value??"").trim();
const slot=(role)=>{
  const value=text(role).toLowerCase().replace(/[\s-]+/g,"_");
  if(/reserve/.test(value))return "reserve";
  if(/test|tester/.test(value))return "test";
  if(/second|driver_?2/.test(value))return "second";
  return "main";
};
const rank={test:0,reserve:1,second:2,main:3};

function isPlayerTeam(gs,teamId){
  return text(gs?.team?.team_id??gs?.team?.id)===text(teamId);
}

function relationContext({role=null,contractUntil=null,kind=null}={}){
  return {
    expected_role:role?text(role):undefined,
    expected_role_slot:role?slot(role):undefined,
    contract_until:contractUntil??undefined,
    contract_kind:kind??undefined,
  };
}

function applyTeamAndManager(gs,{
  driverId,
  teamId,
  teamDeltas={},
  managerDeltas=null,
  source,
  reason,
  meta=null,
  patch={},
  active=true,
}={}){
  const did=text(driverId),tid=text(teamId);
  if(!did||!tid)return gs;
  let next=applyDriverRelationshipChange(gs,{
    driverId:did,
    targetType:"team",
    targetId:tid,
    teamId:tid,
    deltas:teamDeltas,
    source,
    reason,
    meta,
    patch,
    active,
  });
  if(isPlayerTeam(next,tid)&&managerDeltas){
    next=applyDriverRelationshipChange(next,{
      driverId:did,
      targetType:"manager",
      targetId:"player_manager",
      teamId:tid,
      deltas:managerDeltas,
      source,
      reason,
      meta,
      patch,
      active,
    });
  }
  return next;
}

export function applyAcceptedContractRelationship(gs,{
  driverId,
  teamId,
  role,
  kind="new_contract",
  salary=null,
  expectedSalary=null,
  contractUntil=null,
}={}){
  const renewal=kind==="renewal";
  const salaryRatio=Number(expectedSalary)>0&&Number.isFinite(Number(salary))
    ?Number(salary)/Number(expectedSalary)
    :1;
  const premium=salaryRatio>=1.08?0.6:salaryRatio<0.88?-0.35:0;
  return applyTeamAndManager(gs,{
    driverId,teamId,
    teamDeltas:{
      trust:renewal?1.2:0.6,
      respect:renewal?0.8:0.4,
      affinity:renewal?0.5:0.2,
      satisfaction:(renewal?1.8:1.0)+premium,
    },
    managerDeltas:{
      trust:renewal?1.8:0.9,
      respect:renewal?1.0:0.5,
      affinity:renewal?0.8:0.35,
      satisfaction:(renewal?2.2:1.3)+premium,
    },
    source:renewal?"contract_renewal":"contract_signing",
    reason:renewal?"Contract renewed":"Contract agreed",
    meta:{kind,role,salary:Number(salary)||null,expected_salary:Number(expectedSalary)||null},
    patch:relationContext({role,contractUntil,kind}),
    active:true,
  });
}

export function applyFailedRenewalRelationship(gs,{
  driverId,
  teamId,
  role=null,
  reason="Renewal offer rejected",
}={}){
  if(!isPlayerTeam(gs,teamId))return gs;
  return applyTeamAndManager(gs,{
    driverId,teamId,
    teamDeltas:{trust:-0.4,satisfaction:-0.7},
    managerDeltas:{trust:-0.8,affinity:-0.4,satisfaction:-1.1},
    source:"renewal_rejected",
    reason,
    meta:{role},
    active:true,
  });
}

export function applyDriverReleaseRelationship(gs,{
  driverId,
  teamId,
  reason="Released by team",
}={}){
  return applyTeamAndManager(gs,{
    driverId,teamId,
    teamDeltas:{trust:-7,respect:-2,affinity:-5,satisfaction:-12},
    managerDeltas:{trust:-11,respect:-3,affinity:-8,satisfaction:-15},
    source:"contract_release",
    reason,
    meta:null,
    patch:{expected_role:null,expected_role_slot:null},
    active:false,
  });
}

export function applyDriverRoleTeamRelationship(gs,{
  driverId,
  teamId,
  fromRole,
  toRole,
}={}){
  const from=slot(fromRole),to=slot(toRole);
  const diff=(rank[to]??0)-(rank[from]??0);
  if(!diff)return gs;
  const promotion=diff>0;
  const magnitude=Math.min(2,Math.abs(diff));
  return applyTeamAndManager(gs,{
    driverId,teamId,
    teamDeltas:promotion
      ?{respect:0.4*magnitude,satisfaction:0.8*magnitude,trust:0.25*magnitude}
      :{trust:-0.6*magnitude,affinity:-0.5*magnitude,satisfaction:-1.3*magnitude},
    managerDeltas:promotion
      ?{respect:0.55*magnitude,affinity:0.35*magnitude,satisfaction:1.0*magnitude}
      :{trust:-0.9*magnitude,affinity:-0.8*magnitude,satisfaction:-1.7*magnitude},
    source:promotion?"role_promotion":"role_demotion",
    reason:promotion?"Role promotion":"Role demotion",
    meta:{from_role:fromRole,to_role:toRole},
    patch:{current_role:text(toRole),current_role_slot:to},
    active:true,
  });
}
