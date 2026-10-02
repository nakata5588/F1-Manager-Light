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

function raceViewTraffic(car){
  const traffic=car?.traffic&&typeof car.traffic==="object"?car.traffic:{};
  return {
    ahead_car_id:traffic?.aheadCarId??null,
    gap_m:finite(traffic?.gapM,null),
    hard_gap_m:finite(traffic?.hardGapM,null),
    desired_gap_m:finite(traffic?.desiredGapM,null),
    follow_range_m:finite(traffic?.followRangeM,null),
    limited:Boolean(traffic?.limited),
    hard_limited:Boolean(traffic?.hardLimited),
    slipstream_active:Boolean(traffic?.slipstreamActive),
    slipstream_ahead_car_id:traffic?.slipstreamAheadCarId??null,
    slipstream_range_m:finite(traffic?.slipstreamRangeM,null),
    slipstream_strength:finite(traffic?.slipstreamStrength,0),
    slipstream_bonus_kmh:finite(traffic?.slipstreamTargetBonusKmh,0),
  };
}

function overtakeStartEvents(state){
  const starts=new Map();
  for(const event of state?.events||[]){
    if(String(event?.type||"")!=="overtake_started")continue;
    const attemptId=text(event?.payload?.attemptId);
    if(attemptId)starts.set(attemptId,event);
  }
  return starts;
}

function raceViewBattleContext(state,car,startEvents){
  const battle=car?.battle&&typeof car.battle==="object"?car.battle:{};
  const phase=String(battle?.phase||"none");
  const traffic=raceViewTraffic(car);
  const now=Math.max(0,finite(state?.simulationTimeMs,0));

  if(phase!=="none"){
    const attemptId=text(battle?.attemptId);
    const started=attemptId?startEvents.get(attemptId):null;
    const payload=started?.payload||{};
    const startedAtMs=finite(battle?.startedAtMs,null);
    const expiresAtMs=finite(battle?.expiresAtMs,null);
    return {
      state:phase,
      role:battle?.role??null,
      opponent_car_id:battle?.opponentCarId??null,
      side:finite(battle?.side,0),
      attempt_id:battle?.attemptId??null,
      result:battle?.result??null,
      started_at_ms:startedAtMs,
      elapsed_ms:startedAtMs==null?null:Math.max(0,now-startedAtMs),
      expires_at_ms:expiresAtMs,
      remaining_ms:expiresAtMs==null?null:Math.max(0,expiresAtMs-now),
      contact_risk_pct:finite(battle?.contactRiskPct,null),
      started_gap_m:finite(payload?.gapM,null),
      attempt_probability_pct:finite(payload?.probability,null)==null
        ?null
        :finite(payload?.probability,0)*100,
      closing_potential_kmh:finite(payload?.closingPotentialMs,null)==null
        ?null
        :finite(payload?.closingPotentialMs,0)*3.6,
      attempt_range_m:finite(payload?.attemptRangeM,null),
      track_difficulty:finite(payload?.trackDifficulty,null),
      slipstream_active:Boolean(traffic.slipstream_active),
      slipstream_strength_pct:finite(traffic.slipstream_strength,0)*100,
      slipstream_bonus_kmh:finite(traffic.slipstream_bonus_kmh,0),
      gap_m:null,
    };
  }

  if(traffic.slipstream_active&&traffic.slipstream_ahead_car_id){
    return {
      state:"slipstream",
      role:"attacker",
      opponent_car_id:traffic.slipstream_ahead_car_id,
      gap_m:traffic.gap_m,
      slipstream_active:true,
      slipstream_strength_pct:finite(traffic.slipstream_strength,0)*100,
      slipstream_bonus_kmh:finite(traffic.slipstream_bonus_kmh,0),
    };
  }

  if((traffic.limited||traffic.hard_limited)&&traffic.ahead_car_id){
    return {
      state:"pressure",
      role:"attacker",
      opponent_car_id:traffic.ahead_car_id,
      gap_m:traffic.gap_m,
      slipstream_active:false,
      slipstream_strength_pct:0,
      slipstream_bonus_kmh:0,
    };
  }

  return null;
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
    spray_index:finite(weather?.spray_index,finite(track?.spray,0)),
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
  const battleStarts=overtakeStartEvents(state);
  const classification=(state?.classification||[]).map((row,index)=>{
    const car=cars.get(text(row?.carId))||{};
    const distanceAlongLapM=Math.max(
      0,
      finite(row?.distanceAlongLapM,finite(car?.distanceAlongLapM,0))
    );
    const progress=lengthM>0?wrap01(distanceAlongLapM/lengthM):0;
    const retired=Boolean(car?.dnf||car?.status==="dnf"||row?.status==="dnf");
    const retirementTrackside=retired&&car?.retirement?.trackside
      ?structuredClone(car.retirement.trackside)
      :null;
    const parkedTrackside=Boolean(
      retirementTrackside&&
      retirementTrackside.status==="parked"&&
      retirementTrackside.visible!==false
    );

    return {
      position:finite(row?.position,index+1),
      driver_id:row?.driverId??car?.driverId??null,
      team_id:row?.teamId??car?.teamId??null,
      car_id:row?.carId??car?.carId??null,
      grid_position:finite(car?.gridPosition,null),
      position_gain:finite(car?.gridPosition,null)==null
        ?0
        :finite(car?.gridPosition,0)-finite(row?.position,index+1),
      previous_lap_position:finite(
        row?.previousLapPosition,
        finite(car?.previousLapPosition,null)
      ),
      last_lap_position:finite(
        row?.lastLapPosition,
        finite(car?.lastLapPosition,finite(car?.gridPosition,null))
      ),
      position_change_last_lap:finite(
        row?.positionChangeLastLap,
        finite(car?.positionChangeLastLap,0)
      ),
      lap:finite(row?.lap,finite(car?.lap,null)),
      laps_completed:finite(row?.completedLaps,finite(car?.completedLaps,0)),
      sector:finite(row?.sector,finite(car?.sector,null)),
      status:retired?"DNF":text(row?.status||car?.status||"running").toUpperCase(),
      retired,
      retirement_reason:car?.retirement?.reason??null,
      incident_lap:retired?finite(car?.lap,null):null,
      incident_sector:retired?finite(car?.sector,null):null,
      gap_to_leader_ms:finite(row?.gapToLeaderMs,null),
      gap_to_previous_ms:finite(row?.intervalMs,null),
      interval_ms:finite(row?.intervalMs,null),
      laps_behind:finite(row?.lapsBehind,0),
      timing_basis:row?.timingBasis??null,
      finish_time_ms:finite(row?.finishTimeMs,null),
      last_lap_ms:finite(row?.lastLapMs,finite(car?.lastLapMs,null)),
      previous_lap_ms:finite(row?.previousLapMs,finite(car?.previousLapMs,null)),
      last_lap_delta_ms:finite(row?.lastLapDeltaMs,finite(car?.lastLapDeltaMs,null)),
      best_lap_ms:finite(row?.bestLapMs,finite(car?.bestLapMs,null)),
      best_lap_number:finite(row?.bestLapNumber,finite(car?.bestLapNumber,null)),
      sector_1_ms:finite(row?.sector1Ms,finite(car?.sector1Ms,null)),
      sector_2_ms:finite(row?.sector2Ms,finite(car?.sector2Ms,null)),
      sector_3_ms:finite(row?.sector3Ms,finite(car?.sector3Ms,null)),
      absolute_distance_m:finite(row?.absoluteDistanceM,finite(car?.absoluteDistanceM,0)),
      distance_along_lap_m:distanceAlongLapM,
      visual_track_progress:progress,
      speed_kmh:finite(car?.speedKmh,0),
      speed_ms:finite(car?.speedMs,0),
      lateral_offset_m:parkedTrackside
        ?finite(retirementTrackside?.lateralOffsetM,finite(car?.lateralOffsetM,0))
        :finite(car?.lateralOffsetM,0),
      retirement_trackside:retirementTrackside,
      current_pace:car?.resources?.paceMode??null,
      planned_stop_lap:finite(car?.resources?.strategy?.plannedStopLap,null),
      pit_plan:car?.resources?.strategy?.pitPlan??null,
      pit_window:car?.resources?.strategy?.forecast?.pit_window
        ?{...car.resources.strategy.forecast.pit_window}
        :finite(car?.resources?.strategy?.plannedStopLap,null)==null
          ?null
          :{
            from_lap:finite(car?.resources?.strategy?.plannedStopLap,null),
            to_lap:finite(car?.resources?.strategy?.plannedStopLap,null),
          },
      pit_rejoin_position:finite(car?.resources?.strategy?.forecast?.pit_rejoin_position,null),
      pit_rejoin_best:finite(car?.resources?.strategy?.forecast?.pit_rejoin_best,null),
      pit_rejoin_worst:finite(car?.resources?.strategy?.forecast?.pit_rejoin_worst,null),
      pit_rejoin_traffic_count:finite(car?.resources?.strategy?.forecast?.pit_rejoin_traffic_count,null),
      projected_finish_position:finite(car?.resources?.strategy?.forecast?.projected_finish_position,null),
      projected_finish_best:finite(car?.resources?.strategy?.forecast?.projected_finish_best,null),
      projected_finish_worst:finite(car?.resources?.strategy?.forecast?.projected_finish_worst,null),
      projection_confidence_pct:finite(car?.resources?.strategy?.forecast?.projection_confidence_pct,null),
      strategy_forecast:car?.resources?.strategy?.forecast
        ?structuredClone(car.resources.strategy.forecast)
        :null,
      tyre:raceViewTyre(car),
      fuel_kg:finite(car?.fuelKg,null),
      engine_temperature:finite(car?.engineTemperature,null),
      damage_state:car?.damage??null,
      damage_severity:car?.damage?.severity??(damageComponents(car?.damage).length?"minor":"none"),
      damaged_components:damageComponents(car?.damage),
      damage_pace_loss_s_per_lap:finite(car?.damage?.pace_loss_s_per_lap,0),
      pit_state:raceViewPitState(car),
      pit_count:(Array.isArray(car?.pitState?.history)?car.pitState.history.length:0)+
        (car?.pitState?.active&&!car?.pitState?.completed?1:0),
      traffic:raceViewTraffic(car),
      battle:car?.battle??null,
      battle_context:raceViewBattleContext(state,car,battleStarts),
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
    pit_lane:state?.track?.pitLane
      ?structuredClone(state.track.pitLane)
      :null,
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
        ?structuredClone(state.raceControlState.redFlagLifecycle)
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
