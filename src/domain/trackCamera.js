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
