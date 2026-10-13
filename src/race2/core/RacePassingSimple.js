// Canonical simple passing: one physical core for live and fast simulation.
// No battle-only speed multipliers or duplicate classification.
import {hashSeed} from "../../core/random.js";
import {
  nearestTrafficAhead,raceSlipstreamContext,raceTrafficPairKey,
  racePhysicalPassContext,RACE_TRAFFIC_HARD_GAP_M,
} from "./RaceTraffic.js";

const n=(v,f=0)=>v===null||v===undefined||v===""?f:Number.isFinite(Number(v))?Number(v):f;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,n(v,a)));
const round=(v)=>Number(n(v).toFixed(6));
const id=(c)=>String(c?.carId??"");
const pick=(cars,k)=>(cars||[]).find(c=>id(c)===String(k))||null;
const active=(c)=>Boolean(c&&!c.dnf&&!["dnf","finished"].includes(c.status)&&
  String(c?.pitState?.status||"track")==="track");
const stop=(c)=>Math.max(0,Math.floor(n(c?.pitState?.stopSequence)));
const rand=(s,k)=>hashSeed(String(s?.seed||"rw2")+"::simple-pass::"+k)/4294967296;
const set=(cars,c)=>cars.map(v=>id(v)===id(c)?c:v);
const event=(type,state,a,b,payload)=>({
  type,tick:n(state?.tick),timeMs:n(state?.simulationTimeMs),
  carIds:[id(a),id(b)],driverIds:[a?.driverId,b?.driverId],payload,
});
// The actual change of road order is physical at >= 1.5 m of clearance.
// Cars must remain laterally separated while yielding until the canonical
// hard 6 m traffic gap is restored. These are deliberately separate steps.
export const RACE_OVERTAKE_DECISIVE_CLEARANCE_M=1.5;
const gap=(s,a,b)=>{
  const l=Math.max(1,n(s?.track?.lengthM,5000));
  const difference=n(a?.absoluteDistanceM)-n(b?.absoluteDistanceM);
  return ((difference+l/2)%l+l)%l-l/2;
};
const clear=(c,result,until=0)=>({
  ...c,lateralOffsetM:0,
  battle:{...initialBattleState(),
    positionPassPairStints:c?.battle?.positionPassPairStints||{},
    lastCompletedOpponentCarId:c?.battle?.lastCompletedOpponentCarId||null,
    lastCompletedOpponentCooldownUntilMs:n(c?.battle?.lastCompletedOpponentCooldownUntilMs),
    result:result??c?.battle?.result??null,
    cooldownUntilMs:until||n(c?.battle?.cooldownUntilMs),
  },
});
const phase=(c,opponent,role,mode,side,attempt,started,deadline,result=null)=>({
  ...c,
  lateralOffsetM:round(side*(mode==="approach"?role==="attacker"?0.7:0.12:1.85)),
  battle:{...(c?.battle||initialBattleState()),phase:mode,role,side,
    opponentCarId:id(opponent),attemptId:attempt,startedAtMs:started,
    expiresAtMs:deadline,contactRiskPct:0,result,
  },
});

export function initialBattleState(){return {
  phase:"none",opponentCarId:null,role:null,side:0,attemptId:null,
  startedTick:null,startedAtMs:null,expiresAtMs:null,contactRiskPct:null,
  result:null,cooldownUntilMs:0,lastCompletedOpponentCarId:null,
  lastCompletedOpponentCooldownUntilMs:0,positionPassPairStints:{},
};}
export function raceBattlePaceMultiplier(){return 1;}

function matchup(a,b){
  const ad=a?.performance?.driver||{},dd=b?.performance?.driver||{};
  const ac=a?.performance?.car||{},dc=b?.performance?.car||{};
  const driverEdge=clamp(n(ad.overtaking,70)-n(dd.defending,70),-100,100);
  const carEdge=clamp(n(ac.race,70)-n(dc.race,70),-100,100);
  return {driverEdge,carEdge,edge:round(driverEdge*0.65+carEdge*0.35)};
}
const cooling=(state,a,b)=>{
  const now=n(state?.simulationTimeMs);
  const timed=(x,y)=>String(x?.battle?.lastCompletedOpponentCarId||"")===id(y)&&
    n(x?.battle?.lastCompletedOpponentCooldownUntilMs)>now;
  const locked=(x,y)=>{
    const ledger=x?.battle?.positionPassPairStints?.[id(y)];
    return Boolean(ledger&&n(ledger.own,-1)===stop(x)&&n(ledger.other,-1)===stop(y));
  };
  return timed(a,b)||timed(b,a)||locked(a,b)||locked(b,a);
};

// One source for the small opportunity scoring calculation and diagnostics.
export function raceOvertakeOpportunityFactors(state,a,b,{
  gapM=12,closingSpeedMs=2,towStrength=0,
}={}){
  const diff=matchup(a,b);
  const att=a?.performance?.driver||{},def=b?.performance?.driver||{};
  const attackerCompound=n(a?.tyre?.grip_index,75),defenderCompound=n(b?.tyre?.grip_index,75);
  const strategy=(c)=>String(c?.resources?.paceMode||"balanced")==="attack"?1:
    String(c?.resources?.paceMode||"balanced")==="conserve"?-1:0;
  const strategyEdge=strategy(a)-strategy(b);
  const tyreWear=(n(a?.tyre?.condition,100)-n(b?.tyre?.condition,100))/100;
  const damage=n(b?.damage?.pace_loss_s_per_lap)-n(a?.damage?.pace_loss_s_per_lap);
  const grip=n(a?.tyre?.grip_multiplier,1)-n(b?.tyre?.grip_multiplier,1);
  const contributions={
    gap:clamp((20-gapM)/20,0,1)*0.08,
    closing:clamp(closingSpeedMs/8,0,1)*0.13,
    driver:clamp(diff.driverEdge/45,-1,1)*0.18,
    car:clamp(diff.carEdge/45,-1,1)*0.11,
    compound:clamp((attackerCompound-defenderCompound)/20,-1,1)*0.06,
    tyre:clamp(grip/0.2,-1,1)*0.08,
    tyreWear:clamp(tyreWear,-1,1)*0.07,
    strategy:strategyEdge*0.07,
    damage:clamp(damage/7,-1,1)*0.07,
    tow:clamp(towStrength,0,1)*0.12,
  };
  const difficulty=clamp(n(state?.track?.traits?.overtakingDifficulty,50),0,100);
  const probability=clamp((0.17+Object.values(contributions).reduce((sum,v)=>sum+v,0))*
    (1.15-difficulty*0.007),0.02,0.78);
  return {probability:round(probability),
    driverEdge:diff.driverEdge,carEdge:diff.carEdge,
    strategyEdge,tyreGripEdge:round(grip),tyreConditionEdge:round(tyreWear),
    damageEdge:round(damage),attackerPace:String(a?.resources?.paceMode||"balanced"),
    defenderPace:String(b?.resources?.paceMode||"balanced"),
    contributions:Object.fromEntries(Object.entries(contributions).map(([k,v])=>[k,round(v)])),
  };
}

function opportunity(state,a,occupied,sectors){
  const probe={attackerCarId:id(a),defenderCarId:null,gapM:null,
    closingPotentialMs:null,probability:null,eligible:false};
  const no=reason=>({probe:{...probe,reason},pass:null});
  if(!active(a))return no("inactive_car");
  if(a?.battle?.phase&&a.battle.phase!=="none")return no("already_battling");
  if(n(a?.battle?.cooldownUntilMs)>n(state?.simulationTimeMs))return no("attacker_cooldown");
  if(occupied.has(id(a)))return no("attacker_occupied");
  if(n(a?.speedMs)<20)return no("speed_below_gate");
  const nearest=nearestTrafficAhead(state,a,{ignoreBattleOpponent:false});
  if(!nearest?.car)return no("no_ahead_car");
  const b=nearest.car;
  probe.defenderCarId=id(b);
  probe.gapM=round(nearest.gapM);
  if(!active(b))return no("defender_inactive");
  if(cooling(state,a,b))return no("recent_pair_cooldown");
  if(sectors.includes(n(a?.sector))||sectors.includes(n(b?.sector)))return no("local_yellow");
  if(occupied.has(id(b))||(b?.battle?.phase&&b.battle.phase!=="none"))return no("defender_battling");
  const severity=Math.max(n(a?.effectiveCornerSeverity),n(b?.effectiveCornerSeverity));
  if(severity>0.82)return no("corner_too_severe");
  const tow=raceSlipstreamContext(state,a,{nearest});
  const freeDiff=(n(a?.freeTargetSpeedKmh)+n(tow?.targetBonusKmh)-
    n(b?.freeTargetSpeedKmh))/3.6;
  const currentDiff=n(a?.speedMs)-n(b?.speedMs);
  const closing=Math.max(currentDiff,freeDiff);
  probe.closingPotentialMs=round(closing);
  if(closing<0.7)return no("closing_below_gate");
  if(nearest.gapM>Math.min(20,Math.max(12,closing*10+5)))return no("distance_beyond_reachable");
  const diff=matchup(a,b);
  const factors=raceOvertakeOpportunityFactors(state,a,b,{
    gapM:nearest.gapM,closingSpeedMs:closing,towStrength:n(tow?.strength),
  });
  const strategyEdge=factors.strategyEdge;
  const probability=factors.probability;
  probe.probability=round(probability);
  const roll=rand(state,"attempt:"+Math.floor(n(state?.simulationTimeMs)/1000)+":"+id(a)+":"+id(b));
  if(roll>=probability)return no("probability_roll");
  return {probe:{...probe,eligible:true,reason:"eligible"},
    pass:{a,b,gapM:nearest.gapM,closing,probability,roll,tow,diff,strategyEdge}};
}
export function diagnoseSimplePassGate(state,a){
  return opportunity(state,a,new Set(),[]).probe;
}

function processExisting(state,proposed,stepMs,sectors){
  let cars=[...proposed];
  const events=[],bypass=new Set(),seen=new Set();
  const next=n(state?.simulationTimeMs)+stepMs;
  for(const old of state?.cars||[]){
    if(old?.battle?.role!=="attacker"||
       !["approach","side_by_side","yielding"].includes(old?.battle?.phase))continue;
    const attempt=String(old.battle.attemptId||"");
    if(!attempt||seen.has(attempt))continue;
    seen.add(attempt);
    const opponent=pick(state.cars,old.battle.opponentCarId);
    let a=pick(cars,id(old)),b=pick(cars,old.battle.opponentCarId);
    if(!a||!b||!opponent)continue;
    const separation=gap(state,a,b),pair=raceTrafficPairKey(a,b);
    const oldSide=n(old?.battle?.side,1)||1;
    if(old.battle.phase==="yielding"){
      const direction=old.battle.result==="completed"?1:-1;
      // Recover the normal traffic model within a bounded time. The old
      // implementation refreshed the yielding deadline every 100 ms, keeping
      // cars busy for entire stints when exactly 6 m of separation was never
      // attained. Traffic spacing owns the hard longitudinal gap thereafter.
      const deadline=n(old.battle.expiresAtMs,next+stepMs);
      if(separation*direction>=RACE_TRAFFIC_HARD_GAP_M-1e-6||next>=deadline){
        a=clear(a,old.battle.result);b=clear(b,b.battle?.result);
      }else{
        a=phase(a,b,"attacker","yielding",oldSide,attempt,
          n(old.battle.startedAtMs),deadline,old.battle.result);
        b=phase(b,a,"defender","yielding",-oldSide,attempt,
          n(old.battle.startedAtMs),deadline,b.battle?.result);
        // The lateral lane is still occupied; keep the physical pair
        // excluded from same-lane traffic spacing until safely rejoined.
        bypass.add(pair);
      }
      cars=set(set(cars,a),b);continue;
    }
    if(!active(a)||!active(b)||sectors.includes(n(old.sector))||
       sectors.includes(n(opponent.sector))){
      a=clear(a,"aborted",next+500);b=clear(b,"aborted",next+500);
      events.push(event("overtake_aborted",state,a,b,{attemptId:attempt,
        reason:"opponent_unavailable_or_yellow"}));
      cars=set(set(cars,a),b);continue;
    }
    const delta=(separation-gap(state,old,opponent))/(Math.max(stepMs,1)/1000);
    if(separation>=RACE_OVERTAKE_DECISIVE_CLEARANCE_M){
      const pass=racePhysicalPassContext(state,a,b);
      const fullyClear=separation>=RACE_TRAFFIC_HARD_GAP_M-1e-6;
      const until=next+15000;
      if(fullyClear){
        a=clear(a,"completed",next+500);
        b=clear(b,"lost",next+500);
      }else{
        // Record the official overtake once position is physically won,
        // but retain the lateral lanes until the full clearance is reached.
        // A fixed recovery deadline prevents the old indefinite-yield loop.
        a=phase(a,b,"attacker","yielding",oldSide,attempt,
          n(old.battle.startedAtMs),next+2000,"completed");
        b=phase(b,a,"defender","yielding",-oldSide,attempt,
          n(old.battle.startedAtMs),next+2000,"lost");
      }
      a={...a,battle:{...a.battle,
        lastCompletedOpponentCarId:id(b),lastCompletedOpponentCooldownUntilMs:until}};
      b={...b,battle:{...b.battle,
        lastCompletedOpponentCarId:id(a),lastCompletedOpponentCooldownUntilMs:until}};
      if(pass.kind==="position"){
        a={...a,battle:{...a.battle,positionPassPairStints:{
          ...(a.battle?.positionPassPairStints||{}),
          [id(b)]:{own:stop(a),other:stop(b)},
        }}};
        b={...b,battle:{...b.battle,positionPassPairStints:{
          ...(b.battle?.positionPassPairStints||{}),
          [id(a)]:{own:stop(b),other:stop(a)},
        }}};
      }
      bypass.add(pair);
      events.push(event("overtake_completed",state,a,b,{
        attemptId:attempt,clearanceM:round(separation),actualClosingMs:round(delta),
        fullyClear,passKind:pass.kind,relativeLapOffset:pass.relativeLapOffset,
        elapsedMs:round(next-n(old.battle.startedAtMs)),
      }));
      cars=set(set(cars,a),b);continue;
    }
    const timedOut=next>=n(old.battle.expiresAtMs,next);
    if(separation<=-24||timedOut){
      const reason=separation<=-24?"defender_clear":
        old.battle.phase==="approach"?"approach_timeout":"timeout";
      if(separation>-RACE_TRAFFIC_HARD_GAP_M){
        a=phase(a,b,"attacker","yielding",oldSide,attempt,
          n(old.battle.startedAtMs),next+1000,"failed");
        b=phase(b,a,"defender","yielding",-oldSide,attempt,
          n(old.battle.startedAtMs),next+1000,"defended");
      }else{
        a=clear(a,"failed",next+5000);b=clear(b,"defended",next+5000);
      }
      events.push(event("overtake_failed",state,a,b,{
        attemptId:attempt,reason,finalGapM:round(Math.max(0,-separation)),
        physicalClearanceM:round(separation),actualClosingMs:round(delta),
        elapsedMs:round(next-n(old.battle.startedAtMs)),
      }));
      cars=set(set(cars,a),b);continue;
    }
    const mode=separation>=-7.5?"side_by_side":"approach";
    a=phase(a,b,"attacker",mode,oldSide,attempt,n(old.battle.startedAtMs),
      n(old.battle.expiresAtMs));
    b=phase(b,a,"defender",mode,-oldSide,attempt,n(old.battle.startedAtMs),
      n(old.battle.expiresAtMs));
    if(mode==="side_by_side"&&old.battle.phase==="approach"){
      events.push(event("overtake_side_by_side",state,a,b,{
        attemptId:attempt,gapM:round(Math.max(0,-separation)),actualClosingMs:round(delta),
      }));
    }
    bypass.add(pair);cars=set(set(cars,a),b);
  }
  return {cars,events,bypassPairs:bypass};
}

export function resolveSimpleRacePassing(state,proposedCars,{
  stepMs=100,blockedPairs=null,blockedSectors=null,
}={}){
  const sectors=Array.isArray(blockedSectors)?blockedSectors.map(Number):[];
  const existing=processExisting(state,proposedCars,stepMs,sectors);
  let cars=existing.cars;
  const events=[...existing.events],bypassPairs=new Set(existing.bypassPairs);
  const occupied=new Set();
  for(const p of blockedPairs||[])for(const x of String(p).split("|"))occupied.add(x);
  for(const c of cars){
    if(c?.battle?.phase&&c.battle.phase!=="none"){
      occupied.add(id(c));if(c?.battle?.opponentCarId)occupied.add(String(c.battle.opponentCarId));
    }
  }
  const candidates=[...(state?.cars||[])].sort((a,b)=>
    n(b.absoluteDistanceM)-n(a.absoluteDistanceM)||id(a).localeCompare(id(b)));
  const now=n(state?.simulationTimeMs);
  for(const old of candidates){
    const result=opportunity(state,old,occupied,sectors);
    if(!result.pass)continue;
    const {a:preA,b:preB,gapM,closing,probability,roll,tow,diff,strategyEdge}=result.pass;
    let a=pick(cars,id(preA)),b=pick(cars,id(preB));
    if(!a||!b)continue;
    const attempt=[state?.weekendKey||"race",state?.tick||0,id(a),id(b)].join(":");
    const side=rand(state,"side:"+attempt)<0.5?-1:1;
    const duration=clamp(1250*(gapM+RACE_TRAFFIC_HARD_GAP_M)/
      Math.max(0.8,closing),12000,20000);
    a=phase(a,b,"attacker","approach",side,attempt,now,now+duration);
    b=phase(b,a,"defender","approach",-side,attempt,now,now+duration);
    a={...a,battle:{...a.battle,startedTick:state?.tick}};
    b={...b,battle:{...b.battle,startedTick:state?.tick}};
    occupied.add(id(a));occupied.add(id(b));
    const pass=racePhysicalPassContext(state,preA,preB);
    events.push(event("overtake_started",state,a,b,{
      attemptId:attempt,passKind:pass.kind,relativeLapOffset:pass.relativeLapOffset,
      gapM:round(gapM),probability:round(probability),roll:round(roll),
      closingPotentialMs:round(closing),durationMs:round(duration),
      driverEdge:round(diff.driverEdge),carEdge:round(diff.carEdge),
      strategyEdge:round(strategyEdge),towStrength:round(tow?.strength),
      towBonusKmh:round(tow?.targetBonusKmh),phase:"approach",
      trackPhase:Math.max(n(preA?.effectiveCornerSeverity),
        n(preB?.effectiveCornerSeverity))>0.3?"corner":"straight",
    }));
    cars=set(set(cars,a),b);
  }
  return {cars,events,bypassPairs};
}

export const diagnoseRaceOvertakeGate=diagnoseSimplePassGate;
export const resolveRaceOvertaking=resolveSimpleRacePassing;
export const overtakeAttemptProbability=(state,a,b,options={})=>
  raceOvertakeOpportunityFactors(state,a,b,options).probability;
export const battleContactProbability=()=>0;
export const completedBattlePairCoolingDown=cooling;
export const raceBattlePerformanceMatchup=matchup;
