import { TRACK_LAYOUT_ASSETS } from "../data/trackLayoutAssets.js";
import { TRACK_LAYOUT_GEOMETRY } from "../data/trackLayoutGeometry.js";

function scalar(value){
  if(value&&typeof value==="object"&&Object.hasOwn(value,"result"))return value.result;
  return value;
}

function finiteYear(value){
  const raw=scalar(value);
  if(raw===null||raw===undefined||raw==="")return null;
  const n=Number(raw);
  return Number.isFinite(n)?n:null;
}

function statusRank(layout){
  return String(layout?.historical_status||"").toLowerCase()==="verified"?0:1;
}

function sourceYear(layout){
  return finiteYear(layout?.reference_year)
    ??finiteYear(layout?.year_to)
    ??finiteYear(layout?.year_from);
}

function exactCandidateScore(layout,year){
  const from=finiteYear(layout?.year_from);
  const to=finiteYear(layout?.year_to);
  const width=from!==null&&to!==null?Math.max(0,to-from):Number.MAX_SAFE_INTEGER;
  const ref=sourceYear(layout);
  const distance=ref===null?Number.MAX_SAFE_INTEGER:Math.abs(ref-year);
  return [statusRank(layout),width,distance,String(layout?.layout_id||"")];
}

function compareTuple(a,b){
  for(let i=0;i<Math.max(a.length,b.length);i+=1){
    if(a[i]===b[i])continue;
    if(typeof a[i]==="string"||typeof b[i]==="string")return String(a[i]).localeCompare(String(b[i]));
    return Number(a[i])-Number(b[i]);
  }
  return 0;
}

export function resolveTrackLayout({trackId,year,layouts=TRACK_LAYOUT_ASSETS}={}){
  const id=String(scalar(trackId)??"");
  const requestedYear=finiteYear(year);
  const candidates=(Array.isArray(layouts)?layouts:[]).filter((layout)=>String(scalar(layout?.track_id)??"")===id);
  if(!id||!candidates.length){
    return {layout:null,geometry:null,resolution:"none",requested_year:requestedYear,source_year:null,exact:false,fallback:false};
  }

  if(requestedYear!==null){
    const exact=candidates.filter((layout)=>{
      const from=finiteYear(layout?.year_from);
      const to=finiteYear(layout?.year_to);
      return from!==null&&to!==null&&requestedYear>=from&&requestedYear<=to;
    }).sort((a,b)=>compareTuple(exactCandidateScore(a,requestedYear),exactCandidateScore(b,requestedYear)));
    if(exact.length)return resolved(exact[0],"exact",requestedYear);

    const past=candidates.filter((layout)=>{
      const ref=sourceYear(layout);
      return ref!==null&&ref<=requestedYear;
    }).sort((a,b)=>{
      const ay=sourceYear(a)??-Infinity,by=sourceYear(b)??-Infinity;
      return by-ay||statusRank(a)-statusRank(b)||String(a.layout_id||"").localeCompare(String(b.layout_id||""));
    });
    if(past.length)return resolved(past[0],"past_fallback",requestedYear);

    const future=candidates.filter((layout)=>{
      const ref=sourceYear(layout);
      return ref!==null&&ref>requestedYear;
    }).sort((a,b)=>{
      const ay=sourceYear(a)??Infinity,by=sourceYear(b)??Infinity;
      return ay-by||statusRank(a)-statusRank(b)||String(a.layout_id||"").localeCompare(String(b.layout_id||""));
    });
    if(future.length)return resolved(future[0],"future_fallback",requestedYear);
  }

  const generic=candidates.filter((layout)=>sourceYear(layout)===null)
    .sort((a,b)=>statusRank(a)-statusRank(b)||String(a.layout_id||"").localeCompare(String(b.layout_id||"")));
  if(generic.length)return resolved(generic[0],"generic_fallback",requestedYear);

  const nearest=candidates.slice().sort((a,b)=>{
    const ay=sourceYear(a)??Infinity,by=sourceYear(b)??Infinity;
    if(requestedYear===null)return statusRank(a)-statusRank(b)||ay-by;
    return Math.abs(ay-requestedYear)-Math.abs(by-requestedYear)||statusRank(a)-statusRank(b);
  });
  return resolved(nearest[0],"nearest_fallback",requestedYear);
}

function resolved(layout,resolution,requestedYear){
  const geometry=TRACK_LAYOUT_GEOMETRY[String(layout?.layout_id||"")]||null;
  return {
    layout,
    geometry,
    resolution,
    requested_year:requestedYear,
    source_year:sourceYear(layout),
    exact:resolution==="exact",
    fallback:resolution!=="exact",
  };
}

export function trackLayoutResolutionLabel(resolution){
  return {
    exact:"Historical layout",
    past_fallback:"Earlier available layout",
    future_fallback:"Later available layout",
    generic_fallback:"Provisional layout",
    nearest_fallback:"Nearest available layout",
    none:"No layout asset",
  }[String(resolution||"")]||"Layout";
}

const trackArcCache=new WeakMap();

function trackArcMetrics(geometry){
  if(!geometry||typeof geometry!=="object")return null;
  const cached=trackArcCache.get(geometry);
  if(cached)return cached;
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  if(!points.length)return null;
  const segments=[];
  let total=0;
  for(let index=0;index<points.length;index++){
    const a=points[index];
    const b=points[(index+1)%points.length];
    const ax=Number(a?.[0]||0),ay=Number(a?.[1]||0);
    const bx=Number(b?.[0]||0),by=Number(b?.[1]||0);
    const length=Math.hypot(bx-ax,by-ay);
    segments.push({index,start:total,length,ax,ay,bx,by});
    total+=length;
  }
  const metrics={segments,total};
  trackArcCache.set(geometry,metrics);
  return metrics;
}

export function pointAtTrackProgress(geometry,progress){
  const metrics=trackArcMetrics(geometry);
  if(!metrics||!metrics.segments.length||metrics.total<=0)return null;
  const raw=Number(progress);
  const wrapped=((Number.isFinite(raw)?raw:0)%1+1)%1;
  const target=wrapped*metrics.total;
  let segment=metrics.segments.at(-1);
  for(const candidate of metrics.segments){
    if(target<=candidate.start+candidate.length){
      segment=candidate;
      break;
    }
  }
  const local=segment.length>0?Math.max(0,Math.min(1,(target-segment.start)/segment.length)):0;
  return {
    x:segment.ax+(segment.bx-segment.ax)*local,
    y:segment.ay+(segment.by-segment.ay)*local,
  };
}

export function visualTrackProgress(row,{currentLap=0,currentSector=0,referenceLapMs=90000,index=0}={}){
  const lap=Math.max(0,Number(currentLap)||0);
  const sector=Math.max(0,Math.min(3,Number(currentSector)||0));
  if(lap<=0||sector<=0){
    const grid=Math.max(1,Number(row?.grid_position??index+1)||index+1);
    return ((0.995-(grid-1)*0.003)%1+1)%1;
  }
  const rowSector=row?.retired?Math.max(1,Math.min(3,Number(row?.incident_sector)||sector)):sector;
  const base=rowSector/3;
  const lapMs=Math.max(45000,Number(row?.last_lap_ms)||Number(row?.best_lap_ms)||Number(referenceLapMs)||90000);
  const gap=Math.max(0,Number(row?.gap_to_leader_ms)||0);
  const behind=Math.min(0.94,gap/lapMs);
  const stagger=(Number(index)||0)*0.00035;
  return ((base-behind-stagger)%1+1)%1;
}


export function trackGeometryViewBox(geometry,{paddingRatio=0.055,minPadding=24}={}){
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  const valid=points.filter((point)=>Array.isArray(point)&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1])));
  if(!valid.length)return [0,0,1000,1000];

  const xs=valid.map((point)=>Number(point[0]));
  const ys=valid.map((point)=>Number(point[1]));
  const minX=Math.min(...xs),maxX=Math.max(...xs);
  const minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=Math.max(1,maxX-minX);
  const height=Math.max(1,maxY-minY);
  const basis=Math.max(width,height);
  const padding=Math.max(Number(minPadding)||0,basis*Math.max(0,Number(paddingRatio)||0));

  return [
    Number((minX-padding).toFixed(2)),
    Number((minY-padding).toFixed(2)),
    Number((width+padding*2).toFixed(2)),
    Number((height+padding*2).toFixed(2)),
  ];
}


export function orientTrackGeometry(geometry,{landscape=true,threshold=1.12}={}){
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  const valid=points.filter((point)=>Array.isArray(point)&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1])));
  if(valid.length<2)return geometry||null;

  const xs=valid.map((point)=>Number(point[0]));
  const ys=valid.map((point)=>Number(point[1]));
  const minX=Math.min(...xs),maxX=Math.max(...xs);
  const minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=Math.max(1,maxX-minX);
  const height=Math.max(1,maxY-minY);
  const shouldRotate=Boolean(landscape)&&height>width*Math.max(1,Number(threshold)||1);
  if(!shouldRotate)return {...geometry,display_rotation_deg:0};

  const cx=(minX+maxX)/2;
  const cy=(minY+maxY)/2;
  const rotatePoint=(point)=>{
    const x=Number(point?.[0]||0);
    const y=Number(point?.[1]||0);
    return [
      Number((cx-(y-cy)).toFixed(3)),
      Number((cy+(x-cx)).toFixed(3)),
    ];
  };
  const rotated=points.map(rotatePoint);
  const pitLanePoints=Array.isArray(geometry?.pit_lane_points)
    ?geometry.pit_lane_points.map(rotatePoint)
    :geometry?.pit_lane_points;
  return {...geometry,points:rotated,pit_lane_points:pitLanePoints,display_rotation_deg:90};
}

export function focusTrackViewBox(fullViewBox,point,{zoom=2.35,minWidth=190,minHeight=150}={}){
  const box=Array.isArray(fullViewBox)&&fullViewBox.length===4?fullViewBox.map(Number):[0,0,1000,1000];
  const [x,y,width,height]=box;
  if(!point||!Number.isFinite(Number(point.x))||!Number.isFinite(Number(point.y))||width<=0||height<=0)return box;

  const z=Math.max(1,Number(zoom)||1);
  let targetWidth=Math.max(Number(minWidth)||0,width/z);
  let targetHeight=Math.max(Number(minHeight)||0,height/z);
  targetWidth=Math.min(width,targetWidth);
  targetHeight=Math.min(height,targetHeight);

  const maxX=x+width-targetWidth;
  const maxY=y+height-targetHeight;
  const targetX=Math.min(Math.max(x,Number(point.x)-targetWidth/2),maxX);
  const targetY=Math.min(Math.max(y,Number(point.y)-targetHeight/2),maxY);

  return [
    Number(targetX.toFixed(2)),
    Number(targetY.toFixed(2)),
    Number(targetWidth.toFixed(2)),
    Number(targetHeight.toFixed(2)),
  ];
}


export function trackMarkerSegment(geometry,progress,{length=34,sampleDelta=0.006}={}){
  const center=pointAtTrackProgress(geometry,progress);
  const before=pointAtTrackProgress(geometry,(Number(progress)||0)-Math.max(0.0005,Number(sampleDelta)||0.006));
  const after=pointAtTrackProgress(geometry,(Number(progress)||0)+Math.max(0.0005,Number(sampleDelta)||0.006));
  if(!center||!before||!after)return null;

  const dx=Number(after.x)-Number(before.x);
  const dy=Number(after.y)-Number(before.y);
  const mag=Math.hypot(dx,dy)||1;
  const nx=-dy/mag;
  const ny=dx/mag;
  const half=Math.max(4,Number(length)||34)/2;
  return {
    center,
    x1:Number((center.x+nx*half).toFixed(3)),
    y1:Number((center.y+ny*half).toFixed(3)),
    x2:Number((center.x-nx*half).toFixed(3)),
    y2:Number((center.y-ny*half).toFixed(3)),
  };
}

export function raceEventTrackProgress(event,profile=null){
  const explicit=Number(event?.track_progress);
  if(Number.isFinite(explicit))return ((explicit%1)+1)%1;
  const rawSector=Number(event?.sector)||Number(event?.incident_sector)||0;
  if(!Number.isFinite(rawSector)||rawSector<1)return null;
  const sector=Math.max(1,Math.min(3,rawSector));
  const localOffset=Number.isFinite(Number(event?.sector_progress))
    ?Math.max(0,Math.min(1,Number(event.sector_progress)))
    :0.5;

  const intelligence=profile||trackIntelligenceProfile(null);
  const start=Number(intelligence?.start_finish_progress)||0;
  const boundaryValues=Array.isArray(intelligence?.sector_boundaries)&&intelligence.sector_boundaries.length===2
    ?intelligence.sector_boundaries.map(Number)
    :[1/3,2/3];
  const unwrap=(value,minimum)=>{
    let next=Number(value);
    while(next<=minimum)next+=1;
    return next;
  };
  const first=unwrap(boundaryValues[0],start);
  const second=unwrap(boundaryValues[1],first);
  const end=start+1;
  const ranges=[[start,first],[first,second],[second,end]];
  const [from,to]=ranges[sector-1];
  const progress=from+(to-from)*localOffset;
  return ((progress%1)+1)%1;
}


export function trackIntelligenceProfile(layout){
  const normalize=(value,fallback)=>{
    const number=Number(value);
    if(!Number.isFinite(number))return fallback;
    return ((number%1)+1)%1;
  };
  const startFinish=normalize(layout?.start_finish_progress,0);
  let boundaries=Array.isArray(layout?.sector_boundaries)
    ?layout.sector_boundaries.slice(0,2).map((value)=>normalize(value,null)).filter((value)=>value!=null)
    :[];
  if(boundaries.length!==2)boundaries=[1/3,2/3];
  return {
    start_finish_progress:startFinish,
    sector_boundaries:boundaries,
    pit_entry_progress:Number.isFinite(Number(layout?.pit_entry_progress))?normalize(layout.pit_entry_progress,null):null,
    pit_exit_progress:Number.isFinite(Number(layout?.pit_exit_progress))?normalize(layout.pit_exit_progress,null):null,
    status:String(layout?.track_intelligence_status||"derived_provisional"),
  };
}


export function trackSectorPolylinePoints(geometry,sector,profile=null,{samples=36}={}){
  const intelligence=profile||trackIntelligenceProfile(null);
  const start=Number(intelligence?.start_finish_progress)||0;
  const boundaries=Array.isArray(intelligence?.sector_boundaries)&&intelligence.sector_boundaries.length===2
    ?intelligence.sector_boundaries.map(Number)
    :[1/3,2/3];
  const unwrap=(value,minimum)=>{
    let next=Number(value);
    while(next<=minimum)next+=1;
    return next;
  };
  const first=unwrap(boundaries[0],start);
  const second=unwrap(boundaries[1],first);
  const ranges=[[start,first],[first,second],[second,start+1]];
  const index=Math.max(0,Math.min(2,(Number(sector)||1)-1));
  const [from,to]=ranges[index];
  const count=Math.max(4,Math.round(Number(samples)||36));
  return Array.from({length:count+1},(_,sampleIndex)=>{
    const ratio=sampleIndex/count;
    const progress=from+(to-from)*ratio;
    const point=pointAtTrackProgress(geometry,progress);
    return point?[point.x,point.y]:null;
  }).filter(Boolean);
}
