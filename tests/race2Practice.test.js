import test from "node:test";
import assert from "node:assert/strict";

import {
  PRACTICE_PROGRAMMES,
  practiceProgrammeForEntrant,
  simulateCanonicalPractice,
} from "../src/race2/core/PracticeSimulation.js";

function input(seed="practice-seed"){
  return {
    modelVersion:1,
    seed,
    weekendKey:"1980_1_test",
    trackProfile:{
      target:{aeroBalance:60,mechanicalGrip:70,gearing:55,cooling:50},
      inputs:{crash_risk:48,tyre_wear:62},
    },
    sessionWeather:{
      state:"SUNNY",
      rain_intensity:0,
      track_temp_c:31,
      track:{start_wetness:0,grip_index:90},
    },
    trackRisk:48,
    tyreWear:62,
    weatherRisk:1,
    weatherLearning:1,
    qualifyingRelevance:0.9,
    raceRelevance:0.8,
    entrants:[
      {
        driverId:"D1",
        teamId:"T1",
        isPlayerTeam:true,
        requestedProgrammeId:"qualifying",
        carReliabilityScore:82,
        rating:{
          technical_feedback:78,
          adaptability:72,
          consistency:75,
          crash_likelihood:20,
          qualifying:80,
          racecraft:70,
        },
        engineeringSupport:76,
        engineerRelationship:{score:70,multiplier:1.03,label:"Good"},
        conditionBefore:{confidence:55,morale:52,preparation:50,fatigue:8},
        fatiguePerformancePenaltyBefore:0,
        reliabilityProfile:{combined_pct:84,components:[]},
      },
      {
        driverId:"D2",
        teamId:"T2",
        isPlayerTeam:false,
        requestedProgrammeId:"race",
        carReliabilityScore:60,
        rating:{
          technical_feedback:65,
          adaptability:68,
          consistency:70,
          crash_likelihood:24,
          qualifying:65,
          racecraft:74,
        },
        engineeringSupport:68,
        engineerRelationship:{score:50,multiplier:1,label:"Neutral"},
        conditionBefore:{confidence:50,morale:50,preparation:50,fatigue:0},
        fatiguePerformancePenaltyBefore:0,
        reliabilityProfile:{combined_pct:62,components:[]},
      },
    ],
  };
}

test("RW8.12 canonical Practice core is detached and deterministic",()=>{
  const original=input();
  const snapshot=structuredClone(original);
  const first=simulateCanonicalPractice(original);
  const second=simulateCanonicalPractice(structuredClone(original));

  assert.deepEqual(first,second);
  assert.deepEqual(original,snapshot,"canonical core must not mutate its detached input");
  assert.equal(first.model,"rw8.12");
  assert.equal(first.source,"rw8.12_practice_core");
  assert.equal(first.results.length,2);
  assert.ok(first.effects.conditionByDriver.D1);
  assert.ok(first.effects.conditionByDriver.D2);
});

test("RW8.12 player programme command and AI programme policy share one catalogue",()=>{
  const state=input();
  const result=simulateCanonicalPractice(state);
  const player=result.results.find((row)=>row.driver_id==="D1");
  const ai=result.results.find((row)=>row.driver_id==="D2");

  assert.equal(player.programme_id,"qualifying");
  assert.equal(ai.programme_id,"reliability","low-reliability AI should choose the shared reliability programme");
  assert.equal(practiceProgrammeForEntrant(state.entrants[0]),PRACTICE_PROGRAMMES.qualifying);
  assert.equal(practiceProgrammeForEntrant(state.entrants[1]),PRACTICE_PROGRAMMES.reliability);
});

test("RW8.12 seed scopes official Practice setup without changing the input contract",()=>{
  const a=simulateCanonicalPractice(input("seed-a"));
  const b=simulateCanonicalPractice(input("seed-b"));

  assert.notDeepEqual(a.results[0].initial_setup,b.results[0].initial_setup);
  assert.equal(a.results[0].programme_id,b.results[0].programme_id);
  assert.equal(a.results[0].target_setup.aeroBalance,b.results[0].target_setup.aeroBalance);
});
