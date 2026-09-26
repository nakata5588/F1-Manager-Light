import test from "node:test";
import assert from "node:assert/strict";

import { newGameTeamPreview, newGameTeamPreviews } from "../src/domain/newGameTeamPreview.js";

function state(){
  return {
    activeYear:1980,
    currentDateISO:"1980-01-01",
    teams:[
      {team_id:"T1",team_name:"Test Racing"},
      {team_id:"T2",team_name:"Backmarker GP"},
    ],
    drivers:[
      {driver_id:"D1",display_name:"Driver One"},
      {driver_id:"D2",display_name:"Driver Two"},
      {driver_id:"D3",display_name:"Driver Three"},
      {driver_id:"D4",display_name:"Driver Four"},
    ],
    driverRatings:[
      {year:1980,driver_id:"D1",current_ability:82},
      {year:1980,driver_id:"D2",current_ability:74},
      {year:1980,driver_id:"D3",current_ability:58},
      {year:1980,driver_id:"D4",current_ability:55},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",driver_name:"Driver One",role:"Main Driver",contract_start_year:1980,contract_until_year:1980,status:"active"},
      {year:1980,team_id:"T1",driver_id:"D2",driver_name:"Driver Two",role:"Second Driver",contract_start_year:1980,contract_until_year:1980,status:"active"},
      {year:1980,team_id:"T2",driver_id:"D3",driver_name:"Driver Three",role:"Main Driver",contract_start_year:1980,contract_until_year:1980,status:"active"},
      {year:1980,team_id:"T2",driver_id:"D4",driver_name:"Driver Four",role:"Second Driver",contract_start_year:1980,contract_until_year:1980,status:"active"},
    ],
    teamBrands:[
      {year:1980,team_id:"T1",starting_budget:12_500_000,board_expectation:"race_wins"},
      {year:1980,team_id:"T2",starting_budget:4_000_000,board_expectation:"championship"},
    ],
    teamEngines:[
      {year:1980,team_id:"T1",engine_name:"Test V8",power:82,reliability:0.84},
      {year:1980,team_id:"T2",engine_name:"Slow V8",power:60,reliability:0.72},
    ],
    staffCore:[
      {staff_id:"S1",staff_name:"Strong Principal"},
      {staff_id:"S2",staff_name:"Weak Principal"},
    ],
    staffRatings:[
      {year:1980,staff_id:"S1",leadership:90,technical:88,strategy:86},
      {year:1980,staff_id:"S2",leadership:55,technical:52,strategy:50},
    ],
    staffContracts:[
      {year:1980,team_id:"T1",staff_id:"S1",staff_name:"Strong Principal",role:"Team Principal",contract_start_year:1980,contract_until_year:1980,status:"active"},
      {year:1980,team_id:"T2",staff_id:"S2",staff_name:"Weak Principal",role:"Team Principal",contract_start_year:1980,contract_until_year:1980,status:"active"},
    ],
    carStats:[
      {year:1980,team_id:"T1",chassis_spec:82,aero_spec:80,gearbox_spec:79,suspension_spec:81,brakes_spec:80,cooling_spec:78,reliability:0.86},
      {year:1980,team_id:"T2",chassis_spec:58,aero_spec:56,gearbox_spec:60,suspension_spec:57,brakes_spec:59,cooling_spec:55,reliability:0.70},
    ],
    facilities:[
      {year:1980,team_id:"T1",wind_tunnel_level:7,aero_dept_level:8,_chassis_shop_level:7,manufacturing_leve:8,pitcrew_training_level:6},
      {year:1980,team_id:"T2",wind_tunnel_level:3,aero_dept_level:3,_chassis_shop_level:4,manufacturing_leve:3,pitcrew_training_level:3},
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
  assert.equal(preview.boardExpectation,"race_wins");
  assert.equal(preview.championshipProjection.nominalPosition,1);
  assert.equal(preview.championshipExpectationLabel,"1st–2nd");
  assert.ok(preview.championshipProjection.score>50);
  assert.equal(preview.championshipProjection.weights.car,0.35);
  assert.equal(preview.championshipProjection.weights.drivers,0.25);
  assert.equal(preview.championshipProjection.weights.staff,0.15);
  assert.ok(preview.championshipProjection.factors.staff>80);
  assert.equal(preview.championshipProjection.completeness,100);
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


test("board expectation does not drive the New Game championship projection",()=>{
  const gs=state();
  const original=newGameTeamPreview(gs,gs.teams[0]);
  const changed={
    ...gs,
    teamBrands:gs.teamBrands.map((row)=>row.team_id==="T1"?{...row,board_expectation:"backmarker"}:row),
  };
  const after=newGameTeamPreview(changed,changed.teams[0]);

  assert.equal(original.championshipExpectationLabel,after.championshipExpectationLabel);
  assert.equal(original.championshipProjection.score,after.championshipProjection.score);
  assert.notEqual(original.boardExpectation,after.boardExpectation);
});


test("batch preview derives the whole field with one shared championship table",()=>{
  const gs=state();
  const previews=newGameTeamPreviews(gs);
  assert.equal(previews.size,2);

  const first=previews.get("T1");
  const second=previews.get("T2");
  assert.equal(first.championshipProjection.fieldSize,2);
  assert.equal(second.championshipProjection.fieldSize,2);
  assert.ok(first.championshipProjection.score>second.championshipProjection.score);
  assert.equal(first.championshipProjection.nominalPosition,1);
  assert.equal(second.championshipProjection.nominalPosition,2);
});
