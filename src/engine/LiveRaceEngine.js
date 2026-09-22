// src/engine/LiveRaceEngine.js
import { simulateManagedRace, tyresForTeam, RACE_PACE_MODES } from "./RaceStrategyEngine.js";

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
function visibleClassification(race,lap){
  const rows=(race||[]).map((row)=>({
    driver_id:idOf(row?.driver||row),
    elapsed_ms:cumulativeAtLap(row,lap),
    last_lap_ms:num(row?.lap_times_ms?.[lap-1],null),
    tyre:tyreStateAtLap(row,lap),
    pit_stops:(row?.pit_stops||[]).filter((stop)=>Number(stop?.lap)<=lap),
    projected_finish_position:Number(row?.pos)||null,
  })).sort((a,b)=>a.elapsed_ms-b.elapsed_ms||a.driver_id.localeCompare(b.driver_id));
  const leader=rows[0]?.elapsed_ms||0;
  let previous=leader;
  return rows.map((row,index)=>{
    const out={...row,position:index+1,gap_to_leader_ms:Math.max(0,row.elapsed_ms-leader),gap_to_previous_ms:index?Math.max(0,row.elapsed_ms-previous):0};
    previous=row.elapsed_ms;
    return out;
  });
}

export function createLiveRaceState(gs,{gp={}}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="race")return gs;
  if(["running","finished"].includes(String(weekend.live_race?.status)))return gs;
  const track=weekend?.race_strategy?.track_snapshot||{};
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      race_strategy:{...(weekend.race_strategy||{}),live_commands:{...(weekend.race_strategy?.live_commands||{})}},
      live_race:{
        version:1,status:"running",current_lap:0,total_laps:Math.max(1,Number(track?.laps)||1),speed:"manual",
        classification:[],events:[{lap:0,type:"start_ready",message:"Cars are on the grid. Race control is ready."}],
        last_weather:null,started_at:gs?.currentDateISO||null,
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
  const target=Math.min(Number(live.total_laps),Number(live.current_lap)+Math.max(1,Math.round(Number(laps)||1)));
  const simulation=simulateManagedRace(working,{gp,grid:gridForWeekend(working),ratings:working?.driverRatings||[],roundIndex:Number(weekend?.roundIndex)||0});
  working=simulation.gameState;
  const classification=visibleClassification(simulation.race,target);
  const weatherSegment=simulation.weather?.segments?.find((s)=>target>=Number(s?.from_lap)&&target<=Number(s?.to_lap));
  const weather=String(weatherSegment?.state||simulation.weather?.state||"SUNNY");
  const previousWeather=String(live.last_weather||"");
  const events=[...(live.events||[])];
  if(previousWeather&&weather!==previousWeather)events.push({lap:target,type:"weather",message:`Conditions changed from ${previousWeather.replaceAll("_"," ")} to ${weather.replaceAll("_"," ")}.`});
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
      live_race:{...live,current_lap:target,status:target>=Number(live.total_laps)?"finished":"running",classification,last_weather:weather,projected_race:simulation.race,projected_summary:simulation.summary,events:events.slice(-80)},
    },
  };
}

export function liveRaceReadyToFinalize(gs){
  const live=gs?.raceWeekendState?.live_race;
  return Boolean(live&&live.status==="finished"&&Number(live.current_lap)>=Number(live.total_laps));
}
