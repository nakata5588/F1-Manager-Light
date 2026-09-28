// src/domain/raceCarOccupancy.js
// Presentation-space collision envelope for Race View cars.
// It keeps visual car sprites from occupying the same space without changing
// authoritative race positions, gaps, overtakes, damage, or incident physics.

function finite(value,fallback=0){
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
}

function clamp(value,min,max){
  return Math.max(min,Math.min(max,value));
}

function stableSide(value){
  const text=String(value||"");
  let hash=0;
  for(let i=0;i<text.length;i+=1)hash=((hash*31)+text.charCodeAt(i))|0;
  return (hash&1)?1:-1;
}

function headingVector(degrees){
  const rad=finite(degrees,0)*(Math.PI/180);
  return {
    x:Math.cos(rad),
    y:Math.sin(rad),
    nx:-Math.sin(rad),
    ny:Math.cos(rad),
  };
}

export function raceCarPhysicalEnvelope({markerScale=1,lod="overview"}={}){
  const scale=clamp(finite(markerScale,1),0.08,1.4);
  const lodFactor=lod==="close"?1:lod==="medium"?.96:.9;
  return {
    longitudinal:24*scale*lodFactor,
    lateral:12*scale*lodFactor,
    max_lateral_shift:8.5*scale*lodFactor,
    max_longitudinal_shift:20*scale*lodFactor,
  };
}

export function raceCarOverlapMetric(a,b,{markerScale=1,lod="overview"}={}){
  const pointA=a?.point||a;
  const pointB=b?.point||b;
  if(!pointA||!pointB)return Infinity;
  const envelope=raceCarPhysicalEnvelope({markerScale,lod});
  const basis=headingVector(pointA.heading);
  const dx=finite(pointB.x)-finite(pointA.x);
  const dy=finite(pointB.y)-finite(pointA.y);
  const longitudinal=(dx*basis.x)+(dy*basis.y);
  const lateral=(dx*basis.nx)+(dy*basis.ny);
  return Math.sqrt(
    Math.pow(longitudinal/Math.max(.001,envelope.longitudinal),2)
    +Math.pow(lateral/Math.max(.001,envelope.lateral),2)
  );
}

function raceOrder(entry,fallback){
  const value=Number(entry?.raceOrder);
  return Number.isFinite(value)?value:fallback;
}

function movePoint(entry,dx,dy){
  entry.point.x+=finite(dx);
  entry.point.y+=finite(dy);
}

function resolvePair(a,b,options){
  const envelope=raceCarPhysicalEnvelope(options);
  const basis=headingVector(a.point.heading);
  let dx=b.point.x-a.point.x;
  let dy=b.point.y-a.point.y;
  let longitudinal=(dx*basis.x)+(dy*basis.y);
  let lateral=(dx*basis.nx)+(dy*basis.ny);
  let metric=Math.sqrt(
    Math.pow(longitudinal/envelope.longitudinal,2)
    +Math.pow(lateral/envelope.lateral,2)
  );
  if(metric>=1)return false;

  const aOrder=raceOrder(a,999);
  const bOrder=raceOrder(b,999);
  let anchor=a;
  let mover=b;
  let moverBehind=bOrder>=aOrder;

  if(a.selected&&!b.selected){
    anchor=a;mover=b;moverBehind=bOrder>=aOrder;
  }else if(b.selected&&!a.selected){
    anchor=b;mover=a;moverBehind=aOrder>=bOrder;
  }else if(bOrder<aOrder){
    anchor=b;mover=a;moverBehind=true;
  }

  const anchorBasis=headingVector(anchor.point.heading);
  dx=mover.point.x-anchor.point.x;
  dy=mover.point.y-anchor.point.y;
  longitudinal=(dx*anchorBasis.x)+(dy*anchorBasis.y);
  lateral=(dx*anchorBasis.nx)+(dy*anchorBasis.ny);

  const longRatio=Math.min(.999,Math.abs(longitudinal)/Math.max(.001,envelope.longitudinal));
  const neededLateral=envelope.lateral*Math.sqrt(Math.max(0,1-(longRatio*longRatio)))*1.035;
  const side=Math.abs(lateral)>.18?Math.sign(lateral):stableSide(mover.id);
  const targetLateral=side*neededLateral;
  let lateralDelta=targetLateral-lateral;
  lateralDelta=clamp(lateralDelta,-envelope.max_lateral_shift,envelope.max_lateral_shift);

  if(anchor.selected&&!mover.selected){
    movePoint(mover,anchorBasis.nx*lateralDelta,anchorBasis.ny*lateralDelta);
  }else{
    movePoint(anchor,-anchorBasis.nx*lateralDelta*.5,-anchorBasis.ny*lateralDelta*.5);
    movePoint(mover,anchorBasis.nx*lateralDelta*.5,anchorBasis.ny*lateralDelta*.5);
  }

  metric=raceCarOverlapMetric(anchor,mover,options);
  if(metric>=1)return true;

  dx=mover.point.x-anchor.point.x;
  dy=mover.point.y-anchor.point.y;
  longitudinal=(dx*anchorBasis.x)+(dy*anchorBasis.y);
  lateral=(dx*anchorBasis.nx)+(dy*anchorBasis.ny);
  const latRatio=Math.min(.999,Math.abs(lateral)/Math.max(.001,envelope.lateral));
  const neededLong=envelope.longitudinal*Math.sqrt(Math.max(0,1-(latRatio*latRatio)))*1.035;
  const targetLong=(moverBehind?-1:1)*neededLong;
  let longDelta=targetLong-longitudinal;
  longDelta=clamp(longDelta,-envelope.max_longitudinal_shift,envelope.max_longitudinal_shift);
  movePoint(mover,anchorBasis.x*longDelta,anchorBasis.y*longDelta);
  return true;
}

export function resolveRaceCarPhysicalLayout(entries,{markerScale=1,lod="overview",iterations=5}={}){
  const out=(Array.isArray(entries)?entries:[])
    .filter((entry)=>entry?.point&&Number.isFinite(Number(entry.point.x))&&Number.isFinite(Number(entry.point.y)))
    .map((entry,index)=>({
      ...entry,
      raceOrder:raceOrder(entry,index+1),
      point:{
        ...entry.point,
        x:finite(entry.point.x),
        y:finite(entry.point.y),
        heading:finite(entry.point.heading,0),
      },
    }));

  if(out.length<2)return out;

  const rounds=Math.max(1,Math.min(8,Math.round(Number(iterations)||5));
  for(let round=0;round<rounds;round+=1){
    let changed=false;
    for(let i=0;i<out.length;i+=1){
      for(let j=i+1;j<out.length;j+=1){
        if(resolvePair(out[i],out[j],{markerScale,lod}))changed=true;
      }
    }
    if(!changed)break;
  }
  return out;
}
