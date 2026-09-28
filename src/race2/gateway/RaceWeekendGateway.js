// src/race2/gateway/RaceWeekendGateway.js
import {
  RACE_WEEKEND_ENGINES,
  normalizeRaceWeekendEngineVersion,
} from "../contracts/raceContracts.js";

/**
 * Lock the engine for a weekend.
 *
 * Existing weekends always keep their engine. Old saves that pre-date RW8.0A
 * deliberately resolve to Legacy, so loading a race can never silently switch
 * simulation engines.
 */
export function lockRaceWeekendEngineVersion(existingWeekend=null,{requestedEngineVersion=null}={}){
  if(existingWeekend&&typeof existingWeekend==="object"){
    return normalizeRaceWeekendEngineVersion(existingWeekend.engine_version,{
      fallback:RACE_WEEKEND_ENGINES.LEGACY,
    });
  }
  return normalizeRaceWeekendEngineVersion(requestedEngineVersion,{
    fallback:RACE_WEEKEND_ENGINES.LEGACY,
  });
}

export function raceWeekendEngineVersion(weekend){
  return lockRaceWeekendEngineVersion(weekend);
}

export function stampRaceWeekendEngineVersion(weekend,{requestedEngineVersion=null}={}){
  if(!weekend||typeof weekend!=="object")return weekend;
  const engineVersion=lockRaceWeekendEngineVersion(
    Object.hasOwn(weekend,"engine_version")?weekend:null,
    {requestedEngineVersion}
  );
  return {...weekend,engine_version:engineVersion};
}

/**
 * Thin execution boundary used while Legacy and RW2 coexist.
 *
 * RW8.0A does not wire RW2 into gameplay yet. If no RW2 handler is supplied,
 * the gateway returns an explicit not_implemented result instead of falling
 * through to Legacy.
 */
export async function runRaceWeekendGateway({
  weekend=null,
  requestedEngineVersion=null,
  legacy=null,
  rw2=null,
  context=null,
}={}){
  const engineVersion=lockRaceWeekendEngineVersion(weekend,{requestedEngineVersion});
  const handler=engineVersion===RACE_WEEKEND_ENGINES.RW2?rw2:legacy;

  if(typeof handler!=="function"){
    return {
      ok:false,
      status:"not_implemented",
      engine_version:engineVersion,
    };
  }

  return handler({
    ...(context&&typeof context==="object"?context:{}),
    engineVersion,
  });
}
