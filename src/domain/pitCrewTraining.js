// src/domain/pitCrewTraining.js
// Stage 6.2.1 — persistent pit-crew training, fatigue and race-day performance.
//
// Training Load changes the LONG-TERM development rate. Fatigue is a separate,
// persistent race-day state. Recovery is intentionally not a skill-training mode.

const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const round=(v,d=3)=>Number(Number(v||0).toFixed(d));

export const PIT_CREW_TRAINING_PRESETS=Object.freeze([
  {
    id:"recovery",label:"Recovery",load:20,
    description:"No skill training. Prioritises fatigue recovery before the next race.",
  },
  {
    id:"balanced",label:"Balanced",load:50,
    description:"Normal programme. Modest skill gains with almost neutral fatigue.",
  },
  {
    id:"intensive",label:"Intensive",load:80,
    description:"Faster skill development, but fatigue builds noticeably.",
  },
  {
    id:"maximum",label:"Maximum",load:100,
    description:"Strongest raw development. Fatigue builds very quickly and can hurt race-day execution.",
  },
]);

const LOAD_ANCHORS=Object.freeze([
  {load:0,development:0,pace:0,consistency:0,error:0,fatigue:-4.0},
  {load:20,development:0,pace:0,consistency:0,error:0,fatigue:-3.0},
  {load:50,development:0.35,pace:0.08,consistency:0.35,error:0.35,fatigue:0.10},
  {load:80,development:0.80,pace:0.65,consistency:0.75,error:0.75,fatigue:1.60},
  {load:100,development:1.00,pace:1.00,consistency:1.00,error:0.55,fatigue:3.50},
]);

function interpolateAnchors(load){
  const value=clamp(load,0,100);
  if(value<=LOAD_ANCHORS[0].load)return LOAD_ANCHORS[0];
  for(let index=1;index<LOAD_ANCHORS.length;index+=1){
    const right=LOAD_ANCHORS[index];
    const left=LOAD_ANCHORS[index-1];
    if(value>right.load)continue;
    const span=Math.max(1,right.load-left.load);
    const t=(value-left.load)/span;
    return {
      load:value,
      development:left.development+(right.development-left.development)*t,
      pace:left.pace+(right.pace-left.pace)*t,
      consistency:left.consistency+(right.consistency-left.consistency)*t,
      error:left.error+(right.error-left.error)*t,
      fatigue:left.fatigue+(right.fatigue-left.fatigue)*t,
    };
  }
  return LOAD_ANCHORS.at(-1);
}

export function pitCrewTrainingLoadEffects(loadInput){
  const load=clamp(num(loadInput,50),0,100);
  const anchor=interpolateAnchors(load);
  const developmentMultiplier=round(anchor.development,3);
  const fatigueDelta=round(anchor.fatigue,2);
  return {
    load,
    development_multiplier:developmentMultiplier,
    pace_training_multiplier:round(anchor.pace,3),
    consistency_training_multiplier:round(anchor.consistency,3),
    error_training_multiplier:round(anchor.error,3),
    fatigue_delta_per_day:fatigueDelta,
    fatigue_direction:fatigueDelta>0.05?"builds":fatigueDelta<-0.05?"recovers":"stable",
    recovery_only:load<=20,
  };
}

export function advancePitCrewTrainingDay(crewInput={},facilityLevel=5,dateISO=null){
  const crew={...(crewInput||{})};
  const load=clamp(num(crew.training_load,50),0,100);
  const effects=pitCrewTrainingLoadEffects(load);
  const facility=clamp(num(facilityLevel,5),1,10);
  const facilityFactor=0.82+facility*0.036;
  const avg=num(crew.avg_time_s,6.8);
  const consistency=num(crew.consistency,70);
  const error=num(crew.error_rate,0.05);
  const fatigue=clamp(num(crew.fatigue,0),0,100);
  // Recovery has zero multipliers: raw skill is frozen while fatigue comes down.
  // The other presets train different execution dimensions at different rates,
  // so Balanced can be race-neutral while Intensive/Maximum create real trade-offs.
  const paceGain=Math.max(0,avg-2.2)*0.0012*effects.pace_training_multiplier*facilityFactor;
  const consistencyGain=Math.max(0,100-consistency)*0.0014*effects.consistency_training_multiplier*facilityFactor;
  const errorGain=Math.max(0,error-0.005)*0.0040*effects.error_training_multiplier*facilityFactor;
  const nextFatigue=clamp(fatigue+effects.fatigue_delta_per_day,0,100);

  return {
    ...crew,
    training_load:load,
    fatigue:round(nextFatigue,2),
    avg_time_s:round(Math.max(2.2,avg-paceGain),4),
    consistency:round(Math.min(100,consistency+consistencyGain),3),
    error_rate:round(Math.max(0.005,error-errorGain),6),
    last_training_date:dateISO||crew.last_training_date||null,
  };
}

export function pitCrewEffectiveProfile(crewInput={}){
  const crew={...(crewInput||{})};
  const fatigue=clamp(num(crew.fatigue,0),0,100);

  // Fatigue affects execution, not permanent crew skill. Stop pace and
  // consistency deteriorate gently; operational errors rise sharply only once
  // fatigue reaches the overworked zone. This keeps Balanced race-neutral,
  // allows Intensive to make small gains, and makes Maximum risky on race day.
  const avgPenalty=fatigue*0.0012;
  const consistencyPenalty=fatigue*0.005;
  const errorPenalty=fatigue<=15
    ?fatigue*0.00003
    :15*0.00003+(fatigue-15)*0.0005;

  return {
    ...crew,
    fatigue,
    avg_time_s:round(clamp(num(crew.avg_time_s,6.8)+avgPenalty,2,18),3),
    consistency:round(clamp(num(crew.consistency,70)-consistencyPenalty,35,100),2),
    error_rate:round(clamp(num(crew.error_rate,0.05)+errorPenalty,0.005,0.35),5),
    fatigue_penalty:fatigue>0?{
      avg_time_s:round(avgPenalty,3),
      consistency:round(consistencyPenalty,2),
      error_rate:round(errorPenalty,5),
    }:null,
  };
}

export function projectPitCrewTraining(crewInput={},facilityLevel=5,days=7){
  let crew={...(crewInput||{})};
  const count=Math.max(0,Math.floor(num(days,7)));
  for(let i=0;i<count;i+=1){
    crew=advancePitCrewTrainingDay(crew,facilityLevel,null);
  }
  return {
    raw:crew,
    effective:pitCrewEffectiveProfile(crew),
    days:count,
  };
}

export function pitCrewExecutionProfile(crewInput={}){
  const crew=pitCrewEffectiveProfile(crewInput);
  const consistency=clamp(num(crew.consistency,70),35,100);
  const inconsistency=(100-consistency)/100;
  const errorChance=clamp(num(crew.error_rate,0.05)*(1+inconsistency*0.9),0.005,0.35);
  return {
    ...crew,
    execution_variance_s:round(0.18+inconsistency*1.45,3),
    effective_error_chance:round(errorChance,4),
  };
}
