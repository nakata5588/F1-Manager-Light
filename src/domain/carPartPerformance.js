// src/domain/carPartPerformance.js
// Canonical technical model for developed car-part designs.
//
// Historical carStats remain the baseline car. A developed design only contributes
// the DELTA over the catalogue baseline for that component. This prevents a fitted
// part from double-counting the performance already represented by carStats.

import { carComponentDefinition } from "./carComponents.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const round=(v,d=4)=>Number(num(v).toFixed(d));

const AREA_TUNING=Object.freeze({
  aero:{weight:0.004,drag:0.018,downforce:0.035,reliability_pp:0.10,system_q:0.05,system_r:0.04},
  chassis:{weight:0.008,drag:0.004,downforce:0.012,reliability_pp:0.14,system_q:0.12,system_r:0.18},
  powertrain:{weight:0.004,drag:0.002,downforce:0.002,reliability_pp:0.20,system_q:0.35,system_r:0.45},
  cooling:{weight:0.003,drag:0.010,downforce:0.001,reliability_pp:0.30,system_q:0.05,system_r:0.16},
  reliability:{weight:0.001,drag:0.001,downforce:0.000,reliability_pp:0.38,system_q:0.02,system_r:0.05},
  hybrid:{weight:0.006,drag:0.002,downforce:0.001,reliability_pp:0.18,system_q:0.25,system_r:0.30},
});

function definitionFor(gs,slot){
  return carComponentDefinition(gs,slot)||{
    part_type:String(slot||""),
    impact_area:"chassis",
    base_weight:0,
    base_drag:0,
    base_downforce:0,
    base_reliability:0.8,
  };
}

export function componentTechnicalBaseline(gs,slot){
  const def=definitionFor(gs,slot);
  let reliability=num(def?.base_reliability,0.8);
  if(reliability>1)reliability/=100;
  return {
    slot:String(slot||def?.part_type||""),
    catalog_part_id:def?.part_id||null,
    impact_area:String(def?.impact_area||"chassis"),
    weight_kg:Math.max(0,num(def?.base_weight,0)),
    drag:Math.max(0,num(def?.base_drag,0)),
    downforce:Math.max(0,num(def?.base_downforce,0)),
    reliability:clamp(reliability,0,1),
  };
}

export function derivePartTechnicalProfile(gs,part){
  if(part?.technical_profile?.baseline&&part?.technical_profile?.design){
    return part.technical_profile;
  }

  const baseline=componentTechnicalBaseline(gs,part?.slot);
  const strength=Math.max(0,num(part?.perf,0));
  const tuning=AREA_TUNING[baseline.impact_area]||AREA_TUNING.chassis;

  const weightFrac=Math.min(0.18,strength*tuning.weight);
  const dragFrac=Math.min(0.22,strength*tuning.drag);
  const downforceFrac=Math.min(0.35,strength*tuning.downforce);
  const reliabilityGainPp=Math.min(12,strength*tuning.reliability_pp);

  const design={
    weight_kg:round(baseline.weight_kg*(1-weightFrac),3),
    drag:round(baseline.drag*(1-dragFrac),5),
    downforce:round(baseline.downforce*(1+downforceFrac),5),
    reliability:round(clamp(baseline.reliability+reliabilityGainPp/100,0,0.99),4),
  };
  const delta={
    weight_kg:round(design.weight_kg-baseline.weight_kg,3),
    drag:round(design.drag-baseline.drag,5),
    downforce:round(design.downforce-baseline.downforce,5),
    reliability_pct:round((design.reliability-baseline.reliability)*100,2),
    system_efficiency:round(strength,3),
  };

  return {
    model_version:1,
    slot:baseline.slot,
    catalog_part_id:baseline.catalog_part_id,
    impact_area:baseline.impact_area,
    development_strength:round(strength,3),
    baseline,
    design,
    delta,
  };
}

export function technicalAdjustmentForPart(gs,{slot,part,condition=100}={}){
  const profile=derivePartTechnicalProfile(gs,{...(part||{}),slot:slot||part?.slot});
  const tuning=AREA_TUNING[profile.impact_area]||AREA_TUNING.chassis;
  const health=clamp(condition,0,100)/100;
  const delta=profile.delta||{};

  const weightReduction=Math.max(0,-num(delta.weight_kg,0))*health;
  const dragReduction=Math.max(0,-num(delta.drag,0))*health;
  const downforceGain=Math.max(0,num(delta.downforce,0))*health;
  const reliabilityGain=num(delta.reliability_pct,0)*health;
  const system=num(delta.system_efficiency,0)*health;

  // Rating-point conversion is intentionally conservative: the historical
  // carStats row remains the baseline, while technical deltas add a small
  // measurable advantage depending on what the component actually changes.
  const qualifying=
    downforceGain*100*0.75 +
    dragReduction*100*2.0 +
    weightReduction*0.10 +
    system*tuning.system_q;

  const race=
    downforceGain*100*0.55 +
    dragReduction*100*1.3 +
    weightReduction*0.12 +
    system*tuning.system_r;

  return {
    qualifying,
    race,
    reliability:reliabilityGain,
    technical:{
      weight_delta_kg:-weightReduction,
      drag_delta:-dragReduction,
      downforce_delta:downforceGain,
      design_reliability_delta_pct:reliabilityGain,
      impact_area:profile.impact_area,
    },
    profile,
  };
}

export function combineTechnicalAdjustments(rows){
  return (rows||[]).reduce((acc,row)=>{
    acc.qualifying+=num(row?.qualifying,0);
    acc.race+=num(row?.race,0);
    acc.reliability+=num(row?.reliability,0);
    acc.technical.weight_delta_kg+=num(row?.technical?.weight_delta_kg,0);
    acc.technical.drag_delta+=num(row?.technical?.drag_delta,0);
    acc.technical.downforce_delta+=num(row?.technical?.downforce_delta,0);
    acc.technical.design_reliability_delta_pct+=num(row?.technical?.design_reliability_delta_pct,0);
    return acc;
  },{
    qualifying:0,
    race:0,
    reliability:0,
    technical:{
      weight_delta_kg:0,
      drag_delta:0,
      downforce_delta:0,
      design_reliability_delta_pct:0,
    },
  });
}
