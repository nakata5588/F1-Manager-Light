import { raceMotionDurationMs, unwrapTrackProgress } from "./racePlayback.js";

export const RACE_VISUAL_MOTION_MODES=Object.freeze({
  RACING:"RACING",
  PIT_ENTRY:"PIT_ENTRY",
  PIT_LANE:"PIT_LANE",
  PIT_STOPPED:"PIT_STOPPED",
  PIT_EXIT:"PIT_EXIT",
  VSC:"VSC",
  SAFETY_CAR:"SAFETY_CAR",
  RED_FLAG:"RED_FLAG",
  RETIRED:"RETIRED",
});

function finite(value,fallback=null){
  const number=Number(value);
  return Number.isFinite(number)?number:fallback;
}

function clamp(value,min,max){
  return Math.max(min,Math.min(max,value));
}

export function visualMotionMode(row,{currentControl="GREEN"}={}){
  if(row?.retired)return RACE_VISUAL_MOTION_MODES.RETIRED;
  const pitState=String(row?.pit_state||row?.pit_phase||"").toUpperCase();
  if(pitState.includes("ENTRY"))return RACE_VISUAL_MOTION_MODES.PIT_ENTRY;
  if(pitState.includes("STOP"))return RACE_VISUAL_MOTION_MODES.PIT_STOPPED;
  if(pitState.includes("EXIT"))return RACE_VISUAL_MOTION_MODES.PIT_EXIT;
  if(pitState.includes("PIT"))return RACE_VISUAL_MOTION_MODES.PIT_LANE;
  const control=String(currentControl||"GREEN").toUpperCase();
  if(control==="VSC")return RACE_VISUAL_MOTION_MODES.VSC;
  if(control.includes("SAFETY_CAR"))return RACE_VISUAL_MOTION_MODES.SAFETY_CAR;
  if(control==="RED_FLAG")return RACE_VISUAL_MOTION_MODES.RED_FLAG;
  return RACE_VISUAL_MOTION_MODES.RACING;
}

export function driverReferenceSectorMs(row,currentSector,{fallbackSectorMs=30000}={}){
  const sector=clamp(Number(currentSector)||1,1,3);
  const direct=finite(row?.[`sector_${sector}_ms`]);
  if(direct!=null&&direct>=8000&&direct<=90000)return direct;
  const lap=finite(row?.last_lap_ms??row?.recent_pace_ms??row?.best_lap_ms);
  if(lap!=null&&lap>=30000&&lap<=300000)return lap/3;
  return Math.max(8000,finite(fallbackSectorMs,30000));
}

export function driverVisualMotionDurationMs(row,{currentSector=1,playbackSpeed=1,globalSectorMs=30000,currentControl="GREEN"}={}){
  const mode=visualMotionMode(row,{currentControl});
  if(mode===RACE_VISUAL_MOTION_MODES.PIT_STOPPED||mode===RACE_VISUAL_MOTION_MODES.RED_FLAG)return raceMotionDurationMs(playbackSpeed,globalSectorMs);
  const individual=driverReferenceSectorMs(row,currentSector,{fallbackSectorMs:globalSectorMs});
  return raceMotionDurationMs(playbackSpeed,individual);
}

export function visualMotionProgress(t,{individualDurationMs=null,globalDurationMs=null}={}){
  const progress=clamp(finite(t,0),0,1);
  const individual=finite(individualDurationMs);
  const global=finite(globalDurationMs);
  if(individual==null||global==null||individual<=0||global<=0)return progress;
  // Relative pace should be visible without making cars surge and then
  // visibly brake inside every sector. Authoritative gap changes still define
  // the end point; this only adds a small, smooth pace character in between.
  const paceRatio=clamp(individual/global,0.82,1.18);
  const bias=clamp((1-paceRatio)*0.35,-0.065,0.065);
  return clamp(progress+(bias*4*progress*(1-progress)),0,1);
}

export function interpolateVisualGap(fromGapMs,toGapMs,t){
  const from=finite(fromGapMs);
  const to=finite(toGapMs);
  if(from==null)return to;
  if(to==null)return from;
  const progress=clamp(finite(t,0),0,1);
  return from+(to-from)*progress;
}

export function buildRaceVisualModel(rows,{currentSector=1,playbackSpeed=1,globalSectorMs=30000,currentControl="GREEN"}={}){
  return (Array.isArray(rows)?rows:[]).map((row,index)=>({
    driver_id:String(row?.driver_id??row?.id??""),
    authoritative_position:finite(row?.position,index+1),
    authoritative_gap_ms:finite(row?.gap_to_leader_ms),
    authoritative_interval_ms:finite(row?.interval_ms??row?.gap_to_previous_ms),
    sector_duration_ms:driverReferenceSectorMs(row,currentSector,{fallbackSectorMs:globalSectorMs}),
    motion_duration_ms:driverVisualMotionDurationMs(row,{currentSector,playbackSpeed,globalSectorMs,currentControl}),
    motion_mode:visualMotionMode(row,{currentControl}),
    retired:Boolean(row?.retired),
    pit_state:row?.pit_state??row?.pit_phase??null,
  }));
}


function wrapTrackProgress(value){
  const number=finite(value,0);
  return ((number%1)+1)%1;
}

export function authoritativeRaceWorldProgress(row,{currentLap=0,currentSector=0,referenceLapMs=90000,index=0}={}){
  const lap=Math.max(0,Number(currentLap)||0);
  const sector=Math.max(0,Math.min(3,Number(currentSector)||0));
  if(lap<=0||sector<=0){
    const grid=Math.max(1,Number(row?.grid_position??index+1)||index+1);
    return 0.995-(grid-1)*0.003;
  }

  const rowLap=row?.retired&&Number.isFinite(Number(row?.incident_lap))
    ?Math.max(1,Number(row.incident_lap))
    :Math.max(1,lap);
  const rowSector=row?.retired&&Number.isFinite(Number(row?.incident_sector))
    ?Math.max(1,Math.min(3,Number(row.incident_sector)))
    :Math.max(1,sector);
  const reference=Math.max(45000,finite(referenceLapMs,90000));
  const gap=Math.max(0,finite(row?.gap_to_leader_ms,0));
  return (rowLap-1)+(rowSector/3)-(gap/reference);
}

export function raceVisualSnapshotKey(rows,{currentLap=0,currentSector=0}={}){
  const ordered=(Array.isArray(rows)?rows:[]).slice().sort((a,b)=>
    finite(a?.position,999)-finite(b?.position,999)
    ||String(a?.driver_id??a?.id??"").localeCompare(String(b?.driver_id??b?.id??""))
  );
  return [
    Math.max(0,Number(currentLap)||0),
    Math.max(0,Math.min(3,Number(currentSector)||0)),
    ...ordered.map((row)=>[
      String(row?.driver_id??row?.id??""),
      finite(row?.position,""),
      finite(row?.gap_to_leader_ms,""),
      finite(row?.interval_ms??row?.gap_to_previous_ms,""),
      row?.retired?1:0,
    ].join(":")),
  ].join("|");
}

export function buildRaceVisualSnapshot(rows,{
  currentLap=0,
  currentSector=0,
  referenceLapMs=90000,
  playbackSpeed=1,
  globalSectorMs=30000,
  currentControl="GREEN",
}={}){
  const ordered=(Array.isArray(rows)?rows:[]).slice().sort((a,b)=>
    finite(a?.position,999)-finite(b?.position,999)
    ||String(a?.driver_id??a?.id??"").localeCompare(String(b?.driver_id??b?.id??""))
  );
  const visualModel=buildRaceVisualModel(ordered,{
    currentSector:Math.max(1,Number(currentSector)||1),
    playbackSpeed,
    globalSectorMs,
    currentControl,
  });
  const modelByDriver=new Map(visualModel.map((row)=>[String(row.driver_id),row]));

  return ordered.map((row,index)=>{
    const driverId=String(row?.driver_id??row?.id??"");
    const worldProgress=authoritativeRaceWorldProgress(row,{currentLap,currentSector,referenceLapMs,index});
    const model=modelByDriver.get(driverId)||{};
    return {
      ...row,
      driver_id:driverId,
      authoritative_position:finite(row?.position,index+1),
      authoritative_gap_ms:finite(row?.gap_to_leader_ms),
      authoritative_interval_ms:finite(row?.interval_ms??row?.gap_to_previous_ms),
      visual_world_progress:worldProgress,
      visual_track_progress:wrapTrackProgress(worldProgress),
      motion_duration_ms:finite(model?.motion_duration_ms,raceMotionDurationMs(playbackSpeed,globalSectorMs)),
      motion_mode:model?.motion_mode??RACE_VISUAL_MOTION_MODES.RACING,
    };
  });
}

export function createVisualRaceTimeline(previousRows,targetRows,{
  previousLap=0,
  previousSector=0,
  currentLap=0,
  currentSector=0,
  referenceLapMs=90000,
  playbackSpeed=1,
  globalSectorMs=30000,
  currentControl="GREEN",
}={}){
  const targetSnapshot=buildRaceVisualSnapshot(targetRows,{
    currentLap,
    currentSector,
    referenceLapMs,
    playbackSpeed,
    globalSectorMs,
    currentControl,
  });
  const sourceRows=Array.isArray(previousRows)&&previousRows.length?previousRows:targetRows;
  const previousSnapshot=buildRaceVisualSnapshot(sourceRows,{
    currentLap:previousLap,
    currentSector:previousSector,
    referenceLapMs,
    playbackSpeed,
    globalSectorMs,
    currentControl,
  });
  const previousByDriver=new Map(previousSnapshot.map((row)=>[String(row.driver_id),row]));
  const globalMotionMs=raceMotionDurationMs(playbackSpeed,globalSectorMs);

  const drivers=targetSnapshot.map((target,index)=>{
    const previous=previousByDriver.get(String(target.driver_id))||target;
    let targetWorld=Number(target.visual_world_progress);
    const previousWorld=Number(previous.visual_world_progress);
    if(Number.isFinite(previousWorld)&&Number.isFinite(targetWorld)){
      const previousTrack=wrapTrackProgress(previousWorld);
      const targetTrack=wrapTrackProgress(targetWorld);
      const unwrappedTrack=unwrapTrackProgress(previousTrack,targetTrack);
      const previousLapBase=Math.floor(previousWorld);
      let candidate=previousLapBase+unwrappedTrack;
      while(candidate<previousWorld-0.08)candidate+=1;
      while(candidate>previousWorld+1.08)candidate-=1;
      // Keep the physical path continuous across start/finish. The wrapped
      // target is presentation-only; authoritative gaps/positions remain on
      // the target row and are restored exactly at t=1.
      targetWorld=candidate;
    }
    return {
      driver_id:String(target.driver_id),
      index,
      previous,
      target,
      from_world_progress:Number.isFinite(previousWorld)?previousWorld:Number(targetWorld)||0,
      to_world_progress:Number.isFinite(targetWorld)?targetWorld:Number(previousWorld)||0,
      motion_duration_ms:finite(target.motion_duration_ms,globalMotionMs),
    };
  });

  return {
    previous_rows:previousSnapshot,
    target_rows:targetSnapshot,
    drivers,
    reference_lap_ms:Math.max(45000,finite(referenceLapMs,90000)),
    global_motion_ms:Math.max(1,finite(globalMotionMs,1)),
  };
}

export function advanceVisualTimelineProgress(progress,{deltaMs=0,durationMs=1,running=true}={}){
  const current=clamp(finite(progress,0),0,1);
  if(!running)return current;
  const duration=Math.max(1,finite(durationMs,1));
  return clamp(current+(Math.max(0,finite(deltaMs,0))/duration),0,1);
}

export function visualRaceTimelineFrame(timeline,t=1){
  const progress=clamp(finite(t,1),0,1);
  const drivers=Array.isArray(timeline?.drivers)?timeline.drivers:[];
  if(!drivers.length)return {progress,rows:[]};

  if(progress<=0){
    const rows=drivers.map((entry)=>({
      ...entry.previous,
      visual_world_progress:entry.from_world_progress,
      visual_track_progress:wrapTrackProgress(entry.from_world_progress),
      visual_t:0,
    })).sort((a,b)=>finite(a?.position,999)-finite(b?.position,999));
    return {progress:0,rows};
  }

  if(progress>=1){
    const rows=drivers.map((entry)=>({
      ...entry.target,
      visual_world_progress:entry.to_world_progress,
      visual_track_progress:wrapTrackProgress(entry.to_world_progress),
      visual_t:1,
    })).sort((a,b)=>finite(a?.position,999)-finite(b?.position,999));
    return {progress:1,rows};
  }

  const moving=drivers.map((entry)=>{
    const driverT=visualMotionProgress(progress,{
      individualDurationMs:entry.motion_duration_ms,
      globalDurationMs:timeline?.global_motion_ms,
    });
    const world=entry.from_world_progress+(entry.to_world_progress-entry.from_world_progress)*driverT;
    return {
      ...entry.target,
      visual_world_progress:world,
      visual_track_progress:wrapTrackProgress(world),
      visual_t:progress,
      visual_driver_t:driverT,
      previous_authoritative_position:finite(entry.previous?.position),
      target_authoritative_position:finite(entry.target?.position),
    };
  }).sort((a,b)=>
    Number(b.visual_world_progress)-Number(a.visual_world_progress)
    ||finite(a?.target_authoritative_position,999)-finite(b?.target_authoritative_position,999)
    ||String(a?.driver_id||"").localeCompare(String(b?.driver_id||""))
  );

  const leaderWorld=Number(moving[0]?.visual_world_progress)||0;
  const referenceLapMs=Math.max(45000,finite(timeline?.reference_lap_ms,90000));
  let previousGap=0;
  const rows=moving.map((row,index)=>{
    const gap=index===0?0:Math.max(0,(leaderWorld-Number(row.visual_world_progress))*referenceLapMs);
    const interval=index===0?0:Math.max(0,gap-previousGap);
    previousGap=gap;
    return {
      ...row,
      position:index+1,
      gap_to_leader_ms:gap,
      interval_ms:interval,
      gap_to_previous_ms:interval,
    };
  });
  return {progress,rows};
}
