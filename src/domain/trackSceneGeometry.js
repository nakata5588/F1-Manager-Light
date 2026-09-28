function validPoints(input){
  const points=Array.isArray(input?.points)?input.points:input;
  return (Array.isArray(points)?points:[])
    .filter((point)=>Array.isArray(point)&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1])))
    .map((point)=>[Number(point[0]),Number(point[1])]);
}

function unitNormal(ax,ay,bx,by){
  const dx=bx-ax;
  const dy=by-ay;
  const length=Math.hypot(dx,dy)||1;
  return [-dy/length,dx/length];
}

function averagedNormal(points,index,closed=true){
  const n=points.length;
  if(n<2)return [0,1];
  const prevIndex=index===0?(closed?n-1:0):index-1;
  const nextIndex=index===n-1?(closed?0:n-1):index+1;
  const current=points[index];
  const prev=points[prevIndex];
  const next=points[nextIndex];
  const a=unitNormal(prev[0],prev[1],current[0],current[1]);
  const b=unitNormal(current[0],current[1],next[0],next[1]);
  let nx=a[0]+b[0];
  let ny=a[1]+b[1];
  const length=Math.hypot(nx,ny);
  if(length<1e-6)return b;
  nx/=length;
  ny/=length;
  const dot=Math.max(.22,nx*b[0]+ny*b[1]);
  return [nx/dot,ny/dot];
}

export function offsetTrackPolyline(input,offset,{closed=true}={}){
  const points=validPoints(input);
  if(points.length<2)return [];
  return points.map((point,index)=>{
    const [nx,ny]=averagedNormal(points,index,closed);
    return [
      Number((point[0]+nx*Number(offset||0)).toFixed(3)),
      Number((point[1]+ny*Number(offset||0)).toFixed(3)),
    ];
  });
}

export function trackRibbonPolygon(input,halfWidth){
  const points=validPoints(input);
  if(points.length<3)return [];
  const left=offsetTrackPolyline(points,Math.abs(Number(halfWidth)||0));
  const right=offsetTrackPolyline(points,-Math.abs(Number(halfWidth)||0));
  return [...left,...right.reverse()];
}

function arcMetrics(points){
  const segments=[];
  let total=0;
  for(let index=0;index<points.length;index+=1){
    const a=points[index];
    const b=points[(index+1)%points.length];
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    segments.push({a,b,start:total,length});
    total+=length;
  }
  return {segments,total};
}

export function sampleTrackPoint(input,progress){
  const points=validPoints(input);
  if(!points.length)return null;
  if(points.length===1)return {x:points[0][0],y:points[0][1]};
  const metrics=arcMetrics(points);
  if(metrics.total<=0)return {x:points[0][0],y:points[0][1]};
  const wrapped=((Number(progress)||0)%1+1)%1;
  const target=wrapped*metrics.total;
  let segment=metrics.segments.at(-1);
  for(const candidate of metrics.segments){
    if(target<=candidate.start+candidate.length){segment=candidate;break;}
  }
  const local=segment.length>0?(target-segment.start)/segment.length:0;
  return {
    x:segment.a[0]+(segment.b[0]-segment.a[0])*local,
    y:segment.a[1]+(segment.b[1]-segment.a[1])*local,
  };
}

export function trackHeadingDegrees(input,progress){
  const before=sampleTrackPoint(input,Number(progress||0)-0.0025);
  const after=sampleTrackPoint(input,Number(progress||0)+0.0025);
  if(!before||!after)return 0;
  return Math.atan2(after.y-before.y,after.x-before.x)*(180/Math.PI);
}

export function sampleOpenPolylinePoint(points,progress){
  const valid=validPoints(points);
  if(!valid.length)return null;
  if(valid.length===1)return {x:valid[0][0],y:valid[0][1]};
  const segments=[];
  let total=0;
  for(let index=0;index<valid.length-1;index+=1){
    const a=valid[index],b=valid[index+1];
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    segments.push({a,b,start:total,length});
    total+=length;
  }
  if(total<=0)return {x:valid[0][0],y:valid[0][1]};
  const target=Math.max(0,Math.min(1,Number(progress)||0))*total;
  let segment=segments.at(-1);
  for(const candidate of segments){
    if(target<=candidate.start+candidate.length){segment=candidate;break;}
  }
  const local=segment.length>0?(target-segment.start)/segment.length:0;
  return {
    x:segment.a[0]+(segment.b[0]-segment.a[0])*local,
    y:segment.a[1]+(segment.b[1]-segment.a[1])*local,
  };
}

export function openPolylineHeadingDegrees(points,progress){
  const valid=validPoints(points);
  if(valid.length<2)return 0;
  const segments=[];
  let total=0;
  for(let index=0;index<valid.length-1;index+=1){
    const a=valid[index],b=valid[index+1];
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    segments.push({a,b,start:total,length});
    total+=length;
  }
  if(total<=0)return 0;
  const target=Math.max(0,Math.min(1,Number(progress)||0))*total;
  let segment=segments.at(-1);
  for(const candidate of segments){
    if(target<=candidate.start+candidate.length){segment=candidate;break;}
  }
  return Math.atan2(segment.b[1]-segment.a[1],segment.b[0]-segment.a[0])*(180/Math.PI);
}

export function geometryBounds(input,{padding=0}={}){
  const points=validPoints(input);
  if(!points.length)return [0,0,1000,1000];
  const xs=points.map((point)=>point[0]);
  const ys=points.map((point)=>point[1]);
  const minX=Math.min(...xs)-padding;
  const minY=Math.min(...ys)-padding;
  const maxX=Math.max(...xs)+padding;
  const maxY=Math.max(...ys)+padding;
  return [minX,minY,Math.max(1,maxX-minX),Math.max(1,maxY-minY)];
}

function seedNumber(seed){
  let hash=2166136261;
  for(const ch of String(seed||"track")){
    hash^=ch.charCodeAt(0);
    hash=Math.imul(hash,16777619);
  }
  return hash>>>0;
}

function nextRandom(state){
  let x=state.value||1;
  x^=x<<13;
  x^=x>>>17;
  x^=x<<5;
  state.value=x>>>0;
  return state.value/4294967296;
}

function distanceToPolyline(point,points){
  let best=Infinity;
  for(let index=0;index<points.length;index+=1){
    const a=points[index],b=points[(index+1)%points.length];
    const vx=b[0]-a[0],vy=b[1]-a[1];
    const wx=point[0]-a[0],wy=point[1]-a[1];
    const lengthSq=vx*vx+vy*vy;
    const t=lengthSq>0?Math.max(0,Math.min(1,(wx*vx+wy*vy)/lengthSq)):0;
    best=Math.min(best,Math.hypot(point[0]-(a[0]+vx*t),point[1]-(a[1]+vy*t)));
  }
  return best;
}

export function deterministicTrackScatter({
  bounds=[0,0,1000,1000],
  geometry,
  count=80,
  seed="track",
  minTrackDistance=55,
  radius=[7,16],
  exclude=[],
}={}){
  const points=validPoints(geometry);
  const [x,y,w,h]=bounds.map(Number);
  const state={value:seedNumber(seed)||1};
  const output=[];
  const maxAttempts=Math.max(200,Number(count||0)*18);
  for(let attempt=0;attempt<maxAttempts&&output.length<count;attempt+=1){
    const px=x+nextRandom(state)*w;
    const py=y+nextRandom(state)*h;
    if(points.length&&distanceToPolyline([px,py],points)<minTrackDistance)continue;
    let blocked=false;
    for(const zone of exclude||[]){
      if(!Array.isArray(zone)||zone.length<4)continue;
      const [zx,zy,zw,zh]=zone.map(Number);
      if(px>=zx&&px<=zx+zw&&py>=zy&&py<=zy+zh){blocked=true;break;}
    }
    if(blocked)continue;
    const minR=Number(radius?.[0]||7),maxR=Number(radius?.[1]||16);
    output.push([
      Number(px.toFixed(2)),
      Number(py.toFixed(2)),
      Number((minR+nextRandom(state)*(maxR-minR)).toFixed(2)),
      Number(nextRandom(state).toFixed(3)),
    ]);
  }
  return output;
}
