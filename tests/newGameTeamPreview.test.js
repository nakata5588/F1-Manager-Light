import test from "node:test";
import assert from "node:assert/strict";

import { newGameTeamPreview } from "../src/domain/newGameTeamPreview.js";

function state(){
  return {
    activeYear:1980,
    currentDateISO:"1980-01-01",
    teams:[{team_id:"T1",team_name:"Test Racing"}],
    drivers:[
      {driver_id:"D1",display_name:"Driver One"},
      {driver_id:"D2",display_name:"Driver Two"},
    ],
    driverRatings:[
      {year:1980,driver_id:"D1",current_ability:82},
      {year:1980,driver_id:"D2",current_ability:74},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",driver_name:"Driver One",role:"Main Driver",contract_start_year:1980,contract_until_year:1980,status:"active"},
      {year:1980,team_id:"T1",driver_id:"D2",driver_name:"Driver Two",role:"Second Driver",contract_start_year:1980,contract_until_year:1980,status:"active"},
    ],
    teamBrands:[
      {year:1980,team_id:"T1",starting_budget:12_500_000,board_expectation:"race_wins"},
    ],
    teamEngines:[
      {year:1980,team_id:"T1",engine_name:"Test V8",power:82,reliability:0.84},
    ],
    carStats:[
      {year:1980,team_id:"T1",chassis_spec:82,aero_spec:80,gearbox_spec:79,suspension_spec:81,brakes_spec:80,cooling_spec:78,reliability:0.86},
    ],
    facilities:[
      {year:1980,team_id:"T1",wind_tunnel_level:7,aero_dept_level:8,_chassis_shop_level:7,manufacturing_leve:8,pitcrew_training_level:6},
    ],
    driverHistory:[],
    standings:{drivers:[],teams:[]},
    results:[],
    calendar:[],
    // Deliberately hostile runtime state from an existing career. New Game
    // previews must not inherit these values.
    team:{team_id:"OLD",budget:999_000_000},
    teamReputationState:{T1:{reputation:99}},
    board:{expectation:"championship",reputation:1},
    garage:{cars:[{id:"car_1",kind:"race",driver_id:"D1"}]},
    hq:{facilityLevels:{wind_tunnel_level:10},upgrades:[]},
  };
}

test("New Game team preview uses historical opening conditions",()=>{
  const gs=state();
  const preview=newGameTeamPreview(gs,gs.teams[0]);

  assert.equal(preview.teamId,"T1");
  assert.equal(preview.startingBudget,12_500_000);
  assert.equal(preview.championshipExpectation,"race_wins");
  assert.equal(preview.championshipExpectationLabel,"Win races");
  assert.equal(preview.engineName,"Test V8");
  assert.equal(preview.drivers.length,2);
  assert.equal(preview.drivers[0].name,"Driver One");
  assert.equal(preview.drivers[0].overall,82);
  assert.equal(preview.drivers[1].overall,74);
  assert.equal(preview.driversOverall,78);
  assert.equal(preview.facilities.available,5);
  assert.equal(preview.facilities.average,7.2);
  assert.equal(preview.facilities.items.length,5);
  assert.deepEqual(preview.facilities.items[0],{label:"Wind Tunnel",level:7});
  assert.ok(Number.isFinite(preview.car?.overall));
  assert.ok(Number.isFinite(preview.car?.race));
  assert.notEqual(preview.reputation,99);
});
