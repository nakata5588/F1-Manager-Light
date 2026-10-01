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
    lap:finite(row?.lap,null),
    laps_completed:finite(row?.laps_completed,0),
    status:String(row?.status??"RUNNING"),
    retired:Boolean(row?.retired),
    track_progress:wrapCanonicalTrackProgress(row?.visual_track_progress),
    distance_along_lap_m:Math.max(0,finite(row?.distance_along_lap_m,0)),
    absolute_distance_m:Math.max(0,finite(row?.absolute_distance_m,0)),
    speed_kmh:Math.max(0,finite(row?.speed_kmh,0)),
    lateral_offset_m:finite(row?.lateral_offset_m,0),
    gap_to_leader_ms:finite(row?.gap_to_leader_ms,null),
    interval_ms:finite(row?.interval_ms??row?.gap_to_previous_ms,null),
    tyre:row?.tyre??null,
    fuel_kg:finite(row?.fuel_kg,null),
    damage_state:row?.damage_state??null,
    pit_state:row?.pit_state??null,
    current_pace:row?.current_pace??null,
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
