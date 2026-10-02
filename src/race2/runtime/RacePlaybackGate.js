// src/race2/runtime/RacePlaybackGate.js
// RW26: tiny UI/store coordination gate for asynchronous canonical Race View
// advances. Physics remains owned by RaceRunner; this only prevents stale
// browser-frame requests from committing after Pause or a playback-speed change.

export function normalizeRacePlaybackEpoch(value){
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?Math.floor(parsed):0;
}

export function nextRacePlaybackEpoch(value){
  return normalizeRacePlaybackEpoch(value)+1;
}

export function racePlaybackAdvanceAllowed(
  startedEpoch,
  currentEpoch,
  {autosimActive=false}={}
){
  return (
    !autosimActive&&
    normalizeRacePlaybackEpoch(startedEpoch)===normalizeRacePlaybackEpoch(currentEpoch)
  );
}
