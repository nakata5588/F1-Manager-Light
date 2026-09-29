import React, { memo, useMemo } from "react";
import {
  deterministicTrackScatter,
  openPolylineHeadingDegrees,
  sampleOpenPolylinePoint,
  sampleTrackPoint,
  trackHeadingDegrees,
} from "../../domain/trackSceneGeometry.js";
import { trackLodRank } from "../../domain/trackCamera.js";

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

function Grandstand({point,heading=0,length=78,depth=18,index=0,lod="overview"}){
  if(!point)return null;
  return <g transform={`translate(${point.x} ${point.y}) rotate(${heading})`} pointerEvents="none">
    <rect x={-length/2+4} y={-depth/2+5} width={length} height={depth} rx="1.5" fill="#111827" opacity=".28"/>
    <rect x={-length/2} y={-depth/2} width={length} height={depth} rx="1.5" fill="#4b5563" stroke="#1f2937" strokeWidth="1.2"/>
    {Array.from({length:lod==="overview"?3:5},(_,row)=><line
      key={row}
      x1={-length/2+3}
      y1={-depth/2+3+row*((depth-6)/(lod==="overview"?2:4))}
      x2={length/2-3}
      y2={-depth/2+3+row*((depth-6)/(lod==="overview"?2:4))}
      stroke={row%2?"#cbd5e1":"#6b7280"}
      strokeWidth="1.1"
      opacity=".8"
    />)}
    {lod!=="overview"?Array.from({length:Math.max(5,Math.floor(length/(lod==="close"?9:12)))},(_,seat)=><circle
      key={seat}
      cx={-length/2+7+seat*((length-14)/Math.max(1,Math.floor(length/12)-1))}
      cy={(seat+index)%2?2:-2}
      r="1.2"
      fill={(seat+index)%3===0?"#eab308":(seat+index)%3===1?"#dc2626":"#e5e7eb"}
      opacity=".8"
    />):null}
  </g>;
}

function PitComplex({geometry,environment,lod="overview"}){
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
    {lod!=="overview"?Array.from({length:12},(_,garage)=>{
      const bay=length/12;
      const x=-length/2+garage*bay;
      return <g key={garage}>
        <line x1={x} y1={-depth/2+depth*.34} x2={x} y2={depth/2} stroke="#747b82" strokeWidth=".8"/>
        <rect x={x+2.2} y={depth*.02} width={Math.max(2,bay-4.4)} height={depth*.36} fill={garage%2?"#30353a":"#3b4146"} opacity=".85"/>
      </g>;
    }):null}
    <line x1={-length/2} y1={-depth/2+depth*.34} x2={length/2} y2={-depth/2+depth*.34} stroke="#8f969c" strokeWidth="1"/>
    {lod==="close"?<>
      <rect x={-length/2} y={depth/2+5} width={length} height="2.2" fill="#d1d5db" opacity=".9"/>
      {Array.from({length:12},(_,box)=>{
        const bay=length/12;
        const x=-length/2+box*bay+bay*.5;
        return <path key={box} d={`M ${x-4} ${depth/2+2} H ${x+4} V ${depth/2+8} H ${x-4}`} fill="none" stroke="#f3f4f6" strokeWidth=".8" opacity=".75"/>;
      })}
    </>:null}
  </g>;
}

function TracksideDetails({geometry,lod="overview"}){
  if(lod==="overview")return null;
  const marshalProgress=[.12,.29,.47,.66,.84,.94];
  const tyreProgress=lod==="close"?[.18,.38,.58,.76,.9]:[.38,.76];
  return <g pointerEvents="none">
    {marshalProgress.map((progress,index)=>{
      const point=sampleTrackPoint(geometry,progress);
      const heading=trackHeadingDegrees(geometry,progress);
      const side=index%2?1:-1;
      const shifted=offsetFromHeading(point,heading,side*(lod==="close"?25:22));
      if(!shifted)return null;
      return <g key={"marshal-"+index} transform={`translate(${shifted.x} ${shifted.y}) rotate(${heading})`}>
        <rect x="-3.5" y="-2.8" width="7" height="5.6" rx=".6" fill="#f59e0b" stroke="#4b5563" strokeWidth=".7"/>
        {lod==="close"?<line x1="0" y1="-7" x2="0" y2="-2.8" stroke="#d1d5db" strokeWidth=".7"/>:null}
      </g>;
    })}
    {tyreProgress.map((progress,index)=>{
      const point=sampleTrackPoint(geometry,progress);
      const heading=trackHeadingDegrees(geometry,progress);
      const shifted=offsetFromHeading(point,heading,(index%2?1:-1)*18);
      if(!shifted)return null;
      return <g key={"tyres-"+index} transform={`translate(${shifted.x} ${shifted.y}) rotate(${heading})`} opacity=".9">
        {Array.from({length:lod==="close"?5:3},(_,tyre)=><circle key={tyre} cx={(tyre-(lod==="close"?2:1))*3.2} cy="0" r="2.2" fill="#171717" stroke="#6b7280" strokeWidth=".45"/>)}
      </g>;
    })}
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
  lod="overview",
}){
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  const lodRank=trackLodRank(lod);
  const roadWidth=Math.max(14,Number(style?.road_width||20));
  const kerbWidth=Math.max(roadWidth+4,Number(style?.kerb_width||roadWidth+5));
  const outerWidth=Math.max(kerbWidth+4,Number(style?.outer_shadow_width||roadWidth+11));
  const pitWidth=Math.max(10,Number(style?.pit_width||12));
  const trackPolyline=pointsAttr(closed(points));
  const pitPoints=Array.isArray(geometry?.pit_lane_points)?geometry.pit_lane_points:[];
  const pitPolyline=pointsAttr(pitPoints);
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
  const visibleTreeCount=lodRank===0?Math.ceil(scatteredTrees.length*.5):lodRank===1?Math.ceil(scatteredTrees.length*.78):scatteredTrees.length;
  const visibleTrees=scatteredTrees.slice(0,visibleTreeCount);

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
    {lod!=="overview"?<rect x={vx} y={vy} width={vw} height={vh} fill="url(#f1track-ground-mottle)"/>:null}

    {landmarks?(environment?.roads||[]).map((road,index)=><g key={"road-"+index} pointerEvents="none">
      <polyline points={pointsAttr(road.points)} fill="none" stroke="#4d5052" strokeWidth={Number(road.width||12)} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={pointsAttr(road.points)} fill="none" stroke="#8b8f91" strokeWidth="1" strokeDasharray="8 10" opacity=".45"/>
    </g>):null}
    {landmarks&&Array.isArray(environment?.lake)&&environment.lake.length>2?<polygon points={pointsAttr(environment.lake)} fill="#1d6676" stroke="#315863" strokeWidth="3" opacity=".9"/>:null}
    {landmarks?(environment?.sand||[]).map((zone,index)=><polygon key={"sand-"+index} points={pointsAttr(zone)} fill="#b8a461" stroke="#9f8b4f" strokeWidth="2"/>):null}
    {landmarks?(environment?.runoffs||[]).map((zone,index)=><polygon key={"runoff-"+index} points={pointsAttr(zone)} fill="#64925d" stroke="#7ca176" strokeWidth="1.5"/>):null}

    {visibleTrees.map((tree,index)=><TreeSprite key={index} tree={tree} index={index}/>)}
    {grandstands.map((row)=><Grandstand key={row.index} {...row} lod={lod}/>)}
    <PitComplex geometry={geometry} environment={environment} lod={lod}/>

    {/* Presentation is stroke-based rather than an offset polygon mesh.
        Tight bends can make offset ribbons self-intersect; layered round
        strokes keep the road readable while preserving one centreline. */}
    {pitPoints.length>1?<g pointerEvents="none">
      <polyline points={pitPolyline} fill="none" stroke="#394821" strokeWidth={pitWidth+10} strokeLinecap="round" strokeLinejoin="round" opacity=".58"/>
      <polyline points={pitPolyline} fill="none" stroke="#9ca3a8" strokeWidth={pitWidth+4} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={pitPolyline} fill="none" stroke="#35373a" strokeWidth={pitWidth} strokeLinecap="round" strokeLinejoin="round"/>
      {lod!=="overview"?<polyline points={pitPolyline} fill="none" stroke="#4b4f54" strokeWidth={Math.max(2,pitWidth-4)} strokeLinecap="round" strokeLinejoin="round" opacity=".42"/>:null}
      <polyline points={pitPolyline} fill="none" stroke="#e5e7eb" strokeWidth=".75" strokeDasharray="7 7" opacity={lod==="overview"?.42:.62}/>
    </g>:null}

    {points.length>2?<g pointerEvents="none">
      <polyline points={trackPolyline} fill="none" stroke="#263118" strokeWidth={outerWidth+9} strokeLinecap="round" strokeLinejoin="round" opacity=".72"/>
      <polyline points={trackPolyline} fill="none" stroke="#374151" strokeWidth={outerWidth+4} strokeLinecap="round" strokeLinejoin="round" opacity=".72"/>
      {lod!=="overview"?<polyline points={trackPolyline} fill="none" stroke="#d1d5db" strokeWidth={outerWidth+1.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 7" opacity=".34"/>:null}
      <polyline points={trackPolyline} fill="none" stroke="#9ca3a8" strokeWidth={kerbWidth+2} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={trackPolyline} fill="none" stroke={style?.kerb_white||"#f3f4f6"} strokeWidth={kerbWidth} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={trackPolyline} fill="none" stroke={style?.kerb_red||"#c72b30"} strokeWidth={kerbWidth} strokeLinecap="butt" strokeLinejoin="round" strokeDasharray="9 9"/>
      <polyline points={trackPolyline} fill="none" stroke="url(#f1track-asphalt)" strokeWidth={roadWidth} strokeLinecap="round" strokeLinejoin="round"/>
      {lod!=="overview"?<polyline points={trackPolyline} fill="none" stroke="url(#f1track-asphalt-grain)" strokeWidth={Math.max(4,roadWidth-1)} strokeLinecap="round" strokeLinejoin="round" opacity={lod==="close"?.68:.42}/>:null}
      {wet>0?<polyline points={trackPolyline} fill="none" stroke="#8fd5e3" strokeWidth={roadWidth} strokeLinecap="round" strokeLinejoin="round" opacity={wet*.08}/>:null}
      <polyline points={trackPolyline} fill="none" stroke="#e5e7eb" strokeWidth=".55" strokeDasharray="2 14" opacity=".12"/>
    </g>:null}

    {lod!=="overview"?<GridMarkings geometry={geometry}/>:null}
    <TracksideDetails geometry={geometry} lod={lod}/>
  </g>;
}

export default memo(TrackSceneRenderer);
