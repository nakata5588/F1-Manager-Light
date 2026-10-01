// src/race2/core/RacePitStrategy.js
// RW8.14K1: canonical pit-strategy planner.
//
// This module decides when an already-configured strategy should request a stop.
// RacePitStops remains execution-only (entry/queue/service/exit), so live and
// fast runners consume the same deterministic decision over the same RaceState.

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"").trim().toLowerCase();

export function nextReachablePitLap(state,car){
  const length=Math.max(1,finite(state?.track?.lengthM,1));
  const absolute=Math.max(0,finite(car?.absoluteDistanceM,0));
  const currentLap=Math.max(1,Math.floor(absolute/length)+1);
  const entry=finite(state?.track?.pitLane?.entryM,null);
  const currentEntry=entry==null
    ?currentLap*length
    :(currentLap-1)*length+entry;
  const target=absolute<currentEntry-1e-6
    ?currentLap
    :currentLap+1;
  const limit=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));
  return target<=limit?target:null;
}

function weatherTyreCategory(state){
  const weather=text(
    state?.weatherState?.state
    ??state?.weatherState?.current?.state
    ??state?.trackState?.weatherState
  );
  const wetness=finite(
    state?.weatherState?.track_wetness
    ??state?.trackState?.wetness,
    null
  );
  if(["heavy_rain","storm"].includes(weather)||(wetness!=null&&wetness>=0.68))return "wet";
  if(["light_rain","wetting","drying","drizzle_drying"].includes(weather)||(wetness!=null&&wetness>=0.22))return "intermediate";
  return "dry";
}

function bestAvailableTyre(car,category){
  const currentId=String(car?.tyre?.tyre_id??"");
  const exact=(car?.resources?.availableTyres||[])
    .filter((row)=>text(row?.category||"dry")===category&&String(row?.tyre_id??"")!==currentId)
    .sort((a,b)=>
      finite(b?.grip_index,75)-finite(a?.grip_index,75)||
      finite(a?.wear_rate,0.018)-finite(b?.wear_rate,0.018)||
      String(a?.tyre_id??"").localeCompare(String(b?.tyre_id??""))
    );
  return exact[0]??null;
}

function planCar(state,car){
  if(!car||car?.dnf||["dnf","finished"].includes(text(car?.status)))return car;
  if(car?.pitState?.active)return car;

  const strategy=car?.resources?.strategy||{};
  if(text(strategy?.pitPlan)!=="adaptive")return car;
  if(finite(strategy?.plannedStopLap,null)!=null)return car;

  const lapLimit=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));
  const currentLap=Math.max(1,Math.round(finite(car?.lap,finite(car?.completedLaps,0)+1)));
  const remaining=Math.max(0,lapLimit-currentLap+1);
  if(currentLap<=1||remaining<=2)return car;

  const currentCategory=text(car?.tyre?.category||"dry");
  const targetCategory=weatherTyreCategory(state);
  const weatherTyre=currentCategory!==targetCategory
    ?bestAvailableTyre(car,targetCategory)
    :null;

  let reason=null;
  let nextTyreId=String(strategy?.nextTyreId??"");
  if(weatherTyre){
    reason="weather";
    nextTyreId=String(weatherTyre.tyre_id);
  }else if(finite(car?.tyre?.condition,100)<34&&remaining>6){
    reason="degradation";
  }

  if(!reason)return car;
  const plannedStopLap=nextReachablePitLap(state,car);
  if(plannedStopLap==null)return car;

  return {
    ...car,
    resources:{
      ...(car?.resources||{}),
      strategy:{
        ...strategy,
        plannedStopLap,
        nextTyreId:nextTyreId||(strategy?.nextTyreId??null),
        tyreChangeRequested:true,
        autoPitReason:reason,
      },
    },
  };
}

export function planCanonicalPitStrategies(state,cars=state?.cars||[]){
  return (cars||[]).map((car)=>planCar(state,car));
}
