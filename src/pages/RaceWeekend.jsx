// src/pages/RaceWeekend.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { PRACTICE_PROGRAMMES } from "../engine/PracticeSetupEngine.js";
import { PIT_PLANS, RACE_PACE_MODES, tyresForTeam } from "../engine/RaceStrategyEngine.js";
import { raceForecastForTeam, teamRaceForecast } from "../engine/WeekendWeatherEngine.js";
import { conditionModifierBreakdown, practiceWeekendImpact } from "../domain/driverPerformance.js";
import { RACE_PLAYBACK_SPEEDS, racePlaybackCanRun, racePlaybackDelayMs } from "../domain/racePlayback.js";
import { driverFormSnapshot } from "../domain/driverForm.js";
import { DriverPortrait, TeamLogo } from "../components/entity/EntityVisuals.jsx";
import Track2DView from "../components/race/Track2DView.jsx";
import { Activity, Car, Cloud, CloudLightning, CloudRain, CloudSun, CircleDot, Droplets, Flag, Gauge, Pause, Play, Sun, Thermometer, Timer, Wind, Wrench, X } from "lucide-react";

const STEPS=[
  ["practice","Practice"],
  ["qualifying","Qualifying"],
  ["grid","Grid"],
  ["race","Race"],
  ["results","Results"],
];

function collectionRows(value){
  if(Array.isArray(value))return value;
  if(!value||typeof value!=="object")return [];
  for(const key of ["rows","items","entries","classification","results","grid"]){
    if(value[key]!=null){
      const nested=collectionRows(value[key]);
      if(nested.length||Array.isArray(value[key]))return nested;
    }
  }
  return Object.values(value).filter((row)=>row&&typeof row==="object"&&!Array.isArray(row));
}

function phaseIndex(phase){
  if(phase==="practice"||phase==="practice_complete")return 0;
  if(phase==="qualifying"||phase==="qualifying_wait")return 1;
  if(phase==="grid_ready")return 2;
  if(phase==="race")return 3;
  if(phase==="results"||phase==="completed")return 4;
  return 0;
}
function driverId(row){return String(row?.driver_id??row?.id??"");}
function driverObject(drivers,id){
  return (drivers||[]).find((row)=>driverId(row)===String(id))||null;
}
function driverName(drivers,id){
  const d=(drivers||[]).find((row)=>driverId(row)===String(id));
  return d?.display_name||d?.name||`${d?.first_name??""} ${d?.last_name??""}`.trim()||String(id||"—");
}
function teamName(teams,id){
  const t=(teams||[]).find((row)=>String(row?.team_id??row?.id??"")===String(id));
  return t?.team_name||t?.name||String(id||"—");
}
function tyreName(tyres,id){
  const tyre=(tyres||[]).find((row)=>String(row?.tyre_id??row?.id??"")===String(id??""));
  return tyre?.compound_name||String(id||"—");
}
function currentFatigue(gs,id){
  const direct=gs?.driverAttributes?.[String(id)];
  if(direct&&Number.isFinite(Number(direct.fatigue)))return Number(direct.fatigue);
  const digits=String(id??"").match(/(\d+)/)?.[1]?.padStart(4,"0");
  return Number(gs?.driverAttributes?.[digits]?.fatigue||0);
}
function formatLapTime(ms){
  const n=Number(ms);
  if(!Number.isFinite(n)||n<=0)return "—";
  const minutes=Math.floor(n/60000);
  const seconds=(n-minutes*60000)/1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6,"0")}`;
}
function formatGap(ms,bestMs){
  const n=Number(ms);
  const best=Number(bestMs);
  if(!Number.isFinite(n)||!Number.isFinite(best)||n<=0||best<=0)return "—";
  const delta=n-best;
  return delta<=0.5?"—":`+${(delta/1000).toFixed(3)}`;
}
function formatRaceTime(ms){
  const n=Number(ms);
  if(!Number.isFinite(n)||n<=0)return "—";
  const hours=Math.floor(n/3600000);
  const minutes=Math.floor((n-hours*3600000)/60000);
  const seconds=(n-hours*3600000-minutes*60000)/1000;
  return hours>0
    ?`${hours}:${String(minutes).padStart(2,"0")}:${seconds.toFixed(3).padStart(6,"0")}`
    :`${minutes}:${seconds.toFixed(3).padStart(6,"0")}`;
}
function formatInterval(ms,{leader=false}={}){
  const n=Number(ms);
  if(leader)return "LEADER";
  if(!Number.isFinite(n)||n<0)return "—";
  return "+"+(n/1000).toFixed(3);
}
function positionDelta(value){
  const n=Number(value)||0;
  if(n>0)return "▲ "+n;
  if(n<0)return "▼ "+Math.abs(n);
  return "—";
}
function pitWindowLabel(window){
  if(!window)return "Stay out";
  if(Number(window.from_lap)===Number(window.to_lap))return "L"+window.from_lap;
  return "L"+window.from_lap+"–"+window.to_lap;
}
function strategyReasonLabel(reason){
  return {
    player_call:"Team call",
    weather:"Weather change",
    neutralisation_window:"Neutralisation window",
    planned:"Planned stop",
    mandatory_compound:"Mandatory compound",
    degradation_value:"Strategic degradation",
    degradation:"Tyre degradation",
    tyre_safety:"Tyre safety",
    fuel:"Fuel",
  }[String(reason||"")]||String(reason||"Strategy").replaceAll("_"," ");
}
function paceLabel(mode){
  return RACE_PACE_MODES?.[String(mode)]?.label||String(mode||"Balanced").replaceAll("_"," ");
}
function signedLapDelta(ms){
  const n=Number(ms);
  if(!Number.isFinite(n))return "—";
  if(Math.abs(n)<1)return "±0.000";
  return (n>0?"+":"−")+(Math.abs(n)/1000).toFixed(3);
}
function lapDeltaTone(ms){
  const n=Number(ms);
  if(!Number.isFinite(n)||Math.abs(n)<1)return "text-slate-500";
  return n<0?"text-emerald-400":"text-rose-400";
}
function fatigueTone(value){
  const n=Number(value)||0;
  if(n<=25)return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  if(n<=55)return "text-amber-300 bg-amber-500/10 border-amber-500/20";
  if(n<=75)return "text-orange-300 bg-orange-500/10 border-orange-500/20";
  return "text-rose-300 bg-rose-500/10 border-rose-500/20";
}
function wearTone(multiplier){
  const n=Number(multiplier)||1;
  if(n<=0.85)return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  if(n<=1.05)return "text-slate-200 bg-white/[0.04] border-white/10";
  if(n<=1.20)return "text-amber-300 bg-amber-500/10 border-amber-500/20";
  return "text-rose-300 bg-rose-500/10 border-rose-500/20";
}
function conditionTone(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "text-slate-400 bg-white/[0.04]";
  if(n>=70)return "text-emerald-300 bg-emerald-500/10";
  if(n>=40)return "text-amber-300 bg-amber-500/10";
  if(n>=20)return "text-orange-300 bg-orange-500/10";
  return "text-rose-300 bg-rose-500/15";
}
function paceTone(mode){
  const key=String(mode||"balanced");
  if(key==="attack")return "text-rose-300 bg-rose-500/10";
  if(key==="conserve")return "text-cyan-300 bg-cyan-500/10";
  return "text-slate-200 bg-white/[0.04]";
}
function temperatureTone(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "text-slate-400";
  if(n<75)return "text-cyan-300";
  if(n<=105)return "text-emerald-300";
  if(n<=120)return "text-amber-300";
  return "text-rose-300";
}
function tyreVisual(compound){
  const key=String(compound||"").toLowerCase();
  if(key.includes("inter"))return {label:"I",ring:"#39ff14",code:"INTER"};
  if(key.includes("wet"))return {label:"W",ring:"#18a8ff",code:"WET"};
  if(key.includes("option")||key.includes("soft"))return {label:"S",ring:"#ff3030",code:"SOFT"};
  if(key.includes("medium"))return {label:"M",ring:"#ffd800",code:"MEDIUM"};
  if(key.includes("prime")||key.includes("hard"))return {label:"H",ring:"#f5f7fa",code:"HARD"};
  const cMatch=key.match(/(?:^|\\b)c([1-5])(?:\\b|$)/);
  if(cMatch){
    const number=Number(cMatch[1]);
    return {
      label:`C${number}`,
      ring:number<=2?"#f5f7fa":number===3?"#ffd800":"#ff3030",
      code:`C${number}`,
    };
  }
  return {label:"T",ring:"#94a3b8",code:String(compound||"TYRE").toUpperCase()};
}
function TyreCompoundIcon({compound,size=24,title=null,className=""}){
  const visual=tyreVisual(compound);
  return <span
    title={title||String(compound||"Tyre")}
    aria-label={String(compound||"Tyre")}
    className={"relative inline-flex shrink-0 items-center justify-center rounded-full bg-[#07090d] shadow-inner "+className}
    style={{width:size,height:size,border:`${Math.max(2,Math.round(size*0.105))}px solid ${visual.ring}`,boxShadow:"inset 0 0 0 2px rgba(255,255,255,.07), 0 0 0 1px rgba(0,0,0,.8)"}}
  >
    <span className="absolute rounded-full border border-slate-500/70 bg-gradient-to-br from-slate-300 via-slate-500 to-slate-800" style={{width:Math.round(size*.48),height:Math.round(size*.48)}}/>
    <span className="relative z-10 rounded-full bg-[#11151b] px-0.5 text-center font-black leading-none" style={{fontSize:Math.max(6,Math.round(size*.23)),color:visual.ring}}>{visual.label}</span>
  </span>;
}
function TyreCompoundBadge({compound,age=null,compact=false}){
  return <span className="inline-flex items-center gap-1.5">
    <TyreCompoundIcon compound={compound} size={compact?22:26}/>
    <span className="font-bold">{compound||"—"}{age!=null?` ${age}L`:""}</span>
  </span>;
}

function tyreTone(compound){
  const key=String(compound||"").toLowerCase();
  if(key.includes("soft"))return "bg-rose-500 text-white";
  if(key.includes("medium"))return "bg-amber-400 text-slate-950";
  if(key.includes("hard"))return "bg-slate-100 text-slate-950";
  if(key.includes("inter"))return "bg-emerald-500 text-white";
  if(key.includes("wet"))return "bg-blue-500 text-white";
  return "bg-slate-600 text-white";
}
function programmeIntensity(programme){
  const fatigue=Number(programme?.fatigue)||0;
  if(fatigue<=5)return {label:"Light",tone:"text-emerald-300"};
  if(fatigue<=8)return {label:"Standard",tone:"text-slate-200"};
  return {label:"Heavy",tone:"text-amber-300"};
}
function signedValue(value,digits=2){
  const n=Number(value)||0;
  return (n>=0?"+":"")+n.toFixed(digits);
}
function forecastTimingLabel(forecast,totalLaps){
  const timing=forecast?.timing;
  const total=Math.max(1,Number(totalLaps)||1);
  if(!timing)return "Timing uncertainty unavailable";
  if(Number.isFinite(Number(timing.window_low_pct))&&Number.isFinite(Number(timing.window_high_pct))){
    const low=Math.max(1,Math.round(Number(timing.window_low_pct)*total));
    const high=Math.max(low,Math.round(Number(timing.window_high_pct)*total));
    return timing.mode==="rain_easing"
      ?"Rain may ease around L"+low+"–L"+high
      :"Weather transition window L"+low+"–L"+high;
  }
  if(Number.isFinite(Number(timing.horizon_pct))){
    const horizon=Math.max(1,Math.round(Number(timing.horizon_pct)*total));
    return "Forecast horizon ~"+horizon+" laps";
  }
  return String(timing.mode||"forecast").replaceAll("_"," ");
}
function impactDescriptor(value){
  const n=Number(value)||0;
  if(n>=2)return {label:"Strong performance gain",short:"Strong gain",tone:"text-emerald-300 bg-emerald-500/10 border-emerald-500/20"};
  if(n>=1)return {label:"Useful performance gain",short:"Useful gain",tone:"text-emerald-300 bg-emerald-500/10 border-emerald-500/20"};
  if(n>=0.35)return {label:"Small performance gain",short:"Small gain",tone:"text-sky-300 bg-sky-500/10 border-sky-500/20"};
  if(n>-0.35)return {label:"No meaningful pace change",short:"Neutral",tone:"text-slate-300 bg-white/[0.04] border-white/10"};
  if(n>-1)return {label:"Small performance loss",short:"Small loss",tone:"text-amber-300 bg-amber-500/10 border-amber-500/20"};
  return {label:"Clear performance loss",short:"Clear loss",tone:"text-rose-300 bg-rose-500/10 border-rose-500/20"};
}
function weatherStateLabel(state){
  const key=String(state||"UNKNOWN").toUpperCase();
  return {
    SUNNY:"Sunny",CLOUDY:"Cloudy",WINDY:"Windy",DRYING:"Drying",
    DRIZZLE_DRYING:"Drying drizzle",WETTING:"Rain arriving",LIGHT_RAIN:"Light rain",
    HEAVY_RAIN:"Heavy rain",STORM:"Storm",
  }[key]||key.replaceAll("_"," ");
}
function WeatherStateIcon({state,className="h-5 w-5"}){
  const key=String(state||"").toUpperCase();
  if(key==="SUNNY")return <Sun className={className}/>;
  if(key==="CLOUDY")return <Cloud className={className}/>;
  if(key==="WINDY")return <Wind className={className}/>;
  if(key==="DRYING")return <CloudSun className={className}/>;
  if(key==="STORM")return <CloudLightning className={className}/>;
  if(["WETTING","LIGHT_RAIN","HEAVY_RAIN","DRIZZLE_DRYING"].includes(key))return <CloudRain className={className}/>;
  return <CloudSun className={className}/>;
}
function forecastRaceWindows(forecast,totalLaps){
  const total=Math.max(1,Math.round(Number(totalLaps)||1));
  const timing=forecast?.timing||{};
  const state=String(forecast?.predicted_state||"UNKNOWN").toUpperCase();
  const low=Number.isFinite(Number(timing.window_low_pct))
    ?Math.max(1,Math.round(Number(timing.window_low_pct)*total)):null;
  const high=Number.isFinite(Number(timing.window_high_pct))
    ?Math.max(low||1,Math.round(Number(timing.window_high_pct)*total)):null;
  if(low&&high&&timing.mode==="rain_arrival"){
    return [
      {from:1,to:Math.max(1,low-1),state:"DRYING",label:"Mostly dry"},
      {from:low,to:high,state:"WETTING",label:"Rain arrival window"},
      {from:Math.min(total,high+1),to:total,state:state==="WETTING"?"LIGHT_RAIN":state,label:"Rain risk"},
    ].filter((row)=>row.from<=row.to);
  }
  if(low&&high&&timing.mode==="rain_easing"){
    return [
      {from:1,to:Math.max(1,low-1),state:"LIGHT_RAIN",label:"Wet phase"},
      {from:low,to:high,state:"DRYING",label:"Drying window"},
      {from:Math.min(total,high+1),to:total,state:"DRYING",label:"Improving"},
    ].filter((row)=>row.from<=row.to);
  }
  const cuts=[1,Math.floor(total*0.25)+1,Math.floor(total*0.50)+1,Math.floor(total*0.75)+1,total+1];
  return [0,1,2,3].map((index)=>({
    from:cuts[index],to:Math.max(cuts[index],cuts[index+1]-1),state,
    label:weatherStateLabel(state),
  })).filter((row)=>row.from<=total).map((row)=>({...row,to:Math.min(total,row.to)}));
}
function indexDescriptor(value,{inverse=false}={}){
  const n=Math.max(0,Math.min(100,Number(value)||0));
  const level=n<30?"Low":n<55?"Moderate":n<75?"High":"Very high";
  const tone=n<30?"text-emerald-300":n<55?"text-slate-200":n<75?"text-amber-300":"text-rose-300";
  return {level,tone,inverse};
}
function liveEventText(event,drivers,tyres=[]){
  const name=event?.driver_id?driverName(drivers,event.driver_id):null;
  if(event?.type==="command"&&name){
    if(event?.command?.type==="pace"){
      const instruction={
        attack:"push",
        conserve:"conserve tyres",
        balanced:"maintain balanced pace",
      }[String(event.command.pace_mode||"balanced")]||String(event.command.pace_mode||"balanced").replaceAll("_"," ");
      return `${name} was told to ${instruction}.`;
    }
    if(event?.command?.type==="pit"){
      return `${name} was told to pit next lap for ${tyreName(tyres,event.command.tyre_id)} tyres.`;
    }
  }
  if(event?.type==="pit"&&name&&event?.tyre_to){
    const from=event.tyre_from||tyreName(tyres,event.tyre_from_id);
    const to=event.tyre_to||tyreName(tyres,event.tyre_to_id);
    const loss=Number.isFinite(Number(event.total_loss_s))?`${Number(event.total_loss_s).toFixed(1)}s lost`:"pit stop";
    const positions=Number.isFinite(Number(event.position_before))&&Number.isFinite(Number(event.position_after))
      ?`, P${event.position_before} → P${event.position_after}`
      :"";
    return `${name} changed from ${from} to ${to} tyres (${loss}${positions}).`;
  }
  const raw=String(event?.message||event?.type||"");
  if(!name)return raw;
  const id=String(event.driver_id);
  if(raw.startsWith(id+":"))return name+raw.slice(id.length);
  if(raw.startsWith(id+" "))return name+raw.slice(id.length);
  return raw.includes(name)?raw:name+" · "+raw;
}

function raceEventLabel(event){
  if(event?.type==="event_batch")return `${event.events?.length||0} race updates`;
  if(event?.type==="weather_report")return {
    rain_started:"Rain started",
    rain_rising:"Rain intensifying",
    rain_easing:"Rain easing",
    rain_stopped:"Rain stopped",
    standing_water:"Standing water",
    visibility:"Poor visibility",
    drying_track:"Track drying",
  }[String(event?.report_kind||"")]||"Weather report";
  if(event?.type==="pit")return event?.crew_error?"Pit crew incident":"Pit stop report";
  if(event?.type==="race_control")return String(event?.control_type||"Race control").replaceAll("_"," ");
  if(event?.type==="incident")return "Race incident";
  if(event?.type==="driver_feedback")return "Driver feedback";
  return String(event?.type||"Event").replaceAll("_"," ");
}
function raceEventIcon(event,className="h-5 w-5"){
  const common={className};
  if(event?.type==="pit")return <Wrench {...common}/>;
  if(event?.type==="incident"||String(event?.control_type||"")==="RED_FLAG")return <Flag {...common}/>;
  if(event?.type==="driver_feedback")return <Activity {...common}/>;
  if(event?.type==="weather_report"){
    const kind=String(event?.report_kind||"");
    if(kind==="rain_rising")return <CloudLightning {...common}/>;
    if(kind==="rain_easing")return <CloudSun {...common}/>;
    if(kind==="rain_stopped"||kind==="drying_track")return <Sun {...common}/>;
    if(kind==="standing_water")return <Droplets {...common}/>;
    if(kind==="visibility")return <Wind {...common}/>;
    return <CloudRain {...common}/>;
  }
  if(event?.type==="weather")return <CloudRain {...common}/>;
  return <CircleDot {...common}/>;
}
function popupWorthyRaceEvent(event,playerTeamId){
  const type=String(event?.type||"");
  const message=String(event?.message||"");
  const control=String(event?.control_type||"");
  if(type==="incident"||type==="weather_report")return true;
  if(type==="pit")return Boolean(event?.crew_error)||String(event?.team_id||"")===String(playerTeamId||"");
  if(type==="race_control"&&(event?.cause==="incident"||control==="RED_FLAG"))return true;
  return /dnf|retir|collision|crash/i.test(message);
}
function batchRaceEvents(events,playerTeamId,currentLap){
  const popupEvents=(events||[]).filter((event)=>popupWorthyRaceEvent(event,playerTeamId));
  if(!popupEvents.length)return null;
  const latestLap=Math.max(...popupEvents.map((event)=>Number(event?.lap)||0));
  if(currentLap&&latestLap<Number(currentLap)-1)return null;
  const sameLap=popupEvents.filter((event)=>Number(event?.lap||0)===latestLap);
  if(sameLap.length===1)return sameLap[0];
  const key=sameLap.map((event)=>String(event?.event_key||[
    event?.type,event?.lap,event?.sector,event?.driver_id,event?.message,
  ].join(":"))).join("|");
  return {
    type:"event_batch",
    lap:latestLap,
    sector:null,
    events:sameLap,
    event_key:`event_batch:${latestLap}:${key}`,
  };
}
function incidentNoticeText(incident,drivers){
  if(!incident)return "Race control intervention";
  const who=driverName(drivers,incident.driver_id);
  const kind=String(incident.kind||incident.reason||"incident").toLowerCase();
  if(kind==="mechanical"){
    return `${who} — ${String(incident.reason||"mechanical").toLowerCase()} problem`;
  }
  const noun=kind.includes("collision")?"collision":kind.includes("accident")?"accident":"incident";
  const adjective={
    low:"minor",
    medium:"significant",
    high:"heavy",
    critical:"serious",
  }[String(incident.severity||"medium").toLowerCase()]||"significant";
  return String(incident.severity||"").toLowerCase()==="critical"
    ?`Serious ${noun} involving ${who}`
    :`${who} — ${adjective} ${noun}`;
}
function controlNotice(plan,liveRace,drivers){
  const lap=Number(liveRace?.current_lap)||0;
  const current=String(liveRace?.current_control||"GREEN");
  if(current==="GREEN")return null;
  const period=(plan?.periods||[]).find((row)=>lap>=Number(row?.from_lap)&&lap<=Number(row?.to_lap))
    ||liveRace?.red_flag_period
    ||null;
  const incident=period
    ?(plan?.incidents||[]).find((row)=>
        (period?.driver_id&&String(row?.driver_id)===String(period.driver_id)&&Number(row?.lap)===Number(period?.from_lap))||
        (!period?.driver_id&&Number(row?.lap)===Number(period?.from_lap)&&Number(row?.sector??1)===Number(period?.from_sector??1))
      )||null
    :null;
  const label={
    LOCAL_YELLOW:"YELLOW FLAG",
    SAFETY_CAR:"SAFETY CAR",
    VSC:"VIRTUAL SAFETY CAR",
    RED_FLAG:"RED FLAG",
  }[current]||current.replaceAll("_"," ");
  let reason="Race control intervention";
  if(period?.cause==="weather")reason="Extreme weather conditions";
  else if(incident){
    reason=incidentNoticeText(incident,drivers);
  }else if(period?.cause==="incident")reason="Incident on track";
  else if(period?.cause)reason=String(period.cause).replaceAll("_"," ");
  return {label,reason,type:current,period};
}
function raceFlagNotice(plan,liveRace,drivers){
  if(String(liveRace?.status||"")==="finished"){
    return {type:"CHEQUERED",label:"CHEQUERED FLAG",subtitle:"RACE FINISHED",reason:"Race distance complete"};
  }
  const current=String(liveRace?.current_control||"GREEN");
  if(current==="GREEN"){
    return {type:"GREEN",label:"GREEN FLAG",subtitle:"TRACK CLEAR",reason:"Racing conditions"};
  }
  const notice=controlNotice(plan,liveRace,drivers)||{type:current,label:current.replaceAll("_"," "),reason:"Race control intervention"};
  const lap=Number(liveRace?.current_lap)||0;
  const safetyCarInThisLap=notice.type==="SAFETY_CAR"&&Number(notice?.period?.to_lap)===lap;
  const subtitle={
    LOCAL_YELLOW:"CAUTION",
    SAFETY_CAR:safetyCarInThisLap?"IN THIS LAP":"DEPLOYED",
    VSC:"VIRTUAL SAFETY CAR",
    RED_FLAG:"SESSION STOPPED",
  }[notice.type]||"RACE CONTROL";
  return {...notice,subtitle};
}
function RaceFlagBanner({notice}){
  if(!notice)return null;
  const type=String(notice.type||"GREEN");
  const palette={
    GREEN:"border-emerald-400 bg-emerald-950/90 text-emerald-300 shadow-emerald-500/10",
    LOCAL_YELLOW:"border-yellow-300 bg-yellow-950/90 text-yellow-300 shadow-yellow-500/10",
    SAFETY_CAR:"border-yellow-300 bg-[#171500]/95 text-yellow-300 shadow-yellow-500/10",
    VSC:"border-yellow-300 bg-[#171500]/95 text-yellow-300 shadow-yellow-500/10",
    RED_FLAG:"border-red-500 bg-red-950/90 text-red-300 shadow-red-500/10",
    CHEQUERED:"border-slate-200 bg-[#111318]/95 text-white shadow-white/10",
  }[type]||"border-slate-400 bg-slate-950/90 text-slate-100 shadow-black/20";
  const icon=type==="SAFETY_CAR"
    ?<Car className="h-6 w-6"/>
    :type==="CHEQUERED"
      ?<span aria-hidden="true" className="grid h-6 w-6 grid-cols-3 grid-rows-3 overflow-hidden rounded-sm border border-white/40">
          {Array.from({length:9},(_,index)=><span key={index} className={(Math.floor(index/3)+index%3)%2===0?"bg-white":"bg-slate-950"}/>)}
        </span>
      :<Flag className="h-6 w-6 fill-current"/>;
  return <div className={"w-[205px] min-h-[52px] overflow-hidden rounded-lg border shadow-lg "+palette}>
    <div className="flex h-[34px] items-center gap-2 px-2 py-1">
      <div className="flex h-6 w-7 shrink-0 items-center justify-center border-r border-current/30 pr-2">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-black italic tracking-wide">{notice.label}</div>
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-80">{notice.subtitle}</div>
      </div>
    </div>
    <div className="min-h-[18px] border-t border-current/15 px-2 py-1 text-right text-[9px] opacity-75">
      {notice.reason||"Race control"}
    </div>
  </div>;
}
function controlNoticeTone(type){
  if(type==="RED_FLAG")return "border-red-500/50 bg-red-950/80 text-red-100";
  if(type==="SAFETY_CAR"||type==="VSC")return "border-amber-400/50 bg-amber-500/15 text-amber-100";
  return "border-yellow-400/50 bg-yellow-500/15 text-yellow-100";
}
function raceWindowForPhase(phase,hasLive=false){
  if(phase==="practice"||phase==="practice_complete")return "practice";
  if(phase==="qualifying"||phase==="qualifying_wait")return "qualifying";
  if(phase==="grid_ready")return "strategy";
  if(phase==="race")return hasLive?"live":"grid";
  if(phase==="results"||phase==="completed")return "classification";
  return "overview";
}
function statusClass(status){
  const key=String(status||"").toUpperCase();
  if(["QUALIFIED","ADVANCED","STARTER","CONTINUES","FINISHED"].includes(key))return "bg-emerald-500/15 text-emerald-300";
  if(["DNQ","DNPQ","ELIMINATED","DNF","RETIRED"].includes(key))return "bg-amber-500/15 text-amber-300";
  return "bg-slate-100 text-slate-700";
}
function sessionStatus(row,session){
  if(row?.status)return String(row.status).toUpperCase();
  if(session?.advance_count)return "ADVANCED";
  return "CONTINUES";
}
function QualifyingTable({title,rows=[],drivers,teams,session=null,overall=false,cutoff=null,playerTeamId=""}){
  const ordered=rows.slice().sort((a,b)=>Number(a?.position??999)-Number(b?.position??999));
  const times=ordered.map((row)=>Number(row?.best_time_ms??row?.lap_time_ms)).filter((value)=>Number.isFinite(value)&&value>0);
  const best=times.length?Math.min(...times):null;
  const columnCount=ordered.length>16?2:1;
  const groupSize=Math.ceil(ordered.length/columnCount);
  const groups=Array.from({length:columnCount},(_,index)=>({
    rows:ordered.slice(index*groupSize,(index+1)*groupSize),
    offset:index*groupSize,
  })).filter((group)=>group.rows.length);

  const renderGroup=({rows:group,offset})=><div className="overflow-hidden rounded-lg border border-white/10 bg-[#11161f]" key={offset}>
    <table className="w-full text-xs leading-snug">
      <thead className="bg-[#171d27] text-[10px] uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-2 py-1.5 text-right w-8">Pos</th>
          <th className="px-2 py-1.5 text-left">Driver / Team</th>
          <th className="px-2 py-1.5 text-right">Time / Gap</th>
          <th className="px-2 py-1.5 text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {group.map((row,localIndex)=>{
          const globalIndex=offset+localIndex;
          const time=Number(row?.best_time_ms??row?.lap_time_ms);
          const status=overall?String(row?.status||"").toUpperCase():sessionStatus(row,session);
          const eliminated=["ELIMINATED","DNQ","DNPQ","CUT"].includes(status);
          const atCutoff=Number.isFinite(Number(cutoff))&&globalIndex===Number(cutoff);
          const driver=driverObject(drivers,row.driver_id);
          return <React.Fragment key={row.driver_id||globalIndex}>
            {atCutoff&&<tr className="border-y border-amber-400/30 bg-amber-500/10">
              <td colSpan={4} className="px-2 py-1 text-[9px] font-medium text-amber-300">Cut — first {cutoff} qualify</td>
            </tr>}
            <tr className={"border-t border-white/5 "+(eliminated?"bg-red-950/55 text-red-100":String(row?.team_id||"")===String(playerTeamId)?"bg-amber-500/[0.10] ring-1 ring-inset ring-amber-400/20":"hover:bg-white/[0.025]")}>
              <td className="px-2 py-1.5 text-right font-bold">P{row.position??globalIndex+1}</td>
              <td className="px-2 py-1 min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <DriverPortrait driver={driver||{display_name:driverName(drivers,row.driver_id)}} size="h-6 w-6" className="shrink-0 ring-white/10"/>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 truncate font-semibold text-slate-100">{String(row?.team_id||"")===String(playerTeamId)?<span className="text-amber-300">●</span>:null}{driverName(drivers,row.driver_id)}</div>
                    <div className="flex min-w-0 items-center gap-1 text-[9px] text-slate-500">
                      <TeamLogo teamId={String(row.team_id||"")} name={teamName(teams,row.team_id)} size="h-3.5 w-3.5" className="shrink-0 p-0"/>
                      <span className="truncate">{teamName(teams,row.team_id)}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">
                <span>{formatLapTime(time)}</span>
                <span className="ml-1.5 text-[9px] text-slate-600">{formatGap(time,best)}</span>
              </td>
              <td className="px-2 py-1.5 text-right">
                <span className={"rounded px-1.5 py-0.5 text-[9px] "+statusClass(status)}>{status||"—"}</span>
              </td>
            </tr>
          </React.Fragment>;
        })}
      </tbody>
    </table>
  </div>;

  const gridClass=columnCount===3
    ?"grid gap-2 xl:grid-cols-3"
    :columnCount===2
      ?"grid gap-2 xl:grid-cols-2"
      :"grid gap-2";
  return <div className="rounded-xl border border-white/10 bg-[#0f141d] p-2.5">
    {title&&<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div className="font-medium text-xs">{title}</div>
      <div className="text-[10px] text-slate-500">{ordered.length} drivers · {columnCount} column{columnCount>1?"s":""}</div>
    </div>}
    <div className={gridClass}>{groups.map(renderGroup)}</div>
  </div>;
}

export default function RaceWeekend(){
  const navigate=useNavigate();
  const gs=useGame((s)=>s.gameState);
  const runPractice=useGame((s)=>s.completeRaceWeekendPractice);
  const setPracticeProgramme=useGame((s)=>s.setRaceWeekendPracticeProgramme);
  const setRaceStrategy=useGame((s)=>s.setRaceWeekendStrategy);
  const runQualifying=useGame((s)=>s.completeRaceWeekendQualifying);
  const runRace=useGame((s)=>s.completeRaceWeekendRace);
  const startLiveRace=useGame((s)=>s.startRaceWeekendLiveRace);
  const advanceLiveRace=useGame((s)=>s.advanceRaceWeekendLiveRace);
  const advanceLiveRaceSector=useGame((s)=>s.advanceRaceWeekendLiveRaceSector);
  const setLiveCommand=useGame((s)=>s.setRaceWeekendLiveCommand);
  const cancelLiveCommand=useGame((s)=>s.cancelRaceWeekendLiveCommand);
  const setRedFlagTyre=useGame((s)=>s.setRaceWeekendRedFlagTyre);
  const assessLiveRaceRestart=useGame((s)=>s.assessRaceWeekendLiveRaceRestart);
  const prepareLiveRaceRestart=useGame((s)=>s.prepareRaceWeekendLiveRaceRestart);
  const resumeLiveRace=useGame((s)=>s.resumeRaceWeekendLiveRace);
  const continueWeekend=useGame((s)=>s.continueRaceWeekendSession);
  const advance=useGame((s)=>s.advanceOneDayUntilBreak);
  const pushToast=useGame((s)=>s.pushToast);
  const [busy,setBusy]=useState(false);
  const [activeWindow,setActiveWindow]=useState("overview");
  const [liveTimingMode,setLiveTimingMode]=useState("overall");
  const [selectedLiveDriverId,setSelectedLiveDriverId]=useState("");
  const [selectedRaceEvent,setSelectedRaceEvent]=useState(null);
  const [racePlaying,setRacePlaying]=useState(false);
  const [racePlaybackSpeed,setRacePlaybackSpeed]=useState(1);
  const lastAutoPopupKey=useRef(null);

  const weekend=gs?.raceWeekendState;
  const drivers=gs?.drivers||[];
  const teams=gs?.teams||[];
  const playerTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const playerEntrants=collectionRows(weekend?.entrants).filter((row)=>String(row?.team_id??"")===playerTeamId&&row?.driver_id);
  const practiceResults=collectionRows(weekend?.practice?.results);
  const playerPracticeResults=practiceResults.filter((row)=>String(row?.team_id??"")===playerTeamId);
  const currentIndex=phaseIndex(weekend?.phase);
  const classification=collectionRows(weekend?.qualifying?.classification);
  const startingGridRows=collectionRows(weekend?.startingGrid?.rows??weekend?.startingGrid??weekend?.grid);
  const qualifyingSessions=collectionRows(weekend?.sessions).filter((row)=>["prequalifying","qualifying"].includes(row?.type));
  const activeSession=(weekend?.sessions||[]).find((row)=>String(row?.id)===String(weekend?.active_session_id||""))
    ||qualifyingSessions.find((row)=>row?.status!=="completed")
    ||null;
  const dnqRows=classification.filter((row)=>["DNQ","DNPQ"].includes(String(row?.status||"")));
  const raceStrategy=weekend?.race_strategy||null;
  const liveRace=weekend?.live_race||null;
  const redFlagLifecycle=liveRace?.red_flag_lifecycle||null;
  const restartMonitor=redFlagLifecycle?.restart_monitor||null;
  const liveRows=collectionRows(liveRace?.classification);
  const trackState=liveRace?.track_state||null;
  const timingSummary=liveRace?.timing_summary||null;
  const raceViewEvents=useMemo(()=>collectionRows(liveRace?.events).slice(-40).reverse().map((event)=>({
    ...event,
    display_text:liveEventText(event,drivers,gs?.tyres||gs?.dbTyres||[]),
  })),[liveRace?.events,drivers,gs?.tyres,gs?.dbTyres]);
  const liveBestSectors=useMemo(()=>{
    const values=(key)=>liveRows.map((row)=>Number(row?.[key])).filter((value)=>Number.isFinite(value)&&value>0);
    const s1=values("sector_1_ms"),s2=values("sector_2_ms"),s3=values("sector_3_ms");
    return {
      sector_1_ms:s1.length?Math.min(...s1):null,
      sector_2_ms:s2.length?Math.min(...s2):null,
      sector_3_ms:s3.length?Math.min(...s3):null,
    };
  },[liveRows]);
  const raceControlPlan=raceStrategy?.race_control_plan||null;
  const raceControlRules=raceControlPlan?.rules||null;
  const weekendWeather=weekend?.weekend_weather||null;
  const weatherObserved=new Set(weekendWeather?.observed_sessions||[]);
  const weatherSessionRows=collectionRows(weekend?.sessions).filter((session)=>weekendWeather?.sessions?.[String(session?.id||"")]);
  const activeWeather=weekendWeather?.sessions?.[String(weekend?.active_session_id||"")]||null;
  const raceWeatherRow=Object.values(weekendWeather?.sessions||{}).find((row)=>row?.kind==="race")||null;
  const completedQualifyingSessions=qualifyingSessions.filter((session)=>session.status==="completed");
  const lastCompletedQualifyingSession=completedQualifyingSessions.at(-1)||null;
  const confirmedEntrants=collectionRows(weekend?.entrants).filter((row)=>row?.status==="confirmed"&&row?.driver_id);
  const selectedEventDriverId=String(selectedRaceEvent?.driver_id??"");
  const selectedEventDriver=selectedEventDriverId?driverObject(drivers,selectedEventDriverId):null;
  const selectedEventTeamId=selectedEventDriverId?String(
    selectedRaceEvent?.team_id
      ??liveRows.find((row)=>String(row?.driver_id??"")===selectedEventDriverId)?.team_id
      ??confirmedEntrants.find((row)=>String(row?.driver_id??"")===selectedEventDriverId)?.team_id
      ??""
  ):"";
  const qualifyingCutoff=Number(weekend?.qualifying_rule_snapshot?.max_starters??weekend?.qualifying?.cutoff_position);
  const activeControlNotice=controlNotice(raceControlPlan,liveRace,drivers);
  const liveTeamForecast=teamRaceForecast(gs,{
    currentLap:liveRace?.current_lap||0,
    currentWeather:liveRace?.last_weather||null,
    totalLaps:liveRace?.total_laps||raceStrategy?.track_snapshot?.laps,
  });
  const lastObservedWeather=lastCompletedQualifyingSession
    ?weekendWeather?.sessions?.[String(lastCompletedQualifyingSession.id)]
    :null;
  const strategyTeamForecast=teamRaceForecast(gs,{
    currentLap:0,
    currentWeather:null,
    totalLaps:raceStrategy?.track_snapshot?.laps,
  });
  const strategyRaceForecast=raceForecastForTeam(gs,playerTeamId);
  const activeQualifyingForecast=weekendWeather?.forecast?.[String(activeSession?.id||"")]||null;
  const activeQualifyingWeather=weekendWeather?.sessions?.[String(activeSession?.id||"")]||null;
  const practiceTrackInputs=weekend?.practice?.track_profile?.inputs||{};
  useEffect(()=>{
    setActiveWindow(raceWindowForPhase(weekend?.phase,Boolean(liveRace)));
  },[weekend?.phase,Boolean(liveRace)]);
  useEffect(()=>{
    if(!liveRace){
      setSelectedLiveDriverId("");
      return;
    }
    setSelectedLiveDriverId((current)=>{
      if(current&&liveRows.some((row)=>String(row?.driver_id??"")===String(current)))return current;
      const own=liveRows.find((row)=>String(row?.team_id??"")===playerTeamId);
      return String(own?.driver_id??liveRows[0]?.driver_id??"");
    });
  },[Boolean(liveRace),liveRows.length,playerTeamId]);
  useEffect(()=>{
    if(!liveRace||weekend?.phase!=="race"||!racePlaybackCanRun(liveRace)){
      if(racePlaying)setRacePlaying(false);
      return undefined;
    }
    if(!racePlaying||busy)return undefined;
    const timer=window.setTimeout(()=>{
      perform(()=>advanceLiveRaceSector(1));
    },racePlaybackDelayMs(racePlaybackSpeed));
    return ()=>window.clearTimeout(timer);
  },[
    racePlaying,
    racePlaybackSpeed,
    busy,
    weekend?.phase,
    liveRace?.status,
    liveRace?.current_lap,
    liveRace?.current_sector,
    liveRace?.total_laps,
  ]);
  useEffect(()=>{
    if(!liveRace)return;
    const currentLap=Number(liveRace?.current_lap)||0;
    const important=batchRaceEvents(liveRace?.events||[],playerTeamId,currentLap);
    if(!important)return;
    const key=String(important?.event_key||[important?.type,important?.lap,important?.sector,important?.driver_id,important?.message].join(":"));
    if(!key||lastAutoPopupKey.current===key)return;
    lastAutoPopupKey.current=key;
    setSelectedRaceEvent(important);
  },[liveRace?.events?.length,liveRace?.current_lap,liveRace?.current_sector,playerTeamId]);

  const lastResult=useMemo(()=>{
    const key=weekend?.race_result_key;
    if(!key)return null;
    return (gs?.results||[]).find((row)=>row?.key===key)||null;
  },[gs?.results,weekend?.race_result_key]);

  const driverStandings=gs?.standings?.drivers||[];
  const constructorStandings=gs?.standings?.teams||gs?.standings?.constructors||[];
  const driverStandingById=new Map(driverStandings.map((row,index)=>[
    String(row?.driver_id??row?.id??""),
    {position:Number(row?.position??index+1),points:Number(row?.points??0)},
  ]));
  const constructorStandingById=new Map(constructorStandings.map((row,index)=>[
    String(row?.team_id??row?.constructor_id??row?.id??""),
    {position:Number(row?.position??index+1),points:Number(row?.points??0)},
  ]));
  const entrantIds=new Set(confirmedEntrants.map((row)=>String(row.driver_id)));
  const strategyFormLeaders=confirmedEntrants.map((entry)=>({
    driver_id:String(entry.driver_id),
    form:driverFormSnapshot(gs,entry.driver_id),
  })).filter((row)=>Number.isFinite(Number(row.form?.score)))
    .sort((a,b)=>Number(b.form.score)-Number(a.form.score))
    .slice(0,3);
  const qualifyingOverperformers=classification.map((row)=>{
    const form=driverFormSnapshot(gs,row.driver_id);
    const expected=Number(form?.entries?.[0]?.expected_finish);
    const position=Number(row?.position);
    return {
      driver_id:String(row.driver_id),
      position,
      expected,
      delta:Number.isFinite(expected)&&Number.isFinite(position)?expected-position:null,
    };
  }).filter((row)=>Number.isFinite(row.delta)&&row.delta>0.4)
    .sort((a,b)=>b.delta-a.delta)
    .slice(0,3);
  const gpWinnerCounts=new Map();
  for(const result of gs?.results||[]){
    const sameGp=String(result?.gp_id||"")===String(weekend?.gp_id||"")
      ||String(result?.name||result?.gp_name||"").toLowerCase()===String(weekend?.gp_name||"").toLowerCase();
    if(!sameGp)continue;
    const winner=(result?.classification||[]).find((row)=>Number(row?.position)===1)||(result?.classification||[])[0];
    const did=String(winner?.driver_id||"");
    if(did&&entrantIds.has(did))gpWinnerCounts.set(did,(gpWinnerCounts.get(did)||0)+1);
  }
  const previousGpWinners=[...gpWinnerCounts.entries()]
    .map(([driver_id,wins])=>({driver_id,wins}))
    .sort((a,b)=>b.wins-a.wins)
    .slice(0,3);
  const strategyForecastWindows=forecastRaceWindows(strategyRaceForecast,raceStrategy?.track_snapshot?.laps);

  const terminalWeekend=["results","completed"].includes(String(weekend?.phase));
  const windowTabs=[
    {id:"overview",label:"Forecast",enabled:true},
    {id:"practice",label:"Practice",enabled:!terminalWeekend&&(Boolean(weekend?.practice)||["practice","practice_complete"].includes(String(weekend?.phase)))},
    {id:"qualifying",label:"Qualifying",enabled:!terminalWeekend&&qualifyingSessions.length>0},
    {id:"strategy",label:"Strategy",enabled:["grid_ready","race"].includes(String(weekend?.phase))&&Boolean(raceStrategy)},
    {id:"grid",label:"Starting Grid",enabled:["grid_ready","race"].includes(String(weekend?.phase))&&startingGridRows.length>0},
    {id:"live",label:"Live Timing",enabled:String(weekend?.phase)==="race"},
    {id:"detailed_timing",label:"Detailed Timing",enabled:String(weekend?.phase)==="race"&&Boolean(liveRace)},
    {id:"classification",label:"Results",enabled:Boolean(lastResult)||terminalWeekend},
  ];

  if(!weekend){
    return <div className="min-h-[calc(100vh-2.5rem)] bg-[#080b11] p-6 text-slate-100">
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5">
        <h2 className="text-lg font-semibold">Race Weekend</h2>
        <p className="text-sm text-slate-400 mt-1">No active race weekend. Advance the calendar to the next Grand Prix weekend.</p>
      </div>
    </div>;
  }

  const perform=async(fn)=>{
    if(busy)return;
    setBusy(true);
    try{
      await fn();
    }catch(error){
      console.error("[RaceWeekend] action failed:",error);
      pushToast?.({
        title:"Race Weekend action failed",
        description:"The previous race state was kept. You can retry the action.",
        type:"error",
        ttl:4200,
      });
    }finally{
      setBusy(false);
    }
  };

  const advanceSession=()=>perform(async()=>{
    const res=await advance();
    if(res?.breakReason!=="race_weekend"&&gs?.raceWeekendState?.phase==="results")navigate("/Home");
  });
  const continueRaceWeekend=()=>perform(async()=>{
    await continueWeekend();
  });

  return <div className="min-h-[calc(100vh-2.5rem)] bg-[#080b11] p-2 md:p-3 text-slate-100 grid gap-2 content-start">
    {!((activeWindow==="live"||activeWindow==="detailed_timing")&&weekend.phase==="race")&&<div className="rounded-lg border border-white/10 bg-[#11161f] p-2 shadow-lg">
      <div className="grid grid-cols-5 gap-1">
        {STEPS.map(([id,label],index)=>{
          const state=index<currentIndex?"complete":index===currentIndex?"active":"upcoming";
          const cls=state==="complete"
            ?"bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
            :state==="active"
              ?"bg-slate-100 border-slate-100 text-slate-950"
              :"bg-white/[0.03] border-white/10 text-slate-500";
          return <div key={id} className={`border rounded-lg px-2 py-1.5 text-center text-xs md:text-sm font-medium ${cls}`}>
            {label}
          </div>;
        })}
      </div>
    </div>}

    <nav className="sticky top-10 z-40 -mx-2 md:-mx-3 px-2 md:px-3 border-y border-white/10 bg-[#080b11]/95 backdrop-blur">
      <div className="flex items-center justify-between gap-2 py-1">
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {windowTabs.map((tab)=>(
            <button
              type="button"
              key={tab.id}
              disabled={!tab.enabled}
              onClick={()=>tab.enabled&&setActiveWindow(tab.id)}
              className={
                "shrink-0 rounded-md px-3 py-1.5 text-[11px] font-semibold transition "+
                (activeWindow===tab.id
                  ?"bg-slate-100 text-slate-950"
                  :tab.enabled
                    ?"border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                    :"border border-white/5 bg-white/[0.02] text-slate-700 cursor-not-allowed")
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
        {weekend.phase==="race"&&liveRace?.status==="running"?<div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={()=>{
              if(racePlaying){
                setRacePlaying(false);
                return;
              }
              setRacePlaying(true);
              perform(()=>advanceLiveRaceSector(1));
            }}
            title={racePlaying?"Pause live race":"Play live race"}
            className={"inline-flex h-7 w-8 items-center justify-center rounded-md border text-[11px] font-bold transition disabled:opacity-40 "+(racePlaying?"border-sky-300/40 bg-sky-400/15 text-sky-200":"border-white/15 bg-white/[0.05] text-slate-200 hover:bg-white/10")}
          >
            {racePlaying?<Pause className="h-3.5 w-3.5 fill-current"/>:<Play className="h-3.5 w-3.5 fill-current"/>}
          </button>
          <div className="flex items-center rounded-md border border-white/10 bg-black/20 p-0.5">
            {RACE_PLAYBACK_SPEEDS.map((speed)=><button
              type="button"
              key={speed}
              onClick={()=>setRacePlaybackSpeed(speed)}
              title={speed+"× playback speed"}
              className={"rounded px-1.5 py-1 text-[9px] font-bold transition "+(racePlaybackSpeed===speed?"bg-slate-100 text-slate-950":"text-slate-500 hover:bg-white/[0.08] hover:text-slate-200")}
            >{speed}×</button>)}
          </div>
          {racePlaying?<span className="hidden items-center gap-1 rounded bg-emerald-500/[0.08] px-1.5 py-1 text-[8px] font-bold uppercase tracking-[0.12em] text-emerald-300 lg:inline-flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300"/>Live Motion</span>:null}
                    <div className="mx-0.5 h-5 w-px bg-white/10"/>
          <button disabled={busy} className="rounded-md border border-sky-400/20 bg-sky-400/[0.06] px-2 py-1.5 text-[9px] font-semibold text-sky-200 hover:bg-sky-400/[0.12] disabled:opacity-50" onClick={()=>{setRacePlaying(false);perform(()=>advanceLiveRaceSector(1));}}>Step</button>
          <button disabled={busy} className="rounded-md border border-white/12 bg-white/[0.04] px-2 py-1.5 text-[9px] font-semibold hover:bg-white/[0.08] disabled:opacity-50" onClick={()=>{setRacePlaying(false);perform(()=>advanceLiveRace(1));}}>+1 Lap</button>
          <button disabled={busy} className="rounded-md bg-slate-100 px-2 py-1.5 text-[9px] font-semibold text-slate-950 hover:bg-white disabled:opacity-50" onClick={()=>{setRacePlaying(false);perform(()=>advanceLiveRace(Number(liveRace.total_laps)||1));}}>Finish</button>
        </div>:null}
      </div>
    </nav>

    {activeWindow==="overview"&&weekendWeather&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h3 className="font-semibold">Weekend Weather Centre</h3>
            <p className="text-sm text-slate-400 mt-1">
              Forecasts are estimates. Actual conditions are fixed in the Save, while forecast confidence improves as the weekend progresses.
            </p>
          </div>
          <div className="text-xs text-slate-500 md:text-right">
            <div>Team forecast capability {Math.round(Number(weekendWeather.forecast_accuracy||0)*100)}%</div>
            <div>Revision {Number(weekendWeather.forecast_revision||0)+1}</div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {weatherSessionRows.map((session)=>{
            const sid=String(session.id);
            const actual=weekendWeather.sessions?.[sid];
            const forecast=weekendWeather.forecast?.[sid];
            const current=String(weekend.active_session_id||"")===sid&&["practice","qualifying","race"].includes(String(weekend.phase));
            const known=weatherObserved.has(sid)||current;
            const state=known?actual?.state:forecast?.predicted_state;
            return <div key={sid} className={"border rounded-xl p-3 "+(current?"ring-2 ring-slate-300":"")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{session.label}</div>
                  <div className="text-xs text-slate-500">{session.dateISO}</div>
                </div>
                <span className={"text-[11px] rounded px-2 py-1 "+(known?"bg-emerald-500/15 text-emerald-300":"bg-blue-500/15 text-blue-300")}>
                  {current?"LIVE":known?"OBSERVED":"FORECAST"}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 font-semibold">
                <span className="text-sky-300"><WeatherStateIcon state={state}/></span>
                <span>{weatherStateLabel(state)}</span>
              </div>
              {known?<div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-400">
                <div>Air {Number(actual?.environment?.start_air_temp_c??actual?.air_temp_c??0).toFixed(1)}→{Number(actual?.environment?.end_air_temp_c??actual?.air_temp_c??0).toFixed(1)}°C</div>
                <div>Track {Number(actual?.environment?.start_track_temp_c??actual?.track_temp_c??0).toFixed(1)}→{Number(actual?.environment?.end_track_temp_c??actual?.track_temp_c??0).toFixed(1)}°C</div>
                <div>Wetness {Math.round(Number(actual?.track?.start_wetness||0)*100)}→{Math.round(Number(actual?.track?.end_wetness??actual?.track?.start_wetness??0)*100)}%</div>
                <div>Grip {Number(actual?.track?.start_grip_index??actual?.track?.grip_index??0).toFixed(0)}→{Number(actual?.track?.end_grip_index??actual?.track?.grip_index??0).toFixed(0)}/100</div>
                <div>Rubber {Number(actual?.track?.start_rubber_level??actual?.track?.rubber_level??0).toFixed(0)}→{Number(actual?.track?.end_rubber_level??actual?.track?.rubber_level??0).toFixed(0)}%</div>
                <div>Rain {Math.round(Number(actual?.rain_intensity||0)*100)}% · {String(actual?.rain_band||"NONE").replaceAll("_"," ").toLowerCase()}</div>
                <div>Visibility {Number(actual?.environment?.start_visibility_index??actual?.visibility_index??100).toFixed(0)}→{Number(actual?.environment?.end_visibility_index??actual?.visibility_index??100).toFixed(0)}%</div>
                <div>Spray Intensity {Math.round(Number(actual?.environment?.end_spray_index??actual?.spray_index??0)*100)}% · {String(actual?.environment?.spray_band||"NONE").replaceAll("_"," ").toLowerCase()}</div>
              </div>:<div className="mt-2 text-xs text-slate-400">
                Rain {Number(forecast?.rain_chance_pct||0).toFixed(0)}% · Air {Number(forecast?.air_temp_c||0).toFixed(1)}°C ±{Number(forecast?.temperature_range_c||0).toFixed(1)} · confidence {Number(forecast?.confidence_pct||0).toFixed(0)}%
              </div>}
            </div>;
          })}
        </div>
      </div>
    )}

    {activeWindow==="practice"&&weekend.phase==="practice"&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Session setup</div>
            <h3 className="mt-1 text-lg font-semibold">Practice Programmes</h3>
            <p className="text-sm text-slate-400 mt-1">Choose what each car should learn from Practice. The programme changes mileage, fatigue, wear and the type of preparation gained.</p>
          </div>
          <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={()=>perform(runPractice)}>
            {busy?"Running…":"Run Practice"}
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {playerEntrants.map((entry)=>{
            const did=String(entry.driver_id);
            const selected=weekend.practice_selections?.[did]||"balanced";
            const programme=PRACTICE_PROGRAMMES[selected]||PRACTICE_PROGRAMMES.balanced;
            const fatigue=currentFatigue(gs,did);
            const intensity=programmeIntensity(programme);
            const driver=driverObject(drivers,did);
            return <div key={did} className="rounded-xl border border-white/10 bg-[#171d27] p-4">
              <div className="flex items-start gap-3">
                <DriverPortrait driver={driver||{display_name:driverName(drivers,did)}} size="h-16 w-16" className="ring-white/10"/>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-lg">{driverName(drivers,did)}</div>
                      <div className="text-xs text-slate-500">{teamName(teams,entry.team_id)}</div>
                    </div>
                    <select
                      className="border border-white/10 bg-[#0d1118] text-slate-100 rounded-lg px-3 py-2 text-sm min-w-[180px]"
                      value={selected}
                      onChange={(e)=>setPracticeProgramme(did,e.target.value)}
                    >
                      {Object.values(PRACTICE_PROGRAMMES).map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{programme.description}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className={"rounded-lg border p-3 "+fatigueTone(fatigue)}>
                  <div className="flex items-center gap-1.5 opacity-80"><Activity className="h-3.5 w-3.5"/>Fatigue</div>
                  <div className="mt-1 text-lg font-bold">{fatigue.toFixed(0)}<span className="text-xs font-normal">/100</span></div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex items-center gap-1.5 text-slate-500"><Gauge className="h-3.5 w-3.5"/>Session intensity</div>
                  <div className={"mt-1 text-lg font-bold "+intensity.tone}>{intensity.label}</div>
                  <div className="text-[10px] text-slate-500">Expected fatigue +{programme.fatigue}</div>
                </div>
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-300">
                  <div className="flex items-center gap-1.5 opacity-80"><Timer className="h-3.5 w-3.5"/>Mileage</div>
                  <div className="mt-1 text-lg font-bold">×{Number(programme.mileageFactor??1).toFixed(2)}</div>
                  <div className="text-[10px] opacity-70">relative running distance</div>
                </div>
                <div className={"rounded-lg border p-3 "+wearTone(programme.wearFactor)}>
                  <div className="flex items-center gap-1.5 opacity-80"><Wrench className="h-3.5 w-3.5"/>Component wear</div>
                  <div className="mt-1 text-lg font-bold">×{Number(programme.wearFactor??1).toFixed(2)}</div>
                  <div className="text-[10px] opacity-70">relative wear rate</div>
                </div>
              </div>

              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Programme focus</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span title="Multiplies how quickly the setup converges toward the circuit target." className="rounded bg-violet-500/10 px-2 py-1 text-violet-300">Setup learning ×{Number(programme.learningMultiplier||1).toFixed(2)}</span>
                  <span title="Programme qualifying bonus; weather relevance is applied after Practice." className="rounded bg-sky-500/10 px-2 py-1 text-sky-300">Qualifying focus {signedValue(programme.qualifyingBonus||0)}</span>
                  <span title="Programme race bonus; weather relevance is applied after Practice." className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-300">Race focus {signedValue(programme.raceBonus||0)}</span>
                  <span title="Stored diagnostic focus. No hidden reliability increase or automatic repair." className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">Diagnostics focus ×{Number(programme.reliabilityBonus||0).toFixed(2)}</span>
                </div>

              </div>
            </div>;
          })}
        </div>

        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
          Session intensity replaces the old “Practice Load” label: it summarises how demanding the selected programme is for the driver. Component selection/test parts will only be added once they are connected to real Car/Development effects.
        </div>
      </div>
    )}

    {activeWindow==="practice"&&Boolean(weekend.practice)&&weekend.phase!=="practice"&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Session review</div>
            <h3 className="mt-1 text-lg font-semibold">Practice Complete</h3>
            <p className="text-sm text-slate-400 mt-1">These are gameplay indices and session outcomes, not literal real-world percentages.</p>
          </div>
          {weekend.phase==="practice_complete"&&<button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={continueRaceWeekend}>
            {busy?"Continuing…":activeSession?.dateISO===gs?.currentDateISO?"Continue to Qualifying":"Advance to Qualifying"}
          </button>}
        </div>

        {(()=>{
          const inputs=weekend.practice?.track_profile?.inputs||{};
          const crash=indexDescriptor(inputs.crash_risk);
          const overtake=indexDescriptor(inputs.overtaking_difficulty);
          const wear=indexDescriptor(inputs.tyre_wear);
          return <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-sm">
            <div className="rounded-lg border border-white/10 bg-[#171d27] px-2 py-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Crash Risk Index</div>
              <div className={"mt-1 text-xl font-bold "+crash.tone}>{Math.round(Number(inputs.crash_risk)||0)}/100</div>
              <div className="text-xs text-slate-400">{crash.level} incident-proneness. This is not a {Math.round(Number(inputs.crash_risk)||0)}% crash probability.</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#171d27] px-2 py-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Overtaking Difficulty</div>
              <div className={"mt-1 text-xl font-bold "+overtake.tone}>{Math.round(Number(inputs.overtaking_difficulty)||0)}/100</div>
              <div className="text-xs text-slate-400">{overtake.level} difficulty. Higher means passing is harder, not a percentage chance.</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#171d27] px-2 py-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Tyre Wear Index</div>
              <div className={"mt-1 text-xl font-bold "+wear.tone}>{Math.round(Number(inputs.tyre_wear)||0)}/100</div>
              <div className="text-xs text-slate-400">{wear.level} circuit demand on tyres; used by degradation and strategy models.</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#171d27] px-2 py-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Lap Length</div>
              <div className="mt-1 text-xl font-bold text-sky-300">{Number(inputs.lap_length_km||0).toFixed(2)} km</div>
              <div className="text-xs text-slate-400">Physical circuit length used for race distance and session calculations.</div>
            </div>
          </div>;
        })()}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {playerPracticeResults.map((row)=>{
            const fatigueAfter=Number(row.fatigue_after??row.fatigue_cost??0);
            const practiceImpact=practiceWeekendImpact(gs,row.driver_id);
            const conditionImpact=conditionModifierBreakdown(gs,row.driver_id);
            return <div key={row.driver_id} className="rounded-xl border border-white/10 bg-[#171d27] p-4">
              <div className="flex items-start gap-3">
                <DriverPortrait driver={driverObject(drivers,row.driver_id)||{display_name:driverName(drivers,row.driver_id)}} size="h-14 w-14" className="ring-white/10"/>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{driverName(drivers,row.driver_id)}</div>
                  <div className="text-xs text-slate-500">{row.programme_label}</div>
                  <p className="mt-1 text-sm text-slate-300">{row.feedback}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-emerald-500/10 p-2 text-emerald-300"><div className="text-[10px] uppercase opacity-70">Setup quality</div><div className="text-lg font-bold">{Math.round(row.setup_quality)}%</div></div>
                <div className="rounded bg-blue-500/10 p-2 text-blue-300"><div className="text-[10px] uppercase opacity-70">Setup knowledge</div><div className="text-lg font-bold">{Math.round(row.setup_knowledge)}%</div></div>
                <div className="rounded bg-cyan-500/10 p-2 text-cyan-300"><div className="text-[10px] uppercase opacity-70">Race relevance</div><div className="text-lg font-bold">{Number(row.race_weather_relevance??0).toFixed(0)}%</div></div>
                <div className="rounded bg-violet-500/10 p-2 text-violet-300"><div className="text-[10px] uppercase opacity-70">Qualifying relevance</div><div className="text-lg font-bold">{Number(row.qualifying_weather_relevance??0).toFixed(0)}%</div></div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded bg-white/[0.05] px-2 py-1 text-slate-300">Preparation +{Number(row.preparation_gain).toFixed(1)}</span>
                <span className={"rounded px-2 py-1 "+fatigueTone(fatigueAfter)}>Fatigue {Number(row.fatigue_before??0).toFixed(0)} → {fatigueAfter.toFixed(0)}</span>
                <span className="rounded bg-white/[0.05] px-2 py-1 text-slate-300">Learning {Number(row.fatigue_efficiency??100).toFixed(0)}%</span>
                <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">Wear +{Number(row.component_wear?.total_wear??0).toFixed(1)}</span>
              </div>

              <div className="mt-3 rounded-lg border border-white/10 bg-[#0f141d] p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Weekend performance effect</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(()=>{
                    const impact=impactDescriptor(practiceImpact.qualifying);
                    return <div title={"Internal qualifying modifier "+signedValue(practiceImpact.qualifying)} className={"rounded-lg border p-2 "+impact.tone}>
                      <div className="text-[10px] uppercase opacity-70">Qualifying impact</div>
                      <div className="mt-1 text-sm font-bold">{impact.short}</div>
                      <div className="text-[10px] opacity-75">Expected effect on one-lap performance.</div>
                    </div>;
                  })()}
                  {(()=>{
                    const impact=impactDescriptor(practiceImpact.race);
                    return <div title={"Internal race modifier "+signedValue(practiceImpact.race)} className={"rounded-lg border p-2 "+impact.tone}>
                      <div className="text-[10px] uppercase opacity-70">Race impact</div>
                      <div className="mt-1 text-sm font-bold">{impact.short}</div>
                      <div className="text-[10px] opacity-75">Expected effect on race performance.</div>
                    </div>;
                  })()}
                  <div className={"rounded-lg border p-2 "+fatigueTone(fatigueAfter)}>
                    <div className="text-[10px] uppercase opacity-70">Driver cost</div>
                    <div className="mt-1 text-sm font-bold">Fatigue +{Math.max(0,fatigueAfter-Number(row.fatigue_before||0)).toFixed(0)}</div>
                    <div className="text-[10px] opacity-75">Ends Practice at {fatigueAfter.toFixed(0)}/100.</div>
                  </div>
                  <div className={"rounded-lg border p-2 "+wearTone(row.wear_factor)}>
                    <div className="text-[10px] uppercase opacity-70">Car cost / learning</div>
                    <div className="mt-1 text-sm font-bold">Wear +{Number(row.component_wear?.total_wear??0).toFixed(1)}</div>
                    <div className="text-[10px] opacity-75">Setup {Math.round(row.setup_quality)}% · knowledge {Math.round(row.setup_knowledge)}%.</div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] leading-relaxed text-slate-500">
                  Decision: {row.programme_label}. {Number(row.reliability_diagnostic_bonus||0)>0?"Diagnostics focus was recorded; fault discovery is not yet wired. ":""}No hidden reliability boost is applied.
                </div>
              </div>

              {row.component_wear?.lowest_slot&&<div className="mt-2 text-xs text-slate-500">
                Lowest component: {String(row.component_wear.lowest_slot).replaceAll("_"," ")} · {Number(row.component_wear.lowest_condition??0).toFixed(1)}%.
              </div>}
              {Number(row.fatigue_performance_penalty_before||0)>0&&<div className="mt-2 text-xs text-amber-300">
                Pre-session fatigue reduced effective driver score by ~{Number(row.fatigue_performance_penalty_before).toFixed(1)}.
              </div>}
              {row.issue_note&&<div className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">{row.issue_note}</div>}
            </div>;
          })}
        </div>
      </div>
    )}

    {activeWindow==="qualifying"&&weekend.phase==="qualifying"&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Qualifying session</div>
            <h3 className="mt-1 text-lg font-semibold">{activeSession?.label||"Qualifying"}</h3>
            <p className="text-sm text-slate-400 mt-1">Compact timing view; completed sessions stay locked in the Save.</p>
            <div className="mt-1 text-xs text-slate-500">{activeSession?.dateISO||weekend.qualifyingDate} · {weekend.qualifying_rule_snapshot?.strategy?.replaceAll("_"," ")||"era rules"}</div>
          </div>
          <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={()=>perform(runQualifying)}>
            {busy?"Running…":`Run ${activeSession?.label||"Qualifying"}`}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Entrants</div><div className="font-semibold">{confirmedEntrants.length}</div></div>
          <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Race grid</div><div className="font-semibold">{Number.isFinite(qualifyingCutoff)?qualifyingCutoff:"—"}</div></div>
          <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Sessions</div><div className="font-semibold">{qualifyingSessions.length}</div></div>
          <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Format</div><div className="font-semibold capitalize">{String(weekend.qualifying_rule_snapshot?.strategy||"").replaceAll("_"," ")}</div></div>
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.06] p-3">
            <div className="text-[10px] uppercase tracking-wide text-sky-300">Session weather briefing</div>
            <div className="mt-1 text-sm font-semibold">{String(activeQualifyingForecast?.predicted_state||activeQualifyingWeather?.state||"UNKNOWN").replaceAll("_"," ")}</div>
            <div className="mt-1 text-xs text-slate-400">
              Rain {Number(activeQualifyingForecast?.rain_chance_pct??0).toFixed(0)}%
              {Number.isFinite(Number(activeQualifyingForecast?.air_temp_c))?<> · Air {Number(activeQualifyingForecast.air_temp_c).toFixed(0)}°C ±{Number(activeQualifyingForecast.temperature_range_c||0).toFixed(0)}°</>:null}
              {Number.isFinite(Number(activeQualifyingForecast?.confidence_pct))?<> · confidence {Number(activeQualifyingForecast.confidence_pct).toFixed(0)}%</>:null}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Circuit briefing</div>
            <div className="mt-1 text-sm font-semibold">{Number(practiceTrackInputs.lap_length_km||0).toFixed(2)} km</div>
            <div className="mt-1 text-xs text-slate-400">Tyre wear {Math.round(Number(practiceTrackInputs.tyre_wear||0))}/100 · overtaking difficulty {Math.round(Number(practiceTrackInputs.overtaking_difficulty||0))}/100</div>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3">
            <div className="text-[10px] uppercase tracking-wide text-amber-300">Team qualifying briefing</div>
            <div className="mt-1 grid gap-1 text-xs">
              {playerEntrants.map((entry)=>{
                const impact=practiceWeekendImpact(gs,entry.driver_id);
                const saved=classification.find((row)=>String(row.driver_id)===String(entry.driver_id));
                return <div key={entry.driver_id} className="flex items-center justify-between gap-2"><span>{driverName(drivers,entry.driver_id)}</span><span className="text-slate-400">{saved?("P"+saved.position+" · "+formatLapTime(saved.best_time_ms)):("Practice Q impact "+signedValue(impact.qualifying))}</span></div>;
              })}
            </div>
          </div>
        </div>

        {completedQualifyingSessions.length>0&&(
          <div className="mt-4 grid gap-4">
            {completedQualifyingSessions.map((session)=>(
              <QualifyingTable key={session.id} title={session.label+" — saved classification"} rows={session.results||[]} drivers={drivers} teams={teams} playerTeamId={playerTeamId} session={session}/>
            ))}
          </div>
        )}

      </div>
    )}

    {activeWindow==="qualifying"&&weekend.phase==="qualifying_wait"&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
          <div className="text-xs text-slate-400">
            <span className="font-semibold text-slate-100">{lastCompletedQualifyingSession?.label||"Qualifying"} complete</span>
            <span className="mx-2 text-slate-700">·</span>
            {lastCompletedQualifyingSession?.results?.length||classification.length} classified
          </div>
          <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={continueRaceWeekend}>
            {busy
              ?"Continuing…"
              :weekend.qualifying?.status==="completed"
                ?"Continue to Strategy"
                :activeSession?.dateISO===gs?.currentDateISO
                  ?"Continue to next session"
                  :"Advance toward next session"}
          </button>
        </div>
        {lastCompletedQualifyingSession&&(
          <div className="mt-2">
            <QualifyingTable
              title={(weekend.qualifying?.status==="completed"?"Overall Qualifying":"Session")+" — classification"}
              rows={lastCompletedQualifyingSession.results||[]}
              drivers={drivers}
              teams={teams}
              playerTeamId={playerTeamId}
              session={lastCompletedQualifyingSession}
              overall={weekend.qualifying?.status==="completed"}
              cutoff={weekend.qualifying?.status==="completed"?qualifyingCutoff:null}
            />
          </div>
        )}
      </div>
    )}

    {(weekend.phase==="grid_ready"||weekend.phase==="race")&&(
      <div className="grid gap-4">
        <div className={(activeWindow==="qualifying"?"":"hidden ")+"rounded-xl border border-white/10 bg-[#11161f] p-3 shadow-xl"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Overall Qualifying Classification</h3>
              <p className="text-sm text-slate-400 mt-1">
                Best qualifying times are final. {startingGridRows.length} cars qualified from {confirmedEntrants.length} entries.
              </p>
            </div>
            <span className="text-xs text-slate-500">Grid limit: {Number.isFinite(qualifyingCutoff)?qualifyingCutoff:"—"}</span>
          </div>
          <div className="mt-4">
            <QualifyingTable rows={classification} drivers={drivers} teams={teams} playerTeamId={playerTeamId} overall cutoff={qualifyingCutoff}/>
          </div>
        </div>

        <div className={(activeWindow==="strategy"?"":"hidden ")+"rounded-xl border border-white/10 bg-[#11161f] p-5 shadow-xl"}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <h3 className="font-semibold">Race Strategy · Control Station</h3>
              <p className="text-sm text-slate-400 mt-1">
                The race now resolves tyre life, temperature, weather transitions and pit losses lap by lap. Strategy rules are locked to this era.
              </p>
            </div>
            <div className="text-xs text-slate-500 md:text-right">
              <div>{raceStrategy?.rules_snapshot?.label||"Era rules"}</div>
              <div>{raceStrategy?.track_snapshot?.laps||"—"} laps · pit loss {Number(raceStrategy?.track_snapshot?.pit_lane_loss_s||0).toFixed(1)}s</div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Current Weather</div>
              <div className="mt-1 font-semibold">{String(lastObservedWeather?.state||"UNKNOWN").replaceAll("_"," ")}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {lastObservedWeather
                  ?`Air ${Number(lastObservedWeather.air_temp_c||0).toFixed(0)}°C · Track ${Number(lastObservedWeather.track_temp_c||0).toFixed(0)}°C · wetness ${Math.round(Number(lastObservedWeather.track?.end_wetness||0)*100)}%`
                  :"Awaiting observed qualifying conditions."}
              </div>
            </div>
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.08] px-3 py-2 text-sm text-sky-100">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-sky-300"><Droplets className="h-3.5 w-3.5"/>Team Forecast</div>
              <div className="mt-1 font-semibold">{strategyTeamForecast.message}</div>
              <div className="mt-0.5 text-xs text-sky-200/70">
                {String(strategyTeamForecast.predicted_state||"UNKNOWN").replaceAll("_"," ")} · rain {Number(strategyTeamForecast.rain_chance_pct||0).toFixed(0)}%
                {Number.isFinite(Number(strategyTeamForecast.confidence_pct))?<>{" · confidence "}{Number(strategyTeamForecast.confidence_pct).toFixed(0)}%</>:null}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-[#171d27] p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Circuit / race</div>
              <div className="mt-1 font-semibold">{Number(raceStrategy?.track_snapshot?.laps||0)} laps · {Number(raceStrategy?.track_snapshot?.lap_length_km||practiceTrackInputs.lap_length_km||0).toFixed(2)} km</div>
              <div className="mt-1 text-xs text-slate-400">Pit loss {Number(raceStrategy?.track_snapshot?.pit_lane_loss_s||0).toFixed(1)}s · tyre wear {Math.round(Number(raceStrategy?.track_snapshot?.tyre_wear||practiceTrackInputs.tyre_wear||0))}/100</div>
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-3">
              <div className="text-[10px] uppercase tracking-wide text-violet-300">Race watchlist</div>
              <div className="mt-1 grid gap-1.5 text-xs">
                {strategyFormLeaders.slice(0,2).map((row)=><div key={"form-"+row.driver_id} className="flex justify-between gap-2"><span>{driverName(drivers,row.driver_id)}</span><span className="text-emerald-300">{row.form.label} form</span></div>)}
                {qualifyingOverperformers.slice(0,1).map((row)=><div key={"q-"+row.driver_id} className="flex justify-between gap-2"><span>{driverName(drivers,row.driver_id)}</span><span className="text-sky-300">Q +{row.delta.toFixed(1)} vs expectation</span></div>)}
                {previousGpWinners.slice(0,1).map((row)=><div key={"win-"+row.driver_id} className="flex justify-between gap-2"><span>{driverName(drivers,row.driver_id)}</span><span className="text-amber-300">{row.wins} prior Save win{row.wins===1?"":"s"} here</span></div>)}
                {!strategyFormLeaders.length&&!qualifyingOverperformers.length&&!previousGpWinners.length?<div className="text-slate-500">Insufficient race history for a form-based watchlist.</div>:null}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
              <div className="text-[10px] uppercase tracking-wide text-emerald-300">Team weekend summary</div>
              <div className="mt-1 grid gap-1 text-xs">
                {playerEntrants.map((entry)=>{
                  const q=classification.find((row)=>String(row.driver_id)===String(entry.driver_id));
                  const impact=practiceWeekendImpact(gs,entry.driver_id);
                  return <div key={entry.driver_id} className="flex justify-between gap-2"><span>{driverName(drivers,entry.driver_id)}</span><span className="text-slate-400">{(q?"Grid P"+q.position:"No Q time")+" · "+impactDescriptor(impact.race).short}</span></div>;
                })}
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3">
              <div className="text-[10px] uppercase tracking-wide text-amber-300">Championship</div>
              <div className="mt-1 grid gap-1 text-xs">
                <div className="flex justify-between gap-2 font-semibold"><span>{teamName(teams,playerTeamId)}</span><span>{constructorStandingById.get(playerTeamId)?"P"+constructorStandingById.get(playerTeamId).position+" · "+constructorStandingById.get(playerTeamId).points+" pts":"—"}</span></div>
                {playerEntrants.map((entry)=>{
                  const standing=driverStandingById.get(String(entry.driver_id));
                  return <div key={entry.driver_id} className="flex justify-between gap-2"><span>{driverName(drivers,entry.driver_id)}</span><span className="text-slate-400">{standing?"P"+standing.position+" · "+standing.points+" pts":"—"}</span></div>;
                })}
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-lg border border-sky-500/20 bg-[#0d1720] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-sky-300">Full team race forecast</div>
                <div className="mt-1 text-xs text-slate-400">{strategyTeamForecast.message}</div>
              </div>
              <div className="text-right text-[10px] text-slate-500">Rain {Number((strategyRaceForecast?.rain_chance_pct??strategyTeamForecast.rain_chance_pct)||0).toFixed(0)}% · confidence {Number((strategyRaceForecast?.confidence_pct??strategyTeamForecast.confidence_pct)||0).toFixed(0)}%</div>
            </div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2 xl:grid-cols-4">
              {strategyForecastWindows.map((window,index)=><div key={index} className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.035] px-2 py-2">
                <span className="text-sky-300"><WeatherStateIcon state={window.state} className="h-4 w-4"/></span>
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-500">L{window.from}–L{window.to}</div>
                  <div className="truncate text-xs font-semibold">{window.label}</div>
                </div>
              </div>)}
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {playerEntrants.map((entry)=>{
              const did=String(entry.driver_id);
              const selection=raceStrategy?.selections?.[did]||{};
              const tyres=tyresForTeam(gs,String(entry.team_id??""));
              const supplier=gs?.raceStrategyWorld?.teamSuppliers?.[String(entry.team_id??"")]||tyres[0]?.supplier||"—";
              return <div key={did} className="border border-white/10 rounded-xl bg-black/15 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{driverName(drivers,did)}</div>
                    <div className="text-xs text-slate-500">{supplier} · fatigue {currentFatigue(gs,did).toFixed(0)}/100</div>
                  </div>
                  <div className="text-xs text-slate-500">{raceStrategy?.rules_snapshot?.notes}</div>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
                  <label className="text-xs text-slate-400">Start tyre
                    <div className="mt-1 flex items-center gap-2">
                      <TyreCompoundIcon compound={tyreName(tyres,selection.start_tyre_id)} size={30}/>
                      <select className="min-w-0 flex-1 border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.start_tyre_id||""} onChange={(e)=>setRaceStrategy(did,{start_tyre_id:e.target.value})}>
                        {tyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>{tyre.compound_name}</option>)}
                      </select>
                    </div>
                  </label>
                  <label className="text-xs text-slate-400">Pace
                    <select className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.pace_mode||"balanced"} onChange={(e)=>setRaceStrategy(did,{pace_mode:e.target.value})}>
                      {Object.values(RACE_PACE_MODES).map((mode)=><option key={mode.id} value={mode.id}>{mode.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">Pit plan
                    <select className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.pit_plan||"adaptive"} onChange={(e)=>setRaceStrategy(did,{pit_plan:e.target.value})}>
                      {Object.values(PIT_PLANS).map((plan)=><option key={plan.id} value={plan.id}>{plan.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">Next tyre
                    <div className="mt-1 flex items-center gap-2">
                      <TyreCompoundIcon compound={tyreName(tyres,selection.next_tyre_id||selection.start_tyre_id)} size={30}/>
                      <select className="min-w-0 flex-1 border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.next_tyre_id||selection.start_tyre_id||""} onChange={(e)=>setRaceStrategy(did,{next_tyre_id:e.target.value})}>
                        {tyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>{tyre.compound_name}</option>)}
                      </select>
                    </div>
                  </label>
                  {selection.pit_plan==="one_stop"?(
                    <label className="text-xs text-slate-400">Target tyre-stop lap
                      <input className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" type="number" min="2" max={Math.max(2,Number(raceStrategy?.track_snapshot?.laps||3)-2)} value={selection.planned_stop_lap||Math.round(Number(raceStrategy?.track_snapshot?.laps||0)/2)} onChange={(e)=>setRaceStrategy(did,{planned_stop_lap:Number(e.target.value)})}/>
                    </label>
                  ):null}
                  {raceStrategy?.rules_snapshot?.refuelling_allowed?(
                    <label className="text-xs text-slate-400">Fuel plan
                      <select className="mt-1 w-full border border-white/10 bg-[#0f141d] text-slate-100 rounded-lg px-2 py-2 text-sm" value={selection.fuel_plan||"balanced"} onChange={(e)=>setRaceStrategy(did,{fuel_plan:e.target.value})}>
                        <option value="light_start">
                          {raceStrategy?.rules_snapshot?.refuelling_style==="optional_experimental"
                            ?"Light start / one refuel"
                            :"Light start / shorter fuel stints"}
                        </option>
                        <option value="balanced">
                          {raceStrategy?.rules_snapshot?.refuelling_style==="optional_experimental"
                            ?"Balanced / no planned refuel"
                            :"Balanced / mid-race refuel"}
                        </option>
                        <option value="heavy_start">
                          {raceStrategy?.rules_snapshot?.refuelling_style==="optional_experimental"
                            ?"Heavy start / no planned refuel"
                            :"Heavy start / later refuel"}
                        </option>
                      </select>
                      <div className="mt-1 text-[10px] text-slate-500">
                        {raceStrategy?.rules_snapshot?.refuelling_style==="optional_experimental"
                          ?"Refuelling is available in this era but remains an optional strategy."
                          :"Refuelling is available and forms part of normal fuel-load strategy in this era."}
                      </div>
                    </label>
                  ):(
                    <div className="text-xs text-slate-500 border rounded-lg px-2 py-2">In-race refuelling is prohibited in this era.</div>
                  )}
                </div>
              </div>;
            })}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            AI Teams use the same tyre, weather, pit-loss and era-rule model. In classic eras they prefer non-stop races unless degradation or weather makes a stop worthwhile.
          </div>
        </div>


        {activeWindow==="live"&&weekend.phase==="race"&&liveRace&&(
          <div className="rounded-xl border border-white/10 bg-[#11161f] pb-44 text-slate-100 shadow-xl overflow-hidden xl:pb-24">
            <div className="border-b border-white/10 bg-[#0b1017] p-2 md:p-3">
              <Track2DView
                trackId={weekend?.track_id||raceStrategy?.track_snapshot?.track_id}
                year={weekend?.year||gs?.activeYear}
                rows={liveRows}
                drivers={drivers}
                teams={teams}
                teamBrands={gs?.teamBrands||gs?.team_brands||[]}
                playerTeamId={playerTeamId}
                currentLap={liveRace?.current_lap||0}
                currentSector={liveRace?.current_sector||0}
                totalLaps={liveRace?.total_laps||raceStrategy?.track_snapshot?.laps||0}
                currentControl={liveRace?.current_control||"GREEN"}
                raceStatus={liveRace?.status||"running"}
                lastWeather={liveRace?.last_weather||raceStrategy?.weather_snapshot?.state||"SUNNY"}
                trackState={trackState}
                timingSummary={timingSummary}
                forecast={liveTeamForecast}
                events={raceViewEvents}
                selectedDriverId={selectedLiveDriverId}
                onSelectDriver={setSelectedLiveDriverId}
                onSelectEvent={setSelectedRaceEvent}
                playbackRunning={racePlaying}
                playbackSpeed={racePlaybackSpeed}
                busy={busy}
                onRestartRace={()=>perform(resumeLiveRace)}
                onConfirmResults={()=>perform(runRace)}
              />
              {liveRace?.status==="red_flag"?<div className="mt-2 rounded-lg border border-red-500/40 bg-red-950/70 px-3 py-2 shadow-lg">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    <Flag className="mt-0.5 h-5 w-5 shrink-0 fill-current text-red-300"/>
                    <div className="min-w-0">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-red-200">Race suspended</div>
                      <div className="mt-0.5 text-[11px] text-red-100/80">
                        Lap {liveRace?.current_lap||0} · Sector {liveRace?.current_sector||1}
                        {redFlagLifecycle?.holding_area?` · Cars held at ${String(redFlagLifecycle.holding_area).replaceAll("_"," ")}`:""}
                      </div>
                      <div className="mt-0.5 text-[10px] text-red-200/60">
                        {redFlagLifecycle?.phase==="restart_pending"
                          ?`Restart procedure prepared · work window closed · ${String(redFlagLifecycle?.restart_style||"era rules").replaceAll("_"," ")}`
                          :restartMonitor?.restart_authorized
                            ?`Sustained improvement confirmed · restart available · ${restartMonitor?.recommended_control==="SAFETY_CAR"?"Safety Car":"green"} resumption`
                            :`Track progress is frozen. Race Control requires sustained safe conditions before restart.`}
                      </div>
                      {redFlagLifecycle?.phase==="suspended"?<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-red-100/55">
                        <span>Safe checks: {Number(restartMonitor?.safe_streak||0)}/{Number(restartMonitor?.required_safe_checks||1)}</span>
                        {Number.isFinite(Number(restartMonitor?.latest_score))?<span>Race Control score: {Number(restartMonitor.latest_score).toFixed(0)}/100</span>:null}
                        {restartMonitor?.latest_action?<span>Assessment: {String(restartMonitor.latest_action).replaceAll("_"," ")}</span>:null}
                      </div>:null}
                      {redFlagLifecycle?.work_policy?.notes?<div className="mt-1 text-[9px] text-red-100/45">{redFlagLifecycle.work_policy.notes}</div>:null}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={()=>perform(
                      redFlagLifecycle?.phase==="restart_pending"
                        ?resumeLiveRace
                        :restartMonitor?.restart_authorized
                          ?prepareLiveRaceRestart
                          :assessLiveRaceRestart
                    )}
                    className="shrink-0 rounded-md border border-red-300/35 bg-red-500/15 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-red-100 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    {redFlagLifecycle?.phase==="restart_pending"
                      ?"Restart race"
                      :restartMonitor?.restart_authorized
                        ?"Prepare restart"
                        :"Check conditions"}
                  </button>
                </div>
                <div className="mt-2 grid gap-1.5 md:grid-cols-2">
                  {playerEntrants.map((entry)=>{
                    const did=String(entry?.driver_id||"");
                    const liveDriver=liveRows.find((row)=>String(row?.driver_id||"")===did);
                    const teamTyres=tyresForTeam(gs,String(entry?.team_id||""));
                    const workLocked=redFlagLifecycle?.phase!=="suspended"||redFlagLifecycle?.work_locked===true;
                    return <div key={did} className="flex items-center gap-2 rounded-md border border-red-300/15 bg-black/20 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[10px] font-semibold text-red-50">{driverName(drivers,did)}</div>
                        <div className="text-[9px] text-red-100/45">Current: {liveDriver?.tyre?.compound||"—"} · {Number.isFinite(Number(liveDriver?.tyre?.condition))?Number(liveDriver.tyre.condition).toFixed(0)+"%":"—"}</div>
                      </div>
                      <select
                        title="Change tyres during Red Flag"
                        disabled={busy||workLocked||Boolean(liveDriver?.retired)||redFlagLifecycle?.work_policy?.tyre_change===false}
                        className="min-w-[135px] rounded-md border border-red-300/20 bg-[#16090b] px-2 py-1.5 text-[10px] text-red-50 disabled:opacity-40"
                        value={liveDriver?.tyre?.tyre_id||""}
                        onChange={(e)=>{if(e.target.value)perform(()=>setRedFlagTyre({driverId:did,tyreId:e.target.value}));}}
                      >
                        {teamTyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>{tyre.compound_name}</option>)}
                      </select>
                    </div>;
                  })}
                </div>
              </div>:null}
            </div>

            <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[44vh] overflow-y-auto border-t border-white/15 bg-[#0b0f16]/95 p-2 shadow-[0_-10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl xl:max-h-none xl:overflow-visible">
              <div className="mx-auto grid max-w-[1800px] gap-2 xl:grid-cols-2">
                {playerEntrants.map((entry)=>{
                  const did=String(entry.driver_id);
                  const driver=driverObject(drivers,did);
                  const teamTyres=tyresForTeam(gs,String(entry.team_id??""));
                  const commands=raceStrategy?.live_commands?.[did]||[];
                  const liveDriver=liveRows.find((row)=>String(row.driver_id)===did);
                  const latestPace=liveDriver?.current_pace||commands.filter((row)=>row.type==="pace").at(-1)?.pace_mode||raceStrategy?.selections?.[did]?.pace_mode||"balanced";
                  const unavailable=liveRace.status!=="running"||Boolean(liveDriver?.retired);
                  const compound=liveDriver?.tyre?.compound||"—";
                  const pending=commands.filter((row)=>Number(row?.effective_lap)>Number(liveRace.current_lap||0));
                  const teammateEntry=playerEntrants.find((candidate)=>String(candidate?.driver_id??"")!==did)||null;
                  const teammateId=String(teammateEntry?.driver_id??"");
                  const teammateLive=teammateId?liveRows.find((row)=>String(row?.driver_id??"")===teammateId):null;
                  const teammateGapMs=Number(teammateLive?.gap_to_previous_ms??teammateLive?.interval_ms);
                  const canYieldToTeammate=Boolean(
                    teammateId&&liveDriver&&!liveDriver?.retired&&teammateLive&&!teammateLive?.retired&&
                    Number(teammateLive?.position)===Number(liveDriver?.position)+1&&
                    (!Number.isFinite(teammateGapMs)||teammateGapMs<=3500)&&
                    !pending.some((command)=>command?.type==="team_order")
                  );
                  const lastFeedback=!liveDriver?.retired?(liveRace.events||[]).slice().reverse().find((event)=>event?.type==="driver_feedback"&&String(event?.driver_id||"")===did)||null:null;
                  return <div className={"grid min-h-[104px] grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 overflow-hidden rounded-lg border p-2 lg:grid-cols-[auto_minmax(185px,.9fr)_minmax(0,2fr)] "+(liveDriver?.retired?"border-red-900/70 bg-red-950/80":"border-white/10 bg-[#171d27]")} key={did}>
                    <DriverPortrait driver={driver||{display_name:driverName(drivers,did)}} size="h-11 w-11" className="self-center ring-white/10"/>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{driverName(drivers,did)}</div>
                      <div className="text-[10px] text-slate-500">P{liveDriver?.position??"—"} · Δ lap {positionDelta(liveDriver?.position_change_last_lap)} · grid {positionDelta(liveDriver?.position_gain)}</div>
                      <div className="text-[10px] text-sky-300">{liveDriver?.pit_window?`${pitWindowLabel(liveDriver.pit_window)} · pit now ~P${liveDriver?.pit_rejoin_position??"—"}`:"No planned pit window"}</div>
                      <div className="mt-1 truncate text-[10px] leading-snug text-cyan-300/90" title={liveDriver?.retired?"No further feedback after retirement.":lastFeedback?liveEventText(lastFeedback,drivers,gs?.tyres||gs?.dbTyres||[]):"—"}><span className="text-slate-500">Last feedback:</span> {liveDriver?.retired?"No further feedback after retirement.":lastFeedback?liveEventText(lastFeedback,drivers,gs?.tyres||gs?.dbTyres||[]):"—"}</div>
                    </div>

                    <div className="col-span-2 grid min-w-0 gap-1.5 lg:col-span-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px]">
                        <span title="Tyre / age" className={"inline-flex items-center gap-1 rounded px-2 py-1 font-bold "+tyreTone(compound)}><TyreCompoundBadge compound={compound} age={liveDriver?.tyre?.age_laps??0} compact/></span>
                        <span title="Tyre condition" className={"inline-flex items-center gap-1 rounded px-2 py-1 font-semibold "+conditionTone(liveDriver?.tyre?.condition)}><Activity className="h-3 w-3"/>{Number.isFinite(Number(liveDriver?.tyre?.condition))?Number(liveDriver.tyre.condition).toFixed(0)+"%":"—"}</span>
                        <span title="Tyre temperature" className={"inline-flex items-center gap-1 rounded bg-white/[0.04] px-2 py-1 "+temperatureTone(liveDriver?.tyre?.temperature_c)}><Thermometer className="h-3 w-3"/>{Number.isFinite(Number(liveDriver?.tyre?.temperature_c))?Number(liveDriver.tyre.temperature_c).toFixed(0)+"°":"—"}</span>
                        <span title="Pit stops" className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-2 py-1 text-slate-300"><Wrench className="h-3 w-3"/>{liveDriver?.pit_count??0}</span>
                        <span title="Best lap" className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-2 py-1 font-mono text-slate-300"><Timer className="h-3 w-3"/>{formatLapTime(liveDriver?.best_lap_ms)}</span>
                      </div>

                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-white/5 pt-1.5">
                        {liveDriver?.retired
                          ?<span className="rounded border border-red-700/40 bg-red-900/60 px-3 py-2 text-[10px] font-bold text-red-200">DNF · CONTROLS LOCKED</span>
                          :<>
                            <Gauge className="h-4 w-4 shrink-0 text-slate-500"/>
                            <select title="Pace next lap" disabled={unavailable} className={"rounded-md border border-white/10 px-2 py-1.5 text-xs disabled:opacity-50 "+paceTone(latestPace)} value={latestPace} onChange={(e)=>setLiveCommand({driverId:did,type:"pace",paceMode:e.target.value})}>
                              {Object.values(RACE_PACE_MODES).map((mode)=><option className="bg-[#11161f] text-slate-100" key={mode.id} value={mode.id}>{mode.label}</option>)}
                            </select>
                            <select title="Pit next lap" disabled={unavailable} className="rounded-md border border-white/10 bg-[#0f141d] px-2 py-1.5 text-xs text-slate-100 disabled:opacity-50" value="" onChange={(e)=>{if(e.target.value)setLiveCommand({driverId:did,type:"pit",tyreId:e.target.value});}}>
                              <option value="">Stay out</option>
                              {teamTyres.map((tyre)=><option key={tyre.tyre_id} value={tyre.tyre_id}>Pit → {tyre.compound_name}</option>)}
                            </select>
                            {canYieldToTeammate?<button
                              type="button"
                              title={"Team order: let "+driverName(drivers,teammateId)+" through next lap"}
                              onClick={()=>setLiveCommand({driverId:did,type:"team_order",teamOrder:"yield",teammateId})}
                              className="rounded-md border border-violet-400/30 bg-violet-500/10 px-2 py-1.5 text-[10px] font-semibold text-violet-200 hover:bg-violet-500/20"
                            >Let {driverName(drivers,teammateId).split(" ").at(-1)} through</button>:null}
                            {pending.length
                              ?<button type="button" disabled={unavailable} onClick={()=>cancelLiveCommand({driverId:did})} className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-[10px] font-semibold text-amber-200 disabled:opacity-40">Cancel Order</button>
                              :null}
                          </>}
                      </div>
                    </div>
                  </div>;
                })}
              </div>
            </div>
          </div>
        )}

        {activeWindow==="detailed_timing"&&weekend.phase==="race"&&liveRace&&(
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#11161f] text-slate-100 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#0b1017] px-4 py-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Live Race Data</div>
                <h3 className="mt-0.5 text-base font-semibold">Detailed Timing</h3>
                <div className="text-[10px] text-slate-500">Full classification, sectors, tyres and strategy detail. Select a row to keep that driver selected in Race View.</div>
              </div>
              <div className="text-right text-[10px] text-slate-500">
                <div>L{liveRace.current_lap||0}/{liveRace.total_laps||0}{Number(liveRace.current_sector)>0?` · S${liveRace.current_sector}`:""}</div>
                <div>{String(liveRace.current_control||"GREEN").replaceAll("_"," ")}</div>
              </div>
            </div>
            <div className="border-b border-white/10 bg-[#0c1118] px-4 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex rounded-lg border border-white/10 bg-black/20 p-1">
                  {[
                    ["overall","Overall"],
                    ["timing","Timing"],
                    ["tyres","Tyres"],
                    ["strategy","Strategy"],
                  ].map(([id,label])=>(
                    <button
                      key={id}
                      type="button"
                      onClick={()=>setLiveTimingMode(id)}
                      className={
                        "rounded-md px-3 py-1.5 text-[11px] font-semibold transition "+
                        (liveTimingMode===id
                          ?"bg-slate-100 text-slate-950"
                          :"text-slate-400 hover:bg-white/[0.06] hover:text-slate-200")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-500">
                  {liveTimingMode==="overall"
                    ?"Race overview: position, gaps, tyres, stops and pace"
                    :liveTimingMode==="timing"
                    ?"Lap timing, sectors and gaps"
                    :liveTimingMode==="tyres"
                      ?"Compound, tyre life and temperatures"
                      :"Pace, pit window and projected strategy outcome"}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table
                className="w-full text-xs"
                style={{minWidth:liveTimingMode==="overall"?"1120px":liveTimingMode==="timing"?"1040px":liveTimingMode==="tyres"?"820px":"900px"}}
              >
                <thead className="bg-[#171d27] text-slate-400 uppercase tracking-wide">
                  <tr>
                    <th className="sticky left-0 z-30 w-14 min-w-14 bg-[#171d27] px-2 py-2 text-right">Pos</th>
                    <th className="sticky left-14 z-30 min-w-[210px] bg-[#171d27] px-3 py-2 text-left">Driver</th>
                    {liveTimingMode==="overall"&&<>
                      <th className="px-2 py-2 text-right">Grid</th>
                      <th className="px-2 py-2 text-center">Net</th>
                      <th className="px-2 py-2 text-center">Δ Lap</th>
                      <th className="px-2 py-2 text-right">Interval</th>
                      <th className="px-2 py-2 text-right">Leader</th>
                      <th className="px-2 py-2 text-right">Δ Last</th>
                      <th className="px-2 py-2 text-center">Tyre</th>
                      <th className="px-2 py-2 text-right">Age</th>
                      <th className="px-2 py-2 text-right">Condition</th>
                      <th className="px-2 py-2 text-right">Stops</th>
                      <th className="px-2 py-2 text-center">Pace</th>
                    </>}
                    {liveTimingMode==="timing"&&<>
                      <th className="px-2 py-2 text-center">Δ Lap</th>
                      <th className="px-2 py-1.5 text-right">Interval</th>
                      <th className="px-2 py-1.5 text-right">Leader</th>
                      <th className="px-2 py-1.5 text-right">S1</th>
                      <th className="px-2 py-1.5 text-right">S2</th>
                      <th className="px-2 py-1.5 text-right">S3</th>
                      <th className="px-2 py-1.5 text-right">Last</th>
                      <th className="px-2 py-1.5 text-right">Δ Last</th>
                      <th className="px-2 py-1.5 text-right">Best</th>
                    </>}
                    {liveTimingMode==="tyres"&&<>
                      <th className="px-2 py-1.5 text-center">Tyre</th>
                      <th className="px-2 py-1.5 text-right">Age</th>
                      <th className="px-2 py-1.5 text-right">Condition</th>
                      <th className="px-2 py-1.5 text-right">Temp</th>
                      <th className="px-2 py-1.5 text-right">Stops</th>
                      <th className="px-2 py-1.5 text-right">Last Lap</th>
                    </>}
                    {liveTimingMode==="strategy"&&<>
                      <th className="px-2 py-1.5 text-center">Pace</th>
                      <th className="px-3 py-2 text-left">Pit Window</th>
                      <th className="px-2 py-1.5 text-right">Rejoin</th>
                      <th className="px-2 py-1.5 text-right">Traffic</th>
                      <th className="px-2 py-1.5 text-right">Projection</th>
                      <th className="px-2 py-1.5 text-right">Confidence</th>
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {liveRows.map((row,index)=>{
                    const mine=String(row.team_id||"")===playerTeamId;
                    const selected=String(row.driver_id||"")===String(selectedLiveDriverId||"");
                    const s1Fast=Number(row.sector_1_ms)>0&&Number(row.sector_1_ms)===Number(liveBestSectors.sector_1_ms);
                    const s2Fast=Number(row.sector_2_ms)>0&&Number(row.sector_2_ms)===Number(liveBestSectors.sector_2_ms);
                    const s3Fast=Number(row.sector_3_ms)>0&&Number(row.sector_3_ms)===Number(liveBestSectors.sector_3_ms);
                    const gridGain=Number(row.position_gain)||0;
                    const lapGain=Number(row.position_change_last_lap)||0;
                    const compound=row.tyre?.compound||tyreName(gs?.tyres,row.tyre?.tyre_id);
                    const rowTone=row.retired
                      ?"bg-red-950/55 text-red-100"
                      :selected
                        ?"bg-sky-500/[0.12] ring-1 ring-inset ring-sky-300/25"
                        :mine
                          ?"bg-white/[0.07]"
                          :"hover:bg-white/[0.025]";
                    const stickyTone=row.retired
                      ?"bg-red-950"
                      :mine
                        ?"bg-[#1a202b]"
                        :"bg-[#11161f]";
                    const projectionBest=Number(row.projected_finish_best);
                    const projectionWorst=Number(row.projected_finish_worst);
                    const rejoinBest=Number(row.pit_rejoin_best);
                    const rejoinWorst=Number(row.pit_rejoin_worst);
                    return <tr onClick={()=>setSelectedLiveDriverId(String(row.driver_id||""))} className={"cursor-pointer border-t border-white/5 "+rowTone} key={row.driver_id}>
                      <td className={"sticky left-0 z-20 w-14 min-w-14 px-2 py-2 text-right text-sm font-bold "+stickyTone}>P{row.position??index+1}</td>
                      <td className={"sticky left-14 z-20 min-w-[210px] px-3 py-2 "+stickyTone}>
                        <div className="flex items-center gap-2 font-semibold text-slate-100">
                          {mine?<span title="Your Team" className="h-2.5 w-1 shrink-0 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.55)]"/>:null}
                          <DriverPortrait driver={driverObject(drivers,row.driver_id)||{display_name:driverName(drivers,row.driver_id)}} size="h-6 w-6" className="shrink-0 ring-white/10"/>
                          <span>{driverName(drivers,row.driver_id)}</span>
                          <TeamLogo teamId={String(row.team_id||"")} name={teamName(teams,row.team_id)} size="h-4 w-4" className="ml-auto shrink-0 p-0 opacity-70"/>
                        </div>
                        <div className="text-[9px] text-slate-500">
                          {teamName(teams,row.team_id)}
                        </div>
                        {row.retired?<div className="mt-0.5 text-[9px] font-semibold text-red-300">DNF · L{row.incident_lap} · {row.retirement_reason||"Retired"}</div>:null}
                      </td>

                      {liveTimingMode==="overall"&&<>
                        <td className="px-2 py-1.5 text-right">P{row.grid_position??"—"}</td>
                        <td className={"px-2 py-1.5 text-center font-semibold "+(gridGain>0?"text-emerald-400":gridGain<0?"text-rose-400":"text-slate-500")}>{positionDelta(gridGain)}</td>
                        <td className={"px-2 py-1.5 text-center font-semibold "+(lapGain>0?"text-emerald-400":lapGain<0?"text-rose-400":"text-slate-500")}>{positionDelta(lapGain)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{row.retired?"—":index===0?"LEADER":formatInterval(row.interval_ms)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-400">{row.retired?"DNF":index===0?"—":formatInterval(row.gap_to_leader_ms)}</td>
                        <td className={"px-2 py-1.5 text-right font-mono "+lapDeltaTone(row.last_lap_delta_ms)}>{signedLapDelta(row.last_lap_delta_ms)}</td>
                        <td className="px-2 py-1.5 text-center"><TyreCompoundBadge compound={compound} compact/></td>
                        <td className="px-2 py-1.5 text-right">{row.tyre?.age_laps??"—"}L</td>
                        <td className="px-2 py-1.5 text-right"><span className={"rounded px-1.5 py-0.5 "+conditionTone(row.tyre?.condition)}>{Number.isFinite(Number(row.tyre?.condition))?Number(row.tyre.condition).toFixed(0)+"%":"—"}</span></td>
                        <td className="px-2 py-1.5 text-right">{row.pit_count??0}</td>
                        <td className="px-2 py-1.5 text-center"><span className={"rounded px-1.5 py-0.5 text-[9px] font-semibold "+paceTone(row.current_pace)}>{paceLabel(row.current_pace)}</span></td>
                      </>}
                      {liveTimingMode==="timing"&&<>
                        <td className={"px-2 py-2 text-center font-semibold "+(lapGain>0?"text-emerald-400":lapGain<0?"text-rose-400":"text-slate-600")}>{positionDelta(lapGain)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{row.retired?"—":index===0?"LEADER":formatInterval(row.interval_ms)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-400">{row.retired?(row.retirement_reason||"DNF"):index===0?"—":formatInterval(row.gap_to_leader_ms)}</td>
                        <td className={"px-2 py-1.5 text-right font-mono "+(s1Fast?"text-fuchsia-300":"text-slate-300")}>{formatLapTime(row.sector_1_ms)}</td>
                        <td className={"px-2 py-1.5 text-right font-mono "+(s2Fast?"text-fuchsia-300":"text-slate-300")}>{formatLapTime(row.sector_2_ms)}</td>
                        <td className={"px-2 py-1.5 text-right font-mono "+(s3Fast?"text-fuchsia-300":"text-slate-300")}>{formatLapTime(row.sector_3_ms)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatLapTime(row.last_lap_ms)}</td>
                        <td className={"px-2 py-1.5 text-right font-mono font-semibold "+lapDeltaTone(row.last_lap_delta_ms)}>{signedLapDelta(row.last_lap_delta_ms)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-emerald-300">{formatLapTime(row.best_lap_ms)}</td>
                      </>}

                      {liveTimingMode==="tyres"&&<>
                        <td className="px-2 py-1.5 text-center">
                          <span className={"inline-flex min-w-12 items-center justify-center rounded-full px-2 py-1 text-[10px] font-bold "+tyreTone(compound)}>
                            <TyreCompoundBadge compound={compound} compact/>
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right">{row.tyre?.age_laps??"—"}L</td>
                        <td className="px-2 py-1.5 text-right">
                          <span className={"rounded px-1.5 py-1 font-semibold "+conditionTone(row.tyre?.condition)}>
                            {Number.isFinite(Number(row.tyre?.condition))?Number(row.tyre.condition).toFixed(0)+"%":"—"}
                          </span>
                        </td>
                        <td className={"px-2 py-1.5 text-right font-semibold "+temperatureTone(row.tyre?.temperature_c)}>
                          {Number.isFinite(Number(row.tyre?.temperature_c))?Number(row.tyre.temperature_c).toFixed(0)+"°":"—"}
                        </td>
                        <td className="px-2 py-1.5 text-right">{row.pit_count??0}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatLapTime(row.last_lap_ms)}</td>
                      </>}

                      {liveTimingMode==="strategy"&&<>
                        <td className="px-2 py-1.5 text-center">
                          <span className={"rounded px-2 py-1 text-[10px] font-semibold "+paceTone(row.current_pace)}>{paceLabel(row.current_pace)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-white/5 px-2 py-1">{pitWindowLabel(row.pit_window)}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {!row.retired&&Number.isFinite(Number(row.pit_rejoin_position))
                            ?<>
                              <div className="font-semibold text-sky-300">P{row.pit_rejoin_position}</div>
                              {Number.isFinite(rejoinBest)&&Number.isFinite(rejoinWorst)
                                ?<div className="text-[9px] text-slate-500">P{rejoinBest}–P{rejoinWorst}</div>
                                :null}
                            </>
                            :"—"}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {!row.retired&&Number.isFinite(Number(row.pit_rejoin_traffic_count))
                            ?<><div>{row.pit_rejoin_traffic_count}</div><div className="text-[9px] text-slate-500">cars ±3.5s</div></>
                            :"—"}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {!row.retired&&Number.isFinite(Number(row.projected_finish_position))
                            ?<>
                              <div className="font-semibold">P{row.projected_finish_position}</div>
                              {Number.isFinite(projectionBest)&&Number.isFinite(projectionWorst)
                                ?<div className="text-[9px] text-slate-500">P{projectionBest}–P{projectionWorst}</div>
                                :null}
                            </>
                            :"—"}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {!row.retired&&Number.isFinite(Number(row.projection_confidence_pct))
                            ?Number(row.projection_confidence_pct).toFixed(0)+"%"
                            :"—"}
                        </td>
                      </>}
                    </tr>;
                  })}
                  {!liveRows.length?<tr><td colSpan={liveTimingMode==="timing"?11:8} className="px-4 py-6 text-center text-slate-500">Race timing will populate after the first completed lap.</td></tr>:null}
                </tbody>
              </table>
            </div>


          </div>
        )}

        <div className={(activeWindow==="grid"?"":"hidden ")+"rounded-xl border border-white/10 bg-[#11161f] p-3 shadow-xl"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Starting Grid</h3>
              <p className="text-sm text-slate-400 mt-1">{startingGridRows.length} starters · {dnqRows.length} DNQ/DNPQ.</p>
              {weekend.phase==="grid_ready"&&<div className="mt-1 text-xs text-slate-500">Race day: {weekend.raceDate}</div>}
            </div>
            <div>
              {weekend.phase==="grid_ready"?(
                <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={continueRaceWeekend}>
                  {busy?"Advancing…":"Advance to Race Day"}
                </button>
              ):!liveRace?(
                <button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={()=>perform(startLiveRace)}>
                  {busy?"Preparing…":"Start Race"}
                </button>
              ):null}
            </div>
          </div>
          <div className="mt-2 max-h-[58vh] overflow-auto border rounded-xl">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[#171d27]">
                <tr>
                  <th className="px-2 py-1.5 text-right">Grid</th>
                  <th className="px-2 py-1.5 text-right">Qual</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-2 py-1 text-center">Start tyre</th>
                  <th className="px-2 py-1 text-right">Best time</th>
                  <th className="px-2 py-1 text-right">Champ.</th>
                  <th className="px-2 py-1 text-right">Penalty</th>
                </tr>
              </thead>
              <tbody>
                {startingGridRows.map((row)=>{
                  const selection=raceStrategy?.selections?.[String(row.driver_id)]||null;
                  const compound=selection?.start_tyre_id
                    ?tyreName(tyresForTeam(gs,String(row.team_id||"")),selection.start_tyre_id)
                    :"—";
                  const mine=String(row.team_id||"")===playerTeamId;
                  return <tr className={"border-t border-white/5 "+(mine?"bg-amber-500/[0.10]":"")} key={row.driver_id}>
                    <td className="px-2 py-1 text-right font-semibold">P{row.grid}</td>
                    <td className="px-2 py-1 text-right">P{row.qualifying_position??row.grid}</td>
                    <td className="px-2 py-1 font-medium">{mine?<span className="mr-1 text-amber-300">●</span>:null}{driverName(drivers,row.driver_id)}</td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <TeamLogo teamId={String(row.team_id||"")} name={teamName(teams,row.team_id)} size="h-5 w-5" className="p-0.5"/>
                        <span>{teamName(teams,row.team_id)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1 text-center"><span className={"inline-flex min-w-12 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold "+tyreTone(compound)}><TyreCompoundBadge compound={compound} compact/></span></td>
                    <td className="px-2 py-1 text-right font-mono">{formatLapTime(row.best_time_ms)}</td>
                    <td className="px-2 py-1 text-right">{(()=>{const standing=driverStandingById.get(String(row.driver_id));return standing?<><span>P{standing.position}</span><span className="ml-1 text-[9px] text-slate-500">{standing.points}p</span></>:"—";})()}</td>
                    <td className="px-2 py-1 text-right">{Number(row.penalty_places||0)>0?"+"+row.penalty_places:"—"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>

          {dnqRows.length>0&&(
            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2">Did not qualify</h4>
              <QualifyingTable rows={dnqRows} drivers={drivers} teams={teams} overall/>
            </div>
          )}

        </div>
      </div>
    )}

    {activeWindow==="classification"&&["results","completed"].includes(String(weekend.phase))&&(
      <div className="rounded-xl border border-white/10 bg-[#11161f] shadow-xl overflow-hidden">
        {(()=>{
          const rows=Array.isArray(lastResult?.classification)?lastResult.classification:[];
          const gridByDriver=new Map(collectionRows(lastResult?.startingGrid??startingGridRows).map((row,index)=>[
            String(row?.driver_id??""),
            Number(row?.grid??index+1),
          ]));
          const winner=rows[0]||null;
          const podium=[rows[1],rows[0],rows[2]].filter(Boolean);
          const fastest=rows.find((row)=>row?.fastest_lap)||rows
            .filter((row)=>Number.isFinite(Number(row?.best_lap_ms))&&Number(row.best_lap_ms)>0)
            .slice().sort((a,b)=>Number(a.best_lap_ms)-Number(b.best_lap_ms))[0]||null;
          const retirements=rows.filter((row)=>row?.retired||String(row?.status).toUpperCase()==="DNF").length;
          const weatherState=String(lastResult?.weather?.state||raceStrategy?.weather_snapshot?.state||"—").replaceAll("_"," ");

          const racePointsByDriver=new Map(rows.map((row)=>[
            String(row?.driver_id??""),
            Number(row?.points||0),
          ]));
          const racePointsByTeam=new Map();
          for(const row of rows){
            const tid=String(row?.team_id??"");
            if(!tid)continue;
            racePointsByTeam.set(tid,(racePointsByTeam.get(tid)||0)+Number(row?.points||0));
          }
          const preDriverStandings=(driverStandings||[])
            .map((standing)=>({
              ...standing,
              points:Math.max(0,Number(standing?.points||0)-Number(racePointsByDriver.get(String(standing?.driver_id??""))||0)),
            }))
            .sort((a,b)=>Number(b.points)-Number(a.points)||String(a.name||"").localeCompare(String(b.name||"")))
            .map((standing,index)=>({...standing,position:index+1}));
          const preDriverById=new Map(preDriverStandings.map((standing)=>[String(standing?.driver_id??""),standing]));

          const preTeamStandings=(constructorStandings||[])
            .map((standing)=>({
              ...standing,
              points:Math.max(0,Number(standing?.points||0)-Number(racePointsByTeam.get(String(standing?.team_id??standing?.constructor_id??""))||0)),
            }))
            .sort((a,b)=>Number(b.points)-Number(a.points)||String(a.team_name||"").localeCompare(String(b.team_name||"")))
            .map((standing,index)=>({...standing,position:index+1}));
          const preTeamById=new Map(preTeamStandings.map((standing)=>[
            String(standing?.team_id??standing?.constructor_id??""),
            standing,
          ]));
          const playerResultRows=rows.filter((row)=>String(row?.team_id??"")===playerTeamId);
          const prePlayerTeam=preTeamById.get(playerTeamId);
          const postPlayerTeam=constructorStandingById.get(playerTeamId);

          return <>
            <div className="p-5 border-b border-white/10">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Official Classification</div>
                  <h3 className="mt-1 text-2xl font-semibold">{lastResult?.name||weekend.gp_name}</h3>
                  <div className="mt-1 text-sm text-slate-400">Round {lastResult?.round??weekend.round} · {lastResult?.dateISO||weekend.raceDate}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Winner</div>
                  <div className="text-lg font-bold">{winner?driverName(drivers,winner.driver_id):"—"}</div>
                  <div className="text-xs text-slate-400">{winner?teamName(teams,winner.team_id):"—"}</div>
                </div>
              </div>

              {podium.length>0&&<div className="mt-5 grid items-end gap-3 md:grid-cols-3">
                {podium.map((row)=>{
                  const pos=Number(row?.position)||rows.findIndex((r)=>r===row)+1;
                  const isWinner=pos===1;
                  const gap=isWinner
                    ?formatRaceTime(row?.total_time_ms)
                    :Number.isFinite(Number(row?.gap_to_winner_ms))
                      ?formatInterval(row.gap_to_winner_ms)
                      :(row?.retirement_reason||row?.status||"—");
                  return <div key={row.driver_id||pos} className={"relative rounded-xl border p-4 text-center "+(isWinner?"md:min-h-[205px] border-amber-400/40 bg-amber-400/[0.08]":"md:min-h-[175px] border-white/10 bg-[#171d27]")}>
                    <div className={"mx-auto mb-2 flex items-center justify-center rounded-full font-black "+(isWinner?"h-9 w-9 bg-amber-300 text-slate-950":"h-8 w-8 bg-white/10 text-slate-100")}>P{pos}</div>
                    <DriverPortrait driver={driverObject(drivers,row.driver_id)||{display_name:driverName(drivers,row.driver_id)}} size={isWinner?"h-20 w-20":"h-16 w-16"} className="mx-auto ring-white/15"/>
                    <div className="mt-2 font-bold">{driverName(drivers,row.driver_id)}</div>
                    <div className="mt-1 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                      <TeamLogo teamId={String(row.team_id||"")} name={teamName(teams,row.team_id)} size="h-5 w-5" className="p-0.5"/>
                      <span>{teamName(teams,row.team_id)}</span>
                    </div>
                    <div className={"mt-2 font-mono text-sm "+(isWinner?"text-amber-200":"text-slate-300")}>{gap}</div>
                  </div>;
                })}
              </div>}

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Race Time</div>
                  <div className="mt-1 font-semibold font-mono">{formatRaceTime(winner?.total_time_ms)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Fastest Lap</div>
                  <div className="mt-1 font-semibold font-mono">{formatLapTime(fastest?.best_lap_ms)}</div>
                  <div className="text-[11px] text-slate-500">{fastest?driverName(drivers,fastest.driver_id):"—"}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Retirements</div>
                  <div className="mt-1 font-semibold">{retirements} / {rows.length}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Conditions</div>
                  <div className="mt-1 font-semibold">{weatherState}</div>
                  <div className="text-[11px] text-slate-500">{Number(lastResult?.weather?.avg_temp_c||0)>0?Number(lastResult.weather.avg_temp_c).toFixed(0)+"°C air":"Race weather"}</div>
                </div>
              </div>
            </div>

            {playerResultRows.length>0&&<div className="border-b border-white/10 bg-[#0c1118] p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-amber-300/80">Team Strategy Review</div>
                  <h4 className="mt-1 text-lg font-semibold">Race debrief</h4>
                  <p className="mt-1 text-xs text-slate-500">Tyre stints, pit loss, strategic triggers and championship impact for your cars.</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-right text-xs">
                  <div className="uppercase tracking-wide text-slate-500">Constructors</div>
                  <div className="mt-1 font-bold text-slate-100">
                    {prePlayerTeam&&postPlayerTeam
                      ?<>P{prePlayerTeam.position} <span className="text-slate-600">→</span> P{postPlayerTeam.position}</>
                      :"—"}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {postPlayerTeam
                      ?String(prePlayerTeam?.points??Math.max(0,Number(postPlayerTeam.points||0)-Number(racePointsByTeam.get(playerTeamId)||0)))+" → "+String(postPlayerTeam.points)+" pts"
                      :"No championship data"}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {playerResultRows.map((row)=>{
                  const did=String(row?.driver_id??"");
                  const tid=String(row?.team_id??"");
                  const finish=Number(row?.position)||rows.findIndex((item)=>item===row)+1;
                  const grid=Number(gridByDriver.get(did)||finish);
                  const places=grid-finish;
                  const preStanding=preDriverById.get(did);
                  const postStanding=driverStandingById.get(did);
                  const champMove=preStanding&&postStanding?Number(preStanding.position)-Number(postStanding.position):0;
                  const stints=Array.isArray(row?.stints)?row.stints:[];
                  const stops=Array.isArray(row?.pit_stops)?row.pit_stops:[];
                  const decisions=Array.isArray(row?.strategy_summary?.strategy_decisions)
                    ?row.strategy_summary.strategy_decisions
                    :[];
                  const totalPitLoss=stops.reduce((sum,stop)=>sum+Number(stop?.total_loss_s||0),0);
                  const tyreOptions=tyresForTeam(gs,tid);
                  const retired=Boolean(row?.retired)||String(row?.status||"").toUpperCase()==="DNF";
                  return <div key={did} className="rounded-xl border border-white/10 bg-[#141a23] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <DriverPortrait driver={driverObject(drivers,did)||{display_name:driverName(drivers,did)}} size="h-12 w-12" className="ring-amber-300/25"/>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-1 rounded-full bg-amber-300"/>
                            <div className="truncate font-bold text-slate-100">{driverName(drivers,did)}</div>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            Grid P{grid} → {retired?("DNF · L"+String(row?.incident_lap??row?.laps_completed??"—")):("P"+finish)} · {places>0?("+"+places+" places"):places<0?(String(places)+" places"):"no position change"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Championship</div>
                        <div className="font-bold">
                          {preStanding&&postStanding
                            ?<>P{preStanding.position} <span className="text-slate-600">→</span> P{postStanding.position}</>
                            :"—"}
                        </div>
                        <div className={"text-[10px] font-semibold "+(champMove>0?"text-emerald-300":champMove<0?"text-rose-300":"text-slate-500")}>
                          {postStanding
                            ?String(preStanding?.points??Math.max(0,Number(postStanding.points||0)-Number(row?.points||0)))+" → "+String(postStanding.points)+" pts"+(champMove?(" · "+positionDelta(champMove)):"")
                            :"No standings data"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Tyre stints</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {stints.length?stints.map((stint,stintIndex)=>{
                          const compound=stint?.compound||tyreName(tyreOptions,stint?.tyre_id);
                          const start=Number(stint?.start_lap)||1;
                          const end=Number(stint?.end_lap)||start;
                          return <div key={stintIndex} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                            <TyreCompoundIcon compound={compound} size={26}/>
                            <div>
                              <div className="text-xs font-semibold">{compound}</div>
                              <div className="text-[10px] text-slate-500">L{start}–{end} · {Math.max(0,end-start+1)} laps</div>
                            </div>
                          </div>;
                        }):<div className="text-xs text-slate-600">No stint data.</div>}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-4">
                      <div className="rounded-lg bg-white/[0.04] p-2">
                        <div className="text-[9px] uppercase text-slate-500">Pit stops</div>
                        <div className="mt-1 font-bold">{stops.length}</div>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] p-2">
                        <div className="text-[9px] uppercase text-slate-500">Pit loss</div>
                        <div className="mt-1 font-bold">{stops.length?totalPitLoss.toFixed(1)+"s":"—"}</div>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] p-2">
                        <div className="text-[9px] uppercase text-slate-500">Pace</div>
                        <div className="mt-1 text-xs font-bold">{paceLabel(row?.strategy_summary?.starting_pace_mode)} → {paceLabel(row?.strategy_summary?.pace_mode)}</div>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] p-2">
                        <div className="text-[9px] uppercase text-slate-500">Lowest tyre</div>
                        <div className="mt-1 font-bold">{Number.isFinite(Number(row?.strategy_summary?.lowest_tyre_condition))?Number(row.strategy_summary.lowest_tyre_condition).toFixed(0)+"%":"—"}</div>
                      </div>
                    </div>

                    {stops.length>0&&<div className="mt-4">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Pit stop review</div>
                      <div className="mt-2 grid gap-1.5">
                        {stops.map((stop,stopIndex)=>{
                          const nextCompound=tyreName(tyreOptions,stop?.tyre_to);
                          return <div key={stopIndex} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/10 bg-black/15 px-2.5 py-2 text-xs">
                            <span className="font-mono font-bold text-slate-200">L{stop?.lap??"—"}</span>
                            <TyreCompoundIcon compound={nextCompound} size={20}/>
                            <span className="font-semibold">{strategyReasonLabel(stop?.reason)}</span>
                            <span className="text-slate-500">→ {nextCompound}</span>
                            <span className="ml-auto font-mono text-amber-200">{Number(stop?.total_loss_s||0).toFixed(1)}s</span>
                          </div>;
                        })}
                      </div>
                    </div>}

                    <div className="mt-4">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Strategic decisions</div>
                      {decisions.length?<div className="mt-2 grid gap-1.5">
                        {decisions.slice(0,5).map((decision,index)=>(
                          <div key={index} className="flex flex-wrap gap-x-2 rounded-lg bg-white/[0.035] px-2.5 py-2 text-[11px]">
                            <span className="font-mono text-slate-400">L{decision?.lap??"—"}</span>
                            <span className="font-semibold text-slate-200">{strategyReasonLabel(decision?.reason)}</span>
                            {Number.isFinite(Number(decision?.tyre_condition))?<span className="text-slate-500">tyre {Number(decision.tyre_condition).toFixed(0)}%</span>:null}
                            {Number.isFinite(Number(decision?.estimated_pit_loss_s))?<span className="text-slate-500">est. pit {Number(decision.estimated_pit_loss_s).toFixed(1)}s</span>:null}
                          </div>
                        ))}
                        {decisions.length>5?<div className="text-[10px] text-slate-600">+{decisions.length-5} more decision{decisions.length-5===1?"":"s"} recorded</div>:null}
                      </div>:<div className="mt-2 text-xs text-slate-600">No strategic pit trigger was recorded.</div>}
                    </div>
                  </div>;
                })}
              </div>
            </div>}

            <div className="overflow-x-auto">
              <table className="min-w-[1320px] w-full text-sm">
                <thead className="bg-[#171d27] text-slate-400 uppercase tracking-wide text-[11px]">
                  <tr>
                    <th className="px-2 py-1.5 text-right">Pos</th>
                    <th className="px-2 py-2 text-center">±</th>
                    <th className="px-3 py-2 text-left">Driver</th>
                    <th className="px-3 py-2 text-left">Team</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-2 py-1.5 text-right">Stops</th>
                    <th className="px-2 py-1.5 text-right">Best Lap</th>
                    <th className="px-2 py-1.5 text-right">Time / Gap</th>
                    <th className="px-2 py-1.5 text-right">Race Pts</th>
                    <th className="px-2 py-1.5 text-right">Championship</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row,index)=>{
                    const did=String(row?.driver_id??"");
                    const tid=String(row?.team_id??"");
                    const finish=Number(row?.position??index+1);
                    const grid=Number(gridByDriver.get(did)||finish);
                    const delta=grid-finish;
                    const status=String(row?.status||(row?.retired?"DNF":"Finished"));
                    const gap=index===0
                      ?formatRaceTime(row?.total_time_ms)
                      :row?.retired
                        ?(row?.retirement_reason||status)+(row?.incident_lap?" · L"+row.incident_lap:"")
                        :Number.isFinite(Number(row?.gap_to_winner_ms))
                          ?formatInterval(row.gap_to_winner_ms)
                          :"—";
                    const standing=driverStandingById.get(did);
                    const teamStanding=constructorStandingById.get(tid);
                    const resultRowTone=row?.retired||String(status).toUpperCase()==="DNF"
                      ?"bg-red-950/55 text-red-100"
                      :tid===playerTeamId
                        ?"bg-white/[0.06]"
                        :"hover:bg-white/[0.025]";
                    return <tr key={did||index} className={"border-t border-white/5 "+resultRowTone}>
                      <td className="px-3 py-3 text-right text-base font-bold">P{finish}</td>
                      <td className={"px-2 py-1.5 text-center font-semibold "+(delta>0?"text-emerald-400":delta<0?"text-rose-400":"text-slate-600")}>{positionDelta(delta)}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-100">{driverName(drivers,did)}</div>
                        <div className="text-[11px] text-slate-500">Grid P{grid}{row?.fastest_lap?" · Fastest lap":""}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <TeamLogo teamId={tid} name={teamName(teams,tid)} size="h-7 w-7" className="p-0.5"/>
                          <div>
                            <div className="font-medium">{teamName(teams,tid)}</div>
                            <div className="text-[11px] text-slate-500">{teamStanding?"Constructors P"+teamStanding.position+" · "+teamStanding.points+" pts":"—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={"rounded px-2 py-1 text-xs "+(row?.retired?"bg-red-500/20 text-red-200":"bg-emerald-500/15 text-emerald-300")}>{status}</span>
                        {Number.isFinite(Number(row?.laps_completed))&&<div className="mt-1 text-[11px] text-slate-500">{row.laps_completed}/{row.race_laps??row.laps_completed} laps</div>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="font-semibold">{row?.strategy_summary?.pit_count??row?.pit_stops?.length??0}</div>
                        <div className="text-[11px] text-slate-500">{row?.strategy_summary?.pit_laps?.length?"L"+row.strategy_summary.pit_laps.join(", "):"—"}</div>
                      </td>
                      <td className={"px-3 py-3 text-right font-mono "+(row?.fastest_lap?"text-fuchsia-300 font-semibold":"")}>{formatLapTime(row?.best_lap_ms)}</td>
                      <td className="px-3 py-3 text-right font-mono">{gap}</td>
                      <td className="px-3 py-3 text-right font-bold">{row?.points??0}</td>
                      <td className="px-3 py-3 text-right">
                        {(()=>{
                          const before=preDriverById.get(did);
                          const move=before&&standing?Number(before.position)-Number(standing.position):0;
                          return <>
                            <div className="font-bold">{standing?"P"+standing.position:"—"}</div>
                            <div className="text-[11px] text-slate-500">
                              {standing
                                ?(before?("P"+before.position+" → "):"")+standing.points+" pts"
                                :"—"}
                            </div>
                            {move?<div className={"text-[10px] font-semibold "+(move>0?"text-emerald-300":"text-rose-300")}>{positionDelta(move)}</div>:null}
                          </>;
                        })()}
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-white/10 flex flex-wrap gap-2">
              <button className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10" onClick={()=>navigate("/Results")}>Open Full Results</button>
              {weekend.phase==="results"
                ?<button disabled={busy} className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={advanceSession}>
                  {busy?"Advancing…":"Continue after Grand Prix"}
                </button>
                :<button className="rounded-lg bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold" onClick={()=>navigate("/Home")}>Return Home</button>}
            </div>
          </>;
        })()}
      </div>
    )}

    {selectedRaceEvent?<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={()=>setSelectedRaceEvent(null)}>
      <div className="w-full max-w-xl rounded-xl border border-white/15 bg-[#11161f] p-4 shadow-2xl" onClick={(event)=>event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {selectedRaceEvent?.type==="event_batch"
              ?<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-sky-300">{raceEventIcon(selectedRaceEvent.events?.[0]||{},"h-6 w-6")}</div>
              :selectedEventDriverId
                ?<DriverPortrait driver={selectedEventDriver||{display_name:driverName(drivers,selectedEventDriverId)}} size="h-12 w-12" className="shrink-0 ring-white/10"/>
                :<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-sky-300">{raceEventIcon(selectedRaceEvent,"h-6 w-6")}</div>}
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Race event · L{selectedRaceEvent.lap??"—"}{Number(selectedRaceEvent?.sector)>0?" · S"+selectedRaceEvent.sector:""}</div>
              <div className="mt-1 text-base font-semibold">{raceEventLabel(selectedRaceEvent)}</div>
              {selectedEventDriverId?<div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-slate-400">
                <TeamLogo teamId={selectedEventTeamId} name={teamName(teams,selectedEventTeamId)} size="h-5 w-5" className="shrink-0 p-0"/>
                <span className="truncate">{driverName(drivers,selectedEventDriverId)} · {teamName(teams,selectedEventTeamId)}</span>
              </div>:null}
            </div>
          </div>
          <button type="button" onClick={()=>setSelectedRaceEvent(null)} className="rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white"><X className="h-4 w-4"/></button>
        </div>
        {selectedRaceEvent?.type==="event_batch"
          ?<div className="mt-3 grid max-h-[60vh] gap-2 overflow-y-auto pr-1">
            {(selectedRaceEvent.events||[]).map((event,index)=>{
              const did=String(event?.driver_id||"");
              const tid=String(event?.team_id??liveRows.find((row)=>String(row?.driver_id||"")===did)?.team_id??"");
              return <div key={event?.event_key||index} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0 text-sky-300">{raceEventIcon(event,"h-5 w-5")}</div>
                  {did?<DriverPortrait driver={driverObject(drivers,did)||{display_name:driverName(drivers,did)}} size="h-9 w-9" className="shrink-0 ring-white/10"/>:null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-slate-500">
                      <span>{raceEventLabel(event)}</span>
                      {did?<><TeamLogo teamId={tid} name={teamName(teams,tid)} size="h-4 w-4" className="p-0"/><span className="normal-case tracking-normal">{driverName(drivers,did)}</span></>:null}
                    </div>
                    <div className="mt-1 text-sm leading-relaxed text-slate-200">{liveEventText(event,drivers,gs?.tyres||gs?.dbTyres||[])}</div>
                  </div>
                </div>
              </div>;
            })}
          </div>
          :<>
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm leading-relaxed text-slate-200">
              {liveEventText(selectedRaceEvent,drivers,gs?.tyres||gs?.dbTyres||[])}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {selectedRaceEvent?.driver_id?<div className="rounded bg-white/[0.04] p-2"><div className="text-[9px] uppercase text-slate-500">Driver</div><div className="mt-1 font-semibold">{driverName(drivers,selectedRaceEvent.driver_id)}</div></div>:null}
              {selectedRaceEvent?.control_type?<div className="rounded bg-white/[0.04] p-2"><div className="text-[9px] uppercase text-slate-500">Race control</div><div className="mt-1 font-semibold">{String(selectedRaceEvent.control_type).replaceAll("_"," ")}</div></div>:null}
              {Number.isFinite(Number(selectedRaceEvent?.stationary_s))?<div className="rounded bg-white/[0.04] p-2"><div className="text-[9px] uppercase text-slate-500">Stationary</div><div className="mt-1 font-semibold">{Number(selectedRaceEvent.stationary_s).toFixed(1)}s</div></div>:null}
              {Number.isFinite(Number(selectedRaceEvent?.pit_lane_loss_s))?<div className="rounded bg-white/[0.04] p-2"><div className="text-[9px] uppercase text-slate-500">Pit lane loss</div><div className="mt-1 font-semibold">{Number(selectedRaceEvent.pit_lane_loss_s).toFixed(1)}s</div></div>:null}
              {selectedRaceEvent?.crew_error?<div className="rounded bg-rose-500/10 p-2 text-rose-200"><div className="text-[9px] uppercase text-rose-400">Crew delay</div><div className="mt-1 font-semibold">+{Number(selectedRaceEvent.crew_error_delay_s||0).toFixed(1)}s</div></div>:null}
              {Number.isFinite(Number(selectedRaceEvent?.position_from))&&Number.isFinite(Number(selectedRaceEvent?.position_to))?<div className="rounded bg-white/[0.04] p-2"><div className="text-[9px] uppercase text-slate-500">Position</div><div className="mt-1 font-semibold">P{selectedRaceEvent.position_from} → P{selectedRaceEvent.position_to}</div></div>:null}
              {selectedRaceEvent?.weather_state?<div className="rounded bg-white/[0.04] p-2"><div className="text-[9px] uppercase text-slate-500">Conditions</div><div className="mt-1 font-semibold">{weatherStateLabel(selectedRaceEvent.weather_state)}</div></div>:null}
              {Number.isFinite(Number(selectedRaceEvent?.rain_intensity))?<div className="rounded bg-white/[0.04] p-2"><div className="text-[9px] uppercase text-slate-500">Rain intensity</div><div className="mt-1 font-semibold">{Math.round(Number(selectedRaceEvent.rain_intensity)*100)}%</div></div>:null}
              {Number.isFinite(Number(selectedRaceEvent?.track_wetness))?<div className="rounded bg-white/[0.04] p-2"><div className="text-[9px] uppercase text-slate-500">Track wetness</div><div className="mt-1 font-semibold">{Math.round(Number(selectedRaceEvent.track_wetness)*100)}%</div></div>:null}
              {Number.isFinite(Number(selectedRaceEvent?.track_temp_c))?<div className="rounded bg-white/[0.04] p-2"><div className="text-[9px] uppercase text-slate-500">Track temp</div><div className="mt-1 font-semibold">{Number(selectedRaceEvent.track_temp_c).toFixed(1)}°C</div></div>:null}
            </div>
          </>}
      </div>
    </div>:null}

  </div>;
}
