// src/race2/core/RaceCommands.js
// RW8.9: canonical race command queue and deterministic command execution.
//
// UI/live runners and fast simulation feed the same RaceState command queue.
// This module validates and applies commands only; race physics remains owned by
// the existing dynamics/resources/pit/overtaking layers.

import { RACE_COMMAND_TYPES } from "../contracts/raceContracts.js";
import { RACE_PACE_MODES } from "../../domain/raceTyreModel.js";
import { CAR_DAMAGE_COMPONENTS } from "../../engine/CarDamageEngine.js";
import { nextReachablePitLap } from "./RacePitStrategy.js";

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"").trim();

function carForDriver(state,driverId){
  const did=text(driverId);
  return (state?.cars||[]).find((car)=>text(car?.driverId)===did)??null;
}

function tyreAvailable(car,tyreId){
  const wanted=text(tyreId);
  if(!wanted)return false;
  return (car?.resources?.availableTyres||[])
    .some((row)=>text(row?.tyre_id??row?.id)===wanted);
}

function repairComponentsFor(car,payload={}){
  const damaged=new Set(
    (Array.isArray(car?.damage?.damaged_components)?car.damage.damaged_components:[])
      .map(text)
      .filter(Boolean)
  );
  if(!damaged.size)return [];

  const repairAll=payload?.repairDamage===true||payload?.repair_damage===true;
  const requested=repairAll
    ?[...damaged]
    :Array.isArray(payload?.repairComponents)
      ?payload.repairComponents
      :Array.isArray(payload?.repair_components)
        ?payload.repair_components
        :[];

  return [...new Set(
    requested
      .map(text)
      .filter((component)=>CAR_DAMAGE_COMPONENTS.includes(component)&&damaged.has(component))
  )];
}

function normalizedPayload(state,car,type,raw={}){
  const payload=raw?.payload&&typeof raw.payload==="object"
    ?raw.payload
    :raw;

  if(type===RACE_COMMAND_TYPES.PACE){
    const paceMode=text(payload?.paceMode??payload?.pace_mode??payload?.mode).toLowerCase();
    if(!Object.hasOwn(RACE_PACE_MODES,paceMode))return null;
    return {paceMode};
  }

  if(type===RACE_COMMAND_TYPES.PIT){
    const tyreChange=payload?.tyreChange===false||payload?.tyre_change===false
      ?false
      :Boolean(text(payload?.tyreId??payload?.tyre_id));
    const tyreId=tyreChange
      ?text(payload?.tyreId??payload?.tyre_id)
      :null;
    const explicitRefuel=payload?.refuel===undefined||payload?.refuel===null
      ?null
      :Boolean(payload.refuel);
    if(tyreChange&&!tyreAvailable(car,tyreId))return null;
    if(explicitRefuel===true&&!car?.resources?.refuellingDeferred)return null;
    const inheritedRefuel=Boolean(car?.resources?.strategy?.refuelRequested);
    const repairComponents=repairComponentsFor(car,payload);
    if(!tyreChange&&explicitRefuel!==true&&!inheritedRefuel&&!repairComponents.length)return null;
    return {
      tyreId,
      tyreChange,
      refuel:explicitRefuel,
      repairComponents,
    };
  }

  return null;
}

export function normalizeRaceCommand(state,raw={}){
  if(!state||state.status!=="running")return null;
  const driverId=text(raw?.driverId??raw?.driver_id);
  const car=carForDriver(state,driverId);
  if(!car||car?.dnf||car?.status==="dnf"||car?.status==="finished")return null;

  const teamId=text(raw?.teamId??raw?.team_id??car?.teamId);
  if(!teamId||teamId!==text(car?.teamId))return null;

  const type=text(raw?.type).toLowerCase();
  if(![RACE_COMMAND_TYPES.PACE,RACE_COMMAND_TYPES.PIT].includes(type))return null;

  const payload=normalizedPayload(state,car,type,raw);
  if(!payload)return null;

  const sequence=Math.max(1,Math.floor(finite(state?.nextCommandSequence,1)));
  const issuedAtTick=Math.max(0,Math.floor(finite(state?.tick,0)));
  const requestedTick=finite(raw?.effectiveAtTick??raw?.effective_at_tick,null);
  const effectiveAtTick=requestedTick==null
    ?issuedAtTick+1
    :Math.max(issuedAtTick,Math.floor(requestedTick));

  return {
    id:`${state?.weekendKey??"race"}:cmd:${sequence}`,
    sequence,
    issuedAtTick,
    effectiveAtTick,
    source:text(raw?.source)||"player",
    driverId,
    teamId,
    type,
    payload,
  };
}

export function queueRaceCommand(state,raw={}){
  const command=normalizeRaceCommand(state,raw);
  if(!command)return state;

  // A newer order only replaces a competing order for the same driver, type
  // and execution tick. Distinct future ticks remain schedulable.
  const queue=(state?.commandQueue||[])
    .filter((row)=>!(
      text(row?.driverId)===command.driverId&&
      text(row?.type)===command.type&&
      Math.floor(finite(row?.effectiveAtTick,-1))===command.effectiveAtTick
    ))
    .map((row)=>({...row}));

  queue.push(command);
  queue.sort((a,b)=>
    finite(a?.effectiveAtTick,0)-finite(b?.effectiveAtTick,0)||
    finite(a?.sequence,0)-finite(b?.sequence,0)
  );

  return {
    ...state,
    commandQueue:queue,
    nextCommandSequence:command.sequence+1,
  };
}

export function cancelRaceCommand(state,{id=null,driverId=null,type=null}={}){
  if(!state)return state;
  const wantedId=text(id);
  const wantedDriver=text(driverId);
  const wantedType=text(type);
  const queue=state?.commandQueue||[];
  const removed=[];
  const next=queue.filter((row)=>{
    let matches=false;
    if(wantedId){
      matches=text(row?.id)===wantedId;
    }else{
      if(wantedDriver&&text(row?.driverId)!==wantedDriver)return true;
      if(wantedType&&text(row?.type)!==wantedType)return true;
      matches=true;
    }
    if(matches)removed.push(row);
    return !matches;
  });
  if(!removed.length)return state;

  const startSequence=Math.max(1,Math.floor(finite(state?.nextEventSequence,1)));
  const cancelledEvents=removed.map((command,index)=>{
    const sequence=startSequence+index;
    const car=carForDriver(state,command?.driverId);
    return {
      id:`${state?.weekendKey??"race"}:${sequence}`,
      sequence,
      ...event("command_cancelled",state,car,command,{reason:"player_cancelled"}),
    };
  });

  return {
    ...state,
    commandQueue:next.map((row)=>({...row})),
    events:[...(state?.events||[]),...cancelledEvents],
    nextEventSequence:startSequence+cancelledEvents.length,
  };
}

function event(type,state,car,command,payload={}){
  return {
    type,
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    timeMs:Math.max(0,finite(state?.simulationTimeMs,0)),
    carIds:[car?.carId].filter(Boolean),
    driverIds:[car?.driverId].filter(Boolean),
    payload:{
      commandId:command?.id??null,
      commandSequence:command?.sequence??null,
      commandType:command?.type??null,
      source:command?.source??null,
      ...payload,
    },
  };
}

function applyPace(car,command){
  const paceMode=text(command?.payload?.paceMode).toLowerCase();
  if(!Object.hasOwn(RACE_PACE_MODES,paceMode))return null;
  return {
    car:{
      ...car,
      resources:{
        ...(car?.resources||{}),
        paceMode,
      },
    },
    payload:{paceMode},
  };
}

function applyPit(state,car,command){
  if(car?.pitState?.active)return null;
  const plannedStopLap=nextReachablePitLap(state,car);
  if(plannedStopLap==null)return null;

  const tyreChange=Boolean(command?.payload?.tyreChange);
  const tyreId=tyreChange?text(command?.payload?.tyreId):null;
  if(tyreChange&&!tyreAvailable(car,tyreId))return null;

  const explicitRefuel=command?.payload?.refuel;
  const refuelRequested=explicitRefuel===null||explicitRefuel===undefined
    ?Boolean(car?.resources?.strategy?.refuelRequested)
    :Boolean(explicitRefuel&&car?.resources?.refuellingDeferred);
  const repairComponents=Array.isArray(command?.payload?.repairComponents)
    ?[...command.payload.repairComponents]
    :[];

  return {
    car:{
      ...car,
      resources:{
        ...(car?.resources||{}),
        strategy:{
          ...(car?.resources?.strategy||{}),
          nextTyreId:tyreChange?tyreId:car?.resources?.strategy?.nextTyreId??null,
          tyreChangeRequested:tyreChange,
          refuelRequested,
          repairComponentsRequested:repairComponents,
          pitPlan:"command",
          plannedStopLap,
        },
      },
    },
    payload:{
      plannedStopLap,
      tyreId:tyreChange?tyreId:null,
      tyreChange,
      refuel:refuelRequested,
      repairComponents,
    },
  };
}

export function applyDueRaceCommands(state){
  const queue=(state?.commandQueue||[])
    .map((row)=>({...row,payload:row?.payload?{...row.payload}:row?.payload}))
    .sort((a,b)=>
      finite(a?.effectiveAtTick,0)-finite(b?.effectiveAtTick,0)||
      finite(a?.sequence,0)-finite(b?.sequence,0)
    );
  const currentTick=Math.max(0,Math.floor(finite(state?.tick,0)));
  const due=queue.filter((row)=>finite(row?.effectiveAtTick,Infinity)<=currentTick);
  const pending=queue.filter((row)=>finite(row?.effectiveAtTick,Infinity)>currentTick);
  let cars=(state?.cars||[]).map((car)=>({...car}));
  const events=[];

  for(const command of due){
    const index=cars.findIndex((car)=>text(car?.driverId)===text(command?.driverId));
    const car=index>=0?cars[index]:null;
    if(!car||car?.dnf||car?.status==="dnf"||car?.status==="finished"){
      events.push(event("command_ignored",state,car,command,{reason:"car_unavailable"}));
      continue;
    }
    if(text(car?.teamId)!==text(command?.teamId)){
      events.push(event("command_ignored",state,car,command,{reason:"team_mismatch"}));
      continue;
    }

    const applied=command.type===RACE_COMMAND_TYPES.PACE
      ?applyPace(car,command)
      :command.type===RACE_COMMAND_TYPES.PIT
        ?applyPit(state,car,command)
        :null;

    if(!applied){
      events.push(event("command_ignored",state,car,command,{reason:"not_applicable"}));
      continue;
    }

    cars[index]=applied.car;
    events.push(event("command_applied",state,applied.car,command,applied.payload));
  }

  return {cars,commandQueue:pending,events};
}
