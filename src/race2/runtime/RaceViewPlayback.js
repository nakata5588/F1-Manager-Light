// src/race2/runtime/RaceViewPlayback.js
// RW8.14G/H: Race View-facing playback boundary. The UI supplies wall-clock
// elapsed time and a playback multiplier; canonical RW2 owns fixed-step
// accumulation and physics. No sectors/laps are synthesized here.

import {
  advanceRaceWeekendElapsed,
  raceWeekendCanonicalView,
  raceWeekendUsesCanonicalRuntime,
} from "../gateway/RaceWeekendRuntimeGateway.js";

const finite=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

export const RACE_VIEW_PLAYBACK_SPEEDS=Object.freeze([0.5,1,2,4,8]);

export function canonicalRaceViewPlaybackSpeed(value){
  const requested=finite(value,1);
  return RACE_VIEW_PLAYBACK_SPEEDS.reduce((best,candidate)=>
    Math.abs(candidate-requested)<Math.abs(best-requested)?candidate:best
  ,1);
}

export function canonicalRaceViewElapsedMs(elapsedMs,playbackSpeed=1){
  const elapsed=Math.max(0,finite(elapsedMs,0));
  return elapsed*canonicalRaceViewPlaybackSpeed(playbackSpeed);
}

// UI lifecycle helper: converts requestAnimationFrame/performance.now timestamps
// into an elapsed duration without leaking browser clock semantics into RaceRunner.
// A missing/invalid previous timestamp deliberately produces a zero-time priming
// frame, preventing resume/remount gaps from being simulated as race time.
export function raceViewFrameElapsedMs(previousTimestampMs,currentTimestampMs){
  if(previousTimestampMs==null||currentTimestampMs==null)return 0;
  const current=finite(currentTimestampMs,NaN);
  const previous=finite(previousTimestampMs,NaN);
  if(!Number.isFinite(current)||!Number.isFinite(previous))return 0;
  return Math.max(0,current-previous);
}

export function advanceCanonicalRaceViewTimestamp(gs,{
  gp=null,
  previousTimestampMs=null,
  currentTimestampMs=null,
  playbackSpeed=1,
  stepMs=null,
}={}){
  return advanceCanonicalRaceViewFrame(gs,{
    gp,
    elapsedMs:raceViewFrameElapsedMs(previousTimestampMs,currentTimestampMs),
    playbackSpeed,
    stepMs,
  });
}

export function advanceCanonicalRaceViewFrame(gs,{
  gp=null,
  elapsedMs=0,
  playbackSpeed=1,
  stepMs=null,
}={}){
  if(!raceWeekendUsesCanonicalRuntime(gs)){
    return {gameState:gs,view:null,advancedMs:0};
  }
  const advancedMs=canonicalRaceViewElapsedMs(elapsedMs,playbackSpeed);
  const gameState=advanceRaceWeekendElapsed(gs,{gp,elapsedMs:advancedMs,stepMs});
  return {
    gameState,
    view:raceWeekendCanonicalView(gameState),
    advancedMs,
  };
}
