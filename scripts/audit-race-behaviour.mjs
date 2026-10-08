// scripts/audit-race-behaviour.mjs
// RW11A: deterministic canonical-race behaviour audit.
// Usage:
//   npm run audit:race-behaviour
//   npm run audit:race-behaviour -- --seeds=8 --scenario=1980-dry

import { raceControlRulesForYear } from "../src/engine/RaceControlEngine.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";
import { runFastRaceToEnd } from "../src/race2/core/RaceRunner.js";
import { diagnoseOvertakingEvents } from "../src/race2/diagnostics/OvertakingFunnelAudit.js";
import {
  aggregateRaceBehaviour,
  summarizeRaceBehaviour,
} from "../src/race2/diagnostics/RaceBehaviourAudit.js";

const arg=(name,fallback=null)=>{
  const prefix=`--${name}=`;
  const found=process.argv.slice(2).find((value)=>value.startsWith(prefix));
  return found?found.slice(prefix.length):fallback;
};

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

function hash(value){
  let out=2166136261;
  for(const char of String(value)){
    out^=char.charCodeAt(0);
    out=Math.imul(out,16777619);
  }
  return out>>>0;
}

function unit(seed,key){
  return hash(`${seed}::${key}`)/4294967296;
}

function weatherRow(lap,{state="SUNNY",rain=0,wetness=0,grip=82,trackTemp=31,airTemp=23,standingWater=0,visibility=100,spray=0,raceability=96,hazard=4}={}){
  return {
    lap,
    state,
    rain_intensity:rain,
    rain_band:rain>=0.7?"HEAVY":rain>0.08?"LIGHT":"NONE",
    track_wetness:wetness,
    wetness_delta:0,
    rubber_level:25,
    grip_index:grip,
    air_temp_c:airTemp,
    track_temp_c:trackTemp,
    spray_index:spray,
    spray_band:spray>=0.7?"HEAVY":spray>0.1?"LIGHT":"NONE",
    visibility_index:visibility,
    visibility_band:visibility<50?"VERY_POOR":visibility<75?"POOR":"CLEAR",
    standing_water_index:standingWater,
    standing_water_band:standingWater>=65?"HEAVY":standingWater>20?"LIGHT":"NONE",
    raceability_index:raceability,
    raceability_hazard_index:hazard,
    raceability_band:raceability<35?"CRITICAL":raceability<65?"CAUTION":"GOOD",
    raceability_factors:{},
    raceability_dominant_factors:[],
  };
}

function weatherTimeline(laps,{wet=false}={}){
  return Array.from({length:laps},(_,index)=>{
    const lap=index+1;
    if(!wet)return weatherRow(lap);
    if(lap<=4)return weatherRow(lap);
    if(lap<=9)return weatherRow(lap,{state:"LIGHT_RAIN",rain:0.36,wetness:0.32,grip:67,trackTemp:25,airTemp:20,standingWater:14,visibility:83,spray:0.22,raceability:78,hazard:22});
    if(lap<=13)return weatherRow(lap,{state:"HEAVY_RAIN",rain:0.78,wetness:0.76,grip:42,trackTemp:20,airTemp:18,standingWater:68,visibility:52,spray:0.72,raceability:43,hazard:57});
    if(lap<=18)return weatherRow(lap,{state:"DRYING",rain:0.08,wetness:0.48,grip:58,trackTemp:23,airTemp:20,standingWater:28,visibility:74,spray:0.34,raceability:66,hazard:34});
    return weatherRow(lap,{state:"SUNNY",wetness:Math.max(0,(laps-lap)*0.015),grip:76,trackTemp:29,airTemp:22,visibility:96,raceability:91,hazard:9});
  });
}

function paceFor({tyreManagement,raceIntelligence}){
  if(tyreManagement>=78&&raceIntelligence>=72)return "attack";
  if(tyreManagement<52)return "conserve";
  return "balanced";
}

function buildInput({name,year,laps=24,wet=false,overtakingDifficulty=55,tyreWear=60,seed}){
  const fieldSize=16;
  const entries=[];
  const drivers=[];
  const cars=[];
  const startingGrid=[];
  const teamCount=fieldSize/2;

  for(let index=0;index<fieldSize;index+=1){
    const driverId=`D${index+1}`;
    const teamId=`T${Math.floor(index/2)+1}`;
    const carId=`C${index+1}`;
    const tyreManagement=Math.round(44+unit(seed,`tyre:${index}`)*50);
    const raceIntelligence=Math.round(55+unit(seed,`intel:${index}`)*40);
    const raceScore=Math.round(62+unit(seed,`race:${index}`)*32);
    const overtaking=Math.round(58+unit(seed,`overtake:${index}`)*38);
    const defending=Math.round(56+unit(seed,`defend:${index}`)*39);
    const aggression=Math.round(34+unit(seed,`aggr:${index}`)*50);
    const mistakePropensity=Math.round(15+unit(seed,`mistake:${index}`)*42);
    const carRace=Math.round(65+unit(seed,`car:${Math.floor(index/2)}`)*28);
    const power=Math.round(clamp(carRace-5+unit(seed,`power:${index}`)*10,50,98));
    const chassis=Math.round(clamp(carRace-5+unit(seed,`chassis:${index}`)*10,50,98));
    const gridJitter=Math.floor(unit(seed,`grid:${index}`)*7)-3;
    const nominal=index+1;
    const grid=Math.max(1,Math.min(fieldSize,nominal+gridJitter));

    entries.push({driverId,teamId,carId,status:"confirmed"});
    drivers.push({
      driverId,
      teamId,
      ratings:{},
      performance:{
        raceScore,
        overtaking,
        defending,
        mistakePropensity,
        aggression,
        tyreManagement,
      },
    });
    cars.push({
      carId,
      driverId,
      teamId,
      state:{componentCondition:{engine:100}},
      performance:{overall:carRace,qualifying:carRace,race:carRace,reliability:82,chassis,power},
      reliability:{
        mechanicalFailureChance:year<=1985?0.06:year<=2009?0.035:0.018,
        accidentIncidentChance:wet?0.16:0.075,
        accidentConditionalRetirementChance:year<=1985?0.22:0.12,
        profile:{reliability_pct:82,source:"rw11a_audit"},
      },
      resourceSetup:{
        strategy:{
          startTyreId:null,
          nextTyreId:null,
          paceMode:paceFor({tyreManagement,raceIntelligence}),
          fuelPlan:null,
          pitPlan:"adaptive",
          plannedStopLap:null,
        },
        tyres:[],
        pitCrew:{avg_time_s:6.8,consistency:72,error_rate:0.045,training_load:50,fatigue:0},
      },
    });
    startingGrid.push({grid,driver_id:driverId,team_id:teamId});
  }

  // Repair duplicate jittered grid slots deterministically while preserving the
  // noisy relationship between car pace and starting order.
  startingGrid.sort((a,b)=>a.grid-b.grid||String(a.driver_id).localeCompare(String(b.driver_id)));
  startingGrid.forEach((row,index)=>{row.grid=index+1;});

  const timeline=weatherTimeline(laps,{wet});
  const refuellingAllowed=year>=1994&&year<=2009;
  void teamCount;

  return {
    schemaVersion:13,
    engineVersion:"rw2",
    weekendKey:`rw11a-${name}`,
    seed,
    year,
    entries,
    drivers,
    cars,
    rules:{race:{refuelling_allowed:refuellingAllowed}},
    raceControl:{rules:raceControlRulesForYear(year)},
    weather:{state:timeline[0].state,timeline},
    startingGrid,
    track:{
      schemaVersion:2,
      trackId:`rw11a-${name}`,
      year,
      lengthM:4200,
      laps,
      traits:{
        tyreWear,
        overtakingDifficulty,
        crashRisk:wet?72:48,
        pitLaneLossS:22,
      },
      pitLane:{
        available:true,
        entryM:3500,
        exitM:4000,
        entryProgress:3500/4200,
        exitProgress:4000/4200,
        points:[],
      },
      startFinish:{progress:0,distanceM:0},
      sectors:[
        {id:"sector_1",sector:1,startM:0,endM:1400,lengthM:1400},
        {id:"sector_2",sector:2,startM:1400,endM:2800,lengthM:1400},
        {id:"sector_3",sector:3,startM:2800,endM:4200,lengthM:1400},
      ],
      speedProfile:{
        source:"rw11a_audit",
        detailed:true,
        sampleSpacingM:350,
        windowM:55,
        samples:[0.05,0.18,0.62,0.34,0.08,0.72,0.28,0.12,0.58,0.22,0.76,0.16]
          .map((severity,index)=>({distanceM:index*350,severity})),
      },
    },
  };
}

const scenarios=[
  {name:"1980-dry",year:1980,wet:false,overtakingDifficulty:66,tyreWear:62},
  {name:"1980-wet",year:1980,wet:true,overtakingDifficulty:66,tyreWear:62},
  {name:"2004-dry",year:2004,wet:false,overtakingDifficulty:55,tyreWear:58},
  {name:"2026-dry",year:2026,wet:false,overtakingDifficulty:48,tyreWear:56},
];

const seedCount=Math.max(1,Math.min(30,Number(arg("seeds",4))||4));
const scenarioFilter=String(arg("scenario","")).trim();
const jsonOnly=process.argv.slice(2).includes("--json-only");
const selected=scenarioFilter
  ?scenarios.filter((scenario)=>scenario.name===scenarioFilter)
  :scenarios;

if(!selected.length){
  throw new Error(`Unknown scenario "${scenarioFilter}". Available: ${scenarios.map((row)=>row.name).join(", ")}`);
}

const output={
  generatedAt:new Date().toISOString(),
  seedCount,
  // These are deterministic synthetic drivers/cars, NOT a materialized 1980
  // season pack or historical Renault/other entrant ratings.
  provenance:{
    kind:"synthetic_benchmark",
    historicalSeasonPack:false,
    drivers:"deterministically generated raceScore/racecraft",
    cars:"deterministically generated race/power/chassis",
    tyres:"genericTyresForYear fallback; resourceSetup.tyres is empty",
    strategies:"derived from generated tyre-management/intelligence scores",
  },
  scenarios:{},
};
for(const scenario of selected){
  const runs=[];
  for(let index=0;index<seedCount;index+=1){
    const seed=`rw11a:${scenario.name}:${index+1}`;
    const input=buildInput({...scenario,seed});
    const initial=startRaceState(createRaceState(input,{stepMs:100}));
    const finished=runFastRaceToEnd(initial,{maxSteps:120000});
    runs.push({
      ...summarizeRaceBehaviour(finished,{scenario:scenario.name,seed}),
      overtakingFunnel:diagnoseOvertakingEvents(finished.events),
    });
  }
  output.scenarios[scenario.name]={
    config:scenario,
    aggregate:aggregateRaceBehaviour(runs),
    overtakingFunnel:{
      attempts:runs.reduce((n,r)=>n+r.overtakingFunnel.attempts,0),
      outcomes:Object.fromEntries(["completed","failed","aborted","contact","unresolved"].map(k=>[k,runs.reduce((n,r)=>n+r.overtakingFunnel.byOutcome[k],0)])),
      failureReasons:runs.reduce((acc,r)=>{for(const [k,v] of Object.entries(r.overtakingFunnel.failureReasons)){acc[k]=(acc[k]||0)+v;}return acc;},{}),
      sideBySideCount:runs.reduce((n,r)=>n+r.overtakingFunnel.sideBySideCount,0),
      failedBeforeSideBySide:runs.reduce((n,r)=>n+r.overtakingFunnel.failedBeforeSideBySide,0),
      limitation:"Pre-attempt gate rejections are not available as canonical events.",
    },
    runs,
  };
}

const table=Object.entries(output.scenarios).map(([name,value])=>({
  scenario:name,
  runs:value.aggregate.runs,
  attempts:value.aggregate.overtakes.attempts,
  overtakes:value.aggregate.overtakes.completed,
  failed:value.aggregate.overtakes.failed,
  contacts:value.aggregate.overtakes.contacts,
  pits:value.aggregate.pits.services,
  repairs:value.aggregate.pits.repairs,
  damage:value.aggregate.incidents.damageEvents,
  dnf:value.aggregate.finalState.dnfs,
  tyreAvg:value.aggregate.tyres.averageCondition,
  tyreMin:value.aggregate.tyres.minimumCondition,
  wearLap:value.aggregate.tyres.averageWearPerLapPct,
  flags:value.aggregate.raceControl.changes,
}));

if(jsonOnly){
  console.log(`RW11A_JSON=${JSON.stringify(output)}`);
}else{
  console.table(table);
  console.log(JSON.stringify(output,null,2));
}
