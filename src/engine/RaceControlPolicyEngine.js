// src/engine/RaceControlPolicyEngine.js
// RW5.2D4.3 — era-aware Race Control policy.
//
// This module converts environmental/incident risk into the mechanisms that
// actually exist in a given era. It does not implement Red Flag suspension,
// restart or work-under-red lifecycle; those belong to D4.4-D4.6.

const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const round=(v,digits=3)=>{
  const p=10**digits;
  return Math.round(Number(v)*p)/p;
};

function weatherLoads(row={}){
  const hazard=clamp(num(row?.raceability_hazard_index,100-num(row?.raceability_index,100))/100,0,1);
  const standing=clamp(num(row?.standing_water_index,0)/100,0,1);
  const visibility=clamp(1-num(row?.visibility_index,100)/100,0,1);
  const spray=clamp(num(row?.spray_index,0),0,1);
  const grip=clamp(1-num(row?.grip_index,100)/100,0,1);
  const rain=clamp(num(row?.rain_intensity,0),0,1);
  const worsening=clamp(Math.max(0,num(row?.wetness_delta,0))/0.035,0,1);
  return {hazard,standing,visibility,spray,grip,rain,worsening};
}

function physicalSignals(loads){
  return [
    ["standing_water",loads.standing,0.58],
    ["visibility",loads.visibility,0.48],
    ["spray",loads.spray,0.72],
    ["grip",loads.grip,0.55],
    ["rain",loads.rain,0.62],
  ]
    .filter(([,value,threshold])=>value>=threshold)
    .map(([name])=>name);
}

function weatherScore(loads,recentCritical=0){
  return clamp(
    loads.hazard*0.52+
    loads.standing*0.14+
    loads.visibility*0.12+
    loads.spray*0.08+
    loads.grip*0.06+
    loads.rain*0.04+
    loads.worsening*0.04+
    Math.min(0.06,Math.max(0,recentCritical)*0.03),
    0,1
  );
}

function weatherSeverity(score){
  if(score>=0.74)return "EXTREME";
  if(score>=0.56)return "SEVERE";
  if(score>=0.38)return "ELEVATED";
  return "NORMAL";
}

export function weatherRaceControlAssessment({rules={},row={},recentRows=[]}={}){
  const loads=weatherLoads(row);
  const severeSignals=physicalSignals(loads);
  const recentCritical=(recentRows||[])
    .slice(-2)
    .filter((item)=>
      String(item?.raceability_band||"").toUpperCase()==="CRITICAL"||
      num(item?.raceability_hazard_index,0)>=65
    ).length;
  const score=weatherScore(loads,recentCritical);

  const redFlagCandidate=Boolean(
    rules?.red_flag&&(
      (score>=0.70&&severeSignals.length>=2)||
      (score>=0.80&&severeSignals.length>=1)||
      (loads.hazard>=0.78&&severeSignals.length>=2)
    )
  );

  const safetyCarCandidate=Boolean(
    rules?.safety_car&&!redFlagCandidate&&(
      (score>=0.48&&severeSignals.length>=2)||
      (score>=0.58&&severeSignals.length>=1)
    )
  );

  // Weather is a circuit-wide condition. VSC remains an incident/local-hazard
  // mechanism and is never selected here.
  const action=redFlagCandidate
    ?"RED_FLAG"
    :safetyCarCandidate
      ?"SAFETY_CAR"
      :"GREEN";

  const contributions=[
    ["raceability",loads.hazard*0.52],
    ["standing_water",loads.standing*0.14],
    ["visibility",loads.visibility*0.12],
    ["spray",loads.spray*0.08],
    ["grip",loads.grip*0.06],
    ["rain",loads.rain*0.04],
    ["worsening",loads.worsening*0.04],
  ]
    .filter(([,value])=>value>0.01)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,4)
    .map(([name])=>name);

  return {
    action,
    score:round(score*100,1),
    severity:weatherSeverity(score),
    severe_signals:severeSignals,
    dominant_factors:contributions,
    recent_critical_laps:recentCritical,
    mechanism_available:{
      safety_car:Boolean(rules?.safety_car),
      virtual_safety_car:Boolean(rules?.virtual_safety_car),
      red_flag:Boolean(rules?.red_flag),
    },
  };
}

const INCIDENT_SEVERITY=Object.freeze({
  low:0.20,
  medium:0.48,
  high:0.72,
  critical:0.94,
});

export function incidentRaceControlAssessment({rules={},incident={},weatherRow={}}={}){
  const severity=String(incident?.severity||"medium").toLowerCase();
  const severityLoad=INCIDENT_SEVERITY[severity]??INCIDENT_SEVERITY.medium;
  const weatherHazard=clamp(
    num(weatherRow?.raceability_hazard_index,100-num(weatherRow?.raceability_index,100))/100,
    0,1
  );
  const standing=clamp(num(weatherRow?.standing_water_index,0)/100,0,1);
  const kind=String(incident?.kind||"").toLowerCase();
  const accidentBoost=kind.includes("collision")||kind.includes("accident")?0.05:0;
  const aquaplaningBoost=kind.startsWith("aquaplaning_")?0.04:0;
  const score=clamp(
    severityLoad*0.78+
    weatherHazard*0.14+
    standing*0.03+
    accidentBoost+
    aquaplaningBoost,
    0,1
  );

  let action="LOCAL_YELLOW";

  // Before the standard Safety Car era, severe situations can escalate directly
  // from local yellows to a stoppage. We do not invent a routine SC/VSC layer.
  if(rules?.red_flag&&(
    severity==="critical"||
    (severity==="high"&&score>=0.78)
  )){
    action="RED_FLAG";
  }else if(rules?.safety_car&&(
    severity==="high"||
    (severity==="medium"&&score>=0.58)
  )){
    action="SAFETY_CAR";
  }else if(rules?.virtual_safety_car&&severity==="medium"){
    action="VSC";
  }

  return {
    action,
    score:round(score*100,1),
    severity,
    reason_factors:[
      "incident_severity",
      ...(weatherHazard>=0.45?["raceability"]:[]),
      ...(standing>=0.50?["standing_water"]:[]),
      ...(accidentBoost>0?["accident_type"]:[]),
      ...(aquaplaningBoost>0?["aquaplaning"]:[]),
    ],
  };
}
