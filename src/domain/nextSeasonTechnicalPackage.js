// src/domain/nextSeasonTechnicalPackage.js
// Stage 7.4A — Concept + Design package for the Next Season Car.
//
// This module turns transferable team knowledge into a projected technical
// package. It NEVER mutates current-season carStats. Integration, Validation and
// season-rollover materialisation are later stages.

import {
  TECHNICAL_KNOWLEDGE_AREAS,
  nextSeasonKnowledgeCarryover,
  technicalLearningContext,
} from "./technicalKnowledge.js";

const str=(v)=>String(v??"");
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const round=(v,d=2)=>Number(Number(v||0).toFixed(d));

export const NEXT_SEASON_TECHNICAL_PHILOSOPHIES=Object.freeze([
  {
    id:"balanced",
    label:"Balanced",
    description:"Even technical targets with the lowest integration complexity.",
    complexity:0,
    biases:{aero:0,chassis:0,powertrain:0,hybrid:0,cooling:0,reliability:0},
    tradeoff:"No deliberate area is sacrificed for another.",
  },
  {
    id:"aero_efficiency",
    label:"Aero Efficiency",
    description:"Prioritise aerodynamic efficiency and high-speed platform performance.",
    complexity:1.5,
    biases:{aero:4.0,chassis:-0.5,powertrain:0,hybrid:0,cooling:-1.0,reliability:-0.5},
    tradeoff:"Higher aero ceiling, with tighter cooling and packaging margins.",
  },
  {
    id:"mechanical_grip",
    label:"Mechanical Grip",
    description:"Prioritise chassis response, suspension behaviour and low-speed traction.",
    complexity:1.0,
    biases:{aero:-1.0,chassis:4.0,powertrain:-0.5,hybrid:0,cooling:0.5,reliability:0.5},
    tradeoff:"Stronger chassis potential at the expense of some aero and powertrain emphasis.",
  },
  {
    id:"lightweight_packaging",
    label:"Lightweight Packaging",
    description:"Push mass distribution and compact packaging aggressively.",
    complexity:2.0,
    biases:{aero:1.0,chassis:3.0,powertrain:0,hybrid:0,cooling:-2.0,reliability:-1.5},
    tradeoff:"Packaging performance rises, but cooling and reliability margins tighten.",
  },
  {
    id:"reliability",
    label:"Reliability First",
    description:"Prioritise robust systems, operating margin and race-distance durability.",
    complexity:0.5,
    biases:{aero:-1.5,chassis:-1.0,powertrain:1.0,hybrid:0,cooling:1.5,reliability:5.0},
    tradeoff:"More dependable package, but less emphasis on peak aero/chassis performance.",
  },
  {
    id:"powertrain_integration",
    label:"Powertrain Integration",
    description:"Optimise powertrain, hybrid systems and cooling as one integrated package.",
    complexity:2.0,
    biases:{aero:-1.0,chassis:-0.5,powertrain:4.0,hybrid:3.0,cooling:1.0,reliability:0},
    tradeoff:"Higher systems potential with increased packaging and integration complexity.",
  },
]);

const PHILOSOPHY_BY_ID=new Map(
  NEXT_SEASON_TECHNICAL_PHILOSOPHIES.map((row)=>[row.id,row])
);

export function nextSeasonTechnicalPhilosophy(id="balanced"){
  return PHILOSOPHY_BY_ID.get(str(id))||PHILOSOPHY_BY_ID.get("balanced");
}

function progressOf(programme){
  return clamp(num(programme?.overall_progress,0),0,100);
}

function conceptMaturity(progress){
  return round(clamp(progress/15*100,0,100),1);
}

function designMaturity(progress){
  return round(clamp((progress-15)/45*100,0,100),1);
}

function statusFor(maturity,hasStarted){
  if(maturity>=100)return "complete";
  if(hasStarted&&maturity>0)return "in_progress";
  return "planned";
}

function average(rows,key){
  if(!rows.length)return 0;
  return rows.reduce((sum,row)=>sum+num(row?.[key],0),0)/rows.length;
}

function confidenceFor({concept,design,complexity}){
  return round(clamp(
    35+
    concept*0.25+
    design*0.30-
    complexity*1.75,
    25,92
  ),1);
}

function uncertaintyFor({concept,design,complexity}){
  return round(clamp(
    7.5-
    concept*0.020-
    design*0.032+
    complexity*0.50,
    1.4,9.5
  ),1);
}

export function buildNextSeasonTechnicalPackage(gs,{
  programme=null,
  teamId=null,
  knowledgeCarryover=null,
}={}){
  const source=programme||gs?.development?.nextSeasonCar||{};
  const id=str(teamId??gs?.team?.team_id??gs?.team?.id);
  const targetSeason=Number(source?.targetSeason??source?.target_season)||Number(gs?.activeYear||1980)+1;
  const philosophy=nextSeasonTechnicalPhilosophy(
    source?.technical_philosophy?.id??
    source?.technical_philosophy_id??
    source?.philosophy_id??
    "balanced"
  );
  const carry=knowledgeCarryover||source?.knowledge_carryover||nextSeasonKnowledgeCarryover(gs,{
    teamId:id,
    targetSeason,
    regulationImpact:source?.regulation_impact||null,
  });
  const learning=technicalLearningContext(gs,{teamId:id});
  const progress=progressOf(source);
  const concept=conceptMaturity(progress);
  const design=designMaturity(progress);
  const engineers=Math.max(1,Math.floor(num(source?.engineers,1)));
  const facilityQuality=clamp(num(learning?.facility_average,5)*10,0,100);
  const staffQuality=clamp(num(learning?.staff_quality,50),0,100);
  const engineeringResource=clamp(35+engineers*5,40,100);
  const retainedAverage=num(carry?.retained_average,50);

  const conceptQuality=round(clamp(
    retainedAverage*0.50+
    staffQuality*0.20+
    facilityQuality*0.18+
    engineeringResource*0.12-
    philosophy.complexity*1.4,
    20,98
  ),1);

  const designGainCapacity=round(clamp(
    1.2+
    engineers*0.40+
    (staffQuality-50)*0.025+
    (facilityQuality-50)*0.020,
    0.8,7.0
  ),2);

  const rows=TECHNICAL_KNOWLEDGE_AREAS.map(({id:area,label})=>{
    const carryArea=carry?.areas?.[area]||{};
    const retained=clamp(num(carryArea?.retained_level,50),0,100);
    const bias=num(philosophy?.biases?.[area],0);
    const conceptQualityAdjustment=(conceptQuality-60)*0.06;
    const matureConcept=clamp(retained+bias+conceptQualityAdjustment,0,100);
    const conceptProjection=retained+(matureConcept-retained)*(concept/100);

    const emphasis=Math.max(-2,Math.min(5,bias));
    const areaDesignCapacity=designGainCapacity*(1+Math.max(0,emphasis)*0.035);
    const projected=design>0
      ?clamp(matureConcept+areaDesignCapacity*(design/100),0,100)
      :clamp(conceptProjection,0,100);
    const potential=clamp(matureConcept+areaDesignCapacity,0,100);
    const confidence=confidenceFor({concept,design,complexity:philosophy.complexity});
    const uncertainty=uncertaintyFor({concept,design,complexity:philosophy.complexity});

    return {
      id:area,
      label,
      retained_knowledge:round(retained,1),
      philosophy_bias:round(bias,1),
      concept_target:round(matureConcept,1),
      concept_projected:round(conceptProjection,1),
      design_capacity:round(areaDesignCapacity,2),
      projected:round(projected,1),
      potential:round(potential,1),
      confidence,
      uncertainty,
      range_low:round(clamp(projected-uncertainty,0,100),1),
      range_high:round(clamp(projected+uncertainty,0,100),1),
    };
  });

  const confidence=round(average(rows,"confidence"),1);
  const uncertainty=round(average(rows,"uncertainty"),1);
  const projected=round(average(rows,"projected"),1);
  const potential=round(average(rows,"potential"),1);

  return {
    version:1,
    targetSeason,
    philosophy:{
      id:philosophy.id,
      label:philosophy.label,
      description:philosophy.description,
      complexity:philosophy.complexity,
      tradeoff:philosophy.tradeoff,
      biases:{...philosophy.biases},
    },
    progress:round(progress,2),
    concept:{
      status:statusFor(concept,progress>0),
      maturity:concept,
      quality:conceptQuality,
    },
    design:{
      status:statusFor(design,progress>15),
      maturity:design,
      gain_capacity:designGainCapacity,
    },
    resources:{
      engineers,
      staff_quality:round(staffQuality,1),
      facility_quality:round(facilityQuality,1),
      engineering_resource:round(engineeringResource,1),
    },
    areas:Object.fromEntries(rows.map((row)=>[row.id,row])),
    rows,
    overall:{
      projected,
      potential,
      confidence,
      uncertainty,
      range_low:round(clamp(projected-uncertainty,0,100),1),
      range_high:round(clamp(projected+uncertainty,0,100),1),
    },
    stage_scope:{
      concept_design:true,
      integration:false,
      validation:false,
      materialized_to_car_stats:false,
    },
  };
}
