import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceTechnicalResearch,
  consumeTechnicalResearch,
  normalizeTechnicalResearch,
  setTechnicalResearchFocus,
  technicalResearchAreaForProject,
  technicalResearchSupport,
} from "../src/domain/technicalResearch.js";
import {
  advancePitCrewTrainingDay,
  pitCrewEffectiveProfile,
  pitCrewExecutionProfile,
  pitCrewTrainingLoadEffects,
  projectPitCrewTraining,
} from "../src/domain/pitCrewTraining.js";

function researchFixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"FERRARI"},
    facilities:[{
      year:1980,team_id:"FERRARI",
      aero_dept_level:8,wind_tunnel_level:8,
      manufacturing_leve:9,_chassis_shop_level:8,
    }],
    hq:{facilityLevels:{}},
    development:{research:[]},
  };
}

test("technical research focus always reallocates to a 100 percent department",()=>{
  const initial=normalizeTechnicalResearch([]);
  const next=setTechnicalResearchFocus(initial,"aero",55);
  assert.equal(Number(next.reduce((sum,row)=>sum+row.focus,0).toFixed(1)),100);
  assert.equal(next.find((row)=>row.id==="aero").focus,55);
  assert.ok(next.filter((row)=>row.id!=="aero").every((row)=>row.focus<25));
});

test("technical research accrues once per in-game day according to focus",()=>{
  let gs=researchFixture();
  gs.development.research=setTechnicalResearchFocus([], "aero", 50);
  const once=advanceTechnicalResearch(gs,"1980-02-02");
  const twiceSameDay=advanceTechnicalResearch(once,"1980-02-02");
  const aero=once.development.research.find((row)=>row.id==="aero");
  const chassis=once.development.research.find((row)=>row.id==="chassis");

  assert.ok(aero.points>0);
  assert.ok(aero.points>chassis.points);
  assert.deepEqual(twiceSameDay.development.research,once.development.research);
  assert.equal(twiceSameDay.development.lastResearchDate,"1980-02-02");
});

test("research points become optional project support instead of an automatic car bonus",()=>{
  const rows=normalizeTechnicalResearch([
    {id:"aero",focus:25,points:22},
    {id:"chassis",focus:25,points:0},
    {id:"reliability",focus:25,points:0},
    {id:"powertrain",focus:25,points:0},
  ]);
  const support=technicalResearchSupport(rows,"aero",30);
  assert.equal(support.points_used,15);
  assert.equal(support.duration_multiplier,0.85);
  assert.equal(support.risk_reduction,0.06);
  assert.equal(support.performance_multiplier,1.06);

  const consumed=consumeTechnicalResearch(rows,"aero",support.points_used);
  assert.equal(consumed.find((row)=>row.id==="aero").points,7);
});

test("research support area follows component and reliability objective",()=>{
  const gs=researchFixture();
  assert.equal(technicalResearchAreaForProject(gs,"aero_front","downforce"),"aero");
  assert.equal(technicalResearchAreaForProject(gs,"gearbox","power_delivery"),"powertrain");
  assert.equal(technicalResearchAreaForProject(gs,"suspension","mechanical_grip"),"chassis");
  assert.equal(technicalResearchAreaForProject(gs,"aero_front","reliability"),"reliability");
});

test("pit crew Recovery and Balanced are distinct long-term training programmes",()=>{
  const recovery=pitCrewTrainingLoadEffects(20);
  const balanced=pitCrewTrainingLoadEffects(50);
  assert.ok(recovery.development_multiplier<balanced.development_multiplier);
  assert.ok(recovery.fatigue_delta_per_day<balanced.fatigue_delta_per_day);
  assert.equal(recovery.fatigue_direction,"recovers");
  assert.equal(balanced.fatigue_direction,"recovers");
});

test("maximum pit crew training improves raw skill faster but creates race-day fatigue",()=>{
  const seed={
    avg_time_s:6.4,
    consistency:82,
    error_rate:0.04,
    fatigue:20,
  };
  const recovery=projectPitCrewTraining({...seed,training_load:20},8,7);
  const maximum=projectPitCrewTraining({...seed,training_load:100},8,7);

  assert.ok(maximum.raw.avg_time_s<recovery.raw.avg_time_s,"maximum load should improve raw stop skill faster");
  assert.ok(maximum.raw.consistency>recovery.raw.consistency,"maximum load should improve raw consistency faster");
  assert.ok(maximum.raw.fatigue>recovery.raw.fatigue,"maximum load should accumulate more fatigue");
  assert.ok(maximum.effective.avg_time_s>maximum.raw.avg_time_s,"fatigue should worsen race-day stop time");
});

test("Recovery can outperform Maximum on race day when the crew is already tired",()=>{
  const tired={
    avg_time_s:6.2,
    consistency:84,
    error_rate:0.035,
    fatigue:55,
  };
  const recovery=projectPitCrewTraining({...tired,training_load:20},8,7);
  const maximum=projectPitCrewTraining({...tired,training_load:100},8,7);
  assert.ok(recovery.effective.avg_time_s<maximum.effective.avg_time_s);
  assert.ok(recovery.effective.error_rate<maximum.effective.error_rate);
});

test("pit crew consistency directly changes stop variance and effective error chance",()=>{
  const consistent=pitCrewExecutionProfile({
    avg_time_s:6,error_rate:0.04,consistency:95,fatigue:0,
  });
  const inconsistent=pitCrewExecutionProfile({
    avg_time_s:6,error_rate:0.04,consistency:55,fatigue:0,
  });
  assert.ok(consistent.execution_variance_s<inconsistent.execution_variance_s);
  assert.ok(consistent.effective_error_chance<inconsistent.effective_error_chance);
});

test("daily pit crew progression is deterministic for equal state",()=>{
  const crew={avg_time_s:6.5,consistency:80,error_rate:0.05,training_load:75,fatigue:10};
  const a=advancePitCrewTrainingDay(crew,7,"1980-02-02");
  const b=advancePitCrewTrainingDay(crew,7,"1980-02-02");
  assert.deepEqual(a,b);
  assert.deepEqual(pitCrewEffectiveProfile(a),pitCrewEffectiveProfile(b));
});
