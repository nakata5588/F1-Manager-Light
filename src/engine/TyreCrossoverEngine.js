// src/engine/TyreCrossoverEngine.js
// RW5.2D3 — wet-weather tyre crossover decisions.
//
// There is deliberately no single field-wide wetness threshold. Each AI
// driver/team gets a stable risk profile, then trend/intelligence move the
// decision slightly inside a safe crossover window.

const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};

function stableUnit(value){
  let hash=2166136261;
  for(const ch of String(value??"")){
    hash^=ch.charCodeAt(0);
    hash=Math.imul(hash,16777619)>>>0;
  }
  return (hash%10001)/10000;
}

function driverRiskBias({driverId,teamId,rating={}}={}){
  const seeded=stableUnit(`${teamId||"team"}:${driverId||"driver"}:wet-crossover`)*2-1;
  const aggression=clamp(num(rating?.aggression,50)/100,0,1)*2-1;
  const intelligence=clamp(num(rating?.race_intelligence,60)/100,0,1);
  // Stable individuality is the largest component. Aggression nudges risk;
  // intelligence reduces random extremity without making every smart driver identical.
  return clamp(seeded*0.72+aggression*0.20+(0.5-intelligence)*0.16,-1,1);
}

export function tyreCrossoverProfile({driverId,teamId,rating={}}={}){
  const risk=driverRiskBias({driverId,teamId,rating});
  const unit=(risk+1)/2;
  return {
    risk_bias:Number(risk.toFixed(3)),
    slick_to_inter:Number((0.20+unit*0.10).toFixed(3)),
    inter_to_wet:Number((0.66+unit*0.12).toFixed(3)),
    wet_to_inter:Number((0.56+unit*0.12).toFixed(3)),
    inter_to_slick:Number((0.12+unit*0.10).toFixed(3)),
    cooldown_laps:3,
  };
}

export function tyreWeatherPenaltyForWetness(category,wetness){
  const have=String(category||"dry");
  const wet=clamp(wetness,0,1);
  if(have==="dry"){
    if(wet<=0.08)return 0;
    if(wet<=0.18)return (wet-0.08)/0.10*0.75;
    if(wet<=0.30)return 0.75+(wet-0.18)/0.12*2.35;
    if(wet<=0.45)return 3.10+(wet-0.30)/0.15*3.10;
    return 6.20+(wet-0.45)/0.55*4.80;
  }
  if(have==="intermediate"){
    if(wet<0.08)return 2.8-(wet/0.08)*0.9;
    if(wet<0.18)return 1.9-(wet-0.08)/0.10*1.6;
    if(wet<=0.64)return Math.max(0,0.30-Math.abs(wet-0.40)*0.55);
    if(wet<=0.80)return (wet-0.64)/0.16*1.8;
    return 1.8+(wet-0.80)/0.20*3.2;
  }
  if(have==="wet"){
    if(wet<0.12)return 5.2-(wet/0.12)*0.8;
    if(wet<0.45)return 4.4-(wet-0.12)/0.33*3.0;
    if(wet<0.68)return 1.4-(wet-0.45)/0.23*1.1;
    return Math.max(0,(0.78-wet)*0.7);
  }
  return 1.5;
}

export function aiTyreCrossoverDecision({
  driverId,
  teamId,
  rating={},
  currentCategory="dry",
  wetness=0,
  wetnessDelta=0,
  rainIntensity=0,
  lap=1,
  totalLaps=1,
  lastPitLap=null,
}={}){
  const current=String(currentCategory||"dry");
  const wet=clamp(wetness,0,1);
  const delta=Number(wetnessDelta)||0;
  const intensity=clamp(rainIntensity,0,1);
  const profile=tyreCrossoverProfile({driverId,teamId,rating});
  const intelligence=clamp(num(rating?.race_intelligence,60)/100,0,1);
  const adaptability=clamp(num(rating?.adaptability,60)/100,0,1);
  const trendAwareness=0.55+0.45*((intelligence+adaptability)/2);
  const rising=Math.max(0,delta)*trendAwareness;
  const falling=Math.max(0,-delta)*trendAwareness;
  const last=Number(lastPitLap);
  const lapsSincePit=Number.isFinite(last)?Number(lap)-last:Infinity;
  const cooldown=lapsSincePit<profile.cooldown_laps;
  const remaining=Math.max(0,Number(totalLaps)-Number(lap));

  let target=null;
  let threshold=null;
  let reason=null;
  let emergency=false;

  if(current==="dry"){
    threshold=profile.slick_to_inter
      -Math.min(0.025,rising*1.6)
      -Math.min(0.018,intensity*0.020)
      +Math.min(0.018,falling*1.2);
    emergency=wet>=0.40;
    if(wet>=0.78){target="wet";reason="wet_crossover";}
    else if(wet>=threshold){target="intermediate";reason="inter_crossover";}
  }else if(current==="intermediate"){
    const wetThreshold=profile.inter_to_wet
      -Math.min(0.035,rising*1.8)
      -Math.min(0.025,Math.max(0,intensity-0.55)*0.10);
    const dryThreshold=profile.inter_to_slick
      +Math.min(0.025,falling*1.5)
      +(intensity<=0.03?0.01:0);
    if(wet>=wetThreshold){
      target="wet";threshold=wetThreshold;reason="wet_crossover";emergency=wet>=0.90;
    }else if(wet<=dryThreshold&&delta<=0.004&&intensity<0.16){
      target="dry";threshold=dryThreshold;reason="slick_crossover";emergency=wet<=0.03;
    }
  }else if(current==="wet"){
    threshold=profile.wet_to_inter
      +Math.min(0.025,falling*1.5)
      -Math.min(0.018,rising*1.2);
    emergency=wet<=0.05;
    if(wet<=threshold&&intensity<0.70){
      target="intermediate";reason="inter_crossover";
    }
  }

  if(!target||target===current||remaining<=1){
    return {...profile,should_pit:false,target_category:null,threshold,reason:null,cooldown_active:cooldown};
  }
  if(cooldown&&!emergency){
    return {...profile,should_pit:false,target_category:target,threshold,reason,cooldown_active:true};
  }
  return {
    ...profile,
    should_pit:true,
    target_category:target,
    threshold:Number(num(threshold,wet).toFixed(3)),
    reason,
    cooldown_active:false,
    emergency,
  };
}
