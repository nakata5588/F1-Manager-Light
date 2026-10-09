// src/race2/core/RaceOvertaking.js
// RW8.6: canonical overtaking / side-by-side battle foundation for RW2.
//
// This layer never recalculates classification and never owns incident
// consequences. It only decides when traffic may become side-by-side, tracks
// the physical battle, and emits canonical events. Damage / DNF consequences
// from contact remain the responsibility of later Race Control integration.

import { hashSeed } from "../../core/random.js";
import { trackForwardGapM } from "../track/TrackModel.js";
import { raceResourcePerformance } from "./RaceResources.js";
import {
  RACE_TRAFFIC_HARD_GAP_M,
  desiredTrafficGapM,
  nearestTrafficAhead,
  raceSlipstreamContext,
  raceTrafficPairKey,
} from "./RaceTraffic.js";

export const RACE_BATTLE_LATERAL_OFFSET_M=1.85;
export const RACE_BATTLE_APPROACH_LATERAL_OFFSET_M=1.30;
export const RACE_BATTLE_SIDE_BY_SIDE_GAP_M=7.5;
export const RACE_OVERTAKE_ATTEMPT_RANGE_M=22;
export const RACE_OVERTAKE_DECISIVE_CLEARANCE_M=1.5;
export const RACE_BATTLE_CONTACT_PROXIMITY_M=2.6;
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

function overtakeBlockedSectorSet(blockedSectors){
  return new Set((blockedSectors||[])
    .map((value)=>Math.round(finite(value,null)))
    .filter((value)=>value>=1&&value<=3));
}

function carInBlockedOvertakeSector(car,blocked){
  if(!(blocked instanceof Set)||!blocked.size)return false;
  const sector=Math.round(finite(car?.sector,null));
  return blocked.has(sector);
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

function driverRaceIntelligence(car){
  const driver=driverPerformance(car);
  return score(driver?.raceIntelligence,score(driver?.raceScore,70));
}

function driverAttackScore(car){
  const driver=driverPerformance(car);
  return (
    score(driver?.overtaking,70)*0.60+
    driverRaceIntelligence(car)*0.25+
    score(driver?.raceScore,70)*0.15
  );
}

function driverDefenseScore(car){
  const driver=driverPerformance(car);
  return (
    score(driver?.defending,70)*0.60+
    driverRaceIntelligence(car)*0.25+
    score(driver?.raceScore,70)*0.15
  );
}

function carAttackScore(car){
  const machine=carPerformance(car);
  return (
    score(machine?.power,70)*0.60+
    score(machine?.race,70)*0.40
  );
}

function carDefenseScore(car){
  const machine=carPerformance(car);
  return (
    score(machine?.chassis,70)*0.60+
    score(machine?.race,70)*0.40
  );
}

function battleAttackScore(car){
  return driverAttackScore(car)*0.65+carAttackScore(car)*0.35;
}

function battleDefenseScore(car){
  return driverDefenseScore(car)*0.65+carDefenseScore(car)*0.35;
}

function overtakingPerformancePotential(car,{attacker=false}={}){
  return attacker?battleAttackScore(car):battleDefenseScore(car);
}

export function raceBattlePerformanceMatchup(attacker,defender){
  const attackerDriverScore=driverAttackScore(attacker);
  const defenderDriverScore=driverDefenseScore(defender);
  const attackerCarScore=carAttackScore(attacker);
  const defenderCarScore=carDefenseScore(defender);
  const attackerScore=battleAttackScore(attacker);
  const defenderScore=battleDefenseScore(defender);
  return {
    attackerDriverScore:round(attackerDriverScore,3),
    defenderDriverScore:round(defenderDriverScore,3),
    driverEdge:round(attackerDriverScore-defenderDriverScore,3),
    attackerCarScore:round(attackerCarScore,3),
    defenderCarScore:round(defenderCarScore,3),
    carEdge:round(attackerCarScore-defenderCarScore,3),
    attackerScore:round(attackerScore,3),
    defenderScore:round(defenderScore,3),
    edge:round(attackerScore-defenderScore,3),
  };
}

export function raceBattlePaceMultiplier(state,car){
  const battle=car?.battle||{};
  const phase=String(battle?.phase||"none");
  if(!["approach","side_by_side"].includes(phase))return 1;
  const opponent=carById(state?.cars,battle?.opponentCarId);
  if(!opponent)return 1;

  const attacker=String(battle?.role||"")==="attacker"?car:opponent;
  const defender=String(battle?.role||"")==="attacker"?opponent:car;
  const matchup=raceBattlePerformanceMatchup(attacker,defender);
  const role=String(battle?.role||"");

  if(phase==="approach"){
    // Overtaking/defending skill must become physical before the cars are
    // already side-by-side. Only the attacker receives the narrow approach
    // modifier; the defender keeps its ordinary canonical pace rather than
    // being artificially slowed to manufacture a pass.
    if(role!=="attacker")return 1;
    return round(clamp(1+matchup.edge*0.0010,0.96,1.04),6);
  }

  const ownEdge=role==="attacker"?matchup.edge:-matchup.edge;
  return round(clamp(1+ownEdge*0.0022,0.90,1.10),6);
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
  // A new battle applies a canonical attacker-only approach pace factor.
  // Project that *same* factor while deciding whether to start the battle,
  // so equal pre-battle free targets can still yield physical racecraft closing.
  // Do not substitute a separate skill-derived speed when real telemetry exists.
  const committedApproachMultiplier=hasFreeTelemetry
    ?raceBattlePaceMultiplier(state,{
      ...attacker,
      battle:{phase:"approach",role:"attacker",opponentCarId:defender?.carId},
    })
    :1;
  const freeClosing=hasFreeTelemetry
    ?(attackerAssisted*committedApproachMultiplier-defenderAssisted)/3.6
    :null;
  const performanceDelta=
    overtakingPerformancePotential(attacker,{attacker:true})-
    overtakingPerformancePotential(defender,{attacker:false});
  const performanceClosing=performanceDelta*0.070;
  // Free targets already include driver/car pace, tyres, tyre wear, strategy,
  // damage and battle racecraft. Using the additional performance estimate as
  // a competing maximum when those targets exist can launch overtakes that the
  // actual simulation cannot physically close (RW38 diagnosis).
  // Retain the performance fallback only before valid free-speed telemetry.
  return hasFreeTelemetry
    ?Math.max(currentClosing,freeClosing)
    :Math.max(currentClosing,performanceClosing);
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

function withApproachBattle(car,{
  opponentCarId,
  role,
  side,
  attemptId,
  startedTick,
  startedAtMs,
  expiresAtMs,
  gapM=RACE_OVERTAKE_ATTEMPT_RANGE_M,
}){
  const gap=Math.max(0,finite(gapM,RACE_OVERTAKE_ATTEMPT_RANGE_M));
  const approachProgress=clamp(
    (RACE_OVERTAKE_ATTEMPT_RANGE_M-gap)/
      Math.max(1,RACE_OVERTAKE_ATTEMPT_RANGE_M-RACE_BATTLE_SIDE_BY_SIDE_GAP_M),
    0,
    1
  );
  const laneShare=role==="attacker"
    ?0.18+approachProgress*0.82
    :approachProgress*0.10;
  const direction=side;
  return {
    ...car,
    lateralOffsetM:Number((direction*RACE_BATTLE_APPROACH_LATERAL_OFFSET_M*laneShare).toFixed(3)),
    battle:{
      phase:"approach",
      opponentCarId,
      role,
      side,
      attemptId,
      startedTick,
      startedAtMs,
      expiresAtMs,
      contactRiskPct:null,
      result:null,
      cooldownUntilMs:finite(car?.battle?.cooldownUntilMs,0),
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

function paceMode(car){
  const value=String(car?.resources?.paceMode??car?.resourceSetup?.strategy?.paceMode??"balanced").toLowerCase();
  return ["attack","balanced","conserve"].includes(value)?value:"balanced";
}

function paceOpportunityValue(car){
  return paceMode(car)==="attack"?1:paceMode(car)==="conserve"?-1:0;
}

function tyreConditionRatio(car){
  return clamp(finite(car?.tyre?.condition,100)/100,0,1);
}

function tyreCompoundGrip(car){
  return clamp(finite(car?.tyre?.grip_index,75),45,100);
}

function battleDamageLoad(car){
  const damage=car?.damage||{};
  const paceLoss=Math.max(0,finite(damage?.pace_loss_s_per_lap,0));
  const aero=clamp(finite(damage?.aero_loss_pct,0)/100,0,1);
  const handling=clamp(finite(damage?.handling_loss_pct,0)/100,0,1);
  const braking=clamp(finite(damage?.braking_loss_pct,0)/100,0,1);
  const structural=aero*0.35+handling*0.45+braking*0.20;
  return clamp((paceLoss/3.5)*0.65+structural*0.35,0,1);
}

function trackOpportunityContext(attacker,defender){
  const severity=Math.max(
    clamp(attacker?.effectiveCornerSeverity,0,1),
    clamp(defender?.effectiveCornerSeverity,0,1)
  );
  if(severity<=0.20)return {phase:"straight",severity,score:1};
  if(severity<=0.45)return {phase:"braking",severity,score:0.45};
  if(severity<=0.65)return {phase:"corner",severity,score:-0.25};
  return {phase:"heavy_corner",severity,score:-0.80};
}

export function raceOvertakeOpportunityFactors(state,attacker,defender,{
  gapM=null,
  closingSpeedMs=null,
  towStrength=null,
}={}){
  const overtaking=score(driverPerformance(attacker)?.overtaking,null);
  const defending=score(driverPerformance(defender)?.defending,null);
  if(overtaking==null||defending==null)return null;

  const attackerSpeed=Math.max(0,finite(attacker?.speedMs,finite(attacker?.speedKmh,0)/3.6));
  const defenderSpeed=Math.max(0,finite(defender?.speedMs,finite(defender?.speedKmh,0)/3.6));
  const closingSpeed=finite(closingSpeedMs,attackerSpeed-defenderSpeed);
  const physicalGap=Math.max(0,finite(gapM,RACE_OVERTAKE_ATTEMPT_RANGE_M));
  const matchup=raceBattlePerformanceMatchup(attacker,defender);
  const attackerResources=raceResourcePerformance(attacker);
  const defenderResources=raceResourcePerformance(defender);
  const attackerTyreGrip=finite(attackerResources?.tyreGripMultiplier,1);
  const defenderTyreGrip=finite(defenderResources?.tyreGripMultiplier,1);
  const tyreGripEdge=attackerTyreGrip-defenderTyreGrip;
  const attackerCompoundGrip=tyreCompoundGrip(attacker);
  const defenderCompoundGrip=tyreCompoundGrip(defender);
  const compoundGripEdge=attackerCompoundGrip-defenderCompoundGrip;
  const attackerTyreCondition=tyreConditionRatio(attacker);
  const defenderTyreCondition=tyreConditionRatio(defender);
  const tyreConditionEdge=attackerTyreCondition-defenderTyreCondition;
  const attackerDamageLoad=battleDamageLoad(attacker);
  const defenderDamageLoad=battleDamageLoad(defender);
  const damageEdge=defenderDamageLoad-attackerDamageLoad;
  const attackerPace=paceMode(attacker);
  const defenderPace=paceMode(defender);
  const strategyEdge=clamp(
    (paceOpportunityValue(attacker)-paceOpportunityValue(defender))/2,
    -1,
    1
  );
  const trackContext=trackOpportunityContext(attacker,defender);
  const gapFactor=clamp(
    (RACE_OVERTAKE_ATTEMPT_RANGE_M-physicalGap)/RACE_OVERTAKE_ATTEMPT_RANGE_M,
    0,
    1
  );
  const closingFactor=clamp(closingSpeed/8,-1,1);
  const driverFactor=clamp(finite(matchup?.driverEdge,0)/35,-1,1);
  const carFactor=clamp(finite(matchup?.carEdge,0)/35,-1,1);
  const tyreFactor=clamp(tyreGripEdge/0.12,-1,1);
  const compoundFactor=clamp(compoundGripEdge/12,-1,1);
  const tyreWearFactor=clamp(tyreConditionEdge/0.45,-1,1);
  const damageFactor=clamp(damageEdge/0.70,-1,1);
  const activeTowStrength=clamp(
    towStrength==null?attacker?.traffic?.slipstreamStrength:towStrength,
    0,
    1
  );

  // Opportunity uses the canonical inputs the player actually manages:
  // driver, car, strategy, compound/grip, tyre life and persistent damage.
  // Closing speed and tow remain physical prerequisites rather than UI bonuses.
  const contributions={
    gap:gapFactor*0.13,
    closing:closingFactor*0.11,
    driver:driverFactor*0.20,
    car:carFactor*0.11,
    tyre:tyreFactor*0.08,
    compound:compoundFactor*0.05,
    tyreWear:tyreWearFactor*0.06,
    damage:damageFactor*0.09,
    strategy:strategyEdge*0.14,
    tow:activeTowStrength*0.14,
    track:trackContext.score>=0
      ?trackContext.score*0.07
      :trackContext.score*0.10,
  };
  const rawProbability=0.18+Object.values(contributions).reduce((sum,value)=>sum+value,0);
  const trackFactor=overtakingTrackFactor(state);
  const probability=clamp(rawProbability*trackFactor,0.02,0.94);

  return {
    probability:round(probability,6),
    rawProbability:round(rawProbability,6),
    trackFactor:round(trackFactor,6),
    gapM:round(physicalGap,6),
    gapFactor:round(gapFactor,6),
    closingSpeedMs:round(closingSpeed,6),
    closingFactor:round(closingFactor,6),
    driverEdge:matchup.driverEdge,
    driverFactor:round(driverFactor,6),
    carEdge:matchup.carEdge,
    carFactor:round(carFactor,6),
    attackerTyreGrip:round(attackerTyreGrip,6),
    defenderTyreGrip:round(defenderTyreGrip,6),
    tyreGripEdge:round(tyreGripEdge,6),
    tyreFactor:round(tyreFactor,6),
    attackerCompoundGrip:round(attackerCompoundGrip,3),
    defenderCompoundGrip:round(defenderCompoundGrip,3),
    compoundGripEdge:round(compoundGripEdge,3),
    compoundFactor:round(compoundFactor,6),
    attackerTyreCondition:round(attackerTyreCondition,6),
    defenderTyreCondition:round(defenderTyreCondition,6),
    tyreConditionEdge:round(tyreConditionEdge,6),
    tyreWearFactor:round(tyreWearFactor,6),
    attackerDamageLoad:round(attackerDamageLoad,6),
    defenderDamageLoad:round(defenderDamageLoad,6),
    damageEdge:round(damageEdge,6),
    damageFactor:round(damageFactor,6),
    attackerPace,
    defenderPace,
    strategyEdge:round(strategyEdge,6),
    towStrength:round(activeTowStrength,6),
    trackPhase:trackContext.phase,
    cornerSeverity:round(trackContext.severity,6),
    contributions:Object.fromEntries(
      Object.entries(contributions).map(([key,value])=>[key,round(value,6)])
    ),
  };
}

export function overtakeAttemptProbability(state,attacker,defender,options={}){
  return raceOvertakeOpportunityFactors(state,attacker,defender,options)?.probability??0;
}

export function battleContactProbability(state,attacker,defender,{stepMs=100}={}){
  void state;
  const mistakeA=score(driverPerformance(attacker)?.mistakePropensity,35);
  const mistakeD=score(driverPerformance(defender)?.mistakePropensity,35);
  const aggressionA=score(driverPerformance(attacker)?.aggression,50);
  const aggressionD=score(driverPerformance(defender)?.aggression,50);
  const intelligenceA=driverRaceIntelligence(attacker);
  const intelligenceD=driverRaceIntelligence(defender);
  const cornerSeverity=Math.max(
    clamp(attacker?.effectiveCornerSeverity,0,1),
    clamp(defender?.effectiveCornerSeverity,0,1)
  );

  // Drivers generally avoid touching. Contact is an exceptional failure of
  // racecraft, not a normal outcome of every side-by-side battle.
  const mistakeRisk=((mistakeA+mistakeD)/200)*0.0045;
  const aggressionRisk=(
    Math.max(0,aggressionA-65)+
    Math.max(0,aggressionD-65)
  )/70*0.0035;
  const cornerRisk=cornerSeverity*0.0040;
  const intelligence=(intelligenceA+intelligenceD)/2;
  const avoidanceFactor=clamp(1.15-intelligence*0.0065,0.45,1.05);
  const perSecond=clamp(
    (0.00025+mistakeRisk+aggressionRisk+cornerRisk)*avoidanceFactor,
    0.00008,
    0.018
  );
  const dt=Math.max(0.01,finite(stepMs,100)/1000);
  return round(1-Math.pow(1-perSecond,dt),8);
}

function attemptOpportunity(state,attacker,occupied,{blockedSectors=null}={}){
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
  const blocked=overtakeBlockedSectorSet(blockedSectors);
  if(
    carInBlockedOvertakeSector(attacker,blocked)||
    carInBlockedOvertakeSector(defender,blocked)
  )return null;
  if(defender?.battle?.phase&&defender.battle.phase!=="none")return null;
  if(occupied.has(String(defender?.carId??"")))return null;

  const gapM=Math.max(0,finite(nearest?.gapM,Infinity));
  const towContext=raceSlipstreamContext(state,attacker,{nearest});
  const baseAttemptRange=Math.max(
    RACE_OVERTAKE_ATTEMPT_RANGE_M,
    finite(desiredTrafficGapM(attacker),RACE_TRAFFIC_HARD_GAP_M)+8
  );
  const trackAttemptRange=baseAttemptRange*overtakingRangeFactor(state);
  const closingPotentialMs=overtakeClosingPotentialMs(state,attacker,defender);

  const cornerSeverity=Math.max(
    clamp(attacker?.effectiveCornerSeverity,0,1),
    clamp(defender?.effectiveCornerSeverity,0,1)
  );
  if(cornerSeverity>0.82)return null;

  const factors=raceOvertakeOpportunityFactors(state,attacker,defender,{
    gapM,
    closingSpeedMs:closingPotentialMs,
    towStrength:towContext?.strength??0,
  });
  const probability=finite(factors?.probability,0);
  if(probability<=0)return null;

  // A committed attacker does not need a huge instantaneous speed delta before
  // being allowed to try. Strategy and tow lower the launch threshold, while
  // the subsequent side-by-side simulation still decides whether the pass
  // physically succeeds or fails.
  const minimumClosingPotentialMs=clamp(
    0.55-Math.max(0,finite(factors?.strategyEdge,0))*0.25-
      Math.max(0,finite(towContext?.strength,0))*0.15,
    0.18,
    0.55
  );
  if(closingPotentialMs<minimumClosingPotentialMs)return null;

  // Traffic deliberately holds a following car near desiredTrafficGapM.
  // The battle gate must therefore allow the canonical overtake model to take
  // ownership from that staging gap; otherwise traffic can permanently prevent
  // a faster car from ever entering side-by-side state.
  const followingLaunchRange=Math.max(
    RACE_TRAFFIC_HARD_GAP_M,
    finite(desiredTrafficGapM(attacker),RACE_TRAFFIC_HARD_GAP_M)
  )+2;
  const physicallyReachableRange=Math.max(
    followingLaunchRange,
    closingPotentialMs*(RACE_BATTLE_MAX_DURATION_MS/1000)
  );
  const attemptRange=Math.min(trackAttemptRange,physicallyReachableRange);
  if(gapM>attemptRange)return null;

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
    towStrength:finite(towContext?.strength,0),
    towBonusKmh:finite(towContext?.targetBonusKmh,0),
    factors,
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

function resolveExistingBattles(state,proposedCars,{stepMs,blockedSectors=null}={}){
  let cars=[...(proposedCars||[])];
  const events=[];
  const bypassPairs=new Set();
  const handledAttempts=new Set();
  const nextTime=Math.max(0,finite(state?.simulationTimeMs,0))+Math.max(0,finite(stepMs,100));
  const blocked=overtakeBlockedSectorSet(blockedSectors);

  for(const previousAttacker of state?.cars||[]){
    const previousBattle=previousAttacker?.battle;
    if(!["approach","side_by_side"].includes(String(previousBattle?.phase||""))||previousBattle?.role!=="attacker")continue;
    const attemptId=String(previousBattle?.attemptId??"");
    if(!attemptId||handledAttempts.has(attemptId))continue;
    handledAttempts.add(attemptId);

    const previousDefender=carById(state?.cars,previousBattle?.opponentCarId);
    let attacker=carById(cars,previousAttacker?.carId);
    let defender=carById(cars,previousBattle?.opponentCarId);
    if(!attacker||!defender||!previousDefender)continue;

    const pairKey=raceTrafficPairKey(attacker,defender);
    const cooldownUntilMs=nextTime+RACE_BATTLE_RETRY_COOLDOWN_MS;

    if(
      carInBlockedOvertakeSector(previousAttacker,blocked)||
      carInBlockedOvertakeSector(previousDefender,blocked)
    ){
      const yellowCooldownUntilMs=nextTime+500;
      attacker=clearBattle(attacker,{result:"aborted",cooldownUntilMs:yellowCooldownUntilMs});
      defender=clearBattle(defender,{result:"aborted",cooldownUntilMs:yellowCooldownUntilMs});
      cars=setCar(setCar(cars,attacker),defender);
      events.push(eventDescriptor("overtake_aborted",state,attacker,defender,{
        attemptId,
        reason:"local_yellow",
        restrictedSectors:[...blocked],
      }));
      continue;
    }

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

    const clearance=physicalClearanceM(state,attacker,defender);
    const previousClearance=physicalClearanceM(state,previousAttacker,previousDefender);
    const actualClosingM=round(clearance-previousClearance,6);
    const actualClosingMs=round((clearance-previousClearance)/(Math.max(1,stepMs)/1000),6);

    if(previousBattle?.phase==="approach"){
      const approachGapM=Math.max(0,-clearance);
      const expired=nextTime>=finite(previousBattle?.expiresAtMs,nextTime);
      if(clearance>=-RACE_BATTLE_SIDE_BY_SIDE_GAP_M){
        const side=Number(previousBattle?.side)||1;
        // A real approach consumes time while two cars are still longitudinally
        // separated. Reusing its deadline for the physical side-by-side duel
        // makes a successful closing manoeuvre time out almost immediately.
        // Budget the second phase from the remaining *physical* clearance and
        // the last observed relative speed, without granting distance or speed.
        const remainingPassM=Math.max(0,-clearance)+RACE_OVERTAKE_DECISIVE_CLEARANCE_M;
        const duelBudgetMs=battleDurationMs(state,remainingPassM,Math.max(0,actualClosingMs));
        const duelExpiresAtMs=Math.max(
          finite(previousBattle?.expiresAtMs,nextTime),
          nextTime+duelBudgetMs
        );
        attacker=withBattle(attacker,{
          opponentCarId:defender?.carId,
          role:"attacker",
          side,
          attemptId,
          startedTick:previousBattle?.startedTick,
          startedAtMs:previousBattle?.startedAtMs,
          expiresAtMs:duelExpiresAtMs,
          contactRiskPct:0,
        });
        defender=withBattle(defender,{
          opponentCarId:attacker?.carId,
          role:"defender",
          side:-side,
          attemptId,
          startedTick:previousBattle?.startedTick,
          startedAtMs:previousBattle?.startedAtMs,
          expiresAtMs:duelExpiresAtMs,
          contactRiskPct:0,
        });
        cars=setCar(setCar(cars,attacker),defender);
        bypassPairs.add(pairKey);
        events.push(eventDescriptor("overtake_side_by_side",state,attacker,defender,{
          attemptId,
          gapM:round(approachGapM,6),
          clearanceM:round(clearance,6),
          actualClosingM,
          actualClosingMs,
          elapsedMs:round(nextTime-finite(previousBattle?.startedAtMs,nextTime),3),
          duelBudgetMs,
          duelExpiresAtMs,
        }));
        continue;
      }
      if(expired||approachGapM>RACE_OVERTAKE_ATTEMPT_RANGE_M*1.35){
        attacker=clearBattle(attacker,{result:"failed",cooldownUntilMs});
        defender=clearBattle(defender,{result:"defended",cooldownUntilMs});
        cars=setCar(setCar(cars,attacker),defender);
        events.push(eventDescriptor("overtake_failed",state,attacker,defender,{
          attemptId,
          reason:expired?"approach_timeout":"defender_clear",
          finalGapM:round(approachGapM,6),
          actualClosingM,
          actualClosingMs,
          elapsedMs:round(nextTime-finite(previousBattle?.startedAtMs,nextTime),3),
        }));
        continue;
      }

      const side=Number(previousBattle?.side)||1;
      attacker=withApproachBattle(attacker,{
        opponentCarId:defender?.carId,
        role:"attacker",
        side,
        attemptId,
        startedTick:previousBattle?.startedTick,
        startedAtMs:previousBattle?.startedAtMs,
        expiresAtMs:previousBattle?.expiresAtMs,
        gapM:approachGapM,
      });
      defender=withApproachBattle(defender,{
        opponentCarId:attacker?.carId,
        role:"defender",
        side:-side,
        attemptId,
        startedTick:previousBattle?.startedTick,
        startedAtMs:previousBattle?.startedAtMs,
        expiresAtMs:previousBattle?.expiresAtMs,
        gapM:approachGapM,
      });
      cars=setCar(setCar(cars,attacker),defender);
      bypassPairs.add(pairKey);
      continue;
    }

    const contactProximityM=Math.abs(clearance);
    const contactProbability=contactProximityM<=RACE_BATTLE_CONTACT_PROXIMITY_M
      ?battleContactProbability(state,previousAttacker,previousDefender,{stepMs})
      :0;
    const contactRoll=deterministicUnit(state,`contact:${attemptId}:${state?.tick}`);
    if(contactProbability>0&&contactRoll<contactProbability){
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
        physicalClearanceM:round(clearance,6),
        contactProximityM:round(contactProximityM,6),
      }));
      continue;
    }

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

function startNewBattles(state,proposedCars,existingBypass,{stepMs=100,blockedPairs=null,blockedSectors=null}={}){
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
    const opportunity=attemptOpportunity(state,previousAttacker,occupied,{blockedSectors});
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

    attacker=withApproachBattle(attacker,{
      opponentCarId:defender?.carId,
      role:"attacker",
      side,
      attemptId,
      startedTick:state?.tick,
      startedAtMs:now,
      expiresAtMs,
      gapM:opportunity.gapM,
    });
    defender=withApproachBattle(defender,{
      opponentCarId:attacker?.carId,
      role:"defender",
      side:-side,
      attemptId,
      startedTick:state?.tick,
      startedAtMs:now,
      expiresAtMs,
      gapM:opportunity.gapM,
    });

    cars=setCar(setCar(cars,attacker),defender);
    occupied.add(String(attacker?.carId??""));
    occupied.add(String(defender?.carId??""));
    const matchup=raceBattlePerformanceMatchup(previousAttacker,opportunity.defender);
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
      attackerDriverScore:matchup.attackerDriverScore,
      defenderDriverScore:matchup.defenderDriverScore,
      driverEdge:matchup.driverEdge,
      attackerCarScore:matchup.attackerCarScore,
      defenderCarScore:matchup.defenderCarScore,
      carEdge:matchup.carEdge,
      attackerScore:matchup.attackerScore,
      defenderScore:matchup.defenderScore,
      performanceEdge:matchup.edge,
      attackerPaceMode:opportunity?.factors?.attackerPace??null,
      defenderPaceMode:opportunity?.factors?.defenderPace??null,
      strategyEdge:opportunity?.factors?.strategyEdge??null,
      attackerTyreGrip:opportunity?.factors?.attackerTyreGrip??null,
      defenderTyreGrip:opportunity?.factors?.defenderTyreGrip??null,
      tyreGripEdge:opportunity?.factors?.tyreGripEdge??null,
      trackPhase:opportunity?.factors?.trackPhase??null,
      cornerSeverity:opportunity?.factors?.cornerSeverity??null,
      opportunityContributions:opportunity?.factors?.contributions??null,
      towStrength:round(opportunity.towStrength,6),
      towBonusKmh:round(opportunity.towBonusKmh,6),
      phase:"approach",
      attackerTyreCondition:opportunity?.factors?.attackerTyreCondition??null,
      defenderTyreCondition:opportunity?.factors?.defenderTyreCondition??null,
      tyreConditionEdge:opportunity?.factors?.tyreConditionEdge??null,
      attackerDamageLoad:opportunity?.factors?.attackerDamageLoad??null,
      defenderDamageLoad:opportunity?.factors?.defenderDamageLoad??null,
      damageEdge:opportunity?.factors?.damageEdge??null,
    }));

    // The first battle tick keeps RW8.5's longitudinal hard gap. From the
    // following tick the approach phase owns this pair, releases the canonical
    // traffic-following ceiling and moves the attacker progressively off-line.
    // Only once the cars are physically close does the state become side-by-side.
  }

  return {cars,events,bypassPairs};
}

export function resolveRaceOvertaking(state,proposedCars,{
  stepMs=100,
  blockedPairs=null,
  blockedSectors=null,
}={}){
  const yieldingCars=resolveYieldingBattles(state,proposedCars);
  const existing=resolveExistingBattles(state,yieldingCars,{stepMs,blockedSectors});
  const started=startNewBattles(state,existing.cars,existing.bypassPairs,{
    stepMs,
    blockedPairs,
    blockedSectors,
  });
  return {
    cars:started.cars,
    events:[...existing.events,...started.events],
    bypassPairs:started.bypassPairs,
  };
}
