// src/domain/nextSeasonRegulations.js
// Stage 7.2 — target-season regulation impact.
//
// Design rule:
// - The car for next season must be built against a stable ruleset.
// - A regulation vote/proposal may NEVER take effect in the immediately
//   following season. The earliest legal effective season is current + 2.
// - Approved future changes are Save World state. Historical/global data remains
//   structural reference only.

import { carComponentCatalog } from "./carComponents.js";
import {
  componentDevelopmentRule,
  developmentRegulationProfile,
} from "./developmentRegulations.js";

const str=(v)=>String(v??"");
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));

export const REGULATION_VOTE_MIN_LEAD_SEASONS=2;

export const TECHNICAL_REGULATION_AREAS=Object.freeze([
  "aero",
  "chassis",
  "powertrain",
  "hybrid",
  "cooling",
  "reliability",
]);

const SEVERITY_WEIGHT=Object.freeze({
  none:0,
  minor:1.5,
  medium:3.5,
  major:6,
});

const RETENTION_BY_SCORE=Object.freeze([
  {max:0.001,value:1.00,label:"Full"},
  {max:2.49,value:0.90,label:"High"},
  {max:4.99,value:0.72,label:"Moderate"},
  {max:Infinity,value:0.50,label:"Low"},
]);

function yearOf(gs){
  return Number(gs?.activeYear)||Number(str(gs?.currentDateISO).slice(0,4))||1980;
}

function areaOf(definition){
  const raw=str(definition?.impact_area||"chassis").toLowerCase();
  if(raw==="aero")return "aero";
  if(raw==="hybrid")return "hybrid";
  if(raw==="cooling")return "cooling";
  if(raw==="reliability")return "reliability";
  if(raw==="powertrain")return "powertrain";
  return "chassis";
}

function structuralComponentAvailable(definition,year){
  const windows=Array.isArray(definition?.era_windows)&&definition.era_windows.length
    ?definition.era_windows
    :[[definition?.era_start_year??1950,definition?.era_end_year??null]];
  return windows.some(([fromRaw,toRaw])=>{
    const from=num(fromRaw,1950);
    const to=toRaw==null||toRaw===""?Infinity:num(toRaw,Infinity);
    return Number(year)>=from&&Number(year)<=to;
  });
}

function syntheticStateForYear(gs,year){
  const y=Number(year)||yearOf(gs);
  return {
    ...gs,
    activeYear:y,
    currentDateISO:`${y}-01-01`,
  };
}

function normalizeAreaList(input){
  const src=Array.isArray(input)?input:[input];
  const out=[];
  for(const item of src){
    const key=str(item).toLowerCase();
    if(TECHNICAL_REGULATION_AREAS.includes(key)&&!out.includes(key))out.push(key);
  }
  return out;
}

function normalizeSeverity(value){
  const key=str(value).toLowerCase();
  return ["minor","medium","major"].includes(key)?key:"minor";
}

export function minimumRegulationVoteEffectiveSeason(currentYear){
  return Number(currentYear||1980)+REGULATION_VOTE_MIN_LEAD_SEASONS;
}

export function regulationVoteTiming(currentYear,effectiveSeason){
  const current=Number(currentYear)||1980;
  const effective=Number(effectiveSeason);
  const minimum=minimumRegulationVoteEffectiveSeason(current);
  const allowed=Number.isInteger(effective)&&effective>=minimum;
  return {
    current_season:current,
    requested_effective_season:Number.isInteger(effective)?effective:null,
    minimum_effective_season:minimum,
    lead_seasons:Number.isInteger(effective)?effective-current:null,
    allowed,
    reason:allowed
      ?"sufficient_design_lead_time"
      :"next_season_rules_locked",
  };
}

export function defaultRegulationGovernance(){
  return {
    version:1,
    votes:[],
    approved_changes:[],
  };
}

export function normalizeRegulationGovernance(input){
  const source=input&&typeof input==="object"?input:{};
  return {
    version:1,
    votes:Array.isArray(source.votes)?source.votes.map((row)=>({...row})):[],
    approved_changes:Array.isArray(source.approved_changes)
      ?source.approved_changes.map((row)=>({...row}))
      :Array.isArray(source.approvedChanges)
        ?source.approvedChanges.map((row)=>({...row}))
        :[],
  };
}

export function validateRegulationVoteProposal(gs,proposal={}){
  const current=yearOf(gs);
  const timing=regulationVoteTiming(current,proposal?.effective_season??proposal?.effectiveSeason);
  return {
    ...timing,
    proposal_id:proposal?.id??null,
    status:timing.allowed?"valid":"invalid",
  };
}

export function approvedTechnicalRegulationChanges(gs,targetSeason){
  const governance=normalizeRegulationGovernance(gs?.regulationGovernance);
  const target=Number(targetSeason);
  return governance.approved_changes
    .filter((change)=>Number(change?.effective_season??change?.effectiveSeason)===target)
    .map((change)=>({
      id:str(change?.id||`reg_${target}`),
      effective_season:target,
      approved_season:Number(change?.approved_season??change?.vote_season??change?.approvedSeason??NaN),
      title:str(change?.title||change?.name||"Approved regulation change"),
      summary:str(change?.summary||change?.description||""),
      severity:normalizeSeverity(change?.severity),
      areas:normalizeAreaList(change?.areas??change?.area),
      source:str(change?.source||"career_governance"),
    }));
}

export function technicalRegulationSnapshot(gs,season,{teamId=null}={}){
  const year=Number(season)||yearOf(gs);
  const id=str(teamId??gs?.team?.team_id??gs?.team?.id);
  const synthetic=syntheticStateForYear(gs,year);
  const profile=developmentRegulationProfile(synthetic,id,{dateISO:`${year}-01-01`});
  const catalogue=carComponentCatalog(synthetic);
  const structuralComponents=catalogue
    .filter((definition)=>structuralComponentAvailable(definition,year))
    .map((definition)=>({
      slot:str(definition.part_type),
      area:areaOf(definition),
      homologation:componentDevelopmentRule(synthetic,id,definition.part_type).rule,
    }))
    .sort((a,b)=>a.slot.localeCompare(b.slot));

  return {
    season:year,
    aero_testing:{
      scheme:profile.scheme,
      regulated:Boolean(profile.regulated_aero_testing),
      hard_quota:Boolean(profile.hard_quota),
      cfd_available:Boolean(profile.cfd_available),
    },
    components:structuralComponents,
    approved_changes:approvedTechnicalRegulationChanges(gs,year),
  };
}

function changeDescriptor(type,area,title,detail,score){
  return {
    type,
    area,
    title,
    detail,
    score:Number(score.toFixed(2)),
  };
}

function retentionForScore(score){
  const row=RETENTION_BY_SCORE.find((item)=>Number(score)<=item.max)||RETENTION_BY_SCORE.at(-1);
  return {
    factor:row.value,
    percent:Math.round(row.value*100),
    label:row.label,
  };
}

export function nextSeasonRegulationImpact(gs,{
  targetSeason=null,
  teamId=null,
}={}){
  const currentSeason=yearOf(gs);
  const target=Number(targetSeason)||currentSeason+1;
  const current=technicalRegulationSnapshot(gs,currentSeason,{teamId});
  const future=technicalRegulationSnapshot(gs,target,{teamId});
  const areaScores=Object.fromEntries(TECHNICAL_REGULATION_AREAS.map((area)=>[area,0]));
  const changes=[];

  const currentBySlot=new Map(current.components.map((row)=>[row.slot,row]));
  const futureBySlot=new Map(future.components.map((row)=>[row.slot,row]));

  for(const [slot,row] of futureBySlot){
    if(currentBySlot.has(slot))continue;
    areaScores[row.area]+=3;
    changes.push(changeDescriptor(
      "component_added",
      row.area,
      `${slot.replaceAll("_"," ")} enters the technical ruleset`,
      `The ${target} structural component catalogue introduces this system.`,
      3
    ));
  }

  for(const [slot,row] of currentBySlot){
    if(futureBySlot.has(slot))continue;
    areaScores[row.area]+=4;
    changes.push(changeDescriptor(
      "component_removed",
      row.area,
      `${slot.replaceAll("_"," ")} leaves the technical ruleset`,
      `The ${target} structural component catalogue no longer permits this system.`,
      4
    ));
  }

  for(const [slot,row] of futureBySlot){
    const previous=currentBySlot.get(slot);
    if(!previous||previous.homologation===row.homologation)continue;
    areaScores[row.area]+=2.5;
    changes.push(changeDescriptor(
      "homologation_changed",
      row.area,
      `${slot.replaceAll("_"," ")} development rule changes`,
      `${previous.homologation} → ${row.homologation}`,
      2.5
    ));
  }

  if(current.aero_testing.scheme!==future.aero_testing.scheme){
    areaScores.aero+=1.5;
    changes.push(changeDescriptor(
      "aero_testing_changed",
      "aero",
      "Aerodynamic testing framework changes",
      `${current.aero_testing.scheme} → ${future.aero_testing.scheme}`,
      1.5
    ));
  }

  for(const approved of future.approved_changes){
    const weight=SEVERITY_WEIGHT[approved.severity]||SEVERITY_WEIGHT.minor;
    const areas=approved.areas.length?approved.areas:["chassis"];
    for(const area of areas)areaScores[area]+=weight;
    changes.push({
      type:"approved_career_regulation",
      area:areas.length===1?areas[0]:"multiple",
      areas,
      title:approved.title,
      detail:approved.summary,
      score:weight,
      severity:approved.severity,
      source:approved.source,
      id:approved.id,
    });
  }

  const maxAreaScore=Math.max(0,...Object.values(areaScores));
  const totalScore=Object.values(areaScores).reduce((sum,value)=>sum+value,0);
  let severity="none";
  if(maxAreaScore>=5.5||totalScore>=10)severity="major";
  else if(maxAreaScore>=3||totalScore>=5)severity="medium";
  else if(maxAreaScore>0)severity="minor";

  const retention=Object.fromEntries(
    TECHNICAL_REGULATION_AREAS.map((area)=>[
      area,
      retentionForScore(areaScores[area]),
    ])
  );

  const minimumVoteSeason=minimumRegulationVoteEffectiveSeason(currentSeason);
  const targetRulesLocked=target<minimumVoteSeason;

  return {
    currentSeason,
    targetSeason:target,
    severity,
    label:severity==="none"
      ?"Stable"
      :severity==="minor"
        ?"Minor change"
        :severity==="medium"
          ?"Medium change"
          :"Major change",
    score:Number(totalScore.toFixed(2)),
    area_scores:areaScores,
    knowledge_retention:retention,
    changes,
    current_snapshot:current,
    target_snapshot:future,
    governance:{
      next_season_locked:targetRulesLocked,
      minimum_vote_effective_season:minimumVoteSeason,
      note:targetRulesLocked
        ?`The ${target} car rules are locked. New votes can only take effect from ${minimumVoteSeason} onward.`
        :`New regulation votes must respect the minimum ${REGULATION_VOTE_MIN_LEAD_SEASONS}-season lead time.`,
    },
  };
}

export function regulationImpactAreaSummary(impact){
  const scores=impact?.area_scores||{};
  return TECHNICAL_REGULATION_AREAS
    .map((area)=>({
      area,
      score:num(scores?.[area],0),
      retention:impact?.knowledge_retention?.[area]||retentionForScore(0),
    }))
    .filter((row)=>row.score>0)
    .sort((a,b)=>b.score-a.score||a.area.localeCompare(b.area));
}
