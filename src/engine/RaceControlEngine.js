// src/engine/RaceControlEngine.js
// RW4.2 — era-aware race control, live incidents and track-weather evolution.

import { rngFor } from "../core/random.js";
import { driverCondition } from "../domain/driverRating.js";
import { raceEntryTeamForDriver } from "../domain/raceEntry.js";

const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const idOf=(row)=>String(row?.driver_id??row?.driver?.driver_id??row?.id??"");

export function raceControlRulesForYear(yearInput){
  const year=Number(yearInput)||1980;
  if(year<=1992)return {
    era_id:"pre_standard_safety_car",
    label:"Historic race control",
    local_yellows:true,
    safety_car:false,
    virtual_safety_car:false,
    red_flag:true,
    restart_style:"era_restart",
    notes:"Local yellows and race stoppages are available; no modern routine Safety Car system is applied.",
  };
  if(year<=2014)return {
    era_id:"safety_car_era",
    label:"Safety Car era",
    local_yellows:true,
    safety_car:true,
    virtual_safety_car:false,
    red_flag:true,
    restart_style:"rolling_restart",
    notes:"Safety Car and red flags are available; VSC is not yet part of race control.",
  };
  return {
    era_id:"modern_race_control",
    label:"Modern race control",
    local_yellows:true,
    safety_car:true,
    virtual_safety_car:true,
    red_flag:true,
    restart_style:"modern_restart",
    notes:"Local yellows, VSC, Safety Car and red flags can be used according to incident severity.",
  };
}

function weatherRow(gs,state){
  return (gs?.dbWeatherStates||gs?.weatherStates||[]).find((row)=>String(row?.id)===String(state))||{};
}
export function weatherStateAtLap(weather,lap){
  return weather?.segments?.find((row)=>lap>=Number(row?.from_lap)&&lap<=Number(row?.to_lap))?.state||weather?.state||"SUNNY";
}
function rainIntensity(state){
  return {SUNNY:0,CLOUDY:0,WINDY:0,DRYING:0.05,DRIZZLE_DRYING:0.08,WETTING:0.28,LIGHT_RAIN:0.42,HEAVY_RAIN:0.78,STORM:1}[String(state)]??0;
}
function wetnessTarget(state){
  return {SUNNY:0,CLOUDY:0,WINDY:0,DRYING:0.12,DRIZZLE_DRYING:0.20,WETTING:0.45,LIGHT_RAIN:0.62,HEAVY_RAIN:0.88,STORM:1}[String(state)]??0;
}
export function buildTrackWeatherTimeline(gs,weather,track){
  const out=[];
  let wetness=weatherStateAtLap(weather,1)==="SUNNY"?0:wetnessTarget(weatherStateAtLap(weather,1))*0.55;
  const laps=Math.max(1,Number(track?.laps)||1);
  for(let lap=1;lap<=laps;lap++){
    const state=weatherStateAtLap(weather,lap);
    const target=wetnessTarget(state);
    const rate=target>wetness?0.24:0.14;
    wetness=clamp(wetness+(target-wetness)*rate,0,1);
    const row=weatherRow(gs,state);
    const grip=clamp(1-wetness*0.28-(state==="STORM"?0.10:0),0.48,1);
    const visibility=clamp(1-rainIntensity(state)*0.46-(state==="STORM"?0.12:0),0.32,1);
    out.push({
      lap,state,
      rain_intensity:Number(rainIntensity(state).toFixed(2)),
      track_wetness:Number(wetness.toFixed(3)),
      grip_index:Number((grip*100).toFixed(1)),
      visibility_index:Number((visibility*100).toFixed(1)),
      crash_risk_multiplier:Number(num(row?.crash_risk_ppm,{SUNNY:1,CLOUDY:1,WINDY:1.2,LIGHT_RAIN:1.6,HEAVY_RAIN:2.4,STORM:3.2}[state]||1).toFixed(2)),
      dnf_risk_multiplier:Number(num(row?.dnf_risk_ppm,1).toFixed(2)),
      safety_car_chance_pct:num(row?.safety_car_chance_pct,0),
      red_flag_chance_pct:num(row?.red_flag_chance_pct,0),
    });
  }
  return out;
}

function activeYearRow(rows,year){
  const arr=Array.isArray(rows)?rows:Object.values(rows||{});
  return arr.find((row)=>Number(row?.year??row?.season_year)===year)
    ||arr.filter((row)=>Number(row?.year??row?.season_year)<=year).sort((a,b)=>Number(b?.year??0)-Number(a?.year??0))[0]
    ||{};
}
function ratingFor(gs,did){
  return (gs?.driverRatings||[]).find((row)=>String(row?.driver_id??row?.id??"")===String(did))||{};
}
function teamReliability(gs,did){
  const tid=raceEntryTeamForDriver(gs?.raceEntryState,did)
    ||String((gs?.drivers||[]).find((d)=>idOf(d)===String(did))?.team_id||"");
  const year=Number(gs?.activeYear);
  const car=(gs?.carStats||[]).find((row)=>String(row?.team_id??"")===tid&&Number(row?.year??year)===year)||{};
  const eng=(gs?.teamEngines||[]).find((row)=>String(row?.team_id??"")===tid&&Number(row?.year??year)===year)||{};
  let carRel=num(car?.reliability,82); if(carRel>1)carRel/=100;
  let engRel=num(eng?.reliability,82); if(engRel>1)engRel/=100;
  return clamp(carRel*0.56+engRel*0.44,0.5,0.98);
}
function accidentChance(gs,row){
  const year=Number(gs?.activeYear)||1980;
  const did=idOf(row?.driver||row);
  const rating=ratingFor(gs,did);
  const crashLik=clamp(num(rating?.crash_likelihood,35)/100,0.05,0.95);
  const fatigue=num(driverCondition(gs,did)?.fatigue,0);
  const fatigueRisk=Math.max(0,fatigue-35)*0.0007;
  const model=activeYearRow(gs?.accidentModel??gs?.dbAccidentModel,year);
  const damageProb=clamp(num(model?.damage_DNF_prob??model?.damage_dnf_prob,0.10),0.04,0.25);
  const weatherMult=clamp(num(row?.incident_risk_multiplier,1),0.6,4);
  if(year===1980)return clamp((0.15+(crashLik-0.35)*0.10+fatigueRisk)*weatherMult,0.06,0.52);
  return clamp((0.012+crashLik*damageProb*0.32+fatigueRisk)*weatherMult,0.004,0.38);
}
function mechanicalChance(gs,row){
  const did=idOf(row?.driver||row);
  const rel=teamReliability(gs,did);
  return clamp((1-rel)*0.68*num(row?.mechanical_risk_multiplier,1),0.012,0.34);
}
function weightedIncidentLap(rng,timeline){
  const weighted=[];
  let total=0;
  for(const lap of timeline){
    const late=0.82+(lap.lap/Math.max(1,timeline.length))*0.36;
    const w=Math.max(0.05,num(lap.crash_risk_multiplier,1)*late);
    total+=w; weighted.push([lap.lap,total]);
  }
  const roll=rng.next()*total;
  return weighted.find(([,cum])=>roll<=cum)?.[0]||timeline.length;
}
function severity(rng,type,state){
  const weatherBoost=["HEAVY_RAIN","STORM"].includes(String(state))?0.12:0;
  const collisionBoost=type==="collision"?0.08:0;
  const score=clamp(0.08+rng.next()*0.84+weatherBoost+collisionBoost,0.05,1);
  return {score:Number(score.toFixed(3)),label:score>=0.94?"critical":score>=0.78?"high":score>=0.50?"medium":"low"};
}
function responseForIncident(rules,incident,weatherLap,rng){
  if(rules.red_flag&&(incident.severity==="critical"||weatherLap.state==="STORM")&&rng.chance(clamp(num(weatherLap.red_flag_chance_pct,0)/100+0.10,0,0.42))){
    return "RED_FLAG";
  }
  if(rules.safety_car&&["high","critical"].includes(incident.severity))return "SAFETY_CAR";
  if(rules.virtual_safety_car&&incident.severity==="medium"&&rng.chance(0.55))return "VSC";
  if(rules.safety_car&&incident.severity==="medium"&&rng.chance(0.48))return "SAFETY_CAR";
  return "LOCAL_YELLOW";
}
function durationFor(response,rng,laps){
  if(response==="RED_FLAG")return 1;
  if(response==="SAFETY_CAR")return 2+Math.floor(rng.next()*3);
  if(response==="VSC")return 1+Math.floor(rng.next()*2);
  return 1;
}
function mergePeriods(periods,totalLaps){
  const sorted=periods.slice().sort((a,b)=>a.from_lap-b.from_lap||a.priority-b.priority);
  const out=[];
  for(const period of sorted){
    const p={...period,to_lap:Math.min(totalLaps,period.to_lap)};
    const last=out.at(-1);
    if(last&&p.from_lap<=last.to_lap&&p.type===last.type){
      last.to_lap=Math.max(last.to_lap,p.to_lap);
      continue;
    }
    out.push(p);
  }
  return out;
}

export function createRaceControlPlan(gs,{gp={},race=[],weather,track}={}){
  const year=Number(gs?.activeYear)||Number(gp?.year)||1980;
  const rules=raceControlRulesForYear(year);
  const timeline=buildTrackWeatherTimeline(gs,weather||{},track||{});
  const gpId=String(gp?.gp_id??gp?.id??gp?.track_id??"race");
  const rng=rngFor(gs,`${year}-${gpId}-rw4.2-race-control`);
  const incidents=[];
  const periods=[];

  for(const row of race||[]){
    const roll=rng.next();
    const mech=mechanicalChance(gs,row);
    const accident=accidentChance(gs,row);
    let kind=null,reason=null;
    if(roll<mech){
      kind="mechanical";
      reason=rng.pick(["Engine","Gearbox","Transmission","Electrical","Cooling","Fuel system","Suspension"]);
    }else if(roll<mech+accident){
      kind=rng.next()<0.72?"accident":"collision";
      reason=kind==="accident"?"Accident":"Collision";
    }
    if(!kind)continue;
    const lap=weightedIncidentLap(rng,timeline);
    const weatherLap=timeline[Math.max(0,lap-1)]||{state:"SUNNY",red_flag_chance_pct:0};
    const sev=kind==="mechanical"?{label:"low",score:0.2}:severity(rng,kind,weatherLap.state);
    const incident={driver_id:idOf(row?.driver||row),lap,kind,reason,severity:sev.label,severity_score:sev.score,weather_state:weatherLap.state};
    incidents.push(incident);
    if(kind!=="mechanical"){
      const response=responseForIncident(rules,incident,weatherLap,rng);
      const duration=durationFor(response,rng,timeline.length);
      periods.push({type:response,from_lap:lap,to_lap:Math.min(timeline.length,lap+duration-1),cause:"incident",driver_id:incident.driver_id,priority:response==="RED_FLAG"?0:response==="SAFETY_CAR"?1:response==="VSC"?2:3});
    }
  }

  // Extreme weather can force race control action even without a crash.
  for(const row of timeline){
    if(!["HEAVY_RAIN","STORM"].includes(String(row.state)))continue;
    const key=`${row.state}-${row.lap}`;
    const wrng=rngFor(gs,`${year}-${gpId}-rw4.2-weather-control-${key}`);
    const redChance=clamp(num(row.red_flag_chance_pct,0)/100,0,0.35);
    const scChance=clamp(num(row.safety_car_chance_pct,0)/100,0,0.55);
    let type=null;
    if(rules.red_flag&&wrng.chance(redChance))type="RED_FLAG";
    else if(rules.safety_car&&wrng.chance(scChance))type="SAFETY_CAR";
    else if(rules.virtual_safety_car&&wrng.chance(scChance*0.5))type="VSC";
    if(type){
      const duration=durationFor(type,wrng,timeline.length);
      periods.push({type,from_lap:row.lap,to_lap:Math.min(timeline.length,row.lap+duration-1),cause:"weather",priority:type==="RED_FLAG"?0:type==="SAFETY_CAR"?1:2});
      break;
    }
  }

  return {
    version:1,
    rules,
    incidents:incidents.sort((a,b)=>a.lap-b.lap),
    periods:mergePeriods(periods,timeline.length),
    weather_timeline:timeline,
  };
}

export function raceControlAtLap(plan,lap){
  const matches=(plan?.periods||[]).filter((row)=>lap>=Number(row?.from_lap)&&lap<=Number(row?.to_lap));
  if(!matches.length)return {type:"GREEN",from_lap:lap,to_lap:lap,cause:null};
  return matches.slice().sort((a,b)=>Number(a.priority??9)-Number(b.priority??9))[0];
}
export function incidentForDriver(plan,driverId){
  return (plan?.incidents||[]).find((row)=>String(row?.driver_id)===String(driverId))||null;
}
