// src/race2/adapters/OfficialRaceResultProjection.js
// RW8.14J: terminal handoff from canonical RaceState into the existing
// post-race archive pipeline. This is a projection only: no race simulation,
// ordering or timing is recalculated here.

export const CANONICAL_RACE_RESULT_SOURCE="rw8.14j_canonical_race_result";

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

const text=(value)=>String(value??"");

function driverById(gs){
  const rows=[
    ...(Array.isArray(gs?.drivers)?gs.drivers:[]),
    ...(Array.isArray(gs?.dbDrivers)?gs.dbDrivers:[]),
  ];
  const map=new Map();
  for(const driver of rows){
    const id=text(driver?.driver_id??driver?.id);
    if(id&&!map.has(id))map.set(id,driver);
  }
  return map;
}

function eventForDriver(state,driverId,types=[]){
  const wanted=new Set(types);
  return (state?.events||[])
    .filter((event)=>
      (!wanted.size||wanted.has(String(event?.type||"")))&&
      (event?.driverIds||[]).some((id)=>text(id)===text(driverId))
    )
    .at(-1)||null;
}

function otherDriverId(event,driverId){
  return (event?.driverIds||[])
    .map(text)
    .find((id)=>id&&id!==text(driverId))||null;
}

function damageComponents(damage){
  if(Array.isArray(damage?.damaged_components))return [...damage.damaged_components];
  if(damage?.components&&typeof damage.components==="object"){
    return Object.entries(damage.components)
      .filter(([,value])=>finite(value?.severity??value,0)>0)
      .map(([key])=>key);
  }
  return [];
}

function pitStopRows(car){
  return (Array.isArray(car?.pitState?.history)?car.pitState.history:[]).map((stop)=>({
    lap:finite(stop?.lap,null),
    stop_number:finite(stop?.stopSequence,null),
    tyre_from:stop?.tyreFrom??null,
    tyre_to:stop?.tyreTo??null,
    tyre_changed:Boolean(stop?.tyreChanged),
    refuelled:Boolean(stop?.refuelled),
    fuel_added_kg:finite(stop?.fuelAddedKg,0),
    time_loss_ms:finite(stop?.lossMs,0),
  }));
}

function wetRace(state,snapshot){
  const weather=state?.weatherState||{};
  const wetness=finite(weather?.track_wetness,finite(weather?.wetness,0));
  const name=text(weather?.state??weather?.current?.state??snapshot?.state).toUpperCase();
  return wetness>0.08||/RAIN|WET|STORM/.test(name);
}

export function projectCanonicalRaceStateToOfficialRows(gs,state){
  if(!state||typeof state!=="object")throw new TypeError("Finished canonical RaceState is required");
  if(String(state?.status||"")!=="finished")throw new TypeError("Canonical RaceState must be finished before result projection");

  const drivers=driverById(gs);
  const cars=new Map((state?.cars||[]).map((car)=>[text(car?.carId),car]));
  const totalLaps=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));

  return (state?.classification||[]).map((row,index)=>{
    const car=cars.get(text(row?.carId))||{};
    const driverId=text(row?.driverId??car?.driverId);
    const driver=drivers.get(driverId)||{
      driver_id:driverId,
      display_name:driverId,
      team_id:row?.teamId??car?.teamId??null,
    };
    const retired=Boolean(car?.dnf||car?.status==="dnf"||row?.status==="dnf");
    const retirementEvent=eventForDriver(state,driverId,["retirement","mechanical_failure","accident"]);
    const damageEvent=eventForDriver(state,driverId,["damage","accident"]);
    const contactEvent=eventForDriver(state,driverId,["contact","overtake_contact","collision"]);
    const severity=damageEvent?.payload?.severity??retirementEvent?.payload?.severity??null;
    const severityScore=finite(
      damageEvent?.payload?.severityScore,
      finite(retirementEvent?.payload?.severityScore,null)
    );
    const pitStops=pitStopRows(car);
    const completedLaps=Math.max(0,Math.floor(finite(row?.completedLaps,car?.completedLaps??0)));
    const finishTimeMs=finite(row?.finishTimeMs,finite(car?.finishTimeMs,null));

    return {
      pos:finite(row?.position,index+1),
      driver,
      driver_id:driverId,
      team_id:row?.teamId??car?.teamId??driver?.team_id??null,
      total_time_ms:retired?null:finishTimeMs,
      gap_to_winner_ms:retired?null:finite(row?.gapToLeaderMs,null),
      gap_to_previous_ms:retired?null:finite(row?.intervalMs,null),
      retired,
      status:retired?"DNF":"Finished",
      retirement_reason:retired?(car?.retirement?.reason??retirementEvent?.payload?.reason??"Retired"):null,
      laps_completed:completedLaps,
      race_laps:totalLaps,
      incident_lap:retired?Math.max(1,Math.floor(finite(car?.lap,completedLaps+1))):null,
      incident_sector:retired?Math.max(1,Math.floor(finite(car?.sector,1))):null,
      incident_kind:retired?(car?.retirement?.kind??retirementEvent?.payload?.kind??null):null,
      incident_reason:retired?(car?.retirement?.reason??retirementEvent?.payload?.reason??null):null,
      incident_severity:severity,
      incident_severity_score:severityScore,
      incident_with_driver_id:otherDriverId(contactEvent,driverId),
      damage_state:car?.damage?structuredClone(car.damage):null,
      damage_severity:car?.damage?.severity??severity??"none",
      damaged_components:damageComponents(car?.damage),
      damage_pace_loss_s_per_lap:finite(car?.damage?.pace_loss_s_per_lap,0),
      pit_stops:pitStops,
      stints:[],
      finish_tyre_id:car?.tyre?.tyre_id??null,
      tyre_condition_finish:finite(car?.tyre?.condition,null),
      strategy_summary:{
        source:CANONICAL_RACE_RESULT_SOURCE,
        pace_mode:car?.resources?.paceMode??null,
        pit_count:pitStops.length,
        fuel_finish_kg:finite(car?.fuelKg,null),
      },
    };
  });
}

export function canonicalRacePostRaceContext(gs,state){
  if(!state||typeof state!=="object")throw new TypeError("Canonical RaceState is required");
  const strategy=gs?.raceWeekendState?.race_strategy||{};
  const weatherSnapshot=strategy?.weather_snapshot||{};
  const track=strategy?.track_snapshot||{};
  const rules=strategy?.rules_snapshot||{};
  const weatherState=state?.weatherState||{};
  const weather={
    ...weatherSnapshot,
    state:weatherState?.state??weatherState?.current?.state??weatherSnapshot?.state??null,
    wet_race:wetRace(state,weatherSnapshot),
    track_wetness:finite(weatherState?.track_wetness,finite(weatherState?.wetness,null)),
    grip_index:finite(weatherState?.grip_index,finite(weatherState?.grip,null)),
  };
  const raceControl={
    source:CANONICAL_RACE_RESULT_SOURCE,
    state:state?.raceControlState?structuredClone(state.raceControlState):null,
    events:(state?.events||[])
      .filter((event)=>["race_control","yellow_flag","safety_car","red_flag","restart"].includes(String(event?.type||"")))
      .map((event)=>structuredClone(event)),
  };
  return {
    source:CANONICAL_RACE_RESULT_SOURCE,
    gameState:gs,
    weather,
    track,
    rules,
    strategyState:strategy,
    raceControlPlan:raceControl,
    summary:{
      source:CANONICAL_RACE_RESULT_SOURCE,
      rules,
      weather,
      track,
      strategies:strategy?.selections||{},
      race_control:raceControl,
    },
  };
}
