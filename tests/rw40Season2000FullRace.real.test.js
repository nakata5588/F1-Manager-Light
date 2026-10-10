// Real historical 2000 Australian GP: full grid, full circuit, full race distance.
// All car ratings come from the generated Season Pack; the canonical Race Core
// is shared by fast simulation and live execution. No one-lap synthetic track.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";
import {
  createRaceWeekendState,completePracticeSession,
  completeQualifyingSession,continueRaceWeekendSession,
} from "../src/engine/RaceWeekendEngine.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";
import { buildRaceWeekendInput } from "../src/race2/adapters/GameStateInputAdapter.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";
import { createLiveRaceRunner,runFastRaceToEnd } from "../src/race2/core/RaceRunner.js";
import { projectCanonicalRaceStateToOfficialRows } from "../src/race2/adapters/OfficialRaceResultProjection.js";
import { materializeOfficialRaceRows } from "../src/engine/RaceFinalizationEngine.js";
import { summarizeRaceBehaviour } from "../src/race2/diagnostics/RaceBehaviourAudit.js";
import { diagnoseRaceOvertakeGate } from "../src/race2/core/RaceOvertaking.js";
import { diagnoseRaceBattleContexts } from "../src/race2/diagnostics/OvertakingFunnelAudit.js";
import { nearestTrafficAhead } from "../src/race2/core/RaceTraffic.js";
import { raceResourcePerformance } from "../src/race2/core/RaceResources.js";

async function season2000(){
  const file=new URL("../public/data/seasons/2000/season.json",import.meta.url);
  return JSON.parse(await fs.readFile(file,"utf8"));
}

test("2000 Australian GP: 22 historic starters complete 58 laps in canonical Live/Autosim parity",{
  timeout:1_500_000,
},async()=>{
  const pack=await season2000();
  assert.equal(pack.validation?.ok,true,JSON.stringify(pack.validation));
  assert.equal(pack.state.teams.length,11);
  assert.equal(pack.state.carStats.filter(r=>r.generation_source==="historical_results_inference").length,11);
  const gp=pack.state.calendar[0];
  assert.match(String(gp?.gp_name),/Australian/i);
  const ferrari=pack.state.teams.find(t=>String(t.team_name).toLowerCase()==="ferrari");
  assert.ok(ferrari);
  const seats=(pack.state.contracts||[]).filter(isRaceDriverContract);
  const garageByTeam={};
  for(const t of pack.state.teams){
    const tid=String(t.team_id);
    const teamSeats=seats.filter(c=>String(c.team_id)===tid);
    assert.ok(teamSeats.length>=2,`2000 ${t.team_name} must have two race seats`);
    garageByTeam[tid]={
      cars:[1,2].map(slot=>({
        id:tid===String(ferrari.team_id)?`car_${slot}`:`${tid}_race_${slot}`,kind:"race",
        driver_id:String(teamSeats[slot-1].driver_id),
        componentCondition:{engine:100,suspension:100},
      })),
    };
  }
  const date=String(gp?.race_date??gp?.dateISO).slice(0,10);
  let gs={
    ...pack.state,activeYear:2000,currentRound:0,currentDateISO:date,
    saveMeta:{seed:"real-2000-australia-full-distance"},
    team:ferrari,
    driverAttributes:{},driverAvailability:{},medicalHistory:[],
    temporaryDriverAssignments:[],
    standings:{drivers:[],teams:[]},results:[],inbox:[],financeLog:[],
    finances:{balance:10_000_000,budget:10_000_000,season_spend:0,season_income:0},
    settings:{gameplay:{enableInjuryRandomEvents:false,enableFatalities:false}},
    garage:garageByTeam[String(ferrari.team_id)],
    aiTechnicalWorld:{teams:Object.fromEntries(
      pack.state.teams.filter(t=>String(t.team_id)!==String(ferrari.team_id))
        .map(t=>[String(t.team_id),{garage:garageByTeam[String(t.team_id)]}])
    )},
  };
  gs=createRaceWeekendState(gs,{roundIndex:0,gp,engineVersion:"rw2"});
  assert.equal(gs.raceWeekendState.phase,"practice");
  const confirmed=gs.raceEntryState.entries.filter(e=>e.status==="confirmed"&&e.car_id&&e.driver_id);
  assert.equal(confirmed.length,22,"all historical grid slots must have valid physical cars and drivers");
  gs=completePracticeSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"practice_complete");
  let qualifyingSessions=0;
  for(let i=0;i<8&&gs.raceWeekendState.phase!=="grid_ready";i++){
    gs={...gs,currentDateISO:String(gs.raceWeekendState.raceDate).slice(0,10)};
    gs=continueRaceWeekendSession(gs);
    if(gs.raceWeekendState.phase==="qualifying"){
      gs=completeQualifyingSession(gs,{gp});
      qualifyingSessions++;
    }
  }
  assert.ok(qualifyingSessions>=1);
  assert.equal(gs.raceWeekendState.phase,"grid_ready");
  const input=buildRaceWeekendInput(gs,{gp});
  assert.equal(input.engineVersion,"rw2");
  assert.equal(input.year,2000);
  assert.equal(input.entries.length,22);
  assert.equal(input.drivers.length,22);
  if(input.cars.length!==22){
    const carIds=new Set(input.cars.map(c=>c.carId));
    const missing=input.entries.filter(e=>!carIds.has(e.carId)).map(e=>({
      driverId:e.driverId,teamId:e.teamId,carId:e.carId,
      garages:e.teamId===String(ferrari.team_id)
        ?(gs.garage?.cars||[]).map(c=>c.id)
        :(gs.aiTechnicalWorld?.teams?.[e.teamId]?.garage?.cars||[]).map(c=>c.id),
    }));
    console.log("REAL_2000_MISSING_CARS="+JSON.stringify({missing,carCount:input.cars.length,
      inputTeamCount:new Set(input.entries.map(e=>e.teamId)).size,
      weekendEntries:gs.raceWeekendState.entrants.length,
      raceEntries:gs.raceEntryState.entries.length}));
  }
  assert.equal(input.cars.length,22);
  assert.equal(input.startingGrid.length,22);
  assert.equal(new Set(input.cars.map(c=>c.carId)).size,22);
  assert.equal(input.track.laps,58,"must simulate 2000 Albert Park's full 58-lap distance");
  assert.ok(input.track.lengthM>5000&&input.track.lengthM<5500,
    "must use the actual 2000 Albert Park circuit length, not a synthetic track");
  for(const car of input.cars){
    assert.equal(car.performance.race,teamCarPerformance(gs,car.teamId,car.driverId).race);
  }
  // Integration guard: the same official 2000 grid must use real nominated
  // Bridgestone dry compounds and a physical, non-neutral speed profile.
  const combinedDryTyreNames=[...new Set(input.cars.flatMap(c=>
    c.resourceSetup?.tyres||[]).filter(t=>t.category==="dry").map(t=>t.compound_name))].sort();
  assert.deepEqual(combinedDryTyreNames,["Medium","Soft"],
    "2000 Australia was supplied Bridgestone Medium/Soft, not generic Hard/Soft");
  assert.ok((input.track.speedProfile?.samples?.length||0)>=100,
    "Albert Park 2000 must not regress to a neutral all-straight track");
  const combinedTyreSupplier=new Set(input.cars.flatMap(c=>
    c.resourceSetup?.tyres||[]).map(t=>t.supplier));
  assert.deepEqual([...combinedTyreSupplier],["Bridgestone"]);
  const initial=startRaceState(createRaceState(input));
  assert.equal(initial.cars.length,22);
  const withDrySpec=initial.cars.filter(car=>car.tyre.category==="dry");
  assert.ok(withDrySpec.length>=18,"dry running grid should have most cars on dry rubber");
  assert.ok(withDrySpec.every(car=>
    car.resources.strategy.drySpecificationLocked===true&&
    car.resources.availableTyres.filter(t=>t.category==="dry").length===1&&
    car.resources.availableTyres.some(t=>t.tyre_id===car.tyre.tyre_id)
  ),"historical single dry specification must be enforced by Race Core");
  const fast=runFastRaceToEnd(initial,{maxSteps:150000});
  assert.equal(fast.status,"finished");
  assert.ok(fast.tick>1000);
  const finishers=fast.cars.filter(c=>c.status==="finished");
  assert.ok(finishers.length>0,"full-distance GP needs at least one classified finisher");
  assert.ok(finishers.some(c=>c.completedLaps===58),
    "at least one car must cross the complete race distance");
  const live=createLiveRaceRunner(initial);
  // Classify completed on-track passes using physical absolute lap distance
  // at the event tick. Passing a lapped car is not a change of race position.
  // The half-lap proximity guard tolerates start/finish line crossings.
  const completedPassContexts=[];
  const quarterOfLap=lap=>lap<=15?"laps_1_15":lap<=30?"laps_16_30":lap<=45?"laps_31_45":"laps_46_58";
  const gateAudit=Object.fromEntries(["laps_1_15","laps_16_30","laps_31_45","laps_46_58"].map(name=>
    [name,{
      samples:0,activeTrackCarSamples:0,
      potentialCandidates:0,
      byGateReason:{},
      nearestWithin25m:0,
      sameDistanceWithin25m:0,
      lappingWithin25m:0,
      sameDistanceFreeAdvantageKmh2:0,
      sameDistanceTrafficLimited:0,
      sameDistanceGripAdvantage2Pct:0,
      sameDistanceBadClosing:0,
      freeAdvantageAndTrafficLimited:0,
      freeAdvantageAndBadClosing:0,
      freeAdvantageTrafficLimitedAndBadClosing:0,
      starts:0,
      completedPasses:0,
    }]
  ));
  let sampledMaxSpeedKmh=0;
  let priorEventCount=0;
  for(let tick=0;tick<fast.tick;tick++){
    const next=live.step();
    const leadingLap=Math.min(58,Math.max(0,...next.cars.map(car=>Number(car.completedLaps)||0))+1);
    const quarter=quarterOfLap(leadingLap);
    const interval=gateAudit[quarter];
    // The gate is the same one used by Race Core. Sample at 2s intervals
    // without changing any car, battle, probability roll or event.
    if(tick%20===0){
      interval.samples++;
      for(const car of next.cars){
        if(car.dnf||car.status==="dnf"||car.status==="finished"||
          String(car.pitState?.status??"track")!=="track")continue;
        interval.activeTrackCarSamples++;
        const gate=diagnoseRaceOvertakeGate(next,car);
        interval.byGateReason[gate.reason]=(interval.byGateReason[gate.reason]||0)+1;
        if(gate.eligible)interval.potentialCandidates++;
        const near=nearestTrafficAhead(next,car,{ignoreBattleOpponent:false});
        if(!near?.car||Number(near.gapM)>25)continue;
        interval.nearestWithin25m++;
        const directDistanceGap=Math.abs(Number(car.absoluteDistanceM)-Number(near.car.absoluteDistanceM));
        const sameDistance=directDistanceGap<Number(input.track.lengthM)*0.5;
        if(!sameDistance){interval.lappingWithin25m++;continue;}
        interval.sameDistanceWithin25m++;
        const attackerFree=Number(car.freeTargetSpeedKmh)||0;
        const defenderFree=Number(near.car.freeTargetSpeedKmh)||0;
        const freeAdvantage=attackerFree-defenderFree>=2;
        const trafficLimited=Boolean(car.traffic?.limited);
        const poorActualClosing=Number(car.speedMs)-Number(near.car.speedMs)<0.2;
        if(freeAdvantage)interval.sameDistanceFreeAdvantageKmh2++;
        if(trafficLimited)interval.sameDistanceTrafficLimited++;
        if(poorActualClosing)interval.sameDistanceBadClosing++;
        if(freeAdvantage&&trafficLimited)interval.freeAdvantageAndTrafficLimited++;
        if(freeAdvantage&&poorActualClosing)interval.freeAdvantageAndBadClosing++;
        if(freeAdvantage&&trafficLimited&&poorActualClosing)
          interval.freeAdvantageTrafficLimitedAndBadClosing++;
        const attackGrip=Number(raceResourcePerformance(car).tyreGripMultiplier)||0;
        const defendGrip=Number(raceResourcePerformance(near.car).tyreGripMultiplier)||0;
        if(attackGrip-defendGrip>=0.02)interval.sameDistanceGripAdvantage2Pct++;
      }
    }
    // Periodic canonical speed samples; read-only and deliberately lightweight.
    if(tick%25===0){
      for(const car of next.cars)sampledMaxSpeedKmh=Math.max(
        sampledMaxSpeedKmh,Number(car.speedKmh)||0
      );
    }
    if(next.events.length>priorEventCount){
      const newEvents=next.events.slice(priorEventCount);
      for(const event of newEvents){
        if(event.type==="overtake_started")interval.starts++;
        if(event.type==="overtake_completed")interval.completedPasses++;
        if(event.type!=="overtake_completed")continue;
        const attacker=next.cars.find(c=>String(c.carId)===String(event?.carIds?.[0]));
        const defender=next.cars.find(c=>String(c.carId)===String(event?.carIds?.[1]));
        if(!attacker||!defender)continue;
        const absoluteSeparationM=Math.abs(
          Number(attacker.absoluteDistanceM)-Number(defender.absoluteDistanceM)
        );
        const sameLapProximity=absoluteSeparationM<input.track.lengthM*0.5;
        completedPassContexts.push({
          attemptId:String(event?.payload?.attemptId??""),
          driverId:attacker.driverId,
          teamId:attacker.teamId,
          defenderId:defender.driverId,
          lap:Number(attacker.completedLaps||0)+1,
          sameLapProximity,
          canonicalPassKind:String(event?.payload?.passKind??"unknown"),
          absoluteSeparationM:Number(absoluteSeparationM.toFixed(3)),
        });
      }
      priorEventCount=next.events.length;
    }
  }
  assert.deepEqual(live.getState(),fast,"Live and Autosim must converge to identical canonical state");
  console.log("RW41_MID_RACE_GATE_DIAGNOSTIC="+JSON.stringify({
    scenario:"real 2000 Australia, same engine and seed, 2s samples of every on-track car",
    caveats:["pre-attempt reasons are prioritized by canonical gate order",
      "nearest within25m and same-distance classifications are physical proximity proxies",
      "probability_roll samples include a deterministic random gate, not guaranteed attempts"],
    quarters:gateAudit,
  }));
  const official=projectCanonicalRaceStateToOfficialRows(gs,fast);
  const archived=materializeOfficialRaceRows(official);
  assert.equal(archived.length,22,"all 22 starting drivers need an official result (including DNF)");
  assert.equal(new Set(archived.map(r=>String(r.driver_id))).size,22);
  assert.ok(archived.every(r=>r.team_id&&r.status));
  // Read-only 2000 behaviour measurement. Results position changes alone are
  // not proof of on-track overtakes: DNF, pit cycles and strategy also matter.
  const behaviour=summarizeRaceBehaviour(fast,{scenario:"2000-Australia-real-58-laps"});
  const battleTypes=new Set([
    "overtake_started","overtake_side_by_side","overtake_completed",
    "overtake_failed","overtake_aborted","overtake_approach_extended","contact",
  ]);
  const battleEvents=(fast.events||[]).filter(event=>battleTypes.has(event?.type));
  const attempts=battleEvents.filter(event=>event.type==="overtake_started");
  const successes=battleEvents.filter(event=>event.type==="overtake_completed");
  const terminal=battleEvents.filter(event=>[
    "overtake_completed","overtake_failed","overtake_aborted","contact",
  ].includes(event.type));
  const terminalAttemptIds=new Set(terminal.map(event=>event?.payload?.attemptId).filter(Boolean));
  const unresolved=attempts.filter(event=>!terminalAttemptIds.has(event?.payload?.attemptId));
  const passesByDriver={};
  const passesByTeam={};
  for(const event of successes){
    const driverId=String(event?.driverIds?.[0]||"unknown");
    const carId=String(event?.carIds?.[0]||"");
    const teamId=String(fast.cars.find(c=>String(c.carId)===carId)?.teamId||"unknown");
    passesByDriver[driverId]=(passesByDriver[driverId]||0)+1;
    passesByTeam[teamId]=(passesByTeam[teamId]||0)+1;
  }
  const times=attempts.map(e=>Number(e?.timeMs)).filter(Number.isFinite).sort((a,b)=>a-b);
  const raceEndMs=Number(fast.simulationTimeMs??0);
  const boundaries=[0,...times,raceEndMs];
  const gapsMs=boundaries.slice(1).map((value,index)=>Math.max(0,value-boundaries[index]));
  const quietestHours=Math.max(0,...gapsMs)/3_600_000;
  const pairedFailures=terminal.filter(e=>e.type==="overtake_failed")
    .reduce((acc,e)=>{const reason=String(e?.payload?.reason??"unknown");acc[reason]=(acc[reason]||0)+1;return acc;},{});
  const completionIds=new Set(successes.map(e=>String(e?.payload?.attemptId??"")));
  const extensionEvents=battleEvents.filter(e=>e.type==="overtake_approach_extended");
  const extendedAttemptIds=new Set(extensionEvents.map(e=>String(e?.payload?.attemptId??"")));
  const sideBySideIds=new Set(battleEvents
    .filter(e=>e.type==="overtake_side_by_side")
    .map(e=>String(e?.payload?.attemptId??"")));
  const measuredMetrics=["driverEdge","carEdge","tyreGripEdge","strategyEdge","tyreConditionEdge","damageEdge"];
  const averagesFor=rows=>Object.fromEntries(measuredMetrics.map(key=>{
    const values=rows.map(e=>Number(e?.payload?.[key])).filter(Number.isFinite);
    return [key,values.length
      ?Number((values.reduce((sum,n)=>sum+n,0)/values.length).toFixed(4))
      :null];
  }));
  const completedStarts=attempts.filter(e=>completionIds.has(String(e?.payload?.attemptId??"")));
  const nonCompletedStarts=attempts.filter(e=>!completionIds.has(String(e?.payload?.attemptId??"")));
  const countBy=(values,keyOf)=>values.reduce((acc,row)=>{
    const key=String(keyOf(row)??"unknown");
    acc[key]=(acc[key]||0)+1;
    return acc;
  },{});
  const uniqueOpponentPairs=new Set(
    successes.map(e=>[...e.driverIds].map(String).sort().join("|"))
  ).size;
  const approximatePositionPasses=completedPassContexts.filter(row=>row.sameLapProximity);
  const approximateLappingPasses=completedPassContexts.filter(row=>!row.sameLapProximity);
  const canonicalPassKinds=countBy(successes,event=>event?.payload?.passKind??"unknown");
  const canonicalStartKinds=countBy(attempts,event=>event?.payload?.passKind??"unknown");
  const positionPasses=completedPassContexts.filter(row=>row.canonicalPassKind==="position");
  const lappingPasses=completedPassContexts.filter(row=>row.canonicalPassKind==="lapping");
  const unlappingPasses=completedPassContexts.filter(row=>row.canonicalPassKind==="unlapping");
  const positionalPassesByPair=countBy(approximatePositionPasses,row=>
    [row.driverId,row.defenderId].map(String).sort().join("|")
  );
  const positionalPairCounts=Object.values(positionalPassesByPair);
  const battleAudit={
    scenario:"real 2000 Australian Grand Prix",
    measurement:"canonical event stream; counts do not treat grid-to-finish changes as passes",
    entrants:input.entries.length,laps:input.track.laps,simulationTimeMs:raceEndMs,
    attempts:attempts.length,
    completed:successes.length,
    failed:behaviour.overtakes.failed,
    aborted:behaviour.overtakes.aborted,
    contactEvents:behaviour.overtakes.contacts,
    sideBySideTransitionsRecorded:battleEvents.filter(e=>e.type==="overtake_side_by_side").length,
    approachExtensions:extensionEvents.length,
    attemptsWithApproachExtensions:extendedAttemptIds.size,
    extendedAttemptsReachingSideBySide:[...extendedAttemptIds].filter(id=>sideBySideIds.has(id)).length,
    extendedAttemptsCompleted:[...extendedAttemptIds].filter(id=>completionIds.has(id)).length,
    unresolvedAttemptIds:unresolved.length,
    failedReasons:pairedFailures,
    completionPct:attempts.length?Number((successes.length/attempts.length*100).toFixed(2)):null,
    averageStartGapM:behaviour.overtakes.averageStartGapM,
    averageClosingPotentialMs:behaviour.overtakes.averageClosingPotentialMs,
    averagePlannedBattleDurationMs:behaviour.overtakes.averageDurationMs,
    longestNoAttemptMinutes:Number((quietestHours*60).toFixed(2)),
    firstAttemptAtMinute:times.length?Number((times[0]/60000).toFixed(2)):null,
    lastAttemptAtMinute:times.length?Number((times[times.length-1]/60000).toFixed(2)):null,
    passesByTeam,passesByDriver,
    sameLapPhysicalPasses:approximatePositionPasses.length,
    lappingOrUnlappingPhysicalPasses:approximateLappingPasses.length,
    canonicalBattleStartsByKind:canonicalStartKinds,
    canonicalCompletedPassesByKind:canonicalPassKinds,
    canonicalPositionPassesByRaceQuarter:countBy(positionPasses,row=>quarterOfLap(row.lap)),
    canonicalLappingPasses:lappingPasses.length,
    canonicalUnlappingPasses:unlappingPasses.length,
    uniqueSameLapOpponentPairs:positionalPairCounts.length,
    sameLapPairsWithRepeatPasses:positionalPairCounts.filter(value=>value>1).length,
    maximumSameLapPassesBetweenOnePair:Math.max(0,...positionalPairCounts),
    completedPassContextsRecorded:completedPassContexts.length,
    uniqueOpponentPairsWithCompletedPass:uniqueOpponentPairs,
    sameLapPassesByRaceQuarter:countBy(approximatePositionPasses,row=>
      row.lap<=15?"laps_1_15":row.lap<=30?"laps_16_30":row.lap<=45?"laps_31_45":"laps_46_58"),
    startsByAttackerPaceMode:countBy(attempts,e=>e?.payload?.attackerPaceMode??"unknown"),
    completedByAttackerPaceMode:countBy(completedStarts,e=>e?.payload?.attackerPaceMode??"unknown"),
    startFactorMeansSuccessful:averagesFor(completedStarts),
    startFactorMeansUnsuccessful:averagesFor(nonCompletedStarts),
    passProximityRule:"abs(driver absolute distances) < half one lap at event tick; approximate position pass proxy",
    eventTypes:behaviour.eventTypes,
    note:"RW38 approach and physical side-by-side transition diagnostics on experimental RW39 stack.",
  };
  assert.equal(behaviour.fieldSize,22);
  assert.equal(battleAudit.completed,Object.values(passesByDriver).reduce((s,n)=>s+n,0));
  assert.equal(completedPassContexts.length,successes.length,
    "every completed pass should retain its two physical drivers at the event tick");
  assert.equal(approximatePositionPasses.length+approximateLappingPasses.length,successes.length);
  assert.equal(positionPasses.length+lappingPasses.length+unlappingPasses.length,successes.length,
    "every completion must have a canonical physical pass kind");
  assert.equal(positionPasses.length,approximatePositionPasses.length,
    "canonical pass labels should agree with the legacy physical-distance proxy");
  assert.equal(lappingPasses.length+unlappingPasses.length,approximateLappingPasses.length);
  // One-to-one attempt IDs, not aggregate completion counts, identify the
  // real bottleneck in competitive passes vs backmarker traffic.
  const contextFunnel=diagnoseRaceBattleContexts(battleEvents);
  assert.equal(contextFunnel.total.attempts,attempts.length);
  assert.equal(contextFunnel.total.completed,successes.length);
  assert.equal(contextFunnel.byStartKind.position.attempts,canonicalStartKinds.position??0);
  assert.equal(contextFunnel.byStartKind.position.completedByPassKind.position??0,
    canonicalPassKinds.position??0,
    "completion context should agree with start context for historical benchmark");
  assert.equal(contextFunnel.orphanTerminals,0,
    "every canonical outcome must be paired to an attempt");
  console.log("RW44_POSITION_BATTLE_FUNNEL="+JSON.stringify(contextFunnel));
  console.log("REAL_2000_BATTLE_AUDIT="+JSON.stringify(battleAudit));

  const summary={
    gp:gp.gp_name,year:2000,
    track:input.track.trackId,circuit_m:input.track.lengthM,laps:input.track.laps,
    entrants:input.entries.length,starting_grid:input.startingGrid.length,
    finished:finishers.length,dnf:fast.cars.filter(c=>c.dnf||c.status==="dnf").length,
    steps:fast.tick,live_autosim_parity:true,official_results:archived.length,
    classification:archived.map(r=>({
      driver_id:r.driver_id,team_id:r.team_id,position:r.pos,
      status:r.status,finish_ms:r.total_time_ms,
    })),
  };
  console.log("REAL_2000_FULL_RACE_AUDIT="+JSON.stringify(summary));
  const fastest=fast.cars.filter(car=>Number(car.bestLapMs)>0)
    .sort((a,b)=>Number(a.bestLapMs)-Number(b.bestLapMs))[0];
  const winner=fast.cars.find(car=>String(car.driverId)===String(archived[0]?.driver_id));
  const sampleCount=input.track?.speedProfile?.samples?.length||0;
  // Counterfactual isolated calibration: same historical grid/car/driver snapshots
  // and same circuit, but dry track throughout. The generated career's actual
  // forecast/rain scenario above remains unchanged and fully parity-tested.
  const dryInput=structuredClone(input);
  dryInput.weather={
    ...dryInput.weather,
    state:"SUNNY",wet_race:false,rain_intensity:0,
    starting_track_wetness:0,track_wetness:0,
    segments:[{from_lap:1,to_lap:58,state:"SUNNY"}],
    timeline:[],
  };
  let normalizedWetStarts=0;
  for(const car of dryInput.cars){
    const tyres=car.resourceSetup?.tyres||[];
    const planned=car.resourceSetup?.strategy?.startTyreId;
    const selected=tyres.find(t=>String(t.tyre_id)===String(planned));
    if(selected&&selected.category!=="dry"){
      const dryTyre=tyres.filter(t=>t.category==="dry")
        .sort((a,b)=>Number(a.wear_rate)-Number(b.wear_rate))[0];
      assert.ok(dryTyre,"dry calibration requires a dry tyre in every team's allocation");
      car.resourceSetup.strategy.startTyreId=dryTyre.tyre_id;
      normalizedWetStarts++;
    }
  }
  const dryInitial=startRaceState(createRaceState(dryInput));
  const dryFast=runFastRaceToEnd(dryInitial,{maxSteps:150000});
  assert.equal(dryFast.status,"finished");
  const dryFastest=dryFast.cars.filter(car=>Number(car.bestLapMs)>0)
    .sort((a,b)=>Number(a.bestLapMs)-Number(b.bestLapMs))[0];
  const dryWinner=dryFast.cars.filter(car=>car.status==="finished")
    .sort((a,b)=>Number(a.finishTimeMs)-Number(b.finishTimeMs))[0];
  const history=(car)=>car?.pitState?.history||[];
  const lapDistribution=(car)=>{
    const laps=(car?.lapTimes||[]).map(row=>typeof row==="number"?row:
      Number(row?.lapTimeMs??row?.lap_time_ms??row?.timeMs??row?.durationMs??NaN))
      .filter(Number.isFinite).filter(n=>n>10000);
    const sorted=[...laps].sort((a,b)=>a-b);
    return {n:laps.length,medianMs:sorted.length?sorted[Math.floor(sorted.length/2)]:null,
      meanMs:laps.length?Math.round(laps.reduce((a,b)=>a+b,0)/laps.length):null,
      minMs:sorted[0]??null,maxMs:sorted.at(-1)??null};
  };
  const audit={
    baselineSource:"PR #480 track profile; isolated weather-only benchmark",
    scenario:"Australia 2000 full-grid, same historical inputs, dry track all 58 laps",
    gridSize:dryInput.cars.length,laps:dryInput.track.laps,
    dryWetStartOverrides:normalizedWetStarts,
    rainScenario:{winnerFinishMs:winner?.finishTimeMs??null,
      fastestLapMs:fastest?.bestLapMs??null,pitCount:history(winner).length,
      pitLaps:history(winner).map(row=>row.lap),lapDistribution:lapDistribution(winner)},
    dryScenario:{winnerDriverId:dryWinner?.driverId??null,
      winnerFinishMs:dryWinner?.finishTimeMs??null,
      fastestLapMs:dryFastest?.bestLapMs??null,
      pitCount:history(dryWinner).length,
      pitLaps:history(dryWinner).map(row=>row.lap),
      lapDistribution:lapDistribution(dryWinner),
      finishers:dryFast.cars.filter(car=>car.status==="finished").length},
    historicalReference:{winnerFinishMs:5641987,fastestLapMs:91481},
  };
  console.log("REAL_2000_DRY_PACE_CONTROL="+JSON.stringify(audit));
  console.log("REAL_2000_COMBINED_TRACK_TYRES="+JSON.stringify({
    baselineCommit:"4b314dae5c2153f5883526f9dc436373cd1b76f0",
    year:2000,track:input.track.trackId,
    physicalSpeedSource:input.track.speedProfile?.source??null,
    corners:input.track.speedProfile?.referenceCorners??null,
    sampledMaxSpeedKmh:Number(sampledMaxSpeedKmh.toFixed(3)),
    dryAvailable:combinedDryTyreNames,tyreSupplier:[...combinedTyreSupplier],
    startingCompounds:initial.cars.reduce((acc,car)=>{
      const tyre=String(car.tyre?.compound||"unknown");
      acc[tyre]=(acc[tyre]||0)+1;
      return acc;
    },{}),
    lockedDrySpecCars:withDrySpec.length,
    canonicalLiveAutosimParity:true,
  }));
  console.log("REAL_2000_PACE_AUDIT="+JSON.stringify({
    track:input.track.trackId,
    profileSource:input.track?.speedProfile?.source||"missing",
    profileSampleCount:sampleCount,
    profileMaxSeverity:Math.max(0,...(input.track?.speedProfile?.samples||[]).map(p=>Number(p.severity)||0)),
    straightSpeedFactor:input.track?.speedProfile?.straightSpeedFactor??1,
    brakingModel:input.track?.speedProfile?.brakingModel??"legacy",
    fastestLapMs:fastest?.bestLapMs??null,
    fastestLapDriverId:fastest?.driverId??null,
    fastestLapNumber:fastest?.bestLapNumber??null,
    winnerFinishMs:winner?.finishTimeMs??null,
    averageWinnerSpeedKmh:winner?.finishTimeMs>0
      ?Number((input.track.lengthM*input.track.laps*3.6/(winner.finishTimeMs/1000)).toFixed(3))
      :null,
    maxSampledSpeedKmh:Number(sampledMaxSpeedKmh.toFixed(3)),
    winnerPitLaps:(winner?.pitState?.history||[]).map(stop=>Number(stop.lap)),
    startingWeather:input.weather?.segments?.[0]?.state??input.weather?.state??null,
    dryStart:((input.weather?.timeline||[])[0]?.track_wetness??null)===0,
  }));
});
