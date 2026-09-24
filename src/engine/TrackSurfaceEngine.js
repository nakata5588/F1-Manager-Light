// src/engine/TrackSurfaceEngine.js
// RW5.2D1 — shared dynamic track-surface model.
//
// The surface is stateful: rain adds water, drainage/traffic/heat remove it,
// dry running lays rubber down, and sustained rain washes rubber away.
// Grip is derived from the current surface rather than starting near-perfect.

const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const upper=(v)=>String(v??"SUNNY").toUpperCase();

export const TRACK_RAIN_INTENSITY=Object.freeze({
  SUNNY:0,
  CLOUDY:0,
  WINDY:0,
  DRYING:0,
  DRIZZLE_DRYING:0.06,
  WETTING:0.28,
  LIGHT_RAIN:0.46,
  HEAVY_RAIN:0.80,
  STORM:1,
});

export function rainIntensityForState(state){
  return clamp(TRACK_RAIN_INTENSITY[upper(state)]??0,0,1);
}

export function rainIntensityBand(value){
  const n=clamp(value,0,1);
  if(n<=0.01)return "NONE";
  if(n<0.16)return "DRIZZLE";
  if(n<0.38)return "LIGHT";
  if(n<0.68)return "MODERATE";
  if(n<0.90)return "HEAVY";
  return "EXTREME";
}

function windDryingFactor(profile){
  const p=String(profile??"medium").toLowerCase();
  if(p==="high"||p==="strong")return 1.22;
  if(p==="low"||p==="calm")return 0.88;
  return 1;
}

function surfaceGrip({wetness=0,rubber=0,state="SUNNY"}={}){
  const wet=clamp(wetness,0,1);
  const rub=clamp(rubber,0,100);
  // This is a track-condition index, not a literal percentage of physical tyre
  // adhesion. A green circuit starts around 55–60, then builds toward the 80s/90s
  // as the racing line rubbers in. Water removes a progressively larger share.
  const dryGrip=55.5+rub*0.37;
  const waterPenalty=wet*(18+wet*17);
  const stormPenalty=upper(state)==="STORM"?7:0;
  return clamp(dryGrip-waterPenalty-stormPenalty,20,100);
}

export function initialiseTrackSurface({
  state="SUNNY",
  startingWetness=0,
  rubberLevel=12,
}={}){
  const wetness=clamp(startingWetness,0,1);
  const rubber=clamp(rubberLevel,0,100);
  const intensity=rainIntensityForState(state);
  return {
    state:upper(state),
    rain_intensity:Number(intensity.toFixed(3)),
    rain_band:rainIntensityBand(intensity),
    track_wetness:Number(wetness.toFixed(3)),
    rubber_level:Number(rubber.toFixed(1)),
    grip_index:Number(surfaceGrip({wetness,rubber,state}).toFixed(1)),
  };
}

export function evolveTrackSurface(previous,{
  state="SUNNY",
  rainIntensity=null,
  carsOnTrack=20,
  trackTempC=26,
  windProfile="medium",
  drainage=0.5,
  lapFraction=1,
}={}){
  const prev=previous||initialiseTrackSurface({state});
  const weatherState=upper(state);
  const intensity=rainIntensity==null
    ?rainIntensityForState(weatherState)
    :clamp(rainIntensity,0,1);
  const fraction=clamp(lapFraction,0.05,4);
  const cars=clamp(num(carsOnTrack,20),0,40);
  const trafficFactor=clamp(cars/20,0,1.6);
  const drainageLevel=clamp(num(drainage,0.5),0,1);
  const temp=Math.max(0,num(trackTempC,26));

  let wetness=clamp(prev.track_wetness,0,1);
  let rubber=clamp(prev.rubber_level,0,100);

  // Rainfall accumulates continuously. Drainage still acts while it rains, so a
  // light shower wets the circuit gradually while heavy rain can overwhelm it.
  const rainfallGain=intensity*0.105*fraction;
  const drainageLoss=(0.012+drainageLevel*0.012)
    *(1-intensity*0.42)
    *windDryingFactor(windProfile)
    *fraction;
  const temperatureEvaporation=(intensity<0.18
    ?0.002+Math.max(0,temp-15)*0.00022
    :0.0006+Math.max(0,temp-24)*0.00005)*fraction;
  const trafficDrying=(wetness>0.02
    ?(0.0035+0.0045*trafficFactor)*(1-intensity*0.72)
    :0)*fraction;

  wetness=clamp(
    wetness+rainfallGain-drainageLoss-temperatureEvaporation-trafficDrying,
    0,1
  );

  // Cars lay rubber on a dry racing line. Sustained rain and high surface water
  // wash that rubber away; damp conditions largely pause rubber build-up.
  if(wetness<0.10&&intensity<0.08){
    rubber+=0.24*trafficFactor*fraction;
  }else if(wetness<0.20&&intensity<0.16){
    rubber+=0.07*trafficFactor*fraction;
  }else if(intensity>=0.20||wetness>=0.30){
    const wash=(intensity*0.48+Math.max(0,wetness-0.30)*0.20)*fraction;
    rubber-=wash;
  }
  rubber=clamp(rubber,0,100);

  return {
    state:weatherState,
    rain_intensity:Number(intensity.toFixed(3)),
    rain_band:rainIntensityBand(intensity),
    track_wetness:Number(wetness.toFixed(3)),
    rubber_level:Number(rubber.toFixed(1)),
    grip_index:Number(surfaceGrip({wetness,rubber,state:weatherState}).toFixed(1)),
  };
}

export function evolveSessionSurface(previous,{
  state="SUNNY",
  kind="practice",
  gapDays=0,
  carsOnTrack=20,
  trackTempC=26,
  windProfile="medium",
  drainage=0.5,
}={}){
  let start=previous||initialiseTrackSurface({
    state,
    startingWetness:0,
    rubberLevel:12,
  });

  // Between sessions, an already-wet circuit can drain substantially even if no
  // cars are running. We deliberately keep this conservative until D2 supplies
  // richer temperature/cloud inputs.
  if(Number(gapDays)>0){
    const dryState=rainIntensityForState(state)<=0.01;
    const decay=dryState?Math.pow(0.56,Number(gapDays)):Math.pow(0.82,Number(gapDays));
    start={
      ...start,
      track_wetness:Number(clamp(num(start.track_wetness)*decay,0,1).toFixed(3)),
    };
    start.grip_index=Number(surfaceGrip({
      wetness:start.track_wetness,
      rubber:start.rubber_level,
      state,
    }).toFixed(1));
  }

  const startSnapshot={...start,state:upper(state)};
  const steps=kind==="practice"?18:kind==="qualifying"?12:kind==="race"?24:10;
  let end=startSnapshot;
  for(let i=0;i<steps;i+=1){
    end=evolveTrackSurface(end,{
      state,
      carsOnTrack,
      trackTempC,
      windProfile,
      drainage,
      lapFraction:1,
    });
  }

  return {
    start_wetness:Number(startSnapshot.track_wetness.toFixed(3)),
    end_wetness:Number(end.track_wetness.toFixed(3)),
    start_rubber_level:Number(startSnapshot.rubber_level.toFixed(1)),
    end_rubber_level:Number(end.rubber_level.toFixed(1)),
    start_grip_index:Number(startSnapshot.grip_index.toFixed(1)),
    end_grip_index:Number(end.grip_index.toFixed(1)),
    rain_intensity:Number(end.rain_intensity.toFixed(3)),
    rain_band:end.rain_band,
    // Backwards-compatible aliases used by existing Race Weekend consumers.
    rubber_level:Number(end.rubber_level.toFixed(1)),
    grip_index:Number(end.grip_index.toFixed(1)),
  };
}
