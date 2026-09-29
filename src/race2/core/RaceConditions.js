// src/race2/core/RaceConditions.js
// RW8.11A: canonical weather/track-condition projection and Race Control assessment.
//
// Existing shared models remain authoritative:
// - RaceControlEngine owns era rules and the deterministic weather timeline.
// - RaceControlPolicyEngine owns the decision policy.
// This RW2 layer only consumes detached snapshots already stored in RaceState.

import {
  incidentRaceControlAssessment,
  weatherRaceControlAssessment,
} from "../../engine/RaceControlPolicyEngine.js";

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"");

const CONTROL_RANK=Object.freeze({
  GREEN:0,
  LOCAL_YELLOW:1,
  VSC:2,
  SAFETY_CAR:3,
  RED_FLAG:4,
});

function controlRank(action){
  return CONTROL_RANK[text(action).toUpperCase()]??0;
}

function timelineOf(stateLike){
  const timeline=stateLike?.weatherState?.timeline
    ??stateLike?.weather?.timeline
    ??stateLike?.session?.weather?.timeline
    ??[];
  return Array.isArray(timeline)?timeline:[];
}

function fallbackWeatherRow(weather={}){
  const track=weather?.track||{};
  const environment=weather?.environment||{};
  return {
    lap:1,
    state:text(weather?.state||"SUNNY").toUpperCase(),
    rain_intensity:finite(weather?.rain_intensity,0),
    rain_band:weather?.rain_band??null,
    track_wetness:finite(
      weather?.starting_track_wetness
      ??track?.start_wetness
      ??track?.track_wetness,
      0
    ),
    wetness_delta:0,
    rubber_level:finite(
      weather?.starting_rubber_level
      ??track?.start_rubber_level
      ??track?.rubber_level,
      12
    ),
    grip_index:finite(
      weather?.starting_grip_index
      ??track?.start_grip_index
      ??track?.grip_index,
      60
    ),
    air_temp_c:finite(
      weather?.starting_air_temp_c
      ??environment?.start_air_temp_c
      ??weather?.air_temp_c
      ??weather?.avg_temp_c,
      22
    ),
    track_temp_c:finite(
      weather?.starting_track_temp_c
      ??environment?.start_track_temp_c
      ??weather?.track_temp_c,
      30
    ),
    spray_index:finite(
      weather?.starting_spray_index
      ??environment?.start_spray_index,
      0
    ),
    spray_band:environment?.spray_band??"NONE",
    visibility_index:finite(
      weather?.starting_visibility_index
      ??environment?.start_visibility_index,
      100
    ),
    visibility_band:environment?.visibility_band??"CLEAR",
    standing_water_index:0,
    standing_water_band:"NONE",
    raceability_index:100,
    raceability_hazard_index:0,
    raceability_band:"GOOD",
    raceability_factors:{},
    raceability_dominant_factors:[],
  };
}

function rowForLap(stateLike,lap){
  const timeline=timelineOf(stateLike);
  if(!timeline.length)return fallbackWeatherRow(
    stateLike?.weatherState
    ??stateLike?.weather
    ??stateLike?.session?.weather
    ??{}
  );
  const target=Math.max(1,Math.floor(finite(lap,1)));
  return timeline.find((row)=>Number(row?.lap)===target)
    ??timeline.filter((row)=>Number(row?.lap)<=target).at(-1)
    ??timeline[0];
}

export function raceConditionsReferenceLap(state,cars=state?.cars){
  const rows=Array.isArray(cars)?cars:[];
  const lapLimit=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));
  const active=rows.filter((car)=>!car?.dnf&&car?.status!=="dnf");
  const source=active.length?active:rows;
  const maximum=source.reduce((best,car)=>Math.max(best,finite(car?.lap,1)),1);
  return Math.min(lapLimit,Math.max(1,Math.floor(maximum)));
}

export function trackStateFromWeatherRow(row={}){
  return {
    weatherState:text(row?.state||"SUNNY").toUpperCase(),
    referenceLap:Math.max(1,Math.floor(finite(row?.lap,1))),
    wetness:finite(row?.track_wetness,0),
    standingWater:finite(row?.standing_water_index,0),
    grip:finite(row?.grip_index,60),
    rubber:finite(row?.rubber_level,12),
    airTemp:finite(row?.air_temp_c,22),
    trackTemp:finite(row?.track_temp_c,30),
    rainIntensity:finite(row?.rain_intensity,0),
    spray:finite(row?.spray_index,0),
    visibility:finite(row?.visibility_index,100),
    raceability:finite(row?.raceability_index,100),
    raceabilityBand:row?.raceability_band??"GOOD",
  };
}

function weatherStateFromRow(base,row){
  return {
    ...(base||{}),
    state:text(row?.state||base?.state||"SUNNY").toUpperCase(),
    currentLap:Math.max(1,Math.floor(finite(row?.lap,1))),
    current:{...row},
    air_temp_c:finite(row?.air_temp_c,base?.air_temp_c??base?.avg_temp_c??22),
    track_temp_c:finite(row?.track_temp_c,base?.track_temp_c??30),
    rain_intensity:finite(row?.rain_intensity,base?.rain_intensity??0),
    track_wetness:finite(row?.track_wetness,base?.track_wetness??0),
    grip_index:finite(row?.grip_index,base?.grip_index??60),
    visibility_index:finite(row?.visibility_index,base?.visibility_index??100),
    spray_index:finite(row?.spray_index,base?.spray_index??0),
    standing_water_index:finite(row?.standing_water_index,base?.standing_water_index??0),
    raceability_index:finite(row?.raceability_index,base?.raceability_index??100),
  };
}

function initialRaceControlState(input){
  return {
    model:"rw8.11a",
    phase:"assessment",
    mode:"GREEN",
    recommendedMode:"GREEN",
    source:null,
    referenceLap:1,
    rules:{...(input?.raceControl?.rules||{})},
    assessment:null,
    updatedTick:0,
  };
}

export function initialRaceConditions(input){
  const baseWeather=input?.weather||{};
  const weatherState={
    ...baseWeather,
    timeline:Array.isArray(baseWeather?.timeline)
      ?baseWeather.timeline.map((row)=>({...row}))
      :[],
  };
  const row=rowForLap({weatherState},1);
  return {
    trackState:trackStateFromWeatherRow(row),
    weatherState:weatherStateFromRow(weatherState,row),
    raceControlState:initialRaceControlState(input),
  };
}

function incidentDescriptor(event){
  if(event?.type==="accident"){
    return {
      kind:"accident",
      severity:event?.payload?.severity??"medium",
      severity_score:finite(event?.payload?.severityScore,null),
    };
  }
  if(event?.type==="mechanical_failure"){
    return {
      kind:"mechanical",
      severity:"low",
      severity_score:0.2,
    };
  }
  if(event?.type==="damage"&&event?.payload?.source==="contact"){
    return {
      kind:"collision",
      severity:event?.payload?.severity??"medium",
      severity_score:finite(event?.payload?.severityScore,null),
    };
  }
  return null;
}

function strongestDecision(decisions=[]){
  return decisions
    .filter(Boolean)
    .slice()
    .sort((a,b)=>controlRank(b.action)-controlRank(a.action))[0]
    ??{action:"GREEN",source:null,assessment:null,event:null};
}

function decisionEvent(state,decision,referenceLap){
  return {
    type:"race_control_assessment",
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    timeMs:Math.max(0,finite(state?.simulationTimeMs,0)),
    carIds:decision?.event?.carIds||[],
    driverIds:decision?.event?.driverIds||[],
    payload:{
      action:decision?.action??"GREEN",
      source:decision?.source??null,
      referenceLap,
      assessment:decision?.assessment??null,
    },
  };
}

export function advanceRaceConditions(state,cars,sourceEvents=[]){
  if(!state){
    return {
      trackState:null,
      weatherState:null,
      raceControlState:null,
      events:[],
    };
  }

  const referenceLap=raceConditionsReferenceLap(state,cars);
  const row=rowForLap(state,referenceLap);
  const trackState=trackStateFromWeatherRow(row);
  const weatherState=weatherStateFromRow(state?.weatherState||{},row);
  const rules=state?.raceControlState?.rules||{};

  const weatherAssessment=weatherRaceControlAssessment({
    rules,
    row,
    recentRows:timelineOf(state).filter((item)=>Number(item?.lap)<referenceLap).slice(-2),
  });
  const decisions=[{
    action:weatherAssessment?.action??"GREEN",
    source:"weather",
    assessment:weatherAssessment,
    event:null,
  }];

  for(const event of sourceEvents||[]){
    const incident=incidentDescriptor(event);
    if(!incident)continue;
    const assessment=incidentRaceControlAssessment({
      rules,
      incident,
      weatherRow:row,
    });
    decisions.push({
      action:assessment?.action??"GREEN",
      source:"incident",
      assessment,
      event,
    });
  }

  const chosen=strongestDecision(decisions);
  const previousMode=text(state?.raceControlState?.recommendedMode||"GREEN").toUpperCase();
  const nextMode=text(chosen?.action||"GREEN").toUpperCase();
  const changed=nextMode!==previousMode;

  return {
    trackState,
    weatherState,
    raceControlState:{
      ...(state?.raceControlState||initialRaceControlState({})),
      model:"rw8.11a",
      phase:"assessment",
      mode:"GREEN",
      recommendedMode:nextMode,
      source:nextMode==="GREEN"?null:chosen?.source??null,
      referenceLap,
      assessment:chosen?.assessment??null,
      updatedTick:Math.max(0,Math.floor(finite(state?.tick,0))),
    },
    events:changed?[decisionEvent(state,chosen,referenceLap)]:[],
  };
}
