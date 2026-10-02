// src/race2/core/RaceTeamOrders.js
// RW22: canonical cooperative team-order execution.
//
// The command layer decides whether an order is valid/accepted. This module
// owns only its physical execution: the yielding car gives up pace until the
// named team-mate is safely ahead. Traffic spacing is bypassed only for that
// pair while the order is active; no classification or timing is edited.

import {
  RACE_TRAFFIC_HARD_GAP_M,
  raceTrafficPairKey,
} from "./RaceTraffic.js";

export const RACE_TEAM_ORDER_MAX_DURATION_MS=45000;
export const RACE_TEAM_ORDER_YIELD_PACE_MULTIPLIER=0.90;
export const RACE_TEAM_ORDER_LATERAL_OFFSET_M=1.15;

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

function activeTrackCar(car){
  if(!car||car?.dnf||car?.status==="dnf"||car?.status==="finished")return false;
  return String(car?.pitState?.status??"track")==="track";
}

function carById(cars,id){
  return (cars||[]).find((car)=>String(car?.carId??"")===String(id??""))??null;
}

function setCar(cars,next){
  const index=(cars||[]).findIndex((car)=>String(car?.carId??"")===String(next?.carId??""));
  if(index<0)return cars;
  const out=[...cars];
  out[index]=next;
  return out;
}

function activeOrder(car){
  const order=car?.commands?.teamOrder;
  return order?.active&&String(order?.order||"")==="yield"?order:null;
}

function clearOrder(car){
  const commands={...(car?.commands||{})};
  delete commands.teamOrder;
  return {
    ...car,
    commands,
    lateralOffsetM:0,
  };
}

function descriptor(type,state,yielding,teammate,payload={}){
  return {
    type,
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    timeMs:Math.max(0,finite(state?.simulationTimeMs,0)),
    carIds:[yielding?.carId,teammate?.carId].filter(Boolean),
    driverIds:[yielding?.driverId,teammate?.driverId].filter(Boolean),
    payload,
  };
}

export function raceTeamOrderPaceMultiplier(state,car){
  const order=activeOrder(car);
  if(!order)return 1;
  const now=Math.max(0,finite(state?.simulationTimeMs,0));
  if(finite(order?.expiresAtMs,now)<=now)return 1;
  const teammate=carById(state?.cars,order?.teammateCarId);
  if(!activeTrackCar(teammate))return 1;
  return Math.max(
    0.75,
    Math.min(1,finite(order?.yieldPaceMultiplier,RACE_TEAM_ORDER_YIELD_PACE_MULTIPLIER))
  );
}

export function resolveRaceTeamOrders(state,proposedCars,{stepMs=100}={}){
  let cars=(proposedCars||[]).map((car)=>({...car}));
  const events=[];
  const bypassPairs=new Set();
  const nextTime=Math.max(0,finite(state?.simulationTimeMs,0))+Math.max(0,finite(stepMs,100));

  for(const previousYielding of state?.cars||[]){
    const order=activeOrder(previousYielding);
    if(!order)continue;

    let yielding=carById(cars,previousYielding?.carId);
    let teammate=carById(cars,order?.teammateCarId);
    const previousMate=carById(state?.cars,order?.teammateCarId);

    if(
      !yielding||
      !teammate||
      !activeTrackCar(previousYielding)||
      !activeTrackCar(previousMate)||
      String(yielding?.teamId??"")!==String(teammate?.teamId??"")
    ){
      if(yielding){
        yielding=clearOrder(yielding);
        cars=setCar(cars,yielding);
      }
      events.push(descriptor("team_order_aborted",state,yielding??previousYielding,teammate??previousMate,{
        order:"yield",
        reason:"teammate_unavailable",
      }));
      continue;
    }

    const clearance=
      finite(teammate?.absoluteDistanceM,0)-
      finite(yielding?.absoluteDistanceM,0);

    if(clearance>=RACE_TRAFFIC_HARD_GAP_M-1e-9){
      yielding=clearOrder(yielding);
      teammate={...teammate,lateralOffsetM:0};
      cars=setCar(setCar(cars,yielding),teammate);
      events.push(descriptor("team_order_completed",state,yielding,teammate,{
        order:"yield",
        clearanceM:Number(clearance.toFixed(6)),
      }));
      continue;
    }

    if(nextTime>=finite(order?.expiresAtMs,nextTime)){
      yielding=clearOrder(yielding);
      teammate={...teammate,lateralOffsetM:0};
      cars=setCar(setCar(cars,yielding),teammate);
      events.push(descriptor("team_order_aborted",state,yielding,teammate,{
        order:"yield",
        reason:"expired",
        clearanceM:Number(clearance.toFixed(6)),
      }));
      continue;
    }

    const pairKey=raceTrafficPairKey(yielding,teammate);
    bypassPairs.add(pairKey);

    const closeEnough=Math.abs(clearance)<=Math.max(30,RACE_TRAFFIC_HARD_GAP_M*5);
    yielding={
      ...yielding,
      lateralOffsetM:closeEnough?RACE_TEAM_ORDER_LATERAL_OFFSET_M:0,
    };
    teammate={
      ...teammate,
      lateralOffsetM:closeEnough?-RACE_TEAM_ORDER_LATERAL_OFFSET_M:0,
    };
    cars=setCar(setCar(cars,yielding),teammate);
  }

  return {cars,events,bypassPairs};
}
