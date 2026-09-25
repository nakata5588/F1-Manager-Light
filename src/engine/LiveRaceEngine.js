// src/engine/LiveRaceEngine.js
import { simulateManagedRace, tyresForTeam, RACE_PACE_MODES, tyreConditionEffects } from "./RaceStrategyEngine.js";
import { createRaceControlPlan, incidentForDriver, incidentsForDriver, mergeRaceControlHistory, raceControlAtLap, raceControlAtPoint } from "./RaceControlEngine.js";
import { raceForecastForTeam } from "./WeekendWeatherEngine.js";
import { healthOutcomeProbabilities } from "./InjuryEngine.js";
import { completeRedFlagRestart, createRedFlagSuspension, legacyRedFlagLifecycle, prepareRedFlagRestart } from "./RedFlagLifecycleEngine.js";
import { applyAutomaticRedFlagWork } from "./RedFlagWorkEngine.js";
import { rngFor } from "../core/random.js";
import { teamOrderComplianceProfile } from "../domain/driverRelationshipConsequences.js";

const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const idOf=(row)=>String(row?.driver_id??row?.driver?.driver_id??row?.id??"");
function pointOrdinal(lap,sector=3){
  const l=Math.max(1,Number(lap)||1);
  const s=Math.max(1,Math.min(3,Number(sector)||1));
  return (l-1)*3+s;
}
function incidentOrdinal(incident){
  return pointOrdinal(incident?.lap,incident?.sector??1);
}
function nonRetirementIncidentLossMs(plan,driverId,{throughOrdinal=Infinity,lap=null}={}){
  return incidentsForDriver(plan,driverId)
    .filter((incident)=>incident?.retirement===false)
    .filter((incident)=>incidentOrdinal(incident)<=throughOrdinal)
    .filter((incident)=>lap===null||Number(incident?.lap)===Number(lap))
    .reduce((sum,incident)=>sum+Math.max(0,num(incident?.time_loss_s,0))*1000,0);
}
function livePointOrdinal(live){
  const lap=Number(live?.current_lap)||0;
  if(lap<=0)return 0;
  return pointOrdinal(lap,Number(live?.current_sector)||3);
}
function pointFromOrdinal(ordinal,totalLaps){
  const max=Math.max(1,Number(totalLaps)||1)*3;
  const value=Math.max(1,Math.min(max,Math.round(Number(ordinal)||1)));
  return {lap:Math.floor((value-1)/3)+1,sector:((value-1)%3)+1,ordinal:value};
}

function driverById(gs,id){return (gs?.drivers||[]).find((d)=>String(d?.driver_id??d?.id??"")===String(id))||null;}
function driverDisplayName(gs,id){
  const driver=driverById(gs,id);
  return driver?.display_name||driver?.name||[driver?.first_name,driver?.last_name].filter(Boolean).join(" ")||String(id||"Driver");
}
function teamForDriver(gs,did){
  const entry=(gs?.raceEntryState?.entries||[]).find((row)=>String(row?.driver_id??"")===String(did));
  return String(entry?.team_id??driverById(gs,did)?.team_id??"");
}
function controlLabel(type){
  const key=String(type||"GREEN").toUpperCase();
  return {
    GREEN:"Green flag",
    LOCAL_YELLOW:"Yellow flag",
    SAFETY_CAR:"Safety Car",
    VSC:"Virtual Safety Car",
    RED_FLAG:"Red flag",
  }[key]||key.replaceAll("_"," ").toLowerCase();
}
function articleFor(word){
  return /^[aeiou]/i.test(String(word||"").trim())?"an":"a";
}
function incidentNoun(incident){
  const kind=String(incident?.kind||"").toLowerCase();
  const reason=String(incident?.reason||"").toLowerCase();
  if(kind.includes("aquaplaning_spin"))return "aquaplaning spin";
  if(kind.includes("aquaplaning_loss_of_control"))return "aquaplaning loss of control";
  if(kind.includes("aquaplaning_accident"))return "aquaplaning accident";
  if(kind==="collision"||reason.includes("collision"))return "collision";
  if(kind==="accident"||reason.includes("accident"))return "accident";
  return "incident";
}
function severityAdjective(severity){
  return {
    low:"minor",
    medium:"significant",
    high:"heavy",
    critical:"serious",
  }[String(severity||"").toLowerCase()]||"significant";
}
export function formatRaceIncidentMessage({controlType=null,driverName="Driver",incident={},medicalConcern=null}={}){
  const kind=String(incident?.kind||"").toLowerCase();
  const reason=String(incident?.reason||incident?.kind||"incident").trim();
  const prefix=controlType?controlLabel(controlType)+" — ":"";
  if(kind==="mechanical"){
    const lowerReason=reason.toLowerCase();
    return `${prefix}${driverName} stops with ${articleFor(lowerReason)} ${lowerReason} problem.`;
  }
  if(kind.startsWith("aquaplaning_")){
    const loss=Number(incident?.time_loss_s)||0;
    const suffix=incident?.retirement===false&&loss>0?` Loses about ${loss.toFixed(1)}s.`:"";
    if(kind==="aquaplaning_spin")return `${prefix}${driverName} aquaplanes and spins.${suffix}`;
    if(kind==="aquaplaning_loss_of_control")return `${prefix}${driverName} aquaplanes and loses control.${suffix}`;
    if(kind==="aquaplaning_accident")return `${prefix}${driverName} aquaplanes into an accident.${suffix}`;
  }
  const noun=incidentNoun(incident);
  const severity=String(incident?.severity||"medium").toLowerCase();
  const medicalSuffix=medicalConcern===true
    ?" Might be injured."
    :medicalConcern===false
      ?" Seems to be OK."
      :"";
  if(severity==="critical"){
    return `${prefix}Serious ${noun} involving ${driverName}.${medicalSuffix}`;
  }
  return `${prefix}${driverName} involved in a ${severityAdjective(severity)} ${noun}.${medicalSuffix}`;
}
function incidentMedicalStatus(gs,incident){
  const kind=String(incident?.kind||incident?.reason||"").toLowerCase();
  if(!/accident|collision/.test(kind))return {medicalConcern:null,injuryProbability:null};
  if(gs?.settings?.gameplay?.enableInjuryRandomEvents===false){
    return {medicalConcern:false,injuryProbability:0};
  }
  const probabilities=healthOutcomeProbabilities(gs,{
    incident_severity:incident?.severity,
    incident_severity_score:incident?.severity_score,
  },{year:Number(gs?.activeYear)});
  const severity=String(probabilities?.incidentSeverity||incident?.severity||"medium").toLowerCase();
  const injuryProbability=Number(probabilities?.injuryProbability||0);
  return {
    medicalConcern:["high","critical"].includes(severity)||injuryProbability>=0.08,
    injuryProbability:Number(injuryProbability.toFixed(4)),
  };
}
function formatWeatherControlMessage(type,state){
  const weather=String(state||"extreme weather").replaceAll("_"," ").toLowerCase();
  return `${controlLabel(type)} — ${weather.charAt(0).toUpperCase()+weather.slice(1)} conditions.`;
}
function incidentForControlPeriod(plan,period){
  const incidents=Array.isArray(plan?.incidents)?plan.incidents:[];
  const driverId=String(period?.driver_id??"");
  if(driverId){
    const direct=incidents.find((incident)=>
      String(incident?.driver_id??"")===driverId&&
      Number(incident?.lap)===Number(period?.from_lap)
    );
    if(direct)return direct;
  }
  return incidents.find((incident)=>
    Number(incident?.lap)===Number(period?.from_lap)&&
    Number(incident?.sector??1)===Number(period?.from_sector??1)
  )||null;
}
function pushUniqueEvent(events,event){
  const key=String(event?.event_key||"");
  if(key&&events.some((row)=>String(row?.event_key||"")===key))return;
  events.push(event);
}
function weatherBandRank(band){
  return {NONE:0,DRIZZLE:1,LIGHT:2,MODERATE:3,HEAVY:4,EXTREME:5}[String(band||"NONE").toUpperCase()]??0;
}
function weatherBandLabel(band){
  return String(band||"rain").replaceAll("_"," ").toLowerCase();
}
function appendWeatherReports(events,timeline,fromLap,toLap){
  if(!Array.isArray(timeline)||!timeline.length)return;
  const start=Math.max(1,Number(fromLap)||1);
  const end=Math.max(start,Number(toLap)||start);
  let lastReportLap=(events||[])
    .filter((row)=>row?.type==="weather_report")
    .map((row)=>Number(row?.lap)||0)
    .sort((a,b)=>b-a)[0]||-99;

  for(let lap=start;lap<=end;lap+=1){
    const current=timeline[lap-1];
    const previous=lap>1?timeline[lap-2]:null;
    if(!current||!previous)continue;
    const prevIntensity=Number(previous?.rain_intensity)||0;
    const intensity=Number(current?.rain_intensity)||0;
    const prevBand=String(previous?.rain_band||"NONE");
    const band=String(current?.rain_band||"NONE");
    const prevWet=Number(previous?.track_wetness)||0;
    const wet=Number(current?.track_wetness)||0;
    const prevVisibility=Number(previous?.visibility_index??100);
    const visibility=Number(current?.visibility_index??100);

    let kind=null,message=null,urgent=false;
    if(prevIntensity<0.04&&intensity>=0.04){
      kind="rain_started";message="Rain has started.";urgent=true;
    }else if(prevIntensity>=0.04&&intensity<0.04){
      kind="rain_stopped";message="The rain has stopped.";urgent=true;
    }else if(weatherBandRank(band)>weatherBandRank(prevBand)&&intensity-prevIntensity>=0.035){
      kind="rain_rising";message=`Rain intensity is rising — ${weatherBandLabel(band)} rain now.`;
    }else if(weatherBandRank(band)<weatherBandRank(prevBand)&&prevIntensity-intensity>=0.035){
      kind="rain_easing";message=`Rain is slowing down — ${weatherBandLabel(band)} rain now.`;
    }else if(intensity>=0.18&&intensity-prevIntensity>=0.025){
      kind="rain_rising";message=`Rain intensity is rising — ${Math.round(intensity*100)}% now.`;
    }else if(prevIntensity>=0.18&&prevIntensity-intensity>=0.025){
      kind="rain_easing";message=`Rain is slowing down — ${Math.round(intensity*100)}% now.`;
    }else if(prevWet<0.65&&wet>=0.65){
      kind="standing_water";message="Standing water is building on the circuit.";
    }else if(prevVisibility>=70&&visibility<70){
      kind="visibility";message="Visibility is deteriorating in the spray.";
    }else if(prevWet>=0.20&&wet<0.20&&intensity<0.08){
      kind="drying_track";message="The racing line is drying quickly.";
    }
    if(!kind)continue;
    if(!urgent&&lap-lastReportLap<3)continue;
    pushUniqueEvent(events,{
      event_key:`weather_report:${kind}:${lap}`,
      lap,
      sector:1,
      type:"weather_report",
      report_kind:kind,
      weather_state:current.state,
      rain_intensity:Number(intensity.toFixed(2)),
      rain_band:band,
      track_wetness:Number(wet.toFixed(3)),
      visibility_index:Number(visibility.toFixed(1)),
      track_temp_c:Number(current?.track_temp_c),
      message,
    });
    lastReportLap=lap;
  }
}
function paceInstruction(mode){
  return {
    attack:"push",
    conserve:"conserve tyres",
    balanced:"maintain balanced pace",
  }[String(mode||"balanced")]||String(mode||"balanced").replaceAll("_"," ");
}
function tyreDisplayName(gs,driverId,tyreId){
  const teamId=teamForDriver(gs,driverId);
  const tyre=tyresForTeam(gs,teamId).find((row)=>String(row?.tyre_id??row?.id??"")===String(tyreId??""));
  return tyre?.compound_name||tyre?.name||String(tyreId||"tyre");
}
function desiredTyreCategoryForState(weatherState){
  const state=String(weatherState||"SUNNY").toUpperCase();
  if(["HEAVY_RAIN","STORM"].includes(state))return "wet";
  if(["LIGHT_RAIN","WETTING"].includes(state))return "intermediate";
  return "dry";
}
function tyreWeatherFeedback(driverName,tyreState){
  const have=String(tyreState?.category||"dry");
  const wetness=Number(tyreState?.track_wetness);
  const wetnessDelta=Number(tyreState?.wetness_delta);
  const intensity=Number(tyreState?.rain_intensity);
  const target=String(tyreState?.crossover_target||"");
  const drying=Number.isFinite(wetnessDelta)&&wetnessDelta<-0.002&&(!Number.isFinite(intensity)||intensity<0.16);
  const gettingWetter=Number.isFinite(wetnessDelta)&&wetnessDelta>0.002;
  if(Number.isFinite(wetness)){
    if(have==="dry"&&wetness>=0.36)return `${driverName}: "I'm really struggling for grip — it's getting too wet for slicks."`;
    if(have==="dry"&&(target==="intermediate"||wetness>=0.20||gettingWetter&&wetness>=0.16))return `${driverName}: "It's getting slippery. Intermediates are becoming an option."`;
    if(have==="intermediate"&&wetness>=0.78)return `${driverName}: "There's too much standing water for the intermediates."`;
    if(have==="intermediate"&&(target==="dry"||drying&&wetness<=0.16))return `${driverName}: "The track is drying — the intermediates are overheating."`;
    if(have==="wet"&&(target==="intermediate"||drying&&wetness<=0.58))return `${driverName}: "The wets are starting to overheat; intermediates may be quicker now."`;
    return null;
  }
  const want=desiredTyreCategoryForState(tyreState?.weather_state);
  if(have===want)return null;
  if(have==="dry"&&want==="intermediate")return `${driverName}: "It's still too slippery for slicks."`;
  if(have==="dry"&&want==="wet")return `${driverName}: "I'm really struggling for grip — it's too wet for slicks."`;
  if(have==="intermediate"&&want==="wet")return `${driverName}: "There's too much standing water for the intermediates."`;
  if(have==="intermediate"&&want==="dry")return `${driverName}: "The track is drying — the intermediates are overheating."`;
  if(have==="wet"&&want==="dry")return `${driverName}: "The track is too dry for the wets; they're overheating."`;
  if(have==="wet"&&want==="intermediate")return `${driverName}: "The wets are starting to overheat on this track."`;
  return `${driverName}: "These tyres don't feel right for the conditions."`;
}
function pitLossEstimate(gs,strategyState,driverId,lap,plan,{observedLap=null}={}){
  const teamId=teamForDriver(gs,driverId);
  const track=strategyState?.track_snapshot||{};
  const crew=gs?.raceStrategyWorld?.pitCrews?.[String(teamId)]||{};
  // Never use a future neutralisation generated by the hidden race simulation
  // to improve a player-facing pit estimate. Future stops assume green-flag
  // pit loss; a stop on the current observed lap may use the visible control.
  const canUseObservedControl=observedLap==null||Number(lap)<=Number(observedLap);
  const control=canUseObservedControl?raceControlAtLap(plan,lap):{type:"GREEN"};
  const controlMult=control.type==="SAFETY_CAR"?0.58:control.type==="VSC"?0.76:control.type==="RED_FLAG"?0.35:1;
  const lane=Math.max(0,num(track?.pit_lane_loss_s,24))*controlMult;
  const stationary=Math.max(2,num(crew?.avg_time_s,6.8));
  return Number((lane+stationary).toFixed(2));
}
function gridForWeekend(gs){
  const rows=gs?.raceWeekendState?.startingGrid?.rows||gs?.raceWeekendState?.grid||[];
  return rows.map((row,index)=>({
    pos:Number(row?.grid??row?.position??index+1),
    driver:driverById(gs,row?.driver_id),
    performance:Number(row?.qualifying_performance??row?.performance??0),
    lap_time_ms:row?.best_time_ms??row?.qualifying_time_ms??null,
    qualifying_position:Number(row?.qualifying_position??row?.position??index+1),
    penalty_places:Number(row?.penalty_places??0),
  })).filter((row)=>row.driver);
}
function cumulativeAtLap(row,lap){
  return (row?.lap_times_ms||[]).slice(0,Math.max(0,lap)).reduce((sum,v)=>sum+num(v),0)
    +(row?.pit_stops||[]).filter((stop)=>Number(stop?.lap)<=lap).reduce((sum,stop)=>sum+num(stop?.total_loss_s)*1000,0);
}
function tyreStateAtLap(row,lap){
  const observed=(row?.tyre_state_by_lap||[]).find((state)=>Number(state?.lap)===Number(lap));
  if(observed){
    return {
      tyre_id:observed?.tyre_id||null,
      compound:observed?.compound||null,
      category:observed?.category||null,
      condition:Number(num(observed?.condition,100).toFixed(1)),
      temperature_c:Number(num(observed?.temperature_c,0).toFixed(1)),
      age_laps:Math.max(1,Number(observed?.age_laps)||1),
      stint_number:Math.max(1,Number(observed?.stint_number)||1),
      stint_start_lap:Math.max(1,Number(observed?.stint_start_lap)||1),
      source:"observed_lap_snapshot",
    };
  }

  // Backwards-compatible fallback for saves created before RW4.10.
  const stints=row?.stints||[];
  const stintIndex=stints.findIndex((s)=>lap>=Number(s?.start_lap)&&lap<=Number(s?.end_lap));
  const index=stintIndex>=0?stintIndex:Math.max(0,stints.length-1);
  const stint=stints[index];
  if(!stint)return {tyre_id:row?.start_tyre_id||null,compound:null,condition:null,temperature_c:null,age_laps:0,stint_number:1,source:"legacy_fallback"};
  const stintLaps=Math.max(1,Number(stint?.laps)||1);
  const age=Math.max(1,lap-Number(stint?.start_lap)+1);
  const progress=Math.max(0,Math.min(1,age/stintLaps));
  const end=num(stint?.condition_end,100);
  return {
    tyre_id:stint?.tyre_id||null,
    compound:stint?.compound||null,
    category:stint?.category||null,
    condition:Number((100-(100-end)*progress).toFixed(1)),
    temperature_c:Number(num(stint?.avg_temperature_c,0).toFixed(1)),
    age_laps:age,
    stint_number:index+1,
    stint_start_lap:Number(stint?.start_lap)||1,
    source:"legacy_fallback",
  };
}
function stableHash(value){
  let hash=2166136261;
  for(const ch of String(value??"")){
    hash^=ch.charCodeAt(0);
    hash=Math.imul(hash,16777619)>>>0;
  }
  return hash>>>0;
}
function sectorTimesForLap(lapMs,driverId,lap){
  const total=Number(lapMs);
  if(!Number.isFinite(total)||total<=0)return {sector_1_ms:null,sector_2_ms:null,sector_3_ms:null};
  const hash=stableHash(driverId+"-"+lap);
  const jitter1=((hash&1023)/1023-0.5)*0.026;
  const jitter2=(((hash>>>10)&1023)/1023-0.5)*0.026;
  const share1=0.327+jitter1;
  const share2=0.337+jitter2;
  const s1=Math.max(1,Math.round(total*share1));
  const s2=Math.max(1,Math.round(total*share2));
  const s3=Math.max(1,total-s1-s2);
  return {sector_1_ms:s1,sector_2_ms:s2,sector_3_ms:s3};
}
function cumulativeAtPoint(row,lap,sector=3){
  const l=Math.max(1,Number(lap)||1);
  const s=Math.max(1,Math.min(3,Number(sector)||1));
  if(s===3)return cumulativeAtLap(row,l);
  const completed=Math.max(0,l-1);
  const base=(row?.lap_times_ms||[]).slice(0,completed).reduce((sum,v)=>sum+num(v),0);
  const pitLoss=(row?.pit_stops||[])
    .filter((stop)=>Number(stop?.lap)<=l)
    .reduce((sum,stop)=>sum+num(stop?.total_loss_s)*1000,0);
  const lapMs=num(row?.lap_times_ms?.[l-1],0);
  const sectors=sectorTimesForLap(lapMs,idOf(row?.driver||row),l);
  const partial=s>=1?num(sectors.sector_1_ms,0):0;
  const partial2=s>=2?num(sectors.sector_2_ms,0):0;
  return base+pitLoss+partial+partial2;
}
function tyreStateAtPoint(row,lap,sector=3){
  const current=tyreStateAtLap(row,lap);
  if(sector>=3||lap<=1)return current;
  const previous=tyreStateAtLap(row,Math.max(1,lap-1));
  if(
    String(previous?.tyre_id||"")!==String(current?.tyre_id||"")||
    Number(current?.stint_number||1)!==Number(previous?.stint_number||1)
  )return current;
  const fraction=Math.max(0,Math.min(1,Number(sector)/3));
  const prevCondition=num(previous?.condition,100);
  const endCondition=num(current?.condition,prevCondition);
  const prevTemp=num(previous?.temperature_c,current?.temperature_c??0);
  const endTemp=num(current?.temperature_c,prevTemp);
  return {
    ...current,
    condition:Number((prevCondition+(endCondition-prevCondition)*fraction).toFixed(1)),
    temperature_c:Number((prevTemp+(endTemp-prevTemp)*fraction).toFixed(1)),
    age_laps:Number(Math.max(0,(Number(current?.age_laps)||1)-1+fraction).toFixed(2)),
    source:"observed_sector_snapshot",
  };
}
function sectorDisplayForPoint(row,lap,sector=3){
  const lapMs=num(row?.lap_times_ms?.[Math.max(0,Number(lap)-1)],null);
  const sectors=sectorTimesForLap(lapMs,idOf(row?.driver||row),lap);
  return {
    sector_1_ms:Number(sector)>=1?sectors.sector_1_ms:null,
    sector_2_ms:Number(sector)>=2?sectors.sector_2_ms:null,
    sector_3_ms:Number(sector)>=3?sectors.sector_3_ms:null,
  };
}
function bestLapAt(row,lap){
  const times=(row?.lap_times_ms||[]).slice(0,Math.max(0,lap));
  let bestMs=Infinity,bestLap=null;
  times.forEach((value,index)=>{
    const ms=Number(value);
    if(Number.isFinite(ms)&&ms>0&&ms<bestMs){bestMs=ms;bestLap=index+1;}
  });
  return {best_lap_ms:Number.isFinite(bestMs)?bestMs:null,best_lap_number:bestLap};
}
function paceAtLap(strategyState,driverId,lap){
  let pace=String(strategyState?.selections?.[String(driverId)]?.pace_mode||"balanced");
  const commands=(strategyState?.live_commands?.[String(driverId)]||[])
    .filter((row)=>row?.type==="pace"&&Number(row?.effective_lap||0)<=Number(lap))
    .sort((a,b)=>Number(a?.effective_lap||0)-Number(b?.effective_lap||0));
  if(commands.length)pace=String(commands.at(-1)?.pace_mode||pace);
  return pace;
}
function pitWindowAt(strategyState,driverId,lap,totalLaps,tyre){
  const did=String(driverId);
  const selection=strategyState?.selections?.[did]||{};
  const commands=(strategyState?.live_commands?.[did]||[])
    .filter((row)=>row?.type==="pit"&&Number(row?.effective_lap||0)>Number(lap))
    .sort((a,b)=>Number(a?.effective_lap||0)-Number(b?.effective_lap||0));
  if(commands.length){
    const target=Math.min(totalLaps,Number(commands[0].effective_lap));
    return {from_lap:target,to_lap:target,target_lap:target,source:"player_call"};
  }
  if(selection.pit_plan==="no_stop")return null;
  if(selection.pit_plan==="one_stop"){
    const target=Math.max(Number(lap)+1,Math.min(totalLaps-1,Math.round(num(selection.planned_stop_lap,totalLaps*0.52))));
    return {from_lap:Math.max(Number(lap)+1,target-2),to_lap:Math.min(totalLaps-1,target+2),target_lap:target,source:"planned"};
  }
  const condition=num(tyre?.condition,100);
  const lapsUntil=Math.max(2,Math.min(12,Math.round((condition-28)/7)));
  const target=Math.min(totalLaps-1,Number(lap)+lapsUntil);
  if(target<=Number(lap))return null;
  return {from_lap:Math.max(Number(lap)+1,target-2),to_lap:Math.min(totalLaps-1,target+2),target_lap:target,source:"adaptive"};
}
function recentObservedPaceMs(row,lap,window=4){
  const end=Math.max(0,Number(lap)||0);
  const start=Math.max(0,end-Math.max(1,Number(window)||4));
  const samples=(row?.lap_times_ms||[])
    .slice(start,end)
    .map(Number)
    .filter((value)=>Number.isFinite(value)&&value>0);
  if(!samples.length)return null;
  let weighted=0,totalWeight=0;
  samples.forEach((value,index)=>{
    const weight=index+1;
    weighted+=value*weight;
    totalWeight+=weight;
  });
  return Math.round(weighted/Math.max(1,totalWeight));
}
function observedTyreWearPerLap(row,lap,tyre){
  const snapshots=(row?.tyre_state_by_lap||[])
    .filter((state)=>
      Number(state?.lap)<=Number(lap)&&
      Number(state?.stint_number||1)===Number(tyre?.stint_number||1)
    )
    .slice(-4);
  if(snapshots.length>=2){
    const first=snapshots[0],last=snapshots.at(-1);
    const laps=Math.max(1,Number(last?.lap)-Number(first?.lap));
    return Number(clamp((num(first?.condition,100)-num(last?.condition,100))/laps,0,8).toFixed(3));
  }
  const age=Math.max(1,Number(tyre?.age_laps)||1);
  return Number(clamp((100-num(tyre?.condition,100))/age,0,8).toFixed(3));
}
function nextPaceMode(strategyState,driverId,lap){
  const current=paceAtLap(strategyState,driverId,lap);
  const commands=(strategyState?.live_commands?.[String(driverId)]||[])
    .filter((row)=>row?.type==="pace"&&Number(row?.effective_lap||0)<=Number(lap)+1)
    .sort((a,b)=>Number(a?.effective_lap||0)-Number(b?.effective_lap||0));
  return String(commands.at(-1)?.pace_mode||current);
}
function forecastTyreCategory(state){
  const key=String(state||"SUNNY").toUpperCase();
  if(["HEAVY_RAIN","STORM"].includes(key))return "wet";
  if(["LIGHT_RAIN","WETTING","DRYING"].includes(key))return "intermediate";
  return "dry";
}
function expectedFuturePitLoss(gs,strategyState,row,lap,totalLaps,plan,forecast){
  const remaining=Math.max(0,Number(totalLaps)-Number(lap));
  if(row?.retired||remaining<=1)return 0;
  const currentGreenLoss=pitLossEstimate(gs,strategyState,row.driver_id,Number(lap)+1,plan,{observedLap:lap});
  let expected=0;
  const window=row?.pit_window||null;
  if(window&&Number(window?.target_lap)>Number(lap)){
    const source=String(window?.source||"adaptive");
    const probability=source==="player_call"
      ?1
      :source==="planned"
        ?0.90
        :num(row?.tyre?.condition,100)<45?0.82:0.55;
    expected=Math.max(expected,currentGreenLoss*probability);
  }

  const currentCategory=String(row?.tyre?.category||"dry");
  const predictedCategory=forecastTyreCategory(forecast?.predicted_state);
  if(currentCategory!==predictedCategory){
    const confidence=clamp(num(forecast?.confidence_pct,50)/100,0.2,0.95);
    const rainChance=clamp(num(forecast?.rain_chance_pct,50)/100,0.15,1);
    const probability=predictedCategory==="dry"
      ?confidence*0.72
      :confidence*Math.max(0.35,rainChance);
    expected=Math.max(expected,currentGreenLoss*probability);
  }
  return Number(expected.toFixed(2));
}

/**
 * Player-facing finish projection built only from observations available at the
 * current lap. Hidden final position, future lap times and future race-control
 * periods are deliberately ignored.
 */
export function projectObservedRaceState(rows,{lap,totalLaps,forecastConfidencePct=50}={}){
  const currentLap=Math.max(0,Number(lap)||0);
  const total=Math.max(1,Number(totalLaps)||1);
  const remaining=Math.max(0,total-currentLap);
  const forecastConfidence=clamp(num(forecastConfidencePct,50),20,95);

  const projected=(rows||[]).map((row)=>{
    if(row?.retired){
      return {
        ...row,
        projected_elapsed_ms:null,
        projection_uncertainty_ms:null,
        projection_confidence_pct:null,
      };
    }
    const recentPace=Math.max(30000,num(row?.recent_pace_ms,90000));
    const currentMode=RACE_PACE_MODES[String(row?.current_pace||"balanced")]||RACE_PACE_MODES.balanced;
    const nextMode=RACE_PACE_MODES[String(row?.next_pace||row?.current_pace||"balanced")]||currentMode;
    const paceModeDeltaMs=(num(nextMode?.lap_delta_s,0)-num(currentMode?.lap_delta_s,0))*1000;

    const condition=clamp(num(row?.tyre?.condition,100),0,100);
    const wearPerLap=clamp(num(row?.observed_tyre_wear_per_lap,0),0,8);
    const targetLap=Number(row?.pit_window?.target_lap);
    const stintHorizon=Number.isFinite(targetLap)&&targetLap>currentLap
      ?Math.min(remaining,Math.max(1,targetLap-currentLap))
      :remaining;
    const projectedCondition=clamp(condition-wearPerLap*stintHorizon,0,100);
    const currentPenalty=num(tyreConditionEffects(condition)?.pace_penalty_s,0);
    const endPenalty=num(tyreConditionEffects(projectedCondition)?.pace_penalty_s,0);
    const tyreGrowthPenaltyMs=Math.max(0,(endPenalty-currentPenalty)*500*stintHorizon);

    const futurePitLossMs=Math.max(0,num(row?.expected_future_pit_loss_s,0))*1000;
    const remainingTimeMs=(recentPace+paceModeDeltaMs)*remaining+tyreGrowthPenaltyMs+futurePitLossMs;
    const projectedElapsedMs=Math.max(
      num(row?.elapsed_ms,0),
      num(row?.elapsed_ms,0)+remainingTimeMs
    );

    const sampleCount=clamp(num(row?.observed_sample_count,1),1,4);
    const tyreRisk=(100-condition)/100;
    const uncertaintyPerLap=180+(1-forecastConfidence/100)*620+tyreRisk*180;
    const pitUncertainty=futurePitLossMs>0?Math.min(5000,futurePitLossMs*0.18):0;
    const uncertaintyMs=Math.max(1200,remaining*uncertaintyPerLap+pitUncertainty);
    const progress=currentLap/total;
    const confidence=clamp(
      24+progress*38+(forecastConfidence/100)*22+sampleCount*3,
      25,
      92
    );

    return {
      ...row,
      projected_elapsed_ms:Math.round(projectedElapsedMs),
      projection_uncertainty_ms:Math.round(uncertaintyMs),
      projection_confidence_pct:Math.round(confidence),
    };
  });

  const active=projected
    .filter((row)=>!row.retired&&Number.isFinite(Number(row.projected_elapsed_ms)))
    .slice()
    .sort((a,b)=>Number(a.projected_elapsed_ms)-Number(b.projected_elapsed_ms)||String(a.driver_id).localeCompare(String(b.driver_id)));
  const centralById=new Map(active.map((row,index)=>[String(row.driver_id),index+1]));

  return projected.map((row)=>{
    if(row?.retired||!Number.isFinite(Number(row?.projected_elapsed_ms))){
      return {
        ...row,
        projected_finish_position:null,
        projected_finish_best:null,
        projected_finish_worst:null,
      };
    }
    const ownBest=Number(row.projected_elapsed_ms)-Number(row.projection_uncertainty_ms||0);
    const ownWorst=Number(row.projected_elapsed_ms)+Number(row.projection_uncertainty_ms||0);
    const best=1+active.filter((other)=>
      String(other.driver_id)!==String(row.driver_id)&&
      Number(other.projected_elapsed_ms)+Number(other.projection_uncertainty_ms||0)<ownBest
    ).length;
    const worst=1+active.filter((other)=>
      String(other.driver_id)!==String(row.driver_id)&&
      Number(other.projected_elapsed_ms)-Number(other.projection_uncertainty_ms||0)<ownWorst
    ).length;
    return {
      ...row,
      projected_finish_position:centralById.get(String(row.driver_id))||null,
      projected_finish_best:Math.max(1,best),
      projected_finish_worst:Math.max(Math.max(1,best),Math.min(active.length,worst)),
    };
  });
}
function pitRejoinEstimate(active,row,pitLossSeconds){
  if(row?.retired||!Number.isFinite(Number(pitLossSeconds)))return {
    position:null,best:null,worst:null,traffic_count:0,gap_ahead_ms:null,gap_behind_ms:null,
  };
  const selfNext=num(row?.elapsed_ms,0)+Math.max(30000,num(row?.recent_pace_ms,90000))+Number(pitLossSeconds)*1000;
  const rivals=(active||[])
    .filter((other)=>String(other.driver_id)!==String(row.driver_id))
    .map((other)=>({
      driver_id:other.driver_id,
      elapsed:num(other?.elapsed_ms,0)+Math.max(30000,num(other?.recent_pace_ms,90000)),
    }))
    .sort((a,b)=>a.elapsed-b.elapsed);
  const position=1+rivals.filter((other)=>other.elapsed<selfNext).length;
  const ahead=rivals.filter((other)=>other.elapsed<selfNext).at(-1)||null;
  const behind=rivals.find((other)=>other.elapsed>=selfNext)||null;
  const traffic=rivals.filter((other)=>Math.abs(other.elapsed-selfNext)<=3500).length;
  const uncertainty=1500+Math.min(2500,traffic*650);
  const best=1+rivals.filter((other)=>other.elapsed<selfNext-uncertainty).length;
  const worst=1+rivals.filter((other)=>other.elapsed<selfNext+uncertainty).length;
  return {
    position,
    best:Math.max(1,best),
    worst:Math.max(Math.max(1,best),Math.min((active||[]).length,worst)),
    traffic_count:traffic,
    gap_ahead_ms:ahead?Math.max(0,selfNext-ahead.elapsed):null,
    gap_behind_ms:behind?Math.max(0,behind.elapsed-selfNext):null,
  };
}

function visibleClassification(gs,race,lap,plan,strategyState,sector=3){
  const gridRows=gridForWeekend(gs);
  const gridById=new Map(gridRows.map((row)=>[idOf(row?.driver),Number(row?.pos)]));
  const totalLaps=Math.max(1,Number(gs?.raceWeekendState?.live_race?.total_laps||strategyState?.track_snapshot?.laps||1));
  const playerTeam=String(gs?.team?.team_id??gs?.team?.id??"");
  const playerForecast=raceForecastForTeam(gs,playerTeam);
  const forecastConfidence=num(playerForecast?.confidence_pct,50);
  const currentOrdinal=pointOrdinal(lap,sector);
  const progressLap=Math.max(0,(Number(lap)-1)+Number(sector)/3);

  const rows=(race||[]).map((row)=>{
    const did=idOf(row?.driver||row);
    const incident=incidentForDriver(plan,did);
    const retired=Boolean(incident&&incidentOrdinal(incident)<=currentOrdinal);
    const pointLap=retired?Math.max(1,Number(incident?.lap)||1):Math.max(1,Number(lap)||1);
    const pointSector=retired
      ?Math.max(1,Math.min(3,Number(incident?.sector)||1))
      :Math.max(1,Math.min(3,Number(sector)||3));
    const completedLap=pointSector>=3?pointLap:Math.max(0,pointLap-1);
    const pointOrd=pointOrdinal(pointLap,pointSector);
    const lastBaseMs=completedLap>0?num(row?.lap_times_ms?.[completedLap-1],null):null;
    const previousBaseMs=completedLap>1?num(row?.lap_times_ms?.[completedLap-2],null):null;
    const lastLapMs=Number.isFinite(Number(lastBaseMs))
      ?Number(lastBaseMs)+nonRetirementIncidentLossMs(plan,did,{throughOrdinal:pointOrd,lap:completedLap})
      :null;
    const previousLapMs=Number.isFinite(Number(previousBaseMs))
      ?Number(previousBaseMs)+nonRetirementIncidentLossMs(plan,did,{throughOrdinal:pointOrd,lap:completedLap-1})
      :null;
    const lastLapDeltaMs=Number.isFinite(Number(lastLapMs))&&Number.isFinite(Number(previousLapMs))
      ?Number(lastLapMs)-Number(previousLapMs)
      :null;
    const tyre=tyreStateAtPoint(row,pointLap,pointSector);
    const pits=(row?.pit_stops||[]).filter((stop)=>Number(stop?.lap)<=pointLap);
    const best=bestLapAt(row,completedLap);
    const sectors=sectorDisplayForPoint(row,pointLap,pointSector);
    const recentPace=completedLap>0?recentObservedPaceMs(row,completedLap):null;
    const pitWindow=pitWindowAt(strategyState,did,Math.max(0,completedLap),totalLaps,tyre);
    const currentPace=paceAtLap(strategyState,did,pointLap);
    const nextPace=nextPaceMode(strategyState,did,pointLap);
    const sampleCount=(row?.lap_times_ms||[]).slice(Math.max(0,completedLap-4),completedLap)
      .filter((value)=>Number.isFinite(Number(value))&&Number(value)>0).length;
    const visibleRow={
      driver_id:did,
      team_id:teamForDriver(gs,did),
      grid_position:gridById.get(did)||null,
      current_lap:pointLap,
      current_sector:pointSector,
      laps_completed:completedLap,
      elapsed_ms:cumulativeAtPoint(row,pointLap,pointSector)+nonRetirementIncidentLossMs(plan,did,{throughOrdinal:pointOrd}),
      last_lap_ms:lastLapMs,
      previous_lap_ms:previousLapMs,
      last_lap_delta_ms:lastLapDeltaMs,
      ...best,
      ...sectors,
      tyre,
      pit_stops:pits,
      pit_count:pits.length,
      last_pit_lap:pits.length?Number(pits.at(-1)?.lap)||null:null,
      current_pace:currentPace,
      next_pace:nextPace,
      recent_pace_ms:recentPace,
      observed_sample_count:sampleCount,
      observed_tyre_wear_per_lap:observedTyreWearPerLap(row,Math.max(1,pointLap),tyre),
      pit_window:pitWindow,
      retired,
      status:retired?"DNF":"RUNNING",
      retirement_reason:retired?incident.reason:null,
      incident_lap:retired?incident.lap:null,
      incident_sector:retired?(incident?.sector??null):null,
    };
    visibleRow.expected_future_pit_loss_s=expectedFuturePitLoss(
      gs,strategyState,visibleRow,Math.max(0,completedLap),totalLaps,plan,playerForecast
    );
    return visibleRow;
  });

  const activeBase=rows.filter((row)=>!row.retired).sort((a,b)=>a.elapsed_ms-b.elapsed_ms||a.driver_id.localeCompare(b.driver_id));
  const retired=rows.filter((row)=>row.retired).sort((a,b)=>{
    const aOrdinal=pointOrdinal(a.incident_lap||1,a.incident_sector||1);
    const bOrdinal=pointOrdinal(b.incident_lap||1,b.incident_sector||1);
    return bOrdinal-aOrdinal||a.elapsed_ms-b.elapsed_ms;
  });
  const leader=activeBase[0]?.elapsed_ms||retired[0]?.elapsed_ms||0;
  let previous=leader;
  const positionedActive=activeBase.map((row,index)=>{
    const position=index+1;
    const gap=Math.max(0,row.elapsed_ms-leader);
    const interval=index?Math.max(0,row.elapsed_ms-previous):0;
    const out={
      ...row,
      position,
      gap_to_leader_ms:gap,
      gap_to_previous_ms:interval,
      interval_ms:interval,
      position_gain:Number.isFinite(Number(row.grid_position))?Number(row.grid_position)-position:0,
    };
    previous=row.elapsed_ms;
    return out;
  });
  const projectedActive=projectObservedRaceState(positionedActive,{
    lap:progressLap,
    totalLaps,
    forecastConfidencePct:forecastConfidence,
  });
  const projectedById=new Map(projectedActive.map((row)=>[String(row.driver_id),row]));

  const active=positionedActive.map((row)=>{
    const projected=projectedById.get(String(row.driver_id))||row;
    const estimatedPitLoss=pitLossEstimate(gs,strategyState,row.driver_id,Math.max(1,Number(lap)),plan,{observedLap:Math.max(1,Number(lap))});
    const rejoin=pitRejoinEstimate(positionedActive,row,estimatedPitLoss);
    return {
      ...projected,
      projected_gain:Number.isFinite(Number(projected.projected_finish_position))
        ?Number(row.position)-Number(projected.projected_finish_position)
        :0,
      pit_loss_estimate_s:estimatedPitLoss,
      pit_rejoin_position:rejoin.position,
      pit_rejoin_best:rejoin.best,
      pit_rejoin_worst:rejoin.worst,
      pit_rejoin_traffic_count:rejoin.traffic_count,
      pit_rejoin_gap_ahead_ms:rejoin.gap_ahead_ms,
      pit_rejoin_gap_behind_ms:rejoin.gap_behind_ms,
      projection_source:"observed_live_state",
      projection_forecast_source:playerForecast?.source||"unavailable",
    };
  });

  const retiredPositioned=retired.map((row,index)=>({
    ...row,
    position:active.length+index+1,
    gap_to_leader_ms:null,
    gap_to_previous_ms:null,
    interval_ms:null,
    position_gain:Number.isFinite(Number(row.grid_position))
      ?Number(row.grid_position)-(active.length+index+1)
      :0,
    projected_finish_position:null,
    projected_finish_best:null,
    projected_finish_worst:null,
    projected_gain:0,
    pit_loss_estimate_s:null,
    pit_rejoin_position:null,
    pit_rejoin_best:null,
    pit_rejoin_worst:null,
    pit_rejoin_traffic_count:0,
    pit_rejoin_gap_ahead_ms:null,
    pit_rejoin_gap_behind_ms:null,
    projection_source:"retired",
  }));
  return [...active,...retiredPositioned];
}

export function createLiveRaceState(gs,{gp={}}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="race")return gs;
  if(["running","red_flag","finished"].includes(String(weekend.live_race?.status)))return gs;
  const track=weekend?.race_strategy?.track_snapshot||{};
  const prepared={...gs,raceWeekendState:{...weekend,race_strategy:{...(weekend.race_strategy||{}),live_commands:{...(weekend.race_strategy?.live_commands||{})}}}};
  const preliminary=simulateManagedRace(prepared,{gp,grid:gridForWeekend(prepared),ratings:prepared?.driverRatings||[],roundIndex:Number(weekend?.roundIndex)||0});
  const plan=createRaceControlPlan(preliminary.gameState,{gp,race:preliminary.race,weather:preliminary.weather,track:preliminary.track});
  return {
    ...preliminary.gameState,
    raceWeekendState:{
      ...preliminary.gameState.raceWeekendState,
      race_strategy:{...preliminary.gameState.raceWeekendState.race_strategy,race_control_plan:plan},
      live_race:{
        version:3,status:"running",current_lap:0,current_sector:0,completed_laps:0,total_laps:Math.max(1,Number(track?.laps)||1),speed:"manual",
        classification:[],events:[{lap:0,sector:0,type:"start_ready",message:"Cars are on the grid. Race control is ready."}],
        last_weather:null,current_control:"GREEN",track_state:plan.weather_timeline?.[0]||null,started_at:gs?.currentDateISO||null,
      },
    },
  };
}

export function issueLiveRaceCommand(gs,{driverId,type,paceMode,tyreId,teamOrder,teammateId}={}){
  const weekend=gs?.raceWeekendState, live=weekend?.live_race;
  if(!weekend||weekend.phase!=="race"||live?.status!=="running"||!driverId)return gs;
  const did=String(driverId), teamId=teamForDriver(gs,did), playerTeam=String(gs?.team?.team_id??gs?.team?.id??"");
  if(!teamId||teamId!==playerTeam)return gs;
  const effectiveLap=Math.min(Number(live.total_laps),Number(live.current_lap)+1);
  let command=null;
  if(type==="pace"&&Object.hasOwn(RACE_PACE_MODES,String(paceMode)))command={type:"pace",pace_mode:String(paceMode),effective_lap:effectiveLap};
  else if(type==="pit"){
    const valid=new Set(tyresForTeam(gs,teamId).map((row)=>String(row?.tyre_id??row?.id??"")));
    if(!valid.has(String(tyreId)))return gs;
    command={type:"pit",tyre_id:String(tyreId),effective_lap:effectiveLap};
  }else if(type==="team_order"&&String(teamOrder)==="yield"&&teammateId){
    const mateId=String(teammateId);
    if(mateId===did||teamForDriver(gs,mateId)!==teamId)return gs;
    const rows=Array.isArray(live?.classification)?live.classification:[];
    const current=rows.find((row)=>String(row?.driver_id??"")===did);
    const mate=rows.find((row)=>String(row?.driver_id??"")===mateId);
    if(!current||!mate||current?.retired||mate?.retired)return gs;
    const currentPos=Number(current?.position),matePos=Number(mate?.position);
    const gapMs=Number(mate?.gap_to_previous_ms??mate?.interval_ms);
    if(!Number.isFinite(currentPos)||!Number.isFinite(matePos)||matePos!==currentPos+1)return gs;
    if(Number.isFinite(gapMs)&&gapMs>3500)return gs;

    const compliance=teamOrderComplianceProfile(gs,did,mateId,{teamId});
    if(compliance.at_risk){
      const complianceRng=rngFor(gs,`team-order-compliance:${weekend?.key||"race"}:${did}:${mateId}:${effectiveLap}`);
      if(complianceRng.next()>compliance.probability){
        const driverName=driverDisplayName(gs,did);
        const mateName=driverDisplayName(gs,mateId);
        return {
          ...gs,
          raceWeekendState:{
            ...weekend,
            live_race:{...live,events:[...(live.events||[]),{
              event_key:`team_order_refused:${did}:${mateId}:${effectiveLap}`,
              lap:Number(live.current_lap),
              sector:Number(live.current_sector)||0,
              type:"driver_feedback",
              feedback_kind:"team_order_refused",
              driver_id:did,
              driver_name:driverName,
              teammate_id:mateId,
              relationship_compliance:compliance.probability,
              relationship_label:compliance.label,
              message:`${driverName}: "I don't agree with that order — I want to race ${mateName}."`,
            }]},
          },
        };
      }
    }
    command={
      type:"team_order",
      team_order:"yield",
      teammate_id:mateId,
      effective_lap:effectiveLap,
      relationship_compliance:compliance.probability,
    };
  }
  if(!command)return gs;
  const existing=weekend?.race_strategy?.live_commands?.[did]||[];
  const nextCommands=existing.filter((row)=>!(row?.type===type&&Number(row?.effective_lap)===effectiveLap));
  nextCommands.push(command);
  const driverName=driverDisplayName(gs,did);
  const commandMessage=command.type==="pace"
    ?`${driverName} was told to ${paceInstruction(command.pace_mode)} from lap ${effectiveLap}.`
    :command.type==="pit"
      ?`${driverName} was told to pit next lap for ${tyreDisplayName(gs,did,command.tyre_id)} tyres.`
      :`${driverName} was told to let ${driverDisplayName(gs,command.teammate_id)} through from lap ${effectiveLap}.`;
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      race_strategy:{...weekend.race_strategy,live_commands:{...(weekend.race_strategy?.live_commands||{}),[did]:nextCommands}},
      live_race:{...live,events:[...(live.events||[]),{
        lap:Number(live.current_lap),
        sector:Number(live.current_sector)||0,
        type:"command",
        driver_id:did,
        driver_name:driverName,
        effective_lap:effectiveLap,
        command,
        message:commandMessage,
      }]},
    },
  };
}

export function cancelLiveRaceCommand(gs,{driverId,type=null}={}){
  const weekend=gs?.raceWeekendState, live=weekend?.live_race;
  if(!weekend||weekend.phase!=="race"||live?.status!=="running"||!driverId)return gs;
  const did=String(driverId), teamId=teamForDriver(gs,did), playerTeam=String(gs?.team?.team_id??gs?.team?.id??"");
  if(!teamId||teamId!==playerTeam)return gs;
  const currentLap=Number(live.current_lap)||0;
  const existing=weekend?.race_strategy?.live_commands?.[did]||[];
  const cancellable=existing.filter((row)=>
    Number(row?.effective_lap)>currentLap&&
    (!type||String(row?.type)===String(type))
  );
  if(!cancellable.length)return gs;
  const target=cancellable.slice().sort((a,b)=>Number(a.effective_lap)-Number(b.effective_lap)).at(-1);
  const nextCommands=existing.filter((row)=>row!==target);
  const driverName=driverDisplayName(gs,did);
  const orderLabel=target.type==="pit"
    ?`pit order for ${tyreDisplayName(gs,did,target.tyre_id)} tyres`
    :target.type==="team_order"
      ?`team order to let ${driverDisplayName(gs,target.teammate_id)} through`
      :`${paceInstruction(target.pace_mode)} pace order`;
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      race_strategy:{...weekend.race_strategy,live_commands:{...(weekend.race_strategy?.live_commands||{}),[did]:nextCommands}},
      live_race:{...live,events:[...(live.events||[]),{
        lap:Number(live.current_lap),
        sector:Number(live.current_sector)||0,
        type:"command_cancelled",
        driver_id:did,
        driver_name:driverName,
        command:target,
        message:`${driverName}'s ${orderLabel} was cancelled.`,
      }]},
    },
  };
}

export function advanceLiveRace(gs,{gp={},laps=1,sectors=null}={}){
  let working=createLiveRaceState(gs,{gp});
  const weekend=working?.raceWeekendState, live=weekend?.live_race;
  if(!live||live.status!=="running")return working;

  const totalLaps=Math.max(1,Number(live.total_laps)||1);
  const totalOrdinal=totalLaps*3;
  const currentOrdinal=livePointOrdinal(live);
  const currentLap=Number(live.current_lap)||0;
  const currentSector=currentLap>0?Math.max(1,Math.min(3,Number(live.current_sector)||3)):0;
  let requestedOrdinal;

  if(sectors!==null&&sectors!==undefined){
    requestedOrdinal=Math.min(totalOrdinal,currentOrdinal+Math.max(1,Math.round(Number(sectors)||1)));
  }else{
    const completedLap=currentLap<=0?0:currentSector>=3?currentLap:Math.max(0,currentLap-1);
    const targetCompleted=Math.min(totalLaps,completedLap+Math.max(1,Math.round(Number(laps)||1)));
    requestedOrdinal=Math.max(1,targetCompleted*3);
  }

  const planBefore=working?.raceWeekendState?.race_strategy?.race_control_plan||null;

  // Recalculate only future hazards. Observed sectors are locked in the Save World.
  const hazardSimulation=simulateManagedRace(working,{gp,grid:gridForWeekend(working),ratings:working?.driverRatings||[],roundIndex:Number(weekend?.roundIndex)||0});
  const freshPlan=createRaceControlPlan(hazardSimulation.gameState,{gp,race:hazardSimulation.race,weather:hazardSimulation.weather,track:hazardSimulation.track});
  const plan=mergeRaceControlHistory(planBefore,freshPlan,currentLap,currentSector||3);
  working={
    ...hazardSimulation.gameState,
    raceWeekendState:{
      ...hazardSimulation.gameState.raceWeekendState,
      race_strategy:{...hazardSimulation.gameState.raceWeekendState.race_strategy,race_control_plan:plan},
    },
  };

  const upcomingRed=(plan?.periods||[])
    .filter((period)=>period.type==="RED_FLAG")
    .map((period)=>({...period,start_ordinal:pointOrdinal(period.from_lap,period.from_sector??1)}))
    .filter((period)=>period.start_ordinal>currentOrdinal&&period.start_ordinal<=requestedOrdinal)
    .sort((a,b)=>a.start_ordinal-b.start_ordinal)[0]||null;
  const targetOrdinal=upcomingRed?upcomingRed.start_ordinal:requestedOrdinal;
  const targetPoint=pointFromOrdinal(targetOrdinal,totalLaps);
  const target=targetPoint.lap;
  const targetSector=targetPoint.sector;

  const simulation=simulateManagedRace(working,{gp,grid:gridForWeekend(working),ratings:working?.driverRatings||[],roundIndex:Number(weekend?.roundIndex)||0});
  working=simulation.gameState;
  let classification=visibleClassification(
    working,
    simulation.race,
    target,
    plan,
    working?.raceWeekendState?.race_strategy,
    targetSector
  );

  let previousPositionByDriver=new Map();
  if(targetSector===3&&target>1){
    const previousLapRows=visibleClassification(
      working,simulation.race,target-1,plan,working?.raceWeekendState?.race_strategy,3
    );
    previousPositionByDriver=new Map(previousLapRows.map((row)=>[String(row.driver_id),Number(row.position)]));
  }else if(targetSector<3){
    previousPositionByDriver=new Map((live.classification||[]).map((row)=>[
      String(row.driver_id),
      Number(row.position),
    ]));
  }
  const previousLapChangeByDriver=new Map((live.classification||[]).map((row)=>[
    String(row.driver_id),
    Number(row.position_change_last_lap)||0,
  ]));
  classification=classification.map((row)=>{
    const previousPosition=previousPositionByDriver.get(String(row.driver_id));
    const positionChange=targetSector===3
      ?Number.isFinite(previousPosition)?previousPosition-Number(row.position):0
      :previousLapChangeByDriver.get(String(row.driver_id))||0;
    return {
      ...row,
      previous_lap_position:Number.isFinite(previousPosition)?previousPosition:null,
      position_change_last_lap:positionChange,
    };
  });

  const weatherSegment=simulation.weather?.segments?.find((s)=>target>=Number(s?.from_lap)&&target<=Number(s?.to_lap));
  const weather=String(weatherSegment?.state||simulation.weather?.state||"SUNNY");
  const previousWeather=String(live.last_weather||"");
  let currentControl=raceControlAtPoint(plan,target,targetSector);
  if(currentControl.type==="RED_FLAG"&&!upcomingRed)currentControl={type:"GREEN",cause:null};
  const trackState=plan?.weather_timeline?.[Math.max(0,target-1)]||null;
  const events=[...(live.events||[])];

  // Surface meaningful player position changes as race events. This stays
  // deliberately team-focused to avoid flooding the Race Feed with every pass.
  if(targetSector===3){
    const previousLiveByDriver=new Map((live.classification||[]).map((row)=>[
      String(row?.driver_id||""),Number(row?.position),
    ]));
    const playerTeamForEvents=String(working?.team?.team_id??working?.team?.id??"");
    for(const row of classification){
      const did=String(row?.driver_id||"");
      if(!did||row?.retired||String(row?.team_id||"")!==playerTeamForEvents)continue;
      const from=previousLiveByDriver.get(did);
      const to=Number(row?.position);
      if(!Number.isFinite(from)||!Number.isFinite(to)||from===to)continue;
      const delta=from-to;
      const driverName=driverDisplayName(working,did);
      pushUniqueEvent(events,{
        event_key:`position_change:${did}:${target}:${from}:${to}`,
        lap:Number(target),
        sector:3,
        type:"position_change",
        driver_id:did,
        driver_name:driverName,
        position_from:from,
        position_to:to,
        positions_changed:delta,
        message:`${driverName} ${delta>0?"gained":"lost"} ${Math.abs(delta)} position${Math.abs(delta)===1?"":"s"}: P${from} → P${to}.`,
      });
    }
  }

  appendWeatherReports(
    events,
    plan?.weather_timeline||[],
    Math.max(1,currentLap||1),
    target
  );
  if(previousWeather&&weather!==previousWeather){
    pushUniqueEvent(events,{
      event_key:`weather_state:${target}:${weather}`,
      lap:target,sector:targetSector,type:"weather",
      weather_state:weather,
      message:`Conditions changed from ${previousWeather.replaceAll("_"," ").toLowerCase()} to ${weather.replaceAll("_"," ").toLowerCase()}.`,
    });
  }

  const controlPeriodsStarted=new Set();
  for(const incident of plan?.incidents||[]){
    const incidentPoint=incidentOrdinal(incident);
    if(incidentPoint>currentOrdinal&&incidentPoint<=targetOrdinal){
      const period=(plan?.periods||[]).find((row)=>
        Number(row?.from_lap)===Number(incident.lap)&&
        Number(row?.from_sector??1)===Number(incident?.sector??1)&&
        String(row?.driver_id??"")===String(incident.driver_id)
      );
      const driver=driverDisplayName(working,incident.driver_id);
      const medical=incidentMedicalStatus(working,incident);
      const eventKey=`incident:${incident.driver_id}:${incident.lap}:${incident.sector||1}:${incident.kind||incident.reason||"incident"}`;
      if(period){
        controlPeriodsStarted.add(`${period.type}:${period.from_lap}:${period.from_sector||1}:${period.driver_id||""}`);
        pushUniqueEvent(events,{
          event_key:eventKey,
          lap:Number(incident.lap),
          sector:Number(incident.sector)||1,
          type:"race_control",
          driver_id:incident.driver_id,
          driver_name:driver,
          control_type:period.type,
          cause:"incident",
          incident_kind:String(incident.kind||"incident").toLowerCase(),
          incident_reason:String(incident.reason||incident.kind||"incident").toLowerCase(),
          medical_concern:medical.medicalConcern,
          injury_probability:medical.injuryProbability,
          message:formatRaceIncidentMessage({controlType:period.type,driverName:driver,incident,medicalConcern:medical.medicalConcern}),
        });
      }else{
        pushUniqueEvent(events,{
          event_key:eventKey,
          lap:Number(incident.lap),
          sector:Number(incident.sector)||1,
          type:"incident",
          driver_id:incident.driver_id,
          driver_name:driver,
          cause:"incident",
          incident_kind:String(incident.kind||"incident").toLowerCase(),
          incident_reason:String(incident.reason||incident.kind||"incident").toLowerCase(),
          medical_concern:medical.medicalConcern,
          injury_probability:medical.injuryProbability,
          message:formatRaceIncidentMessage({driverName:driver,incident,medicalConcern:medical.medicalConcern}),
        });
      }
    }
  }

  for(const period of plan?.periods||[]){
    const startOrdinal=pointOrdinal(period.from_lap,period.from_sector??1);
    const endOrdinal=pointOrdinal(period.to_lap,period.to_sector??3);
    const key=`${period.type}:${period.from_lap}:${period.from_sector||1}:${period.driver_id||""}`;
    if(startOrdinal>currentOrdinal&&startOrdinal<=targetOrdinal&&!controlPeriodsStarted.has(key)){
      const weatherAtStart=plan?.weather_timeline?.[Math.max(0,Number(period.from_lap)-1)]?.state;
      const linkedIncident=period.cause==="incident"?incidentForControlPeriod(plan,period):null;
      const linkedDriverId=String(linkedIncident?.driver_id??period?.driver_id??"");
      const linkedDriverName=linkedDriverId?driverDisplayName(working,linkedDriverId):null;
      const linkedMedical=linkedIncident?incidentMedicalStatus(working,linkedIncident):null;
      pushUniqueEvent(events,{
        event_key:`race_control:${period.type}:${period.from_lap}:${period.from_sector||1}:${period.cause||"control"}`,
        lap:Number(period.from_lap),
        sector:Number(period.from_sector)||1,
        type:"race_control",
        driver_id:linkedDriverId||null,
        driver_name:linkedDriverName||null,
        control_type:period.type,
        cause:period.cause,
        incident_kind:linkedIncident?String(linkedIncident?.kind||"incident").toLowerCase():null,
        incident_reason:linkedIncident?String(linkedIncident?.reason||linkedIncident?.kind||"incident").toLowerCase():null,
        message:period.cause==="weather"
          ?formatWeatherControlMessage(period.type,weatherAtStart)
          :linkedIncident
            ?formatRaceIncidentMessage({controlType:period.type,driverName:linkedDriverName||"Driver",incident:linkedIncident,medicalConcern:linkedMedical?.medicalConcern})
            :`${controlLabel(period.type)} — Incident on track.`,
      });
    }
    if(endOrdinal>=currentOrdinal&&endOrdinal<targetOrdinal&&period.type!=="RED_FLAG"){
      const nextPoint=pointFromOrdinal(Math.min(totalOrdinal,endOrdinal+1),totalLaps);
      pushUniqueEvent(events,{
        event_key:`race_control:GREEN:${nextPoint.lap}:${nextPoint.sector}:${period.type}`,
        lap:nextPoint.lap,
        sector:nextPoint.sector,
        type:"race_control",
        control_type:"GREEN",
        message:`${controlLabel(period.type)} withdrawn — green flag.`,
      });
    }
  }

  for(const row of simulation.race){
    const did=idOf(row.driver);
    const retirementIncident=incidentForDriver(plan,did);
    const retirementPoint=retirementIncident?incidentOrdinal(retirementIncident):null;
    for(const stop of row?.pit_stops||[]){
      const stopPoint=pointOrdinal(stop?.lap,1);
      if(
        stopPoint>currentOrdinal&&
        stopPoint<=targetOrdinal&&
        (!Number.isFinite(retirementPoint)||stopPoint<=retirementPoint)
      ){
        const driverName=driverDisplayName(working,did);
        const previousTyre=tyreDisplayName(working,did,stop.tyre_from);
        const nextTyre=tyreDisplayName(working,did,stop.tyre_to);
        const beforeRows=Number(stop.lap)>1
          ?visibleClassification(working,simulation.race,Number(stop.lap)-1,plan,working?.raceWeekendState?.race_strategy,3)
          :[];
        const afterRows=visibleClassification(working,simulation.race,Number(stop.lap),plan,working?.raceWeekendState?.race_strategy,1);
        const positionBefore=beforeRows.find((item)=>String(item.driver_id)===did)?.position??null;
        const positionAfter=afterRows.find((item)=>String(item.driver_id)===did)?.position??null;
        const positionText=Number.isFinite(Number(positionBefore))&&Number.isFinite(Number(positionAfter))
          ?`, P${positionBefore} → P${positionAfter}`
          :"";
        events.push({
          lap:Number(stop.lap),
          sector:1,
          type:"pit",
          driver_id:did,
          driver_name:driverName,
          tyre_from_id:stop.tyre_from,
          tyre_to_id:stop.tyre_to,
          tyre_from:previousTyre,
          tyre_to:nextTyre,
          team_id:teamForDriver(working,did),
          stationary_s:Number(stop.stationary_s),
          expected_stationary_s:Number(stop.expected_stationary_s),
          execution_delta_s:Number(stop.execution_delta_s),
          crew_error_delay_s:Number(stop.crew_error_delay_s),
          pit_lane_loss_s:Number(stop.pit_lane_loss_s),
          total_loss_s:Number(stop.total_loss_s),
          crew_error:Boolean(stop.error),
          position_before:positionBefore,
          position_after:positionAfter,
          message:`${driverName} changed from ${previousTyre} to ${nextTyre} tyres (${Number(stop.stationary_s).toFixed(1)}s stationary, ${Number(stop.total_loss_s).toFixed(1)}s total loss${positionText}${stop.error?`, crew delay +${Number(stop.crew_error_delay_s||0).toFixed(1)}s`:""}).`,
        });
      }
    }
  }

  const playerTeam=String(working?.team?.team_id??working?.team?.id??"");
  for(const row of simulation.race||[]){
    const did=idOf(row.driver);
    if(!did||teamForDriver(working,did)!==playerTeam)continue;
    const visibleDriver=classification.find((item)=>String(item?.driver_id||"")===did);
    if(visibleDriver?.retired)continue;
    const observedTyre=(row?.tyre_state_by_lap||[]).find((state)=>Number(state?.lap)===Number(target));
    if(!observedTyre||Number(observedTyre?.weather_penalty_s||0)<=0)continue;
    const driverName=driverDisplayName(working,did);
    const message=tyreWeatherFeedback(driverName,observedTyre);
    if(!message)continue;
    const feedbackSector=Math.max(1,Number(targetSector)||1);
    pushUniqueEvent(events,{
      event_key:`driver_feedback:tyre_weather:${did}:${observedTyre.stint_start_lap||target}:${observedTyre.weather_state||"unknown"}`,
      lap:Number(target),
      sector:feedbackSector,
      type:"driver_feedback",
      feedback_kind:"tyre_weather_mismatch",
      driver_id:did,
      driver_name:driverName,
      tyre_id:observedTyre.tyre_id,
      tyre_category:observedTyre.category,
      weather_state:observedTyre.weather_state,
      track_wetness:observedTyre.track_wetness,
      wetness_delta:observedTyre.wetness_delta,
      rain_intensity:observedTyre.rain_intensity,
      weather_penalty_s:observedTyre.weather_penalty_s,
      message,
    });
  }

  const activeRows=classification.filter((row)=>!row.retired);
  const fastest=classification
    .filter((row)=>Number.isFinite(Number(row.best_lap_ms))&&Number(row.best_lap_ms)>0)
    .slice()
    .sort((a,b)=>Number(a.best_lap_ms)-Number(b.best_lap_ms))[0]||null;
  const timingSummary={
    leader_driver_id:activeRows[0]?.driver_id||classification[0]?.driver_id||null,
    fastest_lap_driver_id:fastest?.driver_id||null,
    fastest_lap_ms:fastest?.best_lap_ms||null,
    fastest_lap_number:fastest?.best_lap_number||null,
    field_spread_ms:activeRows.length>1
      ?Math.max(0,Number(activeRows.at(-1)?.elapsed_ms||0)-Number(activeRows[0]?.elapsed_ms||0))
      :0,
    running_count:activeRows.length,
    retired_count:classification.filter((row)=>row.retired).length,
    lap:target,
    sector:targetSector,
  };
  const completedLaps=targetSector>=3?target:Math.max(0,target-1);
  const existingRedHistory=Array.isArray(live?.red_flag_history)?live.red_flag_history:[];
  const redFlagLifecycle=upcomingRed
    ?createRedFlagSuspension({
      year:Number(working?.activeYear)||1980,
      rules:plan?.rules||{},
      period:upcomingRed,
      classification,
      lap:target,
      sector:targetSector,
      trackState,
      sequence:existingRedHistory.length+1,
    })
    :live?.red_flag_lifecycle||null;

  if(upcomingRed){
    const holding=String(redFlagLifecycle?.holding_area||"starting_grid").replaceAll("_"," ");
    pushUniqueEvent(events,{
      event_key:`red_flag_suspension:${target}:${targetSector}:${redFlagLifecycle?.sequence||1}`,
      lap:target,
      sector:targetSector,
      type:"red_flag_suspension",
      control_type:"RED_FLAG",
      cause:upcomingRed?.cause||"race_control",
      lifecycle_phase:"suspended",
      holding_area:redFlagLifecycle?.holding_area||null,
      message:`Race suspended. Cars must return slowly to the ${holding}; track progress is frozen.`,
    });
  }

  const nextState={
    ...working,
    raceWeekendState:{
      ...working.raceWeekendState,
      live_race:{
        ...live,
        version:3,
        current_lap:target,
        current_sector:targetSector,
        completed_laps:completedLaps,
        status:upcomingRed?"red_flag":targetOrdinal>=totalOrdinal?"finished":"running",
        classification,
        timing_summary:timingSummary,
        last_weather:weather,
        current_control:currentControl.type,
        track_state:trackState,
        red_flag_period:upcomingRed||null,
        red_flag_lifecycle:redFlagLifecycle,
        red_flag_history:existingRedHistory,
        projected_race:simulation.race,
        projected_summary:simulation.summary,
        events,
      },
    },
  };
  return upcomingRed?applyAutomaticRedFlagWork(nextState):nextState;
}

export function advanceLiveRaceSector(gs,{gp={},sectors=1}={}){
  return advanceLiveRace(gs,{gp,sectors});
}

export function prepareLiveRaceRestart(gs){
  const weekend=gs?.raceWeekendState;
  const live=weekend?.live_race;
  if(!weekend||live?.status!=="red_flag")return gs;
  const rules=weekend?.race_strategy?.race_control_plan?.rules||{};
  const current=live?.red_flag_lifecycle||legacyRedFlagLifecycle({
    year:Number(gs?.activeYear)||1980,
    rules,
    live,
  });
  if(!current||String(current?.phase)!=="suspended")return gs;
  const lifecycle=prepareRedFlagRestart(current);
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      live_race:{
        ...live,
        red_flag_lifecycle:lifecycle,
        events:[...(live.events||[]),{
          event_key:`red_flag_restart_pending:${Number(live.current_lap)}:${Number(live.current_sector)||1}:${lifecycle.sequence||1}`,
          lap:Number(live.current_lap),
          sector:Number(live.current_sector)||1,
          type:"red_flag_restart_pending",
          control_type:"RED_FLAG",
          lifecycle_phase:"restart_pending",
          message:`Restart procedure prepared under ${String(rules.restart_style||"era rules").replaceAll("_"," ")}.`,
        }],
      },
    },
  };
}

export function resumeLiveRace(gs){
  const weekend=gs?.raceWeekendState;
  const live=weekend?.live_race;
  if(!weekend||live?.status!=="red_flag")return gs;
  const rules=weekend?.race_strategy?.race_control_plan?.rules||{};
  const current=live?.red_flag_lifecycle||legacyRedFlagLifecycle({
    year:Number(gs?.activeYear)||1980,
    rules,
    live,
  });
  if(!current||String(current?.phase)!=="restart_pending"||current?.restart_authorized!==true)return gs;
  const completed=completeRedFlagRestart(current,{
    lap:Number(live.current_lap),
    sector:Number(live.current_sector)||1,
  });
  if(String(completed?.phase)!=="resumed")return gs;
  const history=[...(Array.isArray(live?.red_flag_history)?live.red_flag_history:[]),completed];
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      live_race:{
        ...live,
        status:"running",
        current_control:"GREEN",
        red_flag_period:null,
        red_flag_lifecycle:null,
        red_flag_history:history,
        events:[...(live.events||[]),{
          event_key:`red_flag_restart:${Number(live.current_lap)}:${Number(live.current_sector)||1}:${completed.sequence||1}`,
          lap:Number(live.current_lap),
          sector:Number(live.current_sector)||1,
          type:"restart",
          lifecycle_phase:"resumed",
          restart_style:completed.restart_style,
          message:`Race restarting under ${String(rules.restart_style||"era rules").replaceAll("_"," ")}.`,
        }],
      },
    },
  };
}

export function liveRaceReadyToFinalize(gs){
  const live=gs?.raceWeekendState?.live_race;
  return Boolean(
    live&&
    live.status==="finished"&&
    Number(live.current_lap)>=Number(live.total_laps)&&
    Number(live.current_sector??3)>=3
  );
}

export function finalizedLiveRaceRows(gs){
  const live=gs?.raceWeekendState?.live_race;
  if(!liveRaceReadyToFinalize(gs))return null;
  const projected=Array.isArray(live?.projected_race)?live.projected_race:[];
  const classification=Array.isArray(live?.classification)?live.classification:[];
  if(!projected.length||!classification.length)return null;
  const byId=new Map(classification.map((row)=>[String(row?.driver_id??""),row]));
  const totalLaps=Math.max(1,Number(live?.total_laps)||1);

  return projected
    .map((row,index)=>{
      const did=idOf(row?.driver||row);
      const visible=byId.get(did);
      if(!visible)return {...row,pos:Number(row?.pos??index+1)};
      const retired=Boolean(visible?.retired);
      const incidentLap=retired?Number(visible?.incident_lap)||null:null;
      const incidentSector=retired?Number(visible?.incident_sector)||1:null;
      const completedLaps=retired
        ?Math.max(0,Math.min(totalLaps,(incidentLap||1)-(incidentSector>=3?0:1)))
        :totalLaps;
      const filterToCompletedLap=(items,lapKey="lap")=>
        Array.isArray(items)
          ?items.filter((item)=>Number(item?.[lapKey]??0)<=completedLaps)
          :items;
      const lapTimes=Array.isArray(row?.lap_times_ms)
        ?row.lap_times_ms.slice(0,completedLaps)
        :row?.lap_times_ms;
      const pitStops=filterToCompletedLap(row?.pit_stops,"lap");
      const tyreStates=filterToCompletedLap(row?.tyre_state_by_lap,"lap");
      const strategyDecisions=filterToCompletedLap(row?.strategy_decisions,"lap");
      const stints=Array.isArray(row?.stints)
        ?row.stints
          .filter((stint)=>Number(stint?.start_lap??1)<=Math.max(1,completedLaps))
          .map((stint)=>({
            ...stint,
            end_lap:Math.min(Number(stint?.end_lap??completedLaps),completedLaps),
            laps:Math.max(
              0,
              Math.min(Number(stint?.end_lap??completedLaps),completedLaps)-Number(stint?.start_lap??1)+1
            ),
          }))
        :row?.stints;
      return {
        ...row,
        pos:Number(visible?.position??row?.pos??index+1),
        total_time_ms:Number.isFinite(Number(visible?.elapsed_ms))?Number(visible.elapsed_ms):row?.total_time_ms,
        retired,
        status:retired?"DNF":"Finished",
        retirement_reason:retired?(visible?.retirement_reason||"Retired"):null,
        incident_lap:incidentLap,
        incident_sector:incidentSector,
        laps_completed:completedLaps,
        race_laps:totalLaps,
        lap_times_ms:lapTimes,
        pit_stops:pitStops,
        tyre_state_by_lap:tyreStates,
        strategy_decisions:strategyDecisions,
        stints,
        strategy_summary:row?.strategy_summary
          ?(()=>{
            const actualPitStops=Array.isArray(pitStops)?pitStops:[];
            const actualStints=Array.isArray(stints)?stints:[];
            const actualTyreStates=Array.isArray(tyreStates)?tyreStates:[];
            const actualRefuelStops=actualPitStops.filter((pit)=>pit?.refuelled===true);
            const actualLowestTyre=actualTyreStates.length
              ?Math.min(...actualTyreStates.map((state)=>Number(state?.condition)).filter(Number.isFinite))
              :null;
            return {
              ...row.strategy_summary,
              pit_count:actualPitStops.length,
              pit_stops:actualPitStops.length,
              pit_laps:actualPitStops.map((pit)=>Number(pit?.lap)).filter(Number.isFinite),
              used_tyres:actualStints.map((stint)=>stint.compound).filter(Boolean),
              refuelled:actualRefuelStops.length>0,
              refuel_count:actualRefuelStops.length,
              fuel_stop_laps:actualRefuelStops.map((pit)=>Number(pit?.lap)).filter(Number.isFinite),
              strategy_decisions:Array.isArray(strategyDecisions)?strategyDecisions:row.strategy_summary.strategy_decisions,
              lowest_tyre_condition:Number.isFinite(actualLowestTyre)
                ?Number(actualLowestTyre.toFixed(1))
                :retired&&completedLaps===0
                  ?100
                  :row.strategy_summary.lowest_tyre_condition,
            };
          })()
          :row?.strategy_summary,
      };
    })
    .sort((a,b)=>Number(a?.pos??999)-Number(b?.pos??999));
}
