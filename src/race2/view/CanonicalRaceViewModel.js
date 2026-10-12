// src/race2/view/CanonicalRaceViewModel.js
// RW9: presentation-only model for the canonical Race View.
//
// Hard rule: car placement comes from canonical physical distance projected by
// RaceViewProjection. No sector/gap/lap reconstruction is allowed here.

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

export function wrapCanonicalTrackProgress(value){
  const n=finite(value,0);
  return ((n%1)+1)%1;
}

export function canonicalRaceViewCars(view){
  const rows=Array.isArray(view?.classification)?view.classification:[];
  return rows.map((row,index)=>({
    id:String(row?.car_id??row?.driver_id??index),
    car_id:row?.car_id??null,
    driver_id:row?.driver_id??null,
    team_id:row?.team_id??null,
    position:finite(row?.position,index+1),
    grid_position:finite(row?.grid_position,null),
    grid_start_offset_m:finite(row?.grid_start_offset_m,null),
    grid_lane_offset_m:finite(row?.grid_lane_offset_m,null),
    position_gain:finite(row?.position_gain,0),
    previous_lap_position:finite(row?.previous_lap_position,null),
    last_lap_position:finite(row?.last_lap_position,null),
    position_change_last_lap:finite(row?.position_change_last_lap,0),
    lap:finite(row?.lap,null),
    laps_completed:finite(row?.laps_completed,0),
    status:String(row?.status??"RUNNING"),
    retired:Boolean(row?.retired),
    track_progress:wrapCanonicalTrackProgress(row?.visual_track_progress),
    distance_along_lap_m:Math.max(0,finite(row?.distance_along_lap_m,0)),
    absolute_distance_m:finite(row?.absolute_distance_m,0),
    speed_kmh:Math.max(0,finite(row?.speed_kmh,0)),
    lateral_offset_m:finite(row?.lateral_offset_m,0),
    retirement_trackside:row?.retirement_trackside??null,
    gap_to_leader_ms:finite(row?.gap_to_leader_ms,null),
    laps_behind:Math.max(0,finite(row?.laps_behind,0)),
    timing_basis:row?.timing_basis??null,
    gap_to_previous_ms:finite(row?.gap_to_previous_ms??row?.interval_ms,null),
    interval_ms:finite(row?.interval_ms??row?.gap_to_previous_ms,null),
    last_lap_ms:finite(row?.last_lap_ms,null),
    best_lap_ms:finite(row?.best_lap_ms,null),
    traffic:row?.traffic??null,
    battle:row?.battle??null,
    battle_context:row?.battle_context??null,
    team_order:row?.team_order??null,
    tyre:row?.tyre??null,
    fuel_kg:finite(row?.fuel_kg,null),
    damage_state:row?.damage_state??null,
    damage_severity:row?.damage_severity??row?.damage_state?.severity??"none",
    damaged_components:Array.isArray(row?.damaged_components)?[...row.damaged_components]:[],
    damage_pace_loss_s_per_lap:finite(row?.damage_pace_loss_s_per_lap,0),
    pit_state:row?.pit_state??null,
    pit_count:Math.max(0,finite(row?.pit_count,0)),
    retirement_reason:row?.retirement_reason??null,
    current_pace:row?.current_pace??null,
    planned_stop_lap:finite(row?.planned_stop_lap,null),
    pit_plan:row?.pit_plan??null,
    next_tyre_id:row?.next_tyre_id??null,
  }));
}

export function canonicalRaceViewLeader(view){
  return canonicalRaceViewCars(view)[0]??null;
}

export function canonicalRaceViewSummary(view){
  const cars=canonicalRaceViewCars(view);
  const leader=cars[0]??null;
  return {
    status:String(view?.status??"ready"),
    control:String(view?.current_control??"GREEN"),
    weather:String(view?.last_weather??"SUNNY"),
    lap:finite(view?.current_lap,leader?.lap??1),
    total_laps:finite(view?.total_laps,null),
    canonical_tick:Math.max(0,Math.floor(finite(view?.canonical_tick,0))),
    canonical_time_ms:Math.max(0,finite(view?.canonical_time_ms,0)),
    cars,
  };
}
