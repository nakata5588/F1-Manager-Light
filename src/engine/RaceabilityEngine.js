// src/engine/RaceabilityEngine.js
// RW5.2D4.1 — composite raceability model.
//
// This layer evaluates whether the circuit environment is becoming difficult
// to race in. It deliberately does NOT issue Safety Car, VSC or Red Flag
// decisions; era-aware Race Control consumes this signal in a later D4 stage.
//
// No single input can make a session "unraceable". Wetness, spray, visibility,
// grip and rainfall contribute through smooth hazard curves plus interactions.

const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const round=(v,digits=3)=>{
  const p=10**digits;
  return Math.round(Number(v)*p)/p;
};
const hazardCurve=(value,power=1)=>clamp(value,0,1)**power;

export function raceabilityBand(index){
  const score=clamp(num(index,100),0,100);
  if(score>=75)return "GOOD";
  if(score>=55)return "DEGRADED";
  if(score>=35)return "POOR";
  return "CRITICAL";
}

export function evaluateRaceability({
  wetness=0,
  sprayIndex=0,
  visibilityIndex=100,
  gripIndex=100,
  rainIntensity=0,
  wetnessDelta=0,
}={}){
  const wet=clamp(wetness,0,1);
  const spray=clamp(sprayIndex,0,1);
  const visibility=clamp(num(visibilityIndex,100)/100,0,1);
  const grip=clamp(num(gripIndex,100)/100,0,1);
  const rain=clamp(rainIntensity,0,1);

  // Small amounts of water are normal crossover conditions. The water hazard
  // ramps progressively once the track is meaningfully wet.
  const waterLoad=hazardCurve(clamp((wet-0.12)/0.88,0,1),1.25);
  const sprayLoad=hazardCurve(spray,1.30);
  const visibilityLoad=hazardCurve(1-visibility,1.35);
  const gripLoss=hazardCurve(1-grip,1.30);
  const rainfallLoad=hazardCurve(rain,1.20);
  const worseningLoad=clamp(Math.max(0,num(wetnessDelta,0))/0.04,0,1);

  // Interactions capture why combinations matter more than isolated readings:
  // a wet/low-grip surface and high spray/poor visibility compound risk.
  const waterGrip=Math.sqrt(waterLoad*gripLoss);
  const sprayVisibility=Math.sqrt(sprayLoad*visibilityLoad);
  const rainWater=Math.sqrt(rainfallLoad*waterLoad);

  const hazard=clamp(
    waterLoad*0.18+
    sprayLoad*0.19+
    visibilityLoad*0.20+
    gripLoss*0.17+
    rainfallLoad*0.09+
    waterGrip*0.07+
    sprayVisibility*0.06+
    rainWater*0.025+
    worseningLoad*0.015,
    0,1
  );

  const index=round((1-hazard)*100,1);
  const factors={
    wetness:round(waterLoad,3),
    spray:round(sprayLoad,3),
    visibility:round(visibilityLoad,3),
    grip_loss:round(gripLoss,3),
    rain:round(rainfallLoad,3),
    worsening:round(worseningLoad,3),
    water_grip:round(waterGrip,3),
    spray_visibility:round(sprayVisibility,3),
    rain_water:round(rainWater,3),
  };
  const dominantFactors=Object.entries({
    wetness:factors.wetness*0.18,
    spray:factors.spray*0.19,
    visibility:factors.visibility*0.20,
    grip:factors.grip_loss*0.17,
    rain:factors.rain*0.09,
  })
    .filter(([,value])=>value>0.005)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,3)
    .map(([name])=>name);

  return {
    index,
    hazard_index:round(hazard*100,1),
    band:raceabilityBand(index),
    factors,
    dominant_factors:dominantFactors,
  };
}
