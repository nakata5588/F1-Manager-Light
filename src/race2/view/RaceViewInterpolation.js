// src/race2/view/RaceViewInterpolation.js
// RW12A: presentation-only interpolation between canonical Race View snapshots.
//
// Hard rule: this module never changes RaceState, classification, gaps, timing,
// incidents or race physics. It only smooths the visual car pose between two
// already-authoritative snapshots.

const finite=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function wrapRaceViewDistanceM(distanceM,trackLengthM){
  const length=Math.max(1,finite(trackLengthM,1));
  const distance=finite(distanceM,0);
  return ((distance%length)+length)%length;
}

export function raceViewInterpolationDurationMs(
  previousCanonicalTimeMs,
  nextCanonicalTimeMs,
  playbackSpeed=1
){
  const previous=finite(previousCanonicalTimeMs,0);
  const next=finite(nextCanonicalTimeMs,previous);
  const delta=Math.max(0,next-previous);
  if(delta<=0)return 0;
  const speed=Math.max(0.05,finite(playbackSpeed,1));
  return clamp(delta/speed,8,250);
}

export function raceViewInterpolationAlpha(startedAtMs,durationMs,timestampMs){
  const duration=Math.max(0,finite(durationMs,0));
  if(duration<=0)return 1;
  return clamp(
    (finite(timestampMs,startedAtMs)-finite(startedAtMs,0))/duration,
    0,
    1
  );
}

function interpolateNumber(from,to,alpha){
  const a=finite(from,finite(to,0));
  const b=finite(to,a);
  return a+(b-a)*alpha;
}

export function interpolateRaceViewCar(fromCar,toCar,{
  alpha=1,
  trackLengthM=1,
}={}){
  if(!toCar)return null;
  if(!fromCar)return {...toCar};

  const t=clamp(finite(alpha,1),0,1);
  const absoluteDistance=interpolateNumber(
    fromCar?.absolute_distance_m,
    toCar?.absolute_distance_m,
    t
  );
  const distanceAlong=wrapRaceViewDistanceM(absoluteDistance,trackLengthM);
  const progress=distanceAlong/Math.max(1,finite(trackLengthM,1));
  const lateralOffset=interpolateNumber(
    fromCar?.lateral_offset_m,
    toCar?.lateral_offset_m,
    t
  );

  return {
    ...toCar,
    // Only pose fields are interpolated. Everything else remains the latest
    // canonical read model so timing/classification never becomes visual logic.
    absolute_distance_m:absoluteDistance,
    distance_along_lap_m:distanceAlong,
    track_progress:progress,
    lateral_offset_m:lateralOffset,
  };
}

export function interpolateRaceViewCars(fromCars,toCars,{
  alpha=1,
  trackLengthM=1,
}={}){
  const previousById=new Map(
    (Array.isArray(fromCars)?fromCars:[]).map((car)=>[String(car?.id??car?.car_id??""),car])
  );
  return (Array.isArray(toCars)?toCars:[]).map((target)=>{
    const key=String(target?.id??target?.car_id??"");
    return interpolateRaceViewCar(previousById.get(key)||null,target,{
      alpha,
      trackLengthM,
    });
  }).filter(Boolean);
}
