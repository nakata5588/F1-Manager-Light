import React, { memo, useMemo } from "react";
import {
  deterministicTrackScatter,
  offsetTrackPolyline,
  openPolylineHeadingDegrees,
  sampleOpenPolylinePoint,
  sampleTrackPoint,
  trackHeadingDegrees,
  trackRibbonPolygon,
} from "../../domain/trackSceneGeometry.js";

function pointsAttr(points=[]){
  return (points||[]).map((point)=>point.join(",")).join(" ");
}

function closed(points=[]){
  return points?.length?[...points,points[0]]:[];
}

function offsetFromHeading(point,headingDeg,distance){
  if(!point)return null;
  const angle=(Number(headingDeg)+90)*(Math.PI/180);
  return {
    x:Number(point.x)+Math.cos(angle)*Number(distance||0),
    y:Number(point.y)+Math.sin(angle)*Number(distance||0),
  };
}

function TreeSprite({tree,index=0}){
  const [x,y,r=8,variant=.5]=tree||[];
  const light=Number(variant||0)>.5?"#526d24":"#425f20";
  return <g transform={`translate(${x} ${y})`} pointerEvents="none">
    <ellipse cx="2.5" cy="3.5" rx={r*1.05} ry={r*.72} fill="#17200d" opacity=".28"/>
    <circle cx="0" cy="0" r={r} fill="#2b4d1c"/>
    <circle cx={-r*.22} cy={-r*.2} r={r*.66} fill={light}/>
    {index%4===0?<circle cx={r*.28} cy={r*.08} r={r*.42} fill="#607b2b" opacity=".8"/>:null}
  </g>;
}

function Grandstand({point,heading=0,length=78,depth=18,index=0}){
  if(!point)return null;
  return <g transform={`translate(${point.x} ${point.y}) rotate(${heading})`} pointerEvents="none">
    <rect x={-length/2+4} y={-depth/2+5} width={length} height={depth} rx="1.5" fill="#111827" opacity=".28"/>
    <rect x={-length/2} y={-depth/2} width={length} height={depth} rx="1.5" fill="#4b5563" stroke="#1f2937" strokeWidth="1.2"/>
    {Array.from({length:5},(_,row)=><line
      key={row}
      x1={-length/2+3}
      y1={-depth/2+3+row*((depth-6)/4)}
      x2={length/2-3}
      y2={-depth/2+3+row*((depth-6)/4)}
      stroke={row%2?"#cbd5e1":"#6b7280"}
      strokeWidth="1.1"
      opacity=".8"
    />)}
    {Array.from({length:Math.max(5,Math.floor(length/12))},(_,seat)=><circle
      key={seat}
      cx={-length/2+7+seat*((length-14)/Math.max(1,Math.floor(length/12)-1))}
      cy={(seat+index)%2?2:-2}
      r="1.2"
      fill={(seat+index)%3===0?"#eab308":(seat+index)%3===1?"#dc2626":"#e5e7eb"}
      opacity=".8"
    />)}
  </g>;
}

function PitComplex({geometry,environment}){
  const pit=geometry?.pit_lane_points;
  if(!environment?.pit_complex||!Array.isArray(pit)||pit.length<2)return null;
  const middle=sampleOpenPolylinePoint(pit,.52);
  const heading=openPolylineHeadingDegrees(pit,.52);
  const buildingCenter=offsetFromHeading(middle,heading,Number(environment?.pit_building_side||1)*Number(environment?.pit_building_offset||34));
  if(!buildingCenter)return null;
  const length=Number(environment?.pit_building_length||220);
  const depth=Number(environment?.pit_building_depth||28);
  return <g transform={`translate(${buildingCenter.x} ${buildingCenter.y}) rotate(${heading})`} pointerEvents="none">
    <rect x={-length/2+5} y={-depth/2+6} width={length} height={depth} fill="#111827" opacity=".28"/>
    <rect x={-length/2} y={-depth/2} width={length} height={depth} fill="#b8bcc0" stroke="#555b61" strokeWidth="1.4"/>
    <rect x={-length/2+4} y={-depth/2+4} width={length-8} height={depth*.34} fill="#d8dbde"/>
    {Array.from({length:12},(_,garage)=>{
      const bay=length/12;
      const x=-length/2+garage*bay;
      return <g key={garage}>
        <line x1={x} y1={-depth/2+depth*.34} x2={x} y2={depth/2} stroke="#747b82" strokeWidth=".8"/>
        <rect x={x+2.2} y={depth*.02} width={Math.max(2,bay-4.4)} height={depth*.36} fill={garage%2?"#30353a":"#3b4146"} opacity=".85"/>
      </g>;
    })}
    <line x1={-length/2} y1={-depth/2+depth*.34} x2={length/2} y2={-depth/2+depth*.34} stroke="#8f969c" strokeWidth="1"/>
  </g>;
}

function GridMarkings({geometry}){
  const entries=[];
  for(let index=0;index<12;index+=1){
    const progress=.005+index*.0042;
    const point=sampleTrackPoint(geometry,progress);
    const heading=trackHeadingDegrees(geometry,progress);
    if(!point)continue;
    entries.push(<g key={index} transform={`translate(${point.x} ${point.y}) rotate(${heading})`} pointerEvents="none" opacity=".7">
      <path d="M -4 -5 L 3 -5 L 3 -1 M -4 5 L 3 5 L 3 1" fill="none" stroke="#e5e7eb" strokeWidth=".9"/>
    </g>);
  }
  return <g>{entries}</g>;
}

function TrackSceneRenderer({
  geometry,
  environment,
  style={},
  viewBox=[0,0,1000,1000],
  wetness=0,
}){
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  const roadWidth=Math.max(14,Number(style?.road_width||20));
  const halfWidth=roadWidth/2;
  const shoulder=useMemo(()=>trackRibbonPolygon(points,halfWidth+2.7),[points,halfWidth]);
  const ribbon=useMemo(()=>trackRibbonPolygon(points,halfWidth),[points,halfWidth]);
  const leftKerb=useMemo(()=>offsetTrackPolyline(points,halfWidth+1.25),[points,halfWidth]);
  const rightKerb=useMemo(()=>offsetTrackPolyline(points,-halfWidth-1.25),[points,halfWidth]);
  const leftBarrier=useMemo(()=>offsetTrackPolyline(points,halfWidth+10),[points,halfWidth]);
  const rightBarrier=useMemo(()=>offsetTrackPolyline(points,-halfWidth-10),[points,halfWidth]);
  const [vx,vy,vw,vh]=Array.isArray(viewBox)&&viewBox.length===4?viewBox.map(Number):[0,0,1000,1000];

  const treeCount=Math.max(0,Math.min(140,Number(environment?.tree_count??64)));
  const treeRadius=Array.isArray(environment?.tree_radius)?environment.tree_radius:[5,11];
  const scatteredTrees=useMemo(()=>deterministicTrackScatter({
    bounds:[vx,vy,vw,vh],
    geometry,
    count:treeCount,
    seed:`${geometry?.package_id||"f1track"}:${environment?.theme||"world"}:trees`,
    minTrackDistance:Number(environment?.tree_min_track_distance||44),
    radius:treeRadius,
    exclude:[],
  }),[vx,vy,vw,vh,geometry,treeCount,environment?.theme,environment?.tree_min_track_distance,treeRadius?.[0],treeRadius?.[1]]);

  const grandstands=useMemo(()=>{
    if(!environment?.auto_grandstands)return [];
    const progress=Array.isArray(environment?.grandstand_progress)?environment.grandstand_progress:[.08,.35,.62,.84];
    const sides=Array.isArray(environment?.grandstand_side)?environment.grandstand_side:[1,-1,1,-1];
    return progress.map((value,index)=>{
      const point=sampleTrackPoint(geometry,Number(value));
      const heading=trackHeadingDegrees(geometry,Number(value));
      const shifted=offsetFromHeading(point,heading,Number(sides[index%sides.length]||1)*Number(environment?.grandstand_offset||52));
      return {point:shifted,heading,length:Number(environment?.grandstand_length||76),depth:Number(environment?.grandstand_depth||18),index};
    }).filter((row)=>row.point);
  },[geometry,environment]);

  const wet=Math.max(0,Math.min(1,Number(wetness)||0));
  const landmarks=environment?.render_landmarks!==false;

  return <g aria-hidden="true">
    <defs>
      <linearGradient id="f1track-ground" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#919c1a"/>
        <stop offset="48%" stopColor={environment?.base||style?.grass||"#879317"}/>
        <stop offset="100%" stopColor="#737f12"/>
      </linearGradient>
      <pattern id="f1track-ground-mottle" width="52" height="44" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="12" r="8" fill="#66750f" opacity=".11"/>
        <circle cx="38" cy="28" r="11" fill="#a3ab2f" opacity=".09"/>
      </pattern>
      <linearGradient id="f1track-asphalt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={style?.asphalt_highlight||"#45474b"}/>
        <stop offset="55%" stopColor={style?.asphalt||"#313236"}/>
        <stop offset="100%" stopColor="#27282b"/>
      </linearGradient>
      <pattern id="f1track-asphalt-grain" width="19" height="17" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="6" r=".7" fill="#fff" opacity=".08"/>
        <circle cx="14" cy="12" r=".55" fill="#000" opacity=".13"/>
      </pattern>
    </defs>

    <rect x={vx} y={vy} width={vw} height={vh} fill="url(#f1track-ground)"/>
    <rect x={vx} y={vy} width={vw} height={vh} fill="url(#f1track-ground-mottle)"/>

    {landmarks?(environment?.roads||[]).map((road,index)=><g key={"road-"+index} pointerEvents="none">
      <polyline points={pointsAttr(road.points)} fill="none" stroke="#4d5052" strokeWidth={Number(road.width||12)} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={pointsAttr(road.points)} fill="none" stroke="#8b8f91" strokeWidth="1" strokeDasharray="8 10" opacity=".45"/>
    </g>):null}
    {landmarks&&Array.isArray(environment?.lake)&&environment.lake.length>2?<polygon points={pointsAttr(environment.lake)} fill="#1d6676" stroke="#315863" strokeWidth="3" opacity=".9"/>:null}
    {landmarks?(environment?.sand||[]).map((zone,index)=><polygon key={"sand-"+index} points={pointsAttr(zone)} fill="#b8a461" stroke="#9f8b4f" strokeWidth="2"/>):null}
    {landmarks?(environment?.runoffs||[]).map((zone,index)=><polygon key={"runoff-"+index} points={pointsAttr(zone)} fill="#64925d" stroke="#7ca176" strokeWidth="1.5"/>):null}

    {scatteredTrees.map((tree,index)=><TreeSprite key={index} tree={tree} index={index}/>)}
    {grandstands.map((row)=><Grandstand key={row.index} {...row}/>)}
    <PitComplex geometry={geometry} environment={environment}/>

    {ribbon.length>2?<g pointerEvents="none">
      <polygon points={pointsAttr(trackRibbonPolygon(points,halfWidth+6.5))} fill="#394821" opacity=".55"/>
      <polygon points={pointsAttr(shoulder)} fill="#9ca3a8"/>
      <polygon points={pointsAttr(ribbon)} fill="url(#f1track-asphalt)"/>
      <polygon points={pointsAttr(ribbon)} fill="url(#f1track-asphalt-grain)" opacity=".8"/>
      {wet>0?<polygon points={pointsAttr(ribbon)} fill="#8fd5e3" opacity={wet*.08}/>:null}
      <polyline points={pointsAttr(closed(points))} fill="none" stroke="#e5e7eb" strokeWidth=".55" strokeDasharray="2 14" opacity=".12"/>
    </g>:null}

    <g pointerEvents="none">
      {[leftKerb,rightKerb].map((edge,index)=><g key={index}>
        <polyline points={pointsAttr(closed(edge))} fill="none" stroke="#f3f4f6" strokeWidth="4.2" strokeLinejoin="round"/>
        <polyline points={pointsAttr(closed(edge))} fill="none" stroke={style?.kerb_red||"#c72b30"} strokeWidth="3.7" strokeDasharray="9 9" strokeLinejoin="round"/>
      </g>)}
    </g>

    <g pointerEvents="none" opacity=".72">
      {[leftBarrier,rightBarrier].map((barrier,index)=><g key={index}>
        <polyline points={pointsAttr(closed(barrier))} fill="none" stroke="#374151" strokeWidth="2.6" strokeLinejoin="round"/>
        <polyline points={pointsAttr(closed(barrier))} fill="none" stroke="#d1d5db" strokeWidth=".8" strokeDasharray="5 5" strokeLinejoin="round"/>
      </g>)}
    </g>

    {Array.isArray(geometry?.pit_lane_points)&&geometry.pit_lane_points.length>1?<g pointerEvents="none">
      <polyline points={pointsAttr(geometry.pit_lane_points)} fill="none" stroke="#9ca3a8" strokeWidth={Number(style?.pit_width||12)+3.5} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={pointsAttr(geometry.pit_lane_points)} fill="none" stroke="#35373a" strokeWidth={Number(style?.pit_width||12)} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={pointsAttr(geometry.pit_lane_points)} fill="none" stroke="#e5e7eb" strokeWidth=".8" strokeDasharray="7 6" opacity=".7"/>
    </g>:null}

    <GridMarkings geometry={geometry}/>
  </g>;
}

export default memo(TrackSceneRenderer);
