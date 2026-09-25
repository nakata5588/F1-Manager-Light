// src/domain/nextSeasonTechnicalPackage.js
// Stage 7.4 — Concept, Design, Integration and Validation for the Next Season Car.
//
// The programme produces a persistent projected/validated technical package.
// It NEVER mutates current-season carStats; season materialisation remains 7.7.

import {
  TECHNICAL_KNOWLEDGE_AREAS,
  nextSeasonKnowledgeCarryover,
  technicalLearningContext,
} from "./technicalKnowledge.js";
import { carComponentCatalog } from "./carComponents.js";
import { technicalStrategyAeroMultipliers } from "./technicalStrategy.js";

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

function integrationMaturity(progress){
  return round(clamp((progress-60)/25*100,0,100),1);
}

function validationMaturity(progress){
  return round(clamp((progress-85)/15*100,0,100),1);
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

function stdDev(values){
  const list=values.map(Number).filter(Number.isFinite);
  if(list.length<=1)return 0;
  const avg=list.reduce((a,b)=>a+b,0)/list.length;
  return Math.sqrt(list.reduce((sum,v)=>sum+(v-avg)**2,0)/list.length);
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

function slotKnowledgeArea(slot){
  const key=str(slot);
  if(["aero_front","aero_rear","sidepods","underfloor"].includes(key))return "aero";
  if(["chassis","suspension","brakes"].includes(key))return "chassis";
  if(["kers","ers_mgu_k","ers_mgu_h","battery_pack"].includes(key))return "hybrid";
  if(key==="cooling")return "cooling";
  if(["gearbox","turbocharger","fuel_system","exhaust_system"].includes(key))return "powertrain";
  if(key==="electronics")return "reliability";
  return null;
}

function rowInsideTargetEra(row,targetSeason){
  const windows=Array.isArray(row?.era_windows)&&row.era_windows.length
    ?row.era_windows
    :[[row?.era_start_year,row?.era_end_year]];
  return windows.some(([fromRaw,toRaw])=>{
    const from=Number.isFinite(Number(fromRaw))?Number(fromRaw):1950;
    const to=toRaw==null||toRaw===""?Infinity:Number(toRaw);
    return targetSeason>=from&&targetSeason<=(Number.isFinite(to)?to:Infinity);
  });
}

function applicableTechnicalAreas(gs,targetSeason){
  const active=new Set(["reliability"]);
  for(const row of carComponentCatalog(gs)){
    if(!rowInsideTargetEra(row,targetSeason))continue;
    const area=slotKnowledgeArea(row?.part_type);
    if(area)active.add(area);
  }
  return active;
}

function designRowsSnapshot(rows){
  return Object.fromEntries(rows.map((row)=>[row.id,{
    id:row.id,
    projected:round(row.projected,1),
    potential:round(row.potential,1),
    uncertainty:round(row.uncertainty,1),
    confidence:round(row.confidence,1),
    applicable:row.applicable!==false,
  }]));
}

function severityForPenalty(penalty){
  if(penalty>=4)return "major";
  if(penalty>=2)return "medium";
  return "minor";
}

function bottleneck(id,title,areas,penalty,detail){
  const value=round(Math.max(0,penalty),2);
  return {
    id,title,areas,
    penalty:value,
    severity:severityForPenalty(value),
    detail,
  };
}

function integrationAnalysis(rows,philosophy,resources){
  const active=rows.filter((row)=>row.applicable!==false);
  const byId=Object.fromEntries(active.map((row)=>[row.id,row]));
  const value=(id)=>num(byId?.[id]?.projected,NaN);
  const bottlenecks=[];

  const coupling=(id,title,a,b,freeGap,factor,detail)=>{
    const av=value(a),bv=value(b);
    if(!Number.isFinite(av)||!Number.isFinite(bv))return;
    const gap=Math.abs(av-bv);
    const penalty=Math.max(0,gap-freeGap)*factor;
    if(penalty>=0.55)bottlenecks.push(bottleneck(id,title,[a,b],penalty,detail+" Gap "+round(gap,1)+"."));
  };

  coupling(
    "aero_chassis_correlation","Aero / chassis correlation",
    "aero","chassis",5.5,0.48,
    "The aerodynamic platform and mechanical platform are developing at different rates."
  );
  coupling(
    "powertrain_cooling_margin","Powertrain cooling margin",
    "powertrain","cooling",5.0,0.58,
    "Powertrain demand is out of step with the available cooling/packaging margin."
  );
  coupling(
    "hybrid_powertrain_integration","Hybrid / powertrain integration",
    "hybrid","powertrain",6.0,0.48,
    "Hybrid systems and the conventional powertrain are not yet equally mature."
  );
  coupling(
    "cooling_reliability_margin","Cooling / reliability margin",
    "cooling","reliability",7.0,0.32,
    "Thermal margin and reliability targets are not fully aligned."
  );

  const spread=stdDev(active.map((row)=>row.projected));
  const balancePenalty=Math.max(0,spread-3.0)*0.85;
  if(balancePenalty>=0.7){
    const sorted=[...active].sort((a,b)=>a.projected-b.projected);
    bottlenecks.push(bottleneck(
      "package_balance","Package balance",
      sorted.slice(0,2).map((row)=>row.id),
      balancePenalty,
      "The package has a wide performance spread; the weakest systems limit how much peak performance can be integrated."
    ));
  }

  const couplingPenalty=bottlenecks.reduce((sum,row)=>sum+row.penalty,0);
  const complexityPenalty=num(philosophy?.complexity,0)*2.1;
  const support=(num(resources.staff_quality,50)+num(resources.facility_quality,50))/2;
  const supportAdjustment=(support-65)*0.10+(num(resources.engineering_resource,60)-60)*0.05;
  const targetQuality=clamp(
    94-couplingPenalty-balancePenalty*0.45-complexityPenalty+supportAdjustment,
    45,98
  );

  const packagingBase=100-
    Math.max(0,Math.abs(num(value("aero"),75)-num(value("cooling"),75))-8)*0.65-
    Math.max(0,Math.abs(num(value("chassis"),75)-num(value("cooling"),75))-9)*0.45-
    num(philosophy?.complexity,0)*2.4;
  const packagingQuality=clamp(packagingBase+(support-60)*0.08,45,98);

  const systemValues=["powertrain","hybrid","cooling","reliability"]
    .map(value).filter(Number.isFinite);
  const systemsSpread=stdDev(systemValues);
  const systemsCompatibility=clamp(
    96-Math.max(0,systemsSpread-2)*1.35-num(philosophy?.complexity,0)*1.2+(support-60)*0.06,
    45,98
  );

  const perAreaPenalty={};
  for(const row of bottlenecks){
    const share=row.areas.length?row.penalty/row.areas.length:0;
    for(const area of row.areas)perAreaPenalty[area]=num(perAreaPenalty[area],0)+share;
  }

  return {
    target_quality:round(targetQuality,1),
    packaging_quality:round(packagingQuality,1),
    systems_compatibility:round(systemsCompatibility,1),
    balance_spread:round(spread,2),
    complexity_penalty:round(complexityPenalty,2),
    support_adjustment:round(supportAdjustment,2),
    bottlenecks:bottlenecks.sort((a,b)=>b.penalty-a.penalty),
    per_area_penalty:Object.fromEntries(
      Object.entries(perAreaPenalty).map(([area,value])=>[area,round(value,2)])
    ),
  };
}

function integrationAreaRows(designRows,analysis,maturity){
  const progress=clamp(maturity/100,0,1);
  const globalPenalty=Math.max(0,82-num(analysis.target_quality,82))*0.075;
  return designRows.map((row)=>{
    const localPenalty=num(analysis?.per_area_penalty?.[row.id],0)*0.32;
    const fullPenalty=clamp(globalPenalty+localPenalty,0,4.5);
    const integrated=clamp(row.projected-fullPenalty*progress,0,100);
    return {
      ...row,
      integration_penalty:round(fullPenalty*progress,2),
      integration_penalty_at_completion:round(fullPenalty,2),
      integrated_projected:round(integrated,1),
    };
  });
}

function integrationRowsSnapshot(rows){
  return Object.fromEntries(rows.map((row)=>[row.id,{
    id:row.id,
    integrated_projected:round(row.integrated_projected,1),
    integration_penalty:round(row.integration_penalty_at_completion,2),
    applicable:row.applicable!==false,
  }]));
}

function validationSupport(resources,integrationQuality,complexity){
  return clamp(
    num(resources.staff_quality,50)*0.34+
    num(resources.facility_quality,50)*0.34+
    num(resources.engineering_resource,60)*0.14+
    num(integrationQuality,75)*0.18-
    num(complexity,0)*1.2,
    35,98
  );
}

function validationCorrection(row,{integrationQuality,support,complexity,areaPenalty}){
  const integrationTerm=(num(integrationQuality,80)-80)*0.018;
  const supportTerm=(num(support,70)-70)*0.012;
  const complexityTerm=-num(complexity,0)*0.09;
  const bottleneckTerm=-num(areaPenalty,0)*0.15;
  const maturityMargin=(num(row.integrated_projected,75)-75)*0.004;
  return clamp(integrationTerm+supportTerm+complexityTerm+bottleneckTerm+maturityMargin,-2.2,0.8);
}

function validationDiscovery(row,correction){
  const c=round(correction,2);
  if(c<=-0.75)return {
    id:`validation_${row.id}_down`,
    area:row.id,
    severity:c<=-1.35?"medium":"minor",
    title:`${row.label} revised below projection`,
    detail:`Validation exposed a ${Math.abs(c).toFixed(1)}-point gap versus the integrated projection.`,
  };
  if(c>=0.35)return {
    id:`validation_${row.id}_up`,
    area:row.id,
    severity:"positive",
    title:`${row.label} correlation confirmed strongly`,
    detail:`Validation supports a ${c.toFixed(1)}-point improvement versus the integrated projection.`,
  };
  return null;
}

function readinessFor(progress,integration,validation){
  if(progress>=100)return "validated";
  if(validation>0)return "validating";
  if(integration>0)return "integrating";
  if(progress>=15)return "designing";
  if(progress>0)return "concept";
  return "planning";
}

export function buildNextSeasonTechnicalPackage(gs,{
  programme=null,
  teamId=null,
  knowledgeCarryover=null,
}={}){
  const source=programme||gs?.development?.nextSeasonCar||{};
  const previous=source?.technical_package&&typeof source.technical_package==="object"
    ?source.technical_package
    :null;
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
  const integration=integrationMaturity(progress);
  const validation=validationMaturity(progress);
  const engineers=Math.max(1,Math.floor(num(source?.engineers,1)));
  const facilityQuality=clamp(num(learning?.facility_average,5)*10,0,100);
  const staffQuality=clamp(num(learning?.staff_quality,50),0,100);
  const engineeringResource=clamp(35+engineers*5,40,100);
  const retainedAverage=num(carry?.retained_average,50);
  const applicableAreas=applicableTechnicalAreas(gs,targetSeason);
  const aeroStrategy=technicalStrategyAeroMultipliers(gs);

  const resources={
    engineers,
    staff_quality:round(staffQuality,1),
    facility_quality:round(facilityQuality,1),
    engineering_resource:round(engineeringResource,1),
    aero_strategy_multiplier:aeroStrategy.next_season_multiplier,
  };

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

  const liveDesignRows=TECHNICAL_KNOWLEDGE_AREAS.map(({id:area,label})=>{
    const carryArea=carry?.areas?.[area]||{};
    const retained=clamp(num(carryArea?.retained_level,50),0,100);
    const bias=num(philosophy?.biases?.[area],0);
    const conceptQualityAdjustment=(conceptQuality-60)*0.06;
    const matureConcept=clamp(retained+bias+conceptQualityAdjustment,0,100);
    const conceptProjection=retained+(matureConcept-retained)*(concept/100);
    const emphasis=Math.max(-2,Math.min(5,bias));
    const areaStrategyMultiplier=area==="aero"?aeroStrategy.next_season_multiplier:1;
    const areaDesignCapacity=designGainCapacity*(1+Math.max(0,emphasis)*0.035)*areaStrategyMultiplier;
    const projected=design>0
      ?clamp(matureConcept+areaDesignCapacity*(design/100),0,100)
      :clamp(conceptProjection,0,100);
    const potential=clamp(matureConcept+areaDesignCapacity,0,100);
    const confidence=confidenceFor({concept,design,complexity:philosophy.complexity});
    const uncertainty=uncertaintyFor({concept,design,complexity:philosophy.complexity});

    return {
      id:area,
      label,
      applicable:applicableAreas.has(area),
      retained_knowledge:round(retained,1),
      philosophy_bias:round(bias,1),
      concept_target:round(matureConcept,1),
      concept_projected:round(conceptProjection,1),
      design_capacity:round(areaDesignCapacity,2),
      strategy_multiplier:round(areaStrategyMultiplier,3),
      projected:round(projected,1),
      potential:round(potential,1),
      confidence,
      uncertainty,
      range_low:round(clamp(projected-uncertainty,0,100),1),
      range_high:round(clamp(projected+uncertainty,0,100),1),
    };
  });

  const previousDesignLock=previous?.design?.locked_areas&&typeof previous.design.locked_areas==="object"
    ?previous.design.locked_areas:null;
  const designLock=progress>=60
    ?(previousDesignLock||designRowsSnapshot(liveDesignRows))
    :null;

  const designRows=liveDesignRows.map((row)=>{
    const locked=designLock?.[row.id];
    if(!locked)return row;
    return {
      ...row,
      projected:num(locked.projected,row.projected),
      potential:num(locked.potential,row.potential),
      uncertainty:num(locked.uncertainty,row.uncertainty),
      confidence:num(locked.confidence,row.confidence),
      applicable:locked.applicable!==false,
      range_low:round(clamp(num(locked.projected,row.projected)-num(locked.uncertainty,row.uncertainty),0,100),1),
      range_high:round(clamp(num(locked.projected,row.projected)+num(locked.uncertainty,row.uncertainty),0,100),1),
      design_locked:true,
    };
  });

  const analysis=integrationAnalysis(designRows,philosophy,resources);
  const liveIntegratedRows=integrationAreaRows(designRows,analysis,integration);
  const previousIntegrationLock=previous?.integration?.locked_areas&&typeof previous.integration.locked_areas==="object"
    ?previous.integration.locked_areas:null;
  const integrationLock=progress>=85
    ?(previousIntegrationLock||integrationRowsSnapshot(integrationAreaRows(designRows,analysis,100)))
    :null;

  const integratedRows=liveIntegratedRows.map((row)=>{
    const locked=integrationLock?.[row.id];
    if(!locked)return row;
    return {
      ...row,
      integrated_projected:num(locked.integrated_projected,row.integrated_projected),
      integration_penalty:num(locked.integration_penalty,row.integration_penalty),
      applicable:locked.applicable!==false,
      integration_locked:true,
    };
  });

  const integrationQualityAtMaturity=round(
    100-(100-analysis.target_quality)*(integration/100),
    1
  );
  const effectiveIntegrationQuality=integration>0?integrationQualityAtMaturity:null;
  const lockedIntegrationQuality=progress>=85
    ?num(previous?.integration?.locked_quality,analysis.target_quality)
    :null;
  const finalIntegrationQuality=lockedIntegrationQuality??(integration>=100?analysis.target_quality:effectiveIntegrationQuality);

  const support=validationSupport(
    resources,
    finalIntegrationQuality??analysis.target_quality,
    philosophy.complexity
  );
  const finalValidationUncertainty=clamp(
    1.15-
    (support-65)*0.009+
    philosophy.complexity*0.08+
    Math.max(0,80-analysis.target_quality)*0.006,
    0.35,1.45
  );

  const validationRows=integratedRows.map((row)=>{
    const areaPenalty=num(analysis?.per_area_penalty?.[row.id],0);
    const correction=row.applicable===false?0:validationCorrection(row,{
      integrationQuality:finalIntegrationQuality??analysis.target_quality,
      support,
      complexity:philosophy.complexity,
      areaPenalty,
    });
    const validated=clamp(
      row.integrated_projected+correction*(validation/100),
      0,100
    );
    const uncertainty=clamp(
      row.uncertainty+(finalValidationUncertainty-row.uncertainty)*(validation/100),
      finalValidationUncertainty,
      row.uncertainty
    );
    const discovery=validation>0&&row.applicable!==false
      ?validationDiscovery(row,correction)
      :null;
    return {
      ...row,
      validation_correction_at_completion:round(correction,2),
      validated:round(validated,1),
      validation_uncertainty:round(uncertainty,2),
      validated_range_low:round(clamp(validated-uncertainty,0,100),1),
      validated_range_high:round(clamp(validated+uncertainty,0,100),1),
      discovery,
    };
  });

  const activeRows=validationRows.filter((row)=>row.applicable!==false);
  const projected=round(average(activeRows,"projected"),1);
  const potential=round(average(activeRows,"potential"),1);
  const integratedProjected=round(average(activeRows,"integrated_projected"),1);
  const validated=round(average(activeRows,"validated"),1);
  const validationUncertainty=round(average(activeRows,"validation_uncertainty"),2);
  const confidence=round(average(activeRows,"confidence"),1);
  const designUncertainty=round(average(activeRows,"uncertainty"),1);
  const validationConfidence=round(clamp(
    100-validationUncertainty*5.2,
    confidence,99
  ),1);
  const discoveries=validationRows
    .map((row)=>row.discovery)
    .filter(Boolean)
    .sort((a,b)=>{
      const rank={medium:3,minor:2,positive:1};
      return num(rank[b.severity],0)-num(rank[a.severity],0);
    })
    .slice(0,4);

  return {
    version:2,
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
    readiness:readinessFor(progress,integration,validation),
    concept:{
      status:statusFor(concept,progress>0),
      maturity:concept,
      quality:conceptQuality,
    },
    design:{
      status:statusFor(design,progress>15),
      maturity:design,
      gain_capacity:designGainCapacity,
      locked:Boolean(designLock),
      locked_at_progress:designLock?60:null,
      locked_areas:designLock,
    },
    integration:{
      status:statusFor(integration,progress>60),
      maturity:integration,
      quality:finalIntegrationQuality==null?null:round(finalIntegrationQuality,1),
      projected_quality:analysis.target_quality,
      packaging_quality:analysis.packaging_quality,
      systems_compatibility:analysis.systems_compatibility,
      balance_spread:analysis.balance_spread,
      bottlenecks:integration>0||progress>=85?analysis.bottlenecks:[],
      all_projected_bottlenecks:analysis.bottlenecks,
      locked:Boolean(integrationLock),
      locked_at_progress:integrationLock?85:null,
      locked_quality:progress>=85
        ?round(previous?.integration?.locked_quality??analysis.target_quality,1)
        :null,
      locked_areas:integrationLock,
    },
    validation:{
      status:statusFor(validation,progress>85),
      maturity:validation,
      support_quality:round(support,1),
      confidence:validation>0?validationConfidence:confidence,
      uncertainty:validationUncertainty,
      target_uncertainty:round(finalValidationUncertainty,2),
      discoveries,
    },
    resources,
    areas:Object.fromEntries(validationRows.map((row)=>[row.id,row])),
    rows:validationRows,
    overall:{
      projected,
      potential,
      integrated_projected:integratedProjected,
      validated,
      confidence:validation>0?validationConfidence:confidence,
      uncertainty:validation>0?validationUncertainty:designUncertainty,
      range_low:round(clamp((validation>0?validated:integratedProjected)-(validation>0?validationUncertainty:designUncertainty),0,100),1),
      range_high:round(clamp((validation>0?validated:integratedProjected)+(validation>0?validationUncertainty:designUncertainty),0,100),1),
    },
    stage_scope:{
      concept_design:true,
      integration:true,
      validation:true,
      materialized_to_car_stats:false,
    },
  };
}
