// src/race2/core/QualifyingSimulation.js
// RW8.13: detached canonical Qualifying session simulation.
//
// Historical format/lifecycle rules remain owned by QualifyingRulesEngine.
// This core owns only the deterministic maths for one timed session and
// consumes a detached snapshot prepared at the GameState boundary.

import { createRng } from "../../core/random.js";

const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"");
const qualifyingNoise=(rng)=>(rng.next()-0.5)*0.6;

export const QUALIFYING_MODEL_VERSION=1;

export function simulateCanonicalQualifying(input={}){
  if(Number(input?.modelVersion)!==QUALIFYING_MODEL_VERSION){
    throw new TypeError(`QualifyingInput.modelVersion must be ${QUALIFYING_MODEL_VERSION}`);
  }

  const sessionKey=text(input?.sessionKey||"qualifying");
  const seed=text(input?.seed)||"f1ml-unseeded-legacy";
  const entropyKey=text(input?.entropyKey)||sessionKey;
  const rng=createRng(`${seed}::${entropyKey}`);
  const referenceLapMs=Math.round(num(input?.referenceLapMs,79024));
  const weather=input?.weather||{};
  const weatherPerformance=num(weather?.performanceMultiplier,1);
  const wetness=Math.max(0,num(weather?.trackWetness,0));
  const weatherTimeFactor=1+(1-weatherPerformance)*1.15+wetness*0.05;

  const results=(input?.entrants||[])
    .map((entry)=>{
      const driverId=text(entry?.driverId);
      if(!driverId)return null;
      const teamId=text(entry?.teamId)||null;
      const score=num(entry?.basePerformance,0)+qualifyingNoise(rng)*4;
      const paceDelta=Math.max(-12,Math.min(65,100-score));
      const lapTimeMs=Math.max(
        25000,
        Math.round(referenceLapMs*(1+paceDelta*0.0034)*weatherTimeFactor)
      );
      return {driverId,teamId,score,lapTimeMs};
    })
    .filter(Boolean)
    .sort((a,b)=>a.lapTimeMs-b.lapTimeMs||a.driverId.localeCompare(b.driverId))
    .map((row,index)=>({
      position:index+1,
      driver_id:row.driverId,
      team_id:row.teamId,
      performance:row.score,
      lap_time_ms:row.lapTimeMs,
      session_key:sessionKey,
      wet_session:Boolean(weather?.wet),
      weather_state:weather?.state||null,
      track_wetness:wetness,
      track_grip:num(weather?.trackGrip,0),
      air_temp_c:num(weather?.airTempC,0),
      track_temp_c:num(weather?.trackTempC,0),
    }));

  return {
    model:"rw8.13",
    modelVersion:QUALIFYING_MODEL_VERSION,
    source:"rw8.13_qualifying_core",
    results,
  };
}
