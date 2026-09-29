// src/race2/core/RaceRunner.js
// RW8.3: Live and Fast execution are scheduling policies over one canonical core.
// Neither runner owns race physics; both advance RaceState exclusively through
// RaceSimulation.stepRaceState().

import { stepRaceState } from "./RaceSimulation.js";

const finite=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

export function raceStepMs(state){
  return Math.max(10,Math.min(1000,Math.round(
    finite(state?.session?.simulation?.stepMs,100)
  )));
}

export function runCanonicalSteps(state,steps=1){
  let next=state;
  const count=Math.max(0,Math.floor(finite(steps,0)));
  for(let index=0;index<count;index+=1){
    if(!next||next.status==="finished")break;
    next=stepRaceState(next);
  }
  return next;
}

/**
 * Stateful scheduler for UI/live execution. Wall-clock chunks are accumulated
 * and converted into canonical fixed steps. The remainder is retained so the
 * result is independent of render/update chunk size.
 */
export function createLiveRaceRunner(initialState,{accumulatorMs=0}={}){
  let state=initialState;
  let remainder=Math.max(0,finite(accumulatorMs,0));

  return {
    getState:()=>state,
    getAccumulatorMs:()=>remainder,
    advanceElapsed(elapsedMs){
      if(!state||state.status==="finished")return state;
      remainder+=Math.max(0,finite(elapsedMs,0));
      const stepMs=raceStepMs(state);
      // Floating-point elapsed chunks (for example 1000 × 0.1 ms) can sum to
      // a value microscopically below an exact step boundary. Use a bounded
      // tolerance only for scheduling; canonical race physics still advances
      // exclusively in exact fixed steps.
      const thresholdToleranceMs=Math.max(1e-9,stepMs*1e-12);
      const steps=Math.floor((remainder+thresholdToleranceMs)/stepMs);
      if(steps>0){
        state=runCanonicalSteps(state,steps);
        remainder-=steps*stepMs;
        if(Math.abs(remainder)<=thresholdToleranceMs)remainder=0;
      }
      return state;
    },
    step(){
      if(state&&state.status!=="finished")state=runCanonicalSteps(state,1);
      return state;
    },
    snapshot(){
      return {state,accumulatorMs:remainder};
    },
  };
}

/**
 * Fast execution uses the exact same fixed-step primitive as Live. `steps` is
 * deliberately explicit: future autosim can choose batching without creating
 * a second simulation model.
 */
export function runFastRace(state,{steps=1}={}){
  return runCanonicalSteps(state,steps);
}

export function runFastRaceToEnd(state,{maxSteps=1_000_000}={}){
  let next=state;
  const limit=Math.max(0,Math.floor(finite(maxSteps,0)));
  for(let index=0;index<limit;index+=1){
    if(!next||next.status==="finished")return next;
    next=stepRaceState(next);
  }
  if(next&&next.status!=="finished"){
    throw new Error(`RW2 race did not finish within ${limit} canonical steps`);
  }
  return next;
}
