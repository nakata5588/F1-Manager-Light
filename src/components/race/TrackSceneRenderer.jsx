import React, { useMemo } from "react";
import { deterministicTrackScatter, offsetTrackPolyline, trackRibbonPolygon } from "../../domain/trackSceneGeometry.js";

function pointsAttr(points=[]){
  return (points||[]).map((point)=>point.join(",")).join(" ");
}

function boundsForPolygon(points=[]){
  if(!Array.isArray(points)||!points.length)return null;
  const xs=points.map((point)=>Number(point?.[0])).filter(Number.isFinite);
  const ys=points.map((point)=>Number(point?.[1])).filter(Number.isFinite);
  if(!xs.length||!ys.length)return null;
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  return [minX,minY,maxX-minX,maxY-minY];
}

function TreeSprite({tree,index=0}){
  const [x,y,r=12,variant=.5]=tree||[];
  const rotation=(Number(variant||0)*1000+index*37)%360;
  const light=Number(variant||0)>.5?"#5c9d45":"#4b8d3a";
  return <g transform={`translate(${x} ${y}) rotate(${rotation})`} pointerEvents="none">
    <ellipse cx="4" cy="7" rx={r*1.1} ry={r*.72} fill="#020617" opacity=".22"/>
    <circle cx="0" cy="0" r={r} fill="#153f20"/>
    <circle cx={-r*.28} cy={-r*.24} r={r*.72} fill="#27642f"/>
    <circle cx={r*.31} cy={-r*.12} r={r*.62} fill={light}/>
    <circle cx={-r*.06} cy={r*.29} r={r*.56} fill="#32793b"/>
    <circle cx={-r*.33} cy={-r*.36} r={r*.17} fill="#8fbe64" opacity=".75"/>
  </g>;
}

function Building({row,index=0}){
  const x=Number(row?.x||0),y=Number(row?.y||0),w=Number(row?.w||40),h=Number(row?.h||30);
  const roof=index%3===0?"#d8dde1":index%3===1?"#bfc6cb":"#e4e7e9";
  return <g pointerEvents="none">
    <rect x={x+8} y={y+9} width={w} height={h} rx="3" fill="#020617" opacity=".28"/>
    <rect x={x} y={y} width={w} height={h} rx="3" fill={roof} stroke="#777f86" strokeWidth="2"/>
    <rect x={x+5} y={y+5} width={Math.max(2,w-10)} height={Math.max(2,h-10)} rx="2" fill="url(#f1track-roof)" opacity=".65"/>
    <line x1={x+w*.5} y1={y+3} x2={x+w*.5} y2={y+h-3} stroke="#8c949b" strokeWidth="1.5" opacity=".7"/>
    <line x1={x+3} y1={y+h*.52} x2={x+w-3} y2={y+h*.52} stroke="#8c949b" strokeWidth="1.5" opacity=".6"/>
  </g>;
}

function Grandstand({row,index=0}){
  const x=Number(row?.x||0),y=Number(row?.y||0),w=Number(row?.w||70),h=Number(row?.h||26);
  const cx=x+w/2,cy=y+h/2;
  return <g transform={`rotate(${Number(row?.rotation||0)} ${cx} ${cy})`} pointerEvents="none">
    <rect x={x+7} y={y+8} width={w} height={h} rx="2" fill="#020617" opacity=".34"/>
    <rect x={x} y={y} width={w} height={h} rx="2" fill="#222b36" stroke="#8b96a3" strokeWidth="2"/>
    {Array.from({length:6},(_,line)=><line
      key={line}
      x1={x+4}
      y1={y+4+(line*(h-8)/5)}
      x2={x+w-4}
      y2={y+4+(line*(h-8)/5)}
      stroke={line%3===0?"#60a5fa":line%3===1?"#ef4444":"#e5e7eb"}
      strokeWidth="2.3"
      opacity=".72"
    />)}
    {Array.from({length:8},(_,seat)=><circle
      key={"seat-"+seat}
      cx={x+8+(seat*(w-16)/7)}
      cy={y+h*.45+((seat+index)%2)*4}
      r="1.7"
      fill={seat%2?"#f59e0b":"#cbd5e1"}
      opacity=".8"
    />)}
  </g>;
}

export default function TrackSceneRenderer({
  geometry,
  environment,
  style={},
  viewBox=[0,0,1000,1000],
  wetness=0,
}){
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  const roadWidth=Math.max(18,Number(style?.road_width||31));
  const halfWidth=roadWidth/2;
  const ribbon=useMemo(()=>trackRibbonPolygon(points,halfWidth),[points,halfWidth]);
  const shoulder=useMemo(()=>trackRibbonPolygon(points,halfWidth+5.5),[points,halfWidth]);
  const leftKerb=useMemo(()=>offsetTrackPolyline(points,halfWidth+1.6),[points,halfWidth]);
  const rightKerb=useMemo(()=>offsetTrackPolyline(points,-halfWidth-1.6),[points,halfWidth]);
  const leftBarrier=useMemo(()=>offsetTrackPolyline(points,halfWidth+17),[points,halfWidth]);
  const rightBarrier=useMemo(()=>offsetTrackPolyline(points,-halfWidth-17),[points,halfWidth]);
  const closed=(list)=>list?.length?[...list,list[0]]:[];
  const [vx,vy,vw,vh]=Array.isArray(viewBox)&&viewBox.length===4?viewBox.map(Number):[0,0,1000,1000];

  const exclusions=useMemo(()=>{
    const result=[];
    for(const row of environment?.buildings||[])result.push([Number(row.x)-10,Number(row.y)-10,Number(row.w)+20,Number(row.h)+20]);
    for(const row of environment?.grandstands||[])result.push([Number(row.x)-12,Number(row.y)-12,Number(row.w)+24,Number(row.h)+24]);
    const lakeBounds=boundsForPolygon(environment?.lake);
    if(lakeBounds)result.push(lakeBounds);
    return result;
  },[environment]);

  const scatteredTrees=useMemo(()=>deterministicTrackScatter({
    bounds:[vx,vy,vw,vh],
    geometry,
    count:120,
    seed:`${geometry?.package_id||"f1track"}:trees`,
    minTrackDistance:58,
    radius:[7,16],
    exclude:exclusions,
  }),[vx,vy,vw,vh,geometry,exclusions]);

  const allTrees=useMemo(()=>{
    const manual=(environment?.trees||[]).map((tree,index)=>[
      Number(tree?.[0]||0),Number(tree?.[1]||0),Number(tree?.[2]||11),((index*53)%100)/100
    ]);
    return [...manual,...scatteredTrees];
  },[environment,scatteredTrees]);

  const wet=Math.max(0,Math.min(1,Number(wetness)||0));

  return <g aria-hidden="true">
    <defs>
      <filter id="f1track-ground-noise" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="3" seed="31" result="noise"/>
        <feColorMatrix in="noise" type="saturate" values=".35" result="softNoise"/>
        <feBlend in="SourceGraphic" in2="softNoise" mode="soft-light"/>
      </filter>
      <filter id="f1track-asphalt-noise" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency=".07" numOctaves="2" seed="17" result="noise"/>
        <feColorMatrix in="noise" values=".35 0 0 0 0  0 .35 0 0 0  0 0 .35 0 0  0 0 0 .45 0" result="grain"/>
        <feBlend in="SourceGraphic" in2="grain" mode="screen"/>
      </filter>
      <linearGradient id="f1track-water-gradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#117f96"/>
        <stop offset="55%" stopColor="#09677d"/>
        <stop offset="100%" stopColor="#064e64"/>
      </linearGradient>
      <linearGradient id="f1track-asphalt-gradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={style?.asphalt_highlight||"#383b3f"}/>
        <stop offset="45%" stopColor={style?.asphalt||"#292c2f"}/>
        <stop offset="100%" stopColor="#1d2024"/>
      </linearGradient>
      <pattern id="f1track-roof" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M0 0 H10 M0 5 H10" stroke="#fff" strokeWidth=".8" opacity=".22"/>
      </pattern>
      <pattern id="f1track-road-dashes" width="32" height="10" patternUnits="userSpaceOnUse">
        <rect width="15" height="1.4" x="2" y="4.3" fill="#d1d5db" opacity=".38"/>
      </pattern>
      <pattern id="f1track-water-ripples" width="42" height="18" patternUnits="userSpaceOnUse">
        <path d="M0 9 Q10 2 21 9 T42 9" fill="none" stroke="#78d9e8" strokeWidth="1.5" opacity=".35"/>
      </pattern>
    </defs>

    <rect x={vx} y={vy} width={vw} height={vh} fill={environment?.base||style?.grass||"#3f612c"} filter="url(#f1track-ground-noise)"/>
    <rect x={vx} y={vy} width={vw} height={vh} fill="#789849" opacity=".08"/>

    {(environment?.roads||[]).map((road,index)=><g key={"service-road-"+index} pointerEvents="none">
      <polyline points={pointsAttr(road.points)} fill="none" stroke="#202427" strokeWidth={Number(road.width||14)+7} strokeLinecap="round" strokeLinejoin="round" opacity=".8"/>
      <polyline points={pointsAttr(road.points)} fill="none" stroke="#565b5f" strokeWidth={Number(road.width||14)} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={pointsAttr(road.points)} fill="none" stroke="url(#f1track-road-dashes)" strokeWidth={Math.max(2,Number(road.width||14)-4)} strokeLinecap="round" opacity=".55"/>
    </g>)}

    {Array.isArray(environment?.lake)&&environment.lake.length>2?<g pointerEvents="none">
      <polygon points={pointsAttr(environment.lake)} fill="#052f3a" opacity=".42" transform="translate(5 7)"/>
      <polygon points={pointsAttr(environment.lake)} fill="url(#f1track-water-gradient)" stroke="#0b5668" strokeWidth="7"/>
      <polygon points={pointsAttr(environment.lake)} fill="url(#f1track-water-ripples)" opacity=".82"/>
    </g>:null}

    {(environment?.sand||[]).map((zone,index)=><polygon key={"sand-"+index} points={pointsAttr(zone)} fill="#d8bd7c" stroke="#b4965a" strokeWidth="4" opacity=".98" filter="url(#f1track-ground-noise)"/>)}
    {(environment?.runoffs||[]).map((zone,index)=><polygon key={"runoff-"+index} points={pointsAttr(zone)} fill={index%2?"#2f9e77":"#3faa7b"} stroke="#d1d5db" strokeWidth="2.5" opacity=".92"/>)}

    {allTrees.map((tree,index)=><TreeSprite key={"tree-"+index} tree={tree} index={index}/>)}
    {(environment?.buildings||[]).map((row,index)=><Building key={"building-"+index} row={row} index={index}/>)}
    {(environment?.grandstands||[]).map((row,index)=><Grandstand key={"stand-"+index} row={row} index={index}/>)}

    {ribbon.length>2?<g pointerEvents="none">
      <polygon points={pointsAttr(trackRibbonPolygon(points,halfWidth+11))} fill="#020617" opacity=".24" transform="translate(4 6)"/>
      <polygon points={pointsAttr(trackRibbonPolygon(points,halfWidth+7))} fill="#2f6f45" opacity=".88"/>
      <polygon points={pointsAttr(shoulder)} fill="#e5e7eb" opacity=".94"/>
      <polygon points={pointsAttr(ribbon)} fill="url(#f1track-asphalt-gradient)" filter="url(#f1track-asphalt-noise)"/>
      <polygon points={pointsAttr(ribbon)} fill="#9bd5e2" opacity={wet*.11}/>
      <polyline points={pointsAttr(closed(points))} fill="none" stroke="#c8d0d6" strokeWidth="1.2" strokeDasharray="3 13" opacity=".18"/>
    </g>:null}

    <g pointerEvents="none">
      {[leftKerb,rightKerb].map((edge,index)=><g key={"kerb-"+index}>
        <polyline points={pointsAttr(closed(edge))} fill="none" stroke={style?.kerb_white||"#f8fafc"} strokeWidth="8.5" strokeLinejoin="round" strokeLinecap="butt"/>
        <polyline points={pointsAttr(closed(edge))} fill="none" stroke={style?.kerb_red||"#ef4444"} strokeWidth="7" strokeDasharray="17 15" strokeLinejoin="round" strokeLinecap="butt"/>
        <polyline points={pointsAttr(closed(edge))} fill="none" stroke="#111827" strokeWidth="1.2" strokeDasharray="17 15" strokeDashoffset="15" opacity=".45"/>
      </g>)}
    </g>

    <g pointerEvents="none" opacity=".9">
      {[leftBarrier,rightBarrier].map((barrier,index)=><g key={"barrier-"+index}>
        <polyline points={pointsAttr(closed(barrier))} fill="none" stroke="#0f172a" strokeWidth="6.5" strokeLinejoin="round"/>
        <polyline points={pointsAttr(closed(barrier))} fill="none" stroke="#9ca3af" strokeWidth="2.8" strokeDasharray="4 6" strokeLinejoin="round"/>
      </g>)}
    </g>

    {Array.isArray(geometry?.pit_lane_points)&&geometry.pit_lane_points.length>1?<g pointerEvents="none">
      <polyline points={pointsAttr(geometry.pit_lane_points)} fill="none" stroke="#020617" strokeWidth={Number(style?.pit_width||16)+8} strokeLinecap="round" strokeLinejoin="round" opacity=".32" transform="translate(2 4)"/>
      <polyline points={pointsAttr(geometry.pit_lane_points)} fill="none" stroke="#d1d5db" strokeWidth={Number(style?.pit_width||16)+5} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={pointsAttr(geometry.pit_lane_points)} fill="none" stroke="#292d31" strokeWidth={Number(style?.pit_width||16)} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={pointsAttr(geometry.pit_lane_points)} fill="none" stroke="#f8fafc" strokeWidth="1.6" strokeDasharray="10 8" opacity=".55"/>
    </g>:null}
  </g>;
}
