// src/race2/runtime/RaceRuntime.js
// RW8.14B: serializable lifecycle boundary between GameState and the canonical
// fixed-step RaceRunner. Runtime snapshots persist state + scheduler remainder;
// no wall-clock or UI-derived race physics are stored here.

import { buildRaceWeekendInput } from "../adapters/GameStateInputAdapter.js";
import { projectRaceStateToRaceView } from "../adapters/RaceViewProjection.js";
import { RACE_WEEKEND_ENGINES } from "../contracts/raceContracts.js";
import { createLiveRaceRunner } from "../core/RaceRunner.js";
import { createRaceState } from "../core/RaceState.js";
import { startRaceState } from "../core/RaceSimulation.js";
import { raceWeekendEngineVersion } from "../gateway/RaceWeekendGateway.js";

export const RACE_RUNTIME_VERSION=1;
export const RACE_RUNTIME_SOURCE="rw8.14b_race_runtime";

const finite=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

export function isCanonicalRaceWeekend(gs){
  return raceWeekendEngineVersion(gs?.raceWeekendState)===RACE_WEEKEND_ENGINES.RW2;
}

export function createCanonicalRaceRuntime(gs,{gp=null,stepMs=null}={}){
  if(!isCanonicalRaceWeekend(gs))return null;
  const input=buildRaceWeekendInput(gs,{gp});
  const options=stepMs==null?{}:{stepMs};
  const state=startRaceState(createRaceState(input,options));
  return {
    version:RACE_RUNTIME_VERSION,
    source:RACE_RUNTIME_SOURCE,
    state,
    accumulatorMs:0,
  };
}

export function restoreCanonicalRaceRunner(runtime){
  if(!runtime?.state)throw new TypeError("Canonical race runtime state is required");
  return createLiveRaceRunner(runtime.state,{
    accumulatorMs:Math.max(0,finite(runtime.accumulatorMs,0)),
  });
}

export function advanceCanonicalRaceRuntime(runtime,elapsedMs){
  const runner=restoreCanonicalRaceRunner(runtime);
  runner.advanceElapsed(elapsedMs);
  const snapshot=runner.snapshot();
  return {
    version:RACE_RUNTIME_VERSION,
    source:RACE_RUNTIME_SOURCE,
    state:snapshot.state,
    accumulatorMs:snapshot.accumulatorMs,
  };
}

export function canonicalRaceView(runtime){
  return runtime?.state?projectRaceStateToRaceView(runtime.state):null;
}

export function attachCanonicalRaceRuntime(gs,runtime){
  if(!gs?.raceWeekendState||!runtime)return gs;
  return {
    ...gs,
    raceWeekendState:{
      ...gs.raceWeekendState,
      canonical_race_runtime:runtime,
    },
  };
}

export function startCanonicalRaceRuntime(gs,{gp=null,stepMs=null}={}){
  const runtime=createCanonicalRaceRuntime(gs,{gp,stepMs});
  return runtime?attachCanonicalRaceRuntime(gs,runtime):gs;
}

export function advanceAttachedCanonicalRaceRuntime(gs,elapsedMs){
  const runtime=gs?.raceWeekendState?.canonical_race_runtime;
  if(!runtime)return gs;
  return attachCanonicalRaceRuntime(gs,advanceCanonicalRaceRuntime(runtime,elapsedMs));
}
