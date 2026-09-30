// src/race2/gateway/RaceWeekendRuntimeGateway.js
// RW8.14E — gameplay-facing dispatch boundary for canonical race elapsed time.
//
// Keep the routing decision outside React/Zustand and outside the race physics:
// callers provide elapsed wall-clock time; only an explicitly RW2-locked race
// may enter RaceRuntime. Legacy weekends deliberately receive the original
// game-state reference so their sector/lap path remains untouched.

import {
  RACE_WEEKEND_ENGINES,
  normalizeRaceWeekendEngineVersion,
} from "../contracts/raceContracts.js";
import {
  advanceCanonicalRaceWeekendElapsed,
  canonicalRaceWeekendView,
} from "../runtime/RaceRuntime.js";

export const CANONICAL_RACE_ENGINE_VERSION=RACE_WEEKEND_ENGINES.RW2;

export function raceWeekendUsesCanonicalRuntime(gs){
  const weekend=gs?.raceWeekendState;
  return Boolean(
    weekend&&
    normalizeRaceWeekendEngineVersion(weekend.engine_version,{fallback:RACE_WEEKEND_ENGINES.LEGACY})===CANONICAL_RACE_ENGINE_VERSION&&
    String(weekend.phase||"").trim().toLowerCase()==="race"
  );
}

export function advanceRaceWeekendElapsed(gs,{gp=null,elapsedMs=0,stepMs=null}={}){
  if(!raceWeekendUsesCanonicalRuntime(gs))return gs;
  return advanceCanonicalRaceWeekendElapsed(gs,{gp,elapsedMs,stepMs});
}

export function raceWeekendCanonicalView(gs){
  if(!raceWeekendUsesCanonicalRuntime(gs))return null;
  return canonicalRaceWeekendView(gs);
}
