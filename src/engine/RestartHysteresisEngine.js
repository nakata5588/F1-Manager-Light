// src/engine/RestartHysteresisEngine.js
// RW5.2D4.6 — restart hysteresis after a Red Flag.
//
// FIA rules leave restart timing to Race Control. The consecutive-safe-check
// requirement below is a deterministic simulation mechanic: it creates a
// release threshold lower than the Red Flag entry threshold and requires
// sustained improvement before a restart can be prepared.

import { weatherRaceControlAssessment } from "./RaceControlPolicyEngine.js";

const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};

export function restartHysteresisPolicyForYear(yearInput,rules={},cause="weather"){
  const year=Number(yearInput)||1980;
  const hasSafetyCar=Boolean(rules?.safety_car);
  const weatherCause=String(cause||"weather")==="weather";
  return {
    id:hasSafetyCar?"sustained_release_with_safety_car":"sustained_green_release",
    model:"rw5.2d4.6",
    required_safe_checks:weatherCause?2:1,
    // Red Flag entry in D4.3 is around 70+. Release deliberately sits lower.
    release_score_max:hasSafetyCar?60:47,
    allow_safety_car_restart:hasSafetyCar,
    final_validation_required:true,
    sample_step_laps:1,
    year,
  };
}

function baseAssessment({rules,row,recentRows=[]}={}){
  return weatherRaceControlAssessment({rules,row:row||{},recentRows});
}

export function createRestartMonitor({
  year=1980,
  rules={},
  cause="weather",
  triggerTrackState=null,
}={}){
  const policy=restartHysteresisPolicyForYear(year,rules,cause);
  const initial=baseAssessment({rules,row:triggerTrackState||{}});
  return {
    model:"rw5.2d4.6",
    policy_id:policy.id,
    required_safe_checks:policy.required_safe_checks,
    release_score_max:policy.release_score_max,
    allow_safety_car_restart:policy.allow_safety_car_restart,
    final_validation_required:policy.final_validation_required,
    check_count:0,
    observation_cursor:0,
    safe_streak:0,
    restart_authorized:false,
    recommended_control:"RED_FLAG",
    initial_score:Number(initial?.score??100),
    latest_score:Number(initial?.score??100),
    latest_action:String(initial?.action||"RED_FLAG"),
    latest_safe:false,
    status:"waiting_for_improvement",
    observations:[],
  };
}

function observationRow({timeline=[],currentLap=1,monitor={},cause="weather"}={}){
  const rows=Array.isArray(timeline)?timeline:[];
  if(!rows.length)return {row:null,index:-1};
  const base=Math.max(0,Math.min(rows.length-1,(Number(currentLap)||1)-1));
  const cursor=Math.max(0,Number(monitor?.observation_cursor)||0);
  // Weather stoppages sample the next environmental slice first. Incident
  // stoppages may assess the current conditions immediately.
  const offset=String(cause||"weather")==="weather"?1:0;
  const index=Math.min(rows.length-1,base+offset+cursor);
  return {row:rows[index]||rows.at(-1)||null,index};
}

function isSafeForRelease({assessment,rules,monitor}={}){
  if(!assessment)return false;
  if(String(assessment.action)==="RED_FLAG")return false;
  if(
    String(assessment.action)==="SAFETY_CAR"&&
    !Boolean(monitor?.allow_safety_car_restart&&rules?.safety_car)
  )return false;
  if(String(assessment.action)==="VSC")return false;
  if(Number(assessment.score)>Number(monitor?.release_score_max??50))return false;
  return true;
}

export function assessRestartConditions({
  monitor,
  year=1980,
  rules={},
  cause="weather",
  timeline=[],
  currentLap=1,
  finalValidation=false,
}={}){
  const current=monitor||createRestartMonitor({year,rules,cause});
  const sampled=observationRow({timeline,currentLap,monitor:current,cause});
  const fallbackRow=sampled.row||{};
  const priorRows=(current?.observations||[])
    .slice(-2)
    .map((item)=>item?.track_state)
    .filter(Boolean);
  const assessment=baseAssessment({rules,row:fallbackRow,recentRows:priorRows});
  const safe=isSafeForRelease({assessment,rules,monitor:current});
  const safeStreak=finalValidation
    ?safe?Math.max(Number(current?.safe_streak)||0,Number(current?.required_safe_checks)||1):0
    :safe?(Number(current?.safe_streak)||0)+1:0;
  const authorized=safeStreak>=Math.max(1,Number(current?.required_safe_checks)||1);
  const recommendedControl=authorized
    ?String(assessment.action)==="SAFETY_CAR"&&rules?.safety_car?"SAFETY_CAR":"GREEN"
    :"RED_FLAG";
  const observation={
    check:Number(current?.check_count||0)+1,
    timeline_index:sampled.index,
    lap:Number(fallbackRow?.lap??currentLap),
    final_validation:Boolean(finalValidation),
    safe,
    score:Number(assessment?.score??100),
    action:String(assessment?.action||"RED_FLAG"),
    severity:String(assessment?.severity||"EXTREME"),
    severe_signals:Array.isArray(assessment?.severe_signals)?[...assessment.severe_signals]:[],
    dominant_factors:Array.isArray(assessment?.dominant_factors)?[...assessment.dominant_factors]:[],
    track_state:fallbackRow,
  };
  return {
    monitor:{
      ...current,
      check_count:observation.check,
      observation_cursor:(Number(current?.observation_cursor)||0)+1,
      safe_streak:safeStreak,
      restart_authorized:authorized,
      recommended_control:recommendedControl,
      latest_score:observation.score,
      latest_action:observation.action,
      latest_safe:safe,
      status:authorized?"restart_window_available":safe?"improving":"unsafe",
      observations:[...(current?.observations||[]),observation],
    },
    observation,
    safe,
    authorized,
    recommended_control:recommendedControl,
  };
}

export function suspendRestartProcedure(lifecycle,monitor){
  if(!lifecycle)return lifecycle;
  return {
    ...lifecycle,
    phase:"suspended",
    work_locked:false,
    restart_prepared:false,
    restart_authorized:false,
    restart_monitor:{
      ...(monitor||lifecycle?.restart_monitor||{}),
      safe_streak:0,
      restart_authorized:false,
      recommended_control:"RED_FLAG",
      status:"procedure_suspended",
    },
  };
}
