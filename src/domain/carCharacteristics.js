// src/domain/carCharacteristics.js
// Era-aware driving characteristics built from the historical car baseline plus
// fitted developed-part deltas. Values are normalized 0–100 ratings, not fake
// physical km/h or G figures.

import { garageCarForDriver, installedPartsForCar } from "./garage.js";
import { technicalAdjustmentForPart } from "./carPartPerformance.js";
import { aiTechnicalCarForDriver, aiTechnicalScopedState } from "../engine/AITechnicalEngine.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const round1=(v)=>Math.round(Number(v||0)*10)/10;

function teamIdOf(row){return String(pick(row,["team_id","team","constructor_id","constructor"],""));}
function yearOf(gs){return Number(gs?.activeYear)||Number(String(gs?.currentDateISO||"").slice(0,4))||1980;}
function groundEffectEra(year){return (year>=1977&&year<=1982)||year>=2022;}
function rowForTeam(rows,teamId,year){
  const list=Array.isArray(rows)?rows:[];
  return list.find((row)=>teamIdOf(row)===String(teamId)&&Number(row?.year??row?.season_year)===Number(year))
    ||list.find((row)=>teamIdOf(row)===String(teamId))
    ||{};
}

const CHARACTERISTIC_LABELS=Object.freeze({
  top_speed:"Top Speed",
  acceleration:"Acceleration",
  low_speed:"Low-speed Cornering",
  medium_speed:"Medium-speed Cornering",
  high_speed:"High-speed Cornering",
  mechanical_grip:"Mechanical Grip",
  braking:"Braking",
  aero_efficiency:"Aero Efficiency",
  aero_stability:"Aero Stability",
  tyre_preservation:"Tyre Preservation",
  cooling:"Cooling",
  ground_effect:"Ground Effect",
});

const SLOT_CHARACTERISTIC_WEIGHTS=Object.freeze({
  chassis:{acceleration:0.16,low_speed:0.32,medium_speed:0.28,high_speed:0.25,mechanical_grip:0.34,braking:0.18,aero_stability:0.18,tyre_preservation:0.16},
  aero_front:{top_speed:-0.08,low_speed:0.28,medium_speed:0.42,high_speed:0.34,aero_efficiency:0.42,aero_stability:0.40},
  aero_rear:{top_speed:-0.10,acceleration:-0.03,medium_speed:0.30,high_speed:0.50,aero_efficiency:0.36,aero_stability:0.46},
  sidepods:{top_speed:0.08,acceleration:0.04,medium_speed:0.22,high_speed:0.30,aero_efficiency:0.36,aero_stability:0.28,cooling:0.36,ground_effect:0.26},
  underfloor:{top_speed:0.04,low_speed:0.18,medium_speed:0.46,high_speed:0.58,aero_efficiency:0.46,aero_stability:0.44,ground_effect:0.72},
  suspension:{acceleration:0.08,low_speed:0.44,medium_speed:0.30,high_speed:0.18,mechanical_grip:0.62,braking:0.34,tyre_preservation:0.52},
  gearbox:{top_speed:0.26,acceleration:0.62,mechanical_grip:0.04},
  brakes:{low_speed:0.12,mechanical_grip:0.14,braking:0.76,tyre_preservation:0.16},
  cooling:{top_speed:-0.02,cooling:0.82,aero_efficiency:0.10},
  turbocharger:{top_speed:0.52,acceleration:0.66,cooling:-0.08},
  electronics:{acceleration:0.12,cooling:0.10},
  kers:{acceleration:0.68,top_speed:0.16},
  ers_mgu_k:{acceleration:0.72,top_speed:0.20},
  ers_mgu_h:{acceleration:0.46,top_speed:0.36},
  battery_pack:{acceleration:0.26},
  fuel_system:{acceleration:0.16,cooling:0.12},
  exhaust_system:{top_speed:0.18,acceleration:0.20},
});

function baselineCharacteristics(gs,teamId){
  const year=yearOf(gs);
  const car=rowForTeam(gs?.carStats||gs?.dbCarStats||[],teamId,year);
  const engine=rowForTeam(gs?.teamEngines||gs?.dbTeamEngines||[],teamId,year);
  const chassis=num(car?.chassis_spec,70);
  const aero=num(car?.aero_spec,70);
  const gearbox=num(car?.gearbox_spec,70);
  const suspension=num(car?.suspension_spec,70);
  const brakes=num(car?.brakes_spec,70);
  const cooling=num(car?.cooling_spec,70);
  const power=num(pick(engine,["power","engine_power","Ovrl","overall"],70),70);
  const weight=num(car?.weight,600);
  const weightScore=clamp(80-(weight-580)*0.35,50,95);
  const groundEffectYear=groundEffectEra(year);

  return {
    top_speed:clamp(power*0.55+gearbox*0.20+aero*0.10+weightScore*0.15),
    acceleration:clamp(power*0.42+gearbox*0.30+chassis*0.12+weightScore*0.16),
    low_speed:clamp(suspension*0.34+chassis*0.28+aero*0.16+brakes*0.12+weightScore*0.10),
    medium_speed:clamp(aero*0.38+suspension*0.24+chassis*0.24+weightScore*0.10+brakes*0.04),
    high_speed:clamp(aero*0.48+chassis*0.26+suspension*0.14+weightScore*0.12),
    mechanical_grip:clamp(suspension*0.50+chassis*0.26+brakes*0.12+weightScore*0.12),
    braking:clamp(brakes*0.58+suspension*0.20+chassis*0.12+weightScore*0.10),
    aero_efficiency:clamp(aero*0.82+weightScore*0.18),
    aero_stability:clamp(aero*0.56+chassis*0.28+suspension*0.16),
    tyre_preservation:clamp(suspension*0.38+chassis*0.24+brakes*0.18+cooling*0.08+weightScore*0.12),
    cooling:clamp(cooling),
    ground_effect:groundEffectYear?clamp(aero*0.72+chassis*0.28):null,
  };
}

function characteristicUpgradeDeltas(gs,car){
  const delta=Object.fromEntries(Object.keys(CHARACTERISTIC_LABELS).map((key)=>[key,0]));
  if(!car)return delta;
  for(const {slot,part,unit} of installedPartsForCar(gs,car)){
    const condition=clamp(unit?.condition??part?.condition??100);
    const strength=Math.max(0,num(part?.perf,0))*(condition/100);
    const technical=technicalAdjustmentForPart(gs,{slot,part,condition});
    const weights=SLOT_CHARACTERISTIC_WEIGHTS[slot]||{};
    const technicalScale=
      Math.max(0,num(technical?.technical?.downforce_delta,0))*55+
      Math.max(0,-num(technical?.technical?.drag_delta,0))*85+
      Math.max(0,-num(technical?.technical?.weight_delta_kg,0))*0.08;
    const baseScale=strength*0.48+technicalScale;
    for(const [key,weight] of Object.entries(weights)){
      delta[key]+=baseScale*Number(weight||0);
    }
  }
  return Object.fromEntries(Object.entries(delta).map(([key,value])=>[key,round1(value)]));
}

export function teamCarCharacteristics(gs,teamId,driverId=null){
  const baseline=baselineCharacteristics(gs,teamId);
  const player=String(gs?.team?.team_id??gs?.team?.id??"");
  const isPlayer=String(teamId)===player;
  let upgradeDelta=Object.fromEntries(Object.keys(CHARACTERISTIC_LABELS).map((key)=>[key,0]));

  if(isPlayer){
    if(driverId){
      upgradeDelta=characteristicUpgradeDeltas(gs,garageCarForDriver(gs,driverId));
    }else{
      const cars=(gs?.garage?.cars||[]).filter((car)=>car?.kind==="race");
      if(cars.length){
        const rows=cars.map((car)=>characteristicUpgradeDeltas(gs,car));
        upgradeDelta=Object.fromEntries(Object.keys(CHARACTERISTIC_LABELS).map((key)=>[
          key,
          round1(rows.reduce((sum,row)=>sum+num(row?.[key],0),0)/rows.length),
        ]));
      }
    }
  }else{
    const aiState=aiTechnicalScopedState(gs,teamId);
    if(aiState){
      if(driverId){
        upgradeDelta=characteristicUpgradeDeltas(aiState,aiTechnicalCarForDriver(gs,teamId,driverId));
      }else{
        const cars=(aiState?.garage?.cars||[]).filter((car)=>car?.kind==="race");
        if(cars.length){
          const rows=cars.map((car)=>characteristicUpgradeDeltas(aiState,car));
          upgradeDelta=Object.fromEntries(Object.keys(CHARACTERISTIC_LABELS).map((key)=>[
            key,
            round1(rows.reduce((sum,row)=>sum+num(row?.[key],0),0)/rows.length),
          ]));
        }
      }
    }
  }

  const values={};
  for(const key of Object.keys(CHARACTERISTIC_LABELS)){
    if(baseline[key]==null){values[key]=null;continue;}
    values[key]=round1(clamp(num(baseline[key],0)+num(upgradeDelta[key],0)));
  }
  return {values,baseline,upgrade_delta:upgradeDelta,labels:CHARACTERISTIC_LABELS};
}

function resolveTrack(gs,gp,track){
  if(track&&typeof track==="object")return track;
  const trackId=String(gp?.track_id??gp?.id??"");
  return (gs?.coreTracks||gs?.dbCoreTracks||[]).find((row)=>String(row?.track_id??row?.id??"")===trackId)||gp||{};
}

export function trackCharacteristicPriorities(gs,{gp=null,track=null}={}){
  const row=resolveTrack(gs,gp,track);
  const lapLength=num(row?.lap_length_km,5);
  const tyreWear=clamp(num(row?.tyre_wear,60));
  const overtaking=clamp(num(row?.overtaking_difficulty,55));
  const crash=clamp(num(row?.crash_risk,55));
  const year=yearOf(gs);

  const weights={
    top_speed:0.75+Math.max(0,lapLength-4.5)*0.16+Math.max(0,60-overtaking)*0.004,
    acceleration:0.72+Math.max(0,65-overtaking)*0.003,
    low_speed:0.58+overtaking*0.002,
    medium_speed:0.80,
    high_speed:0.72+Math.max(0,lapLength-4)*0.07,
    mechanical_grip:0.74+tyreWear*0.002,
    braking:0.64+crash*0.002,
    aero_efficiency:0.78+Math.max(0,lapLength-4)*0.06,
    aero_stability:0.72+crash*0.0015,
    tyre_preservation:0.55+tyreWear*0.006,
    cooling:0.50+tyreWear*0.002,
    ground_effect:groundEffectEra(year)?0.74:0,
  };
  const total=Object.values(weights).reduce((a,b)=>a+b,0)||1;
  const normalized=Object.fromEntries(Object.entries(weights).map(([key,value])=>[key,value/total]));
  const important=Object.entries(normalized)
    .filter(([key])=>key!=="ground_effect"||groundEffectEra(year))
    .sort((a,b)=>b[1]-a[1])
    .slice(0,4)
    .map(([key,weight])=>({key,label:CHARACTERISTIC_LABELS[key],weight}));
  return {weights:normalized,important,track:row};
}

export function trackSensitiveUpgradeModifier(gs,{teamId,driverId=null,gp=null,track=null}={}){
  const characteristics=teamCarCharacteristics(gs,teamId,driverId);
  const priorities=trackCharacteristicPriorities(gs,{gp,track});
  let weighted=0;
  for(const [key,weight] of Object.entries(priorities.weights)){
    weighted+=num(characteristics.upgrade_delta?.[key],0)*weight;
  }
  return {
    modifier:Number(clamp(weighted*0.18,-1.5,1.5).toFixed(3)),
    characteristics,
    priorities,
  };
}

export { CHARACTERISTIC_LABELS, SLOT_CHARACTERISTIC_WEIGHTS };
