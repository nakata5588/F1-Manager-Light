import test from "node:test";
import assert from "node:assert/strict";

import {
  aquaplaningOutcome,
  aquaplaningRiskForDriver,
  standingWaterBand,
  standingWaterForConditions,
} from "../src/engine/StandingWaterEngine.js";
import { evaluateRaceability } from "../src/engine/RaceabilityEngine.js";
import { buildTrackWeatherTimeline, incidentForDriver, incidentsForDriver, mergeRaceControlHistory } from "../src/engine/RaceControlEngine.js";
import { formatRaceIncidentMessage } from "../src/engine/LiveRaceEngine.js";

test("RW5.2D4.2 a damp/wet surface does not automatically mean standing water",()=>{
  const result=standingWaterForConditions({
    wetness:0.55,
    rainIntensity:0.10,
    drainage:0.80,
    wetnessDelta:0,
  });
  assert.ok(result.index<15);
  assert.equal(result.band,"NONE");
});

test("RW5.2D4.2 saturated track, heavy rain and weak drainage create dangerous standing water",()=>{
  const result=standingWaterForConditions({
    wetness:0.95,
    rainIntensity:0.80,
    drainage:0.25,
    wetnessDelta:0.025,
  });
  assert.ok(result.index>70);
  assert.ok(["HEAVY","EXTREME"].includes(result.band));
  assert.ok(result.factors.poor_drainage>0.70);
});

test("RW5.2D4.2 standing-water bands remain progressive",()=>{
  assert.equal(standingWaterBand(5),"NONE");
  assert.equal(standingWaterBand(20),"PATCHY");
  assert.equal(standingWaterBand(45),"SIGNIFICANT");
  assert.equal(standingWaterBand(70),"HEAVY");
  assert.equal(standingWaterBand(90),"EXTREME");
});

test("RW5.2D4.2 full wets materially reduce aquaplaning risk versus inters and slicks",()=>{
  const common={
    standingWaterIndex:80,
    wetSkill:65,
    adaptability:65,
    raceIntelligence:65,
    paceMode:"balanced",
    speedRatio:0.86,
    tyreCondition:90,
  };
  const wet=aquaplaningRiskForDriver({...common,tyreCategory:"wet"});
  const inter=aquaplaningRiskForDriver({...common,tyreCategory:"intermediate"});
  const dry=aquaplaningRiskForDriver({...common,tyreCategory:"dry"});

  assert.ok(wet.risk_index<inter.risk_index);
  assert.ok(inter.risk_index<dry.risk_index);
  assert.ok(wet.probability<inter.probability);
  assert.ok(inter.probability<dry.probability);
});

test("RW5.2D4.2 wet skill and reduced pace/speed lower aquaplaning exposure",()=>{
  const risky=aquaplaningRiskForDriver({
    standingWaterIndex:76,
    tyreCategory:"intermediate",
    wetSkill:40,
    adaptability:45,
    raceIntelligence:48,
    paceMode:"attack",
    speedRatio:0.98,
    tyreCondition:55,
  });
  const controlled=aquaplaningRiskForDriver({
    standingWaterIndex:76,
    tyreCategory:"intermediate",
    wetSkill:88,
    adaptability:84,
    raceIntelligence:82,
    paceMode:"conserve",
    speedRatio:0.72,
    tyreCondition:90,
  });
  assert.ok(controlled.risk_index<risky.risk_index);
  assert.ok(controlled.probability<risky.probability);
});

test("RW5.2D4.2 aquaplaning outcomes cover spins, loss of control and accidents",()=>{
  const accident=aquaplaningOutcome({riskIndex:90,outcomeRoll:0.10,retirementRoll:0.10});
  const loss=aquaplaningOutcome({riskIndex:90,outcomeRoll:0.50,retirementRoll:0.90});
  const spin=aquaplaningOutcome({riskIndex:90,outcomeRoll:0.90,retirementRoll:0.90});

  assert.equal(accident.outcome,"accident");
  assert.equal(accident.retirement,true);
  assert.equal(accident.time_loss_s,0);
  assert.equal(loss.outcome,"loss_of_control");
  assert.equal(loss.retirement,false);
  assert.ok(loss.time_loss_s>0);
  assert.equal(spin.outcome,"spin");
  assert.equal(spin.retirement,false);
  assert.ok(spin.time_loss_s>0);
});

test("RW5.2D4.2 non-retirement incidents no longer retire a driver",()=>{
  const plan={
    incidents:[
      {driver_id:"D1",lap:3,sector:1,kind:"aquaplaning_spin",retirement:false,time_loss_s:8},
      {driver_id:"D1",lap:9,sector:2,kind:"accident",reason:"Accident"},
    ],
  };
  assert.equal(incidentsForDriver(plan,"D1").length,2);
  assert.equal(incidentForDriver(plan,"D1").lap,9);
});

test("RW5.2D4.2 aquaplaning feed copy explains spin and time loss",()=>{
  const message=formatRaceIncidentMessage({
    controlType:"LOCAL_YELLOW",
    driverName:"Test Driver",
    incident:{
      kind:"aquaplaning_spin",
      retirement:false,
      time_loss_s:7.4,
      severity:"low",
    },
  });
  assert.match(message,/aquaplanes and spins/i);
  assert.match(message,/7\.4s/i);
});

test("RW5.2D4.2 track drainage changes standing-water timeline independently of wetness",()=>{
  const gs={
    activeYear:1980,
    teams:[{team_id:"T1"},{team_id:"T2"}],
    dbWeatherStates:[],
    raceWeekendState:{gp_id:"D4_2_DRAINAGE"},
  };
  const weather={
    state:"HEAVY_RAIN",
    starting_track_wetness:0.82,
    starting_rubber_level:3,
    starting_air_temp_c:18,
    starting_track_temp_c:20,
    wind_profile:"medium",
    segments:[{from_lap:1,to_lap:8,state:"HEAVY_RAIN"}],
  };
  const good=buildTrackWeatherTimeline(gs,weather,{track_id:"GOOD",laps:8,drainage_rating:0.90});
  const poor=buildTrackWeatherTimeline(gs,weather,{track_id:"POOR",laps:8,drainage_rating:0.20});

  assert.equal(good.length,8);
  assert.equal(poor.length,8);
  assert.ok(poor.at(-1).standing_water_index>good.at(-1).standing_water_index);
  assert.ok(poor.every((row)=>Number.isFinite(row.standing_water_index)));
  assert.ok(poor.every((row)=>typeof row.standing_water_band==="string"));
});

test("RW5.2D4.2 standing water contributes to composite raceability without becoming a lone hard trigger",()=>{
  const noPools=evaluateRaceability({
    wetness:0.70,
    sprayIndex:0.55,
    visibilityIndex:60,
    gripIndex:55,
    rainIntensity:0.45,
    wetnessDelta:0,
    standingWaterIndex:0,
  });
  const pools=evaluateRaceability({
    wetness:0.70,
    sprayIndex:0.55,
    visibilityIndex:60,
    gripIndex:55,
    rainIntensity:0.45,
    wetnessDelta:0,
    standingWaterIndex:75,
  });
  assert.ok(pools.index<noPools.index);
  assert.ok(noPools.index-pools.index<15);
});


test("RW5.2D4.2 observed spin does not block a later retirement for the same driver",()=>{
  const previous={
    incidents:[
      {driver_id:"D1",lap:3,sector:1,kind:"aquaplaning_spin",retirement:false,time_loss_s:8},
    ],
    periods:[],
    weather_timeline:Array.from({length:12},(_,index)=>({lap:index+1})),
  };
  const fresh={
    incidents:[
      {driver_id:"D1",lap:3,sector:1,kind:"aquaplaning_spin",retirement:false,time_loss_s:8},
      {driver_id:"D1",lap:9,sector:2,kind:"accident",reason:"Accident"},
    ],
    periods:[],
    weather_timeline:Array.from({length:12},(_,index)=>({lap:index+1})),
  };
  const merged=mergeRaceControlHistory(previous,fresh,4,3);
  assert.equal(merged.incidents.length,2);
  assert.equal(merged.incidents[0].retirement,false);
  assert.equal(merged.incidents[1].lap,9);
  assert.notEqual(merged.incidents[1].retirement,false);
});
