// src/race2/core/RaceClassification.js
// RW8.4: canonical live classification and timing projection for RW2.
//
// Order is derived exclusively from canonical physical race distance. The UI
// must consume this state rather than re-sorting cars or rebuilding gaps.

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const positive=(value,fallback=null)=>{
  const parsed=finite(value,null);
  return parsed!=null&&parsed>0?parsed:fallback;
};
const round=(value,digits=3)=>{
  const parsed=finite(value,null);
  return parsed==null?null:Number(parsed.toFixed(digits));
};

function statusRank(car){
  if(car?.status==="finished")return 0;
  // A retired car is frozen at its authoritative distance. On an exact
  // distance tie it has not yet been passed, so it keeps the place until the
  // following car's absolute distance becomes strictly greater.
  if(car?.dnf||car?.status==="dnf")return 1;
  if(car?.status==="running")return 2;
  if(car?.status==="ready")return 3;
  return 4;
}

function median(values){
  const sorted=(Array.isArray(values)?values:[])
    .map((value)=>Number(value))
    .filter((value)=>Number.isFinite(value)&&value>0)
    .sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2
    ?sorted[middle]
    :(sorted[middle-1]+sorted[middle])/2;
}

export function canonicalTimingReferenceSpeedMs(state){
  const active=(state?.cars||[]).filter((car)=>
    !car?.dnf&&car?.status!=="dnf"&&car?.status!=="finished"
  );
  const liveSpeed=median(active.map((car)=>finite(car?.speedMs,null)).filter((value)=>value>=5));
  if(liveSpeed!=null)return round(Math.max(25,Math.min(100,liveSpeed)),6);

  const targetSpeed=median(
    active
      .map((car)=>finite(car?.targetSpeedKmh,null))
      .filter((value)=>value>=90)
      .map((value)=>value/3.6)
  );
  if(targetSpeed!=null)return round(Math.max(25,Math.min(100,targetSpeed)),6);

  return 55;
}

function compareCars(a,b){
  const distanceA=finite(a?.absoluteDistanceM,0);
  const distanceB=finite(b?.absoluteDistanceM,0);
  if(distanceA!==distanceB)return distanceB-distanceA;

  if(a?.status==="finished"&&b?.status==="finished"){
    const finishA=finite(a?.finishTimeMs,null);
    const finishB=finite(b?.finishTimeMs,null);
    if(finishA!=null&&finishB!=null&&finishA!==finishB)return finishA-finishB;
    if(finishA!=null&&finishB==null)return -1;
    if(finishA==null&&finishB!=null)return 1;
  }

  const rankDelta=statusRank(a)-statusRank(b);
  if(rankDelta!==0)return rankDelta;

  const gridA=finite(a?.gridPosition,Number.MAX_SAFE_INTEGER);
  const gridB=finite(b?.gridPosition,Number.MAX_SAFE_INTEGER);
  if(gridA!==gridB)return gridA-gridB;
  return String(a?.carId??"").localeCompare(String(b?.carId??""));
}

function projectedGapMs(gapM,referenceSpeedMs){
  const distance=Math.max(0,finite(gapM,0));
  const speed=positive(referenceSpeedMs,null);
  if(speed==null)return null;
  return Math.round((distance/speed)*1000);
}

function rowTimingBasis(car,{leader=false,leaderCar=null,lapsBehind=0}={}){
  if(leader)return "leader";
  if(car?.dnf||car?.status==="dnf")return "unavailable";
  if(car?.status==="finished"&&leaderCar?.status==="finished")return "finish_time";
  if(lapsBehind>0)return "lap_gap";
  return "distance_projection";
}

export function buildRaceClassification(state){
  const ordered=[...(state?.cars||[])].sort(compareCars);
  if(!ordered.length)return [];

  const lengthM=positive(state?.track?.lengthM,null);
  const referenceSpeedMs=canonicalTimingReferenceSpeedMs(state);
  const leader=ordered[0];
  const leaderDistance=finite(leader?.absoluteDistanceM,0);
  const leaderFinish=finite(leader?.finishTimeMs,null);

  return ordered.map((car,index)=>{
    const previous=index>0?ordered[index-1]:null;
    const distance=finite(car?.absoluteDistanceM,0);
    const previousDistance=previous==null?distance:finite(previous?.absoluteDistanceM,0);
    const gapToLeaderM=Math.max(0,leaderDistance-distance);
    const intervalM=index===0?0:Math.max(0,previousDistance-distance);
    const lapsBehind=lengthM==null?0:Math.max(0,Math.floor((gapToLeaderM+1e-9)/lengthM));
    const intervalLaps=lengthM==null?0:Math.max(0,Math.floor((intervalM+1e-9)/lengthM));

    const finishTime=finite(car?.finishTimeMs,null);
    let gapToLeaderMs=null;
    let intervalMs=null;

    if(index===0){
      gapToLeaderMs=0;
      intervalMs=0;
    }else if(
      car?.status==="finished"&&leader?.status==="finished"&&
      finishTime!=null&&leaderFinish!=null
    ){
      gapToLeaderMs=Math.max(0,Math.round(finishTime-leaderFinish));
      const previousFinish=finite(previous?.finishTimeMs,null);
      intervalMs=previous?.status==="finished"&&previousFinish!=null
        ?Math.max(0,Math.round(finishTime-previousFinish))
        :null;
    }else if(!(car?.dnf||car?.status==="dnf")){
      if(lapsBehind===0)gapToLeaderMs=projectedGapMs(gapToLeaderM,referenceSpeedMs);
      if(intervalLaps===0)intervalMs=projectedGapMs(intervalM,referenceSpeedMs);
    }

    return {
      position:index+1,
      carId:car?.carId??null,
      driverId:car?.driverId??null,
      teamId:car?.teamId??null,
      status:car?.status??null,
      lap:finite(car?.lap,null),
      completedLaps:Math.max(0,Math.floor(finite(car?.completedLaps,0))),
      sector:finite(car?.sector,null),
      absoluteDistanceM:round(distance,6),
      distanceAlongLapM:round(Math.max(0,finite(car?.distanceAlongLapM,0)),6),
      gapToLeaderM:round(gapToLeaderM,6),
      intervalM:round(intervalM,6),
      gapToLeaderMs,
      intervalMs,
      lapsBehind,
      timingBasis:rowTimingBasis(car,{leader:index===0,leaderCar:leader,lapsBehind}),
      finishTimeMs:finishTime==null?null:round(finishTime,3),
      lastLapMs:round(car?.lastLapMs,3),
      bestLapMs:round(car?.bestLapMs,3),
      bestLapNumber:finite(car?.bestLapNumber,null),
    };
  });
}

export function buildRaceTimingState(state,classification=null){
  const rows=classification??buildRaceClassification(state);
  const leader=rows[0]??null;
  return {
    source:"absolute_distance",
    projection:"field_median_speed",
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    referenceSpeedMs:canonicalTimingReferenceSpeedMs(state),
    leaderCarId:leader?.carId??null,
    leaderDistanceM:leader?.absoluteDistanceM??0,
    officialRaceTimeMs:Math.max(0,finite(state?.officialRaceTimeMs,0)),
  };
}

export function projectCanonicalRaceTiming(state){
  const classification=buildRaceClassification(state);
  return {
    classification,
    timingState:buildRaceTimingState(state,classification),
  };
}
