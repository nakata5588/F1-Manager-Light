// src/domain/racePitModel.js
// Shared pit-stop timing model used by Legacy live playback and RW2.
//
// This file owns generic pit phase timing only. Strategy decides when to stop;
// service/damage modules decide what work is performed; track/renderers decide
// how pit geometry is displayed.

const finite=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

export const RACE_PIT_PHASES=Object.freeze([
  "pit_entry",
  "pit_lane",
  "pit_queue",
  "pit_box",
  "pit_release",
  "pit_exit",
  "rejoin",
]);

export function pitLaneLossSeconds(trackLike={},fallback=24){
  const raw=
    trackLike?.traits?.pitLaneLossS
    ??trackLike?.pit_lane_loss_s
    ??trackLike?.pitLaneLossS;
  return Math.max(8,finite(raw,fallback));
}

export function pitLaneLossMultiplierForRaceControl(controlType){
  const type=String(controlType||"GREEN").toUpperCase();
  if(type==="SAFETY_CAR")return 0.58;
  if(type==="VSC")return 0.76;
  if(type==="RED_FLAG")return 0.35;
  return 1;
}

export function pitRefuelServiceSecondsForYear(yearInput){
  const year=finite(yearInput,1980);
  return year<=1983?9:6;
}

export function pitPhaseDurationsMs(stop={}){
  const baseLaneMs=Math.max(0,Math.round(finite(stop?.pit_lane_loss_s,0)*1000));
  const trafficMs=Math.max(0,Math.round(finite(stop?.pit_lane_traffic_loss_s,0)*1000));
  const queueMs=Math.max(0,Math.round(finite(stop?.queue_delay_s,0)*1000));
  const stationaryMs=Math.max(0,Math.round(finite(stop?.stationary_s,0)*1000));
  const releaseMs=Math.max(0,Math.round(finite(stop?.release_delay_s,0)*1000));

  const entry=Math.round(baseLaneMs*0.15);
  const lane=Math.round(baseLaneMs*0.38)+trafficMs;
  const exit=Math.round(baseLaneMs*0.32);
  const rejoin=Math.max(0,baseLaneMs-entry-(lane-trafficMs)-exit);

  return [
    {phase:"pit_entry",duration_ms:entry,loss_ms:entry},
    {phase:"pit_lane",duration_ms:lane,loss_ms:lane},
    {phase:"pit_queue",duration_ms:queueMs,loss_ms:queueMs},
    {phase:"pit_box",duration_ms:stationaryMs,loss_ms:stationaryMs},
    {phase:"pit_release",duration_ms:releaseMs,loss_ms:releaseMs},
    {phase:"pit_exit",duration_ms:exit,loss_ms:exit},
    {phase:"rejoin",duration_ms:rejoin,loss_ms:rejoin},
  ];
}

export function pitTotalLossMs(stop={}){
  const explicit=finite(stop?.total_loss_s,NaN);
  if(Number.isFinite(explicit))return Math.max(0,Math.round(explicit*1000));
  return pitPhaseDurationsMs(stop)
    .reduce((sum,row)=>sum+Math.max(0,finite(row?.loss_ms,0)),0);
}

export function normalisePitPhaseDurations(stop={}){
  const phases=pitPhaseDurationsMs(stop);
  const authoritativeTotal=pitTotalLossMs(stop);
  const fromPhases=phases.reduce((sum,row)=>sum+Math.max(0,finite(row?.loss_ms,0)),0);
  const correction=authoritativeTotal-fromPhases;
  if(phases.length&&correction!==0){
    const last=phases.length-1;
    phases[last]={
      ...phases[last],
      duration_ms:Math.max(0,finite(phases[last]?.duration_ms,0)+correction),
      loss_ms:Math.max(0,finite(phases[last]?.loss_ms,0)+correction),
    };
  }
  return phases;
}
