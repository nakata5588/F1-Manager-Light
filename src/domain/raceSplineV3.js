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

function catmullRom(p0,p1,p2,p3,t){
  const tt=t*t;
  const ttt=tt*t;
  const x=.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*tt+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*ttt);
  const y=.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*tt+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*ttt);
  return [x,y];
}

export function buildClosedRacingLine(input,{samplesPerSegment=8}={}){
  const points=(Array.isArray(input)?input:[]).map(finitePoint).filter(Boolean);
  if(points.length<3)return {points,total_length:0,cumulative:[0],source_count:points.length,samples_per_segment:0};
  const samples=Math.max(3,Math.min(24,Math.round(Number(samplesPerSegment)||8)));
  const out=[];
  for(let index=0;index<points.length;index+=1){
    const p0=points[(index-1+points.length)%points.length];
    const p1=points[index];
    const p2=points[(index+1)%points.length];
    const p3=points[(index+2)%points.length];
    for(let step=0;step<samples;step+=1){
      const t=step/samples;
      out.push(catmullRom(p0,p1,p2,p3,t));
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
