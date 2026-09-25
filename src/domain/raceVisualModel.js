import { raceMotionDurationMs } from "./racePlayback.js";

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
  const paceRatio=clamp(individual/global,0.55,1.65);
  const bias=clamp((1-paceRatio)*0.9,-0.22,0.22);
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
