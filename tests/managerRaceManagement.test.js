import test from "node:test";
import assert from "node:assert/strict";
import { managerAdjustedPitCrew } from "../src/race2/adapters/GameStateInputAdapter.js";

function gameState(raceManagement,{teamId="T1",active=true}={}){
  return {
    team:{team_id:"T1"},
    manager:{
      current_team_id:"T1",
      current_job:{team_id:"T1",status:active?"active":"fired"},
      attributes:{
        leadership:50,
        personnel:50,
        negotiation:50,
        technical:50,
        commercial:50,
        race_management:raceManagement,
      },
    },
  };
}

test("M6 high Race Management reduces canonical pit execution error chance",()=>{
  const crew={effective_error_chance:0.1,error_rate:0.1};
  const adjusted=managerAdjustedPitCrew(gameState(100),"T1",crew);
  assert.equal(adjusted.manager_race_execution_multiplier,0.92);
  assert.equal(adjusted.effective_error_chance,0.092);
  assert.equal(crew.effective_error_chance,0.1);
});

test("M6 low Race Management increases canonical pit execution error chance",()=>{
  const adjusted=managerAdjustedPitCrew(
    gameState(1),
    "T1",
    {effective_error_chance:0.1}
  );
  assert.ok(adjusted.manager_race_execution_multiplier>1);
  assert.ok(adjusted.effective_error_chance>0.1);
});

test("M6 manager modifier applies only to the manager's active team",()=>{
  const crew={effective_error_chance:0.1};
  assert.deepEqual(managerAdjustedPitCrew(gameState(100),"T2",crew),crew);
  assert.deepEqual(managerAdjustedPitCrew(gameState(100,{active:false}),"T1",crew),crew);
});

test("M6 neutral Race Management leaves specialist pit crew performance unchanged",()=>{
  const crew={effective_error_chance:0.1,error_rate:0.07};
  const adjusted=managerAdjustedPitCrew(gameState(50),"T1",crew);
  assert.equal(adjusted.manager_race_execution_multiplier,1);
  assert.equal(adjusted.effective_error_chance,0.1);
});
