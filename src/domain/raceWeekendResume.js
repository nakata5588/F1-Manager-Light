import {
  RACE_WEEKEND_ENGINES,
  normalizeRaceWeekendEngineVersion,
} from "../race2/contracts/raceContracts.js";

export const CANONICAL_WEEKEND_MIGRATION_SOURCE="rw9e1_legacy_save_migration";

export function liveRaceIsInProgress(liveRace) {
  if (!liveRace || typeof liveRace !== "object") return false;
  const status = String(liveRace.status || "running").toLowerCase();
  return !["finished", "completed"].includes(status);
}

function canonicalRaceState(weekend){
  if(!weekend||typeof weekend!=="object")return null;
  const engine=normalizeRaceWeekendEngineVersion(weekend.engine_version,{
    fallback:RACE_WEEKEND_ENGINES.LEGACY,
  });
  if(engine!==RACE_WEEKEND_ENGINES.RW2)return null;
  return weekend?.canonical_race_runtime?.state||null;
}

export function raceWeekendCanFinalizeLiveRace(weekend) {
  if (!weekend || String(weekend.phase || "") !== "race") return false;
  const canonical=canonicalRaceState(weekend);
  if(canonical)return String(canonical.status||"").toLowerCase()==="finished";

  const liveRace = weekend.live_race;
  if (!liveRace || String(liveRace.status || "").toLowerCase() !== "finished") return false;
  const totalLaps = Math.max(1, Number(liveRace.total_laps) || 1);
  return (
    Number(liveRace.current_lap) >= totalLaps &&
    Number(liveRace.current_sector ?? 3) >= 3
  );
}

export function migrateLegacyRaceWeekendState(weekend) {
  if (!weekend || typeof weekend !== "object") return weekend ?? null;
  const engine=normalizeRaceWeekendEngineVersion(weekend.engine_version,{
    fallback:RACE_WEEKEND_ENGINES.LEGACY,
  });
  if(engine===RACE_WEEKEND_ENGINES.RW2)return weekend;

  const phase=String(weekend.phase||"");
  const legacyRace=weekend.live_race&&typeof weekend.live_race==="object"
    ?weekend.live_race
    :null;
  const restartRace=Boolean(phase==="race"||liveRaceIsInProgress(legacyRace));
  const legacyProgress=legacyRace?{
    status:String(legacyRace.status||"running"),
    current_lap:Number(legacyRace.current_lap)||0,
    current_sector:Number(legacyRace.current_sector)||0,
  }:null;

  return {
    ...weekend,
    engine_version:RACE_WEEKEND_ENGINES.RW2,
    ...(restartRace?{phase:"race",active_session_id:"race"}:{}),
    live_race:null,
    canonical_race_runtime:null,
    engine_migration:{
      source:CANONICAL_WEEKEND_MIGRATION_SOURCE,
      from:RACE_WEEKEND_ENGINES.LEGACY,
      to:RACE_WEEKEND_ENGINES.RW2,
      race_restarted_from_grid:restartRace,
      legacy_progress:legacyProgress,
    },
  };
}

export function normalizeRaceWeekendResumeState(weekend) {
  if (!weekend || typeof weekend !== "object") return weekend ?? null;
  const migrated=migrateLegacyRaceWeekendState(weekend);
  const canonical=canonicalRaceState(migrated);
  const canonicalActive=Boolean(
    canonical&&
    !["finished","completed"].includes(String(canonical.status||"").toLowerCase())
  );
  if (!canonicalActive) return migrated;
  if (
    String(migrated.phase || "") === "race" &&
    String(migrated.active_session_id || "") === "race"
  ) return migrated;
  return {
    ...migrated,
    phase: "race",
    active_session_id: "race",
  };
}

export function raceWindowForWeekend(weekend) {
  const phase = String(weekend?.phase || "");
  const liveRace = weekend?.live_race || null;
  const canonical=canonicalRaceState(weekend);

  // A running canonical or Legacy race is authoritative after save/load or
  // browser refresh. Stale Practice/Qualifying metadata must never pull the
  // player backwards once the race has started.
  if(canonical&&phase==="race")return "live";
  if (liveRaceIsInProgress(liveRace)) return "live";

  if (phase === "practice" || phase === "practice_complete") return "practice";
  if (phase === "qualifying" || phase === "qualifying_wait") return "qualifying";
  if (phase === "grid_ready") return "strategy";
  if (phase === "race") return liveRace ? "live" : "grid";
  if (phase === "results" || phase === "completed") return "classification";
  return "overview";
}
