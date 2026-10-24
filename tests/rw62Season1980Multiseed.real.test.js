// RW62: real 1980 multi-seed, three-track overtaking/tyre/strategy audit.
// Observational benchmark only; no duplicate engine or fabricated physics.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {isRaceDriverContract} from "../src/domain/contractRoles.js";
import {
  createRaceWeekendState,completePracticeSession,
  completeQualifyingSession,continueRaceWeekendSession,
} from "../src/engine/RaceWeekendEngine.js";
import {buildRaceWeekendInput} from "../src/race2/adapters/GameStateInputAdapter.js";
import {createRaceState} from "../src/race2/core/RaceState.js";
import {startRaceState} from "../src/race2/core/RaceSimulation.js";
import {createLiveRaceRunner,runFastRace,runFastRaceToEnd} from "../src/race2/core/RaceRunner.js";
import {summarizeRaceBehaviour} from "../src/race2/diagnostics/RaceBehaviourAudit.js";
import {projectCanonicalRaceStateToOfficialRows} from "../src/race2/adapters/OfficialRaceResultProjection.js";
import {materializeOfficialRaceRows} from "../src/engine/RaceFinalizationEngine.js";

const scenarios=Object.freeze({
  argentina:{index:0,fragment:"argentin",laps:53},
  brazil:{index:1,fragment:"brazil",laps:40},
  kyalami:{index:2,fragment:"south african",laps:78},
  monaco:{index:5,fragment:"monaco",laps:76},
});
const which=String(process.env.RW62_GP||"argentina").toLowerCase();
if(!scenarios[which])throw new Error("RW62_GP must be argentina, brazil, kyalami or monaco");

const counts=(rows,key)=>rows.reduce((out,row)=>{
  const value=String(key(row)??"unknown");
  out[value]=(out[value]||0)+1;
  return out;
},{});
const ratio=(n,d)=>d?Number((100*n/d).toFixed(2)):null;
const pair=(event)=>(event?.driverIds||[]).map(String).sort().join("|");
const clean=(n)=>Number(n.toFixed(3));

function audit(gs,input,fast,scenario,seed){
  const events=fast.events||[];
  const starts=events.filter(e=>e.type==="overtake_started");
  const completed=events.filter(e=>e.type==="overtake_completed");
  const failed=events.filter(e=>e.type==="overtake_failed");
  const extended=events.filter(e=>e.type==="overtake_approach_extended");
  const byKind=counts(completed,e=>e?.payload?.passKind);
  const startsByKind=counts(starts,e=>e?.payload?.passKind);
  const position=completed.filter(e=>e.payload?.passKind==="position");
  const positionStarts=starts.filter(e=>e.payload?.passKind==="position");
  const pairTotals=Object.values(counts(position,pair));
  const uniquePairs=pairTotals.length;
  const end=Math.max(1,fast.simulationTimeMs);
  const thirds=counts(position,e=>Math.min(3,1+Math.floor(3*Number(e.timeMs||0)/end)));
  const behaviour=summarizeRaceBehaviour(fast,{scenario,seed});
  const official=materializeOfficialRaceRows(projectCanonicalRaceStateToOfficialRows(gs,fast));
  assert.equal(official.length,fast.cars.length,"all starters have official Results");
  assert.equal(new Set(official.map(r=>String(r.driver_id))).size,fast.cars.length);
  assert.ok(completed.every(e=>Number(e.payload?.clearanceM)>=1.5),
    "no overtake may complete without canonical physical clearance");
  assert.ok(extended.length<=starts.length,"one extension at most per attempt");
  const extCount=counts(extended,e=>e.payload?.attemptId);
  assert.ok(Object.values(extCount).every(n=>n===1),"an attempt cannot extend repeatedly");
  assert.ok(Math.max(0,...pairTotals)<=5,
    "more than 5 swaps by one pair suggests ping-pong");
  const statuses=fast.cars.filter(c=>c.status==="finished");
  assert.ok(statuses.length>0,"a full race needs classified finishers");
  assert.ok(statuses.some(c=>c.completedLaps===input.track.laps));
  assert.equal(fast.status,"finished");
  const audited={
    gp:scenario,seed,year:1980,track:input.track.trackId,
    layoutSource:input.track?.speedProfile?.source??null,
    laps:input.track.laps,lengthM:input.track.lengthM,
    entrants:input.entries.length,starters:fast.cars.length,
    tick:fast.tick,officialRaceTimeMs:fast.officialRaceTimeMs,
    fastestRaceLapMs:Math.min(...fast.cars.map(c=>Number(c?.bestLapMs))
      .filter(n=>Number.isFinite(n)&&n>0)),
    dnf:behaviour.finalState.dnfs,
    attempts:starts.length,completed:completed.length,failed:failed.length,
    failedReasons:behaviour.overtakes.failureReasons,
    extensions:extended.length,
    byKind,startsByKind,
    positionPasses:position.length,positionAttempts:positionStarts.length,
    positionCompletionPct:ratio(position.length,positionStarts.length),
    positionPassesByTimeThird:thirds,
    positionPairs:uniquePairs,
    positionPairsWithRepeats:pairTotals.filter(n=>n>1).length,
    maxPassesPerPositionPair:Math.max(0,...pairTotals),
    lappingPasses:byKind.lapping||0,unlappingPasses:byKind.unlapping||0,
    averageGapAtAttemptM:behaviour.overtakes.averageStartGapM,
    averageClosingMs:behaviour.overtakes.averageClosingPotentialMs,
    pitStops:behaviour.pits.services,
    pitReasons:behaviour.pits.reasons,
    tyreAverageCondition:behaviour.tyres.averageCondition,
    tyreMinimumCondition:behaviour.tyres.minimumCondition,
    tyreAverageWearPerLapPct:behaviour.tyres.averageWearPerLapPct,
    paceModes:behaviour.pace,
    weatherControlChanges:behaviour.raceControl.changes,
  };
  assert.ok(Number.isFinite(audited.officialRaceTimeMs));
  assert.ok(Number.isFinite(audited.tyreAverageCondition));
  assert.ok(audited.positionPasses<=audited.completed);
  assert.ok(audited.positionPasses<=audited.positionAttempts+3,
    "position overtakes cannot emerge without prior canonical attempts");
  return audited;
}

test("RW62 real 1980 multi-seed overtaking benchmark: "+which,{timeout:1_500_000},async()=>{
  const pack=JSON.parse(await fs.readFile(new URL("../public/data/seasons/1980/season.json",import.meta.url),"utf8"));
  assert.equal(pack.validation?.ok,true,JSON.stringify(pack.validation));
  const state=pack.state,scenario=scenarios[which];
  const gp=state.calendar[scenario.index];
  assert.ok(gp);
  assert.match(String(gp.gp_name),new RegExp(scenario.fragment,"i"));
  assert.equal(Number(gp.laps),scenario.laps);
  const renault=state.teams.find(t=>String(t.team_name).toLowerCase()==="renault");
  assert.ok(renault);
  const seats=state.contracts.filter(isRaceDriverContract);
  const garageByTeam={};
  for(const team of state.teams){
    const teamId=String(team.team_id);
    garageByTeam[teamId]={cars:seats.filter(s=>String(s.team_id)===teamId)
      .slice(0,2).map((seat,i)=>({
        id:teamId===String(renault.team_id)?"car_"+(i+1):teamId+"_race_"+(i+1),
        kind:"race",driver_id:seat.driver_id,
        componentCondition:{engine:100,suspension:100},
      }))};
  }
  const date=String(gp.race_date??gp.dateISO??gp.date).slice(0,10);
  const reports=[];
  for(const seedIndex of [1,2]){
    const seed="rw62-1980-"+which+"-seed-"+seedIndex;
    let gs={
      ...state,activeYear:1980,currentRound:scenario.index,currentDateISO:date,
      saveMeta:{schemaVersion:2,seed},
      team:renault,driverAttributes:{},driverAvailability:{},
      medicalHistory:[],temporaryDriverAssignments:[],
      standings:{drivers:[],teams:[]},results:[],inbox:[],financeLog:[],
      finances:{balance:10_000_000,budget:10_000_000,season_spend:0,season_income:0},
      settings:{gameplay:{enableInjuryRandomEvents:false,enableFatalities:false}},
      garage:garageByTeam[String(renault.team_id)],
      aiTechnicalWorld:{teams:Object.fromEntries(state.teams
        .filter(t=>String(t.team_id)!==String(renault.team_id))
        .map(t=>[String(t.team_id),{garage:garageByTeam[String(t.team_id)]}]))},
    };
    gs=createRaceWeekendState(gs,{roundIndex:scenario.index,gp,engineVersion:"rw2"});
    assert.equal(gs.raceWeekendState.phase,"practice");
    gs=completePracticeSession(gs,{gp});
    let quals=0;
    for(let i=0;i<8&&gs.raceWeekendState.phase!=="grid_ready";i++){
      gs={...gs,currentDateISO:String(gs.raceWeekendState.raceDate).slice(0,10)};
      gs=continueRaceWeekendSession(gs);
      if(gs.raceWeekendState.phase==="qualifying"){
        gs=completeQualifyingSession(gs,{gp});quals++;
      }
    }
    assert.equal(quals,2,"1980 uses two qualifying sessions");
    assert.equal(gs.raceWeekendState.phase,"grid_ready");
    gs={...gs,currentDateISO:gs.raceWeekendState.raceDate};
    gs=continueRaceWeekendSession(gs);
    assert.equal(gs.raceWeekendState.phase,"race");
    const input=buildRaceWeekendInput(gs,{gp});
    assert.equal(input.track.laps,scenario.laps);
    assert.ok(input.track.lengthM>2500,"do not substitute a short synthetic circuit");
    assert.ok(input.cars.length>=18,"full historical grid requires real cars");
    const initial=startRaceState(createRaceState(input));
    const live=createLiveRaceRunner(initial);
    for(let step=0;step<60;step++)live.step();
    const prefix=runFastRace(initial,{steps:60});
    assert.deepEqual(live.getState(),prefix,"Live/Fast parity on historical input");
    const fast=runFastRaceToEnd(prefix,{maxSteps:170_000});
    const report=audit(gs,input,fast,which,seed);
    if(which==="kyalami"){
      assert.equal(report.track,"tr_0067");
      assert.equal(report.layoutSource,"historical_named_turn_reference_approximate");
      assert.equal(report.lengthM,4104);
      assert.ok(Number.isFinite(report.fastestRaceLapMs));
      // Broad plausibility guard. Historic 1980 pole: 1:10.000; this is
      // a full-race lap with fuel/traffic, NOT a qualifying lap.
      assert.ok(report.fastestRaceLapMs>=50_000&&report.fastestRaceLapMs<=120_000,
        "Kyalami race pace needs calibration against real 1980 timing");
    }
    reports.push(report);
    console.log("RW62_1980_RUN="+JSON.stringify(report));
  }
  assert.equal(reports.length,2);
  assert.notEqual(reports[0].seed,reports[1].seed);
  console.log("RW62_1980_GP_SUMMARY="+JSON.stringify({
    gp:which,runs:reports.length,
    positionPasses:reports.map(r=>r.positionPasses),
    positionConversionPct:reports.map(r=>r.positionCompletionPct),
    repeats:reports.map(r=>r.positionPairsWithRepeats),
    maxPair:reports.map(r=>r.maxPassesPerPositionPair),
    dnf:reports.map(r=>r.dnf),
    tyreAverageCondition:reports.map(r=>r.tyreAverageCondition),
    pitStops:reports.map(r=>r.pitStops),
  }));
});
