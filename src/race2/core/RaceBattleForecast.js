// RW56: read-only projected closing across the next braking/acceleration phases.
// It uses canonical Race Dynamics target speeds and acceleration. This is NOT
// an alternative movement engine: it never mutates RaceState or race results.
import {raceAccelerationForTarget,raceTargetSpeedProfile} from "./RaceDynamics.js";
import {raceSlipstreamContext} from "./RaceTraffic.js";

const finite=(value,fallback=0)=>{
  const n=Number(value);
  return value!==null&&value!==undefined&&Number.isFinite(n)?n:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const kmhToMs=kmh=>Math.max(0,finite(kmh,0)/3.6);

// The projection is meaningful only where the track has a physical corner
// profile. Neutral tracks retain the established RW44 opportunity logic.
export function forecastBattleClosing(state,attacker,defender,{horizonS=6,stepS=0.5}={}){
  const track=state?.track;
  if(!track?.speedProfile?.detailed||!track?.speedProfile?.samples?.length||
     !(finite(track?.lengthM,0)>0))return null;
  if(!attacker?.performance?.car||!defender?.performance?.car)return null;

  const lengthM=finite(track.lengthM,0);
  const initialAttackerSpeed=kmhToMs(attacker?.speedKmh);
  const initialDefenderSpeed=kmhToMs(defender?.speedKmh);
  const startAttSpeed=Math.max(0,finite(attacker?.speedMs,initialAttackerSpeed));
  const startDefSpeed=Math.max(0,finite(defender?.speedMs,initialDefenderSpeed));
  const steps=Math.max(1,Math.min(20,Math.ceil(clamp(finite(horizonS,6),1,10)/clamp(finite(stepS,0.5),0.1,1))));
  const dt=clamp(finite(horizonS,6),1,10)/steps;

  let projectedAttacker={
    ...attacker,
    speedMs:startAttSpeed,
    distanceAlongLapM:finite(attacker?.distanceAlongLapM,0),
    absoluteDistanceM:finite(attacker?.absoluteDistanceM,0),
    battle:{
      ...(attacker?.battle||{}),
      phase:"approach",
      role:"attacker",
      opponentCarId:defender?.carId,
    },
  };
  let projectedDefender={
    ...defender,
    speedMs:startDefSpeed,
    distanceAlongLapM:finite(defender?.distanceAlongLapM,0),
    absoluteDistanceM:finite(defender?.absoluteDistanceM,0),
  };
  const originalGap=finite(projectedDefender.absoluteDistanceM,0)-
    finite(projectedAttacker.absoluteDistanceM,0);
  // Preserve the defender's established tow as a constant approximation.
  // Model the attacker's tow using canonical slipstream strength at each
  // projected distance instead of granting a fixed synthetic speed boost.
  const defenderTowKmh=Math.max(0,finite(defender?.traffic?.slipstreamTargetBonusKmh,0));

  const integrate=(car,targetKmh)=>{
    const targetMs=kmhToMs(targetKmh);
    const speed=Math.max(0,finite(car?.speedMs,0));
    const acceleration=raceAccelerationForTarget(state,car,targetKmh);
    const rawNext=Math.max(0,speed+acceleration*dt);
    const next=acceleration>=0
      ?Math.min(Math.max(speed,targetMs),rawNext)
      :Math.max(Math.min(speed,targetMs),rawNext);
    const advanced=Math.max(0,((speed+next)/2)*dt);
    const absoluteDistanceM=finite(car?.absoluteDistanceM,0)+advanced;
    return {
      ...car,
      speedMs:next,
      speedKmh:next*3.6,
      absoluteDistanceM,
      distanceAlongLapM:((absoluteDistanceM%lengthM)+lengthM)%lengthM,
    };
  };

  for(let i=0;i<steps;i+=1){
    const gapM=projectedDefender.absoluteDistanceM-projectedAttacker.absoluteDistanceM;
    const tow=gapM>0
      ?raceSlipstreamContext(state,projectedAttacker,{
        nearest:{car:projectedDefender,gapM},
      }).targetBonusKmh
      :0;
    const attTarget=raceTargetSpeedProfile(state,projectedAttacker).targetSpeedKmh+
      Math.max(0,finite(tow,0));
    const defTarget=raceTargetSpeedProfile(state,projectedDefender).targetSpeedKmh+
      defenderTowKmh;
    // Both projections use pre-step state. No advantage from sequential order.
    const nextAtt=integrate(projectedAttacker,attTarget);
    const nextDef=integrate(projectedDefender,defTarget);
    projectedAttacker=nextAtt;
    projectedDefender=nextDef;
  }

  const finalGap=projectedDefender.absoluteDistanceM-projectedAttacker.absoluteDistanceM;
  return {
    horizonS:steps*dt,
    initialClosingMs:startAttSpeed-startDefSpeed,
    projectedGainM:Number((originalGap-finalGap).toFixed(4)),
    finalClosingMs:Number((projectedAttacker.speedMs-projectedDefender.speedMs).toFixed(4)),
    projectedGapM:Number(finalGap.toFixed(4)),
  };
}
