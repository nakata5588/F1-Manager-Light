export const RACE_PLAYBACK_SPEEDS=[1,2,4,8];

export function racePlaybackDelayMs(speed){
  const normalized=RACE_PLAYBACK_SPEEDS.includes(Number(speed))?Number(speed):1;
  return Math.max(900,Math.round(9000/normalized));
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


export function raceEventRequiresPause(event,{playerTeamId="",playerDriverIds=[]}={}){
  if(!event)return false;
  if(String(event?.type||"")==="event_batch"){
    return (event?.events||[]).some((row)=>raceEventRequiresPause(row,{playerTeamId,playerDriverIds}));
  }
  const type=String(event?.type||"");
  const message=String(event?.message||"");
  const control=String(event?.control_type||"").toUpperCase();
  const playerDrivers=new Set((playerDriverIds||[]).map(String));
  if(type==="incident"||type==="weather_report")return true;
  if(type==="driver_feedback")return playerDrivers.has(String(event?.driver_id||""));
  if(type==="pit")return Boolean(event?.crew_error)||String(event?.team_id||"")===String(playerTeamId||"");
  if(type==="race_control"&&(event?.cause==="incident"||["RED_FLAG","SAFETY_CAR","VSC"].includes(control)))return true;
  return /dnf|retir|collision|crash|engine|gearbox|brake|puncture/i.test(message);
}

export function retiredCarVisibleOnTrack(row,{currentLap=0,currentSector=0,currentControl="GREEN"}={}){
  if(!row?.retired)return true;
  const control=String(currentControl||"GREEN").toUpperCase();
  if(["SAFETY_CAR","VSC","RED_FLAG"].includes(control))return true;
  const incidentLap=Number(row?.incident_lap);
  const incidentSector=Number(row?.incident_sector);
  if(!Number.isFinite(incidentLap)||!Number.isFinite(incidentSector))return true;
  const now=Math.max(0,(Math.max(1,Number(currentLap)||1)-1)*3+Math.max(1,Math.min(3,Number(currentSector)||1)));
  const incident=Math.max(0,(Math.max(1,incidentLap)-1)*3+Math.max(1,Math.min(3,incidentSector)));
  return now<incident+2;
}
