// src/domain/driverRelationshipConsequences.js
// D6.3F — gameplay consequences of persistent Driver relationships.
//
// Design rules:
// - Relationships never add raw/base ability or permanent pace.
// - Missing staff/history is neutral, never a hidden penalty.
// - Effects are deliberately bounded and flow through systems players can read:
//   Mental State, Practice/Setup, contract renewals and team-order cooperation.

import { driverRelationship, driverRelationshipRecords } from "./driverRelationships.js";
import { driverRivalryRecords } from "./driverRivalries.js";
import { applyDriverMentalState } from "./driverMentalState.js";

const text=(value)=>String(value??"").trim();
const num=(value,fb=null)=>{
  if(value===null||value===undefined||value==="")return fb;
  const n=Number(value);
  return Number.isFinite(n)?n:fb;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const round2=(value)=>Math.round(Number(value||0)*100)/100;

function fieldAverage(record,fields,fb=50){
  if(!record)return fb;
  const values=(fields||[])
    .map((field)=>num(record?.[field],null))
    .filter((value)=>value!==null);
  return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:fb;
}

function relationScore(record){
  const direct=num(record?.score,null);
  if(direct!==null)return direct;
  return fieldAverage(record,["trust","respect","affinity","satisfaction"],50);
}

function activeRelations(gs,driverId,type){
  const did=text(driverId);
  return driverRelationshipRecords(gs,did)
    .filter((record)=>record?.active!==false&&(!type||String(record?.target_type)===String(type)));
}

function activeTeamRelation(gs,driverId,teamId=null){
  const tid=text(teamId);
  const records=activeRelations(gs,driverId,"team");
  if(tid)return records.find((record)=>text(record?.target_id)===tid)||null;
  return records[0]||null;
}

function activeManagerRelation(gs,driverId,teamId=null){
  const tid=text(teamId);
  return activeRelations(gs,driverId,"manager")
    .find((record)=>!tid||text(record?.team_id)===tid)||null;
}

function activeEngineerRelation(gs,driverId,teamId=null){
  const tid=text(teamId);
  return activeRelations(gs,driverId,"race_engineer")
    .find((record)=>!tid||text(record?.team_id)===tid)||null;
}

function activePrincipalRelation(gs,driverId,teamId=null){
  const tid=text(teamId);
  return activeRelations(gs,driverId,"team_principal")
    .find((record)=>!tid||text(record?.team_id)===tid)||null;
}

function teammateRelations(gs,driverId,teamId=null){
  const tid=text(teamId);
  return activeRelations(gs,driverId,"teammate")
    .filter((record)=>!tid||text(record?.team_id)===tid);
}

function weightedAverage(parts){
  let total=0,weight=0;
  for(const part of parts){
    if(part?.value===null||part?.value===undefined)continue;
    const w=Math.max(0,Number(part?.weight)||0);
    if(!w)continue;
    total+=Number(part.value)*w;
    weight+=w;
  }
  return weight?total/weight:50;
}

export function relationshipClimateLabel(score){
  const value=num(score,50);
  if(value>=75)return "Strong";
  if(value>=60)return "Positive";
  if(value>=42)return "Stable";
  if(value>=28)return "Strained";
  return "Poor";
}

export function driverProfessionalRelationshipClimate(gs,driverId,{teamId=null}={}){
  const team=activeTeamRelation(gs,driverId,teamId);
  const manager=activeManagerRelation(gs,driverId,teamId);
  const engineer=activeEngineerRelation(gs,driverId,teamId);
  const principal=activePrincipalRelation(gs,driverId,teamId);
  const teammates=teammateRelations(gs,driverId,teamId);
  const teammateScore=teammates.length
    ?teammates.reduce((sum,record)=>sum+relationScore(record),0)/teammates.length
    :null;

  // Missing categories are omitted and the remaining weights are renormalised.
  // This matters for historical seasons whose staff database is incomplete.
  const parts=[
    {key:"team",label:"Team",value:team?relationScore(team):null,weight:0.35},
    {key:"manager",label:"Manager",value:manager?relationScore(manager):null,weight:0.20},
    {key:"engineer",label:"Race Engineer",value:engineer?relationScore(engineer):null,weight:0.20},
    {key:"principal",label:"Team Principal",value:principal?relationScore(principal):null,weight:0.10},
    {key:"teammate",label:"Team-mate",value:teammateScore,weight:0.15},
  ];
  const score=round2(weightedAverage(parts));
  return {
    score,
    label:relationshipClimateLabel(score),
    parts,
    known_parts:parts.filter((part)=>part.value!==null).length,
  };
}

export function relationshipRaceMoraleDelta(gs,driverId,{teamId=null}={}){
  const climate=driverProfessionalRelationshipClimate(gs,driverId,{teamId});
  if(!climate.known_parts)return 0;
  // Max ±0.8 Morale per completed GP; daily recovery still pulls state toward 50.
  return round2(clamp((climate.score-50)*0.018,-0.8,0.8));
}

export function raceEngineerPreparationProfile(gs,driverId,{teamId=null}={}){
  const relation=activeEngineerRelation(gs,driverId,teamId);
  if(!relation){
    return {known:false,score:null,multiplier:1,label:"No relationship data"};
  }
  const score=round2(fieldAverage(relation,["trust","respect","affinity"],relationScore(relation)));
  // Setup communication is a small modifier, not hidden driver pace.
  const multiplier=round2(clamp(1+(score-50)*0.0012,0.94,1.06));
  return {
    known:true,
    score,
    multiplier,
    label:score>=70?"Excellent working relationship":score>=55?"Productive":score>=40?"Functional":score>=25?"Difficult":"Poor communication",
    staff_id:relation?.target_id??null,
  };
}

export function relationshipRenewalAcceptanceDelta(gs,driverId,{teamId=null}={}){
  const team=activeTeamRelation(gs,driverId,teamId);
  if(!team)return 0;
  const manager=activeManagerRelation(gs,driverId,teamId);
  const teamValue=fieldAverage(team,["trust","satisfaction"],50);
  const managerValue=manager?fieldAverage(manager,["trust","satisfaction"],50):null;
  const climate=managerValue===null?teamValue:teamValue*0.68+managerValue*0.32;
  return round2(clamp((climate-50)*0.0022,-0.12,0.10));
}

export function relationshipRenewalRetentionDelta(gs,driverId,{teamId=null}={}){
  return round2(clamp(relationshipRenewalAcceptanceDelta(gs,driverId,{teamId})*0.70,-0.08,0.07));
}

export function teamOrderComplianceProfile(gs,driverId,teammateId,{teamId=null}={}){
  const did=text(driverId),mate=text(teammateId),tid=text(teamId);
  if(!did||!mate||did===mate){
    return {probability:1,label:"Not applicable",at_risk:false,reasons:[]};
  }

  const team=activeTeamRelation(gs,did,tid);
  const manager=activeManagerRelation(gs,did,tid);
  const teammate=driverRelationship(gs,did,"teammate",mate);
  const globalRivalry=driverRivalryRecords(gs,did).find((row)=>text(row?.target_id)===mate)||null;

  let probability=0.97;
  const reasons=[];

  if(team){
    const value=fieldAverage(team,["trust","satisfaction"],50);
    const delta=(value-50)*0.0012;
    probability+=delta;
    if(Math.abs(delta)>=0.02)reasons.push({key:"team",label:"Team relationship",delta:round2(delta)});
  }
  if(manager){
    const value=fieldAverage(manager,["trust","respect"],50);
    const delta=(value-50)*0.0008;
    probability+=delta;
    if(Math.abs(delta)>=0.015)reasons.push({key:"manager",label:"Manager relationship",delta:round2(delta)});
  }
  if(teammate){
    const trust=fieldAverage(teammate,["trust","respect"],50);
    const trustDelta=(trust-50)*0.0008;
    const tensionDelta=-clamp(num(teammate?.rivalry,0),0,100)*0.0010;
    probability+=trustDelta+tensionDelta;
    if(Math.abs(trustDelta)>=0.015)reasons.push({key:"teammate_trust",label:"Team-mate trust",delta:round2(trustDelta)});
    if(Math.abs(tensionDelta)>=0.02)reasons.push({key:"teammate_tension",label:"Team-mate tension",delta:round2(tensionDelta)});
  }
  if(globalRivalry){
    const rivalryDelta=-clamp(num(globalRivalry?.rivalry,0),0,100)*0.0012;
    probability+=rivalryDelta;
    if(Math.abs(rivalryDelta)>=0.02)reasons.push({key:"global_rivalry",label:"Global rivalry",delta:round2(rivalryDelta)});
  }

  probability=round2(clamp(probability,0.55,0.99));
  return {
    probability,
    label:probability>=0.92?"Reliable":probability>=0.82?"Some resistance":probability>=0.70?"Fragile":"High refusal risk",
    at_risk:probability<0.90,
    reasons,
    teammate_id:mate,
  };
}

function strongestRaceRival(gs,driverId,participantIds){
  const participants=new Set((participantIds||[]).map(text));
  return driverRivalryRecords(gs,driverId,{includeEmerging:false})
    .filter((row)=>participants.has(text(row?.target_id)))
    .sort((a,b)=>Number(b?.rivalry||0)-Number(a?.rivalry||0))[0]||null;
}

export function relationshipRaceMentalAdjustment(gs,driverId,resultEntry){
  const did=text(driverId);
  const rows=Array.isArray(resultEntry?.classification)?resultEntry.classification:[];
  const row=rows.find((item)=>text(item?.driver_id)===did);
  if(!row)return {morale:0,confidence:0,reasons:[],meta:{}};

  const teamId=text(row?.team_id);
  const climate=driverProfessionalRelationshipClimate(gs,did,{teamId});
  const morale=relationshipRaceMoraleDelta(gs,did,{teamId});
  let confidence=0;
  const reasons=[];
  if(Math.abs(morale)>=0.05){
    reasons.push(morale>0?"Supportive team relationships":"Strained team relationships");
  }

  const rival=strongestRaceRival(gs,did,rows.map((item)=>item?.driver_id));
  let rivalId=null;
  let rivalry=null;
  if(rival&&row?.retired!==true&&String(row?.status||"").toUpperCase()!=="DNF"){
    const rivalRow=rows.find((item)=>text(item?.driver_id)===text(rival?.target_id));
    const rivalRetired=Boolean(rivalRow?.retired)||String(rivalRow?.status||"").toUpperCase()==="DNF";
    const position=num(row?.position,null);
    const rivalPosition=num(rivalRow?.position,null);
    if(rivalRow&&!rivalRetired&&position!==null&&rivalPosition!==null&&position!==rivalPosition){
      rivalId=text(rival?.target_id);
      rivalry=clamp(num(rival?.rivalry,0),0,100);
      const swing=clamp(rivalry*0.008,0.12,0.8);
      const won=position<rivalPosition;
      confidence+=won?swing:-swing;
      reasons.push(won?"Finished ahead of a major rival":"Finished behind a major rival");
    }
  }

  return {
    morale:round2(morale),
    confidence:round2(confidence),
    reasons,
    meta:{
      relationship_climate:climate.score,
      relationship_climate_label:climate.label,
      rival_driver_id:rivalId,
      rivalry:rivalry===null?null:round2(rivalry),
    },
  };
}

export function applyRaceRelationshipConsequences(gs,resultEntry){
  if(!gs||!resultEntry)return gs;
  let next=gs;
  for(const row of resultEntry?.classification||[]){
    const driverId=text(row?.driver_id);
    if(!driverId)continue;
    const effect=relationshipRaceMentalAdjustment(next,driverId,resultEntry);
    if(Math.abs(effect.morale)<0.05&&Math.abs(effect.confidence)<0.05)continue;
    next=applyDriverMentalState(next,driverId,{
      deltas:{morale:effect.morale,confidence:effect.confidence},
      source:"relationship_consequences",
      reason:effect.reasons.join(" · ")||"Relationship climate",
      meta:{
        gp_id:resultEntry?.gp_id??null,
        round:resultEntry?.round??null,
        ...effect.meta,
      },
    });
  }
  return next;
}

export function driverRelationshipConsequenceProfile(gs,driverId,{teamId=null,teammateId=null}={}){
  const climate=driverProfessionalRelationshipClimate(gs,driverId,{teamId});
  const engineer=raceEngineerPreparationProfile(gs,driverId,{teamId});
  const renewalDelta=relationshipRenewalAcceptanceDelta(gs,driverId,{teamId});
  const teammate=teammateId||teammateRelations(gs,driverId,teamId)[0]?.target_id||null;
  const teamOrder=teammate
    ?teamOrderComplianceProfile(gs,driverId,teammate,{teamId})
    :null;
  const strongestRival=driverRivalryRecords(gs,driverId,{includeEmerging:false})[0]||null;
  const rivalConfidenceSwing=strongestRival
    ?round2(clamp(Number(strongestRival?.rivalry||0)*0.008,0.12,0.8))
    :0;
  return {
    climate,
    race_morale_delta:relationshipRaceMoraleDelta(gs,driverId,{teamId}),
    engineer,
    renewal_acceptance_delta:renewalDelta,
    team_order:teamOrder,
    strongest_rival:strongestRival,
    rival_confidence_swing:rivalConfidenceSwing,
  };
}
