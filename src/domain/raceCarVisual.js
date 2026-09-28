// src/domain/raceCarVisual.js
// Cars Visuals 4.0A — presentation-only helpers for era-specific race sprites.
// This module never changes race physics. It translates authoritative race
// damage state into deterministic values that SVG renderers can consume.

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));

export const RACE_CAR_DAMAGE_COMPONENTS=Object.freeze([
  "front_wing",
  "rear_wing",
  "floor",
  "suspension",
  "brakes",
  "cooling",
]);

export const RACE_CAR_DAMAGE_LABELS=Object.freeze({
  front_wing:"Front Wing",
  rear_wing:"Rear Wing",
  floor:"Floor",
  suspension:"Suspension",
  brakes:"Brakes",
  cooling:"Cooling",
});

export function raceCarEraForYear(yearInput){
  const year=Number(yearInput);
  if(Number.isFinite(year)&&year>=1977&&year<=1982)return "ground_effect_1980";
  return "generic";
}

export function raceCarDamagePct(damageState,component){
  const raw=damageState?.components?.[component];
  return Number(clamp(raw?.damage_pct??raw??0).toFixed(1));
}

export function normaliseRaceCarDamage(damageState){
  return Object.fromEntries(
    RACE_CAR_DAMAGE_COMPONENTS.map((component)=>[
      component,
      raceCarDamagePct(damageState,component),
    ])
  );
}

function damageBand(value){
  const n=clamp(value);
  if(n>=85)return "critical";
  if(n>=60)return "major";
  if(n>=30)return "moderate";
  if(n>0)return "minor";
  return "none";
}

export function raceCarDamageSummary(damageState){
  const values=normaliseRaceCarDamage(damageState);
  const damagedComponents=RACE_CAR_DAMAGE_COMPONENTS
    .filter((component)=>values[component]>0)
    .map((component)=>({
      component,
      label:RACE_CAR_DAMAGE_LABELS[component]||component,
      damage_pct:values[component],
      severity:damageBand(values[component]),
    }))
    .sort((a,b)=>b.damage_pct-a.damage_pct);

  const maxDamage=damagedComponents.length
    ?Math.max(...damagedComponents.map((row)=>row.damage_pct))
    :0;
  const average=damagedComponents.length
    ?damagedComponents.reduce((sum,row)=>sum+row.damage_pct,0)/damagedComponents.length
    :0;
  const derivedOverall=0.65*maxDamage+0.35*average;
  const explicitOverall=Number(damageState?.overall_damage_pct);
  const overall=Number.isFinite(explicitOverall)?clamp(explicitOverall):clamp(derivedOverall);
  const paceLoss=Number(damageState?.pace_loss_s_per_lap);

  return {
    values,
    damaged_components:damagedComponents,
    overall_damage_pct:Number(overall.toFixed(1)),
    severity:String(damageState?.severity||damageBand(overall)),
    pace_loss_s_per_lap:Number.isFinite(paceLoss)?Math.max(0,paceLoss):0,
    can_continue:damageState?.can_continue!==false,
  };
}
