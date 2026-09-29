// src/race2/core/RaceIncidents.js
// RW8.10: canonical incidents, reliability failures, damage and DNF consequences.
//
// Incident probabilities are snapshotted at the GameState boundary from the
// existing shared reliability / accident models. This layer owns only when a
// detached RaceState incident fires and how its consequence is persisted.
// Physical damage remains owned by CarDamageEngine.

import { hashSeed } from "../../core/random.js";
import { selectMechanicalFailureReason } from "../../domain/carReliability.js";
import { damageFromIncident, mergeDamageStates } from "../../engine/CarDamageEngine.js";
import { initialBattleState } from "./RaceOvertaking.js";
import { initialTrafficState } from "./RaceTraffic.js";

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,finite(value,min)));
const round=(value,digits=6)=>{
  const parsed=finite(value,null);
  return parsed==null?null:Number(parsed.toFixed(digits));
};
const text=(value)=>String(value??"");

function deterministicUnit(state,key){
  const seed=text(state?.seed)||"rw2";
  return hashSeed(`${seed}::rw8.10::${text(key)}`)/4294967296;
}

function activeCar(car){
  return Boolean(car&&!car?.dnf&&car?.status!=="dnf"&&car?.status!=="finished");
}

function raceDistanceM(state){
  const length=Math.max(1,finite(state?.track?.lengthM,1));
  const laps=Math.max(1,Math.round(finite(state?.session?.lapLimit,state?.track?.laps??1)));
  return length*laps;
}

function movedFraction(state,previous,next){
  if(!previous||!next)return 0;
  if(String(next?.pitState?.status??"track")!=="track")return 0;
  const delta=Math.max(0,finite(next?.absoluteDistanceM,0)-finite(previous?.absoluteDistanceM,0));
  return clamp(delta/Math.max(1,raceDistanceM(state)),0,1);
}

export function raceIncidentHazardProbability(totalRaceChance,distanceFraction){
  const total=clamp(totalRaceChance,0,1);
  const fraction=clamp(distanceFraction,0,1);
  if(total<=0||fraction<=0)return 0;
  if(total>=1)return 1;
  return 1-Math.pow(1-total,fraction);
}

function eventDescriptor(type,state,car,payload={}){
  return {
    type,
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    timeMs:Math.max(0,finite(state?.simulationTimeMs,0)),
    carIds:[car?.carId].filter(Boolean),
    driverIds:[car?.driverId].filter(Boolean),
    payload,
  };
}

function carById(cars,id){
  return (cars||[]).find((car)=>text(car?.carId)===text(id))??null;
}

function replaceCar(cars,next){
  const index=(cars||[]).findIndex((car)=>text(car?.carId)===text(next?.carId));
  if(index<0)return cars;
  const out=[...cars];
  out[index]=next;
  return out;
}

function clearBattle(car){
  if(!car)return car;
  return {...car,lateralOffsetM:0,battle:initialBattleState()};
}

function clearBattlePair(cars,ids=[]){
  const wanted=new Set((ids||[]).map(text).filter(Boolean));
  if(!wanted.size)return cars;
  return (cars||[]).map((car)=>{
    const own=text(car?.carId);
    const opponent=text(car?.battle?.opponentCarId);
    return wanted.has(own)||wanted.has(opponent)?clearBattle(car):car;
  });
}

function retireCar(car,state,{kind,reason,source=null}={}){
  return {
    ...clearBattle(car),
    dnf:true,
    status:"dnf",
    speedMs:0,
    speedKmh:0,
    accelerationMs2:0,
    targetSpeedKmh:0,
    traffic:initialTrafficState(),
    retirement:{
      kind:text(kind)||"incident",
      reason:text(reason)||"Retired",
      source:source??null,
      tick:Math.max(0,Math.floor(finite(state?.tick,0))),
      timeMs:Math.max(0,finite(state?.simulationTimeMs,0)),
    },
  };
}

function incidentRolls(state,key){
  return {
    componentRolls:Array.from({length:6},(_,index)=>
      deterministicUnit(state,`${key}:component:${index}`)
    ),
    impactRoll:deterministicUnit(state,`${key}:impact`),
    retirementRoll:deterministicUnit(state,`${key}:retirement`),
  };
}

function applyDamage(car,state,{
  kind,
  severityScore,
  source,
  key,
  speedRetention=0.45,
}={}){
  const incidentDamage=damageFromIncident({
    kind,
    severityScore,
    ...incidentRolls(state,key),
    retirementProbabilityOverride:finite(
      car?.reliability?.accidentConditionalRetirementChance,
      null
    ),
  });
  if(!incidentDamage)return {car,damage:null,retired:false};

  const cumulative=car?.damage
    ?mergeDamageStates([car.damage,incidentDamage])
    :incidentDamage;
  const retired=Boolean(incidentDamage?.retirement_required||cumulative?.can_continue===false);
  const currentSpeed=Math.max(0,finite(car?.speedMs,finite(car?.speedKmh,0)/3.6));
  const retained=currentSpeed*clamp(speedRetention,0,1);
  const next=retired
    ?retireCar({...car,damage:cumulative},state,{
      kind,
      reason:kind==="collision"?"Collision":"Accident",
      source,
    })
    :{
      ...car,
      damage:cumulative,
      speedMs:round(retained,6),
      speedKmh:round(retained*3.6,6),
      accelerationMs2:0,
    };
  return {car:next,damage:incidentDamage,retired};
}

function contactSeverityScore(state,a,b,event){
  const speedA=Math.max(0,finite(a?.speedMs,finite(a?.speedKmh,0)/3.6));
  const speedB=Math.max(0,finite(b?.speedMs,finite(b?.speedKmh,0)/3.6));
  const relative=clamp(Math.abs(speedA-speedB)/45,0,1);
  const corner=Math.max(
    clamp(a?.effectiveCornerSeverity,0,1),
    clamp(b?.effectiveCornerSeverity,0,1)
  );
  const attempt=text(event?.payload?.attemptId)||`${a?.carId}:${b?.carId}:${state?.tick}`;
  const jitter=(deterministicUnit(state,`contact-severity:${attempt}`)-0.5)*0.16;
  return clamp(0.16+relative*0.34+corner*0.28+jitter,0.08,0.92);
}

function applyContactEvents(state,cars,sourceEvents){
  let next=[...(cars||[])];
  const events=[];

  for(const sourceEvent of sourceEvents||[]){
    if(sourceEvent?.type!=="contact")continue;
    const ids=(sourceEvent?.carIds||[]).map(text).filter(Boolean).slice(0,2);
    if(ids.length<2)continue;
    const first=carById(next,ids[0]);
    const second=carById(next,ids[1]);
    if(!first||!second)continue;

    const baseSeverity=contactSeverityScore(state,first,second,sourceEvent);
    for(const id of ids){
      const current=carById(next,id);
      if(!activeCar(current))continue;
      const variation=0.88+deterministicUnit(
        state,
        `contact-side:${sourceEvent?.payload?.attemptId??state?.tick}:${id}`
      )*0.24;
      const severityScore=clamp(baseSeverity*variation,0.06,0.96);
      const consequence=applyDamage(current,state,{
        kind:"collision",
        severityScore,
        source:"contact",
        key:`contact:${sourceEvent?.payload?.attemptId??state?.tick}:${id}`,
        speedRetention:0.58-severityScore*0.22,
      });
      next=replaceCar(next,consequence.car);
      if(!consequence.damage)continue;

      events.push(eventDescriptor("damage",state,consequence.car,{
        source:"contact",
        sourceAttemptId:sourceEvent?.payload?.attemptId??null,
        severity:severityLabel(severityScore),
        severityScore:round(severityScore,4),
        damage:consequence.damage,
      }));
      if(consequence.retired){
        events.push(eventDescriptor("retirement",state,consequence.car,{
          kind:"collision",
          reason:"Collision",
          source:"contact",
        }));
      }
    }
    if(ids.some((id)=>carById(next,id)?.dnf))next=clearBattlePair(next,ids);
  }

  return {cars:next,events};
}

function priorEventForCar(state,carId,type){
  const id=text(carId);
  return (state?.events||[]).some((event)=>
    event?.type===type&&(event?.carIds||[]).some((value)=>text(value)===id)
  );
}

function severityLabel(score){
  const value=clamp(score,0,1);
  if(value>=0.94)return "critical";
  if(value>=0.78)return "high";
  if(value>=0.50)return "medium";
  return "low";
}

function applyMechanicalFailures(state,cars){
  let next=[...(cars||[])];
  const events=[];
  const previousById=new Map((state?.cars||[]).map((car)=>[text(car?.carId),car]));

  for(const candidate of [...next]){
    const car=carById(next,candidate?.carId);
    if(!activeCar(car)||priorEventForCar(state,car?.carId,"mechanical_failure"))continue;
    const fraction=movedFraction(state,previousById.get(text(car?.carId)),car);
    if(fraction<=0)continue;

    const totalChance=clamp(car?.reliability?.mechanicalFailureChance,0,1);
    const probability=raceIncidentHazardProbability(totalChance,fraction);
    const roll=deterministicUnit(state,`mechanical:${car?.carId}:${state?.tick}`);
    if(roll>=probability)continue;

    const profile=car?.reliability?.profile||{};
    const failure=selectMechanicalFailureReason(
      profile,
      deterministicUnit(state,`mechanical-reason:${car?.carId}:${state?.tick}`)
    );
    const retired=retireCar(car,state,{
      kind:"mechanical",
      reason:failure?.reason||"Mechanical",
      source:"reliability",
    });
    next=clearBattlePair(replaceCar(next,retired),[car?.carId]);

    events.push(eventDescriptor("mechanical_failure",state,retired,{
      reason:failure?.reason||"Mechanical",
      slot:failure?.slot??null,
      probability:round(probability,8),
      roll:round(roll,8),
      reliabilityPct:finite(profile?.reliability_pct,null),
      reliabilitySource:profile?.source??null,
    }));
    events.push(eventDescriptor("retirement",state,retired,{
      kind:"mechanical",
      reason:failure?.reason||"Mechanical",
      source:"reliability",
    }));
  }
  return {cars:next,events};
}

function applySoloAccidents(state,cars){
  let next=[...(cars||[])];
  const events=[];
  const previousById=new Map((state?.cars||[]).map((car)=>[text(car?.carId),car]));

  for(const candidate of [...next]){
    const car=carById(next,candidate?.carId);
    if(!activeCar(car)||priorEventForCar(state,car?.carId,"accident"))continue;
    const fraction=movedFraction(state,previousById.get(text(car?.carId)),car);
    if(fraction<=0)continue;

    const totalChance=clamp(car?.reliability?.accidentIncidentChance,0,1);
    const probability=raceIncidentHazardProbability(totalChance,fraction);
    const roll=deterministicUnit(state,`accident:${car?.carId}:${state?.tick}`);
    if(roll>=probability)continue;

    const corner=clamp(car?.effectiveCornerSeverity,0,1);
    const severityRoll=deterministicUnit(state,`accident-severity:${car?.carId}:${state?.tick}`);
    const severityScore=clamp(0.10+severityRoll*0.74+corner*0.12,0.08,0.96);
    const consequence=applyDamage(car,state,{
      kind:"accident",
      severityScore,
      source:"solo_accident",
      key:`accident-damage:${car?.carId}:${state?.tick}`,
      speedRetention:Math.max(0.08,0.34-severityScore*0.20),
    });
    next=clearBattlePair(replaceCar(next,consequence.car),[car?.carId]);

    events.push(eventDescriptor("accident",state,consequence.car,{
      severity:severityLabel(severityScore),
      severityScore:round(severityScore,4),
      probability:round(probability,8),
      roll:round(roll,8),
      retirement:Boolean(consequence.retired),
    }));
    if(consequence.damage){
      events.push(eventDescriptor("damage",state,consequence.car,{
        source:"solo_accident",
        severity:severityLabel(severityScore),
        severityScore:round(severityScore,4),
        damage:consequence.damage,
      }));
    }
    if(consequence.retired){
      events.push(eventDescriptor("retirement",state,consequence.car,{
        kind:"accident",
        reason:"Accident",
        source:"solo_accident",
      }));
    }
  }
  return {cars:next,events};
}

export function resolveRaceIncidents(state,cars,sourceEvents=[],{stepMs=100}={}){
  if(!state)return {cars:[...(cars||[])],events:[]};
  const contacts=applyContactEvents(state,cars,sourceEvents);
  const mechanical=applyMechanicalFailures(state,contacts.cars);
  const accidents=applySoloAccidents(state,mechanical.cars);
  void stepMs;
  return {
    cars:accidents.cars,
    events:[...contacts.events,...mechanical.events,...accidents.events],
  };
}
