// src/domain/pitCrewTraining.js
// Stage 6.2 — persistent pit-crew training, fatigue and race-day performance.

const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const round=(v,d=3)=>Number(Number(v||0).toFixed(d));

export const PIT_CREW_TRAINING_PRESETS=Object.freeze([
  {id:"recovery",label:"Recovery",load:20,description:"Low training volume. Slow skill growth, fastest fatigue recovery."},
  {id:"balanced",label:"Balanced",load:50,description:"Steady long-term improvement with a small fatigue-recovery bias."},
  {id:"intensive",label:"Intensive",load:80,description:"Faster development, but fatigue builds if maintained for too long."},
  {id:"maximum",label:"Maximum",load:100,description:"Maximum short-term development speed with a strong fatigue cost."},
]);

export function pitCrewTrainingLoadEffects(loadInput){
  const load=clamp(num(loadInput,50),0,100);
  const developmentMultiplier=round(0.25+0.75*(load/100),3);
  const fatigueDelta=round(clamp((load-55)/15,-3,3),2);
  return {
    load,
    development_multiplier:developmentMultiplier,
    fatigue_delta_per_day:fatigueDelta,
    fatigue_direction:fatigueDelta>0.05?"builds":fatigueDelta<-0.05?"recovers":"stable",
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
  const intensity=effects.development_multiplier;

  const paceGain=Math.max(0,avg-2.2)*0.00055*intensity*facilityFactor;
  const consistencyGain=Math.max(0,100-consistency)*0.00045*intensity*facilityFactor;
  const errorGain=Math.max(0,error-0.005)*0.0017*intensity*facilityFactor;
  const nextFatigue=clamp(fatigue+effects.fatigue_delta_per_day,0,100);

  return {
    ...crew,
    training_load:load,
    fatigue:round(nextFatigue,2),
    avg_time_s:round(Math.max(2.2,avg-paceGain),3),
    consistency:round(Math.min(100,consistency+consistencyGain),3),
    error_rate:round(Math.max(0.005,error-errorGain),5),
    last_training_date:dateISO||crew.last_training_date||null,
  };
}

export function pitCrewEffectiveProfile(crewInput={}){
  const crew={...(crewInput||{})};
  const fatigue=clamp(num(crew.fatigue,0),0,100);
  const avgPenalty=fatigue*0.008;
  const consistencyPenalty=fatigue*0.18;
  const errorPenalty=fatigue*0.00045;
  return {
    ...crew,
    fatigue,
    avg_time_s:round(clamp(num(crew.avg_time_s,6.8)+avgPenalty,2,18),2),
    consistency:round(clamp(num(crew.consistency,70)-consistencyPenalty,35,100),1),
    error_rate:round(clamp(num(crew.error_rate,0.05)+errorPenalty,0.005,0.35),3),
    fatigue_penalty:fatigue>0?{
      avg_time_s:round(avgPenalty,2),
      consistency:round(consistencyPenalty,1),
      error_rate:round(errorPenalty,3),
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
