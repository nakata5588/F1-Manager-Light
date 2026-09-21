import test from "node:test";
import assert from "node:assert/strict";

import { driverMarketEvaluation, compareDriverMarketValue } from "../src/domain/driverMarketEvaluation.js";
import { reserveSeatCount } from "../src/domain/driverContracts.js";
import { applyMarketTick } from "../src/engine/MarketEngine.js";
import { isReserveDriverContract } from "../src/domain/contractRoles.js";

function marketState(){
  return {
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"T1",team_name:"Player Team"},
    teams:[
      {team_id:"T1",team_name:"Player Team"},
      {team_id:"T2",team_name:"AI Team Two"},
      {team_id:"T3",team_name:"AI Team Three"},
    ],
    drivers:[
      {driver_id:"P1",display_name:"Player One",status:"eligible",canHireF1:true},
      {driver_id:"P2",display_name:"Player Two",status:"eligible",canHireF1:true},
      {driver_id:"A1",display_name:"AI One",status:"eligible",canHireF1:true},
      {driver_id:"A2",display_name:"AI Two",status:"eligible",canHireF1:true},
      {driver_id:"B1",display_name:"AI Three",status:"eligible",canHireF1:true},
      {driver_id:"B2",display_name:"AI Four",status:"eligible",canHireF1:true},
      {driver_id:"R1",display_name:"Experienced Free",status:"eligible",canHireF1:true},
      {driver_id:"R2",display_name:"Rated Free",status:"eligible",canHireF1:true},
    ],
    driverRatings:[
      {driver_id:"P1",current_ability:70},
      {driver_id:"P2",current_ability:68},
      {driver_id:"A1",current_ability:66},
      {driver_id:"A2",current_ability:64},
      {driver_id:"B1",current_ability:65},
      {driver_id:"B2",current_ability:63},
      {driver_id:"R2",current_ability:62,pace:63,reputation:58,market_value:300_000},
    ],
    driverCareer:[
      {driver_id:"R1",year:1977,series_division:"F1",starts:12,wins:0,podiums:1},
      {driver_id:"R1",year:1978,series_division:"F1",starts:15,wins:1,podiums:2},
      {driver_id:"R1",year:1979,series_division:"F1",starts:14,wins:0,podiums:1},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"P1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"P2",role:"Second Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"A1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"A2",role:"Second Driver",status:"active"},
      {year:1980,team_id:"T3",driver_id:"B1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T3",driver_id:"B2",role:"Second Driver",status:"active"},
    ],
    inbox:[],
  };
}

test("completely missing ratings use a neutral market score, not zero",()=>{
  const gs={
    activeYear:1980,
    drivers:[{driver_id:"X",display_name:"Unknown",status:"eligible"}],
    driverRatings:[{driver_id:"X",current_ability:null,pace:"",racecraft:null,reputation:null}],
    driverCareer:[],
  };
  const evaluation=driverMarketEvaluation(gs,"X");
  assert.equal(evaluation.score,55);
  assert.equal(evaluation.known_attribute_count,0);
  assert.equal(evaluation.attribute_score,null);
  assert.equal(evaluation.data_quality,"unknown");
});

test("partial ratings only use known fields rather than filling missing fields with zero",()=>{
  const gs={
    activeYear:1980,
    drivers:[{driver_id:"X",display_name:"Partial",status:"eligible"}],
    driverRatings:[{driver_id:"X",pace:78,current_ability:null,racecraft:null,consistency:null}],
    driverCareer:[],
  };
  const evaluation=driverMarketEvaluation(gs,"X");
  assert.equal(evaluation.known_attribute_count,1);
  assert.equal(evaluation.attribute_score,78);
  assert.equal(evaluation.score,78);
  assert.equal(evaluation.data_quality,"partial");
});

test("career experience can evaluate a driver even when ratings are missing",()=>{
  const gs=marketState();
  const experienced=driverMarketEvaluation(gs,"R1");
  const rated=driverMarketEvaluation(gs,"R2");

  assert.equal(experienced.known_attribute_count,0);
  assert.equal(experienced.career.hasF1Experience,true);
  assert.ok(experienced.career.starts>=40);
  assert.ok(experienced.score>55);
  assert.ok(Number.isFinite(rated.score));

  const sorted=[gs.drivers.find(d=>d.driver_id==="R2"),gs.drivers.find(d=>d.driver_id==="R1")]
    .sort((a,b)=>compareDriverMarketValue(gs,a,b));
  assert.equal(sorted[0].driver_id,"R1");
});

test("AI teams with complete race seats immediately try to fill one reserve seat",()=>{
  const gs=marketState();
  const next=applyMarketTick(gs);

  assert.equal(reserveSeatCount(next,"T2"),1);
  assert.equal(reserveSeatCount(next,"T3"),1);

  const reserves=(next.contracts||[]).filter((c)=>isReserveDriverContract(c));
  assert.equal(reserves.length,2);
  assert.ok(reserves.every((c)=>c.source==="ai_reserve_fill"));
  assert.ok(reserves.every((c)=>c.market_evaluation&&Number.isFinite(c.market_evaluation.score)));
  assert.ok(next.inbox.some((msg)=>msg.subject==="Reserve Driver position vacant"));
  assert.ok(next.inbox.some((msg)=>/joins .* as Reserve Driver/.test(String(msg.subject||""))));
});

test("a test driver does not satisfy the AI reserve requirement",()=>{
  const gs=marketState();
  gs.drivers.push({driver_id:"TEST",display_name:"Test Specialist",status:"eligible",canHireF1:true});
  gs.contracts.push({year:1980,team_id:"T2",driver_id:"TEST",role:"test_driver",status:"active"});
  const next=applyMarketTick(gs);

  assert.equal(reserveSeatCount(next,"T2"),1);
  const reserve=(next.contracts||[]).find((c)=>String(c.team_id)==="T2"&&isReserveDriverContract(c));
  assert.ok(reserve);
  assert.notEqual(reserve.driver_id,"TEST");
});

test("AI does not sign a second reserve when one is already active",()=>{
  const gs=marketState();
  gs.contracts.push({year:1980,team_id:"T2",driver_id:"R1",role:"Reserve Driver",status:"active"});
  const before=reserveSeatCount(gs,"T2");
  const next=applyMarketTick(gs);
  const after=reserveSeatCount(next,"T2");

  assert.equal(before,1);
  assert.equal(after,1);
});
