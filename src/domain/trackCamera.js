function numericBox(box){
  return Array.isArray(box)&&box.length===4?box.map(Number):[0,0,1000,1000];
}

export function clampTrackViewBox(viewBox,bounds){
  const box=numericBox(viewBox);
  const limit=numericBox(bounds);
  const width=Math.min(Math.max(1,box[2]),limit[2]);
  const height=Math.min(Math.max(1,box[3]),limit[3]);
  const maxX=limit[0]+limit[2]-width;
  const maxY=limit[1]+limit[3]-height;
  return [
    Math.max(limit[0],Math.min(maxX,box[0])),
    Math.max(limit[1],Math.min(maxY,box[1])),
    width,
    height,
  ];
}

export function zoomTrackViewBox(viewBox,bounds,{x,y,factor=.85,minWidth=90,minHeight=60}={}){
  const current=numericBox(viewBox);
  const limit=numericBox(bounds);
  const zoom=Math.max(.15,Math.min(4,Number(factor)||1));
  const width=Math.max(Math.min(limit[2],current[2]*zoom),Math.min(minWidth,limit[2]));
  const height=Math.max(Math.min(limit[3],current[3]*zoom),Math.min(minHeight,limit[3]));
  const anchorX=Number.isFinite(Number(x))?Number(x):current[0]+current[2]/2;
  const anchorY=Number.isFinite(Number(y))?Number(y):current[1]+current[3]/2;
  const rx=current[2]>0?(anchorX-current[0])/current[2]:.5;
  const ry=current[3]>0?(anchorY-current[1])/current[3]:.5;
  return clampTrackViewBox([
    anchorX-rx*width,
    anchorY-ry*height,
    width,
    height,
  ],limit);
}

export function panTrackViewBox(viewBox,bounds,dx=0,dy=0){
  const current=numericBox(viewBox);
  return clampTrackViewBox([
    current[0]+Number(dx||0),
    current[1]+Number(dy||0),
    current[2],
    current[3],
  ],bounds);
}


export function trackCameraZoomFactor(viewBox,bounds){
  const current=numericBox(viewBox);
  const limit=numericBox(bounds);
  const xRatio=limit[2]>0?limit[2]/Math.max(1,current[2]):1;
  const yRatio=limit[3]>0?limit[3]/Math.max(1,current[3]):1;
  return Math.max(1,Math.sqrt(xRatio*yRatio));
}

export function trackMarkerScaleForViewBox(viewBox,bounds,{power=.72,min=.16,max=1}={}){
  const current=numericBox(viewBox);
  const limit=numericBox(bounds);
  const widthRatio=limit[2]>0?Math.max(0.01,Math.min(1,current[2]/limit[2])):1;
  const heightRatio=limit[3]>0?Math.max(0.01,Math.min(1,current[3]/limit[3])):1;
  const ratio=Math.sqrt(widthRatio*heightRatio);
  const scale=Math.pow(ratio,Math.max(.35,Math.min(1,Number(power)||.72)));
  return Math.max(Number(min)||.16,Math.min(Number(max)||1,scale));
}


export function trackFollowZoomFromWheel(currentZoom,deltaY,{min=1.35,max=12,step=1.12}={}){
  const current=Math.max(Number(min)||1.35,Math.min(Number(max)||12,Number(currentZoom)||1));
  const multiplier=Number(deltaY)<0?Number(step)||1.12:1/(Number(step)||1.12);
  return Math.max(Number(min)||1.35,Math.min(Number(max)||12,current*multiplier));
}

export function followTrackViewBox(fullViewBox,point,{
  zoom=2.35,
  minWidth=190,
  minHeight=150,
  lookAheadRatio=.11,
}={}){
  const box=numericBox(fullViewBox);
  const [x,y,width,height]=box;
  if(!point||!Number.isFinite(Number(point.x))||!Number.isFinite(Number(point.y))||width<=0||height<=0)return box;

  const z=Math.max(1,Number(zoom)||1);
  let targetWidth=Math.max(Number(minWidth)||0,width/z);
  let targetHeight=Math.max(Number(minHeight)||0,height/z);
  targetWidth=Math.min(width,targetWidth);
  targetHeight=Math.min(height,targetHeight);

  const heading=Number(point.heading);
  const ahead=Math.max(0,Math.min(.3,Number(lookAheadRatio)||0));
  const headingRad=Number.isFinite(heading)?heading*(Math.PI/180):0;
  const centerX=Number(point.x)+(Number.isFinite(heading)?Math.cos(headingRad)*targetWidth*ahead:0);
  const centerY=Number(point.y)+(Number.isFinite(heading)?Math.sin(headingRad)*targetHeight*ahead:0);

  const maxX=x+width-targetWidth;
  const maxY=y+height-targetHeight;
  return [
    Math.min(Math.max(x,centerX-targetWidth/2),maxX),
    Math.min(Math.max(y,centerY-targetHeight/2),maxY),
    targetWidth,
    targetHeight,
  ].map((value)=>Number(value.toFixed(3)));
}

export function dampTrackViewBox(current,target,deltaMs,{timeConstantMs=78,snap=.025}={}){
  const from=numericBox(current);
  const to=numericBox(target);
  const dt=Math.max(0,Math.min(80,Number(deltaMs)||0));
  const tau=Math.max(16,Number(timeConstantMs)||78);
  const alpha=1-Math.exp(-dt/tau);
  const next=from.map((value,index)=>value+(to[index]-value)*alpha);
  const settled=next.every((value,index)=>Math.abs(value-to[index])<=Math.max(.001,Number(snap)||.025));
  return settled?to:next;
}

export function trackLodForZoom(zoom){
  const value=Math.max(1,Number(zoom)||1);
  if(value<1.85)return "overview";
  if(value<4.5)return "medium";
  return "close";
}

export function trackLodRank(lod){
  return lod==="close"?2:lod==="medium"?1:0;
}
