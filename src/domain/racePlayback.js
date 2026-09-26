export const RACE_PLAYBACK_SPEEDS=[1,2,4,8];

export function racePlaybackDelayMs(speed,baseSectorMs=30000){
  const normalized=RACE_PLAYBACK_SPEEDS.includes(Number(speed))?Number(speed):1;
  const base=Number.isFinite(Number(baseSectorMs))&&Number(baseSectorMs)>0?Number(baseSectorMs):30000;
  return Math.max(700,Math.round(base/normalized));
}

export function racePlaybackCanRun(liveRace){
  return Boolean(
    liveRace
    &&String(liveRace.status||"running")==="running"
    &&Number(liveRace.current_lap||0)<=Number(liveRace.total_laps||Infinity)
  );
}


export function raceMotionDurationMs(speed,baseSectorMs=30000){
  const normalized=RACE_PLAYBACK_SPEEDS.includes(Number(speed))?Number(speed):1;
  const delay=racePlaybackDelayMs(normalized,baseSectorMs);
  return Math.max(300,delay+Math.round(80/Math.sqrt(normalized)));
}

export function raceMarkerScaleForCamera(cameraMode="fit",zoom=1){
  if(String(cameraMode)!=="follow")return 1;
  const normalized=Math.max(1,Math.min(12,Number(zoom)||1));
  // Follow zoom shrinks the SVG viewBox, which would otherwise make driver
  // markers grow by the same factor on screen. Counter-scale the marker so
  // its apparent size remains nearly constant while the track itself zooms.
  return Math.max(0.12,Math.min(0.5,1.15/normalized));
}

export function raceMarkerLaneOffset(index,{cameraMode="fit",zoom=1,closeBattle=false,selected=false}={}){
  if(String(cameraMode)!=="follow"||!closeBattle||selected)return 0;
  const normalized=Math.max(1,Math.min(12,Number(zoom)||1));
  const slots=[-1,-0.5,0,0.5,1];
  const slot=slots[Math.abs(Number(index)||0)%slots.length]||0;
  // Keep the visual spread screen-space stable as the camera zoom changes.
  return (slot*10)/normalized;
}

export function raceReferenceSectorMs(rows,currentSector,{fallbackLapMs=90000}={}){
  const sector=Math.max(1,Math.min(3,Number(currentSector)||1));
  const field=`sector_${sector}_ms`;
  const values=(Array.isArray(rows)?rows:[])
    .filter((row)=>!row?.retired)
    .map((row)=>Number(row?.[field]))
    .filter((value)=>Number.isFinite(value)&&value>=8000&&value<=90000)
    .sort((a,b)=>a-b);
  if(values.length){
    const middle=Math.floor(values.length/2);
    return values.length%2?values[middle]:Math.round((values[middle-1]+values[middle])/2);
  }
  const lapValues=(Array.isArray(rows)?rows:[])
    .filter((row)=>!row?.retired)
    .map((row)=>Number(row?.last_lap_ms||row?.recent_pace_ms||row?.best_lap_ms))
    .filter((value)=>Number.isFinite(value)&&value>=30000&&value<=300000)
    .sort((a,b)=>a-b);
  const referenceLap=lapValues.length
    ?lapValues[Math.floor(lapValues.length/2)]
    :Math.max(30000,Number(fallbackLapMs)||90000);
  return Math.round(referenceLap/3);
}

export function raceAverageSpeedKmh(lapLengthKm,lapMs){
  const km=Number(lapLengthKm);
  const ms=Number(lapMs);
  if(!Number.isFinite(km)||km<=0||!Number.isFinite(ms)||ms<=0)return null;
  return km/(ms/3600000);
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
  if(type==="pit_service")return playerDrivers.has(String(event?.driver_id||""));
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
