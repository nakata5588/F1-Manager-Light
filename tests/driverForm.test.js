import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRacePerformanceEvaluation,
  evaluateDriverRacePerformance,
  retirementResponsibility,
  rollingDriverForm,
} from "../src/domain/driverForm.js";
import { dynamicPotentialAdjustment } from "../src/domain/driverPotential.js";

function baseState(){
  return {
    activeYear:1980,
    currentDateISO:"1980-05-18",
    team:{team_id:"T1",team_name:"Alpha"},
    teams:[
      {team_id:"T1",team_name:"Alpha"},
      {team_id:"T2",team_name:"Beta"},
    ],
    carStats:[
      {year:1980,team_id:"T1",chassis_spec:90,aero_spec:90,gearbox_spec:90,suspension_spec:90,brakes_spec:90,cooling_spec:90,reliability:0.9},
      {year:1980,team_id:"T2",chassis_spec:70,aero_spec:70,gearbox_spec:70,suspension_spec:70,brakes_spec:70,cooling_spec:70,reliability:0.75},
    ],
    teamEngines:[
      {year:1980,team_id:"T1",power:90,reliability_override:0.9,chassis_integration:90},
      {year:1980,team_id:"T2",power:70,reliability_override:0.75,chassis_integration:70},
    ],
    drivers:[
      {driver_id:"D1",display_name:"Driver One",age:22},
      {driver_id:"D2",display_name:"Driver Two",age:28},
      {driver_id:"D3",display_name:"Driver Three",age:25},
      {driver_id:"D4",display_name:"Driver Four",age:27},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"Main Driver",status:"active",contract_until_year:1981},
      {year:1980,team_id:"T1",driver_id:"D2",role:"Second Driver",status:"active",contract_until_year:1981},
      {year:1980,team_id:"T2",driver_id:"D3",role:"Main Driver",status:"active",contract_until_year:1981},
      {year:1980,team_id:"T2",driver_id:"D4",role:"Second Driver",status:"active",contract_until_year:1981},
    ],
  };
}

function result({d1Retired=false,d1Reason=null,d1Position=1}={}){
  return {
    key:"1980_5_test",
    year:1980,
    round:5,
    gp_id:"test",
    name:"Test Grand Prix",
    dateISO:"1980-05-18",
    qualifying:[
      {driver_id:"D1",team_id:"T1",position:1},
      {driver_id:"D2",team_id:"T1",position:3},
      {driver_id:"D3",team_id:"T2",position:2},
      {driver_id:"D4",team_id:"T2",position:4},
    ],
    startingGrid:[
      {driver_id:"D1",team_id:"T1",grid:1},
      {driver_id:"D3",team_id:"T2",grid:2},
      {driver_id:"D2",team_id:"T1",grid:3},
      {driver_id:"D4",team_id:"T2",grid:4},
    ],
    classification:[
      {driver_id:"D1",team_id:"T1",position:d1Position,retired:d1Retired,status:d1Retired?"DNF":"Finished",retirement_reason:d1Reason},
      {driver_id:"D3",team_id:"T2",position:d1Position===1?2:1,retired:false,status:"Finished"},
      {driver_id:"D2",team_id:"T1",position:3,retired:false,status:"Finished"},
      {driver_id:"D4",team_id:"T2",position:4,retired:false,status:"Finished"},
    ],
  };
}

test("performance score rewards beating car expectation and team-mate",()=>{
  const evaluation=evaluateDriverRacePerformance(baseState(),result(),"D1");
  assert.ok(evaluation.score>70,"a dominant weekend in the best car should still score as a good performance");
  assert.equal(evaluation.finish_position,1);
  assert.ok(evaluation.factors.some((row)=>row.key==="result_vs_car"&&row.value>0));
  assert.ok(evaluation.factors.some((row)=>row.key==="qualifying_vs_teammate"&&row.value>0));
});

test("mechanical DNF is neutralised while driver-error DNF is penalised",()=>{
  assert.equal(retirementResponsibility("Engine").key,"mechanical");
  assert.equal(retirementResponsibility("Accident").key,"driver_error");

  const mechanical=evaluateDriverRacePerformance(
    baseState(),
    result({d1Retired:true,d1Reason:"Engine",d1Position:4}),
    "D1"
  );
  const accident=evaluateDriverRacePerformance(
    baseState(),
    result({d1Retired:true,d1Reason:"Accident",d1Position:4}),
    "D1"
  );

  assert.equal(mechanical.retirement_responsibility,"mechanical");
  assert.ok(mechanical.factors.some((row)=>row.key==="mechanical_dnf"&&row.value===0));
  assert.ok(mechanical.score>accident.score+8,"mechanical failure must not be treated as a driving mistake");
});

test("rolling form weights recent races more heavily",()=>{
  const form=rollingDriverForm([
    {dateISO:"1980-01-01",round:1,score:50},
    {dateISO:"1980-02-01",round:2,score:60},
    {dateISO:"1980-03-01",round:3,score:70},
    {dateISO:"1980-04-01",round:4,score:80},
    {dateISO:"1980-05-01",round:5,score:90},
  ]);
  assert.equal(form.sample,5);
  assert.ok(form.score>70);
  assert.equal(form.trend,40);
  assert.equal(form.label,"Good");
});

test("race evaluation persists per-driver history and enriches the result",()=>{
  const gs=baseState();
  const pass=applyRacePerformanceEvaluation(gs,result());
  assert.ok(pass.gameState.driverPerformanceLog.D1.length===1);
  assert.ok(pass.gameState.driverForm.D1.score>0);
  assert.ok(pass.resultEntry.classification.find((row)=>row.driver_id==="D1").driver_performance);
});

test("dynamic potential rises with strong form, strong environment and sustained development",()=>{
  const gs={
    ...baseState(),
    driverForm:{D1:{score:88,label:"Excellent",sample:5}},
  };
  const rating={driver_id:"D1",current_ability:74,potential_ability:82};
  const out=dynamicPotentialAdjustment(gs,rating,"D1",{trainingDays:18,focusKey:"pace"});
  assert.ok(out.rating.potential_ability>82);
  assert.ok(out.change.delta>0);
  assert.equal(out.rating._potential_anchor,82);
});

test("dynamic potential can fall after poor form, weak environment and neglected development",()=>{
  const gs={
    ...baseState(),
    team:{team_id:"T2",team_name:"Beta"},
    contracts:baseState().contracts.map((row)=>row.driver_id==="D1"?{...row,team_id:"T2"}:row),
    driverForm:{D1:{score:45,label:"Very Poor",sample:5}},
  };
  const rating={driver_id:"D1",current_ability:70,potential_ability:82,_potential_anchor:82};
  const out=dynamicPotentialAdjustment(gs,rating,"D1",{trainingDays:0,focusKey:null});
  assert.ok(out.rating.potential_ability<82);
  assert.ok(out.change.delta<0);
  assert.ok(out.rating.potential_ability>=70);
});
