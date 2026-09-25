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

export function pointAtTrackProgress(geometry,progress){
  const points=Array.isArray(geometry?.points)?geometry.points:[];
  if(!points.length)return null;
  const raw=Number(progress);
  const wrapped=((Number.isFinite(raw)?raw:0)%1+1)%1;
  const scaled=wrapped*points.length;
  const index=Math.floor(scaled)%points.length;
  const next=(index+1)%points.length;
  const t=scaled-Math.floor(scaled);
  const a=points[index],b=points[next];
  return {
    x:Number(a?.[0]||0)+(Number(b?.[0]||0)-Number(a?.[0]||0))*t,
    y:Number(a?.[1]||0)+(Number(b?.[1]||0)-Number(a?.[1]||0))*t,
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
  const rotated=points.map((point)=>{
    const x=Number(point?.[0]||0);
    const y=Number(point?.[1]||0);
    return [
      Number((cx-(y-cy)).toFixed(3)),
      Number((cy+(x-cx)).toFixed(3)),
    ];
  });
  return {...geometry,points:rotated,display_rotation_deg:90};
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
