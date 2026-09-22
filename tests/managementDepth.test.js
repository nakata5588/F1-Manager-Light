import test from "node:test";
import assert from "node:assert/strict";

import { deriveBoardState } from "../src/domain/boardState.js";
import { academyProgramDefinition } from "../src/domain/academyPrograms.js";
import { baseComponentConstructionCost } from "../src/domain/garage.js";
import { conditionModifierBreakdown } from "../src/domain/driverPerformance.js";
import { pitCrewEffectiveProfile } from "../src/engine/RaceStrategyEngine.js";

test("live Board state exposes objectives outside the Board page", () => {
  const gs = {
    activeYear:1980,
    team:{team_id:"fer"},
    teamBrands:[{team_id:"fer",board_expectation:"Challenge for the championship"}],
    teams:[{team_id:"fer"},{team_id:"wil"},{team_id:"ren"}],
    calendar:Array.from({length:14},(_,i)=>({round:i+1})),
    results:[{
      year:1980,
      classification:[
        {team_id:"fer",position:1,points:9,retired:false},
        {team_id:"fer",position:3,points:4,retired:false},
      ],
    }],
    standings:{teams:[{team_id:"fer",position:1,points:13}]},
    board:{reputation:0.55},
  };
  const board=deriveBoardState(gs);
  assert.equal(board.expectation,"championship");
  assert.match(board.expectationLabel,/championship/i);
  assert.ok(board.objectives.length>=3);
  assert.ok(board.objectives.some((row)=>row.type==="wins"&&row.progress>0));
  assert.ok(board.confidence>0&&board.confidence<=1);
});

test("manufacturing facility lowers standard component construction cost", () => {
  const low={activeYear:1980,team:{team_id:"fer"},hq:{facilityLevels:{manufacturing_leve:3}}};
  const high={activeYear:1980,team:{team_id:"fer"},hq:{facilityLevels:{manufacturing_leve:9}}};
  assert.ok(baseComponentConstructionCost(high,"gearbox") < baseComponentConstructionCost(low,"gearbox"));
  assert.ok(baseComponentConstructionCost(high,"gearbox") > 0);
});

test("pit crew high training load has a temporary race-day penalty", () => {
  const base={avg_time_s:6.2,consistency:80,error_rate:0.04,training_load:50};
  const hard={...base,training_load:90};
  const balanced=pitCrewEffectiveProfile(base);
  const overtrained=pitCrewEffectiveProfile(hard);
  assert.equal(balanced.avg_time_s,6.2);
  assert.ok(overtrained.avg_time_s>balanced.avg_time_s);
  assert.ok(overtrained.consistency<balanced.consistency);
  assert.ok(overtrained.error_rate>balanced.error_rate);
});

test("Academy plans describe and target different development attributes", () => {
  const racecraft=academyProgramDefinition("Racecraft");
  const feedback=academyProgramDefinition("Technical Feedback");
  const privateTesting=academyProgramDefinition("Private Testing Support");
  assert.ok(racecraft.deltas.racecraft>0);
  assert.ok(feedback.deltas.technical_feedback>racecraft.deltas.technical_feedback || feedback.deltas.technical_feedback>0);
  assert.equal(privateTesting.mode,"supported_prospect");
  assert.ok(privateTesting.description.length>20);
});

test("driver condition modifier makes fatigue visible in performance", () => {
  const neutral={driverAttributes:{d1:{confidence:50,morale:50,preparation:50,fatigue:0}}};
  const tired={driverAttributes:{d1:{confidence:65,morale:60,preparation:70,fatigue:80}}};
  const a=conditionModifierBreakdown(neutral,"d1");
  const b=conditionModifierBreakdown(tired,"d1");
  assert.equal(a.total,0);
  assert.ok(b.fatigueEffect<0);
  assert.ok(b.confidenceEffect>0);
  assert.ok(b.preparationEffect>0);
  assert.ok(b.total<a.total,"extreme fatigue should outweigh positive confidence/preparation");
});
