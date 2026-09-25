// src/engine/RaceControlEngine.js
// RW4.2 — era-aware race control, live incidents and track-weather evolution.

import { rngFor } from "../core/random.js";
import { driverCondition } from "../domain/driverRating.js";
import { carReliabilityProfile, mechanicalFailureChance, selectMechanicalFailureReason } from "../domain/carReliability.js";
import { raceEntryTeamForDriver } from "../domain/raceEntry.js";
import { evolveTrackSurface, initialiseTrackSurface, rainIntensityForState } from "./TrackSurfaceEngine.js";
import { evolveTrackEnvironment, initialiseTrackEnvironment } from "./TrackEnvironmentEngine.js";
import { evaluateRaceability } from "./RaceabilityEngine.js";
import { aquaplaningOutcome, aquaplaningRiskForDriver, standingWaterForConditions } from "./StandingWaterEngine.js";

const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const idOf=(row)=>String(row?.driver_id??row?.driver?.driver_id??row?.id??"");

function pointOrdinal(lap,sector=3){
  const l=Math.max(1,Number(lap)||1);
  const s=Math.max(1,Math.min(3,Number(sector)||1));
  return (l-1)*3+s;
}
function periodStartOrdinal(period){
  return pointOrdinal(period?.from_lap,period?.from_sector??1);
}
function periodEndOrdinal(period){
  return pointOrdinal(period?.to_lap,period?.to_sector??3);
}
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
function stableHash(value){
  let hash=2166136261;
  for(const ch of String(value??"")){
    hash^=ch.charCodeAt(0);
    hash=Math.imul(hash,16777619)>>>0;
  }
  return hash>>>0;
}
function rainTargetForLap(state,lap,seed="weather"){
  const weatherState=String(state||"SUNNY").toUpperCase();
  const base=rainIntensityForState(weatherState);
  if(base<=0.001)return 0;
  const amplitude={
    DRIZZLE_DRYING:0.025,
    WETTING:0.075,
    LIGHT_RAIN:0.115,
    HEAVY_RAIN:0.10,
    STORM:0.055,
  }[weatherState]??0.045;
  const phase=(stableHash(seed+":"+weatherState)%6283)/1000;
  const l=Math.max(1,Number(lap)||1);
  const wave=Math.sin(l*0.41+phase)*0.68+Math.sin(l*0.17+phase*1.73)*0.32;
  return clamp(base+amplitude*wave,0,1);
}
function rainIntensityAtLap(weather,lap,previousIntensity=null,seed="weather"){
  const state=weatherStateAtLap(weather,lap);
  const target=rainTargetForLap(state,lap,seed);
  if(Number(lap)<=1||previousIntensity===null||previousIntensity===undefined)return target;
  const previousState=weatherStateAtLap(weather,Math.max(1,Number(lap)-1));
  const previousTarget=rainTargetForLap(previousState,Math.max(1,Number(lap)-1),seed);
  const prev=clamp(num(previousIntensity,previousTarget),0,1);

  // Weather labels describe broad regimes, not fixed rainfall percentages.
  // Intensity moves toward a slowly varying target inside the regime, so a
  // prolonged shower can strengthen/ease naturally instead of parking at 46%.
  const stateChanged=String(state)!==String(previousState);
  const response=stateChanged
    ?target>previousTarget?0.30:0.42
    :target>prev?0.25:0.30;
  const next=prev+(target-prev)*response;
  if(target<=0.001&&next<0.015)return 0;
  return clamp(next,0,1);
}
export function buildTrackWeatherTimeline(gs,weather,track){
  const out=[];
  const firstState=weatherStateAtLap(weather,1);
  const confirmedCars=(gs?.raceEntryState?.entries||[]).filter((row)=>row?.status==="confirmed"&&row?.driver_id).length;
  const carsOnTrack=confirmedCars||Math.max(12,(gs?.teams||[]).length*2||20);
  const drainage=clamp(num(track?.drainage_rating??track?.drainage,0.5),0,1);
  const windProfile=weather?.wind_profile||"medium";
  const baseAirTemp=num(weather?.starting_air_temp_c,weather?.avg_temp_c??22);
  let surface=initialiseTrackSurface({
    state:firstState,
    startingWetness:Number.isFinite(Number(weather?.starting_track_wetness))
      ?clamp(Number(weather.starting_track_wetness),0,1)
      :rainIntensityForState(firstState)*0.55,
    rubberLevel:clamp(num(weather?.starting_rubber_level??weather?.rubber_level,12),0,100),
  });
  let environment=initialiseTrackEnvironment({
    state:firstState,
    baseAirTempC:baseAirTemp,
    airTempC:num(weather?.starting_air_temp_c,weather?.avg_temp_c??baseAirTemp),
    trackTempC:num(weather?.starting_track_temp_c,weather?.track_temp_c??NaN),
    wetness:surface.track_wetness,
    rainIntensity:surface.rain_intensity,
    carsOnTrack,
    windProfile,
    sessionProgress:0,
  });
  const laps=Math.max(1,Number(track?.laps)||1);
  const weatherSeed=[
    gs?.activeYear,
    gs?.raceWeekendState?.gp_id,
    track?.track_id,
    weather?.source,
    weather?.state,
  ].join(":");
  let previousIntensity=null;
  for(let lap=1;lap<=laps;lap++){
    const state=weatherStateAtLap(weather,lap);
    const beforeWetness=surface.track_wetness;
    const progress=laps<=1?1:(lap-1)/(laps-1);
    const intensityInput=rainIntensityAtLap(weather,lap,previousIntensity,weatherSeed);
    surface=evolveTrackSurface(surface,{
      state,
      rainIntensity:intensityInput,
      carsOnTrack,
      trackTempC:environment.track_temp_c,
      windProfile,
      drainage,
    });
    const intensity=surface.rain_intensity;
    previousIntensity=intensity;
    environment=evolveTrackEnvironment(environment,{
      state,
      baseAirTempC:baseAirTemp,
      wetness:surface.track_wetness,
      rainIntensity:intensity,
      carsOnTrack,
      windProfile,
      sessionProgress:progress,
    });
    const row=weatherRow(gs,state);
    const wetnessDelta=Number((surface.track_wetness-beforeWetness).toFixed(3));
    const standingWater=standingWaterForConditions({
      wetness:surface.track_wetness,
      rainIntensity:intensity,
      drainage,
      wetnessDelta,
    });
    const raceability=evaluateRaceability({
      wetness:surface.track_wetness,
      sprayIndex:environment.spray_index,
      visibilityIndex:environment.visibility_index,
      gripIndex:surface.grip_index,
      rainIntensity:intensity,
      wetnessDelta,
      standingWaterIndex:standingWater.index,
    });
    out.push({
      lap,state,
      rain_intensity:Number(intensity.toFixed(2)),
      rain_band:surface.rain_band,
      track_wetness:Number(surface.track_wetness.toFixed(3)),
      wetness_delta:wetnessDelta,
      rubber_level:Number(surface.rubber_level.toFixed(1)),
      grip_index:Number(surface.grip_index.toFixed(1)),
      air_temp_c:Number(environment.air_temp_c.toFixed(1)),
      track_temp_c:Number(environment.track_temp_c.toFixed(1)),
      spray_index:Number(environment.spray_index.toFixed(3)),
      spray_band:environment.spray_band,
      visibility_index:Number(environment.visibility_index.toFixed(1)),
      visibility_band:environment.visibility_band,
      standing_water_index:standingWater.index,
      standing_water_band:standingWater.band,
      standing_water_factors:standingWater.factors,
      raceability_index:raceability.index,
      raceability_hazard_index:raceability.hazard_index,
      raceability_band:raceability.band,
      raceability_factors:raceability.factors,
      raceability_dominant_factors:raceability.dominant_factors,
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
function teamIdForDriver(gs,did){
  return raceEntryTeamForDriver(gs?.raceEntryState,did)
    ||String((gs?.drivers||[]).find((driver)=>idOf(driver)===String(did))?.team_id||"");
}

export function accidentRetirementChance(gs,row){
  const year=Number(gs?.activeYear)||1980;
  const did=idOf(row?.driver||row);
  const rating=ratingFor(gs,did);
  const crashLik=clamp(num(rating?.crash_likelihood,35)/100,0.05,0.95);
  const fatigue=num(driverCondition(gs,did)?.fatigue,0);
  const fatigueRisk=Math.max(0,fatigue-35)*0.0007;
  const model=activeYearRow(gs?.accidentModel??gs?.dbAccidentModel,year);
  const damageProb=clamp(num(model?.damage_DNF_prob??model?.damage_dnf_prob,0.10),0.04,0.25);
  const weatherMult=clamp(num(row?.incident_risk_multiplier,1),0.6,4);
  const base=year===1980
    ?clamp(0.15+(crashLik-0.35)*0.10+fatigueRisk,0.08,0.30)
    :clamp(0.012+crashLik*damageProb*0.32+fatigueRisk,0.01,0.16);
  return clamp(base*weatherMult,0.005,0.55);
}

export function mechanicalRetirementChance(gs,row){
  const did=idOf(row?.driver||row);
  const tid=teamIdForDriver(gs,did);
  const profile=carReliabilityProfile(gs,tid,did);
  return mechanicalFailureChance(profile,{
    session:"race",
    riskMultiplier:num(row?.mechanical_risk_multiplier,1),
    fatigue:num(driverCondition(gs,did)?.fatigue,0),
  });
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
function aquaplaningIncidentForDriver(gs,row,timeline,track,{year=1980,gpId="race"}={}){
  const did=idOf(row?.driver||row);
  if(!did||!Array.isArray(timeline)||!timeline.length)return null;
  const rating=ratingFor(gs,did);
  const tyreStates=Array.isArray(row?.tyre_state_by_lap)?row.tyre_state_by_lap:[];
  const lapTimes=Array.isArray(row?.lap_times_ms)?row.lap_times_ms:[];
  const referenceLap=Math.max(1,num(track?.reference_lap_ms,0));

  for(const weatherLap of timeline){
    const lap=Math.max(1,Number(weatherLap?.lap)||1);
    if(num(weatherLap?.standing_water_index,0)<12)continue;
    const tyreState=tyreStates.find((state)=>Number(state?.lap)===lap)||tyreStates[Math.max(0,lap-1)]||{};
    const lapMs=num(lapTimes[lap-1],0);
    const paceMode=String(tyreState?.pace_mode||row?.strategy_summary?.pace_mode||"balanced");
    const speedRatio=referenceLap>1&&lapMs>0
      ?clamp(referenceLap/lapMs,0.55,1.15)
      :paceMode==="attack"?0.95:paceMode==="conserve"?0.76:0.85;
    const risk=aquaplaningRiskForDriver({
      standingWaterIndex:weatherLap.standing_water_index,
      tyreCategory:tyreState?.category||"wet",
      wetSkill:num(rating?.wet_skill,60),
      adaptability:num(rating?.adaptability,60),
      raceIntelligence:num(rating?.race_intelligence,60),
      paceMode,
      speedRatio,
      tyreCondition:num(tyreState?.condition,100),
    });
    if(risk.probability<=0)continue;

    const irng=rngFor(gs,`${year}-${gpId}-rw5.2d4.2-aquaplaning-${did}-${lap}`);
    if(!irng.chance(risk.probability))continue;

    const outcome=aquaplaningOutcome({
      riskIndex:risk.risk_index,
      outcomeRoll:irng.next(),
      retirementRoll:irng.next(),
    });
    const sector=1+Math.floor(irng.next()*3);
    const kind=outcome.outcome==="accident"
      ?"aquaplaning_accident"
      :outcome.outcome==="loss_of_control"
        ?"aquaplaning_loss_of_control"
        :"aquaplaning_spin";
    const reason=outcome.outcome==="accident"
      ?"Aquaplaning accident"
      :outcome.outcome==="loss_of_control"
        ?"Aquaplaning loss of control"
        :"Aquaplaning spin";
    const severityScore=outcome.severity==="critical"
      ?Math.max(0.94,risk.risk_index/100)
      :outcome.severity==="high"
        ?Math.max(0.78,risk.risk_index/100)
        :outcome.severity==="medium"
          ?Math.max(0.50,risk.risk_index/100)
          :Math.max(0.15,risk.risk_index/100);

    return {
      driver_id:did,
      other_driver_id:null,
      lap,
      sector,
      kind,
      reason,
      severity:outcome.severity,
      severity_score:Number(clamp(severityScore,0,1).toFixed(3)),
      weather_state:weatherLap.state,
      retirement:outcome.retirement,
      time_loss_s:outcome.time_loss_s,
      aquaplaning:true,
      aquaplaning_risk_index:risk.risk_index,
      aquaplaning_probability:risk.probability,
      aquaplaning_factors:risk.factors,
      standing_water_index:weatherLap.standing_water_index,
      standing_water_band:weatherLap.standing_water_band,
      tyre_category:String(tyreState?.category||"wet"),
      tyre_condition:Number(num(tyreState?.condition,100).toFixed(1)),
      pace_mode:paceMode,
      speed_ratio:Number(speedRatio.toFixed(3)),
    };
  }
  return null;
}

function severity(rng,type,state){
  const weatherBoost=["HEAVY_RAIN","STORM"].includes(String(state))?0.12:0;
  const collisionBoost=type==="collision"?0.08:0;
  const score=clamp(0.08+rng.next()*0.84+weatherBoost+collisionBoost,0.05,1);
  return {score:Number(score.toFixed(3)),label:score>=0.94?"critical":score>=0.78?"high":score>=0.50?"medium":"low"};
}
function responseForIncident(rules,incident,weatherLap,rng){
  const severity=String(incident?.severity||"medium");
  const weatherRed=clamp(num(weatherLap.red_flag_chance_pct,0)/100,0,0.35);
  const eraRedBoost=!rules.safety_car
    ?severity==="critical"?0.34:severity==="high"?0.10:0
    :severity==="critical"?0.16:severity==="high"?0.03:0;
  if(
    rules.red_flag&&
    (["high","critical"].includes(severity)||weatherLap.state==="STORM")&&
    rng.chance(clamp(weatherRed+eraRedBoost,0,0.55))
  ){
    return "RED_FLAG";
  }
  if(rules.safety_car&&["high","critical"].includes(severity))return "SAFETY_CAR";
  if(rules.virtual_safety_car&&severity==="medium"&&rng.chance(0.55))return "VSC";
  if(rules.safety_car&&severity==="medium"&&rng.chance(0.48))return "SAFETY_CAR";
  return "LOCAL_YELLOW";
}
function durationFor(response,rng,laps){
  if(response==="RED_FLAG")return 1;
  if(response==="SAFETY_CAR")return 2+Math.floor(rng.next()*3);
  if(response==="VSC")return 1+Math.floor(rng.next()*2);
  return 1;
}
function mergePeriods(periods,totalLaps){
  const sorted=periods.slice().sort((a,b)=>periodStartOrdinal(a)-periodStartOrdinal(b)||a.priority-b.priority);
  const out=[];
  for(const period of sorted){
    const p={
      ...period,
      from_sector:Math.max(1,Math.min(3,Number(period?.from_sector)||1)),
      to_lap:Math.min(totalLaps,Number(period?.to_lap)||Number(period?.from_lap)||1),
      to_sector:Math.max(1,Math.min(3,Number(period?.to_sector)||3)),
    };
    const last=out.at(-1);
    if(last&&periodStartOrdinal(p)<=periodEndOrdinal(last)&&p.type===last.type){
      if(periodEndOrdinal(p)>periodEndOrdinal(last)){
        last.to_lap=p.to_lap;
        last.to_sector=p.to_sector;
      }
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

  for(const [raceIndex,row] of (race||[]).entries()){
    const roll=rng.next();
    const mech=mechanicalRetirementChance(gs,row);
    const accident=accidentRetirementChance(gs,row);
    let kind=null,reason=null;
    if(roll<mech){
      kind="mechanical";
      const driverId=idOf(row?.driver||row);
      const reliability=carReliabilityProfile(gs,teamIdForDriver(gs,driverId),driverId);
      reason=selectMechanicalFailureReason(reliability,rng.next()).reason;
    }else if(roll<mech+accident){
      kind=rng.next()<0.72?"accident":"collision";
      reason=kind==="accident"?"Accident":"Collision";
    }
    if(!kind)continue;
    const lap=weightedIncidentLap(rng,timeline);
    const sector=1+Math.floor(rng.next()*3);
    const weatherLap=timeline[Math.max(0,lap-1)]||{state:"SUNNY",red_flag_chance_pct:0};
    const sev=kind==="mechanical"?{label:"low",score:0.2}:severity(rng,kind,weatherLap.state);
    const driverId=idOf(row?.driver||row);
    const reliability=kind==="mechanical"
      ?carReliabilityProfile(gs,teamIdForDriver(gs,driverId),driverId)
      :null;
    let otherDriverId=null;
    if(kind==="collision"){
      const neighbourIndexes=[raceIndex-1,raceIndex+1].filter((index)=>index>=0&&index<(race||[]).length);
      if(neighbourIndexes.length){
        const pickIndex=neighbourIndexes.length===1?neighbourIndexes[0]:neighbourIndexes[Math.floor(rng.next()*neighbourIndexes.length)];
        otherDriverId=idOf((race||[])[pickIndex]?.driver||(race||[])[pickIndex])||null;
        if(otherDriverId===driverId)otherDriverId=null;
      }
    }
    const incident={
      driver_id:driverId,
      other_driver_id:otherDriverId,
      lap,
      sector,
      kind,
      reason,
      severity:sev.label,
      severity_score:sev.score,
      weather_state:weatherLap.state,
      reliability_pct:reliability?.reliability_pct??null,
      reliability_source:reliability?.source??null,
    };
    incidents.push(incident);
    if(kind!=="mechanical"){
      const response=responseForIncident(rules,incident,weatherLap,rng);
      const duration=durationFor(response,rng,timeline.length);
      periods.push({
        type:response,
        from_lap:lap,
        from_sector:sector,
        to_lap:Math.min(timeline.length,lap+duration-1),
        to_sector:3,
        cause:"incident",
        driver_id:incident.driver_id,
        priority:response==="RED_FLAG"?0:response==="SAFETY_CAR"?1:response==="VSC"?2:3,
      });
    }
  }

  // Standing-water incidents are generated separately from the baseline crash
  // model. A driver can spin or lose control without retiring; an aquaplaning
  // accident can become a retirement. D4.3 will later decide weather-driven
  // race-control policy from the composite raceability signal.
  for(const row of race||[]){
    const aq=aquaplaningIncidentForDriver(gs,row,timeline,track||{},{year,gpId});
    if(!aq)continue;
    incidents.push(aq);
    const weatherLap=timeline[Math.max(0,Number(aq.lap)-1)]||{state:"SUNNY",red_flag_chance_pct:0};
    const arng=rngFor(gs,`${year}-${gpId}-rw5.2d4.2-aquaplaning-control-${aq.driver_id}-${aq.lap}`);
    const response=responseForIncident(rules,aq,weatherLap,arng);
    const duration=durationFor(response,arng,timeline.length);
    periods.push({
      type:response,
      from_lap:aq.lap,
      from_sector:aq.sector,
      to_lap:Math.min(timeline.length,aq.lap+duration-1),
      to_sector:3,
      cause:"aquaplaning",
      driver_id:aq.driver_id,
      priority:response==="RED_FLAG"?0:response==="SAFETY_CAR"?1:response==="VSC"?2:3,
    });
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
      periods.push({
        type,
        from_lap:row.lap,
        from_sector:1,
        to_lap:Math.min(timeline.length,row.lap+duration-1),
        to_sector:3,
        cause:"weather",
        priority:type==="RED_FLAG"?0:type==="SAFETY_CAR"?1:2,
      });
      break;
    }
  }

  return {
    version:3,
    environment_model:"rw5.2d3.1",
    raceability_model:"rw5.2d4.1",
    standing_water_model:"rw5.2d4.2",
    aquaplaning_model:"rw5.2d4.2",
    rules,
    incidents:incidents.sort((a,b)=>a.lap-b.lap||Number(a?.sector??1)-Number(b?.sector??1)),
    periods:mergePeriods(periods,timeline.length),
    weather_timeline:timeline,
  };
}

export function raceControlAtPoint(plan,lap,sector=3){
  const ordinal=pointOrdinal(lap,sector);
  const matches=(plan?.periods||[]).filter((row)=>ordinal>=periodStartOrdinal(row)&&ordinal<=periodEndOrdinal(row));
  if(!matches.length)return {type:"GREEN",from_lap:lap,from_sector:sector,to_lap:lap,to_sector:sector,cause:null};
  return matches.slice().sort((a,b)=>Number(a.priority??9)-Number(b.priority??9))[0];
}
export function raceControlAtLap(plan,lap){
  // Lap-level simulation keeps a conservative whole-lap view for backwards compatibility.
  const matches=(plan?.periods||[]).filter((row)=>lap>=Number(row?.from_lap)&&lap<=Number(row?.to_lap));
  if(!matches.length)return {type:"GREEN",from_lap:lap,to_lap:lap,cause:null};
  return matches.slice().sort((a,b)=>Number(a.priority??9)-Number(b.priority??9))[0];
}
export function incidentsForDriver(plan,driverId){
  return (plan?.incidents||[]).filter((row)=>String(row?.driver_id)===String(driverId));
}
export function incidentForDriver(plan,driverId){
  return incidentsForDriver(plan,driverId).find((row)=>row?.retirement!==false)||null;
}

export function mergeRaceControlHistory(previous,fresh,currentLap,currentSector=3){
  if(!previous)return fresh;
  if(!fresh)return previous;
  const ordinal=Number(currentLap)>0?pointOrdinal(currentLap,currentSector):0;
  const incidentOrdinal=(row)=>pointOrdinal(row?.lap,row?.sector??1);
  const historicalIncidents=(previous.incidents||[]).filter((row)=>incidentOrdinal(row)<=ordinal);
  const historicalRetirementIds=new Set(
    historicalIncidents
      .filter((row)=>row?.retirement!==false)
      .map((row)=>String(row.driver_id))
  );
  const historicalNonRetirementIds=new Set(
    historicalIncidents
      .filter((row)=>row?.retirement===false)
      .map((row)=>String(row.driver_id))
  );
  const futureIncidents=(fresh.incidents||[]).filter((row)=>{
    if(incidentOrdinal(row)<=ordinal)return false;
    const did=String(row?.driver_id);
    return row?.retirement===false
      ?!historicalRetirementIds.has(did)&&!historicalNonRetirementIds.has(did)
      :!historicalRetirementIds.has(did);
  });
  const historicalPeriods=(previous.periods||[]).filter((row)=>periodStartOrdinal(row)<=ordinal);
  const futurePeriods=(fresh.periods||[]).filter((row)=>periodStartOrdinal(row)>ordinal);
  return {
    ...fresh,
    incidents:[...historicalIncidents,...futureIncidents].sort((a,b)=>incidentOrdinal(a)-incidentOrdinal(b)),
    periods:mergePeriods([...historicalPeriods,...futurePeriods],fresh.weather_timeline?.length||previous.weather_timeline?.length||999),
  };
}
