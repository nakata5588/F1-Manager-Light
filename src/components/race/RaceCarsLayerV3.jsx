import React, { memo, useEffect, useRef } from "react";
import { openPolylineHeadingDegrees, sampleOpenPolylinePoint } from "../../domain/trackSceneGeometry.js";
import { racingLinePoseAtProgress } from "../../domain/raceSplineV3.js";
import {
  continuousRaceTargetToken,
  createContinuousRaceSegment,
  retargetContinuousRaceSegment,
  sampleContinuousRaceSegment,
} from "../../domain/raceMotionV3.js";
import { CarShape } from "./RaceCarsLayer.jsx";

function clamp(value,min,max){
  return Math.max(min,Math.min(max,value));
}

function blendHeading(from,to,mix){
  const delta=((Number(to)-Number(from)+540)%360)-180;
  return Number(from)+delta*clamp(Number(mix)||0,0,1);
}

function laneAdjustedPose(line,worldProgress,laneOffset){
  const pose=racingLinePoseAtProgress(line,worldProgress);
  if(!pose)return null;
  const lane=Number(laneOffset)||0;
  if(Math.abs(lane)<.001)return pose;
  const angle=(pose.heading+90)*(Math.PI/180);
  return {
    ...pose,
    x:pose.x+Math.cos(angle)*lane,
    y:pose.y+Math.sin(angle)*lane,
  };
}

function V3CarsLayer({
  geometry,
  racingLine,
  cars=[],
  markerScale=1,
  playbackRunning=true,
  onSelectedPoint,
  lod="overview",
}){
  const nodesRef=useRef(new Map());
  const statesRef=useRef(new Map());
  const carsRef=useRef(cars);
  const selectedPointRef=useRef(onSelectedPoint);
  const clockRef=useRef(0);
  const previousFrameRef=useRef(null);

  useEffect(()=>{carsRef.current=cars;},[cars]);
  useEffect(()=>{selectedPointRef.current=onSelectedPoint;},[onSelectedPoint]);

  useEffect(()=>{
    let frame=null;
    previousFrameRef.current=null;

    const tick=(now)=>{
      const previous=previousFrameRef.current??now;
      const realDt=Math.max(0,Math.min(50,now-previous));
      previousFrameRef.current=now;
      const motionDt=playbackRunning?realDt:0;
      clockRef.current+=motionDt;
      const clock=clockRef.current;
      const smoothingAlpha=motionDt>0?1-Math.exp(-motionDt/72):0;
      const activeIds=new Set();

      for(const car of carsRef.current){
        const id=String(car?.id||"");
        if(!id)continue;
        activeIds.add(id);
        const node=nodesRef.current.get(id);
        if(!node)continue;

        const token=continuousRaceTargetToken(car);
        let state=statesRef.current.get(id);
        if(!state){
          const initial=Number.isFinite(Number(car?.initialWorldProgress))?Number(car.initialWorldProgress):(Number(car?.targetWorldProgress)||0);
          state={
            token,
            segment:createContinuousRaceSegment({
              position:initial,
              targetPosition:Number(car?.targetWorldProgress)||initial,
              durationMs:Number(car?.motionDurationMs)||1000,
              clockMs:clock,
              stopped:Boolean(car?.stopped),
            }),
            pitProgress:Number(car?.targetPitLaneProgress)||0,
            pitMix:Number(car?.targetPitLaneMix)||0,
            laneOffset:Number(car?.laneOffset)||0,
            body:null,
            lastTransform:"",
            lastHeading:null,
          };
          statesRef.current.set(id,state);
        }else if(state.token!==token){
          state.segment=retargetContinuousRaceSegment(state.segment,{
            targetPosition:Number(car?.targetWorldProgress)||0,
            durationMs:Number(car?.motionDurationMs)||1000,
            clockMs:clock,
            stopped:Boolean(car?.stopped),
          });
          state.token=token;
        }

        const motion=sampleContinuousRaceSegment(state.segment,clock);
        if(smoothingAlpha>0){
          state.pitProgress+=(Number(car?.targetPitLaneProgress||0)-state.pitProgress)*smoothingAlpha;
          state.pitMix+=(Number(car?.targetPitLaneMix||0)-state.pitMix)*smoothingAlpha;
          state.laneOffset+=(Number(car?.laneOffset||0)-state.laneOffset)*smoothingAlpha;
        }

        const trackPose=laneAdjustedPose(racingLine,motion.position,state.laneOffset*(1-clamp(state.pitMix,0,1)));
        if(!trackPose)continue;
        const pitPoint=Array.isArray(geometry?.pit_lane_points)&&geometry.pit_lane_points.length>1
          ?sampleOpenPolylinePoint(geometry.pit_lane_points,state.pitProgress)
          :null;
        const pitMix=pitPoint?clamp(state.pitMix,0,1):0;
        const pitHeading=pitPoint?openPolylineHeadingDegrees(geometry.pit_lane_points,state.pitProgress):trackPose.heading;
        const point={
          x:trackPose.x+(pitPoint?.x-trackPose.x||0)*pitMix,
          y:trackPose.y+(pitPoint?.y-trackPose.y||0)*pitMix,
          heading:blendHeading(trackPose.heading,pitHeading,pitMix),
        };

        const transform=`translate(${point.x.toFixed(3)} ${point.y.toFixed(3)}) scale(${markerScale})`;
        if(transform!==state.lastTransform){
          node.setAttribute("transform",transform);
          state.lastTransform=transform;
        }
        state.body=state.body||node.querySelector('[data-car-body="true"]');
        if(state.body&&(!Number.isFinite(state.lastHeading)||Math.abs(point.heading-state.lastHeading)>.02)){
          state.body.setAttribute("transform",`rotate(${point.heading.toFixed(3)})`);
          state.lastHeading=point.heading;
        }
        if(car.selected)selectedPointRef.current?.(point);
      }

      for(const id of statesRef.current.keys()){
        if(!activeIds.has(id))statesRef.current.delete(id);
      }
      frame=requestAnimationFrame(tick);
    };

    frame=requestAnimationFrame(tick);
    return ()=>{if(frame)cancelAnimationFrame(frame);};
  },[geometry,racingLine,markerScale,playbackRunning]);

  return <g data-race-motion-engine="v3">
    {cars.map((car)=><g
      key={String(car.id)}
      ref={(node)=>{
        const id=String(car.id);
        if(node)nodesRef.current.set(id,node);
        else nodesRef.current.delete(id);
      }}
      role="button"
      tabIndex="0"
      data-track-interactive="true"
      className="cursor-pointer outline-none"
      onClick={car.onSelect}
      onKeyDown={(event)=>{
        if(event.key==="Enter"||event.key===" "){
          event.preventDefault();
          car.onSelect?.();
        }
      }}
    >
      <title>{car.title}</title>
      <CarShape {...car} lod={lod}/>
    </g>)}
  </g>;
}

export default memo(V3CarsLayer);
