// src/race2/core/RaceDynamics.js
// RW8.3B: deterministic pace, speed, braking and corner response for RW2.
//
// This module is pure RaceState logic. It consumes only detached performance
// snapshots and the canonical TrackModel; it never reaches back into GameState.

import {
  trackCornerSeverityAhead,
  trackCornerSeverityAtDistance,
} from "../track/TrackModel.js";
import { raceResourcePerformance } from "./RaceResources.js";
import { raceTeamOrderPaceMultiplier } from "./RaceTeamOrders.js";
import { raceBattlePaceMultiplier } from "./RaceOvertaking.js";
import { raceControlPaceMultiplier } from "./RaceControlLifecycle.js";

const finite=(value,fallback=0)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,finite(value,min)));
const round=(value,digits=3)=>Number(finite(value,0).toFixed(digits));

const ERA_STRAIGHT_SPEED_KMH=Object.freeze([
  [1950,275],
  [1960,290],
  [1970,305],
  [1980,315],
  [1990,325],
  [2000,335],
  [2010,340],
  [2020,345],
  [2030,350],
]);

export function eraStraightSpeedKmh(year){
  const y=finite(year,1980);
  if(y<=ERA_STRAIGHT_SPEED_KMH[0][0])return ERA_STRAIGHT_SPEED_KMH[0][1];
  for(let index=1;index<ERA_STRAIGHT_SPEED_KMH.length;index+=1){
    const [yearB,speedB]=ERA_STRAIGHT_SPEED_KMH[index];
    const [yearA,speedA]=ERA_STRAIGHT_SPEED_KMH[index-1];
    if(y<=yearB){
      const t=(y-yearA)/Math.max(1,yearB-yearA);
      return speedA+(speedB-speedA)*t;
    }
  }
  return ERA_STRAIGHT_SPEED_KMH[ERA_STRAIGHT_SPEED_KMH.length-1][1];
}

function carPerformance(car){
  return car?.performance?.car||{};
}

function driverPerformance(car){
  return car?.performance?.driver||{};
}

function performanceScore(car,key,fallback=70){
  const value=finite(carPerformance(car)?.[key],fallback);
  return clamp(value,0,100);
}

function driverRaceScore(car){
  return clamp(finite(driverPerformance(car)?.raceScore,70),0,100);
}

function damagePaceMultiplier(state,car,rawTargetSpeedKmh){
  const paceLossS=Math.max(0,finite(car?.damage?.pace_loss_s_per_lap,0));
  if(paceLossS<=0)return 1;
  const lengthM=Math.max(1,finite(state?.track?.lengthM,5000));
  const localTargetMs=Math.max(25,finite(rawTargetSpeedKmh,200)/3.6);
  const estimatedAverageMs=Math.max(20,localTargetMs*0.62);
  const estimatedLapS=Math.max(20,lengthM/estimatedAverageMs);
  return clamp(estimatedLapS/(estimatedLapS+paceLossS),0.88,1);
}

export function raceTargetSpeedProfile(state,car){
  const speedMs=Math.max(0,finite(car?.speedMs,finite(car?.speedKmh,0)/3.6));
  const distance=finite(car?.distanceAlongLapM,0);
  const currentSeverity=trackCornerSeverityAtDistance(state?.track,distance);
  const kinematicBraking=state?.track?.speedProfile?.brakingModel==="distance_sensitive";
  const lookaheadM=kinematicBraking
    ?clamp(85+speedMs*4.1,85,450)
    :clamp(45+speedMs*1.55,45,185);
  const aheadSeverity=kinematicBraking?null:trackCornerSeverityAhead(
    state?.track,
    distance,
    lookaheadM,
    {samples:6}
  );

  const power=performanceScore(car,"power",70);
  const race=performanceScore(car,"race",70);
  const chassis=performanceScore(car,"chassis",70);
  const driver=driverRaceScore(car);

  const straightScore=power*0.55+race*0.30+driver*0.15;
  const straightFactor=clamp(0.90+straightScore*0.00135,0.90,1.04);
  const circuitStraightFactor=clamp(
    finite(state?.track?.speedProfile?.straightSpeedFactor,1),0.75,1.05
  );
  const straightTarget=eraStraightSpeedKmh(state?.track?.year)*
    straightFactor*circuitStraightFactor;

  const handlingScore=chassis*0.55+race*0.20+driver*0.25;
  const cornerRetentionFactor=clamp(
    finite(state?.track?.speedProfile?.cornerRetentionFactor,1),0.7,1.1
  );
  const cornerRetention=clamp(0.28+handlingScore*0.0015,0.31,0.44)*
    cornerRetentionFactor;
  // The legacy model applies the entire upcoming corner speed across the
  // full lookahead distance. With an actual 16-corner circuit this causes
  // prolonged unnatural low-speed zones. On profiles explicitly opting in,
  // instead derive the safe *current* speed from the physical braking distance:
  // v_now^2 <= v_corner^2 + 2*a*distance. No speed or position teleports.
  // Other tracks retain their historical behaviour until individually audited.
  let effectiveSeverity=clamp(Math.max(currentSeverity,(aheadSeverity??0)*0.96),0,1);
  if(kinematicBraking){
    const plannedDecelMs2=7.7;
    const brakingMarginM=12;
    const probes=12;
    let maxSafeNowKmh=straightTarget;
    for(let i=1;i<=probes;i+=1){
      const distanceAhead=lookaheadM*i/probes;
      const severity=trackCornerSeverityAtDistance(state?.track,distance+distanceAhead);
      const safeCornerKmh=straightTarget*(1-severity*(1-cornerRetention));
      const safeNowKmh=3.6*Math.sqrt(
        (safeCornerKmh/3.6)**2+
        2*plannedDecelMs2*Math.max(0,distanceAhead-brakingMarginM)
      );
      maxSafeNowKmh=Math.min(maxSafeNowKmh,safeNowKmh);
    }
    const immediateCornerKmh=straightTarget*
      (1-currentSeverity*(1-cornerRetention));
    const constrainedKmh=Math.min(immediateCornerKmh,maxSafeNowKmh);
    effectiveSeverity=clamp(
      (1-constrainedKmh/Math.max(1,straightTarget))/
        Math.max(0.01,1-cornerRetention),0,1
    );
  }
  const resourcePerformance=raceResourcePerformance(car);
  const rawTargetSpeedKmh=Math.max(
    55,
    straightTarget*(1-effectiveSeverity*(1-cornerRetention))
  );
  const damageMultiplier=damagePaceMultiplier(state,car,rawTargetSpeedKmh);
  const controlPaceMultiplier=raceControlPaceMultiplier(state?.raceControlState?.mode);
  const teamOrderPaceMultiplier=raceTeamOrderPaceMultiplier(state,car);
  const battlePaceMultiplier=raceBattlePaceMultiplier(state,car);
  const targetSpeedKmh=Math.max(
    45,
    rawTargetSpeedKmh*
      finite(resourcePerformance?.paceMultiplier,1)*
      damageMultiplier*
      controlPaceMultiplier*
      teamOrderPaceMultiplier*
      battlePaceMultiplier
  );

  return {
    targetSpeedKmh:round(targetSpeedKmh,3),
    rawTargetSpeedKmh:round(rawTargetSpeedKmh,3),
    straightTargetKmh:round(straightTarget,3),
    resourcePaceMultiplier:round(resourcePerformance?.paceMultiplier,6),
    damagePaceMultiplier:round(damageMultiplier,6),
    raceControlPaceMultiplier:round(controlPaceMultiplier,6),
    teamOrderPaceMultiplier:round(teamOrderPaceMultiplier,6),
    battlePaceMultiplier:round(battlePaceMultiplier,6),
    cornerSeverity:round(currentSeverity,4),
    effectiveCornerSeverity:round(effectiveSeverity,4),
    lookaheadM:round(lookaheadM,3),
  };
}

export function raceAccelerationForTarget(state,car,targetSpeedKmh){
  const stepMs=clamp(state?.session?.simulation?.stepMs,10,1000);
  const dt=stepMs/1000;
  const currentMs=Math.max(0,finite(car?.speedMs,finite(car?.speedKmh,0)/3.6));
  const targetMs=Math.max(0,finite(targetSpeedKmh,0)/3.6);
  const delta=targetMs-currentMs;

  const power=performanceScore(car,"power",70);
  const chassis=performanceScore(car,"chassis",70);
  const driver=driverRaceScore(car);

  if(delta<-0.05){
    const brakingCapability=7.4+chassis*0.026+driver*0.010;
    const needed=Math.abs(delta)/Math.max(1e-9,dt);
    return -round(Math.min(brakingCapability,needed),4);
  }

  if(delta>0.05){
    const resourcePerformance=raceResourcePerformance(car);
    const baseAcceleration=(3.2+power*0.035)*
      finite(resourcePerformance?.accelerationMultiplier,1);
    const remainingRatio=targetMs>0?clamp(delta/targetMs,0,1):0;
    const taper=clamp(remainingRatio*2.4,0.16,1);
    const capability=baseAcceleration*taper;
    const needed=delta/Math.max(1e-9,dt);
    return round(Math.min(capability,needed),4);
  }

  return 0;
}

export function raceDynamicsForCar(state,car){
  if(!car?.performance?.car&&!car?.performance?.driver)return null;
  const profile=raceTargetSpeedProfile(state,car);
  return {
    ...profile,
    accelerationMs2:raceAccelerationForTarget(state,car,profile.targetSpeedKmh),
  };
}
