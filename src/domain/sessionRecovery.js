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

export function sessionRecoveryMatchesState(state,recovery){
  if(!state||!recovery||typeof recovery!=="object")return false;
  const stateSeed=careerSeed(state);
  const recoverySeed=String(recovery?.save_seed??"");
  if(stateSeed&&recoverySeed)return stateSeed===recoverySeed;

  const stateYear=Number(state?.activeYear??state?.seasonYear);
  const recoveryYear=Number(recovery?.activeYear);
  const stateTeam=teamIdentity(state);
  const recoveryTeam=teamIdentity(recovery);
  return Boolean(
    stateTeam&&recoveryTeam&&stateTeam===recoveryTeam&&
    Number.isFinite(stateYear)&&Number.isFinite(recoveryYear)&&stateYear===recoveryYear
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
