// src/race2/core/PracticeSimulation.js
// RW8.12: detached canonical Practice simulation.
//
// This module owns Practice programme selection and the deterministic session
// maths. It consumes a detached snapshot prepared at the GameState boundary and
// returns official Practice results plus explicit persistent effects.

import { createRng } from "../../core/random.js";
import {
  mechanicalFailureChance,
  selectMechanicalFailureReason,
} from "../../domain/carReliability.js";
import { applyMentalStateDeltaToCondition } from "../../domain/driverMentalState.js";

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const round1=(n)=>Math.round(Number(n||0)*10)/10;
const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"");

export const PRACTICE_PROGRAMMES=Object.freeze({
  balanced:Object.freeze({
    id:"balanced",
    label:"Balanced",
    description:"Evenly develops setup knowledge and race preparation.",
    mileageFactor:1.00,
    learningMultiplier:1.00,
    preparationGain:7,
    fatigue:7,
    wearFactor:1.00,
    incidentRisk:1.00,
    qualifyingBonus:0.25,
    raceBonus:0.25,
    reliabilityBonus:0.15,
  }),
  setup:Object.freeze({
    id:"setup",
    label:"Setup Focus",
    description:"Prioritises understanding the car and finding the circuit setup window.",
    mileageFactor:0.95,
    learningMultiplier:1.28,
    preparationGain:8,
    fatigue:6,
    wearFactor:0.90,
    incidentRisk:0.85,
    qualifyingBonus:0.20,
    raceBonus:0.20,
    reliabilityBonus:0.20,
  }),
  qualifying:Object.freeze({
    id:"qualifying",
    label:"Qualifying Focus",
    description:"Shorter, harder runs aimed at one-lap performance.",
    mileageFactor:0.82,
    learningMultiplier:0.92,
    preparationGain:6,
    fatigue:10,
    wearFactor:1.10,
    incidentRisk:1.22,
    qualifyingBonus:1.10,
    raceBonus:0.05,
    reliabilityBonus:0.00,
  }),
  race:Object.freeze({
    id:"race",
    label:"Race Focus",
    description:"Longer runs aimed at consistency and race trim.",
    mileageFactor:1.25,
    learningMultiplier:0.92,
    preparationGain:8,
    fatigue:12,
    wearFactor:1.22,
    incidentRisk:1.12,
    qualifyingBonus:0.00,
    raceBonus:1.05,
    reliabilityBonus:0.10,
  }),
  reliability:Object.freeze({
    id:"reliability",
    label:"Reliability Focus",
    description:"Controlled running aimed at understanding mechanical limits.",
    mileageFactor:0.88,
    learningMultiplier:0.82,
    preparationGain:5,
    fatigue:5,
    wearFactor:0.72,
    incidentRisk:0.68,
    qualifyingBonus:0.00,
    raceBonus:0.10,
    reliabilityBonus:1.35,
  }),
});

export function practiceProgramme(id){
  return PRACTICE_PROGRAMMES[text(id).toLowerCase()]||PRACTICE_PROGRAMMES.balanced;
}

export function practiceProgrammeForEntrant(entry={}){
  if(entry?.isPlayerTeam){
    return practiceProgramme(entry?.requestedProgrammeId||"balanced");
  }
  if(num(entry?.carReliabilityScore,75)<66)return PRACTICE_PROGRAMMES.reliability;
  if(num(entry?.engineeringSupport,50)<55)return PRACTICE_PROGRAMMES.setup;
  const rating=entry?.rating||{};
  if(num(rating?.qualifying,60)-num(rating?.racecraft,60)>8)return PRACTICE_PROGRAMMES.qualifying;
  if(num(rating?.racecraft,60)-num(rating?.qualifying,60)>8)return PRACTICE_PROGRAMMES.race;
  return PRACTICE_PROGRAMMES.balanced;
}

function setupQuality(actual,target){
  const fields=["aeroBalance","mechanicalGrip","gearing","cooling"];
  const meanError=fields.reduce(
    (sum,key)=>sum+Math.abs(num(actual?.[key],50)-num(target?.[key],50)),
    0
  )/fields.length;
  return round1(clamp(100-meanError*2.25,25,100));
}

function feedbackFor(actual,target){
  const labels={
    aeroBalance:"Aero balance",
    mechanicalGrip:"Mechanical grip",
    gearing:"Gearing",
    cooling:"Cooling",
  };
  const rows=Object.keys(labels).map((key)=>({
    key,
    error:Math.abs(num(actual?.[key],50)-num(target?.[key],50)),
  })).sort((a,b)=>b.error-a.error);
  const main=rows[0];
  if(!main||main.error<3)return "The car is inside a strong setup window.";
  if(main.error<7)return `${labels[main.key]} still needs a small adjustment.`;
  return `${labels[main.key]} remains the main setup concern.`;
}

function issueFor(input,entry,programme){
  const rating=entry?.rating||{};
  const crash=num(rating?.crash_likelihood,25)/100;
  const fatigue=num(entry?.conditionBefore?.fatigue,0);
  const reliability=entry?.reliabilityProfile||{};
  const rng=createRng(
    `${text(input?.seed)||"f1ml-unseeded-legacy"}::${text(input?.weekendKey)}-practice-issue-${text(entry?.driverId)}`
  );

  const trackRiskFactor=0.80+clamp(input?.trackRisk,0,100)/250;
  const fatigueRisk=Math.max(0,fatigue-35)*0.00032;
  const contactChance=clamp(
    ((0.002+crash*0.018)*programme.incidentRisk*trackRiskFactor*num(input?.weatherRisk,1))+fatigueRisk,
    0,
    0.11
  );
  const mechanicalChance=mechanicalFailureChance(reliability,{
    session:"practice",
    programmeRisk:programme.incidentRisk,
    weatherRisk:0.95+num(input?.weatherRisk,1)*0.05,
    fatigue,
  });
  const roll=rng.next();

  if(roll<contactChance){
    return {
      issue_type:"contact",
      issue_slot:"aero_front",
      issue_note:"Minor contact interrupted part of the programme.",
    };
  }
  if(roll<contactChance+mechanicalChance){
    const cause=selectMechanicalFailureReason(reliability,rng.next());
    return {
      issue_type:"mechanical",
      issue_slot:cause?.slot==="engine"?null:cause?.slot||null,
      issue_reason:cause?.reason||"Mechanical",
      issue_note:`${cause?.reason||"A mechanical issue"} shortened the running.`,
    };
  }
  return {issue_type:null,issue_slot:null,issue_note:null};
}

export function simulateCanonicalPractice(input={}){
  const trackProfile=input?.trackProfile||{};
  const target=trackProfile?.target||{};
  const sessionWeather=input?.sessionWeather||null;
  const conditionByDriver={};
  const results=[];

  for(const entry of input?.entrants||[]){
    const driverId=text(entry?.driverId);
    const teamId=text(entry?.teamId);
    if(!driverId||!teamId)continue;

    const programme=practiceProgrammeForEntrant(entry);
    const rating=entry?.rating||{};
    const engineering=clamp(entry?.engineeringSupport,0,100);
    const relationship=entry?.engineerRelationship||{};
    const feedback=clamp(num(rating?.technical_feedback,50));
    const adaptability=clamp(num(rating?.adaptability,50));
    const consistency=clamp(num(rating?.consistency,50));
    const previous=entry?.conditionBefore||{};
    const fatigueBefore=clamp(num(previous?.fatigue,0));
    const fatigueEfficiency=clamp(1-Math.max(0,fatigueBefore-15)*0.006,0.55,1);
    const learning=clamp((
      feedback*0.38+
      adaptability*0.20+
      consistency*0.12+
      engineering*0.30
    )*fatigueEfficiency*num(input?.weatherLearning,1)*num(relationship?.multiplier,1));

    const rng=createRng(
      `${text(input?.seed)||"f1ml-unseeded-legacy"}::${text(input?.weekendKey)}-practice-setup-${driverId}`
    );
    const initial={};
    const final={};
    const progress=clamp(
      (0.28+(learning/100)*0.50)*programme.learningMultiplier,
      0.20,
      0.92
    );
    for(const [key,targetValue] of Object.entries(target)){
      const initialError=(rng.next()-0.5)*38;
      initial[key]=round1(clamp(targetValue+initialError));
      final[key]=round1(clamp(targetValue+initialError*(1-progress)));
    }

    const quality=setupQuality(final,target);
    const knowledge=round1(clamp(
      22+
      learning*0.52+
      programme.mileageFactor*12+
      (programme.id==="setup"?8:0)
    ));
    const issue=issueFor(input,entry,programme);
    const issuePenalty=issue.issue_type?2:0;
    const prepGain=clamp((
      programme.preparationGain+
      Math.max(0,quality-60)*0.05+
      Math.max(0,knowledge-60)*0.025-
      issuePenalty
    )*(0.70+fatigueEfficiency*0.30),2,14);

    const nextCondition=applyMentalStateDeltaToCondition(previous,{
      preparation:prepGain,
      fatigue:programme.fatigue,
      confidence:quality>=82?1:quality<55?-0.5:0,
    });
    conditionByDriver[driverId]=nextCondition;

    results.push({
      driver_id:driverId,
      team_id:teamId,
      programme_id:programme.id,
      programme_label:programme.label,
      engineering_support:engineering,
      engineer_relationship_score:num(relationship?.score,50),
      engineer_relationship_multiplier:num(relationship?.multiplier,1),
      engineer_relationship_label:relationship?.label??null,
      learning_rate:round1(learning),
      setup_knowledge:knowledge,
      setup_quality:quality,
      preparation_gain:round1(prepGain),
      fatigue_before:round1(fatigueBefore),
      fatigue_after:round1(nextCondition?.fatigue),
      fatigue_efficiency:round1(fatigueEfficiency*100),
      fatigue_performance_penalty_before:round1(entry?.fatiguePerformancePenaltyBefore),
      initial_setup:initial,
      setup:final,
      target_setup:target,
      feedback:feedbackFor(final,target),
      qualifying_bonus:round1(programme.qualifyingBonus*(0.62+0.38*num(input?.qualifyingRelevance,0.75))),
      race_bonus:round1(programme.raceBonus*(0.62+0.38*num(input?.raceRelevance,0.75))),
      reliability_bonus:0,
      reliability_diagnostic_bonus:programme.reliabilityBonus,
      mileage_factor:programme.mileageFactor,
      wear_factor:round1(programme.wearFactor*(0.85+num(input?.tyreWear,50)/100*0.30)),
      fatigue_cost:programme.fatigue,
      weather_state:sessionWeather?.state||null,
      track_wetness:round1(num(sessionWeather?.track?.start_wetness,0)*100),
      track_grip:round1(num(sessionWeather?.track?.grip_index,88)),
      track_temp_c:round1(num(sessionWeather?.track_temp_c,0)),
      qualifying_weather_relevance:round1(num(input?.qualifyingRelevance,0.75)*100),
      race_weather_relevance:round1(num(input?.raceRelevance,0.75)*100),
      ...issue,
    });
  }

  return {
    model:"rw8.12",
    source:"rw8.12_practice_core",
    results,
    effects:{conditionByDriver},
  };
}
