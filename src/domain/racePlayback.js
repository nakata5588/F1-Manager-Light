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


export function raceMotionDurationMs(speed){
  const normalized=RACE_PLAYBACK_SPEEDS.includes(Number(speed))?Number(speed):1;
  const delay=racePlaybackDelayMs(normalized);
  return Math.max(300,delay+Math.round(80/Math.sqrt(normalized)));
}

export function unwrapTrackProgress(reference,target){
  const ref=Number(reference);
  let next=Number(target);
  if(!Number.isFinite(next))return Number.isFinite(ref)?ref:0;
  if(!Number.isFinite(ref))return next;
  while(next<ref-0.5)next+=1;
  while(next>ref+0.5)next-=1;
  if(next<ref&&ref-next>0.08)next+=1;
  return next;
}
