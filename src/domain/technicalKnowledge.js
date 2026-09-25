// src/domain/technicalKnowledge.js
// Stage 7.3 — persistent team technical knowledge and next-season carry-over.
//
// Knowledge belongs to the Save World. Historical car data is used only to
// calibrate the opening/current state when a career has no knowledge ledger yet.
// Once initialised, future knowledge comes from the simulated career:
// Research, completed development work, staff and facilities.

import { carComponentDefinition } from "./carComponents.js";
import { activeStaffContracts } from "./liveContracts.js";
import { resolveStaffId } from "./staffRoles.js";
import { nextSeasonRegulationImpact } from "./nextSeasonRegulations.js";

const str=(v)=>String(v??"");
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const round=(v,d=2)=>Number(Number(v||0).toFixed(d));

export const TECHNICAL_KNOWLEDGE_AREAS=Object.freeze([
  {id:"aero",label:"Aerodynamics"},
  {id:"chassis",label:"Chassis"},
  {id:"powertrain",label:"Powertrain"},
  {id:"hybrid",label:"Hybrid Systems"},
  {id:"cooling",label:"Cooling"},
  {id:"reliability",label:"Reliability"},
]);

const AREA_IDS=new Set(TECHNICAL_KNOWLEDGE_AREAS.map((row)=>row.id));

function activeYearOf(gs){
  return Number(gs?.activeYear)||Number(str(gs?.currentDateISO).slice(0,4))||1980;
}

function dateOnly(value){
  const raw=str(value).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:"";
}

function teamIdOf(gs,teamId=null){
  return str(teamId??gs?.team?.team_id??gs?.team?.id);
}

function teamRow(rows,teamId,year){
  const list=Array.isArray(rows)?rows:[];
  const same=list.filter((row)=>str(row?.team_id??row?.team??row?.constructor_id)===str(teamId));
  return same.find((row)=>Number(row?.year)===Number(year))
    ||same.find((row)=>!Number.isFinite(Number(row?.year)))
    ||same[0]
    ||null;
}

function facilitySnapshot(gs,teamId){
  const year=activeYearOf(gs);
  const row=teamRow(
    Array.isArray(gs?.facilities)&&gs.facilities.length?gs.facilities:gs?.dbFacilities,
    teamId,
    year
  )||{};
  const hq=gs?.hq?.facilityLevels||{};
  const level=(...keys)=>{
    for(const key of keys){
      const direct=Number(hq?.[key]);
      if(Number.isFinite(direct))return clamp(direct,0,10);
      const historical=Number(row?.[key]);
      if(Number.isFinite(historical))return clamp(historical,0,10);
    }
    return 5;
  };
  const values={
    aero:level("aero_dept_level"),
    wind:level("wind_tunnel_level"),
    chassis:level("_chassis_shop_level","chassis_shop_level"),
    manufacturing:level("manufacturing_leve","manufacturing_level"),
  };
  return {
    ...values,
    average:round((values.aero+values.wind+values.chassis+values.manufacturing)/4,2),
  };
}

function staffRating(gs,staffId){
  const year=activeYearOf(gs);
  const rows=(Array.isArray(gs?.staffRatings)&&gs.staffRatings.length
    ?gs.staffRatings
    :Array.isArray(gs?.dbStaffRatings)?gs.dbStaffRatings:[])
    .filter((row)=>str(row?.staff_id??row?.id)===str(staffId));
  return rows.find((row)=>Number(row?.year)===year)
    ||rows.filter((row)=>Number(row?.year)<=year).sort((a,b)=>num(b?.year)-num(a?.year))[0]
    ||rows[0]
    ||{};
}

function technicalStaffQuality(gs,teamId){
  const contracts=activeStaffContracts(gs,{teamId});
  const scored=contracts.map((contract)=>{
    const role=str(contract?.role??contract?.position).toLowerCase();
    const relevance=/technical|designer|engineer|aero/.test(role)?1
      :/strateg/.test(role)?0.72
        :/principal|owner/.test(role)?0.35:0.50;
    const rating=staffRating(gs,resolveStaffId(gs,contract));
    const quality=
      num(rating?.technical,50)*0.42+
      num(rating?.innovation,50)*0.24+
      num(rating?.data_analysis,50)*0.18+
      num(rating?.reliability_focus,50)*0.10+
      num(rating?.communication,50)*0.06;
    return {quality,relevance,score:quality*relevance};
  }).sort((a,b)=>b.score-a.score).slice(0,3);
  if(!scored.length)return 50;
  const weighted=scored.reduce((sum,row)=>sum+row.quality*row.relevance,0);
  const weights=scored.reduce((sum,row)=>sum+row.relevance,0);
  return round(weights?weighted/weights:50,1);
}

function currentCarTechnicalCalibration(gs,teamId){
  const year=activeYearOf(gs);
  const row=teamRow(
    Array.isArray(gs?.carStats)&&gs.carStats.length?gs.carStats:gs?.dbCarStats,
    teamId,
    year
  )||{};
  const reliabilityRaw=num(row?.reliability,0.70);
  const reliability=reliabilityRaw<=1?reliabilityRaw*100:reliabilityRaw;
  const present=(...values)=>{
    const list=values.map((v)=>Number(v)).filter((v)=>Number.isFinite(v)&&v>0);
    return list.length?list.reduce((a,b)=>a+b,0)/list.length:NaN;
  };
  return {
    aero:present(row?.aero_spec),
    chassis:present(row?.chassis_spec,row?.suspension_spec,row?.brakes_spec),
    powertrain:present(row?.gearbox_spec,row?.turbo_spec),
    hybrid:present(row?.kers_spec,row?.ers_mgu_k,row?.ers_mgu_h,row?.battery_pack),
    cooling:present(row?.cooling_spec),
    reliability:Number.isFinite(reliability)?reliability:NaN,
  };
}

export function technicalKnowledgeAreaForComponent(gs,slot,objectiveId="balanced"){
  if(str(objectiveId)==="reliability")return "reliability";
  const definition=carComponentDefinition(gs,slot);
  const raw=str(definition?.impact_area||"").toLowerCase();
  if(AREA_IDS.has(raw))return raw;
  const key=str(slot);
  if(["aero_front","aero_rear","sidepods","underfloor"].includes(key))return "aero";
  if(["chassis","suspension","brakes"].includes(key))return "chassis";
  if(["kers","ers_mgu_k","ers_mgu_h","battery_pack"].includes(key))return "hybrid";
  if(key==="cooling")return "cooling";
  if(["gearbox","turbocharger","fuel_system","exhaust_system"].includes(key))return "powertrain";
  if(key==="electronics")return "reliability";
  return "chassis";
}

function legacyPortfolioBonus(gs,area){
  const dev=gs?.development||{};
  const completed=(dev?.projects||[]).filter((project)=>project?.status==="completed");
  const matching=completed.filter((project)=>
    technicalKnowledgeAreaForComponent(gs,project?.type,project?.objective_id)===area
  );
  const strength=matching.reduce(
    (sum,project)=>sum+Math.max(0,num(project?.actual_design_perf,project?.target_design_perf??project?.perf_delta??0)),
    0
  );
  return Math.min(6,matching.length*0.55+strength*0.18);
}

export function seedTechnicalKnowledge(gs,{teamId=null}={}){
  const id=teamIdOf(gs,teamId);
  const facilities=facilitySnapshot(gs,id);
  const staff=technicalStaffQuality(gs,id);
  const car=currentCarTechnicalCalibration(gs,id);
  const facilityScore=facilities.average*10;
  const initializedAt=dateOnly(gs?.currentDateISO)||`${activeYearOf(gs)}-01-01`;

  const areas={};
  for(const row of TECHNICAL_KNOWLEDGE_AREAS){
    const carCalibration=Number.isFinite(car[row.id])?car[row.id]:25;
    const portfolio=legacyPortfolioBonus(gs,row.id);
    const level=clamp(
      carCalibration*0.70+
      staff*0.15+
      facilityScore*0.15+
      portfolio,
      15,96
    );
    areas[row.id]={
      id:row.id,
      label:row.label,
      level:round(level,2),
      opening_level:round(level,2),
      research_xp:0,
      project_xp:0,
      last_updated:initializedAt,
    };
  }

  return {
    version:1,
    team_id:id,
    initialized_at:initializedAt,
    opening_context:{
      season:activeYearOf(gs),
      staff_quality:staff,
      facility_quality:round(facilityScore,1),
      source:"current_save_world_calibration",
    },
    areas,
    history:[],
  };
}

export function normalizeTechnicalKnowledge(input,{gs=null,teamId=null}={}){
  const seeded=seedTechnicalKnowledge(gs||{}, {teamId});
  const source=input&&typeof input==="object"?input:{};
  const sourceAreas=source?.areas&&typeof source.areas==="object"?source.areas:{};
  const areas={};
  for(const row of TECHNICAL_KNOWLEDGE_AREAS){
    const base=seeded.areas[row.id];
    const current=sourceAreas?.[row.id]||{};
    areas[row.id]={
      ...base,
      ...current,
      id:row.id,
      label:row.label,
      level:round(clamp(num(current?.level,base.level),0,100),2),
      opening_level:round(clamp(num(current?.opening_level,base.opening_level),0,100),2),
      research_xp:round(Math.max(0,num(current?.research_xp,0)),3),
      project_xp:round(Math.max(0,num(current?.project_xp,0)),3),
      last_updated:dateOnly(current?.last_updated)||base.last_updated,
    };
  }
  return {
    ...seeded,
    ...source,
    version:1,
    team_id:str(source?.team_id||seeded.team_id),
    areas,
    history:Array.isArray(source?.history)?source.history.slice(-160):[],
  };
}

export function technicalKnowledgeSnapshot(gs,{teamId=null,development=null}={}){
  const dev=development||gs?.development||{};
  return normalizeTechnicalKnowledge(dev?.technicalKnowledge,{gs,teamId});
}

export function technicalLearningContext(gs,{teamId=null}={}){
  const id=teamIdOf(gs,teamId);
  const staff=technicalStaffQuality(gs,id);
  const facilities=facilitySnapshot(gs,id);
  const multiplier=clamp(
    0.72+staff/250+facilities.average/50,
    0.80,1.25
  );
  return {
    team_id:id,
    staff_quality:staff,
    facility_average:facilities.average,
    multiplier:round(multiplier,3),
  };
}

function diminishingKnowledgeGain(level,rawGain){
  const current=clamp(level,0,100);
  const factor=clamp(1-current/125,0.22,0.88);
  return round(Math.max(0,rawGain)*factor,4);
}

export function applyTechnicalKnowledgeGains(gs,gains=[],{
  teamId=null,
  eventId=null,
  dateISO=null,
  source="simulation",
}={}){
  if(!gs||typeof gs!=="object")return gs;
  const dev=gs?.development||{};
  const ledger=technicalKnowledgeSnapshot(gs,{teamId,development:dev});
  const event=str(eventId);
  if(event&&ledger.history.some((row)=>str(row?.event_id)===event))return gs;

  const applied=[];
  const areas={...ledger.areas};
  const learning=technicalLearningContext(gs,{teamId});
  for(const gain of gains||[]){
    const area=str(gain?.area);
    if(!AREA_IDS.has(area))continue;
    const baseRaw=Math.max(0,num(gain?.gain,0));
    if(baseRaw<=0)continue;
    const raw=baseRaw*learning.multiplier;
    const current=areas[area];
    const delta=diminishingKnowledgeGain(current.level,raw);
    if(delta<=0)continue;
    areas[area]={
      ...current,
      level:round(clamp(current.level+delta,0,100),2),
      research_xp:round(current.research_xp+(source==="research"?raw:0),3),
      project_xp:round(current.project_xp+(source==="project"?raw:0),3),
      last_updated:dateOnly(dateISO||gs?.currentDateISO)||current.last_updated,
    };
    applied.push({area,raw_gain:round(raw,4),applied_gain:delta});
  }
  if(!applied.length)return gs;

  const history=[
    ...ledger.history,
    {
      event_id:event||null,
      date:dateOnly(dateISO||gs?.currentDateISO)||null,
      source,
      learning_multiplier:learning.multiplier,
      gains:applied,
    },
  ].slice(-160);

  return {
    ...gs,
    development:{
      ...dev,
      technicalKnowledge:{
        ...ledger,
        areas,
        history,
      },
    },
  };
}

export function researchKnowledgeGains(generatedPoints={}){
  const gains=[];
  for(const [area,value] of Object.entries(generatedPoints||{})){
    const points=Math.max(0,num(value,0));
    if(points<=0)continue;
    if(area==="aero")gains.push({area:"aero",gain:points*0.060});
    else if(area==="chassis")gains.push({area:"chassis",gain:points*0.060});
    else if(area==="reliability")gains.push({area:"reliability",gain:points*0.060});
    else if(area==="powertrain"){
      gains.push({area:"powertrain",gain:points*0.050});
      gains.push({area:"cooling",gain:points*0.006});
      gains.push({area:"hybrid",gain:points*0.004});
    }
  }
  return gains;
}

export function completedProjectKnowledgeGains(gs,project,technicalResult=null){
  const primary=technicalKnowledgeAreaForComponent(gs,project?.type,project?.objective_id);
  const strength=Math.max(0,num(
    technicalResult?.development_strength,
    project?.actual_design_perf??project?.target_design_perf??project?.perf_delta??0
  ));
  const researchUsed=Math.max(0,num(project?.research_points_used,0));
  const result=str(technicalResult?.realization?.result||project?.result_rating||"").toLowerCase();
  const resultFactor=result==="breakthrough"?1.15
    :result==="strong"?1.08
      :result==="weak"?0.88
        :result==="failed"?0.70:1;
  const raw=(0.55+Math.min(6,strength)*0.42+Math.min(15,researchUsed)*0.02)*resultFactor;
  const gains=[{area:primary,gain:raw}];

  // Reliability learning is never completely isolated from engineering work,
  // but a reliability-focused project already routes its main gain there.
  if(primary!=="reliability"){
    gains.push({area:"reliability",gain:raw*0.12});
  }
  return gains;
}

export function nextSeasonKnowledgeCarryover(gs,{
  teamId=null,
  targetSeason=null,
  regulationImpact=null,
  development=null,
}={}){
  const dev=development||gs?.development||{};
  const knowledge=technicalKnowledgeSnapshot(gs,{teamId,development:dev});
  const target=Number(targetSeason)||activeYearOf(gs)+1;
  const regulation=regulationImpact||nextSeasonRegulationImpact(gs,{targetSeason:target,teamId});
  const rows=TECHNICAL_KNOWLEDGE_AREAS.map(({id,label})=>{
    const area=knowledge.areas[id];
    const retention=regulation?.knowledge_retention?.[id]||{factor:1,percent:100,label:"Full"};
    const retained=clamp(area.level*num(retention.factor,1),0,100);
    return {
      id,label,
      current_level:round(area.level,1),
      regulation_retention:round(num(retention.factor,1),3),
      regulation_retention_percent:Math.round(num(retention.percent,100)),
      retained_level:round(retained,1),
      research_xp:round(area.research_xp,2),
      project_xp:round(area.project_xp,2),
    };
  });
  const average=rows.reduce((sum,row)=>sum+row.retained_level,0)/Math.max(1,rows.length);
  const currentAverage=rows.reduce((sum,row)=>sum+row.current_level,0)/Math.max(1,rows.length);
  return {
    version:1,
    targetSeason:target,
    regulation_severity:regulation?.severity||"none",
    current_average:round(currentAverage,1),
    retained_average:round(average,1),
    retention_percent:currentAverage>0?round((average/currentAverage)*100,1):100,
    areas:Object.fromEntries(rows.map((row)=>[row.id,row])),
    rows,
  };
}
