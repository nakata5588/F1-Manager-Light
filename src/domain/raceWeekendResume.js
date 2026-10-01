import {
  RACE_WEEKEND_ENGINES,
  normalizeRaceWeekendEngineVersion,
} from "../race2/contracts/raceContracts.js";

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

export function normalizeRaceWeekendResumeState(weekend) {
  if (!weekend || typeof weekend !== "object") return weekend ?? null;
  const canonical=canonicalRaceState(weekend);
  const canonicalActive=Boolean(
    canonical&&
    !["finished","completed"].includes(String(canonical.status||"").toLowerCase())
  );
  if (!canonicalActive && !liveRaceIsInProgress(weekend.live_race)) return weekend;
  if (
    String(weekend.phase || "") === "race" &&
    String(weekend.active_session_id || "") === "race"
  ) return weekend;
  return {
    ...weekend,
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
