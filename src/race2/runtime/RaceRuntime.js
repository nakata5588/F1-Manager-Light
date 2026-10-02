// src/race2/runtime/RaceRuntime.js
// RW8.14B-D: serializable lifecycle boundary between GameState and the canonical
// fixed-step RaceRunner. Runtime snapshots persist state + scheduler remainder;
// no wall-clock or UI-derived race physics are stored here.

import { buildRaceWeekendInput } from "../adapters/GameStateInputAdapter.js";
import { projectRaceStateToRaceView } from "../adapters/RaceViewProjection.js";
import { RACE_WEEKEND_ENGINES } from "../contracts/raceContracts.js";
import { createLiveRaceRunner, runFastRace } from "../core/RaceRunner.js";
import { createRaceState } from "../core/RaceState.js";
import { startRaceState } from "../core/RaceSimulation.js";
import {
  applyCanonicalRedFlagDamageRepair,
  applyCanonicalRedFlagRestartStrategy,
  applyCanonicalRedFlagTyreChange,
} from "../core/RaceRedFlagWork.js";
import { raceWeekendEngineVersion } from "../gateway/RaceWeekendGateway.js";

export const RACE_RUNTIME_VERSION=1;
export const RACE_RUNTIME_SOURCE="rw8.14b_race_runtime";
export const RACE_RUNTIME_CHECKPOINT_INTERVAL_MS=5000;

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

function serializedRunner(runner){
  const snapshot=runner.snapshot();
  return {
    version:RACE_RUNTIME_VERSION,
    source:RACE_RUNTIME_SOURCE,
    state:snapshot.state,
    accumulatorMs:snapshot.accumulatorMs,
  };
}

export function advanceCanonicalRaceRuntime(runtime,elapsedMs){
  const runner=restoreCanonicalRaceRunner(runtime);
  runner.advanceElapsed(elapsedMs);
  return serializedRunner(runner);
}

export function runCanonicalRaceRuntimeBatch(runtime,{steps=250}={}){
  if(!runtime?.state)throw new TypeError("Canonical race runtime state is required");
  if(runtime.state.status==="finished")return {...runtime,accumulatorMs:0};
  return {
    version:RACE_RUNTIME_VERSION,
    source:RACE_RUNTIME_SOURCE,
    state:runFastRace(runtime.state,{steps:Math.max(1,Math.floor(finite(steps,250)))}),
    accumulatorMs:0,
  };
}
export function queueCanonicalRaceRuntimeCommand(runtime,command){
  const runner=restoreCanonicalRaceRunner(runtime);
  runner.queueCommand(command);
  return serializedRunner(runner);
}

export function cancelCanonicalRaceRuntimeCommand(runtime,criteria={}){
  const runner=restoreCanonicalRaceRunner(runtime);
  runner.cancelCommand(criteria);
  return serializedRunner(runner);
}

export function applyCanonicalRaceRuntimeRedFlagWork(runtime,work={}){
  if(!runtime?.state)throw new TypeError("Canonical race runtime state is required");
  const kind=String(work?.type||"");
  const nextState=kind==="tyre"
    ?applyCanonicalRedFlagTyreChange(runtime.state,work)
    :kind==="repair"
      ?applyCanonicalRedFlagDamageRepair(runtime.state,work)
      :kind==="strategy"
        ?applyCanonicalRedFlagRestartStrategy(runtime.state,work)
        :runtime.state;
  if(nextState===runtime.state)return runtime;
  return {
    ...runtime,
    state:nextState,
  };
}

export function canonicalRaceRuntimeNeedsCheckpoint(previousRuntime,nextRuntime,{intervalMs=RACE_RUNTIME_CHECKPOINT_INTERVAL_MS}={}){
  if(!nextRuntime?.state)return false;
  if(!previousRuntime?.state)return true;
  const previousStatus=String(previousRuntime.state?.status||"");
  const nextStatus=String(nextRuntime.state?.status||"");
  if(nextStatus==="finished"&&previousStatus!=="finished")return true;
  const interval=Math.max(1000,finite(intervalMs,RACE_RUNTIME_CHECKPOINT_INTERVAL_MS));
  const previousMs=Math.max(0,finite(previousRuntime.state?.simulationTimeMs,0));
  const nextMs=Math.max(0,finite(nextRuntime.state?.simulationTimeMs,0));
  return Math.floor(previousMs/interval)!==Math.floor(nextMs/interval);
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

// RW8.14C: one engine-locked entry point for the gameplay layer. Existing RW2
// snapshots are resumed verbatim; a runtime is created only for a locked RW2
// weekend that has actually reached the race phase. Legacy weekends remain
// untouched, so callers never need to infer/migrate engine ownership.
export function ensureCanonicalRaceRuntime(gs,{gp=null,stepMs=null}={}){
  if(!isCanonicalRaceWeekend(gs))return gs;
  if(String(gs?.raceWeekendState?.phase||"")!=="race")return gs;
  if(gs?.raceWeekendState?.canonical_race_runtime?.state)return gs;
  return startCanonicalRaceRuntime(gs,{gp,stepMs});
}

export function advanceAttachedCanonicalRaceRuntime(gs,elapsedMs){
  const runtime=gs?.raceWeekendState?.canonical_race_runtime;
  if(!runtime)return gs;
  return attachCanonicalRaceRuntime(gs,advanceCanonicalRaceRuntime(runtime,elapsedMs));
}

export function queueCanonicalRaceWeekendCommand(gs,{gp=null,command=null,stepMs=null}={}){
  if(!isCanonicalRaceWeekend(gs))return gs;
  const ready=ensureCanonicalRaceRuntime(gs,{gp,stepMs});
  const runtime=ready?.raceWeekendState?.canonical_race_runtime;
  if(!runtime||!command)return ready;
  return attachCanonicalRaceRuntime(ready,queueCanonicalRaceRuntimeCommand(runtime,command));
}

export function cancelCanonicalRaceWeekendCommand(gs,{gp=null,criteria={},stepMs=null}={}){
  if(!isCanonicalRaceWeekend(gs))return gs;
  const ready=ensureCanonicalRaceRuntime(gs,{gp,stepMs});
  const runtime=ready?.raceWeekendState?.canonical_race_runtime;
  if(!runtime)return ready;
  return attachCanonicalRaceRuntime(ready,cancelCanonicalRaceRuntimeCommand(runtime,criteria));
}

export function applyCanonicalRaceWeekendRedFlagWork(gs,{gp=null,work=null,stepMs=null}={}){
  if(!isCanonicalRaceWeekend(gs))return gs;
  const ready=ensureCanonicalRaceRuntime(gs,{gp,stepMs});
  const runtime=ready?.raceWeekendState?.canonical_race_runtime;
  if(!runtime||!work)return ready;
  const teamId=String(
    work?.teamId
    ??ready?.team?.team_id
    ??ready?.team?.id
    ??""
  );
  return attachCanonicalRaceRuntime(
    ready,
    applyCanonicalRaceRuntimeRedFlagWork(runtime,{...work,teamId})
  );
}

export function canonicalRaceWeekendNeedsCheckpoint(previousGs,nextGs,options={}){
  if(!isCanonicalRaceWeekend(nextGs))return false;
  return canonicalRaceRuntimeNeedsCheckpoint(
    previousGs?.raceWeekendState?.canonical_race_runtime,
    nextGs?.raceWeekendState?.canonical_race_runtime,
    options
  );
}

// RW8.14D: gameplay-facing elapsed-time dispatch for RW2. This deliberately
// refuses to translate elapsed time into Legacy sectors/laps. The engine lock
// owns routing: RW2 ensures/resumes its canonical runtime and advances fixed
// steps; Legacy remains byte-for-byte untouched for its existing caller path.
export function advanceCanonicalRaceWeekendElapsed(gs,{gp=null,elapsedMs=0,stepMs=null}={}){
  if(!isCanonicalRaceWeekend(gs))return gs;
  const ready=ensureCanonicalRaceRuntime(gs,{gp,stepMs});
  const runtime=ready?.raceWeekendState?.canonical_race_runtime;
  if(!runtime)return ready;
  const elapsed=Math.max(0,finite(elapsedMs,0));
  if(elapsed===0)return ready;
  return advanceAttachedCanonicalRaceRuntime(ready,elapsed);
}

export function runCanonicalRaceWeekendBatch(gs,{gp=null,stepMs=null,steps=250}={}){
  if(!isCanonicalRaceWeekend(gs))return gs;
  const ready=ensureCanonicalRaceRuntime(gs,{gp,stepMs});
  const runtime=ready?.raceWeekendState?.canonical_race_runtime;
  if(!runtime)return ready;
  return attachCanonicalRaceRuntime(
    ready,
    runCanonicalRaceRuntimeBatch(runtime,{steps})
  );
}
export function canonicalRaceWeekendView(gs){
  if(!isCanonicalRaceWeekend(gs))return null;
  return canonicalRaceView(gs?.raceWeekendState?.canonical_race_runtime);
}
