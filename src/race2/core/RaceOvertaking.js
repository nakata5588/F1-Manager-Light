// src/race2/core/RaceOvertaking.js
// RW8.6: canonical overtaking / side-by-side battle foundation for RW2.
//
// This layer never recalculates classification and never owns incident
// consequences. It only decides when traffic may become side-by-side, tracks
// the physical battle, and emits canonical events. Damage / DNF consequences
// from contact remain the responsibility of later Race Control integration.

import { hashSeed } from "../../core/random.js";
import { trackForwardGapM } from "../track/TrackModel.js";
import {
  RACE_TRAFFIC_HARD_GAP_M,
  desiredTrafficGapM,
  nearestTrafficAhead,
  raceTrafficPairKey,
} from "./RaceTraffic.js";

export const RACE_BATTLE_LATERAL_OFFSET_M=1.4;
export const RACE_OVERTAKE_ATTEMPT_RANGE_M=22;
export const RACE_OVERTAKE_DECISIVE_CLEARANCE_M=1.5;
export const RACE_BATTLE_DURATION_MS=3500;
export const RACE_BATTLE_MAX_DURATION_MS=12000;
export const RACE_BATTLE_EXTENSION_MS=1800;
export const RACE_BATTLE_RETRY_COOLDOWN_MS=5000;

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

function activeTrackCar(car){
  if(!car||car?.dnf||car?.status==="dnf"||car?.status==="finished")return false;
  return String(car?.pitState?.status??"track")==="track";
}

function driverPerformance(car){
  return car?.performance?.driver||{};
}

function carPerformance(car){
  return car?.performance?.car||{};
}

function score(value,fallback=null){
  const parsed=finite(value,null);
  if(parsed==null)return fallback;
  return clamp(parsed,0,100);
}

function overtakingDifficulty(state){
  return clamp(finite(state?.track?.traits?.overtakingDifficulty,50),0,100);
}

function overtakingTrackFactor(state){
  return clamp(1.20-overtakingDifficulty(state)*0.008,0.40,1.10);
}

function overtakingRangeFactor(state){
  return clamp(1.08-overtakingDifficulty(state)*0.0035,0.72,1.08);
}

function overtakingPerformancePotential(car,{attacker=false}={}){
  const driver=driverPerformance(car);
  const machine=carPerformance(car);
  return (
    score(machine?.race,70)*0.38+
    score(machine?.power,70)*0.24+
    score(machine?.chassis,70)*0.12+
    score(driver?.raceScore,70)*0.16+
    score(attacker?driver?.overtaking:driver?.defending,70)*0.10
  );
}

function overtakeClosingPotentialMs(state,attacker,defender){
  void state;
  const currentAttacker=Math.max(0,finite(attacker?.speedMs,finite(attacker?.speedKmh,0)/3.6));
  const currentDefender=Math.max(0,finite(defender?.speedMs,finite(defender?.speedKmh,0)/3.6));
  const currentClosing=currentAttacker-currentDefender;
  const attackerFree=finite(attacker?.freeTargetSpeedKmh,null);
  const defenderFree=finite(defender?.freeTargetSpeedKmh,null);
  const attackerSlipstreamBonus=Math.max(
    0,
    finite(attacker?.traffic?.slipstreamTargetBonusKmh,0)
  );
  const defenderSlipstreamBonus=Math.max(
    0,
    finite(defender?.traffic?.slipstreamTargetBonusKmh,0)
  );
  const attackerAssisted=attackerFree==null?null:attackerFree+attackerSlipstreamBonus;
  const defenderAssisted=defenderFree==null?null:defenderFree+defenderSlipstreamBonus;
  const hasFreeTelemetry=
    attackerAssisted!=null&&attackerAssisted>0&&
    defenderAssisted!=null&&defenderAssisted>0;
  const freeClosing=hasFreeTelemetry
    ?(attackerAssisted-defenderAssisted)/3.6
    :null;
  const performanceDelta=
    overtakingPerformancePotential(attacker,{attacker:true})-
    overtakingPerformancePotential(defender,{attacker:false});
  const performanceClosing=performanceDelta*0.085;
  return Math.max(
    currentClosing,
    freeClosing==null?performanceClosing:freeClosing
  );
}

function battleDurationMs(state,gapM,closingPotentialMs){
  void state;
  const requiredGain=Math.max(0.5,Math.max(0,finite(gapM,0))+0.5);
  const usableClosing=Math.max(0.75,finite(closingPotentialMs,0));
  const estimatedMs=(requiredGain/usableClosing)*1000;
  return Math.round(clamp(
    estimatedMs*1.20+1500,
    RACE_BATTLE_DURATION_MS,
    RACE_BATTLE_MAX_DURATION_MS
  ));
}

function deterministicUnit(state,key){
  const seed=String(state?.seed??"rw2");
  return hashSeed(`${seed}::rw8.6::${String(key)}`)/4294967296;
}

function carById(cars,id){
  return (cars||[]).find((car)=>String(car?.carId??"")===String(id??""))??null;
}

function physicalClearanceM(state,attacker,defender){
  const length=Math.max(0,finite(state?.track?.lengthM,0));
  if(length<=0)return 0;
  const forward=trackForwardGapM(
    state?.track,
    finite(attacker?.distanceAlongLapM,0),
    finite(defender?.distanceAlongLapM,0)
  );
  if(forward==null)return 0;
  if(Math.abs(forward)<=1e-9)return 0;
  return forward>length/2
    ?length-forward
    :-forward;
}

function setCar(cars,next){
  const index=(cars||[]).findIndex((car)=>String(car?.carId??"")===String(next?.carId??""));
  if(index<0)return cars;
  const out=[...cars];
  out[index]=next;
  return out;
}

function clearBattle(car,{result=null,cooldownUntilMs=null}={}){
  const previous=car?.battle||{};
  return {
    ...car,
    lateralOffsetM:0,
    battle:{
      phase:"none",
      opponentCarId:null,
      role:null,
      side:0,
      attemptId:null,
      startedTick:null,
      startedAtMs:null,
      expiresAtMs:null,
      contactRiskPct:null,
      result:result??previous?.result??null,
      cooldownUntilMs:cooldownUntilMs??finite(previous?.cooldownUntilMs,0),
    },
  };
}

function withYieldingBattle(car,{opponentCarId,role,side,result,cooldownUntilMs}){
  return {
    ...car,
    lateralOffsetM:Number((side*RACE_BATTLE_LATERAL_OFFSET_M).toFixed(3)),
    battle:{
      ...(car?.battle||{}),
      phase:"yielding",
      opponentCarId,
      role,
      side,
      contactRiskPct:null,
      result,
      cooldownUntilMs,
    },
  };
}

function withBattle(car,{
  opponentCarId,
  role,
  side,
  attemptId,
  startedTick,
  startedAtMs,
  expiresAtMs,
  contactRiskPct=null,
}){
  return {
    ...car,
    lateralOffsetM:Number((side*RACE_BATTLE_LATERAL_OFFSET_M).toFixed(3)),
    battle:{
      phase:"side_by_side",
      opponentCarId,
      role,
      side,
      attemptId,
      startedTick,
      startedAtMs,
      expiresAtMs,
      contactRiskPct,
      result:null,
      cooldownUntilMs:finite(car?.battle?.cooldownUntilMs,0),
    },
  };
}

function eventDescriptor(type,state,attacker,defender,payload={}){
  return {
    type,
    tick:Math.max(0,Math.floor(finite(state?.tick,0))),
    timeMs:Math.max(0,finite(state?.simulationTimeMs,0)),
    carIds:[attacker?.carId,defender?.carId].filter(Boolean),
    driverIds:[attacker?.driverId,defender?.driverId].filter(Boolean),
    payload,
  };
}

export function initialBattleState(){
  return {
    phase:"none",
    opponentCarId:null,
    role:null,
    side:0,
    attemptId:null,
    startedTick:null,
    startedAtMs:null,
    expiresAtMs:null,
    contactRiskPct:null,
    result:null,
    cooldownUntilMs:0,
  };
}

export function overtakeAttemptProbability(state,attacker,defender,{gapM=null,closingSpeedMs=null}={}){
  const overtaking=score(driverPerformance(attacker)?.overtaking,null);
  const defending=score(driverPerformance(defender)?.defending,null);
  if(overtaking==null||defending==null)return 0;

  const attackerRace=score(carPerformance(attacker)?.race,70);
  const defenderRace=score(carPerformance(defender)?.race,70);
  const attackerPower=score(carPerformance(attacker)?.power,70);
  const defenderPower=score(carPerformance(defender)?.power,70);
  const attackerDriverRace=score(driverPerformance(attacker)?.raceScore,70);
  const defenderDriverRace=score(driverPerformance(defender)?.raceScore,70);

  const attackerSpeed=Math.max(0,finite(attacker?.speedMs,finite(attacker?.speedKmh,0)/3.6));
  const defenderSpeed=Math.max(0,finite(defender?.speedMs,finite(defender?.speedKmh,0)/3.6));
  const closingSpeed=finite(closingSpeedMs,attackerSpeed-defenderSpeed);
  const cornerSeverity=Math.max(
    clamp(attacker?.effectiveCornerSeverity,0,1),
    clamp(defender?.effectiveCornerSeverity,0,1)
  );
  const physicalGap=Math.max(0,finite(gapM,RACE_OVERTAKE_ATTEMPT_RANGE_M));

  const attack=
    overtaking*0.50+
    attackerDriverRace*0.15+
    attackerRace*0.20+
    attackerPower*0.15;
  const defense=
    defending*0.55+
    defenderDriverRace*0.15+
    defenderRace*0.20+
    score(carPerformance(defender)?.chassis,70)*0.10;

  const gapFactor=clamp(
    (RACE_OVERTAKE_ATTEMPT_RANGE_M-physicalGap)/RACE_OVERTAKE_ATTEMPT_RANGE_M,
    0,
    1
  );
  const closingBonus=clamp(closingSpeed/20,-0.15,0.25);
  const scoreDelta=(attack-defense)/110;
  const cornerPenalty=cornerSeverity*0.30;

  const baseProbability=clamp(
    0.34+gapFactor*0.20+closingBonus+scoreDelta-cornerPenalty,
    0.04,
    0.94
  );
  return round(
    clamp(baseProbability*overtakingTrackFactor(state),0.02,0.94),
    6
  );
}

export function battleContactProbability(state,attacker,defender,{stepMs=100}={}){
  const mistakeA=score(driverPerformance(attacker)?.mistakePropensity,35);
  const mistakeD=score(driverPerformance(defender)?.mistakePropensity,35);
  const aggressionA=score(driverPerformance(attacker)?.aggression,50);
  const aggressionD=score(driverPerformance(defender)?.aggression,50);
  const cornerSeverity=Math.max(
    clamp(attacker?.effectiveCornerSeverity,0,1),
    clamp(defender?.effectiveCornerSeverity,0,1)
  );

  const mistakeRisk=((mistakeA+mistakeD)/200)*0.012;
  const aggressionRisk=(
    Math.max(0,aggressionA-65)+
    Math.max(0,aggressionD-65)
  )/70*0.010;
  const cornerRisk=cornerSeverity*0.012;
  const perSecond=clamp(0.0015+mistakeRisk+aggressionRisk+cornerRisk,0.001,0.055);
  const dt=Math.max(0.01,finite(stepMs,100)/1000);
  return round(1-Math.pow(1-perSecond,dt),8);
}

function attemptOpportunity(state,attacker,occupied){
  if(!activeTrackCar(attacker))return null;
  if(attacker?.battle?.phase&&attacker.battle.phase!=="none")return null;
  if(finite(attacker?.battle?.cooldownUntilMs,0)>finite(state?.simulationTimeMs,0))return null;
  if(occupied.has(String(attacker?.carId??"")))return null;

  const speedMs=Math.max(0,finite(attacker?.speedMs,finite(attacker?.speedKmh,0)/3.6));
  if(speedMs<20)return null;

  const nearest=nearestTrafficAhead(state,attacker,{ignoreBattleOpponent:false});
  if(!nearest?.car)return null;
  const defender=nearest.car;
  if(!activeTrackCar(defender))return null;
  if(defender?.battle?.phase&&defender.battle.phase!=="none")return null;
  if(occupied.has(String(defender?.carId??"")))return null;

  const gapM=Math.max(0,finite(nearest?.gapM,Infinity));
  const baseAttemptRange=Math.max(
    RACE_OVERTAKE_ATTEMPT_RANGE_M,
    finite(desiredTrafficGapM(attacker),RACE_TRAFFIC_HARD_GAP_M)+8
  );
  const trackAttemptRange=baseAttemptRange*overtakingRangeFactor(state);
  const closingPotentialMs=overtakeClosingPotentialMs(state,attacker,defender);
  if(closingPotentialMs<0.75)return null;
  const physicallyReachableRange=Math.max(
    0,
    closingPotentialMs*(RACE_BATTLE_MAX_DURATION_MS/1000)*0.82
  );
  const attemptRange=Math.min(trackAttemptRange,physicallyReachableRange);
  if(gapM>attemptRange)return null;

  const cornerSeverity=Math.max(
    clamp(attacker?.effectiveCornerSeverity,0,1),
    clamp(defender?.effectiveCornerSeverity,0,1)
  );
  if(cornerSeverity>0.72)return null;

  const probability=overtakeAttemptProbability(state,attacker,defender,{
    gapM,
    closingSpeedMs:closingPotentialMs,
  });
  if(probability<=0)return null;

  const bucket=Math.floor(Math.max(0,finite(state?.simulationTimeMs,0))/1000);
  const roll=deterministicUnit(
    state,
    `attempt:${bucket}:${attacker?.carId}:${defender?.carId}`
  );
  if(roll>=probability)return null;

  return {
    defender,
    gapM,
    probability,
    roll,
    closingPotentialMs,
    attemptRangeM:attemptRange,
    trackDifficulty:overtakingDifficulty(state),
  };
}

function resolveYieldingBattles(state,proposedCars){
  let cars=[...(proposedCars||[])];

  for(const previousAttacker of state?.cars||[]){
    if(previousAttacker?.battle?.phase!=="yielding"||previousAttacker?.battle?.role!=="attacker")continue;
    const previousDefender=carById(state?.cars,previousAttacker?.battle?.opponentCarId);
    let attacker=carById(cars,previousAttacker?.carId);
    let defender=carById(cars,previousAttacker?.battle?.opponentCarId);
    if(!attacker||!defender||!previousDefender)continue;

    if(!activeTrackCar(previousDefender)||defender?.dnf||defender?.status==="dnf"){
      cars=setCar(cars,clearBattle(attacker,{result:previousAttacker?.battle?.result}));
      continue;
    }

    const attackerClearance=physicalClearanceM(state,attacker,defender);
    const defenderClearance=-attackerClearance;
    const completedPass=previousAttacker?.battle?.result==="completed";
    const restoredGap=completedPass
      ?attackerClearance>=RACE_TRAFFIC_HARD_GAP_M-1e-9
      :defenderClearance>=RACE_TRAFFIC_HARD_GAP_M-1e-9;

    if(restoredGap){
      attacker=clearBattle(attacker,{
        result:previousAttacker?.battle?.result,
        cooldownUntilMs:previousAttacker?.battle?.cooldownUntilMs,
      });
      defender=clearBattle(defender,{
        result:previousDefender?.battle?.result,
        cooldownUntilMs:previousDefender?.battle?.cooldownUntilMs,
      });
    }else{
      attacker=withYieldingBattle(attacker,{
        opponentCarId:defender?.carId,
        role:"attacker",
        side:Number(previousAttacker?.battle?.side)||1,
        result:previousAttacker?.battle?.result,
        cooldownUntilMs:previousAttacker?.battle?.cooldownUntilMs,
      });
      defender=withYieldingBattle(defender,{
        opponentCarId:attacker?.carId,
        role:"defender",
        side:Number(previousDefender?.battle?.side)||-1,
        result:previousDefender?.battle?.result,
        cooldownUntilMs:previousDefender?.battle?.cooldownUntilMs,
      });
    }
    cars=setCar(setCar(cars,attacker),defender);
  }

  return cars;
}

function resolveExistingBattles(state,proposedCars,{stepMs}){
  let cars=[...(proposedCars||[])];
  const events=[];
  const bypassPairs=new Set();
  const handledAttempts=new Set();
  const nextTime=Math.max(0,finite(state?.simulationTimeMs,0))+Math.max(0,finite(stepMs,100));

  for(const previousAttacker of state?.cars||[]){
    const previousBattle=previousAttacker?.battle;
    if(previousBattle?.phase!=="side_by_side"||previousBattle?.role!=="attacker")continue;
    const attemptId=String(previousBattle?.attemptId??"");
    if(!attemptId||handledAttempts.has(attemptId))continue;
    handledAttempts.add(attemptId);

    const previousDefender=carById(state?.cars,previousBattle?.opponentCarId);
    let attacker=carById(cars,previousAttacker?.carId);
    let defender=carById(cars,previousBattle?.opponentCarId);
    if(!attacker||!defender||!previousDefender)continue;

    const pairKey=raceTrafficPairKey(attacker,defender);
    const cooldownUntilMs=nextTime+RACE_BATTLE_RETRY_COOLDOWN_MS;

    if(!activeTrackCar(previousDefender)||defender?.dnf||defender?.status==="dnf"){
      attacker=clearBattle(attacker,{result:"aborted",cooldownUntilMs});
      defender=clearBattle(defender,{result:"aborted",cooldownUntilMs});
      cars=setCar(setCar(cars,attacker),defender);
      events.push(eventDescriptor("overtake_aborted",state,attacker,defender,{
        attemptId,
        reason:"opponent_unavailable",
      }));
      continue;
    }

    const contactProbability=battleContactProbability(state,previousAttacker,previousDefender,{stepMs});
    const contactRoll=deterministicUnit(state,`contact:${attemptId}:${state?.tick}`);
    if(contactRoll<contactProbability){
      attacker=withYieldingBattle(attacker,{
        opponentCarId:defender?.carId,
        role:"attacker",
        side:Number(previousBattle?.side)||1,
        result:"contact",
        cooldownUntilMs,
      });
      defender=withYieldingBattle(defender,{
        opponentCarId:attacker?.carId,
        role:"defender",
        side:-(Number(previousBattle?.side)||1),
        result:"contact",
        cooldownUntilMs,
      });
      cars=setCar(setCar(cars,attacker),defender);
      events.push(eventDescriptor("contact",state,attacker,defender,{
        attemptId,
        severity:"minor",
        responsibility:"racing_incident",
        probability:contactProbability,
        roll:round(contactRoll,8),
      }));
      continue;
    }

    const clearance=physicalClearanceM(state,attacker,defender);

    if(clearance>=RACE_OVERTAKE_DECISIVE_CLEARANCE_M-1e-9){
      const fullyClear=clearance>=RACE_TRAFFIC_HARD_GAP_M-1e-9;
      if(fullyClear){
        attacker=clearBattle(attacker,{result:"completed",cooldownUntilMs:nextTime+500});
        defender=clearBattle(defender,{result:"lost",cooldownUntilMs:nextTime+500});
      }else{
        attacker=withYieldingBattle(attacker,{
          opponentCarId:defender?.carId,
          role:"attacker",
          side:Number(previousBattle?.side)||1,
          result:"completed",
          cooldownUntilMs:nextTime+500,
        });
        defender=withYieldingBattle(defender,{
          opponentCarId:attacker?.carId,
          role:"defender",
          side:-(Number(previousBattle?.side)||1),
          result:"lost",
          cooldownUntilMs:nextTime+500,
        });
      }
      // Traffic spacing is still based on the pre-step road order. Once this
      // pass is physically decisive, exclude the pair for the remainder of
      // the current step so stale ordering cannot pull the attacker backwards.
      // The next canonical step observes the new physical road order normally.
      bypassPairs.add(pairKey);
      cars=setCar(setCar(cars,attacker),defender);
      events.push(eventDescriptor("overtake_completed",state,attacker,defender,{
        attemptId,
        clearanceM:round(clearance,6),
        fullyClear,
      }));
      continue;
    }

    const expired=nextTime>=finite(previousBattle?.expiresAtMs,nextTime);
    const defenderClearance=-clearance;
    if(expired&&clearance>=0){
      const extendedExpiry=nextTime+RACE_BATTLE_EXTENSION_MS;
      const side=Number(previousBattle?.side)||1;
      const contactRiskPct=round(contactProbability*100,5);
      attacker=withBattle(attacker,{
        opponentCarId:defender?.carId,
        role:"attacker",
        side,
        attemptId,
        startedTick:previousBattle?.startedTick,
        startedAtMs:previousBattle?.startedAtMs,
        expiresAtMs:extendedExpiry,
        contactRiskPct,
      });
      defender=withBattle(defender,{
        opponentCarId:attacker?.carId,
        role:"defender",
        side:-side,
        attemptId,
        startedTick:previousBattle?.startedTick,
        startedAtMs:previousBattle?.startedAtMs,
        expiresAtMs:extendedExpiry,
        contactRiskPct,
      });
      cars=setCar(setCar(cars,attacker),defender);
      bypassPairs.add(pairKey);
      continue;
    }
    if(expired||defenderClearance>=RACE_OVERTAKE_ATTEMPT_RANGE_M){
      attacker=withYieldingBattle(attacker,{
        opponentCarId:defender?.carId,
        role:"attacker",
        side:Number(previousBattle?.side)||1,
        result:"failed",
        cooldownUntilMs,
      });
      defender=withYieldingBattle(defender,{
        opponentCarId:attacker?.carId,
        role:"defender",
        side:-(Number(previousBattle?.side)||1),
        result:"defended",
        cooldownUntilMs,
      });
      cars=setCar(setCar(cars,attacker),defender);
      events.push(eventDescriptor("overtake_failed",state,attacker,defender,{
        attemptId,
        reason:expired?"timeout":"defender_clear",
      }));
      continue;
    }

    const side=Number(previousBattle?.side)||1;
    const contactRiskPct=round(contactProbability*100,5);
    attacker=withBattle(attacker,{
      opponentCarId:defender?.carId,
      role:"attacker",
      side,
      attemptId,
      startedTick:previousBattle?.startedTick,
      startedAtMs:previousBattle?.startedAtMs,
      expiresAtMs:previousBattle?.expiresAtMs,
      contactRiskPct,
    });
    defender=withBattle(defender,{
      opponentCarId:attacker?.carId,
      role:"defender",
      side:-side,
      attemptId,
      startedTick:previousBattle?.startedTick,
      startedAtMs:previousBattle?.startedAtMs,
      expiresAtMs:previousBattle?.expiresAtMs,
      contactRiskPct,
    });
    cars=setCar(setCar(cars,attacker),defender);
    bypassPairs.add(pairKey);
  }

  return {cars,events,bypassPairs};
}

function startNewBattles(state,proposedCars,existingBypass,{stepMs=100,blockedPairs=null}={}){
  let cars=[...(proposedCars||[])];
  const events=[];
  const bypassPairs=new Set(existingBypass||[]);
  const blocked=blockedPairs instanceof Set?blockedPairs:new Set(blockedPairs||[]);
  const occupied=new Set();

  for(const pair of blocked){
    for(const carId of String(pair||"").split("|")){
      if(carId)occupied.add(carId);
    }
  }

  for(const car of cars){
    if(car?.battle?.phase&&car.battle.phase!=="none"){
      occupied.add(String(car?.carId??""));
      if(car?.battle?.opponentCarId)occupied.add(String(car.battle.opponentCarId));
    }
  }

  const sorted=[...(state?.cars||[])].sort((a,b)=>{
    const distance=finite(b?.absoluteDistanceM,0)-finite(a?.absoluteDistanceM,0);
    if(distance!==0)return distance;
    return String(a?.carId??"").localeCompare(String(b?.carId??""));
  });

  for(const previousAttacker of sorted){
    const opportunity=attemptOpportunity(state,previousAttacker,occupied);
    if(!opportunity)continue;

    let attacker=carById(cars,previousAttacker?.carId);
    let defender=carById(cars,opportunity.defender?.carId);
    if(!attacker||!defender)continue;

    const now=Math.max(0,finite(state?.simulationTimeMs,0));
    const attemptId=[
      state?.weekendKey??"race",
      state?.tick??0,
      attacker?.carId,
      defender?.carId,
    ].join(":");
    const side=deterministicUnit(state,`side:${attemptId}`)<0.5?-1:1;
    const durationMs=battleDurationMs(
      state,
      opportunity.gapM,
      opportunity.closingPotentialMs
    );
    const expiresAtMs=now+durationMs;
    const contactRiskPct=round(
      battleContactProbability(state,previousAttacker,opportunity.defender,{stepMs})*100,
      5
    );

    attacker=withBattle(attacker,{
      opponentCarId:defender?.carId,
      role:"attacker",
      side,
      attemptId,
      startedTick:state?.tick,
      startedAtMs:now,
      expiresAtMs,
      contactRiskPct,
    });
    defender=withBattle(defender,{
      opponentCarId:attacker?.carId,
      role:"defender",
      side:-side,
      attemptId,
      startedTick:state?.tick,
      startedAtMs:now,
      expiresAtMs,
      contactRiskPct,
    });

    cars=setCar(setCar(cars,attacker),defender);
    occupied.add(String(attacker?.carId??""));
    occupied.add(String(defender?.carId??""));
    events.push(eventDescriptor("overtake_started",state,attacker,defender,{
      attemptId,
      gapM:round(opportunity.gapM,6),
      probability:opportunity.probability,
      roll:round(opportunity.roll,8),
      side,
      durationMs,
      closingPotentialMs:round(opportunity.closingPotentialMs,6),
      attemptRangeM:round(opportunity.attemptRangeM,6),
      trackDifficulty:round(opportunity.trackDifficulty,3),
    }));

    // The first battle tick keeps RW8.5's longitudinal hard gap. From the
    // following tick the active battle itself authorizes side-by-side overlap.
  }

  return {cars,events,bypassPairs};
}

export function resolveRaceOvertaking(state,proposedCars,{stepMs=100,blockedPairs=null}={}){
  const yieldingCars=resolveYieldingBattles(state,proposedCars);
  const existing=resolveExistingBattles(state,yieldingCars,{stepMs});
  const started=startNewBattles(state,existing.cars,existing.bypassPairs,{stepMs,blockedPairs});
  return {
    cars:started.cars,
    events:[...existing.events,...started.events],
    bypassPairs:started.bypassPairs,
  };
}
