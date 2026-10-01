// src/race2/core/RaceLapTiming.js
// RW9B2: canonical official lap timing.
//
// Timing is derived only after the physical step has been fully resolved
// (pit movement, overtaking, traffic spacing, incidents). Presentation and
// Results may project these fields but must never recalculate them.

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const round=(value,digits=3)=>{
  const parsed=finite(value,null);
  return parsed==null?null:Number(parsed.toFixed(digits));
};
const EPSILON_MS=0.001;

export function canonicalOfficialRaceTimeMs(state){
  const explicit=finite(
    state?.officialRaceTimeMs,
    finite(state?.session?.clock?.officialElapsedMs,null)
  );
  if(explicit!=null)return Math.max(0,explicit);

  // Schema <= 11 compatibility. Car elapsed time did not advance while the
  // race was physically frozen under Red Flag, so it is the safest migration
  // source for the official race clock. Never migrate behind an existing
  // finish timestamp.
  const carClock=Math.max(
    0,
    ...(state?.cars||[]).flatMap((car)=>[
      finite(car?.elapsedMs,0),
      finite(car?.finishTimeMs,0),
    ])
  );
  if(carClock>0)return carClock;

  return Math.max(0,finite(
    state?.session?.clock?.elapsedMs,
    finite(state?.simulationTimeMs,0)
  ));
}

function timingSeed(car,officialStartMs){
  const lapTimes=Array.isArray(car?.lapTimes)?car.lapTimes.map((row)=>({...row})):[];
  const explicitStart=finite(car?.lapStartedAtMs,null);
  const migratedPartialLap=(
    car?.lapTimingBaselineValid===false||
    (
      car?.lapTimingBaselineValid==null&&
      explicitStart==null&&
      lapTimes.length===0&&
      officialStartMs>0
    )
  );
  return {
    lapTimes,
    lapStartedAtMs:Math.max(0,migratedPartialLap
      ?officialStartMs
      :finite(explicitStart,finite(lapTimes.at(-1)?.completedAtMs,0))
    ),
    lapTimingBaselineValid:!migratedPartialLap,
    lastLapMs:finite(car?.lastLapMs,null),
    previousLapMs:finite(car?.previousLapMs,null),
    lastLapDeltaMs:finite(car?.lastLapDeltaMs,null),
    bestLapMs:finite(car?.bestLapMs,null),
    bestLapNumber:finite(car?.bestLapNumber,null),
  };
}

function rawCrossingOffsetMs(from,to,boundary,stepMs){
  const distance=to-from;
  if(distance<=1e-9)return null;
  const fraction=clamp((boundary-from)/distance,0,1);
  return round(fraction*Math.max(0,finite(stepMs,0)),3);
}

function crossingCandidates(state,nextCars,{stepMs}={}){
  const lengthM=Math.max(0,finite(state?.track?.lengthM,0));
  if(lengthM<=0)return [];
  const lapLimit=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));
  const previousById=new Map((state?.cars||[]).map((car)=>[String(car?.carId??""),car]));
  const candidates=[];

  for(const next of nextCars||[]){
    const previous=previousById.get(String(next?.carId??""));
    if(!previous)continue;
    const from=finite(previous?.absoluteDistanceM,0);
    const to=finite(next?.absoluteDistanceM,from);
    if(to<=from+1e-9)continue;

    const firstBoundary=Math.max(1,Math.floor((from+1e-9)/lengthM)+1);
    const lastBoundary=Math.min(
      lapLimit,
      Math.max(0,Math.floor((to+1e-9)/lengthM))
    );
    for(let lapNumber=firstBoundary;lapNumber<=lastBoundary;lapNumber+=1){
      const boundaryDistance=lapNumber*lengthM;
      const physicalFinishHintMs=finite(next?.finishTimeMs,null);
      const simulationStepStartMs=Math.max(0,finite(state?.simulationTimeMs,0));
      const physicalFinishOffsetMs=physicalFinishHintMs==null
        ?null
        :physicalFinishHintMs-simulationStepStartMs;
      const usePhysicalFinishOffset=(
        lapNumber===lapLimit&&
        String(next?.status||"")==="finished"&&
        physicalFinishOffsetMs!=null&&
        physicalFinishOffsetMs>=-1e-6&&
        physicalFinishOffsetMs<=Math.max(0,finite(stepMs,0))+1e-6
      );
      const rawOffsetMs=usePhysicalFinishOffset
        ?round(clamp(physicalFinishOffsetMs,0,Math.max(0,finite(stepMs,0))),3)
        :rawCrossingOffsetMs(from,to,boundaryDistance,stepMs);
      if(rawOffsetMs==null)continue;
      candidates.push({
        carId:String(next?.carId??""),
        lapNumber,
        rawOffsetMs,
        previousAbsoluteM:from,
        gridPosition:finite(previous?.gridPosition,Number.MAX_SAFE_INTEGER),
        physicalFinishHintMs,
      });
    }
  }
  return candidates;
}

function orderCandidates(candidates,stepMs){
  const byLap=new Map();
  for(const candidate of candidates){
    if(!byLap.has(candidate.lapNumber))byLap.set(candidate.lapNumber,[]);
    byLap.get(candidate.lapNumber).push(candidate);
  }
  const resolved=[];

  for(const rows of byLap.values()){
    rows.sort((a,b)=>
      a.rawOffsetMs-b.rawOffsetMs||
      (
        a.physicalFinishHintMs!=null&&b.physicalFinishHintMs!=null
          ?a.physicalFinishHintMs-b.physicalFinishHintMs
          :0
      )||
      b.previousAbsoluteM-a.previousAbsoluteM||
      a.gridPosition-b.gridPosition||
      a.carId.localeCompare(b.carId)
    );

    let index=0;
    while(index<rows.length){
      let end=index+1;
      while(
        end<rows.length&&
        Math.abs(rows[end].rawOffsetMs-rows[index].rawOffsetMs)<=EPSILON_MS
      )end+=1;

      const group=rows.slice(index,end);
      const endOffset=Math.min(
        Math.max(0,finite(stepMs,0)),
        Math.max(...group.map((row)=>row.rawOffsetMs))
      );
      const startOffset=Math.max(0,endOffset-(group.length-1)*EPSILON_MS);
      group.forEach((row,offset)=>{
        resolved.push({
          ...row,
          resolvedOffsetMs:round(startOffset+offset*EPSILON_MS,3),
        });
      });
      index=end;
    }
  }

  return resolved;
}


function sectorTimingSeed(car,officialStartMs){
  const sectorTimes=Array.isArray(car?.sectorTimes)?car.sectorTimes.map((row)=>({...row})):[];
  const explicitStart=finite(car?.sectorStartedAtMs,null);
  const migratedPartialSector=(
    car?.sectorTimingBaselineValid===false||
    (
      car?.sectorTimingBaselineValid==null&&
      explicitStart==null&&
      sectorTimes.length===0&&
      officialStartMs>0
    )
  );
  return {
    sectorTimes,
    sectorStartedAtMs:Math.max(0,migratedPartialSector
      ?officialStartMs
      :finite(explicitStart,finite(sectorTimes.at(-1)?.completedAtMs,0))
    ),
    sectorTimingBaselineValid:!migratedPartialSector,
    sector1Ms:finite(car?.sector1Ms,null),
    sector2Ms:finite(car?.sector2Ms,null),
    sector3Ms:finite(car?.sector3Ms,null),
  };
}

function sectorBoundaries(state){
  const lengthM=Math.max(0,finite(state?.track?.lengthM,0));
  if(lengthM<=0)return [];
  const rows=(Array.isArray(state?.track?.sectors)?state.track.sectors:[])
    .slice()
    .sort((a,b)=>finite(a?.sector,0)-finite(b?.sector,0));
  const first=clamp(finite(rows.find((row)=>Number(row?.sector)===1)?.endM,lengthM/3),0,lengthM);
  const second=clamp(finite(rows.find((row)=>Number(row?.sector)===2)?.endM,lengthM*2/3),first,lengthM);
  return [
    {sector:1,endM:first},
    {sector:2,endM:second},
    {sector:3,endM:lengthM},
  ];
}

function sectorCrossingCandidates(state,nextCars,{stepMs=100,lapCandidates=[]}={}){
  const lengthM=Math.max(0,finite(state?.track?.lengthM,0));
  if(lengthM<=0)return [];
  const lapLimit=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));
  const boundaries=sectorBoundaries(state);
  const previousById=new Map((state?.cars||[]).map((car)=>[String(car?.carId??""),car]));
  const resolvedLapOffsets=new Map(
    (lapCandidates||[]).map((candidate)=>[
      `${String(candidate?.carId??"")}:${Number(candidate?.lapNumber)||0}`,
      finite(candidate?.resolvedOffsetMs,candidate?.rawOffsetMs),
    ])
  );
  const candidates=[];

  for(const next of nextCars||[]){
    const carId=String(next?.carId??"");
    const previous=previousById.get(carId);
    if(!previous)continue;
    const from=finite(previous?.absoluteDistanceM,0);
    const to=finite(next?.absoluteDistanceM,from);
    if(to<=from+1e-9)continue;

    const firstLapIndex=Math.max(0,Math.floor(Math.max(0,from)/lengthM));
    const lastLapIndex=Math.max(firstLapIndex,Math.floor(Math.max(0,to)/lengthM));
    for(let lapIndex=firstLapIndex;lapIndex<=lastLapIndex;lapIndex+=1){
      const lapNumber=lapIndex+1;
      if(lapNumber>lapLimit)break;
      for(const boundary of boundaries){
        const boundaryDistance=boundary.sector===3
          ?(lapIndex+1)*lengthM
          :lapIndex*lengthM+boundary.endM;
        if(boundaryDistance<=from+1e-9||boundaryDistance>to+1e-9)continue;
        const rawOffsetMs=rawCrossingOffsetMs(from,to,boundaryDistance,stepMs);
        if(rawOffsetMs==null)continue;
        const resolvedOffsetMs=boundary.sector===3
          ?finite(resolvedLapOffsets.get(`${carId}:${lapNumber}`),rawOffsetMs)
          :rawOffsetMs;
        candidates.push({
          carId,
          lapNumber,
          sector:boundary.sector,
          boundaryDistance,
          rawOffsetMs,
          resolvedOffsetMs,
        });
      }
    }
  }
  return candidates;
}

export function applyCanonicalLapTiming(state,nextCars,{stepMs=100}={}){
  const cars=Array.isArray(nextCars)?nextCars:[];
  const previousById=new Map((state?.cars||[]).map((car)=>[String(car?.carId??""),car]));
  const officialStartMs=canonicalOfficialRaceTimeMs(state);
  const officialStepEndMs=officialStartMs+Math.max(0,finite(stepMs,0));
  const lapLimit=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));
  const candidates=orderCandidates(crossingCandidates(state,cars,{stepMs}),stepMs);
  const sectorCandidates=sectorCrossingCandidates(state,cars,{stepMs,lapCandidates:candidates});
  const crossingsByCar=new Map();
  const sectorCrossingsByCar=new Map();

  for(const candidate of candidates){
    if(!crossingsByCar.has(candidate.carId))crossingsByCar.set(candidate.carId,[]);
    crossingsByCar.get(candidate.carId).push(candidate);
  }
  for(const candidate of sectorCandidates){
    if(!sectorCrossingsByCar.has(candidate.carId))sectorCrossingsByCar.set(candidate.carId,[]);
    sectorCrossingsByCar.get(candidate.carId).push(candidate);
  }

  return cars.map((next)=>{
    const previous=previousById.get(String(next?.carId??""))??next;
    const seed=timingSeed(previous,officialStartMs);
    let {
      lapTimes,
      lapStartedAtMs,
      lapTimingBaselineValid,
      lastLapMs,
      previousLapMs,
      lastLapDeltaMs,
      bestLapMs,
      bestLapNumber,
    }=seed;
    let {
      sectorTimes,
      sectorStartedAtMs,
      sectorTimingBaselineValid,
      sector1Ms,
      sector2Ms,
      sector3Ms,
    }=sectorTimingSeed(previous,officialStartMs);
    let finishTimeMs=finite(previous?.finishTimeMs,null);

    const sectorCrossings=(sectorCrossingsByCar.get(String(next?.carId??""))||[])
      .sort((a,b)=>
        finite(a?.resolvedOffsetMs,a?.rawOffsetMs)-finite(b?.resolvedOffsetMs,b?.rawOffsetMs)||
        a.sector-b.sector
      );
    for(const crossing of sectorCrossings){
      if(sectorTimes.some((row)=>
        Number(row?.lap)===crossing.lapNumber&&Number(row?.sector)===crossing.sector
      ))continue;
      const completedAtMs=round(
        officialStartMs+finite(crossing?.resolvedOffsetMs,crossing?.rawOffsetMs),
        3
      );
      if(!sectorTimingBaselineValid){
        sectorStartedAtMs=completedAtMs;
        sectorTimingBaselineValid=true;
        continue;
      }
      const sectorTimeMs=round(completedAtMs-sectorStartedAtMs,3);
      if(sectorTimeMs==null||sectorTimeMs<=0)continue;
      sectorTimes=[...sectorTimes,{
        lap:crossing.lapNumber,
        sector:crossing.sector,
        timeMs:sectorTimeMs,
        completedAtMs,
      }];
      if(crossing.sector===1){
        sector1Ms=sectorTimeMs;
        sector2Ms=null;
        sector3Ms=null;
      }else if(crossing.sector===2){
        sector2Ms=sectorTimeMs;
      }else{
        sector3Ms=sectorTimeMs;
      }
      sectorStartedAtMs=completedAtMs;
    }

    const crossings=(crossingsByCar.get(String(next?.carId??""))||[])
      .sort((a,b)=>a.lapNumber-b.lapNumber);

    for(const crossing of crossings){
      if(lapTimes.some((row)=>Number(row?.lap)===crossing.lapNumber))continue;
      const completedAtMs=round(officialStartMs+crossing.resolvedOffsetMs,3);
      if(!lapTimingBaselineValid){
        lapStartedAtMs=completedAtMs;
        lapTimingBaselineValid=true;
        if(crossing.lapNumber===lapLimit&&String(next?.status||"")==="finished"){
          finishTimeMs=completedAtMs;
        }
        continue;
      }
      const lapTimeMs=round(completedAtMs-lapStartedAtMs,3);
      if(lapTimeMs==null||lapTimeMs<=0)continue;
      lapTimes=[...lapTimes,{lap:crossing.lapNumber,timeMs:lapTimeMs,completedAtMs}];
      previousLapMs=lastLapMs;
      lastLapMs=lapTimeMs;
      lastLapDeltaMs=previousLapMs==null?null:round(lastLapMs-previousLapMs,3);
      if(bestLapMs==null||lapTimeMs<bestLapMs-1e-6){
        bestLapMs=lapTimeMs;
        bestLapNumber=crossing.lapNumber;
      }
      lapStartedAtMs=completedAtMs;
      if(crossing.lapNumber===lapLimit&&String(next?.status||"")==="finished"){
        finishTimeMs=completedAtMs;
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
      lapTimingBaselineValid,
      lastLapMs,
      previousLapMs,
      lastLapDeltaMs,
      bestLapMs,
      bestLapNumber,
      lapTimes,
      sectorStartedAtMs,
      sectorTimingBaselineValid,
      sector1Ms,
      sector2Ms,
      sector3Ms,
      sectorTimes,
    };
  });
}

export function terminalOfficialRaceTimeMs(state,cars,{stepMs=100}={}){
  const stepEnd=canonicalOfficialRaceTimeMs(state)+Math.max(0,finite(stepMs,0));
  const allResolved=(cars||[]).length>0&&(cars||[]).every((car)=>
    car?.dnf||car?.status==="dnf"||car?.status==="finished"
  );
  if(!allResolved)return stepEnd;

  const finishTimes=(cars||[])
    .filter((car)=>!(car?.dnf||car?.status==="dnf"))
    .map((car)=>finite(car?.finishTimeMs,null))
    .filter((value)=>value!=null);
  return finishTimes.length?Math.max(...finishTimes):stepEnd;
}
