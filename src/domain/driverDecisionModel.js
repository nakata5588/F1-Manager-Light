// src/domain/driverDecisionModel.js
// D7.1 — central Driver Decision Model.
//
// Contract economics remain one input, but the final decision also reads the
// live Save World: career stage, role ambition, team competitiveness, morale
// and persistent relationships. Historical data may seed those systems; it
// never hard-codes a historical career outcome.

import {
  activeDriverContract,
  contractAcceptanceChance,
  expectedDriverSalary,
  ratingForDriver,
  teamIdOf,
} from "./driverContracts.js";
import { driverLifecycleState } from "./driverLifecycle.js";
import { driverMarketEvaluation } from "./driverMarketEvaluation.js";
import {
  driverProfessionalRelationshipClimate,
  relationshipRenewalAcceptanceDelta,
} from "./driverRelationshipConsequences.js";

export const DRIVER_DECISION_MODEL_VERSION=1;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const round2=(value)=>Math.round(Number(value||0)*100)/100;
const text=(value)=>String(value??"").trim();

function finite(value,fallback=null){
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
}

function driverCondition(gs,driverId){
  const raw=text(driverId);
  const direct=gs?.driverAttributes?.[raw];
  if(direct&&typeof direct==="object")return direct;
  const digits=raw.match(/(\d+)/)?.[1]?.padStart(4,"0");
  const compat=digits?gs?.driverAttributes?.[digits]:null;
  return compat&&typeof compat==="object"?compat:{};
}

function roleRank(role){
  const key=text(role).toLowerCase().replace(/[_-]+/g," ");
  if(/main|first|lead|driver 1/.test(key))return 4;
  if(/second|driver 2|race driver/.test(key))return 3;
  if(/reserve/.test(key))return 2;
  if(/test|tester/.test(key))return 1;
  return 2;
}

function roleLabel(role){
  const rank=roleRank(role);
  if(rank===4)return "Main Driver";
  if(rank===3)return "Second Driver";
  if(rank===2)return "Reserve Driver";
  return "Test Driver";
}

function stageAdjustment(stage){
  return {
    youth:-10,
    rookie:-2,
    developing:7,
    prime:10,
    veteran:6,
    decline:-3,
    retirement_window:-12,
  }[String(stage||"")]??0;
}

function securityBaseline(stage){
  return {
    youth:66,
    rookie:62,
    developing:60,
    prime:48,
    veteran:58,
    decline:70,
    retirement_window:78,
  }[String(stage||"")]??55;
}

function riskStageAdjustment(stage){
  return {
    youth:8,
    rookie:6,
    developing:5,
    prime:3,
    veteran:-2,
    decline:-7,
    retirement_window:-12,
  }[String(stage||"")]??0;
}

function ratingNumber(rating,keys,fallback=50){
  for(const key of keys){
    const value=finite(rating?.[key],null);
    if(value!==null)return value;
  }
  return fallback;
}

function teamStandingRows(gs){
  const standings=gs?.standings||{};
  if(Array.isArray(standings.teams))return standings.teams;
  if(Array.isArray(standings.constructors))return standings.constructors;
  return [];
}

function standingTeamId(row){
  return text(row?.team_id??row?.constructor_id??row?.id);
}

export function driverTeamCompetitiveness(gs,teamId){
  const tid=text(teamId);
  if(!tid)return {known:false,score:50,position:null,team_count:0,label:"Unknown"};
  const rows=teamStandingRows(gs);
  const row=rows.find((item)=>standingTeamId(item)===tid);
  if(!row||!rows.length)return {known:false,score:50,position:null,team_count:rows.length,label:"Unknown"};

  const position=finite(row?.position??row?.pos,null);
  const count=Math.max(1,rows.length);
  if(position===null){
    return {known:false,score:50,position:null,team_count:count,label:"Unknown"};
  }
  const normalized=count<=1?1:1-clamp((position-1)/(count-1),0,1);
  const score=round2(30+normalized*60);
  return {
    known:true,
    score,
    position,
    team_count:count,
    label:score>=78?"Front-running":score>=62?"Competitive":score>=45?"Midfield":"Backmarker",
  };
}

export function driverDecisionTraits(gs,driverId){
  const did=text(driverId);
  const lifecycle=driverLifecycleState(gs,did);
  const evaluation=driverMarketEvaluation(gs,did);
  const rating=ratingForDriver(gs,did)||{};
  const currentContract=activeDriverContract(gs,did);
  const currentTeamId=currentContract?teamIdOf(currentContract):"";
  const currentClimate=currentTeamId
    ?driverProfessionalRelationshipClimate(gs,did,{teamId:currentTeamId})
    :{score:50,known_parts:0};

  const mentality=ratingNumber(rating,["mentality","pressure_handling"],50);
  const teamPlayer=ratingNumber(rating,["team_player","leadership"],50);
  const aggression=ratingNumber(rating,["aggression","agression"],50);

  const ambition=clamp(
    48+
    (Number(evaluation?.score||55)-55)*0.72+
    stageAdjustment(lifecycle?.stage)+
    (mentality-50)*0.12,
    20,
    95
  );

  const relationshipBase=currentClimate?.known_parts?Number(currentClimate.score):50;
  const contractStart=finite(currentContract?.contract_start_year??currentContract?.start_year??currentContract?.year,null);
  const year=finite(gs?.activeYear,null);
  const tenure=contractStart!==null&&year!==null?Math.max(0,year-contractStart):0;
  const loyalty=currentContract
    ?clamp(relationshipBase*0.62+teamPlayer*0.30+Math.min(8,tenure*2)+4,20,95)
    :clamp(48+(teamPlayer-50)*0.25,30,70);

  const security=clamp(
    securityBaseline(lifecycle?.stage)-
    Math.max(0,Number(evaluation?.score||55)-70)*0.18,
    30,
    90
  );

  const riskAppetite=clamp(
    50+
    (aggression-50)*0.34+
    (mentality-50)*0.12+
    riskStageAdjustment(lifecycle?.stage),
    20,
    85
  );

  const desiredRoleRank=ambition>=78?4:ambition>=62?3:ambition>=46?2:1;

  return {
    ambition:round2(ambition),
    loyalty:round2(loyalty),
    security:round2(security),
    risk_appetite:round2(riskAppetite),
    desired_role_rank:desiredRoleRank,
    desired_role:desiredRoleRank===4?"Main Driver":desiredRoleRank===3?"Second Driver":desiredRoleRank===2?"Reserve Driver":"Test Driver",
    career_stage:lifecycle?.stage||"unknown",
    career_stage_label:lifecycle?.label||"Unknown",
    market_score:round2(Number(evaluation?.score||55)),
  };
}

function factor(key,label,delta,detail,source){
  return {
    key,
    label,
    delta:round2(delta),
    direction:delta>0.001?"positive":delta<-0.001?"negative":"neutral",
    detail,
    source,
  };
}

function roleDecisionFactor({traits,lifecycle,currentContract,offer,kind}){
  const offered=roleRank(offer?.role);
  const desired=Number(traits?.desired_role_rank||2);
  let delta=0;
  const gap=offered-desired;
  if(gap<0)delta+=Math.max(-0.18,gap*0.065);
  if(gap>0)delta+=Math.min(0.08,gap*0.035);

  const stage=String(lifecycle?.stage||"");
  if(stage==="youth"&&(offered===1||offered===2))delta+=0.05;
  if(stage==="rookie"&&offered>=3)delta+=0.05;
  if(stage==="retirement_window"&&offered<=2)delta-=0.05;

  if(kind==="transfer"&&currentContract){
    const current=roleRank(currentContract?.role);
    const step=offered-current;
    if(step>0)delta+=Math.min(0.10,step*0.05);
    if(step<0)delta+=Math.max(-0.12,step*0.06);
  }

  return factor(
    "role_fit",
    "Role fit",
    clamp(delta,-0.20,0.15),
    roleLabel(offer?.role)+" offered · "+(traits?.desired_role||"role preference unavailable"),
    "career_role"
  );
}

function teamDecisionFactor(gs,{targetTeamId,currentTeamId,traits,kind}){
  const target=driverTeamCompetitiveness(gs,targetTeamId);
  const current=currentTeamId?driverTeamCompetitiveness(gs,currentTeamId):null;
  const ambitionWeight=0.08+(Number(traits?.ambition||50)/100)*0.09;
  let delta=0;

  if(kind==="transfer"&&current?.known&&target.known){
    delta=((target.score-current.score)/100)*ambitionWeight;
  }else if(target.known){
    delta=((target.score-50)/100)*ambitionWeight*0.65;
  }

  return {
    factor:factor(
      "team_competitiveness",
      "Team competitiveness",
      clamp(delta,-0.14,0.14),
      target.known
        ?target.label+(current?.known?(" vs "+current.label):"")
        :"No reliable current standings signal",
      "standings"
    ),
    target,
    current,
  };
}

function relationshipDecisionFactor(gs,{driverId,targetTeamId,currentTeamId,kind,traits}){
  if(kind==="renewal"){
    const delta=relationshipRenewalAcceptanceDelta(gs,driverId,{teamId:targetTeamId});
    const climate=driverProfessionalRelationshipClimate(gs,driverId,{teamId:targetTeamId});
    return factor(
      "relationships",
      "Team relationships",
      delta,
      climate?.known_parts?(climate.label+" relationship climate ("+round2(climate.score)+")"):"No relationship history",
      "driver_relationships"
    );
  }

  if(kind==="transfer"&&currentTeamId&&currentTeamId!==targetTeamId){
    const climate=driverProfessionalRelationshipClimate(gs,driverId,{teamId:currentTeamId});
    if(!climate?.known_parts){
      return factor("loyalty","Current-team loyalty",0,"No reliable relationship history","driver_relationships");
    }
    const loyalty=Number(traits?.loyalty||50);
    const climatePull=(Number(climate.score||50)-50)*0.0010;
    const loyaltyPull=(loyalty-50)*0.0009;
    const delta=-clamp(climatePull+loyaltyPull,-0.09,0.09);
    return factor(
      "loyalty",
      "Current-team loyalty",
      delta,
      climate.label+" current-team climate · loyalty "+round2(loyalty),
      "driver_relationships"
    );
  }

  return factor("relationships","Team relationships",0,"No existing relationship with the target team","driver_relationships");
}

function moraleDecisionFactor(gs,{driverId,kind,currentTeamId,targetTeamId}){
  const morale=finite(driverCondition(gs,driverId)?.morale,50);
  let delta=0;
  if(kind==="renewal"){
    delta=clamp((morale-50)*0.0012,-0.06,0.06);
  }else if(kind==="transfer"&&currentTeamId&&currentTeamId!==targetTeamId){
    delta=clamp((50-morale)*0.0008,-0.04,0.04);
  }
  return factor(
    "morale",
    "Current morale",
    delta,
    "Morale "+round2(morale),
    "driver_mental_state"
  );
}

function securityDecisionFactor({traits,lifecycle,offer}){
  const years=clamp(Math.round(Number(offer?.years||1)),1,5);
  const security=Number(traits?.security||55);
  const stage=String(lifecycle?.stage||"");
  let delta=0;

  if(security>=60){
    if(years===1)delta-=0.025+(security-60)*0.0006;
    if(years>=2&&years<=3)delta+=0.025+(security-60)*0.0005;
  }
  if(stage==="retirement_window"&&years>2)delta-=Math.min(0.09,(years-2)*0.045);
  if(stage==="decline"&&years>3)delta-=Math.min(0.06,(years-3)*0.03);
  if((stage==="youth"||stage==="developing")&&years>=2&&years<=4)delta+=0.02;

  return factor(
    "contract_security",
    "Contract security",
    clamp(delta,-0.10,0.07),
    years+" year"+(years===1?"":"s")+" · security preference "+round2(security),
    "career_stage"
  );
}

export function driverDecisionIntent(probability){
  const p=clamp(probability,0,1);
  if(p>=0.78)return {key:"keen",label:"Keen"};
  if(p>=0.62)return {key:"willing",label:"Willing to negotiate"};
  if(p>=0.48)return {key:"open",label:"Open"};
  if(p>=0.32)return {key:"reluctant",label:"Reluctant"};
  return {key:"unlikely",label:"Unlikely"};
}

export function driverContractDecision(gs,{
  driverId,
  teamId,
  offer,
  kind="new_contract",
}={}){
  const did=text(driverId);
  const tid=text(teamId);
  const currentContract=activeDriverContract(gs,did);
  const currentTeamId=currentContract?teamIdOf(currentContract):"";
  const renewal=String(kind)==="renewal";
  const lifecycle=driverLifecycleState(gs,did);
  const traits=driverDecisionTraits(gs,did);
  const expectedSalary=Math.max(1,expectedDriverSalary(gs,did,{role:offer?.role}));
  const offeredSalary=Math.max(0,Number(offer?.salary||0));
  const salaryRatio=offeredSalary/expectedSalary;

  // Existing economics/manager skill becomes the terms baseline. D7.1 then
  // applies explicit career-context factors rather than replacing those rules.
  const baseProbability=contractAcceptanceChance(gs,did,offer,{renewal,teamId:tid});
  const role=roleDecisionFactor({traits,lifecycle,currentContract,offer,kind:String(kind)});
  const team=teamDecisionFactor(gs,{
    targetTeamId:tid,
    currentTeamId,
    traits,
    kind:String(kind),
  });
  const relationship=relationshipDecisionFactor(gs,{
    driverId:did,
    targetTeamId:tid,
    currentTeamId,
    kind:String(kind),
    traits,
  });
  const morale=moraleDecisionFactor(gs,{
    driverId:did,
    kind:String(kind),
    currentTeamId,
    targetTeamId:tid,
  });
  const security=securityDecisionFactor({traits,lifecycle,offer});

  const factors=[role,team.factor,relationship,morale,security];
  const contextualDelta=factors.reduce((sum,item)=>sum+Number(item?.delta||0),0);
  const probability=round2(clamp(baseProbability+contextualDelta,0.05,0.95));
  const intent=driverDecisionIntent(probability);

  return {
    model_version:DRIVER_DECISION_MODEL_VERSION,
    driver_id:did,
    team_id:tid,
    kind:String(kind),
    acceptance_probability:probability,
    interest_score:Math.round(probability*100),
    intent:intent.key,
    intent_label:intent.label,
    base_terms_probability:round2(baseProbability),
    contextual_delta:round2(contextualDelta),
    expected_salary:expectedSalary,
    offered_salary:offeredSalary,
    salary_ratio:round2(salaryRatio),
    offered_role:roleLabel(offer?.role),
    current_role:currentContract?roleLabel(currentContract?.role):null,
    current_team_id:currentTeamId||null,
    career_stage:lifecycle?.stage||"unknown",
    career_stage_label:lifecycle?.label||"Unknown",
    traits,
    target_team:team.target,
    current_team:team.current,
    factors,
  };
}
