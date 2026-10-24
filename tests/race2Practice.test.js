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
  assert.equal(first.modelVersion,1);
  assert.equal(first.source,"rw8.12_practice_core");
  assert.equal(first.results.length,2);
  assert.ok(first.effects.conditionByDriver.D1);
  assert.ok(first.effects.conditionByDriver.D2);
});

test("RW8.12 rejects an unversioned or incompatible Practice input",()=>{
  assert.throws(
    ()=>simulateCanonicalPractice({...input(),modelVersion:2}),
    /PracticeInput\.modelVersion must be 1/
  );
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

test("managed canonical stints carry setup forward and scale fatigue to elapsed running",()=>{
  const full=simulateCanonicalPractice(input()).results[0];
  const firstInput=input();
  firstInput.entrants=[{...firstInput.entrants[0],stintMinutes:10}];
  const first=simulateCanonicalPractice(firstInput);
  const firstRow=first.results[0];
  assert.ok(firstRow.fatigue_cost<full.fatigue_cost);
  assert.ok(firstRow.setup_knowledge<full.setup_knowledge);
  const secondInput=structuredClone(firstInput);
  secondInput.weekendKey+=":stint:2";
  secondInput.entrants[0].priorSetup=firstRow.setup;
  secondInput.entrants[0].priorKnowledge=firstRow.setup_knowledge;
  secondInput.entrants[0].conditionBefore=first.effects.conditionByDriver.D1;
  const second=simulateCanonicalPractice(secondInput).results[0];
  assert.deepEqual(second.initial_setup,firstRow.setup);
  assert.ok(second.setup_knowledge>firstRow.setup_knowledge);
  assert.ok(second.setup_quality>=firstRow.setup_quality,
    "continued setup work must not randomly undo the previous stint");
  for(const key of Object.keys(second.target_setup)){
    const before=Math.abs(firstRow.setup[key]-second.target_setup[key]);
    const after=Math.abs(second.setup[key]-second.target_setup[key]);
    assert.ok(after<=before+0.11,`setup ${key} must converge from the previous actual value`);
  }
  assert.ok(second.fatigue_before>=firstRow.fatigue_after);
});

test("managed stint programme focus earns proportional rather than full-session rewards",()=>{
  const state=input();
  state.entrants=[{...state.entrants[0],stintMinutes:10,requestedProgrammeId:"qualifying"}];
  const q=simulateCanonicalPractice(state).results[0];
  state.entrants[0].requestedProgrammeId="race";
  const r=simulateCanonicalPractice(state).results[0];
  assert.ok(q.qualifying_bonus>r.qualifying_bonus);
  assert.ok(r.race_bonus>q.race_bonus);
  assert.ok(q.qualifying_bonus<0.3);
  assert.ok(r.race_bonus<0.3);
});
