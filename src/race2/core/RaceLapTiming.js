// src/race2/core/RaceLapTiming.js
// RW9B: one canonical timing source for every physical path through a race step.
//
// Timing is applied after track movement, traffic spacing, overtakes, incidents
// and pit-lane movement have produced the authoritative end-of-step car
// positions. A start/finish crossing therefore cannot be missed or invented by
// a presentation/result adapter.

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function canonicalOfficialRaceTimeMs(state){
  return Math.max(0,finite(
    state?.officialRaceTimeMs,
    finite(state?.session?.clock?.officialElapsedMs,0)
  ));
}

function timingSeed(car){
  const existing=Array.isArray(car?.lapTimes)?car.lapTimes:[];
  return {
    lapTimes:existing,
    lapStartedAtMs:Math.max(0,finite(
      car?.lapStartedAtMs,
      finite(existing.at(-1)?.completedAtMs,0)
    )),
    lastLapMs:finite(car?.lastLapMs,null),
    bestLapMs:finite(car?.bestLapMs,null),
    bestLapNumber:finite(car?.bestLapNumber,null),
  };
}

function kinematicCrossingOffsetMs(previous,next,distanceM,stepMs){
  if(
    String(previous?.pitState?.status??"track")!=="track"||
    String(next?.pitState?.status??"track")!=="track"
  )return null;
  const speed=Math.max(0,finite(previous?.speedMs,finite(previous?.speedKmh,0)/3.6));
  const acceleration=finite(next?.accelerationMs2,0);
  const distance=Math.max(0,finite(distanceM,0));
  const maxTime=Math.max(0,finite(stepMs,0))/1000;
  if(distance<=0||maxTime<=0)return 0;

  if(Math.abs(acceleration)<1e-9){
    if(speed<=1e-9)return null;
    const time=distance/speed;
    return time<=maxTime+1e-9?Number((time*1000).toFixed(3)):null;
  }

  const discriminant=speed*speed+2*acceleration*distance;
  if(discriminant<0)return null;
  const root=Math.sqrt(discriminant);
  const candidates=[
    (-speed+root)/acceleration,
    (-speed-root)/acceleration,
  ].filter((value)=>Number.isFinite(value)&&value>=0&&value<=maxTime+1e-9);
  if(!candidates.length)return null;
  return Number((Math.min(...candidates)*1000).toFixed(3));
}

function crossingOffsetMs(previous,next,from,to,boundary,stepMs){
  const exact=kinematicCrossingOffsetMs(previous,next,boundary-from,stepMs);
  if(exact!=null)return exact;
  const distance=Math.max(0,to-from);
  if(distance<=1e-9)return 0;
  const fraction=clamp((boundary-from)/distance,0,1);
  return Number((fraction*Math.max(0,finite(stepMs,0))).toFixed(3));
}

export function applyCanonicalLapTiming(state,nextCars,{stepMs=100}={}){
  const lengthM=Math.max(0,finite(state?.track?.lengthM,0));
  if(lengthM<=0)return Array.isArray(nextCars)?nextCars:[];
  const previousById=new Map((state?.cars||[]).map((car)=>[String(car?.carId??""),car]));
  const officialStartMs=canonicalOfficialRaceTimeMs(state);
  const officialStepEndMs=officialStartMs+Math.max(0,finite(stepMs,0));
  const lapLimit=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));

  return (Array.isArray(nextCars)?nextCars:[]).map((next)=>{
    const previous=previousById.get(String(next?.carId??""))??next;
    const from=finite(previous?.absoluteDistanceM,finite(next?.absoluteDistanceM,0));
    const to=finite(next?.absoluteDistanceM,from);
    const seed=timingSeed(previous);
    let {lapTimes,lapStartedAtMs,lastLapMs,bestLapMs,bestLapNumber}=seed;
    let finishTimeMs=finite(next?.finishTimeMs,finite(previous?.finishTimeMs,null));

    if(to>from+1e-9){
      const firstBoundary=Math.max(1,Math.floor((from+1e-9)/lengthM)+1);
      const lastBoundary=Math.max(0,Math.floor((to+1e-9)/lengthM));
      if(lastBoundary>=firstBoundary){
        lapTimes=[...seed.lapTimes];
        for(let lapNumber=firstBoundary;lapNumber<=lastBoundary;lapNumber+=1){
          if(lapTimes.some((row)=>Number(row?.lap)===lapNumber))continue;
          const boundaryDistance=lapNumber*lengthM;
          const completedAtMs=Number((
            officialStartMs+crossingOffsetMs(previous,next,from,to,boundaryDistance,stepMs)
          ).toFixed(3));
          const lapTimeMs=Number((completedAtMs-lapStartedAtMs).toFixed(3));
          if(lapTimeMs<=0)continue;
          lapTimes.push({lap:lapNumber,timeMs:lapTimeMs,completedAtMs});
          lastLapMs=lapTimeMs;
          if(bestLapMs==null||lapTimeMs<bestLapMs-1e-6){
            bestLapMs=lapTimeMs;
            bestLapNumber=lapNumber;
          }
          lapStartedAtMs=completedAtMs;
          if(String(next?.status||"")==="finished"&&lapNumber===lapLimit){
            finishTimeMs=completedAtMs;
          }
        }
      }
    }

    const status=String(next?.status||"");
    const elapsedMs=status==="finished"&&finishTimeMs!=null
      ?finishTimeMs
      :(status==="dnf"||next?.dnf)
        ?finite(next?.elapsedMs,finite(previous?.elapsedMs,officialStartMs))
        :officialStepEndMs;

    return {
      ...next,
      elapsedMs,
      finishTimeMs,
      lapStartedAtMs,
      lastLapMs,
      bestLapMs,
      bestLapNumber,
      lapTimes,
    };
  });
}

export function terminalOfficialRaceTimeMs(state,cars,{stepMs=100}={}){
  const stepEnd=canonicalOfficialRaceTimeMs(state)+Math.max(0,finite(stepMs,0));
  const active=(cars||[]).filter((car)=>!(car?.dnf||car?.status==="dnf"));
  const allResolved=(cars||[]).length>0&&(cars||[]).every((car)=>
    car?.dnf||car?.status==="dnf"||car?.status==="finished"
  );
  if(!allResolved)return stepEnd;
  const finishTimes=active
    .map((car)=>finite(car?.finishTimeMs,null))
    .filter((value)=>value!=null);
  return finishTimes.length?Math.max(...finishTimes):stepEnd;
}
