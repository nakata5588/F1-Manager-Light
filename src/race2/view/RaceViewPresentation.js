// src/race2/view/RaceViewPresentation.js
// RW12B: pure presentation helpers for Race View camera and weather visuals.
// No race physics or canonical state is mutated here.

const finite=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export const RACE_VIEW_CAMERA_MODES=Object.freeze(["fit","follow","free"]);

export function clampRaceViewZoom(value){
  return clamp(finite(value,1),1,6);
}

export function raceViewBoxCenter(viewBox=[0,0,1,1]){
  const [x,y,width,height]=viewBox.map((value)=>finite(value,0));
  return {x:x+width/2,y:y+height/2};
}

export function raceViewCameraViewBox(baseViewBox=[0,0,1,1],{
  zoom=1,
  center=null,
}={}){
  const [x,y,rawWidth,rawHeight]=baseViewBox.map((value)=>finite(value,0));
  const width=Math.max(1,rawWidth);
  const height=Math.max(1,rawHeight);
  const z=clampRaceViewZoom(zoom);
  const fallback=raceViewBoxCenter([x,y,width,height]);
  const cx=finite(center?.x,fallback.x);
  const cy=finite(center?.y,fallback.y);
  const nextWidth=width/z;
  const nextHeight=height/z;
  return [
    cx-nextWidth/2,
    cy-nextHeight/2,
    nextWidth,
    nextHeight,
  ];
}

export function raceViewWeatherVisuals(trackState={}){
  const rain=clamp(finite(trackState?.rain_intensity,0),0,1);
  const wet=clamp(finite(trackState?.track_wetness,0),0,1);
  const visibility=clamp(finite(trackState?.visibility_index,100)/100,0,1);
  const spray=clamp(finite(trackState?.spray_index,0),0,1);
  const standing=clamp(finite(trackState?.standing_water_index,0)/100,0,1);

  return {
    rain,
    wet,
    visibility,
    spray,
    standing,
    rainOpacity:clamp(rain*0.72,0,0.72),
    fogOpacity:clamp((1-visibility)*0.72,0,0.65),
    wetTrackOpacity:clamp(wet*0.52+standing*0.24,0,0.62),
    sprayOpacity:clamp(spray*0.48,0,0.48),
    grassDarkenOpacity:clamp(rain*0.12+wet*0.08,0,0.18),
  };
}


export function raceViewPitBoxProgress(teamIds,teamId,{
  from=0.30,
  to=0.74,
}={}){
  const unique=[];
  for(const value of Array.isArray(teamIds)?teamIds:[]){
    const id=String(value??"");
    if(id&&!unique.includes(id))unique.push(id);
  }
  const target=String(teamId??"");
  const index=unique.indexOf(target);
  if(index<0)return 0.52;
  if(unique.length<=1)return 0.52;
  const start=clamp(finite(from,0.30),0.05,0.90);
  const end=clamp(finite(to,0.74),start,0.95);
  return Number((start+(end-start)*(index/(unique.length-1))).toFixed(9));
}
