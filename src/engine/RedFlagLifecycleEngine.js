// src/engine/RedFlagLifecycleEngine.js
// RW5.2D4.4 — persistent Red Flag suspension lifecycle.
//
// D4.4 owns the state transition only:
// RUNNING -> SUSPENDED -> RESTART_PENDING -> RUNNING
//
// D4.5 owns work permitted during the suspension.
// D4.6 decides when a restart is safe enough to authorise.

import { createRestartMonitor } from "./RestartHysteresisEngine.js";

const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};

export function redFlagHoldingAreaForYear(yearInput){
  const year=Number(yearInput)||1980;
  // For 2015 the FIA changed the normal suspension holding location from the
  // starting grid to the pit lane. Earlier eras are represented by the grid.
  return year>=2015?"pit_lane":"starting_grid";
}

export function redFlagClockPolicyForYear(yearInput){
  const year=Number(yearInput)||1980;
  // The simulation currently has no separate wall-clock race limit. Track
  // progress always freezes. Modern FIA rules keep formal timekeeping running
  // while accounting for suspension duration separately.
  return year>=2015
    ?"timekeeping_continues_suspension_allowance"
    :"track_progress_frozen";
}


export function redFlagWorkPolicyForYear(yearInput){
  const year=Number(yearInput)||1980;
  if(year>=2021){
    return {
      id:"restricted_accident_work",
      label:"Restricted suspension work",
      tyre_change:true,
      genuine_accident_repair:true,
      front_wing_adjustment:true,
      routine_component_replacement:false,
      refuelling:false,
      notes:"Tyres may be changed; only genuine accident damage may be repaired and front-wing aero may be adjusted with existing parts.",
    };
  }
  if(year>=1993){
    return {
      id:"broad_suspension_work",
      label:"Broad suspension work",
      tyre_change:true,
      genuine_accident_repair:true,
      front_wing_adjustment:true,
      routine_component_replacement:true,
      refuelling:false,
      notes:"Cars may be worked on during the suspension. D4.5 models tyres now; component work waits for the damage model.",
    };
  }
  return {
    id:"historic_restart_service",
    label:"Historic restart service",
    tyre_change:true,
    genuine_accident_repair:true,
    front_wing_adjustment:true,
    routine_component_replacement:true,
    refuelling:false,
    notes:"Historic stoppages and restarts used broader service procedures. D4.5 models tyre work while preserving future damage hooks.",
  };
}

function snapshotClassification(rows=[]){
  return (rows||[])
    .slice()
    .sort((a,b)=>Number(a?.position??999)-Number(b?.position??999))
    .map((row)=>({
      driver_id:String(row?.driver_id??""),
      team_id:String(row?.team_id??""),
      position:Number(row?.position??999),
      laps_completed:Number(row?.laps_completed??0),
      elapsed_ms:Number.isFinite(Number(row?.elapsed_ms))?Number(row.elapsed_ms):null,
      status:String(row?.status||"RUNNING"),
      retired:Boolean(row?.retired),
      tyre:row?.tyre?{
        tyre_id:row.tyre.tyre_id??null,
        compound:row.tyre.compound??null,
        category:row.tyre.category??null,
        condition:Number.isFinite(Number(row.tyre.condition))?Number(row.tyre.condition):null,
        age_laps:Number.isFinite(Number(row.tyre.age_laps))?Number(row.tyre.age_laps):null,
      }:null,
    }));
}

export function createRedFlagSuspension({
  year=1980,
  rules={},
  period={},
  classification=[],
  lap=1,
  sector=1,
  trackState=null,
  sequence=1,
}={}){
  const holdingArea=rules?.red_flag_holding_area||redFlagHoldingAreaForYear(year);
  const clockPolicy=rules?.red_flag_clock_policy||redFlagClockPolicyForYear(year);
  return {
    model:"rw5.2d4.4",
    phase:"suspended",
    sequence:Math.max(1,Number(sequence)||1),
    triggered_lap:Math.max(1,Number(lap)||1),
    triggered_sector:Math.max(1,Math.min(3,Number(sector)||1)),
    cause:String(period?.cause||"race_control"),
    holding_area:holdingArea,
    restart_style:String(rules?.restart_style||"era_restart"),
    clock_policy:clockPolicy,
    work_policy:rules?.red_flag_work_policy||redFlagWorkPolicyForYear(year),
    work_locked:false,
    work_log:[],
    restart_monitor:createRestartMonitor({
      year,
      rules,
      cause:String(period?.cause||"race_control"),
      triggerTrackState:trackState,
    }),
    race_progress_frozen:true,
    overtaking_allowed:false,
    restart_authorized:false,
    restart_prepared:false,
    suspension_period:{
      type:"RED_FLAG",
      from_lap:Number(period?.from_lap??lap),
      from_sector:Number(period?.from_sector??sector),
      cause:String(period?.cause||"race_control"),
      driver_id:period?.driver_id??null,
      race_control_score:Number.isFinite(Number(period?.race_control_score))?Number(period.race_control_score):null,
      race_control_severity:period?.race_control_severity??null,
      race_control_signals:Array.isArray(period?.race_control_signals)?[...period.race_control_signals]:[],
      race_control_factors:Array.isArray(period?.race_control_factors)?[...period.race_control_factors]:[],
    },
    track_snapshot:trackState?{
      state:trackState?.state??null,
      rain_intensity:Number.isFinite(Number(trackState?.rain_intensity))?Number(trackState.rain_intensity):null,
      track_wetness:Number.isFinite(Number(trackState?.track_wetness))?Number(trackState.track_wetness):null,
      standing_water_index:Number.isFinite(Number(trackState?.standing_water_index))?Number(trackState.standing_water_index):null,
      raceability_index:Number.isFinite(Number(trackState?.raceability_index))?Number(trackState.raceability_index):null,
      visibility_index:Number.isFinite(Number(trackState?.visibility_index))?Number(trackState.visibility_index):null,
      spray_index:Number.isFinite(Number(trackState?.spray_index))?Number(trackState.spray_index):null,
      grip_index:Number.isFinite(Number(trackState?.grip_index))?Number(trackState.grip_index):null,
    }:null,
    classification_snapshot:snapshotClassification(classification),
  };
}

export function prepareRedFlagRestart(lifecycle){
  if(!lifecycle||String(lifecycle?.phase)!=="suspended")return lifecycle;
  if(lifecycle?.restart_monitor?.restart_authorized!==true)return lifecycle;
  return {
    ...lifecycle,
    phase:"restart_pending",
    work_locked:true,
    restart_prepared:true,
    restart_authorized:true,
  };
}

export function completeRedFlagRestart(lifecycle,{lap=null,sector=null,restartControl=null}={}){
  if(!lifecycle||String(lifecycle?.phase)!=="restart_pending"||lifecycle?.restart_authorized!==true)return lifecycle;
  return {
    ...lifecycle,
    phase:"resumed",
    race_progress_frozen:false,
    overtaking_allowed:true,
    restart_control:String(restartControl||lifecycle?.restart_monitor?.recommended_control||"GREEN"),
    resumed_lap:Number.isFinite(Number(lap))?Number(lap):num(lifecycle?.triggered_lap,1),
    resumed_sector:Number.isFinite(Number(sector))?Number(sector):num(lifecycle?.triggered_sector,1),
  };
}

export function legacyRedFlagLifecycle({year=1980,rules={},live={}}={}){
  if(!live||String(live?.status)!=="red_flag")return null;
  return createRedFlagSuspension({
    year,
    rules,
    period:live?.red_flag_period||{},
    classification:live?.classification||[],
    lap:live?.current_lap||1,
    sector:live?.current_sector||1,
    trackState:live?.track_state||null,
    sequence:1,
  });
}
