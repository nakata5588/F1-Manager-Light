import { normalizeRaceWeekendResumeState } from "./raceWeekendResume.js";

function scalar(value){
  if(value&&typeof value==="object"&&Object.hasOwn(value,"result"))return value.result;
  return value;
}

function teamIdentity(state){
  return String(scalar(state?.team?.team_id??state?.team?.id??state?.team?.team_name??state?.team?.name)??"");
}

function careerSeed(state){
  return String(state?.saveMeta?.seed??"");
}

export function compactRaceWeekendForRecovery(weekend){
  const normalized=normalizeRaceWeekendResumeState(weekend??null);
  const live=normalized?.live_race;
  const status=String(live?.status||"").toLowerCase();
  if(!live||!["running","red_flag"].includes(status))return normalized;
  // The deterministic engine rebuilds future projections on the next sector.
  // Keeping those large derived arrays in the tab refresh journal can exhaust
  // Web Storage and leave recovery stuck on an older race checkpoint.
  const {
    projected_race: _projectedRace,
    projected_summary: _projectedSummary,
    ...compactLive
  }=live;
  return {
    ...normalized,
    live_race:compactLive,
  };
}

export function buildSessionRecoverySnapshot(state){
  if(!state||typeof state!=="object")return null;
  return {
    version:1,
    save_seed:careerSeed(state),
    activeYear:state?.activeYear??state?.seasonYear??null,
    currentDateISO:state?.currentDateISO??null,
    currentRound:state?.currentRound??null,
    team:state?.team??null,
    raceEntryState:state?.raceEntryState??null,
    raceWeekendState:compactRaceWeekendForRecovery(state?.raceWeekendState??null),
  };
}

// The tab journal can outlive the event that produced it. A shared career seed
// identifies ownership, not freshness: stale checkpoints must not rewind a
// more recent Continue snapshot or reopen an already archived race.
function ordinal(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateKey(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function canonicalTick(weekend) {
  return ordinal(
    weekend?.canonical_race_runtime?.state?.tick ??
    weekend?.canonical_race_runtime?.tick
  );
}

export function sessionRecoveryIsStale(state, recovery) {
  if (!state || !recovery) return true;
  const savedYear = ordinal(state.activeYear ?? state.seasonYear);
  const journalYear = ordinal(recovery.activeYear);
  if (savedYear !== null && journalYear !== null) {
    if (journalYear < savedYear) return true;
    if (journalYear > savedYear) return false;
  }
  const savedRound = ordinal(state.currentRound);
  const journalRound = ordinal(recovery.currentRound);
  if (savedRound !== null && journalRound !== null) {
    if (journalRound < savedRound) return true;
    if (journalRound > savedRound) return false;
  }
  const savedDate = dateKey(state.currentDateISO);
  const journalDate = dateKey(recovery.currentDateISO);
  if (savedDate && journalDate) {
    if (journalDate < savedDate) return true;
    if (journalDate > savedDate) return false;
  }

  const savedRace = state.raceWeekendState;
  const journalRace = recovery.raceWeekendState;
  const savedGp = String(savedRace?.gp_id ?? "").trim();
  const journalGp = String(journalRace?.gp_id ?? "").trim();
  if (savedGp && journalGp && savedGp !== journalGp) return true;

  const savedPhase = String(savedRace?.phase ?? "").toLowerCase();
  const journalPhase = String(journalRace?.phase ?? "").toLowerCase();
  if (["results", "completed"].includes(savedPhase) &&
      !["results", "completed"].includes(journalPhase)) return true;

  const savedStatus = String(savedRace?.canonical_race_runtime?.state?.status ?? "").toLowerCase();
  const journalStatus = String(journalRace?.canonical_race_runtime?.state?.status ?? "").toLowerCase();
  if (["finished", "completed"].includes(savedStatus) &&
      journalStatus && !["finished", "completed"].includes(journalStatus)) return true;

  const savedTick = canonicalTick(savedRace);
  const journalTick = canonicalTick(journalRace);
  if (savedTick !== null && journalTick !== null && journalTick < savedTick) return true;
  return false;
}

// Explicit Load Game / import invalidates the previous tab's journal. Continue
// startup still replays a newer *matching* checkpoint.
export function clearSessionRecoverySnapshot(storage, key = "f1ml_session_recovery") {
  try {
    if (!storage || typeof storage.removeItem !== "function") return false;
    storage.removeItem(key);
    return typeof storage.getItem !== "function" || storage.getItem(key) === null;
  } catch {
    return false;
  }
}

export function sessionRecoveryMatchesState(state,recovery){
  if(!state||!recovery||typeof recovery!=="object")return false;
  const stateSeed=careerSeed(state);
  const recoverySeed=String(recovery?.save_seed??"");
  if(stateSeed&&recoverySeed)return stateSeed===recoverySeed && !sessionRecoveryIsStale(state,recovery);

  const stateYear=Number(state?.activeYear??state?.seasonYear);
  const recoveryYear=Number(recovery?.activeYear);
  const stateTeam=teamIdentity(state);
  const recoveryTeam=teamIdentity(recovery);
  return Boolean(
    stateTeam&&recoveryTeam&&stateTeam===recoveryTeam&&
    Number.isFinite(stateYear)&&Number.isFinite(recoveryYear)&&stateYear===recoveryYear&&
    !sessionRecoveryIsStale(state,recovery)
  );
}

export function applySessionRecoverySnapshot(state,recovery){
  if(!sessionRecoveryMatchesState(state,recovery))return state;
  return {
    ...state,
    activeYear:recovery?.activeYear??state?.activeYear,
    currentDateISO:recovery?.currentDateISO??state?.currentDateISO,
    currentRound:recovery?.currentRound??state?.currentRound,
    team:recovery?.team??state?.team,
    raceEntryState:Object.hasOwn(recovery,"raceEntryState")?recovery.raceEntryState:state?.raceEntryState,
    raceWeekendState:Object.hasOwn(recovery,"raceWeekendState")
      ?normalizeRaceWeekendResumeState(recovery.raceWeekendState)
      :normalizeRaceWeekendResumeState(state?.raceWeekendState),
  };
}
