export function liveRaceIsInProgress(liveRace) {
  if (!liveRace || typeof liveRace !== "object") return false;
  const status = String(liveRace.status || "running").toLowerCase();
  return !["finished", "completed"].includes(status);
}

export function normalizeRaceWeekendResumeState(weekend) {
  if (!weekend || typeof weekend !== "object") return weekend ?? null;
  if (!liveRaceIsInProgress(weekend.live_race)) return weekend;
  if (String(weekend.phase || "") === "race") return weekend;
  return {
    ...weekend,
    phase: "race",
  };
}

export function raceWindowForWeekend(weekend) {
  const phase = String(weekend?.phase || "");
  const liveRace = weekend?.live_race || null;

  // A running Live Race is authoritative after save/load or browser refresh.
  // Stale Practice/Qualifying session metadata must never pull the player
  // backwards once the race has started.
  if (liveRaceIsInProgress(liveRace)) return "live";

  if (phase === "practice" || phase === "practice_complete") return "practice";
  if (phase === "qualifying" || phase === "qualifying_wait") return "qualifying";
  if (phase === "grid_ready") return "strategy";
  if (phase === "race") return liveRace ? "live" : "grid";
  if (phase === "results" || phase === "completed") return "classification";
  return "overview";
}
