// src/domain/driverRating.js
//
// Dynamic overall rating support.
//
// Historical current_ability remains the editorial baseline. Attribute changes
// move the live overall relative to that baseline instead of replacing the
// historical rating with a raw attribute average.

export const ABILITY_ATTRIBUTE_WEIGHTS = Object.freeze({
  pace: 0.18,
  qualifying: 0.10,
  start_launch: 0.05,
  racecraft: 0.13,
  wet_skill: 0.05,
  consistency: 0.11,
  tire_management: 0.07,
  race_intelligence: 0.09,
  technical_feedback: 0.03,
  adaptability: 0.04,
  ers_fuel_management: 0.03,
  mentality: 0.05,
  pressure_handling: 0.04,
  crash_likelihood: -0.03,
});

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const round1=(n)=>Math.round(Number(n||0)*10)/10;

export function abilityAttributeScore(rating){
  if(!rating||typeof rating!=="object")return null;
  let sum=0;
  let total=0;
  for(const [key,weight] of Object.entries(ABILITY_ATTRIBUTE_WEIGHTS)){
    const raw=Number(rating[key]);
    if(!Number.isFinite(raw))continue;
    const magnitude=Math.abs(weight);
    const value=weight<0 ? 100-clamp(raw) : clamp(raw);
    sum += value*magnitude;
    total += magnitude;
  }
  return total>0 ? sum/total : null;
}

export function ensureAbilityAnchor(rating){
  if(!rating||typeof rating!=="object")return rating;
  const copy={...rating};
  const current=Number(copy.current_ability);
  const score=abilityAttributeScore(copy);

  if(!Number.isFinite(Number(copy._ability_anchor_current)) && Number.isFinite(current)){
    copy._ability_anchor_current=round1(current);
  }
  if(!Number.isFinite(Number(copy._ability_anchor_score)) && Number.isFinite(score)){
    copy._ability_anchor_score=round1(score);
  }
  return copy;
}

export function recalculateCurrentAbility(rating){
  const anchored=ensureAbilityAnchor(rating);
  const anchorCurrent=Number(anchored?._ability_anchor_current);
  const anchorScore=Number(anchored?._ability_anchor_score);
  const score=abilityAttributeScore(anchored);
  if(!Number.isFinite(anchorCurrent)||!Number.isFinite(anchorScore)||!Number.isFinite(score))return anchored;

  // Attribute deltas translate 1:1 into the composite movement. Because each
  // individual attribute has a fractional weight, normal training moves OVR
  // gradually (e.g. +1 consistency ~= +0.1 OVR), rather than inflating it.
  let next=anchorCurrent+(score-anchorScore);
  const potential=Number(anchored.potential_ability);
  if(Number.isFinite(potential) && potential>=anchorCurrent) next=Math.min(next,potential);

  return {
    ...anchored,
    current_ability:round1(clamp(next)),
    _ability_live_score:round1(score),
  };
}

export function defaultDriverCondition(){
  return { confidence:50, fatigue:0, morale:50, preparation:50 };
}

export function normalizeDriverCondition(value){
  const base=defaultDriverCondition();
  const src=value&&typeof value==="object"?value:{};
  return {
    confidence:clamp(Number.isFinite(Number(src.confidence))?Number(src.confidence):base.confidence),
    fatigue:clamp(Number.isFinite(Number(src.fatigue))?Number(src.fatigue):base.fatigue),
    morale:clamp(Number.isFinite(Number(src.morale))?Number(src.morale):base.morale),
    preparation:clamp(Number.isFinite(Number(src.preparation))?Number(src.preparation):base.preparation),
  };
}

export function driverCondition(gs,driverId){
  const dict=gs?.driverAttributes||{};
  const direct=dict[String(driverId)];
  if(direct)return normalizeDriverCondition(direct);
  const digits=String(driverId??"").match(/(\d+)/)?.[1]?.padStart(4,"0");
  return normalizeDriverCondition(digits ? dict[digits] : null);
}

export function fatiguePenalty(gs,driverId){
  const fatigue=Number(driverCondition(gs,driverId)?.fatigue ?? 0);
  // 0 means fully fresh. Normal workload is effectively free; sustained load
  // above 25 starts to reduce performance and reaches -6 at extreme fatigue.
  if(!Number.isFinite(fatigue)||fatigue<=25)return 0;
  return Math.min(6,(fatigue-25)*0.08);
}

export function intensiveTrainingStatus(gs,driverId){
  const fatigue=Number(driverCondition(gs,driverId)?.fatigue ?? 0);
  const value=Number.isFinite(fatigue)?clamp(fatigue):0;
  const allowed=value<70;
  const efficiency=value>=60?0.50:value>=45?0.75:1;
  return {
    fatigue:value,
    allowed,
    efficiency:allowed?efficiency:0,
    label:!allowed?"Too fatigued":value>=60?"Severely fatigued":value>=45?"Fatigued":"Ready",
  };
}
