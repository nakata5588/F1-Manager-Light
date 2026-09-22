// src/engine/LiveRaceEngine.js
import { simulateManagedRace, tyresForTeam, RACE_PACE_MODES } from "./RaceStrategyEngine.js";
import { createRaceControlPlan, incidentForDriver, mergeRaceControlHistory, raceControlAtLap } from "./RaceControlEngine.js";

const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const idOf=(row)=>String(row?.driver_id??row?.driver?.driver_id??row?.id??"");
function driverById(gs,id){return (gs?.drivers||[]).find((d)=>String(d?.driver_id??d?.id??"")===String(id))||null;}
function teamForDriver(gs,did){
  const entry=(gs?.raceEntryState?.entries||[]).find((row)=>String(row?.driver_id??"")===String(did));
  return String(entry?.team_id??driverById(gs,did)?.team_id??"");
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
  const stint=(row?.stints||[]).find((s)=>lap>=Number(s?.start_lap)&&lap<=Number(s?.end_lap))||(row?.stints||[]).at(-1);
  if(!stint)return {tyre_id:row?.start_tyre_id||null,compound:null,condition:null,temperature_c:null};
  const stintLaps=Math.max(1,Number(stint?.laps)||1);
  const progress=Math.max(0,Math.min(1,(lap-Number(stint?.start_lap)+1)/stintLaps));
  const end=num(stint?.condition_end,100);
  return {
    tyre_id:stint?.tyre_id||null,
    compound:stint?.compound||null,
    condition:Number((100-(100-end)*progress).toFixed(1)),
    temperature_c:Number(num(stint?.avg_temperature_c,0).toFixed(1)),
  };
}
function visibleClassification(race,lap,plan){
  const rows=(race||[]).map((row)=>{
    const did=idOf(row?.driver||row);
    const incident=incidentForDriver(plan,did);
    const retired=Boolean(incident&&Number(incident.lap)<=lap);
    const effectiveLap=retired?Math.max(1,Number(incident.lap)):lap;
    return {
    driver_id:did,
    elapsed_ms:cumulativeAtLap(row,effectiveLap),
    last_lap_ms:num(row?.lap_times_ms?.[Math.max(0,effectiveLap-1)],null),
    tyre:tyreStateAtLap(row,effectiveLap),
    pit_stops:(row?.pit_stops||[]).filter((stop)=>Number(stop?.lap)<=effectiveLap),
    projected_finish_position:Number(row?.pos)||null,
    retired,
    status:retired?"DNF":"RUNNING",
    retirement_reason:retired?incident.reason:null,
    incident_lap:retired?incident.lap:null,
  };
  });
  const active=rows.filter((row)=>!row.retired).sort((a,b)=>a.elapsed_ms-b.elapsed_ms||a.driver_id.localeCompare(b.driver_id));
  const retired=rows.filter((row)=>row.retired).sort((a,b)=>Number(b.incident_lap)-Number(a.incident_lap)||a.elapsed_ms-b.elapsed_ms);
  const ordered=[...active,...retired];
  const leader=active[0]?.elapsed_ms||ordered[0]?.elapsed_ms||0;
  let previous=leader;
  return ordered.map((row,index)=>{
    const gap=row.retired?null:Math.max(0,row.elapsed_ms-leader);
    const out={...row,position:index+1,gap_to_leader_ms:gap,gap_to_previous_ms:index&&!row.retired?Math.max(0,row.elapsed_ms-previous):0};
    if(!row.retired)previous=row.elapsed_ms;
    return out;
  });
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
        version:1,status:"running",current_lap:0,total_laps:Math.max(1,Number(track?.laps)||1),speed:"manual",
        classification:[],events:[{lap:0,type:"start_ready",message:"Cars are on the grid. Race control is ready."}],
        last_weather:null,current_control:"GREEN",track_state:plan.weather_timeline?.[0]||null,started_at:gs?.currentDateISO||null,
      },
    },
  };
}

export function issueLiveRaceCommand(gs,{driverId,type,paceMode,tyreId}={}){
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
  }
  if(!command)return gs;
  const existing=weekend?.race_strategy?.live_commands?.[did]||[];
  const nextCommands=existing.filter((row)=>!(row?.type===type&&Number(row?.effective_lap)===effectiveLap));
  nextCommands.push(command);
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      race_strategy:{...weekend.race_strategy,live_commands:{...(weekend.race_strategy?.live_commands||{}),[did]:nextCommands}},
      live_race:{...live,events:[...(live.events||[]),{lap:Number(live.current_lap),type:"command",driver_id:did,effective_lap:effectiveLap,command}].slice(-80)},
    },
  };
}

export function advanceLiveRace(gs,{gp={},laps=1}={}){
  let working=createLiveRaceState(gs,{gp});
  const weekend=working?.raceWeekendState, live=weekend?.live_race;
  if(!live||live.status!=="running")return working;
  const requestedTarget=Math.min(Number(live.total_laps),Number(live.current_lap)+Math.max(1,Math.round(Number(laps)||1)));
  const planBefore=working?.raceWeekendState?.race_strategy?.race_control_plan||null;

  // Recalculate only the future hazard map from the current strategy state.
  // Completed laps remain authoritative, so changing pace can alter future risk
  // without rewriting an incident the player has already seen.
  const hazardSimulation=simulateManagedRace(working,{gp,grid:gridForWeekend(working),ratings:working?.driverRatings||[],roundIndex:Number(weekend?.roundIndex)||0});
  const freshPlan=createRaceControlPlan(hazardSimulation.gameState,{gp,race:hazardSimulation.race,weather:hazardSimulation.weather,track:hazardSimulation.track});
  const plan=mergeRaceControlHistory(planBefore,freshPlan,live.current_lap);
  working={
    ...hazardSimulation.gameState,
    raceWeekendState:{
      ...hazardSimulation.gameState.raceWeekendState,
      race_strategy:{...hazardSimulation.gameState.raceWeekendState.race_strategy,race_control_plan:plan},
    },
  };

  const upcomingRed=(plan?.periods||[]).find((period)=>period.type==="RED_FLAG"&&Number(period.from_lap)>Number(live.current_lap)&&Number(period.from_lap)<=requestedTarget);
  const target=upcomingRed?Number(upcomingRed.from_lap):requestedTarget;
  const simulation=simulateManagedRace(working,{gp,grid:gridForWeekend(working),ratings:working?.driverRatings||[],roundIndex:Number(weekend?.roundIndex)||0});
  working=simulation.gameState;
  const classification=visibleClassification(simulation.race,target,plan);
  const weatherSegment=simulation.weather?.segments?.find((s)=>target>=Number(s?.from_lap)&&target<=Number(s?.to_lap));
  const weather=String(weatherSegment?.state||simulation.weather?.state||"SUNNY");
  const previousWeather=String(live.last_weather||"");
  const previousControl=String(live.current_control||"GREEN");
  const currentControl=raceControlAtLap(plan,target);
  const trackState=plan?.weather_timeline?.[Math.max(0,target-1)]||null;
  const events=[...(live.events||[])];
  if(previousWeather&&weather!==previousWeather)events.push({lap:target,type:"weather",message:`Conditions changed from ${previousWeather.replaceAll("_"," ")} to ${weather.replaceAll("_"," ")}.`});
  for(const incident of plan?.incidents||[]){
    if(Number(incident.lap)>Number(live.current_lap)&&Number(incident.lap)<=target){
      events.push({lap:Number(incident.lap),type:"incident",driver_id:incident.driver_id,message:`${incident.driver_id}: ${incident.reason} (${incident.severity}).`});
    }
  }
  for(const period of plan?.periods||[]){
    if(Number(period.from_lap)>Number(live.current_lap)&&Number(period.from_lap)<=target){
      events.push({lap:Number(period.from_lap),type:"race_control",message:`${period.type.replaceAll("_"," ")} deployed due to ${period.cause}.`});
    }
    if(Number(period.to_lap)>=Number(live.current_lap)&&Number(period.to_lap)<target&&period.type!=="LOCAL_YELLOW"){
      events.push({lap:Number(period.to_lap)+1,type:"race_control",message:`${period.type.replaceAll("_"," ")} ending — GREEN FLAG.`});
    }
  }
  if(previousControl!==currentControl.type&&target===Number(live.current_lap)+1&&currentControl.type!=="GREEN"){
    events.push({lap:target,type:"race_control",message:`Race Control: ${currentControl.type.replaceAll("_"," ")}.`});
  }
  for(const row of simulation.race){
    for(const stop of row?.pit_stops||[]){
      if(Number(stop?.lap)>Number(live.current_lap)&&Number(stop?.lap)<=target){
        events.push({lap:Number(stop.lap),type:"pit",driver_id:idOf(row.driver),message:`${idOf(row.driver)} pitted: ${stop.tyre_from} → ${stop.tyre_to} (${Number(stop.total_loss_s).toFixed(1)}s loss).`});
      }
    }
  }
  return {
    ...working,
    raceWeekendState:{
      ...working.raceWeekendState,
      live_race:{...live,current_lap:target,status:upcomingRed?"red_flag":target>=Number(live.total_laps)?"finished":"running",classification,last_weather:weather,current_control:currentControl.type,track_state:trackState,red_flag_period:upcomingRed||null,projected_race:simulation.race,projected_summary:simulation.summary,events:events.slice(-100)},
    },
  };
}

export function resumeLiveRace(gs){
  const weekend=gs?.raceWeekendState;
  const live=weekend?.live_race;
  if(!weekend||live?.status!=="red_flag")return gs;
  const rules=weekend?.race_strategy?.race_control_plan?.rules||{};
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      live_race:{
        ...live,
        status:"running",
        current_control:"GREEN",
        red_flag_period:null,
        events:[...(live.events||[]),{
          lap:Number(live.current_lap),
          type:"restart",
          message:`Race restarting under ${String(rules.restart_style||"era rules").replaceAll("_"," ")}.`,
        }].slice(-100),
      },
    },
  };
}

export function liveRaceReadyToFinalize(gs){
  const live=gs?.raceWeekendState?.live_race;
  return Boolean(live&&live.status==="finished"&&Number(live.current_lap)>=Number(live.total_laps));
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
      return {
        ...row,
        pos:Number(visible?.position??row?.pos??index+1),
        retired,
        status:retired?"DNF":"Finished",
        retirement_reason:retired?(visible?.retirement_reason||"Retired"):null,
        incident_lap:incidentLap,
        laps_completed:retired?Math.max(0,Math.min(totalLaps,incidentLap||0)):totalLaps,
        race_laps:totalLaps,
      };
    })
    .sort((a,b)=>Number(a?.pos??999)-Number(b?.pos??999));
}
