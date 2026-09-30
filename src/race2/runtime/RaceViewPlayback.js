// src/race2/runtime/RaceViewPlayback.js
// RW8.14G: Race View-facing playback boundary. The UI supplies wall-clock
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
