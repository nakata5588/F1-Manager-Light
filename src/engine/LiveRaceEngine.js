// src/engine/LiveRaceEngine.js
import { simulateManagedRace, tyresForTeam, RACE_PACE_MODES } from "./RaceStrategyEngine.js";
import { createRaceControlPlan, incidentForDriver, mergeRaceControlHistory, raceControlAtLap } from "./RaceControlEngine.js";

const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const idOf=(row)=>String(row?.driver_id??row?.driver?.driver_id??row?.id??"");
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
    LOCAL_YELLOW:"Local yellow",
    SAFETY_CAR:"Safety Car",
    VSC:"Virtual Safety Car",
    RED_FLAG:"Red flag",
  }[key]||key.replaceAll("_"," ").toLowerCase();
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
function pitLossEstimate(gs,strategyState,driverId,lap,plan){
  const teamId=teamForDriver(gs,driverId);
  const track=strategyState?.track_snapshot||{};
  const crew=gs?.raceStrategyWorld?.pitCrews?.[String(teamId)]||{};
  const control=raceControlAtLap(plan,lap);
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
  const stints=row?.stints||[];
  const stintIndex=stints.findIndex((s)=>lap>=Number(s?.start_lap)&&lap<=Number(s?.end_lap));
  const index=stintIndex>=0?stintIndex:Math.max(0,stints.length-1);
  const stint=stints[index];
  if(!stint)return {tyre_id:row?.start_tyre_id||null,compound:null,condition:null,temperature_c:null,age_laps:0,stint_number:1};
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
function visibleClassification(gs,race,lap,plan,strategyState){
  const gridRows=gridForWeekend(gs);
  const gridById=new Map(gridRows.map((row)=>[idOf(row?.driver),Number(row?.pos)]));
  const totalLaps=Math.max(1,Number(gs?.raceWeekendState?.live_race?.total_laps||strategyState?.track_snapshot?.laps||1));
  const rows=(race||[]).map((row)=>{
    const did=idOf(row?.driver||row);
    const incident=incidentForDriver(plan,did);
    const retired=Boolean(incident&&Number(incident.lap)<=lap);
    const effectiveLap=retired?Math.max(1,Number(incident.lap)):lap;
    const lastLapMs=num(row?.lap_times_ms?.[Math.max(0,effectiveLap-1)],null);
    const previousLapMs=effectiveLap>1?num(row?.lap_times_ms?.[Math.max(0,effectiveLap-2)],null):null;
    const lastLapDeltaMs=Number.isFinite(Number(lastLapMs))&&Number.isFinite(Number(previousLapMs))
      ?Number(lastLapMs)-Number(previousLapMs)
      :null;
    const tyre=tyreStateAtLap(row,effectiveLap);
    const pits=(row?.pit_stops||[]).filter((stop)=>Number(stop?.lap)<=effectiveLap);
    const best=bestLapAt(row,effectiveLap);
    const sectors=sectorTimesForLap(lastLapMs,did,effectiveLap);
    return {
      driver_id:did,
      team_id:teamForDriver(gs,did),
      grid_position:gridById.get(did)||null,
      laps_completed:effectiveLap,
      elapsed_ms:cumulativeAtLap(row,effectiveLap),
      last_lap_ms:lastLapMs,
      previous_lap_ms:previousLapMs,
      last_lap_delta_ms:lastLapDeltaMs,
      ...best,
      ...sectors,
      tyre,
      pit_stops:pits,
      pit_count:pits.length,
      last_pit_lap:pits.length?Number(pits.at(-1)?.lap)||null:null,
      current_pace:paceAtLap(strategyState,did,effectiveLap),
      pit_window:pitWindowAt(strategyState,did,effectiveLap,totalLaps,tyre),
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
    const position=index+1;
    const gap=row.retired?null:Math.max(0,row.elapsed_ms-leader);
    const interval=index&&!row.retired?Math.max(0,row.elapsed_ms-previous):0;
    const estimatedPitLoss=row.retired?null:pitLossEstimate(gs,strategyState,row.driver_id,lap,plan);
    const rejoinElapsed=row.retired?null:Number(row.elapsed_ms||0)+Number(estimatedPitLoss||0)*1000;
    const rejoinPosition=row.retired?null:1+active.filter((other)=>
      String(other.driver_id)!==String(row.driver_id)&&Number(other.elapsed_ms||0)<Number(rejoinElapsed)
    ).length;
    const out={
      ...row,
      position,
      gap_to_leader_ms:gap,
      gap_to_previous_ms:interval,
      interval_ms:interval,
      position_gain:Number.isFinite(Number(row.grid_position))?Number(row.grid_position)-position:0,
      projected_gain:Number.isFinite(Number(row.projected_finish_position))?position-Number(row.projected_finish_position):0,
      pit_loss_estimate_s:estimatedPitLoss,
      pit_rejoin_position:rejoinPosition,
    };
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
  const driverName=driverDisplayName(gs,did);
  const commandMessage=command.type==="pace"
    ?`${driverName} was told to ${paceInstruction(command.pace_mode)} from lap ${effectiveLap}.`
    :`${driverName} was told to pit next lap for ${tyreDisplayName(gs,did,command.tyre_id)} tyres.`;
  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      race_strategy:{...weekend.race_strategy,live_commands:{...(weekend.race_strategy?.live_commands||{}),[did]:nextCommands}},
      live_race:{...live,events:[...(live.events||[]),{
        lap:Number(live.current_lap),
        type:"command",
        driver_id:did,
        driver_name:driverName,
        effective_lap:effectiveLap,
        command,
        message:commandMessage,
      }].slice(-80)},
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
  let classification=visibleClassification(working,simulation.race,target,plan,working?.raceWeekendState?.race_strategy);
  const previousLapRows=target>1
    ?visibleClassification(working,simulation.race,target-1,plan,working?.raceWeekendState?.race_strategy)
    :[];
  const previousPositionByDriver=new Map(previousLapRows.map((row)=>[String(row.driver_id),Number(row.position)]));
  classification=classification.map((row)=>{
    const previousPosition=previousPositionByDriver.get(String(row.driver_id));
    return {
      ...row,
      previous_lap_position:Number.isFinite(previousPosition)?previousPosition:null,
      position_change_last_lap:Number.isFinite(previousPosition)?previousPosition-Number(row.position):0,
    };
  });
  const weatherSegment=simulation.weather?.segments?.find((s)=>target>=Number(s?.from_lap)&&target<=Number(s?.to_lap));
  const weather=String(weatherSegment?.state||simulation.weather?.state||"SUNNY");
  const previousWeather=String(live.last_weather||"");
  const currentControl=raceControlAtLap(plan,target);
  const trackState=plan?.weather_timeline?.[Math.max(0,target-1)]||null;
  const events=[...(live.events||[])];
  if(previousWeather&&weather!==previousWeather)events.push({lap:target,type:"weather",message:`Conditions changed from ${previousWeather.replaceAll("_"," ").toLowerCase()} to ${weather.replaceAll("_"," ").toLowerCase()}.`});

  const controlPeriodsStarted=new Set();
  for(const incident of plan?.incidents||[]){
    if(Number(incident.lap)>Number(live.current_lap)&&Number(incident.lap)<=target){
      const period=(plan?.periods||[]).find((row)=>
        Number(row?.from_lap)===Number(incident.lap)&&String(row?.driver_id??"")===String(incident.driver_id)
      );
      const driver=driverDisplayName(working,incident.driver_id);
      if(period){
        controlPeriodsStarted.add(`${period.type}:${period.from_lap}:${period.driver_id||""}`);
        events.push({
          lap:Number(incident.lap),
          type:"race_control",
          driver_id:incident.driver_id,
          driver_name:driver,
          control_type:period.type,
          cause:"incident",
          severity:String(incident.severity||"unknown").toLowerCase(),
          incident_reason:String(incident.reason||incident.kind||"incident").toLowerCase(),
          message:`${controlLabel(period.type)} due to ${driver}'s ${String(incident.reason||incident.kind||"incident").toLowerCase()}.`,
        });
      }else{
        const mechanical=/engine|gearbox|transmission|electrical|cooling|fuel|suspension/i.test(String(incident.reason||""));
        events.push({
          lap:Number(incident.lap),
          type:"incident",
          driver_id:incident.driver_id,
          driver_name:driver,
          cause:"incident",
          severity:String(incident.severity||"unknown").toLowerCase(),
          incident_reason:String(incident.reason||incident.kind||"incident").toLowerCase(),
          message:mechanical
            ?`${driver} stops with a ${String(incident.reason).toLowerCase()} problem.`
            :`${driver} involved in ${String(incident.reason||incident.kind||"an incident").toLowerCase()}.`,
        });
      }
    }
  }
  for(const period of plan?.periods||[]){
    const key=`${period.type}:${period.from_lap}:${period.driver_id||""}`;
    if(Number(period.from_lap)>Number(live.current_lap)&&Number(period.from_lap)<=target&&!controlPeriodsStarted.has(key)){
      const weatherAtStart=plan?.weather_timeline?.[Math.max(0,Number(period.from_lap)-1)]?.state;
      const reason=period.cause==="weather"
        ?String(weatherAtStart||"extreme weather").replaceAll("_"," ").toLowerCase()
        :"an incident";
      events.push({
        lap:Number(period.from_lap),
        type:"race_control",
        control_type:period.type,
        cause:period.cause,
        message:`${controlLabel(period.type)} deployed because of ${reason}.`,
      });
    }
    if(Number(period.to_lap)>=Number(live.current_lap)&&Number(period.to_lap)<target&&period.type!=="LOCAL_YELLOW"){
      events.push({lap:Number(period.to_lap)+1,type:"race_control",control_type:"GREEN",message:`${controlLabel(period.type)} withdrawn — green flag.`});
    }
  }
  for(const row of simulation.race){
    for(const stop of row?.pit_stops||[]){
      if(Number(stop?.lap)>Number(live.current_lap)&&Number(stop?.lap)<=target){
        const did=idOf(row.driver);
        const driverName=driverDisplayName(working,did);
        const previousTyre=tyreDisplayName(working,did,stop.tyre_from);
        const nextTyre=tyreDisplayName(working,did,stop.tyre_to);
        const beforeRows=Number(stop.lap)>1
          ?visibleClassification(working,simulation.race,Number(stop.lap)-1,plan,working?.raceWeekendState?.race_strategy)
          :[];
        const afterRows=visibleClassification(working,simulation.race,Number(stop.lap),plan,working?.raceWeekendState?.race_strategy);
        const positionBefore=beforeRows.find((item)=>String(item.driver_id)===did)?.position??null;
        const positionAfter=afterRows.find((item)=>String(item.driver_id)===did)?.position??null;
        const positionText=Number.isFinite(Number(positionBefore))&&Number.isFinite(Number(positionAfter))
          ?`, P${positionBefore} → P${positionAfter}`
          :"";
        events.push({
          lap:Number(stop.lap),
          type:"pit",
          driver_id:did,
          driver_name:driverName,
          tyre_from_id:stop.tyre_from,
          tyre_to_id:stop.tyre_to,
          tyre_from:previousTyre,
          tyre_to:nextTyre,
          total_loss_s:Number(stop.total_loss_s),
          position_before:positionBefore,
          position_after:positionAfter,
          message:`${driverName} changed from ${previousTyre} to ${nextTyre} tyres (${Number(stop.total_loss_s).toFixed(1)}s lost${positionText}).`,
        });
      }
    }
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
  };
  return {
    ...working,
    raceWeekendState:{
      ...working.raceWeekendState,
      live_race:{...live,current_lap:target,status:upcomingRed?"red_flag":target>=Number(live.total_laps)?"finished":"running",classification,timing_summary:timingSummary,last_weather:weather,current_control:currentControl.type,track_state:trackState,red_flag_period:upcomingRed||null,projected_race:simulation.race,projected_summary:simulation.summary,events:events.slice(-100)},
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
