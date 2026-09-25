import test from "node:test";
import assert from "node:assert/strict";

import {
  incidentRaceControlAssessment,
  weatherRaceControlAssessment,
} from "../src/engine/RaceControlPolicyEngine.js";
import { raceControlRulesForYear } from "../src/engine/RaceControlEngine.js";

function weatherRow(overrides={}){
  return {
    raceability_index:72,
    raceability_hazard_index:28,
    standing_water_index:12,
    visibility_index:82,
    spray_index:0.25,
    grip_index:70,
    rain_intensity:0.25,
    wetness_delta:0.002,
    raceability_band:"GOOD",
    ...overrides,
  };
}

test("RW5.2D4.3 era boundaries expose only historically available routine mechanisms",()=>{
  const y1980=raceControlRulesForYear(1980);
  assert.equal(y1980.safety_car,false);
  assert.equal(y1980.virtual_safety_car,false);
  assert.equal(y1980.red_flag,true);
  assert.equal(y1980.safety_car_mode,"not_standardized");
  assert.equal(y1980.weather_response_mode,"direct_stoppage_if_unraceable");

  const y1993=raceControlRulesForYear(1993);
  assert.equal(y1993.safety_car,true);
  assert.equal(y1993.virtual_safety_car,false);
  assert.equal(y1993.safety_car_mode,"standard");

  const y2014=raceControlRulesForYear(2014);
  assert.equal(y2014.virtual_safety_car,false);

  const y2015=raceControlRulesForYear(2015);
  assert.equal(y2015.safety_car,true);
  assert.equal(y2015.virtual_safety_car,true);
});

test("RW5.2D4.3 normal weather stays green in every era",()=>{
  for(const year of [1980,1993,2015,2026]){
    const assessment=weatherRaceControlAssessment({
      rules:raceControlRulesForYear(year),
      row:weatherRow(),
    });
    assert.equal(assessment.action,"GREEN");
    assert.equal(assessment.severity,"NORMAL");
  }
});

test("RW5.2D4.3 1980 extreme multi-factor weather can go directly to red flag",()=>{
  const assessment=weatherRaceControlAssessment({
    rules:raceControlRulesForYear(1980),
    row:weatherRow({
      raceability_index:22,
      raceability_hazard_index:78,
      standing_water_index:88,
      visibility_index:34,
      spray_index:0.96,
      grip_index:27,
      rain_intensity:0.78,
      wetness_delta:0.028,
      raceability_band:"CRITICAL",
    }),
    recentRows:[
      weatherRow({raceability_hazard_index:70,raceability_band:"CRITICAL"}),
    ],
  });
  assert.equal(assessment.action,"RED_FLAG");
  assert.ok(assessment.severe_signals.length>=2);
  assert.ok(assessment.score>=70);
});

test("RW5.2D4.3 1980 never inserts Safety Car or VSC for weather",()=>{
  const assessment=weatherRaceControlAssessment({
    rules:raceControlRulesForYear(1980),
    row:weatherRow({
      raceability_index:43,
      raceability_hazard_index:57,
      standing_water_index:64,
      visibility_index:46,
      spray_index:0.78,
      grip_index:42,
      rain_intensity:0.66,
      raceability_band:"POOR",
    }),
  });
  assert.ok(["GREEN","RED_FLAG"].includes(assessment.action));
  assert.notEqual(assessment.action,"SAFETY_CAR");
  assert.notEqual(assessment.action,"VSC");
});

test("RW5.2D4.3 Safety Car era can neutralise severe but not yet stoppage-level weather",()=>{
  const assessment=weatherRaceControlAssessment({
    rules:raceControlRulesForYear(2000),
    row:weatherRow({
      raceability_index:43,
      raceability_hazard_index:57,
      standing_water_index:64,
      visibility_index:46,
      spray_index:0.78,
      grip_index:42,
      rain_intensity:0.66,
      raceability_band:"POOR",
    }),
  });
  assert.equal(assessment.action,"SAFETY_CAR");
});

test("RW5.2D4.3 modern weather never selects VSC as a circuit-wide rain response",()=>{
  const assessment=weatherRaceControlAssessment({
    rules:raceControlRulesForYear(2026),
    row:weatherRow({
      raceability_index:43,
      raceability_hazard_index:57,
      standing_water_index:64,
      visibility_index:46,
      spray_index:0.78,
      grip_index:42,
      rain_intensity:0.66,
      raceability_band:"POOR",
    }),
  });
  assert.equal(assessment.action,"SAFETY_CAR");
  assert.equal(assessment.mechanism_available.virtual_safety_car,true);
});

test("RW5.2D4.3 isolated poor visibility does not automatically stop a dry race",()=>{
  const assessment=weatherRaceControlAssessment({
    rules:raceControlRulesForYear(2026),
    row:weatherRow({
      raceability_index:77,
      raceability_hazard_index:23,
      standing_water_index:0,
      visibility_index:33,
      spray_index:0,
      grip_index:92,
      rain_intensity:0,
      wetness_delta:0,
      raceability_band:"GOOD",
    }),
  });
  assert.equal(assessment.action,"GREEN");
});

test("RW5.2D4.3 medium local incident maps to VSC only when the era supports it",()=>{
  const incident={kind:"accident",severity:"medium",severity_score:0.55};

  const historic=incidentRaceControlAssessment({
    rules:raceControlRulesForYear(1980),
    incident,
    weatherRow:weatherRow(),
  });
  assert.equal(historic.action,"LOCAL_YELLOW");

  const preVsc=incidentRaceControlAssessment({
    rules:raceControlRulesForYear(2014),
    incident,
    weatherRow:weatherRow(),
  });
  assert.notEqual(preVsc.action,"VSC");

  const modern=incidentRaceControlAssessment({
    rules:raceControlRulesForYear(2015),
    incident,
    weatherRow:weatherRow(),
  });
  assert.equal(modern.action,"VSC");
});

test("RW5.2D4.3 high-severity incident uses Safety Car when available but not in 1980",()=>{
  const incident={kind:"collision",severity:"high",severity_score:0.84};

  const historic=incidentRaceControlAssessment({
    rules:raceControlRulesForYear(1980),
    incident,
    weatherRow:weatherRow(),
  });
  assert.equal(historic.action,"LOCAL_YELLOW");

  const scEra=incidentRaceControlAssessment({
    rules:raceControlRulesForYear(2000),
    incident,
    weatherRow:weatherRow(),
  });
  assert.equal(scEra.action,"SAFETY_CAR");
});

test("RW5.2D4.3 critical incident may escalate directly to red flag in any era",()=>{
  const incident={kind:"accident",severity:"critical",severity_score:0.97};
  for(const year of [1980,2000,2026]){
    const assessment=incidentRaceControlAssessment({
      rules:raceControlRulesForYear(year),
      incident,
      weatherRow:weatherRow(),
    });
    assert.equal(assessment.action,"RED_FLAG");
  }
});
