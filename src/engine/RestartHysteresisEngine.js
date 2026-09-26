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

function recoveryWeatherRows(rows,currentLap,requiredSafeChecks){
  const source=(Array.isArray(rows)&&rows.length?rows.at(-1):{})||{};
  const numeric=(key,fallback)=>{
    const value=Number(source?.[key]);
    return Number.isFinite(value)?value:fallback;
  };
  const target={
    raceability_index:84,
    raceability_hazard_index:16,
    standing_water_index:8,
    visibility_index:92,
    spray_index:0.08,
    grip_index:84,
    rain_intensity:0.08,
    track_wetness:0.24,
    wetness_delta:-0.03,
  };
  const steps=Math.max(6,Number(requiredSafeChecks||2)+4);
  const mix=(from,to,t)=>from+(to-from)*t;
  return Array.from({length:steps},(_,index)=>{
    const t=(index+1)/steps;
    const safeTail=index>=steps-Math.max(2,Number(requiredSafeChecks)||2);
    return {
      ...source,
      lap:Math.max(1,Number(currentLap)||1),
      state:safeTail?"DRYING":t>=0.55?"LIGHT_RAIN":"HEAVY_RAIN",
      raceability_band:safeTail?"GOOD":t>=0.55?"POOR":"CRITICAL",
      raceability_index:Number(mix(numeric("raceability_index",20),target.raceability_index,t).toFixed(2)),
      raceability_hazard_index:Number(mix(numeric("raceability_hazard_index",80),target.raceability_hazard_index,t).toFixed(2)),
      standing_water_index:Number(mix(numeric("standing_water_index",90),target.standing_water_index,t).toFixed(2)),
      visibility_index:Number(mix(numeric("visibility_index",30),target.visibility_index,t).toFixed(2)),
      spray_index:Number(mix(numeric("spray_index",0.95),target.spray_index,t).toFixed(3)),
      grip_index:Number(mix(numeric("grip_index",25),target.grip_index,t).toFixed(2)),
      rain_intensity:Number(mix(numeric("rain_intensity",0.85),target.rain_intensity,t).toFixed(3)),
      track_wetness:Number(mix(numeric("track_wetness",0.90),target.track_wetness,t).toFixed(3)),
      wetness_delta:target.wetness_delta,
      suspension_elapsed_min:(index+1)*5,
      restart_recovery_generated:true,
    };
  });
}

export function fastForwardRestartConditions({
  monitor,
  year=1980,
  rules={},
  cause="weather",
  timeline=[],
  currentLap=1,
  maxChecks=null,
}={}){
  let working=monitor||createRestartMonitor({year,rules,cause});
  const sourceRows=Array.isArray(timeline)?timeline:[];
  const required=Math.max(1,Number(working?.required_safe_checks)||1);
  const recoveryRows=String(cause||"weather")==="weather"
    ?recoveryWeatherRows(sourceRows,currentLap,required)
    :[];
  // Red Flag fast-forward represents wall-clock waiting, not race distance.
  // Existing weather slices are consumed first; if a storm outlasts the race
  // timeline, deterministic recovery slices let conditions improve while the
  // cars remain stopped on the restart grid.
  const rows=[...sourceRows,...recoveryRows];
  const hasExplicitMax=maxChecks!==null&&maxChecks!==undefined&&Number.isFinite(Number(maxChecks));
  const limit=Math.max(1,Math.min(
    512,
    hasExplicitMax
      ?Math.round(Number(maxChecks))
      :Math.max(4,rows.length+required+2)
  ));
  const observations=[];
  let latest={
    monitor:working,
    observation:null,
    safe:false,
    authorized:Boolean(working?.restart_authorized),
    recommended_control:working?.recommended_control||"RED_FLAG",
  };

  for(let step=0;step<limit&&!latest.authorized;step+=1){
    latest=assessRestartConditions({
      monitor:working,
      year,
      rules,
      cause,
      timeline:rows,
      currentLap,
      finalValidation:false,
    });
    working=latest.monitor;
    if(latest.observation)observations.push(latest.observation);
  }

  return {
    ...latest,
    monitor:{
      ...working,
      fast_forward_completed:Boolean(latest.authorized),
      fast_forward_checks:observations.length,
    },
    observations,
    checks_advanced:observations.length,
    generated_recovery_checks:observations.filter((row)=>row?.track_state?.restart_recovery_generated).length,
    exhausted:!latest.authorized,
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
