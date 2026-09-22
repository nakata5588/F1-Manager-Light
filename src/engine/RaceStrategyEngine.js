// src/engine/RaceStrategyEngine.js
// RW4 — era-aware race strategy, tyres, weather and pit-stop simulation.
//
// Historical data is used only to seed/calibrate a new career. Once a value is
// materialised in raceStrategyWorld or raceWeekendState, the Save World is the
// source of truth and this engine will not overwrite it with historical outcomes.

import { rngFor } from "../core/random.js";
import { combinedRacePerformance } from "../domain/driverPerformance.js";
import { driverCondition } from "../domain/driverRating.js";
import { raceEntryTeamForDriver } from "../domain/raceEntry.js";
import { raceControlAtLap } from "./RaceControlEngine.js";
import { raceWeekendWeatherSession } from "./WeekendWeatherEngine.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const idOf=(row)=>String(row?.driver_id??row?.driver?.driver_id??row?.id??"");
const canon=(v)=>String(v??"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();

export const RACE_PACE_MODES=Object.freeze({
  conserve:{id:"conserve",label:"Conserve",lap_delta_s:0.42,wear_mult:0.78,risk_mult:0.88,fatigue_mult:0.72},
  balanced:{id:"balanced",label:"Balanced",lap_delta_s:0,wear_mult:1,risk_mult:1,fatigue_mult:1},
  attack:{id:"attack",label:"Attack",lap_delta_s:-0.38,wear_mult:1.28,risk_mult:1.14,fatigue_mult:1.34},
});

export const PIT_PLANS=Object.freeze({
  no_stop:{id:"no_stop",label:"No planned stop"},
  adaptive:{id:"adaptive",label:"Adaptive"},
  one_stop:{id:"one_stop",label:"Planned one-stop"},
});

export function raceStrategyRulesForYear(yearInput){
  const year=Number(yearInput)||1980;
  if(year<=1981)return {
    era_id:"classic_non_stop",
    label:"Classic non-stop era",
    refuelling_allowed:false,
    mandatory_dry_compounds:1,
    tyre_changes:"optional",
    default_pit_plan:"no_stop",
    undercut_strength:0.15,
    notes:"Race tyre changes are legal but normally reactive. No modern mandatory compound rule is applied.",
  };
  if(year<=1983)return {
    era_id:"early_refuelling",
    label:"Early refuelling strategy era",
    refuelling_allowed:true,
    mandatory_dry_compounds:1,
    tyre_changes:"strategic",
    default_pit_plan:"adaptive",
    undercut_strength:0.55,
    notes:"Mid-race refuelling and deliberate tyre-stop strategies can be used.",
  };
  if(year<=1993)return {
    era_id:"no_refuelling",
    label:"Tyre strategy era",
    refuelling_allowed:false,
    mandatory_dry_compounds:1,
    tyre_changes:"strategic",
    default_pit_plan:"adaptive",
    undercut_strength:0.70,
    notes:"In-race refuelling is unavailable; tyre stops remain strategic.",
  };
  if(year<=2006)return {
    era_id:"refuelling",
    label:"Refuelling era",
    refuelling_allowed:true,
    mandatory_dry_compounds:1,
    tyre_changes:"strategic",
    default_pit_plan:"adaptive",
    undercut_strength:0.82,
    notes:"Fuel load and tyre strategy interact; no modern two-dry-compound obligation is imposed.",
  };
  if(year<=2009)return {
    era_id:"refuelling_two_compounds",
    label:"Refuelling and two-compound era",
    refuelling_allowed:true,
    mandatory_dry_compounds:2,
    tyre_changes:"strategic",
    default_pit_plan:"one_stop",
    undercut_strength:0.90,
    notes:"Dry races require two dry specifications and in-race refuelling is available.",
  };
  return {
    era_id:"modern_no_refuelling",
    label:"Modern no-refuelling era",
    refuelling_allowed:false,
    mandatory_dry_compounds:2,
    tyre_changes:"strategic",
    default_pit_plan:"one_stop",
    undercut_strength:1,
    notes:"Dry races require two dry specifications; in-race refuelling is unavailable.",
  };
}

function teamId(team){return String(team?.team_id??team?.id??"");}
function teamName(team){return String(team?.team_name??team?.name??team?.short_name??teamId(team));}
function genericTyres(year){
  const prefix=`generic_${Number(year)||"era"}`;
  return [
    {tyre_id:`${prefix}_hard`,year_from:year,year_to:year,supplier:"Generic",compound_name:"Hard",category:"dry",grip_index:74,wear_rate:0.015,warmup_time_s:2.8},
    {tyre_id:`${prefix}_soft`,year_from:year,year_to:year,supplier:"Generic",compound_name:"Soft",category:"dry",grip_index:80,wear_rate:0.022,warmup_time_s:2.2},
    {tyre_id:`${prefix}_inter`,year_from:year,year_to:year,supplier:"Generic",compound_name:"Intermediate",category:"intermediate",grip_index:65,wear_rate:0.018,warmup_time_s:3.1},
    {tyre_id:`${prefix}_wet`,year_from:year,year_to:year,supplier:"Generic",compound_name:"Wet",category:"wet",grip_index:55,wear_rate:0.020,warmup_time_s:3.5},
  ];
}
function activeTyres(gs){
  const year=Number(gs?.activeYear);
  if(Array.isArray(gs?.tyres)&&gs.tyres.length)return gs.tyres;
  const source=Array.isArray(gs?.dbTyres)?gs.dbTyres:[];
  if(!source.length)return genericTyres(year);
  const exact=source.filter((row)=>{
    const from=num(row?.year_from,row?.year??-Infinity);
    const to=num(row?.year_to,row?.year??Infinity);
    return !Number.isFinite(year)||(year>=from&&year<=to);
  });
  if(exact.length)return exact;

  // Sparse catalog years are calibration snapshots, not a reason to remove tyres
  // from a career. Carry the nearest prior specification family until a newer
  // catalog snapshot becomes available.
  const priorYears=source
    .map((row)=>num(row?.year_to,row?.year??row?.year_from??NaN))
    .filter((value)=>Number.isFinite(value)&&value<=year);
  if(!priorYears.length)return genericTyres(year);
  const nearest=Math.max(...priorYears);
  return source.filter((row)=>num(row?.year_to,row?.year??row?.year_from??NaN)===nearest);
}
function supplierNames(gs){
  return [...new Set(activeTyres(gs).map((row)=>String(row?.supplier||"").trim()).filter(Boolean))];
}
function stableIndex(value,length){
  if(length<=1)return 0;
  let h=0;
  for(const ch of String(value??""))h=(Math.imul(h,31)+ch.charCodeAt(0))>>>0;
  return h%length;
}
function seededSupplierForTeam(team,year,suppliers){
  if(!suppliers.length)return null;
  if(suppliers.length===1)return suppliers[0];
  const name=canon(teamName(team));
  if(Number(year)===1980){
    if(/ferrari|renault/.test(name)&&suppliers.includes("Michelin"))return "Michelin";
    if(suppliers.includes("Goodyear"))return "Goodyear";
  }
  if(Number(year)===2004){
    if(/ferrari|jordan|minardi|sauber/.test(name)&&suppliers.includes("Bridgestone"))return "Bridgestone";
    if(/bar|mclaren|renault|toyota|williams|jaguar/.test(name)&&suppliers.includes("Michelin"))return "Michelin";
  }
  return suppliers[stableIndex(teamId(team)||name,suppliers.length)];
}
function facilityPitLevel(gs,tid){
  const userTeamId=teamId(gs?.team||{});
  if(String(tid)===userTeamId){
    const override=Number(gs?.hq?.facilityLevels?.pitcrew_training_level);
    if(Number.isFinite(override))return override;
  }
  const year=Number(gs?.activeYear);
  const rows=Array.isArray(gs?.facilities)?gs.facilities:(gs?.dbFacilities||[]);
  const row=(rows||[]).find((r)=>
    String(r?.team_id??r?.team??"")===String(tid)&&
    (!Number.isFinite(Number(r?.year))||Number(r?.year)===year)
  );
  return clamp(num(row?.pitcrew_training_level,5),1,10);
}
function seedPitCrew(gs,tid){
  const year=Number(gs?.activeYear);
  const historical=(gs?.dbPitcrewRoster||[]).find((row)=>
    String(row?.team_id??"")===String(tid)&&Number(row?.year)===year
  );
  if(historical){
    return {
      avg_time_s:clamp(num(historical.avg_time,6.8),2,18),
      consistency:clamp(num(historical.consistency,70)),
      error_rate:clamp(num(historical.error_rate,0.05),0,0.35),
      training_load:clamp(num(historical.training_load,50),0,100),
      source:"career_seed",
    };
  }
  const level=facilityPitLevel(gs,tid);
  return {
    avg_time_s:Number(clamp(8.2-level*0.32,2.2,9).toFixed(2)),
    consistency:Math.round(clamp(48+level*5,40,95)),
    error_rate:Number(clamp(0.12-level*0.012,0.015,0.12).toFixed(3)),
    training_load:50,
    source:"facility_seed",
  };
}

export function ensureRaceStrategyWorld(gs){
  if(!gs)return gs;
  const year=Number(gs?.activeYear)||1980;
  const suppliers=supplierNames(gs);
  const previous=gs?.raceStrategyWorld||{};
  const teamSuppliers={...(previous.teamSuppliers||{})};
  const pitCrews={...(previous.pitCrews||{})};

  for(const team of gs?.teams||[]){
    const tid=teamId(team);
    if(!tid)continue;
    const saved=teamSuppliers[tid];
    if(!saved||!suppliers.includes(saved)){
      teamSuppliers[tid]=seededSupplierForTeam(team,year,suppliers);
    }
    if(!pitCrews[tid])pitCrews[tid]=seedPitCrew(gs,tid);
  }

  return {
    ...gs,
    raceStrategyWorld:{
      version:1,
      created_year:previous.created_year??year,
      ...previous,
      teamSuppliers,
      pitCrews,
    },
  };
}

export function raceTrackProfile(gs,gp={}){
  const trackId=String(gp?.track_id??gs?.raceWeekendState?.track_id??"");
  const year=Number(gs?.activeYear??gp?.year);
  const layouts=Array.isArray(gs?.trackLayoutByYear)&&gs.trackLayoutByYear.length
    ?gs.trackLayoutByYear:(gs?.dbTrackLayoutByYear||[]);
  const layout=(layouts||[]).find((row)=>{
    if(trackId&&String(row?.track_id??row?.circuit_id??"")!==trackId)return false;
    const from=num(row?.year_from,row?.year??-Infinity);
    const to=num(row?.year_to,row?.year??Infinity);
    return (!Number.isFinite(year)||(year>=from&&year<=to));
  })||{};
  const cores=Array.isArray(gs?.coreTracks)&&gs.coreTracks.length?gs.coreTracks:(gs?.dbCoreTracks||[]);
  const core=(cores||[]).find((row)=>String(row?.track_id??row?.id??"")===trackId)||{};
  const lapKm=Math.max(1,num(layout?.lap_length_km,gp?.lap_length_km??core?.lap_length_km??4.5));
  const laps=Math.max(1,Math.round(num(layout?.laps,gp?.laps??(305/lapKm))));
  const pitLoss=Math.max(8,num(layout?.pit_lane_loss_s,gp?.pit_lane_loss_s??core?.pit_lane_loss_s??24));
  const tyreWear=clamp(num(core?.tyre_wear,50),0,100);
  const overtakingDifficulty=clamp(num(core?.overtaking_difficulty,50),0,100);
  return {
    track_id:trackId,
    lap_length_km:Number(lapKm.toFixed(3)),
    laps,
    race_distance_km:Number((lapKm*laps).toFixed(1)),
    pit_lane_loss_s:Number(pitLoss.toFixed(1)),
    tyre_wear:tyreWear,
    overtaking_difficulty:overtakingDifficulty,
    reference_lap_ms:Math.round((lapKm/165)*3600000),
  };
}

function raceDate(gp,gs){
  return String(gp?.race_date??gp?.dateISO??gp?.date??gs?.raceWeekendState?.raceDate??gs?.currentDateISO??"").slice(0,10);
}
function weatherProfile(gs,gp){
  const trackId=String(gp?.track_id??gs?.raceWeekendState?.track_id??"");
  const month=Number(raceDate(gp,gs).slice(5,7));
  const rows=gs?.dbWeatherProfiles||gs?.weatherProfiles||[];
  return rows.find((row)=>String(row?.track_id??"")===trackId&&Number(row?.month)===month)
    ||rows.find((row)=>String(row?.track_id??"")===trackId&&Number.isFinite(Number(row?.rain_chance)))
    ||null;
}
function explicitWeatherState(gp){
  const raw=canon(gp?.weather??gp?.conditions??gp?.condition??gp?.forecast??"");
  if(!raw)return null;
  if(/storm|extreme/.test(raw))return "STORM";
  if(/heavy rain|downpour/.test(raw))return "HEAVY_RAIN";
  if(/light rain|drizzle|shower/.test(raw))return "LIGHT_RAIN";
  if(/wet|rain/.test(raw))return "LIGHT_RAIN";
  if(/wind/.test(raw))return "WINDY";
  if(/cloud|overcast/.test(raw))return "CLOUDY";
  if(/sun|clear|dry/.test(raw))return "SUNNY";
  return null;
}
function weatherStateRisk(gs,state){
  const row=(gs?.dbWeatherStates||gs?.weatherStates||[]).find((r)=>String(r?.id)===String(state));
  if(row)return clamp(num(row?.crash_risk_ppm,1),0.5,4);
  return {SUNNY:1,CLOUDY:1,WINDY:1.2,LIGHT_RAIN:1.6,HEAVY_RAIN:2.4,STORM:3.2}[state]||1;
}
export function buildRaceWeatherSnapshot(gs,gp={},track=raceTrackProfile(gs,gp)){
  const weekendRace=raceWeekendWeatherSession(gs);
  if(weekendRace){
    const pctSegments=Array.isArray(weekendRace.segments)&&weekendRace.segments.length
      ?weekendRace.segments
      :[{from_pct:0,to_pct:1,state:weekendRace.state||"SUNNY"}];
    const segments=pctSegments.map((segment,index)=>{
      const from=Math.max(1,index===0?1:Math.floor(Number(segment.from_pct||0)*track.laps)+1);
      const to=index===pctSegments.length-1
        ?track.laps
        :Math.max(from,Math.floor(Number(segment.to_pct??1)*track.laps));
      return {from_lap:from,to_lap:Math.min(track.laps,to),state:segment.state||weekendRace.state||"SUNNY"};
    });
    return {
      source:"weekend_weather_world",
      state:weekendRace.state||segments[0]?.state||"SUNNY",
      avg_temp_c:num(weekendRace.air_temp_c,22),
      track_temp_c:num(weekendRace.track_temp_c,28),
      rain_chance_pct:num(weekendRace.rain_chance_profile_pct,0),
      storm_chance_pct:num(weekendRace.storm_chance_profile_pct,0),
      wind_profile:weekendRace.wind_profile||"medium",
      wet_race:segments.some((s)=>/RAIN|STORM|WETTING/.test(String(s.state)))||num(weekendRace?.track?.start_wetness,0)>=0.18,
      starting_track_wetness:num(weekendRace?.track?.start_wetness,0),
      starting_grip_index:num(weekendRace?.track?.grip_index,88),
      rubber_level:num(weekendRace?.track?.rubber_level,0),
      segments,
    };
  }

  const year=Number(gs?.activeYear)||Number(gp?.year)||1980;
  const gpId=String(gp?.gp_id??gp?.id??gp?.track_id??"race");
  const rng=rngFor(gs,`${year}-${gpId}-rw4-weather`);
  const profile=weatherProfile(gs,gp);
  const avgTemp=num(profile?.avg_temp,22);
  const rainChance=clamp(num(profile?.rain_chance,18),0,100);
  const stormChance=clamp(num(profile?.storm_chance,3),0,100);
  let state=explicitWeatherState(gp);

  if(!state){
    const roll=rng.next()*100;
    if(roll<stormChance)state="STORM";
    else if(roll<rainChance)state=rng.next()<0.55?"WETTING":"LIGHT_RAIN";
    else if(String(profile?.wind_profile||"").toLowerCase()==="high"&&rng.next()<0.40)state="WINDY";
    else state=rng.next()<0.35?"CLOUDY":"SUNNY";
  }

  let segments=[{from_lap:1,to_lap:track.laps,state}];
  if(state==="WETTING"){
    const change=Math.max(3,Math.round(track.laps*(0.28+rng.next()*0.28)));
    segments=[
      {from_lap:1,to_lap:Math.max(1,change-1),state:"CLOUDY"},
      {from_lap:change,to_lap:track.laps,state:rng.next()<0.22?"HEAVY_RAIN":"LIGHT_RAIN"},
    ];
  }else if(state==="LIGHT_RAIN"&&rng.next()<0.32){
    const change=Math.max(3,Math.round(track.laps*(0.45+rng.next()*0.28)));
    segments=[
      {from_lap:1,to_lap:Math.max(1,change-1),state:"LIGHT_RAIN"},
      {from_lap:change,to_lap:track.laps,state:"DRYING"},
    ];
  }

  const wetRace=segments.some((s)=>/RAIN|STORM/.test(String(s.state)));
  return {
    source:explicitWeatherState(gp)?"event_state":profile?"weather_profile":"era_default",
    state,
    avg_temp_c:avgTemp,
    rain_chance_pct:rainChance,
    storm_chance_pct:stormChance,
    wind_profile:profile?.wind_profile||"medium",
    wet_race:wetRace,
    segments,
  };
}

function stateAtLap(weather,lap){
  return weather?.segments?.find((s)=>lap>=Number(s.from_lap)&&lap<=Number(s.to_lap))?.state||weather?.state||"SUNNY";
}
function weatherCategory(state){
  if(["HEAVY_RAIN","STORM"].includes(String(state)))return "wet";
  if(["LIGHT_RAIN","WETTING"].includes(String(state)))return "intermediate";
  return "dry";
}
function driverTeamId(gs,driver){
  const did=idOf(driver);
  return raceEntryTeamForDriver(gs?.raceEntryState,did)
    ||String(driver?.team_id??driver?.constructor_id??"");
}
function ratingFor(gs,driver){
  const did=idOf(driver);
  return (gs?.driverRatings||[]).find((r)=>String(r?.driver_id??r?.id??"")===did)||{};
}
export function tyresForTeam(gs,tid){
  const world=gs?.raceStrategyWorld||{};
  const supplier=world?.teamSuppliers?.[String(tid)]||null;
  const all=activeTyres(gs);
  const matching=supplier?all.filter((row)=>String(row?.supplier||"")===String(supplier)):[];
  return matching.length?matching:all;
}
function tyreById(options,id){return options.find((row)=>String(row?.tyre_id??row?.id??"")===String(id))||null;}
function tyreId(tyre){return String(tyre?.tyre_id??tyre?.id??"");}
function bestTyreForCategory(options,category,{durable=false,excludeId=null}={}){
  const rows=options.filter((row)=>String(row?.category||"dry")===String(category)&&tyreId(row)!==String(excludeId??""));
  const pool=rows.length?rows:options.filter((row)=>tyreId(row)!==String(excludeId??""));
  if(!pool.length)return null;
  return pool.slice().sort((a,b)=>{
    if(durable)return num(a?.wear_rate,0.02)-num(b?.wear_rate,0.02)||num(b?.grip_index,70)-num(a?.grip_index,70);
    return num(b?.grip_index,70)-num(a?.grip_index,70)||num(a?.wear_rate,0.02)-num(b?.wear_rate,0.02);
  })[0];
}
function defaultStrategy(gs,entry,weather,track,rules){
  const did=String(entry?.driver_id??"");
  const tid=String(entry?.team_id??"");
  const options=tyresForTeam(gs,tid);
  const category=weatherCategory(stateAtLap(weather,1));
  const rating=(gs?.driverRatings||[]).find((r)=>String(r?.driver_id??"")===did)||{};
  const tyreMgmt=num(rating?.tire_management,60);
  const playerTeam=teamId(gs?.team||{});
  const isPlayer=tid===playerTeam;
  const durable=category==="dry"&&(isPlayer||track.tyre_wear>=55||tyreMgmt<65);
  const start=bestTyreForCategory(options,category,{durable});
  const alternate=category==="dry"
    ?bestTyreForCategory(options,"dry",{durable:!durable,excludeId:tyreId(start)})
    :bestTyreForCategory(options,category,{excludeId:tyreId(start)})||start;

  let pitPlan=rules.default_pit_plan;
  if(rules.mandatory_dry_compounds>1&&category==="dry")pitPlan="one_stop";
  else if(rules.era_id==="classic_non_stop"){
    const startWear=num(start?.wear_rate,0.02);
    pitPlan=startWear>=0.020&&track.tyre_wear>=60?"adaptive":"no_stop";
  }

  let pace="balanced";
  if(!isPlayer){
    if(tyreMgmt>=78&&num(rating?.race_intelligence,60)>=72)pace="attack";
    else if(tyreMgmt<52)pace="conserve";
  }
  const planned=Math.max(2,Math.min(track.laps-2,Math.round(track.laps*0.52)));
  return {
    driver_id:did,
    team_id:tid,
    source:isPlayer?"player_default":"ai",
    start_tyre_id:tyreId(start),
    next_tyre_id:tyreId(alternate||start),
    pace_mode:pace,
    pit_plan:pitPlan,
    planned_stop_lap:pitPlan==="one_stop"?planned:null,
    fuel_plan:rules.refuelling_allowed?"balanced":"not_applicable",
  };
}

export function createRaceStrategyState(gs,{gp={},raceEntryState=gs?.raceEntryState}={}){
  const worldGs=ensureRaceStrategyWorld(gs);
  const rules=raceStrategyRulesForYear(worldGs?.activeYear??gp?.year);
  const track=raceTrackProfile(worldGs,gp);
  const weather=buildRaceWeatherSnapshot(worldGs,gp,track);
  const raceSession=raceWeekendWeatherSession(worldGs);
  const playerForecast=raceSession
    ?worldGs?.raceWeekendState?.weekend_weather?.forecast?.[String(raceSession.id)]
    :null;
  const forecastWeather=playerForecast?{
    source:"team_forecast",
    state:playerForecast.predicted_state||"SUNNY",
    avg_temp_c:num(playerForecast.air_temp_c,weather.avg_temp_c),
    rain_chance_pct:num(playerForecast.rain_chance_pct,0),
    wet_race:/RAIN|STORM|WETTING|DRYING/.test(String(playerForecast.predicted_state||"")),
    segments:[{from_lap:1,to_lap:track.laps,state:playerForecast.predicted_state||"SUNNY"}],
  }:weather;
  const playerTeam=teamId(worldGs?.team||{});
  const selections={};
  for(const entry of raceEntryState?.entries||[]){
    if(entry?.status&&entry.status!=="confirmed")continue;
    if(!entry?.driver_id)continue;
    const planningWeather=String(entry?.team_id??"")===playerTeam?forecastWeather:weather;
    selections[String(entry.driver_id)]=defaultStrategy(worldGs,entry,planningWeather,track,rules);
  }
  return {
    gameState:worldGs,
    state:{
      version:1,
      status:"planning",
      rules_snapshot:rules,
      track_snapshot:track,
      weather_snapshot:weather,
      selections,
      race_summary:null,
    },
  };
}

export function refreshPlayerRaceStrategyFromForecast(gs){
  const weekend=gs?.raceWeekendState;
  const existing=weekend?.race_strategy;
  if(!weekend||!existing)return gs;
  const raceSession=raceWeekendWeatherSession(gs);
  const forecast=raceSession?weekend?.weekend_weather?.forecast?.[String(raceSession.id)]:null;
  if(!forecast)return gs;
  const track=existing.track_snapshot||raceTrackProfile(gs,{});
  const rules=existing.rules_snapshot||raceStrategyRulesForYear(gs?.activeYear);
  const planningWeather={
    source:"team_forecast",
    state:forecast.predicted_state||"SUNNY",
    avg_temp_c:num(forecast.air_temp_c,existing?.weather_snapshot?.avg_temp_c??22),
    rain_chance_pct:num(forecast.rain_chance_pct,0),
    wet_race:/RAIN|STORM|WETTING|DRYING/.test(String(forecast.predicted_state||"")),
    segments:[{from_lap:1,to_lap:track.laps,state:forecast.predicted_state||"SUNNY"}],
  };
  const playerTeam=teamId(gs?.team||{});
  const selections={...(existing.selections||{})};
  for(const entry of gs?.raceEntryState?.entries||[]){
    if(String(entry?.team_id??"")!==playerTeam||!entry?.driver_id)continue;
    selections[String(entry.driver_id)]=defaultStrategy(gs,entry,planningWeather,track,rules);
  }
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      race_strategy:{...existing,selections,forecast_revision_used:Number(weekend?.weekend_weather?.forecast_revision||0)},
    },
  };
}

export function setRaceStrategySelection(gs,{driverId,patch={}}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||!["grid_ready","race"].includes(String(weekend.phase))||!driverId)return gs;
  if(Number(weekend?.live_race?.current_lap||0)>0)return gs;
  const existing=weekend?.race_strategy;
  if(!existing)return gs;
  const did=String(driverId);
  const current=existing?.selections?.[did];
  if(!current)return gs;
  const tid=String(current.team_id||"");
  const options=tyresForTeam(gs,tid);
  const validTyreIds=new Set(options.map(tyreId));
  const rules=existing.rules_snapshot||raceStrategyRulesForYear(gs?.activeYear);
  const track=existing.track_snapshot||raceTrackProfile(gs,{});
  const next={...current};

  if(patch.start_tyre_id&&validTyreIds.has(String(patch.start_tyre_id)))next.start_tyre_id=String(patch.start_tyre_id);
  if(patch.next_tyre_id&&validTyreIds.has(String(patch.next_tyre_id)))next.next_tyre_id=String(patch.next_tyre_id);
  if(Object.hasOwn(RACE_PACE_MODES,String(patch.pace_mode)))next.pace_mode=String(patch.pace_mode);
  if(Object.hasOwn(PIT_PLANS,String(patch.pit_plan)))next.pit_plan=String(patch.pit_plan);
  if(patch.planned_stop_lap!==undefined){
    const lap=Math.round(num(patch.planned_stop_lap,Math.round(track.laps/2)));
    next.planned_stop_lap=Math.max(2,Math.min(track.laps-2,lap));
  }
  if(rules.mandatory_dry_compounds>1&&weatherCategory(stateAtLap(existing.weather_snapshot,1))==="dry"&&next.pit_plan==="no_stop"){
    next.pit_plan="one_stop";
  }
  if(rules.refuelling_allowed&&["light_start","balanced","heavy_start"].includes(String(patch.fuel_plan))){
    next.fuel_plan=String(patch.fuel_plan);
  }
  if(!rules.refuelling_allowed)next.fuel_plan="not_applicable";

  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      race_strategy:{
        ...existing,
        selections:{...(existing.selections||{}),[did]:next},
      },
    },
  };
}

export function tyreConditionEffects(conditionInput){
  const condition=clamp(conditionInput,0,100);
  if(condition>=70)return {pace_penalty_s:0,grip_multiplier:1,risk_multiplier:1,band:"healthy"};
  if(condition>=45){
    const severity=(70-condition)/25;
    return {
      pace_penalty_s:Number((severity*0.42).toFixed(3)),
      grip_multiplier:Number((1-severity*0.035).toFixed(4)),
      risk_multiplier:Number((1+severity*0.06).toFixed(4)),
      band:"used",
    };
  }
  if(condition>=25){
    const severity=(45-condition)/20;
    return {
      pace_penalty_s:Number((0.42+severity*1.05).toFixed(3)),
      grip_multiplier:Number((0.965-severity*0.075).toFixed(4)),
      risk_multiplier:Number((1.06+severity*0.22).toFixed(4)),
      band:"worn",
    };
  }
  const severity=(25-condition)/25;
  return {
    pace_penalty_s:Number((1.47+severity*3.3).toFixed(3)),
    grip_multiplier:Number((0.89-severity*0.16).toFixed(4)),
    risk_multiplier:Number((1.28+severity*0.72).toFixed(4)),
    band:condition<12?"critical":"severe",
  };
}
function projectedWearPerLap(tyre,{trackWearMult=1,pace=RACE_PACE_MODES.balanced,wearDriverMult=1,hotWearMult=1}={}){
  return num(tyre?.wear_rate,0.018)*100*0.72*trackWearMult*num(pace?.wear_mult,1)*wearDriverMult*hotWearMult;
}
function estimateStayOutCost({condition,wearPerLap,remaining,window=6}={}){
  const laps=Math.max(1,Math.min(Number(remaining)||1,Number(window)||6));
  let total=0;
  let projected=clamp(condition,0,100);
  for(let i=0;i<laps;i++){
    total+=tyreConditionEffects(projected).pace_penalty_s;
    projected=clamp(projected-(Number(wearPerLap)||0),0,100);
  }
  return {seconds:Number(total.toFixed(3)),condition_end:Number(projected.toFixed(1)),laps};
}
function effectivePitLoss(track,control,crew){
  const multiplier=control?.type==="SAFETY_CAR"?0.58:control?.type==="VSC"?0.76:control?.type==="RED_FLAG"?0.35:1;
  return num(track?.pit_lane_loss_s,24)*multiplier+num(crew?.avg_time_s,6.8);
}
function tyreWeatherPenalty(tyre,state){
  const want=weatherCategory(state);
  const have=String(tyre?.category||"dry");
  if(want===have)return 0;
  if(want==="dry"&&have==="intermediate")return 2.3;
  if(want==="dry"&&have==="wet")return 4.5;
  if(want==="intermediate"&&have==="dry")return 3.8;
  if(want==="intermediate"&&have==="wet")return 1.3;
  if(want==="wet"&&have==="intermediate")return 2.1;
  if(want==="wet"&&have==="dry")return 8.2;
  return 1.8;
}
function optimalTyreTemp(tyre){
  const category=String(tyre?.category||"dry");
  return category==="wet"?68:category==="intermediate"?78:96;
}
export function pitCrewEffectiveProfile(crew={}){
  const load=clamp(num(crew?.training_load,50),0,100);
  const over=Math.max(0,load-60);
  return {
    ...crew,
    training_load:load,
    avg_time_s:Number(clamp(num(crew?.avg_time_s,6.8)+over*0.005,2,18).toFixed(2)),
    consistency:Number(clamp(num(crew?.consistency,70)-over*0.15,35,100).toFixed(1)),
    error_rate:Number(clamp(num(crew?.error_rate,0.05)+over*0.0004,0.005,0.35).toFixed(3)),
    training_penalty:over>0?{
      avg_time_s:Number((over*0.005).toFixed(2)),
      consistency:Number((over*0.15).toFixed(1)),
      error_rate:Number((over*0.0004).toFixed(3)),
    }:null,
  };
}
function pitCrew(gs,tid){
  return pitCrewEffectiveProfile(gs?.raceStrategyWorld?.pitCrews?.[String(tid)]||seedPitCrew(gs,tid));
}
function strategyForGridRow(gs,row,strategyState){
  const did=idOf(row?.driver||row);
  const tid=driverTeamId(gs,row?.driver||row);
  const saved=strategyState?.selections?.[did];
  if(saved)return saved;
  return defaultStrategy(gs,{driver_id:did,team_id:tid},strategyState.weather_snapshot,strategyState.track_snapshot,strategyState.rules_snapshot);
}
function choosePitTyre(options,current,strategy,state,reason){
  const category=weatherCategory(state);
  if(reason==="weather")return bestTyreForCategory(options,category,{durable:category==="dry"});
  const requested=tyreById(options,strategy.next_tyre_id);
  if(requested&&tyreId(requested)!==tyreId(current))return requested;
  return bestTyreForCategory(options,category,{durable:strategy.pace_mode!=="attack",excludeId:tyreId(current)})||current;
}
function temperatureForLap(tyre,weatherState,avgTemp,pace,stintLap){
  const optimum=optimalTyreTemp(tyre);
  const trackTemp=avgTemp+(weatherState==="SUNNY"?12:weatherState==="CLOUDY"?5:/RAIN|STORM/.test(weatherState)?0:7);
  const paceDelta=pace==="attack"?5:pace==="conserve"?-4:0;
  const warmup=Math.min(1,Math.max(0,stintLap/Math.max(1,num(tyre?.warmup_time_s,2.5))));
  const coldLoss=(1-warmup)*18;
  return optimum+(trackTemp-28)*0.28+paceDelta-coldLoss;
}
function raceRiskFromWeather(gs,weather,track){
  let weighted=0,total=0;
  for(const segment of weather?.segments||[]){
    const laps=Math.max(1,Number(segment.to_lap)-Number(segment.from_lap)+1);
    weighted+=weatherStateRisk(gs,segment.state)*laps;
    total+=laps;
  }
  return total?weighted/total:1;
}
function stintRecord(tyre,start,end,condition,tempSum,tempCount){
  return {
    tyre_id:tyreId(tyre),
    supplier:tyre?.supplier||null,
    compound:tyre?.compound_name||tyreId(tyre),
    category:tyre?.category||"dry",
    start_lap:start,
    end_lap:end,
    laps:Math.max(0,end-start+1),
    condition_end:Number(clamp(condition).toFixed(1)),
    avg_temperature_c:Number((tempCount?tempSum/tempCount:optimalTyreTemp(tyre)).toFixed(1)),
  };
}

export function simulateManagedRace(gs,{gp={},grid=[],ratings=gs?.driverRatings||[],roundIndex=0}={}){
  let working=ensureRaceStrategyWorld(gs);
  let strategyState=working?.raceWeekendState?.race_strategy||null;
  if(!strategyState){
    const built=createRaceStrategyState(working,{gp,raceEntryState:working?.raceEntryState});
    working=built.gameState;
    strategyState=built.state;
    if(working?.raceWeekendState){
      working={...working,raceWeekendState:{...working.raceWeekendState,race_strategy:strategyState}};
    }
  }

  const rules=strategyState.rules_snapshot||raceStrategyRulesForYear(working?.activeYear);
  const track=strategyState.track_snapshot||raceTrackProfile(working,gp);
  const weather=strategyState.weather_snapshot||buildRaceWeatherSnapshot(working,gp,track);
  const gpId=String(gp?.gp_id??gp?.id??gp?.track_id??`round_${Number(roundIndex)+1}`);
  const userTeam=teamId(working?.team||{});
  const raceRows=[];

  for(const [gridIndex,gridRow] of (grid||[]).entries()){
    const driver=gridRow?.driver||gridRow;
    const did=idOf(driver);
    const tid=driverTeamId(working,driver);
    const rating=(ratings||[]).find((r)=>String(r?.driver_id??r?.id??"")===did)||ratingFor(working,driver);
    const options=tyresForTeam(working,tid);
    let strategy={...strategyForGridRow(working,gridRow,strategyState)};
    const liveCommands=(strategyState?.live_commands?.[did]||[])
      .slice()
      .sort((a,b)=>Number(a?.effective_lap||0)-Number(b?.effective_lap||0));
    const rng=rngFor(working,`${working?.activeYear||"season"}-${gpId}-rw4-race-${did}`);
    let tyre=tyreById(options,strategy.start_tyre_id)||bestTyreForCategory(options,weatherCategory(stateAtLap(weather,1)),{durable:true});
    if(!tyre)continue;

    const basePerf=combinedRacePerformance({gs:working,driver,rating,teamId:tid,wet:weather.wet_race});
    const management=clamp(num(rating?.tire_management,60));
    const fatigue=clamp(num(driverCondition(working,did)?.fatigue,0));
    const wearDriverMult=clamp(1+(60-management)*0.004+(Math.max(0,fatigue-50))*0.003,0.74,1.32);
    const trackWearMult=0.62+(track.tyre_wear/100)*0.72;
    const crew=pitCrew(working,tid);
    const plannedBase=Math.max(2,Math.min(track.laps-2,Math.round(num(strategy.planned_stop_lap,track.laps*0.52))));
    let plannedLap=plannedBase;
    let plannedReason="planned";
    if(rules.undercut_strength>=0.45&&strategy.pit_plan==="one_stop"){
      if(strategy.pace_mode==="attack"&&rng.chance(0.42*rules.undercut_strength)){
        plannedLap=Math.max(2,plannedBase-1); plannedReason="undercut";
      }else if(strategy.pace_mode==="conserve"&&rng.chance(0.38*rules.undercut_strength)){
        plannedLap=Math.min(track.laps-2,plannedBase+1); plannedReason="overcut";
      }
    }

    let totalMs=0;
    let bestLapMs=Infinity;
    let condition=100;
    let lowestCondition=100;
    let stintStart=1;
    let stintLap=0;
    let tempSum=0,tempCount=0;
    let hasStopped=false;
    let hasUsedWet=false;
    const usedDry=new Set();
    const stints=[];
    const pits=[];
    const lapTimes=[];
    let refuelled=false;
    let activePaceMode=strategy.pace_mode;
    let liveCommandIndex=0;
    let accumulatedFatigueLoad=0;
    let maxTyreRiskMultiplier=1;
    const strategyDecisions=[];

    for(let lap=1;lap<=track.laps;lap++){
      const commandsThisLap=[];
      while(liveCommandIndex<liveCommands.length&&Number(liveCommands[liveCommandIndex]?.effective_lap||0)<=lap){
        commandsThisLap.push(liveCommands[liveCommandIndex]);
        liveCommandIndex+=1;
      }
      for(const command of commandsThisLap){
        if(command?.type==="pace"&&Object.hasOwn(RACE_PACE_MODES,String(command?.pace_mode))){
          activePaceMode=String(command.pace_mode);
        }
      }
      const pace=RACE_PACE_MODES[activePaceMode]||RACE_PACE_MODES.balanced;
      const forcedPit=commandsThisLap.find((command)=>command?.type==="pit");
      const control=raceControlAtLap(strategyState?.race_control_plan,lap);
      const state=stateAtLap(weather,lap);
      const trackWeather=strategyState?.race_control_plan?.weather_timeline?.[Math.max(0,lap-1)]||null;
      const wetness=Number(trackWeather?.track_wetness);
      const tyreState=Number.isFinite(wetness)
        ?wetness>=0.70?"HEAVY_RAIN":wetness>=0.22?"LIGHT_RAIN":"SUNNY"
        :state;
      const category=weatherCategory(tyreState);
      if(String(tyre?.category||"dry")==="dry")usedDry.add(tyreId(tyre));
      const remaining=track.laps-lap+1;
      const mismatch=tyreWeatherPenalty(tyre,tyreState);
      const projectedTemp=temperatureForLap(tyre,state,weather.avg_temp_c,activePaceMode,Math.max(1,stintLap+1));
      const projectedOptimum=optimalTyreTemp(tyre);
      const projectedHotWear=projectedTemp>projectedOptimum+8?1+Math.min(0.25,(projectedTemp-projectedOptimum-8)*0.018):1;
      const currentWearPerLap=projectedWearPerLap(tyre,{trackWearMult,pace,wearDriverMult,hotWearMult:projectedHotWear});
      const stayOut=estimateStayOutCost({condition,wearPerLap:currentWearPerLap,remaining,window:Math.min(8,remaining)});
      const pitLossEstimate=effectivePitLoss(track,control,crew);
      const currentEffects=tyreConditionEffects(condition);
      const intelligence=clamp(num(rating?.race_intelligence,60));
      const isAi=tid!==userTeam;
      const criticalTyre=condition<=14&&remaining>2;
      const severeTyre=condition<=24&&remaining>3;
      const projectedCritical=stayOut.condition_end<=12&&remaining>4;
      const neutralised=["SAFETY_CAR","VSC"].includes(control.type);
      const cheapStop=neutralised&&pitLossEstimate<=track.pit_lane_loss_s*0.88+num(crew.avg_time_s,6.8);
      const strategicStopValue=isAi&&strategy.pit_plan!=="no_stop"&&remaining>5&&(
        (condition<48&&stayOut.seconds>Math.max(1.2,pitLossEstimate*0.20))||
        (condition<38&&projectedCritical)||
        (condition<30&&currentEffects.pace_penalty_s>0.9)
      );
      let stopReason=null;

      if(lap>1){
        if(forcedPit&&remaining>1)stopReason="player_call";
        else if(mismatch>=3.5&&remaining>3)stopReason="weather";
        else if(isAi&&cheapStop&&!hasStopped&&remaining>7&&condition<78&&rng.chance(0.50+intelligence*0.004))stopReason="neutralisation_window";
        else if(strategy.pit_plan==="one_stop"&&!hasStopped&&lap===plannedLap)stopReason=plannedReason;
        else if(isAi&&strategicStopValue&&rng.chance(0.44+intelligence*0.0045))stopReason="degradation_value";
        else if(strategy.pit_plan==="adaptive"&&condition<34&&remaining>6)stopReason="degradation";
        else if(criticalTyre||severeTyre&&projectedCritical)stopReason="tyre_safety";
        if(!hasStopped&&rules.mandatory_dry_compounds>1&&!hasUsedWet&&category==="dry"&&lap===plannedLap)stopReason=stopReason||"mandatory_compound";
        if(rules.refuelling_allowed&&strategy.fuel_plan==="light_start"&&!refuelled&&lap>=Math.round(track.laps*0.54))stopReason=stopReason||"fuel";
      }
      if(stopReason){
        strategyDecisions.push({
          lap,
          action:"pit",
          reason:stopReason,
          tyre_condition:Number(condition.toFixed(1)),
          estimated_pit_loss_s:Number(pitLossEstimate.toFixed(2)),
          projected_stay_out_loss_s:stayOut.seconds,
          projected_condition:stayOut.condition_end,
          pace_mode:activePaceMode,
        });
      }

      if(stopReason){
        stints.push(stintRecord(tyre,stintStart,lap-1,condition,tempSum,tempCount));
        const commandedTyre=forcedPit?.tyre_id?tyreById(options,forcedPit.tyre_id):null;
        const nextTyre=commandedTyre||choosePitTyre(options,tyre,strategy,tyreState,stopReason);
        const refuel=rules.refuelling_allowed&&!refuelled&&(strategy.fuel_plan==="light_start"||stopReason==="fuel");
        const error=rng.chance(clamp(num(crew.error_rate,0.05),0,0.35));
        const errorDelay=error?3+rng.next()*8:0;
        const fuelDelay=refuel?(Number(working?.activeYear)<=1983?9:6):0;
        const stationary=Math.max(num(crew.avg_time_s,6.8),fuelDelay)+errorDelay;
        const pitLaneMultiplier=control.type==="SAFETY_CAR"?0.58:control.type==="VSC"?0.76:control.type==="RED_FLAG"?0.35:1;
        const loss=track.pit_lane_loss_s*pitLaneMultiplier+stationary;
        totalMs+=Math.round(loss*1000);
        pits.push({
          lap,
          reason:stopReason,
          tyre_from:tyreId(tyre),
          tyre_to:tyreId(nextTyre),
          stationary_s:Number(stationary.toFixed(2)),
          total_loss_s:Number(loss.toFixed(2)),
          error,
          refuelled:refuel,
          race_control:control.type,
        });
        if(refuel)refuelled=true;
        tyre=nextTyre||tyre;
        condition=100;
        stintStart=lap;
        stintLap=0;
        tempSum=0;tempCount=0;
        hasStopped=true;
      }

      if(String(tyre?.category||"dry")!=="dry")hasUsedWet=true;
      stintLap+=1;
      const tyreTemp=temperatureForLap(tyre,state,weather.avg_temp_c,activePaceMode,stintLap);
      tempSum+=tyreTemp; tempCount+=1;
      const optimum=optimalTyreTemp(tyre);
      const tempDelta=Math.abs(tyreTemp-optimum);
      const tempLapPenalty=Math.max(0,tempDelta-6)*0.035;
      const hotWearMult=tyreTemp>optimum+8?1+Math.min(0.25,(tyreTemp-optimum-8)*0.018):1;
      const wearPerLap=num(tyre?.wear_rate,0.018)*100*0.72*trackWearMult*pace.wear_mult*wearDriverMult*hotWearMult;
      const grip=num(tyre?.grip_index,75);
      const gripDelta=(78-grip)*0.035;
      const wearPenalty=condition>=55?0:(55-condition)*0.052+(condition<20?(20-condition)*0.11:0);
      const warmupPenalty=stintLap<=2?num(tyre?.warmup_time_s,2.5)*(stintLap===1?0.65:0.24):0;
      const perfPenalty=Math.max(-1.4,(100-basePerf)*0.105);
      const fuelDelta=rules.refuelling_allowed
        ?strategy.fuel_plan==="light_start"&&!refuelled?-0.28:strategy.fuel_plan==="heavy_start"?0.22:0
        :0;
      const gridTraffic=lap===1?(gridIndex)*0.055*(0.75+track.overtaking_difficulty/100):0;
      const controlDelta=control.type==="SAFETY_CAR"?Math.max(12,18-gridIndex*0.30):control.type==="VSC"?7.5:control.type==="RED_FLAG"?26:control.type==="LOCAL_YELLOW"?1.2:0;
      const noise=(rng.next()-0.5)*(control.type==="GREEN"?0.62:0.20);
      const lapSeconds=(track.reference_lap_ms/1000)+perfPenalty+gripDelta+wearPenalty+warmupPenalty+
        tyreWeatherPenalty(tyre,tyreState)+tempLapPenalty+pace.lap_delta_s+fuelDelta+gridTraffic+controlDelta+noise;
      const lapMs=Math.max(30000,Math.round(lapSeconds*1000));
      lapTimes.push(lapMs);
      totalMs+=lapMs;
      bestLapMs=Math.min(bestLapMs,lapMs);
      condition=clamp(condition-wearPerLap,0,100);
      lowestCondition=Math.min(lowestCondition,condition);
    }

    stints.push(stintRecord(tyre,stintStart,track.laps,condition,tempSum,tempCount));
    const weatherRisk=raceRiskFromWeather(working,weather,track);
    const wornTyreRisk=lowestCondition<20?1+(20-lowestCondition)*0.015:1;
    const finalPace=RACE_PACE_MODES[activePaceMode]||RACE_PACE_MODES.balanced;
    const incidentRisk=clamp(weatherRisk*finalPace.risk_mult*wornTyreRisk,0.7,4);
    const mechanicalRisk=clamp(finalPace.risk_mult*(strategy.fuel_plan==="light_start"?1.025:1),0.8,1.3);

    raceRows.push({
      pos:0,
      driver,
      performance:basePerf,
      total_time_ms:totalMs,
      gap_to_winner_ms:0,
      gap_to_previous_ms:0,
      best_lap_ms:Number.isFinite(bestLapMs)?bestLapMs:null,
      fastest_lap:false,
      race_laps:track.laps,
      pit_stops:pits,
      stints,
      tyre_supplier:tyre?.supplier||working?.raceStrategyWorld?.teamSuppliers?.[tid]||null,
      start_tyre_id:strategy.start_tyre_id,
      finish_tyre_id:tyreId(tyre),
      tyre_condition_finish:Number(condition.toFixed(1)),
      lowest_tyre_condition:Number(lowestCondition.toFixed(1)),
      incident_risk_multiplier:Number(incidentRisk.toFixed(3)),
      mechanical_risk_multiplier:Number(mechanicalRisk.toFixed(3)),
      lap_times_ms:lapTimes.slice(),
      strategy_summary:{
        source:tid===userTeam?"player":"ai",
        pace_mode:activePaceMode,
        starting_pace_mode:strategy.pace_mode,
        live_command_count:liveCommands.length,
        pit_plan:strategy.pit_plan,
        fuel_plan:strategy.fuel_plan,
        pit_count:pits.length,
        pit_laps:pits.map((p)=>p.lap),
        used_tyres:stints.map((s)=>s.compound),
        used_dry_compounds:[...usedDry],
        refuelled,
      },
    });
  }

  raceRows.sort((a,b)=>Number(a.total_time_ms)-Number(b.total_time_ms)||String(idOf(a.driver)).localeCompare(String(idOf(b.driver))));
  let previousGap=0;
  const winner=Number(raceRows[0]?.total_time_ms||0);
  for(let i=0;i<raceRows.length;i++){
    const row=raceRows[i];
    const gap=Math.max(0,Number(row.total_time_ms)-winner);
    row.pos=i+1;
    row.gap_to_winner_ms=gap;
    row.gap_to_previous_ms=i===0?0:Math.max(0,gap-previousGap);
    previousGap=gap;
  }
  if(raceRows.length){
    let fastest=0;
    for(let i=1;i<raceRows.length;i++){
      if(num(raceRows[i].best_lap_ms,Infinity)<num(raceRows[fastest].best_lap_ms,Infinity))fastest=i;
    }
    raceRows[fastest].fastest_lap=true;
  }

  return {
    gameState:working,
    race:raceRows,
    weather,
    track,
    rules,
    strategyState,
    summary:{
      rules,
      weather,
      track,
      strategies:Object.fromEntries(raceRows.map((row)=>[idOf(row.driver),row.strategy_summary])),
      race_control:strategyState?.race_control_plan||null,
    },
  };
}
