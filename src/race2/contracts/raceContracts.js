// src/race2/contracts/raceContracts.js
// RW8.0A: stable, engine-agnostic contracts for the Race Weekend 2.0 boundary.

export const RACE_WEEKEND_CONTRACT_VERSION=10;

export const RACE_WEEKEND_ENGINES=Object.freeze({
  LEGACY:"legacy",
  RW2:"rw2",
});

export const RACE_SESSION_TYPES=Object.freeze({
  PRACTICE:"practice",
  QUALIFYING:"qualifying",
  RACE:"race",
});

export const RACE_COMMAND_TYPES=Object.freeze({
  PACE:"pace",
  ENGINE:"engine",
  OVERTAKE:"overtake",
  TEAM_ORDER:"team_order",
  PIT:"pit",
});

export const RACE_WEEKEND_CONTRACT_FIELDS=Object.freeze({
  RaceWeekendInput:Object.freeze([
    "schemaVersion","engineVersion","weekendKey","seed","year","round",
    "gp","entries","drivers","cars","rules","track","weather","startingGrid",
  ]),
  RaceState:Object.freeze([
    "schemaVersion","contractVersion","engineVersion","weekendKey","seed","tick",
    "simulationTimeMs","session","status","track","cars","classification","timingState",
    "trackState","weatherState","raceControlState","commandQueue","nextCommandSequence","pitLaneState","events","nextEventSequence",
    "rngState","result",
  ]),
  CarState:Object.freeze([
    "carId","driverId","teamId","gridPosition","gridStartOffsetM","lap","completedLaps","sector",
    "distanceAlongLapM","absoluteDistanceM","speedMs","speedKmh","accelerationMs2",
    "targetSpeedKmh","cornerSeverity","effectiveCornerSeverity","dynamicsLookaheadM",
    "performance","lateralOffsetM","zoneId","zoneType","elapsedMs","finishTimeMs","status","tyre","fuelKg",
    "engineTemperature","resources","components","damage","commands","pitState","traffic","battle","dnf",
  ]),
  RaceTyreState:Object.freeze([
    "tyre_id","supplier","compound","category","grip_index","wear_rate","warmup_time_s",
    "condition","temperature_c","optimal_temperature_c","age_distance_m","age_laps",
    "stint_number","wear_per_lap_pct","grip_multiplier","pace_penalty_s","risk_multiplier","band",
    "wet_efficiency","tyre_management",
  ]),
  RaceResourceState:Object.freeze([
    "paceMode","strategy","availableTyres","initialFuelKg","fuelBurnKgPerKm","fuelReserveKg",
    "fuelPlan","refuellingDeferred","fuelStintPlanned","plannedFuelStopLap","pitCrew",
    "tyreGripMultiplier","tyreTemperaturePenalty","fuelMassPenalty","fuelStarvationPenalty",
    "engineTemperaturePenalty","paceMultiplier","accelerationMultiplier",
  ]),
  RacePitState:Object.freeze([
    "status","active","completed","stopSequence","plannedStopLap","entryAbsoluteM",
    "boxAbsoluteM","exitAbsoluteM","phase","phaseIndex","phaseElapsedMs","phaseTotalMs",
    "lossElapsedMs","lossTotalMs","queueElapsedMs","serviceApplied","serviceAppliedThisStep",
    "service","history",
  ]),
  RacePitLaneState:Object.freeze([
    "cars","boxes",
  ]),
  RaceBattleState:Object.freeze([
    "phase","opponentCarId","role","side","attemptId","startedTick","startedAtMs",
    "expiresAtMs","contactRiskPct","result","cooldownUntilMs",
  ]),
  RaceEvent:Object.freeze([
    "id","sequence","type","tick","timeMs","carIds","driverIds","payload",
  ]),
  RaceTrafficState:Object.freeze([
    "aheadCarId","gapM","hardGapM","desiredGapM","followRangeM",
    "targetSpeedKmh","limited","hardLimited",
  ]),
  RaceClassificationRow:Object.freeze([
    "position","carId","driverId","teamId","status","lap","completedLaps","sector",
    "absoluteDistanceM","distanceAlongLapM","gapToLeaderM","intervalM",
    "gapToLeaderMs","intervalMs","lapsBehind","timingBasis","finishTimeMs",
  ]),
  RaceTimingState:Object.freeze([
    "source","projection","tick","referenceSpeedMs","leaderCarId","leaderDistanceM",
  ]),
  TrackModel:Object.freeze([
    "schemaVersion","trackId","layoutId","year","label","lengthM","laps",
    "raceDirection","resolution","geometry","racingLine","startFinish","sectors",
    "speedProfile","pitLane","traits",
  ]),
  TrackState:Object.freeze([
    "wetness","standingWater","grip","rubber","trackTemp","rainIntensity",
    "visibility","raceability",
  ]),
  Command:Object.freeze([
    "id","sequence","issuedAtTick","effectiveAtTick","source","driverId","teamId",
    "type","payload",
  ]),
  SessionState:Object.freeze([
    "type","format","phase","clock","lapLimit","timeLimit","activeCars",
    "weather","raceControl","simulation",
  ]),
  RaceWeekendResult:Object.freeze([
    "schemaVersion","engineVersion","weekendKey","seed","practice","qualifying",
    "startingGrid","race",
  ]),
});

export function normalizeRaceWeekendEngineVersion(value,{fallback=RACE_WEEKEND_ENGINES.LEGACY}={}){
  const normalized=String(value??"").trim().toLowerCase();
  if(normalized===RACE_WEEKEND_ENGINES.LEGACY)return RACE_WEEKEND_ENGINES.LEGACY;
  if(normalized===RACE_WEEKEND_ENGINES.RW2)return RACE_WEEKEND_ENGINES.RW2;
  return fallback;
}

export function isRaceWeekendEngineVersion(value){
  return Object.values(RACE_WEEKEND_ENGINES).includes(String(value??"").trim().toLowerCase());
}

export function cloneRaceContractValue(value){
  if(value===undefined)return undefined;
  if(typeof structuredClone==="function")return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
