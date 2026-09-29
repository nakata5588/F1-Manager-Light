// src/race2/core/RaceTraffic.js
// RW8.5: canonical physical traffic, following and spacing for RW2.
//
// Traffic is track-space physics, not presentation. It uses each car's physical
// position on the lap to find the nearest active car ahead, including lapped
// traffic, then constrains closing speed and prevents longitudinal overlap.
// Overtaking is deliberately out of scope for this phase.

import {
  trackForwardGapM,
  trackSectorAtDistance,
  wrapTrackDistanceM,
} from "../track/TrackModel.js";

export const RACE_GRID_SLOT_SPACING_M=8;
export const RACE_TRAFFIC_HARD_GAP_M=6;

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,finite(value,min)));
const round=(value,digits=6)=>{
  const parsed=finite(value,null);
  return parsed==null?null:Number(parsed.toFixed(digits));
};

export function initialGridAbsoluteDistanceM(gridPosition){
  const position=Math.max(1,Math.round(finite(gridPosition,1)));
  if(position===1)return 0;
  return -((position-1)*RACE_GRID_SLOT_SPACING_M);
}

function isTrackTrafficCar(car){
  if(!car||car?.dnf||car?.status==="dnf"||car?.status==="finished")return false;
  const pitStatus=String(car?.pitState?.status??"track");
  return pitStatus==="track";
}

function roadTiePrecedes(a,b){
  const absoluteA=finite(a?.absoluteDistanceM,0);
  const absoluteB=finite(b?.absoluteDistanceM,0);
  if(absoluteA!==absoluteB)return absoluteA>absoluteB;
  const gridA=finite(a?.gridPosition,Number.MAX_SAFE_INTEGER);
  const gridB=finite(b?.gridPosition,Number.MAX_SAFE_INTEGER);
  if(gridA!==gridB)return gridA<gridB;
  return String(a?.carId??"").localeCompare(String(b?.carId??""))<0;
}

function lapDistance(state,car){
  const explicit=finite(car?.distanceAlongLapM,null);
  if(explicit!=null)return wrapTrackDistanceM(state?.track,explicit);
  return wrapTrackDistanceM(state?.track,finite(car?.absoluteDistanceM,0));
}

export function nearestTrafficAhead(state,car){
  if(!isTrackTrafficCar(car))return null;
  const from=lapDistance(state,car);
  if(from==null)return null;

  let best=null;
  for(const candidate of state?.cars||[]){
    if(candidate?.carId===car?.carId||!isTrackTrafficCar(candidate))continue;
    const to=lapDistance(state,candidate);
    if(to==null)continue;
    const gap=trackForwardGapM(state?.track,from,to);
    if(gap==null)continue;

    if(gap===0&&!roadTiePrecedes(candidate,car))continue;
    if(best==null||gap<best.gapM-1e-9||(
      Math.abs(gap-best.gapM)<=1e-9&&
      roadTiePrecedes(candidate,best.car)
    )){
      best={car:candidate,gapM:gap};
    }
  }
  return best;
}

export function desiredTrafficGapM(car){
  const speedMs=Math.max(0,finite(car?.speedMs,finite(car?.speedKmh,0)/3.6));
  return round(
    RACE_TRAFFIC_HARD_GAP_M+clamp(speedMs*0.08,0,8),
    6
  );
}

export function raceTrafficContext(state,car){
  const nearest=nearestTrafficAhead(state,car);
  const desiredGapM=desiredTrafficGapM(car);

  if(!nearest){
    return {
      aheadCarId:null,
      gapM:null,
      hardGapM:RACE_TRAFFIC_HARD_GAP_M,
      desiredGapM,
      followRangeM:null,
      speedCeilingMs:null,
    };
  }

  const ahead=nearest.car;
  const gapM=Math.max(0,finite(nearest.gapM,0));
  const speedMs=Math.max(0,finite(car?.speedMs,finite(car?.speedKmh,0)/3.6));
  const aheadSpeedMs=Math.max(0,finite(ahead?.speedMs,finite(ahead?.speedKmh,0)/3.6));
  const followRangeM=desiredGapM+Math.max(24,speedMs*0.5);

  // Grid launch is already physically spaced. Do not manufacture a start-wave
  // while both cars are still at low speed; hard spacing remains enforced.
  const launchFree=speedMs<15&&aheadSpeedMs<15&&gapM>=RACE_TRAFFIC_HARD_GAP_M;
  let speedCeilingMs=null;

  if(!launchFree&&gapM<=followRangeM){
    const gapError=gapM-desiredGapM;
    const responseTimeS=gapError>=0?0.9:0.35;
    const closingAllowance=gapError/responseTimeS;
    speedCeilingMs=Math.max(0,aheadSpeedMs+closingAllowance);
  }

  return {
    aheadCarId:ahead?.carId??null,
    gapM:round(gapM,6),
    hardGapM:RACE_TRAFFIC_HARD_GAP_M,
    desiredGapM,
    followRangeM:round(followRangeM,6),
    speedCeilingMs:speedCeilingMs==null?null:round(speedCeilingMs,6),
  };
}

function lapLimitFor(state){
  const value=finite(state?.session?.lapLimit,null);
  return value!=null&&value>0?Math.round(value):null;
}

function withAbsoluteDistance(state,previous,car,absoluteDistanceM,{speedCapMs=null,stepMs=100}={}){
  const lengthM=Math.max(0,finite(state?.track?.lengthM,0));
  if(lengthM<=0)return car;

  const absolute=finite(absoluteDistanceM,finite(car?.absoluteDistanceM,0));
  const lapLimit=lapLimitFor(state);
  const finishDistance=lapLimit==null?null:lapLimit*lengthM;
  const finished=finishDistance!=null&&absolute>=finishDistance;
  const canonicalAbsolute=finished?finishDistance:absolute;
  const completedLaps=Math.max(0,Math.floor(canonicalAbsolute/lengthM));
  const distanceAlongLapM=finished
    ?0
    :(wrapTrackDistanceM(state.track,canonicalAbsolute)??0);
  const lap=finished?lapLimit:completedLaps+1;
  const sector=finished?3:(trackSectorAtDistance(state.track,distanceAlongLapM)??1);

  let speedMs=Math.max(0,finite(car?.speedMs,finite(car?.speedKmh,0)/3.6));
  if(speedCapMs!=null)speedMs=Math.min(speedMs,Math.max(0,finite(speedCapMs,0)));
  const previousSpeed=Math.max(0,finite(previous?.speedMs,finite(previous?.speedKmh,0)/3.6));
  const dt=Math.max(0.01,finite(stepMs,100)/1000);
  const acceleration=(speedMs-previousSpeed)/dt;

  return {
    ...car,
    absoluteDistanceM:round(canonicalAbsolute,6),
    distanceAlongLapM:round(distanceAlongLapM,6),
    completedLaps,
    lap,
    sector,
    speedMs:round(speedMs,6),
    speedKmh:round(speedMs*3.6,6),
    accelerationMs2:round(acceleration,6),
    finishTimeMs:finished?car?.finishTimeMs??null:null,
    elapsedMs:finished
      ?car?.elapsedMs
      :Math.max(
        finite(car?.elapsedMs,0),
        finite(state?.simulationTimeMs,0)+Math.max(0,finite(stepMs,100))
      ),
    zoneId:finished?"finish":`sector_${sector}`,
    zoneType:finished?"finish":"sector",
    status:finished?"finished":"running",
  };
}

function currentCarById(state,id){
  return (state?.cars||[]).find((car)=>String(car?.carId??"")===String(id??""))??null;
}

export function enforceRaceTrafficSpacing(state,proposedCars,{stepMs=100,iterations=4}={}){
  const contexts=new Map(
    (state?.cars||[]).map((car)=>[car?.carId,raceTrafficContext(state,car)])
  );
  let out=(proposedCars||[]).map((car)=>({...car}));
  const rounds=Math.max(1,Math.min(8,Math.round(finite(iterations,4))));

  for(let round=0;round<rounds;round+=1){
    let changed=false;
    const byId=new Map(out.map((car)=>[car?.carId,car]));

    for(let index=0;index<out.length;index+=1){
      const follower=out[index];
      const previousFollower=currentCarById(state,follower?.carId);
      const context=contexts.get(follower?.carId);
      if(!previousFollower||!context?.aheadCarId||!isTrackTrafficCar(previousFollower))continue;

      const previousAhead=currentCarById(state,context.aheadCarId);
      const ahead=byId.get(context.aheadCarId);
      if(!previousAhead||!ahead||ahead?.dnf||ahead?.status==="dnf")continue;

      // Overtaking is not active yet. If both cars cross the finish during the
      // same fixed step, preserve the pre-step road order even though both
      // positions clamp to the same finish distance.
      if(ahead?.status==="finished"&&follower?.status==="finished"){
        const aheadFinish=finite(ahead?.finishTimeMs,null);
        const followerFinish=finite(follower?.finishTimeMs,null);
        if(aheadFinish!=null&&followerFinish!=null&&followerFinish<=aheadFinish){
          const adjustedFinish=Number((aheadFinish+0.001).toFixed(3));
          const adjusted={
            ...follower,
            finishTimeMs:adjustedFinish,
            elapsedMs:adjustedFinish,
            traffic:{
              ...(follower?.traffic||{}),
              limited:true,
              hardLimited:true,
            },
          };
          out[index]=adjusted;
          byId.set(adjusted.carId,adjusted);
          changed=true;
        }
        continue;
      }
      if(ahead?.status==="finished")continue;

      const followerStart=finite(previousFollower?.absoluteDistanceM,0);
      const aheadStart=finite(previousAhead?.absoluteDistanceM,0);
      const aheadEnd=finite(ahead?.absoluteDistanceM,aheadStart);
      const alignedAheadStart=followerStart+Math.max(0,finite(context?.gapM,0));
      const alignedAheadEnd=alignedAheadStart+(aheadEnd-aheadStart);
      const allowedAbsolute=alignedAheadEnd-Math.max(0,finite(context?.hardGapM,RACE_TRAFFIC_HARD_GAP_M));
      const followerEnd=finite(follower?.absoluteDistanceM,followerStart);

      if(followerEnd>allowedAbsolute+1e-9){
        const adjustedAbsolute=Math.max(followerStart,allowedAbsolute);
        const adjusted=withAbsoluteDistance(
          state,
          previousFollower,
          follower,
          adjustedAbsolute,
          {speedCapMs:finite(ahead?.speedMs,null),stepMs}
        );
        adjusted.traffic={
          ...(follower?.traffic||{}),
          limited:true,
          hardLimited:true,
        };
        out[index]=adjusted;
        byId.set(adjusted.carId,adjusted);
        changed=true;
      }
    }

    if(!changed)break;
  }

  const finalState={...state,cars:out};
  return out.map((car)=>{
    if(!isTrackTrafficCar(car))return car;
    const context=raceTrafficContext(finalState,car);
    const previousTraffic=car?.traffic||{};
    return {
      ...car,
      traffic:{
        aheadCarId:context.aheadCarId,
        gapM:context.gapM,
        hardGapM:context.hardGapM,
        desiredGapM:context.desiredGapM,
        followRangeM:context.followRangeM,
        targetSpeedKmh:previousTraffic?.targetSpeedKmh??null,
        limited:Boolean(previousTraffic?.limited),
        hardLimited:Boolean(previousTraffic?.hardLimited),
      },
    };
  });
}

export function initialTrafficState(){
  return {
    aheadCarId:null,
    gapM:null,
    hardGapM:RACE_TRAFFIC_HARD_GAP_M,
    desiredGapM:RACE_TRAFFIC_HARD_GAP_M,
    followRangeM:null,
    targetSpeedKmh:null,
    limited:false,
    hardLimited:false,
  };
}
