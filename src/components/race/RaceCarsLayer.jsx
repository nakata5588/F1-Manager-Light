import React, { memo, useEffect, useRef } from "react";
import { openPolylineHeadingDegrees, sampleOpenPolylinePoint, trackHeadingDegrees } from "../../domain/trackSceneGeometry.js";
import { pointAtTrackProgress } from "../../domain/trackLayout.js";
import { unwrapTrackProgress } from "../../domain/racePlayback.js";

function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function wrap01(value){const n=Number(value)||0;return ((n%1)+1)%1;}

function visualPoint(geometry,state){
  const track=pointAtTrackProgress(geometry,wrap01(state.progress));
  if(!track)return null;
  const pit=Number.isFinite(state.pitProgress)?sampleOpenPolylinePoint(geometry?.pit_lane_points,state.pitProgress):null;
  const mix=pit?clamp(state.pitMix,0,1):0;
  let x=track.x+(pit?.x-track.x||0)*mix;
  let y=track.y+(pit?.y-track.y||0)*mix;
  const lane=Number(state.laneOffset||0)*(1-mix);
  if(Math.abs(lane)>.001){
    const before=pointAtTrackProgress(geometry,wrap01(state.progress-.0045));
    const after=pointAtTrackProgress(geometry,wrap01(state.progress+.0045));
    if(before&&after){
      const dx=after.x-before.x,dy=after.y-before.y,len=Math.hypot(dx,dy)||1;
      x+=(-dy/len)*lane;
      y+=(dx/len)*lane;
    }
  }
  const trackHeading=trackHeadingDegrees(geometry,wrap01(state.progress));
  const pitHeading=openPolylineHeadingDegrees(geometry?.pit_lane_points,state.pitProgress);
  const delta=((pitHeading-trackHeading+540)%360)-180;
  const heading=trackHeading+delta*mix;
  return {x,y,heading};
}

export function CarShape({color,secondary,label,selected,mine,retired,lod="overview"}){
  return <>
    {selected?<circle cx="0" cy="0" r="16" fill="none" stroke="#fff" strokeWidth="1.6" opacity=".38">
      <animate attributeName="r" values="13;17;13" dur="1.1s" repeatCount="indefinite"/>
    </circle>:null}
    <g data-car-body="true" opacity={retired?0.6:1}>
      <ellipse cx="-1.5" cy="2.2" rx="13.8" ry="5.2" fill="#020617" opacity=".3"/>
      <rect x="-8.5" y="-7.2" width="5.4" height="4.2" rx="1" fill="#05070a"/>
      <rect x="-8.5" y="3" width="5.4" height="4.2" rx="1" fill="#05070a"/>
      <rect x="5.1" y="-6.6" width="5.2" height="3.8" rx="1" fill="#05070a"/>
      <rect x="5.1" y="2.8" width="5.2" height="3.8" rx="1" fill="#05070a"/>
      <rect x="-12" y="-5.6" width="3.4" height="11.2" rx=".7" fill={secondary} stroke="#020617" strokeWidth=".8"/>
      <path d="M -9 -3.9 L -5.3 -5.1 L 2.8 -4.3 L 7.4 -2.5 L 13.8 -1.4 L 16 0 L 13.8 1.4 L 7.4 2.5 L 2.8 4.3 L -5.3 5.1 L -9 3.9 Z" fill={retired?"#7f1d1d":color} stroke={selected?"#fff":"#0b0f16"} strokeWidth={selected?1.5:1}/>
      <path d="M -6.8 -2.8 L -1.5 -3.3 L 2.6 -2.4 L 2.6 2.4 L -1.5 3.3 L -6.8 2.8 Z" fill={secondary} opacity=".9"/>
      <ellipse cx="1.1" cy="0" rx="2.8" ry="2.25" fill="#111827" stroke="#cbd5e1" strokeWidth=".65"/>
    </g>
    {(selected||mine||lod==="close")?<g data-car-label="true" transform="translate(0 -14)">
      <rect x="-10.5" y="-3.8" width="21" height="7.5" rx="3.7" fill="#020617" stroke={selected?"#fff":mine?"#fbbf24":"#475569"} strokeWidth="1" opacity={lod==="close"?.94:.82}/>
      <text x="0" y="1.5" textAnchor="middle" fontSize="5.7" fontWeight="900" fill="#fff">{label}</text>
    </g>:null}
  </>;
}

function RaceCarsLayer({geometry,cars=[],markerScale=1,playbackRunning=true,onSelectedPoint,lod="overview"}){
  const refs=useRef(new Map());
  const motion=useRef(new Map());
  const carsRef=useRef(cars);
  const selectedPointRef=useRef(onSelectedPoint);
  useEffect(()=>{carsRef.current=cars;},[cars]);
  useEffect(()=>{selectedPointRef.current=onSelectedPoint;},[onSelectedPoint]);

  useEffect(()=>{
    let frame=null;
    let previous=performance.now();
    const tick=(now)=>{
      const dt=Math.max(1,Math.min(50,now-previous)); previous=now;
      const alpha=1-Math.exp(-dt/48);
      for(const car of carsRef.current){
        const node=refs.current.get(car.id);
        if(!node)continue;
        let state=motion.current.get(car.id);
        const targetProgress=Number(car.progress)||0;
        if(!state){
          state={progress:targetProgress,pitProgress:Number(car.pitLaneProgress)||0,pitMix:Number(car.pitLaneMix)||0,laneOffset:Number(car.laneOffset)||0,body:null,lastTransform:"",lastHeading:null};
          motion.current.set(car.id,state);
        }else{
          const unwrapped=unwrapTrackProgress(state.progress,targetProgress);
          const settle=playbackRunning?alpha:Math.min(1,alpha*1.8);
          state.progress+= (unwrapped-state.progress)*settle;
          state.pitProgress+=((Number(car.pitLaneProgress)||0)-state.pitProgress)*settle;
          state.pitMix+=((Number(car.pitLaneMix)||0)-state.pitMix)*settle;
          state.laneOffset+=((Number(car.laneOffset)||0)-state.laneOffset)*settle;
        }
        const point=visualPoint(geometry,state);
        if(!point)continue;
        const transform=`translate(${point.x.toFixed(3)} ${point.y.toFixed(3)}) scale(${markerScale})`;
        if(transform!==state.lastTransform){
          node.setAttribute("transform",transform);
          state.lastTransform=transform;
        }
        state.body=state.body||node.querySelector('[data-car-body="true"]');
        if(state.body&&(!Number.isFinite(state.lastHeading)||Math.abs(point.heading-state.lastHeading)>.03)){
          state.body.setAttribute("transform",`rotate(${point.heading.toFixed(3)})`);
          state.lastHeading=point.heading;
        }
        if(car.selected)selectedPointRef.current?.(point);
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return ()=>{if(frame)cancelAnimationFrame(frame);};
  },[geometry,markerScale,playbackRunning]);

  return <g>
    {cars.map((car)=><g
      key={car.id}
      ref={(node)=>{if(node)refs.current.set(car.id,node);else refs.current.delete(car.id);}}
      role="button"
      tabIndex="0"
      data-track-interactive="true"
      className="cursor-pointer outline-none"
      onClick={car.onSelect}
      onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();car.onSelect?.();}}}
    >
      <title>{car.title}</title>
      <CarShape {...car} lod={lod}/>
    </g>)}
  </g>;
}

export default memo(RaceCarsLayer);
