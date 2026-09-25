export const RACE_PLAYBACK_SPEEDS=[1,2,4,8];

export function racePlaybackDelayMs(speed){
  const normalized=RACE_PLAYBACK_SPEEDS.includes(Number(speed))?Number(speed):1;
  return Math.max(260,Math.round(2200/normalized));
}

export function racePlaybackCanRun(liveRace){
  return Boolean(
    liveRace
    &&String(liveRace.status||"running")==="running"
    &&Number(liveRace.current_lap||0)<=Number(liveRace.total_laps||Infinity)
  );
}
