function finitePoint(point){
  return Array.isArray(point)
    &&Number.isFinite(Number(point[0]))
    &&Number.isFinite(Number(point[1]))
    ?[Number(point[0]),Number(point[1])]
    :null;
}

function wrap01(value){
  const number=Number(value)||0;
  return ((number%1)+1)%1;
}
function pointKey(point){
  return `${Number(point?.[0]||0).toFixed(6)}:${Number(point?.[1]||0).toFixed(6)}`;
}

function angleDeltaDegrees(a,b){
  return Math.abs((((Number(a)-Number(b))+540)%360)-180);
}

function pointSegmentDistance(point,a,b){
  const dx=b[0]-a[0];
  const dy=b[1]-a[1];
  const lengthSq=dx*dx+dy*dy;
  if(lengthSq<=1e-12)return Math.hypot(point[0]-a[0],point[1]-a[1]);
  const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/lengthSq));
  const px=a[0]+dx*t;
  const py=a[1]+dy*t;
  return Math.hypot(point[0]-px,point[1]-py);
}

function forwardSourcePath(sourcePoints,startPoint,endPoint){
  const source=(Array.isArray(sourcePoints)?sourcePoints:[]).map(finitePoint).filter(Boolean);
  if(source.length<2)return [];
  const startKey=pointKey(startPoint);
  const endKey=pointKey(endPoint);
  const startIndex=source.findIndex((point)=>pointKey(point)===startKey);
  const endIndex=source.findIndex((point)=>pointKey(point)===endKey);
  if(startIndex<0||endIndex<0)return [];
  const out=[source[startIndex]];
  let index=startIndex;
  let guard=0;
  while(index!==endIndex&&guard<=source.length){
    index=(index+1)%source.length;
    out.push(source[index]);
    guard+=1;
  }
  return index===endIndex?out:[];
}

function sourcePathIsStraight(sourcePath,{
  angleToleranceDeg=5,
  deviationRatio=.008,
  maxDeviation=1.15,
  minSamples=4,
  minLength=45,
}={}){
  const points=(Array.isArray(sourcePath)?sourcePath:[]).map(finitePoint).filter(Boolean);
  if(points.length<Math.max(3,Number(minSamples)||4))return false;
  const first=points[0];
  const last=points.at(-1);
  const chordDx=last[0]-first[0];
  const chordDy=last[1]-first[1];
  const chordLength=Math.hypot(chordDx,chordDy);
  if(chordLength<Math.max(1,Number(minLength)||45))return false;
  const chordHeading=Math.atan2(chordDy,chordDx)*(180/Math.PI);
  const allowedDeviation=Math.min(
    Math.max(0.2,Number(maxDeviation)||1.15),
    Math.max(0.2,chordLength*Math.max(0,Number(deviationRatio)||.008))
  );
  for(let index=0;index<points.length-1;index+=1){
    const a=points[index];
    const b=points[index+1];
    const dx=b[0]-a[0];
    const dy=b[1]-a[1];
    if(Math.hypot(dx,dy)<=1e-9)continue;
    const heading=Math.atan2(dy,dx)*(180/Math.PI);
    if(angleDeltaDegrees(heading,chordHeading)>Math.max(1,Number(angleToleranceDeg)||5)){
      return false;
    }
  }
  return points.every((point)=>pointSegmentDistance(point,first,last)<=allowedDeviation);
}

function catmullRom(p0,p1,p2,p3,t){
  const tt=t*t;
  const ttt=tt*t;
  const x=.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*tt+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*ttt);
  const y=.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*tt+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*ttt);
  return [x,y];
}

function centripetalInterval(a,b){
  return Math.max(1e-6,Math.sqrt(Math.hypot(b[0]-a[0],b[1]-a[1])));
}

function interpolateParametric(a,b,ta,tb,t){
  const span=Math.max(1e-9,tb-ta);
  const left=(tb-t)/span;
  const right=(t-ta)/span;
  return [
    a[0]*left+b[0]*right,
    a[1]*left+b[1]*right,
  ];
}

function catmullRomCentripetal(p0,p1,p2,p3,u){
  const t0=0;
  const t1=t0+centripetalInterval(p0,p1);
  const t2=t1+centripetalInterval(p1,p2);
  const t3=t2+centripetalInterval(p2,p3);
  if(t2-t1<=1e-9){
    return [
      p1[0]+(p2[0]-p1[0])*u,
      p1[1]+(p2[1]-p1[1])*u,
    ];
  }
  const t=t1+(t2-t1)*Math.max(0,Math.min(1,Number(u)||0));
  const a1=interpolateParametric(p0,p1,t0,t1,t);
  const a2=interpolateParametric(p1,p2,t1,t2,t);
  const a3=interpolateParametric(p2,p3,t2,t3,t);
  const b1=interpolateParametric(a1,a2,t0,t2,t);
  const b2=interpolateParametric(a2,a3,t1,t3,t);
  return interpolateParametric(b1,b2,t1,t2,t);
}

export function buildClosedRacingLine(input,{
  samplesPerSegment=8,
  parameterization="uniform",
  preserveStraights=false,
  straightSourcePoints=null,
  straightAngleToleranceDeg=5,
  straightDeviationRatio=.008,
  straightMaxDeviation=1.15,
  straightMinSamples=4,
  straightMinLength=45,
}={}){
  const points=(Array.isArray(input)?input:[]).map(finitePoint).filter(Boolean);
  if(points.length<3)return {points,total_length:0,cumulative:[0],source_count:points.length,samples_per_segment:0};
  const samples=Math.max(3,Math.min(24,Math.round(Number(samplesPerSegment)||8)));
  const out=[];
  let straightSegmentCount=0;
  for(let index=0;index<points.length;index+=1){
    const p0=points[(index-1+points.length)%points.length];
    const p1=points[index];
    const p2=points[(index+1)%points.length];
    const p3=points[(index+2)%points.length];
    const sourcePath=preserveStraights
      ?forwardSourcePath(straightSourcePoints,p1,p2)
      :[];
    const preserveSegment=preserveStraights&&sourcePathIsStraight(sourcePath,{
      angleToleranceDeg:straightAngleToleranceDeg,
      deviationRatio:straightDeviationRatio,
      maxDeviation:straightMaxDeviation,
      minSamples:straightMinSamples,
      minLength:straightMinLength,
    });
    if(preserveSegment)straightSegmentCount+=1;
    for(let step=0;step<samples;step+=1){
      const t=step/samples;
      out.push(
        preserveSegment
          ?[
            p1[0]+(p2[0]-p1[0])*t,
            p1[1]+(p2[1]-p1[1])*t,
          ]
          :String(parameterization).toLowerCase()==="centripetal"
            ?catmullRomCentripetal(p0,p1,p2,p3,t)
            :catmullRom(p0,p1,p2,p3,t)
      );
    }
  }

  const cumulative=[0];
  let total=0;
  for(let index=0;index<out.length;index+=1){
    const current=out[index];
    const next=out[(index+1)%out.length];
    total+=Math.hypot(next[0]-current[0],next[1]-current[1]);
    cumulative.push(total);
  }
  return {
    points:out,
    total_length:total,
    cumulative,
    source_count:points.length,
    samples_per_segment:samples,
    parameterization:String(parameterization).toLowerCase()==="centripetal"?"centripetal":"uniform",
    straight_segment_count:straightSegmentCount,
    straight_preservation:Boolean(preserveStraights),
  };
}

function segmentIndexAtDistance(line,distance){
  const cumulative=line?.cumulative||[];
  const count=Math.max(0,(line?.points||[]).length);
  if(count<2||cumulative.length!==count+1)return 0;
  let low=0;
  let high=count-1;
  while(low<=high){
    const middle=(low+high)>>1;
    if(distance<cumulative[middle]){
      high=middle-1;
    }else if(distance>=cumulative[middle+1]){
      low=middle+1;
    }else{
      return middle;
    }
  }
  return Math.max(0,Math.min(count-1,low));
}

export function racingLinePoseAtDistance(line,distance){
  const points=line?.points||[];
  const total=Number(line?.total_length)||0;
  if(points.length<2||total<=0)return null;
  const normalized=((Number(distance)||0)%total+total)%total;
  const index=segmentIndexAtDistance(line,normalized);
  const nextIndex=(index+1)%points.length;
  const startDistance=line.cumulative[index];
  const endDistance=line.cumulative[index+1];
  const segmentLength=Math.max(1e-9,endDistance-startDistance);
  const t=Math.max(0,Math.min(1,(normalized-startDistance)/segmentLength));
  const a=points[index];
  const b=points[nextIndex];
  const x=a[0]+(b[0]-a[0])*t;
  const y=a[1]+(b[1]-a[1])*t;

  const headingSample=Math.max(2,total*.0016);
  const before=racingLinePointAtDistance(line,normalized-headingSample);
  const after=racingLinePointAtDistance(line,normalized+headingSample);
  const heading=Math.atan2(after.y-before.y,after.x-before.x)*(180/Math.PI);
  return {x,y,heading,distance:normalized,progress:normalized/total};
}

export function racingLinePointAtDistance(line,distance){
  const points=line?.points||[];
  const total=Number(line?.total_length)||0;
  if(points.length<2||total<=0)return null;
  const normalized=((Number(distance)||0)%total+total)%total;
  const index=segmentIndexAtDistance(line,normalized);
  const nextIndex=(index+1)%points.length;
  const startDistance=line.cumulative[index];
  const endDistance=line.cumulative[index+1];
  const segmentLength=Math.max(1e-9,endDistance-startDistance);
  const t=Math.max(0,Math.min(1,(normalized-startDistance)/segmentLength));
  const a=points[index];
  const b=points[nextIndex];
  return {
    x:a[0]+(b[0]-a[0])*t,
    y:a[1]+(b[1]-a[1])*t,
  };
}

export function racingLinePoseAtProgress(line,progress){
  const total=Number(line?.total_length)||0;
  if(total<=0)return null;
  return racingLinePoseAtDistance(line,wrap01(progress)*total);
}

export function racingLineGeometry(sourceGeometry,line){
  if(!sourceGeometry||!line?.points?.length)return sourceGeometry;
  return {
    ...sourceGeometry,
    points:line.points.map((point)=>[Number(point[0]),Number(point[1])]),
    racing_line_v3:true,
    racing_line_total_length:Number(line.total_length)||0,
    racing_line_source_count:Number(line.source_count)||0,
    racing_line_sample_count:line.points.length,
  };
}
