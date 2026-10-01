// src/race2/adapters/RaceViewProjection.js
// RW8.14A: one-way projection from canonical RaceState into the current Race View read model.
//
// This module deliberately contains no race physics, ordering, gap calculation or
// incident logic. It only renames / reshapes fields already owned by RaceState so
// the existing UI can be migrated without creating a second simulation model.

export const RACE_VIEW_PROJECTION_VERSION=1;
export const RACE_VIEW_PROJECTION_SOURCE="rw8.14_race_view_projection";

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

const text=(value)=>String(value??"");

function wrap01(value){
  const n=finite(value,0);
  const wrapped=((n%1)+1)%1;
  return Number(wrapped.toFixed(9));
}

function canonicalCarMap(state){
  return new Map((state?.cars||[]).map((car)=>[text(car?.carId),car]));
}

function raceViewTyre(car){
  if(!car?.tyre)return null;
  return {
    tyre_id:car.tyre.tyre_id??null,
    compound:car.tyre.compound??null,
    category:car.tyre.category??null,
    condition:finite(car.tyre.condition,null),
    temperature_c:finite(car.tyre.temperature_c,null),
    age_laps:finite(car.tyre.age_laps,null),
  };
}

function raceViewPitState(car){
  const pit=car?.pitState&&typeof car.pitState==="object"?car.pitState:{};
  return {
    ...pit,
    active:Boolean(pit?.active),
  };
}

function raceViewTrackState(state){
  const track=state?.trackState||{};
  const weather=state?.weatherState||{};
  return {
    ...track,
    weather_state:weather?.state??track?.weatherState??null,
    rain_intensity:finite(weather?.rain_intensity,finite(track?.rainIntensity,0)),
    track_wetness:finite(weather?.track_wetness,finite(track?.wetness,0)),
    grip_index:finite(weather?.grip_index,finite(track?.grip,100)),
    visibility_index:finite(weather?.visibility_index,finite(track?.visibility,100)),
    standing_water_index:finite(weather?.standing_water_index,finite(track?.standingWater,0)),
    air_temp_c:finite(weather?.air_temp_c,finite(track?.airTemp,null)),
    track_temp_c:finite(weather?.track_temp_c,finite(track?.trackTemp,null)),
  };
}

function projectedEvent(event,index){
  const driverIds=Array.isArray(event?.driverIds)?event.driverIds:[];
  const carIds=Array.isArray(event?.carIds)?event.carIds:[];
  return {
    ...event,
    key:event?.key??`rw2_event_${event?.tick??0}_${index}`,
    driver_id:event?.driver_id??driverIds[0]??null,
    car_id:event?.car_id??carIds[0]??null,
    lap:finite(event?.lap,event?.payload?.lap??event?.payload?.referenceLap??null),
    sector:finite(event?.sector,event?.payload?.sector??null),
  };
}

export function projectRaceStateToRaceView(state){
  if(!state||typeof state!=="object")throw new TypeError("RaceState is required");

  const lengthM=Math.max(0,finite(state?.track?.lengthM,0));
  const cars=canonicalCarMap(state);
  const classification=(state?.classification||[]).map((row,index)=>{
    const car=cars.get(text(row?.carId))||{};
    const distanceAlongLapM=Math.max(
      0,
      finite(row?.distanceAlongLapM,finite(car?.distanceAlongLapM,0))
    );
    const progress=lengthM>0?wrap01(distanceAlongLapM/lengthM):0;
    const retired=Boolean(car?.dnf||car?.status==="dnf"||row?.status==="dnf");

    return {
      position:finite(row?.position,index+1),
      driver_id:row?.driverId??car?.driverId??null,
      team_id:row?.teamId??car?.teamId??null,
      car_id:row?.carId??car?.carId??null,
      grid_position:finite(car?.gridPosition,null),
      lap:finite(row?.lap,finite(car?.lap,null)),
      laps_completed:finite(row?.completedLaps,finite(car?.completedLaps,0)),
      sector:finite(row?.sector,finite(car?.sector,null)),
      status:retired?"DNF":text(row?.status||car?.status||"running").toUpperCase(),
      retired,
      retirement_reason:car?.retirement?.reason??null,
      gap_to_leader_ms:finite(row?.gapToLeaderMs,null),
      gap_to_previous_ms:finite(row?.intervalMs,null),
      interval_ms:finite(row?.intervalMs,null),
      laps_behind:finite(row?.lapsBehind,0),
      timing_basis:row?.timingBasis??null,
      finish_time_ms:finite(row?.finishTimeMs,null),
      last_lap_ms:finite(row?.lastLapMs,finite(car?.lastLapMs,null)),
      best_lap_ms:finite(row?.bestLapMs,finite(car?.bestLapMs,null)),
      best_lap_number:finite(row?.bestLapNumber,finite(car?.bestLapNumber,null)),
      absolute_distance_m:finite(row?.absoluteDistanceM,finite(car?.absoluteDistanceM,0)),
      distance_along_lap_m:distanceAlongLapM,
      visual_track_progress:progress,
      speed_kmh:finite(car?.speedKmh,0),
      speed_ms:finite(car?.speedMs,0),
      lateral_offset_m:finite(car?.lateralOffsetM,0),
      current_pace:car?.resources?.paceMode??null,
      tyre:raceViewTyre(car),
      fuel_kg:finite(car?.fuelKg,null),
      engine_temperature:finite(car?.engineTemperature,null),
      damage_state:car?.damage??null,
      pit_state:raceViewPitState(car),
      battle:car?.battle??null,
    };
  });

  const leader=classification[0]||null;
  const pitStates={};
  for(const car of state?.cars||[]){
    const key=text(car?.driverId)||text(car?.carId);
    if(key)pitStates[key]=raceViewPitState(car);
  }

  return {
    engine_version:state?.engineVersion??"rw2",
    source:RACE_VIEW_PROJECTION_SOURCE,
    projection_version:RACE_VIEW_PROJECTION_VERSION,
    canonical_tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    canonical_time_ms:Math.max(0,finite(state?.simulationTimeMs,0)),
    track_length_m:lengthM,
    status:state?.status??"ready",
    current_lap:finite(leader?.lap,1),
    current_sector:finite(leader?.sector,1),
    total_laps:finite(state?.session?.lapLimit,null),
    current_control:text(state?.raceControlState?.mode||"GREEN").toUpperCase(),
    last_weather:state?.weatherState?.state??state?.weatherState?.current?.state??"SUNNY",
    track_state:raceViewTrackState(state),
    race_control_state:state?.raceControlState?{
      ...state.raceControlState,
      assessment:state.raceControlState?.assessment
        ?{...state.raceControlState.assessment}
        :state.raceControlState?.assessment??null,
      redFlagLifecycle:state.raceControlState?.redFlagLifecycle
        ?{...state.raceControlState.redFlagLifecycle}
        :state.raceControlState?.redFlagLifecycle??null,
    }:null,
    timing_summary:state?.timingState??null,
    pending_commands:(state?.commandQueue||[]).map((command)=>({
      ...command,
      payload:command?.payload?{...command.payload}:command?.payload,
    })),
    classification,
    pit_states:pitStates,
    events:(state?.events||[]).map(projectedEvent),
  };
}
