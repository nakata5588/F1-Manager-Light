// src/domain/developmentProject.js
// Stage 6 — Development 2.0
// Deterministic current-car design briefs, cumulative specifications and trade-offs.

import { carComponentDefinition } from "./carComponents.js";
import { componentDevelopmentRule } from "./developmentRegulations.js";
import { componentTechnicalBaseline, derivePartTechnicalProfile } from "./carPartPerformance.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const round=(v,d=3)=>Number(num(v).toFixed(d));

export const MAX_DEVELOPMENT_STRENGTH=6;

const OBJECTIVES=Object.freeze({
  balanced:Object.freeze({
    id:"balanced",label:"Balanced Package",
    description:"Broad improvement with no aggressive technical compromise.",
    areas:["aero","chassis","powertrain","cooling","reliability","hybrid"],
    factors:{weight:1,drag:1,downforce:1,reliability:1,system:1},
    cost:1,duration:1,risk:1,bias:{},
  }),
  downforce:Object.freeze({
    id:"downforce",label:"Downforce",
    description:"Prioritise cornering load. More peak load, but less drag reduction and a smaller reliability margin.",
    areas:["aero"],
    factors:{weight:0.85,drag:0.45,downforce:1.5,reliability:0.72,system:1},
    cost:1.08,duration:1.08,risk:1.12,
    bias:{medium_speed:0.12,high_speed:0.22,aero_stability:0.12,top_speed:-0.06},
  }),
  efficiency:Object.freeze({
    id:"efficiency",label:"Aero Efficiency / Low Drag",
    description:"Reduce drag and improve straight-line efficiency, accepting less peak downforce gain.",
    areas:["aero","cooling"],
    factors:{weight:1,drag:1.55,downforce:0.68,reliability:0.92,system:1.04},
    cost:1.06,duration:1.05,risk:1.06,
    bias:{top_speed:0.18,aero_efficiency:0.24,high_speed:-0.05},
  }),
  lightweight:Object.freeze({
    id:"lightweight",label:"Weight Reduction",
    description:"Aggressive mass reduction. Helps response and acceleration but sacrifices reliability margin.",
    areas:["aero","chassis","powertrain","cooling","reliability","hybrid"],
    factors:{weight:1.72,drag:0.90,downforce:0.88,reliability:0.56,system:1.03},
    reliability_penalty_per_strength:0.08,
    cost:1.12,duration:1.12,risk:1.22,
    bias:{acceleration:0.12,braking:0.06,tyre_preservation:0.05},
  }),
  reliability:Object.freeze({
    id:"reliability",label:"Reliability",
    description:"Strengthen the design and operating margin. Safer, but gives up some pure performance gain.",
    areas:["aero","chassis","powertrain","cooling","reliability","hybrid"],
    factors:{weight:0.48,drag:0.62,downforce:0.55,reliability:2.10,system:0.72},
    cost:0.98,duration:1.06,risk:0.68,
    bias:{cooling:0.08,tyre_preservation:0.04},
  }),
  mechanical_grip:Object.freeze({
    id:"mechanical_grip",label:"Mechanical Grip",
    description:"Prioritise low-speed balance, traction and braking behaviour over outright efficiency.",
    areas:["chassis"],
    factors:{weight:1.05,drag:0.82,downforce:0.82,reliability:0.92,system:1.08},
    cost:1.04,duration:1.04,risk:1.02,
    bias:{low_speed:0.22,mechanical_grip:0.32,braking:0.18,tyre_preservation:0.12,top_speed:-0.04},
  }),
  power_delivery:Object.freeze({
    id:"power_delivery",label:"Power Delivery",
    description:"Prioritise usable power and acceleration. Higher output places more stress on the package.",
    areas:["powertrain","hybrid"],
    factors:{weight:0.82,drag:0.86,downforce:0.55,reliability:0.68,system:1.45},
    cost:1.12,duration:1.10,risk:1.18,
    bias:{acceleration:0.30,top_speed:0.18,cooling:-0.08},
  }),
  cooling_capacity:Object.freeze({
    id:"cooling_capacity",label:"Cooling Capacity",
    description:"Increase thermal headroom and robustness, accepting a small aerodynamic efficiency compromise.",
    areas:["cooling","aero"],
    slots:["cooling","sidepods"],
    factors:{weight:0.82,drag:0.52,downforce:0.62,reliability:1.42,system:1.12},
    cost:1.04,duration:1.05,risk:0.88,
    bias:{cooling:0.38,aero_efficiency:-0.08,top_speed:-0.04},
  }),
});

function objectiveAllowed(objective,definition,slot){
  if(objective.id==="balanced")return true;
  if(Array.isArray(objective.slots))return objective.slots.includes(String(slot));
  return objective.areas.includes(String(definition?.impact_area||"chassis"));
}

export function developmentObjectivesForSlot(gs,slot,teamId=null){
  const definition=carComponentDefinition(gs,slot)||{impact_area:"chassis"};
  const resolvedTeam=String(teamId??gs?.team?.team_id??gs?.team?.id??"");
  const rule=componentDevelopmentRule(gs,resolvedTeam,slot);
  if(!rule.can_start_project)return [];
  const allowed=Object.values(OBJECTIVES).filter((objective)=>objectiveAllowed(objective,definition,slot));
  if(Array.isArray(rule.allowed_objectives)){
    return allowed.filter((objective)=>rule.allowed_objectives.includes(objective.id));
  }
  return allowed;
}

export function developmentObjective(gs,slot,id,teamId=null){
  const allowed=developmentObjectivesForSlot(gs,slot,teamId);
  return allowed.find((objective)=>objective.id===String(id))||allowed[0]||null;
}

export function bestDevelopedPartForSlot(parts,slot){
  return (Array.isArray(parts)?parts:[])
    .filter((part)=>String(part?.slot)===String(slot))
    .sort((a,b)=>num(b?.perf,0)-num(a?.perf,0)||
      String(b?.created_at??b?.id??"").localeCompare(String(a?.created_at??a?.id??"")))[0]||null;
}

export function developmentStrengthTarget(parts,slot,increment){
  const current=bestDevelopedPartForSlot(parts,slot);
  const currentStrength=Math.max(0,num(current?.perf,0));
  const headroom=Math.max(0,MAX_DEVELOPMENT_STRENGTH-currentStrength);
  const applied=Math.min(headroom,Math.max(0,num(increment,0)));
  return {
    current_part:current,
    current_strength:round(currentStrength),
    increment:round(applied),
    target_strength:round(Math.min(MAX_DEVELOPMENT_STRENGTH,currentStrength+applied)),
    headroom:round(headroom),
  };
}

function zeroProfile(gs,slot){
  const baseline=componentTechnicalBaseline(gs,slot);
  return {
    model_version:2,
    slot:String(slot),
    impact_area:baseline.impact_area,
    development_strength:0,
    baseline,
    design:{...baseline},
    delta:{weight_kg:0,drag:0,downforce:0,reliability_pct:0,system_efficiency:0},
    characteristic_bias:{},
    objective:{id:"baseline",label:"Historical / standard design"},
  };
}

export function buildDevelopmentProjection(gs,{
  slot,objectiveId="balanced",targetStrength=0,currentPart=null,teamId=null,
}={}){
  const objective=developmentObjective(gs,slot,objectiveId,teamId)||OBJECTIVES.balanced;
  const strength=clamp(num(targetStrength,0),0,MAX_DEVELOPMENT_STRENGTH);
  const baseline=componentTechnicalBaseline(gs,slot);
  const standard=derivePartTechnicalProfile(gs,{slot,perf:strength});
  const factors=objective.factors||{};
  const reliabilityPenalty=num(objective.reliability_penalty_per_strength,0)*strength;

  const delta={
    weight_kg:round(num(standard?.delta?.weight_kg,0)*num(factors.weight,1),3),
    drag:round(num(standard?.delta?.drag,0)*num(factors.drag,1),5),
    downforce:round(num(standard?.delta?.downforce,0)*num(factors.downforce,1),5),
    reliability_pct:round(
      num(standard?.delta?.reliability_pct,0)*num(factors.reliability,1)-reliabilityPenalty,
      2
    ),
    system_efficiency:round(strength*num(factors.system,1),3),
  };
  const design={
    weight_kg:round(Math.max(0,num(baseline.weight_kg,0)+delta.weight_kg),3),
    drag:round(Math.max(0,num(baseline.drag,0)+delta.drag),5),
    downforce:round(Math.max(0,num(baseline.downforce,0)+delta.downforce),5),
    reliability:round(clamp(num(baseline.reliability,0.8)+delta.reliability_pct/100,0.35,0.99),4),
  };
  const characteristicBias=Object.fromEntries(
    Object.entries(objective.bias||{}).map(([key,coefficient])=>[
      key,round(num(coefficient,0)*strength,2),
    ])
  );
  const current=currentPart?derivePartTechnicalProfile(gs,currentPart):zeroProfile(gs,slot);

  return {
    model_version:2,
    slot:String(slot),
    impact_area:baseline.impact_area,
    development_strength:round(strength),
    baseline,
    design,
    delta,
    characteristic_bias:characteristicBias,
    objective:{
      id:objective.id,
      label:objective.label,
      description:objective.description,
    },
    current:{
      part_id:currentPart?.id||null,
      version:currentPart?.version||null,
      development_strength:round(num(current?.development_strength,currentPart?.perf||0)),
      design:{...(current?.design||baseline)},
      delta:{...(current?.delta||{})},
      characteristic_bias:{...(current?.characteristic_bias||{})},
    },
  };
}

function hash01(text){
  let h=2166136261;
  for(const ch of String(text||"")){
    h^=ch.charCodeAt(0);
    h=Math.imul(h,16777619);
  }
  return (h>>>0)/4294967295;
}

export function realizeDevelopmentProjection(project){
  const projection=project?.technical_projection;
  if(!projection?.baseline||!projection?.design)return projection||null;
  const risk=clamp(num(project?.risk,0.10),0.02,0.35);
  const testFeedback=clamp(num(project?.test_driver_feedback,50),0,100);
  const feedbackStability=0.82+testFeedback/555;
  const variance=risk*0.42*(2-feedbackStability);
  const roll=hash01(`${project?.id}|development-result`);
  const multiplier=clamp(1+(roll-0.5)*2*variance,0.82,1.16);
  const baseline=projection.baseline;
  const source=projection.delta||{};
  const delta={
    weight_kg:round(num(source.weight_kg,0)*multiplier,3),
    drag:round(num(source.drag,0)*multiplier,5),
    downforce:round(num(source.downforce,0)*multiplier,5),
    reliability_pct:round(num(source.reliability_pct,0)*multiplier,2),
    system_efficiency:round(num(source.system_efficiency,0)*multiplier,3),
  };
  const design={
    weight_kg:round(Math.max(0,num(baseline.weight_kg,0)+delta.weight_kg),3),
    drag:round(Math.max(0,num(baseline.drag,0)+delta.drag),5),
    downforce:round(Math.max(0,num(baseline.downforce,0)+delta.downforce),5),
    reliability:round(clamp(num(baseline.reliability,0.8)+delta.reliability_pct/100,0.35,0.99),4),
  };
  const characteristicBias=Object.fromEntries(
    Object.entries(projection.characteristic_bias||{}).map(([key,value])=>[
      key,round(num(value,0)*multiplier,2),
    ])
  );
  return {
    ...projection,
    development_strength:round(
      clamp(num(projection.development_strength,0)*multiplier,0,MAX_DEVELOPMENT_STRENGTH),
      3
    ),
    design,
    delta,
    characteristic_bias:characteristicBias,
    realization:{
      multiplier:round(multiplier,3),
      variance:round(variance,3),
      result:multiplier>=1.025?"above_expectation":multiplier<=0.975?"below_expectation":"on_target",
    },
  };
}

export function objectiveProjectModifiers(gs,slot,objectiveId,teamId=null){
  const objective=developmentObjective(gs,slot,objectiveId,teamId)||OBJECTIVES.balanced;
  return {
    cost_multiplier:num(objective.cost,1),
    duration_multiplier:num(objective.duration,1),
    risk_multiplier:num(objective.risk,1),
  };
}

function facilityRows(gs,teamId){
  const year=Number(gs?.activeYear)||Number(String(gs?.currentDateISO||"").slice(0,4));
  const row=(gs?.facilities||[]).find((item)=>
    String(item?.team_id??item?.team??"")===String(teamId)&&
    (!Number.isFinite(year)||Number(item?.year??year)===year)
  )||{};
  const hq=gs?.hq?.facilityLevels||{};
  const level=(key)=>num(hq?.[key],num(row?.[key],5));
  return {
    aero:level("aero_dept_level"),
    wind:level("wind_tunnel_level"),
    chassis:level("_chassis_shop_level"),
    manufacturing:level("manufacturing_leve"),
  };
}

export function technicalDevelopmentCapacity(gs,teamId,{
  engineeringSupport=50,projects=[],reservedEngineers=0,
}={}){
  const facilities=facilityRows(gs,teamId);
  const facilityAverage=(facilities.aero+facilities.wind+facilities.chassis+facilities.manufacturing)/4;
  const engineerPool=Math.round(clamp(
    4+num(engineeringSupport,50)/18+facilityAverage*0.48,
    6,16
  ));
  const occupying=(projects||[]).filter((project)=>project?.status==="active"||project?.status==="paused");
  const working=occupying.filter((project)=>project?.status==="active");
  const projectEngineers=working.reduce((sum,project)=>sum+Math.max(0,num(project?.engineers,0)),0);
  const reserved=Math.max(0,num(reservedEngineers,0));
  const usedEngineers=projectEngineers+reserved;
  const maxProjects=Math.round(clamp(1+Math.floor((facilityAverage-2)/3),1,3));
  return {
    engineer_pool:engineerPool,
    used_engineers:usedEngineers,
    project_engineers:projectEngineers,
    reserved_engineers:reserved,
    available_engineers:Math.max(0,engineerPool-usedEngineers),
    active_projects:occupying.length,
    working_projects:working.length,
    max_projects:maxProjects,
    project_slot_available:occupying.length<maxProjects,
    facilities,
  };
}
