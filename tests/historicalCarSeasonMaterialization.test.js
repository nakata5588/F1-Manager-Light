import test from "node:test";
import assert from "node:assert/strict";
import { materializeHistoricalSeasonCarStats } from "../src/domain/historicalCarSeasonMaterialization.js";
import { materializeNextSeasonCarStats } from "../src/domain/nextSeasonMaterialization.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";

const evidence=(team,race,qualifying=race)=>({
  year:2000,team_id:team,race,qualifying,reliability:85,
  confidence:"medium",evidence_driver_count:2,evidence_result_count:30,
  source:"same_season_results_baseline_v1",
});
test("selected 2000 season derives two different cars from both-driver historical evidence",()=>{
  const rows=materializeHistoricalSeasonCarStats({
    year:2000,teamIds:["ferrari","minardi"],
    resultBaselines:[evidence("ferrari",92,94),evidence("minardi",50,48)],
  });
  assert.equal(rows.length,2);
  assert.equal(rows[0].generation_source,"historical_results_inference");
  assert.ok(rows[0].chassis_spec>rows[1].chassis_spec);
  assert.equal(rows[0].historical_evidence_driver_count,2);
  const gs={activeYear:2000,team:{team_id:"ferrari"},carStats:rows,teamEngines:[]};
  assert.ok(teamCarPerformance(gs,"ferrari").race>teamCarPerformance(gs,"minardi").race);
});
test("1980 exact car specifications have priority over inferred results",()=>{
  const original={year:1980,team_id:"renault",chassis_spec:88,aero_spec:82,reliability:77};
  const rows=materializeHistoricalSeasonCarStats({
    year:1980,teamIds:["renault"],explicitRows:[original],
    resultBaselines:[{...evidence("renault",30),year:1980}],
  });
  assert.equal(rows[0].chassis_spec,88);
  assert.equal(rows[0].generation_source,undefined);
});
test("proxy is transparently used when verified entrant matches are insufficient",()=>{
  const rows=materializeHistoricalSeasonCarStats({
    year:2000,teamIds:["mclaren"],
    resultProxies:[{year:2000,team_id:"mclaren",overall_competitiveness_proxy:90,qualifying_index:95,event_records:32}],
  });
  assert.equal(rows[0].historical_baseline_source,"derived_race_results_competitiveness_proxy");
  assert.equal(rows[0].historical_baseline_confidence,"low");
  assert.ok(rows[0].aero_spec>rows[0].chassis_spec);
});
test("2001 rollover evolves from simulated 2000 car rather than reading future archive",()=>{
  const generated=materializeHistoricalSeasonCarStats({
    year:2000,teamIds:["ferrari"],resultBaselines:[evidence("ferrari",92)],
  });
  const next=materializeNextSeasonCarStats({activeYear:2000,carStats:generated,team:{team_id:"ferrari"}},2001);
  assert.equal(next[0].generation_source,"simulated_car_carryover");
  assert.equal(next[0].source_season,2000);
  assert.equal(next[0].chassis_spec,92);
});
test("year filter prevents future Results from changing the selected initial season",()=>{
  const rows=materializeHistoricalSeasonCarStats({
    year:2000,teamIds:["ferrari"],resultBaselines:[{...evidence("ferrari",99),year:2001}],
    inheritedRows:[{year:1999,team_id:"ferrari",chassis_spec:70}],
  });
  assert.equal(rows[0].chassis_spec,70);
});
