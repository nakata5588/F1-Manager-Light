// src/engine/StandingWaterEngine.js
// RW5.2D4.2 — standing water and aquaplaning model.
//
// Track wetness measures how wet the surface is overall. Standing water is a
// separate hazard: saturated asphalt, continuing rainfall, poor drainage and a
// worsening water trend combine before meaningful pools form.
//
// Aquaplaning then depends on that standing water plus tyre choice, driver wet
// control and speed exposure. Full wets reduce the risk but cannot remove it.

const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const round=(v,digits=3)=>{
  const p=10**digits;
  return Math.round(Number(v)*p)/p;
};

export function standingWaterBand(index){
  const value=clamp(num(index,0),0,100);
  if(value<15)return "NONE";
  if(value<35)return "PATCHY";
  if(value<60)return "SIGNIFICANT";
  if(value<80)return "HEAVY";
  return "EXTREME";
}

export function standingWaterForConditions({
  wetness=0,
  rainIntensity=0,
  drainage=0.5,
  wetnessDelta=0,
}={}){
  const wet=clamp(wetness,0,1);
  const rain=clamp(rainIntensity,0,1);
  const drain=clamp(drainage,0,1);
  const worsening=clamp(Math.max(0,num(wetnessDelta,0))/0.035,0,1);

  // Standing water should not appear simply because the surface is damp.
  // Saturation becomes meaningful only once the track is already quite wet.
  const saturation=clamp((wet-0.38)/0.62,0,1)**1.20;
  const rainfallLoad=rain**1.15;
  const poorDrainage=1-drain;

  const standing=clamp(
    saturation*(
      0.42+
      rainfallLoad*0.26+
      poorDrainage*0.22
    )+
    saturation*worsening*0.10,
    0,1
  );
  const index=round(standing*100,1);

  return {
    index,
    normalized:round(standing,3),
    band:standingWaterBand(index),
    factors:{
      saturation:round(saturation,3),
      rainfall:round(rainfallLoad,3),
      poor_drainage:round(poorDrainage,3),
      worsening:round(worsening,3),
    },
  };
}

export function aquaplaningRiskForDriver({
  standingWaterIndex=0,
  tyreCategory="wet",
  wetSkill=60,
  adaptability=60,
  raceIntelligence=60,
  paceMode="balanced",
  speedRatio=0.85,
  tyreCondition=100,
}={}){
  const standing=clamp(num(standingWaterIndex,0)/100,0,1);
  const waterExposure=clamp((standing-0.12)/0.88,0,1)**1.55;

  const category=String(tyreCategory||"wet").toLowerCase();
  const tyreFactor={
    wet:0.58,
    intermediate:0.95,
    dry:1.60,
  }[category]??1.10;

  const skill=clamp(
    (num(wetSkill,60)*0.55+num(adaptability,60)*0.30+num(raceIntelligence,60)*0.15)/100,
    0,1
  );
  const driverFactor=1.12-skill*0.50;
  const paceFactor={
    conserve:0.90,
    balanced:1.00,
    attack:1.13,
  }[String(paceMode||"balanced").toLowerCase()]??1.00;
  const speed=clamp(num(speedRatio,0.85),0.55,1.15);
  const speedFactor=speed**2;
  const condition=clamp(num(tyreCondition,100),0,100);
  const conditionFactor=1+Math.max(0,55-condition)/100*0.35;

  const exposure=clamp(
    waterExposure*
    tyreFactor*
    driverFactor*
    paceFactor*
    (0.65+0.50*speedFactor)*
    conditionFactor,
    0,1
  );

  return {
    risk_index:round(exposure*100,1),
    probability:round(Math.min(0.12,exposure*0.07),5),
    factors:{
      standing_water:round(waterExposure,3),
      tyre:round(tyreFactor,3),
      driver:round(driverFactor,3),
      pace:round(paceFactor,3),
      speed:round(speedFactor,3),
      condition:round(conditionFactor,3),
    },
  };
}

export function aquaplaningOutcome({riskIndex=0,outcomeRoll=0.5,retirementRoll=0.5}={}){
  const risk=clamp(num(riskIndex,0)/100,0,1);
  const roll=clamp(outcomeRoll,0,1);
  let outcome="spin";

  if(risk>=0.72){
    outcome=roll<0.34?"accident":roll<0.72?"loss_of_control":"spin";
  }else if(risk>=0.42){
    outcome=roll<0.16?"accident":roll<0.55?"loss_of_control":"spin";
  }else if(risk>=0.20){
    outcome=roll<0.30?"loss_of_control":"spin";
  }

  const retirementChance=outcome==="accident"
    ?clamp(0.28+risk*0.46,0.28,0.74)
    :0;
  const retirement=outcome==="accident"&&clamp(retirementRoll,0,1)<retirementChance;

  const severity=outcome==="accident"
    ?risk>=0.82?"critical":"high"
    :outcome==="loss_of_control"
      ?risk>=0.62?"high":"medium"
      :risk>=0.52?"medium":"low";

  const baseLoss=outcome==="spin"
    ?4+risk*10
    :outcome==="loss_of_control"
      ?8+risk*16
      :12+risk*20;

  return {
    outcome,
    retirement,
    retirement_chance:round(retirementChance,3),
    severity,
    time_loss_s:retirement?0:round(baseLoss,2),
  };
}
