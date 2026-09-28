function finite(value,fallback=0){
  const number=Number(value);
  return Number.isFinite(number)?number:fallback;
}

function clamp(value,min,max){
  return Math.max(min,Math.min(max,value));
}

export function unwrapRaceWorldTarget(currentWorld,targetWorld){
  const current=finite(currentWorld,0);
  const target=finite(targetWorld,current);
  let candidate=target+Math.round(current-target);
  if(candidate<current-.18)candidate+=1;
  return candidate;
}

export function createContinuousRaceSegment({
  position=0,
  velocity=0,
  targetPosition=0,
  durationMs=1000,
  clockMs=0,
  stopped=false,
}={}){
  const start=finite(position,0);
  const duration=Math.max(120,finite(durationMs,1000));
  const rawTarget=unwrapRaceWorldTarget(start,targetPosition);
  const target=stopped?start:Math.max(start,rawTarget);
  const startVelocity=stopped?0:Math.max(0,finite(velocity,0));
  const averageVelocity=stopped?0:Math.max(0,(target-start)/duration);
  const endVelocity=stopped?0:Math.max(averageVelocity*.88,Math.min(averageVelocity*1.08,startVelocity||averageVelocity));
  return {
    start_position:start,
    target_position:target,
    start_velocity:startVelocity,
    end_velocity:endVelocity,
    start_clock_ms:finite(clockMs,0),
    duration_ms:duration,
    stopped:Boolean(stopped),
  };
}

export function sampleContinuousRaceSegment(segment,clockMs,{maxExtrapolationRatio=.42}={}){
  if(!segment)return {position:0,velocity:0,phase:1,extrapolated:false};
  const duration=Math.max(1,finite(segment.duration_ms,1000));
  const elapsed=Math.max(0,finite(clockMs,0)-finite(segment.start_clock_ms,0));
  const rawPhase=elapsed/duration;
  const t=clamp(rawPhase,0,1);
  const p0=finite(segment.start_position,0);
  const p1=finite(segment.target_position,p0);
  const m0=finite(segment.start_velocity,0)*duration;
  const m1=finite(segment.end_velocity,0)*duration;
  const tt=t*t;
  const ttt=tt*t;
  const h00=2*ttt-3*tt+1;
  const h10=ttt-2*tt+t;
  const h01=-2*ttt+3*tt;
  const h11=ttt-tt;
  let position=h00*p0+h10*m0+h01*p1+h11*m1;

  const dh00=6*tt-6*t;
  const dh10=3*tt-4*t+1;
  const dh01=-6*tt+6*t;
  const dh11=3*tt-2*t;
  let velocity=(dh00*p0+dh10*m0+dh01*p1+dh11*m1)/duration;

  let extrapolated=false;
  if(rawPhase>1&&!segment.stopped){
    const extraMs=Math.min(
      elapsed-duration,
      duration*Math.max(0,Number(maxExtrapolationRatio)||0)
    );
    if(extraMs>0){
      position=p1+Math.max(0,finite(segment.end_velocity,0))*extraMs;
      velocity=Math.max(0,finite(segment.end_velocity,0));
      extrapolated=true;
    }
  }

  if(segment.stopped){
    position=p0;
    velocity=0;
  }
  return {
    position,
    velocity:Math.max(0,velocity),
    phase:rawPhase,
    extrapolated,
  };
}

export function retargetContinuousRaceSegment(segment,{
  targetPosition,
  durationMs,
  clockMs,
  stopped=false,
}={}){
  const current=sampleContinuousRaceSegment(segment,clockMs);
  return createContinuousRaceSegment({
    position:current.position,
    velocity:current.velocity,
    targetPosition,
    durationMs,
    clockMs,
    stopped,
  });
}

export function continuousRaceTargetToken(car){
  return [
    String(car?.id||""),
    Number(car?.targetWorldProgress||0).toFixed(7),
    Number(car?.targetPitLaneProgress||0).toFixed(5),
    Number(car?.targetPitLaneMix||0).toFixed(4),
    car?.stopped?1:0,
    car?.retired?1:0,
  ].join(":");
}
